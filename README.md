# Whistle Hero

A Guitar Hero–style browser game for the D tin whistle. Notes scroll toward you, either as finger holes down a three.js highway or as sheet music on a scrolling staff; you play them on a real whistle, and the game listens through your microphone to score your timing and pitch. Tunes come from ABC you paste in.

## Status

Playable, early. See [ROADMAP.md](ROADMAP.md) for what's done and what comes next.

- **`play.html`**: the game. Pick a tune from your library and play along in the **finger-hole view**: each note is a row of the whistle's six holes rolling toward you (filled = covered), gold for the second octave, with an optional halo on each finger that moves and a flick for each cut or tap. The hit line lights up with the fingering the game hears you playing. Notes are spaced by the beat, so they stay the same distance apart at any tempo; a faster tune just moves down the road faster. Choose a speed from 10% to 200%, or let a simulated player play so you can watch. For practice, **Loop** repeats the tune until you end it, and **Loop and speed up** adds 5 bpm every third pass; the − / + buttons (or `[` and `]`) change the tempo from the next pass. The halos are off by default; turn them on in setup, in the pause menu or with `H`. Each game opens with a few seconds of run-up, the first notes coming into view before the count-in. A **metronome** can click every beat or once a bar (bar starts accented), following tempo changes between passes; switch it in setup, in the pause menu or with `M`. A click-volume slider sets it and the count-in.

  The **sheet music view** is for learning to read: the tune on one staff, repeats written out, scrolling past a playhead. A "ghost" notehead at the playhead shows the note you're playing at its place on the staff (green when right, red when not, with ledger lines, any sharp or flat, and its name), and notes turn gold, green or red as they're judged. Whistle fingerings can run under the staff (`H` toggles them). The staff is drawn with [abcjs](https://www.abcjs.net/).

- **`calibrate.html`**: a **mic check** (it names the microphone in use, records five seconds for you to play back, and warns if the take is silent, hissy, too quiet or distorted), then a one-minute calibration for your room, microphone and whistle: a noise gate from three seconds of quiet, your whistle's tuning from a held note, and the timing delay (beeps through the speakers, or play along on headphones). The game and Whistle Ear use it.

- **`whistle-ear.html`**: a test bench for pitch detection. It runs the McLeod pitch method on live mic input or a recording, segments the stream into notes, and filters out overtone jumps and short "sliver" transients.
- **`whistle-sim.html`**: a synthetic D whistle for testing without playing. Paste ABC, pick a player (clean, typical, beginner, noisy pub), and it plays the tune with tonguing, cuts, taps, rolls, slides, vibrato and deliberate mistakes. **Send to Whistle Ear** loads the clip into the test bench along with the notes it meant to play, so you can see what the detector got right and wrong.
- **`tunes.html`**: the Tune Library. Paste ABC (one tune or a whole file) or open an `.abc` file. It checks whether each tune fits the D whistle (half-holed notes, range), suggests a transposition when one helps, keeps tunes with the same name together as settings, and shows the chart the game will play: notes, cuts and taps, bars, beats, parts and repeats. Favorites, search, and backup to a file are included. Tunes can be played with the simulator or sent to Whistle Ear.

Tunes come in as ABC you paste or open yourself. Whistle Hero doesn't download from tune sites. The Session's data license doesn't allow it to be processed with AI tools, which are used to build this project, so the project stays clear of it.

## Running it

Needs Node 20.19 or newer.

```bash
npm install
npm run dev        # Vite dev server
```

Then open <http://localhost:5173/>. Serving from localhost allows microphone access. `npm run build` bundles everything into `dist/` for hosting; `npm run serve` is a no-install fallback that serves the test-bench pages (the game needs Vite for three.js).

You can also test the live mic path without a whistle: play a clip in Whistle Sim through your speakers while Whistle Ear listens.

### Rendering test clips

```bash
npm run render                                    # every example tune × every player into test-audio/
node tools/render.mjs tune.abc --profile beginner --bpm 180 --seed 4
```

Each `.wav` gets a matching `.truth.json` listing the intended notes and the injected transients. `test-audio/` is git-ignored.

## Tests

```bash
npm test                       # unit tests, game engine tests and the detector accuracy check (about 30 s)
npm run accuracy               # print detection accuracy for every simulated scenario
npm run accuracy -- --update   # after improving the detector, save the new numbers as the baseline
```

The accuracy check renders 24 scenarios with Whistle Sim (each example tune with each player, plus cuts-and-taps articulation), runs the detector, and fails if any scenario scores worse than `test/accuracy-baseline.json`. GitHub Actions runs `npm test` on every push.

## Layout

```
index.html              home page
play.html               the game
calibrate.html          noise gate, whistle tuning and timing calibration
whistle-ear.html        detector test bench
whistle-sim.html        simulator page
tunes.html              Tune Library
src/whistle.js          D whistle facts: note names, fingerings, cut and tap pitches
src/audio/detector.js   pitch detection, note segmentation, ornament and transient labels
src/audio/score.js      compare detected notes with intended ones
src/abc/abc.js          ABC parser (multi-tune files, metadata, repeats, endings, parts, ornaments…)
src/abc/playability.js  half-hole and range check, transposition suggestions
src/abc/write.js        write a parsed tune back out as ABC, played out, for the staff view
src/chart/chart.js      game charts: timed notes, cuts and taps, bars and beats
src/game/engine.js      judging and scoring (no DOM, tested in Node)
src/game/views/         ways of drawing the game: finger-view.js (three.js), sheet-view.js (abcjs)
src/audio/live.js       real-time detection from the mic or the simulator
src/library.js          the tune library in browser storage
src/calibration.js      calibration maths (gate, tuning, latency) and storage
src/sim/whistle-synth.js
                        synthetic whistle and player model
tools/                  dev server, WAV renderer, accuracy report
test/                   node:test suites and the accuracy baseline
```

Everything in `src/` except the views is a plain ES module with no dependencies, so the same code runs in the browser and in Node. The finger-hole view uses three.js and the sheet music view uses abcjs; each loads only when it's chosen.
