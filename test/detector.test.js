import { test } from "node:test";
import assert from "node:assert/strict";
import { detect, analyze, annotate, DEFAULT_SETTINGS, WIN } from "../src/audio/detector.js";
import { matchTruth } from "../src/audio/score.js";
import { renderAbc } from "../src/sim/whistle-synth.js";
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

// ---------- Phase 1 behaviour ----------
const concat = (...parts) => { const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const glide = (m0, m1, secs, amp = 0.3) => { let ph = 0; return Float32Array.from({ length: Math.round(secs * SR) }, (_, i) => { ph += 2 * Math.PI * hz(m0 + (m1 - m0) * i / (secs * SR)) / SR; return amp * Math.sin(ph); }); };
const ABC = b => `X:1\nT:t\nM:4/4\nL:1/8\nK:D\n${b}`;
const heard = S => S.segs.filter(s => !s.art);

test("a 30 ms cut between two notes of the same pitch is heard", () => {
  const S = analyze(concat(sine(hz(79), 0.25), sine(hz(83), 0.03), sine(hz(79), 0.25)), SR);
  const h = heard(S);
  assert.deepEqual(h.map(s => s.midi), [79, 83, 79]);
  assert.equal(h[1].orn, "cut");
});

test("a slide is folded into the note it lands on", () => {
  const S = analyze(concat(new Float32Array(SR / 10), glide(81.4, 83, 0.12), sine(hz(83), 0.4)), SR);
  const h = heard(S);
  assert.equal(h.length, 1, h.map(s => s.midi).join(","));
  assert.equal(h[0].midi, 83);
  assert.equal(h[0].slide, true);
  assert.ok(h[0].start < 0.13, `slide start ${h[0].start}`);
});

test("an ordinary step between notes is not a slide", () => {
  const S = analyze(concat(sine(hz(81), 0.2), sine(hz(83), 0.2), sine(hz(85), 0.2)), SR);
  assert.deepEqual(heard(S).map(s => [s.midi, !!s.slide]), [[81, false], [83, false], [85, false]]);
});

test("simulated slides are found and nothing else is called a slide", () => {
  const r = renderAbc(ABC("(DEFG A2)|!slide!B4 A2|(BAGF) !slide!A2|(d2 B2 A2)|D6|]"), { profile: "typical" });
  const S = analyze(r.samples, r.sr);
  assert.deepEqual(heard(S).filter(s => s.slide).map(s => s.midi), [83, 81]);
});

test("tongued repeats are split even when the echo fills the gap", () => {
  const r = renderAbc(ABC("AAA BBB|AAA d3|]"), { profile: "clean", reverb: 0.2 });
  const S = analyze(r.samples, r.sr);
  assert.equal(heard(S).filter(s => s.midi === 81).length, 6);
});

test("a slow fade in a held note does not split it", () => {
  const n = Math.round(0.6 * SR);
  const fade = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.pow(10, -8 * i / n / 20) * Math.sin(2 * Math.PI * hz(81) * i / SR));
  assert.equal(heard(analyze(fade, SR)).length, 1);
});

test("annotate: glides and flat attacks are transients, cuts are not", () => {
  const seg = (midi, start, dur) => ({ midi, start, end: start + dur, dur, cents: 0 });
  const step = [seg(76, 0, 0.2), seg(77, 0.2, 0.02), seg(78, 0.22, 0.2)];   // E, F (passing), F♯
  annotate(step);
  assert.equal(step[1].art, "glide");
  const scoop = [seg(80, 0, 0.02), seg(81, 0.02, 0.3)];                       // G♯ then A, from silence
  annotate(scoop);
  assert.equal(scoop[0].art, "glide");
  const cut = [seg(88, 0, 0.2), seg(91, 0.2, 0.03), seg(90, 0.23, 0.2)];     // E′, cut G′, F♯′
  annotate(cut);
  assert.equal(cut[1].art, null);
  const near = [seg(78, 0, 0.2), seg(91, 0.2, 0.03), seg(81, 0.23, 0.2)];    // 13 semitones is not an overtone
  annotate(near);
  assert.equal(near[1].art, null);
});
