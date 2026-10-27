/*
 * Word Crawler (estensione): il ragno sulle pagine web.
 * Riceve i comandi dal pannello laterale, legge il testo principale della pagina,
 * lo analizza (senza AI) e manda al pannello avanzamento e risultati.
 */
(function () {
  'use strict';
  var g = globalThis;
  if (g.__wcContent) return;
  g.__wcContent = true;

  var engine = null, state = null, lastSent = 0;

  // ---- tema scuro sulle pagine chiare (come nel video)
  function bgColor(el) {
    var c = getComputedStyle(el).backgroundColor;
    var m = c && c.match(/[\d.]+/g);
    if (!m) return null;
    if ((m.length > 3 ? +m[3] : 1) < 0.1) return null;
    return [+m[0], +m[1], +m[2]];
  }
  var themeStyle = null, dark = false;
  function setDark(v) {
    if (v && !themeStyle) {
      var bg = bgColor(document.body) || bgColor(document.documentElement) || [255, 255, 255];
      var inv = bg.map(function (x) { return Math.round(0.9 * (255 - x) + 0.1 * x); });
      themeStyle = document.createElement('style');
      themeStyle.setAttribute('data-word-crawler', '');
      themeStyle.textContent = 'html{background:rgb(' + inv.join(',') + ')!important}body{filter:invert(.9) hue-rotate(180deg)!important}' +
        'body img,body video,body picture,body canvas,body iframe,body embed,body object,body svg image,body [style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}';
    }
    dark = v;
    if (v) document.documentElement.appendChild(themeStyle);
    else if (themeStyle) themeStyle.remove();
  }
  function pageIsLight() {
    var bg = bgColor(document.body) || bgColor(document.documentElement) || [255, 255, 255];
    return (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 > 0.5;
  }

  function send(msg) { try { chrome.runtime.sendMessage(msg).catch(function () {}); } catch (e) { /* pannello chiuso */ } }
  function visual(s) { return { speed: s.speed, legs: s.legs, webDensity: s.webDensity, veil: s.veil, theme: s.theme, hud: s.hud, follow: s.follow }; }

  function start(raw) {
    if (engine && engine.isActive()) engine.stop();
    var settings = g.WCSettings.sanitize(raw);
    var root = g.WCDom.pickRoot();
    var tokens = g.WCDom.collect(root);
    var h1 = document.querySelector('h1');
    if (h1 && !root.contains(h1)) tokens = g.WCDom.collect(h1).concat(tokens);
    if (!tokens.length) { send({ type: 'wc:error', message: 'Su questa pagina non ho trovato testo da leggere.' }); return; }
    var res = g.WCAnalysis.analyze(tokens, settings);
    var firstIdx = [], seen = new Set();
    tokens.forEach(function (t, i) { if (t.kid && !seen.has(t.kid)) { seen.add(t.kid); firstIdx.push([t.kid, i]); } });
    var host = (location.hostname || 'pagina').replace(/^www\./, '').toUpperCase();
    state = {
      results: res.results,
      doc: { title: document.title || location.hostname, source: location.href, format: 'Pagina web' },
      total: tokens.length, firstIdx: firstIdx, processed: 0, ended: false, tokens: tokens
    };
    if (settings.theme === 'night' && pageIsLight()) setDark(true);
    send({ type: 'wc:begin', results: state.results, doc: state.doc, total: state.total, firstIdx: firstIdx });
    var summaryTotal = res.results.summary.length;
    engine = g.WCEngine.start({
      tokens: tokens, sentences: res.plan.sentences, display: res.plan.display, settings: visual(settings), keys: true,
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
      onStop: function () { setDark(false); send({ type: 'wc:stopped' }); }
    });
  }

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
      case 'wc:start': start(msg.settings); reply({ ok: true }); break;
      case 'wc:toggle': if (engine && engine.isActive()) engine.stop(); else start(msg.settings); reply({ ok: true }); break;
      case 'wc:stop': if (engine) engine.stop(); reply({ ok: true }); break;
      case 'wc:pause': if (engine) engine.toggle(); reply({ ok: true, running: !!(engine && engine.isRunning()) }); break;
      case 'wc:finish': if (engine) engine.finish(); reply({ ok: true }); break;
      case 'wc:visual':
        if (engine && engine.isActive()) {
          engine.setSettings(visual(msg.settings));
          setDark(msg.settings.theme === 'night' && pageIsLight());
        }
        reply({ ok: true });
        break;
      case 'wc:jump': jump(msg.idx); reply({ ok: true }); break;
      case 'wc:state':
        reply(state ? { results: state.results, doc: state.doc, total: state.total, firstIdx: state.firstIdx, processed: state.processed, ended: state.ended,
          active: !!(engine && engine.isActive()), running: !!(engine && engine.isRunning()) } : null);
        break;
    }
  });
})();
