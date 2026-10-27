/*
 * Prepara l'estensione per Chrome/Edge/Brave in dist/extension e la comprime in dist/word-crawler-extension.zip.
 * Copia il motore condiviso (core/), le icone e, se installato con "npm install", PDF.js.
 * Uso: npm run build:extension
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { zipDir } = require('./zip');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'extension');
const CORE = ['settings.js', 'lang.js', 'text.js', 'analysis.js', 'analysis-worker.js', 'zip.js', 'cfb.js', 'formats.js', 'dom.js', 'pdfcore.js', 'crawler.js',
  'annotate.js', 'docx.js', 'export.js', 'ocr.js', 'pen.js', 'settings-ui.js', 'results-ui.js', 'reader.js', 'archive-ui.js', 'reader.css'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'core'), { recursive: true });
fs.cpSync(path.join(ROOT, 'extension'), OUT, { recursive: true });
CORE.forEach((f) => fs.copyFileSync(path.join(ROOT, 'core', f), path.join(OUT, 'core', f)));
fs.cpSync(path.join(ROOT, 'core', 'freq'), path.join(OUT, 'core', 'freq'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'THIRD-PARTY.md'), path.join(OUT, 'THIRD-PARTY.md'));
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
[16, 48, 128].forEach((s) => fs.copyFileSync(path.join(ROOT, 'build', 'icons', 'icon' + s + '.png'), path.join(OUT, 'icons', 'icon' + s + '.png')));

const pdfBuild = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build');
fs.mkdirSync(path.join(OUT, 'lib'), { recursive: true });
let pdf = false;
if (fs.existsSync(path.join(pdfBuild, 'pdf.min.mjs'))) {
  ['pdf.min.mjs', 'pdf.worker.min.mjs'].forEach((f) => fs.copyFileSync(path.join(pdfBuild, f), path.join(OUT, 'lib', f)));
  const v = JSON.parse(fs.readFileSync(path.join(pdfBuild, '..', 'package.json'), 'utf8')).version;
  fs.writeFileSync(path.join(OUT, 'lib', 'PDFJS-VERSION.txt'), 'PDF.js ' + v + ' (Mozilla, licenza Apache 2.0)\n');
  pdf = true;
} else {
  fs.writeFileSync(path.join(OUT, 'lib', 'METTI-QUI-PDFJS.txt'),
    'Per leggere i PDF servono due file di PDF.js (Mozilla).\n\n' +
    '1. Vai su https://github.com/mozilla/pdf.js/releases/latest\n' +
    '2. Scarica pdfjs-...-dist.zip (NON quello "legacy").\n' +
    '3. Dalla cartella "build" dello zip copia qui pdf.mjs e pdf.worker.mjs.\n' +
    '4. In chrome://extensions premi la freccia circolare di Word Crawler.\n\n' +
    'Oppure, nella cartella del progetto: npm install, poi npm run build:extension.\n');
}

// Tesseract (OCR): libreria, worker e motore WebAssembly (solo le versioni LSTM, le uniche usate)
const tjs = path.join(ROOT, 'node_modules', 'tesseract.js', 'dist');
const tcore = path.join(ROOT, 'node_modules', 'tesseract.js-core');
let ocr = false;
if (fs.existsSync(path.join(tjs, 'tesseract.min.js')) && fs.existsSync(tcore)) {
  const dest = path.join(OUT, 'lib', 'tesseract');
  fs.mkdirSync(path.join(dest, 'core'), { recursive: true });
  ['tesseract.min.js', 'worker.min.js'].forEach((f) => fs.copyFileSync(path.join(tjs, f), path.join(dest, f)));
  fs.readdirSync(tcore).filter((f) => /^tesseract-core.*lstm\.wasm(\.js)?$/.test(f)).forEach((f) => fs.copyFileSync(path.join(tcore, f), path.join(dest, 'core', f)));
  const tv = JSON.parse(fs.readFileSync(path.join(tjs, '..', 'package.json'), 'utf8')).version;
  fs.writeFileSync(path.join(dest, 'TESSERACT-VERSION.txt'), 'tesseract.js ' + tv + ' (Apache 2.0). I dati delle lingue si scaricano al primo uso da cdn.jsdelivr.net.\n');
  ocr = true;
}

const zipFile = path.join(DIST, 'word-crawler-extension.zip');
const n = zipDir(OUT, zipFile, 'word-crawler-extension');
console.log('Estensione pronta: ' + path.relative(ROOT, OUT) + ' (' + n + ' file) e ' + path.relative(ROOT, zipFile));
console.log(pdf ? 'PDF.js incluso.' : 'ATTENZIONE: PDF.js non trovato (esegui "npm install"): l’estensione funziona, ma per i PDF va aggiunto a mano.');
console.log(ocr ? 'Tesseract (OCR) incluso.' : 'ATTENZIONE: Tesseract non trovato (esegui "npm install"): l’estensione funziona, ma senza OCR.');
