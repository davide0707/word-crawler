/* Word Crawler (estensione): mostra il documento segnato e apre la finestra di stampa (per salvarlo in PDF). */
(function () {
  'use strict';
  var frame = document.getElementById('doc');
  chrome.storage.local.get('wcPrint').then(function (r) {
    var html = r.wcPrint || '<p>Niente da stampare.</p>';
    chrome.storage.local.remove('wcPrint');
    frame.srcdoc = html;
    frame.addEventListener('load', function () {
      try { document.title = (frame.contentDocument.title || 'Documento') + ' · stampa'; } catch (e) { /* titolo facoltativo */ }
      setTimeout(function () { frame.contentWindow.focus(); frame.contentWindow.print(); }, 300);
    }, { once: true });
  });
  document.getElementById('print').addEventListener('click', function () { frame.contentWindow.focus(); frame.contentWindow.print(); });
})();
