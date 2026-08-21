import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const packageDirectory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: resolve(packageDirectory, "browser"),
  base: "./",
  publicDir: false,
  worker: {
    format: "es",
  },
  build: {
    emptyOutDir: true,
    outDir: resolve(packageDirectory, "../../_build/bench/layout-transition-browser"),
    rollupOptions: {
      input: resolve(packageDirectory, "browser/layout-transition.html"),
    },
  },
});
