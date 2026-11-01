// Render simulated whistle audio to WAV files, each with a .truth.json listing the
// notes it meant to play and the transients it injected. Handy for building a test set.
//
//   node tools/render.mjs                         # every example tune × every player profile
//   node tools/render.mjs my-tune.abc             # one ABC file, typical player
//   node tools/render.mjs my-tune.abc --profile beginner --bpm 180 --seed 4 --reverb 0.2
//   node tools/render.mjs --out some/folder ...   # default folder: test-audio/
//
// Any option from DEFAULTS in sim/whistle-synth.js can be passed as --name value.
import fs from "node:fs";
import path from "node:path";
import { renderAbc, encodeWav, PRESETS, PROFILES, DEFAULTS } from "../sim/whistle-synth.js";

const args = process.argv.slice(2);
const opts = {}; const files = []; let out = "test-audio";
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--help" || a === "-h") { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter(l => l.startsWith("//")).map(l => l.slice(3)).join("\n")); process.exit(0); }
  if (a === "--out") { out = args[++i]; continue; }
  if (a.startsWith("--")) {
    const k = a.slice(2), v = args[++i];
    if (k !== "profile" && k !== "articulation" && !(k in DEFAULTS)) { console.error(`Unknown option --${k}`); process.exit(1); }
    opts[k] = k === "profile" || k === "articulation" ? v : Number(v);
    continue;
  }
  files.push(a);
}
fs.mkdirSync(out, { recursive: true });

const jobs = [];
if (files.length) for (const f of files) jobs.push({ name: path.basename(f).replace(/\.[^.]+$/, ""), abc: fs.readFileSync(f, "utf8"), profile: opts.profile || "typical" });
else for (const [k, p] of Object.entries(PRESETS)) for (const prof of opts.profile ? [opts.profile] : Object.keys(PROFILES)) jobs.push({ name: k, abc: p.abc, profile: prof });

for (const j of jobs) {
  const r = renderAbc(j.abc, { ...opts, profile: j.profile });
  const base = path.join(out, `${j.name}.${j.profile}.seed${r.truth.options.seed}`);
  fs.writeFileSync(base + ".wav", encodeWav(r.samples, r.sr));
  fs.writeFileSync(base + ".truth.json", JSON.stringify(r.truth, null, 1));
  const notes = r.truth.notes.length, arts = r.truth.artifacts.length;
  console.log(`${base}.wav  ${r.truth.duration.toFixed(1)} s, ${notes} notes, ${arts} injected transients${r.warnings.length ? "  (" + r.warnings.join("; ") + ")" : ""}`);
}
