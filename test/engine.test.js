import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAbc } from "../src/abc/abc.js";
import { buildChart, shiftChart } from "../src/chart/chart.js";
import { createGame, grade, eventsFromSession, replay, WINDOWS } from "../src/game/engine.js";
import { renderAbc, PRESETS } from "../src/sim/whistle-synth.js";
import { analyze } from "../src/audio/detector.js";

const chartOf = (body, bpm = 120) => buildChart(parseAbc(`X:1\nM:4/4\nL:1/8\nK:D\n${body}`), { bpm });

test("grades by timing", () => {
  assert.equal(grade(0.02), "perfect");
  assert.equal(grade(-0.07), "good");
  assert.equal(grade(0.13), "ok");
  assert.equal(grade(0.2), null);
});

test("hits, misses and combo", () => {
  const g = createGame(chartOf("ABcd|")); // eighths at 0, .25, .5, .75 s
  const seen = []; g.on(e => seen.push(e.type));
  g.onset(81, 0.01);            // A perfect
  g.onset(83, 0.31);            // B good (60 ms late)
  g.tick(0.5 + WINDOWS.ok + 0.01); // c never played: miss
  g.onset(86, 0.75);            // d perfect
  g.tick(10);
  const s = g.summary();
  assert.deepEqual([s.perfect, s.good, s.miss], [2, 1, 1]);
  assert.deepEqual(seen, ["hit", "hit", "miss", "hit"]);
  assert.equal(s.maxCombo, 2);
  assert.equal(g.state.combo, 1, "the miss broke the combo");
});

test("a wrong note is reported but doesn't break the combo, and can be corrected", () => {
  const g = createGame(chartOf("AB|"));
  const seen = []; g.on(e => seen.push(e.type + (e.octave ? "-octave" : "")));
  g.onset(81, 0);
  g.onset(84, 0.24);  // C♮ instead of B
  g.onset(95, 0.26);  // B an octave up
  g.onset(83, 0.28);  // then B
  assert.deepEqual(seen, ["hit", "wrong", "wrong-octave", "hit"]);
  assert.equal(g.state.combo, 2);
});

test("repeated notes are matched one by one", () => {
  const g = createGame(chartOf("AAA|"));
  for (const t of [0.01, 0.26, 0.49]) g.onset(81, t);
  g.tick(10);
  assert.equal(g.summary().hit, 3);
});

test("cuts and taps earn ornament points", () => {
  const g = createGame(buildChart(parseAbc("X:1\nM:6/8\nL:1/8\nK:D\n~G3 B3|"), { bpm: 120 }));
  const [cut, tap] = g.ornaments;
  g.onset(79, 0);
  assert.ok(g.grace(cut.midi, cut.t + 0.02));
  assert.equal(g.grace(tap.midi + 5, tap.t), null, "wrong pitch");
  g.tick(10);
  const s = g.summary();
  assert.equal(s.ornamentsHit, 1);
  assert.equal(s.ornaments, 2);
});

test("multiplier grows with the combo", () => {
  const g = createGame(chartOf("A".repeat(25) + "|", 240));
  g.chart.notes.forEach(n => g.onset(81, n.t));
  assert.equal(g.state.multiplier, 3);
  assert.equal(g.summary().stars, 5);
});

test("a clean simulated performance scores highly through the real detector", () => {
  for (const tune of ["reel", "ornaments", "repeats"]) {
    const abc = PRESETS[tune].abc, parsed = parseAbc(abc);
    const chart = buildChart(parsed);
    const r = renderAbc(abc, { profile: "clean", bpm: chart.qpm });
    const S = analyze(r.samples, r.sr);
    const s = replay(createGame(chart), eventsFromSession(S, r.truth.notes[0].start - chart.notes[0].t));
    assert.ok(s.hit / s.notes >= 0.95, `${tune}: hit ${s.hit}/${s.notes}`);
    assert.ok(s.accuracy >= 0.85, `${tune}: accuracy ${s.accuracy.toFixed(2)}`);
    assert.ok(Math.abs(s.meanOffset) < 0.03, `${tune}: mean offset ${(s.meanOffset * 1000).toFixed(0)} ms`);
  }
});

test("a sloppier player scores lower but still plays the tune", () => {
  const abc = PRESETS.reel.abc, chart = buildChart(parseAbc(abc));
  const score = profile => {
    const r = renderAbc(abc, { profile, bpm: chart.qpm });
    return replay(createGame(chart), eventsFromSession(analyze(r.samples, r.sr), r.truth.notes[0].start - chart.notes[0].t));
  };
  const clean = score("clean"), beginner = score("beginner");
  assert.ok(beginner.accuracy < clean.accuracy);
  assert.ok(beginner.hit / beginner.notes > 0.8, `beginner hit ${beginner.hit}/${beginner.notes}`);
});

test("a looped tune can be extended pass by pass, each at its own tempo", () => {
  const parsed = parseAbc("X:1\nM:4/4\nL:1/8\nK:D\nAB|");
  const p1 = buildChart(parsed, { bpm: 120 });                 // 0.25 s per eighth, 0.5 s long
  const g = createGame(shiftChart(p1, 0));
  const p2 = shiftChart(buildChart(parsed, { bpm: 240 }), p1.duration, { firstNote: 2, firstOrnament: 0, loop: 2 });
  g.extend(p2);
  assert.deepEqual(g.notes.map(n => [n.id, +n.t.toFixed(3), n.loop]), [[0, 0, 1], [1, 0.25, 1], [2, 0.5, 2], [3, 0.625, 2]]);
  for (const n of g.notes) g.onset(n.midi, n.t);
  g.tick(10);
  assert.equal(g.summary().hit, 4);
  assert.equal(g.finished(0.7), false);
  assert.equal(g.finished(0.9), true);
});
