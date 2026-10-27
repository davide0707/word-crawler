/*
 * Word Crawler: esportazione dei risultati (Markdown, testo, HTML, JSON) e voci d'archivio.
 */
(function (g) {
  'use strict';
  if (g.WCExport) return;

  var TYPE = { key: 'Frase chiave', def: 'Definizione', name: 'Nome', num: 'Numero o data', term: 'Trovata' };
  var MODE = { study: 'Studio', summary: 'Riassunto', web: 'Ragnatela', search: 'Cerca' };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pageTag(p) { return p != null ? ' (p. ' + (p + 1) + ')' : ''; }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' }); } catch (e) { return iso; }
  }

  /*
   * Voce d'archivio: contiene i risultati, non il documento.
   * selection: insieme degli id delle evidenziazioni scelte (se assente: tutte)
   */
  function entry(doc, results, selection) {
    var hl = results.highlights.filter(function (h) { return !selection || selection.has(h.id); });
    return {
      id: 'wc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      version: 2,
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
      settings: results.settings
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

  function build(kind, e) {
    if (kind === 'md') return { name: safeName(e.title) + '.md', mime: 'text/markdown', content: markdown(e) };
    if (kind === 'txt') return { name: safeName(e.title) + '.txt', mime: 'text/plain', content: plain(e) };
    if (kind === 'html') return { name: safeName(e.title) + '.html', mime: 'text/html', content: html(e) };
    return { name: safeName(e.title) + '.json', mime: 'application/json', content: JSON.stringify(e, null, 2) };
  }
  function safeName(s) { return (String(s || 'word-crawler').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'word-crawler') + ' - Word Crawler'; }

  g.WCExport = { entry: entry, build: build, markdown: markdown, TYPE: TYPE, MODE: MODE, statsLines: statsLines, esc: esc };
})(globalThis);
