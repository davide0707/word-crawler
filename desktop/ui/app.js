// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
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

  // ---------------------------------------------------------------- Tesseract (OCR, installato con npm)
  var NM = new URL('../../node_modules/', location.href).href;
  var OCR = {
    script: NM + 'tesseract.js/dist/tesseract.min.js',
    workerPath: NM + 'tesseract.js/dist/worker.min.js',
    corePath: NM + 'tesseract.js-core/'
  };

  // ---------------------------------------------------------------- lettore
  var archiveUI = null;
  var reader = WCReader.mount($('reader'), {
    insetTop: TOP,
    pickFile: function () { return D.openFile(); },
    fetchUrl: function (url) { return D.fetchUrl(url); },
    saveFile: function (name, content, mime) { return D.saveFile(name, content, mime); },
    archive: { save: function (e) { return D.archive.save(e).then(function () { if (archiveUI) archiveUI.refresh(); return true; }); } },
    settings: { load: function () { return D.settings.load('reader'); }, save: function (v) { return D.settings.save('reader', v); } },
    printPdf: function (html, name) { return D.printPdf(html, name); },
    pdfjs: loadPdfJs,
    pdfHelp: 'Per leggere i PDF serve PDF.js: nella cartella del progetto esegui “npm install” e riavvia l’app. Le versioni installate da GitHub lo contengono già.',
    ocr: OCR,
    ocrHelp: 'Per l’OCR serve Tesseract: nella cartella del progetto esegui “npm install” e riavvia l’app. Le versioni installate da GitHub lo contengono già.'
  });

  // ---------------------------------------------------------------- libreria
  var importSettings = {};
  var library = !D.library ? { refresh: function () {}, addFiles: function () {}, addFolder: function () {}, toast: function () {}, study: function () {} } : WCLibraryView.mount($('library'), {
    lib: D.library,
    importer: WCLibImport.create({ pdfjs: loadPdfJs, ocr: OCR, settings: function () { return importSettings; } }),
    workerUrl: new URL('../../core/library-worker.js', location.href).href,
    readerSettings: function () { return D.settings.load('reader'); },
    setImportSettings: function (s) { importSettings = s; },
    saveFile: function (name, content, mime) { return D.saveFile(name, content, mime); },
    showItem: D.showItem,
    // apre il documento nel Lettore; con focus, alla posizione del passaggio trovato
    openAt: function (p, name, focus) {
      show('reader');
      return D.library.read(p).then(function (f) { reader.openBytes(f.name, f.bytes, f.path, focus ? { focus: focus } : null); })
        .catch(function (e) { show('library'); library.toast('Non riesco ad aprire ' + name + ': ' + e.message); });
    }
  });

  // ---------------------------------------------------------------- scanner
  var scanner = WCScanView.mount($('scanner'), {
    roots: D.scan.roots, pickFolder: D.scan.pickFolder, start: D.scan.start, cancel: D.scan.cancel, onEvent: D.scan.onEvent,
    exportCsv: D.scan.exportCsv, showItem: D.showItem, saveFile: D.saveFile,
    history: D.scan.history, compare: D.scan.compare, trash: D.scan.trash,
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
    parts.push(el('h2', { text: 'Lingue' }));
    parts.push(el('p', { text: 'Italiano, inglese, francese, spagnolo, tedesco e portoghese. La lingua si riconosce da sola dalle parole più comuni (articoli, preposizioni…); per ognuna il ragno conosce le parole da ignorare, le abbreviazioni, i modi di scrivere una definizione e la formula di leggibilità adatta. Sa anche quanto ogni parola è comune nella lingua di tutti i giorni (elenchi di frequenza ricavati da OpenSubtitles): una parola rara ripetuta nel testo pesa di più di una parola comune.' }));
    parts.push(el('h2', { text: 'Ripasso' }));
    parts.push(el('p', { text: 'Dalle definizioni nascono schede del tipo “Che cos’è la cortina di ferro?”; dalle frasi chiave nascono frasi da completare, con il buco al posto del concetto, del nome o della data più importante. Quando nel testo ci sono abbastanza alternative dello stesso tipo, la scheda diventa una domanda a scelta multipla del quiz. Le schede si esportano per Anki.' }));
    parts.push(el('h2', { text: 'Penna' }));
    parts.push(el('p', { text: 'Nella colonna di sinistra: evidenzia, sottolinea, scrivi una nota o cancella. Trascina sulle parole del documento, anche nei PDF. I tuoi segni compaiono tra i risultati, si salvano nell’archivio e finiscono nelle esportazioni (nel file Word le note diventano commenti).' }));
    parts.push(el('h2', { text: 'OCR: PDF scansionati e immagini' }));
    parts.push(el('p', { text: 'Se un PDF non contiene testo (una scansione) o apri una foto di una pagina, il testo viene riconosciuto con Tesseract, un programma di OCR classico che riconosce le lettere senza intelligenza artificiale generativa. La prima volta scarica i dati della lingua (2–4 MB) da cdn.jsdelivr.net, poi li tiene e funziona anche senza internet. Le pagine riconosciute hanno l’etichetta OCR.' }));
    parts.push(el('h2', { text: 'Esportare' }));
    parts.push(el('p', { text: 'Dal pannello dei risultati: riepilogo (Markdown, testo, pagina web, dati), schede per Anki e il documento con tutti i segni, in Word (.docx), come pagina web o in PDF.' }));
    parts.push(el('h2', { text: 'Tasti rapidi mentre il ragno legge' }));
    var keys = el('dl');
    [['Spazio', 'pausa / riprendi'], ['Invio', 'completa subito la lettura'], ['+ e −', 'più veloce / più lento'], ['Esc', 'toglie il ragno'], ['Ctrl+O', 'apri un documento'], ['Ctrl+Maiusc+O', 'aggiungi documenti alla libreria'], ['Ctrl+Maiusc+S', 'studia la libreria'], ['Ctrl+1…4', 'Lettore, Libreria, Scanner, Archivio'], ['F1', 'questa guida']]
      .forEach(function (k) { keys.appendChild(el('dt', { text: k[0] })); keys.appendChild(el('dd', { text: k[1] })); });
    parts.push(keys);
    parts.push(el('h2', { text: 'Libreria' }));
    parts.push(el('p', { text: 'La libreria mette insieme tanti documenti: dispense, slide, libri, appunti, anche cartelle intere. Ogni file viene letto una volta (con l’OCR se è una scansione), diviso in passaggi (paragrafi, slide, voci di elenco, righe di tabella) e ogni passaggio ricorda da dove viene: file, pagina, slide, sezione. I file originali non vengono modificati.' }));
    parts.push(el('p', { text: 'Ricerca: guarda in tutti i documenti insieme. Riconosce le parole anche al plurale o coniugate, mette prima i passaggi che contengono più parole della domanda e trova una frase esatta se la scrivi tra virgolette. Se cerchi un concetto (per esempio una sigla), trova anche i passaggi che usano le sue altre forme. Ogni risultato si apre nel Lettore alla posizione esatta.' }));
    parts.push(el('p', { text: 'Concetti e mappa: le parole chiave, i nomi, i termini definiti e le sigle di ogni documento diventano concetti. Lo stesso concetto in documenti diversi diventa un nodo solo; una sigla scritta con la sua forma estesa (“Quadrature Amplitude Modulation (QAM)”) è riconosciuta come lo stesso concetto. I concetti che compaiono negli stessi passaggi sono collegati; dalle definizioni (“la QAM è una modulazione digitale…”) nasce il collegamento “è un tipo di”. Nella mappa i concetti centrali sono blu, quelli presenti in più documenti viola.' }));
    parts.push(el('p', { text: 'Hai sempre l’ultima parola: quando due concetti sembrano uguali ma non è sicuro, il ragno chiede prima di unirli. Puoi rinominare un concetto, aggiungere alias, unire o separare concetti, aggiungere o togliere collegamenti e spostare i nodi sulla mappa: le modifiche si salvano e restano anche quando aggiungi altri documenti.' }));
    parts.push(el('p', { text: 'La mappa è viva: i concetti continuano ad assestarsi, e se ne trascini uno i vicini si spostano di conseguenza. Rotella per ingrandire, trascina per spostarti, doppio clic o tasto 0 per inquadrare tutto, tasto R per rimescolare. Se nel sistema hai chiesto di ridurre le animazioni, la mappa resta ferma.' }));
    parts.push(el('h2', { text: 'Studio: ripassare quello che hai letto' }));
    parts.push(el('p', { text: 'Nella scheda Studio la libreria ti interroga sui concetti dei tuoi documenti. Le domande non se le inventa nessuno: nascono da quello che il ragno ha già estratto — un termine e la sua definizione, la definizione con il termine oscurato, una relazione “è un tipo di”, o una frase dove il concetto compare — e ognuna dice da quale documento, pagina o slide viene. Puoi aprire il passaggio nel Lettore mentre rispondi.' }));
    parts.push(el('p', { text: 'Puoi scrivere la risposta (accenti, maiuscole, plurali e un errore di battitura vanno bene lo stesso) oppure rivelarla e votarti da solo: di nuovo, difficile, bene, facile. Barra spaziatrice per vedere la risposta, da 1 a 4 per il voto. Più lo sai, più il ripasso si allontana nel tempo; se lo dimentichi, torna domani.' }));
    parts.push(el('p', { text: 'Il percorso di studio mette i concetti in ordine: prima quelli generali, poi quelli che ne dipendono, seguendo le definizioni che il ragno ha letto nei tuoi documenti. Sulla mappa, la spunta “Colora per padronanza” tinge ogni concetto dal grigio (mai visto) al verde (saldo), e fa pulsare quelli da ripassare. Le domande si possono esportare per Anki.' }));
    parts.push(el('h2', { text: 'Scanner del PC' }));
    parts.push(el('p', { text: 'Scegli un disco (per esempio C:) o una cartella: il ragno la percorre tutta e alla fine ti dà un rapporto con file, cartelle, spazio per estensione e per tipo, file e cartelle più grandi, duplicati, nomi ripetuti, file e cartelle vuoti, date, percorsi troppo lunghi e cartelle non leggibili.' }));
    parts.push(el('p', { text: 'La scansione è in sola lettura: il ragno elenca, misura e (per i duplicati) legge i file, ma non modifica, non sposta e non cancella niente. Non segue i collegamenti simbolici, così non gira in tondo. Le cartelle di sistema a cui Windows o macOS negano l’accesso vengono saltate e contate tra i “non leggibili”.' }));
    parts.push(el('p', { text: 'Su macOS, per analizzare tutto il disco, concedi a Word Crawler l’“Accesso completo al disco” in Impostazioni di Sistema → Privacy e sicurezza.' }));
    parts.push(el('p', { text: 'Nel rapporto: la mappa a riquadri mostra lo spazio occupato da ogni cartella (clic per entrare, “Su” per tornare); il confronto con una scansione precedente della stessa cartella mostra cosa è cresciuto, comparso o sparito.' }));
    parts.push(el('p', { text: 'Duplicati nel Cestino: è l’unica azione che cambia qualcosa sul disco, e solo se la chiedi tu. Scegli i file, conferma, e vengono spostati nel Cestino (non cancellati: si possono ripristinare). Prima di spostarli il programma controlla che esistano ancora con la stessa dimensione e tiene sempre almeno una copia di ogni gruppo. Ogni spostamento viene annotato in un registro.' }));
    parts.push(el('h2', { text: 'Dove finiscono i dati' }));
    var info = el('p', { text: 'Impostazioni, archivio, libreria e rapporti delle scansioni stanno nella cartella dati dell’app.' });
    parts.push(info);
    D.info().then(function (i) {
      info.textContent = 'Impostazioni, archivio, libreria e rapporti delle scansioni stanno in: ' + i.userData + '. PDF.js: ' + (i.pdfjs ? 'installato' : 'non installato (esegui npm install)') +
        '. Tesseract (OCR): ' + (i.ocr ? 'installato.' : 'non installato (esegui npm install).');
      $('version').textContent = 'v' + i.version;
    });
    parts.forEach(function (p) { g.appendChild(p); });
  })();

  // ---------------------------------------------------------------- schede
  var views = ['reader', 'library', 'scanner', 'archive', 'guide'];
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
    if (v === 'library') setTimeout(library.refresh, 0);
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
    else if (cmd === 'library:add-files') { show('library'); library.addFiles(); }
    else if (cmd === 'library:add-folder') { show('library'); library.addFolder(); }
    else if (cmd === 'library:study') { show('library'); library.study(); }
    else if (/^tab:/.test(cmd)) show(cmd.slice(4));
  });
  D.onFileOpened(function (f) { show('reader'); reader.openBytes(f.name, f.bytes, f.source); });
})();
