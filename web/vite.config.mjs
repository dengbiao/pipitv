import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";
import { tvPreview } from './scripts/tv-preview.mjs';

export default defineConfig({
  base: "./",
  publicDir: "../public",
  build: {
    outDir: "dist/client",
    target: "chrome61",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [tvPreview(), react(), legacy({ targets: ['Chrome >= 53'], modernPolyfills: ['es.array.at', 'es.global-this', 'es.object.from-entries', 'es.object.has-own'] })],
});
