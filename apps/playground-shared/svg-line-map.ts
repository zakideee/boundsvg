/**
 * Build a map from nodeId to line range in formatted SVG source.
 *
 * Scans the output of `formatSvgCode()` for `data-boundsvg-node-id` attributes
 * and tracks opening/closing tag pairs to determine the line range of each node.
 */

/** Inclusive line indices in the formatted SVG code panel. */
export type NodeLineRange = { start: number; end: number };

/** Source-node attribute emitted by the renderer. */
const NODE_ID_RE = /data-boundsvg-node-id="([^"]+)"/;
/** Opening XML element name, including namespace prefixes. */
const OPEN_TAG_RE = /^\s*<([\w:-]+)/;
/** Closing XML element name at the end of a formatted line. */
const CLOSE_TAG_RE = /<\/([\w:-]+)>\s*$/;

/**
 * Build a map from nodeId → { start, end } line indices (0-based).
 * Only nodes with `data-boundsvg-node-id` attributes are included.
 */
export function buildNodeLineMap(formattedSvg: string): Map<string, NodeLineRange> {
  const lines = formattedSvg.split("\n");
  const map = new Map<string, NodeLineRange>();
  const stack: Array<{ nodeId?: string; line: number; tagName: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;

    const tagMatch = line.match(OPEN_TAG_RE);
    if (tagMatch) {
      const nodeId = line.match(NODE_ID_RE)?.[1];
      const tagName = tagMatch[1] as string;
      const trimmed = line.trimEnd();

      if (trimmed.endsWith("/>") || trimmed.includes(`</${tagName}>`)) {
        if (nodeId) {
          map.set(nodeId, { start: i, end: i });
        }
      } else {
        // Anonymous paint and clip wrappers still own their closing tags.
        stack.push({ nodeId, line: i, tagName });
      }
      continue;
    }

    const closeMatch = line.match(CLOSE_TAG_RE);
    if (!closeMatch) {
      continue;
    }
    const closingTag = closeMatch[1] as string;
    for (let j = stack.length - 1; j >= 0; j--) {
      const entry = stack[j];
      if (!entry || entry.tagName !== closingTag) {
        continue;
      }
      stack.splice(j, 1);
      if (entry.nodeId) {
        map.set(entry.nodeId, { start: entry.line, end: i });
      }
      break;
    }
  }

  return map;
}
