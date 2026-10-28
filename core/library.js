// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: la libreria (knowledge base locale, senza AI).
 *
 * Molti documenti diventano un'unica base di conoscenza:
 *  - ogni documento si divide in pezzi ("chunk": paragrafo, titolo, voce di elenco, righe di tabella,
 *    pezzo di un paragrafo lunghissimo), ognuno con la sua fonte esatta: pagina, slide, sezione, riquadro;
 *  - i concetti di ogni documento (parole chiave, nomi, termini definiti, sigle) si riconoscono con
 *    l'analisi statistica di sempre (analysis.js) e si uniscono tra i documenti: stessa radice = stesso
 *    concetto; "Quadrature Amplitude Modulation (QAM)" = la sigla e la sua forma estesa;
 *  - il grafo collega i concetti che compaiono negli stessi pezzi (co-occorrenza normalizzata) e legge
 *    le definizioni ("la QAM è una modulazione digitale…" -> QAM è un tipo di modulazione digitale);
 *  - la ricerca è ibrida: BM25 sulle parole (con le radici di ogni lingua) più i concetti del grafo,
 *    così cercando una sigla si trovano anche i passaggi che usano la forma estesa.
 * Le unioni che non sono ovvie (sigla e forma estesa in documenti diversi, nomi quasi uguali) diventano
 * suggerimenti: l'utente conferma o rifiuta. Rinomine, alias, collegamenti e posizioni sulla mappa sono
 * "modifiche" salvate a parte, che si riapplicano a ogni ricostruzione.
 *
 * WCLibrary.buildRecord(input, settings) -> Promise<record>   un documento pronto da salvare
 *   input: { meta: { id, path, name, ext, size, mtime, created, hash }, format, title, pages, ocrPages,
 *            warnings, tokens: [[text, gap, blk, w, page, box], ...], tail, blocks: [{ type, level, slide }] }
 *   box (facoltativo, PDF e OCR): [x, y, w, h] della parola in frazioni della pagina (0..1)
 * WCLibrary.open(records, edits) -> base di conoscenza:
 *   { search(query, filters), graph(), concept(id), applyEdit(op), edits(), docs(), markdown(), stats() }
 */
(function (g) {
  'use strict';
  if (g.WCLibrary) return;
  var T = g.WCText, LANG = g.WCLang;

  var VERSION = 1;
  var CHUNK_MAX = 220;      // parole oltre le quali un paragrafo si divide
  var CHUNK_TARGET = 150;   // lunghezza dei pezzi di un paragrafo diviso
  var MERGE_SMALL = 90;     // voci di elenco e righe di tabella vicine si uniscono fino a qui
  var MAX_CONCEPTS = 70;    // concetti tenuti per documento (più termini definiti e sigle)
  var MAX_CHUNK_NODES = 15; // concetti per pezzo usati per i collegamenti
  var EDGES_PER_NODE = 8;

  // ---------------------------------------------------------------- utilità
  function fold(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function indexable(t) { return !t.stop || (t.allcap && t.f.length >= 2 && !/^\d+$/.test(t.f)); }
  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function round(x, n) { var k = Math.pow(10, n || 3); return Math.round(x * k) / k; }
  function prepared(text, lang) { return T.prepare(T.tokenizeString(String(text || '')), lang); }

  // chiavi (radici) di una parola, con le parti delle parole col trattino ("16-QAM" -> "16-qam", "qam")
  function keysOfToken(t, lang, withWhole) {
    if (t.f.indexOf('-') < 0) return indexable(t) ? [t.key] : [];
    var out = withWhole && indexable(t) ? [t.key] : [];
    t.base.split('-').forEach(function (p) {
      if (!p) return;
      var pt = T.prepare([{ text: p }], lang)[0];
      if (indexable(pt)) out.push(pt.key);
    });
    return out;
  }
  // sequenza di chiavi di un testo (per riconoscere i concetti dentro i pezzi)
  function keySeq(toks, lang) {
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var ks = keysOfToken(toks[i], lang, false);
      for (var k = 0; k < ks.length; k++) out.push(ks[k]);
    }
    return out;
  }
  // chiave di un concetto: radici delle parole che contano, nella lingua del documento
  function ckey(label, lang) {
    var seq = keySeq(prepared(label, lang), lang);
    return seq.length ? seq.join(' ') : fold(label).trim();
  }

  // ---------------------------------------------------------------- pezzi (chunk)
  function blockRanges(toks) {
    var out = [];
    for (var i = 0; i < toks.length;) {
      var j = i + 1;
      while (j < toks.length && toks[j].blk === toks[i].blk) j++;
      out.push([i, j]);
      i = j;
    }
    return out;
  }

  function chunkTokens(toks, blocks, isPdf) {
    var chunks = [], section = '', cur = null;
    function emit(from, to, kind, info) {
      var t0 = toks[from], tl = toks[to - 1];
      var c = { n: chunks.length, kind: kind, text: T.sentenceText(toks, from, to).slice(0, 4000), section: section, from: from, to: to };
      if (t0.page != null) { c.page = t0.page; if (tl.page != null && tl.page !== t0.page) c.pageTo = tl.page; }
      if (info && info.slide) c.slide = info.slide;
      if (info && info.line) c.line = info.line; // file di codice: la riga da cui viene il pezzo
      var box = null;
      for (var k = from; k < to; k++) {
        var b = toks[k].box;
        if (!b || toks[k].page !== t0.page) continue;
        if (!box) box = [b[0], b[1], b[0] + b[2], b[1] + b[3]];
        else { box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]); box[2] = Math.max(box[2], b[0] + b[2]); box[3] = Math.max(box[3], b[1] + b[3]); }
      }
      if (box) c.box = box.map(function (v) { return round(v, 4); });
      chunks.push(c);
      return c;
    }
    blockRanges(toks).forEach(function (r) {
      var from = r[0], to = r[1], t0 = toks[from];
      var info = !isPdf && blocks ? blocks[t0.blk] : null;
      var kind = info ? info.type : (t0.w > 1 ? 'h' : 'p');
      if (kind === 'h' || t0.w > 1) {
        cur = null;
        section = T.sentenceText(toks, from, to).replace(/[.:]+$/, '').slice(0, 140);
        emit(from, to, 'h', info);
        return;
      }
      if ((kind === 'li' || kind === 'row') && cur && cur.kind === kind && cur.section === section &&
          cur.to === from && (to - cur.from) <= MERGE_SMALL && toks[from].page === toks[cur.from].page &&
          (!info || (info.slide || 0) === (cur.slide || 0))) {
        // stessa lista o stessa tabella: un pezzo solo
        var c = chunks[chunks.length - 1];
        c.to = to;
        c.text = T.sentenceText(toks, c.from, to).slice(0, 4000);
        if (toks[to - 1].page != null && toks[to - 1].page !== c.page) c.pageTo = toks[to - 1].page;
        cur = c;
        return;
      }
      if (to - from <= CHUNK_MAX) { cur = emit(from, to, kind || 'p', info); return; }
      // paragrafo lunghissimo: si divide tra una frase e l'altra
      var start = from;
      for (var k = from + 1; k <= to; k++) {
        var boundary = k === to || toks[k].sid !== toks[k - 1].sid;
        if (boundary && (k - start >= CHUNK_TARGET || k === to)) { emit(start, k, kind || 'p', info); start = k; }
        else if (k - start >= CHUNK_MAX * 1.5) { emit(start, k, kind || 'p', info); start = k; }
      }
      cur = null;
    });
    return chunks;
  }

  // ---------------------------------------------------------------- sigle
  var ACR_AFTER = /([\p{L}][\p{L}\p{M}'’\-]*(?:\s+[\p{L}][\p{L}\p{M}'’\-]*){1,7})\s*\(\s*([\p{Lu}][\p{Lu}\p{N}&\-]{1,9})\s*\)/gu;
  var ACR_BEFORE = /\b([\p{Lu}][\p{Lu}\p{N}&\-]{1,9})\s*\(\s*([\p{L}][\p{L}\p{M}'’\-]*(?:\s+[\p{L}][\p{L}\p{M}'’\-]*){1,7})\s*\)/gu;
  // la forma estesa che corrisponde alle lettere della sigla, presa dalla fine (o dall'inizio) del testo
  function matchLong(words, acr, lang, fromEnd) {
    var letters = acr.replace(/[^\p{L}]/gu, '').toLowerCase();
    if (letters.length < 2) return null;
    var stop = LANG.get(lang).stopSet;
    var order = fromEnd ? words.slice().reverse() : words.slice();
    var li = fromEnd ? letters.length - 1 : 0, used = [];
    for (var i = 0; i < order.length; i++) {
      var w = order[i], f = fold(w);
      if (!w) continue;
      var want = letters[li];
      if (f[0] === want) {
        used.push(i);
        li += fromEnd ? -1 : 1;
        if (fromEnd ? li < 0 : li >= letters.length) {
          var span = order.slice(0, i + 1);
          if (fromEnd) span.reverse();
          return span.join(' ');
        }
      } else if (!stop.has(f) || !used.length) {
        if (used.length) return null; // una parola che conta e non corrisponde: non è la forma estesa
        if (fromEnd) return null;
      }
    }
    return null;
  }
  function findAcronyms(text, lang) {
    var out = [], m;
    ACR_AFTER.lastIndex = 0;
    while ((m = ACR_AFTER.exec(text))) {
      var long = matchLong(m[1].split(/\s+/), m[2], lang, true);
      if (long) out.push({ acr: m[2], long: long });
    }
    ACR_BEFORE.lastIndex = 0;
    while ((m = ACR_BEFORE.exec(text))) {
      var long2 = matchLong(m[2].split(/\s+/), m[1], lang, false);
      if (long2) out.push({ acr: m[1], long: long2 });
    }
    return out;
  }
  function isAcronym(s) { return /^[\p{Lu}][\p{Lu}\p{N}&\-]{1,9}$/u.test(s) && /\p{Lu}.*\p{Lu}/u.test(s); }
  function initialsOf(label, lang) {
    var stop = LANG.get(lang || 'it').stopSet;
    return label.split(/[\s\-]+/).filter(function (w) { return w && !stop.has(fold(w)); }).map(function (w) { return fold(w)[0]; }).join('');
  }

  // ---------------------------------------------------------------- un documento
  function buildRecord(input, settings) {
    var meta = input.meta || {};
    var toks = (input.tokens || []).map(function (a) {
      var t = { text: a[0], gap: a[1], blk: a[2], w: a[3], page: a[4] == null ? null : a[4] };
      if (a[5]) t.box = a[5];
      return t;
    });
    if (toks.length && input.tail) toks[toks.length - 1].tail = input.tail;
    var s = settings || {};
    var lang = s.language && s.language !== 'auto' ? s.language : LANG.detect(toks);
    var base = {
      v: VERSION, id: meta.id, path: meta.path, name: meta.name, ext: meta.ext || '', size: meta.size || 0,
      mtime: meta.mtime || null, created: meta.created || null, hash: meta.hash || '', imported: meta.imported || new Date().toISOString(),
      format: input.format || '', title: input.title || meta.name || '', lang: lang, langName: LANG.get(lang).name,
      pages: input.pages || null, ocrPages: input.ocrPages || 0, words: toks.length, warnings: input.warnings || [],
      status: 'ok', error: null, summary: [], chunks: [], concepts: [], aliases: [],
      code: input.code ? compactCode(input.code) : null
    };
    if (!toks.length) { base.status = 'empty'; base.error = 'nessun testo da leggere'; return Promise.resolve(base); }
    return LANG.ensure(lang).then(function () {
      var opts = { mode: 'study', language: lang, selectivity: 4, markNames: true, markNumbers: false, markDefinitions: true, markKeySentences: true, summaryLength: 15 };
      var res = g.WCAnalysis.analyze(toks, opts).results;
      var chunks = chunkTokens(toks, input.blocks, !!input.pdf);
      var chunkOf = new Int32Array(toks.length);
      chunks.forEach(function (c) { for (var k = c.from; k < c.to; k++) chunkOf[k] = c.n; });

      // concetti candidati
      var cands = new Map();
      function add(label, score, kind, name) {
        // "Quadrature Amplitude Modulation (QAM" -> "Quadrature Amplitude Modulation"
        label = String(label || '').replace(/\s*\([^)]*\)?/g, ' ').replace(/\s+/g, ' ').replace(/^[\s«“"'(\[]+|[\s,;:.»”")\]]+$/g, '');
        if (!label || label.length < 2 || label.length > 80) return null;
        var key = ckey(label, lang);
        if (!key || key.length < 2) return null;
        var c = cands.get(key);
        if (!c) { c = { key: key, forms: new Map(), score: 0, kind: kind, name: !!name, defs: [], chunks: new Set(), count: 0 }; cands.set(key, c); }
        c.forms.set(label, (c.forms.get(label) || 0) + 1);
        if (score > c.score) c.score = score;
        if (name) c.name = true;
        return c;
      }
      var maxScore = res.keywords.length ? res.keywords[0].score || 1 : 1;
      res.keywords.forEach(function (k) { add(k.word, k.score / maxScore, k.phrase ? 'phrase' : 'word', k.name); });
      var nNames = 0;
      res.highlights.forEach(function (h) {
        if (h.type === 'name' && nNames < 30) { nNames++; add(h.text, 0.15, 'name', true); }
      });
      res.highlights.forEach(function (h) {
        if (h.type !== 'def') return;
        var term = LANG.defTerm(lang, h.text);
        // "Più alto è il rapporto…" non è una definizione: il termine non comincia con una parola vuota
        if (!term || LANG.get(lang).stopSet.has(fold(term.split(/\s+/)[0]))) return;
        var c = add(term, 0.3, 'term', false);
        if (c && c.defs.length < 4) c.defs.push({ text: h.text, n: chunkOf[Math.max(0, Math.min(toks.length - 1, h.idx))] });
      });
      // sigle con la forma estesa scritta nel testo
      var aliasSeen = new Set();
      chunks.forEach(function (ch) {
        findAcronyms(ch.text, lang).forEach(function (p) {
          var a = add(p.acr, 0.25, 'acronym', false), b = add(p.long, 0.25, 'phrase', false);
          if (!a || !b || a === b) return;
          var k = pairKey(a.key, b.key);
          if (aliasSeen.has(k)) return;
          aliasSeen.add(k);
          base.aliases.push([p.acr, p.long]);
        });
      });

      /*
       * I simboli del codice diventano concetti come gli altri: così entrano nella ricerca, nel grafo
       * e nello studio senza regole a parte. Il commento sopra la funzione fa da definizione, la riga
       * fa da fonte, e il conteggio degli usi arriva dalla scansione qui sotto (una funzione chiamata
       * in dieci punti compare in dieci pezzi).
       */
      if (input.code && input.code.symbols) {
        var CK = (g.WCCode && g.WCCode.KIND_IT) || {};
        input.code.symbols.forEach(function (sym) {
          if (!sym.name || sym.name.length < 2) return;
          var c = add(sym.name, sym.kind === 'function' || sym.kind === 'class' || sym.kind === 'method' ? 0.9 : 0.4, 'code:' + sym.kind, false);
          if (!c) return;
          c.code = { kind: sym.kind, line: sym.line, endLine: sym.endLine, signature: sym.signature || sym.name, params: sym.params || [], exported: !!sym.exported, complexity: sym.complexity || 1, base: sym.base || '' };
          if (sym.doc && c.defs.length < 4) c.defs.push({ text: (CK[sym.kind] || sym.kind) + ' ' + sym.name + ': ' + sym.doc, n: 0, code: true });
        });
      }

      // dove compare ogni concetto (sequenza di radici dentro il pezzo)
      var byFirst = new Map();
      cands.forEach(function (c) {
        c.seq = c.key.split(' ');
        var f = c.seq[0];
        if (!byFirst.has(f)) byFirst.set(f, []);
        byFirst.get(f).push(c);
      });
      chunks.forEach(function (ch) {
        var seq = keySeq(toks.slice(ch.from, ch.to), lang);
        for (var i = 0; i < seq.length; i++) {
          var list = byFirst.get(seq[i]);
          if (!list) continue;
          for (var j = 0; j < list.length; j++) {
            var c = list[j], ok = true;
            for (var k = 1; k < c.seq.length; k++) if (seq[i + k] !== c.seq[k]) { ok = false; break; }
            if (ok) { c.count++; c.chunks.add(ch.n); }
          }
        }
      });

      // la definizione di un simbolo punta al pezzo con la sua firma, non al primo dove compare
      cands.forEach(function (c) {
        if (!c.code || !c.defs.length) return;
        var want = fold((((g.WCCode || {}).KIND_IT || {})[c.code.kind] || '') + ' ' + (c.code.signature || ''));
        var at = null;
        chunks.forEach(function (ch) { if (at === null && want && fold(ch.text).indexOf(want) === 0) at = ch.n; });
        if (at === null && c.chunks.size) at = Math.min.apply(null, Array.from(c.chunks));
        c.defs.forEach(function (d) { if (d.code && at !== null) d.n = at; });
      });
      // in un file di codice le parole del linguaggio non sono concetti
      if (input.code && g.WCCode) {
        var CSTOP = g.WCCode.STOP;
        Array.from(cands.keys()).forEach(function (k) {
          var c = cands.get(k);
          if (c.code) return;
          var only = Array.from(c.forms.keys()).every(function (f) { return CSTOP.has(fold(f)); });
          if (only) cands.delete(k);
        });
      }
      var list = Array.from(cands.values()).filter(function (c) { return c.chunks.size || c.defs.length; });
      list.sort(function (a, b) { return b.score - a.score || b.count - a.count; });
      // una parola sola, comparsa una volta, che non è un nome, una sigla o un termine definito: troppo debole
      list = list.filter(function (c, i) { return i < 5 || c.count >= 2 || c.name || c.defs.length || c.code || c.kind === 'acronym' || c.seq.length > 1; });
      var keep = new Set(list.slice(0, MAX_CONCEPTS));
      list.forEach(function (c) { if (c.defs.length || c.code || c.kind === 'acronym') keep.add(c); });
      base.aliases.forEach(function (p) { [ckey(p[0], lang), ckey(p[1], lang)].forEach(function (k) { if (cands.get(k)) keep.add(cands.get(k)); }); });
      base.concepts = list.filter(function (c) { return keep.has(c); }).map(function (c) {
        var forms = Array.from(c.forms.entries()).sort(function (a, b) { return b[1] - a[1]; }).map(function (e) { return e[0]; });
        var o = { key: c.key, label: forms[0], forms: forms.slice(0, 6), score: round(c.score), count: c.count, name: c.name, kind: c.kind, defs: c.defs };
        if (c.code) o.code = c.code;
        return o;
      });
      base.summary = res.summary.slice(0, 6).map(function (x) { return { text: x.text, n: chunkOf[Math.max(0, Math.min(toks.length - 1, x.idx))] }; });
      base.keywords = res.keywords.slice(0, 12).map(function (k) { return k.word; });
      base.readability = res.stats ? { value: res.stats.readability, scale: res.stats.readabilityScale, label: res.stats.readabilityLabel } : null;
      base.chunks = chunks.map(function (c) {
        var o = { n: c.n, kind: c.kind, text: c.text };
        if (c.section) o.section = c.section;
        if (c.page != null) o.page = c.page;
        if (c.pageTo != null) o.pageTo = c.pageTo;
        if (c.slide) o.slide = c.slide;
        if (c.line) o.line = c.line;
        if (c.box) o.box = c.box;
        return o;
      });
      if (base.warnings.length) base.status = 'partial';
      return base;
    });
  }

  // ---------------------------------------------------------------- dove si trova un pezzo
  function where(rec, ch) {
    var parts = [];
    if (ch.page != null) parts.push('p. ' + (ch.page + 1) + (ch.pageTo != null ? '–' + (ch.pageTo + 1) : ''));
    if (ch.slide) parts.push('slide ' + ch.slide);
    if (ch.line) parts.push('riga ' + ch.line);
    if (ch.section && ch.kind !== 'h') parts.push(ch.section);
    return parts.join(' · ');
  }

  // ---------------------------------------------------------------- base di conoscenza
  function emptyEdits() {
    return { v: 1, merges: [], unmerges: [], rejected: [], labels: {}, aliases: [], links: [], unlinks: [], pos: {}, log: [] };
  }
  function cleanEdits(e) {
    var d = emptyEdits();
    if (!e || typeof e !== 'object') return d;
    Object.keys(d).forEach(function (k) {
      if (Array.isArray(d[k]) && Array.isArray(e[k])) d[k] = e[k].slice(0, 20000);
      else if (!Array.isArray(d[k]) && e[k] && typeof e[k] === 'object' && !Array.isArray(e[k])) d[k] = e[k];
    });
    return d;
  }

  var QUERY_NOISE = new Set(['dove', 'parlato', 'parla', 'parlano', 'parlo', 'trova', 'trovami', 'mostrami', 'mostra', 'cerca', 'quali', 'quale',
    'documenti', 'documento', 'pdf', 'file', 'passaggi', 'citano', 'cita', 'spiegami', 'tutte', 'tutti', 'definizioni', 'definizione', 'cosa', 'come',
    'where', 'find', 'show', 'which', 'documents', 'mention', 'mentions', 'talk', 'talked', 'about', 'all', 'definitions']);

  function open(records, rawEdits) {
    var docs = [], byId = new Map();
    var edits = cleanEdits(rawEdits);
    var chunksAll = [];     // { d, c }
    var postings = new Map();
    var lens = [], avgLen = 1;
    var langs = new Set();
    var graphCache = null;

    // -------------------------------------------------------------- indice delle parole
    function indexRecord(rec, di) {
      langs.add(rec.lang);
      rec.chunks.forEach(function (ch) {
        var id = chunksAll.length;
        var toks = prepared(ch.text, rec.lang);
        chunksAll.push({ d: di, c: ch, seq: keySeq(toks, rec.lang) });
        var tf = new Map(), len = 0;
        for (var i = 0; i < toks.length; i++) {
          var ks = keysOfToken(toks[i], rec.lang, true);
          for (var k = 0; k < ks.length; k++) { var term = rec.lang + ':' + ks[k]; tf.set(term, (tf.get(term) || 0) + 1); len++; }
        }
        lens.push(len);
        tf.forEach(function (n, term) {
          var p = postings.get(term);
          if (!p) { p = []; postings.set(term, p); }
          p.push(id, n);
        });
      });
    }
    (records || []).forEach(function (r) {
      if (!r || !r.id || !Array.isArray(r.chunks)) return;
      var di = docs.length;
      docs.push(r);
      byId.set(r.id, di);
      indexRecord(r, di);
    });
    if (lens.length) avgLen = lens.reduce(function (a, b) { return a + b; }, 0) / lens.length || 1;

    // -------------------------------------------------------------- grafo
    function buildGraph() {
      var parent = new Map();
      function find(k) { var p = parent.get(k); if (p === undefined) { parent.set(k, k); return k; } if (p === k) return k; var r = find(p); parent.set(k, r); return r; }
      var blocked = new Set(edits.unmerges.map(function (p) { return pairKey(p[0], p[1]); }));
      function union(a, b) {
        if (!a || !b || a === b || blocked.has(pairKey(a, b))) return;
        var ra = find(a), rb = find(b);
        if (ra !== rb) { if (ra < rb) parent.set(rb, ra); else parent.set(ra, rb); }
      }
      // concetti di tutti i documenti
      var occ = new Map(); // chiave -> [{ d, c }]
      docs.forEach(function (r, di) {
        (r.concepts || []).forEach(function (c) {
          find(c.key);
          if (!occ.has(c.key)) occ.set(c.key, []);
          occ.get(c.key).push({ d: di, c: c });
        });
      });
      var keyLang = new Map();
      occ.forEach(function (list, k) { keyLang.set(k, docs[list[0].d].lang); });
      // sigle scritte con la forma estesa: unione sicura
      docs.forEach(function (r) {
        (r.aliases || []).forEach(function (p) { var a = ckey(p[0], r.lang), b = ckey(p[1], r.lang); if (occ.has(a) && occ.has(b)) union(a, b); });
      });
      edits.merges.forEach(function (p) { if (occ.has(p[0]) && occ.has(p[1])) union(p[0], p[1]); });
      var userForms = new Map(); // radice -> [alias scritti dall'utente]
      edits.aliases.forEach(function (a) {
        if (!occ.has(a.key)) return;
        if (a.akey && occ.has(a.akey)) union(a.key, a.akey);
      });
      edits.aliases.forEach(function (a) {
        if (!occ.has(a.key)) return;
        var r = find(a.key);
        if (!userForms.has(r)) userForms.set(r, []);
        userForms.get(r).push(a.text);
      });

      // dove compare ogni concetto, in tutti i documenti (anche in quelli dove l'analisi non l'aveva scelto)
      var byFirst = new Map();
      occ.forEach(function (list, k) {
        var seq = k.split(' ');
        if (!byFirst.has(seq[0])) byFirst.set(seq[0], []);
        byFirst.get(seq[0]).push({ seq: seq, key: k });
      });
      var keyChunks = new Map(), keyCount = new Map(), keyFree = new Map();
      chunksAll.forEach(function (x) {
        var seq = x.seq, found = [];
        for (var i = 0; i < seq.length; i++) {
          var l = byFirst.get(seq[i]);
          if (!l) continue;
          for (var j = 0; j < l.length; j++) {
            var e = l[j], ok = true;
            for (var k = 1; k < e.seq.length; k++) if (seq[i + k] !== e.seq[k]) { ok = false; break; }
            if (ok) found.push([i, i + e.seq.length, e.key]);
          }
        }
        found.forEach(function (m) {
          keyCount.set(m[2], (keyCount.get(m[2]) || 0) + 1);
          // dentro un concetto più lungo ("Amplitude Modulation" dentro "Quadrature Amplitude Modulation")?
          var inside = found.some(function (o) { return o !== m && o[1] - o[0] > m[1] - m[0] && o[0] <= m[0] && o[1] >= m[1]; });
          if (!inside) keyFree.set(m[2], (keyFree.get(m[2]) || 0) + 1);
          var arr = keyChunks.get(m[2]);
          if (!arr) { arr = []; keyChunks.set(m[2], arr); }
          var last = arr[arr.length - 1];
          if (!last || last[0] !== x.d || last[1] !== x.c.n) arr.push([x.d, x.c.n]);
        });
      });
      // un concetto che compare solo dentro un concetto più lungo è un pezzo di quello: non è un nodo
      var groupSize = new Map();
      occ.forEach(function (l, k) { var r = find(k); groupSize.set(r, (groupSize.get(r) || 0) + 1); });
      Array.from(occ.keys()).forEach(function (k) {
        if (keyFree.get(k) || !keyCount.get(k) || groupSize.get(find(k)) > 1) return;
        if (occ.get(k).some(function (o) { return (o.c.defs && o.c.defs.length) || o.c.kind === 'acronym'; })) return;
        occ.delete(k);
      });

      // nodi
      var groups = new Map();
      occ.forEach(function (list, k) { var r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k); });
      var nodes = new Map(), nodeOfKey = new Map();
      groups.forEach(function (members) {
        members.sort();
        var id = members[0];
        var forms = new Map(), docCount = new Map(), chunks = [], chunkSeen = new Set(), defs = [], defSeen = new Set();
        var score = 0, count = 0, name = false, kinds = new Set(), code = null;
        members.forEach(function (k) {
          nodeOfKey.set(k, id);
          occ.get(k).forEach(function (o) {
            var c = o.c;
            c.forms.forEach(function (f, i) { forms.set(f, (forms.get(f) || 0) + (i === 0 ? c.count + 1 : 1)); });
            (c.defs || []).forEach(function (df) { var dk = fold(df.text); if (!defSeen.has(dk) && defs.length < 12) { defSeen.add(dk); defs.push({ text: df.text, d: o.d, n: df.n }); } });
            score += c.score; if (c.name) name = true; kinds.add(c.kind);
            if (c.code && (!code || c.score > (code.score || 0))) { code = Object.assign({}, c.code, { docIndex: o.d }); }
          });
          (keyChunks.get(k) || []).forEach(function (dc) {
            var key = dc[0] + ':' + dc[1];
            if (!chunkSeen.has(key)) { chunkSeen.add(key); chunks.push(dc); }
            var rid = docs[dc[0]].id;
            docCount.set(rid, (docCount.get(rid) || 0) + 1);
          });
          count += keyCount.get(k) || 0;
        });
        chunks.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
        var fl = Array.from(forms.entries()).sort(function (a, b) { return b[1] - a[1] || a[0].length - b[0].length; });
        var label = null;
        members.forEach(function (k) { if (edits.labels[k]) label = String(edits.labels[k]); });
        var extra = userForms.get(find(id)) || [];
        nodes.set(id, {
          id: id, members: members, memberLabels: members.map(function (k) { return occ.get(k)[0].c.label; }), label: label || fl[0][0], forms: fl.map(function (e) { return e[0]; }).concat(extra.filter(function (x) { return !forms.has(x); })),
          userAliases: extra, docs: Array.from(docCount.entries()).map(function (e) { return { id: e[0], count: e[1] }; }).sort(function (a, b) { return b.count - a.count; }),
          chunks: chunks, defs: defs, score: score, count: count, name: name, kinds: Array.from(kinds), code: code, lang: keyLang.get(id) || 'it'
        });
      });

      // collegamenti: concetti negli stessi pezzi
      var perChunk = new Map();
      nodes.forEach(function (nd) {
        nd.chunks.forEach(function (dc) { var k = dc[0] + ':' + dc[1]; if (!perChunk.has(k)) perChunk.set(k, []); perChunk.get(k).push(nd); });
      });
      var co = new Map();
      perChunk.forEach(function (list) {
        if (list.length < 2) return;
        if (list.length > MAX_CHUNK_NODES) list = list.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, MAX_CHUNK_NODES);
        for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
          var k = pairKey(list[i].id, list[j].id);
          co.set(k, (co.get(k) || 0) + 1);
        }
      });
      var edges = new Map();
      co.forEach(function (c, k) {
        var ab = k.split('|'), A = nodes.get(ab[0]), B = nodes.get(ab[1]);
        var w = c / Math.sqrt(A.chunks.length * B.chunks.length);
        if (c >= 2 || w >= 0.5) edges.set(k, { a: ab[0], b: ab[1], c: c, w: w, type: 'co' });
      });
      /*
       * Archi dal codice: chi chiama chi ("usa"), cosa importa cosa ("dipende da"), chi eredita da chi.
       * Sono relazioni certe, lette dalla struttura del file, non dedotte dal testo: hanno un peso alto
       * e vincono sulla semplice co-occorrenza.
       */
      var CODE_REL = { use: 'usa', dep: 'dipende da', ext: 'eredita da' };
      function codeNode(name2, lang2) {
        var k = ckey(name2, lang2);
        return k ? nodeOfKey.get(k) : null;
      }
      docs.forEach(function (r) {
        if (!r.code) return;
        (r.code.calls || []).forEach(function (c) {
          if (!c.from || !c.to) return;
          var a = codeNode(c.from, r.lang), b = codeNode(c.to, r.lang);
          if (!a || !b || a === b) return;
          var k = pairKey(a, b), e = edges.get(k);
          if (!e) { e = { a: a, b: b, c: 0, w: 0.75, type: 'use', label: CODE_REL.use }; edges.set(k, e); }
          else if (e.type === 'co') { e.type = 'use'; e.label = CODE_REL.use; e.a = a; e.b = b; e.w = Math.max(e.w, 0.75); }
        });
        (r.code.symbols || []).forEach(function (sym) {
          if (!sym.base) return;
          var a2 = codeNode(sym.name, r.lang), b2 = codeNode(sym.base, r.lang);
          if (!a2 || !b2 || a2 === b2) return;
          var k2 = pairKey(a2, b2);
          edges.set(k2, { a: a2, b: b2, c: 0, w: 0.9, type: 'ext', label: CODE_REL.ext });
        });
      });
      // dipendenze tra file: il file che importa -> il file importato (quando è nella libreria)
      var byBase = new Map();
      docs.forEach(function (r, di) {
        var bn = String(r.name || '').replace(/\.[^.]+$/, '').toLowerCase();
        if (bn) { if (!byBase.has(bn)) byBase.set(bn, []); byBase.get(bn).push(di); }
      });
      docs.forEach(function (r) {
        if (!r.code) return;
        (r.code.imports || []).forEach(function (im) {
          var target = String(im.from || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '').toLowerCase();
          if (!target) return;
          (byBase.get(target) || []).forEach(function (di2) {
            if (docs[di2] === r) return;
            // il collegamento è tra i concetti più centrali dei due file: li rappresentano
            var a3 = mainNodeOf(r), b3 = mainNodeOf(docs[di2]);
            if (!a3 || !b3 || a3 === b3) return;
            var k3 = pairKey(a3, b3);
            if (!edges.has(k3)) edges.set(k3, { a: a3, b: b3, c: 0, w: 0.6, type: 'dep', label: CODE_REL.dep });
          });
        });
      });
      function mainNodeOf(r) {
        var best = null;
        (r.concepts || []).forEach(function (c) {
          if (!c.code || (c.code.kind !== 'class' && c.code.kind !== 'function')) return;
          if (!best || c.score > best.score) best = c;
        });
        return best ? nodeOfKey.get(best.key) : null;
      }

      // relazioni lette nelle definizioni
      var firstIdx = new Map();
      nodes.forEach(function (nd) {
        nd.members.forEach(function (k) {
          var seq = k.split(' '); if (!firstIdx.has(seq[0])) firstIdx.set(seq[0], []);
          firstIdx.get(seq[0]).push({ seq: seq, id: nd.id });
        });
      });
      // (?:^|\s) e non \b: \b non riconosce le lettere accentate (è, é)
      var COPULA = { it: /(?:^|\s)(?:è|sono|e')\s+(?:un|una|uno|un'|l'|il|la)\s*/i, en: /(?:^|\s)(?:is|are)\s+(?:a|an|the)\s+/i, fr: /(?:^|\s)(?:est|sont)\s+(?:un|une|le|la|l')\s*/i,
        es: /(?:^|\s)(?:es|son)\s+(?:un|una|el|la)\s+/i, de: /(?:^|\s)(?:ist|sind)\s+(?:ein|eine|einer|der|die|das)\s+/i, pt: /(?:^|\s)(?:é|são)\s+(?:um|uma|o|a)\s+/i };
      function conceptsIn(text, lang) {
        var seq = keySeq(prepared(text, lang), lang), found = [];
        for (var i = 0; i < seq.length; i++) {
          var l = firstIdx.get(seq[i]);
          if (!l) continue;
          l.forEach(function (x) {
            for (var k = 1; k < x.seq.length; k++) if (seq[i + k] !== x.seq[k]) return;
            found.push({ id: x.id, at: i, end: i + x.seq.length });
          });
        }
        return found.filter(function (m) { return !found.some(function (o) { return o !== m && o.end - o.at > m.end - m.at && o.at <= m.at && o.end >= m.end; }); });
      }
      nodes.forEach(function (nd) {
        nd.defs.forEach(function (df) {
          var lang = docs[df.d].lang, text = df.text;
          var m = (COPULA[lang] || COPULA.it).exec(text);
          var head = m ? conceptsIn(text.slice(m.index + m[0].length, m.index + m[0].length + 70), lang) : [];
          var typeOf = null;
          head.forEach(function (h) { if (!typeOf && h.id !== nd.id && h.at <= 4) typeOf = h.id; });
          conceptsIn(text, lang).forEach(function (h) {
            if (h.id === nd.id) return;
            var k = pairKey(nd.id, h.id), e = edges.get(k);
            var type = h.id === typeOf ? 'isa' : 'def';
            if (!e) { e = { a: nd.id, b: h.id, c: 0, w: 0.35, type: type }; edges.set(k, e); }
            else if (e.type === 'co' || (type === 'isa' && e.type !== 'isa')) { e.type = type; e.a = nd.id; e.b = h.id; e.w = Math.max(e.w, 0.35); }
          });
        });
      });
      // solo i collegamenti più forti di ogni concetto (più quelli letti nelle definizioni)
      var byNode = new Map();
      edges.forEach(function (e, k) {
        [e.a, e.b].forEach(function (id) { if (!byNode.has(id)) byNode.set(id, []); byNode.get(id).push(k); });
      });
      var keepE = new Set();
      byNode.forEach(function (ks) {
        ks.sort(function (x, y) { return edges.get(y).w - edges.get(x).w; });
        ks.forEach(function (k, i) { if (i < EDGES_PER_NODE || edges.get(k).type !== 'co') keepE.add(k); });
      });
      Array.from(edges.keys()).forEach(function (k) { if (!keepE.has(k)) edges.delete(k); });
      // modifiche dell'utente
      edits.unlinks.forEach(function (p) {
        var a = nodeOfKey.get(p[0]), b = nodeOfKey.get(p[1]);
        if (a && b) edges.delete(pairKey(a, b));
      });
      edits.links.forEach(function (l) {
        var a = nodeOfKey.get(l.a), b = nodeOfKey.get(l.b);
        if (a && b && a !== b) edges.set(pairKey(a, b), { a: a, b: b, c: 0, w: 0.6, type: 'user', label: String(l.label || 'collegato a').slice(0, 60) });
      });

      // importanza: PageRank sui collegamenti
      var ids = Array.from(nodes.keys()), idx = new Map(ids.map(function (id, i) { return [id, i]; }));
      var n = ids.length, adj = ids.map(function () { return []; });
      edges.forEach(function (e) { var i = idx.get(e.a), j = idx.get(e.b); adj[i].push([j, e.w]); adj[j].push([i, e.w]); });
      var pr = pagerank(n, adj);
      var ranked = ids.map(function (id, i) { return [id, pr[i]]; }).filter(function (x) { return adj[idx.get(x[0])].length; }).sort(function (a, b) { return b[1] - a[1]; });
      var nCentral = Math.max(1, Math.round(ranked.length * 0.1));
      var central = new Set(ranked.slice(0, nCentral).map(function (x) { return x[0]; }));
      nodes.forEach(function (nd) {
        var i = idx.get(nd.id);
        nd.rank = pr[i] * n;
        nd.deg = adj[i].length;
        nd.central = central.has(nd.id);
        nd.multi = nd.docs.length >= 2;
        nd.weight = Math.log(2 + nd.count) * (0.6 + nd.score) * (0.5 + nd.rank);
      });

      // concetti forse uguali: l'utente conferma
      var rejected = new Set(edits.rejected.map(function (p) { return pairKey(nodeOfKey.get(p[0]) || p[0], nodeOfKey.get(p[1]) || p[1]); }));
      var sugg = [], suggSeen = new Set();
      function suggest(a, b, reason) {
        if (a.id === b.id) return;
        var k = pairKey(a.id, b.id);
        if (suggSeen.has(k) || rejected.has(k) || blocked.has(k)) return;
        suggSeen.add(k);
        sugg.push({ a: a.id, b: b.id, la: a.label, lb: b.label, reason: reason });
      }
      var byInitials = new Map();
      nodes.forEach(function (nd) {
        if (nd.label.split(/\s+/).length < 2) return;
        var ini = initialsOf(nd.label, nd.lang);
        if (ini.length < 2) return;
        if (!byInitials.has(ini)) byInitials.set(ini, []);
        byInitials.get(ini).push(nd);
      });
      nodes.forEach(function (nd) {
        nd.forms.forEach(function (f) {
          if (!isAcronym(f)) return;
          (byInitials.get(fold(f).replace(/[^a-z0-9]/g, '')) || []).forEach(function (o) { suggest(nd, o, 'la sigla «' + f + '» corrisponde alle iniziali di «' + o.label + '»'); });
        });
      });
      var flat = new Map();
      nodes.forEach(function (nd) {
        var f = fold(nd.label).replace(/[^a-z0-9]/g, '');
        if (f.length < 4) return;
        if (flat.has(f)) suggest(flat.get(f), nd, 'stesso nome scritto in modo diverso');
        else flat.set(f, nd);
      });
      var longs = Array.from(nodes.values()).filter(function (nd) { return nd.label.length >= 7 && nd.label.split(/\s+/).length <= 3; });
      if (longs.length <= 3000) {
        var byLen = new Map();
        longs.forEach(function (nd) { var L = fold(nd.label).length; if (!byLen.has(L)) byLen.set(L, []); byLen.get(L).push(nd); });
        longs.forEach(function (nd) {
          var a = fold(nd.label);
          for (var L = a.length - 2; L <= a.length + 2; L++) {
            (byLen.get(L) || []).forEach(function (o) {
              if (o.id <= nd.id) return;
              var b = fold(o.label);
              if (a[0] !== b[0]) return;
              var d = lev(a, b, 2);
              if (d > 0 && d <= 2 && 1 - d / Math.max(a.length, b.length) >= 0.8 && !/\d/.test(a + b)) suggest(nd, o, 'nomi quasi uguali («' + nd.label + '», «' + o.label + '»)');
            });
          }
        });
      }
      sugg.sort(function (x, y) { return (nodes.get(y.a).weight + nodes.get(y.b).weight) - (nodes.get(x.a).weight + nodes.get(x.b).weight); });

      var E = Array.from(edges.values());
      var pos = layout(nodes, E, edits.pos, nodeOfKey);
      return { nodes: nodes, edges: E, suggestions: sugg.slice(0, 200), nodeOfKey: nodeOfKey, pos: pos };
    }

    function graph() {
      if (!graphCache) graphCache = buildGraph();
      return graphCache;
    }

    // -------------------------------------------------------------- ricerca
    function parseQuery(q) {
      var phrases = [], rest = String(q || '').replace(/"([^"]{2,200})"|“([^”]{2,200})”/g, function (m, a, b) { phrases.push(a || b); return ' '; });
      var words = (rest.match(new RegExp(T.WORD.source, 'gu')) || []).filter(function (w) { return w.length > 0; });
      if (words.length >= 3) words = words.filter(function (w) { return !QUERY_NOISE.has(fold(w)); });
      return { words: words.slice(0, 40), phrases: phrases.slice(0, 5) };
    }

    function search(query, filters) {
      var t0 = Date.now();
      var f = filters || {};
      var q = parseQuery(query);
      var N = chunksAll.length;
      var empty = { query: query, total: 0, results: [], concepts: [], ms: 0 };
      if (!N || (!q.words.length && !q.phrases.length)) return empty;
      var docOk = docs.map(function (r) {
        if (f.docs && f.docs.length && f.docs.indexOf(r.id) < 0) return false;
        if (f.langs && f.langs.length && f.langs.indexOf(r.lang) < 0) return false;
        if (f.exts && f.exts.length && f.exts.indexOf(r.ext) < 0) return false;
        if (f.from && (r.mtime || r.imported) < f.from) return false;
        if (f.to && (r.mtime || r.imported) > f.to) return false;
        return true;
      });
      var scores = new Float64Array(N), hitWords = new Uint32Array(N);
      var qkeys = new Map(); // lingua -> Set(chiavi), per evidenziare
      langs.forEach(function (L) { qkeys.set(L, new Set()); });
      var k1 = 1.2, b = 0.75;
      var allWords = q.words.concat.apply(q.words, q.phrases.map(function (p) { return p.split(/\s+/); }));
      allWords.forEach(function (w, wi) {
        langs.forEach(function (L) {
          var toks = prepared(w, L);
          toks.forEach(function (t) {
            keysOfToken(t, L, true).forEach(function (key) {
              qkeys.get(L).add(key);
              var p = postings.get(L + ':' + key);
              if (!p) return;
              var df = p.length / 2;
              var idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
              for (var i = 0; i < p.length; i += 2) {
                var id = p[i], tf = p[i + 1];
                scores[id] += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * lens[id] / avgLen));
                if (wi < 32) hitWords[id] |= (1 << wi);
              }
            });
          });
        });
      });
      // concetti: la domanda (o una sua parte) è il nome o un alias di un concetto
      var G = graph(), conceptHits = [], conceptIds = new Set();
      var content = q.words.concat(q.phrases);
      function tryConcept(text) {
        var hit = null;
        langs.forEach(function (L) { var id = G.nodeOfKey.get(ckey(text, L)); if (id && !hit) hit = id; });
        if (!hit) G.nodes.forEach(function (nd) { if (!hit && nd.userAliases.some(function (a) { return fold(a) === fold(text); })) hit = nd.id; });
        return hit;
      }
      for (var len = Math.min(5, q.words.length); len >= 1; len--) {
        for (var s = 0; s + len <= q.words.length; s++) {
          var id = tryConcept(q.words.slice(s, s + len).join(' '));
          if (id && !conceptIds.has(id)) conceptIds.add(id);
        }
      }
      q.phrases.forEach(function (p) { var id = tryConcept(p); if (id) conceptIds.add(id); });
      if (f.concept && G.nodes.has(f.concept)) conceptIds.add(f.concept);
      var chunkIndex = null;
      conceptIds.forEach(function (id) {
        var nd = G.nodes.get(id);
        conceptHits.push({ id: id, label: nd.label, forms: nd.forms.slice(0, 6), docs: nd.docs.length, count: nd.count });
        nd.forms.forEach(function (form) { langs.forEach(function (L) { prepared(form, L).forEach(function (t) { keysOfToken(t, L, true).forEach(function (k) { qkeys.get(L).add(k); }); }); }); });
        if (!chunkIndex) { chunkIndex = new Map(); chunksAll.forEach(function (x, i) { chunkIndex.set(x.d + ':' + x.c.n, i); }); }
        nd.chunks.forEach(function (dc) {
          var i = chunkIndex.get(dc[0] + ':' + dc[1]);
          if (i !== undefined) { scores[i] += 3; hitWords[i] |= 0x80000000; }
        });
      });
      // frasi tra virgolette: devono esserci così come sono
      var phraseF = q.phrases.map(fold);
      var cands = [];
      for (var i = 0; i < N; i++) {
        if (!docOk[chunksAll[i].d]) continue;
        if (f.concept && !(hitWords[i] & 0x80000000)) continue;
        if (phraseF.length) {
          var txt = fold(chunksAll[i].c.text), all = true;
          for (var k = 0; k < phraseF.length; k++) if (txt.indexOf(phraseF[k]) < 0) { all = false; break; }
          if (!all) continue;
          if (!scores[i]) scores[i] = 0.5;
          scores[i] += 2 * phraseF.length;
        }
        if (scores[i] <= 0) continue;
        // più parole della domanda nello stesso pezzo: più in alto
        var matched = popcount(hitWords[i] & 0x7fffffff), total = Math.min(32, allWords.length) || 1;
        cands.push([i, scores[i] * (1 + 0.6 * matched / total)]);
      }
      cands.sort(function (x, y) { return y[1] - x[1]; });
      var limit = Math.max(1, Math.min(200, f.limit || 60));
      var results = cands.slice(0, limit).map(function (x) {
        var e = chunksAll[x[0]], r = docs[e.d], ch = e.c;
        var snip = snippet(ch.text, qkeys.get(r.lang), phraseF, r.lang);
        return {
          doc: r.id, name: r.name, title: r.title, ext: r.ext, format: r.format, path: r.path, lang: r.lang,
          n: ch.n, kind: ch.kind, page: ch.page, pageTo: ch.pageTo, slide: ch.slide, line: ch.line, section: ch.section, where: where(r, ch), box: ch.box,
          text: snip.text, marks: snip.marks, full: ch.text, score: round(x[1], 2), concepts: conceptsOfChunk(G, e.d, ch.n, 4)
        };
      });
      return { query: query, total: cands.length, results: results, concepts: conceptHits, words: q.words, phrases: q.phrases, ms: Date.now() - t0 };
    }

    var chunkConcepts = null;
    function conceptsOfChunk(G, d, n, max) {
      if (!chunkConcepts) {
        chunkConcepts = new Map();
        G.nodes.forEach(function (nd) { nd.chunks.forEach(function (dc) { var k = dc[0] + ':' + dc[1]; if (!chunkConcepts.has(k)) chunkConcepts.set(k, []); chunkConcepts.get(k).push(nd); }); });
        chunkConcepts.forEach(function (l) { l.sort(function (a, b) { return b.weight - a.weight; }); });
      }
      return (chunkConcepts.get(d + ':' + n) || []).slice(0, max || 4).map(function (nd) { return { id: nd.id, label: nd.label }; });
    }

    function snippet(text, keys, phrases, lang) {
      var toks = T.prepare(T.tokenizeString(text), lang), marks = [];
      toks.forEach(function (t) {
        var ks = keysOfToken(t, lang, true);
        if (ks.some(function (k) { return keys && keys.has(k); })) marks.push([t.start, t.end]);
      });
      var ft = fold(text);
      phrases.forEach(function (p) { var i = ft.indexOf(p); if (i >= 0) marks.push([i, i + p.length]); });
      marks.sort(function (a, b) { return a[0] - b[0]; });
      var MAXL = 320;
      if (text.length <= MAXL) return { text: text, marks: marks };
      var first = marks.length ? marks[0][0] : 0;
      var from = Math.max(0, first - 90);
      if (from > 0) { var sp = text.indexOf(' ', from); if (sp > 0 && sp < first) from = sp + 1; }
      var to = Math.min(text.length, from + MAXL);
      if (to < text.length) { var sp2 = text.lastIndexOf(' ', to); if (sp2 > from + 100) to = sp2; }
      var pre = from > 0 ? '…' : '', post = to < text.length ? '…' : '';
      return {
        text: pre + text.slice(from, to) + post,
        marks: marks.filter(function (m) { return m[0] >= from && m[1] <= to; }).map(function (m) { return [m[0] - from + pre.length, m[1] - from + pre.length]; })
      };
    }

    // -------------------------------------------------------------- per l'interfaccia
    function nodeOut(nd, pos) {
      var p = pos.get(nd.id) || [0, 0];
      return { id: nd.id, label: nd.label, ndocs: nd.docs.length, count: nd.count, weight: round(nd.weight, 3), rank: round(nd.rank, 3), deg: nd.deg,
        central: nd.central, multi: nd.multi, name: nd.name, defs: nd.defs.length, lang: nd.lang, members: nd.members, code: nd.code ? nd.code.kind : null,
        x: round(p[0], 1), y: round(p[1], 1), pinned: !!p.pinned, docs: nd.docs.map(function (d) { return d.id; }) };
    }
    function graphOut() {
      var G = graph();
      var nodes = [];
      G.nodes.forEach(function (nd) { nodes.push(nodeOut(nd, G.pos)); });
      nodes.sort(function (a, b) { return b.weight - a.weight; });
      return {
        nodes: nodes,
        edges: G.edges.map(function (e) { return { a: e.a, b: e.b, w: round(e.w, 3), c: e.c, type: e.type, label: e.label || REL[e.type] }; }),
        suggestions: G.suggestions,
        stats: stats()
      };
    }
    var REL = { co: 'compare con', def: 'nella definizione', isa: 'è un tipo di', user: 'collegato a', use: 'usa', dep: 'dipende da', ext: 'eredita da' };

    /*
     * I concetti in forma leggera, con la loro prima definizione: servono per costruire le
     * alternative sbagliate di un quiz senza aprire la scheda di ognuno.
     */
    function pool(limit) {
      var G = graph(), out = [];
      G.nodes.forEach(function (nd) {
        out.push({ id: nd.id, label: nd.label, rank: round(nd.rank, 3), defs: nd.defs.length,
          code: nd.code ? nd.code.kind : null, firstDef: nd.defs.length ? nd.defs[0].text : '' });
      });
      out.sort(function (a, b) { return b.rank - a.rank; });
      return out.slice(0, limit || 400);
    }

    function concept(id) {
      var G = graph(), nd = G.nodes.get(G.nodeOfKey.get(id) || id);
      if (!nd) return null;
      var related = G.edges.filter(function (e) { return e.a === nd.id || e.b === nd.id; }).map(function (e) {
        var other = e.a === nd.id ? e.b : e.a, o = G.nodes.get(other);
        var label = e.label || REL[e.type];
        if (e.type === 'isa' || e.type === 'def') label = e.a === nd.id ? REL[e.type] : (e.type === 'isa' ? 'ha come tipo' : 'usato per definire');
        if (e.type === 'use') label = e.a === nd.id ? 'usa' : 'usato da';
        if (e.type === 'ext') label = e.a === nd.id ? 'eredita da' : 'ereditato da';
        if (e.type === 'dep') label = e.a === nd.id ? 'dipende da' : 'usato da';
        return { id: other, label: o.label, rel: label, type: e.type, w: round(e.w, 3), c: e.c };
      }).sort(function (a, b) { return (b.type !== 'co') - (a.type !== 'co') || b.w - a.w; });
      var sources = nd.chunks.slice(0, 120).map(function (dc) {
        var r = docs[dc[0]], ch = r.chunks[dc[1]];
        if (!ch) return null;
        return { doc: r.id, name: r.name, title: r.title, path: r.path, n: ch.n, page: ch.page, slide: ch.slide, line: ch.line, section: ch.section, where: where(r, ch), box: ch.box,
          text: ch.text.length > 260 ? ch.text.slice(0, 257) + '…' : ch.text, full: ch.text };
      }).filter(Boolean);
      var defs = nd.defs.map(function (df) {
        var r = docs[df.d], ch = r.chunks[df.n] || {};
        return { text: df.text, doc: r.id, name: r.name, path: r.path, n: df.n, page: ch.page, slide: ch.slide, line: ch.line, where: where(r, ch) };
      });
      var log = edits.log.filter(function (l) { return (l.keys || []).some(function (k) { return nd.members.indexOf(k) >= 0; }); }).slice(-30);
      return {
        id: nd.id, label: nd.label, members: nd.members, memberLabels: nd.memberLabels, forms: nd.forms, userAliases: nd.userAliases, defs: defs, sources: sources, total: nd.chunks.length,
        docs: nd.docs.map(function (d) { var r = docs[byId.get(d.id)]; return { id: d.id, name: r.name, count: d.count }; }),
        related: related, central: nd.central, multi: nd.multi, count: nd.count, rank: round(nd.rank, 3), code: nd.code || null,
        suggestions: G.suggestions.filter(function (s) { return s.a === nd.id || s.b === nd.id; }), log: log
      };
    }

    // -------------------------------------------------------------- modifiche dell'utente
    function logEdit(what, text, keys) {
      edits.log.push({ t: new Date().toISOString(), what: what, text: text, keys: keys });
      if (edits.log.length > 2000) edits.log = edits.log.slice(-2000);
    }
    function applyEdit(op) {
      var G = graph(), o = op || {};
      function nodeOf(id) { var n = G.nodes.get(G.nodeOfKey.get(id) || id); if (!n) throw new Error('concetto non trovato'); return n; }
      var A, B;
      switch (o.type) {
        case 'merge':
          A = nodeOf(o.a); B = nodeOf(o.b);
          if (A.id === B.id) break;
          edits.merges.push([A.id, B.id]);
          edits.unmerges = edits.unmerges.filter(function (p) { return !(A.members.indexOf(p[0]) >= 0 && B.members.indexOf(p[1]) >= 0) && !(A.members.indexOf(p[1]) >= 0 && B.members.indexOf(p[0]) >= 0); });
          logEdit('merge', 'Uniti «' + A.label + '» e «' + B.label + '»', A.members.concat(B.members));
          break;
        case 'reject':
          A = nodeOf(o.a); B = nodeOf(o.b);
          edits.rejected.push([A.id, B.id]);
          logEdit('reject', '«' + A.label + '» e «' + B.label + '» restano separati', [A.id, B.id]);
          break;
        case 'split': // separa una forma (radice) dal concetto in cui era stata unita
          A = nodeOf(o.id);
          if (A.members.indexOf(o.member) < 0 || A.members.length < 2) throw new Error('niente da separare');
          A.members.forEach(function (k) { if (k !== o.member) edits.unmerges.push([k, o.member]); });
          edits.merges = edits.merges.filter(function (p) { return p[0] !== o.member && p[1] !== o.member; });
          logEdit('split', 'Separato «' + o.member + '» da «' + A.label + '»', A.members);
          break;
        case 'rename':
          A = nodeOf(o.id);
          var label = String(o.label || '').trim().slice(0, 80);
          A.members.forEach(function (k) { delete edits.labels[k]; });
          if (label) edits.labels[A.id] = label;
          logEdit('rename', 'Rinominato «' + A.label + '» in «' + (label || A.label) + '»', A.members);
          break;
        case 'alias':
          A = nodeOf(o.id);
          var text = String(o.text || '').trim().slice(0, 80);
          if (!text) throw new Error('alias vuoto');
          edits.aliases.push({ key: A.id, text: text, akey: ckey(text, A.lang) });
          logEdit('alias', 'Aggiunto l’alias «' + text + '» a «' + A.label + '»', A.members);
          break;
        case 'unalias':
          A = nodeOf(o.id);
          edits.aliases = edits.aliases.filter(function (a) { return !(A.members.indexOf(a.key) >= 0 && a.text === o.text); });
          logEdit('unalias', 'Tolto l’alias «' + o.text + '» da «' + A.label + '»', A.members);
          break;
        case 'link':
          A = nodeOf(o.a); B = nodeOf(o.b);
          if (A.id === B.id) throw new Error('scegli due concetti diversi');
          edits.unlinks = edits.unlinks.filter(function (p) { return pairKey(p[0], p[1]) !== pairKey(A.id, B.id); });
          edits.links.push({ a: A.id, b: B.id, label: String(o.label || 'collegato a').slice(0, 60) });
          logEdit('link', 'Collegati «' + A.label + '» e «' + B.label + '»', [A.id, B.id]);
          break;
        case 'unlink':
          A = nodeOf(o.a); B = nodeOf(o.b);
          edits.links = edits.links.filter(function (l) { return pairKey(l.a, l.b) !== pairKey(A.id, B.id); });
          edits.unlinks.push([A.id, B.id]);
          logEdit('unlink', 'Tolto il collegamento tra «' + A.label + '» e «' + B.label + '»', [A.id, B.id]);
          break;
        case 'pos':
          (o.list || []).slice(0, 5000).forEach(function (p) {
            if (G.nodes.has(p.id) && isFinite(p.x) && isFinite(p.y)) edits.pos[p.id] = [round(p.x, 1), round(p.y, 1)];
          });
          // la posizione non cambia il grafo: si aggiorna solo la cache
          (o.list || []).forEach(function (p) { var q = G.pos.get(p.id); if (q) { q[0] = p.x; q[1] = p.y; q.pinned = true; } });
          return { edits: edits };
        case 'unpin':
          A = nodeOf(o.id);
          A.members.forEach(function (k) { delete edits.pos[k]; });
          break;
        default:
          throw new Error('modifica sconosciuta');
      }
      graphCache = null;
      chunkConcepts = null;
      return { edits: edits };
    }

    // -------------------------------------------------------------- esportazioni
    function markdown() {
      var G = graph();
      var list = Array.from(G.nodes.values()).sort(function (a, b) { return b.weight - a.weight; });
      var out = ['# Mappa dei concetti', '', docs.length + ' documenti · ' + list.length + ' concetti · ' + G.edges.length + ' collegamenti', ''];
      list.forEach(function (nd) {
        out.push('## ' + nd.label, '');
        var al = nd.forms.filter(function (f) { return f !== nd.label; });
        if (al.length) out.push('Alias: ' + al.join(', '), '');
        nd.defs.forEach(function (df) {
          var r = docs[df.d], ch = r.chunks[df.n] || {};
          out.push('> ' + df.text, '> — *' + r.name + '*' + (where(r, ch) ? ', ' + where(r, ch) : ''), '');
        });
        var rel = G.edges.filter(function (e) { return e.a === nd.id || e.b === nd.id; }).sort(function (a, b) { return b.w - a.w; }).slice(0, 10);
        if (rel.length) {
          out.push('Collegato a: ' + rel.map(function (e) {
            var other = G.nodes.get(e.a === nd.id ? e.b : e.a);
            var r = e.type === 'isa' && e.a === nd.id ? ' (è un tipo di)' : (e.type === 'user' ? ' (' + (e.label || 'collegato a') + ')' : '');
            return '[[' + other.label + ']]' + r;
          }).join(', '), '');
        }
        out.push('Fonti: ' + nd.docs.map(function (d) { return docs[byId.get(d.id)].name; }).join(', '), '');
      });
      return out.join('\n');
    }

    /*
     * Domande sul codice, risposte con la struttura già letta (niente AI):
     *  who-calls   chi chiama X        uses       di cosa ha bisogno X
     *  dead        codice mai usato    todos      le cose da fare
     *  complexity  le funzioni più intricate      glossary  tutti i simboli per file
     *  deps        quale file dipende da quale
     * Ogni risposta porta file e riga, così si apre il punto esatto.
     */
    function codeDocs() { return docs.filter(function (r) { return r.code && r.code.symbols; }); }
    function symbolsOf(r) {
      return (r.code.symbols || []).map(function (s) { return { name: s.name, kind: s.kind, line: s.line, endLine: s.endLine, doc: s.doc, signature: s.signature, complexity: s.complexity, exported: s.exported, params: s.params }; });
    }
    function srcOf(r, line) {
      var at = null;
      (r.chunks || []).forEach(function (ch) { if (ch.line === line && at === null) at = ch.n; });
      // "file" e non "name": chi chiama aggiunge il nome del simbolo, e i due non devono pestarsi
      return { doc: r.id, file: r.name, path: r.path, line: line, n: at == null ? 0 : at, where: 'riga ' + line };
    }

    function code(op) {
      var o = op || {}, files = codeDocs();
      if (o.doc) files = files.filter(function (r) { return r.id === o.doc; });
      var kind = o.kind || 'overview';
      var name = String(o.name || '').trim();
      var fold2 = fold(name);

      if (kind === 'who-calls') {
        var out = [];
        files.forEach(function (r) {
          (r.code.calls || []).forEach(function (c) {
            if (fold(c.to) !== fold2) return;
            out.push(Object.assign(srcOf(r, c.line), { caller: c.from || '(fuori da una funzione)', target: c.to }));
          });
        });
        return { kind: kind, name: name, items: out };
      }
      if (kind === 'uses') {
        var sym = null, host = null;
        files.forEach(function (r) { (r.code.symbols || []).forEach(function (s2) { if (!sym && fold(s2.name) === fold2) { sym = s2; host = r; } }); });
        if (!sym) return { kind: kind, name: name, items: [], imports: [] };
        var inner = (host.code.calls || []).filter(function (c) { return c.from && fold(c.from) === fold2; })
          .map(function (c) { return Object.assign(srcOf(host, c.line), { target: c.to, known: !!c.known }); });
        return { kind: kind, name: sym.name, symbol: sym, inFile: host.name, items: inner, imports: host.code.imports || [] };
      }
      if (kind === 'dead') {
        if (!g.WCCode) return { kind: kind, items: [] };
        var dd = g.WCCode.dead(files.map(function (r) {
          return { name: r.name, path: r.path, doc: r.id, symbols: r.code.symbols, calls: r.code.calls, imports: r.code.imports, usage: r.code.usage };
        }));
        return { kind: kind, items: dd.map(function (x) {
          var r2 = docs[byId.get(x.doc)] || files[0];
          return Object.assign(srcOf(r2, x.line), { name: x.name, symbolKind: x.kind });
        }) };
      }
      if (kind === 'todos') {
        var td = [];
        files.forEach(function (r) { (r.code.todos || []).forEach(function (t) { td.push(Object.assign(srcOf(r, t.line), { tag: t.tag, text: t.text })); }); });
        td.sort(function (a, b) { return a.file.localeCompare(b.file) || a.line - b.line; });
        return { kind: kind, items: td };
      }
      if (kind === 'complexity') {
        var cx = [];
        files.forEach(function (r) {
          symbolsOf(r).forEach(function (s3) {
            if (s3.kind !== 'function' && s3.kind !== 'method') return;
            cx.push(Object.assign(srcOf(r, s3.line), { name: s3.name, complexity: s3.complexity, length: (s3.endLine - s3.line + 1), signature: s3.signature }));
          });
        });
        cx.sort(function (a, b) { return b.complexity - a.complexity || b.length - a.length; });
        return { kind: kind, items: cx.slice(0, o.limit || 60) };
      }
      if (kind === 'glossary') {
        return { kind: kind, files: files.map(function (r) {
          return { doc: r.id, name: r.name, path: r.path, lang: r.code.langName, stats: r.code.stats, symbols: symbolsOf(r) };
        }) };
      }
      if (kind === 'deps') {
        // quale file importa quale: si confronta il nome del modulo col nome dei file della libreria
        var base = new Map();
        files.forEach(function (r) { base.set(String(r.name).replace(/\.[^.]+$/, '').toLowerCase(), r); });
        var nodes = files.map(function (r) { return { doc: r.id, name: r.name, lang: r.code.langName, symbols: (r.code.symbols || []).length }; });
        var links = [], out2 = [];
        files.forEach(function (r) {
          (r.code.imports || []).forEach(function (im) {
            var t = String(im.from || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '').toLowerCase();
            var hit = base.get(t);
            if (hit && hit !== r) links.push({ from: r.id, to: hit.id, fromName: r.name, toName: hit.name, line: im.line });
            else if (im.from) out2.push({ from: r.id, fromName: r.name, module: im.from, line: im.line });
          });
        });
        var ext = new Map();
        out2.forEach(function (x) { ext.set(x.module, (ext.get(x.module) || 0) + 1); });
        return { kind: kind, nodes: nodes, links: links, external: Array.from(ext.entries()).map(function (e) { return { module: e[0], count: e[1] }; }).sort(function (a, b) { return b.count - a.count; }) };
      }
      // riepilogo
      var tot = { files: files.length, lines: 0, code: 0, comment: 0, symbols: 0, functions: 0, classes: 0, todos: 0, imports: 0, maxComplexity: 0 };
      var langs2 = new Map();
      files.forEach(function (r) {
        var st = r.code.stats || {};
        tot.lines += st.lines || 0; tot.code += st.code || 0; tot.comment += st.comment || 0;
        tot.symbols += (r.code.symbols || []).length; tot.todos += (r.code.todos || []).length; tot.imports += (r.code.imports || []).length;
        tot.maxComplexity = Math.max(tot.maxComplexity, st.maxComplexity || 0);
        (r.code.symbols || []).forEach(function (s4) { if (s4.kind === 'function' || s4.kind === 'method') tot.functions++; else if (s4.kind === 'class') tot.classes++; });
        langs2.set(r.code.langName, (langs2.get(r.code.langName) || 0) + 1);
      });
      tot.langs = Array.from(langs2.entries()).map(function (e) { return { name: e[0], files: e[1] }; }).sort(function (a, b) { return b.files - a.files; });
      tot.dead = g.WCCode ? g.WCCode.dead(files.map(function (r) {
        return { name: r.name, path: r.path, doc: r.id, symbols: r.code.symbols, calls: r.code.calls, imports: r.code.imports, usage: r.code.usage };
      })).length : 0;
      return { kind: 'overview', stats: tot, files: files.map(function (r) { return { doc: r.id, name: r.name, lang: r.code.langName, symbols: (r.code.symbols || []).length, lines: (r.code.stats || {}).lines || 0 }; }) };
    }

    /* Documentazione automatica del codice, in Markdown: glossario, dipendenze, complessità, cose da fare. */
    function codeMarkdown(op) {
      var ov = code({ kind: 'overview', doc: (op || {}).doc });
      if (!ov.stats.files) return '# Codice\n\nNessun file di codice in questo cervello.\n';
      var gl = code({ kind: 'glossary', doc: (op || {}).doc });
      var dp = code({ kind: 'deps', doc: (op || {}).doc });
      var cx = code({ kind: 'complexity', doc: (op || {}).doc, limit: 20 });
      var dd = code({ kind: 'dead', doc: (op || {}).doc });
      var td = code({ kind: 'todos', doc: (op || {}).doc });
      var CK = (g.WCCode || {}).KIND_IT || {};
      var o = ['# Documentazione del codice', '',
        ov.stats.files + ' file · ' + ov.stats.lines.toLocaleString('it-IT') + ' righe · ' + ov.stats.symbols + ' elementi · ' +
        ov.stats.functions + ' funzioni · ' + ov.stats.classes + ' classi', '',
        'Linguaggi: ' + ov.stats.langs.map(function (l) { return l.name + ' (' + l.files + ')'; }).join(', '), ''];
      if (dp.links.length) {
        o.push('## Dipendenze tra i file', '', '```mermaid', 'graph LR');
        dp.links.slice(0, 200).forEach(function (l) { o.push('  ' + mid(l.fromName) + '[' + l.fromName + '] --> ' + mid(l.toName) + '[' + l.toName + ']'); });
        o.push('```', '');
      }
      if (dp.external.length) {
        o.push('## Librerie esterne', '');
        dp.external.slice(0, 40).forEach(function (e) { o.push('- `' + e.module + '` — usata in ' + e.count + (e.count === 1 ? ' file' : ' file')); });
        o.push('');
      }
      o.push('## Glossario', '');
      gl.files.forEach(function (f) {
        o.push('### ' + f.name, '', f.lang + ' · ' + (f.stats.lines || 0) + ' righe', '');
        f.symbols.slice(0, 300).forEach(function (s5) {
          o.push('- **' + s5.name + '** — ' + (CK[s5.kind] || s5.kind) + ', riga ' + s5.line + (s5.doc ? '. ' + s5.doc : ''));
        });
        o.push('');
      });
      if (cx.items.length) {
        o.push('## Funzioni più intricate', '', '| Funzione | File | Riga | Complessità | Righe |', '|---|---|---|---|---|');
        cx.items.forEach(function (x) { o.push('| ' + x.name + ' | ' + x.file + ' | ' + x.line + ' | ' + x.complexity + ' | ' + x.length + ' |'); });
        o.push('');
      }
      if (dd.items.length) {
        o.push('## Forse codice morto', '', 'Nessuno li chiama, non sono esportati e non sono punti di ingresso.', '');
        dd.items.forEach(function (x) { o.push('- `' + x.name + '` (' + (CK[x.symbolKind] || x.symbolKind) + ') — ' + x.file + ', riga ' + x.line); });
        o.push('');
      }
      if (td.items.length) {
        o.push('## Da fare', '');
        td.items.forEach(function (x) { o.push('- **' + x.tag + '** ' + x.text + ' — ' + x.file + ', riga ' + x.line); });
        o.push('');
      }
      return o.join('\n');
    }
    function mid(s) { return 'n' + hash32(String(s)).toString(36); }

    /*
     * Quello che il cervello nota da solo. Niente AI: sono controlli su quello che è già stato
     * estratto, e ognuno dice perché, con la fonte.
     *  - lacune: concetti nominati spesso ma mai definiti, e concetti isolati dal resto;
     *  - contraddizioni: lo stesso concetto definito in due modi che non stanno insieme;
     *  - divergenze: la documentazione cita una funzione che nel codice non c'è (o viceversa).
     */
    var NEG = { it: /\b(non|né|senza|mai)\b/i, en: /\b(not|never|without|no)\b/i, fr: /\b(ne|pas|jamais|sans)\b/i,
      es: /\b(no|nunca|sin)\b/i, de: /\b(nicht|kein|nie|ohne)\b/i, pt: /\b(não|nunca|sem)\b/i };

    function insights(opts) {
      var o = opts || {}, G = graph(), out = { gaps: [], orphans: [], contradictions: [], drift: [], hubs: [] };
      if (!G.nodes.size) return out;
      var limit = o.limit || 40;

      // G.nodes è la mappa dei nodi veri: defs e docs sono elenchi, non conteggi
      G.nodes.forEach(function (n) {
        if (o.doc && !n.docs.some(function (d) { return d.id === o.doc; })) return;
        var nd2 = n.docs.length;
        // nominato spesso, mai definito: è un buco negli appunti
        if (!n.defs.length && n.count >= 4 && !n.code) out.gaps.push({ id: n.id, label: n.label, count: n.count, ndocs: nd2, why: 'nominato ' + n.count + ' volte, mai definito' });
        // isolato: nessun collegamento con il resto
        if (!n.deg && n.count >= 2) out.orphans.push({ id: n.id, label: n.label, count: n.count, ndocs: nd2, why: 'non è collegato a nessun altro concetto' });
        if (n.deg >= 12) out.hubs.push({ id: n.id, label: n.label, deg: n.deg, why: plural(n.deg, 'collegamento', 'collegamenti') });
      });
      out.gaps.sort(function (a, b) { return b.count - a.count; });
      out.orphans.sort(function (a, b) { return b.count - a.count; });
      out.hubs.sort(function (a, b) { return b.deg - a.deg; });

      /*
       * Contraddizioni. Due definizioni dello stesso concetto si contraddicono quando dicono cose
       * diverse su un punto verificabile: un numero diverso, oppure una negata e l'altra no. Il resto
       * (due definizioni che si completano) non è una contraddizione, e non viene segnalato.
       */
      G.nodes.forEach(function (nd) {
        if (o.doc && !nd.docs.some(function (d) { return d.id === o.doc; })) return;
        if (nd.defs.length < 2) return;
        for (var i = 0; i < nd.defs.length && out.contradictions.length < limit; i++) {
          for (var j = i + 1; j < nd.defs.length; j++) {
            var A = nd.defs[i], B = nd.defs[j];
            if (A.d === B.d) continue; // stesso documento: è un ripasso, non un disaccordo
            var ra = docs[A.d], rb = docs[B.d];
            var why = disagree(A.text, B.text, ra.lang);
            if (!why) continue;
            out.contradictions.push({
              id: nd.id, label: nd.label, why: why,
              a: { text: A.text, doc: ra.id, name: ra.name, path: ra.path, n: A.n, where: where(ra, ra.chunks[A.n] || {}) },
              b: { text: B.text, doc: rb.id, name: rb.name, path: rb.path, n: B.n, where: where(rb, rb.chunks[B.n] || {}) }
            });
            break;
          }
        }
      });

      // la documentazione cita una funzione che nel codice non c'è
      var symbols = new Map();
      docs.forEach(function (r) {
        if (!r.code) return;
        (r.code.symbols || []).forEach(function (sy) { if (!symbols.has(sy.name)) symbols.set(sy.name, { file: r.name, sym: sy }); });
      });
      if (symbols.size) {
        var seenD = new Set();
        docs.forEach(function (r) {
          if (r.code || !r.chunks) return;
          r.chunks.forEach(function (ch) {
            var m, RE2 = /([A-Za-z_$][\w$]{2,40})\s*\(\s*\)/g;
            while ((m = RE2.exec(ch.text)) && out.drift.length < limit) {
              var nm = m[1];
              if (symbols.has(nm) || seenD.has(nm) || /^(se|if|per|vedi|nota|figura|tabella|http|www)$/i.test(nm)) continue;
              seenD.add(nm);
              out.drift.push({ name: nm, doc: r.id, file: r.name, path: r.path, n: ch.n, where: where(r, ch),
                text: ch.text.slice(0, 200), why: 'la documentazione cita «' + nm + '()», nel codice non c’è' });
            }
          });
        });
      }
      out.gaps = out.gaps.slice(0, limit);
      out.orphans = out.orphans.slice(0, limit);
      out.hubs = out.hubs.slice(0, 12);
      return out;
    }

    function disagree(a, b, lang) {
      var na = String(a).match(/-?\d+(?:[.,]\d+)?/g) || [], nb = String(b).match(/-?\d+(?:[.,]\d+)?/g) || [];
      if (na.length && nb.length && na[0] !== nb[0] && fold(a).slice(0, 25) !== fold(b).slice(0, 25)) {
        return 'una dice ' + na[0] + ', l’altra ' + nb[0];
      }
      var re = NEG[lang] || NEG.it;
      var ka = re.test(a), kb2 = re.test(b);
      if (ka !== kb2) {
        // stesse parole portanti, ma una è negata
        var wa = new Set(fold(a).split(/\W+/).filter(function (w) { return w.length > 4; }));
        var wb = fold(b).split(/\W+/).filter(function (w) { return w.length > 4; });
        var same = wb.filter(function (w) { return wa.has(w); }).length;
        if (same >= 3) return 'una nega quello che l’altra afferma';
      }
      return null;
    }

    /*
     * "Spiega": una spiegazione costruita soltanto con le frasi che ci sono nei documenti. Prima la
     * definizione, poi il capostipite, poi i concetti collegati con la loro frase, infine dove
     * leggere il resto. Ogni riga porta la sua fonte: niente è inventato.
     */
    function explain(id, opts) {
      var G = graph(), nd = G.nodes.get(G.nodeOfKey.get(id) || id);
      if (!nd) return null;
      var o = opts || {}, maxRel = o.related || 6;
      function src(d, n) { var r = docs[d], ch = r.chunks[n] || {}; return { doc: r.id, name: r.name, path: r.path, n: n, where: where(r, ch) }; }
      var parts = [];
      nd.defs.slice(0, 2).forEach(function (df) { parts.push({ role: 'def', text: df.text, source: src(df.d, df.n) }); });
      if (!parts.length) {
        // nessuna definizione: si prende la frase più ricca in cui compare
        var best = null;
        nd.chunks.slice(0, 40).forEach(function (dc) {
          var r = docs[dc[0]], ch = r.chunks[dc[1]];
          if (!ch || ch.text.length < 60 || ch.text.length > 400) return;
          if (!best || ch.text.length > best.ch.text.length) best = { r: r, ch: ch, d: dc[0], n: dc[1] };
        });
        if (best) parts.push({ role: 'use', text: best.ch.text, source: src(best.d, best.n) });
      }
      var edgesOf = G.edges.filter(function (e) { return e.a === nd.id || e.b === nd.id; })
        .sort(function (a, b) { return (b.type !== 'co') - (a.type !== 'co') || b.w - a.w; }).slice(0, maxRel);
      edgesOf.forEach(function (e) {
        var other = G.nodes.get(e.a === nd.id ? e.b : e.a);
        if (!other) return;
        var rel = e.label || REL[e.type] || 'collegato a';
        if (e.type === 'isa') rel = e.a === nd.id ? 'è un tipo di' : 'ha come tipo';
        if (e.type === 'use') rel = e.a === nd.id ? 'usa' : 'è usato da';
        var line = other.defs.length ? other.defs[0] : null;
        parts.push({ role: 'rel', rel: rel, label: other.label, id: other.id,
          text: line ? line.text : '', source: line ? src(line.d, line.n) : null });
      });
      var read = nd.chunks.slice(0, 6).map(function (dc) {
        var r = docs[dc[0]], ch = r.chunks[dc[1]] || {};
        return { doc: r.id, name: r.name, path: r.path, n: dc[1], where: where(r, ch), text: (ch.text || '').slice(0, 160) };
      });
      return { id: nd.id, label: nd.label, parts: parts, read: read, docs: nd.docs.map(function (d) { return d.id; }) };
    }

    /* Il riassunto di un ramo: il concetto e tutto quello che gli sta attorno, in Markdown. */
    function branch(id) {
      var e = explain(id, { related: 12 });
      if (!e) return '';
      var o = ['# ' + e.label, ''];
      e.parts.forEach(function (p) {
        if (p.role === 'def' || p.role === 'use') o.push('> ' + p.text, '> — *' + p.source.name + '*' + (p.source.where ? ', ' + p.source.where : ''), '');
      });
      var rel = e.parts.filter(function (p) { return p.role === 'rel'; });
      if (rel.length) {
        o.push('## Collegati', '');
        rel.forEach(function (p) { o.push('- **' + p.label + '** — ' + p.rel + (p.text ? '. ' + p.text : '')); });
        o.push('');
      }
      if (e.read.length) {
        o.push('## Dove leggerlo', '');
        e.read.forEach(function (r) { o.push('- ' + r.name + (r.where ? ', ' + r.where : '') + ' — ' + r.text); });
      }
      return o.join('\n');
    }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    function stats() {
      var G = graphCache;
      return {
        docs: docs.length, chunks: chunksAll.length, words: docs.reduce(function (a, r) { return a + (r.words || 0); }, 0),
        concepts: G ? G.nodes.size : null, edges: G ? G.edges.length : null, suggestions: G ? G.suggestions.length : null,
        langs: Array.from(langs)
      };
    }

    return {
      search: search,
      pool: pool,
      insights: insights,
      explain: explain,
      branch: branch,
      code: code,
      codeMarkdown: codeMarkdown,
      graph: graphOut,
      concept: concept,
      applyEdit: applyEdit,
      edits: function () { return edits; },
      markdown: markdown,
      stats: function () { graph(); return stats(); },
      docs: function () { return docs.map(docOut); },
      chunk: function (docId, n) { var r = docs[byId.get(docId)]; return r ? r.chunks[n] || null : null; }
    };
  }

  /*
   * La struttura del codice, ridotta a quello che serve al grafo: righe, corpi e usi non si salvano.
   */
  function compactCode(c) {
    return {
      lang: c.lang, langName: c.langName, family: c.family,
      symbols: (c.symbols || []).slice(0, 2000).map(function (s) {
        return { kind: s.kind, name: s.name, line: s.line, endLine: s.endLine, doc: s.doc || '', signature: s.signature || '',
          params: s.params || [], exported: !!s.exported, base: s.base || '', complexity: s.complexity || 1 };
      }),
      imports: (c.imports || []).slice(0, 500),
      calls: (c.calls || []).slice(0, 4000),
      todos: (c.todos || []).slice(0, 300),
      usage: c.usage || {},
      stats: c.stats || {}
    };
  }

  function docOut(r) {
    var o = {};
    ['id', 'path', 'name', 'ext', 'size', 'mtime', 'created', 'hash', 'imported', 'format', 'title', 'lang', 'langName', 'pages', 'ocrPages', 'words', 'warnings', 'status', 'error', 'summary', 'keywords']
      .forEach(function (k) { o[k] = r[k]; });
    if (r.code) o.code = { lang: r.code.lang, langName: r.code.langName, symbols: r.code.symbols.length, imports: r.code.imports.length, todos: r.code.todos.length, stats: r.code.stats };
    o.chunks = r.chunks.length;
    o.concepts = (r.concepts || []).length;
    return o;
  }

  // ---------------------------------------------------------------- calcoli
  function popcount(n) { var c = 0; while (n) { c += n & 1; n >>>= 1; } return c; }
  function pagerank(n, adj) {
    var d = 0.85, pr = new Float64Array(n), next = new Float64Array(n), out = new Float64Array(n);
    if (!n) return pr;
    for (var i = 0; i < n; i++) { pr[i] = 1 / n; for (var k = 0; k < adj[i].length; k++) out[i] += adj[i][k][1]; }
    for (var it = 0; it < 30; it++) {
      next.fill((1 - d) / n);
      var dangling = 0;
      for (var a = 0; a < n; a++) {
        if (!out[a]) { dangling += pr[a]; continue; }
        var share = d * pr[a] / out[a];
        for (var b = 0; b < adj[a].length; b++) next[adj[a][b][0]] += share * adj[a][b][1];
      }
      for (var z = 0; z < n; z++) next[z] += d * dangling / n;
      var tmp = pr; pr = next; next = tmp;
    }
    return pr;
  }
  // distanza di modifica con un limite (oltre il limite: limite + 1)
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      cur = [i];
      var best = i;
      for (var j2 = 1; j2 <= b.length; j2++) {
        cur[j2] = Math.min(prev[j2] + 1, cur[j2 - 1] + 1, prev[j2 - 1] + (a[i - 1] === b[j2 - 1] ? 0 : 1));
        if (cur[j2] < best) best = cur[j2];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  function hash32(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /*
   * Disposizione della mappa: molle sui collegamenti e repulsione tra i nodi vicini (griglia, così regge
   * migliaia di concetti). I nodi spostati dall'utente restano dove li ha messi.
   */
  function layout(nodes, edges, saved, nodeOfKey) {
    var list = Array.from(nodes.values());
    var n = list.length, pos = new Map();
    if (!n) return pos;
    var idx = new Map(list.map(function (nd, i) { return [nd.id, i]; }));
    var X = new Float64Array(n), Y = new Float64Array(n), pin = new Uint8Array(n);
    var R = Math.sqrt(n) * 42 + 60;
    list.forEach(function (nd, i) {
      var p = null;
      nd.members.forEach(function (k) { if (!p && saved[k]) p = saved[k]; });
      if (p) { X[i] = p[0]; Y[i] = p[1]; pin[i] = 1; return; }
      var h = hash32(nd.id), a = (h % 3600) / 3600 * Math.PI * 2, r = R * Math.sqrt(((h >>> 12) % 1000) / 1000 + 0.02);
      X[i] = Math.cos(a) * r; Y[i] = Math.sin(a) * r;
    });
    var E = edges.map(function (e) { return [idx.get(e.a), idx.get(e.b), Math.min(1, 0.25 + e.w)]; }).filter(function (e) { return e[0] !== undefined && e[1] !== undefined; });
    var k = 70, cell = k * 2.2;
    var iters = n > 3000 ? 70 : (n > 800 ? 120 : 220);
    var temp = R / 4, dx = new Float64Array(n), dy = new Float64Array(n);
    for (var it = 0; it < iters; it++) {
      dx.fill(0); dy.fill(0);
      var grid = new Map();
      for (var i = 0; i < n; i++) {
        var gk = Math.floor(X[i] / cell) + ',' + Math.floor(Y[i] / cell);
        var bucket = grid.get(gk);
        if (!bucket) { bucket = []; grid.set(gk, bucket); }
        bucket.push(i);
      }
      for (var i2 = 0; i2 < n; i2++) {
        var cx = Math.floor(X[i2] / cell), cy = Math.floor(Y[i2] / cell);
        for (var gx = cx - 1; gx <= cx + 1; gx++) for (var gy = cy - 1; gy <= cy + 1; gy++) {
          var bk = grid.get(gx + ',' + gy);
          if (!bk) continue;
          for (var q = 0; q < bk.length; q++) {
            var j = bk[q];
            if (j === i2) continue;
            var ddx = X[i2] - X[j], ddy = Y[i2] - Y[j], d2 = ddx * ddx + ddy * ddy;
            if (d2 < 0.01) { ddx = (hash32(i2 + ':' + j) % 100) / 100 - 0.5; ddy = 0.3; d2 = 0.34; }
            if (d2 > cell * cell) continue;
            var f = k * k / d2;
            dx[i2] += ddx * f; dy[i2] += ddy * f;
          }
        }
      }
      for (var e = 0; e < E.length; e++) {
        var a = E[e][0], b = E[e][1];
        var ex = X[a] - X[b], ey = Y[a] - Y[b], d = Math.sqrt(ex * ex + ey * ey) || 0.1;
        var fa = d * d / k * E[e][2] / d;
        dx[a] -= ex * fa; dy[a] -= ey * fa; dx[b] += ex * fa; dy[b] += ey * fa;
      }
      for (var m = 0; m < n; m++) {
        if (pin[m]) continue;
        dx[m] -= X[m] * 0.012; dy[m] -= Y[m] * 0.012; // un po' di gravità verso il centro
        var dl = Math.sqrt(dx[m] * dx[m] + dy[m] * dy[m]) || 1;
        var step = Math.min(dl, temp);
        X[m] += dx[m] / dl * step; Y[m] += dy[m] / dl * step;
      }
      temp = Math.max(2, temp * 0.97);
    }
    list.forEach(function (nd, i) { var p = [X[i], Y[i]]; if (pin[i]) p.pinned = true; pos.set(nd.id, p); });
    return pos;
  }

  /*
   * Confronto fra due cervelli. Si lavora sui due grafi già pronti (quelli che torna graph()), quindi
   * si possono confrontare due librerie senza aprirle insieme. Un concetto è "lo stesso" quando ha la
   * stessa radice o la stessa etichetta a meno di accenti e maiuscole.
   *   -> { shared: [...], onlyA: [...], onlyB: [...], moved: [...], stats }
   * "moved" sono i concetti che ci sono in tutti e due ma hanno peso molto diverso: argomenti che in
   * un cervello sono centrali e nell'altro di contorno.
   */
  function diff(A, B) {
    function index(G) {
      var m = new Map();
      (G.nodes || []).forEach(function (n) {
        var keys = [fold(n.label)];
        (n.members || []).forEach(function (k) { keys.push(k); });
        keys.forEach(function (k) { if (k && !m.has(k)) m.set(k, n); });
      });
      return m;
    }
    var ia = index(A), ib = index(B);
    var shared = [], onlyA = [], onlyB = [], moved = [], seen = new Set();
    function look(idx, n) {
      var keys = [fold(n.label)].concat(n.members || []);
      for (var i = 0; i < keys.length; i++) if (idx.has(keys[i])) return idx.get(keys[i]);
      return null;
    }
    var maxA = (A.nodes || []).reduce(function (m, n) { return Math.max(m, n.weight || 0); }, 0.001);
    var maxB = (B.nodes || []).reduce(function (m, n) { return Math.max(m, n.weight || 0); }, 0.001);
    (A.nodes || []).forEach(function (n) {
      var hit = look(ib, n);
      if (!hit) { onlyA.push({ id: n.id, label: n.label, count: n.count, ndocs: n.ndocs }); return; }
      if (seen.has(hit.id)) return;
      seen.add(hit.id);
      var wa = (n.weight || 0) / maxA, wb = (hit.weight || 0) / maxB;
      shared.push({ id: n.id, idB: hit.id, label: n.label, labelB: hit.label, a: n.count, b: hit.count, wa: round(wa, 3), wb: round(wb, 3) });
      if (Math.abs(wa - wb) >= 0.25) moved.push({ label: n.label, wa: round(wa, 3), wb: round(wb, 3), where: wa > wb ? 'a' : 'b' });
    });
    (B.nodes || []).forEach(function (n) {
      if (seen.has(n.id)) return;
      if (!look(ia, n)) onlyB.push({ id: n.id, label: n.label, count: n.count, ndocs: n.ndocs });
    });
    function by(l) { return l.sort(function (x, y) { return (y.count || 0) - (x.count || 0); }); }
    moved.sort(function (x, y) { return Math.abs(y.wa - y.wb) - Math.abs(x.wa - x.wb); });
    return {
      shared: shared.sort(function (x, y) { return (y.a + y.b) - (x.a + x.b); }),
      onlyA: by(onlyA), onlyB: by(onlyB), moved: moved,
      stats: { a: (A.nodes || []).length, b: (B.nodes || []).length, shared: shared.length, onlyA: onlyA.length, onlyB: onlyB.length,
        overlap: (A.nodes || []).length ? round(shared.length / Math.max(1, Math.min((A.nodes || []).length, (B.nodes || []).length)), 3) : 0 }
    };
  }

  g.WCLibrary = { VERSION: VERSION, buildRecord: buildRecord, open: open, ckey: ckey, diff: diff, findAcronyms: findAcronyms, chunkTokens: chunkTokens, emptyEdits: emptyEdits, where: where, layout: layout };
})(globalThis);
