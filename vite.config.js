// Vite serves every page in development (npm run dev) and bundles them for deployment (npm run build).
import { defineConfig } from "vite";
import { resolve } from "node:path";

const page = name => resolve(import.meta.dirname, name);

export default defineConfig({
  server: { port: 5173, open: false },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 800, // three.js alone is ~550 kB before gzip
    rollupOptions: {
      input: {
        index: page("index.html"),
        play: page("play.html"),
        tunes: page("tunes.html"),
        ear: page("whistle-ear.html"),
        sim: page("whistle-sim.html"),
      },
    },
  },
});
