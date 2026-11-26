// Whistle Sim: a synthetic D tin whistle for testing pitch detection without a whistle.
//
// Takes ABC notation (the format The Session uses), turns it into a "performance" with
// tonguing, cuts, taps, rolls, slides, vibrato and human timing, and renders it to mono
// PCM. Alongside the audio it returns the ground truth: every note it meant to play and
// every transient it deliberately injected (overblown blips, finger-crossing blips, cracks).
//
// Plain ES modules with no outside dependencies, so it runs in the browser and in Node.
//
//   import { renderAbc } from "./src/sim/whistle-synth.js";
//   const { samples, sr, truth } = renderAbc(abcText, { profile: "typical", bpm: 140 });

import { LOW_D, FINGERINGS, noteName, stepFrom, cutFor } from "../whistle.js";
import { parseAbc } from "../abc/abc.js";
import { swingFor, swingPos } from "../chart/chart.js";
import { rng, createControl, createVoice } from "./voice.js";

export { LOW_D, FINGERINGS, noteName, parseAbc }; // re-exported so pages can import everything from here
const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- cut and tap pitches */

const FING_TO_PC = Object.fromEntries(Object.entries(FINGERINGS).map(([pc, f]) => [f.join(""), +pc]));

const fingeringOf = midi => FINGERINGS[((midi - LOW_D) % 12 + 12) % 12] || null;

/* ---------------------------------------------------------------- player profiles */

export const DEFAULTS = {
  sr: 44100,
  bpm: null,            // quarter notes per minute; null = use the tune's Q: or 120
  articulation: "abc",  // "abc" (tongue unless slurred) | "legato" (tongue only repeats and after rests)
                        // | "cuts" (legato; repeated notes separated with cuts and taps) | "tongued"
  tuningCents: 0,       // whole-instrument offset from A=440
  shift: 0,             // the instrument's key, in semitones from a D whistle (B♭ whistle −4, flute −12):
                        // the same fingerings and playing, sounding higher or lower
  pitchWobble: 0,       // per-note random tuning, cents (std dev)
  breathiness: 0.2,     // 0..1 air noise
  vibratoCents: 0,      // depth on long notes
  graceMs: 32,          // length of cuts and taps
  tongueMs: 30,         // airflow stop before a tongued note
  timingMs: 0,          // onset jitter (std dev)
  overtoneProb: 0,      // chance a tongued low-octave attack blips up an octave or a twelfth
  fingerProb: 0,        // chance a slurred multi-finger change passes through a stray note
  crackProb: 0,         // chance a long note briefly loses its tone
  roomNoiseDb: -96,     // background noise level, dBFS RMS
  humDb: -120,          // mains hum level, dBFS
  reverb: 0,            // 0..0.5 wet mix
  gainDb: 0,            // overall level
  seed: 1,
};

export const PROFILES = {
  clean:    { label: "Clean (ideal player)" },
  typical:  { label: "Typical session player", tuningCents: 8, pitchWobble: 5, breathiness: 0.3, vibratoCents: 10, timingMs: 10,
              overtoneProb: 0.08, fingerProb: 0.15, crackProb: 0.02, roomNoiseDb: -66, reverb: 0.08 },
  beginner: { label: "Beginner", tuningCents: -18, pitchWobble: 12, breathiness: 0.55, vibratoCents: 0, graceMs: 55, timingMs: 28,
              overtoneProb: 0.3, fingerProb: 0.4, crackProb: 0.12, roomNoiseDb: -60, reverb: 0.08 },
  noisy:    { label: "Noisy pub session", tuningCents: 8, pitchWobble: 5, breathiness: 0.3, vibratoCents: 10, timingMs: 10,
              overtoneProb: 0.08, fingerProb: 0.15, crackProb: 0.02, roomNoiseDb: -42, humDb: -52, reverb: 0.22 },
};

export function resolveOptions(opts = {}) {
  const prof = PROFILES[opts.profile] || {};
  const o = { ...DEFAULTS, ...prof, ...opts };
  delete o.label;
  return o;
}

/* ---------------------------------------------------------------- performance */

export const LEAD_IN = 0.4, TAIL = 0.6;

/**
 * For the "cuts" articulation: find runs of the same note with no rest between them and
 * separate them with grace notes instead of the tongue.
 *   2 in a row: cut into the first, tap into the second
 *   3 in a row: plain, cut, tap (a long roll)
 *   4 or more:  plain, then alternate cut, tap, cut, …
 * Notes that already have a written roll or grace notes keep those.
 * Returns an array parallel to evs holding "cut", "tap" or null.
 */
function repeatOrnaments(evs) {
  const out = new Array(evs.length).fill(null);
  let k = 0;
  while (k < evs.length) {
    if (evs[k].t !== "note") { k++; continue; }
    let j = k + 1;
    while (j < evs.length && evs[j].t === "note" && evs[j].midi === evs[k].midi) j++;
    const n = j - k;
    if (n === 2) { out[k] = "cut"; out[k + 1] = "tap"; }
    else if (n >= 3) for (let i = 1; i < n; i++) out[k + i] = i % 2 ? "cut" : "tap";
    for (let i = k; i < j; i++) if (evs[i].roll || evs[i].graces.length) out[i] = null;
    k = j;
  }
  return out;
}

/**
 * Turn parsed events into timed sound items plus injected artifacts.
 * Items: {kind: "note"|"cut"|"tap", midi, start, end, tongued, slide, ornament, group}
 */
export function perform(parsed, opts) {
  const o = resolveOptions(opts);
  const R = rng(o.seed);
  const qpm = o.bpm || parsed.qpm || 120;
  const secPerWhole = 240 / qpm;
  const evs = parsed.events.filter(e => e.len > 0);

  // Onsets with human timing; each event spans to the next onset. A hornpipe written in even
  // eighths is played swung, as the game's chart expects (see swingFor in chart.js).
  const sw = swingFor(parsed), at = pos => LEAD_IN + swingPos(pos, sw) * secPerWhole;
  const onsets = evs.map(e => at(e.pos));
  const endT = evs.length ? at(evs[evs.length - 1].pos + evs[evs.length - 1].len) : LEAD_IN;
  for (let k = 1; k < onsets.length; k++) {
    const room = 0.3 * Math.min(onsets[k] - onsets[k - 1], (k + 1 < onsets.length ? onsets[k + 1] : endT) - onsets[k]);
    onsets[k] += Math.max(-room, Math.min(room, R.gauss() * o.timingMs / 1000));
  }

  const auto = o.articulation === "cuts" ? repeatOrnaments(evs) : [];
  const items = [];
  let prevMidi = null, prevWasRest = true;
  evs.forEach((e, k) => {
    const a = onsets[k], b = k + 1 < evs.length ? onsets[k + 1] : endT;
    if (e.t === "rest") { prevWasRest = true; return; }
    const dur = b - a;
    const hasOrn = e.roll || e.graces.length > 0;
    let tongued;
    if (o.articulation === "tongued") tongued = true;
    else if (o.articulation === "cuts") tongued = prevWasRest;
    else if (o.articulation === "legato") tongued = prevWasRest || (e.midi === prevMidi && !hasOrn);
    else tongued = !e.slurred || prevWasRest || (e.midi === prevMidi && !hasOrn);
    const g = Math.min(o.graceMs / 1000, dur * 0.22) * R.range(0.85, 1.15);
    const group = k;
    const push = (kind, midi, s, en, tng, extra = {}) => items.push({ kind, midi, start: s, end: en, tongued: tng, slide: false, ornament: null, group, ...extra });

    let cur = a, first = true;
    for (const gm of e.graces) {
      push(gm > e.midi ? "cut" : "tap", gm, cur, cur + g, first && tongued, { ornament: "grace" });
      cur += g; first = false;
    }
    if (auto[k]) {
      const cut = cutFor(e.midi), tap = stepFrom(e.midi, -1);
      const [kind, gm] = auto[k] === "tap" && tap != null ? ["tap", tap] : ["cut", cut]; // low D can't be tapped
      push(kind, gm, cur, cur + g, first && tongued, { ornament: "repeat" });
      cur += g; first = false;
    }
    if (e.roll && dur - (cur - a) > 4 * g) {
      const rem = b - cur, third = rem / 3;
      const cut = cutFor(e.midi);
      const tap = stepFrom(e.midi, -1);
      const second = tap != null ? ["tap", tap] : ["cut", cut]; // low D can't be tapped: a cran-like double cut
      push("note", e.midi, cur, cur + third, first && tongued, { ornament: "roll" });
      push("cut", cut, cur + third, cur + third + g, false, { ornament: "roll" });
      push("note", e.midi, cur + third + g, cur + 2 * third, false, { ornament: "roll" });
      push(second[0], second[1], cur + 2 * third, cur + 2 * third + g, false, { ornament: "roll" });
      push("note", e.midi, cur + 2 * third + g, b, false, { ornament: "roll" });
    } else {
      push("note", e.midi, cur, b, first && tongued, { slide: !!e.slide });
    }
    prevMidi = e.midi; prevWasRest = false;
  });

  // Close each note just before a following rest, so the rest is audible.
  for (let k = 0; k < items.length; k++) {
    const it = items[k], nx = items[k + 1], nextEv = evs[it.group + 1];
    if ((!nx || nx.group !== it.group) && nextEv && nextEv.t === "rest") it.end = onsets[it.group + 1];
  }

  // Per-item tuning and level, then injected artifacts.
  const artifacts = [];
  for (let k = 0; k < items.length; k++) {
    const it = items[k], prev = items[k - 1];
    const dur = it.end - it.start;
    const reg = it.midi >= LOW_D + 12 ? 1 : 0;
    it.cents = o.tuningCents + reg * 6 + (it.kind === "note" ? R.gauss() * o.pitchWobble : 0);
    it.amp = (reg ? 0.30 : 0.25) * Math.pow(10, R.gauss() * 1.2 / 20) * (it.kind === "tap" ? 0.75 : 1);
    it.tongueS = it.tongued ? Math.min(o.tongueMs / 1000, dur * 0.3) : 0;
    // The tongue stops the air at the end of the previous note, so the new note still sounds on the beat.
    if (it.tongueS && prev && prev.end > it.start - it.tongueS) {
      it.tongueS = Math.min(it.tongueS, (prev.end - prev.start) * 0.3);
      prev.end = it.start - it.tongueS;
    }
    it.vib = it.kind === "note" && dur > 0.42 && o.vibratoCents > 0;
    it.blips = [];

    if (it.tongued && it.kind === "note" && !reg && dur > 0.1 && R.chance(o.overtoneProb)) {
      const up = R.chance(0.3) ? 19 : 12, len = R.range(0.010, 0.024);
      const s = it.start;
      it.blips.push({ midi: it.midi + up, start: s, end: s + len });
      artifacts.push({ kind: "overtone", midi: it.midi + up, start: s, end: s + len, note: k });
    }
    if (prev && !it.tongued && prev.end === it.start && it.kind === "note" && prev.kind === "note" && prev.midi !== it.midi && dur > 0.06) {
      const fa = fingeringOf(prev.midi), fb = fingeringOf(it.midi);
      if (fa && fb) {
        const changed = fa.map((v, h) => v !== fb[h] ? h : -1).filter(h => h >= 0);
        if (changed.length >= 2 && R.chance(o.fingerProb)) {
          const moved = changed.filter(() => R.next() < 0.5);
          if (moved.length === 0) moved.push(changed[0]);
          if (moved.length === changed.length) moved.pop();
          const mid = fa.slice(); for (const h of moved) mid[h] = fb[h];
          const pc = FING_TO_PC[mid.join("")];
          if (pc !== undefined) {
            const octave = Math.floor((it.midi - LOW_D) / 12);
            const bm = LOW_D + 12 * octave + pc;
            if (bm !== prev.midi && bm !== it.midi) {
              const len = Math.min(R.range(0.008, 0.02), dur * 0.3);
              it.blips.push({ midi: bm, start: it.start, end: it.start + len });
              artifacts.push({ kind: "finger", midi: bm, start: it.start, end: it.start + len, note: k });
            }
          }
        }
      }
    }
    if (it.kind === "note" && dur > 0.25 && R.chance(o.crackProb)) {
      const s = it.start + dur * R.range(0.3, 0.75), len = R.range(0.012, 0.026);
      it.crack = { start: s, end: s + len };
      artifacts.push({ kind: "crack", midi: it.midi, start: s, end: s + len, note: k });
    }
  }
  return { items, artifacts, qpm, duration: endT + TAIL, options: o };
}

/* ---------------------------------------------------------------- synthesis */

/**
 * Render a performance (from perform()) to a Float32Array: the streaming voice (voice.js), stepped
 * through it one sample at a time. The game's real-time simulator plays the same voice live.
 */
export function renderPerformance(perf) {
  const o = perf.options, sr = o.sr;
  const N = Math.ceil(perf.duration * sr);
  const ctl = createControl(perf.items, sr), voice = createVoice(o, sr, perf.items.length ? perf.items[0].midi : LOW_D);
  const out = new Float32Array(N);
  let peak = 0;
  for (let n = 0; n < N; n++) { const x = voice.next(ctl.at(n), n); out[n] = x; if (Math.abs(x) > peak) peak = Math.abs(x); }
  return { samples: out, sr, peak };
}

/** One call: ABC text in, audio + ground truth out. */
function parseFor(abc, opts) {
  const parsed = parseAbc(abc, { transpose: opts.transpose || 0 });
  if (opts.rhythm) parsed.meta = { ...parsed.meta, rhythm: opts.rhythm }; // a rhythm chosen in place of the R: field (it sets the swing)
  return parsed;
}
/** ABC text in, a performance out (no audio): what the real-time simulator plays. */
export const performAbc = (abc, opts = {}) => perform(parseFor(abc, opts), opts);

export function renderAbc(abc, opts = {}) {
  const parsed = parseFor(abc, opts);
  const perf = perform(parsed, opts);
  const { samples, sr, peak } = renderPerformance(perf);
  const truth = {
    title: parsed.title, qpm: perf.qpm, sr, duration: samples.length / sr,
    notes: perf.items.map(it => ({
      kind: it.kind, midi: it.midi, name: noteName(it.midi),
      start: +it.start.toFixed(4), end: +it.end.toFixed(4),
      tongued: it.tongued, ornament: it.ornament, slide: it.slide, cents: +it.cents.toFixed(1),
    })),
    artifacts: perf.artifacts.map(a => ({ kind: a.kind, midi: a.midi, name: noteName(a.midi), start: +a.start.toFixed(4), end: +a.end.toFixed(4) })),
    options: perf.options,
  };
  return { samples, sr, peak, truth, warnings: parsed.warnings };
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples, sr) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Uint8Array(buf);
}

/* ---------------------------------------------------------------- example tunes */

export const PRESETS = {
  scale: { label: "D scale, two octaves", abc:
`T:D scale, two octaves
M:4/4
L:1/8
K:D
DEFG ABcd|efga b2 z2|bagf edcB|AGFE D4|]` },
  ornaments: { label: "Cuts, taps and rolls", abc:
`T:Cuts, taps and rolls
M:4/4
L:1/8
K:D
~G3 A ~B3 d|{a}e2 {g}f2 {a}g2 {e}d2|~A3 F ~E3 F|{g}A2 {f}E2 D4|]` },
  repeats: { label: "Tongued repeats (jig rhythm)", abc:
`T:Tongued repeats
M:6/8
L:1/8
K:D
AAA BBB|AAA d3|ddd ccc|BBB A3|]` },
  slurs: { label: "Slurs and slides", abc:
`T:Slurs and slides
M:3/4
L:1/8
K:D
(DEFG A2)|!slide!B4 A2|(BAGF) !slide!A2|(d2 B2 A2)|D6|]` },
  reel: { label: "Practice reel with repeats (original)", abc:
`T:Practice reel (original)
R:reel
M:4/4
L:1/8
Q:1/4=150
K:D
|:FA~A2 dAFA|BEE2 (3EFG FE|DFAd fdAF|1GBAF E2DE:|2GBAG FD D2||
|:fa~a2 fede|fdec d2AF|DFAd fdec|1dBAF E2DE:|2dBAG FD D2|]` },
};
