// ABC notation parser for whistle tunes.
// Shared by Whistle Sim, the Tune Library and the game's chart builder.
import { LOW_D } from "../whistle.js";

// Information fields kept as tune metadata (ABC 2.1 letters).
const META_FIELDS = { C: "composer", R: "rhythm", S: "source", Z: "transcriber", N: "notes", O: "origin", B: "book", H: "history", D: "discography", F: "fileUrl", P: "parts" };

/**
 * Split a pasted ABC file into tunes. Each tune starts at an X: line; lines before the first X:
 * are a file header whose fields apply to every tune. Text with no X: at all is one tune.
 * Returns [{ x, text }] where text is a complete tune that parseAbc can read.
 */
export function splitAbcFile(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const starts = [];
  lines.forEach((l, i) => { if (/^X:/.test(l.trim())) starts.push(i); });
  if (!starts.length) return String(text).trim() ? [{ x: null, text: String(text).trim() }] : [];
  const fileHeader = lines.slice(0, starts[0]).filter(l => /^[A-Za-z]:/.test(l.trim()) && !/^[A-Za-z]:\|/.test(l.trim()));
  return starts.map((s, k) => {
    const body = lines.slice(s, k + 1 < starts.length ? starts[k + 1] : lines.length);
    while (body.length && !body[body.length - 1].trim()) body.pop();
    const x = /^X:\s*(\d+)/.exec(body[0].trim());
    // file-header fields go after X: so the tune's own fields override them
    return { x: x ? +x[1] : null, text: [body[0], ...fileHeader, ...body.slice(1)].join("\n") };
  }).filter(t => t.text.split("\n").some(l => /^K:/.test(l.trim())));
}

/** Parse every tune in a pasted file. */
export const parseAbcFile = (text, opts) => splitAbcFile(text).map(t => ({ ...parseAbc(t.text, opts), x: t.x, abc: t.text }));

const MAJOR_FIFTHS = { C:0, G:1, D:2, A:3, E:4, B:5, "F#":6, "C#":7, F:-1, Bb:-2, Eb:-3, Ab:-4, Db:-5, Gb:-6, Cb:-7, "G#":8, "D#":9, "A#":10 };
const MODE_SHIFT = { maj:0, ion:0, mix:-1, dor:-2, min:-3, aeo:-3, m:-3, phr:-4, loc:-5, lyd:1 };
const SHARP_ORDER = "FCGDAEB", FLAT_ORDER = "BEADGCF";

export function keySignature(k) {
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
 *
 * Each note and rest carries pos (whole notes from the start), bar, part (0 = A part, 1 = B …)
 * and pass (1 or 2 for the first or second time through a repeat). bars lists where each bar
 * starts. Notes outside the whistle's range are folded by an octave; note.written keeps the
 * pitch before folding. opts.transpose shifts every note by that many semitones first.
 */
export function parseAbc(text, opts = {}) {
  const warnings = [];
  const transpose = opts.transpose || 0;
  const head = { title: "", titles: [], meter: "4/4", unit: null, tempo: null, key: "D", meta: {} };
  const body = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/%.*$/, "");
    // A field is "X:value"; "A:|" at the start of a line is a note and a repeat, not the A: field.
    const f = /^([A-Za-z]):(?![|:])\s*(.*)$/.exec(line.trim());
    if (f) {
      const [, k, v] = f;
      if (k === "T") { if (!head.title) head.title = v.trim(); if (v.trim()) head.titles.push(v.trim()); }
      else if (k in META_FIELDS && v.trim()) { const f2 = META_FIELDS[k]; head.meta[f2] = head.meta[f2] ? head.meta[f2] + "\n" + v.trim() : v.trim(); }
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
    return { midi: LETTER_MIDI[letter] + 12 * octave + a + 12 + transpose, i };
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
      // a bar line crossed by the tie really falls inside the note: remember how far back
      for (let k = items.indexOf(lastNote) + 1; k < items.length; k++) if (items[k].t === "bar") items[k].back = (items[k].back || 0) + len;
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
      const double = /\|\||\|\]|\[\|/.test(run);
      if (run.length || ending) items.push({ t: "bar", end, start: start || run === "::", ending, double });
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

  // Expand repeats and 1st/2nd endings, recording bars, parts and passes as we go.
  const events = [], bars = [];
  let repStart = 0, pass = 1, skip = false, barBack = 0;
  let pos = 0, barNo = -1, sinceBar = 0, newBar = true, part = 0, partNotes = 0, partBars = 0, newPart = false;
  const emit = it => {
    if (newPart) { part++; partNotes = 0; partBars = 0; newPart = false; newBar = true; }
    if (newBar) { barNo++; partBars++; bars.push({ pos: pos - barBack, bar: barNo, part, pass }); newBar = false; }
    barBack = 0;
    events.push({ ...it, pos, bar: barNo, part, pass });
    pos += it.len; sinceBar++; partNotes++;
  };
  const barLine = () => { if (sinceBar > 0) { newBar = true; sinceBar = 0; } };
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (it.t !== "bar") { if (!skip) emit(it); continue; }
    barBack = it.back || 0;
    if (skip) {
      if (it.ending && it.ending !== 1) { skip = false; pass = 2; barLine(); }
      if (!skip && it.start) repStart = k + 1;
      continue;
    }
    barLine();
    if (it.ending === 1 && pass === 2) { skip = true; continue; }
    if (it.end) {
      if (pass === 1) { pass = 2; k = repStart - 1; continue; }
      pass = 1; repStart = k + 1;
      if (partNotes > 0) newPart = true;
    }
    // a pickup bar before the first |: belongs to the A part
    if (it.start) { repStart = k + 1; pass = 1; if (partNotes > 0 && !(part === 0 && partBars === 1)) newPart = true; }
    if (it.double && partNotes > 0) newPart = true;
    if (it.double && !it.end) { repStart = k + 1; pass = 1; } // a later :| repeats from the last double bar
  }

  // Fold notes below the whistle's range up an octave (players do the same).
  let folded = 0, foldedDown = 0;
  for (const e of events) {
    if (e.t !== "note") continue;
    e.written = e.midi;
    while (e.midi < LOW_D) { e.midi += 12; folded++; }
    while (e.midi > LOW_D + 26) { e.midi -= 12; foldedDown++; }
    e.graces = e.graces.map(g => { while (g < LOW_D) g += 12; while (g > LOW_D + 26) g -= 12; return g; });
  }
  if (folded) warnings.push(`${folded} note${folded === 1 ? "" : "s"} below low D raised an octave`);
  if (foldedDown) warnings.push(`${foldedDown} note${foldedDown === 1 ? "" : "s"} above high E lowered an octave`);
  if (!events.some(e => e.t === "note")) warnings.push("No notes found");
  return { title: head.title, titles: head.titles, meter: head.meter, unit, key: head.key, qpm, meta: head.meta,
    transpose, events, bars, length: pos, parts: part + 1, warnings };
}
