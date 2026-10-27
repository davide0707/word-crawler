// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: apertura dei documenti.
 * Converte ogni formato in un modello comune:
 *   { format, title, blocks: [{ type: 'h'|'p'|'li'|'quote'|'row'|'pre'|'note', level?, text, runs? }], warnings: [] }
 * runs (facoltativo): [{ t: testo, b: grassetto, i: corsivo }]
 *
 * Formati: PDF (a parte, con PDF.js), DOCX/DOCM/DOTX, DOC (Word 97-2003), ODT/ODP/ODS, PPTX, XLSX,
 * EPUB, RTF, HTML/XHTML, Markdown, TXT, SRT/VTT (sottotitoli), CSV/TSV,
 * immagini (PNG, JPG, WebP, BMP, GIF: a parte, con l'OCR di Tesseract).
 * Tutto in sola lettura, nel browser, senza inviare nulla a nessuno.
 */
(function (g) {
  'use strict';
  if (g.WCFormats) return;

  var MAX_BLOCKS = 200000;

  function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function clean(s) { return String(s || '').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim(); }
  function xml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML danneggiato');
    return doc;
  }
  function kids(el) { return el ? Array.prototype.slice.call(el.children || []) : []; }
  function ln(el) { return el.localName; }
  function first(el, name) {
    if (!el) return null;
    var all = el.getElementsByTagNameNS('*', name);
    return all.length ? all[0] : null;
  }
  function all(el, name) { return el ? Array.prototype.slice.call(el.getElementsByTagNameNS('*', name)) : []; }
  function attr(el, name) {
    if (!el || !el.attributes) return null;
    for (var i = 0; i < el.attributes.length; i++) if (el.attributes[i].localName === name) return el.attributes[i].value;
    return null;
  }
  function decodeText(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
  }
  function push(model, b) {
    if (model.blocks.length >= MAX_BLOCKS) return;
    if (b.runs) {
      b.runs = mergeRuns(b.runs);
      b.text = b.runs.map(function (r) { return r.t; }).join('');
    }
    b.text = clean(b.text);
    if (!b.text) return;
    if (b.runs && !b.runs.some(function (r) { return r.b || r.i; })) delete b.runs;
    model.blocks.push(b);
  }
  function mergeRuns(runs) {
    var out = [];
    runs.forEach(function (r) {
      if (!r.t) return;
      var last = out[out.length - 1];
      if (last && !!last.b === !!r.b && !!last.i === !!r.i) last.t += r.t;
      else out.push({ t: r.t, b: !!r.b, i: !!r.i });
    });
    return out;
  }
  function newModel(format, title) { return { format: format, title: title || '', blocks: [], warnings: [] }; }

  // Euristica per i titoli nei formati senza stili (TXT, DOC): riga corta, senza punto finale
  function guessHeadings(model) {
    var b = model.blocks;
    for (var i = 0; i < b.length; i++) {
      var x = b[i];
      if (x.type !== 'p') continue;
      var next = b[i + 1];
      var short = x.text.length <= 80 && !/[.!?:;,]$/.test(x.text) && x.text.split(' ').length <= 12;
      if (short && next && next.type === 'p' && next.text.length > x.text.length * 1.5 && /^\p{Lu}|^\d/u.test(x.text)) {
        x.type = 'h';
        x.level = i === 0 ? 1 : 2;
      }
    }
    if (!model.title && b[0] && b[0].type === 'h') model.title = b[0].text;
  }

  // ------------------------------------------------------------------ testo semplice
  function fromPlain(text, format) {
    var model = newModel(format || 'TXT');
    text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).forEach(function (para) {
      var lines = para.split('\n');
      // righe molto corte e numerose (elenchi, poesie) restano separate
      var shortLines = lines.length > 1 && lines.every(function (l) { return l.trim().length < 60; });
      if (shortLines) lines.forEach(function (l) { push(model, { type: 'p', text: l }); });
      else push(model, { type: 'p', text: para });
    });
    guessHeadings(model);
    return model;
  }

  function fromMarkdown(text) {
    var model = newModel('Markdown');
    var lines = text.replace(/\r\n?/g, '\n').split('\n');
    var para = [], inCode = false, code = [];
    function inline(s) {
      return s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1').replace(/<[^>]+>/g, '');
    }
    function runs(s) {
      // **grassetto**, __grassetto__, *corsivo*, _corsivo_
      var out = [], re = /(\*\*|__)(.+?)\1|(\*|_)([^*_]+?)\3/g, last = 0, m;
      s = inline(s);
      while ((m = re.exec(s))) {
        if (m.index > last) out.push({ t: s.slice(last, m.index) });
        if (m[2] !== undefined) out.push({ t: m[2], b: true }); else out.push({ t: m[4], i: true });
        last = m.index + m[0].length;
      }
      if (last < s.length) out.push({ t: s.slice(last) });
      return out;
    }
    function flush() { if (para.length) { push(model, { type: 'p', runs: runs(para.join(' ')) }); para = []; } }
    lines.forEach(function (line) {
      if (/^\s*(```|~~~)/.test(line)) {
        if (inCode) { push(model, { type: 'pre', text: code.join('\n') }); code = []; }
        else flush();
        inCode = !inCode;
        return;
      }
      if (inCode) { code.push(line); return; }
      var h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) { flush(); push(model, { type: 'h', level: Math.min(3, h[1].length), runs: runs(h[2]) }); return; }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) { flush(); push(model, { type: 'li', runs: runs(line.replace(/^\s*([-*+]|\d+[.)])\s+/, '')) }); return; }
      if (/^\s*>/.test(line)) { flush(); push(model, { type: 'quote', runs: runs(line.replace(/^\s*>\s?/, '')) }); return; }
      if (/^\s*\|.*\|\s*$/.test(line)) {
        flush();
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return;
        push(model, { type: 'row', text: line.trim().replace(/^\||\|$/g, '').split('|').map(clean).filter(Boolean).join(' · ') });
        return;
      }
      if (/^\s*$/.test(line) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); return; }
      if (/^\s*(=+|-+)\s*$/.test(line) && para.length) { var t = para.pop(); flush(); push(model, { type: 'h', level: /=/.test(line) ? 1 : 2, text: t }); return; }
      para.push(line.trim());
    });
    flush();
    var h1 = model.blocks.find(function (b) { return b.type === 'h'; });
    model.title = h1 ? h1.text : '';
    return model;
  }

  function fromSubtitles(text, format) {
    var model = newModel(format);
    var cues = text.replace(/\r\n?/g, '\n').replace(/^WEBVTT[^\n]*\n/, '').split(/\n\s*\n/);
    var para = [], lastEnd = null;
    function toSec(ts) { var m = /(\d+):(\d+):(\d+)[,.](\d+)|(\d+):(\d+)[,.](\d+)/.exec(ts); if (!m) return null; return m[1] !== undefined ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : (+m[5]) * 60 + (+m[6]) + (+m[7]) / 1000; }
    cues.forEach(function (cue) {
      var lines = cue.split('\n').filter(function (l) { return l.trim(); });
      var timeIdx = lines.findIndex(function (l) { return /-->/.test(l); });
      if (timeIdx < 0) return;
      var times = lines[timeIdx].split('-->');
      var start = toSec(times[0]), end = toSec(times[1]);
      var txt = lines.slice(timeIdx + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '');
      if (lastEnd !== null && start !== null && start - lastEnd > 2.5 && para.length) { push(model, { type: 'p', text: para.join(' ') }); para = []; }
      para.push(txt);
      lastEnd = end;
    });
    if (para.length) push(model, { type: 'p', text: para.join(' ') });
    return model;
  }

  function fromDelimited(text) {
    var model = newModel('CSV');
    var lines = text.replace(/\r\n?/g, '\n').split('\n').filter(function (l) { return l.trim(); });
    var sep = [';', '\t', ',', '|'].sort(function (a, b) { return (lines[0].split(b).length) - (lines[0].split(a).length); })[0];
    lines.slice(0, 20000).forEach(function (l, i) {
      var cells = splitCsv(l, sep).map(clean).filter(Boolean);
      push(model, { type: i === 0 ? 'h' : 'row', level: 3, text: cells.join(' · ') });
    });
    if (lines.length > 20000) model.warnings.push('Lette solo le prime 20.000 righe.');
    return model;
  }
  function splitCsv(line, sep) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  // ------------------------------------------------------------------ HTML
  var HTML_SKIP = 'script,style,noscript,template,svg,canvas,iframe,object,embed,nav,aside,footer,form,button,select,textarea,input,header[role="banner"],[aria-hidden="true"],[hidden]';
  function pickHtmlRoot(doc) {
    var body = doc.body || doc.documentElement;
    var cands = Array.prototype.slice.call(body.querySelectorAll('article, main, [role="main"], #mw-content-text, .mw-parser-output, #content, .content, .post, .post-content, .entry-content, .article-body, .story-body'));
    var best = null, bestLen = 0;
    cands.forEach(function (el) { var l = (el.textContent || '').length; if (l > bestLen) { best = el; bestLen = l; } });
    if (best && bestLen > 400) return best;
    var counts = new Map();
    Array.prototype.forEach.call(body.querySelectorAll('p'), function (p) {
      var par = p.parentElement;
      if (par) counts.set(par, (counts.get(par) || 0) + (p.textContent || '').length);
    });
    var b2 = null, bl = 0;
    counts.forEach(function (v, k) { if (v > bl) { bl = v; b2 = k; } });
    return b2 && bl > 400 ? b2 : body;
  }
  var BLOCK_TAGS = /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE|TD|TH|DT|DD|FIGCAPTION|CAPTION|SECTION|ARTICLE|TR|TABLE|UL|OL|DL|MAIN|BODY|ADDRESS|DETAILS|SUMMARY)$/;

  function fromHtml(html, format, wholeDoc) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var model = newModel(format || 'HTML', clean((doc.querySelector('title') || {}).textContent || ''));
    Array.prototype.forEach.call(doc.querySelectorAll(HTML_SKIP), function (el) { el.remove(); });
    var root = wholeDoc ? (doc.body || doc.documentElement) : pickHtmlRoot(doc);
    var h1 = doc.querySelector('h1');
    if (h1 && root !== doc.body && !root.contains(h1)) push(model, { type: 'h', level: 1, text: h1.textContent });
    htmlBlocks(root, model);
    if (!model.title) { var fh = model.blocks.find(function (b) { return b.type === 'h'; }); if (fh) model.title = fh.text; }
    return model;
  }
  function htmlBlocks(root, model) {
    var cur = null;
    function start(type, level) { flush(); cur = { type: type, level: level, runs: [] }; }
    function flush() { if (cur) { push(model, cur); cur = null; } }
    function walk(el, b, i) {
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) {
          if (!cur) cur = { type: 'p', runs: [] };
          cur.runs.push({ t: n.nodeValue, b: b, i: i });
          continue;
        }
        if (n.nodeType !== 1) continue;
        var tag = n.tagName.toUpperCase();
        if (tag === 'BR') { if (cur) cur.runs.push({ t: ' ' }); continue; }
        if (tag === 'TR') {
          flush();
          var cells = Array.prototype.map.call(n.children, function (c) { return clean(c.textContent); }).filter(Boolean);
          push(model, { type: 'row', text: cells.join(' · ') });
          continue;
        }
        if (BLOCK_TAGS.test(tag)) {
          var hm = /^H([1-6])$/.exec(tag);
          if (hm) start('h', Math.min(3, +hm[1]));
          else if (tag === 'LI' || tag === 'DT' || tag === 'DD') start('li');
          else if (tag === 'BLOCKQUOTE') start('quote');
          else if (tag === 'PRE') start('pre');
          else flush();
          walk(n, b, i);
          flush();
          continue;
        }
        var bb = b || tag === 'B' || tag === 'STRONG';
        var ii = i || tag === 'I' || tag === 'EM' || tag === 'CITE';
        walk(n, bb, ii);
      }
    }
    walk(root, false, false);
    flush();
  }

  // ------------------------------------------------------------------ DOCX
  function docxStyles(stylesXml) {
    var map = {};
    if (!stylesXml) return map;
    all(xml(stylesXml), 'style').forEach(function (s) {
      var id = attr(s, 'styleId');
      var name = (attr(first(s, 'name'), 'val') || '').toLowerCase();
      var lvl = attr(first(s, 'outlineLvl'), 'val');
      var level = null;
      if (lvl !== null && +lvl < 9) level = +lvl + 1;
      else if (/^(heading|titolo|überschrift|titre|título|encabezado)\s*(\d)/.test(name)) level = +RegExp.$2;
      else if (/^(title|titolo)$/.test(name)) level = 1;
      map[id] = { name: name, level: level, list: /list|elenco/.test(name), quote: /quote|citazione/.test(name) };
    });
    return map;
  }
  function on(rPr, name) {
    var el = first(rPr, name);
    if (!el) return false;
    var v = attr(el, 'val');
    return v === null || (v !== '0' && v !== 'false' && v !== 'none');
  }
  function docxParagraph(p, styles, model, notesOut) {
    var pPr = kids(p).find(function (k) { return ln(k) === 'pPr'; });
    var styleId = attr(first(pPr, 'pStyle'), 'val');
    var st = styles[styleId] || {};
    var lvl = attr(first(pPr, 'outlineLvl'), 'val');
    var level = lvl !== null && +lvl < 9 ? +lvl + 1 : st.level;
    var type = level ? 'h' : (first(pPr, 'numPr') || st.list ? 'li' : (st.quote ? 'quote' : 'p'));
    var runs = [];
    var extra = [];
    (function walk(el) {
      kids(el).forEach(function (k) {
        var name = ln(k);
        if (name === 'pPr' || name === 'rPr' || name === 'instrText' || name === 'delText' || name === 'del' || name === 'Fallback') return;
        if (name === 'r') {
          var rPr = kids(k).find(function (x) { return ln(x) === 'rPr'; });
          var b = on(rPr, 'b'), i = on(rPr, 'i');
          kids(k).forEach(function (rk) {
            var rn = ln(rk);
            if (rn === 't') runs.push({ t: rk.textContent, b: b, i: i });
            else if (rn === 'tab') runs.push({ t: ' ' });
            else if (rn === 'br' || rn === 'cr') runs.push({ t: ' ' });
            else if (rn === 'noBreakHyphen') runs.push({ t: '-' });
            else if (rn === 'footnoteReference' || rn === 'endnoteReference') runs.push({ t: '' });
            else if (rn === 'AlternateContent' || rn === 'drawing' || rn === 'pict') {
              all(rk, 'txbxContent').forEach(function (tb) { extra.push(tb); });
            }
          });
          return;
        }
        if (name === 'txbxContent') { extra.push(k); return; }
        walk(k);
      });
    })(p);
    push(model, { type: type, level: level ? Math.min(3, level) : undefined, runs: runs });
    // caselle di testo: dopo il paragrafo (una volta sola anche se ripetute nel "Fallback")
    extra.forEach(function (tb) {
      if (tb.__done) return;
      tb.__done = true;
      kids(tb).forEach(function (k) { if (ln(k) === 'p') docxParagraph(k, styles, model, notesOut); });
    });
  }
  function docxBody(container, styles, model) {
    kids(container).forEach(function (el) {
      var name = ln(el);
      if (name === 'p') docxParagraph(el, styles, model);
      else if (name === 'tbl') {
        all(el, 'tr').forEach(function (tr) {
          var cells = kids(tr).filter(function (c) { return ln(c) === 'tc'; }).map(function (tc) {
            return clean(all(tc, 't').map(function (t) { return t.textContent; }).join(''));
          }).filter(Boolean);
          push(model, { type: 'row', text: cells.join(' · ') });
        });
      } else if (name === 'sdt') {
        var content = kids(el).find(function (k) { return ln(k) === 'sdtContent'; });
        if (content) docxBody(content, styles, model);
      } else if (name === 'customXml' || name === 'ins' || name === 'smartTag') {
        docxBody(el, styles, model);
      }
    });
  }
  async function fromDocx(zip, format) {
    var docName = zip.has('word/document.xml') ? 'word/document.xml' : (zip.names().find(function (n) { return /^word\/document\d*\.xml$/.test(n); }));
    var styles = docxStyles(zip.has('word/styles.xml') ? await zip.text('word/styles.xml') : null);
    var doc = xml(await zip.text(docName));
    var model = newModel(format || 'Word');
    if (zip.has('docProps/core.xml')) {
      try { model.title = clean((first(xml(await zip.text('docProps/core.xml')), 'title') || {}).textContent || ''); } catch (e) { /* titolo facoltativo */ }
    }
    docxBody(first(doc, 'body'), styles, model);
    for (var kind of ['footnotes', 'endnotes']) {
      var name = 'word/' + kind + '.xml';
      if (!zip.has(name)) continue;
      var notes = all(xml(await zip.text(name)), kind === 'footnotes' ? 'footnote' : 'endnote').filter(function (n) { var t = attr(n, 'type'); return !t || t === 'normal'; });
      if (!notes.length) continue;
      push(model, { type: 'h', level: 2, text: kind === 'footnotes' ? 'Note a piè di pagina' : 'Note di chiusura' });
      notes.forEach(function (n) { all(n, 'p').forEach(function (p) { docxParagraph(p, styles, model); }); });
    }
    if (!model.title) { var h = model.blocks.find(function (b) { return b.type === 'h'; }); if (h) model.title = h.text; }
    return model;
  }

  // ------------------------------------------------------------------ OpenDocument
  async function fromOdf(zip, mime) {
    var doc = xml(await zip.text('content.xml'));
    var fmt = /presentation/.test(mime) ? 'OpenDocument Presentazione' : (/spreadsheet/.test(mime) ? 'OpenDocument Foglio' : 'OpenDocument Testo');
    var model = newModel(fmt);
    var styleMap = {};
    var stylesSources = [doc];
    if (zip.has('styles.xml')) { try { stylesSources.push(xml(await zip.text('styles.xml'))); } catch (e) { /* facoltativo */ } }
    stylesSources.forEach(function (sd) {
      all(sd, 'style').forEach(function (s) {
        var tp = first(s, 'text-properties');
        styleMap[attr(s, 'name')] = {
          b: tp && /bold|[6-9]00/.test(attr(tp, 'font-weight') || ''),
          i: tp && /italic|oblique/.test(attr(tp, 'font-style') || ''),
          parent: attr(s, 'parent-style-name'),
          display: (attr(s, 'display-name') || attr(s, 'name') || '').toLowerCase()
        };
      });
    });
    function styleOf(name) { return styleMap[name] || {}; }
    function inlineRuns(el, b, i, out) {
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { out.push({ t: n.nodeValue, b: b, i: i }); continue; }
        if (n.nodeType !== 1) continue;
        var name = ln(n);
        if (name === 's') { out.push({ t: ' '.repeat(+(attr(n, 'c') || 1)) }); continue; }
        if (name === 'tab' || name === 'line-break') { out.push({ t: ' ' }); continue; }
        if (name === 'note' || name === 'annotation' || name === 'bookmark-start' || name === 'bookmark' || name === 'frame') continue;
        var st = styleOf(attr(n, 'style-name'));
        inlineRuns(n, b || !!st.b, i || !!st.i, out);
      }
      return out;
    }
    function para(el, type, level) {
      var st = styleOf(attr(el, 'style-name'));
      var parent = styleOf(st.parent);
      var isTitle = /^(title|titolo)$/.test(st.display) || /^(title|titolo)$/.test(parent.display);
      if (type === 'p' && isTitle) { type = 'h'; level = 1; }
      if (type === 'p' && /^(heading|titolo|intestazione)\s*\d/.test(st.display || parent.display || '')) {
        type = 'h'; level = +(/(\d)/.exec(st.display || parent.display)[1]);
      }
      push(model, { type: type, level: level, runs: inlineRuns(el, !!st.b, !!st.i, []) });
    }
    function walk(el, listItem) {
      kids(el).forEach(function (k) {
        var name = ln(k);
        if (name === 'h') para(k, 'h', Math.min(3, +(attr(k, 'outline-level') || 1)));
        else if (name === 'p') para(k, listItem ? 'li' : 'p');
        else if (name === 'list' || name === 'list-item' || name === 'list-header') walk(k, true);
        else if (name === 'table') {
          if (/Foglio/.test(fmt)) push(model, { type: 'h', level: 2, text: attr(k, 'name') || '' });
          all(k, 'table-row').forEach(function (tr) {
            var cells = all(tr, 'table-cell').map(function (c) { return clean(c.textContent); }).filter(Boolean);
            push(model, { type: 'row', text: cells.join(' · ') });
          });
        } else if (name === 'page') {
          push(model, { type: 'h', level: 2, text: 'Diapositiva ' + (all(el, 'page').indexOf(k) + 1) });
          walk(k, false);
        } else if (name === 'frame' || name === 'text-box' || name === 'section' || name === 'g' || name === 'custom-shape' || name === 'text' || name === 'presentation' || name === 'spreadsheet' || name === 'index-body' || name === 'table-of-content') {
          if (name === 'frame' && attr(k, 'class') === 'title') {
            push(model, { type: 'h', level: 3, text: k.textContent });
            return;
          }
          walk(k, listItem);
        }
      });
    }
    walk(first(doc, 'body'), false);
    if (zip.has('meta.xml')) {
      try { model.title = clean((first(xml(await zip.text('meta.xml')), 'title') || {}).textContent || ''); } catch (e) { /* facoltativo */ }
    }
    if (!model.title) { var h = model.blocks.find(function (b) { return b.type === 'h'; }); if (h) model.title = h.text; }
    return model;
  }

  // ------------------------------------------------------------------ PPTX
  function rels(text, base) {
    var map = {};
    if (!text) return map;
    all(xml(text), 'Relationship').forEach(function (r) {
      var target = attr(r, 'Target') || '';
      map[attr(r, 'Id')] = target.charAt(0) === '/' ? target.slice(1) : resolve(base, target);
    });
    return map;
  }
  function resolve(base, rel) {
    var parts = (base ? base.split('/') : []);
    rel.split('/').forEach(function (p) { if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p); });
    return parts.join('/');
  }
  async function fromPptx(zip) {
    var model = newModel('PowerPoint');
    var pres = xml(await zip.text('ppt/presentation.xml'));
    var rmap = rels(zip.has('ppt/_rels/presentation.xml.rels') ? await zip.text('ppt/_rels/presentation.xml.rels') : '', 'ppt');
    var slides = all(pres, 'sldId').map(function (s) { return rmap[attr(s, 'id')]; }).filter(Boolean);
    if (!slides.length) slides = zip.names().filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
      .sort(function (a, b) { return (+/(\d+)\.xml/.exec(a)[1]) - (+/(\d+)\.xml/.exec(b)[1]); });
    for (var i = 0; i < slides.length; i++) {
      if (!zip.has(slides[i])) continue;
      var sx = xml(await zip.text(slides[i]));
      var shapes = all(sx, 'sp');
      var titled = false;
      shapes.forEach(function (sp) {
        var ph = first(sp, 'ph');
        var isTitle = ph && /title|ctrTitle/i.test(attr(ph, 'type') || '');
        all(sp, 'p').forEach(function (p) {
          var runs = [];
          kids(p).forEach(function (k) {
            var n = ln(k);
            if (n === 'r' || n === 'fld') {
              var rPr = first(k, 'rPr');
              runs.push({ t: (first(k, 't') || {}).textContent || '', b: attr(rPr, 'b') === '1', i: attr(rPr, 'i') === '1' });
            } else if (n === 'br') runs.push({ t: ' ' });
          });
          if (isTitle) { push(model, { type: 'h', level: 2, runs: runs }); titled = true; }
          else push(model, { type: first(p, 'buChar') || first(p, 'buAutoNum') ? 'li' : 'p', runs: runs });
        });
      });
      // tabelle nelle diapositive
      all(sx, 'tr').forEach(function (tr) {
        var cells = all(tr, 'tc').map(function (c) { return clean(c.textContent); }).filter(Boolean);
        push(model, { type: 'row', text: cells.join(' · ') });
      });
      if (!titled && shapes.length) model.blocks.splice(model.blocks.length, 0);
    }
    if (zip.has('docProps/core.xml')) {
      try { model.title = clean((first(xml(await zip.text('docProps/core.xml')), 'title') || {}).textContent || ''); } catch (e) { /* facoltativo */ }
    }
    if (!model.title) { var h = model.blocks.find(function (b) { return b.type === 'h'; }); if (h) model.title = h.text; }
    return model;
  }

  // ------------------------------------------------------------------ XLSX
  async function fromXlsx(zip) {
    var model = newModel('Excel');
    var shared = [];
    if (zip.has('xl/sharedStrings.xml')) {
      shared = all(xml(await zip.text('xl/sharedStrings.xml')), 'si').map(function (si) {
        return all(si, 't').filter(function (t) { return !t.parentNode || ln(t.parentNode) !== 'rPh'; }).map(function (t) { return t.textContent; }).join('');
      });
    }
    var wb = xml(await zip.text('xl/workbook.xml'));
    var rmap = rels(zip.has('xl/_rels/workbook.xml.rels') ? await zip.text('xl/_rels/workbook.xml.rels') : '', 'xl');
    var sheets = all(wb, 'sheet').map(function (s) {
      var rid = null;
      for (var i = 0; i < s.attributes.length; i++) if (s.attributes[i].localName === 'id' && s.attributes[i].prefix) rid = s.attributes[i].value;
      return { name: attr(s, 'name'), path: rmap[rid] };
    }).filter(function (s) { return s.path && zip.has(s.path); });
    var totalRows = 0;
    for (var k = 0; k < sheets.length; k++) {
      push(model, { type: 'h', level: 2, text: sheets[k].name });
      var sx = xml(await zip.text(sheets[k].path));
      var rows = all(sx, 'row');
      for (var r = 0; r < rows.length && totalRows < 50000; r++, totalRows++) {
        var vals = all(rows[r], 'c').map(function (c) {
          var t = attr(c, 'type') || attr(c, 't');
          var v = first(c, 'v');
          if (t === 's') return shared[+(v ? v.textContent : -1)] || '';
          if (t === 'inlineStr') return (first(c, 'is') || {}).textContent || '';
          if (t === 'b') return v && v.textContent === '1' ? 'VERO' : 'FALSO';
          return v ? v.textContent : '';
        }).map(clean).filter(Boolean);
        if (vals.length) push(model, { type: 'row', text: vals.join(' · ') });
      }
    }
    if (totalRows >= 50000) model.warnings.push('Lette solo le prime 50.000 righe.');
    model.title = sheets.length ? sheets[0].name : '';
    return model;
  }

  // ------------------------------------------------------------------ EPUB
  async function fromEpub(zip) {
    var model = newModel('EPUB');
    var container = xml(await zip.text('META-INF/container.xml'));
    var opfPath = attr(first(container, 'rootfile'), 'full-path');
    var opf = xml(await zip.text(opfPath));
    var base = opfPath.split('/').slice(0, -1).join('/');
    var manifest = {};
    all(opf, 'item').forEach(function (it) { manifest[attr(it, 'id')] = { href: resolve(base, decodeURIComponent(attr(it, 'href') || '')), type: attr(it, 'media-type') }; });
    model.title = clean((first(opf, 'title') || {}).textContent || '');
    var spine = all(opf, 'itemref').map(function (ir) { return manifest[attr(ir, 'idref')]; }).filter(function (m) { return m && /html/.test(m.type || 'html'); });
    for (var i = 0; i < spine.length; i++) {
      if (!zip.has(spine[i].href)) continue;
      var part = fromHtml(await zip.text(spine[i].href), 'EPUB', true);
      part.blocks.forEach(function (b) { if (model.blocks.length < MAX_BLOCKS) model.blocks.push(b); });
    }
    return model;
  }

  // ------------------------------------------------------------------ RTF
  function fromRtf(text) {
    var model = newModel('RTF');
    var stack = [], st = { skip: false, b: false, i: false, uc: 1 };
    var cp = 1252, decoder = new TextDecoder('windows-1252');
    var runs = [], styleLevels = {}, parLevel = null, curStyle = null;
    var styleNames = null; // durante \stylesheet
    var i = 0, n = text.length, pendingSkip = 0, bytes = [];
    function flushBytes() { if (bytes.length) { emit(decoder.decode(new Uint8Array(bytes))); bytes = []; } }
    function emit(t) {
      if (st.skip || !t) return;
      if (styleNames) { styleNames.text += t; return; }
      runs.push({ t: t, b: st.b, i: st.i });
    }
    function endPar() {
      flushBytes();
      var lvl = parLevel !== null ? parLevel : (curStyle !== null ? styleLevels[curStyle] : null);
      push(model, { type: lvl ? 'h' : 'p', level: lvl ? Math.min(3, lvl) : undefined, runs: runs });
      runs = [];
    }
    var DEST = /^(fonttbl|colortbl|info|pict|object|header|footer|headerl|headerr|footerl|footerr|footnote|xmlnstbl|listtable|listoverridetable|rsidtbl|generator|themedata|colorschememapping|latentstyles|datastore|mmathPr|filetbl|revtbl|pgdsctbl|bkmkstart|bkmkend|fldinst|shppict|nonshppict|shpinst|sp|sv|sn)$/;
    while (i < n) {
      var c = text[i];
      if (pendingSkip && c !== '\\' && c !== '{' && c !== '}') { pendingSkip--; i++; continue; }
      if (c === '{') { flushBytes(); stack.push(Object.assign({}, st, { styleNames: !!styleNames })); i++; continue; }
      if (c === '}') {
        flushBytes();
        var wasSheetEntry = styleNames && styleNames.depth === stack.length;
        if (wasSheetEntry) {
          var name = styleNames.text.replace(/;\s*$/, '').trim().toLowerCase();
          var m = /^(heading|titolo|überschrift|titre)\s*(\d)/.exec(name);
          if (m && styleNames.id !== null) styleLevels[styleNames.id] = +m[2];
          else if (/^(title|titolo)$/.test(name) && styleNames.id !== null) styleLevels[styleNames.id] = 1;
          styleNames.text = ''; styleNames.id = null;
        }
        var prev = stack.pop();
        if (prev) {
          if (styleNames && styleNames.sheetDepth === stack.length) styleNames = null;
          st = { skip: prev.skip, b: prev.b, i: prev.i, uc: prev.uc };
        }
        i++; continue;
      }
      if (c === '\\') {
        var nx = text[i + 1];
        if (nx === '\\' || nx === '{' || nx === '}') { flushBytes(); emit(nx); i += 2; continue; }
        if (nx === '\'') {
          if (pendingSkip) { pendingSkip--; i += 4; continue; } // carattere di riserva dopo \uN
          bytes.push(parseInt(text.substr(i + 2, 2), 16)); i += 4; continue;
        }
        if (nx === '*') { st.skip = true; i += 2; continue; }
        if (nx === '~') { flushBytes(); emit(' '); i += 2; continue; }
        if (nx === '-' || nx === '_') { flushBytes(); if (nx === '_') emit('-'); i += 2; continue; }
        if (nx === '\n' || nx === '\r') { endPar(); i += 2; continue; }
        var mm = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(text.substr(i, 40));
        if (!mm) { i += 2; continue; }
        var word = mm[1], arg = mm[2] !== undefined ? +mm[2] : null;
        i += mm[0].length;
        if (word !== 'u' && word !== 'uc') flushBytes();
        switch (word) {
          case 'par': endPar(); parLevel = null; break;
          case 'pard': parLevel = null; curStyle = null; break;
          case 'line': case 'tab': emit(' '); break;
          case 'cell': emit(' · '); break;
          case 'row': endPar(); break;
          case 'page': case 'sect': endPar(); break;
          case 'b': st.b = arg !== 0; break;
          case 'i': st.i = arg !== 0; break;
          case 'plain': st.b = false; st.i = false; break;
          case 'uc': st.uc = arg || 1; break;
          case 'u': flushBytes(); emit(String.fromCharCode(arg < 0 ? arg + 65536 : arg)); pendingSkip = st.uc; break;
          case 'ansicpg': cp = arg; try { decoder = new TextDecoder('windows-' + arg); } catch (e) { decoder = new TextDecoder('windows-1252'); } break;
          case 'outlinelevel': parLevel = arg + 1; break;
          case 's':
            if (styleNames) styleNames.id = arg;
            else curStyle = arg;
            break;
          case 'stylesheet': styleNames = { text: '', id: null, depth: stack.length + 1, sheetDepth: stack.length - 1 }; break;
          case 'emdash': emit('—'); break;
          case 'endash': emit('–'); break;
          case 'lquote': emit('‘'); break;
          case 'rquote': emit('’'); break;
          case 'ldblquote': emit('“'); break;
          case 'rdblquote': emit('”'); break;
          case 'bullet': emit('•'); break;
          default:
            if (DEST.test(word)) st.skip = true;
        }
        continue;
      }
      if (c === '\r' || c === '\n') { i++; continue; }
      flushBytes();
      emit(c);
      i++;
    }
    endPar();
    guessHeadingsIfNone(model);
    return model;
  }
  function guessHeadingsIfNone(model) {
    if (!model.blocks.some(function (b) { return b.type === 'h'; })) guessHeadings(model);
    if (!model.title) { var h = model.blocks.find(function (b) { return b.type === 'h'; }); if (h) model.title = h.text; }
  }

  // ------------------------------------------------------------------ DOC (Word 97-2003)
  function fromDoc(bytes) {
    var text = g.WCCfb.docText(bytes);
    var model = newModel('Word 97-2003');
    text.split('\n').forEach(function (line) {
      if (/\t/.test(line)) {
        // righe di tabella: celle separate da tab, riga chiusa da tab doppio
        line.split(/\t\t/).forEach(function (row) {
          var cells = row.split('\t').map(clean).filter(Boolean);
          if (cells.length) push(model, { type: 'row', text: cells.join(' · ') });
        });
      } else push(model, { type: 'p', text: line });
    });
    guessHeadings(model);
    return model;
  }

  // ------------------------------------------------------------------ riconoscimento
  var SUPPORTED = ['pdf', 'docx', 'docm', 'dotx', 'dotm', 'doc', 'odt', 'ott', 'odp', 'ods', 'pptx', 'pptm', 'ppsx', 'xlsx', 'xlsm', 'epub', 'rtf', 'html', 'htm', 'xhtml', 'md', 'markdown', 'txt', 'text', 'log', 'srt', 'vtt', 'csv', 'tsv'];
  var IMAGES = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];

  // immagine riconosciuta dai primi byte -> tipo MIME (o null)
  function imageType(bytes, name) {
    var b = bytes;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    if (b[0] === 0x42 && b[1] === 0x4d && ext(name) === 'bmp') return 'image/bmp';
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return 'image/tiff';
    return null;
  }

  function sniff(bytes, name) {
    var e = ext(name);
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
    if (g.WCZip.isZip(bytes)) return 'zip';
    if (g.WCCfb && g.WCCfb.isCfb(bytes)) return 'cfb';
    var head = new TextDecoder('latin1').decode(bytes.subarray(0, 512)).replace(/^﻿|^ï»¿/, '').trimStart();
    if (/^\{\\rtf/.test(head)) return 'rtf';
    if (e === 'md' || e === 'markdown') return 'md';
    if (e === 'srt' || e === 'vtt' || /^WEBVTT/.test(head)) return 'subs';
    if (e === 'csv' || e === 'tsv') return 'csv';
    if (/^(<!doctype html|<html|<\?xml[^>]*>\s*<html)/i.test(head) || e === 'html' || e === 'htm' || e === 'xhtml') return 'html';
    if (/[\x00-\x08\x0e-\x1f]/.test(head.replace(/\x00/g, '')) && !(bytes[0] === 0xff || bytes[0] === 0xfe)) return 'binary';
    return 'txt';
  }

  /*
   * Apre un documento. bytes: ArrayBuffer o Uint8Array; name: nome del file.
   * Per i PDF restituisce { format: 'PDF', pdf: true, bytes } (li disegna il lettore con PDF.js).
   */
  async function open(buffer, name) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var kind = sniff(bytes, name);
    var model;
    if (kind === 'pdf') return { format: 'PDF', pdf: true, bytes: bytes, title: (name || '').replace(/\.pdf$/i, ''), blocks: [], warnings: [] };
    var img = imageType(bytes, name);
    if (img === 'image/tiff') throw new Error('Le immagini TIFF non si possono mostrare qui: salvale come PNG o JPG (oppure come PDF) e riaprile.');
    if (img) return { format: 'Immagine', image: true, mime: img, bytes: bytes, title: (name || '').replace(/\.[^.]+$/, ''), blocks: [], warnings: [] };
    if (kind === 'zip') {
      var zip = g.WCZip.open(bytes);
      if (zip.has('word/document.xml') || zip.names().some(function (n) { return /^word\/document\d*\.xml$/.test(n); })) model = await fromDocx(zip);
      else if (zip.has('ppt/presentation.xml')) model = await fromPptx(zip);
      else if (zip.has('xl/workbook.xml')) model = await fromXlsx(zip);
      else if (zip.has('META-INF/container.xml') && zip.has('mimetype') && /epub/.test(await zip.text('mimetype'))) model = await fromEpub(zip);
      else if (zip.has('content.xml')) model = await fromOdf(zip, zip.has('mimetype') ? await zip.text('mimetype') : '');
      else throw new Error('Archivio ZIP che non contiene un documento riconosciuto.');
    } else if (kind === 'cfb') model = fromDoc(bytes);
    else if (kind === 'rtf') model = fromRtf(decodeText(bytes));
    else if (kind === 'md') model = fromMarkdown(decodeText(bytes));
    else if (kind === 'subs') model = fromSubtitles(decodeText(bytes), 'Sottotitoli');
    else if (kind === 'csv') model = fromDelimited(decodeText(bytes));
    else if (kind === 'html') model = fromHtml(decodeText(bytes), 'HTML');
    else if (kind === 'binary') throw new Error('Questo tipo di file non contiene testo leggibile. Formati supportati: ' + SUPPORTED.join(', ') + '.');
    else model = fromPlain(decodeText(bytes), 'Testo');
    if (!model.title) model.title = (name || '').replace(/\.[^.]+$/, '');
    if (!model.blocks.length) model.warnings.push('Nel documento non c’è testo da leggere (potrebbe contenere solo immagini).');
    return model;
  }

  g.WCFormats = {
    open: open, fromHtml: fromHtml, fromPlain: fromPlain, fromMarkdown: fromMarkdown, ext: ext, imageType: imageType,
    SUPPORTED: SUPPORTED, IMAGES: IMAGES, accept: SUPPORTED.concat(IMAGES).map(function (e) { return '.' + e; }).join(',')
  };
})(globalThis);
