import { Box, Canvas, Text, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import {
  buildFlowRichSection,
  buildFlowRubySection,
  buildFlowVerticalSection,
} from "../flow-section-builders";
import type { Preset } from "../types";

export const flowRichPreset: Preset = {
  title: "Flow Rich, Vertical & Ruby",
  description:
    "Rich text spans (left), vertical-rl columns with an intentional missing-glyph tofu marker (center), and ruby annotations (right). Drag obstacles to reflow.",
  source: `import { Box, Canvas, Text } from "@boundsvg/core";

// Rich text spans: mixed sizes and colors with obstacle avoidance
const result = engine.layoutTextFlowWithExclusions({
  fontFamily: "${FA}", fontSizePx: 14, lineHeight: 1.5,
  text: "", language: "ja", wrap: "char",
  flowBox: { x: 16, y: 30, width: 252, height: 240 },
  exclusions: [{ kind: "circle", cx: 200, cy: 100, r: 40, marginPx: 6 }],
  spans: [
    { text: "枕草子", fontSizePx: 20, color: "#fbbf24" },
    { text: "　春はあけぼの。やうやう白くなりゆく山際、少し明かりて、" },
    { text: "紫だちたる雲", color: "#a78bfa" },
    { text: "の細くたなびきたる。…" },
  ],
});

// Each fragment carries style overrides from its originating span
const children = [];
const lhPx = 14 * 1.5;
for (const line of result.lines) {
  for (const frag of line.fragments) {
    const fontSize = frag.style?.fontSizePx ?? 14;
    const color = frag.style?.color ?? "#e2e8f0";
    children.push(
      Box(
        { position: "absolute", left: frag.x, top: frag.y,
          width: frag.availableInlineSizePx, height: lhPx, overflow: "clip" },
        Text({ font: "${FA}", fontSizePx: fontSize, color,
          language: "ja", wrap: "none", lineHeight: 1 }, frag.text),
      ),
    );
  }
}

// Vertical-rl columns with rect obstacle
const vert = engine.layoutTextFlowWithExclusions({
  text: "祇園精舎の鐘の声、諸行無常の響きあり。…",
  fontFamily: "${FA}", fontSizePx: 14, lineHeight: 1.5,
  language: "ja", wrap: "char", writingMode: "vertical-rl",
  flowBox: { x: 300, y: 30, width: 236, height: 240 },
  exclusions: [{ kind: "rect", x: 460, y: 100, width: 60, height: 70, marginPx: 6 }],
});

// Ruby annotations with obstacle
const ruby = engine.layoutTextFlowWithExclusions({
  fontFamily: "${FA}", fontSizePx: 15, lineHeight: 1.9,
  text: "", language: "ja", wrap: "char",
  flowBox: { x: 564, y: 30, width: 260, height: 240 },
  exclusions: [{ kind: "rect", x: 720, y: 60, width: 90, height: 50, marginPx: 6 }],
  spans: [
    { text: "枕草子", rubyText: "まくらのそうし", rubyFontSizePx: 7 },
    { text: "　" },
    { text: "春", rubyText: "はる", rubyFontSizePx: 7 },
    { text: "はあけぼの。…" },
  ],
});

const vnode = Canvas(
  { width: 840, height: 280, background: "#1a1a1a" },
  ...children,
);

const svg = engine.renderToSvg(vnode);`,
  build: (engine?) => {
    const canvasWidth = 840;
    const canvasHeight = 280;
    if (!engine) {
      return Canvas({ width: canvasWidth, height: canvasHeight, background: "#1a1a1a" });
    }

    const children: VNode[] = [];

    // --- Section labels ---
    children.push(
      Box(
        { position: "absolute", left: 16, top: 8 },
        Text({ font: FA, fontSizePx: 11, color: "#475569" }, "Rich Text (drag)"),
      ),
    );
    children.push(
      Box(
        { position: "absolute", left: 560, top: 8 },
        Text({ font: FA, fontSizePx: 11, color: "#475569" }, "Ruby (drag)"),
      ),
    );
    // Dividers
    children.push(
      Box({
        position: "absolute",
        left: 284,
        top: 26,
        width: 1,
        height: canvasHeight - 36,
        background: "#2d2d2d",
      }),
    );
    children.push(
      Box({
        position: "absolute",
        left: 550,
        top: 26,
        width: 1,
        height: canvasHeight - 36,
        background: "#2d2d2d",
      }),
    );

    buildFlowRichSection(engine, children, canvasHeight);
    buildFlowVerticalSection(engine, children, canvasHeight);
    buildFlowRubySection(engine, children, canvasHeight);

    return Canvas({ width: canvasWidth, height: canvasHeight, background: "#1a1a1a" }, ...children);
  },
};
