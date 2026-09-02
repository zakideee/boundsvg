import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import { buildTextMap, getNodeText } from "../../src/ir/text-map.js";
import { buildTextSelectionMap } from "../../src/ir/text-selection.js";
import type { IRNode, IRTextNode } from "../../src/ir/types.js";
import { buildLayoutTransportJson } from "../../src/layout/taffy-layout-adapter.js";
import { initNodeWasm } from "../../src/node.js";
import { parsePathBBox } from "../../src/path/utils.js";
import type { CanvasSceneNode } from "../../src/scene/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "./test-prerequisites.js";

const FONT = "NotoSansJP";
let engine: Engine;

function findTextNode(node: IRNode): IRTextNode | null {
  if (node.type === "text") {
    return node;
  }
  if (node.type === "group") {
    for (const child of node.children ?? []) {
      const found = findTextNode(child);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function findNodeById(node: IRNode, nodeId: string): IRNode | null {
  if (node.nodeId === nodeId) {
    return node;
  }
  if (node.type === "group") {
    for (const child of node.children ?? []) {
      const found = findNodeById(child, nodeId);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function scene(
  overrides: Partial<{
    d: string;
    startOffsetPx: number;
    textAnchor: "start" | "middle" | "end";
    pathDirection: "forward" | "reverse";
    pathNormal: "left" | "right";
    pathOffsetPx: number;
    pathFit: "none" | "spacing" | "scale" | "shrink";
    pathOverflow: "hidden" | "error" | "ellipsis";
    text: string;
  }> = {},
) {
  return createElement(
    "Canvas",
    { width: 360, height: 180 },
    createElement(
      "TextOnPath",
      {
        id: "path-text",
        d: overrides.d ?? "M20 90C100 10 240 10 330 90",
        width: 350,
        height: 170,
        font: FONT,
        fontSizePx: 30,
        color: "#2463eb",
        startOffsetPx: overrides.startOffsetPx ?? 175,
        textAnchor: overrides.textAnchor ?? "middle",
        pathDirection: overrides.pathDirection ?? "forward",
        pathNormal: overrides.pathNormal ?? "right",
        pathOffsetPx: overrides.pathOffsetPx ?? 6,
        pathFit: overrides.pathFit,
        pathOverflow: overrides.pathOverflow ?? "error",
        textStrokes: [{ color: "#ffffff", widthPx: 3 }],
        textShadows: [{ dx: 2, dy: 2, blurPx: 1, color: "#00000080" }],
      },
      overrides.text ?? "曲線 Path",
    ),
  );
}

function withPathProps(overrides: Record<string, unknown>): VNode {
  const vnode = scene();
  const child = vnode.children[0];
  if (!child || typeof child === "string") {
    throw new Error("expected TextOnPath child");
  }
  return {
    ...vnode,
    children: [{ ...child, props: { ...child.props, ...overrides } }],
  } as unknown as VNode;
}

beforeAll(async () => {
  assertWasmPkgAvailable();
  await initNodeWasm();
  engine = await createEngineAsync({
    fonts: [
      { alias: FONT, weight: 400, style: "normal", data: loadSubsetFont() },
      { alias: FONT, weight: 700, style: "normal", data: loadSubsetFont() },
    ],
  });
});

describe("TextOnPath real WASM pipeline", () => {
  it("keeps plain and same-style Inline shaping byte-identical", () => {
    const props = {
      id: "path-text",
      d: "M20 90L340 90",
      width: 350,
      height: 170,
      font: FONT,
      fontSizePx: 30,
      pathOverflow: "error" as const,
    };
    const plain = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement("TextOnPath", props, "office"),
    );
    const rich = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        props,
        createElement("Inline", {}, "of"),
        createElement("Inline", {}, "fice"),
      ),
    );
    const plainLines = findTextNode(engine.renderToIR(plain).root)?.lines;
    const plainGlyphs = plainLines?.[0]?.positionedGlyphs ?? [];
    expect(plainGlyphs.map((glyph) => glyph.glyphId)).toEqual([80, 3145, 68, 70]);
    expect(plainGlyphs.map((glyph) => [glyph.text, glyph.clusterStart, glyph.clusterEnd])).toEqual([
      ["o", 0, 1],
      ["ffi", 1, 4],
      ["c", 4, 5],
      ["e", 5, 6],
    ]);
    expect(findTextNode(engine.renderToIR(rich).root)?.lines).toEqual(plainLines);
    expect(engine.renderToSvg(rich)).toBe(engine.renderToSvg(plain));
  });

  it("keeps paint-only boundaries out of shaping and rejects a boundary inside a final cluster", () => {
    const props = {
      id: "paint-boundary",
      d: "M20 90L340 90",
      width: 350,
      height: 170,
      font: FONT,
      fontSizePx: 30,
      pathOverflow: "error" as const,
    };
    const plain = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement("TextOnPath", props, "office"),
    );
    const painted = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        props,
        createElement("Inline", { color: "#ff0000" }, "o"),
        createElement("Inline", { color: "#0000ff" }, "ffice"),
      ),
    );
    const plainGlyphs =
      findTextNode(engine.renderToIR(plain).root)?.lines[0]?.positionedGlyphs ?? [];
    const paintedGlyphs =
      findTextNode(engine.renderToIR(painted).root)?.lines[0]?.positionedGlyphs ?? [];
    const shapeIdentity = (glyphs: typeof paintedGlyphs) =>
      glyphs.map((glyph) => ({
        glyphId: glyph.glyphId,
        text: glyph.text,
        clusterStart: glyph.clusterStart,
        clusterEnd: glyph.clusterEnd,
        originX: glyph.originX,
        originY: glyph.originY,
        xAdvance: glyph.xAdvance,
      }));
    expect(shapeIdentity(paintedGlyphs)).toEqual(shapeIdentity(plainGlyphs));
    expect(paintedGlyphs.map((glyph) => glyph.glyphId)).toEqual([80, 3145, 68, 70]);
    expect(paintedGlyphs.map((glyph) => glyph.fill)).toEqual([
      "#ff0000",
      "#0000ff",
      "#0000ff",
      "#0000ff",
    ]);
    expect(paintedGlyphs.map((glyph) => glyph.paintRangeIndex)).toEqual([0, 1, 1, 1]);
    const paintedSvg = engine.renderToSvg(painted);
    expect(paintedSvg).toContain('fill="#ff0000"');
    expect(paintedSvg).toContain('fill="#0000ff"');
    expect(engine.renderCompiledToSvg(engine.compile(painted))).toBe(paintedSvg);

    const clusterSplit = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        props,
        createElement("Inline", { color: "#ff0000" }, "of"),
        createElement("Inline", { color: "#0000ff" }, "fice"),
      ),
    );
    expect(() => engine.renderToIR(clusterSplit)).toThrow(
      expect.objectContaining({ code: "TEXT_PATH_INLINE_CLUSTER_SPLIT" }),
    );
  });

  it("inherits, replaces, and clears paint categories with node-wide layer-first emission", () => {
    const paintChildren = () => [
      "A",
      createElement("Inline", { color: "#222222" }, "B"),
      createElement(
        "Inline",
        {
          color: "#333333",
          textStrokes: [{ color: "#00aa00", widthPx: 2 }],
          textShadows: [],
        },
        "C",
      ),
      createElement(
        "Inline",
        {
          color: "#444444",
          textStrokes: [],
          textShadows: [{ dx: 2, dy: 2, color: "#0000ff" }],
        },
        "D",
      ),
    ];
    const rootPaint = {
      font: FONT,
      fontSizePx: 30,
      color: "#111111",
      textStrokes: [{ color: "#aaaaaa", widthPx: 4 }],
      textShadows: [{ dx: 1, dy: 1, color: "#101010" }],
    } as const;
    const path = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        {
          ...rootPaint,
          id: "paint-ranges",
          d: "M20 90L340 90",
          width: 350,
          height: 170,
          pathOverflow: "error",
        },
        ...paintChildren(),
      ),
    );
    const pathTextNode = findTextNode(engine.renderToIR(path).root);
    const pathGlyphs = pathTextNode?.lines[0]?.positionedGlyphs ?? [];
    expect(pathGlyphs.map((glyph) => glyph.fill)).toEqual([
      "#111111",
      "#222222",
      "#333333",
      "#444444",
    ]);
    expect(pathGlyphs.map((glyph) => glyph.paintRangeIndex)).toEqual([0, 1, 2, 3]);
    expect(pathGlyphs.map((glyph) => glyph.textStrokes?.map((layer) => layer.color))).toEqual([
      ["#aaaaaa"],
      ["#aaaaaa"],
      ["#00aa00"],
      [],
    ]);
    expect(pathGlyphs.map((glyph) => glyph.textShadows?.map((layer) => layer.color))).toEqual([
      ["#101010"],
      ["#101010"],
      [],
      ["#0000ff"],
    ]);

    const { svg, ir } = engine.renderToSvgAndIR(path);
    const resolvedPathTextNode = findTextNode(ir.root);
    const outlinePaths = resolvedPathTextNode?.glyphPaths ?? [];
    expect(outlinePaths.map((outline) => outline.paintRangeIndex)).toEqual([0, 1, 2, 3]);
    expect(outlinePaths.map((outline) => outline.fill)).toEqual([
      "#111111",
      "#222222",
      "#333333",
      "#444444",
    ]);
    expect(resolvedPathTextNode?.bbox.w).toBeGreaterThan(0);
    expect(resolvedPathTextNode?.bbox.h).toBeGreaterThan(0);
    if (resolvedPathTextNode) {
      expect(
        engine.hitTest(
          ir,
          resolvedPathTextNode.bbox.x + resolvedPathTextNode.bbox.w / 2,
          resolvedPathTextNode.bbox.y + resolvedPathTextNode.bbox.h / 2,
        ),
      ).toBe("paint-ranges");
    }
    expect(svg).toContain('data-boundsvg-text="ABCD"');
    expect(svg).toContain('aria-label="ABCD"');
    const rootShadowIndex = svg.indexOf('fill="#101010"');
    const replacementShadowIndex = svg.indexOf('fill="#0000ff"');
    const rootStrokeIndex = svg.indexOf('stroke="#aaaaaa"');
    const replacementStrokeIndex = svg.indexOf('stroke="#00aa00"');
    const firstFillIndex = svg.indexOf('fill="#111111"/>');
    expect(rootShadowIndex).toBeGreaterThan(-1);
    expect(replacementShadowIndex).toBeGreaterThan(rootShadowIndex);
    expect(rootStrokeIndex).toBeGreaterThan(replacementShadowIndex);
    expect(replacementStrokeIndex).toBeGreaterThan(rootStrokeIndex);
    expect(firstFillIndex).toBeGreaterThan(replacementStrokeIndex);
    expect(engine.renderCompiledToSvg(engine.compile(path))).toBe(svg);
    expect(engine.renderToPng(path).length).toBeGreaterThan(100);

    const normal = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement("Text", { ...rootPaint, width: 340 }, ...paintChildren()),
    );
    const normalGlyphs =
      findTextNode(engine.renderToIR(normal).root)?.lines[0]?.positionedGlyphs ?? [];
    expect(
      normalGlyphs.map((glyph) => ({
        fill: glyph.fill,
        strokes: glyph.textStrokes?.map((layer) => layer.color),
        shadows: glyph.textShadows?.map((layer) => layer.color),
      })),
    ).toEqual(
      pathGlyphs.map((glyph) => ({
        fill: glyph.fill,
        strokes: glyph.textStrokes?.map((layer) => layer.color),
        shadows: glyph.textShadows?.map((layer) => layer.color),
      })),
    );
  });

  it("uses one cumulative fit and source space across mixed shaping runs", () => {
    const vnode = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        {
          id: "path-text",
          d: "M20 90L340 90",
          width: 350,
          height: 170,
          font: FONT,
          fontSizePx: 16,
          pathFit: "scale",
          pathOverflow: "error",
        },
        "A",
        createElement(
          "Inline",
          {
            fontSizePx: 36,
            fontWeight: 700,
            fontVariationSettings: '"wght" 700',
            fontFeatureSettings: '"liga" 0',
          },
          "B",
        ),
        createElement("Inline", { letterSpacingPx: 4 }, "C"),
      ),
    );
    const textNode = findTextNode(engine.renderToIR(vnode).root);
    const glyphs = textNode?.lines[0]?.positionedGlyphs ?? [];
    expect(textNode?.sourceText).toBe("ABC");
    expect(textNode?.displayText).toBe("ABC");
    expect(textNode?.lines[0]?.width).toBeCloseTo(320, 9);
    expect(glyphs).toHaveLength(3);
    expect(glyphs.map((glyph) => glyph.sourceStart)).toEqual([0, 1, 2]);
    expect(glyphs.map((glyph) => glyph.sourceEnd)).toEqual([1, 2, 3]);
    expect(glyphs[1]?.fontWeight).toBe(700);
    expect(glyphs[1]?.fontSizePx).toBe(36);
    expect(glyphs[1]?.fontVariationSettings).toBe('"wght" 700');
    expect(glyphs[1]?.fontFeatureSettings).toBe('"liga" 0');
    expect(glyphs[1]?.xAdvance).toBeGreaterThan(glyphs[0]?.xAdvance ?? Number.POSITIVE_INFINITY);
    expect(new Set(glyphs.map((glyph) => glyph.inlineScale))).toHaveLength(1);
    expect(glyphs[0]?.originX).toBeCloseTo(20, 9);
    expect(glyphs[1]?.originX).toBeCloseTo(
      (glyphs[0]?.originX ?? 0) + (glyphs[0]?.xAdvance ?? 0),
      9,
    );
    expect(glyphs[2]?.originX).toBeCloseTo(
      (glyphs[1]?.originX ?? 0) + (glyphs[1]?.xAdvance ?? 0),
      9,
    );
    expect((glyphs[2]?.originX ?? 0) + (glyphs[2]?.xAdvance ?? 0)).toBeCloseTo(340, 9);
  });

  it("round-trips structured Scene children and removes the old content route", () => {
    const sceneDocument: CanvasSceneNode = {
      type: "Canvas",
      width: 360,
      height: 180,
      children: [
        {
          type: "TextOnPath",
          id: "path-text",
          d: "M20 90L340 90",
          width: 350,
          height: 170,
          font: FONT,
          fontSizePx: 24,
          pathOverflow: "error",
          children: [
            "A",
            {
              type: "Inline",
              fontWeight: 700,
              children: ["B", { type: "Inline", fontStyle: "italic", children: ["C"] }],
            },
          ],
        },
      ],
    };
    expect(findTextNode(engine.renderToIR(sceneDocument).root)?.sourceText).toBe("ABC");

    const vnode = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        {
          d: "M20 90L340 90",
          width: 350,
          height: 170,
          font: FONT,
          fontSizePx: 24,
        },
        "A",
        createElement(
          "Inline",
          { fontWeight: 700 },
          "B",
          createElement("Inline", { fontStyle: "italic" }, "C"),
        ),
      ),
    );
    const transport = JSON.parse(buildLayoutTransportJson(vnode, {})) as {
      root: { children: Array<{ textPath?: Record<string, unknown> }> };
    };
    const textPath = transport.root.children[0]?.textPath;
    expect(textPath).toMatchObject({
      sourceItemCount: 5,
      inlineCount: 2,
      decorationOwnerIds: [null, null, null],
    });
    expect(textPath?.spans).toEqual([
      expect.objectContaining({ text: "A", fontWeight: 400 }),
      expect.objectContaining({ text: "B", fontWeight: 700 }),
      expect.objectContaining({ text: "C", fontStyle: "italic" }),
    ]);
    expect(textPath).not.toHaveProperty("content");
  });

  it("keeps inherited and explicit TextOnPath decoration owners distinct", () => {
    const decoration = { line: "underline" as const, color: "#336699" };
    const vnode = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        {
          d: "M20 90Q180 20 340 90",
          width: 350,
          height: 170,
          font: FONT,
          fontSizePx: 24,
          textDecoration: decoration,
        },
        "A",
        createElement("Inline", {}, "B"),
        createElement("Inline", { textDecoration: { ...decoration } }, "C"),
        createElement("Inline", { textDecoration: "none" }, "D"),
      ),
    );
    const transport = JSON.parse(buildLayoutTransportJson(vnode, {})) as {
      root: {
        children: Array<{
          textPath?: {
            spans: Array<Record<string, unknown>>;
            decorationOwnerIds: Array<number | null>;
            textDecorationRangeCount?: number;
          };
        }>;
      };
    };
    const textPath = transport.root.children[0]?.textPath;
    expect(textPath?.spans.map((span) => span.text)).toEqual(["AB", "C", "D"]);
    expect(textPath?.decorationOwnerIds).toEqual([0, 1, null]);
    expect(textPath?.textDecorationRangeCount).toBe(2);
    expect(textPath?.spans[0]?.textDecoration).toMatchObject({
      line: ["underline"],
      color: "#336699",
      style: "solid",
      skipInk: "none",
    });
  });

  it("materializes every curved decoration style with fitted path-distance metadata", () => {
    const geometries = new Map<string, string>();
    for (const style of ["solid", "double", "dotted", "dashed", "wavy"] as const) {
      const vnode = withPathProps({
        textDecoration: {
          line: ["underline", "overline", "line-through"],
          style,
          color: "#f43f5e",
          thicknessPx: 2,
        },
      });
      const textNode = findTextNode(engine.renderToIR(vnode).root);
      expect(textNode?.textDecorations?.map((fragment) => fragment.line)).toEqual([
        "underline",
        "overline",
        "line-through",
      ]);
      expect(textNode?.textDecorations?.every((fragment) => fragment.style === style)).toBe(true);
      const paths = textNode?.textDecorations?.flatMap((fragment) => fragment.paths) ?? [];
      expect(paths.length).toBeGreaterThan(0);
      expect(
        paths.every(
          (path) =>
            path.d.endsWith("Z") &&
            path.contourCount > 0 &&
            path.segmentCount >= 4 &&
            Number.isFinite(path.pathDistanceStartPx) &&
            Number.isFinite(path.pathDistanceEndPx) &&
            (path.pathDistanceEndPx ?? 0) > (path.pathDistanceStartPx ?? 0),
        ),
      ).toBe(true);
      const svg = engine.renderToSvg(vnode);
      expect(svg).toContain('fill="#f43f5e" stroke="none"');
      expect(svg).not.toContain("<textPath");
      expect(svg).not.toContain("stroke-dasharray");
      geometries.set(style, JSON.stringify(paths));
    }
    expect(new Set(geometries.values())).toHaveLength(5);

    const rasterScene = withPathProps({
      textDecoration: {
        line: "underline",
        style: "wavy",
        color: "#f43f5e",
        thicknessPx: 2,
      },
    });
    expect(engine.renderToPng(rasterScene).length).toBeGreaterThan(100);
    expect(engine.renderCompiledToSvg(engine.compile(rasterScene))).toBe(
      engine.renderToSvg(rasterScene),
    );
  });

  it("keeps long closed-path wavy skip-ink geometry locally bounded", () => {
    const vnode = createElement(
      "Canvas",
      { width: 520, height: 240 },
      createElement(
        "TextOnPath",
        {
          id: "long-wavy-skip-ink",
          d: "M12 190C120 12 360 12 484 190L484 28L12 28Z",
          width: 500,
          height: 220,
          font: FONT,
          fontSizePx: 28,
          startOffsetPx: 0,
          textAnchor: "start",
          pathDirection: "forward",
          pathNormal: "left",
          pathOffsetPx: 0,
          pathFit: "none",
          pathOverflow: "error",
          textDecoration: {
            line: "underline",
            style: "wavy",
            skipInk: "all",
            color: "#67e8f9",
            thicknessPx: 2,
          },
        },
        "SCALE FIT SKIP INK PATH DEMO WAVY UNDERLINE TEST STRING HERE",
      ),
    );
    const { svg, ir } = engine.renderToSvgAndIR(vnode, { textPathMode: "merged" });
    const paths =
      findTextNode(ir.root)?.textDecorations?.flatMap((fragment) => fragment.paths) ?? [];

    expect(paths.length).toBeGreaterThan(50);
    expect(paths.every((path) => path.contourCount <= 2 && path.segmentCount < 200)).toBe(true);
    const maximumDiagonal = Math.max(
      ...paths.map((path) => {
        const bbox = parsePathBBox(path.d);
        if (!bbox) {
          throw new TypeError("Invalid wavy decoration path");
        }
        return Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
      }),
    );
    expect(maximumDiagonal).toBeLessThan(40);
    expect(svg.match(/fill="#67e8f9" stroke="none"/gu)).toHaveLength(1);
  });

  it("keeps inherited decoration metrics continuous and splits explicit owners", () => {
    const rootDecoration = {
      line: "underline" as const,
      style: "dashed" as const,
      color: "#336699",
      thicknessPx: 2,
    };
    const vnode = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        {
          id: "decoration-owners",
          d: "M20 100Q180 10 340 100",
          width: 350,
          height: 170,
          font: FONT,
          fontSizePx: 24,
          textDecoration: rootDecoration,
        },
        "A",
        createElement("Inline", { fontSizePx: 36 }, "B"),
        createElement("Inline", { textDecoration: { ...rootDecoration } }, "C"),
        createElement("Inline", { textDecoration: "none" }, "D"),
      ),
    );
    const textNode = findTextNode(engine.renderToIR(vnode).root);
    const fragments = textNode?.textDecorations ?? [];
    expect(fragments).toHaveLength(2);
    expect(fragments.map((fragment) => [fragment.sourceStart, fragment.sourceEnd])).toEqual([
      [0, 2],
      [2, 3],
    ]);
    expect(fragments.every((fragment) => fragment.style === "dashed")).toBe(true);
    expect(fragments.every((fragment) => fragment.paths.length > 0)).toBe(true);
    expect(fragments[0]?.paths[0]?.pathDistanceStartPx).toBeCloseTo(0, 9);
    expect(fragments[1]?.paths[0]?.pathDistanceStartPx).toBeGreaterThan(
      fragments[0]?.paths[0]?.pathDistanceStartPx ?? Number.POSITIVE_INFINITY,
    );
  });

  it.each([
    "solid",
    "double",
    "dotted",
    "dashed",
    "wavy",
  ] as const)("subtracts final curved glyph fill ink from %s geometry", (style) => {
    const decoration = {
      line: "underline" as const,
      style,
      color: "#ef4444",
      thicknessPx: 2,
      offsetPx: -12,
    };
    const continuous = findTextNode(
      engine.renderToIR(
        withPathProps({
          d: "M20 100Q180 20 340 100",
          pathNormal: "left",
          pathOffsetPx: 0,
          textDecoration: decoration,
        }),
      ).root,
    );
    const skippedTree = withPathProps({
      d: "M20 100Q180 20 340 100",
      pathNormal: "left",
      pathOffsetPx: 0,
      textDecoration: { ...decoration, skipInk: "all" },
    });
    const skipped = findTextNode(engine.renderToIR(skippedTree).root);

    expect(skipped?.lines).toEqual(continuous?.lines);
    expect(skipped?.textDecorations?.[0]?.skipInk).toBe("all");
    expect(skipped?.textDecorations?.[0]?.paths.map((path) => path.d)).not.toEqual(
      continuous?.textDecorations?.[0]?.paths.map((path) => path.d),
    );
    expect(engine.renderToSvg(skippedTree)).toContain('fill="#ef4444" stroke="none"');
  });

  it("preserves decoration phase across reverse closed seams, fitting, and ellipsis", () => {
    const closedProps = {
      d: "M20 20L330 20L330 150L20 150Z",
      startOffsetPx: 475,
      textAnchor: "middle" as const,
      pathDirection: "reverse" as const,
      pathNormal: "right" as const,
      pathOffsetPx: 5,
      pathFit: "scale" as const,
      pathOverflow: "error" as const,
      textDecoration: {
        line: "underline" as const,
        style: "dashed" as const,
        color: "#0ea5e9",
        thicknessPx: 2,
      },
    };
    const closed = findTextNode(engine.renderToIR(withPathProps(closedProps)).root);
    const closedPaths = closed?.textDecorations?.[0]?.paths ?? [];
    expect(closedPaths.length).toBeGreaterThanOrEqual(2);
    expect(
      closedPaths.every(
        (path) =>
          Number.isFinite(path.pathDistanceStartPx) && Number.isFinite(path.pathDistanceEndPx),
      ),
    ).toBe(true);
    expect(engine.renderToSvg(withPathProps(closedProps))).toBe(
      engine.renderToSvg(withPathProps(closedProps)),
    );

    const ellipsisTree = withPathProps({
      d: "M20 90L100 90",
      startOffsetPx: 0,
      textAnchor: "start",
      pathNormal: "left",
      pathOffsetPx: 0,
      pathOverflow: "ellipsis",
      textDecoration: {
        line: "underline",
        style: "wavy",
        color: "#0ea5e9",
        thicknessPx: 2,
      },
    });
    const ellipsis = findTextNode(engine.renderToIR(ellipsisTree).root);
    expect(ellipsis?.displayText).toMatch(/…$/u);
    expect(ellipsis?.sourceText).toBe("曲線 Path");
    expect(ellipsis?.textDecorations?.[0]?.sourceEnd).toBe("曲線 Path".length);
    expect(
      ellipsis?.textDecorations?.[0]?.paths.every(
        (path) => (path.pathDistanceEndPx ?? Number.POSITIVE_INFINITY) <= 80,
      ),
    ).toBe(true);
  });

  it("keeps curved decoration layer order and expands the actual bbox", () => {
    const vnode = withPathProps({
      textDecoration: {
        line: ["underline", "overline", "line-through"],
        style: "solid",
        color: "#12ab34",
        thicknessPx: 3,
        offsetPx: -16,
      },
    });
    const { svg, ir } = engine.renderToSvgAndIR(vnode);
    const textNode = findTextNode(ir.root);
    const paths = textNode?.textDecorations?.flatMap((fragment) => fragment.paths) ?? [];
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const pathBBox = parsePathBBox(path.d);
      expect(pathBBox).not.toBeNull();
      expect(textNode?.bbox.x).toBeLessThanOrEqual((pathBBox?.minX ?? 0) + path.originX);
      expect(textNode?.bbox.y).toBeLessThanOrEqual((pathBBox?.minY ?? 0) + path.originY);
      expect((textNode?.bbox.x ?? 0) + (textNode?.bbox.w ?? 0)).toBeGreaterThanOrEqual(
        (pathBBox?.maxX ?? 0) + path.originX,
      );
      expect((textNode?.bbox.y ?? 0) + (textNode?.bbox.h ?? 0)).toBeGreaterThanOrEqual(
        (pathBBox?.maxY ?? 0) + path.originY,
      );
    }

    const shadowIndex = svg.indexOf('filter="url(#');
    const firstDecorationIndex = svg.indexOf('fill="#12ab34" stroke="none"');
    const strokeIndex = svg.indexOf('stroke="#ffffff" stroke-width="3"');
    const glyphFillIndex = svg.indexOf('fill="#2463eb"', strokeIndex);
    const lineThroughIndex = svg.lastIndexOf('fill="#12ab34" stroke="none"');
    expect(shadowIndex).toBeGreaterThan(-1);
    expect(firstDecorationIndex).toBeGreaterThan(shadowIndex);
    expect(strokeIndex).toBeGreaterThan(firstDecorationIndex);
    expect(glyphFillIndex).toBeGreaterThan(strokeIndex);
    expect(lineThroughIndex).toBeGreaterThan(glyphFillIndex);
  });

  it("applies node animation to the outer group containing glyphs and curved decoration", () => {
    const vnode = withPathProps({
      textDecoration: {
        line: "underline",
        style: "wavy",
        color: "#f43f5e",
        thicknessPx: 2,
      },
      animate: {
        keyframes: [
          { at: 0, opacity: 0.25, transform: { translateX: 12 } },
          { at: 1, opacity: 1, transform: { translateX: 0 } },
        ],
        durationMs: 100,
        easing: "linear",
        fill: "both",
      },
    });
    const { svg, ir } = engine.renderToSvgAndIR(vnode, { timeMs: 0 });
    const animatedGroup = findNodeById(ir.root, "path-text");
    const decorationIndex = svg.indexOf('fill="#f43f5e" stroke="none"');
    const glyphIndex = svg.indexOf('fill="#2463eb"');
    expect(animatedGroup?.type).toBe("group");
    if (animatedGroup?.type !== "group") {
      throw new Error("expected animated TextOnPath group");
    }
    expect(animatedGroup.opacity).toBe(0.25);
    expect(animatedGroup.transform?.translateX).toBe(12);
    const animatedText = findTextNode(animatedGroup);
    expect(animatedText?.textDecorations?.length).toBeGreaterThan(0);
    expect(svg).toMatch(
      /<g(?=[^>]*opacity="0\.25")(?=[^>]*transform="translate\(12 0\)[^"]*")[^>]*>/,
    );
    expect(decorationIndex).toBeGreaterThan(-1);
    expect(glyphIndex).toBeGreaterThan(decorationIndex);
  });

  it("rejects nested missing fonts and invalid empty runs without silent fallback", () => {
    const nestedMissingFont = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        { d: "M20 90L340 90", width: 350, height: 170, font: FONT, fontSizePx: 24 },
        createElement("Inline", { font: "Missing" }, "missing"),
      ),
    );
    expect(() => engine.renderToIR(nestedMissingFont)).toThrow(
      expect.objectContaining({
        code: "TEXT_FONT_UNAVAILABLE",
        stage: "text",
        context: expect.objectContaining({
          operation: "renderTextLayout",
          runIndex: 0,
          requestedAliases: ["Missing"],
        }),
      }),
    );

    const invalidEmptyInline = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        { d: "M20 90L340 90", width: 350, height: 170, font: FONT, fontSizePx: 24 },
        "visible",
        createElement("Inline", { fontSizePx: Number.NaN }, ""),
      ),
    );
    expect(() => engine.renderToIR(invalidEmptyInline, { skipValidation: true })).toThrow(
      expect.objectContaining({ code: "TEXT_PATH_INVALID" }),
    );

    const unusedMissingFont = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        { d: "M20 90L340 90", width: 350, height: 170, font: FONT, fontSizePx: 24 },
        "visible",
        createElement("Inline", { font: "Missing" }, ""),
      ),
    );
    expect(() => engine.renderToIR(unusedMissingFont)).not.toThrow();
  });

  it("retains path metadata and emits the same positioned outlines to SVG and PNG", () => {
    const vnode = scene();
    const ir = engine.renderToIR(vnode);
    const textNode = findTextNode(ir.root);
    expect(textNode?.textLayoutKind).toBe("path");
    expect(textNode?.textPath).toEqual({
      d: "M20 90C100 10 240 10 330 90",
      startOffsetPx: 175,
      textAnchor: "middle",
      pathDirection: "forward",
      pathNormal: "right",
      pathOffsetPx: 6,
      pathFit: "none",
      pathOverflow: "error",
    });
    expect(textNode?.layoutBox).toEqual({ x: 0, y: 0, w: 350, h: 170 });
    expect(textNode?.bbox.w).toBeGreaterThan(0);
    expect(textNode?.bbox.h).toBeGreaterThan(0);
    if (textNode) {
      expect(
        engine.hitTest(
          ir,
          textNode.bbox.x + textNode.bbox.w / 2,
          textNode.bbox.y + textNode.bbox.h / 2,
        ),
      ).toBe("path-text");
    }
    const positionedGlyphs = textNode?.lines[0]?.positionedGlyphs ?? [];
    expect(positionedGlyphs.length).toBeGreaterThan(0);
    expect(positionedGlyphs.every((glyph) => glyph.absolutePosition === true)).toBe(true);
    expect(positionedGlyphs.some((glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) > 0.1)).toBe(
      true,
    );

    for (const textPathMode of ["merged", "glyphs"] as const) {
      const svg = engine.renderToSvg(vnode, { textPathMode });
      expect(svg).toContain('data-boundsvg-text="曲線 Path"');
      expect(svg).toContain('aria-label="曲線 Path"');
      expect(svg).not.toContain("<textPath");
      expect(svg).toContain("<path");
      expect(svg).toContain('stroke="#ffffff" stroke-width="3"');
    }
    const glyphIr = engine.renderToSvgAndIR(vnode, { textPathMode: "glyphs" }).ir;
    expect(getNodeText(buildTextMap(glyphIr), "path-text")).toBe("曲線 Path");
    expect(buildTextSelectionMap(glyphIr).nodes.get("path-text")?.glyphs.length).toBeGreaterThan(0);
    expect(engine.renderToSvg(vnode, { debug: true })).toContain("debug-overlay");
    const layered = engine.renderToLayeredSvg(withPathProps({ layer: "curve" }));
    expect(layered.layers.some((layer) => layer.id === "curve")).toBe(true);
    expect(layered.layers.find((layer) => layer.id === "curve")?.svg).toContain(
      'data-boundsvg-text="曲線 Path"',
    );
    expect(engine.renderToPng(vnode).length).toBeGreaterThan(100);
  });

  it("supports arcs, anchors, explicit normals, and hidden endpoint overflow", () => {
    const arc = findTextNode(
      engine.renderToIR(
        scene({
          d: "M20 100A90 70 0 0 1 300 100",
          startOffsetPx: -5,
          textAnchor: "end",
          pathDirection: "reverse",
          pathNormal: "left",
          pathOffsetPx: 12,
          pathOverflow: "hidden",
          text: "  Arc text overflow  ",
        }),
      ).root,
    );
    expect(arc?.lines[0]?.text).toBe("  Arc text overflow  ");
    expect(arc?.lines[0]?.glyphs.length).toBeGreaterThan(
      arc?.lines[0]?.positionedGlyphs?.length ?? 0,
    );
  });

  it("supports closed single-lap traversal with independent direction and normal", () => {
    const d = "M20 20L320 20L320 150Z";
    const probe = findTextNode(
      engine.renderToIR(
        scene({
          d,
          startOffsetPx: 0,
          textAnchor: "start",
          pathDirection: "forward",
          pathNormal: "left",
          pathOffsetPx: 0,
          text: "A",
        }),
      ).root,
    );
    const advance = probe?.lines[0]?.positionedGlyphs?.[0]?.xAdvance;
    expect(advance).toBeGreaterThan(0);
    const seamOffset = -(advance ?? 0) / 2;
    const forward = findTextNode(
      engine.renderToIR(
        scene({
          d,
          startOffsetPx: seamOffset,
          textAnchor: "start",
          pathDirection: "forward",
          pathNormal: "left",
          pathOffsetPx: 10,
          text: "A",
        }),
      ).root,
    );
    const reverse = findTextNode(
      engine.renderToIR(
        scene({
          d,
          startOffsetPx: seamOffset,
          textAnchor: "start",
          pathDirection: "reverse",
          pathNormal: "left",
          pathOffsetPx: 10,
          text: "A",
        }),
      ).root,
    );
    const right = findTextNode(
      engine.renderToIR(
        scene({
          d,
          startOffsetPx: seamOffset,
          textAnchor: "start",
          pathDirection: "forward",
          pathNormal: "right",
          pathOffsetPx: 10,
          text: "A",
        }),
      ).root,
    );
    const forwardGlyph = forward?.lines[0]?.positionedGlyphs?.[0];
    const reverseGlyph = reverse?.lines[0]?.positionedGlyphs?.[0];
    const rightGlyph = right?.lines[0]?.positionedGlyphs?.[0];
    expect(forward?.textPath).toEqual({
      d,
      startOffsetPx: seamOffset,
      textAnchor: "start",
      pathDirection: "forward",
      pathNormal: "left",
      pathOffsetPx: 10,
      pathFit: "none",
      pathOverflow: "error",
    });
    expect(reverse?.textPath?.pathDirection).toBe("reverse");
    expect(forwardGlyph?.glyphId).toBe(reverseGlyph?.glyphId);
    expect(forwardGlyph?.sourceStart).toBe(reverseGlyph?.sourceStart);
    expect(forwardGlyph?.sourceEnd).toBe(reverseGlyph?.sourceEnd);
    expect(forwardGlyph?.baselineRotationDeg).toBeCloseTo(0, 10);
    expect(reverseGlyph?.baselineRotationDeg).toBeCloseTo(
      (Math.atan2(130, 300) * 180) / Math.PI,
      10,
    );
    expect(forwardGlyph?.originY).toBeGreaterThan(rightGlyph?.originY ?? Number.POSITIVE_INFINITY);

    const perimeter = 300 + 130 + Math.hypot(300, 130);
    const wrapped = findTextNode(
      engine.renderToIR(
        scene({
          d,
          startOffsetPx: seamOffset + perimeter,
          textAnchor: "start",
          pathDirection: "forward",
          pathNormal: "left",
          pathOffsetPx: 10,
          text: "A",
        }),
      ).root,
    )?.lines[0]?.positionedGlyphs?.[0];
    expect(wrapped?.originX).toBeCloseTo(forwardGlyph?.originX ?? Number.NaN, 9);
    expect(wrapped?.originY).toBeCloseTo(forwardGlyph?.originY ?? Number.NaN, 9);
  });

  it("keeps hidden text accessible without exposing frame or guide hit targets", () => {
    const vnode = scene({
      d: "M20 90L330 90",
      startOffsetPx: -1_000,
      pathOverflow: "hidden",
      text: "hidden original",
    });
    const ir = engine.renderToIR(vnode);
    const textNode = findTextNode(ir.root);
    expect(textNode?.bbox).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(textNode?.lines[0]?.positionedGlyphs).toEqual([]);
    expect(engine.hitTest(ir, 100, 80)).toBeNull();

    const svg = engine.renderToSvg(vnode);
    expect(svg).toContain('data-boundsvg-text="hidden original"');
    expect(svg).toContain('aria-label="hidden original"');
    expect(svg).not.toContain("<textPath");
  });

  it("fails without partial output when any midpoint overflows in error mode", () => {
    expect(() =>
      engine.renderToSvg(
        scene({
          d: "M0 20L10 20",
          startOffsetPx: 0,
          textAnchor: "start",
          pathOverflow: "error",
          text: "overflow",
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "TEXT_PATH_OVERFLOW" }));
  });

  it.each([
    ["M0 0X10 0", "TEXT_PATH_INVALID_DATA"],
    ["M0 0L10 0M20 0L30 0", "TEXT_PATH_MULTIPLE_SUBPATHS_UNSUPPORTED"],
    ["M0 0", "TEXT_PATH_ZERO_LENGTH"],
  ])("maps path %s to %s", (d, code) => {
    try {
      engine.renderToSvg(scene({ d, text: "A" }));
      throw new Error("expected TextOnPath path error");
    } catch (error) {
      expect(error).toBeInstanceOf(FatalError);
      expect((error as FatalError).code).toBe(code);
    }
  });

  it("enforces the TextOnPath trust boundary when TS validation is skipped", () => {
    for (const [vnode, code] of [
      [withPathProps({ width: 0 }), "TEXT_PATH_INVALID"],
      [withPathProps({ textAnchor: "center" }), "TEXT_PATH_INVALID"],
      [withPathProps({ pathDirection: "backward" }), "TEXT_PATH_INVALID"],
      [withPathProps({ pathNormal: "up" }), "TEXT_PATH_INVALID"],
      [withPathProps({ pathFit: "stretch" }), "TEXT_PATH_INVALID"],
      [withPathProps({ pathOverflow: "clip" }), "TEXT_PATH_INVALID"],
      [withPathProps({ pathOffsetPx: -1 }), "TEXT_PATH_INVALID"],
      [withPathProps({ startOffsetPx: 1e12 + 1 }), "TEXT_PATH_OFFSET_LIMIT"],
      [scene({ text: "line\nbreak" }), "TEXT_PATH_MULTILINE_UNSUPPORTED"],
      [scene({ text: "" }), "TEXT_PATH_EMPTY_TEXT"],
    ] as const) {
      expect(() => engine.renderToSvg(vnode, { skipValidation: true })).toThrow(
        expect.objectContaining({ code }),
      );
    }
  });

  it("enforces curved decoration validation and ownership in Rust when TS validation is skipped", () => {
    expect(() =>
      engine.renderToSvg(
        withPathProps({ textDecoration: { line: "underline", style: "zigzag" } }),
        { skipValidation: true, timeMs: 0 },
      ),
    ).toThrow(expect.objectContaining({ code: "TEXT_DECORATION_INVALID" }));

    expect(() =>
      engine.renderToSvg(
        withPathProps({
          textDecoration: { line: "underline" },
          animateUnits: {
            by: "cluster",
            animation: {
              keyframes: [
                { at: 0, opacity: 0 },
                { at: 1, opacity: 1 },
              ],
              durationMs: 100,
            },
          },
        }),
        { skipValidation: true, timeMs: 0 },
      ),
    ).toThrow(expect.objectContaining({ code: "TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED" }));

    const overLimitOwners = Array.from({ length: 4_096 }, () =>
      createElement("Inline", { textDecoration: { line: "underline" } }, "x"),
    );
    const overLimitTree = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        {
          d: "M0 90L100000 90",
          width: 350,
          height: 170,
          font: FONT,
          fontSizePx: 12,
          pathOverflow: "error",
          textDecoration: { line: "underline" },
        },
        ...overLimitOwners,
      ),
    );
    expect(() => engine.renderToSvg(overLimitTree, { skipValidation: true })).toThrow(
      expect.objectContaining({ code: "TEXT_DECORATION_RANGE_LIMIT" }),
    );

    expect(() =>
      engine.renderToSvg(
        withPathProps({
          d: "M0 90L120 90L0 90",
          startOffsetPx: 0,
          textAnchor: "start",
          pathFit: "scale",
          pathNormal: "left",
          pathOffsetPx: 0,
          textDecoration: { line: "underline", thicknessPx: 2 },
        }),
        { skipValidation: true },
      ),
    ).toThrow(expect.objectContaining({ code: "TEXT_DECORATION_GEOMETRY" }));

    expect(() => engine.renderToSvg(scene())).not.toThrow();
  });

  it("allows unit animation when authored path decoration is stopped for all text", () => {
    const stoppedDecorationScene = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        {
          id: "stopped-decoration-path",
          d: "M20 90C100 10 240 10 330 90",
          width: 350,
          height: 170,
          font: FONT,
          fontSizePx: 30,
          textDecoration: { line: "underline" },
          animateUnits: {
            by: "cluster",
            animation: {
              keyframes: [
                { at: 0, opacity: 0 },
                { at: 1, opacity: 1 },
              ],
              durationMs: 100,
            },
          },
        },
        createElement("Inline", { textDecoration: "none" }, "plain units"),
      ),
    );

    const svg = engine.renderToAnimatedSvg(stoppedDecorationScene, {
      playback: { mode: "independent" },
    });
    expect(svg).toContain("@keyframes");
    expect(svg).not.toContain('data-boundsvg-text-decoration="underline"');
    expect(() =>
      engine.renderToSvg(stoppedDecorationScene, { skipValidation: true, timeMs: 0 }),
    ).not.toThrow();
  });

  it("maps the measured-point budget to the dedicated complexity error", () => {
    const atLimitSegments = Array.from(
      { length: 65_535 },
      (_, index) => `L${index % 2 === 0 ? 1 : 0} 0`,
    ).join("");
    expect(
      findTextNode(engine.renderToIR(scene({ d: `M0 0${atLimitSegments}`, text: "A" })).root)
        ?.lines[0]?.positionedGlyphs,
    ).toHaveLength(1);

    const overLimitSegments = Array.from(
      { length: 65_536 },
      (_, index) => `L${index % 2 === 0 ? 1 : 0} 0`,
    ).join("");
    expect(() => engine.renderToSvg(scene({ d: `M0 0${overLimitSegments}`, text: "A" }))).toThrow(
      expect.objectContaining({ code: "TEXT_PATH_COMPLEXITY_LIMIT" }),
    );
  });

  it("lays out a deterministic 10k-glyph straight path without truncation", () => {
    const text = "A".repeat(10_000);
    const vnode = scene({
      d: "M0 40L1000000 40",
      startOffsetPx: 0,
      textAnchor: "start",
      pathDirection: "forward",
      pathNormal: "left",
      pathOffsetPx: 0,
      pathOverflow: "error",
      text,
    });
    const first = findTextNode(engine.renderToIR(vnode).root);
    const second = findTextNode(engine.renderToIR(vnode).root);

    expect(first?.lines[0]?.positionedGlyphs).toHaveLength(10_000);
    expect(first?.lines).toEqual(second?.lines);
    expect(first?.bbox.w).toBeGreaterThan(100_000);
    expect(Number.isFinite(first?.bbox.w)).toBe(true);
  });

  it("applies scale, spacing, and shrink fitting before path placement", () => {
    const d = "M20 90L320 90";
    const scaled = findTextNode(
      engine.renderToIR(
        scene({
          d,
          startOffsetPx: 0,
          textAnchor: "start",
          pathNormal: "left",
          pathOffsetPx: 0,
          pathFit: "scale",
          text: "FIT",
        }),
      ).root,
    );
    expect(scaled?.textPath?.pathFit).toBe("scale");
    expect(scaled?.lines[0]?.width).toBeCloseTo(300, 9);
    expect(scaled?.lines[0]?.positionedGlyphs?.every((glyph) => (glyph.inlineScale ?? 1) > 1)).toBe(
      true,
    );
    expect(scaled?.sourceText).toBe("FIT");
    expect(scaled?.displayText).toBe("FIT");

    const spaced = findTextNode(
      engine.renderToIR(
        scene({
          d,
          startOffsetPx: 0,
          textAnchor: "start",
          pathNormal: "left",
          pathOffsetPx: 0,
          pathFit: "spacing",
          text: "SPACE",
        }),
      ).root,
    );
    const spacedGlyphs = spaced?.lines[0]?.positionedGlyphs ?? [];
    expect(spaced?.lines[0]?.width).toBeCloseTo(300, 9);
    expect(spacedGlyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0)).toBeCloseTo(300, 9);
    expect(spacedGlyphs.every((glyph) => glyph.inlineScale === undefined)).toBe(true);

    const shrink = findTextNode(
      engine.renderToIR(
        scene({
          d,
          startOffsetPx: 0,
          textAnchor: "start",
          pathNormal: "left",
          pathOffsetPx: 0,
          pathFit: "shrink",
          text: "A",
        }),
      ).root,
    );
    expect(shrink?.lines[0]?.width).toBeLessThan(300);
    expect(shrink?.lines[0]?.positionedGlyphs?.[0]?.inlineScale).toBeUndefined();
  });

  it("renders a synthetic ellipsis while retaining original aria and source identity", () => {
    const original = "ABCDEFGHIJKLMN";
    const vnode = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "TextOnPath",
        {
          id: "path-text",
          d: "M20 90L150 90",
          width: 350,
          height: 170,
          font: FONT,
          fontSizePx: 30,
          startOffsetPx: 0,
          textAnchor: "start",
          pathNormal: "left",
          pathOffsetPx: 0,
          pathOverflow: "ellipsis",
        },
        createElement("Inline", { color: "#ff0000" }, original.slice(0, 1)),
        createElement(
          "Inline",
          {
            color: "#0000ff",
            textStrokes: [{ color: "#00ff00", widthPx: 2 }],
            textShadows: [{ dx: 1, dy: 1, color: "#00000080" }],
          },
          original.slice(1),
        ),
      ),
    );
    const textNode = findTextNode(engine.renderToIR(vnode).root);
    expect(textNode?.sourceText).toBe(original);
    expect(textNode?.displayText).toMatch(/…$/u);
    expect(textNode?.lines[0]?.text).toBe(original);
    const ellipsisGlyph = textNode?.lines[0]?.positionedGlyphs?.at(-1);
    expect(ellipsisGlyph?.syntheticKind).toBe("ellipsis");
    expect(ellipsisGlyph?.sourceStart).toBeUndefined();
    expect(ellipsisGlyph?.sourceEnd).toBeUndefined();
    expect(ellipsisGlyph?.sourceRole).toBeUndefined();
    expect(ellipsisGlyph?.fill).toBe("#0000ff");
    expect(ellipsisGlyph?.textStrokes).toEqual([
      expect.objectContaining({ color: "#00ff00", widthPx: 2 }),
    ]);
    expect(ellipsisGlyph?.textShadows).toEqual([
      expect.objectContaining({ color: "#00000080", dx: 1, dy: 1 }),
    ]);

    for (const textPathMode of ["merged", "glyphs"] as const) {
      const svg = engine.renderToSvg(vnode, { textPathMode });
      expect(svg).toContain(`data-boundsvg-text="${original}"`);
      expect(svg).toContain(`aria-label="${original}"`);
    }
    expect(engine.renderToPng(vnode).length).toBeGreaterThan(100);
    const compiled = engine.compile(vnode);
    expect(engine.renderCompiledToSvg(compiled)).toBe(engine.renderToSvg(vnode));
  });

  it("maps fitting failures and the path cluster budget to stable fatal codes", () => {
    expect(() =>
      engine.renderToSvg(
        scene({
          d: "M0 20L0.01 20",
          startOffsetPx: 0,
          textAnchor: "start",
          pathFit: "scale",
          pathOverflow: "hidden",
          text: "too wide",
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "TEXT_PATH_FIT_UNSATISFIABLE" }));

    expect(() =>
      engine.renderToSvg(
        scene({
          d: "M0 20L1000000 20",
          startOffsetPx: 0,
          textAnchor: "start",
          pathFit: "scale",
          pathOverflow: "hidden",
          text: "A".repeat(16_385),
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "TEXT_PATH_CLUSTER_LIMIT" }));
  });
});
