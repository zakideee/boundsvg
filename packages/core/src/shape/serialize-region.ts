import { formatNumber } from "../svg/utils.js";
import type { AffineMatrix } from "../transform.js";
import type { CurvePoint, Region } from "./types.js";

/** Affine (scale + translate) applied while serializing region points. */
type RegionScaleTranslate = {
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
};

/** Placement shortcut or a complete SVG-compatible affine matrix. */
export type RegionPathTransform = RegionScaleTranslate | AffineMatrix;

const IDENTITY: RegionScaleTranslate = { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };

/**
 * Serialize an evaluated Region to SVG path data (M/L/Q/C + Z per contour),
 * applying `transform` to every point. Output is deterministic: fixed segment
 * order (kernel-canonicalized) and fixed number formatting (`formatNumber`).
 */
export function regionToPathData(
  region: Region,
  transform: RegionPathTransform = IDENTITY,
): string {
  const point = (curvePoint: CurvePoint): string => {
    const transformed =
      "a" in transform
        ? {
            x: transform.a * curvePoint.x + transform.c * curvePoint.y + transform.e,
            y: transform.b * curvePoint.x + transform.d * curvePoint.y + transform.f,
          }
        : {
            x: curvePoint.x * transform.scaleX + transform.translateX,
            y: curvePoint.y * transform.scaleY + transform.translateY,
          };
    return `${formatNumber(transformed.x)} ${formatNumber(transformed.y)}`;
  };

  const parts: string[] = [];
  for (const contour of region.contours) {
    const first = contour.segments[0];
    if (!first) {
      continue;
    }
    parts.push(`M${point(first.p0)}`);
    for (const segment of contour.segments) {
      if (segment.kind === "line") {
        parts.push(`L${point(segment.p1)}`);
      } else if (segment.kind === "quad") {
        parts.push(`Q${point(segment.p1)} ${point(segment.p2)}`);
      } else {
        parts.push(`C${point(segment.p1)} ${point(segment.p2)} ${point(segment.p3)}`);
      }
    }
    parts.push("Z");
  }
  return parts.join("");
}
