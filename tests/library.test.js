// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/* Test della libreria (core/library.js) in Node: pezzi, concetti, unioni, grafo, ricerca e modifiche. Uso: node tests/library.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
['core/settings.js', 'core/lang.js', 'core/text.js', 'core/analysis.js', 'core/library.js'].forEach((f) => require(path.join(root, f)));
const { WCText, WCLibrary } = globalThis;

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + (e && e.stack || e));
    if (process.env.GITHUB_ACTIONS) console.log('::error title=' + name.replace(/[:,\n]/g, ' ') + '::' + String(e && e.message || e).slice(0, 900).replace(/\r?\n/g, '%0A'));
  }
}

// un documento come lo prepara library-import.js: blocchi -> parole
let nDoc = 0;
function input(name, blocks, extra) {
  const toks = WCText.tokenizeBlocks(blocks.map((b) => ({ text: b.text, w: b.type === 'h' ? 3 : 1 })));
  const id = 'd-' + (++nDoc).toString(16).padStart(16, '0');
  return Object.assign({
    meta: { id, path: '/libreria/' + name, name, ext: name.split('.').pop(), size: 1000 + nDoc, mtime: '2026-10-0' + (nDoc % 9 + 1) + 'T10:00:00.000Z', hash: 'h' + nDoc },
    format: 'Testo', title: blocks[0].text, tokens: toks.map((t) => [t.text, t.gap, t.blk, t.w, null]), tail: toks.length ? toks[toks.length - 1].tail : '',
    blocks: blocks.map((b) => ({ type: b.type || 'p', slide: b.slide }))
  }, extra || {});
}
function paras(text) { return text.split(/\n\s*\n/).map((p, i) => ({ type: i === 0 && p.length < 80 ? 'h' : 'p', text: p.trim() })).filter((b) => b.text); }
// un PDF finto: parole con pagina e riquadro, paragrafi come blocchi
function pdfInput(name, pages) {
  const tokens = [];
  let blk = 0, tail = '';
  pages.forEach((paraList, pi) => {
    paraList.forEach((text, k) => {
      const toks = WCText.tokenizeString(text, blk, 1);
      // come in pdfcore.js: la punteggiatura finale del paragrafo prima va nello spazio della prima parola
      toks.forEach((t, j) => tokens.push([t.text, (tokens.length && j === 0 ? tail + '\n' : '') + t.gap, blk, 1, pi, [0.1 + (j % 10) * 0.08, 0.1 + k * 0.2 + Math.floor(j / 10) * 0.02, 0.06, 0.015]]));
      tail = toks.length ? toks[toks.length - 1].tail || '' : '';
      blk++;
    });
  });
  const id = 'd-' + (++nDoc).toString(16).padStart(16, '0');
  return { meta: { id, path: '/libreria/' + name, name, ext: 'pdf', size: 5000, hash: 'p' + nDoc }, format: 'PDF', title: name, pages: pages.length, tokens, tail: '.', pdf: true };
}

const docA = input('Reti_e_Segnali.docx', [
  { type: 'h', text: 'Modulazione digitale' },
  { text: 'La Quadrature Amplitude Modulation (QAM) è una modulazione digitale che combina ampiezza e fase per trasmettere più bit per simbolo. La QAM si usa nelle reti wireless e nei modem via cavo.' },
  { text: 'La modulazione digitale trasforma una sequenza di bit in un segnale analogico. Ogni simbolo porta uno o più bit: più bit per simbolo significano più velocità, ma anche più errori in presenza di rumore.' },
  { type: 'h', text: 'Trasformata di Fourier' },
  { text: 'La trasformata di Fourier scompone un segnale nelle sue frequenze. Senza la trasformata di Fourier non si potrebbe progettare un filtro né capire la banda occupata da una modulazione digitale.' },
  { type: 'li', text: 'AM: modulazione di ampiezza' }, { type: 'li', text: 'FM: modulazione di frequenza' }, { type: 'li', text: 'PSK: modulazione di fase' }
]);
const docB = input('Modulazione_Digitale.pptx', [
  { type: 'h', text: 'Le modulazioni', slide: 1 },
  { text: 'La QAM usa ampiezza e fase. Con la 16-QAM ogni simbolo trasporta quattro bit.', slide: 8 },
  { text: 'La PSK cambia solo la fase della portante. La QAM è più efficiente della PSK ma più sensibile al rumore. La PSK è robusta.', slide: 9 },
  { text: 'Nelle reti wireless la QAM si adatta al rumore del canale.', slide: 10 }
]);
const docC = input('Appunti_Telecomunicazioni.md', [
  { type: 'h', text: 'Appunti' },
  { text: 'Quadrature Amplitude Modulation: trasmette più bit per simbolo. Si definisce rumore termico il rumore prodotto dal moto degli elettroni.' },
  { text: 'Il rumore termico limita la velocità di ogni modulazione digitale. La trasformata di Fourier aiuta a misurare il rumore termico.' }
]);
// la sigla senza la forma estesa, e la forma estesa senza la sigla: non è sicuro, si chiede all'utente
const docD = input('Wireless.txt', [
  { type: 'h', text: 'Reti senza fili' },
  { text: 'L’OFDM divide il canale in tante sottoportanti. L’OFDM è usato dal Wi-Fi e dal 4G. Con l’OFDM ogni sottoportante può usare la QAM.' },
  { text: 'Ogni sottoportante dell’OFDM resiste meglio alle riflessioni. L’OFDM è il cuore delle reti wireless moderne.' }
]);
const docE = input('Divisione_in_frequenza.txt', [
  { type: 'h', text: 'Multiplazione' },
  { text: 'La Orthogonal Frequency Division Multiplexing divide la banda in sottoportanti ortogonali. Orthogonal Frequency Division Multiplexing è la base delle reti cellulari.' },
  { text: 'La Orthogonal Frequency Division Multiplexing riduce le interferenze tra simboli.' }
]);
const pdf = pdfInput('Dispensa.pdf', [
  ['Il subnetting divide una rete IP in sottoreti più piccole. Il subnetting usa la maschera di rete.', 'La maschera di rete indica quali bit dell’indirizzo identificano la rete.'],
  ['Il routing sceglie il percorso dei pacchetti tra le sottoreti. Senza subnetting il routing sarebbe meno efficiente.']
]);
const long = input('Guerra_fredda.txt', paras(fs.readFileSync(path.join(__dirname, 'fixtures/guerra-fredda.txt'), 'utf8')));
const en = input('Odyssey.txt', paras(fs.readFileSync(path.join(__dirname, 'fixtures/odyssey.txt'), 'utf8')));

(async () => {
  const recs = {};
  for (const [k, d] of Object.entries({ docA, docB, docC, docD, docE, pdf, long, en })) recs[k] = await WCLibrary.buildRecord(d, {});
  const all = Object.values(recs);

  await check('record: metadati, lingua, stato e dimensione ragionevole', () => {
    const r = recs.docA;
    assert.strictEqual(r.v, WCLibrary.VERSION);
    assert.strictEqual(r.id, docA.meta.id);
    assert.strictEqual(r.path, '/libreria/Reti_e_Segnali.docx');
    assert.strictEqual(r.lang, 'it');
    assert.strictEqual(recs.en.lang, 'en');
    assert.strictEqual(r.status, 'ok');
    assert.ok(r.words > 60);
    assert.ok(r.summary.length >= 1 && typeof r.summary[0].n === 'number');
    const json = JSON.stringify(recs.long);
    assert.ok(json.length < 200000, 'record troppo grande: ' + json.length);
    assert.deepStrictEqual(JSON.parse(json).chunks.length, recs.long.chunks.length);
  });

  await check('pezzi: titoli come sezioni, elenchi uniti, slide e pagine conservate', () => {
    const c = recs.docA.chunks;
    assert.deepStrictEqual(c.map((x) => x.kind), ['h', 'p', 'p', 'h', 'p', 'li']);
    assert.strictEqual(c[1].section, 'Modulazione digitale');
    assert.strictEqual(c[4].section, 'Trasformata di Fourier');
    assert.ok(/AM: modulazione di ampiezza.*PSK: modulazione di fase/.test(c[5].text), 'voci di elenco unite: ' + c[5].text);
    assert.deepStrictEqual(recs.docB.chunks.map((x) => x.slide), [1, 8, 9, 10]);
    const p = recs.pdf.chunks;
    assert.deepStrictEqual(p.map((x) => x.page), [0, 0, 1]);
    assert.ok(p[0].box && p[0].box.length === 4 && p[0].box.every((v) => v >= 0 && v <= 1), 'riquadro sulla pagina');
    assert.ok(recs.pdf.chunks[0].text.endsWith('.'));
  });

  await check('pezzi: un paragrafo lunghissimo si divide tra una frase e l’altra', async () => {
    const sent = 'La modulazione digitale trasforma i bit in simboli che viaggiano sul canale con un certo rumore. ';
    const r = await WCLibrary.buildRecord(input('Lungo.txt', [{ type: 'h', text: 'Lungo' }, { text: sent.repeat(30).trim() }]), {});
    const ps = r.chunks.filter((x) => x.kind === 'p');
    assert.ok(ps.length >= 2, 'diviso in ' + ps.length);
    ps.forEach((x) => { assert.ok(/^La modulazione/.test(x.text) && /rumore\.$/.test(x.text), 'pezzo tagliato a metà frase: ' + x.text.slice(-30)); });
  });

  await check('sigle: forma estesa riconosciuta prima e dopo la parentesi', () => {
    assert.deepStrictEqual(WCLibrary.findAcronyms('Usa la Quadrature Amplitude Modulation (QAM) nelle reti.', 'it'), [{ acr: 'QAM', long: 'Quadrature Amplitude Modulation' }]);
    assert.deepStrictEqual(WCLibrary.findAcronyms('Il Ministero della Salute (MS) ha deciso.', 'it'), [{ acr: 'MS', long: 'Ministero della Salute' }]);
    assert.deepStrictEqual(WCLibrary.findAcronyms('La NATO (North Atlantic Treaty Organization) nacque nel 1949.', 'it'), [{ acr: 'NATO', long: 'North Atlantic Treaty Organization' }]);
    assert.deepStrictEqual(WCLibrary.findAcronyms('Una frase (con parentesi) qualunque.', 'it'), []);
    assert.deepStrictEqual(recs.docA.aliases, [['QAM', 'Quadrature Amplitude Modulation']]);
  });

  const kb = WCLibrary.open(all, null);
  const G = kb.graph();
  const byLabel = (l) => G.nodes.find((n) => n.label === l);

  await check('concetti: la sigla e la forma estesa sono un concetto solo, in tre documenti', () => {
    const q = kb.concept('qam');
    assert.ok(q, 'concetto QAM');
    assert.ok(q.forms.includes('QAM') && q.forms.includes('Quadrature Amplitude Modulation'), q.forms.join(', '));
    const names = q.docs.map((d) => d.name).sort();
    // negli appunti la forma estesa c'è senza sigla: la ritrova lo stesso
    assert.deepStrictEqual(names.filter((n) => /Reti|Modulazione|Appunti/.test(n)), ['Appunti_Telecomunicazioni.md', 'Modulazione_Digitale.pptx', 'Reti_e_Segnali.docx']);
    assert.ok(q.multi && q.count >= 7, 'conteggio ' + q.count);
    assert.ok(q.defs.some((d) => /combina ampiezza e fase/.test(d.text) && d.name === 'Reti_e_Segnali.docx'), 'definizione con la fonte');
    assert.ok(!G.nodes.some((n) => n.label === 'Amplitude Modulation' || n.label === 'Quadrature'), 'nessun pezzo di concetto come nodo a sé');
  });

  await check('concetti: la stessa parola in documenti diversi (singolare e plurale) è un nodo solo', () => {
    const md = byLabel('modulazione digitale');
    assert.ok(md, 'modulazione digitale');
    assert.ok(md.ndocs >= 2);
    const rt = G.nodes.find((n) => /^rumore termico$/i.test(n.label));
    assert.ok(rt && rt.defs >= 1, 'termine definito');
    const ids = new Set(G.nodes.map((n) => n.id));
    assert.strictEqual(ids.size, G.nodes.length);
  });

  await check('grafo: “è un tipo di” letto nella definizione e collegamenti pesati', () => {
    const isa = G.edges.find((e) => e.type === 'isa' && e.a === 'qam');
    assert.ok(isa, 'QAM è un tipo di …');
    assert.strictEqual(G.nodes.find((n) => n.id === isa.b).label, 'modulazione digitale');
    const sub = G.nodes.find((n) => /^subnetting$/i.test(n.label));
    const rel = kb.concept(sub.id).related.map((r) => r.label.toLowerCase());
    assert.ok(rel.some((l) => /routing|maschera di rete|rete/.test(l)), 'subnetting collegato: ' + rel.join(', '));
    G.edges.forEach((e) => { assert.ok(e.w > 0 && e.w <= 1.0001, 'peso ' + e.w); assert.notStrictEqual(e.a, e.b); });
    assert.ok(G.nodes.some((n) => n.central), 'concetti centrali');
    G.nodes.forEach((n) => { assert.ok(isFinite(n.x) && isFinite(n.y), 'posizione sulla mappa'); });
  });

  await check('suggerimenti: sigla e forma estesa in documenti diversi -> si chiede prima di unire', () => {
    const s = G.suggestions.find((x) => [x.la, x.lb].includes('OFDM') && [x.la, x.lb].some((l) => /Orthogonal Frequency Division Multiplexing/.test(l)));
    assert.ok(s, 'suggerimento OFDM: ' + JSON.stringify(G.suggestions.slice(0, 5)));
    assert.ok(/sigla/.test(s.reason));
    assert.notStrictEqual(kb.concept('ofdm').id, kb.concept(s.a === 'ofdm' ? s.b : s.a).id, 'non ancora unite');
  });

  await check('ricerca: radici, più parole insieme in alto, frase esatta, filtri', () => {
    let r = kb.search('modulazioni digitali');
    assert.ok(r.total >= 3);
    assert.ok(/modulazione digitale/i.test(r.results[0].full));
    r = kb.search('"bit per simbolo"');
    assert.ok(r.total >= 2 && r.results.every((x) => /bit per simbolo/i.test(x.full)));
    assert.ok(r.results[0].marks.length >= 1);
    r = kb.search('rumore', { docs: [docB.meta.id] });
    assert.ok(r.total >= 1 && r.results.every((x) => x.name === 'Modulazione_Digitale.pptx'));
    assert.ok(r.results[0].where.includes('slide'), 'posizione: ' + r.results[0].where);
    r = kb.search('war', { langs: ['en'] });
    assert.ok(r.results.every((x) => x.lang === 'en'));
    assert.strictEqual(kb.search('').total, 0);
    assert.strictEqual(kb.search('parolachenonce').total, 0);
  });

  await check('ricerca: un concetto trova anche le sue altre forme, con la fonte esatta', () => {
    const r = kb.search('Dove ho parlato di QAM?');
    assert.ok(r.concepts.some((c) => c.label === 'QAM'), 'concetto riconosciuto nella domanda');
    const names = new Set(r.results.map((x) => x.name));
    assert.ok(names.has('Appunti_Telecomunicazioni.md'), 'trovati anche gli appunti con la sola forma estesa');
    const ap = r.results.find((x) => x.name === 'Appunti_Telecomunicazioni.md');
    assert.ok(ap.marks.length >= 1, 'forma estesa evidenziata');
    const pr = kb.search('subnetting maschera');
    assert.strictEqual(pr.results[0].name, 'Dispensa.pdf');
    assert.strictEqual(pr.results[0].page, 0);
    assert.ok(pr.results[0].box, 'riquadro per aprire alla posizione');
    assert.ok(pr.results[0].where.startsWith('p. 1'));
    const only = kb.search('QAM', { concept: 'qam' });
    assert.ok(only.results.length && only.results.every((x) => x.concepts.some((c) => c.label === 'QAM') || /QAM|Quadrature/.test(x.full)));
  });

  await check('ricerca: frammento con le parole evidenziate al posto giusto', () => {
    const r = kb.search('cortina di ferro');
    const hit = r.results[0];
    assert.ok(hit && hit.name === 'Guerra_fredda.txt');
    hit.marks.forEach((m) => assert.ok(/^(cortina|ferro)$/i.test(hit.text.slice(m[0], m[1])), 'evidenziato: ' + hit.text.slice(m[0], m[1])));
  });

  await check('modifiche: unisci, rifiuta, separa, rinomina, alias, collegamenti, posizioni', () => {
    const k2 = WCLibrary.open(all, null);
    const g0 = k2.graph();
    const s = g0.suggestions.find((x) => [x.la, x.lb].includes('OFDM'));
    // rifiuto: il suggerimento sparisce e non torna
    k2.applyEdit({ type: 'reject', a: s.a, b: s.b });
    assert.ok(!k2.graph().suggestions.some((x) => (x.a === s.a && x.b === s.b) || (x.a === s.b && x.b === s.a)));
    // unione confermata
    k2.applyEdit({ type: 'merge', a: s.a, b: s.b });
    const ofdm = k2.concept('ofdm');
    assert.ok(ofdm.forms.some((f) => /Orthogonal/.test(f)), 'unito: ' + ofdm.forms.join(', '));
    assert.ok(k2.search('OFDM').results.some((x) => x.name === 'Divisione_in_frequenza.txt'), 'la ricerca segue l’unione');
    // separa di nuovo
    const member = ofdm.members.find((m) => m !== 'ofdm');
    k2.applyEdit({ type: 'split', id: ofdm.id, member: member });
    assert.ok(!k2.concept('ofdm').forms.some((f) => /Orthogonal/.test(f)), 'separato');
    // rinomina e alias
    k2.applyEdit({ type: 'rename', id: 'qam', label: 'Modulazione QAM' });
    assert.strictEqual(k2.concept('qam').label, 'Modulazione QAM');
    k2.applyEdit({ type: 'alias', id: 'qam', text: 'modulazione in quadratura' });
    const q2 = k2.search('modulazione in quadratura');
    assert.ok(q2.concepts.some((c) => c.label === 'Modulazione QAM'), 'alias dell’utente usato dalla ricerca');
    k2.applyEdit({ type: 'unalias', id: 'qam', text: 'modulazione in quadratura' });
    assert.ok(!k2.concept('qam').forms.includes('modulazione in quadratura'));
    // collegamenti
    const four = g0.nodes.find((n) => /trasformata di Fourier/i.test(n.label));
    k2.applyEdit({ type: 'link', a: 'qam', b: four.id, label: 'si studia con' });
    assert.ok(k2.concept('qam').related.some((r) => r.id === four.id && r.rel === 'si studia con'));
    k2.applyEdit({ type: 'unlink', a: 'qam', b: four.id });
    assert.ok(!k2.concept('qam').related.some((r) => r.id === four.id));
    const anyRel = k2.concept('qam').related[0];
    k2.applyEdit({ type: 'unlink', a: 'qam', b: anyRel.id });
    assert.ok(!k2.concept('qam').related.some((r) => r.id === anyRel.id), 'collegamento automatico tolto');
    // posizioni e cronologia
    k2.applyEdit({ type: 'pos', list: [{ id: 'qam', x: 123.4, y: -56.7 }] });
    const ed = k2.edits();
    assert.deepStrictEqual(ed.pos.qam, [123.4, -56.7]);
    assert.ok(ed.log.length >= 8 && ed.log.every((l) => l.t && l.text));
    assert.ok(k2.concept('qam').log.some((l) => l.what === 'rename'));
    assert.throws(() => k2.applyEdit({ type: 'boh' }));
    assert.throws(() => k2.applyEdit({ type: 'merge', a: 'nonesiste', b: 'qam' }));
    // le modifiche si riapplicano su una base riaperta (anche con altri documenti)
    const k3 = WCLibrary.open(all.concat([recs.docA]), JSON.parse(JSON.stringify(ed)));
    assert.strictEqual(k3.concept('qam').label, 'Modulazione QAM');
    const n3 = k3.graph().nodes.find((n) => n.id === 'qam');
    assert.ok(n3.pinned && n3.x === 123.4 && n3.y === -56.7, 'il nodo resta dove l’ha messo l’utente');
    assert.ok(!k3.concept('ofdm').forms.some((f) => /Orthogonal/.test(f)), 'la separazione resta');
    assert.ok(!k3.graph().suggestions.some((x) => [x.a, x.b].includes('ofdm') && /Orthogonal/.test(x.la + x.lb)), 'il rifiuto resta');
  });

  await check('esportazioni: Markdown con alias, definizioni, fonti e collegamenti in stile Obsidian', () => {
    const md = kb.markdown();
    assert.ok(/^# Mappa dei concetti/.test(md));
    assert.ok(/## QAM[\s\S]*Alias: .*Quadrature Amplitude Modulation/.test(md));
    assert.ok(/> La Quadrature Amplitude Modulation \(QAM\) è una modulazione digitale[\s\S]*— \*Reti_e_Segnali\.docx\*/.test(md));
    assert.ok(/\[\[modulazione digitale\]\] \(è un tipo di\)/.test(md));
    const st = kb.stats();
    assert.strictEqual(st.docs, all.length);
    assert.ok(st.concepts > 20 && st.edges > 20);
    const docs = kb.docs();
    assert.ok(docs.every((d) => typeof d.chunks === 'number' && !('tokens' in d)));
  });

  await check('documenti in errore o vuoti non rompono la base', async () => {
    const empty = await WCLibrary.buildRecord(input('Vuoto.txt', [{ text: '' }]), {});
    assert.strictEqual(empty.status, 'empty');
    const err = { v: 1, id: 'd-ffffffffffffffff', path: '/x/rotto.pdf', name: 'rotto.pdf', status: 'error', error: 'PDF danneggiato', chunks: [], concepts: [], aliases: [] };
    const k = WCLibrary.open(all.concat([empty, err]), { merges: 'non valido', pos: [] });
    assert.ok(k.search('QAM').total > 0);
    assert.ok(k.docs().some((d) => d.status === 'error'));
  });

  await check('prestazioni: 3.000 passaggi, ricerca sotto i 500 ms', async () => {
    const words = 'segnale rumore canale banda simbolo bit modulazione filtro antenna potenza frequenza fase ampiezza codifica errore pacchetto rete protocollo indirizzo routing'.split(' ');
    const big = [];
    for (let d = 0; d < 10; d++) {
      const blocks = [{ type: 'h', text: 'Capitolo ' + d }];
      for (let p = 0; p < 300; p++) {
        const s = [];
        for (let k = 0; k < 40; k++) s.push(words[(d * 7 + p * 13 + k * k) % words.length]);
        blocks.push({ text: 'Il ' + s.join(' ') + '. La ' + words[p % words.length] + ' del capitolo ' + d + ' è importante.' });
      }
      big.push(await WCLibrary.buildRecord(input('Grande' + d + '.txt', blocks), {}));
    }
    let t0 = Date.now();
    const k = WCLibrary.open(big.concat(all), null);
    const tOpen = Date.now() - t0;
    t0 = Date.now();
    k.graph();
    const tGraph = Date.now() - t0;
    t0 = Date.now();
    const r = k.search('modulazione del segnale con rumore sul canale');
    const tSearch = Date.now() - t0;
    console.log('     indice ' + tOpen + ' ms, grafo ' + tGraph + ' ms, ricerca ' + tSearch + ' ms su ' + k.stats().chunks + ' passaggi');
    assert.ok(r.total > 100);
    assert.ok(tSearch < 500, 'ricerca lenta: ' + tSearch + ' ms');
    assert.ok(tGraph < 8000, 'grafo lento: ' + tGraph + ' ms');
  });

  await check('prestazioni: mappa di 5.000 concetti disposta in pochi secondi', () => {
    const N = 5000, nodes = new Map(), edges = [];
    for (let i = 0; i < N; i++) nodes.set('n' + i, { id: 'n' + i, members: ['n' + i] });
    for (let i = 0; i < N * 3; i++) { const a = (i * 7919) % N, b = (a + 1 + (i % 37)) % N; edges.push({ a: 'n' + a, b: 'n' + b, w: (i % 10) / 10 }); }
    const t0 = Date.now();
    const pos = WCLibrary.layout(nodes, edges, { n0: [10, 20] }, null);
    const ms = Date.now() - t0;
    console.log('     disposizione di ' + N + ' concetti: ' + ms + ' ms');
    assert.strictEqual(pos.size, N);
    assert.deepStrictEqual(Array.from(pos.get('n0')), [10, 20]);
    assert.ok(pos.get('n0').pinned);
    pos.forEach((p) => assert.ok(isFinite(p[0]) && isFinite(p[1])));
    assert.ok(ms < 6000, 'disposizione lenta: ' + ms + ' ms');
  });

  if (failures) { console.log('\n' + failures + ' test falliti'); process.exit(1); }
  console.log('\nTutti i test della libreria superati');
})();
