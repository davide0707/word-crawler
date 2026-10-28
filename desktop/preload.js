// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
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
  printPdf: (html, name) => ipcRenderer.invoke('export:pdf', { html, name }),
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
    find: (csvPath, query, opts) => ipcRenderer.invoke('scan:find', csvPath, String(query || ''),
      { semantic: !!(opts && opts.semantic), limit: opts && +opts.limit || 60 }),
    history: (root) => ipcRenderer.invoke('scan:history', root),
    compare: (oldId, newId) => ipcRenderer.invoke('scan:compare', oldId, newId),
    trash: (scanId, items) => ipcRenderer.invoke('scan:trash', scanId, items),
    onEvent: (cb) => listen('scan:event', cb)
  },
  library: {
    addFiles: () => ipcRenderer.invoke('library:add-files'),
    addFolder: () => ipcRenderer.invoke('library:add-folder'),
    read: (p) => ipcRenderer.invoke('library:read', p),
    list: () => ipcRenderer.invoke('library:list'),
    save: (rec) => ipcRenderer.invoke('library:save', rec),
    remove: (id) => ipcRenderer.invoke('library:remove', id),
    restore: (id) => ipcRenderer.invoke('library:restore', id),
    stat: (paths) => ipcRenderer.invoke('library:stat', paths),
    loadEdits: () => ipcRenderer.invoke('library:edits-load'),
    saveEdits: (edits) => ipcRenderer.invoke('library:edits-save', edits),
    loadStudy: () => ipcRenderer.invoke('library:study-load'),
    saveStudy: (state) => ipcRenderer.invoke('library:study-save', state),
    brains: () => ipcRenderer.invoke('library:brains'),
    brainCreate: (o) => ipcRenderer.invoke('library:brain-create', o),
    brainUpdate: (o) => ipcRenderer.invoke('library:brain-update', o),
    brainUse: (id) => ipcRenderer.invoke('library:brain-use', id),
    brainDuplicate: (o) => ipcRenderer.invoke('library:brain-duplicate', o),
    brainDelete: (id) => ipcRenderer.invoke('library:brain-delete', id),
    brainExport: (id) => ipcRenderer.invoke('library:brain-export', id),
    brainImport: () => ipcRenderer.invoke('library:brain-import'),
    backupAll: () => ipcRenderer.invoke('library:backup-all'),
    countAll: () => ipcRenderer.invoke('library:count-all'),
    eraseAll: (confirm) => ipcRenderer.invoke('library:erase-all', confirm),
    addScanned: (dir) => ipcRenderer.invoke('library:add-scanned', dir)
  },
  showItem: (p) => ipcRenderer.invoke('shell:show', p),
  openExternal: (url) => ipcRenderer.invoke('shell:external', url),
  info: () => ipcRenderer.invoke('app:info'),
  onMenu: (cb) => listen('menu', cb),
  onFileOpened: (cb) => listen('file:opened', cb)
});
