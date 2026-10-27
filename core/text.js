/*
 * Word Crawler: strumenti di base sul testo (senza AI).
 * Normalizzazione delle parole, parole da ignorare (stopword), lingua, divisione in frasi.
 *
 * Un "token" è una parola del documento: { text, gap, blk, w }
 *   text: la parola così com'è scritta
 *   gap:  il testo tra la parola precedente e questa (spazi, punteggiatura, a capo)
 *   blk:  numero del blocco (paragrafo, titolo, riga di tabella…)
 *   w:    peso del blocco (1 testo normale, 2 sottotitolo, 3 titolo)
 */
(function (g) {
  'use strict';
  if (g.WCText) return;

  var EN = 'a about above across after afterwards again against all almost alone along already also although always am among amongst an and another any anyhow anyone anything anyway anywhere are around as at back be became because become becomes becoming been before beforehand behind being below beside besides between beyond both but by can cannot could did do does doing done down during each either else elsewhere enough even ever every everyone everything everywhere except few for former formerly from further had has have having he hence her here hereafter hereby herein hers herself him himself his how however if in indeed into is it its itself just last latter least less let like made make makes making many may me meanwhile might mine more moreover most mostly much must my myself namely neither never nevertheless next no nobody none noone nor not nothing now nowhere of off often on once one only onto or other others otherwise our ours ourselves out over own per perhaps please put rather same see seem seemed seeming seems several she should since so some somehow someone something sometime sometimes somewhere still such than that the their theirs them themselves then thence there thereafter thereby therefore therein thereupon these they this those though through throughout thru thus to together too toward towards under until up upon us very via was we well were what whatever when whence whenever where whereafter whereas whereby wherein whereupon wherever whether which while whither who whoever whole whom whose why will with within without would yet you your yours yourself yourselves ' +
    'said says say saying get gets got getting go goes going gone went come comes came coming take takes took taken know knows knew known think thinks thought want wants wanted use uses used using way ways thing things new old good better best great little big long high day days year years time times people part place case point fact number lot right left give gives gave given find finds found look looks looked looking tell told ask asked also really actually yes okay ok etc vs per one two three four five six seven eight nine ten first second third don isn didn doesn wasn aren couldn wouldn shouldn won hasn haven weren ain lets thou thee thy thine hath doth shall unto art ye oh whilst amp nbsp http https www com html page pages chapter fig figure table see also within using based example examples ' +
    'became become becomes began begin begins seemed seem seems tried try tries let lets put puts kept keep keeps held hold holds turned turn turns ' +
    'brought bring brings stood stand stands allowed allow allows include includes included including called call calls';

  var IT = 'a ad ai al alla alle allo agli all anche ancora avere aveva avevano avete avevo abbiamo ha hai hanno ho c che chi ci cioè col come con contro cosa così cui da dai dal dalla dalle dallo dagli dall de degli dei del della delle dello dell di dove dunque e ed è era erano eravamo essere essendo fa fare fatto fino fra gli i il in infatti invece io la le lei li lo loro lui ma me mentre mi mia mie miei mio molto molta molti molte ne nei nel nella nelle nello negli nell no noi non nostra nostre nostri nostro o oppure ogni per perché però più poco poi può possono qua quale quali qualche quando quanto quanta quanti quante quella quelle quelli quello questa queste questi questo qui se sei senza si sia siamo siete solo sono sotto stata state stati stato su sua sue sui sul sulla sulle sullo sugli sull suo suoi tanto te ti tra tu tua tue tuo tuoi tutta tutte tutti tutto un una uno vi voi volta volte ecco già sempre mai quindi allora sì oltre dopo prima durante verso tramite secondo circa altro altra altri altre stesso stessa stessi stesse proprio tale tali cose modo parte anni anno giorno giorni tempo fatta fatti dire detto dice disse fanno potrebbe deve devono dovrebbe sarà saranno sarebbe avuto abbia viene vengono venire va vanno andare dato data dati nuovo nuova nuovi nuove grande grandi primo primi ultimo ultima ultimi caso esempio perciò mediante nonché ossia ovvero qualcosa qualcuno niente nulla nessuno nessuna ciascuno ciascuna spesso subito ora adesso oggi ieri domani insomma comunque affinché sebbene benché poiché pure neanche nemmeno neppure sopra dentro fuori presso lungo attraverso essa esso esse essi egli ella costui costei colui colei due tre quattro cinque sette otto nove dieci cento mille terzo quarto pagina pagine capitolo figura tabella vedi cioe ecc può possa possano potuto stesso modo forse invece vari varie diversi diverse molto poco tanto meno maggior maggiore minore inoltre infine quindi tuttavia pertanto ancora anzi bensì ' +
    // forme verbali molto comuni (non sono concetti del testo)
    'venne vennero viene vengono fu furono ebbe ebbero fece fecero divenne divennero diventa diventano diventò rimase rimasero resta restano restò ' +
    'poté potè poteva potevano doveva dovevano voleva volevano vuole vogliono stava stavano sta stanno stare essendo avendo fatte avrebbe avrebbero ' +
    'sarebbero sembra sembrano sembrava portò portarono decise mise misero prese presero tenne arrivò andò andarono fanno faceva facevano dà danno ' +
    'diede diedero ha hanno aveva avevano parla parlano permette permettono consente consentono riguarda riguardano trova trovano trovò trovarono';

  var EN_ONLY = 'the and of to is was that with for this are be have it on as by not at from but or which were they their there been would will what when who has had an his her she him its we our you your more these those than then them so if into only other some such can could also any about';
  var IT_ONLY = 'il lo la gli le di del della dei delle che non per con una uno sono è nel nella alla anche come più questo questa ma dal dalla sul sulla gli loro essere stato tra fra cui degli delle hanno ha ancora molto';

  function fold(s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function set(str) {
    var s = new Set();
    str.split(/\s+/).forEach(function (w) { if (w) s.add(fold(w)); });
    return s;
  }
  var STOP = set(EN + ' ' + IT);
  var LANG_EN = set(EN_ONLY), LANG_IT = set(IT_ONLY);

  // Abbreviazioni dopo le quali il punto non chiude la frase
  var ABBR = set('sig sigg sigra dott dottssa prof profssa ing avv arch geom rag on sen dr mr mrs ms st jr sr vs etc ecc es ad cfr pag pagg p pp vol voll n nn art artt cap capp fig figg tab ed eds cit op ca cca sec secc no nr tel fax al inc ltd co corp jan feb mar apr jun jul aug sep sept oct nov dec gen febb giu lug ago sett ott dic lett rif tav sez par min max approx ss seg segg');

  // Parola: lettere/cifre, con apostrofi e trattini interni
  // (i numeri con separatori, come 270.000 o 3,5, restano una parola sola)
  var WORD = /\p{N}+(?:[.,]\p{N}+)+|[\p{L}\p{N}][\p{L}\p{M}\p{N}'’\-]*[\p{L}\p{M}\p{N}]|[\p{L}\p{N}]/gu;

  // "dell'Odissea" -> "Odissea", "Calypso's" -> "Calypso", "don't" -> "don"
  function normPart(raw) {
    var s = raw.replace(/’/g, "'");
    var i = s.indexOf("'");
    if (i >= 0) {
      var before = s.slice(0, i), after = s.slice(s.lastIndexOf("'") + 1);
      s = after.length <= 2 ? before : after;
    }
    return s.replace(/^-+|-+$/g, '');
  }
  // Radice semplice: unisce singolare e plurale (gods/god, libri/libro, case/casa)
  function stem(w) {
    if (w.length <= 4 || /ss$/.test(w)) return w;
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    return w.replace(/(es|s|[aeio])$/, '');
  }
  function keyOf(raw) { return stem(fold(normPart(raw))); }
  function isStop(f) { return STOP.has(f) || f.length < 3 || /^\d+$/.test(f) || /\d.*\d.*\d/.test(f); }

  // Prepara i campi usati dall'analisi su ogni token
  function prepare(tokens) {
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var base = normPart(t.text);
      var f = fold(base);
      t.base = base;
      t.f = f;
      t.key = stem(f);
      t.stop = isStop(f);
      t.cap = /^\p{Lu}/u.test(base);
      t.allcap = base.length > 1 && base === base.toUpperCase() && /\p{Lu}/u.test(base);
      t.acronym = t.allcap && base.length <= 6;
      if (t.gap === undefined) t.gap = ' ';
      if (t.blk === undefined) t.blk = 0;
      if (t.w === undefined) t.w = 1;
    }
    return tokens;
  }

  function detectLang(tokens) {
    var it = 0, en = 0, n = Math.min(tokens.length, 4000);
    for (var i = 0; i < n; i++) {
      var f = tokens[i].f;
      if (LANG_IT.has(f)) it++;
      if (LANG_EN.has(f)) en++;
    }
    if (it + en < 5) return 'it';
    return it >= en ? 'it' : 'en';
  }

  var END = /[.!?…]/;
  var OPEN = /[«"“‘'(\[—–-]/;

  /*
   * Divide i token in frasi. Una frase finisce quando:
   *  - cambia il blocco (paragrafo, titolo…), oppure
   *  - nello spazio prima della parola c'è un punto/!/?/… seguito da spazio, e la parola successiva
   *    comincia con maiuscola, cifra o virgolette, e il punto non è di un'abbreviazione o un'iniziale.
   * Imposta t.sid su ogni token e restituisce [{ id, from, to, text, blk, w }].
   */
  function sentences(tokens) {
    var out = [];
    var start = 0;
    function close(end) {
      if (end <= start) return;
      out.push({ id: out.length, from: start, to: end });
      start = end;
    }
    for (var i = 1; i < tokens.length; i++) {
      var t = tokens[i], p = tokens[i - 1];
      var brk = false;
      if (t.blk !== p.blk) brk = true;
      else if (/\n\s*\n/.test(t.gap)) brk = true;
      else if (END.test(t.gap) && /\s/.test(t.gap)) {
        var after = t.gap.slice(t.gap.search(END));
        var nextOk = /^\p{Lu}|^\p{N}/u.test(t.text) || OPEN.test(after) || /\n/.test(t.gap);
        var abbr = ABBR.has(p.f) || (p.text.length === 1 && /\p{Lu}/u.test(p.text) && /^\.\s/.test(t.gap));
        var ellipsisMid = /…|\.\.\./.test(t.gap) && !/^\p{Lu}/u.test(t.text);
        if (nextOk && !abbr && !ellipsisMid) brk = true;
      } else if (i - start > 140 && /[;:]/.test(t.gap)) {
        brk = true; // frasi lunghissime: spezza su ; o :
      }
      if (brk) close(i);
    }
    close(tokens.length);
    out.forEach(function (s) {
      for (var k = s.from; k < s.to; k++) tokens[k].sid = s.id;
      s.blk = tokens[s.from].blk;
      s.w = tokens[s.from].w;
      s.text = sentenceText(tokens, s.from, s.to);
    });
    return out;
  }

  function sentenceText(tokens, from, to) {
    var s = '';
    for (var k = from; k < to; k++) {
      if (k > from) s += tokens[k].gap.replace(/\s+/g, ' ');
      s += tokens[k].text;
    }
    // punteggiatura finale (es. ". ” ?") presa dallo spazio dopo l'ultima parola
    if (to < tokens.length) {
      var m = tokens[to].gap.match(/^[^\s\p{L}\p{N}]*/u);
      if (m && m[0]) s += m[0].replace(/[«“(\[]+$/, '');
    } else {
      var tail = tokens[to - 1].tail;
      if (tail) s += tail;
    }
    var lead = tokens[from].gap.match(/[«“"(\[]+$/);
    if (lead) s = lead[0] + s;
    return s.trim();
  }

  // Tokenizza una stringa semplice (usato per i testi incollati e nei test)
  function tokenizeString(text, blk, w) {
    var out = [], m, last = 0;
    WORD.lastIndex = 0;
    while ((m = WORD.exec(text))) {
      out.push({ text: m[0], gap: text.slice(last, m.index), blk: blk || 0, w: w || 1, start: m.index, end: m.index + m[0].length });
      last = m.index + m[0].length;
    }
    if (out.length) out[out.length - 1].tail = text.slice(last).replace(/\s+$/, '');
    return out;
  }

  /*
   * Tokenizza una lista di blocchi [{ text, w }] in un'unica sequenza di token.
   * Lo spazio prima del primo token di un blocco contiene la coda del blocco precedente
   * (es. il punto finale) e un a capo, così la divisione in frasi resta corretta.
   */
  function tokenizeBlocks(blocks) {
    var out = [], prevTail = '';
    blocks.forEach(function (b, bi) {
      var toks = tokenizeString(b.text, bi, b.w || 1);
      if (!toks.length) return;
      toks[0].gap = (out.length ? prevTail + '\n' : '') + toks[0].gap;
      prevTail = toks[toks.length - 1].tail || '';
      toks.forEach(function (t) { t.block = b; });
      out.push.apply(out, toks);
    });
    return out;
  }

  g.WCText = {
    WORD: WORD, STOP: STOP, fold: fold, normPart: normPart, stem: stem, keyOf: keyOf, isStop: isStop,
    prepare: prepare, detectLang: detectLang, sentences: sentences, sentenceText: sentenceText, tokenizeString: tokenizeString, tokenizeBlocks: tokenizeBlocks
  };
})(globalThis);
