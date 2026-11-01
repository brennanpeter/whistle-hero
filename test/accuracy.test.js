// Regression guard for the detector: every Whistle Sim scenario must score at least as well as the
// saved baseline, within a small tolerance. After an improvement, run `npm run accuracy -- --update`
// and commit the new baseline so the bar moves up.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SCENARIOS, scenarioId, measure, BASELINE } from "../tools/accuracy.mjs";

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const NOTE_SLACK = 0.02, ORN_SLACK = 0.05;
const extraSlack = n => Math.max(2, Math.ceil(n * 0.15));

for (const s of SCENARIOS) {
  const id = scenarioId(s);
  test(`accuracy: ${id}`, () => {
    const base = baseline[id];
    assert.ok(base, `No baseline for ${id}. Run: npm run accuracy -- --update`);
    const r = measure(s);
    assert.ok(r.notes >= base.notes - NOTE_SLACK, `${id}: notes matched fell from ${pct(base.notes)} to ${pct(r.notes)} (${r.counts})`);
    if (base.ornaments != null) assert.ok(r.ornaments >= base.ornaments - ORN_SLACK, `${id}: ornaments matched fell from ${pct(base.ornaments)} to ${pct(r.ornaments)} (${r.counts})`);
    assert.ok(r.extra <= base.extra + extraSlack(base.extra), `${id}: extra detections rose from ${base.extra} to ${r.extra}`);
  });
}
const pct = v => (v * 100).toFixed(0) + "%";
