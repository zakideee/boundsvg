import type { BBox } from "../text/types.js";
import type { IR, IRNode } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-line text entry extracted from IR */
export type LineEntry = {
  text: string;
  lineIndex: number;
  /** Baseline Y position relative to the text node bbox top */
  baselineY: number;
  width: number;
};

/** Text node entry in a TextMap */
export type TextNodeEntry = {
  nodeId: string;
  /** Full text (lines joined by "\n") */
  text: string;
  bbox: BBox;
  lines: LineEntry[];
  writingMode?: "horizontal-tb" | "vertical-rl";
  fontSizePx?: number;
  lineHeightPx?: number;
};

/** Flat text structure extracted from an IR tree */
export type TextMap = {
  /** All text nodes indexed by nodeId */
  nodes: ReadonlyMap<string, TextNodeEntry>;
  /** groupNodeId → descendant text nodeIds (in tree walk order) */
  childTextMap: ReadonlyMap<string, readonly string[]>;
  /** nodeId → parent nodeId (for ancestor lookups) */
  parentMap: ReadonlyMap<string, string>;
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Build a TextMap by walking the IR tree once.
 * Collects all text nodes and builds group-to-descendants + parent mappings.
 */
export function buildTextMap(ir: IR): TextMap {
  const nodes = new Map<string, TextNodeEntry>();
  const childTextMap = new Map<string, string[]>();
  const parentMap = new Map<string, string>();

  function walk(node: IRNode, parentNodeId: string | null): string[] {
    if (parentNodeId !== null) {
      parentMap.set(node.nodeId, parentNodeId);
    }

    if (node.type === "text") {
      const lineEntries: LineEntry[] = node.lines.map((line, i) => ({
        text: line.text,
        lineIndex: i,
        baselineY: line.baselineY,
        width: line.width,
      }));
      const text = lineEntries.map((line) => line.text).join("\n");

      nodes.set(node.nodeId, {
        nodeId: node.nodeId,
        text,
        bbox: node.bbox,
        lines: lineEntries,
        writingMode: node.writingMode,
        fontSizePx: node.fontSizePx,
        lineHeightPx: node.lineHeightPx,
      });

      return [node.nodeId];
    }

    if (node.type === "group" && node.children) {
      const descendantTextIds: string[] = [];
      for (const child of node.children) {
        // IR wrappers may reuse the same nodeId as their single child (for
        // example a text group wrapper plus the text node itself). In that case
        // the logical parent for ancestor traversal is the nearest ancestor with
        // a different nodeId, not the immediate wrapper with the same nodeId.
        const childParentNodeId = child.nodeId === node.nodeId ? parentNodeId : node.nodeId;
        descendantTextIds.push(...walk(child, childParentNodeId));
      }
      if (descendantTextIds.length > 0) {
        childTextMap.set(node.nodeId, descendantTextIds);
      }
      return descendantTextIds;
    }

    return [];
  }

  walk(ir.root, null);

  return { nodes, childTextMap, parentMap };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Get the full text of a single text node. */
export function getNodeText(textMap: TextMap, nodeId: string): string | null {
  return textMap.nodes.get(nodeId)?.text ?? null;
}

/**
 * Get concatenated text of the nearest ancestor group that contains
 * multiple text descendants. Falls back to the direct parent group
 * if all ancestors contain only one text node.
 */
export function getAncestorText(textMap: TextMap, nodeId: string): string | null {
  let current = nodeId;
  const visited = new Set<string>();

  while (true) {
    if (visited.has(current)) {
      return null;
    }
    visited.add(current);

    const parentId = textMap.parentMap.get(current);
    if (parentId === undefined) {
      return null;
    }

    const textIds = textMap.childTextMap.get(parentId);
    if (textIds && textIds.length > 1) {
      return textIds
        .map((id) => textMap.nodes.get(id)?.text)
        .filter((text): text is string => text != null)
        .join("\n\n");
    }

    current = parentId;
  }
}

/** Get all text in the IR, ordered by draw order. */
export function getAllText(textMap: TextMap, drawOrder: readonly string[]): string {
  const texts: string[] = [];

  for (const nodeId of drawOrder) {
    const entry = textMap.nodes.get(nodeId);
    if (entry) {
      texts.push(entry.text);
    }
  }

  return texts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Line-level query
// ---------------------------------------------------------------------------

/**
 * Scan lines using baselineY midpoints as boundaries.
 * For vertical-rl, baselineY represents X offset from the right edge,
 * so boundaries are mirrored (bboxStart + bboxSize - midpoint).
 */
function scanLineByMidpoint(options: {
  lines: LineEntry[];
  cursor: number;
  bboxStart: number;
  bboxEnd: number;
  bboxSize: number;
  isVertical: boolean;
}): LineEntry | null {
  const { lines, cursor, bboxStart, bboxEnd, bboxSize, isVertical } = options;
  for (let i = 0; i < lines.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounds-checked by loop condition
    const current = lines[i]!;
    const prev: LineEntry | undefined = lines[i - 1];
    const next: LineEntry | undefined = lines[i + 1];

    let lineStart: number;
    let lineEnd: number;
    if (isVertical) {
      const prevB = !prev
        ? bboxEnd
        : bboxStart + bboxSize - (prev.baselineY + current.baselineY) / 2;
      const nextB = !next
        ? bboxStart
        : bboxStart + bboxSize - (current.baselineY + next.baselineY) / 2;
      lineStart = Math.min(prevB, nextB);
      lineEnd = Math.max(prevB, nextB);
    } else {
      lineStart = !prev ? bboxStart : bboxStart + (prev.baselineY + current.baselineY) / 2;
      lineEnd = !next ? bboxEnd : bboxStart + (current.baselineY + next.baselineY) / 2;
    }

    if (cursor >= lineStart && cursor <= lineEnd) {
      return current;
    }
  }
  return lines.at(-1) ?? null;
}

/**
 * Find the line at a given SVG-space point within a text node.
 * Uses baselineY midpoints to determine line boundaries.
 */
export function findLineAtPoint(
  textMap: TextMap,
  nodeId: string,
  point: { svgX: number; svgY: number },
): LineEntry | null {
  const entry = textMap.nodes.get(nodeId);
  if (!entry || entry.lines.length === 0) {
    return null;
  }

  const { bbox, lines, writingMode } = entry;

  // Choose the axis based on writing mode
  const isVertical = writingMode === "vertical-rl";
  const cursor = isVertical ? point.svgX : point.svgY;
  const bboxStart = isVertical ? bbox.x : bbox.y;
  const bboxEnd = isVertical ? bbox.x + bbox.w : bbox.y + bbox.h;

  // Quick bounds check
  if (cursor < bboxStart || cursor > bboxEnd) {
    return null;
  }

  // Single line — no boundary computation needed
  if (lines.length === 1) {
    return lines[0] ?? null;
  }

  return scanLineByMidpoint({
    lines,
    cursor,
    bboxStart,
    bboxEnd,
    bboxSize: isVertical ? bbox.w : bbox.h,
    isVertical,
  });
}
