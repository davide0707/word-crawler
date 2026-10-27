/*
 * Word Crawler: archivio delle letture salvate (sunti, sottolineature, parole chiave).
 * host: { list(): Promise<entries>, remove(id): Promise, saveFile(name, content, mime): Promise<boolean>, open?(entry) }
 */
(function (g) {
  'use strict';
  if (g.WCArchiveUI) return;
  var el = function (t, a, c) { return g.WCSettingsUI.el(t, a, c); };
  var X = g.WCExport;

  function render(container, host) {
    container.textContent = '';
    container.classList.add('wc-archive');
    var entries = [], current = null, query = '';

    var search = el('input', { type: 'search', id: 'wca-search', placeholder: 'Cerca per titolo, parola chiave o testo…', autocomplete: 'off' });
    var count = el('span', { class: 'wc-count' });
    var exportAll = el('button', { type: 'button', class: 'wc-btn', text: 'Esporta tutto (.json)' });
    var list = el('ul', { class: 'wca-list', 'aria-label': 'Letture salvate' });
    var detail = el('div', { class: 'wca-detail', tabindex: '-1' });
    container.appendChild(el('div', { class: 'wca-head' }, [
      el('div', {}, [el('h1', { text: 'Archivio' }), el('p', { class: 'wc-note', text: 'Le letture che hai salvato: sunto, sottolineature, parole chiave. Il documento originale non viene copiato.' })]),
      el('div', { class: 'wc-inline' }, [el('label', { for: 'wca-search', class: 'wc-label', text: 'Cerca' }), search, count, exportAll])
    ]));
    container.appendChild(el('div', { class: 'wca-body' }, [list, detail]));

    function fmtDate(iso) { try { return new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; } }
    function matches(e) {
      if (!query) return true;
      var hay = [e.title, e.source, (e.keywords || []).map(function (k) { return k.word; }).join(' '), (e.summary || []).map(function (s) { return s.text; }).join(' '),
        (e.highlights || []).map(function (h) { return h.text; }).join(' ')].join(' ').toLowerCase();
      return query.toLowerCase().split(/\s+/).every(function (q) { return hay.indexOf(q) >= 0; });
    }
    function paintList() {
      list.textContent = '';
      var shown = entries.filter(matches);
      count.textContent = shown.length + (shown.length === 1 ? ' lettura' : ' letture');
      if (!entries.length) {
        list.appendChild(el('li', { class: 'wca-empty' }, [el('p', { text: 'Ancora niente. Quando il ragno ha finito di leggere, premi “Salva in archivio” nel pannello dei risultati.' })]));
        detail.textContent = '';
        return;
      }
      shown.forEach(function (e) {
        var b = el('button', { type: 'button', class: 'wca-item' + (current && current.id === e.id ? ' on' : '') }, [
          el('span', { class: 'wca-title', text: e.title }),
          el('span', { class: 'wca-meta', text: [X.MODE[e.mode] || e.mode, e.format, fmtDate(e.date)].filter(Boolean).join(' · ') }),
          el('span', { class: 'wca-kw', text: (e.keywords || []).slice(0, 6).map(function (k) { return k.word; }).join(' · ') })
        ]);
        b.addEventListener('click', function () { current = e; paintList(); paintDetail(); detail.focus(); });
        list.appendChild(el('li', {}, [b]));
      });
    }
    function section(title, items, render) {
      if (!items || !items.length) return null;
      var box = el('section', { class: 'wca-sec' }, [el('h2', { text: title })]);
      box.appendChild(render(items));
      return box;
    }
    function paintDetail() {
      detail.textContent = '';
      var e = current;
      if (!e) { detail.appendChild(el('p', { class: 'wc-note', text: 'Scegli una lettura dall’elenco.' })); return; }
      var exportSel = el('select', { 'aria-label': 'Esporta questa lettura' }, [el('option', { value: '', text: 'Esporta…' })].concat(
        X.KINDS.filter(function (k) { return !k[2] && (k[0] !== 'anki' || (e.cards && e.cards.length)); }).map(function (k) { return el('option', { value: k[0], text: k[1] }); })));
      var delBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Elimina' });
      var confirmBox = el('div', { class: 'wca-confirm', hidden: 'hidden' }, [el('span', { text: 'Eliminare questa lettura dall’archivio? Non si può annullare.' })]);
      var yes = el('button', { type: 'button', class: 'wc-btn wc-danger', text: 'Sì, elimina' });
      var no = el('button', { type: 'button', class: 'wc-btn', text: 'Annulla' });
      confirmBox.appendChild(yes); confirmBox.appendChild(no);
      var note = el('p', { class: 'wc-note', role: 'status' });
      var actions = [exportSel, delBtn];
      if (host.open && /^https?:/.test(e.source || '')) {
        var openBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Apri la fonte' });
        openBtn.addEventListener('click', function () { host.open(e); });
        actions.unshift(openBtn);
      }
      detail.appendChild(el('header', { class: 'wca-dhead' }, [
        el('p', { class: 'wc-doc-kind', text: [X.MODE[e.mode] || e.mode, e.format].filter(Boolean).join(' · ') }),
        el('h2', { class: 'wca-dtitle', text: e.title }),
        el('p', { class: 'wc-note', text: [fmtDate(e.date), e.source].filter(Boolean).join(' · ') }),
        el('div', { class: 'wc-inline' }, actions), confirmBox, note
      ]));
      var kw = section('Parole chiave', e.keywords, function (items) {
        var ul = el('ul', { class: 'wc-kw' });
        items.forEach(function (k) { ul.appendChild(el('li', { class: 'wc-kwi' + (k.name ? ' wc-name' : '') }, [el('span', { text: k.word }), el('span', { class: 'wc-count', text: String(k.count) })])); });
        return ul;
      });
      var sum = section('Sunto', e.summary, function (items) {
        var ol = el('ol', { class: 'wca-sum' });
        items.forEach(function (s) { ol.appendChild(el('li', { text: s.text + (s.page != null ? ' (p. ' + (s.page + 1) + ')' : '') })); });
        return ol;
      });
      var groups = {};
      (e.highlights || []).forEach(function (h) { (groups[h.type] = groups[h.type] || []).push(h); });
      var parts = [kw, sum];
      [['def', 'Definizioni'], ['key', 'Frasi sottolineate'], ['term', 'Trovate'], ['name', 'Nomi e concetti cerchiati'], ['num', 'Numeri e date']].forEach(function (p) {
        parts.push(section(p[1], groups[p[0]], function (items) {
          if (p[0] === 'name' || p[0] === 'num') return el('p', { class: 'wca-inline-list', text: items.map(function (h) { return h.text; }).join(' · ') });
          var ul = el('ul', { class: 'wca-hl wc-t-' + p[0] });
          items.forEach(function (h) { ul.appendChild(el('li', { text: h.text + (h.page != null ? ' (p. ' + (h.page + 1) + ')' : '') })); });
          return ul;
        }));
      });
      parts.push(section('I tuoi segni', e.userMarks, function (items) {
        var ul = el('ul', { class: 'wca-hl wc-t-unote' });
        items.forEach(function (m) { ul.appendChild(el('li', { text: (X.USER[m.type] || m.type) + ': «' + m.text + '»' + (m.note ? ' — ' + m.note : '') + (m.page != null ? ' (p. ' + (m.page + 1) + ')' : '') })); });
        return ul;
      }));
      parts.push(section('Schede di ripasso', e.cards, function (items) {
        var ul = el('ul', { class: 'wca-hl wc-t-def' });
        items.forEach(function (c) { ul.appendChild(el('li', {}, [el('strong', { text: c.front }), el('br'), el('span', { text: c.back })])); });
        return ul;
      }));
      parts.push(section('Statistiche', X.statsLines(e.stats), function (items) {
        var ul = el('ul', { class: 'wca-stats' });
        items.forEach(function (l) { ul.appendChild(el('li', { text: l })); });
        return ul;
      }));
      parts.forEach(function (p) { if (p) detail.appendChild(p); });

      exportSel.addEventListener('change', function () {
        var k = exportSel.value; exportSel.value = '';
        if (!k) return;
        var f = X.build(k, e);
        Promise.resolve(host.saveFile(f.name, f.content, f.mime)).then(function (ok) { if (ok !== false) note.textContent = 'Esportato.'; });
      });
      delBtn.addEventListener('click', function () { confirmBox.hidden = false; yes.focus(); });
      no.addEventListener('click', function () { confirmBox.hidden = true; delBtn.focus(); });
      yes.addEventListener('click', function () {
        Promise.resolve(host.remove(e.id)).then(function () { current = null; refresh(); });
      });
    }
    function refresh() {
      return Promise.resolve(host.list()).then(function (items) {
        entries = (items || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
        if (current) current = entries.find(function (x) { return x.id === current.id; }) || null;
        if (!current && entries.length) current = entries[0];
        paintList(); paintDetail();
      });
    }
    search.addEventListener('input', function () { query = search.value.trim(); paintList(); });
    exportAll.addEventListener('click', function () {
      host.saveFile('archivio - Word Crawler.json', JSON.stringify({ exportedAt: new Date().toISOString(), entries: entries }, null, 2), 'application/json');
    });
    refresh();
    return { refresh: refresh };
  }

  g.WCArchiveUI = { render: render };
})(globalThis);
