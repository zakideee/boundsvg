import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Deploy under a GitHub Pages subpath by setting PAGES_BASE at build time
// (e.g. "/boundsvg/playground/react/"). Defaults to "/" for local dev.
const pagesBase = process.env.PAGES_BASE;

// The Pages build ships only the main app. The e2e harness pages are internal
// Playwright scaffolding (they assume base "/") and must not be published.
const input = pagesBase
  ? { main: resolve(__dirname, "index.html") }
  : {
      main: resolve(__dirname, "index.html"),
      "e2e-layered-composition": resolve(__dirname, "e2e-layered-composition.html"),
      "e2e-worker": resolve(__dirname, "e2e-worker.html"),
      "e2e-determinism": resolve(__dirname, "e2e-determinism.html"),
    };

export default defineConfig({
  base: pagesBase ?? "/",
  plugins: [react()],
  server: {
    fs: {
      // Allow serving files from monorepo root (wasm pkg-web, other packages)
      allow: ["../.."],
    },
  },
  worker: {
    format: "es",
  },
  build: {
    rollupOptions: {
      input,
    },
  },
  optimizeDeps: {
    // Exclude WASM glue from pre-bundling
    exclude: ["boundsvg"],
  },
});
