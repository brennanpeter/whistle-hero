// The asset pipeline's outputs follow the conventions in ASSETS.md: every scene manifest names files
// that exist, an environment with a spot_runway, and actors whose nodes, spots and clips are there.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const ROOT = path.resolve("public/assets");
const manifests = fs.existsSync(ROOT) ? fs.readdirSync(ROOT, { recursive: true }).filter(f => /scene\.json$/.test(f)) : [];
const glob = p => new RegExp("^" + p.replace(/\*/g, ".*") + "$");

test("scene manifests point at real models, nodes, spots and clips", async () => {
  assert.ok(manifests.length >= 1, "at least the blockout pub");
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  for (const m of manifests) {
    const dir = path.join(ROOT, path.dirname(m)), man = JSON.parse(fs.readFileSync(path.join(ROOT, m), "utf8"));
    const env = await io.read(path.join(dir, man.environment));
    const names = env.getRoot().listNodes().map(n => n.getName());
    assert.ok(names.includes(man.runway?.spot || "spot_runway"), `${m}: spot_runway`);
    const tris = env.getRoot().listMeshes().flatMap(x => x.listPrimitives()).reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
    assert.ok(tris < 100000, `${m}: ${tris} triangles is over the budget`);
    for (const a of man.actors || []) {
      const doc = await io.read(path.join(dir, a.model));
      assert.ok(doc.getRoot().listNodes().some(n => n.getName() === a.node), `${m}: ${a.node} in ${a.model}`);
      assert.ok(names.some(n => glob(a.at).test(n)), `${m}: a spot for ${a.at}`);
      const clips = doc.getRoot().listAnimations().map(x => x.getName());
      for (const c of [a.clip, a.onCombo].filter(Boolean)) assert.ok(clips.some(x => x === c || x === `${a.node}|${c}`), `${m}: clip ${c} for ${a.node}`);
    }
  }
});
