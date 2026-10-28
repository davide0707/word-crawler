// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: la libreria in un thread separato (Web Worker).
 * Analisi dei documenti importati, indice di ricerca e grafo dei concetti: la finestra resta reattiva.
 *
 * Messaggi: { id, type, ... } -> { id, result } oppure { id, error }
 *   process  { input, settings }     un documento -> record da salvare
 *   load     { records, edits }      apre la base di conoscenza
 *   upsert   { record }              aggiunge o sostituisce un documento
 *   remove   { docId }               toglie un documento
 *   search   { query, filters }
 *   graph    {}                      nodi, collegamenti, suggerimenti
 *   concept  { cid }                scheda di un concetto
 *   edit     { op }                  modifica dell'utente -> { edits, graph? }
 *   markdown {}                      mappa in Markdown
 *   docs     {}                      elenco dei documenti
 * Codice (core/code.js, letto in library.js):
 *   code          { op }            chi chiama, usi, codice morto, cose da fare, complessità, glossario, dipendenze
 *   code-markdown { doc? }          documentazione automatica in Markdown
 * Studio (core/study.js), sullo stesso grafo:
 *   study-load  { state }            carica i progressi salvati
 *   study-stats { doc? }             quanti concetti nuovi, da ripassare, saldi
 *   study-path  { doc?, limit? }     percorso dai concetti generali a quelli specifici
 *   session     { limit?, doc?, ... } le domande di una sessione
 *   grade       { op }               voto di una risposta -> { result, state }
 *   mastery     {}                   padronanza di ogni concetto, per colorare la mappa
 *   anki        { doc?, ... }        esportazione per Anki
 *   study-reset { id? }              azzera un concetto o tutto
 */
/* global importScripts, WCLibrary, WCStudy */
'use strict';
importScripts('settings.js', 'lang.js', 'text.js', 'analysis.js', 'code.js', 'library.js', 'study.js');

var records = [], edits = null, kb = null, study = null, studyState = null;
function base() {
  if (!kb) kb = WCLibrary.open(records, edits);
  return kb;
}
function learn() {
  if (!study) study = WCStudy.open(studyState || WCStudy.emptyState(), base());
  return study;
}
// il grafo è cambiato: la libreria si riapre e lo studio rilegge i concetti, senza perdere i progressi
function dirty() {
  if (kb) edits = kb.edits();
  if (study) studyState = study.state();
  kb = null;
  study = null;
}

var handlers = {
  process: function (d) { return WCLibrary.buildRecord(d.input, d.settings || {}); },
  load: function (d) { records = Array.isArray(d.records) ? d.records : []; edits = d.edits || null; dirty(); kb = null; return base().stats(); },
  upsert: function (d) {
    dirty();
    var r = d.record;
    var i = records.findIndex(function (x) { return x.id === r.id; });
    if (i >= 0) records[i] = r; else records.push(r);
    return { docs: records.length };
  },
  remove: function (d) {
    dirty();
    records = records.filter(function (x) { return x.id !== d.docId; });
    return { docs: records.length };
  },
  search: function (d) { return base().search(d.query, d.filters || {}); },
  graph: function () { return base().graph(); },
  concept: function (d) { return base().concept(d.cid); },
  edit: function (d) {
    var k = base(), out = k.applyEdit(d.op);
    edits = out.edits;
    if (d.op && d.op.type === 'pos') return { edits: edits };
    if (study) study.invalidate(); // unioni, separazioni e rinomine cambiano i concetti da studiare
    return { edits: edits, graph: k.graph() };
  },
  markdown: function () { return base().markdown(); },
  docs: function () { return base().docs(); },
  stats: function () { return base().stats(); },

  code: function (d) { return base().code(d.op || {}); },
  'code-markdown': function (d) { return base().codeMarkdown({ doc: d.doc }); },
  'study-load': function (d) { studyState = d.state && d.state.cards ? d.state : null; study = null; return learn().stats(); },
  'study-stats': function (d) { return learn().stats({ doc: d.doc }); },
  'study-path': function (d) { return learn().path({ doc: d.doc, limit: d.limit }); },
  session: function (d) { return learn().session({ limit: d.limit, doc: d.doc, ids: d.ids, newCount: d.newCount, newOnly: d.newOnly, anyway: d.anyway }); },
  grade: function (d) {
    var s = learn(), out = s.grade(d.op);
    return { result: out, state: s.state(), stats: s.stats({ doc: d.doc }) };
  },
  mastery: function () { return learn().mastery(); },
  anki: function (d) { return learn().anki({ doc: d.doc, limit: d.limit, onlyStudied: d.onlyStudied }); },
  'study-reset': function (d) {
    var s = learn();
    s.reset({ id: d.id });
    return { state: s.state(), stats: s.stats({ doc: d.doc }) };
  }
};

self.onmessage = function (e) {
  var d = e.data || {};
  var h = handlers[d.type];
  Promise.resolve().then(function () {
    if (!h) throw new Error('richiesta sconosciuta: ' + d.type);
    return h(d);
  }).then(function (result) { self.postMessage({ id: d.id, result: result }); }, function (err) {
    self.postMessage({ id: d.id, error: String(err && err.message || err) });
  });
};
