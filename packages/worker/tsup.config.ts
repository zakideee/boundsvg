import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "worker-script": "src/worker-script.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  tsconfig: "./tsconfig.build.json",
  sourcemap: false,
  clean: true,
  external: ["@boundsvg/core", "@boundsvg/browser"],
});
