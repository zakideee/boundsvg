import type { Engine, EngineInput, RenderIrOptions } from "./engine.js";
import type { RecoverableError } from "./errors.js";
import type { TextMap } from "./ir/text-map.js";
import type { HandlersRef, IR, IRGroupNode, IRNode, IRNodeType, IRTextNode } from "./ir/types.js";
import type { LayoutNode, LayoutResult } from "./layout/types.js";
import type { NodeIdValidationResult } from "./node-ids.js";
import { validateNodeIds } from "./node-ids.js";
import { resolveSceneOrVNodeInput } from "./scene/from-vnode.js";
import { buildHandlerMap, buildNodeTypeMap, buildTextMap } from "./scene.js";
import {
  applyAffineMatrixToPoint,
  createIdentityAffineMatrix,
  createResolvedTransformMatrix,
  hasTransform,
  multiplyAffineMatrices,
  type Point2D,
} from "./transform.js";

export type InspectionRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type InspectionTransformBox = {
  points: [Point2D, Point2D, Point2D, Point2D];
};

/** A flattened bounding box entry for one rendered IR node. */
export type InspectionBBox = {
  nodeId: string;
  type: IRNodeType;
  /** Pre-transform layout x. Use visualBBox.x for canvas-space position. */
  x: number;
  /** Pre-transform layout y. Use visualBBox.y for canvas-space position. */
  y: number;
  /** Pre-transform layout width. Use visualBBox.w for the transformed AABB width. */
  w: number;
  /** Pre-transform layout height. Use visualBBox.h for the transformed AABB height. */
  h: number;
  depth: number;
  /** Zero-based position in IR draw order; null for nodes that are not painted directly. */
  drawIndex: number | null;
  hasHandlers: boolean;
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
  handlerMap: Map<string, HandlersRef>;
  nodeTypeMap: Map<string, IRNodeType>;
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
  const bboxes = collectInspectionBBoxes(ir);
  const textMap = buildTextMap(ir);
  const handlerMap = buildHandlerMap(ir);
  const nodeTypeMap = buildNodeTypeMap(ir);
  const nodeIds = validateNodeIds(vnode);

  return {
    nodeIds,
    layout,
    ir,
    textMap,
    handlerMap,
    nodeTypeMap,
    bboxes,
    warnings: ir.warnings,
    stats: buildInspectionStats({ ir, layout, bboxes }),
  };
}

export function collectInspectionBBoxes(ir: IR): InspectionBBox[] {
  const bboxes: InspectionBBox[] = [];
  const drawIndexByNodeId = new Map(ir.drawOrder.map((nodeId, drawIndex) => [nodeId, drawIndex]));

  function walk(
    node: IRNode,
    depth: number,
    ancestorMatrix: ReturnType<typeof createIdentityAffineMatrix>,
  ): void {
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
    const handlers = node.type === "rect" ? undefined : node.on;

    bboxes.push({
      nodeId: node.nodeId,
      type: node.type,
      x: layoutBBox.x,
      y: layoutBBox.y,
      w: layoutBBox.w,
      h: layoutBBox.h,
      depth,
      drawIndex: drawIndexByNodeId.get(node.nodeId) ?? null,
      hasHandlers: handlers != null && Object.keys(handlers).length > 0,
      layoutBBox,
      transformBox,
      visualBBox: buildVisualBBox(transformBox),
      origin,
      hasOwnTransform,
    });

    for (const child of node.type === "group" ? (node.children ?? []) : []) {
      walk(child, depth + 1, effectiveMatrix);
    }
  }

  walk(ir.root, 0, createIdentityAffineMatrix());
  return bboxes;
}

function buildInspectionStats({
  ir,
  layout,
  bboxes,
}: {
  ir: IR;
  layout: LayoutResult;
  bboxes: InspectionBBox[];
}): InspectionStats {
  return {
    width: ir.width,
    height: ir.height,
    nodeCount: bboxes.length,
    drawNodeCount: ir.drawOrder.length,
    textNodeCount: bboxes.filter((bbox) => bbox.type === "text").length,
    handlerNodeCount: bboxes.filter((bbox) => bbox.hasHandlers).length,
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
