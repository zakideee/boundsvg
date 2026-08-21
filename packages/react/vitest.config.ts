import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["text-summary", "json-summary"],
      thresholds: {
        statements: 40,
        branches: 75,
        functions: 80,
        lines: 40,
      },
    },
  },
});
