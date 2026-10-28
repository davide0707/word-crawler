// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: la ricerca per significato, imparata dai tuoi documenti.
 *
 * Fin qui la ricerca trovava le parole. Qui si trova il significato: chi cerca "quanto veloce va la
 * rete" deve trovare anche i passaggi che parlano di "throughput" e di "banda", anche se quelle
 * parole non le ha scritte.
 *
 * Come, senza modelli da scaricare: due parole che compaiono negli stessi contesti vogliono dire
 * cose vicine. È la stessa idea su cui si reggono gli embedding neurali, presa per la via diretta
 * e calcolabile in un secondo — l'indicizzazione casuale (random indexing):
 *   1. a ogni parola si dà un "segnaposto" casuale: un vettore di 192 numeri quasi tutti zero, con
 *      otto ±1 messi a caso ma in modo ripetibile (dipende dalla parola, non dal caso del momento);
 *   2. si scorre la libreria un pezzo alla volta. Per ogni pezzo si sommano i segnaposto delle
 *      parole che contiene, e a ogni parola si aggiunge la somma delle *altre*, pesata per quanto
 *      quella parola è rara (idf). Chi sta spesso in compagnia delle stesse parole finisce vicino;
 *   3. un passaggio, un concetto o una domanda diventano la somma dei vettori delle loro parole,
 *      normalizzata. La vicinanza è il coseno.
 * Il risultato non capisce il mondo: conosce solo i tuoi documenti. È il suo limite ed è anche il
 * suo pregio — "campo" vicino a "elettrico" se studi fisica, vicino a "modulo" se scrivi software.
 *
 * Tutto resta sul computer, non si scarica niente, non serve internet.
 *
 * WCSemantic.build(docs, opts) -> modello
 *   docs: [{ id, lang, chunks: [{ n, text }] }]
 *   modello: { ready, dims, terms, query(text, n, filter), near(word, n), vector(text),
 *              similarTo(vec, n, filter), termVector(word), stats }
 */
(function (g) {
  'use strict';
  if (g.WCSemantic) return;
  var T = g.WCText, LANG = g.WCLang;

  var DIMS = 192;       // lunghezza dei vettori
  var SEEDS = 8;        // quanti ±1 nel segnaposto di ogni parola
  var MAX_TERMS = 12000;
  var MIN_DF = 2;       // una parola vista una volta sola non insegna niente
  var MAX_CHUNK_TERMS = 160;

  function fold(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function hash(s, salt) {
    var h = 2166136261 ^ (salt || 0);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // il segnaposto di una parola: sempre lo stesso per la stessa parola, su qualunque computer
  function seedInto(word, vec, weight) {
    for (var k = 0; k < SEEDS; k++) {
      var h = hash(word, k * 7919 + 1);
      var at = h % DIMS;
      vec[at] += (h & 0x10000) ? weight : -weight;
    }
  }
  function norm(v) {
    var s = 0, i;
    for (i = 0; i < v.length; i++) s += v[i] * v[i];
    if (!s) return v;
    s = 1 / Math.sqrt(s);
    for (i = 0; i < v.length; i++) v[i] *= s;
    return v;
  }
  function dot(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  /*
   * Le parole ridotte alla radice: "segnale" e "segnali" sono la stessa cosa per il significato.
   * Se si passa `seen`, si tiene da parte anche la forma scritta più frequente di ogni radice: la
   * radice serve al calcolo, ma a chi legge si mostra una parola vera, non "segnal".
   */
  function stemsOf(text, lang, seen) {
    var toks = T.prepare(T.tokenizeString(String(text || '')), lang || 'it');
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (!t.key || t.stop) continue;
      if (t.key.length < 2 || /^\d+$/.test(t.key)) continue;
      out.push(t.key);
      if (seen) {
        var m = seen.get(t.key);
        if (!m) seen.set(t.key, (m = new Map()));
        var w = String(t.text || '').toLowerCase();
        if (w) m.set(w, (m.get(w) || 0) + 1);
      }
      if (out.length >= MAX_CHUNK_TERMS) break;
    }
    return out;
  }
  // la forma scritta più usata di una radice
  function bestForm(seen, key) {
    var m = seen.get(key);
    if (!m) return key;
    var best = key, n = -1;
    m.forEach(function (c, w) { if (c > n || (c === n && w.length < best.length)) { best = w; n = c; } });
    return best;
  }

  /*
   * Costruisce il modello. Una sola passata sui pezzi: si contano le parole, poi si sommano i
   * segnaposto. Su migliaia di passaggi sono frazioni di secondo.
   */
  function build(docs, opts) {
    var o = opts || {}, t0 = Date.now();
    var list = (docs || []).filter(function (d) { return d && d.chunks && d.chunks.length; });
    var df = new Map(), prepared = [], seen = new Map();
    list.forEach(function (d) {
      var lang = d.lang || 'it';
      d.chunks.forEach(function (c) {
        var st = stemsOf(c.text, lang, seen);
        if (st.length < 2) return;
        prepared.push({ doc: d.id, n: c.n, stems: st });
        var once = new Set();
        st.forEach(function (w) { if (!once.has(w)) { once.add(w); df.set(w, (df.get(w) || 0) + 1); } });
      });
    });
    var N = prepared.length;
    if (!N) return empty();

    /*
     * Il vocabolario: fuori le parole viste una volta sola, che non insegnano niente, e fuori quelle
     * che stanno ovunque, che non distinguono niente. Su una libreria piccola o molto ripetitiva
     * "ovunque" può voler dire tutto: in quel caso si allarga, meglio un modello debole che nessuno.
     */
    var vocab = [];
    function pick(ceil) {
      var out = [];
      df.forEach(function (n, w) { if (n >= MIN_DF && n <= N * ceil) out.push(w); });
      return out;
    }
    var ceils = [0.6, 0.9, 1];
    for (var ci = 0; ci < ceils.length && !vocab.length; ci++) vocab = pick(ceils[ci]);
    vocab.sort(function (a, b) { return df.get(b) - df.get(a); });
    vocab = vocab.slice(0, o.maxTerms || MAX_TERMS);
    if (!vocab.length) return empty();
    var idx = new Map(), idf = new Float32Array(vocab.length);
    vocab.forEach(function (w, i) {
      idx.set(w, i);
      idf[i] = Math.log(1 + N / (1 + df.get(w)));
    });

    // i segnaposto e i vettori di contesto
    var seeds = new Float32Array(vocab.length * DIMS);
    vocab.forEach(function (w, i) {
      var v = seeds.subarray(i * DIMS, i * DIMS + DIMS);
      seedInto(w, v, 1);
    });
    var ctx = new Float32Array(vocab.length * DIMS);
    var sum = new Float32Array(DIMS);
    prepared.forEach(function (p) {
      var ids = [];
      for (var i = 0; i < p.stems.length; i++) {
        var j = idx.get(p.stems[i]);
        if (j !== undefined) ids.push(j);
      }
      if (ids.length < 2) { p.ids = ids; return; }
      p.ids = ids;
      sum.fill(0);
      var k, d2;
      for (k = 0; k < ids.length; k++) {
        var s0 = ids[k] * DIMS, w0 = idf[ids[k]];
        for (d2 = 0; d2 < DIMS; d2++) sum[d2] += seeds[s0 + d2] * w0;
      }
      // a ogni parola la compagnia che ha avuto, meno sé stessa
      for (k = 0; k < ids.length; k++) {
        var at = ids[k] * DIMS, si = ids[k] * DIMS, wi = idf[ids[k]];
        for (d2 = 0; d2 < DIMS; d2++) ctx[at + d2] += sum[d2] - seeds[si + d2] * wi;
      }
    });
    // normalizzare: così il coseno è solo un prodotto
    for (var i2 = 0; i2 < vocab.length; i2++) norm(ctx.subarray(i2 * DIMS, i2 * DIMS + DIMS));

    // il vettore di ogni passaggio
    var vecs = new Float32Array(N * DIMS), meta = new Array(N);
    prepared.forEach(function (p, pi) {
      var v = vecs.subarray(pi * DIMS, pi * DIMS + DIMS);
      (p.ids || []).forEach(function (j) {
        var w = idf[j], at = j * DIMS;
        for (var d3 = 0; d3 < DIMS; d3++) v[d3] += ctx[at + d3] * w;
      });
      norm(v);
      meta[pi] = { doc: p.doc, n: p.n };
    });

    function termVector(word, lang) {
      var v = new Float32Array(DIMS), got = 0;
      stemsOf(word, lang).forEach(function (w) {
        var j = idx.get(w);
        if (j === undefined) return;
        got++;
        var at = j * DIMS, wi = idf[j];
        for (var d4 = 0; d4 < DIMS; d4++) v[d4] += ctx[at + d4] * wi;
      });
      if (!got) return null;
      return norm(v);
    }

    function similarTo(v, n, filter) {
      if (!v) return [];
      var out = [];
      for (var i3 = 0; i3 < N; i3++) {
        if (filter && !filter(meta[i3])) continue;
        var s = dot(v, vecs.subarray(i3 * DIMS, i3 * DIMS + DIMS));
        if (s > 0.02) out.push({ doc: meta[i3].doc, n: meta[i3].n, score: s });
      }
      out.sort(function (a, b) { return b.score - a.score; });
      return out.slice(0, n || 40);
    }

    /* Le parole più vicine a una parola: serve per spiegare perché un risultato è saltato fuori. */
    function near(word, n, lang) {
      var v = termVector(word, lang);
      if (!v) return [];
      var mine = new Set(stemsOf(word, lang));
      var out = [];
      for (var i4 = 0; i4 < vocab.length; i4++) {
        if (mine.has(vocab[i4])) continue;
        var s = dot(v, ctx.subarray(i4 * DIMS, i4 * DIMS + DIMS));
        if (s > 0.1) out.push({ term: vocab[i4], word: bestForm(seen, vocab[i4]), score: round(s) });
      }
      out.sort(function (a, b) { return b.score - a.score; });
      return out.slice(0, n || 12);
    }
    function round(x) { return Math.round(x * 1000) / 1000; }

    return {
      ready: true, dims: DIMS, terms: vocab.length, chunks: N,
      ms: Date.now() - t0,
      vector: termVector,
      termVector: termVector,
      near: near,
      similarTo: similarTo,
      query: function (text, n, filter, lang) { return similarTo(termVector(text, lang), n, filter); },
      has: function (word, lang) { return !!termVector(word, lang); },
      stats: function () { return { terms: vocab.length, chunks: N, dims: DIMS, ms: Date.now() - t0 }; }
    };
  }

  function empty() {
    return {
      ready: false, dims: DIMS, terms: 0, chunks: 0, ms: 0,
      vector: function () { return null; }, termVector: function () { return null; },
      near: function () { return []; }, similarTo: function () { return []; },
      query: function () { return []; }, has: function () { return false; },
      stats: function () { return { terms: 0, chunks: 0, dims: DIMS, ms: 0 }; }
    };
  }

  g.WCSemantic = { build: build, DIMS: DIMS, empty: empty };
})(globalThis);
