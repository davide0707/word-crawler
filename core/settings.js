// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: modalità, parametri e preset.
 * Ogni parametro dichiara cosa cambia davvero ("effect"), così l'interfaccia lo può spiegare.
 */
(function (g) {
  'use strict';
  if (g.WCSettings) return;

  var MODES = {
    study: {
      label: 'Studio',
      short: 'Sottolinea e cerchia per studiare',
      desc: 'Sottolinea le frasi chiave, sottolinea in verde le definizioni, cerchia nomi e concetti, riquadra numeri e date.'
    },
    summary: {
      label: 'Riassunto',
      short: 'Scrive il sunto di ciò che ha letto',
      desc: 'Legge tutto, sottolinea le frasi più importanti e alla fine le mette in ordine come sunto.'
    },
    web: {
      label: 'Ragnatela',
      short: 'L’effetto del video',
      desc: 'Parole chiave evidenziate, zampe e ragnatela come nel video. Ideale da registrare.'
    },
    search: {
      label: 'Cerca',
      short: 'Trova le parole che scrivi tu',
      desc: 'Cerca le parole indicate, le riquadra e raccoglie ogni frase in cui compaiono.'
    }
  };

  // type: range | select | toggle | text
  var PARAMS = [
    { id: 'mode', group: 'Modalità', type: 'select', def: 'study', options: Object.keys(MODES).map(function (k) { return [k, MODES[k].label]; }),
      label: 'Modalità', effect: 'Decide cosa fa il ragno mentre legge.' },
    { id: 'searchTerms', group: 'Modalità', type: 'text', def: '', modes: ['search'], label: 'Parole da cercare',
      placeholder: 'es. Berlino, guerra fredda, NATO*',
      effect: 'Separate da virgola. Più parole tra virgole = frase esatta. Con * alla fine trova anche le varianti (NATO* trova NATO e NATO-Russia).' },

    { id: 'speed', group: 'Lettura', type: 'range', min: 1, max: 400, step: 1, def: 14, unit: 'parole/s', label: 'Velocità',
      effect: 'Solo il ritmo dell’animazione: i risultati non cambiano. Per averli subito usa “Completa ora”.' },
    { id: 'legs', group: 'Lettura', type: 'range', min: 2, max: 16, step: 1, def: 8, unit: 'zampe', label: 'Zampe',
      effect: 'Ampiezza del contesto: quante parole vicine il ragno collega tra loro per capire di cosa parla il testo. Più zampe colgono meglio gli argomenti nei testi lunghi; poche zampe badano ai dettagli vicini. Sono anche le zampe disegnate.' },
    { id: 'follow', group: 'Lettura', type: 'toggle', def: true, label: 'Segui la lettura',
      effect: 'Fa scorrere la pagina insieme al ragno. Se scorri tu, il ragno aspetta 3 secondi.' },

    { id: 'selectivity', group: 'Analisi', type: 'range', min: 1, max: 5, step: 1, def: 3, label: 'Selettività',
      scale: ['Larga', 'Ampia', 'Media', 'Stretta', 'Severa'],
      effect: 'Quante parole chiave tenere. Stretta: solo le più forti, meno rumore ma qualche concetto perso. Larga: più parole, più completo ma più rumore.' },
    { id: 'language', group: 'Analisi', type: 'select', def: 'auto',
      options: [['auto', 'Automatica'], ['it', 'Italiano'], ['en', 'Inglese'], ['fr', 'Francese'], ['es', 'Spagnolo'], ['de', 'Tedesco'], ['pt', 'Portoghese']],
      label: 'Lingua', effect: 'Serve per le parole da ignorare (articoli, preposizioni…), le abbreviazioni, le definizioni, l’indice di leggibilità e la frequenza delle parole: quelle d’uso comune pesano meno di quelle rare.' },

    { id: 'summaryLength', group: 'Riassunto', type: 'range', min: 5, max: 60, step: 5, def: 20, unit: '%', label: 'Lunghezza',
      modes: ['summary', 'study'],
      effect: 'Quota di frasi tenute nel sunto (e sottolineate in Studio). Più alta = più completo ma meno sintetico.' },
    { id: 'variety', group: 'Riassunto', type: 'range', min: 0, max: 10, step: 1, def: 5, label: 'Varietà',
      modes: ['summary', 'study'],
      effect: 'Quanto evitare frasi che dicono la stessa cosa. Alta: il sunto copre più argomenti. Bassa: prende le frasi più centrali anche se si somigliano.' },
    { id: 'lead', group: 'Riassunto', type: 'range', min: 0, max: 10, step: 1, def: 3, label: 'Peso dell’inizio',
      modes: ['summary', 'study'],
      effect: 'Quanto contano le prime frasi di ogni paragrafo, dove spesso c’è l’idea principale. Alto per articoli e manuali, basso per romanzi.' },

    { id: 'markKeySentences', group: 'Studio', type: 'toggle', def: true, modes: ['study'], label: 'Sottolinea le frasi chiave', effect: 'Le frasi che finiscono nel sunto.' },
    { id: 'markDefinitions', group: 'Studio', type: 'toggle', def: true, modes: ['study'], label: 'Sottolinea le definizioni', effect: 'Frasi come “La NATO è un’alleanza…” o “si definisce…”.' },
    { id: 'markNames', group: 'Studio', type: 'toggle', def: true, modes: ['study'], label: 'Cerchia nomi e concetti', effect: 'Nomi propri e parole chiave, la prima volta in ogni paragrafo.' },
    { id: 'markNumbers', group: 'Studio', type: 'toggle', def: true, modes: ['study'], label: 'Riquadra numeri e date', effect: 'Anni, date, percentuali e cifre.' },

    { id: 'ocr', group: 'OCR (immagini e PDF scansionati)', type: 'toggle', def: true, label: 'Riconosci il testo nelle immagini',
      effect: 'Per i PDF scansionati e le foto di pagine (PNG, JPG…) usa Tesseract, un programma di OCR classico. La prima volta scarica i dati della lingua (2–4 MB), poi funziona anche senza internet.' },
    { id: 'ocrLang', group: 'OCR (immagini e PDF scansionati)', type: 'select', def: 'auto',
      options: [['auto', 'Come la lingua del testo'], ['it', 'Italiano'], ['en', 'Inglese'], ['fr', 'Francese'], ['es', 'Spagnolo'], ['de', 'Tedesco'], ['pt', 'Portoghese']],
      label: 'Lingua dell’OCR', effect: 'Con la lingua giusta Tesseract legge meglio accenti e apostrofi. “Come la lingua del testo” usa la lingua scelta sopra (con Automatica: italiano e inglese).' },
    { id: 'restoreMarks', group: 'Pagine salvate', type: 'toggle', def: true, label: 'Ritrova i segni sulle pagine salvate',
      effect: 'Quando riapri una pagina web che hai salvato in archivio, i segni ricompaiono da soli, senza animazione. Si nascondono con il pulsante sulla pagina.' },

    { id: 'theme', group: 'Aspetto', type: 'select', def: 'night', options: [['night', 'Notte (come il video)'], ['paper', 'Carta (per studiare)']],
      label: 'Tema', effect: 'Colori della pagina e dei segni.' },
    { id: 'veil', group: 'Aspetto', type: 'toggle', def: true, label: 'Velo sul testo non letto', effect: 'Scurisce ciò che il ragno non ha ancora letto.' },
    { id: 'webDensity', group: 'Aspetto', type: 'range', min: 0, max: 10, step: 1, def: 5, label: 'Ragnatela',
      effect: 'Quanti fili collegano le parole chiave tra loro e con le loro ripetizioni. 0 = niente fili.' },
    { id: 'hud', group: 'Aspetto', type: 'toggle', def: true, label: 'Riquadro dei contatori', effect: 'Il riquadro blu con parole lette e parole chiave.' }
  ];

  var PRESETS = {
    'study': { label: 'Studio accurato', values: { mode: 'study', speed: 25, legs: 10, selectivity: 3, summaryLength: 25, variety: 6, lead: 4, theme: 'paper', veil: false, webDensity: 1 } },
    'summary': { label: 'Riassunto veloce', values: { mode: 'summary', speed: 120, legs: 6, selectivity: 4, summaryLength: 15, variety: 5, lead: 4, theme: 'paper', veil: false, webDensity: 0 } },
    'deep': { label: 'Lettura profonda', values: { mode: 'summary', speed: 10, legs: 14, selectivity: 2, summaryLength: 30, variety: 7, lead: 2, theme: 'night', veil: true, webDensity: 3 } },
    'video': { label: 'Effetto video', values: { mode: 'web', speed: 14, legs: 9, selectivity: 2, theme: 'night', veil: true, webDensity: 8, hud: true } }
  };

  function defaults() {
    var o = {};
    PARAMS.forEach(function (p) { o[p.id] = p.def; });
    return o;
  }

  // Corregge valori mancanti, fuori scala o del tipo sbagliato
  function sanitize(v) {
    var out = defaults();
    if (!v || typeof v !== 'object') return out;
    PARAMS.forEach(function (p) {
      var x = v[p.id];
      if (x === undefined || x === null) return;
      if (p.type === 'range') {
        x = Number(x);
        if (!isFinite(x)) return;
        x = Math.min(p.max, Math.max(p.min, Math.round(x / (p.step || 1)) * (p.step || 1)));
        out[p.id] = x;
      } else if (p.type === 'toggle') {
        out[p.id] = !!x;
      } else if (p.type === 'select') {
        if (p.options.some(function (o) { return o[0] === x; })) out[p.id] = x;
      } else if (p.type === 'text') {
        out[p.id] = String(x).slice(0, 500);
      }
    });
    return out;
  }

  function applyPreset(current, id) {
    var p = PRESETS[id];
    if (!p) return sanitize(current);
    var v = Object.assign({}, current, p.values);
    return sanitize(v);
  }

  g.WCSettings = { MODES: MODES, PARAMS: PARAMS, PRESETS: PRESETS, defaults: defaults, sanitize: sanitize, applyPreset: applyPreset };
})(globalThis);
