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
    const store = { settings: { reader: { ocr: true } }, docs: new Map(), trash: new Map(), edits: null };
    window.__lib = store;
    window.__saved = [];
    async function info(f) { return { path: f.path, id: 'd-' + (await sha(new TextEncoder().encode(f.path))).slice(0, 16), name: f.name, ext: f.name.split('.').pop().toLowerCase(), size: 1000 + f.name.length, mtime: '2026-10-20T10:00:00.000Z', created: null }; }
    async function sha(bytes) { const h = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join(''); }
    const clone = (x) => JSON.parse(JSON.stringify(x));
    window.wcDesktop = {
      openFile: async () => null,
      fetchUrl: async () => { throw new Error('rete non disponibile nel test'); },
      saveFile: async (name, content) => { window.__saved.push({ name, size: content.length || content.byteLength }); return true; },
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
        saveEdits: async (e) => { store.edits = clone(e); return true; }
      },
      scan: { roots: async () => [], pickFolder: async () => null, start: async () => 'x', cancel: async () => true, exportCsv: async () => true, history: async () => [], compare: async () => null, trash: async () => ({}), onEvent: () => () => {} },
      showItem: async () => true,
      openExternal: async () => true,
      info: async () => ({ version: '2.2.0', platform: 'linux', userData: '/home/utente/.config/Word Crawler', pdfjs: true, ocr: true }),
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
    await page.selectOption('.lb-maptools select', 'md');
    await page.selectOption('.lb-maptools select', 'png');
    await waitFor(() => window.__saved.length >= 2);
    const saved = await page.evaluate(() => window.__saved.map((s) => s.name));
    assert.ok(saved.includes('mappa dei concetti.md') && saved.includes('mappa dei concetti.png'), saved.join(', '));
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

  await check('nessun errore nella pagina', () => { assert.deepStrictEqual(errs, []); });

  await browser.close();
  server.close();
  if (failures) { console.log('\n' + failures + ' test falliti'); process.exit(1); }
  console.log('\nTutti i test della Libreria superati');
})().catch((e) => { console.log('ERRORE ' + (e && e.stack || e)); process.exit(1); });
