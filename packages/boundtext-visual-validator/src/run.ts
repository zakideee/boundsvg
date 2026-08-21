/**
 * boundsvg-runner — Render boundtext spec cases as PNG via boundsvg's WASM pipeline.
 *
 * Unlike the browser-runner (which renders via headless Chromium), this tool
 * renders entirely through boundsvg's WASM pipeline (rustybuzz text shaping +
 * tiny_skia rasterisation). The resulting PNGs provide a true visual
 * representation of what boundsvg produces, enabling side-by-side comparison
 * with browser-rendered screenshots.
 *
 * Usage:
 *   npx tsx src/run.ts \
 *     --spec <spec-cases.json> \
 *     --fonts <fonts-dir> \
 *     --screenshots <output-dir> \
 *     [--bt-results <boundtext-output.json>] \
 *     [--ids id1,id2,...] \
 *     [--scale 1]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type CanvasSceneNode,
  createEngineAsync,
  type Engine,
  type InlineSceneNode,
  type RtSceneNode,
  type SceneNode,
  type TextSceneNode,
} from "@boundsvg/core";

type TextSceneChild = TextSceneNode["children"][number];
type InlineBoxSceneNode = Extract<TextSceneChild, { type: "InlineBox" }>;

// ---------------------------------------------------------------------------
// Types (matches Rust JSON output — snake_case is intentional)
// ---------------------------------------------------------------------------

type SpecCase = {
  id: string;
  category?: string;
  description?: string;
  request: {
    text: string;
    rich_text?: RichTextNodeInput[];
    font_family: string;
    font_size_px: number;
    max_width: number;
    max_height?: number;
    wrap?: string;
    fit?: string;
    max_lines?: number;
    ellipsis?: boolean;
    language?: string;
    writing_mode?: string;
    line_height?: number;
    line_height_px?: number;
    letter_spacing_px?: number;
    hanging_punctuation?: boolean;
    font_variation_settings?: Record<string, number>;
    font_weight?: number;
    font_style?: string;
    [key: string]: unknown;
  };
};

type RichTextStyleInput = {
  fontFamily?: string[];
  fontWeight?: number;
  fontStyle?: string;
  fontSizePx?: number;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  color?: string;
  language?: string;
  textOrientation?: string;
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
};

type RichTextNodeInput =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "span";
      text: string;
      style: RichTextStyleInput;
    }
  | {
      kind: "combine";
      text: string;
      style: RichTextStyleInput;
    }
  | {
      kind: "ruby";
      rubyPosition?: string;
      rubyAlign?: string;
      rubyGapPx?: number;
      rubyOffsetPx?: number;
      style: RichTextStyleInput;
      base: RichTextNodeInput[];
      rt: RichTextNodeInput[];
      rtLevels?: RichTextNodeInput[][];
    }
  | {
      kind: "inlineBox";
      style: RichTextStyleInput;
      children: RichTextNodeInput[];
      paddingInline?: [number, number];
      background?: string;
      borderColor?: string;
      borderWidth?: number;
      borderRadius?: number;
    }
  | {
      kind: "inlineRect";
      fragmentId: string;
      inlineSizePx: number;
      blockSizePx?: number | "line";
      advancePx?: number;
      blockAlign?: "start" | "center" | "end";
      color: string;
      borderRadiusPx?: number;
      opacity?: number;
      paintOrder?: "behind" | "front";
    }
  | {
      kind: "decoratedSpan";
      style: RichTextStyleInput;
      children: RichTextNodeInput[];
      paddingInline?: [number, number];
      background?: string;
      borderColor?: string;
      borderWidth?: number;
      borderRadius?: [number, number, number, number];
    };

type BtEntry = {
  id: string;
  result: {
    bbox: { x: number; y: number; w: number; h: number };
    chosen_font_size_px: number;
    line_count: number;
  };
};

// ---------------------------------------------------------------------------
// Font alias → filename map (same as browser-runner)
// ---------------------------------------------------------------------------

const FONT_FILE_MAP: Record<string, string> = {
  NotoSansJP: "NotoSansJP-Regular.subset.ttf",
  NotoSerifJP: "NotoSerifJP-Regular.subset.ttf",
  NotoSansCJKjp: "NotoSansCJKjp-VF.subset.ttf",
  ZenMaruGothic: "ZenMaruGothic-Regular.subset.ttf",
  Inter: "Inter-Variable.ttf",
};

// ---------------------------------------------------------------------------
// Spec → SceneNode mapping helpers
// ---------------------------------------------------------------------------

function mapWrap(value: string | undefined): TextSceneNode["wrap"] {
  switch (value) {
    case "Word":
      return "word";
    case "Char":
      return "char";
    case "None":
      return "none";
    default:
      return undefined;
  }
}

function mapFit(value: string | undefined): TextSceneNode["fit"] {
  switch (value) {
    case "Shrink":
      return "shrink";
    case "Grow":
      return "grow";
    case "None":
      return "none";
    default:
      return undefined;
  }
}

function mapLanguage(value: string | undefined): TextSceneNode["language"] {
  switch (value) {
    case "Ja":
    case "ja":
      return "ja";
    case "En":
    case "en":
      return "en";
    case "Auto":
    case "auto":
      return "auto";
    default:
      return undefined;
  }
}

function mapWritingMode(value: string | undefined): TextSceneNode["writingMode"] {
  switch (value) {
    case "VerticalRl":
      return "vertical-rl";
    case "HorizontalTb":
      return "horizontal-tb";
    default:
      return undefined;
  }
}

function mapFontStyle(value: string | undefined): "normal" | "italic" | undefined {
  switch (value) {
    case "normal":
    case "Normal":
      return "normal";
    case "italic":
    case "Italic":
      return "italic";
    default:
      return undefined;
  }
}

function mapTextOrientation(value: string | undefined): "mixed" | "upright" | undefined {
  switch (value) {
    case "Mixed":
    case "mixed":
      return "mixed";
    case "Upright":
    case "upright":
      return "upright";
    default:
      return undefined;
  }
}

function mapRubyPosition(
  value: string | undefined,
): "over" | "under" | "alternate" | "inter-character" | undefined {
  switch (value) {
    case "over":
    case "under":
    case "alternate":
    case "inter-character":
      return value;
    default:
      return undefined;
  }
}

function mapRubyAlign(
  value: string | undefined,
): "start" | "center" | "space-between" | "space-around" | undefined {
  switch (value) {
    case "start":
    case "center":
    case "space-between":
    case "space-around":
      return value;
    default:
      return undefined;
  }
}

/**
 * Convert `{ wght: 700, wdth: 125 }` → `"'wght' 700, 'wdth' 125"`.
 */
function formatVariationSettings(settings: Record<string, number> | undefined): string | undefined {
  if (!settings || Object.keys(settings).length === 0) {
    return undefined;
  }
  return Object.entries(settings)
    .map(([tag, value]) => `'${tag}' ${value}`)
    .join(", ");
}

function omitUndefinedProps<Value extends object>(value: Value): Value {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Value;
}

function firstFont(style: RichTextStyleInput): { font?: string; fallback?: string[] } {
  const [font, ...fallback] = style.fontFamily ?? [];
  return omitUndefinedProps({
    font,
    fallback: fallback.length > 0 ? fallback : undefined,
  });
}

function inlineStyle(style: RichTextStyleInput): Omit<InlineSceneNode, "type" | "children"> {
  return omitUndefinedProps({
    ...firstFont(style),
    fontWeight: style.fontWeight,
    fontStyle: mapFontStyle(style.fontStyle),
    fontVariationSettings: style.fontVariationSettings,
    fontFeatureSettings: style.fontFeatureSettings,
    textOrientation: mapTextOrientation(style.textOrientation),
    fontSizePx: style.fontSizePx,
    letterSpacingPx: style.letterSpacingPx,
    color: style.color,
    language: mapLanguage(style.language),
  });
}

function rtStyle(style: RichTextStyleInput): Omit<RtSceneNode, "type" | "children"> {
  return omitUndefinedProps({
    ...firstFont(style),
    fontWeight: style.fontWeight,
    fontStyle: mapFontStyle(style.fontStyle),
    fontVariationSettings: style.fontVariationSettings,
    fontFeatureSettings: style.fontFeatureSettings,
    fontSizePx: style.fontSizePx,
    lineHeight: style.lineHeight,
    lineHeightPx: style.lineHeightPx,
    letterSpacingPx: style.letterSpacingPx,
    color: style.color,
    language: mapLanguage(style.language),
    textOrientation: mapTextOrientation(style.textOrientation),
  });
}

function richTextToTextChild(node: RichTextNodeInput): TextSceneChild {
  switch (node.kind) {
    case "text":
      return node.text;
    case "span":
      return {
        type: "Inline",
        ...inlineStyle(node.style),
        children: [node.text],
      };
    case "combine":
      return {
        type: "Inline",
        ...inlineStyle(node.style),
        textCombineUpright: "all",
        children: [node.text],
      };
    case "ruby": {
      const levels = node.rtLevels && node.rtLevels.length > 0 ? node.rtLevels : [node.rt];
      return omitUndefinedProps({
        type: "Ruby" as const,
        rubyPosition: mapRubyPosition(node.rubyPosition),
        rubyAlign: mapRubyAlign(node.rubyAlign),
        rubyGapPx: node.rubyGapPx,
        rubyOffsetPx: node.rubyOffsetPx,
        children: [
          ...node.base.map(flattenRichTextNode),
          ...levels.map((level) => ({
            type: "Rt" as const,
            ...rtStyle(firstRichTextStyle(level) ?? node.style),
            children: [level.map(flattenRichTextNode).join("")],
          })),
        ],
      });
    }
    case "inlineBox":
      return omitUndefinedProps({
        type: "InlineBox" as const,
        ...inlineStyle(node.style),
        paddingInline: node.paddingInline,
        background: node.background,
        borderColor: node.borderColor,
        borderWidth: node.borderWidth,
        borderRadius: node.borderRadius,
        children: node.children.map(richTextToInlineBoxChild),
      });
    case "inlineRect":
      return omitUndefinedProps({
        type: "InlineRect" as const,
        inlineSizePx: node.inlineSizePx,
        blockSizePx: node.blockSizePx,
        advancePx: node.advancePx,
        blockAlign: node.blockAlign,
        color: node.color,
        borderRadiusPx: node.borderRadiusPx,
        opacity: node.opacity,
        paintOrder: node.paintOrder,
      });
    case "decoratedSpan":
      return omitUndefinedProps({
        type: "Inline" as const,
        ...inlineStyle(node.style),
        paddingInline: node.paddingInline,
        background: node.background,
        borderColor: node.borderColor,
        borderWidth: node.borderWidth,
        borderRadius: node.borderRadius,
        children: node.children.map(richTextToInlineChild),
      });
  }
}

function richTextToInlineChild(node: RichTextNodeInput): InlineSceneNode["children"][number] {
  const textChild = richTextToTextChild(node);
  if (
    typeof textChild === "string" ||
    textChild.type === "Inline" ||
    textChild.type === "InlineRect" ||
    textChild.type === "Ruby"
  ) {
    return textChild;
  }
  return {
    type: "Inline",
    children: textChild.children.map(richTextInlineBoxChildToInlineChild),
  };
}

function richTextToInlineBoxChild(node: RichTextNodeInput): InlineBoxSceneNode["children"][number] {
  return richTextToTextChild(node);
}

function richTextInlineBoxChildToInlineChild(
  child: InlineBoxSceneNode["children"][number],
): InlineSceneNode["children"][number] {
  if (
    typeof child === "string" ||
    child.type === "Inline" ||
    child.type === "InlineRect" ||
    child.type === "Ruby"
  ) {
    return child;
  }
  return {
    type: "Inline",
    children: child.children.map(richTextInlineBoxChildToInlineChild),
  };
}

function flattenRichTextNode(node: RichTextNodeInput): string {
  switch (node.kind) {
    case "text":
    case "span":
    case "combine":
      return node.text;
    case "ruby":
      return [
        ...node.base,
        ...(node.rtLevels && node.rtLevels.length > 0 ? node.rtLevels.flat() : node.rt),
      ]
        .map(flattenRichTextNode)
        .join("");
    case "inlineRect":
      return "";
    case "inlineBox":
    case "decoratedSpan":
      return node.children.map(flattenRichTextNode).join("");
  }
}

function firstRichTextStyle(nodes: RichTextNodeInput[]): RichTextStyleInput | undefined {
  for (const node of nodes) {
    switch (node.kind) {
      case "span":
      case "combine":
      case "ruby":
      case "inlineBox":
      case "decoratedSpan":
        return node.style;
      case "text":
      case "inlineRect":
        break;
    }
  }
  return undefined;
}

function buildTextChildren(req: SpecCase["request"]): TextSceneNode["children"] {
  if (req.rich_text && req.rich_text.length > 0) {
    return req.rich_text.map(richTextToTextChild);
  }
  return [req.text];
}

// ---------------------------------------------------------------------------
// SceneNode construction
// ---------------------------------------------------------------------------

function buildSceneNode(spec: SpecCase, canvasWidth: number, canvasHeight: number): SceneNode {
  const req = spec.request;
  const isVertical = req.writing_mode === "VerticalRl";

  const fit = mapFit(req.fit);
  const preferredFrame =
    fit !== "none" && fit !== undefined
      ? omitUndefinedProps({
          w: isVertical ? undefined : req.max_width,
          h: req.max_height ?? undefined,
        })
      : req.max_height != null
        ? { h: req.max_height }
        : undefined;
  const textNode: TextSceneNode = omitUndefinedProps({
    type: "Text",
    font: req.font_family,
    fontSizePx: req.font_size_px,
    fontWeight: req.font_weight ?? undefined,
    fontStyle: mapFontStyle(req.font_style),
    fontVariationSettings: formatVariationSettings(req.font_variation_settings),
    writingMode: mapWritingMode(req.writing_mode),
    wrap: mapWrap(req.wrap),
    fit,
    maxLines: req.max_lines ?? undefined,
    ellipsis: req.ellipsis ?? undefined,
    language: mapLanguage(req.language),
    lineHeight: req.line_height ?? undefined,
    lineHeightPx: req.line_height_px ?? undefined,
    letterSpacingPx: req.letter_spacing_px ?? undefined,
    hangingPunctuation: req.hanging_punctuation ?? undefined,
    color: "#000000",
    // For fit mode, constrain via preferredFrame so the engine can auto-size.
    // For non-fit mode, Canvas width already constrains.
    preferredFrame,
    children: buildTextChildren(req),
  });

  const canvas: CanvasSceneNode = {
    type: "Canvas",
    width: canvasWidth,
    height: canvasHeight,
    background: "#ffffff",
    children: [textNode],
  };

  return canvas;
}

// ---------------------------------------------------------------------------
// Canvas sizing
// ---------------------------------------------------------------------------

const HEIGHT_MARGIN = 8;

function computeCanvasSize(
  spec: SpecCase,
  btResult?: BtEntry["result"],
): { width: number; height: number } {
  const isVertical = spec.request.writing_mode === "VerticalRl";
  const lineHeight = spec.request.line_height ?? 1.2;
  const estimatedLineH = spec.request.font_size_px * lineHeight;

  if (btResult?.bbox) {
    if (isVertical) {
      return {
        width: Math.ceil(btResult.bbox.w) + HEIGHT_MARGIN,
        height: Math.max(spec.request.max_height ?? 200, Math.ceil(btResult.bbox.h)),
      };
    }
    return {
      width: spec.request.max_width,
      height: Math.ceil(btResult.bbox.h) + HEIGHT_MARGIN,
    };
  }

  // Fallback: generous estimate
  if (isVertical) {
    return {
      width: Math.ceil(estimatedLineH * 5) + HEIGHT_MARGIN,
      height: spec.request.max_height ?? 200,
    };
  }
  return {
    width: spec.request.max_width,
    height: Math.ceil(estimatedLineH * 5) + HEIGHT_MARGIN,
  };
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

type CliArgs = {
  specPath: string;
  fontsDir: string;
  screenshotsDir: string;
  btResultsPath?: string;
  filterIds?: Set<string>;
  scale: number;
};

function parseArgs(argv: string[]): CliArgs {
  let specPath = "";
  let fontsDir = "";
  let screenshotsDir = "";
  let btResultsPath: string | undefined;
  let filterIds: Set<string> | undefined;
  let scale = 1;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--spec":
        specPath = argv[++i] ?? "";
        break;
      case "--fonts":
        fontsDir = argv[++i] ?? "";
        break;
      case "--screenshots":
        screenshotsDir = argv[++i] ?? "";
        break;
      case "--bt-results":
        btResultsPath = argv[++i];
        break;
      case "--ids":
        filterIds = new Set((argv[++i] ?? "").split(",").filter(Boolean));
        break;
      case "--scale":
        scale = Number(argv[++i]) || 1;
        break;
    }
  }

  if (!specPath || !fontsDir || !screenshotsDir) {
    console.error(
      "Usage: tsx src/run.ts --spec <path> --fonts <dir> --screenshots <dir> " +
        "[--bt-results <path>] [--ids id1,id2] [--scale N]",
    );
    process.exit(1);
  }

  return { specPath, fontsDir, screenshotsDir, btResultsPath, filterIds, scale };
}

// ---------------------------------------------------------------------------
// Engine initialisation
// ---------------------------------------------------------------------------

async function initEngine(fontsDir: string): Promise<Engine> {
  const fonts: Array<{
    alias: string;
    weight: number;
    style: "normal" | "italic";
    data: Uint8Array;
  }> = [];

  for (const [alias, filename] of Object.entries(FONT_FILE_MAP)) {
    const fontPath = resolve(fontsDir, filename);
    if (!existsSync(fontPath)) {
      console.warn(`  WARN: font not found: ${fontPath}`);
      continue;
    }
    fonts.push({
      alias,
      weight: 400,
      style: "normal",
      data: new Uint8Array(readFileSync(fontPath)),
    });
  }

  return createEngineAsync({ fonts });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Load spec cases
  const specs: SpecCase[] = JSON.parse(readFileSync(resolve(args.specPath), "utf-8"));
  const filterIds = args.filterIds;
  const filtered = filterIds ? specs.filter((spec) => filterIds.has(spec.id)) : specs;

  if (filtered.length === 0) {
    // No matching cases in this spec file — not an error
    return;
  }

  // Load boundtext results for canvas sizing (optional)
  const btMap = new Map<string, BtEntry["result"]>();
  if (args.btResultsPath && existsSync(args.btResultsPath)) {
    try {
      const entries: BtEntry[] = JSON.parse(readFileSync(args.btResultsPath, "utf-8"));
      for (const e of entries) {
        btMap.set(e.id, e.result);
      }
    } catch {
      console.warn(`  WARN: Could not parse bt-results: ${args.btResultsPath}`);
    }
  }

  // Ensure output directory exists
  mkdirSync(resolve(args.screenshotsDir), { recursive: true });

  // Initialise engine
  const engine = await initEngine(args.fontsDir);

  let rendered = 0;
  let errors = 0;

  try {
    for (const spec of filtered) {
      const { width, height } = computeCanvasSize(spec, btMap.get(spec.id));
      const scene = buildSceneNode(spec, width, height);

      try {
        const pngBytes = engine.renderToPng(scene, {
          scale: args.scale,
          rasterBackground: "#ffffff",
        });
        const outPath = resolve(args.screenshotsDir, `${spec.id}.boundsvg.png`);
        writeFileSync(outPath, pngBytes);
        rendered++;
      } catch (err) {
        console.error(`  ERROR [${spec.id}]: ${err instanceof Error ? err.message : err}`);
        errors++;
      }
    }
  } finally {
    engine.dispose();
  }

  console.info(`  Rendered: ${rendered}  Errors: ${errors}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
