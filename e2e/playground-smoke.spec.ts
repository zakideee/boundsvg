import { expect, type Page, test } from "@playwright/test";

const REPRESENTATIVE_ROUTES = ["templates", "playground", "worker"] as const;

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

async function openRoute(page: Page, route: string): Promise<void> {
  await page.goto(`/#/${route}`);
  await expect(page.getByText("Engine ready")).toBeVisible({ timeout: 30_000 });
  await expect(renderedSvg(page)).toBeVisible({
    timeout: 30_000,
  });
}

function renderedSvg(page: Page) {
  return page
    .locator(
      "main .rendered-content svg, main .visual-editor-render svg, main svg:has([data-boundsvg-text])",
    )
    .first();
}

test.describe("public playground smoke", () => {
  for (const route of REPRESENTATIVE_ROUTES) {
    test(`#/${route} renders without browser errors`, async ({ page }) => {
      const errors = collectPageErrors(page);
      await openRoute(page, route);
      expect(errors).toEqual([]);
    });
  }

  test("a shape control change reaches the renderer", async ({ page }) => {
    await openRoute(page, "shapes");
    const svg = renderedSvg(page);
    const before = await svg.innerHTML();

    await page.locator("main select").first().selectOption({ index: 1 });

    await expect
      .poll(async () => (await svg.innerHTML()) !== before, { timeout: 15_000 })
      .toBe(true);
  });

  test("the template debug control changes public SVG output", async ({ page }) => {
    await openRoute(page, "templates");
    const overlay = page.locator("main svg g.debug-overlay");
    await expect(overlay).toHaveCount(0);

    await page.locator("summary", { hasText: "BBox Overlay" }).first().click();
    await page.locator('label:has-text("node bounds")').first().click();

    await expect(overlay.first()).toBeVisible({ timeout: 15_000 });
  });
});
