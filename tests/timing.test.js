// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/timing.js');
const M = require('../js/music.js');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const inst = (o) => Object.assign({ swing: 50, downbeatMs: 0, offbeatMs: 0 }, o);

test('straight grid puts slots on even eighths', () => {
  const beat = T.beatSeconds(120); // 0.5 s
  for (let s = 0; s < 8; s++) close(T.slotGridSeconds(s, beat, 50), s * 0.25);
});

test('triplet swing puts the offbeat two-thirds through the beat', () => {
  const beat = 0.6;
  close(T.slotGridSeconds(1, beat, 200 / 3), 0.4);
  close(T.slotGridSeconds(3, beat, 200 / 3), 1.0);
  close(T.slotGridSeconds(2, beat, 200 / 3), 0.6); // downbeats unaffected
});

test('negative offsets are early, applied per downbeat/offbeat', () => {
  const beat = 0.5;
  const i = inst({ downbeatMs: -10, offbeatMs: 5 });
  close(T.eventSeconds(1, 0, beat, i, 0), 0.99);
  close(T.eventSeconds(1, 1, beat, i, 0), 1.255);
  close(T.eventSeconds(1, 1, beat, i, -5), 1.25);
});

test('straight banjo vs band swung to 60% at 200 BPM: banjo offbeat 30 ms ahead', () => {
  const beat = T.beatSeconds(200); // 300 ms
  const rel = T.relativeMs(inst({ swing: 50 }), inst({ swing: 60 }), beat);
  close(rel.down, 0);
  close(rel.off, -30, 1e-6);
});

test('jitter is clamped to ±3 SD and seeded RNG is reproducible', () => {
  const r1 = T.mulberry32(42);
  const r2 = T.mulberry32(42);
  for (let k = 0; k < 1000; k++) {
    const a = T.jitterMs(5, r1);
    assert.equal(a, T.jitterMs(5, r2));
    assert.ok(Math.abs(a) <= 15 + 1e-9);
  }
  assert.equal(T.jitterMs(0, Math.random), 0);
});

test('music: A4 = 440 and progression parsing', () => {
  close(M.freq('A4'), 440, 1e-9);
  close(M.freq('A3'), 220, 1e-9);
  const p = M.parseProgression('G g | C, D am X');
  assert.deepEqual(p.chords, ['G', 'G', 'C', 'D', 'Am']);
  assert.deepEqual(p.unknown, ['X']);
});

test('music: every roll has 8 notes on valid strings', () => {
  for (const r of Object.values(M.ROLLS)) {
    assert.equal(r.strings.length, 8);
    r.strings.forEach((s) => assert.ok(s >= 1 && s <= 5));
  }
});
