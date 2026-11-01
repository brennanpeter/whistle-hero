import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAbc } from "../src/abc/abc.js";
import { buildChart, meterInfo } from "../src/chart/chart.js";
import { checkPlayability, suggestTranspose, describeTranspose } from "../src/abc/playability.js";
import { cutFor, tapFor } from "../src/whistle.js";

const close = (a, b) => Math.abs(a - b) < 1e-9;

test("meters", () => {
  assert.deepEqual([4, 1 / 4], [meterInfo("4/4").beatsPerBar, meterInfo("4/4").beatLen]);
  assert.deepEqual([2, 3 / 8], [meterInfo("6/8").beatsPerBar, meterInfo("6/8").beatLen]);
  assert.equal(meterInfo("9/8").beatsPerBar, 3);
  assert.equal(meterInfo("12/8").beatsPerBar, 4);
  assert.equal(meterInfo("3/4").beatsPerBar, 3);
  assert.equal(meterInfo("C|").beatsPerBar, 2);
});

test("tempo: explicit, from Q:, from the tune type, or 120", () => {
  const t = h => buildChart(parseAbc(`X:1\n${h}\nK:D\nA`));
  assert.equal(buildChart(parseAbc("X:1\nK:D\nA"), { bpm: 90 }).qpm, 90);
  assert.equal(t("Q:1/4=100").qpm, 100);
  assert.equal(t("R:Reel").qpm, 180);
  assert.equal(t("").qpm, 120);
});

test("notes are timed from the written rhythm", () => {
  const c = buildChart(parseAbc("X:1\nM:4/4\nL:1/8\nK:D\nA2 B C>D|"), { bpm: 120 }); // quarter = 0.5 s
  assert.deepEqual(c.notes.map(n => +n.t.toFixed(4)), [0, 0.5, 0.75, 1.125]);
  assert.deepEqual(c.notes.map(n => +n.dur.toFixed(4)), [0.5, 0.25, 0.375, 0.125]);
  assert.ok(close(c.duration, 1.25));
});

test("rolls and grace notes become ornament events", () => {
  const c = buildChart(parseAbc("X:1\nM:6/8\nL:1/8\nK:D\n~G3 {a}F3|"), { bpm: 120 });
  const [roll, graced] = c.notes;
  assert.equal(roll.ornament, "roll");
  assert.deepEqual(c.ornaments.map(o => [o.kind, o.midi, o.note]), [["cut", cutFor(79), 0], ["tap", tapFor(79), 0], ["cut", 93, 1]]);
  assert.ok(close(c.ornaments[0].t, roll.dur / 3));
  assert.ok(c.ornaments[2].t < graced.t, "a grace note sits just before its note");
});

test("low D rolls use two cuts", () => {
  const c = buildChart(parseAbc("X:1\nL:1/8\nK:D\n~D3|"));
  assert.deepEqual(c.ornaments.map(o => o.kind), ["cut", "cut"]);
});

test("bar lines, beats and a pickup", () => {
  const c = buildChart(parseAbc("X:1\nM:6/8\nL:1/8\nK:D\nA|d2A B3|f2e d2A|"), { bpm: 120 }); // eighth = 0.25 s
  assert.equal(c.bars[0].pickup, true);
  assert.deepEqual(c.bars.map(b => b.t), [0, 0.25, 1.75]);
  assert.deepEqual(c.beats.filter(b => b.strong).map(b => b.t), [0.25, 1.75]);
  assert.equal(c.beats.length, 4, "the pickup's partial beat isn't counted");
});

test("repeats are played out with part and pass labels", () => {
  const c = buildChart(parseAbc("X:1\nL:1/8\nK:D\n|:AB:||:cd:|"));
  assert.deepEqual(c.notes.map(n => `${n.part}${n.pass}`), ["01", "01", "02", "02", "11", "11", "12", "12"]);
});

test("playability: D tunes fit, half-holes and range are reported", () => {
  assert.equal(checkPlayability(parseAbc("X:1\nK:D\nDEFG ABcd|")).ok, true);
  const f = checkPlayability(parseAbc("X:1\nK:F\nFGAB|"));
  assert.equal(f.ok, false);
  assert.deepEqual(f.issues.map(i => [i.kind, i.name, i.count]), [["half-hole", "F", 1], ["half-hole", "A♯", 1]]);
  const g = checkPlayability(parseAbc("X:1\nK:G\nG,A,B,C|c"));
  assert.deepEqual(g.issues.map(i => i.kind), ["below", "below", "below", "below"]);
  assert.equal(g.cNaturals, 2);
  assert.equal(checkPlayability(parseAbc("X:1\nK:D\nc'd'")).highNotes, 2);
});

test("playability: suggests the easiest transposition", () => {
  const s = suggestTranspose("X:1\nK:F\nFGAB cdef|gfed cBAG|");
  assert.equal(s.transpose, -3);
  assert.equal(s.check.ok, true);
  assert.equal(suggestTranspose("X:1\nK:D\nDEFG ABcd|"), null, "nothing to fix");
  assert.equal(describeTranspose(-3), "down 3 semitones");
  assert.equal(describeTranspose(2), "up a tone");
});
