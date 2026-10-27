// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/* Word Crawler (estensione): pannello laterale. Comanda il ragno nella scheda e mostra i risultati. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var CONTENT = globalThis.WC_CONTENT;
  var CODES = ['it', 'en', 'fr', 'es', 'de', 'pt'];
  var READER = chrome.runtime.getURL('reader.html');
  var DOC_RE = /\.(pdf|docx?|odt|odp|ods|pptx|xlsx|epub|rtf|md|txt|srt|vtt|csv|png|jpe?g|webp|bmp|gif)(\?|#|$)/i;
  var tabId = null, tabUrl = '', settings = WCSettings.defaults(), live = { active: false, running: false, ended: false }, hasResults = false;

  var sui = WCSettingsUI.render($('settings'), {
    values: settings, idPrefix: 'sp', hide: ['ocr', 'ocrLang'],
    onChange: function (v, id) {
      settings = v;
      WCStore.saveSettings(v);
      if (tabId !== null && live.active) {
        if (WCSettingsUI.VISUAL.has(id)) chrome.tabs.sendMessage(tabId, { type: 'wc:visual', settings: v }).catch(function () {});
        else say('Le nuove impostazioni valgono dalla prossima lettura: premi “Leggi di nuovo”.');
      }
    }
  });
  WCStore.loadSettings().then(function (v) { if (v) { settings = WCSettings.sanitize(v); sui.set(settings); } });

  function toTab(msg) { return tabId === null ? Promise.resolve(null) : chrome.tabs.sendMessage(tabId, msg).catch(function () { return null; }); }
  var rui = WCResultsUI.render($('results'), {
    idPrefix: 'spr',
    exports: ['md', 'txt', 'html', 'anki', 'docx', 'ahtml', 'pdf', 'json'],
    onJump: function (idx) { toTab({ type: 'wc:jump', idx: idx }); },
    onSave: function (entry) { return WCStore.save(entry); },
    onExport: function (kind, entry) {
      var needsDoc = WCExport.KINDS.some(function (k) { return k[0] === kind && k[2]; });
      // il documento segnato lo prepara la pagina (ha le parole e i segni)
      return (needsDoc ? toTab({ type: 'wc:annotated' }) : Promise.resolve(null)).then(function (model) {
        if (kind === 'pdf') return WCStore.printPdf(WCAnnotate.html(entry, model));
        return Promise.resolve(WCExport.build(kind, entry, model)).then(function (f) { return WCStore.download(f.name, f.content, f.mime); });
      });
    },
    onRemoveMark: function (id) { toTab({ type: 'wc:mark-remove', id: id }); },
    onEditMark: function (id) { toTab({ type: 'wc:mark-edit', id: id }); }
  });

  // penna
  var penBtns = Array.prototype.slice.call(document.querySelectorAll('#pen [data-tool]'));
  function paintPen(tool) { penBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.tool === tool ? 'true' : 'false'); }); }
  penBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      var on = b.getAttribute('aria-pressed') === 'true';
      toTab({ type: 'wc:pen', tool: on ? null : b.dataset.tool, settings: settings });
      paintPen(on ? null : b.dataset.tool);
    });
  });

  function say(m) { $('msg').textContent = m || ''; }
  function buttons() {
    $('run').textContent = live.active || live.ended ? 'Leggi di nuovo' : 'Leggi questa pagina';
    $('pause').disabled = !live.active || live.ended;
    penBtns.forEach(function (b) { b.disabled = !hasResults; });
    $('pause').textContent = live.active && !live.running && !live.ended ? 'Riprendi' : 'Pausa';
    $('finish').disabled = !live.active || live.ended;
    $('stop').disabled = !live.active;
  }

  // ?tab=<id>: pannello legato a una scheda precisa (usato anche dai test automatici)
  var fixedTab = +new URLSearchParams(location.search).get('tab') || null;
  async function currentTab() {
    var tab = fixedTab ? await chrome.tabs.get(fixedTab).catch(function () { return null; }) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    tabId = tab ? tab.id : null;
    tabUrl = tab ? tab.url || '' : '';
    $('page-title').textContent = tab ? (tab.title || tabUrl) : '—';
    live = { active: false, running: false, ended: false };
    hasResults = false;
    paintPen(null);
    rui.clear();
    say('');
    if (tabId === null) return;
    if (/^(chrome|edge|about|brave|chrome-extension|devtools|view-source):/.test(tabUrl) && tabUrl.indexOf(READER) !== 0) {
      say('Le pagine interne del browser non si possono leggere. Apri un sito, oppure un documento con “Apri un documento”.');
    }
    try {
      var st = await chrome.tabs.sendMessage(tabId, { type: 'wc:state' });
      if (st) {
        rui.show(st.results, st.doc, { total: st.total, firstIdx: st.firstIdx });
        rui.setUserMarks(st.userMarks || []);
        rui.progress(st.processed);
        if (st.ended) rui.done();
        live = { active: st.active, running: st.running, ended: st.ended };
        hasResults = true;
        if (st.restored) say('Su questa pagina ci sono i segni di una lettura salvata.');
      }
    } catch (e) { /* il ragno non è ancora stato su questa pagina */ }
    buttons();
  }

  $('run').addEventListener('click', async function () {
    if (tabId === null) return;
    if (DOC_RE.test(tabUrl.split('#')[0])) { chrome.tabs.update(tabId, { url: READER + '?file=' + encodeURIComponent(tabUrl) }); return; }
    say('Il ragno entra nella pagina…');
    try {
      var r = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: function () { return document.contentType; } });
      var ct = r && r[0] && r[0].result;
      if (ct === 'application/pdf' || /^image\//.test(ct || '')) { chrome.tabs.update(tabId, { url: READER + '?file=' + encodeURIComponent(tabUrl) }); return; }
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: CONTENT });
      // frequenze delle parole della lingua della pagina (servono all'analisi)
      var lang = settings.language !== 'auto' ? settings.language : null;
      if (!lang) {
        var d = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: function () { return self.WCLang ? self.WCLang.detect((document.body && document.body.innerText || '').slice(0, 30000)) : 'it'; } });
        lang = (d && d[0] && d[0].result) || 'it';
      }
      if (CODES.indexOf(lang) >= 0) await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['core/freq/' + lang + '.js'] }).catch(function () {});
      await chrome.tabs.sendMessage(tabId, { type: 'wc:start', settings: settings });
    } catch (e) {
      say('Su questa pagina il browser non permette alle estensioni di entrare (pagine interne, Web Store, PDF di sistema).');
    }
  });
  $('pause').addEventListener('click', function () { chrome.tabs.sendMessage(tabId, { type: 'wc:pause' }).then(function (r) { live.running = r && r.running; buttons(); }).catch(function () {}); });
  $('finish').addEventListener('click', function () { chrome.tabs.sendMessage(tabId, { type: 'wc:finish' }).catch(function () {}); });
  $('stop').addEventListener('click', function () { chrome.tabs.sendMessage(tabId, { type: 'wc:stop' }).catch(function () {}); });
  $('open-reader').addEventListener('click', function () { chrome.tabs.create({ url: READER }); });
  $('open-archive').addEventListener('click', function () { chrome.tabs.create({ url: chrome.runtime.getURL('archive.html') }); });

  chrome.runtime.onMessage.addListener(function (msg, sender) {
    if (!sender.tab || sender.tab.id !== tabId || !msg) return;
    if (msg.type === 'wc:begin') {
      rui.show(msg.results, msg.doc, { total: msg.total, firstIdx: msg.firstIdx });
      rui.setUserMarks(msg.userMarks || []);
      live = { active: true, running: !msg.restored, ended: !!msg.restored };
      hasResults = true;
      say(msg.restored ? 'Segni ritrovati da una lettura salvata.' : '');
    } else if (msg.type === 'wc:progress') rui.progress(msg.processed);
    else if (msg.type === 'wc:marks') rui.setUserMarks(msg.marks || []);
    else if (msg.type === 'wc:pen-tool') paintPen(msg.tool);
    else if (msg.type === 'wc:end') { rui.done(); live.ended = true; live.running = false; }
    else if (msg.type === 'wc:stopped') { live.active = false; live.running = false; paintPen(null); }
    else if (msg.type === 'wc:error') say(msg.message);
    buttons();
  });
  chrome.tabs.onActivated.addListener(currentTab);
  chrome.tabs.onUpdated.addListener(function (id, info) { if (id === tabId && info.status === 'complete') currentTab(); });
  currentTab();
})();
