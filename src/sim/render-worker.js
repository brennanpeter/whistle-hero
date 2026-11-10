// Renders the simulated whistle off the main thread, so re-rendering a pass at a new tempo (about a
// second's work) doesn't freeze the game. Message: { id, abc, opts } → { id, r } or { id, error }.
import { renderAbc } from "./whistle-synth.js";

self.onmessage = e => {
  const { id, abc, opts } = e.data;
  try {
    const { samples, sr, truth } = renderAbc(abc, opts);
    self.postMessage({ id, r: { samples, sr, truth } }, [samples.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
