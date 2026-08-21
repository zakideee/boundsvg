import type { Engine, LayoutNode, RenderOptions, VNode } from "@boundsvg/core";
import { validateNodeIds } from "@boundsvg/core";
import {
  buildHandlerMap,
  buildNodeTypeMap,
  buildTextMap,
  type HandlersRef,
  type IR,
  type IRNodeType,
  type TextMap,
} from "@boundsvg/core/scene";

export type CliInspectionBBox = {
  nodeId: string;
  type: IRNodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  hasHandlers: boolean;
};

export type CliSceneInspection = {
  stats: {
    width: number;
    height: number;
    nodeCount: number;
    drawNodeCount: number;
    textNodeCount: number;
    handlerNodeCount: number;
    warningCount: number;
    measureCallCount: number;
    maxDepth: number;
    missingGlyphCount: number;
    overflowTextNodeCount: number;
  };
  nodeIds: ReturnType<typeof validateNodeIds>;
  ir: IR;
  textMap: TextMap;
  handlerMap: Map<string, HandlersRef>;
  nodeTypeMap: Map<string, IRNodeType>;
  bboxes: CliInspectionBBox[];
  warnings: IR["warnings"];
};

export function inspectCliScene(
  engine: Engine,
  input: VNode,
  options?: RenderOptions,
): CliSceneInspection {
  const layout = engine.renderToLayoutTree(input, options);
  const ir = engine.renderToIR(input, options);
  const bboxes = collectBBoxes(ir.root);
  const missingGlyphCount = countMissingGlyphs(ir.root);
  const overflowTextNodeCount = countOverflowTextNodes(layout.root);

  return {
    stats: {
      width: ir.width,
      height: ir.height,
      nodeCount: bboxes.length,
      drawNodeCount: ir.drawOrder.length,
      textNodeCount: bboxes.filter((bbox) => bbox.type === "text").length,
      handlerNodeCount: bboxes.filter((bbox) => bbox.hasHandlers).length,
      warningCount: ir.warnings.length,
      measureCallCount: layout.measureCallCount,
      maxDepth: bboxes.reduce((max, bbox) => Math.max(max, bbox.depth), 0),
      missingGlyphCount,
      overflowTextNodeCount,
    },
    nodeIds: validateNodeIds(input),
    ir,
    textMap: buildTextMap(ir),
    handlerMap: buildHandlerMap(ir),
    nodeTypeMap: buildNodeTypeMap(ir),
    bboxes,
    warnings: ir.warnings,
  };
}

export function formatInspectionJson(inspection: CliSceneInspection): string {
  return JSON.stringify(
    {
      stats: inspection.stats,
      nodeIds: {
        valid: inspection.nodeIds.valid,
        duplicates: inspection.nodeIds.duplicates,
        explicitIds: inspection.nodeIds.explicitIds,
        autoIds: inspection.nodeIds.autoIds,
        generatedIds: inspection.nodeIds.generatedIds,
      },
      warnings: inspection.warnings.map((warning) => ({
        name: warning.name,
        message: warning.message,
      })),
      bboxes: inspection.bboxes,
      drawOrder: inspection.ir.drawOrder,
    },
    null,
    2,
  );
}

function collectBBoxes(root: IR["root"]): CliInspectionBBox[] {
  const bboxes: CliInspectionBBox[] = [];
  function walk(node: IR["root"], depth: number): void {
    const handlers = node.type === "rect" ? undefined : node.on;
    bboxes.push({
      nodeId: node.nodeId,
      type: node.type,
      x: node.bbox.x,
      y: node.bbox.y,
      w: node.bbox.w,
      h: node.bbox.h,
      depth,
      hasHandlers: handlers != null && Object.keys(handlers).length > 0,
    });
    for (const child of node.type === "group" ? (node.children ?? []) : []) {
      walk(child, depth + 1);
    }
  }
  walk(root, 0);
  return bboxes;
}

function countMissingGlyphs(root: IR["root"]): number {
  const current =
    root.type === "text"
      ? root.lines.reduce(
          (sum, line) => sum + line.glyphs.filter((glyph) => glyph.glyphId === 0).length,
          0,
        ) + (root.glyphPaths ?? []).filter((path) => path.missingGlyph).length
      : 0;
  return (
    current +
    (root.type === "group" ? (root.children ?? []) : []).reduce(
      (sum, child) => sum + countMissingGlyphs(child),
      0,
    )
  );
}

function countOverflowTextNodes(root: LayoutNode): number {
  const current =
    root.textLayout && root.textLayout.resolvedTextLayout.overflow.type !== "none" ? 1 : 0;
  return current + root.children.reduce((sum, child) => sum + countOverflowTextNodes(child), 0);
}
