/*
 * Word Crawler: il lettore (condiviso tra app desktop ed estensione).
 * Apre un documento, lo mostra, lo fa leggere al ragno e raccoglie i risultati.
 *
 * WCReader.mount(root, host) -> { openBytes(name, bytes, source), openUrl(url), openText(text, title) }
 * host: {
 *   pickFile?(): Promise<{ name, bytes, source }|null>   (se manca: selettore file del browser)
 *   fetchUrl?(url): Promise<{ html, url }>                 (solo app desktop)
 *   saveFile(name, content, mime): Promise<boolean>
 *   archive: { save(entry): Promise<boolean> }
 *   settings: { load(): Promise<object|null>, save(object) }
 *   pdfjs(): Promise<pdfjsLib|null>, pdfHelp: string
 *   copy?(text)
 * }
 */
(function (g) {
  'use strict';
  if (g.WCReader) return;
  var el = function (t, a, c) { return g.WCSettingsUI.el(t, a, c); };

  var SAMPLE_TITLE = 'La guerra fredda in Europa';
  var SAMPLE = 'La guerra fredda è il periodo di tensione politica e militare che oppose gli Stati Uniti e l\'Unione Sovietica dalla fine della seconda guerra mondiale fino al 1991. Non fu mai uno scontro diretto tra le due superpotenze, ma una lunga competizione combattuta con le alleanze, la propaganda, la corsa agli armamenti e le guerre combattute in altri paesi.\n\n' +
    'Dopo il 1945 l\'Europa si trovò divisa in due blocchi. Da una parte gli Stati Uniti e i paesi dell\'Europa occidentale, dall\'altra l\'Unione Sovietica e i paesi dell\'Europa orientale. Si definisce cortina di ferro la linea immaginaria che separava i due blocchi: l\'espressione fu resa celebre da Winston Churchill in un discorso del 5 marzo 1946.\n\n' +
    'La Germania fu il simbolo di questa divisione. Il paese venne diviso in quattro zone di occupazione e la città di Berlino, pur trovandosi nella zona sovietica, venne a sua volta spartita tra le potenze vincitrici. Nel giugno del 1948 l\'Unione Sovietica bloccò le vie di accesso a Berlino Ovest. Gli Stati Uniti risposero con un ponte aereo che rifornì la città per quasi un anno, con più di 270.000 voli.\n\n' +
    'Nel 1949 nacquero due stati tedeschi: la Repubblica Federale Tedesca a ovest e la Repubblica Democratica Tedesca a est. Nello stesso anno fu fondata la NATO. La NATO è un\'alleanza militare tra gli Stati Uniti, il Canada e i paesi dell\'Europa occidentale, nata per difendersi da un eventuale attacco sovietico. L\'Unione Sovietica rispose nel 1955 con il Patto di Varsavia, che riuniva i paesi del blocco orientale.\n\n' +
    'La corsa agli armamenti rese la guerra fredda un confronto molto pericoloso. Gli Stati Uniti sganciarono le prime bombe atomiche nel 1945, e l\'Unione Sovietica fece esplodere la sua nel 1949. Da quel momento entrambe le superpotenze costruirono migliaia di testate nucleari. La deterrenza nucleare è la strategia secondo cui nessuno attacca per primo, perché sa che verrebbe distrutto dalla risposta dell\'avversario.\n\n' +
    'Il momento più pericoloso fu la crisi dei missili di Cuba, nell\'ottobre del 1962. Gli Stati Uniti scoprirono che l\'Unione Sovietica stava installando missili nucleari a Cuba, a pochi chilometri dalle coste americane. Per tredici giorni il mondo restò sull\'orlo di una guerra nucleare, finché Kennedy e Chruščëv trovarono un accordo e i missili furono ritirati.\n\n' +
    'Nel 1961 era stato costruito il muro di Berlino, che per quasi trent\'anni divise le famiglie e la città. Il muro impediva ai cittadini della Germania orientale di fuggire verso ovest. La caduta del muro, il 9 novembre 1989, segnò l\'inizio della fine della guerra fredda. Nel 1990 la Germania fu riunificata e l\'anno dopo, nel dicembre del 1991, l\'Unione Sovietica si dissolse.\n\n' +
    'La fine della guerra fredda cambiò profondamente l\'Europa. Molti paesi dell\'Europa orientale entrarono in seguito nella NATO e nell\'Unione Europea. Gli storici discutono ancora sulle cause della fine del conflitto: alcuni sottolineano la crisi economica sovietica, altri le riforme di Gorbačëv, altri ancora la pressione dei movimenti popolari nei paesi del blocco orientale.';

  function mount(root, host) {
    var settings = g.WCSettings.defaults();
    var doc = null;          // { title, format, source, model? , pdf? }
    var tokens = [], plan = null, results = null, engine = null, pages = [], io = null, offVer = 0, headings = [];
    var dirty = false;

    // ------------------------------------------------------------ struttura
    root.textContent = '';
    root.classList.add('wc-app');
    var fileInput = el('input', { type: 'file', accept: g.WCFormats.accept + ',application/pdf', hidden: 'hidden', id: 'wc-file' });
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
    var settingsBox = el('div', { class: 'wc-settings-box' });

    var left = el('aside', { class: 'wc-side wc-left', 'aria-label': 'Documento e impostazioni' }, [
      el('section', { class: 'wc-open' }, [el('h2', { text: 'Apri' }), openBtn, fileInput, urlForm, pasteBox,
        el('p', { class: 'wc-note', text: 'PDF, Word (.docx e .doc), OpenDocument, PowerPoint, Excel, EPUB, RTF, HTML, Markdown, testo, sottotitoli, CSV. Puoi anche trascinare il file qui.' })]),
      el('section', { class: 'wc-run' }, [el('h2', { text: 'Ragno' }), el('div', { class: 'wc-run-btns' }, [runBtn, pauseBtn, finishBtn, stopBtn]), dirtyNote]),
      el('section', {}, [el('h2', { text: 'Impostazioni' }), settingsBox])
    ]);

    var docHead = el('header', { class: 'wc-doc-head', hidden: 'hidden' });
    var article = el('article', { class: 'wc-article', hidden: 'hidden' });
    var pagesBox = el('div', { class: 'wc-pages', hidden: 'hidden' });
    var sampleBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Prova con un esempio' });
    var empty = el('div', { class: 'wc-empty' }, [
      el('div', { class: 'wc-empty-mark', 'aria-hidden': 'true' }),
      el('h1', { text: 'Dagli qualcosa da leggere' }),
      el('p', { text: 'Apri un file, incolla un testo o trascina qui un documento. Il ragno lo legge, sottolinea, cerchia e alla fine ti lascia il sunto.' }),
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
      values: settings, idPrefix: 'wcs',
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

    // ------------------------------------------------------------ risultati
    var rui = g.WCResultsUI.render(right, {
      idPrefix: 'wcr',
      onJump: jumpTo,
      onSave: function (entry) { return host.archive ? host.archive.save(entry) : false; },
      onExport: function (kind, entry) {
        var f = g.WCExport.build(kind, entry);
        return host.saveFile(f.name, f.content, f.mime);
      },
      onCopy: host.copy
    });

    // ------------------------------------------------------------ apertura
    function busy(msg) { rui.message(msg); }
    function showError(msg) {
      docMsg.textContent = msg;
      docMsg.hidden = false;
      busy(msg);
    }
    function resetDoc() {
      if (engine && engine.isActive()) engine.stop();
      engine = null;
      if (io) { io.disconnect(); io = null; }
      tokens = []; plan = null; results = null; pages = []; headings = [];
      article.textContent = ''; pagesBox.textContent = '';
      article.hidden = true; pagesBox.hidden = true; docHead.hidden = true; docMsg.hidden = true;
      empty.hidden = false;
      dirty = false; dirtyNote.hidden = true;
      rui.clear();
      setButtons();
    }

    async function openBytes(name, bytes, source) {
      resetDoc();
      busy('Apro ' + name + '…');
      var model;
      try { model = await g.WCFormats.open(bytes, name); }
      catch (e) { showError('Non riesco ad aprire “' + name + '”: ' + e.message); return; }
      model.source = source || name;
      if (model.pdf) return openPdf(model, bytes);
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
      doc = { title: model.title, format: model.format, source: model.source };
      empty.hidden = true;
      renderBlocks(model);
      article.hidden = false;
      header(model.format, model.warnings);
      window.scrollTo(0, 0);
      requestAnimationFrame(function () {
        tokens = g.WCDom.collect(article);
        if (!tokens.length) { showError('Nel documento non c’è testo da leggere.'); return; }
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

    async function openPdf(model, bytes) {
      var lib = host.pdfjs ? await host.pdfjs() : null;
      if (!lib) { showError(host.pdfHelp || 'Per leggere i PDF serve PDF.js.'); return; }
      var pdf;
      try { pdf = await lib.getDocument({ data: bytes.slice ? bytes.slice() : bytes, isEvalSupported: false }).promise; }
      catch (e) { showError(/password/i.test(e.message || '') ? 'Il PDF è protetto da password.' : 'PDF danneggiato o non leggibile: ' + e.message); return; }
      doc = { title: model.title, format: 'PDF', source: model.source };
      empty.hidden = true;
      header('PDF', [], pdf.numPages + (pdf.numPages === 1 ? ' pagina' : ' pagine'));
      var width = Math.max(320, Math.min(900, docEl.clientWidth - 48));
      pages = [];
      for (var p = 1; p <= pdf.numPages; p++) {
        if (p % 5 === 1) busy('Leggo la pagina ' + p + ' di ' + pdf.numPages + '…');
        var page = await pdf.getPage(p);
        var base = page.getViewport({ scale: 1 });
        var vp = page.getViewport({ scale: width / base.width });
        var P = { page: page, vp: vp, tc: await page.getTextContent(), rendering: false, ov: -1 };
        g.WCPdf.buildLines(P);
        pages.push(P);
      }
      try {
        var meta = await pdf.getMetadata();
        var t = meta && meta.info && meta.info.Title;
        if (t && String(t).trim().length > 2) { doc.title = String(t).trim(); header('PDF', [], pdf.numPages + (pdf.numPages === 1 ? ' pagina' : ' pagine')); }
      } catch (e) { /* titolo facoltativo */ }
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
      offVer++;
      tokens = g.WCPdf.tokens(pages, pageOffset);
      if (!tokens.length) { showError('Questo PDF non contiene testo: probabilmente è una scansione (solo immagini).'); return; }
      window.scrollTo(0, 0);
      run();
    }
    function pageOffset(P) {
      if (P.ov !== offVer) {
        var r = P.div.getBoundingClientRect();
        P.ox = r.left + window.scrollX; P.oy = r.top + window.scrollY; P.ov = offVer;
      }
      return [P.ox, P.oy];
    }
    function renderPage(P) {
      if (P.rendering) return;
      P.rendering = true;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var c = document.createElement('canvas');
      c.width = Math.floor(P.vp.width * dpr); c.height = Math.floor(P.vp.height * dpr);
      P.div.appendChild(c);
      P.page.render({ canvasContext: c.getContext('2d'), canvas: c, viewport: P.vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
        .promise.catch(function () { /* pagina non disegnata: il testo resta leggibile dal ragno */ });
    }

    // ------------------------------------------------------------ lettura
    function run() {
      if (!tokens.length) return;
      if (engine && engine.isActive()) engine.stop();
      dirty = false; dirtyNote.hidden = true;
      busy('Analizzo il testo…');
      var res = g.WCAnalysis.analyze(tokens, settings);
      plan = res.plan; results = res.results;
      headings = [];
      tokens.forEach(function (t, i) { if (t.w > 1 && (i === 0 || tokens[i - 1].blk !== t.blk)) headings.push(i); });
      rui.show(results, doc, tokens);
      var summaryTotal = results.summary.length;
      engine = g.WCEngine.start({
        tokens: tokens, sentences: plan.sentences, display: plan.display, settings: visualSettings(),
        container: docEl, keys: true, insetTop: host.insetTop || 0,
        label: function (n) {
          if (doc.format === 'PDF') {
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
        onStop: function () { setButtons(); },
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

    return {
      openBytes: openBytes, openUrl: openUrl, openText: openText,
      stop: function () { if (engine) engine.stop(); },
      pause: function () { if (engine && engine.isRunning()) { engine.pause(); setButtons(); } }
    };
  }

  g.WCReader = { mount: mount };
})(globalThis);
