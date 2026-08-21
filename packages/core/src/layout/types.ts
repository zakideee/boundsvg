import type { TextLayoutResult } from "../text/types.js";
import type { VNode } from "../vnode/types.js";

/** Bounding box in absolute px */
export type BBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Layout result node with computed position */
export type LayoutNode = {
  nodeId: string;
  vnode: VNode;
  bbox: BBox;
  children: LayoutNode[];
  /** Text layout info from WASM (if text node) */
  textLayout?: TextMeasureResult;
};

/** Text measurement result from WASM */
export type TextMeasureResult = {
  measuredWidth: number;
  measuredHeight: number;
  glyphs: GlyphInfoResult[];
  /** Fully resolved text layout: line-broken, bbox, overflow, chosen font size. */
  resolvedTextLayout: TextLayoutResult;
};

/** Glyph info returned from WASM shaping */
export type GlyphInfoResult = {
  glyphId: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  cluster: number;
  fontAlias?: string;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  rotationDeg?: number;
};

/** Layout computation result */
export type LayoutResult = {
  root: LayoutNode;
  measureCallCount: number;
};
