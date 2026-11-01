# Roadmap

Rough order of work for Whistle Hero. Each phase leans on the one before it. Check items off as they land.

## Phase 0: Foundations

- [x] **Whistle Ear**, a pitch-detection test bench (McLeod pitch method, note segmentation, overtone and sliver filtering)
- [x] **Whistle Sim**, a synthetic D whistle that plays ABC with tonguing, cuts, taps, rolls, slides, vibrato and human sloppiness, and outputs the list of notes it meant to play
- [x] Move the detector out of `whistle-ear.html` into a shared module (`src/audio/`) so Whistle Ear, the game and the tests all run the same code
- [x] Move the sim's ABC parser into `src/abc/` for the same reason (the game needs it for charts)
- [x] `npm test`: render Whistle Sim scenarios, run the detector on them, and fail if accuracy drops below the saved baseline for any scenario. Run it in GitHub Actions on every push.
- [ ] Switch to Vite when three.js comes in (start of Phase 3); deploy to GitHub Pages (HTTPS, so the mic works for anyone)

## Phase 1: Harden the detector

`npm run accuracy` prints the full table. Each fix should raise those numbers; then `npm run accuracy -- --update` locks the gain in.

**Where it stands:** clean, typical and beginner players score 95–100% of notes and 85–100% of cuts and taps. Before Phase 1, typical playing scored 80–100% of notes and 64–92% of ornaments (partly because of a simulator flaw, fixed below). The noisy pub (a mic a couple of metres away in a live room) is still at 63–96% of notes and about 20–25% of ornaments.

- [x] **Tongued notes on the beat.** This was a simulator bug: it put the tongue gap at the start of each note, so every tongued note sounded 30 ms late. The gap now shortens the previous note, as a real tongue stop does.
- [x] **Tongued repeats in a live room.** A re-articulation is now a fast dip below the recent level followed by a 6 dB recovery. Before, any dip below 45% of the note's loudest point counted, so the slow swells of a room's echo split held notes. Repeats now score 100% for typical and beginner players.
- [x] **Slides.** A slide's glide registered as an extra in-between note. The detector now folds a continuously rising glide into the note it lands on, marks that note `slide`, and starts it where the slide began. The glide must last at least 45 ms, so ordinary note changes aren't mistaken for slides.
- [x] **Short cuts and taps.** At about 30 ms they leave only one or two clean frames in the 23 ms analysis window, but a new pitch needed three frames. Two clearly pitched, steady frames now count as an ornament.
- [x] **Overblown attacks.** The filter accepted anything within a semitone of an octave or a twelfth, which threw away real cuts. It now requires an exact match.
- [x] **Glides and finger-crossing blips.** A short piece between two notes and within a semitone of both (or off the D scale) is filtered as a transient. So is a flat-starting attack or a release that sags flat. Cuts sit above the note and taps sit between two copies of the same note, so neither matches.
- [ ] **Echo-heavy rooms.** When the echo is within about 5 dB of the direct sound, the previous note's echo and the new note blur inside one analysis window. The pitch reads off by a semitone, or the frame isn't clear enough to count. A fix needs a different approach, such as subtracting the previous note's harmonics after each onset, or a shorter second-pass window around onsets to get ornament pitches. A close mic is the practical answer for now.
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
