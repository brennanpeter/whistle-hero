// Whistle note detector: McLeod pitch method, note segmentation, and ornament/transient labelling.
// Shared by Whistle Ear (live and file input), the game, and the test suite. No DOM, no Web Audio:
// feed it windows of samples and it builds up frames and note segments.
//
//   const S = makeSession(settings);           // settings can be a live object the UI mutates
//   feed(S, t, window, sampleRate);             // once per hop, window = last WIN samples
//   closeSeg(S); annotate(S.segs, settings);    // at the end
//
// Or in one go for a whole buffer:  const S = analyze(samples, sampleRate, settings);
import { LOW_D, noteInfo } from "../whistle.js";

export const FMIN = 480, FMAX = 2700, WIN = 1024, HOP = 256;
export const M_TOP = 98.6, M_BOT = 73.4; // voiced range in MIDI: just below low D to just above D″
export const LOW = LOW_D;

export const DEFAULT_SETTINGS = Object.freeze({
  a4: 440,        // reference pitch, Hz
  gate: -50,      // frames quieter than this (dBFS RMS) are ignored
  clarity: 0.88,  // minimum NSDF peak for a frame to count as pitched
  grace: 70,      // notes this short (ms) or shorter are cuts, taps or grace notes
});

/* ---------- Pitch detection: McLeod Pitch Method (normalized square difference) ---------- */
const nsdf = new Float32Array(WIN);

/** One analysis window → {rms, db, freq, clarity}. freq is 0 when no pitch was found. */
export function detect(buf, sr, settings = DEFAULT_SETTINGS) {
  const n = buf.length; let e = 0;
  for (let i = 0; i < n; i++) e += buf[i] * buf[i];
  const rms = Math.sqrt(e / n), db = 20 * Math.log10(rms + 1e-9);
  if (db < settings.gate) return { rms, db, freq: 0, clarity: 0 };
  const minTau = Math.max(2, Math.floor(sr / FMAX));
  const maxTau = Math.min((n >> 1) - 1, Math.ceil(sr / FMIN * 1.6));
  let m = 2 * e;
  for (let tau = 0; tau <= maxTau; tau++) {
    if (tau > 0) { const a = buf[n - tau], b = buf[tau - 1]; m -= a * a + b * b; }
    let acf = 0;
    for (let i = 0, lim = n - tau; i < lim; i++) acf += buf[i] * buf[i + tau];
    nsdf[tau] = m > 1e-12 ? 2 * acf / m : 0;
  }
  const peaks = []; let pos = false, best = -1;
  for (let tau = 1; tau <= maxTau; tau++) {
    const v = nsdf[tau];
    if (!pos && nsdf[tau - 1] <= 0 && v > 0) { pos = true; best = -1; }
    else if (pos && v <= 0) { if (best > 0) peaks.push(best); pos = false; }
    if (pos && (best < 0 || v > nsdf[best])) best = tau;
  }
  if (pos && best > 0 && best < maxTau) peaks.push(best);
  const ok = peaks.filter(t => t >= minTau && t < maxTau);
  if (!ok.length) return { rms, db, freq: 0, clarity: 0 };
  let gmax = 0; for (const t of ok) gmax = Math.max(gmax, nsdf[t]);
  const t = ok.find(p => nsdf[p] >= 0.9 * gmax);
  const a = nsdf[t - 1], b = nsdf[t], c = nsdf[t + 1], den = a - 2 * b + c;
  const shift = den !== 0 ? 0.5 * (a - c) / den : 0;
  return { rms, db, freq: sr / (t + shift), clarity: b - 0.25 * (a - c) * shift };
}

/* ---------- Note segmentation ---------- */
export const makeSession = (settings = { ...DEFAULT_SETTINGS }) =>
  ({ frames: [], segs: [], cur: null, silent: 0, hopT: 0, settings });

/** Analyse one window ending at the current hop; t is the window's centre time in seconds. */
export function feed(S, t, win, sr) {
  const st = S.settings;
  const r = detect(win, sr, st);
  S.hopT = HOP / sr;
  let midiF = null, voiced = false;
  if (r.freq > 0 && r.clarity >= st.clarity) {
    midiF = 69 + 12 * Math.log2(r.freq / st.a4);
    voiced = midiF > M_BOT && midiF < M_TOP;
    if (!voiced) midiF = null;
  }
  const fr = { t, rms: r.rms, db: r.db, freq: r.freq, clarity: r.clarity, midiF, voiced };
  S.frames.push(fr);
  segment(S, fr);
  return fr;
}
function openSeg(S, fr, m, cents, tongued) {
  S.cur = { midi: m, start: fr.t, end: fr.t, cs: cents, n: 1, peak: fr.rms, dip: false, tongued };
}
export function closeSeg(S) {
  const c = S.cur; if (!c) return;
  const end = c.end + S.hopT;
  S.segs.push({ midi: c.midi, start: c.start, end, dur: end - c.start, cents: c.cs / c.n, tongued: c.tongued });
  S.cur = null; S.silent = 0;
}
function segment(S, fr) {
  const c = S.cur;
  if (fr.voiced) {
    S.silent = 0;
    const m = Math.round(fr.midiF), cents = (fr.midiF - m) * 100;
    if (c && c.midi === m) {
      S.pend = null;
      if (!c.dip && fr.rms < c.peak * 0.45 && fr.t - c.start > 0.04) c.dip = true;
      else if (c.dip && fr.rms > c.peak * 0.75) { closeSeg(S); openSeg(S, fr, m, cents, true); return; }
      if (!c.dip) c.peak = Math.max(c.peak, fr.rms);
      c.end = fr.t; c.cs += cents; c.n++;
    } else if (!c) {
      openSeg(S, fr, m, cents, false);
    } else {
      // a new pitch must hold for 3 frames, so glides between notes are not counted as notes
      const p = S.pend;
      if (p && p.midi === m) {
        p.n++; p.cs += cents; p.last = fr.t;
        if (p.n >= 3) {
          closeSeg(S);
          S.cur = { midi: m, start: p.t, end: p.last, cs: p.cs, n: p.n, peak: p.peak, dip: false, tongued: false };
          S.pend = null;
        }
      } else S.pend = { midi: m, t: fr.t, last: fr.t, n: 1, cs: cents, peak: fr.rms };
    }
  } else if (c) {
    S.pend = null;
    if (fr.rms < c.peak * 0.5 && fr.t - c.start > 0.04) c.dip = true;
    if (++S.silent >= 3) closeSeg(S);
  }
}

/* ---------- Ornaments and transients ---------- */
export const HARMONICS = [12, 19, 24, 28]; // semitones to the 2nd, 3rd, 4th and 5th partials

/**
 * Label segments in place: kind ("note" | "grace"), orn ("cut" | "tap"), roll (1 first, 2 inner, 3 last),
 * art ("sliver" | "overtone" for transients that are not real notes), inScale. Returns the same array.
 */
export function annotate(all, settings = DEFAULT_SETTINGS) {
  let segs = all;
  const gms = settings.grace / 1000;
  for (const s of segs) { s.kind = s.dur <= gms ? "grace" : "note"; s.orn = null; s.roll = 0; s.art = null; s.inScale = noteInfo(s.midi).inScale; }
  // Transients: a short blip at a harmonic of a neighbouring note (overblown attack or release),
  // or a sliver at the same pitch as a neighbouring note. Neither is a real ornament.
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]; if (s.kind !== "grace") continue;
    const p = segs[i - 1], n = segs[i + 1];
    const pn = p && p.kind === "note" && s.start - p.end < 0.06 ? p : null;
    const nn = n && n.kind === "note" && n.start - s.end < 0.06 ? n : null;
    if (s.dur <= 0.03 && ((pn && pn.midi === s.midi) || (nn && nn.midi === s.midi))) { s.art = "sliver"; continue; }
    const harm = a => a && HARMONICS.some(h => Math.abs(s.midi - a.midi - h) <= 1);
    if (harm(nn) || harm(pn)) s.art = "overtone";
  }
  segs = segs.filter(s => !s.art);
  for (let i = 1; i < segs.length - 1; i++) {
    const p = segs[i - 1], s = segs[i], n = segs[i + 1];
    if (s.kind === "grace" && p.kind === "note" && n.kind === "note" && p.midi === n.midi &&
        s.start - p.end < 0.05 && n.start - s.end < 0.05)
      s.orn = s.midi > p.midi ? "cut" : "tap";
  }
  for (let i = 0; i + 4 < segs.length; i++) {
    const [a, b, c, d, e] = segs.slice(i, i + 5);
    if (a.kind === "note" && b.orn === "cut" && d.orn === "tap" && a.midi === c.midi && c.midi === e.midi) {
      a.roll = 1; b.roll = c.roll = d.roll = 2; e.roll = 3; i += 4;
    }
  }
  return all;
}

/** Run the whole pipeline over a buffer of mono samples. Returns the finished session. */
export function analyze(samples, sr, settings = { ...DEFAULT_SETTINGS }) {
  const S = makeSession(settings), win = new Float32Array(WIN);
  for (let pos = 0; pos + HOP <= samples.length; pos += HOP) {
    win.copyWithin(0, HOP);
    win.set(samples.subarray(pos, pos + HOP), WIN - HOP);
    feed(S, (pos + HOP) / sr - WIN / (2 * sr), win, sr);
  }
  closeSeg(S);
  annotate(S.segs, settings);
  return S;
}
