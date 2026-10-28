// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: punti, livelli, traguardi e giorni di fila.
 *
 * Non c'è niente da salvare in più: tutto si ricava dal registro delle risposte che lo studio tiene
 * già (core/study.js), contando quello che è successo. Così i numeri non possono andare fuori sincrono
 * con i progressi veri, e cancellare lo studio cancella anche i punti.
 *
 * Le regole, tenute semplici e oneste:
 *  - punti: 10 per una risposta giusta, 3 per una sbagliata (provarci vale comunque qualcosa, ma
 *    molto meno), più 5 ogni volta che un concetto diventa saldo;
 *  - livelli: servono sempre più punti, ma la crescita è dolce (radice quadrata), così il livello 10
 *    resta raggiungibile e il livello 30 è una cosa da mesi;
 *  - giorni di fila: due giorni contigui con almeno una risposta. Un giorno saltato azzera;
 *  - obiettivo del giorno: un numero di risposte, non di minuti, perché il tempo non si misura bene.
 *
 * WCGamify.of(state, opts) -> { xp, level, next, toNext, progress, streak, best, today, goal,
 *                               done, days, answers, right, accuracy, badges: [...] }
 */
(function (g) {
  'use strict';
  if (g.WCGamify) return;

  var XP_RIGHT = 10, XP_WRONG = 3, XP_MATURE = 5;
  var GOAL = 20; // risposte al giorno

  // livello da punti: 100, 283, 520, 800, 1118… (crescita dolce)
  function levelOf(xp) { return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1); }
  function xpFor(level) { return Math.pow(Math.max(0, level - 1), 2) * 100; }

  function dayOf(iso) { return String(iso || '').slice(0, 10); }
  function today(now) { return new Date(now == null ? Date.now() : now).toISOString().slice(0, 10); }
  function prevDay(d) { var t = Date.parse(d + 'T12:00:00Z') - 86400000; return new Date(t).toISOString().slice(0, 10); }

  var BADGES = [
    { id: 'first', name: 'Primo passo', why: 'La prima risposta', test: function (s) { return s.answers >= 1; } },
    { id: 'ten', name: 'Dieci', why: 'Dieci risposte', test: function (s) { return s.answers >= 10; } },
    { id: 'hundred', name: 'Cento', why: 'Cento risposte', test: function (s) { return s.answers >= 100; } },
    { id: 'thousand', name: 'Mille', why: 'Mille risposte', test: function (s) { return s.answers >= 1000; } },
    { id: 'goal', name: 'Obiettivo centrato', why: 'L’obiettivo del giorno raggiunto', test: function (s) { return s.done; } },
    { id: 'week', name: 'Una settimana', why: 'Sette giorni di fila', test: function (s) { return s.best >= 7; } },
    { id: 'month', name: 'Un mese', why: 'Trenta giorni di fila', test: function (s) { return s.best >= 30; } },
    { id: 'precise', name: 'Preciso', why: 'Almeno il 90% di risposte giuste su cento', test: function (s) { return s.answers >= 100 && s.accuracy >= 0.9; } },
    { id: 'solid10', name: 'Dieci saldi', why: 'Dieci concetti saldi', test: function (s) { return s.mature >= 10; } },
    { id: 'solid50', name: 'Cinquanta saldi', why: 'Cinquanta concetti saldi', test: function (s) { return s.mature >= 50; } },
    { id: 'half', name: 'Metà strada', why: 'Metà dei concetti studiati almeno una volta', test: function (s) { return s.total >= 10 && s.studied >= s.total / 2; } },
    { id: 'all', name: 'Tutto visto', why: 'Nessun concetto mai visto', test: function (s) { return s.total >= 10 && s.studied >= s.total; } },
    { id: 'comeback', name: 'Ritorno', why: 'Ripreso dopo una settimana di pausa', test: function (s) { return s.comeback; } },
    { id: 'night', name: 'Nottambulo', why: 'Una sessione dopo mezzanotte', test: function (s) { return s.night; } },
    { id: 'coder', name: 'Anche il codice', why: 'Una domanda sul codice', test: function (s) { return s.code; } }
  ];

  function of(state, opts) {
    var o = opts || {};
    var log = (state && state.log) || [];
    var cards = (state && state.cards) || {};
    var now = o.now == null ? Date.now() : o.now;
    var goal = Math.max(1, o.goal || GOAL);
    var t = today(now);

    var xp = 0, right = 0, answers = log.length, nightOwl = false, codeQ = false;
    var days = new Set(), perDay = new Map();
    log.forEach(function (e) {
      var ok = e.g >= 2;
      xp += ok ? XP_RIGHT : XP_WRONG;
      if (ok) right++;
      var d = dayOf(e.t);
      if (d) { days.add(d); perDay.set(d, (perDay.get(d) || 0) + 1); }
      var h = Number(String(e.t || '').slice(11, 13));
      if (h >= 0 && h < 5) nightOwl = true;
      if (e.k && /^code/.test(e.k)) codeQ = true;
    });
    var mature = 0, studied = 0;
    Object.keys(cards).forEach(function (k) {
      studied++;
      if ((cards[k].interval || 0) >= 21) mature++;
    });
    xp += mature * XP_MATURE;

    // giorni di fila: da oggi (o da ieri, se oggi non si è ancora risposto) all'indietro
    var streak = 0, d2 = days.has(t) ? t : prevDay(t);
    while (days.has(d2)) { streak++; d2 = prevDay(d2); }
    if (!days.has(t) && !days.has(prevDay(t))) streak = 0;
    var best = 0, run = 0, sorted = Array.from(days).sort();
    sorted.forEach(function (d3, i) {
      if (i && prevDay(d3) === sorted[i - 1]) run++; else run = 1;
      if (run > best) best = run;
    });
    // una ripresa dopo una lunga pausa
    var comeback = false;
    for (var i2 = 1; i2 < sorted.length; i2++) {
      var gapDays = Math.round((Date.parse(sorted[i2]) - Date.parse(sorted[i2 - 1])) / 86400000);
      if (gapDays >= 7) comeback = true;
    }

    var level = levelOf(xp), nextAt = xpFor(level + 1), base = xpFor(level);
    var s = {
      xp: xp, level: level, next: nextAt, toNext: Math.max(0, nextAt - xp),
      progress: nextAt > base ? Math.min(1, (xp - base) / (nextAt - base)) : 1,
      streak: streak, best: best, days: days.size,
      today: perDay.get(t) || 0, goal: goal, done: (perDay.get(t) || 0) >= goal,
      answers: answers, right: right, accuracy: answers ? right / answers : 0,
      mature: mature, studied: studied, total: o.total || studied,
      comeback: comeback, night: nightOwl, code: codeQ
    };
    s.badges = BADGES.map(function (b) { return { id: b.id, name: b.name, why: b.why, got: !!b.test(s) }; });
    s.got = s.badges.filter(function (b) { return b.got; }).length;
    return s;
  }

  g.WCGamify = { of: of, levelOf: levelOf, xpFor: xpFor, BADGES: BADGES, GOAL: GOAL, XP_RIGHT: XP_RIGHT, XP_WRONG: XP_WRONG };
})(globalThis);
