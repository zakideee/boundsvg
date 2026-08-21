// @boundsvg/core/svg — SVG analysis and transform utilities

export type {
  AnalyzeSvgOptions,
  AnalyzeSvgResult,
  ClassifiedSvgElement,
  TextBBox,
} from "./svg/analyzer.js";
export {
  analyzeSvg,
  buildHybridVNode,
  svgToHybridVNode,
} from "./svg/analyzer.js";
export type {
  AnalyzeEmbeddedSvgIdsResult,
  EmbeddedSvgIdReference,
  EmbeddedSvgReferenceKind,
} from "./svg/embedded-id-analyzer.js";
export { analyzeEmbeddedSvgIds } from "./svg/embedded-id-analyzer.js";
export type {
  ImageResolver,
  InlineImagesResult,
  ResolvedImage,
} from "./svg/image-inliner.js";
export { inlineExternalImages } from "./svg/image-inliner.js";
export type {
  SvgTextElement,
  SvgTextToTextPropsOptions,
  SvgTextToVNodeOptions,
  SvgTspan,
} from "./svg/parser.js";
export {
  extractSvgText,
  svgTextToTextProps,
  svgTextToVNode,
} from "./svg/parser.js";
export { createResourceIdPrefix } from "./svg/resource-id.js";
export type { ScannedSvgElement, SvgViewBox } from "./svg/scanner.js";
export {
  parseSvgDimensions,
  parseSvgViewBox,
  scanSvgElements,
} from "./svg/scanner.js";
export type { DebugOverlayConfig, DebugOverlayPart } from "./svg/types.js";
