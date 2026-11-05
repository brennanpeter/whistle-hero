// A synthesized bodhrán, computed as plain samples so the same sound plays in the browser (as
// AudioBuffers) and can be mixed into test recordings in Node.
//
// One stroke is: the skin (a low tone that sags in pitch as it rings out, with two inharmonic
// overtones, as a drumskin has), the tipper's click on the skin, and a short soft slap of air.
// Stroke kinds:
//   D  accented down-stroke: the low, full note
//   d  lighter down-stroke
//   u  up-stroke: lighter and a touch higher (the tipper's other end, glancing)
//   t  "top": a higher note, played near the rim with the hand pressing the skin from behind
export const STROKES = {
  D: { f0: 74, decay: 0.24, click: 0.30, slap: 0.35, gain: 1.0 },
  d: { f0: 78, decay: 0.16, click: 0.26, slap: 0.25, gain: 0.8 },
  u: { f0: 84, decay: 0.11, click: 0.22, slap: 0.18, gain: 0.65 },
  t: { f0: 165, decay: 0.09, click: 0.28, slap: 0.12, gain: 0.7 },
};
const MODES = [[1, 1, 1], [1.59, 0.45, 0.55], [2.14, 0.25, 0.35]]; // [ratio, level, decay factor]

/** One stroke as samples (peak about 0.8). `seed` varies it a little, like real strokes. */
export function renderStroke(sr, kind = "D", seed = 1) {
  const s = STROKES[kind] || STROKES.D;
  let r = (seed * 2654435761) >>> 0;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const detune = 1 + (rnd() - 0.5) * 0.04, len = Math.ceil(sr * (s.decay * 3.2 + 0.02)), out = new Float32Array(len);
  // the skin: each mode's pitch starts a little high (the skin is stretched by the hit) and settles
  for (const [ratio, level, df] of MODES) {
    const f = s.f0 * ratio * detune, tau = s.decay * df;
    let ph = rnd() * 0.3;
    for (let i = 0; i < len; i++) {
      const t = i / sr, fi = f * (1 + 0.5 * Math.exp(-t / 0.012));
      ph += 2 * Math.PI * fi / sr;
      out[i] += level * Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.0015);
    }
  }
  // the tipper's click: a few milliseconds of noise around 2–3 kHz
  // the slap: a short burst of low-passed noise
  const bp = biquad(sr, "bandpass", 2600 * detune, 1.4), lp = biquad(sr, "lowpass", 700, 0.7);
  for (let i = 0; i < Math.min(len, sr * 0.05); i++) {
    const t = i / sr, n = rnd() * 2 - 1;
    out[i] += s.click * 3 * bp(n) * Math.exp(-t / 0.003) + s.slap * 1.5 * lp(rnd() * 2 - 1) * Math.exp(-t / 0.012);
  }
  let peak = 0; for (const v of out) peak = Math.max(peak, Math.abs(v));
  const k = 0.8 * s.gain / (peak || 1);
  for (let i = 0; i < len; i++) out[i] *= k;
  return out;
}

// RBJ biquad, as a sample-at-a-time function
function biquad(sr, type, f0, Q) {
  const w = 2 * Math.PI * f0 / sr, al = Math.sin(w) / (2 * Q), c = Math.cos(w), a0 = 1 + al;
  const [b0, b1, b2] = type === "lowpass" ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [al, 0, -al];
  const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = -2 * c / a0, A2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = B0 * x + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
