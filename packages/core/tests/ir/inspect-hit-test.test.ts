import { describe, expect, it } from "vitest";
import { buildInspectHitTestIndex } from "../../src/ir/inspect-hit-test.js";
import type { IR } from "../../src/ir/types.js";

describe("inspection candidate queries", () => {
  it("prefers child leaf over parent containers", () => {
    const ir: IR = {
      root: {
        ownership: { role: "source" },
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 300, h: 200 },
        children: [
          {
            ownership: { role: "source" },
            type: "group",
            nodeId: "panel",
            bbox: { x: 20, y: 20, w: 200, h: 120 },
            children: [
              {
                ownership: { role: "source" },
                type: "text",
                nodeId: "title",
                bbox: { x: 40, y: 40, w: 80, h: 24 },
                lines: [],
              },
            ],
          },
        ],
      },

      width: 300,
      height: 200,
      warnings: [],
    };

    const index = buildInspectHitTestIndex(ir);
    expect(index.queryCandidates(50, 50).map((candidate) => candidate.source.nodeId)).toEqual([
      "title",
      "panel",
      "root",
    ]);
  });

  it("falls back to the innermost container on container whitespace", () => {
    const ir: IR = {
      root: {
        ownership: { role: "source" },
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 300, h: 200 },
        children: [
          {
            ownership: { role: "source" },
            type: "group",
            nodeId: "panel",
            bbox: { x: 20, y: 20, w: 200, h: 120 },
            children: [
              {
                ownership: { role: "source" },
                type: "image",
                nodeId: "thumb",
                bbox: { x: 40, y: 40, w: 60, h: 60 },
                src: "data:image/png;base64,AAAA",
              },
            ],
          },
        ],
      },

      width: 300,
      height: 200,
      warnings: [],
    };

    const index = buildInspectHitTestIndex(ir);
    expect(index.queryCandidates(180, 100).map((candidate) => candidate.source.nodeId)).toEqual([
      "panel",
      "root",
    ]);
  });

  it("falls back to root when no child or container is hit", () => {
    const ir: IR = {
      root: {
        ownership: { role: "source" },
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 300, h: 200 },
        children: [
          {
            ownership: { role: "source" },
            type: "group",
            nodeId: "panel",
            bbox: { x: 20, y: 20, w: 100, h: 60 },
            children: [],
          },
        ],
      },

      width: 300,
      height: 200,
      warnings: [],
    };

    const index = buildInspectHitTestIndex(ir);
    expect(index.queryCandidates(260, 180).map((candidate) => candidate.source.nodeId)).toEqual([
      "root",
    ]);
  });

  it("skips internal background and border nodes", () => {
    const ir: IR = {
      root: {
        ownership: { role: "source" },
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 300, h: 200 },
        children: [
          {
            ownership: { role: "source" },
            type: "group",
            nodeId: "panel",
            bbox: { x: 20, y: 20, w: 200, h: 120 },
            children: [
              {
                ownership: { role: "decoration", ownerNodeId: "panel" },
                type: "rect",
                nodeId: "panel:bg",
                bbox: { x: 20, y: 20, w: 200, h: 120 },
                fill: "#fff",
              },
              {
                ownership: { role: "decoration", ownerNodeId: "panel" },
                type: "rect",
                nodeId: "panel:border",
                bbox: { x: 20, y: 20, w: 200, h: 120 },
                stroke: "#000",
              },
            ],
          },
        ],
      },

      width: 300,
      height: 200,
      warnings: [],
    };

    const index = buildInspectHitTestIndex(ir);
    expect(index.queryCandidates(40, 40).map((candidate) => candidate.source.nodeId)).toEqual([
      "panel",
      "root",
    ]);
  });
});
