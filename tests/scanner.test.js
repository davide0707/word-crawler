/*
 * Test dello scanner del disco (Node, senza Electron). Uso: node tests/scanner.test.js
 * Crea una cartella di prova con casi difficili e verifica il rapporto.
 * Controlla anche che nessun file venga modificato (date e contenuti identici prima e dopo).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { scan } = require('../desktop/scanner');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-scan-'));
function w(rel, content) { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; }

// --- albero di prova
const dupA = crypto.randomBytes(5000);
w('foto/vacanze/mare.jpg', dupA);
w('foto/copia di mare.jpg', dupA);
w('backup/mare (1).jpg', dupA);                     // 3 copie identiche: 2 sprecate
w('documenti/tesi.docx', crypto.randomBytes(5000)); // stessa dimensione, contenuto diverso: NON duplicato
const big = crypto.randomBytes(400000);
w('video/clip.mp4', big);
const bigTwin = Buffer.from(big); bigTwin[200000] ^= 0xff; // uguale all'inizio e alla fine, diverso in mezzo
w('video/clip-modificata.mp4', bigTwin);
w('documenti/note.txt', 'ciao');
w('documenti/vuoto.txt', '');
fs.mkdirSync(path.join(ROOT, 'cartella vuota'));
w('a/b/c/d/e/f/g/profondo.md', '# profondo');
w('progetto/node_modules/lib/index.js', 'x');       // escluso
w('.config/nascosto.ini', 'segreto');               // nascosto
w('documenti/README.md', 'uno');
w('progetto/README.md', 'due');                     // nome ripetuto
let longRel = 'lungo';
while (longRel.length < 280) longRel += '/cartella-con-nome-lungo';
w(longRel + '/file.txt', 'lungo');
try { fs.symlinkSync(ROOT, path.join(ROOT, 'giro-infinito')); } catch (e) { /* senza permessi: salta */ }
let hardOk = true;
try { fs.linkSync(path.join(ROOT, 'documenti/note.txt'), path.join(ROOT, 'backup/note-link.txt')); } catch (e) { hardOk = false; }

function snapshot(dir) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(p);
      else { const st = fs.statSync(p); out[p] = st.mtimeMs + ':' + st.size + ':' + crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }
    }
  })(dir);
  return out;
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

(async () => {
  const before = snapshot(ROOT);
  const events = [];
  const csvPath = path.join(os.tmpdir(), 'wc-scan-test.csv');
  const rFast = await scan({ root: ROOT, legs: 6, duplicates: 'fast', minDupSize: 1, csvPath, excludes: ['node_modules'] }, (m) => events.push(m));
  const rFull = await scan({ root: ROOT, legs: 1, duplicates: 'full', minDupSize: 1, excludes: ['node_modules'] });
  const rHidden = await scan({ root: ROOT, legs: 3, duplicates: 'off', includeHidden: true, excludes: [] });

  await check('nessun file è stato modificato dalla scansione', () => {
    assert.deepStrictEqual(snapshot(ROOT), before);
  });
  await check('conteggi di file e cartelle', () => {
    const expectedFiles = 12; // l'hard link è lo stesso file: contato una volta
    assert.strictEqual(rFast.totals.files, expectedFiles, 'file: ' + rFast.totals.files);
    if (hardOk) assert.strictEqual(rFast.totals.hardlinks, 1);
    assert.strictEqual(rFast.totals.excluded, 1);
    assert.strictEqual(rFast.totals.hidden, 1);
  });
  await check('i collegamenti simbolici non vengono seguiti (niente giri infiniti)', () => {
    assert.ok(rFast.totals.symlinks >= 1);
  });
  await check('spazio totale uguale alla somma dei file', () => {
    const sum = Object.keys(before).filter((p) => !p.includes('node_modules') && !p.includes(path.sep + '.config') && !p.endsWith('note-link.txt')).reduce((s, p) => s + fs.statSync(p).size, 0);
    assert.strictEqual(rFast.totals.bytes, sum);
  });
  await check('duplicati: le 3 copie della foto, non il file con la stessa dimensione', () => {
    const g = rFull.duplicates.groups.find((x) => x.size === 5000);
    assert.ok(g, 'gruppo da 5000 byte assente');
    assert.strictEqual(g.count, 3);
    assert.strictEqual(g.wasted, 10000);
    assert.ok(!g.paths.some((p) => p.endsWith('tesi.docx')));
  });
  await check('controllo veloce vs completo: file diversi solo in mezzo', () => {
    const fast = rFast.duplicates.groups.find((x) => x.size === 400000);
    const full = rFull.duplicates.groups.find((x) => x.size === 400000);
    assert.ok(fast && fast.exact === false, 'il controllo veloce li segnala come "molto probabili"');
    assert.ok(!full, 'il controllo completo li riconosce come diversi');
  });
  await check('file e cartelle vuoti', () => {
    assert.strictEqual(rFast.emptyFiles.count, 1);
    assert.ok(rFast.emptyDirs.paths.some((p) => p.endsWith('cartella vuota')));
  });
  await check('nomi ripetuti', () => {
    const n = rFast.sameNames.find((x) => x.name.toLowerCase() === 'readme.md');
    assert.ok(n && n.count === 2);
  });
  await check('percorsi oltre 260 caratteri', () => {
    assert.strictEqual(rFast.longPaths.count, 1);
  });
  await check('estensioni e categorie', () => {
    const jpg = rFast.byExt.find((e) => e.ext === 'jpg');
    assert.strictEqual(jpg.count, 3);
    assert.ok(rFast.byCategory.find((c) => c.category === 'Immagini').bytes === 15000);
    assert.ok(rFast.byCategory.find((c) => c.category === 'Video'));
  });
  await check('cartelle più grandi: dimensione totale con le sottocartelle', () => {
    const video = rFast.largestDirs.find((d) => d.path.endsWith(path.sep + 'video'));
    assert.strictEqual(video.total, 800000);
  });
  await check('con i nascosti inclusi il file nascosto viene contato', () => {
    assert.strictEqual(rHidden.totals.hidden, 0);
    assert.ok(rHidden.byExt.find((e) => e.ext === 'ini'));
  });
  await check('elenco CSV completo', () => {
    const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length - 1, rFast.totals.files);
    assert.ok(/percorso;nome;estensione/.test(lines[0]));
  });
  await check('eventi di avanzamento per la mappa animata', () => {
    assert.ok(events.some((e) => e.type === 'progress' && e.newDirs && e.newDirs.length));
    assert.ok(events.some((e) => e.type === 'phase' && e.phase === 'hash'));
  });
  await check('interruzione: rapporto parziale', async () => {
    let n = 0;
    const r = await scan({ root: ROOT, legs: 2, duplicates: 'off' }, () => {}, () => ++n > 3);
    assert.strictEqual(r.partial, true);
  });
  await check('albero delle cartelle per la mappa: totali coerenti', () => {
    const t = rFast.tree;
    assert.strictEqual(t.names[0], rFast.root);
    assert.strictEqual(t.total[0], rFast.totals.bytes);
    for (let i = 1; i < t.names.length; i++) assert.ok(t.parent[i] >= 0 && t.parent[i] < i, 'genitore dopo il figlio');
    // il totale di ogni cartella = file suoi + sottocartelle (quelle sotto soglia restano nel totale)
    const kids = t.names.map(() => 0);
    for (let i = 1; i < t.names.length; i++) kids[t.parent[i]] += t.total[i];
    t.names.forEach((n, i) => assert.ok(t.own[i] + kids[i] <= t.total[i], n));
    const v = t.names.indexOf('video');
    assert.ok(v > 0 && t.total[v] === 800000);
  });
  await check('mappa a riquadri: i riquadri riempiono lo spazio in proporzione', () => {
    require('../desktop/ui/scan-report.js');
    const R = globalThis.WCScanReport;
    const items = [6, 6, 4, 3, 2, 2, 1].map((v) => ({ value: v }));
    const rs = R.squarify(items, 0, 0, 600, 400);
    assert.strictEqual(rs.length, 7);
    const area = rs.reduce((s, r) => s + r.w * r.h, 0);
    assert.ok(Math.abs(area - 240000) < 1e-6);
    rs.forEach((r) => {
      assert.ok(Math.abs(r.w * r.h - r.it.value * 10000) < 1e-6, 'area non proporzionale');
      assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 600 + 1e-6 && r.y + r.h <= 400 + 1e-6, 'fuori dal riquadro');
    });
    // esempio dell'articolo di Bruls e colleghi: il primo riquadro è 300×200
    assert.deepStrictEqual([rs[0].w, rs[0].h], [300, 200]);
    assert.strictEqual(R.treePath({ names: ['C:\\', 'Utenti', 'anna'], parent: [-1, 0, 1] }, 2), 'C:\\Utenti\\anna');
  });
  await check('lettura dell’elenco CSV (virgolette e punti e virgola nei nomi)', () => {
    const { parseCsvLine } = require('../desktop/scan-tools');
    assert.deepStrictEqual(parseCsvLine('"/a/b;c.txt";"b;c.txt";txt;Documenti;12;2026-01-01 10:00:00;'), ['/a/b;c.txt', 'b;c.txt', 'txt', 'Documenti', '12', '2026-01-01 10:00:00', '']);
    assert.deepStrictEqual(parseCsvLine('"/x/il ""vero"".md";x;md;Codice;3;;'), ['/x/il "vero".md', 'x', 'md', 'Codice', '3', '', '']);
  });
  await check('cartella inesistente: errore chiaro', async () => {
    await assert.rejects(() => scan({ root: path.join(ROOT, 'non-esiste') }), /ENOENT|non è una cartella/);
  });

  // prestazioni su una cartella vera e grande, se disponibile
  const big = process.argv[2];
  if (big) {
    const t0 = Date.now();
    const r = await scan({ root: big, legs: 8, duplicates: 'fast', minDupSize: 1024 });
    console.log('     ' + big + ': ' + r.totals.files.toLocaleString('it-IT') + ' file, ' + r.totals.dirs.toLocaleString('it-IT') + ' cartelle, ' + (r.totals.bytes / 1e9).toFixed(2) + ' GB in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s; duplicati: ' + r.duplicates.totalGroups + ' gruppi');
  }

  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.rmSync(csvPath, { force: true });
  console.log(failures ? '\n' + failures + ' test falliti' : '\nTutti i test superati');
  process.exit(failures ? 1 : 0);
})();
