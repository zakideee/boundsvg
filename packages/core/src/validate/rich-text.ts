import { parseColor } from "../color.js";
import type { TimelineAuthoredDomainOwner } from "../engine/timeline-domain-transport.js";
import { FatalError } from "../errors.js";
import { countTextOnPathRunResources, flattenTextOnPathRuns } from "../text/inline-runs.js";
import { assertVNodeRichTextDepth } from "../text/rich-text-limits.js";
import {
  MAX_INLINE_RECTS,
  MAX_TEXT_DECORATION_RANGES,
  MAX_TEXT_EFFECT_LAYERS,
  MAX_TEXT_PATH_INLINE_CONTAINERS,
  MAX_TEXT_PATH_PAINT_RANGES,
  MAX_TEXT_PATH_PAINTED_LAYERS,
  MAX_TEXT_PATH_SHAPING_RUNS,
  MAX_TEXT_PATH_SOURCE_ITEMS,
  type TextShadowLayer,
  type TextStrokeLayer,
} from "../text/types.js";
import type {
  InlineBoxProps,
  InlineProps,
  InlineRectProps,
  RtProps,
  TextOnPathProps,
  VNode,
  VNodeFor,
  VNodeType,
} from "../vnode/types.js";
import { layoutContractError } from "./layout-props.js";
import {
  animationValidationError,
  assertAnimationRecord,
  assertValidPathData,
  validateAnimationValue,
} from "./visual-props.js";

// Allowlists are keyed over the prop types so the compiler flags drift in both
// directions: a prop added to InlineProps/InlineBoxProps/RtProps without an entry here fails
// `satisfies`, and a removed prop leaves an excess key that also fails.
const INLINE_ALLOWED_PROP_KEYS = {
  font: true,
  fallback: true,
  fontWeight: true,
  fontStyle: true,
  fontVariationSettings: true,
  fontFeatureSettings: true,
  textOrientation: true,
  textCombineUpright: true,
  color: true,
  textStrokes: true,
  textShadows: true,
  textDecoration: true,
  language: true,
  fontSizePx: true,
  letterSpacingPx: true,
  paddingInline: true,
  background: true,
  borderColor: true,
  borderWidth: true,
  borderRadius: true,
  animate: true,
} as const satisfies Record<Exclude<keyof InlineProps, "children">, true>;

const INLINE_ALLOWED_PROPS: ReadonlySet<string> = new Set(Object.keys(INLINE_ALLOWED_PROP_KEYS));

const INLINE_BOX_ALLOWED_PROP_KEYS = {
  font: true,
  fallback: true,
  fontWeight: true,
  fontStyle: true,
  fontSizePx: true,
  letterSpacingPx: true,
  color: true,
  language: true,
  paddingInline: true,
  background: true,
  borderColor: true,
  borderWidth: true,
  borderRadius: true,
  textDecoration: true,
  animate: true,
} as const satisfies Record<Exclude<keyof InlineBoxProps, "children">, true>;

const INLINE_BOX_ALLOWED_PROPS: ReadonlySet<string> = new Set(
  Object.keys(INLINE_BOX_ALLOWED_PROP_KEYS),
);

const INLINE_RECT_ALLOWED_PROP_KEYS = {
  inlineSizePx: true,
  blockSizePx: true,
  advancePx: true,
  blockAlign: true,
  color: true,
  borderRadiusPx: true,
  opacity: true,
  paintOrder: true,
  animate: true,
} as const satisfies Record<keyof InlineRectProps, true>;

const INLINE_RECT_ALLOWED_PROPS: ReadonlySet<string> = new Set(
  Object.keys(INLINE_RECT_ALLOWED_PROP_KEYS),
);

const RT_ALLOWED_PROP_KEYS = {
  font: true,
  fallback: true,
  fontWeight: true,
  fontStyle: true,
  fontVariationSettings: true,
  fontFeatureSettings: true,
  textOrientation: true,
  color: true,
  language: true,
  fontSizePx: true,
  lineHeight: true,
  lineHeightPx: true,
  letterSpacingPx: true,
  textDecoration: true,
} as const satisfies Record<Exclude<keyof RtProps, "children">, true>;

const RT_ALLOWED_PROPS: ReadonlySet<string> = new Set(Object.keys(RT_ALLOWED_PROP_KEYS));

const TEXT_ON_PATH_ALLOWED_PROP_KEYS = {
  d: true,
  width: true,
  height: true,
  font: true,
  fallback: true,
  fontWeight: true,
  fontStyle: true,
  fontVariationSettings: true,
  fontFeatureSettings: true,
  fontSizePx: true,
  letterSpacingPx: true,
  language: true,
  color: true,
  startOffsetPx: true,
  textAnchor: true,
  pathDirection: true,
  pathNormal: true,
  pathOffsetPx: true,
  pathFit: true,
  pathOverflow: true,
  textStroke: true,
  textStrokeWidth: true,
  textStrokeLinecap: true,
  textStrokeLinejoin: true,
  textStrokeDasharray: true,
  textStrokeMiterlimit: true,
  textStrokes: true,
  textShadows: true,
  textDecoration: true,
  opacity: true,
  zIndex: true,
  position: true,
  top: true,
  right: true,
  bottom: true,
  left: true,
  margin: true,
  animate: true,
  animateUnits: true,
  layer: true,
  onClick: true,
  onDoubleClick: true,
  onContextMenu: true,
  onPointerDown: true,
  onPointerUp: true,
  onPointerCancel: true,
  onPointerMove: true,
  onPointerEnter: true,
  onPointerLeave: true,
  onPointerOver: true,
  onPointerOut: true,
  onMouseDown: true,
  onMouseUp: true,
  onMouseMove: true,
  onMouseEnter: true,
  onMouseLeave: true,
  onMouseOver: true,
  onMouseOut: true,
  onTouchStart: true,
  onTouchEnd: true,
  onTouchMove: true,
  id: true,
  meta: true,
} as const satisfies Record<Exclude<keyof TextOnPathProps, "children">, true>;

const TEXT_ON_PATH_ALLOWED_PROPS: ReadonlySet<string> = new Set(
  Object.keys(TEXT_ON_PATH_ALLOWED_PROP_KEYS),
);

const RUBY_POSITION_VALUES: ReadonlySet<string> = new Set([
  "over",
  "under",
  "alternate",
  "inter-character",
]);

const RUBY_ALIGN_VALUES: ReadonlySet<string> = new Set([
  "start",
  "center",
  "space-between",
  "space-around",
]);

const RUBY_LINE_SIZING_VALUES: ReadonlySet<string> = new Set(["stable", "css"]);

const INLINE_PARENT_TYPES: ReadonlySet<VNodeType> = new Set([
  "Text",
  "TextOnPath",
  "Inline",
  "InlineBox",
  "Ruby",
  "Rt",
]);

const RUBY_PARENT_TYPES: ReadonlySet<VNodeType> = new Set(["Text", "Inline", "InlineBox"]);

const INLINE_RECT_PARENT_TYPES: ReadonlySet<VNodeType> = new Set(["Text", "Inline", "InlineBox"]);

function isAllowedParent(
  parentType: VNodeType | undefined,
  allowedParentTypes: ReadonlySet<VNodeType>,
): boolean {
  return parentType !== undefined && allowedParentTypes.has(parentType);
}

export function validateRichTextParent(
  nodeType: VNodeType,
  parentType: VNodeType | undefined,
  nid: string,
): void {
  if (nodeType === "Inline" && !isAllowedParent(parentType, INLINE_PARENT_TYPES)) {
    throw new FatalError(
      "VALIDATION",
      "Validation error: Inline can only be nested inside Text, TextOnPath, Inline, InlineBox, Ruby, or Rt",
      { stage: "validate", nodeId: nid },
    );
  }

  if (nodeType === "Ruby" && !isAllowedParent(parentType, RUBY_PARENT_TYPES)) {
    throw new FatalError(
      "VALIDATION",
      "Validation error: Ruby can only be nested inside Text, Inline, or InlineBox",
      { stage: "validate", nodeId: nid },
    );
  }

  if (nodeType === "InlineRect" && !isAllowedParent(parentType, INLINE_RECT_PARENT_TYPES)) {
    throw new FatalError(
      "INLINE_RECT_INVALID_PARENT",
      "InlineRect can only be nested inside Text, Inline, or InlineBox.",
      { stage: "validate", nodeId: nid },
    );
  }

  if (nodeType === "Rt" && parentType !== "Ruby") {
    throw new FatalError("VALIDATION", "Validation error: Rt can only be nested inside Ruby", {
      stage: "validate",
      nodeId: nid,
    });
  }
}

function validateTextEffects(node: VNodeFor<"Text"> | VNodeFor<"TextOnPath">, nid: string): void {
  const { textStrokes, textShadows, textStroke } = node.props;
  if (textStrokes && textStroke) {
    throw new FatalError(
      "VALIDATION",
      `textStrokes and the scalar textStroke props are mutually exclusive (${nid}).`,
      { stage: "validate", nodeId: nid },
    );
  }
  validateTextStrokeLayers(textStrokes, nid);
  validateTextShadowLayers(textShadows, nid);
}

function validateTextStrokeLayers(
  textStrokes: readonly TextStrokeLayer[] | undefined,
  nid: string,
): void {
  if (!textStrokes) {
    return;
  }
  if (textStrokes.length > MAX_TEXT_EFFECT_LAYERS) {
    throw new FatalError(
      "VALIDATION",
      `textStrokes supports at most ${MAX_TEXT_EFFECT_LAYERS} layers, got ${textStrokes.length} (${nid}).`,
      { stage: "validate", nodeId: nid },
    );
  }
  for (const layer of textStrokes) {
    parseColor(layer.color, { nodeId: nid });
    if (!(Number.isFinite(layer.widthPx) && layer.widthPx > 0)) {
      throw new FatalError(
        "VALIDATION",
        `textStrokes widthPx must be positive and finite, got ${layer.widthPx} (${nid}).`,
        { stage: "validate", nodeId: nid },
      );
    }
  }
}

function validateTextShadowLayers(
  textShadows: readonly TextShadowLayer[] | undefined,
  nid: string,
): void {
  if (!textShadows) {
    return;
  }
  if (textShadows.length > MAX_TEXT_EFFECT_LAYERS) {
    throw new FatalError(
      "VALIDATION",
      `textShadows supports at most ${MAX_TEXT_EFFECT_LAYERS} layers, got ${textShadows.length} (${nid}).`,
      { stage: "validate", nodeId: nid },
    );
  }
  for (const layer of textShadows) {
    parseColor(layer.color, { nodeId: nid });
    if (!(Number.isFinite(layer.dx) && Number.isFinite(layer.dy))) {
      throw new FatalError(
        "VALIDATION",
        `textShadows dx/dy must be finite, got ${layer.dx}/${layer.dy} (${nid}).`,
        { stage: "validate", nodeId: nid },
      );
    }
    if (layer.blurPx != null && !(Number.isFinite(layer.blurPx) && layer.blurPx >= 0)) {
      throw new FatalError(
        "VALIDATION",
        `textShadows blurPx must be non-negative and finite, got ${layer.blurPx} (${nid}).`,
        { stage: "validate", nodeId: nid },
      );
    }
  }
}

const TEXT_UNIT_ANIMATION_KEYS = new Set(["by", "animation", "delayStepMs", "order", "ruby"]);

function validateTextUnitAnimation(
  node: VNodeFor<"Text"> | VNodeFor<"TextOnPath">,
  nid: string,
  timelineOwner?: TimelineAuthoredDomainOwner,
): void {
  const animateUnits: unknown = node.props.animateUnits;
  if (animateUnits === undefined) {
    return;
  }
  assertAnimationRecord(animateUnits, nid, "animateUnits");
  for (const key of Object.keys(animateUnits)) {
    if (!TEXT_UNIT_ANIMATION_KEYS.has(key)) {
      throw animationValidationError(nid, `animateUnits has unsupported key "${key}"`);
    }
  }
  if (animateUnits.by !== "cluster" && animateUnits.by !== "line") {
    throw animationValidationError(nid, 'animateUnits.by must be "cluster" or "line"');
  }
  if (
    animateUnits.delayStepMs !== undefined &&
    (typeof animateUnits.delayStepMs !== "number" ||
      !Number.isFinite(animateUnits.delayStepMs) ||
      animateUnits.delayStepMs < 0)
  ) {
    throw animationValidationError(
      nid,
      "animateUnits.delayStepMs must be a non-negative finite number",
    );
  }
  if (
    animateUnits.order !== undefined &&
    animateUnits.order !== "logical" &&
    animateUnits.order !== "visual"
  ) {
    throw animationValidationError(nid, 'animateUnits.order must be "logical" or "visual"');
  }
  if (
    animateUnits.ruby !== undefined &&
    animateUnits.ruby !== "with-base" &&
    animateUnits.ruby !== "separate"
  ) {
    throw animationValidationError(nid, 'animateUnits.ruby must be "with-base" or "separate"');
  }
  validateAnimationValue(animateUnits.animation, nid, timelineOwner);
}

export function validateTextNode(
  node: VNodeFor<"Text">,
  nid: string,
  timelineOwner?: TimelineAuthoredDomainOwner,
): void {
  assertVNodeRichTextDepth(node);
  validateTextEffects(node, nid);
  validateTextUnitAnimation(node, nid, timelineOwner);
  validateTextFlow(node, nid);
  const decorationRangeCount = countTextDecorationRanges(node);
  if (decorationRangeCount > MAX_TEXT_DECORATION_RANGES) {
    throw new FatalError(
      "TEXT_DECORATION_RANGE_LIMIT",
      `Text decoration range count ${decorationRangeCount} exceeds the limit ${MAX_TEXT_DECORATION_RANGES}.`,
      { stage: "validate", nodeId: nid },
    );
  }
  if (node.props.animateUnits !== undefined && decorationRangeCount > 0) {
    throw new FatalError(
      "TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED",
      "textDecoration cannot be combined with animateUnits.",
      { stage: "validate", nodeId: nid },
    );
  }
  const inlineRectCount = countInlineRects(node);
  if (inlineRectCount > MAX_INLINE_RECTS) {
    throw new FatalError(
      "INLINE_RECT_COMPLEXITY_LIMIT",
      `InlineRect count ${inlineRectCount} exceeds the limit ${MAX_INLINE_RECTS}.`,
      { stage: "validate", nodeId: nid },
    );
  }
  for (const child of node.children) {
    if (
      typeof child !== "string" &&
      child.type !== "Inline" &&
      child.type !== "InlineBox" &&
      child.type !== "InlineRect" &&
      child.type !== "Ruby"
    ) {
      throw new FatalError(
        "VALIDATION",
        "Validation error: Text children must be strings, Inline, InlineBox, InlineRect, or Ruby only",
        { stage: "validate", nodeId: nid },
      );
    }
  }
}

const TEXT_PATH_SOURCE_BYTE_LIMIT = 1_048_576;

const TEXT_PATH_OFFSET_ABSOLUTE_LIMIT_PX = 1e12;

const TEXT_PATH_MULTILINE_PATTERN = /[\t\n\r\u2028\u2029]/u;

function textPathError(code: string, message: string, nid: string): FatalError {
  return new FatalError(code, message, { stage: "validate", nodeId: nid });
}

export function validateTextOnPathNumericProps(node: VNodeFor<"TextOnPath">, nid: string): void {
  const props = node.props as Record<string, unknown>;
  for (const key of ["width", "height", "fontSizePx"] as const) {
    const value = props[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw textPathError(
        "TEXT_PATH_INVALID",
        `TextOnPath ${key} must be positive and finite, got ${String(value)}.`,
        nid,
      );
    }
  }
  for (const key of [
    "startOffsetPx",
    "letterSpacingPx",
    "fontWeight",
    "opacity",
    "textStrokeWidth",
    "textStrokeMiterlimit",
  ] as const) {
    const value = props[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      throw textPathError(
        "TEXT_PATH_INVALID",
        `TextOnPath ${key} must be finite, got ${String(value)}.`,
        nid,
      );
    }
  }
  const pathOffsetPx = props.pathOffsetPx;
  if (
    pathOffsetPx !== undefined &&
    (typeof pathOffsetPx !== "number" || !Number.isFinite(pathOffsetPx) || pathOffsetPx < 0)
  ) {
    throw textPathError(
      "TEXT_PATH_INVALID",
      `TextOnPath pathOffsetPx must be non-negative and finite, got ${String(pathOffsetPx)}.`,
      nid,
    );
  }
  const startOffsetPx = props.startOffsetPx;
  if (
    typeof startOffsetPx === "number" &&
    Math.abs(startOffsetPx) > TEXT_PATH_OFFSET_ABSOLUTE_LIMIT_PX
  ) {
    throw textPathError(
      "TEXT_PATH_OFFSET_LIMIT",
      `TextOnPath startOffsetPx exceeds the ${TEXT_PATH_OFFSET_ABSOLUTE_LIMIT_PX}px absolute limit.`,
      nid,
    );
  }
}

function validateTextOnPathEnum(options: {
  value: unknown;
  allowedValues: readonly string[];
  propName: string;
  nid: string;
}): void {
  const { value, allowedValues, propName, nid } = options;
  if (value !== undefined && !allowedValues.some((allowedValue) => allowedValue === value)) {
    throw textPathError("TEXT_PATH_INVALID", `TextOnPath ${propName} is invalid.`, nid);
  }
}

export function validateTextOnPathNode(
  node: VNodeFor<"TextOnPath">,
  nid: string,
  timelineOwner?: TimelineAuthoredDomainOwner,
): void {
  assertVNodeRichTextDepth(node);
  const props = node.props as Record<string, unknown>;
  validateTextOnPathRootProps(props, nid);
  const text = collectTextOnPathSource(node.children, nid);
  validateTextOnPathSourceText(text, nid);
  const flattened = flattenTextOnPathRuns(node);
  const { shapingRunCount, paintRangeCount, paintedLayerEstimate } = countTextOnPathRunResources(
    flattened.runs,
  );
  if (shapingRunCount > MAX_TEXT_PATH_SHAPING_RUNS) {
    throw textPathError(
      "TEXT_PATH_RUN_LIMIT",
      `TextOnPath shaping run count exceeds the limit ${MAX_TEXT_PATH_SHAPING_RUNS}.`,
      nid,
    );
  }
  if (paintRangeCount > MAX_TEXT_PATH_PAINT_RANGES) {
    throw textPathError(
      "TEXT_PATH_PAINT_LIMIT",
      `TextOnPath paint range count exceeds the limit ${MAX_TEXT_PATH_PAINT_RANGES}.`,
      nid,
    );
  }
  if (paintedLayerEstimate > MAX_TEXT_PATH_PAINTED_LAYERS) {
    throw textPathError(
      "TEXT_PATH_PAINT_LIMIT",
      `TextOnPath painted layer estimate exceeds the limit ${MAX_TEXT_PATH_PAINTED_LAYERS}.`,
      nid,
    );
  }
  const decorationRangeCount = countTextDecorationRanges(node);
  if (decorationRangeCount > MAX_TEXT_DECORATION_RANGES) {
    throw new FatalError(
      "TEXT_DECORATION_RANGE_LIMIT",
      `Text decoration range count ${decorationRangeCount} exceeds the limit ${MAX_TEXT_DECORATION_RANGES}.`,
      { stage: "validate", nodeId: nid },
    );
  }
  const hasEffectiveDecoration = flattened.runs.some(
    (run) => run.style.textDecoration !== undefined && run.style.textDecoration !== "none",
  );
  if (node.props.animateUnits !== undefined && hasEffectiveDecoration) {
    throw new FatalError(
      "TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED",
      "textDecoration cannot be combined with animateUnits.",
      { stage: "validate", nodeId: nid },
    );
  }
  validateTextEffects(node, nid);
  validateTextUnitAnimation(node, nid, timelineOwner);
}

function validateTextOnPathRootProps(props: Record<string, unknown>, nid: string): void {
  if (props.writingMode !== undefined || props.textOrientation !== undefined) {
    throw textPathError(
      "TEXT_PATH_WRITING_MODE_UNSUPPORTED",
      "TextOnPath supports horizontal LTR text only.",
      nid,
    );
  }
  for (const key of Object.keys(props)) {
    if (!TEXT_ON_PATH_ALLOWED_PROPS.has(key)) {
      throw textPathError("TEXT_PATH_INVALID", `TextOnPath does not support prop "${key}".`, nid);
    }
  }
  if (typeof props.d !== "string" || props.d.trim() === "") {
    throw textPathError(
      "TEXT_PATH_INVALID_DATA",
      "TextOnPath d must contain one non-empty drawable SVG subpath.",
      nid,
    );
  }
  if (new TextEncoder().encode(props.d).length > TEXT_PATH_SOURCE_BYTE_LIMIT) {
    throw textPathError(
      "TEXT_PATH_SOURCE_LIMIT",
      `TextOnPath d exceeds the ${TEXT_PATH_SOURCE_BYTE_LIMIT} byte source limit.`,
      nid,
    );
  }
  validateTextOnPathEnum({
    value: props.textAnchor,
    allowedValues: ["start", "middle", "end"],
    propName: "textAnchor",
    nid,
  });
  validateTextOnPathEnum({
    value: props.pathDirection,
    allowedValues: ["forward", "reverse"],
    propName: "pathDirection",
    nid,
  });
  validateTextOnPathEnum({
    value: props.pathNormal,
    allowedValues: ["left", "right"],
    propName: "pathNormal",
    nid,
  });
  validateTextOnPathEnum({
    value: props.pathFit,
    allowedValues: ["none", "spacing", "scale", "shrink"],
    propName: "pathFit",
    nid,
  });
  validateTextOnPathEnum({
    value: props.pathOverflow,
    allowedValues: ["hidden", "error", "ellipsis"],
    propName: "pathOverflow",
    nid,
  });
}

function collectTextOnPathSource(
  children: VNodeFor<"TextOnPath">["children"],
  nid: string,
): string {
  const frames: Array<{ children: Array<string | VNode>; childIndex: number }> = [
    { children, childIndex: 0 },
  ];
  const textParts: string[] = [];
  let sourceItemCount = 0;
  let inlineCount = 0;
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (!frame || frame.childIndex >= frame.children.length) {
      frames.pop();
      continue;
    }
    const child = frame.children[frame.childIndex];
    frame.childIndex += 1;
    sourceItemCount += 1;
    if (sourceItemCount > MAX_TEXT_PATH_SOURCE_ITEMS) {
      throw textPathError(
        "TEXT_PATH_SOURCE_LIMIT",
        `TextOnPath source item count exceeds the limit ${MAX_TEXT_PATH_SOURCE_ITEMS}.`,
        nid,
      );
    }
    if (typeof child === "string") {
      textParts.push(child);
      continue;
    }
    if (!child || child.type !== "Inline") {
      throw textPathError(
        "TEXT_PATH_CHILD_UNSUPPORTED",
        "TextOnPath children must be strings or Inline nodes.",
        nid,
      );
    }
    inlineCount += 1;
    if (inlineCount > MAX_TEXT_PATH_INLINE_CONTAINERS) {
      throw textPathError(
        "TEXT_PATH_INLINE_LIMIT",
        `TextOnPath Inline count exceeds the limit ${MAX_TEXT_PATH_INLINE_CONTAINERS}.`,
        nid,
      );
    }
    frames.push({ children: child.children, childIndex: 0 });
  }
  return textParts.join("");
}

function validateTextOnPathSourceText(text: string, nid: string): void {
  if (text.length === 0) {
    throw textPathError(
      "TEXT_PATH_EMPTY_TEXT",
      "TextOnPath children must contain a non-empty string.",
      nid,
    );
  }
  if (TEXT_PATH_MULTILINE_PATTERN.test(text)) {
    throw textPathError(
      "TEXT_PATH_MULTILINE_UNSUPPORTED",
      "TextOnPath does not support newlines or tabs.",
      nid,
    );
  }
  if (new TextEncoder().encode(text).length > TEXT_PATH_SOURCE_BYTE_LIMIT) {
    throw textPathError(
      "TEXT_PATH_SOURCE_LIMIT",
      `TextOnPath text exceeds the ${TEXT_PATH_SOURCE_BYTE_LIMIT} byte source limit.`,
      nid,
    );
  }
}

const TEXT_PATH_INLINE_SHAPING_PROPS: ReadonlySet<string> = new Set([
  "font",
  "fallback",
  "fontWeight",
  "fontStyle",
  "fontVariationSettings",
  "fontFeatureSettings",
  "fontSizePx",
  "letterSpacingPx",
  "language",
  "color",
  "textStrokes",
  "textShadows",
  "textDecoration",
]);

export function validateTextOnPathInlineNode(node: VNodeFor<"Inline">, nid: string): void {
  validateTextOnPathInlineStructure(node, nid);
  validateTextOnPathInlineFontProps(node.props, nid);
  validateTextOnPathInlineMetricProps(node.props, nid);
}

function validateTextOnPathInlineStructure(node: VNodeFor<"Inline">, nid: string): void {
  for (const key of Object.keys(node.props)) {
    if (!TEXT_PATH_INLINE_SHAPING_PROPS.has(key)) {
      throw textPathError(
        "TEXT_PATH_INLINE_PROP_UNSUPPORTED",
        `TextOnPath Inline does not support prop "${key}".`,
        nid,
      );
    }
  }
  for (const child of node.children) {
    if (typeof child !== "string" && child.type !== "Inline") {
      throw textPathError(
        "TEXT_PATH_CHILD_UNSUPPORTED",
        "TextOnPath Inline children must be strings or Inline nodes.",
        nid,
      );
    }
  }
}

function validateTextOnPathInlineFontProps(props: InlineProps, nid: string): void {
  if (props.font !== undefined && (typeof props.font !== "string" || props.font.trim() === "")) {
    throw textPathError("TEXT_PATH_INVALID", "TextOnPath Inline font must be non-empty.", nid);
  }
  if (
    props.fallback !== undefined &&
    (!Array.isArray(props.fallback) ||
      props.fallback.some((alias) => typeof alias !== "string" || alias.trim() === ""))
  ) {
    throw textPathError(
      "TEXT_PATH_INVALID",
      "TextOnPath Inline fallback must contain non-empty font aliases.",
      nid,
    );
  }
  if (
    props.fontWeight !== undefined &&
    (typeof props.fontWeight !== "number" ||
      !Number.isInteger(props.fontWeight) ||
      props.fontWeight < 1 ||
      props.fontWeight > 1000)
  ) {
    throw textPathError(
      "TEXT_PATH_INVALID",
      "TextOnPath Inline fontWeight must be an integer from 1 to 1000.",
      nid,
    );
  }
  if (
    props.fontStyle !== undefined &&
    props.fontStyle !== "normal" &&
    props.fontStyle !== "italic"
  ) {
    throw textPathError("TEXT_PATH_INVALID", "TextOnPath Inline fontStyle is invalid.", nid);
  }
  for (const key of ["fontVariationSettings", "fontFeatureSettings"] as const) {
    if (props[key] !== undefined && typeof props[key] !== "string") {
      throw textPathError("TEXT_PATH_INVALID", `TextOnPath Inline ${key} must be a string.`, nid);
    }
  }
}

function validateTextOnPathInlineMetricProps(props: InlineProps, nid: string): void {
  if (
    props.fontSizePx !== undefined &&
    (typeof props.fontSizePx !== "number" ||
      !Number.isFinite(props.fontSizePx) ||
      props.fontSizePx <= 0)
  ) {
    throw textPathError(
      "TEXT_PATH_INVALID",
      "TextOnPath Inline fontSizePx must be positive and finite.",
      nid,
    );
  }
  if (
    props.letterSpacingPx !== undefined &&
    (typeof props.letterSpacingPx !== "number" || !Number.isFinite(props.letterSpacingPx))
  ) {
    throw textPathError(
      "TEXT_PATH_INVALID",
      "TextOnPath Inline letterSpacingPx must be finite.",
      nid,
    );
  }
  if (
    props.language !== undefined &&
    props.language !== "ja" &&
    props.language !== "en" &&
    props.language !== "auto"
  ) {
    throw textPathError("TEXT_PATH_INVALID", "TextOnPath Inline language is invalid.", nid);
  }
}

function countInlineRects(node: VNode): number {
  let count = node.type === "InlineRect" ? 1 : 0;
  for (const child of node.children) {
    if (typeof child !== "string") {
      count += countInlineRects(child);
    }
  }
  return count;
}

const TEXT_DECORATION_KEYS: ReadonlySet<string> = new Set([
  "line",
  "color",
  "style",
  "thicknessPx",
  "offsetPx",
  "skipInk",
]);

const TEXT_DECORATION_LINES: ReadonlySet<string> = new Set([
  "underline",
  "overline",
  "line-through",
]);

function textDecorationValidationError(nid: string, message: string): FatalError {
  return new FatalError("TEXT_DECORATION_INVALID", message, {
    stage: "validate",
    nodeId: nid,
  });
}

function validateTextDecorationLines(
  candidate: Record<string, unknown>,
  nid: string,
): ReadonlySet<string> {
  const authoredLines = Array.isArray(candidate.line) ? candidate.line : [candidate.line];
  if (authoredLines.length === 0) {
    throw textDecorationValidationError(nid, "textDecoration.line must not be empty.");
  }
  const seenLines = new Set<string>();
  for (const line of authoredLines) {
    if (typeof line !== "string" || !TEXT_DECORATION_LINES.has(line)) {
      throw textDecorationValidationError(
        nid,
        'textDecoration.line must contain only "underline", "overline", or "line-through".',
      );
    }
    if (seenLines.has(line)) {
      throw textDecorationValidationError(
        nid,
        `textDecoration.line contains duplicate value "${line}".`,
      );
    }
    seenLines.add(line);
  }
  return seenLines;
}

function validateTextDecorationNumbers(candidate: Record<string, unknown>, nid: string): void {
  if (
    candidate.thicknessPx !== undefined &&
    (typeof candidate.thicknessPx !== "number" ||
      !Number.isFinite(candidate.thicknessPx) ||
      candidate.thicknessPx <= 0)
  ) {
    throw textDecorationValidationError(
      nid,
      "textDecoration.thicknessPx must be a positive finite number.",
    );
  }
  if (
    candidate.offsetPx !== undefined &&
    (typeof candidate.offsetPx !== "number" || !Number.isFinite(candidate.offsetPx))
  ) {
    throw textDecorationValidationError(nid, "textDecoration.offsetPx must be a finite number.");
  }
}

function validateTextDecorationColor(candidate: Record<string, unknown>, nid: string): void {
  if (candidate.color === undefined) {
    return;
  }
  if (typeof candidate.color !== "string") {
    throw textDecorationValidationError(nid, "textDecoration.color must be a color string.");
  }
  try {
    parseColor(candidate.color, { nodeId: nid });
  } catch {
    throw textDecorationValidationError(nid, "textDecoration.color must be a valid color.");
  }
}

export function validateTextDecorationProp(node: VNode, nid: string): void {
  if (
    node.type !== "Text" &&
    node.type !== "TextOnPath" &&
    node.type !== "Inline" &&
    node.type !== "InlineBox" &&
    node.type !== "Rt"
  ) {
    return;
  }
  const decoration: unknown = node.props.textDecoration;
  if (decoration === undefined || decoration === "none") {
    return;
  }
  if (typeof decoration !== "object" || decoration === null || Array.isArray(decoration)) {
    throw textDecorationValidationError(
      nid,
      'textDecoration must be "none" or a decoration object.',
    );
  }
  const candidate = decoration as Record<string, unknown>;
  for (const key of Object.keys(candidate)) {
    if (!TEXT_DECORATION_KEYS.has(key)) {
      throw textDecorationValidationError(nid, `textDecoration has unsupported key "${key}".`);
    }
  }
  const lines = validateTextDecorationLines(candidate, nid);
  if (
    candidate.style !== undefined &&
    candidate.style !== "solid" &&
    candidate.style !== "double" &&
    candidate.style !== "dotted" &&
    candidate.style !== "dashed" &&
    candidate.style !== "wavy"
  ) {
    throw textDecorationValidationError(
      nid,
      'textDecoration.style must be "solid", "double", "dotted", "dashed", or "wavy".',
    );
  }
  if (
    candidate.skipInk !== undefined &&
    candidate.skipInk !== "none" &&
    candidate.skipInk !== "all"
  ) {
    throw textDecorationValidationError(nid, 'textDecoration.skipInk must be "none" or "all".');
  }
  if (candidate.skipInk === "all" && !lines.has("underline") && !lines.has("overline")) {
    throw new FatalError(
      "TEXT_DECORATION_SKIP_INK_UNSUPPORTED",
      'textDecoration.skipInk="all" requires underline or overline.',
      { stage: "validate", nodeId: nid },
    );
  }
  validateTextDecorationNumbers(candidate, nid);
  validateTextDecorationColor(candidate, nid);
}

function countTextDecorationRanges(node: VNode): number {
  const hasRange =
    (node.type === "Text" ||
      node.type === "TextOnPath" ||
      node.type === "Inline" ||
      node.type === "InlineBox" ||
      node.type === "Rt") &&
    node.props.textDecoration !== undefined &&
    node.props.textDecoration !== "none";
  let count = hasRange ? 1 : 0;
  for (const child of node.children) {
    if (typeof child !== "string") {
      count += countTextDecorationRanges(child);
    }
  }
  return count;
}

function validateTextFlow(node: VNodeFor<"Text">, nid: string): void {
  const { tabSize, flowExclusions, flowMinRegionWidthPx, fitMaxProbes, width, height } = node.props;
  if (
    tabSize !== undefined &&
    (typeof tabSize !== "number" || !Number.isInteger(tabSize) || tabSize < 1)
  ) {
    throw layoutContractError(nid, `'tabSize' must be a positive integer, got ${String(tabSize)}`);
  }
  if (
    flowMinRegionWidthPx !== undefined &&
    (typeof flowMinRegionWidthPx !== "number" ||
      !Number.isFinite(flowMinRegionWidthPx) ||
      flowMinRegionWidthPx <= 0)
  ) {
    throw layoutContractError(
      nid,
      `'flowMinRegionWidthPx' must be positive and finite, got ${String(flowMinRegionWidthPx)}`,
    );
  }
  if (
    fitMaxProbes !== undefined &&
    (typeof fitMaxProbes !== "number" || !Number.isInteger(fitMaxProbes) || fitMaxProbes < 1)
  ) {
    throw layoutContractError(
      nid,
      `'fitMaxProbes' must be a positive integer, got ${String(fitMaxProbes)}`,
    );
  }
  if (flowExclusions === undefined) {
    return;
  }
  if (!Array.isArray(flowExclusions)) {
    throw layoutContractError(nid, "'flowExclusions' must be an array");
  }
  if (flowExclusions.length === 0) {
    return;
  }
  if (
    typeof width !== "number" ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    throw layoutContractError(
      nid,
      "Text with 'flowExclusions' requires positive finite 'width' and 'height'",
    );
  }

  for (const [index, exclusion] of flowExclusions.entries()) {
    validateTextFlowExclusion(exclusion, index, nid);
  }
}

function validateTextFlowExclusion(exclusion: unknown, index: number, nid: string): void {
  if (typeof exclusion !== "object" || exclusion === null || Array.isArray(exclusion)) {
    throw layoutContractError(nid, `'flowExclusions[${index}]' must be an exclusion object`);
  }
  const candidate = exclusion as Record<string, unknown>;
  const context = { index, nid };
  switch (candidate.kind) {
    case "rect":
      assertFlowFinite(candidate.x, "x", context);
      assertFlowFinite(candidate.y, "y", context);
      assertFlowPositive(candidate.width, "width", context);
      assertFlowPositive(candidate.height, "height", context);
      break;
    case "circle":
      assertFlowFinite(candidate.cx, "cx", context);
      assertFlowFinite(candidate.cy, "cy", context);
      assertFlowPositive(candidate.r, "r", context);
      break;
    case "path":
      validateTextFlowPath(candidate, index, nid);
      break;
    default:
      throw layoutContractError(
        nid,
        `'flowExclusions[${index}].kind' must be 'rect', 'circle', or 'path'`,
      );
  }
  validateTextFlowMargin(candidate.marginPx, index, nid);
}

function validateTextFlowPath(
  candidate: Record<string, unknown>,
  index: number,
  nid: string,
): void {
  if (typeof candidate.d !== "string" || candidate.d.trim().length === 0) {
    throw layoutContractError(nid, `'flowExclusions[${index}].d' must not be empty`);
  }
  assertValidPathData(candidate.d, `${nid}:flowExclusions[${index}]`);
  const context = { index, nid };
  if (candidate.x !== undefined) {
    assertFlowFinite(candidate.x, "x", context);
  }
  if (candidate.y !== undefined) {
    assertFlowFinite(candidate.y, "y", context);
  }
  if (
    candidate.fillRule !== undefined &&
    candidate.fillRule !== "nonzero" &&
    candidate.fillRule !== "evenodd"
  ) {
    throw layoutContractError(
      nid,
      `'flowExclusions[${index}].fillRule' must be 'nonzero' or 'evenodd'`,
    );
  }
}

function validateTextFlowMargin(margin: unknown, index: number, nid: string): void {
  if (margin === undefined) {
    return;
  }
  const context = { index, nid };
  if (typeof margin === "number") {
    assertFlowNonNegative(margin, "marginPx", context);
    return;
  }
  if (typeof margin !== "object" || margin === null || Array.isArray(margin)) {
    throw layoutContractError(
      nid,
      `'flowExclusions[${index}].marginPx' must be a number or edge object`,
    );
  }
  const edges = margin as Record<string, unknown>;
  for (const side of ["top", "right", "bottom", "left"] as const) {
    if (edges[side] !== undefined) {
      assertFlowNonNegative(edges[side], `marginPx.${side}`, context);
    }
  }
}

type FlowValidationContext = { index: number; nid: string };

function assertFlowFinite(
  value: unknown,
  name: string,
  context: FlowValidationContext,
): asserts value is number {
  const { index, nid } = context;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw layoutContractError(
      nid,
      `'flowExclusions[${index}].${name}' must be finite, got ${String(value)}`,
    );
  }
}

function assertFlowPositive(value: unknown, name: string, context: FlowValidationContext): void {
  assertFlowFinite(value, name, context);
  if (value <= 0) {
    const { index, nid } = context;
    throw layoutContractError(
      nid,
      `'flowExclusions[${index}].${name}' must be positive, got ${value}`,
    );
  }
}

function assertFlowNonNegative(value: unknown, name: string, context: FlowValidationContext): void {
  assertFlowFinite(value, name, context);
  if (value < 0) {
    const { index, nid } = context;
    throw layoutContractError(
      nid,
      `'flowExclusions[${index}].${name}' must not be negative, got ${value}`,
    );
  }
}

export function validateInlineNode(node: VNodeFor<"Inline">, nid: string): void {
  for (const key of Object.keys(node.props)) {
    if (!INLINE_ALLOWED_PROPS.has(key)) {
      throw new FatalError(
        "VALIDATION",
        `Validation error: Inline does not support prop "${key}"`,
        { stage: "validate", nodeId: nid },
      );
    }
  }
  validateTextStrokeLayers(node.props.textStrokes, nid);
  validateTextShadowLayers(node.props.textShadows, nid);
  const hasDecoration =
    node.props.background !== undefined ||
    node.props.borderColor !== undefined ||
    node.props.borderWidth !== undefined ||
    node.props.borderRadius !== undefined ||
    node.props.paddingInline !== undefined;
  if (node.props.animate !== undefined && !hasDecoration) {
    throw new FatalError(
      "VALIDATION",
      'Validation error: Inline "animate" targets decoration fragments and requires a decoration prop ' +
        "(background, borderColor, borderWidth, borderRadius, or paddingInline). " +
        'Animate glyphs through the parent Text\'s "animateUnits" instead.',
      { stage: "validate", nodeId: nid },
    );
  }
  for (const child of node.children) {
    if (
      typeof child !== "string" &&
      child.type !== "Inline" &&
      child.type !== "InlineRect" &&
      child.type !== "Ruby"
    ) {
      throw new FatalError(
        "VALIDATION",
        "Validation error: Inline children must be strings, Inline, InlineRect, or Ruby only",
        { stage: "validate", nodeId: nid },
      );
    }
  }
}

export function validateInlineBoxNode(node: VNodeFor<"InlineBox">, nid: string): void {
  for (const key of Object.keys(node.props)) {
    if (!INLINE_BOX_ALLOWED_PROPS.has(key)) {
      throw new FatalError(
        "VALIDATION",
        `Validation error: InlineBox does not support prop "${key}"`,
        { stage: "validate", nodeId: nid },
      );
    }
  }
  const hasDecoration =
    node.props.background !== undefined ||
    node.props.borderColor !== undefined ||
    node.props.borderWidth !== undefined ||
    node.props.borderRadius !== undefined ||
    node.props.paddingInline !== undefined;
  if (node.props.animate !== undefined && !hasDecoration) {
    throw new FatalError(
      "VALIDATION",
      'Validation error: InlineBox "animate" targets the decoration fragment and requires a decoration prop ' +
        "(background, borderColor, borderWidth, borderRadius, or paddingInline). " +
        'Animate glyphs through the parent Text\'s "animateUnits" instead.',
      { stage: "validate", nodeId: nid },
    );
  }
  for (const child of node.children) {
    if (
      typeof child !== "string" &&
      child.type !== "Inline" &&
      child.type !== "InlineBox" &&
      child.type !== "InlineRect" &&
      child.type !== "Ruby"
    ) {
      throw new FatalError(
        "VALIDATION",
        "Validation error: InlineBox children must be strings, Inline, InlineBox, InlineRect, or Ruby only",
        { stage: "validate", nodeId: nid },
      );
    }
  }
}

function inlineRectValidationError(nid: string, message: string): FatalError {
  return new FatalError("INLINE_RECT_INVALID", message, { stage: "validate", nodeId: nid });
}

function validateInlineRectStructure(node: VNodeFor<"InlineRect">, nid: string): void {
  for (const key of Object.keys(node.props)) {
    if (!INLINE_RECT_ALLOWED_PROPS.has(key)) {
      throw inlineRectValidationError(nid, `InlineRect does not support prop "${key}".`);
    }
  }
  if (node.children.length > 0) {
    throw inlineRectValidationError(nid, "InlineRect does not accept children.");
  }
}

function validateInlineRectSizing(props: InlineRectProps, nid: string): void {
  const { inlineSizePx, blockSizePx, advancePx } = props;
  if (!Number.isFinite(inlineSizePx) || inlineSizePx <= 0) {
    throw inlineRectValidationError(nid, "inlineSizePx must be a positive finite number.");
  }
  if (
    blockSizePx !== undefined &&
    blockSizePx !== "line" &&
    (!Number.isFinite(blockSizePx) || blockSizePx <= 0)
  ) {
    throw inlineRectValidationError(nid, 'blockSizePx must be "line" or a positive finite number.');
  }
  if (advancePx !== undefined && (!Number.isFinite(advancePx) || advancePx < 0)) {
    throw inlineRectValidationError(nid, "advancePx must be a non-negative finite number.");
  }
}

function validateInlineRectPaint(props: InlineRectProps, nid: string): void {
  const { blockAlign, color, borderRadiusPx, opacity, paintOrder } = props;
  if (typeof color !== "string") {
    throw inlineRectValidationError(nid, "color must be a color string.");
  }
  try {
    parseColor(color, { nodeId: nid });
  } catch {
    throw inlineRectValidationError(nid, "color must be a valid color.");
  }
  if (blockAlign !== undefined && !["start", "center", "end"].includes(blockAlign)) {
    throw inlineRectValidationError(nid, 'blockAlign must be "start", "center", or "end".');
  }
  if (borderRadiusPx !== undefined && (!Number.isFinite(borderRadiusPx) || borderRadiusPx < 0)) {
    throw inlineRectValidationError(nid, "borderRadiusPx must be a non-negative finite number.");
  }
  if (opacity !== undefined && (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)) {
    throw inlineRectValidationError(nid, "opacity must be a finite number in the range 0..1.");
  }
  if (paintOrder !== undefined && paintOrder !== "behind" && paintOrder !== "front") {
    throw inlineRectValidationError(nid, 'paintOrder must be "behind" or "front".');
  }
}

export function validateInlineRectNode(node: VNodeFor<"InlineRect">, nid: string): void {
  validateInlineRectStructure(node, nid);
  validateInlineRectSizing(node.props, nid);
  validateInlineRectPaint(node.props, nid);
}

export function validateRubyNode(node: VNodeFor<"Ruby">, nid: string): void {
  validateRubyEnumProp({
    value: node.props.rubyPosition,
    allowedValues: RUBY_POSITION_VALUES,
    propName: "rubyPosition",
    errorMessage:
      'Validation error: Ruby "rubyPosition" must be "over", "under", "alternate", or "inter-character"',
    nid,
  });
  validateRubyEnumProp({
    value: node.props.rubyAlign,
    allowedValues: RUBY_ALIGN_VALUES,
    propName: "rubyAlign",
    errorMessage:
      'Validation error: Ruby "rubyAlign" must be "start", "center", "space-between", or "space-around"',
    nid,
  });
  validateRubyFiniteNumberProp(node.props.rubyGapPx, "rubyGapPx", nid);
  validateRubyFiniteNumberProp(node.props.rubyOffsetPx, "rubyOffsetPx", nid);
  validateRubyEnumProp({
    value: node.props.rubyLineSizing,
    allowedValues: RUBY_LINE_SIZING_VALUES,
    propName: "rubyLineSizing",
    errorMessage: 'Validation error: Ruby "rubyLineSizing" must be "stable" or "css"',
    nid,
  });

  const { rtCount, hasBaseContent } = validateRubyChildren(node, nid);

  if (rtCount < 1) {
    throw new FatalError(
      "VALIDATION",
      "Validation error: Ruby must contain at least one Rt child",
      {
        stage: "validate",
        nodeId: nid,
      },
    );
  }
  if (!hasBaseContent) {
    throw new FatalError(
      "VALIDATION",
      "Validation error: Ruby must contain base text before its Rt child",
      { stage: "validate", nodeId: nid },
    );
  }
}

function validateRubyEnumProp(options: {
  value: string | undefined;
  allowedValues: ReadonlySet<string>;
  propName: string;
  errorMessage: string;
  nid: string;
}): void {
  const { value, allowedValues, propName, errorMessage, nid } = options;
  if (value !== undefined && !allowedValues.has(value)) {
    throw new FatalError("VALIDATION", errorMessage, {
      stage: "validate",
      nodeId: nid,
      prop: propName,
    });
  }
}

function validateRubyFiniteNumberProp(
  value: number | undefined,
  propName: "rubyGapPx" | "rubyOffsetPx",
  nid: string,
): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new FatalError(
      "VALIDATION",
      `Validation error: Ruby "${propName}" must be a finite number`,
      { stage: "validate", nodeId: nid, prop: propName },
    );
  }
}

function validateRubyChildren(
  node: VNodeFor<"Ruby">,
  nid: string,
): { rtCount: number; hasBaseContent: boolean } {
  let rtCount = 0;
  let hasBaseContent = false;
  for (const child of node.children) {
    if (typeof child === "string") {
      if (child.length > 0) {
        hasBaseContent = true;
      }
      continue;
    }
    const childNode = child as unknown as VNode;
    if (childNode.type === "Rt") {
      rtCount++;
      continue;
    }
    if (childNode.type === "Inline") {
      hasBaseContent = true;
      continue;
    }
    if (childNode.type === "InlineRect") {
      throw new FatalError(
        "INLINE_RECT_INVALID_PARENT",
        "Validation error: InlineRect is only allowed inside Text, Inline, or InlineBox",
        { stage: "validate", nodeId: nid },
      );
    }
    throw new FatalError(
      "VALIDATION",
      "Validation error: Ruby children must be strings, Inline, or Rt nodes",
      { stage: "validate", nodeId: nid },
    );
  }
  return { rtCount, hasBaseContent };
}

export function validateRtNode(node: VNodeFor<"Rt">, nid: string): void {
  for (const key of Object.keys(node.props)) {
    if (!RT_ALLOWED_PROPS.has(key)) {
      throw new FatalError("VALIDATION", `Validation error: Rt does not support prop "${key}"`, {
        stage: "validate",
        nodeId: nid,
      });
    }
  }
  for (const child of node.children) {
    const childNode = child as unknown as string | VNode;
    if (typeof childNode !== "string" && childNode.type === "InlineRect") {
      throw new FatalError(
        "INLINE_RECT_INVALID_PARENT",
        "Validation error: InlineRect is only allowed inside Text, Inline, or InlineBox",
        { stage: "validate", nodeId: nid },
      );
    }
    if (typeof child !== "string" && child.type !== "Inline") {
      throw new FatalError(
        "VALIDATION",
        "Validation error: Rt children must be strings or Inline only",
        { stage: "validate", nodeId: nid },
      );
    }
  }
}
