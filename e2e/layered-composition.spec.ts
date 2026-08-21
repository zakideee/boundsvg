import { expect, test } from "@playwright/test";

const HARNESS_URL = "/e2e-layered-composition.html";

test.describe("Layered Composition E2E", () => {
  test("browser recomposition matches single SVG output", async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 30_000 });
    await expect(page.getByTestId("error")).toHaveText("");

    const reportsJson = await page.getByTestId("fixture-results").textContent();
    const reports = JSON.parse(reportsJson ?? "[]") as Array<{
      id: string;
      differentPixels: number;
      width: number;
      height: number;
      layerCount: number;
    }>;

    expect(reports.length).toBeGreaterThan(0);
    for (const report of reports) {
      expect(report.layerCount, `${report.id} should emit at least one layer`).toBeGreaterThan(0);
      expect(report.width, `${report.id} width`).toBeGreaterThan(0);
      expect(report.height, `${report.id} height`).toBeGreaterThan(0);
      expect(report.differentPixels, `${report.id} should have zero pixel diff`).toBe(0);
    }
  });
});
