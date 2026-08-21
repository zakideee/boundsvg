import { expect, test } from "@playwright/test";

const HARNESS_URL = "/e2e-worker.html";

test.describe("Worker Pipeline E2E", () => {
  test("Worker initializes successfully with WASM and fonts", async ({ page }) => {
    await page.goto(HARNESS_URL);

    await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 30_000 });
    await expect(page.getByTestId("has-worker-engine")).toHaveText("true");
    await expect(page.getByTestId("error")).toHaveText("");
  });

  test("renders SVG via Worker", async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 30_000 });
    await expect(page.getByTestId("has-worker-engine")).toHaveText("true");

    await expect(page.getByTestId("svg-ready")).toHaveText("true", { timeout: 30_000 });
    await expect(page.getByTestId("svg-error")).toHaveText("");

    const svgOutput = page.getByTestId("svg-output");
    await expect(svgOutput).toBeVisible();

    const svgElement = svgOutput.locator("svg");
    await expect(svgElement).toHaveCount(1);
    const viewBox = await svgElement.getAttribute("viewBox");
    expect(viewBox).toBeTruthy();

    const svgHtml = await svgOutput.innerHTML();
    expect(svgHtml).toContain("Worker E2E Test");
    expect(svgHtml).toContain("@keyframes");
    expect(svgHtml).toContain("unit:0");
  });

  test("renders PNG via Worker", async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 30_000 });

    await expect(page.getByTestId("png-ready")).toHaveText("true", { timeout: 30_000 });
    await expect(page.getByTestId("png-error")).toHaveText("");

    const pngImg = page.getByTestId("png-output");
    await expect(pngImg).toBeVisible();
    const src = await pngImg.getAttribute("src");
    expect(src).toMatch(/^data:image\/png;base64,/);

    const byteLength = await page.getByTestId("png-byte-length").textContent();
    expect(Number(byteLength)).toBeGreaterThan(100);
  });

  test("matches direct rendering, text-unit frames, and materialized layout scenes", async ({
    page,
  }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 30_000 });
    await expect(page.getByTestId("has-worker-engine")).toHaveText("true");
    await expect(page.getByTestId("route-parity-ready")).toHaveText("true", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("route-parity-error")).toHaveText("");
    await expect(page.getByTestId("route-parity-ok")).toHaveText("true");
    await expect(page.getByTestId("route-parity-count")).toHaveText("27");
    await expect(page.getByTestId("text-unit-ir-parity-ok")).toHaveText("true");
    await expect(page.getByTestId("text-path-ir-parity-ok")).toHaveText("true");
    await expect(page.getByTestId("materialized-text-unit-identity-ok")).toHaveText("true");
    await expect(page.getByTestId("flowed-text-unit-identity-ok")).toHaveText("true");
    await expect(page.getByTestId("materialized-text-path-identity-ok")).toHaveText("true");
    await expect(page.getByTestId("pool-parity-ok")).toHaveText("true");
    await expect(page.getByTestId("pool-lifecycle-recovery-ok")).toHaveText("true");
    expect(Number(await page.getByTestId("pool-startup-ms-one").textContent())).toBeGreaterThan(0);
    expect(Number(await page.getByTestId("pool-startup-ms-default").textContent())).toBeGreaterThan(
      0,
    );
    expect(Number(await page.getByTestId("pool-font-bytes").textContent())).toBeGreaterThan(0);
    await expect(page.getByTestId("materialized-parity-ok")).toHaveText("true");
    await expect(page.getByTestId("materialized-fixture-count")).toHaveText("27");
    await expect(page.getByTestId("typing-composition-parity-ok")).toHaveText("true");
    await expect(page.getByTestId("materialized-layout-changes")).toHaveText("true");
    await expect(page.getByTestId("materialized-exclusion-margin-ok")).toHaveText("true");
  });

  test("Worker init failure falls back to main thread", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") {
        warnings.push(msg.text());
      }
    });

    // Pass a broken Worker URL via query param — the harness reads ?workerUrl=
    await page.goto(`${HARNESS_URL}?workerUrl=/missing-worker.js`);

    // Provider should still reach "ready" via main-thread fallback
    await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 30_000 });

    // WorkerEngine should be null (fallen back to main-thread Engine)
    await expect(page.getByTestId("has-worker-engine")).toHaveText("false");

    // Verify the fallback warning was logged
    expect(warnings.some((w) => w.includes("Worker initialization failed"))).toBe(true);
  });
});
