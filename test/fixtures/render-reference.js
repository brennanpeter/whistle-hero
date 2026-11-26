// The simulator's renderer as it was before it became a streaming voice (src/sim/voice.js), kept
// frozen as a reference: test/voice.test.js checks the new one against it.
import { LOW_D } from "../../src/whistle.js";
const TAU = Math.PI * 2;
function rng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => { const u = Math.max(next(), 1e-12), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
  return { next, gauss, range: (a0, b0) => a0 + (b0 - a0) * next(), chance: p => next() < p };
}

/* ---------------------------------------------------------------- synthesis */

function bandpass(sr, f, q) {
  const w = TAU * f / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}

/** Render a performance (from perform()) to a Float32Array. */
export function renderPerformanceReference(perf) {
  const o = perf.options, sr = o.sr;
  const N = Math.ceil(perf.duration * sr);
  const R = rng(o.seed * 7919 + 13);
  const tMidi = new Float32Array(N).fill(NaN);
  const tAmp = new Float32Array(N);
  const owner = new Int32Array(N).fill(-1);
  const chiffAt = new Uint8Array(N);
  const stop = new Uint8Array(N); // tongue stops cut the air almost instantly
  const S = t => Math.max(0, Math.min(N, Math.round(t * sr)));

  perf.items.forEach((it, k) => {
    const s0 = S(it.start), s1 = S(it.end), base = it.midi + it.cents / 100;
    const slideS = it.slide ? Math.min(0.14, (it.end - it.start) * 0.5) * sr : 0;
    const prev = perf.items[k - 1];
    const from = it.slide ? (prev && prev.end === it.start && prev.midi < it.midi && it.midi - prev.midi <= 3 ? prev.midi + prev.cents / 100 : base - 1.6) : base;
    for (let n = s0; n < s1; n++) {
      const j = n - s0;
      tMidi[n] = j < slideS ? from + (base - from) * (j / slideS) : base;
      tAmp[n] = it.amp * (j < slideS ? 0.85 : 1);
      owner[n] = k;
    }
    if (it.tongueS) { for (let n = S(it.start - it.tongueS); n < s0; n++) { tAmp[n] = it.amp * 0.02; stop[n] = 1; } if (s0 < N) chiffAt[s0] = 1; }
    for (const b of it.blips) for (let n = S(b.start); n < S(b.end); n++) tMidi[n] = b.midi + it.cents / 100;
    if (it.crack) for (let n = S(it.crack.start); n < S(it.crack.end); n++) tAmp[n] = it.amp * 0.15;
  });
  // Hold pitch through rests so releases and reverb tails stay on the last note.
  let last = perf.items.length ? perf.items[0].midi : LOW_D;
  for (let n = 0; n < N; n++) { if (Number.isNaN(tMidi[n])) tMidi[n] = last; else last = tMidi[n]; }

  const out = new Float32Array(N);
  const kM = 1 - Math.exp(-1 / (0.0025 * sr));
  const kA = 1 - Math.exp(-1 / (0.006 * sr));
  const kR = 1 - Math.exp(-1 / (0.014 * sr));
  const kT = 1 - Math.exp(-1 / (0.003 * sr));
  const breathBP = bandpass(sr, 2600, 0.6), breathLow = bandpass(sr, 900, 0.8), chiffBP = bandpass(sr, 5200, 0.9);
  const hp = [0, R.range(0, TAU), R.range(0, TAU), R.range(0, TAU), R.range(0, TAU)];
  const dph = [R.range(0, TAU), R.range(0, TAU), R.range(0, TAU)];
  const coupling = 28; // cents of pitch drop at zero breath: whistles go flat when blown softly
  let midi = tMidi[0], amp = 0, ph = 0, chiff = 0, nom = 0.25, vibStart = -1;
  const chiffDecay = Math.exp(-1 / (0.011 * sr));
  const nyq = sr * 0.45;

  for (let n = 0; n < N; n++) {
    const ta = tAmp[n];
    midi += (tMidi[n] - midi) * kM;
    amp += (ta - amp) * (ta > amp ? kA : stop[n] ? kT : kR);
    const k = owner[n];
    let cents = 0, am = 1;
    if (k >= 0) {
      const it = perf.items[k]; nom = it.amp;
      if (it.vib) {
        const tt = (n - it.start * sr) / sr - 0.22;
        if (tt > 0) { const d = Math.min(1, tt / 0.18), s = Math.sin(TAU * 5.3 * tt); cents += o.vibratoCents * d * s; am += 0.05 * d * s; }
      }
    }
    const ratio = Math.min(amp / nom, 1.15);
    cents += coupling * (ratio - 1);
    const tt = n / sr;
    cents += 2.5 * Math.sin(TAU * 0.31 * tt + dph[0]) + 1.5 * Math.sin(TAU * 0.83 * tt + dph[1]);
    const m = midi + o.shift + cents / 100;
    const f = 440 * Math.pow(2, (m - 69) / 12);
    ph += TAU * f / sr; if (ph > TAU) ph -= TAU;

    const reg = Math.max(0, Math.min(1.5, (midi - LOW_D) / 12));
    const bright = Math.pow(Math.max(0, ratio), 0.6);
    const H = [1, (0.30 - 0.23 * Math.min(1, reg)) * bright, (0.11 - 0.09 * Math.min(1, reg)) * bright, 0.045 * (1 - Math.min(1, reg)) * bright, 0.022 * (1 - Math.min(1, reg)) * bright];
    let tone = 0;
    for (let h = 0; h < 5; h++) { if (f * (h + 1) > nyq) break; tone += H[h] * Math.sin((h + 1) * ph + hp[h]); }

    if (chiffAt[n]) chiff = 1;
    const w = R.next() * 2 - 1;
    const air = o.breathiness * (amp / 0.27) * (1 + 0.6 * reg) * (0.11 * breathBP(w) + 0.05 * breathLow(w));
    const ch = chiff * 0.18 * chiffBP(R.next() * 2 - 1) * Math.min(1, amp / nom + 0.3);
    chiff *= chiffDecay;
    out[n] = amp * am * tone + air + ch;
  }

  // Room: Schroeder reverb, background noise, hum, then level.
  if (o.reverb > 0) {
    const scale = sr / 44100;
    const combs = [1557, 1617, 1491, 1422].map(d => ({ buf: new Float32Array(Math.round(d * scale)), i: 0, lp: 0 }));
    const aps = [225, 556].map(d => ({ buf: new Float32Array(Math.round(d * scale)), i: 0 }));
    const fb = 0.72, damp = 0.35; // about 0.6 s RT60: a living room, not a hall
    for (let n = 0; n < N; n++) {
      const x = out[n] * 0.25; let y = 0;
      for (const c of combs) { const v = c.buf[c.i]; c.lp = v * (1 - damp) + c.lp * damp; c.buf[c.i] = x + c.lp * fb; c.i = (c.i + 1) % c.buf.length; y += v; }
      for (const a of aps) { const v = a.buf[a.i]; const z = -y + v; a.buf[a.i] = y + v * 0.5; a.i = (a.i + 1) % a.buf.length; y = z; }
      out[n] = out[n] * (1 - o.reverb) + y * o.reverb * 1.6;
    }
  }
  const noiseA = Math.pow(10, o.roomNoiseDb / 20) * 1.8; // pinkish noise is quieter than its white source
  const humA = Math.pow(10, o.humDb / 20);
  const g = Math.pow(10, o.gainDb / 20);
  let pink = 0, peak = 0;
  for (let n = 0; n < N; n++) {
    pink = 0.97 * pink + 0.03 * (R.next() * 2 - 1) * 4;
    let x = out[n] + noiseA * pink;
    if (humA > 1e-5) { const t2 = TAU * 60 * n / sr; x += humA * (Math.sin(t2) + 0.5 * Math.sin(2 * t2) + 0.3 * Math.sin(3 * t2)); }
    x *= g;
    if (x > 1) x = 1; else if (x < -1) x = -1;
    out[n] = x; peak = Math.max(peak, Math.abs(x));
  }
  return { samples: out, sr, peak };
}

