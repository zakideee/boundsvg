import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    provider: "src/provider.tsx",
    worker: "src/worker.ts",
    png: "src/png.ts",
    interactive: "src/interactive.ts",
    debug: "src/debug.tsx",
    inspect: "src/inspect.tsx",
    assets: "src/assets.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  tsconfig: "./tsconfig.build.json",
  sourcemap: false,
  clean: true,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@boundsvg/core",
    "@boundsvg/core/scene",
    "@boundsvg/core/inspect",
    "@boundsvg/core/wasm",
    "@boundsvg/browser",
    "@boundsvg/browser/assets",
    "@boundsvg/browser/fonts",
    "@boundsvg/browser/png",
  ],
  esbuildOptions(options, context) {
    options.jsx = "automatic";
    options.jsxImportSource = "react";
    if (context.format === "cjs") {
      // import.meta.url is used only by the default ESM Worker creation path.
      // Silence the esbuild warning for CJS output where it becomes empty.
      options.logOverride = {
        ...options.logOverride,
        "empty-import-meta": "silent",
      };
    }
  },
});
