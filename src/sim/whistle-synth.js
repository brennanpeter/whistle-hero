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

function rng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => { const u = Math.max(next(), 1e-12), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
  return { next, gauss, range: (a0, b0) => a0 + (b0 - a0) * next(), chance: p => next() < p };
}

const LEAD_IN = 0.4, TAIL = 0.6;

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

  // Onsets with human timing; each event spans to the next onset.
  const onsets = []; let t = LEAD_IN;
  for (const e of evs) { onsets.push(t); t += e.len * secPerWhole; }
  const endT = t;
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

function bandpass(sr, f, q) {
  const w = TAU * f / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}

/** Render a performance (from perform()) to a Float32Array. */
export function renderPerformance(perf) {
  const o = perf.options, sr = o.sr;
  const N = Math.ceil(perf.duration * sr);
  const R = rng(o.seed * 7919 + 13);
  const tMidi = new Float32Array(N).fill(NaN);
  const tAmp = new Float32Array(N);
  const owner = new Int32Array(N).fill(-1);
  const chiffAt = new Uint8Array(N);
  const stop = new Uint8Array(N); // tongue stops cut the air almost instantly
  const S = t => Math.max(0, Math.min(N, Math.round(t * sr)));

  perf.items.forEach((it, k) => {
    const s0 = S(it.start), s1 = S(it.end), base = it.midi + it.cents / 100;
    const slideS = it.slide ? Math.min(0.14, (it.end - it.start) * 0.5) * sr : 0;
    const prev = perf.items[k - 1];
    const from = it.slide ? (prev && prev.end === it.start && prev.midi < it.midi && it.midi - prev.midi <= 3 ? prev.midi + prev.cents / 100 : base - 1.6) : base;
    for (let n = s0; n < s1; n++) {
      const j = n - s0;
      tMidi[n] = j < slideS ? from + (base - from) * (j / slideS) : base;
      tAmp[n] = it.amp * (j < slideS ? 0.85 : 1);
      owner[n] = k;
    }
    if (it.tongueS) { for (let n = S(it.start - it.tongueS); n < s0; n++) { tAmp[n] = it.amp * 0.02; stop[n] = 1; } if (s0 < N) chiffAt[s0] = 1; }
    for (const b of it.blips) for (let n = S(b.start); n < S(b.end); n++) tMidi[n] = b.midi + it.cents / 100;
    if (it.crack) for (let n = S(it.crack.start); n < S(it.crack.end); n++) tAmp[n] = it.amp * 0.15;
  });
  // Hold pitch through rests so releases and reverb tails stay on the last note.
  let last = perf.items.length ? perf.items[0].midi : LOW_D;
  for (let n = 0; n < N; n++) { if (Number.isNaN(tMidi[n])) tMidi[n] = last; else last = tMidi[n]; }

  const out = new Float32Array(N);
  const kM = 1 - Math.exp(-1 / (0.0025 * sr));
  const kA = 1 - Math.exp(-1 / (0.006 * sr));
  const kR = 1 - Math.exp(-1 / (0.014 * sr));
  const kT = 1 - Math.exp(-1 / (0.003 * sr));
  const breathBP = bandpass(sr, 2600, 0.6), breathLow = bandpass(sr, 900, 0.8), chiffBP = bandpass(sr, 5200, 0.9);
  const hp = [0, R.range(0, TAU), R.range(0, TAU), R.range(0, TAU), R.range(0, TAU)];
  const dph = [R.range(0, TAU), R.range(0, TAU), R.range(0, TAU)];
  const coupling = 28; // cents of pitch drop at zero breath: whistles go flat when blown softly
  let midi = tMidi[0], amp = 0, ph = 0, chiff = 0, nom = 0.25, vibStart = -1;
  const chiffDecay = Math.exp(-1 / (0.011 * sr));
  const nyq = sr * 0.45;

  for (let n = 0; n < N; n++) {
    const ta = tAmp[n];
    midi += (tMidi[n] - midi) * kM;
    amp += (ta - amp) * (ta > amp ? kA : stop[n] ? kT : kR);
    const k = owner[n];
    let cents = 0, am = 1;
    if (k >= 0) {
      const it = perf.items[k]; nom = it.amp;
      if (it.vib) {
        const tt = (n - it.start * sr) / sr - 0.22;
        if (tt > 0) { const d = Math.min(1, tt / 0.18), s = Math.sin(TAU * 5.3 * tt); cents += o.vibratoCents * d * s; am += 0.05 * d * s; }
      }
    }
    const ratio = Math.min(amp / nom, 1.15);
    cents += coupling * (ratio - 1);
    const tt = n / sr;
    cents += 2.5 * Math.sin(TAU * 0.31 * tt + dph[0]) + 1.5 * Math.sin(TAU * 0.83 * tt + dph[1]);
    const m = midi + o.shift + cents / 100;
    const f = 440 * Math.pow(2, (m - 69) / 12);
    ph += TAU * f / sr; if (ph > TAU) ph -= TAU;

    const reg = Math.max(0, Math.min(1.5, (midi - LOW_D) / 12));
    const bright = Math.pow(Math.max(0, ratio), 0.6);
    const H = [1, (0.30 - 0.23 * Math.min(1, reg)) * bright, (0.11 - 0.09 * Math.min(1, reg)) * bright, 0.045 * (1 - Math.min(1, reg)) * bright, 0.022 * (1 - Math.min(1, reg)) * bright];
    let tone = 0;
    for (let h = 0; h < 5; h++) { if (f * (h + 1) > nyq) break; tone += H[h] * Math.sin((h + 1) * ph + hp[h]); }

    if (chiffAt[n]) chiff = 1;
    const w = R.next() * 2 - 1;
    const air = o.breathiness * (amp / 0.27) * (1 + 0.6 * reg) * (0.11 * breathBP(w) + 0.05 * breathLow(w));
    const ch = chiff * 0.18 * chiffBP(R.next() * 2 - 1) * Math.min(1, amp / nom + 0.3);
    chiff *= chiffDecay;
    out[n] = amp * am * tone + air + ch;
  }

  // Room: Schroeder reverb, background noise, hum, then level.
  if (o.reverb > 0) {
    const scale = sr / 44100;
    const combs = [1557, 1617, 1491, 1422].map(d => ({ buf: new Float32Array(Math.round(d * scale)), i: 0, lp: 0 }));
    const aps = [225, 556].map(d => ({ buf: new Float32Array(Math.round(d * scale)), i: 0 }));
    const fb = 0.72, damp = 0.35; // about 0.6 s RT60: a living room, not a hall
    for (let n = 0; n < N; n++) {
      const x = out[n] * 0.25; let y = 0;
      for (const c of combs) { const v = c.buf[c.i]; c.lp = v * (1 - damp) + c.lp * damp; c.buf[c.i] = x + c.lp * fb; c.i = (c.i + 1) % c.buf.length; y += v; }
      for (const a of aps) { const v = a.buf[a.i]; const z = -y + v; a.buf[a.i] = y + v * 0.5; a.i = (a.i + 1) % a.buf.length; y = z; }
      out[n] = out[n] * (1 - o.reverb) + y * o.reverb * 1.6;
    }
  }
  const noiseA = Math.pow(10, o.roomNoiseDb / 20) * 1.8; // pinkish noise is quieter than its white source
  const humA = Math.pow(10, o.humDb / 20);
  const g = Math.pow(10, o.gainDb / 20);
  let pink = 0, peak = 0;
  for (let n = 0; n < N; n++) {
    pink = 0.97 * pink + 0.03 * (R.next() * 2 - 1) * 4;
    let x = out[n] + noiseA * pink;
    if (humA > 1e-5) { const t2 = TAU * 60 * n / sr; x += humA * (Math.sin(t2) + 0.5 * Math.sin(2 * t2) + 0.3 * Math.sin(3 * t2)); }
    x *= g;
    if (x > 1) x = 1; else if (x < -1) x = -1;
    out[n] = x; peak = Math.max(peak, Math.abs(x));
  }
  return { samples: out, sr, peak };
}

/** One call: ABC text in, audio + ground truth out. */
export function renderAbc(abc, opts = {}) {
  const parsed = parseAbc(abc, { transpose: opts.transpose || 0 });
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
