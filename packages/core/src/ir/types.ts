import type { RecoverableError, SerializedRecoverableError } from "../errors.js";
import type {
  BBox as GeneratedBBox,
  BorderRadii as GeneratedBorderRadii,
  HandlersRef as GeneratedHandlersRef,
  IrNode as GeneratedIrNode,
  ShapePathPart as GeneratedShapePathPart,
  GeneratedStructuralIr,
  TextUnitAnimationSample as GeneratedTextUnitAnimationSample,
} from "../generated/ir/structural-ir.js";

/** Axis-aligned bounding box in the generated public output contract. */
export type BBox = GeneratedBBox;

/** One baked part of a shape IR node. */
export type ShapePathPart = GeneratedShapePathPart;

/** Per-corner border radius. */
export type BorderRadii = GeneratedBorderRadii;

/** Event handler references retained in public output IR. */
export type HandlersRef = GeneratedHandlersRef;

/** Intermediate Representation node, discriminated by `type`. */
export type IRNode = GeneratedIrNode;

/** Public IR node discriminants. */
export type IRNodeType = IRNode["type"];

/** Container group IR node. */
export type IRGroupNode = Extract<IRNode, { type: "group" }>;

/** Filled or stroked rectangle IR node. */
export type IRRectNode = Extract<IRNode, { type: "rect" }>;

/** Line-broken text IR node. */
export type IRTextNode = Extract<IRNode, { type: "text" }>;

/** Raster image IR node. */
export type IRImageNode = Extract<IRNode, { type: "image" }>;

/** SVG path IR node. */
export type IRPathNode = Extract<IRNode, { type: "path" }>;

/** Nested SVG IR node. */
export type IRSvgNode = Extract<IRNode, { type: "svg" }>;

/** Structural shape IR node with viewport-baked part paths. */
export type IRShapeNode = Extract<IRNode, { type: "shape" }>;

/** Actual outline bounds and sampled post-layout pose for one text paint unit. */
export type IRTextUnitAnimationSample = GeneratedTextUnitAnimationSample;

/**
 * Complete public IR for a rendered tree.
 *
 * Structural fields come from Rust's serialize-direction schema. Raw wire
 * warnings are the one semantic projection: the Engine rehydrates them into
 * `RecoverableError` instances before returning IR to callers.
 */
// biome-ignore lint/style/useNamingConvention: IR is a well-known abbreviation for Intermediate Representation
export type IR = GeneratedStructuralIr & {
  warnings: RecoverableError[];
};

/** JSON-safe public IR with serialized recoverable diagnostics. */
export type SerializedIR = GeneratedStructuralIr & {
  warnings: SerializedRecoverableError[];
};
