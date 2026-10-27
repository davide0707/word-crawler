/*
 * Word Crawler Studio: le sole funzioni di sistema che la finestra può usare.
 * Nessun accesso diretto a Node o al disco: tutto passa da qui e dai controlli in main.js.
 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, cb) {
  const h = (_e, data) => cb(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

contextBridge.exposeInMainWorld('wcDesktop', {
  openFile: () => ipcRenderer.invoke('file:open'),
  fetchUrl: (url) => ipcRenderer.invoke('url:fetch', url),
  saveFile: (name, content, mime) => ipcRenderer.invoke('file:save', { name, content, mime }),
  settings: {
    load: (key) => ipcRenderer.invoke('settings:load', key),
    save: (key, value) => ipcRenderer.invoke('settings:save', key, value)
  },
  archive: {
    list: () => ipcRenderer.invoke('archive:list'),
    save: (entry) => ipcRenderer.invoke('archive:save', entry),
    remove: (id) => ipcRenderer.invoke('archive:remove', id)
  },
  scan: {
    roots: () => ipcRenderer.invoke('scan:roots'),
    pickFolder: () => ipcRenderer.invoke('scan:pick-folder'),
    start: (opts) => ipcRenderer.invoke('scan:start', opts),
    cancel: () => ipcRenderer.invoke('scan:cancel'),
    exportCsv: (csvPath) => ipcRenderer.invoke('scan:export-csv', csvPath),
    onEvent: (cb) => listen('scan:event', cb)
  },
  showItem: (p) => ipcRenderer.invoke('shell:show', p),
  openExternal: (url) => ipcRenderer.invoke('shell:external', url),
  info: () => ipcRenderer.invoke('app:info'),
  onMenu: (cb) => listen('menu', cb),
  onFileOpened: (cb) => listen('file:opened', cb)
});
