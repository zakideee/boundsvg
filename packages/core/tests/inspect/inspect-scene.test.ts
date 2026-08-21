import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectInspectionBBoxes, inspectScene } from "../../src/inspect.js";
import { Box, Canvas, Path, Text } from "../../src/vnode/components.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

describe("inspectScene", () => {
  it("collects layout, IR maps, node ids, bboxes, warnings, and stats", () => {
    const engine = createEngineFromHandle(handle);
    const vnode = Canvas(
      { width: 200, height: 100 },
      Text({ id: "title", font: "NotoSansJP", fontSizePx: 20, onClick: "click:title" }, "Hello"),
    );

    const inspection = inspectScene(engine, vnode);

    expect(inspection.layout.root.nodeId).toBe("auto:0");
    expect(inspection.ir.width).toBe(200);
    expect(inspection.textMap.nodes.get("title")?.text).toBe("Hello");
    expect(inspection.handlerMap.get("title")?.onClick).toBe("click:title");
    expect(inspection.nodeTypeMap.get("title")).toBe("text");
    expect(inspection.nodeIds.valid).toBe(true);
    expect(inspection.bboxes.some((bbox) => bbox.nodeId === "title")).toBe(true);
    expect(inspection.bboxes.find((bbox) => bbox.nodeId === "title")?.drawIndex).toBe(
      inspection.ir.drawOrder.indexOf("title"),
    );
    expect(inspection.bboxes.find((bbox) => bbox.nodeId === "auto:0")?.drawIndex).toBeNull();
    // Real text metrics vary with the font; assert the layout box is present
    // and non-degenerate instead of pinning mock-derived numbers.
    const titleLayoutBBox = inspection.bboxes.find((bbox) => bbox.nodeId === "title")?.layoutBBox;
    expect(titleLayoutBBox).toBeDefined();
    expect(titleLayoutBBox?.w).toBeGreaterThan(0);
    expect(titleLayoutBBox?.h).toBeGreaterThan(0);
    expect(inspection.stats.textNodeCount).toBe(1);
    expect(inspection.stats.handlerNodeCount).toBe(1);
    expect(inspection.stats.measureCallCount).toBeGreaterThan(0);
  });

  it("collects layout, transform, visual, and origin geometry", () => {
    const engine = createEngineFromHandle(handle);
    const vnode = Canvas(
      { width: 200, height: 200 },
      Box(
        {
          id: "parent",
          width: 100,
          height: 60,
          transform: {
            translateX: 10,
            translateY: 5,
            rotateDeg: 90,
            originX: 0,
            originY: 0,
          },
        },
        Box({ id: "child", width: 40, height: 20, background: "#111827" }),
      ),
      Box({
        id: "mirror",
        width: 40,
        height: 10,
        transform: { scaleX: -1, originX: 20, originY: 0 },
      }),
    );

    const bboxes = collectInspectionBBoxes(engine.renderToIR(vnode));
    const parent = bboxes.find((bbox) => bbox.nodeId === "parent");
    const child = bboxes.find((bbox) => bbox.nodeId === "child");
    const mirror = bboxes.find((bbox) => bbox.nodeId === "mirror");

    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(mirror).toBeDefined();

    expect(parent?.transformBox.points[0]?.x).toBeCloseTo(10);
    expect(parent?.transformBox.points[0]?.y).toBeCloseTo(5);
    expect(parent?.transformBox.points[1]?.x).toBeCloseTo(10);
    expect(parent?.transformBox.points[1]?.y).toBeCloseTo(105);
    expect(parent?.transformBox.points[2]?.x).toBeCloseTo(-50);
    expect(parent?.transformBox.points[2]?.y).toBeCloseTo(105);
    expect(parent?.transformBox.points[3]?.x).toBeCloseTo(-50);
    expect(parent?.transformBox.points[3]?.y).toBeCloseTo(5);
    expect(parent?.visualBBox.x).toBeCloseTo(-50);
    expect(parent?.visualBBox.y).toBeCloseTo(5);
    expect(parent?.visualBBox.w).toBeCloseTo(60);
    expect(parent?.visualBBox.h).toBeCloseTo(100);
    expect(parent?.origin).toEqual({ x: 10, y: 5 });
    expect(parent?.hasOwnTransform).toBe(true);

    expect(child?.origin).toBeNull();
    expect(child?.hasOwnTransform).toBe(false);
    expect(child?.visualBBox.x).toBeCloseTo(-10);
    expect(child?.visualBBox.y).toBeCloseTo(5);
    expect(child?.visualBBox.w).toBeCloseTo(20);
    expect(child?.visualBBox.h).toBeCloseTo(40);

    expect(mirror?.x).toBe(0);
    expect(mirror?.y).toBe(60);
    expect(mirror?.layoutBBox).toEqual({ x: 0, y: 60, w: 40, h: 10 });
    expect(mirror?.visualBBox).toEqual({ x: 0, y: 60, w: 40, h: 10 });
    expect(mirror?.origin).toEqual({ x: 20, y: 60 });
    expect(mirror?.transformBox.points[0]).toEqual({ x: 40, y: 60 });
    expect(mirror?.transformBox.points[1]).toEqual({ x: 0, y: 60 });
    expect(mirror?.transformBox.points[2]).toEqual({ x: 0, y: 70 });
    expect(mirror?.transformBox.points[3]).toEqual({ x: 40, y: 70 });
  });

  it("keeps visualBBox independent of canvas-stable Box and Path emission", () => {
    const engine = createEngineFromHandle(handle);
    const createScene = (strokeScaling?: "transform" | "canvas") =>
      Canvas({ width: 100, height: 100 }, [
        Box({
          id: "bordered",
          width: 40,
          height: 20,
          border: { width: 2, color: "#111827" },
          strokeScaling,
          transform: { scaleX: 1.6, scaleY: 1.6 },
        }),
        Path({
          id: "stroked-path",
          d: "M1 1H39V19H1Z",
          width: 40,
          height: 20,
          fill: "none",
          stroke: "#111827",
          strokeWidth: 2,
          strokeScaling,
          transform: { scaleX: 1.6, scaleY: 1.6 },
        }),
      ]);

    const transformed = inspectScene(engine, createScene("transform"));
    const canvasStable = inspectScene(engine, createScene("canvas"));
    const findVisualBBoxes = (inspection: typeof transformed) =>
      ["bordered", "stroked-path"].map(
        (nodeId) => inspection.bboxes.find((bbox) => bbox.nodeId === nodeId)?.visualBBox,
      );

    expect(findVisualBBoxes(canvasStable)).toEqual(findVisualBBoxes(transformed));
  });

  it("samples and composes nested animated transforms at timeMs", () => {
    const engine = createEngineFromHandle(handle);
    const vnode = Canvas(
      { width: 200, height: 100 },
      Box(
        {
          id: "moving-parent",
          width: 100,
          height: 50,
          animate: {
            keyframes: [
              { at: 0, transform: { translateX: 0 } },
              { at: 1, transform: { translateX: 20 } },
            ],
            durationMs: 1_000,
            easing: "linear",
            fill: "both",
          },
        },
        Box({
          id: "moving-child",
          width: 40,
          height: 20,
          background: "#111827",
          animate: {
            keyframes: [
              { at: 0, transform: { translateX: 0 } },
              { at: 1, transform: { translateX: 30 } },
            ],
            durationMs: 1_000,
            easing: "linear",
            fill: "both",
          },
        }),
      ),
    );

    const atStart = inspectScene(engine, vnode, { timeMs: 0 });
    const atMiddle = inspectScene(engine, vnode, { timeMs: 500 });
    const atEnd = inspectScene(engine, vnode, { timeMs: 1_000 });
    const visualX = (inspection: typeof atStart, nodeId: string) =>
      inspection.bboxes.find((bbox) => bbox.nodeId === nodeId)?.visualBBox.x;

    expect(visualX(atMiddle, "moving-parent")).toBeCloseTo(
      (visualX(atStart, "moving-parent") ?? Number.NaN) + 10,
    );
    expect(visualX(atEnd, "moving-parent")).toBeCloseTo(
      (visualX(atStart, "moving-parent") ?? Number.NaN) + 20,
    );
    expect(visualX(atMiddle, "moving-child")).toBeCloseTo(
      (visualX(atStart, "moving-child") ?? Number.NaN) + 25,
    );
    expect(visualX(atEnd, "moving-child")).toBeCloseTo(
      (visualX(atStart, "moving-child") ?? Number.NaN) + 50,
    );
  });
});
