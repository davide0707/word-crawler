// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: le formule.
 *
 * Negli appunti di matematica, fisica ed elettronica le formule sono scritte in LaTeX tra dollari.
 * Qui vengono rese leggibili senza librerie esterne e senza internet: un sottoinsieme di LaTeX
 * trasformato in HTML con elementi veri (sup, sub, una frazione impilata, un segno di radice), che
 * il tema dell'app colora come il resto.
 *
 * Quello che copre: $in linea$ e $$a capo$$, lettere greche, simboli comuni, apici e pedici anche
 * con le graffe, \frac, \sqrt, \sum, \int, \lim, \vec, \bar, \hat, \text, \left \right, matrici no.
 * Quello che non copre resta scritto com'è, in carattere a spaziatura fissa: meglio una formula
 * grezza ma fedele che una resa sbagliata.
 *
 * WCMath.has(text) -> true se c'è almeno una formula
 * WCMath.render(text) -> DocumentFragment (testo + formule rese), senza mai usare innerHTML
 * WCMath.toText(tex) -> la formula in caratteri Unicode, per i posti dove serve testo semplice
 */
(function (g) {
  'use strict';
  if (g.WCMath) return;

  var GREEK = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
    rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'
  };
  var SYM = {
    times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
    approx: '≈', equiv: '≡', sim: '∼', propto: '∝', infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃',
    in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', cup: '∪', cap: '∩', emptyset: '∅',
    rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
    mapsto: '↦', ldots: '…', cdots: '⋯', dots: '…', prime: '′', degree: '°', circ: '∘', angle: '∠', perp: '⊥', parallel: '∥',
    sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮', sqrt: '√', ell: 'ℓ', hbar: 'ℏ', Re: 'ℜ', Im: 'ℑ',
    land: '∧', lor: '∨', neg: '¬', oplus: '⊕', otimes: '⊗', star: '⋆', bullet: '•', quad: ' ', qquad: '  ', ',': ' ', ';': ' ', '!': ''
  };
  var FUNCS = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
    'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'gcd', 'mod', 'arg'];

  var MATH_RE = /\$\$([\s\S]{1,2000}?)\$\$|\$([^$\n]{1,500}?)\$|\\\[([\s\S]{1,2000}?)\\\]|\\\(([^\n]{1,500}?)\\\)/g;

  function has(text) {
    MATH_RE.lastIndex = 0;
    return MATH_RE.test(String(text || ''));
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /*
   * Il lettore della formula: scorre i caratteri e produce nodi. Non è un parser completo di TeX e
   * non vuole esserlo; quando incontra qualcosa che non conosce lo lascia passare così com'è.
   */
  function parse(tex, into) {
    var i = 0, n = tex.length;
    var out = into || document.createDocumentFragment();
    var buf = '';
    function flush() {
      if (!buf) return;
      out.appendChild(document.createTextNode(buf));
      buf = '';
    }
    // il gruppo che segue: {…} oppure un solo carattere o comando
    function group() {
      while (i < n && tex[i] === ' ') i++;
      if (tex[i] === '{') {
        var depth = 0, start = ++i;
        while (i < n) {
          if (tex[i] === '{') depth++;
          else if (tex[i] === '}') { if (!depth) break; depth--; }
          i++;
        }
        var inner = tex.slice(start, i);
        i++;
        return inner;
      }
      if (tex[i] === '\\') {
        var m = /^\\([A-Za-z]+)/.exec(tex.slice(i));
        if (m) { i += m[0].length; return m[0]; }
      }
      return tex[i++] || '';
    }
    while (i < n) {
      var c = tex[i];
      if (c === '\\') {
        var m2 = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
        if (!m2) { buf += c; i++; continue; }
        var name = m2[1];
        i += m2[0].length;
        if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
          flush();
          var num = group(), den = group();
          var f = el('span', 'wm-frac');
          var top = el('span', 'wm-num');
          parse(num, top);
          var bot = el('span', 'wm-den');
          parse(den, bot);
          f.appendChild(top);
          f.appendChild(bot);
          out.appendChild(f);
          continue;
        }
        if (name === 'sqrt') {
          flush();
          var deg = null;
          if (tex[i] === '[') { var e2 = tex.indexOf(']', i); if (e2 > 0) { deg = tex.slice(i + 1, e2); i = e2 + 1; } }
          var body = group();
          var r = el('span', 'wm-sqrt');
          if (deg) r.appendChild(el('sup', 'wm-deg', deg));
          r.appendChild(el('span', 'wm-radical', '√'));
          var under = el('span', 'wm-under');
          parse(body, under);
          r.appendChild(under);
          out.appendChild(r);
          continue;
        }
        if (name === 'text' || name === 'mathrm' || name === 'mathbf' || name === 'operatorname') {
          flush();
          out.appendChild(el('span', name === 'mathbf' ? 'wm-bf' : 'wm-text', group()));
          continue;
        }
        if (name === 'vec' || name === 'bar' || name === 'hat' || name === 'dot' || name === 'tilde') {
          flush();
          var mark = { vec: '→', bar: '‾', hat: '^', dot: '˙', tilde: '~' }[name];
          var w = el('span', 'wm-over');
          var inner2 = el('span');
          parse(group(), inner2);
          w.appendChild(inner2);
          w.appendChild(el('span', 'wm-mark', mark));
          out.appendChild(w);
          continue;
        }
        if (name === 'left' || name === 'right' || name === 'big' || name === 'Big' || name === 'bigl' || name === 'bigr') continue;
        if (GREEK[name]) { buf += GREEK[name]; continue; }
        if (SYM[name] != null) { buf += SYM[name]; continue; }
        if (FUNCS.indexOf(name) >= 0) { flush(); out.appendChild(el('span', 'wm-fn', name)); continue; }
        buf += name; // comando sconosciuto: resta la parola
        continue;
      }
      if (c === '^' || c === '_') {
        i++;
        flush();
        var tag = c === '^' ? 'sup' : 'sub';
        var e3 = document.createElement(tag);
        parse(group(), e3);
        out.appendChild(e3);
        continue;
      }
      if (c === '{' || c === '}') { i++; continue; }
      if (c === '*') { buf += '·'; i++; continue; }
      if (c === '-' && tex[i + 1] !== '>' ) { buf += '−'; i++; continue; }
      buf += c;
      i++;
    }
    flush();
    return out;
  }

  /* La formula come testo semplice, per i posti dove non si può mettere HTML. */
  function toText(tex) {
    var s = String(tex || '');
    s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
    s = s.replace(/\\(text|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}/g, '$2');
    s = s.replace(/\\([A-Za-z]+)/g, function (m, w) { return GREEK[w] || SYM[w] || w; });
    s = s.replace(/[{}]/g, '').replace(/\^\(?([\w+\-]+)\)?/g, '^$1');
    return s.replace(/\s+/g, ' ').trim();
  }

  /*
   * Il testo con le formule rese. Torna un frammento: il chiamante lo appende dove vuole, e non si
   * passa mai da innerHTML (la Content Security Policy dell'app non lo permetterebbe comunque).
   */
  function render(text, into) {
    var out = into || document.createDocumentFragment();
    var s = String(text == null ? '' : text), at = 0, m;
    MATH_RE.lastIndex = 0;
    while ((m = MATH_RE.exec(s))) {
      if (m.index > at) out.appendChild(document.createTextNode(s.slice(at, m.index)));
      var tex = m[1] || m[2] || m[3] || m[4] || '';
      var block = m[1] != null || m[3] != null;
      var span = el('span', block ? 'wm wm-block' : 'wm');
      span.setAttribute('title', tex.trim());
      try { parse(tex, span); } catch (e) { span.textContent = tex; }
      out.appendChild(span);
      at = m.index + m[0].length;
    }
    if (at < s.length) out.appendChild(document.createTextNode(s.slice(at)));
    return out;
  }

  g.WCMath = { has: has, render: render, toText: toText, parse: parse, GREEK: GREEK, SYM: SYM };
})(globalThis);
