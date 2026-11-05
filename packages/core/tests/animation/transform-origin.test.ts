import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { inspectScene } from "../../src/inspect.js";
import { hitTest } from "../../src/ir/hit-test.js";
import type { IRGroupNode, IRNode } from "../../src/ir/types.js";
import type { LayoutNode } from "../../src/layout/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { AnimationSpec, BoxProps, TextProps } from "../../src/vnode/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

function findSourceGroup(root: IRNode, nodeId: string): IRGroupNode | undefined {
  if (root.type === "group" && root.nodeId === nodeId && root.ownership.role === "source") {
    return root;
  }
  for (const child of root.children ?? []) {
    const found = findSourceGroup(child, nodeId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function sourceGroup(root: IRNode, nodeId: string): IRGroupNode {
  const found = findSourceGroup(root, nodeId);
  if (found) {
    return found;
  }
  throw new Error(`Missing source group ${nodeId}`);
}

function layoutFacts(root: LayoutNode) {
  const facts = [];
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node) {
      facts.push({ nodeId: node.nodeId, bbox: node.bbox, textLayout: node.textLayout });
      pending.push(...node.children);
    }
  }
  return facts;
}

function boxScene(props: Partial<BoxProps> = {}) {
  return createElement(
    "Canvas",
    { width: 300, height: 300 },
    createElement("Box", {
      id: "box",
      position: "absolute",
      left: 20,
      top: 30,
      width: 80,
      height: 40,
      background: "#e04030",
      onClick: "select",
      ...props,
    }),
  );
}

describe("layout-resolved static transform origins", () => {
  let engine: Engine;
  let handle: WasmEngineHandle;
  beforeAll(async () => {
    handle = await createFontedWasmHandle();
    engine = createEngineFromHandle(handle, { svgToPngFn: handle.createSvgToPngFn() });
  });
  afterAll(() => {
    engine?.dispose();
    handle?.dispose();
  });

  it.each([
    ["short", "horizontal-tb"],
    ["longer text\nsecond line", "horizontal-tb"],
    ["縦書き", "vertical-rl"],
  ] as const)("uses the completed outer Text box for %s / %s", (content, writingMode) => {
    const textScene = (props: Partial<TextProps>) =>
      createElement(
        "Canvas",
        { width: 600, height: 400 },
        createElement(
          "Text",
          {
            id: "text",
            position: "absolute",
            left: 70,
            top: 80,
            font: "NotoSansJP",
            fontSizePx: 24,
            padding: [7, 21, 13, 5],
            writingMode,
            whiteSpace: "pre-wrap",
            ...props,
          },
          content,
        ),
      );
    const base = inspectScene(engine, textScene({}));
    const transformed = inspectScene(
      engine,
      textScene({
        transformOrigin: "center",
        transform: { rotateDeg: 90, scaleX: 2, scaleY: 0.5 },
      }),
    );
    expect(layoutFacts(transformed.layout.root)).toEqual(layoutFacts(base.layout.root));
    expect(transformed.stats.measureCallCount).toBe(base.stats.measureCallCount);
    const group = sourceGroup(transformed.ir.root, "text");
    expect(group.transform).toMatchObject({ originX: group.bbox.w / 2, originY: group.bbox.h / 2 });
    const inspection = transformed.bboxes.find(
      (entry) => entry.nodeId === "text" && entry.ownership.role === "source",
    );
    expect(inspection?.origin?.x).toBeCloseTo(group.bbox.x + group.bbox.w / 2, 6);
    expect(inspection?.origin?.y).toBeCloseTo(group.bbox.y + group.bbox.h / 2, 6);
    const animated = textScene({
      animate: {
        durationMs: 100,
        fill: "both",
        easing: "linear",
        keyframes: [
          { at: 0, transform: { rotateDeg: 90, scaleX: 2, scaleY: 0.5 } },
          { at: 1, transform: { rotateDeg: 90, scaleX: 2, scaleY: 0.5 } },
        ],
      },
    });
    const staticPng = engine.renderToPng(
      textScene({
        transformOrigin: "center",
        transform: { rotateDeg: 90, scaleX: 2, scaleY: 0.5 },
      }),
    );
    for (const timeMs of [0, 50, 100]) {
      expect(engine.renderToPng(animated, { timeMs })).toEqual(staticPng);
    }
  });

  it("matches the hand-calculated corners and inspection/hit testing", () => {
    const scene = boxScene({
      padding: [3, 7, 5, 1],
      borderWidth: 2,
      borderColor: "#000",
      transformOrigin: "center",
      transform: { rotateDeg: 90 },
    });
    const inspection = inspectScene(engine, scene);
    const box = inspection.bboxes.find(
      (entry) => entry.nodeId === "box" && entry.ownership.role === "source",
    );
    expect(box?.origin?.x).toBeCloseTo(60, 6);
    expect(box?.origin?.y).toBeCloseTo(50, 6);
    for (const [index, expected] of [
      { x: 80, y: 10 },
      { x: 80, y: 90 },
      { x: 40, y: 90 },
      { x: 40, y: 10 },
    ].entries()) {
      expect(box?.transformBox.points[index]?.x).toBeCloseTo(expected.x, 6);
      expect(box?.transformBox.points[index]?.y).toBeCloseTo(expected.y, 6);
    }
    expect(hitTest(inspection.ir, 60, 50)?.nodeId).toBe("box");
    expect(engine.renderToSvg(scene)).toContain("rotate(90 60 50)");
  });

  it("composes the child's local pivot before the parent's rotation and translation", () => {
    const scene = createElement(
      "Canvas",
      { width: 300, height: 300 },
      createElement(
        "Box",
        {
          id: "parent",
          width: 160,
          height: 160,
          transformOrigin: "top left",
          transform: { rotateDeg: 90, translateX: 100 },
        },
        createElement("Box", {
          id: "child",
          onClick: "select",
          position: "absolute",
          left: 20,
          top: 30,
          width: 80,
          height: 40,
          background: "#e04030",
          transformOrigin: "center",
          transform: { rotateDeg: 90 },
        }),
      ),
    );
    const inspection = inspectScene(engine, scene);
    const child = inspection.bboxes.find(
      (entry) => entry.nodeId === "child" && entry.ownership.role === "source",
    );
    expect(child?.transformBox.points[0]?.x).toBeCloseTo(90, 6);
    expect(child?.transformBox.points[0]?.y).toBeCloseTo(80, 6);
    expect(hitTest(inspection.ir, 50, 60)?.nodeId).toBe("child");
  });

  it("preserves missing/default pixel output and does not paint an origin-only transform", () => {
    expect(engine.renderToSvg(boxScene({ transformOrigin: "center" }))).toBe(
      engine.renderToSvg(boxScene()),
    );
    expect(engine.renderToIR(boxScene({ transform: { rotateDeg: 90, originX: 8 } })).root).toEqual(
      engine.renderToIR(
        boxScene({ transform: { rotateDeg: 90, originX: 8 }, transformOrigin: undefined }),
      ).root,
    );
    const centered = boxScene({
      transform: { rotateDeg: 90 },
      transformOrigin: { x: 0.5, y: 0.5 },
    });
    expect(engine.renderToPng(centered)).toEqual(
      engine.renderToPng(boxScene({ transform: { rotateDeg: 90, originX: 40, originY: 20 } })),
    );
  });

  it("keeps opacity-only animation on the resolved static origin", () => {
    const scene = boxScene({
      transformOrigin: "bottom right",
      transform: { rotateDeg: 90 },
      animate: {
        durationMs: 100,
        fill: "both",
        keyframes: [
          { at: 0, opacity: 0.2 },
          { at: 1, opacity: 1 },
        ],
      },
    });
    expect(sourceGroup(engine.renderToIR(scene, { timeMs: 50 }).root, "box").transform).toEqual({
      rotateDeg: 90,
      originX: 80,
      originY: 40,
    });
  });

  it("preserves ink-centered unit animation inside the outer static transform", () => {
    const textScene = (props: Partial<TextProps>) =>
      createElement(
        "Canvas",
        { width: 300, height: 200 },
        createElement(
          "Text",
          {
            id: "units",
            font: "NotoSansJP",
            fontSizePx: 36,
            padding: [7, 21, 13, 5],
            ...props,
            animateUnits: {
              by: "cluster",
              delayStepMs: 20,
              animation: {
                durationMs: 100,
                fill: "both",
                keyframes: [
                  { at: 0, transform: { rotateDeg: 0 } },
                  { at: 1, transform: { rotateDeg: 35 } },
                ],
              },
            },
          },
          "AB",
        ),
      );
    const bbox = sourceGroup(engine.renderToIR(textScene({})).root, "units").bbox;
    const relative = textScene({ transformOrigin: "center", transform: { rotateDeg: 20 } });
    const pixels = textScene({
      transform: { rotateDeg: 20, originX: bbox.w / 2, originY: bbox.h / 2 },
    });
    for (const timeMs of [0, 50, 120]) {
      expect(engine.renderToIR(relative, { timeMs }).root).toEqual(
        engine.renderToIR(pixels, { timeMs }).root,
      );
      expect(engine.renderToPng(relative, { timeMs })).toEqual(
        engine.renderToPng(pixels, { timeMs }),
      );
    }
  });

  it("replaces static transforms at the animation center and returns outside fill", () => {
    const animate: AnimationSpec = {
      durationMs: 100,
      delayMs: 100,
      fill: "none",
      easing: "linear",
      keyframes: [
        { at: 0, transform: { rotateDeg: 90 } },
        { at: 1, transform: { rotateDeg: 90 } },
      ],
    };
    const scene = boxScene({
      transformOrigin: "top left",
      transform: { rotateDeg: -30, translateX: 10 },
      animate,
    });
    const staticTransform = { rotateDeg: -30, translateX: 10, originX: 0, originY: 0 };
    expect(sourceGroup(engine.renderToIR(scene, { timeMs: 0 }).root, "box").transform).toEqual(
      staticTransform,
    );
    expect(sourceGroup(engine.renderToIR(scene, { timeMs: 250 }).root, "box").transform).toEqual(
      staticTransform,
    );
    expect(engine.renderToPng(scene, { timeMs: 150 })).toEqual(
      engine.renderToPng(boxScene({ transformOrigin: "center", transform: { rotateDeg: 90 } })),
    );
    const timeline = engine.renderToAnimatedSvg(scene, { playback: { mode: "independent" } });
    expect(timeline).toContain("@keyframes");
  });

  it("matches layout-resolved pixel origins on the document timeline", () => {
    const bbox = sourceGroup(engine.renderToIR(boxScene()).root, "box").bbox;
    const animate: AnimationSpec = {
      durationMs: 100,
      delayMs: 100,
      fill: "none",
      easing: "linear",
      keyframes: [
        { at: 0, transform: { rotateDeg: 90 } },
        { at: 1, transform: { rotateDeg: 90 } },
      ],
    };
    const relative = boxScene({
      transformOrigin: { x: 0.3, y: 0.7 },
      transform: { rotateDeg: -30, translateX: 10 },
      animate,
    });
    const pixels = boxScene({
      transform: { rotateDeg: -30, translateX: 10, originX: bbox.w * 0.3, originY: bbox.h * 0.7 },
      animate,
    });
    for (const timeMs of [0, 50, 99, 100, 150, 199, 200, 201, 250, 300]) {
      const playback = { mode: "timeline", durationMs: 300, iterations: 1 } as const;
      expect(engine.renderToAnimatedSvg(relative, { playback, timeMs })).toBe(
        engine.renderToAnimatedSvg(pixels, { playback, timeMs }),
      );
    }
  });
});
