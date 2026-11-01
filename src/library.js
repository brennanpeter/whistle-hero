// The player's tune library, kept in this browser's localStorage. Shared by the Tune Library
// page and the game. Each tune: { id, abc, title, added, favorite, transpose, bpm, best }.
export const STORE = "whistle-hero-library";

export function loadLibrary() {
  try { const s = JSON.parse(localStorage.getItem(STORE) || "null"); if (s && Array.isArray(s.tunes)) return s; } catch (e) {}
  return { tunes: [] };
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
