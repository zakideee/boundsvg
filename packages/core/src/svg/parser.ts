import { GENERIC_FONT_FAMILIES } from "../font/generic-families.js";
import { DEFAULT_FONT_WEIGHT } from "../font/types.js";
import { createElement } from "../vnode/create-element.js";
import type { TextProps, VNode } from "../vnode/types.js";

const DEFAULT_FONT_SIZE_PX = 16;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single <tspan> element extracted from SVG */
export type SvgTspan = {
  text: string;
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  /** Per-tspan overrides (font, color, etc.) */
  fontFamily?: string;
  fontSizePx?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fill?: string;
};

/** A <text> element extracted from SVG */
export type SvgTextElement = {
  text: string;
  fontFamily?: string;
  fontSizePx?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fill?: string;
  textAnchor?: "start" | "middle" | "end";
  x?: number;
  y?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  writingMode?: "horizontal-tb" | "vertical-rl";
  stroke?: string;
  strokeWidth?: number;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  strokeDasharray?: string;
  strokeMiterlimit?: number;
  language?: string;
  tspans: SvgTspan[];
};

/** Options for converting SvgTextElement → TextProps */
export type SvgTextToTextPropsOptions = {
  /** Map SVG font-family names to boundsvg font aliases */
  fontAliasMap?: Record<string, string>;
  /** Default font when font-family is missing or unresolved */
  defaultFont: string;
  /** Text wrapping mode (default: "none") */
  wrap?: "none" | "word" | "char";
  /** Text fit mode (default: "none") */
  fit?: "none" | "shrink" | "grow";
};

/** Options for converting full SVG → VNode tree */
export type SvgTextToVNodeOptions = {
  width: number;
  height: number;
  background?: string;
  fontAliasMap?: Record<string, string>;
  defaultFont: string;
  wrap?: "none" | "word" | "char";
  fit?: "none" | "shrink" | "grow";
};

// ---------------------------------------------------------------------------
// extractSvgText
// ---------------------------------------------------------------------------

/**
 * Extract all `<text>` elements from an SVG string.
 *
 * Uses regex-based parsing (no DOM dependency).
 * Handles inline `style="..."` attributes, `<tspan>` children,
 * and common SVG text attributes (font-family, font-size, etc.).
 */
export function extractSvgText(svgString: string): SvgTextElement[] {
  const results: SvgTextElement[] = [];

  const textRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  for (const textMatch of svgString.matchAll(textRegex)) {
    const attrStr = textMatch[1] ?? "";
    const innerContent = textMatch[2] ?? "";

    const element = buildTextElement(attrStr, innerContent);
    results.push(element);
  }

  return results;
}

function buildTextElement(attrStr: string, innerContent: string): SvgTextElement {
  const attrs = parseAttributes(attrStr);
  const styleAttrs = parseInlineStyle(attrs.style);
  const merged = { ...styleAttrs, ...attrs };

  const element: SvgTextElement = {
    text: "",
    fontFamily: merged["font-family"] ?? merged.fontFamily,
    fontSizePx: parseFontSize(merged["font-size"] ?? merged.fontSize),
    fontWeight: parseFontWeight(merged["font-weight"] ?? merged.fontWeight),
    fontStyle: parseFontStyle(merged["font-style"] ?? merged.fontStyle),
    fill: merged.fill,
    textAnchor: parseTextAnchor(merged["text-anchor"] ?? merged.textAnchor),
    x: parseNum(merged.x),
    y: parseNum(merged.y),
    letterSpacingPx: parseFontSize(merged["letter-spacing"] ?? merged.letterSpacing),
    writingMode: parseWritingMode(merged["writing-mode"] ?? merged.writingMode),
    stroke: merged.stroke !== "none" ? merged.stroke : undefined,
    strokeWidth: parseFontSize(merged["stroke-width"] ?? merged.strokeWidth),
    strokeLinecap: parseStrokeLinecap(merged["stroke-linecap"] ?? merged.strokeLinecap),
    strokeLinejoin: parseStrokeLinejoin(merged["stroke-linejoin"] ?? merged.strokeLinejoin),
    strokeDasharray: merged["stroke-dasharray"] ?? merged.strokeDasharray,
    strokeMiterlimit: parseNum(merged["stroke-miterlimit"] ?? merged.strokeMiterlimit),
    language: merged["xml:lang"] ?? merged.lang,
    tspans: [],
  };

  const textParts = extractTspansAndText(innerContent, element);
  element.lineHeightPx = estimateLineHeightFromDy(element.tspans);

  if (textParts.length > 0) {
    element.text = textParts.join("\n");
  } else {
    element.text = unescapeXml(stripTags(innerContent).trim());
  }

  return element;
}

function extractTspansAndText(innerContent: string, element: SvgTextElement): string[] {
  const tspanRegex = /<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/gi;
  const textParts: string[] = [];
  let lastIndex = 0;

  for (const tspanMatch of innerContent.matchAll(tspanRegex)) {
    const matchIndex = tspanMatch.index ?? 0;
    const before = innerContent.slice(lastIndex, matchIndex);
    const plainBefore = unescapeXml(stripTags(before).trim());
    if (plainBefore) {
      textParts.push(plainBefore);
    }
    lastIndex = matchIndex + tspanMatch[0].length;

    const tspanAttrStr = tspanMatch[1] ?? "";
    const tspanText = stripTags(tspanMatch[2] ?? "").trim();
    const tspanAttrs = parseAttributes(tspanAttrStr);
    const tspanStyleAttrs = parseInlineStyle(tspanAttrs.style);
    const tspanMerged = { ...tspanStyleAttrs, ...tspanAttrs };

    const tspan: SvgTspan = {
      text: unescapeXml(tspanText),
      x: parseNum(tspanMerged.x),
      y: parseNum(tspanMerged.y),
      dx: parseNum(tspanMerged.dx),
      dy: parseNum(tspanMerged.dy),
      fontFamily: tspanMerged["font-family"] ?? tspanMerged.fontFamily,
      fontSizePx: parseFontSize(tspanMerged["font-size"] ?? tspanMerged.fontSize),
      fontWeight: parseFontWeight(tspanMerged["font-weight"] ?? tspanMerged.fontWeight),
      fontStyle: parseFontStyle(tspanMerged["font-style"] ?? tspanMerged.fontStyle),
      fill: tspanMerged.fill,
    };

    element.tspans.push(tspan);
    textParts.push(tspan.text);
  }

  if (lastIndex < innerContent.length) {
    const after = innerContent.slice(lastIndex);
    const plainAfter = unescapeXml(stripTags(after).trim());
    if (plainAfter) {
      textParts.push(plainAfter);
    }
  }

  return textParts;
}

function estimateLineHeightFromDy(tspans: SvgTspan[]): number | undefined {
  if (tspans.length < 2) {
    return undefined;
  }
  const dyValues: number[] = [];
  for (const tspan of tspans.slice(1)) {
    const dy = tspan.dy;
    if (dy != null && dy > 0) {
      dyValues.push(dy);
    }
  }
  if (dyValues.length === 0) {
    return undefined;
  }
  return dyValues.reduce((a, b) => a + b, 0) / dyValues.length;
}

// ---------------------------------------------------------------------------
// svgTextToTextProps
// ---------------------------------------------------------------------------

/**
 * Convert an extracted SvgTextElement into boundsvg TextProps.
 *
 * Maps SVG text attributes to the corresponding boundsvg properties.
 * Uses `fontAliasMap` to resolve SVG font-family names to registered font aliases.
 *
 * **Limitation:** Only parent `<text>` attributes are used. Per-`<tspan>` style
 * overrides (fill, font-weight, font-style) are parsed into `SvgTspan` but NOT
 * reflected in the output TextProps.
 */
export function svgTextToTextProps(
  element: SvgTextElement,
  options: SvgTextToTextPropsOptions,
): TextProps {
  const { fontAliasMap, defaultFont, wrap = "none", fit = "none" } = options;

  // Resolve font name
  const font = resolveFont(element.fontFamily, fontAliasMap, defaultFont);

  // Map textAnchor → textAlign
  let textAlign: "start" | "center" | "end" | undefined;
  if (element.textAnchor === "middle") {
    textAlign = "center";
  } else if (element.textAnchor === "end") {
    textAlign = "end";
  } else if (element.textAnchor === "start") {
    textAlign = "start";
  }

  // Map language
  let language: "ja" | "en" | "auto" | undefined;
  if (element.language === "ja") {
    language = "ja";
  } else if (element.language === "en") {
    language = "en";
  }

  const props: TextProps = {
    font,
    fontSizePx: element.fontSizePx ?? DEFAULT_FONT_SIZE_PX,
    wrap,
    fit,
    children: element.text,
  };

  if (element.fontWeight != null) {
    props.fontWeight = element.fontWeight;
  }
  if (element.fontStyle != null) {
    props.fontStyle = element.fontStyle;
  }
  if (element.fill != null) {
    props.color = element.fill;
  }
  if (textAlign != null) {
    props.textAlign = textAlign;
  }
  if (element.letterSpacingPx != null) {
    props.letterSpacingPx = element.letterSpacingPx;
  }
  if (element.writingMode != null) {
    props.writingMode = element.writingMode;
  }
  if (element.lineHeightPx != null) {
    props.lineHeightPx = element.lineHeightPx;
  }
  if (element.stroke != null) {
    props.textStroke = element.stroke;
  }
  if (element.strokeWidth != null) {
    props.textStrokeWidth = element.strokeWidth;
  }
  if (element.strokeLinecap != null) {
    props.textStrokeLinecap = element.strokeLinecap;
  }
  if (element.strokeLinejoin != null) {
    props.textStrokeLinejoin = element.strokeLinejoin;
  }
  if (element.strokeDasharray != null) {
    props.textStrokeDasharray = element.strokeDasharray;
  }
  if (element.strokeMiterlimit != null) {
    props.textStrokeMiterlimit = element.strokeMiterlimit;
  }
  if (language != null) {
    props.language = language;
  }

  return props;
}

// ---------------------------------------------------------------------------
// svgTextToVNode
// ---------------------------------------------------------------------------

/**
 * Extract all `<text>` elements from an SVG string and build a boundsvg
 * VNode tree (Canvas + Flex container with Text children).
 *
 * Text elements are laid out in a Flex column; their original absolute x/y
 * positions from SVG are not preserved (converted to flow layout).
 */
export function svgTextToVNode(svgString: string, options: SvgTextToVNodeOptions): VNode {
  const elements = extractSvgText(svgString);

  const textChildren: VNode[] = elements.map((element) =>
    createElement("Text", {
      ...svgTextToTextProps(element, {
        fontAliasMap: options.fontAliasMap,
        defaultFont: options.defaultFont,
        wrap: options.wrap,
        fit: options.fit,
      }),
    }),
  );

  const flexProps = {
    direction: "column" as const,
    gap: 8,
    children: textChildren,
  };

  const flex = createElement("Flex", flexProps);

  const canvasProps: {
    width: number;
    height: number;
    background?: string;
    children: [typeof flex];
  } = {
    width: options.width,
    height: options.height,
    children: [flex] as [typeof flex],
  };
  if (options.background) {
    canvasProps.background = options.background;
  }

  return createElement("Canvas", canvasProps);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse HTML/XML attributes from a string like `key="value" key2="value2"` */
function parseAttributes(attrStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Match key="value" or key='value'
  const attrRegex = /([\w:.+-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of attrStr.matchAll(attrRegex)) {
    const key = match[1] ?? "";
    const value = match[2] ?? match[3] ?? "";
    result[key] = value;
  }
  return result;
}

/** Parse inline style attribute into key-value pairs */
function parseInlineStyle(styleStr: string | undefined): Record<string, string> {
  if (!styleStr) {
    return {};
  }
  const result: Record<string, string> = {};
  const parts = styleStr.split(";");
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }
    const key = part.slice(0, colonIdx).trim();
    const value = part.slice(colonIdx + 1).trim();
    if (key && value) {
      // Strip surrounding quotes from values like font-family: 'Inter'
      result[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
  return result;
}

/** Strip HTML/XML tags from a string */
function stripTags(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

/** Unescape XML entities (named + numeric character references) */
function unescapeXml(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

/** Parse a font-size value (handles px, pt, plain numbers) */
function parseFontSize(value: string | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.endsWith("pt")) {
    const pt = parseFloat(trimmed);
    return Number.isNaN(pt) ? undefined : pt * (4 / 3); // 1pt = 4/3 px
  }
  // Remove "px" suffix if present
  const num = parseFloat(trimmed.replace(/px$/i, ""));
  return Number.isNaN(num) ? undefined : num;
}

/** Parse font-weight (handles "bold", "normal", numeric) */
function parseFontWeight(value: string | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "bold") {
    return 700;
  }
  if (trimmed === "normal") {
    return DEFAULT_FONT_WEIGHT;
  }
  const num = parseInt(trimmed, 10);
  return Number.isNaN(num) ? undefined : num;
}

/** Parse font-style */
function parseFontStyle(value: string | undefined): "normal" | "italic" | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "italic" || trimmed === "oblique") {
    return "italic";
  }
  if (trimmed === "normal") {
    return "normal";
  }
  return undefined;
}

/** Parse text-anchor */
function parseTextAnchor(value: string | undefined): "start" | "middle" | "end" | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "start" || trimmed === "middle" || trimmed === "end") {
    return trimmed;
  }
  return undefined;
}

/** Parse writing-mode */
function parseWritingMode(value: string | undefined): "horizontal-tb" | "vertical-rl" | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "tb" || trimmed === "tb-rl" || trimmed === "vertical-rl") {
    return "vertical-rl";
  }
  if (trimmed === "horizontal-tb" || trimmed === "lr" || trimmed === "lr-tb") {
    return "horizontal-tb";
  }
  return undefined;
}

function parseStrokeLinecap(value: string | undefined): "butt" | "round" | "square" | undefined {
  if (value == null) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "butt" || normalized === "round" || normalized === "square") {
    return normalized;
  }
  return undefined;
}

function parseStrokeLinejoin(value: string | undefined): "miter" | "round" | "bevel" | undefined {
  if (value == null) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "miter" || normalized === "round" || normalized === "bevel") {
    return normalized;
  }
  return undefined;
}

/** Parse a numeric attribute value */
function parseNum(value: string | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }
  const num = parseFloat(value);
  return Number.isNaN(num) ? undefined : num;
}

/** Resolve SVG font-family to a boundsvg font alias */
function resolveFont(
  fontFamily: string | undefined,
  fontAliasMap: Record<string, string> | undefined,
  defaultFont: string,
): string {
  if (!fontFamily) {
    return defaultFont;
  }

  // Font-family may be comma-separated; try each
  const families = fontFamily.split(",").map((family) => family.trim().replace(/^['"]|['"]$/g, ""));

  if (fontAliasMap) {
    for (const fam of families) {
      const mapped = fontAliasMap[fam];
      if (mapped) {
        return mapped;
      }
    }
  }

  // Return first non-generic family, or defaultFont
  for (const fam of families) {
    if (!GENERIC_FONT_FAMILIES.has(fam.toLowerCase())) {
      return fam;
    }
  }

  return defaultFont;
}
