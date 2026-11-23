/* Scheduling: the live look-ahead player and the offline WAV/CSV renderer.
 * Both go through scheduleSlot(), so what you hear is exactly what you export.
 */
(function (root) {
  'use strict';

  const { Timing, Music, Sounds } = root;

  const ORDER = ['bass', 'guitar', 'mandolin', 'banjo', 'click'];

  // Loudness balance between instruments (multiplied by the user's volume).
  const BASE_GAIN = { bass: 0.9, guitar: 0.32, mandolin: 0.55, banjo: 0.5, click: 0.45 };

  // Scheduling must start this far ahead of a slot's straight-grid time, so the
  // earliest possible note (max negative offset + jitter) can still be placed.
  const EARLY_MARGIN = 0.2; // s
  const LOOKAHEAD = 0.25; // s

  function inst(label, extra) {
    return Object.assign(
      { label, on: true, solo: false, vol: 1, pan: 0, swing: 50, downbeatMs: 0, offbeatMs: 0, jitterMs: 0, pattern: [0, 0, 0, 0, 0, 0, 0, 0] },
      extra
    );
  }

  function defaultSettings() {
    return {
      version: 1,
      bpm: 200,
      progression: 'G G C G D D G G',
      masterVol: 0.8,
      instruments: {
        bass: inst('Bass', { pan: 0, pattern: [1, 0, 0, 0, 1, 0, 0, 0] }),
        guitar: inst('Guitar', { pan: -0.35, spreadMs: 12, pattern: [1, 0, 1, 1, 1, 0, 1, 1] }),
        mandolin: inst('Mandolin chop', { pan: 0.35, pattern: [0, 0, 1, 0, 0, 0, 1, 0] }),
        banjo: inst('Banjo', { pan: 0.15, roll: 'forward', pattern: [1, 1, 1, 1, 1, 1, 1, 1] }),
        click: inst('Click (reference)', { on: false, vol: 0.8, pattern: [1, 0, 1, 0, 1, 0, 1, 0] }),
      },
    };
  }

  function audible(S, key) {
    const anySolo = ORDER.some((k) => S.instruments[k].solo);
    const i = S.instruments[key];
    return anySolo ? i.solo : i.on;
  }

  /** Which sounds an instrument makes at a slot: [{buf, dt (s), gain}]. */
  function notesFor(sr, S, key, chordKey, slot) {
    const i = S.instruments[key];
    const c = Music.CHORDS[chordKey];
    const half = slot >= 4 ? 1 : 0;
    switch (key) {
      case 'bass':
        return [{ buf: Sounds.bass(sr, Music.freq(c.bass[half])), dt: 0, gain: 1 }];
      case 'guitar': {
        if (slot === 0 || slot === 4) {
          return [{ buf: Sounds.guitar(sr, Music.freq(c.boom[half])), dt: 0, gain: 1.6 }];
        }
        const down = !Timing.isOffbeat(slot);
        const strings = down ? c.strum.slice() : c.strum.slice(-3).reverse();
        const spread = (i.spreadMs || 0) / 1000;
        return strings.map((n, k) => ({
          buf: Sounds.guitar(sr, Music.freq(n)),
          dt: strings.length > 1 ? (k * spread) / (strings.length - 1) : 0,
          gain: down ? 1 : 0.7,
        }));
      }
      case 'mandolin':
        return [{ buf: Sounds.chop(sr, chordKey), dt: 0, gain: 1 }];
      case 'banjo': {
        const roll = Music.ROLLS[i.roll] || Music.ROLLS.forward;
        return [{ buf: Sounds.banjo(sr, Music.banjoFreq(chordKey, roll.strings[slot])), dt: 0, gain: 1 }];
      }
      case 'click':
        return [{ buf: Sounds.click(sr, slot === 0), dt: 0, gain: 1 }];
      default:
        return [];
    }
  }

  /**
   * Schedule one instrument at one slot. Returns a log row (times in seconds,
   * relative to the context clock) or null if nothing was played.
   */
  function scheduleSlot(ctx, dest, S, key, chordKey, barStart, beatSec, slot, rand, barIdx) {
    const i = S.instruments[key];
    if (!i.pattern[slot] || !audible(S, key)) return null;
    const jit = Timing.jitterMs(i.jitterMs, rand);
    const t = Timing.eventSeconds(barStart, slot, beatSec, i, jit);
    const notes = notesFor(ctx.sampleRate, S, key, chordKey, slot);
    for (const n of notes) {
      const src = ctx.createBufferSource();
      src.buffer = n.buf;
      const g = ctx.createGain();
      g.gain.value = i.vol * n.gain * BASE_GAIN[key];
      const p = ctx.createStereoPanner();
      p.pan.value = i.pan;
      src.connect(g).connect(p).connect(dest);
      src.start(Math.max(t + n.dt, ctx.currentTime));
    }
    return {
      instrument: key,
      bar: barIdx + 1,
      slot,
      beat: Math.floor(slot / 2) + 1,
      position: Timing.isOffbeat(slot) ? 'off' : 'down',
      chord: chordKey,
      straightGrid: barStart + Timing.slotGridSeconds(slot, beatSec, 50),
      swungGrid: barStart + Timing.slotGridSeconds(slot, beatSec, i.swing),
      offsetMs: Timing.slotOffsetMs(i, slot),
      jitterMs: jit,
      onset: t,
    };
  }

  function chordsOf(S) {
    const c = Music.parseProgression(S.progression).chords;
    return c.length ? c : ['G'];
  }

  /* ---------------- Live playback ---------------- */

  class LiveEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.session = null;
      this.playing = false;
      this.active = null; // settings object currently being played
      this.activeLabel = 'Live';
      this.queued = null; // settings to switch to at the next bar line
      this.queuedLabel = null;
      this.onBeat = null; // (beatIndex 0..3) => void
      this.onActiveChange = null; // (label) => void
      this.beatQueue = [];
    }

    ensureContext() {
      if (this.ctx) return;
      const AC = root.AudioContext || root.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      Sounds.prewarm(this.ctx.sampleRate);
    }

    setMasterVolume(v) {
      if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }

    /** Switch what is playing. atBar: wait for the next bar line (used by A/B/X). */
    setActive(S, label, atBar) {
      if (atBar && this.playing) {
        this.queued = S;
        this.queuedLabel = label;
      } else {
        this.active = S;
        this.activeLabel = label;
        this.queued = null;
        if (this.onActiveChange) this.onActiveChange(label);
      }
    }

    async start(S, label) {
      this.ensureContext();
      await this.ctx.resume();
      this.active = S;
      this.activeLabel = label || 'Live';
      this.queued = null;
      this.session = this.ctx.createGain();
      this.session.connect(this.master);
      this.setMasterVolume(S.masterVol);
      this.playing = true;
      this.bar = 0;
      this.slot = 0;
      this.barStart = this.ctx.currentTime + EARLY_MARGIN + 0.05;
      this.beatQueue = [];
      this.beginBar();
      this.timer = setInterval(() => this.tick(), 20);
      this.tick();
      const loop = () => {
        if (!this.playing) return;
        const now = this.ctx.currentTime - (this.ctx.outputLatency || 0);
        while (this.beatQueue.length && this.beatQueue[0].t <= now) {
          const b = this.beatQueue.shift();
          if (this.onBeat) this.onBeat(b.beat);
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      if (this.onActiveChange) this.onActiveChange(this.activeLabel);
    }

    stop() {
      if (!this.playing) return;
      this.playing = false;
      clearInterval(this.timer);
      const s = this.session;
      const now = this.ctx.currentTime;
      s.gain.setValueAtTime(s.gain.value, now);
      s.gain.linearRampToValueAtTime(0, now + 0.05);
      setTimeout(() => s.disconnect(), 200);
      this.beatQueue = [];
      // Drop any pending A/B/X switch so the next Play starts clean.
      this.queued = null;
      this.queuedLabel = null;
      if (this.onBeat) this.onBeat(-1);
      if (this.onActiveChange) this.onActiveChange('Stopped');
    }

    beginBar() {
      if (this.queued) {
        this.active = this.queued;
        this.activeLabel = this.queuedLabel;
        this.queued = null;
        if (this.onActiveChange) this.onActiveChange(this.activeLabel);
      }
      const S = this.active;
      this.beatSec = Timing.beatSeconds(S.bpm);
      const chords = chordsOf(S);
      this.chord = chords[this.bar % chords.length];
      for (let b = 0; b < 4; b++) this.beatQueue.push({ t: this.barStart + b * this.beatSec, beat: b });
    }

    tick() {
      const horizon = this.ctx.currentTime + LOOKAHEAD;
      while (this.playing) {
        const earliest = this.barStart + Timing.slotGridSeconds(this.slot, this.beatSec, 50) - EARLY_MARGIN;
        if (earliest > horizon) break;
        for (const key of ORDER) {
          scheduleSlot(this.ctx, this.session, this.active, key, this.chord, this.barStart, this.beatSec, this.slot, Math.random, this.bar);
        }
        this.slot++;
        if (this.slot === Timing.SLOTS_PER_BAR) {
          this.slot = 0;
          this.barStart += Timing.BEATS_PER_BAR * this.beatSec;
          this.bar++;
          this.beginBar();
        }
      }
    }
  }

  /* ---------------- Offline export ---------------- */

  function encodeWav(buffer) {
    const ch = buffer.numberOfChannels;
    const len = buffer.length;
    const sr = buffer.sampleRate;
    const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF');
    data.setUint32(4, 36 + len * ch * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    data.setUint32(16, 16, true);
    data.setUint16(20, 1, true);
    data.setUint16(22, ch, true);
    data.setUint32(24, sr, true);
    data.setUint32(28, sr * ch * 2, true);
    data.setUint16(32, ch * 2, true);
    data.setUint16(34, 16, true);
    str(36, 'data');
    data.setUint32(40, len * ch * 2, true);
    const chans = [];
    for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < ch; c++) {
        const v = Math.max(-1, Math.min(1, chans[c][i]));
        data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
        o += 2;
      }
    }
    return new Blob([data], { type: 'audio/wav' });
  }

  const CSV_COLUMNS = [
    'instrument', 'bar', 'beat', 'slot', 'position', 'chord',
    'straight_grid_ms', 'swung_grid_ms', 'offset_ms', 'jitter_ms', 'onset_ms', 'onset_vs_straight_ms',
  ];

  function toCsv(rows) {
    const f = (x) => (Math.round(x * 1000) / 1000).toString();
    const lines = [CSV_COLUMNS.join(',')];
    for (const r of rows) {
      lines.push([
        r.instrument, r.bar, r.beat, r.slot, r.position, r.chord,
        f(r.straightGrid * 1000), f(r.swungGrid * 1000), f(r.offsetMs), f(r.jitterMs),
        f(r.onset * 1000), f((r.onset - r.straightGrid) * 1000),
      ].join(','));
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Render `bars` bars to a WAV plus a CSV of the exact onset of every note
   * (ground truth for testing timing analysis). Times are ms from file start.
   */
  async function renderOffline(S, bars, seed) {
    const sr = 44100;
    Sounds.prewarm(sr);
    const rand = Timing.mulberry32(seed || 1);
    const beatSec = Timing.beatSeconds(S.bpm);
    const lead = 0.5;
    const dur = lead + bars * Timing.BEATS_PER_BAR * beatSec + 2;
    const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
    const master = ctx.createGain();
    master.gain.value = S.masterVol;
    master.connect(ctx.destination);
    const chords = chordsOf(S);
    const rows = [];
    for (let bar = 0; bar < bars; bar++) {
      const barStart = lead + bar * Timing.BEATS_PER_BAR * beatSec;
      const chord = chords[bar % chords.length];
      for (let slot = 0; slot < Timing.SLOTS_PER_BAR; slot++) {
        for (const key of ORDER) {
          const r = scheduleSlot(ctx, master, S, key, chord, barStart, beatSec, slot, rand, bar);
          if (r) rows.push(r);
        }
      }
    }
    const buffer = await ctx.startRendering();
    rows.sort((a, b) => a.onset - b.onset);
    return { wav: encodeWav(buffer), csv: toCsv(rows) };
  }

  root.Engine = { ORDER, defaultSettings, LiveEngine, renderOffline, scheduleSlot, audible };
})(this);
