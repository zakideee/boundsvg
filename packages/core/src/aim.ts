import type { Point2D } from "./transform.js";
import type { AnimationTransform2D } from "./vnode/types.js";

// ---------------------------------------------------------------------------
// Aiming — the camera-style math for animated transforms.
//
// The declarative animation pipeline scales a node about its own bbox
// center via a sandwich transform (`translate(t) translate(C) scale(k)
// translate(−C)`). These helpers own that knowledge so consumers never
// have to rediscover it: apply the returned transforms to a wrapper node
// whose bbox spans the whole viewport (e.g. an absolutely positioned
// full-canvas group), and a point `c` maps to `t + C + k · (c − C)`.
// ---------------------------------------------------------------------------

/** An axis-aligned rectangle in viewport coordinates. */
export type AimRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** The area the camera frame must stay inside — usually the canvas. */
export type AimViewport = {
  width: number;
  height: number;
};

/**
 * The largest zoom at which `target` plus `padPx` of breathing room on
 * every side still fits inside the viewport, capped by `maxZoom`. A
 * subject larger than the padded frame yields a value at or below 1 —
 * treat that as "show the full view" rather than cropping.
 */
export function fitZoom(
  target: AimRect,
  viewport: AimViewport,
  options: { maxZoom: number; padPx?: number },
): number {
  const pad = options.padPx ?? 0;
  return Math.min(
    options.maxZoom,
    viewport.width / (target.width + pad * 2),
    viewport.height / (target.height + pad * 2),
  );
}

/**
 * Clamp a prospective frame center so the zoomed frame never leaves the
 * viewport: at zoom `k` the frame is a viewport-shaped window of size
 * `viewport / k` around the center.
 */
export function clampAimCenter(center: Point2D, viewport: AimViewport, zoom: number): Point2D {
  const halfW = viewport.width / (2 * zoom);
  const halfH = viewport.height / (2 * zoom);
  return {
    x: Math.min(viewport.width - halfW, Math.max(halfW, center.x)),
    y: Math.min(viewport.height - halfH, Math.max(halfH, center.y)),
  };
}

/**
 * The animated transform that shows `center` at the middle of the
 * viewport, magnified by `zoom`. Apply it to a wrapper node whose bbox
 * spans the viewport (see module note); with the bbox-center scale
 * origin, centering `c` on the viewport center `C` needs
 * `t = zoom · (C − c)`. A zoom at or below 1 returns the identity.
 */
export function aimTransform(
  center: Point2D,
  viewport: AimViewport,
  zoom: number,
): AnimationTransform2D {
  if (zoom <= 1) {
    return { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 };
  }
  return {
    translateX: zoom * (viewport.width / 2 - center.x),
    translateY: zoom * (viewport.height / 2 - center.y),
    scaleX: zoom,
    scaleY: zoom,
  };
}
