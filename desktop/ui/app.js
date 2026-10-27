/* Word Crawler Studio: interfaccia dell'app desktop (schede, collegamento al sistema, guida). */
(function () {
  'use strict';
  var D = window.wcDesktop;
  var $ = function (id) { return document.getElementById(id); };
  if (!D) {
    $('nohost').hidden = false;
    document.querySelectorAll('.view, .topbar').forEach(function (e) { e.hidden = true; });
    return;
  }
  var TOP = 52;
  document.documentElement.style.setProperty('--wc-top', TOP + 'px');

  // ---------------------------------------------------------------- PDF.js (installato con npm)
  var pdfLib = null;
  function loadPdfJs() {
    if (pdfLib) return Promise.resolve(pdfLib);
    var base = new URL('../../node_modules/pdfjs-dist/build/', location.href).href;
    return import(base + 'pdf.min.mjs').then(function (m) {
      m.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
      pdfLib = m;
      return m;
    }).catch(function () { return null; });
  }

  // ---------------------------------------------------------------- lettore
  var archiveUI = null;
  var reader = WCReader.mount($('reader'), {
    insetTop: TOP,
    pickFile: function () { return D.openFile(); },
    fetchUrl: function (url) { return D.fetchUrl(url); },
    saveFile: function (name, content, mime) { return D.saveFile(name, content, mime); },
    archive: { save: function (e) { return D.archive.save(e).then(function () { if (archiveUI) archiveUI.refresh(); return true; }); } },
    settings: { load: function () { return D.settings.load('reader'); }, save: function (v) { return D.settings.save('reader', v); } },
    pdfjs: loadPdfJs,
    pdfHelp: 'Per leggere i PDF serve PDF.js: nella cartella del progetto esegui “npm install” e riavvia l’app. Le versioni installate da GitHub lo contengono già.'
  });

  // ---------------------------------------------------------------- scanner
  var scanner = WCScanView.mount($('scanner'), {
    roots: D.scan.roots, pickFolder: D.scan.pickFolder, start: D.scan.start, cancel: D.scan.cancel, onEvent: D.scan.onEvent,
    exportCsv: D.scan.exportCsv, showItem: D.showItem, saveFile: D.saveFile,
    settings: { load: function () { return D.settings.load('scanner'); }, save: function (v) { return D.settings.save('scanner', v); } }
  });

  // ---------------------------------------------------------------- archivio
  archiveUI = WCArchiveUI.render($('archive'), {
    list: D.archive.list, remove: D.archive.remove, saveFile: D.saveFile,
    open: function (e) { show('reader'); reader.openUrl(e.source); }
  });

  // ---------------------------------------------------------------- guida (generata dai parametri veri)
  (function guide() {
    var el = WCSettingsUI.el;
    var g = $('guide');
    var parts = [];
    parts.push(el('h1', { text: 'Come funziona Word Crawler' }));
    parts.push(el('p', { text: 'Il ragno legge il documento parola per parola. Non usa intelligenza artificiale: conta le parole, scarta quelle comuni (articoli, preposizioni…), premia i nomi propri, le parole dei titoli e quelle che tornano in tutto il testo, e collega tra loro le parole vicine. Con questi conti sceglie le parole chiave e le frasi più importanti, che diventano il sunto.' }));
    parts.push(el('p', { text: 'Tutto succede sul tuo computer: nessun file viene inviato a nessuno.' }));
    parts.push(el('h2', { text: 'Modalità' }));
    var dl = el('dl');
    Object.keys(WCSettings.MODES).forEach(function (k) { dl.appendChild(el('dt', { text: WCSettings.MODES[k].label })); dl.appendChild(el('dd', { text: WCSettings.MODES[k].desc })); });
    parts.push(dl);
    parts.push(el('h2', { text: 'Parametri e cosa cambiano' }));
    var dl2 = el('dl');
    WCSettings.PARAMS.forEach(function (p) {
      if (p.id === 'mode') return;
      var range = p.type === 'range' ? ' (' + p.min + '–' + p.max + (p.unit ? ' ' + p.unit : '') + ')' : '';
      dl2.appendChild(el('dt', { text: p.group + ' · ' + p.label + range }));
      dl2.appendChild(el('dd', { text: p.effect + (WCSettingsUI.VISUAL.has(p.id) ? ' Si applica subito.' : ' Vale dalla lettura successiva.') }));
    });
    parts.push(dl2);
    parts.push(el('h2', { text: 'Preset' }));
    var ul = el('ul');
    Object.keys(WCSettings.PRESETS).forEach(function (k) {
      var v = WCSettings.PRESETS[k].values;
      ul.appendChild(el('li', { text: WCSettings.PRESETS[k].label + ': modalità ' + WCSettings.MODES[v.mode].label + ', ' + v.speed + ' parole/s, ' + v.legs + ' zampe, selettività ' + v.selectivity + '.' }));
    });
    parts.push(ul);
    parts.push(el('h2', { text: 'Tasti rapidi mentre il ragno legge' }));
    var keys = el('dl');
    [['Spazio', 'pausa / riprendi'], ['Invio', 'completa subito la lettura'], ['+ e −', 'più veloce / più lento'], ['Esc', 'toglie il ragno'], ['Ctrl+O', 'apri un documento'], ['Ctrl+1…3', 'Lettore, Scanner, Archivio'], ['F1', 'questa guida']]
      .forEach(function (k) { keys.appendChild(el('dt', { text: k[0] })); keys.appendChild(el('dd', { text: k[1] })); });
    parts.push(keys);
    parts.push(el('h2', { text: 'Scanner del PC' }));
    parts.push(el('p', { text: 'Scegli un disco (per esempio C:) o una cartella: il ragno la percorre tutta e alla fine ti dà un rapporto con file, cartelle, spazio per estensione e per tipo, file e cartelle più grandi, duplicati, nomi ripetuti, file e cartelle vuoti, date, percorsi troppo lunghi e cartelle non leggibili.' }));
    parts.push(el('p', { text: 'La scansione è in sola lettura: il ragno elenca, misura e (per i duplicati) legge i file, ma non modifica, non sposta e non cancella niente. Non segue i collegamenti simbolici, così non gira in tondo. Le cartelle di sistema a cui Windows o macOS negano l’accesso vengono saltate e contate tra i “non leggibili”.' }));
    parts.push(el('p', { text: 'Su macOS, per analizzare tutto il disco, concedi a Word Crawler l’“Accesso completo al disco” in Impostazioni di Sistema → Privacy e sicurezza.' }));
    parts.push(el('h2', { text: 'Dove finiscono i dati' }));
    var info = el('p', { text: 'Impostazioni, archivio e rapporti delle scansioni stanno nella cartella dati dell’app.' });
    parts.push(info);
    D.info().then(function (i) {
      info.textContent = 'Impostazioni, archivio e rapporti delle scansioni stanno in: ' + i.userData + '. PDF.js: ' + (i.pdfjs ? 'installato.' : 'non installato (esegui npm install).');
      $('version').textContent = 'v' + i.version;
    });
    parts.forEach(function (p) { g.appendChild(p); });
  })();

  // ---------------------------------------------------------------- schede
  var views = ['reader', 'scanner', 'archive', 'guide'];
  function show(v) {
    views.forEach(function (k) {
      var on = k === v;
      $('view-' + k).hidden = !on;
      var t = $('tab-' + k);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    if (v !== 'reader') reader.pause();
    if (v === 'scanner') setTimeout(scanner.resize, 0);
    if (v === 'archive') archiveUI.refresh();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tabs [role="tab"]').forEach(function (b) {
    b.addEventListener('click', function () { show(b.dataset.view); });
    b.addEventListener('keydown', function (e) {
      var i = views.indexOf(b.dataset.view);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        var n = views[(i + (e.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length];
        show(n); $('tab-' + n).focus();
      }
    });
  });
  show('reader');

  D.onMenu(function (cmd) {
    if (cmd === 'open') { show('reader'); D.openFile().then(function (f) { if (f) reader.openBytes(f.name, f.bytes, f.source); }); }
    else if (cmd === 'open-url') { show('reader'); var u = document.getElementById('wc-url'); if (u) u.focus(); }
    else if (cmd === 'scanner') show('scanner');
    else if (/^tab:/.test(cmd)) show(cmd.slice(4));
  });
  D.onFileOpened(function (f) { show('reader'); reader.openBytes(f.name, f.bytes, f.source); });
})();
