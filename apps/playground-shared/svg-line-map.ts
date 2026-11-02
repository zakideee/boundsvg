import type { IRSourceIndex } from "@boundsvg/core/scene";

/** Inclusive line indices in the formatted SVG code panel. */
export type NodeLineRange = { start: number; end: number };

type LineStack = Array<{
  sourceIndex: number | null;
  line: number;
  tagName: string;
  isOpaque: boolean;
}>;

type LineMapState = { map: Map<number, NodeLineRange>; stack: LineStack; nextIndex: number };
function openElement(
  tag: string,
  tagName: string,
  {
    state,
    index,
    startLine,
    endLine,
  }: {
    state: LineMapState;
    index: IRSourceIndex;
    startLine: number;
    endLine: number;
  },
): void {
  const parentOpaque = state.stack.at(-1)?.isOpaque ?? false;
  const token = tag.match(/\sdata-boundsvg-node-index="(0|[1-9]\d*)"/u)?.[1];
  const ordinal = token === undefined ? null : Number(token);
  const occurrence =
    !parentOpaque && ordinal === state.nextIndex ? index.nodes.get(state.nextIndex) : undefined;
  const isEndpoint =
    occurrence &&
    tag.includes(`data-boundsvg-role="${occurrence.node.ownership.role}"`) &&
    tag.includes(`data-boundsvg-source-index="${occurrence.source.sourceIndex}"`);
  if (isEndpoint) {
    state.nextIndex++;
  }
  const sourceIndex =
    isEndpoint && occurrence.node.ownership.role === "source"
      ? occurrence.source.sourceIndex
      : null;
  const isOpaque = parentOpaque || (isEndpoint && occurrence.node.type === "svg") === true;
  if (tag.endsWith("/>")) {
    if (sourceIndex !== null) {
      state.map.set(sourceIndex, { start: startLine, end: endLine });
    }
  } else {
    state.stack.push({ sourceIndex, line: startLine, tagName, isOpaque });
  }
}
function closeElement(tagName: string, line: number, state: LineMapState): boolean {
  const entry = state.stack.at(-1);
  if (!entry || entry.tagName !== tagName) {
    return false;
  }
  state.stack.pop();
  if (entry.sourceIndex !== null) {
    state.map.set(entry.sourceIndex, { start: entry.line, end: line });
  }
  return true;
}

function countNewlines(text: string, start: number, end: number): number {
  let count = 0;
  for (let offset = start; offset < end; offset++) {
    if (text[offset] === "\n") {
      count++;
    }
  }
  return count;
}

// Mixed content can close several elements on one formatted line. Read lexical
// tags while preserving quoted attributes and skipping comment/CDATA contents.
function readMarkup(text: string, start: number): { end: number; isTag: boolean } | null {
  const delimiter = text.startsWith("<!--", start)
    ? "-->"
    : text.startsWith("<![CDATA[", start)
      ? "]]>"
      : text.startsWith("<?", start)
        ? "?>"
        : null;
  if (delimiter !== null) {
    const ending = text.indexOf(delimiter, start + 2);
    return ending < 0 ? null : { end: ending + delimiter.length, isTag: false };
  }
  let quote: string | null = null;
  for (let offset = start + 1; offset < text.length; offset++) {
    const character = text[offset];
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return { end: offset + 1, isTag: !text.startsWith("<!", start) };
    }
  }
  return null;
}

/** Map source anchor ranges by balanced tags; embedded Svg content stays opaque. */
export function buildNodeLineMap(
  formattedSvg: string,
  index: IRSourceIndex,
): Map<number, NodeLineRange> {
  const state: LineMapState = { map: new Map(), stack: [], nextIndex: 0 };
  let cursor = 0;
  let line = 0;
  while (cursor < formattedSvg.length) {
    const start = formattedSvg.indexOf("<", cursor);
    if (start < 0) {
      break;
    }
    line += countNewlines(formattedSvg, cursor, start);
    const markup = readMarkup(formattedSvg, start);
    if (!markup) {
      return new Map();
    }
    const endLine = line + countNewlines(formattedSvg, start, markup.end);
    if (markup.isTag) {
      const tag = formattedSvg.slice(start, markup.end);
      const name = tag.match(/^<\/?([^\s/>]+)/u)?.[1];
      if (!name) {
        return new Map();
      }
      if (tag.startsWith("</")) {
        if (!closeElement(name, endLine, state)) {
          return new Map();
        }
      } else {
        openElement(tag, name, { state, index, startLine: line, endLine });
      }
    }
    cursor = markup.end;
    line = endLine;
  }
  return state.nextIndex === index.nodes.size && state.stack.length === 0 ? state.map : new Map();
}
