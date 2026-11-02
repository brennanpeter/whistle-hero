// Write a parsed tune back out as ABC, played out from start to finish (repeats and endings
// expanded, transposition applied) on a single line. The sheet music view draws this with abcjs,
// so every note on the staff lines up one-to-one with a note in the game's chart.
//
//   const { abc, pieces } = writeAbc(parseAbc(text, { transpose }));
//   pieces[i] = how many noteheads note i became (more than one when it's tied across a bar
//   or split into lengths a single note can't show), in the order abcjs draws them.
import { keySignature } from "./abc.js";
import { meterInfo } from "../chart/chart.js";

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"], NATURAL = [0, 2, 4, 5, 7, 9, 11];
const SHARP_KEYS = ["C", "G", "D", "A", "E", "B", "F#", "C#"], FLAT_KEYS = ["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"];
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const mod = (a, n) => ((a % n) + n) % n;
const EPS = 1e-9;

/** The key a tune is in after transposing it: "Ador" up a tone is "Bdor". */
export function transposeKey(key, semitones) {
  const m = /^\s*([A-G])([#b]?)\s*(.*)$/.exec(key || "D");
  if (!m || !semitones) return (key || "D").trim();
  const mode = m[3].trim();
  const pc = mod(PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + semitones, 12);
  // of the names for this pitch, pick the one whose key signature has the fewest sharps or flats
  let best = null;
  for (const name of [...SHARP_KEYS, ...FLAT_KEYS]) {
    const p = mod(PC[name[0]] + (name[1] === "#" ? 1 : name[1] === "b" ? -1 : 0), 12);
    if (p !== pc) continue;
    const ks = keySignature(name + mode);
    if (ks.warn) continue;
    const n = Object.keys(ks.acc).length;
    if (!best || n < best.n) best = { name, n };
  }
  return best ? best.name + mode : (key || "D").trim();
}

// note lengths a single notehead can show, in sixteenths (L:1/16): whole, dotted half, half, …
const SINGLE = [32, 24, 16, 12, 8, 6, 4, 3, 2, 1];
function splitLength(u) {
  const out = [];
  let left = Math.round(u);
  while (left > 0) { const s = SINGLE.find(x => x <= left); out.push(s); left -= s; }
  return out.length ? out : [1];
}

// Spell a sounding pitch in a key: in-key notes take the key's letter, others the nearest
// natural, else a sharp (a flat in flat keys). Octave is written (C4 = middle C).
function spellIn(sounding, ks, flats) {
  const p = sounding - 12, pc = mod(p, 12);
  let letter = null, acc = 0;
  for (let l = 0; l < 7 && letter === null; l++) if (mod(NATURAL[l] + (ks[LETTERS[l]] || 0), 12) === pc) { letter = LETTERS[l]; acc = ks[letter] || 0; }
  for (let l = 0; l < 7 && letter === null; l++) if (NATURAL[l] === pc) { letter = LETTERS[l]; acc = 0; }
  for (let l = 0; l < 7 && letter === null; l++) {
    if (!flats && mod(NATURAL[l] + 1, 12) === pc) { letter = LETTERS[l]; acc = 1; }
    if (flats && mod(NATURAL[l] - 1, 12) === pc) { letter = LETTERS[l]; acc = -1; }
  }
  return { letter, acc, octave: Math.floor((p - acc) / 12) - 1 };
}

/**
 * Where a sounding pitch sits on the staff in `key`: `step` counts lines and spaces up from
 * middle C (as abcjs numbers them: E4, the bottom line, is 2), and `acc` is the accidental to
 * show beside it (null when the key signature already covers it).
 */
export function staffPlace(sounding, key) {
  const ks = keySignature(key).acc, flats = Object.values(ks).some(v => v < 0);
  const { letter, acc, octave } = spellIn(sounding, ks, flats);
  const step = (octave - 4) * 7 + LETTERS.indexOf(letter);
  return { step, letter, acc: acc === (ks[letter] || 0) ? null : acc };
}

export function writeAbc(parsed, { label = null } = {}) {
  const key = transposeKey(parsed.key, parsed.transpose || 0);
  const ks = keySignature(key).acc;
  const flats = Object.values(ks).some(v => v < 0);
  const mi = meterInfo(parsed.meter);
  const barStarts = parsed.bars.map(b => b.pos);
  let barAcc = {};

  // a pitch (written: sounding − 1 octave, as whistle music is written) as an ABC note name
  const spell = (sounding, isGrace = false) => {
    const { letter, acc, octave } = spellIn(sounding, ks, flats);
    const id = letter + octave, shown = id in barAcc ? barAcc[id] : (ks[letter] || 0);
    let txt = acc === shown ? "" : acc === 1 ? "^" : acc === -1 ? "_" : acc === 2 ? "^^" : acc === -2 ? "__" : "=";
    if (!isGrace && txt) barAcc[id] = acc;
    txt += octave >= 5 ? letter.toLowerCase() + "'".repeat(octave - 5) : letter + ",".repeat(4 - octave);
    return txt;
  };

  const out = [], pieces = [];
  // the next bar line: a double bar where a part or a repeat pass begins
  const barLineText = () => {
    const b = parsed.bars[nextBar], prev = parsed.bars[nextBar - 1];
    nextBar++; barAcc = {};
    return b.part !== prev.part || b.pass !== prev.pass ? " || " : " | ";
  };
  let nextBar = 1, tupletCount = 0, lastPart = -1, lastPass = 0, first = true;
  for (const e of parsed.events) {
    // bar lines (a double bar where a part or a repeat pass begins)
    while (nextBar < barStarts.length && e.pos >= barStarts[nextBar] - EPS) out.push(barLineText());
    // space at each beat, so notes beam in beats
    if (Math.abs(e.pos / mi.beatLen - Math.round(e.pos / mi.beatLen)) < EPS) out.push(" ");
    let pre = "";
    if (e.t === "note" && (e.part !== lastPart || e.pass !== lastPass)) {
      const name = String.fromCharCode(65 + e.part) + (e.pass === 2 ? " again" : "");
      pre += `"^${first && label ? label + "  " : ""}${name}"`;
      lastPart = e.part; lastPass = e.pass; first = false;
    }
    const units = e.len * 16;
    // the note's stretches between bar lines that fall inside it (a note tied over a bar line)
    const segs = [];
    let lengths = null, tuplet = false;
    if (Math.abs(units - Math.round(units)) < 1e-6) {
      let at = e.pos, left = Math.round(units);
      for (let b = nextBar; b < barStarts.length && barStarts[b] < e.pos + e.len - EPS; b++) {
        const u = Math.round((barStarts[b] - at) * 16);
        if (u <= 0 || u >= left) break;
        segs.push(u); left -= u; at = barStarts[b];
      }
      segs.push(left);
    } else if (Math.abs(units * 1.5 - Math.round(units * 1.5)) < 1e-6) {
      tuplet = true; lengths = [Math.round(units * 1.5)]; // a triplet: three of these in the time of two
    } else lengths = [Math.max(1, Math.round(units))];
    if (tuplet) { if (tupletCount % 3 === 0) out.push("(3"); tupletCount++; } else tupletCount = 0;

    if (e.t === "rest") {
      out.push((lengths || segs).map((u, k) => (k && !lengths ? barLineText() : "") + splitLength(u).map(v => "z" + (v === 1 ? "" : v)).join("")).join(""));
      continue;
    }
    if (e.roll) pre += "~";
    if (e.slide) pre += "!slide!";
    if (e.graces.length) pre += "{" + e.graces.map(g => spell(g, true)).join("") + "}";
    let txt = pre, count = 0;
    (lengths ? [lengths[0]] : segs).forEach((seg, k) => {
      if (k) txt += "-" + barLineText();          // the bar line inside a tied note
      const name = spell(e.midi), bare = name.replace(/^[_^=]+/, "");
      const parts = lengths ? lengths : splitLength(seg);
      // within a bar, ties carry the accidental, so later pieces don't repeat it
      txt += parts.map((u, j) => (j ? bare : name) + (u === 1 ? "" : u)).join("-");
      count += parts.length;
    });
    out.push(txt);
    pieces.push(count);
  }
  out.push(" |]");
  const abc = `X:1\nM:${parsed.meter}\nL:1/16\nK:${key}\n${out.join("").replace(/\s+/g, " ").trim()}\n`;
  return { abc, key, pieces };
}
