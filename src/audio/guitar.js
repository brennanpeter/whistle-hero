// A synthesized backing guitar in the open-tuning style of Irish backing: bass notes on the low
// strings carry the chord changes, the top strings ring the key's drones, brushed lightly on the
// rhythm. Computed as plain samples (like the bodhrán), so the same sound plays in the browser and
// can be mixed into test recordings in Node.
//
// Each string is a plucked-string model (Karplus–Strong): a burst of noise circulating in a loop as
// long as the string's period, softened a little each time round, so it rings at the string's pitch
// and mellows as it fades, as a real string does.
//
//   renderStrum(sr, notes, { vel, ring, seed })           one stroke as samples
//   guitarStrokes(beats, groove, changes, key, rnd, until) every stroke for a run of annotated beats
//   renderGuitar(strokes, sr, n, offset)                   strokes as samples
//   createGuitar(ctx, out)                                 the live guitar: play(at, notes, bass, vel)
import { voicing } from "../music/chords.js";

// Strokes, in the open-tuning style (see voicing in chords.js): the low strings carry the root, the
// top strings ring the drones.
//   B  the bass and a gentle strum of the top strings, together (the beat)
//   b  the bass alone
//   T  an accented brush of the top strings
//   t  a light brush of the top strings
export const STRUMS = {
  B: { vel: 0.8, bass: true, top: true }, b: { vel: 0.75, bass: true, top: false },
  T: { vel: 0.55, bass: false, top: true }, t: { vel: 0.36, bass: false, top: true },
};

/**
 * One stroke as samples: `notes` sounded one after another (a strum is a soft, slow sweep: 18 ms
 * between strings), a dark, soft pluck that rings long. Peak about 0.8 × vel.
 */
export function renderStrum(sr, notes, { vel = 1, ring = 2.2, seed = 1, spread = 0.018, bright = 0.1, dark = 0.075, bass = false } = {}) {
  let r = (seed * 2654435761) >>> 0;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const len = Math.ceil(sr * (ring + spread * notes.length + 0.05)), out = new Float32Array(len);
  notes.forEach((midi, k) => {
    const f = 440 * Math.pow(2, (midi - 69) / 12), N = Math.max(2, Math.round(sr / f));
    // the loop's loss sets how long it rings (the lowest strings ring longest)
    const t60 = ring * (1.2 - 0.3 * Math.min(1, (midi - 40) / 24)), loss = Math.pow(0.001, 1 / (t60 * f));
    // a soft pluck: heavily smoothed noise, plucked a third of the way along (which tames the upper partials)
    const line = new Float32Array(N), raw = new Float32Array(N);
    let prev = 0;
    for (let i = 0; i < N; i++) { prev += bright * ((rnd() * 2 - 1) - prev); raw[i] = prev; }
    const pick = Math.round(N / 3);
    for (let i = 0; i < N; i++) line[i] = raw[i] - 0.6 * raw[(i - pick + N) % N];
    // the bass string carries the sound; the top strings are a soft halo over it
    const start = Math.round((k * spread + rnd() * 0.004) * sr), amp = (bass && k === 0 ? 2.4 : 0.32) * (0.8 + 0.4 * rnd());
    let p = 0, last = 0;
    for (let i = start; i < len; i++) {
      const cur = line[p], y = 0.5 * (cur + line[(p + 1) % N]) * loss;
      line[p] = y; p = (p + 1) % N;
      out[i] += amp * (0.6 * cur + 0.4 * last); last = cur;
    }
  });
  // a warm, dark body: three soft low-pass stages take the edge off
  let a = 0, b = 0, c = 0, peak = 0;
  for (let i = 0; i < len; i++) { a += dark * (out[i] - a); b += dark * (a - b); c += dark * (b - c); out[i] = c; peak = Math.max(peak, Math.abs(c)); }
  const fadeN = Math.round(0.05 * sr);
  for (let i = 0; i < len; i++) out[i] *= (0.8 * vel / (peak || 1)) * Math.min(1, (len - i) / fadeN);
  return out;
}

/** The chord in force at position (whole notes) `pos`: the last change at or before it. */
export function chordAt(changes, pos) {
  let c = null;
  for (const x of changes) { if (x.pos <= pos + 1e-9) c = x.chord; else break; }
  return c;
}

/**
 * Every stroke for a run of annotated beats (see band.js), using the groove's `strum` pattern (one
 * string per beat, characters B b T t -, spaced evenly across it and swung like the drum). `changes`
 * are the chord changes with `t` in the same clock as the beats; `key` sets the drones. Each stroke
 * is { t, kind, chord, notes, bass, vel }. Nothing after `until`.
 */
export function guitarStrokes(beats, groove, changes, key, rnd = Math.random, until = Infinity) {
  const pat = groove.strum, out = [];
  if (!pat || !changes.length) return out;
  for (const b of beats) {
    const p = (b.bar % 8 === 7 && groove.strumFill ? groove.strumFill : pat)[b.inBar % pat.length] || "";
    for (let i = 0; i < p.length; i++) {
      const kind = p[i], k = STRUMS[kind];
      if (!k) continue;
      let at = (b.dur * i) / p.length;
      if (groove.swing && p.length % 2 === 0) { const pair = (2 * b.dur) / p.length; at = Math.floor(i / 2) * pair + (i % 2 ? groove.swing * pair : 0); }
      const t = b.t + at + (i ? (rnd() + rnd() - 1) * 0.006 : 0);
      if (t > until + 1e-6) continue;
      // the chord sounding at this moment (a stroke just before a change keeps the old chord)
      let chord = null; for (const x of changes) { if (x.t <= t + 0.02) chord = x.chord; else break; }
      if (!chord) continue;
      const v = voicing(chord, key);
      out.push({ t, kind, chord, notes: [...(k.bass ? v.bass : []), ...(k.top ? v.top : [])], bass: k.bass, vel: k.vel * (1 + (rnd() - 0.5) * 0.15) });
    }
  }
  return out;
}

/** Strokes as samples. They ring on; a new bass note mutes the strokes before it (a 40 ms fade). */
export function renderGuitar(strokes, sr, n, offset = 0, level = 1, seed = 3) {
  const out = new Float32Array(n), fade = Math.round(0.04 * sr);
  strokes.forEach((s, k) => {
    const x = renderStrum(sr, s.notes, { vel: s.vel, seed: seed + k * 7919, bass: s.bass });
    const i0 = Math.round((s.t + offset) * sr);
    const nextBass = strokes.slice(k + 1).find(q => q.bass);
    const stop = nextBass ? Math.round((nextBass.t + offset) * sr) : Infinity;
    for (let i = 0; i < x.length && i0 + i < n; i++) {
      const j = i0 + i; if (j < 0) continue;
      const g = j < stop ? 1 : Math.max(0, 1 - (j - stop) / fade);
      if (g <= 0) break;
      out[j] += x[i] * g * level;
    }
  });
  return out;
}

/**
 * The live guitar. Strokes are rendered when first needed (a set of notes) and kept; each plays
 * through its own gain, so the next bass note can mute it.
 */
export function createGuitar(ctx, out = ctx.destination) {
  const cache = new Map();
  let ringing = [], take = 0;
  const buffer = (notes, bass) => {
    const key = notes.join(",") + (bass ? "b" : "") + "/" + (take++ % 3);
    if (!cache.has(key)) {
      const x = renderStrum(ctx.sampleRate, notes, { vel: 1, seed: 17 + cache.size * 31, bass });
      const b = ctx.createBuffer(1, x.length, ctx.sampleRate); b.copyToChannel(x, 0); cache.set(key, b);
    }
    return cache.get(key);
  };
  return {
    /** Prepare the strokes for these chords ahead of time, so the first bars don't stall the page. */
    warm(chords, key) {
      for (const c of chords) { const v = voicing(c, key); for (const [notes, b] of [[[...v.bass, ...v.top], true], [v.top, false], [v.bass, true]]) for (let i = 0; i < 3; i++) buffer(notes, b); }
    },
    play(at, notes, bass, vel = 1) {
      const t = Math.max(at, ctx.currentTime);
      const src = ctx.createBufferSource(); src.buffer = buffer(notes, bass);
      const g = ctx.createGain(); g.gain.value = vel;
      src.connect(g).connect(out); src.start(t);
      if (bass) { // a new bass note mutes what's ringing
        for (const r of ringing) { r.g.gain.setValueAtTime(r.vel, t); r.g.gain.linearRampToValueAtTime(0, t + 0.04); try { r.src.stop(t + 0.05); } catch (e) {} }
        ringing = [];
      }
      ringing.push({ src, g, vel });
      return src;
    },
  };
}
