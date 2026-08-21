import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import type { LayoutNode } from "../../src/layout/types.js";
import type { SceneNode } from "../../src/scene/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

function propagationScene(driverWidth: number): SceneNode {
  return {
    type: "Canvas",
    width: 640,
    height: 360,
    children: [
      {
        type: "Flex",
        id: "fixture-root",
        direction: "column",
        width: 600,
        height: 320,
        margin: 20,
        padding: 20,
        gap: 20,
        children: [
          {
            type: "Flex",
            id: "flex-row",
            direction: "row",
            width: 560,
            height: 60,
            gap: 10,
            children: [
              {
                type: "Box",
                id: "flex-driver",
                width: driverWidth,
                height: 60,
                children: [],
              },
              {
                type: "Flex",
                id: "flex-sibling",
                flexGrow: 1,
                height: 60,
                children: [],
              },
            ],
          },
          {
            type: "Grid",
            id: "intrinsic-grid",
            width: 560,
            height: 60,
            templateColumns: "auto 1fr",
            templateRows: "60px",
            columnGap: 10,
            children: [
              {
                type: "Box",
                id: "grid-driver",
                width: driverWidth,
                height: 60,
                children: [],
              },
              {
                type: "Box",
                id: "grid-sibling",
                height: 60,
                children: [],
              },
            ],
          },
          {
            type: "Flex",
            id: "shrinkwrap-row",
            direction: "row",
            alignItems: "start",
            width: 560,
            height: 60,
            gap: 10,
            children: [
              {
                type: "Flex",
                id: "shrinkwrap-ancestor",
                direction: "column",
                alignSelf: "start",
                children: [
                  {
                    type: "Box",
                    id: "intrinsic-driver",
                    width: driverWidth,
                    height: 60,
                    children: [],
                  },
                ],
              },
              {
                type: "Box",
                id: "downstream-sibling",
                width: 50,
                height: 60,
                children: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

function justificationScene(justifyContent: "start" | "space-between"): SceneNode {
  return {
    type: "Canvas",
    width: 360,
    height: 100,
    children: [
      {
        type: "Flex",
        id: "justification-row",
        direction: "row",
        justifyContent,
        width: 320,
        height: 60,
        margin: 20,
        children: [
          { type: "Box", id: "justification-first", width: 40, height: 60, children: [] },
          { type: "Box", id: "justification-last", width: 40, height: 60, children: [] },
        ],
      },
    ],
  };
}

function findLayoutNode(root: LayoutNode, nodeId: string): LayoutNode {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node?.nodeId === nodeId) {
      return node;
    }
    if (node) {
      pending.push(...node.children);
    }
  }
  throw new RangeError(`Missing layout node ${nodeId}`);
}

describe("layout-reactive full-scene propagation", () => {
  let handle: WasmEngineHandle;
  let engine: Engine;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
    engine = createEngineFromHandle(handle);
  });

  afterAll(() => {
    engine.dispose();
    handle.dispose();
  });

  it("propagates a materialized intrinsic width through flex, grid, siblings, and shrinkwrap", () => {
    const narrow = engine.renderToLayoutTree(propagationScene(80)).root;
    const wide = engine.renderToLayoutTree(propagationScene(180)).root;

    const narrowFlexSibling = findLayoutNode(narrow, "flex-sibling").bbox;
    const wideFlexSibling = findLayoutNode(wide, "flex-sibling").bbox;
    expect(wideFlexSibling.x - narrowFlexSibling.x).toBeCloseTo(100, 6);
    expect(narrowFlexSibling.width - wideFlexSibling.width).toBeCloseTo(100, 6);

    const narrowGridSibling = findLayoutNode(narrow, "grid-sibling").bbox;
    const wideGridSibling = findLayoutNode(wide, "grid-sibling").bbox;
    expect(wideGridSibling.x - narrowGridSibling.x).toBeCloseTo(100, 6);
    expect(narrowGridSibling.width - wideGridSibling.width).toBeCloseTo(100, 6);

    const narrowAncestor = findLayoutNode(narrow, "shrinkwrap-ancestor").bbox;
    const wideAncestor = findLayoutNode(wide, "shrinkwrap-ancestor").bbox;
    expect(narrowAncestor.width).toBeCloseTo(80, 6);
    expect(wideAncestor.width).toBeCloseTo(180, 6);

    const narrowDownstream = findLayoutNode(narrow, "downstream-sibling").bbox;
    const wideDownstream = findLayoutNode(wide, "downstream-sibling").bbox;
    expect(wideDownstream.x - narrowDownstream.x).toBeCloseTo(100, 6);

    expect(narrow.bbox).toEqual(wide.bbox);
  });

  it("recomputes materialized layout justification through the normal full-scene path", () => {
    const start = engine.renderToLayoutTree(justificationScene("start")).root;
    const distributed = engine.renderToLayoutTree(justificationScene("space-between")).root;
    const startFirst = findLayoutNode(start, "justification-first").bbox;
    const startLast = findLayoutNode(start, "justification-last").bbox;
    const distributedFirst = findLayoutNode(distributed, "justification-first").bbox;
    const distributedLast = findLayoutNode(distributed, "justification-last").bbox;

    expect(startFirst).toEqual(distributedFirst);
    expect(startLast.x - startFirst.x).toBeCloseTo(40, 6);
    expect(distributedLast.x - distributedFirst.x).toBeCloseTo(280, 6);
    expect(start.bbox).toEqual(distributed.bbox);
  });
});
