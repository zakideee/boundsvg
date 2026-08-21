import { describe, expect, it } from "vitest";
import {
  isTransformBoxAxisAligned,
  resolveInspectOverlayParts,
} from "../../playground-shared/event-effects.js";

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
