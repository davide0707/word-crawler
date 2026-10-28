// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: la lettura del codice (senza AI).
 *
 * Un file di codice non è prosa: dividerlo in paragrafi non serve a niente. Qui si legge la sua
 * struttura e se ne fa materiale per il cervello, con le stesse regole del resto dell'app —
 * statistica e grammatica, nessun modello.
 *
 * Come funziona, in tre passi:
 *  1. si maschera: stringhe e commenti vengono sostituiti con spazi in una copia della stessa
 *     lunghezza, così le espressioni regolari non trovano una "class" dentro una frase e le
 *     posizioni restano valide. I commenti si tengono da parte, con la loro riga;
 *  2. si riconosce: per famiglia di linguaggi (parentesi graffe, Python, Ruby, SQL, shell, fogli di
 *     stile, file di configurazione, notebook) si estraggono funzioni, classi, variabili globali,
 *     import, endpoint, tabelle e chiavi, ognuno con la riga esatta e il commento che lo precede;
 *  3. si collega: ogni chiamata dentro il corpo di una funzione diventa un arco "usa", ogni import
 *     un arco "dipende da", ogni classe figlia un arco "eredita da".
 * Il risultato esce anche come blocchi di testo, così il documento entra nel lettore, nella ricerca
 * e nella mappa come tutti gli altri.
 *
 * WCCode.is(name) -> true se l'estensione è di un file di codice
 * WCCode.parse(text, name) -> {
 *   lang, langName, symbols: [{ kind, name, line, endLine, doc, signature, params, exported, complexity }],
 *   imports: [{ what, from, line }], calls: [{ from, to, line }], todos: [{ tag, text, line }],
 *   stats: { lines, code, comment, blank, symbols, longest }, blocks: [...]
 * }
 */
(function (g) {
  'use strict';
  if (g.WCCode) return;

  // ---------------------------------------------------------------- linguaggi
  var LANGS = {
    js: ['JavaScript', 'braces'], mjs: ['JavaScript', 'braces'], cjs: ['JavaScript', 'braces'], jsx: ['JavaScript (JSX)', 'braces'],
    ts: ['TypeScript', 'braces'], tsx: ['TypeScript (TSX)', 'braces'],
    py: ['Python', 'python'], pyw: ['Python', 'python'],
    c: ['C', 'braces'], h: ['C', 'braces'], cpp: ['C++', 'braces'], cc: ['C++', 'braces'], cxx: ['C++', 'braces'], hpp: ['C++', 'braces'], hh: ['C++', 'braces'],
    ino: ['Arduino', 'braces'], java: ['Java', 'braces'], cs: ['C#', 'braces'], go: ['Go', 'braces'], rs: ['Rust', 'braces'],
    php: ['PHP', 'braces'], swift: ['Swift', 'braces'], kt: ['Kotlin', 'braces'], kts: ['Kotlin', 'braces'],
    rb: ['Ruby', 'ruby'], v: ['Verilog', 'braces'], sv: ['SystemVerilog', 'braces'],
    css: ['CSS', 'css'], scss: ['SCSS', 'css'], sass: ['Sass', 'css'], less: ['Less', 'css'],
    sql: ['SQL', 'sql'], sh: ['Shell', 'shell'], bash: ['Bash', 'shell'], zsh: ['Shell', 'shell'],
    json: ['JSON', 'data'], yaml: ['YAML', 'data'], yml: ['YAML', 'data'], toml: ['TOML', 'data'], ini: ['INI', 'data'], cfg: ['Config', 'data'],
    ipynb: ['Notebook Jupyter', 'notebook']
  };
  var EXT = Object.keys(LANGS);

  function ext(name) { var m = /\.([A-Za-z0-9]+)$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }
  function is(name) { return Object.prototype.hasOwnProperty.call(LANGS, ext(name)); }

  // parole che sembrano funzioni ma non lo sono
  var KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'typeof', 'new', 'delete', 'throw', 'do', 'else',
    'elif', 'with', 'and', 'or', 'not', 'in', 'is', 'lambda', 'await', 'yield', 'defined', 'using', 'namespace',
    'public', 'private', 'protected', 'static', 'const', 'let', 'var', 'func', 'def', 'fn', 'class', 'struct', 'enum', 'union', 'match', 'when', 'case', 'foreach', 'unless']);
  // funzioni che esistono per essere chiamate da fuori: non sono codice morto
  var ENTRY = new Set(['main', 'setup', 'loop', 'init', '__init__', '__main__', 'run', 'start', 'handler', 'default', 'constructor',
    'render', 'componentdidmount', 'oncreate', 'onstart', 'ready', 'activate', 'index', 'app', 'test', 'setup_module']);

  var KIND_IT = {
    function: 'funzione', method: 'metodo', class: 'classe', interface: 'interfaccia', struct: 'struttura', enum: 'enumerazione',
    variable: 'variabile', constant: 'costante', endpoint: 'endpoint', table: 'tabella', style: 'stile', setting: 'configurazione', cell: 'cella'
  };

  /*
   * Maschera stringhe e commenti: nella copia restano spazi, così offset e righe non cambiano.
   * Torna { masked, comments: [{ line, text, block }] }.
   */
  function mask(text, family) {
    var n = text.length, out = new Array(n), comments = [], ranges = [];
    var lineStarts = [0];
    for (var i = 0; i < n; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
    function lineOf(pos) {
      var lo = 0, hi = lineStarts.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; }
      return lo + 1;
    }
    var hash = family === 'python' || family === 'ruby' || family === 'shell' || (family === 'data');
    var slash = family === 'braces' || family === 'css' || family === 'data';
    var dashes = family === 'sql';
    var semi = family === 'data';
    var i2 = 0, prev = '';
    /*
     * Un'espressione regolare si riconosce da quello che la precede: dopo un valore la barra è una
     * divisione, dopo una parentesi aperta, una virgola, un uguale o un operatore è l'inizio di una
     * regex. Vanno mascherate come le stringhe, altrimenti un apostrofo dentro /["']/ fa credere che
     * cominci una stringa e si mangia il codice che segue.
     */
    function regexHere(at) {
      if (text[at] !== '/' || text[at + 1] === '/' || text[at + 1] === '*') return false;
      if (!prev) return true;
      if ('(,=:[!&|?{};+-*%~^<>'.indexOf(prev) >= 0) return true;
      return /\b(return|typeof|instanceof|in|of|case|do|else|yield|await|delete|void|new|throw|match|replace|split|search|test|exec)$/.test(before);
    }
    var before = '';
    while (i2 < n) {
      var c = text[i2], c2 = text[i2 + 1];
      if (family === 'braces' && c === '/' && regexHere(i2)) {
        var rs = i2;
        out[i2] = ' ';
        i2++;
        var inClass = false;
        while (i2 < n && text[i2] !== '\n') {
          var ch = text[i2];
          if (ch === '\\') { out[i2] = ' '; out[i2 + 1] = text[i2 + 1] === '\n' ? '\n' : ' '; i2 += 2; continue; }
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          out[i2] = ' ';
          i2++;
          if (ch === '/' && !inClass) break;
        }
        while (i2 < n && /[a-z]/.test(text[i2])) { out[i2] = ' '; i2++; } // i flag: g, i, m, u, y, s
        if (i2 > rs + 1) { ranges.push([rs, i2, 'str']); prev = '/'; before = ''; continue; }
      }
      // stringhe
      if (c === '"' || c === "'" || c === '`') {
        var triple = (family === 'python' || family === 'ruby') && c2 === c && text[i2 + 2] === c;
        var q = triple ? text.substr(i2, 3) : c, start = i2;
        out[i2] = ' ';
        i2 += q.length;
        while (i2 < n) {
          if (text[i2] === '\\') { out[i2] = ' '; out[i2 + 1] = text[i2 + 1] === '\n' ? '\n' : ' '; i2 += 2; continue; }
          if (text.substr(i2, q.length) === q) { for (var z = 0; z < q.length; z++) out[i2 + z] = ' '; i2 += q.length; break; }
          out[i2] = text[i2] === '\n' ? '\n' : ' ';
          i2++;
        }
        ranges.push([start, i2, triple ? 'com' : 'str']);
        prev = 'x'; before = '';
        // le stringhe lunghe di Python sono documentazione
        if (triple) comments.push({ line: lineOf(start), text: text.slice(start + 3, i2 - 3).trim(), block: true, doc: true });
        continue;
      }
      // commenti
      var kind = null;
      if (slash && c === '/' && c2 === '/') kind = 'line';
      else if (slash && c === '/' && c2 === '*') kind = 'block';
      else if (hash && c === '#' && !(family === 'braces')) kind = 'line';
      else if (dashes && c === '-' && c2 === '-') kind = 'line';
      else if (semi && c === ';') kind = 'line';
      else if (family === 'braces' && c === '#' && /^#\s*(include|define|ifdef|ifndef|endif|pragma|if|else|elif|undef|import)\b/.test(text.slice(i2, i2 + 20))) kind = null; // direttiva, non commento
      if (kind === 'line') {
        var s0 = i2;
        while (i2 < n && text[i2] !== '\n') { out[i2] = ' '; i2++; }
        comments.push({ line: lineOf(s0), text: text.slice(s0, i2).replace(/^[\/#;\-\s]+/, '').trim(), block: false });
        ranges.push([s0, i2, 'com']);
        continue;
      }
      if (kind === 'block') {
        var s1 = i2;
        while (i2 < n && !(text[i2] === '*' && text[i2 + 1] === '/')) { out[i2] = text[i2] === '\n' ? '\n' : ' '; i2++; }
        out[i2] = ' '; out[i2 + 1] = ' ';
        i2 += 2;
        var body = text.slice(s1 + 2, i2 - 2).replace(/^\*+/, '').split('\n').map(function (l) { return l.replace(/^\s*\*?\s?/, ''); }).join('\n').trim();
        comments.push({ line: lineOf(s1), text: body, block: true, doc: text[s1 + 2] === '*' });
        ranges.push([s1, i2, 'com']);
        continue;
      }
      out[i2] = c;
      if (!/\s/.test(c)) { prev = c; before = /[\w$]/.test(c) ? (before + c).slice(-12) : ''; }
      i2++;
    }
    for (var k = 0; k < n; k++) if (out[k] === undefined) out[k] = ' ';
    return { masked: out.join(''), comments: comments, ranges: ranges, lineOf: lineOf };
  }

  // il commento attaccato sopra una riga: è la documentazione di quel simbolo
  var TODO_RE = /^(TODO|FIXME|HACK|XXX|NOTE|BUG|OPTIMIZE)\b/i;
  function docFor(comments, line) {
    var best = null;
    comments.forEach(function (c) {
      if (!c.text || TODO_RE.test(c.text)) return;
      var d = line - c.line;
      if (c.block && d >= 0 && d <= 3) { if (!best || c.line > best.line) best = c; }
      else if (!c.block && (d === 1 || d === 0)) { if (!best || c.line > best.line) best = c; }
    });
    return best ? best.text.split('\n').slice(0, 6).join(' ').replace(/\s+/g, ' ').trim().slice(0, 400) : '';
  }

  // ---------------------------------------------------------------- riconoscimento dei simboli
  var RE = {
    jsFunc: /^[ \t]*(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/,
    jsArrow: /^[ \t]*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b[^(]*\(([^)]*)\)|\(([^)]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>)/,
    jsClass: /^[ \t]*(export\s+)?(?:default\s+)?(?:public\s+|abstract\s+|final\s+|sealed\s+|static\s+|internal\s+)*(class|interface|struct|enum|trait|record|protocol)\s+([A-Za-z_$][\w$]*)(?:\s*(?::|extends|implements|<:)\s*([A-Za-z_$][\w$.,<>\s]*))?/,
    goFunc: /^[ \t]*func\s*(?:\(\s*\w+\s+\*?([A-Za-z_]\w*)\s*\)\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/,
    rsFunc: /^[ \t]*(pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/,
    cFunc: /^[ \t]*(?:(?:static|inline|extern|virtual|const|unsigned|signed|public:|private:)\s+)*([A-Za-z_][\w:<>,\s\*&]*?[\s\*&])([A-Za-z_]\w*)\s*\(([^;{]*)\)\s*(?:const\s*)?(?:noexcept\s*)?\{/,
    method: /^[ \t]*(?:(?:public|private|protected|internal|static|final|override|virtual|abstract|async|suspend|open|operator|fun|def)\s+)+(?:[A-Za-z_][\w<>\[\].,\s]*\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)/,
    jsMethod: /^[ \t]{2,}(?:(?:static|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/,
    topVar: /^(?:export\s+)?(?:const|let|var|static|final|val)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/,
    cVar: /^[ \t]*(?:static\s+|const\s+|volatile\s+|extern\s+)*([A-Za-z_][\w:<>]*)\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;/,
    define: /^[ \t]*#\s*define\s+([A-Za-z_]\w*)/,
    pyDef: /^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/,
    pyClass: /^([ \t]*)class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/,
    rbDef: /^([ \t]*)def\s+([A-Za-z_][\w.?!]*)\s*(?:\(([^)]*)\))?/,
    rbClass: /^([ \t]*)(class|module)\s+([A-Za-z_][\w:]*)(?:\s*<\s*([A-Za-z_][\w:]*))?/,
    sqlTable: /^[ \t]*create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?(table|view|index|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?[`"\[]?([\w.]+)/i,
    sqlProc: /^[ \t]*create\s+(?:or\s+replace\s+)?(function|procedure|trigger)\s+[`"\[]?([\w.]+)/i,
    shFunc: /^[ \t]*(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{/,
    cssRule: /^([.#]?[A-Za-z_\-][\w\-]*(?:[^{;]*?))\s*\{/,
    cssVar: /^[ \t]*(\$[\w\-]+|--[\w\-]+)\s*:/,
    endpoint: /(?:\.(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)|@(?:Get|Post|Put|Patch|Delete|Request)Mapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)|@(?:app|bp|router)\.route\s*\(\s*['"]([^'"]+))/i
  };

  var IMPORTS = [
    [/^[ \t]*import\s+(?:([\w{}\s,*]+?)\s+from\s+)?['"]([^'"]+)['"]/, 1, 2],
    [/^[ \t]*(?:const|let|var)\s+([\w{}\s,:]+?)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]/, 1, 2],
    [/^[ \t]*#\s*include\s*[<"]([^>"]+)[>"]/, null, 1],
    [/^[ \t]*from\s+([\w.]+)\s+import\s+(.+)$/, 2, 1],
    [/^[ \t]*import\s+([\w.,\s]+)$/, 1, 1],
    [/^[ \t]*use\s+([\w:{}\s,*]+);/, 1, 1],
    [/^[ \t]*require(?:_relative)?\s+['"]([^'"]+)['"]/, null, 1],
    [/^[ \t]*@import\s+(?:url\()?['"]?([^'")]+)/, null, 1],
    [/^[ \t]*source\s+(\S+)/, null, 1]
  ];

  function params(s) {
    return String(s || '').split(',').map(function (p) {
      var t = p.trim().replace(/=.*$/, '').replace(/:.*$/, '').replace(/^[\w<>\[\]*&:]+\s+(?=[A-Za-z_])/, '').trim();
      return t.replace(/^[*&.]+/, '');
    }).filter(function (p) { return p && /^[A-Za-z_$][\w$]*$/.test(p); }).slice(0, 12);
  }
  function complexity(body) {
    var m = body.match(/\b(if|for|while|case|catch|elif|when|unless|rescue)\b|&&|\|\||\?\s*[^:]/g);
    return 1 + (m ? m.length : 0);
  }

  /*
   * Dove finisce un simbolo: con le graffe si contano le parentesi, con Python e Ruby si guarda
   * l'indentazione (o la parola "end"). Serve per sapere quali chiamate stanno dentro quale funzione.
   */
  function endByBraces(lines, from) {
    var depth = 0, started = false;
    for (var i = from; i < lines.length && i < from + 4000; i++) {
      for (var j = 0; j < lines[i].length; j++) {
        var c = lines[i][j];
          if (c === '{') { depth++; started = true; } else if (c === '}') { depth--; if (started && depth <= 0) return i + 1; }
      }
      if (started && depth <= 0) return i + 1;
    }
    return Math.min(lines.length, from + 200);
  }
  function endByIndent(lines, from, indent) {
    for (var i = from + 1; i < lines.length; i++) {
      var l = lines[i];
      if (!l.trim()) continue;
      var ind = /^[ \t]*/.exec(l)[0].length;
      if (ind <= indent) return i;
    }
    return lines.length;
  }

  // ---------------------------------------------------------------- lettura
  function parse(text, name) {
    var e = ext(name), meta = LANGS[e] || ['Codice', 'braces'];
    var family = meta[1];
    if (family === 'notebook') return parseNotebook(text, name);
    var src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    var m = mask(src, family);
    var lines = src.split('\n'), mlines = m.masked.split('\n');
    var symbols = [], imports = [], todos = [], seen = new Set();

    function add(kind, nm, line, extra) {
      if (!nm || KEYWORDS.has(nm.toLowerCase())) return null;
      var key = kind + ':' + nm + ':' + line;
      if (seen.has(key)) return null;
      seen.add(key);
      var s = Object.assign({ kind: kind, name: nm, line: line, endLine: line, doc: docFor(m.comments, line), params: [], exported: false, complexity: 1 }, extra || {});
      symbols.push(s);
      return s;
    }

    m.comments.forEach(function (c) {
      var t = /^(TODO|FIXME|HACK|XXX|NOTE|BUG|OPTIMIZE)\b[:\s-]*(.*)$/i.exec(c.text);
      if (t) todos.push({ tag: t[1].toUpperCase(), text: t[2].trim().slice(0, 200) || c.text.slice(0, 200), line: c.line });
    });

    for (var i = 0; i < mlines.length; i++) {
      var L = mlines[i], raw = lines[i], no = i + 1, r;
      if (!L.trim()) continue;
      // import e inclusioni: si leggono sulla riga vera, perché il nome del modulo è dentro una
      // stringa e nella copia mascherata le stringhe non ci sono più (le righe di commento sono già saltate)
      for (var k = 0; k < IMPORTS.length; k++) {
        r = IMPORTS[k][0].exec(raw);
        if (r) {
          var from = (r[IMPORTS[k][2]] || '').trim();
          if (from && from.length < 200) imports.push({ what: (IMPORTS[k][1] ? (r[IMPORTS[k][1]] || '') : '').replace(/[{}]/g, '').trim().slice(0, 120), from: from, line: no });
          break;
        }
      }
      if (family === 'python') {
        if ((r = RE.pyClass.exec(L))) { var pc = add('class', r[2], no, { base: (r[3] || '').split(',')[0].trim() }); if (pc) pc.endLine = endByIndent(lines, i, r[1].length); continue; }
        if ((r = RE.pyDef.exec(L))) {
          var pf = add(r[1].length ? 'method' : 'function', r[2], no, { params: params(r[3]), exported: r[2][0] !== '_' });
          if (pf) { pf.endLine = endByIndent(lines, i, r[1].length); pf.signature = r[2] + '(' + (r[3] || '') + ')'; }
          continue;
        }
        if (/^[A-Z_][A-Z0-9_]*\s*=/.test(L)) { add('constant', /^([A-Z_][A-Z0-9_]*)/.exec(L)[1], no); continue; }
        if (/^[a-z_]\w*\s*=/.test(L) && !/==/.test(L)) { add('variable', /^([a-z_]\w*)/.exec(L)[1], no); continue; }
      } else if (family === 'ruby') {
        if ((r = RE.rbClass.exec(L))) { add('class', r[3], no, { base: r[4] || '' }); continue; }
        if ((r = RE.rbDef.exec(L))) { var rf = add('method', r[2], no, { params: params(r[3]) }); if (rf) rf.signature = r[2] + '(' + (r[3] || '') + ')'; continue; }
      } else if (family === 'sql') {
        if ((r = RE.sqlTable.exec(L))) { add('table', r[2], no, { sub: r[1].toLowerCase() }); continue; }
        if ((r = RE.sqlProc.exec(L))) { add('function', r[2], no, { sub: r[1].toLowerCase() }); continue; }
      } else if (family === 'shell') {
        if ((r = RE.shFunc.exec(L))) { var sf = add('function', r[1], no); if (sf) sf.endLine = endByBraces(mlines, i); continue; }
        if (/^[A-Za-z_]\w*=/.test(L)) { add('variable', /^([A-Za-z_]\w*)/.exec(L)[1], no); continue; }
      } else if (family === 'css') {
        if ((r = RE.cssVar.exec(L))) { add('constant', r[1], no); continue; }
        if ((r = RE.cssRule.exec(L)) && !/^\s*@(media|supports|keyframes|font-face)/.test(L)) {
          var sel = r[1].trim().replace(/\s+/g, ' ').slice(0, 80);
          if (sel && !/[;{}]/.test(sel)) { var cs = add('style', sel, no); if (cs) cs.endLine = endByBraces(mlines, i); }
          continue;
        }
      } else if (family === 'data') {
        var dk = /^[ \t]{0,2}["']?([A-Za-z_][\w.\-]*)["']?\s*[:=]/.exec(L) || /^\[([^\]]+)\]/.exec(L);
        if (dk) add('setting', dk[1], no);
        continue;
      } else {
        if ((r = RE.jsClass.exec(L))) { var jc = add('class', r[3], no, { sub: r[2], base: (r[4] || '').split(',')[0].trim(), exported: !!r[1] }); if (jc) jc.endLine = endByBraces(mlines, i); continue; }
        if ((r = RE.jsFunc.exec(L))) { var jf = add('function', r[2], no, { params: params(r[3]), exported: !!r[1], signature: r[2] + '(' + r[3] + ')' }); if (jf) jf.endLine = endByBraces(mlines, i); continue; }
        if ((r = RE.jsArrow.exec(L))) { var ja = add('function', r[2], no, { params: params(r[3] || r[4] || r[5]), exported: !!r[1], signature: r[2] + '(' + (r[3] || r[4] || r[5] || '') + ')' }); if (ja) ja.endLine = endByBraces(mlines, i); continue; }
        if ((r = RE.goFunc.exec(L))) { var gf = add(r[1] ? 'method' : 'function', r[2], no, { params: params(r[3]), exported: /^[A-Z]/.test(r[2]), owner: r[1] || '', signature: r[2] + '(' + r[3] + ')' }); if (gf) gf.endLine = endByBraces(mlines, i); continue; }
        if ((r = RE.rsFunc.exec(L))) { var rsf = add('function', r[2], no, { params: params(r[3]), exported: !!r[1], signature: r[2] + '(' + r[3] + ')' }); if (rsf) rsf.endLine = endByBraces(mlines, i); continue; }
        if ((r = RE.define.exec(L))) { add('constant', r[1], no); continue; }
        if ((r = RE.cFunc.exec(L)) && !KEYWORDS.has(r[2].toLowerCase())) { var cf = add('function', r[2], no, { params: params(r[3]), returns: r[1].trim(), signature: (r[1] || '').trim() + ' ' + r[2] + '(' + r[3] + ')' }); if (cf) cf.endLine = endByBraces(mlines, i); continue; }
        if ((r = RE.jsMethod.exec(L)) && !KEYWORDS.has(r[1].toLowerCase())) { var jm = add('method', r[1], no, { params: params(r[2]), signature: r[1] + '(' + r[2] + ')' }); if (jm) jm.endLine = endByBraces(mlines, i); continue; }
        if ((r = RE.method.exec(L)) && !KEYWORDS.has(r[1].toLowerCase())) { var mm = add('method', r[1], no, { params: params(r[2]), signature: r[1] + '(' + r[2] + ')' }); if (mm) mm.endLine = endByBraces(mlines, i); continue; }
        if (/^[ \t]{0,2}/.test(L) && (r = RE.topVar.exec(L.replace(/^[ \t]+/, '')))) { if (!/^[ \t]{3,}/.test(L)) add(/^[A-Z_][A-Z0-9_]*$/.test(r[1]) ? 'constant' : 'variable', r[1], no, { exported: /^export/.test(L.trim()) }); continue; }
        if ((r = RE.cVar.exec(L)) && !KEYWORDS.has(r[1].toLowerCase()) && !/^[ \t]{3,}/.test(L)) { add('variable', r[2], no, { ctype: r[1] }); continue; }
      }
      // endpoint di un servizio web
      var ep = RE.endpoint.exec(raw);
      if (ep) add('endpoint', ((ep[1] || 'route').toUpperCase() + ' ' + (ep[2] || ep[3] || ep[4])).slice(0, 80), no);
    }

    symbols.sort(function (a, b) { return a.line - b.line; });
    // complessità e corpo di ogni funzione
    symbols.forEach(function (s) {
      if (s.kind !== 'function' && s.kind !== 'method') return;
      s.complexity = complexity(mlines.slice(s.line - 1, s.endLine).join('\n'));
    });

    // chiamate: chi usa chi, attribuite alla funzione che le contiene
    var funcs = symbols.filter(function (s) { return s.kind === 'function' || s.kind === 'method'; });
    var byName = new Map();
    symbols.forEach(function (s) { if (!byName.has(s.name)) byName.set(s.name, s); });
    var calls = [], callSeen = new Set();
    var CALL = /([A-Za-z_$][\w$]*)\s*\(/g;
    for (var li = 0; li < mlines.length; li++) {
      var owner = null;
      for (var f = 0; f < funcs.length; f++) if (funcs[f].line <= li + 1 && li + 1 <= funcs[f].endLine) { if (!owner || funcs[f].line > owner.line) owner = funcs[f]; }
      CALL.lastIndex = 0;
      var mm2;
      while ((mm2 = CALL.exec(mlines[li]))) {
        var nm2 = mm2[1];
        if (KEYWORDS.has(nm2.toLowerCase())) continue;
        if (owner && owner.name === nm2 && owner.line === li + 1) continue;
        var def = byName.get(nm2);
        if (def && def.line === li + 1) continue;
        var ck = (owner ? owner.name : '') + '>' + nm2;
        if (callSeen.has(ck)) continue;
        callSeen.add(ck);
        calls.push({ from: owner ? owner.name : null, to: nm2, line: li + 1, known: !!def });
      }
    }

    // dove compare ogni nome: una variabile letta altrove non è codice morto
    var usage = {}, names = new Set();
    symbols.forEach(function (s2) { names.add(s2.name); });
    var WORD = /[A-Za-z_$][\w$]*/g;
    for (var ui = 0; ui < mlines.length; ui++) {
      WORD.lastIndex = 0;
      var w;
      while ((w = WORD.exec(mlines[ui]))) {
        if (!names.has(w[0])) continue;
        if (!usage[w[0]]) usage[w[0]] = [];
        if (usage[w[0]].length < 200 && usage[w[0]][usage[w[0]].length - 1] !== ui + 1) usage[w[0]].push(ui + 1);
      }
    }

    var blank = 0, comment = 0;
    var commentLines = new Set();
    m.comments.forEach(function (c) { commentLines.add(c.line); });
    lines.forEach(function (l, idx) { if (!l.trim()) blank++; else if (commentLines.has(idx + 1) && !mlines[idx].trim()) comment++; });
    var stats = {
      lines: lines.length, blank: blank, comment: comment, code: lines.length - blank - comment,
      symbols: symbols.length, imports: imports.length, todos: todos.length,
      longest: funcs.reduce(function (a, s) { return Math.max(a, s.endLine - s.line + 1); }, 0),
      maxComplexity: funcs.reduce(function (a, s) { return Math.max(a, s.complexity); }, 0)
    };

    return {
      lang: e, langName: meta[0], family: family, symbols: symbols, imports: imports, calls: calls, todos: todos,
      stats: stats, usage: usage, blocks: blocks(lines, symbols, imports, todos, meta[0], name), lines: lines
    };
  }

  // un notebook: celle di codice e celle di testo
  function parseNotebook(text, name) {
    var nb;
    try { nb = JSON.parse(text); } catch (e) { nb = null; }
    if (!nb || !Array.isArray(nb.cells)) return parse('', name.replace(/\.ipynb$/, '.py'));
    var code = [], md = [];
    nb.cells.forEach(function (c) {
      var src = Array.isArray(c.source) ? c.source.join('') : String(c.source || '');
      if (c.cell_type === 'code') code.push(src);
      else if (c.cell_type === 'markdown') md.push(src);
    });
    var out = parse(code.join('\n\n'), 'notebook.py');
    out.lang = 'ipynb';
    out.langName = 'Notebook Jupyter';
    md.forEach(function (t, i) {
      out.blocks.unshift({ type: 'p', text: t.replace(/[#*`>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000) });
      if (i === 0) out.blocks.unshift({ type: 'h', level: 2, text: 'Testo del notebook' });
    });
    return out;
  }

  /*
   * I blocchi di testo: servono perché un file di codice entri nel lettore, nella ricerca e nella
   * mappa come qualunque altro documento. Un blocco per simbolo (firma, commento, corpo), più le
   * dipendenze e le cose da fare.
   */
  function blocks(lines, symbols, imports, todos, langName, name) {
    // niente intestazione col nome del file: il titolo del documento ce l'ha già, e finirebbe tra i concetti
    var out = [{ type: 'note', text: langName + ' · ' + lines.length + ' righe · ' + symbols.length + ' elementi' }];
    if (imports.length) {
      out.push({ type: 'h', level: 2, text: 'Dipendenze' });
      imports.slice(0, 200).forEach(function (im) { out.push({ type: 'li', text: im.from + (im.what ? ' (' + im.what + ')' : '') }); });
    }
    symbols.slice(0, 500).forEach(function (s) {
      out.push({ type: 'h', level: 2, text: (KIND_IT[s.kind] || s.kind) + ' ' + (s.signature || s.name), line: s.line });
      if (s.doc) out.push({ type: 'p', text: s.doc, line: s.line });
      var body = lines.slice(s.line - 1, Math.min(s.endLine, s.line + 120)).join('\n').trim();
      if (body) out.push({ type: 'pre', text: body.slice(0, 4000), line: s.line });
    });
    if (todos.length) {
      out.push({ type: 'h', level: 2, text: 'Da fare' });
      todos.slice(0, 200).forEach(function (t) { out.push({ type: 'li', text: t.tag + ': ' + t.text + ' (riga ' + t.line + ')', line: t.line }); });
    }
    if (!symbols.length) {
      out.push({ type: 'h', level: 2, text: 'Contenuto' });
      out.push({ type: 'pre', text: lines.join('\n').slice(0, 40000) });
    }
    return out;
  }

  /*
   * Codice morto: un elemento che nessuno chiama, che non viene esportato e che non è un punto di
   * ingresso. Si guarda tutta la libreria, non il singolo file: una funzione usata altrove è viva.
   */
  function dead(files) {
    var called = new Set(), exported = new Set(), defined = new Map(), elsewhere = new Map();
    (files || []).forEach(function (f) {
      (f.calls || []).forEach(function (c) { called.add(c.to); });
      (f.imports || []).forEach(function (im) { String(im.what || '').split(/[,\s]+/).forEach(function (w) { if (w) called.add(w); }); });
      (f.symbols || []).forEach(function (s) {
        if (s.exported) exported.add(s.name);
        if (!defined.has(s.name)) defined.set(s.name, []);
        defined.get(s.name).push({ file: f.name, path: f.path, doc: f.doc, symbol: s, usage: (f.usage || {})[s.name] || [], own: f });
      });
    });
    // un nome definito in un file e nominato in un altro è vivo
    (files || []).forEach(function (f) {
      Object.keys(f.usage || {}).forEach(function (nm) { if (!elsewhere.has(nm)) elsewhere.set(nm, new Set()); elsewhere.get(nm).add(f.name); });
    });
    var out = [];
    defined.forEach(function (list, nm) {
      if (called.has(nm) || exported.has(nm) || ENTRY.has(nm.toLowerCase())) return;
      if ((elsewhere.get(nm) || new Set()).size > 1) return;
      list.forEach(function (d) {
        var s = d.symbol;
        // compare solo dove è dichiarato (o dentro sé stesso): nessuno lo usa
        var outside = d.usage.filter(function (ln) { return ln < s.line || ln > (s.endLine || s.line); });
        if (outside.length) return;
        if (s.kind !== 'function' && s.kind !== 'method' && s.kind !== 'class' && s.kind !== 'constant' && s.kind !== 'variable') return;
        if (/^_/.test(nm) && s.kind !== 'function') return;
        out.push({ name: nm, kind: s.kind, file: d.file, path: d.path, doc: d.doc, line: s.line });
      });
    });
    out.sort(function (a, b) { return a.file.localeCompare(b.file) || a.line - b.line; });
    return out;
  }

  /*
   * Parole del linguaggio, non concetti: in un file di codice "void", "return" o "public" compaiono
   * ovunque e l'analisi statistica le prenderebbe per parole chiave. Si escludono dai concetti, a meno
   * che non siano il nome di qualcosa che l'utente ha scritto.
   */
  var STOP = new Set((
    'void int float double char bool boolean long short unsigned signed string str list dict set tuple byte bytes object any never unknown ' +
    'var let const static final val public private protected internal abstract virtual override sealed extern inline friend mutable volatile register ' +
    'return if else for while do switch case default break continue goto try catch finally throw throws raise except pass yield await async ' +
    'class struct enum union interface trait impl trait protocol extension namespace module package import export from require include define ' +
    'function func def fn lambda new delete this self super null nil none true false undefined nan ' +
    'print println printf echo log console size length count index value key item data result value1 temp tmp foo bar ' +
    'select insert update delete create table view where from join group order limit values into set primary foreign not and or as on ' +
    'begin end then elif fi esac done local export unset shift read exit sudo ' +
    'funzione metodo classe interfaccia struttura enumerazione variabile costante endpoint tabella stile configurazione cella dipendenze righe elementi fare'
  ).split(' ').filter(Boolean));

  /*
   * Evidenziazione del codice: si riusa la stessa mascheratura che serve a leggerlo, così commenti e
   * stringhe sono già individuati con esattezza invece che indovinati. Torna un elenco di pezzi
   * [testo, tipo] con tipo fra 'com', 'str', 'kw', 'num', 'fn' e '' (normale): chi disegna ci mette
   * i colori che vuole, senza passare da innerHTML.
   */
  var HL_KW = new Set(('if else for while do switch case default break continue return function func def fn class struct enum interface ' +
    'const let var static public private protected new delete this self super import export from require include package namespace using ' +
    'try catch finally throw throws async await yield lambda pass with as in is not and or void int float double char bool boolean string ' +
    'true false null nil none undefined end then elif unless module trait impl pub fn let mut match where select insert update create table').split(' '));
  function highlight(text, name) {
    var family = (LANGS[ext(name)] || ['', 'braces'])[1];
    var src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    var m = mask(src, family === 'notebook' ? 'python' : family);
    var out = [], at = 0;
    function push(t, kind) {
      if (!t) return;
      var last = out[out.length - 1];
      if (last && last[1] === kind) last[0] += t; else out.push([t, kind]);
    }
    function plain(from, to) {
      var s2 = src.slice(from, to), i = 0;
      while (i < s2.length) {
        var w = /^[A-Za-z_$][\w$]*/.exec(s2.slice(i));
        if (w) {
          var word = w[0];
          i += word.length;
          push(word, HL_KW.has(word.toLowerCase()) ? 'kw' : (/^\s*\(/.test(s2.slice(i)) ? 'fn' : ''));
          continue;
        }
        var num = /^\d[\w.]*/.exec(s2.slice(i));
        if (num) { push(num[0], 'num'); i += num[0].length; continue; }
        push(s2[i], '');
        i++;
      }
    }
    m.ranges.sort(function (a, b) { return a[0] - b[0]; });
    m.ranges.forEach(function (r) {
      if (r[0] < at) return;
      plain(at, r[0]);
      push(src.slice(r[0], r[1]), r[2]);
      at = r[1];
    });
    plain(at, src.length);
    return out;
  }

  g.WCCode = { is: is, parse: parse, ext: ext, dead: dead, highlight: highlight, EXT: EXT, LANGS: LANGS, KIND_IT: KIND_IT, ENTRY: ENTRY, STOP: STOP };
})(globalThis);
