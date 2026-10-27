// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: il documento con i segni, pronto da esportare (Word, pagina web, PDF).
 *
 * capture(tokens, sentences, userMarks) -> modello compatto:
 *   { blocks: [{ w, page, runs: [{ t, mk?, s?, u?, n? }] }], notes: [{ n, text, quote }] }
 *     t  testo;  mk segno sulla parola (ring-cyan, ring-green, kw-*, num, term, strike)
 *     s  frase sottolineata (key, def, term);  u segno fatto a mano (hl, under, note);  n numero della nota
 * html(entry, model) -> pagina HTML autonoma con i segni disegnati in CSS (anche per la stampa in PDF).
 */
(function (g) {
  'use strict';
  if (g.WCAnnotate) return;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function capture(tokens, sentences, userMarks) {
    var n = tokens.length;
    var umark = new Array(n), notes = [];
    (userMarks || []).slice().sort(function (a, b) { return a.from - b.from; }).forEach(function (m) {
      var nid = 0;
      if (m.type === 'note') { nid = notes.length + 1; notes.push({ n: nid, text: m.note || '', quote: m.text || '' }); }
      for (var k = Math.max(0, m.from); k < Math.min(n, m.to); k++) umark[k] = { u: m.type, n: nid, first: k === m.from, last: k === m.to - 1 };
    });
    var blocks = [], cur = null, lastBlk = null;
    function push(text, st) {
      if (!text) return;
      var runs = cur.runs, r = runs[runs.length - 1];
      if (r && !r.end && r.mk === st.mk && r.s === st.s && r.u === st.u && r.n === st.n) { r.t += text; return; }
      var o = { t: text };
      if (st.mk) o.mk = st.mk;
      if (st.s) o.s = st.s;
      if (st.u) o.u = st.u;
      if (st.n) o.n = st.n;
      runs.push(o);
    }
    for (var i = 0; i < n; i++) {
      var t = tokens[i];
      if (t.blk !== lastBlk || !cur) {
        cur = { w: t.w || 1, page: t.page != null ? t.page : null, runs: [] };
        blocks.push(cur);
        lastBlk = t.blk;
      } else {
        // lo spazio tra due parole prende il segno solo se lo condividono
        var p = tokens[i - 1];
        var sp = sentences[t.sid], sameSent = p.sid === t.sid && sp && sp.mk;
        var sameGrp = t.grp && p.grp === t.grp;
        var um = umark[i], pm = umark[i - 1];
        var shareU = um && pm && pm.u === um.u && pm.n === um.n && !um.first;
        push((t.gap || ' ').replace(/\s+/g, ' '), { s: sameSent ? sp.mk : null, mk: sameGrp ? t.mk : null, u: shareU ? um.u : null, n: shareU ? um.n : 0 });
      }
      var s = sentences[t.sid], m = umark[i];
      push(t.text, { s: s && s.mk ? s.mk : null, mk: t.mk || null, u: m ? m.u : null, n: m ? m.n : 0 });
      if (m && m.last && m.n) cur.runs[cur.runs.length - 1].end = true;
    }
    if (n && tokens[n - 1].tail) push(tokens[n - 1].tail, {});
    return { blocks: blocks, notes: notes };
  }

  var CSS =
    'body{font:17px/1.75 Georgia,"Times New Roman",serif;max-width:760px;margin:40px auto;padding:0 22px;color:#16171c;background:#fbfaf7}' +
    'h1{font:700 30px/1.2 system-ui,sans-serif;margin:0 0 6px}h2.sec{font:700 14px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:#2f4bff;margin:36px 0 10px}' +
    '.meta{color:#666;font:14px system-ui,sans-serif}.legend{font:13px/1.9 system-ui,sans-serif;color:#444;border:1px solid #ddd;border-radius:8px;padding:8px 12px}' +
    '.legend span{margin-right:12px;white-space:nowrap}.doc p{margin:0 0 14px}.doc h2,.doc h3{font-family:system-ui,sans-serif;margin:26px 0 10px}' +
    '.k{text-decoration:underline;text-decoration-color:#1d4ed8;text-decoration-thickness:2px;text-underline-offset:3px}' +
    '.d{text-decoration:underline double;text-decoration-color:#15803d;text-underline-offset:3px}' +
    '.t{text-decoration:underline;text-decoration-color:#ea580c;text-decoration-thickness:2px;text-underline-offset:3px}' +
    '.rc{border:1.6px solid #0e7490;border-radius:999px;padding:0 4px}.rg{border:1.6px solid #15803d;border-radius:999px;padding:0 4px}' +
    '.kl{background:#dfe3ff}.kc{background:#d6f4ff}.nm{border:1.5px solid #4338ca;padding:0 2px}.tm{background:#ffd9bf}.st{text-decoration:line-through;text-decoration-color:#e11d48}' +
    '.uh{background:#fff176}.uu{text-decoration:underline wavy #e11d48;text-underline-offset:4px}.un{background:#ffe4cc;border-bottom:2px dotted #ea580c}' +
    'sup.fn{font:700 11px system-ui,sans-serif;color:#ea580c;margin-left:2px}ol.notes li{margin-bottom:8px}.q{color:#555;font-style:italic}' +
    '.cards{display:grid;gap:10px}.card{border:1px solid #ddd;border-radius:8px;padding:10px 12px;break-inside:avoid}.card b{display:block;font-family:system-ui,sans-serif;font-size:14px;margin-bottom:4px}' +
    '.pg{font:12px system-ui,sans-serif;color:#888;margin:22px 0 6px;border-top:1px dashed #ccc;padding-top:6px}' +
    '@media print{body{background:#fff;margin:0;max-width:none}h2.sec{break-after:avoid}.doc p{orphans:3;widows:3}}';

  var MK = { 'ring-cyan': 'rc', 'ring-green': 'rg', 'kw-lav': 'kl', 'kw-cyan': 'kc', num: 'nm', term: 'tm', strike: 'st' };
  var SK = { key: 'k', def: 'd', term: 't' };
  var UK = { hl: 'uh', under: 'uu', note: 'un' };

  function runHtml(r) {
    var cls = [];
    if (r.s && SK[r.s]) cls.push(SK[r.s]);
    if (r.u && UK[r.u]) cls.push(UK[r.u]);
    var inner = esc(r.t);
    if (r.mk && MK[r.mk]) inner = '<span class="' + MK[r.mk] + '">' + inner + '</span>';
    var out = cls.length ? '<span class="' + cls.join(' ') + '">' + inner + '</span>' : inner;
    if (r.end && r.n) out += '<sup class="fn">' + r.n + '</sup>';
    return out;
  }

  function pageTag(p) { return p != null ? ' <span class="meta">(p. ' + (p + 1) + ')</span>' : ''; }

  function html(entry, model) {
    var e = entry || {};
    var out = ['<!doctype html><html lang="' + esc(e.lang || 'it') + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + esc(e.title || 'Documento') + ' · Word Crawler</title><style>' + CSS + '</style></head><body>'];
    out.push('<h1>' + esc(e.title || 'Documento') + '</h1>');
    out.push('<p class="meta">' + esc([e.format, e.source].filter(Boolean).join(' · ')) + '</p>');
    out.push('<p class="legend"><span class="k">frase chiave</span> <span class="d">definizione</span> <span class="rc">concetto</span> <span class="rg">nome</span> ' +
      '<span class="nm">numero o data</span> <span class="uh">evidenziato da te</span> <span class="uu">sottolineato da te</span> <span class="un">nota</span></p>');
    if (e.summary && e.summary.length) {
      out.push('<h2 class="sec">Sunto</h2>');
      e.summary.forEach(function (s) { out.push('<p>' + esc(s.text) + pageTag(s.page) + '</p>'); });
    }
    if (e.keywords && e.keywords.length) {
      out.push('<h2 class="sec">Parole chiave</h2><p>' + e.keywords.map(function (k) { return esc(k.word); }).join(' · ') + '</p>');
    }
    if (model && model.blocks.length) {
      out.push('<h2 class="sec">Documento segnato</h2><div class="doc">');
      var lastPage = null;
      model.blocks.forEach(function (b) {
        if (b.page != null && b.page !== lastPage) { out.push('<p class="pg">Pagina ' + (b.page + 1) + '</p>'); lastPage = b.page; }
        var tag = b.w >= 3 ? 'h2' : (b.w === 2 ? 'h3' : 'p');
        out.push('<' + tag + '>' + b.runs.map(runHtml).join('') + '</' + tag + '>');
      });
      out.push('</div>');
      if (model.notes.length) {
        out.push('<h2 class="sec">Note</h2><ol class="notes">');
        model.notes.forEach(function (nt) { out.push('<li>' + esc(nt.text) + (nt.quote ? ' <span class="q">— «' + esc(nt.quote) + '»</span>' : '') + '</li>'); });
        out.push('</ol>');
      }
    }
    if (e.cards && e.cards.length) {
      out.push('<h2 class="sec">Schede di ripasso</h2><div class="cards">');
      e.cards.forEach(function (c) { out.push('<div class="card"><b>' + esc(c.front) + '</b>' + esc(c.back) + '</div>'); });
      out.push('</div>');
    }
    out.push('<p class="meta" style="margin-top:40px">Creato con Word Crawler, senza intelligenza artificiale.</p></body></html>');
    return out.join('\n');
  }

  g.WCAnnotate = { capture: capture, html: html, esc: esc };
})(globalThis);
