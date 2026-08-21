import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    vitest: "src/vitest.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  tsconfig: "./tsconfig.build.json",
  sourcemap: false,
  clean: true,
  external: ["@boundsvg/core", "vitest"],
});
