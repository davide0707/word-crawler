// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: motore grafico del ragno.
 *
 * Non decide nulla sul testo: riceve i token già analizzati (analysis.js) e li "rivela"
 * uno alla volta alla velocità scelta, disegnando sopra la pagina:
 *   - il ragno, le sue zampe (quante = parametro Zampe) e la ragnatela tra le parole chiave;
 *   - i segni: riquadri, cerchi, barrature, sottolineature delle frasi;
 *   - il velo sul testo non ancora letto e il riquadro blu dei contatori.
 *
 * WCEngine.start({
 *   tokens, sentences, display(id), settings, label(), container?,
 *   onProgress(processed, total), onEnd(), onStop(), keys: true|false,
 *   static?: true        mostra subito tutti i segni, senza ragno né animazione (segni ritrovati)
 *   userMarks?: [...]    segni fatti a mano: { type: 'hl'|'under'|'note', from, to, n? }
 * }) -> { stop, pause, resume, toggle, finish, setSettings, isActive, isRunning, invalidate,
 *         setUserMarks(list), setPreview({from, to, type}|null), hitTest(clientX, clientY) -> indice|-1 }
 *
 * token: { text, rect() -> {x,y,w,h} in coordinate del documento | null, mk, kid, grp, sid, link?, el?, font?() }
 */
(function (g) {
  'use strict';
  if (g.WCEngine) return;

  var THEMES = {
    night: {
      ink: '#0b0b0e', leg: '#ffffff', veil: 'rgba(6,6,10,0.45)', web: 'rgba(170,180,255,0.5)', crawl: '#2f4bff', hudText: '#ffffff',
      red: '#ff4a5e', lav: '#aab4ff', cyan: '#3fd8ff', green: '#5de07f', orange: '#ff8a3d', num: '#aab4ff',
      key: '#3fd8ff', def: '#5de07f', term: '#ff8a3d', boxText: '#0b0b0e', ringCyan: '#3fd8ff', ringGreen: '#5de07f'
    },
    paper: {
      ink: '#15171c', leg: '#23262f', veil: 'rgba(250,249,246,0.6)', web: 'rgba(47,75,255,0.32)', crawl: '#2f4bff', hudText: '#ffffff',
      red: '#e11d48', lav: '#c9cffc', cyan: '#a5ecff', green: '#15803d', orange: '#ea580c', num: '#4338ca',
      key: '#1d4ed8', def: '#15803d', term: '#ea580c', boxText: '#111318', ringCyan: '#0e7490', ringGreen: '#15803d'
    }
  };
  var MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace';

  function start(o) {
    var tokens = o.tokens || [];
    var sents = o.sentences || [];
    var S = Object.assign({ speed: 14, legs: 8, webDensity: 5, veil: true, theme: 'night', hud: true, follow: true }, o.settings || {});
    if (o.static) { S.veil = false; S.hud = false; S.follow = false; S.webDensity = 0; }
    var C = THEMES[S.theme] || THEMES.night;

    var cv = document.createElement('canvas');
    cv.setAttribute('data-word-crawler', '');
    cv.setAttribute('aria-hidden', 'true');
    var baseCss = 'position:fixed!important;z-index:2147483646!important;pointer-events:none!important;display:block!important;margin:0!important;' +
      'padding:0!important;border:0!important;max-width:none!important;max-height:none!important;opacity:1!important;filter:none!important;' +
      'transform:none!important;background:transparent!important;';
    document.documentElement.appendChild(cv);
    var ctx = cv.getContext('2d');

    var BX = 0, BY = 0, W = 0, H = 0, ver = 0, lastDocH = 0, dpr = 1;
    function bounds() {
      var vw = window.innerWidth, vh = window.innerHeight;
      var top = o.insetTop || 0; // es. barra fissa dell'app sopra il documento
      if (!o.container) return [0, top, vw, vh - top];
      var r = o.container.getBoundingClientRect();
      var l = Math.max(0, r.left), t = Math.max(top, r.top), rr = Math.min(vw, r.right), bb = Math.min(vh, r.bottom);
      return [l, t, Math.max(0, rr - l), Math.max(0, bb - t)];
    }
    function layout(force) {
      var b = bounds();
      var d = Math.min(2, window.devicePixelRatio || 1);
      if (!force && b[0] === BX && b[1] === BY && b[2] === W && b[3] === H && d === dpr) return;
      BX = b[0]; BY = b[1]; W = b[2]; H = b[3]; dpr = d;
      cv.style.cssText = baseCss + 'left:' + BX + 'px!important;top:' + BY + 'px!important;width:' + W + 'px!important;height:' + H + 'px!important;';
      cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    }
    layout(true);

    // pulsante × per i telefoni (dove non c'è ESC)
    var touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    var stopBtn = null;
    if (touch || o.stopButton) {
      stopBtn = document.createElement('button');
      stopBtn.setAttribute('data-word-crawler', '');
      stopBtn.setAttribute('aria-label', 'Ferma il ragno');
      stopBtn.textContent = '×';
      stopBtn.style.cssText = 'position:fixed!important;top:calc(env(safe-area-inset-top, 0px) + 12px)!important;right:calc(env(safe-area-inset-right, 0px) + 12px)!important;' +
        'z-index:2147483647!important;width:40px!important;height:40px!important;border-radius:50%!important;border:1.5px solid #fff!important;' +
        'background:rgba(11,11,14,.72)!important;color:#fff!important;font:400 24px/1 system-ui,sans-serif!important;padding:0!important;margin:0!important;' +
        'display:grid!important;place-items:center!important;cursor:pointer!important;filter:none!important;opacity:.85!important';
      stopBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); stop(); });
      document.documentElement.appendChild(stopBtn);
    }

    var rootStyle = document.documentElement.style;
    var prevSB = rootStyle.getPropertyValue('scroll-behavior'), prevSBP = rootStyle.getPropertyPriority('scroll-behavior');
    rootStyle.setProperty('scroll-behavior', 'auto', 'important');

    var processed = 0, prog = 0, running = true, active = true, ended = false;
    var rateS = 0, last = 0, raf = 0, lastProgress = -1;
    var crawler = null, cur = null, followPausedUntil = 0, lastVerCheck = 0;
    var nodes = [], edges = [], lastByKid = new Map(), kwOrder = [], seenKid = new Set(), links = new WeakSet();
    var counts = { key: 0, def: 0, term: 0, kw: 0 };
    var hint = { text: o.hint || (touch ? 'WORD CRAWLER · TOCCA × PER FERMARE' : 'WORD CRAWLER · ESC esci · SPAZIO pausa · +/− velocità · INVIO completa'), until: o.static && !o.hint ? 0 : performance.now() + 4500 };
    var fontCache = new WeakMap();
    tokens.forEach(function (t) { t._v = -1; t.at = 0; });

    function rectOf(t) {
      if (t._v !== ver) { t._r = t.rect ? t.rect() : null; t._v = ver; }
      return t._r;
    }
    function center(t) { var r = rectOf(t); return r ? [r.x + r.w / 2, r.y + r.h / 2] : null; }
    function fontOf(t) {
      if (t.font) return t.font();
      var el = t.el;
      if (!el) return { style: 'normal', weight: '400', family: 'serif' };
      var f = fontCache.get(el);
      if (!f) {
        var st = getComputedStyle(el);
        f = { style: st.fontStyle || 'normal', weight: st.fontWeight || '400', family: st.fontFamily || 'serif' };
        fontCache.set(el, f);
      }
      return f;
    }
    function say(text, ms) { hint = { text: text, until: performance.now() + (ms || 1600) }; }

    // ---------------------------------------------------------------- lettura di un token
    function consume(i, now) {
      var t = tokens[i];
      t.at = now;
      if (rectOf(t)) cur = t;
      var s = sents[t.sid];
      if (s && s.mk && i === s.to - 1) counts[s.mk] = (counts[s.mk] || 0) + 1;
      var groupStart = !t.grp || t.grp.from === i;
      if (t.mk && groupStart && rectOf(t)) {
        var isKw = /^(kw-|ring-)/.test(t.mk);
        var n = { t: t, born: now, id: nodes.length + edges.length, kw: isKw };
        nodes.push(n);
        if (t.kid) {
          if (!seenKid.has(t.kid)) {
            seenKid.add(t.kid);
            if (isKw) { kwOrder.push(o.display ? o.display(t.kid) : t.text); counts.kw++; }
          }
          var dens = S.webDensity;
          if (dens > 0 && isKw) {
            var prevSame = lastByKid.get(t.kid);
            if (prevSame) edges.push({ a: n, b: prevSame, born: now });
            var extra = Math.ceil(dens / 3);
            for (var q = nodes.length - 2, added = 0; q >= 0 && added < extra; q--) {
              if (nodes[q].kw && nodes[q] !== prevSame && nodes[q].t.kid !== t.kid) { edges.push({ a: n, b: nodes[q], born: now }); added++; }
            }
          }
          lastByKid.set(t.kid, n);
        }
      } else if (t.link && !links.has(t.link) && rectOf(t)) {
        links.add(t.link);
        nodes.push({ t: t, born: now, id: nodes.length + edges.length, kw: false });
      } else if (!t.mk && t.text.length >= 9 && i % 5 === 0 && rectOf(t)) {
        nodes.push({ t: t, born: now, id: nodes.length + edges.length, kw: false });
      }
      if (nodes.length > 160) nodes.splice(0, nodes.length - 160);
      var maxEdges = 20 + S.webDensity * 25;
      if (edges.length > maxEdges) edges.splice(0, edges.length - maxEdges);
    }

    // ---------------------------------------------------------------- disegno
    function drawText(t, r, x, y, color) {
      var f = fontOf(t);
      var pre = f.style + ' ' + f.weight + ' ';
      ctx.font = pre + '100px ' + f.family;
      var mw = ctx.measureText(t.text).width || 1;
      var size = Math.max(4, Math.min(100 * r.w / mw, r.h * 1.15));
      ctx.font = pre + size.toFixed(2) + 'px ' + f.family;
      var m = ctx.measureText(t.text);
      var asc = m.fontBoundingBoxAscent || size * 0.8, desc = m.fontBoundingBoxDescent || size * 0.22;
      ctx.fillStyle = color;
      ctx.fillText(t.text, x, y + (r.h - (asc + desc)) / 2 + asc);
    }
    function sameLine(a, b) { return a && b && Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5; }

    // ---------------------------------------------------------------- segni fatti a mano
    var umarks = [], umAt = null, preview = null;
    function setUserMarks(list) {
      umarks = (list || []).slice();
      umAt = new Int32Array(tokens.length).fill(-1);
      umarks.forEach(function (m, mi) {
        for (var k = Math.max(0, m.from); k < Math.min(tokens.length, m.to); k++) umAt[k] = mi;
      });
    }
    setUserMarks(o.userMarks);
    function setPreview(p) { preview = p && p.to > p.from ? p : null; }
    function wavy(x1, x2, y, amp) {
      ctx.beginPath();
      var step = Math.max(3, amp * 1.6), up = true;
      ctx.moveTo(x1, y);
      for (var xx = x1 + step; xx <= x2 + 0.5; xx += step) { ctx.lineTo(xx, y + (up ? -amp : amp)); up = !up; }
      ctx.stroke();
    }
    function drawUserMarks(sx, sy) {
      if (!umarks.length && !preview) return;
      var vf = firstVisible(sy, tokens.length), over = 0, noteN = 0;
      for (var k = vf; k < tokens.length; k++) {
        var mi = umAt[k], pv = preview && k >= preview.from && k < preview.to;
        if (mi < 0 && !pv) continue;
        var r = rectOf(tokens[k]);
        if (!r) continue;
        var y = r.y - sy;
        if (y > H + 60) { if (++over > 400) break; continue; }
        if (y + r.h < -60) continue;
        var x = r.x - sx;
        var nx = k + 1 < tokens.length && ((mi >= 0 && umAt[k + 1] === mi) || (pv && k + 1 < preview.to)) ? rectOf(tokens[k + 1]) : null;
        var w = sameLine(r, nx) ? nx.x - r.x : r.w;
        if (pv) {
          ctx.strokeStyle = C.orange; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
          ctx.strokeRect(x - 2, y - 2, w + 4, r.h + 4);
          ctx.setLineDash([]);
        }
        if (mi < 0) continue;
        var m = umarks[mi];
        if (m.type === 'hl') {
          ctx.fillStyle = S.theme === 'paper' ? 'rgba(255,214,0,0.42)' : 'rgba(255,226,64,0.34)';
          ctx.fillRect(x - 1, y, w + 2, r.h);
        } else if (m.type === 'under') {
          ctx.strokeStyle = C.red; ctx.lineWidth = Math.max(1.4, r.h * 0.07);
          wavy(x, x + w, y + r.h + 2, Math.max(1.5, r.h * 0.09));
        } else if (m.type === 'note') {
          ctx.fillStyle = S.theme === 'paper' ? 'rgba(234,88,12,0.16)' : 'rgba(255,138,61,0.22)';
          ctx.fillRect(x - 1, y, w + 2, r.h);
          ctx.strokeStyle = C.orange; ctx.lineWidth = 1.6; ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(x, y + r.h + 1.5); ctx.lineTo(x + w, y + r.h + 1.5); ctx.stroke();
          ctx.setLineDash([]);
          if (k === m.to - 1) {
            // numero della nota alla fine del testo segnato
            var label = String(m.n || ++noteN), fs = Math.max(10, Math.min(14, r.h * 0.6));
            ctx.font = '700 ' + fs + 'px ' + MONO;
            var bw = ctx.measureText(label).width + fs * 0.8;
            ctx.fillStyle = C.orange; ctx.fillRect(x + r.w + 2, y - fs * 0.6, bw, fs * 1.3);
            ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'top'; ctx.fillText(label, x + r.w + 2 + fs * 0.4, y - fs * 0.6 + fs * 0.15);
            ctx.textBaseline = 'alphabetic';
          }
        }
      }
    }
    // parola sotto il puntatore (coordinate della finestra)
    function hitTest(cx, cy) {
      var px = cx + window.scrollX, py = cy + window.scrollY, sy = window.scrollY + BY;
      var vf = firstVisible(sy, tokens.length), best = -1, bestD = 1e9, over = 0;
      for (var k = vf; k < tokens.length; k++) {
        var r = rectOf(tokens[k]);
        if (!r) continue;
        if (r.y - sy > H + 60) { if (++over > 400) break; continue; }
        if (py >= r.y - 2 && py <= r.y + r.h + 2) {
          var dx = px < r.x ? r.x - px : (px > r.x + r.w ? px - r.x - r.w : 0);
          if (dx === 0) return k;
          if (dx < bestD) { bestD = dx; best = k; }
        }
      }
      return bestD <= 14 ? best : -1;
    }

    // primo token visibile (i token sono in ordine di lettura, quindi quasi sempre dall'alto in basso)
    function firstVisible(sy, limit) {
      var lo = 0, hi = limit;
      while (lo < hi) {
        var mid = (lo + hi) >> 1, r = null, k = mid;
        while (k < hi && !(r = rectOf(tokens[k]))) k++;
        if (!r) { hi = mid; continue; }
        if (r.y + r.h < sy - 40) lo = k + 1; else hi = mid;
      }
      return Math.max(0, lo - 60);
    }

    function draw(now) {
      var sx = window.scrollX + BX, sy = window.scrollY + BY;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!W || !H) return;
      var from = firstVisible(sy, processed);
      var to = processed;

      // 1. velo: il testo già letto viene "scoperto"
      if (S.veil) {
        ctx.fillStyle = C.veil;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,0.92)';
        for (var k = from; k < to; k++) {
          var r = rectOf(tokens[k]);
          if (!r) continue;
          var y = r.y - sy;
          if (y > H + 40) break;
          if (y + r.h < -40) continue;
          var px = r.h * 0.18;
          ctx.fillRect(r.x - sx - px, y - 1, r.w + px * 2, r.h + 2);
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // 2. sottolineature delle frasi
      for (var u = from; u < to; u++) {
        var tu = tokens[u], su = sents[tu.sid];
        if (!su || !su.mk) continue;
        var ru = rectOf(tu);
        if (!ru) continue;
        var yu = ru.y - sy;
        if (yu > H + 40) break;
        if (yu + ru.h < -40) continue;
        var nx = u + 1 < to && tokens[u + 1].sid === tu.sid ? rectOf(tokens[u + 1]) : null;
        var x1 = ru.x - sx, x2 = sameLine(ru, nx) ? nx.x - sx : ru.x + ru.w - sx;
        var a = Math.min(1, (now - tu.at) / 200);
        ctx.strokeStyle = su.mk === 'def' ? C.def : (su.mk === 'term' ? C.term : C.key);
        ctx.lineWidth = Math.max(1.6, ru.h * 0.09);
        if (su.mk === 'def') ctx.setLineDash([ru.h * 0.35, ru.h * 0.18]); else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x1, yu + ru.h + 1);
        ctx.lineTo(x1 + (x2 - x1) * a, yu + ru.h + 1);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // 3. segni sulle parole
      for (var h = from; h < to; h++) {
        var t = tokens[h];
        if (!t.mk) continue;
        var rr = rectOf(t);
        if (!rr) continue;
        var x = rr.x - sx, yy = rr.y - sy;
        if (yy > H + 60) break;
        if (yy + rr.h < -60) continue;
        var an = Math.min(1, (now - (t.grp ? tokens[t.grp.from].at : t.at)) / 240);
        var pad = rr.h * 0.14;
        var nxt = t.grp && h + 1 < t.grp.to ? rectOf(tokens[h + 1]) : null;
        var wBox = sameLine(rr, nxt) ? nxt.x - rr.x : rr.w;
        if (t.mk === 'kw-lav' || t.mk === 'kw-cyan' || t.mk === 'term') {
          ctx.fillStyle = t.mk === 'kw-lav' ? C.lav : (t.mk === 'term' ? C.orange : C.cyan);
          ctx.fillRect(x - pad, yy - pad * 0.4, (wBox + pad * 2) * an, rr.h + pad * 0.8);
          if (an > 0.5) drawText(t, rr, x, yy, C.boxText);
        } else if (t.mk === 'num') {
          ctx.strokeStyle = C.num; ctx.lineWidth = 1.6;
          ctx.globalAlpha = an;
          ctx.strokeRect(x - pad, yy - pad * 0.3, rr.w + pad * 2, rr.h + pad * 0.6);
          ctx.globalAlpha = 1;
        } else if (t.mk === 'strike') {
          ctx.strokeStyle = C.orange; ctx.lineWidth = Math.max(2, rr.h * 0.1);
          ctx.beginPath();
          ctx.moveTo(x - pad, yy + rr.h * 0.55);
          ctx.lineTo(x - pad + (rr.w + pad * 2) * an, yy + rr.h * 0.55);
          ctx.stroke();
        } else if ((t.mk === 'ring-cyan' || t.mk === 'ring-green') && (!t.grp || t.grp.from === h)) {
          // un solo cerchio attorno a tutta l'espressione (parti sulla stessa riga)
          var ux = rr.x, uw = rr.w, last2 = rr;
          if (t.grp) {
            for (var gk = h + 1; gk < t.grp.to; gk++) {
              var gr = rectOf(tokens[gk]);
              if (!sameLine(last2, gr)) break;
              uw = gr.x + gr.w - ux; last2 = gr;
            }
          }
          ctx.strokeStyle = t.mk === 'ring-green' ? C.ringGreen : C.ringCyan;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.ellipse(ux - sx + uw / 2, yy + rr.h / 2, uw / 2 + rr.h * 0.5, rr.h * 0.78, -0.06, 0, Math.PI * 2 * an);
          ctx.stroke();
        }
      }

      drawUserMarks(sx, sy);

      if (!crawler || o.static) return;
      var cx = crawler[0] - sx, cy = crawler[1] - sy;
      var unit = Math.max(9, Math.min(16, Math.min(W, H) * 0.028));

      // 4. ragnatela
      if (S.webDensity > 0 && edges.length) {
        ctx.strokeStyle = C.web; ctx.lineWidth = 1;
        ctx.beginPath();
        edges.forEach(function (e) {
          var A = center(e.a.t), B = center(e.b.t);
          if (!A || !B) return;
          var ay = A[1] - sy, by = B[1] - sy;
          if (Math.max(ay, by) < -40 || Math.min(ay, by) > H + 40) return;
          var gg = Math.min(1, (now - e.born) / 600);
          ctx.moveTo(A[0] - sx, ay);
          ctx.lineTo(A[0] - sx + (B[0] - A[0]) * gg, ay + (by - ay) * gg);
        });
        ctx.stroke();
      }

      // 5. zampe: verso gli ultimi segni e collegamenti vicini
      var drawn = 0, sq = unit * 0.55, dot = unit * 0.38;
      for (var q = nodes.length - 1; q >= 0 && drawn < S.legs; q--) {
        var nd = nodes[q], P = center(nd.t);
        if (!P) continue;
        var nxp = P[0] - sx, nyp = P[1] - sy;
        if (Math.abs(nyp - cy) > H * 0.6) continue;
        drawn++;
        var gr2 = Math.min(1, (now - nd.born) / 380);
        var ex = cx + (nxp - cx) * gr2, ey = cy + (nyp - cy) * gr2;
        ctx.globalAlpha = 0.85; ctx.strokeStyle = C.leg; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.globalAlpha = 1;
        if (gr2 >= 1) {
          ctx.fillStyle = C.ink; ctx.strokeStyle = C.leg; ctx.lineWidth = 1.4;
          if (S.theme === 'paper') ctx.fillStyle = '#ffffff';
          ctx.fillRect(nxp - sq / 2, nyp - sq / 2, sq, sq);
          ctx.strokeRect(nxp - sq / 2, nyp - sq / 2, sq, sq);
        }
        if (nd.id % 2 === 0) {
          ctx.fillStyle = C.red;
          ctx.fillRect(cx + (ex - cx) * 0.35 - dot / 2, cy + (ey - cy) * 0.35 - dot / 2, dot, dot);
          ctx.fillRect(cx + (ex - cx) * 0.7 - dot / 2, cy + (ey - cy) * 0.7 - dot / 2, dot, dot);
        }
      }

      // 6. il ragno
      var cw = unit * 1.15, ch = cw * 1.8, bx = cx - cw / 2, by2 = cy - ch / 2;
      ctx.fillStyle = '#0b0b0e'; ctx.fillRect(bx, by2, cw, ch);
      ctx.strokeStyle = S.theme === 'paper' ? '#0b0b0e' : '#ffffff'; ctx.lineWidth = 1.6; ctx.strokeRect(bx, by2, cw, ch);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.beginPath();
      for (var s3 = 0; s3 < 3; s3++) {
        var ly = by2 + ch * (0.14 + s3 * 0.12);
        ctx.moveTo(bx + cw * 0.2, ly); ctx.lineTo(bx + cw * 0.8, ly);
      }
      ctx.stroke();
      ctx.fillStyle = (now % 700) < 450 && running ? '#3fd8ff' : C.crawl;
      ctx.fillRect(bx + cw * 0.3, by2 + ch * 0.62, cw * 0.4, cw * 0.4);

      var fz = unit * 1.05;
      ctx.font = '600 ' + fz + 'px ' + MONO;
      var l1 = 'CRAWLER/01', l2 = Math.round(rateS) + ' w/s';
      var tw = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + fz * 1.2, th = fz * 3;
      var tx = cx + cw * 0.9;
      if (tx + tw > W - 4) tx = cx - cw * 0.9 - tw;
      var ty = cy - ch * 0.6;
      ctx.fillStyle = C.crawl; ctx.fillRect(tx, ty, tw, th);
      ctx.fillStyle = C.hudText; ctx.textBaseline = 'top';
      ctx.fillText(l1, tx + fz * 0.6, ty + fz * 0.5);
      ctx.fillText(l2, tx + fz * 0.6, ty + fz * 1.7);
      ctx.textBaseline = 'alphabetic';
    }

    function pad6(n) { return String(n).padStart(6, '0').replace(/(\d{3})(\d{3})$/, '$1,$2'); }
    function drawHud(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (S.hud) {
        var tail = kwOrder.slice(-3).map(function (s) { return String(s).toUpperCase(); }).join(' · ');
        var rows = [
          o.label ? o.label(processed) : 'WORD CRAWLER',
          'EXTRACTED ' + pad6(processed) + ' / ' + tokens.length.toLocaleString('en-US'),
          'KEYWORDS ' + String(counts.kw).padStart(3, '0') + (tail ? '  ' + tail : '')
        ];
        var ml = o.modeLine ? o.modeLine(counts) : null;
        if (ml) rows.push(ml);
        if (ended) rows.push('STATUS -- COMPLETE');
        else if (!running) rows.push('STATUS -- PAUSED');
        var f = Math.max(11, Math.min(16, Math.min(W, H) * 0.03));
        ctx.font = '600 ' + f + 'px ' + MONO;
        var mw = 0;
        rows.forEach(function (r) { mw = Math.max(mw, ctx.measureText(r).width); });
        var maxW = W - 32;
        if (mw + f * 2 > maxW) {
          f = f * maxW / (mw + f * 2);
          ctx.font = '600 ' + f + 'px ' + MONO;
          mw = 0; rows.forEach(function (r) { mw = Math.max(mw, ctx.measureText(r).width); });
        }
        var bw = mw + f * 2, bh = f * 1.55 * rows.length + f * 0.9;
        var bx = 16, by = H - bh - 20;
        ctx.globalAlpha = 0.94; ctx.fillStyle = C.crawl; ctx.fillRect(bx, by, bw, bh); ctx.globalAlpha = 1;
        ctx.fillStyle = C.hudText; ctx.textBaseline = 'top';
        rows.forEach(function (r, i) { ctx.fillText(r, bx + f, by + f * 0.45 + i * f * 1.55); });
        ctx.textBaseline = 'alphabetic';
      }
      if (now < hint.until) {
        var al = Math.min(1, (hint.until - now) / 600);
        var hf = Math.max(11, Math.min(13, W * 0.028));
        ctx.font = '600 ' + hf + 'px ' + MONO;
        var hw = Math.min(W - 32, ctx.measureText(hint.text).width + hf * 1.6);
        ctx.globalAlpha = al;
        ctx.fillStyle = '#0b0b0e'; ctx.fillRect((W - hw) / 2, 16, hw, hf * 2.2);
        ctx.strokeStyle = C.crawl; ctx.lineWidth = 1.5; ctx.strokeRect((W - hw) / 2, 16, hw, hf * 2.2);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(hint.text, W / 2, 16 + hf * 0.6, W - 48);
        ctx.textAlign = 'left'; ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
      }
    }

    // ---------------------------------------------------------------- ciclo
    function advance(n, now) {
      var before = processed;
      var target = Math.min(tokens.length, processed + n);
      while (processed < target) consume(processed++, now);
      if (processed >= tokens.length && !ended) { ended = true; if (o.onEnd) setTimeout(o.onEnd, 0); }
      return processed - before;
    }
    function frame(now) {
      if (!active) return;
      var dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      layout(false);
      if (now - lastVerCheck > 1000) {
        lastVerCheck = now;
        var dh = document.documentElement.scrollHeight;
        if (dh !== lastDocH) { lastDocH = dh; ver++; }
      }
      if (running && !ended) {
        prog += S.speed * dt;
        var n = Math.floor(prog) - processed;
        var got = n > 0 ? advance(n, now) : 0;
        rateS += (got / Math.max(dt, 0.001) - rateS) * Math.min(1, dt * 3);
      } else {
        rateS *= Math.max(0, 1 - dt * 6);
      }
      if (processed !== lastProgress) { lastProgress = processed; if (o.onProgress) o.onProgress(processed, tokens.length); }

      if (cur) {
        var c = center(cur);
        if (c) {
          if (!crawler) crawler = c.slice();
          var k = 1 - Math.exp(-dt * 16);
          crawler[0] += (c[0] - crawler[0]) * k;
          crawler[1] += (c[1] - crawler[1]) * k;
        }
      }
      // si segue il ragno solo mentre legge (finita la lettura la pagina resta dove la lascia l'utente)
      if (S.follow && crawler && running && !ended && now > followPausedUntil) {
        var sy = window.scrollY;
        var target = crawler[1] - BY - H * 0.45;
        var maxY = document.documentElement.scrollHeight - window.innerHeight;
        target = Math.max(0, Math.min(maxY, target));
        if (Math.abs(target - sy) > 1) window.scrollTo(window.scrollX, sy + (target - sy) * (1 - Math.exp(-dt * 4)));
      }
      draw(now);
      drawHud(now);
      raf = requestAnimationFrame(frame);
    }

    function userScroll() { followPausedUntil = performance.now() + 3000; }
    function onKey(e) {
      if (!o.keys) return;
      var el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName))) return;
      var used = true;
      if (e.key === 'Escape') stop();
      else if (e.key === ' ') { if (ended) used = false; else toggle(); }
      else if (e.key === 'Enter') finish();
      else if (e.key === '+' || e.key === '=') setSettings({ speed: Math.min(400, Math.round(S.speed * 1.5)) }, true);
      else if (e.key === '-' || e.key === '_') setSettings({ speed: Math.max(1, Math.round(S.speed / 1.5)) }, true);
      else if (/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End)$/.test(e.key)) { userScroll(); used = false; }
      else used = false;
      if (used) { e.preventDefault(); e.stopPropagation(); }
    }
    function onResize() { ver++; layout(true); }

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', userScroll, { passive: true });
    window.addEventListener('touchmove', userScroll, { passive: true });
    window.addEventListener('resize', onResize);
    // segni ritrovati: tutto subito, senza ragno
    if (o.static) { processed = prog = tokens.length; ended = true; if (o.onEnd) setTimeout(o.onEnd, 0); }
    raf = requestAnimationFrame(frame);

    function pause() { if (running) { running = false; say('PAUSA', 1000); } }
    function resume() { if (!running && !ended) { running = true; prog = processed; say('VIA', 800); } }
    function toggle() { if (running) pause(); else resume(); }
    function finish() { if (!ended) { advance(tokens.length, performance.now()); say('LETTURA COMPLETATA', 1500); } }
    function setSettings(p, announce) {
      Object.assign(S, p || {});
      C = THEMES[S.theme] || THEMES.night;
      if (p && p.speed && announce) say('VELOCITÀ ' + S.speed + ' w/s');
      if (o.onSettings && announce) o.onSettings(S);
    }
    function stop() {
      if (!active) return;
      active = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', userScroll);
      window.removeEventListener('touchmove', userScroll);
      window.removeEventListener('resize', onResize);
      cv.remove();
      if (stopBtn) stopBtn.remove();
      if (prevSB) rootStyle.setProperty('scroll-behavior', prevSB, prevSBP); else rootStyle.removeProperty('scroll-behavior');
      if (o.onStop) o.onStop();
    }

    return {
      stop: stop, pause: pause, resume: resume, toggle: toggle, finish: finish, setSettings: setSettings,
      setUserMarks: setUserMarks, setPreview: setPreview, hitTest: hitTest,
      invalidate: function () { ver++; },
      isActive: function () { return active; },
      isRunning: function () { return active && running && !ended; },
      isEnded: function () { return ended; },
      processed: function () { return processed; }
    };
  }

  g.WCEngine = { start: start, THEMES: THEMES };
})(globalThis);
