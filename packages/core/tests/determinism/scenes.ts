import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";
import { nativeRichInlineScene } from "../conformance/scenes/native-rich-inline.js";

/**
 * Representative scenes for the determinism golden suite. Each exercises a
 * pipeline area whose output must stay byte-stable within a release: shaping,
 * kinsoku, vertical writing, ruby, fit, grid, gradients/shadows, inline
 * decoration, variable fonts, and font fallback.
 */
export const DETERMINISM_SCENES: Record<string, VNode> = {
  "ja-horizontal-kinsoku": createElement(
    "Canvas",
    { width: 480, height: 200, background: "#ffffff" },
    createElement(
      "Text",
      { font: "NotoSansJP", fontSizePx: 24, color: "#111111", language: "ja", width: 440 },
      "禁則処理のテスト。「約物」が行頭に来ない、ぶら下げ。",
    ),
  ),

  "ja-vertical-ruby": createElement(
    "Canvas",
    { width: 240, height: 320, background: "#fffef8" },
    createElement(
      "Text",
      {
        font: "NotoSansJP",
        fontSizePx: 28,
        color: "#222222",
        language: "ja",
        writingMode: "vertical-rl",
        height: 300,
      },
      "縦書きの",
      createElement("Ruby", {}, "東京", createElement("Rt", {}, "とうきょう")),
      "都",
    ),
  ),

  "fit-shrink": createElement(
    "Canvas",
    { width: 320, height: 120, background: "#ffffff" },
    createElement(
      "Text",
      {
        font: "NotoSansJP",
        fontSizePx: 48,
        color: "#0f172a",
        width: 300,
        height: 100,
        fit: "shrink",
      },
      "長いテキストを箱に収める自動縮小",
    ),
  ),

  "grid-cards": createElement(
    "Canvas",
    { width: 400, height: 240, background: "#161616" },
    createElement(
      "Grid",
      {
        templateColumns: "1fr 1fr",
        templateRows: "1fr 1fr",
        rowGap: 12,
        columnGap: 12,
        width: 400,
        height: 240,
        padding: 16,
      },
      createElement(
        "Box",
        { background: "#2d2d2d", borderRadius: 10, padding: 10 },
        createElement("Text", { font: "JetBrainsMono", fontSizePx: 16, color: "#f8fafc" }, "A1"),
      ),
      createElement(
        "Box",
        { background: "#0f766e", borderRadius: 10, padding: 10 },
        createElement("Text", { font: "JetBrainsMono", fontSizePx: 16, color: "#f8fafc" }, "B1"),
      ),
      createElement(
        "Box",
        { gridColumn: "1 / 3", background: "#1e3a8a", borderRadius: 10, padding: 10 },
        createElement("Text", { font: "NotoSansJP", fontSizePx: 16, color: "#f8fafc" }, "全幅"),
      ),
    ),
  ),

  "gradient-shadow": createElement(
    "Canvas",
    { width: 300, height: 160, background: "#f1f5f9" },
    createElement(
      "Flex",
      { alignItems: "center", justifyContent: "center", width: 300, height: 160 },
      createElement("Box", {
        width: 220,
        height: 100,
        background: "linear-gradient(135deg, #6366f1, #ec4899)",
        borderRadius: 16,
        boxShadow: "0 8 24 rgba(15,23,42,0.35)",
      }),
    ),
  ),

  "inline-decoration": createElement(
    "Canvas",
    { width: 420, height: 140, background: "#ffffff" },
    createElement(
      "Text",
      { font: "NotoSansJP", fontSizePx: 20, color: "#111111", width: 380, language: "ja" },
      "装飾付き",
      createElement(
        "Inline",
        {
          background: "#fde68a",
          borderColor: "#d97706",
          borderWidth: 1,
          borderRadius: [3, 3, 3, 3],
          paddingInline: [4, 4],
          color: "#7c2d12",
        },
        "インライン強調",
      ),
      "が行をまたいでも安定して描画される。",
    ),
  ),

  "variable-font-weights": createElement(
    "Canvas",
    { width: 360, height: 160, background: "#ffffff" },
    createElement(
      "Flex",
      { direction: "column", padding: 12, gap: 6, width: 360, height: 160 },
      createElement(
        "Text",
        { font: "InterVariable", fontSizePx: 22, color: "#111111" },
        "Inter default",
      ),
      createElement(
        "Text",
        {
          font: "InterVariable",
          fontSizePx: 22,
          color: "#111111",
          fontVariationSettings: "'wght' 700",
        },
        "Inter wght 700",
      ),
    ),
  ),

  "fallback-mixed-script": createElement(
    "Canvas",
    { width: 420, height: 100, background: "#ffffff" },
    createElement(
      "Text",
      {
        font: "JetBrainsMono",
        fallback: ["NotoSansJP"],
        fontSizePx: 20,
        color: "#111111",
        width: 400,
      },
      "code_point 混在テキスト fallback",
    ),
  ),

  "letter-spacing-features": createElement(
    "Canvas",
    { width: 360, height: 90, background: "#ffffff" },
    createElement(
      "Text",
      {
        font: "InterVariable",
        fontSizePx: 20,
        color: "#334155",
        letterSpacingPx: 2,
        fontFeatureSettings: "'liga' 0",
      },
      "waffle office 1/2",
    ),
  ),

  "embedded-svg-paths": createElement(
    "Canvas",
    { width: 200, height: 200, background: "#ffffff" },
    createElement("Svg", {
      content:
        '<svg viewBox="0 0 24 24"><path d="M12 2 L22 22 L2 22 Z" fill="#0ea5e9" stroke="#0369a1" stroke-width="1"/></svg>',
      width: 200,
      height: 200,
    }),
  ),

  "z-index-paint-order": createElement(
    "Canvas",
    { width: 200, height: 200, background: "#ffffff" },
    createElement("Path", {
      id: "front",
      zIndex: 2,
      d: "M0 0H120V120H0Z",
      width: 120,
      height: 120,
      fill: "#2563eb",
      position: "absolute",
      top: 20,
      left: 20,
    }),
    createElement("Path", {
      id: "back",
      zIndex: 1,
      d: "M0 0H120V120H0Z",
      width: 120,
      height: 120,
      fill: "#f59e0b",
      position: "absolute",
      top: 60,
      left: 60,
    }),
  ),

  "shape-structural-parts": createElement(
    "Canvas",
    { width: 200, height: 140, background: "#ffffff" },
    createElement("Shape", {
      id: "badge",
      width: 160,
      height: 100,
      fill: "#0f766e",
      stroke: "#134e4a",
      strokeWidth: 2,
      emitPartIds: true,
      geometry: {
        viewBox: { width: 80, height: 50 },
        root: {
          kind: "group",
          children: [
            { kind: "path", nodeId: "plate", d: "M0 0H80V50H0Z" },
            {
              kind: "boolean",
              nodeId: "notch",
              op: "union",
              children: [
                { kind: "path", d: "M10 20H45V35H10Z" },
                { kind: "path", d: "M40 15H70V30H40Z" },
              ],
            },
          ],
        },
      },
      position: "absolute",
      left: 20,
      top: 20,
    }),
  ),

  "shape-defs-sharing": createElement(
    "Canvas",
    { width: 220, height: 90, background: "#ffffff" },
    createElement("Shape", {
      id: "coin-a",
      width: 60,
      height: 60,
      fill: "#f59e0b",
      emitPartIds: true,
      geometry: {
        viewBox: { width: 20, height: 20 },
        root: {
          kind: "group",
          children: [
            { kind: "path", nodeId: "disc", d: "M0 0H20V20H0Z" },
            { kind: "path", nodeId: "slot", d: "M8 4H12V16H8Z" },
          ],
        },
      },
      position: "absolute",
      left: 15,
      top: 15,
    }),
    createElement("Shape", {
      id: "coin-b",
      width: 60,
      height: 60,
      fill: "#f59e0b",
      emitPartIds: true,
      geometry: {
        viewBox: { width: 20, height: 20 },
        root: {
          kind: "group",
          children: [
            { kind: "path", nodeId: "disc", d: "M0 0H20V20H0Z" },
            { kind: "path", nodeId: "slot", d: "M8 4H12V16H8Z" },
          ],
        },
      },
      position: "absolute",
      left: 140,
      top: 15,
    }),
  ),

  "node-metadata": createElement(
    "Canvas",
    { width: 160, height: 120, background: "#ffffff", meta: { scene: "metadata" } },
    createElement("Box", {
      id: "tagged",
      width: 120,
      height: 80,
      background: "#0ea5e9",
      borderRadius: 8,
      meta: { role: "cta", variant: "a" },
    }),
  ),

  "text-effects-telop": createElement(
    "Canvas",
    { width: 360, height: 120, background: "#1a1a1a" },
    createElement(
      "Text",
      {
        font: "NotoSansJP",
        fontSizePx: 40,
        color: "#facc15",
        textStrokes: [
          { color: "#111827", widthPx: 10 },
          { color: "#ffffff", widthPx: 5 },
        ],
        textShadows: [{ dx: 3, dy: 3, blurPx: 4, color: "#000000" }],
      },
      "縁取り文字",
    ),
  ),

  // Animated channels (opacity + center-pivot transform): the animated WebP
  // and GIF encoders must produce identical container bytes across runtimes.
  "animated-opacity-motion": createElement(
    "Canvas",
    { width: 240, height: 120, background: "#ffffff" },
    createElement(
      "Box",
      {
        width: 80,
        height: 40,
        background: "#2563eb",
        borderRadius: 8,
        animation: {
          keyframes: [
            { at: 0, opacity: 0.2, transform: { translateX: 0 } },
            { at: 1, opacity: 1, transform: { translateX: 120 } },
          ],
          durationMs: 300,
        },
      },
      createElement("Text", { font: "NotoSansJP", fontSizePx: 14, color: "#ffffff" }, "動く"),
    ),
  ),

  // Promoted conformance scene (see tests/conformance/scenes). It must only use
  // fonts the browser e2e harness registers: NotoSansJP / JetBrainsMono /
  // InterVariable — and stay JSON-serializable (no Uint8Array images), since
  // e2e/fixtures/determinism-scenes.json carries the same tree.
  "conformance-rich-inline": nativeRichInlineScene.build(),
};
