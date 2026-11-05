// Grooves: what the backing band plays on each beat of the chart's beat grid.
//
// A pattern gives one string per beat of the bar. Each character is one stroke, spaced evenly
// across the beat: "Du" is two eighths in a simple-time beat, "Dud" three in a jig's dotted-quarter
// beat, "Dudu" four sixteenths (a fill). "-" is a rest. Strokes are the bodhrán's (see bodhran.js).
// A groove has a normal bar, a variation (every fourth bar) and a fill (the end of each eight-bar
// phrase). A groove can also set its own stroke strengths (`vel`) and how much harder the bar's first
// stroke is than its other beats (`barAccent`, 1.1 by default).
//
// Step 4 of the roadmap adds the rest of the rhythms (hornpipes, polkas, slides, slip jigs, waltzes,
// strathspeys, mazurkas, barndances). Until then, tunes in those rhythms get a plain groove that
// suits their time signature.
import { meterInfo } from "../chart/chart.js";

export const GROOVES = {
  reel: {
    label: "Reel",
    // felt in two: the strong down-strokes on beats 1 and 3
    normal: ["Du", "du", "Du", "du"],
    variation: ["Du", "du", "Du", "tu"],
    fill: ["Du", "du", "Dudu", "Du"],
  },
  jig: {
    label: "Jig",
    // strong down-strokes on 1 and 4, two light up-strokes after each: DOWN up up DOWN up up
    normal: ["Duu", "Duu"],
    variation: ["Duu", "Dut"],
    fill: ["Duu", "Dtu"],
    vel: { u: 0.32, t: 0.5 },   // lighter than the default, so the 1 and 4 stand out
    barAccent: 1,               // beat 4 as strong as beat 1
  },
};

/** A plain groove for any time signature: a down-stroke on each beat, up-strokes between. */
export function plainGroove(beatsPerBar, compound) {
  const first = compound ? "Dud" : "Du", other = compound ? "dud" : "du";
  const bar = Array.from({ length: beatsPerBar }, (_, i) => (i === 0 ? first : other));
  return { label: "Plain", normal: bar, variation: bar, fill: bar };
}

/**
 * The groove for a tune: from its rhythm (the ABC R: field) when there's a pattern for it,
 * otherwise a plain one for its time signature.
 */
export function grooveFor(parsed) {
  const mi = meterInfo(parsed.meter), compound = mi.beatLen > mi.barLen / mi.num + 1e-9;
  const r = (parsed.meta && parsed.meta.rhythm || "").toLowerCase().trim();
  if (/^(single |double )?reel/.test(r) && !compound && mi.beatsPerBar % 2 === 0) return { id: "reel", ...GROOVES.reel };
  if (/^(single |double )?jig/.test(r) && compound && mi.beatsPerBar === 2) return { id: "jig", ...GROOVES.jig };
  // no rhythm given: a 6/8 tune is almost always a jig, a 4/4 or 2/2 one often a reel
  if (!r && compound && mi.beatsPerBar === 2) return { id: "jig", ...GROOVES.jig };
  if (!r && !compound && mi.beatsPerBar === 4 && mi.num === 4) return { id: "reel", ...GROOVES.reel };
  return { id: "plain", ...plainGroove(mi.beatsPerBar, compound) };
}

const VEL = { D: 1, d: 0.62, u: 0.5, t: 0.66 };

/**
 * The strokes for one beat: [{ t, kind, vel }], times in the same clock as `t` (the beat's start)
 * and `dur` (its length). `beatInBar` counts from 0 at the bar's first beat, `bar` from 0 at the
 * first downbeat. `rnd` is a random source (0–1) for the human touch.
 */
export function beatStrokes(groove, { t, dur, beatInBar, bar, rnd = Math.random, loose = 0.004 }) {
  const which = bar % 8 === 7 ? groove.fill : bar % 4 === 3 ? groove.variation : groove.normal;
  const pat = which[beatInBar % which.length] || "";
  const out = [];
  for (let i = 0; i < pat.length; i++) {
    const kind = pat[i];
    if (kind === "-" || !VEL[kind]) continue;
    const base = (groove.vel && groove.vel[kind]) ?? VEL[kind];
    let vel = base * (beatInBar === 0 && i === 0 ? groove.barAccent ?? 1.1 : 1);
    vel *= 1 + (rnd() - 0.5) * (kind === "D" ? 0.1 : 0.2); // accents vary less than the light strokes
    const jitter = i === 0 && beatInBar === 0 ? 0 : (rnd() + rnd() - 1) * loose; // bar starts stay put
    out.push({ t: t + (dur * i) / pat.length + jitter, kind, vel: Math.min(1.15, vel) });
  }
  return out;
}
