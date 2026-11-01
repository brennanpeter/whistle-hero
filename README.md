# Whistle Hero

A Guitar Hero–style browser game for the D tin whistle. Notes scroll toward you in a three.js scene, you play them on a real whistle, and the game listens through your microphone to score your timing and pitch. Tunes come from [The Session](https://thesession.org).

## Status

Early days. The repo currently holds the audio groundwork. See [ROADMAP.md](ROADMAP.md) for what comes next.

- **`whistle-ear.html`**: a test bench for pitch detection. It runs the McLeod pitch method on live mic input or a recording, segments the stream into notes, and filters out overtone jumps and short "sliver" transients.
- **`whistle-sim.html`**: a synthetic D whistle for testing without playing. Paste ABC from The Session, pick a player (clean, typical, beginner, noisy pub), and it plays the tune with tonguing, cuts, taps, rolls, slides, vibrato and deliberate mistakes. **Send to Whistle Ear** loads the clip into the test bench along with the notes it meant to play, so you can see what the detector got right and wrong.

## Running it

Needs Node 20 or newer. There are no packages to install yet.

```bash
npm run dev
```

Then open <http://localhost:5173/whistle-ear.html> or <http://localhost:5173/whistle-sim.html>. Serving from localhost lets ES modules load and allows mic access.

You can also test the live mic path without a whistle: play a clip in Whistle Sim through your speakers while Whistle Ear listens.

### Rendering test clips

```bash
npm run render                                    # every example tune × every player into test-audio/
node tools/render.mjs tune.abc --profile beginner --bpm 180 --seed 4
```

Each `.wav` gets a matching `.truth.json` listing the intended notes and the injected transients. `test-audio/` is git-ignored.

## Tests

```bash
npm test                       # unit tests plus the detector accuracy check (about 25 s)
npm run accuracy               # print detection accuracy for every simulated scenario
npm run accuracy -- --update   # after improving the detector, save the new numbers as the baseline
```

The accuracy check renders 24 scenarios with Whistle Sim (each example tune with each player, plus cuts-and-taps articulation), runs the detector, and fails if any scenario scores worse than `test/accuracy-baseline.json`. GitHub Actions runs `npm test` on every push.

## Layout

```
whistle-ear.html        detector test bench
whistle-sim.html        simulator page
src/whistle.js          D whistle facts: note names, fingerings
src/audio/detector.js   pitch detection, note segmentation, ornament and transient labels
src/audio/score.js      compare detected notes with intended ones
src/abc/abc.js          ABC parser (repeats, endings, ornaments, triplets…)
src/sim/whistle-synth.js
                        synthetic whistle and player model
tools/                  dev server, WAV renderer, accuracy report
test/                   node:test suites and the accuracy baseline
```

Everything in `src/` is a plain ES module with no dependencies, so the same code runs in the browser and in Node.
