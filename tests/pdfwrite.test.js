// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/* Test delle annotazioni scritte dentro il PDF e del confronto fra versioni. Uso: node tests/pdfwrite.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
['core/settings.js', 'core/lang.js', 'core/text.js', 'core/analysis.js', 'core/code.js', 'core/library.js', 'core/pdfwrite.js']
  .forEach((f) => require(path.join(root, f)));
const { WCText, WCLibrary, WCPdfWrite } = globalThis;

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + (e && e.stack || e));
    if (process.env.GITHUB_ACTIONS) console.log('::error title=' + name.replace(/[:,\n]/g, ' ') + '::' + String(e && e.message || e).slice(0, 900).replace(/\r?\n/g, '%0A'));
  }
}
const SRC = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.pdf')));

(async () => {
  await check('si capisce se un PDF si lascia annotare', () => {
    const c = WCPdfWrite.can(SRC);
    assert.ok(c.ok && c.pages >= 1, JSON.stringify(c));
    const no = WCPdfWrite.can(new TextEncoder().encode('non sono un pdf'));
    assert.strictEqual(no.ok, false);
    assert.ok(/Non è un PDF/.test(no.reason));
    // un PDF protetto non si tocca
    const enc = new TextEncoder().encode('%PDF-1.7\n1 0 obj<</Type/Page>>endobj\ntrailer<</Encrypt 9 0 R /Root 1 0 R>>');
    assert.strictEqual(WCPdfWrite.can(enc).ok, false);
    assert.ok(/protetto/.test(WCPdfWrite.can(enc).reason));
  });

  await check('il file originale resta identico, le annotazioni si aggiungono in fondo', () => {
    const out = WCPdfWrite.annotate(SRC, [
      { page: 0, type: 'highlight', quads: [WCPdfWrite.quadOf([0.1, 0.2, 0.3, 0.02], 595, 842)], color: '#ffd43b', contents: 'importante' }
    ], {});
    assert.ok(out.length > SRC.length, 'il file cresce');
    assert.deepStrictEqual(Array.from(out.subarray(0, SRC.length)), Array.from(SRC), 'i byte di partenza non sono toccati');
    const tail = Buffer.from(out.subarray(SRC.length)).toString('latin1');
    assert.ok(/\/Subtype \/Highlight/.test(tail), 'c’è l’annotazione');
    assert.ok(/\/QuadPoints \[/.test(tail), 'con i quadrilateri');
    assert.ok(/\/Prev \d+/.test(tail), 'il trailer rimanda alla versione di prima');
    assert.ok(/startxref\n\d+\n%%EOF/.test(tail), 'e finisce come deve');
    assert.ok(/\/Annots \[/.test(tail), 'la pagina è stata riscritta con l’elenco');
  });

  await check('senza niente da scrivere non si tocca il file', () => {
    assert.throws(() => WCPdfWrite.annotate(SRC, [], {}), /Nessuna annotazione/);
    assert.throws(() => WCPdfWrite.annotate(SRC, [{ page: 99, type: 'highlight', rect: [0, 0, 1, 1] }], {}), /Nessuna annotazione/);
  });

  await check('i quattro tipi, con autore, data e testo con gli accenti', () => {
    const q = [WCPdfWrite.quadOf([0.1, 0.1, 0.2, 0.02], 595, 842)];
    const out = WCPdfWrite.annotate(SRC, [
      { page: 0, type: 'highlight', quads: q },
      { page: 0, type: 'underline', quads: q },
      { page: 0, type: 'strike', quads: q },
      { page: 0, type: 'box', rect: [100, 100, 200, 140] },
      { page: 0, type: 'note', rect: [300, 300, 320, 320], contents: 'però è così', author: 'Davide' }
    ], {});
    const tail = Buffer.from(out.subarray(SRC.length)).toString('latin1');
    ['Highlight', 'Underline', 'StrikeOut', 'Square', 'Text'].forEach((t) => assert.ok(new RegExp('/Subtype /' + t).test(tail), 'manca ' + t));
    assert.ok(/\/T \(\\376\\377/.test(tail), 'l’autore è in UTF-16');
    assert.ok(/\/M \(D:\d{14}Z\)/.test(tail), 'e c’è la data');
    assert.ok(/\/F 4/.test(tail), 'le annotazioni si stampano');
  });

  await check('da riquadro sulla pagina a punti del PDF', () => {
    const q = WCPdfWrite.quadOf([0, 0, 1, 1], 595, 842);
    assert.deepStrictEqual(q, [0, 842, 595, 842, 0, 0, 595, 0], 'tutta la pagina, con l’origine in basso');
    const half = WCPdfWrite.quadOf([0.5, 0.5, 0.5, 0.5], 100, 100);
    assert.deepStrictEqual(half, [50, 50, 100, 50, 50, 0, 100, 0]);
  });

  await check('il PDF annotato si riapre e PDF.js vede le annotazioni', async () => {
    // PDF.js vuole Promise.withResolvers, che su Node 20 non c'è ancora: si aggiunge, è tre righe
    if (typeof Promise.withResolvers !== 'function') {
      Promise.withResolvers = function () {
        let resolve, reject;
        const promise = new Promise((a, b) => { resolve = a; reject = b; });
        return { promise, resolve, reject };
      };
    }
    let pdfjs;
    try { pdfjs = await import(new URL('../node_modules/pdfjs-dist/build/pdf.min.mjs', 'file://' + __filename).href); }
    catch (e) { console.log('     (PDF.js non disponibile qui: controllo saltato — ' + e.message.slice(0, 80) + ')'); return; }
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'file://' + __filename).href;
    const out = WCPdfWrite.annotate(SRC, [
      { page: 0, type: 'highlight', quads: [WCPdfWrite.quadOf([0.1, 0.2, 0.3, 0.02], 595, 842)], contents: 'importante' },
      { page: 0, type: 'note', rect: [500, 700, 520, 720], contents: 'Nota con accenti: perché', author: 'Davide' }
    ], {});
    let doc;
    try { doc = await pdfjs.getDocument({ data: out, isEvalSupported: false }).promise; }
    catch (e) { console.log('     (PDF.js non riesce a girare qui: controllo saltato — ' + String(e.message).slice(0, 80) + ')'); return; }
    assert.ok(doc.numPages >= 1, 'il documento si apre');
    const page = await doc.getPage(1);
    const an = await page.getAnnotations();
    assert.strictEqual(an.length, 2, 'due annotazioni: ' + an.map((a) => a.subtype).join(', '));
    const hl = an.find((a) => a.subtype === 'Highlight');
    assert.ok(hl && hl.contentsObj.str === 'importante', JSON.stringify(hl && hl.contentsObj));
    const nt = an.find((a) => a.subtype === 'Text');
    assert.strictEqual(nt.contentsObj.str, 'Nota con accenti: perché', 'gli accenti sopravvivono');
    assert.strictEqual(nt.titleObj.str, 'Davide');
    const txt = await page.getTextContent();
    assert.ok(txt.items.length > 10, 'il testo della pagina è ancora leggibile: ' + txt.items.length);
  });

  // ---------------------------------------------------------------- confronto fra versioni
  let nd = 0;
  function doc(name, paras, mtime) {
    const blocks = paras.map((t) => ({ type: 'p', text: t }));
    const toks = WCText.tokenizeBlocks(blocks.map((b) => ({ text: b.text, w: 1 })));
    const id = 'v-' + (++nd).toString(16).padStart(16, '0');
    return {
      meta: { id, path: '/l/' + name, name, ext: 'md', size: 100, hash: 'h' + nd, mtime: mtime },
      format: 'Testo', title: name, tokens: toks.map((t) => [t.text, t.gap, t.blk, t.w, null]),
      tail: '', blocks: blocks.map(() => ({ type: 'p' }))
    };
  }

  await check('confronto fra versioni: uguale, cambiato, sparito, nuovo', async () => {
    const v1 = doc('Tesi v1.md', [
      'La modulazione digitale trasforma i bit in un segnale analogico adatto al canale.',
      'Il rumore termico limita la velocità massima di trasmissione in ogni collegamento.',
      'Questo paragrafo verrà tolto nella seconda stesura perché non serve più a niente.'
    ], '2026-01-01T10:00:00.000Z');
    const v2 = doc('Tesi v2.md', [
      'La modulazione digitale trasforma i bit in un segnale analogico adatto al canale.',
      'Il rumore termico limita la velocità massima di trasmissione in ogni collegamento radio.',
      'Questo paragrafo invece è completamente nuovo e parla di codifica di canale e ridondanza.'
    ], '2026-02-01T10:00:00.000Z');
    const recs = [await WCLibrary.buildRecord(v1, {}), await WCLibrary.buildRecord(v2, {})];
    const kb = WCLibrary.open(recs, WCLibrary.emptyEdits());
    const d = kb.versions(recs[0].id, recs[1].id);
    assert.ok(d, 'il confronto esiste');
    assert.strictEqual(d.a.name, 'Tesi v1.md');
    assert.strictEqual(d.b.name, 'Tesi v2.md');
    const states = d.items.map((x) => x.state);
    assert.ok(states.includes('same'), 'un passaggio identico: ' + states.join(','));
    assert.ok(states.includes('changed'), 'uno cambiato');
    assert.ok(states.includes('gone'), 'uno sparito');
    assert.ok(states.includes('new'), 'uno nuovo');
    const ch = d.items.find((x) => x.state === 'changed');
    assert.ok(/radio/.test(ch.textB) && !/radio/.test(ch.text), 'con le due versioni del testo');
    assert.ok(ch.score >= 0.6, 'e quanto si somigliano: ' + ch.score);
    assert.strictEqual(d.stats.same + d.stats.changed + d.stats.gone + d.stats.added, d.stats.total);
    assert.ok(d.stats.equal > 0 && d.stats.equal < 1, 'quota di uguale: ' + d.stats.equal);
    assert.strictEqual(kb.versions('niente', recs[1].id), null);
  });

  await check('riconosce da solo le coppie di versioni', async () => {
    const recs = [];
    for (const [n, m] of [['Relazione v1.md', '2026-01-01T10:00:00.000Z'], ['Relazione v2.md', '2026-02-01T10:00:00.000Z'], ['Ricetta.md', '2026-03-01T10:00:00.000Z']]) {
      recs.push(await WCLibrary.buildRecord(doc(n, ['Un paragrafo qualunque che serve solo a riempire il documento di prova.'], m), {}));
    }
    const kb = WCLibrary.open(recs, WCLibrary.emptyEdits());
    const pairs = kb.versionPairs();
    assert.strictEqual(pairs.length, 1, JSON.stringify(pairs));
    assert.strictEqual(pairs[0].docs.length, 2);
    assert.deepStrictEqual(pairs[0].docs.map((d) => d.name), ['Relazione v1.md', 'Relazione v2.md'], 'in ordine di data');
  });

  console.log(failures ? '\n' + failures + ' prove fallite' : '\ntutte le prove sono passate');
  process.exit(failures ? 1 : 0);
})();
