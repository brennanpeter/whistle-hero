// Facts about the D tin whistle, shared by Whistle Ear, Whistle Sim and the game.

export const LOW_D = 74; // MIDI number of the bottom note (D5)

// Natural notes of the whistle (D major) plus C♮, keyed by semitones above D.
export const SCALE_NAMES = { 0: "D", 2: "E", 4: "F♯", 5: "G", 7: "A", 9: "B", 10: "C♮", 11: "C♯" };
export const CHROM_NAMES = ["D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B", "C", "C♯"];
export const DIATONIC = [0, 2, 4, 5, 7, 9, 11];

// Six holes, top (nearest the mouthpiece) first; 1 = covered. Keyed by semitones above D.
export const FINGERINGS = {
  0: [1, 1, 1, 1, 1, 1], 2: [1, 1, 1, 1, 1, 0], 4: [1, 1, 1, 1, 0, 0], 5: [1, 1, 1, 0, 0, 0],
  7: [1, 1, 0, 0, 0, 0], 9: [1, 0, 0, 0, 0, 0], 10: [0, 1, 1, 0, 0, 0], 11: [0, 0, 0, 0, 0, 0],
};

/**
 * Everything the UI needs about a MIDI note on a D whistle.
 * name uses ′ for the 2nd octave and ″ for the 3rd; inScale is false for notes that need half-holing.
 */
export function noteInfo(midi) {
  const off = midi - LOW_D, oct = Math.floor(off / 12), pc = ((off % 12) + 12) % 12;
  const inScale = (pc in SCALE_NAMES) && oct >= 0 && oct <= 2;
  let name = pc in SCALE_NAMES ? SCALE_NAMES[pc] : CHROM_NAMES[pc];
  if (oct === 1) name += "′"; else if (oct === 2) name += "″"; else if (oct < 0) name += ",";
  return { name, inScale, fing: FINGERINGS[pc] || null, oct, pc };
}

export const noteName = midi => noteInfo(midi).name;

// Whistle scale notes (D major + C♯) across the playable range, used to pick cut and tap pitches.
export const WHISTLE_NOTES = [];
for (let o = 0; o < 3; o++) for (const pc of DIATONIC) WHISTLE_NOTES.push(LOW_D + 12 * o + pc);

/** The whistle-scale note `steps` scale steps from midi (null when off the end of the range). */
export const stepFrom = (midi, steps) => {
  let i = WHISTLE_NOTES.findIndex(m => m >= midi);
  if (i < 0) i = WHISTLE_NOTES.length - 1;
  if (steps < 0 && WHISTLE_NOTES[i] > midi) i--; // midi between scale notes
  const j = i + steps;
  return j >= 0 && j < WHISTLE_NOTES.length ? WHISTLE_NOTES[j] : null;
};

/** Cut pitch: two scale steps up, except on B, where lifting the only covered hole gives C♯. */
export const cutFor = midi => (((midi - LOW_D) % 12 + 12) % 12 === 9 ? stepFrom(midi, 1) : stepFrom(midi, 2)) ?? midi + 2;
/** Tap pitch: one scale step down; null on low D, which has no hole below it. */
export const tapFor = midi => stepFrom(midi, -1);
