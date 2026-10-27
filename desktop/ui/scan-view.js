/*
 * Word Crawler: scanner del PC (solo app desktop).
 * Il ragno cammina sulla mappa delle cartelle: il centro è la cartella scelta, ogni anello è
 * un livello più in profondità. Ogni zampa è una cartella che sta leggendo in quel momento.
 */
(function (g) {
  'use strict';
  if (g.WCScanView) return;
  var el = function (t, a, c) { return g.WCSettingsUI.el(t, a, c); };
  var R = g.WCScanReport;
  var MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  var DEFAULT_EXCLUDES = 'node_modules, .git, $Recycle.Bin, System Volume Information';

  function mount(container, api, opts) {
    opts = opts || {};
    container.textContent = '';
    container.classList.add('sc');
    var o = { root: '', legs: 8, duplicates: 'fast', minDupSize: 1024, includeHidden: false, sameDevice: true, excludes: DEFAULT_EXCLUDES, csv: true, visDepth: 5 };
    var running = false, report = null;

    // ---------------------------------------------------------------- opzioni
    var rootSel = el('select', { id: 'sc-root' }, [el('option', { value: '', text: 'Scegli…' })]);
    var pickBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Scegli cartella…' });
    var rootShown = el('p', { class: 'sc-path', text: 'Nessuna cartella scelta' });
    var legs = el('input', { type: 'range', id: 'sc-legs', min: 1, max: 16, step: 1 });
    var legsOut = el('output', { for: 'sc-legs' });
    var dups = el('select', { id: 'sc-dups' }, [el('option', { value: 'off', text: 'No' }), el('option', { value: 'fast', text: 'Sì, veloce' }), el('option', { value: 'full', text: 'Sì, completo (più lento)' })]);
    var minDup = el('select', { id: 'sc-mindup' }, [['0', 'tutti i file'], ['1024', 'da 1 KB'], ['102400', 'da 100 KB'], ['1048576', 'da 1 MB'], ['10485760', 'da 10 MB']].map(function (x) { return el('option', { value: x[0], text: x[1] }); }));
    var hidden = el('input', { type: 'checkbox', id: 'sc-hidden' });
    var same = el('input', { type: 'checkbox', id: 'sc-same' });
    var csv = el('input', { type: 'checkbox', id: 'sc-csv' });
    var excl = el('input', { type: 'text', id: 'sc-excl', spellcheck: 'false' });
    var depth = el('input', { type: 'range', id: 'sc-depth', min: 2, max: 8, step: 1 });
    var depthOut = el('output', { for: 'sc-depth' });
    var startBtn = el('button', { type: 'button', class: 'wc-btn wc-primary wc-wide', text: 'Avvia la scansione', disabled: 'disabled' });
    var stopBtn = el('button', { type: 'button', class: 'wc-btn wc-wide', text: 'Ferma', disabled: 'disabled' });
    var msg = el('p', { class: 'wc-note', role: 'status' });

    function field(label, forId, input, effect, out) {
      var head = out ? el('div', { class: 'wc-row' }, [el('label', { for: forId, class: 'wc-label', text: label }), out]) : el('label', { for: forId, class: 'wc-label', text: label });
      return el('div', { class: 'wc-field' }, [head, input, effect ? el('p', { class: 'wc-effect', text: effect }) : null]);
    }
    function check(input, label, effect) {
      return el('div', { class: 'wc-field' }, [el('label', { class: 'wc-check', for: input.id }, [input, el('span', { text: label })]), el('p', { class: 'wc-effect', text: effect })]);
    }
    var left = el('aside', { class: 'wc-side wc-left sc-left', 'aria-label': 'Opzioni della scansione' }, [
      el('section', {}, [el('h2', { text: 'Dove' }), field('Disco o cartella', 'sc-root', rootSel), pickBtn, rootShown]),
      el('section', {}, [el('h2', { text: 'Ragno' }), el('div', { class: 'sc-btns' }, [startBtn, stopBtn]), msg,
        el('p', { class: 'sc-safe', text: 'Sola lettura: il ragno guarda e misura. Non modifica, non sposta e non cancella niente.' })]),
      el('section', { class: 'wc-settings' }, [el('h2', { text: 'Impostazioni' }),
        field('Zampe', 'sc-legs', legs, 'Cartelle lette contemporaneamente. Su un SSD più zampe rendono la scansione più veloce; su dischi meccanici o di rete oltre 4 non aiutano. Sono le zampe che vedi muoversi.', legsOut),
        field('Cerca duplicati (cloni)', 'sc-dups', dups, 'Veloce: confronta dimensione, inizio e fine di ogni file (i file sotto 128 KB per intero). Completo: legge tutto il contenuto, certezza assoluta ma più tempo.'),
        field('Duplicati: dimensione minima', 'sc-mindup', minDup, 'Ignora i file più piccoli: sono tanti e pesano poco. Riduce molto i tempi.'),
        check(same, 'Resta su questo disco', 'Non entra in altri dischi, chiavette o cartelle di rete collegate dentro quella scelta.'),
        check(hidden, 'Includi file e cartelle nascosti', 'Quelli che iniziano con il punto (configurazioni di programmi).'),
        check(csv, 'Salva l’elenco completo dei file', 'Un file CSV con percorso, estensione, dimensione e date di ogni file, da aprire con Excel.'),
        field('Cartelle da saltare', 'sc-excl', excl, 'Nomi separati da virgola. Le cartelle del cestino e di sistema conviene saltarle.'),
        field('Dettaglio della mappa', 'sc-depth', depth, 'Quanti livelli di cartelle disegnare. Non cambia la scansione, solo il disegno.', depthOut)
      ])
    ]);

    // ---------------------------------------------------------------- mappa
    var canvas = el('canvas', { class: 'sc-canvas', 'aria-label': 'Mappa animata delle cartelle' });
    var stage = el('div', { class: 'sc-stage' }, [canvas]);
    var legsList = el('ol', { class: 'sc-legs', 'aria-label': 'Cartelle che il ragno sta leggendo' });
    var reportBox = el('section', { class: 'sc-report', hidden: 'hidden', 'aria-label': 'Rapporto' });
    var main = el('main', { class: 'sc-main' }, [stage, legsList, reportBox]);
    container.appendChild(left);
    container.appendChild(main);

    var ctx = canvas.getContext('2d');
    var layer = document.createElement('canvas'), lctx = layer.getContext('2d');
    var W = 0, H = 0, dpr = 1, ring = 40, cx = 0, cy = 0;
    var nodes = [], hot = [], active = [], totals = null, phase = 'idle', hashInfo = null, rootLabel = '', started = 0, lastTotals = null, rate = 0;
    var spider = null;

    function resize() {
      var r = stage.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(200, r.width); H = Math.max(200, r.height);
      [canvas, layer].forEach(function (c) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); });
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      cx = W / 2; cy = H / 2;
      ring = (Math.min(W, H) / 2 - 24) / Math.max(1, o.visDepth);
      redrawLayer();
    }
    function pos(n) {
      if (!n.depth) return [cx, cy];
      var r = n.depth * ring;
      return [cx + Math.cos(n.angle) * r, cy + Math.sin(n.angle) * r];
    }
    function drawNode(n) {
      var p = nodes[n.parent];
      var a = pos(n);
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (p) {
        var b = pos(p);
        lctx.strokeStyle = 'rgba(170,180,255,' + Math.max(0.12, 0.42 - n.depth * 0.05) + ')';
        lctx.lineWidth = n.depth <= 1 ? 1.2 : 0.8;
        lctx.beginPath(); lctx.moveTo(b[0], b[1]); lctx.lineTo(a[0], a[1]); lctx.stroke();
      }
      lctx.fillStyle = n.depth <= 1 ? '#ecebf0' : 'rgba(236,235,240,0.55)';
      var s = n.depth === 0 ? 5 : Math.max(1.2, 3 - n.depth * 0.35);
      lctx.fillRect(a[0] - s / 2, a[1] - s / 2, s, s);
    }
    function redrawLayer() {
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, layer.width, layer.height);
      // anelli guida
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lctx.strokeStyle = 'rgba(255,255,255,0.05)';
      for (var d = 1; d <= o.visDepth; d++) { lctx.beginPath(); lctx.arc(cx, cy, d * ring, 0, Math.PI * 2); lctx.stroke(); }
      nodes.forEach(function (n) { if (n) drawNode(n); });
    }
    function addNode(d) {
      var p = nodes[d.parent];
      var n = { id: d.id, parent: d.parent, depth: d.depth, name: d.name, kids: 0, angle: 0, span: Math.PI * 2 };
      if (p) {
        var k = p.kids++;
        var f = (0.5 + k * 0.6180339887) % 1;
        n.angle = p.angle - p.span / 2 + p.span * f;
        n.span = Math.max(0.01, p.span * (p.depth === 0 ? 0.3 : 0.42));
      }
      nodes[d.id] = n;
      drawNode(n);
    }
    function resetMap(root) {
      nodes = []; hot = []; active = []; totals = null; hashInfo = null; spider = null; rate = 0; lastTotals = null;
      rootLabel = root;
      addNode({ id: 0, parent: -1, depth: 0, name: root });
      redrawLayer();
    }

    function pad(n, w) { return String(n).padStart(w || 6, '0').replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
    function frame(now) {
      if (!stage.offsetParent) { raf = requestAnimationFrame(frame); return; } // vista nascosta: non disegna
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b0b0e'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(layer, 0, 0, W, H);
      // cartelle appena visitate
      hot = hot.filter(function (h) { return now - h.t < 1500; });
      hot.forEach(function (h) {
        var n = nodes[h.id]; if (!n) return;
        var p = pos(n), a = 1 - (now - h.t) / 1500;
        ctx.fillStyle = 'rgba(63,216,255,' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p[0], p[1], 2 + 3 * a, 0, Math.PI * 2); ctx.fill();
      });
      // ragno e zampe
      var pts = active.map(function (a) { return a && nodes[a.vis] ? pos(nodes[a.vis]) : null; }).filter(Boolean);
      var target = [cx, cy];
      if (pts.length) target = [pts.reduce(function (s, p) { return s + p[0]; }, 0) / pts.length, pts.reduce(function (s, p) { return s + p[1]; }, 0) / pts.length];
      if (!spider) spider = target.slice();
      spider[0] += (target[0] - spider[0]) * 0.08; spider[1] += (target[1] - spider[1]) * 0.08;
      var unit = 12, sq = 7, dot = 5;
      pts.forEach(function (p, i) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(spider[0], spider[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
        ctx.fillStyle = '#0b0b0e'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4;
        ctx.fillRect(p[0] - sq / 2, p[1] - sq / 2, sq, sq); ctx.strokeRect(p[0] - sq / 2, p[1] - sq / 2, sq, sq);
        if (i % 2 === 0) {
          ctx.fillStyle = '#ff4a5e';
          ctx.fillRect(spider[0] + (p[0] - spider[0]) * 0.4 - dot / 2, spider[1] + (p[1] - spider[1]) * 0.4 - dot / 2, dot, dot);
        }
      });
      var cw = unit * 1.15, ch = cw * 1.8, bx = spider[0] - cw / 2, by = spider[1] - ch / 2;
      ctx.fillStyle = '#0b0b0e'; ctx.fillRect(bx, by, cw, ch);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6; ctx.strokeRect(bx, by, cw, ch);
      ctx.lineWidth = 1; ctx.beginPath();
      for (var s = 0; s < 3; s++) { var ly = by + ch * (0.14 + s * 0.12); ctx.moveTo(bx + cw * 0.2, ly); ctx.lineTo(bx + cw * 0.8, ly); }
      ctx.stroke();
      ctx.fillStyle = running && (now % 700) < 450 ? '#3fd8ff' : '#2f4bff';
      ctx.fillRect(bx + cw * 0.3, by + ch * 0.62, cw * 0.4, cw * 0.4);
      // contatori
      var t = totals || { files: 0, dirs: 0, bytes: 0, errors: 0 };
      var rows = [
        'SCAN -- ' + (rootLabel || '—'),
        'FILES ' + pad(t.files, 7) + ' · DIRS ' + pad(t.dirs, 5),
        'SIZE ' + R.bytes(t.bytes) + (t.errors ? ' · DENIED ' + pad(t.errors, 3) : ''),
        'LEGS ' + String(o.legs).padStart(2, '0') + ' · ' + Math.round(rate).toLocaleString('en-US') + ' file/s'
      ];
      if (phase === 'hash' && hashInfo) rows.push('DUPLICATES ' + Math.round(hashInfo.done * 100 / Math.max(1, hashInfo.total)) + '% · ' + pad(hashInfo.done, 5) + ' / ' + pad(hashInfo.total, 5));
      else if (phase === 'done') rows.push(report && report.partial ? 'STATUS -- STOPPED' : 'STATUS -- COMPLETE');
      else if (phase === 'idle') rows.push('STATUS -- READY');
      var f = 14;
      ctx.font = '600 ' + f + 'px ' + MONO;
      var mw = 0; rows.forEach(function (r) { mw = Math.max(mw, ctx.measureText(r).width); });
      if (mw + f * 2 > W - 32) { f = f * (W - 32) / (mw + f * 2); ctx.font = '600 ' + f + 'px ' + MONO; mw = 0; rows.forEach(function (r) { mw = Math.max(mw, ctx.measureText(r).width); }); }
      var bw = mw + f * 2, bh = f * 1.55 * rows.length + f * 0.9, hx = 16, hy = H - bh - 16;
      ctx.globalAlpha = 0.94; ctx.fillStyle = '#2f4bff'; ctx.fillRect(hx, hy, bw, bh); ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'top';
      rows.forEach(function (r, i) { ctx.fillText(r, hx + f, hy + f * 0.45 + i * f * 1.55); });
      ctx.textBaseline = 'alphabetic';
      if (phase === 'idle' && !rootLabel) {
        ctx.fillStyle = '#9b9aa7'; ctx.font = '15px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Scegli un disco o una cartella e premi “Avvia la scansione”.', cx, cy + 46);
        ctx.textAlign = 'left';
      }
      raf = requestAnimationFrame(frame);
    }
    var raf = 0;

    function midTrim(s, n) { return s.length <= n ? s : s.slice(0, Math.floor(n * 0.35)) + '…' + s.slice(-Math.floor(n * 0.6)); }
    function paintLegs() {
      legsList.textContent = '';
      if (!running) return;
      active.forEach(function (a, i) {
        legsList.appendChild(el('li', { class: a ? '' : 'idle' }, [el('span', { class: 'sc-leg-n', text: 'Z' + String(i + 1).padStart(2, '0') }), el('span', { class: 'sc-leg-p', text: a ? midTrim(a.path, 110) : 'in attesa' })]));
      });
    }

    // ---------------------------------------------------------------- eventi della scansione
    var lastLegsPaint = 0;
    api.onEvent(function (m) {
      if (m.type === 'phase') {
        phase = m.phase;
        if (m.phase === 'hash') msg.textContent = 'Cerco i duplicati tra ' + R.num(m.files) + ' file con la stessa dimensione…';
        if (m.phase === 'report') msg.textContent = 'Preparo il rapporto…';
      } else if (m.type === 'progress') {
        var now = performance.now();
        if (lastTotals) {
          var dt = (now - lastTotals.t) / 1000;
          if (dt > 0) rate += ((m.totals.files - lastTotals.files) / dt - rate) * 0.3;
        }
        lastTotals = { t: now, files: m.totals.files };
        totals = m.totals;
        (m.newDirs || []).forEach(function (d) { if (!nodes[d.id]) addNode(d); });
        active = m.active;
        active.forEach(function (a) { if (a) hot.push({ id: a.vis, t: now }); });
        if (now - lastLegsPaint > 250) { lastLegsPaint = now; paintLegs(); }
        msg.textContent = 'Sto leggendo: ' + R.num(m.totals.files) + ' file in ' + R.num(m.totals.dirs) + ' cartelle.';
      } else if (m.type === 'trash-check') {
        if (trashProgress) trashProgress(m);
      } else if (m.type === 'hash') {
        hashInfo = m;
        active = [];
      } else if (m.type === 'done') {
        running = false; phase = 'done'; active = [];
        report = m.report;
        totals = report.totals;
        paintLegs();
        msg.textContent = (report.partial ? 'Scansione interrotta: il rapporto è parziale. ' : 'Scansione completata. ') + 'Il rapporto è qui sotto.';
        showReport(report);
        setButtons();
      } else if (m.type === 'error') {
        running = false; phase = 'idle'; active = [];
        msg.textContent = 'Errore: ' + m.message;
        setButtons();
      }
    });

    // ---------------------------------------------------------------- rapporto
    function tableOf(s, extraCol) {
      var table = el('table', { class: 'sc-table' });
      var thead = el('thead', {}, [el('tr', {}, s.columns.map(function (c) { return el('th', { scope: 'col', text: c }); }).concat(s.paths ? [el('th', { text: '' })] : []))]);
      var tbody = el('tbody');
      s.rows.slice(0, 500).forEach(function (row, ri) {
        var tr = el('tr');
        row.forEach(function (c, ci) {
          var td = el('td', { text: c });
          if (s.bars && ci === 0) {
            var bar = el('span', { class: 'sc-bar' });
            bar.style.width = Math.max(1, Math.round(s.bars[ri] * 100)) + '%';
            td.appendChild(bar);
          }
          tr.appendChild(td);
        });
        if (s.paths) {
          var b = el('button', { type: 'button', class: 'wc-link', text: 'Mostra' });
          b.addEventListener('click', function () { api.showItem(s.paths[ri]); });
          tr.appendChild(el('td', {}, [b]));
        }
        tbody.appendChild(tr);
      });
      table.appendChild(thead); table.appendChild(tbody);
      var box = el('div', {}, [el('div', { class: 'sc-tw' }, [table])]);
      if (s.rows.length > 500) box.appendChild(el('p', { class: 'wc-note', text: 'Mostrate le prime 500 righe: il rapporto HTML le contiene tutte.' }));
      return box;
    }
    function renderSection(panel, s) {
      if (s.note) panel.appendChild(el('p', { class: 'wc-note sc-note', text: s.note }));
      if (!s.rows.length) { panel.appendChild(el('p', { class: 'wc-note', text: 'Nessun elemento.' })); return; }
      panel.appendChild(tableOf(s));
    }

    // mappa a riquadri: ogni riquadro è una cartella, grande quanto lo spazio che occupa
    var tmCleanup = null;
    function renderTreemap(panel, r) {
      var tree = r.tree;
      if (!tree || !tree.names || !tree.names.length) { panel.appendChild(el('p', { class: 'wc-note', text: 'Mappa non disponibile per questa scansione: rifai la scansione con questa versione.' })); return; }
      var kids = R.treeKids(tree), cur = 0, rects = [], hover = null;
      var crumbs = el('nav', { class: 'sc-crumbs', 'aria-label': 'Percorso nella mappa' });
      var upBtn = el('button', { type: 'button', class: 'wc-btn', text: '↑ Su' });
      var showBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Apri la cartella' });
      var cv = el('canvas', { class: 'sc-tm', role: 'img', tabindex: '0' });
      var info = el('p', { class: 'wc-note sc-tm-info', role: 'status', text: 'Passa sopra un riquadro per i dettagli; clic per entrare nella cartella.' });
      panel.appendChild(el('p', { class: 'wc-note sc-note', text: 'Ogni riquadro è una cartella, grande quanto lo spazio che occupa (sottocartelle comprese). In grigio i file sciolti nella cartella e le cartelle troppo piccole per essere disegnate.' }));
      panel.appendChild(el('div', { class: 'sc-tm-bar' }, [upBtn, crumbs, showBtn]));
      panel.appendChild(cv);
      panel.appendChild(info);
      var cx2 = cv.getContext('2d');
      function hue(sname) { var h = 0; for (var i = 0; i < sname.length; i++) h = (h * 31 + sname.charCodeAt(i)) >>> 0; return h % 360; }
      function items(i) {
        var list = kids[i].map(function (k) { return { value: tree.total[k], idx: k, name: tree.names[k] }; });
        if (tree.own[i] > 0) list.push({ value: tree.own[i], idx: -1, name: 'file in questa cartella (' + R.num(tree.files[i]) + ')', grey: true });
        var shown = list.reduce(function (sm, x) { return sm + x.value; }, 0), other = tree.total[i] - shown;
        if (other > tree.total[i] * 0.002) list.push({ value: other, idx: -1, name: 'cartelle piccole', grey: true });
        return list;
      }
      function draw() {
        var w = Math.max(300, panel.clientWidth || 800), h = Math.max(320, Math.min(560, Math.round(w * 0.5)));
        var d = Math.min(2, window.devicePixelRatio || 1);
        cv.width = Math.round(w * d); cv.height = Math.round(h * d); cv.style.width = w + 'px'; cv.style.height = h + 'px';
        cx2.setTransform(d, 0, 0, d, 0, 0);
        cx2.fillStyle = '#0b0b0e'; cx2.fillRect(0, 0, w, h);
        rects = R.squarify(items(cur), 0, 0, w, h);
        rects.forEach(function (rr) {
          var it = rr.it, on = hover === rr;
          cx2.fillStyle = it.grey ? (on ? '#4a4a55' : '#34343d') : 'hsl(' + hue(it.name) + ',' + (on ? 62 : 48) + '%,' + (on ? 40 : 30) + '%)';
          cx2.fillRect(rr.x + 1, rr.y + 1, Math.max(0, rr.w - 2), Math.max(0, rr.h - 2));
          if (it.idx >= 0 && kids[it.idx].length && rr.w > 24 && rr.h > 24) {
            cx2.strokeStyle = 'rgba(255,255,255,0.18)'; cx2.lineWidth = 1;
            cx2.strokeRect(rr.x + 3.5, rr.y + 3.5, rr.w - 7, rr.h - 7);
          }
          if (rr.w > 54 && rr.h > 20) {
            cx2.save();
            cx2.beginPath(); cx2.rect(rr.x + 4, rr.y + 2, rr.w - 8, rr.h - 4); cx2.clip();
            cx2.fillStyle = '#ffffff'; cx2.font = '600 12px system-ui, sans-serif'; cx2.textBaseline = 'top';
            cx2.fillText(it.name, rr.x + 6, rr.y + 5);
            if (rr.h > 36) { cx2.fillStyle = 'rgba(255,255,255,.75)'; cx2.font = '11px ' + MONO; cx2.fillText(R.bytes(it.value), rr.x + 6, rr.y + 21); }
            cx2.restore();
          }
        });
        crumbs.textContent = '';
        var chain = [];
        for (var k = cur; k >= 0; k = tree.parent[k]) chain.unshift(k);
        chain.forEach(function (k, i) {
          if (i) crumbs.appendChild(el('span', { class: 'sc-crumb-sep', text: '›', 'aria-hidden': 'true' }));
          var b = el('button', { type: 'button', class: 'wc-link', text: i === 0 ? R.treePath(tree, 0) : tree.names[k] });
          b.addEventListener('click', function () { cur = k; hover = null; draw(); });
          crumbs.appendChild(b);
        });
        upBtn.disabled = cur === 0;
        cv.setAttribute('aria-label', 'Mappa dello spazio di ' + R.treePath(tree, cur) + ': ' + rects.length + ' riquadri');
      }
      function at(e) {
        var b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
        for (var i = 0; i < rects.length; i++) { var rr = rects[i]; if (x >= rr.x && x < rr.x + rr.w && y >= rr.y && y < rr.y + rr.h) return rr; }
        return null;
      }
      cv.addEventListener('mousemove', function (e) {
        var rr = at(e);
        if (rr === hover) return;
        hover = rr; draw();
        if (rr) {
          var it = rr.it, parentTotal = tree.total[cur];
          info.textContent = it.name + ' — ' + R.bytes(it.value) + ' (' + (parentTotal ? (it.value * 100 / parentTotal).toLocaleString('it-IT', { maximumFractionDigits: 1 }) : '0') + '% di questa cartella)' +
            (it.idx >= 0 ? ' · ' + R.num(tree.files[it.idx]) + ' file diretti' + (kids[it.idx].length ? ' · clic per entrare' : '') : '');
        }
      });
      cv.addEventListener('mouseleave', function () { hover = null; draw(); });
      cv.addEventListener('click', function (e) { var rr = at(e); if (rr && rr.it.idx >= 0 && kids[rr.it.idx].length) { cur = rr.it.idx; hover = null; draw(); } });
      cv.addEventListener('keydown', function (e) { if ((e.key === 'Backspace' || e.key === 'ArrowUp') && cur > 0) { e.preventDefault(); cur = tree.parent[cur]; draw(); } });
      upBtn.addEventListener('click', function () { if (cur > 0) { cur = tree.parent[cur]; hover = null; draw(); } });
      showBtn.addEventListener('click', function () { api.showItem(R.treePath(tree, cur)); });
      var ro2 = new ResizeObserver(function () { draw(); });
      ro2.observe(panel);
      tmCleanup = function () { ro2.disconnect(); };
      draw();
    }

    // duplicati: si possono scegliere le copie da spostare nel Cestino (mai tutte quelle di un gruppo)
    var trashProgress = null;
    function renderDups(panel, r, s) {
      if (s.note) panel.appendChild(el('p', { class: 'wc-note sc-note', text: s.note }));
      var groups = (r.duplicates && r.duplicates.groups) || [];
      if (!groups.length) { panel.appendChild(el('p', { class: 'wc-note', text: 'Nessun duplicato.' })); return; }
      panel.appendChild(el('p', { class: 'wc-note sc-note sc-trash-note', text: 'Puoi spostare nel Cestino le copie che non ti servono: scegli i file e premi il pulsante. Prima di spostarli il programma controlla che ognuno sia identico byte per byte a una copia che resta, e ti chiede conferma. In ogni gruppo resta sempre almeno una copia. Finiscono nel Cestino: si possono ripristinare.' }));
      var sel = new Map(), moved = new Set(), boxes = [];
      var status = el('p', { class: 'wc-note', role: 'status' });
      var autoBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Scegli le copie (tieni la prima di ogni gruppo)' });
      var noneBtn = el('button', { type: 'button', class: 'wc-btn', text: 'Nessuna' });
      var goBtn = el('button', { type: 'button', class: 'wc-btn wc-danger', text: 'Sposta nel Cestino', disabled: 'disabled' });
      panel.appendChild(el('div', { class: 'wc-inline sc-trash-bar' }, [autoBtn, noneBtn, goBtn]));
      panel.appendChild(status);
      function count() {
        var n = 0, b = 0;
        sel.forEach(function (set, gi) { n += set.size; b += set.size * groups[gi].size; });
        goBtn.disabled = !n;
        goBtn.textContent = n ? 'Sposta nel Cestino ' + R.num(n) + ' file (' + R.bytes(b) + ')' : 'Sposta nel Cestino';
      }
      function setChecked(gi, p, on) {
        var set = sel.get(gi) || new Set();
        if (on) set.add(p); else set.delete(p);
        if (set.size) sel.set(gi, set); else sel.delete(gi);
      }
      var list = el('ol', { class: 'sc-dups' });
      groups.slice(0, 300).forEach(function (gr, gi) {
        var paths = gr.paths.slice().sort(function (a, b) { return a.length - b.length || a.localeCompare(b); });
        var li = el('li', { class: 'sc-dup' });
        li.appendChild(el('p', { class: 'sc-dup-head', text: R.num(gr.count) + ' copie da ' + R.bytes(gr.size) + ' · ' + R.bytes(gr.wasted) + ' sprecati · ' + (gr.exact ? 'identici' : 'molto probabili') }));
        var ul = el('ul');
        paths.forEach(function (p) {
          var cb = el('input', { type: 'checkbox', 'aria-label': 'Sposta nel Cestino: ' + p });
          cb.addEventListener('change', function () {
            var set = sel.get(gi);
            var free = gr.paths.length - (set ? set.size : 0) - gr.paths.filter(function (x) { return moved.has(x); }).length;
            if (cb.checked && free <= 1) { cb.checked = false; status.textContent = 'In ogni gruppo deve restare almeno una copia.'; return; }
            setChecked(gi, p, cb.checked); count();
          });
          var show = el('button', { type: 'button', class: 'wc-link', text: 'Mostra' });
          show.addEventListener('click', function () { api.showItem(p); });
          var row = el('li', {}, [el('label', { class: 'wc-check' }, [cb, el('span', { class: 'sc-dup-path', text: p })]), show]);
          boxes.push({ cb: cb, gi: gi, p: p, row: row, first: p === paths[0] });
          ul.appendChild(row);
        });
        li.appendChild(ul);
        list.appendChild(li);
      });
      panel.appendChild(list);
      if (groups.length > 300) panel.appendChild(el('p', { class: 'wc-note', text: 'Mostrati i primi 300 gruppi (i più pesanti).' }));
      autoBtn.addEventListener('click', function () {
        sel.clear();
        boxes.forEach(function (b) { if (moved.has(b.p)) return; b.cb.checked = !b.first; if (!b.first) setChecked(b.gi, b.p, true); });
        count();
      });
      noneBtn.addEventListener('click', function () { sel.clear(); boxes.forEach(function (b) { b.cb.checked = false; }); count(); });
      goBtn.addEventListener('click', function () {
        if (!api.trash) return;
        var items = [];
        sel.forEach(function (set, gi) { items.push({ group: gi, paths: Array.from(set) }); });
        if (!items.length) return;
        goBtn.disabled = true; autoBtn.disabled = true; noneBtn.disabled = true;
        status.textContent = 'Controllo che le copie siano identiche a quella che resta…';
        trashProgress = function (m) { status.textContent = 'Controllo che le copie siano identiche: ' + m.done + ' di ' + m.total + '…'; };
        api.trash(r.id, items).then(function (res) {
          trashProgress = null;
          (res.moved || []).forEach(function (p) { moved.add(p); });
          boxes.forEach(function (b) { if (moved.has(b.p)) { b.cb.checked = false; b.cb.disabled = true; b.row.classList.add('sc-moved'); } });
          sel.clear(); count();
          var parts = [];
          if (res.cancelled) parts.push('Annullato: nessun file spostato.');
          else parts.push('Spostati nel Cestino: ' + R.num((res.moved || []).length) + ' file (' + R.bytes(res.bytes || 0) + ').');
          if (res.failed && res.failed.length) parts.push(res.failed.length + ' non spostati: ' + res.failed.slice(0, 3).map(function (f) { return f.reason; }).join('; ') + '.');
          if (res.skipped && res.skipped.length) parts.push(res.skipped.length + ' saltati per sicurezza: ' + res.skipped.slice(0, 3).map(function (f) { return f.reason; }).join('; ') + '.');
          if (res.log) parts.push('Registro: ' + res.log);
          status.textContent = parts.join(' ');
        }).catch(function (e) { trashProgress = null; status.textContent = 'Errore: ' + e.message; })
          .then(function () { autoBtn.disabled = false; noneBtn.disabled = false; count(); });
      });
    }

    function showReport(r) {
      if (tmCleanup) { tmCleanup(); tmCleanup = null; }
      reportBox.textContent = '';
      reportBox.hidden = false;
      var tilesBox = el('div', { class: 'sc-tiles' });
      R.tiles(r).forEach(function (t) { tilesBox.appendChild(el('div', { class: 'sc-tile' }, [el('span', { text: t[0] }), el('b', { text: t[1] })])); });
      var exp = el('div', { class: 'wc-inline sc-export' });
      var note = el('p', { class: 'wc-note', role: 'status' });
      function addExport(label, fn) {
        var b = el('button', { type: 'button', class: 'wc-btn', text: label });
        b.addEventListener('click', function () { Promise.resolve(fn()).then(function (ok) { if (ok !== false) note.textContent = 'Salvato.'; }).catch(function (e) { note.textContent = 'Errore: ' + e.message; }); });
        exp.appendChild(b);
      }
      var stamp = new Date(r.finishedAt).toISOString().slice(0, 10);
      addExport('Rapporto completo (.html)', function () { return api.saveFile('scansione ' + stamp + ' - Word Crawler.html', R.html(r), 'text/html'); });
      addExport('Dati (.json)', function () { return api.saveFile('scansione ' + stamp + ' - Word Crawler.json', JSON.stringify(r, null, 2), 'application/json'); });
      if (r.csvPath) addExport('Elenco di tutti i file (.csv, ' + R.num(r.csvRows) + ' righe)', function () { return api.exportCsv(r.csvPath); });
      // confronto con una scansione precedente della stessa cartella
      var cmpSel = el('select', { 'aria-label': 'Confronta con una scansione precedente', hidden: 'hidden' }, [el('option', { value: '', text: 'Confronta con una scansione precedente…' })]);
      exp.appendChild(cmpSel);
      if (api.history && r.id) {
        api.history(r.root).then(function (list) {
          (list || []).filter(function (m) { return m.id !== r.id; }).forEach(function (m) {
            cmpSel.appendChild(el('option', { value: m.id, text: new Date(m.finishedAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) + ' · ' + R.num(m.files) + ' file · ' + R.bytes(m.bytes) + (m.partial ? ' (parziale)' : '') }));
          });
          cmpSel.hidden = cmpSel.options.length < 2;
        }).catch(function () {});
      }
      reportBox.appendChild(el('header', { class: 'sc-rhead' }, [
        el('div', {}, [el('h2', { text: 'Rapporto' }), el('p', { class: 'wc-note', text: r.root + ' · ' + new Date(r.finishedAt).toLocaleString('it-IT') + (r.partial ? ' · parziale' : '') })]),
        exp]));
      reportBox.appendChild(note);
      reportBox.appendChild(tilesBox);
      var defs = [{ title: 'Mappa', render: function (pn) { renderTreemap(pn, r); } }];
      R.sections(r).forEach(function (s) {
        defs.push({ title: s.title, render: function (pn) { if (s.id === 'dup' && api.trash && r.id) renderDups(pn, r, s); else renderSection(pn, s); } });
      });
      var tabs = el('div', { class: 'wc-tabs', role: 'tablist' });
      var panel = el('div', { class: 'sc-panel', role: 'tabpanel', tabindex: '0' });
      reportBox.appendChild(tabs);
      reportBox.appendChild(panel);
      function select(i) {
        if (tmCleanup) { tmCleanup(); tmCleanup = null; }
        Array.prototype.forEach.call(tabs.children, function (b, k) { b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
        panel.textContent = '';
        defs[i].render(panel);
      }
      function addTab(d) {
        defs.push(d);
        var i = defs.length - 1;
        var b = el('button', { type: 'button', role: 'tab', class: 'wc-tab', text: d.title });
        b.addEventListener('click', function () { select(i); });
        tabs.appendChild(b);
        return i;
      }
      var initial = defs.slice();
      defs = [];
      initial.forEach(addTab);
      var cmpTab = -1;
      cmpSel.addEventListener('change', function () {
        var id = cmpSel.value;
        if (!id) return;
        note.textContent = 'Confronto le due scansioni…';
        api.compare(id, r.id).then(function (c) {
          note.textContent = '';
          var secs = R.compareSections(c);
          var d = { title: 'Confronto', render: function (pn) {
            secs.forEach(function (s) { pn.appendChild(el('h3', { class: 'sc-subhead', text: s.title })); renderSection(pn, s); });
          } };
          if (cmpTab < 0) cmpTab = addTab(d); else defs[cmpTab] = d;
          select(cmpTab);
        }).catch(function (e) { note.textContent = 'Confronto non riuscito: ' + e.message; });
      });
      select(0);
      reportBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ---------------------------------------------------------------- controlli
    function readForm() {
      o.legs = +legs.value; o.duplicates = dups.value; o.minDupSize = +minDup.value; o.includeHidden = hidden.checked;
      o.sameDevice = same.checked; o.csv = csv.checked; o.excludes = excl.value; o.visDepth = +depth.value;
      legsOut.textContent = o.legs + (o.legs === 1 ? ' zampa' : ' zampe');
      depthOut.textContent = o.visDepth + ' livelli';
      minDup.disabled = o.duplicates === 'off';
      if (api.settings) api.settings.save(o);
    }
    function writeForm() {
      legs.value = o.legs; dups.value = o.duplicates; minDup.value = String(o.minDupSize); hidden.checked = o.includeHidden;
      same.checked = o.sameDevice; csv.checked = o.csv; excl.value = o.excludes; depth.value = o.visDepth;
      rootShown.textContent = o.root || 'Nessuna cartella scelta';
      readForm();
    }
    function setButtons() {
      startBtn.disabled = running || !o.root;
      stopBtn.disabled = !running;
      [rootSel, pickBtn, legs, dups, minDup, hidden, same, csv, excl].forEach(function (x) { x.disabled = running; });
      if (!running) minDup.disabled = o.duplicates === 'off';
    }
    [legs, dups, minDup, hidden, same, csv, excl, depth].forEach(function (x) { x.addEventListener(x.type === 'text' ? 'change' : 'input', function () { readForm(); if (x === depth) resize(); }); });
    rootSel.addEventListener('change', function () { if (rootSel.value) { o.root = rootSel.value; rootShown.textContent = o.root; readForm(); setButtons(); } });
    pickBtn.addEventListener('click', function () {
      api.pickFolder().then(function (p) { if (p) { o.root = p; rootShown.textContent = p; rootSel.value = ''; readForm(); setButtons(); } });
    });
    startBtn.addEventListener('click', function () {
      if (!o.root) return;
      readForm();
      report = null; reportBox.hidden = true; reportBox.textContent = '';
      resize();
      resetMap(o.root);
      phase = 'walk'; running = true; started = performance.now();
      active = new Array(o.legs).fill(null);
      setButtons();
      msg.textContent = 'Il ragno parte…';
      api.start({
        root: o.root, legs: o.legs, duplicates: o.duplicates, minDupSize: o.minDupSize, includeHidden: o.includeHidden, sameDevice: o.sameDevice,
        csv: o.csv, visDepth: o.visDepth, excludes: o.excludes.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      }).catch(function (e) { running = false; phase = 'idle'; msg.textContent = 'Non posso partire: ' + e.message; setButtons(); });
    });
    stopBtn.addEventListener('click', function () { api.cancel(); msg.textContent = 'Fermo il ragno: preparo il rapporto con quello che ha letto finora…'; });

    api.roots().then(function (list) {
      (list || []).forEach(function (r) { rootSel.appendChild(el('option', { value: r.path, text: r.label + ' — ' + r.path })); });
    }).catch(function () {});
    Promise.resolve(api.settings ? api.settings.load() : null).then(function (v) {
      if (v) Object.keys(o).forEach(function (k) { if (v[k] !== undefined) o[k] = v[k]; });
      if (typeof o.excludes !== 'string') o.excludes = DEFAULT_EXCLUDES;
      writeForm(); setButtons();
    });
    writeForm(); setButtons();

    var ro = new ResizeObserver(function () { resize(); });
    ro.observe(stage);
    resize();
    raf = requestAnimationFrame(frame);
    return { resize: resize };
  }

  g.WCScanView = { mount: mount };
})(globalThis);
