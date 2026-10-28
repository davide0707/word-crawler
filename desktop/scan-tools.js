// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: strumenti sul rapporto di scansione (processo principale, Node).
 *
 *  - compareReports / compareCsv: confronto tra due scansioni della stessa cartella
 *    (cartelle cresciute o diminuite; file nuovi, spariti o cambiati se c'è l'elenco CSV).
 *  - planTrash / runTrash: spostare nel Cestino i duplicati scelti dall'utente.
 *
 * La scansione resta in sola lettura (scanner.js). Lo spostamento nel Cestino è un'azione a parte,
 * che parte solo su richiesta e dopo la conferma; prima di spostare qualcosa si controlla che:
 *  - il file faccia parte di un gruppo di duplicati trovato da quella scansione e stia dentro la cartella analizzata;
 *  - in ogni gruppo resti almeno una copia, che esista ancora con la stessa dimensione;
 *  - il file esista ancora, sia un file normale (non un collegamento) con la stessa dimensione;
 *  - il contenuto sia identico byte per byte alla copia che resta (SHA-256 di tutto il file).
 * Ogni spostamento viene scritto in un registro.
 */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');
const { hashFile } = require('./scanner');

// ------------------------------------------------------------------ confronto
function treeMap(report) {
  const t = report && report.tree;
  if (!t || !t.names || !t.names.length) return null;
  const rel = new Array(t.names.length);
  const out = new Map();
  for (let i = 0; i < t.names.length; i++) {
    rel[i] = i === 0 ? '' : (rel[t.parent[i]] ? rel[t.parent[i]] + '/' : '') + t.names[i];
    out.set(rel[i] || '.', { total: t.total[i], files: t.files[i] });
  }
  out.threshold = Math.max(1, t.total[0] / 50000);
  return out;
}

function compareReports(oldR, newR) {
  const tot = (r, k) => (r.totals ? r.totals[k] : 0);
  const res = {
    old: { id: oldR.id, finishedAt: oldR.finishedAt },
    new: { id: newR.id, finishedAt: newR.finishedAt },
    totals: ['files', 'dirs', 'bytes'].map((k) => ({ key: k, before: tot(oldR, k), after: tot(newR, k), delta: tot(newR, k) - tot(oldR, k) })),
    folders: [], categories: [], note: ''
  };
  const a = treeMap(oldR), b = treeMap(newR);
  if (a && b) {
    const keys = new Set([...a.keys(), ...b.keys()]);
    keys.forEach((k) => {
      const x = a.get(k), y = b.get(k);
      // una cartella "compare" o "sparisce" solo se è grande: le piccole possono mancare solo perché sotto soglia
      if (!x && y && y.total < a.threshold * 10) return;
      if (x && !y && x.total < b.threshold * 10) return;
      const before = x ? x.total : 0, after = y ? y.total : 0;
      if (before === after) return;
      res.folders.push({ path: k, before: x ? before : null, after: y ? after : null, delta: after - before });
    });
    res.folders.sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta));
    res.folders = res.folders.slice(0, 300);
  } else res.note = 'Una delle due scansioni è di una versione precedente senza l’albero delle cartelle: il confronto delle cartelle non è disponibile.';
  const cats = new Map();
  (oldR.byCategory || []).forEach((c) => cats.set(c.category, { category: c.category, before: c.bytes, after: 0 }));
  (newR.byCategory || []).forEach((c) => { const e = cats.get(c.category) || { category: c.category, before: 0, after: 0 }; e.after = c.bytes; cats.set(c.category, e); });
  res.categories = Array.from(cats.values()).map((c) => Object.assign(c, { delta: c.after - c.before })).filter((c) => c.delta).sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta));
  return res;
}

// riga CSV con ; come separatore e campi tra virgolette quando serve
function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ';') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}
async function* csvRows(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let first = true, pending = '';
  for await (const raw of rl) {
    let line = pending ? pending + '\n' + raw : raw;
    // un nome di file con un a capo dentro: la riga continua
    if ((line.match(/"/g) || []).length % 2) { pending = line; continue; }
    pending = '';
    if (first) { first = false; line = line.replace(/^﻿/, ''); if (/^percorso;/.test(line)) continue; }
    const c = parseCsvLine(line);
    if (c.length >= 6) yield { path: c[0], name: c[1], ext: c[2], cat: c[3], size: +c[4] || 0, mtime: c[5] };
  }
}

/*
 * Confronto file per file dai due elenchi CSV. Restituisce conteggi, byte e i 300 file più grandi di ogni gruppo.
 * maxRows: oltre questo numero di righe il confronto si salta (memoria).
 */
async function compareCsv(oldCsv, newCsv, maxRows) {
  maxRows = maxRows || 3000000;
  const before = new Map();
  for await (const r of csvRows(oldCsv)) {
    before.set(r.path, r.size + '|' + r.mtime);
    if (before.size > maxRows) return { skipped: 'Troppi file per il confronto uno per uno (oltre ' + maxRows.toLocaleString('it-IT') + ').' };
  }
  const groups = { added: { count: 0, bytes: 0, top: [] }, removed: { count: 0, bytes: 0, top: [] }, changed: { count: 0, bytes: 0, top: [] } };
  function push(g, item, weight) {
    g.count++; g.bytes += weight;
    g.top.push(item);
    if (g.top.length > 600) { g.top.sort((a, b) => Math.abs(b.w) - Math.abs(a.w)); g.top.length = 300; }
  }
  for await (const r of csvRows(newCsv)) {
    const old = before.get(r.path);
    if (old === undefined) push(groups.added, { path: r.path, size: r.size, w: r.size }, r.size);
    else {
      before.delete(r.path);
      const sep = old.indexOf('|');
      const oldSize = +old.slice(0, sep), oldMtime = old.slice(sep + 1);
      if (oldSize !== r.size || oldMtime !== r.mtime) push(groups.changed, { path: r.path, before: oldSize, size: r.size, w: r.size - oldSize }, r.size - oldSize);
    }
  }
  before.forEach((v, p) => { const size = +v.slice(0, v.indexOf('|')); push(groups.removed, { path: p, size: size, w: size }, size); });
  Object.keys(groups).forEach((k) => {
    groups[k].top.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
    groups[k].top = groups[k].top.slice(0, 300).map((x) => { delete x.w; return x; });
  });
  return groups;
}

// ------------------------------------------------------------------ duplicati nel Cestino
function inside(root, p) {
  const r = path.resolve(root), f = path.resolve(p);
  const withSep = r.endsWith(path.sep) ? r : r + path.sep;
  const cmp = process.platform === 'win32' || process.platform === 'darwin' ? (s) => s.toLowerCase() : (s) => s;
  return cmp(f).startsWith(cmp(withSep)) && cmp(f) !== cmp(r);
}

/*
 * items: [{ group: indice in report.duplicates.groups, paths: [percorsi da spostare] }]
 * Restituisce { ok: [{ path, size, keep }], skipped: [{ path, reason }], bytes }
 */
async function planTrash(report, items, onProgress) {
  const groups = (report && report.duplicates && report.duplicates.groups) || [];
  const out = { ok: [], skipped: [], bytes: 0 };
  const list = Array.isArray(items) ? items.slice(0, 1000) : [];
  let done = 0;
  const total = list.reduce((s, it) => s + (Array.isArray(it.paths) ? it.paths.length : 0), 0);
  for (const it of list) {
    const g = groups[it.group];
    const wanted = Array.isArray(it.paths) ? it.paths.map(String) : [];
    if (!g) { wanted.forEach((p) => out.skipped.push({ path: p, reason: 'gruppo non trovato nel rapporto' })); continue; }
    const valid = wanted.filter((p) => {
      if (g.paths.indexOf(p) < 0) { out.skipped.push({ path: p, reason: 'non fa parte di questo gruppo di duplicati' }); return false; }
      if (!inside(report.root, p)) { out.skipped.push({ path: p, reason: 'fuori dalla cartella analizzata' }); return false; }
      return true;
    });
    const keepers = g.paths.filter((p) => valid.indexOf(p) < 0);
    // la copia che resta deve esistere ancora, uguale
    let keep = null;
    for (const k of keepers) {
      const st = await fsp.lstat(k).catch(() => null);
      if (st && st.isFile() && !st.isSymbolicLink() && st.size === g.size) { keep = k; break; }
    }
    if (!keep) { valid.forEach((p) => out.skipped.push({ path: p, reason: 'nessuna copia da tenere è ancora al suo posto: per sicurezza non sposto niente di questo gruppo' })); continue; }
    let keepHash = null;
    for (const p of valid) {
      done++;
      if (onProgress) onProgress({ done: done, total: total, path: p });
      const st = await fsp.lstat(p).catch(() => null);
      if (!st) { out.skipped.push({ path: p, reason: 'il file non esiste più' }); continue; }
      if (!st.isFile() || st.isSymbolicLink()) { out.skipped.push({ path: p, reason: 'non è un file normale' }); continue; }
      if (st.size !== g.size) { out.skipped.push({ path: p, reason: 'la dimensione è cambiata dopo la scansione' }); continue; }
      try {
        if (!keepHash) keepHash = await hashFile(keep, 'full', g.size);
        const h = await hashFile(p, 'full', g.size);
        if (h !== keepHash) { out.skipped.push({ path: p, reason: 'il contenuto non è identico alla copia che resta' }); continue; }
      } catch (e) { out.skipped.push({ path: p, reason: 'non leggibile (' + (e.code || e.message) + ')' }); continue; }
      out.ok.push({ path: p, size: g.size, keep: keep });
      out.bytes += g.size;
    }
  }
  return out;
}

// trashItem(p) -> Promise: di solito shell.trashItem di Electron
async function runTrash(plan, trashItem, logFile) {
  const res = { moved: [], failed: [], bytes: 0 };
  const lines = [];
  for (const it of plan.ok) {
    const when = new Date().toISOString();
    try {
      await trashItem(it.path);
      res.moved.push(it.path);
      res.bytes += it.size;
      lines.push(when + '\tNEL CESTINO\t' + it.size + '\t' + it.path + '\tcopia tenuta: ' + it.keep);
    } catch (e) {
      res.failed.push({ path: it.path, reason: e.message || String(e) });
      lines.push(when + '\tERRORE\t' + it.size + '\t' + it.path + '\t' + (e.message || e));
    }
  }
  plan.skipped.forEach((s) => lines.push(new Date().toISOString() + '\tSALTATO\t\t' + s.path + '\t' + s.reason));
  if (logFile && lines.length) await fsp.appendFile(logFile, lines.join('\n') + '\n', 'utf8');
  return res;
}

/*
 * Cercare sul disco per significato, non solo per nome.
 *
 * Dopo una scansione i file sono decine di migliaia e il nome che ricordi non è quello che hai
 * scritto: cerchi "fattura" e il file si chiama "ricevuta-2024.pdf", cerchi "contratto d'affitto"
 * e si chiama "locazione-firmata.pdf". Qui un percorso diventa le sue parole — cartelle, nome,
 * estensione, maiuscole interne — e le parole vicine si imparano dalla tua stessa alberatura con
 * core/semantic.js: due parole usate nelle stesse cartelle vogliono dire cose vicine.
 *
 * Niente modelli da scaricare: il senso viene da come hai organizzato tu il disco.
 */
require('../core/settings.js'); require('../core/lang.js'); require('../core/text.js');
require('../core/analysis.js'); require('../core/semantic.js');

function wordsOfPath(p) {
  return String(p || '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')          // nomiInCamelCase
    .replace(/[\\/._\-()[\]{}+#@,;'"!&=~]+/g, ' ')  // separatori di ogni specie
    .replace(/\s+/g, ' ').trim();
}

async function findOnDisk(csvPath, query, opts) {
  const o = opts || {};
  const limit = Math.max(1, Math.min(500, o.limit || 60));
  const q = String(query || '').trim();
  if (!q) return { query: q, total: 0, hits: [], semantic: { on: false } };

  const rows = [], MAXF = Math.max(1000, Math.min(400000, o.maxFiles || 200000));
  let truncated = false;
  for await (const r of csvRows(csvPath)) {
    if (rows.length >= MAXF) { truncated = true; break; }
    rows.push({ path: r.path, size: r.size, mtime: r.mtime, ext: r.ext, cat: r.cat });
  }
  if (!rows.length) return { query: q, total: 0, hits: [], semantic: { on: false } };

  // prima le corrispondenze letterali: chi ricorda il nome deve trovarlo subito
  const fold = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const terms = fold(wordsOfPath(q)).split(' ').filter(Boolean);
  const scores = new Float64Array(rows.length);
  rows.forEach((r, i) => {
    const low = fold(r.path), base = fold(r.path.split(/[\\/]/).pop());
    let hit = 0;
    terms.forEach((t) => {
      if (base.indexOf(t) >= 0) hit += 3;       // nel nome del file conta il doppio
      else if (low.indexOf(t) >= 0) hit += 1.5; // in una cartella del percorso, un po' meno
    });
    if (hit && terms.length > 1) hit *= 1 + 0.4 * (terms.filter((t) => low.indexOf(t) >= 0).length / terms.length);
    scores[i] = hit;
  });

  // poi il significato, se richiesto: il modello si impara dai percorsi stessi
  let sem = null, near = [];
  if (o.semantic !== false && globalThis.WCSemantic) {
    const model = globalThis.WCSemantic.build(rows.map((r, i) => ({
      id: String(i), lang: o.lang || 'it', chunks: [{ n: 0, text: wordsOfPath(r.path) }]
    })), { maxTerms: 20000 });
    if (model.ready) {
      sem = new Map();
      model.query(wordsOfPath(q), rows.length, null, o.lang || 'it').forEach((h) => { sem.set(+h.doc, h.score); });
      near = model.near(wordsOfPath(q), 8, o.lang || 'it');
    }
  }

  let maxLit = 0;
  for (let i = 0; i < scores.length; i++) if (scores[i] > maxLit) maxLit = scores[i];
  const semW = (maxLit || 3) * 0.55;
  const hits = [];
  for (let i = 0; i < rows.length; i++) {
    const sm = sem ? (sem.get(i) || 0) : 0;
    if (!scores[i] && sm < 0.35) continue;
    hits.push({ path: rows[i].path, size: rows[i].size, mtime: rows[i].mtime, ext: rows[i].ext, cat: rows[i].cat,
      score: scores[i] + sm * semW, sem: sm ? Math.round(sm * 1000) / 1000 : 0, byMeaning: !scores[i] });
  }
  hits.sort((a, b) => b.score - a.score);
  return {
    query: q, total: hits.length, scanned: rows.length, truncated,
    hits: hits.slice(0, limit).map((h) => { h.score = Math.round(h.score * 100) / 100; return h; }),
    semantic: sem ? { on: true, near } : { on: false }
  };
}

module.exports = { compareReports, compareCsv, parseCsvLine, planTrash, runTrash, treeMap, inside, findOnDisk, wordsOfPath };
