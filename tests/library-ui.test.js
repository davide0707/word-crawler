// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Test della Libreria nell'interfaccia desktop vera (desktop/ui/index.html) in Chromium, con un finto
 * "wcDesktop" al posto del preload: importazione di una cartella (Markdown, testo, Word, PowerPoint, PDF,
 * PDF scansionato con l'OCR), ricerca su tutti i documenti, apertura alla posizione esatta, mappa dei
 * concetti, scheda del concetto, unione suggerita, documento tolto e rimesso.
 * Thread di analisi e PDF.js veri; Tesseract sostituito da tests/tesseract-stub.js (uscita vera salvata).
 * Uso: node tests/library-ui.test.js [cartella-screenshot]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.argv[2] || path.join(ROOT, 'tests', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

function pdfjsDir() {
  const cands = [process.env.PDFJS_DIR, path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build')].filter(Boolean);
  for (const d of cands) {
    if (fs.existsSync(path.join(d, 'pdf.min.mjs'))) return { dir: d, lib: 'pdf.min.mjs', worker: 'pdf.worker.min.mjs' };
    if (fs.existsSync(path.join(d, 'pdf.mjs'))) return { dir: d, lib: 'pdf.mjs', worker: 'pdf.worker.mjs' };
  }
  return null;
}
const PDFJS = pdfjsDir();

// documenti di prova sulle telecomunicazioni (gli altri sono i file veri di tests/fixtures)
const DOCS = {
  'radio.ino': `#include <LoRa.h>
#include "SCL3300.h"

SCL3300 sensore;
float angolo;
int maiLetta = 3;

// prepara la radio e il sensore di inclinazione
void setup() {
  LoRa.begin(433E6);
  sensore.begin();
}

void loop() {
  angolo = sensore.getAngle();
  inviaDati(angolo);
}

/* invia al ricevitore il valore letto dal sensore */
void inviaDati(float v) {
  // TODO: gestire l'errore di trasmissione
  LoRa.beginPacket();
  LoRa.print(v);
  LoRa.endPacket();
}

void maiUsata() { return; }
`,
  'Reti_e_Segnali.md': `# Reti e segnali

## Modulazione digitale

La Quadrature Amplitude Modulation (QAM) è una modulazione digitale che combina ampiezza e fase per trasmettere più bit per simbolo. La QAM si usa nelle reti wireless, nei modem via cavo e nella televisione digitale.

La modulazione digitale trasforma una sequenza di bit in un segnale analogico adatto al canale. Ogni simbolo porta uno o più bit: più bit per simbolo significano più velocità, ma anche più errori in presenza di rumore.

La PSK è una modulazione digitale che cambia soltanto la fase della portante. La PSK è più robusta della QAM ma trasporta meno bit per simbolo.

## Trasformata di Fourier

La trasformata di Fourier scompone un segnale nelle sue frequenze. Senza la trasformata di Fourier non si potrebbe progettare un filtro né capire la banda occupata da una modulazione digitale.

Il teorema del campionamento dice che un segnale si ricostruisce se lo si campiona almeno al doppio della sua frequenza massima.
`,
  'Appunti_Telecomunicazioni.txt': `Appunti di telecomunicazioni

Quadrature Amplitude Modulation: trasmette più bit per simbolo variando ampiezza e fase della portante. Con la 16-QAM ogni simbolo porta quattro bit, con la 64-QAM sei bit.

Si definisce rumore termico il rumore prodotto dal moto casuale degli elettroni nei conduttori. Il rumore termico limita la velocità di ogni modulazione digitale e cresce con la banda del canale.

Il rapporto segnale rumore misura quanto il segnale è più forte del rumore. Più alto è il rapporto segnale rumore, più bit per simbolo si possono usare con la QAM.

La trasformata di Fourier aiuta a misurare il rumore termico in ogni banda di frequenza.
`,
  'Reti_wireless.md': `# Reti wireless

L’OFDM divide il canale in tante sottoportanti strette. L’OFDM è usato dal Wi-Fi, dal 4G e dal 5G. Con l’OFDM ogni sottoportante può usare la QAM o la PSK, a seconda del rumore.

Ogni sottoportante dell’OFDM resiste meglio alle riflessioni del segnale. L’OFDM è il cuore delle reti wireless moderne.

Il Wi-Fi è una tecnologia per le reti wireless locali. Il throughput massimo del Wi-Fi dipende dalla QAM usata e dalla banda del canale.
`,
  'Multiplazione.md': `# Multiplazione

La Orthogonal Frequency Division Multiplexing divide la banda in sottoportanti ortogonali. La Orthogonal Frequency Division Multiplexing è la base delle reti cellulari.

La Orthogonal Frequency Division Multiplexing riduce le interferenze tra simboli vicini e semplifica i filtri del ricevitore.
`,
  'Subnetting.md': `# Indirizzi IP

## Subnetting

Il subnetting divide una rete IP in sottoreti più piccole. Il subnetting usa la maschera di rete per decidere quanti bit dell’indirizzo identificano la rete.

La maschera di rete è una sequenza di bit che separa la parte di rete dalla parte dell’host in un indirizzo IP.

## Routing

Il routing sceglie il percorso dei pacchetti tra le sottoreti. Senza subnetting il routing sarebbe meno efficiente, perché le tabelle di routing sarebbero enormi.
`
};
const FIXTURES = ['sample.docx', 'sample.pptx', 'sample.pdf', 'scan.pdf'];
const HOME = '/home/utente/Università';
const FILES = Object.keys(DOCS).map((n) => ({ name: n, url: '/__lib/' + encodeURIComponent(n), path: HOME + '/Reti/' + n }))
  .concat(FIXTURES.map((n) => ({ name: n, url: '/tests/fixtures/' + n, path: HOME + '/Storia/' + n })));

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.tsv': 'text/plain' };
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (rel.startsWith('/__lib/')) {
        const body = DOCS[rel.slice(7)];
        if (body === undefined) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(body);
      }
      let p;
      if (PDFJS && rel.endsWith('/pdfjs-dist/build/pdf.min.mjs')) p = path.join(PDFJS.dir, PDFJS.lib);
      else if (PDFJS && rel.endsWith('/pdfjs-dist/build/pdf.worker.min.mjs')) p = path.join(PDFJS.dir, PDFJS.worker);
      else if (rel.endsWith('/tesseract.js/dist/tesseract.min.js')) p = path.join(__dirname, 'tesseract-stub.js');
      else p = path.join(ROOT, rel);
      if (!p.startsWith(ROOT) && !(PDFJS && p.startsWith(PDFJS.dir)) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(s));
  });
}

let failures = 0;
async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); console.log('ok   ' + name + ' (' + (Date.now() - t0) + ' ms)'); }
  catch (e) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + (e && e.stack || e));
    if (process.env.GITHUB_ACTIONS) console.log('::error title=' + name.replace(/[:,\n]/g, ' ') + '::' + String(e && e.message || e).slice(0, 900).replace(/\r?\n/g, '%0A'));
  }
}

(async () => {
  if (!PDFJS) console.log('PDF.js non trovato: i PDF finiranno tra gli errori');
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

  await page.addInitScript(({ files }) => {
    const store = { settings: { reader: { ocr: true } }, docs: new Map(), trash: new Map(), edits: null, study: null };
    // i cervelli: ognuno ha i suoi documenti, le sue modifiche e i suoi progressi
    let nBrain = 0;
    const mkBrain = (name) => {
      const id = 'b-' + String(++nBrain).padStart(16, '0');
      const b = { id, name, icon: 'libro', color: '#4a63ff', tags: [], created: '2026-10-28T07:00:00.000Z', updated: '2026-10-28T07:00:00.000Z',
        docs: new Map(), trash: new Map(), edits: null, study: null };
      store.brains.push(b);
      return b;
    };
    store.brains = [];
    const first = mkBrain('La mia libreria');
    store.active = first.id;
    const cur = () => store.brains.find((b) => b.id === store.active);
    // store.docs e compagni puntano sempre al cervello aperto
    const bind = () => { const b = cur(); store.docs = b.docs; store.trash = b.trash; Object.defineProperty(store, 'edits', { configurable: true, get: () => b.edits, set: (v) => { b.edits = v; } }); Object.defineProperty(store, 'study', { configurable: true, get: () => b.study, set: (v) => { b.study = v; } }); };
    bind();
    window.__lib = store;
    // una presa sulla vista della Libreria, per leggere lo stato senza aggiungere ganci all'app
    let view = null;
    Object.defineProperty(window, 'WCLibraryView', {
      configurable: true,
      get: () => view,
      set: (v) => {
        view = { mount: (root, host) => { const api = v.mount(root, host); window.__view = api; return api; } };
      }
    });
    window.__saved = [];
    async function info(f) { return { path: f.path, id: 'd-' + (await sha(new TextEncoder().encode(f.path))).slice(0, 16), name: f.name, ext: f.name.split('.').pop().toLowerCase(), size: 1000 + f.name.length, mtime: '2026-10-20T10:00:00.000Z', created: null }; }
    async function sha(bytes) { const h = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join(''); }
    const clone = (x) => JSON.parse(JSON.stringify(x));
    window.wcDesktop = {
      openFile: async () => null,
      fetchUrl: async () => { throw new Error('rete non disponibile nel test'); },
      saveFile: async (name, content) => { window.__saved.push({ name, size: content.length || content.byteLength, text: typeof content === 'string' ? content : null }); return true; },
      printPdf: async () => true,
      settings: { load: async (k) => store.settings[k] || null, save: async (k, v) => { store.settings[k] = v; return true; } },
      archive: { list: async () => [], save: async () => true, remove: async () => true },
      library: {
        addFiles: async () => ({ files: await Promise.all(files.slice(0, 2).map(info)), skipped: 0, truncated: false }),
        addFolder: async () => ({ root: '/home/utente/Università', files: await Promise.all(files.map(info)), skipped: 0, truncated: false }),
        read: async (p) => {
          const f = files.find((x) => x.path === p);
          if (!f) throw new Error('File non presente nella libreria');
          const bytes = new Uint8Array(await (await fetch(f.url)).arrayBuffer());
          return Object.assign(await info(f), { bytes, source: p, hash: await sha(bytes), size: bytes.length });
        },
        list: async () => Array.from(store.docs.values()).map(clone),
        save: async (rec) => { store.docs.set(rec.id, clone(rec)); return true; },
        remove: async (id) => { store.trash.set(id, store.docs.get(id)); store.docs.delete(id); return true; },
        restore: async (id) => { const r = store.trash.get(id); store.docs.set(id, r); store.trash.delete(id); return clone(r); },
        stat: async (paths) => paths.map((p) => ({ path: p, exists: true, size: (store.docs.get(Array.from(store.docs.keys()).find((k) => store.docs.get(k).path === p)) || {}).size, mtime: '2026-10-20T10:00:00.000Z' })),
        loadEdits: async () => store.edits,
        saveEdits: async (e) => { store.edits = clone(e); return true; },
        loadStudy: async () => store.study,
        saveStudy: async (s) => { store.study = clone(s); return true; },
        brains: async () => ({ active: store.active, brains: store.brains.map((b) => ({ id: b.id, name: b.name, icon: b.icon, color: b.color, tags: b.tags, created: b.created, updated: b.updated, docs: b.docs.size, studied: b.study && b.study.cards ? Object.keys(b.study.cards).length : 0 })) }),
        brainCreate: async (o) => { const b = mkBrain(String(o.name || 'Nuovo cervello').trim()); return { id: b.id, name: b.name, icon: b.icon, color: b.color, tags: [] }; },
        brainUpdate: async (o) => { const b = store.brains.find((x) => x.id === o.id); if (!b) throw new Error('Cervello non trovato'); if (o.name != null) b.name = String(o.name).trim(); if (o.icon) b.icon = o.icon; if (o.color) b.color = o.color; return { id: b.id, name: b.name, icon: b.icon, color: b.color, tags: b.tags }; },
        brainUse: async (id) => { if (!store.brains.some((b) => b.id === id)) throw new Error('Cervello non trovato'); store.active = id; bind(); return true; },
        brainDuplicate: async (o) => { const src = store.brains.find((x) => x.id === o.id); const b = mkBrain(src.name + ' (copia)'); src.docs.forEach((v, k) => b.docs.set(k, clone(v))); b.edits = clone(src.edits); b.study = clone(src.study); return { id: b.id, name: b.name }; },
        brainDelete: async (id) => { if (store.brains.length < 2) throw new Error('Deve restare almeno un cervello'); store.brains = store.brains.filter((b) => b.id !== id); if (store.active === id) { store.active = store.brains[0].id; bind(); } return { active: store.active, deleted: id }; },
        brainExport: async (id) => { const b = store.brains.find((x) => x.id === id); window.__exported = { id, docs: b.docs.size }; return { path: '/tmp/' + b.name + '.json', docs: b.docs.size }; },
        brainImport: async () => null
      },
      scan: { roots: async () => [], pickFolder: async () => null, start: async () => 'x', cancel: async () => true, exportCsv: async () => true, history: async () => [], compare: async () => null, trash: async () => ({}), onEvent: () => () => {} },
      showItem: async () => true,
      openExternal: async () => true,
      info: async () => ({ version: '2.4.0', platform: 'linux', userData: '/home/utente/.config/Word Crawler', pdfjs: true, ocr: true }),
      onMenu: () => () => {},
      onFileOpened: () => () => {}
    };
  }, { files: FILES });

  await page.goto(base + '/desktop/ui/index.html');
  // gli avvisi in basso coprirebbero le immagini per la documentazione
  async function shot(name) {
    await page.evaluate(() => { const t = document.querySelector('.lb-toast'); if (t) t.hidden = true; });
    await page.screenshot({ path: path.join(SHOTS, name) });
  }
  // attesa di una condizione nella pagina. Non si usa page.waitForFunction: con alcune versioni di
  // Playwright valuta una stringa, e la Content Security Policy dell'app (senza 'unsafe-eval') lo vieta.
  async function waitFor(fn, arg, timeout) {
    const t0 = Date.now();
    for (;;) {
      if (await page.evaluate(fn, arg)) return;
      if (Date.now() - t0 > (timeout || 30000)) throw new Error('tempo scaduto aspettando: ' + fn.toString().slice(0, 160));
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  await page.click('#tab-library');
  await page.waitForSelector('.lb-empty:not([hidden])');
  await page.screenshot({ path: path.join(SHOTS, 'lib-01-vuota.png') });

  await check('importa una cartella: Markdown, testo, Word, PowerPoint, PDF e PDF scansionato (OCR)', async () => {
    await page.click('text=Aggiungi una cartella');
    await page.waitForSelector('.lb-import:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOTS, 'lib-02-importazione.png') });
    await page.waitForSelector('.lb-import[hidden]', { state: 'attached', timeout: 120000 });
    await waitFor((n) => document.querySelectorAll('.lb-doc').length === n, FILES.length, 20000);
    const docs = await page.evaluate(() => Array.from(window.__lib.docs.values()).map((r) => ({ name: r.name, status: r.status, error: r.error, chunks: r.chunks.length, ocr: r.ocrPages, lang: r.lang, slides: r.chunks.filter((c) => c.slide).length, pages: r.chunks.filter((c) => c.page != null).length })));
    const bad = docs.filter((d) => d.status === 'error');
    assert.strictEqual(bad.length, 0, 'documenti in errore: ' + JSON.stringify(bad));
    docs.forEach((d) => assert.ok(d.chunks > 0, d.name + ' senza passaggi'));
    assert.ok(docs.find((d) => d.name === 'scan.pdf').ocr >= 1, 'OCR delle pagine scansionate');
    assert.ok(docs.find((d) => d.name === 'sample.pptx').slides > 0, 'numero delle slide');
    assert.ok(docs.find((d) => d.name === 'sample.pdf').pages > 0, 'pagine del PDF');
    await page.waitForSelector('.lb-tiles');
  });

  await check('una seconda importazione salta i file già letti', async () => {
    const before = await page.evaluate(() => window.__lib.docs.size);
    await page.click('text=Aggiungi documenti');
    await page.waitForSelector('.lb-toast:has-text("già presenti")', { timeout: 20000 });
    const t = await page.textContent('.lb-toast');
    assert.ok(/già presenti/.test(t), t);
    assert.strictEqual(await page.evaluate(() => window.__lib.docs.size), before);
  });

  await check('ricerca su tutti i documenti: concetto, forme estese e fonti', async () => {
    await page.fill('.lb-q', 'Dove ho parlato di QAM?');
    await page.press('.lb-q', 'Enter');
    await page.waitForSelector('.lb-hit');
    const names = await page.$$eval('.lb-hit .lb-src b', (bs) => bs.map((b) => b.textContent));
    assert.ok(names.includes('Appunti_Telecomunicazioni.txt') && names.includes('Reti_e_Segnali.md') && names.includes('Reti_wireless.md'), names.join(', '));
    const chips = await page.$$eval('.lb-chip', (cs) => cs.map((c) => c.textContent));
    assert.ok(chips.some((c) => /^QAM/.test(c)), 'concetto riconosciuto: ' + chips.join(', '));
    assert.ok(await page.$('.lb-hit mark'), 'parole evidenziate');
    await shot('lib-03-ricerca.png');
  });

  await check('apri alla posizione esatta: PDF nel Lettore, passaggio evidenziato', async () => {
    await page.fill('.lb-q', '"cortina di ferro"');
    await page.press('.lb-q', 'Enter');
    await waitFor(() => Array.from(document.querySelectorAll('.lb-hit .lb-src b')).some((b) => b.textContent === 'sample.pdf'));
    const hit = await page.$('.lb-hit:has(.lb-src b:text-is("sample.pdf"))');
    const where = await hit.$eval('.lb-src', (e) => e.textContent);
    assert.ok(/p\. \d/.test(where), 'pagina indicata: ' + where);
    await hit.$eval('button.wc-btn', (b) => b.click());
    await page.waitForSelector('#view-reader:not([hidden])');
    await waitFor(() => /Lettura completata|LETTURA COMPLETATA/i.test(document.querySelector('.wc-status').textContent), null, 30000);
    await page.waitForTimeout(500);
    const y = await page.evaluate(() => window.scrollY);
    assert.ok(y > 0, 'la pagina scorre fino al passaggio (scrollY ' + y + ')');
    await shot('lib-04-posizione.png');
    await page.click('#tab-library');
  });

  await check('mappa dei concetti: nodi, collegamenti, scheda del concetto', async () => {
    await page.click('.lb-tabs [role="tab"]:text-is("Mappa dei concetti")');
    await page.waitForSelector('.lb-map:not([hidden])');
    await page.waitForTimeout(1200);
    await shot('lib-05-mappa.png');
    await page.fill('.lb-maptools input[type="search"]', 'QAM');
    await page.press('.lb-maptools input[type="search"]', 'Enter');
    await waitFor(() => /QAM/.test((document.querySelector('.lb-panel .lb-title') || {}).textContent || ''));
    const panel = await page.textContent('.lb-panel');
    assert.ok(/Quadrature Amplitude Modulation/.test(panel), 'alias nella scheda');
    assert.ok(/è un tipo di/.test(panel) && /modulazione digitale/.test(panel), 'relazione letta nella definizione');
    assert.ok(/Reti_e_Segnali\.md/.test(panel) && /Appunti_Telecomunicazioni\.txt/.test(panel), 'fonti di più documenti');
    await page.waitForTimeout(400);
    await shot('lib-06-concetto.png');
  });

  await check('unione suggerita: la sigla OFDM e la forma estesa, con conferma e cronologia', async () => {
    await page.waitForSelector('.lb-sugg-btn:not([hidden])');
    await page.click('.lb-sugg-btn');
    await page.waitForSelector('.lb-ask:has-text("OFDM")');
    const ask = await page.$('.lb-ask:has-text("OFDM")');
    assert.ok(ask, 'suggerimento OFDM: ' + (await page.textContent('.lb-panel')).slice(0, 600));
    await shot('lib-07-suggerimenti.png');
    await ask.$eval('button.wc-primary', (b) => b.click());
    await waitFor(() => window.__lib.edits && window.__lib.edits.merges && window.__lib.edits.merges.length === 1);
    await page.fill('.lb-maptools input[type="search"]', 'OFDM');
    await page.press('.lb-maptools input[type="search"]', 'Enter');
    await waitFor(() => /Orthogonal Frequency Division Multiplexing/.test(document.querySelector('.lb-panel').textContent));
    assert.ok(/Cronologia delle modifiche/.test(await page.textContent('.lb-panel')));
  });

  await check('rinomina e collegamento manuale dalla scheda', async () => {
    await page.click('.lb-actions button:text-is("Rinomina")');
    await page.fill('.lb-form input', 'OFDM (multiplazione)');
    await page.click('.lb-form button[type="submit"]');
    await waitFor(() => /OFDM \(multiplazione\)/.test((document.querySelector('.lb-panel .lb-title') || {}).textContent || ''));
    await page.click('.lb-actions button:text-is("Collega a…")');
    await page.fill('.lb-form input', 'QAM');
    await page.click('.lb-form button[type="submit"]');
    await waitFor(() => window.__lib.edits.links && window.__lib.edits.links.length === 1);
    assert.ok(/collegato a/.test(await page.textContent('.lb-rel')));
  });

  await check('esportazioni della mappa: immagine e note Markdown', async () => {
    await page.selectOption('.lb-maptools select:last-of-type', 'md');
    await page.selectOption('.lb-maptools select:last-of-type', 'png');
    await waitFor(() => window.__saved.length >= 2);
    const saved = await page.evaluate(() => window.__saved.map((s) => s.name));
    assert.ok(saved.includes('mappa dei concetti.md') && saved.includes('mappa dei concetti.png'), saved.join(', '));
  });

  await check('studio: domande dalle definizioni, risposta scritta, voto e intervalli', async () => {
    await page.click('.lb-tabs [role="tab"]:text-is("Studio")');
    await page.waitForSelector('.lb-study:not([hidden])');
    await waitFor(() => document.querySelectorAll('.lb-sttiles .sc-tile').length >= 4, null, 20000);
    // all'inizio nessun concetto è stato visto
    const tiles = await page.$$eval('.lb-sttiles .sc-tile', (ts) => ts.map((t) => t.textContent));
    assert.ok(/Mai visti/.test(tiles.join(' ')), 'riquadri: ' + tiles.join(' | '));
    const total = await page.evaluate(() => window.__view.state().study.total);
    assert.ok(total >= 5, 'concetti da studiare: ' + total);
    assert.strictEqual(await page.evaluate(() => window.__view.state().study.studied), 0);
    // il percorso va dai concetti generali a quelli specifici
    await page.waitForSelector('.lb-steps .lb-step');
    const levels = await page.$$eval('.lb-steps .lb-step', (ls) => ls.map((l) => +l.style.getPropertyValue('--lv')));
    assert.ok(levels.length >= 5 && levels.every((v, i) => i === 0 || v >= levels[i - 1]), 'livelli: ' + levels.join(','));
    await shot('lib-07-ripasso.png');

    await page.selectOption('.lb-sttools select:nth-of-type(3)', '10');
    await page.click('.lb-sttools button');
    await page.waitForSelector('.lb-card:not([hidden]) .lb-front');
    const card = await page.evaluate(() => ({
      ask: document.querySelector('.lb-prompt').textContent,
      front: document.querySelector('.lb-front').textContent,
      typed: !!document.querySelector('.lb-typed'),
      n: document.querySelector('.lb-cardbar .wc-note').textContent
    }));
    assert.ok(card.front.trim().length > 2, 'domanda: ' + JSON.stringify(card));
    assert.ok(/1 di \d+/.test(card.n), 'avanzamento: ' + card.n);
    await shot('lib-08-domanda.png');

    // una risposta sbagliata: il verdetto, la frase intera e la fonte
    if (card.typed) {
      await page.fill('.lb-typed', 'una risposta che non c’entra niente');
      await page.press('.lb-typed', 'Enter');
      await page.waitForSelector('.lb-verdict');
      assert.ok(/no/.test(await page.getAttribute('.lb-verdict', 'class')), 'risposta sbagliata riconosciuta');
    } else {
      await page.click('.lb-answer button');
    }
    await page.waitForSelector('.lb-backtext');
    const back = await page.evaluate(() => ({
      text: document.querySelector('.lb-backtext').textContent,
      src: (document.querySelector('.lb-src') || {}).textContent || '',
      grades: Array.from(document.querySelectorAll('.lb-grades button')).map((b) => b.textContent)
    }));
    assert.ok(back.text.length > 10, 'risposta: ' + back.text);
    assert.ok(/\.(md|txt|pdf|docx|pptx)/.test(back.src), 'la fonte è un documento vero: ' + back.src);
    await shot('lib-09-risposta.png');

    // il voto: quattro gradi quando si rivela, "Prossima" dopo una risposta scritta
    if (card.typed) {
      assert.ok(back.grades.some((g) => /Prossima|Finisci/.test(g)), 'si va avanti: ' + back.grades.join(', '));
      await page.click('.lb-grades .wc-primary');
    } else {
      assert.deepStrictEqual(back.grades.slice(0, 4), ['Di nuovo', 'Difficile', 'Bene', 'Facile']);
      await page.click('.lb-g2');
    }
    await waitFor(() => window.__view.state().study.studied >= 1, null, 15000);
    const after = await page.evaluate(() => window.__view.state().study);
    assert.ok(after.studied >= 1, 'un concetto studiato: ' + JSON.stringify(after));
    assert.ok(after.mastery > 0, 'padronanza salita: ' + after.mastery);
    // i progressi sono stati salvati fuori, nella cartella dati (il salvataggio aspetta un attimo)
    await waitFor(() => !!(window.__lib.study && window.__lib.study.cards && Object.keys(window.__lib.study.cards).length), null, 10000);
    const saved = await page.evaluate(() => window.__lib.study);
    assert.ok(saved && saved.cards && Object.keys(saved.cards).length >= 1, 'progressi salvati: ' + JSON.stringify(saved && saved.cards));
    const first = saved.cards[Object.keys(saved.cards)[0]];
    assert.ok(first.due && Date.parse(first.due) > Date.now(), 'prossimo ripasso nel futuro: ' + first.due);
    assert.ok(first.interval >= 1, 'intervallo: ' + first.interval);
  });

  await check('studio: la seconda domanda e la tastiera (barra spaziatrice e voti da 1 a 4)', async () => {
    await page.waitForSelector('.lb-card .lb-front');
    const before = await page.evaluate(() => window.__view.state().study.studied);
    await page.click('.lb-card');
    await page.keyboard.press('Space');
    await page.waitForSelector('.lb-backtext');
    await page.keyboard.press('3');
    await waitFor((k) => window.__view.state().study.studied > k, before, 15000);
    assert.ok(await page.evaluate(() => window.__view.state().study.studied) > before, 'il voto da tastiera conta');
  });

  await check('la mappa colorata per padronanza, e il movimento si ferma se non serve', async () => {
    await page.click('.lb-tabs [role="tab"]:text-is("Mappa dei concetti")');
    await page.waitForSelector('.lb-map:not([hidden])');
    await page.check('#lb-mastery');
    await waitFor(() => document.querySelector('.lb-legend').classList.contains('lb-legend-m'));
    const legend = await page.textContent('.lb-legend');
    assert.ok(/mai visto/.test(legend) && /saldo/.test(legend) && /da ripassare/.test(legend), 'legenda della padronanza: ' + legend);
    // la mappa è viva: i concetti si muovono da soli
    const p0 = await page.evaluate(() => window.__view.state().graph.nodes.slice(0, 40).map((n) => [n.x, n.y]));
    await page.waitForTimeout(600);
    const p1 = await page.evaluate(() => window.__view.state().graph.nodes.slice(0, 40).map((n) => [n.x, n.y]));
    const moved = p1.filter((p, i) => Math.abs(p[0] - p0[i][0]) + Math.abs(p[1] - p0[i][1]) > 0.01).length;
    assert.ok(moved > 0, 'la mappa si muove da sola (' + moved + ' concetti su ' + p1.length + ')');
    await shot('lib-10-mappa-padronanza.png');
    // «Riordina» rimescola, e si riassesta
    await page.click('.lb-maptools button:text-is("Riordina")');
    await page.waitForTimeout(400);
    const p2 = await page.evaluate(() => window.__view.state().graph.nodes.slice(0, 40).map((n) => [n.x, n.y]));
    assert.ok(p2.some((p, i) => Math.abs(p[0] - p1[i][0]) + Math.abs(p[1] - p1[i][1]) > 1), 'il riordino sposta i concetti');
    await page.uncheck('#lb-mastery');
  });

  await check('esportazione delle domande per Anki: tre colonne con la fonte', async () => {
    await page.click('.lb-tabs [role="tab"]:text-is("Studio")');
    await page.waitForSelector('.lb-study:not([hidden])');
    const n0 = await page.evaluate(() => window.__saved.length);
    await page.selectOption('.lb-sttools select:last-of-type', 'anki');
    await waitFor((k) => window.__saved.length > k, n0, 15000);
    const file = await page.evaluate(() => window.__saved[window.__saved.length - 1]);
    assert.strictEqual(file.name, 'domande per Anki.txt');
    const lines = String(file.text || '').trim().split('\n');
    assert.ok(lines[0].startsWith('#separator:tab'), 'direttive di Anki: ' + lines[0]);
    const rows = lines.filter((l) => l[0] !== '#');
    assert.ok(rows.length >= 5, 'carte esportate: ' + rows.length);
    rows.forEach((r) => assert.strictEqual(r.split('\t').length, 3, 'tre colonne: ' + r.slice(0, 100)));
    assert.ok(/word-crawler/.test(rows[0]), 'etichette: ' + rows[0]);
  });

  await check('togli un documento e annulla (il file originale non si tocca)', async () => {
    await page.click('.lb-tabs [role="tab"]:text-is("Risultati")');
    const n = await page.evaluate(() => window.__lib.docs.size);
    const doc = await page.$('.lb-doc:has(.lb-doc-name:text-is("Subnetting.md"))');
    await doc.hover();
    await doc.$eval('.lb-doc-actions button:last-child', (b) => b.click());
    await waitFor((k) => window.__lib.docs.size === k - 1, n);
    await page.waitForSelector('.lb-toast:has-text("Annulla")');
    await page.click('.lb-toast button');
    await waitFor((k) => window.__lib.docs.size === k, n);
    await page.fill('.lb-q', 'subnetting');
    await page.press('.lb-q', 'Enter');
    await waitFor(() => Array.from(document.querySelectorAll('.lb-hit .lb-src b')).some((b) => b.textContent === 'Subnetting.md'));
  });

  await check('svuota la libreria: tutti i documenti in un colpo solo, i file sul disco restano', async () => {
    const n = await page.evaluate(() => window.__lib.docs.size);
    assert.ok(n >= 5, 'documenti prima: ' + n);
    await page.click('.lb-clear');
    await page.waitForSelector('.lb-docsec .lb-ask');
    // prima si annulla: non deve togliere niente
    await page.click('.lb-docsec .lb-ask button:text-is("Annulla")');
    assert.strictEqual(await page.evaluate(() => window.__lib.docs.size), n, 'annullare non toglie niente');
    await page.click('.lb-clear');
    await page.click('.lb-docsec .lb-ask .wc-danger');
    await waitFor(() => window.__lib.docs.size === 0, null, 30000);
    await page.waitForSelector('.lb-empty:not([hidden])');
    assert.strictEqual(await page.evaluate(() => window.__view.state().docs.length), 0);
    // i progressi dello studio e le modifiche della mappa sono azzerati con i documenti
    const after = await page.evaluate(() => ({ study: window.__lib.study, edits: window.__lib.edits, trash: window.__lib.trash.size }));
    assert.deepStrictEqual(after.study.cards, {}, 'progressi azzerati');
    assert.deepStrictEqual(after.edits.merges, [], 'modifiche della mappa azzerate');
    assert.ok(after.trash >= n, 'i record restano nel cestino dell’app: ' + after.trash);
  });

  await check('cervelli: ne creo un altro, resta vuoto, e tornando indietro i documenti ci sono ancora', async () => {
    // (a questo punto il primo cervello è stato svuotato dalla prova precedente: lo riempio di nuovo)
    await page.click('text=Aggiungi una cartella');
    await page.waitForSelector('.lb-import[hidden]', { state: 'attached', timeout: 120000 });
    await waitFor((n) => document.querySelectorAll('.lb-doc').length === n, FILES.length, 30000);
    const n0 = await page.evaluate(() => window.__lib.docs.size);
    assert.ok(n0 >= 5, 'documenti nel primo cervello: ' + n0);

    await page.click('.lb-brains-btn');
    await page.waitForSelector('.lb-brains .lb-brain');
    assert.strictEqual(await page.$$eval('.lb-brains .lb-brain', (ls) => ls.length), 1);
    assert.ok(/aperto/.test(await page.textContent('.lb-brain')), 'il primo è segnato come aperto');

    await shot('lib-11-cervelli.png');
    await page.click('.lb-panel .lb-actions button:text-is("Nuovo cervello")');
    await page.fill('.lb-form input', 'Analisi 2');
    await page.click('.lb-form button[type="submit"]');
    await waitFor(() => window.__lib.active !== window.__lib.brains[0].id, null, 20000);
    await page.waitForSelector('.lb-empty:not([hidden])');
    assert.strictEqual(await page.evaluate(() => window.__view.state().docs.length), 0, 'il cervello nuovo è vuoto');
    assert.ok(/Analisi 2/.test(await page.inputValue('.lb-brainsel')) || /Analisi 2/.test(await page.textContent('.lb-brainhead')), 'il selettore mostra il nuovo');

    // torno al primo dal selettore: i documenti ci sono ancora
    const firstId = await page.evaluate(() => window.__lib.brains[0].id);
    await page.selectOption('.lb-brainsel', firstId);
    await waitFor((k) => window.__view.state().docs.length === k, n0, 20000);
    assert.strictEqual(await page.evaluate(() => window.__lib.active), firstId);
  });

  await check('cervelli: rinomina, cambia colore, duplica, esporta ed elimina', async () => {
    await page.click('.lb-brains-btn');
    await page.waitForSelector('.lb-brains .lb-brain');
    const card = '.lb-brain:has(.lb-brain-name:text-is("Analisi 2"))';
    await page.click(card + ' button:text-is("Rinomina")');
    await page.fill(card + ' .lb-form input', 'Analisi II');
    await page.click(card + ' .lb-form button[type="submit"]');
    await page.waitForSelector('.lb-brain-name:text-is("Analisi II")');

    await page.click('.lb-brain:has(.lb-brain-name:text-is("Analisi II")) button:text-is("Colore e icona")');
    await page.click('.lb-brain:has(.lb-brain-name:text-is("Analisi II")) .lb-swatch:nth-child(5)');
    await waitFor(() => window.__lib.brains.some((b) => b.name === 'Analisi II' && b.color !== '#4a63ff'), null, 10000);

    // duplica il cervello aperto: la copia ha gli stessi documenti
    const n0 = await page.evaluate(() => window.__lib.docs.size);
    await page.click('.lb-brain.is-open button:text-is("Duplica")');
    await waitFor(() => window.__lib.brains.some((b) => / \(copia\)$/.test(b.name)), null, 10000);
    const copiaDocs = await page.evaluate(() => window.__lib.brains.find((b) => / \(copia\)$/.test(b.name)).docs.size);
    assert.strictEqual(copiaDocs, n0, 'la copia ha gli stessi documenti');

    await page.click('.lb-brain.is-open button:text-is("Esporta")');
    await waitFor(() => !!window.__exported, null, 10000);
    assert.strictEqual(await page.evaluate(() => window.__exported.docs), n0);

    // eliminazione con conferma
    const before = await page.evaluate(() => window.__lib.brains.length);
    await page.click('.lb-brain:has(.lb-brain-name:text-is("Analisi II")) button:text-is("Elimina")');
    await page.waitForSelector('.lb-brain .lb-ask');
    await page.click('.lb-brain .lb-ask .wc-danger');
    await waitFor((k) => window.__lib.brains.length === k - 1, before, 15000);
    assert.ok(!(await page.$('.lb-brain-name:text-is("Analisi II")')), 'sparito dall’elenco');
  });

  await check('codice: riepilogo, chi chiama, codice morto e cose da fare', async () => {
    await page.click('.lb-tabs [role="tab"]:text-is("Codice")');
    await page.waitForSelector('.lb-code:not([hidden])');
    await waitFor(() => document.querySelectorAll('.lb-cdbody .sc-tile').length >= 5, null, 20000);
    const tiles = await page.textContent('.lb-cdbody');
    assert.ok(/Arduino/.test(tiles), 'il linguaggio riconosciuto: ' + tiles.slice(0, 200));
    await shot('lib-12-codice.png');

    // chi chiama inviaDati
    await page.fill('.lb-cdfind', 'inviaDati');
    await page.press('.lb-cdfind', 'Enter');
    await waitFor(() => /Chi la chiama/.test(document.querySelector('.lb-cdbody').textContent), null, 15000);
    const body = await page.textContent('.lb-cdbody');
    assert.ok(/loop/.test(body), 'la chiama loop: ' + body.slice(0, 300));
    assert.ok(/riga 16/.test(body), 'con la riga esatta: ' + body.slice(0, 300));
    assert.ok(/Di cosa ha bisogno/.test(body) && /beginPacket/.test(body), 'e cosa usa lei');

    // codice morto
    await page.fill('.lb-cdfind', '');
    await page.selectOption('.lb-code select', 'dead');
    await waitFor(() => /maiUsata/.test(document.querySelector('.lb-cdbody').textContent), null, 15000);
    const dead = await page.textContent('.lb-cdbody');
    assert.ok(/maiLetta/.test(dead), 'anche la variabile mai letta: ' + dead.slice(0, 200));
    assert.ok(!/\binviaDati\b/.test(dead.split('Nessuno li chiama')[0]), 'inviaDati è usata, non è morta');

    // cose da fare
    await page.selectOption('.lb-code select', 'todos');
    await waitFor(() => /TODO/.test(document.querySelector('.lb-cdbody').textContent), null, 15000);
    assert.ok(/trasmissione/.test(await page.textContent('.lb-cdbody')));

    // esportazione della documentazione
    const n0 = await page.evaluate(() => window.__saved.length);
    await page.click('text=Esporta la documentazione');
    await waitFor((k) => window.__saved.length > k, n0, 15000);
    const md = await page.evaluate(() => window.__saved[window.__saved.length - 1]);
    assert.strictEqual(md.name, 'documentazione del codice.md');
    assert.ok(/# Documentazione del codice/.test(md.text) && /Glossario/.test(md.text), md.text.slice(0, 200));
  });

  await check('un simbolo del codice è un concetto come gli altri', async () => {
    await page.click('.lb-tabs [role="tab"]:text-is("Mappa dei concetti")');
    await page.waitForSelector('.lb-map:not([hidden])');
    await page.fill('.lb-maptools input[type="search"]', 'inviaDati');
    await page.press('.lb-maptools input[type="search"]', 'Enter');
    await waitFor(() => /inviaDati/.test((document.querySelector('.lb-panel .lb-title') || {}).textContent || ''), null, 15000);
    const panel = await page.textContent('.lb-panel');
    assert.ok(/funzione/.test(panel), 'la scheda dice che è una funzione: ' + panel.slice(0, 300));
    assert.ok(/riga 20/.test(panel), 'con la riga: ' + panel.slice(0, 300));
    assert.ok(/invia al ricevitore/.test(panel), 'il commento fa da definizione');
    assert.ok(/usato da/.test(panel) || /loop/.test(panel), 'e il collegamento con loop');
  });

  // risponde a una domanda qualunque, comunque sia fatta la carta
  async function rispondi(giusto) {
    const opt = await page.$('.lb-opt');
    if (opt) { await (giusto ? page.click('.lb-opt.is-right, .lb-opt[data-opt="1"]') : opt.click()); return 'quiz'; }
    const typed = await page.$('.lb-typed');
    if (typed) { await page.fill('.lb-typed', 'qualcosa'); await page.press('.lb-typed', 'Enter'); return 'scritta'; }
    const rivela = await page.$('.lb-answer button');
    if (rivela) { await rivela.click(); const g = await page.$('.lb-g2'); if (g) await g.click(); return 'rivelata'; }
    return null;
  }
  async function avanti() {
    const b = await page.$('.lb-grades .wc-primary');
    if (b) await b.click();
  }

  await check('quiz a scelta multipla, punti e traguardi', async () => {
    await page.click('.lb-tabs [role="tab"]:text-is("Studio")');
    await page.waitForSelector('.lb-study:not([hidden])');
    await page.selectOption('.lb-sttools select:nth-of-type(2)', 'review');
    await page.selectOption('.lb-sttools select:nth-of-type(3)', '20');

    // si risponde finché non esce una domanda a scelta multipla (o finiscono le carte)
    await page.click('.lb-sttools button');
    await page.waitForSelector('.lb-card:not([hidden]) .lb-front');
    let quiz = false;
    for (let i = 0; i < 20; i++) {
      if (await page.$('.lb-opt')) { quiz = true; break; }
      if (!(await rispondi(true))) break;
      await page.waitForTimeout(60);
      await avanti();
      if (!(await page.$('.lb-card .lb-front'))) break;
    }
    if (quiz) {
      assert.strictEqual(await page.$$eval('.lb-opt', (bs) => bs.length), 4, 'quattro alternative');
      await shot('lib-14-quiz.png');
      await page.click('.lb-opt[data-opt="1"]');
      await waitFor(() => !!document.querySelector('.lb-opt.is-right'), null, 10000);
      assert.ok(await page.$$eval('.lb-opt', (bs) => bs.every((b) => b.disabled)), 'dopo la scelta non si cambia idea');
      await avanti();
    }
    const c = await page.$('.lb-card .wc-link:text-is("Chiudi")');
    if (c) await c.click();

    // adesso che si è risposto, i punti ci sono
    await waitFor(() => !document.querySelector('.lb-xp').hidden, null, 20000);
    const xp = await page.textContent('.lb-xp');
    assert.ok(/Livello \d+/.test(xp), 'il livello: ' + xp.slice(0, 120));
    assert.ok(/punti/.test(xp) && /oggi \d+ di \d+/.test(xp), 'punti e obiettivo del giorno: ' + xp.slice(0, 200));
    assert.ok(await page.$('.lb-trophy'), 'almeno un traguardo preso');
    // il salvataggio aspetta un attimo prima di scrivere
    await waitFor(() => !!(window.__lib.study && (window.__lib.study.log || []).length), null, 10000);
    await shot('lib-13-punti.png');
  });

  await check('esame simulato: punteggio alla consegna', async () => {
    const chiudi = await page.$('.lb-card .wc-link:text-is("Chiudi")');
    if (chiudi) await chiudi.click();
    await page.selectOption('.lb-sttools select:nth-of-type(2)', 'exam');
    await page.selectOption('.lb-sttools select:nth-of-type(3)', '10');
    await page.click('.lb-sttools button');
    await page.waitForSelector('.lb-card:not([hidden]) .lb-front');
    for (let i = 0; i < 14; i++) {
      if (await page.$('.lb-score')) break;
      if (!(await rispondi(true))) break;
      await page.waitForTimeout(60);
      await avanti();
    }
    await page.waitForSelector('.lb-score', { timeout: 20000 });
    const score = await page.textContent('.lb-score');
    assert.ok(/\d+ su 100/.test(score), 'il punteggio: ' + score);
    assert.ok(/risposte giuste su/.test(await page.textContent('.lb-card')), 'e il dettaglio');
    await shot('lib-15-esame.png');
    await page.click('.lb-grades .wc-btn:text-is("Chiudi")');
  });

  await check('mappa: le quattro disposizioni, i temi, la profondità e la mini-mappa', async () => {
    await page.click('.lb-tabs [role="tab"]:text-is("Mappa dei concetti")');
    await page.waitForSelector('.lb-map:not([hidden])');
    assert.ok(await page.$('.lb-mini'), 'c’è la mini-mappa');
    const pos = () => page.evaluate(() => window.__view.state().graph.nodes.slice(0, 30).map((n) => [Math.round(n.x), Math.round(n.y)]));

    // ad albero: i concetti si ordinano per livello, su righe
    const prima = await pos();
    await page.selectOption('.lb-maptools select:nth-of-type(1)', 'tree');
    await page.waitForTimeout(900);
    const albero = await pos();
    assert.ok(albero.some((p, i) => Math.abs(p[1] - prima[i][1]) > 20), 'la disposizione ad albero sposta i concetti');
    const righe = new Set(albero.map((p) => p[1]));
    assert.ok(righe.size <= albero.length / 2 + 2, 'i concetti si allineano su poche righe: ' + righe.size);
    await shot('lib-16-albero.png');

    // per padronanza: i saldi verso il centro
    await page.selectOption('.lb-maptools select:nth-of-type(1)', 'mastery');
    await page.waitForTimeout(900);
    assert.ok((await pos()).some((p, i) => p[0] !== albero[i][0] || p[1] !== albero[i][1]), 'la disposizione per padronanza cambia le posizioni');

    // a costellazione
    await page.selectOption('.lb-maptools select:nth-of-type(1)', 'ring');
    await page.waitForTimeout(900);
    await shot('lib-17-costellazione.png');

    // temi
    await page.selectOption('.lb-maptools select:nth-of-type(2)', 'paper');
    await page.waitForTimeout(200);
    assert.ok(await page.$('.lb-stage.lb-light'), 'il tema carta schiarisce lo sfondo');
    await shot('lib-18-tema-carta.png');
    await page.selectOption('.lb-maptools select:nth-of-type(2)', 'blueprint');
    await page.waitForTimeout(200);
    assert.ok(!(await page.$('.lb-stage.lb-light')), 'blueprint torna scuro');
    await page.selectOption('.lb-maptools select:nth-of-type(2)', 'night');

    // profondità
    await page.check('#lb-3d');
    await page.waitForTimeout(200);
    await page.uncheck('#lb-3d');
    await page.selectOption('.lb-maptools select:nth-of-type(1)', 'force');
    await page.waitForTimeout(400);
  });

  await check('doppio clic apre un concetto e gli porta vicino i suoi, col percorso per tornare', async () => {
    await page.fill('.lb-maptools input[type="search"]', 'QAM');
    await page.press('.lb-maptools input[type="search"]', 'Enter');
    await waitFor(() => /QAM/.test((document.querySelector('.lb-panel .lb-title') || {}).textContent || ''), null, 15000);
    // dove sta il concetto sullo schermo, adesso
    await page.waitForTimeout(500);
    const at = await page.evaluate(() => {
      const st = window.__view.state();
      const n = st.graph.nodes.find((x) => /QAM/i.test(x.label));
      const r = document.querySelector('.lb-canvas').getBoundingClientRect();
      return n ? { x: r.left + n.x * st.camera.k + st.camera.x, y: r.top + n.y * st.camera.k + st.camera.y } : null;
    });
    assert.ok(at, 'il concetto è sulla mappa');
    await page.mouse.dblclick(at.x, at.y);
    await waitFor(() => window.__view.state().trail.length >= 1, null, 10000);
    const trail = await page.evaluate(() => window.__view.state().trail.map((t) => t.label));
    assert.ok(/QAM/i.test(trail.join(' ')), 'il percorso ricorda dove sei stato: ' + trail.join(' › '));
    assert.ok(await page.$('.lb-crumbs button'), 'e lo mostra');
  });

  await check('spiega un concetto con le frasi dei documenti', async () => {
    await page.click('.lb-tabs [role="tab"]:text-is("Mappa dei concetti")');
    await page.fill('.lb-maptools input[type="search"]', 'QAM');
    await page.press('.lb-maptools input[type="search"]', 'Enter');
    await waitFor(() => /QAM/.test((document.querySelector('.lb-panel .lb-title') || {}).textContent || ''), null, 15000);
    await page.click('.lb-actions button:text-is("Spiega")');
    await waitFor(() => /Spiegazione/.test(document.querySelector('.lb-panel').textContent), null, 15000);
    const p = await page.textContent('.lb-panel');
    assert.ok(/modulazione digitale/i.test(p), 'la definizione vera: ' + p.slice(0, 300));
    assert.ok(/Dove leggerlo/.test(p) && /\.md|\.pdf|\.docx/.test(p), 'e dove leggerlo');
    assert.ok(await page.$('.lb-srcbtn'), 'ogni pezzo ha la sua fonte cliccabile');
    const n0 = await page.evaluate(() => window.__saved.length);
    await page.click('.lb-panel button:text-is("Salva il ramo (.md)")');
    await waitFor((k) => window.__saved.length > k, n0, 15000);
    const md = await page.evaluate(() => window.__saved[window.__saved.length - 1]);
    assert.ok(/^# /.test(md.text) && /Dove leggerlo/.test(md.text), 'il riassunto del ramo: ' + md.text.slice(0, 120));
    await shot('lib-19-spiega.png');
  });

  await check('che cosa ho notato: lacune, contraddizioni, divergenze', async () => {
    await page.click('.lb-panel .lb-back');
    await waitFor(() => /La tua base di conoscenza/.test(document.querySelector('.lb-panel').textContent), null, 15000);
    await page.click('.lb-panel button:text-is("Che cosa ho notato")');
    await waitFor(() => !/Guardo…/.test(document.querySelector('.lb-panel').textContent), null, 25000);
    const p = await page.textContent('.lb-panel');
    assert.ok(/Che cosa ho notato/.test(p));
    // nel finto corpus c'è una funzione citata e mai definita? almeno una sezione deve comparire
    assert.ok(/Lacune|Contraddizioni|Concetti isolati|Snodi|non ho trovato niente/i.test(p), 'una sezione o il niente: ' + p.slice(0, 300));
    await shot('lib-20-notato.png');
  });

  await check('confronto fra due cervelli', async () => {
    await page.click('.lb-panel .lb-back');
    await waitFor(() => /La tua base di conoscenza/.test(document.querySelector('.lb-panel').textContent), null, 15000);
    const ha = await page.$('.lb-panel button:text-is("Confronta con un altro cervello")');
    if (!ha) { console.log('     (un cervello solo: niente da confrontare)'); return; }
    await ha.click();
    await page.waitForSelector('.lb-panel button:text-is("Confronta")');
    await page.click('.lb-panel button:text-is("Confronta")');
    await waitFor(() => /% in comune/.test(document.querySelector('.lb-cmp').textContent), null, 40000);
    const t = await page.textContent('.lb-cmp');
    assert.ok(/% in comune/.test(t), 'la percentuale: ' + t.slice(0, 200));
    // il cervello aperto non deve cambiare
    const aperto = await page.evaluate(() => window.__lib.active);
    assert.strictEqual(aperto, await page.evaluate(() => window.__view.state().docs.length ? window.__lib.active : null), 'il cervello aperto resta quello');
    assert.ok((await page.evaluate(() => window.__view.state().docs.length)) > 0, 'e i suoi documenti sono ancora lì');
    await shot('lib-21-confronto.png');
  });

  await check('nessun errore nella pagina', () => { assert.deepStrictEqual(errs, []); });

  await browser.close();
  server.close();
  if (failures) { console.log('\n' + failures + ' test falliti'); process.exit(1); }
  console.log('\nTutti i test della Libreria superati');
})().catch((e) => { console.log('ERRORE ' + (e && e.stack || e)); process.exit(1); });
