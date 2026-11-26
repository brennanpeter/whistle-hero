// The real-time simulated whistle: an AudioWorklet that plays performances (see perform() in
// whistle-synth.js) on the game clock, a sample at a time, so tempo changes are followed the moment
// they happen. One node plays one part for a whole session (the simulated player, or the guide), so
// its breath, room and reverb carry on from pass to pass.
//
// Messages to the node's port:
//   { pass: { first, f0, items } }  a pass: its performance's items (in the performance's own seconds,
//                                   rendered at the tempo the pass was laid out at), `f0` its first
//                                   note's time in the performance, `first` that note's game time
//   { clock }                       the game clock changed (a tempo change, a new pass): see clock.js
//   { stop: true }                  finish
// processorOptions: { options (a performance's resolved options), firstMidi, clock }
import { createControl, createVoice } from "./voice.js";
import { gameTime } from "../game/clock.js";

class WhistleSim extends AudioWorkletProcessor {
  constructor({ processorOptions: o }) {
    super();
    this.clock = o.clock;
    this.voice = createVoice(o.options, sampleRate, o.firstMidi);
    this.passes = [];
    this.idle = { tm: o.firstMidi, ta: 0, stop: false, owner: null, chiff: false };
    this.done = false;
    this.port.onmessage = e => {
      const m = e.data;
      if (m.clock) this.clock = m.clock;
      if (m.pass) this.add(m.pass);
      if (m.stop) this.done = true;
    };
  }
  add({ first, f0, items }) {
    if (!items.length) return;
    const lead = items[0].start - (items[0].tongueS || 0);
    // a pass takes over as its first tongue stop begins (passes follow one another, so they don't overlap)
    this.passes.push({ first, f0, ctl: createControl(items, sampleRate), from: first + (lead - f0) - 0.02 });
    this.passes.sort((a, b) => a.from - b.from);
  }
  process(inputs, outputs) {
    if (this.done) return false;
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const n = out.length, a0 = currentTime;
    // game time across this block (128 samples, under 3 ms: a straight line is exact enough)
    const g0 = gameTime(a0, this.clock), g1 = gameTime(a0 + n / sampleRate, this.clock);
    const P = this.passes;
    // passes well behind are done with
    while (P.length > 1 && P[1].from <= g0 - 5) P.shift();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const g = g0 + ((g1 - g0) * i) / n;
      while (k + 1 < P.length && P[k + 1].from <= g) k++;
      const p = P[k];
      if (p && p.from <= g) {
        const pos = (p.f0 + (g - p.first)) * sampleRate;
        const c = p.ctl.at(pos);
        this.idle.tm = c.tm;
        out[i] = this.voice.next(c, pos);
      } else out[i] = this.voice.next(this.idle, 0);
    }
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    return true;
  }
}

registerProcessor("whistle-sim", WhistleSim);
