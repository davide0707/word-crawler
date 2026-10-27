/* Test dell'analisi del testo (Node, senza browser). Uso: node tests/analysis.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
['core/settings.js', 'core/lang.js', 'core/text.js', 'core/analysis.js'].forEach((f) => require(path.join(root, f)));
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

// ------------------------------------------------------------ lingue (versione 2.1)
const { WCLang } = globalThis;
const LANGTXT = {};
['fr', 'es', 'de', 'pt'].forEach((l) => { LANGTXT[l] = fs.readFileSync(path.join(__dirname, 'fixtures/lang', l + '.txt'), 'utf8'); });
LANGTXT.it = it;

check('sei lingue riconosciute', () => {
  Object.keys(LANGTXT).forEach((l) => assert.strictEqual(WCLang.detect(tokensFromPlain(LANGTXT[l])), l, 'testo ' + l));
  assert.strictEqual(WCLang.detect('The war was over and the soldiers went home to their families.'), 'en');
  assert.strictEqual(WCLang.detect('Os soldados voltaram para casa depois da guerra, mas a cidade não era mais a mesma.'), 'pt');
  assert.strictEqual(WCLang.detect('Los soldados volvieron a casa después de la guerra, pero la ciudad ya no era la misma.'), 'es');
});

check('frequenze delle parole: si caricano e le parole comuni pesano meno', () => {
  ['it', 'en', 'fr', 'es', 'de', 'pt'].forEach((l) => { WCLang.ensure(l); assert.ok(WCLang.hasFreq(l), 'frequenze ' + l); });
  assert.ok(WCLang.rarity('it', 'casa') < WCLang.rarity('it', 'deterrenza'));
  assert.ok(WCLang.rarity('en', 'house') < WCLang.rarity('en', 'deterrence'));
  assert.ok(WCLang.rarity('de', 'haus') < WCLang.rarity('de', 'abschreckung'));
  const { results } = WCAnalysis.analyze(tokensFromPlain(it), WCSettings.defaults());
  assert.strictEqual(results.frequencies, true);
  const words = results.keywords.map((k) => k.word.toLowerCase());
  ['guerra fredda', 'unione sovietica', 'berlino', 'nato'].forEach((w) => assert.ok(words.some((x) => x.indexOf(w) === 0), 'manca ' + w));
});

const L21 = {};
check('definizioni in francese, spagnolo, tedesco e portoghese', () => {
  const want = {
    fr: [/^On appelle rideau de fer/, /^L'OTAN est une alliance/, /^La dissuasion nucléaire est/],
    es: [/^Se denomina telón de acero/, /^La OTAN es una alianza/, /^La disuasión nuclear es/],
    de: [/^Als Eiserner Vorhang bezeichnet man/, /^Die NATO ist ein/, /^Unter nuklearer Abschreckung versteht man/],
    pt: [/^Chama-se cortina de ferro/, /^A OTAN é uma aliança/, /^A dissuasão nuclear é/]
  };
  Object.keys(want).forEach((l) => {
    const r = WCAnalysis.analyze(tokensFromPlain(LANGTXT[l]), WCSettings.defaults()).results;
    L21[l] = r;
    assert.strictEqual(r.lang, l);
    const defs = r.highlights.filter((h) => h.type === 'def').map((h) => h.text);
    want[l].forEach((re) => assert.ok(defs.some((d) => re.test(d)), l + ': manca ' + re + ' in ' + JSON.stringify(defs)));
  });
});

check('tedesco: i nomi comuni (con la maiuscola) non diventano nomi propri', () => {
  const r = L21.de;
  const names = r.highlights.filter((h) => h.type === 'name').map((h) => h.text);
  ['Krieg', 'Wettrüsten', 'Blöcke', 'Luftbrücke', 'Kubakrise', 'Supermächten'].forEach((w) => assert.ok(!names.includes(w), w + ' segnato come nome'));
  assert.ok(names.includes('NATO'));
  assert.ok(r.keywords.some((k) => k.word === 'Kalte Krieg'), 'manca "Kalte Krieg": ' + r.keywords.map((k) => k.word).join(', '));
  const toks = WCText.prepare(WCText.tokenizeString('Die Mauer fiel am 9. November 1989. Danach kam die Einheit.'), 'de');
  assert.deepStrictEqual(WCText.sentences(toks, 'de').map((x) => x.text), ['Die Mauer fiel am 9. November 1989.', 'Danach kam die Einheit.']);
});

check('leggibilità con la formula di ogni lingua', () => {
  const scales = { fr: 'Kandel-Moles', es: 'Szigriszt-Pazos', de: 'Amstad', pt: 'Flesch (Martins)' };
  Object.keys(scales).forEach((l) => {
    const st = L21[l].stats;
    assert.strictEqual(st.readabilityScale, scales[l]);
    assert.ok(st.readability > 20 && st.readability < 95, l + ' ' + st.readability);
  });
});

check('sunto più scorrevole: niente connettivi iniziali né frasi che rimandano indietro', () => {
  assert.strictEqual(WCLang.smooth('it', 'Inoltre, la Germania fu divisa in due stati.'), 'La Germania fu divisa in due stati.');
  assert.strictEqual(WCLang.smooth('en', 'However the war ended in 1945 with a treaty.'), 'The war ended in 1945 with a treaty.');
  assert.strictEqual(WCLang.smooth('es', 'Sin embargo, la crisis de los misiles llevó al mundo al borde.'), 'La crisis de los misiles llevó al mundo al borde.');
  assert.strictEqual(WCLang.smooth('de', 'Außerdem war die Stadt geteilt.'), 'Außerdem war die Stadt geteilt.', 'in tedesco "Außerdem" sposta il verbo');
  const txt = 'Il Trattato di Roma\n\nIl Trattato di Roma fondò la Comunità economica europea nel 1957 tra sei paesi fondatori. ' +
    'Tuttavia, il Trattato di Roma non creò subito un mercato comune completo tra i paesi fondatori. Questo richiese molti anni di negoziati tra i governi.';
  const r = WCAnalysis.analyze(tokensFromPlain(txt), Object.assign(WCSettings.defaults(), { mode: 'summary', summaryLength: 60 })).results;
  assert.ok(r.summary.every((s) => !/^(Tuttavia|Inoltre)\b/.test(s.text)), JSON.stringify(r.summary.map((s) => s.text)));
  assert.ok(WCLang.isAnaphoric('it', { text: 'Questo' }) && !WCLang.isAnaphoric('it', { text: 'Il' }));
});

check('ripasso: schede delle definizioni, frasi da completare e quiz', () => {
  const r = WCAnalysis.analyze(tokensFromPlain(it), WCSettings.defaults()).results;
  const defs = r.cards.filter((c) => c.type === 'def');
  const fronts = defs.map((c) => c.front);
  ['Che cos’è «cortina di ferro»?', 'Che cos’è «NATO»?', 'Che cos’è «deterrenza nucleare»?'].forEach((f) => assert.ok(fronts.includes(f), 'manca ' + f + ' in ' + JSON.stringify(fronts)));
  const cloze = r.cards.filter((c) => c.type === 'cloze');
  assert.ok(cloze.length >= 2, 'poche frasi da completare');
  r.cards.forEach((c) => {
    assert.ok(c.cloze.includes(WCAnalysis.BLANK), 'scheda senza buco: ' + c.cloze);
    assert.ok(!c.cloze.includes(c.answer + ' ') || c.cloze.split(c.answer).length <= 2);
    if (c.choices) {
      assert.strictEqual(c.choices.length, 4);
      assert.strictEqual(new Set(c.choices).size, 4, 'risposte doppie: ' + c.choices);
      assert.strictEqual(c.choices[c.correct], c.answer);
    }
  });
  assert.ok(r.cards.filter((c) => c.choices).length >= 4, 'poche domande da quiz');
  // "l'Unione Sovietica": l'articolo resta fuori dal buco
  assert.ok(r.cards.every((c) => !/^l'/.test(c.answer)), 'articolo nella risposta');
  // stesso documento = stesso quiz
  const again = WCAnalysis.analyze(tokensFromPlain(it), WCSettings.defaults()).results;
  assert.deepStrictEqual(again.cards.map((c) => c.choices), r.cards.map((c) => c.choices));
  ['fr', 'es', 'de', 'pt'].forEach((l) => assert.ok(L21[l].cards.length >= 3, l + ': poche schede'));
  assert.ok(L21.de.cards.some((c) => c.front === 'Was ist „Eiserner Vorhang“?'));
  assert.ok(L21.fr.cards.some((c) => c.front === 'Qu’est-ce que « rideau de fer » ?'));
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
