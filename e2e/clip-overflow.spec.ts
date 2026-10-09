import { createElement, createEngineAsync, type VNode } from "@boundsvg/core";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../apps/playground-react/src/e2e/e2e-clip-hit-harness.js";
import { verifyPathGeometry } from "../packages/browser/src/svg-event-utils.js";

/** Build the signed-coordinate paint fixture with an optional explicit parent clip. */
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

/** Decode a PNG and read one independent paint oracle pixel. */
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
    expect(engine.hitTest(engine.renderToIR(card), 12, 12)).toBeNull();

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
    expect(engine.hitTest(engine.renderToIR(pathCard), 12, 12)).toBeNull();
    await page.setContent(`<style>body { margin: 0 }</style>${pathCardSvg}`);
    await page.addScriptTag({
      content: `globalThis.verifyPathGeometry = ${verifyPathGeometry.toString()};`,
    });
    const clippedCornerGeometry = await page.evaluate(() => {
      const verify = (window as unknown as { verifyPathGeometry: typeof verifyPathGeometry })
        .verifyPathGeometry;
      return verify(document.body, "card-content", 12, 12);
    });
    // Geometry refinement is combined with Core clip gates; the primitive itself tests only Path paint.
    expect(clippedCornerGeometry).toBe(true);

    for (const isNegative of [false, true]) {
      const scene = pathScene(isNegative);
      const svg = engine.renderToSvg(scene);
      const outsideX = isNegative ? 100 : 200;
      expect(await pixelAt(page, svg, { x: outsideX, y: 30 })).toEqual([255, 0, 0, 255]);
      expect(engine.hitTest(engine.renderToIR(scene), outsideX, 30)).toBe("arrow");
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

/** Mount the real React component with its web WASM owner, including shadow-host variants. */
async function mountInteractive(
  page: Page,
  scene: VNode,
  options: { shadow?: boolean; scale?: number; timeMs?: number } = {},
): Promise<void> {
  await page.goto("/e2e-clip-hit.html");
  await page.evaluate(({ vnode, config }) => window.boundsvgClipHit.mount(vnode, config), {
    vnode: scene,
    config: options,
  });
  await expect
    .poll(() => page.evaluate(() => window.boundsvgClipHit.read()))
    .toMatchObject({ ready: true, error: null });
}

/** Include an interactive back sibling to make a lost Path candidate observable. */
function interactivePathScene(
  options: {
    negative?: boolean;
    underlay?: boolean;
    stroke?: boolean;
    empty?: boolean;
    zeroViewport?: boolean;
  } = {},
): VNode {
  return createElement(
    "Canvas",
    { width: 300, height: 100, background: "white" },
    ...(options.underlay === false
      ? []
      : [
          createElement("Box", {
            id: "underlay",
            position: "absolute",
            left: 0,
            top: 0,
            width: 300,
            height: 100,
            background: "blue",
            onClick: "underlay-click",
            onPointerUp: "underlay-up",
          }),
        ]),
    createElement("Path", {
      id: "path",
      position: "absolute",
      left: options.stroke ? 50 : options.negative ? 150 : 100,
      top: options.stroke ? 50 : 20,
      width: options.zeroViewport ? 0 : 40,
      height: options.zeroViewport ? 0 : 40,
      d: options.stroke
        ? "M0 0H100"
        : options.empty
          ? "M0 0H120V40H0ZM30 10H80V30H30Z"
          : options.negative
            ? "M-100 0L40 0L40 40Z"
            : "M0 0L120 0L120 40Z",
      fill: options.stroke ? "none" : "red",
      fillRule: options.empty ? "evenodd" : undefined,
      stroke: options.stroke ? "red" : undefined,
      strokeWidth: options.stroke ? 20 : undefined,
      strokeLinejoin: options.stroke ? "round" : undefined,
      strokeScaling: options.stroke ? "canvas" : undefined,
      onClick: "path-click",
      onPointerDown: "path-down",
      onPointerUp: "path-up",
    }),
  );
}

/** Return only click callbacks, preserving native event and semantic id fields for assertions. */
async function clickDeliveries(page: Page) {
  return page.evaluate(() =>
    window.boundsvgClipHit.read().callbacks.filter((delivery) => delivery.eventType === "click"),
  );
}

for (const shadow of [false, true]) {
  for (const negative of [false, true]) {
    for (const underlay of [false, true]) {
      test(`mounted React resolves ${negative ? "negative" : "positive"} overflow once (shadow=${shadow}, underlay=${underlay})`, async ({
        page,
      }) => {
        await mountInteractive(page, interactivePathScene({ negative, underlay }), { shadow });
        await page.mouse.click(negative ? 100 : 200, 30);
        expect(await clickDeliveries(page)).toEqual([
          {
            nodeId: "path",
            handlerName: "path-click",
            eventType: "click",
            svgX: negative ? 100 : 200,
            svgY: 30,
          },
        ]);
      });
    }
  }
}

for (const container of ["Box", "Flex", "Grid"] as const) {
  for (const radius of [undefined, 0, 50, [50, 0, 25, 0], 200] as const) {
    for (const parentInteractive of [false, true]) {
      test(`mounted ${container} clip radius=${JSON.stringify(radius)} excludes owner/child corners (interactive=${parentInteractive})`, async ({
        page,
      }) => {
        const scene = createElement(
          "Canvas",
          { width: 300, height: 120, background: "white" },
          createElement("Box", {
            id: "underlay",
            width: 300,
            height: 120,
            position: "absolute",
            background: "blue",
            onClick: "underlay-click",
          }),
          createElement(
            container,
            {
              id: "card",
              left: 10,
              top: 10,
              position: "absolute",
              width: 100,
              height: 100,
              borderRadius:
                typeof radius === "number" || radius === undefined
                  ? radius
                  : [radius[0], radius[1], radius[2], radius[3]],
              overflow: "clip",
              onClick: parentInteractive ? "card-click" : undefined,
            },
            createElement("Path", {
              id: "path",
              width: 100,
              height: 100,
              d: "M0 0H100V100H0Z",
              fill: "red",
              onClick: "path-click",
            }),
          ),
        );
        await mountInteractive(page, scene);
        await page.mouse.click(12, 12);
        expect((await clickDeliveries(page)).map((delivery) => delivery.nodeId)).toEqual([
          radius === undefined || radius === 0 ? (parentInteractive ? "card" : "path") : "underlay",
        ]);
        await page.evaluate(() => window.boundsvgClipHit.clearCallbacks());
        await page.mouse.click(60, 60);
        expect((await clickDeliveries(page)).map((delivery) => delivery.nodeId)).toEqual([
          parentInteractive ? "card" : "path",
        ]);
      });
    }
  }
}

test("mounted Path holes fall through to the back sibling", async ({ page }) => {
  await mountInteractive(page, interactivePathScene({ empty: true }));
  await page.mouse.click(150, 40);
  expect((await clickDeliveries(page)).map((delivery) => delivery.nodeId)).toEqual(["underlay"]);
});

for (const shadow of [false, true]) {
  test(`CSS-scaled canvas stroke uses native current-pointer paint (shadow=${shadow})`, async ({
    page,
  }) => {
    await mountInteractive(page, interactivePathScene({ stroke: true }), { shadow, scale: 0.5 });
    // Canvas coordinate (100,66) misses Core's scale-one bounds, but the
    // native 20px vector stroke is painted at this CSS-scaled client point.
    expect(await page.evaluate(() => window.boundsvgClipHit.coreHit(100, 66))).toBe("underlay");
    await page.mouse.click(50, 33);
    expect((await clickDeliveries(page)).map((delivery) => delivery.nodeId)).toEqual(["path"]);
    await page.evaluate(() => {
      window.boundsvgClipHit.clearCallbacks();
      window.boundsvgClipHit.armCapture();
    });
    await page.mouse.move(50, 25);
    await page.mouse.down();
    await page.mouse.move(120, 40);
    await page.mouse.up();
    const pointerUpDeliveries = await page.evaluate(() =>
      window.boundsvgClipHit
        .read()
        .callbacks.filter((delivery) => delivery.eventType === "pointerup"),
    );
    expect(pointerUpDeliveries.map((delivery) => delivery.nodeId)).toEqual(["underlay"]);
  });
}

test("zero-sized Path viewports preserve actual browser paint and callback behavior", async ({
  page,
  browserName,
}) => {
  await mountInteractive(page, interactivePathScene({ zeroViewport: true }));
  await page.mouse.click(200, 30);
  expect((await clickDeliveries(page)).map((delivery) => delivery.nodeId)).toEqual([
    browserName === "firefox" ? "underlay" : "path",
  ]);
});

for (const fixture of [
  { name: "relative/repeated closed", d: "m0 0h120v40h-120z", fill: "red" },
  { name: "cubic", d: "M0 20C30 -20 90 60 120 20" },
  { name: "smooth cubic", d: "M0 20C20 -10 40 -10 60 20S100 50 120 20" },
  { name: "quadratic/reflected", d: "M0 20Q60 -20 120 20T240 20" },
  { name: "rotated arc", d: "M0 20A70 30 25 0 1 120 20" },
  { name: "multiple subpaths", d: "M0 0H120V40H0Z M-50 0h20v40h-20Z", fill: "red" },
  { name: "malformed arc prefix", d: "M0 20H120A20 20 0 2 1 160 20" },
  { name: "subnormal arc and following line", d: "M0 20A1e-320 10 0 0 0 120 20V60" },
  { name: "zero closed round cap", d: "M120 20Z", cap: "round", width: 20 },
  { name: "tiny round cap", d: "M120 20l1e-11 0", cap: "round", width: 20 },
  { name: "square cap", d: "M0 20H120", cap: "square", width: 20 },
  { name: "bevel join", d: "M0 0L120 20L0 40", join: "bevel", width: 20 },
  { name: "miter join", d: "M0 0L120 20L0 40", join: "miter", width: 20 },
  { name: "dashed stroke", d: "M0 20H120", dash: "15 5", width: 12 },
  { name: "default stroke width", d: "M0 20H120", width: undefined },
  {
    name: "normal nonuniform scale",
    d: "M0 20H120",
    width: 20,
    transform: { scaleX: 0.5, scaleY: 2 },
  },
  {
    name: "rotated canvas-stable stroke",
    d: "M0 20H120",
    width: 20,
    transform: { rotateDeg: 45, scaleX: 0.5, scaleY: 0.5 },
    scaling: "canvas",
  },
] as const) {
  test(`native ${fixture.name} paint remains a candidate and receives one callback`, async ({
    page,
  }) => {
    const scene = interactivePathScene();
    const path = scene.children[1];
    if (!path) {
      throw new Error("Path fixture is missing");
    }
    path.props.d = fixture.d;
    path.props.fill = "fill" in fixture ? fixture.fill : "none";
    path.props.stroke = "red";
    path.props.strokeWidth = "width" in fixture ? fixture.width : 10;
    path.props.strokeLinecap = "cap" in fixture ? fixture.cap : "butt";
    path.props.strokeLinejoin = "join" in fixture ? fixture.join : "round";
    path.props.strokeMiterlimit = 20;
    path.props.strokeDasharray = "dash" in fixture ? fixture.dash : undefined;
    path.props.transform = "transform" in fixture ? fixture.transform : undefined;
    path.props.strokeScaling = "scaling" in fixture ? fixture.scaling : "transform";
    await mountInteractive(page, scene);
    const painted = await page.evaluate(() => {
      const svgPath = document.querySelector('svg[data-boundsvg-node-id="path"] path');
      const points: { x: number; y: number }[] = [];
      for (let y = 10; y < 100; y += 5) {
        for (let x = 10; x < 300; x += 5) {
          if (svgPath && document.elementsFromPoint(x, y).includes(svgPath)) {
            points.push({ x, y });
          }
        }
      }
      return points.map((point) => ({
        ...point,
        candidates: window.boundsvgClipHit.coreCandidates(point.x, point.y),
      }));
    });
    expect(painted.length).toBeGreaterThan(0);
    for (const point of painted) {
      expect(point.candidates, `paint at ${point.x},${point.y}`).toContain("path");
    }
    const outside = painted.find((point) => point.x > 145 || point.x < 95 || point.y > 65);
    expect(outside, "independent native paint outside the layout frame").toBeDefined();
    if (outside) {
      await page.mouse.click(outside.x, outside.y);
      expect((await clickDeliveries(page)).map((delivery) => delivery.nodeId)).toEqual(["path"]);
    }
  });
}

for (const scaleX of [1, -0.75, 0]) {
  test(`mounted nested rotated clips preserve original coordinates (scaleX=${scaleX})`, async ({
    page,
  }) => {
    const scene = createElement(
      "Canvas",
      { width: 300, height: 200, background: "white" },
      createElement("Box", {
        id: "underlay",
        width: 300,
        height: 200,
        background: "blue",
        position: "absolute",
        onClick: "underlay-click",
      }),
      createElement(
        "Box",
        {
          id: "outer",
          left: 100,
          top: 50,
          width: 100,
          height: 100,
          position: "absolute",
          overflow: "clip",
          borderRadius: 30,
          transform: { rotateDeg: 45, scaleX, scaleY: 0.75, originX: 50, originY: 50 },
        },
        createElement(
          "Box",
          {
            id: "inner",
            width: 80,
            height: 80,
            left: 10,
            top: 10,
            position: "absolute",
            overflow: "clip",
            borderRadius: 40,
          },
          createElement("Path", {
            id: "path",
            width: 80,
            height: 80,
            d: "M-50 -50H150V150H-50Z",
            fill: "red",
            onClick: "path-click",
          }),
        ),
      ),
    );
    await mountInteractive(page, scene);
    await page.mouse.click(150, 100);
    expect((await clickDeliveries(page)).map((delivery) => delivery.nodeId)).toEqual([
      scaleX === 0 ? "underlay" : "path",
    ]);
    await page.evaluate(() => window.boundsvgClipHit.clearCallbacks());
    const scaledX = -38 * scaleX;
    const scaledY = -38 * 0.75;
    const corner = {
      x: 150 + (scaledX - scaledY) / Math.SQRT2,
      y: 100 + (scaledX + scaledY) / Math.SQRT2,
    };
    expect(
      await page.evaluate((point) => window.boundsvgClipHit.coreHit(point.x, point.y), corner),
    ).toBe("underlay");
    await page.mouse.click(corner.x, corner.y);
    expect((await clickDeliveries(page)).map((delivery) => delivery.nodeId)).toEqual(["underlay"]);
  });
}

for (const timeMs of [0, 500, 1000]) {
  test(`mounted sampled transform and rounded clip match at ${timeMs}ms`, async ({ page }) => {
    const scene = createElement(
      "Canvas",
      { width: 300, height: 100, background: "white" },
      createElement("Box", {
        id: "underlay",
        width: 300,
        height: 100,
        background: "blue",
        position: "absolute",
        onClick: "underlay-click",
      }),
      createElement(
        "Box",
        {
          id: "card",
          left: 100,
          top: 20,
          width: 40,
          height: 40,
          position: "absolute",
          overflow: "clip",
          borderRadius: 20,
          animate: {
            keyframes: [
              { at: 0, transform: { translateX: 0 } },
              { at: 1, transform: { translateX: 20 } },
            ],
            durationMs: 1000,
            easing: "linear",
            fill: "both",
          },
        },
        createElement("Path", {
          id: "path",
          width: 40,
          height: 40,
          d: "M0 0H120V40H0Z",
          fill: "red",
          onClick: "path-click",
        }),
      ),
    );
    await mountInteractive(page, scene, { timeMs });
    const shift = timeMs / 50;
    expect(await page.evaluate((x) => window.boundsvgClipHit.coreHit(x, 22), 102 + shift)).toBe(
      "underlay",
    );
    await page.mouse.click(102 + shift, 22);
    expect((await clickDeliveries(page)).map((delivery) => delivery.nodeId)).toEqual(["underlay"]);
    await page.evaluate(() => window.boundsvgClipHit.clearCallbacks());
    expect(await page.evaluate((x) => window.boundsvgClipHit.coreHit(x, 40), 120 + shift)).toBe(
      "path",
    );
    await page.mouse.click(120 + shift, 40);
    expect((await clickDeliveries(page)).map((delivery) => delivery.nodeId)).toEqual(["path"]);
  });
}
