// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: scrivere le annotazioni dentro il PDF originale.
 *
 * Finora l'app sapeva stampare un PDF nuovo con i segni disegnati sopra. Qui invece si aggiungono
 * annotazioni vere dentro una copia del file di partenza: evidenziazioni, sottolineature, riquadri e
 * note gialle che Acrobat, Anteprima, Firefox e chiunque altro legge, sposta e cancella.
 *
 * Come: con un "aggiornamento incrementale", che è il modo previsto dal formato PDF per cambiare un
 * documento senza riscriverlo. Il file originale resta identico, byte per byte, e in fondo si
 * aggiunge: gli oggetti nuovi (le annotazioni), una copia delle pagine toccate con l'elenco
 * /Annots allungato, una tabella xref che punta ai nuovi oggetti e un trailer con /Prev che rimanda
 * alla tabella di prima. Chi apre il file vede l'ultima versione; chi vuole può tornare indietro.
 *
 * Limiti, dichiarati invece che nascosti: funziona sui PDF in cui le pagine sono oggetti normali
 * ("12 0 obj << /Type /Page … >>"). Nei PDF che tengono le pagine dentro flussi compressi, o nei PDF
 * cifrati, non si può aggiungere niente senza riscrivere tutto: in quel caso si solleva un errore
 * chiaro e l'app ripiega sulla stampa di un PDF nuovo.
 *
 * WCPdfWrite.can(bytes) -> { ok, pages, reason }
 * WCPdfWrite.annotate(bytes, annots, opts) -> Uint8Array
 *   annots: [{ page, type: 'highlight'|'underline'|'strike'|'box'|'note', quads|rect, color, contents, author, date }]
 *     quads: [[x1,y1,x2,y2,x3,y3,x4,y4], ...] in punti PDF (origine in basso a sinistra)
 *     rect:  [x0,y0,x1,y1] in punti PDF, usato da 'box' e 'note'
 */
(function (g) {
  'use strict';
  if (g.WCPdfWrite) return;

  function bin(bytes) {
    // i byte come stringa latin1: le posizioni restano uguali, e si può usare un'espressione regolare
    var out = '', n = bytes.length;
    for (var i = 0; i < n; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(n, i + 8192)));
    return out;
  }
  // testo PDF in UTF-16BE con il marcatore: così accenti ed emoji sopravvivono
  function text(s) {
    var out = '\\376\\377';
    var str = String(s == null ? '' : s).slice(0, 4000);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      out += '\\' + ((c >> 8) & 0xff).toString(8).padStart(3, '0') + '\\' + (c & 0xff).toString(8).padStart(3, '0');
    }
    return '(' + out + ')';
  }
  function num(x) { return (Math.round(x * 100) / 100).toString(); }
  function rgb(c) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(c || '#ffd43b'));
    if (!m) return [1, 0.83, 0.23];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  }
  function pdfDate(d) {
    var t = d ? new Date(d) : new Date();
    function p(x) { return String(x).padStart(2, '0'); }
    return "(D:" + t.getUTCFullYear() + p(t.getUTCMonth() + 1) + p(t.getUTCDate()) + p(t.getUTCHours()) + p(t.getUTCMinutes()) + p(t.getUTCSeconds()) + "Z)";
  }

  /*
   * Gli oggetti del file: si cercano le intestazioni "N G obj" e si prende il testo fino a "endobj".
   * Non è un lettore di PDF completo, e non serve che lo sia: basta trovare le pagine e il catalogo.
   */
  function scan(s) {
    var objs = new Map(), re = /(?:^|[\s>\]])(\d{1,7})\s+(\d{1,5})\s+obj\b/g, m;
    while ((m = re.exec(s))) {
      var at = m.index + m[0].length - (m[0].length - m[0].indexOf(m[1]));
      var start = s.indexOf('obj', at) + 3;
      var end = s.indexOf('endobj', start);
      if (end < 0) continue;
      var id = +m[1];
      // se un oggetto compare più volte (aggiornamenti incrementali) vale l'ultimo
      objs.set(id, { id: id, gen: +m[2], at: m.index + m[0].indexOf(m[1]), body: s.slice(start, end) });
    }
    return objs;
  }
  function refsIn(body, key) {
    var m = new RegExp('\\/' + key + '\\s*(\\[[^\\]]*\\]|\\d+\\s+\\d+\\s+R)').exec(body);
    if (!m) return null;
    return m[1];
  }
  function parseRefs(v) {
    var out = [], re = /(\d+)\s+(\d+)\s+R/g, m;
    while ((m = re.exec(v || ''))) out.push(+m[1]);
    return out;
  }

  /* Le pagine, in ordine, seguendo l'albero /Pages. */
  function pagesOf(objs, s) {
    var root = null;
    var tr = /trailer[\s\S]{0,2000}?\/Root\s+(\d+)\s+\d+\s+R/.exec(s);
    if (tr) root = +tr[1];
    if (root == null) {
      objs.forEach(function (o) { if (root == null && /\/Type\s*\/Catalog/.test(o.body)) root = o.id; });
    }
    var pagesId = null;
    if (root != null && objs.has(root)) {
      var k = refsIn(objs.get(root).body, 'Pages');
      pagesId = k ? parseRefs(k)[0] : null;
    }
    var out = [], seen = new Set();
    function walk(id, depth) {
      if (id == null || seen.has(id) || depth > 60 || !objs.has(id)) return;
      seen.add(id);
      var o = objs.get(id);
      if (/\/Type\s*\/Page[^s]/.test(o.body) || (/\/Contents/.test(o.body) && !/\/Kids/.test(o.body))) { out.push(o); return; }
      var kids = refsIn(o.body, 'Kids');
      parseRefs(kids).forEach(function (k2) { walk(k2, depth + 1); });
    }
    walk(pagesId, 0);
    if (!out.length) {
      // nessun albero leggibile: si prendono gli oggetti che sono chiaramente pagine
      var list = [];
      objs.forEach(function (o) { if (/\/Type\s*\/Page[^s]/.test(o.body)) list.push(o); });
      list.sort(function (a, b) { return a.id - b.id; });
      out = list;
    }
    return out;
  }

  function can(bytes) {
    var s = bin(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    if (s.slice(0, 5) !== '%PDF-') return { ok: false, pages: 0, reason: 'Non è un PDF.' };
    if (/\/Encrypt\s/.test(s)) return { ok: false, pages: 0, reason: 'Il PDF è protetto: non posso scriverci dentro.' };
    var objs = scan(s);
    var pages = pagesOf(objs, s);
    if (!pages.length) return { ok: false, pages: 0, reason: 'Le pagine di questo PDF sono dentro flussi compressi: non posso aggiungere annotazioni senza riscriverlo.' };
    return { ok: true, pages: pages.length, reason: '' };
  }

  var SUB = { highlight: 'Highlight', underline: 'Underline', strike: 'StrikeOut', box: 'Square', note: 'Text' };

  function annotate(bytes, annots, opts) {
    var src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var s = bin(src), o = opts || {};
    var chk = can(src);
    if (!chk.ok) throw new Error(chk.reason);
    var objs = scan(s);
    var pages = pagesOf(objs, s);
    var list = (annots || []).filter(function (a) { return a && a.page >= 0 && a.page < pages.length; });
    if (!list.length) throw new Error('Nessuna annotazione da scrivere.');

    // il primo identificativo libero
    var maxId = 0;
    objs.forEach(function (x) { if (x.id > maxId) maxId = x.id; });
    var trSize = /\/Size\s+(\d+)/.exec(s.slice(s.lastIndexOf('trailer') >= 0 ? s.lastIndexOf('trailer') : 0));
    if (trSize && +trSize[1] - 1 > maxId) maxId = +trSize[1] - 1;
    var next = maxId + 1;

    var byPage = new Map();
    list.forEach(function (a) {
      if (!byPage.has(a.page)) byPage.set(a.page, []);
      byPage.get(a.page).push(a);
    });

    var newObjs = []; // { id, body }
    byPage.forEach(function (as, pi) {
      var page = pages[pi];
      var ids = [];
      as.forEach(function (a) {
        var sub = SUB[a.type] || 'Highlight';
        var col = rgb(a.color);
        var quads = a.quads && a.quads.length ? a.quads : null;
        var rect = a.rect;
        if (!rect && quads) {
          var xs = [], ys = [];
          quads.forEach(function (q) { for (var i = 0; i < 8; i += 2) { xs.push(q[i]); ys.push(q[i + 1]); } });
          rect = [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
        }
        if (!rect) return;
        var d = ['<<', '/Type /Annot', '/Subtype /' + sub,
          '/Rect [' + rect.map(num).join(' ') + ']',
          '/C [' + col.map(num).join(' ') + ']',
          '/F 4', // stampabile
          '/CA ' + num(a.opacity == null ? (sub === 'Highlight' ? 0.45 : 1) : a.opacity),
          '/T ' + text(a.author || o.author || 'Word Crawler'),
          '/M ' + pdfDate(a.date),
          '/NM ' + text('wc-' + next + '-' + pi)];
        if (a.contents) d.push('/Contents ' + text(a.contents));
        if (quads && (sub === 'Highlight' || sub === 'Underline' || sub === 'StrikeOut')) {
          d.push('/QuadPoints [' + quads.map(function (q) { return q.map(num).join(' '); }).join(' ') + ']');
        }
        if (sub === 'Square') d.push('/IC []', '/BS << /W 1.5 /S /S >>');
        if (sub === 'Text') d.push('/Name /Comment', '/Open false');
        d.push('>>');
        newObjs.push({ id: next, body: '\n' + d.join('\n') + '\n' });
        ids.push(next);
        next++;
      });
      if (!ids.length) return;
      // la pagina riscritta: stesso contenuto, /Annots allungato
      var body = page.body;
      var have = refsIn(body, 'Annots');
      var refs = ids.map(function (i2) { return i2 + ' 0 R'; }).join(' ');
      if (have && have[0] === '[') {
        body = body.replace(have, have.replace(/\]\s*$/, ' ' + refs + ']'));
      } else if (have) {
        // /Annots punta a un array in un altro oggetto: si lascia stare e si scrive un array nuovo
        body = body.replace(/\/Annots\s*\d+\s+\d+\s+R/, '/Annots [' + refs + ']');
      } else {
        body = body.replace(/<<([\s\S]*)>>\s*$/, function (m2, inner) { return '<<' + inner + '\n/Annots [' + refs + ']\n>>'; });
      }
      newObjs.push({ id: page.id, body: body, gen: page.gen || 0 });
    });

    // la coda: oggetti nuovi, tabella xref, trailer con /Prev
    var tail = '';
    var base = src.length;
    if (src[src.length - 1] !== 10 && src[src.length - 1] !== 13) tail += '\n';
    var offsets = [];
    newObjs.forEach(function (x) {
      offsets.push({ id: x.id, off: base + tail.length });
      tail += x.id + ' ' + (x.gen || 0) + ' obj' + x.body + 'endobj\n';
    });
    var xrefAt = base + tail.length;
    offsets.sort(function (a, b) { return a.id - b.id; });
    // una sezione per ogni gruppo di identificativi consecutivi
    var groups = [];
    offsets.forEach(function (x) {
      var last = groups[groups.length - 1];
      if (last && x.id === last.from + last.items.length) last.items.push(x);
      else groups.push({ from: x.id, items: [x] });
    });
    tail += 'xref\n';
    groups.forEach(function (gr) {
      tail += gr.from + ' ' + gr.items.length + '\n';
      gr.items.forEach(function (x) { tail += String(x.off).padStart(10, '0') + ' 00000 n \n'; });
    });
    var prev = s.lastIndexOf('startxref');
    var prevOff = 0;
    if (prev >= 0) {
      var pm = /startxref\s+(\d+)/.exec(s.slice(prev, prev + 60));
      if (pm) prevOff = +pm[1];
    }
    var rootRef = /\/Root\s+(\d+\s+\d+\s+R)/.exec(s.slice(s.lastIndexOf('/Root') >= 0 ? s.lastIndexOf('/Root') - 0 : 0));
    var rootTxt = rootRef ? rootRef[1] : null;
    if (!rootTxt) {
      var cat = null;
      objs.forEach(function (x) { if (cat == null && /\/Type\s*\/Catalog/.test(x.body)) cat = x.id; });
      if (cat == null) throw new Error('Non trovo il catalogo del PDF.');
      rootTxt = cat + ' 0 R';
    }
    var idm = /\/ID\s*\[\s*<([0-9a-fA-F]*)>\s*<([0-9a-fA-F]*)>\s*\]/.exec(s);
    tail += 'trailer\n<<\n/Size ' + next + '\n/Root ' + rootTxt + '\n/Prev ' + prevOff + '\n';
    if (idm) tail += '/ID [<' + idm[1] + '> <' + idm[2] + '>]\n';
    tail += '>>\nstartxref\n' + xrefAt + '\n%%EOF\n';

    var add = new Uint8Array(tail.length);
    for (var i = 0; i < tail.length; i++) add[i] = tail.charCodeAt(i) & 0xff;
    var out = new Uint8Array(src.length + add.length);
    out.set(src, 0);
    out.set(add, src.length);
    return out;
  }

  /*
   * Da riquadro in frazioni di pagina (quello che usa il lettore: origine in alto a sinistra) a
   * quadrilatero in punti PDF (origine in basso a sinistra).
   */
  function quadOf(box, pageW, pageH) {
    var x0 = box[0] * pageW, y1 = (1 - box[1]) * pageH;
    var x1 = (box[0] + box[2]) * pageW, y0 = (1 - box[1] - box[3]) * pageH;
    return [x0, y1, x1, y1, x0, y0, x1, y0];
  }

  g.WCPdfWrite = { can: can, annotate: annotate, quadOf: quadOf, SUB: SUB };
})(globalThis);
