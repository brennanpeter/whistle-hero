import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAbc, encodeWav, resolveOptions, PRESETS, PROFILES } from "../src/sim/whistle-synth.js";

const ABC = h => `X:1\nT:t\nM:4/4\nL:1/8\nK:D\n${h}`;
// Pattern of note kinds and ornament roles, e.g. "F♯ cut A tap A".
const shape = r => r.truth.notes.map(n => n.kind === "note" ? n.name : n.kind).join(" ");

test("same seed renders identical audio, a new seed a different take", () => {
  const a = renderAbc(PRESETS.scale.abc, { profile: "typical", seed: 3 });
  const b = renderAbc(PRESETS.scale.abc, { profile: "typical", seed: 3 });
  const c = renderAbc(PRESETS.scale.abc, { profile: "typical", seed: 4 });
  assert.deepEqual(a.samples, b.samples);
  assert.notDeepEqual(a.samples, c.samples);
});

test("ground truth is ordered and inside the clip", () => {
  for (const k of Object.keys(PRESETS)) {
    const r = renderAbc(PRESETS[k].abc, { profile: "beginner" });
    let last = 0;
    for (const n of r.truth.notes) {
      assert.ok(n.start >= last - 1e-9 && n.end > n.start && n.end <= r.truth.duration, `${k}: bad note timing`);
      last = n.start;
    }
    assert.equal(r.samples.length, Math.ceil(r.truth.duration * r.sr));
    assert.ok(r.peak > 0.1 && r.peak <= 1, `${k}: level ${r.peak}`);
  }
});

test("clean profile injects no transients", () => {
  for (const k of Object.keys(PRESETS)) assert.equal(renderAbc(PRESETS[k].abc, { profile: "clean" }).truth.artifacts.length, 0);
});

test("profiles resolve over the defaults", () => {
  for (const k of Object.keys(PROFILES)) assert.equal(typeof resolveOptions({ profile: k }).breathiness, "number");
  assert.equal(resolveOptions({ profile: "beginner", graceMs: 10 }).graceMs, 10);
});

test("articulation: tongue unless slurred", () => {
  const t = renderAbc(ABC("AB (cd) e"), { profile: "clean" }).truth.notes.map(n => n.tongued);
  assert.deepEqual(t, [true, true, true, false, true]);
});

test("articulation: legato tongues only after rests and on repeats", () => {
  const t = renderAbc(ABC("AB B z c"), { profile: "clean", articulation: "legato" }).truth.notes.map(n => n.tongued);
  assert.deepEqual(t, [true, false, true, true]);
});

test("articulation: cuts and taps on repeats", () => {
  const r = o => renderAbc(ABC(o), { profile: "clean", articulation: "cuts" });
  assert.equal(shape(r("FAAd")), "F♯ cut A tap A D′", "a pair: cut the first, tap the second");
  assert.equal(shape(r("FAAAd")), "F♯ A cut A tap A D′", "three in a row: a long roll");
  assert.equal(shape(r("FAAAAd")), "F♯ A cut A tap A cut A D′", "longer runs alternate");
  assert.equal(shape(r("EDDF")), "E cut D cut D F♯", "low D cannot be tapped");
  assert.equal(shape(r("F~A2A")), "F♯ A cut A tap A tap A", "a written roll is kept");
  assert.equal(shape(r("FA z Ad")), "F♯ A A D′", "a rest breaks the run");
  const t = r("AB B z c").truth.notes.filter(n => n.tongued).map(n => n.name);
  assert.deepEqual(t, ["A", "C♯"], "only notes after rests are tongued");
});

test("rolls cut with the right finger", () => {
  const cut = name => renderAbc(ABC(`~${name}3`), { profile: "clean" }).truth.notes.find(n => n.kind === "cut").name;
  assert.equal(cut("G"), "B");
  assert.equal(cut("B"), "C♯", "B can only lift to C♯");
});

test("WAV encoding", () => {
  const wav = encodeWav(new Float32Array([0, 0.5, -1, 1]), 44100);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint32(40, true), 8);
  assert.deepEqual([1, 2, 3].map(i => v.getInt16(44 + i * 2, true)), [16383, -32768, 32767]);
});
