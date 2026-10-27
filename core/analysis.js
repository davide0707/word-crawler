/*
 * Word Crawler: analisi del testo, senza AI.
 *
 * - Parole chiave: frequenza, nomi propri, titoli, distribuzione nel testo (stile YAKE)
 *   più la centralità in un grafo di parole vicine (stile TextRank). La finestra del grafo
 *   è data dal parametro "Zampe".
 * - Riassunto estrattivo: TextRank sulle frasi + peso delle parole chiave + peso dell'inizio
 *   dei paragrafi, poi scelta con MMR (parametro "Varietà") per non ripetere lo stesso concetto.
 * - Studio: frasi chiave, definizioni, nomi, numeri e date.
 * - Cerca: parole o frasi indicate dall'utente.
 * - Statistiche e leggibilità (Gulpease per l'italiano, Flesch per l'inglese).
 */
(function (g) {
  'use strict';
  if (g.WCAnalysis) return;
  var T = g.WCText;

  var SEL = [1.7, 1.3, 1, 0.75, 0.55];
  var MONTHS = new Set(('gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre ' +
    'january february march april may june july august september october november december').split(' '));
  var CENTURY = new Set(['secolo', 'secoli', 'century', 'centuries', 'sec']);

  function popcount(n) { var c = 0; while (n) { c += n & 1; n >>>= 1; } return c; }
  function normalize(arr) {
    var mx = 0;
    for (var i = 0; i < arr.length; i++) if (arr[i] > mx) mx = arr[i];
    if (!mx) return arr.map(function () { return 0; });
    return arr.map(function (v) { return v / mx; });
  }

  // PageRank pesato su un grafo sparso: adj[i] = [[j, peso], ...]
  function pagerank(n, adj, iters) {
    var d = 0.85, pr = new Float64Array(n), next = new Float64Array(n), out = new Float64Array(n);
    if (!n) return pr;
    for (var i = 0; i < n; i++) {
      pr[i] = 1 / n;
      var s = 0;
      for (var k = 0; k < adj[i].length; k++) s += adj[i][k][1];
      out[i] = s;
    }
    for (var it = 0; it < (iters || 30); it++) {
      next.fill((1 - d) / n);
      for (var a = 0; a < n; a++) {
        if (!out[a]) continue;
        var share = d * pr[a] / out[a];
        var e = adj[a];
        for (var b = 0; b < e.length; b++) next[e[b][0]] += share * e[b][1];
      }
      var tmp = pr; pr = next; next = tmp;
    }
    return pr;
  }

  // ---------------------------------------------------------------- parole chiave
  function keywordStats(tokens, sents, legs) {
    var N = tokens.length;
    var win = Math.max(1, Math.min(8, Math.round(legs / 2)));
    var S = new Map();
    var list = [];
    for (var i = 0; i < N; i++) {
      var t = tokens[i];
      if (t.stop) continue;
      var s = S.get(t.key);
      if (!s) {
        s = { key: t.key, idx: list.length, tf: 0, head: 0, cap: 0, capN: 0, first: i, segs: 0, L: new Set(), R: new Set(), nL: 0, nR: 0, forms: new Map(), co: new Map(), sents: new Set() };
        S.set(t.key, s);
        list.push(s);
      }
      var ss = sents[t.sid] && sents[t.sid].from === i;
      if (t.w > 1) s.head++; else s.tf++;
      // le sigle (NATO, ONU) contano come nomi; le parole scritte tutte in maiuscolo no
      if (t.w === 1 && (!t.allcap || t.acronym) && !ss) { s.capN++; if (t.cap) s.cap++; }
      if (t.w === 1) s.segs |= 1 << Math.min(9, Math.floor(i * 10 / Math.max(1, N)));
      s.forms.set(t.base, (s.forms.get(t.base) || 0) + 1);
      s.sents.add(t.sid);
      for (var d = 1; d <= win; d++) {
        var a = tokens[i - d], b = tokens[i + d];
        if (a && !a.stop && a.blk === t.blk) {
          s.L.add(a.key); s.nL++;
          s.co.set(a.key, (s.co.get(a.key) || 0) + 1 / d);
        }
        if (b && !b.stop && b.blk === t.blk) { s.R.add(b.key); s.nR++; }
      }
    }

    // grafo delle parole vicine (limitato alle 3000 più frequenti)
    var nodes = list.slice().sort(function (x, y) { return (y.tf + y.head) - (x.tf + x.head); }).slice(0, 3000);
    var index = new Map();
    nodes.forEach(function (s, k) { index.set(s.key, k); });
    var adj = nodes.map(function () { return []; });
    nodes.forEach(function (s, k) {
      s.co.forEach(function (w, other) {
        var j = index.get(other);
        if (j === undefined || j === k) return;
        adj[k].push([j, w]);
        adj[j].push([k, w]);
      });
    });
    var pr = normalize(Array.from(pagerank(nodes.length, adj, 25)));
    nodes.forEach(function (s, k) { s.pr = pr[k]; });

    var maxTF = 1;
    list.forEach(function (s) { if (s.tf > maxTF) maxTF = s.tf; });
    list.forEach(function (s) {
      var tf = s.tf + s.head;
      var capR = s.capN ? s.cap / s.capN : 0;
      var spread = popcount(s.segs) / 10;
      var DL = s.nL ? s.L.size / s.nL : 0, DR = s.nR ? s.R.size / s.nR : 0;
      var rel = 1 + (DL + DR) * (s.tf / maxTF);
      var display = '', best = -1;
      s.forms.forEach(function (n, form) {
        var bonus = (capR > 0.5 && /^\p{Lu}/u.test(form)) ? 0.5 : 0;
        if (n + bonus > best) { best = n + bonus; display = form; }
      });
      var lenF = Math.min(1.35, 0.55 + display.length / 11);
      var posF = 1 + 0.25 * (1 - s.first / Math.max(1, N));
      var headF = 1 + Math.min(1, s.head / 2) * 1.2;
      var yake = Math.log2(1 + tf) * (1 + 1.4 * capR) * (0.35 + 0.65 * spread) * lenF * posF * headF / rel;
      s.capR = capR;
      s.tfAll = tf;
      s.display = display;
      s.score = yake * (0.55 + 0.9 * (s.pr || 0));
      s.co = null; s.L = null; s.R = null;
    });
    list.sort(function (x, y) { return y.score - x.score; });
    return { map: S, ranked: list };
  }

  // ---------------------------------------------------------------- riassunto
  function sentenceFeatures(tokens, sents, kwMap, topTerms) {
    sents.forEach(function (s) {
      var keys = new Set(), content = 0, kw = 0;
      for (var k = s.from; k < s.to; k++) {
        var t = tokens[k];
        if (t.stop) continue;
        content++;
        if (!keys.has(t.key)) {
          keys.add(t.key);
          if (topTerms.has(t.key)) kw += kwMap.get(t.key).score;
        }
      }
      s.keys = keys;
      s.content = content;
      s.len = s.to - s.from;
      s.kw = content ? kw / Math.sqrt(content) : 0;
    });
  }

  function textRankSentences(sents) {
    var n = sents.length;
    var df = new Map();
    sents.forEach(function (s, i) { s.keys.forEach(function (k) { var l = df.get(k); if (!l) { l = []; df.set(k, l); } l.push(i); }); });
    var limit = Math.max(3, Math.min(n * 0.25, 200));
    var shared = sents.map(function () { return new Map(); });
    df.forEach(function (l) {
      if (l.length < 2 || l.length > limit) return;
      for (var a = 0; a < l.length; a++) for (var b = a + 1; b < l.length; b++) {
        var m = shared[l[a]];
        m.set(l[b], (m.get(l[b]) || 0) + 1);
      }
    });
    var adj = sents.map(function () { return []; });
    shared.forEach(function (m, i) {
      m.forEach(function (c, j) {
        var w = c / (Math.log(1 + sents[i].keys.size) + Math.log(1 + sents[j].keys.size) + 1);
        adj[i].push([j, w]); adj[j].push([i, w]);
      });
    });
    return normalize(Array.from(pagerank(n, adj, 30)));
  }

  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    var inter = 0;
    var small = a.size < b.size ? a : b, big = small === a ? b : a;
    small.forEach(function (k) { if (big.has(k)) inter++; });
    return inter / (a.size + b.size - inter);
  }

  function summarize(sents, opts) {
    var elig = sents.filter(function (s) { return s.w === 1 && s.content >= 4 && s.len <= 160; });
    if (!elig.length) return [];
    var tr = textRankSentences(elig);
    var kw = normalize(elig.map(function (s) { return s.kw; }));
    var leadW = (opts.lead || 0) / 10;
    // posizione nel paragrafo
    var posInBlk = new Map();
    sents.forEach(function (s) {
      var c = posInBlk.get(s.blk) || 0;
      s.posInBlk = c;
      posInBlk.set(s.blk, c + 1);
    });
    elig.forEach(function (s, i) {
      var lead = s.posInBlk === 0 ? 1 : (s.posInBlk === 1 ? 0.5 : 0);
      var r = 0.45 * tr[i] + 0.55 * kw[i] + 0.6 * leadW * lead;
      if (s.content < 6) r *= 0.6;
      if (s.len > 70) r *= 0.85;
      s.rel = r;
    });
    var m = Math.max(1, Math.round(elig.length * (opts.summaryLength || 20) / 100));
    m = Math.min(m, elig.length);
    var lambda = 1 - (opts.variety == null ? 5 : opts.variety) / 12;
    var pool = elig.slice().sort(function (a, b) { return b.rel - a.rel; }).slice(0, Math.max(m * 3, 300));
    var maxSim = new Map();
    var chosen = [];
    var left = new Set(pool);
    while (chosen.length < m && left.size) {
      var best = null, bestV = -Infinity;
      left.forEach(function (s) {
        var v = lambda * s.rel - (1 - lambda) * (maxSim.get(s) || 0);
        if (v > bestV) { bestV = v; best = s; }
      });
      chosen.push(best);
      left.delete(best);
      left.forEach(function (s) {
        var sim = jaccard(s.keys, best.keys);
        if (sim > (maxSim.get(s) || 0)) maxSim.set(s, sim);
      });
    }
    chosen.sort(function (a, b) { return a.id - b.id; });
    return chosen;
  }

  // ---------------------------------------------------------------- studio
  var DEF_IT = /^(?:[^,;:]{2,70}?)\s(?:(?:è|e'|sono)\s(?:un|una|uno|un'|il|lo|la|l'|i|gli|le)\b|(?:è|sono|era|erano|fu|furono)\s(?:detto|detta|detti|dette|chiamat[oaie]|definit[oaie]|considerat[oaie])\b)/i;
  var DEF_IT2 = /\b(?:si definisce|si definiscono|si intende|si intendono|si indica|si indicano|viene definit[oa]|vengono definit[ie]|prende il nome di|prendono il nome di|è detto|è detta|sono detti|sono dette|significa|consiste nel|consiste in|si tratta di)\b/i;
  var DEF_EN = /^(?:[^,;:]{2,70}?)\s(?:(?:is|are)\s(?:a|an|the)\b|(?:is|are|was|were)\s(?:defined as|called|known as|referred to as)\b)/i;
  var DEF_EN2 = /\b(?:is defined as|are defined as|refers to|refer to|is called|are called|is known as|means that|consists of|is the term for)\b/i;

  function isDefinition(s, tokens, lang, kwSet, kwMap) {
    var txt = s.text;
    if (s.w !== 1 || s.content < 4) return false;
    var re1 = lang === 'en' ? DEF_EN : DEF_IT, re2 = lang === 'en' ? DEF_EN2 : DEF_IT2;
    // verbi che definiscono in modo esplicito ("si definisce", "refers to"): basta trovarli all'inizio
    var m2 = re2.exec(txt);
    if (m2 && m2.index < 90) return true;
    if (!re1.test(txt)) return false;
    // con "è un / sono i" il soggetto deve contenere una parola chiave o un nome
    var limit = Math.min(s.to, s.from + 8);
    for (var k = s.from; k < limit; k++) {
      var t = tokens[k];
      if (kwSet.has(t.key) || kwSet.has(t.ph) || (t.cap && k > s.from && !t.stop) || t.acronym) return true;
      if (!t.stop && kwMap.get(t.key) && kwMap.get(t.key).tfAll >= 2) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- espressioni di più parole
  var CONNECT = new Set(['di', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'of', 'de', 'von', 'van', 'du', 'da']);
  function plainGap(gp) { return /^[ \t ]+$/.test(gp); }

  /*
   * Trova espressioni come "guerra fredda", "Unione Sovietica", "muro di Berlino".
   * Una coppia/terna di parole diventa espressione se compare almeno 2 volte e le sue parole
   * stanno quasi sempre insieme (coesione). Le sequenze di nomi propri ("Winston Churchill")
   * valgono anche se compaiono una volta sola.
   */
  function findPhrases(tokens, kwMap, topTerms, sents) {
    // parola utile per un'espressione: non comune, oppure maiuscola a metà frase ("Stati" in "Stati Uniti")
    function content(i) {
      var t = tokens[i];
      if (!t.stop) return true;
      return t.cap && t.f.length >= 3 && sents[t.sid].from !== i;
    }
    var P = new Map();
    function add(idxs) {
      var key = idxs.map(function (i) { return tokens[i].key; }).join(' ');
      var p = P.get(key);
      if (!p) {
        p = { key: key, len: idxs.length, occ: [], forms: new Map(), first: idxs[0],
          content: idxs.filter(function (i) { return content(i); }).map(function (i) { return tokens[i].key; }) };
        P.set(key, p);
      }
      p.occ.push(idxs[0]);
      var parts = [];
      for (var k = idxs[0]; k <= idxs[idxs.length - 1]; k++) parts.push(tokens[k].text);
      // "l'Unione Sovietica" -> "Unione Sovietica", "Calypso's cave" resta com'è
      parts[0] = T.normPart(parts[0]);
      var last = parts.length - 1;
      if (/['’]s$/.test(parts[last])) parts[last] = T.normPart(parts[last]);
      var form = parts.join(' ');
      p.forms.set(form, (p.forms.get(form) || 0) + 1);
    }
    for (var i = 0; i < tokens.length - 1; i++) {
      var t = tokens[i];
      if (t.w > 1 || !content(i)) continue;
      var a = tokens[i + 1], b = tokens[i + 2];
      if (!a || a.sid !== t.sid || !plainGap(a.gap)) continue;
      if (content(i + 1)) {
        add([i, i + 1]);
        if (b && b.sid === t.sid && content(i + 2) && plainGap(b.gap)) add([i, i + 1, i + 2]);
      } else if (CONNECT.has(a.f) && b && b.sid === t.sid && content(i + 2) && plainGap(b.gap)) {
        add([i, i + 1, i + 2]);
      }
    }
    var out = [];
    P.forEach(function (p) {
      var stats = p.content.map(function (k) { return kwMap.get(k); }).filter(Boolean);
      if (!stats.length) return;
      var count = p.occ.length;
      var minTf = Math.min.apply(null, stats.map(function (s) { return s.tfAll; }));
      var coh = count / Math.max(count, minTf);
      var allCaps = true;
      p.occ.forEach(function (start) {
        for (var k = start; k < start + p.len; k++) {
          var tk = tokens[k];
          if (CONNECT.has(tk.f)) continue;
          if (!tk.cap) allCaps = false;
        }
      });
      var isName = allCaps && p.content.length >= 2;
      var strong = p.content.some(function (k) { return topTerms.has(k); });
      if (!((count >= 2 && coh >= 0.45 && strong) || (isName && (count >= 2 || coh >= 0.5)))) return;
      var display = '', best = -1;
      p.forms.forEach(function (n, f) { if (n > best) { best = n; display = f; } });
      // una parola debole nell'espressione la indebolisce (media geometrica tra la più forte e la più debole)
      var scores = stats.map(function (s) { return s.score; });
      var mx = Math.max.apply(null, scores), mn = Math.min.apply(null, scores);
      p.display = display;
      p.isName = isName;
      p.count = count;
      p.score = Math.sqrt(mx * mn) * (isName ? 1.25 : 1) * (1 + 0.2 * (p.content.length - 1)) * Math.sqrt(coh) * (count >= 2 ? 1 : 0.6);
      out.push(p);
    });
    // le espressioni più lunghe vincono sulle parti più corte che le contengono
    out.sort(function (x, y) { return (y.score * (1 + 0.1 * (y.len - 1))) - (x.score * (1 + 0.1 * (x.len - 1))); });
    var taken = new Uint8Array(tokens.length);
    var accepted = [];
    out.forEach(function (p) {
      var used = [];
      p.occ.forEach(function (start) {
        for (var k = start; k < start + p.len; k++) if (taken[k]) return;
        used.push(start);
      });
      if (!used.length || (used.length < 2 && !p.isName)) return;
      p.occ = used;
      used.forEach(function (start) {
        var grp = { from: start, to: start + p.len };
        for (var k = start; k < start + p.len; k++) { taken[k] = 1; tokens[k].ph = p.key; tokens[k].grp = grp; }
      });
      p.count = used.length;
      accepted.push(p);
    });
    return accepted;
  }

  function isNumberToken(tokens, i) {
    var t = tokens[i], next = tokens[i + 1];
    if (/^\d{1,4}$/.test(t.f)) {
      var n = +t.f;
      if (next && /^%/.test(next.gap.trim())) return true;
      if (n >= 1000 && n <= 2199) return true; // anni
      if (next && MONTHS.has(next.f)) return true; // 12 marzo
      if (i > 0 && MONTHS.has(tokens[i - 1].f)) return true; // March 12
      return t.f.length >= 2;
    }
    if (/^\d[\d.,]*\d$/.test(t.text)) return true;
    if (MONTHS.has(t.f) && ((next && /^\d{1,4}$/.test(next.f)) || (i > 0 && /^\d{1,2}$/.test(tokens[i - 1].f)))) return true;
    if (/^[IVXLC]{1,6}$/.test(t.text) && next && CENTURY.has(next.f)) return true;
    return false;
  }

  // ---------------------------------------------------------------- cerca
  function parseTerms(str) {
    return String(str || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).map(function (raw) {
      var prefix = /\*$/.test(raw);
      var clean = raw.replace(/\*+$/, '');
      var parts = [];
      var m, re = new RegExp(T.WORD.source, 'gu');
      while ((m = re.exec(clean))) parts.push(m[0]);
      return {
        raw: raw, prefix: prefix,
        keys: parts.map(function (p) { return T.keyOf(p); }),
        folds: parts.map(function (p) { return T.fold(T.normPart(p)); })
      };
    }).filter(function (t) { return t.keys.length; });
  }

  function findTerms(tokens, terms) {
    var hits = []; // [{term index, from, to}]
    for (var i = 0; i < tokens.length; i++) {
      for (var q = 0; q < terms.length; q++) {
        var term = terms[q], ok = true, L = term.keys.length;
        for (var k = 0; k < L; k++) {
          var t = tokens[i + k];
          if (!t) { ok = false; break; }
          var last = k === L - 1;
          if (last && term.prefix) { if (t.f.indexOf(term.folds[k]) !== 0) { ok = false; break; } }
          else if (t.key !== term.keys[k] && t.f !== term.folds[k]) { ok = false; break; }
        }
        if (ok) hits.push({ term: q, from: i, to: i + L });
      }
    }
    return hits;
  }

  // ---------------------------------------------------------------- statistiche
  function syllablesEn(w) {
    w = w.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    var m = w.match(/[aeiouy]{1,2}/g);
    return Math.max(1, m ? m.length : 1);
  }
  function stats(tokens, sents, lang) {
    var N = tokens.length, letters = 0, uniq = new Set(), content = 0, syl = 0, blks = new Set();
    tokens.forEach(function (t) {
      letters += (t.text.match(/\p{L}/gu) || []).length;
      if (!/^\d+$/.test(t.f)) uniq.add(t.f);
      if (!t.stop) content++;
      blks.add(t.blk);
      if (lang === 'en') syl += syllablesEn(t.text);
    });
    var S = Math.max(1, sents.length), W = Math.max(1, N);
    var readability, scale, label;
    if (lang === 'en') {
      readability = 206.835 - 1.015 * (W / S) - 84.6 * (syl / W);
      scale = 'Flesch';
    } else {
      readability = 89 + (300 * S - 10 * letters) / W;
      scale = 'Gulpease';
    }
    readability = Math.max(0, Math.min(100, readability));
    if (scale === 'Gulpease') label = readability >= 80 ? 'facile' : readability >= 60 ? 'abbastanza facile' : readability >= 40 ? 'difficile' : 'molto difficile';
    else label = readability >= 70 ? 'facile' : readability >= 50 ? 'abbastanza facile' : readability >= 30 ? 'difficile' : 'molto difficile';
    return {
      words: N,
      uniqueWords: uniq.size,
      sentences: sents.length,
      paragraphs: blks.size,
      avgSentenceWords: +(N / S).toFixed(1),
      readingMinutes: Math.max(1, Math.round(N / (lang === 'en' ? 230 : 200))),
      lexicalDensity: +(content / W).toFixed(3),
      readability: Math.round(readability),
      readabilityScale: scale,
      readabilityLabel: label
    };
  }

  // Toglie le voci contenute in (o che contengono) una voce più in alto in classifica
  function containsSeq(a, b) {
    if (b.length > a.length) return false;
    outer: for (var i = 0; i + b.length <= a.length; i++) {
      for (var k = 0; k < b.length; k++) if (a[i + k] !== b[k]) continue outer;
      return true;
    }
    return false;
  }
  function dedupeNested(items) {
    var kept = [];
    items.forEach(function (it) {
      var ks = it.id.split(' ');
      for (var j = 0; j < kept.length; j++) {
        if (containsSeq(kept[j].ks, ks) || containsSeq(ks, kept[j].ks)) return;
      }
      it.ks = ks;
      kept.push(it);
    });
    return kept;
  }

  // ---------------------------------------------------------------- tutto insieme
  /*
   * tokens: token del documento (vedi text.js); opzionale t.page (numero di pagina, da 0)
   * opts: impostazioni (vedi settings.js)
   * Restituisce { plan, results }. Ogni token riceve:
   *   t.mk  segno da disegnare: 'kw-lav' | 'kw-cyan' | 'ring-cyan' | 'ring-green' | 'strike' | 'num' | 'term' | null
   *   t.kid identificativo della parola chiave/nome a cui appartiene (per contatori e risultati)
   *   t.grp gruppo {from, to} se la parola fa parte di un'espressione ("Unione Sovietica")
   * e ogni frase s.mk: 'key' | 'def' | 'term' | null
   */
  function analyze(tokens, rawOpts) {
    var opts = g.WCSettings ? g.WCSettings.sanitize(rawOpts) : (rawOpts || {});
    var t0 = Date.now();
    T.prepare(tokens);
    tokens.forEach(function (t) { t.ph = null; t.grp = null; t.mk = null; t.kid = null; });
    var lang = opts.language && opts.language !== 'auto' ? opts.language : T.detectLang(tokens);
    var sents = T.sentences(tokens);
    var N = tokens.length;
    var mode = opts.mode || 'study';
    var selMul = SEL[(opts.selectivity || 3) - 1];

    // parole singole
    var kwRes = keywordStats(tokens, sents, opts.legs || 8);
    var minTF = N < 250 ? 1 : 2;
    var singles = kwRes.ranked.filter(function (s) { return s.tf >= minTF || s.head > 0; });
    var baseK = Math.round(5 + Math.sqrt(singles.length) * 0.9);
    var strongTerms = new Set(singles.slice(0, baseK * 3).map(function (s) { return s.key; }));

    // espressioni di più parole
    var phrases = findPhrases(tokens, kwRes.map, strongTerms, sents);
    var phraseMap = new Map(phrases.map(function (p) { return [p.key, p]; }));
    var inPhrase = new Map();
    tokens.forEach(function (t) { if (t.ph && !t.stop) inPhrase.set(t.key, (inPhrase.get(t.key) || 0) + 1); });

    var items = [];
    singles.forEach(function (s) {
      var inside = inPhrase.get(s.key) || 0;
      if (inside >= 0.6 * s.tfAll) return; // quasi sempre dentro un'espressione: conta l'espressione
      items.push({ id: s.key, word: s.display, score: s.score * (1 - 0.5 * inside / s.tfAll), count: s.tfAll - inside, name: s.capR >= 0.6 && s.capN >= 1, head: s.head });
    });
    phrases.forEach(function (p) {
      if (p.count >= 2) items.push({ id: p.key, word: p.display, score: p.score, count: p.count, name: p.isName, phrase: true });
    });
    items.sort(function (x, y) { return y.score - x.score; });
    items = dedupeNested(items);
    var cands = items.filter(function (it) { return it.count >= minTF || it.head > 0; });
    var K = Math.max(4, Math.min(60, Math.round((5 + Math.sqrt(cands.length) * 0.9) * selMul)));
    var kwItems = cands.slice(0, K);
    var kwSet = new Set(kwItems.map(function (it) { return it.id; }));
    var rej = cands.slice(K).filter(function (it) { return it.count >= 2; }).slice(0, 3);
    var rejSet = new Set(rej.map(function (it) { return it.id; }));

    // nomi propri: parole singole quasi sempre maiuscole a metà frase, e sequenze di nomi
    var nameSingles = new Set(kwRes.ranked.filter(function (s) { return s.capR >= 0.6 && s.capN >= 1 && s.display.length > 2; }).slice(0, 120).map(function (s) { return s.key; }));
    var namePhrases = new Set(phrases.filter(function (p) { return p.isName; }).map(function (p) { return p.key; }));

    function kwIdOf(t) {
      if (t.ph && kwSet.has(t.ph)) return t.ph;
      if (!t.stop && kwSet.has(t.key)) return t.key;
      return null;
    }
    function nameIdOf(t) {
      if (t.ph && namePhrases.has(t.ph)) return t.ph;
      if (!t.stop && t.cap && nameSingles.has(t.key)) return t.key;
      return null;
    }
    function display(id) {
      var p = phraseMap.get(id);
      if (p) return p.display;
      var s = kwRes.map.get(id);
      return s ? s.display : id;
    }
    // un segno su una parola o su tutta l'espressione a cui appartiene
    function mark(i, mk, id) {
      var t = tokens[i];
      if (t.grp && t.ph === id) {
        for (var k = t.grp.from; k < t.grp.to; k++) { tokens[k].mk = mk; tokens[k].kid = id; }
      } else { t.mk = mk; t.kid = id; t.grp = null; }
    }
    function groupStart(t, i) { return !t.grp || t.grp.from === i; }

    // frasi
    var topTerms = new Set(strongTerms);
    phrases.forEach(function (p) { if (kwSet.has(p.key)) p.content.forEach(function (k) { topTerms.add(k); }); });
    sentenceFeatures(tokens, sents, kwRes.map, topTerms);
    var summary = summarize(sents, opts);
    var summarySet = new Set(summary.map(function (s) { return s.id; }));

    var highlights = [];
    var styleMap = new Map(), styleN = 0, STY = ['kw-lav', 'kw-cyan', 'ring-cyan'];
    function styleFor(id) {
      if (!styleMap.has(id)) styleMap.set(id, STY[styleN++ % STY.length]);
      return styleMap.get(id);
    }
    function pageOf(i) { return tokens[i] && tokens[i].page != null ? tokens[i].page : null; }

    var search = null;
    if (mode === 'web') {
      tokens.forEach(function (t, i) {
        if (!groupStart(t, i)) return;
        var id = kwIdOf(t);
        if (id) mark(i, styleFor(id), id);
        else if (!t.stop && rejSet.has(t.ph || t.key)) mark(i, 'strike', t.ph || t.key);
      });
    } else if (mode === 'summary') {
      var seenKw = new Set();
      tokens.forEach(function (t, i) {
        if (!groupStart(t, i)) return;
        var id = kwIdOf(t);
        if (id && !seenKw.has(id)) { seenKw.add(id); mark(i, 'ring-cyan', id); }
      });
      summary.forEach(function (s) { s.mk = 'key'; });
    } else if (mode === 'study') {
      var seenBlk = new Set(), seenName = new Set(), nNum = 0;
      tokens.forEach(function (t, i) {
        if (opts.markNumbers && !t.grp && isNumberToken(tokens, i)) {
          mark(i, 'num', null);
          if (nNum++ < 300) highlights.push({ type: 'num', text: t.text, sid: t.sid, idx: i, page: pageOf(i) });
          return;
        }
        if (!opts.markNames || !groupStart(t, i)) return;
        var nid = nameIdOf(t), kid = kwIdOf(t);
        var id = nid || kid;
        if (!id) return;
        var k = t.blk + '|' + id;
        if (seenBlk.has(k)) return;
        seenBlk.add(k);
        mark(i, nid ? 'ring-green' : 'ring-cyan', id);
        if (nid && !seenName.has(nid)) {
          seenName.add(nid);
          highlights.push({ type: 'name', text: display(nid), sid: t.sid, idx: i, page: pageOf(i) });
        }
      });
      sents.forEach(function (s) {
        if (opts.markDefinitions && isDefinition(s, tokens, lang, kwSet, kwRes.map)) s.mk = 'def';
        else if (opts.markKeySentences && summarySet.has(s.id)) s.mk = 'key';
        if (s.mk) highlights.push({ type: s.mk, text: s.text, sid: s.id, idx: s.to - 1, page: pageOf(s.from) });
      });
    } else if (mode === 'search') {
      var terms = parseTerms(opts.searchTerms);
      var hits = findTerms(tokens, terms);
      var counts = terms.map(function () { return 0; });
      var matched = new Map();
      hits.forEach(function (h) {
        counts[h.term]++;
        var grp = { from: h.from, to: h.to };
        for (var k = h.from; k < h.to; k++) { tokens[k].mk = 'term'; tokens[k].kid = 'term:' + h.term; tokens[k].grp = h.to - h.from > 1 ? grp : null; tokens[k].ph = null; }
        var sid = tokens[h.from].sid;
        if (!matched.has(sid)) matched.set(sid, new Set());
        matched.get(sid).add(terms[h.term].raw);
      });
      matched.forEach(function (set, sid) {
        sents[sid].mk = 'term';
        highlights.push({ type: 'term', text: sents[sid].text, sid: sid, idx: sents[sid].to - 1, page: pageOf(sents[sid].from), terms: Array.from(set) });
      });
      search = { terms: terms.map(function (t, i) { return { term: t.raw, count: counts[i] }; }), sentences: matched.size };
      display = (function (prev) { return function (id) { var m = /^term:(\d+)$/.exec(id); return m && terms[+m[1]] ? terms[+m[1]].raw : prev(id); }; })(display);
    }
    // i gruppi senza segno non servono al motore grafico
    tokens.forEach(function (t) { if (!t.mk) t.grp = null; });
    highlights.sort(function (a, b) { return a.idx - b.idx; });
    highlights.forEach(function (h, i) { h.id = i; });

    var results = {
      version: 2,
      mode: mode,
      lang: lang,
      stats: stats(tokens, sents, lang),
      keywords: kwItems.map(function (it) { return { key: it.id, word: it.word, score: +it.score.toFixed(3), count: it.count, name: !!it.name, phrase: !!it.phrase }; }),
      discarded: rej.map(function (it) { return it.word; }),
      summary: summary.map(function (s) { return { sid: s.id, text: s.text, page: pageOf(s.from), idx: s.to - 1 }; }),
      highlights: highlights,
      search: search,
      settings: opts,
      elapsedMs: 0
    };
    results.elapsedMs = Date.now() - t0;
    return {
      plan: { sentences: sents, display: display },
      results: results
    };
  }

  g.WCAnalysis = { analyze: analyze, parseTerms: parseTerms };
})(globalThis);
