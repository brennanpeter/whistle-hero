// Can this tune be played on a D whistle as written? Finds notes that need half-holing, notes
// outside the whistle's range, and suggests a transposition when one makes the tune easier.
import { parseAbc } from "./abc.js";
import { LOW_D, noteInfo } from "../whistle.js";

export const TOP_COMFORT = LOW_D + 21; // B″ (B in the second octave). Above this is the hard third octave.

/**
 * Check a parsed tune. Returns
 *   { issues: [{ kind, name, bar, pos, count }], halfHoles, belowRange, aboveRange, highNotes, cNaturals, ok }
 * kind is "half-hole" (off the D scale), "below" (written below low D, raised an octave),
 * "above" (written above the range, lowered an octave) or "high" (third octave, hard to sound).
 * C♮ is counted separately: it is cross-fingered, so it is playable but worth knowing about.
 */
export function checkPlayability(parsed) {
  const found = new Map(); // one issue per kind + pitch, with the first bar it appears in
  let halfHoles = 0, belowRange = 0, aboveRange = 0, highNotes = 0, cNaturals = 0;
  const note = (kind, midi, e) => {
    const key = kind + midi;
    if (found.has(key)) found.get(key).count++;
    else found.set(key, { kind, name: noteInfo(midi).name, midi, bar: e.bar, pos: e.pos, count: 1 });
  };
  for (const e of parsed.events) {
    if (e.t !== "note") continue;
    for (const m of [e.midi, ...e.graces]) {
      const inf = noteInfo(m);
      if (!inf.inScale) { halfHoles++; note("half-hole", m, e); }
      else if (inf.pc === 10) cNaturals++;
      if (m > TOP_COMFORT && inf.inScale) { highNotes++; note("high", m, e); }
    }
    if (e.written < LOW_D) { belowRange++; note("below", e.written, e); }
    if (e.written > LOW_D + 26) { aboveRange++; note("above", e.written, e); }
  }
  const issues = [...found.values()].sort((a, b) => a.pos - b.pos);
  return { issues, halfHoles, belowRange, aboveRange, highNotes, cNaturals, ok: halfHoles === 0 && belowRange === 0 && aboveRange === 0 };
}

// Lower is easier. Half-holed notes cost most; folding an octave breaks the melody's shape.
const cost = r => r.halfHoles * 10 + (r.belowRange + r.aboveRange) * 3 + r.highNotes * 2 + r.cNaturals * 0.5;

/**
 * Try every transposition from −6 to +6 semitones and return the easiest, or null when the tune
 * is already as easy as it gets. Result: { transpose, check, before } with the playability of each.
 */
export function suggestTranspose(abc) {
  const before = checkPlayability(parseAbc(abc));
  let best = null;
  for (let t = -6; t <= 6; t++) {
    if (t === 0) continue;
    const check = checkPlayability(parseAbc(abc, { transpose: t }));
    const c = cost(check) + Math.abs(t) * 0.2; // prefer small moves when two are equally easy
    if (!best || c < best.cost) best = { transpose: t, check, cost: c };
  }
  if (!best || best.cost >= cost(before)) return null;
  return { transpose: best.transpose, check: best.check, before };
}

/** "up a tone", "down 3 semitones" … */
export function describeTranspose(t) {
  if (!t) return "as written";
  const n = Math.abs(t), dir = t > 0 ? "up" : "down";
  const word = { 1: "a semitone", 2: "a tone" }[n] || `${n} semitones`;
  return `${dir} ${word}`;
}
