import { createElement, createEngineAsync } from "@boundsvg/core";
import { expect, type Page, test } from "@playwright/test";

function scene(scale: number, animated = false) {
  return createElement(
    "Canvas",
    { width: 96, height: 64 },
    createElement(
      "Box",
      {
        id: "camera",
        width: 96,
        height: 64,
        transform: { scaleX: scale, scaleY: scale, originX: 0, originY: 0 },
        ...(animated && {
          animate: {
            keyframes: [
              { at: 0, transform: { scaleX: 1.6, scaleY: 1.6 } },
              { at: 1, transform: { scaleX: 1, scaleY: 1 } },
            ],
            durationMs: 100,
            easing: "linear" as const,
            fill: "both" as const,
          },
        }),
      },
      createElement("Box", {
        id: "hairline",
        position: "absolute",
        left: 8,
        top: 8,
        width: 40,
        height: 20,
        borderWidth: 1,
        borderColor: "#ffffff",
        strokeScaling: "canvas",
      }),
    ),
  );
}

function pathScene(scale: number, animated = false) {
  return createElement(
    "Canvas",
    { width: 96, height: 64 },
    createElement(
      "Box",
      {
        id: "path-camera",
        width: 96,
        height: 64,
        transform: { scaleX: scale, scaleY: scale, originX: 0, originY: 0 },
        ...(animated && {
          animate: {
            keyframes: [
              { at: 0, transform: { scaleX: 1.6, scaleY: 1.6 } },
              { at: 1, transform: { scaleX: 1, scaleY: 1 } },
            ],
            durationMs: 100,
            easing: "linear" as const,
            fill: "both" as const,
          },
        }),
      },
      createElement("Path", {
        id: "path-hairline",
        position: "absolute",
        left: 8,
        top: 8,
        width: 40,
        height: 20,
        d: "M2 2H38V18H2Z",
        fill: "none",
        stroke: "#ffffff",
        strokeWidth: 1,
        strokeScaling: "canvas",
      }),
    ),
  );
}

function edgePathScene(scale: number) {
  return createElement(
    "Canvas",
    { width: 96, height: 64 },
    createElement(
      "Box",
      {
        width: 96,
        height: 64,
        transform: { scaleX: scale, scaleY: scale, originX: 0, originY: 0 },
      },
      createElement("Path", {
        id: "edge-path",
        position: "absolute",
        left: 8,
        top: 8,
        width: 40,
        height: 20,
        d: "M0 0H40",
        fill: "none",
        stroke: "#ffffff",
        strokeWidth: 1,
        strokeScaling: "canvas",
      }),
    ),
  );
}

async function readStrokeStyle(page: Page, svg: string, selector = ".bsvg-vstroke-hairline") {
  await page.setContent(`<main>${svg}</main>`);
  expect(await page.evaluate(() => CSS.supports("vector-effect", "non-scaling-stroke"))).toBe(true);
  const stroke = page.locator(selector);
  await expect(stroke).toHaveCount(1);
  return stroke.evaluate((element) => {
    const style = getComputedStyle(element);
    return { strokeWidth: style.strokeWidth, vectorEffect: style.vectorEffect };
  });
}

async function readColumnCoverage(page: Page, svg: string, x: number) {
  return page.evaluate(
    async ({ source, columnX }) => {
      const imageUrl = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
      try {
        const image = new Image();
        image.src = imageUrl;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          throw new TypeError("2D canvas context is unavailable");
        }
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(columnX, 0, 1, canvas.height).data;
        let alphaEnergy = 0;
        let coverageWidth = 0;
        for (let offset = 3; offset < pixels.length; offset += 4) {
          const alpha = pixels[offset] ?? 0;
          alphaEnergy += alpha;
          if (alpha > 0) {
            coverageWidth += 1;
          }
        }
        return { alphaEnergy, coverageWidth };
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
    },
    { source: svg, columnX: x },
  );
}

test("canvas stroke stays 1px under static and animated camera transforms", async ({ page }) => {
  const engine = await createEngineAsync({});
  try {
    const unitSvg = engine.renderToSvg(scene(1));
    const zoomedSvg = engine.renderToSvg(scene(1.6));
    const highResolutionSvg = engine.renderToSvg(scene(1.6), { scale: 2 });
    const svgs = [
      unitSvg,
      zoomedSvg,
      ...[0, 50, 100].map((timeMs) => engine.renderToSvg(scene(1, true), { timeMs })),
    ];
    for (const svg of svgs) {
      expect(await readStrokeStyle(page, svg)).toEqual({
        strokeWidth: "1px",
        vectorEffect: "non-scaling-stroke",
      });
    }
    expect(await readStrokeStyle(page, highResolutionSvg)).toEqual({
      strokeWidth: "2px",
      vectorEffect: "non-scaling-stroke",
    });

    const unitCoverage = await readColumnCoverage(page, unitSvg, 28);
    const zoomedCoverage = await readColumnCoverage(page, zoomedSvg, 40);
    const highResolutionCoverage = await readColumnCoverage(page, highResolutionSvg, 80);
    expect(Math.abs(zoomedCoverage.alphaEnergy - unitCoverage.alphaEnergy)).toBeLessThanOrEqual(8);
    expect(zoomedCoverage.coverageWidth).toBe(unitCoverage.coverageWidth);
    expect(
      Math.abs(highResolutionCoverage.alphaEnergy - unitCoverage.alphaEnergy * 2),
    ).toBeLessThanOrEqual(16);
  } finally {
    engine.dispose();
  }
});

test("canvas-stable Path stroke stays 1px under static and animated camera transforms", async ({
  page,
}) => {
  const engine = await createEngineAsync({});
  try {
    const unitSvg = engine.renderToSvg(pathScene(1));
    const zoomedSvg = engine.renderToSvg(pathScene(1.6));
    const highResolutionSvg = engine.renderToSvg(pathScene(1.6), { scale: 2 });
    const selector = ".bsvg-vstroke-path-hairline";
    const svgs = [
      unitSvg,
      zoomedSvg,
      ...[0, 50, 100].map((timeMs) => engine.renderToSvg(pathScene(1, true), { timeMs })),
    ];
    for (const svg of svgs) {
      expect(await readStrokeStyle(page, svg, selector)).toEqual({
        strokeWidth: "1px",
        vectorEffect: "non-scaling-stroke",
      });
    }
    expect(await readStrokeStyle(page, highResolutionSvg, selector)).toEqual({
      strokeWidth: "2px",
      vectorEffect: "non-scaling-stroke",
    });

    const unitCoverage = await readColumnCoverage(page, unitSvg, 28);
    const zoomedCoverage = await readColumnCoverage(page, zoomedSvg, 40);
    const highResolutionCoverage = await readColumnCoverage(page, highResolutionSvg, 80);
    expect(Math.abs(zoomedCoverage.alphaEnergy - unitCoverage.alphaEnergy)).toBeLessThanOrEqual(8);
    expect(zoomedCoverage.coverageWidth).toBe(unitCoverage.coverageWidth);
    expect(
      Math.abs(highResolutionCoverage.alphaEnergy - unitCoverage.alphaEnergy * 2),
    ).toBeLessThanOrEqual(16);

    const unitEdgeCoverage = await readColumnCoverage(
      page,
      engine.renderToSvg(edgePathScene(1)),
      28,
    );
    const shrunkEdgeCoverage = await readColumnCoverage(
      page,
      engine.renderToSvg(edgePathScene(0.25)),
      7,
    );
    expect(
      Math.abs(shrunkEdgeCoverage.alphaEnergy - unitEdgeCoverage.alphaEnergy),
    ).toBeLessThanOrEqual(8);
    expect(shrunkEdgeCoverage.coverageWidth).toBe(unitEdgeCoverage.coverageWidth);
  } finally {
    engine.dispose();
  }
});
