import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  tsconfig: "./tsconfig.build.json",
  sourcemap: false,
  clean: true,
  external: ["@boundsvg/core"],
  async onSuccess() {
    // The bundled muxer glue resolves its binary next to the emitted module,
    // so the wasm has to sit alongside dist/index.js.
    await cp(resolve("wasm-pkg/boundmp4_bg.wasm"), resolve("dist/boundmp4_bg.wasm"));
  },
});
