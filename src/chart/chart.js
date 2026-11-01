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

  const notes = [], ornaments = [];
  let prevMidi = null, prevRest = true;
  for (const e of parsed.events) {
    if (e.t !== "note") { prevRest = true; continue; }
    const t = e.pos * spw, dur = e.len * spw;
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
  const end = parsed.length * spw;
  for (let k = 0; k < bars.length; k++) {
    const b0 = bars[k].t, b1 = k + 1 < bars.length ? bars[k + 1].t : end;
    if (bars[k].pickup) {
      for (let x = b1 - mi.beatLen * spw; x > b0 - 1e-6; x -= mi.beatLen * spw) beats.push({ t: x, strong: false });
    } else {
      for (let j = 0; j < mi.beatsPerBar; j++) { const x = b0 + j * mi.beatLen * spw; if (x < b1 - 1e-6) beats.push({ t: x, strong: j === 0 }); }
    }
  }
  beats.sort((a, b) => a.t - b.t);
  ornaments.sort((a, b) => a.t - b.t);

  return {
    title: parsed.title, meta: parsed.meta || {}, key: parsed.key, meter: parsed.meter, rhythm, qpm,
    beatsPerBar: mi.beatsPerBar, beatSeconds: mi.beatLen * spw, parts: parsed.parts,
    duration: end, notes, ornaments, bars, beats,
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
