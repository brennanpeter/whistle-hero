# Roadmap

Rough order of work for Whistle Hero. Each phase leans on the one before it. Check items off as they land.

## Phase 0: Foundations

- [x] **Whistle Ear**, a pitch-detection test bench (McLeod pitch method, note segmentation, overtone and sliver filtering)
- [x] **Whistle Sim**, a synthetic D whistle that plays ABC with tonguing, cuts, taps, rolls, slides, vibrato and human sloppiness, and outputs the list of notes it meant to play
- [x] Move the detector out of `whistle-ear.html` into a shared module (`src/audio/`) so Whistle Ear, the game and the tests all run the same code
- [x] Move the sim's ABC parser into `src/abc/` for the same reason (the game needs it for charts)
- [x] `npm test`: render Whistle Sim scenarios, run the detector on them, and fail if accuracy drops below the saved baseline for any scenario. Run it in GitHub Actions on every push.
- [x] Switch to Vite (done at the start of Phase 3); GitHub Pages deployment is listed under Phase 3

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

## Phase 2: Tunes (paste your own ABC)

Tunes come in as ABC the player pastes or opens. The project doesn't download from tune sites: The Session's data license forbids processing it with AI tools, and AI tools are used to build this project. So nothing from The Session is fetched, bundled or used in tests. Players can still paste ABC from anywhere they're allowed to use it.

- [x] Paste one tune or a whole `.abc` file; every tune with an `X:` line is added, and file-header fields apply to all of them
- [x] Keep the tune's own credits: titles and alternative names, composer (`C:`), transcriber (`Z:`), source (`S:`), origin, notes, rhythm
- [x] Group tunes with the same name as settings, and choose between them
- [x] Flag notes that need half-holing on a D whistle (C♮ counts as playable), notes outside the range, and hard third-octave notes, with the bar where each first appears
- [x] Suggest the easiest transposition (−6 to +6 semitones) and play a tune in that key
- [x] Build game charts from the parsed ABC (`src/chart/chart.js`): repeats and endings played out, parts and passes labelled, bars and a beat grid (pickups included), and cuts, taps and rolls as timed, scorable events
- [x] Tune Library page: search, favorites, edit, delete, chart preview, play with the simulator, send to Whistle Ear, back up and restore as a file

## Phase 3: Core gameplay

Whistle only for now (fiddle support would mean widening the detector's range; see "Later"). One engine, several views: the engine judges notes, and each view draws the same chart and the same judgments its own way.

- [x] Switch to Vite (`npm run dev`, `npm run build`) and add three.js
- [x] Game engine (`src/game/engine.js`): perfect / good / OK windows (45 / 90 / 140 ms), misses, wrong notes (shown, but they don't break the combo), combo and ×4 multiplier, points for written cuts and taps, cuts and slides allowed for in note timing, and the player's average timing offset
- [x] Live input (`src/audio/live.js`): the detector runs in real time on the microphone or on the simulator's audio, reporting notes in the game's clock. Mic and speaker delays are compensated, with a manual timing adjustment until calibration lands.
- [x] **Finger-hole view** (`src/game/views/finger-view.js`): rows of six holes down a highway, gold for the second octave, halos on fingers that move, flicks for cuts and taps, note names, part labels, and a hit line that lights up with the fingering being heard. It fits phone screens too.
- [x] Game page (`play.html`): pick a tune, speed 50–120%, play yourself or watch a simulated player, a one-bar count-in, a heads-up display, pause (Esc or Space), and results with stars and personal bests
- [x] Practice looping: repeat the tune until ended, optionally 5 bpm faster every third pass; − / + (or `[` / `]`) change the tempo from the next pass; results report full passes and top tempo
- [x] Halos on moving fingers can be switched off (setup, pause menu, or `H`)
- [ ] **Sheet music view**: a single staff scrolling past a playhead, drawn with abcjs from the tune's ABC. A "ghost" notehead shows the note being played at its place on the staff, colored by right or wrong, with an optional fingering strip underneath.
- [ ] Mode switch on the setup screen (the sheet music button is already there, disabled)
- [ ] Optional metronome during play, and a guide track for headphone users
- [ ] Deploy to GitHub Pages so it runs over HTTPS anywhere

## Later

- [ ] Fiddle support: widen the detector's range down to G3, test with real fiddle recordings, and use the sheet music view (the finger-hole view is whistle-specific)

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
