// ---------------------------------------------------------------------------
// Normalized layout style types (CSS flex/grid vocabulary)
// ---------------------------------------------------------------------------

/** Four-sided spacing in px (padding, margin, gap). */
export type LayoutRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * Positioning offsets in px. null = auto (side not specified).
 *
 * Unlike spacing, an unspecified inset side must NOT default to 0: with
 * `right: 20` alone, a `left: 0` would win the horizontal constraint and pin
 * the node to the left edge, making `right` inert.
 */
export type LayoutInset = {
  top: number | null;
  right: number | null;
  bottom: number | null;
  left: number | null;
};

/** Width/height pair. null = auto (determined by layout engine). */
export type LayoutSize = {
  width: number | null;
  height: number | null;
};

/** Normalized layout style derived from VNode props.
 *  Uses CSS flex/grid vocabulary, matching the Taffy layout model. */
export type LayoutStyle = {
  display: "flex" | "grid" | "none";
  flexDirection: "row" | "column";
  flexWrap: "nowrap" | "wrap";
  alignItems: "flex-start" | "center" | "flex-end" | "stretch";
  justifyContent: "flex-start" | "center" | "flex-end" | "space-between" | "space-around";
  justifyItems?: "start" | "center" | "end" | "stretch";
  alignSelf: "auto" | "flex-start" | "center" | "flex-end" | "stretch";
  flexGrow: number;
  flexShrink: number;
  flexBasis: number | null; // null = auto
  gap: LayoutRect;
  size: LayoutSize;
  minSize: LayoutSize;
  maxSize: LayoutSize;
  padding: LayoutRect;
  margin: LayoutRect;
  overflow: "visible" | "hidden";
  // Positioning
  position: "relative" | "absolute";
  inset: LayoutInset;
  // Aspect ratio
  aspectRatio: number | null;
  // Grid-specific
  gridTemplateColumns?: string[];
  gridTemplateRows?: string[];
  gridColumnStart?: number;
  gridColumnEnd?: number;
  gridRowStart?: number;
  gridRowEnd?: number;
};
