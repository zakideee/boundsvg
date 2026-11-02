/** Labels and explanations for the shared inspection geometry selector. */
import type { OverlayDisplayMode } from "./event-effects.js";

/** Default geometry for inspection across playgrounds. */
export const DEFAULT_INSPECTION_FRAME_MODE: OverlayDisplayMode = "transform";

/** User-facing name of the inspection geometry selector. */
export const INSPECTION_FRAME_LABEL = "Inspection frame";

/** Ordered choices using the existing overlay modes and resolved geometry. */
export const INSPECTION_FRAME_OPTIONS = {
  transform: {
    label: "Transformed frame",
    description: "The layout frame transformed with the element and its ancestors.",
  },
  visual: {
    label: "Axis-aligned bounds (AABB)",
    description:
      "The axis-aligned rectangle enclosing the transformed frame. It is not the full paint bounds of glyphs, shadows, or strokes.",
  },
  layout: {
    label: "Layout frame",
    description: "The layout frame before element and ancestor transforms.",
  },
  all: {
    label: "Compare frames",
    description:
      "Compare layout (slate), transformed frame (cyan), and AABB corners (pink). Coincident frames are omitted.",
  },
  off: {
    label: "Off",
    description: "Hide inspection frames and origin markers.",
  },
} satisfies Record<OverlayDisplayMode, { label: string; description: string }>;

/** Explanation when no inspectable SVG is displayed. */
export const INSPECTION_FRAME_UNAVAILABLE = "Inspection is available in an SVG preview.";
