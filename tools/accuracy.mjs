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

export const BASELINE = new URL("../test/accuracy-baseline.json", import.meta.url);

// Every example tune with every player, plus the cuts-and-taps articulation on the tunes with repeats.
export const SCENARIOS = [
  ...Object.keys(PRESETS).flatMap(tune => Object.keys(PROFILES).map(profile => ({ tune, profile, articulation: "abc" }))),
  ...["repeats", "reel"].flatMap(tune => ["clean", "typical"].map(profile => ({ tune, profile, articulation: "cuts" }))),
];
export const scenarioId = s => `${s.tune}/${s.profile}/${s.articulation}`;

export function measure(s) {
  const r = renderAbc(PRESETS[s.tune].abc, { profile: s.profile, articulation: s.articulation, seed: 1 });
  const S = analyze(r.samples, r.sr, { ...DEFAULT_SETTINGS });
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
