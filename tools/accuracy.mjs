// Detector accuracy report: render each Whistle Sim scenario, run the detector, score it against
// the ground truth. The test suite compares these numbers with test/accuracy-baseline.json so a
// change that makes detection worse fails `npm test`.
//
//   npm run accuracy              # print the table
//   npm run accuracy -- --update  # also save it as the new baseline (do this after an improvement)
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { renderAbc, PRESETS, PROFILES } from "../src/sim/whistle-synth.js";
import { analyze, DEFAULT_SETTINGS } from "../src/audio/detector.js";
import { matchTruth } from "../src/audio/score.js";
import { referencePitch, shiftOf } from "../src/instruments.js";
import { parseAbc } from "../src/abc/abc.js";
import { buildChart } from "../src/chart/chart.js";
import { grooveFor } from "../src/audio/grooves.js";
import { annotateBeats, drumStrokes, renderDrums } from "../src/audio/band.js";

export const BASELINE = new URL("../test/accuracy-baseline.json", import.meta.url);

// Every example tune with every player, plus the cuts-and-taps articulation on the tunes with repeats.
export const SCENARIOS = [
  ...Object.keys(PRESETS).flatMap(tune => Object.keys(PROFILES).map(profile => ({ tune, profile, articulation: "abc" }))),
  ...["repeats", "reel"].flatMap(tune => ["clean", "typical"].map(profile => ({ tune, profile, articulation: "cuts" }))),
  // other instruments: the same playing, sounding lower (see src/instruments.js)
  ...["Bb", "lowD"].flatMap(inst => ["ornaments", "reel"].flatMap(tune => ["typical", "beginner"].map(profile => ({ tune, profile, articulation: "abc", inst })))),
  // the backing bodhrán leaking into the mic, as loud as the whistle
  ...["reel", "repeats"].flatMap(tune => ["typical", "beginner"].map(profile => ({ tune, profile, articulation: "cuts", drum: 1 }))),
];
export const scenarioId = s => `${s.tune}/${s.profile}/${s.articulation}` + (s.inst ? `/${s.inst}` : "") + (s.drum ? `/bodhran` : "");

export function measure(s) {
  const r = renderAbc(PRESETS[s.tune].abc, { profile: s.profile, articulation: s.articulation, seed: 1, shift: shiftOf(s.inst) });
  let x = r.samples;
  if (s.drum) {
    // the band plays the tune's groove on its beat grid, starting where the synth starts (0.4 s in);
    // its peak is set relative to the whistle's
    const p = parseAbc(PRESETS[s.tune].abc), chart = buildChart(p, { bpm: r.truth.qpm });
    let seed = 5; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const drums = renderDrums(drumStrokes(annotateBeats(chart.beats), grooveFor(p), rnd), r.sr, x.length, 0.4);
    let wp = 0, dp = 0; for (const v of x) wp = Math.max(wp, Math.abs(v)); for (const v of drums) dp = Math.max(dp, Math.abs(v));
    x = Float32Array.from(x, (v, i) => v + drums[i] * s.drum * wp / (dp || 1));
  }
  const S = analyze(x, r.sr, { ...DEFAULT_SETTINGS, a4: referencePitch(s.inst || "D") });
  const m = matchTruth(r.truth, S.segs);
  return {
    notes: +(m.hitNotes / Math.max(1, m.notes)).toFixed(3),
    ornaments: m.orn ? +((m.hit - m.hitNotes) / m.orn).toFixed(3) : null,
    extra: m.extra,
    counts: `${m.hitNotes}/${m.notes} notes, ${m.hit - m.hitNotes}/${m.orn} ornaments`,
  };
}

export function measureAll() {
  const out = {};
  for (const s of SCENARIOS) out[scenarioId(s)] = measure(s);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t0 = Date.now(), res = measureAll();
  const pct = v => v == null ? "   –" : (v * 100).toFixed(0).padStart(3) + "%";
  console.log("scenario".padEnd(32), "notes", " orn", "extra");
  for (const [id, r] of Object.entries(res)) console.log(id.padEnd(32), pct(r.notes), pct(r.ornaments), String(r.extra).padStart(5));
  console.log(`\n${Object.keys(res).length} scenarios in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (process.argv.includes("--update")) {
    const clean = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { notes: v.notes, ornaments: v.ornaments, extra: v.extra }]));
    fs.writeFileSync(BASELINE, JSON.stringify(clean, null, 2) + "\n");
    console.log("Saved baseline to test/accuracy-baseline.json");
  }
}
