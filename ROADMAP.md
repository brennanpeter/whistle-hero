# Roadmap

Rough order of work for Whistle Hero. Each phase leans on the one before it. Check items off as they land.

## Phase 0: Foundations

- [x] **Whistle Ear**, a pitch-detection test bench (McLeod pitch method, note segmentation, overtone and sliver filtering)
- [x] **Whistle Sim**, a synthetic D whistle that plays ABC with tonguing, cuts, taps, rolls, slides, vibrato and human sloppiness, and outputs the list of notes it meant to play
- [ ] Move the detector out of `whistle-ear.html` into a shared module (`src/audio/`) so Whistle Ear, the game and the tests all run the same code
- [ ] Move the sim's ABC parser into `src/abc/` for the same reason (the game needs it for charts)
- [ ] `npm test`: render Whistle Sim scenarios, run the detector on them, and fail if accuracy drops below a floor for each scenario. Run it in GitHub Actions on every push.
- [ ] Switch to Vite once three.js comes in; deploy to GitHub Pages (HTTPS, so the mic works for anyone)

## Phase 1: Harden the detector

The simulator already shows where it struggles. Clean playing scores 88–100% of notes matched. The weak spots:

- [ ] **Reverb tails.** In a live room, a note's echo keeps the pitch alive through rests and tongue gaps, so notes merge or run long. End notes on a falling energy envelope, not just silence.
- [ ] **Slides.** A slide's glide registers as an extra, intermediate note. Recognize glides and report them as a slide into the target note.
- [ ] **Cuts after tongued attacks.** These are sometimes missed. Tongued notes also currently land about 30 ms late against the beat because detection waits for the tone to come back after the gap.
- [ ] **Overblown attacks.** A blip up an octave or a twelfth at the start of a note isn't always filtered.
- [ ] **Finger-crossing blips.** A stray in-between note during a multi-finger change can be read as a grace note.
- [ ] **Latency calibration.** Measure the delay from microphone to detection (play a click and listen for it, or have the player tap along) and store the offset. The game's timing judgment depends on it.
- [ ] **Adaptive noise gate.** Measure room noise for a second before playing.
- [ ] **Whistle tuning calibration.** Detect each whistle's offset from a held low D, rather than relying on the reference-pitch slider.

## Phase 2: Tunes from The Session

- [ ] Import by tune URL or ID through The Session's JSON API (`?format=json`). Check CORS first; pasting ABC is the fallback.
- [ ] Choose between a tune's settings, and flag notes that need half-holing on a D whistle (anything outside D major plus C♮)
- [ ] Build game charts from the parsed ABC: repeats and endings expanded, ornaments kept as scorable events
- [ ] A starter library of well-known session tunes, plus favorites saved locally
- [ ] Credit the tune, its setting and the transcriber, with a link back to The Session

## Phase 3: Core gameplay (three.js)

- [ ] Note highway. Decide between one lane per note (8 lanes: D–C♯, with the octave shown by color or height) and lanes for the six finger holes showing the fingering, which would be unique to the whistle
- [ ] Timing windows (perfect, good, miss), score, combo and streak multiplier
- [ ] Bonus scoring for ornaments: cuts, taps, rolls and slides
- [ ] Turn the detector's note events into hits, with latency compensation
- [ ] Guide track: Whistle Sim plays the tune quietly, with an optional metronome or bodhrán click
- [ ] Practice speed from 50 to 100%
- [ ] Pause, restart and a results screen

## Phase 4: Learning

- [ ] Wait mode: the highway pauses until you play the right note
- [ ] Loop a part (A part or B part) or a few bars
- [ ] Fingering preview for upcoming notes
- [ ] Per-tune progress and accuracy history
- [ ] An in-game tuning meter

## Phase 5: Polish and reach

- [ ] Difficulty levels: plain melody with ornaments stripped, up to expert where ornaments are required
- [ ] Hit effects, visual themes and a low-power mode
- [ ] Phones and tablets (mic latency, iOS Safari audio quirks)
- [ ] Installable offline app (PWA)
- [ ] Other whistle keys (C, high G, low D) by making the bottom note a setting
- [ ] Colorblind-safe lanes and reduced motion

## Simulator improvements, as needed

- [ ] Real-time mode that feeds Whistle Sim into the live microphone path, to test the AudioWorklet path and latency without speakers
- [ ] Render straight from game charts, so every tune in the library gets an automatic playthrough test
- [ ] Record a small set of real whistle clips with hand-labeled notes, to check that the synth's mistakes look like real ones
