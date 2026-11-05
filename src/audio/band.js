// The backing band: everything that plays along on the chart's beat grid. For now that's the bodhrán
// (the metronome still has its own clicks in play.html); guitar and a melody voice come later.
//
//   annotateBeats(beats)                   bar and beat-in-bar for each beat, and how long it lasts
//   drumStrokes(beats, groove, rnd)        every bodhrán stroke for a run of annotated beats
//   renderDrums(strokes, sr, n, offset)    those strokes as samples (tests, offline listening)
//   createBodhran(ctx, out)                the live drum: play(at, kind, vel) on the audio clock
import { renderStroke } from "./bodhran.js";
import { beatStrokes } from "./grooves.js";

/**
 * Give each beat its place: { ...beat, bar, inBar, dur }. Bars count from 0 at the first downbeat
 * (`fromBar` continues a count across loop passes); a beat's length runs to the next beat, the last
 * one's to `lastDur` (or the beat before's length).
 */
export function annotateBeats(beats, { fromBar = 0, lastDur = null } = {}) {
  let bar = fromBar - 1, inBar = 0;
  return beats.map((b, i) => {
    if (b.strong || i === 0) { bar++; inBar = 0; } else inBar++;
    const next = beats[i + 1], prev = beats[i - 1];
    const dur = next ? next.t - b.t : lastDur ?? (prev ? b.t - prev.t : 0.5);
    return { ...b, bar, inBar, dur };
  });
}

/** Every stroke for a run of annotated beats. Strokes after `until` (the tune's last note) are dropped. */
export function drumStrokes(beats, groove, rnd = Math.random, until = Infinity) {
  const out = [];
  for (const b of beats) {
    for (const s of beatStrokes(groove, { t: b.t, dur: b.dur, beatInBar: b.inBar, bar: b.bar, rnd })) if (s.t <= until + 1e-6) out.push(s);
  }
  return out;
}

/** Strokes as samples: a buffer of n samples, stroke times offset by `offset` seconds. */
export function renderDrums(strokes, sr, n, offset = 0, level = 1, seed = 7) {
  const out = new Float32Array(n);
  let k = seed;
  for (const s of strokes) {
    const x = renderStroke(sr, s.kind, (k = (k * 1103515245 + 12345) >>> 0)), i0 = Math.round((s.t + offset) * sr);
    for (let i = 0; i < x.length && i0 + i < n; i++) if (i0 + i >= 0) out[i0 + i] += x[i] * s.vel * level;
  }
  return out;
}

/**
 * The live bodhrán: a few takes of each stroke, rendered once, played on the audio clock. Strokes
 * go through `out` (the band's bus), so the mixer level is one gain there.
 */
export function createBodhran(ctx, out = ctx.destination) {
  const TAKES = 4, bufs = {};
  for (const kind of ["D", "d", "u", "t"]) {
    bufs[kind] = Array.from({ length: TAKES }, (_, i) => {
      const x = renderStroke(ctx.sampleRate, kind, 101 + i * 7919), b = ctx.createBuffer(1, x.length, ctx.sampleRate);
      b.copyToChannel(x, 0); return b;
    });
  }
  let take = 0;
  return {
    play(at, kind, vel = 1) {
      const src = ctx.createBufferSource(); src.buffer = bufs[kind][take++ % TAKES];
      src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.03; // no two strokes quite the same
      const g = ctx.createGain(); g.gain.value = vel;
      src.connect(g).connect(out); src.start(Math.max(at, ctx.currentTime));
      return src;
    },
  };
}
