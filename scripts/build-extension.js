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
const CORE = ['settings.js', 'text.js', 'analysis.js', 'zip.js', 'cfb.js', 'formats.js', 'dom.js', 'pdfcore.js', 'crawler.js', 'export.js',
  'settings-ui.js', 'results-ui.js', 'reader.js', 'archive-ui.js', 'reader.css'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'core'), { recursive: true });
fs.cpSync(path.join(ROOT, 'extension'), OUT, { recursive: true });
CORE.forEach((f) => fs.copyFileSync(path.join(ROOT, 'core', f), path.join(OUT, 'core', f)));
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

const zipFile = path.join(DIST, 'word-crawler-extension.zip');
const n = zipDir(OUT, zipFile, 'word-crawler-extension');
console.log('Estensione pronta: ' + path.relative(ROOT, OUT) + ' (' + n + ' file) e ' + path.relative(ROOT, zipFile));
console.log(pdf ? 'PDF.js incluso.' : 'ATTENZIONE: PDF.js non trovato (esegui "npm install"): l’estensione funziona, ma per i PDF va aggiunto a mano.');
