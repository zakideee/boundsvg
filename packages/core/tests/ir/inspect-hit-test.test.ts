import { describe, expect, it } from "vitest";
import {
  buildInspectHitTestIndex,
  inspectHitTestCandidates,
} from "../../src/ir/inspect-hit-test.js";
import type { IR } from "../../src/ir/types.js";

describe("inspectHitTestCandidates", () => {
  it("prefers child leaf over parent containers", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 300, h: 200 },
        children: [
          {
            type: "group",
            nodeId: "panel",
            bbox: { x: 20, y: 20, w: 200, h: 120 },
            children: [
              {
                type: "text",
                nodeId: "title",
                bbox: { x: 40, y: 40, w: 80, h: 24 },
                lines: [],
              },
            ],
          },
        ],
      },
      drawOrder: ["title"],
      width: 300,
      height: 200,
      warnings: [],
    };

    const index = buildInspectHitTestIndex(ir);
    expect(inspectHitTestCandidates(index, 50, 50)).toEqual(["title", "panel", "root"]);
  });

  it("falls back to the innermost container on container whitespace", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 300, h: 200 },
        children: [
          {
            type: "group",
            nodeId: "panel",
            bbox: { x: 20, y: 20, w: 200, h: 120 },
            children: [
              {
                type: "image",
                nodeId: "thumb",
                bbox: { x: 40, y: 40, w: 60, h: 60 },
                src: "data:image/png;base64,AAAA",
              },
            ],
          },
        ],
      },
      drawOrder: ["thumb"],
      width: 300,
      height: 200,
      warnings: [],
    };

    const index = buildInspectHitTestIndex(ir);
    expect(inspectHitTestCandidates(index, 180, 100)).toEqual(["panel", "root"]);
  });

  it("falls back to root when no child or container is hit", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 300, h: 200 },
        children: [
          {
            type: "group",
            nodeId: "panel",
            bbox: { x: 20, y: 20, w: 100, h: 60 },
            children: [],
          },
        ],
      },
      drawOrder: [],
      width: 300,
      height: 200,
      warnings: [],
    };

    const index = buildInspectHitTestIndex(ir);
    expect(inspectHitTestCandidates(index, 260, 180)).toEqual(["root"]);
  });

  it("skips internal background and border nodes", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 300, h: 200 },
        children: [
          {
            type: "group",
            nodeId: "panel",
            bbox: { x: 20, y: 20, w: 200, h: 120 },
            children: [
              {
                type: "rect",
                nodeId: "panel:bg",
                bbox: { x: 20, y: 20, w: 200, h: 120 },
                fill: "#fff",
              },
              {
                type: "rect",
                nodeId: "panel:border",
                bbox: { x: 20, y: 20, w: 200, h: 120 },
                stroke: "#000",
              },
            ],
          },
        ],
      },
      drawOrder: ["panel:bg", "panel:border"],
      width: 300,
      height: 200,
      warnings: [],
    };

    const index = buildInspectHitTestIndex(ir);
    expect(inspectHitTestCandidates(index, 40, 40)).toEqual(["panel", "root"]);
  });
});
