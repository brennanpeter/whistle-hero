import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAbcFile, parseAbc } from "../src/abc/abc.js";
import { checkPlayability } from "../src/abc/playability.js";
import { buildChart, meterInfo } from "../src/chart/chart.js";
import { STARTER_ABC } from "../src/tunes/starter.js";

const tunes = parseAbcFile(STARTER_ABC);

test("the starter set covers every rhythm the backing band will need", () => {
  const rhythms = new Set(tunes.map(t => parseAbc(t.abc).meta.rhythm));
  for (const r of ["reel", "jig", "hornpipe", "polka", "slide", "slip jig", "waltz", "strathspey", "mazurka", "barndance"])
    assert.ok(rhythms.has(r), `no ${r}`);
  assert.equal(tunes.length, 12);
  assert.equal(new Set(tunes.map(t => t.title)).size, tunes.length, "titles are unique");
});

test("every starter tune parses cleanly, plays on a D whistle, and builds a chart", () => {
  for (const t of tunes) {
    const p = parseAbc(t.abc);
    assert.deepEqual(p.warnings, [], `${t.title}: ${p.warnings.join("; ")}`);
    const play = checkPlayability(p);
    assert.equal(play.issues.length, 0, `${t.title}: ${JSON.stringify(play.issues)}`);
    const chart = buildChart(p);
    assert.ok(chart.notes.length > 30, `${t.title}: ${chart.notes.length} notes`);
  }
});

test("every full bar of every starter tune adds up to its time signature", () => {
  for (const t of tunes) {
    const p = parseAbc(t.abc), barLen = meterInfo(p.meter).barLen;
    const starts = p.bars.map(b => b.pos).concat(p.length);
    // A bar may be short only as the opening pickup, the last bar, or one of a pair that makes a
    // full bar between them (the short bar before a repeat and the pickup played again after it).
    const lens = starts.slice(1).map((x, i) => x - starts[i]), full = v => Math.abs(v - barLen) < 1e-9;
    lens.forEach((len, i) => {
      assert.ok(len <= barLen + 1e-9, `${t.title}: bar ${i + 1} is too long (${len} of ${barLen})`);
      if (full(len) || i === 0 || i === lens.length - 1) return;
      assert.ok(full(len + lens[i + 1]) || full(len + lens[i - 1]), `${t.title}: bar ${i + 1} is short (${len} of ${barLen})`);
    });
  }
});

test("every starter tune's beat grid is even from start to finish, through repeats and pickups", () => {
  for (const t of tunes) {
    const chart = buildChart(parseAbc(t.abc), { bpm: 120 });
    const gaps = chart.beats.slice(1).map((b, i) => b.t - chart.beats[i].t);
    assert.ok(gaps.every(g => Math.abs(g - chart.beatSeconds) < 1e-6), `${t.title}: uneven beats ${[...new Set(gaps.map(g => g.toFixed(3)))]}`);
    const strong = chart.beats.filter(b => b.strong).map(b => b.t);
    assert.ok(strong.slice(1).every((x, i) => Math.abs(x - strong[i] - chart.beatSeconds * chart.beatsPerBar) < 1e-6), `${t.title}: bar starts uneven`);
  }
});
