/* Timing model: pure functions, no browser APIs.
 * Shared by the live engine, the offline renderer, the diagram and the tests.
 *
 * Conventions (keep these consistent everywhere):
 *  - A bar is 4 beats (quarter notes) split into 8 eighth-note "slots" (0..7).
 *  - Even slots are downbeats (on the beat); odd slots are offbeats (the "&").
 *  - swing is a percentage: where the offbeat falls inside the beat.
 *      50   = straight eighths
 *      66.7 = triplet swing (2:1)
 *      75   = dotted-eighth + sixteenth (3:1)
 *  - Offsets are in milliseconds. NEGATIVE = EARLY (ahead of the grid),
 *    POSITIVE = LATE (behind the grid).
 */
(function (root) {
  'use strict';

  const SLOTS_PER_BAR = 8;
  const BEATS_PER_BAR = 4;

  function beatSeconds(bpm) {
    return 60 / bpm;
  }

  function isOffbeat(slot) {
    return slot % 2 === 1;
  }

  /** Seconds from the bar start to the grid position of a slot, for a swing %. */
  function slotGridSeconds(slot, beatSec, swingPct) {
    const beat = Math.floor(slot / 2);
    return beat * beatSec + (isOffbeat(slot) ? (swingPct / 100) * beatSec : 0);
  }

  /** The instrument's fixed offset (ms) for this slot. */
  function slotOffsetMs(inst, slot) {
    return isOffbeat(slot) ? inst.offbeatMs : inst.downbeatMs;
  }

  /** Absolute time (s) a note should sound: grid + swing + offset + jitter. */
  function eventSeconds(barStart, slot, beatSec, inst, jitterMs) {
    return (
      barStart +
      slotGridSeconds(slot, beatSec, inst.swing) +
      (slotOffsetMs(inst, slot) + (jitterMs || 0)) / 1000
    );
  }

  /** Where an instrument's offbeat lands, in ms after the beat (no jitter). */
  function offbeatPositionMs(inst, beatSec) {
    return (inst.swing / 100) * beatSec * 1000 + inst.offbeatMs;
  }

  /** Timing of instrument a relative to b, in ms. Negative = a is earlier. */
  function relativeMs(a, b, beatSec) {
    return {
      down: a.downbeatMs - b.downbeatMs,
      off: offbeatPositionMs(a, beatSec) - offbeatPositionMs(b, beatSec),
    };
  }

  /** Standard normal sample (Box-Muller). */
  function gaussian(rand) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Random timing scatter with standard deviation sd (ms), clamped to ±3 sd. */
  function jitterMs(sd, rand) {
    if (!sd) return 0;
    const g = Math.max(-3, Math.min(3, gaussian(rand)));
    return g * sd;
  }

  /** Small seeded PRNG so exports are reproducible. Returns () => [0, 1). */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const api = {
    SLOTS_PER_BAR,
    BEATS_PER_BAR,
    beatSeconds,
    isOffbeat,
    slotGridSeconds,
    slotOffsetMs,
    eventSeconds,
    offbeatPositionMs,
    relativeMs,
    gaussian,
    jitterMs,
    mulberry32,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Timing = api;
})(this);
