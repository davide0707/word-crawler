// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: la Libreria (app desktop).
 * Tanti documenti in una base di conoscenza locale: importazione (anche di cartelle intere), ricerca su
 * tutti i documenti con la fonte esatta, mappa interattiva dei concetti e scheda di ogni concetto.
 * I documenti originali si leggono soltanto: l'app salva i risultati nella sua cartella dati.
 *
 * WCLibraryView.mount(root, host) -> { refresh(), addFiles(), addFolder(), resize(), state() }
 * host: {
 *   lib: { addFiles, addFolder, read, list, save, remove, restore, stat, loadEdits, saveEdits },
 *   importer: WCLibImport.create(...),
 *   workerUrl: indirizzo di core/library-worker.js,
 *   openAt(path, name, focus): apre il documento nel Lettore alla posizione del passaggio,
 *   saveFile(name, content, mime), readerSettings(): Promise<impostazioni del Lettore>
 * }
 */
(function (g) {
  'use strict';
  if (g.WCLibraryView) return;
  var el = function (t, a, c) { return g.WCSettingsUI.el(t, a, c); };

  // ---------------------------------------------------------------- thread separato
  function rpc(url) {
    var w = new Worker(url), seq = 0, waiting = new Map();
    w.onmessage = function (e) {
      var d = e.data || {}, p = waiting.get(d.id);
      if (!p) return;
      waiting.delete(d.id);
      if (d.error) p.reject(new Error(d.error)); else p.resolve(d.result);
    };
    w.onerror = function (e) { waiting.forEach(function (p) { p.reject(new Error(e.message || 'thread non disponibile')); }); waiting.clear(); };
    return {
      call: function (type, payload) {
        return new Promise(function (resolve, reject) {
          var id = ++seq;
          waiting.set(id, { resolve: resolve, reject: reject });
          w.postMessage(Object.assign({ id: id, type: type }, payload || {}));
        });
      },
      terminate: function () { w.terminate(); }
    };
  }

  function fmtSize(n) {
    if (!n) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB'], i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0).replace('.', ',') + ' ' + u[i];
  }
  function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
  function plural(n, one, many) { return n.toLocaleString('it-IT') + ' ' + (n === 1 ? one : many); }
  var KIND = { pdf: 'PDF', docx: 'Word', docm: 'Word', dotx: 'Word', doc: 'Word', odt: 'ODT', ott: 'ODT', odp: 'Slide', pptx: 'Slide', pptm: 'Slide', ppsx: 'Slide',
    ods: 'Foglio', xlsx: 'Foglio', xlsm: 'Foglio', epub: 'EPUB', rtf: 'RTF', html: 'HTML', htm: 'HTML', xhtml: 'HTML', md: 'Markdown', markdown: 'Markdown',
    txt: 'Testo', srt: 'Sottotitoli', vtt: 'Sottotitoli', csv: 'CSV', tsv: 'CSV', png: 'Immagine', jpg: 'Immagine', jpeg: 'Immagine', webp: 'Immagine', bmp: 'Immagine', gif: 'Immagine' };

  // testo con le parti trovate evidenziate (senza innerHTML)
  function marked(text, marks) {
    var span = el('span'), at = 0;
    (marks || []).forEach(function (m) {
      if (m[0] < at) return;
      if (m[0] > at) span.appendChild(document.createTextNode(text.slice(at, m[0])));
      span.appendChild(el('mark', { text: text.slice(m[0], m[1]) }));
      at = m[1];
    });
    if (at < text.length) span.appendChild(document.createTextNode(text.slice(at)));
    return span;
  }

  function mount(root, host) {
    var lib = host.lib;
    var kb = rpc(host.workerUrl), proc = rpc(host.workerUrl);
    var docs = [], docById = new Map(), changed = new Map(), graph = null, edits = null;
    var queue = [], importing = false, cancelImport = false, importLog = [];
    var view = 'results', selected = null, lastSearch = null;
    var filters = { doc: '', lang: '' };

    // ------------------------------------------------------------ struttura
    root.textContent = '';
    root.classList.add('lb');
    var addFilesBtn = el('button', { type: 'button', class: 'wc-btn wc-primary wc-wide', text: 'Aggiungi documenti' });
    var addFolderBtn = el('button', { type: 'button', class: 'wc-btn wc-wide', text: 'Aggiungi una cartella' });
    var impBox = el('div', { class: 'lb-import', hidden: 'hidden', 'aria-live': 'polite' });
    var impTitle = el('p', { class: 'lb-import-title' });
    var impFile = el('p', { class: 'lb-import-file' });
    var impBar = el('div', { class: 'wc-progress', role: 'progressbar', 'aria-label': 'Importazione', 'aria-valuemin': '0', 'aria-valuemax': '100' }, [el('span')]);
    var impStop = el('button', { type: 'button', class: 'wc-link', text: 'Interrompi' });
    impBox.appendChild(impTitle); impBox.appendChild(impFile); impBox.appendChild(impBar); impBox.appendChild(impStop);
    var impLogBox = el('details', { class: 'lb-log', hidden: 'hidden' });
    var docFilter = el('input', { type: 'search', placeholder: 'Filtra per nome…', 'aria-label': 'Filtra i documenti per nome' });
    var docCount = el('h2', { text: 'Documenti' });
    var refreshBtn = el('button', { type: 'button', class: 'wc-link', hidden: 'hidden' });
    var docList = el('ul', { class: 'lb-docs', 'aria-label': 'Documenti della libreria' });
    var left = el('aside', { class: 'wc-side wc-left', 'aria-label': 'Documenti della libreria' }, [
      el('section', {}, [el('h2', { text: 'Libreria' }), addFilesBtn, addFolderBtn,
        el('p', { class: 'wc-note', text: 'I file vengono solo letti: non sono modificati né spostati. Testo, concetti e fonti restano nella cartella dati dell’app, sul tuo computer.' }),
        impBox, impLogBox]),
      el('section', { class: 'lb-docsec' }, [docCount, docFilter, refreshBtn, docList])
    ]);

    var qInput = el('input', { type: 'search', class: 'lb-q', placeholder: 'Cerca in tutti i documenti: una parola, un concetto, "una frase esatta"…', 'aria-label': 'Cerca nella libreria', autocomplete: 'off', spellcheck: 'false' });
    var qBtn = el('button', { type: 'submit', class: 'wc-btn wc-primary', text: 'Cerca' });
    var docSel = el('select', { 'aria-label': 'Cerca in' });
    var langSel = el('select', { 'aria-label': 'Lingua' });
    var qForm = el('form', { class: 'lb-search', role: 'search' }, [qInput, qBtn]);
    var tabResults = el('button', { type: 'button', role: 'tab', class: 'wc-tab', 'aria-selected': 'true', text: 'Risultati' });
    var tabMap = el('button', { type: 'button', role: 'tab', class: 'wc-tab', 'aria-selected': 'false', text: 'Mappa dei concetti' });
    var bar = el('div', { class: 'lb-bar' }, [el('div', { class: 'wc-tabs lb-tabs', role: 'tablist' }, [tabResults, tabMap]), el('div', { class: 'lb-filters' }, [docSel, langSel])]);
    var resultsBox = el('div', { class: 'lb-results', 'aria-live': 'polite' });
    var mapFind = el('input', { type: 'search', placeholder: 'Trova un concetto sulla mappa…', 'aria-label': 'Trova un concetto sulla mappa', list: 'lb-labels' });
    var labelList = el('datalist', { id: 'lb-labels' });
    var onlyCentral = el('input', { type: 'checkbox', id: 'lb-central' });
    var onlyMulti = el('input', { type: 'checkbox', id: 'lb-multi' });
    var exportSel = el('select', { 'aria-label': 'Esporta la mappa' }, [
      el('option', { value: '', text: 'Esporta…' }), el('option', { value: 'png', text: 'Immagine (.png)' }),
      el('option', { value: 'md', text: 'Note Markdown (.md)' }), el('option', { value: 'json', text: 'Dati (.json)' })]);
    var suggBtn = el('button', { type: 'button', class: 'wc-btn lb-sugg-btn', hidden: 'hidden' });
    var fitBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Inquadra', title: 'Mostra tutta la mappa (tasto 0)' });
    var mapTools = el('div', { class: 'lb-maptools' }, [mapFind, labelList,
      el('label', { class: 'wc-check', for: 'lb-central' }, [onlyCentral, el('span', { text: 'Solo concetti centrali' })]),
      el('label', { class: 'wc-check', for: 'lb-multi' }, [onlyMulti, el('span', { text: 'Solo in più documenti' })]),
      fitBtn, suggBtn, exportSel]);
    var canvas = el('canvas', { class: 'lb-canvas', tabindex: '0', 'aria-label': 'Mappa dei concetti: trascina per spostarti, rotella per ingrandire, clic su un concetto per aprirlo' });
    var tip = el('div', { class: 'lb-tip', hidden: 'hidden' });
    var legend = el('div', { class: 'lb-legend' }, [
      el('span', {}, [el('i', { class: 'lb-dot central' }), document.createTextNode('centrale')]),
      el('span', {}, [el('i', { class: 'lb-dot multi' }), document.createTextNode('in più documenti')]),
      el('span', {}, [el('i', { class: 'lb-dot' }), document.createTextNode('in un documento')]),
      el('span', {}, [el('i', { class: 'lb-line isa' }), document.createTextNode('è un tipo di')]),
      el('span', {}, [el('i', { class: 'lb-line def' }), document.createTextNode('nella definizione')]),
      el('span', {}, [el('i', { class: 'lb-line user' }), document.createTextNode('tuo collegamento')])]);
    var stage = el('div', { class: 'lb-stage' }, [canvas, tip, legend]);
    var mapBox = el('div', { class: 'lb-map', hidden: 'hidden' }, [mapTools, stage]);
    var emptyBox = el('div', { class: 'lb-empty', hidden: 'hidden' }, [
      el('div', { class: 'wc-empty-mark', 'aria-hidden': 'true' }),
      el('h1', { text: 'La tua libreria è vuota' }),
      el('p', { text: 'Aggiungi dispense, slide, libri, appunti o una cartella intera. Il ragno li legge tutti, divide il testo in passaggi, riconosce i concetti e li collega tra un documento e l’altro.' }),
      el('p', { class: 'wc-note', text: 'Poi puoi cercare in tutti i documenti insieme, vedere la mappa dei concetti e aprire ogni risultato alla pagina giusta. Senza intelligenza artificiale e senza internet.' })]);
    var main = el('main', { class: 'lb-main' }, [qForm, bar, emptyBox, resultsBox, mapBox]);
    var panel = el('div', { class: 'lb-panel' });
    var right = el('aside', { class: 'wc-side wc-right lb-right', 'aria-label': 'Dettagli' }, [panel]);
    root.appendChild(left); root.appendChild(main); root.appendChild(right);

    // ------------------------------------------------------------ documenti
    function docMeta(r) {
      var o = {};
      ['id', 'path', 'name', 'ext', 'size', 'mtime', 'created', 'hash', 'imported', 'format', 'title', 'lang', 'langName', 'pages', 'ocrPages', 'words', 'warnings', 'status', 'error', 'summary', 'keywords', 'v']
        .forEach(function (k) { o[k] = r[k]; });
      o.chunks = Array.isArray(r.chunks) ? r.chunks.length : r.chunks || 0;
      o.concepts = Array.isArray(r.concepts) ? r.concepts.length : r.concepts || 0;
      return o;
    }
    function setDoc(r) {
      var m = docMeta(r);
      if (docById.has(m.id)) docs[docs.indexOf(docById.get(m.id))] = m; else docs.push(m);
      docById.set(m.id, m);
    }
    function renderDocs() {
      var f = g.WCText.fold(docFilter.value.trim());
      var list = docs.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'it'); })
        .filter(function (d) { return !f || g.WCText.fold(d.name + ' ' + (d.title || '')).indexOf(f) >= 0; });
      docCount.textContent = 'Documenti (' + docs.length + ')';
      docList.textContent = '';
      if (!list.length) docList.appendChild(el('li', { class: 'wc-note', text: docs.length ? 'Nessun documento con questo nome.' : 'Ancora nessun documento.' }));
      list.forEach(function (d) {
        var info = [KIND[d.ext] || d.format || d.ext.toUpperCase()];
        if (d.pages) info.push(d.ext === 'pdf' ? plural(d.pages, 'pagina', 'pagine') : plural(d.pages, 'slide', 'slide'));
        if (d.lang && d.status !== 'error') info.push(d.lang);
        if (d.chunks) info.push(plural(d.chunks, 'passaggio', 'passaggi'));
        var badges = el('span', { class: 'lb-badges' });
        if (d.status === 'error') badges.appendChild(el('span', { class: 'lb-badge err', text: 'errore', title: d.error || '' }));
        if (d.status === 'partial') badges.appendChild(el('span', { class: 'lb-badge warn', text: 'parziale', title: (d.warnings || []).join(' ') }));
        if (d.ocrPages) badges.appendChild(el('span', { class: 'lb-badge', text: 'OCR' }));
        var ch = changed.get(d.id);
        if (ch === 'missing') badges.appendChild(el('span', { class: 'lb-badge err', text: 'file sparito' }));
        else if (ch === 'modified') badges.appendChild(el('span', { class: 'lb-badge warn', text: 'modificato' }));
        var openB = el('button', { type: 'button', class: 'wc-link', text: 'Apri' });
        var onlyB = el('button', { type: 'button', class: 'wc-link', text: 'Cerca qui' });
        var reB = el('button', { type: 'button', class: 'wc-link', text: 'Rileggi' });
        var rmB = el('button', { type: 'button', class: 'wc-link', text: 'Togli' });
        openB.addEventListener('click', function () { host.openAt(d.path, d.name, null); });
        onlyB.addEventListener('click', function () { docSel.value = d.id; filters.doc = d.id; showDoc(d); qInput.focus(); if (qInput.value.trim()) search(); });
        reB.addEventListener('click', function () { enqueue([{ path: d.path, id: d.id, name: d.name, ext: d.ext, size: d.size, mtime: d.mtime, force: true }]); });
        rmB.addEventListener('click', function () { removeDoc(d); });
        if (ch === 'missing') { openB.disabled = true; reB.disabled = true; }
        var li = el('li', { class: 'lb-doc' + (filters.doc === d.id ? ' on' : '') }, [
          el('button', { type: 'button', class: 'lb-doc-name', text: d.name, title: d.path }),
          el('p', { class: 'lb-doc-info', text: info.join(' · ') }), badges,
          el('div', { class: 'lb-doc-actions' }, [openB, onlyB, reB, rmB])]);
        li.querySelector('.lb-doc-name').addEventListener('click', function () { showDoc(d); });
        docList.appendChild(li);
      });
      var nChanged = Array.from(changed.values()).filter(function (v) { return v === 'modified'; }).length;
      refreshBtn.hidden = !nChanged;
      refreshBtn.textContent = 'Rileggi i file modificati (' + nChanged + ')';
      // filtri di ricerca
      var cur = docSel.value;
      docSel.textContent = '';
      docSel.appendChild(el('option', { value: '', text: 'In tutti i documenti' }));
      docs.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'it'); }).forEach(function (d) { docSel.appendChild(el('option', { value: d.id, text: d.name })); });
      docSel.value = docById.has(cur) ? cur : '';
      filters.doc = docSel.value;
      var langs = Array.from(new Set(docs.map(function (d) { return d.lang; }).filter(Boolean))).sort();
      var curL = langSel.value;
      langSel.textContent = '';
      langSel.appendChild(el('option', { value: '', text: 'Tutte le lingue' }));
      var names = g.WCLang.names();
      langs.forEach(function (l) { langSel.appendChild(el('option', { value: l, text: names[l] || l })); });
      langSel.value = langs.indexOf(curL) >= 0 ? curL : '';
      langSel.hidden = langs.length < 2;
      emptyBox.hidden = docs.length > 0 || importing;
      if (!docs.length) { resultsBox.hidden = true; mapBox.hidden = true; } else showView(view, true);
    }

    function checkChanged() {
      var paths = docs.map(function (d) { return d.path; });
      if (!paths.length) return Promise.resolve();
      return lib.stat(paths).then(function (list) {
        changed.clear();
        list.forEach(function (s) {
          var d = docs.find(function (x) { return x.path === s.path; });
          if (!d) return;
          if (!s.exists) changed.set(d.id, 'missing');
          else if (s.size !== d.size || (d.mtime && s.mtime !== d.mtime)) changed.set(d.id, 'modified');
        });
        renderDocs();
      }).catch(function () {});
    }

    function load() {
      return Promise.all([lib.list(), lib.loadEdits()]).then(function (r) {
        var records = r[0] || [];
        edits = r[1];
        docs = []; docById.clear();
        records.forEach(setDoc);
        renderDocs();
        return kb.call('load', { records: records, edits: edits });
      }).then(function () {
        graph = null;
        renderOverview();
        checkChanged();
        if (view === 'map') loadGraph();
      }).catch(function (e) { panelMessage('Non riesco ad aprire la libreria: ' + e.message); });
    }

    function removeDoc(d) {
      lib.remove(d.id).then(function () {
        docs = docs.filter(function (x) { return x.id !== d.id; });
        docById.delete(d.id);
        changed.delete(d.id);
        return kb.call('remove', { docId: d.id });
      }).then(function () {
        graph = null;
        renderDocs();
        afterChange();
        toast('«' + d.name + '» tolto dalla libreria (il file non è stato toccato).', 'Annulla', function () {
          lib.restore(d.id).then(function (rec) { setDoc(rec); return kb.call('upsert', { record: rec }); }).then(function () { graph = null; renderDocs(); afterChange(); });
        });
      }).catch(function (e) { toast('Non riesco a togliere il documento: ' + e.message); });
    }

    // ------------------------------------------------------------ importazione
    function enqueue(files) {
      var seen = new Set(queue.map(function (f) { return f.path; }));
      files.forEach(function (f) { if (!seen.has(f.path)) { seen.add(f.path); queue.push(f); } });
      if (!importing) runQueue();
      else updateImport();
    }
    var impDone = 0, impTotal = 0, impSkipped = 0, impErrors = 0, impAdded = 0;
    function updateImport(file, frac) {
      impBox.hidden = !importing;
      impTitle.textContent = 'Importo ' + impDone + ' di ' + impTotal + (impSkipped ? ' · ' + impSkipped + ' già aggiornati' : '') + (impErrors ? ' · ' + impErrors + ' errori' : '');
      if (file !== undefined) impFile.textContent = file;
      var pct = impTotal ? (impDone + (frac || 0)) / impTotal * 100 : 0;
      impBar.firstChild.style.width = Math.min(100, pct).toFixed(1) + '%';
      impBar.setAttribute('aria-valuenow', String(Math.round(pct)));
    }
    function logImport(name, msg) {
      importLog.push(name + ': ' + msg);
      impLogBox.hidden = false;
      impLogBox.textContent = '';
      impLogBox.appendChild(el('summary', { text: 'Avvisi dell’importazione (' + importLog.length + ')' }));
      var ul = el('ul');
      importLog.slice(-200).forEach(function (l) { ul.appendChild(el('li', { text: l })); });
      impLogBox.appendChild(ul);
    }
    async function runQueue() {
      importing = true; cancelImport = false;
      impDone = 0; impTotal = queue.length; impSkipped = 0; impErrors = 0; impAdded = 0;
      emptyBox.hidden = true;
      var readerSettings = {};
      try { readerSettings = g.WCSettings.sanitize(await host.readerSettings()); } catch (e) { readerSettings = g.WCSettings.defaults(); }
      host.setImportSettings(readerSettings);
      updateImport('', 0);
      while (queue.length && !cancelImport) {
        impTotal = Math.max(impTotal, impDone + queue.length);
        var f = queue.shift();
        updateImport(f.name, 0);
        try {
          var old = docById.get(f.id);
          if (old && !f.force && old.status !== 'error' && old.v === g.WCLibrary.VERSION && old.size === f.size && old.mtime === f.mtime) { impSkipped++; impDone++; continue; }
          var file = await lib.read(f.path);
          if (old && !f.force && old.status !== 'error' && old.v === g.WCLibrary.VERSION && old.hash === file.hash) { impSkipped++; impDone++; continue; }
          var dup = docs.find(function (x) { return x.hash === file.hash && x.id !== file.id && x.status !== 'error'; });
          if (dup) { logImport(f.name, 'stesso contenuto di «' + dup.name + '»: non lo aggiungo di nuovo'); impSkipped++; impDone++; continue; }
          var meta = { id: file.id, path: file.path, name: file.name, ext: file.ext, size: file.size, mtime: file.mtime, created: file.created, hash: file.hash, imported: new Date().toISOString() };
          var input = await host.importer.extract(file.name, file.bytes, meta, function (msg, frac) { updateImport(f.name + ' · ' + msg, frac != null ? frac * 0.8 : undefined); });
          updateImport(f.name + ' · analisi del testo', 0.85);
          var rec = await proc.call('process', { input: input, settings: { language: readerSettings.language || 'auto' } });
          await lib.save(rec);
          await kb.call('upsert', { record: rec });
          setDoc(rec);
          changed.delete(rec.id);
          impAdded++;
          (rec.warnings || []).forEach(function (w) { logImport(f.name, w); });
          if (rec.status === 'empty') logImport(f.name, 'nessun testo da leggere');
        } catch (e) {
          impErrors++;
          logImport(f.name, e.message || String(e));
          var errRec = { v: g.WCLibrary.VERSION, id: f.id, path: f.path, name: f.name, ext: f.ext, size: f.size, mtime: f.mtime, imported: new Date().toISOString(),
            status: 'error', error: e.message || String(e), chunks: [], concepts: [], aliases: [], warnings: [] };
          try { await lib.save(errRec); setDoc(errRec); await kb.call('upsert', { record: errRec }); } catch (e2) { /* niente */ }
        }
        impDone++;
        if (impDone % 3 === 0) renderDocs();
        updateImport('', 0);
      }
      if (cancelImport) { logImport('Importazione', 'interrotta: ' + queue.length + ' file non letti'); queue = []; }
      importing = false;
      impBox.hidden = true;
      graph = null;
      renderDocs();
      afterChange();
      var msg = impAdded ? plural(impAdded, 'documento letto', 'documenti letti') : 'Nessun documento nuovo';
      if (impSkipped) msg += ' · ' + impSkipped + ' già presenti';
      if (impErrors) msg += ' · ' + plural(impErrors, 'errore', 'errori');
      toast(msg + '.');
    }
    function afterChange() {
      renderOverview();
      if (view === 'map') loadGraph();
      if (lastSearch && lastSearch.q) search();
    }

    addFilesBtn.addEventListener('click', function () { addFiles(); });
    addFolderBtn.addEventListener('click', function () { addFolder(); });
    function addFiles() { return lib.addFiles().then(function (r) { if (r && r.files.length) enqueue(r.files); }); }
    function addFolder() {
      return lib.addFolder().then(function (r) {
        if (!r) return;
        if (!r.files.length) { toast('In questa cartella non ho trovato documenti da leggere.'); return; }
        if (r.truncated) logImport(r.root, 'troppi file: leggo i primi ' + r.files.length);
        if (r.skipped) logImport(r.root, r.skipped + ' cartelle o file non leggibili');
        enqueue(r.files);
      });
    }
    impStop.addEventListener('click', function () { cancelImport = true; impStop.textContent = 'Mi fermo dopo questo file…'; setTimeout(function () { impStop.textContent = 'Interrompi'; }, 4000); });
    docFilter.addEventListener('input', renderDocs);
    refreshBtn.addEventListener('click', function () {
      enqueue(docs.filter(function (d) { return changed.get(d.id) === 'modified'; }).map(function (d) { return { path: d.path, id: d.id, name: d.name, ext: d.ext, size: -1, mtime: null }; }));
    });

    // ------------------------------------------------------------ ricerca
    function search() {
      var q = qInput.value.trim();
      lastSearch = { q: q };
      if (!q) { renderOverviewResults(); return Promise.resolve(); }
      var f = { docs: filters.doc ? [filters.doc] : [], langs: langSel.value ? [langSel.value] : [], concept: lastSearch.concept || undefined };
      return kb.call('search', { query: q, filters: f }).then(function (res) { showView('results'); renderResults(res); })
        .catch(function (e) { resultsBox.textContent = ''; resultsBox.appendChild(el('p', { class: 'wc-doc-msg', text: 'Ricerca non riuscita: ' + e.message })); });
    }
    function searchConcept(c) {
      qInput.value = c.label;
      lastSearch = { q: c.label, concept: c.id };
      var f = { docs: filters.doc ? [filters.doc] : [], langs: langSel.value ? [langSel.value] : [], concept: c.id };
      return kb.call('search', { query: c.label, filters: f }).then(function (res) { showView('results'); renderResults(res, c); });
    }
    function renderResults(res, conceptOnly) {
      resultsBox.textContent = '';
      var head = el('div', { class: 'lb-rhead' });
      var docsHit = new Set(res.results.map(function (r) { return r.doc; }));
      head.appendChild(el('p', { class: 'lb-count', text: res.total ? plural(res.total, 'passaggio', 'passaggi') + ' in ' + plural(docsHit.size, 'documento', 'documenti') + (res.total > res.results.length ? ' (i primi ' + res.results.length + ')' : '') + ' · ' + res.ms + ' ms' : 'Nessun passaggio trovato.' }));
      if (conceptOnly) head.appendChild(el('p', { class: 'wc-note', text: 'Solo i passaggi dove compare il concetto «' + conceptOnly.label + '» (con i suoi alias).' }));
      if (res.concepts.length) {
        var chips = el('div', { class: 'lb-chips' }, [el('span', { class: 'wc-note', text: 'Concetti:' })]);
        res.concepts.forEach(function (c) {
          var b = el('button', { type: 'button', class: 'lb-chip', text: c.label + (c.forms.length > 1 ? ' (' + c.forms.filter(function (x) { return x !== c.label; }).slice(0, 2).join(', ') + ')' : ''), title: 'Apri la scheda del concetto' });
          b.addEventListener('click', function () { openConcept(c.id); });
          chips.appendChild(b);
        });
        head.appendChild(chips);
      }
      resultsBox.appendChild(head);
      var ol = el('ol', { class: 'lb-list' });
      res.results.forEach(function (r) {
        var openB = el('button', { type: 'button', class: 'wc-btn', text: 'Apri alla posizione esatta' });
        openB.addEventListener('click', function () { host.openAt(r.path, r.name, { text: r.full, page: r.page }); });
        var tags = el('div', { class: 'lb-tags' });
        r.concepts.forEach(function (c) { var t = el('button', { type: 'button', class: 'lb-tag', text: c.label }); t.addEventListener('click', function () { openConcept(c.id); }); tags.appendChild(t); });
        ol.appendChild(el('li', { class: 'lb-hit' + (r.kind === 'h' ? ' heading' : '') }, [
          el('p', { class: 'lb-src' }, [el('span', { class: 'lb-kind', text: KIND[r.ext] || r.format }), el('b', { text: r.name }), r.where ? el('span', { text: ' · ' + r.where }) : null]),
          el('p', { class: 'lb-snip' }, [marked(r.text, r.marks)]),
          el('div', { class: 'lb-hit-foot' }, [tags, openB])]));
      });
      resultsBox.appendChild(ol);
    }
    qForm.addEventListener('submit', function (e) { e.preventDefault(); lastSearch = null; search(); });
    var qTimer = 0;
    qInput.addEventListener('input', function () { clearTimeout(qTimer); qTimer = setTimeout(function () { if (qInput.value.trim().length >= 2 || !qInput.value.trim()) { lastSearch = null; search(); } }, 320); });
    docSel.addEventListener('change', function () { filters.doc = docSel.value; renderDocs(); if (qInput.value.trim()) search(); if (view === 'map') drawSoon(); });
    langSel.addEventListener('change', function () { if (qInput.value.trim()) search(); });

    // ------------------------------------------------------------ pannello di destra
    function panelMessage(text) { panel.textContent = ''; panel.appendChild(el('p', { class: 'wc-note', text: text })); }
    function renderOverview() {
      kb.call('stats').then(function (s) {
        if (selected) return;
        panel.textContent = '';
        panel.appendChild(el('h2', { text: 'La tua base di conoscenza' }));
        var tiles = el('div', { class: 'lb-tiles' });
        [['Documenti', s.docs], ['Passaggi', s.chunks], ['Parole', s.words], ['Concetti', s.concepts], ['Collegamenti', s.edges]].forEach(function (t) {
          tiles.appendChild(el('div', { class: 'sc-tile' }, [el('span', { text: t[0] }), el('b', { text: (t[1] || 0).toLocaleString('it-IT') })]));
        });
        panel.appendChild(tiles);
        if (s.suggestions) {
          var sb = el('button', { type: 'button', class: 'wc-btn', text: plural(s.suggestions, 'possibile concetto doppio', 'possibili concetti doppi') + ': rivedi' });
          sb.addEventListener('click', showSuggestions);
          panel.appendChild(sb);
        }
        kb.call('graph').then(function (G) {
          if (selected) return;
          graph = G; labelsList();
          updateSuggBtn();
          if (!G.nodes.length) return;
          panel.appendChild(el('h2', { text: 'Concetti principali' }));
          var ul = el('ul', { class: 'lb-top' });
          G.nodes.slice(0, 16).forEach(function (n) {
            var b = el('button', { type: 'button', class: 'wc-link', text: n.label });
            b.addEventListener('click', function () { openConcept(n.id); });
            ul.appendChild(el('li', {}, [b, el('span', { class: 'wc-note', text: ' · ' + plural(n.ndocs, 'documento', 'documenti') + ' · ' + n.count + '×' })]));
          });
          panel.appendChild(ul);
        });
        panel.appendChild(el('p', { class: 'wc-note', text: 'Suggerimenti: metti una frase tra virgolette per cercarla così com’è; cerca una sigla o un nome per trovare anche le sue forme estese; apri la mappa per vedere come si collegano i concetti.' }));
      }).catch(function () {});
    }
    function renderOverviewResults() {
      resultsBox.textContent = '';
      if (!docs.length) return;
      resultsBox.appendChild(el('p', { class: 'lb-count', text: 'Scrivi qui sopra cosa cerchi: la ricerca guarda in tutti i ' + plural(docs.length, 'documento', 'documenti') + ' insieme.' }));
      var recent = docs.filter(function (d) { return d.status !== 'error'; }).sort(function (a, b) { return String(b.imported).localeCompare(String(a.imported)); }).slice(0, 6);
      if (recent.length) {
        resultsBox.appendChild(el('h3', { class: 'sc-subhead', text: 'Aggiunti di recente' }));
        var ul = el('ul', { class: 'lb-recent' });
        recent.forEach(function (d) {
          var b = el('button', { type: 'button', class: 'wc-link', text: d.name });
          b.addEventListener('click', function () { showDoc(d); });
          ul.appendChild(el('li', {}, [b, el('span', { class: 'wc-note', text: ' · ' + fmtDate(d.imported) + (d.keywords && d.keywords.length ? ' · ' + d.keywords.slice(0, 5).join(', ') : '') })]));
        });
        resultsBox.appendChild(ul);
      }
    }
    function backLink() {
      var b = el('button', { type: 'button', class: 'wc-link lb-back', text: '← Panoramica' });
      b.addEventListener('click', function () { selected = null; drawSoon(); renderOverview(); });
      return b;
    }
    function showDoc(d) {
      selected = { doc: d.id };
      panel.textContent = '';
      panel.appendChild(backLink());
      panel.appendChild(el('h2', { text: 'Documento' }));
      panel.appendChild(el('p', { class: 'lb-title', text: d.title || d.name }));
      var dl = el('dl', { class: 'lb-dl' });
      [['File', d.name], ['Percorso', d.path], ['Tipo', d.format || KIND[d.ext] || d.ext], ['Dimensione', fmtSize(d.size)], ['Modificato', d.mtime ? fmtDate(d.mtime) : '—'],
        ['Aggiunto', fmtDate(d.imported)], ['Lingua', d.langName || d.lang || '—'], ['Pagine o slide', d.pages || '—'], ['Pagine con OCR', d.ocrPages || 0],
        ['Parole', (d.words || 0).toLocaleString('it-IT')], ['Passaggi', d.chunks], ['Concetti', d.concepts], ['Stato', d.status === 'error' ? 'errore: ' + d.error : (d.status === 'partial' ? 'letto in parte' : 'letto')],
        ['Impronta SHA-256', d.hash ? d.hash.slice(0, 16) + '…' : '—']].forEach(function (r) {
        dl.appendChild(el('dt', { text: r[0] })); dl.appendChild(el('dd', { text: String(r[1]) }));
      });
      panel.appendChild(dl);
      (d.warnings || []).forEach(function (w) { panel.appendChild(el('p', { class: 'wc-doc-warn', text: w })); });
      if (d.summary && d.summary.length) {
        panel.appendChild(el('h2', { text: 'In breve' }));
        var ul = el('ul', { class: 'lb-sum' });
        d.summary.forEach(function (s) { ul.appendChild(el('li', { text: s.text })); });
        panel.appendChild(ul);
      }
      var openB = el('button', { type: 'button', class: 'wc-btn wc-primary', text: 'Apri nel Lettore' });
      openB.addEventListener('click', function () { host.openAt(d.path, d.name, null); });
      var showB = el('button', { type: 'button', class: 'wc-btn', text: 'Mostra nella cartella' });
      showB.addEventListener('click', function () { host.showItem(d.path); });
      panel.appendChild(el('div', { class: 'wc-inline' }, [openB, showB]));
    }

    function openConcept(id) {
      return kb.call('concept', { cid: id }).then(function (c) {
        if (!c) { panelMessage('Questo concetto non c’è più (forse è stato unito a un altro).'); return; }
        selected = { concept: c.id };
        drawSoon();
        renderConcept(c);
      });
    }
    function edit(op, msg) {
      return kb.call('edit', { op: op }).then(function (r) {
        edits = r.edits;
        lib.saveEdits(edits).catch(function (e) { toast('Modifica non salvata: ' + e.message); });
        if (r.graph) { graph = r.graph; labelsList(); updateSuggBtn(); prepareMap(); drawSoon(); }
        if (msg) toast(msg);
        return r;
      }).catch(function (e) { toast(e.message); throw e; });
    }
    function labelsList() {
      labelList.textContent = '';
      if (!graph) return;
      graph.nodes.slice(0, 3000).forEach(function (n) { labelList.appendChild(el('option', { value: n.label })); });
    }
    function nodeByLabel(label) {
      if (!graph) return null;
      var f = g.WCText.fold(label.trim());
      return graph.nodes.find(function (n) { return g.WCText.fold(n.label) === f; }) || graph.nodes.find(function (n) { return g.WCText.fold(n.label).indexOf(f) === 0; }) || null;
    }
    // piccolo modulo dentro il pannello (al posto delle finestre di dialogo)
    function inlineForm(label, placeholder, okText, onOk, withList) {
      var input = el('input', { type: 'text', placeholder: placeholder, 'aria-label': label });
      if (withList) input.setAttribute('list', 'lb-labels');
      var ok = el('button', { type: 'submit', class: 'wc-btn wc-primary', text: okText });
      var cancel = el('button', { type: 'button', class: 'wc-link', text: 'Annulla' });
      var form = el('form', { class: 'lb-form' }, [el('label', { class: 'wc-label', text: label }), el('div', { class: 'wc-inline' }, [input, ok, cancel])]);
      form.addEventListener('submit', function (e) { e.preventDefault(); var v = input.value.trim(); if (v) onOk(v, form); });
      cancel.addEventListener('click', function () { form.remove(); });
      setTimeout(function () { input.focus(); }, 0);
      return form;
    }
    function sourceLink(s) {
      var b = el('button', { type: 'button', class: 'lb-srcbtn', title: 'Apri alla posizione esatta' }, [el('b', { text: s.name }), s.where ? el('span', { text: ' · ' + s.where }) : null]);
      b.addEventListener('click', function () { host.openAt(s.path, s.name, { text: s.full || s.text, page: s.page }); });
      return b;
    }
    function renderConcept(c) {
      panel.textContent = '';
      panel.appendChild(backLink());
      var badges = el('span', { class: 'lb-badges' });
      if (c.central) badges.appendChild(el('span', { class: 'lb-badge central', text: 'centrale' }));
      if (c.multi) badges.appendChild(el('span', { class: 'lb-badge multi', text: 'in ' + c.docs.length + ' documenti' }));
      panel.appendChild(el('h2', { text: 'Concetto' }));
      panel.appendChild(el('p', { class: 'lb-title', text: c.label }));
      panel.appendChild(badges);
      panel.appendChild(el('p', { class: 'wc-note', text: plural(c.count, 'volta', 'volte') + ' in ' + plural(c.total, 'passaggio', 'passaggi') + ': ' + c.docs.map(function (d) { return d.name; }).join(', ') }));
      var actions = el('div', { class: 'lb-actions' });
      var formBox = el('div');
      [['Cerca i passaggi', function () { searchConcept(c); }],
        ['Mostra sulla mappa', function () { showView('map'); focusNode(c.id); }],
        ['Rinomina', function () { formBox.textContent = ''; formBox.appendChild(inlineForm('Nuovo nome', c.label, 'Rinomina', function (v) { edit({ type: 'rename', id: c.id, label: v }, 'Concetto rinominato.').then(function () { openConcept(c.id); }); })); }],
        ['Aggiungi alias', function () { formBox.textContent = ''; formBox.appendChild(inlineForm('Altro nome dello stesso concetto', 'es. modulazione in quadratura', 'Aggiungi', function (v) { edit({ type: 'alias', id: c.id, text: v }, 'Alias aggiunto.').then(function () { openConcept(c.id); }); })); }],
        ['Unisci con…', function () {
          formBox.textContent = '';
          formBox.appendChild(inlineForm('Unisci con il concetto', 'nome del concetto', 'Unisci', function (v) {
            var o = nodeByLabel(v);
            if (!o) { toast('Non trovo il concetto «' + v + '».'); return; }
            edit({ type: 'merge', a: c.id, b: o.id }, 'Uniti «' + c.label + '» e «' + o.label + '».').then(function () { openConcept(c.id); });
          }, true));
        }],
        ['Collega a…', function () {
          formBox.textContent = '';
          formBox.appendChild(inlineForm('Collega al concetto', 'nome del concetto', 'Collega', function (v) {
            var o = nodeByLabel(v);
            if (!o) { toast('Non trovo il concetto «' + v + '».'); return; }
            edit({ type: 'link', a: c.id, b: o.id }, 'Collegamento aggiunto.').then(function () { openConcept(c.id); });
          }, true));
        }]].forEach(function (a) {
        var b = el('button', { type: 'button', class: 'wc-btn', text: a[0] });
        b.addEventListener('click', a[1]);
        actions.appendChild(b);
      });
      panel.appendChild(actions);
      panel.appendChild(formBox);

      c.suggestions.forEach(function (s) {
        var other = s.a === c.id ? s.lb : s.la, oid = s.a === c.id ? s.b : s.a;
        var yes = el('button', { type: 'button', class: 'wc-btn wc-primary', text: 'Sì, uniscili' });
        var no = el('button', { type: 'button', class: 'wc-btn', text: 'No, sono diversi' });
        yes.addEventListener('click', function () { edit({ type: 'merge', a: c.id, b: oid }, 'Uniti.').then(function () { openConcept(c.id); }); });
        no.addEventListener('click', function () { edit({ type: 'reject', a: c.id, b: oid }).then(function () { openConcept(c.id); }); });
        panel.appendChild(el('div', { class: 'lb-ask' }, [el('p', { text: '«' + c.label + '» e «' + other + '» sembrano lo stesso concetto (' + s.reason + '). Vuoi unirli?' }), el('div', { class: 'wc-inline' }, [yes, no])]));
      });

      var forms = c.forms.filter(function (f) { return f !== c.label; });
      if (forms.length || c.members.length > 1) {
        panel.appendChild(el('h2', { text: 'Alias e forme unite' }));
        var ul = el('ul', { class: 'lb-alias' });
        forms.forEach(function (f) {
          var li = el('li', { text: f + ' ' });
          if (c.userAliases.indexOf(f) >= 0) {
            var x = el('button', { type: 'button', class: 'wc-link', text: 'togli', 'aria-label': 'Togli l’alias ' + f });
            x.addEventListener('click', function () { edit({ type: 'unalias', id: c.id, text: f }).then(function () { openConcept(c.id); }); });
            li.appendChild(x);
          }
          ul.appendChild(li);
        });
        panel.appendChild(ul);
        if (c.members.length > 1) {
          var sep = el('div', { class: 'lb-split' }, [el('span', { class: 'wc-note', text: 'Unito per errore? Separa: ' })]);
          (c.memberLabels || c.members).forEach(function (m, i) {
            var b = el('button', { type: 'button', class: 'wc-link', text: m });
            b.addEventListener('click', function () { edit({ type: 'split', id: c.id, member: c.members[i] }, 'Separato.').then(function () { openConcept(c.members[i === 0 ? 1 : 0]); }); });
            sep.appendChild(b);
          });
          panel.appendChild(sep);
        }
      }
      if (c.defs.length) {
        panel.appendChild(el('h2', { text: 'Definizioni' }));
        c.defs.forEach(function (d) { panel.appendChild(el('blockquote', { class: 'lb-def' }, [el('p', { text: d.text }), sourceLink(d)])); });
      }
      if (c.related.length) {
        panel.appendChild(el('h2', { text: 'Concetti collegati' }));
        var rl = el('ul', { class: 'lb-rel' });
        c.related.slice(0, 30).forEach(function (r) {
          var b = el('button', { type: 'button', class: 'wc-link', text: r.label });
          b.addEventListener('click', function () { openConcept(r.id); });
          var x = el('button', { type: 'button', class: 'lb-x', text: '×', title: 'Togli questo collegamento', 'aria-label': 'Togli il collegamento con ' + r.label });
          x.addEventListener('click', function () { edit({ type: 'unlink', a: c.id, b: r.id }, 'Collegamento tolto.').then(function () { openConcept(c.id); }); });
          rl.appendChild(el('li', { class: 'rel-' + r.type }, [el('span', { class: 'lb-rel-type', text: r.rel }), b, r.c ? el('span', { class: 'wc-note', text: ' ' + r.c + '×' }) : null, x]));
        });
        panel.appendChild(rl);
      }
      panel.appendChild(el('h2', { text: 'Fonti' + (c.total > c.sources.length ? ' (prime ' + c.sources.length + ' di ' + c.total + ')' : ' (' + c.sources.length + ')') }));
      var sl = el('ol', { class: 'lb-sources' });
      c.sources.slice(0, 40).forEach(function (s) { sl.appendChild(el('li', {}, [sourceLink(s), el('p', { text: s.text })])); });
      panel.appendChild(sl);
      if (c.log.length) {
        var det = el('details', { class: 'lb-log' }, [el('summary', { text: 'Cronologia delle modifiche (' + c.log.length + ')' })]);
        var ll = el('ul');
        c.log.slice().reverse().forEach(function (l) { ll.appendChild(el('li', { text: fmtDate(l.t) + ' · ' + l.text })); });
        det.appendChild(ll);
        panel.appendChild(det);
      }
    }
    function showSuggestions() {
      var go = graph ? Promise.resolve(graph) : kb.call('graph');
      go.then(function (G) {
        graph = G;
        selected = { sugg: true };
        panel.textContent = '';
        panel.appendChild(backLink());
        panel.appendChild(el('h2', { text: 'Possibili concetti doppi' }));
        panel.appendChild(el('p', { class: 'wc-note', text: 'Il ragno unisce da solo le forme ovvie (singolare e plurale, una sigla scritta con la sua forma estesa). Qui ci sono i casi incerti: decidi tu.' }));
        if (!G.suggestions.length) { panel.appendChild(el('p', { text: 'Nessun caso da rivedere.' })); return; }
        G.suggestions.slice(0, 60).forEach(function (s) {
          var yes = el('button', { type: 'button', class: 'wc-btn wc-primary', text: 'Unisci' });
          var no = el('button', { type: 'button', class: 'wc-btn', text: 'Sono diversi' });
          var box = el('div', { class: 'lb-ask' }, [el('p', {}, [el('b', { text: s.la }), document.createTextNode(' e '), el('b', { text: s.lb })]), el('p', { class: 'wc-note', text: s.reason }), el('div', { class: 'wc-inline' }, [yes, no])]);
          yes.addEventListener('click', function () { edit({ type: 'merge', a: s.a, b: s.b }).then(function () { box.remove(); }); });
          no.addEventListener('click', function () { edit({ type: 'reject', a: s.a, b: s.b }).then(function () { box.remove(); }); });
          panel.appendChild(box);
        });
      });
    }
    function updateSuggBtn() {
      var n = graph ? graph.suggestions.length : 0;
      suggBtn.hidden = !n;
      suggBtn.textContent = plural(n, 'concetto da rivedere', 'concetti da rivedere');
    }
    suggBtn.addEventListener('click', showSuggestions);

    // ------------------------------------------------------------ viste
    function showView(v, quiet) {
      view = v;
      tabResults.setAttribute('aria-selected', v === 'results' ? 'true' : 'false');
      tabMap.setAttribute('aria-selected', v === 'map' ? 'true' : 'false');
      resultsBox.hidden = v !== 'results' || !docs.length;
      mapBox.hidden = v !== 'map' || !docs.length;
      if (v === 'results' && !quiet && !resultsBox.childNodes.length) renderOverviewResults();
      if (v === 'results' && !resultsBox.childNodes.length) renderOverviewResults();
      if (v === 'map' && docs.length) { if (!graph || !mapNodes.length) loadGraph(); else { resize(); drawSoon(); } }
    }
    tabResults.addEventListener('click', function () { showView('results'); });
    tabMap.addEventListener('click', function () { showView('map'); });

    // ------------------------------------------------------------ mappa dei concetti
    var mapNodes = [], mapEdges = [], nodeIdx = new Map(), maxW = 1;
    var tf = { x: 0, y: 0, k: 1 }, W = 0, H = 0, dpr = 1, raf = 0, hover = null, fitted = false;
    var cx = canvas.getContext('2d');
    function loadGraph() {
      return kb.call('graph').then(function (G) { graph = G; labelsList(); updateSuggBtn(); prepareMap(); if (!fitted) fit(); drawSoon(); });
    }
    function prepareMap() {
      var keep = new Map(mapNodes.map(function (n) { return [n.id, n]; }));
      mapNodes = graph.nodes.map(function (n) {
        var old = keep.get(n.id);
        if (old && old.dragged) { n.x = old.x; n.y = old.y; }
        return n;
      });
      nodeIdx = new Map(mapNodes.map(function (n, i) { return [n.id, i]; }));
      mapEdges = graph.edges.map(function (e) { return { a: nodeIdx.get(e.a), b: nodeIdx.get(e.b), w: e.w, type: e.type }; }).filter(function (e) { return e.a !== undefined && e.b !== undefined; });
      maxW = mapNodes.reduce(function (m, n) { return Math.max(m, n.weight); }, 0.001);
      mapNodes.forEach(function (n, i) { n.r = 3 + 11 * Math.sqrt(n.weight / maxW); n.i = i; n.nb = []; });
      mapEdges.forEach(function (e) { mapNodes[e.a].nb.push(e.b); mapNodes[e.b].nb.push(e.a); });
    }
    function visible(n) {
      if (onlyCentral.checked && !n.central) return false;
      if (onlyMulti.checked && !n.multi) return false;
      if (filters.doc && n.docs.indexOf(filters.doc) < 0) return false;
      return true;
    }
    function resize() {
      var r = stage.getBoundingClientRect();
      if (!r.width) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      drawSoon();
    }
    function fit() {
      var list = mapNodes.filter(visible);
      if (!list.length || !W) return;
      // i concetti collegati contano di più: pochi concetti isolati ai bordi non rimpiccioliscono la mappa
      var linked = list.filter(function (n) { return n.deg > 0; });
      if (linked.length >= 5) list = linked;
      var xs = list.map(function (n) { return n.x; }).sort(function (a, b) { return a - b; });
      var ys = list.map(function (n) { return n.y; }).sort(function (a, b) { return a - b; });
      var cut = list.length > 40 ? Math.floor(list.length * 0.03) : 0;
      var x0 = xs[cut], x1 = xs[xs.length - 1 - cut], y0 = ys[cut], y1 = ys[ys.length - 1 - cut];
      var k = Math.min(W / Math.max(80, x1 - x0 + 120), H / Math.max(80, y1 - y0 + 120), 2.5);
      tf.k = k; tf.x = W / 2 - (x0 + x1) / 2 * k; tf.y = H / 2 - (y0 + y1) / 2 * k;
      fitted = true;
      drawSoon();
    }
    function focusNode(id) {
      var go = mapNodes.length ? Promise.resolve() : loadGraph();
      go.then(function () {
        var n = mapNodes[nodeIdx.get(id)];
        if (!n) return;
        selected = { concept: id };
        tf.k = Math.max(tf.k, 1.2);
        tf.x = W / 2 - n.x * tf.k; tf.y = H / 2 - n.y * tf.k;
        drawSoon();
      });
    }
    function drawSoon() { if (!raf) raf = requestAnimationFrame(draw); }
    var COL = { central: '#4a63ff', multi: '#b48cff', one: '#7d8597', isa: 'rgba(170,180,255,0.85)', def: 'rgba(63,216,255,0.55)', user: 'rgba(255,138,61,0.9)' };
    function draw() {
      raf = 0;
      if (mapBox.hidden || !W) return;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.fillStyle = '#0b0b0e';
      cx.fillRect(0, 0, W, H);
      if (!mapNodes.length) {
        cx.fillStyle = '#9b9aa7'; cx.font = '14px system-ui, sans-serif'; cx.textAlign = 'center';
        cx.fillText(graph ? 'Nessun concetto ancora: aggiungi qualche documento.' : 'Preparo la mappa…', W / 2, H / 2);
        return;
      }
      var sel = selected && selected.concept ? nodeIdx.get(selected.concept) : undefined;
      var focusI = hover != null ? hover : sel;
      var near = new Set();
      if (focusI !== undefined && focusI !== null && mapNodes[focusI]) { near.add(focusI); mapNodes[focusI].nb.forEach(function (j) { near.add(j); }); }
      var find = g.WCText.fold(mapFind.value.trim());
      var vis = mapNodes.map(visible);
      function sx(x) { return x * tf.k + tf.x; }
      function sy(y) { return y * tf.k + tf.y; }
      // collegamenti
      mapEdges.forEach(function (e) {
        if (!vis[e.a] || !vis[e.b]) return;
        var A = mapNodes[e.a], B = mapNodes[e.b];
        var hot = near.size && (e.a === focusI || e.b === focusI);
        var dim = near.size && !hot;
        cx.beginPath();
        cx.moveTo(sx(A.x), sy(A.y)); cx.lineTo(sx(B.x), sy(B.y));
        if (e.type === 'co') cx.strokeStyle = 'rgba(170,180,255,' + (dim ? 0.05 : (hot ? 0.6 : 0.1 + 0.35 * e.w)) + ')';
        else cx.strokeStyle = dim ? 'rgba(120,120,140,0.12)' : COL[e.type];
        cx.lineWidth = (e.type === 'co' ? 0.6 + 1.6 * e.w : 1.6) * (hot ? 1.5 : 1);
        cx.setLineDash(e.type === 'user' ? [5, 4] : []);
        cx.stroke();
        if (e.type === 'isa' && !dim) arrow(sx(A.x), sy(A.y), sx(B.x), sy(B.y), B.r * Math.max(0.6, Math.min(tf.k, 2)));
      });
      cx.setLineDash([]);
      // concetti
      var labels = [];
      mapNodes.forEach(function (n, i) {
        if (!vis[i]) return;
        var x = sx(n.x), y = sy(n.y);
        if (x < -40 || y < -40 || x > W + 40 || y > H + 40) return;
        var r = n.r * Math.max(0.6, Math.min(tf.k, 2));
        var dim = near.size && !near.has(i);
        var match = find && g.WCText.fold(n.label).indexOf(find) >= 0;
        cx.globalAlpha = dim && !match ? 0.25 : 1;
        cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2);
        cx.fillStyle = n.central ? COL.central : (n.multi ? COL.multi : COL.one);
        cx.fill();
        if (i === sel || match) { cx.lineWidth = 2.5; cx.strokeStyle = match ? '#5de07f' : '#ffffff'; cx.stroke(); }
        cx.globalAlpha = 1;
        var important = i < 40 || r >= 9 || near.has(i) || match || i === sel;
        if (important && !(dim && !match)) labels.push([n, x, y, r, i === sel || i === hover || match]);
      });
      // etichette senza sovrapporsi
      var taken = [];
      cx.font = '600 12px system-ui, sans-serif';
      cx.textAlign = 'left'; cx.textBaseline = 'middle';
      labels.sort(function (a, b) { return (b[4] - a[4]) || (b[0].weight - a[0].weight); });
      labels.forEach(function (L) {
        var n = L[0], tw = cx.measureText(n.label).width, x = L[1] + L[3] + 4, y = L[2];
        var box = [x - 2, y - 8, x + tw + 2, y + 8];
        if (!L[4] && taken.some(function (b) { return !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]); })) return;
        taken.push(box);
        cx.fillStyle = 'rgba(11,11,14,0.75)';
        cx.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
        cx.fillStyle = L[4] ? '#ffffff' : '#d9d8e2';
        cx.fillText(n.label, x, y);
      });
    }
    function arrow(x1, y1, x2, y2, r) {
      var a = Math.atan2(y2 - y1, x2 - x1), x = x2 - Math.cos(a) * (r + 2), y = y2 - Math.sin(a) * (r + 2);
      cx.beginPath();
      cx.moveTo(x, y);
      cx.lineTo(x - Math.cos(a - 0.45) * 8, y - Math.sin(a - 0.45) * 8);
      cx.lineTo(x - Math.cos(a + 0.45) * 8, y - Math.sin(a + 0.45) * 8);
      cx.closePath();
      cx.fillStyle = COL.isa;
      cx.fill();
    }
    function hit(px, py) {
      var best = null, bd = Infinity;
      for (var i = 0; i < mapNodes.length; i++) {
        var n = mapNodes[i];
        if (!visible(n)) continue;
        var x = n.x * tf.k + tf.x, y = n.y * tf.k + tf.y, r = Math.max(6, n.r * Math.max(0.6, Math.min(tf.k, 2)) + 3);
        var d = (x - px) * (x - px) + (y - py) * (y - py);
        if (d <= r * r && d < bd) { bd = d; best = i; }
      }
      return best;
    }
    var drag = null, moved = [];
    canvas.addEventListener('pointerdown', function (e) {
      var r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      var i = hit(px, py);
      drag = { i: i, sx: px, sy: py, tx: tf.x, ty: tf.y, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      if (drag) {
        if (Math.abs(px - drag.sx) + Math.abs(py - drag.sy) > 3) drag.moved = true;
        if (drag.i !== null) {
          var n = mapNodes[drag.i];
          n.x = (px - tf.x) / tf.k; n.y = (py - tf.y) / tf.k; n.dragged = true;
        } else { tf.x = drag.tx + px - drag.sx; tf.y = drag.ty + py - drag.sy; }
        drawSoon();
        return;
      }
      var h = hit(px, py);
      if (h !== hover) {
        hover = h;
        canvas.style.cursor = h !== null ? 'pointer' : 'grab';
        if (h !== null) {
          var n2 = mapNodes[h];
          tip.textContent = n2.label + ' · ' + plural(n2.ndocs, 'documento', 'documenti') + ' · ' + n2.count + '×' + (n2.defs ? ' · definito' : '');
          tip.hidden = false;
        } else tip.hidden = true;
        drawSoon();
      }
      if (h !== null) { tip.style.left = (px + 14) + 'px'; tip.style.top = (py + 10) + 'px'; }
    });
    canvas.addEventListener('pointerup', function () {
      var d = drag;
      drag = null;
      if (!d) return;
      if (d.i !== null && d.moved) {
        var n = mapNodes[d.i];
        moved.push({ id: n.id, x: n.x, y: n.y });
        clearTimeout(posTimer);
        posTimer = setTimeout(savePositions, 600);
      } else if (d.i !== null) openConcept(mapNodes[d.i].id);
      else if (!d.moved && selected && selected.concept) { selected = null; renderOverview(); drawSoon(); }
    });
    var posTimer = 0;
    function savePositions() {
      var list = moved; moved = [];
      if (list.length) edit({ type: 'pos', list: list });
    }
    canvas.addEventListener('pointerleave', function () { hover = null; tip.hidden = true; drawSoon(); });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      var k = Math.max(0.05, Math.min(6, tf.k * Math.exp(-e.deltaY * 0.0015)));
      tf.x = px - (px - tf.x) * k / tf.k; tf.y = py - (py - tf.y) * k / tf.k; tf.k = k;
      drawSoon();
    }, { passive: false });
    canvas.addEventListener('dblclick', function () { fit(); });
    canvas.addEventListener('keydown', function (e) {
      if (e.key === '0') fit();
      else if (e.key === '+' || e.key === '=') { tf.k = Math.min(6, tf.k * 1.25); drawSoon(); }
      else if (e.key === '-') { tf.k = Math.max(0.05, tf.k / 1.25); drawSoon(); }
      else if (e.key === 'Escape') { selected = null; renderOverview(); drawSoon(); }
    });
    fitBtn.addEventListener('click', fit);
    onlyCentral.addEventListener('change', function () { fit(); });
    onlyMulti.addEventListener('change', function () { fit(); });
    mapFind.addEventListener('input', drawSoon);
    var lastFind = '';
    function findOnMap() {
      var v = mapFind.value.trim();
      if (!v || v === lastFind) return;
      lastFind = v;
      var n = nodeByLabel(v);
      if (n) { focusNode(n.id); openConcept(n.id); }
    }
    mapFind.addEventListener('change', findOnMap);
    mapFind.addEventListener('keydown', function (e) { if (e.key === 'Enter') { lastFind = ''; findOnMap(); } });
    exportSel.addEventListener('change', function () {
      var k = exportSel.value;
      exportSel.value = '';
      if (k === 'png') {
        canvas.toBlob(function (b) { b.arrayBuffer().then(function (buf) { host.saveFile('mappa dei concetti.png', new Uint8Array(buf), 'image/png'); }); }, 'image/png');
      } else if (k === 'md') kb.call('markdown').then(function (md) { host.saveFile('mappa dei concetti.md', md, 'text/markdown'); });
      else if (k === 'json') kb.call('graph').then(function (G) { host.saveFile('mappa dei concetti.json', JSON.stringify(G, null, 2), 'application/json'); });
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(function () { if (!mapBox.hidden) resize(); }).observe(stage);

    // ------------------------------------------------------------ avvisi
    var toastEl = el('div', { class: 'lb-toast', role: 'status', hidden: 'hidden' });
    document.body.appendChild(toastEl);
    var toastTimer = 0;
    function toast(text, actionText, action) {
      toastEl.textContent = '';
      toastEl.appendChild(el('span', { text: text }));
      if (actionText) {
        var b = el('button', { type: 'button', class: 'wc-link', text: actionText });
        b.addEventListener('click', function () { toastEl.hidden = true; action(); });
        toastEl.appendChild(b);
      }
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.hidden = true; }, actionText ? 9000 : 4500);
    }

    load();
    return {
      refresh: function () { if (!importing) checkChanged(); if (view === 'map') { resize(); } },
      addFiles: addFiles, addFolder: addFolder, resize: resize,
      search: function (q) { qInput.value = q; return search(); },
      openConcept: openConcept, showView: showView, toast: function (t) { toast(t); },
      state: function () { return { docs: docs.slice(), importing: importing, queue: queue.length, graph: graph, view: view }; },
      ready: function () { return new Promise(function (res) { (function wait() { if (!importing && !queue.length) res(); else setTimeout(wait, 100); })(); }); }
    };
  }

  g.WCLibraryView = { mount: mount };
})(globalThis);
