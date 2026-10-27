/*
 * Test dell'interfaccia desktop senza Electron: la pagina vera (desktop/ui/index.html) gira in Chromium
 * con un finto "wcDesktop" al posto del preload. La scansione mostrata è una scansione VERA fatta
 * prima con lo scanner di Node, poi riprodotta evento per evento.
 * Uso: node tests/desktop-ui.test.js <cartella-da-scansionare> <cartella-screenshot>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const { scan } = require('../desktop/scanner');

const ROOT = path.join(__dirname, '..');
const SCAN_DIR = process.argv[2] || '/usr/share';
const SHOTS = process.argv[3] || path.join(ROOT, 'tests', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.docx': 'application/octet-stream' };
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(s));
  });
}

(async () => {
  // 1. scansione vera, registrata
  const events = [];
  const report = await scan({ root: SCAN_DIR, legs: 8, duplicates: 'fast', minDupSize: 1024, visDepth: 5 }, (m) => events.push(m));
  events.push({ type: 'done', report: report });
  console.log('scansione registrata: ' + report.totals.files + ' file, ' + events.length + ' eventi');

  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/pdfjs-dist|Failed to load resource/.test(m.text())) errs.push(m.text()); });

  await page.addInitScript(({ events, scanDir }) => {
    const store = { settings: {}, archive: [] };
    let listeners = [];
    window.__saved = [];
    window.wcDesktop = {
      openFile: async () => {
        const b = new Uint8Array(await (await fetch('/tests/fixtures/sample.docx')).arrayBuffer());
        return { name: 'sample.docx', bytes: b, source: '/tests/fixtures/sample.docx' };
      },
      fetchUrl: async () => { throw new Error('rete non disponibile nel test'); },
      saveFile: async (name, content) => { window.__saved.push({ name, size: content.length }); return true; },
      settings: { load: async (k) => store.settings[k] || null, save: async (k, v) => { store.settings[k] = v; return true; } },
      archive: {
        list: async () => store.archive.slice(),
        save: async (e) => { store.archive.push(e); return true; },
        remove: async (id) => { store.archive = store.archive.filter((x) => x.id !== id); return true; }
      },
      scan: {
        roots: async () => [{ label: 'Cartella di prova', path: scanDir }, { label: 'Disco C:', path: 'C:\\' }],
        pickFolder: async () => scanDir,
        start: async () => {
          let i = 0;
          (function next() {
            if (i >= events.length) return;
            const m = events[i++];
            listeners.forEach((cb) => cb(m));
            setTimeout(next, m.type === 'progress' ? 60 : 5);
          })();
          return 'test';
        },
        cancel: async () => true,
        exportCsv: async () => true,
        onEvent: (cb) => { listeners.push(cb); return () => { listeners = listeners.filter((x) => x !== cb); }; }
      },
      showItem: async () => true,
      openExternal: async () => true,
      info: async () => ({ version: '2.0.0', platform: 'linux', userData: '/home/utente/.config/Word Crawler', pdfjs: false }),
      onMenu: () => () => {},
      onFileOpened: () => () => {}
    };
  }, { events, scanDir: SCAN_DIR });

  await page.goto(base + '/desktop/ui/index.html');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '01-lettore-vuoto.png') });

  // Lettore: Word in modalità Studio
  await page.click('text=Apri un file');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(SHOTS, '02-lettore-studio.png') });
  await page.click('text=Completa ora');
  await page.waitForTimeout(400);
  await page.click('text=Salva in archivio');
  await page.waitForTimeout(300);

  // Ragnatela, tema notte
  await page.selectOption('#wcs-preset', 'video');
  await page.click('text=Rileggi ora');
  await page.waitForTimeout(6500);
  await page.screenshot({ path: path.join(SHOTS, '03-lettore-ragnatela.png') });

  // Scanner
  await page.click('#tab-scanner');
  await page.selectOption('#sc-root', SCAN_DIR);
  await page.click('text=Avvia la scansione');
  const progressCount = events.filter((e) => e.type === 'progress').length;
  await page.waitForTimeout(Math.min(4000, progressCount * 30));
  await page.screenshot({ path: path.join(SHOTS, '04-scanner-in-corso.png') });
  await page.waitForSelector('.sc-report:not([hidden])', { timeout: 120000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOTS, '05-scanner-fine.png') });
  await page.evaluate(() => document.querySelector('.sc-report').scrollIntoView());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, '06-rapporto.png') });
  await page.click('.sc-report [role="tab"]:has-text("Duplicati")');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, '07-rapporto-duplicati.png') });
  await page.click('text=Rapporto completo (.html)');
  await page.waitForTimeout(200);

  // Archivio e guida
  await page.click('#tab-archive');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, '08-archivio.png') });
  await page.click('#tab-guide');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, '09-guida.png') });

  const saved = await page.evaluate(() => window.__saved);
  console.log('esportati:', JSON.stringify(saved));
  console.log('errori nella pagina:', errs.length ? JSON.stringify(errs) : 'nessuno');
  await browser.close();
  server.close();
  process.exit(errs.length ? 1 : 0);
})();
