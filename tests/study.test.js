// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/* Test dello studio (core/study.js) in Node: domande, intervalli, percorso, padronanza, Anki. Uso: node tests/study.test.js */
'use strict';
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
['core/settings.js', 'core/lang.js', 'core/text.js', 'core/analysis.js', 'core/library.js', 'core/study.js']
  .forEach((f) => require(path.join(root, f)));
const { WCText, WCLibrary, WCStudy } = globalThis;

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + (e && e.stack || e));
    if (process.env.GITHUB_ACTIONS) console.log('::error title=' + name.replace(/[:,\n]/g, ' ') + '::' + String(e && e.message || e).slice(0, 900).replace(/\r?\n/g, '%0A'));
  }
}

let nDoc = 0;
function input(name, blocks) {
  const toks = WCText.tokenizeBlocks(blocks.map((b) => ({ text: b.text, w: b.type === 'h' ? 3 : 1 })));
  const id = 's-' + (++nDoc).toString(16).padStart(16, '0');
  return {
    meta: { id, path: '/libreria/' + name, name, ext: name.split('.').pop(), size: 1000 + nDoc, mtime: '2026-10-0' + (nDoc % 9 + 1) + 'T10:00:00.000Z', hash: 'h' + nDoc },
    format: 'Testo', title: blocks[0].text, tokens: toks.map((t) => [t.text, t.gap, t.blk, t.w, null]),
    tail: toks.length ? toks[toks.length - 1].tail : '', blocks: blocks.map((b) => ({ type: b.type || 'p', slide: b.slide }))
  };
}

const docA = input('Reti_e_Segnali.docx', [
  { type: 'h', text: 'Modulazione digitale' },
  { text: 'La Quadrature Amplitude Modulation (QAM) è una modulazione digitale che combina ampiezza e fase per trasmettere più bit per simbolo. La QAM si usa nelle reti wireless e nei modem via cavo.' },
  { text: 'La modulazione digitale trasforma una sequenza di bit in un segnale analogico. Ogni simbolo porta uno o più bit: più bit per simbolo significano più velocità, ma anche più errori in presenza di rumore.' },
  { type: 'h', text: 'Trasformata di Fourier' },
  { text: 'La trasformata di Fourier scompone un segnale nelle sue frequenze. Senza la trasformata di Fourier non si potrebbe progettare un filtro né capire la banda occupata da una modulazione digitale.' }
]);
const docB = input('Modulazione_Digitale.pptx', [
  { type: 'h', text: 'Le modulazioni', slide: 1 },
  { text: 'La QAM usa ampiezza e fase. Con la 16-QAM ogni simbolo trasporta quattro bit.', slide: 8 },
  { text: 'La PSK cambia solo la fase della portante. La QAM è più efficiente della PSK ma più sensibile al rumore. La PSK è robusta.', slide: 9 }
]);
const docC = input('Appunti_Telecomunicazioni.md', [
  { type: 'h', text: 'Appunti' },
  { text: 'Quadrature Amplitude Modulation: trasmette più bit per simbolo. Si definisce rumore termico il rumore prodotto dal moto degli elettroni.' },
  { text: 'Il rumore termico limita la velocità di ogni modulazione digitale. La trasformata di Fourier aiuta a misurare il rumore termico.' }
]);

(async () => {
  const recs = [];
  for (const d of [docA, docB, docC]) recs.push(await WCLibrary.buildRecord(d, {}));
  const kb = WCLibrary.open(recs, WCLibrary.emptyEdits());
  const G = kb.graph();
  const byLabel = (re) => G.nodes.find((n) => re.test(n.label));

  await check('i nodi del grafo portano radici e lingua, così lo studio li riconosce dopo le unioni', () => {
    const qam = byLabel(/QAM|Quadrature/i);
    assert.ok(qam, 'concetto QAM: ' + G.nodes.slice(0, 12).map((n) => n.label).join(' | '));
    assert.ok(Array.isArray(qam.members) && qam.members.length >= 1, 'radici: ' + JSON.stringify(qam.members));
    assert.strictEqual(qam.lang, 'it');
  });

  await check('oscurare il termine in una frase riconosce plurali e forme diverse', () => {
    const b = WCStudy.blank('La modulazione digitale trasforma i bit. Le modulazioni sono tante.', ['modulazione digitale', 'modulazione'], 'it');
    assert.ok(b && b.indexOf('_____') >= 0, 'buco: ' + b);
    assert.ok(!/modulazion/i.test(b), 'il termine non deve restare in chiaro: ' + b);
    assert.strictEqual(WCStudy.blank('Una frase senza il termine.', ['subnetting'], 'it'), null);
  });

  await check('la risposta scritta tollera accenti, maiuscole, plurali e un errore di battitura', () => {
    assert.ok(WCStudy.matches('qam', 'QAM', 'it'));
    assert.ok(WCStudy.matches('modulazioni digitali', 'modulazione digitale', 'it'));
    assert.ok(WCStudy.matches('trasformata di furier', 'trasformata di Fourier', 'it'), 'un errore di battitura');
    assert.ok(!WCStudy.matches('rumore termico', 'trasformata di Fourier', 'it'));
    assert.ok(!WCStudy.matches('', 'QAM', 'it'));
  });

  await check('gli intervalli crescono e una dimenticanza riporta a un giorno', () => {
    const now = Date.UTC(2026, 9, 27);
    let c = WCStudy.schedule({ ease: 2.5, interval: 0, reps: 0, lapses: 0 }, 2, now);
    assert.strictEqual(c.interval, 2);
    assert.strictEqual(c.reps, 1);
    assert.strictEqual(c.due, new Date(now + 2 * 86400000).toISOString());
    c = WCStudy.schedule(c, 2, now);
    assert.strictEqual(c.interval, 6);
    const grown = WCStudy.schedule(c, 2, now);
    assert.ok(grown.interval >= 14, 'terzo ripasso: ' + grown.interval);
    const easy = WCStudy.schedule(c, 3, now);
    assert.ok(easy.interval > grown.interval && easy.ease > c.ease, 'facile allunga: ' + easy.interval);
    const again = WCStudy.schedule(grown, 0, now);
    assert.strictEqual(again.interval, 1);
    assert.strictEqual(again.reps, 0);
    assert.strictEqual(again.lapses, 1);
    assert.ok(again.ease < grown.ease, 'la facilità scende');
    assert.ok(WCStudy.masteryOf(again) < WCStudy.masteryOf(grown), 'la padronanza scende dopo una dimenticanza');
    // dimenticato non è «mai visto»: sulla mappa devono restare due colori diversi
    assert.ok(WCStudy.masteryOf(again) > 0, 'un concetto dimenticato non torna a zero: ' + WCStudy.masteryOf(again));
    assert.strictEqual(WCStudy.masteryOf(null), 0);
    assert.strictEqual(WCStudy.masteryOf({ ease: 2.5, interval: 0, reps: 0, lapses: 0 }), 0);
    let mature = { ease: 2.5, interval: WCStudy.MATURE, reps: 4, lapses: 0 };
    assert.ok(WCStudy.masteryOf(mature) >= 0.95, 'padronanza di un concetto saldo: ' + WCStudy.masteryOf(mature));
  });

  await check('le domande vengono dalle definizioni e citano la fonte esatta', () => {
    const study = WCStudy.open(WCStudy.emptyState(), kb);
    const s = study.session({ limit: 30 });
    assert.ok(s.cards.length >= 5, 'carte: ' + s.cards.length);
    s.cards.forEach((c) => {
      assert.ok(['def', 'cloze', 'isa', 'use'].indexOf(c.kind) >= 0, 'tipo: ' + c.kind);
      assert.ok(c.front && c.back, 'domanda e risposta: ' + JSON.stringify(c).slice(0, 200));
      assert.ok(c.id && c.label, 'concetto collegato');
      if (c.source) assert.ok(c.source.name && c.source.n != null, 'fonte: ' + JSON.stringify(c.source));
    });
    const qam = s.cards.find((c) => /QAM|Quadrature/i.test(c.label));
    assert.ok(qam, 'una carta su QAM: ' + s.cards.map((c) => c.label).join(' | '));
    assert.ok(/modulazione digitale/i.test(qam.back) || /modulazione digitale/i.test(qam.front), 'la definizione vera: ' + qam.back);
    const cloze = s.cards.find((c) => c.kind === 'cloze');
    if (cloze) {
      assert.ok(cloze.front.indexOf('_____') >= 0, 'il buco nella frase');
      assert.ok(cloze.answer, 'la risposta attesa');
    }
  });

  await check('la stessa carta non si ripete: a ogni ripasso il concetto chiede altro', () => {
    const study = WCStudy.open(WCStudy.emptyState(), kb);
    const qam = byLabel(/QAM|Quadrature/i);
    const seen = new Set();
    for (let i = 0; i < 3; i++) {
      const s = study.session({ limit: 40, ids: [qam.id], anyway: true });
      const c = s.cards.find((x) => x.id === qam.id);
      if (!c) break;
      seen.add(c.kind + '|' + c.front.slice(0, 40));
      study.grade({ id: qam.id, grade: 2 });
    }
    assert.ok(seen.size >= 2, 'domande diverse: ' + Array.from(seen).join(' // '));
  });

  await check('il voto aggiorna la padronanza e la data del prossimo ripasso', () => {
    const study = WCStudy.open(WCStudy.emptyState(), kb);
    const qam = byLabel(/QAM|Quadrature/i);
    assert.strictEqual(study.stats().newCount, study.stats().total, 'all’inizio nessun concetto è stato visto');
    const r = study.grade({ id: qam.id, grade: 2 });
    assert.strictEqual(r.state, 'learning');
    assert.ok(r.card.due && Date.parse(r.card.due) > Date.now(), 'prossimo ripasso nel futuro');
    assert.ok(r.mastery > 0, 'padronanza: ' + r.mastery);
    const st = study.stats();
    assert.strictEqual(st.studied, 1);
    assert.strictEqual(st.newCount, st.total - 1);
    assert.ok(st.mastery > 0 && st.mastery < 1);
    const m = study.mastery();
    assert.ok(m[qam.id] && m[qam.id][0] > 0, 'padronanza per la mappa: ' + JSON.stringify(m[qam.id]));
    assert.strictEqual(m[qam.id][1], 0, 'non è ancora da ripassare');
    assert.throws(() => study.grade({ id: 'niente', grade: 2 }), /non trovato/);
  });

  await check('la risposta scritta decide il voto da sola', () => {
    const study = WCStudy.open(WCStudy.emptyState(), kb);
    const qam = byLabel(/QAM|Quadrature/i);
    const ok = study.grade({ id: qam.id, typed: qam.label, answer: qam.label, lang: 'it' });
    assert.strictEqual(ok.correct, true);
    assert.strictEqual(ok.grade, 2);
    const no = study.grade({ id: qam.id, typed: 'rumore termico', answer: qam.label, lang: 'it' });
    assert.strictEqual(no.correct, false);
    assert.strictEqual(no.grade, 0);
    assert.strictEqual(no.card.interval, 1);
  });

  await check('il percorso va dai concetti generali a quelli specifici', () => {
    const study = WCStudy.open(WCStudy.emptyState(), kb);
    const p = study.path({ limit: 100 });
    assert.ok(p.items.length >= 5, 'tappe: ' + p.items.length);
    assert.ok(p.items.every((x, i) => i === 0 || x.level >= p.items[i - 1].level), 'livelli non decrescenti: ' + p.items.map((x) => x.level).join(','));
    const qam = p.items.find((x) => /QAM|Quadrature/i.test(x.label));
    const mod = p.items.find((x) => /^modulazione digitale$/i.test(x.label));
    if (qam && mod && qam.level > 0) {
      assert.ok(mod.level < qam.level, 'prima la modulazione digitale, poi la QAM: ' + mod.level + ' < ' + qam.level);
      assert.ok(qam.parent, 'la QAM sa da chi dipende');
    }
    p.items.forEach((x) => { assert.ok(x.state === 'new', 'all’inizio tutto da vedere'); assert.strictEqual(x.mastery, 0); });
  });

  await check('il percorso e la sessione si possono limitare a un documento', () => {
    const study = WCStudy.open(WCStudy.emptyState(), kb);
    const doc = kb.docs().find((d) => d.name === 'Appunti_Telecomunicazioni.md');
    const p = study.path({ doc: doc.id, limit: 100 });
    assert.ok(p.items.length, 'tappe del documento');
    const ids = new Set(G.nodes.filter((n) => n.docs.indexOf(doc.id) >= 0).map((n) => n.id));
    assert.ok(p.items.every((x) => ids.has(x.id)), 'solo concetti di quel documento');
    const s = study.session({ doc: doc.id, limit: 10 });
    assert.ok(s.cards.length && s.cards.every((c) => ids.has(c.id)), 'carte di quel documento');
    assert.ok(s.stats.total < study.stats().total, 'le statistiche seguono il filtro');
  });

  await check('i progressi sopravvivono all’unione di due concetti', () => {
    const edits = WCLibrary.emptyEdits();
    const kb2 = WCLibrary.open(recs, edits);
    const study = WCStudy.open(WCStudy.emptyState(), kb2);
    const nodes = kb2.graph().nodes;
    const a = nodes.find((n) => /^PSK$/i.test(n.label)) || nodes[1];
    const b = nodes.find((n) => n.id !== a.id && n.label !== a.label);
    study.grade({ id: a.id, grade: 3 });
    const before = study.stats().studied;
    kb2.applyEdit({ type: 'merge', a: a.id, b: b.id });
    study.invalidate();
    const after = study.stats();
    assert.strictEqual(after.studied, before, 'il concetto unito resta studiato');
    const merged = kb2.graph().nodes.find((n) => n.members.indexOf(a.id) >= 0);
    assert.ok(merged, 'il concetto unito esiste');
    assert.ok(study.mastery()[merged.id] > 0 || study.mastery()[merged.id][0] > 0, 'la padronanza segue il concetto');
  });

  await check('azzerare un concetto o tutto lo studio', () => {
    const study = WCStudy.open(WCStudy.emptyState(), kb);
    const qam = byLabel(/QAM|Quadrature/i);
    const other = G.nodes.find((n) => n.id !== qam.id);
    study.grade({ id: qam.id, grade: 2 });
    study.grade({ id: other.id, grade: 2 });
    assert.strictEqual(study.stats().studied, 2);
    study.reset({ id: qam.id });
    assert.strictEqual(study.stats().studied, 1);
    study.reset();
    assert.strictEqual(study.stats().studied, 0);
    assert.strictEqual(study.state().log.length, 0);
  });

  await check('esportazione per Anki: tre colonne, niente tabulazioni nel testo', () => {
    const study = WCStudy.open(WCStudy.emptyState(), kb);
    const out = study.anki({ limit: 50 });
    assert.ok(out.count >= 5, 'carte esportate: ' + out.count);
    const lines = out.text.trim().split('\n');
    assert.ok(lines[0].startsWith('#separator:tab'), 'direttive per Anki: ' + lines[0]);
    const rows = lines.filter((l) => l[0] !== '#');
    assert.strictEqual(rows.length, out.count);
    rows.forEach((r) => {
      const cols = r.split('\t');
      assert.strictEqual(cols.length, 3, 'tre colonne: ' + r.slice(0, 120));
      assert.ok(cols[0].trim() && cols[1].trim(), 'domanda e risposta piene');
      assert.ok(/word-crawler/.test(cols[2]), 'etichette: ' + cols[2]);
      assert.ok(r.indexOf('\n') < 0, 'niente capo a riga dentro una carta');
    });
    assert.ok(/<i>\(/.test(out.text), 'la fonte è dentro la risposta');
    const studied = WCStudy.open(WCStudy.emptyState(), kb);
    assert.strictEqual(studied.anki({ onlyStudied: true }).count, 0, 'senza ripassi non esporta niente');
  });

  await check('una libreria vuota non rompe lo studio', () => {
    const kb0 = WCLibrary.open([], WCLibrary.emptyEdits());
    const study = WCStudy.open(WCStudy.emptyState(), kb0);
    assert.deepStrictEqual(study.session({ limit: 10 }).cards, []);
    assert.strictEqual(study.path().items.length, 0);
    assert.strictEqual(study.stats().total, 0);
    assert.strictEqual(study.stats().mastery, 0);
    assert.strictEqual(study.anki().count, 0);
    assert.deepStrictEqual(study.mastery(), {});
  });

  await check('lo stato salvato si rilegge e riprende da dov’era', () => {
    const study = WCStudy.open(WCStudy.emptyState(), kb);
    const qam = byLabel(/QAM|Quadrature/i);
    study.grade({ id: qam.id, grade: 3 });
    const saved = JSON.parse(JSON.stringify(study.state()));
    const again = WCStudy.open(saved, kb);
    const st = again.stats();
    assert.strictEqual(st.studied, 1);
    assert.ok(again.mastery()[qam.id][0] > 0, 'la padronanza è tornata');
    assert.strictEqual(again.state().log.length, 1);
  });

  console.log(failures ? '\n' + failures + ' prove fallite' : '\ntutte le prove dello studio sono passate');
  process.exit(failures ? 1 : 0);
})();
