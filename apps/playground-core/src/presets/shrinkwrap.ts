import { Box, Canvas, Text, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import {
  buildShrinkwrapEnglishSection,
  buildShrinkwrapRubySection,
  buildShrinkwrapVerticalSection,
} from "../shrinkwrap-helpers";
import type { Preset } from "../types";

/** Demonstrates horizontal and vertical text shrinkwrap with ruby, rich text, and flow exclusions. */
export const shrinkwrapPreset: Preset = {
  title: "Shrinkwrap",
  description:
    "Minimum-size sizing for horizontal and vertical text. Plain paragraph (left), ruby caption (center), vertical-rl plain/flow (right), and vertical richText shrinkwrap with ruby + decoratedSpan (far right).",
  source: `import type { RichTextNode } from "@boundsvg/core";

const fontFamily = "${FA}";
const text = "縦組みABC123。句読点と英数字の向きを見ながら高さだけを詰める。";
const captionText = "春はあけぼの。白くなりゆく山際、紫だちたる雲の細くたなびきたる。夏は夜。";

// Plain text shrinkwrap — find tightest width for same line count
const shrinkwrap = engine.shrinkwrapText({
  text, fontFamily, fontSizePx: 14, lineHeight: 1.5,
  language: "ja", wrap: "char", maxWidth: 260,
});
// shrinkwrap.chosenWidthPx — minimum width preserving line count

// Vertical plain shrinkwrap — keep width fixed, shrink height only
const vertical = engine.shrinkwrapText({
  text, fontFamily, fontSizePx: 16, lineHeight: 1.4,
  language: "ja", wrap: "char", writingMode: "vertical-rl",
  textOrientation: "upright", maxWidth: 120, maxHeight: 160,
});
// vertical.chosenHeightPx — minimum height preserving column count

// Resolved style uses the same font and paint as the vertical example.
const richStyle = {
  font: fontFamily, fontWeight: 400, fontStyle: "normal",
  fontSizePx: 16, color: "#e2e8f0", letterSpacingPx: 0,
} satisfies Extract<RichTextNode, { kind: "ruby" }>["style"];

// Vertical richText shrinkwrap — ruby + decoratedSpan
const rich = engine.shrinkwrapText({
  text: "", fontFamily, fontSizePx: 16, lineHeight: 1.4,
  language: "ja", wrap: "char", writingMode: "vertical-rl",
  textOrientation: "upright", maxWidth: 120, maxHeight: 160, minHeight: 48,
  richText: [
    { kind: "ruby", style: richStyle,
      base: [{ kind: "text", text: "星空" }],
      rt: [{ kind: "span", text: "ほしぞら", style: { ...richStyle, fontSizePx: 8 } }] },
    { kind: "text", text: "を" },
    { kind: "decoratedSpan",
      style: richStyle, background: "#1e3a5f",
      paddingInline: [2, 2], borderRadius: [3, 3, 3, 3],
      children: [{ kind: "text", text: "見上げる" }] },
    { kind: "text", text: "夜明け前" },
  ],
});

// Caption shrinkwrap — flow text around a figure thumbnail
const caption = engine.shrinkwrapFlow({
  text: captionText, fontFamily, fontSizePx: 12,
  lineHeight: 1.6, language: "ja", wrap: "char",
  flowBox: { x: 0, y: 0, width: 350, height: 200 },
  exclusions: [
    { kind: "rect", x: 0, y: 0, width: 50, height: 50, marginPx: 6 },
  ],
});
// caption.chosenWidthPx — tightest caption width
// Use caption.layout for the final fragment positions`,
  build: (engine?) => {
    const canvasWidth = 1080;
    const canvasHeight = 420;
    if (!engine) {
      return Canvas({ width: canvasWidth, height: canvasHeight, background: "#1a1a1a" });
    }
    const children: VNode[] = [];

    // Title
    children.push(
      Box(
        { position: "absolute", left: 16, top: 8 },
        Text({ font: FA, fontSizePx: 11, color: "#475569" }, "English (word wrap)"),
      ),
    );
    children.push(
      Box(
        { position: "absolute", left: 270, top: 8 },
        Text({ font: FA, fontSizePx: 11, color: "#475569" }, "Ruby (char wrap)"),
      ),
    );
    children.push(
      Box(
        { position: "absolute", left: 640, top: 8 },
        Text({ font: FA, fontSizePx: 11, color: "#475569" }, "Vertical-rl plain + flow"),
      ),
    );
    children.push(
      Box(
        { position: "absolute", left: 940, top: 8 },
        Text({ font: FA, fontSizePx: 11, color: "#475569" }, "Vertical richText"),
      ),
    );
    // Dividers
    children.push(
      Box({
        position: "absolute",
        left: 254,
        top: 20,
        width: 1,
        height: canvasHeight - 30,
        background: "#2d2d2d",
      }),
    );
    children.push(
      Box({
        position: "absolute",
        left: 624,
        top: 20,
        width: 1,
        height: canvasHeight - 30,
        background: "#2d2d2d",
      }),
    );
    children.push(
      Box({
        position: "absolute",
        left: 924,
        top: 20,
        width: 1,
        height: canvasHeight - 30,
        background: "#2d2d2d",
      }),
    );

    buildShrinkwrapEnglishSection(engine, children, 40);
    buildShrinkwrapRubySection(engine, children, 270, 40);
    buildShrinkwrapVerticalSection(engine, children, 640, 40);

    return Canvas({ width: canvasWidth, height: canvasHeight, background: "#1a1a1a" }, ...children);
  },
};
