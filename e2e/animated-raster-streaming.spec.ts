import { expect, test } from "@playwright/test";

for (const format of ["webp", "gif"] as const) {
  for (const frameCount of [60, 326, 1001] as const) {
    for (const route of ["core-file", "worker-forward"] as const) {
      test(`${format} ${frameCount} frames through ${route}`, async ({ page }, testInfo) => {
        const messages: string[] = [];
        page.on("console", (message) => messages.push(`${message.type()}: ${message.text()}`));
        page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));
        await page.goto("/e2e-animated-raster.html");
        await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 30_000 });
        const observations = [];
        for (let repetition = 0; repetition < 3; repetition += 1) {
          const observation = await page.evaluate(
            async (fixture) => {
              const harness = window.boundsvgAnimatedRaster;
              if (!harness) {
                throw new Error("Missing animated raster harness");
              }
              return harness.render(fixture);
            },
            { format, frameCount, route },
          );
          observations.push(observation);
          expect(observation).toMatchObject({
            format,
            frameCount,
            finishCalls: 1,
            temporaryEntriesAfter: 0,
            isRiffSizeCorrect: true,
            isGifTrailerCorrect: true,
          });
          expect(observation.storedBytes).toBe(observation.bytesWritten);
          expect(observation.maximumChunk).toBeLessThanOrEqual(65_536);
          expect(observation.maximumPendingWrites).toBe(1);
          expect(observation.patches).toBe(format === "webp" && route === "core-file" ? 1 : 0);
          expect(observation.elapsedMs).toBeGreaterThan(0);
        }
        expect(new Set(observations.map((observation) => observation.sha256)).size).toBe(1);
        await testInfo.attach("observations", {
          body: JSON.stringify({ format, frameCount, route, observations, messages }),
          contentType: "application/json",
        });
        expect(messages.filter((message) => message.startsWith("pageerror:"))).toEqual([]);
      });
    }
  }
}
