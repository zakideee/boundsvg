import type { BBox } from "../text/types.js";
import type { IRSourceIndex, IRSourceInfo, IRSourceRef } from "./source-index.js";

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

/** Primary text entries and descendant text lists from one canonical source index. */
export type TextMap = Readonly<{
  sourceIndex: IRSourceIndex;
  nodes: ReadonlyMap<number, TextNodeEntry>;
  childTextMap: ReadonlyMap<number, readonly number[]>;
}>;

/** Project primary text and descendant lists from the index of one IR snapshot. */
export function buildTextMap(sourceIndex: IRSourceIndex): TextMap {
  const nodes = new Map<number, TextNodeEntry>();
  const childTextMap = new Map<number, number[]>();
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
    let parent = sourceIndex.sources.get(occurrence.source.sourceIndex)?.parentSourceIndex;
    while (parent !== null && parent !== undefined) {
      const descendants = childTextMap.get(parent) ?? [];
      descendants.push(occurrence.source.sourceIndex);
      childTextMap.set(parent, descendants);
      parent = sourceIndex.sources.get(parent)?.parentSourceIndex;
    }
  }
  return { sourceIndex, nodes, childTextMap };
}

function resolveCurrentSource(textMap: TextMap, source: IRSourceRef): IRSourceInfo | null {
  const info = textMap.sourceIndex.sources.get(source.sourceIndex);
  return info?.source === source ? info : null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Read primary text only for a canonical source reference in this map's snapshot. */
export function getNodeText(textMap: TextMap, source: IRSourceRef): string | null {
  return resolveCurrentSource(textMap, source)
    ? (textMap.nodes.get(source.sourceIndex)?.text ?? null)
    : null;
}

/**
 * Get concatenated text of the nearest ancestor group that contains
 * multiple primary text descendants. Group sources are valid query origins.
 * Returns null for stale/foreign refs or when no ancestor has multiple texts.
 */
export function getAncestorText(textMap: TextMap, source: IRSourceRef): string | null {
  let parent = resolveCurrentSource(textMap, source)?.parentSourceIndex;
  while (parent !== null && parent !== undefined) {
    const textIndices = textMap.childTextMap.get(parent);
    if (textIndices && textIndices.length > 1) {
      return textIndices
        .map((ordinal) => textMap.nodes.get(ordinal)?.text)
        .filter((text): text is string => text != null)
        .join("\n\n");
    }

    parent = textMap.sourceIndex.sources.get(parent)?.parentSourceIndex;
  }
  return null;
}

/** Read all primary text in tree paint order. */
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
 * Find a primary-text line for a current canonical source at an SVG-space point.
 * Uses baselineY midpoints for line boundaries; stale or foreign refs return null.
 */
export function findLineAtPoint(
  textMap: TextMap,
  source: IRSourceRef,
  point: { svgX: number; svgY: number },
): LineEntry | null {
  const entry = resolveCurrentSource(textMap, source)
    ? textMap.nodes.get(source.sourceIndex)
    : undefined;
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
