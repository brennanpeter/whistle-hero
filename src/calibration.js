// Calibration: fit the detector and the game's timing to the player's room, microphone and whistle.
// The page that runs it is calibrate.html; the game and Whistle Ear read the saved result.
//
//   noiseGate(dbs)                 quiet-room frame levels → a gate just above the room's noise
//   whistleTuning(frames)          frames of a held note → how sharp or flat the whistle is
//   latencyFrom(scheduled, heard)  click times and the onsets heard after them → the delay to allow for
//
// Pure functions (no audio, no DOM) so they're tested in Node.

export const STORE = "whistle-hero-calibration";

/** { gateDb, noiseDb, a4, cents, latencyMs, latencyMethod, mic, date } or null. */
export function loadCalibration() {
  try { const c = JSON.parse(localStorage.getItem(STORE) || "null"); if (c && typeof c === "object") return c; } catch (e) {}
  return null;
}
export function saveCalibration(c) {
  try { localStorage.setItem(STORE, JSON.stringify({ ...c, date: new Date().toISOString() })); return true; } catch (e) { return false; }
}
export function clearCalibration() { try { localStorage.removeItem(STORE); } catch (e) {} }

/** Detector settings with the calibration applied on top of the defaults. */
export function calibratedSettings(defaults, cal = loadCalibration()) {
  const s = { ...defaults };
  if (cal && Number.isFinite(cal.gateDb)) s.gate = cal.gateDb;
  if (cal && Number.isFinite(cal.a4)) s.a4 = cal.a4;
  return s;
}

const quantile = (xs, q) => {
  const a = xs.slice().sort((x, y) => x - y);
  if (!a.length) return NaN;
  const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
};
export const median = xs => quantile(xs, 0.5);

export const GATE_MARGIN = 8;         // dB above the room's noise
export const GATE_MIN = -70, GATE_MAX = -30;

/**
 * Noise gate from a few seconds of quiet. Uses the 90th percentile of the frame levels so a cough
 * or a chair creak doesn't set the gate, then adds a margin. Returns { noiseDb, gateDb }.
 */
export function noiseGate(dbs) {
  const finite = dbs.filter(Number.isFinite);
  if (finite.length < 10) return null;
  const noiseDb = quantile(finite, 0.9);
  const gateDb = Math.round(Math.min(GATE_MAX, Math.max(GATE_MIN, noiseDb + GATE_MARGIN)));
  return { noiseDb: +noiseDb.toFixed(1), gateDb };
}

/**
 * Tuning from frames of a held note, measured against A = 440 (frames: [{ midiF, db }], voiced only).
 * Takes the steadiest stretch: drops the first and last fifth (attack and release), then the median.
 * Any whistle note works; low D is steadiest. Returns { cents, a4, midi, levelDb, spread } or null
 * when there isn't a clear, steady note.
 */
export function whistleTuning(frames) {
  const v = frames.filter(f => f && Number.isFinite(f.midiF));
  if (v.length < 40) return null; // under about a quarter of a second of clear pitch
  const core = v.slice(Math.floor(v.length * 0.2), Math.ceil(v.length * 0.8));
  const m = median(core.map(f => f.midiF));
  const midi = Math.round(m);
  const same = core.filter(f => Math.round(f.midiF) === midi);
  if (same.length < core.length * 0.7) return null; // wandered between notes
  const cents = 100 * (median(same.map(f => f.midiF)) - midi);
  const spread = 100 * (quantile(same.map(f => f.midiF), 0.9) - quantile(same.map(f => f.midiF), 0.1));
  const levelDb = median(same.map(f => f.db));
  return { cents: +cents.toFixed(1), a4: +(440 * Math.pow(2, cents / 1200)).toFixed(2), midi, levelDb: +levelDb.toFixed(1), spread: +spread.toFixed(1) };
}

/**
 * Latency from clicks and what was heard. For each scheduled time, take the first onset heard
 * within the window after it (speakers: the beep coming back through the mic) or nearest to it
 * (play-along: the player may land a little early). Returns { ms, spreadMs, matched, of } or null
 * if fewer than `need` clicks were answered.
 */
export function latencyFrom(scheduled, heard, { mode = "speakers", window = 0.45, need = 5 } = {}) {
  const used = new Set(), delays = [];
  for (const s of scheduled) {
    let best = null;
    heard.forEach((h, i) => {
      if (used.has(i)) return;
      const d = h - s;
      const ok = mode === "speakers" ? d >= 0 && d <= window : Math.abs(d) <= window;
      if (ok && (best === null || Math.abs(d) < Math.abs(heard[best] - s))) best = i;
    });
    if (best !== null) { used.add(best); delays.push(heard[best] - s); }
  }
  if (delays.length < need) return null;
  const ms = median(delays) * 1000;
  const spreadMs = (quantile(delays, 0.75) - quantile(delays, 0.25)) * 1000;
  return { ms: Math.round(ms), spreadMs: Math.round(spreadMs), matched: delays.length, of: scheduled.length };
}

/**
 * A quick sanity check of a few seconds of microphone audio (the mic check on the Calibrate page).
 * Levels are in the detector's dB (RMS over ~23 ms windows), so they compare with the noise gate.
 * Returns the levels plus a list of problems in plain words:
 *   silent — nothing at all came through (a muted or disconnected mic)
 *   noisy  — even the quietest moments are loud: usually a mic turned up too far (or a loud room)
 *   quiet  — nothing loud happened: the wrong mic, or turned down too far
 *   clip   — the loudest moments hit the top and distorted: turn the mic down
 */
export const CHECK_NOISY_DB = -45, CHECK_QUIET_DB = -40, CLIP_LEVEL = 0.985;
export function micCheck(samples, sr, win = 1024) {
  const dbs = [];
  let peak = 0, clipped = 0, nonzero = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    if (a >= CLIP_LEVEL) clipped++;
    if (a > 1e-7) nonzero++;
  }
  for (let i = 0; i + win <= samples.length; i += win) {
    let e = 0; for (let k = i; k < i + win; k++) e += samples[k] * samples[k];
    dbs.push(20 * Math.log10(Math.sqrt(e / win) + 1e-9));
  }
  const quietDb = dbs.length ? quantile(dbs, 0.1) : -180, loudDb = dbs.length ? quantile(dbs, 0.98) : -180;
  const peakDb = 20 * Math.log10(peak + 1e-9);
  const problems = [];
  if (nonzero < samples.length * 0.01 || loudDb < -100) problems.push("silent");
  else {
    if (quietDb > CHECK_NOISY_DB) problems.push("noisy");
    if (loudDb < CHECK_QUIET_DB) problems.push("quiet");
    if (clipped >= Math.max(3, sr * 0.0005)) problems.push("clip");
  }
  return { seconds: samples.length / sr, quietDb, loudDb, peakDb, clipped, problems };
}
