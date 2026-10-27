/*
 * Test dei lettori di formato, eseguiti in Chromium (serve DOMParser).
 * Uso: node tests/formats.test.js [--show]
 * I file di prova si creano con: python3 tests/make-fixtures.py (LibreOffice + pandoc)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const CORE = ['text.js', 'zip.js', 'cfb.js', 'formats.js'].map((f) => fs.readFileSync(path.join(root, 'core', f), 'utf8'));

// frasi che devono esserci in ogni documento creato da sample.docx
const MUST = ['Unione Sovietica', 'cortina di ferro', 'Gorbačëv', 'Patto di Varsavia'];
const cases = [
  ['sample.docx', { format: 'Word', title: 'La guerra fredda in Europa', heading: 'La Germania divisa', row: 'Orientale · Patto di Varsavia', bold: true, list: true }],
  ['sample.doc', { format: 'Word 97-2003', row: 'Orientale · Patto di Varsavia' }],
  ['sample.odt', { format: 'OpenDocument Testo', heading: 'La Germania divisa', row: 'Orientale · Patto di Varsavia', bold: true, list: true }],
  ['sample.rtf', { format: 'RTF', heading: 'La Germania divisa', bold: true }],
  ['sample.html', { format: 'HTML', heading: 'La Germania divisa', row: 'Orientale · Patto di Varsavia', bold: true }],
  ['sample.epub', { format: 'EPUB', heading: 'La Germania divisa', title: 'La guerra fredda in Europa' }],
  ['sample.md', { format: 'Markdown', heading: 'La Germania divisa', bold: true, list: true }],
  ['sample.pptx', { format: 'PowerPoint', heading: 'Parte 1', must: ['Unione Sovietica', 'muro di Berlino'] }],
  ['sample.odp', { format: 'OpenDocument Presentazione', heading: 'Parte 1', must: ['Unione Sovietica', 'muro di Berlino'] }],
  ['sample.xlsx', { format: 'Excel', row: '1962 · Crisi dei missili di Cuba', must: ['Patto di Varsavia'] }],
  ['sample.ods', { format: 'OpenDocument Foglio', row: '1962 · Crisi dei missili di Cuba', must: ['Patto di Varsavia'] }],
  ['sample.srt', { format: 'Sottotitoli', must: ['Benvenuti alla lezione sulla guerra fredda. Oggi parliamo di Berlino e della NATO.', 'Nel 1989 cadde il muro di Berlino.'] }],
  ['sample.csv', { format: 'CSV', row: '1961 · Costruzione del muro di Berlino', must: [] }],
  ['sample-cp1252.txt', { format: 'Testo', must: ['La città di Berlino fu divisa. Perché?'] }],
  ['guerra-fredda.txt', { format: 'Testo', heading: 'La guerra fredda in Europa', must: MUST }],
  ['sample.pdf', { format: 'PDF', pdf: true }]
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  for (const src of CORE) await page.addScriptTag({ content: src });
  let failures = 0;
  for (const [file, exp] of cases) {
    const p = path.join(FIX, file);
    if (!fs.existsSync(p)) { console.log('salto ' + file + ' (manca: lancia tests/make-fixtures.py)'); continue; }
    const b64 = fs.readFileSync(p).toString('base64');
    const res = await page.evaluate(async ([b64, name]) => {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      try {
        const m = await WCFormats.open(bytes, name);
        return { ok: true, format: m.format, title: m.title, pdf: !!m.pdf, blocks: m.blocks, warnings: m.warnings };
      } catch (e) { return { ok: false, error: e.message }; }
    }, [b64, file]);
    const problems = [];
    if (!res.ok) problems.push(res.error);
    else {
      const text = res.blocks.map((b) => b.text).join('\n');
      if (exp.format && res.format !== exp.format) problems.push('formato ' + res.format);
      if (exp.title && res.title !== exp.title) problems.push('titolo "' + res.title + '"');
      if (exp.pdf && !res.pdf) problems.push('PDF non riconosciuto');
      if (!exp.pdf) {
        (exp.must || MUST).forEach((m) => { if (text.indexOf(m) < 0) problems.push('manca "' + m + '"'); });
        if (exp.heading && !res.blocks.some((b) => b.type === 'h' && b.text === exp.heading)) problems.push('titolo di sezione "' + exp.heading + '" non riconosciuto');
        if (exp.row && !res.blocks.some((b) => b.type === 'row' && b.text === exp.row)) problems.push('riga di tabella "' + exp.row + '" non trovata');
        if (exp.bold && !res.blocks.some((b) => b.runs && b.runs.some((r) => r.b))) problems.push('grassetto perso');
        if (exp.list && !res.blocks.some((b) => b.type === 'li')) problems.push('elenco puntato perso');
        if (/�/.test(text)) problems.push('caratteri illeggibili');
      }
    }
    if (problems.length) { failures++; console.log('FAIL ' + file + ': ' + problems.join('; ')); }
    else console.log('ok   ' + file + ' (' + res.format + ', ' + res.blocks.length + ' blocchi)');
    if (process.argv.includes('--show') && res.ok) {
      res.blocks.slice(0, 6).forEach((b) => console.log('       ' + b.type + (b.level || '') + ': ' + b.text.slice(0, 90)));
    }
  }
  await browser.close();
  console.log(failures ? '\n' + failures + ' formati con problemi' : '\nTutti i formati superati');
  process.exit(failures ? 1 : 0);
})();
