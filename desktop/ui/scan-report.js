// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: tabelle del rapporto di scansione (usate nell'app e nell'esportazione HTML).
 */
(function (g) {
  'use strict';
  if (g.WCScanReport) return;

  function bytes(n) {
    if (!n) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toLocaleString('it-IT', { maximumFractionDigits: n < 10 ? 2 : 1 })) + ' ' + u[i];
  }
  function num(n) { return Number(n || 0).toLocaleString('it-IT'); }
  function date(ms) { return ms ? new Date(ms).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
  function pct(a, b) { return b ? (a * 100 / b).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%' : '—'; }
  function base(p) { return p.split(/[\\/]/).pop() || p; }
  function dirOf(p) { var i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i > 0 ? p.slice(0, i) : p; }
  function dur(ms) { var s = Math.round(ms / 1000); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; }

  function tiles(r) {
    var t = r.totals, d = r.duplicates || {};
    return [
      ['File', num(t.files)], ['Cartelle', num(t.dirs)], ['Spazio occupato', bytes(t.bytes)],
      ['Spazio in duplicati', d.method === 'off' ? 'non cercati' : bytes(d.wastedBytes) + ' (' + num(d.totalGroups) + ' gruppi)'],
      ['File vuoti', num(r.emptyFiles.count)], ['Cartelle vuote', num(r.emptyDirs.count)],
      ['Non leggibili', num(t.errors)], ['Durata', dur(r.durationMs)],
      ['Collegamenti non seguiti', num(t.symlinks)], ['Nascosti saltati', num(t.hidden)], ['Cartelle escluse', num(t.excluded)], ['Altri dischi saltati', num(t.otherDevice)]
    ];
  }

  // Ogni sezione: { id, title, note, columns: [..], rows: [[celle]], paths: [percorso per riga] }
  function sections(r) {
    var t = r.totals, out = [];
    out.push({ id: 'cat', title: 'Per tipo di file', columns: ['Tipo', 'File', 'Spazio', 'Quota'],
      rows: r.byCategory.map(function (c) { return [c.category, num(c.count), bytes(c.bytes), pct(c.bytes, t.bytes)]; }), bars: r.byCategory.map(function (c) { return t.bytes ? c.bytes / t.bytes : 0; }) });
    out.push({ id: 'ext', title: 'Per estensione', note: r.byExt.length + ' estensioni diverse.', columns: ['Estensione', 'File', 'Spazio', 'Quota', 'Media per file'],
      rows: r.byExt.slice(0, 300).map(function (e) { return [e.ext ? '.' + e.ext : '(senza)', num(e.count), bytes(e.bytes), pct(e.bytes, t.bytes), bytes(Math.round(e.bytes / Math.max(1, e.count)))]; }) });
    out.push({ id: 'big', title: 'File più grandi', columns: ['Nome', 'Cartella', 'Dimensione', 'Modificato'],
      rows: r.largestFiles.map(function (f) { return [base(f.path), dirOf(f.path), bytes(f.size), date(f.mtime)]; }), paths: r.largestFiles.map(function (f) { return f.path; }) });
    out.push({ id: 'dirs', title: 'Cartelle più grandi', note: 'Spazio totale, sottocartelle comprese.', columns: ['Cartella', 'Spazio totale', 'File diretti'],
      rows: r.largestDirs.map(function (d) { return [d.path, bytes(d.total), num(d.files)]; }), paths: r.largestDirs.map(function (d) { return d.path; }) });
    var dup = r.duplicates || {};
    var dupNote = dup.method === 'off' ? 'Ricerca dei duplicati disattivata.' :
      (dup.skipped ? 'Troppi file: ricerca dei duplicati saltata.' :
        num(dup.totalGroups) + ' gruppi di file identici, ' + bytes(dup.wastedBytes) + ' occupati dalle copie. ' +
        (dup.method === 'full' ? 'Controllo completo: contenuto identico byte per byte (SHA-256).' : 'Controllo veloce: stessa dimensione, stesso inizio e stessa fine del file. I file sotto 128 KB sono confrontati per intero; per quelli più grandi usa il controllo completo per esserne certa.'));
    out.push({ id: 'dup', title: 'Duplicati (cloni)', note: dupNote, columns: ['Copie', 'Dimensione', 'Spazio sprecato', 'Certezza', 'Percorsi'],
      rows: (dup.groups || []).map(function (gr) { return [num(gr.count), bytes(gr.size), bytes(gr.wasted), gr.exact ? 'identici' : 'molto probabili', gr.paths.join('\n')]; }),
      paths: (dup.groups || []).map(function (gr) { return gr.paths[0]; }) });
    out.push({ id: 'names', title: 'Nomi ripetuti', note: 'Stesso nome in cartelle diverse (non per forza lo stesso contenuto).', columns: ['Nome', 'Volte', 'Spazio', 'Esempi'],
      rows: r.sameNames.map(function (n) { return [n.name, num(n.count), bytes(n.bytes), n.paths.join('\n')]; }) });
    out.push({ id: 'empty', title: 'Vuoti', note: num(r.emptyFiles.count) + ' file vuoti, ' + num(r.emptyDirs.count) + ' cartelle vuote' + (r.emptyFiles.count > r.emptyFiles.paths.length || r.emptyDirs.count > r.emptyDirs.paths.length ? ' (elenco limitato ai primi 500 di ciascun tipo).' : '.'),
      columns: ['Tipo', 'Percorso'], rows: r.emptyFiles.paths.map(function (p) { return ['file', p]; }).concat(r.emptyDirs.paths.map(function (p) { return ['cartella', p]; })),
      paths: r.emptyFiles.paths.concat(r.emptyDirs.paths) });
    out.push({ id: 'old', title: 'File più vecchi e più recenti', columns: ['', 'Nome', 'Cartella', 'Modificato'],
      rows: r.oldest.map(function (f) { return ['più vecchio', base(f.path), dirOf(f.path), date(f.mtime)]; }).concat(r.newest.map(function (f) { return ['più recente', base(f.path), dirOf(f.path), date(f.mtime)]; })),
      paths: r.oldest.map(function (f) { return f.path; }).concat(r.newest.map(function (f) { return f.path; })) });
    out.push({ id: 'long', title: 'Percorsi molto lunghi', note: num(r.longPaths.count) + ' percorsi oltre 260 caratteri: alcuni programmi di Windows non riescono ad aprirli.', columns: ['Lunghezza', 'Percorso'],
      rows: r.longPaths.paths.map(function (p) { return [num(p.length), p]; }), paths: r.longPaths.paths });
    out.push({ id: 'err', title: 'Non leggibili', note: num(t.errors) + ' elementi a cui il sistema non ha dato accesso (di solito cartelle di sistema o di altri utenti). Non sono un problema.', columns: ['Codice', 'Percorso'],
      rows: r.errors.map(function (e) { return [e.code, e.path]; }) });
    return out;
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------------------------------------------------------------- mappa a riquadri (treemap "squarified")
  /*
   * items: [{ value, ... }] (valori > 0). Restituisce [{ it, x, y, w, h }] che riempiono il rettangolo,
   * con riquadri il più possibile quadrati (Bruls, Huizing e van Wijk, 2000).
   */
  function squarify(items, x, y, w, h) {
    var out = [];
    var total = 0;
    items.forEach(function (it) { if (it.value > 0) total += it.value; });
    if (!total || w <= 0 || h <= 0) return out;
    var scale = w * h / total;
    var rest = items.filter(function (it) { return it.value > 0; }).sort(function (a, b) { return b.value - a.value; })
      .map(function (it) { return { it: it, a: it.value * scale }; });
    function worst(row, side) {
      var s = 0, mx = 0, mn = Infinity;
      row.forEach(function (r) { s += r.a; if (r.a > mx) mx = r.a; if (r.a < mn) mn = r.a; });
      var s2 = s * s, q = side * side;
      return Math.max(q * mx / s2, s2 / (q * mn));
    }
    while (rest.length) {
      var side = Math.min(w, h), row = [], best = Infinity, i = 0;
      while (i < rest.length) {
        var cand = row.concat([rest[i]]), wr = worst(cand, side);
        if (row.length && wr > best) break;
        row = cand; best = wr; i++;
      }
      var area = row.reduce(function (s2, r) { return s2 + r.a; }, 0), thick = area / side, pos = 0;
      row.forEach(function (r) {
        var len = r.a / thick;
        if (w >= h) out.push({ it: r.it, x: x, y: y + pos, w: thick, h: len });
        else out.push({ it: r.it, x: x + pos, y: y, w: len, h: thick });
        pos += len;
      });
      if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
      rest = rest.slice(i);
    }
    return out;
  }

  // figli di ogni cartella nell'albero del rapporto
  function treeKids(tree) {
    var kids = tree.names.map(function () { return []; });
    for (var i = 1; i < tree.names.length; i++) if (tree.parent[i] >= 0) kids[tree.parent[i]].push(i);
    return kids;
  }
  function treePath(tree, i) {
    var parts = [];
    for (var k = i; k > 0; k = tree.parent[k]) parts.unshift(tree.names[k]);
    var root = tree.names[0];
    var sep = /\\/.test(root) && !/\//.test(root) ? '\\' : '/';
    return parts.length ? root.replace(/[\\/]+$/, '') + sep + parts.join(sep) : root;
  }

  // ---------------------------------------------------------------- confronto tra due scansioni
  function signed(n, fmt) { return (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n)); }
  function compareSections(c) {
    var out = [];
    var labels = { files: 'File', dirs: 'Cartelle', bytes: 'Spazio' };
    out.push({ id: 'cmp-tot', title: 'In totale', note: 'Prima: ' + new Date(c.old.finishedAt).toLocaleString('it-IT') + ' · dopo: ' + new Date(c.new.finishedAt).toLocaleString('it-IT') + '.',
      columns: ['', 'Prima', 'Dopo', 'Differenza'],
      rows: c.totals.map(function (t) { var f = t.key === 'bytes' ? bytes : num; return [labels[t.key], f(t.before), f(t.after), signed(t.delta, f)]; }) });
    out.push({ id: 'cmp-dirs', title: 'Cartelle cambiate', note: c.note || 'Le cartelle che sono cresciute o diminuite di più (sottocartelle comprese).', columns: ['Cartella', 'Prima', 'Dopo', 'Differenza'],
      rows: c.folders.map(function (f) { return [f.path === '.' ? '(cartella scelta)' : f.path, f.before == null ? 'non c’era' : bytes(f.before), f.after == null ? 'sparita' : bytes(f.after), signed(f.delta, bytes)]; }) });
    out.push({ id: 'cmp-cat', title: 'Tipi di file', columns: ['Tipo', 'Prima', 'Dopo', 'Differenza'],
      rows: c.categories.map(function (k) { return [k.category, bytes(k.before), bytes(k.after), signed(k.delta, bytes)]; }) });
    var f = c.files || {};
    if (f.skipped) out.push({ id: 'cmp-files', title: 'File', note: f.skipped, columns: [], rows: [] });
    else {
      out.push({ id: 'cmp-add', title: 'File nuovi', note: num(f.added.count) + ' file, ' + bytes(f.added.bytes) + '. Elenco dei più grandi.', columns: ['File', 'Dimensione'],
        rows: f.added.top.map(function (x) { return [x.path, bytes(x.size)]; }), paths: f.added.top.map(function (x) { return x.path; }) });
      out.push({ id: 'cmp-del', title: 'File spariti', note: num(f.removed.count) + ' file, ' + bytes(f.removed.bytes) + '.', columns: ['File', 'Dimensione'],
        rows: f.removed.top.map(function (x) { return [x.path, bytes(x.size)]; }) });
      out.push({ id: 'cmp-mod', title: 'File cambiati', note: num(f.changed.count) + ' file modificati (data o dimensione), ' + signed(f.changed.bytes, bytes) + ' in tutto.', columns: ['File', 'Prima', 'Dopo'],
        rows: f.changed.top.map(function (x) { return [x.path, bytes(x.before), bytes(x.size)]; }), paths: f.changed.top.map(function (x) { return x.path; }) });
    }
    return out;
  }

  // Rapporto completo in un'unica pagina HTML
  function html(r) {
    var parts = [];
    parts.push('<h1>Rapporto della scansione</h1><p class="meta">' + esc(r.root) + ' · ' + esc(new Date(r.finishedAt).toLocaleString('it-IT')) + (r.partial ? ' · <strong>interrotta: risultati parziali</strong>' : '') + '</p>');
    parts.push('<div class="tiles">' + tiles(r).map(function (x) { return '<div><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>');
    sections(r).forEach(function (s) {
      parts.push('<h2>' + esc(s.title) + '</h2>' + (s.note ? '<p class="note">' + esc(s.note) + '</p>' : ''));
      if (!s.rows.length) { parts.push('<p class="note">Nessun elemento.</p>'); return; }
      parts.push('<div class="tw"><table><thead><tr>' + s.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        s.rows.map(function (row) { return '<tr>' + row.map(function (c) { return '<td>' + esc(c).replace(/\n/g, '<br>') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
    });
    parts.push('<p class="foot">Creato con Word Crawler in sola lettura: nessun file è stato modificato, spostato o cancellato. Opzioni: ' + esc(r.options.legs) + ' zampe, duplicati ' + esc(r.options.duplicates) + ', nascosti ' + (r.options.includeHidden ? 'inclusi' : 'esclusi') + '.</p>');
    return '<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Scansione ' + esc(r.root) + ' · Word Crawler</title><style>' +
      'body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:32px clamp(16px,4vw,48px);background:#0b0b0e;color:#ecebf0}' +
      'h1{font-size:26px;margin:0}h2{font:600 12px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;color:#3fd8ff;margin:36px 0 8px}' +
      '.meta,.note,.foot{color:#9b9aa7}.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-top:20px}' +
      '.tiles div{background:#16161c;border:1px solid #2a2a34;border-radius:8px;padding:10px 12px;display:flex;flex-direction:column}.tiles span{color:#9b9aa7;font-size:12px}.tiles b{font-size:18px;font-variant-numeric:tabular-nums}' +
      '.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #2a2a34;vertical-align:top}' +
      'th{color:#9b9aa7;font-weight:600}td{overflow-wrap:anywhere;font-variant-numeric:tabular-nums}' +
      '@media (prefers-color-scheme:light){body{background:#fbfaf6;color:#16171c}.tiles div{background:#fff;border-color:#ddd}th,td{border-color:#e4e4e4}h2{color:#2f4bff}}' +
      '</style></head><body>' + parts.join('\n') + '</body></html>';
  }

  g.WCScanReport = { sections: sections, tiles: tiles, html: html, bytes: bytes, num: num, squarify: squarify, treeKids: treeKids, treePath: treePath, compareSections: compareSections, esc: esc };
})(globalThis);
