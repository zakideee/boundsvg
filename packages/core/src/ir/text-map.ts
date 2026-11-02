import type { BBox } from "../text/types.js";
import { buildIRSourceIndex, type IRSourceRef } from "./source-index.js";
import type { IR } from "./types.js";

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
  source: IRSourceRef;
  /** Full text (lines joined by "\n") */
  text: string;
  bbox: BBox;
  lines: LineEntry[];
  writingMode?: "horizontal-tb" | "vertical-rl";
  fontSizePx?: number;
  lineHeightPx?: number;
};

/** Text entries and ancestor relations keyed by snapshot-local source occurrence. */
export type TextMap = {
  nodes: ReadonlyMap<number, TextNodeEntry>;
  childTextMap: ReadonlyMap<number, readonly number[]>;
  parentMap: ReadonlyMap<number, number>;
};

/** Extract primary text paints in tree paint order and their semantic ancestors.
 * @throws {FatalError} VALIDATION for malformed source ownership.
 */
export function buildTextMap(ir: IR, sourceIndex = buildIRSourceIndex(ir)): TextMap {
  const nodes = new Map<number, TextNodeEntry>();
  const childTextMap = new Map<number, number[]>();
  const parentMap = new Map<number, number>();
  for (const source of sourceIndex.sources.values()) {
    if (source.parentSourceIndex !== null) {
      parentMap.set(source.source.sourceIndex, source.parentSourceIndex);
    }
  }
  for (const occurrence of sourceIndex.nodes.values()) {
    const node = occurrence.node;
    if (
      node.type !== "text" ||
      sourceIndex.sources.get(occurrence.source.sourceIndex)?.primaryNodeIndex !==
        occurrence.nodeIndex
    ) {
      continue;
    }
    const lines = node.lines.map((line, lineIndex) => ({
      text: line.text,
      lineIndex,
      baselineY: line.baselineY,
      width: line.width,
    }));
    nodes.set(occurrence.source.sourceIndex, {
      source: occurrence.source,
      text: node.displayText ?? lines.map((line) => line.text).join("\n"),
      bbox: node.bbox,
      lines,
      writingMode: node.writingMode,
      fontSizePx: node.fontSizePx,
      lineHeightPx: node.lineHeightPx,
    });
    let parent = parentMap.get(occurrence.source.sourceIndex);
    while (parent !== undefined) {
      const descendants = childTextMap.get(parent) ?? [];
      descendants.push(occurrence.source.sourceIndex);
      childTextMap.set(parent, descendants);
      parent = parentMap.get(parent);
    }
  }
  return { nodes, childTextMap, parentMap };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Get the full text of a single text node. */
export function getNodeText(textMap: TextMap, sourceIndex: number): string | null {
  return textMap.nodes.get(sourceIndex)?.text ?? null;
}

/**
 * Get concatenated text of the nearest ancestor group that contains
 * multiple text descendants. Falls back to the direct parent group
 * if all ancestors contain only one text node.
 */
export function getAncestorText(textMap: TextMap, sourceIndex: number): string | null {
  let current = sourceIndex;
  const visited = new Set<number>();

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
export function getAllText(textMap: TextMap): string {
  return [...textMap.nodes.values()].map((entry) => entry.text).join("\n\n");
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
  sourceIndex: number,
  point: { svgX: number; svgY: number },
): LineEntry | null {
  const entry = textMap.nodes.get(sourceIndex);
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
