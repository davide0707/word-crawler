// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: il lettore (condiviso tra app desktop ed estensione).
 * Apre un documento, lo mostra, lo fa leggere al ragno e raccoglie i risultati.
 *
 * WCReader.mount(root, host) -> { openBytes(name, bytes, source, opts), openUrl(url), openText(text, title), stop(), pause() }
 *   opts.focus: { text, page } apre il documento già letto, alla posizione di quel passaggio (dalla libreria)
 * host: {
 *   pickFile?(): Promise<{ name, bytes, source }|null>   (se manca: selettore file del browser)
 *   fetchUrl?(url): Promise<{ html, url }>                 (solo app desktop)
 *   saveFile(name, content, mime): Promise<boolean>        (content: stringa o Uint8Array)
 *   printPdf?(html, name): Promise<boolean>               (PDF del documento segnato)
 *   archive: { save(entry): Promise<boolean> }
 *   settings: { load(): Promise<object|null>, save(object) }
 *   pdfjs(): Promise<pdfjsLib|null>, pdfHelp: string
 *   ocr?: { script, workerPath, corePath, langPath? }      (percorsi di tesseract.js; senza: niente OCR)
 *   ocrHelp?: string
 *   exports?: formati di esportazione da offrire
 *   copy?(text), insetTop?
 * }
 *
 * Documenti lunghi: l'analisi va in un thread separato (analysis-worker.js), le pagine dei PDF
 * si leggono a gruppi in parallelo e le parole delle pagine web non tengono oggetti pesanti in memoria.
 */
(function (g) {
  'use strict';
  if (g.WCReader) return;
  var el = function (t, a, c) { return g.WCSettingsUI.el(t, a, c); };

  var WORKER_MIN = 6000;       // da quante parole in su l'analisi va nel thread separato
  var PDF_PARALLEL = 6;        // pagine lette insieme

  var SAMPLE_TITLE = 'La guerra fredda in Europa';
  var SAMPLE = 'La guerra fredda è il periodo di tensione politica e militare che oppose gli Stati Uniti e l\'Unione Sovietica dalla fine della seconda guerra mondiale fino al 1991. Non fu mai uno scontro diretto tra le due superpotenze, ma una lunga competizione combattuta con le alleanze, la propaganda, la corsa agli armamenti e le guerre combattute in altri paesi.\n\n' +
    'Dopo il 1945 l\'Europa si trovò divisa in due blocchi. Da una parte gli Stati Uniti e i paesi dell\'Europa occidentale, dall\'altra l\'Unione Sovietica e i paesi dell\'Europa orientale. Si definisce cortina di ferro la linea immaginaria che separava i due blocchi: l\'espressione fu resa celebre da Winston Churchill in un discorso del 5 marzo 1946.\n\n' +
    'La Germania fu il simbolo di questa divisione. Il paese venne diviso in quattro zone di occupazione e la città di Berlino, pur trovandosi nella zona sovietica, venne a sua volta spartita tra le potenze vincitrici. Nel giugno del 1948 l\'Unione Sovietica bloccò le vie di accesso a Berlino Ovest. Gli Stati Uniti risposero con un ponte aereo che rifornì la città per quasi un anno, con più di 270.000 voli.\n\n' +
    'Nel 1949 nacquero due stati tedeschi: la Repubblica Federale Tedesca a ovest e la Repubblica Democratica Tedesca a est. Nello stesso anno fu fondata la NATO. La NATO è un\'alleanza militare tra gli Stati Uniti, il Canada e i paesi dell\'Europa occidentale, nata per difendersi da un eventuale attacco sovietico. L\'Unione Sovietica rispose nel 1955 con il Patto di Varsavia, che riuniva i paesi del blocco orientale.\n\n' +
    'La corsa agli armamenti rese la guerra fredda un confronto molto pericoloso. Gli Stati Uniti sganciarono le prime bombe atomiche nel 1945, e l\'Unione Sovietica fece esplodere la sua nel 1949. Da quel momento entrambe le superpotenze costruirono migliaia di testate nucleari. La deterrenza nucleare è la strategia secondo cui nessuno attacca per primo, perché sa che verrebbe distrutto dalla risposta dell\'avversario.\n\n' +
    'Il momento più pericoloso fu la crisi dei missili di Cuba, nell\'ottobre del 1962. Gli Stati Uniti scoprirono che l\'Unione Sovietica stava installando missili nucleari a Cuba, a pochi chilometri dalle coste americane. Per tredici giorni il mondo restò sull\'orlo di una guerra nucleare, finché Kennedy e Chruščëv trovarono un accordo e i missili furono ritirati.\n\n' +
    'Nel 1961 era stato costruito il muro di Berlino, che per quasi trent\'anni divise le famiglie e la città. Il muro impediva ai cittadini della Germania orientale di fuggire verso ovest. La caduta del muro, il 9 novembre 1989, segnò l\'inizio della fine della guerra fredda. Nel 1990 la Germania fu riunificata e l\'anno dopo, nel dicembre del 1991, l\'Unione Sovietica si dissolse.\n\n' +
    'La fine della guerra fredda cambiò profondamente l\'Europa. Molti paesi dell\'Europa orientale entrarono in seguito nella NATO e nell\'Unione Europea. Gli storici discutono ancora sulle cause della fine del conflitto: alcuni sottolineano la crisi economica sovietica, altri le riforme di Gorbačëv, altri ancora la pressione dei movimenti popolari nei paesi del blocco orientale.';

  // esegue fn su ogni elemento, al massimo n alla volta, mantenendo l'ordine dei risultati
  function mapLimit(list, n, fn) {
    var out = new Array(list.length), next = 0;
    function worker() {
      if (next >= list.length) return Promise.resolve();
      var i = next++;
      return Promise.resolve(fn(list[i], i)).then(function (v) { out[i] = v; return worker(); });
    }
    var ws = [];
    for (var k = 0; k < Math.min(n, list.length); k++) ws.push(worker());
    return Promise.all(ws).then(function () { return out; });
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('immagine non leggibile')); };
      img.src = url;
    });
  }

  function mount(root, host) {
    var settings = g.WCSettings.defaults();
    var doc = null;          // { title, format, source }
    var tokens = [], plan = null, results = null, engine = null, pages = [], io = null, offVer = 0, headings = [];
    var pdfBytes = null; // i byte del PDF aperto: servono per scriverci dentro le annotazioni
    var dirty = false, openSeq = 0, runSeq = 0, userMarks = [], ocrEngine = null, objectUrls = [], focus = null;

    // ------------------------------------------------------------ struttura
    root.textContent = '';
    root.classList.add('wc-app');
    var fileInput = el('input', { type: 'file', accept: g.WCFormats.accept + ',application/pdf,image/*', hidden: 'hidden', id: 'wc-file' });
    var openBtn = el('button', { type: 'button', class: 'wc-btn wc-primary wc-wide', text: 'Apri un file' });
    var urlInput = el('input', { type: 'url', id: 'wc-url', placeholder: 'https://…', autocomplete: 'off', spellcheck: 'false' });
    var urlForm = el('form', { class: 'wc-url' }, [el('label', { for: 'wc-url', class: 'wc-label', text: 'Pagina web' }), el('div', { class: 'wc-inline' }, [urlInput, el('button', { type: 'submit', class: 'wc-btn', text: 'Leggi' })])]);
    var pasteArea = el('textarea', { id: 'wc-paste', rows: '5', placeholder: 'Incolla qui appunti, un capitolo, un articolo…' });
    var pasteBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Leggi questo testo' });
    var pasteBox = el('details', { class: 'wc-paste' }, [el('summary', { text: 'Incolla un testo' }), el('label', { for: 'wc-paste', class: 'wc-label', text: 'Testo' }), pasteArea, pasteBtn]);
    if (!host.fetchUrl) urlForm.hidden = true;

    var runBtn = el('button', { type: 'button', class: 'wc-btn wc-primary', text: 'Avvia', disabled: 'disabled' });
    var pauseBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Pausa', disabled: 'disabled' });
    var finishBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Completa ora', disabled: 'disabled', title: 'Salta l’animazione e mostra subito tutti i risultati (Invio)' });
    var stopBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Ferma', disabled: 'disabled', title: 'Toglie il ragno dalla pagina (Esc)' });
    var dirtyNote = el('p', { class: 'wc-dirty', hidden: 'hidden' }, [el('span', { text: 'Queste impostazioni cambiano i risultati: valgono dalla prossima lettura. ' })]);
    var dirtyBtn = el('button', { type: 'button', class: 'wc-link', text: 'Rileggi ora' });
    dirtyNote.appendChild(dirtyBtn);
    var progress = el('div', { class: 'wc-progress', hidden: 'hidden', role: 'progressbar', 'aria-label': 'Avanzamento', 'aria-valuemin': '0', 'aria-valuemax': '100' }, [el('span')]);
    var settingsBox = el('div', { class: 'wc-settings-box' });

    // penna
    var penBtns = {};
    var penTools = el('div', { class: 'wc-pen-tools', role: 'group', 'aria-label': 'Penna' });
    [['hl', 'Evidenzia'], ['under', 'Sottolinea'], ['note', 'Nota'], ['erase', 'Gomma']].forEach(function (t) {
      var b = el('button', { type: 'button', class: 'wc-btn', 'aria-pressed': 'false', disabled: 'disabled', title: t[1] + ': trascina sulle parole del documento' }, [el('span', { class: 'wc-pen-sw ' + t[0], 'aria-hidden': 'true' }), el('span', { text: t[1] })]);
      b.addEventListener('click', function () { pickTool(pen.tool() === t[0] ? null : t[0]); });
      penTools.appendChild(b);
      penBtns[t[0]] = b;
    });
    var penClear = el('button', { type: 'button', class: 'wc-link', text: 'Togli tutti i miei segni', hidden: 'hidden' });
    var penNote = el('p', { class: 'wc-note', text: 'Scegli uno strumento e trascina sulle parole (anche nei PDF). Esc per posare la penna. I segni finiscono nei risultati, nell’archivio e nelle esportazioni.' });

    var left = el('aside', { class: 'wc-side wc-left', 'aria-label': 'Documento e impostazioni' }, [
      el('section', { class: 'wc-open' }, [el('h2', { text: 'Apri' }), openBtn, fileInput, urlForm, pasteBox,
        el('p', { class: 'wc-note', text: 'PDF (anche scansionati), Word (.docx e .doc), OpenDocument, PowerPoint, Excel, EPUB, RTF, HTML, Markdown, testo, sottotitoli, CSV, immagini (PNG, JPG). Puoi anche trascinare il file qui.' })]),
      el('section', { class: 'wc-run' }, [el('h2', { text: 'Ragno' }), el('div', { class: 'wc-run-btns' }, [runBtn, pauseBtn, finishBtn, stopBtn]), progress, dirtyNote]),
      el('section', { class: 'wc-penbox' }, [el('h2', { text: 'Penna' }), penTools, penNote, penClear]),
      el('section', {}, [el('h2', { text: 'Impostazioni' }), settingsBox])
    ]);

    var docHead = el('header', { class: 'wc-doc-head', hidden: 'hidden' });
    var article = el('article', { class: 'wc-article', hidden: 'hidden' });
    var pagesBox = el('div', { class: 'wc-pages', hidden: 'hidden' });
    var sampleBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Prova con un esempio' });
    var empty = el('div', { class: 'wc-empty' }, [
      el('div', { class: 'wc-empty-mark', 'aria-hidden': 'true' }),
      el('h1', { text: 'Dagli qualcosa da leggere' }),
      el('p', { text: 'Apri un file, incolla un testo o trascina qui un documento. Il ragno lo legge, sottolinea, cerchia e alla fine ti lascia il sunto e le schede per ripassare.' }),
      el('div', { class: 'wc-inline' }, [sampleBtn]),
      el('p', { class: 'wc-note', text: 'Tutto resta sul tuo computer: nessun file viene inviato a nessuno e non c’è intelligenza artificiale.' })
    ]);
    var docMsg = el('p', { class: 'wc-doc-msg', role: 'alert', hidden: 'hidden' });
    var docEl = el('main', { class: 'wc-doc night', id: 'wc-doc', tabindex: '-1' }, [empty, docMsg, docHead, article, pagesBox]);

    var right = el('aside', { class: 'wc-side wc-right', 'aria-label': 'Risultati' });
    root.appendChild(left);
    root.appendChild(docEl);
    root.appendChild(right);

    // ------------------------------------------------------------ impostazioni
    var saveTimer = 0;
    var sui = g.WCSettingsUI.render(settingsBox, {
      values: settings, idPrefix: 'wcs', hide: (host.hideSettings || []).concat(['restoreMarks']).concat(host.ocr ? [] : ['ocr', 'ocrLang']),
      onChange: function (v, id) {
        var prev = settings;
        settings = v;
        applyTheme();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { if (host.settings) host.settings.save(settings); }, 400);
        var visualOnly = id !== 'preset' && id !== 'reset' && g.WCSettingsUI.VISUAL.has(id);
        if (engine && engine.isActive()) engine.setSettings(visualSettings());
        if (!visualOnly && tokens.length) {
          var changed = Object.keys(v).some(function (k) { return !g.WCSettingsUI.VISUAL.has(k) && v[k] !== prev[k]; });
          if (changed) { dirty = true; dirtyNote.hidden = false; }
        }
      }
    });
    if (host.settings) host.settings.load().then(function (v) {
      if (v) { settings = g.WCSettings.sanitize(v); sui.set(settings); applyTheme(); }
    }).catch(function () {});
    function visualSettings() {
      return { speed: settings.speed, legs: settings.legs, webDensity: settings.webDensity, veil: settings.veil, theme: settings.theme, hud: settings.hud, follow: settings.follow };
    }
    function applyTheme() {
      docEl.classList.toggle('paper', settings.theme === 'paper');
      docEl.classList.toggle('night', settings.theme !== 'paper');
    }
    applyTheme();

    // ------------------------------------------------------------ risultati ed esportazioni
    function annotated() { return g.WCAnnotate.capture(tokens, plan ? plan.sentences : [], userMarks); }
    var rui = g.WCResultsUI.render(right, {
      idPrefix: 'wcr',
      exports: host.exports || ['md', 'txt', 'html', 'anki', 'docx', 'ahtml'].concat(host.printPdf ? ['pdf'] : []).concat(g.WCPdfWrite ? ['pdfa'] : []).concat(['json']),
      onJump: jumpTo,
      onSave: function (entry) { return host.archive ? host.archive.save(entry) : false; },
      onExport: function (kind, entry) {
        var needsDoc = g.WCExport.KINDS.some(function (k) { return k[0] === kind && k[2]; });
        var model = needsDoc ? annotated() : null;
        if (kind === 'pdf') {
          if (!host.printPdf) return false;
          return host.printPdf(g.WCAnnotate.html(entry, model), g.WCExport.safeName(entry.title) + ' - segnato.pdf');
        }
        if (kind === 'pdfa') return exportPdfAnnots(entry);
        return Promise.resolve(g.WCExport.build(kind, entry, model)).then(function (f) { return host.saveFile(f.name, f.content, f.mime); });
      },
      onCopy: host.copy,
      onRemoveMark: function (id) { pen.remove(id); },
      onEditMark: function (id, x, y) { pen.edit(id, x, y); }
    });

    /*
     * Le evidenziazioni e le note diventano annotazioni vere dentro una copia del PDF di partenza:
     * si riaprono in Acrobat, in Anteprima, nel browser. Si usa il riquadro di ogni parola e la
     * conversione di PDF.js dallo schermo ai punti della pagina, così torna anche se la pagina è
     * ruotata. Se il PDF non si lascia modificare (pagine compresse, file protetto) lo si dice.
     */
    function pdfAnnots() {
      if (!pdfBytes || !pages.length || !g.WCPdfWrite) return [];
      var out = [];
      userMarks.forEach(function (m) {
        var perPage = new Map();
        for (var i = m.from; i < m.to && i < tokens.length; i++) {
          var t = tokens[i];
          if (!t || t.page == null) continue;
          var P = pages[t.page];
          if (!P || !P.vp || !P.vp.convertToPdfPoint) continue;
          var r = t.rect(), off = pageOffset(P);
          if (!r || !off) continue;
          var lx = r.x - off[0], ly = r.y - off[1];
          var a = P.vp.convertToPdfPoint(lx, ly), b = P.vp.convertToPdfPoint(lx + r.w, ly + r.h);
          var x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
          if (!perPage.has(t.page)) perPage.set(t.page, []);
          var list = perPage.get(t.page), last = list[list.length - 1];
          // parole sulla stessa riga: un quadrilatero solo, più pulito da leggere
          if (last && Math.abs(last[1] - y1) < 1.5 && x0 - last[2] < 12) { last[2] = Math.max(last[2], x1); last[0] = Math.min(last[0], x0); last[3] = Math.min(last[3], y0); }
          else list.push([x0, y1, x1, y0]);
        }
        perPage.forEach(function (boxes, pi) {
          var quads = boxes.map(function (q) { return [q[0], q[1], q[2], q[1], q[0], q[3], q[2], q[3]]; });
          out.push({
            page: pi, type: m.type === 'under' ? 'underline' : (m.type === 'note' ? 'highlight' : 'highlight'),
            quads: quads, color: m.type === 'note' ? '#ff8a3d' : '#ffd43b',
            contents: m.note || (m.type === 'note' ? m.text : '') || ''
          });
          if (m.type === 'note' && m.note) {
            var q0 = quads[0];
            out.push({ page: pi, type: 'note', rect: [q0[2], q0[1] - 18, q0[2] + 18, q0[1]], color: '#ff8a3d', contents: m.note });
          }
        });
      });
      return out;
    }
    function exportPdfAnnots(entry) {
      if (!pdfBytes) { busy('Le annotazioni dentro il file valgono solo per i PDF.'); return false; }
      var annots = pdfAnnots();
      if (!annots.length) { busy('Non ci sono evidenziazioni o note da scrivere nel PDF.'); return false; }
      try {
        var out = g.WCPdfWrite.annotate(pdfBytes, annots, { author: 'Word Crawler' });
        return host.saveFile(g.WCExport.safeName(entry.title) + ' - annotato.pdf', out, 'application/pdf');
      } catch (e) {
        busy(e.message + ' Puoi usare «Documento segnato, PDF», che ne stampa uno nuovo.');
        return false;
      }
    }

    // ------------------------------------------------------------ penna
    var pen = g.WCPen.attach({
      area: docEl,
      engine: function () { return engine && engine.isActive() ? engine : null; },
      tokens: function () { return tokens; },
      onChange: function (marks) {
        userMarks = marks;
        rui.setUserMarks(marks);
        penClear.hidden = !marks.length;
      },
      onTool: function (t) {
        Object.keys(penBtns).forEach(function (k) { penBtns[k].setAttribute('aria-pressed', k === t ? 'true' : 'false'); });
      }
    });
    function pickTool(t) {
      if (t) {
        if (!plan) return;
        // la penna lavora sui segni: se il ragno è stato tolto, i segni tornano senza animazione
        if (!engine || !engine.isActive()) startEngine(true);
        else if (engine.isRunning()) { engine.pause(); setButtons(); }
      }
      pen.setTool(t);
    }
    penClear.addEventListener('click', function () { pen.clear(); });

    // ------------------------------------------------------------ apertura
    function busy(msg) { rui.message(msg); }
    function setProgress(frac) {
      if (frac == null) { progress.hidden = true; return; }
      progress.hidden = false;
      var pc = Math.round(Math.max(0, Math.min(1, frac)) * 100);
      progress.firstChild.style.width = pc + '%';
      progress.setAttribute('aria-valuenow', String(pc));
    }
    function showError(msg) {
      setProgress(null);
      docMsg.textContent = msg;
      docMsg.hidden = false;
      busy(msg);
    }
    function resetDoc() {
      openSeq++;
      runSeq++;
      if (engine && engine.isActive()) engine.stop();
      engine = null;
      pen.setTool(null);
      if (io) { io.disconnect(); io = null; }
      objectUrls.forEach(function (u) { URL.revokeObjectURL(u); });
      objectUrls = [];
      tokens = []; plan = null; results = null; pages = []; headings = []; pdfBytes = null;
      userMarks = [];
      pen.setMarks([]);
      article.textContent = ''; pagesBox.textContent = '';
      article.hidden = true; pagesBox.hidden = true; docHead.hidden = true; docMsg.hidden = true;
      empty.hidden = false;
      dirty = false; dirtyNote.hidden = true;
      setProgress(null);
      rui.clear();
      setButtons();
    }

    async function openBytes(name, bytes, source, opts) {
      resetDoc();
      focus = opts && opts.focus && opts.focus.text ? opts.focus : null;
      busy('Apro ' + name + '…');
      var model;
      try { model = await g.WCFormats.open(bytes, name); }
      catch (e) { showError('Non riesco ad aprire “' + name + '”: ' + e.message); return; }
      model.source = source || name;
      if (model.pdf) return openPdf(model, bytes);
      if (model.image) return openImage(model, bytes);
      showModel(model);
    }
    async function openUrl(url) {
      if (!host.fetchUrl) return;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      resetDoc();
      busy('Scarico ' + url + '…');
      try {
        var res = await host.fetchUrl(url);
        if (res.pdf) return openBytes(res.name || 'documento.pdf', res.bytes, res.url);
        var model = g.WCFormats.fromHtml(res.html, 'Pagina web');
        model.source = res.url || url;
        if (!model.blocks.length) throw new Error('nella pagina non ho trovato testo da leggere');
        showModel(model);
      } catch (e) { showError('Non riesco a leggere ' + url + ': ' + e.message); }
    }
    function openText(text, title) {
      resetDoc();
      var model = /^\s*#{1,6}\s/m.test(text) ? g.WCFormats.fromMarkdown(text) : g.WCFormats.fromPlain(text, 'Testo incollato');
      if (title) model.title = title;
      model.source = title ? 'esempio' : 'testo incollato';
      model.format = title ? 'Esempio' : 'Testo incollato';
      showModel(model);
    }

    function renderBlocks(model) {
      article.textContent = '';
      var first = model.blocks[0];
      if (model.title && !(first && first.type === 'h' && first.text === model.title)) {
        article.appendChild(el('h1', { text: model.title }));
      }
      var list = null;
      model.blocks.forEach(function (b) {
        var node;
        if (b.type === 'li') {
          if (!list) { list = el('ul'); article.appendChild(list); }
          node = el('li');
          fill(node, b);
          list.appendChild(node);
          return;
        }
        list = null;
        if (b.type === 'h') node = el('h' + Math.min(3, Math.max(1, b.level || 2)));
        else if (b.type === 'quote') node = el('blockquote');
        else if (b.type === 'pre') node = el('pre');
        else if (b.type === 'row') node = el('p', { class: 'wc-rowblk' });
        else node = el('p');
        fill(node, b);
        article.appendChild(node);
      });
      function fill(node, b) {
        if (!b.runs) { node.textContent = b.text; return; }
        b.runs.forEach(function (r) {
          var t = document.createTextNode(r.t);
          if (r.b && r.i) node.appendChild(el('strong', {}, [el('em', {}, [t])]));
          else if (r.b) node.appendChild(el('strong', {}, [t]));
          else if (r.i) node.appendChild(el('em', {}, [t]));
          else node.appendChild(t);
        });
      }
    }

    function showModel(model) {
      var my = openSeq;
      doc = { title: model.title, format: model.format, source: model.source };
      empty.hidden = true;
      renderBlocks(model);
      article.hidden = false;
      header(model.format, model.warnings);
      window.scrollTo(0, 0);
      requestAnimationFrame(function () {
        if (my !== openSeq) return;
        tokens = g.WCDom.collect(article);
        if (!tokens.length) { showError('Nel documento non c’è testo da leggere.'); return; }
        if (tokens.truncated) header(model.format, (model.warnings || []).concat(['Documento lunghissimo: il ragno legge le prime ' + tokens.length.toLocaleString('it-IT') + ' parole.']));
        run();
      });
    }

    function header(format, warnings, extra) {
      docHead.textContent = '';
      docHead.appendChild(el('p', { class: 'wc-doc-kind', text: [format, extra].filter(Boolean).join(' · ') }));
      docHead.appendChild(el('p', { class: 'wc-doc-title', text: doc.title || 'Senza titolo' }));
      if (doc.source && doc.source !== doc.title) docHead.appendChild(el('p', { class: 'wc-doc-src', text: doc.source }));
      (warnings || []).forEach(function (w) { docHead.appendChild(el('p', { class: 'wc-doc-warn', text: w })); });
      docHead.hidden = false;
    }

    // ------------------------------------------------------------ OCR
    function ocrOn() { return !!(host.ocr && settings.ocr); }
    function ocrHelp() {
      return host.ocr ? 'Il riconoscimento del testo (OCR) è spento: attivalo nelle impostazioni, nel gruppo OCR.'
        : (host.ocrHelp || 'Qui l’OCR non è disponibile.');
    }
    function recognize(source, label) {
      if (!ocrEngine) ocrEngine = g.WCOcr.create(host.ocr);
      return ocrEngine.recognize(source, g.WCOcr.langsFor(settings), function (phase, p) {
        busy(label + ' · ' + phase + (p ? ' ' + Math.round(p * 100) + '%' : '') + '…');
      });
    }
    // immagine pronta per Tesseract: le immagini piccole si ingrandiscono, quelle enormi si riducono
    function ocrSource(img, w, h) {
      var target = w < 1400 ? Math.min(2, 2000 / w) : (w > 3600 ? 3600 / w : 1);
      if (target === 1) return { src: img, w: w, h: h };
      var c = document.createElement('canvas');
      c.width = Math.round(w * target); c.height = Math.round(h * target);
      var cx = c.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
      cx.drawImage(img, 0, 0, c.width, c.height);
      return { src: c, w: c.width, h: c.height };
    }

    async function openImage(model, bytes) {
      var my = openSeq;
      doc = { title: model.title, format: 'Immagine', source: model.source };
      empty.hidden = true;
      header('Immagine', [], 'OCR');
      if (!ocrOn()) { showError('Per leggere il testo in un’immagine serve l’OCR. ' + ocrHelp()); return; }
      var url = URL.createObjectURL(new Blob([bytes], { type: model.mime }));
      objectUrls.push(url);
      var img;
      try { img = await loadImage(url); } catch (e) { showError('Non riesco a mostrare questa immagine: ' + e.message); return; }
      if (my !== openSeq) return;
      var width = Math.max(320, Math.min(900, docEl.clientWidth - 48));
      var scale = width / img.naturalWidth;
      var d = el('div', { class: 'wc-page', 'aria-label': 'Immagine' }, [el('span', { class: 'wc-ocr-badge', text: 'OCR' })]);
      d.style.width = width + 'px';
      d.style.height = (img.naturalHeight * scale) + 'px';
      img.alt = '';
      d.appendChild(img);
      pagesBox.textContent = '';
      pagesBox.appendChild(d);
      pagesBox.hidden = false;
      var P = { vp: { width: width, height: img.naturalHeight * scale, scale: scale }, div: d, ov: -1, ocr: true };
      pages = [P];
      try {
        var s = ocrSource(img, img.naturalWidth, img.naturalHeight);
        setProgress(0);
        var res = await recognize(s.src, 'Immagine');
        if (my !== openSeq) return;
        P.lines = g.WCOcr.toLines(res.words, width / s.w, width / s.w, scale);
      } catch (e) { showError('OCR non riuscito: ' + e.message + '. ' + (host.ocr ? '' : ocrHelp())); return; }
      setProgress(null);
      offVer++;
      tokens = g.WCPdf.tokens(pages, pageOffset);
      if (!tokens.length) { showError('Nell’immagine non ho trovato testo leggibile.'); return; }
      header('Immagine', [], 'testo riconosciuto con l’OCR (Tesseract)');
      window.scrollTo(0, 0);
      run();
    }

    // ------------------------------------------------------------ PDF
    async function openPdf(model, bytes) {
      var my = openSeq;
      pdfBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      var lib = host.pdfjs ? await host.pdfjs() : null;
      if (!lib) { showError(host.pdfHelp || 'Per leggere i PDF serve PDF.js.'); return; }
      var pdf;
      try { pdf = await lib.getDocument({ data: bytes.slice ? bytes.slice() : bytes, isEvalSupported: false }).promise; }
      catch (e) { showError(/password/i.test(e.message || '') ? 'Il PDF è protetto da password.' : 'PDF danneggiato o non leggibile: ' + e.message); return; }
      if (my !== openSeq) return;
      doc = { title: model.title, format: 'PDF', source: model.source };
      empty.hidden = true;
      var nPages = pdf.numPages;
      var pagesLabel = nPages + (nPages === 1 ? ' pagina' : ' pagine');
      header('PDF', [], pagesLabel);
      var width = Math.max(320, Math.min(900, docEl.clientWidth - 48));
      var nums = [];
      for (var p = 1; p <= nPages; p++) nums.push(p);
      var done = 0;
      setProgress(0);
      // pagine lette a gruppi in parallelo (con i documenti lunghi è molto più veloce)
      try {
        pages = await mapLimit(nums, PDF_PARALLEL, async function (num) {
          if (my !== openSeq) throw new Error('annullato');
          var page = await pdf.getPage(num);
          var base = page.getViewport({ scale: 1 });
          var vp = page.getViewport({ scale: width / base.width });
          var P = { page: page, vp: vp, base: base, tc: await page.getTextContent(), rendering: false, ov: -1 };
          g.WCPdf.buildLines(P);
          P.tc = null; // il testo grezzo non serve più
          done++;
          setProgress(done / nPages);
          if (done % 10 === 0 || done === nPages) busy('Leggo le pagine: ' + done + ' di ' + nPages + '…');
          return P;
        });
      } catch (e) {
        if (my === openSeq) showError('Non riesco a leggere il PDF: ' + e.message);
        return;
      }
      if (my !== openSeq) return;
      try {
        var meta = await pdf.getMetadata();
        var t = meta && meta.info && meta.info.Title;
        if (t && String(t).trim().length > 2) doc.title = String(t).trim();
      } catch (e) { /* titolo facoltativo */ }
      header('PDF', [], pagesLabel);
      pagesBox.textContent = '';
      pages.forEach(function (P, i) {
        var d = el('div', { class: 'wc-page', 'aria-label': 'Pagina ' + (i + 1) });
        d.style.width = P.vp.width + 'px';
        d.style.height = P.vp.height + 'px';
        P.div = d;
        pagesBox.appendChild(d);
      });
      pagesBox.hidden = false;
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          for (var k = 0; k < pages.length; k++) if (pages[k].div === en.target) renderPage(pages[k]);
        });
      }, { rootMargin: '1500px 0px' });
      pages.forEach(function (P) { io.observe(P.div); });

      // pagine senza testo: scansioni. Si riconosce il testo con l'OCR.
      var scanned = pages.filter(function (P) { return !P.lines.some(function (l) { return /[\p{L}\p{N}]{2}/u.test(l.str); }); });
      if (scanned.length) {
        if (!ocrOn()) {
          if (scanned.length === pages.length) { showError('Questo PDF non contiene testo: è una scansione (solo immagini). ' + ocrHelp()); return; }
          header('PDF', [scanned.length + ' pagine sono scansioni senza testo: le salto. ' + ocrHelp()], pagesLabel);
        } else {
          for (var k = 0; k < scanned.length; k++) {
            if (my !== openSeq) return;
            var S = scanned[k];
            var label = 'OCR pagina ' + (pages.indexOf(S) + 1) + ' (' + (k + 1) + ' di ' + scanned.length + ')';
            busy(label + '…');
            setProgress(k / scanned.length);
            try {
              var c = await renderForOcr(S);
              var res = await recognize(c, label);
              S.lines = g.WCOcr.toLines(res.words, S.vp.width / c.width, S.vp.width / c.width, S.vp.scale);
              S.ocr = true;
              S.div.appendChild(el('span', { class: 'wc-ocr-badge', text: 'OCR' }));
            } catch (e) {
              showError('OCR non riuscito: ' + e.message);
              return;
            }
          }
          header('PDF', [], pagesLabel + ' · ' + scanned.length + (scanned.length === 1 ? ' pagina riconosciuta' : ' pagine riconosciute') + ' con l’OCR');
        }
      }
      setProgress(null);
      offVer++;
      tokens = g.WCPdf.tokens(pages, pageOffset);
      if (!tokens.length) { showError('In questo PDF non ho trovato testo da leggere.'); return; }
      window.scrollTo(0, 0);
      run();
    }
    // pagina disegnata a circa 200 dpi per l'OCR
    function renderForOcr(P) {
      var scale = Math.min(3, 2200 / P.base.width);
      var vp = P.page.getViewport({ scale: scale });
      var c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      var cx = c.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
      return P.page.render({ canvasContext: cx, canvas: c, viewport: vp }).promise.then(function () { return c; });
    }
    function pageOffset(P) {
      if (P.ov !== offVer) {
        var r = P.div.getBoundingClientRect();
        P.ox = r.left + window.scrollX; P.oy = r.top + window.scrollY; P.ov = offVer;
      }
      return [P.ox, P.oy];
    }
    function renderPage(P) {
      if (P.rendering || !P.page) return;
      P.rendering = true;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var c = document.createElement('canvas');
      c.width = Math.floor(P.vp.width * dpr); c.height = Math.floor(P.vp.height * dpr);
      P.div.insertBefore(c, P.div.firstChild);
      P.page.render({ canvasContext: c.getContext('2d'), canvas: c, viewport: P.vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
        .promise.catch(function () { /* pagina non disegnata: il testo resta leggibile dal ragno */ });
    }

    // ------------------------------------------------------------ analisi (nel thread separato per i testi lunghi)
    function analyzeInWorker(list, s) {
      return new Promise(function (resolve, reject) {
        var w;
        try { w = new Worker(g.WCLang.base() + 'analysis-worker.js'); } catch (e) { reject(e); return; }
        var timer = setTimeout(function () { w.terminate(); reject(new Error('analisi troppo lunga')); }, 180000);
        w.onmessage = function (e) {
          clearTimeout(timer);
          w.terminate();
          var d = e.data;
          if (!d || d.error) { reject(new Error(d ? d.error : 'errore')); return; }
          var m = d.marks, groups = new Map();
          for (var i = 0; i < list.length; i++) {
            var t = list[i];
            t.mk = m.mk[i]; t.kid = m.kid[i]; t.sid = m.sid[i];
            if (m.gf[i] >= 0) {
              var key = m.gf[i] * 4294967296 + m.gt[i];
              var grp = groups.get(key);
              if (!grp) { grp = { from: m.gf[i], to: m.gt[i] }; groups.set(key, grp); }
              t.grp = grp;
            } else t.grp = null;
          }
          var sents = d.sents.map(function (a, k) { return { id: k, from: a[0], to: a[1], mk: a[2] }; });
          resolve({ plan: { sentences: sents, display: function (id) { return d.display[id] || id; } }, results: d.results });
        };
        w.onerror = function (e) { clearTimeout(timer); w.terminate(); reject(new Error(e.message || 'thread di analisi non disponibile')); };
        w.postMessage({
          id: Date.now(), settings: s, tail: list[list.length - 1].tail || '',
          tokens: list.map(function (t) { return [t.text, t.gap, t.blk, t.w, t.page == null ? null : t.page]; })
        });
      });
    }
    function analyze(list, s) {
      var lang = s.language && s.language !== 'auto' ? s.language : g.WCLang.detect(list);
      function inline() { return g.WCLang.ensure(lang).then(function () { return g.WCAnalysis.analyze(list, s); }); }
      if (list.length >= WORKER_MIN && typeof Worker !== 'undefined' && !host.noWorker && g.WCLang.base()) {
        return analyzeInWorker(list, s).catch(inline);
      }
      return inline();
    }

    // ------------------------------------------------------------ lettura
    async function run() {
      if (!tokens.length) return;
      var my = ++runSeq;
      if (engine && engine.isActive()) engine.stop();
      dirty = false; dirtyNote.hidden = true;
      busy('Analizzo il testo' + (tokens.length >= WORKER_MIN ? ' (' + tokens.length.toLocaleString('it-IT') + ' parole)' : '') + '…');
      var res;
      try { res = await analyze(tokens, settings); }
      catch (e) { if (my === runSeq) showError('Analisi non riuscita: ' + e.message); return; }
      if (my !== runSeq) return;
      plan = res.plan; results = res.results;
      headings = [];
      tokens.forEach(function (t, i) { if (t.w > 1 && (i === 0 || tokens[i - 1].blk !== t.blk)) headings.push(i); });
      rui.show(results, doc, tokens);
      rui.setUserMarks(userMarks);
      startEngine(false);
      if (focus) { var f = focus; focus = null; applyFocus(f); }
    }

    // passaggio cercato nella libreria: lettura completata subito, poi il passaggio evidenziato
    function findPassage(f) {
      var want = [], m, re = new RegExp(g.WCText.WORD.source, 'gu');
      while ((m = re.exec(f.text)) && want.length < 12) want.push(g.WCText.fold(m[0]));
      if (!want.length) return -1;
      var n = Math.min(want.length, 8), best = -1, bestScore = 0;
      for (var i = 0; i < tokens.length; i++) {
        if (g.WCText.fold(tokens[i].text) !== want[0]) continue;
        var sc = 0;
        for (var k = 0; k < n && i + k < tokens.length; k++) if (g.WCText.fold(tokens[i + k].text) === want[k]) sc++;
        if (f.page != null && tokens[i].page === f.page) sc += 0.5;
        if (sc > bestScore) { bestScore = sc; best = i; }
        if (sc >= n) break;
      }
      return bestScore >= Math.min(3, n) ? best : -1;
    }
    function applyFocus(f) {
      var idx = findPassage(f);
      if (idx < 0 && f.page != null) idx = tokens.findIndex(function (t) { return t.page === f.page; });
      if (idx < 0) return;
      if (engine && engine.isActive()) engine.finish();
      setButtons();
      var len = Math.max(1, (f.text.match(new RegExp(g.WCText.WORD.source, 'gu')) || []).length);
      setTimeout(function () {
        jumpTo(idx);
        if (engine && engine.setPreview) {
          engine.setPreview({ from: idx, to: Math.min(tokens.length, idx + len), type: 'hl' });
          setTimeout(function () { if (engine && engine.setPreview) engine.setPreview(null); }, 4000);
        }
      }, 60);
    }

    function startEngine(isStatic) {
      var summaryTotal = results.summary.length;
      engine = g.WCEngine.start({
        tokens: tokens, sentences: plan.sentences, display: plan.display, settings: visualSettings(),
        container: docEl, keys: true, insetTop: host.insetTop || 0, static: isStatic, userMarks: userMarks,
        hint: isStatic ? 'PENNA · trascina sulle parole · ESC posa la penna' : undefined,
        label: function (n) {
          if (doc.format === 'PDF' || doc.format === 'Immagine') {
            var t = tokens[Math.max(0, n - 1)];
            var p = t && t.page != null ? t.page + 1 : 1;
            return 'PAGE -- ' + String(p).padStart(2, '0') + ' / ' + String(pages.length).padStart(2, '0');
          }
          if (headings.length > 1) {
            var k = 0;
            while (k < headings.length && headings[k] < n) k++;
            return 'SECTION -- ' + Math.max(1, k) + ' / ' + headings.length;
          }
          return 'DOC -- ' + String(doc.format || 'TEXT').toUpperCase();
        },
        modeLine: function (c) {
          if (settings.mode === 'study') return 'UNDERLINED ' + String(c.key).padStart(3, '0') + ' · DEFINITIONS ' + String(c.def).padStart(3, '0');
          if (settings.mode === 'summary') return 'SUMMARY ' + String(c.key).padStart(3, '0') + ' / ' + String(summaryTotal).padStart(3, '0');
          if (settings.mode === 'search') return 'MATCHES ' + String(c.term).padStart(3, '0');
          return null;
        },
        onProgress: function (n) { rui.progress(n); },
        onEnd: function () { rui.done(); setButtons(); },
        onStop: function () { pen.setTool(null); setButtons(); },
        onSettings: function (s) { settings.speed = s.speed; sui.set(settings); }
      });
      setButtons();
    }

    function setButtons() {
      var has = tokens.length > 0;
      var live = !!(engine && engine.isActive());
      runBtn.disabled = !has;
      runBtn.textContent = live || (results && engine) ? 'Rileggi' : 'Avvia';
      pauseBtn.disabled = !live || engine.isEnded();
      pauseBtn.textContent = live && !engine.isRunning() && !engine.isEnded() ? 'Riprendi' : 'Pausa';
      finishBtn.disabled = !live || engine.isEnded();
      stopBtn.disabled = !live;
      Object.keys(penBtns).forEach(function (k) { penBtns[k].disabled = !plan; });
    }
    setInterval(setButtons, 500);

    function jumpTo(idx) {
      var t = tokens[idx];
      if (!t) return;
      if (engine && engine.isRunning()) { engine.pause(); setButtons(); }
      var r = t.rect && t.rect();
      if (!r) return;
      window.scrollTo(window.scrollX, Math.max(0, r.y - window.innerHeight * 0.4));
      var mark = el('div', { class: 'wc-flash', 'aria-hidden': 'true' });
      mark.style.left = (r.x - 6) + 'px'; mark.style.top = (r.y - 4) + 'px';
      mark.style.width = (r.w + 12) + 'px'; mark.style.height = (r.h + 8) + 'px';
      document.body.appendChild(mark);
      setTimeout(function () { mark.remove(); }, 1600);
    }

    // ------------------------------------------------------------ eventi
    openBtn.addEventListener('click', async function () {
      if (host.pickFile) {
        var f = await host.pickFile();
        if (f) openBytes(f.name, f.bytes, f.source);
      } else fileInput.click();
    });
    fileInput.addEventListener('change', async function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (f) openBytes(f.name, new Uint8Array(await f.arrayBuffer()), f.name);
    });
    urlForm.addEventListener('submit', function (e) { e.preventDefault(); var v = urlInput.value.trim(); if (v) openUrl(v); });
    pasteBtn.addEventListener('click', function () { var v = pasteArea.value.trim(); if (v) openText(v); else pasteArea.focus(); });
    sampleBtn.addEventListener('click', function () { openText(SAMPLE_TITLE + '\n\n' + SAMPLE, SAMPLE_TITLE); });
    runBtn.addEventListener('click', function () { window.scrollTo(0, 0); run(); });
    dirtyBtn.addEventListener('click', function () { window.scrollTo(0, 0); run(); });
    pauseBtn.addEventListener('click', function () { if (engine) { engine.toggle(); setButtons(); } });
    finishBtn.addEventListener('click', function () { if (engine) { engine.finish(); setButtons(); } });
    stopBtn.addEventListener('click', function () { if (engine) engine.stop(); setButtons(); });
    window.addEventListener('resize', function () { offVer++; });
    window.addEventListener('dragover', function (e) { e.preventDefault(); root.classList.add('wc-drag'); });
    window.addEventListener('dragleave', function (e) { if (!e.relatedTarget) root.classList.remove('wc-drag'); });
    window.addEventListener('drop', async function (e) {
      e.preventDefault();
      root.classList.remove('wc-drag');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) openBytes(f.name, new Uint8Array(await f.arrayBuffer()), f.path || f.name);
    });
    window.addEventListener('beforeunload', function () { if (ocrEngine) ocrEngine.terminate(); });

    return {
      openBytes: openBytes, openUrl: openUrl, openText: openText, focus: applyFocus,
      stop: function () { if (engine) engine.stop(); },
      pause: function () { if (engine && engine.isRunning()) { engine.pause(); setButtons(); } },
      // per i test e l'app: stato attuale
      state: function () { return { tokens: tokens.length, results: results, userMarks: userMarks.slice(), engine: !!(engine && engine.isActive()), pages: pages.length }; },
      debug: function () { return { tokens: tokens, plan: plan, pages: pages, engine: engine }; },
      pen: pen
    };
  }

  g.WCReader = { mount: mount };
})(globalThis);
