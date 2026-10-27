/*
 * Word Crawler: strumenti di base sul testo (senza AI).
 * Normalizzazione delle parole, parole da ignorare (stopword), lingua, divisione in frasi.
 *
 * Un "token" è una parola del documento: { text, gap, blk, w }
 *   text: la parola così com'è scritta
 *   gap:  il testo tra la parola precedente e questa (spazi, punteggiatura, a capo)
 *   blk:  numero del blocco (paragrafo, titolo, riga di tabella…)
 *   w:    peso del blocco (1 testo normale, 2 sottotitolo, 3 titolo)
 */
(function (g) {
  'use strict';
  if (g.WCText) return;

  var LANG = g.WCLang;
  function fold(s) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  // parole da ignorare: per compatibilità, STOP è l'insieme italiano + inglese
  var STOP = new Set(Array.from(LANG.get('it').stopSet).concat(Array.from(LANG.get('en').stopSet)));

  // Parola: lettere/cifre, con apostrofi e trattini interni
  // (i numeri con separatori, come 270.000 o 3,5, restano una parola sola)
  var WORD = /\p{N}+(?:[.,]\p{N}+)+|[\p{L}\p{N}][\p{L}\p{M}\p{N}'’\-]*[\p{L}\p{M}\p{N}]|[\p{L}\p{N}]/gu;

  // "dell'Odissea" -> "Odissea", "Calypso's" -> "Calypso", "don't" -> "don"
  function normPart(raw) {
    var s = raw.replace(/’/g, "'");
    var i = s.indexOf("'");
    if (i >= 0) {
      var before = s.slice(0, i), after = s.slice(s.lastIndexOf("'") + 1);
      s = after.length <= 2 ? before : after;
    }
    return s.replace(/^-+|-+$/g, '');
  }
  // Radice semplice: unisce singolare e plurale (gods/god, libri/libro, Häuser/Haus)
  function stem(w, lang) { return LANG.stem(lang || 'it', w); }
  function keyOf(raw, lang) { return stem(fold(normPart(raw)), lang); }
  function isStop(f, lang) {
    var set = lang ? LANG.get(lang).stopSet : STOP;
    return set.has(f) || f.length < 3 || /^\d+$/.test(f) || /\d.*\d.*\d/.test(f);
  }

  /*
   * Prepara i campi usati dall'analisi su ogni token.
   * lang: codice della lingua ('it', 'en', 'fr', 'es', 'de', 'pt'); se manca la riconosce dal testo.
   */
  function prepare(tokens, lang) {
    if (!lang) lang = LANG.detect(tokens);
    var stopSet = LANG.get(lang).stopSet;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var base = normPart(t.text);
      var f = fold(base);
      t.base = base;
      t.f = f;
      t.key = LANG.stem(lang, f);
      t.stop = stopSet.has(f) || f.length < 3 || /^\d+$/.test(f) || /\d.*\d.*\d/.test(f);
      t.cap = /^\p{Lu}/u.test(base);
      t.allcap = base.length > 1 && base === base.toUpperCase() && /\p{Lu}/u.test(base);
      t.acronym = t.allcap && base.length <= 6;
      if (t.gap === undefined) t.gap = ' ';
      if (t.blk === undefined) t.blk = 0;
      if (t.w === undefined) t.w = 1;
    }
    return tokens;
  }

  function detectLang(tokens) { return LANG.detect(tokens); }

  var END = /[.!?…]/;
  var OPEN = /[«"“‘'(\[—–¿¡-]/;

  /*
   * Divide i token in frasi. Una frase finisce quando:
   *  - cambia il blocco (paragrafo, titolo…), oppure
   *  - nello spazio prima della parola c'è un punto/!/?/… seguito da spazio, e la parola successiva
   *    comincia con maiuscola, cifra o virgolette, e il punto non è di un'abbreviazione o un'iniziale.
   * Imposta t.sid su ogni token e restituisce [{ id, from, to, text, blk, w }].
   */
  function sentences(tokens, lang) {
    var ABBR = LANG.get(lang || 'it').abbrSet;
    var ordinals = lang === 'de'; // "am 12. März", "im 19. Jahrhundert"
    var out = [];
    var start = 0;
    function close(end) {
      if (end <= start) return;
      out.push({ id: out.length, from: start, to: end });
      start = end;
    }
    for (var i = 1; i < tokens.length; i++) {
      var t = tokens[i], p = tokens[i - 1];
      var brk = false;
      if (t.blk !== p.blk) brk = true;
      else if (/\n\s*\n/.test(t.gap)) brk = true;
      else if (END.test(t.gap) && /\s/.test(t.gap)) {
        var after = t.gap.slice(t.gap.search(END));
        var nextOk = /^\p{Lu}|^\p{N}/u.test(t.text) || OPEN.test(after) || /\n/.test(t.gap);
        var abbr = ABBR.has(p.f) || (p.text.length === 1 && /\p{Lu}/u.test(p.text) && /^\.\s/.test(t.gap)) ||
          (ordinals && /^\d{1,2}$/.test(p.text) && /^\.[ \t]+$/.test(t.gap));
        var ellipsisMid = /…|\.\.\./.test(t.gap) && !/^\p{Lu}/u.test(t.text);
        if (nextOk && !abbr && !ellipsisMid) brk = true;
      } else if (i - start > 140 && /[;:]/.test(t.gap)) {
        brk = true; // frasi lunghissime: spezza su ; o :
      }
      if (brk) close(i);
    }
    close(tokens.length);
    out.forEach(function (s) {
      for (var k = s.from; k < s.to; k++) tokens[k].sid = s.id;
      s.blk = tokens[s.from].blk;
      s.w = tokens[s.from].w;
      s.text = sentenceText(tokens, s.from, s.to);
    });
    return out;
  }

  function sentenceText(tokens, from, to) {
    var s = '';
    for (var k = from; k < to; k++) {
      if (k > from) s += tokens[k].gap.replace(/\s+/g, ' ');
      s += tokens[k].text;
    }
    // punteggiatura finale (es. ". ” ?") presa dallo spazio dopo l'ultima parola
    if (to < tokens.length) {
      var m = tokens[to].gap.match(/^[^\s\p{L}\p{N}]*/u);
      if (m && m[0]) s += m[0].replace(/[«“(\[]+$/, '');
    } else {
      var tail = tokens[to - 1].tail;
      if (tail) s += tail;
    }
    var lead = tokens[from].gap.match(/[«“"(\[¿¡]+$/);
    if (lead) s = lead[0] + s;
    return s.trim();
  }

  // Tokenizza una stringa semplice (usato per i testi incollati e nei test)
  function tokenizeString(text, blk, w) {
    var out = [], m, last = 0;
    WORD.lastIndex = 0;
    while ((m = WORD.exec(text))) {
      out.push({ text: m[0], gap: text.slice(last, m.index), blk: blk || 0, w: w || 1, start: m.index, end: m.index + m[0].length });
      last = m.index + m[0].length;
    }
    if (out.length) out[out.length - 1].tail = text.slice(last).replace(/\s+$/, '');
    return out;
  }

  /*
   * Tokenizza una lista di blocchi [{ text, w }] in un'unica sequenza di token.
   * Lo spazio prima del primo token di un blocco contiene la coda del blocco precedente
   * (es. il punto finale) e un a capo, così la divisione in frasi resta corretta.
   */
  function tokenizeBlocks(blocks) {
    var out = [], prevTail = '';
    blocks.forEach(function (b, bi) {
      var toks = tokenizeString(b.text, bi, b.w || 1);
      if (!toks.length) return;
      toks[0].gap = (out.length ? prevTail + '\n' : '') + toks[0].gap;
      prevTail = toks[toks.length - 1].tail || '';
      toks.forEach(function (t) { t.block = b; });
      out.push.apply(out, toks);
    });
    return out;
  }

  g.WCText = {
    WORD: WORD, STOP: STOP, fold: fold, normPart: normPart, stem: stem, keyOf: keyOf, isStop: isStop,
    prepare: prepare, detectLang: detectLang, sentences: sentences, sentenceText: sentenceText, tokenizeString: tokenizeString, tokenizeBlocks: tokenizeBlocks
  };
})(globalThis);
