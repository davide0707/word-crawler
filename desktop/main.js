/*
 * Word Crawler Studio: processo principale dell'app desktop (Electron).
 *
 * Sicurezza:
 *  - la finestra non ha accesso a Node (contextIsolation + sandbox); parla col sistema solo
 *    tramite le poche funzioni esposte da preload.js;
 *  - i file dell'app sono serviti dal protocollo interno app:// (niente file:// generico);
 *  - si aprono solo i file scelti dall'utente; si scrive solo dove l'utente sceglie di salvare
 *    o nella cartella dati dell'app (impostazioni, archivio, rapporti delle scansioni);
 *  - la scansione del disco è in sola lettura (vedi scanner.js); l'unica azione che cambia qualcosa
 *    sul disco è spostare nel Cestino i duplicati scelti dall'utente, dopo una conferma e molti controlli
 *    (vedi scan-tools.js).
 */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { pathToFileURL } = require('url');
const { Worker } = require('worker_threads');
const scanTools = require('./scan-tools');

const APP_ROOT = path.join(__dirname, '..');
const SERVED = ['core', path.join('desktop', 'ui'), path.join('node_modules', 'pdfjs-dist'), path.join('node_modules', 'tesseract.js', 'dist'),
  path.join('node_modules', 'tesseract.js-core'), path.join('build', 'icons')];
const DOC_EXT = ['pdf', 'docx', 'docm', 'dotx', 'doc', 'odt', 'ott', 'odp', 'ods', 'pptx', 'pptm', 'ppsx', 'xlsx', 'xlsm', 'epub', 'rtf', 'html', 'htm', 'xhtml', 'md', 'markdown', 'txt', 'text', 'log', 'srt', 'vtt', 'csv', 'tsv',
  'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];
const MAX_OPEN_BYTES = 300 * 1024 * 1024;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

let win = null;
let pendingOpen = [];          // file da aprire passati dal sistema ("Apri con")
const allowedPaths = new Set(); // percorsi che l'utente ha scelto o passato all'app
let scanWorker = null;

function userDir(...p) { return path.join(app.getPath('userData'), ...p); }
async function ensureDir(d) { await fsp.mkdir(d, { recursive: true }); return d; }

// ------------------------------------------------------------------ protocollo app://
function serveApp(request) {
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!rel) rel = 'desktop/ui/index.html';
  const full = path.normalize(path.join(APP_ROOT, rel));
  const ok = SERVED.some((dir) => full.startsWith(path.join(APP_ROOT, dir) + path.sep));
  if (!ok) return new Response('Non trovato', { status: 404 });
  return net.fetch(pathToFileURL(full).toString());
}

// ------------------------------------------------------------------ finestra
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0b0b0e',
    title: 'Word Crawler',
    icon: path.join(APP_ROOT, 'build', 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://wc/desktop/ui/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://wc/')) e.preventDefault(); });
  win.webContents.on('did-finish-load', () => { flushPendingOpen(); });
  win.on('closed', () => { win = null; if (scanWorker) scanWorker.postMessage({ type: 'cancel' }); });
}

function buildMenu() {
  const send = (cmd) => () => { if (win) win.webContents.send('menu', cmd); };
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: 'Word Crawler', submenu: [{ role: 'about', label: 'Informazioni su Word Crawler' }, { type: 'separator' }, { role: 'hide', label: 'Nascondi' }, { role: 'quit', label: 'Esci' }] }] : []),
    { label: 'File', submenu: [
      { label: 'Apri documento…', accelerator: 'CmdOrCtrl+O', click: send('open') },
      { label: 'Apri pagina web…', accelerator: 'CmdOrCtrl+L', click: send('open-url') },
      { type: 'separator' },
      { label: 'Scansiona una cartella o un disco…', accelerator: 'CmdOrCtrl+Shift+S', click: send('scanner') },
      { type: 'separator' },
      isMac ? { role: 'close', label: 'Chiudi finestra' } : { role: 'quit', label: 'Esci' }
    ] },
    { label: 'Modifica', submenu: [
      { role: 'undo', label: 'Annulla' }, { role: 'redo', label: 'Ripeti' }, { type: 'separator' },
      { role: 'cut', label: 'Taglia' }, { role: 'copy', label: 'Copia' }, { role: 'paste', label: 'Incolla' }, { role: 'selectAll', label: 'Seleziona tutto' }
    ] },
    { label: 'Vista', submenu: [
      { label: 'Lettore', accelerator: 'CmdOrCtrl+1', click: send('tab:reader') },
      { label: 'Scanner del PC', accelerator: 'CmdOrCtrl+2', click: send('tab:scanner') },
      { label: 'Archivio', accelerator: 'CmdOrCtrl+3', click: send('tab:archive') },
      { label: 'Guida', accelerator: 'F1', click: send('tab:guide') },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Dimensione reale' }, { role: 'zoomIn', label: 'Ingrandisci' }, { role: 'zoomOut', label: 'Riduci' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Schermo intero' },
      { role: 'toggleDevTools', label: 'Strumenti per sviluppatori' }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ file aperti dal sistema
function filesFromArgv(argv) {
  return argv.slice(1).filter((a) => !a.startsWith('-') && DOC_EXT.includes(path.extname(a).slice(1).toLowerCase()) && fs.existsSync(a));
}
async function readForRenderer(p) {
  const st = await fsp.stat(p);
  if (!st.isFile()) throw new Error('Non è un file');
  if (st.size > MAX_OPEN_BYTES) throw new Error('Il file è troppo grande (oltre 300 MB)');
  const bytes = await fsp.readFile(p);
  return { name: path.basename(p), bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), source: p };
}
async function flushPendingOpen() {
  if (!win) return;
  const list = pendingOpen; pendingOpen = [];
  for (const p of list) {
    try { win.webContents.send('file:opened', await readForRenderer(p)); } catch (e) { /* file sparito o illeggibile */ }
  }
}

// ------------------------------------------------------------------ IPC: documenti
ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Apri un documento',
    properties: ['openFile'],
    filters: [{ name: 'Documenti', extensions: DOC_EXT }, { name: 'Tutti i file', extensions: ['*'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  allowedPaths.add(r.filePaths[0]);
  return readForRenderer(r.filePaths[0]);
});

ipcMain.handle('url:fetch', async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Indirizzo non valido');
  const res = await net.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 WordCrawler/2.0', 'Accept-Language': 'it,en;q=0.8' } });
  if (!res.ok) throw new Error('il sito ha risposto con errore ' + res.status);
  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 40 * 1024 * 1024) throw new Error('pagina troppo grande');
  if (/pdf/i.test(type) || buf.slice(0, 4).toString() === '%PDF') {
    return { pdf: true, bytes: new Uint8Array(buf), url: res.url || url, name: decodeURIComponent(new URL(res.url || url).pathname.split('/').pop() || 'documento.pdf') };
  }
  const m = /charset=([\w-]+)/i.exec(type);
  let html;
  try { html = new TextDecoder(m ? m[1] : 'utf-8').decode(buf); } catch (e) { html = buf.toString('utf8'); }
  return { html, url: res.url || url };
});

function safeFileName(name, fallback) {
  const n = path.basename(String(name || '')).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim();
  return n || fallback;
}
ipcMain.handle('file:save', async (_e, { name, content, mime }) => {
  name = safeFileName(name, 'word-crawler.txt');
  const ext = path.extname(name).slice(1) || 'txt';
  const r = await dialog.showSaveDialog(win, {
    title: 'Salva',
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'Tutti i file', extensions: ['*'] }]
  });
  if (r.canceled || !r.filePath) return false;
  // testo (sunti, rapporti) oppure byte (documenti Word)
  if (content instanceof Uint8Array) await fsp.writeFile(r.filePath, Buffer.from(content.buffer, content.byteOffset, content.byteLength));
  else await fsp.writeFile(r.filePath, String(content), 'utf8');
  return true;
});

// PDF del documento segnato: la pagina HTML viene stampata da una finestra nascosta, senza script
ipcMain.handle('export:pdf', async (_e, { html, name }) => {
  if (typeof html !== 'string' || html.length > 80 * 1024 * 1024) throw new Error('Documento non valido');
  const r = await dialog.showSaveDialog(win, {
    title: 'Salva il PDF',
    defaultPath: path.join(app.getPath('documents'), safeFileName(name, 'documento segnato.pdf')),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return false;
  const tmp = await ensureDir(userDir('tmp'));
  const file = path.join(tmp, 'stampa-' + Date.now() + '.html');
  await fsp.writeFile(file, html, 'utf8');
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  try {
    await pw.loadFile(file);
    const pdf = await pw.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    await fsp.writeFile(r.filePath, pdf);
  } finally {
    pw.destroy();
    fsp.rm(file, { force: true }).catch(() => {});
  }
  return true;
});

// ------------------------------------------------------------------ IPC: impostazioni e archivio
ipcMain.handle('settings:load', async (_e, key) => {
  try { const all = JSON.parse(await fsp.readFile(userDir('settings.json'), 'utf8')); return all[key] || null; }
  catch (e) { return null; }
});
ipcMain.handle('settings:save', async (_e, key, value) => {
  let all = {};
  try { all = JSON.parse(await fsp.readFile(userDir('settings.json'), 'utf8')); } catch (e) { /* primo salvataggio */ }
  all[key] = value;
  await ensureDir(userDir());
  await fsp.writeFile(userDir('settings.json'), JSON.stringify(all, null, 2), 'utf8');
  return true;
});

function archivePath(id) {
  if (!/^wc-[a-z0-9-]+$/i.test(id)) throw new Error('Identificativo non valido');
  return userDir('archive', id + '.json');
}
ipcMain.handle('archive:list', async () => {
  const dir = await ensureDir(userDir('archive'));
  const out = [];
  for (const f of await fsp.readdir(dir)) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'))); } catch (e) { /* voce danneggiata: ignorata */ }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
});
ipcMain.handle('archive:save', async (_e, entry) => {
  await ensureDir(userDir('archive'));
  await fsp.writeFile(archivePath(entry.id), JSON.stringify(entry, null, 2), 'utf8');
  return true;
});
ipcMain.handle('archive:remove', async (_e, id) => {
  await fsp.rm(archivePath(id), { force: true });
  return true;
});

// ------------------------------------------------------------------ IPC: scanner
function listRoots() {
  const out = [];
  const home = app.getPath('home');
  if (process.platform === 'win32') {
    for (let c = 67; c <= 90; c++) { // C: ... Z:
      const d = String.fromCharCode(c) + ':\\';
      try { fs.accessSync(d); out.push({ label: 'Disco ' + d.slice(0, 2), path: d }); } catch (e) { /* lettera non usata */ }
    }
  } else {
    out.push({ label: 'Intero disco (/)', path: '/' });
    const vols = process.platform === 'darwin' ? ['/Volumes'] : ['/media', '/mnt', '/run/media'];
    vols.forEach((v) => {
      try {
        fs.readdirSync(v, { withFileTypes: true }).forEach((d) => {
          const p = path.join(v, d.name);
          if (d.isDirectory()) {
            const subs = v !== '/Volumes' && v !== '/mnt' ? fs.readdirSync(p, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => path.join(p, x.name)) : [p];
            subs.forEach((s) => out.push({ label: 'Volume ' + path.basename(s), path: s }));
          }
        });
      } catch (e) { /* cartella assente */ }
    });
  }
  out.push({ label: 'Cartella utente', path: home });
  ['documents', 'downloads', 'desktop', 'pictures'].forEach((k) => {
    try { out.push({ label: { documents: 'Documenti', downloads: 'Download', desktop: 'Scrivania', pictures: 'Immagini' }[k], path: app.getPath(k) }); } catch (e) { /* non disponibile */ }
  });
  return out;
}
ipcMain.handle('scan:roots', () => listRoots());
ipcMain.handle('scan:pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Scegli la cartella o il disco da analizzare', properties: ['openDirectory'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
ipcMain.handle('scan:start', async (event, opts) => {
  if (scanWorker) throw new Error('C’è già una scansione in corso');
  const root = String(opts && opts.root || '');
  const st = await fsp.stat(root).catch(() => null);
  if (!st || !st.isDirectory()) throw new Error('Cartella non trovata: ' + root);
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = await ensureDir(userDir('scans', id));
  const workerFile = path.join(__dirname, 'scan-worker.js').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  const data = {
    root: root,
    legs: Number(opts.legs) || 8,
    sameDevice: opts.sameDevice !== false,
    includeHidden: !!opts.includeHidden,
    excludes: Array.isArray(opts.excludes) ? opts.excludes.slice(0, 200).map(String) : undefined,
    duplicates: ['off', 'fast', 'full'].includes(opts.duplicates) ? opts.duplicates : 'fast',
    minDupSize: Math.max(0, Number(opts.minDupSize) || 0),
    csvPath: opts.csv ? path.join(dir, 'elenco-file.csv') : null,
    visDepth: Math.max(1, Math.min(8, Number(opts.visDepth) || 5))
  };
  const sender = event.sender;
  scanWorker = new Worker(workerFile, { workerData: data });
  scanWorker.on('message', async (m) => {
    if (m.type === 'done') {
      m.report.id = id;
      try {
        await fsp.writeFile(path.join(dir, 'rapporto.json'), JSON.stringify(m.report), 'utf8');
        // scheda breve, per l'elenco delle scansioni da confrontare
        await fsp.writeFile(path.join(dir, 'scheda.json'), JSON.stringify({ id, root: m.report.root, finishedAt: m.report.finishedAt, files: m.report.totals.files,
          bytes: m.report.totals.bytes, dirs: m.report.totals.dirs, partial: m.report.partial, csv: !!m.report.csvPath }), 'utf8');
      } catch (e) { /* il rapporto resta comunque in memoria */ }
    }
    if (!sender.isDestroyed()) sender.send('scan:event', m);
    if (m.type === 'done' || m.type === 'error') { const w = scanWorker; scanWorker = null; if (w) w.terminate(); }
  });
  scanWorker.on('error', (e) => { if (!sender.isDestroyed()) sender.send('scan:event', { type: 'error', message: e.message }); scanWorker = null; });
  return id;
});
ipcMain.handle('scan:cancel', () => { if (scanWorker) scanWorker.postMessage({ type: 'cancel' }); return true; });

// rapporti salvati nella cartella dell'app
function scanDir(id) {
  if (typeof id !== 'string' || !/^[0-9T-]+Z?$/.test(id)) throw new Error('Scansione non valida');
  return userDir('scans', id);
}
async function readReport(id) { return JSON.parse(await fsp.readFile(path.join(scanDir(id), 'rapporto.json'), 'utf8')); }
function sameRoot(a, b) {
  const n = (p) => path.resolve(String(p || '')).replace(/[\\/]+$/, '');
  return process.platform === 'win32' || process.platform === 'darwin' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
}
ipcMain.handle('scan:history', async (_e, root) => {
  const base = await ensureDir(userDir('scans'));
  const out = [];
  for (const id of await fsp.readdir(base)) {
    let meta = null;
    try { meta = JSON.parse(await fsp.readFile(path.join(base, id, 'scheda.json'), 'utf8')); } catch (e) {
      // scansioni della versione 2.0: niente scheda, si legge il rapporto
      try { const r = JSON.parse(await fsp.readFile(path.join(base, id, 'rapporto.json'), 'utf8')); meta = { id, root: r.root, finishedAt: r.finishedAt, files: r.totals.files, bytes: r.totals.bytes, partial: r.partial, csv: !!r.csvPath }; } catch (e2) { /* cartella incompleta */ }
    }
    if (meta && (!root || sameRoot(meta.root, root))) out.push(meta);
  }
  return out.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
});
ipcMain.handle('scan:compare', async (_e, oldId, newId) => {
  const a = await readReport(oldId), b = await readReport(newId);
  const res = scanTools.compareReports(a, b);
  const csvA = path.join(scanDir(oldId), 'elenco-file.csv'), csvB = path.join(scanDir(newId), 'elenco-file.csv');
  if (fs.existsSync(csvA) && fs.existsSync(csvB)) res.files = await scanTools.compareCsv(csvA, csvB);
  else res.files = { skipped: 'Per confrontare file per file servono gli elenchi completi di entrambe le scansioni (opzione “Salva l’elenco completo dei file”).' };
  return res;
});
// Duplicati nel Cestino: controlli (scan-tools.planTrash), conferma dell'utente, spostamento e registro
ipcMain.handle('scan:trash', async (event, scanId, items) => {
  const report = await readReport(scanId);
  const sender = event.sender;
  const plan = await scanTools.planTrash(report, items, (p) => { if (!sender.isDestroyed()) sender.send('scan:event', { type: 'trash-check', done: p.done, total: p.total }); });
  if (!plan.ok.length) return { moved: [], failed: [], skipped: plan.skipped, bytes: 0, cancelled: false };
  const mb = (plan.bytes / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1 });
  const ans = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Spostare nel Cestino?',
    message: 'Spostare ' + plan.ok.length + (plan.ok.length === 1 ? ' file' : ' file') + ' nel Cestino (' + mb + ' MB)?',
    detail: 'Ho controllato che ognuno sia identico byte per byte a una copia che resta al suo posto. I file finiscono nel Cestino e si possono ripristinare da lì.' +
      (plan.skipped.length ? '\n\n' + plan.skipped.length + ' file non verranno toccati (non superano i controlli).' : ''),
    buttons: ['Sposta nel Cestino', 'Annulla'], defaultId: 1, cancelId: 1, noLink: true
  });
  if (ans.response !== 0) return { moved: [], failed: [], skipped: plan.skipped, bytes: 0, cancelled: true };
  const res = await scanTools.runTrash(plan, (p) => shell.trashItem(p), path.join(scanDir(scanId), 'cestino.log'));
  res.skipped = plan.skipped;
  res.log = path.join(scanDir(scanId), 'cestino.log');
  return res;
});
ipcMain.handle('scan:export-csv', async (_e, csvPath) => {
  const scans = userDir('scans') + path.sep;
  if (typeof csvPath !== 'string' || !path.resolve(csvPath).startsWith(scans)) throw new Error('Elenco non disponibile');
  const r = await dialog.showSaveDialog(win, { title: 'Salva l’elenco completo dei file', defaultPath: path.join(app.getPath('documents'), 'elenco-file - Word Crawler.csv'), filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return false;
  await fsp.copyFile(csvPath, r.filePath);
  return true;
});

// ------------------------------------------------------------------ IPC: varie
ipcMain.handle('shell:show', (_e, p) => { if (typeof p === 'string' && path.isAbsolute(p)) shell.showItemInFolder(p); return true; });
ipcMain.handle('shell:external', (_e, url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url); return true; });
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  userData: app.getPath('userData'),
  pdfjs: fs.existsSync(path.join(APP_ROOT, 'node_modules', 'pdfjs-dist', 'build', 'pdf.min.mjs')),
  ocr: fs.existsSync(path.join(APP_ROOT, 'node_modules', 'tesseract.js', 'dist', 'tesseract.min.js'))
}));

// ------------------------------------------------------------------ avvio
const single = app.requestSingleInstanceLock();
if (!single) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    pendingOpen.push(...filesFromArgv(argv));
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); flushPendingOpen(); }
  });
  app.on('open-file', (e, p) => { e.preventDefault(); pendingOpen.push(p); if (win) flushPendingOpen(); });
  pendingOpen.push(...filesFromArgv(process.argv));

  app.whenReady().then(() => {
    protocol.handle('app', serveApp);
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
