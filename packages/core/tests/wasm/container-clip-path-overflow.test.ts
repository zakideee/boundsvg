import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { inspectScene } from "../../src/inspect.js";
import { hitTest } from "../../src/ir/hit-test.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { AnimationSpec, Transform2D, VNode } from "../../src/vnode/types.js";
import { createWasmEngineInstance, type WasmEngineHandle } from "../../src/wasm/index.js";
import { createConformanceEngine } from "../conformance/conformance-engine.js";
import { decodeRgbaPng } from "../helpers/rgba-png.js";

function pixelAt(png: Uint8Array, x: number, y: number): number[] {
  const { width, height, rgba } = decodeRgbaPng(png);
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x).toBeLessThan(width);
  expect(y).toBeGreaterThanOrEqual(0);
  expect(y).toBeLessThan(height);
  const offset = (y * width + x) * 4;
  return [...rgba.slice(offset, offset + 4)];
}

function roundedScene(
  options: {
    container?: "Box" | "Flex" | "Grid";
    borderRadius?: number | [number, number, number, number];
    overflow?: "clip" | "visible";
    borderWidth?: number;
    transform?: Transform2D;
    animate?: AnimationSpec;
    children?: VNode[];
  } = {},
): VNode {
  return createElement(
    "Canvas",
    { width: 120, height: 120, background: "#ffffff" },
    createElement(
      options.container ?? "Box",
      {
        id: "card",
        position: "absolute",
        left: 10,
        top: 10,
        width: 100,
        height: 100,
        background: "#0000ff",
        borderRadius: options.borderRadius,
        overflow: options.overflow ?? "clip",
        borderWidth: options.borderWidth,
        borderColor: options.borderWidth ? "#000000" : undefined,
        transform: options.transform,
        animate: options.animate,
        onClick: "card-click",
      },
      ...(options.children ?? [
        createElement("Box", {
          position: "absolute",
          left: 0,
          top: 0,
          width: 100,
          height: 100,
          background: "#ff0000",
        }),
      ]),
    ),
  );
}

function overflowingPathScene(
  isNegative: boolean,
  clipRadius?: number,
  transform?: Transform2D,
  animate?: AnimationSpec,
): VNode {
  return createElement(
    "Canvas",
    { width: 300, height: 100, background: "#ffffff" },
    createElement(
      "Box",
      {
        id: "parent",
        position: "absolute",
        left: isNegative ? 150 : 100,
        top: 20,
        width: 40,
        height: 40,
        overflow: clipRadius === undefined ? "visible" : "clip",
        borderRadius: clipRadius,
        transform,
        animate,
      },
      createElement("Path", {
        id: "arrow",
        width: 40,
        height: 40,
        d: isNegative ? "M-100 0L40 0L40 40Z" : "M0 0L120 0L120 40Z",
        fill: "#ff0000",
        onClick: "arrow-click",
      }),
    ),
  );
}

describe("container clip and Path paint through WASM", () => {
  let engine: Engine;
  let rasterHandle: WasmEngineHandle;

  beforeAll(async () => {
    engine = await createConformanceEngine();
    rasterHandle = createWasmEngineInstance();
  });

  afterAll(() => {
    engine.dispose();
    rasterHandle.dispose();
  });

  it("clips a red child to the circular parent", () => {
    const scene = roundedScene({ borderRadius: 50 });
    expect(pixelAt(engine.renderToPng(scene), 12, 12)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(engine.renderToPng(scene), 60, 60)).toEqual([255, 0, 0, 255]);
    expect(engine.renderToSvg(scene)).toContain('rx="50" ry="50"');
  });

  for (const container of ["Box", "Flex", "Grid"] as const) {
    for (const borderRadius of [undefined, 0, 50, [50, 0, 25, 0], 200] as const) {
      it(`${container} shares resolved radius ${JSON.stringify(borderRadius)} with its clip`, () => {
        const scene = roundedScene({
          container,
          borderRadius: Array.isArray(borderRadius)
            ? [borderRadius[0], borderRadius[1], borderRadius[2], borderRadius[3]]
            : borderRadius,
        });
        const card = engine.renderToIR(scene).root.children?.[1];
        expect(card?.clipPath).toEqual({ x: 10, y: 10, w: 100, h: 100 });
        expect(card?.clipBorderRadius).toEqual(card?.children?.[0]?.borderRadius);
        expect(pixelAt(engine.renderToPng(scene), 12, 12)).toEqual(
          borderRadius === undefined || borderRadius === 0
            ? [255, 0, 0, 255]
            : [255, 255, 255, 255],
        );
        if (Array.isArray(borderRadius)) {
          expect(pixelAt(engine.renderToPng(scene), 107, 12)).toEqual([255, 0, 0, 255]);
        }
      });
    }

    it(`${container} keeps children visible when overflow is visible`, () => {
      const scene = roundedScene({ container, borderRadius: 50, overflow: "visible" });
      const card = engine.renderToIR(scene).root.children?.[1];
      expect(card?.clipPath).toBeUndefined();
      expect(card?.clipBorderRadius).toBeUndefined();
      expect(pixelAt(engine.renderToPng(scene), 12, 12)).toEqual([255, 0, 0, 255]);
    });
  }

  for (const isNegative of [false, true]) {
    it(`paints ${isNegative ? "negative" : "positive"} Path coordinates outside its layout box`, () => {
      const scene = overflowingPathScene(isNegative);
      const x = isNegative ? 100 : 200;
      expect(pixelAt(engine.renderToPng(scene), x, 30)).toEqual([255, 0, 0, 255]);
      expect(engine.renderToSvg(scene)).toMatch(
        /<svg data-boundsvg-node-id="arrow"[^>]*width="40" height="40" overflow="visible">/,
      );
      for (const radius of [0, 20]) {
        const clippedPng = engine.renderToPng(overflowingPathScene(isNegative, radius));
        expect(pixelAt(clippedPng, x, 30)).toEqual([255, 255, 255, 255]);
        expect(pixelAt(clippedPng, (isNegative ? 150 : 100) + 37, 22)).toEqual(
          radius === 0 ? [255, 0, 0, 255] : [255, 255, 255, 255],
        );
      }
    });
  }

  it("keeps Image rounding and native Text/Image cards with borders", () => {
    const imagePng = rasterHandle.createSvgToPngFn()(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>',
    );
    const src = `data:image/png;base64,${Buffer.from(imagePng).toString("base64")}`;
    for (const borderWidth of [0, 4, 12]) {
      const scene = roundedScene({
        borderRadius: 30,
        borderWidth,
        children: [
          createElement("Image", {
            src,
            width: 100 - borderWidth * 2,
            height: 100 - borderWidth * 2,
            position: "absolute",
            left: borderWidth,
            top: borderWidth,
          }),
          createElement(
            "Text",
            {
              font: "NotoSansJP",
              fontSizePx: 14,
              color: "#000000",
              position: "absolute",
              left: 25,
              top: 40,
            },
            "Card",
          ),
        ],
      });
      const png = engine.renderToPng(scene);
      expect(pixelAt(png, 12, 12)).toEqual([255, 255, 255, 255]);
      expect(pixelAt(png, 60, 85)).toEqual([255, 0, 0, 255]);
      if (borderWidth > 0) {
        expect(pixelAt(png, 60, 10 + borderWidth / 2 - 1)).toEqual([0, 0, 0, 255]);
      }
      if (borderWidth === 12) {
        expect(pixelAt(png, 17, 17)).toEqual([255, 255, 255, 255]);
      }
      expect(engine.renderToSvg(scene)).toContain("<image");
      expect(engine.renderToSvg(scene)).toContain('data-boundsvg-node-id="card"');
    }
    const avatar = createElement(
      "Canvas",
      { width: 120, height: 120, background: "#ffffff" },
      createElement("Image", {
        src,
        width: 100,
        height: 100,
        position: "absolute",
        left: 10,
        top: 10,
        borderRadius: 50,
      }),
    );
    expect(pixelAt(engine.renderToPng(avatar), 12, 12)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(engine.renderToPng(avatar), 60, 60)).toEqual([255, 0, 0, 255]);
  });

  it("intersects nested rectangular and rounded parent clips", () => {
    const scene = roundedScene({
      borderRadius: 50,
      children: [
        createElement(
          "Box",
          {
            position: "absolute",
            left: 0,
            top: 0,
            width: 70,
            height: 100,
            overflow: "clip",
          },
          createElement("Box", { width: 100, height: 100, background: "#ff0000" }),
        ),
      ],
    });
    const png = engine.renderToPng(scene);
    expect(pixelAt(png, 12, 12)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(png, 60, 60)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(png, 95, 60)).toEqual([0, 0, 255, 255]);
  });

  it("paints a native speech bubble tail until an ancestor clips it", () => {
    for (const overflow of ["visible", "clip"] as const) {
      const scene = createElement(
        "Canvas",
        { width: 100, height: 100, background: "#ffffff" },
        createElement(
          "Box",
          { position: "absolute", left: 10, top: 10, width: 60, height: 40, overflow },
          createElement("Path", {
            width: 60,
            height: 40,
            d: "M0 0H60V40H35L30 60L25 40H0Z",
            fill: "#ff0000",
          }),
        ),
      );
      const png = engine.renderToPng(scene);
      expect(pixelAt(png, 40, 30)).toEqual([255, 0, 0, 255]);
      expect(pixelAt(png, 40, 60)).toEqual(
        overflow === "visible" ? [255, 0, 0, 255] : [255, 255, 255, 255],
      );
    }
  });

  it("moves clip geometry with translated, rotated and uniformly scaled parents", () => {
    for (const fixture of [
      { transform: { translateX: 10, translateY: 5 }, outside: [22, 17], inside: [70, 65] },
      {
        transform: { rotateDeg: 90, originX: 50, originY: 50 },
        outside: [107, 12],
        inside: [60, 60],
      },
      {
        transform: { scaleX: 0.5, scaleY: 0.5, originX: 0, originY: 0 },
        outside: [11, 11],
        inside: [35, 35],
      },
    ] as const) {
      const scene = roundedScene({ borderRadius: 50, transform: fixture.transform });
      const png = engine.renderToPng(scene);
      expect(pixelAt(png, fixture.outside[0], fixture.outside[1])).toEqual([255, 255, 255, 255]);
      expect(pixelAt(png, fixture.inside[0], fixture.inside[1])).toEqual([255, 0, 0, 255]);
      const ir = engine.renderToIR(scene);
      expect(hitTest(ir, fixture.outside[0], fixture.outside[1])).toBeNull();
      expect(hitTest(ir, fixture.inside[0], fixture.inside[1])).toBe("card");
    }
    const rotatedCorners = roundedScene({
      borderRadius: [50, 0, 0, 0],
      transform: { rotateDeg: 90, originX: 50, originY: 50 },
    });
    const rotatedCornersPng = engine.renderToPng(rotatedCorners);
    expect(pixelAt(rotatedCornersPng, 12, 12)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(rotatedCornersPng, 107, 12)).toEqual([255, 255, 255, 255]);
    expect(hitTest(engine.renderToIR(rotatedCorners), 12, 12)).toBe("card");
    expect(hitTest(engine.renderToIR(rotatedCorners), 107, 12)).toBeNull();
    const transformedPath = overflowingPathScene(false, undefined, { translateX: 10 });
    expect(pixelAt(engine.renderToPng(transformedPath), 210, 30)).toEqual([255, 0, 0, 255]);
    expect(hitTest(engine.renderToIR(transformedPath), 210, 30)).toBe("arrow");
    expect(
      pixelAt(
        engine.renderToPng(
          overflowingPathScene(false, undefined, {
            rotateDeg: 180,
            originX: 20,
            originY: 20,
          }),
        ),
        40,
        50,
      ),
    ).toEqual([255, 0, 0, 255]);
    expect(
      pixelAt(
        engine.renderToPng(
          overflowingPathScene(false, undefined, {
            scaleX: 0.5,
            scaleY: 0.5,
            originX: 0,
            originY: 0,
          }),
        ),
        150,
        25,
      ),
    ).toEqual([255, 0, 0, 255]);
    const pathTransformScene = overflowingPathScene(false);
    const arrow = pathTransformScene.children[0]?.children[0];
    expect(arrow).toBeDefined();
    if (arrow) {
      arrow.props.transform = { translateX: 20 };
    }
    expect(pixelAt(engine.renderToPng(pathTransformScene), 220, 30)).toEqual([255, 0, 0, 255]);
  });

  it("moves the clip with the Path transform when migrating to a parent box", () => {
    const clipTransform: Transform2D = { rotateDeg: 45, originX: 20, originY: 20 };
    for (const transformOnWrapper of [false, true]) {
      const scene = createElement(
        "Canvas",
        { width: 200, height: 100, background: "#ffffff" },
        createElement(
          "Box",
          {
            position: "absolute",
            left: 100,
            top: 20,
            width: 40,
            height: 40,
            overflow: "clip",
            transform: transformOnWrapper ? clipTransform : undefined,
          },
          createElement("Path", {
            width: 40,
            height: 40,
            d: "M-20 15H60V25H-20Z",
            fill: "#ff0000",
            transform: transformOnWrapper ? undefined : clipTransform,
          }),
        ),
      );
      const png = engine.renderToPng(scene);
      expect(pixelAt(png, 120, 40)).toEqual([255, 0, 0, 255]);
      expect(pixelAt(png, 137, 57)).toEqual(
        transformOnWrapper ? [255, 255, 255, 255] : [255, 0, 0, 255],
      );
    }
  });

  it("shows the full canvas-stable edge stroke unless a parent clips it", () => {
    for (const overflow of ["visible", "clip"] as const) {
      const scene = createElement(
        "Canvas",
        { width: 100, height: 80, background: "#ffffff" },
        createElement(
          "Box",
          {
            position: "absolute",
            left: 20,
            top: 20,
            width: 40,
            height: 40,
            overflow,
            transform: { scaleX: 0.5, scaleY: 0.5, originX: 0, originY: 0 },
          },
          createElement("Path", {
            id: "edge-stroke",
            width: 40,
            height: 40,
            d: "M0 0H40",
            fill: "none",
            stroke: "#ff0000",
            strokeWidth: 8,
            strokeScaling: "canvas",
          }),
        ),
      );
      expect(pixelAt(engine.renderToPng(scene), 30, 17)).toEqual(
        overflow === "visible" ? [255, 0, 0, 255] : [255, 255, 255, 255],
      );
      expect(pixelAt(engine.renderToPng(scene), 30, 22)).toEqual([255, 0, 0, 255]);
      const ir = engine.renderToIR(scene);
      expect(hitTest(ir, 30, 17)).toBe(overflow === "visible" ? "edge-stroke" : null);
      expect(hitTest(ir, 30, 22)).toBe("edge-stroke");
    }
  });

  it("samples parent and child transform animation with the same SVG/PNG clip", () => {
    const animate: AnimationSpec = {
      keyframes: [
        { at: 0, transform: { translateX: 0 } },
        { at: 1, transform: { translateX: 20 } },
      ],
      durationMs: 1000,
      easing: "linear",
      fill: "both",
    };
    const scene = roundedScene({
      borderRadius: 50,
      animate,
      children: [createElement("Box", { width: 100, height: 100, background: "#ff0000", animate })],
    });
    scene.props.width = 160;
    expect(engine.renderToAnimatedSvg(scene, { playback: { mode: "independent" } })).toContain(
      "clip-path",
    );
    for (const timeMs of [0, 500, 1000]) {
      const shift = timeMs / 50;
      const png = engine.renderToPng(scene, { timeMs });
      expect(pixelAt(png, 12 + shift, 12)).toEqual([255, 255, 255, 255]);
      expect(pixelAt(png, 107 + shift, 12)).toEqual([255, 255, 255, 255]);
      expect(pixelAt(png, 60 + shift, 60)).toEqual([255, 0, 0, 255]);
      expect(pixelAt(png, 102 + shift, 60)).toEqual([255, 0, 0, 255]);
      const sampledIr = engine.renderToIR(scene, { timeMs });
      expect(hitTest(sampledIr, 12 + shift, 12)).toBeNull();
      expect(hitTest(sampledIr, 60 + shift, 60)).toBe("card");
      expect(rasterHandle.createSvgToPngFn()(engine.renderToSvg(scene, { timeMs }))).toEqual(png);
      const path = overflowingPathScene(false, 20, undefined, animate);
      expect(pixelAt(engine.renderToPng(path, { timeMs }), 200 + shift, 30)).toEqual([
        255, 255, 255, 255,
      ]);
      expect(hitTest(engine.renderToIR(path, { timeMs }), 200 + shift, 30)).toBeNull();
      const visiblePath = overflowingPathScene(false, undefined, undefined, animate);
      expect(hitTest(engine.renderToIR(visiblePath, { timeMs }), 200 + shift, 30)).toBe("arrow");
      expect(
        pixelAt(
          engine.renderToPng(overflowingPathScene(false, undefined, undefined, animate), {
            timeMs,
          }),
          200 + shift,
          30,
        ),
      ).toEqual([255, 0, 0, 255]);
    }
  });

  it("keeps rounded clips atomic and recomposes layered paint exactly", () => {
    const scene = roundedScene({
      borderRadius: 50,
      children: [
        createElement("Box", { width: 100, height: 100, background: "#ff0000", layer: "content" }),
      ],
    });
    const layered = engine.renderToLayeredSvg(scene, { validateComposition: { enabled: true } });
    expect(layered.layers.flatMap((layer) => layer.warnings)).toContainEqual({
      code: "CLIP_FORCED_ATOMIC",
      nodeId: "card",
    });
    expect(layered.compositionValidation?.status).toBe("passed");
    const combinedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">${layered.layers.map((layer) => layer.svg).join("")}</svg>`;
    expect(rasterHandle.createSvgToPngFn()(combinedSvg)).toEqual(engine.renderToPng(scene));
  });

  it("retains placement inspection while hit candidates follow Path paint and clips", () => {
    const pathScene = overflowingPathScene(false);
    const inspection = inspectScene(engine, pathScene);
    expect(inspection.bboxes.find((entry) => entry.nodeId === "arrow")?.layoutBBox).toEqual({
      x: 100,
      y: 20,
      w: 40,
      h: 40,
    });
    expect(hitTest(inspection.ir, 200, 30)).toBe("arrow");
    expect(hitTest(inspection.ir, 130, 25)).toBe("arrow");
    const cardScene = roundedScene({ borderRadius: 50 });
    expect(hitTest(engine.renderToIR(cardScene), 12, 12)).toBeNull();
    const pathCardScene = createElement(
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
    expect(pixelAt(engine.renderToPng(pathCardScene), 12, 12)).toEqual([255, 255, 255, 255]);
    expect(hitTest(engine.renderToIR(pathCardScene), 12, 12)).toBeNull();
    const overlappingPathScene = createElement(
      "Canvas",
      { width: 300, height: 100, background: "#ffffff" },
      createElement("Box", {
        id: "underlay",
        position: "absolute",
        left: 180,
        top: 20,
        width: 60,
        height: 40,
        background: "#0000ff",
        onClick: "underlay-click",
        zIndex: 0,
      }),
      createElement("Path", {
        id: "arrow",
        position: "absolute",
        left: 100,
        top: 20,
        width: 40,
        height: 40,
        d: "M0 0L120 0L120 40Z",
        fill: "#ff0000",
        onClick: "arrow-click",
        zIndex: 1,
      }),
    );
    expect(pixelAt(engine.renderToPng(overlappingPathScene), 200, 30)).toEqual([255, 0, 0, 255]);
    expect(hitTest(engine.renderToIR(overlappingPathScene), 200, 30)).toBe("arrow");
  });
});
