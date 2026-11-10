// Finger-hole view: each note is a row of the whistle's six holes rolling down a highway toward
// the player. A filled hole is covered. Fingers that move from the previous note get a halo, cuts
// and taps show as a quick flick on the one finger that moves, and second-octave notes are gold
// ("same fingers, blow harder"). At the hit line, the holes light up with the fingering of the note
// the detector is hearing right now.
//
// View contract (shared with every view): createXView(container, chart, opts) →
//   { update(t, live), onEvent(e), addChart(part), resize(), destroy() }
// opts.halos = false hides the finger-move halos (setHalos(on) changes it while playing).
// opts.stage = a scene manifest under public/assets/ ("pub/scene.json") puts the runway in a 3D place
// (see src/stage/stage.js); `ready` resolves once it has loaded (or failed, leaving the plain view).
// t is game time in seconds; live = { midi } for the note heard now (or null).
import * as THREE from "three";
import { noteInfo, FINGERINGS } from "../../whistle.js";

const HOLE_X = [-3.1, -2.05, -1.0, 1.0, 2.05, 3.1]; // top hand, gap, bottom hand (mouthpiece is on the left)
const COLORS = {
  bg: 0x0d1210, road: 0x141c19, lane: 0x24302b, bar: 0x5b6b64, beat: 0x2b3732,
  low: 0xe2e8e4, high: 0xdaab4f, third: 0xf3d58a, off: 0xe36b5d, change: 0x5fbbb1, orn: 0x5fbbb1,
  hit: 0x62be7d, miss: 0x6b3a35, target: 0x91a199, heardOk: 0x62be7d, heardWrong: 0xe36b5d,
};

export function createFingerView(container, chart, opts = {}) {
  // Notes are laid out by the beat, not the clock: a quarter note always takes QUARTER units of road
  // (3.5, which is how the road looked at 120 bpm), so a fast tune comes at you faster instead of
  // bunching up. VIEW is how much road is in sight: two bars of 4/4 at the standard spacing.
  // opts.spacing (1 = standard) spreads the notes out; the road in sight grows with its square root,
  // so wider spacing still shows a fair way ahead without the far end shrinking to nothing.
  const f = Math.max(0.5, Math.min(4, opts.spacing ?? 1));
  const QUARTER = 3.5 * f, VIEW = 28 * Math.sqrt(f);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(COLORS.bg);
  container.append(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.setAttribute("aria-hidden", "true");

  const scene = new THREE.Scene();
  const FOG_NEAR = VIEW * 0.7 + 4, FOG_FAR = VIEW * 1.15 + 4;
  scene.fog = new THREE.Fog(COLORS.bg, FOG_NEAR, FOG_FAR);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  // looking down the highway; puts the hit line about a fifth of the way up the screen
  const BASE_POS = new THREE.Vector3(0, 8.2, 8.6), TARGET = new THREE.Vector3(0, 0, -6.5), HIT = new THREE.Vector3(0, 0, 0);
  camera.position.copy(BASE_POS); camera.lookAt(TARGET);

  const flat = g => { g.rotateX(-Math.PI / 2); return g; };
  const disposables = [];
  const keep = x => { disposables.push(x); return x; };

  // road and lanes
  const roadLen = VIEW * 1.3 + 10;
  const roadMat = keep(new THREE.MeshBasicMaterial({ color: COLORS.road }));
  const road = new THREE.Mesh(keep(flat(new THREE.PlaneGeometry(8.6, roadLen))), roadMat);
  road.position.set(0, -0.02, -roadLen / 2 + 3);
  scene.add(road);
  for (const x of HOLE_X) {
    const lane = new THREE.Mesh(keep(flat(new THREE.PlaneGeometry(0.05, roadLen))), keep(new THREE.MeshBasicMaterial({ color: COLORS.lane })));
    lane.position.set(x, -0.015, -roadLen / 2 + 3); scene.add(lane);
  }

  // Everything that scrolls lives in `track`; a moment t sits at z = -dist(t). Each part (a loop pass)
  // brings its own tempo, so dist runs piecewise through them: { t0, d0, rate (road units a second) }.
  const track = new THREE.Group(); scene.add(track);
  const segs = [];
  const beatTimes = []; // every beat, for the stage's musicians
  const dist = t => {
    let s = segs[0];
    for (let i = 1; i < segs.length && segs[i].t0 <= t; i++) s = segs[i];
    return s ? s.d0 + (t - s.t0) * s.rate : 0;
  };
  const zOf = t => -dist(t);

  const fingering = midi => { const inf = noteInfo(midi); return inf.inScale ? FINGERINGS[inf.pc] : null; };
  const discGeo = keep(flat(new THREE.CircleGeometry(0.34, 28)));
  const ringGeo = keep(flat(new THREE.RingGeometry(0.25, 0.34, 28)));
  const haloGeo = keep(flat(new THREE.RingGeometry(0.43, 0.5, 28)));
  const flickGeo = keep(flat(new THREE.CircleGeometry(0.16, 4)));
  const M = new THREE.Matrix4(), col = new THREE.Color();

  // note names, octave arrows and part labels are sprites with cached text textures
  const labelCache = new Map();
  const labelTex = (text, color) => {
    const key = text + color;
    if (labelCache.has(key)) return labelCache.get(key);
    const c = document.createElement("canvas"); c.width = 128; c.height = 64;
    const g = c.getContext("2d"); g.font = "600 40px 'IBM Plex Mono', ui-monospace, monospace"; g.fillStyle = "#" + new THREE.Color(color).getHexString();
    g.textBaseline = "middle"; g.fillText(text, 6, 34);
    const tex = keep(new THREE.CanvasTexture(c)); tex.colorSpace = THREE.SRGBColorSpace;
    const m = keep(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    labelCache.set(key, m); return m;
  };

  // The chart arrives in parts: the whole tune at once, or one pass at a time when looping.
  // Each part is its own group, dropped once it has scrolled past.
  const rowParts = new Map(); // note id → [[mesh, index]]
  const noteById = new Map();
  const parts = [];           // { group, end, meshes, halos }
  let prevF = null, prevMidi = null, lastPart = -1, lastPass = 0, lastLoop = 1;
  let showHalos = opts.halos !== false;

  function addChart(part) {
    const t0 = part.start ?? 0, rate = QUARTER * (part.qpm || 120) / 60;
    segs.push({ t0, d0: segs.length ? dist(t0) : 0, rate });
    const group = new THREE.Group(); track.add(group);
    const own = []; // geometry and materials to free with this part
    const mine = x => { own.push(x); return x; };
    // bar and beat lines
    const pts = [], beatPts = [];
    for (const b of part.beats) if (!beatTimes.length || b.t > beatTimes[beatTimes.length - 1] + 1e-6) beatTimes.push(b.t);
    for (const b of part.bars) if (!b.pickup) pts.push(-4.1, 0, zOf(b.t), 4.1, 0, zOf(b.t));
    for (const b of part.beats) if (!b.strong) beatPts.push(-4.1, 0, zOf(b.t), 4.1, 0, zOf(b.t));
    const lines = (arr, color) => { const g = mine(new THREE.BufferGeometry()); g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3)); return new THREE.LineSegments(g, mine(new THREE.LineBasicMaterial({ color }))); };
    if (beatPts.length) group.add(lines(beatPts, COLORS.beat));
    if (pts.length) group.add(lines(pts, COLORS.bar));

    // note rows: filled discs (covered holes) and rings (open holes), as instanced meshes
    const counts = { disc: 0, ring: 0, halo: 0, flick: part.ornaments.length * 2 };
    { let pf = prevF;
      for (const n of part.notes) {
        const f = fingering(n.midi) || [0, 0, 0, 0, 0, 0];
        for (let h = 0; h < 6; h++) { if (f[h]) counts.disc++; else counts.ring++; if (pf && pf[h] !== f[h]) counts.halo++; }
        pf = f;
      } }
    const mat = () => mine(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 }));
    const discs = new THREE.InstancedMesh(discGeo, mat(), Math.max(1, counts.disc));
    const rings = new THREE.InstancedMesh(ringGeo, mat(), Math.max(1, counts.ring));
    const halos = new THREE.InstancedMesh(haloGeo, mat(), Math.max(1, counts.halo));
    const flicks = new THREE.InstancedMesh(flickGeo, mat(), Math.max(1, counts.flick));
    const meshes = [discs, rings, halos, flicks];
    for (const m of meshes) { m.count = 0; m.frustumCulled = false; group.add(m); }
    halos.visible = showHalos;
    const put = (mesh, x, z, color, scale = 1) => {
      const i = mesh.count++;
      M.makeScale(scale, 1, scale); M.setPosition(x, 0, z); mesh.setMatrixAt(i, M);
      mesh.setColorAt(i, col.set(color)); return i;
    };
    for (const n of part.notes) {
      noteById.set(n.id, n);
      const inf = noteInfo(n.midi), f = fingering(n.midi), z = zOf(n.expect ?? n.t);
      const base = !f ? COLORS.off : inf.oct >= 2 ? COLORS.third : inf.oct === 1 ? COLORS.high : COLORS.low;
      const row = [], ff = f || [0, 0, 0, 0, 0, 0];
      for (let h = 0; h < 6; h++) {
        if (ff[h]) row.push([discs, put(discs, HOLE_X[h], z, base)]);
        else row.push([rings, put(rings, HOLE_X[h], z, base)]);
        // a halo on each finger that moves since the previous note
        if (prevF && prevMidi !== n.midi && prevF[h] !== ff[h]) put(halos, HOLE_X[h], z, COLORS.change);
      }
      rowParts.set(n.id, row);
      prevF = ff; prevMidi = n.midi;
      const lc = !inf.inScale ? COLORS.off : inf.oct >= 1 ? COLORS.high : COLORS.low;
      const s = new THREE.Sprite(labelTex(inf.name + (inf.oct === 1 ? " ↑" : inf.oct >= 2 ? " ⇈" : "") + (!inf.inScale ? " ½" : ""), lc));
      s.scale.set(1.3, 0.65, 1); s.position.set(4.55, 0.25, z); group.add(s);
    }
    // cuts and taps: a flick on each finger that moves away from the main note's fingering
    for (const o of part.ornaments) {
      const main = noteById.get(o.note), fm = main && fingering(main.midi), fo = fingering(o.midi);
      if (!fm || !fo) continue;
      for (let h = 0; h < 6; h++) if (fm[h] !== fo[h]) put(flicks, HOLE_X[h], zOf(o.t) + 0.15, COLORS.orn, 1.4);
    }
    for (const m of meshes) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    // part labels (A, B, a ² for the repeat) and the loop number when a new pass starts
    for (const b of part.bars) {
      const loop = b.loop || 1;
      if (b.part === lastPart && b.pass === lastPass && loop === lastLoop) continue;
      const text = String.fromCharCode(65 + b.part) + (b.pass === 2 ? "²" : "") + (loop > 1 && loop !== lastLoop ? `  ×${loop}` : "");
      const s = new THREE.Sprite(labelTex(text, loop !== lastLoop ? COLORS.high : COLORS.bar));
      s.scale.set(loop !== lastLoop ? 2 : 1.2, loop !== lastLoop ? 0.5 : 0.6, 1);
      s.position.set(loop !== lastLoop ? -5.1 : -4.7, 0.2, zOf(b.t)); group.add(s);
      lastPart = b.part; lastPass = b.pass; lastLoop = loop;
    }
    const end = part.end ?? part.duration;
    parts.push({ group, end, meshes, halos, own, ids: part.notes.map(n => n.id) });
  }
  addChart(chart);

  // free parts that have scrolled well past the player
  function prune(t) {
    while (parts.length > 1 && parts[0].end < t - 3) {
      const p = parts.shift();
      track.remove(p.group);
      for (const m of p.meshes) m.dispose();
      for (const x of p.own) x.dispose?.();
      for (const id of p.ids) { rowParts.delete(id); noteById.delete(id); }
    }
  }

  // hit line: six sockets that light up with the fingering being heard
  const sockets = HOLE_X.map(x => {
    const ring = new THREE.Mesh(ringGeo, keep(new THREE.MeshBasicMaterial({ color: COLORS.target })));
    const fill = new THREE.Mesh(discGeo, keep(new THREE.MeshBasicMaterial({ color: COLORS.heardOk, transparent: true, opacity: 0 })));
    ring.position.set(x, 0.01, 0); fill.position.set(x, 0.012, 0); ring.scale.setScalar(1.25); fill.scale.setScalar(1.1);
    scene.add(ring, fill); return { ring, fill };
  });
  const hitLine = new THREE.Mesh(keep(flat(new THREE.PlaneGeometry(8.6, 0.06))), keep(new THREE.MeshBasicMaterial({ color: COLORS.target })));
  hitLine.position.set(0, 0.005, 0); scene.add(hitLine);

  // hit bursts
  const bursts = Array.from({ length: 16 }, () => {
    const m = new THREE.Mesh(haloGeo, keep(new THREE.MeshBasicMaterial({ color: COLORS.hit, transparent: true, opacity: 0, depthWrite: false })));
    scene.add(m); return { m, t0: -1 };
  });
  let burstI = 0;
  const burst = (x, color, now) => { const b = bursts[burstI++ % bursts.length]; b.m.material.color.set(color); b.m.position.set(x, 0.02, 0); b.t0 = now; };

  const recolor = (id, color, opacity = 1) => {
    for (const [mesh, i] of rowParts.get(id) || []) { mesh.setColorAt(i, col.set(color)); mesh.instanceColor.needsUpdate = true; }
  };

  // the stage around the runway, if asked for: drawn first, with the runway over it
  let stage = null, lastPn = 0, beatI = 0;
  const ready = !opts.stage ? Promise.resolve(null) : import("../../stage/stage.js").then(m => m.createStage(renderer, opts.stage)).then(st => {
    if (destroyed) { st.dispose(); return null; }
    stage = st;
    roadMat.transparent = st.runwayOpacity < 1; roadMat.opacity = st.runwayOpacity;
    if (st.scene.fog) scene.fog.color.copy(st.scene.fog.color);
    return st;
  }).catch(e => { console.warn("stage failed to load; using the plain view", e); return null; });
  let destroyed = false;
  const beatAt = t => {
    if (beatTimes.length < 2 || t < beatTimes[0]) return null;
    if (beatI >= beatTimes.length || beatTimes[beatI] > t) beatI = 0;
    while (beatI + 1 < beatTimes.length && beatTimes[beatI + 1] <= t) beatI++;
    const a = beatTimes[beatI], b = beatTimes[beatI + 1] ?? a + (a - beatTimes[beatI - 1]);
    return { n: beatI, phase: Math.min(1, (t - a) / (b - a)), len: b - a };
  };

  let now = 0, raf = 0;
  function onEvent(e) {
    stage?.onEvent(e);
    if (e.type === "hit") {
      recolor(e.note.id, COLORS.hit);
      const f = fingering(e.note.midi) || [1, 1, 1, 1, 1, 1];
      HOLE_X.forEach((x, h) => { if (f[h] || e.grade === "perfect") burst(x, e.grade === "perfect" ? COLORS.high : COLORS.hit, performance.now()); });
    } else if (e.type === "miss") recolor(e.note.id, COLORS.miss);
  }

  function update(t, live) {
    now = t;
    track.position.z = dist(t);
    prune(t);
    // what the player is playing right now, shown on the hit line
    const heard = live && live.midi != null ? fingering(live.midi) : null;
    const ok = live && live.expected != null && live.midi === live.expected;
    sockets.forEach((s, h) => {
      const on = heard && heard[h];
      s.fill.material.opacity = on ? 0.9 : 0;
      s.fill.material.color.set(ok ? COLORS.heardOk : COLORS.heardWrong);
      s.ring.material.color.set(heard ? (ok ? COLORS.heardOk : COLORS.target) : COLORS.target);
    });
    const pn = performance.now();
    for (const b of bursts) {
      if (b.t0 < 0) continue;
      const k = (pn - b.t0) / 350;
      if (k >= 1) { b.t0 = -1; b.m.material.opacity = 0; continue; }
      b.m.scale.setScalar(1 + k * 1.6); b.m.material.opacity = 0.85 * (1 - k);
    }
    if (stage) {
      const dt = lastPn ? Math.min(0.1, (pn - lastPn) / 1000) : 0; lastPn = pn;
      stage.update(dt, beatAt(t));
      renderer.autoClear = false; renderer.clear();
      renderer.toneMapping = stage.toneMapping; renderer.toneMappingExposure = stage.exposure;
      renderer.render(stage.scene, camera);
      renderer.clearDepth(); renderer.toneMapping = THREE.NoToneMapping;
      renderer.render(scene, camera);
    } else renderer.render(scene, camera);
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + "px"; renderer.domElement.style.height = h + "px";
    const aspect = w / h;
    camera.aspect = aspect;
    // Keep all six holes and the note names in view on narrow screens: widen the lens a little,
    // then pull the camera back along its line of sight until the hit line's 10.6 units fit.
    const halfW = 5.3, baseDist = BASE_POS.distanceTo(HIT), deg = Math.PI / 180;
    camera.fov = Math.min(68, Math.max(50, 2 * Math.atan(Math.tan(24 * deg) / aspect) / deg));
    const need = halfW / (Math.tan(camera.fov / 2 * deg) * aspect);
    const k = Math.max(1, need / baseDist);
    camera.position.copy(TARGET).addScaledVector(BASE_POS.clone().sub(TARGET), k);
    camera.lookAt(TARGET);
    scene.fog.near = FOG_NEAR + (k - 1) * baseDist; scene.fog.far = FOG_FAR + (k - 1) * baseDist;
    // then slide the picture so the hit line sits near the bottom on any screen shape
    camera.clearViewOffset(); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const ndcY = HIT.clone().project(camera).y, wantY = -0.62;
    camera.setViewOffset(w, h, 0, (wantY - ndcY) * h / 2, w, h);
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize); ro.observe(container);

  return {
    update, onEvent, resize, ready,
    get stage() { return stage; },  // for tests
    addChart,                       // more of the tune (the next pass when looping)
    dist,                           // for tests: game time → distance along the road
    setHalos(on) { showHalos = !!on; for (const p of parts) p.halos.visible = showHalos; },
    destroy() {
      destroyed = true; cancelAnimationFrame(raf); ro.disconnect(); stage?.dispose();
      for (const d of disposables) d.dispose?.();
      for (const p of parts) { for (const m of p.meshes) m.dispose(); for (const x of p.own) x.dispose?.(); }
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
