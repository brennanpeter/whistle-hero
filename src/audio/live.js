// Live input: runs the detector in real time on any Web Audio source (the microphone, or the
// simulator's audio for testing) and reports notes as they start, in AudioContext time.
//
//   const ctx = new AudioContext();
//   const ear = await createListener(ctx, settings);
//   ear.on("onset", ({ midi, t }) => …);   // a note started at ctx time t
//   ear.on("grace", ({ midi, t }) => …);   // a cut or tap was heard
//   ear.on("frame", frame => …);           // every analysis frame (pitch, level), for meters
//   ear.on("samples", ({ d, t }) => …);    // the raw audio, a block at a time (d ends at ctx time t)
//   await ear.useMicrophone();             // or: ear.input(someAudioNode)
//   ear.stop();
import { WIN, HOP, DEFAULT_SETTINGS, makeSession, feed } from "./detector.js";

const WORKLET = `class Tap extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(${HOP});this.i=0}
process(inputs){const ch=inputs[0]&&inputs[0][0];if(ch){for(let k=0;k<ch.length;k++){this.b[this.i++]=ch[k];
if(this.i===${HOP}){this.port.postMessage({d:this.b.slice(0),t:(currentFrame+k+1)/sampleRate});this.i=0}}}return true}}
registerProcessor('whistle-tap',Tap);`;
const loaded = new WeakSet();

export async function createListener(ctx, settings = { ...DEFAULT_SETTINGS }) {
  const S = makeSession(settings), win = new Float32Array(WIN), sr = ctx.sampleRate;
  const handlers = { onset: [], grace: [], frame: [], samples: [] };
  const emit = (type, e) => { for (const f of handlers[type]) f(e); };
  let lastCur = null, announced = new WeakSet(), segsSeen = 0, stream = null;

  function chunk(d, tEnd) {
    if (handlers.samples.length) emit("samples", { d, t: tEnd });
    win.copyWithin(0, HOP); win.set(d, WIN - HOP);
    const fr = feed(S, tEnd - WIN / (2 * sr), win, sr);
    emit("frame", fr);
    // a note is reported as soon as the detector commits to it
    if (S.cur && S.cur !== lastCur) {
      lastCur = S.cur;
      emit("onset", { midi: S.cur.midi, t: S.cur.start, tongued: S.cur.tongued });
    }
    // closed segments: short ones are cuts and taps (some were never the current note)
    for (; segsSeen < S.segs.length; segsSeen++) {
      const s = S.segs[segsSeen];
      if (s.dur * 1000 <= settings.grace) emit("grace", { midi: s.midi, t: s.start, dur: s.dur });
    }
    // keep memory bounded on long sessions
    if (S.frames.length > 4000) S.frames.splice(0, 2000);
    if (S.segs.length > 600) { S.segs.splice(0, 300); segsSeen -= 300; }
  }

  const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
  let node;
  try {
    if (!loaded.has(ctx)) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(url); loaded.add(ctx);
    }
    node = new AudioWorkletNode(ctx, "whistle-tap");
    node.port.onmessage = e => chunk(e.data.d, e.data.t);
  } catch (e) {
    node = ctx.createScriptProcessor(1024, 1, 1); // older browsers
    node.onaudioprocess = ev => {
      const d = ev.inputBuffer.getChannelData(0), t = ctx.currentTime;
      for (let k = 0; k < 4; k++) chunk(d.slice(k * HOP, (k + 1) * HOP), t - (3 - k) * HOP / sr);
    };
  }
  node.connect(sink);
  const sources = [];

  return {
    session: S,
    on(type, fn) { handlers[type].push(fn); },
    input(src) { src.connect(node); sources.push(src); },
    async useMicrophone() {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-media");
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const src = ctx.createMediaStreamSource(stream); this.input(src);
      const tr = stream.getAudioTracks()[0], set = tr.getSettings ? tr.getSettings() : {};
      return { inputLatency: set.latency || 0, label: tr.label };
    },
    stop() {
      for (const s of sources) { try { s.disconnect(); } catch (e) {} }
      try { node.disconnect(); sink.disconnect(); } catch (e) {}
      if (stream) stream.getTracks().forEach(t => t.stop());
    },
  };
}
