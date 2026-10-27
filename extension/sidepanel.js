/* Word Crawler (estensione): pannello laterale. Comanda il ragno nella scheda e mostra i risultati. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var CONTENT = ['core/settings.js', 'core/text.js', 'core/analysis.js', 'core/dom.js', 'core/crawler.js', 'core/export.js', 'content.js'];
  var READER = chrome.runtime.getURL('reader.html');
  var DOC_RE = /\.(pdf|docx?|odt|odp|ods|pptx|xlsx|epub|rtf|md|txt|srt|vtt|csv)(\?|#|$)/i;
  var tabId = null, tabUrl = '', settings = WCSettings.defaults(), live = { active: false, running: false, ended: false };

  var sui = WCSettingsUI.render($('settings'), {
    values: settings, idPrefix: 'sp',
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

  var rui = WCResultsUI.render($('results'), {
    idPrefix: 'spr',
    onJump: function (idx) { if (tabId !== null) chrome.tabs.sendMessage(tabId, { type: 'wc:jump', idx: idx }).catch(function () {}); },
    onSave: function (entry) { return WCStore.save(entry); },
    onExport: function (kind, entry) { var f = WCExport.build(kind, entry); return WCStore.download(f.name, f.content, f.mime); }
  });

  function say(m) { $('msg').textContent = m || ''; }
  function buttons() {
    $('run').textContent = live.active || live.ended ? 'Leggi di nuovo' : 'Leggi questa pagina';
    $('pause').disabled = !live.active || live.ended;
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
        rui.progress(st.processed);
        if (st.ended) rui.done();
        live = { active: st.active, running: st.running, ended: st.ended };
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
      if (r && r[0] && r[0].result === 'application/pdf') { chrome.tabs.update(tabId, { url: READER + '?file=' + encodeURIComponent(tabUrl) }); return; }
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: CONTENT });
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
      live = { active: true, running: true, ended: false };
      say('');
    } else if (msg.type === 'wc:progress') rui.progress(msg.processed);
    else if (msg.type === 'wc:end') { rui.done(); live.ended = true; live.running = false; }
    else if (msg.type === 'wc:stopped') { live.active = false; live.running = false; }
    else if (msg.type === 'wc:error') say(msg.message);
    buttons();
  });
  chrome.tabs.onActivated.addListener(currentTab);
  chrome.tabs.onUpdated.addListener(function (id, info) { if (id === tabId && info.status === 'complete') currentTab(); });
  currentTab();
})();
