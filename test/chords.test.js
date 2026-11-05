// The groundwork for the backing guitar (not yet played in the game): chord symbols, keys, voicings
// and automatic chords.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAbc, parseAbcFile } from "../src/abc/abc.js";
import { meterInfo } from "../src/chart/chart.js";
import { parseChordSymbol, chordTones, keyChords, keyInfo, voicing, autoChords, chordTrack } from "../src/music/chords.js";
import { STARTER_ABC } from "../src/tunes/starter.js";

test("chord symbols: names, qualities, slash basses, transposition; annotations aren't chords", () => {
  const c = s => { const x = parseChordSymbol(s); return x && [x.root, x.quality, x.seventh, x.bass]; };
  assert.deepEqual(c("G"), [7, "maj", null, null]);
  assert.deepEqual(c("Em"), [4, "min", null, null]);
  assert.deepEqual(c("D7"), [2, "maj", "7", null]);
  assert.deepEqual(c("A/C#"), [9, "maj", null, 1]);
  assert.deepEqual(c("Bm7"), [11, "min", "7", null]);
  assert.deepEqual(c("Dsus4"), [2, "sus4", null, null]);
  assert.deepEqual(c("Bb"), [10, "maj", null, null]);
  assert.equal(parseChordSymbol("^A part"), null);
  assert.equal(parseChordSymbol("<fine"), null);
  assert.equal(parseChordSymbol("G", 2).name, "A");
  assert.deepEqual(chordTones(parseChordSymbol("D7")), [2, 6, 9, 0]);
});

test("the parser keeps chord symbols on the note or rest they go with, transposed with the tune", () => {
  const p = parseAbc('X:1\nM:4/4\nL:1/8\nK:G\n"G"GABc "D7"dBAG|"Em"z2 "^A part"E2 B4|', { transpose: 2 });
  assert.deepEqual(p.events.filter(e => e.chord).map(e => [e.t, e.chord.name]), [["note", "A"], ["note", "E7"], ["rest", "F#m"]]);
  assert.equal(chordTrack(p, meterInfo).source, "abc");
});

test("keys and their chords", () => {
  assert.deepEqual(keyInfo("Ador"), { tonic: 9, mode: "dor", scale: [9, 11, 0, 2, 4, 6, 7], flats: false });
  assert.deepEqual(keyChords("D").map(c => c.name), ["D", "Em", "F#m", "G", "A", "Bm"]);
  assert.deepEqual(keyChords("Em").map(c => c.name), ["Em", "G", "Am", "Bm", "C", "D"]);
  assert.deepEqual(keyChords("Bb").map(c => c.name), ["Bb", "Cm", "Dm", "Eb", "F", "Gm"]);
});

test("voicings: the root in the bass, the key's drones on top, below the whistle's range", () => {
  const v = (ch, key) => { const x = voicing(parseChordSymbol(ch), key); return [...x.bass, "|", ...x.top].join(" "); };
  assert.equal(v("C", "G"), "48 | 55 62 64", "C3 under G3 D4 E4");
  assert.equal(v("D", "G"), "50 | 55 57 62", "D3 under G3 A3 D4: the G drone stays, the third goes");
  for (const ch of ["G", "C", "D", "Em", "Am", "Bm", "A", "F#m", "B7"]) for (const key of ["D", "G", "Em", "Ador"]) {
    const x = voicing(parseChordSymbol(ch), key);
    assert.ok(x.bass[0] >= 45 && x.bass[0] <= 56 && x.top.length >= 2 && Math.max(...x.top) <= 66, `${ch} in ${key}`);
  }
});

test("automatic chords: from the key, home chord at both ends, nothing under a pickup", () => {
  const starter = Object.fromEntries(parseAbcFile(STARTER_ABC).map(t => [t.title, parseAbc(t.abc)]));
  const kesh = autoChords(starter["The Kesh"], meterInfo);
  assert.equal(kesh[0].chord.name, "G"); assert.equal(kesh[kesh.length - 1].chord.name, "G");
  assert.ok(kesh.every(c => ["G", "D", "C", "Am", "Em", "Bm"].includes(c.chord.name)));
  const maggie = autoChords(starter["Drowsy Maggie"], meterInfo);
  assert.equal(maggie[0].chord.name, "Em");
  assert.ok(maggie.some(c => c.chord.name === "D"), "Drowsy Maggie's Em / D");
  const hollow = autoChords(starter["The Hollow Road"], meterInfo);
  assert.ok(hollow[0].pos > 0, "the pickup gets no chord");
  for (const [title, p] of Object.entries(starter)) assert.ok(autoChords(p, meterInfo).length >= 1, title);
});
