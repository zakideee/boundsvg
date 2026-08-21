import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import type { IRNode, IRTextNode } from "../../src/ir/types.js";
import type { BBox } from "../../src/text/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { AnimationSpec, TextUnitAnimation, VNode } from "../../src/vnode/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

const PATH_UNIT_TRACK: AnimationSpec = {
  keyframes: [
    {
      at: 0,
      opacity: 0.2,
      transform: { translateY: 10, rotateDeg: -8, scaleX: 0.85, scaleY: 0.85 },
    },
    {
      at: 1,
      opacity: 1,
      transform: { translateY: 0, rotateDeg: 0, scaleX: 1, scaleY: 1 },
    },
  ],
  durationMs: 400,
  easing: "linear",
  fill: "both",
};

const CLUSTER_ANIMATION: TextUnitAnimation = {
  by: "cluster",
  animation: PATH_UNIT_TRACK,
  delayStepMs: 30,
  order: "logical",
};

function findText(node: IRNode, nodeId: string): IRTextNode {
  if (node.type === "text" && node.nodeId === nodeId) {
    return node;
  }
  for (const child of node.children ?? []) {
    try {
      return findText(child, nodeId);
    } catch {
      // Continue the deterministic tree walk.
    }
  }
  throw new TypeError(`Missing Text IR node ${nodeId}`);
}

function textOnPathScene(
  overrides: Partial<{
    id: string;
    d: string;
    startOffsetPx: number;
    pathDirection: "forward" | "reverse";
    pathNormal: "left" | "right";
    pathFit: "none" | "spacing" | "scale" | "shrink";
    pathOverflow: "hidden" | "error" | "ellipsis";
    animateUnits: TextUnitAnimation;
    text: string;
    children: Array<string | VNode>;
    effects: boolean;
  }> = {},
): VNode {
  return createElement(
    "Canvas",
    { width: 460, height: 220, background: "#071827" },
    createElement(
      "TextOnPath",
      {
        id: overrides.id ?? "path-units",
        d: overrides.d ?? "M20 170C100 20 350 20 440 170",
        width: 460,
        height: 220,
        font: "NotoSansJP",
        fontSizePx: 30,
        color: "#f8fafc",
        startOffsetPx: overrides.startOffsetPx ?? 230,
        textAnchor: "middle",
        pathDirection: overrides.pathDirection,
        pathNormal: overrides.pathNormal,
        pathFit: overrides.pathFit,
        pathOverflow: overrides.pathOverflow ?? "error",
        animateUnits: overrides.animateUnits ?? CLUSTER_ANIMATION,
        ...(overrides.effects
          ? {
              textShadows: [
                { dx: 3, dy: 4, blurPx: 0, color: "#020617" },
                { dx: -1, dy: 1, blurPx: 0, color: "#0891b2" },
              ],
              textStrokes: [
                { color: "#ef4444", widthPx: 4 },
                { color: "#38bdf8", widthPx: 2 },
              ],
            }
          : {}),
      },
      ...(overrides.children ?? [overrides.text ?? "Afi e\u0301日本"]),
    ),
  );
}

function richPathChildren(paintVariant: "cool" | "warm"): Array<string | VNode> {
  const accent = paintVariant === "cool" ? "#22d3ee" : "#fb7185";
  const stroke = paintVariant === "cool" ? "#155e75" : "#9f1239";
  const shadow = paintVariant === "cool" ? "#083344" : "#4c0519";
  return [
    "A",
    createElement("Inline", { color: accent }, "B"),
    createElement(
      "Inline",
      {
        textStrokes: [{ color: stroke, widthPx: 2 }],
        textShadows: [{ dx: 2, dy: 1, blurPx: 0, color: shadow }],
      },
      createElement("Inline", { color: accent }, "日本"),
    ),
    "CD",
  ];
}

function normalTextScene(text: string): VNode {
  return createElement(
    "Canvas",
    { width: 460, height: 220 },
    createElement(
      "Text",
      {
        id: "normal-units",
        font: "NotoSansJP",
        fontSizePx: 30,
        wrap: "none",
        animateUnits: CLUSTER_ANIMATION,
      },
      text,
    ),
  );
}

function textMotionV2Scene(): VNode {
  return createElement(
    "Canvas",
    { width: 520, height: 320, background: "#071827" },
    createElement(
      "Text",
      {
        id: "v2-decoration",
        position: "absolute",
        left: 24,
        top: 18,
        width: 470,
        font: "NotoSansJP",
        fontSizePx: 28,
        color: "#f8fafc",
        textDecoration: {
          line: "underline",
          style: "wavy",
          color: "#fb7185",
          thicknessPx: 2,
          offsetPx: -10,
          skipInk: "all",
        },
        animate: PATH_UNIT_TRACK,
      },
      "Text motion V2 装飾交差",
    ),
    createElement(
      "TextOnPath",
      {
        id: "v2-closed-path",
        position: "absolute",
        left: 24,
        top: 76,
        d: "M12 190L460 190L460 12L12 12Z",
        width: 472,
        height: 210,
        font: "NotoSansJP",
        fontSizePx: 28,
        color: "#67e8f9",
        startOffsetPx: 500,
        textAnchor: "middle",
        pathDirection: "reverse",
        pathNormal: "right",
        pathOffsetPx: 4,
        pathFit: "scale",
        pathOverflow: "error",
        textStrokes: [{ color: "#164e63", widthPx: 2 }],
        animateUnits: CLUSTER_ANIMATION,
      },
      "閉路 reverse scale",
    ),
    createElement(
      "TextOnPath",
      {
        id: "v2-ellipsis-path",
        position: "absolute",
        left: 24,
        top: 250,
        d: "M12 34L230 34",
        width: 472,
        height: 60,
        font: "NotoSansJP",
        fontSizePx: 24,
        color: "#fde68a",
        startOffsetPx: 0,
        textAnchor: "start",
        pathFit: "spacing",
        pathOverflow: "ellipsis",
        animateUnits: CLUSTER_ANIMATION,
      },
      "ellipsis source identity を保持する経路",
    ),
  );
}

function textMotionV3IntegrationScene(): VNode {
  return createElement(
    "Canvas",
    { width: 560, height: 360, background: "#071827" },
    createElement(
      "TextOnPath",
      {
        id: "v3-rich-closed-decoration",
        position: "absolute",
        left: 24,
        top: 20,
        d: "M12 190C120 12 360 12 484 190L484 28L12 28Z",
        width: 500,
        height: 220,
        font: "NotoSansJP",
        fontSizePx: 28,
        color: "#e0f2fe",
        startOffsetPx: 620,
        textAnchor: "middle",
        pathDirection: "reverse",
        pathNormal: "right",
        pathOffsetPx: 5,
        pathFit: "scale",
        pathOverflow: "error",
        textStrokes: [{ color: "#164e63", widthPx: 3 }],
        textShadows: [{ dx: 3, dy: 2, blurPx: 0, color: "#020617" }],
        textDecoration: {
          line: "underline",
          style: "dashed",
          color: "#67e8f9",
          thicknessPx: 2,
          offsetPx: -9,
          skipInk: "all",
        },
        animate: PATH_UNIT_TRACK,
      },
      "AB",
      createElement(
        "Inline",
        {
          fontWeight: 700,
          fontSizePx: 36,
          color: "#fb7185",
          textStrokes: [{ color: "#9f1239", widthPx: 2 }],
          textShadows: [{ dx: 1, dy: 2, blurPx: 0, color: "#4c0519" }],
          textDecoration: {
            line: "underline",
            style: "wavy",
            color: "#fda4af",
            thicknessPx: 2,
            offsetPx: -11,
            skipInk: "all",
          },
        },
        "曲線",
      ),
      createElement("Inline", { color: "#fde68a", textDecoration: "none" }, "Z"),
    ),
    createElement(
      "TextOnPath",
      {
        id: "v3-rich-effects-ellipsis",
        position: "absolute",
        left: 24,
        top: 272,
        d: "M12 42Q130 2 248 42",
        width: 500,
        height: 70,
        font: "NotoSansJP",
        fontSizePx: 24,
        color: "#f8fafc",
        startOffsetPx: 0,
        textAnchor: "start",
        pathFit: "spacing",
        pathOverflow: "ellipsis",
        textStrokes: [{ color: "#0e7490", widthPx: 2 }],
        textShadows: [{ dx: 2, dy: 2, blurPx: 0, color: "#083344" }],
        textDecoration: {
          line: "underline",
          style: "double",
          color: "#f97316",
          thicknessPx: 2,
          skipInk: "none",
        },
        animate: PATH_UNIT_TRACK,
      },
      "rich ",
      createElement(
        "Inline",
        {
          fontWeight: 700,
          color: "#fbbf24",
          textStrokes: [{ color: "#78350f", widthPx: 2 }],
        },
        "ellipsis effects",
      ),
      " source identity 日本語",
    ),
  );
}

function unionBbox(left: BBox | undefined, right: BBox): BBox {
  if (!left) {
    return right;
  }
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.w, right.x + right.w);
  const bottomEdge = Math.max(left.y + left.h, right.y + right.h);
  return { x, y, w: rightEdge - x, h: bottomEdge - y };
}

function expectBboxClose(actual: BBox | undefined, expected: BBox | undefined): void {
  expect(actual).toBeDefined();
  expect(expected).toBeDefined();
  for (const key of ["x", "y", "w", "h"] as const) {
    expect(actual?.[key]).toBeCloseTo(expected?.[key] ?? Number.NaN, 10);
  }
}

describe("TextOnPath animation hardening", () => {
  let handle: WasmEngineHandle;
  let engine: Engine;
  let rasterize: (svg: string) => Uint8Array;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
    rasterize = handle.createSvgToPngFn();
    engine = createEngineFromHandle(handle, { svgToPngFn: rasterize });
  });

  afterAll(() => {
    engine.dispose();
    handle.dispose();
  });

  it("preserves normal Text cluster identity and uses final rotated outline bounds", () => {
    const content = "Afi e\u0301日本";
    const pathText = findText(
      engine.renderToIR(textOnPathScene({ text: content })).root,
      "path-units",
    );
    const normalText = findText(engine.renderToIR(normalTextScene(content)).root, "normal-units");

    expect(pathText.unitMap).toEqual(normalText.unitMap);
    expect(
      pathText.lines[0]?.positionedGlyphs?.some(
        (glyph) => Math.abs(glyph.baselineRotationDeg ?? 0) > 1,
      ),
    ).toBe(true);

    for (const sample of pathText.unitAnimationSamples ?? []) {
      const expectedBbox = pathText.glyphPaths
        ?.filter((path) => path.unitId === sample.unitId)
        .reduce<BBox | undefined>((bbox, path) => unionBbox(bbox, path.bbox), undefined);
      if (expectedBbox) {
        expectBboxClose(sample.bbox, expectedBbox);
      } else {
        expect(sample.bbox).toBeUndefined();
      }
    }
  });

  it("keeps rich paint boundaries out of UnitMap identity and final member indices", () => {
    const content = "AB日本CD";
    const plain = findText(
      engine.renderToIR(textOnPathScene({ text: content })).root,
      "path-units",
    );
    const cool = findText(
      engine.renderToIR(textOnPathScene({ children: richPathChildren("cool") })).root,
      "path-units",
    );
    const warm = findText(
      engine.renderToIR(textOnPathScene({ children: richPathChildren("warm") })).root,
      "path-units",
    );

    expect(cool.unitMap).toEqual(plain.unitMap);
    expect(warm.unitMap).toEqual(plain.unitMap);
    const positionedGeometry = (text: IRTextNode) =>
      text.lines[0]?.positionedGlyphs?.map((glyph) => ({
        glyphId: glyph.glyphId,
        sourceStart: glyph.sourceStart,
        sourceEnd: glyph.sourceEnd,
        originX: glyph.originX,
        originY: glyph.originY,
        xAdvance: glyph.xAdvance,
        baselineRotationDeg: glyph.baselineRotationDeg,
      }));
    expect(positionedGeometry(cool)).toEqual(positionedGeometry(plain));
    expect(positionedGeometry(warm)).toEqual(positionedGeometry(plain));
    expect(cool.glyphPaths).not.toEqual(warm.glyphPaths);

    for (const unit of cool.unitMap?.units ?? []) {
      expect(unit.members.length).toBeGreaterThan(0);
      for (const member of unit.members) {
        const glyph = cool.lines[member.lineIndex]?.positionedGlyphs?.[member.glyphIndex];
        expect(glyph).toBeDefined();
        expect(glyph?.sourceStart).toBeGreaterThanOrEqual(unit.sourceStart);
        expect(glyph?.sourceEnd).toBeLessThanOrEqual(unit.sourceEnd);
      }
      expect(cool.glyphPaths?.some((path) => path.unitId === unit.unitId)).toBe(true);
    }
  });

  it("keeps no-decoration rich unit paint layer-first across static and declarative routes", () => {
    const scene = textOnPathScene({ children: richPathChildren("cool") });
    const staticSvg = engine.renderToSvg(scene, { animation: "static", timeMs: 180 });
    const declarativeSvg = engine.renderToSvg(scene, {
      animation: "declarative",
      timeMs: 180,
    });
    const shadowIndex = declarativeSvg.indexOf('fill="#083344"');
    const strokeIndex = declarativeSvg.indexOf('stroke="#155e75"');
    const accentFillIndex = declarativeSvg.indexOf('fill="#22d3ee"');

    expect(shadowIndex).toBeGreaterThan(-1);
    expect(strokeIndex).toBeGreaterThan(shadowIndex);
    expect(accentFillIndex).toBeGreaterThan(strokeIndex);
    expect(declarativeSvg).toContain("@keyframes");
    expect(rasterize(declarativeSvg)).toEqual(rasterize(staticSvg));
    expect(engine.renderToPng(scene, { animation: "static", timeMs: 180 })).toEqual(
      rasterize(staticSvg),
    );
    expect(
      engine.renderCompiledToSvg(engine.compile(scene), {
        animation: "static",
        timeMs: 180,
      }),
    ).toBe(staticSvg);
  });

  it("counts rich paint layers in the unit animation fragment budget", () => {
    const strokes = Array.from({ length: 8 }, (_, index) => ({
      color: index % 2 === 0 ? "#0f172a" : "#38bdf8",
      widthPx: 18 - index * 2,
    }));
    const budgetScene = (unitCount: number) =>
      createElement(
        "Canvas",
        { width: 460, height: 220 },
        createElement(
          "TextOnPath",
          {
            id: "rich-unit-budget",
            d: "M0 110L100000 110",
            width: 460,
            height: 220,
            font: "NotoSansJP",
            fontSizePx: 12,
            startOffsetPx: 0,
            textAnchor: "start",
            pathOverflow: "error",
            animateUnits: CLUSTER_ANIMATION,
          },
          createElement("Inline", { textStrokes: strokes }, "i".repeat(unitCount)),
        ),
      );

    expect(() => engine.renderToIR(budgetScene(910))).not.toThrow();
    expect(() => engine.renderToIR(budgetScene(911))).toThrow(
      expect.objectContaining({ code: "TEXT_ANIMATION_FRAGMENT_LIMIT_EXCEEDED" }),
    );
  });

  it("counts every rich paint range owned by one line animation unit", () => {
    const rangeScene = (rangeCount: number) =>
      createElement(
        "Canvas",
        { width: 460, height: 220 },
        createElement(
          "TextOnPath",
          {
            id: "rich-line-range-budget",
            d: "M0 110L100000 110",
            width: 460,
            height: 220,
            font: "NotoSansJP",
            fontSizePx: 12,
            startOffsetPx: 0,
            textAnchor: "start",
            pathOverflow: "error",
            animateUnits: { ...CLUSTER_ANIMATION, by: "line" },
          },
          ...Array.from({ length: rangeCount }, (_, index) =>
            createElement(
              "Inline",
              {
                textStrokes: Array.from({ length: 8 }, (_, layerIndex) => ({
                  color: index % 2 === 0 ? "#0f172a" : "#38bdf8",
                  widthPx: 18 - layerIndex * 2,
                })),
              },
              "i",
            ),
          ),
        ),
      );

    expect(() => engine.renderToIR(rangeScene(910))).not.toThrow();
    expect(() => engine.renderToIR(rangeScene(911))).toThrow(
      expect.objectContaining({ code: "TEXT_ANIMATION_FRAGMENT_LIMIT_EXCEEDED" }),
    );
  }, 15_000);

  it("retains hidden logical units while omitting their members, bounds, paint, and hits", () => {
    const visible = findText(
      engine.renderToIR(textOnPathScene({ text: "ABCD" })).root,
      "path-units",
    );
    const hiddenScene = textOnPathScene({
      text: "ABCD",
      startOffsetPx: -10_000,
      pathOverflow: "hidden",
    });
    const hiddenIr = engine.renderToIR(hiddenScene, { timeMs: 200 });
    const hidden = findText(hiddenIr.root, "path-units");

    expect(hidden.unitMap?.units.map((unit) => unit.unitId)).toEqual(
      visible.unitMap?.units.map((unit) => unit.unitId),
    );
    expect(hidden.unitMap?.units.every((unit) => unit.members.length === 0)).toBe(true);
    expect(hidden.unitAnimationSamples).toHaveLength(hidden.unitMap?.units.length);
    expect(hidden.unitAnimationSamples?.every((sample) => sample.bbox === undefined)).toBe(true);
    expect(hidden.glyphPaths).toEqual([]);
    expect(hidden.bbox).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(engine.hitTest(hiddenIr, 230, 110)).toBeNull();
    const svg = engine.renderToSvg(hiddenScene, { animation: "declarative", timeMs: 200 });
    expect(svg).toContain('aria-label="ABCD"');
    expect(svg).not.toContain("@keyframes");
  });

  it("treats one path line as one line unit", () => {
    const scene = textOnPathScene({
      animateUnits: { ...CLUSTER_ANIMATION, by: "line" },
      text: "一行の曲線文字",
    });
    const text = findText(engine.renderToIR(scene, { timeMs: 200 }).root, "path-units");

    expect(text.lines).toHaveLength(1);
    expect(text.unitMap?.units).toHaveLength(1);
    expect(new Set(text.glyphPaths?.map((path) => path.unitId))).toEqual(
      new Set([text.unitMap?.units[0]?.unitId]),
    );
  });

  it.each([
    0, 180, 700,
  ])("keeps declarative, static, PNG, and compiled output equal at timeMs=%i", (timeMs) => {
    const scene = textOnPathScene({ effects: true });
    const renderOptions = { animation: "static" as const, timeMs };
    const staticSvg = engine.renderToSvg(scene, renderOptions);
    const declarativeSvg = engine.renderToSvg(scene, {
      animation: "declarative",
      timeMs,
    });

    expect(declarativeSvg).toContain("@keyframes");
    expect(rasterize(declarativeSvg)).toEqual(rasterize(staticSvg));
    expect(engine.renderToPng(scene, renderOptions)).toEqual(rasterize(staticSvg));
    expect(engine.renderCompiledToSvg(engine.compile(scene), renderOptions)).toBe(staticSvg);
  });

  it("keeps prepared A1 batch frames equal to one-shot static renders", () => {
    const scene = textOnPathScene();
    const timesMs = [400, 0, 180, 700, 180];
    const frames = [...engine.renderFrames(scene, { timesMs, format: "svg" })];

    expect(frames.map((frame) => frame.data)).toEqual(
      timesMs.map((timeMs) => engine.renderToSvg(scene, { animation: "static", timeMs })),
    );
  });

  it("reflows A2 path geometry while preserving source and unit identity", () => {
    const startScene = textOnPathScene({
      d: "M20 110L440 110",
      startOffsetPx: 160,
      text: "字幕 Animation",
    });
    const endScene = textOnPathScene({
      d: "M20 180C110 10 350 10 440 180",
      startOffsetPx: 300,
      text: "字幕 Animation",
    });
    const start = findText(engine.renderToIR(startScene, { timeMs: 180 }).root, "path-units");
    const end = findText(engine.renderToIR(endScene, { timeMs: 180 }).root, "path-units");

    expect(start.unitMap?.units.map((unit) => unit.unitId)).toEqual(
      end.unitMap?.units.map((unit) => unit.unitId),
    );
    expect(start.unitMap?.units.map(({ lineId }) => lineId)).toEqual(
      end.unitMap?.units.map(({ lineId }) => lineId),
    );
    expect(start.lines[0]?.positionedGlyphs).not.toEqual(end.lines[0]?.positionedGlyphs);
    expect(start.unitAnimationSamples?.map((sample) => sample.bbox)).not.toEqual(
      end.unitAnimationSamples?.map((sample) => sample.bbox),
    );
    expect(engine.renderToSvg(startScene, { animation: "static", timeMs: 180 })).not.toBe(
      engine.renderToSvg(endScene, { animation: "static", timeMs: 180 }),
    );
  });

  it("recomputes fitted A2 geometry without changing logical unit identity", () => {
    const content = "字幕 Animation ".repeat(4);
    const startScene = textOnPathScene({
      d: "M20 110L220 110",
      startOffsetPx: 100,
      pathFit: "shrink",
      text: content,
    });
    const endScene = textOnPathScene({
      d: "M20 180L420 180",
      startOffsetPx: 200,
      pathFit: "shrink",
      text: content,
    });
    const start = findText(engine.renderToIR(startScene, { timeMs: 180 }).root, "path-units");
    const end = findText(engine.renderToIR(endScene, { timeMs: 180 }).root, "path-units");

    expect(start.unitMap?.units.map((unit) => unit.unitId)).toEqual(
      end.unitMap?.units.map((unit) => unit.unitId),
    );
    expect(start.sourceText).toBe(content);
    expect(start.displayText).toBe(content);
    expect(end.sourceText).toBe(content);
    expect(end.displayText).toBe(content);
    expect(start.lines[0]?.width).toBeCloseTo(200, 9);
    expect(end.lines[0]?.width).toBeCloseTo(400, 9);
    expect(start.lines[0]?.positionedGlyphs?.[0]?.inlineScale).not.toBe(
      end.lines[0]?.positionedGlyphs?.[0]?.inlineScale,
    );
    expect(engine.renderToSvg(startScene, { animation: "static", timeMs: 180 })).not.toBe(
      engine.renderToSvg(endScene, { animation: "static", timeMs: 180 }),
    );
  });

  it("recomputes rich A2 style, direction, and fit without stale UnitMap state", () => {
    const straight = textOnPathScene({
      d: "M20 110L440 110",
      startOffsetPx: 210,
      pathFit: "spacing",
      children: richPathChildren("cool"),
    });
    const paintChanged = textOnPathScene({
      d: "M20 110L440 110",
      startOffsetPx: 210,
      pathFit: "spacing",
      children: richPathChildren("warm"),
    });
    const geometryChanged = textOnPathScene({
      d: "M20 190L440 190L440 60L20 60Z",
      startOffsetPx: 540,
      pathDirection: "reverse",
      pathNormal: "right",
      pathFit: "shrink",
      children: richPathChildren("warm"),
    });
    const appended = textOnPathScene({
      d: "M20 110L440 110",
      startOffsetPx: 210,
      pathFit: "spacing",
      children: [...richPathChildren("cool"), "Z"],
    });
    const straightText = findText(engine.renderToIR(straight, { timeMs: 180 }).root, "path-units");
    const paintText = findText(engine.renderToIR(paintChanged, { timeMs: 180 }).root, "path-units");
    const geometryText = findText(
      engine.renderToIR(geometryChanged, { timeMs: 180 }).root,
      "path-units",
    );
    const appendedText = findText(engine.renderToIR(appended, { timeMs: 180 }).root, "path-units");
    const unitIds = (text: IRTextNode) => text.unitMap?.units.map((unit) => unit.unitId) ?? [];

    expect(paintText.unitMap).toEqual(straightText.unitMap);
    expect(unitIds(geometryText)).toEqual(unitIds(straightText));
    expect(appendedText.unitMap?.units.slice(0, -1).map((unit) => unit.unitId)).toEqual(
      unitIds(straightText),
    );
    expect(straightText.lines[0]?.positionedGlyphs).toEqual(
      paintText.lines[0]?.positionedGlyphs?.map((glyph, index) => ({
        ...glyph,
        fill: straightText.lines[0]?.positionedGlyphs?.[index]?.fill,
        textStrokes: straightText.lines[0]?.positionedGlyphs?.[index]?.textStrokes,
        textShadows: straightText.lines[0]?.positionedGlyphs?.[index]?.textShadows,
        paintRangeIndex: straightText.lines[0]?.positionedGlyphs?.[index]?.paintRangeIndex,
      })),
    );
    expect(geometryText.lines[0]?.positionedGlyphs).not.toEqual(
      straightText.lines[0]?.positionedGlyphs,
    );
    expect(geometryText.unitAnimationSamples?.map((sample) => sample.bbox)).not.toEqual(
      straightText.unitAnimationSamples?.map((sample) => sample.bbox),
    );
    expect(engine.renderToSvg(paintChanged, { animation: "static", timeMs: 180 })).not.toBe(
      engine.renderToSvg(straight, { animation: "static", timeMs: 180 }),
    );
  });

  it("keeps synthetic ellipsis outside source units while retaining effects and hit bounds", () => {
    const content = "ABCDEFGHIJKLMN";
    const scene = textOnPathScene({
      d: "M20 110L170 110",
      startOffsetPx: 75,
      pathOverflow: "ellipsis",
      text: content,
      effects: true,
    });
    const artifacts = engine.renderToSvgAndIR(scene, {
      animation: "declarative",
      timeMs: 180,
      textPathMode: "glyphs",
    });
    const text = findText(artifacts.ir.root, "path-units");
    const positionedGlyphs = text.lines[0]?.positionedGlyphs ?? [];
    const ellipsisIndex = positionedGlyphs.length - 1;

    expect(text.sourceText).toBe(content);
    expect(text.displayText).toMatch(/…$/u);
    expect(positionedGlyphs[ellipsisIndex]?.syntheticKind).toBe("ellipsis");
    expect(text.unitMap?.units.some((unit) => unit.members.length === 0)).toBe(true);
    expect(
      text.unitMap?.units.some((unit) =>
        unit.members.some((member) => member.glyphIndex === ellipsisIndex),
      ),
    ).toBe(false);
    expect(text.unitAnimationSamples?.some((sample) => sample.bbox === undefined)).toBe(true);
    expect(text.glyphPaths?.some((path) => path.text === "…" && path.unitId === undefined)).toBe(
      true,
    );
    expect(artifacts.svg).toContain(`aria-label="${content}"`);
    expect(artifacts.svg).toContain("@keyframes");
    expect(artifacts.svg).toContain('stroke="#ef4444"');
    expect(artifacts.svg).toContain('filter="url(#filter-path-units:ts0)"');
    expect(
      engine.hitTest(artifacts.ir, text.bbox.x + text.bbox.w / 2, text.bbox.y + text.bbox.h / 2),
    ).toBe("path-units");
    const renderOptions = { animation: "static" as const, timeMs: 180 };
    expect(engine.renderCompiledToSvg(engine.compile(scene), renderOptions)).toBe(
      engine.renderToSvg(scene, renderOptions),
    );
    expect(engine.renderToPng(scene, renderOptions)).toEqual(
      rasterize(engine.renderToSvg(scene, renderOptions)),
    );
  });

  it("preserves layer-first effects and missing-glyph unit bounds", () => {
    const scene = textOnPathScene({ text: "A🦄", effects: true });
    const warnings: string[] = [];
    const svg = engine.renderToSvg(scene, {
      animation: "declarative",
      timeMs: 180,
      showMissingGlyphs: true,
      onWarning: (warning) => warnings.push(warning.code),
    });
    const firstShadowIndex = svg.indexOf('filter="url(#filter-path-units:ts0)"');
    const secondShadowIndex = svg.indexOf('filter="url(#filter-path-units:ts1)"');
    const firstStrokeIndex = svg.indexOf('stroke="#ef4444"');
    const secondStrokeIndex = svg.indexOf('stroke="#38bdf8"');
    const fillIndex = svg.indexOf('fill="#f8fafc"');
    const text = findText(
      engine.renderToSvgAndIR(scene, {
        animation: "static",
        timeMs: 180,
        showMissingGlyphs: true,
      }).ir.root,
      "path-units",
    );

    expect(warnings).toContain("MISSING_GLYPH");
    expect(firstShadowIndex).toBeGreaterThan(-1);
    expect(secondShadowIndex).toBeGreaterThan(firstShadowIndex);
    expect(firstStrokeIndex).toBeGreaterThan(secondShadowIndex);
    expect(secondStrokeIndex).toBeGreaterThan(firstStrokeIndex);
    expect(fillIndex).toBeGreaterThan(secondStrokeIndex);
    expect(text.glyphPaths?.some((path) => path.missingGlyph === true)).toBe(true);
    const missingUnitIds = new Set(
      text.glyphPaths?.filter((path) => path.missingGlyph).map((path) => path.unitId),
    );
    expect(
      text.unitAnimationSamples?.some(
        (sample) => missingUnitIds.has(sample.unitId) && sample.bbox !== undefined,
      ),
    ).toBe(true);
  });

  it("keeps V2 decoration and fitted-path crossings equal across render routes", () => {
    const scene = textMotionV2Scene();
    const compiled = engine.compile(scene);
    const timesMs = [700, 0, 180, 700, 360];
    const expectedSvg = timesMs.map((timeMs) =>
      engine.renderToSvg(scene, { animation: "static", timeMs }),
    );
    const expectedPng = timesMs.map((timeMs) =>
      engine.renderToPng(scene, { animation: "static", timeMs }),
    );

    expect(
      timesMs.map((timeMs) =>
        engine.renderCompiledToSvg(compiled, { animation: "static", timeMs }),
      ),
    ).toEqual(expectedSvg);
    expect(
      [...engine.renderFrames(scene, { timesMs, format: "svg" })].map((frame) => frame.data),
    ).toEqual(expectedSvg);
    expect(
      [...engine.renderFrames(scene, { timesMs, format: "png" })].map((frame) => frame.data),
    ).toEqual(expectedPng);

    const { ir, svg } = engine.renderToSvgAndIR(scene, {
      animation: "declarative",
      timeMs: 180,
      textPathMode: "glyphs",
    });
    const decorated = findText(ir.root, "v2-decoration");
    const closed = findText(ir.root, "v2-closed-path");
    const ellipsis = findText(ir.root, "v2-ellipsis-path");
    const ellipsisGlyphs = ellipsis.lines[0]?.positionedGlyphs ?? [];
    const ellipsisGlyphIndex = ellipsisGlyphs.length - 1;

    expect(decorated.textDecorations).toEqual([
      expect.objectContaining({ style: "wavy", skipInk: "all" }),
    ]);
    expect(closed.textPath).toMatchObject({
      pathDirection: "reverse",
      pathNormal: "right",
      pathFit: "scale",
    });
    expect(closed.textPath?.d.trimEnd().endsWith("Z")).toBe(true);
    expect(closed.unitAnimationSamples).toHaveLength(closed.unitMap?.units.length);
    expect(ellipsis.displayText).toMatch(/…$/u);
    expect(ellipsisGlyphs[ellipsisGlyphIndex]?.syntheticKind).toBe("ellipsis");
    expect(
      ellipsis.unitMap?.units.some((unit) =>
        unit.members.some((member) => member.glyphIndex === ellipsisGlyphIndex),
      ),
    ).toBe(false);
    expect(svg).toContain("@keyframes");
    expect(svg).not.toContain("<textPath");
  }, 15_000);

  it("keeps rich V3 decoration, fitting, effects, and node animation equal across render routes", () => {
    const scene = textMotionV3IntegrationScene();
    const timesMs = [400, 0, 180, 400, 700];
    const resourceIdPrefix = "v3 h01:path.";

    for (const textPathMode of ["merged", "glyphs"] as const) {
      const compiled = engine.compile(scene, { textPathMode });
      const expectedSvg = timesMs.map((timeMs) =>
        engine.renderToSvg(scene, {
          animation: "static",
          timeMs,
          textPathMode,
          resourceIdPrefix,
        }),
      );
      const expectedPng = timesMs.map((timeMs) =>
        engine.renderToPng(scene, {
          animation: "static",
          timeMs,
          textPathMode,
          resourceIdPrefix,
        }),
      );

      expect(
        timesMs.map((timeMs) =>
          engine.renderCompiledToSvg(compiled, {
            animation: "static",
            timeMs,
            resourceIdPrefix,
          }),
        ),
      ).toEqual(expectedSvg);
      expect(
        timesMs.map((timeMs) =>
          engine.renderCompiledToPng(compiled, {
            animation: "static",
            timeMs,
            resourceIdPrefix,
          }),
        ),
      ).toEqual(expectedPng);
      expect(
        [
          ...engine.renderFrames(scene, {
            timesMs,
            format: "svg",
            textPathMode,
            resourceIdPrefix,
          }),
        ].map((frame) => frame.data),
      ).toEqual(expectedSvg);
      expect(
        [
          ...engine.renderFrames(scene, {
            timesMs,
            format: "png",
            textPathMode,
            resourceIdPrefix,
          }),
        ].map((frame) => frame.data),
      ).toEqual(expectedPng);
    }

    const { ir, svg } = engine.renderToSvgAndIR(scene, {
      animation: "declarative",
      timeMs: 180,
      textPathMode: "glyphs",
      resourceIdPrefix,
    });
    const closed = findText(ir.root, "v3-rich-closed-decoration");
    const ellipsis = findText(ir.root, "v3-rich-effects-ellipsis");
    const closedDecorations = closed.textDecorations ?? [];
    const ellipsisGlyphs = ellipsis.lines[0]?.positionedGlyphs ?? [];
    const ellipsisGlyphIndex = ellipsisGlyphs.length - 1;

    expect(closed.textPath).toMatchObject({
      pathDirection: "reverse",
      pathNormal: "right",
      pathFit: "scale",
    });
    expect(closed.textPath?.d.trimEnd().endsWith("Z")).toBe(true);
    expect(closed.sourceText).toBe("AB曲線Z");
    expect(closedDecorations.map((fragment) => [fragment.sourceStart, fragment.sourceEnd])).toEqual(
      [
        [0, 2],
        [2, 4],
      ],
    );
    expect(closedDecorations.map((fragment) => fragment.style)).toEqual(["dashed", "wavy"]);
    expect(closedDecorations.every((fragment) => fragment.skipInk === "all")).toBe(true);
    expect(closedDecorations.flatMap((fragment) => fragment.paths).length).toBeGreaterThan(2);
    expect(
      closed.lines[0]?.positionedGlyphs?.some(
        (glyph) =>
          glyph.fill === "#fb7185" &&
          glyph.textStrokes?.[0]?.color === "#9f1239" &&
          glyph.textShadows?.[0]?.color === "#4c0519",
      ),
    ).toBe(true);
    expect(ellipsis.sourceText).toBe("rich ellipsis effects source identity 日本語");
    expect(ellipsis.displayText).toMatch(/…$/u);
    expect(ellipsisGlyphs[ellipsisGlyphIndex]?.syntheticKind).toBe("ellipsis");
    expect(ellipsis.textDecorations?.[0]?.style).toBe("double");
    expect(ellipsis.textDecorations?.[0]?.skipInk ?? "none").toBe("none");
    expect(svg).toContain("@keyframes");
    expect(svg).toContain("v3_h01:path.");
    expect(svg).not.toContain("<textPath");
    expect(rasterize(svg)).toEqual(
      engine.renderToPng(scene, {
        animation: "static",
        timeMs: 180,
        textPathMode: "glyphs",
        resourceIdPrefix,
      }),
    );
  }, 30_000);

  it("recovers fresh V2 bytes after path and decoration fatal errors", async () => {
    const healthyScene = textMotionV2Scene();
    const healthyOptions = { animation: "static" as const, timeMs: 180 };
    const healthySvg = engine.renderToSvg(healthyScene, healthyOptions);
    const healthyPng = engine.renderToPng(healthyScene, healthyOptions);

    expect(() =>
      engine.renderToSvg(
        textOnPathScene({
          d: "M0 20L1000000 20",
          startOffsetPx: 0,
          pathFit: "scale",
          pathOverflow: "hidden",
          text: "A".repeat(16_385),
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "TEXT_PATH_CLUSTER_LIMIT" }));

    const invalidDecoration = createElement(
      "Canvas",
      { width: 320, height: 100 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 24,
          textDecoration: {
            line: "underline",
            style: "dotted",
            thicknessPx: 0.000001,
          },
        },
        "budget",
      ),
    );
    expect(() => engine.renderToSvg(invalidDecoration)).toThrow(
      expect.objectContaining({ code: "TEXT_DECORATION_PATTERN_LIMIT" }),
    );
    expect(engine.renderToSvg(healthyScene, healthyOptions)).toBe(healthySvg);
    expect(engine.renderToPng(healthyScene, healthyOptions)).toEqual(healthyPng);

    const freshHandle = await createFontedWasmHandle();
    const freshEngine = createEngineFromHandle(freshHandle, {
      svgToPngFn: freshHandle.createSvgToPngFn(),
    });
    try {
      expect(freshEngine.renderToSvg(healthyScene, healthyOptions)).toBe(healthySvg);
      expect(freshEngine.renderToPng(healthyScene, healthyOptions)).toEqual(healthyPng);
    } finally {
      freshEngine.dispose();
      freshHandle.dispose();
    }
  });
});
