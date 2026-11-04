// Whistles in other keys, and the low D whistle or Irish flute. They all use the D whistle's six-hole
// fingerings, sounding higher or lower: a B♭ whistle's "D" fingering sounds B♭, a flute's sounds the
// D an octave below the whistle's.
//
// The game works in D-whistle fingerings throughout (charts, scoring, both views), so a tune in D is
// fingered as D on any of these and sounds in the instrument's key ("playing alone"). Only the
// detector needs to know the instrument: it listens with its reference pitch moved by `shift`, so it
// hears a B♭ whistle's bottom note as the fingering "D".
export const INSTRUMENTS = {
  D:    { label: "D whistle", shift: 0 },
  C:    { label: "C whistle", shift: -2 },
  Bb:   { label: "B♭ whistle", shift: -4, flats: true },
  A:    { label: "A whistle", shift: -5 },
  G:    { label: "G whistle (low G)", shift: -7 },
  F:    { label: "F whistle", shift: 3, flats: true },
  Eb:   { label: "E♭ whistle", shift: 1, flats: true },
  hiG:  { label: "High G whistle", shift: 5 },
  lowD: { label: "Low D whistle or Irish flute", shift: -12 },
};
export const INSTRUMENT_STORE = "whistle-hero-instrument";

export const instrument = k => INSTRUMENTS[k] || INSTRUMENTS.D;
export const shiftOf = k => instrument(k).shift;

/** The instrument the player last chose (shared by the game, Calibrate and Whistle Ear). */
export function loadInstrument() {
  try { const k = localStorage.getItem(INSTRUMENT_STORE); if (k && INSTRUMENTS[k]) return k; } catch (e) {}
  return "D";
}
export function saveInstrument(k) { try { localStorage.setItem(INSTRUMENT_STORE, k); } catch (e) {} }

/** Reference pitch for the detector: the instrument's tuning (A in Hz, as calibrated), moved by its key. */
export const referencePitch = (k, a4 = 440) => a4 * Math.pow(2, shiftOf(k) / 12);

const SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
/**
 * The pitch a fingering really sounds on this instrument ("B♭" for the D fingering on a B♭ whistle),
 * or null when it's the same note name as the fingering (a D whistle, or a flute an octave down).
 */
export function soundingName(midi, k) {
  const s = shiftOf(k);
  if (s % 12 === 0) return null;
  return (instrument(k).flats ? FLAT : SHARP)[(((midi + s) % 12) + 12) % 12];
}
