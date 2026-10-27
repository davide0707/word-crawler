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
  BrowserWindow: Object.assign(function (opts) {
    const wc = { setWindowOpenHandler: () => {}, on: () => {}, send: () => {},
      printToPDF: async (o) => { fake.printed = { opts: o, file: fake.lastLoadFile, html: fs.readFileSync(fake.lastLoadFile, 'utf8') }; return Buffer.from('%PDF-1.4 finto'); } };
    if (opts && opts.webPreferences && opts.webPreferences.javascript === false) fake.printWin = opts;
    return { once: () => {}, on: () => {}, loadURL: (u) => { fake.loaded = u; }, loadFile: async (f) => { fake.lastLoadFile = f; }, destroy: () => { fake.destroyed = true; },
      webContents: wc, isMinimized: () => false };
  }, { getAllWindows: () => [] }),
  ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
  dialog: {
    showSaveDialog: async (_w, o) => ({ canceled: false, filePath: path.join(USER, 'salvato-' + path.basename(o.defaultPath)) }),
    showMessageBox: async (_w, o) => { fake.asked = o; return { response: fake.answer }; }
  },
  // "Cestino" finto: sposta il file in una cartella a parte
  shell: { showItemInFolder: () => {}, openExternal: () => {}, trashItem: async (p) => { const d = path.join(USER, 'cestino'); fs.mkdirSync(d, { recursive: true }); fs.renameSync(p, path.join(d, Date.now() + '-' + path.basename(p))); } },
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
      'scan:roots', 'scan:pick-folder', 'scan:start', 'scan:cancel', 'scan:export-csv', 'shell:show', 'shell:external', 'app:info',
      'export:pdf', 'scan:history', 'scan:compare', 'scan:trash']
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

  // ---------------------------------------------------------------- versione 2.1
  await check('salvataggio di file binari (documenti Word)', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 0, 255, 10, 13]);
    assert.strictEqual(await handlers['file:save']({}, { name: 'prova.docx', content: bytes, mime: 'application/zip' }), true);
    assert.deepStrictEqual(Array.from(fs.readFileSync(path.join(USER, 'salvato-prova.docx'))), Array.from(bytes));
    await handlers['file:save']({}, { name: '../../fuori.txt', content: 'testo' });
    assert.ok(fs.existsSync(path.join(USER, 'salvato-fuori.txt')), 'il nome del file non deve contenere percorsi');
  });
  await check('PDF del documento segnato: finestra senza script, file temporaneo cancellato', async () => {
    assert.strictEqual(await handlers['export:pdf']({}, { html: '<h1>Documento segnato</h1>', name: 'doc - segnato.pdf' }), true);
    assert.strictEqual(fake.printWin.webPreferences.javascript, false);
    assert.strictEqual(fake.printWin.webPreferences.sandbox, true);
    assert.ok(fake.printed.html.includes('Documento segnato'));
    assert.ok(!fs.existsSync(fake.printed.file) || await new Promise((r) => setTimeout(() => r(!fs.existsSync(fake.printed.file)), 50)), 'file temporaneo rimasto');
    assert.strictEqual(fs.readFileSync(path.join(USER, 'salvato-doc - segnato.pdf'), 'utf8'), '%PDF-1.4 finto');
    await assert.rejects(() => handlers['export:pdf']({}, { html: 42 }));
  });

  function runScan(root) {
    return new Promise((resolve) => {
      const sender = { isDestroyed: () => false, send: (ch, m) => { if (m.type === 'done' || m.type === 'error') resolve(m); } };
      handlers['scan:start']({ sender }, { root, legs: 2, duplicates: 'fast', minDupSize: 0, csv: true });
    }).then((m) => { if (m.type !== 'done') throw new Error(m.message); return m.report; });
  }
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-cmp-'));
  const dupContent = Buffer.alloc(200000, 7); // più grande di 128 KB: controllo veloce, poi completo prima del Cestino
  fs.writeFileSync(path.join(dir2, 'originale.bin'), dupContent);
  fs.mkdirSync(path.join(dir2, 'copie'));
  fs.writeFileSync(path.join(dir2, 'copie', 'copia.bin'), dupContent);
  fs.writeFileSync(path.join(dir2, 'resta.txt'), 'prima');
  fs.writeFileSync(path.join(dir2, 'sparira.txt'), 'addio');
  let first, second;
  await check('confronto tra due scansioni della stessa cartella', async () => {
    first = await runScan(dir2);
    await new Promise((r) => setTimeout(r, 20));
    fs.rmSync(path.join(dir2, 'sparira.txt'));
    fs.writeFileSync(path.join(dir2, 'nuovo.txt'), 'ciao a tutti');
    fs.writeFileSync(path.join(dir2, 'resta.txt'), 'dopo, più lungo');
    fs.mkdirSync(path.join(dir2, 'grande'));
    fs.writeFileSync(path.join(dir2, 'grande', 'dati.bin'), Buffer.alloc(300000, 1));
    second = await runScan(dir2);
    const hist = await handlers['scan:history']({}, dir2);
    assert.deepStrictEqual(hist.map((h) => h.id), [second.id, first.id]);
    const c = await handlers['scan:compare']({}, first.id, second.id);
    const bytes = c.totals.find((t) => t.key === 'bytes');
    assert.strictEqual(bytes.delta, 300000 + Buffer.byteLength('ciao a tutti') + Buffer.byteLength('dopo, più lungo') - 5 - 5);
    assert.deepStrictEqual(c.files.added.top.map((f) => path.basename(f.path)).sort(), ['dati.bin', 'nuovo.txt']);
    assert.deepStrictEqual(c.files.removed.top.map((f) => path.basename(f.path)), ['sparira.txt']);
    assert.deepStrictEqual(c.files.changed.top.map((f) => path.basename(f.path)), ['resta.txt']);
    assert.ok(c.folders.some((f) => f.path === 'grande' && f.before === null && f.after === 300000), JSON.stringify(c.folders));
    await assert.rejects(() => handlers['scan:compare']({}, '../../etc', second.id));
  });
  await check('duplicati nel Cestino: controlli, conferma, registro', async () => {
    const groups = second.duplicates.groups;
    assert.strictEqual(groups.length, 1);
    const copy = groups[0].paths.find((p) => /copia\.bin$/.test(p)), orig = groups[0].paths.find((p) => /originale\.bin$/.test(p));
    // annullato dall'utente: niente si muove
    fake.answer = 1;
    let r = await handlers['scan:trash']({ sender: { isDestroyed: () => false, send: () => {} } }, second.id, [{ group: 0, paths: [copy] }]);
    assert.strictEqual(r.cancelled, true);
    assert.ok(fs.existsSync(copy));
    assert.ok(/identico byte per byte/.test(fake.asked.detail));
    // mai tutte le copie di un gruppo
    fake.answer = 0;
    r = await handlers['scan:trash']({ sender: { isDestroyed: () => false, send: () => {} } }, second.id, [{ group: 0, paths: [copy, orig] }]);
    assert.strictEqual(r.moved.length, 0);
    assert.ok(fs.existsSync(copy) && fs.existsSync(orig));
    // file che non è un duplicato del rapporto, o fuori dalla cartella
    r = await handlers['scan:trash']({ sender: { isDestroyed: () => false, send: () => {} } }, second.id, [{ group: 0, paths: [path.join(dir2, 'resta.txt'), '/etc/hosts'] }]);
    assert.strictEqual(r.moved.length, 0);
    assert.strictEqual(r.skipped.length, 2);
    // contenuto cambiato dopo la scansione (stessa dimensione): non si sposta
    const changed = Buffer.from(dupContent); changed[100000] = 9;
    fs.writeFileSync(copy, changed);
    r = await handlers['scan:trash']({ sender: { isDestroyed: () => false, send: () => {} } }, second.id, [{ group: 0, paths: [copy] }]);
    assert.strictEqual(r.moved.length, 0);
    assert.ok(/non è identico/.test(r.skipped[0].reason), r.skipped[0].reason);
    // tutto in regola: la copia va nel Cestino, l'originale resta
    fs.writeFileSync(copy, dupContent);
    r = await handlers['scan:trash']({ sender: { isDestroyed: () => false, send: () => {} } }, second.id, [{ group: 0, paths: [copy] }]);
    assert.deepStrictEqual(r.moved, [copy]);
    assert.ok(!fs.existsSync(copy) && fs.existsSync(orig));
    assert.strictEqual(r.bytes, 200000);
    const log = fs.readFileSync(r.log, 'utf8');
    assert.ok(log.includes('NEL CESTINO') && log.includes(copy) && log.includes('copia tenuta: ' + orig));
  });
  fs.rmSync(dir2, { recursive: true, force: true });

  fs.rmSync(USER, { recursive: true, force: true });
  console.log(failures ? '\n' + failures + ' test falliti' : '\nTutti i test superati');
  process.exit(failures ? 1 : 0);
})();
