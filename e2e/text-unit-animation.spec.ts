import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createElement, createEngineAsync } from "@boundsvg/core";
import { expect, type Page, test } from "@playwright/test";

async function measureTextGroup(page: Page, svg: string) {
  await page.setContent(`<main>${svg}</main>`);
  const textGroup = page.locator('[aria-label="A"]');
  await expect(textGroup).toHaveCount(1);
  const bbox = await textGroup.boundingBox();
  if (!bbox) {
    throw new TypeError("Animated Text group has no browser bbox");
  }
  return bbox;
}

test("declarative text-unit transforms use the baked user-space origin", async ({ page }) => {
  const engine = await createEngineAsync({});
  try {
    engine.registerFonts([
      {
        alias: "NotoSansJP",
        weight: 400,
        style: "normal",
        data: new Uint8Array(
          await readFile(resolve(__dirname, "../fixtures/fonts/NotoSansJP-Regular.subset.ttf")),
        ),
      },
    ]);
    const fixedTransform = {
      translateX: 36,
      translateY: 8,
      rotateDeg: 18,
      scaleX: 1.2,
      scaleY: 0.8,
    };
    const scene = createElement(
      "Canvas",
      { width: 240, height: 120 },
      createElement(
        "Text",
        {
          id: "browser-unit",
          font: "NotoSansJP",
          fontSizePx: 52,
          animateUnits: {
            by: "cluster",
            animation: {
              keyframes: [
                { at: 0, transform: fixedTransform },
                { at: 1, transform: fixedTransform },
              ],
              durationMs: 10_000,
              easing: "linear",
              fill: "both",
            },
          },
        },
        "A",
      ),
    );
    const declarativeSvg = engine.renderToAnimatedSvg(scene, {
      playback: { mode: "independent" },
      timeMs: 0,
    });
    const staticSvg = engine.renderToSvg(scene, { timeMs: 0 });

    const declarativeBBox = await measureTextGroup(page, declarativeSvg);
    const unitStyle = await page.locator('[class*="unit:0"]').evaluate((element) => {
      const style = getComputedStyle(element);
      return { transformBox: style.transformBox, transformOrigin: style.transformOrigin };
    });
    expect(unitStyle).toEqual({ transformBox: "view-box", transformOrigin: "0px 0px" });

    const staticBBox = await measureTextGroup(page, staticSvg);
    expect(declarativeBBox.x).toBeCloseTo(staticBBox.x, 1);
    expect(declarativeBBox.y).toBeCloseTo(staticBBox.y, 1);
    expect(declarativeBBox.width).toBeCloseTo(staticBBox.width, 1);
    expect(declarativeBBox.height).toBeCloseTo(staticBBox.height, 1);
  } finally {
    engine.dispose();
  }
});
