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
 */
/* global importScripts, WCLibrary */
'use strict';
importScripts('settings.js', 'lang.js', 'text.js', 'analysis.js', 'library.js');

var records = [], edits = null, kb = null;
function base() {
  if (!kb) kb = WCLibrary.open(records, edits);
  return kb;
}
function dirty() { if (kb) edits = kb.edits(); kb = null; }

var handlers = {
  process: function (d) { return WCLibrary.buildRecord(d.input, d.settings || {}); },
  load: function (d) { records = Array.isArray(d.records) ? d.records : []; edits = d.edits || null; kb = null; return base().stats(); },
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
    return d.op && d.op.type === 'pos' ? { edits: edits } : { edits: edits, graph: k.graph() };
  },
  markdown: function () { return base().markdown(); },
  docs: function () { return base().docs(); },
  stats: function () { return base().stats(); }
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
