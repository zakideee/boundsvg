import { RecoverableError } from "../errors.js";
import type {
  BBox,
  BorderRadii,
  HandlersRef,
  IR,
  IRGroupNode,
  IRImageNode,
  IRNode,
  IRPathNode,
  IRRectNode,
  IRShapeNode,
  IRSvgNode,
  IRTextNode,
  ShapePathPart,
} from "./types.js";

type IRAnimationSpec = NonNullable<IRGroupNode["animation"]>;
type IRAnimationEasing = NonNullable<IRAnimationSpec["easing"]>;
type IRLine = IRTextNode["lines"][number];
type IRLineFragment = NonNullable<IRLine["fragments"]>[number];
type IRPositionedGlyph = NonNullable<IRLine["positionedGlyphs"]>[number];
type IRTextRunStyle = NonNullable<IRLineFragment["style"]>;
type IRTextOutlinePath = NonNullable<IRTextNode["glyphPaths"]>[number];
type IRTextDecorationFragment = NonNullable<IRTextNode["textDecorations"]>[number];
type IRTextStrokeLayer = NonNullable<IRTextNode["strokes"]>[number];
type IRTextShadowLayer = NonNullable<IRTextNode["shadows"]>[number];
type IRTextUnitAnimation = NonNullable<IRTextNode["unitAnimation"]>;

function cloneBBox(bbox: BBox): BBox {
  return { ...bbox };
}

function cloneBorderRadii(borderRadii: BorderRadii): BorderRadii {
  return { ...borderRadii };
}

function cloneHandlers(handlers: HandlersRef | undefined): HandlersRef | undefined {
  return handlers ? { ...handlers } : undefined;
}

function cloneTextStrokes(
  strokes: readonly IRTextStrokeLayer[] | undefined,
): IRTextStrokeLayer[] | undefined {
  return strokes?.map((stroke) => ({ ...stroke }));
}

function cloneTextShadows(
  shadows: readonly IRTextShadowLayer[] | undefined,
): IRTextShadowLayer[] | undefined {
  return shadows?.map((shadow) => ({ ...shadow }));
}

function cloneAnimationEasing(easing: IRAnimationEasing): IRAnimationEasing {
  if (typeof easing === "string") {
    return easing;
  }
  if ("type" in easing) {
    return { ...easing };
  }
  return [easing[0], easing[1], easing[2], easing[3]];
}

/** Clone the nested mutable values of an IR-retained animation specification. */
export function cloneAnimationSpecForIR(animation: IRAnimationSpec): IRAnimationSpec {
  return {
    ...animation,
    keyframes: animation.keyframes.map((keyframe) => ({
      ...keyframe,
      ...(keyframe.transform ? { transform: { ...keyframe.transform } } : {}),
    })),
    ...(animation.easing ? { easing: cloneAnimationEasing(animation.easing) } : {}),
  };
}

function cloneTextUnitAnimation(animation: IRTextUnitAnimation): IRTextUnitAnimation {
  return {
    ...animation,
    animation: cloneAnimationSpecForIR(animation.animation),
  };
}

function cloneTextRunStyle(style: IRTextRunStyle): IRTextRunStyle {
  return {
    ...style,
    ...(style.fallback ? { fallback: [...style.fallback] } : {}),
    ...(style.textStrokes ? { textStrokes: cloneTextStrokes(style.textStrokes) } : {}),
    ...(style.textShadows ? { textShadows: cloneTextShadows(style.textShadows) } : {}),
  };
}

function clonePositionedGlyph(glyph: IRPositionedGlyph): IRPositionedGlyph {
  return {
    ...glyph,
    ...(glyph.fontFallback ? { fontFallback: [...glyph.fontFallback] } : {}),
    ...(glyph.textStrokes ? { textStrokes: cloneTextStrokes(glyph.textStrokes) } : {}),
    ...(glyph.textShadows ? { textShadows: cloneTextShadows(glyph.textShadows) } : {}),
  };
}

function cloneLine(line: IRLine): IRLine {
  return {
    ...line,
    glyphs: line.glyphs.map((glyph) => ({ ...glyph })),
    ...(line.fragments
      ? {
          fragments: line.fragments.map((fragment) => ({
            ...fragment,
            glyphs: fragment.glyphs.map((glyph) => ({ ...glyph })),
            ...(fragment.style ? { style: cloneTextRunStyle(fragment.style) } : {}),
          })),
        }
      : {}),
    ...(line.positionedGlyphs
      ? { positionedGlyphs: line.positionedGlyphs.map(clonePositionedGlyph) }
      : {}),
  };
}

function cloneTextOutlinePath(path: IRTextOutlinePath): IRTextOutlinePath {
  return {
    ...path,
    glyphIds: [...path.glyphIds],
    bbox: { ...path.bbox },
    ...(path.strokes ? { strokes: cloneTextStrokes(path.strokes) } : {}),
    ...(path.shadows ? { shadows: cloneTextShadows(path.shadows) } : {}),
  };
}

function cloneTextDecorationFragment(
  decoration: IRTextDecorationFragment,
): IRTextDecorationFragment {
  return {
    ...decoration,
    paths: decoration.paths.map((path) => ({ ...path })),
  };
}

function cloneShapePathPart(part: ShapePathPart): ShapePathPart {
  return {
    ...part,
    ...(part.bounds ? { bounds: { ...part.bounds } } : {}),
    ...(part.paint ? { paint: { ...part.paint } } : {}),
  };
}

function cloneIRGroupForLayeredTransform(node: IRGroupNode): IRGroupNode {
  return {
    ...node,
    bbox: cloneBBox(node.bbox),
    ...(node.children ? { children: node.children.map(cloneIRForLayeredTransform) } : {}),
    ...(node.transform ? { transform: { ...node.transform } } : {}),
    ...(node.animation ? { animation: cloneAnimationSpecForIR(node.animation) } : {}),
    ...(node.meta ? { meta: { ...node.meta } } : {}),
    ...(node.boxShadow ? { boxShadow: { ...node.boxShadow } } : {}),
    ...(node.clipPath ? { clipPath: cloneBBox(node.clipPath) } : {}),
    ...(node.clipBorderRadius && typeof node.clipBorderRadius === "object"
      ? { clipBorderRadius: cloneBorderRadii(node.clipBorderRadius) }
      : {}),
    ...(node.on ? { on: cloneHandlers(node.on) } : {}),
  };
}

function cloneIRRectForLayeredTransform(node: IRRectNode): IRRectNode {
  return {
    ...node,
    bbox: cloneBBox(node.bbox),
    ...(node.gradient?.type === "linear"
      ? {
          gradient: {
            type: "linear" as const,
            angle: node.gradient.angle,
            stops: node.gradient.stops.map((stop) => ({ ...stop })),
          },
        }
      : {}),
    ...(node.gradient?.type === "radial"
      ? {
          gradient: {
            type: "radial" as const,
            ...(node.gradient.geometry ? { geometry: { ...node.gradient.geometry } } : {}),
            stops: node.gradient.stops.map((stop) => ({ ...stop })),
          },
        }
      : {}),
    ...(node.borderRadius && typeof node.borderRadius === "object"
      ? { borderRadius: cloneBorderRadii(node.borderRadius) }
      : {}),
  };
}

function cloneIRTextForLayeredTransform(node: IRTextNode): IRTextNode {
  return {
    ...node,
    bbox: cloneBBox(node.bbox),
    lines: node.lines.map(cloneLine),
    ...(node.fontFallback ? { fontFallback: [...node.fontFallback] } : {}),
    layoutBox: cloneBBox(node.layoutBox),
    ...(node.textPath ? { textPath: { ...node.textPath } } : {}),
    ...(node.glyphPaths ? { glyphPaths: node.glyphPaths.map(cloneTextOutlinePath) } : {}),
    ...(node.unitMap
      ? {
          unitMap: {
            ...node.unitMap,
            units: node.unitMap.units.map((unit) => ({
              ...unit,
              members: unit.members.map((member) => ({ ...member })),
            })),
          },
        }
      : {}),
    ...(node.unitAnimation ? { unitAnimation: cloneTextUnitAnimation(node.unitAnimation) } : {}),
    ...(node.unitAnimationSamples
      ? {
          unitAnimationSamples: node.unitAnimationSamples.map((sample) => ({
            ...sample,
            ...(sample.bbox ? { bbox: cloneBBox(sample.bbox) } : {}),
            ...(sample.transform ? { transform: { ...sample.transform } } : {}),
          })),
        }
      : {}),
    ...(node.strokes ? { strokes: cloneTextStrokes(node.strokes) } : {}),
    ...(node.shadows ? { shadows: cloneTextShadows(node.shadows) } : {}),
    ...(node.textDecorations
      ? { textDecorations: node.textDecorations.map(cloneTextDecorationFragment) }
      : {}),
    ...(node.on ? { on: cloneHandlers(node.on) } : {}),
  };
}

function cloneIRImageForLayeredTransform(node: IRImageNode): IRImageNode {
  return {
    ...node,
    bbox: cloneBBox(node.bbox),
    ...(node.on ? { on: cloneHandlers(node.on) } : {}),
  };
}

function cloneIRPathForLayeredTransform(node: IRPathNode): IRPathNode {
  return {
    ...node,
    bbox: cloneBBox(node.bbox),
    ...(node.on ? { on: cloneHandlers(node.on) } : {}),
  };
}

function cloneIRSvgForLayeredTransform(node: IRSvgNode): IRSvgNode {
  return {
    ...node,
    bbox: cloneBBox(node.bbox),
    ...(node.on ? { on: cloneHandlers(node.on) } : {}),
  };
}

function cloneIRShapeForLayeredTransform(node: IRShapeNode): IRShapeNode {
  return {
    ...node,
    bbox: cloneBBox(node.bbox),
    shapeParts: node.shapeParts.map(cloneShapePathPart),
    ...(node.on ? { on: cloneHandlers(node.on) } : {}),
  };
}

/**
 * Deep-clone an IR node before layered extraction adds transform ancestors.
 * No mutable object or array in the source node is shared with the result.
 */
export function cloneIRForLayeredTransform(node: IRNode): IRNode {
  switch (node.type) {
    case "group":
      return cloneIRGroupForLayeredTransform(node);
    case "rect":
      return cloneIRRectForLayeredTransform(node);
    case "text":
      return cloneIRTextForLayeredTransform(node);
    case "image":
      return cloneIRImageForLayeredTransform(node);
    case "path":
      return cloneIRPathForLayeredTransform(node);
    case "svg":
      return cloneIRSvgForLayeredTransform(node);
    case "shape":
      return cloneIRShapeForLayeredTransform(node);
  }
}

export function cloneRecoverableError(warning: RecoverableError): RecoverableError {
  return RecoverableError.fromSerialized(warning.toJSON());
}

/**
 * Deep-clone a complete public IR for detached inspection.
 *
 * Every mutable node field, draw-order entry, warning instance, and nested
 * warning context belongs exclusively to the returned snapshot.
 */
export function cloneIR(ir: IR): IR {
  return {
    root: cloneIRForLayeredTransform(ir.root),
    drawOrder: [...ir.drawOrder],
    width: ir.width,
    height: ir.height,
    ...(ir.debug === undefined ? {} : { debug: ir.debug }),
    warnings: ir.warnings.map(cloneRecoverableError),
  };
}

function cloneRenderMutableNode(node: IRNode): IRNode {
  if (node.type === "group") {
    return {
      ...node,
      ...(node.children ? { children: node.children.map(cloneRenderMutableNode) } : {}),
    };
  }
  if (node.type === "text") {
    return {
      ...node,
      ...(node.glyphPaths ? { glyphPaths: node.glyphPaths.map(cloneTextOutlinePath) } : {}),
      ...(node.unitAnimationSamples
        ? {
            unitAnimationSamples: node.unitAnimationSamples.map((sample) => ({
              ...sample,
              ...(sample.bbox ? { bbox: cloneBBox(sample.bbox) } : {}),
              ...(sample.transform ? { transform: { ...sample.transform } } : {}),
            })),
          }
        : {}),
    };
  }
  return { ...node };
}

/**
 * Clone only the mutation set used by compiled-scene rendering:
 * `glyphPaths`, `unitAnimationSamples`, and the top-level `warnings` array.
 * Other nested IR values are read-only during render and intentionally shared.
 * If a render path starts mutating another field, extend this clone and its
 * contract tests before adding that mutation.
 */
export function cloneRenderMutableIR(ir: IR): IR {
  return {
    root: cloneRenderMutableNode(ir.root),
    drawOrder: ir.drawOrder,
    width: ir.width,
    height: ir.height,
    ...(ir.debug === undefined ? {} : { debug: ir.debug }),
    warnings: [...ir.warnings],
  };
}
