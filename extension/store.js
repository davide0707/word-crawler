/* Word Crawler (estensione): impostazioni, archivio e download, condivisi tra le pagine dell'estensione. */
(function (g) {
  'use strict';
  var S = chrome.storage.local;
  g.WCStore = {
    loadSettings: function () { return S.get('wcSettings').then(function (r) { return r.wcSettings || null; }); },
    saveSettings: function (v) { return S.set({ wcSettings: v }); },
    list: function () {
      return S.get(null).then(function (all) {
        return Object.keys(all).filter(function (k) { return k.indexOf('wca:') === 0; }).map(function (k) { return all[k]; });
      });
    },
    save: function (entry) { var o = {}; o['wca:' + entry.id] = entry; return S.set(o).then(function () { return true; }); },
    remove: function (id) { return S.remove('wca:' + id); },
    // scarica un file creato nella pagina (sunto, rapporto…)
    download: function (name, content, mime) {
      var url = URL.createObjectURL(new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' }));
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      return Promise.resolve(true);
    }
  };
})(globalThis);
