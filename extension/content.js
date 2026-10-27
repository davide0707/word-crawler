// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler (estensione): il ragno sulle pagine web.
 * Riceve i comandi dal pannello laterale, legge il testo principale della pagina,
 * lo analizza (senza AI) e manda al pannello avanzamento e risultati.
 * Gestisce anche la penna (segni a mano) e i segni ritrovati sulle pagine salvate.
 */
(function () {
  'use strict';
  var g = globalThis;
  if (g.__wcContent) return;
  g.__wcContent = true;

  var engine = null, state = null, lastSent = 0, pen = null, badge = null;

  // ---- tema scuro sulle pagine chiare (come nel video)
  function bgColor(el) {
    var c = getComputedStyle(el).backgroundColor;
    var m = c && c.match(/[\d.]+/g);
    if (!m) return null;
    if ((m.length > 3 ? +m[3] : 1) < 0.1) return null;
    return [+m[0], +m[1], +m[2]];
  }
  var themeStyle = null;
  function setDark(v) {
    if (v && !themeStyle) {
      var bg = bgColor(document.body) || bgColor(document.documentElement) || [255, 255, 255];
      var inv = bg.map(function (x) { return Math.round(0.9 * (255 - x) + 0.1 * x); });
      themeStyle = document.createElement('style');
      themeStyle.setAttribute('data-word-crawler', '');
      themeStyle.textContent = 'html{background:rgb(' + inv.join(',') + ')!important}body{filter:invert(.9) hue-rotate(180deg)!important}' +
        'body img,body video,body picture,body canvas,body iframe,body embed,body object,body svg image,body [style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}';
    }
    if (v) document.documentElement.appendChild(themeStyle);
    else if (themeStyle) themeStyle.remove();
  }
  function pageIsLight() {
    var bg = bgColor(document.body) || bgColor(document.documentElement) || [255, 255, 255];
    return (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 > 0.5;
  }

  function send(msg) { try { chrome.runtime.sendMessage(msg).catch(function () {}); } catch (e) { /* pannello chiuso */ } }
  function visual(s) { return { speed: s.speed, legs: s.legs, webDensity: s.webDensity, veil: s.veil, theme: s.theme, hud: s.hud, follow: s.follow }; }

  function collectTokens() {
    var root = g.WCDom.pickRoot();
    var tokens = g.WCDom.collect(root, { max: 200000 });
    var h1 = document.querySelector('h1');
    if (h1 && !root.contains(h1)) tokens = g.WCDom.collect(h1).concat(tokens);
    return tokens;
  }

  // penna: una sola per pagina, lavora con il motore attivo
  function ensurePen() {
    if (pen) return pen;
    pen = g.WCPen.attach({
      engine: function () { return engine && engine.isActive() ? engine : null; },
      tokens: function () { return state ? state.tokens : []; },
      marks: state ? state.userMarks : [],
      onChange: function (marks) { if (state) state.userMarks = marks; send({ type: 'wc:marks', marks: marks }); },
      onTool: function (t) { send({ type: 'wc:pen-tool', tool: t }); }
    });
    return pen;
  }

  /*
   * opts: { static: true per i segni ritrovati (niente ragno), userMarks, keep: evidenziazioni da tenere }
   */
  function start(raw, opts) {
    opts = opts || {};
    if (engine && engine.isActive()) engine.stop();
    var settings = g.WCSettings.sanitize(raw);
    var tokens = collectTokens();
    if (!tokens.length) { send({ type: 'wc:error', message: 'Su questa pagina non ho trovato testo da leggere.' }); return false; }
    var res = g.WCAnalysis.analyze(tokens, settings);
    if (opts.keep) keepOnly(tokens, res, opts.keep);
    var firstIdx = [], seen = new Set();
    tokens.forEach(function (t, i) { if (t.kid && !seen.has(t.kid)) { seen.add(t.kid); firstIdx.push([t.kid, i]); } });
    var host = (location.hostname || 'pagina').replace(/^www\./, '').toUpperCase();
    var userMarks = opts.userMarks ? g.WCPen.relocate(tokens, opts.userMarks) : (state && state.tokens.length === tokens.length ? state.userMarks : []);
    state = {
      results: res.results, plan: res.plan,
      doc: { title: document.title || location.hostname, source: location.href, format: 'Pagina web' },
      total: tokens.length, firstIdx: firstIdx, processed: 0, ended: false, tokens: tokens, userMarks: userMarks || [], restored: !!opts.static
    };
    if (settings.theme === 'night' && pageIsLight() && !opts.static) setDark(true);
    send({ type: 'wc:begin', results: state.results, doc: state.doc, total: state.total, firstIdx: firstIdx, userMarks: state.userMarks, restored: state.restored });
    var summaryTotal = res.results.summary.length;
    engine = g.WCEngine.start({
      tokens: tokens, sentences: res.plan.sentences, display: res.plan.display, settings: visual(settings), keys: !opts.static,
      static: !!opts.static, userMarks: state.userMarks,
      label: function () { return 'SITE -- ' + host; },
      modeLine: function (c) {
        if (settings.mode === 'study') return 'UNDERLINED ' + String(c.key).padStart(3, '0') + ' · DEFINITIONS ' + String(c.def).padStart(3, '0');
        if (settings.mode === 'summary') return 'SUMMARY ' + String(c.key).padStart(3, '0') + ' / ' + String(summaryTotal).padStart(3, '0');
        if (settings.mode === 'search') return 'MATCHES ' + String(c.term).padStart(3, '0');
        return null;
      },
      onProgress: function (n) {
        state.processed = n;
        var now = Date.now();
        if (now - lastSent > 200 || n === state.total) { lastSent = now; send({ type: 'wc:progress', processed: n, total: state.total }); }
      },
      onEnd: function () { state.ended = true; send({ type: 'wc:end' }); },
      onStop: function () { setDark(false); if (pen) pen.setTool(null); hideBadge(); send({ type: 'wc:stopped' }); }
    });
    ensurePen().setMarks(state.userMarks);
    return true;
  }

  // segni ritrovati: si tengono solo le evidenziazioni che l'utente aveva scelto di salvare
  function keepOnly(tokens, res, keep) {
    var want = new Set(keep);
    var sents = res.plan.sentences;
    sents.forEach(function (s) { if (s.mk && !want.has(s.mk + ':' + s.text)) s.mk = null; });
    var names = new Set(), nums = new Set();
    keep.forEach(function (k) { var i = k.indexOf(':'); if (k.slice(0, i) === 'name') names.add(k.slice(i + 1)); if (k.slice(0, i) === 'num') nums.add(k.slice(i + 1)); });
    tokens.forEach(function (t) {
      if (t.mk === 'num' && !nums.has(t.text)) t.mk = null;
      if (t.mk === 'ring-green' && t.kid && !names.has(res.plan.display(t.kid))) t.mk = null;
    });
  }

  // ---- etichetta "segni ritrovati" sulla pagina
  function showBadge(entry) {
    hideBadge();
    badge = document.createElement('div');
    badge.setAttribute('data-word-crawler', '');
    badge.setAttribute('data-wc-ui', '');
    badge.setAttribute('role', 'status');
    badge.style.cssText = 'position:fixed!important;z-index:2147483647!important;right:16px!important;bottom:16px!important;max-width:360px!important;' +
      'background:#2f4bff!important;color:#fff!important;border-radius:10px!important;padding:10px 12px!important;box-shadow:0 8px 24px rgba(0,0,0,.3)!important;' +
      'font:600 13px/1.4 system-ui,sans-serif!important;display:flex!important;gap:10px!important;align-items:center!important';
    var txt = document.createElement('span');
    var d = '';
    try { d = new Date(entry.date).toLocaleDateString('it-IT'); } catch (e) { /* data facoltativa */ }
    txt.textContent = 'Word Crawler: segni ritrovati' + (d ? ' (lettura del ' + d + ')' : '');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Nascondi';
    btn.style.cssText = 'border:0!important;border-radius:6px!important;padding:5px 10px!important;background:#fff!important;color:#2f4bff!important;font:600 12px system-ui,sans-serif!important;cursor:pointer!important';
    btn.addEventListener('click', function () { if (engine) engine.stop(); hideBadge(); });
    badge.appendChild(txt); badge.appendChild(btn);
    document.documentElement.appendChild(badge);
  }
  function hideBadge() { if (badge) { badge.remove(); badge = null; } }

  function jump(idx) {
    var t = state && state.tokens[idx];
    var r = t && t.rect();
    if (!r) return;
    if (engine && engine.isRunning()) engine.pause();
    window.scrollTo(window.scrollX, Math.max(0, r.y - window.innerHeight * 0.4));
    var mark = document.createElement('div');
    mark.setAttribute('data-word-crawler', '');
    mark.style.cssText = 'position:absolute;z-index:2147483645;pointer-events:none;border:2px solid #ff8a3d;border-radius:6px;transition:opacity 1.4s;' +
      'left:' + (r.x - 6) + 'px;top:' + (r.y - 4) + 'px;width:' + (r.w + 12) + 'px;height:' + (r.h + 8) + 'px';
    document.body.appendChild(mark);
    setTimeout(function () { mark.style.opacity = '0'; }, 200);
    setTimeout(function () { mark.remove(); }, 1700);
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, reply) {
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'wc:start': hideBadge(); start(msg.settings); reply({ ok: true }); break;
      case 'wc:toggle': if (engine && engine.isActive()) engine.stop(); else start(msg.settings); reply({ ok: true }); break;
      case 'wc:restore':
        // non si disturba una lettura in corso
        if (engine && engine.isActive()) { reply({ ok: false }); break; }
        if (start(msg.entry.settings, { static: true, userMarks: msg.entry.userMarks, keep: msg.entry.keep })) showBadge(msg.entry);
        reply({ ok: true });
        break;
      case 'wc:stop': if (engine) engine.stop(); reply({ ok: true }); break;
      case 'wc:pause': if (engine) engine.toggle(); reply({ ok: true, running: !!(engine && engine.isRunning()) }); break;
      case 'wc:finish': if (engine) engine.finish(); reply({ ok: true }); break;
      case 'wc:visual':
        if (engine && engine.isActive()) {
          engine.setSettings(visual(msg.settings));
          setDark(msg.settings.theme === 'night' && pageIsLight() && !state.restored);
        }
        reply({ ok: true });
        break;
      case 'wc:jump': jump(msg.idx); reply({ ok: true }); break;
      case 'wc:pen':
        if (!state) { reply({ ok: false }); break; }
        if (msg.tool && (!engine || !engine.isActive())) {
          // il ragno era stato tolto: i segni tornano senza animazione
          engine = g.WCEngine.start({ tokens: state.tokens, sentences: state.plan.sentences, display: state.plan.display, settings: visual(g.WCSettings.sanitize(msg.settings || state.results.settings)),
            static: true, userMarks: state.userMarks, onStop: function () { if (pen) pen.setTool(null); send({ type: 'wc:stopped' }); } });
        }
        if (msg.tool && engine.isRunning()) engine.pause();
        ensurePen().setTool(msg.tool || null);
        reply({ ok: true });
        break;
      case 'wc:mark-remove': if (pen) pen.remove(msg.id); reply({ ok: true }); break;
      case 'wc:mark-edit': if (pen) pen.edit(msg.id); reply({ ok: true }); break;
      case 'wc:annotated':
        reply(state ? g.WCAnnotate.capture(state.tokens, state.plan.sentences, state.userMarks) : null);
        break;
      case 'wc:state':
        reply(state ? { results: state.results, doc: state.doc, total: state.total, firstIdx: state.firstIdx, processed: state.processed, ended: state.ended,
          active: !!(engine && engine.isActive()), running: !!(engine && engine.isRunning()), userMarks: state.userMarks, restored: state.restored } : null);
        break;
    }
  });
})();
