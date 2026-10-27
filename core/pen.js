/*
 * Word Crawler: la penna, per segnare a mano (anche sui PDF e sulle pagine web).
 * Strumenti: evidenzia, sottolinea, nota, gomma. Si trascina sulle parole; la nota chiede il testo.
 *
 * WCPen.attach({
 *   engine(): motore grafico attivo (crawler.js) o null,
 *   tokens(): token del documento,
 *   area?: elemento in cui la penna funziona (se manca: tutta la pagina),
 *   marks?: segni iniziali,
 *   onChange(marks)
 * }) -> { setTool(t), tool(), marks(), setMarks(list), remove(id), clear(), destroy() }
 *
 * Un segno: { id, type: 'hl'|'under'|'note', from, to, text, note?, page?, n? }  (from/to: indici dei token)
 */
(function (g) {
  'use strict';
  if (g.WCPen) return;

  var TOOLS = { hl: 'Evidenzia', under: 'Sottolinea', note: 'Nota', erase: 'Gomma' };
  var seq = 0;

  function spanText(tokens, from, to) {
    var out = '';
    for (var k = from; k < to && k < tokens.length; k++) {
      if (k > from) out += (tokens[k].gap || ' ').replace(/\s+/g, ' ');
      out += tokens[k].text;
      if (out.length > 400) { out = out.slice(0, 400) + '…'; break; }
    }
    return out;
  }

  // numera le note nell'ordine del documento
  function number(marks) {
    var n = 0;
    marks.slice().sort(function (a, b) { return a.from - b.from; }).forEach(function (m) { if (m.type === 'note') m.n = ++n; else delete m.n; });
    return marks;
  }

  function attach(opts) {
    var tool = null, marks = number((opts.marks || []).slice()), drag = null, pop = null;
    function eng() { return opts.engine ? opts.engine() : null; }
    function toks() { return opts.tokens ? opts.tokens() : []; }
    function changed() {
      number(marks);
      var e = eng();
      if (e && e.setUserMarks) e.setUserMarks(marks);
      if (opts.onChange) opts.onChange(marks.slice());
    }
    function inside(target) {
      if (!target || !target.closest) return false;
      if (target.closest('[data-wc-ui], button, input, select, textarea, label, summary, .wc-side, .wc-results, .topbar')) return false;
      return !opts.area || opts.area.contains(target);
    }

    function closePopover() { if (pop) { pop.remove(); pop = null; } }
    function askNote(mark, x, y, done) {
      closePopover();
      pop = document.createElement('div');
      pop.setAttribute('data-word-crawler', '');
      pop.setAttribute('data-wc-ui', '');
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Nota');
      pop.style.cssText = 'position:fixed!important;z-index:2147483647!important;width:280px!important;padding:10px!important;border-radius:10px!important;' +
        'background:#14151b!important;color:#f2f2f5!important;border:1px solid #ff8a3d!important;box-shadow:0 10px 30px rgba(0,0,0,.35)!important;' +
        'font:14px/1.4 system-ui,sans-serif!important;left:' + Math.max(8, Math.min(window.innerWidth - 296, x)) + 'px!important;top:' + Math.max(8, Math.min(window.innerHeight - 170, y + 14)) + 'px!important';
      var q = document.createElement('p');
      q.textContent = '«' + (mark.text.length > 80 ? mark.text.slice(0, 80) + '…' : mark.text) + '»';
      q.style.cssText = 'margin:0 0 6px!important;color:#b9b9c4!important;font-style:italic!important;font-size:12px!important';
      var ta = document.createElement('textarea');
      ta.rows = 3;
      ta.placeholder = 'Scrivi la nota…';
      ta.value = mark.note || '';
      ta.style.cssText = 'width:100%!important;box-sizing:border-box!important;background:#0b0b0e!important;color:#fff!important;border:1px solid #3a3b47!important;border-radius:6px!important;padding:6px!important;font:inherit!important;resize:vertical!important';
      var row = document.createElement('div');
      row.style.cssText = 'display:flex!important;gap:8px!important;justify-content:flex-end!important;margin-top:8px!important';
      function btn(label, primary, fn) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = label;
        b.style.cssText = 'border-radius:6px!important;padding:5px 12px!important;cursor:pointer!important;font:600 13px system-ui,sans-serif!important;' +
          (primary ? 'background:#ff8a3d!important;color:#111!important;border:0!important' : 'background:transparent!important;color:#ddd!important;border:1px solid #555!important');
        b.addEventListener('click', fn);
        row.appendChild(b);
      }
      btn('Annulla', false, function () { closePopover(); done(null); });
      btn('Salva', true, function () { var v = ta.value.trim(); closePopover(); done(v); });
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); closePopover(); done(null); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { var v = ta.value.trim(); closePopover(); done(v); }
      });
      pop.appendChild(q); pop.appendChild(ta); pop.appendChild(row);
      document.documentElement.appendChild(pop);
      ta.focus();
    }

    function at(e) { var en = eng(); return en && en.hitTest ? en.hitTest(e.clientX, e.clientY) : -1; }
    function onDown(e) {
      if (!tool || e.button !== 0 || !inside(e.target)) return;
      var i = at(e);
      if (i < 0) return;
      e.preventDefault();
      e.stopPropagation();
      justMarked = Date.now();
      if (tool === 'erase') {
        var hit = marks.filter(function (m) { return i >= m.from && i < m.to; });
        if (hit.length) { marks = marks.filter(function (m) { return hit.indexOf(m) < 0; }); changed(); }
        return;
      }
      justMarked = Date.now();
      drag = { start: i, end: i };
      var en = eng();
      if (en) en.setPreview({ from: i, to: i + 1, type: tool });
    }
    function onMove(e) {
      if (!drag) return;
      var i = at(e);
      if (i < 0 || i === drag.end) return;
      drag.end = i;
      var en = eng();
      if (en) en.setPreview({ from: Math.min(drag.start, i), to: Math.max(drag.start, i) + 1, type: tool });
    }
    function onUp(e) {
      if (!drag) return;
      var d = drag; drag = null;
      var en = eng();
      if (en) en.setPreview(null);
      var from = Math.min(d.start, d.end), to = Math.max(d.start, d.end) + 1;
      var tk = toks();
      var mark = { id: 'u' + Date.now().toString(36) + (++seq), type: tool, from: from, to: to, text: spanText(tk, from, to), page: tk[from] && tk[from].page != null ? tk[from].page : null };
      if (tool === 'note') {
        marks.push(mark); changed();
        askNote(mark, e.clientX, e.clientY, function (txt) {
          if (txt === null) marks = marks.filter(function (m) { return m !== mark; });
          else mark.note = txt;
          changed();
        });
      } else {
        // lo stesso segno sulle stesse parole si toglie (come un interruttore)
        var same = marks.filter(function (m) { return m.type === tool && m.from === from && m.to === to; });
        if (same.length) marks = marks.filter(function (m) { return same.indexOf(m) < 0; });
        else marks.push(mark);
        changed();
      }
    }
    function onKey(e) { if (e.key === 'Escape' && tool && !pop) setTool(null); }
    // con la penna in mano un clic su un collegamento non deve aprirlo
    var justMarked = 0;
    function onClick(e) { if (tool && Date.now() - justMarked < 1500 && inside(e.target)) { e.preventDefault(); e.stopPropagation(); } }
    document.addEventListener('click', onClick, true);

    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('keydown', onKey);

    function setTool(t) {
      tool = TOOLS[t] ? t : null;
      document.documentElement.classList.toggle('wc-pen-on', !!tool);
      document.documentElement.style.cursor = tool ? (tool === 'erase' ? 'cell' : 'crosshair') : '';
      if (opts.onTool) opts.onTool(tool);
    }

    return {
      setTool: setTool,
      tool: function () { return tool; },
      marks: function () { return marks.slice(); },
      setMarks: function (list) { marks = number((list || []).slice()); changed(); },
      edit: function (id, x, y) {
        var m = marks.filter(function (k) { return k.id === id; })[0];
        if (!m) return;
        askNote(m, x || window.innerWidth / 2 - 140, y || window.innerHeight / 3, function (txt) { if (txt !== null) { m.note = txt; changed(); } });
      },
      remove: function (id) { marks = marks.filter(function (m) { return m.id !== id; }); changed(); },
      clear: function () { marks = []; changed(); },
      refresh: function () { var en = eng(); if (en && en.setUserMarks) en.setUserMarks(marks); },
      destroy: function () {
        setTool(null);
        closePopover();
        document.removeEventListener('pointerdown', onDown, true);
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('keydown', onKey);
        document.removeEventListener('click', onClick, true);
      }
    };
  }

  // Ritrova i segni salvati su una pagina che potrebbe essere cambiata: stesso testo vicino alla posizione di prima
  function relocate(tokens, saved) {
    var out = [];
    (saved || []).forEach(function (m) {
      var len = m.to - m.from;
      if (len <= 0 || len > 2000) return;
      if (spanText(tokens, m.from, m.to) === m.text) { out.push(Object.assign({}, m)); return; }
      var firstWord = String(m.text).split(/\s+/)[0].replace(/[^\p{L}\p{N}]+$/u, '');
      var best = -1, bestD = Infinity;
      for (var k = 0; k + len <= tokens.length; k++) {
        if (tokens[k].text !== firstWord && tokens[k].text.indexOf(firstWord) !== 0) continue;
        if (spanText(tokens, k, k + len) !== m.text) continue;
        var dd = Math.abs(k - m.from);
        if (dd < bestD) { bestD = dd; best = k; }
      }
      if (best >= 0) out.push(Object.assign({}, m, { from: best, to: best + len }));
    });
    return out;
  }

  g.WCPen = { attach: attach, TOOLS: TOOLS, spanText: spanText, relocate: relocate };
})(globalThis);
