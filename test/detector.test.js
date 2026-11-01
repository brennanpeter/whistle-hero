import { test } from "node:test";
import assert from "node:assert/strict";
import { detect, analyze, annotate, DEFAULT_SETTINGS, WIN } from "../src/audio/detector.js";
import { matchTruth } from "../src/audio/score.js";
import { noteInfo, LOW_D, FINGERINGS } from "../src/whistle.js";

const SR = 44100;
const sine = (hz, secs, amp = 0.3) => Float32Array.from({ length: Math.round(secs * SR) }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / SR));
const hz = (midi, cents = 0) => 440 * Math.pow(2, (midi - 69 + cents / 100) / 12);

test("every note on the whistle is detected at the right pitch", () => {
  for (let m = LOW_D; m <= LOW_D + 23; m++) {
    if (!noteInfo(m).inScale) continue;
    const r = detect(sine(hz(m), WIN / SR), SR);
    const midi = 69 + 12 * Math.log2(r.freq / 440);
    assert.ok(Math.abs(midi - m) < 0.05, `${noteInfo(m).name}: heard ${midi.toFixed(2)}`);
    assert.ok(r.clarity > 0.95);
  }
});

test("tuning in cents is measured", () => {
  const S = analyze(sine(hz(81, 20), 0.5), SR);
  assert.equal(S.segs.length, 1);
  assert.equal(S.segs[0].midi, 81);
  assert.ok(Math.abs(S.segs[0].cents - 20) < 2, `cents ${S.segs[0].cents}`);
  const S2 = analyze(sine(hz(81, 20), 0.5), SR, { ...DEFAULT_SETTINGS, a4: 442 });
  assert.ok(Math.abs(S2.segs[0].cents - (20 - 1200 * Math.log2(442 / 440))) < 2, "reference pitch shifts the reading");
});

test("silence and quiet noise produce no notes", () => {
  assert.equal(analyze(new Float32Array(SR), SR).segs.length, 0);
  const noise = Float32Array.from({ length: SR }, () => (Math.random() * 2 - 1) * 0.001);
  assert.equal(analyze(noise, SR).segs.length, 0);
});

test("a gap between two notes of the same pitch splits them", () => {
  const a = sine(hz(79), 0.3), gap = new Float32Array(Math.round(0.05 * SR));
  const S = analyze(Float32Array.from([...a, ...gap, ...a]), SR);
  assert.equal(S.segs.length, 2);
  assert.ok(S.segs.every(s => s.midi === 79));
});

test("annotate: cut, tap, roll, and transients that are not ornaments", () => {
  const seg = (midi, start, dur) => ({ midi, start, end: start + dur, dur, cents: 0 });
  const roll = [seg(79, 0, 0.2), seg(83, 0.2, 0.03), seg(79, 0.23, 0.17), seg(78, 0.4, 0.03), seg(79, 0.43, 0.2)];
  annotate(roll);
  assert.deepEqual(roll.map(s => s.roll), [1, 2, 2, 2, 3]);
  assert.equal(roll[1].orn, "cut"); assert.equal(roll[3].orn, "tap");

  const blip = [seg(79 + 12, 0, 0.02), seg(79, 0.02, 0.3)];
  annotate(blip);
  assert.equal(blip[0].art, "overtone", "an octave blip on the attack");

  const sliver = [seg(81, 0, 0.3), seg(81, 0.31, 0.02), seg(83, 0.34, 0.3)];
  annotate(sliver);
  assert.equal(sliver[1].art, "sliver");
});

test("matchTruth pairs notes by pitch and onset", () => {
  const truth = { notes: [{ kind: "note", midi: 79, start: 0 }, { kind: "cut", midi: 83, start: 0.2 }, { kind: "note", midi: 81, start: 0.5 }] };
  const segs = [{ midi: 79, start: 0.03 }, { midi: 81, start: 0.62 }, { midi: 74, start: 1 }];
  const r = matchTruth(truth, segs);
  assert.deepEqual({ hit: r.hit, hitNotes: r.hitNotes, extra: r.extra }, { hit: 1, hitNotes: 1, extra: 2 });
  assert.deepEqual(truth.notes.map(n => n.hit), [true, false, false]);
});

test("fingering table covers the D scale and C natural", () => {
  assert.deepEqual(Object.keys(FINGERINGS).map(Number), [0, 2, 4, 5, 7, 9, 10, 11]);
});
