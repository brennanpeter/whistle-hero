// The stage: a 3D place around the runway, built from a scene manifest (see ASSETS.md), so the pub
// grows by editing JSON and exporting models, not by changing code.
//
//   const stage = await createStage(renderer, "pub/scene.json")
//   stage.scene                 draw it before the runway (its own tone mapping, fog and background)
//   stage.update(dt, beat)      beat = { phase 0–1, len seconds } or null; animates the actors
//   stage.onEvent(e)            game events: a combo milestone makes the actors cheer
//   stage.manifest, stage.dispose()
//
// The environment is placed so its spot_runway empty sits on the hit line, facing down the runway,
// at `scale` runway units per metre.
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { assetUrl, loadGlb, bakedMaterials, spots as findSpots, matchSpots } from "./assets.js";

const TONE = { AgX: THREE.AgXToneMapping, ACES: THREE.ACESFilmicToneMapping, Neutral: THREE.NeutralToneMapping, none: THREE.NoToneMapping };

export async function createStage(renderer, manifestPath) {
  const base = manifestPath.replace(/[^/]*$/, "");
  const res = await fetch(assetUrl(manifestPath));
  if (!res.ok) throw new Error(`scene manifest ${manifestPath}: ${res.status}`);
  const man = await res.json();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(man.background || "#000");
  if (man.fog) scene.fog = new THREE.Fog(man.fog.color, man.fog.near, man.fog.far);
  const L = man.lights || {};
  if (L.hemisphere) scene.add(new THREE.HemisphereLight(L.hemisphere.sky, L.hemisphere.ground, L.hemisphere.intensity ?? 1));
  for (const p of L.points || []) { const l = new THREE.PointLight(p.color || "#fff", p.intensity ?? 1, p.distance ?? 0); l.position.fromArray(p.at); scene.add(l); }

  // the environment
  const env = await loadGlb(assetUrl(base + man.environment));
  const world = new THREE.Group(); scene.add(world);
  const room = env.scene; world.add(room);
  const materials = bakedMaterials(room);
  const spots = findSpots(room);
  // place it: spot_runway → the hit line (origin), facing -z, scaled to runway units
  const s = man.scale ?? 1;
  world.scale.setScalar(s);
  room.updateMatrixWorld(true);
  const rs = spots[(man.runway && man.runway.spot) || "spot_runway"];
  if (rs) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    rs.getWorldPosition(p); rs.getWorldQuaternion(q);
    const yaw = new THREE.Euler().setFromQuaternion(q, "YXZ").y;
    world.rotation.y = -yaw;
    world.position.copy(p.applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw).multiplyScalar(-s));
  }
  world.updateMatrixWorld(true);

  // actors: a copy of a model at every matching spot, playing a clip
  const actors = [];
  for (const a of man.actors || []) {
    const glb = await loadGlb(assetUrl(base + a.model));
    const src = glb.scene.getObjectByName(a.node);
    if (!src) { console.warn(`stage: no node ${a.node} in ${a.model}`); continue; }
    const clipsFor = name => glb.animations.find(c => c.name === name || c.name === `${a.node}|${name}` || c.name.endsWith(`|${name}`) && c.name.startsWith(a.node));
    matchSpots(spots, a.at).forEach((spot, i) => {
      const o = cloneSkinned(src);
      o.position.set(0, 0, 0); o.quaternion.identity();
      spot.add(o);
      const actor = { o, mixer: null, loop: null, cheer: null, clip: a.clip, offset: (i * 0.37) % 1 };
      if (glb.animations.length && (a.clip || a.onCombo)) {
        actor.mixer = new THREE.AnimationMixer(o);
        const loopClip = a.clip && clipsFor(a.clip);
        if (loopClip) { actor.loop = actor.mixer.clipAction(loopClip); actor.loop.play(); actor.loop.time = actor.offset * loopClip.duration; }
        const cheer = a.onCombo && clipsFor(a.onCombo);
        if (cheer) { actor.cheer = actor.mixer.clipAction(cheer); actor.cheer.setLoop(THREE.LoopRepeat, 2); actor.cheer.clampWhenFinished = false; }
        actor.mixer.addEventListener("finished", () => { if (actor.loop) actor.loop.fadeIn(0.25); });
      }
      actors.push(actor);
    });
  }

  const every = man.cheerEvery || 25;
  return {
    scene, manifest: man, actors,
    toneMapping: TONE[man.toneMapping] ?? THREE.NoToneMapping,
    exposure: man.exposure ?? 1,
    runwayOpacity: man.runway?.opacity ?? 1,
    update(dt, beat) {
      for (const a of actors) {
        if (!a.mixer) continue;
        // a "play" clip follows the music exactly: authored at one second a beat, it's set to the
        // beat's phase each frame rather than left to run (fades still run on the mixer's clock)
        if (a.loop && /play/.test(a.clip)) {
          a.loop.timeScale = 0;
          const d = a.loop.getClip().duration, beats = Math.max(1, Math.round(d));
          const n = beat ? beat.n : performance.now() / 500, ph = beat ? beat.phase : n % 1;
          a.loop.time = (((Math.floor(n) % beats) + ph) / beats) * d;
        }
        a.mixer.update(dt);
      }
    },
    onEvent(e) {
      if (e.type !== "hit" || !e.combo || e.combo % every) return;
      for (const a of actors) if (a.cheer) { a.cheer.reset().fadeIn(0.15).play(); if (a.loop) a.loop.fadeOut(0.15); }
    },
    dispose() {
      for (const m of materials) m.dispose();
      scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } });
      for (const a of actors) a.mixer?.stopAllAction();
    },
  };
}
