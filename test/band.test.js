import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAbc } from "../src/abc/abc.js";
import { buildChart } from "../src/chart/chart.js";
import { grooveFor, beatStrokes, GROOVES } from "../src/audio/grooves.js";
import { annotateBeats, drumStrokes, renderDrums } from "../src/audio/band.js";
import { renderStroke, STROKES } from "../src/audio/bodhran.js";

const tune = (r, m, body) => parseAbc(`X:1\n${r ? `R:${r}\n` : ""}M:${m}\nL:1/8\nK:D\n${body}`);
const still = () => 0.5; // no human looseness: exact grid times, plain velocities

test("grooves come from the rhythm field, or the time signature when there isn't one", () => {
  assert.equal(grooveFor(tune("reel", "4/4", "ABcd efga|")).id, "reel");
  assert.equal(grooveFor(tune("Reel", "C|", "ABcd efga|")).id, "reel");
  assert.equal(grooveFor(tune("jig", "6/8", "ABc def|")).id, "jig");
  assert.equal(grooveFor(tune("double jig", "6/8", "ABc def|")).id, "jig");
  assert.equal(grooveFor(tune("", "6/8", "ABc def|")).id, "jig", "6/8 with no rhythm given");
  assert.equal(grooveFor(tune("slip jig", "9/8", "ABc def gab|")).id, "plain");
  assert.equal(grooveFor(tune("waltz", "3/4", "A2 B2 c2|")).id, "plain");
  assert.equal(grooveFor(tune("jig", "4/4", "ABcd efga|")).id, "plain", "a 'jig' in 4/4 isn't one we can play as a jig");
  const slip = grooveFor(tune("slip jig", "9/8", "ABc def gab|"));
  assert.deepEqual(slip.normal, ["Dud", "dud", "dud"]);
});

test("a beat's strokes are spread evenly across it, and the bar's first stroke is accented", () => {
  const s = beatStrokes(GROOVES.jig, { t: 10, dur: 0.6, beatInBar: 0, bar: 0, rnd: still, loose: 0 });
  assert.deepEqual(s.map(x => [+x.t.toFixed(6), x.kind]), [[10, "D"], [10.2, "u"], [10.4, "u"]]);
  assert.ok(s[0].vel > 2.5 * s[1].vel && s[0].vel > 2.5 * s[2].vel, "the jig's down-strokes stand well clear of its up-strokes");
});

test("a jig accents 1 and 4 equally: DOWN up up DOWN up up", () => {
  const bar = [0, 1].flatMap(b => beatStrokes(GROOVES.jig, { t: b * 0.6, dur: 0.6, beatInBar: b, bar: 0, rnd: still, loose: 0 }));
  assert.equal(bar.map(s => s.kind).join(""), "DuuDuu");
  assert.equal(bar[0].vel, bar[3].vel);
});

test("fills come at the end of each eight-bar phrase, variations every fourth bar", () => {
  const kinds = bar => [0, 1, 2, 3].map(b => beatStrokes(GROOVES.reel, { t: 0, dur: 0.5, beatInBar: b, bar, rnd: still }).map(s => s.kind).join("")).join(" ");
  assert.equal(kinds(0), "Du du Du du");
  assert.equal(kinds(3), "Du du Du tu");
  assert.equal(kinds(7), "Du du Dudu Du");
  assert.equal(kinds(11), "Du du Du tu");
  assert.equal(kinds(15), "Du du Dudu Du");
});

test("a whole reel: eight strokes a bar on the chart's grid, none after the last note", () => {
  const p = tune("reel", "4/4", "|:ABcd efga|bagf edcB|ABcd efga|bagf e2d2:|"), chart = buildChart(p, { bpm: 120 });
  const beats = annotateBeats(chart.beats);
  assert.deepEqual(beats.slice(0, 6).map(b => [b.bar, b.inBar]), [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1]]);
  const last = chart.notes[chart.notes.length - 1].t;
  const strokes = drumStrokes(beats, grooveFor(p), still, last);
  const sixteenth = chart.beatSeconds / 4; // eighths, and sixteenths in the phrase-end fill
  for (const s of strokes) assert.ok(Math.abs(s.t / sixteenth - Math.round(s.t / sixteenth)) < 1e-6, `off the grid at ${s.t}`);
  assert.ok(strokes.every(s => s.t <= last + 1e-6));
  assert.equal(strokes.filter(s => s.t < 4 * chart.beatSeconds * 4 - 1e-6).length, 32, "four full bars of eight");
});

test("a tune with a pickup: the drum comes in on the first downbeat", () => {
  const p = tune("jig", "6/8", "A|dfa afd|Bcd ecA|dfa afd|e3 d2|"), chart = buildChart(p, { bpm: 120 });
  const strokes = drumStrokes(annotateBeats(chart.beats), grooveFor(p), still);
  const down = chart.beats.find(b => b.strong).t;
  assert.ok(down > 0);
  assert.ok(Math.abs(strokes[0].t - down) < 1e-9 && strokes[0].kind === "D");
});

test("loop passes keep counting bars, so phrases and fills stay in place", () => {
  const p = tune("reel", "4/4", "ABcd efga|bagf edcB|"), chart = buildChart(p, { bpm: 120 });
  const first = annotateBeats(chart.beats), next = annotateBeats(chart.beats.map(b => ({ ...b, t: b.t + 4 })), { fromBar: first[first.length - 1].bar + 1 });
  assert.equal(next[0].bar, 2);
});

test("bodhrán strokes: clean, decaying, and pitched by kind", () => {
  const sr = 48000;
  for (const kind of Object.keys(STROKES)) {
    const x = renderStroke(sr, kind, 3);
    let peak = 0, early = 0, late = 0;
    x.forEach((v, i) => { peak = Math.max(peak, Math.abs(v)); if (i < sr * 0.03) early += v * v; else if (i > x.length - sr * 0.03) late += v * v; });
    assert.ok(Number.isFinite(peak) && peak > 0.3 && peak <= 0.81, `${kind}: peak ${peak}`);
    assert.ok(late < early * 0.01, `${kind}: rings out`);
  }
  // the top note is clearly higher than the down-stroke: count zero crossings over 80 ms after the click
  const zc = x => { let n = 0; for (let i = sr * 0.02; i < sr * 0.1; i++) if ((x[i] > 0) !== (x[i - 1] > 0)) n++; return n; };
  assert.ok(zc(renderStroke(sr, "t", 3)) > 1.6 * zc(renderStroke(sr, "D", 3)));
  // rendering a run of strokes lands each where it belongs
  const y = renderDrums([{ t: 0.5, kind: "D", vel: 1 }], sr, sr);
  let first = -1; for (let i = 0; i < y.length; i++) if (Math.abs(y[i]) > 0.01) { first = i; break; }
  assert.ok(Math.abs(first / sr - 0.5) < 0.002);
});
