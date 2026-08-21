// ---------------------------------------------------------------------------
// SVG Tag-level Scanner
// ---------------------------------------------------------------------------
// Regex-based scanner that extracts all SVG elements as a flat list with depth
// information. No DOM dependency.
// ---------------------------------------------------------------------------

/** A scanned SVG element with position and depth info */
export type ScannedSvgElement = {
  tagName: string;
  attributes: Record<string, string>;
  startOffset: number;
  endOffset: number;
  innerContent: string;
  selfClosing: boolean;
  depth: number;
};

/** Parsed SVG viewBox */
export type SvgViewBox = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan all SVG elements from an SVG string, returning them as a flat list
 * with depth tracking.
 *
 * Uses regex-based parsing (no DOM dependency). Handles self-closing tags,
 * nested elements, and standard SVG/XML attribute formats.
 */
export function scanSvgElements(svgString: string): ScannedSvgElement[] {
  const results: ScannedSvgElement[] = [];

  // Match opening tags (including self-closing) and closing tags
  const tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9:._-]*)\b([^>]*?)(\/?)>/g;

  // Track open element stack for depth and content extraction
  type OpenElement = {
    tagName: string;
    attributes: Record<string, string>;
    startOffset: number;
    innerStart: number;
    depth: number;
  };

  const stack: OpenElement[] = [];
  let depth = 0;

  for (const match of svgString.matchAll(tagRegex)) {
    const isClosing = match[1] === "/";
    const tagName = match[2] ?? "";
    const attrStr = match[3] ?? "";
    const isSelfClosing = match[4] === "/" || (!isClosing && isSelfClosingTag(attrStr));
    const startOffset = match.index ?? 0;
    const endOffset = startOffset + match[0].length;

    if (isClosing) {
      // Closing tag — find matching open element
      for (let i = stack.length - 1; i >= 0; i--) {
        const stackEntry = stack[i];
        if (stackEntry && stackEntry.tagName === tagName) {
          const open = stackEntry;
          results.push({
            tagName: open.tagName,
            attributes: open.attributes,
            startOffset: open.startOffset,
            endOffset,
            innerContent: svgString.slice(open.innerStart, startOffset),
            selfClosing: false,
            depth: open.depth,
          });
          stack.splice(i, 1);
          depth = Math.max(0, depth - 1);
          break;
        }
      }
    } else if (isSelfClosing) {
      // Self-closing tag
      results.push({
        tagName,
        attributes: parseAttributes(attrStr),
        startOffset,
        endOffset,
        innerContent: "",
        selfClosing: true,
        depth,
      });
    } else {
      // Opening tag — push to stack
      stack.push({
        tagName,
        attributes: parseAttributes(attrStr),
        startOffset,
        innerStart: endOffset,
        depth,
      });
      depth++;
    }
  }

  // Sort by startOffset to maintain document order
  results.sort((a, b) => a.startOffset - b.startOffset);

  return results;
}

/**
 * Parse the viewBox attribute from an SVG string.
 *
 * Looks for `viewBox="minX minY width height"` on the root `<svg>` element.
 */
export function parseSvgViewBox(svgString: string): SvgViewBox | undefined {
  const svgTagMatch = svgString.match(/<svg\b([^>]*)>/i);
  if (!svgTagMatch) {
    return undefined;
  }

  const attrs = parseAttributes(svgTagMatch[1] ?? "");
  const viewBox = attrs.viewBox ?? attrs.viewbox;
  if (!viewBox) {
    return undefined;
  }

  const parts = viewBox.trim().split(/[\s,]+/);
  if (parts.length < 4) {
    return undefined;
  }

  const [minX, minY, width, height] = parts.map(Number);
  if ([minX, minY, width, height].some((value) => value == null || Number.isNaN(value))) {
    return undefined;
  }

  return { minX: minX ?? 0, minY: minY ?? 0, width: width ?? 0, height: height ?? 0 };
}

/**
 * Parse width and height attributes from the root `<svg>` element.
 */
export function parseSvgDimensions(svgString: string): { width?: number; height?: number } {
  const svgTagMatch = svgString.match(/<svg\b([^>]*)>/i);
  if (!svgTagMatch) {
    return {};
  }

  const attrs = parseAttributes(svgTagMatch[1] ?? "");
  return {
    width: parseNumericAttr(attrs.width),
    height: parseNumericAttr(attrs.height),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse HTML/XML attributes from a string like `key="value" key2="value2"` */
function parseAttributes(attrStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  const attrRegex = /([\w:.+-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of attrStr.matchAll(attrRegex)) {
    const key = match[1] ?? "";
    const value = match[2] ?? match[3] ?? "";
    result[key] = value;
  }
  return result;
}

/** Check if a tag's attribute string ends with "/" indicating self-closing */
function isSelfClosingTag(attrStr: string): boolean {
  return attrStr.trimEnd().endsWith("/");
}

/** Parse a numeric attribute value (handles px suffix) */
function parseNumericAttr(value: string | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }
  const num = parseFloat(value.replace(/px$/i, ""));
  return Number.isNaN(num) ? undefined : num;
}
