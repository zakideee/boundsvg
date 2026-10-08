import { createElement, createEngineAsync, type VNode } from "@boundsvg/core";
import { expect, type Page, test } from "@playwright/test";
import { verifyPathGeometry } from "../packages/browser/src/svg-event-utils.js";

function pathScene(isNegative: boolean, clipRadius?: number): VNode {
  return createElement(
    "Canvas",
    { width: 300, height: 100, background: "#ffffff" },
    createElement(
      "Box",
      {
        position: "absolute",
        left: isNegative ? 150 : 100,
        top: 20,
        width: 40,
        height: 40,
        overflow: clipRadius === undefined ? "visible" : "clip",
        borderRadius: clipRadius,
      },
      createElement("Path", {
        id: "arrow",
        width: 40,
        height: 40,
        fill: "#ff0000",
        onClick: "arrow-click",
        d: isNegative ? "M-100 0L40 0L40 40Z" : "M0 0L120 0L120 40Z",
      }),
    ),
  );
}

async function pixelAt(
  page: Page,
  svg: string,
  point: { x: number; y: number },
): Promise<number[]> {
  return page.evaluate(
    async ({ source, pixelX, pixelY }) => {
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
          throw new TypeError("2D context is unavailable");
        }
        context.drawImage(image, 0, 0);
        return [...context.getImageData(pixelX, pixelY, 1, 1).data];
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
    },
    { source: svg, pixelX: point.x, pixelY: point.y },
  );
}

test("browser paints rounded child clips and visible positive/negative Path overflow", async ({
  page,
}) => {
  const engine = await createEngineAsync({});
  try {
    const card = createElement(
      "Canvas",
      { width: 120, height: 120, background: "#ffffff" },
      createElement(
        "Box",
        {
          id: "card",
          position: "absolute",
          left: 10,
          top: 10,
          width: 100,
          height: 100,
          borderRadius: 50,
          overflow: "clip",
          onClick: "card-click",
        },
        createElement("Box", { width: 100, height: 100, background: "#ff0000" }),
      ),
    );
    const cardSvg = engine.renderToSvg(card);
    expect(await pixelAt(page, cardSvg, { x: 12, y: 12 })).toEqual([255, 255, 255, 255]);
    expect(await pixelAt(page, cardSvg, { x: 60, y: 60 })).toEqual([255, 0, 0, 255]);
    expect(engine.hitTest(engine.renderToIR(card), 12, 12)).toBe("card");

    const pathCard = createElement(
      "Canvas",
      { width: 120, height: 120, background: "#ffffff" },
      createElement(
        "Box",
        {
          width: 100,
          height: 100,
          position: "absolute",
          left: 10,
          top: 10,
          borderRadius: 50,
          overflow: "clip",
        },
        createElement("Path", {
          id: "card-content",
          width: 100,
          height: 100,
          d: "M0 0H100V100H0Z",
          fill: "#ff0000",
          onClick: "content-click",
        }),
      ),
    );
    const pathCardSvg = engine.renderToSvg(pathCard);
    expect(await pixelAt(page, pathCardSvg, { x: 12, y: 12 })).toEqual([255, 255, 255, 255]);
    expect(engine.hitTest(engine.renderToIR(pathCard), 12, 12)).toBe("card-content");
    await page.setContent(`<style>body { margin: 0 }</style>${pathCardSvg}`);
    await page.addScriptTag({
      content: `globalThis.verifyPathGeometry = ${verifyPathGeometry.toString()};`,
    });
    const clippedCornerGeometry = await page.evaluate(() => {
      const verify = (window as unknown as { verifyPathGeometry: typeof verifyPathGeometry })
        .verifyPathGeometry;
      return verify(document.body, "card-content", 12, 12);
    });
    // This records the unresolved gap: geometry does not subtract rounded ancestor clips.
    expect(clippedCornerGeometry).toBe(true);

    for (const isNegative of [false, true]) {
      const scene = pathScene(isNegative);
      const svg = engine.renderToSvg(scene);
      const outsideX = isNegative ? 100 : 200;
      expect(await pixelAt(page, svg, { x: outsideX, y: 30 })).toEqual([255, 0, 0, 255]);
      expect(engine.hitTest(engine.renderToIR(scene), outsideX, 30)).toBeNull();
      for (const clipRadius of [0, 20]) {
        expect(
          await pixelAt(page, engine.renderToSvg(pathScene(isNegative, clipRadius)), {
            x: outsideX,
            y: 30,
          }),
        ).toEqual([255, 255, 255, 255]);
      }

      await page.setContent(`<style>body { margin: 0 }</style>${svg}`);
      await page.addScriptTag({
        content: `globalThis.verifyPathGeometry = ${verifyPathGeometry.toString()};`,
      });
      const wrapper = page.locator('svg[data-boundsvg-node-id="arrow"]');
      await expect(wrapper).toHaveAttribute("overflow", "visible");
      await expect(wrapper.locator("path")).toHaveCount(1);
      const geometry = await page.evaluate(
        ({ insideX, outsideX: tailX }) => {
          const verify = (window as unknown as { verifyPathGeometry: typeof verifyPathGeometry })
            .verifyPathGeometry;
          return {
            inside: verify(document.body, "arrow", insideX, 25),
            empty: verify(document.body, "arrow", insideX, 59),
            tail: verify(document.body, "arrow", tailX, 30),
          };
        },
        { insideX: isNegative ? 180 : 130, outsideX },
      );
      expect(geometry).toEqual({ inside: true, empty: false, tail: true });
    }
  } finally {
    engine.dispose();
  }
});
