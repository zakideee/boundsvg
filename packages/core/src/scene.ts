// @boundsvg/core/scene — IR query and analysis operations

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
export { buildIRSourceIndex } from "./ir/source-index.js";
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
} from "./ir/types.js";
