// Tiny static server for local development. No dependencies.
// Serves the repo root on http://localhost:5173 so ES modules load and the
// microphone is allowed (browsers only grant mic access on localhost or HTTPS).
//
//   npm run dev            # or: node tools/serve.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = +(process.argv[2] || process.env.PORT || 5173);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".wav": "audio/wav", ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".glb": "model/gltf-binary",
  ".abc": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep) || rel.split("/").some(p => p.startsWith(".") && p.length > 1)) {
    res.writeHead(403).end("Forbidden"); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      if (rel === "/index.html") { res.writeHead(302, { Location: "/whistle-ear.html" }).end(); return; }
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found: " + rel); return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Whistle Hero dev server: http://localhost:${port}/`);
  console.log(`  Whistle Ear  http://localhost:${port}/whistle-ear.html`);
  console.log(`  Whistle Sim  http://localhost:${port}/whistle-sim.html`);
  console.log(`  Tune Library http://localhost:${port}/tunes.html`);
});
