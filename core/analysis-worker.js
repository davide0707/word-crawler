// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: analisi in un thread separato (Web Worker), per i documenti lunghi.
 * La pagina resta reattiva mentre si analizzano centinaia di migliaia di parole.
 *
 * Riceve:  { id, tokens: [[text, gap, blk, w, page], ...], tail, settings }
 * Risponde: { id, results, lang, marks: { mk, kid, gf, gt, sid }, sents: [[from, to, mk], ...], display: { id: testo } }
 *           oppure { id, error }
 */
/* global importScripts, WCLang, WCAnalysis */
'use strict';
importScripts('settings.js', 'lang.js', 'text.js', 'analysis.js');

self.onmessage = function (e) {
  var d = e.data || {};
  run(d).then(function (out) { self.postMessage(out); }, function (err) {
    self.postMessage({ id: d.id, error: String(err && err.message || err) });
  });
};

function run(d) {
  var toks = d.tokens.map(function (a) { return { text: a[0], gap: a[1], blk: a[2], w: a[3], page: a[4] == null ? null : a[4] }; });
  if (toks.length && d.tail) toks[toks.length - 1].tail = d.tail;
  var settings = d.settings || {};
  var lang = settings.language && settings.language !== 'auto' ? settings.language : WCLang.detect(toks);
  return WCLang.ensure(lang).then(function () {
    var res = WCAnalysis.analyze(toks, settings);
    var n = toks.length;
    var mk = new Array(n), kid = new Array(n), gf = new Int32Array(n), gt = new Int32Array(n), sid = new Int32Array(n);
    var display = {};
    for (var i = 0; i < n; i++) {
      var t = toks[i];
      mk[i] = t.mk || null;
      kid[i] = t.kid || null;
      gf[i] = t.grp ? t.grp.from : -1;
      gt[i] = t.grp ? t.grp.to : -1;
      sid[i] = t.sid;
      if (t.kid && !(t.kid in display)) display[t.kid] = res.plan.display(t.kid);
    }
    var sents = res.plan.sentences.map(function (s) { return [s.from, s.to, s.mk || null]; });
    return { id: d.id, lang: res.results.lang, results: res.results, marks: { mk: mk, kid: kid, gf: gf, gt: gt, sid: sid }, sents: sents, display: display };
  });
}
