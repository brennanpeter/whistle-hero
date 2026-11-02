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
