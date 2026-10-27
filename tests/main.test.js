/*
 * Test del processo principale (desktop/main.js) senza Electron: il modulo "electron" viene
 * sostituito da un finto con la stessa forma, e si chiamano davvero i gestori IPC.
 * Uso: node tests/main.test.js
 */
'use strict';
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const USER = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-user-'));
const handlers = {};
let protocolHandler = null;
const fake = {
  app: {
    getPath: (k) => (k === 'userData' ? USER : os.tmpdir()),
    getVersion: () => '2.0.0',
    requestSingleInstanceLock: () => true,
    on: () => {},
    whenReady: () => Promise.resolve(),
    quit: () => {}
  },
  // finestra finta: registra solo le chiamate
  BrowserWindow: Object.assign(function () {
    const wc = { setWindowOpenHandler: () => {}, on: () => {}, send: () => {} };
    return { once: () => {}, on: () => {}, loadURL: (u) => { fake.loaded = u; }, webContents: wc, isMinimized: () => false };
  }, { getAllWindows: () => [] }),
  ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
  dialog: {},
  shell: { showItemInFolder: () => {}, openExternal: () => {} },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: (s, fn) => { protocolHandler = fn; } },
  net: { fetch: async (u) => ({ ok: true, url: u, status: 200 }) },
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) }
};
const origLoad = Module._load;
Module._load = function (request) { return request === 'electron' ? fake : origLoad.apply(this, arguments); };
require('../desktop/main.js');

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

(async () => {
  await new Promise((r) => setTimeout(r, 50));
  await check('la finestra carica l’interfaccia dal protocollo interno', () => {
    assert.strictEqual(fake.loaded, 'app://wc/desktop/ui/index.html');
  });
  await check('tutti i canali IPC sono registrati', () => {
    ['file:open', 'url:fetch', 'file:save', 'settings:load', 'settings:save', 'archive:list', 'archive:save', 'archive:remove',
      'scan:roots', 'scan:pick-folder', 'scan:start', 'scan:cancel', 'scan:export-csv', 'shell:show', 'shell:external', 'app:info']
      .forEach((c) => assert.ok(handlers[c], 'manca ' + c));
  });
  await check('impostazioni: salvataggio e lettura', async () => {
    await handlers['settings:save']({}, 'reader', { speed: 30 });
    assert.deepStrictEqual(await handlers['settings:load']({}, 'reader'), { speed: 30 });
    assert.strictEqual(await handlers['settings:load']({}, 'altro'), null);
  });
  await check('archivio: salva, elenca, elimina', async () => {
    await handlers['archive:save']({}, { id: 'wc-abc-1', title: 'Prova', date: '2026-10-27T10:00:00Z' });
    await handlers['archive:save']({}, { id: 'wc-abc-2', title: 'Seconda', date: '2026-10-27T11:00:00Z' });
    const list = await handlers['archive:list']({});
    assert.deepStrictEqual(list.map((e) => e.title), ['Seconda', 'Prova']);
    await handlers['archive:remove']({}, 'wc-abc-1');
    assert.strictEqual((await handlers['archive:list']({})).length, 1);
  });
  await check('archivio: rifiuta identificativi che escono dalla cartella', async () => {
    await assert.rejects(() => handlers['archive:remove']({}, '../../etc/passwd'));
    await assert.rejects(() => handlers['archive:save']({}, { id: '..\\..\\x' }));
  });
  await check('pagine web: solo indirizzi http e https', async () => {
    await assert.rejects(() => handlers['url:fetch']({}, 'file:///etc/passwd'));
    await assert.rejects(() => handlers['url:fetch']({}, 'javascript:alert(1)'));
  });
  await check('elenco CSV: si copia solo dalla cartella delle scansioni', async () => {
    await assert.rejects(() => handlers['scan:export-csv']({}, '/etc/passwd'));
  });
  await check('protocollo app://: niente file fuori dalle cartelle dell’app', async () => {
    const r = await protocolHandler({ url: 'app://wc/../../etc/passwd' });
    assert.strictEqual(r.status, 404);
    const r2 = await protocolHandler({ url: 'app://wc/desktop/main.js' });
    assert.strictEqual(r2.status, 404, 'il codice del processo principale non deve essere servito');
    const ok = await protocolHandler({ url: 'app://wc/core/text.js' });
    assert.strictEqual(ok.status, 200);
  });
  await check('scansione completa attraverso il thread separato', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-scanme-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'ciao');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'ciao');
    fs.mkdirSync(path.join(dir, 'sotto'));
    fs.writeFileSync(path.join(dir, 'sotto', 'c.pdf'), Buffer.alloc(3000, 1));
    const events = [];
    const done = new Promise((resolve) => {
      const sender = { isDestroyed: () => false, send: (ch, m) => { events.push(m); if (m.type === 'done' || m.type === 'error') resolve(m); } };
      handlers['scan:start']({ sender }, { root: dir, legs: 4, duplicates: 'full', minDupSize: 0, csv: true });
    });
    const m = await done;
    assert.strictEqual(m.type, 'done', m.message);
    assert.strictEqual(m.report.totals.files, 3);
    assert.strictEqual(m.report.duplicates.totalGroups, 1);
    assert.ok(fs.existsSync(m.report.csvPath), 'CSV non scritto');
    assert.ok(m.report.csvPath.startsWith(USER), 'il CSV deve stare nella cartella dati dell’app');
    const saved = fs.readdirSync(path.join(USER, 'scans'));
    assert.ok(fs.existsSync(path.join(USER, 'scans', saved[0], 'rapporto.json')));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await check('scansione: cartella inesistente rifiutata', async () => {
    await assert.rejects(() => handlers['scan:start']({ sender: { isDestroyed: () => false, send: () => {} } }, { root: '/non/esiste/davvero' }), /non trovata/);
  });

  fs.rmSync(USER, { recursive: true, force: true });
  console.log(failures ? '\n' + failures + ' test falliti' : '\nTutti i test superati');
  process.exit(failures ? 1 : 0);
})();
