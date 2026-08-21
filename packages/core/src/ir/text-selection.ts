import {
  type AffineMatrix,
  applyAffineMatrixToPoint,
  createIdentityAffineMatrix,
  createResolvedTransformMatrix,
  multiplyAffineMatrices,
  type Point2D,
} from "../transform.js";
import type { IR, IRNode } from "./types.js";

export type TextSourceRole = "content" | "rubyBase" | "rubyAnnotation";

export type TextSelectionQuad = {
  nodeId: string;
  sourceStart: number;
  sourceEnd: number;
  sourceRole: TextSourceRole;
  text: string;
  points: [Point2D, Point2D, Point2D, Point2D];
};

export type TextSelectionNode = {
  nodeId: string;
  writingMode: "horizontal-tb" | "vertical-rl";
  glyphs: readonly TextSelectionQuad[];
};

export type TextSelectionMap = {
  nodes: ReadonlyMap<string, TextSelectionNode>;
};

export type TextCaret = {
  nodeId: string;
  offset: number;
  affinity: "before" | "after";
  sourceRole: TextSourceRole;
};

export type TextSelectionRange = {
  start: number;
  end: number;
};

/**
 * Build canvas-space glyph quads from an IR returned by renderToSvgAndIR with
 * textPathMode="glyphs". IRs without per-glyph paths produce empty entries.
 */
export function buildTextSelectionMap(ir: IR): TextSelectionMap {
  const nodes = new Map<string, TextSelectionNode>();

  function walk(node: IRNode, ancestorMatrix: AffineMatrix): void {
    const worldMatrix = multiplyAffineMatrices(
      ancestorMatrix,
      createResolvedTransformMatrix(node.type === "group" ? node.transform : undefined, node.bbox),
    );

    if (node.type === "text") {
      const glyphs = (node.glyphPaths ?? []).flatMap((glyphPath) => {
        if (
          glyphPath.sourceStart === undefined ||
          glyphPath.sourceEnd === undefined ||
          glyphPath.sourceRole === undefined
        ) {
          return [];
        }
        const { x, y, w, h } = glyphPath.bbox;
        return [
          {
            nodeId: node.nodeId,
            sourceStart: glyphPath.sourceStart,
            sourceEnd: glyphPath.sourceEnd,
            sourceRole: glyphPath.sourceRole,
            text: glyphPath.text,
            points: [
              applyAffineMatrixToPoint(worldMatrix, { x, y }),
              applyAffineMatrixToPoint(worldMatrix, { x: x + w, y }),
              applyAffineMatrixToPoint(worldMatrix, { x: x + w, y: y + h }),
              applyAffineMatrixToPoint(worldMatrix, { x, y: y + h }),
            ],
          } satisfies TextSelectionQuad,
        ];
      });
      if (glyphs.length > 0) {
        nodes.set(node.nodeId, {
          nodeId: node.nodeId,
          writingMode: node.writingMode ?? "horizontal-tb",
          glyphs,
        });
      }
    }

    for (const child of node.type === "group" ? (node.children ?? []) : []) {
      walk(child, worldMatrix);
    }
  }

  walk(ir.root, createIdentityAffineMatrix());
  return { nodes };
}

/** Resolve the nearest logical caret boundary to a canvas-space point. */
export function findTextCaretAtPoint(
  selectionMap: TextSelectionMap,
  nodeId: string,
  point: { svgX: number; svgY: number },
): TextCaret | null {
  const node = selectionMap.nodes.get(nodeId);
  if (!node || node.glyphs.length === 0) {
    return null;
  }

  let bestGlyph: TextSelectionQuad | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const glyph of node.glyphs) {
    const bounds = quadBounds(glyph.points);
    const distance = distanceToRect(point.svgX, point.svgY, bounds);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestGlyph = glyph;
    }
  }
  if (!bestGlyph) {
    return null;
  }

  const bounds = quadBounds(bestGlyph.points);
  const isVertical = node.writingMode === "vertical-rl";
  const before = isVertical
    ? point.svgY < bounds.y + bounds.h / 2
    : point.svgX < bounds.x + bounds.w / 2;
  return {
    nodeId,
    offset: before ? bestGlyph.sourceStart : bestGlyph.sourceEnd,
    affinity: before ? "before" : "after",
    sourceRole: bestGlyph.sourceRole,
  };
}

/** Return transformed glyph quads overlapping a logical source range. */
export function getTextRangeQuads(
  selectionMap: TextSelectionMap,
  nodeId: string,
  range: TextSelectionRange,
): TextSelectionQuad[] {
  const node = selectionMap.nodes.get(nodeId);
  if (!node) {
    return [];
  }
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  if (start === end) {
    return [];
  }
  return node.glyphs.filter((glyph) => glyph.sourceStart < end && glyph.sourceEnd > start);
}

function quadBounds(points: TextSelectionQuad["points"]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function distanceToRect(
  x: number,
  y: number,
  rect: { x: number; y: number; w: number; h: number },
): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.h));
  return dx * dx + dy * dy;
}
