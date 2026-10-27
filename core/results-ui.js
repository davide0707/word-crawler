/*
 * Word Crawler: pannello dei risultati.
 * Mostra sunto, evidenziazioni (anche quelle fatte a mano), parole chiave, schede di ripasso e statistiche
 * man mano che il ragno legge; permette di scegliere cosa tenere e di salvarlo o esportarlo.
 */
(function (g) {
  'use strict';
  if (g.WCResultsUI) return;
  var el = function (tag, attrs, children) { return g.WCSettingsUI.el(tag, attrs, children); };
  var X = g.WCExport;

  var BADGE = { key: 'Frase chiave', def: 'Definizione', name: 'Nome', num: 'Numero', term: 'Trovata' };
  var UBADGE = { hl: 'Evidenziato', under: 'Sottolineato', note: 'Nota' };
  var READ_HINT = {
    'Gulpease': 'Indice Gulpease (italiano): sotto 40 è difficile anche per chi ha un diploma, sopra 80 è facile per tutti.',
    'Flesch': 'Flesch Reading Ease (inglese): più alto è il punteggio, più il testo è facile.',
    'Kandel-Moles': 'Indice di Kandel e Moles (francese), adattamento di Flesch: più alto è, più il testo è facile.',
    'Szigriszt-Pazos': 'Indice di Szigriszt-Pazos (spagnolo, scala INFLESZ): sotto 40 molto difficile, sopra 80 molto facile.',
    'Amstad': 'Indice di Amstad (tedesco), adattamento di Flesch: più alto è, più il testo è facile.',
    'Flesch (Martins)': 'Flesch adattato al portoghese da Martins e colleghi: più alto è, più il testo è facile.'
  };

  /*
   * opts: {
   *   onJump(idx), onSave(entry), onExport(kind, entry), onCopy(text), idPrefix,
   *   exports?: codici dei formati da offrire (vedi WCExport.KINDS),
   *   onRemoveMark?(id), onEditMark?(id)   segni fatti a mano
   * }
   */
  function render(container, opts) {
    var P = opts.idPrefix || 'wcr';
    container.textContent = '';
    container.classList.add('wc-results');
    var state = { results: null, doc: null, processed: 0, total: 0, selected: new Set(), filter: 'all', firstIdx: new Map(), done: false, tab: 'summary', user: [], cardMode: 'cards', quiz: null };

    var status = el('p', { class: 'wc-status', role: 'status', text: 'Apri un documento per cominciare.' });
    var tabs = el('div', { class: 'wc-tabs', role: 'tablist' });
    var panels = el('div', { class: 'wc-panels' });
    var TABS = [['summary', 'Sunto'], ['marks', 'Evidenziate'], ['keywords', 'Parole chiave'], ['cards', 'Ripasso'], ['stats', 'Statistiche']];
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
    var kinds = opts.exports || ['md', 'txt', 'html', 'anki', 'docx', 'ahtml', 'json'];
    var exportSel = el('select', { id: P + '-export', 'aria-label': 'Esporta', disabled: 'disabled' },
      [el('option', { value: '', text: 'Esporta…' })].concat(X.KINDS.filter(function (k) { return kinds.indexOf(k[0]) >= 0; }).map(function (k) { return el('option', { value: k[0], text: k[1] }); })));
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

    // evidenziazioni scelte, per ritrovarle sulla pagina (estensione)
    function keepList() {
      return state.results.highlights.filter(function (h) { return state.selected.has(h.id); }).map(function (h) { return h.type + ':' + h.text; });
    }
    function currentEntry() {
      return X.entry(state.doc || {}, state.results, state.selected, { userMarks: state.user, keep: keepList() });
    }
    function flash(msg) { note.textContent = msg; clearTimeout(flash.t); flash.t = setTimeout(function () { note.textContent = ''; }, 5000); }
    saveBtn.addEventListener('click', function () {
      if (!state.results || !opts.onSave) return;
      Promise.resolve(opts.onSave(currentEntry())).then(function (ok) { flash(ok === false ? 'Non sono riuscito a salvare.' : 'Salvato nell’archivio.'); });
    });
    exportSel.addEventListener('change', function () {
      var k = exportSel.value;
      exportSel.value = '';
      if (!k || !state.results || !opts.onExport) return;
      flash('Preparo il file…');
      Promise.resolve(opts.onExport(k, currentEntry())).then(function (ok) { flash(ok === false ? 'Esportazione annullata.' : 'Esportato.'); },
        function (e) { flash('Non sono riuscito a esportare: ' + (e && e.message || e)); });
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

    // ------------------------------------------------------------ segni fatti a mano
    var userBox = el('div', { class: 'wc-user' });
    function buildUser() {
      userBox.textContent = '';
      if (!state.user.length) return;
      userBox.appendChild(el('h3', { class: 'wc-subhead', text: 'I tuoi segni (' + state.user.length + ')' }));
      var ul = el('ul', { class: 'wc-list wc-umarks' });
      state.user.slice().sort(function (a, b) { return a.from - b.from; }).forEach(function (m) {
        var badge = el('span', { class: 'wc-badge wc-b-u' + m.type, text: (m.type === 'note' && m.n ? m.n + ' · ' : '') + UBADGE[m.type] });
        var del = el('button', { type: 'button', class: 'wc-x', 'aria-label': 'Togli questo segno', title: 'Togli', text: '×' });
        del.addEventListener('click', function () { if (opts.onRemoveMark) opts.onRemoveMark(m.id); });
        var side = el('span', { class: 'wc-item-side' }, [badge, del]);
        var li = item(m.text, [m.note ? '“' + m.note + '”' : '', pageMeta(m.page)].filter(Boolean).join(' · '), m.from, side);
        li.classList.add('wc-t-u' + m.type);
        if (m.type === 'note' && opts.onEditMark) {
          var ed = el('button', { type: 'button', class: 'wc-link wc-edit', text: 'Modifica la nota' });
          ed.addEventListener('click', function (ev) { opts.onEditMark(m.id, ev.clientX, ev.clientY); });
          li.appendChild(ed);
        }
        ul.appendChild(li);
      });
      userBox.appendChild(ul);
    }

    // ------------------------------------------------------------ ripasso
    function shuffleCards(list) {
      var a = list.slice();
      for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    }
    function buildCards() {
      var cp = tabPanels.cards, r = state.results;
      cp.textContent = '';
      var cards = r.cards || [];
      if (!cards.length) {
        cp.appendChild(el('p', { class: 'wc-hint', text: 'Nessuna scheda: nel testo non ho trovato definizioni né frasi chiave con un concetto da ricordare.' }));
        return;
      }
      var quizCards = cards.filter(function (c) { return c.choices; });
      var bCards = el('button', { type: 'button', class: 'wc-chip', 'aria-pressed': state.cardMode === 'cards' ? 'true' : 'false', text: 'Schede (' + cards.length + ')' });
      var bQuiz = el('button', { type: 'button', class: 'wc-chip', 'aria-pressed': state.cardMode === 'quiz' ? 'true' : 'false', text: 'Quiz (' + quizCards.length + ')' });
      if (!quizCards.length) bQuiz.disabled = true;
      bCards.addEventListener('click', function () { state.cardMode = 'cards'; buildCards(); paint(); });
      bQuiz.addEventListener('click', function () { state.cardMode = 'quiz'; state.quiz = null; buildCards(); paint(); });
      cp.appendChild(el('div', { class: 'wc-chips wc-cardmode', role: 'group', 'aria-label': 'Modo di ripasso' }, [bCards, bQuiz]));

      if (state.cardMode === 'cards') {
        cp.appendChild(el('p', { class: 'wc-hint', text: 'Prova a rispondere, poi tocca la scheda per vedere la risposta. Le schede si esportano anche per Anki.' }));
        var ul = el('ul', { class: 'wc-list wc-cards' });
        cards.forEach(function (c) {
          var li = el('li', { class: 'wc-card' });
          li.dataset.idx = c.idx;
          var front = el('p', { class: 'wc-card-front', text: c.front });
          var back = el('p', { class: 'wc-card-back', text: c.back, hidden: 'hidden' });
          var flip = el('button', { type: 'button', class: 'wc-link', text: 'Mostra la risposta', 'aria-expanded': 'false' });
          flip.addEventListener('click', function () {
            var open = back.hidden;
            back.hidden = !open;
            flip.textContent = open ? 'Nascondi la risposta' : 'Mostra la risposta';
            flip.setAttribute('aria-expanded', open ? 'true' : 'false');
          });
          var go = el('button', { type: 'button', class: 'wc-link', text: 'Nel testo' + (c.page != null ? ' (p. ' + (c.page + 1) + ')' : '') });
          go.addEventListener('click', function () { if (opts.onJump) opts.onJump(c.idx); });
          li.appendChild(el('span', { class: 'wc-badge wc-b-' + (c.type === 'def' ? 'def' : 'key'), text: c.type === 'def' ? 'Definizione' : 'Completa' }));
          li.appendChild(front); li.appendChild(back);
          li.appendChild(el('div', { class: 'wc-inline' }, [flip, go]));
          ul.appendChild(li);
        });
        cp.appendChild(ul);
        cp.appendChild(el('p', { class: 'wc-pending' }));
        return;
      }

      // quiz: una domanda alla volta, 4 risposte
      if (!state.quiz) state.quiz = { list: shuffleCards(quizCards).slice(0, 15), i: 0, ok: 0, answered: false };
      var q = state.quiz;
      var box = el('div', { class: 'wc-quiz', 'aria-live': 'polite' });
      if (q.i >= q.list.length) {
        box.appendChild(el('p', { class: 'wc-quiz-score', text: 'Risposte giuste: ' + q.ok + ' su ' + q.list.length }));
        box.appendChild(el('p', { class: 'wc-hint', text: q.ok === q.list.length ? 'Perfetto.' : 'Ripassa le schede sbagliate e riprova.' }));
        var again = el('button', { type: 'button', class: 'wc-btn wc-primary', text: 'Ricomincia' });
        again.addEventListener('click', function () { state.quiz = null; buildCards(); });
        box.appendChild(again);
        cp.appendChild(box);
        return;
      }
      var c = q.list[q.i];
      box.appendChild(el('p', { class: 'wc-quiz-n', text: 'Domanda ' + (q.i + 1) + ' di ' + q.list.length }));
      box.appendChild(el('p', { class: 'wc-quiz-q', text: c.cloze }));
      var choices = el('div', { class: 'wc-quiz-choices', role: 'group', 'aria-label': 'Risposte' });
      var feedback = el('p', { class: 'wc-quiz-fb' });
      var next = el('button', { type: 'button', class: 'wc-btn wc-primary', text: q.i + 1 < q.list.length ? 'Avanti' : 'Vedi il risultato', hidden: 'hidden' });
      c.choices.forEach(function (ch, k) {
        var b = el('button', { type: 'button', class: 'wc-choice', text: ch });
        b.addEventListener('click', function () {
          if (q.answered) return;
          q.answered = true;
          var right = k === c.correct;
          if (right) q.ok++;
          Array.prototype.forEach.call(choices.children, function (x, j) {
            x.disabled = true;
            if (j === c.correct) x.classList.add('wc-right');
            else if (j === k) x.classList.add('wc-wrong');
          });
          feedback.textContent = (right ? 'Giusto. ' : 'No: era «' + c.choices[c.correct] + '». ') + (c.type === 'def' ? c.back : '');
          next.hidden = false;
          next.focus();
        });
        choices.appendChild(b);
      });
      next.addEventListener('click', function () { q.i++; q.answered = false; buildCards(); });
      box.appendChild(choices); box.appendChild(feedback); box.appendChild(next);
      cp.appendChild(box);
    }

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
      mp.appendChild(userBox);
      buildUser();
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

      // ripasso
      state.quiz = null;
      buildCards();

      // statistiche
      var stp = tabPanels.stats;
      stp.textContent = '';
      var st = r.stats;
      var dl = el('dl', { class: 'wc-stats' });
      [['Parole', st.words.toLocaleString('it-IT')], ['Parole diverse', st.uniqueWords.toLocaleString('it-IT')], ['Frasi', st.sentences], ['Paragrafi', st.paragraphs],
        ['Parole per frase', st.avgSentenceWords], ['Tempo di lettura', 'circa ' + st.readingMinutes + ' min'],
        ['Leggibilità', st.readability + '/100 (' + st.readabilityScale + '), ' + st.readabilityLabel], ['Densità lessicale', Math.round(st.lexicalDensity * 100) + '%'],
        ['Lingua', r.langName || r.lang], ['Rarità delle parole', r.frequencies ? 'usata (frequenze della lingua)' : 'non disponibile'],
        ['Schede di ripasso', (r.cards || []).length], ['Tempo di analisi', r.elapsedMs + ' ms']].forEach(function (row) {
        dl.appendChild(el('dt', { text: row[0] })); dl.appendChild(el('dd', { text: String(row[1]) }));
      });
      stp.appendChild(dl);
      stp.appendChild(el('p', { class: 'wc-hint', text: READ_HINT[st.readabilityScale] || 'Più alto è il punteggio, più il testo è facile.' }));
    }

    function paint() {
      var r = state.results;
      if (!r) return;
      var n = state.processed;
      var shown = { summary: 0, marks: 0, keywords: 0, cards: 0 };
      [['summary', '.wc-summary'], ['marks', '.wc-marks'], ['cards', '.wc-cards']].forEach(function (pair) {
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
      var cards = r.cards || [];
      tabBtns.summary.querySelector('.wc-count').textContent = String(shown.summary);
      tabBtns.marks.querySelector('.wc-count').textContent = String(state.user.length + (state.done ? r.highlights.length : r.highlights.filter(function (h) { return h.idx < n; }).length));
      tabBtns.keywords.querySelector('.wc-count').textContent = String(shown.keywords);
      tabBtns.cards.querySelector('.wc-count').textContent = String(state.done ? cards.length : cards.filter(function (c) { return c.idx < n; }).length);
      status.textContent = state.done
        ? 'Lettura completata: ' + r.stats.words.toLocaleString('it-IT') + ' parole, ' + r.summary.length + ' frasi nel sunto, ' + cards.length + ' schede.'
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
        build();
        // in Studio il primo pannello utile è "Evidenziate"
        select(results.mode === 'study' || results.mode === 'search' ? 'marks' : (results.mode === 'web' ? 'keywords' : 'summary'));
        paint();
      },
      progress: function (n) { state.processed = n; paint(); },
      done: function () { state.done = true; paint(); },
      setUserMarks: function (list) {
        state.user = (list || []).slice();
        if (state.results) { buildUser(); paint(); }
      },
      select: select,
      clear: function () {
        state.results = null;
        state.user = [];
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
