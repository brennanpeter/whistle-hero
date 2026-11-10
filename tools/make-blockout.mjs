// Generates the grey-box blockout pub in assets-src/pub/, following the asset conventions in
// ASSETS.md exactly, so the whole pipeline can be exercised before any real art exists:
//   blockout-env.glb     the room, with fake "baked" lighting in its vertex colours, and the spots
//   blockout-people.glb  a box musician and a box punter, each with idle / play / cheer clips
//   blockout-props.glb   a pint
// Run: node tools/make-blockout.mjs   (then npm run assets)
import { Document, NodeIO } from "@gltf-transform/core";
import path from "node:path";
import fs from "node:fs";

const OUT = path.resolve("assets-src/pub");
fs.mkdirSync(OUT, { recursive: true });

// --- fake "baked" lighting: warm lamps, a little ambient, darker low down and in the corners ---
const LAMPS = [[3.8, 2.6, -3], [4.2, 2.6, -8], [3.8, 2.6, -13.5], [-3.4, 2.6, -14], [-5.2, 2.4, -3], [-5.2, 2.4, -9], [0, 2.8, -16]];
function bake([x, y, z], [nx, ny, nz], base) {
  let r = 0.16, g = 0.12, b = 0.1; // ambient, warm and dim
  for (const [lx, ly, lz] of LAMPS) {
    const dx = lx - x, dy = ly - y, dz = lz - z, d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2);
    const facing = Math.max(0, (dx * nx + dy * ny + dz * nz) / d);
    const k = (1.6 * facing) / (1 + 0.35 * d2);
    r += k * 1.0; g += k * 0.72; b += k * 0.42; // lamplight: warm
  }
  const low = 0.55 + 0.45 * Math.min(1, y / 1.2); // a touch of occlusion near the floor
  return [base[0] * r * low, base[1] * g * low, base[2] * b * low].map(v => Math.min(1, v));
}

// --- a box mesh with per-face normals, optionally baked, in the given colour ---
function boxData([w, h, d], [cx, cy, cz], colour, baked = true, inward = false) {
  const pos = [], nor = [], col = [], idx = [];
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const half = [w / 2, h / 2, d / 2];
  for (const [n, u, v] of faces) {
    const base = pos.length / 3, N = inward ? n.map(x => -x) : n, steps = baked ? 6 : 1;
    // a small grid per face, so the lighting has vertices to vary across
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) {
      const a = (i / steps) * 2 - 1, b2 = (j / steps) * 2 - 1;
      const p = [0, 1, 2].map(k => [cx, cy, cz][k] + half[k] * (n[k] + a * u[k] + b2 * v[k]));
      pos.push(...p); nor.push(...N);
      col.push(...(baked ? bake(p, N, colour) : colour), 1);
    }
    for (let i = 0; i < steps; i++) for (let j = 0; j < steps; j++) {
      const q = base + i * (steps + 1) + j, s = q + steps + 1;
      if (inward) idx.push(q, q + 1, s, q + 1, s + 1, s); else idx.push(q, s, q + 1, q + 1, s, s + 1);
    }
  }
  return { pos, nor, col, idx };
}
function merge(parts) {
  const out = { pos: [], nor: [], col: [], idx: [] };
  for (const p of parts) { const o = out.pos.length / 3; out.pos.push(...p.pos); out.nor.push(...p.nor); out.col.push(...p.col); out.idx.push(...p.idx.map(i => i + o)); }
  return out;
}
function meshNode(doc, buf, name, data, mat) {
  const acc = (type, arr, T) => doc.createAccessor().setType(type).setArray(new T(arr)).setBuffer(buf);
  const prim = doc.createPrimitive()
    .setAttribute("POSITION", acc("VEC3", data.pos, Float32Array))
    .setAttribute("NORMAL", acc("VEC3", data.nor, Float32Array))
    .setAttribute("COLOR_0", acc("VEC4", data.col, Float32Array))
    .setIndices(acc("SCALAR", data.idx, Uint32Array)).setMaterial(mat);
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
}
const spot = (doc, name, [x, y, z], yaw = 0) => doc.createNode(name).setTranslation([x, y, z]).setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
const save = async (doc, file) => { await new NodeIO().write(path.join(OUT, file), doc); console.log("wrote", path.join("assets-src/pub", file)); };

// ---------------- the room ----------------
{
  const doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene("pub");
  const mat = doc.createMaterial("env_baked").setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(0);
  const W = 12, D = 20, H = 3.2, Z0 = 3; // the room runs from z = +3 (behind the player) to z = -17
  const WOOD = [0.55, 0.36, 0.22], DARK = [0.32, 0.2, 0.12], WALL = [0.78, 0.62, 0.45], FLOOR = [0.42, 0.28, 0.18];
  const env = (name, parts) => scene.addChild(meshNode(doc, buf, name, merge(parts), mat));
  env("env_room", [boxData([W, H, D], [0, H / 2, Z0 - D / 2], WALL, true, true)]);
  env("env_floor", [boxData([W - 0.02, 0.02, D - 0.02], [0, 0.01, Z0 - D / 2], FLOOR)]);
  env("env_bar", [boxData([1, 1.1, 9], [-5.2, 0.55, -6], DARK), boxData([1.3, 0.06, 9.2], [-5.2, 1.13, -6], WOOD), boxData([0.4, 1.8, 9], [-5.8, 1.6, -6], DARK)]);
  // the session corner: a low platform on the right, halfway down, where the band can be seen beside the runway
  env("env_stage", [boxData([3, 0.3, 4], [4.4, 0.15, -8.2], WOOD)]);
  env("env_fireplace", [boxData([2.4, 1.4, 0.5], [0, 0.7, -16.75], [0.35, 0.3, 0.28]), boxData([1.2, 0.8, 0.1], [0, 0.45, -16.45], [0.9, 0.45, 0.12], false)]);
  // tables kept clear of the runway (x within ±2.15 m of the middle)
  const tables = [[3.9, -3], [3.9, -13.5], [-3.4, -14]];
  env("env_tables", tables.flatMap(([x, z]) => [boxData([1.4, 0.06, 0.9], [x, 0.75, z], WOOD), boxData([0.12, 0.72, 0.12], [x, 0.36, z], DARK)]));
  env("env_stools", tables.flatMap(([x, z]) => [-1, 1].map(s => boxData([0.4, 0.45, 0.4], [x + s * 1.0, 0.225, z], DARK))));
  env("env_lamps", LAMPS.map(([x, y, z]) => boxData([0.3, 0.2, 0.3], [x, y + 0.35, z], [1, 0.85, 0.6], false)));
  // the spots: where things go (empties in Blender)
  scene.addChild(spot(doc, "spot_runway", [0, 0.02, 0.5]));          // the hit line, facing -z
  scene.addChild(spot(doc, "spot_player", [0, 1.2, 2.2]));
  // the musicians face the player (a figure's front is +z; yaw turns it toward the runway)
  [[3.5, -6.8], [4.7, -8.2], [3.5, -9.6]].forEach(([x, z], i) => scene.addChild(spot(doc, `spot_musician_${i + 1}`, [x, 0.3, z], Math.atan2(-x, 2 - z))));
  tables.forEach(([x, z], i) => { scene.addChild(spot(doc, `spot_crowd_${2 * i + 1}`, [x - 1.0, 0.45, z], Math.PI / 2)); scene.addChild(spot(doc, `spot_crowd_${2 * i + 2}`, [x + 1.0, 0.45, z], -Math.PI / 2)); });
  tables.forEach(([x, z], i) => { scene.addChild(spot(doc, `spot_pint_${2 * i + 1}`, [x - 0.35, 0.78, z + 0.15])); scene.addChild(spot(doc, `spot_pint_${2 * i + 2}`, [x + 0.35, 0.78, z - 0.15])); });
  await save(doc, "blockout-env.glb");
}

// ---------------- the people: box figures with idle / play / cheer ----------------
{
  const doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene("people");
  const mat = doc.createMaterial("char_box").setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(new Float32Array(arr)).setBuffer(buf);
  function figure(name, shirt, height, x) {
    const root = doc.createNode(name).setTranslation([x, 0, 0]);
    const body = meshNode(doc, buf, name + "_body", boxData([0.5, height * 0.55, 0.32], [0, height * 0.275, 0], shirt, false), mat);
    const head = meshNode(doc, buf, name + "_head", boxData([0.28, 0.3, 0.28], [0, 0.15, 0], [0.86, 0.66, 0.52], false), mat).setTranslation([0, height * 0.55 + 0.02, 0]);
    root.addChild(body); body.addChild(head);
    // clips: node animation on the body (sway, bob) and the head (nod); each loops in one beat or two
    const clip = (clipName, dur, keys) => {
      const anim = doc.createAnimation(clipName);
      for (const [node, pathName, values] of keys) {
        const n = values.length, times = values.map((_, i) => (i / (n - 1)) * dur);
        const s = doc.createAnimationSampler().setInput(acc("SCALAR", times)).setOutput(acc(pathName === "rotation" ? "VEC4" : "VEC3", values.flat())).setInterpolation("LINEAR");
        anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(pathName).setSampler(s));
      }
      return anim;
    };
    const rz = a => [0, 0, Math.sin(a / 2), Math.cos(a / 2)], rx = a => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
    const hy = height * 0.55 + 0.02;
    clip(`${name}|idle`, 2, [[body, "rotation", [rz(-0.03), rz(0.03), rz(-0.03)]]]);
    clip(`${name}|play`, 1, [[body, "translation", [[0, 0, 0], [0, -0.05, 0], [0, 0, 0]]], [head, "rotation", [rx(0), rx(0.18), rx(0)]]]);
    clip(`${name}|cheer`, 1, [[body, "translation", [[0, 0, 0], [0, 0.35, 0], [0, 0, 0]]], [head, "translation", [[0, hy, 0], [0, hy + 0.08, 0], [0, hy, 0]]]]);
    return root;
  }
  scene.addChild(figure("char_musician", [0.25, 0.42, 0.3], 1.3, -1)); // seated on the stage
  scene.addChild(figure("char_punter", [0.45, 0.32, 0.5], 1.15, 1));   // seated at a table
  await save(doc, "blockout-people.glb");
}

// ---------------- the props ----------------
{
  const doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene("props");
  const mat = doc.createMaterial("prop_box").setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.4).setMetallicFactor(0);
  const pint = doc.createNode("prop_pint");
  pint.addChild(meshNode(doc, buf, "prop_pint_glass", boxData([0.09, 0.15, 0.09], [0, 0.075, 0], [0.12, 0.07, 0.04], false), mat));
  pint.addChild(meshNode(doc, buf, "prop_pint_head", boxData([0.092, 0.025, 0.092], [0, 0.162, 0], [0.95, 0.9, 0.8], false), mat));
  scene.addChild(pint);
  await save(doc, "blockout-props.glb");
}
