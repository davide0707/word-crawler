// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Test di esportazioni, documento segnato, Word, schede per Anki, OCR e riconoscimento delle immagini (Node).
 * Uso: node tests/export.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
['core/settings.js', 'core/lang.js', 'core/text.js', 'core/analysis.js', 'core/zip.js', 'core/cfb.js', 'core/formats.js',
  'core/annotate.js', 'core/docx.js', 'core/export.js', 'core/ocr.js', 'core/pen.js'].forEach((f) => require(path.join(root, f)));
const { WCText, WCAnalysis, WCSettings, WCLang, WCZip, WCFormats, WCAnnotate, WCDocx, WCExport, WCOcr, WCPen } = globalThis;

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); }
}
function tokensFromPlain(text) {
  return WCText.tokenizeBlocks(text.split(/\n\s*\n/).map((p, i) => ({ text: p.trim(), w: i === 0 && p.length < 80 ? 3 : 1 })));
}

(async () => {
  WCLang.ensure('it');
  const txt = fs.readFileSync(path.join(__dirname, 'fixtures/guerra-fredda.txt'), 'utf8');
  const toks = tokensFromPlain(txt);
  const res = WCAnalysis.analyze(toks, WCSettings.defaults());
  const idx = (word) => toks.findIndex((t) => t.text === word);
  const iC = idx('cortina'), iW = idx('Winston');
  const marks = [
    { id: 'a', type: 'hl', from: iC, to: iC + 3, text: WCPen.spanText(toks, iC, iC + 3) },
    { id: 'b', type: 'note', from: iW, to: iW + 2, text: 'Winston Churchill', note: 'Fulton & "cortina" <1946>' }
  ];
  const model = WCAnnotate.capture(toks, res.plan.sentences, marks);
  const entry = WCExport.entry({ title: 'La guerra fredda', format: 'Testo', source: 'prova' }, res.results, null, { userMarks: marks, keep: ['key:x'] });

  await check('testo dei segni a mano', () => {
    assert.strictEqual(marks[0].text, 'cortina di ferro');
  });
  await check('documento segnato: tutto il testo, nell’ordine, con i segni', () => {
    const plain = model.blocks.map((b) => b.runs.map((r) => r.t).join('')).join('\n');
    assert.ok(plain.indexOf('Si definisce cortina di ferro la linea immaginaria') > 0);
    assert.strictEqual(model.blocks[0].w, 3);
    assert.strictEqual(model.blocks.length, new Set(toks.map((t) => t.blk)).size);
    const hl = model.blocks.flatMap((b) => b.runs).filter((r) => r.u === 'hl').map((r) => r.t).join('');
    assert.strictEqual(hl, 'cortina di ferro', 'lo spazio tra parole evidenziate fa parte del segno');
    assert.deepStrictEqual(model.notes, [{ n: 1, text: 'Fulton & "cortina" <1946>', quote: 'Winston Churchill' }]);
    const runs = model.blocks.flatMap((b) => b.runs);
    assert.ok(runs.some((r) => r.s === 'def'), 'definizioni');
    assert.ok(runs.some((r) => r.mk === 'num' && r.t === '1946'), 'numeri');
    const endRun = runs.find((r) => r.end);
    assert.ok(endRun && endRun.n === 1 && /Churchill$/.test(endRun.t));
  });
  await check('Word: archivio valido, stili, segni e commenti', async () => {
    const bytes = await WCDocx.build(entry, model);
    const z = WCZip.open(bytes);
    ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/comments.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml']
      .forEach((n) => assert.ok(z.has(n), 'manca ' + n));
    const doc = await z.text('word/document.xml');
    assert.ok(doc.includes('<w:pStyle w:val="Title"/>') && doc.includes('<w:pStyle w:val="Heading1"/>'));
    assert.ok(doc.includes('w:highlight w:val="yellow"'));
    assert.ok(doc.includes('<w:commentRangeStart w:id="0"/>') && doc.includes('<w:commentReference w:id="0"/>'));
    assert.ok(!/[<&](?!\/?w:|amp;|lt;|gt;|quot;|\?xml|\/?Relationship|\/?Types|\/?Default|\/?Override)/.test(doc.replace(/<\/?[a-zA-Z:]+[^>]*>/g, '')), 'caratteri non protetti');
    // ordine delle proprietà del carattere richiesto da Word (b, i, strike, color, sz, highlight, u, bdr, shd)
    const ORDER = ['b', 'i', 'strike', 'color', 'sz', 'highlight', 'u', 'bdr', 'shd'];
    (doc.match(/<w:rPr>.*?<\/w:rPr>/g) || []).forEach((rp) => {
      const tags = (rp.match(/<w:(\w+)/g) || []).map((t) => t.slice(3)).filter((t) => t !== 'rPr');
      const pos = tags.map((t) => ORDER.indexOf(t));
      assert.ok(pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), 'ordine sbagliato: ' + rp);
    });
    const com = await z.text('word/comments.xml');
    assert.ok(com.includes('Fulton &amp; &quot;cortina&quot; &lt;1946&gt;'), 'nota non protetta nell’XML');
    const ct = await z.text('[Content_Types].xml');
    assert.ok(ct.includes('/word/comments.xml'));
    fs.mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'screenshots', 'segnato-node.docx'), bytes);
  });
  await check('Word senza note: niente commenti', async () => {
    const z = WCZip.open(await WCDocx.build(entry, WCAnnotate.capture(toks, res.plan.sentences, [])));
    assert.ok(!z.has('word/comments.xml'));
    assert.ok(!(await z.text('[Content_Types].xml')).includes('comments'));
  });
  await check('pagina web segnata', () => {
    const html = WCAnnotate.html(entry, model);
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('<span class="uh">') && html.includes('<sup class="fn">1</sup>'));
    assert.ok(html.includes('Fulton &amp; &quot;cortina&quot; &lt;1946&gt;'));
    assert.ok(!/<script/i.test(html), 'niente script nella pagina esportata');
    assert.ok(html.includes('@media print'));
  });
  await check('voce d’archivio: schede, segni a mano, evidenziazioni da ritrovare', () => {
    assert.strictEqual(entry.version, 3);
    assert.ok(entry.cards.length >= 4);
    assert.deepStrictEqual(entry.userMarks.map((m) => [m.type, m.text]), [['hl', 'cortina di ferro'], ['note', 'Winston Churchill']]);
    assert.deepStrictEqual(entry.keep, ['key:x']);
  });
  await check('Markdown con segni e schede', () => {
    const md = WCExport.markdown(entry);
    assert.ok(md.includes('## I tuoi segni') && md.includes('**Nota**: «Winston Churchill» — Fulton'));
    assert.ok(md.includes('## Schede di ripasso') && md.includes('Che cos’è «cortina di ferro»?'));
  });
  await check('Anki: tre colonne separate da tabulazione', () => {
    const f = WCExport.build('anki', entry);
    const lines = f.content.trim().split('\n');
    assert.deepStrictEqual(lines.slice(0, 2), ['#separator:tab', '#html:false']);
    lines.filter((l) => !l.startsWith('#')).forEach((l) => assert.strictEqual(l.split('\t').length, 3, l));
    assert.strictEqual(lines.filter((l) => !l.startsWith('#')).length, entry.cards.length);
  });
  await check('immagini riconosciute dai primi byte (TIFF rifiutato con un messaggio chiaro)', async () => {
    const png = fs.readFileSync(path.join(__dirname, 'fixtures/scan-1.png'));
    assert.strictEqual(WCFormats.imageType(png, 'x'), 'image/png');
    const m = await WCFormats.open(png, 'pagina.png');
    assert.ok(m.image && m.mime === 'image/png' && m.title === 'pagina');
    assert.strictEqual(WCFormats.imageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'a.jpg'), 'image/jpeg');
    assert.strictEqual(WCFormats.imageType(Buffer.from('BM ciao, è un testo'), 'note.txt'), null);
    await assert.rejects(() => WCFormats.open(Uint8Array.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]), 'scan.tif'), /TIFF/);
    assert.ok(WCFormats.accept.includes('.png') && WCFormats.accept.includes('.jpg'));
  });

  // ------------------------------------------------------------ OCR
  const tsv = fs.readFileSync(path.join(__dirname, 'fixtures/scan-1.tsv'), 'utf8');
  await check('OCR: parole dal TSV di Tesseract, con righe e paragrafi', () => {
    const words = WCOcr.wordsFromTsv(tsv);
    assert.ok(words.length > 70);
    const ch = words.find((w) => w.text === 'Churchill');
    const row = tsv.split('\n').map((l) => l.split('\t')).find((c) => c[11] === 'Churchill');
    assert.deepStrictEqual([ch.x0, ch.y0, ch.x1, ch.y1], [+row[6], +row[7], +row[6] + +row[8], +row[7] + +row[9]]);
    assert.ok(new Set(words.map((w) => w.par)).size >= 4, 'titolo + 3 paragrafi (Tesseract a volte ne spezza uno)');
    assert.strictEqual(words.map((w) => w.text).slice(0, 5).join(' '), 'The Cold War in Europe');
  });
  await check('OCR: stesse parole dai formati di tesseract.js 5, 6 e 7', () => {
    const fromTsv = WCOcr.wordsFromTsv(tsv);
    // formato "blocks" (6 e 7)
    const blocks = [{ paragraphs: [] }];
    const pars = new Map();
    fromTsv.forEach((w) => {
      if (!pars.has(w.par)) { pars.set(w.par, { lines: new Map() }); }
      const p = pars.get(w.par);
      if (!p.lines.has(w.line)) p.lines.set(w.line, { words: [] });
      p.lines.get(w.line).words.push({ text: w.text, confidence: w.conf, bbox: { x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 } });
    });
    pars.forEach((p) => blocks[0].paragraphs.push({ lines: Array.from(p.lines.values()) }));
    const a = WCOcr.wordsFromData({ blocks });
    // formato "words" con righe (5)
    const lineObjs = new Map();
    const words5 = fromTsv.map((w) => { if (!lineObjs.has(w.line)) lineObjs.set(w.line, {}); return { text: w.text, confidence: w.conf, bbox: { x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 }, line: lineObjs.get(w.line) }; });
    const b = WCOcr.wordsFromData({ words: words5 });
    const key = (ws) => ws.map((w) => w.text + '@' + w.x0 + ',' + w.y0 + '#' + w.line).join(' ');
    assert.strictEqual(key(a), key(fromTsv));
    assert.strictEqual(key(b), key(fromTsv));
    assert.strictEqual(WCOcr.wordsFromData({ tsv: tsv }).length, fromTsv.length);
    assert.deepStrictEqual(WCOcr.wordsFromData(null), []);
  });
  await check('OCR: righe per il ragno (coordinate della pagina mostrata)', () => {
    const words = WCOcr.wordsFromTsv(tsv);
    const s = 0.5;
    const lines = WCOcr.toLines(words, s, s, 0.6);
    const byLine = new Set(words.map((w) => w.line));
    assert.strictEqual(lines.length, byLine.size);
    const l0 = lines[1];
    assert.ok(l0.ocr && typeof l0.str === 'string' && l0.map.length === l0.str.length);
    const w0 = words.find((w) => w.line === 2);
    const info = l0.map[0][0];
    assert.strictEqual(info.x, w0.x0 * s);
    assert.ok(Math.abs((info.base - info.fh * 0.84) - w0.y0 * s) < 1e-9, 'il rettangolo della parola parte dalla sua cima');
    assert.ok(lines.slice(1).some((l) => l.newBlock), 'nuovi paragrafi segnati');
  });
  await check('OCR: lingua scelta dalle impostazioni', () => {
    assert.strictEqual(WCOcr.langsFor({ ocrLang: 'auto', language: 'auto' }), 'ita+eng');
    assert.strictEqual(WCOcr.langsFor({ ocrLang: 'auto', language: 'de' }), 'deu+eng');
    assert.strictEqual(WCOcr.langsFor({ ocrLang: 'en' }), 'eng');
    assert.strictEqual(WCOcr.langsFor({ ocrLang: 'fr' }), 'fra+eng');
  });
  await check('penna: segni ritrovati anche se la pagina è cambiata un po’', () => {
    const shifted = WCText.tokenizeString('Nuovo paragrafo in cima alla pagina. ' + txt);
    const found = WCPen.relocate(shifted, marks);
    assert.strictEqual(found.length, 2);
    found.forEach((m) => assert.strictEqual(WCPen.spanText(shifted, m.from, m.to), m.text));
    assert.ok(found[0].from > marks[0].from, 'posizione aggiornata');
    assert.strictEqual(WCPen.relocate(WCText.tokenizeString('Testo del tutto diverso.'), marks).length, 0);
  });

  console.log(failures ? '\n' + failures + ' test falliti' : '\nTutti i test superati');
  process.exit(failures ? 1 : 0);
})();
