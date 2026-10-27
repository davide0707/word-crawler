/* Word Crawler (estensione): impostazioni, archivio e download, condivisi tra le pagine dell'estensione. */
(function (g) {
  'use strict';
  var S = chrome.storage.local;
  // indice "indirizzo della pagina -> lettura salvata", per ritrovare i segni quando la pagina si riapre
  function updateIndex(fn) {
    return S.get('wcIndex').then(function (r) {
      var idx = r.wcIndex || {};
      fn(idx);
      return S.set({ wcIndex: idx });
    });
  }
  g.WCStore = {
    loadSettings: function () { return S.get('wcSettings').then(function (r) { return r.wcSettings || null; }); },
    saveSettings: function (v) { return S.set({ wcSettings: v }); },
    list: function () {
      return S.get(null).then(function (all) {
        return Object.keys(all).filter(function (k) { return k.indexOf('wca:') === 0; }).map(function (k) { return all[k]; });
      });
    },
    save: function (entry) {
      var o = {};
      o['wca:' + entry.id] = entry;
      return S.set(o).then(function () {
        if (!/^https?:/i.test(entry.source || '') || !g.WC_URLKEY) return true;
        return updateIndex(function (idx) { idx[g.WC_URLKEY(entry.source)] = entry.id; }).then(function () { return true; });
      });
    },
    remove: function (id) {
      return S.remove('wca:' + id).then(function () {
        return updateIndex(function (idx) { Object.keys(idx).forEach(function (k) { if (idx[k] === id) delete idx[k]; }); });
      });
    },
    // scarica un file creato nella pagina (sunto, rapporto, documento Word…)
    download: function (name, content, mime) {
      var type = (mime || 'text/plain') + (typeof content === 'string' ? ';charset=utf-8' : '');
      var url = URL.createObjectURL(new Blob([content], { type: type }));
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      return Promise.resolve(true);
    },
    // PDF: la pagina segnata si apre in una scheda e si stampa ("Salva come PDF")
    printPdf: function (html) {
      return S.set({ wcPrint: html }).then(function () { return chrome.tabs.create({ url: chrome.runtime.getURL('print.html') }); }).then(function () { return true; });
    }
  };
})(globalThis);
