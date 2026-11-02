import {
  type AffineMatrix,
  applyAffineMatrixToPoint,
  createIdentityAffineMatrix,
  createResolvedTransformMatrix,
  multiplyAffineMatrices,
  type Point2D,
} from "../transform.js";
import { buildIRSourceIndex, type IRSourceRef } from "./source-index.js";
import type { IR } from "./types.js";

/** Source-range roles distinguishing ordinary content from ruby base and annotation. */
export type TextSourceRole = "content" | "rubyBase" | "rubyAnnotation";

/** Canvas-space glyph quad associated with a semantic source range. */
export type TextSelectionQuad = {
  source: IRSourceRef;
  sourceStart: number;
  sourceEnd: number;
  sourceRole: TextSourceRole;
  text: string;
  points: [Point2D, Point2D, Point2D, Point2D];
};

/** Selectable primary text geometry for one source occurrence. */
export type TextSelectionNode = {
  source: IRSourceRef;
  writingMode: "horizontal-tb" | "vertical-rl";
  glyphs: readonly TextSelectionQuad[];
};

/** Snapshot-local primary text geometry keyed by source ordinal. */
export type TextSelectionMap = {
  nodes: ReadonlyMap<number, TextSelectionNode>;
};

/** Logical caret in one source occurrence, including ruby source role. */
export type TextCaret = {
  source: IRSourceRef;
  offset: number;
  affinity: "before" | "after";
  sourceRole: TextSourceRole;
};

/** Logical source offsets selected within one primary text occurrence. */
export type TextSelectionRange = {
  start: number;
  end: number;
};

/**
 * Build canvas-space glyph quads from an IR returned by renderToSvgAndIR with
 * textPathMode="glyphs". IRs without per-glyph paths produce no selectable quads.
 * @throws {FatalError} VALIDATION for malformed source ownership.
 */
export function buildTextSelectionMap(
  ir: IR,
  sourceIndex = buildIRSourceIndex(ir),
): TextSelectionMap {
  const nodes = new Map<number, TextSelectionNode>();

  const matrices = new Map<number, AffineMatrix>();
  for (const occurrence of sourceIndex.nodes.values()) {
    const node = occurrence.node;
    const ancestorMatrix =
      occurrence.parentNodeIndex === null
        ? createIdentityAffineMatrix()
        : (matrices.get(occurrence.parentNodeIndex) ?? createIdentityAffineMatrix());
    const worldMatrix = multiplyAffineMatrices(
      ancestorMatrix,
      createResolvedTransformMatrix(node.type === "group" ? node.transform : undefined, node.bbox),
    );
    matrices.set(occurrence.nodeIndex, worldMatrix);

    if (
      node.type === "text" &&
      sourceIndex.sources.get(occurrence.source.sourceIndex)?.primaryNodeIndex ===
        occurrence.nodeIndex
    ) {
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
            source: occurrence.source,
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
        nodes.set(occurrence.source.sourceIndex, {
          source: occurrence.source,
          writingMode: node.writingMode ?? "horizontal-tb",
          glyphs,
        });
      }
    }
  }
  return { nodes };
}

/** Resolve the nearest logical caret boundary to a canvas-space point. */
export function findTextCaretAtPoint(
  selectionMap: TextSelectionMap,
  sourceIndex: number,
  point: { svgX: number; svgY: number },
): TextCaret | null {
  const node = selectionMap.nodes.get(sourceIndex);
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
    source: node.source,
    offset: before ? bestGlyph.sourceStart : bestGlyph.sourceEnd,
    affinity: before ? "before" : "after",
    sourceRole: bestGlyph.sourceRole,
  };
}

/** Return transformed glyph quads overlapping a logical source range. */
export function getTextRangeQuads(
  selectionMap: TextSelectionMap,
  sourceIndex: number,
  range: TextSelectionRange,
): TextSelectionQuad[] {
  const node = selectionMap.nodes.get(sourceIndex);
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
  const xCoordinates = points.map((point) => point.x);
  const yCoordinates = points.map((point) => point.y);
  const x = Math.min(...xCoordinates);
  const y = Math.min(...yCoordinates);
  return { x, y, w: Math.max(...xCoordinates) - x, h: Math.max(...yCoordinates) - y };
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
