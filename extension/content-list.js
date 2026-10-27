// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/* Word Crawler (estensione): file del motore da iniettare nelle pagine web (usato da pannello e servizio). */
(function (g) {
  'use strict';
  g.WC_CONTENT = ['core/settings.js', 'core/lang.js', 'core/text.js', 'core/analysis.js', 'core/dom.js', 'core/crawler.js', 'core/annotate.js', 'core/pen.js', 'content.js'];
  // indirizzo normalizzato di una pagina: senza #ancora, senza parametri di tracciamento
  g.WC_URLKEY = function (u) {
    try {
      var x = new URL(u);
      x.hash = '';
      Array.from(x.searchParams.keys()).forEach(function (k) { if (/^(utm_|fbclid$|gclid$|mc_|ref$)/i.test(k)) x.searchParams.delete(k); });
      return x.origin + x.pathname.replace(/\/+$/, '') + (x.searchParams.toString() ? '?' + x.searchParams.toString() : '');
    } catch (e) { return String(u || ''); }
  };
})(globalThis);
