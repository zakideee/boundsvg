import { parseColor } from "../color.js";
import {
  assertTimelineAuthoredSpecJsonRepresentable,
  type TimelineAuthoredDomainOwner,
} from "../engine/timeline-domain-transport.js";
import { FatalError } from "../errors.js";
import { getUnsafeSvgReason } from "../svg/security.js";
import { assertValidTransform2D } from "../transform.js";
import type { VNode, VNodeFor, VNodeType } from "../vnode/types.js";
import { layoutContractError, validateFiniteNumberProp } from "./layout-props.js";

const STROKE_SCALING_SUPPORTED_TYPES: ReadonlySet<VNodeType> = new Set([
  "Flex",
  "Grid",
  "Box",
  "Path",
]);

export function validateStrokeScalingProp(node: VNode, nid: string): void {
  const props = node.props as Record<string, unknown>;
  const strokeScaling = props.strokeScaling;
  if (strokeScaling === undefined) {
    return;
  }
  if (!STROKE_SCALING_SUPPORTED_TYPES.has(node.type)) {
    throw new FatalError(
      "VALIDATION",
      `Validation error: ${node.type} does not support prop "strokeScaling"`,
      { stage: "validate", nodeId: nid },
    );
  }
  if (strokeScaling !== "transform" && strokeScaling !== "canvas") {
    throw new FatalError(
      "VALIDATION",
      `Validation error: 'strokeScaling' must be "transform" or "canvas", got ${JSON.stringify(strokeScaling)} (${nid})`,
      { stage: "validate", nodeId: nid },
    );
  }
  const normalizedPathStroke = node.type === "Path" ? String(props.stroke ?? "").trim() : null;
  const hasPaintedStroke =
    normalizedPathStroke === null ||
    (normalizedPathStroke.length > 0 && normalizedPathStroke.toLowerCase() !== "none");
  if (
    strokeScaling === "canvas" &&
    hasPaintedStroke &&
    typeof props.strokeDasharray === "string" &&
    props.strokeDasharray.length > 0
  ) {
    throw new FatalError(
      "CANVAS_STROKE_DASH_UNSUPPORTED",
      'Canvas-stable strokes do not support "strokeDasharray".',
      { stage: "validate", nodeId: nid },
    );
  }
}

/** Visual numeric props whose non-finite values would be silently dropped by
 *  the JSON transport (turning `NaN`/`Infinity` into null → "unspecified"). */
const VISUAL_FINITE_NUMBER_PROPS = [
  "opacity",
  "borderWidth",
  "strokeWidth",
  "strokeMiterlimit",
  "textStrokeWidth",
  "textStrokeMiterlimit",
] as const;

function validateBorderRadiusProp(props: Record<string, unknown>, nid: string): void {
  const value = props.borderRadius;
  if (value === undefined) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw layoutContractError(nid, `'borderRadius' must be finite, got ${String(value)}`);
    }
    return;
  }
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((corner) => typeof corner !== "number" || !Number.isFinite(corner))
  ) {
    throw layoutContractError(
      nid,
      `'borderRadius' must be a finite number or a [tl, tr, br, bl] tuple of finite numbers, got ${JSON.stringify(value)}`,
    );
  }
}

function validatePartPaintNumbers(props: Record<string, unknown>, nid: string): void {
  const partPaint = props.partPaint;
  if (partPaint === undefined || typeof partPaint !== "object" || partPaint === null) {
    return;
  }
  for (const override of Object.values(partPaint as Record<string, unknown>)) {
    if (typeof override !== "object" || override === null) {
      continue;
    }
    const entry = override as Record<string, unknown>;
    for (const key of ["strokeWidth", "strokeMiterlimit"] as const) {
      const value = entry[key];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
        throw layoutContractError(
          nid,
          `partPaint '${key}' must be a finite number, got ${JSON.stringify(value)}`,
        );
      }
    }
  }
}

/** Reject non-finite visual numeric props. The JSON transport turns them into
 *  null, which the Rust IR builder reads as "unspecified" — a silent wrong
 *  render (e.g. `opacity: NaN` rendering fully opaque). */
export function validateVisualNumberProps(props: Record<string, unknown>, nid: string): void {
  for (const key of VISUAL_FINITE_NUMBER_PROPS) {
    validateFiniteNumberProp(props, key, nid);
  }
  validateBorderRadiusProp(props, nid);
  validatePartPaintNumbers(props, nid);
}

const TRANSFORM_SUPPORTED_TYPES = new Set<VNodeType>([
  "Flex",
  "Grid",
  "Box",
  "Text",
  "Image",
  "Path",
  "Svg",
  "Shape",
  "Symbol",
]);

const ANIMATION_SUPPORTED_TYPES = new Set<VNodeType>([
  ...TRANSFORM_SUPPORTED_TYPES,
  "Inline",
  "InlineBox",
  "InlineRect",
  "TextOnPath",
]);

export function validateTransformProp(node: VNode, nid: string): void {
  const transform = Reflect.get(node.props as Record<string, unknown>, "transform");
  if (transform === undefined) {
    return;
  }
  if (!TRANSFORM_SUPPORTED_TYPES.has(node.type)) {
    throw new FatalError(
      "VALIDATION",
      `Validation error: ${node.type} does not support prop "transform"`,
      { stage: "validate", nodeId: nid },
    );
  }
  assertValidTransform2D(transform, {
    code: "VALIDATION",
    stage: "validate",
    nodeId: nid,
    ownerName: node.type,
  });
}

const ANIMATION_SPEC_KEYS = new Set([
  "keyframes",
  "durationMs",
  "delayMs",
  "easing",
  "iterations",
  "fill",
]);

const ANIMATION_KEYFRAME_KEYS = new Set(["at", "opacity", "transform"]);

const ANIMATION_EASING_NAMES = new Set([
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
]);

const ANIMATION_STEP_POSITIONS = new Set(["jump-start", "jump-end", "jump-none", "jump-both"]);

const ANIMATION_STEPS_KEYS = new Set(["type", "count", "position"]);

const ANIMATION_SPRING_KEYS = new Set(["type", "stiffness", "damping", "mass"]);

/** Accepted spring parameter ranges, mirrored by the Rust validator. */
const ANIMATION_SPRING_RANGES = {
  stiffness: [1, 1000],
  damping: [1, 100],
  mass: [0.1, 10],
} as const;

export function animationValidationError(nid: string, message: string): FatalError {
  return new FatalError("ANIMATION_INVALID_SPEC", `Invalid animation: ${message} (${nid}).`, {
    stage: "validate",
    nodeId: nid,
  });
}

export function assertAnimationRecord(
  value: unknown,
  nid: string,
  owner: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw animationValidationError(nid, `${owner} must be an object`);
  }
}

function validateAnimationSteps(easing: unknown, nid: string): void {
  assertAnimationRecord(easing, nid, "easing");
  for (const key of Object.keys(easing)) {
    if (!ANIMATION_STEPS_KEYS.has(key)) {
      throw animationValidationError(nid, `steps easing has unsupported key "${key}"`);
    }
  }
  if (easing.type !== "steps") {
    throw animationValidationError(nid, 'steps easing type must be "steps"');
  }
  if (
    typeof easing.count !== "number" ||
    !Number.isFinite(easing.count) ||
    !Number.isInteger(easing.count) ||
    easing.count <= 0
  ) {
    throw animationValidationError(nid, "steps easing count must be a positive integer");
  }
  if (
    easing.position !== undefined &&
    (typeof easing.position !== "string" || !ANIMATION_STEP_POSITIONS.has(easing.position))
  ) {
    throw animationValidationError(nid, `unsupported steps easing position "${easing.position}"`);
  }
  if (easing.position === "jump-none" && easing.count < 2) {
    throw animationValidationError(nid, "steps easing with jump-none requires count >= 2");
  }
}

function validateAnimationSpring(easing: unknown, nid: string): void {
  assertAnimationRecord(easing, nid, "easing");
  for (const key of Object.keys(easing)) {
    if (!ANIMATION_SPRING_KEYS.has(key)) {
      throw animationValidationError(nid, `spring easing has unsupported key "${key}"`);
    }
  }
  if (easing.type !== "spring") {
    throw animationValidationError(nid, 'spring easing type must be "spring"');
  }
  for (const [field, [min, max]] of Object.entries(ANIMATION_SPRING_RANGES)) {
    const value = easing[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw animationValidationError(nid, `spring easing ${field} must be in ${min}..${max}`);
    }
  }
}

function validateAnimationCubicBezier(easing: unknown[], nid: string): void {
  if (easing.length !== 4) {
    throw animationValidationError(
      nid,
      "easing must be a named easing, cubic-bezier tuple, spring object, or steps object",
    );
  }
  for (const [index, value] of easing.entries()) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw animationValidationError(nid, `easing[${index}] must be a finite number`);
    }
  }
  const x1 = easing[0];
  const x2 = easing[2];
  if (typeof x1 !== "number" || typeof x2 !== "number" || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw animationValidationError(nid, "cubic-bezier x coordinates must be in 0..1");
  }
}

function validateAnimationEasing(easing: unknown, nid: string): void {
  if (easing === undefined) {
    return;
  }
  if (typeof easing === "string") {
    if (!ANIMATION_EASING_NAMES.has(easing)) {
      throw animationValidationError(nid, `unsupported easing "${easing}"`);
    }
    return;
  }
  if (!Array.isArray(easing)) {
    assertAnimationRecord(easing, nid, "easing");
    // `steps` stays the fallback so an unknown discriminant keeps its message.
    if (easing.type === "spring") {
      validateAnimationSpring(easing, nid);
    } else {
      validateAnimationSteps(easing, nid);
    }
    return;
  }
  validateAnimationCubicBezier(easing, nid);
}

function validateAnimationTransform(transform: unknown, nid: string, frameIndex: number): void {
  assertValidTransform2D(transform, {
    code: "ANIMATION_INVALID_SPEC",
    stage: "validate",
    nodeId: nid,
    ownerName: `animation keyframe ${frameIndex}`,
  });
  if (transform?.originX !== undefined || transform?.originY !== undefined) {
    throw animationValidationError(
      nid,
      `keyframe ${frameIndex} transform uses a custom origin; animation origins are fixed to the node center`,
    );
  }
}

function validateAnimationSpecOptions(
  animation: Record<string, unknown>,
  nid: string,
  timelineOwner?: TimelineAuthoredDomainOwner,
): void {
  for (const key of Object.keys(animation)) {
    if (!ANIMATION_SPEC_KEYS.has(key)) {
      throw animationValidationError(nid, `unsupported spec key "${key}"`);
    }
  }

  const { durationMs, delayMs, easing, iterations, fill } = animation;
  if (
    typeof durationMs !== "number" ||
    (timelineOwner === undefined && (!Number.isFinite(durationMs) || durationMs <= 0))
  ) {
    throw animationValidationError(nid, "durationMs must be a positive finite number");
  }
  if (
    delayMs !== undefined &&
    (typeof delayMs !== "number" || (timelineOwner === undefined && !Number.isFinite(delayMs)))
  ) {
    throw animationValidationError(nid, "delayMs must be a finite number");
  }
  validateAnimationEasing(easing, nid);
  if (
    iterations !== undefined &&
    iterations !== "infinite" &&
    (typeof iterations !== "number" ||
      (timelineOwner === undefined && (!Number.isFinite(iterations) || iterations <= 0)))
  ) {
    throw animationValidationError(nid, 'iterations must be positive or "infinite"');
  }
  if (fill !== undefined && fill !== "none" && fill !== "both") {
    throw animationValidationError(nid, 'fill must be "none" or "both"');
  }
  if (timelineOwner !== undefined) {
    assertTimelineAuthoredSpecJsonRepresentable({ durationMs, delayMs, iterations }, timelineOwner);
  }
}

type AnimationTargets = {
  opacity: boolean;
  transform: boolean;
};

function validateAnimationKeyframe(options: {
  keyframe: unknown;
  nid: string;
  frameIndex: number;
  previousAt: number;
}): { at: number; targets: AnimationTargets } {
  const { keyframe, nid, frameIndex, previousAt } = options;
  assertAnimationRecord(keyframe, nid, `keyframe ${frameIndex}`);
  for (const key of Object.keys(keyframe)) {
    if (!ANIMATION_KEYFRAME_KEYS.has(key)) {
      throw animationValidationError(nid, `keyframe ${frameIndex} has unsupported key "${key}"`);
    }
  }

  const { at, opacity, transform } = keyframe;
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0 || at > 1) {
    throw animationValidationError(nid, `keyframe ${frameIndex} at must be in 0..1`);
  }
  if (at <= previousAt) {
    throw animationValidationError(nid, "keyframe at values must be strictly increasing");
  }
  if (
    opacity !== undefined &&
    (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity < 0 || opacity > 1)
  ) {
    throw animationValidationError(nid, `keyframe ${frameIndex} opacity must be in 0..1`);
  }
  if (transform !== undefined) {
    validateAnimationTransform(transform, nid, frameIndex);
  }

  return {
    at,
    targets: {
      opacity: opacity !== undefined,
      transform: transform !== undefined,
    },
  };
}

function assertAnimationTargetsComplete(
  keyframes: unknown[],
  targets: AnimationTargets,
  nid: string,
): void {
  if (!targets.opacity && !targets.transform) {
    throw animationValidationError(nid, "keyframes must animate opacity or transform");
  }
  for (const [frameIndex, keyframe] of keyframes.entries()) {
    assertAnimationRecord(keyframe, nid, `keyframe ${frameIndex}`);
    if (targets.opacity && keyframe.opacity === undefined) {
      throw animationValidationError(
        nid,
        `keyframe ${frameIndex} must define opacity because the animation targets opacity`,
      );
    }
    if (targets.transform && keyframe.transform === undefined) {
      throw animationValidationError(
        nid,
        `keyframe ${frameIndex} must define transform because the animation targets transform`,
      );
    }
  }
}

export function validateAnimationProp(
  node: VNode,
  nid: string,
  timelineOwner?: TimelineAuthoredDomainOwner,
): void {
  const animation = Reflect.get(node.props as Record<string, unknown>, "animate");
  if (animation === undefined) {
    return;
  }
  if (!ANIMATION_SUPPORTED_TYPES.has(node.type)) {
    throw animationValidationError(nid, `${node.type} does not support prop "animate"`);
  }
  validateAnimationValue(animation, nid, timelineOwner);
}

export function validateAnimationValue(
  animation: unknown,
  nid: string,
  timelineOwner?: TimelineAuthoredDomainOwner,
): void {
  assertAnimationRecord(animation, nid, "spec");
  validateAnimationSpecOptions(animation, nid, timelineOwner);

  const { keyframes } = animation;
  if (!Array.isArray(keyframes) || keyframes.length < 2) {
    throw animationValidationError(nid, "keyframes must contain at least two entries");
  }

  let previousAt = -Infinity;
  const targets: AnimationTargets = { opacity: false, transform: false };
  for (const [frameIndex, keyframe] of keyframes.entries()) {
    const result = validateAnimationKeyframe({ keyframe, nid, frameIndex, previousAt });
    previousAt = result.at;
    targets.opacity ||= result.targets.opacity;
    targets.transform ||= result.targets.transform;
  }
  assertAnimationTargetsComplete(keyframes, targets, nid);
}

export function validateImageNode(node: VNodeFor<"Image">, nid: string): void {
  if (node.children.length > 0) {
    throw new FatalError("VALIDATION", "Validation error: Image must not have children", {
      stage: "validate",
      nodeId: nid,
    });
  }
  // Binary src cannot be embedded (or survive a SceneDocument round-trip)
  // without knowing its media type; it used to silently become src: "".
  if (node.props.src instanceof Uint8Array && !node.props.mediaType) {
    throw new FatalError(
      "VALIDATION",
      "Validation error: Image with a Uint8Array 'src' requires 'mediaType'",
      { stage: "validate", nodeId: nid },
    );
  }
  if (typeof node.props.width !== "number") {
    throw new FatalError("VALIDATION", "Validation error: Image requires a 'width' prop", {
      stage: "validate",
      nodeId: nid,
    });
  }
  if (typeof node.props.height !== "number") {
    throw new FatalError("VALIDATION", "Validation error: Image requires a 'height' prop", {
      stage: "validate",
      nodeId: nid,
    });
  }
}

/** Required argument count per SVG path command (repeated groups allowed). */
const PATH_COMMAND_ARITY = new Map<string, number>([
  ["M", 2],
  ["L", 2],
  ["T", 2],
  ["H", 1],
  ["V", 1],
  ["C", 6],
  ["S", 4],
  ["Q", 4],
  ["A", 7],
  ["Z", 0],
]);

const PATH_TOKEN_PATTERN =
  /([MmZzLlHhVvCcSsQqTtAa])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([\s,]+)|(.)/g;

/**
 * Consume the full SVG path grammar. An unparseable `d` used to pass
 * validation and render as an empty path — success reported, nothing drawn.
 */
export function assertValidPathData(d: string, nid: string): void {
  const fail = (reason: string): never => {
    throw new FatalError("VALIDATION", `Validation error: Path 'd' ${reason} (${nid})`, {
      stage: "validate",
      nodeId: nid,
    });
  };

  if (d.trim() === "") {
    fail("must not be blank");
  }

  let currentCommand: string | null = null;
  let argCount = 0;
  const closeCommand = (): void => {
    if (currentCommand === null) {
      return;
    }
    const arity = PATH_COMMAND_ARITY.get(currentCommand.toUpperCase()) ?? 0;
    if (arity === 0 ? argCount !== 0 : argCount === 0 || argCount % arity !== 0) {
      fail(`command "${currentCommand}" has an incomplete argument group (${argCount} numbers)`);
    }
  };

  PATH_TOKEN_PATTERN.lastIndex = 0;
  let match = PATH_TOKEN_PATTERN.exec(d);
  while (match !== null) {
    const [, command, number, , invalid] = match;
    if (invalid !== undefined) {
      fail(`contains an invalid character ${JSON.stringify(invalid)}`);
    }
    if (command !== undefined) {
      if (currentCommand === null && command.toUpperCase() !== "M") {
        fail(`must start with a moveto command, got "${command}"`);
      }
      closeCommand();
      currentCommand = command;
      argCount = 0;
    } else if (number !== undefined) {
      if (currentCommand === null) {
        fail("must start with a moveto command");
      }
      argCount += 1;
    }
    match = PATH_TOKEN_PATTERN.exec(d);
  }
  closeCommand();
  if (currentCommand === null) {
    fail("contains no commands");
  }
}

export function validatePathNode(node: VNodeFor<"Path">, nid: string): void {
  if (node.children.length > 0) {
    throw new FatalError("VALIDATION", "Validation error: Path must not have children", {
      stage: "validate",
      nodeId: nid,
    });
  }
  if (typeof node.props.d !== "string" || node.props.d === "") {
    throw new FatalError("VALIDATION", "Validation error: Path requires a non-empty 'd' prop", {
      stage: "validate",
      nodeId: nid,
    });
  }
  assertValidPathData(node.props.d, nid);
  if (typeof node.props.width !== "number") {
    throw new FatalError("VALIDATION", "Validation error: Path requires a 'width' prop", {
      stage: "validate",
      nodeId: nid,
    });
  }
  if (typeof node.props.height !== "number") {
    throw new FatalError("VALIDATION", "Validation error: Path requires a 'height' prop", {
      stage: "validate",
      nodeId: nid,
    });
  }
}

export function validateSvgNode(node: VNodeFor<"Svg">, nid: string): void {
  if (node.children.length > 0) {
    throw new FatalError("VALIDATION", "Validation error: Svg must not have children", {
      stage: "validate",
      nodeId: nid,
    });
  }
  if (typeof node.props.content !== "string" || node.props.content === "") {
    throw new FatalError(
      "VALIDATION",
      "Validation error: Svg requires a non-empty 'content' prop",
      { stage: "validate", nodeId: nid },
    );
  }
  const unsafeReason = getUnsafeSvgReason(node.props.content);
  if (unsafeReason) {
    throw new FatalError(
      "VALIDATION",
      `Validation error: Svg content contains disallowed markup (${unsafeReason})`,
      { stage: "validate", nodeId: nid },
    );
  }
  if (typeof node.props.width !== "number") {
    throw new FatalError("VALIDATION", "Validation error: Svg requires a 'width' prop", {
      stage: "validate",
      nodeId: nid,
    });
  }
  if (typeof node.props.height !== "number") {
    throw new FatalError("VALIDATION", "Validation error: Svg requires a 'height' prop", {
      stage: "validate",
      nodeId: nid,
    });
  }
}

export function validateShapeNode(node: VNodeFor<"Shape">, nid: string): void {
  if (node.children.length > 0) {
    throw new FatalError("VALIDATION", "Validation error: Shape must not have children", {
      stage: "validate",
      nodeId: nid,
    });
  }
  if (typeof node.props.width !== "number") {
    throw new FatalError("VALIDATION", "Validation error: Shape requires a 'width' prop", {
      stage: "validate",
      nodeId: nid,
    });
  }
  if (typeof node.props.height !== "number") {
    throw new FatalError("VALIDATION", "Validation error: Shape requires a 'height' prop", {
      stage: "validate",
      nodeId: nid,
    });
  }
  if (!node.props.geometry && !node.props.geometryId) {
    throw new FatalError(
      "VALIDATION",
      "Validation error: Shape requires either 'geometry' or 'geometryId'",
      { stage: "validate", nodeId: nid },
    );
  }
}

export function validateSymbolNode(node: VNodeFor<"Symbol">, nid: string): void {
  if (node.children.length > 0) {
    throw new FatalError("VALIDATION", "Validation error: Symbol must not have children", {
      stage: "validate",
      nodeId: nid,
    });
  }
  if (typeof node.props.width !== "number") {
    throw new FatalError("VALIDATION", "Validation error: Symbol requires a 'width' prop", {
      stage: "validate",
      nodeId: nid,
    });
  }
  if (typeof node.props.height !== "number") {
    throw new FatalError("VALIDATION", "Validation error: Symbol requires a 'height' prop", {
      stage: "validate",
      nodeId: nid,
    });
  }
  if (!node.props.symbol && !node.props.symbolId) {
    throw new FatalError(
      "VALIDATION",
      "Validation error: Symbol requires either 'symbol' or 'symbolId'",
      { stage: "validate", nodeId: nid },
    );
  }
}

export function validateColorProp(
  node: VNode,
  prop: string,
  options: { nodeId: string; allowNone?: boolean; allowGradient?: boolean },
): void {
  const value: unknown =
    prop in node.props ? node.props[prop as keyof typeof node.props] : undefined;
  if (typeof value === "string") {
    if (options.allowNone && value.trim().toLowerCase() === "none") {
      return;
    }
    if (options.allowGradient) {
      const lower = value.trim().toLowerCase();
      if (lower.startsWith("linear-gradient(") || lower.startsWith("radial-gradient(")) {
        return;
      }
    }
    // parseColor throws on invalid format
    parseColor(value, { nodeId: options.nodeId });
  }
}
