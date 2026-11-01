# Whistle Hero

A Guitar Hero–style browser game for the D tin whistle. Notes scroll toward you in a three.js scene, you play them on a real whistle, and the game listens through your microphone to score your timing and pitch. Tunes come from [The Session](https://thesession.org).

## Status

Early days. The repo currently holds the audio groundwork. See [ROADMAP.md](ROADMAP.md) for what comes next.

- **`whistle-ear.html`**: a test bench for pitch detection. It runs the McLeod pitch method on live mic input or a recording, segments the stream into notes, and filters out overtone jumps and short "sliver" transients.
- **`whistle-sim.html`**: a synthetic D whistle for testing without playing. Paste ABC from The Session, pick a player (clean, typical, beginner, noisy pub), and it plays the tune with tonguing, cuts, taps, rolls, slides, vibrato and deliberate mistakes. **Send to Whistle Ear** loads the clip into the test bench along with the notes it meant to play, so you can see what the detector got right and wrong.
- **`sim/whistle-synth.js`**: the synth engine behind Whistle Sim. A dependency-free ES module that runs in the browser and in Node.

## Running it

Needs Node 18 or newer. There are no packages to install yet.

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
