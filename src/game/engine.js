// The game engine: judges what the player plays against a chart. No DOM, no audio — it is fed
// note events (from the live detector, or from a recording in tests) and the current game time,
// and every view (finger holes, sheet music, …) draws from the same state.
//
//   const game = createGame(chart);
//   game.onset(midi, t);   // a note started at game time t (seconds; latency already removed)
//   game.grace(midi, t);   // a cut or tap was heard
//   game.tick(t);          // call every frame: notes whose window has passed become misses
//   game.state             // score, combo, counts …   game.notes / game.ornaments carry results
//   game.on(fn)            // fn(event) for each judgment, for views and sounds

export const WINDOWS = { perfect: 0.045, good: 0.09, ok: 0.14 }; // seconds either side of the note
export const ORNAMENT_WINDOW = 0.1;
export const POINTS = { perfect: 100, good: 70, ok: 40, ornament: 50 };
const MAX_MULTIPLIER = 4, COMBO_STEP = 10;

export function grade(dt) {
  const a = Math.abs(dt);
  return a <= WINDOWS.perfect ? "perfect" : a <= WINDOWS.good ? "good" : a <= WINDOWS.ok ? "ok" : null;
}

export function createGame(chart) {
  const notes = chart.notes.map(n => ({ ...n, result: null, offset: null }));
  const ornaments = chart.ornaments.map(o => ({ ...o, result: null }));
  const state = {
    score: 0, combo: 0, maxCombo: 0, multiplier: 1,
    counts: { perfect: 0, good: 0, ok: 0, miss: 0, wrong: 0 },
    ornamentsHit: 0, ornamentsMissed: 0,
    offsets: [], // timing of every hit, to tell the player if they run early or late
    lastJudged: -1,
  };
  const listeners = [];
  const emit = e => { for (const f of listeners) f(e); };
  let sweep = 0, osweep = 0; // first note / ornament that might still be unjudged

  const effectiveTime = n => n.expect ?? n.t; // a cut or slide puts the main pitch a little after the beat
  const LOOKAHEAD = 0.2;

  function onset(midi, t) {
    let best = null, nearest = null;
    for (let i = sweep; i < notes.length; i++) {
      const n = notes[i];
      if (n.t - WINDOWS.ok > t + LOOKAHEAD) break;
      if (n.result) continue;
      const dt = t - effectiveTime(n);
      if (Math.abs(dt) > WINDOWS.ok) continue;
      if (!nearest || Math.abs(dt) < Math.abs(t - effectiveTime(nearest))) nearest = n;
      if (n.midi === midi && (!best || Math.abs(dt) < Math.abs(t - effectiveTime(best)))) best = n;
    }
    if (best) {
      const dt = t - effectiveTime(best), g = grade(dt);
      best.result = g; best.offset = dt;
      state.counts[g]++; state.offsets.push(dt);
      state.combo++; state.maxCombo = Math.max(state.maxCombo, state.combo);
      state.multiplier = Math.min(MAX_MULTIPLIER, 1 + Math.floor(state.combo / COMBO_STEP));
      const points = POINTS[g] * state.multiplier;
      state.score += points; state.lastJudged = best.id;
      emit({ type: "hit", note: best, grade: g, offset: dt, points, t });
      return best;
    }
    if (nearest) {
      // A wrong note is shown but doesn't break the combo: the player may still correct it inside
      // the window, and the detector's occasional transient shouldn't cost them their streak.
      state.counts.wrong++;
      const octave = (midi - nearest.midi) % 12 === 0;
      emit({ type: "wrong", note: nearest, midi, octave, t });
    }
    return null;
  }

  function grace(midi, t) {
    let best = null;
    for (let i = osweep; i < ornaments.length; i++) {
      const o = ornaments[i];
      if (o.t - ORNAMENT_WINDOW > t) break;
      if (o.result || o.midi !== midi || Math.abs(o.t - t) > ORNAMENT_WINDOW) continue;
      if (!best || Math.abs(o.t - t) < Math.abs(best.t - t)) best = o;
    }
    if (!best) return null;
    best.result = "hit"; state.ornamentsHit++;
    const points = POINTS.ornament * state.multiplier;
    state.score += points;
    emit({ type: "ornament", ornament: best, points, t });
    return best;
  }

  function tick(t) {
    while (sweep < notes.length && (notes[sweep].result || effectiveTime(notes[sweep]) + WINDOWS.ok < t)) {
      const n = notes[sweep];
      if (!n.result) {
        n.result = "miss"; state.counts.miss++;
        state.combo = 0; state.multiplier = 1; state.lastJudged = n.id;
        emit({ type: "miss", note: n, t });
      }
      sweep++;
    }
    while (osweep < ornaments.length && (ornaments[osweep].result || ornaments[osweep].t + ORNAMENT_WINDOW < t)) {
      const o = ornaments[osweep];
      if (!o.result) { o.result = "miss"; state.ornamentsMissed++; emit({ type: "ornament-miss", ornament: o, t }); }
      osweep++;
    }
  }

  const finished = t => t > chart.duration + WINDOWS.ok;

  function summary() {
    const c = state.counts, judged = c.perfect + c.good + c.ok + c.miss;
    const acc = judged ? (c.perfect + 0.7 * c.good + 0.4 * c.ok) / judged : 0;
    const offs = state.offsets, mean = offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length : 0;
    const maxScore = notes.reduce((a, _, i) => a + POINTS.perfect * Math.min(MAX_MULTIPLIER, 1 + Math.floor((i + 1) / COMBO_STEP)), 0)
      + ornaments.length * POINTS.ornament * MAX_MULTIPLIER;
    return {
      score: state.score, maxScore, accuracy: acc, notes: notes.length, hit: c.perfect + c.good + c.ok,
      ...c, maxCombo: state.maxCombo, ornaments: ornaments.length, ornamentsHit: state.ornamentsHit,
      meanOffset: mean, // seconds; positive = the player tends to be late
      stars: acc >= 0.95 ? 5 : acc >= 0.85 ? 4 : acc >= 0.7 ? 3 : acc >= 0.5 ? 2 : acc > 0 ? 1 : 0,
    };
  }

  return { chart, notes, ornaments, state, onset, grace, tick, finished, summary, on: f => listeners.push(f) };
}

/**
 * Turn a finished detector session into the events a live game would have received, in time order.
 * Used by the tests and for scoring a recording. Mirrors the live adapter: a note is reported when it
 * starts (a slide when it lands), and short segments are reported as cuts or taps.
 */
export function eventsFromSession(S, offset = 0) {
  const ev = [];
  for (const s of S.segs) {
    if (s.art) continue;
    if (s.kind === "grace") ev.push({ type: "grace", midi: s.midi, t: s.start - offset });
    else ev.push({ type: "onset", midi: s.midi, t: (s.slideFrom ?? s.start) - offset });
  }
  return ev.sort((a, b) => a.t - b.t);
}

/** Feed a list of events through a game, ticking as time passes. Returns the summary. */
export function replay(game, events) {
  for (const e of events) { game.tick(e.t); if (e.type === "onset") game.onset(e.midi, e.t); else game.grace(e.midi, e.t); }
  game.tick(Infinity);
  return game.summary();
}
