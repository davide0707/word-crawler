/*
 * Test del lettore in Chromium: la pagina vera del lettore (core/reader.js) con un host finto.
 * Prova: esempio, ripasso e quiz, penna, esportazioni (Word, pagina segnata, Anki, PDF), documento lungo
 * analizzato nel thread separato, PDF vero con PDF.js, PDF scansionato e immagine con l'OCR.
 *
 * Uso: node tests/reader.test.js
 * PDF.js: da node_modules/pdfjs-dist (npm install) oppure dalla cartella indicata in PDFJS_DIR (con pdf.mjs e pdf.worker.mjs).
 * Tesseract: si usa tests/tesseract-stub.js, che risponde con l'uscita vera di tesseract salvata in tests/fixtures.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
['core/zip.js'].forEach((f) => require(path.join(ROOT, f)));
const { WCZip } = globalThis;

function pdfjsDir() {
  const cands = [process.env.PDFJS_DIR, path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build')].filter(Boolean);
  for (const d of cands) {
    if (fs.existsSync(path.join(d, 'pdf.min.mjs'))) return { dir: d, lib: 'pdf.min.mjs', worker: 'pdf.worker.min.mjs' };
    if (fs.existsSync(path.join(d, 'pdf.mjs'))) return { dir: d, lib: 'pdf.mjs', worker: 'pdf.worker.mjs' };
  }
  return null;
}
const PDFJS = pdfjsDir();

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.tsv': 'text/plain' };
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let p;
      if (PDFJS && rel === '/lib/pdf.min.mjs') p = path.join(PDFJS.dir, PDFJS.lib);
      else if (PDFJS && rel === '/lib/pdf.worker.min.mjs') p = path.join(PDFJS.dir, PDFJS.worker);
      else p = path.join(ROOT, rel);
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(s));
  });
}

let failures = 0;
async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); console.log('ok   ' + name + ' (' + (Date.now() - t0) + ' ms)'); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); }
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/tests/reader-harness.html';
  const browser = await chromium.launch();
  const errs = [];
  async function open(query) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await page.goto(base + (query || ''));
    return page;
  }
  async function finished(page, timeout) {
    await page.waitForFunction(() => /Lettura completata/.test(document.querySelector('.wc-status').textContent) ||
      (document.querySelector('.wc-doc-msg') && !document.querySelector('.wc-doc-msg').hidden), null, { timeout: timeout || 30000 });
    const msg = await page.evaluate(() => { const m = document.querySelector('.wc-doc-msg'); return m && !m.hidden ? m.textContent : null; });
    if (msg) throw new Error('errore del lettore: ' + msg);
  }
  async function runToEnd(page) {
    await page.waitForFunction(() => window.reader.state().results, null, { timeout: 30000 });
    await page.click('text=Completa ora');
    await finished(page);
  }
  // rettangolo (coordinate della finestra) di una frase nel documento mostrato
  async function phraseBox(page, phrase) {
    return page.evaluate((phrase) => {
      const root = document.querySelector('.wc-article');
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = tw.nextNode())) {
        const i = n.nodeValue.indexOf(phrase);
        if (i < 0) continue;
        n.parentElement.scrollIntoView({ block: 'center' });
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + phrase.length);
        const rs = r.getClientRects();
        const a = rs[0], b = rs[rs.length - 1];
        return { x1: a.left + 2, y1: a.top + a.height / 2, x2: b.right - 2, y2: b.top + b.height / 2 };
      }
      return null;
    }, phrase);
  }
  async function drag(page, box) {
    await page.mouse.move(box.x1, box.y1);
    await page.mouse.down();
    await page.mouse.move((box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2, { steps: 4 });
    await page.mouse.move(box.x2, box.y2, { steps: 4 });
    await page.mouse.up();
  }

  // ------------------------------------------------------------ esempio, ripasso, quiz, penna, esportazioni
  const page = await open('');
  await check('esempio: lettura completa con sunto, schede e quiz', async () => {
    await page.click('text=Prova con un esempio');
    await runToEnd(page);
    const r = await page.evaluate(() => window.reader.state().results);
    assert.ok(r.summary.length >= 3 && r.keywords.length >= 6);
    assert.ok(r.cards.length >= 5, 'schede: ' + r.cards.length);
    assert.strictEqual(r.langName, 'Italiano');
    assert.strictEqual(r.frequencies, true, 'frequenze non caricate');
    await page.click('#wcr-tab-cards');
    const n = await page.locator('.wc-card').count();
    assert.strictEqual(n, r.cards.length);
    await page.locator('.wc-card').first().locator('text=Mostra la risposta').click();
    assert.ok(await page.locator('.wc-card-back').first().isVisible());
    await page.click('text=/^Quiz \\(/');
    for (let k = 0; k < 2; k++) {
      const q = await page.locator('.wc-quiz-q').textContent();
      const card = r.cards.find((c) => c.cloze === q);
      assert.ok(card, 'domanda sconosciuta: ' + q);
      await page.locator('.wc-choice', { hasText: card.answer }).first().click();
      assert.match(await page.locator('.wc-quiz-fb').textContent(), /^Giusto/);
      await page.locator('.wc-quiz .wc-btn').click();
    }
  });

  await check('penna: evidenzia, nota (con testo), gomma; segni nei risultati', async () => {
    await page.click('.wc-pen-tools >> text=Evidenzia');
    await drag(page, await phraseBox(page, 'cortina di ferro'));
    let st = await page.evaluate(() => window.reader.state());
    assert.strictEqual(st.userMarks.length, 1, 'segni: ' + JSON.stringify(st.userMarks));
    assert.strictEqual(st.userMarks[0].text, 'cortina di ferro');
    assert.strictEqual(st.userMarks[0].type, 'hl');
    await page.click('.wc-pen-tools >> text=Nota');
    await drag(page, await phraseBox(page, 'Winston Churchill'));
    await page.locator('[data-wc-ui] textarea').fill('Discorso di Fulton, 1946');
    await page.locator('[data-wc-ui] >> text=Salva').click();
    st = await page.evaluate(() => window.reader.state());
    const note = st.userMarks.find((m) => m.type === 'note');
    assert.ok(note && note.text === 'Winston Churchill' && note.note === 'Discorso di Fulton, 1946', JSON.stringify(st.userMarks));
    await page.click('.wc-pen-tools >> text=Sottolinea');
    await drag(page, await phraseBox(page, 'ponte aereo'));
    await page.click('#wcr-tab-marks');
    assert.match(await page.locator('.wc-user .wc-subhead').textContent(), /I tuoi segni \(3\)/);
    // gomma sul segno della sottolineatura
    await page.click('.wc-pen-tools >> text=Gomma');
    const b = await phraseBox(page, 'ponte aereo');
    await page.mouse.click(b.x1 + 4, b.y1);
    st = await page.evaluate(() => window.reader.state());
    assert.strictEqual(st.userMarks.length, 2);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.evaluate(() => window.reader.pen.tool()), null, 'Esc non ha posato la penna');
  });

  await check('esportazioni: Word con commenti, pagina segnata, Anki, PDF', async () => {
    async function exp(kind) {
      const before = await page.evaluate(() => window.__saved.length + window.__printed.length);
      await page.selectOption('#wcr-export', kind);
      await page.waitForFunction((n) => window.__saved.length + window.__printed.length > n, before, { timeout: 15000 });
    }
    await exp('docx');
    const docx = await page.evaluate(() => { const s = window.__saved[window.__saved.length - 1]; return { name: s.name, bytes: Array.from(s.content), mime: s.mime }; });
    assert.ok(/segnato\.docx$/.test(docx.name));
    const zip = WCZip.open(new Uint8Array(docx.bytes));
    const xml = await zip.text('word/document.xml');
    assert.ok(xml.includes('cortina di ferro') && xml.includes('w:highlight w:val="yellow"'), 'evidenziatura mancante');
    assert.ok(xml.includes('w:commentRangeStart') && xml.includes('w:commentReference'), 'commento mancante');
    assert.ok((await zip.text('word/comments.xml')).includes('Discorso di Fulton, 1946'));
    assert.ok(xml.includes('w:u w:val="single" w:color="1D4ED8"'), 'frasi chiave non sottolineate');
    fs.mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'screenshots', 'esportazione.docx'), Buffer.from(docx.bytes));
    await exp('ahtml');
    const html = await page.evaluate(() => window.__saved[window.__saved.length - 1].content);
    assert.ok(html.includes('class="uh"') && html.includes('Discorso di Fulton') && html.includes('Schede di ripasso'));
    await exp('anki');
    const anki = await page.evaluate(() => window.__saved[window.__saved.length - 1].content);
    assert.ok(/^#separator:tab/.test(anki) && anki.split('\n').filter((l) => l.split('\t').length === 3).length >= 5);
    await exp('pdf');
    const pr = await page.evaluate(() => window.__printed[window.__printed.length - 1]);
    assert.ok(/\.pdf$/.test(pr.name) && pr.html.includes('Documento segnato'));
  });

  await check('ferma e penna: i segni tornano senza animazione', async () => {
    await page.click('text=Ferma');
    assert.strictEqual(await page.evaluate(() => window.reader.state().engine), false);
    await page.click('.wc-pen-tools >> text=Evidenzia');
    assert.strictEqual(await page.evaluate(() => window.reader.state().engine), true);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'lettore-penna.png') });
  });
  await page.close();

  // ------------------------------------------------------------ documento lungo
  await check('documento lungo (oltre 20.000 parole): analisi nel thread separato', async () => {
    const p = await open('');
    const txt = fs.readFileSync(path.join(__dirname, 'fixtures', 'guerra-fredda.txt'), 'utf8');
    const long = Array(50).fill(txt).join('\n\n');
    await p.evaluate((t) => window.reader.openText(t), long);
    const t0 = Date.now();
    await runToEnd(p);
    const ms = Date.now() - t0;
    const st = await p.evaluate(() => ({ s: window.reader.state(), w: window.__workers }));
    assert.ok(st.s.tokens > 20000, 'parole: ' + st.s.tokens);
    assert.ok(st.w >= 1, 'il thread di analisi non è stato usato');
    const kw = st.s.results.keywords.map((k) => k.word.toLowerCase());
    assert.ok(kw.some((k) => k.indexOf('guerra fredda') === 0), kw.join(', '));
    assert.ok(st.s.results.cards.length > 0);
    console.log('     ' + st.s.tokens.toLocaleString('it-IT') + ' parole lette e analizzate in ' + ms + ' ms');
    await p.close();
  });

  // ------------------------------------------------------------ PDF vero
  if (!PDFJS) console.log('salto i test sui PDF: PDF.js non trovato (npm install, oppure PDFJS_DIR)');
  else {
    await check('PDF con testo: PDF.js vero, pagine lette in parallelo', async () => {
      const p = await open('');
      await p.setInputFiles('#wc-file', path.join(__dirname, 'fixtures', 'sample.pdf'));
      await runToEnd(p);
      const st = await p.evaluate(() => window.reader.state());
      assert.ok(st.tokens > 300 && st.pages >= 1, JSON.stringify({ tokens: st.tokens, pages: st.pages }));
      assert.ok(st.results.keywords.some((k) => /Unione Sovietica|guerra fredda/i.test(k.word)));
      await p.close();
    });

    await check('PDF scansionato: OCR delle pagine senza testo e parole al posto giusto', async () => {
      const p = await open('?ocrstub');
      await p.setInputFiles('#wc-file', path.join(__dirname, 'fixtures', 'scan.pdf'));
      await runToEnd(p);
      const info = await p.evaluate(() => {
        const d = window.reader.debug();
        const t = d.tokens.find((x) => x.text === 'Churchill');
        const P = d.pages[t.page];
        const r = t.rect(), pr = P.div.getBoundingClientRect();
        return { calls: window.__ocrCalls, create: window.__ocrCreate, badges: document.querySelectorAll('.wc-ocr-badge').length, page: t.page,
          x: r.x - (pr.left + window.scrollX), y: r.y - (pr.top + window.scrollY), w: r.w, scale: P.vp.width / P.base.width, st: window.reader.state() };
      });
      assert.strictEqual(info.calls.length, 2, 'pagine riconosciute: ' + info.calls.length);
      assert.strictEqual(info.badges, 2);
      assert.deepStrictEqual(info.calls[0].output, { blocks: true, text: false });
      assert.strictEqual(info.create.oem, 1);
      assert.strictEqual(info.create.workerBlobURL, false);
      const kw = info.st.results.keywords.map((k) => k.word);
      assert.ok(kw.some((k) => /Cold War|Berlin Wall|NATO/.test(k)), kw.join(', '));
      assert.strictEqual(info.st.results.lang, 'en');
      // "Churchill" nel TSV: posizione in pixel dell'immagine (150 dpi); nella pagina mostrata deve cadere lì
      const row = fs.readFileSync(path.join(__dirname, 'fixtures', 'scan-1.tsv'), 'utf8').split('\n').map((l) => l.split('\t')).find((c) => c[11] === 'Churchill');
      const imgToPage = info.scale * 72 / 150; // img2pdf: 150 dpi -> 72 punti per pollice
      assert.ok(Math.abs(info.x - (+row[6]) * imgToPage) < 4, 'x ' + info.x + ' invece di ' + (+row[6]) * imgToPage);
      assert.ok(Math.abs(info.y - (+row[7]) * imgToPage) < 4, 'y ' + info.y + ' invece di ' + (+row[7]) * imgToPage);
      await p.screenshot({ path: path.join(__dirname, 'screenshots', 'ocr-pdf.png') });
      await p.close();
    });
  }

  await check('immagine (PNG): testo riconosciuto con l’OCR', async () => {
    const p = await open('?ocrstub');
    await p.setInputFiles('#wc-file', path.join(__dirname, 'fixtures', 'scan-1.png'));
    await runToEnd(p);
    const st = await p.evaluate(() => ({ s: window.reader.state(), calls: window.__ocrCalls }));
    assert.strictEqual(st.calls.length, 1);
    assert.ok(st.calls[0].w >= 1240, 'immagine passata a Tesseract troppo piccola: ' + st.calls[0].w);
    assert.ok(st.s.tokens > 60, 'parole: ' + st.s.tokens);
    assert.ok(st.s.results.cards.some((c) => /NATO|Iron Curtain/.test(c.front + c.answer)), JSON.stringify(st.s.results.cards.map((c) => c.front)));
    await p.close();
  });

  await check('immagine senza OCR: messaggio chiaro', async () => {
    const p = await open('');
    await p.setInputFiles('#wc-file', path.join(__dirname, 'fixtures', 'scan-1.png'));
    await p.waitForFunction(() => !document.querySelector('.wc-doc-msg').hidden);
    assert.match(await p.locator('.wc-doc-msg').textContent(), /OCR/);
    await p.close();
  });

  await browser.close();
  server.close();
  if (errs.length) { failures++; console.log('FAIL errori nella pagina:\n     ' + errs.slice(0, 8).join('\n     ')); }
  console.log(failures ? '\n' + failures + ' test falliti' : '\nTutti i test del lettore superati');
  process.exit(failures ? 1 : 0);
})();
