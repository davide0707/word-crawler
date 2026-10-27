// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Controlli del progetto, senza dipendenze esterne (npm run lint):
 *  - sintassi di ogni file JavaScript (node --check);
 *  - fine riga LF, niente spazi a fine riga, a capo finale;
 *  - intestazione di copyright nei file sorgente;
 *  - file JSON validi e stessa versione in package.json e nel manifest dell'estensione;
 *  - nessun file di prova mancante tra quelli usati dai test;
 *  - nei file Markdown, nessun collegamento o immagine verso file del progetto che non esistono.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIRS = ['core', 'desktop', 'extension', 'scripts', 'tests', 'docs', '.github'];
const SKIP = /(^|\/)(node_modules|dist|screenshots|fixtures|freq|images)(\/|$)/;
const HEADER = 'Copyright (c) 2026 Davide Di Filippo';
const problems = [];

function walk(dir, out) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (SKIP.test(rel)) continue;
    if (e.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const files = DIRS.flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? walk(d, []) : []))
  .concat(['package.json', 'README.md', 'README.it.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md',
    'LICENSE', 'THIRD-PARTY.md'].filter((f) => fs.existsSync(path.join(ROOT, f))));

let checked = 0;
for (const rel of files) {
  const full = path.join(ROOT, rel);
  const ext = path.extname(rel);
  if (!/^\.(js|mjs|css|html|json|md|yml|yaml|py|txt)$/.test(ext) && path.basename(rel) !== 'LICENSE') continue;
  const text = fs.readFileSync(full, 'utf8');
  checked++;
  if (/\r\n/.test(text)) problems.push(rel + ': fine riga CRLF (usare LF)');
  if (text.length && !text.endsWith('\n')) problems.push(rel + ': manca l’a capo finale');
  text.split('\n').forEach((line, i) => { if (/[ \t]+$/.test(line) && ext !== '.md') problems.push(rel + ':' + (i + 1) + ': spazi a fine riga'); });
  if (/^\.(js|mjs|css|py)$/.test(ext) && !text.slice(0, 200).includes(HEADER)) problems.push(rel + ': manca l’intestazione di copyright');
  if (ext === '.md') {
    // collegamenti relativi: [testo](percorso) e src="percorso"; si ignorano indirizzi web e ancore
    const links = [...text.matchAll(/\]\(([^)\s]+)\)|src="([^"]+)"/g)].map((m) => m[1] || m[2]);
    links.filter((l) => !/^([a-z]+:|#|mailto:)/i.test(l)).forEach((l) => {
      const target = path.join(path.dirname(full), decodeURIComponent(l.split('#')[0]));
      if (!fs.existsSync(target)) problems.push(rel + ': collegamento a un file inesistente (' + l + ')');
    });
  }
  if (ext === '.json') { try { JSON.parse(text); } catch (e) { problems.push(rel + ': JSON non valido (' + e.message + ')'); } }
  if (ext === '.js' || ext === '.mjs') {
    try { execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' }); }
    catch (e) { problems.push(rel + ': errore di sintassi\n' + String(e.stderr || e.message).split('\n').slice(0, 5).join('\n')); }
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
if (pkg.version !== man.version) problems.push('versioni diverse: package.json ' + pkg.version + ', manifest ' + man.version);
const changelog = path.join(ROOT, 'CHANGELOG.md');
if (fs.existsSync(changelog) && !fs.readFileSync(changelog, 'utf8').includes('## [' + pkg.version + ']')) problems.push('CHANGELOG.md: manca la versione ' + pkg.version);

// file di prova citati nei test
const testText = files.filter((f) => /^tests\/.*\.(js|mjs|html)$/.test(f)).map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const fixtures = new Set((testText.match(/fixtures[/'", ]+[\w.-]+\.(?:txt|pdf|docx?|png|tsv|odt|rtf|epub|md|srt|csv|html|pptx|xlsx|odp|ods)/g) || [])
  .map((m) => m.replace(/^fixtures[/'", ]+/, '')).filter((m) => !/-N\./.test(m))); // scan-N.tsv: segnaposto nei commenti
fixtures.forEach((f) => { if (!fs.existsSync(path.join(ROOT, 'tests', 'fixtures', f))) problems.push('tests/fixtures/' + f + ': file di prova mancante'); });

if (problems.length) {
  console.log(problems.join('\n'));
  console.log('\n' + problems.length + ' problemi in ' + checked + ' file');
  process.exit(1);
}
console.log('Controlli superati: ' + checked + ' file, versione ' + pkg.version + '.');
