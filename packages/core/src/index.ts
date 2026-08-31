// Aiming (camera-style math for animated transforms)
export type { AimRect, AimViewport } from "./aim.js";
export { aimTransform, clampAimCenter, fitZoom } from "./aim.js";
// Animation track building
export type { TrackFrameInput } from "./animation-track.js";
export { buildAnimationTrack } from "./animation-track.js";
// Color
export { parseColor } from "./color.js";
// Engine
export type {
  AnimatedRasterIterations,
  AnimatedSvgPlayback,
  AnimationAffineMatrix,
  AnimationIterationCount,
  AnimationStateSample,
  AnimationTimeline,
  CompiledScene,
  CompileOptions,
  EmitAnimatedSvgOptions,
  EmitPngOptions,
  EmitSvgOptions,
  EmitTextOutlinesOptions,
  EmitWebpOptions,
  EngineInput,
  EngineOptions,
  Frame,
  LayeredPngOptions,
  LayeredSvgOptions,
  LayoutRenderOptions,
  OutputCommonOptions,
  OutputGenerator,
  PngResolutionAdjustedWarning,
  RasterEmissionOptions,
  RasterOversizeBehavior,
  ReducedMotionMode,
  RenderAnimatedGifOptions,
  RenderAnimatedSvgOptions,
  RenderAnimatedWebpOptions,
  RenderCompiledAnimatedGifOptions,
  RenderCompiledAnimatedWebpOptions,
  RenderCompiledFramesOptions,
  RenderCompiledPngFramesOptions,
  RenderCompiledSvgFramesOptions,
  RenderFramesOptions,
  RenderIrOptions,
  RenderPngFramesOptions,
  RenderPngOptions,
  RenderSvgFramesOptions,
  RenderSvgOptions,
  RenderTextOutlinesOptions,
  RenderWebpOptions,
  SvgEmissionOptions,
} from "./engine.js";
export { createEngine, createEngineAsync, Engine } from "./engine.js";
// Errors
export type { ErrorSeverity, PipelineStage, StructuredError } from "./errors.js";
export { FatalError, RecoverableError } from "./errors.js";
// Font
export { createFontRegistry, type FontRegistry } from "./font/registry.js";
export type { FontFaceInput, RegisterFontsOptions } from "./font/types.js";
// Inspection
export type { InspectionBBox, SceneInspection } from "./inspect.js";
export { inspectScene } from "./inspect.js";
export { validateSerializedIR } from "./ir/output-validator.js";
// IR (type-only — query functions are in @boundsvg/core/scene)
export type {
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
  IRTextUnitAnimationSample,
} from "./ir/types.js";
export type {
  LayerEntry,
  LayeredCompositionValidationOptions,
  LayeredCompositionValidationResult,
  LayeredPngResult,
  LayeredSvgResult,
  LayerManifestEntry,
  LayerManifestPart,
  LayerMode,
  LayerPngEntry,
  LayerPngManifestEntry,
  LayerWarning,
} from "./layered-svg.js";
export { formatLayerFileName, sortLayersByPaintOrder } from "./layered-svg.js";
// Layout
export type {
  BBox,
  LayoutNode,
  LayoutResult,
  TextMeasureResult,
} from "./layout/types.js";
export type {
  LayoutTransitionCheckpoint,
  LayoutTransitionInput,
} from "./layout-transition.js";
export { LAYOUT_TRANSITION_WRAPPER_META } from "./layout-transition.js";
// Node IDs
export type {
  CollectedNodeId,
  CollectedNodeIdSource,
  NodeIdDuplicate,
  NodeIdValidationResult,
} from "./node-ids.js";
export { assertUniqueNodeIds, collectNodeIds, validateNodeIds } from "./node-ids.js";
// Top-level render functions (default engine)
export {
  compileLayoutTransition,
  compileScene,
  dispose,
  hitTestOnIR,
  init,
  initAsync,
  isInitialized,
  renderCompiledFrames,
  renderCompiledToAnimatedGif,
  renderCompiledToAnimatedSvg,
  renderCompiledToAnimatedWebp,
  renderCompiledToPng,
  renderCompiledToSvg,
  renderFrames,
  renderToAnimatedGif,
  renderToAnimatedSvg,
  renderToAnimatedSvgAndIR,
  renderToAnimatedWebp,
  renderToIR,
  renderToLayeredPng,
  renderToLayeredSvg,
  renderToLayoutTree,
  renderToPng,
  renderToSvg,
  renderToSvgAndIR,
  renderToTextOutlines,
  renderToWebp,
  snapshotCompiledIR,
} from "./render.js";
// Render capability contract
export type { RasterScaleOptions, ResolvedRasterScale } from "./render-capabilities.js";
export {
  animatedSvgTimelineLimits,
  MAX_ANIMATION_FRAMES,
  MAX_ANIMATION_SVG_PAYLOAD_CHARS,
  RASTER_DIMENSION_SATURATION,
  RASTER_MAX_LONG_EDGE,
  RASTER_MAX_PIXELS,
  resolveRasterScale,
} from "./render-capabilities.js";
// Resources
export type { FetchImageFn, ImageLoader, LoadedImage } from "./resources/image-loader.js";
export { createImageLoader } from "./resources/image-loader.js";
// SceneDocument
export { fromSceneDocument, toSceneDocument } from "./scene/from-vnode.js";
export { assertSerializableSceneTransport } from "./scene/serializable-transport.js";
export type {
  BoxSceneNode,
  CanvasSceneNode,
  FlexSceneNode,
  GridSceneNode,
  ImageSceneNode,
  InlineRectSceneNode,
  InlineSceneNode,
  PathSceneNode,
  RtSceneNode,
  RubySceneNode,
  SceneNode,
  ShapeSceneNode,
  SvgSceneNode,
  SymbolSceneNode,
  TextOnPathInlineSceneNode,
  TextOnPathSceneChild,
  TextOnPathSceneNode,
  TextSceneNode,
} from "./scene/types.js";
export { isSceneNode } from "./scene/types.js";
export {
  compileGeometryToSvgDocument,
  computeGeometryIntersections,
  divideGeometryRegions,
  evaluateGeometryParts,
  hitTestGeometryParts,
  hitTestShapeAt,
  resolveSymbolGeometry,
  type ShapeHitTestPlacement,
  transformToSvg,
} from "./shape/compiler.js";
export {
  type GeometryExclusionOptions,
  geometryToFlowExclusion,
  symbolToFlowExclusion,
} from "./shape/flow-exclusion.js";
export { type RegionPathTransform, regionToPathData } from "./shape/serialize-region.js";
export type {
  BooleanOp,
  Contour,
  CurvePoint,
  CurveSegment,
  DivideRegions,
  ElasticSegment,
  GeometryDoc,
  GeometryHitTestOptions,
  GeometryIntersection,
  GeometryNode,
  GeometryPart,
  GeometryPartBounds,
  GeometryPartHit,
  GeometryViewBox,
  Region,
  SymbolDefinition,
  Transform2D,
} from "./shape/types.js";
// SVG resource IDs
export { createResourceIdPrefix } from "./svg/resource-id.js";
export type { DebugOverlayConfig, DebugOverlayPart } from "./svg/types.js";
// Emoji cluster detection
export { findEmojiClusters, isEmojiCluster, splitEmojiClusters } from "./text/emoji.js";
// Text
export type {
  InlineRectFragment,
  IntrinsicInlineSizes,
  RichTextInlineBoxNode,
  RichTextInlineRectNode,
  RichTextNode,
  TextDecoration,
  TextDecorationFragment,
  TextDecorationLine,
  TextDecorationPaintPath,
  TextOutlineNode,
  TextOutlinePath,
  TextPathMode,
  TextShadowLayer,
  TextStrokeLayer,
} from "./text/types.js";
export {
  MAX_INLINE_RECTS,
  MAX_TEXT_ANIMATION_FRAGMENTS,
  MAX_TEXT_ANIMATION_UNITS,
  MAX_TEXT_DECORATION_PATHS,
  MAX_TEXT_DECORATION_PATTERN_CONTOURS,
  MAX_TEXT_DECORATION_PATTERN_SEGMENTS,
  MAX_TEXT_DECORATION_RANGES,
  MAX_TEXT_DECORATION_SKIP_INK_CANDIDATE_PAIRS,
  MAX_TEXT_DECORATION_SKIP_INK_GLYPHS,
  MAX_TEXT_EFFECT_LAYERS,
  MAX_TEXT_PATH_INLINE_CONTAINERS,
  MAX_TEXT_PATH_PAINT_RANGES,
  MAX_TEXT_PATH_PAINTED_LAYERS,
  MAX_TEXT_PATH_SHAPING_RUNS,
  MAX_TEXT_PATH_SOURCE_ITEMS,
  TEXT_ANIMATION_FRAGMENT_WARNING_THRESHOLD,
  TEXT_ANIMATION_UNIT_WARNING_THRESHOLD,
} from "./text/types.js";
// Validation
export { validate } from "./validate/index.js";
// Components
export {
  Box,
  Canvas,
  Flex,
  Grid,
  Image,
  Inline,
  InlineBox,
  InlineRect,
  Path,
  Rt,
  Ruby,
  Shape,
  Svg,
  Symbol,
  Text,
  TextOnPath,
} from "./vnode/components.js";
// createElement & JSX runtime
export { createElement } from "./vnode/create-element.js";
export { Fragment, jsx, jsxs } from "./vnode/jsx-runtime.js";
// VNode Types
export type {
  AnimationEasing,
  AnimationKeyframe,
  AnimationSpec,
  AnimationSpring,
  AnimationStepPosition,
  AnimationTransform2D,
  AnyVNode,
  BorderRadius,
  BoxProps,
  BoxVNode,
  CanvasProps,
  CanvasVNode,
  ChildFor,
  ChildrenFor,
  FlexProps,
  FlexVNode,
  GridProps,
  GridVNode,
  ImageProps,
  ImageVNode,
  InlineBoxChild,
  InlineBoxProps,
  InlineBoxVNode,
  InlineChild,
  InlineProps,
  InlineRectProps,
  InlineRectVNode,
  InlineVNode,
  NormalizedPropsFor,
  PathProps,
  PathVNode,
  PropsFor,
  PropsMap,
  RtChild,
  RtProps,
  RtVNode,
  RubyChild,
  RubyProps,
  RubyVNode,
  ShapeProps,
  ShapeVNode,
  Spacing,
  StrokeScaling,
  SvgProps,
  SvgVNode,
  SymbolProps,
  SymbolVNode,
  TextChild,
  TextFlowExclusion,
  TextFlowExclusionMarginPx,
  TextOnPathChild,
  TextOnPathProps,
  TextOnPathVNode,
  TextProps,
  TextUnitAnimation,
  TextVNode,
  VNode,
  VNodeChild,
  VNodeChildrenArgs,
  VNodeFor,
  VNodeInputChildFor,
  VNodeType,
} from "./vnode/types.js";
// Text measurement (Engine method DTOs — the JSON-safe measurement contract)
export type {
  FlowExclusionMarginPx,
  FlowExclusionShape,
  FlowOverflowReason,
  IntrinsicInlineSizeInput,
  IntrinsicInlineSizeResult,
  MeasureTextBlockInput,
  MeasureTextBlockLine,
  MeasureTextBlockResult,
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
  TextMeasureSpan,
} from "./wasm/index.js";
