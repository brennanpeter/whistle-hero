import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAbc, keySignature } from "../src/abc/abc.js";

const tune = (body, head = "M:4/4\nL:1/8\nK:D") => parseAbc(`X:1\nT:t\n${head}\n${body}`);
const notes = p => p.events.filter(e => e.t === "note");
const pitches = p => notes(p).map(e => e.midi);
const lens = p => p.events.map(e => e.len);

test("key signatures", () => {
  assert.deepEqual(keySignature("D").acc, { F: 1, C: 1 });
  assert.deepEqual(keySignature("G").acc, { F: 1 });
  assert.deepEqual(keySignature("Edor").acc, { F: 1, C: 1 });
  assert.deepEqual(keySignature("Amix").acc, { F: 1, C: 1 });
  assert.deepEqual(keySignature("Bm").acc, { F: 1, C: 1 });
  assert.deepEqual(keySignature("Ador").acc, { F: 1 });
  assert.deepEqual(keySignature("Bb").acc, { B: -1, E: -1 });
  assert.ok(keySignature("Q").warn);
});

test("pitches are sounding pitches for a D whistle", () => {
  assert.deepEqual(pitches(tune("DEFG ABcd efga b")), [74, 76, 78, 79, 81, 83, 85, 86, 88, 90, 91, 93, 95]);
  assert.deepEqual(pitches(tune("c", "K:G")), [84], "C natural in G");
  assert.deepEqual(pitches(tune("d'")), [98]);
});

test("accidentals last until the bar line", () => {
  assert.deepEqual(pitches(tune("=c c|c")), [84, 84, 85]);
  assert.deepEqual(pitches(tune("^G G|G")), [80, 80, 79]);
});

test("note lengths, broken rhythm, triplets and ties", () => {
  assert.deepEqual(lens(tune("A2 A/ A3/2 A//")), [1 / 4, 1 / 16, 3 / 16, 1 / 32]);
  assert.deepEqual(lens(tune("A>B A<B")), [3 / 16, 1 / 16, 1 / 16, 3 / 16]);
  const t = lens(tune("(3ABc d"));
  t.slice(0, 3).forEach(l => assert.ok(Math.abs(l - 1 / 12) < 1e-12));
  assert.equal(t[3], 1 / 8);
  const tie = tune("A2-A2 B");
  assert.deepEqual(lens(tie), [1 / 2, 1 / 8]);
});

test("default unit length follows the meter", () => {
  assert.deepEqual(lens(parseAbc("M:2/4\nK:D\nA")), [1 / 16]);
  assert.deepEqual(lens(parseAbc("M:6/8\nK:D\nA")), [1 / 8]);
});

test("repeats and 1st/2nd endings are expanded", () => {
  const n = p => notes(p).map(e => e.midi);
  assert.deepEqual(n(tune("|:AB:|")), [81, 83, 81, 83]);
  assert.deepEqual(n(tune("|:A|1B:|2c|]")), [81, 83, 81, 85]);
  assert.deepEqual(n(tune("|:A|[1B:|[2c|]")), [81, 83, 81, 85]);
  assert.deepEqual(n(tune("A:|B")), [81, 81, 83], "repeat from the start when there is no |:");
  assert.deepEqual(n(tune("|:A::B:|")), [81, 81, 83, 83]);
  assert.deepEqual(n(tune("|:A:||:B:|")), [81, 81, 83, 83]);
});

test("ornaments, slides, slurs and graces", () => {
  const p = notes(tune("~A !slide!B {g}A (Bc) d"));
  assert.equal(p[0].roll, true);
  assert.equal(p[1].slide, true);
  assert.deepEqual(p[2].graces, [91]);
  assert.equal(p[3].slurred, false, "first note of a slur is articulated");
  assert.equal(p[4].slurred, true);
  assert.equal(p[5].slurred, false);
});

test("chords keep their first note, and text is ignored", () => {
  const p = tune('"D"[DF]2 "G"G % comment\nA');
  assert.deepEqual(pitches(p), [74, 79, 81]);
  assert.equal(p.events[0].len, 1 / 4);
});

test("notes below low D are raised an octave with a warning", () => {
  const p = tune("A,B,D");
  assert.deepEqual(pitches(p), [81, 83, 74]);
  assert.ok(p.warnings.some(w => /raised an octave/.test(w)));
});

test("tempo from Q:", () => {
  assert.equal(tune("A", "Q:1/4=120\nL:1/8\nK:D").qpm, 120);
  assert.equal(tune("A", "Q:3/8=120\nL:1/8\nK:D").qpm, 180);
  assert.equal(tune("A").qpm, null);
});

test("rests and an empty tune", () => {
  const p = tune("A z2 B");
  assert.deepEqual(p.events.map(e => e.t), ["note", "rest", "note"]);
  assert.ok(parseAbc("X:1\nK:D\n").warnings.includes("No notes found"));
});
