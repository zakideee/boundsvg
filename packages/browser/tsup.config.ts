import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "tsup";

const esmEntries = {
  index: "src/index.ts",
  wasm: "src/wasm.ts",
  png: "src/png.ts",
  fonts: "src/fonts.ts",
  assets: "src/assets.ts",
  events: "src/events.ts",
};

const cjsEntries = {
  png: "src/png.ts",
  fonts: "src/fonts.ts",
  assets: "src/assets.ts",
  events: "src/events.ts",
};

export default defineConfig((cliOptions) => {
  const isCjsBuild = Array.isArray(cliOptions.format)
    ? cliOptions.format.includes("cjs")
    : cliOptions.format === "cjs";

  return {
    entry: isCjsBuild ? cjsEntries : esmEntries,
    format: [isCjsBuild ? "cjs" : "esm"],
    dts: !isCjsBuild,
    tsconfig: "./tsconfig.build.json",
    sourcemap: false,
    clean: !isCjsBuild,
    external: ["@boundsvg/core", "@boundsvg/core/scene", "@boundsvg/core/wasm"],
    outExtension({ format }) {
      return { js: format === "cjs" ? ".cjs" : ".js" };
    },
    async onSuccess() {
      if (isCjsBuild) {
        return;
      }
      await cp(
        resolve("../../crates/boundsvg/pkg-web/boundsvg_bg.wasm"),
        resolve("dist/boundsvg_bg.wasm"),
      );
      await mkdir(resolve("dist/scalar"), { recursive: true });
      await cp(
        resolve("../../crates/boundsvg/pkg-web/scalar/boundsvg_bg.wasm"),
        resolve("dist/scalar/boundsvg_bg.wasm"),
      );
    },
  };
});
