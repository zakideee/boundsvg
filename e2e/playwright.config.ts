import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "./test-results",
  fullyParallel: false,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "interaction-dev.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox-canvas-stroke",
      testMatch: [
        "canvas-stable-outline.spec.ts",
        "clip-overflow.spec.ts",
        "svg-dom-stability.spec.ts",
        "live-interaction.spec.ts",
        "current-frame-contract.spec.ts",
        "interaction-lifecycle.spec.ts",
        "touch-input-authority.spec.ts",
        "native-frame-pose.spec.ts",
      ],
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "firefox-timeline",
      testMatch: "animated-svg-document-timeline.spec.ts",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit-interaction",
      testMatch: [
        "live-interaction.spec.ts",
        "current-frame-contract.spec.ts",
        "interaction-lifecycle.spec.ts",
        "touch-input-authority.spec.ts",
        "native-frame-pose.spec.ts",
        "clip-overflow.spec.ts",
        "svg-dom-stability.spec.ts",
      ],
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "chromium-development",
      testMatch: "interaction-dev.spec.ts",
      metadata: { isDevelopment: true },
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4175" },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @boundsvg/playground-react preview --host 127.0.0.1 --port 4174",
      port: 4174,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        "pnpm --filter @boundsvg/playground-react dev --host 127.0.0.1 --port 4175 --strictPort",
      port: 4175,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
