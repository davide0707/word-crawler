// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: lettura dei file per la libreria (nel browser o nella finestra dell'app).
 * Trasforma un file in parole con la loro posizione, pronte per l'analisi (library.js):
 *  - documenti (Word, OpenDocument, PowerPoint, Excel, EPUB, RTF, HTML, Markdown, testo…): blocchi di formats.js;
 *  - PDF: testo di PDF.js con il riquadro di ogni parola sulla pagina; le pagine senza testo con l'OCR;
 *  - immagini: OCR (Tesseract).
 * Il file non viene modificato: si leggono solo i suoi byte.
 *
 * WCLibImport.create(host) -> { extract(name, bytes, meta, onProgress) -> Promise<input>, terminate() }
 * host: { pdfjs(): Promise<pdfjsLib|null>, ocr?: { script, workerPath, corePath }, settings(): { ocr, ocrLang, language } }
 */
(function (g) {
  'use strict';
  if (g.WCLibImport) return;

  var PDF_PARALLEL = 6;
  function mapLimit(list, n, fn) {
    var out = new Array(list.length), next = 0;
    function worker() {
      if (next >= list.length) return Promise.resolve();
      var i = next++;
      return Promise.resolve(fn(list[i], i)).then(function (v) { out[i] = v; return worker(); });
    }
    var ws = [];
    for (var k = 0; k < Math.min(n, list.length); k++) ws.push(worker());
    return Promise.all(ws).then(function () { return out; });
  }
  function r4(v) { return Math.round(v * 10000) / 10000; }

  // parole di pagine (PDF o OCR) con il riquadro in frazioni della pagina
  function pageTokens(pages) {
    var toks = g.WCPdf.tokens(pages, function () { return [0, 0]; });
    var out = toks.map(function (t) {
      var P = pages[t.page], r = t.rect && t.rect(), box = null;
      if (r && P && P.vp.width && P.vp.height) box = [r4(r.x / P.vp.width), r4(r.y / P.vp.height), r4(r.w / P.vp.width), r4(r.h / P.vp.height)];
      return [t.text, t.gap, t.blk, t.w, t.page, box];
    });
    out.tail = toks.length ? toks[toks.length - 1].tail || '' : '';
    return out;
  }

  function create(host) {
    var ocrEngine = null;
    function settings() { return (host.settings && host.settings()) || {}; }
    function ocrOn() { return !!(host.ocr && settings().ocr !== false); }
    function recognize(src, label, onProgress) {
      if (!ocrEngine) ocrEngine = g.WCOcr.create(host.ocr);
      return ocrEngine.recognize(src, g.WCOcr.langsFor(settings()), function (phase, p) {
        if (onProgress) onProgress(label + ' · ' + phase + (p ? ' ' + Math.round(p * 100) + '%' : ''));
      });
    }

    async function fromPdf(bytes, meta, onProgress) {
      var lib = host.pdfjs ? await host.pdfjs() : null;
      if (!lib) throw new Error('per leggere i PDF serve PDF.js');
      var pdf;
      try { pdf = await lib.getDocument({ data: bytes.slice ? bytes.slice() : bytes, isEvalSupported: false }).promise; }
      catch (e) { throw new Error(/password/i.test(e.message || '') ? 'il PDF è protetto da password' : 'PDF danneggiato o non leggibile'); }
      try {
        var n = pdf.numPages, nums = [], done = 0;
        for (var p = 1; p <= n; p++) nums.push(p);
        var pages = await mapLimit(nums, PDF_PARALLEL, async function (num) {
          var page = await pdf.getPage(num);
          var vp = page.getViewport({ scale: 1 });
          var P = { page: page, vp: vp, base: vp, tc: await page.getTextContent() };
          g.WCPdf.buildLines(P);
          P.tc = null;
          done++;
          if (onProgress && (done % 10 === 0 || done === n)) onProgress('pagine lette: ' + done + ' di ' + n, done / n * 0.6);
          return P;
        });
        var warnings = [], ocrPages = 0;
        var scanned = pages.filter(function (P) { return !P.lines.some(function (l) { return /[\p{L}\p{N}]{2}/u.test(l.str); }); });
        if (scanned.length) {
          if (!ocrOn()) warnings.push(scanned.length + (scanned.length === 1 ? ' pagina è una scansione' : ' pagine sono scansioni') + ' senza testo: serve l’OCR (impostazioni del Lettore).');
          else {
            for (var k = 0; k < scanned.length; k++) {
              var S = scanned[k], label = 'OCR pagina ' + (pages.indexOf(S) + 1) + ' (' + (k + 1) + ' di ' + scanned.length + ')';
              if (onProgress) onProgress(label, 0.6 + 0.35 * k / scanned.length);
              var scale = Math.min(3, 2200 / S.vp.width);
              var v2 = S.page.getViewport({ scale: scale });
              var c = document.createElement('canvas');
              c.width = Math.floor(v2.width); c.height = Math.floor(v2.height);
              var cx = c.getContext('2d');
              cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
              await S.page.render({ canvasContext: cx, canvas: c, viewport: v2 }).promise;
              var res = await recognize(c, label, function (m) { if (onProgress) onProgress(m); });
              S.lines = g.WCOcr.toLines(res.words, S.vp.width / c.width, S.vp.width / c.width, 1);
              S.ocr = true;
              ocrPages++;
              c.width = c.height = 0;
            }
          }
        }
        var title = '';
        try { var m = await pdf.getMetadata(); var t = m && m.info && m.info.Title; if (t && String(t).trim().length > 2) title = String(t).trim(); } catch (e) { /* facoltativo */ }
        var toks = pageTokens(pages);
        pages.forEach(function (P) { try { P.page.cleanup(); } catch (e) { /* niente */ } });
        return { format: 'PDF', title: title, pages: n, ocrPages: ocrPages, warnings: warnings, tokens: toks, tail: toks.tail, pdf: true };
      } finally {
        try { pdf.destroy(); } catch (e) { /* niente */ }
      }
    }

    async function fromImage(bytes, model, onProgress) {
      if (!ocrOn()) throw new Error('per leggere il testo di un’immagine serve l’OCR');
      var bmp = await createImageBitmap(new Blob([bytes], { type: model.mime }));
      var w = bmp.width, h = bmp.height;
      var target = w < 1400 ? Math.min(2, 2000 / w) : (w > 3600 ? 3600 / w : 1);
      var c = document.createElement('canvas');
      c.width = Math.round(w * target); c.height = Math.round(h * target);
      var cx = c.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
      cx.drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      if (onProgress) onProgress('OCR dell’immagine', 0.1);
      var res = await recognize(c, 'OCR', function (m) { if (onProgress) onProgress(m); });
      var P = { vp: { width: w, height: h, scale: 1 }, ocr: true };
      P.lines = g.WCOcr.toLines(res.words, w / c.width, w / c.width, 1);
      c.width = c.height = 0;
      var toks = pageTokens([P]);
      return { format: 'Immagine', title: model.title, pages: 1, ocrPages: 1, warnings: [], tokens: toks, tail: toks.tail, pdf: true };
    }

    async function extract(name, bytes, meta, onProgress) {
      var model = await g.WCFormats.open(bytes, name);
      var out;
      if (model.pdf) out = await fromPdf(bytes, meta, onProgress);
      else if (model.image) out = await fromImage(bytes, model, onProgress);
      else {
        var blocks = model.blocks || [];
        var toks = g.WCText.tokenizeBlocks(blocks.map(function (b) { return { text: b.text, w: b.type === 'h' ? ((b.level || 2) <= 1 ? 3 : 2) : 1 }; }));
        out = {
          format: model.format, title: model.title, warnings: model.warnings || [],
          pages: blocks.some(function (b) { return b.slide; }) ? blocks.reduce(function (m, b) { return Math.max(m, b.slide || 0); }, 0) : null,
          tokens: toks.map(function (t) { return [t.text, t.gap, t.blk, t.w, null]; }),
          blocks: blocks.map(function (b) { var o = { type: b.type }; if (b.level) o.level = b.level; if (b.slide) o.slide = b.slide; return o; })
        };
        if (toks.length) out.tail = toks[toks.length - 1].tail || '';
      }
      out.meta = meta;
      if (!out.title) out.title = String(name).replace(/\.[^.]+$/, '');
      return out;
    }

    return {
      extract: extract,
      terminate: function () { if (ocrEngine) { ocrEngine.terminate(); ocrEngine = null; } }
    };
  }

  g.WCLibImport = { create: create, pageTokens: pageTokens };
})(globalThis);
