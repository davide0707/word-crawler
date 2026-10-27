// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: lettura del testo da una pagina HTML (sito web o documento già mostrato).
 * Trova il contenitore del testo principale e trasforma ogni parola in un token
 * { text, gap, blk, w, el, link, rect() } con la sua posizione sulla pagina.
 */
(function (g) {
  'use strict';
  if (g.WCDom) return;

  var SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'BUTTON', 'SVG', 'CANVAS',
    'IFRAME', 'NAV', 'ASIDE', 'FOOTER', 'FORM', 'TEMPLATE', 'HEAD', 'MATH', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'IMG', 'PICTURE', 'DIALOG']);
  var BLOCK = /^(P|DIV|LI|UL|OL|H[1-6]|TD|TH|TR|TABLE|BLOCKQUOTE|SECTION|ARTICLE|PRE|DT|DD|DL|FIGCAPTION|FIGURE|HEADER|MAIN|BR|HR|CAPTION|SUMMARY|DETAILS|ADDRESS)$/;

  function textLen(el) { return (el.innerText || el.textContent || '').length; }

  // Il contenitore con il testo principale (articolo, post, pagina di Wikipedia...)
  function pickRoot(doc) {
    doc = doc || document;
    var sel = 'article, main, [role="main"], #mw-content-text, .mw-parser-output, #content, .content, .post, .post-content, .entry-content, .article-body, .story-body';
    var cands = Array.prototype.slice.call(doc.querySelectorAll(sel));
    var best = null, bestLen = 0;
    cands.forEach(function (el) { var l = textLen(el); if (l > bestLen) { best = el; bestLen = l; } });
    if (best && bestLen > 400) {
      var inner = cands.filter(function (el) { return el !== best && best.contains(el) && textLen(el) > bestLen * 0.7; });
      inner.sort(function (a, b) { return textLen(a) - textLen(b); });
      return inner[0] || best;
    }
    var counts = new Map();
    doc.querySelectorAll('p').forEach(function (p) {
      var par = p.parentElement;
      if (par) counts.set(par, (counts.get(par) || 0) + textLen(p));
    });
    var b2 = null, bl = 0;
    counts.forEach(function (v, k) { if (v > bl) { bl = v; b2 = k; } });
    if (b2 && bl > 400) return b2;
    return doc.body;
  }

  var hiddenCache = new WeakMap();
  function skipEl(el) {
    if (SKIP.has(el.tagName)) return true;
    if (el.getAttribute('aria-hidden') === 'true' || el.hidden) return true;
    if (el.hasAttribute('data-word-crawler')) return true;
    if (el.tagName === 'BR' || el.tagName === 'WBR') return false;
    var h = hiddenCache.get(el);
    if (h === undefined) {
      h = el.getClientRects().length === 0 && getComputedStyle(el).display !== 'contents';
      hiddenCache.set(el, h);
    }
    return h;
  }
  function weightEl(el) {
    if (!el || !el.closest) return 1;
    if (el.closest('h1,h2,h3')) return 3;
    if (el.closest('h4,h5,h6')) return 2;
    return 1;
  }

  /*
   * Il Range della parola si crea solo quando serve (quando il ragno ci arriva o la pagina scorre lì):
   * con documenti di centinaia di migliaia di parole risparmia molta memoria e tempo.
   */
  function makeToken(text, nodeA, offA, nodeB, offB, el) {
    var a = el && el.closest ? el.closest('a[href]') : null;
    function range() {
      var r = document.createRange();
      try { r.setStart(nodeA, offA); r.setEnd(nodeB, offB); } catch (e) { return null; }
      return r;
    }
    return {
      text: text, el: el, link: a, range: range,
      rect: function () {
        var rg = range();
        if (!rg) return null;
        var rs = rg.getClientRects();
        var r = null;
        for (var i = 0; i < rs.length; i++) { if (rs[i].width > 0 && rs[i].height > 0) { r = rs[i]; break; } }
        if (!r) return null;
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
      }
    };
  }

  // -> array di token con gap (testo prima della parola), blk (blocco) e w (peso del titolo)
  function collect(root, options) {
    var WORD = new RegExp(g.WCText.WORD.source, 'gu');
    var max = (options && options.max) || 400000;
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) return skipEl(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var concat = '', segs = [], blk = 0, blkW = [1], lastParent = null, n, pendingBreak = false;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 1) {
        if (BLOCK.test(n.tagName)) { concat += '\n'; pendingBreak = true; }
        continue;
      }
      var t = n.nodeValue;
      if (!t) continue;
      if (!t.trim()) { concat += ' '; continue; }
      if (pendingBreak) { blk++; blkW[blk] = 1; pendingBreak = false; }
      else if (lastParent && n.parentNode !== lastParent) concat += ' ';
      lastParent = n.parentNode;
      segs.push({ node: n, start: concat.length, len: t.length, blk: blk });
      concat += t;
      var w = weightEl(n.parentElement);
      if (w > blkW[blk]) blkW[blk] = w;
    }

    var tokens = [], m, si = 0, lastEnd = 0;
    WORD.lastIndex = 0;
    while ((m = WORD.exec(concat)) && tokens.length < max) {
      var s = m.index, e = s + m[0].length;
      while (si < segs.length - 1 && segs[si].start + segs[si].len <= s) si++;
      var sj = si;
      while (sj < segs.length - 1 && segs[sj].start + segs[sj].len < e) sj++;
      var A = segs[si], B = segs[sj];
      if (!A || s < A.start || e > B.start + B.len) continue;
      var tok = makeToken(m[0], A.node, s - A.start, B.node, e - B.start, A.node.parentElement);
      tok.gap = concat.slice(lastEnd, s);
      tok.blk = A.blk;
      tok.w = blkW[A.blk] || 1;
      tokens.push(tok);
      lastEnd = e;
    }
    if (tokens.length) tokens[tokens.length - 1].tail = concat.slice(lastEnd).trim().slice(0, 3);
    tokens.truncated = !!m;
    return tokens;
  }

  g.WCDom = { pickRoot: pickRoot, collect: collect };
})(globalThis);
