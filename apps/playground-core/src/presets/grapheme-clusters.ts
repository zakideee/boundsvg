import { Box, Canvas, Flex, Text, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

// Every character below is a full-width cluster, so EVERY wrap / truncation
// boundary is a cluster decision. The combining row uses base + U+3099
// (combining voiced sound mark, 2 code points per cluster); the precomposed
// row is the single-code-point equivalent. Grapheme-safe segmentation makes
// both rows break at identical positions - with per-code-point splitting the
// combining row could strand a bare mark at a line head.
const PRECOMPOSED = "がぎぐげご".repeat(5);
const COMBINING_SEQ = "か\u{3099}き\u{3099}く\u{3099}け\u{3099}こ\u{3099}".repeat(5);

const TILE_WIDTH = 276;
const TILE_HEIGHT = 288;
const PREVIEW_HEIGHT = 170;
const PREVIEW_TEXT_WIDTH = TILE_WIDTH - 24 - 20;

function tile(title: string, subtitle: string, preview: VNode) {
  return Box(
    {
      width: TILE_WIDTH,
      height: TILE_HEIGHT,
      padding: 12,
      background: "#0f172a",
      borderWidth: 1,
      borderColor: "#334155",
      borderRadius: 16,
    },
    Flex(
      {
        direction: "column",
        width: TILE_WIDTH - 24,
        height: TILE_HEIGHT - 24,
        gap: 10,
      },
      Box(
        {
          width: TILE_WIDTH - 24,
          height: PREVIEW_HEIGHT,
          padding: 10,
          borderWidth: 1,
          borderColor: "#1e293b",
          borderRadius: 12,
          background: "#111827",
          overflow: "clip",
        },
        preview,
      ),
      Text({ font: FA, fontSizePx: 14, color: "#e2e8f0" }, title),
      Text(
        {
          font: FA,
          fontSizePx: 11,
          color: "#64748b",
          wrap: "char",
          lineHeight: 1.35,
          width: TILE_WIDTH - 24,
        },
        subtitle,
      ),
    ),
  );
}

function wrapText(text: string, maxLines: number, ellipsis = false): VNode {
  return Text(
    {
      font: FA,
      fontSizePx: 15,
      color: "#f8fafc",
      wrap: "char",
      width: PREVIEW_TEXT_WIDTH,
      maxLines,
      ...(ellipsis ? { ellipsis: true } : {}),
      language: "ja",
    },
    text,
  );
}

function pairedPreview(precomposed: VNode, combining: VNode) {
  return Flex(
    { direction: "column", gap: 6, width: PREVIEW_TEXT_WIDTH },
    Text({ font: FA, fontSizePx: 10, color: "#64748b" }, "precomposed が (1 code point)"),
    precomposed,
    Text({ font: FA, fontSizePx: 10, color: "#64748b" }, "combining か+\u3099 (2 code points)"),
    combining,
  );
}

function buildGraphemeCanvas() {
  return Canvas(
    { width: 920, height: 360, background: "#1a1a1a" },
    Flex(
      {
        direction: "row",
        width: 920,
        height: 360,
        padding: 24,
        gap: 18,
        justifyContent: "center",
        alignItems: "center",
      },
      tile(
        "char-wrap",
        "Precomposed (top) and base+mark rows wrap at identical positions; no bare mark ever starts a line.",
        pairedPreview(wrapText(PRECOMPOSED, 3), wrapText(COMBINING_SEQ, 3)),
      ),
      tile(
        "ellipsis",
        "Both rows truncate after the same cluster count; the mark is never separated from its base at the cut.",
        pairedPreview(
          wrapText(PRECOMPOSED + PRECOMPOSED, 2, true),
          wrapText(COMBINING_SEQ + COMBINING_SEQ, 2, true),
        ),
      ),
      tile(
        "vertical columns",
        "Vertical column breaks use the same cluster units: identical column pattern for both rows.",
        Flex(
          { direction: "row", gap: 12, width: PREVIEW_TEXT_WIDTH, height: PREVIEW_HEIGHT - 20 },
          Text(
            {
              font: FA,
              fontSizePx: 15,
              color: "#94a3b8",
              writingMode: "vertical-rl",
              height: PREVIEW_HEIGHT - 20,
              language: "ja",
            },
            PRECOMPOSED,
          ),
          Text(
            {
              font: FA,
              fontSizePx: 15,
              color: "#f8fafc",
              writingMode: "vertical-rl",
              height: PREVIEW_HEIGHT - 20,
              language: "ja",
            },
            COMBINING_SEQ,
          ),
        ),
      ),
    ),
  );
}

export const graphemeClustersPreset: Preset = {
  title: "Grapheme Clusters",
  description:
    "UAX#29 grapheme-safe segmentation in the shipped WASM: char-wrap, ellipsis, and vertical column breaking treat combining-mark sequences (and ZWJ emoji / flags) as single units.",
  source: `import { Canvas, Text } from "@boundsvg/core";

// Two visually identical rows: precomposed "が" (1 code point) vs
// base + U+3099 combining mark (2 code points per cluster).
// Grapheme-safe segmentation wraps and truncates both at the SAME
// positions - a bare combining mark never starts a line.
const precomposed = "がぎぐげご".repeat(5);
const combining = "か\\u{3099}き\\u{3099}く\\u{3099}け\\u{3099}こ\\u{3099}".repeat(5);

const vnode = Canvas(
  { width: 920, height: 360, background: "#1a1a1a" },
  Text({ font: "${FA}", fontSizePx: 15, wrap: "char", width: 232,
    maxLines: 3, language: "ja" }, precomposed),
  Text({ font: "${FA}", fontSizePx: 15, wrap: "char", width: 232,
    maxLines: 3, language: "ja" }, combining),
);

const svg = engine.renderToSvg(vnode);`,
  build: () => buildGraphemeCanvas(),
};
