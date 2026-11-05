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
  // the search range follows the reference pitch, so a flute an octave down (a4 = 220) is searched an
  // octave lower; for a D whistle (a4 = 440) it's FMIN–FMAX
  const k = (settings.a4 || 440) / 440;
  const minTau = Math.max(2, Math.floor(sr / (FMAX * k)));
  const maxTau = Math.min((n >> 1) - 1, Math.ceil(sr / (FMIN * k) * 1.6));
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
  ({ frames: [], segs: [], cur: null, silent: 0, hopT: HOP / 44100, hist: [], settings });

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
  S.hist.push(fr.rms); if (S.hist.length > 16) S.hist.shift();
  return fr;
}

// Level just before now: the loudest frame between about 10 and 50 ms ago. A tongue stop drops well
// below this within a few frames; a room's slow swells and fades never do.
function recentLevel(S) {
  const h = S.hist, back0 = Math.max(1, Math.round(0.010 / S.hopT)), back1 = Math.round(0.050 / S.hopT);
  let m = 0;
  for (let k = back0; k <= back1 && k <= h.length; k++) m = Math.max(m, h[h.length - k]);
  return m;
}
// Tongued re-articulation: a fast dip below half the recent level, then a recovery of at least 6 dB.
// The recovery bar is low because in a live room the echo can partly cancel the new note at the mic.
// Returns true when the current note should be closed and a new tongued note opened.
function trackDip(S, c, fr) {
  if (!c.dip) {
    const ref = recentLevel(S);
    if (fr.t - c.start > 0.04 && fr.rms < ref * 0.5) c.dip = { t: fr.t, min: fr.rms, ref };
    return false;
  }
  const d = c.dip;
  d.min = Math.min(d.min, fr.rms);
  if (fr.voiced && fr.rms > d.ref * 0.45 && fr.rms > d.min * 2) return true;
  if (fr.t - d.t > 0.12) c.dip = null; // a slow fade, not a tongue stop
  return false;
}
function openSeg(S, fr, m, cents, tongued) {
  S.cur = { midi: m, start: fr.t, end: fr.t, cs: cents, n: 1, peak: fr.rms, dip: false, tongued, fs: [fr.midiF] };
}
export function closeSeg(S) {
  const c = S.cur; if (!c) return;
  const end = c.end + S.hopT;
  S.segs.push({ midi: c.midi, start: c.start, end, dur: end - c.start, cents: c.cs / c.n, tongued: c.tongued, fs: c.fs });
  S.cur = null; S.silent = 0;
}
// Cuts and taps last about 30 ms, which leaves only one or two clean frames inside the 23 ms
// analysis window. Two frames are enough when they are clearly pitched and steady on one note;
// transitions between notes rarely are.
const isShortOrnament = p => p.n === 2 && p.cmin >= 0.9 && p.fs.every(f => Math.abs(f - p.midi) <= 0.35);
function emitOrnament(S, p) {
  closeSeg(S);
  const end = p.last + S.hopT;
  S.segs.push({ midi: p.midi, start: p.t, end, dur: end - p.t, cents: p.cs / p.n, tongued: false, fs: p.fs });
  S.pend = null;
}
function segment(S, fr) {
  const c = S.cur;
  if (fr.voiced) {
    S.silent = 0;
    const m = Math.round(fr.midiF), cents = (fr.midiF - m) * 100;
    if (c && c.midi === m) {
      if (S.pend && isShortOrnament(S.pend)) { // a cut or tap: two clean frames away and straight back
        emitOrnament(S, S.pend); openSeg(S, fr, m, cents, false); return;
      }
      S.pend = null;
      if (trackDip(S, c, fr)) { closeSeg(S); openSeg(S, fr, m, cents, true); return; }
      if (!c.dip) c.peak = Math.max(c.peak, fr.rms);
      c.end = fr.t; c.cs += cents; c.n++; c.fs.push(fr.midiF);
    } else if (!c) {
      openSeg(S, fr, m, cents, false);
    } else {
      // a new pitch must hold for 3 frames, so glides between notes are not counted as notes
      const p = S.pend;
      if (p && p.midi === m) {
        p.n++; p.cs += cents; p.last = fr.t; p.fs.push(fr.midiF); p.cmin = Math.min(p.cmin, fr.clarity);
        if (p.n >= 3) {
          closeSeg(S);
          S.cur = { midi: m, start: p.t, end: p.last, cs: p.cs, n: p.n, peak: p.peak, dip: false, tongued: false, fs: p.fs };
          S.pend = null;
        }
      } else {
        if (p && isShortOrnament(p)) { emitOrnament(S, p); openSeg(S, fr, m, cents, false); return; }
        S.pend = { midi: m, t: fr.t, last: fr.t, n: 1, cs: cents, peak: fr.rms, fs: [fr.midiF], cmin: fr.clarity };
      }
    }
  } else if (c) {
    S.pend = null;
    trackDip(S, c, fr);
    if (++S.silent >= 3) closeSeg(S);
  }
}

/* ---------- Ornaments and transients ---------- */
export const HARMONICS = [12, 19, 24, 28]; // semitones to the 2nd, 3rd, 4th and 5th partials

// A slide: the pitch rises continuously into a note from a semitone or two below. The rising part
// shows up as its own short segment; fold it into the target note, which then starts where the
// slide began and is marked slide = true.
function isSlideInto(x, n) {
  if (!x || x.art || n.start - x.end > 0.03) return false;
  const up = n.midi - x.midi;
  if (up < 1 || up > 2 || x.dur > 0.16 || !x.fs) return false;
  const f = x.fs, rise = f[f.length - 1] - f[0];
  // The pitch must keep rising through the middle of the piece. A real short note is flat there, even
  // when its first or last frame catches the move from or to a neighbour.
  const a = Math.floor(f.length / 4), b = Math.max(a + 1, Math.ceil(f.length * 3 / 4) - 1);
  const midRise = f[Math.min(b, f.length - 1)] - f[a];
  // a tongued start is allowed (the tongue can begin a slide) but must rise more clearly
  return rise >= (x.tongued ? 0.4 : 0.3) && rise / x.dur >= 3 && midRise >= 0.15 && f[f.length - 1] >= n.midi - 1.5;
}
function findSlides(segs) {
  for (let i = segs.length - 1; i > 0; i--) {
    const n = segs[i];
    if (n.art) continue;
    let j = i - 1, from = null;
    let tongued = false; const parts = [];
    while (j >= 0 && isSlideInto(segs[j], n) && n.midi - segs[j].midi <= 2) { from = segs[j].start; tongued = segs[j].tongued; parts.push(segs[j]); j--; }
    // and the frame or two where the slide first became audible
    while (from != null && j >= 0 && !segs[j].art && segs[j].dur <= 0.015 && from - segs[j].end < 0.02 &&
           segs[j].midi <= parts[parts.length - 1].midi && n.midi - segs[j].midi <= 2) { from = segs[j].start; parts.push(segs[j]); j--; }
    // A slide takes 50–200 ms. The window crossing an ordinary note change glides for only a frame or two.
    if (from != null && n.start - from < 0.045) from = null;
    if (from == null) continue;
    for (const x of parts) x.art = "slide";
    n.slide = true; n.slideFrom = n.start; n.start = from; n.dur = n.end - n.start;
    if (tongued) { n.wasTongued = n.tongued; n.tongued = true; }
  }
}

// A glide is the pitch passing through on its way somewhere, not a note the player meant:
// the overlap of one note's echo with the next, a flat-starting attack, or a release sagging flat.
// Cuts sit above the note and taps sit between two copies of the same note, so neither matches.
function isGlide(s, p, n) {
  const near = (a, gap) => a && gap >= -0.01 && gap < 0.04;
  const P = near(p, p && s.start - p.end) ? p : null, N = near(n, n && n.start - s.end) ? n : null;
  if (P && N && P.midi !== N.midi) {
    const between = (s.midi - P.midi) * (s.midi - N.midi) < 0;
    if (between && ((Math.abs(s.midi - P.midi) <= 1 && Math.abs(s.midi - N.midi) <= 1) || !s.inScale)) return true;
  }
  const quietBefore = !p || s.start - p.end > 0.06, quietAfter = !n || n.start - s.end > 0.06;
  if (N && quietBefore && s.midi === N.midi - 1) return true;   // attack scooping up from flat
  if (P && quietAfter && s.midi === P.midi - 1) return true;    // release sagging flat
  return false;
}

/**
 * Label segments in place: kind ("note" | "grace"), orn ("cut" | "tap"), roll (1 first, 2 inner, 3 last),
 * art ("sliver" | "overtone" | "glide" | "slide" for transients that are not real notes),
 * slide (true when the note was slid into; its start then includes the slide), inScale. Returns the same array.
 */
export function annotate(all, settings = DEFAULT_SETTINGS) {
  let segs = all;
  const gms = settings.grace / 1000;
  for (const s of segs) {
    if (s.slideFrom != null) { s.start = s.slideFrom; s.dur = s.end - s.start; if (s.wasTongued != null) s.tongued = s.wasTongued; } // undo an earlier pass
    s.wasTongued = null;
    s.kind = s.dur <= gms ? "grace" : "note"; s.orn = null; s.roll = 0; s.art = null; s.slide = false; s.slideFrom = null;
    s.inScale = noteInfo(s.midi).inScale;
  }
  findSlides(segs);
  segs = segs.filter(s => !s.art);
  for (const s of segs) s.kind = s.dur <= gms ? "grace" : "note";
  // Transients: a short blip at a harmonic of a neighbouring note (overblown attack or release),
  // or a sliver at the same pitch as a neighbouring note. Neither is a real ornament.
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]; if (s.kind !== "grace") continue;
    const p = segs[i - 1], n = segs[i + 1];
    const pn = p && p.kind === "note" && s.start - p.end < 0.06 ? p : null;
    const nn = n && n.kind === "note" && n.start - s.end < 0.06 ? n : null;
    if (s.dur <= 0.03 && ((pn && pn.midi === s.midi) || (nn && nn.midi === s.midi))) { s.art = "sliver"; continue; }
    const harm = a => a && HARMONICS.some(h => s.midi - a.midi === h); // overblowing lands right on a partial
    if (harm(nn) || harm(pn)) { s.art = "overtone"; continue; }
    if (isGlide(s, segs[i - 1], segs[i + 1])) s.art = "glide";
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
/**
 * The low cut in front of the detector. Nothing the instrument plays is below its bottom note, but a
 * backing drum's boom, room rumble and handling noise are, and a drum stroke landing with a note
 * would otherwise muddy the very analysis window that note starts in. The cut-off sits at 3/4 of the
 * bottom note's frequency: 440 Hz for a D whistle, 220 Hz for a flute an octave down.
 */
export const lowCutHz = settings => 0.75 * (settings.a4 || 440) * Math.pow(2, (LOW_D - 69) / 12);

/** A 4th-order Butterworth high-pass that keeps its state between blocks: block → filtered copy. */
export function makeLowCut(sr, fc) {
  const stages = [0.5412, 1.3066].map(Q => {
    const w = 2 * Math.PI * fc / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Q), a0 = 1 + al;
    return { b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: -2 * c / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  });
  return block => {
    const out = Float32Array.from(block);
    for (const f of stages) {
      for (let i = 0; i < out.length; i++) {
        const x = out[i], y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
        f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y; out[i] = y;
      }
    }
    return out;
  };
}

export function analyze(samples, sr, settings = { ...DEFAULT_SETTINGS }) {
  const S = makeSession(settings), win = new Float32Array(WIN);
  const x = makeLowCut(sr, lowCutHz(settings))(samples);
  for (let pos = 0; pos + HOP <= x.length; pos += HOP) {
    win.copyWithin(0, HOP);
    win.set(x.subarray(pos, pos + HOP), WIN - HOP);
    feed(S, (pos + HOP) / sr - WIN / (2 * sr), win, sr);
  }
  closeSeg(S);
  annotate(S.segs, settings);
  return S;
}
