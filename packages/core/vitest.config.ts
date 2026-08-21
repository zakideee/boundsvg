import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const prerequisites = [
  ["./wasm-pkg/boundsvg.js", "pnpm build:wasm"],
  ["./wasm-pkg/scalar/boundsvg.js", "pnpm build:wasm"],
  ["../../fixtures/fonts/NotoSansJP-Regular.subset.ttf", "restore the licensed font fixtures"],
] as const;
const missingPrerequisites = prerequisites.filter(
  ([relativePath]) => !existsSync(fileURLToPath(new URL(relativePath, import.meta.url))),
);

if (missingPrerequisites.length > 0) {
  const details = missingPrerequisites
    .map(([relativePath, remediation]) => `- ${relativePath} (${remediation})`)
    .join("\n");
  throw new Error(`@boundsvg/core test prerequisites are missing:\n${details}`);
}

export default defineConfig({
  resolve: {
    alias: {
      // .tsx tests compile against jsxImportSource "@boundsvg/core" — map it to src, not dist
      "@boundsvg/core/jsx-dev-runtime": fileURLToPath(
        new URL("./src/vnode/jsx-dev-runtime.ts", import.meta.url),
      ),
      "@boundsvg/core/jsx-runtime": fileURLToPath(
        new URL("./src/vnode/jsx-runtime.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.ts"],
      reporter: ["text-summary", "json-summary"],
      thresholds: {
        statements: 80,
        branches: 72,
        functions: 84,
        lines: 80,
      },
    },
  },
});
