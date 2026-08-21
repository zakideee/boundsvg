import { defineConfig } from "vite";

export default defineConfig({
  // Deploy under a GitHub Pages subpath by setting PAGES_BASE at build time
  // (e.g. "/boundsvg/playground/core/"). Defaults to "/" for local dev.
  base: process.env.PAGES_BASE ?? "/",
  server: {
    fs: {
      // Allow serving files from monorepo root (wasm pkg-web, other packages)
      allow: ["../.."],
    },
  },
  optimizeDeps: {
    // Exclude WASM glue from pre-bundling
    exclude: ["boundsvg"],
  },
});
