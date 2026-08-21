// @boundsvg/core/scene — IR query and analysis operations

export { buildHandlerMap } from "./ir/handler-map.js";
export {
  buildHitTestIndex,
  hitTest,
  hitTestCandidates,
  hitTestWithIndex,
} from "./ir/hit-test.js";
export { buildInspectHitTestIndex, inspectHitTestCandidates } from "./ir/inspect-hit-test.js";
export { buildNodeTypeMap } from "./ir/node-type-map.js";
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
  IRNodeType,
  IRPathNode,
  IRRectNode,
  IRShapeNode,
  IRSvgNode,
  IRTextNode,
} from "./ir/types.js";
