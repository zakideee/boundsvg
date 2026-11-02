import type { Engine, EngineInput, RenderIrOptions } from "./engine.js";
import type { RecoverableError } from "./errors.js";
import { buildIRSourceIndex, type IRSourceIndex, type IRSourceRef } from "./ir/source-index.js";
import type { TextMap } from "./ir/text-map.js";
import type { IR, IRGroupNode, IRNode, IRNodeType, IRTextNode } from "./ir/types.js";
import type { LayoutNode, LayoutResult } from "./layout/types.js";
import type { NodeIdValidationResult } from "./node-ids.js";
import { validateNodeIds } from "./node-ids.js";
import { resolveSceneOrVNodeInput } from "./scene/from-vnode.js";
import { buildTextMap } from "./scene.js";
import {
  applyAffineMatrixToPoint,
  createIdentityAffineMatrix,
  createResolvedTransformMatrix,
  hasTransform,
  multiplyAffineMatrices,
  type Point2D,
} from "./transform.js";

/** Axis-aligned rectangle in the coordinate space named by its inspection field. */
export type InspectionRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Layout-box corners in canvas coordinates, ordered top-left, top-right, bottom-right, bottom-
 * left.
 */
export type InspectionTransformBox = {
  points: [Point2D, Point2D, Point2D, Point2D];
};

/** A flattened bounding box entry for one rendered IR node. */
export type InspectionBBox = {
  nodeId: string;
  type: IRNodeType;
  nodeIndex: number;
  source: IRSourceRef;
  ownership: IRNode["ownership"];
  depth: number;
  /** Primitive ordinal in tree order; groups have no paint order. */
  paintOrder: number | null;
  /** The IR bbox before applying this node's or any ancestor transform. */
  layoutBBox: InspectionRect;
  /** Four layout-box corners after composing this node's and all ancestor transforms. */
  transformBox: InspectionTransformBox;
  /** Canvas-space axis-aligned bbox enclosing transformBox. */
  visualBBox: InspectionRect;
  origin: Point2D | null;
  hasOwnTransform: boolean;
};

/** Aggregate counters for a rendered scene inspection. */
export type InspectionStats = {
  width: number;
  height: number;
  nodeCount: number;
  drawNodeCount: number;
  textNodeCount: number;
  handlerNodeCount: number;
  missingGlyphCount: number;
  overflowTextNodeCount: number;
  warningCount: number;
  measureCallCount: number;
  maxDepth: number;
};

/**
 * Structured facts produced from the normal WASM layout and IR pipeline.
 *
 * Use this when a build script, visual editor, or CI check needs bboxes,
 * warnings, node ID validation, and lookup maps without reimplementing text
 * measurement in TypeScript.
 */
export type SceneInspection = {
  nodeIds: NodeIdValidationResult;
  layout: LayoutResult;
  ir: IR;
  textMap: TextMap;
  sourceIndex: IRSourceIndex;
  bboxes: InspectionBBox[];
  warnings: RecoverableError[];
  stats: InspectionStats;
};

/**
 * Render a scene into structured layout and IR inspection facts.
 */
export function inspectScene(
  engine: Engine,
  input: EngineInput,
  options?: RenderIrOptions,
): SceneInspection {
  const vnode = resolveSceneOrVNodeInput(input);
  const layoutOptions =
    options?.skipValidation === undefined ? undefined : { skipValidation: options.skipValidation };
  const layout = engine.renderToLayoutTree(vnode, layoutOptions);
  const ir = engine.renderToIR(vnode, options);
  const sourceIndex = buildIRSourceIndex(ir);
  const bboxes = collectInspectionBBoxes(ir, sourceIndex);
  const textMap = buildTextMap(ir, sourceIndex);
  const nodeIds = validateNodeIds(vnode);

  return {
    nodeIds,
    layout,
    ir,
    textMap,
    sourceIndex,
    bboxes,
    warnings: ir.warnings,
    stats: buildInspectionStats({ ir, layout, bboxes, sourceIndex }),
  };
}

/** Collect source and paint geometry while keeping generated clip wrappers transparent.
 * @throws {FatalError} VALIDATION for malformed source ownership.
 */
export function collectInspectionBBoxes(
  ir: IR,
  sourceIndex = buildIRSourceIndex(ir),
): InspectionBBox[] {
  const bboxes: InspectionBBox[] = [];
  const matrices = new Map<number, ReturnType<typeof createIdentityAffineMatrix>>();
  for (const occurrence of sourceIndex.nodes.values()) {
    const node = occurrence.node;
    const ancestorMatrix =
      occurrence.parentNodeIndex === null
        ? createIdentityAffineMatrix()
        : (matrices.get(occurrence.parentNodeIndex) ?? createIdentityAffineMatrix());
    const layoutBBox = {
      x: node.bbox.x,
      y: node.bbox.y,
      w: node.bbox.w,
      h: node.bbox.h,
    };
    const nodeTransform = node.type === "group" ? node.transform : undefined;
    const nodeMatrix = createResolvedTransformMatrix(nodeTransform, node.bbox);
    const effectiveMatrix = multiplyAffineMatrices(ancestorMatrix, nodeMatrix);
    const transformBox = buildTransformBox(layoutBBox, effectiveMatrix);
    const hasOwnTransform = nodeTransform != null && hasTransform(nodeTransform);
    const origin =
      node.type === "group" && hasOwnTransform
        ? buildTransformedOrigin(node, effectiveMatrix)
        : null;
    matrices.set(occurrence.nodeIndex, effectiveMatrix);
    const source = sourceIndex.sources.get(occurrence.source.sourceIndex);
    const isWrapper = node.ownership.role === "wrapper";
    if (!isWrapper) {
      bboxes.push({
        nodeId: node.nodeId,
        type: node.type,
        nodeIndex: occurrence.nodeIndex,
        source: occurrence.source,
        ownership: node.ownership,
        depth: (source?.depth ?? 0) + (node.ownership.role === "source" ? 0 : 1),
        paintOrder: occurrence.paintOrder,
        layoutBBox,
        transformBox,
        visualBBox: buildVisualBBox(transformBox),
        origin,
        hasOwnTransform,
      });
    }
  }
  return bboxes;
}

function buildInspectionStats({
  ir,
  layout,
  bboxes,
  sourceIndex,
}: {
  ir: IR;
  layout: LayoutResult;
  bboxes: InspectionBBox[];
  sourceIndex: IRSourceIndex;
}): InspectionStats {
  return {
    width: ir.width,
    height: ir.height,
    nodeCount: bboxes.length,
    drawNodeCount: bboxes.filter((bbox) => bbox.paintOrder !== null).length,
    textNodeCount: bboxes.filter((bbox) => bbox.type === "text").length,
    handlerNodeCount: [...sourceIndex.sources.values()].filter(
      ({ node }) =>
        node.ownership.role === "source" && Object.keys(node.ownership.on ?? {}).length > 0,
    ).length,
    missingGlyphCount: countMissingGlyphsInIr(ir.root),
    overflowTextNodeCount: countOverflowTextNodes(layout.root),
    warningCount: ir.warnings.length,
    measureCallCount: layout.measureCallCount,
    maxDepth: bboxes.reduce((max, bbox) => Math.max(max, bbox.depth), 0),
  };
}

function countMissingGlyphsInIr(node: IRNode): number {
  const current = node.type === "text" ? countMissingGlyphsInTextNode(node) : 0;
  return (
    current +
    (node.type === "group" ? (node.children ?? []) : []).reduce(
      (sum, child) => sum + countMissingGlyphsInIr(child),
      0,
    )
  );
}

function countMissingGlyphsInTextNode(node: IRTextNode): number {
  const lineCount = node.lines.reduce((sum, line) => sum + countMissingGlyphsInLine(line), 0);
  const pathCount = (node.glyphPaths ?? []).filter((path) => path.missingGlyph).length;
  return lineCount + pathCount;
}

function countMissingGlyphsInLine(line: IRTextNode["lines"][number]): number {
  const glyphCount = line.glyphs.filter((glyph) => glyph.glyphId === 0).length;
  const fragmentCount = (line.fragments ?? []).reduce(
    (sum, fragment) => sum + fragment.glyphs.filter((glyph) => glyph.glyphId === 0).length,
    0,
  );
  return glyphCount + fragmentCount;
}

function countOverflowTextNodes(node: LayoutNode): number {
  const current =
    node.textLayout && node.textLayout.resolvedTextLayout.overflow.type !== "none" ? 1 : 0;
  return current + node.children.reduce((sum, child) => sum + countOverflowTextNodes(child), 0);
}

function buildTransformBox(
  layoutBBox: InspectionRect,
  matrix: ReturnType<typeof createIdentityAffineMatrix>,
): InspectionTransformBox {
  return {
    points: [
      applyAffineMatrixToPoint(matrix, { x: layoutBBox.x, y: layoutBBox.y }),
      applyAffineMatrixToPoint(matrix, { x: layoutBBox.x + layoutBBox.w, y: layoutBBox.y }),
      applyAffineMatrixToPoint(matrix, {
        x: layoutBBox.x + layoutBBox.w,
        y: layoutBBox.y + layoutBBox.h,
      }),
      applyAffineMatrixToPoint(matrix, { x: layoutBBox.x, y: layoutBBox.y + layoutBBox.h }),
    ],
  };
}

function buildVisualBBox(transformBox: InspectionTransformBox): InspectionRect {
  const xCoordinates = transformBox.points.map((point) => point.x);
  const yCoordinates = transformBox.points.map((point) => point.y);
  const minX = Math.min(...xCoordinates);
  const minY = Math.min(...yCoordinates);
  const maxX = Math.max(...xCoordinates);
  const maxY = Math.max(...yCoordinates);

  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  };
}

function buildTransformedOrigin(
  node: IRGroupNode,
  matrix: ReturnType<typeof createIdentityAffineMatrix>,
): Point2D {
  return applyAffineMatrixToPoint(matrix, {
    x: node.bbox.x + (node.transform?.originX ?? 0),
    y: node.bbox.y + (node.transform?.originY ?? 0),
  });
}
