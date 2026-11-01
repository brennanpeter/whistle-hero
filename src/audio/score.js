// Compare what the detector heard against what was meant to be played (Whistle Sim's ground truth,
// or later a game chart). Used by Whistle Ear's stats line and by the accuracy tests.

export const MATCH_WINDOW = 0.06; // seconds between intended and detected onsets that still count as a hit

/**
 * Pair each intended note with a detected segment of the same pitch starting within MATCH_WINDOW.
 * Marks truth notes with .hit and detected segments with .extra (true when nothing claimed them).
 * Transients the detector already filtered out (seg.art) are ignored.
 */
export function matchTruth(truth, segs, window = MATCH_WINDOW) {
  const found = segs.filter(s => !s.art);
  for (const s of found) s.extra = true;
  let hit = 0, hitNotes = 0, notes = 0;
  for (const n of truth.notes) {
    if (n.kind === "note") notes++;
    let best = null;
    for (const s of found) {
      if (!s.extra || s.midi !== n.midi) continue;
      const d = Math.abs(s.start - n.start);
      if (d < window && (!best || d < Math.abs(best.start - n.start))) best = s;
    }
    n.hit = !!best;
    if (best) { best.extra = false; hit++; if (n.kind === "note") hitNotes++; }
  }
  return { hit, total: truth.notes.length, hitNotes, notes, orn: truth.notes.length - notes, extra: found.filter(s => s.extra).length };
}
