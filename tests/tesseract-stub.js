/*
 * Finto tesseract.js per i test nel browser. Risponde con l'uscita VERA del programma tesseract
 * (tests/fixtures/scan-N.tsv, creata da make-ocr-fixtures.py), convertita nel formato "blocks"
 * di tesseract.js 7 e riportata alla grandezza dell'immagine che riceve.
 * Così si prova tutto il percorso (immagine -> parole -> righe -> token -> ragno) senza scaricare niente.
 */
(function () {
  'use strict';
  var calls = 0;
  window.__ocrCalls = [];
  function toBlocks(tsv, sx, sy) {
    var blocks = new Map();
    tsv.split('\n').forEach(function (row) {
      var c = row.split('\t');
      if (c[0] !== '5' || c.length < 12 || !c[11].trim()) return;
      var b = blocks.get(c[2]); if (!b) { b = { paragraphs: new Map() }; blocks.set(c[2], b); }
      var p = b.paragraphs.get(c[3]); if (!p) { p = { lines: new Map() }; b.paragraphs.set(c[3], p); }
      var l = p.lines.get(c[4]); if (!l) { l = { words: [] }; p.lines.set(c[4], l); }
      var x = +c[6], y = +c[7], w = +c[8], h = +c[9];
      l.words.push({ text: c[11], confidence: +c[10], bbox: { x0: x * sx, y0: y * sy, x1: (x + w) * sx, y1: (y + h) * sy } });
    });
    return Array.from(blocks.values()).map(function (b) {
      return { paragraphs: Array.from(b.paragraphs.values()).map(function (p) { return { lines: Array.from(p.lines.values()) }; }) };
    });
  }
  window.Tesseract = {
    createWorker: function (langs, oem, opts) {
      window.__ocrCreate = { langs: langs, oem: oem, workerPath: opts.workerPath, corePath: opts.corePath, workerBlobURL: opts.workerBlobURL };
      return Promise.resolve({
        reinitialize: function (l) { window.__ocrCreate.langs = l; return Promise.resolve(); },
        terminate: function () { return Promise.resolve(); },
        recognize: function (image, options, output) {
          var n = ++calls;
          var w = image.width || image.naturalWidth, h = image.height || image.naturalHeight;
          window.__ocrCalls.push({ n: n, w: w, h: h, output: output });
          if (opts.logger) opts.logger({ status: 'recognizing text', progress: 0.5 });
          return fetch('/tests/fixtures/scan-' + (((n - 1) % 2) + 1) + '.tsv').then(function (r) { return r.text(); }).then(function (tsv) {
            var page = tsv.split('\n')[1].split('\t');
            return { data: { blocks: toBlocks(tsv, w / +page[8], h / +page[9]) } };
          });
        }
      });
    }
  };
})();
