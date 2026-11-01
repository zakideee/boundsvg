import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { inspectScene } from "../../src/inspect.js";
import { buildHitTestIndex, hitTest, hitTestWithIndex } from "../../src/ir/hit-test.js";
import type { IRNode } from "../../src/ir/types.js";
import { collectNodeIds } from "../../src/node-ids.js";
import { applyAffineMatrixToPoint, createResolvedTransformMatrix } from "../../src/transform.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { BoxProps, VNode } from "../../src/vnode/types.js";
import { createConformanceEngine } from "../conformance/conformance-engine.js";
import { decodeRgbaPng } from "../helpers/rgba-png.js";

function nodes(root: IRNode): IRNode[] {
  return [root, ...(root.type === "group" ? (root.children ?? []).flatMap(nodes) : [])];
}

function canvas(child: VNode, width = 240, height = 160): VNode {
  return createElement("Canvas", { width, height, background: "#ffffff" }, child);
}

function colorAt(png: Uint8Array, x: number, y: number): number[] {
  const decoded = decodeRgbaPng(png);
  const offset = (y * decoded.width + x) * 4;
  return [...decoded.rgba.slice(offset, offset + 4)];
}

describe("text paint, skew, and independent box surfaces", () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = await createConformanceEngine();
  });
  afterAll(() => {
    engine.dispose();
  });

  it("reserves four layout edges and keeps the outline independent of border widths", () => {
    const scene = canvas(
      createElement(
        "Box",
        {
          id: "card",
          width: 100,
          height: 80,
          padding: 8,
          borderWidth: [12, 4, 8, 16],
          borderColor: "#ff0000",
          outline: { stroke: "#0000ff", strokeWidth: 2 },
        },
        createElement("Box", { id: "child", width: 20, height: 10 }),
      ),
    );
    const ir = engine.renderToIR(scene);
    expect(nodes(ir.root).find((node) => node.nodeId === "child")?.bbox).toEqual({
      x: 24,
      y: 20,
      w: 20,
      h: 10,
    });
    const outline = nodes(ir.root).find((node) => node.nodeId === "card:outline");
    expect(outline?.type).toBe("path");
    expect(outline?.bbox).toEqual({ x: 0, y: 0, w: 100, h: 80 });
    expect(outline?.type === "path" ? outline.strokeWidth : undefined).toBe(2);
    expect(ir.drawOrder.at(-1)).toBe("card:outline");
  });

  it("does not paint the inset candidate outside a circular outer contour", () => {
    const scene = canvas(
      createElement("Box", {
        id: "circle",
        width: 100,
        height: 100,
        borderRadius: 50,
        borderWidth: [0, 0, 0, 80],
        borderColor: "#ff0000",
        overflow: "visible",
      }),
    );
    const png = engine.renderToPng(scene);
    expect(colorAt(png, 85, 1)).toEqual([255, 255, 255, 255]);
    expect(colorAt(png, 40, 50)).toEqual([255, 0, 0, 255]);
  });

  it("shares outer/interior clipping with both hit traversal paths", () => {
    const scene = canvas(
      createElement(
        "Box",
        {
          id: "circle",
          width: 100,
          height: 100,
          borderRadius: 50,
          borderWidth: [0, 0, 0, 80],
          borderColor: "#ff0000",
          overflow: "clip",
          outline: { stroke: "#0000ff", strokeWidth: 2 },
        },
        createElement("Box", {
          id: "content",
          position: "absolute",
          left: -80,
          top: 0,
          width: 200,
          height: 200,
          background: "#00ff00",
          onClick: "content-click",
        }),
      ),
    );
    const ir = engine.renderToIR(scene);
    const index = buildHitTestIndex(ir);
    for (const [x, y, expected] of [
      [85, 1, null],
      [40, 50, null],
      [90, 50, "content"],
    ] as const) {
      expect(hitTest(ir, x, y)).toBe(expected);
      expect(hitTestWithIndex(index, x, y)).toBe(expected);
    }
    const inspection = inspectScene(engine, scene);
    expect(inspection.bboxes.some((entry) => entry.nodeId.endsWith(":content"))).toBe(false);
    expect(inspection.nodeTypeMap.has("circle:content")).toBe(false);
    expect(inspection.handlerMap.has("circle:content")).toBe(false);
    expect(engine.renderToSvg(scene)).not.toMatch(
      /data-boundsvg-node-id="circle:(?:border|content|outline)"/,
    );
  });

  it("tracks an automatically stretched box without consuming content space", () => {
    const make = (width: number, hasOutline: boolean) =>
      canvas(
        createElement(
          "Flex",
          {
            id: "host",
            direction: "column",
            width,
            height: 120,
            padding: 20,
          },
          createElement(
            "Flex",
            {
              id: "frame",
              flexGrow: 1,
              padding: 12,
              borderRadius: 16,
              ...(hasOutline
                ? {
                    outline: {
                      stroke: "#000000",
                      strokeDasharray: "8,4",
                      strokeLinecap: "round" as const,
                    },
                  }
                : {}),
            },
            createElement("Box", { id: "content", width: 20, height: 10 }),
          ),
        ),
        width,
        160,
      );
    for (const width of [240, 180]) {
      const without = nodes(engine.renderToIR(make(width, false)).root);
      const withLine = nodes(engine.renderToIR(make(width, true)).root);
      expect(withLine.find((node) => node.nodeId === "content")?.bbox).toEqual(
        without.find((node) => node.nodeId === "content")?.bbox,
      );
      expect(withLine.find((node) => node.nodeId === "frame:outline")?.bbox).toEqual(
        withLine.find((node) => node.nodeId === "frame")?.bbox,
      );
    }
  });

  it("uses an explicit Empty clip when border edges consume the interior", () => {
    const scene = canvas(
      createElement(
        "Box",
        {
          id: "frame",
          width: 100,
          height: 100,
          borderWidth: 60,
          borderColor: "#0000ff",
          overflow: "clip",
          outline: { stroke: "#00ff00" },
        },
        createElement("Box", {
          id: "hidden",
          position: "absolute",
          left: -60,
          top: -60,
          width: 100,
          height: 100,
          background: "#ff0000",
          onClick: "hidden-click",
        }),
      ),
    );
    const ir = engine.renderToIR(scene);
    expect(nodes(ir.root).find((node) => node.nodeId === "frame:content")?.clip).toEqual({
      kind: "empty",
    });
    expect(hitTest(ir, 50, 50)).toBeNull();
    expect(hitTestWithIndex(buildHitTestIndex(ir), 50, 50)).toBeNull();
    expect(colorAt(engine.renderToPng(scene), 50, 50)).toEqual([0, 0, 255, 255]);
  });

  it("uses the same canonical zero for layout, painting, and generated IDs", () => {
    const scene = canvas(
      createElement("Box", {
        id: "zero",
        width: 40,
        height: 40,
        borderWidth: [1e-50, 0, -0, 0],
        borderColor: "#000000",
        overflow: "clip",
      }),
    );
    expect(collectNodeIds(scene).map((entry) => entry.id)).not.toContain("zero:border");
    expect(engine.renderToIR(scene).drawOrder).not.toContain("zero:border");
  });

  it("shares one physical Text paint frame across wrapped Inline fragments and exported paths", () => {
    const first = "linear-gradient(90deg, #ff0000, #0000ff)";
    const second = "radial-gradient(#00ff00, #000000)";
    const scene = canvas(
      createElement(
        "Text",
        {
          id: "title",
          font: "NotoSansJP",
          fontSizePx: 28,
          width: 100,
          wrap: "char",
          color: first,
        },
        "ABCD",
        createElement("Inline", { color: second }, "EFGH"),
        "IJKL",
      ),
    );
    const text = nodes(engine.renderToIR(scene).root).find((node) => node.type === "text");
    expect(text?.type === "text" ? text.gradients?.length : 0).toBe(2);
    if (text?.type !== "text") {
      throw new Error("Text IR is required");
    }
    expect(text.lines.length).toBeGreaterThan(1);
    expect(text.gradients?.map((paint) => paint.bbox)).toEqual([text.bbox, text.bbox]);
    expect(text.gradients?.[0]?.gradient).toMatchObject({
      type: "linear",
      geometry: { startX: 0, endX: text.bbox.w },
    });
    const outline = engine.renderToTextOutlines(scene)[0];
    expect(outline?.gradients).toHaveLength(2);
    expect(
      outline?.paths.some((path) => typeof path.fill === "object" && path.fill.gradientIndex === 0),
    ).toBe(true);
    expect(
      outline?.paths.some((path) => typeof path.fill === "object" && path.fill.gradientIndex === 1),
    ).toBe(true);
    expect(engine.renderToSvg(scene).match(/<(?:linear|radial)Gradient /g)).toHaveLength(2);
  });

  it.each([
    "horizontal-tb",
    "vertical-rl",
  ] as const)("shares inherited paint through ruby, inline boxes, and %s decoration", (writingMode) => {
    const make = (color: string) =>
      canvas(
        createElement(
          "Text",
          {
            id: "rich",
            font: "NotoSansJP",
            fontSizePx: 24,
            width: 180,
            height: 120,
            writingMode,
            color,
            textDecoration: { line: "underline", thicknessPx: 2 },
          },
          createElement("Ruby", {}, "文字", createElement("Rt", {}, "もじ")),
          createElement("InlineBox", { background: "#eeeeee", paddingInline: [2, 2] }, "共有"),
        ),
      );
    const gradient = "linear-gradient(90deg, #ff0000, #0000ff)";
    const rich = nodes(engine.renderToIR(make(gradient)).root).find((node) => node.type === "text");
    const solid = nodes(engine.renderToIR(make("#ff0000")).root).find(
      (node) => node.type === "text",
    );
    expect(rich?.bbox).toEqual(solid?.bbox);
    if (rich?.type !== "text") {
      throw new TypeError("Rich text is required");
    }
    expect(rich.gradients).toHaveLength(1);
    expect(rich.gradients?.[0]?.bbox).toEqual(rich.bbox);
    const outline = engine.renderToTextOutlines(make(gradient))[0];
    expect(outline?.paths.length).toBeGreaterThan(0);
    expect(
      outline?.paths.every(
        (path) => typeof path.fill === "object" && path.fill.gradientIndex === 0,
      ),
    ).toBe(true);
    const svg = engine.renderToSvg(make(gradient));
    expect(svg.match(/<linearGradient /g)).toHaveLength(1);
    expect(svg.match(/fill="url\(#grad-[^"]+\)"/g)?.length).toBeGreaterThan(1);
  });

  it("resolves a fitted ellipsis frame before registering its gradient", () => {
    const scene = canvas(
      createElement(
        "Text",
        {
          id: "fitted",
          font: "NotoSansJP",
          fontSizePx: 40,
          minFontSizePx: 18,
          fit: "shrink",
          width: 100,
          height: 28,
          maxLines: 1,
          ellipsis: true,
          wrap: "char",
          color: "radial-gradient(#ffffff, #000000)",
        },
        "A very long heading",
      ),
    );
    const text = nodes(engine.renderToIR(scene).root).find((node) => node.type === "text");
    if (text?.type !== "text") {
      throw new TypeError("Fitted text is required");
    }
    expect(text.fontSizePx).toBeLessThan(40);
    expect(text.gradients?.[0]?.bbox).toEqual(text.bbox);
    expect(engine.renderToTextOutlines(scene)[0]?.gradients?.[0]?.bbox).toEqual(text.bbox);
  });

  it("keeps the Text paint frame fixed while sampling animated units", () => {
    const scene = canvas(
      createElement(
        "Text",
        {
          id: "units",
          font: "NotoSansJP",
          fontSizePx: 28,
          color: "linear-gradient(90deg, #ff0000, #0000ff)",
          animateUnits: {
            by: "cluster",
            delayStepMs: 10,
            animation: {
              durationMs: 400,
              fill: "both",
              keyframes: [
                { at: 0, transform: { translateY: 8, skewXDeg: -8 } },
                { at: 1, transform: { translateY: 0, skewXDeg: 0 } },
              ],
            },
          },
        },
        "Shared paint",
      ),
    );
    const first = nodes(engine.renderToSvgAndIR(scene, { timeMs: 100 }).ir.root).find(
      (node) => node.type === "text",
    );
    const second = nodes(engine.renderToSvgAndIR(scene, { timeMs: 250 }).ir.root).find(
      (node) => node.type === "text",
    );
    expect(first?.type === "text" ? first.gradients : undefined).toEqual(
      second?.type === "text" ? second.gradients : undefined,
    );
    expect(engine.renderToSvg(scene, { timeMs: 100 })).not.toBe(
      engine.renderToSvg(scene, { timeMs: 250 }),
    );
  });

  it("keeps an explicitly authored decoration color solid-only", () => {
    const scene = canvas(
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 24,
          textDecoration: { line: "underline", color: "linear-gradient(red, blue)" },
        },
        "Text",
      ),
    );
    expect(() => engine.renderToIR(scene)).toThrow();
  });

  it.each([
    false,
    true,
  ])("continues to reject TextOnPath gradient paint (Inline=%s)", (isInline) => {
    const gradient = "linear-gradient(90deg, red, blue)";
    const pathText = createElement(
      "TextOnPath",
      {
        d: "M0 30H200",
        width: 200,
        height: 60,
        font: "NotoSansJP",
        fontSizePx: 24,
        color: isInline ? "#000000" : gradient,
      },
      isInline ? createElement("Inline", { color: gradient }, "Path") : "Path",
    );
    expect(() => engine.renderToIR(canvas(pathText))).toThrow(/gradient|color|paint/i);
  });

  it("renders both ends of a text gradient through the raster pipeline", () => {
    const png = engine.renderToPng(
      canvas(
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 40,
            color: "linear-gradient(90deg, #ff0000, #0000ff)",
          },
          "MMMMMM",
        ),
      ),
    );
    const { rgba } = decodeRgbaPng(png);
    let hasRed = false;
    let hasBlue = false;
    for (let offset = 0; offset < rgba.length; offset += 4) {
      const red = rgba[offset] ?? 0;
      const green = rgba[offset + 1] ?? 0;
      const blue = rgba[offset + 2] ?? 0;
      hasRed ||= red > blue + 40 && green < 180;
      hasBlue ||= blue > red + 40 && green < 180;
    }
    expect(hasRed && hasBlue).toBe(true);
  });

  it("composes X and Y shears sequentially and preserves their static SVG order", () => {
    const transform = { skewXDeg: 12, skewYDeg: -7 };
    const point = applyAffineMatrixToPoint(
      createResolvedTransformMatrix(transform, { x: 0, y: 0 }),
      { x: 10, y: 20 },
    );
    const expectedY = 20 + Math.tan((-7 * Math.PI) / 180) * 10;
    expect(point.y).toBeCloseTo(expectedY, 12);
    expect(point.x).toBeCloseTo(10 + Math.tan((12 * Math.PI) / 180) * expectedY, 12);
    const svg = engine.renderToSvg(
      canvas(createElement("Box", { width: 30, height: 20, background: "#000000", transform })),
    );
    expect(svg).toContain("skewX(12) skewY(-7)");
  });

  it("rejects unsafe easing tuples while accepting a bounded spring", () => {
    const make = (from: number, to: number) =>
      canvas(
        createElement("Box", {
          width: 40,
          height: 20,
          background: "#000000",
          animate: {
            durationMs: 400,
            easing: { type: "spring" },
            keyframes: [
              { at: 0, transform: { skewXDeg: from } },
              { at: 1, transform: { skewXDeg: to } },
            ],
          },
        }),
      );
    expect(() => engine.renderToIR(make(0, 12))).not.toThrow();
    expect(() => engine.renderToIR(make(52, 60))).toThrow();
    const svg = engine.renderToAnimatedSvg(make(0, 12), { playback: { mode: "independent" } });
    expect(svg.match(/skewX\([^)]*\) skewY\([^)]*\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    { strokeDasharray: "8,4" },
    { borderWidth: [1, 2] },
    { borderWidth: 1_048_576.0001 },
    { borderWidth: 1, borderRadius: -1 },
    { outline: null },
    { outline: { stroke: "#000000", strokeMiterlimit: 0 } },
    { transform: { skewXDeg: 60.0001 } },
  ])("rejects removed or out-of-domain container input %j", (invalid) => {
    const scene = canvas(
      createElement("Box", { width: 40, height: 40, ...invalid } as unknown as BoxProps),
    );
    expect(() => engine.renderToIR(scene)).toThrow();
  });
  it("uses the same resolved geometry for a Box and Text paint frame", () => {
    const paint = "linear-gradient(45deg, red, blue)";
    const textScene = canvas(
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 28, lineHeightPx: 40, color: paint },
        "共通",
      ),
    );
    const text = nodes(engine.renderToIR(textScene).root).find((node) => node.type === "text");
    if (text?.type !== "text") {
      throw new Error("Text paint is required");
    }
    const boxScene = canvas(
      createElement("Box", { width: text.bbox.w, height: text.bbox.h, background: paint }),
    );
    const background = nodes(engine.renderToIR(boxScene).root).find(
      (node) => node.type === "rect" && node.gradient,
    );
    expect(background?.type === "rect" ? background.gradient : undefined).toEqual(
      text.gradients?.[0]?.gradient,
    );
  });

  it("keeps a cut document timeline within the skew execution envelope", () => {
    const scene = canvas(
      createElement("Box", {
        width: 80,
        height: 40,
        background: "#000000",
        animate: {
          durationMs: 800,
          delayMs: -120,
          easing: [0.2, 0.1, 0.7, 0.9],
          fill: "both",
          keyframes: [
            { at: 0, transform: { skewXDeg: -12, skewYDeg: 4 } },
            { at: 1, transform: { skewXDeg: 18, skewYDeg: -6 } },
          ],
        },
      }),
    );
    const options = {
      playback: { mode: "timeline", durationMs: 500, iterations: 1 },
      timeMs: 200,
    } as const;
    const svg = engine.renderToAnimatedSvg(scene, options);
    expect(svg).toContain("skewX(");
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(engine.renderCompiledToAnimatedSvg(engine.compile(scene), options)).toBe(svg);
  });
});
