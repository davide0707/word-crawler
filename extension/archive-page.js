/* Word Crawler (estensione): archivio delle letture salvate. */
(function () {
  'use strict';
  var ui = WCArchiveUI.render(document.getElementById('archive'), {
    list: WCStore.list,
    remove: WCStore.remove,
    saveFile: WCStore.download,
    open: function (e) { chrome.tabs.create({ url: e.source }); }
  });
  chrome.storage.onChanged.addListener(function (changes) {
    if (Object.keys(changes).some(function (k) { return k.indexOf('wca:') === 0; })) ui.refresh();
  });
})();
