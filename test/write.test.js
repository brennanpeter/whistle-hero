import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAbc } from "../src/abc/abc.js";
import { writeAbc, transposeKey } from "../src/abc/write.js";
import { PRESETS } from "../src/sim/whistle-synth.js";

// what matters for the game: the same notes, lengths and ornaments in the same order
const shape = p => p.events.map(e => e.t === "rest" ? `z${+e.len.toFixed(6)}` : `${e.midi}:${+e.len.toFixed(6)}${e.roll ? "~" : ""}${e.slide ? "/" : ""}${e.graces.length ? "{" + e.graces + "}" : ""}`);
const roundTrip = (abc, opts) => { const p = parseAbc(abc, opts), w = writeAbc(p); return { p, w, back: parseAbc(w.abc) }; };

test("every example tune survives a round trip, played out in full", () => {
  for (const [k, preset] of Object.entries(PRESETS)) {
    const { p, w, back } = roundTrip(preset.abc);
    assert.deepEqual(shape(back), shape(p), k);
    assert.equal(w.pieces.length, p.events.filter(e => e.t === "note").length, `${k}: one entry per note`);
    assert.ok(!/[:|]\|:|\|:|:\|/.test(w.abc.split("\n")[4]), `${k}: no repeat signs left`);
  }
});

test("accidentals: off-key notes are marked, and naturals restore within a bar", () => {
  const { back, w } = roundTrip("X:1\nM:4/4\nL:1/8\nK:D\n=c ^c c2 =c4|c2 =F2 ^F4|");
  assert.deepEqual(back.events.map(e => e.midi), [84, 85, 85, 84, 85, 77, 78]);
  assert.match(w.abc, /=c2\^c2 c4 =c8 \| c4 =F4 \^F8/);
});

test("lengths that need ties are split, and triplets are written as triplets", () => {
  const { back, w } = roundTrip("X:1\nM:4/4\nL:1/8\nK:D\nA5 B3|(3ABc d6|");
  assert.deepEqual(shape(back), shape(parseAbc("X:1\nM:4/4\nL:1/8\nK:D\nA5 B3|(3ABc d6|")));
  assert.equal(w.pieces[0], 2, "a 5-eighth note is two tied noteheads");
  assert.match(w.abc, /\(3/);
});

test("a note held across a bar line is tied over it", () => {
  const src = "X:1\nM:3/4\nL:1/8\nK:G\nG4 ^c2-|^c2 B4|B6-|B4 A2|";
  const { p, back, w } = roundTrip(src);
  assert.deepEqual(p.bars.map(b => b.pos), [0, 0.75, 1.5, 2.25], "the bar line sits inside the tied note");
  assert.deepEqual(shape(back), shape(p));
  assert.deepEqual(back.bars.map(b => b.pos), p.bars.map(b => b.pos));
  assert.deepEqual(w.pieces, [1, 2, 1, 2, 1]);
  assert.match(w.abc, /\^c4-\s?\|\s?\^c4/, "the accidental is repeated after the bar line");
});

test("transposed tunes get the new key signature", () => {
  assert.equal(transposeKey("F", -3), "D");
  assert.equal(transposeKey("Ador", 2), "Bdor");
  assert.equal(transposeKey("Bb", 4), "D");
  assert.equal(transposeKey("Em", 0), "Em");
  const { w, back } = roundTrip("X:1\nM:4/4\nL:1/8\nK:F\nFGAB cdef|", { transpose: -3 });
  assert.match(w.abc, /K:D/);
  assert.deepEqual(back.events.map(e => e.midi), [74, 76, 78, 79, 81, 83, 85, 86]);
  assert.ok(!/[_^=]/.test(w.abc.split("\n")[4].replace(/"[^"]*"/g, "")), "no accidentals needed in D");
});

test("part labels mark where each part and repeat begins", () => {
  const { w } = roundTrip("X:1\nM:4/4\nL:1/8\nK:D\n|:AB:||:cd:|");
  const labels = [...w.abc.matchAll(/"\^([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(labels, ["A", "A again", "B", "B again"]);
});

test("staffPlace: where a heard note sits on the staff", async () => {
  const { staffPlace } = await import("../src/abc/write.js");
  assert.deepEqual(staffPlace(74, "D"), { step: 1, letter: "D", acc: null });     // low D: just under the staff
  assert.deepEqual(staffPlace(78, "D"), { step: 3, letter: "F", acc: null });     // F♯ is in the key
  assert.deepEqual(staffPlace(77, "D"), { step: 3, letter: "F", acc: 0 });        // F♮ needs a natural
  assert.deepEqual(staffPlace(84, "G"), { step: 7, letter: "C", acc: null });     // C♮ in G
  assert.deepEqual(staffPlace(85, "G"), { step: 7, letter: "C", acc: 1 });
  assert.deepEqual(staffPlace(98, "D"), { step: 15, letter: "D", acc: null });    // high D, above the staff
  assert.deepEqual(staffPlace(82, "F"), { step: 6, letter: "B", acc: null });     // B♭ in F
});
