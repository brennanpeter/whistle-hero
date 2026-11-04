import { test } from "node:test";
import assert from "node:assert/strict";
import { noiseGate, whistleTuning, latencyFrom, calibratedSettings, GATE_MIN, GATE_MAX } from "../src/calibration.js";
import { analyze, makeSession, feed, WIN, HOP, DEFAULT_SETTINGS } from "../src/audio/detector.js";

const SR = 44100;
const hz = (midi, cents = 0) => 440 * Math.pow(2, (midi - 69 + cents / 100) / 12);
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const noise = (secs, amp) => Float32Array.from({ length: Math.round(secs * SR) }, () => amp * rnd());
const tone = (f, secs, amp = 0.3) => Float32Array.from({ length: Math.round(secs * SR) }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / SR));
// every frame the detector produces, as the calibration page sees them
function frames(samples, settings = { ...DEFAULT_SETTINGS, gate: -120 }) {
  const S = makeSession(settings), win = new Float32Array(WIN), out = [];
  for (let p = 0; p + HOP <= samples.length; p += HOP) { win.copyWithin(0, HOP); win.set(samples.subarray(p, p + HOP), WIN - HOP); out.push(feed(S, (p + HOP) / SR - WIN / (2 * SR), win, SR)); }
  return out;
}

test("noise gate sits a margin above the room and ignores a brief noise", () => {
  const quiet = noise(3, 0.002); // about −57 dBFS RMS
  quiet.set(noise(0.1, 0.2), SR); // a cough
  const r = noiseGate(frames(quiet).map(f => f.db));
  assert.ok(r.noiseDb > -62 && r.noiseDb < -52, `noise ${r.noiseDb}`);
  assert.equal(r.gateDb, Math.round(r.noiseDb + 8));
  assert.equal(noiseGate(frames(noise(2, 0.00001)).map(f => f.db)).gateDb, GATE_MIN, "a silent room gets the lowest gate");
  assert.equal(noiseGate(frames(noise(2, 0.2)).map(f => f.db)).gateDb, GATE_MAX, "a loud room is capped");
  assert.equal(noiseGate([-50, -51]), null, "too short to tell");
});

test("tuning: a whistle 23 cents sharp", () => {
  const f = frames(tone(hz(74, 23), 2)).filter(x => x.voiced);
  const r = whistleTuning(f);
  assert.equal(r.midi, 74);
  assert.ok(Math.abs(r.cents - 23) < 1.5, `cents ${r.cents}`);
  assert.ok(Math.abs(r.a4 - 440 * Math.pow(2, 23 / 1200)) < 0.4);
});

test("tuning works on any held note, and flat too", () => {
  const r = whistleTuning(frames(tone(hz(81, -17), 2)).filter(x => x.voiced));
  assert.equal(r.midi, 81);
  assert.ok(Math.abs(r.cents + 17) < 1.5, `cents ${r.cents}`);
});

test("tuning refuses a short or wandering note", () => {
  assert.equal(whistleTuning(frames(tone(hz(74), 0.15)).filter(x => x.voiced)), null);
  const wander = new Float32Array([...tone(hz(74), 0.5), ...tone(hz(76), 0.5), ...tone(hz(78), 0.5)]);
  assert.equal(whistleTuning(frames(wander).filter(x => x.voiced)), null);
});

test("latency from beeps heard back through the mic", () => {
  const sched = [1, 1.6, 2.2, 2.8, 3.4, 4.0, 4.6, 5.2];
  const heard = sched.map((s, i) => s + 0.087 + (i % 3) * 0.002).concat([2.0]); // plus one stray
  const r = latencyFrom(sched, heard);
  assert.equal(r.matched, 8);
  assert.ok(Math.abs(r.ms - 89) <= 2, `ms ${r.ms}`);
  assert.equal(latencyFrom(sched, [1.1, 1.7]), null, "too few answers");
});

test("latency from playing along, early and late", () => {
  const sched = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5];
  const heard = sched.map((s, i) => s + 0.06 + (i % 2 ? -0.03 : 0.03));
  const r = latencyFrom(sched, heard, { mode: "play" });
  assert.equal(r.matched, 8);
  assert.ok(Math.abs(r.ms - 60) <= 31, `ms ${r.ms}`);
});

test("end to end: beeps through a delay are measured with the detector's own onset timing", () => {
  // what the speaker method hears: 880 Hz beeps, 120 ms late, in light room noise
  const sched = [0.5, 1.1, 1.7, 2.3, 2.9, 3.5], delay = 0.12, buf = noise(4.5, 0.001);
  for (const s of sched) buf.set(tone(880, 0.15), Math.round((s + delay) * SR));
  const S = analyze(buf, SR);
  const r = latencyFrom(sched, S.segs.filter(s => s.midi === 81).map(s => s.start));
  assert.equal(r.matched, 6);
  // the detector's onset times can be a few ms either side of the true start; the game's notes go
  // through the same detector, so that bias is part of what should be measured
  assert.ok(Math.abs(r.ms - 120) <= 10, `ms ${r.ms}`);
});

test("calibrated settings override the defaults", () => {
  const s = calibratedSettings({ a4: 440, gate: -50, clarity: 0.88 }, { a4: 442.5, gateDb: -58 });
  assert.deepEqual(s, { a4: 442.5, gate: -58, clarity: 0.88 });
  assert.deepEqual(calibratedSettings({ a4: 440, gate: -50 }, null), { a4: 440, gate: -50 });
});

test("micCheck: tells a healthy take from a silent, hissy, clipped or too-quiet one", async () => {
  const { micCheck } = await import("../src/calibration.js");
  const sr = 48000, n = sr * 5;
  let seed = 3; const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  // background noise at `floor`, plus two seconds of a whistle-ish 587 Hz tone at amplitude `amp`
  const take = (floor, amp, hard = 1) => Float32Array.from({ length: n }, (_, i) => {
    const tone = i > sr && i < 3 * sr ? amp * Math.sin(2 * Math.PI * 587 * i / sr) : 0;
    return Math.max(-hard, Math.min(hard, floor * noise() + tone));
  });
  const ok = micCheck(take(0.002, 0.2), sr);
  assert.deepEqual(ok.problems, [], JSON.stringify(ok));
  assert.ok(ok.quietDb < -50 && ok.loudDb > -20);
  assert.deepEqual(micCheck(new Float32Array(n), sr).problems, ["silent"]);
  assert.deepEqual(micCheck(take(0.05, 0.2), sr).problems, ["noisy"], "a boosted laptop mic: loud hiss even when quiet");
  assert.deepEqual(micCheck(take(0.002, 1.6, 0.999), sr).problems, ["clip"]);
  assert.deepEqual(micCheck(take(0.0005, 0.005), sr).problems, ["quiet"]);
});

test("instruments: per-instrument tuning, and the reference pitch moved to the instrument's key", async () => {
  const { tuningFor } = await import("../src/calibration.js");
  const { referencePitch, soundingName, shiftOf } = await import("../src/instruments.js");
  const old = { gateDb: -55, a4: 444, cents: 15.6 };                       // a save from before instruments
  assert.deepEqual(tuningFor(old, "D"), { a4: 444, cents: 15.6 });
  assert.equal(tuningFor(old, "Bb"), null);
  const cal = { gateDb: -55, tunings: { D: { a4: 442, cents: 7.8 }, Bb: { a4: 437, cents: -11.8 } } };
  assert.equal(calibratedSettings(DEFAULT_SETTINGS, cal, "D").a4, 442);
  assert.ok(Math.abs(calibratedSettings(DEFAULT_SETTINGS, cal, "Bb").a4 - 437 * Math.pow(2, -4 / 12)) < 1e-9);
  assert.equal(calibratedSettings(DEFAULT_SETTINGS, cal, "C").a4, referencePitch("C", 440), "untuned: standard pitch, in its key");
  assert.equal(calibratedSettings(DEFAULT_SETTINGS, cal, "lowD").a4, 220, "a flute: an octave down");
  assert.equal(calibratedSettings(DEFAULT_SETTINGS, cal, "Bb").gate, -55, "the room's gate applies to every instrument");
  // what the fingerings sound like
  assert.equal(soundingName(74, "Bb"), "B♭"); assert.equal(soundingName(78, "Bb"), "D");
  assert.equal(soundingName(74, "C"), "C"); assert.equal(soundingName(85, "A"), "G♯");
  assert.equal(soundingName(74, "lowD"), null); assert.equal(soundingName(74, "D"), null);
  assert.equal(shiftOf("nonsense"), 0);
});

test("a B♭ whistle's bottom note, heard with the B♭ reference, reads as the fingering D", () => {
  const { referencePitch } = { referencePitch: (k, a4 = 440) => a4 * Math.pow(2, ({ Bb: -4, lowD: -12 })[k] / 12) };
  for (const [inst, hzBottom] of [["Bb", 466.16], ["lowD", 293.66]]) {
    const S = makeSession({ ...DEFAULT_SETTINGS, a4: referencePitch(inst) });
    const buf = new Float32Array(WIN), frames = [];
    for (let k = 0; k < 60; k++) {
      for (let i = 0; i < WIN; i++) { const t = (k * HOP + i) / SR; buf[i] = 0.3 * Math.sin(2 * Math.PI * hzBottom * t) + 0.1 * Math.sin(4 * Math.PI * hzBottom * t); }
      frames.push(feed(S, k * HOP / SR, buf, SR));
    }
    const midi = frames.filter(f => f.voiced).map(f => Math.round(f.midiF));
    assert.ok(midi.length > 40 && midi.every(m => m === 74), `${inst}: ${[...new Set(midi)]}`);
  }
});
