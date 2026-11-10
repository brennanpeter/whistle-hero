// Loading game assets made by the pipeline (tools/assets.mjs; conventions in ASSETS.md).
//
//   loadGlb(url)        a glb, meshopt-decoded, cached: { scene, animations }
//   bakedMaterials(obj) env_ meshes drawn unlit with their baked colours (texture and/or vertex colours)
//   spots(obj)          the spot_ empties by name: { spot_runway: Object3D, ... }
//   assetUrl(path)      a path under public/assets/, resolved against the page (works under any base)
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export const assetUrl = path => new URL("assets/" + path.replace(/^\/+/, ""), document.baseURI).href;

let loader = null;
const cache = new Map();
export function loadGlb(url) {
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).catch(e => { cache.delete(url); throw e; }));
  return cache.get(url);
}

/**
 * Lighting is baked into env_ meshes, so they're drawn unlit: their colour texture (and vertex
 * colours, if any) exactly as baked, untouched by lights or tone mapping. Returns the new materials.
 */
export function bakedMaterials(root) {
  const made = new Map();
  root.traverse(o => {
    if (!o.isMesh || !/^env_/.test(nameOf(o))) return;
    const old = o.material;
    if (!made.has(old)) {
      const m = new THREE.MeshBasicMaterial({
        map: old.map || null, color: old.map ? 0xffffff : old.color, vertexColors: !!o.geometry.attributes.color,
        transparent: old.transparent, alphaTest: old.alphaTest, side: old.side, toneMapped: false,
      });
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      m.name = old.name; made.set(old, m); old.dispose();
    }
    o.material = made.get(old);
  });
  return [...made.values()];
}

// a mesh's own name, or its parent's when the exporter split it into primitives
const nameOf = o => (o.name && !/^mesh_?\d*$/i.test(o.name) ? o.name : o.parent ? o.parent.name : "");

export function spots(root) {
  const out = {};
  root.traverse(o => { if (/^spot_/.test(o.name)) out[o.name] = o; });
  return out;
}

/** Glob-style match for spot names in the manifest: "spot_crowd_*". */
export const matchSpots = (all, pattern) => {
  const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return Object.keys(all).filter(k => re.test(k)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(k => all[k]);
};
