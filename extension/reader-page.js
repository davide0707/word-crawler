// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/* Word Crawler (estensione): lettore di documenti (PDF, Word, OpenDocument, EPUB…) in una scheda. */
(function () {
  'use strict';
  var pdfLib = null;
  function loadPdfJs() {
    if (pdfLib) return Promise.resolve(pdfLib);
    var tries = [['lib/pdf.min.mjs', 'lib/pdf.worker.min.mjs'], ['lib/pdf.mjs', 'lib/pdf.worker.mjs']];
    return tries.reduce(function (p, pair) {
      return p.then(function (m) {
        if (m) return m;
        return import('./' + pair[0]).then(function (lib) {
          lib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(pair[1]);
          return lib;
        }).catch(function () { return null; });
      });
    }, Promise.resolve(null)).then(function (m) { pdfLib = m; return m; });
  }

  // Tesseract (OCR) è incluso nelle copie create con "npm run build:extension" o da GitHub
  var OCR = {
    script: chrome.runtime.getURL('lib/tesseract/tesseract.min.js'),
    workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('lib/tesseract/core/')
  };
  var reader = WCReader.mount(document.getElementById('reader'), {
    saveFile: function (name, content, mime) { return WCStore.download(name, content, mime); },
    printPdf: function (html) { return WCStore.printPdf(html); },
    ocr: OCR,
    ocrHelp: 'Per l’OCR serve Tesseract, che non è incluso in questa copia dell’estensione: creala con “npm install” e “npm run build:extension”, oppure scaricala da GitHub (Releases).',
    archive: { save: function (e) { return WCStore.save(e); } },
    settings: { load: WCStore.loadSettings, save: WCStore.saveSettings },
    fetchUrl: function (url) {
      return fetch(url, { credentials: 'include' }).then(function (r) {
        if (!r.ok) throw new Error('il sito ha risposto con errore ' + r.status);
        var type = r.headers.get('content-type') || '';
        if (/pdf/i.test(type)) return r.arrayBuffer().then(function (b) { return { pdf: true, bytes: new Uint8Array(b), url: r.url, name: decodeURIComponent(new URL(r.url).pathname.split('/').pop() || 'documento.pdf') }; });
        return r.text().then(function (html) { return { html: html, url: r.url }; });
      });
    },
    pdfjs: loadPdfJs,
    pdfHelp: 'Per leggere i PDF serve PDF.js, che non è incluso in questa copia dell’estensione. Scarica pdfjs-…-dist.zip da github.com/mozilla/pdf.js/releases, copia build/pdf.mjs e build/pdf.worker.mjs nella cartella “lib” dell’estensione e ricaricala da chrome://extensions. (Le copie create con “npm run build:extension” o da GitHub lo contengono già.)'
  });

  // documento passato dall'icona o dal menu: reader.html?file=<indirizzo>
  var file = new URLSearchParams(location.search).get('file');
  if (file) {
    var name = decodeURIComponent(file.split('/').pop().split(/[?#]/)[0] || 'documento');
    var get = /^file:/i.test(file)
      ? new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest();
        x.open('GET', file); x.responseType = 'arraybuffer';
        x.onload = function () { if (x.response) resolve(x.response); else reject(new Error('vuoto')); };
        x.onerror = function () { reject(new Error('Per aprire i file dal computer: in chrome://extensions, “Dettagli” di Word Crawler, attiva “Consenti l’accesso agli URL dei file”, oppure trascina il file qui.')); };
        x.send();
      })
      : fetch(file, { credentials: 'include' }).then(function (r) { if (!r.ok) throw new Error('errore ' + r.status); return r.arrayBuffer(); });
    get.then(function (b) { reader.openBytes(name, new Uint8Array(b), file); })
      .catch(function (e) { reader.openText('Non sono riuscito a scaricare ' + file + '. ' + e.message + ' Puoi salvarlo sul computer e trascinarlo in questa pagina.', 'Documento non raggiungibile'); });
  }
})();
