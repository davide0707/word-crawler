/* Word Crawler (estensione): icona, scorciatoia da tastiera e menu. */
importScripts('core/settings.js');

var READER = chrome.runtime.getURL('reader.html');
var CONTENT = ['core/settings.js', 'core/text.js', 'core/analysis.js', 'core/dom.js', 'core/crawler.js', 'core/export.js', 'content.js'];
var DOC_RE = /\.(pdf|docx?|odt|odp|ods|pptx|xlsx|epub|rtf|md|txt|srt|vtt|csv)(\?|#|$)/i;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({ id: 'wc-page', title: 'Fai leggere questa pagina al ragno', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'wc-link', title: 'Leggi questo documento con Word Crawler', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'wc-reader', title: 'Apri un documento (PDF, Word…)', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'wc-archive', title: 'Archivio delle letture', contexts: ['action'] });
  });
});

async function loadSettings() {
  var r = await chrome.storage.local.get('wcSettings');
  return WCSettings.sanitize(r.wcSettings);
}

// Avvia (o ferma) il ragno nella scheda. I documenti (PDF, Word…) si aprono nel lettore dell'estensione.
async function toggleOnTab(tab, onlyStart) {
  if (!tab || tab.id === undefined) return;
  var url = tab.url || '';
  if (url.indexOf(READER) === 0) return;
  if (DOC_RE.test(url.split('#')[0])) { chrome.tabs.update(tab.id, { url: READER + '?file=' + encodeURIComponent(url) }); return; }
  try {
    var r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: function () { return document.contentType; } });
    if (r && r[0] && r[0].result === 'application/pdf') { chrome.tabs.update(tab.id, { url: READER + '?file=' + encodeURIComponent(url) }); return; }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT });
    await chrome.tabs.sendMessage(tab.id, { type: onlyStart ? 'wc:start' : 'wc:toggle', settings: await loadSettings() });
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
  else if (info.menuItemId === 'wc-reader') chrome.tabs.create({ url: READER });
  else if (info.menuItemId === 'wc-archive') chrome.tabs.create({ url: chrome.runtime.getURL('archive.html') });
});
