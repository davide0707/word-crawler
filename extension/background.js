// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/* Word Crawler (estensione): icona, scorciatoia da tastiera, menu e segni ritrovati sulle pagine salvate. */
importScripts('core/settings.js', 'core/lang.js', 'content-list.js');

var READER = chrome.runtime.getURL('reader.html');
var CONTENT = self.WC_CONTENT;
var DOC_RE = /\.(pdf|docx?|odt|odp|ods|pptx|xlsx|epub|rtf|md|txt|srt|vtt|csv|png|jpe?g|webp|bmp|gif)(\?|#|$)/i;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({ id: 'wc-page', title: 'Fai leggere questa pagina al ragno', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'wc-link', title: 'Leggi questo documento con Word Crawler', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'wc-image', title: 'Leggi il testo di questa immagine (OCR)', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'wc-reader', title: 'Apri un documento (PDF, Word…)', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'wc-archive', title: 'Archivio delle letture', contexts: ['action'] });
  });
  rebuildIndex();
});

// indice delle pagine salvate (versioni precedenti: si ricostruisce dall'archivio)
function rebuildIndex() {
  return chrome.storage.local.get(null).then(function (all) {
    var idx = {};
    Object.keys(all).forEach(function (k) {
      if (k.indexOf('wca:') !== 0) return;
      var e = all[k];
      if (e && /^https?:/i.test(e.source || '')) {
        var key = self.WC_URLKEY(e.source);
        var prev = idx[key] && all['wca:' + idx[key]];
        if (!prev || String(e.date) > String(prev.date)) idx[key] = e.id;
      }
    });
    return chrome.storage.local.set({ wcIndex: idx });
  });
}

async function loadSettings() {
  var r = await chrome.storage.local.get('wcSettings');
  return WCSettings.sanitize(r.wcSettings);
}

// Inietta il motore nella scheda e le frequenze della lingua della pagina (o di quella scelta)
async function inject(tabId, settings, lang) {
  await chrome.scripting.executeScript({ target: { tabId: tabId }, files: CONTENT });
  if (!lang) {
    lang = settings.language !== 'auto' ? settings.language : null;
    if (!lang) {
      var r = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: function () { return self.WCLang ? self.WCLang.detect((document.body && document.body.innerText || '').slice(0, 30000)) : 'it'; } });
      lang = (r && r[0] && r[0].result) || 'it';
    }
  }
  if (WCLang.CODES.indexOf(lang) >= 0) await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['core/freq/' + lang + '.js'] }).catch(function () {});
}

// Avvia (o ferma) il ragno nella scheda. I documenti (PDF, Word…) si aprono nel lettore dell'estensione.
async function toggleOnTab(tab, onlyStart) {
  if (!tab || tab.id === undefined) return;
  var url = tab.url || '';
  if (url.indexOf(READER) === 0) return;
  if (DOC_RE.test(url.split('#')[0])) { chrome.tabs.update(tab.id, { url: READER + '?file=' + encodeURIComponent(url) }); return; }
  try {
    var r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: function () { return document.contentType; } });
    var ct = r && r[0] && r[0].result;
    if (ct === 'application/pdf' || /^image\//.test(ct || '')) { chrome.tabs.update(tab.id, { url: READER + '?file=' + encodeURIComponent(url) }); return; }
    var settings = await loadSettings();
    await inject(tab.id, settings);
    await chrome.tabs.sendMessage(tab.id, { type: onlyStart ? 'wc:start' : 'wc:toggle', settings: settings });
  } catch (e) {
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#ff4a5e' });
    chrome.action.setBadgeText({ tabId: tab.id, text: '×' });
    setTimeout(function () { chrome.action.setBadgeText({ tabId: tab.id, text: '' }); }, 3000);
  }
}

chrome.commands.onCommand.addListener(function (cmd, tab) {
  if (cmd !== 'toggle-crawler') return;
  if (tab) toggleOnTab(tab);
  else chrome.tabs.query({ active: true, currentWindow: true }, function (t) { toggleOnTab(t[0]); });
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === 'wc-page') toggleOnTab(tab, true);
  else if (info.menuItemId === 'wc-link' && info.linkUrl) chrome.tabs.create({ url: READER + '?file=' + encodeURIComponent(info.linkUrl) });
  else if (info.menuItemId === 'wc-image' && info.srcUrl && /^https?:/i.test(info.srcUrl)) chrome.tabs.create({ url: READER + '?file=' + encodeURIComponent(info.srcUrl) });
  else if (info.menuItemId === 'wc-reader') chrome.tabs.create({ url: READER });
  else if (info.menuItemId === 'wc-archive') chrome.tabs.create({ url: chrome.runtime.getURL('archive.html') });
});

// Pagina salvata riaperta: si rimettono i segni, senza animazione
chrome.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || msg.type !== 'wc:check' || !sender.tab || sender.frameId !== 0) return;
  restoreOnTab(sender.tab.id, msg.url).catch(function () {});
});
async function restoreOnTab(tabId, url) {
  if (!/^https?:/i.test(url || '')) return;
  var settings = await loadSettings();
  if (!settings.restoreMarks) return;
  var got = await chrome.storage.local.get('wcIndex');
  var id = (got.wcIndex || {})[self.WC_URLKEY(url)];
  if (!id) return;
  var e = (await chrome.storage.local.get('wca:' + id))['wca:' + id];
  if (!e) return;
  await inject(tabId, WCSettings.sanitize(e.settings), e.lang);
  await chrome.tabs.sendMessage(tabId, { type: 'wc:restore', entry: { id: e.id, title: e.title, date: e.date, settings: e.settings, keep: e.keep || null, userMarks: e.userMarks || [] } });
}
