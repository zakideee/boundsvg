import { defineConfig, type Options } from "tsup";

/** Keep module builds and declaration generation on the same public entries. */
const sharedConfig: Options = {
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
  // Package entries must share diagnostic constructors and Engine factory capabilities.
  splitting: true,
  shims: true,
  tsconfig: "./tsconfig.build.json",
  sourcemap: false,
  external: ["node:module"],
};

export default defineConfig([
  {
    ...sharedConfig,
    format: ["esm"],
    dts: false,
    clean: ["!**/*.cjs", "!**/*.d.cts", "!**/*.d.{ts,cts,mts}"],
  },
  {
    ...sharedConfig,
    format: ["cjs"],
    dts: false,
    // Rollup preserves native dynamic imports used by Node initialization.
    treeshake: "safest",
    clean: ["!**/*.js", "!**/*.d.ts", "!**/*.d.{ts,cts,mts}"],
  },
  {
    ...sharedConfig,
    format: ["esm", "cjs"],
    // One declaration task owns cleanup and generation for both type formats.
    dts: { only: true },
    clean: true,
  },
]);
