# Banjo Drive Lab

A rhythm machine for exploring bluegrass **banjo drive**, with every note placeable to the millisecond.

Banjo players argue about where the drive comes from:

1. **Swing mismatch:** the band swings slightly while the banjo plays straight eighths, so the banjo's offbeats land early.
2. **Pushing:** every banjo note sits a little ahead of the beat.
3. **Tightness:** nothing is offset; the band is just very together.

This app lets you build each scenario, see exactly where the notes land, and blind-test whether you can actually hear the difference.

## Use it

Open `index.html` in a browser. No install or server is needed. Or publish with GitHub Pages
(Settings → Pages → deploy from the `main` branch, root folder).

- **Instruments:** bass, guitar boom-chuck, mandolin chop, banjo rolls and an optional click, all synthesized in the browser.
- **Per instrument:** swing %, downbeat offset, offbeat offset, random scatter (ms), volume, pan, and which eighth notes it plays.
- **Diagram:** one beat zoomed in, showing where each instrument's notes fall.
- **Readout:** how far ahead or behind the banjo is compared with each band instrument, in ms and as a % of a beat.
- **Presets:** one per theory, plus a laid-back banjo and human scatter.
- **ABX blind test:** save two settings as A and B, guess whether X is A or B, and see how likely your score is by chance.
- **Export:** a WAV of the loop plus a CSV with the exact onset of every note. The CSV is ground truth for testing audio-analysis tools.
- **Share links:** settings are encoded in the URL.

Sign convention: **negative ms = early (ahead of the beat)**, positive = late.

## Develop

Plain HTML/CSS/JS with no build step and no dependencies.

```
npm test          # timing-model unit tests (Node 18+)
npm run serve     # optional: python3 -m http.server 8000
```

## A note on perception

Research on timing perception suggests differences under about 10 ms are hard to hear. Before trusting your ears on small offsets, run the blind test. If 16 trials don't beat chance, you can't hear the difference.
