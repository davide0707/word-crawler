// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: lo studio (ripasso a intervalli crescenti, senza AI).
 *
 * La libreria sa quali concetti ci sono, come sono definiti e da dove vengono. Qui si aggiunge il
 * "quanto lo so":
 *  - le domande si costruiscono meccanicamente da quello che la libreria ha già estratto: la
 *    definizione di un concetto, la stessa definizione col termine oscurato, la relazione "è un tipo
 *    di" letta nelle definizioni, oppure una frase dove il concetto compare. Niente testo inventato:
 *    ogni domanda cita il documento, la pagina e la slide da cui viene;
 *  - la risposta si può scrivere (confronto tollerante: accenti, plurali e un errore di battitura) o
 *    rivelare e giudicare da soli, con quattro gradi come in Anki;
 *  - gli intervalli crescono con SM-2: ogni concetto ha facilità, intervallo e data del prossimo
 *    ripasso. La padronanza (0..1) viene dall'intervallo raggiunto e serve a colorare la mappa;
 *  - il percorso di studio ordina i concetti dai più generali ai più specifici seguendo le relazioni
 *    "è un tipo di" del grafo: prima "modulazione digitale", poi "QAM". A pari livello vince il
 *    concetto più centrale.
 * Lo stato è salvato a parte, come le modifiche della mappa, e sopravvive a unioni e separazioni:
 * un concetto è riconosciuto da una qualsiasi delle sue radici.
 *
 * WCStudy.open(state, kb) -> { stats(), path(opts), session(opts), grade(op), state(), anki(opts), reset(opts) }
 *   state: { v, cards: { <chiave>: card }, log: [...] }   (WCStudy.emptyState() per uno vuoto)
 *   card:  { ease, interval, due, reps, lapses, last, seen }
 *   kb:    la libreria aperta (serve graph() e concept(id))
 */
(function (g) {
  'use strict';
  if (g.WCStudy) return;
  var T = g.WCText;

  var VERSION = 1;
  var DAY = 86400000;
  var MATURE = 21;          // giorni di intervallo oltre i quali un concetto è "saldo"
  var DEFAULT_SESSION = 20; // domande per sessione, se non ne vengono chieste altre
  var MAX_SESSION = 60;

  function fold(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function round(x, n) { var k = Math.pow(10, n || 3); return Math.round(x * k) / k; }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function iso(t) { return new Date(t).toISOString(); }
  function emptyState() { return { v: VERSION, cards: {}, log: [] }; }

  function emptyCard() { return { ease: 2.5, interval: 0, due: null, reps: 0, lapses: 0, last: null, seen: 0 }; }

  /*
   * Padronanza 0..1: quanto è lontano il prossimo ripasso, con una penalità per le dimenticanze.
   * Un concetto appena dimenticato non torna a zero: zero vuol dire "mai visto", e sulla mappa i due
   * casi devono avere colori diversi.
   */
  function masteryOf(card) {
    if (!card || (!card.reps && !card.lapses)) return 0;
    var m = Math.log(1 + card.interval) / Math.log(1 + MATURE);
    m *= 1 - clamp(card.lapses / (card.reps + card.lapses), 0, 0.6);
    return clamp(round(m, 3), 0.02, 1);
  }

  /*
   * SM-2 ridotto a quattro gradi. 0 = di nuovo (dimenticato), 1 = difficile, 2 = bene, 3 = facile.
   * Chi dimentica torna a un giorno e perde facilità; gli altri moltiplicano l'intervallo.
   */
  function schedule(card, grade, now) {
    var c = {
      ease: card.ease || 2.5, interval: card.interval || 0, reps: card.reps || 0,
      lapses: card.lapses || 0, seen: (card.seen || 0) + 1, last: iso(now), due: null
    };
    if (grade <= 0) {
      c.lapses += 1;
      c.reps = 0;
      c.ease = clamp(c.ease - 0.2, 1.3, 2.8);
      c.interval = 1;
    } else {
      c.reps += 1;
      if (grade === 1) c.ease = clamp(c.ease - 0.15, 1.3, 2.8);
      else if (grade === 3) c.ease = clamp(c.ease + 0.1, 1.3, 2.8);
      if (c.reps === 1) c.interval = grade === 1 ? 1 : (grade === 3 ? 4 : 2);
      else if (c.reps === 2) c.interval = grade === 1 ? 3 : (grade === 3 ? 8 : 6);
      else c.interval = Math.round(c.interval * c.ease * (grade === 1 ? 0.6 : (grade === 3 ? 1.3 : 1)));
      c.interval = clamp(c.interval, 1, 365 * 3);
    }
    c.due = iso(now + c.interval * DAY);
    return c;
  }

  // ------------------------------------------------------------------ domande
  /*
   * Oscura nel testo tutte le forme del concetto. Il confronto è sulle radici, così "modulazioni"
   * viene oscurato anche se il concetto si chiama "modulazione". Torna null se non trova niente:
   * una frase in cui il termine non compare non può diventare un buco da riempire.
   */
  function blank(text, forms, lang) {
    var toks = T.prepare(T.tokenizeString(String(text || '')), lang);
    var keys = new Map();
    forms.forEach(function (f) {
      var ft = T.prepare(T.tokenizeString(f), lang).filter(function (t) { return t.key; });
      if (ft.length) keys.set(ft.map(function (t) { return t.key; }).join(' '), ft.length);
    });
    if (!keys.size) return null;
    var spans = [], i = 0;
    while (i < toks.length) {
      var hit = 0;
      keys.forEach(function (len, seq) {
        if (hit) return;
        if (i + len > toks.length) return;
        var run = [];
        for (var k = 0; k < len; k++) run.push(toks[i + k].key);
        if (run.join(' ') === seq) hit = len;
      });
      if (hit) { spans.push([toks[i].start, toks[i + hit - 1].end]); i += hit; } else i++;
    }
    if (!spans.length) return null;
    var out = '', at = 0;
    spans.forEach(function (s) { out += text.slice(at, s[0]) + ' _____ '; at = s[1]; });
    out += text.slice(at);
    return out.replace(/\s+/g, ' ').trim();
  }

  // una frase sola, abbastanza completa da reggere da sola come domanda
  function sentenceWith(text, forms, lang) {
    var parts = String(text || '').split(/(?<=[.!?;:])\s+/);
    var best = null;
    parts.forEach(function (p) {
      var s = p.trim();
      if (s.length < 50 || s.length > 320) return;
      var b = blank(s, forms, lang);
      if (!b) return;
      if (b.split('_____').length - 1 > 3) return;
      if (!best || s.length > best.text.length) best = { text: s, blanked: b };
    });
    return best;
  }

  var ASK = {
    def: 'Che cos’è?',
    cloze: 'Completa la frase.',
    isa: 'Di che cosa è un tipo?',
    use: 'Quale concetto manca?'
  };

  /*
   * Le carte di un concetto, in ordine di preferenza. Ogni carta porta la sua fonte: documento,
   * pagina o slide, e il pezzo da aprire nel lettore.
   */
  function cardsFor(node, info, isaParent) {
    var out = [], forms = (info.forms || [node.label]).slice(0, 8);
    var lang = node.lang || info.lang || 'it';
    (info.defs || []).slice(0, 3).forEach(function (df) {
      var src = { doc: df.doc, name: df.name, path: df.path, n: df.n, page: df.page, slide: df.slide, where: df.where };
      out.push({ kind: 'def', ask: ASK.def, front: node.label, back: df.text, answer: null, source: src });
      var b = blank(df.text, forms, lang);
      if (b) out.push({ kind: 'cloze', ask: ASK.cloze, front: b, back: df.text, answer: node.label, source: src });
    });
    if (isaParent) {
      out.push({ kind: 'isa', ask: ASK.isa, front: node.label, back: isaParent.label, answer: isaParent.label, source: isaParent.source || null });
    }
    if (!out.length) {
      var srcs = (info.sources || []).slice(0, 6);
      for (var i = 0; i < srcs.length; i++) {
        var s = sentenceWith(srcs[i].full || srcs[i].text, forms, lang);
        if (!s) continue;
        out.push({
          kind: 'use', ask: ASK.use, front: s.blanked, back: s.text, answer: node.label,
          source: { doc: srcs[i].doc, name: srcs[i].name, path: srcs[i].path, n: srcs[i].n, page: srcs[i].page, slide: srcs[i].slide, where: srcs[i].where }
        });
        break;
      }
    }
    return out;
  }

  // risposta scritta: tollera accenti, maiuscole, punteggiatura, plurali e un errore di battitura
  function matches(given, expected, lang) {
    var a = fold(given).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    var b = fold(expected).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!a) return false;
    if (a === b) return true;
    function stems(s) {
      return T.prepare(T.tokenizeString(s), lang || 'it').filter(function (t) { return t.key; }).map(function (t) { return t.key; }).join(' ');
    }
    if (stems(a) && stems(a) === stems(b)) return true;
    var d = lev(a, b, 2);
    return d <= (b.length >= 8 ? 2 : 1);
  }
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

  // ------------------------------------------------------------------ apertura
  function open(state, kb) {
    var st = state && state.cards ? state : emptyState();
    if (!st.log) st.log = [];
    var G = null, isaOf = null, depth = null, order = null, idMap = null;

    function graph() {
      if (!G) {
        G = kb.graph();
        buildOrder();
      }
      return G;
    }
    function invalidate() { G = null; isaOf = null; depth = null; order = null; idMap = null; }

    /*
     * Percorso: le relazioni "è un tipo di" vanno dal concetto specifico al generale, quindi il
     * livello di un concetto è la distanza dal suo capostipite. I cicli (rari, ma le definizioni
     * circolari esistono) si interrompono contando le visite.
     */
    function buildOrder() {
      var nodes = G.nodes, idx = new Map();
      nodes.forEach(function (n, i) { idx.set(n.id, i); });
      isaOf = new Map();
      G.edges.forEach(function (e) {
        if (e.type !== 'isa') return;
        if (!isaOf.has(e.a)) isaOf.set(e.a, e.b); // a è un tipo di b
      });
      depth = new Map();
      function levelOf(id, guard) {
        if (depth.has(id)) return depth.get(id);
        if (guard > 12) return 0;
        var p = isaOf.get(id);
        var d = p && p !== id && idx.has(p) ? levelOf(p, guard + 1) + 1 : 0;
        depth.set(id, d);
        return d;
      }
      nodes.forEach(function (n) { levelOf(n.id, 0); });
      order = nodes.slice().sort(function (a, b) {
        var da = depth.get(a.id) || 0, db = depth.get(b.id) || 0;
        if (da !== db) return da - db;
        if (a.central !== b.central) return a.central ? -1 : 1;
        return (b.rank - a.rank) || (b.weight - a.weight);
      });
    }

      /*
     * Non tutto quello che finisce sulla mappa vale una domanda: "definisce", "bit" o il titolo di un
     * capitolo sono parole frequenti, non concetti da sapere. Si studia quello che qualcuno ha
     * definito, i nomi propri, le sigle e i termini di più parole; una parola sola passa solo se è
     * centrale, ricorre in più documenti ed è frequente.
     */
    function worth(n) {
      if (n.defs > 0) return true;
      if (/\s/.test(n.label)) return n.count >= 2;
      if (/^[0-9]*[A-Z][A-Z0-9][A-Z0-9\-]*$/.test(n.label)) return true;
      if (n.name) return n.multi || n.count >= 3;
      return n.central && n.multi && n.count >= 4;
    }

  // un concetto è riconosciuto da una qualsiasi delle sue radici: le unioni non perdono i progressi
    function keysOf(node) { return (node.members && node.members.length ? node.members : [node.id]); }
    function cardOf(node) {
      var best = null;
      keysOf(node).forEach(function (k) {
        var c = st.cards[k];
        if (!c) return;
        if (!best || (c.seen || 0) > (best.seen || 0)) best = c;
      });
      return best;
    }
    function nodeKeys(id) {
      var n = byId(id);
      return n ? keysOf(n) : [id];
    }
    function byId(id) {
      graph();
      if (!idMap) {
        idMap = new Map();
        G.nodes.forEach(function (n) {
          idMap.set(n.id, n);
          (n.members || []).forEach(function (k) { if (!idMap.has(k)) idMap.set(k, n); });
        });
      }
      return idMap.get(id) || null;
    }

    function dueState(card, now) {
      if (!card || !card.reps && !card.lapses) return 'new';
      if (!card.due) return 'new';
      return Date.parse(card.due) <= now ? 'due' : (card.interval >= MATURE ? 'mature' : 'learning');
    }

    function stats(opts) {
      graph();
      var now = Date.now(), o = opts || {};
      var s = { total: 0, newCount: 0, learning: 0, mature: 0, due: 0, mastery: 0, next7: [0, 0, 0, 0, 0, 0, 0], studied: 0, answers: st.log.length };
      var sum = 0;
      G.nodes.forEach(function (n) {
        if (o.doc && n.docs.indexOf(o.doc) < 0) return;
        if (!worth(n)) return;
        s.total++;
        var c = cardOf(n), k = dueState(c, now);
        if (k === 'new') s.newCount++;
        else {
          s.studied++;
          if (k === 'due') s.due++;
          else if (k === 'mature') s.mature++;
          else s.learning++;
          var d = Math.floor((Date.parse(c.due) - now) / DAY);
          if (d >= 0 && d < 7) s.next7[d]++;
        }
        sum += masteryOf(c);
      });
      s.mastery = s.total ? round(sum / s.total, 3) : 0;
      return s;
    }

    function path(opts) {
      graph();
      var o = opts || {}, now = Date.now(), out = [];
      var limit = clamp(o.limit || 400, 1, 3000);
      for (var i = 0; i < order.length && out.length < limit; i++) {
        var n = order[i];
        if (o.doc && n.docs.indexOf(o.doc) < 0) continue;
        if (!worth(n)) continue;
        var par = isaOf.get(n.id) ? byId(isaOf.get(n.id)) : null;
        var c = cardOf(n);
        out.push({
          id: n.id, label: n.label, level: depth.get(n.id) || 0,
          parent: par ? { id: par.id, label: par.label } : null,
          ndocs: n.ndocs, count: n.count, defs: n.defs, central: n.central, multi: n.multi,
          mastery: masteryOf(c), state: dueState(c, now), due: c ? c.due : null, reps: c ? c.reps : 0
        });
      }
      return { items: out, total: order.filter(worth).length };
    }

    // padronanza di ogni concetto, per colorare la mappa
    function mastery(opts) {
      graph();
      var now = Date.now(), out = {};
      G.nodes.forEach(function (n) {
        var c = cardOf(n);
        if (!c) return;
        out[n.id] = [masteryOf(c), dueState(c, now) === 'due' ? 1 : 0];
      });
      return out;
    }

    /*
     * La sessione: prima i concetti da ripassare (il più scaduto davanti), poi i nuovi in ordine di
     * percorso. Ogni concetto dà una carta sola per sessione, scelta a rotazione sulle risposte già
     * date, così lo stesso concetto non chiede sempre la stessa cosa.
     */
    function session(opts) {
      graph();
      var o = opts || {}, now = Date.now();
      var want = clamp(o.limit || DEFAULT_SESSION, 1, MAX_SESSION);
      // i concetti nuovi riempiono il posto che resta dopo quelli da ripassare, salvo un tetto esplicito
      var newWant = o.newOnly ? want : clamp(o.newCount == null ? want : o.newCount, 0, want);
      var dueList = [], newList = [];
      order.forEach(function (n) {
        if (o.doc && n.docs.indexOf(o.doc) < 0) return;
        if (o.ids && o.ids.indexOf(n.id) < 0) return;
        if (!worth(n) && !(o.ids && o.ids.indexOf(n.id) >= 0)) return;
        var c = cardOf(n), k = dueState(c, now);
        if (k === 'new') newList.push(n);
        else if (k === 'due') dueList.push({ n: n, due: Date.parse(c.due) });
      });
      dueList.sort(function (a, b) { return a.due - b.due; });
      var picked = [];
      if (!o.newOnly) dueList.slice(0, Math.max(0, want - Math.min(newWant, newList.length))).forEach(function (x) { picked.push(x.n); });
      newList.slice(0, Math.min(newWant, want - picked.length)).forEach(function (n) { picked.push(n); });
      if (!picked.length && o.anyway) {
        order.forEach(function (n) {
          if (picked.length >= want) return;
          if (o.doc && n.docs.indexOf(o.doc) < 0) return;
          if (o.ids ? o.ids.indexOf(n.id) < 0 : !worth(n)) return;
          picked.push(n);
        });
      }
      var cards = [];
      picked.forEach(function (n) {
        var info = kb.concept(n.id);
        if (!info) return;
        var parent = null, pid = isaOf.get(n.id);
        if (pid) {
          var pn = byId(pid);
          if (pn) {
            var pdef = (info.defs || [])[0];
            parent = { label: pn.label, source: pdef ? { doc: pdef.doc, name: pdef.name, path: pdef.path, n: pdef.n, page: pdef.page, slide: pdef.slide, where: pdef.where } : null };
          }
        }
        var list = cardsFor(n, info, parent);
        if (!list.length) return;
        var c = cardOf(n);
        var pick = list[((c && c.seen) || 0) % list.length];
        pick.id = n.id;
        pick.label = n.label;
        pick.mastery = masteryOf(c);
        pick.state = dueState(c, now);
        pick.reps = c ? c.reps : 0;
        cards.push(pick);
      });
      return { cards: cards, stats: stats({ doc: o.doc }) };
    }

    /*
     * Il voto. grade: 0 di nuovo, 1 difficile, 2 bene, 3 facile. Con "typed" la risposta scritta
     * viene confrontata e il voto si deduce (giusta = bene, sbagliata = di nuovo).
     */
    function grade(op) {
      var o = op || {}, now = Date.now();
      var n = byId(o.id);
      if (!n) throw new Error('concetto non trovato');
      var gr = o.grade, correct = null;
      if (o.typed != null) {
        correct = matches(o.typed, o.answer || n.label, o.lang);
        if (gr == null) gr = correct ? 2 : 0;
      }
      gr = clamp(gr == null ? 2 : gr | 0, 0, 3);
      var prev = cardOf(n) || emptyCard();
      var next = schedule(prev, gr, now);
      nodeKeys(n.id).forEach(function (k) { delete st.cards[k]; });
      st.cards[n.id] = next;
      st.log.push({ t: iso(now), id: n.id, g: gr, k: o.kind || null, typed: o.typed != null ? !!correct : null });
      if (st.log.length > 5000) st.log = st.log.slice(-5000);
      return {
        id: n.id, label: n.label, grade: gr, correct: correct, card: next,
        mastery: masteryOf(next), state: dueState(next, now), nextIn: next.interval
      };
    }

    function reset(opts) {
      var o = opts || {};
      if (o.id) {
        var n = byId(o.id);
        if (!n) throw new Error('concetto non trovato');
        nodeKeys(n.id).forEach(function (k) { delete st.cards[k]; });
      } else { st.cards = {}; st.log = []; }
      return { cards: Object.keys(st.cards).length };
    }

    /*
     * Esportazione per Anki: testo separato da tabulazioni, con le direttive che Anki riconosce.
     * Tre colonne: domanda, risposta (con la fonte), etichette. Tabulazioni e capo a riga diventano
     * spazi e <br>, altrimenti Anki sbaglia le colonne.
     */
    function anki(opts) {
      graph();
      var o = opts || {};
      var out = ['#separator:tab', '#html:true', '#tags column:3', '#notetype:Basic'];
      var limit = clamp(o.limit || 2000, 1, 5000), count = 0;
      function clean(s) { return String(s || '').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>').trim(); }
      for (var i = 0; i < order.length && count < limit; i++) {
        var n = order[i];
        if (o.doc && n.docs.indexOf(o.doc) < 0) continue;
        if (!worth(n)) continue;
        if (o.onlyStudied && !cardOf(n)) continue;
        var info = kb.concept(n.id);
        if (!info) continue;
        var parent = null, pid = isaOf.get(n.id);
        if (pid) { var pn = byId(pid); if (pn) parent = { label: pn.label }; }
        var list = cardsFor(n, info, parent);
        if (!list.length) continue;
        var c = list[0];
        var src = c.source ? ' <i>(' + clean(c.source.name + (c.source.where ? ', ' + c.source.where : '')) + ')</i>' : '';
        var tags = ['word-crawler'];
        (info.docs || []).slice(0, 3).forEach(function (d) { tags.push(String(d.name || '').replace(/[\s\t]+/g, '_').replace(/[^\w.\-]/g, '').slice(0, 40) || 'documento'); });
        out.push([clean(c.kind === 'def' ? c.front : c.front), clean(c.back) + src, tags.join(' ')].join('\t'));
        count++;
      }
      return { text: out.join('\n') + '\n', count: count };
    }

    return {
      stats: stats, path: path, session: session, grade: grade, mastery: mastery,
      anki: anki, reset: reset, invalidate: invalidate,
      state: function () { return st; }
    };
  }

  g.WCStudy = {
    VERSION: VERSION, open: open, emptyState: emptyState, masteryOf: masteryOf,
    schedule: schedule, blank: blank, matches: matches, MATURE: MATURE
  };
})(globalThis);
