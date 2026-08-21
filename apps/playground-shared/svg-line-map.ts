/**
 * Build a map from nodeId to line range in formatted SVG source.
 *
 * Scans the output of `formatSvgCode()` for `data-boundsvg-node-id` attributes
 * and tracks opening/closing tag pairs to determine the line range of each node.
 */

export type NodeLineRange = { start: number; end: number };

const NODE_ID_RE = /data-boundsvg-node-id="([^"]+)"/;
const OPEN_TAG_RE = /^\s*<(\w+)/;
const CLOSE_TAG_RE = /<\/(\w+)>\s*$/;

/**
 * Build a map from nodeId → { start, end } line indices (0-based).
 * Only nodes with `data-boundsvg-node-id` attributes are included.
 */
export function buildNodeLineMap(formattedSvg: string): Map<string, NodeLineRange> {
  const lines = formattedSvg.split("\n");
  const map = new Map<string, NodeLineRange>();
  const stack: Array<{ nodeId: string; line: number; tagName: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;

    const nodeIdMatch = line.match(NODE_ID_RE);
    if (nodeIdMatch) {
      const nodeId = nodeIdMatch[1] as string;
      const tagMatch = line.match(OPEN_TAG_RE);
      const tagName = tagMatch?.[1] ?? "";
      const trimmed = line.trimEnd();

      // Self-closing or single-line element (e.g. <rect ... /> or <g ...>...</g>)
      if (trimmed.endsWith("/>") || trimmed.includes(`</${tagName}>`)) {
        map.set(nodeId, { start: i, end: i });
      } else {
        stack.push({ nodeId, line: i, tagName });
      }
      continue;
    }

    // Check for closing tags that match an open node
    const closeMatch = line.match(CLOSE_TAG_RE);
    if (closeMatch && stack.length > 0) {
      const closingTag = closeMatch[1] as string;
      for (let j = stack.length - 1; j >= 0; j--) {
        const entry = stack[j];
        if (entry && entry.tagName === closingTag) {
          stack.splice(j, 1);
          map.set(entry.nodeId, { start: entry.line, end: i });
          break;
        }
      }
    }
  }

  return map;
}
