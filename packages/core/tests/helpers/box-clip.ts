import type { BBox, BorderRadii, BoxClip } from "../../src/ir/types.js";

/** Build circular corners for tests that do not need independently resolved ellipse axes. */
export function circularClip(bbox: BBox, radius: number | BorderRadii = 0): BoxClip {
  const radii =
    typeof radius === "number"
      ? [radius, radius, radius, radius]
      : [radius.tl, radius.tr, radius.br, radius.bl];
  return {
    kind: "boxContour",
    bbox,
    corners: radii.map((corner) => ({
      rx: Math.min(bbox.w / 2, bbox.h / 2, Math.max(0, corner)),
      ry: Math.min(bbox.w / 2, bbox.h / 2, Math.max(0, corner)),
    })) as [
      { rx: number; ry: number },
      { rx: number; ry: number },
      { rx: number; ry: number },
      { rx: number; ry: number },
    ],
  };
}
