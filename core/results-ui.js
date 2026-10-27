/*
 * Word Crawler: pannello dei risultati.
 * Mostra sunto, evidenziazioni, parole chiave e statistiche man mano che il ragno legge,
 * permette di scegliere cosa tenere e di salvarlo o esportarlo.
 */
(function (g) {
  'use strict';
  if (g.WCResultsUI) return;
  var el = function (tag, attrs, children) { return g.WCSettingsUI.el(tag, attrs, children); };
  var X = g.WCExport;

  var BADGE = { key: 'Frase chiave', def: 'Definizione', name: 'Nome', num: 'Numero', term: 'Trovata' };

  /*
   * opts: { onJump(idx), onSave(entry), onExport(kind, entry), onCopy(text), idPrefix }
   */
  function render(container, opts) {
    var P = opts.idPrefix || 'wcr';
    container.textContent = '';
    container.classList.add('wc-results');
    var state = { results: null, doc: null, processed: 0, total: 0, selected: new Set(), filter: 'all', firstIdx: new Map(), done: false, tab: 'summary' };

    var status = el('p', { class: 'wc-status', role: 'status', text: 'Apri un documento per cominciare.' });
    var tabs = el('div', { class: 'wc-tabs', role: 'tablist' });
    var panels = el('div', { class: 'wc-panels' });
    var TABS = [['summary', 'Sunto'], ['marks', 'Evidenziate'], ['keywords', 'Parole chiave'], ['stats', 'Statistiche']];
    var tabBtns = {}, tabPanels = {};
    TABS.forEach(function (t) {
      var b = el('button', { type: 'button', role: 'tab', id: P + '-tab-' + t[0], 'aria-controls': P + '-panel-' + t[0], class: 'wc-tab' }, [el('span', { text: t[1] }), el('span', { class: 'wc-count' })]);
      b.addEventListener('click', function () { select(t[0]); });
      tabs.appendChild(b);
      var pnl = el('div', { role: 'tabpanel', id: P + '-panel-' + t[0], 'aria-labelledby': P + '-tab-' + t[0], class: 'wc-panel', tabindex: '0' });
      panels.appendChild(pnl);
      tabBtns[t[0]] = b; tabPanels[t[0]] = pnl;
    });

    var saveBtn = el('button', { type: 'button', class: 'wc-btn wc-primary', text: 'Salva in archivio', disabled: 'disabled' });
    var exportSel = el('select', { id: P + '-export', 'aria-label': 'Esporta', disabled: 'disabled' }, [
      el('option', { value: '', text: 'Esporta…' }), el('option', { value: 'md', text: 'Markdown (.md)' }), el('option', { value: 'txt', text: 'Testo (.txt)' }),
      el('option', { value: 'html', text: 'Pagina web (.html)' }), el('option', { value: 'json', text: 'Dati (.json)' })
    ]);
    var copyBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Copia', disabled: 'disabled' });
    var note = el('p', { class: 'wc-note', role: 'status' });
    var actions = el('div', { class: 'wc-actions' }, [saveBtn, exportSel, copyBtn]);

    container.appendChild(el('div', { class: 'wc-results-head' }, [el('h2', { text: 'Risultati' }), status]));
    container.appendChild(tabs);
    container.appendChild(panels);
    container.appendChild(el('div', { class: 'wc-results-foot' }, [actions, note]));

    function select(id) {
      state.tab = id;
      Object.keys(tabBtns).forEach(function (k) {
        var on = k === id;
        tabBtns[k].setAttribute('aria-selected', on ? 'true' : 'false');
        tabBtns[k].tabIndex = on ? 0 : -1;
        tabPanels[k].hidden = !on;
      });
    }
    select('summary');

    function currentEntry() {
      var e = X.entry(state.doc || {}, state.results, state.selected);
      return e;
    }
    function flash(msg) { note.textContent = msg; clearTimeout(flash.t); flash.t = setTimeout(function () { note.textContent = ''; }, 4000); }
    saveBtn.addEventListener('click', function () {
      if (!state.results || !opts.onSave) return;
      Promise.resolve(opts.onSave(currentEntry())).then(function (ok) { flash(ok === false ? 'Non sono riuscito a salvare.' : 'Salvato nell’archivio.'); });
    });
    exportSel.addEventListener('change', function () {
      var k = exportSel.value;
      exportSel.value = '';
      if (!k || !state.results || !opts.onExport) return;
      Promise.resolve(opts.onExport(k, currentEntry())).then(function (ok) { if (ok !== false) flash('Esportato.'); });
    });
    copyBtn.addEventListener('click', function () {
      if (!state.results) return;
      var text = X.markdown(currentEntry());
      var done = function () { flash('Copiato negli appunti.'); };
      try { navigator.clipboard.writeText(text).then(done, function () { if (opts.onCopy) { opts.onCopy(text); done(); } else flash('Copia non consentita qui: usa Esporta.'); }); }
      catch (e) { flash('Copia non consentita qui: usa Esporta.'); }
    });

    function item(text, meta, idx, extra) {
      var li = el('li', { class: 'wc-item' });
      if (extra) li.appendChild(extra);
      var body = el('button', { type: 'button', class: 'wc-item-text', title: 'Mostra nel documento' }, [el('span', { text: text })]);
      if (meta) body.appendChild(el('span', { class: 'wc-meta', text: meta }));
      body.addEventListener('click', function () { if (opts.onJump && idx != null) opts.onJump(idx); });
      li.appendChild(body);
      li.dataset.idx = idx;
      return li;
    }
    function pageMeta(p) { return p != null ? 'p. ' + (p + 1) : ''; }

    function build() {
      var r = state.results;
      // sunto
      var sp = tabPanels.summary;
      sp.textContent = '';
      if (r.mode === 'web' || r.mode === 'search') {
        sp.appendChild(el('p', { class: 'wc-hint', text: 'Il sunto viene comunque calcolato: ' + r.summary.length + ' frasi su ' + r.stats.sentences + '.' }));
      }
      var ol = el('ol', { class: 'wc-list wc-summary' });
      r.summary.forEach(function (s) { ol.appendChild(item(s.text, pageMeta(s.page), s.idx)); });
      sp.appendChild(ol);
      sp.appendChild(el('p', { class: 'wc-pending' }));

      // evidenziate
      var mp = tabPanels.marks;
      mp.textContent = '';
      tabBtns.marks.firstChild.textContent = r.mode === 'search' ? 'Trovate' : 'Evidenziate';
      if (r.search) {
        mp.appendChild(el('p', { class: 'wc-hint', text: r.search.terms.length ? r.search.terms.map(function (t) { return t.term + ': ' + t.count; }).join(' · ') : 'Scrivi le parole da cercare nelle impostazioni (modalità Cerca).' }));
      }
      var types = {};
      r.highlights.forEach(function (h) { types[h.type] = (types[h.type] || 0) + 1; });
      var chips = el('div', { class: 'wc-chips', role: 'group', 'aria-label': 'Filtra' });
      [['all', 'Tutte']].concat(Object.keys(types).map(function (t) { return [t, BADGE[t]]; })).forEach(function (c) {
        if (Object.keys(types).length < 2 && c[0] !== 'all') return;
        var b = el('button', { type: 'button', class: 'wc-chip', 'aria-pressed': state.filter === c[0] ? 'true' : 'false', text: c[1] });
        b.addEventListener('click', function () { state.filter = c[0]; build(); paint(); });
        chips.appendChild(b);
      });
      if (r.highlights.length) {
        var allBtn = el('button', { type: 'button', class: 'wc-link', text: 'Tutte' });
        var noneBtn = el('button', { type: 'button', class: 'wc-link', text: 'Nessuna' });
        allBtn.addEventListener('click', function () { r.highlights.forEach(function (h) { state.selected.add(h.id); }); build(); paint(); });
        noneBtn.addEventListener('click', function () { state.selected.clear(); build(); paint(); });
        mp.appendChild(el('div', { class: 'wc-row wc-select-row' }, [chips, el('span', { class: 'wc-select' }, [el('span', { text: 'Da salvare: ' }), allBtn, noneBtn])]));
      }
      var ul = el('ul', { class: 'wc-list wc-marks' });
      r.highlights.forEach(function (h) {
        if (state.filter !== 'all' && h.type !== state.filter) return;
        var cb = el('input', { type: 'checkbox', 'aria-label': 'Tieni questa evidenziazione' });
        cb.checked = state.selected.has(h.id);
        cb.addEventListener('change', function () { if (cb.checked) state.selected.add(h.id); else state.selected.delete(h.id); });
        var badge = el('span', { class: 'wc-badge wc-b-' + h.type, text: BADGE[h.type] || h.type });
        var li = item(h.text, pageMeta(h.page), h.idx, el('span', { class: 'wc-item-side' }, [cb, badge]));
        li.classList.add('wc-t-' + h.type);
        ul.appendChild(li);
      });
      mp.appendChild(ul);
      if (!r.highlights.length) mp.appendChild(el('p', { class: 'wc-hint', text: r.mode === 'study' ? 'Nessuna evidenziazione con queste impostazioni.' : 'In questa modalità le evidenziazioni da salvare sono le frasi del sunto. Passa a Studio per sottolineare, cerchiare e riquadrare.' }));
      mp.appendChild(el('p', { class: 'wc-pending' }));

      // parole chiave
      var kp = tabPanels.keywords;
      kp.textContent = '';
      var kl = el('ul', { class: 'wc-kw' });
      r.keywords.forEach(function (k) {
        var li = el('li', { class: 'wc-kwi' + (k.name ? ' wc-name' : ''), 'data-key': k.key }, [el('span', { text: k.word }), el('span', { class: 'wc-count', text: String(k.count) })]);
        li.addEventListener('click', function () { var i = state.firstIdx.get(k.key); if (i != null && opts.onJump) opts.onJump(i); });
        kl.appendChild(li);
      });
      kp.appendChild(kl);
      if (r.discarded && r.discarded.length) kp.appendChild(el('p', { class: 'wc-hint', text: 'Quasi parole chiave, scartate: ' + r.discarded.join(', ') + '.' }));
      kp.appendChild(el('p', { class: 'wc-hint', text: 'In verde i nomi propri. Tocca una parola per vedere dove compare la prima volta.' }));

      // statistiche
      var stp = tabPanels.stats;
      stp.textContent = '';
      var st = r.stats;
      var dl = el('dl', { class: 'wc-stats' });
      [['Parole', st.words.toLocaleString('it-IT')], ['Parole diverse', st.uniqueWords.toLocaleString('it-IT')], ['Frasi', st.sentences], ['Paragrafi', st.paragraphs],
        ['Parole per frase', st.avgSentenceWords], ['Tempo di lettura', 'circa ' + st.readingMinutes + ' min'],
        ['Leggibilità', st.readability + '/100 (' + st.readabilityScale + '), ' + st.readabilityLabel], ['Densità lessicale', Math.round(st.lexicalDensity * 100) + '%'],
        ['Lingua', r.lang === 'en' ? 'inglese' : 'italiano'], ['Tempo di analisi', r.elapsedMs + ' ms']].forEach(function (row) {
        dl.appendChild(el('dt', { text: row[0] })); dl.appendChild(el('dd', { text: String(row[1]) }));
      });
      stp.appendChild(dl);
      stp.appendChild(el('p', { class: 'wc-hint', text: st.readabilityScale === 'Gulpease' ? 'Indice Gulpease: sotto 40 è difficile anche per chi ha un diploma, sopra 80 è facile per tutti.' : 'Flesch Reading Ease: più alto è il punteggio, più il testo è facile.' }));
    }

    function paint() {
      var r = state.results;
      if (!r) return;
      var n = state.processed;
      var shown = { summary: 0, marks: 0, keywords: 0 };
      [['summary', '.wc-summary'], ['marks', '.wc-marks']].forEach(function (pair) {
        var list = tabPanels[pair[0]].querySelector(pair[1]);
        if (!list) return;
        var hidden = 0;
        Array.prototype.forEach.call(list.children, function (li) {
          var vis = state.done || +li.dataset.idx < n;
          li.hidden = !vis;
          if (vis) shown[pair[0]]++; else hidden++;
        });
        var pend = tabPanels[pair[0]].querySelector('.wc-pending');
        if (pend) pend.textContent = hidden ? 'Il ragno sta ancora leggendo: ' + hidden + ' in arrivo…' : '';
      });
      Array.prototype.forEach.call(tabPanels.keywords.querySelectorAll('.wc-kwi'), function (li) {
        var i = state.firstIdx.get(li.dataset.key);
        var vis = state.done || (i != null && i < n);
        li.classList.toggle('wc-off', !vis);
        if (vis) shown.keywords++;
      });
      tabBtns.summary.querySelector('.wc-count').textContent = String(shown.summary);
      tabBtns.marks.querySelector('.wc-count').textContent = String(state.done ? r.highlights.length : r.highlights.filter(function (h) { return h.idx < n; }).length);
      tabBtns.keywords.querySelector('.wc-count').textContent = String(shown.keywords);
      status.textContent = state.done
        ? 'Lettura completata: ' + r.stats.words.toLocaleString('it-IT') + ' parole, ' + r.summary.length + ' frasi nel sunto.'
        : 'Il ragno sta leggendo: ' + n.toLocaleString('it-IT') + ' di ' + state.total.toLocaleString('it-IT') + ' parole.';
      [saveBtn, exportSel, copyBtn].forEach(function (b) { b.disabled = !state.done; });
    }

    return {
      // tokens: l'elenco dei token, oppure { total, firstIdx: [[kid, indice], ...] } (estensione)
      show: function (results, doc, tokens) {
        state.results = results;
        state.doc = doc;
        state.processed = 0;
        state.done = false;
        state.filter = 'all';
        state.selected = new Set(results.highlights.map(function (h) { return h.id; }));
        state.firstIdx = new Map();
        if (Array.isArray(tokens)) {
          state.total = tokens.length;
          tokens.forEach(function (t, i) { if (t.kid && !state.firstIdx.has(t.kid)) state.firstIdx.set(t.kid, i); });
        } else if (tokens) {
          state.total = tokens.total;
          (tokens.firstIdx || []).forEach(function (p) { state.firstIdx.set(p[0], p[1]); });
        } else state.total = results.stats.words;
        // in Studio il primo pannello utile è "Evidenziate"
        build();
        select(results.mode === 'study' || results.mode === 'search' ? 'marks' : (results.mode === 'web' ? 'keywords' : 'summary'));
        paint();
      },
      progress: function (n) { state.processed = n; paint(); },
      done: function () { state.done = true; paint(); },
      clear: function () {
        state.results = null;
        Object.keys(tabPanels).forEach(function (k) { tabPanels[k].textContent = ''; });
        Object.keys(tabBtns).forEach(function (k) { tabBtns[k].querySelector('.wc-count').textContent = ''; });
        status.textContent = 'Apri un documento per cominciare.';
        [saveBtn, exportSel, copyBtn].forEach(function (b) { b.disabled = true; });
      },
      message: function (m) { status.textContent = m; }
    };
  }

  g.WCResultsUI = { render: render };
})(globalThis);
