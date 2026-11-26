// The simulated whistle as a streaming voice: one sample at a time, from a performance's items (see
// perform() in whistle-synth.js). Used two ways:
//   offline   renderPerformance() steps through the performance sample by sample (Whistle Sim, tests)
//   real time the audio worklet (sim-worklet.js) steps through it at the game clock's speed, so a
//             tempo change is followed at once
//
//   const ctl = createControl(items, sr)   ctl.at(pos) sets what the player is doing at `pos`, a
//                                          position in the performance in samples (fractional is fine)
//   const v = createVoice(options, sr, firstMidi)
//   v.next(ctl, pos)                       the next output sample
//
// Positions are in the performance's own samples; output samples are real ones. Offline they're the
// same; in real time a faster clock moves through the performance faster, while the voice's own
// smoothing (attacks, releases, glides) stays in real time, as a player's fingers and breath do.
import { LOW_D } from "../whistle.js";

const TAU = Math.PI * 2;
const f32 = Math.fround;
const LN2_12 = Math.LN2 / 12;

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => { const u = Math.max(next(), 1e-12), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
  return { next, gauss, range: (a0, b0) => a0 + (b0 - a0) * next(), chance: p => next() < p };
}

function bandpass(sr, f, q) {
  const w = TAU * f / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}

/**
 * What the player is doing at each moment, from the performance's items: the target pitch (held
 * through gaps), the target loudness, the tongue stopping the air, the chiff of a tongued attack,
 * and which item is sounding (for vibrato). Each item has, in order:
 *   a tongue stop   [ts, s0)  the air nearly stopped just before a tongued note
 *   its sound       [s0, s1)  with a slide up into it, overblown or finger-crossing blips, a crack
 * and items follow one another without overlapping. Positions move forward as a rule; going back
 * works too (it searches again).
 */
export function createControl(items, sr) {
  const S = t => Math.max(0, Math.round(t * sr));
  const n = items.length;
  const it = items.map((x, k) => {
    const s0 = S(x.start), s1 = S(x.end), base = x.midi + x.cents / 100;
    const prev = items[k - 1];
    const from = x.slide ? (prev && prev.end === x.start && prev.midi < x.midi && x.midi - prev.midi <= 3 ? prev.midi + prev.cents / 100 : base - 1.6) : base;
    return {
      x, s0, s1, base, from, amp: x.amp, ts: x.tongueS ? S(x.start - x.tongueS) : s0, tongue: !!x.tongueS,
      slideS: x.slide ? Math.min(0.14, (x.end - x.start) * 0.5) * sr : 0,
      blips: (x.blips || []).map(b => [S(b.start), S(b.end), b.midi + x.cents / 100]),
      crack: x.crack ? [S(x.crack.start), S(x.crack.end)] : null,
    };
  });
  let i = -1, chiffNext = 0, last = n ? items[0].midi : LOW_D;
  const ctl = { tm: last, ta: 0, stop: false, owner: null, chiff: false, at };
  function seek(pos) { // after going back: search again
    i = -1; while (i + 1 < n && it[i + 1].ts <= pos) i++;
    chiffNext = 0; while (chiffNext < n && it[chiffNext].s0 < pos) chiffNext++;
  }
  function at(pos) {
    if (i >= 0 && pos < it[i].ts) seek(pos);
    while (i + 1 < n && it[i + 1].ts <= pos) i++;
    // a tongued attack's chiff, once, as its sound begins
    ctl.chiff = false;
    while (chiffNext < n && it[chiffNext].s0 <= pos) { if (it[chiffNext].tongue) ctl.chiff = true; chiffNext++; }
    ctl.ta = 0; ctl.stop = false; ctl.owner = null;
    if (i < 0) { ctl.tm = last; return ctl; }
    const c = it[i];
    let tm = null;
    // (targets rounded to 32-bit floats, as the renderer before this one stored them: same sound, bit for bit)
    if (pos < c.s0) { ctl.ta = f32(c.amp * 0.02); ctl.stop = true; }      // the tongue stop
    else if (pos < c.s1) {                                                  // the note
      const j = pos - c.s0, sliding = j < c.slideS;
      tm = f32(sliding ? c.from + (c.base - c.from) * (j / c.slideS) : c.base);
      ctl.ta = f32(c.amp * (sliding ? 0.85 : 1)); ctl.owner = c.x;
      if (c.crack && pos >= c.crack[0] && pos < c.crack[1]) ctl.ta = f32(c.amp * 0.15);
    }
    for (const b of c.blips) if (pos >= b[0] && pos < b[1]) tm = f32(b[2]);
    if (tm != null) last = tm;
    ctl.tm = last;
    return ctl;
  }
  return ctl;
}

/**
 * The whistle itself: pitch and breath smoothing, the harmonics of the tone (brighter when blown
 * harder, softer in the upper octave), breath noise, the chiff, vibrato on long notes, a slow drift
 * in tuning, then the room (reverb, background noise, mains hum) and the level. `o` is a performance's
 * resolved options (see resolveOptions in whistle-synth.js).
 */
export function createVoice(o, sr, firstMidi = LOW_D) {
  const R = rng(o.seed * 7919 + 13), Rn = rng(o.seed * 104729 + 7);
  const kM = 1 - Math.exp(-1 / (0.0025 * sr));
  const kA = 1 - Math.exp(-1 / (0.006 * sr));
  const kR = 1 - Math.exp(-1 / (0.014 * sr));
  const kT = 1 - Math.exp(-1 / (0.003 * sr));
  const breathBP = bandpass(sr, 2600, 0.6), breathLow = bandpass(sr, 900, 0.8), chiffBP = bandpass(sr, 5200, 0.9);
  const hp = [0, R.range(0, TAU), R.range(0, TAU), R.range(0, TAU), R.range(0, TAU)];
  // each harmonic's phase offset as a sine and cosine, so sin(h·ph + offset) needs no sin() of its own
  const hs = hp.map(Math.sin), hc = hp.map(Math.cos);
  const dph = [R.range(0, TAU), R.range(0, TAU), R.range(0, TAU)];
  const coupling = 28; // cents of pitch drop at zero breath: whistles go flat when blown softly
  const chiffDecay = Math.exp(-1 / (0.011 * sr));
  const nyq = sr * 0.45;
  // the room
  const rev = o.reverb > 0 ? (() => {
    const scale = sr / 44100;
    return {
      combs: [1557, 1617, 1491, 1422].map(d => ({ buf: new Float32Array(Math.round(d * scale)), i: 0, lp: 0 })),
      aps: [225, 556].map(d => ({ buf: new Float32Array(Math.round(d * scale)), i: 0 })),
    };
  })() : null;
  const fb = 0.72, damp = 0.35; // about 0.6 s RT60: a living room, not a hall
  const noiseA = Math.pow(10, o.roomNoiseDb / 20) * 1.8; // pinkish noise is quieter than its white source
  const humA = Math.pow(10, o.humDb / 20);
  const g = Math.pow(10, o.gainDb / 20);
  let midi = firstMidi, amp = 0, ph = 0, chiff = 0, nom = 0.25, pink = 0, count = 0;
  const H = [1, 0, 0, 0, 0];

  return {
    /** How loud the whistle itself is now (0 once it has died away). */
    get level() { return amp; },
    next(c, pos) {
      const ta = c.ta;
      midi += (c.tm - midi) * kM;
      amp += (ta - amp) * (ta > amp ? kA : c.stop ? kT : kR);
      let cents = 0, am = 1;
      const it = c.owner;
      if (it) {
        nom = it.amp;
        if (it.vib) {
          const tt = (pos - it.start * sr) / sr - 0.22;
          if (tt > 0) { const d = Math.min(1, tt / 0.18), s = Math.sin(TAU * 5.3 * tt); cents += o.vibratoCents * d * s; am += 0.05 * d * s; }
        }
      }
      const ratio = Math.min(amp / nom, 1.15);
      cents += coupling * (ratio - 1);
      const tt = pos / sr;
      cents += 2.5 * Math.sin(TAU * 0.31 * tt + dph[0]) + 1.5 * Math.sin(TAU * 0.83 * tt + dph[1]);
      const m = midi + o.shift + cents / 100;
      const f = 440 * Math.exp((m - 69) * LN2_12);
      ph += TAU * f / sr; if (ph > TAU) ph -= TAU;

      const reg = Math.max(0, Math.min(1.5, (midi - LOW_D) / 12)), r1 = Math.min(1, reg);
      const bright = Math.pow(Math.max(0, ratio), 0.6);
      H[1] = (0.30 - 0.23 * r1) * bright; H[2] = (0.11 - 0.09 * r1) * bright; H[3] = 0.045 * (1 - r1) * bright; H[4] = 0.022 * (1 - r1) * bright;
      // sin(h·ph) and cos(h·ph) by angle addition from one sin and cos (this runs on the audio thread)
      let tone = 0;
      const s1 = Math.sin(ph), c1 = Math.cos(ph);
      let sk = s1, ck = c1;
      for (let h = 0; h < 5; h++) {
        if (f * (h + 1) > nyq) break;
        tone += H[h] * (sk * hc[h] + ck * hs[h]);
        const sn = sk * c1 + ck * s1; ck = ck * c1 - sk * s1; sk = sn;
      }

      if (c.chiff) chiff = 1;
      const w = R.next() * 2 - 1;
      const air = o.breathiness * (amp / 0.27) * (1 + 0.6 * reg) * (0.11 * breathBP(w) + 0.05 * breathLow(w));
      const ch = chiff * 0.18 * chiffBP(R.next() * 2 - 1) * Math.min(1, amp / nom + 0.3);
      chiff *= chiffDecay;
      let x = amp * am * tone + air + ch;

      if (rev) {
        const xin = x * 0.25; let y = 0;
        for (let j = 0; j < 4; j++) { const cb = rev.combs[j], v = cb.buf[cb.i]; cb.lp = v * (1 - damp) + cb.lp * damp; cb.buf[cb.i] = xin + cb.lp * fb; if (++cb.i === cb.buf.length) cb.i = 0; y += v; }
        for (let j = 0; j < 2; j++) { const a = rev.aps[j], v = a.buf[a.i], z = -y + v; a.buf[a.i] = y + v * 0.5; if (++a.i === a.buf.length) a.i = 0; y = z; }
        x = x * (1 - o.reverb) + y * o.reverb * 1.6;
      }
      pink = 0.97 * pink + 0.03 * (Rn.next() * 2 - 1) * 4;
      x += noiseA * pink;
      if (humA > 1e-5) { const t2 = TAU * 60 * count / sr; x += humA * (Math.sin(t2) + 0.5 * Math.sin(2 * t2) + 0.3 * Math.sin(3 * t2)); }
      count++;
      x *= g;
      return x > 1 ? 1 : x < -1 ? -1 : x;
    },
  };
}
