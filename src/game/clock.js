// The game clock: how game time (chart time) relates to the audio clock. Shared by the game page and
// the real-time simulator's audio worklet, so both read the same clock.
//
// Game time is chart time: the notes, beats, views and judging all work in it. It normally runs with
// the audio clock (game = audio − t0), but the tempo buttons change how fast it runs, so a change is
// heard and seen at once: everything already laid out keeps its place and the clock runs through it
// faster or slower. Each pass runs at bpmWith(base, its number) ÷ the tempo it was laid out at. Each
// change leaves an anchor { a: audio time, g: game time, base: the base tempo from then on }, so times
// from before it (the detector reports a moment late) still convert as they were.
//
// A clock is { warp: [anchor, ...], passes: [{ start, n, bpm }, ...], loop: "off" | "loop" | "ramp" }.
//
//   gameTime(a, clock)    audio clock time → game time
//   audioTime(g, clock)   game time → audio clock time
//   rateAt(g, base, clock) game seconds per real second at game time g

/** The tempo of pass n with the base tempo `base`: plus 5 bpm every third pass when speeding up. */
export const bpmWith = (base, n, loop) => Math.max(5, base + (loop === "ramp" ? 5 * Math.floor((n - 1) / 3) : 0));

export function passAt(g, c) { let p = c.passes[0]; for (const q of c.passes) { if (q.start <= g + 1e-9) p = q; else break; } return p; }
const nextStart = (g, c) => { for (const q of c.passes) if (q.start > g + 1e-9) return q.start; return Infinity; };
export const rateAt = (g, base, c) => { const p = passAt(g, c); return bpmWith(base, p.n, c.loop) / p.bpm; };

export function gameTime(a, c) {
  const W = c.warp; let k = 0;
  while (k + 1 < W.length && W[k + 1].a <= a) k++;
  let { a: a0, g, base } = W[k];
  if (a < a0) return g + (a - a0) * rateAt(g, base, c); // before the first anchor: the run-up
  for (;;) {
    const r = rateAt(g, base, c), nb = nextStart(g, c), aEnd = a0 + (nb - g) / r;
    if (a <= aEnd) return g + (a - a0) * r;
    a0 = aEnd; g = nb;
  }
}

export function audioTime(gt, c) {
  const W = c.warp; let k = 0;
  while (k + 1 < W.length && W[k + 1].g <= gt) k++;
  let { a, g, base } = W[k];
  if (gt < g) return a + (gt - g) / rateAt(g, base, c);
  for (;;) {
    const r = rateAt(g, base, c), nb = nextStart(g, c);
    if (gt <= nb) return a + (gt - g) / r;
    a += (nb - g) / r; g = nb;
  }
}

/** A copy of the parts of a clock the worklet needs (plain data, to post to it). */
export const clockData = c => ({ warp: c.warp.map(w => ({ ...w })), passes: c.passes.map(p => ({ start: p.start, n: p.n, bpm: p.bpm })), loop: c.loop });
