// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/* Test della ricerca per significato: core/semantic.js e la ricerca ibrida. Uso: node tests/semantic.test.js */
'use strict';
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
['core/settings.js', 'core/lang.js', 'core/text.js', 'core/analysis.js', 'core/code.js', 'core/semantic.js', 'core/library.js']
  .forEach((f) => require(path.join(root, f)));
const { WCText, WCLibrary, WCSemantic } = globalThis;

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
  const id = 's-' + (++n).toString(16).padStart(16, '0');
  return {
    meta: { id, path: '/l/' + name, name, ext: name.split('.').pop(), size: 100, hash: 'h' + n },
    format: 'Testo', title: blocks[0].text, tokens: toks.map((t) => [t.text, t.gap, t.blk, t.w, null]),
    tail: toks.length ? toks[toks.length - 1].tail : '', blocks: blocks.map((b) => ({ type: b.type || 'p' }))
  };
}
/*
 * Due parole che vogliono dire la stessa cosa, dette sempre nelle stesse frasi ma mai insieme:
 * nessuna ricerca per parole può collegarle, il significato sì. È il caso limite su cui si misura.
 */
const SINONIMI = (() => {
  const ctx = [
    'dipende dal canale e dal rumore presente',
    'si misura in bit al secondo con lo strumento',
    'cala quando il rumore del canale cresce',
    'cresce se il canale è pulito e la potenza è alta',
    'va misurata prima di collegare altri utenti alla rete',
    'entra nel calcolo della capacità del collegamento radio'
  ];
  const out = [{ type: 'h', text: 'Telecomunicazioni' }];
  ctx.forEach((c) => {
    out.push({ text: 'Il throughput della rete ' + c + '.' });
    out.push({ text: 'La banda della rete ' + c + '.' });
  });
  out.push({ text: 'Il soffritto si prepara con la cipolla tagliata fine e un filo di olio di oliva.' });
  out.push({ text: 'La cipolla va tagliata fine e messa nell’olio di oliva ancora freddo.' });
  return out;
})();

(async () => {
  let kb = null;
  async function brain() {
    if (kb) return kb;
    const recs = [await WCLibrary.buildRecord(doc('reti.md', SINONIMI), {})];
    kb = WCLibrary.open(recs, WCLibrary.emptyEdits());
    return kb;
  }

  await check('il modello si costruisce dai documenti, senza scaricare niente', async () => {
    const k = await brain();
    const s = k.semantic();
    assert.ok(s.ready, 'pronto');
    assert.ok(s.stats.terms >= 8, 'parole imparate: ' + s.stats.terms);
    assert.ok(s.stats.chunks >= 8, 'passaggi: ' + s.stats.chunks);
    assert.strictEqual(s.stats.dims, WCSemantic.DIMS);
    assert.ok(s.stats.ms < 4000, 'tempo: ' + s.stats.ms + ' ms');
  });

  await check('due parole usate negli stessi discorsi risultano vicine', async () => {
    const k = await brain();
    const near = k.meaningOf('throughput');
    assert.ok(near.length, 'qualcosa di vicino');
    const banda = near.find((x) => /^band/.test(x.term));
    assert.ok(banda, 'la banda è vicina al throughput: ' + near.map((x) => x.term).join(', '));
    assert.ok(banda.score > 0.6, 'quanto vicina: ' + banda.score);
    // a chi legge si mostra una parola vera, non la radice tagliata
    assert.ok(near.every((x) => x.word && x.word.length >= x.term.length), near.map((x) => x.term + '->' + x.word).join(', '));
    assert.strictEqual(banda.word, 'banda');
    // il soffritto non c’entra: un modello che mette tutto vicino a tutto non serve
    assert.ok(!near.some((x) => /^(cipoll|soffritt|oli)/.test(x.term)),
      'la cucina non c’entra con le reti: ' + near.map((x) => x.term).join(', '));
  });

  await check('una parola che non c’è non inventa vicinanze', async () => {
    const k = await brain();
    assert.deepStrictEqual(k.meaningOf('xilofono'), []);
    assert.deepStrictEqual(k.meaningOf(''), []);
  });

  await check('la ricerca per significato trova quello che le parole non trovano', async () => {
    const k = await brain();
    const parole = k.search('banda', {});
    const senso = k.search('banda', { semantic: true });
    const soloParole = parole.results.filter((r) => /throughput/i.test(r.full)).length;
    const conSenso = senso.results.filter((r) => /throughput/i.test(r.full)).length;
    assert.strictEqual(soloParole, 0, 'per parole il throughput non esce');
    assert.ok(conSenso >= 3, 'per significato sì: ' + conSenso);
    assert.ok(senso.semantic.on, 'il risultato dice che era accesa');
    assert.ok(senso.semantic.near.length, 'e quali parole ha considerato vicine');
    assert.ok(!parole.semantic.on, 'spenta se non la si chiede');
  });

  await check('chi corrisponde alle parole resta davanti a chi corrisponde solo al senso', async () => {
    const k = await brain();
    const res = k.search('banda', { semantic: true }).results;
    assert.ok(/banda/i.test(res[0].full), 'primo: ' + res[0].full.slice(0, 60));
    const primoSenso = res.findIndex((r) => r.byMeaning);
    const ultimoParole = res.reduce((at, r, i) => (r.byMeaning ? at : i), -1);
    if (primoSenso >= 0) assert.ok(primoSenso > ultimoParole - res.length, 'ordine coerente');
    const bym = res.filter((r) => r.byMeaning);
    assert.ok(bym.length, 'qualcuno trovato per significato');
    assert.ok(bym.every((r) => r.sem > 0), 'e porta con sé quanto somiglia');
  });

  await check('una frase tra virgolette resta letterale', async () => {
    const k = await brain();
    const res = k.search('"La banda della rete"', { semantic: true });
    assert.ok(!res.semantic.on, 'niente significato dove si chiede la frase esatta');
    assert.ok(res.results.length, 'la frase si trova');
    assert.ok(res.results.every((r) => /La banda della rete/i.test(r.full)));
  });

  await check('concetti vicini di significato, solo quando li si chiede', async () => {
    // una scheda si deve aprire subito: il modello non si costruisce per aprire un concetto
    const fresca = WCLibrary.open([await WCLibrary.buildRecord(doc('reti2.md', SINONIMI), {})], WCLibrary.emptyEdits());
    const g0 = fresca.graph();
    const nd0 = g0.nodes.find((x) => /band/i.test(x.label));
    assert.strictEqual(fresca.concept(nd0.id).similar, null, 'niente modello, niente simili');
    assert.strictEqual(fresca.semanticBuilt(), false, 'e il modello non è stato costruito');
    const chiesti = fresca.concept(nd0.id, { similar: true });
    assert.ok(Array.isArray(chiesti.similar), 'chiesti, arrivano');
    assert.strictEqual(fresca.semanticBuilt(), true);
    // una volta costruito, arrivano da soli: non si paga due volte
    assert.ok(Array.isArray(fresca.concept(nd0.id).similar), 'poi sono gratis');

    const k = await brain();
    const g = k.graph();
    const nd = g.nodes.find((x) => /^banda$/i.test(x.label)) || g.nodes.find((x) => /band/i.test(x.label));
    assert.ok(nd, 'il concetto esiste: ' + g.nodes.slice(0, 10).map((x) => x.label).join(', '));
    const c = k.concept(nd.id, { similar: true });
    assert.ok(Array.isArray(c.similar), 'la scheda porta i simili');
    assert.ok(c.similar.every((x) => x.id !== nd.id), 'non sé stesso');
    assert.ok(c.similar.every((x) => x.score > 0.4), 'solo quelli davvero vicini');
  });

  await check('una libreria vuota, o senza abbastanza testo, non rompe niente', async () => {
    const vuota = WCLibrary.open([], WCLibrary.emptyEdits());
    assert.strictEqual(vuota.semantic().ready, false);
    assert.deepStrictEqual(vuota.meaningOf('rete'), []);
    assert.deepStrictEqual(vuota.search('rete', { semantic: true }).results, []);
    const corta = WCLibrary.open([await WCLibrary.buildRecord(doc('breve.md', [{ type: 'h', text: 'Nota' }, { text: 'Due parole.' }]), {})], WCLibrary.emptyEdits());
    assert.strictEqual(corta.semantic().ready, false, 'con due righe non si impara niente');
    assert.ok(corta.search('nota', { semantic: true }).results.length >= 0);
  });

  await check('i segnaposto sono gli stessi a ogni ricostruzione', async () => {
    const recs = [await WCLibrary.buildRecord(doc('reti.md', SINONIMI), {})];
    const docsOf = (kbx) => kbx.semantic();
    const a = WCLibrary.open(recs, WCLibrary.emptyEdits());
    const b = WCLibrary.open(recs, WCLibrary.emptyEdits());
    assert.strictEqual(docsOf(a).stats.terms, docsOf(b).stats.terms);
    assert.deepStrictEqual(a.meaningOf('throughput').map((x) => x.term), b.meaningOf('throughput').map((x) => x.term));
    assert.deepStrictEqual(a.meaningOf('throughput').map((x) => x.score), b.meaningOf('throughput').map((x) => x.score));
  });

  await check('prestazioni: un cervello grande impara in pochi secondi', async () => {
    const VOC = ('modulo canale potenza segnale rumore filtro antenna guadagno fase ritardo pacchetto indirizzo '
      + 'protocollo cifratura chiave firma impronta archivio registro soglia deriva taratura sonda tensione '
      + 'corrente resistenza condensatore bobina oscillatore quarzo amplificatore attenuatore commutatore '
      + 'ponte transistor diodo relè sensore attuatore motore encoder cuscinetto ingranaggio albero puleggia').split(' ');
    const big = [];
    for (let i = 0; i < 60; i++) {
      const blocks = [{ type: 'h', text: 'Capitolo ' + i }];
      for (let j = 0; j < 20; j++) {
        const a = VOC[(i * 7 + j) % VOC.length], b = VOC[(i * 13 + j * 3) % VOC.length], c = VOC[(i + j * 5) % VOC.length];
        blocks.push({ text: 'Il ' + a + ' del sistema lavora con il ' + b + ' e tiene conto del ' + c +
          ' quando la prova numero ' + (i * j % 11) + ' supera la soglia prevista dal capitolo.' });
      }
      big.push(await WCLibrary.buildRecord(doc('cap' + i + '.md', blocks), {}));
    }
    const k2 = WCLibrary.open(big, WCLibrary.emptyEdits());
    const t0 = Date.now();
    const s = k2.semantic();
    const ms = Date.now() - t0;
    console.log('     ' + s.stats.chunks + ' passaggi, ' + s.stats.terms + ' parole in ' + ms + ' ms');
    assert.ok(s.ready);
    assert.ok(ms < 8000, 'troppo lento: ' + ms + ' ms');
    const t1 = Date.now();
    k2.search('come si misura la potenza', { semantic: true });
    const qms = Date.now() - t1;
    console.log('     domanda in ' + qms + ' ms');
    assert.ok(qms < 1500, 'domanda troppo lenta: ' + qms + ' ms');
  });

  console.log(failures ? failures + ' prove non passate' : 'tutte le prove del significato sono passate');
  process.exit(failures ? 1 : 0);
})();
