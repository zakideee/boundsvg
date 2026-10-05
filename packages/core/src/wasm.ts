// @boundsvg/core/wasm — Low-level WASM API

export { decodeAnimatedRasterFatal } from "./animation-errors.js";
export type {
  AnimatedRasterJob,
  AnimatedRasterJobInput,
  AnimatedRasterJobStep,
} from "./animation-job.js";
export { createAnimatedRasterJob } from "./animation-job.js";
export { validateStructuralIR } from "./ir/output-validator.js";
export type {
  AnimatedRasterSessionHandle,
  AnimationSessionFinishOutput,
  AnimationSessionOpenInput,
} from "./wasm/animation-session.js";
export type {
  FlowExclusionShape,
  FlowOverflowReason,
  GlyphPathFn,
  IntrinsicInlineSizeInput,
  IntrinsicInlineSizeResult,
  MeasureTextBlockInput,
  MeasureTextBlockResult,
  ShapeCompileOptions,
  ShapeSymbolResolutionOptions,
  ShapeWithVariationsFn,
  ShrinkwrapFlowInput,
  ShrinkwrapFlowResult,
  ShrinkwrapStatus,
  ShrinkwrapTextInput,
  ShrinkwrapTextResult,
  TextFlowExclusionLine,
  TextFlowFragment,
  TextFlowFragmentStyle,
  TextFlowInput,
  TextFlowLine,
  TextFlowResult,
  TextFlowRubyAnnotation,
  TextFlowWithExclusionsInput,
  TextFlowWithExclusionsResult,
  Uax14BreakFn,
  VariationSetting,
  WasmGlyphPath,
} from "./wasm/index.js";
export {
  createWasmEngineInstance,
  createWasmShapeFn,
  EXPECTED_WASM_SCHEMA_VERSION,
  getWasmFontMetrics,
  initWasm,
  isShapeWasmAvailable,
  isWasmInitialized,
  parseFontVariationSettings,
  WasmEngineHandle,
  WasmPreparedSceneHandle,
  wasmCompileShapePaths,
  wasmCompileShapeSvg,
  wasmComputeShapeIntersections,
  wasmDivideShapeRegions,
  wasmEvaluateShapeParts,
  wasmEvaluateShapeRegion,
  wasmExtractImageHrefs,
  wasmExtractSkippedImageHrefs,
  wasmGraphemeSplit,
  wasmHitTestShapeParts,
  wasmRenderShapeRegionSvg,
  wasmReplaceImageHrefs,
  wasmResolveSymbolGeometry,
  wasmUax14LineBreaks,
} from "./wasm/index.js";
export {
  isWasmIntrinsicInlineSizeResult,
  isWasmMeasureTextBlockResult,
  isWasmShrinkwrapFlowResult,
  isWasmShrinkwrapTextResult,
  isWasmTextFlowResult,
  isWasmTextFlowWithExclusionsResult,
} from "./wasm/protocol-decoders.js";
export type {
  WasmAnimatedRasterSessionInstance,
  WasmEngineInstance,
  WasmModule,
  WasmPreparedSceneInstance,
} from "./wasm/types.js";
