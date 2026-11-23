/* Musical material: chord voicings for each instrument and banjo roll patterns. */
(function (root) {
  'use strict';

  const SEMI = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
    'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
  };

  /** Note name (e.g. "F#4") to frequency in Hz, A4 = 440. */
  function freq(name) {
    const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
    if (!m) throw new Error('Bad note name: ' + name);
    const midi = (Number(m[2]) + 1) * 12 + SEMI[m[1]];
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // Banjo in open G (gDGBD). Index 0 = string 1 (high D), index 4 = 5th string (high g).
  const BANJO_OPEN = ['D4', 'B3', 'G3', 'D3', 'G4'];

  // Per chord:
  //  bass  - [root, fifth] for the upright bass (beats 1 and 3)
  //  boom  - [root, alternate] single bass-string note for the guitar's "boom"
  //  strum - guitar strings low -> high for a full strum
  //  chop  - mandolin chop voicing
  //  banjo - fret per banjo string, strings 1..5 (5th string always open)
  const CHORDS = {
    G:  { bass: ['G1', 'D2'], boom: ['G2', 'D2'], strum: ['G2', 'B2', 'D3', 'G3', 'B3', 'G4'], chop: ['G3', 'D4', 'B4', 'G5'],  banjo: [0, 0, 0, 0, 0] },
    C:  { bass: ['C2', 'G1'], boom: ['C3', 'G2'], strum: ['C3', 'E3', 'G3', 'C4', 'E4'],       chop: ['G3', 'E4', 'C5', 'E5'],  banjo: [2, 1, 0, 2, 0] },
    D:  { bass: ['D2', 'A1'], boom: ['D3', 'A2'], strum: ['D3', 'A3', 'D4', 'F#4'],            chop: ['A3', 'D4', 'A4', 'F#5'], banjo: [4, 3, 2, 0, 0] },
    A:  { bass: ['A1', 'E2'], boom: ['A2', 'E2'], strum: ['A2', 'E3', 'A3', 'C#4', 'E4'],      chop: ['A3', 'E4', 'C#5', 'A5'], banjo: [2, 2, 2, 2, 0] },
    E:  { bass: ['E2', 'B1'], boom: ['E2', 'B2'], strum: ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'], chop: ['G#3', 'E4', 'B4', 'G#5'], banjo: [2, 0, 1, 2, 0] },
    F:  { bass: ['F2', 'C2'], boom: ['F2', 'C3'], strum: ['F2', 'C3', 'F3', 'A3', 'C4', 'F4'], chop: ['A3', 'F4', 'C5', 'F5'],  banjo: [3, 1, 2, 3, 0] },
    Am: { bass: ['A1', 'E2'], boom: ['A2', 'E2'], strum: ['A2', 'E3', 'A3', 'C4', 'E4'],       chop: ['A3', 'E4', 'C5', 'A5'],  banjo: [2, 1, 2, 2, 0] },
    Em: { bass: ['E2', 'B1'], boom: ['E2', 'B2'], strum: ['E2', 'B2', 'E3', 'G3', 'B3', 'E4'], chop: ['G3', 'E4', 'B4', 'G5'],  banjo: [2, 0, 0, 2, 0] },
  };

  /** Frequency of a banjo string (1..5) fretted for a chord. */
  function banjoFreq(chordKey, string) {
    const fret = CHORDS[chordKey].banjo[string - 1];
    return freq(BANJO_OPEN[string - 1]) * Math.pow(2, fret / 12);
  }

  // Eight-note right-hand patterns; numbers are banjo strings (1 = high D, 5 = drone g).
  const ROLLS = {
    forward:        { name: 'Forward roll (T I M T I M T M)',  strings: [3, 2, 1, 5, 2, 1, 5, 1] },
    alternating:    { name: 'Alternating thumb (T I T M T I T M)', strings: [3, 2, 5, 1, 4, 2, 5, 1] },
    forwardReverse: { name: 'Forward-reverse (T I M T M I T M)', strings: [3, 2, 1, 5, 1, 2, 3, 1] },
  };

  /** Parse "G G C G | D D G G" into chord keys; unknown tokens are reported. */
  function parseProgression(text) {
    const tokens = String(text || '').trim().split(/[\s,|]+/).filter(Boolean);
    const chords = [];
    const unknown = [];
    for (const t of tokens) {
      const k = t.charAt(0).toUpperCase() + t.slice(1);
      if (CHORDS[k]) chords.push(k);
      else unknown.push(t);
    }
    return { chords, unknown };
  }

  const api = { freq, BANJO_OPEN, CHORDS, banjoFreq, ROLLS, parseProgression };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Music = api;
})(this);
