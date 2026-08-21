import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "jsx-runtime": "src/vnode/jsx-runtime.ts",
    "jsx-dev-runtime": "src/vnode/jsx-dev-runtime.ts",
    node: "src/node.ts",
    scene: "src/scene.ts",
    inspect: "src/inspect.ts",
    vnode: "src/vnode-utils.ts",
    svg: "src/svg.ts",
    codegen: "src/codegen.ts",
    wasm: "src/wasm.ts",
  },
  format: ["esm", "cjs"],
  shims: true,
  dts: true,
  tsconfig: "./tsconfig.build.json",
  sourcemap: false,
  clean: true,
  external: ["node:module"],
});
