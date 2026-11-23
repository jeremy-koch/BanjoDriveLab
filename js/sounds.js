/* Synthesized instrument sounds, rendered once into AudioBuffers and cached.
 *
 * Every buffer starts its attack at sample 0, so a note's scheduled time IS
 * its onset. Keep it that way: if you add samples, trim leading silence.
 * (The bass has a 3 ms fade-in; everything else is under 0.5 ms.)
 *
 * Noise excitation is seeded from the note's key, so the live engine and the
 * offline export produce identical timbres.
 */
(function (root) {
  'use strict';

  const banks = new Map(); // sampleRate -> Map(key -> AudioBuffer)

  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** Karplus-Strong plucked string. */
  function karplus(sr, f, dur, o, rand) {
    const n = Math.floor(sr * dur);
    const out = new Float32Array(n);
    const N = Math.max(2, Math.round(sr / f));
    const ring = new Float32Array(N);
    let lp = 0;
    let mean = 0;
    for (let i = 0; i < N; i++) {
      lp += o.bright * (rand() * 2 - 1 - lp);
      ring[i] = lp;
      mean += lp;
    }
    mean /= N;
    for (let i = 0; i < N; i++) ring[i] -= mean;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const nxtIdx = idx + 1 === N ? 0 : idx + 1;
      const cur = ring[idx];
      out[i] = cur;
      ring[idx] = o.decay * (o.stretch * cur + (1 - o.stretch) * ring[nxtIdx]);
      idx = nxtIdx;
    }
    return out;
  }

  function onePoleLP(x, sr, fc) {
    const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    let y = 0;
    for (let i = 0; i < x.length; i++) {
      y += a * (x[i] - y);
      x[i] = y;
    }
    return x;
  }

  function onePoleHP(x, sr, fc) {
    const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    let lp = 0;
    for (let i = 0; i < x.length; i++) {
      lp += a * (x[i] - lp);
      x[i] = x[i] - lp;
    }
    return x;
  }

  function expEnv(x, sr, tau) {
    const k = Math.exp(-1 / (sr * tau));
    let g = 1;
    for (let i = 0; i < x.length; i++) {
      x[i] *= g;
      g *= k;
    }
    return x;
  }

  function fadeIn(x, sr, ms) {
    const n = Math.min(x.length, Math.max(1, Math.floor((sr * ms) / 1000)));
    for (let i = 0; i < n; i++) x[i] *= i / n;
    return x;
  }

  function fadeOut(x, sr, ms) {
    const n = Math.min(x.length, Math.max(1, Math.floor((sr * ms) / 1000)));
    const L = x.length;
    for (let i = 0; i < n; i++) x[L - 1 - i] *= i / n;
    return x;
  }

  function normalize(x, peak) {
    let m = 0;
    for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
    if (m > 0) {
      const g = peak / m;
      for (let i = 0; i < x.length; i++) x[i] *= g;
    }
    return x;
  }

  function mixInto(dst, src, gain) {
    const n = Math.min(dst.length, src.length);
    for (let i = 0; i < n; i++) dst[i] += src[i] * gain;
    return dst;
  }

  function noise(sr, dur, rand) {
    const x = new Float32Array(Math.floor(sr * dur));
    for (let i = 0; i < x.length; i++) x[i] = rand() * 2 - 1;
    return x;
  }

  const GEN = {
    banjo(sr, f, rand) {
      const x = karplus(sr, f, 1.2, { bright: 0.92, decay: 0.996, stretch: 0.5 }, rand);
      onePoleHP(x, sr, 250); // thin, twangy
      expEnv(x, sr, 0.5);
      normalize(x, 0.9);
      const pick = noise(sr, 0.004, rand); // metal fingerpick click
      onePoleHP(pick, sr, 2000);
      expEnv(pick, sr, 0.0008);
      mixInto(x, pick, 0.5);
      fadeIn(x, sr, 0.3);
      fadeOut(x, sr, 40);
      return x;
    },

    guitar(sr, f, rand) {
      const x = karplus(sr, f, 1.8, { bright: 0.55, decay: 0.998, stretch: 0.5 }, rand);
      onePoleHP(x, sr, 60);
      expEnv(x, sr, 0.9);
      normalize(x, 0.8);
      fadeIn(x, sr, 0.3);
      fadeOut(x, sr, 60);
      return x;
    },

    bass(sr, f) {
      const x = new Float32Array(Math.floor(sr * 1.0));
      const w = 2 * Math.PI * f;
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        x[i] = (Math.sin(w * t) + 0.45 * Math.sin(2 * w * t) + 0.2 * Math.sin(3 * w * t)) * Math.exp(-t / 0.35);
      }
      fadeIn(x, sr, 3);
      fadeOut(x, sr, 40);
      return normalize(x, 0.9);
    },

    chop(sr, freqs, rand) {
      const dur = 0.16;
      const x = new Float32Array(Math.floor(sr * dur));
      for (const f of freqs) {
        const s = karplus(sr, f, dur, { bright: 0.75, decay: 0.985, stretch: 0.5 }, rand);
        mixInto(x, normalize(s, 1), 1 / freqs.length);
      }
      expEnv(x, sr, 0.022); // left hand damps the strings almost immediately
      const nz = noise(sr, dur, rand);
      onePoleLP(nz, sr, 4000);
      onePoleHP(nz, sr, 800);
      expEnv(nz, sr, 0.007);
      mixInto(x, normalize(nz, 1), 0.35);
      normalize(x, 0.85);
      fadeIn(x, sr, 0.3);
      fadeOut(x, sr, 10);
      return x;
    },

    click(sr, accent) {
      const x = new Float32Array(Math.floor(sr * 0.03));
      const f = accent ? 1800 : 1200;
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        x[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.006);
      }
      return normalize(x, 0.9);
    },
  };

  function toBuffer(sr, data) {
    const b = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate: sr });
    b.copyToChannel(data, 0);
    return b;
  }

  function get(sr, key, make) {
    let bank = banks.get(sr);
    if (!bank) {
      bank = new Map();
      banks.set(sr, bank);
    }
    let b = bank.get(key);
    if (!b) {
      b = toBuffer(sr, make(root.Timing.mulberry32(hashSeed(key))));
      bank.set(key, b);
    }
    return b;
  }

  const Music = () => root.Music;

  const api = {
    banjo: (sr, f) => get(sr, 'banjo:' + f.toFixed(3), (r) => GEN.banjo(sr, f, r)),
    guitar: (sr, f) => get(sr, 'guitar:' + f.toFixed(3), (r) => GEN.guitar(sr, f, r)),
    bass: (sr, f) => get(sr, 'bass:' + f.toFixed(3), () => GEN.bass(sr, f)),
    chop: (sr, chordKey) =>
      get(sr, 'chop:' + chordKey, (r) => GEN.chop(sr, Music().CHORDS[chordKey].chop.map(Music().freq), r)),
    click: (sr, accent) => get(sr, 'click:' + (accent ? 1 : 0), () => GEN.click(sr, accent)),

    /** Render every buffer the engine may need, so playback never stalls. */
    prewarm(sr) {
      const M = Music();
      for (const key of Object.keys(M.CHORDS)) {
        const c = M.CHORDS[key];
        c.bass.forEach((n) => api.bass(sr, M.freq(n)));
        c.boom.forEach((n) => api.guitar(sr, M.freq(n)));
        c.strum.forEach((n) => api.guitar(sr, M.freq(n)));
        api.chop(sr, key);
        for (let s = 1; s <= 5; s++) api.banjo(sr, M.banjoFreq(key, s));
      }
      api.click(sr, true);
      api.click(sr, false);
    },

    _gen: GEN, // exposed for tests
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sounds = api;
})(this);
