// Grooves: what the backing band plays on each beat of the chart's beat grid.
//
// A pattern gives one string per beat of the bar. Each character is one stroke, spaced evenly
// across the beat: "Du" is two eighths in a simple-time beat, "Dud" three in a jig's dotted-quarter
// beat, "Dudu" four sixteenths (a fill). "-" is a rest. Strokes are the bodhrán's (see bodhran.js).
// A groove has a normal bar, a variation (every fourth bar) and a fill (the end of each eight-bar
// phrase). A groove can also set its own stroke strengths (`vel`), how much harder the bar's first
// stroke is than its other beats (`barAccent`, 1.1 by default), and `swing`: where the second of each
// pair of strokes falls (0.5 is straight; 2/3 is a hornpipe's lilt).
//
// Each groove is written for its usual time signature (`meter`). A tune written with half as many
// beats to the bar (a reel in 2/2, a hornpipe in 2/4) gets the same groove with pairs of beats joined.
// Anything else gets a plain groove for its time signature.
//
// The guitar's part is `strum` (and `strumFill` for the end of a phrase), in the same notation: B the
// bass with a gentle strum of the top strings, b the bass alone, T an accented brush of the top
// strings, t a light one (see guitar.js).
import { meterInfo, SWING } from "../chart/chart.js";

export const GROOVES = {
  reel: {
    label: "Reel", meter: "4/4",
    strum: ["Bt", "-t", "Bt", "-t"],
    // felt in two: the strong down-strokes on beats 1 and 3
    normal: ["Du", "du", "Du", "du"],
    variation: ["Du", "du", "Du", "tu"],
    fill: ["Du", "du", "Dudu", "Du"],
  },
  jig: {
    label: "Jig", meter: "6/8",
    strum: ["B-t", "B-t"],
    // strong down-strokes on 1 and 4, two light up-strokes after each: DOWN up up DOWN up up
    normal: ["Duu", "Duu"],
    variation: ["Duu", "Dut"],
    fill: ["Duu", "Dtu"],
    vel: { u: 0.32, t: 0.5 },   // lighter than the default, so the 1 and 4 stand out
    barAccent: 1,               // beat 4 as strong as beat 1
  },
  hornpipe: {
    label: "Hornpipe", meter: "4/4",
    strum: ["Bt", "-t", "Bt", "-t"], strumFill: ["B", "T", "T", "-"],
    // swung, heavy on 1 and 3; the phrase ends on three solid beats, like the tune's own cadence
    normal: ["Du", "du", "Du", "du"],
    variation: ["Du", "du", "Du", "tu"],
    fill: ["D", "D", "D", "-"],
    swing: SWING.hornpipe,
    vel: { u: 0.4 },
  },
  polka: {
    label: "Polka", meter: "2/4",
    strum: ["Bt", "Bt"],
    // driving: both beats strong, light up-strokes between
    normal: ["Du", "Du"],
    variation: ["Du", "tu"],
    fill: ["Dudu", "Du"],
    vel: { u: 0.38 },
    barAccent: 1,
  },
  slide: {
    label: "Slide", meter: "12/8",
    strum: ["B-t", "T-t", "B-t", "T-t"],
    // the long-short lilt of a slide (dum-da), accents on 1 and 3
    normal: ["D-u", "d-u", "D-u", "d-u"],
    variation: ["D-u", "d-u", "D-u", "t-u"],
    fill: ["D-u", "d-u", "Duu", "Duu"],
    vel: { u: 0.4, d: 0.6 },
  },
  "slip jig": {
    label: "Slip jig", meter: "9/8",
    strum: ["B-t", "T-t", "T-t"],
    // like a jig, with one big accent a bar
    normal: ["Duu", "duu", "duu"],
    variation: ["Duu", "duu", "tuu"],
    fill: ["Duu", "duu", "Dtu"],
    vel: { u: 0.32, d: 0.62, t: 0.5 },
  },
  waltz: {
    label: "Waltz", meter: "3/4",
    strum: ["B", "t", "t"],
    // oom-pah-pah: the low note on 1, light top notes on 2 and 3
    normal: ["D", "t", "t"],
    variation: ["D", "t", "tu"],
    fill: ["D", "tu", "tu"],
    vel: { t: 0.42, u: 0.3 },
  },
  strathspey: {
    label: "Strathspey", meter: "4/4",
    strum: ["B--t", "T---", "B--t", "T---"],
    // dotted rhythms: long-short (D--u) and the Scotch snap, short-long (du--)
    normal: ["D--u", "du--", "D--u", "d--u"],
    variation: ["D--u", "du--", "D--u", "t--u"],
    fill: ["D--u", "du--", "Du-u", "D---"],
    vel: { u: 0.45 },
  },
  mazurka: {
    label: "Mazurka", meter: "3/4",
    strum: ["B", "T", "t"],
    // the push on beat 2 that makes a mazurka
    normal: ["D", "Du", "t"],
    variation: ["D", "Du", "tu"],
    fill: ["D", "Dudu", "D"],
    vel: { t: 0.45, u: 0.35 },
    barAccent: 0.9,
  },
  barndance: {
    label: "Barndance", meter: "4/4",
    strum: ["Bt", "-t", "Bt", "Tt"],
    // lighter and bouncier than a hornpipe
    normal: ["Du", "tu", "Du", "tu"],
    variation: ["Du", "tu", "Du", "du"],
    fill: ["Du", "tu", "D", "D"],
    swing: SWING.barndance,
    vel: { u: 0.35, t: 0.45 },
  },
};

// the tune's rhythm (R: field) → groove
const RHYTHMS = [
  [/^(single |double )?reel/, "reel"], [/^slip ?jig/, "slip jig"], [/^(single |double )?jig/, "jig"],
  [/^hornpipe/, "hornpipe"], [/^polka/, "polka"], [/^slide/, "slide"], [/^waltz/, "waltz"],
  [/^strathspey/, "strathspey"], [/^mazurka/, "mazurka"], [/^(barn ?dance|schottische|highland|fling)/, "barndance"],
];
// with no rhythm given, the time signature is usually enough of a hint
const BY_METER = { "6/8": "jig", "9/8": "slip jig", "12/8": "slide", "2/4": "polka", "3/4": "waltz", "4/4": "reel", "2/2": "reel", "C": "reel", "C|": "reel" };

/**
 * A groove fitted to a time signature: as written for its own, joined in pairs for one with half the
 * beats (2/2 for a 4/4 groove), or null when it doesn't fit.
 */
export function fitGroove(g, beatsPerBar) {
  const n = g.normal.length;
  if (n === beatsPerBar) return g;
  if (n === beatsPerBar * 2) {
    const join = bar => Array.from({ length: beatsPerBar }, (_, i) => bar[2 * i] + bar[2 * i + 1]);
    return { ...g, normal: join(g.normal), variation: join(g.variation), fill: join(g.fill),
      strum: g.strum && join(g.strum), strumFill: g.strumFill && join(g.strumFill), joined: true };
  }
  return null;
}

/** A plain groove for any time signature: a down-stroke on each beat, up-strokes between. */
export function plainGroove(beatsPerBar, compound) {
  const first = compound ? "Dud" : "Du", other = compound ? "dud" : "du";
  const bar = Array.from({ length: beatsPerBar }, (_, i) => (i === 0 ? first : other));
  return { label: "Plain", normal: bar, variation: bar, fill: bar, strum: Array.from({ length: beatsPerBar }, (_, i) => (i === 0 ? "B" : "T") + (compound ? "-t" : "t")) };
}

/**
 * The groove for a tune: from its rhythm (the ABC R: field) when there's a pattern for it,
 * otherwise a plain one for its time signature.
 */
export function grooveFor(parsed) {
  const mi = meterInfo(parsed.meter), compound = mi.beatLen > mi.barLen / mi.num + 1e-9;
  const r = (parsed.meta && parsed.meta.rhythm || "").toLowerCase().trim();
  const id = r ? (RHYTHMS.find(([re]) => re.test(r)) || [])[1] : BY_METER[(parsed.meter || "").trim()];
  const g = id && GROOVES[id];
  // the groove has to suit the time signature: simple or compound, and the right number of beats
  const gCompound = g && meterInfo(g.meter).beatLen > meterInfo(g.meter).barLen / meterInfo(g.meter).num + 1e-9;
  const fitted = g && gCompound === compound ? fitGroove(g, mi.beatsPerBar) : null;
  if (fitted) return { id, ...fitted };
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
    // where in the beat: evenly spaced, or swung (the second of each pair later)
    let at = (dur * i) / pat.length;
    if (groove.swing && pat.length % 2 === 0) { const pair = (2 * dur) / pat.length; at = Math.floor(i / 2) * pair + (i % 2 ? groove.swing * pair : 0); }
    out.push({ t: t + at + jitter, kind, vel: Math.min(1.15, vel) });
  }
  return out;
}
