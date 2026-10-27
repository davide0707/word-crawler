/*
 * Word Crawler: dati delle lingue (senza AI).
 * Italiano, inglese, francese, spagnolo, tedesco e portoghese.
 *
 * Per ogni lingua: parole da ignorare, parole tipiche per riconoscerla, abbreviazioni, mesi,
 * modi di scrivere una definizione, connettivi a inizio frase, pronomi che rimandano indietro,
 * conteggio delle sillabe e indice di leggibilità.
 *
 * Le frequenze delle parole (core/freq/<lingua>.js, circa 160 KB l'una) si caricano solo quando
 * servono con WCLang.ensure(lingua). Dicono quanto una parola è comune nella lingua di tutti i giorni:
 * una parola rara che il testo ripete spesso è quasi sempre un concetto importante.
 */
(function (g) {
  'use strict';
  if (g.WCLang) return;

  function fold(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function set(str) {
    var s = new Set();
    str.split(/\s+/).forEach(function (w) { if (w) s.add(fold(w)); });
    return s;
  }
  // confini di parola che funzionano anche con le lettere accentate
  var B0 = '(?<![\\p{L}\\p{N}])', B1 = '(?:(?<=[\'’])|(?![\\p{L}\\p{N}]))';
  function words(list) { return '(?:' + list.split('|').map(function (w) { return w.trim().replace(/\s+/g, '\\s+'); }).join('|') + ')'; }
  // "Soggetto è un…": il soggetto è breve e senza virgole
  function def1(verbs) { return new RegExp('^([^,;:]{2,70}?)\\s' + verbs + B1, 'iu'); }
  // espressioni che definiscono in modo esplicito ("si definisce", "refers to")
  function def2(list) { return new RegExp(B0 + words(list) + B1, 'iu'); }
  // connettivo a inizio frase, seguito da virgola o spazio
  function lead(list) { return new RegExp('^(?:' + words(list) + ')(?:\\s*,\\s*|\\s+)(?=\\S)', 'iu'); }

  // ------------------------------------------------------------ sillabe
  var V_STRONG = 'aeoáéóàèòâêôãõäöå';
  function sylRomance(w, extraHiatus) {
    w = w.toLowerCase().replace(/[^a-záéíóúàèìòùâêîôûãõäëïöüçñy]/g, '');
    if (!w) return 1;
    var n = 0, groups = w.match(/[aeiouyáéíóúàèìòùâêîôûãõäëïöü]+/g) || [];
    groups.forEach(function (gr) {
      n++;
      for (var i = 1; i < gr.length; i++) {
        var a = gr[i - 1], b = gr[i];
        // due vocali forti vicine (po-e-ta) o una i/u accentata (dí-a) sono sillabe diverse
        if ((V_STRONG.indexOf(a) >= 0 && V_STRONG.indexOf(b) >= 0) || /[íúìù]/.test(a + b) || (extraHiatus && extraHiatus(a, b))) n++;
      }
    });
    return Math.max(1, n);
  }
  function sylEn(w) {
    w = w.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    var m = w.match(/[aeiouy]{1,2}/g);
    return Math.max(1, m ? m.length : 1);
  }
  function sylFr(w) {
    w = w.toLowerCase().replace(/[^a-zàâäéèêëîïôöùûüÿçœæ]/g, '');
    if (w.length > 3) w = w.replace(/(?:es|e)$/, ''); // la "e" muta finale non si pronuncia
    var m = w.match(/[aeiouyàâäéèêëîïôöùûüÿœæ]+/g);
    return Math.max(1, m ? m.length : 1);
  }
  function sylDe(w) {
    var m = w.toLowerCase().match(/[aeiouyäöü]+/g);
    return Math.max(1, m ? m.length : 1);
  }

  // ------------------------------------------------------------ le lingue
  // parole funzionali inglesi (si ignorano anche nei testi nelle altre lingue)
  var EN_FUNC = 'a about above across after afterwards again against all almost alone along already also although always am among amongst an and another any anyhow anyone anything anyway anywhere are around as at back be became because become becomes becoming been before beforehand behind being below beside besides between beyond both but by can cannot could did do does doing done down during each either else elsewhere enough even ever every everyone everything everywhere except few for former formerly from further had has have having he hence her here hereafter hereby herein hers herself him himself his how however if in indeed into is it its itself just last latter least less let like made make makes making many may me meanwhile might mine more moreover most mostly much must my myself namely neither never nevertheless next no nobody none noone nor not nothing now nowhere of off often on once one only onto or other others otherwise our ours ourselves out over own per perhaps please put rather same see seem seemed seeming seems several she should since so some somehow someone something sometime sometimes somewhere still such than that the their theirs them themselves then thence there thereafter thereby therefore therein thereupon these they this those though through throughout thru thus to together too toward towards under until up upon us very via was we well were what whatever when whence whenever where whereafter whereas whereby wherein whereupon wherever whether which while whither who whoever whole whom whose why will with within without would yet you your yours yourself yourselves';
  var EN_STOP = EN_FUNC + ' ' +
    'said says say saying get gets got getting go goes going gone went come comes came coming take takes took taken know knows knew known think thinks thought want wants wanted use uses used using way ways thing things new old good better best great little big long high day days year years time times people part place case point fact number lot right left give gives gave given find finds found look looks looked looking tell told ask asked also really actually yes okay ok etc vs per one two three four five six seven eight nine ten first second third don isn didn doesn wasn aren couldn wouldn shouldn won hasn haven weren ain lets thou thee thy thine hath doth shall unto ye oh whilst amp nbsp http https www com html page pages chapter fig figure table see also within using based example examples ' +
    'became become becomes began begin begins seemed seem seems tried try tries let lets put puts kept keep keeps held hold holds turned turn turns brought bring brings stood stand stands allowed allow allows include includes included including called call calls';

  var L = {
    it: {
      name: 'Italiano',
      stop: 'a ad ai al alla alle allo agli all anche ancora avere aveva avevano avete avevo abbiamo ha hai hanno ho c che chi ci cioè col come con contro cosa così cui da dai dal dalla dalle dallo dagli dall de degli dei del della delle dello dell di dove dunque e ed è era erano eravamo essere essendo fa fare fatto fino fra gli i il in infatti invece io la le lei li lo loro lui ma me mentre mi mia mie miei mio molto molta molti molte ne nei nel nella nelle nello negli nell no noi non nostra nostre nostri nostro o oppure ogni per perché però più poco poi può possono qua quale quali qualche quando quanto quanta quanti quante quella quelle quelli quello questa queste questi questo qui se sei senza si sia siamo siete solo sono sotto stata state stati stato su sua sue sui sul sulla sulle sullo sugli sull suo suoi tanto te ti tra tu tua tue tuo tuoi tutta tutte tutti tutto un una uno vi voi volta volte ecco già sempre mai quindi allora sì oltre dopo prima durante verso tramite secondo circa altro altra altri altre stesso stessa stessi stesse proprio tale tali cose modo parte anni anno giorno giorni tempo fatta fatti dire detto dice disse fanno potrebbe deve devono dovrebbe sarà saranno sarebbe avuto abbia viene vengono venire va vanno andare dato data dati nuovo nuova nuovi nuove grande grandi primo primi ultimo ultima ultimi caso esempio perciò mediante nonché ossia ovvero qualcosa qualcuno niente nulla nessuno nessuna ciascuno ciascuna spesso subito ora adesso oggi ieri domani insomma comunque affinché sebbene benché poiché pure neanche nemmeno neppure sopra dentro fuori presso lungo attraverso essa esso esse essi egli ella costui costei colui colei due tre quattro cinque sette otto nove dieci cento mille terzo quarto pagina pagine capitolo figura tabella vedi cioe ecc può possa possano potuto forse vari varie diversi diverse meno maggior maggiore minore inoltre infine tuttavia pertanto anzi bensì ' +
        'venne vennero fu furono ebbe ebbero fece fecero divenne divennero diventa diventano diventò rimase rimasero resta restano restò poté potè poteva potevano doveva dovevano voleva volevano vuole vogliono stava stavano sta stanno stare avendo fatte avrebbe avrebbero sarebbero sembra sembrano sembrava portò portarono decise mise misero prese presero tenne arrivò andò andarono faceva facevano dà danno diede diedero parla parlano permette permettono consente consentono riguarda riguardano trova trovano trovò trovarono',
      detect: 'il lo gli di della delle degli che non per con una sono è nel nella alla anche come più questo questa ma dal dalla sul sulla loro essere stato tra fra cui hanno molto ancora già perché quando ci',
      abbr: 'sig sigg sigra dott dottssa prof profssa ing avv arch geom rag on sen ecc es ad pag pagg art artt cap capp cca sec secc gen febb mar apr mag giu lug ago sett ott nov dic lett rif tav sez par ss seg segg',
      articles: 'il lo la i gli le l\' un uno una un\' del dello della dei degli delle dell\'',
      months: 'gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre',
      century: 'secolo secoli sec',
      connect: 'di del della dello dei degli delle',
      def1: def1('(?:(?:è|e\'|sono)\\s(?:un|una|uno|un\'|il|lo|la|l\'|i|gli|le)|(?:è|sono|era|erano|fu|furono)\\s(?:dett[oaie]|chiamat[oaie]|definit[oaie]|considerat[oaie]))'),
      def2: def2('si definisce|si definiscono|si intende|si intendono|si indica|si indicano|viene definito|viene definita|vengono definiti|vengono definite|prende il nome di|prendono il nome di|è detto|è detta|sono detti|sono dette|significa|consiste nel|consiste in|si tratta di'),
      lead: lead('inoltre|tuttavia|infatti|quindi|pertanto|comunque|invece|anzi|dunque|allora|però|perciò|oltretutto|infine|successivamente|in effetti|in seguito|di conseguenza|per questo|d\'altra parte|del resto|ma|e'),
      anaphora: 'questo questa questi queste ciò esso essa essi esse egli ella lui lei loro tale tali costui costei quest\'ultimo quest\'ultima quest\'ultimi quest\'ultime',
      wpm: 200, syl: null,
      read: function (c) { return { value: 89 + (300 * c.S - 10 * c.letters) / c.W, scale: 'Gulpease', cut: [80, 60, 40] }; }
    },
    en: {
      name: 'English',
      stop: EN_STOP,
      detect: 'the and of to is was that with for this are be have it on as by not at from but or which were they their there been would will what when who has had an his her she him its we our you your more these those than then them so if into only other some such can could also any about',
      abbr: 'mr mrs ms jr sr jan feb mar apr jun jul aug sep sept oct nov dec dept univ est e g i ie eg al',
      articles: 'the a an',
      months: 'january february march april may june july august september october november december',
      century: 'century centuries',
      connect: 'of',
      def1: def1('(?:(?:is|are)\\s(?:a|an|the)|(?:is|are|was|were)\\s(?:defined as|called|known as|referred to as))'),
      def2: def2('is defined as|are defined as|refers to|refer to|is called|are called|is known as|means that|consists of|is the term for'),
      lead: lead('however|moreover|furthermore|therefore|thus|also|besides|in addition|additionally|consequently|hence|nevertheless|nonetheless|meanwhile|indeed|in fact|instead|as a result|on the other hand|finally|then|so|but|and'),
      anaphora: 'this these that those he she they it such the latter the former',
      wpm: 230, syl: sylEn,
      read: function (c) { return { value: 206.835 - 1.015 * (c.W / c.S) - 84.6 * (c.syl / c.W), scale: 'Flesch', cut: [70, 50, 30] }; }
    },
    fr: {
      name: 'Français',
      stop: 'a à afin ai aie aient aies ait alors as au aucun aucune auquel aura aurai auraient aurais aurait auras aurez auriez aurions aurons auront aussi autre autres aux auxquelles auxquels avaient avais avait avant avec avez aviez avions avoir avons ayant ayez ayons bien c ça car ce ceci cela celle celles celui cependant certain certaine certaines certains ces cet cette ceux chacun chacune chaque chez ci comme comment d dans de depuis des desquelles desquels dessous dessus deux devant doit doivent donc dont du duquel durant elle elles en encore entre es est et étaient étais était étant été êtes étions être eu eue eues eûmes eurent eus eut eux fait faire fais faisait font fûmes furent fut grâce hors hui ici il ils j je jusqu jusque l la laquelle le lequel les lesquelles lesquels leur leurs lors lorsque lui m ma mais me même mêmes mes moi moins mon n ne ni non nos notre nous on ont ou où par parce parmi pas pendant peu peut peuvent plupart plus plusieurs pour pourquoi pourrait pouvait pouvoir puis puisque qu quand que quel quelle quelles quels qui quoi s sa sans se selon sera serai seraient serait seront ses si sien soi soient sois soit sommes son sont sous suis sur t ta tandis tant te tel telle telles tels tes toi ton toujours tous tout toute toutes très trop tu un une unes uns vers voici voilà vos votre vous y ' +
        'dire dit dits dite dites aller va vont allait sait savoir voir vu vue donne donné prendre pris mettre mis tenir venir vient venu devenir devient devenu sembler semble semblait rester reste restait trouve trouver trouvé passer passe passé falloir faut fallait chose choses fois façon manière partie part cas exemple an ans année années jour jours temps moment déjà ainsi après beaucoup certes abord enfin ensuite jamais là maintenant néanmoins parfois peut-être plutôt pourtant presque quelque quelques rien seulement souvent surtout tard tôt toutefois vraiment environ autour chap page pages figure tableau cf etc premier première second seconde dernier dernière grand grande grands grandes petit petite nouveau nouvelle nouveaux nouvelles trois quatre cinq six sept huit neuf dix cent mille',
      detect: 'le les des du et est une dans pour pas qui sur au aux avec ce cette ces son sa ses ont été sont mais ou comme par plus il elle nous vous leur leurs être fait aussi très où était',
      abbr: 'm mm mme mmes mlle mlles me pr ste av env chap ex éd janv févr avr juil sept oct nov déc',
      articles: 'le la les l\' un une des du d\'',
      months: 'janvier février mars avril mai juin juillet août septembre octobre novembre décembre',
      century: 'siècle siècles',
      connect: 'de du des',
      def1: def1('(?:(?:est|sont)\\s(?:un|une|le|la|l\'|les|des)|(?:est|sont|était|étaient)\\s(?:appelée?s?|dite?s?|définie?s?|considérée?s?\\s+comme))'),
      def2: def2('se définit comme|se définissent comme|se définit|on appelle|on entend par|on désigne par|désigne|désignent|signifie|consiste à|consiste en|est défini comme|est définie comme|il s\'agit d'),
      lead: lead('cependant|toutefois|de plus|en outre|par ailleurs|donc|ainsi|pourtant|néanmoins|enfin|en effet|par conséquent|d\'ailleurs|puis|ensuite|alors|mais|et'),
      anaphora: 'ce cela ceci celui celle ceux celles il elle ils elles ces cette cet ce dernier cette dernière',
      wpm: 210, syl: sylFr,
      read: function (c) { return { value: 207 - 1.015 * (c.W / c.S) - 73.6 * (c.syl / c.W), scale: 'Kandel-Moles', cut: [70, 50, 30] }; }
    },
    es: {
      name: 'Español',
      stop: 'a al algo algunas algunos ante antes aquel aquella aquellas aquellos aquí así aun aunque bajo bien cada casi como con contra cual cuales cualquier cuando cuanto cuya cuyo de del desde donde dos durante e el ella ellas ello ellos en entre era eran eres es esa esas ese eso esos esta está estaba estaban estado estamos están estar estas este esto estos estoy fue fueron fui ha haber había habían han has hasta hay he hemos hubo la las le les lo los más me mi mientras mis mucho muchos muy nada ni no nos nosotros o os otra otras otro otros para pero poco por porque pues que qué quien quienes se sea según ser será si sí sido siempre sin sino sobre solo sólo son su sus también tan tanto te tener tenía tiene tienen todo todos tras tu tú tus un una uno unos usted ustedes y ya yo ' +
        'entonces hacia luego mismo misma mismos mismas puede pueden podía podría debe deben hacer hace hacen hizo hecho dijo decir dice dicen ir va van iba siendo tenido vez veces cosa cosas forma manera parte caso ejemplo año años día días tiempo ahora después hoy ayer mañana nunca todavía allí allá ahí cerca lejos dentro fuera arriba abajo menos tal tales cierto cierta varios varias diversos diversas gran grande grandes nuevo nueva nuevos nuevas primer primero primera último última tres cuatro cinco seis siete ocho nueve diez cien mil página páginas capítulo figura tabla véase etc mediante través embargo obstante dado dada dados dadas fueran hubiera habría estaría sería pudo quería quiere quieren dio dieron puso pusieron llegó llegaron pasó quedó queda quedan sigue siguen parece parecía',
      detect: 'el los las del y es una por para con no se su sus al lo como más pero este esta son fue ha han también entre muy sobre desde todo cuando ya era hay sin porque ser está están',
      abbr: 'sr sra srta sres dra ud uds vd vds pág págs núm aprox cap ej avda dpto ene abr ago sep sept oct nov dic',
      articles: 'el la los las lo un una unos unas',
      months: 'enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre',
      century: 'siglo siglos',
      connect: 'de del',
      def1: def1('(?:(?:es|son)\\s(?:un|una|el|la|los|las|lo)|(?:es|son|era|eran|fue|fueron)\\s(?:llamad[oa]s?|denominad[oa]s?|definid[oa]s?|conocid[oa]s?\\s+como|considerad[oa]s?))'),
      def2: def2('se define como|se definen como|se denomina|se denominan|se llama|se llaman|se entiende por|significa|consiste en|se refiere a|se trata de'),
      lead: lead('sin embargo|además|por lo tanto|por tanto|así|asimismo|no obstante|entonces|finalmente|en efecto|por consiguiente|de hecho|por otra parte|luego|también|pero|y'),
      anaphora: 'este esta estos estas esto ese esa esos esas eso ella ellos ellas dicho dicha dichos dichas tal tales',
      wpm: 220, syl: sylRomance,
      read: function (c) { return { value: 206.835 - 62.3 * (c.syl / c.W) - (c.W / c.S), scale: 'Szigriszt-Pazos', cut: [65, 55, 40] }; }
    },
    de: {
      name: 'Deutsch',
      stop: 'aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes anders auch auf aus bei beim bin bis bist da dabei dadurch dafür dagegen daher damit dann daran darauf daraus darin darüber darum das dass daß dein deine dem den denen denn der deren des deshalb dessen dich die dies diese diesem diesen dieser dieses dir doch dort du durch ein eine einem einen einer eines einige einigen einiger einiges einmal er es etwa etwas euch euer eure für gegen gewesen hab habe haben hat hatte hatten hier hin hinter ich ihm ihn ihnen ihr ihre ihrem ihren ihrer ihres im immer in indem ins ist ja jede jedem jeden jeder jedes jedoch jene jenem jenen jener jenes jetzt kann kein keine keinem keinen keiner keines können könnte machen man manche manchem manchen mancher manches mehr mein meine mit muss musste nach nicht nichts noch nun nur ob oder ohne schon sehr sein seine seinem seinen seiner seines selbst sich sie sind so solche solchem solchen solcher solches soll sollte sondern sonst über um und uns unser unsere unter viel vom von vor während war waren warst was weg weil weiter welche welchem welchen welcher welches wenn werde werden wie wieder will wir wird wirst wo wollen wollte worden wurde wurden zu zum zur zwar zwischen ' +
        'sowie bzw usw ca vgl zb ab außer bereits damals dazu eben ebenfalls eigentlich einfach erst fast ganz gar gerade gleich häufig heute je kaum lange letzte letzten mal meist meistens mehrere natürlich neben neu neue neuen neuer oft sogar somit später stets trotz viele vielen vieles völlig wann warum weiterhin wenig wenige weniger wieso wohl ziemlich zudem zuerst zunächst zurück zusammen gibt gab geben gegeben geht ging gehen gekommen kommt kam kommen sagte sagt sagen gesagt steht stand stehen lässt ließ lassen macht machte gemacht wäre wären hätte hätten sei seien konnte konnten müssen mussten sollen sollten darf dürfen mag möchte zwei drei vier fünf sechs sieben acht neun zehn hundert tausend erste ersten erster zweite zweiten dritte jahr jahre jahren jahres tag tage tagen zeit teil beispiel art weise seite seiten kapitel abbildung tabelle siehe',
      detect: 'der die das und ist nicht ein eine einen dem den des mit sich auf für von zu im auch es wird werden wurde sind war nach bei aus wie oder aber noch nur über durch kann sie er dass als',
      abbr: 'hr hrn fr prof bzw usw vgl evtl ggf inkl bspw sog jh jhd abs bd hrsg str z b d h u a o s okt dez',
      articles: 'der die das den dem des ein eine einen einem einer eines',
      // "Als X bezeichnet man…", "Unter X versteht man…"
      defPre: 'als unter',
      determiners: 'der die das den dem des ein eine einen einem einer eines kein keine keinen keinem keiner keines mein meine meinen dein deine sein seine seinen seinem seiner ihr ihre ihren ihrem ihrer unser unsere euer eure dieser diese dieses diesem diesen jener jene jenes jeder jede jedes jeden jedem alle allen beiden im am zum zur vom beim ins ans aufs',
      months: 'januar jänner februar märz april mai juni juli august september oktober november dezember',
      century: 'jahrhundert jahrhunderts jh jhd',
      connect: 'von vom der des',
      def1: def1('(?:(?:ist|sind)\\s(?:ein|eine|einer|der|die|das)|(?:ist|sind|war|waren|wird|werden)\\s(?:definiert als|bezeichnet als|genannt))'),
      def2: def2('versteht man|bezeichnet man|nennt man|wird definiert als|werden definiert als|wird als|bezeichnet|bedeutet|besteht aus|heißt'),
      // nel tedesco i connettivi come "außerdem" spostano il verbo: si tolgono solo quelli che non lo fanno
      lead: lead('aber|und|doch|denn'),
      anaphora: 'dies diese dieser dieses diesem diesen er sie es solche solcher solches letzterer letztere',
      wpm: 180, syl: sylDe,
      // i nomi comuni tedeschi hanno la maiuscola: la maiuscola da sola non indica un nome proprio
      nounCaps: true,
      nounSuffix: /(?:ung|ungen|heit|heiten|keit|keiten|schaft|schaften|tion|tionen|tat|taten|ismus|nis|nisse|nissen|tum|tums|ling|linge|chen|lein|ik|ur|ie|ien|enz|anz|ment|ments|itat)$/,
      read: function (c) { return { value: 180 - (c.W / c.S) - 58.5 * (c.syl / c.W), scale: 'Amstad', cut: [70, 50, 30] }; }
    },
    pt: {
      name: 'Português',
      stop: 'a à ao aos aquela aquelas aquele aqueles aquilo as às até com como contra da das de dela delas dele deles depois do dos e é ela elas ele eles em entre era eram essa essas esse esses esta está estão estas estava estavam este estes esteve estive estou eu foi fomos for foram fosse fossem fui há isso isto já lhe lhes mais mas me mesmo meu meus minha minhas muito na não nas nem no nos nós nossa nossas nosso nossos num numa o os ou para pela pelas pelo pelos por qual quando que quem se seja sejam sem ser será seu seus só sobre sua suas também te tem têm tinha tinham tu tua tuas um uma umas uns você vocês vos ' +
        'ainda além algum alguma algumas alguns ali aqui assim cada coisa coisas desde dessa desse desta deste disso disto dois duas embora enquanto então entretanto fazer faz fazem fez feito feita forma maneira modo parte caso exemplo ano anos dia dias tempo vez vezes agora antes hoje ontem amanhã nunca sempre lá cá aí perto longe dentro fora menos tal tais certo certa vários várias diversos diversas grande grandes novo nova novos novas primeiro primeira último última três quatro cinco seis sete oito nove dez cem mil página páginas capítulo figura tabela ver etc porém contudo todavia portanto pois porque através mediante segundo conforme durante sido sendo tendo tido ter tenho temos poder pode podem podia poderia deve devem dever dizer disse diz dizem ir vai vão ia ficar fica ficou ficam parece parecia outro outra outros outras todo toda todos todas tudo nada nenhum nenhuma qualquer quais cujo cuja onde',
      detect: 'o os as da do das dos e é um uma em no na nos nas para com não se que por mais como mas foi ao ele ela são seu sua também pelo pela muito já quando ser está isso entre sobre depois',
      abbr: 'sr sra srs dra drs pág págs núm aprox cap ex av profa fev abr mai ago set out dez',
      articles: 'o a os as um uma uns umas',
      months: 'janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro',
      century: 'século séculos',
      connect: 'de do da dos das',
      def1: def1('(?:(?:é|são)\\s(?:um|uma|o|a|os|as)|(?:é|são|era|eram|foi|foram)\\s(?:chamad[oa]s?|denominad[oa]s?|definid[oa]s?|conhecid[oa]s?\\s+como|considerad[oa]s?))'),
      def2: def2('define-se como|definem-se como|se define como|denomina-se|denominam-se|chama-se|chamam-se|entende-se por|significa|consiste em|refere-se a|trata-se de'),
      lead: lead('além disso|no entanto|contudo|todavia|portanto|assim|entretanto|porém|então|finalmente|por isso|de fato|por outro lado|ainda assim|também|mas|e'),
      anaphora: 'este esta estes estas isto esse essa esses essas isso ele ela eles elas tal tais',
      wpm: 200, syl: sylRomance,
      read: function (c) { return { value: 248.835 - 1.015 * (c.W / c.S) - 84.6 * (c.syl / c.W), scale: 'Flesch (Martins)', cut: [70, 50, 30] }; }
    }
  };
  L.it.syl = function (w) { return sylRomance(w); };

  var CODES = Object.keys(L);
  var COMMON_ABBR = set('etc vs ca cfr p pp vol voll n nn fig figg tab ed eds cit op no nr tel fax inc ltd co corp min max approx dr st al');
  var EN_FUNCSET = set(EN_FUNC);
  CODES.forEach(function (c) {
    var d = L[c];
    d.code = c;
    d.stopSet = set(d.stop);
    // l'inglese compare spesso dentro testi in altre lingue (citazioni, termini tecnici)
    if (c !== 'en') EN_FUNCSET.forEach(function (w) { d.stopSet.add(w); });
    d.detectSet = set(d.detect);
    d.abbrSet = set(d.abbr);
    COMMON_ABBR.forEach(function (w) { d.abbrSet.add(w); });
    d.monthSet = set(d.months + ' ' + L.en.months);
    d.centurySet = set(d.century + ' ' + L.en.century);
    d.anaphoraSet = set(d.anaphora);
    d.determinerSet = set(d.determiners || '');
    var arts = d.articles.split(' ');
    var spaced = arts.filter(function (a) { return !/'$/.test(a); }), apos = arts.filter(function (a) { return /'$/.test(a); });
    d.articleRe = new RegExp('^(?:(?:' + spaced.join('|') + ')\\s+' + (apos.length ? '|(?:' + apos.join('|') + ')' : '') + ')', 'iu');
    d.articleSet = set(spaced.join(' '));
    d.defPreRe = d.defPre ? new RegExp('^(?:' + d.defPre.split(' ').join('|') + ')\\s+', 'iu') : null;
  });
  var CONNECT = new Set(['von', 'van', 'du', 'da', 'de']);
  CODES.forEach(function (c) { set(L[c].connect).forEach(function (w) { CONNECT.add(w); }); });

  function get(code) { return L[code] || L.it; }

  // ------------------------------------------------------------ riconoscimento
  function normFold(raw) {
    var s = String(raw).replace(/’/g, "'");
    var i = s.indexOf("'");
    if (i >= 0) { var before = s.slice(0, i), after = s.slice(s.lastIndexOf("'") + 1); s = after.length <= 2 ? before : after; }
    return fold(s);
  }
  function detectFolds(folds) {
    var score = {}, total = 0;
    CODES.forEach(function (c) { score[c] = 0; });
    folds.forEach(function (f) {
      var hit = false;
      CODES.forEach(function (c) { if (L[c].detectSet.has(f)) { score[c]++; hit = true; } });
      if (hit) total++;
    });
    if (total < 5) return 'it';
    var best = 'it';
    CODES.forEach(function (c) { if (score[c] > score[best]) best = c; });
    return best;
  }
  // tokens: token di text.js (bastano i testi), oppure una stringa
  function detect(input) {
    var folds = [];
    if (typeof input === 'string') {
      var m, re = /[\p{L}][\p{L}\p{M}'’]*/gu, n = 0;
      while ((m = re.exec(input)) && n++ < 5000) folds.push(normFold(m[0]));
    } else {
      for (var i = 0; i < Math.min(input.length, 5000); i++) folds.push(input[i].f || normFold(input[i].text));
    }
    return detectFolds(folds);
  }

  // ------------------------------------------------------------ frequenze
  var ranks = {};
  function hasFreq(code) { return !!(g.WCFreq && g.WCFreq[code]); }
  function rankMap(code) {
    if (ranks[code]) return ranks[code];
    if (!hasFreq(code)) return null;
    var m = new Map();
    g.WCFreq[code].split(' ').forEach(function (w, i) { if (!m.has(w)) m.set(w, i + 1); });
    ranks[code] = m;
    return m;
  }
  // posizione nella classifica delle parole più usate (1 = la più comune), 0 = non in elenco
  function rank(code, f) {
    var m = rankMap(code);
    return m ? (m.get(f) || 0) : -1;
  }
  /*
   * Peso di rarità: 0,42 per le parole più comuni, 1,08 per le parole fuori dalle 20.000 più usate.
   * Cresce col logaritmo della posizione (legge di Zipf). Senza dati di frequenza vale 1.
   */
  function rarity(code, f) {
    var m = rankMap(code);
    if (!m) return 1;
    var r = m.get(f);
    if (!r) return 1.08;
    return 0.42 + 0.66 * Math.min(1, Math.log(r) / Math.log(m.size));
  }

  // cartella di core/ (per caricare le frequenze e il thread di analisi)
  var base = '';
  try {
    var cs = g.document && g.document.currentScript;
    if (cs && cs.src) base = cs.src.replace(/[^/]*$/, '');
    else if (!g.document && typeof g.importScripts === 'function' && g.location) base = String(g.location.href).replace(/[^/]*$/, '');
  } catch (e) { /* Node */ }
  function setBase(b) { base = b; }
  function getBase() { return base; }
  // Carica le frequenze di una lingua (una volta sola). Restituisce una Promise<boolean>.
  var loading = {};
  function ensure(code) {
    if (!L[code]) return Promise.resolve(false);
    if (hasFreq(code)) return Promise.resolve(true);
    if (loading[code]) return loading[code];
    var p;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try { require('./freq/' + code + '.js'); } catch (e) { /* file mancante */ }
      p = Promise.resolve(hasFreq(code));
    } else if (typeof g.importScripts === 'function') {
      try { g.importScripts(base + 'freq/' + code + '.js'); } catch (e) { /* file mancante */ }
      p = Promise.resolve(hasFreq(code));
    } else if (g.document && base) {
      p = new Promise(function (resolve) {
        var s = g.document.createElement('script');
        s.src = base + 'freq/' + code + '.js';
        s.onload = function () { resolve(hasFreq(code)); };
        s.onerror = function () { resolve(false); };
        (g.document.head || g.document.documentElement).appendChild(s);
      });
    } else p = Promise.resolve(false);
    loading[code] = p;
    p.then(function (ok) { if (!ok) delete loading[code]; });
    return p;
  }

  // ------------------------------------------------------------ frasi e sunto
  // Toglie il connettivo iniziale ("Inoltre, la NATO…" -> "La NATO…")
  function smooth(code, text) {
    var re = get(code).lead;
    var m = re.exec(String(text).replace(/’/g, "'"));
    if (!m) return text;
    var rest = text.slice(m[0].length);
    if (rest.length < 12) return text;
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  // La frase comincia con un pronome che rimanda a quella prima? ("Questo portò…", "It was…")
  function isAnaphoric(code, t1, t2) {
    if (!t1) return false;
    var set1 = get(code).anaphoraSet;
    var a = fold(String(t1.text).replace(/’/g, "'"));
    if (set1.has(a)) return true;
    return !!(t2 && set1.has(a + ' ' + fold(t2.text)));
  }

  function stem(code, w) {
    if (code === 'de') {
      if (w.length < 5) return w;
      return w.replace(/(?:ern|en|er|es|e|n|s)$/, '');
    }
    if (code === 'pt') w = w.replace(/(?:oes|aes)$/, 'ao');
    if (w.length <= 4 || /ss$/.test(w)) return w;
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (code === 'fr' && /aux$/.test(w) && w.length > 5) return w.slice(0, -3) + 'al';
    if (code === 'fr') return w.replace(/(es|s|x|e)$/, '');
    return w.replace(/(es|s|[aeio])$/, '');
  }

  // Parola tedesca composta che finisce con una parola comune? (Kubakrise -> krise, Wettrüsten -> rüsten)
  function compoundKnown(code, f) {
    var m = rankMap(code);
    if (!m) return false;
    var w = f.replace(/(?:es|s|en|n|e)$/, '');
    for (var k = 2; k <= w.length - 4; k++) {
      if (m.has(w.slice(k)) || m.has(f.slice(k))) return true;
    }
    return false;
  }

  /*
   * Il termine definito da una frase di definizione, solo dalla struttura della frase:
   *  "La NATO è un'alleanza…" -> "NATO";  "Si definisce cortina di ferro la linea…" -> "cortina di ferro";
   *  "Als Eiserner Vorhang bezeichnet man…" -> "Eiserner Vorhang". Null se non è chiaro.
   */
  function defTerm(code, text) {
    var d = get(code), txt = String(text).replace(/’/g, "'"), term = null;
    var m2 = d.def2.exec(txt);
    if (m2 && m2.index < 90) {
      if (m2.index <= 2) {
        var rest = txt.slice(m2.index + m2[0].length).replace(/^\s*(?:come|comme|como|as|als)?\s+/i, '');
        var out = [];
        var parts = rest.replace(/^\s+/, '').split(/\s+/);
        for (var i = 0; i < parts.length && out.length < 7; i++) {
          var w = parts[i], clean = w.replace(/[,;:.!?)»”"]+$/, '');
          if (out.length && (d.articleSet.has(fold(clean)) || /^(?:l'|d')/i.test(clean) && code === 'fr')) break;
          if (!clean) break;
          out.push(clean);
          if (clean !== w) break;
        }
        term = out.join(' ');
      } else term = txt.slice(0, m2.index);
    } else {
      var m1 = d.def1.exec(txt);
      if (m1) term = m1[1];
    }
    if (!term) return null;
    term = term.replace(/^[\s«“"'(\[¿¡—–-]+|[\s,;:.»”")\]]+$/g, '');
    if (d.defPreRe) term = term.replace(d.defPreRe, '');
    term = term.replace(d.articleRe, '');
    var n = term.split(/\s+/).length;
    if (!term || n > 6 || term.length < 2) return null;
    return term;
  }

  function readability(code, c) {
    var d = get(code);
    var r = d.read(c);
    var v = Math.max(0, Math.min(100, r.value));
    var label = v >= r.cut[0] ? 'facile' : v >= r.cut[1] ? 'abbastanza facile' : v >= r.cut[2] ? 'difficile' : 'molto difficile';
    return { value: v, scale: r.scale, label: label };
  }

  g.WCLang = {
    CODES: CODES, CONNECT: CONNECT, data: L, get: get, fold: fold,
    detect: detect, hasFreq: hasFreq, rank: rank, rarity: rarity, ensure: ensure, setBase: setBase, base: getBase,
    smooth: smooth, isAnaphoric: isAnaphoric, stem: stem, readability: readability, defTerm: defTerm, compoundKnown: compoundKnown,
    names: function () { var o = {}; CODES.forEach(function (c) { o[c] = L[c].name; }); return o; }
  };
  if (typeof module === 'object' && module.exports) module.exports = g.WCLang;
})(globalThis);
