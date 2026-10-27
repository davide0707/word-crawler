/*
 * Word Crawler: scansione del disco IN SOLA LETTURA.
 *
 * Usa soltanto: opendir (elenco cartelle), lstat (dimensione e date), open in lettura + read (per
 * riconoscere i duplicati). Non scrive, non sposta, non cancella e non rinomina nulla nella cartella
 * analizzata. Non segue i collegamenti simbolici né le giunzioni di Windows (niente cicli infiniti).
 *
 * scan(options, emit, isCancelled) -> Promise<report>
 *   options: {
 *     root,                  cartella o disco da analizzare (es. "C:\\" o "/home/angelica")
 *     legs: 1..16,           zampe = cartelle lette in parallelo (più zampe = più veloce su SSD)
 *     sameDevice: true,      non entrare in altri dischi o punti di montaggio
 *     includeHidden: false,  includere file e cartelle nascosti
 *     excludes: [..],        nomi di cartelle da saltare (es. node_modules, .git)
 *     duplicates: 'off'|'fast'|'full',
 *     minDupSize: byte,      sotto questa dimensione i duplicati non vengono cercati
 *     csvPath: percorso,     facoltativo: dove scrivere l'elenco completo dei file (nella cartella dell'app)
 *     visDepth: 1..8         profondità delle cartelle mandate alla mappa animata
 *   }
 *   emit(message): riceve { type: 'progress' | 'phase' | 'hash' }
 */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const CATEGORIES = {
  'Documenti': 'pdf doc docx docm dot dotx odt ott rtf txt md markdown tex pages epub mobi azw azw3 djvu xps oxps wpd',
  'Fogli e presentazioni': 'xls xlsx xlsm xlsb ods csv tsv ppt pptx pptm pps ppsx odp key numbers',
  'Immagini': 'jpg jpeg png gif bmp tif tiff webp heic heif avif raw cr2 cr3 nef arw dng orf rw2 svg ico psd ai eps indd xcf',
  'Video': 'mp4 mkv mov avi wmv flv webm m4v mpg mpeg 3gp ts mts m2ts vob',
  'Audio': 'mp3 wav flac aac ogg oga m4a wma opus aiff aif mid midi amr',
  'Archivi e immagini disco': 'zip rar 7z tar gz tgz bz2 xz zst iso img dmg cab lz lzma',
  'Programmi e librerie': 'exe msi dll sys app apk aab deb rpm so dylib bin com bat cmd ps1 sh appimage msix appx jar pkg drv ocx cpl efi',
  'Codice': 'js mjs cjs ts tsx jsx py pyc java class c cc cpp h hpp cs go rs rb php html htm css scss sass less json xml yml yaml toml ini sql ipynb swift kt kts lua pl r m vue svelte dart gradle cmake mk',
  'Font': 'ttf otf woff woff2 fon eot',
  'Dati, database e log': 'db sqlite sqlite3 mdb accdb sav dat bak log tmp cache pak idx dmp etl evtx',
  'Email e contatti': 'eml msg pst ost mbox vcf ics'
};
const EXT_CAT = new Map();
Object.keys(CATEGORIES).forEach((c) => CATEGORIES[c].split(' ').forEach((e) => EXT_CAT.set(e, c)));

const DEFAULT_EXCLUDES = ['$Recycle.Bin', 'System Volume Information', '.Trash', '.Trashes', '.Spotlight-V100', '.fseventsd', 'proc', 'sys', 'dev'];

function extOf(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  const e = name.slice(i + 1).toLowerCase();
  return e.length > 12 || /[^a-z0-9_+-]/.test(e) ? '' : e;
}
function categoryOf(ext) { return EXT_CAT.get(ext) || (ext ? 'Altro' : 'Senza estensione'); }
function isHiddenName(name) { return name.charAt(0) === '.'; }

// Classifica limitata: tiene solo i migliori N secondo "better(a, b)"
class Top {
  constructor(n, better) { this.n = n; this.better = better; this.items = []; }
  add(x) {
    const it = this.items;
    if (it.length < this.n) { it.push(x); if (it.length === this.n) it.sort((a, b) => (this.better(a, b) ? -1 : 1)); return; }
    if (!this.better(x, it[it.length - 1])) return;
    let lo = 0, hi = it.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.better(x, it[mid])) hi = mid; else lo = mid + 1; }
    it.splice(lo, 0, x);
    it.pop();
  }
  list() { return this.items.slice().sort((a, b) => (this.better(a, b) ? -1 : 1)); }
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function isoDate(ms) { return ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : ''; }

async function hashFile(file, mode, size) {
  // mode 'fast': inizio + fine del file (64 KB ciascuno); 'full': tutto il file
  const h = crypto.createHash(mode === 'full' ? 'sha256' : 'sha1');
  const fh = await fsp.open(file, 'r');
  try {
    if (mode === 'full' || size <= 131072) {
      const buf = Buffer.allocUnsafe(1 << 20);
      let pos = 0;
      for (;;) {
        const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
        if (!bytesRead) break;
        h.update(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
        pos += bytesRead;
      }
    } else {
      const a = Buffer.allocUnsafe(65536);
      const r1 = await fh.read(a, 0, 65536, 0);
      h.update(a.subarray(0, r1.bytesRead));
      const r2 = await fh.read(a, 0, 65536, Math.max(0, size - 65536));
      h.update(a.subarray(0, r2.bytesRead));
      h.update(String(size));
    }
  } finally { await fh.close(); }
  return h.digest('hex');
}

async function scan(options, emit, isCancelled) {
  emit = emit || (() => {});
  isCancelled = isCancelled || (() => false);
  const o = Object.assign({ legs: 8, sameDevice: true, includeHidden: false, excludes: DEFAULT_EXCLUDES, duplicates: 'fast', minDupSize: 1024, visDepth: 5 }, options || {});
  o.legs = Math.max(1, Math.min(16, Math.round(o.legs)));
  const root = path.resolve(o.root);
  const excludes = new Set((o.excludes || []).map((x) => String(x).toLowerCase()));
  const started = Date.now();

  const rootStat = await fsp.stat(root);
  if (!rootStat.isDirectory()) throw new Error('Il percorso non è una cartella: ' + root);

  const totals = { files: 0, dirs: 0, bytes: 0, errors: 0, symlinks: 0, hidden: 0, excluded: 0, otherDevice: 0, special: 0, hardlinks: 0 };
  const byExt = new Map();
  const byCat = new Map();
  const largest = new Top(200, (a, b) => a.size > b.size);
  const oldest = new Top(20, (a, b) => a.mtime < b.mtime);
  const newest = new Top(20, (a, b) => a.mtime > b.mtime);
  const sizeBuckets = new Map();
  const names = new Map();
  const emptyFiles = [];
  let emptyFilesCount = 0;
  const longPaths = [];
  let longCount = 0;
  const errors = [];
  const seenInodes = new Set();
  let dupDisabled = o.duplicates === 'off';
  let csv = null, csvRows = 0;
  if (o.csvPath) {
    csv = fs.createWriteStream(o.csvPath, { encoding: 'utf8' });
    csv.write('\ufeff' + ['percorso', 'nome', 'estensione', 'categoria', 'byte', 'modificato', 'creato'].join(';') + '\n');
  }

  // cartelle: record compatti, il padre è l'indice nell'array
  const dirs = [];
  function newDir(parent, p, name, depth) {
    const d = { id: dirs.length, parent: parent ? parent.id : -1, path: p, name: name, depth: depth, size: 0, files: 0, subdirs: 0, total: 0, vis: -1 };
    d.vis = depth <= o.visDepth && dirs.length < 25000 ? d.id : (parent ? parent.vis : 0);
    dirs.push(d);
    return d;
  }
  const visQueue = [];
  const rootDir = newDir(null, root, root, 0);
  visQueue.push({ id: 0, parent: -1, name: root, depth: 0 });

  function recordError(p, e) {
    totals.errors++;
    if (errors.length < 500) errors.push({ path: p, code: e && e.code ? e.code : 'ERRORE', message: e && e.message ? String(e.message).slice(0, 160) : '' });
  }

  function addFile(dir, full, name, st) {
    if (st.nlink > 1) {
      const key = st.dev + ':' + st.ino;
      if (seenInodes.has(key)) { totals.hardlinks++; return; } // stesso file già contato (hard link)
      seenInodes.add(key);
    }
    const size = st.size;
    const ext = extOf(name);
    const cat = categoryOf(ext);
    totals.files++;
    totals.bytes += size;
    dir.size += size;
    dir.files++;
    let e = byExt.get(ext);
    if (!e) { e = { ext: ext, count: 0, bytes: 0 }; byExt.set(ext, e); }
    e.count++; e.bytes += size;
    let c = byCat.get(cat);
    if (!c) { c = { category: cat, count: 0, bytes: 0 }; byCat.set(cat, c); }
    c.count++; c.bytes += size;
    const mtime = st.mtimeMs;
    largest.add({ path: full, size: size, mtime: mtime });
    if (mtime > 0) { oldest.add({ path: full, mtime: mtime }); newest.add({ path: full, mtime: mtime }); }
    if (size === 0) { emptyFilesCount++; if (emptyFiles.length < 500) emptyFiles.push(full); }
    if (full.length > 260) { longCount++; if (longPaths.length < 200) longPaths.push(full); }
    const lname = name.toLowerCase();
    let nm = names.get(lname);
    if (!nm) { nm = { name: name, count: 0, bytes: 0, paths: [] }; names.set(lname, nm); }
    nm.count++; nm.bytes += size;
    if (nm.paths.length < 3) nm.paths.push(full);
    if (!dupDisabled && size >= o.minDupSize) {
      let b = sizeBuckets.get(size);
      if (!b) { b = []; sizeBuckets.set(size, b); }
      b.push(full);
      if (totals.files > 3000000) { dupDisabled = true; sizeBuckets.clear(); }
    }
    if (csv) {
      csvRows++;
      const ok = csv.write([full, name, ext, cat, size, isoDate(mtime), isoDate(st.birthtimeMs)].map(csvCell).join(';') + '\n');
      if (!ok) return new Promise((r) => csv.once('drain', r));
    }
    return null;
  }

  // ---------------------------------------------------------------- fase 1: esplorazione
  emit({ type: 'phase', phase: 'walk', root: root, legs: o.legs });
  const queue = [rootDir];
  let qHead = 0;
  const active = new Array(o.legs).fill(null);
  let busy = 0;
  const waiters = [];
  function notify() { while (waiters.length) waiters.shift()(); }

  async function readDir(d) {
    let dh;
    try { dh = await fsp.opendir(d.path, { bufferSize: 128 }); }
    catch (e) { recordError(d.path, e); return; }
    const files = [];
    try {
      for await (const ent of dh) {
        if (isCancelled()) break;
        const name = ent.name;
        const full = path.join(d.path, name);
        if (!o.includeHidden && isHiddenName(name)) { totals.hidden++; continue; }
        if (ent.isSymbolicLink()) { totals.symlinks++; continue; }
        if (ent.isDirectory()) {
          if (excludes.has(name.toLowerCase())) { totals.excluded++; continue; }
          files.push({ dir: true, name: name, full: full });
        } else if (ent.isFile()) files.push({ dir: false, name: name, full: full });
        else totals.special++;
      }
    } catch (e) { recordError(d.path, e); }
    // lstat in piccoli gruppi paralleli
    for (let i = 0; i < files.length && !isCancelled(); i += 64) {
      const chunk = files.slice(i, i + 64);
      const stats = await Promise.all(chunk.map((f) => fsp.lstat(f.full).then((s) => s, (e) => { recordError(f.full, e); return null; })));
      for (let k = 0; k < chunk.length; k++) {
        const f = chunk[k], st = stats[k];
        if (!st) continue;
        if (f.dir) {
          if (o.sameDevice && st.dev !== rootStat.dev) { totals.otherDevice++; continue; }
          const child = newDir(d, f.full, f.name, d.depth + 1);
          d.subdirs++;
          totals.dirs++;
          queue.push(child);
          if (child.vis === child.id) visQueue.push({ id: child.id, parent: d.vis, name: f.name, depth: child.depth });
        } else {
          const wait = addFile(d, f.full, f.name, st);
          if (wait) await wait;
        }
      }
      notify();
    }
  }

  let lastEmit = 0;
  function progress(force) {
    const now = Date.now();
    if (!force && now - lastEmit < 120) return;
    lastEmit = now;
    emit({
      type: 'progress',
      totals: Object.assign({}, totals),
      queued: queue.length - qHead,
      elapsedMs: now - started,
      active: active.map((d) => (d ? { vis: d.vis, path: d.path } : null)),
      newDirs: visQueue.splice(0, visQueue.length)
    });
  }

  async function leg(i) {
    for (;;) {
      if (isCancelled()) return;
      if (qHead < queue.length) {
        const d = queue[qHead++];
        if (qHead > 50000 && qHead > queue.length / 2) { queue.splice(0, qHead); qHead = 0; }
        busy++; active[i] = d;
        await readDir(d);
        busy--; active[i] = null;
        progress(false);
        notify();
        continue;
      }
      if (busy === 0) { notify(); return; }
      await new Promise((r) => { waiters.push(r); setTimeout(r, 50); });
    }
  }
  const ticker = setInterval(() => progress(false), 150);
  await Promise.all(active.map((_, i) => leg(i)));
  clearInterval(ticker);
  progress(true);
  if (csv) await new Promise((r) => csv.end(r));

  // dimensione totale delle cartelle (dai figli verso il padre)
  for (let i = dirs.length - 1; i >= 0; i--) {
    const d = dirs[i];
    d.total += d.size;
    if (d.parent >= 0) dirs[d.parent].total += d.total;
  }
  // albero delle cartelle per la mappa a riquadri e per il confronto tra scansioni:
  // solo le cartelle che pesano almeno 1/50.000 del totale (al massimo 40.000), i genitori prima dei figli
  const tree = { names: [], parent: [], total: [], own: [], files: [] };
  const minTree = Math.max(1, rootDir.total / 50000);
  const treeIdx = new Int32Array(dirs.length).fill(-1);
  for (let i = 0; i < dirs.length && tree.names.length < 40000; i++) {
    const d = dirs[i];
    if (i > 0 && (d.total < minTree || d.depth > 12 || treeIdx[d.parent] < 0)) continue;
    treeIdx[i] = tree.names.length;
    tree.names.push(i === 0 ? root : d.name);
    tree.parent.push(i === 0 ? -1 : treeIdx[d.parent]);
    tree.total.push(d.total);
    tree.own.push(d.size);
    tree.files.push(d.files);
  }
  const largestDirs = new Top(100, (a, b) => a.total > b.total);
  const emptyDirs = [];
  let emptyDirsCount = 0;
  for (let i = 1; i < dirs.length; i++) {
    const d = dirs[i];
    largestDirs.add({ path: d.path, total: d.total, files: d.files });
    if (d.files === 0 && d.subdirs === 0) { emptyDirsCount++; if (emptyDirs.length < 500) emptyDirs.push(d.path); }
  }

  // ---------------------------------------------------------------- fase 2: duplicati
  let dup = { method: o.duplicates, groups: [], totalGroups: 0, wastedBytes: 0, filesChecked: 0, skipped: dupDisabled && o.duplicates !== 'off' };
  if (!dupDisabled && !isCancelled()) {
    const cands = [];
    let bytesTotal = 0;
    sizeBuckets.forEach((list, size) => { if (list.length > 1) { cands.push([size, list]); bytesTotal += size * list.length; } });
    sizeBuckets.clear();
    cands.sort((a, b) => b[0] - a[0]);
    const nFiles = cands.reduce((s, c) => s + c[1].length, 0);
    emit({ type: 'phase', phase: 'hash', files: nFiles, bytes: bytesTotal });
    let doneFiles = 0, doneBytes = 0, lastH = 0, totalTasks = nFiles;
    const groups = [];
    // una sola coda di lavoro per tutti i file: ogni zampa prende il prossimo file libero
    async function hashAll(tasks, mode) {
      const out = new Map(); // "dimensione:impronta" -> [percorsi]
      let idx = 0;
      async function worker() {
        while (idx < tasks.length && !isCancelled()) {
          const tk = tasks[idx++];
          try {
            const h = await hashFile(tk.path, mode, tk.size);
            const key = tk.size + ':' + h;
            if (!out.has(key)) out.set(key, []);
            out.get(key).push(tk.path);
          } catch (e) { recordError(tk.path, e); }
          doneFiles++; doneBytes += mode === 'full' || tk.size <= 131072 ? tk.size : 131072;
          const now = Date.now();
          if (now - lastH > 150) { lastH = now; emit({ type: 'hash', done: doneFiles, total: totalTasks, bytes: doneBytes, path: tk.path }); }
        }
      }
      await Promise.all(new Array(Math.max(1, Math.min(o.legs, tasks.length))).fill(0).map(worker));
      return out;
    }
    const tasks = [];
    cands.forEach(([size, list]) => list.forEach((p) => tasks.push({ path: p, size: size })));
    const first = await hashAll(tasks, 'fast');
    const second = [];
    first.forEach((same, key) => {
      if (same.length < 2) return;
      const size = +key.split(':')[0];
      if (o.duplicates === 'full' && size > 131072) same.forEach((p) => second.push({ path: p, size: size }));
      else groups.push({ size: size, hash: key.split(':')[1], paths: same, exact: size <= 131072 });
    });
    if (second.length && !isCancelled()) {
      totalTasks += second.length;
      const full = await hashAll(second, 'full');
      full.forEach((same, key) => { if (same.length > 1) groups.push({ size: +key.split(':')[0], hash: key.split(':')[1], paths: same, exact: true }); });
    }
    dup.filesChecked = doneFiles;
    groups.forEach((gr) => { gr.count = gr.paths.length; gr.wasted = gr.size * (gr.count - 1); dup.wastedBytes += gr.wasted; });
    groups.sort((a, b) => b.wasted - a.wasted);
    dup.totalGroups = groups.length;
    dup.groups = groups.slice(0, 500).map((gr) => ({ size: gr.size, count: gr.count, wasted: gr.wasted, exact: gr.exact, hash: gr.hash.slice(0, 16), paths: gr.paths.slice(0, 50) }));
  }

  emit({ type: 'phase', phase: 'report' });
  const sameNames = Array.from(names.values()).filter((n) => n.count > 1).sort((a, b) => b.count - a.count || b.bytes - a.bytes).slice(0, 200);
  const report = {
    version: 2,
    root: root,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    partial: isCancelled(),
    options: { legs: o.legs, sameDevice: o.sameDevice, includeHidden: o.includeHidden, excludes: Array.from(excludes), duplicates: o.duplicates, minDupSize: o.minDupSize },
    platform: process.platform,
    totals: totals,
    byExt: Array.from(byExt.values()).sort((a, b) => b.bytes - a.bytes),
    byCategory: Array.from(byCat.values()).sort((a, b) => b.bytes - a.bytes),
    largestFiles: largest.list(),
    largestDirs: largestDirs.list(),
    duplicates: dup,
    sameNames: sameNames,
    emptyFiles: { count: emptyFilesCount, paths: emptyFiles },
    emptyDirs: { count: emptyDirsCount, paths: emptyDirs },
    oldest: oldest.list(),
    newest: newest.list(),
    longPaths: { count: longCount, paths: longPaths },
    errors: errors,
    tree: tree,
    csvPath: o.csvPath || null,
    csvRows: csvRows
  };
  return report;
}

module.exports = { scan, hashFile, extOf, categoryOf, CATEGORIES, DEFAULT_EXCLUDES };
