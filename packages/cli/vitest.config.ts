import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.ts"],
      reporter: ["text-summary", "json-summary"],
      // Thresholds sit just under measured coverage. Ratchet upward only.
      thresholds: {
        statements: 56,
        branches: 65,
        functions: 70,
        lines: 56,
      },
    },
  },
});
