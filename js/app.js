/* UI: controls, diagram, readout, presets, ABX test, export, share. */
(function () {
  'use strict';

  const { Timing, Music, Engine } = window;

  const STORE_KEY = 'banjo-drive-lab:v1';
  const ORDER = Engine.ORDER;
  const BAND = ['bass', 'guitar', 'mandolin'];
  const PITCHED = ['bass', 'guitar', 'mandolin', 'banjo']; // rows in the diagram
  const COLORS = { bass: '#6d4fb3', guitar: '#c4741f', mandolin: '#1f8a68', banjo: '#c23b2e', click: '#6b7280' };
  const SLOT_LABELS = ['1', '&', '2', '&', '3', '&', '4', '&'];

  const $ = (s) => document.querySelector(s);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmt = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toString();

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }

  /** Fill in anything missing from saved/shared settings with defaults. */
  function mergeDefaults(def, obj) {
    if (Array.isArray(def)) return Array.isArray(obj) && obj.length === def.length ? obj.slice() : def.slice();
    if (def && typeof def === 'object') {
      const out = {};
      for (const k of Object.keys(def)) out[k] = mergeDefaults(def[k], obj ? obj[k] : undefined);
      return out;
    }
    return typeof obj === typeof def ? obj : def;
  }

  /* ---------------- State & persistence ---------------- */

  function encodeSettings(S) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(S)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeSettings(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  }

  function loadInitial() {
    const def = Engine.defaultSettings();
    const m = /[#&]s=([^&]+)/.exec(location.hash);
    if (m) {
      try { return mergeDefaults(def, decodeSettings(m[1])); } catch (e) { /* bad link: fall through */ }
    }
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return mergeDefaults(def, JSON.parse(raw));
    } catch (e) { /* storage unavailable */ }
    return def;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
  }

  let S = loadInitial();
  const engine = new Engine.LiveEngine();

  /** Call after any edit to S. */
  function changed(opts) {
    save();
    syncTransport();
    drawDiagram();
    updateReadout();
    engine.setActive(S, 'Live', false);
    engine.setMasterVolume(S.masterVol);
    if (opts && opts.rebuild) buildInstruments();
  }

  /* ---------------- Generic slider + number control ---------------- */

  function control(label, get, set, min, max, step, title) {
    const range = el('input', { type: 'range', min, max, step });
    const num = el('input', { type: 'number', min, max, step });
    const sync = () => { range.value = get(); num.value = get(); };
    range.addEventListener('input', () => { set(Number(range.value)); num.value = range.value; changed(); });
    num.addEventListener('change', () => {
      const v = clamp(Number(num.value) || 0, Number(min), Number(max));
      set(v); sync(); changed();
    });
    sync();
    return el('label', { class: 'ctl', title: title || '' }, el('span', { class: 'ctl-label' }, label), el('span', { class: 'ctl-inputs' }, range, num));
  }

  function bindPair(rangeId, numId, get, set) {
    const r = $(rangeId);
    const n = $(numId);
    r.addEventListener('input', () => { set(Number(r.value)); changed(); });
    n.addEventListener('change', () => {
      set(clamp(Number(n.value) || 0, Number(n.min), Number(n.max)));
      changed();
    });
    return () => { r.value = get(); n.value = get(); };
  }

  /* ---------------- Transport ---------------- */

  const syncers = [
    bindPair('#bpm', '#bpmNum', () => S.bpm, (v) => { S.bpm = v; }),
    bindPair('#bandSwing', '#bandSwingNum', () => S.instruments.guitar.swing, (v) => {
      BAND.forEach((k) => { S.instruments[k].swing = v; });
      refreshInstrumentValues();
    }),
    bindPair('#masterVol', '#masterVolNum', () => S.masterVol, (v) => { S.masterVol = v; }),
  ];

  $('#progression').addEventListener('input', (e) => { S.progression = e.target.value; changed(); });

  function syncTransport() {
    syncers.forEach((f) => f());
    const prog = $('#progression');
    if (document.activeElement !== prog) prog.value = S.progression;
    const p = Music.parseProgression(S.progression);
    $('#progHint').textContent = p.unknown.length
      ? `Ignoring: ${p.unknown.join(' ')} (known: ${Object.keys(Music.CHORDS).join(' ')})`
      : `${p.chords.length || 1}-bar loop. Chords: ${Object.keys(Music.CHORDS).join(' ')}`;
  }

  async function togglePlay() {
    if (engine.playing) {
      engine.stop();
    } else {
      await engine.start(S, 'Live');
    }
    updatePlayButton();
  }
  function updatePlayButton() {
    $('#play').textContent = engine.playing ? '■ Stop' : '▶ Play';
  }
  $('#play').addEventListener('click', togglePlay);

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
    e.preventDefault();
    togglePlay();
  });

  const dots = Array.from(document.querySelectorAll('#beats span'));
  engine.onBeat = (b) => {
    dots.forEach((d, i) => {
      d.classList.toggle('lit', i === b);
      d.classList.toggle('first', i === 0);
    });
  };
  engine.onActiveChange = (label) => {
    if (label === 'Stopped') {
      $('#nowPlaying').textContent = 'Stopped';
      return;
    }
    const extra = label === 'Live' ? ' (your current settings)' : '';
    $('#nowPlaying').innerHTML = `Now playing: <b>${label}</b>${extra}`;
  };

  /* ---------------- Instruments ---------------- */

  let instrumentRefreshers = [];

  function buildInstruments() {
    const host = $('#instruments');
    host.innerHTML = '';
    instrumentRefreshers = [];
    for (const key of ORDER) host.append(instrumentCard(key));
  }

  function refreshInstrumentValues() {
    instrumentRefreshers.forEach((f) => f());
  }

  function instrumentCard(key) {
    const I = () => S.instruments[key];
    const card = el('div', { class: 'panel inst', style: `--c:${COLORS[key]}` });

    const onBtn = el('button', { class: 'small', title: 'Mute / unmute' });
    const soloBtn = el('button', { class: 'small', title: 'Solo' }, 'Solo');
    const refreshHead = () => {
      onBtn.textContent = I().on ? 'On' : 'Muted';
      onBtn.classList.toggle('on', I().on);
      soloBtn.classList.toggle('on', I().solo);
      card.classList.toggle('silent', !Engine.audible(S, key));
    };
    onBtn.addEventListener('click', () => { I().on = !I().on; changed(); refreshAllHeads(); });
    soloBtn.addEventListener('click', () => { I().solo = !I().solo; changed(); refreshAllHeads(); });
    instrumentRefreshers.push(refreshHead);

    card.append(el('div', { class: 'inst-head' }, el('h3', {}, I().label), onBtn, soloBtn));

    const ctls = el('div', { class: 'inst-ctls' });
    const add = (...args) => {
      const c = control(...args);
      ctls.append(c);
      const [r, n] = c.querySelectorAll('input');
      instrumentRefreshers.push(() => { r.value = args[1](); n.value = args[1](); });
    };

    add('Volume', () => I().vol, (v) => { I().vol = v; }, 0, 1.5, 0.01);
    add('Pan', () => I().pan, (v) => { I().pan = v; }, -1, 1, 0.05);
    if (key !== 'click') {
      add('Swing %', () => I().swing, (v) => { I().swing = v; }, 50, 75, 0.5, '50 = straight, 66.7 = triplet');
    }
    add('Downbeat offset ms', () => I().downbeatMs, (v) => { I().downbeatMs = v; }, -100, 100, 1, 'Negative = early');
    if (key !== 'click') {
      add('Offbeat offset ms', () => I().offbeatMs, (v) => { I().offbeatMs = v; }, -100, 100, 1, 'Negative = early');
      add('Scatter (SD) ms', () => I().jitterMs, (v) => { I().jitterMs = v; }, 0, 20, 0.5, 'Random human timing error');
    }
    if (key === 'guitar') {
      add('Strum spread ms', () => I().spreadMs, (v) => { I().spreadMs = v; }, 0, 40, 1, 'Time from first to last string of a strum. The note time is the first string.');
    }
    if (key === 'banjo') {
      const sel = el('select', {}, Object.entries(Music.ROLLS).map(([k, r]) => el('option', { value: k }, r.name)));
      sel.value = I().roll;
      sel.addEventListener('change', () => { I().roll = sel.value; changed(); });
      instrumentRefreshers.push(() => { sel.value = I().roll; });
      ctls.append(el('label', { class: 'ctl' }, el('span', { class: 'ctl-label' }, 'Roll'), sel));
    }
    card.append(ctls);

    const pattern = el('div', { class: 'pattern', title: 'Which eighth notes this instrument plays' });
    const cells = SLOT_LABELS.map((lab, slot) => {
      const b = el('button', { class: slot % 2 ? 'off-slot' : '' }, lab);
      b.addEventListener('click', () => {
        I().pattern[slot] = I().pattern[slot] ? 0 : 1;
        refreshCells();
        changed();
      });
      pattern.append(b);
      return b;
    });
    const refreshCells = () => cells.forEach((b, i) => b.classList.toggle('active', !!I().pattern[i]));
    instrumentRefreshers.push(refreshCells);
    card.append(pattern);

    refreshHead();
    refreshCells();
    return card;
  }

  function refreshAllHeads() {
    refreshInstrumentValues();
  }

  /* ---------------- Diagram ---------------- */

  function drawDiagram() {
    const cv = $('#diagram');
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 800;
    const rowH = 36;
    const top = 34;
    const bottom = 30;
    const H = top + PITCHED.length * rowH + bottom;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const beatSec = Timing.beatSeconds(S.bpm);
    const beatMs = beatSec * 1000;
    const x0 = -Math.max(40, beatMs * 0.15);
    const x1 = beatMs + Math.max(25, beatMs * 0.1);
    const left = 112;
    const right = W - 14;
    const X = (ms) => left + ((ms - x0) / (x1 - x0)) * (right - left);
    const yTop = top;
    const yBot = top + PITCHED.length * rowH;

    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';

    // Reference lines
    const refs = [
      { ms: 0, label: 'beat', dash: [], color: '#1f1b16' },
      { ms: beatMs / 2, label: 'straight &', dash: [5, 4], color: '#8a8175' },
      { ms: (beatMs * 2) / 3, label: 'triplet &', dash: [2, 3], color: '#8a8175' },
      { ms: beatMs, label: 'next beat', dash: [], color: '#1f1b16' },
    ];
    for (const r of refs) {
      g.strokeStyle = r.color;
      g.setLineDash(r.dash);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(X(r.ms), yTop - 6);
      g.lineTo(X(r.ms), yBot);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = r.color;
      g.textAlign = 'center';
      g.fillText(r.label, X(r.ms), 12);
      g.fillText(fmt(r.ms, 0) + ' ms', X(r.ms), 24);
    }

    // Axis ticks
    const pxPerMs = (right - left) / (x1 - x0);
    const step = [5, 10, 25, 50, 100, 200].find((s) => s * pxPerMs >= 40) || 200;
    g.strokeStyle = '#d6cfc4';
    g.fillStyle = '#8a8175';
    g.textAlign = 'center';
    for (let ms = Math.ceil(x0 / step) * step; ms <= x1; ms += step) {
      g.beginPath();
      g.moveTo(X(ms), yBot);
      g.lineTo(X(ms), yBot + 5);
      g.stroke();
      g.fillText(String(ms), X(ms), yBot + 14);
    }
    g.textAlign = 'left';
    g.fillText('ms from the beat', left - 104, yBot + 14);

    // Rows
    PITCHED.forEach((key, idx) => {
      const I = S.instruments[key];
      const y = top + idx * rowH + rowH / 2;
      const color = COLORS[key];
      const silent = !Engine.audible(S, key);
      g.globalAlpha = silent ? 0.35 : 1;

      g.strokeStyle = '#efe9e0';
      g.beginPath();
      g.moveTo(left, y);
      g.lineTo(right, y);
      g.stroke();

      g.fillStyle = color;
      g.textAlign = 'left';
      g.font = '600 12px system-ui, sans-serif';
      g.fillText(I.label.replace(' chop', ''), 8, y);
      g.font = '11px system-ui, sans-serif';

      const playsDown = I.pattern.some((v, i) => v && i % 2 === 0);
      const playsOff = I.pattern.some((v, i) => v && i % 2 === 1);
      const marks = [
        { ms: I.downbeatMs, plays: playsDown },
        { ms: Timing.offbeatPositionMs(I, beatSec), plays: playsOff },
        { ms: beatMs + I.downbeatMs, plays: playsDown },
      ];
      for (const m of marks) {
        if (I.jitterMs > 0) {
          g.fillStyle = color + '33';
          g.fillRect(X(m.ms - I.jitterMs), y - 9, X(m.ms + I.jitterMs) - X(m.ms - I.jitterMs), 18);
        }
        g.beginPath();
        g.arc(X(m.ms), y, 6, 0, Math.PI * 2);
        if (m.plays) {
          g.fillStyle = color;
          g.fill();
        } else {
          g.strokeStyle = color;
          g.lineWidth = 1.5;
          g.stroke();
          g.lineWidth = 1;
        }
      }
      // Label the offbeat position
      g.fillStyle = color;
      g.textAlign = 'left';
      const offMs = Timing.offbeatPositionMs(I, beatSec);
      g.fillText(fmt(offMs) + ' ms', X(offMs) + 10, y - 10);
      if (I.downbeatMs !== 0) g.fillText((I.downbeatMs > 0 ? '+' : '') + fmt(I.downbeatMs) + ' ms', X(I.downbeatMs) + 10, y - 10);
      g.globalAlpha = 1;
    });
  }

  window.addEventListener('resize', drawDiagram);

  /* ---------------- Readout ---------------- */

  function describeDelta(ms, beatMs) {
    if (Math.abs(ms) < 0.05) return 'together';
    const pct = fmt((Math.abs(ms) / beatMs) * 100);
    return `<b>${fmt(Math.abs(ms))} ms ${ms < 0 ? 'ahead' : 'behind'}</b> (${pct}% of a beat)`;
  }

  function updateReadout() {
    const beatSec = Timing.beatSeconds(S.bpm);
    const beatMs = beatSec * 1000;
    const banjo = S.instruments.banjo;
    const lines = [`<div class="big">At ${S.bpm} BPM one beat is ${fmt(beatMs)} ms; a straight eighth is ${fmt(beatMs / 2)} ms.</div>`];
    for (const k of BAND) {
      const I = S.instruments[k];
      const rel = Timing.relativeMs(banjo, I, beatSec);
      const playsDown = I.pattern.some((v, i) => v && i % 2 === 0);
      const playsOff = I.pattern.some((v, i) => v && i % 2 === 1);
      const down = playsDown ? describeDelta(rel.down, beatMs) : '<span class="muted">n/a (it plays none)</span>';
      const off = playsOff ? describeDelta(rel.off, beatMs) : '<span class="muted">n/a (it plays none)</span>';
      lines.push(`<div>Banjo vs <b style="color:${COLORS[k]}">${I.label}</b>: downbeats ${down}; offbeats ${off}</div>`);
    }
    $('#readout').innerHTML = lines.join('');
  }

  /* ---------------- Presets ---------------- */

  const PRESETS = [
    { name: 'Straight & tight', desc: 'Everyone on a straight-eighth grid with no offsets. The baseline.', apply: () => {} },
    {
      name: 'Band swings, banjo straight',
      desc: 'Band swung to 60%; banjo plays straight eighths. Theory 1.',
      apply: (s) => BAND.forEach((k) => { s.instruments[k].swing = 60; }),
    },
    {
      name: 'Banjo ahead on every note',
      desc: 'Everyone straight; every banjo note 15 ms early. Theory 2.',
      apply: (s) => { s.instruments.banjo.downbeatMs = -15; s.instruments.banjo.offbeatMs = -15; },
    },
    {
      name: 'Banjo ahead on offbeats only',
      desc: 'Everyone straight; banjo "&"s 20 ms early, downbeats on the grid.',
      apply: (s) => { s.instruments.banjo.offbeatMs = -20; },
    },
    {
      name: 'Laid-back banjo',
      desc: 'Every banjo note 15 ms late, for contrast.',
      apply: (s) => { s.instruments.banjo.downbeatMs = 15; s.instruments.banjo.offbeatMs = 15; },
    },
    {
      name: 'Human scatter',
      desc: 'Baseline plus random timing error: band SD 6 ms, banjo SD 8 ms.',
      apply: (s) => { BAND.forEach((k) => { s.instruments[k].jitterMs = 6; }); s.instruments.banjo.jitterMs = 8; },
    },
  ];

  const TIMING_KEYS = ['swing', 'downbeatMs', 'offbeatMs', 'jitterMs'];

  function applyPreset(p) {
    const fresh = Engine.defaultSettings();
    for (const k of ORDER) {
      for (const t of TIMING_KEYS) S.instruments[k][t] = fresh.instruments[k][t];
    }
    p.apply(S);
    refreshInstrumentValues();
    changed();
  }

  function buildPresets() {
    const host = $('#presets');
    for (const p of PRESETS) {
      host.append(el('button', { class: 'preset', onclick: () => applyPreset(p) }, el('b', {}, p.name), el('span', {}, p.desc)));
    }
  }

  /* ---------------- ABX blind test ---------------- */

  const abx = { A: null, B: null, x: null, correct: 0, total: 0 };

  function describe(s) {
    const b = s.instruments.banjo;
    const g = s.instruments.guitar;
    return `${s.bpm} BPM · band swing ${g.swing}% · banjo swing ${b.swing}% · banjo offsets ${b.downbeatMs} / ${b.offbeatMs} ms (down/off) · banjo scatter ${b.jitterMs} ms`;
  }

  function binomialTail(k, n) {
    // P(X >= k) for X ~ Binomial(n, 0.5)
    let sum = 0;
    let c = 1; // C(n, 0)
    for (let i = 0; i <= n; i++) {
      if (i >= k) sum += c;
      c = (c * (n - i)) / (i + 1);
    }
    return sum / 2 ** n;
  }

  function refreshAbx() {
    $('#playA').disabled = !abx.A;
    $('#playB').disabled = !abx.B;
    const ready = !!(abx.A && abx.B);
    $('#playX').disabled = !ready;
    $('#guessA').disabled = !ready || abx.x == null;
    $('#guessB').disabled = !ready || abx.x == null;
    $('#descA').textContent = abx.A ? describe(abx.A) : 'Empty';
    $('#descB').textContent = abx.B ? describe(abx.B) : 'Empty';
    if (abx.total === 0) {
      $('#abxScore').textContent = 'No guesses yet.';
    } else {
      const p = binomialTail(abx.correct, abx.total);
      $('#abxScore').textContent =
        `${abx.correct} / ${abx.total} correct. Chance of scoring at least this well by pure guessing: ${(p * 100).toFixed(1)}%` +
        (abx.total < 10 ? ' (do at least 10–16 trials)' : '');
    }
  }

  function newX() {
    abx.x = Math.random() < 0.5 ? 'A' : 'B';
  }

  async function audition(label, settings) {
    if (!engine.playing) {
      await engine.start(clone(settings), label);
      updatePlayButton();
    } else {
      engine.setActive(clone(settings), label, true);
      $('#nowPlaying').innerHTML = `Switching to <b>${label}</b> at the next bar…`;
    }
  }

  $('#saveA').addEventListener('click', () => { abx.A = clone(S); abx.x = null; refreshAbx(); });
  $('#saveB').addEventListener('click', () => { abx.B = clone(S); abx.x = null; refreshAbx(); });
  $('#playA').addEventListener('click', () => audition('A', abx.A));
  $('#playB').addEventListener('click', () => audition('B', abx.B));
  $('#playX').addEventListener('click', () => {
    if (abx.x == null) newX();
    refreshAbx();
    audition('X', abx[abx.x]);
  });
  $('#playLive').addEventListener('click', () => {
    if (engine.playing) {
      engine.setActive(S, 'Live', true);
      $('#nowPlaying').innerHTML = 'Switching to <b>Live</b> at the next bar…';
    }
  });

  function guess(g) {
    if (abx.x == null) return;
    const ok = g === abx.x;
    abx.total++;
    if (ok) abx.correct++;
    const res = $('#abxResult');
    res.textContent = ok ? `Correct: X was ${abx.x}.` : `Wrong: X was ${abx.x}.`;
    res.className = 'abx-result ' + (ok ? 'good' : 'bad');
    newX();
    if (engine.playing && engine.activeLabel === 'X') audition('X', abx[abx.x]);
    refreshAbx();
  }
  $('#guessA').addEventListener('click', () => guess('A'));
  $('#guessB').addEventListener('click', () => guess('B'));
  $('#abxReset').addEventListener('click', () => {
    abx.correct = 0;
    abx.total = 0;
    $('#abxResult').textContent = '';
    refreshAbx();
  });

  /* ---------------- Export ---------------- */

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  $('#export').addEventListener('click', async () => {
    const btn = $('#export');
    const status = $('#exportStatus');
    const bars = clamp(parseInt($('#exportBars').value, 10) || 16, 1, 64);
    const seed = Math.max(1, parseInt($('#exportSeed').value, 10) || 1);
    btn.disabled = true;
    status.textContent = 'Rendering…';
    try {
      const { wav, csv } = await Engine.renderOffline(clone(S), bars, seed);
      const b = S.instruments.banjo;
      const name = `banjo-drive_${S.bpm}bpm_swing${S.instruments.guitar.swing}_banjo${b.downbeatMs}_${b.offbeatMs}_seed${seed}`;
      download(wav, name + '.wav');
      download(new Blob([csv], { type: 'text/csv' }), name + '.csv');
      status.textContent = `Done: ${bars} bars. Onset times in the CSV are ms from the start of the WAV.`;
    } catch (e) {
      status.textContent = 'Export failed: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------------- Share & reset ---------------- */

  $('#share').addEventListener('click', async () => {
    const url = location.href.split('#')[0] + '#s=' + encodeSettings(S);
    const out = $('#shareUrl');
    out.value = url;
    try {
      await navigator.clipboard.writeText(url);
      out.placeholder = 'Copied';
    } catch (e) {
      out.select();
    }
  });

  $('#resetAll').addEventListener('click', () => {
    S = Engine.defaultSettings();
    history.replaceState(null, '', location.pathname + location.search);
    buildInstruments();
    changed();
  });

  /* ---------------- Init ---------------- */

  buildPresets();
  buildInstruments();
  refreshAbx();
  syncTransport();
  drawDiagram();
  updateReadout();
})();
