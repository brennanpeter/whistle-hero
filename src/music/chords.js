// Chords for the backing guitar: chord symbols, keys and modes, guitar voicings, and automatic
// chords for tunes whose ABC has none.
//
//   parseChordSymbol("Bm7", transpose)   { root, quality, seventh, bass, name } or null
//   keyInfo("Ador")                      { tonic, mode, scale }
//   voicing(chord)                       MIDI notes for a strum, lowest first
//   autoChords(parsed)                   [{ pos, chord }] chord changes, in whole notes from the start
//   chordTrack(parsed)                   the tune's own chords (from its ABC) or automatic ones
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const mod = (a, n = 12) => ((a % n) + n) % n;
const acc = s => (s === "#" || s === "♯" ? 1 : s === "b" || s === "♭" ? -1 : 0);

export const QUALITIES = {
  maj: [0, 4, 7], min: [0, 3, 7], "5": [0, 7], sus4: [0, 5, 7], sus2: [0, 2, 7], dim: [0, 3, 6],
};
const SUFFIX = { maj: "", min: "m", "5": "5", sus4: "sus4", sus2: "sus2", dim: "dim" };

/** A chord's name, sharps or flats as asked: "F#m7", "Bb", "D/F#". */
export function chordName(c, flats = false) {
  const N = flats ? FLAT : SHARP;
  return N[c.root] + SUFFIX[c.quality] + (c.seventh === "maj7" ? "maj7" : c.seventh ? "7" : "") + (c.bass != null && c.bass !== c.root ? "/" + N[c.bass] : "");
}

/**
 * A chord symbol from ABC ("G", "Em", "D7", "A/C#", "Bm7", "Dsus4", "D5", "Gmaj7"), moved by
 * `transpose` semitones, or null if the text isn't a chord (an annotation like "^A part").
 */
export function parseChordSymbol(text, transpose = 0) {
  const m = /^\s*([A-G])([#b♯♭]?)([^/\s]*)(?:\/([A-G])([#b♯♭]?))?\s*$/.exec(text);
  if (!m) return null;
  const q = m[3];
  let quality, seventh = null;
  if (/^(maj7|M7|Δ7?)$/.test(q)) { quality = "maj"; seventh = "maj7"; }
  else if (/^(m|min|-)(7)?$/.test(q)) { quality = "min"; if (/7$/.test(q)) seventh = "7"; }
  else if (/^(dim|°|o)7?$/.test(q)) quality = "dim";
  else if (/^sus2$/.test(q)) quality = "sus2";
  else if (/^(sus|sus4|7sus4?)$/.test(q)) { quality = "sus4"; if (/^7/.test(q)) seventh = "7"; }
  else if (/^5$/.test(q)) quality = "5";
  else if (/^(|maj|M|6|7|9|add9|add2)$/.test(q)) { quality = "maj"; if (/^(7|9)$/.test(q)) seventh = "7"; }
  else return null;
  const root = mod(PC[m[1]] + acc(m[2]) + transpose);
  const bass = m[4] ? mod(PC[m[4]] + acc(m[5]) + transpose) : null;
  return { root, quality, seventh, bass, name: chordName({ root, quality, seventh, bass }, /b|♭/.test(m[2] + (m[5] || ""))) };
}

/** The chord's pitch classes. */
export const chordTones = c => {
  const t = QUALITIES[c.quality].map(i => mod(c.root + i));
  if (c.seventh) t.push(mod(c.root + (c.seventh === "maj7" ? 11 : 10)));
  return t;
};

const MODES = {
  maj: [0, 2, 4, 5, 7, 9, 11], mix: [0, 2, 4, 5, 7, 9, 10], dor: [0, 2, 3, 5, 7, 9, 10],
  min: [0, 2, 3, 5, 7, 8, 10], lyd: [0, 2, 4, 6, 7, 9, 11], phr: [0, 1, 3, 5, 7, 8, 10], loc: [0, 1, 3, 5, 6, 8, 10],
};
/** A key string ("D", "Ador", "Em", "Amix", "Bb") as its tonic, mode and scale. */
export function keyInfo(key) {
  const m = /^\s*([A-G])([#b]?)\s*([A-Za-z]*)/.exec(key || "D") || [0, "D", "", ""];
  const tonic = mod(PC[m[1]] + acc(m[2])), w = m[3].toLowerCase();
  const mode = /^(m|min|minor|aeo)/.test(w) && !/^mix/.test(w) ? "min" : /^mix/.test(w) ? "mix" : /^dor/.test(w) ? "dor"
    : /^lyd/.test(w) ? "lyd" : /^phr/.test(w) ? "phr" : /^loc/.test(w) ? "loc" : "maj";
  return { tonic, mode, scale: MODES[mode].map(i => mod(tonic + i)), flats: /b/.test(m[2]) || [5, 10, 3, 8, 1].includes(tonic) && mode === "maj" };
}

/**
 * The chords a backing player reaches for in a key: the triads built on the mode's scale, minus the
 * diminished one, the home chord first. (Em: Em G Am Bm C D; D: D Em F#m G A Bm; Ador: Am C D Em G.)
 */
export function keyChords(key) {
  const k = keyInfo(key), s = MODES[k.mode], out = [];
  for (let d = 0; d < 7; d++) {
    const third = mod(s[(d + 2) % 7] - s[d]), fifth = mod(s[(d + 4) % 7] - s[d]);
    if (fifth !== 7) continue; // the diminished triad
    out.push({ root: mod(k.tonic + s[d]), quality: third === 4 ? "maj" : "min", seventh: null, bass: null, degree: d });
  }
  out.forEach(c => { c.name = chordName(c, k.flats); });
  return out;
}

/**
 * A guitar voicing in the open-tuning (DADGAD) style of Irish backing: the low strings carry the
 * chord's root, the top strings ring the key's drones (its home note and fifth: G and D in G).
 *   bass: the root (or the slash bass), between A2 and G#3
 *   top:  the drones, between G3 and F#4, plus the chord's third and fifth where they fit. A drone a
 *         semitone from the third drops the third (the open, suspended sound); a drone a semitone
 *         from the root or fifth is left out.
 * Everything stays below about F#4, so the strings' own notes sit under a D whistle's range.
 * Returns { bass: [midi], top: [midi] }.
 */
export function voicing(c, key = null) {
  const tones = chordTones(c), third = QUALITIES[c.quality].find(i => i === 3 || i === 4);
  const thirdPc = third != null ? mod(c.root + third) : null, fifthPc = QUALITIES[c.quality].includes(7) ? mod(c.root + 7) : null;
  const near = (a, b) => mod(a - b) === 1 || mod(b - a) === 1;
  const k = key ? keyInfo(key) : { tonic: c.root, scale: [] };
  const place = pc => { let n = 55; while (mod(n) !== pc) n++; return n; }; // G3 up to F#4
  let drones = [k.tonic, mod(k.tonic + 7)].filter(pc => !near(pc, c.root) && (fifthPc == null || !near(pc, fifthPc)));
  const keepThird = thirdPc != null && !drones.some(pc => near(pc, thirdPc));
  const top = new Set(drones.map(place));
  if (keepThird) top.add(place(thirdPc));
  if (fifthPc != null && top.size < 3) top.add(place(fifthPc));
  if (top.size < 2) top.add(place(c.root));
  if (c.seventh && top.size < 4) top.add(place(tones[tones.length - 1]));
  return { bass: [45 + mod((c.bass ?? c.root) - 9)], top: [...top].sort((a, b) => a - b) };
}

/**
 * Automatic chords for a tune: one chord for each half bar (each bar in 3/4, 9/8 and 2/4), chosen from
 * the key's chords to fit the melody. Notes on the beat and long notes count most; chord tones score,
 * other notes cost a little; changing chord costs a little too, so it doesn't change for one passing
 * note. It starts and ends on the home chord. Returns chord changes as [{ pos, chord }].
 */
export function autoChords(parsed, meterInfo) {
  const cands = keyChords(parsed.key), home = cands[0];
  const mi = meterInfo(parsed.meter);
  const perBar = mi.beatsPerBar % 2 === 0 && mi.beatsPerBar > 2 ? 2 : mi.beatsPerBar === 2 && mi.barLen > 0.5 ? 2 : 1;
  const bars = parsed.bars.map(b => b.pos).concat(parsed.length);
  // slots: the halves (or wholes) of each full bar; a pickup gets no chord (the band comes in on the downbeat)
  const slots = [];
  for (let k = 0; k < bars.length - 1; k++) {
    const a = bars[k], b = bars[k + 1], len = b - a;
    if (len < mi.barLen - 1e-9 && k === 0) continue;
    const n = len >= mi.barLen - 1e-9 ? perBar : 1;
    for (let j = 0; j < n; j++) slots.push({ from: a + (j * len) / n, to: a + ((j + 1) * len) / n });
  }
  if (!slots.length) return [];
  const notes = parsed.events.filter(e => e.t === "note");
  const fit = slots.map(s => cands.map(c => {
    const tones = chordTones(c);
    let score = 0;
    for (const e of notes) {
      const a = Math.max(e.pos, s.from), b = Math.min(e.pos + e.len, s.to);
      if (b <= a) continue;
      const w = (b - a) * (Math.abs(e.pos - s.from) < 1e-9 ? 3 : Math.abs((e.pos / mi.beatLen) % 1) < 1e-9 ? 1.6 : 1);
      score += tones.includes(mod(e.midi)) ? w : -0.35 * w;
    }
    return score / (s.to - s.from);
  }));
  // best path (Viterbi): fit, minus a cost for each change, home chord at both ends
  // the home chord and the chords a fourth and a fifth from it (and the flat seventh, in the modes) are
  // what backing players lean on; the others need the melody to ask for them
  const prior = cands.map(c => {
    const iv = mod(c.root - home.root);
    return iv === 0 ? 0.6 : iv === 5 || iv === 7 ? 0.35 : iv === 10 ? 0.3 : iv === 3 || iv === 9 ? 0.1 : 0;
  });
  fit.forEach(row => row.forEach((v, j) => { row[j] = v + prior[j]; }));
  const CHANGE = 0.6, n = slots.length, best = fit.map(() => cands.map(() => -Infinity)), from = fit.map(() => cands.map(() => 0));
  cands.forEach((c, j) => { best[0][j] = fit[0][j] + (j === 0 ? 1 : 0); });
  for (let i = 1; i < n; i++) cands.forEach((c, j) => {
    cands.forEach((_, k) => {
      const v = best[i - 1][k] + fit[i][j] - (k === j ? 0 : CHANGE) + (j === 0 ? 0.05 : 0);
      if (v > best[i][j]) { best[i][j] = v; from[i][j] = k; }
    });
  });
  let j = 0; // end on the home chord
  const path = new Array(n);
  for (let i = n - 1; i >= 0; i--) { path[i] = j; j = from[i][j]; }
  const out = [];
  path.forEach((k, i) => { if (!out.length || out[out.length - 1].chord !== cands[k]) out.push({ pos: slots[i].from, chord: cands[k] }); });
  return out.map(x => ({ pos: x.pos, chord: { ...x.chord } }));
}

/**
 * The tune's chords: the chord symbols in its ABC if it has some, else automatic ones.
 * Returns { source: "abc" | "auto", changes: [{ pos, chord }] }.
 */
export function chordTrack(parsed, meterInfo) {
  const written = parsed.events.filter(e => e.chord).map(e => ({ pos: e.pos, chord: e.chord }));
  if (written.length) return { source: "abc", changes: written };
  return { source: "auto", changes: autoChords(parsed, meterInfo) };
}
