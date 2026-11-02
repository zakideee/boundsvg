import type { IRSourceIndex } from "@boundsvg/core/scene";

/** Inclusive line indices in the formatted SVG code panel. */
export type NodeLineRange = { start: number; end: number };

/** Opening XML element name at the start of a formatted line. */
const OPEN_TAG_RE = /^\s*<([\w:-]+)/u;
/** Closing XML element name at the end of a formatted line. */
const CLOSE_TAG_RE = /<\/([\w:-]+)>\s*$/u;

type LineStack = Array<{
  sourceIndex: number | null;
  line: number;
  tagName: string;
  isOpaque: boolean;
}>;

type LineMapState = { map: Map<number, NodeLineRange>; stack: LineStack; nextIndex: number };
function openElement(
  line: string,
  tagName: string,
  { state, index, lineIndex }: { state: LineMapState; index: IRSourceIndex; lineIndex: number },
): void {
  const parentOpaque = state.stack.at(-1)?.isOpaque ?? false;
  const token = line.match(/data-boundsvg-node-index="(0|[1-9]\d*)"/u)?.[1];
  const ordinal = token === undefined ? null : Number(token);
  const occurrence =
    !parentOpaque && ordinal === state.nextIndex ? index.nodes.get(state.nextIndex) : undefined;
  const isEndpoint =
    occurrence &&
    line.includes(`data-boundsvg-role="${occurrence.node.ownership.role}"`) &&
    line.includes(`data-boundsvg-source-index="${occurrence.source.sourceIndex}"`);
  if (isEndpoint) {
    state.nextIndex++;
  }
  const sourceIndex =
    isEndpoint && occurrence.node.ownership.role === "source"
      ? occurrence.source.sourceIndex
      : null;
  const isOpaque = parentOpaque || (isEndpoint && occurrence.node.type === "svg") === true;
  if (line.trimEnd().endsWith("/>") || line.trimEnd().endsWith(`</${tagName}>`)) {
    if (sourceIndex !== null) {
      state.map.set(sourceIndex, { start: lineIndex, end: lineIndex });
    }
  } else {
    state.stack.push({ sourceIndex, line: lineIndex, tagName, isOpaque });
  }
}
function closeElement(tagName: string, lineIndex: number, state: LineMapState): void {
  for (let stackIndex = state.stack.length - 1; stackIndex >= 0; stackIndex--) {
    const entry = state.stack[stackIndex];
    if (!entry || entry.tagName !== tagName) {
      continue;
    }
    state.stack.splice(stackIndex, 1);
    if (entry.sourceIndex !== null) {
      state.map.set(entry.sourceIndex, { start: entry.line, end: lineIndex });
    }
    break;
  }
}

// Text and application metadata may contain newlines inside quoted attributes.
// Keep the opening tag together while preserving its first visible code line.
function readOpeningLines(
  lines: readonly string[],
  start: number,
): { text: string; end: number } | null {
  let quote: string | null = null;
  for (let end = start; end < lines.length; end++) {
    for (const character of lines[end] ?? "") {
      if (quote !== null) {
        if (character === quote) {
          quote = null;
        }
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        return { text: lines.slice(start, end + 1).join("\n"), end };
      }
    }
  }
  return null;
}

/** Map source occurrences to emitted anchor ranges; embedded Svg markup stays opaque. */
export function buildNodeLineMap(
  formattedSvg: string,
  index: IRSourceIndex,
): Map<number, NodeLineRange> {
  const state: LineMapState = { map: new Map(), stack: [], nextIndex: 0 };
  const lines = formattedSvg.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? "";
    const opening = line.match(OPEN_TAG_RE);
    if (opening) {
      const openingLines = readOpeningLines(lines, lineIndex);
      if (!openingLines) {
        return new Map();
      }
      openElement(openingLines.text, opening[1] ?? "", { state, index, lineIndex });
      lineIndex = openingLines.end;
      continue;
    }
    const closing = line.match(CLOSE_TAG_RE);
    if (closing) {
      closeElement(closing[1] ?? "", lineIndex, state);
    }
  }
  return state.nextIndex === index.nodes.size ? state.map : new Map();
}
