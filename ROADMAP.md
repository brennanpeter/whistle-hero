# Roadmap

What's done, and the plan for what comes next, grouped by theme in rough order. Check items off as they land.

## Ground rules

- **Tunes.** Players bring their own ABC: paste it, or open an `.abc` file such as a tunebook downloaded from The Session. It stays in the player's browser. Nothing from The Session is fetched, bundled, scraped or used in tests: its data license forbids processing it with AI tools, which are used to build this project, and its tunes aren't ours to republish. Tunes that ship with the site are originals or public-domain settings (see "Tunes for testing").
- **One engine, several views.** The engine judges notes; each view draws the same chart and judgments its own way.
- **Fingerings throughout.** Charts, scoring and views work in D-whistle fingerings. Other instruments only change what the detector listens for.
- **The accuracy check guards the detector.** `npm run accuracy` prints the table; `npm test` fails if any simulated scenario scores worse than `test/accuracy-baseline.json`. Improve, then `npm run accuracy -- --update`.

## Done

**Foundations.** Whistle Ear (a pitch-detection test bench) and Whistle Sim (a synthetic whistle and player that plays ABC with tonguing, cuts, taps, rolls, slides, vibrato and mistakes, and reports what it meant to play). Shared modules in `src/`, `npm test` with an accuracy baseline, GitHub Actions on every push, Vite, and deployment to GitHub Pages once the tests pass.

**Detector.** McLeod pitch method with note segmentation; tongued repeats in live rooms; slides folded into the note they land on; two-frame cuts and taps; exact-match overblow filtering; glides and finger-crossing blips filtered as transients. Clean, typical and beginner players score 95–100% of notes and 85–100% of ornaments in simulation.

**Calibration.** Mic check (names the microphone, records five seconds to play back, flags silence, hiss, a quiet take or clipping); adaptive noise gate; per-instrument tuning; latency measured by beeps through the speakers or by playing along on headphones.

**Tunes.** Paste or open ABC (whole files, file-header fields, credits and alternative titles); settings grouped by name; half-hole and range check with an easiest-transposition suggestion; charts with repeats and endings played out, parts and passes, pickups, a beat grid, and timed cuts, taps and rolls. The Tune Library has search, favorites, editing, a chart preview with a playhead you can scroll away from, the simulator, and backup to a file.

**Game.** Engine with perfect / good / OK windows (45 / 90 / 140 ms), misses, wrong notes, combo and multiplier, scored ornaments and timing offset. Live input from the mic or the simulator, latency-compensated. Two views: the **finger-hole runway** (three.js; notes spaced by the beat, optional halos, flicks for cuts and taps) and the **sheet music view** (abcjs; one staff of played-out ABC, a ghost notehead, an optional fingering strip). Note spacing for each view; a few seconds of run-up; a one-bar count-in on the tune's own beat (pickups fall in place); a metronome (every beat or once a bar); speed 10–200%; practice loops with optional speed-up and live tempo changes; pause; results with stars and personal bests.

**Instruments (playing alone).** C, B♭, A, G, F, E♭ and high G whistles, and the low D whistle or Irish flute: tunes are fingered as written and sound in the instrument's key, with the sounding pitch shown. The accuracy check covers the B♭ whistle and the flute.

## Next

### 1. Navigation

- [x] A navigation bar on every page: Home, Play, Tunes, Calibrate, Whistle Ear, Whistle Sim (`src/nav.js`); in the game it shows on the setup, pause and results screens and hides while you play

### 2. Tunes for testing

- [x] A starter set that ships with the site (`src/tunes/starter.js`), one or more tunes for each rhythm (reel, jig, hornpipe, polka, slide, slip jig, waltz, strathspey, mazurka, barndance): ten originals written for the game, plus The Kesh and Drowsy Maggie as simple traditional settings from memory (marked "check it by ear"). Loaded into the library on a first visit; "Add starter tunes" in the Tune Library adds them to an existing one. Tests check every tune parses cleanly, needs no half-holing, and has full bars.
- [ ] More traditional tunes, set from public-domain scans (O'Neill's 1903 collection on archive.org or IMSLP) where every note can be checked
- [ ] A short guide to bringing in your own tunebook (download it from The Session as `.abc`, then open it in the Tune Library)

### 3. Backing band: engine and bodhrán

- [x] One band scheduler on the beat grid (`play.html`, with `src/audio/band.js`): the metronome and the bodhrán, scheduled ahead on the audio clock, following loop passes and tempo changes, switchable mid-tune (`M`, `B`)
- [x] Synthesized bodhrán (`src/audio/bodhran.js`: skin, overtones, tipper click; down, up and top strokes) with reel and jig grooves (`src/audio/grooves.js`): variations every fourth bar, fills at phrase ends, a little human looseness. Other rhythms get a plain beat until step 4. It comes in on the first downbeat and stops with the last note.
- [x] Levels for the bodhrán and the clicks, remembered between visits
- [x] The bodhrán leaking into the mic: a drum stroke landing with a note muddied the detector's window (notes fell to ~70% at the whistle's level). A low cut in front of the detector, at 3/4 of the instrument's bottom note, removes the drum's boom (and room rumble) without touching the whistle: notes stay at 95–100% with the drum louder than the whistle. The accuracy check now includes the bodhrán.
- [x] The beat grid stays even through a pickup played again after a repeat (it used to get an extra beat there)
- [ ] A melody voice (the old "guide track" idea: the tune played quietly along with you, mainly for headphone users)

### 4. Grooves for every rhythm

- [ ] Grooves for reels, jigs, hornpipes (swung, dotted), polkas, slides, slip jigs, waltzes, strathspeys (Scotch snaps), mazurkas and barndances, each with its own swing, accents and human feel
- [ ] Choose the groove from the tune's `R:` field and meter, with an override in setup
- [ ] Tune by ear with real playing

### 5. Guitar

- [ ] Chord bank per key, in DADGAD-style voicings
- [ ] Chords from ABC chord symbols where a tune has them
- [ ] Per-bar chord editor in the Tune Library
- [ ] Strum patterns for each groove, and a plucked-string synth
- [ ] Keep the guitar from being heard as the player: headphones work today; with speakers, the detector may need to ignore notes the band just played
- [ ] Later: generated harmony parts

### 6. The pub

- [ ] Asset pipeline: Blender → glTF (`.glb`), with export settings, scale, naming and animation conventions written down
- [ ] Scene described by a manifest (which models, where, which animations), so it grows without code changes
- [ ] Blockout scene with placeholder shapes, so code and art can progress side by side
- [ ] Low-poly musicians animated in time with the band, pints, and a crowd that reacts to your playing
- [ ] Performance budget for phones: baked lighting, texture atlases

### 7. Practice tools

- [ ] Wait mode: the music waits until you play the right note
- [ ] Loop a part (A or B) or a few bars
- [ ] Fingering preview for upcoming notes
- [ ] Per-tune progress and accuracy history
- [ ] An in-game tuning meter

### 8. Instruments and audio

- [ ] Other instruments, matching others: transpose the fingerings so the instrument sounds at the written pitch, with the half-hole check run for that instrument
- [ ] Test the flute with real recordings (the simulator sounds like a whistle at every pitch)
- [ ] Whistle Ear's "Use my calibration" applies the chosen instrument's tuning (it only knows the D whistle)
- [ ] Microphone picker on the setup and Calibrate screens
- [ ] Echo-heavy rooms: when the echo is within about 5 dB of the direct sound, the previous note's echo and the new note blur in one analysis window. Possible fixes: subtract the previous note's harmonics after each onset, or a shorter second-pass window around onsets. A close mic works around it for now.

### 9. Reach and polish

- [ ] Phones and tablets (mic latency, iOS Safari audio quirks)
- [ ] Installable offline app (PWA)
- [ ] Colorblind-safe lanes and reduced motion
- [ ] Difficulty levels: plain melody with ornaments stripped, up to expert where ornaments are required
- [ ] Hit effects and a low-power mode
- [ ] Fiddle support: widen the detector's range down to G3, test with real fiddle recordings, and use the sheet music view

### 10. Simulator

- [ ] Real-time mode that feeds Whistle Sim into the live microphone path, to test the AudioWorklet path and latency without speakers
- [ ] Render straight from game charts, so every tune gets an automatic playthrough test
- [ ] A small set of real whistle clips with hand-labeled notes, to check that the synth's mistakes look like real ones
