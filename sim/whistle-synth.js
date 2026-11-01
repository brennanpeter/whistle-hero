// Whistle Sim: a synthetic D tin whistle for testing pitch detection without a whistle.
//
// Takes ABC notation (the format The Session uses), turns it into a "performance" with
// tonguing, cuts, taps, rolls, slides, vibrato and human timing, and renders it to mono
// PCM. Alongside the audio it returns the ground truth: every note it meant to play and
// every transient it deliberately injected (overblown blips, finger-crossing blips, cracks).
//
// Plain ES module with no dependencies, so it runs in the browser and in Node.
//
//   import { renderAbc } from "./sim/whistle-synth.js";
//   const { samples, sr, truth } = renderAbc(abcText, { profile: "typical", bpm: 140 });

export const LOW_D = 74; // MIDI number of the D whistle's bottom note (D5)
const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- whistle facts */

// Six holes, top (nearest the mouthpiece) first; 1 = covered. Keyed by semitones above D.
export const FINGERINGS = {
  0: [1,1,1,1,1,1], 2: [1,1,1,1,1,0], 4: [1,1,1,1,0,0], 5: [1,1,1,0,0,0],
  7: [1,1,0,0,0,0], 9: [1,0,0,0,0,0], 10: [0,1,1,0,0,0], 11: [0,0,0,0,0,0],
};
const FING_TO_PC = Object.fromEntries(Object.entries(FINGERINGS).map(([pc, f]) => [f.join(""), +pc]));
const DIATONIC = [0, 2, 4, 5, 7, 9, 11];
const SCALE_NAMES = { 0:"D", 2:"E", 4:"F♯", 5:"G", 7:"A", 9:"B", 10:"C♮", 11:"C♯" };
const CHROM_NAMES = ["D","D♯","E","F","F♯","G","G♯","A","A♯","B","C","C♯"];

/** Note name in the same style as Whistle Ear: D E F♯ … with ′ for the 2nd octave, ″ for the 3rd. */
export function noteName(midi) {
  const off = midi - LOW_D, oct = Math.floor(off / 12), pc = ((off % 12) + 12) % 12;
  let name = pc in SCALE_NAMES ? SCALE_NAMES[pc] : CHROM_NAMES[pc];
  if (oct === 1) name += "′"; else if (oct === 2) name += "″"; else if (oct < 0) name += ",";
  return name;
}
const fingeringOf = midi => FINGERINGS[((midi - LOW_D) % 12 + 12) % 12] || null;

// Whistle scale notes (D major + C♯) across the playable range, used to pick cut and tap pitches.
const WHISTLE_NOTES = [];
for (let o = 0; o < 3; o++) for (const pc of DIATONIC) WHISTLE_NOTES.push(LOW_D + 12 * o + pc);
const stepFrom = (midi, steps) => {
  let i = WHISTLE_NOTES.findIndex(m => m >= midi);
  if (i < 0) i = WHISTLE_NOTES.length - 1;
  if (steps < 0 && WHISTLE_NOTES[i] > midi) i--; // midi between scale notes
  const j = i + steps;
  return j >= 0 && j < WHISTLE_NOTES.length ? WHISTLE_NOTES[j] : null;
};

/* ---------------------------------------------------------------- ABC parsing */

const MAJOR_FIFTHS = { C:0, G:1, D:2, A:3, E:4, B:5, "F#":6, "C#":7, F:-1, Bb:-2, Eb:-3, Ab:-4, Db:-5, Gb:-6, Cb:-7, "G#":8, "D#":9, "A#":10 };
const MODE_SHIFT = { maj:0, ion:0, mix:-1, dor:-2, min:-3, aeo:-3, m:-3, phr:-4, loc:-5, lyd:1 };
const SHARP_ORDER = "FCGDAEB", FLAT_ORDER = "BEADGCF";

function keySignature(k) {
  const m = /^\s*([A-G])([#b]?)\s*([A-Za-z]*)/.exec(k || "D");
  if (!m) return { acc: keySignature("D").acc, warn: `Unknown key "${k}", using D` };
  const mode = m[3].toLowerCase();
  const shift = mode === "" ? 0 : mode === "m" ? -3 : MODE_SHIFT[mode.slice(0, 3)];
  const base = MAJOR_FIFTHS[m[1] + m[2]];
  if (base === undefined || shift === undefined) return { acc: keySignature("D").acc, warn: `Unknown key "${k}", using D` };
  const n = base + shift, acc = {};
  if (n > 0) for (let i = 0; i < Math.min(n, 7); i++) acc[SHARP_ORDER[i]] = 1;
  if (n < 0) for (let i = 0; i < Math.min(-n, 7); i++) acc[FLAT_ORDER[i]] = -1;
  return { acc };
}

const LETTER_MIDI = { C:60, D:62, E:64, F:65, G:67, A:69, B:71 };

/**
 * Parse a single ABC tune into a flat list of events, with repeats and 1st/2nd endings
 * expanded. Supports the subset that whistle tunes on The Session actually use: headers
 * T: M: L: Q: K:, notes, rests, accidentals, lengths, broken rhythm (> <), ties, slurs,
 * triplets, grace notes {..}, rolls (~), !slide!, chords (first note kept), inline [K:].
 * Pitches are returned as sounding pitches for a D whistle (written ABC + one octave).
 */
export function parseAbc(text) {
  const warnings = [];
  const head = { title: "", meter: "4/4", unit: null, tempo: null, key: "D" };
  const body = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/%.*$/, "");
    const f = /^([A-Za-z]):\s*(.*)$/.exec(line.trim());
    if (f && !(f[1] === "|")) {
      const [, k, v] = f;
      if (k === "T" && !head.title) head.title = v.trim();
      else if (k === "M") head.meter = v.trim();
      else if (k === "L") head.unit = v.trim();
      else if (k === "Q") head.tempo = v.trim();
      else if (k === "K") { head.key = v.trim(); body.push(`[K:${v.trim()}]`); }
      continue;
    }
    body.push(line.replace(/\\\s*$/, ""));
  }
  const frac = s => { const m = /^(\d+)\s*\/\s*(\d+)$/.exec(s || ""); return m ? +m[1] / +m[2] : null; };
  let unit = frac(head.unit);
  if (!unit) {
    const mv = head.meter === "C" || head.meter === "C|" ? 1 : frac(head.meter);
    unit = mv != null && mv < 0.75 ? 1 / 16 : 1 / 8;
  }
  let qpm = null;
  if (head.tempo) {
    const q = /(?:(\d+)\/(\d+)\s*=\s*)?(\d+)\s*$/.exec(head.tempo.replace(/"[^"]*"/g, "").trim());
    if (q) qpm = +q[3] * (q[1] ? (+q[1] / +q[2]) / 0.25 : unit / 0.25);
  }

  const src = body.join("\n");
  let key = keySignature(head.key);
  if (key.warn) warnings.push(key.warn);
  let barAcc = {};
  const items = []; // notes, rests and bar markers, before repeat expansion
  let slurDepth = 0, slurFresh = false;
  let tuplet = null; // {left, scale}
  let pendingDeco = { roll: false, slide: false };
  let pendingGraces = null;
  let pendingBroken = null; // multiplier for the next note
  let lastNote = null;

  const readPitch = (s, i) => {
    let acc = null;
    const am = /^(\^\^|\^|__|_|=)/.exec(s.slice(i));
    if (am) { acc = { "^":1, "^^":2, "_":-1, "__":-2, "=":0 }[am[1]]; i += am[1].length; }
    const ch = s[i];
    if (!/[A-Ga-g]/.test(ch)) return null;
    i++;
    const letter = ch.toUpperCase();
    let octave = ch === letter ? 0 : 1;
    while (s[i] === "'" || s[i] === ",") { octave += s[i] === "'" ? 1 : -1; i++; }
    const id = letter + octave;
    if (acc !== null) barAcc[id] = acc;
    const a = id in barAcc ? barAcc[id] : (key.acc[letter] || 0);
    return { midi: LETTER_MIDI[letter] + 12 * octave + a + 12, i };
  };
  const readLen = (s, i) => {
    const m = /^(\d*)(\/*)(\d*)/.exec(s.slice(i));
    let num = m[1] ? +m[1] : 1, den = 1;
    if (m[2]) den = m[3] ? +m[3] : Math.pow(2, m[2].length);
    return { len: num / den, i: i + m[0].length };
  };
  const applyTuplet = len => {
    if (!tuplet) return len;
    const out = len * tuplet.scale;
    if (--tuplet.left <= 0) tuplet = null;
    return out;
  };
  const pushNote = (midi, len, isRest) => {
    len = applyTuplet(len * unit);
    if (pendingBroken) { len *= pendingBroken; pendingBroken = null; }
    if (isRest) {
      items.push({ t: "rest", len }); lastNote = items[items.length - 1];
      pendingDeco = { roll: false, slide: false }; pendingGraces = null;
      return;
    }
    if (lastNote && lastNote.t === "note" && lastNote.tie && lastNote.midi === midi) {
      lastNote.len += len; lastNote.tie = false;
      return;
    }
    const slurred = slurDepth > 0 && !slurFresh;
    slurFresh = false;
    const ev = { t: "note", midi, len, slurred, roll: pendingDeco.roll, slide: pendingDeco.slide, graces: pendingGraces || [] };
    items.push(ev); lastNote = ev;
    pendingDeco = { roll: false, slide: false }; pendingGraces = null;
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s|`/.test(c)) { i++; continue; }
    if (c === '"') { const j = src.indexOf('"', i + 1); i = j < 0 ? src.length : j + 1; continue; }
    if (c === "!" || c === "+") {
      const j = src.indexOf(c, i + 1); if (j < 0) { i++; continue; }
      const d = src.slice(i + 1, j).toLowerCase();
      if (d === "roll" || d === "turn") pendingDeco.roll = true;
      if (d === "slide") pendingDeco.slide = true;
      i = j + 1; continue;
    }
    if (c === "~") { pendingDeco.roll = true; i++; continue; }
    if (c === "{") {
      const j = src.indexOf("}", i); const inner = src.slice(i + 1, j < 0 ? src.length : j);
      const g = []; let k = 0;
      while (k < inner.length) { const p = readPitch(inner, k); if (p) { g.push(p.midi); k = readLen(inner, p.i).i; } else k++; }
      pendingGraces = g; i = j < 0 ? src.length : j + 1; continue;
    }
    if (c === "[" && /^\[[A-Za-z]:/.test(src.slice(i))) {
      const j = src.indexOf("]", i); const fld = src.slice(i + 1, j < 0 ? src.length : j);
      if (fld[0] === "K") { key = keySignature(fld.slice(2)); if (key.warn) warnings.push(key.warn); }
      if (fld[0] === "L") { const u = frac(fld.slice(2).trim()); if (u) unit = u; }
      i = j < 0 ? src.length : j + 1; continue;
    }
    if (c === "[" && /^\[[\^_=]*[A-Ga-g]/.test(src.slice(i))) { // chord: keep the first note
      const j = src.indexOf("]", i);
      const p = readPitch(src, i + 1);
      const inner = readLen(src, p.i);
      const after = readLen(src, j + 1);
      pushNote(p.midi, inner.len * after.len, false);
      i = after.i; continue;
    }
    if (c === "|" || c === ":" || (c === "[" && /^\[[|\d]/.test(src.slice(i)))) {
      let j = i, run = "";
      while (j < src.length && /[|:\]\[]/.test(src[j]) && !(src[j] === "[" && /[A-Za-z^_=]/.test(src[j + 1] || ""))) {
        if (src[j] === "[" && /\d/.test(src[j + 1] || "")) break;
        run += src[j++];
      }
      if (src[j] === "[") j++;
      let ending = null;
      const em = /^(\d)(?:[,-]\d)*/.exec(src.slice(j));
      if (em && (run.endsWith("|") || run === "" || src[j - 1] === "[")) { ending = +em[1]; j += em[0].length; }
      const firstBar = run.indexOf("|"), lastBar = run.lastIndexOf("|");
      const end = firstBar < 0 ? run.startsWith("::") || run.startsWith(":") : run.slice(0, firstBar).includes(":");
      const start = firstBar < 0 ? run.includes("::") : run.slice(lastBar + 1).includes(":");
      if (run.length || ending) items.push({ t: "bar", end, start: start || run === "::", ending });
      barAcc = {};
      i = Math.max(j, i + 1); continue;
    }
    if (c === "(") {
      const m = /^\((\d)(?::(\d)?)?(?::(\d))?/.exec(src.slice(i));
      if (m) {
        const p = +m[1];
        const q = m[2] ? +m[2] : ({ 2:3, 3:2, 4:3, 6:2 }[p] || 2);
        tuplet = { left: m[3] ? +m[3] : p, scale: q / p };
        i += m[0].length; continue;
      }
      slurDepth++; slurFresh = true; i++; continue;
    }
    if (c === ")") { slurDepth = Math.max(0, slurDepth - 1); i++; continue; }
    if (c === "-") { if (lastNote && lastNote.t === "note") lastNote.tie = true; i++; continue; }
    if (c === ">" || c === "<") {
      let n = 0; while (src[i] === c) { n++; i++; }
      const big = 2 - Math.pow(0.5, n), small = Math.pow(0.5, n);
      if (lastNote) lastNote.len *= c === ">" ? big : small;
      pendingBroken = c === ">" ? small : big;
      continue;
    }
    if (c === "z" || c === "x" || c === "Z") {
      const l = readLen(src, i + 1); pushNote(0, l.len, true); i = l.i; continue;
    }
    const p = /[\^_=A-Ga-g]/.test(c) ? readPitch(src, i) : null;
    if (p) { const l = readLen(src, p.i); pushNote(p.midi, l.len, false); i = l.i; continue; }
    i++; // decorations like . H L M P S T u v and anything unknown
  }

  // Expand repeats and 1st/2nd endings.
  const events = [];
  let repStart = 0, pass = 1, skip = false;
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (it.t !== "bar") { if (!skip) events.push({ ...it }); continue; }
    if (skip) {
      if (it.ending && it.ending !== 1) { skip = false; pass = 1; }
      else if (it.end && !it.ending) { /* end of 1st ending: keep skipping until the 2nd */ }
      if (!skip && it.start) repStart = k + 1;
      continue;
    }
    if (it.ending === 1 && pass === 2) { skip = true; continue; }
    if (it.end) {
      if (pass === 1) { pass = 2; k = repStart - 1; continue; }
      pass = 1; repStart = k + 1;
    }
    if (it.ending && it.ending !== 1 && pass === 1) { /* 2nd ending reached in order */ }
    if (it.start) { repStart = k + 1; pass = 1; }
  }

  // Fold notes below the whistle's range up an octave (players do the same).
  let folded = 0;
  for (const e of events) {
    if (e.t !== "note") continue;
    while (e.midi < LOW_D) { e.midi += 12; folded++; }
    while (e.midi > LOW_D + 26) e.midi -= 12;
    e.graces = e.graces.map(g => { while (g < LOW_D) g += 12; return g; });
  }
  if (folded) warnings.push(`${folded} note${folded === 1 ? "" : "s"} below low D raised an octave`);
  if (!events.some(e => e.t === "note")) warnings.push("No notes found");
  return { title: head.title, meter: head.meter, key: head.key, qpm, events, warnings };
}

/* ---------------------------------------------------------------- player profiles */

export const DEFAULTS = {
  sr: 44100,
  bpm: null,            // quarter notes per minute; null = use the tune's Q: or 120
  articulation: "abc",  // "abc" (tongue unless slurred) | "legato" (tongue only repeats and after rests) | "tongued"
  tuningCents: 0,       // whole-instrument offset from A=440
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

  const items = [];
  let prevMidi = null, prevWasRest = true;
  evs.forEach((e, k) => {
    const a = onsets[k], b = k + 1 < evs.length ? onsets[k + 1] : endT;
    if (e.t === "rest") { prevWasRest = true; return; }
    const dur = b - a;
    const hasOrn = e.roll || e.graces.length > 0;
    let tongued;
    if (o.articulation === "tongued") tongued = true;
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
    if (e.roll && dur - (cur - a) > 4 * g) {
      const rem = b - cur, third = rem / 3;
      const cut = stepFrom(e.midi, 2) ?? e.midi + 2;
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
    it.vib = it.kind === "note" && dur > 0.42 && o.vibratoCents > 0;
    it.blips = [];

    if (it.tongued && it.kind === "note" && !reg && dur > 0.1 && R.chance(o.overtoneProb)) {
      const up = R.chance(0.3) ? 19 : 12, len = R.range(0.010, 0.024);
      const s = it.start + it.tongueS;
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
    if (it.tongueS) { const e = S(it.start + it.tongueS); for (let n = s0; n < e; n++) { tAmp[n] = it.amp * 0.02; stop[n] = 1; } if (e < N) chiffAt[e] = 1; }
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
    const m = midi + cents / 100;
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
  const parsed = parseAbc(abc);
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
