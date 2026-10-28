// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/* Test della lettura del codice (core/code.js): simboli, import, chiamate, codice morto. Uso: node tests/code.test.js */
'use strict';
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
['core/settings.js', 'core/lang.js', 'core/text.js', 'core/analysis.js', 'core/code.js', 'core/library.js'].forEach((f) => require(path.join(root, f)));
const { WCText, WCCode, WCLibrary } = globalThis;

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + (e && e.stack || e));
    if (process.env.GITHUB_ACTIONS) console.log('::error title=' + name.replace(/[:,\n]/g, ' ') + '::' + String(e && e.message || e).slice(0, 900).replace(/\r?\n/g, '%0A'));
  }
}
const L = (...lines) => lines.join('\n');
const names = (r, kind) => r.symbols.filter((s) => !kind || s.kind === kind).map((s) => s.name);

const INO = L(
  '#include <LoRa.h>',
  '#include "SCL3300.h"',
  '',
  'SCL3300 sensore;',
  'float angolo;',
  'int maiLetta = 3;',
  '',
  '// prepara la radio e il sensore',
  'void setup() {',
  '  LoRa.begin(433E6);',
  '  sensore.begin();',
  '}',
  '',
  'void loop() {',
  '  angolo = sensore.getAngle();',
  '  inviaDati(angolo);',
  '}',
  '',
  '/* invia il valore letto dal sensore */',
  'void inviaDati(float v) {',
  '  // TODO: gestire l\'errore di trasmissione',
  '  LoRa.beginPacket();',
  '  LoRa.print(v);',
  '}',
  '',
  'void maiUsata() { return; }');

(async () => {
  await check('riconosce i file di codice dall’estensione', () => {
    ['a.js', 'b.py', 'c.ino', 'd.sql', 'e.rs', 'f.yaml', 'g.ipynb'].forEach((n) => assert.ok(WCCode.is(n), n));
    ['a.pdf', 'b.docx', 'c.txt', 'd.md', 'e.png'].forEach((n) => assert.ok(!WCCode.is(n), n));
    assert.ok(WCCode.EXT.length >= 40, 'linguaggi: ' + WCCode.EXT.length);
  });

  await check('Arduino: variabili, funzioni, righe esatte, commenti e cose da fare', () => {
    const r = WCCode.parse(INO, 'allarme.ino');
    assert.strictEqual(r.langName, 'Arduino');
    assert.deepStrictEqual(names(r, 'variable'), ['sensore', 'angolo', 'maiLetta']);
    assert.deepStrictEqual(names(r, 'function'), ['setup', 'loop', 'inviaDati', 'maiUsata']);
    const setup = r.symbols.find((s) => s.name === 'setup');
    assert.strictEqual(setup.line, 9);
    assert.strictEqual(setup.endLine, 12, 'la funzione finisce alla graffa chiusa');
    assert.strictEqual(setup.doc, 'prepara la radio e il sensore', 'il commento sopra è la documentazione');
    const una = r.symbols.find((s) => s.name === 'maiUsata');
    assert.strictEqual(una.line, 26);
    assert.strictEqual(una.endLine, 26, 'una funzione su una riga sola comincia e finisce lì');
    assert.deepStrictEqual(r.imports.map((i) => i.from), ['LoRa.h', 'SCL3300.h']);
    assert.deepStrictEqual(r.todos, [{ tag: 'TODO', text: 'gestire l\'errore di trasmissione', line: 21 }]);
    assert.strictEqual(r.symbols.find((s) => s.name === 'inviaDati').doc, 'invia il valore letto dal sensore', 'un TODO non è documentazione');
  });

  await check('chiamate: chi usa chi, attribuite alla funzione che le contiene', () => {
    const r = WCCode.parse(INO, 'allarme.ino');
    const c = r.calls.map((x) => (x.from || '(file)') + '>' + x.to);
    assert.ok(c.includes('loop>inviaDati'), 'loop chiama inviaDati: ' + c.join(', '));
    assert.ok(c.includes('loop>getAngle'));
    assert.ok(c.includes('inviaDati>print'));
    assert.ok(!c.some((x) => /^\(file\)>setup$/.test(x)), 'la definizione non è una chiamata');
    assert.ok(r.calls.find((x) => x.to === 'inviaDati').known, 'inviaDati è definita qui');
    assert.ok(!r.calls.find((x) => x.to === 'print').known, 'print viene da fuori');
  });

  await check('codice morto: solo quello che nessuno usa davvero', () => {
    const r = WCCode.parse(INO, 'allarme.ino');
    const d = WCCode.dead([{ name: 'allarme.ino', path: '/p/allarme.ino', symbols: r.symbols, calls: r.calls, imports: r.imports, usage: r.usage }]);
    const got = d.map((x) => x.name).sort();
    assert.deepStrictEqual(got, ['maiLetta', 'maiUsata'], 'morti: ' + got.join(', '));
    assert.ok(!got.includes('setup') && !got.includes('loop'), 'setup e loop sono punti di ingresso');
    assert.ok(!got.includes('angolo') && !got.includes('sensore'), 'una variabile letta altrove è viva');
    assert.strictEqual(d[0].file, 'allarme.ino');
    assert.ok(d.every((x) => x.line > 0), 'ognuno con la sua riga');
  });

  await check('una funzione usata in un altro file non è morta', () => {
    const a = WCCode.parse(L('export function aiuta(x) { return x; }', 'function sola() { return 1; }'), 'util.js');
    const b = WCCode.parse(L('import { aiuta } from "./util";', 'console.log(aiuta(2));'), 'app.js');
    const d = WCCode.dead([
      { name: 'util.js', symbols: a.symbols, calls: a.calls, imports: a.imports, usage: a.usage },
      { name: 'app.js', symbols: b.symbols, calls: b.calls, imports: b.imports, usage: b.usage }
    ]).map((x) => x.name);
    assert.ok(!d.includes('aiuta'), 'aiuta è usata altrove: ' + d.join(', '));
    assert.ok(d.includes('sola'), 'sola non la usa nessuno');
  });

  await check('Python: classi, metodi, livelli di indentazione e docstring', () => {
    const r = WCCode.parse(L(
      'import os',
      'from math import sqrt',
      '',
      'MAX = 10',
      '',
      'class Sensore(Base):',
      '    """Legge il sensore."""',
      '    def leggi(self, n):',
      '        return sqrt(n)',
      '',
      'def main():',
      '    s = Sensore()',
      '    print(s.leggi(MAX))'), 'app.py');
    assert.strictEqual(r.langName, 'Python');
    const cl = r.symbols.find((s) => s.kind === 'class');
    assert.strictEqual(cl.name, 'Sensore');
    assert.strictEqual(cl.base, 'Base');
    const leggi = r.symbols.find((s) => s.name === 'leggi');
    assert.strictEqual(leggi.kind, 'method', 'una def dentro una classe è un metodo');
    assert.deepStrictEqual(leggi.params, ['self', 'n']);
    assert.ok(/Legge il sensore/.test(leggi.doc), 'docstring: ' + leggi.doc);
    assert.strictEqual(r.symbols.find((s) => s.name === 'main').kind, 'function');
    assert.strictEqual(r.symbols.find((s) => s.name === 'MAX').kind, 'constant');
    assert.deepStrictEqual(r.imports.map((i) => i.from), ['os', 'math']);
  });

  await check('JavaScript: classi, frecce, esportazioni, import con stringhe ed endpoint', () => {
    const r = WCCode.parse(L(
      'import { render } from "react";',
      'const fs = require("fs");',
      '',
      'export const soglia = 10;',
      '',
      '/** crea il client */',
      'export function makeClient(url) { return fetch(url); }',
      '',
      'class Store extends Base {',
      '  save(k) { return put(k); }',
      '}',
      '',
      'app.get("/users", h);'), 'app.js');
    assert.deepStrictEqual(r.imports.map((i) => i.from), ['react', 'fs']);
    assert.strictEqual(r.imports[0].what, 'render');
    const mk = r.symbols.find((s) => s.name === 'makeClient');
    assert.ok(mk.exported, 'export riconosciuto');
    assert.strictEqual(mk.doc, 'crea il client');
    assert.strictEqual(r.symbols.find((s) => s.name === 'Store').base, 'Base');
    assert.ok(r.symbols.some((s) => s.kind === 'endpoint' && s.name === 'GET /users'), 'endpoint: ' + names(r).join(', '));
  });

  await check('stringhe e commenti non confondono il riconoscimento', () => {
    const r = WCCode.parse(L(
      'const msg = "class Finta { non esiste }";',
      '// function Commentata() {}',
      '/* class AncheQuesta {} */',
      'function vera() { return "// non un commento"; }'), 'x.js');
    assert.deepStrictEqual(names(r).sort(), ['msg', 'vera'], 'trovati: ' + names(r).join(', '));
  });

  await check('SQL, shell, CSS e configurazioni', () => {
    const sql = WCCode.parse(L('-- gli utenti', 'CREATE TABLE utenti (id INT);', 'CREATE VIEW attivi AS SELECT 1;'), 'db.sql');
    assert.deepStrictEqual(names(sql), ['utenti', 'attivi']);
    assert.strictEqual(sql.symbols[0].doc, 'gli utenti');
    const sh = WCCode.parse(L('# avvia', 'PORTA=8080', 'avvia() {', '  echo $PORTA', '}'), 'run.sh');
    assert.ok(names(sh).includes('avvia') && names(sh).includes('PORTA'), names(sh).join(', '));
    const css = WCCode.parse(L('--colore: red;', '.bottone { color: var(--colore); }'), 'stile.css');
    assert.ok(names(css).includes('.bottone'), names(css).join(', '));
    const yml = WCCode.parse(L('nome: prova', 'porta: 80'), 'conf.yaml');
    assert.deepStrictEqual(names(yml), ['nome', 'porta']);
  });

  await check('complessità e statistiche', () => {
    const r = WCCode.parse(L(
      'function semplice() { return 1; }',
      'function difficile(a) {',
      '  if (a) { for (var i = 0; i < 3; i++) { if (i && a) return i; } }',
      '  while (a) { a--; }',
      '  return 0;',
      '}'), 'x.js');
    assert.strictEqual(r.symbols.find((s) => s.name === 'semplice').complexity, 1);
    assert.ok(r.symbols.find((s) => s.name === 'difficile').complexity >= 5, 'complessità: ' + r.symbols.find((s) => s.name === 'difficile').complexity);
    assert.strictEqual(r.stats.symbols, 2);
    assert.ok(r.stats.lines === 6 && r.stats.maxComplexity >= 5, JSON.stringify(r.stats));
  });

  await check('notebook Jupyter: celle di codice e celle di testo', () => {
    const nb = JSON.stringify({ cells: [
      { cell_type: 'markdown', source: ['# Analisi\n', 'Proviamo la trasformata.'] },
      { cell_type: 'code', source: ['def trasforma(x):\n', '    return x * 2\n'] }
    ] });
    const r = WCCode.parse(nb, 'prova.ipynb');
    assert.strictEqual(r.langName, 'Notebook Jupyter');
    assert.ok(names(r).includes('trasforma'), names(r).join(', '));
    assert.ok(r.blocks.some((b) => /trasformata/.test(b.text)), 'il testo del notebook resta leggibile');
  });

  await check('un file vuoto o illeggibile non rompe niente', () => {
    const r = WCCode.parse('', 'vuoto.js');
    assert.deepStrictEqual(r.symbols, []);
    assert.strictEqual(r.stats.symbols, 0);
    assert.deepStrictEqual(WCCode.dead([]), []);
    const bad = WCCode.parse('{ non json', 'rotto.ipynb');
    assert.ok(Array.isArray(bad.symbols));
  });

  // ---------------------------------------------------------------- nel cervello
  function codeInput(name, text) {
    const r = WCCode.parse(text, name);
    const toks = WCText.tokenizeBlocks(r.blocks.map((b) => ({ text: b.text, w: b.type === 'h' ? 2 : 1 })));
    return {
      meta: { id: 'd-' + name.length.toString(16).padStart(16, '0') + name.length, path: '/p/' + name, name, ext: name.split('.').pop(), size: 100, hash: 'h' + name },
      format: r.langName, title: name, tokens: toks.map((t) => [t.text, t.gap, t.blk, t.w, null]),
      tail: toks.length ? toks[toks.length - 1].tail : '', blocks: r.blocks.map((b) => ({ type: b.type, level: b.level, line: b.line })), code: r
    };
  }

  await check('il codice entra nel cervello: simboli come concetti, con la riga come fonte', async () => {
    const rec = await WCLibrary.buildRecord(codeInput('radio.ino', INO), {});
    assert.ok(rec.code && rec.code.symbols.length, 'la struttura resta nel record');
    const kb = WCLibrary.open([rec], WCLibrary.emptyEdits());
    const G = kb.graph();
    const labels = G.nodes.map((n) => n.label);
    assert.ok(labels.includes('inviaDati') && labels.includes('loop'), 'concetti: ' + labels.join(', '));
    // le parole del linguaggio non sono concetti
    ['void', 'float', 'return', 'funzione'].forEach((w) => assert.ok(!labels.some((l) => l.toLowerCase() === w), w + ' non deve essere un concetto: ' + labels.join(', ')));
    const c = kb.concept(G.nodes.find((n) => n.label === 'inviaDati').id);
    assert.strictEqual(c.code.kind, 'function');
    assert.strictEqual(c.code.line, 20);
    assert.strictEqual(c.defs[0].where, 'riga 20', 'la definizione punta alla sua riga, non a dove viene chiamata');
    assert.deepStrictEqual(c.code.params, ['v']);
    assert.ok(/invia il valore/.test(c.defs[0].text), 'il commento fa da definizione: ' + JSON.stringify(c.defs[0]));
    assert.ok(c.sources.length, 'ha i passaggi dove compare');
  });

  await check('gli archi del codice: usa, eredita da', async () => {
    const recs = [
      await WCLibrary.buildRecord(codeInput('radio.ino', INO), {}),
      await WCLibrary.buildRecord(codeInput('store.js', L('class Store extends Base {', '  save(k) { return put(k); }', '}', 'function put(k) { return k; }')), {})
    ];
    const kb = WCLibrary.open(recs, WCLibrary.emptyEdits());
    const G = kb.graph();
    const lab = new Map(G.nodes.map((n) => [n.id, n.label]));
    const rel = G.edges.filter((e) => e.type === 'use' || e.type === 'ext').map((e) => lab.get(e.a) + ' ' + e.label + ' ' + lab.get(e.b));
    assert.ok(rel.some((x) => /loop usa inviaDati/.test(x)), 'chiamate come archi: ' + rel.join(' | '));
    assert.ok(rel.some((x) => /Store eredita da Base/.test(x)), 'eredità: ' + rel.join(' | '));
    const c = kb.concept(G.nodes.find((n) => n.label === 'inviaDati').id);
    assert.ok(c.related.some((r) => r.rel === 'usato da' && r.label === 'loop'), 'dall’altra parte: ' + JSON.stringify(c.related.slice(0, 4)));
  });

  await check('cercare nel codice: il nome di una funzione trova dove è definita e dove si usa', async () => {
    const kb = WCLibrary.open([await WCLibrary.buildRecord(codeInput('radio.ino', INO), {})], WCLibrary.emptyEdits());
    const q = kb.search('inviaDati');
    assert.ok(q.total >= 2, 'risultati: ' + q.total);
    assert.ok(q.results.some((r) => /funzione .*inviaDati/.test(r.text)), 'la definizione: ' + q.results.map((r) => r.text.slice(0, 40)).join(' | '));
    assert.ok(q.concepts.length && q.concepts[0].label === 'inviaDati', 'riconosciuto come concetto');
    const todo = kb.search('TODO');
    assert.ok(todo.total >= 1, 'le cose da fare si cercano: ' + todo.total);
  });

  await check('domande sul codice: chi chiama, di cosa ha bisogno, cosa è morto', async () => {
    const recs = [
      await WCLibrary.buildRecord(codeInput('radio.ino', INO), {}),
      await WCLibrary.buildRecord(codeInput('util.js', L('export function aiuta(x) { return x; }', '// TODO: scrivere i test', 'function sola() { return 1; }')), {})
    ];
    const kb = WCLibrary.open(recs, WCLibrary.emptyEdits());

    const chi = kb.code({ kind: 'who-calls', name: 'inviaDati' });
    assert.strictEqual(chi.items.length, 1, JSON.stringify(chi.items));
    assert.strictEqual(chi.items[0].caller, 'loop');
    assert.strictEqual(chi.items[0].file, 'radio.ino');
    assert.strictEqual(chi.items[0].line, 16);
    assert.strictEqual(chi.items[0].where, 'riga 16');

    const usa = kb.code({ kind: 'uses', name: 'loop' });
    assert.ok(usa.items.some((x) => x.target === 'inviaDati' && x.known), 'loop usa inviaDati: ' + JSON.stringify(usa.items));
    assert.ok(usa.items.some((x) => x.target === 'getAngle' && !x.known), 'e getAngle, che viene da fuori');

    const morto = kb.code({ kind: 'dead' });
    const nomi = morto.items.map((x) => x.name).sort();
    assert.deepStrictEqual(nomi, ['maiLetta', 'maiUsata', 'sola'], 'morti: ' + nomi.join(', '));
    assert.ok(morto.items.every((x) => x.file && x.line > 0), 'ognuno con file e riga');

    const todo = kb.code({ kind: 'todos' });
    assert.strictEqual(todo.items.length, 2, JSON.stringify(todo.items));
    assert.ok(todo.items.some((x) => x.file === 'util.js' && /test/.test(x.text)));

    const cx = kb.code({ kind: 'complexity' });
    assert.ok(cx.items.length >= 4 && cx.items[0].complexity >= cx.items[cx.items.length - 1].complexity, 'in ordine di complessità');
    assert.ok(cx.items.every((x) => x.file && x.signature !== undefined));

    const solo = kb.code({ kind: 'todos', doc: recs[1].id });
    assert.strictEqual(solo.items.length, 1, 'il filtro per documento funziona');
  });

  await check('riepilogo, glossario e dipendenze tra i file', async () => {
    const recs = [
      await WCLibrary.buildRecord(codeInput('util.js', L('export function aiuta(x) { return x; }')), {}),
      await WCLibrary.buildRecord(codeInput('app.js', L('import { aiuta } from "./util";', 'import React from "react";', 'console.log(aiuta(1));')), {})
    ];
    const kb = WCLibrary.open(recs, WCLibrary.emptyEdits());
    const ov = kb.code({});
    assert.strictEqual(ov.stats.files, 2);
    assert.ok(ov.stats.functions >= 1 && ov.stats.lines >= 4, JSON.stringify(ov.stats));
    assert.ok(ov.stats.langs.some((l) => l.name === 'JavaScript'));

    const dp = kb.code({ kind: 'deps' });
    assert.strictEqual(dp.links.length, 1, 'app.js dipende da util.js: ' + JSON.stringify(dp.links));
    assert.strictEqual(dp.links[0].fromName, 'app.js');
    assert.strictEqual(dp.links[0].toName, 'util.js');
    assert.ok(dp.external.some((e) => e.module === 'react'), 'le librerie esterne a parte: ' + JSON.stringify(dp.external));

    const gl = kb.code({ kind: 'glossary' });
    assert.strictEqual(gl.files.length, 2);
    assert.ok(gl.files.some((f) => f.symbols.some((s) => s.name === 'aiuta')));

    const md = kb.codeMarkdown({});
    assert.ok(/# Documentazione del codice/.test(md));
    assert.ok(/```mermaid/.test(md) && /app\.js/.test(md), 'il diagramma delle dipendenze');
    assert.ok(/## Glossario/.test(md) && /aiuta/.test(md));
    assert.ok(/## Librerie esterne/.test(md) && /react/.test(md));
    assert.ok(md.indexOf('x.name2') < 0, 'niente residui');
  });

  await check('un cervello senza codice risponde comunque', async () => {
    const kb = WCLibrary.open([], WCLibrary.emptyEdits());
    assert.strictEqual(kb.code({}).stats.files, 0);
    assert.deepStrictEqual(kb.code({ kind: 'dead' }).items, []);
    assert.deepStrictEqual(kb.code({ kind: 'who-calls', name: 'x' }).items, []);
    assert.ok(/Nessun file di codice/.test(kb.codeMarkdown({})));
  });

  console.log(failures ? '\n' + failures + ' prove fallite' : '\ntutte le prove del codice sono passate');
  process.exit(failures ? 1 : 0);
})();
