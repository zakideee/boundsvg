import { describe, expect, it } from "vitest";
import { buildHandlerMap } from "../../src/ir/handler-map.js";
import type { IR, IRNode } from "../../src/ir/types.js";

function makeIR(nodes: IRNode[], width = 800, height = 600): IR {
  const drawOrder: string[] = [];
  for (const n of nodes) {
    drawOrder.push(n.nodeId);
  }

  return {
    root: {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: width, h: height },
      children: nodes,
    },
    drawOrder,
    width,
    height,
    warnings: [],
  };
}

describe("buildHandlerMap", () => {
  it("returns empty map when no handlers exist", () => {
    const ir = makeIR([{ type: "rect", nodeId: "box1", bbox: { x: 0, y: 0, w: 100, h: 50 } }]);
    const map = buildHandlerMap(ir);
    expect(map.size).toBe(0);
  });

  it("collects handlers from leaf nodes", () => {
    const ir = makeIR([
      {
        type: "text",
        nodeId: "text1",
        bbox: { x: 0, y: 0, w: 100, h: 20 },
        on: { onClick: "handle-click", onPointerEnter: "handle-enter" },
      },
    ]);
    const map = buildHandlerMap(ir);
    expect(map.size).toBe(1);
    expect(map.get("text1")).toEqual({
      onClick: "handle-click",
      onPointerEnter: "handle-enter",
    });
  });

  it("collects onContextMenu handler", () => {
    const ir = makeIR([
      {
        type: "text",
        nodeId: "text1",
        bbox: { x: 0, y: 0, w: 100, h: 20 },
        on: { onContextMenu: "handle-context" },
      },
    ]);
    const map = buildHandlerMap(ir);
    expect(map.size).toBe(1);
    expect(map.get("text1")).toEqual({
      onContextMenu: "handle-context",
    });
  });

  it("collects from multiple leaf nodes in nested tree", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          {
            type: "group",
            nodeId: "group1",
            bbox: { x: 0, y: 0, w: 400, h: 300 },
            children: [
              {
                type: "text",
                nodeId: "text1",
                bbox: { x: 10, y: 10, w: 100, h: 20 },
                on: { onClick: "click-a" },
              },
              {
                type: "image",
                nodeId: "img1",
                bbox: { x: 120, y: 10, w: 80, h: 80 },
                on: { onClick: "click-b", onPointerMove: "move-b" },
              },
            ],
          },
          {
            type: "path",
            nodeId: "path1",
            bbox: { x: 0, y: 300, w: 100, h: 100 },
            on: { onPointerLeave: "leave-c" },
          },
        ],
      },
      drawOrder: ["text1", "img1", "path1"],
      width: 800,
      height: 600,
      warnings: [],
    };

    const map = buildHandlerMap(ir);
    expect(map.size).toBe(3);
    expect(map.get("text1")).toEqual({ onClick: "click-a" });
    expect(map.get("img1")).toEqual({ onClick: "click-b", onPointerMove: "move-b" });
    expect(map.get("path1")).toEqual({ onPointerLeave: "leave-c" });
  });

  it("ignores group nodes without handlers", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          {
            type: "group",
            nodeId: "group1",
            bbox: { x: 0, y: 0, w: 400, h: 300 },
            children: [
              {
                type: "rect",
                nodeId: "rect1",
                bbox: { x: 0, y: 0, w: 100, h: 50 },
              },
            ],
          },
        ],
      },
      drawOrder: ["rect1"],
      width: 800,
      height: 600,
      warnings: [],
    };

    const map = buildHandlerMap(ir);
    expect(map.size).toBe(0);
  });
});
