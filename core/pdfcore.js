/*
 * Word Crawler: parole e posizioni dentro un PDF.
 * Riceve per ogni pagina il viewport e il testo di PDF.js ({ vp, tc }) e produce i token
 * con la loro posizione, i paragrafi (blk) e i titoli (w), pronti per l'analisi.
 */
(function (g) {
  'use strict';
  if (g.WCPdf) return;
  var mctx = null;
  function measureCtx() {
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    return mctx;
  }

  function mul(m, t) {
    return [
      m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1],
      m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3],
      m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5]
    ];
  }

  // Righe di testo di una pagina, con la posizione di ogni carattere
  function buildLines(P) {
    var mc = measureCtx();
    var m = P.vp.transform, styles = P.tc.styles || {}, scale = P.vp.scale;
    var groups = [], line = [];
    groups.push(line);
    P.tc.items.forEach(function (it) {
      if (typeof it.str !== 'string') return;
      if (it.str.length) line.push(it);
      if (it.hasEOL) { line = []; groups.push(line); }
    });
    var lines = [];
    groups.forEach(function (L) {
      if (!L.length) return;
      var str = '', prevEnd = null, maxFh = 0, map = [], base = null, x0 = null;
      L.forEach(function (it) {
        var tx = mul(m, it.transform);
        var fh = Math.hypot(tx[2], tx[3]);
        var horizontal = fh > 0 && tx[0] > 0 && Math.abs(tx[1]) <= Math.abs(tx[0]) * 0.05;
        if (!horizontal) { str += ' '; map.push(null); prevEnd = null; return; }
        var fam = (styles[it.fontName] && styles[it.fontName].fontFamily) || 'sans-serif';
        mc.font = '100px ' + fam;
        var full = mc.measureText(it.str).width || 1;
        var wpx = it.width * scale;
        var info = { str: it.str, x: tx[4], base: tx[5], fh: fh, k: wpx / full, fam: fam };
        if (prevEnd !== null && str && !/\s$/.test(str) && !/^\s/.test(it.str) && info.x - prevEnd > fh * 0.15) {
          str += ' '; map.push(null);
        }
        for (var j = 0; j < it.str.length; j++) map.push([info, j]);
        str += it.str;
        prevEnd = info.x + wpx;
        if (fh > maxFh) maxFh = fh;
        if (base === null) { base = tx[5]; x0 = tx[4]; }
      });
      if (base === null) return;
      lines.push({ str: str, map: map, fh: maxFh / scale, fhPx: maxFh, base: base, x0: x0 });
    });
    P.lines = lines;
    return lines;
  }

  function xAt(info, off) {
    var mc = measureCtx();
    mc.font = '100px ' + info.fam;
    return info.x + info.k * mc.measureText(info.str.slice(0, off)).width;
  }

  /*
   * Token di tutto il documento. offsetOf(P) -> [x, y] della pagina nel documento.
   * I paragrafi si riconoscono dallo spazio verticale tra le righe; i titoli dal corpo del testo
   * più grande della media; le parole spezzate a fine riga ("impor-/tante") vengono riunite.
   */
  function tokens(pages, offsetOf) {
    var WORD = new RegExp(g.WCText.WORD.source, 'gu');
    var sizes = [];
    pages.forEach(function (P) { P.lines.forEach(function (l) { if (l.str.trim()) sizes.push(l.fh); }); });
    sizes.sort(function (a, b) { return a - b; });
    var median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
    var out = [], blk = 0, prev = null, prevPage = -1, prevTail = '';
    pages.forEach(function (P, pi) {
      P.lines.forEach(function (line) {
        var heading = !!(median && line.fh > median * 1.35);
        var newBlock = false;
        if (prev) {
          if (pi !== prevPage) newBlock = /[.!?:]\s*$/.test(prev.str) || heading || prev.heading;
          else {
            var dy = line.base - prev.base;
            newBlock = dy > prev.fhPx * 1.75 || dy < 0 || heading !== prev.heading || Math.abs(line.fh - prev.fh) > prev.fh * 0.2;
            // righe riconosciute con l'OCR: Tesseract dice già dove comincia un paragrafo
            if (line.ocr) newBlock = !!line.newBlock || dy > prev.fhPx * 2.2 || dy < 0 || heading !== prev.heading;
          }
        }
        if (newBlock) blk++;
        line.heading = heading;
        var first = true, lastEnd = 0, mm;
        WORD.lastIndex = 0;
        while ((mm = WORD.exec(line.str))) {
          var s = mm.index, e = s + mm[0].length;
          var A = line.map[s], B = line.map[e - 1];
          var gap = first ? prevTail + (newBlock ? '\n' : ' ') + line.str.slice(0, s) : line.str.slice(lastEnd, s);
          // parola spezzata a fine riga: si unisce alla precedente
          if (first && !newBlock && prevTail.trim() === '-' && /^\p{Ll}/u.test(mm[0]) && out.length) {
            out[out.length - 1].text += mm[0];
            first = false; lastEnd = e;
            continue;
          }
          first = false;
          lastEnd = e;
          if (!A || !B) continue;
          var xa = xAt(A[0], A[1]), xb = xAt(B[0], B[1] + 1);
          var fh = A[0].fh;
          out.push(makeToken(mm[0], gap, blk, heading ? 3 : 1, P, pi, offsetOf, xa, A[0].base - fh * 0.84, Math.max(1, xb - xa), fh * 1.08, A[0].fam));
        }
        prevTail = line.str.slice(lastEnd);
        prev = line;
        prevPage = pi;
      });
    });
    if (out.length) out[out.length - 1].tail = prevTail.trim().slice(0, 3);
    return out;
  }

  function makeToken(text, gap, blk, w, P, pi, offsetOf, lx, ly, lw, lh, fam) {
    return {
      text: text, gap: gap, blk: blk, w: w, page: pi,
      rect: function () { var o = offsetOf(P); return o ? { x: o[0] + lx, y: o[1] + ly, w: lw, h: lh } : null; },
      font: function () { return { style: 'normal', weight: '400', family: fam }; }
    };
  }

  g.WCPdf = { buildLines: buildLines, tokens: tokens };
})(globalThis);
