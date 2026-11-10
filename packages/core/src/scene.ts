// @boundsvg/core/scene — IR query and analysis operations

export type { HitClip, HitContainmentResult, HitPose } from "./ir/hit-geometry.js";
export { queryFrameContainment } from "./ir/hit-geometry.js";
export type { IRHitCandidate, IRHitIndex } from "./ir/hit-test.js";
export {
  buildHitTestIndex,
  hitTest,
} from "./ir/hit-test.js";
export { buildInspectHitTestIndex } from "./ir/inspect-hit-test.js";
export type {
  IRNodeOccurrence,
  IRSourceIndex,
  IRSourceInfo,
  IRSourceRef,
} from "./ir/source-index.js";
export {
  buildIRSourceIndex,
  isSemanticFrame,
  resolveInteractionTarget,
} from "./ir/source-index.js";
export { createSpatialIndex, type SpatialIndex } from "./ir/spatial-index.js";
export type { LineEntry, TextMap, TextNodeEntry } from "./ir/text-map.js";
export {
  buildTextMap,
  findLineAtPoint,
  getAllText,
  getAncestorText,
  getNodeText,
} from "./ir/text-map.js";
export type {
  TextCaret,
  TextSelectionMap,
  TextSelectionNode,
  TextSelectionQuad,
  TextSelectionRange,
  TextSourceRole,
} from "./ir/text-selection.js";
export {
  buildTextSelectionMap,
  findTextCaretAtPoint,
  getTextRangeQuads,
} from "./ir/text-selection.js";
export type {
  BBox,
  BoxClip,
  HandlersRef,
  IR,
  IRGroupNode,
  IRImageNode,
  IRNode,
  IRNodeOwnership,
  IRNodeType,
  IRPathNode,
  IRRectNode,
  IRShapeNode,
  IRSvgNode,
  IRTextNode,
  SvgPoint,
} from "./ir/types.js";
export type {
  AffineMatrix,
  AffinePointProjection,
  AffineProjectionUnavailableReason,
  Point2D,
} from "./transform.js";
export { applyInverseAffineMatrixToPoint } from "./transform.js";

export type { BoxPosition, RelativePosition } from "./vnode/types.js";
