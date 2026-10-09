import { defineConfig } from "tsup";

/** Common ESM, declaration, and TypeScript settings for library and executable builds. */
const shared = {
  format: ["esm" as const],
  dts: true,
  tsconfig: "./tsconfig.build.json",
  sourcemap: false,
};

// Only bin.ts executes commands and receives a shebang. Root and animation
// entries remain importable libraries without command execution.
export default defineConfig([
  {
    ...shared,
    entry: ["src/index.ts", "src/animation.ts"],
    clean: true,
  },
  {
    ...shared,
    entry: ["src/bin.ts"],
    clean: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
