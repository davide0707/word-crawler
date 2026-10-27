// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: modulo delle impostazioni, generato dall'elenco dei parametri (settings.js).
 * Ogni controllo mostra il valore e una riga che spiega cosa cambia.
 */
(function (g) {
  'use strict';
  if (g.WCSettingsUI) return;
  var S = g.WCSettings;

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  // Parametri che cambiano i risultati (servono una nuova lettura) e parametri solo grafici
  // (OCR e segni ritrovati valgono per il prossimo documento: non serve rileggere)
  var VISUAL = new Set(['speed', 'follow', 'theme', 'veil', 'webDensity', 'hud', 'ocr', 'ocrLang', 'restoreMarks']);

  /*
   * opts: { values, onChange(values, id), idPrefix, compact, hide?: [id dei parametri da non mostrare] }
   * -> { get(), set(values), root }
   */
  function render(container, opts) {
    var values = S.sanitize(opts.values);
    var prefix = opts.idPrefix || 'wc';
    var hide = new Set(opts.hide || []);
    container.textContent = '';
    container.classList.add('wc-settings');

    var presetSel = el('select', { id: prefix + '-preset', 'aria-label': 'Preset' }, [el('option', { value: '', text: 'Preset…' })]);
    Object.keys(S.PRESETS).forEach(function (k) { presetSel.appendChild(el('option', { value: k, text: S.PRESETS[k].label })); });
    var resetBtn = el('button', { type: 'button', class: 'wc-link', text: 'Ripristina' });
    container.appendChild(el('div', { class: 'wc-preset-row' }, [presetSel, resetBtn]));

    var fields = {};
    var groups = {};
    S.PARAMS.forEach(function (p) {
      if (!groups[p.group]) {
        var box = el('fieldset', { class: 'wc-group' }, [el('legend', { text: p.group })]);
        groups[p.group] = box;
        container.appendChild(box);
      }
      var id = prefix + '-' + p.id;
      var row = el('div', { class: 'wc-field wc-' + p.type, 'data-param': p.id });
      var out = null, input;
      if (p.type === 'range') {
        out = el('output', { for: id });
        input = el('input', { type: 'range', id: id, min: p.min, max: p.max, step: p.step || 1 });
        row.appendChild(el('div', { class: 'wc-row' }, [el('label', { for: id, class: 'wc-label', text: p.label }), out]));
        row.appendChild(input);
      } else if (p.type === 'toggle') {
        input = el('input', { type: 'checkbox', id: id });
        row.appendChild(el('label', { class: 'wc-check', for: id }, [input, el('span', { text: p.label })]));
      } else if (p.type === 'select') {
        input = el('select', { id: id });
        p.options.forEach(function (o) { input.appendChild(el('option', { value: o[0], text: o[1] })); });
        // la modalità ha già il titolo del gruppo
        if (p.id !== 'mode') row.appendChild(el('label', { for: id, class: 'wc-label', text: p.label }));
        else input.setAttribute('aria-label', p.label);
        row.appendChild(input);
      } else {
        input = el('input', { type: 'text', id: id, placeholder: p.placeholder || '', autocomplete: 'off', spellcheck: 'false' });
        row.appendChild(el('label', { for: id, class: 'wc-label', text: p.label }));
        row.appendChild(input);
      }
      row.appendChild(el('p', { class: 'wc-effect', text: p.effect }));
      groups[p.group].appendChild(row);
      fields[p.id] = { p: p, input: input, out: out, row: row };
      var evt = p.type === 'text' ? 'change' : 'input';
      input.addEventListener(evt, function () {
        values[p.id] = readField(fields[p.id]);
        values = S.sanitize(values);
        paint();
        presetSel.value = '';
        if (opts.onChange) opts.onChange(Object.assign({}, values), p.id);
      });
    });

    var modeDesc = el('p', { class: 'wc-mode-desc' });
    fields.mode.row.insertBefore(modeDesc, fields.mode.row.querySelector('.wc-effect'));
    fields.mode.row.querySelector('.wc-effect').remove();

    function readField(f) {
      if (f.p.type === 'range') return Number(f.input.value);
      if (f.p.type === 'toggle') return f.input.checked;
      return f.input.value;
    }
    function fmt(p, v) {
      if (p.scale) return p.scale[v - p.min] || String(v);
      return v + (p.unit ? ' ' + p.unit : '');
    }
    function paint() {
      Object.keys(fields).forEach(function (k) {
        var f = fields[k], v = values[k];
        if (f.p.type === 'toggle') f.input.checked = !!v; else if (document.activeElement !== f.input || f.p.type !== 'text') f.input.value = v;
        if (f.out) f.out.textContent = fmt(f.p, v);
        f.row.hidden = hide.has(k) || !!(f.p.modes && f.p.modes.indexOf(values.mode) < 0);
      });
      Object.keys(groups).forEach(function (gname) {
        var any = Array.prototype.some.call(groups[gname].querySelectorAll('.wc-field'), function (r) { return !r.hidden; });
        groups[gname].hidden = !any;
      });
      modeDesc.textContent = S.MODES[values.mode].desc;
    }
    presetSel.addEventListener('change', function () {
      if (!presetSel.value) return;
      values = S.applyPreset(values, presetSel.value);
      paint();
      if (opts.onChange) opts.onChange(Object.assign({}, values), 'preset');
    });
    resetBtn.addEventListener('click', function () {
      values = S.defaults();
      presetSel.value = '';
      paint();
      if (opts.onChange) opts.onChange(Object.assign({}, values), 'reset');
    });
    paint();
    return {
      root: container,
      get: function () { return Object.assign({}, values); },
      set: function (v) { values = S.sanitize(v); paint(); }
    };
  }

  g.WCSettingsUI = { render: render, VISUAL: VISUAL, el: el };
})(globalThis);
