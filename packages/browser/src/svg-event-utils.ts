import type { IRNodeType } from "@boundsvg/core/scene";

/**
 * Translate DOM client coordinates to SVG user-space coordinates.
 * Returns null when the CTM (current transformation matrix) is unavailable.
 */
export function translateSvgCoords(
  svgEl: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const pt = svgEl.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) {
    return null;
  }
  const svgPt = pt.matrixTransform(ctm.inverse());
  return { x: svgPt.x, y: svgPt.y };
}

/**
 * Verify that a point hits a path's actual geometry (not just its bounding box)
 * using the browser's `isPointInFill()` / `isPointInStroke()` SVG DOM APIs.
 *
 * Finds the `<path>` element inside an `<svg data-boundsvg-node-id="...">` wrapper
 * within the given container. Returns true (bbox fallback) when the element
 * or API is unavailable.
 */
export function verifyPathGeometry(
  container: Element,
  nodeId: string,
  clientX: number,
  clientY: number,
): boolean {
  const wrapper = container.querySelector(
    `svg[data-boundsvg-node-id="${CSS.escape(nodeId)}"]`,
  ) as SVGSVGElement | null;
  if (!wrapper) {
    return true;
  }

  const pathEl = wrapper.querySelector("path") as SVGPathElement | null;
  if (!pathEl) {
    return true;
  }

  if (typeof pathEl.isPointInFill !== "function") {
    return true;
  }

  const ctm = pathEl.getScreenCTM();
  if (!ctm) {
    return true;
  }

  const svg = pathEl.ownerSVGElement;
  if (!svg) {
    return true;
  }

  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const localPoint = point.matrixTransform(ctm.inverse());

  const domPoint = new DOMPoint(localPoint.x, localPoint.y);
  return pathEl.isPointInFill(domPoint) || pathEl.isPointInStroke(domPoint);
}

/**
 * Resolve the actual hit target from a list of bbox-hit candidates.
 *
 * For path nodes, verifies geometry using `isPointInFill` / `isPointInStroke`.
 * Non-path nodes (rect, text, image) use their bounding box directly.
 * Falls through to the next candidate if path geometry misses.
 */
export function resolveHitTarget(
  container: Element,
  candidates: ReadonlyArray<string>,
  nodeTypeMap: ReadonlyMap<string, IRNodeType>,
  clientX: number,
  clientY: number,
): string | null {
  for (const nodeId of candidates) {
    if (nodeTypeMap.get(nodeId) !== "path") {
      return nodeId;
    }
    if (verifyPathGeometry(container, nodeId, clientX, clientY)) {
      return nodeId;
    }
  }
  return null;
}
