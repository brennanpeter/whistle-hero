// The asset pipeline: optimizes everything in assets-src/ into public/assets/, which Vite serves as is
// (and copies into the build). See ASSETS.md for the Blender side.
//
//   .glb       read, then dedup, prune, weld and meshopt-compress; written to the matching path
//   .json      copied (scene manifests)
//   .webp .png .jpg .ktx2 .hdr   copied (textures and environment maps used outside a glb)
//   .blend and anything else      skipped (sources stay in assets-src/)
//
// Run: npm run assets            (everything)
//      npm run assets -- pub     (only paths containing "pub")
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, weld, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("assets-src"), OUT = path.resolve("public/assets");
const COPY = new Set([".json", ".webp", ".png", ".jpg", ".jpeg", ".ktx2", ".hdr"]);
const only = process.argv[2] || "";

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const kb = n => (n / 1024).toFixed(0) + " kB";
let total = 0;

for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file);
  if (only && !rel.includes(only)) continue;
  const ext = path.extname(file).toLowerCase(), out = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (ext === ".glb") {
    const doc = await io.read(file);
    // keep every named node: spot_ empties are empty on purpose, and prune would drop them
    await doc.transform(dedup(), prune({ keepLeaves: true, keepAttributes: false }), weld(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    await io.write(out, doc);
    const a = fs.statSync(file).size, b = fs.statSync(out).size;
    const tris = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives()).reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute("POSITION").getCount()) / 3, 0);
    console.log(`${rel}: ${kb(a)} → ${kb(b)}, ${tris} triangles, ${doc.getRoot().listMeshes().length} meshes, ${doc.getRoot().listAnimations().length} clips`);
    total++;
  } else if (COPY.has(ext)) {
    fs.copyFileSync(file, out); console.log(`${rel}: copied`); total++;
  }
}
console.log(total ? `${total} file(s) → public/assets/` : "nothing to do");
