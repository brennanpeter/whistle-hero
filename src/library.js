// The player's tune library, kept in this browser's localStorage. Shared by the Tune Library
// page and the game. Each tune: { id, abc, title, added, favorite, transpose, bpm, best }.
// A first visit starts with the starter set (src/tunes/starter.js).
import { parseAbcFile } from "./abc/abc.js";
import { STARTER_ABC } from "./tunes/starter.js";

export const STORE = "whistle-hero-library";

export function loadLibrary() {
  let raw = null;
  try { raw = localStorage.getItem(STORE); const s = JSON.parse(raw || "null"); if (s && Array.isArray(s.tunes)) return s; } catch (e) {}
  // First visit: start the library with the starter set (saved straight away, so both pages agree)
  if (raw == null) { const lib = { tunes: starterTunes() }; saveLibrary(lib); return lib; }
  return { tunes: [] };
}

/** The starter set as library entries. Their ids are fixed, so adding them twice is easy to spot. */
export function starterTunes() {
  return parseAbcFile(STARTER_ABC).map((t, i) => ({
    id: "starter-" + (i + 1), abc: t.abc.trim(), title: t.title || "Untitled", added: new Date().toISOString(),
    favorite: false, transpose: 0, bpm: null, starter: true,
  }));
}

/** Returns false when the browser refused to store it (private mode, storage full). */
export function saveLibrary(lib) {
  try { localStorage.setItem(STORE, JSON.stringify(lib)); return true; } catch (e) { return false; }
}

/** Settings of the same tune share a name: "The Kesh", "Kesh, The" and "kesh" group together. */
export const normTitle = s => (s || "untitled").toLowerCase().replace(/,\s*the$/, "").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

export function groupTunes(lib) {
  const m = new Map();
  for (const t of lib.tunes) { const k = normTitle(t.title); if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return [...m.entries()].map(([key, tunes]) => ({ key, tunes, title: tunes[0].title || "Untitled", favorite: tunes.some(t => t.favorite) }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}
