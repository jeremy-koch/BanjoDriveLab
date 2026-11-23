# Banjo Drive Lab — notes for Claude

## What this is
A browser-based rhythm machine for testing where bluegrass "banjo drive" comes from.
A synthesized band (bass, guitar boom-chuck, mandolin chop, banjo rolls, optional click)
plays a loop, and every instrument's notes can be placed to the millisecond.

The question it exists to explore — keep features pointed at it:
1. **Swing mismatch theory:** the band swings its eighths slightly while the banjo plays straight,
   so the banjo's offbeats land early relative to the band's offbeats.
2. **Pushing theory:** every banjo note is a little ahead of the beat.
3. **Tightness theory:** nothing is offset; drive comes from the band being very together.

Each theory predicts a different pattern of downbeat vs offbeat offsets. The UI (diagram, readout,
presets, ABX test) is built around making those comparisons concrete and blind-testable.

## Hard constraints
- **No build step, no dependencies.** Plain HTML/CSS/JS. It must work by double-clicking
  `index.html` (file://) and on GitHub Pages. That is why the JS files are classic scripts
  (not ES modules), each wrapped in an IIFE that attaches one global (`Timing`, `Music`,
  `Sounds`, `Engine`) or `module.exports` under Node.
- **Timing accuracy is the product.** All notes are scheduled on the Web Audio clock
  (`AudioBufferSourceNode.start(t)`), never with setTimeout. The browser timer only
  decides *when to schedule*, never *when a note sounds*.
- **A note's onset is sample 0 of its buffer.** Synthesized sounds start their attack immediately
  (bass has a 3 ms fade-in; everything else < 0.5 ms). If real samples are ever added, trim
  leading silence and document the measured onset.
- Live playback and export share `scheduleSlot()`, so the export is what you hear.

## Conventions (do not break)
- Bar = 4 beats = 8 eighth-note **slots** (0..7). Even = downbeat, odd = offbeat ("&").
- `swing` is a percentage: where the offbeat falls in the beat. 50 = straight, 66.7 = triplet.
- Offsets are ms. **Negative = early (ahead), positive = late (behind).**
- Guitar strum time = first string. `spreadMs` is first-to-last string.
- Settings object shape is defined in `Engine.defaultSettings()`. Saved/shared settings
  are merged over defaults (`mergeDefaults` in app.js), so new fields need a default there.
  Bump `version` and add a migration if a field's meaning changes.

## Files
- `index.html`: static layout and control ids.
- `css/style.css`: all styling.
- `js/timing.js`: **pure** timing model (grid, swing, offsets, jitter, seeded RNG). Unit tested.
- `js/music.js`: note frequencies, chord voicings per instrument, banjo rolls, progression parser.
- `js/sounds.js`: Karplus-Strong / additive synthesis into cached AudioBuffers (seeded noise,
  so live and export sound identical).
- `js/engine.js`: default settings, `scheduleSlot`, `LiveEngine` (look-ahead scheduler,
  bar-line switching for ABX), `renderOffline` (WAV + ground-truth CSV).
- `js/app.js`: UI wiring, the canvas diagram, readout, presets, ABX test, export, share links,
  localStorage autosave.
- `tests/timing.test.js`: `npm test` (Node's built-in test runner, no installs).

## Scheduler details
- Look-ahead 250 ms; a slot is scheduled when its straight-grid time minus `EARLY_MARGIN`
  (200 ms) enters the window. Max early offset is 100 ms plus jitter up to 3 × 20 ms = 160 ms,
  so stay under 200 ms if you widen slider ranges, or raise `EARLY_MARGIN`.
- Tempo is read once per bar; other settings are read per slot (edits are heard within ~0.25 s).
- ABX auditions (`setActive(..., atBar=true)`) switch on the next bar line.

## Verifying changes
- `npm test` for the timing model.
- A headless-browser check of exported WAV onsets against the CSV found errors < 0.3 ms;
  repeat that check after any change to sounds.js or engine.js.
- Open `index.html`, press Space, try each preset, and check the readout numbers make sense:
  e.g. band 60% swing vs straight banjo at 200 BPM ⇒ banjo offbeats 30 ms ahead of the guitar.

## Roadmap / ideas
- Idea 2 (separate project or `analysis/` folder): analyze real recordings. Separate the
  instruments, detect onsets, track the beat, then histogram banjo onsets vs bass, mandolin chop
  and the beat grid, split into downbeats and offbeats. Use this app's WAV + CSV export as
  ground truth to validate the analysis before trusting it on real records.
- Per-slot offsets (e.g. banjo accents the thumb notes early), velocity/accent control.
- 2/4 "cut time" view, 16th-note subdivisions, fiddle shuffle.
- Real instrument samples (with measured, trimmed onsets).
- Randomized-order preference test (which drives more?) alongside ABX.
- A "tap along" mode measuring the listener's own tapping vs the band.
