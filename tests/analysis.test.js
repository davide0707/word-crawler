/* Test dell'analisi del testo (Node, senza browser). Uso: node tests/analysis.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
['core/settings.js', 'core/text.js', 'core/analysis.js'].forEach((f) => require(path.join(root, f)));
const { WCText, WCAnalysis, WCSettings } = globalThis;

function tokensFromPlain(text) {
  const blocks = text.split(/\n\s*\n/).map((para, i) => {
    const heading = i === 0 && para.length < 80 && !/[.!?]$/.test(para.trim());
    return { text: para.trim(), w: heading ? 3 : 1 };
  });
  return WCText.tokenizeBlocks(blocks);
}

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

const it = fs.readFileSync(path.join(__dirname, 'fixtures/guerra-fredda.txt'), 'utf8');

check('divisione in frasi (abbreviazioni, numeri, date)', () => {
  const toks = WCText.prepare(WCText.tokenizeString('Il dott. Rossi arrivò il 5 marzo. Pagò 3.5 euro, cioè poco. Poi partì! Fine.'));
  const s = WCText.sentences(toks);
  assert.deepStrictEqual(s.map((x) => x.text), ['Il dott. Rossi arrivò il 5 marzo.', 'Pagò 3.5 euro, cioè poco.', 'Poi partì!', 'Fine.']);
});

check('lingua riconosciuta', () => {
  assert.strictEqual(WCText.detectLang(WCText.prepare(tokensFromPlain(it))), 'it');
  assert.strictEqual(WCText.detectLang(WCText.prepare(WCText.tokenizeString('The war was over and the soldiers went home to their families.'))), 'en');
});

const modes = {};
['study', 'summary', 'web'].forEach((mode) => {
  check('analisi in modalità ' + mode, () => {
    const opts = Object.assign(WCSettings.defaults(), { mode });
    const { results } = WCAnalysis.analyze(tokensFromPlain(it), opts);
    modes[mode] = results;
    assert.ok(results.keywords.length >= 4, 'poche parole chiave');
    assert.ok(results.summary.length >= 1, 'sunto vuoto');
  });
});

check('le parole chiave contengono i concetti principali', () => {
  const words = modes.study.keywords.map((k) => k.word.toLowerCase());
  ['guerra fredda', 'unione sovietica', 'berlino', 'nato'].forEach((w) => assert.ok(words.some((x) => x.indexOf(w) === 0), 'manca ' + w + ' in ' + words.join(', ')));
});

check('Studio trova le definizioni', () => {
  const defs = modes.study.highlights.filter((h) => h.type === 'def').map((h) => h.text);
  assert.ok(defs.some((d) => /^La NATO è un'alleanza/.test(d)), 'manca la definizione della NATO: ' + JSON.stringify(defs));
  assert.ok(defs.some((d) => /^Si definisce cortina di ferro/.test(d)), 'manca la cortina di ferro');
  assert.ok(defs.some((d) => /^La deterrenza nucleare è/.test(d)), 'manca la deterrenza');
});

check('Studio riquadra date e numeri', () => {
  const nums = modes.study.highlights.filter((h) => h.type === 'num').map((h) => h.text);
  ['1945', '1946', '1989', '1991', '270.000'].forEach((n) => assert.ok(nums.includes(n), 'manca ' + n));
});

check('la lunghezza del sunto segue il parametro', () => {
  const short = WCAnalysis.analyze(tokensFromPlain(it), Object.assign(WCSettings.defaults(), { mode: 'summary', summaryLength: 10 })).results.summary.length;
  const long = WCAnalysis.analyze(tokensFromPlain(it), Object.assign(WCSettings.defaults(), { mode: 'summary', summaryLength: 50 })).results.summary.length;
  assert.ok(long > short * 3, short + ' vs ' + long);
});

check('la selettività cambia il numero di parole chiave', () => {
  const n = (s) => WCAnalysis.analyze(tokensFromPlain(it), Object.assign(WCSettings.defaults(), { selectivity: s })).results.keywords.length;
  assert.ok(n(1) > n(3) && n(3) > n(5), [n(1), n(3), n(5)].join(' > '));
});

check('le zampe cambiano il contesto (classifica diversa)', () => {
  const r = (l) => WCAnalysis.analyze(tokensFromPlain(it), Object.assign(WCSettings.defaults(), { legs: l })).results.keywords.map((k) => k.score).join(',');
  assert.notStrictEqual(r(2), r(16));
});

check('Cerca trova parole, varianti e frasi', () => {
  const { results } = WCAnalysis.analyze(tokensFromPlain(it), Object.assign(WCSettings.defaults(), { mode: 'search', searchTerms: 'Berlino, guerra fredda, nucle*' }));
  const c = Object.fromEntries(results.search.terms.map((t) => [t.term, t.count]));
  assert.strictEqual(c['Berlino'], 3);
  assert.strictEqual(c['guerra fredda'], 5);
  assert.strictEqual(c['nucle*'], 4);
});

check('statistiche e leggibilità', () => {
  const s = modes.summary.stats;
  assert.ok(s.words > 450 && s.sentences > 25, JSON.stringify(s));
  assert.strictEqual(s.readabilityScale, 'Gulpease');
  assert.ok(s.readability > 30 && s.readability < 70, 'Gulpease ' + s.readability);
});

check('impostazioni: valori fuori scala vengono corretti', () => {
  const v = WCSettings.sanitize({ speed: 9999, legs: 'x', mode: 'boh', variety: 3.4, veil: 0 });
  assert.strictEqual(v.speed, 400); assert.strictEqual(v.legs, 8); assert.strictEqual(v.mode, 'study');
  assert.strictEqual(v.variety, 3); assert.strictEqual(v.veil, false);
});

check('prestazioni: circa 80.000 parole in meno di 5 secondi', () => {
  const big = Array(25).fill(it).join('\n\n');
  const t0 = Date.now();
  const { results } = WCAnalysis.analyze(tokensFromPlain(big), Object.assign(WCSettings.defaults(), { mode: 'summary' }));
  const ms = Date.now() - t0;
  assert.ok(results.stats.words > 10000);
  console.log('     ' + results.stats.words + ' parole in ' + ms + ' ms');
  const huge = Array(160).fill(it).join('\n\n');
  const t1 = Date.now();
  const r2 = WCAnalysis.analyze(tokensFromPlain(huge), Object.assign(WCSettings.defaults(), { mode: 'study' }));
  const ms2 = Date.now() - t1;
  console.log('     ' + r2.results.stats.words + ' parole in ' + ms2 + ' ms');
  assert.ok(ms2 < 5000);
});

check('testo inglese: parole chiave e sunto', () => {
  const en = fs.readFileSync(path.join(__dirname, 'fixtures/odyssey.txt'), 'utf8');
  const { results } = WCAnalysis.analyze(tokensFromPlain(en), Object.assign(WCSettings.defaults(), { mode: 'summary' }));
  modes.en = results;
  assert.strictEqual(results.lang, 'en');
  const words = results.keywords.map((k) => k.word);
  ['Odysseus', 'Calypso', 'Poseidon', 'Zeus', 'Ithaca'].forEach((w) => assert.ok(words.includes(w), 'manca ' + w + ' in ' + words.join(', ')));
  assert.strictEqual(results.stats.readabilityScale, 'Flesch');
  assert.ok(results.summary.every((s) => /[.!?]$/.test(s.text)), 'frasi senza punto finale');
});

if (process.argv.includes('--show')) {
  console.log('\nINGLESE:', modes.en.keywords.map((k) => k.word).join(', '));
  modes.en.summary.forEach((s) => console.log(' - ' + s.text));
  console.log('\nPAROLE CHIAVE:', modes.study.keywords.map((k) => k.word).join(', '));
  console.log('SCARTATE:', modes.web.discarded.join(', '));
  console.log('\nSUNTO:'); modes.summary.summary.forEach((s) => console.log(' - ' + s.text));
  console.log('\nDEFINIZIONI:'); modes.study.highlights.filter((h) => h.type === 'def').forEach((h) => console.log(' - ' + h.text));
  console.log('\nNOMI:', modes.study.highlights.filter((h) => h.type === 'name').map((h) => h.text).join(', '));
  console.log('STATISTICHE:', JSON.stringify(modes.summary.stats));
}
console.log(failures ? '\n' + failures + ' test falliti' : '\nTutti i test superati');
process.exit(failures ? 1 : 0);
