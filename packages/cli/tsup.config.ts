import { defineConfig } from "tsup";

const shared = {
  format: ["esm" as const],
  dts: true,
  tsconfig: "./tsconfig.build.json",
  sourcemap: false,
};

// The shebang belongs on the executable entry only; the library entries are
// imported and must not start with one.
export default defineConfig([
  {
    ...shared,
    entry: ["src/index.ts", "src/index-convert.ts"],
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
