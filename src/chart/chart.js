// Game charts: a parsed ABC tune turned into timed events the player must hit.
//
//   const chart = buildChart(parseAbc(abc), { bpm: 120 });
//   chart.notes      [{ id, t, expect, dur, midi, name, bar, part, pass, beat, slurred, ornament, graces }]
//                    t is the beat the note belongs to; expect is when its main pitch should sound
//                    (after any written cut or tap, or as a slide lands)
//   chart.ornaments  [{ id, t, dur, midi, name, kind: "cut" | "tap", note, ornament: "roll" | "grace" }]
//   chart.bars       [{ t, bar, part, pass, pickup }]
//   chart.beats      [{ t, strong }]   strong = first beat of a bar
//
// Times are in seconds from the first note at the chosen tempo. The written rhythm is kept
// exactly: ornaments are placed at nominal positions and the game scores them with a tolerance.
import { noteName, cutFor, tapFor } from "../whistle.js";

// Moderate learning tempos (quarter notes per minute) when a tune has no Q: field.
// Session speeds are faster; the game's speed control starts from these.
export const DEFAULT_QPM = {
  reel: 180, hornpipe: 160, jig: 150, "slip jig": 150, slide: 180, polka: 200,
  waltz: 150, mazurka: 150, barndance: 160, strathspey: 120, march: 110, "three-two": 150,
};

/**
 * Swing: hornpipes and barndances are usually written in even eighths but played long-short. This
 * is where the second of each pair of eighths falls (0.5 would be even). The backing drum uses the
 * same amounts.
 */
export const SWING = { hornpipe: 0.66, barndance: 0.64 };

/**
 * How a tune is swung, or null: { pair, ratio }, `pair` being the length of a pair of notes in whole
 * notes. Only a hornpipe or barndance in simple time, written in even notes; one written dotted
 * (A>B) already has its swing on the page.
 */
export function swingFor(parsed) {
  const ratio = SWING[(parsed.meta?.rhythm || "").toLowerCase().trim().replace(/^barn dance/, "barndance")];
  if (!ratio) return null;
  const mi = meterInfo(parsed.meter);
  if (mi.beatLen > mi.barLen / mi.num + 1e-9) return null; // compound time
  // written swung: dotted pairs put notes a quarter or three quarters of the way through a pair
  const pair = 2 * (parsed.unit || 1 / 8), evs = parsed.events.filter(e => e.len > 0);
  const dotted = evs.filter(e => { const f = (e.pos / pair) % 1; return Math.abs(f - 0.25) < 1e-6 || Math.abs(f - 0.75) < 1e-6; }).length;
  return evs.length && dotted / evs.length < 0.1 ? { pair, ratio } : null;
}

/**
 * A position (in whole notes) moved by swing: a note halfway through a pair starts late. Triplets
 * and other divisions stay where they're written, as players keep them even inside a swung tune.
 */
export function swingPos(pos, sw) {
  if (!sw) return pos;
  const q = Math.floor(pos / sw.pair + 1e-9), f = pos / sw.pair - q;
  return Math.abs(f - 0.5) < 1e-6 ? (q + sw.ratio) * sw.pair : pos;
}

/** Beats per bar and the length of one beat (in whole notes) for a meter string. */
export const SLIDE_LAND = 0.08; // seconds from the start of a slide to landing on its note

export function meterInfo(meter) {
  const m = meter === "C" ? [4, 4] : meter === "C|" ? [2, 2] : (/^(\d+)\/(\d+)/.exec(meter || "") || [0, 4, 4]).slice(1).map(Number);
  const [num, den] = m;
  const compound = den === 8 && num % 3 === 0 && num > 3; // 6/8, 9/8, 12/8: beats are dotted quarters
  const beatLen = compound ? 3 / 8 : 1 / den;
  return { num, den, barLen: num / den, beatLen, beatsPerBar: Math.round((num / den) / beatLen) };
}

export function buildChart(parsed, { bpm = null, graceMs = 35 } = {}) {
  const rhythm = (parsed.meta?.rhythm || "").toLowerCase().trim();
  const qpm = bpm || parsed.qpm || DEFAULT_QPM[rhythm] || 120;
  const spw = 240 / qpm; // seconds per whole note
  const mi = meterInfo(parsed.meter);
  const g = graceMs / 1000;

  const sw = swingFor(parsed); // a hornpipe written in even eighths is played swung
  const notes = [], ornaments = [];
  let prevMidi = null, prevRest = true;
  for (const e of parsed.events) {
    if (e.t !== "note") { prevRest = true; continue; }
    const t = swingPos(e.pos, sw) * spw, dur = (swingPos(e.pos + e.len, sw) - swingPos(e.pos, sw)) * spw;
    const gd = Math.min(g, dur * 0.22);
    const expect = t + e.graces.length * gd + (e.slide ? SLIDE_LAND : 0);
    const n = {
      id: notes.length, t, expect, dur, midi: e.midi, name: noteName(e.midi), bar: e.bar, part: e.part, pass: e.pass,
      beat: e.pos / mi.beatLen, slurred: e.slurred && !prevRest, repeat: e.midi === prevMidi && !prevRest,
      ornament: e.roll ? "roll" : e.slide ? "slide" : e.graces.length ? "grace" : null, graces: e.graces,
    };
    notes.push(n);
    const orn = (kind, midi, at, role) => ornaments.push({ id: ornaments.length, t: at, dur: gd, midi, name: noteName(midi), kind, note: n.id, ornament: role });
    // written grace notes are played on the beat, as the start of the note they ornament
    e.graces.forEach((gm, k) => orn(gm > e.midi ? "cut" : "tap", gm, t + k * gd, "grace"));
    if (e.roll) {
      // a long roll: the note, a cut on the second pulse, a tap on the third (low D gets two cuts)
      const tap = tapFor(e.midi);
      orn("cut", cutFor(e.midi), t + dur / 3, "roll");
      orn(tap != null ? "tap" : "cut", tap ?? cutFor(e.midi), t + 2 * dur / 3, "roll");
    }
    prevMidi = e.midi; prevRest = false;
  }

  // Bars and the beat grid. A short first bar is a pickup: its beats are counted back from bar 2.
  const bars = parsed.bars.map((b, k) => ({ t: b.pos * spw, bar: b.bar, part: b.part, pass: b.pass, pickup: false }));
  if (parsed.bars.length > 1 && parsed.bars[1].pos < mi.barLen - 1e-9) bars[0].pickup = true;
  const beats = [];
  const end = parsed.length * spw, step = mi.beatLen * spw, full = mi.barLen * spw;
  const forward = (b0, b1) => { for (let j = 0; j < mi.beatsPerBar; j++) { const x = b0 + j * step; if (x < b1 - 1e-6) beats.push({ t: x, strong: j === 0 }); } };
  const back = (b0, b1) => { for (let x = b1 - step; x > b0 - 1e-6; x -= step) beats.push({ t: x, strong: false }); };
  for (let k = 0; k < bars.length; k++) {
    const b0 = bars[k].t, b1 = k + 1 < bars.length ? bars[k + 1].t : end, b2 = k + 2 < bars.length ? bars[k + 2].t : end;
    const short = b1 - b0 < full - 1e-6;
    if (short && !bars[k].pickup && k + 1 < bars.length && Math.abs(b2 - b0 - full) < 1e-6) {
      // a short bar completed by the next: the bar before a repeat and the pickup played again after
      // it. One bar's beats across the two, so the grid stays even.
      forward(b0, b2); k++;
    } else if (bars[k].pickup || (short && k + 1 < bars.length)) back(b0, b1); // counted back from the next downbeat
    else forward(b0, b1);
  }
  beats.sort((a, b) => a.t - b.t);
  ornaments.sort((a, b) => a.t - b.t);

  return {
    title: parsed.title, meta: parsed.meta || {}, key: parsed.key, meter: parsed.meter, rhythm, qpm,
    beatsPerBar: mi.beatsPerBar, beatSeconds: mi.beatLen * spw, parts: parsed.parts,
    duration: end, notes, ornaments, bars, beats, swing: sw,
  };
}

/**
 * A copy of a chart moved later by `dt` seconds, with note and ornament ids continuing from
 * `firstNote` / `firstOrnament`. Used to string passes of a tune together when looping.
 * `loop` (1, 2, …) is recorded on every note so views and results can tell passes apart.
 */
export function shiftChart(chart, dt, { firstNote = 0, firstOrnament = 0, loop = 1 } = {}) {
  return {
    ...chart,
    loop, start: dt, duration: chart.duration, end: dt + chart.duration,
    notes: chart.notes.map(n => ({ ...n, id: n.id + firstNote, t: n.t + dt, expect: (n.expect ?? n.t) + dt, loop })),
    ornaments: chart.ornaments.map(o => ({ ...o, id: o.id + firstOrnament, note: o.note + firstNote, t: o.t + dt, loop })),
    bars: chart.bars.map(b => ({ ...b, t: b.t + dt, loop })),
    beats: chart.beats.map(b => ({ ...b, t: b.t + dt })),
  };
}
