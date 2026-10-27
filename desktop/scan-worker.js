// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/* Word Crawler: la scansione gira in un thread separato, così la finestra resta fluida. */
'use strict';
const { parentPort, workerData } = require('worker_threads');
const { scan } = require('./scanner');

let cancelled = false;
parentPort.on('message', (m) => { if (m && m.type === 'cancel') cancelled = true; });

scan(workerData, (msg) => parentPort.postMessage(msg), () => cancelled)
  .then((report) => parentPort.postMessage({ type: 'done', report }))
  .catch((e) => parentPort.postMessage({ type: 'error', message: e && e.message ? e.message : String(e) }));
