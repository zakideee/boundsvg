import {
  Box,
  Canvas,
  type Engine,
  geometryToFlowExclusion,
  Shape,
  Text,
  type VNode,
} from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import { renderFlowWarnings } from "../flow-helpers";
import type { Preset } from "../types";
import { CALLOUT_GEOMETRY } from "./shape-defs";

const CANVAS_W = 920;
const CANVAS_H = 340;
const FLOW = { x: 48, y: 64, width: 824, height: 240 };
const BUBBLE = { x: 560, y: 96, width: 260, height: 156 };
const FONT_SIZE = 14;
const LINE_HEIGHT = 1.7;

const BODY_TEXT =
  "つれづれなるままに、日暮らし、硯にむかひて、心にうつりゆくよしなし事を、そこはかとなく書きつくれば、あやしうこそものぐるほしけれ。" +
  "いでや、この世に生まれては、願はしかるべき事こそ多かめれ。文字の流れは吹き出しの実輪郭を避けて回り込み、尻尾のくぼみにも追従する。".repeat(
    2,
  );

function buildBubbleFlowCanvas(engine?: Engine): VNode {
  const children: VNode[] = [
    Text(
      {
        font: FA,
        fontSizePx: 13,
        color: "#94a3b8",
        width: 700,
        wrap: "none",
        position: "absolute",
        left: FLOW.x,
        top: 28,
      },
      "One GeometryDoc drives both the drawn bubble and its text exclusion (geometryToFlowExclusion)",
    ),
    Shape({
      geometry: CALLOUT_GEOMETRY,
      width: BUBBLE.width,
      height: BUBBLE.height,
      fill: "#1e3a5f",
      stroke: "#38bdf8",
      strokeWidth: 2,
      position: "absolute",
      left: BUBBLE.x,
      top: BUBBLE.y,
    }),
    Text(
      {
        font: FA,
        fontSizePx: 15,
        color: "#7dd3fc",
        width: BUBBLE.width - 48,
        wrap: "char",
        position: "absolute",
        left: BUBBLE.x + 24,
        top: BUBBLE.y + 34,
        language: "ja",
      },
      "吹き出しの中には流れ込まない",
    ),
  ];

  if (engine) {
    const exclusion = geometryToFlowExclusion(CALLOUT_GEOMETRY, {
      ...BUBBLE,
      marginPx: 12,
    });
    const result = engine.layoutTextFlowWithExclusions({
      text: BODY_TEXT,
      fontFamily: FA,
      fontSizePx: FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      language: "ja",
      wrap: "char",
      flowBox: FLOW,
      exclusions: [exclusion],
    });
    children.push(
      ...renderFlowWarnings(
        result.warnings,
        FLOW.x,
        FLOW.y - 14,
        "Tofu demo (intentional): 硯 — see console",
      ),
    );
    const lineHeightPx = FONT_SIZE * LINE_HEIGHT;
    for (const line of result.lines) {
      for (const fragment of line.fragments) {
        children.push(
          Box(
            {
              position: "absolute",
              left: fragment.x,
              top: fragment.y,
              width: fragment.availableInlineSizePx,
              height: lineHeightPx,
              overflow: "clip",
            },
            Text(
              {
                font: FA,
                fontSizePx: FONT_SIZE,
                color: "#e2e8f0",
                language: "ja",
                wrap: "none",
                lineHeight: 1,
              },
              fragment.text,
            ),
          ),
        );
      }
    }
  }

  return Canvas({ width: CANVAS_W, height: CANVAS_H, background: "#1a1a1a" }, ...children);
}

export const bubbleFlowPreset: Preset = {
  title: "Bubble Flow",
  description:
    "A speech bubble (CALLOUT_GEOMETRY) drawn as a Shape while geometryToFlowExclusion derives the text exclusion from the same GeometryDoc. The body includes an intentional missing-glyph tofu marker for 硯.",
  source: `import { Canvas, Shape, Text, geometryToFlowExclusion } from "@boundsvg/core";

// The SAME GeometryDoc renders the bubble and excludes the body text.
const bubble = { x: 560, y: 96, width: 260, height: 156 };
const exclusion = geometryToFlowExclusion(CALLOUT_GEOMETRY, { ...bubble, marginPx: 12 });

const result = engine.layoutTextFlowWithExclusions({
  text: "つれづれなるままに、日暮らし、硯にむかひて…",
  fontFamily: "${FA}", fontSizePx: 14, lineHeight: 1.7,
  language: "ja", wrap: "char",
  flowBox: { x: 48, y: 64, width: 824, height: 240 },
  exclusions: [exclusion],
});

// Draw the bubble with the same geometry
const bubbleShape = Shape({ geometry: CALLOUT_GEOMETRY, ...bubble,
  fill: "#1e3a5f", stroke: "#38bdf8", strokeWidth: 2, position: "absolute" });`,
  build: (engine?: Engine) => buildBubbleFlowCanvas(engine),
};
