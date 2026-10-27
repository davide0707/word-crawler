/*
 * Word Crawler: riconoscimento del testo nelle immagini (OCR) con Tesseract.
 * Serve per i PDF scansionati e per le foto o le immagini di pagine (PNG, JPG, WebP, BMP, GIF).
 *
 * Tesseract (tesseract.js) è un programma di OCR classico: riconosce le lettere, non "capisce" il testo.
 * L'analisi resta quella statistica di sempre.
 *
 * WCOcr.create({ script, workerPath, corePath, langPath? }) -> motore
 *   motore.recognize(immagine o canvas, 'ita+eng', onProgress(fase, 0..1)) -> Promise<{ words, width, height }>
 *   motore.terminate()
 * WCOcr.wordsFromData(data)   parole da qualunque formato di uscita di tesseract.js (v5, v6, v7) o dal TSV
 * WCOcr.toLines(words, sx, sy) righe nel formato di WCPdf (pdfcore.js), così il ragno ci cammina sopra
 *
 * I dati delle lingue (2-4 MB l'una) si scaricano la prima volta da cdn.jsdelivr.net e poi restano
 * nella memoria del browser/app: dalla volta dopo l'OCR funziona anche senza internet.
 */
(function (g) {
  'use strict';
  if (g.WCOcr) return;

  var LANGS = { it: 'ita', en: 'eng', fr: 'fra', es: 'spa', de: 'deu', pt: 'por' };
  var NAMES = { ita: 'italiano', eng: 'inglese', fra: 'francese', spa: 'spagnolo', deu: 'tedesco', por: 'portoghese' };

  // lingua dell'OCR dalle impostazioni ("auto" = italiano + inglese)
  function langsFor(settings) {
    var s = settings || {};
    var pick = s.ocrLang && s.ocrLang !== 'auto' ? s.ocrLang : (s.language && s.language !== 'auto' ? s.language : null);
    if (pick && LANGS[pick]) return pick === 'en' ? 'eng' : LANGS[pick] + '+eng';
    return 'ita+eng';
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (g.Tesseract) { resolve(g.Tesseract); return; }
      if (!g.document) { reject(new Error('Tesseract non disponibile')); return; }
      var s = g.document.createElement('script');
      s.src = src;
      s.onload = function () { if (g.Tesseract) resolve(g.Tesseract); else reject(new Error('Tesseract non disponibile')); };
      s.onerror = function () { reject(new Error('Tesseract non è incluso in questa copia del programma')); };
      (g.document.head || g.document.documentElement).appendChild(s);
    });
  }

  // ---------------------------------------------------------------- parole dal risultato
  function bboxOf(o) {
    var b = o.bbox || o;
    if (b && b.x0 != null) return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
    if (b && b.left != null) return { x0: b.left, y0: b.top, x1: b.left + b.width, y1: b.top + b.height };
    return null;
  }
  function addWord(out, w, line, par) {
    var text = String(w.text || '').trim();
    var bb = bboxOf(w);
    if (!text || !bb || bb.x1 <= bb.x0 || bb.y1 <= bb.y0) return;
    var conf = w.confidence != null ? +w.confidence : (w.conf != null ? +w.conf : 100);
    // parole quasi illeggibili fatte solo di simboli: rumore della scansione
    if (conf < 25 && !/[\p{L}\p{N}]{2}/u.test(text)) return;
    out.push({ text: text, x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1, conf: conf, line: line, par: par });
  }
  /*
   * data: risultato di worker.recognize(...).data
   *   v6/v7: data.blocks[].paragraphs[].lines[].words[]   (con l'uscita { blocks: true })
   *   v5:    data.words[] con .line e .paragraph, oppure data.lines[].words[]
   *   TSV:   stringa (data.tsv o l'uscita del programma "tesseract ... tsv")
   */
  function wordsFromData(data) {
    var out = [], lineId = 0, parId = 0;
    if (!data) return out;
    if (typeof data === 'string') return wordsFromTsv(data);
    if (Array.isArray(data.blocks) && data.blocks.length) {
      data.blocks.forEach(function (b) {
        (b.paragraphs || []).forEach(function (p) {
          parId++;
          (p.lines || []).forEach(function (l) {
            lineId++;
            (l.words || []).forEach(function (w) { addWord(out, w, lineId, parId); });
          });
        });
      });
      return out;
    }
    if (Array.isArray(data.lines) && data.lines.length && data.lines[0].words) {
      var pars = new Map();
      data.lines.forEach(function (l) {
        lineId++;
        var pk = l.paragraph || l;
        if (!pars.has(pk)) pars.set(pk, ++parId);
        l.words.forEach(function (w) { addWord(out, w, lineId, pars.get(pk)); });
      });
      return out;
    }
    if (Array.isArray(data.words) && data.words.length) {
      var lines = new Map(), pmap = new Map();
      data.words.forEach(function (w) {
        var lk = w.line || null, pk = w.paragraph || null;
        if (lk && !lines.has(lk)) lines.set(lk, lines.size + 1);
        if (pk && !pmap.has(pk)) pmap.set(pk, pmap.size + 1);
        addWord(out, w, lk ? lines.get(lk) : 0, pk ? pmap.get(pk) : 0);
      });
      if (!lines.size) groupLines(out);
      return out;
    }
    if (typeof data.tsv === 'string') return wordsFromTsv(data.tsv);
    return out;
  }
  function wordsFromTsv(tsv) {
    var out = [];
    String(tsv).split(/\r?\n/).forEach(function (row, i) {
      var c = row.split('\t');
      if (c.length < 12 || c[0] !== '5' || (i === 0 && c[0] === 'level')) return;
      var key = c[2] + '.' + c[3], lkey = key + '.' + c[4];
      addWord(out, { text: c.slice(11).join('\t'), left: +c[6], top: +c[7], width: +c[8], height: +c[9], conf: +c[10] }, lkey, key);
    });
    // identificativi numerici in ordine di lettura
    var lm = new Map(), pm = new Map();
    out.forEach(function (w) {
      if (!lm.has(w.line)) lm.set(w.line, lm.size + 1);
      if (!pm.has(w.par)) pm.set(w.par, pm.size + 1);
      w.line = lm.get(w.line); w.par = pm.get(w.par);
    });
    return out;
  }
  // parole senza righe: si raggruppano per sovrapposizione verticale
  function groupLines(words) {
    var sorted = words.slice().sort(function (a, b) { return a.y0 - b.y0 || a.x0 - b.x0; });
    var id = 0, cur = null;
    sorted.forEach(function (w) {
      var mid = (w.y0 + w.y1) / 2;
      if (!cur || mid > cur.y1 || mid < cur.y0) { id++; cur = { y0: w.y0, y1: w.y1 }; }
      w.line = id; w.par = 1;
    });
    words.sort(function (a, b) { return a.line - b.line || a.x0 - b.x0; });
  }

  /*
   * Righe nel formato di WCPdf.buildLines, con le coordinate della pagina mostrata.
   * sx, sy: da pixel dell'immagine a pixel della pagina; scale: scala del viewport (per le dimensioni relative)
   */
  var mctx = null;
  function measure(text) {
    if (!mctx) mctx = g.document ? g.document.createElement('canvas').getContext('2d') : null;
    if (!mctx) return text.length * 50;
    mctx.font = '100px sans-serif';
    return mctx.measureText(text).width || 1;
  }
  function toLines(words, sx, sy, scale) {
    var byLine = new Map(), order = [];
    words.forEach(function (w) {
      if (!byLine.has(w.line)) { byLine.set(w.line, []); order.push(w.line); }
      byLine.get(w.line).push(w);
    });
    var lines = [], lastPar = null;
    order.forEach(function (id) {
      var ws = byLine.get(id).sort(function (a, b) { return a.x0 - b.x0; });
      var str = '', map = [], maxFh = 0, base = null, x0 = null;
      ws.forEach(function (w, k) {
        if (k) { str += ' '; map.push(null); }
        var fh = (w.y1 - w.y0) * sy, wx = w.x0 * sx, ww = (w.x1 - w.x0) * sx;
        var info = { str: w.text, x: wx, base: w.y0 * sy + fh * 0.84, fh: fh, k: ww / measure(w.text), fam: 'sans-serif' };
        for (var j = 0; j < w.text.length; j++) map.push([info, j]);
        str += w.text;
        if (fh > maxFh) maxFh = fh;
        if (base === null || info.base > base) base = info.base;
        if (x0 === null) x0 = wx;
      });
      var par = ws[0].par;
      lines.push({ str: str, map: map, fh: maxFh / (scale || 1), fhPx: maxFh, base: base, x0: x0, newBlock: lastPar !== null && par !== lastPar, ocr: true });
      lastPar = par;
    });
    return lines;
  }

  // ---------------------------------------------------------------- motore
  function create(paths) {
    var p = paths || {};
    var worker = null, current = null, busy = Promise.resolve(), onProg = null;
    function logger(m) {
      if (!onProg || !m) return;
      var st = String(m.status || '');
      var phase = /recogniz/.test(st) ? 'Riconosco il testo' : (/load.*lang|traineddata|download/.test(st) ? 'Scarico i dati della lingua (solo la prima volta)' :
        (/initializ|load.*core|loading tesseract/.test(st) ? 'Preparo Tesseract' : 'OCR'));
      onProg(phase, typeof m.progress === 'number' ? m.progress : 0);
    }
    function ensure(langs) {
      return loadScript(p.script).then(function (T) {
        if (worker && current === langs) return worker;
        if (worker) return worker.reinitialize(langs, 1).then(function () { current = langs; return worker; });
        var opts = { logger: logger, workerBlobURL: false, errorHandler: function () {} };
        if (p.workerPath) opts.workerPath = p.workerPath;
        if (p.corePath) opts.corePath = p.corePath;
        if (p.langPath) opts.langPath = p.langPath;
        return T.createWorker(langs, 1, opts).then(function (w) { worker = w; current = langs; return w; });
      });
    }
    function recognize(image, langs, onProgress) {
      var job = busy.then(function () {
        onProg = onProgress || null;
        return ensure(langs || 'ita+eng');
      }).then(function (w) {
        return w.recognize(image, {}, { blocks: true, text: false });
      }).then(function (r) {
        var data = r && r.data ? r.data : r;
        return { words: wordsFromData(data), width: image.width || image.naturalWidth || 0, height: image.height || image.naturalHeight || 0 };
      });
      busy = job.catch(function () {});
      return job;
    }
    return {
      recognize: recognize,
      terminate: function () { if (worker) { try { worker.terminate(); } catch (e) { /* già chiuso */ } } worker = null; current = null; }
    };
  }

  g.WCOcr = { LANGS: LANGS, NAMES: NAMES, langsFor: langsFor, create: create, wordsFromData: wordsFromData, wordsFromTsv: wordsFromTsv, toLines: toLines };
})(globalThis);
