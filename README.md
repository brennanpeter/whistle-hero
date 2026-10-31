# Whistle Hero

A Guitar Hero–style browser game for the D tin whistle. Notes scroll toward you in a three.js scene, you play them on a real whistle, and the game listens through your microphone to score your timing and pitch. Tunes come from [The Session](https://thesession.org).

## Status

Early days. The repo currently holds the pitch-detection groundwork:

- **`whistle-ear.html`** — a standalone test bench for the audio side. It runs the McLeod pitch method on live mic input, segments the stream into notes, and filters out overtone jumps and short "sliver" transients. Open it in a browser (it needs mic permission, so serve it over `localhost` or HTTPS).

## Planned

- three.js note highway and scoring
- Importing tunes from The Session (ABC notation) and mapping them to D whistle fingerings
- Node-based dev tooling (bundler / dev server)
