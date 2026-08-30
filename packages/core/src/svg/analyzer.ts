// ---------------------------------------------------------------------------
// SVG Analyzer — structure analysis + hybrid VNode construction
// ---------------------------------------------------------------------------
// Classifies SVG elements into text vs non-text, infers BBOX for text
// elements, and builds a hybrid VNode tree where text is processed by
// boundsvg's text engine and non-text is preserved as raw SVG.
// ---------------------------------------------------------------------------

import { createInternalRecoverableError, type RecoverableError } from "../errors.js";
import { createElement } from "../vnode/create-element.js";
import type { VNode } from "../vnode/types.js";
import {
  extractSvgText,
  type SvgTextElement,
  type SvgTextToTextPropsOptions,
  svgTextToTextProps,
} from "./parser.js";
import { parseSvgDimensions, parseSvgViewBox, type SvgViewBox } from "./scanner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Text bounding box specification */
export type TextBBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** A classified SVG element */
export type ClassifiedSvgElement = {
  kind: "text" | "non-text";
  /** Original element content */
  content: string;
  /** Parsed text element (only for kind === "text") */
  textElement?: SvgTextElement;
  /** Inferred or explicit bounding box (only for kind === "text") */
  bbox?: TextBBox;
  /** How the bbox was determined */
  bboxSource?: "explicit" | "rect-inferred" | "viewbox-fallback";
};

/** Options for SVG analysis */
export type AnalyzeSvgOptions = {
  fontAliasMap?: Record<string, string>;
  defaultFont: string;
  wrap?: "none" | "word" | "char";
  fit?: "none" | "shrink" | "grow";
  textBBoxes?: Record<number, TextBBox>;
  inferBBox?: boolean;
  background?: string;
};

/** Result of SVG analysis */
export type AnalyzeSvgResult = {
  elements: ClassifiedSvgElement[];
  viewBox?: SvgViewBox;
  dimensions?: { width: number; height: number };
  textElements: SvgTextElement[];
  nonTextSvgContent: string;
  warnings: RecoverableError[];
};

// ---------------------------------------------------------------------------
// Known text attributes (for unsupported property detection)
// ---------------------------------------------------------------------------

const KNOWN_TEXT_ATTRS = new Set([
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "fill",
  "text-anchor",
  "x",
  "y",
  "dx",
  "dy",
  "letter-spacing",
  "writing-mode",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-miterlimit",
  "paint-order",
  "xml:lang",
  "lang",
  "style",
  "id",
  "class",
  "opacity",
  "dominant-baseline",
  "alignment-baseline",
]);

const UNSUPPORTED_TEXT_ATTRS = new Set([
  "transform",
  "rotate",
  "textLength",
  "lengthAdjust",
  "text-decoration",
  "baseline-shift",
  "glyph-orientation-horizontal",
  "glyph-orientation-vertical",
  "kerning",
  "word-spacing",
  "filter",
  "clip-path",
  "mask",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze an SVG string, classifying elements into text and non-text,
 * extracting text elements, and generating non-text SVG content.
 */
export function analyzeSvg(svgString: string, options: AnalyzeSvgOptions): AnalyzeSvgResult {
  const warnings: RecoverableError[] = [];

  // Parse viewBox and dimensions
  const viewBox = parseSvgViewBox(svgString);
  const dims = parseSvgDimensions(svgString);
  const dimensions =
    dims.width != null && dims.height != null
      ? { width: dims.width, height: dims.height }
      : viewBox
        ? { width: viewBox.width, height: viewBox.height }
        : undefined;

  // Extract text elements
  const textElements = extractSvgText(svgString);

  // Check for <style> blocks
  if (/<style\b/i.test(svgString)) {
    warnings.push(
      createInternalRecoverableError(
        "SVG_STYLE_BLOCK_DETECTED",
        "SVG contains <style> block which may affect text rendering. CSS class-based styling is not supported.",
        {
          fallback: "Style block ignored; inline styles used where available.",
          context: { stage: "analyzer" },
        },
      ),
    );
  }

  // Check for nested <svg> elements
  const nestedSvgCount = (svgString.match(/<svg\b/gi) ?? []).length;
  if (nestedSvgCount > 1) {
    warnings.push(
      createInternalRecoverableError(
        "SVG_NESTED_SVG_DETECTED",
        "SVG contains nested <svg> elements. Only the outermost <svg> is processed for text extraction.",
        {
          fallback: "Nested <svg> elements preserved as non-text content.",
          context: { stage: "analyzer" },
        },
      ),
    );
  }

  // Detect unsupported attributes on text elements
  checkUnsupportedTextAttributes(svgString, warnings);

  // Extract rect elements for BBOX inference
  const rects = extractRects(svgString);

  // Classify elements and infer BBOX
  const elements: ClassifiedSvgElement[] = [];
  const inferBBox = options.inferBBox !== false;

  for (const [i, textEl] of textElements.entries()) {
    let bbox: TextBBox | undefined;
    let bboxSource: ClassifiedSvgElement["bboxSource"];

    // 1. Explicit BBOX from options
    if (options.textBBoxes?.[i]) {
      bbox = options.textBBoxes[i];
      bboxSource = "explicit";
    }
    // 2. Infer from surrounding <rect> elements
    else if (inferBBox) {
      const inferred = inferBBoxFromRects(textEl, rects);
      if (inferred) {
        bbox = inferred;
        bboxSource = "rect-inferred";
      }
      // 3. Fallback to viewBox
      else if (viewBox) {
        bbox = {
          x: viewBox.minX,
          y: viewBox.minY,
          width: viewBox.width,
          height: viewBox.height,
        };
        bboxSource = "viewbox-fallback";
        warnings.push(
          createInternalRecoverableError(
            "BBOX_INFERRED_FROM_VIEWBOX",
            `Text element ${i} BBOX inferred from viewBox (no enclosing rect found).`,
            {
              fallback: "Using viewBox as BBOX fallback.",
              context: { stage: "analyzer", textIndex: i, text: textEl.text.slice(0, 50) },
            },
          ),
        );
      }
    }

    elements.push({
      kind: "text",
      content: textEl.text,
      textElement: textEl,
      bbox,
      bboxSource,
    });
  }

  // Generate non-text SVG content (strip text elements)
  const nonTextSvgContent = stripTextElements(svgString);

  // Check for <image> elements with external (non-data-URI) hrefs
  checkExternalImageRefs(nonTextSvgContent, warnings);

  return {
    elements,
    viewBox,
    dimensions,
    textElements,
    nonTextSvgContent,
    warnings,
  };
}

/**
 * Build a hybrid VNode tree from an analysis result.
 *
 * Structure:
 * ```
 * Canvas (width, height)
 *   Box (position="relative", width, height)
 *     Svg (content=nonTextSvg, width, height)  ← non-text background layer
 *     Box (position="absolute", top/left/width/height from bbox[0])
 *       Text (font, fontSizePx, fit="shrink", wrap="word", ...)
 *     Box (position="absolute", top/left/width/height from bbox[1])
 *       Text (font, fontSizePx, fit="shrink", wrap="word", ...)
 * ```
 */
export function buildHybridVNode(
  analysis: AnalyzeSvgResult,
  options: AnalyzeSvgOptions,
): { vnode: VNode; warnings: RecoverableError[] } {
  const warnings: RecoverableError[] = [...analysis.warnings];
  const { defaultFont, fontAliasMap, background } = options;
  const wrap = options.wrap ?? "word";
  const fit = options.fit ?? "shrink";

  const width = analysis.dimensions?.width ?? 800;
  const height = analysis.dimensions?.height ?? 600;

  // Build text children with absolute positioning
  const textPropsOptions: SvgTextToTextPropsOptions = {
    fontAliasMap,
    defaultFont,
    wrap,
    fit,
  };

  const children: VNode[] = [];

  // Non-text SVG background layer
  if (analysis.nonTextSvgContent.trim()) {
    children.push(
      createElement("Svg", {
        content: analysis.nonTextSvgContent,
        width,
        height,
      }),
    );
  }

  // Text elements with absolute positioning.
  // Limitation: text is placed at Box top-left; the original SVG x/y offset
  // within the BBOX rect is not mapped to padding or alignment.
  for (const element of analysis.elements) {
    if (element.kind !== "text" || !element.textElement) {
      continue;
    }

    const textProps = svgTextToTextProps(element.textElement, textPropsOptions);

    if (element.bbox) {
      // When fit="grow" or "shrink", give the text a preferredFrame so the
      // layout engine knows the target area and does not overshoot the bbox.
      if (fit !== "none") {
        textProps.preferredFrame = { w: element.bbox.width, h: element.bbox.height };
      }

      const textNode = createElement("Text", {
        ...textProps,
      });

      const wrapper = createElement("Box", {
        position: "absolute" as const,
        top: element.bbox.y,
        left: element.bbox.x,
        width: element.bbox.width,
        height: element.bbox.height,
        overflow: "clip" as const,
        children: [textNode],
      });

      children.push(wrapper);
    } else {
      // No BBOX — add as direct child
      children.push(createElement("Text", { ...textProps }));
    }
  }

  // Wrapper Box with relative positioning
  const wrapper = createElement("Box", {
    position: "relative" as const,
    width,
    height,
    children,
  });

  // Canvas root
  const canvasProps: {
    width: number;
    height: number;
    background?: string;
    children: [typeof wrapper];
  } = { width, height, children: [wrapper] };
  if (background) {
    canvasProps.background = background;
  }

  const vnode = createElement("Canvas", canvasProps);

  return { vnode, warnings };
}

/**
 * Convenience function: analyze SVG and build hybrid VNode in one step.
 */
export function svgToHybridVNode(
  svgString: string,
  options: AnalyzeSvgOptions,
): { vnode: VNode; warnings: RecoverableError[] } {
  const analysis = analyzeSvg(svgString, options);
  return buildHybridVNode(analysis, options);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract all <rect> elements with their position and size */
type RectInfo = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function extractRects(svgString: string): RectInfo[] {
  const rects: RectInfo[] = [];
  const rectRegex = /<rect\b([^>]*?)\/?>(?:<\/rect>)?/gi;

  for (const match of svgString.matchAll(rectRegex)) {
    const attrStr = match[1] ?? "";
    const attrs = parseAttributesSimple(attrStr);

    const x = parseFloat(attrs.x ?? "0");
    const y = parseFloat(attrs.y ?? "0");
    const width = parseFloat(attrs.width ?? "0");
    const height = parseFloat(attrs.height ?? "0");

    if (!Number.isNaN(width) && !Number.isNaN(height) && width > 0 && height > 0) {
      rects.push({
        x: Number.isNaN(x) ? 0 : x,
        y: Number.isNaN(y) ? 0 : y,
        width,
        height,
      });
    }
  }

  return rects;
}

/** Find the smallest rect that contains the text element's x,y position */
function inferBBoxFromRects(textEl: SvgTextElement, rects: RectInfo[]): TextBBox | undefined {
  const tx = textEl.x ?? 0;
  const ty = textEl.y ?? 0;

  let best: RectInfo | undefined;
  let bestArea = Infinity;

  for (const rect of rects) {
    // Check if text position is within this rect (with small tolerance)
    const tolerance = 2;
    if (
      tx >= rect.x - tolerance &&
      tx <= rect.x + rect.width + tolerance &&
      ty >= rect.y - tolerance &&
      ty <= rect.y + rect.height + tolerance
    ) {
      const area = rect.width * rect.height;
      if (area < bestArea) {
        best = rect;
        bestArea = area;
      }
    }
  }

  if (!best) {
    return undefined;
  }

  return {
    x: best.x,
    y: best.y,
    width: best.width,
    height: best.height,
  };
}

/** Strip <text>...</text> elements from SVG content */
function stripTextElements(svgString: string): string {
  // Remove XML declaration (invalid when embedded inside another SVG)
  let result = svgString.replace(/<\?xml\b[^?]*\?>\s*/gi, "");
  // Remove <text ...>...</text> blocks
  result = result.replace(/<text\b[^>]*>[\s\S]*?<\/text>/gi, "");
  // Remove self-closing <text ... /> (unlikely but handle it)
  result = result.replace(/<text\b[^>]*\/>/gi, "");
  return result;
}

/** Check for unsupported text attributes and emit warnings */
function checkUnsupportedTextAttributes(svgString: string, warnings: RecoverableError[]): void {
  const textRegex = /<text\b([^>]*)>/gi;
  const seen = new Set<string>();

  for (const match of svgString.matchAll(textRegex)) {
    const attrStr = match[1] ?? "";
    const attrs = parseAttributesSimple(attrStr);

    // Also check inline styles
    const styleAttrs = parseInlineStyle(attrs.style);

    for (const key of Object.keys(attrs)) {
      if (key === "style") {
        continue;
      }
      if (!KNOWN_TEXT_ATTRS.has(key) && UNSUPPORTED_TEXT_ATTRS.has(key) && !seen.has(key)) {
        seen.add(key);
        warnings.push(
          createInternalRecoverableError(
            "SVG_UNSUPPORTED_PROPERTY",
            `SVG text attribute "${key}" is not supported and will be ignored.`,
            {
              fallback: `Attribute "${key}" ignored.`,
              context: { stage: "analyzer", attribute: key },
            },
          ),
        );
      }
    }

    for (const key of Object.keys(styleAttrs)) {
      if (!KNOWN_TEXT_ATTRS.has(key) && UNSUPPORTED_TEXT_ATTRS.has(key) && !seen.has(key)) {
        seen.add(key);
        warnings.push(
          createInternalRecoverableError(
            "SVG_UNSUPPORTED_PROPERTY",
            `SVG text style property "${key}" is not supported and will be ignored.`,
            {
              fallback: `Style property "${key}" ignored.`,
              context: { stage: "analyzer", attribute: key },
            },
          ),
        );
      }
    }
  }
}

/** Simple attribute parser (duplicated from scanner to keep analyzer self-contained) */
function parseAttributesSimple(attrStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  const attrRegex = /([\w:.+-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of attrStr.matchAll(attrRegex)) {
    const key = match[1] ?? "";
    result[key] = match[2] ?? match[3] ?? "";
  }
  return result;
}

/** Parse inline style attribute */
function parseInlineStyle(styleStr: string | undefined): Record<string, string> {
  if (!styleStr) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const part of styleStr.split(";")) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }
    const key = part.slice(0, colonIdx).trim();
    const value = part.slice(colonIdx + 1).trim();
    if (key && value) {
      result[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
  return result;
}

/** Check for <image> elements with external (non-data-URI) href and emit warnings */
function checkExternalImageRefs(svgContent: string, warnings: RecoverableError[]): void {
  const imageHrefRegex = /<image\b[^>]*\b(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const match of svgContent.matchAll(imageHrefRegex)) {
    const href = (match[1] ?? match[2] ?? "").trim();
    if (href && !href.startsWith("data:")) {
      warnings.push(
        createInternalRecoverableError(
          "SVG_EXTERNAL_IMAGE_DETECTED",
          `SVG contains <image> with external href "${href}" — use inlineExternalImages() or provide a data URI for reliable rendering.`,
          {
            fallback: "External image may not render in all contexts.",
            context: { stage: "analyzer", href },
          },
        ),
      );
    }
  }
}
