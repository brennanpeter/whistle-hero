// Sheet music view: the tune on one long staff, played out from start to finish (repeats and
// endings written out), scrolling past a fixed playhead. A "ghost" notehead at the playhead shows
// the note being heard, at its place on the staff: green when it's the right note, red when not,
// with ledger lines, an accidental and its name. Notes turn green when hit and dim red when missed.
// An optional strip of whistle fingerings sits under the staff (setHalos toggles it, like the
// halos in the finger-hole view). Built for fiddlers and whistlers learning to read.
//
// View contract (shared with every view): createXView(container, chart, opts) →
//   { update(t, live), onEvent(e), addChart(part), setHalos(on), resize(), destroy() }
// This view also needs opts.parsed: the parsed (and transposed) tune the chart was built from.
// Staff note i is chart note i (writeAbc keeps them one-to-one), so a loop pass is another
// copy of the same notation laid end to end.
import abcjs from "abcjs";
import { writeAbc, staffPlace } from "../../abc/write.js";
import { noteInfo, noteName } from "../../whistle.js";

const C = {
  bg: "#0d1210", ink: "#dfe6e2", faint: "#7d8c85", hit: "#62be7d", perfect: "#e7c06a", miss: "#a4564c",
  ok: "#62be7d", wrong: "#e36b5d", playhead: "#5fbbb1", hole: "#dfe6e2", high: "#daab4f",
};
const ABC_STEP = 3.875; // abcjs: half a staff space at scale 1
const SVGNS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
};

const CSS = `
.sv{position:absolute;inset:0;overflow:hidden;background:${C.bg}}
.sv-strip{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.sv-pass{position:absolute;top:0}
.sv-pass svg{display:block;overflow:visible}
.sv-hit path{fill:${C.hit};stroke:${C.hit}}
.sv-perfect path{fill:${C.perfect};stroke:${C.perfect}}
.sv-miss path{fill:${C.miss};stroke:${C.miss}}
.sv-aid.off{display:none}
.sv-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
`;

export function createSheetView(container, chart, opts = {}) {
  if (!opts.parsed) throw new Error("the sheet music view needs opts.parsed");
  const sheet = writeAbc(opts.parsed);
  let showAid = opts.halos !== false;

  if (!document.getElementById("sv-style")) {
    const st = document.createElement("style"); st.id = "sv-style"; st.textContent = CSS; document.head.append(st);
  }
  const root = document.createElement("div"); root.className = "sv"; root.setAttribute("aria-hidden", "true");
  const strip = document.createElement("div"); strip.className = "sv-strip"; root.append(strip);
  const overlay = el("svg", { class: "sv-overlay" }); root.append(overlay);
  container.append(root);

  // the ghost notehead and the playhead live in the overlay, in screen pixels
  const playhead = el("rect", { fill: C.playhead, opacity: 0.55 }, overlay);
  const ghost = el("g", { visibility: "hidden" }, overlay);
  const ledgers = el("g", {}, ghost);
  const head = el("ellipse", {}, ghost);
  const accTxt = el("text", { "text-anchor": "end", "font-family": "serif" }, ghost);
  const nameTxt = el("text", { "text-anchor": "middle", "font-family": "system-ui, sans-serif", "font-weight": "600" }, ghost);

  // Laid-out passes, and the time → x map through all of them (x in unscaled strip pixels).
  const passes = [], pts = []; // pts: [t, x], increasing in both
  const noteDom = new Map();    // chart note id → the SVG groups of its noteheads
  let stripW = 0, lineY = null, blockH = 0, aidTop = 0;

  function addChart(part) {
    const box = document.createElement("div"); box.className = "sv-pass";
    strip.append(box);
    const n = sheet.pieces.reduce((a, b) => a + b, 0);
    const [vis] = abcjs.renderAbc(box, sheet.abc, {
      add_classes: true, scale: 1, staffwidth: n * 44 * Math.max(0.5, Math.min(4, opts.spacing ?? 1)) + 600, foregroundColor: C.ink,
      paddingleft: 0, paddingright: 0, paddingtop: 6, paddingbottom: 0, oneSvgPerLine: true,
      format: { annotationfont: "sans-serif 10", gchordfont: "sans-serif 10" },
    });
    const svg = box.querySelector("svg");
    const voice = vis.lines[0].staff[0].voices[0];
    const heads = voice.filter(x => x.el_type === "note" && !x.rest && x.abselem?.notePositions?.length);
    const groups = [...box.querySelectorAll(".abcjs-note")];

    // staff geometry from the engraved noteheads: y = y0 − (step − s0) × stepPx
    if (!lineY) {
      const h = heads.find(x => x.abselem.heads?.length);
      const s0 = h ? h.abselem.heads[0].pitch : 6, y0 = h ? h.abselem.notePositions[0].y : 60;
      lineY = step => y0 - (step - s0) * ABC_STEP;
    }

    // first notehead of each chart note
    const xs = [];
    let k = 0;
    part.notes.forEach((note, i) => {
      const pieces = sheet.pieces[i] || 1;
      const first = heads[k];
      xs.push(first ? first.abselem.notePositions[0].x : (xs[i - 1] ?? 40) + 30);
      noteDom.set(note.id, groups.slice(k, k + pieces));
      k += pieces;
    });
    if (k !== heads.length) console.warn(`sheet view: ${heads.length} noteheads for ${k} chart pieces`);

    // trim the long drawing to what's engraved
    const bar = [...box.querySelectorAll(".abcjs-bar")].pop();
    let contentW = (xs[xs.length - 1] ?? 0) + 40;
    try { if (bar) { const b = bar.getBBox(); contentW = Math.max(contentW, b.x + b.width + 2); } } catch (e) {}
    const svgH = +svg.getAttribute("height") || 110;
    // fingerings under each note, drawn into the same drawing so they scroll with it
    const aid = el("g", { class: "sv-aid" + (showAid ? "" : " off"), transform: `translate(0 ${svgH + 4})` }, svg);
    part.notes.forEach((note, i) => drawFingering(aid, xs[i], note.midi));
    blockH = svgH + 62; aidTop = svgH + 4;
    svg.setAttribute("width", contentW); svg.setAttribute("height", blockH);
    svg.setAttribute("viewBox", `0 0 ${contentW} ${blockH}`);
    svg.style.transform = "none";
    // abcjs clips its container (and the wrapper it adds) to the staff's height
    for (const d of [box, svg.parentElement]) if (d !== svg && d.style) { d.style.overflow = "visible"; d.style.height = ""; }

    // A later pass carries straight on from the previous one's final bar line: its clef, key and
    // time signature are hidden and it's tucked back so its first note follows that bar line.
    let left = stripW;
    if (passes.length) {
      for (const g of box.querySelectorAll(".abcjs-clef, .abcjs-key-signature, .abcjs-time-signature")) g.style.display = "none";
      left = stripW - Math.max(0, (xs[0] ?? 0) - 26);
    }
    box.style.left = left + "px";

    // time map: drop the previous pass's tail point, then add this pass's notes and its end
    if (passes.length) pts.pop();
    const ts = part.notes.map(nt => nt.t);
    const span = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 1;
    const rate = ts.length > 1 ? (xs[xs.length - 1] - xs[0]) / Math.max(1e-3, span) : 60;
    if (!passes.length && ts.length) pts.push([ts[0] - 30, left + xs[0] - 30 * rate]); // count-in
    ts.forEach((t, i) => pts.push([t, left + xs[i]]));
    const end = part.end ?? part.duration;
    const last = ts.length ? ts[ts.length - 1] : 0;
    pts.push([end + 30, left + (xs[xs.length - 1] ?? 0) + (end + 30 - last) * rate]);

    passes.push({ box, end, ids: part.notes.map(nt => nt.id) });
    stripW = left + contentW;
    layout();
  }

  function drawFingering(svg, x, midi) {
    const inf = noteInfo(midi);
    if (!inf.fing || inf.oct < 0 || inf.oct > 2) {
      el("text", { x, y: 14, "text-anchor": "middle", fill: C.faint, "font-size": 10, "font-family": "system-ui, sans-serif" }, svg).textContent = "½";
      return;
    }
    const f = inf.fing, high = inf.oct >= 1;
    const g = el("g", {}, svg);
    f.forEach((on, h) => {
      const y = 5 + h * 7.6 + (h >= 3 ? 3 : 0);
      el("circle", { cx: x, cy: y, r: 2.9, fill: on ? (high ? C.high : C.hole) : "none", stroke: high ? C.high : C.faint, "stroke-width": 1 }, g);
    });
    if (high) el("text", { x, y: 57, "text-anchor": "middle", fill: C.high, "font-size": 10, "font-family": "system-ui, sans-serif" }, g).textContent = "+";
  }

  // time → strip x
  let seg = 0;
  function xAt(t) {
    if (!pts.length) return 0;
    if (t <= pts[0][0]) return pts[0][1];
    if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    while (seg > 0 && pts[seg][0] > t) seg--;
    while (seg < pts.length - 2 && pts[seg + 1][0] <= t) seg++;
    const [t0, x0] = pts[seg], [t1, x1] = pts[seg + 1];
    return x0 + (x1 - x0) * (t - t0) / Math.max(1e-6, t1 - t0);
  }

  // layout: zoom so the staff fills a good share of the height (but stays readable on narrow
  // screens), centred vertically, playhead 30% from the left
  let W = 0, H = 0, z = 1, top = 0, phX = 0;
  function layout() {
    W = container.clientWidth; H = container.clientHeight;
    if (!W || !H || !blockH) return;
    const used = showAid ? blockH : aidTop;
    z = Math.max(0.9, Math.min(2.6, (H * 0.42) / used, W / 420));
    top = Math.max(8, (H - used * z) / 2 - H * 0.04);
    phX = Math.round(W * 0.3);
    const sY = y => top + lineY(y) * z;
    playhead.setAttribute("x", phX - 1.5); playhead.setAttribute("width", 3);
    playhead.setAttribute("y", sY(14)); playhead.setAttribute("height", sY(-2) - sY(14));
    head.setAttribute("rx", 5.4 * z); head.setAttribute("ry", 3.9 * z);
    accTxt.setAttribute("font-size", 15 * z); nameTxt.setAttribute("font-size", Math.max(12, 8 * z));
    lastGhost = null;
  }

  // the ghost notehead
  let lastGhost = null;
  function drawGhost(midi, ok) {
    const key = midi == null ? null : `${midi}:${ok}:${z}:${top}`;
    if (key === lastGhost) return;
    lastGhost = key;
    if (midi == null) { ghost.setAttribute("visibility", "hidden"); return; }
    ghost.setAttribute("visibility", "visible");
    const place = staffPlace(midi, sheet.key);
    const sY = s => top + lineY(s) * z, y = sY(place.step), color = ok ? C.ok : C.wrong;
    head.setAttribute("cx", phX); head.setAttribute("cy", y);
    head.setAttribute("transform", `rotate(-20 ${phX} ${y})`);
    head.setAttribute("fill", color); head.setAttribute("opacity", 0.9);
    ledgers.replaceChildren();
    const ledger = s => el("line", { x1: phX - 9 * z, x2: phX + 9 * z, y1: sY(s), y2: sY(s), stroke: color, "stroke-width": Math.max(1, 1.1 * z) }, ledgers);
    for (let s = 0; s >= place.step; s -= 2) ledger(s);
    for (let s = 12; s <= place.step; s += 2) ledger(s);
    accTxt.setAttribute("x", phX - 8 * z); accTxt.setAttribute("y", y + 5 * z); accTxt.setAttribute("fill", color);
    accTxt.textContent = place.acc == null ? "" : place.acc > 0 ? "♯" : place.acc < 0 ? "♭" : "♮";
    // the name sits clear of the staff: below it for low notes, above for high ones
    const below = place.step < 6;
    nameTxt.setAttribute("x", phX); nameTxt.setAttribute("fill", color);
    nameTxt.setAttribute("y", below ? Math.max(sY(-3), y + 12 * z) + 6 : Math.min(sY(15), y - 9 * z) - 4);
    nameTxt.textContent = noteName(midi);
  }

  function onEvent(e) {
    if (e.type === "hit" || e.type === "regrade") paint(e.note.id, e.grade === "perfect" ? "sv-perfect" : "sv-hit");
    else if (e.type === "miss") paint(e.note.id, "sv-miss");
  }
  const paint = (id, cls) => {
    for (const g of noteDom.get(id) || []) { g.classList.remove("sv-hit", "sv-perfect", "sv-miss"); g.classList.add(cls); }
  };

  // free passes that have scrolled well past
  function prune(t) {
    while (passes.length > 1 && passes[0].end < t - 8) {
      const p = passes.shift(); p.box.remove();
      for (const id of p.ids) noteDom.delete(id);
    }
  }

  function update(t, live) {
    prune(t);
    // Before the tune starts the staff would sit off to the right; hold it in view instead (its left
    // edge at most ~62% across), easing into the scroll so it never lurches.
    let tx = phX - xAt(t) * z;
    const cap = W * 0.62, k = W * 0.15;
    if (tx > cap - k) tx = cap - k * Math.exp(-(tx - (cap - k)) / k);
    strip.style.transform = `translate(${tx.toFixed(1)}px, ${top.toFixed(1)}px) scale(${z})`;
    const ok = live && live.expected != null && live.midi === live.expected;
    drawGhost(live && live.midi != null ? live.midi : null, ok);
  }

  addChart(chart);
  const ro = new ResizeObserver(layout); ro.observe(container);

  return {
    update, onEvent, addChart, resize: layout,
    setHalos(on) {          // in this view: the fingering strip under the staff
      showAid = !!on;
      for (const a of strip.querySelectorAll(".sv-aid")) a.classList.toggle("off", !showAid);
      layout();
    },
    destroy() { ro.disconnect(); root.remove(); },
    sheet,                  // for tests: the ABC drawn
  };
}
