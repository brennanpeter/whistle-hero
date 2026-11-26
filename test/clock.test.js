// The game clock: game time against the audio clock, with tempo changes as anchors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gameTime, audioTime, rateAt, bpmWith } from "../src/game/clock.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test("with no changes, game time is audio time from t0", () => {
  const c = { warp: [{ a: 10, g: 0, base: 100 }], passes: [{ start: 0, n: 1, bpm: 100 }], loop: "loop" };
  near(gameTime(13.5, c), 3.5, "after"); near(gameTime(8, c), -2, "the run-up"); near(audioTime(3.5, c), 13.5, "back");
});

test("a tempo change speeds the clock up from its anchor; the next pass, laid out at the new tempo, runs at 1", () => {
  const c = { warp: [{ a: 0, g: 0, base: 100 }, { a: 10, g: 10, base: 120 }], passes: [{ start: 0, n: 1, bpm: 100 }, { start: 30, n: 2, bpm: 120 }], loop: "loop" };
  near(gameTime(5, c), 5, "before the change");
  near(rateAt(12, 120, c), 1.2, "rest of pass 1 at 1.2×");
  near(gameTime(15, c), 16, "5 s after the change: 6 s of game time");
  // pass 1 ends at game 30: 20 game seconds after the change, 20/1.2 real seconds
  near(audioTime(30, c), 10 + 20 / 1.2, "pass boundary");
  near(gameTime(10 + 20 / 1.2 + 3, c), 33, "pass 2 at 1×");
  for (const a of [-1, 3, 10, 14.2, 26.7, 40]) near(audioTime(gameTime(a, c), c), a, `round trip at ${a}`);
});

test("speeding up adds 5 bpm every third pass", () => {
  assert.deepEqual([1, 2, 3, 4, 7].map(n => bpmWith(100, n, "ramp")), [100, 100, 100, 105, 110]);
  assert.equal(bpmWith(100, 7, "loop"), 100);
});
