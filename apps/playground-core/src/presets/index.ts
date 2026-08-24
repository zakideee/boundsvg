import type { Preset } from "../types";
import { bubbleFlowPreset } from "./bubble-flow";
import { defsSharingPreset } from "./defs-sharing";
import { fitPreset } from "./fit";
import { flowRichPreset } from "./flow-rich";
import { fontFallbackPreset } from "./font-fallback";
import { graphemeClustersPreset } from "./grapheme-clusters";
import { gridPreset } from "./grid";
import { inlinePrimitivesPreset } from "./inline-primitives";
import { layeredPreset } from "./layered";
import { measurementsPreset } from "./measurements";
import { mousePreset } from "./mouse";
import { partInspectionPreset } from "./part-inspection";
import { partPaintPreset } from "./part-paint";
import { rubyPreset } from "./ruby";
import {
  shapeBooleanOpsPreset,
  shapeOpacityPreset,
  shapePrimitivesPreset,
  symbolRegistryPreset,
  symbolStretchPreset,
} from "./shape";
import { shrinkwrapPreset } from "./shrinkwrap";
import { textEffectsPreset } from "./text-effects";
import { textFlowPreset } from "./text-flow";
import { textMotionV2Preset } from "./text-motion-v2";
import { textMotionV3Preset } from "./text-motion-v3";
import { textOnPathBasicsPreset } from "./text-on-path-basics";
import { textPathMotionPreset } from "./text-path-motion";
import { transformPreset } from "./transform";
import { typingImeTimelinePreset } from "./typing-ime-timeline";
import { variableFontPreset } from "./variable-font";
import { verticalPreset } from "./vertical";
import { verticalRichEllipsisPreset } from "./vertical-rich-ellipsis";
import { zIndexPreset } from "./z-index";

export const presets: Record<string, Preset> = {
  fit: fitPreset,
  "font-fallback": fontFallbackPreset,
  "variable-font": variableFontPreset,
  grid: gridPreset,
  vertical: verticalPreset,
  "inline-primitives": inlinePrimitivesPreset,
  "grapheme-clusters": graphemeClustersPreset,
  ruby: rubyPreset,
  "text-flow": textFlowPreset,
  "text-effects": textEffectsPreset,
  "flow-rich": flowRichPreset,
  "vertical-rich-ellipsis": verticalRichEllipsisPreset,
  "bubble-flow": bubbleFlowPreset,
  shrinkwrap: shrinkwrapPreset,
  measurements: measurementsPreset,
  mouse: mousePreset,
  "shape-primitives": shapePrimitivesPreset,
  "shape-ops": shapeBooleanOpsPreset,
  "shape-opacity": shapeOpacityPreset,
  "symbol-stretch": symbolStretchPreset,
  "symbol-registry": symbolRegistryPreset,
  "part-inspection": partInspectionPreset,
  "part-paint": partPaintPreset,
  "defs-sharing": defsSharingPreset,
  transform: transformPreset,
  "z-index": zIndexPreset,
  layered: layeredPreset,
  "typing-ime-timeline": typingImeTimelinePreset,
  "text-on-path-basics": textOnPathBasicsPreset,
  "decoration-path-fit": textMotionV2Preset,
  "rich-text-on-path": textMotionV3Preset,
  "text-path-motion": textPathMotionPreset,
};
