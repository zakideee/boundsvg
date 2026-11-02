import { collectInspectionBBoxes } from "@boundsvg/core/inspect";
import type { IR, IRGroupNode } from "@boundsvg/core/scene";
import { buildIRSourceIndex } from "@boundsvg/core/scene";
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

      warnings: [],
      root: {
        ownership: { role: "source" },
        type: "group",
        nodeId: "auto:0",
        bbox: { x: 0, y: 0, w: 100, h: 80 },
        children: [
          {
            ownership: { role: "source" },
            type: "group",
            nodeId: "transformed",
            bbox: { x: 10, y: 20, w: 40, h: 24 },
            transform: { translateX: 5, translateY: 7, originX: 20, originY: 12 },
            children: [
              {
                ownership: { role: "content", ownerNodeId: "transformed" },
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

    const matchingEntries = collectInspectionBBoxes(buildIRSourceIndex(ir)).filter(
      (bbox) => bbox.nodeId === "transformed",
    );
    expect(matchingEntries.map((bbox) => bbox.type)).toEqual(["group", "rect"]);
    expect(matchingEntries[0]?.hasOwnTransform).toBe(true);
    expect(matchingEntries[1]?.hasOwnTransform).toBe(false);

    const merged = buildNodeBBoxMap(ir).get(1);
    expect(merged?.hasOwnTransform).toBe(true);
    expect(merged?.origin).toEqual(matchingEntries[0]?.origin);
    expect(merged?.transformBox).toEqual(matchingEntries[0]?.transformBox);
    expect(merged?.visualBBox).toEqual(matchingEntries[0]?.visualBBox);
    expect(merged?.rx).toBe(6);
    expect(merged?.semantics?.kind).toBe("Rect");
  });
});

describe("resolveInspectOverlayParts", () => {
  const layoutBBox = { x: 10, y: 20, w: 40, h: 24 };

  function geometryForAncestor(transform?: NonNullable<IRGroupNode["transform"]>) {
    const ir: IR = {
      width: 100,
      height: 80,

      warnings: [],
      root: {
        ownership: { role: "source" },
        type: "group",
        nodeId: "parent",
        bbox: { x: 0, y: 0, w: 100, h: 80 },
        transform,
        children: [
          {
            ownership: { role: "source" },
            type: "rect",
            nodeId: "child",
            bbox: layoutBBox,
            fill: "red",
          },
        ],
      },
    };
    const geometry = buildNodeBBoxMap(ir).get(1);
    expect(geometry).toBeDefined();
    return geometry!;
  }

  it.each([
    ["skew", { skewXDeg: -8 }, ["layout", "transform", "handles", "visual"]],
    ["rotate", { rotateDeg: 15 }, ["layout", "transform", "handles", "visual"]],
    ["translate", { translateX: 8 }, ["layout", "transform", "handles"]],
    ["scale", { scaleX: 2, scaleY: 3 }, ["layout", "transform", "handles"]],
    [
      "both skew axes",
      { skewXDeg: 12, skewYDeg: -7 },
      ["layout", "transform", "handles", "visual"],
    ],
    ["no transform", undefined, ["layout"]],
    ["same corner set", { scaleX: -1, originX: 30 }, ["layout"]],
  ] as const)("uses resolved child geometry under ancestor %s", (_name, transform, expected) => {
    const geometry = geometryForAncestor(transform);
    expect(geometry.hasOwnTransform).toBe(false);
    expect(geometry.origin).toBeNull();
    expect(
      resolveInspectOverlayParts({
        mode: "all",
        showOrigin: true,
        hasOrigin: false,
        ...geometry,
      }),
    ).toEqual(expected);
  });

  it("preserves explicit modes regardless of coincident geometry", () => {
    const geometry = geometryForAncestor();
    for (const [mode, expected] of [
      ["layout", ["layout"]],
      ["transform", ["transform", "handles"]],
      ["visual", ["visual"]],
      ["off", []],
    ] as const) {
      expect(
        resolveInspectOverlayParts({
          ...geometry,
          mode,
          showOrigin: true,
          hasOrigin: false,
        }),
      ).toEqual(expected);
    }
  });

  it("keeps the node's own origin independent of redundant box suppression", () => {
    const geometry = geometryForAncestor();
    expect(
      resolveInspectOverlayParts({
        ...geometry,
        mode: "all",
        showOrigin: true,
        hasOrigin: true,
      }),
    ).toEqual(["layout", "origin"]);
    expect(
      resolveInspectOverlayParts({
        ...geometry,
        mode: "off",
        showOrigin: true,
        hasOrigin: true,
      }),
    ).toEqual([]);
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

  it("does not suppress a small but resolved skew as axis-aligned", () => {
    expect(
      isTransformBoxAxisAligned({
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100.00000001, y: 40 },
          { x: 0.00000001, y: 40 },
        ],
      }),
    ).toBe(false);
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
