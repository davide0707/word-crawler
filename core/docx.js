/*
 * Word Crawler: esportazione in Word (.docx) del documento con i segni.
 *
 * WCDocx.build(entry, model) -> Promise<Uint8Array>
 *   entry: voce dei risultati (titolo, sunto, parole chiave, schede…)
 *   model: documento segnato di WCAnnotate.capture (facoltativo)
 *
 * I segni diventano formattazione di Word: sottolineature colorate per le frasi,
 * bordi attorno a nomi, concetti e numeri, evidenziatore giallo per i segni fatti a mano
 * e commenti di Word per le note.
 */
(function (g) {
  'use strict';
  if (g.WCDocx) return;

  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  function x(s) {
    return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // proprietà del carattere, nell'ordine richiesto dallo schema di Word
  function rPr(o) {
    var p = '';
    if (o.b) p += '<w:b/>';
    if (o.i) p += '<w:i/>';
    if (o.strike) p += '<w:strike/>';
    if (o.color) p += '<w:color w:val="' + o.color + '"/>';
    if (o.sz) p += '<w:sz w:val="' + o.sz + '"/>';
    if (o.hl) p += '<w:highlight w:val="' + o.hl + '"/>';
    if (o.u) p += '<w:u w:val="' + o.u + '"' + (o.uc ? ' w:color="' + o.uc + '"' : '') + '/>';
    if (o.bdr) p += '<w:bdr w:val="single" w:sz="6" w:space="0" w:color="' + o.bdr + '"/>';
    if (o.shd) p += '<w:shd w:val="clear" w:color="auto" w:fill="' + o.shd + '"/>';
    return p ? '<w:rPr>' + p + '</w:rPr>' : '';
  }
  function run(text, o) {
    return '<w:r>' + rPr(o || {}) + '<w:t xml:space="preserve">' + x(text) + '</w:t></w:r>';
  }
  function para(inner, style) {
    return '<w:p>' + (style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '') + inner + '</w:p>';
  }

  var SENT = { key: { u: 'single', uc: '1D4ED8' }, def: { u: 'double', uc: '15803D' }, term: { u: 'single', uc: 'EA580C' } };
  var MARK = {
    'ring-cyan': { bdr: '0E7490' }, 'ring-green': { bdr: '15803D', b: true }, 'kw-lav': { shd: 'DFE3FF' }, 'kw-cyan': { shd: 'D6F4FF' },
    num: { bdr: '4338CA' }, term: { shd: 'FFD9BF' }, strike: { strike: true }
  };

  function styleOf(r) {
    var o = {};
    if (r.s && SENT[r.s]) Object.assign(o, SENT[r.s]);
    if (r.mk && MARK[r.mk]) Object.assign(o, MARK[r.mk]);
    if (r.u === 'hl') o.hl = 'yellow';
    if (r.u === 'under') { o.u = 'wave'; o.uc = 'E11D48'; }
    if (r.u === 'note') { o.shd = 'FFE4CC'; }
    return o;
  }

  function build(entry, model) {
    var e = entry || {};
    var body = [];
    var comments = [];
    var date = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    body.push(para(run(e.title || 'Documento'), 'Title'));
    var meta = [e.format, e.source].filter(Boolean).join(' · ');
    if (meta) body.push(para(run(meta, { color: '666666', sz: 18 })));
    body.push(para(
      run('Legenda: ', { b: true, sz: 18 }) + run('frase chiave', Object.assign({ sz: 18 }, SENT.key)) + run('   ', { sz: 18 }) +
      run('definizione', Object.assign({ sz: 18 }, SENT.def)) + run('   ', { sz: 18 }) + run('concetto', Object.assign({ sz: 18 }, MARK['ring-cyan'])) + run('   ', { sz: 18 }) +
      run('nome', Object.assign({ sz: 18 }, MARK['ring-green'])) + run('   ', { sz: 18 }) + run('numero o data', Object.assign({ sz: 18 }, MARK.num)) + run('   ', { sz: 18 }) +
      run('evidenziato da te', { sz: 18, hl: 'yellow' }) + run('   ', { sz: 18 }) + run('sottolineato da te', { sz: 18, u: 'wave', uc: 'E11D48' })
    ));

    if (e.summary && e.summary.length) {
      body.push(para(run('Sunto'), 'Heading1'));
      e.summary.forEach(function (s) { body.push(para(run(s.text) + (s.page != null ? run(' (p. ' + (s.page + 1) + ')', { color: '888888', sz: 18 }) : ''))); });
    }
    if (e.keywords && e.keywords.length) {
      body.push(para(run('Parole chiave'), 'Heading1'));
      body.push(para(run(e.keywords.map(function (k) { return k.word; }).join(' · '))));
    }

    if (model && model.blocks && model.blocks.length) {
      body.push(para(run('Documento segnato'), 'Heading1'));
      var lastPage = null, open = 0;
      model.blocks.forEach(function (b, bi) {
        if (b.page != null && b.page !== lastPage && model.blocks.length > 1) {
          body.push(para(run('Pagina ' + (b.page + 1), { color: '888888', sz: 16 })));
          lastPage = b.page;
        }
        var inner = '';
        b.runs.forEach(function (r) {
          // una nota diventa un commento di Word attorno al testo segnato
          if (r.n && r.n !== open) {
            if (open) inner += '<w:commentRangeEnd w:id="' + (open - 1) + '"/>';
            inner += '<w:commentRangeStart w:id="' + (r.n - 1) + '"/>';
            open = r.n;
          }
          inner += run(r.t, styleOf(r));
          if (r.n && r.end) {
            inner += '<w:commentRangeEnd w:id="' + (r.n - 1) + '"/><w:r><w:commentReference w:id="' + (r.n - 1) + '"/></w:r>';
            open = 0;
          }
        });
        // una nota può continuare nel paragrafo dopo; all'ultimo paragrafo si chiude comunque
        if (open && bi === model.blocks.length - 1) inner += '<w:commentRangeEnd w:id="' + (open - 1) + '"/><w:r><w:commentReference w:id="' + (open - 1) + '"/></w:r>';
        body.push(para(inner, b.w >= 3 ? 'Heading2' : (b.w === 2 ? 'Heading3' : null)));
      });
      (model.notes || []).forEach(function (nt) {
        comments.push('<w:comment w:id="' + (nt.n - 1) + '" w:author="Word Crawler" w:initials="WC" w:date="' + date + '">' +
          para(run(nt.text || '(nota vuota)')) + '</w:comment>');
      });
    }

    if (e.cards && e.cards.length) {
      body.push(para(run('Schede di ripasso'), 'Heading1'));
      e.cards.forEach(function (c) {
        body.push(para(run(c.front, { b: true })));
        body.push(para(run(c.back)));
      });
    }
    body.push(para(run('Creato con Word Crawler, senza intelligenza artificiale.', { color: '888888', sz: 16 })));

    var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="' + W + '" xmlns:r="' + R + '"><w:body>' + body.join('') +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';

    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="' + W + '">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:sz w:val="22"/><w:lang w:val="' + x(e.lang || 'it') + '"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="44"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="2F4BFF"/><w:sz w:val="26"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="26"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="23"/></w:rPr></w:style>' +
      '</w:styles>';

    var hasComments = comments.length > 0;
    var files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        (hasComments ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : '') +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        (hasComments ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>' : '') +
        '</Relationships>' },
      { name: 'word/document.xml', data: docXml },
      { name: 'word/styles.xml', data: styles },
      { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>' + x(e.title || 'Documento') + '</dc:title><dc:creator>Word Crawler</dc:creator>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + date + '</dcterms:created></cp:coreProperties>' }
    ];
    if (hasComments) {
      files.push({ name: 'word/comments.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="' + W + '">' + comments.join('') + '</w:comments>' });
    }
    return g.WCZip.write(files);
  }

  g.WCDocx = { build: build };
})(globalThis);
