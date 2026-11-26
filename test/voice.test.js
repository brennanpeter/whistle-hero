// The streaming voice (src/sim/voice.js) plays a performance exactly as the old whole-buffer renderer
// did (kept frozen in test/fixtures/render-reference.js), apart from the background noise, which now
// has its own random stream. And it can be driven faster or slower, as the real-time simulator is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAbc, perform, renderPerformance } from "../src/sim/whistle-synth.js";
import { createControl, createVoice } from "../src/sim/voice.js";
import { renderPerformanceReference } from "./fixtures/render-reference.js";
import { STARTER_ABC } from "../src/tunes/starter.js";
import { parseAbcFile } from "../src/abc/abc.js";

const tunes = parseAbcFile(STARTER_ABC).slice(0, 4);
const quiet = { roomNoiseDb: -400, humDb: -400 }; // the one thing that differs: no background noise

test("the voice renders what the old renderer did, for every profile", () => {
  for (const profile of ["clean", "typical", "beginner", "noisy"]) for (const t of tunes.slice(0, 2)) {
    const perf = perform(parseAbc(t.abc), { profile, bpm: 110, seed: 5, articulation: "cuts", ...quiet });
    const a = renderPerformanceReference(perf).samples, b = renderPerformance(perf).samples;
    assert.equal(a.length, b.length);
    let worst = 0; for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    assert.ok(worst < 1e-6, `${profile}, ${t.title}: differs by ${worst}`);
  }
});

test("with background noise, only the noise differs", () => {
  const perf = perform(parseAbc(tunes[0].abc), { profile: "noisy", bpm: 110, seed: 2 });
  const a = renderPerformanceReference(perf).samples, b = renderPerformance(perf).samples;
  let d = 0, s = 0; for (let i = 0; i < a.length; i++) { d += (a[i] - b[i]) ** 2; s += a[i] ** 2; }
  assert.ok(10 * Math.log10(d / s) < -20, "the difference is far below the signal");
});

test("driven faster, the voice gets through the performance sooner, at the same pitch", () => {
  const sr = 44100, perf = perform(parseAbc("X:1\nM:4/4\nL:1/8\nK:D\nA4 B4 | A4 B4 |"), { profile: "clean", bpm: 100, seed: 1 });
  const play = rate => {
    const ctl = createControl(perf.items, sr), v = createVoice(perf.options, sr, perf.items[0].midi), n = Math.ceil(perf.duration * sr / rate), out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = v.next(ctl.at(i * rate), i * rate);
    return out;
  };
  // the second note (B) starts at its time ÷ rate; find the pitch near its middle by zero crossings
  const pitchAt = (x, t) => { let z = 0; const a = Math.round(t * sr), b = a + 2205; for (let i = a + 1; i < b; i++) if (x[i - 1] <= 0 && x[i] > 0) z++; return z / 0.05; };
  const B = perf.items[1], mid = (B.start + B.end) / 2;
  const f1 = pitchAt(play(1), mid), f2 = pitchAt(play(1.5), mid / 1.5);
  assert.ok(Math.abs(f1 - 988) < 25 && Math.abs(f2 - 988) < 25, `B5 at both speeds: ${f1}, ${f2} Hz`);
});
