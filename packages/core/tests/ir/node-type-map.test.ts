import { describe, expect, it } from "vitest";
import { buildNodeTypeMap } from "../../src/ir/node-type-map.js";
import type { IR } from "../../src/ir/types.js";

describe("buildNodeTypeMap", () => {
  it("returns empty map for IR with only group nodes", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
      },
      drawOrder: [],
      width: 800,
      height: 600,
      warnings: [],
    };
    const map = buildNodeTypeMap(ir);
    expect(map.size).toBe(0);
  });

  it("maps leaf nodes to their types", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          { type: "rect", nodeId: "rect1", bbox: { x: 0, y: 0, w: 100, h: 50 } },
          { type: "text", nodeId: "text1", bbox: { x: 0, y: 50, w: 100, h: 20 } },
          { type: "image", nodeId: "img1", bbox: { x: 0, y: 70, w: 100, h: 80 } },
          { type: "path", nodeId: "path1", bbox: { x: 0, y: 150, w: 100, h: 100 } },
        ],
      },
      drawOrder: ["rect1", "text1", "img1", "path1"],
      width: 800,
      height: 600,
      warnings: [],
    };
    const map = buildNodeTypeMap(ir);
    expect(map.size).toBe(4);
    expect(map.get("rect1")).toBe("rect");
    expect(map.get("text1")).toBe("text");
    expect(map.get("img1")).toBe("image");
    expect(map.get("path1")).toBe("path");
  });

  it("excludes group nodes", () => {
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
            children: [{ type: "text", nodeId: "text1", bbox: { x: 10, y: 10, w: 100, h: 20 } }],
          },
        ],
      },
      drawOrder: ["text1"],
      width: 800,
      height: 600,
      warnings: [],
    };
    const map = buildNodeTypeMap(ir);
    expect(map.has("root")).toBe(false);
    expect(map.has("group1")).toBe(false);
    expect(map.get("text1")).toBe("text");
  });

  it("handles deeply nested trees", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          {
            type: "group",
            nodeId: "g1",
            bbox: { x: 0, y: 0, w: 400, h: 300 },
            children: [
              {
                type: "group",
                nodeId: "g2",
                bbox: { x: 0, y: 0, w: 200, h: 150 },
                children: [
                  { type: "path", nodeId: "deep-path", bbox: { x: 10, y: 10, w: 50, h: 50 } },
                ],
              },
            ],
          },
        ],
      },
      drawOrder: ["deep-path"],
      width: 800,
      height: 600,
      warnings: [],
    };
    const map = buildNodeTypeMap(ir);
    expect(map.size).toBe(1);
    expect(map.get("deep-path")).toBe("path");
  });
});
