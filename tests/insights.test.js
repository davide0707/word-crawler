// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/* Test di quello che il cervello nota da solo: lacune, contraddizioni, spiegazioni, confronto. Uso: node tests/insights.test.js */
'use strict';
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
['core/settings.js', 'core/lang.js', 'core/text.js', 'core/analysis.js', 'core/code.js', 'core/library.js'].forEach((f) => require(path.join(root, f)));
const { WCText, WCLibrary, WCCode } = globalThis;

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + (e && e.stack || e));
    if (process.env.GITHUB_ACTIONS) console.log('::error title=' + name.replace(/[:,\n]/g, ' ') + '::' + String(e && e.message || e).slice(0, 900).replace(/\r?\n/g, '%0A'));
  }
}
let n = 0;
function doc(name, blocks) {
  const toks = WCText.tokenizeBlocks(blocks.map((b) => ({ text: b.text, w: b.type === 'h' ? 3 : 1 })));
  const id = 'i-' + (++n).toString(16).padStart(16, '0');
  return {
    meta: { id, path: '/l/' + name, name, ext: name.split('.').pop(), size: 100, hash: 'h' + n },
    format: 'Testo', title: blocks[0].text, tokens: toks.map((t) => [t.text, t.gap, t.blk, t.w, null]),
    tail: toks.length ? toks[toks.length - 1].tail : '', blocks: blocks.map((b) => ({ type: b.type || 'p' }))
  };
}
function codeDoc(name, text) {
  const r = WCCode.parse(text, name);
  const toks = WCText.tokenizeBlocks(r.blocks.map((b) => ({ text: b.text, w: b.type === 'h' ? 2 : 1 })));
  const id = 'i-' + (++n).toString(16).padStart(16, '0');
  return {
    meta: { id, path: '/l/' + name, name, ext: name.split('.').pop(), size: 100, hash: 'h' + n },
    format: r.langName, title: name, tokens: toks.map((t) => [t.text, t.gap, t.blk, t.w, null]), tail: '',
    blocks: r.blocks.map((b) => ({ type: b.type, level: b.level, line: b.line })), code: r
  };
}

(async () => {
  await check('lacune: un concetto nominato spesso e mai definito', async () => {
    const d = doc('appunti.md', [
      { type: 'h', text: 'Telecomunicazioni' },
      { text: 'Il throughput dipende dal canale. Il throughput si misura in bit al secondo.' },
      { text: 'Con un throughput alto la rete regge più utenti. Il throughput cala con il rumore.' },
      { text: 'La modulazione digitale è una tecnica che trasforma i bit in un segnale.' }
    ]);
    const kb = WCLibrary.open([await WCLibrary.buildRecord(d, {})], WCLibrary.emptyEdits());
    const ins = kb.insights({});
    const gap = ins.gaps.find((x) => /throughput/i.test(x.label));
    assert.ok(gap, 'il throughput è una lacuna: ' + ins.gaps.map((x) => x.label).join(', '));
    assert.ok(gap.count >= 4, 'contato: ' + gap.count);
    assert.ok(/mai definito/.test(gap.why));
    assert.ok(!ins.gaps.some((x) => /modulazione digitale/i.test(x.label)), 'quella definita non è una lacuna');
  });

  await check('contraddizioni: due documenti che non vanno d’accordo', async () => {
    const a = doc('prof.md', [
      { type: 'h', text: 'Corso' },
      { text: 'Il rumore termico è il rumore che cresce con la temperatura assoluta del conduttore.' }
    ]);
    const b = doc('appunti.md', [
      { type: 'h', text: 'Appunti' },
      { text: 'Il rumore termico è il rumore che non cresce con la temperatura assoluta del conduttore.' }
    ]);
    const c = doc('numeri.md', [
      { type: 'h', text: 'Schede' },
      { text: 'La soglia di rumore è un limite fissato a 20 decibel per il canale radio in uso.' }
    ]);
    const d2 = doc('numeri2.md', [
      { type: 'h', text: 'Schede riviste' },
      { text: 'La soglia di rumore è un limite fissato a 35 decibel per il canale radio in uso.' }
    ]);
    const recs = [];
    for (const x of [a, b, c, d2]) recs.push(await WCLibrary.buildRecord(x, {}));
    const kb = WCLibrary.open(recs, WCLibrary.emptyEdits());
    const ins = kb.insights({});
    assert.ok(ins.contradictions.length >= 1, 'almeno una contraddizione: ' + JSON.stringify(ins.contradictions.map((x) => x.label)));
    ins.contradictions.forEach((x) => {
      assert.ok(x.a.name && x.b.name && x.a.name !== x.b.name, 'due documenti diversi: ' + x.a.name + ' / ' + x.b.name);
      assert.ok(x.why && x.a.text && x.b.text, 'con il perché e le due frasi');
    });
    const nums = ins.contradictions.find((x) => /una dice 20, l’altra 35|una dice 35, l’altra 20/.test(x.why));
    const neg = ins.contradictions.find((x) => /nega/.test(x.why));
    assert.ok(nums || neg, 'riconosce i numeri o la negazione: ' + ins.contradictions.map((x) => x.why).join(' | '));
  });

  await check('due definizioni che si completano non sono una contraddizione', async () => {
    const a = doc('a.md', [{ type: 'h', text: 'A' }, { text: 'La QAM è una modulazione digitale che usa ampiezza e fase.' }]);
    const b = doc('b.md', [{ type: 'h', text: 'B' }, { text: 'La QAM è una modulazione digitale usata nelle reti wireless.' }]);
    const recs = [await WCLibrary.buildRecord(a, {}), await WCLibrary.buildRecord(b, {})];
    const kb = WCLibrary.open(recs, WCLibrary.emptyEdits());
    assert.deepStrictEqual(kb.insights({}).contradictions, []);
  });

  await check('divergenze fra documentazione e codice', async () => {
    const recs = [
      await WCLibrary.buildRecord(codeDoc('radio.ino', 'void invia(int v) { }\nvoid loop() { invia(1); }'), {}),
      await WCLibrary.buildRecord(doc('manuale.md', [
        { type: 'h', text: 'Manuale' },
        { text: 'Per trasmettere si chiama invia(). Per fermare tutto si chiama spegniTutto(), che non esiste più nel firmware.' }
      ]), {})
    ];
    const kb = WCLibrary.open(recs, WCLibrary.emptyEdits());
    const dr = kb.insights({}).drift;
    assert.ok(dr.some((x) => x.name === 'spegniTutto'), 'segnala la funzione sparita: ' + JSON.stringify(dr.map((x) => x.name)));
    assert.ok(!dr.some((x) => x.name === 'invia'), 'invia() c’è davvero, non è una divergenza');
    const x = dr.find((y) => y.name === 'spegniTutto');
    assert.strictEqual(x.file, 'manuale.md');
    assert.ok(x.where !== undefined && x.n >= 0, 'con la fonte');
  });

  await check('concetti isolati e snodi', async () => {
    const a = doc('rete.md', [
      { type: 'h', text: 'Rete' },
      { text: 'La modulazione digitale usa la portante. La portante trasporta il segnale modulato.' },
      { text: 'Il segnale modulato arriva al ricevitore attraverso il canale radio.' }
    ]);
    const b = doc('cucina.md', [{ type: 'h', text: 'Ricette' }, { text: 'Il soffritto si fa con cipolla e carota. Il soffritto è la base di molti piatti.' }]);
    const recs = [await WCLibrary.buildRecord(a, {}), await WCLibrary.buildRecord(b, {})];
    const kb = WCLibrary.open(recs, WCLibrary.emptyEdits());
    const ins = kb.insights({});
    assert.ok(Array.isArray(ins.orphans) && Array.isArray(ins.hubs));
    ins.orphans.forEach((x) => assert.ok(x.why && x.label));
  });

  await check('spiega: solo frasi vere, ognuna con la sua fonte', async () => {
    const a = doc('reti.md', [
      { type: 'h', text: 'Reti' },
      { text: 'La QAM è una modulazione digitale che combina ampiezza e fase per trasmettere più bit per simbolo.' },
      { text: 'La modulazione digitale è una tecnica che trasforma una sequenza di bit in un segnale analogico.' },
      { text: 'Nelle reti wireless la QAM si adatta al rumore del canale.' }
    ]);
    const kb = WCLibrary.open([await WCLibrary.buildRecord(a, {})], WCLibrary.emptyEdits());
    const node = kb.graph().nodes.find((x) => /QAM/i.test(x.label));
    const e = kb.explain(node.id);
    assert.ok(e && e.parts.length, 'una spiegazione');
    const def = e.parts.find((p) => p.role === 'def');
    assert.ok(def && /modulazione digitale/.test(def.text), 'parte dalla definizione: ' + JSON.stringify(def));
    assert.ok(def.source.name === 'reti.md' && def.source.n >= 0, 'con la fonte');
    e.parts.forEach((p) => {
      if (p.role === 'rel') assert.ok(p.label && p.rel, 'ogni collegamento ha nome e relazione');
      if (p.text) assert.ok(a.tokens.length > 0, 'il testo viene dal documento');
    });
    assert.ok(e.read.length && e.read[0].name === 'reti.md', 'e dove leggerlo');
    const md = kb.branch(node.id);
    assert.ok(/^# /.test(md) && /reti\.md/.test(md), 'il riassunto del ramo: ' + md.slice(0, 120));
    assert.strictEqual(kb.explain('niente'), null);
  });

  await check('confronto fra due cervelli: comuni, solo di uno, spostati', async () => {
    const a = doc('a.md', [
      { type: 'h', text: 'Reti' },
      { text: 'La QAM è una modulazione digitale. La QAM usa ampiezza e fase. La QAM è ovunque nelle reti.' },
      { text: 'Il rumore termico limita la velocità. Il rumore termico cresce con la temperatura.' }
    ]);
    const b = doc('b.md', [
      { type: 'h', text: 'Altri appunti' },
      { text: 'La QAM è una modulazione digitale usata nei modem.' },
      { text: 'Il subnetting divide una rete IP. Il subnetting usa la maschera. Il subnetting serve sempre.' }
    ]);
    const kbA = WCLibrary.open([await WCLibrary.buildRecord(a, {})], WCLibrary.emptyEdits());
    const kbB = WCLibrary.open([await WCLibrary.buildRecord(b, {})], WCLibrary.emptyEdits());
    const d = WCLibrary.diff(kbA.graph(), kbB.graph());
    const lab = (l) => l.map((x) => x.label.toLowerCase());
    assert.ok(lab(d.shared).some((x) => /qam/.test(x)), 'la QAM è in tutti e due: ' + lab(d.shared).join(', '));
    assert.ok(lab(d.onlyA).some((x) => /rumore/.test(x)), 'il rumore solo nel primo: ' + lab(d.onlyA).join(', '));
    assert.ok(lab(d.onlyB).some((x) => /subnetting/.test(x)), 'il subnetting solo nel secondo: ' + lab(d.onlyB).join(', '));
    assert.ok(d.stats.shared >= 1 && d.stats.overlap > 0 && d.stats.overlap <= 1, JSON.stringify(d.stats));
    assert.ok(Array.isArray(d.moved), 'e i concetti che cambiano peso');
    const vuoto = WCLibrary.diff({ nodes: [] }, kbB.graph());
    assert.strictEqual(vuoto.shared.length, 0);
    assert.strictEqual(vuoto.onlyB.length, kbB.graph().nodes.length);
  });

  await check('una libreria vuota non rompe niente', () => {
    const kb = WCLibrary.open([], WCLibrary.emptyEdits());
    const ins = kb.insights({});
    assert.deepStrictEqual([ins.gaps, ins.orphans, ins.contradictions, ins.drift], [[], [], [], []]);
    assert.strictEqual(kb.explain('x'), null);
    assert.strictEqual(kb.branch('x'), '');
    assert.strictEqual(WCLibrary.diff({ nodes: [] }, { nodes: [] }).stats.shared, 0);
  });

  console.log(failures ? '\n' + failures + ' prove fallite' : '\ntutte le prove sono passate');
  process.exit(failures ? 1 : 0);
})();
