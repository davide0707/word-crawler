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
 * - Ripasso: schede (definizioni e frasi da completare) e quiz a scelta multipla.
 * - Statistiche e leggibilità con la formula adatta a ogni lingua (vedi lang.js).
 *
 * Lingue: italiano, inglese, francese, spagnolo, tedesco, portoghese. Se sono state caricate
 * le frequenze della lingua (WCLang.ensure), le parole comuni pesano meno di quelle rare.
 */
(function (g) {
  'use strict';
  if (g.WCAnalysis) return;
  var T = g.WCText, LANG = g.WCLang;

  var SEL = [1.7, 1.3, 1, 0.75, 0.55];

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
  function keywordStats(tokens, sents, legs, lang) {
    var N = tokens.length;
    var L = LANG.get(lang);
    var win = Math.max(1, Math.min(8, Math.round(legs / 2)));
    var S = new Map();
    var list = [];
    for (var i = 0; i < N; i++) {
      var t = tokens[i];
      if (t.stop) continue;
      var s = S.get(t.key);
      if (!s) {
        s = { key: t.key, idx: list.length, tf: 0, head: 0, cap: 0, capN: 0, art: 0, first: i, segs: 0, rar: 0, L: new Set(), R: new Set(), nL: 0, nR: 0, forms: new Map(), co: new Map(), sents: new Set() };
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
      s.rar += LANG.rarity(lang, t.f);
      // tedesco: un articolo o un aggettivo subito prima indica un nome comune ("der Krieg", "kalten Krieg")
      if (L.nounCaps && i > 0) {
        var pv = tokens[i - 1];
        if (L.determinerSet.has(pv.f) || (!pv.stop && pv.f.length > 3 && /(?:e|en|er|es|em)$/.test(pv.f) && !pv.cap)) s.art++;
      }
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
      // nome proprio? In tedesco anche i nomi comuni hanno la maiuscola: conta solo se la parola
      // non è tra quelle d'uso comune e non ha una desinenza da nome comune (-ung, -heit…)
      var f = T.fold(display);
      var nameLike = capR >= 0.6 && s.capN >= 1;
      if (nameLike && L.nounCaps) {
        var rk = LANG.rank(lang, f);
        var acro = display.length > 1 && display === display.toUpperCase();
        var plain = !L.nounSuffix.test(f) && s.art <= 0.34 * tf && !LANG.compoundKnown(lang, f);
        // parola sconosciuta senza articolo, oppure parola nota ma ripetuta sempre senza articolo (Berlin, Churchill)
        nameLike = acro || (plain && rk !== -1 && (rk === 0 || (tf >= 2 && s.art === 0)));
      }
      // rarità: le parole d'uso comune pesano meno (i nomi propri quasi non vengono toccati)
      var rar = s.rar / Math.max(1, tf);
      if (nameLike) rar = Math.max(rar, 0.95);
      s.capR = capR;
      s.nameLike = nameLike;
      s.rarity = rar;
      s.tfAll = tf;
      s.display = display;
      s.score = yake * (0.55 + 0.9 * (s.pr || 0)) * rar;
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

  function summarize(sents, opts, tokens, lang) {
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
      // "Questo portò a…", "It was…": da sola la frase si capisce poco
      s.anaph = s.posInBlk > 0 && LANG.isAnaphoric(lang, tokens[s.from], tokens[s.from + 1]);
      if (s.anaph) r *= 0.8;
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
  // Modi di scrivere una definizione: in lang.js, per ogni lingua (def1 "X è un…", def2 "si definisce…")
  function isDefinition(s, tokens, lang, kwSet, kwMap) {
    var txt = s.text.replace(/’/g, "'");
    if (s.w !== 1 || s.content < 4) return false;
    var L = LANG.get(lang), re1 = L.def1, re2 = L.def2;
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
  var CONNECT = LANG.CONNECT;
  function plainGap(gp) { return /^[ \t ]+$/.test(gp); }

  /*
   * Trova espressioni come "guerra fredda", "Unione Sovietica", "muro di Berlino".
   * Una coppia/terna di parole diventa espressione se compare almeno 2 volte e le sue parole
   * stanno quasi sempre insieme (coesione). Le sequenze di nomi propri ("Winston Churchill")
   * valgono anche se compaiono una volta sola.
   */
  function findPhrases(tokens, kwMap, topTerms, sents, lang) {
    var LL = LANG.get(lang), nounCaps = !!LL.nounCaps;
    // tedesco: un articolo o un aggettivo prima dell'espressione indica un nome comune ("der Kalte Krieg")
    function articled(i) {
      var pv = tokens[i - 1];
      return !!pv && (LL.determinerSet.has(pv.f) || (!pv.stop && pv.f.length > 3 && /(?:e|en|er|es|em)$/.test(pv.f) && !pv.cap));
    }
    // parola utile per un'espressione: non comune, oppure maiuscola a metà frase ("Stati" in "Stati Uniti")
    function content(i) {
      var t = tokens[i];
      if (!t.stop) return true;
      return !nounCaps && t.cap && t.f.length >= 3 && sents[t.sid].from !== i;
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
      if (isName && nounCaps) {
        isName = stats.some(function (s) { return s.nameLike; }) ||
          (p.occ.every(function (start) { return !articled(start); }) &&
           p.content.every(function (k) { return !LL.nounSuffix.test(k) && !LANG.compoundKnown(lang, k); }));
      }
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

  function isNumberToken(tokens, i, L) {
    var t = tokens[i], next = tokens[i + 1];
    var MONTHS = L.monthSet, CENTURY = L.centurySet;
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
    // "XIX secolo", "siglo XIX", "XIXe siècle"
    if (/^[IVXLC]{1,6}(?:e|er|ème)?$/.test(t.text) && ((next && CENTURY.has(next.f)) || (i > 0 && CENTURY.has(tokens[i - 1].f)))) return true;
    return false;
  }

  // ---------------------------------------------------------------- cerca
  function parseTerms(str, lang) {
    return String(str || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).map(function (raw) {
      var prefix = /\*$/.test(raw);
      var clean = raw.replace(/\*+$/, '');
      var parts = [];
      var m, re = new RegExp(T.WORD.source, 'gu');
      while ((m = re.exec(clean))) parts.push(m[0]);
      return {
        raw: raw, prefix: prefix,
        keys: parts.map(function (p) { return T.keyOf(p, lang); }),
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
  function stats(tokens, sents, lang) {
    var N = tokens.length, letters = 0, uniq = new Set(), content = 0, syl = 0, blks = new Set();
    var L = LANG.get(lang), sylFn = lang === 'it' ? null : L.syl;
    // per i documenti molto lunghi le sillabe si contano su un campione regolare
    var step = sylFn && N > 60000 ? Math.ceil(N / 60000) : 1, sylN = 0;
    tokens.forEach(function (t, i) {
      letters += (t.text.match(/\p{L}/gu) || []).length;
      if (!/^\d+$/.test(t.f)) uniq.add(t.f);
      if (!t.stop) content++;
      blks.add(t.blk);
      if (sylFn && i % step === 0) { syl += sylFn(t.text); sylN++; }
    });
    var S = Math.max(1, sents.length), W = Math.max(1, N);
    if (sylFn) syl = syl * W / Math.max(1, sylN);
    var rd = LANG.readability(lang, { W: W, S: S, letters: letters, syl: syl });
    var readability = rd.value, scale = rd.scale, label = rd.label;
    return {
      words: N,
      uniqueWords: uniq.size,
      sentences: sents.length,
      paragraphs: blks.size,
      avgSentenceWords: +(N / S).toFixed(1),
      readingMinutes: Math.max(1, Math.round(N / (L.wpm || 200))),
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

  // ---------------------------------------------------------------- ripasso
  var ASK = {
    it: function (x) { return 'Che cos’è «' + x + '»?'; },
    en: function (x) { return 'What is “' + x + '”?'; },
    fr: function (x) { return 'Qu’est-ce que « ' + x + ' » ?'; },
    es: function (x) { return '¿Qué es «' + x + '»?'; },
    de: function (x) { return 'Was ist „' + x + '“?'; },
    pt: function (x) { return 'O que é «' + x + '»?'; }
  };
  var BLANK = '_____';
  function gapAt(tokens, k) { return tokens[k].gap.replace(/\s+/g, ' '); }
  function span(tokens, a, b) {
    var out = '';
    for (var k = a; k < b; k++) { if (k > a) out += gapAt(tokens, k); out += tokens[k].text; }
    return out;
  }
  // La frase con un buco al posto delle parole [bFrom, bTo)
  function clozeOf(tokens, s, bFrom, bTo) {
    var before = span(tokens, s.from, bFrom) + (bFrom > s.from ? gapAt(tokens, bFrom) : '');
    var ans = span(tokens, bFrom, bTo);
    var at = s.text.indexOf(before + ans);
    if (at < 0 || at > 3) return null;
    // "l'Unione Sovietica" -> "l'_____", "Calypso's" -> "_____'s": l'articolo e il genitivo restano
    var first = tokens[bFrom], last = tokens[bTo - 1];
    var pre = first.base && first.text !== first.base && first.text.slice(-first.base.length) === first.base ? first.text.slice(0, first.text.length - first.base.length) : '';
    var post = bTo - 1 > bFrom || !pre ? (last.base && last.text !== last.base && last.text.indexOf(last.base) === 0 ? last.text.slice(last.base.length) : '') : '';
    var cut = at + before.length + pre.length;
    var core = ans.slice(pre.length, ans.length - post.length);
    if (!core) return null;
    return { text: s.text.slice(0, cut) + BLANK + s.text.slice(cut + core.length), answer: core };
  }
  // generatore pseudo-casuale ripetibile (stesso documento = stesso quiz)
  function rng(seed) {
    var x = (seed * 2654435761) >>> 0 || 1;
    return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  }

  /*
   * Schede di ripasso, senza AI:
   *  - definizioni: "Che cos'è «cortina di ferro»?" -> la frase che la definisce;
   *  - frasi da completare: una frase chiave con un buco al posto del concetto, del nome o della data più importante.
   * Quando ci sono abbastanza alternative dello stesso tipo, la scheda ha anche 4 risposte per il quiz.
   */
  function buildCards(ctx) {
    var tokens = ctx.tokens, sents = ctx.sents, lang = ctx.lang, L = LANG.get(lang);
    var score = new Map(ctx.items.map(function (it) { return [it.id, it]; }));
    var ask = ASK[lang] || ASK.it;

    // cosa si può nascondere in una frase: parole chiave, espressioni, nomi, numeri e date
    function candidates(s) {
      var out = [], seen = new Map();
      for (var i = s.from; i < s.to; i++) {
        var t = tokens[i], c = null;
        if (t.grp && t.ph && t.grp.from === i && t.grp.to <= s.to && (ctx.kwSet.has(t.ph) || ctx.namePhrases.has(t.ph))) {
          c = { id: t.ph, from: i, to: t.grp.to, kind: ctx.namePhrases.has(t.ph) || (score.get(t.ph) || {}).name ? 'name' : 'concept' };
        } else if (!t.grp && !t.stop && (ctx.kwSet.has(t.key) || (t.cap && ctx.nameSingles.has(t.key)))) {
          c = { id: t.key, from: i, to: i + 1, kind: (t.cap && ctx.nameSingles.has(t.key)) || (score.get(t.key) || {}).name ? 'name' : 'concept' };
        } else if (!t.grp && /^\d{3,4}$/.test(t.f) && ctx.isNum(i)) {
          c = { id: '#' + t.f, from: i, to: i + 1, kind: 'num' };
        }
        if (!c) continue;
        seen.set(c.id, (seen.get(c.id) || 0) + 1);
        var it = score.get(c.id);
        c.score = it ? it.score : (c.kind === 'num' ? 0.05 : 0.1);
        out.push(c);
      }
      // una parola ripetuta nella stessa frase darebbe la risposta: non si nasconde
      return out.filter(function (c) { return seen.get(c.id) === 1; });
    }

    var pools = { name: [], concept: [], num: [] };
    ctx.items.forEach(function (it) { pools[it.name ? 'name' : 'concept'].push(it); });
    // altri nomi propri del testo come alternative nel quiz
    ctx.names.forEach(function (n) { if (!pools.name.some(function (x) { return x.id === n.id; })) pools.name.push(n); });
    var years = new Map();
    tokens.forEach(function (t, i) { if (/^\d{4}$/.test(t.f) && ctx.isNum(i)) years.set(t.f, (years.get(t.f) || 0) + 1); });
    pools.num = Array.from(years.keys()).map(function (y) { return { id: '#' + y, word: y }; });

    function choicesFor(c, answer, seed, context) {
      var parts = c.id.split(' ');
      var list = pools[c.kind].filter(function (it) {
        if (it.id === c.id) return false;
        var ks = it.id.split(' ');
        return !ks.some(function (k) { return parts.indexOf(k) >= 0; });
      });
      if (c.kind === 'num') {
        var y = +answer;
        list.sort(function (a, b) { return Math.abs(+a.word - y) - Math.abs(+b.word - y); });
        list = list.filter(function (it) { return it.word !== answer; }).slice(0, 6);
        // poche date nel testo: si aggiungono anni vicini
        [3, -4, 7, -9, 12].forEach(function (d) { if (list.length < 3) list.push({ id: '#' + (y + d), word: String(y + d) }); });
      } else {
        // alternative di forza simile: né troppo facili né assurde
        var pos = ctx.items.indexOf(score.get(c.id));
        list.sort(function (a, b) { return Math.abs(ctx.items.indexOf(a) - pos) - Math.abs(ctx.items.indexOf(b) - pos); });
      }
      // un'alternativa che compare già nella frase sarebbe troppo facile da scartare
      list = list.filter(function (it) { return context.indexOf(it.word) < 0; });
      var pick = list.slice(0, 3).map(function (it) {
        var w = it.word;
        // "Guerra fredda" (scritta così in un titolo) diventa "guerra fredda" se la risposta è minuscola
        if (lang !== 'de' && c.kind === 'concept' && /^\p{Ll}/u.test(answer) && !it.name && !/^\p{Lu}{2,}/u.test(w) && ctx.capR(it.id.split(' ')[0]) < 0.5) w = w.charAt(0).toLowerCase() + w.slice(1);
        return w;
      });
      if (pick.length < 3) return null;
      var all = pick.concat([answer]);
      var r = rng(seed + 7);
      for (var i = all.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var tmp = all[i]; all[i] = all[j]; all[j] = tmp; }
      return { choices: all, correct: all.indexOf(answer) };
    }

    var cards = [], used = new Set(), asked = new Map();
    function add(card, s, c, cl) {
      var q = choicesFor(c, cl.answer, s.id, cl.text);
      asked.set(c.id, (asked.get(c.id) || 0) + 1);
      card.sid = s.id;
      card.idx = s.to - 1;
      card.page = ctx.pageOf(s.from);
      // la frase da sola, senza "Inoltre," o "But" all'inizio
      card.cloze = cl.text.indexOf(BLANK) > 0 ? LANG.smooth(lang, cl.text) : cl.text;
      if (card.type === 'cloze') card.front = card.cloze;
      card.answer = cl.answer;
      if (q) { card.choices = q.choices; card.correct = q.correct; }
      cards.push(card);
      used.add(s.id);
    }

    // definizioni: il termine si ricava dalla struttura della frase ("X è un…", "si definisce X…");
    // se non è chiaro, si usa la parola chiave più forte nella prima metà della frase
    var nDef = 0;
    sents.forEach(function (s) {
      if (nDef >= 30 || !ctx.isDef(s)) return;
      var c = null, cl = null, term = LANG.defTerm(lang, s.text);
      if (term) {
        var at = s.text.indexOf(term);
        if (at >= 0) {
          var words = term.match(new RegExp(T.WORD.source, 'gu')) || [];
          var keys = words.map(function (w) { return T.keyOf(w, lang); }).filter(function (k) { return !T.isStop(k, lang); });
          var named = (lang !== 'de' && words.length && words.every(function (w) { return /^\p{Lu}/u.test(w); })) || /^\p{Lu}{2,}$/u.test(term) ||
            keys.some(function (k) { return (score.get(k) || {}).name; });
          c = { id: keys.join(' ') || term, kind: named ? 'name' : 'concept' };
          cl = { text: s.text.slice(0, at) + BLANK + s.text.slice(at + term.length), answer: term };
        }
      }
      if (!cl) {
        var cs = candidates(s).filter(function (x) { return x.kind !== 'num'; });
        if (!cs.length) return;
        var mid = s.from + (s.to - s.from) / 2;
        cs.sort(function (a, b) { return (b.score * (b.from < mid ? 2 : 1)) - (a.score * (a.from < mid ? 2 : 1)); });
        c = cs[0];
        cl = clozeOf(tokens, s, c.from, c.to);
        if (!cl) return;
      }
      add({ type: 'def', front: ask(cl.answer), back: s.text }, s, c, cl);
      nDef++;
    });

    // frasi chiave da completare
    var nCloze = 0, maxCloze = Math.max(5, Math.min(40, Math.round(ctx.summary.length * 1.2)));
    ctx.summary.forEach(function (s) {
      if (nCloze >= maxCloze || used.has(s.id)) return;
      var cs = candidates(s);
      if (!cs.length) return;
      // varietà: una risposta già chiesta vale meno
      cs.forEach(function (x) { x.score *= Math.pow(0.35, asked.get(x.id) || 0); });
      cs.sort(function (a, b) { return b.score - a.score; });
      var c = cs[0], cl = clozeOf(tokens, s, c.from, c.to);
      if (!cl) return;
      add({ type: 'cloze', front: cl.text, back: cl.answer + ' — ' + s.text }, s, c, cl);
      nCloze++;
    });
    cards.sort(function (a, b) { return a.sid - b.sid; });
    cards.forEach(function (c, i) { c.id = i; });
    return cards;
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
    var lang = opts.language && opts.language !== 'auto' ? opts.language : LANG.detect(tokens);
    var L = LANG.get(lang);
    T.prepare(tokens, lang);
    tokens.forEach(function (t) { t.ph = null; t.grp = null; t.mk = null; t.kid = null; });
    var sents = T.sentences(tokens, lang);
    var N = tokens.length;
    var mode = opts.mode || 'study';
    var selMul = SEL[(opts.selectivity || 3) - 1];

    // parole singole
    var kwRes = keywordStats(tokens, sents, opts.legs || 8, lang);
    var minTF = N < 250 ? 1 : 2;
    var singles = kwRes.ranked.filter(function (s) { return s.tf >= minTF || s.head > 0; });
    var baseK = Math.round(5 + Math.sqrt(singles.length) * 0.9);
    var strongTerms = new Set(singles.slice(0, baseK * 3).map(function (s) { return s.key; }));

    // espressioni di più parole
    var phrases = findPhrases(tokens, kwRes.map, strongTerms, sents, lang);
    var phraseMap = new Map(phrases.map(function (p) { return [p.key, p]; }));
    var inPhrase = new Map();
    tokens.forEach(function (t) { if (t.ph && !t.stop) inPhrase.set(t.key, (inPhrase.get(t.key) || 0) + 1); });

    var items = [];
    singles.forEach(function (s) {
      var inside = inPhrase.get(s.key) || 0;
      if (inside >= 0.6 * s.tfAll) return; // quasi sempre dentro un'espressione: conta l'espressione
      items.push({ id: s.key, word: s.display, score: s.score * (1 - 0.5 * inside / s.tfAll), count: s.tfAll - inside, name: s.nameLike, head: s.head });
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
    var nameSingles = new Set(kwRes.ranked.filter(function (s) { return s.nameLike && s.display.length > 2; }).slice(0, 120).map(function (s) { return s.key; }));
    var namePhrases = new Set(phrases.filter(function (p) { return p.isName; }).map(function (p) { return p.key; }));

    function kwIdOf(t) {
      if (t.ph && kwSet.has(t.ph)) return t.ph;
      if (!t.stop && kwSet.has(t.key)) return t.key;
      return null;
    }
    function nameIdOf(t) {
      if (t.ph && namePhrases.has(t.ph)) return t.ph;
      if (!t.stop && t.cap && nameSingles.has(t.key)) {
        // "Cold" in un titolo, quando di solito compare dentro "Cold War": conta l'espressione, non la parola
        var st = kwRes.map.get(t.key);
        if (!t.grp && st && (inPhrase.get(t.key) || 0) >= 0.5 * st.tfAll) return null;
        return t.key;
      }
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
    var summary = summarize(sents, opts, tokens, lang);
    var summarySet = new Set(summary.map(function (s) { return s.id; }));
    function pageOf(i) { return tokens[i] && tokens[i].page != null ? tokens[i].page : null; }
    var defCache = new Map();
    function isDef(s) {
      if (!defCache.has(s.id)) defCache.set(s.id, isDefinition(s, tokens, lang, kwSet, kwRes.map));
      return defCache.get(s.id);
    }
    // schede di ripasso: prima dei segni della modalità, che cambiano i gruppi di parole
    var cards = buildCards({
      tokens: tokens, sents: sents, lang: lang, items: cands.slice(0, Math.max(K * 2, 40)), kwSet: kwSet,
      namePhrases: namePhrases, nameSingles: nameSingles, summary: summary, pageOf: pageOf, isDef: isDef,
      names: phrases.filter(function (p) { return p.isName; }).map(function (p) { return { id: p.key, word: p.display, name: true }; })
        .concat(kwRes.ranked.filter(function (x) { return nameSingles.has(x.key) && !inPhrase.get(x.key); }).map(function (x) { return { id: x.key, word: x.display, name: true }; })),
      isNum: function (i) { return isNumberToken(tokens, i, L); },
      capR: function (key) { var st = kwRes.map.get(key); return st ? st.capR : 0; }
    });

    var highlights = [];
    var styleMap = new Map(), styleN = 0, STY = ['kw-lav', 'kw-cyan', 'ring-cyan'];
    function styleFor(id) {
      if (!styleMap.has(id)) styleMap.set(id, STY[styleN++ % STY.length]);
      return styleMap.get(id);
    }
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
        if (opts.markNumbers && !t.grp && isNumberToken(tokens, i, L)) {
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
        if (opts.markDefinitions && isDef(s)) s.mk = 'def';
        else if (opts.markKeySentences && summarySet.has(s.id)) s.mk = 'key';
        if (s.mk) highlights.push({ type: s.mk, text: s.text, sid: s.id, idx: s.to - 1, page: pageOf(s.from) });
      });
    } else if (mode === 'search') {
      var terms = parseTerms(opts.searchTerms, lang);
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
      langName: L.name,
      frequencies: LANG.hasFreq(lang),
      stats: stats(tokens, sents, lang),
      keywords: kwItems.map(function (it) { return { key: it.id, word: it.word, score: +it.score.toFixed(3), count: it.count, name: !!it.name, phrase: !!it.phrase }; }),
      discarded: rej.map(function (it) { return it.word; }),
      // nel sunto si toglie il connettivo iniziale ("Inoltre, …") se la frase prima non è nel sunto
      summary: summary.map(function (s) {
        var prevIn = summarySet.has(s.id - 1);
        return { sid: s.id, text: prevIn ? s.text : LANG.smooth(lang, s.text), page: pageOf(s.from), idx: s.to - 1 };
      }),
      cards: cards,
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

  g.WCAnalysis = { analyze: analyze, parseTerms: parseTerms, BLANK: BLANK };
})(globalThis);
