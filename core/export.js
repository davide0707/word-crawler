// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: esportazione dei risultati e voci d'archivio.
 * Riepilogo: Markdown, testo, HTML, JSON, schede per Anki.
 * Documento segnato (con WCAnnotate e WCDocx): Word (.docx) e pagina web; il PDF lo stampa l'app.
 */
(function (g) {
  'use strict';
  if (g.WCExport) return;

  var TYPE = { key: 'Frase chiave', def: 'Definizione', name: 'Nome', num: 'Numero o data', term: 'Trovata' };
  var MODE = { study: 'Studio', summary: 'Riassunto', web: 'Ragnatela', search: 'Cerca' };
  var USER = { hl: 'Evidenziato', under: 'Sottolineato', note: 'Nota' };
  // formati di esportazione: [codice, etichetta, serve il documento segnato?]
  var KINDS = [
    ['md', 'Riepilogo in Markdown (.md)'], ['txt', 'Riepilogo in testo (.txt)'], ['html', 'Riepilogo, pagina web (.html)'],
    ['anki', 'Schede per Anki (.txt)'], ['docx', 'Documento segnato, Word (.docx)', true], ['ahtml', 'Documento segnato, pagina web (.html)', true],
    ['pdf', 'Documento segnato, PDF', true], ['json', 'Dati (.json)']
  ];

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pageTag(p) { return p != null ? ' (p. ' + (p + 1) + ')' : ''; }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' }); } catch (e) { return iso; }
  }

  /*
   * Voce d'archivio: contiene i risultati, non il documento.
   * selection: insieme degli id delle evidenziazioni scelte (se assente: tutte)
   */
  function entry(doc, results, selection, extra) {
    var hl = results.highlights.filter(function (h) { return !selection || selection.has(h.id); });
    var x = extra || {};
    return {
      id: 'wc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      version: 3,
      title: doc.title || 'Senza titolo',
      source: doc.source || '',
      format: doc.format || '',
      date: new Date().toISOString(),
      mode: results.mode,
      lang: results.lang,
      stats: results.stats,
      keywords: results.keywords.map(function (k) { return { word: k.word, count: k.count, name: k.name }; }),
      discarded: results.discarded || [],
      summary: results.summary.map(function (s) { return { text: s.text, page: s.page }; }),
      highlights: hl.map(function (h) { return { type: h.type, text: h.text, page: h.page, terms: h.terms }; }),
      search: results.search,
      settings: results.settings,
      cards: (results.cards || []).map(function (c) {
        var o = { type: c.type, front: c.front, back: c.back, answer: c.answer, cloze: c.cloze, page: c.page };
        if (c.choices) { o.choices = c.choices; o.correct = c.correct; }
        return o;
      }),
      // segni fatti a mano (con la posizione, per ritrovarli sulla stessa pagina)
      userMarks: (x.userMarks || []).map(function (m) { return { type: m.type, text: m.text, note: m.note || '', page: m.page, from: m.from, to: m.to }; }),
      // evidenziazioni scelte, per ritrovare solo quelle sulla pagina (estensione)
      keep: x.keep || null
    };
  }

  function statsLines(st) {
    if (!st) return [];
    return [
      'Parole: ' + st.words.toLocaleString('it-IT') + ' (diverse: ' + st.uniqueWords.toLocaleString('it-IT') + ')',
      'Frasi: ' + st.sentences + ' · paragrafi: ' + st.paragraphs + ' · media ' + st.avgSentenceWords + ' parole per frase',
      'Tempo di lettura: circa ' + st.readingMinutes + ' min',
      'Leggibilità (' + st.readabilityScale + '): ' + st.readability + '/100, ' + st.readabilityLabel,
      'Densità lessicale: ' + Math.round(st.lexicalDensity * 100) + '%'
    ];
  }

  function markdown(e) {
    var out = ['# ' + e.title, ''];
    out.push('*' + [e.format, e.source, fmtDate(e.date), 'modalità ' + (MODE[e.mode] || e.mode)].filter(Boolean).join(' · ') + '*', '');
    if (e.keywords.length) { out.push('## Parole chiave', '', e.keywords.map(function (k) { return k.word + ' (' + k.count + ')'; }).join(' · '), ''); }
    if (e.summary.length) {
      out.push('## Sunto', '');
      e.summary.forEach(function (s) { out.push(s.text + pageTag(s.page)); out.push(''); });
    }
    var groups = { def: [], key: [], name: [], num: [], term: [] };
    e.highlights.forEach(function (h) { (groups[h.type] || (groups[h.type] = [])).push(h); });
    if (groups.def.length) { out.push('## Definizioni', ''); groups.def.forEach(function (h) { out.push('- ' + h.text + pageTag(h.page)); }); out.push(''); }
    if (groups.key.length && e.mode === 'study') { out.push('## Frasi sottolineate', ''); groups.key.forEach(function (h) { out.push('- ' + h.text + pageTag(h.page)); }); out.push(''); }
    if (groups.name.length) { out.push('## Nomi e concetti cerchiati', '', groups.name.map(function (h) { return h.text; }).join(' · '), ''); }
    if (groups.num.length) { out.push('## Numeri e date', '', groups.num.map(function (h) { return h.text + pageTag(h.page); }).join(' · '), ''); }
    if (groups.term.length) {
      out.push('## Risultati della ricerca', '');
      if (e.search) out.push(e.search.terms.map(function (t) { return '**' + t.term + '**: ' + t.count; }).join(' · '), '');
      groups.term.forEach(function (h) { out.push('- ' + h.text + pageTag(h.page)); });
      out.push('');
    }
    var um = e.userMarks || [];
    if (um.length) {
      out.push('## I tuoi segni', '');
      um.forEach(function (m) { out.push('- **' + (USER[m.type] || m.type) + '**: «' + m.text + '»' + (m.note ? ' — ' + m.note : '') + pageTag(m.page)); });
      out.push('');
    }
    if (e.cards && e.cards.length) {
      out.push('## Schede di ripasso', '');
      e.cards.forEach(function (c, i) { out.push((i + 1) + '. **' + c.front + '**', '   ' + c.back, ''); });
    }
    out.push('## Statistiche', '');
    statsLines(e.stats).forEach(function (l) { out.push('- ' + l); });
    out.push('', '---', 'Creato con Word Crawler, senza intelligenza artificiale: parole chiave e sunto sono calcolati con metodi statistici.');
    return out.join('\n');
  }

  function plain(e) {
    return markdown(e).replace(/^#+\s*/gm, '').replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/^- /gm, '• ');
  }

  function html(e) {
    var body = markdown(e).split('\n');
    var out = [], inList = false;
    body.forEach(function (l) {
      var m;
      if ((m = /^- (.*)$/.exec(l))) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
      if (inList) { out.push('</ul>'); inList = false; }
      if ((m = /^# (.*)$/.exec(l))) out.push('<h1>' + esc(m[1]) + '</h1>');
      else if ((m = /^## (.*)$/.exec(l))) out.push('<h2>' + esc(m[1]) + '</h2>');
      else if (l === '---') out.push('<hr>');
      else if (l.trim()) out.push('<p>' + inline(l) + '</p>');
    });
    if (inList) out.push('</ul>');
    function inline(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>'); }
    return '<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(e.title) + ' · Word Crawler</title><style>' +
      'body{font:17px/1.6 Georgia,"Times New Roman",serif;max-width:720px;margin:40px auto;padding:0 20px;color:#16171c;background:#fbfaf7}' +
      'h1{font:700 30px/1.2 system-ui,sans-serif;margin:0 0 6px}h2{font:700 15px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:#2f4bff;margin:32px 0 10px}' +
      'p em:only-child{color:#6b6b75}li{margin:0 0 8px}hr{border:0;border-top:1px solid #ddd;margin:32px 0}' +
      '@media (prefers-color-scheme:dark){body{background:#0e0e12;color:#ecebf0}h2{color:#3fd8ff}hr{border-color:#333}}' +
      '</style></head><body>' + out.join('\n') + '</body></html>';
  }

  /*
   * Schede per Anki: file di testo con la tabulazione tra fronte e retro.
   * In Anki: File > Importa, scegli il file; le intestazioni con # impostano già tutto.
   */
  function anki(e) {
    function cell(s) { return String(s || '').replace(/[\t\r\n]+/g, ' ').trim(); }
    var tag = 'word-crawler ' + cell(e.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    var out = ['#separator:tab', '#html:false', '#columns:Fronte\tRetro\tEtichette', '#tags column:3'];
    (e.cards || []).forEach(function (c) { out.push(cell(c.front) + '\t' + cell(c.back) + '\t' + tag); });
    return out.join('\n') + '\n';
  }

  // kind: vedi KINDS. model: documento segnato (WCAnnotate.capture), serve per 'docx' e 'ahtml'.
  // Restituisce { name, mime, content } (per 'docx' una Promise con content Uint8Array).
  function build(kind, e, model) {
    if (kind === 'md') return { name: safeName(e.title) + '.md', mime: 'text/markdown', content: markdown(e) };
    if (kind === 'txt') return { name: safeName(e.title) + '.txt', mime: 'text/plain', content: plain(e) };
    if (kind === 'html') return { name: safeName(e.title) + '.html', mime: 'text/html', content: html(e) };
    if (kind === 'anki') return { name: safeName(e.title) + ' - schede Anki.txt', mime: 'text/plain', content: anki(e) };
    if (kind === 'ahtml') return { name: safeName(e.title) + ' - segnato.html', mime: 'text/html', content: g.WCAnnotate.html(e, model) };
    if (kind === 'docx') {
      return g.WCDocx.build(e, model).then(function (bytes) {
        return { name: safeName(e.title) + ' - segnato.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: bytes, binary: true };
      });
    }
    return { name: safeName(e.title) + '.json', mime: 'application/json', content: JSON.stringify(e, null, 2) };
  }
  function safeName(s) { return (String(s || 'word-crawler').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'word-crawler') + ' - Word Crawler'; }

  g.WCExport = { entry: entry, build: build, markdown: markdown, anki: anki, safeName: safeName, TYPE: TYPE, MODE: MODE, USER: USER, KINDS: KINDS, statsLines: statsLines, esc: esc };
})(globalThis);
