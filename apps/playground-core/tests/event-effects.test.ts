import { collectInspectionBBoxes } from "@boundsvg/core/inspect";
import type { IR } from "@boundsvg/core/scene";
import { describe, expect, it } from "vitest";
import {
  buildNodeBBoxMap,
  isTransformBoxAxisAligned,
  resolveInspectOverlayParts,
} from "../../playground-shared/event-effects.js";

describe("buildNodeBBoxMap", () => {
  it("preserves transformed wrapper geometry when a leaf shares its node id", () => {
    const ir: IR = {
      width: 100,
      height: 80,
      drawOrder: ["transformed"],
      warnings: [],
      root: {
        type: "group",
        nodeId: "auto:0",
        bbox: { x: 0, y: 0, w: 100, h: 80 },
        children: [
          {
            type: "group",
            nodeId: "transformed",
            bbox: { x: 10, y: 20, w: 40, h: 24 },
            transform: { translateX: 5, translateY: 7, originX: 20, originY: 12 },
            children: [
              {
                type: "rect",
                nodeId: "transformed",
                bbox: { x: 10, y: 20, w: 40, h: 24 },
                borderRadius: 6,
                fill: "#0f172a",
              },
            ],
          },
        ],
      },
    };

    const matchingEntries = collectInspectionBBoxes(ir).filter(
      (bbox) => bbox.nodeId === "transformed",
    );
    expect(matchingEntries.map((bbox) => bbox.type)).toEqual(["group", "rect"]);
    expect(matchingEntries[0]?.hasOwnTransform).toBe(true);
    expect(matchingEntries[1]?.hasOwnTransform).toBe(false);

    const merged = buildNodeBBoxMap(ir).get("transformed");
    expect(merged?.hasOwnTransform).toBe(true);
    expect(merged?.origin).toEqual(matchingEntries[0]?.origin);
    expect(merged?.transformBox).toEqual(matchingEntries[0]?.transformBox);
    expect(merged?.visualBBox).toEqual(matchingEntries[0]?.visualBBox);
    expect(merged?.rx).toBe(6);
    expect(merged?.semantics?.kind).toBe("Box");
  });
});

describe("resolveInspectOverlayParts", () => {
  it("returns all overlay parts for all mode with origin", () => {
    expect(
      resolveInspectOverlayParts({
        mode: "all",
        showOrigin: true,
        hasOrigin: true,
      }),
    ).toEqual(["layout", "transform", "handles", "visual", "origin"]);
  });

  it("returns no parts for off mode", () => {
    expect(
      resolveInspectOverlayParts({
        mode: "off",
        showOrigin: true,
        hasOrigin: true,
      }),
    ).toEqual([]);
  });

  it("omits origin when the node has no own transform origin", () => {
    expect(
      resolveInspectOverlayParts({
        mode: "transform",
        showOrigin: true,
        hasOrigin: false,
      }),
    ).toEqual(["transform", "handles"]);
  });

  it("draws only layout in all mode when the node has no own transform", () => {
    expect(
      resolveInspectOverlayParts({
        mode: "all",
        showOrigin: true,
        hasOrigin: false,
        hasOwnTransform: false,
      }),
    ).toEqual(["layout"]);
  });

  it("suppresses visual corners in all mode when the transform box is axis-aligned", () => {
    expect(
      resolveInspectOverlayParts({
        mode: "all",
        showOrigin: false,
        hasOrigin: true,
        hasOwnTransform: true,
        isTransformAxisAligned: true,
      }),
    ).toEqual(["layout", "transform", "handles"]);
  });

  it("keeps visual corners in explicit visual mode even when axis-aligned", () => {
    expect(
      resolveInspectOverlayParts({
        mode: "visual",
        showOrigin: false,
        hasOrigin: false,
        hasOwnTransform: true,
        isTransformAxisAligned: true,
      }),
    ).toEqual(["visual"]);
  });
});

describe("isTransformBoxAxisAligned", () => {
  it("is true for a plain axis-aligned rectangle", () => {
    expect(
      isTransformBoxAxisAligned({
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 40 },
          { x: 0, y: 40 },
        ],
      }),
    ).toBe(true);
  });

  it("is true under a negative-scale mirror (still axis-aligned)", () => {
    expect(
      isTransformBoxAxisAligned({
        points: [
          { x: 40, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 10 },
          { x: 40, y: 10 },
        ],
      }),
    ).toBe(true);
  });

  it("is true under a 90° rotation (quad corners land on the AABB)", () => {
    expect(
      isTransformBoxAxisAligned({
        points: [
          { x: 10, y: 5 },
          { x: 10, y: 105 },
          { x: -50, y: 105 },
          { x: -50, y: 5 },
        ],
      }),
    ).toBe(true);
  });

  it("is false once the box is rotated off-axis", () => {
    // 10° rotation around origin of a 100×40 rect anchored at (0, 0):
    // corner coordinates are not AABB-aligned.
    const cos = Math.cos((10 * Math.PI) / 180);
    const sin = Math.sin((10 * Math.PI) / 180);
    expect(
      isTransformBoxAxisAligned({
        points: [
          { x: 0, y: 0 },
          { x: 100 * cos, y: 100 * sin },
          { x: 100 * cos - 40 * sin, y: 100 * sin + 40 * cos },
          { x: -40 * sin, y: 40 * cos },
        ],
      }),
    ).toBe(false);
  });
});
