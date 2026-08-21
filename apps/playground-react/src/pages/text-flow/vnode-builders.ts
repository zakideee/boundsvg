import {
  Box,
  Canvas,
  type Engine,
  type GeometryDoc,
  geometryToFlowExclusion,
  Path,
  Shape,
  Text,
  type VNode,
} from "@boundsvg/core";

// One geometry drives both the drawn circle obstacle and its text exclusion.
const CIRCLE_KAPPA = 27.614237;
const CIRCLE_GEOMETRY: GeometryDoc = {
  viewBox: { width: 100, height: 100 },
  root: {
    kind: "path",
    d:
      `M50 0C${50 + CIRCLE_KAPPA} 0 100 ${50 - CIRCLE_KAPPA} 100 50` +
      `C100 ${50 + CIRCLE_KAPPA} ${50 + CIRCLE_KAPPA} 100 50 100` +
      `C${50 - CIRCLE_KAPPA} 100 0 ${50 + CIRCLE_KAPPA} 0 50` +
      `C0 ${50 - CIRCLE_KAPPA} ${50 - CIRCLE_KAPPA} 0 50 0Z`,
  },
};

import {
  FA,
  renderFlowFragments,
  renderFlowWarnings,
  renderRubyFlowFragments,
  renderStyledFlowFragments,
  renderVerticalColumnFragments,
  renderVerticalFlowFragments,
} from "../shared/flow-rendering";
import type { FlowObstacles, FlowRichObstacles } from "./obstacle-types";

// ---------------------------------------------------------------------------
// Text Flow preset
// ---------------------------------------------------------------------------

export function buildTextFlowVNode(engine: Engine, obs: FlowObstacles): VNode {
  const canvasWidth = 1120;
  const canvasHeight = 360;
  const children: VNode[] = [];

  // Section labels
  children.push(
    Box(
      { position: "absolute", left: 16, top: 10, width: 372 },
      Text(
        { font: FA, fontSizePx: 11, color: "#475569", wrap: "none" },
        "Ellipsis + maxLines (drag)",
      ),
    ),
  );
  children.push(
    Box(
      { position: "absolute", left: 420, top: 10, width: 364 },
      Text({ font: FA, fontSizePx: 11, color: "#475569", wrap: "none" }, "Fit Shrink (drag)"),
    ),
  );
  children.push(
    Box(
      { position: "absolute", left: 810, top: 10, width: 140 },
      Text(
        { font: FA, fontSizePx: 10, color: "#475569", wrap: "none" },
        "Vertical ellipsis + maxLines",
      ),
    ),
  );
  children.push(
    Box(
      { position: "absolute", left: 970, top: 10, width: 120 },
      Text({ font: FA, fontSizePx: 10, color: "#475569", wrap: "none" }, "Vertical fit-shrink"),
    ),
  );
  // Dividers
  children.push(
    Box({
      position: "absolute",
      left: 404,
      top: 30,
      width: 1,
      height: canvasHeight - 40,
      background: "#2d2d2d",
    }),
  );
  children.push(
    Box({
      position: "absolute",
      left: 794,
      top: 30,
      width: 1,
      height: canvasHeight - 40,
      background: "#2d2d2d",
    }),
  );

  // Left: obstacle avoidance + ellipsis
  {
    const fontSize = 14;
    const lineHeight = 1.5;
    const rect = obs.leftRect;
    const circ = obs.leftCirc;
    const text =
      "春はあけぼの。やうやう白くなりゆく山際、少し明かりて、紫だちたる雲の細くたなびきたる。" +
      "夏は夜。月のころはさらなり、闇もなほ、蛍の多く飛びちがひたる。" +
      "また、ただ一つ二つなど、ほのかにうち光りて行くもをかし。";
    try {
      const result = engine.layoutTextFlowWithExclusions({
        text,
        fontFamily: FA,
        fontSizePx: fontSize,
        lineHeight: lineHeight,
        language: "ja",
        wrap: "char",
        maxLines: 7,
        ellipsis: true,
        flowBox: { x: 16, y: 36, width: 372, height: canvasHeight - 46 },
        exclusions: [
          { kind: "rect", x: rect.x, y: rect.y, width: rect.w, height: rect.h, marginPx: 8 },
          geometryToFlowExclusion(CIRCLE_GEOMETRY, {
            x: circ.cx - circ.r,
            y: circ.cy - circ.r,
            width: circ.r * 2,
            height: circ.r * 2,
            marginPx: 8,
          }),
        ],
      });
      children.push(...renderFlowWarnings(result.warnings, 16, 24));
      children.push(
        Box({
          position: "absolute",
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          background: "#1e3a5f",
          borderRadius: 6,
        }),
      );
      children.push(
        Shape({
          geometry: CIRCLE_GEOMETRY,
          width: circ.r * 2,
          height: circ.r * 2,
          fill: "#1e3a5f",
          position: "absolute",
          left: circ.cx - circ.r,
          top: circ.cy - circ.r,
        }),
      );
      renderFlowFragments(children, result, fontSize, lineHeight, "#e2e8f0");
    } catch (error) {
      children.push(
        Box(
          { position: "absolute", left: 16, top: 40 },
          Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
        ),
      );
    }
  }

  // Right: fit shrink
  {
    const fitRect = obs.rightRect;
    const fitText =
      "名前はまだ無い。どこで生まれたかとんと見当がつかぬ。何でも薄暗いじめじめした所で泣いていた事だけは記憶している。";
    try {
      const result = engine.layoutTextFlowWithExclusions({
        text: fitText,
        fontFamily: FA,
        fontSizePx: 22,
        lineHeight: 1.4,
        language: "ja",
        wrap: "char",
        fit: "shrink",
        minFontSizePx: 8,
        flowBox: { x: 420, y: 36, width: 364, height: canvasHeight - 46 },
        exclusions: [
          {
            kind: "rect",
            x: fitRect.x,
            y: fitRect.y,
            width: fitRect.w,
            height: fitRect.h,
            marginPx: 8,
          },
        ],
      });
      children.push(...renderFlowWarnings(result.warnings, 420, 24));
      children.push(
        Box({
          position: "absolute",
          left: fitRect.x,
          top: fitRect.y,
          width: fitRect.w,
          height: fitRect.h,
          background: "#1e3a5f",
          borderRadius: 6,
        }),
      );
      const chosenSize = result.chosenFontSizePx ?? 22;
      children.push(
        Box(
          { position: "absolute", left: fitRect.x + 8, top: fitRect.y + 8, width: 64 },
          Text(
            { font: FA, fontSizePx: 10, color: "#64748b", wrap: "none" },
            `${chosenSize.toFixed(1)}px`,
          ),
        ),
      );
      renderFlowFragments(children, result, chosenSize, 1.4, "#e2e8f0");
    } catch (error) {
      children.push(
        Box(
          { position: "absolute", left: 420, top: 40 },
          Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
        ),
      );
    }
  }

  // Vertical: ellipsis + maxLines
  {
    const vText =
      "春はあけぼの。やうやう白くなりゆく山際、少し明かりて、紫だちたる雲の細くたなびきたる。" +
      "夏は夜。月のころはさらなり、闇もなほ、蛍の多く飛びちがひたる。";
    try {
      const result = engine.layoutTextFlowWithExclusions({
        text: vText,
        fontFamily: FA,
        fontSizePx: 14,
        lineHeight: 1.5,
        language: "ja",
        wrap: "char",
        writingMode: "vertical-rl",
        maxLines: 4,
        ellipsis: true,
        flowBox: { x: 0, y: 0, width: 140, height: canvasHeight - 46 },
        exclusions: [],
      });
      children.push(
        Box({
          position: "absolute",
          left: 810,
          top: 30,
          width: 140,
          height: canvasHeight - 46,
          borderColor: "#474747",
          borderWidth: 1,
        }),
      );
      renderVerticalFlowFragments(children, result, 14, 1.5, "#e2e8f0", 810, 30);
      children.push(
        Box(
          { position: "absolute", left: 810, top: canvasHeight - 12, width: 140 },
          Text(
            { font: FA, fontSizePx: 9, color: "#64748b", wrap: "none" },
            `${result.usedLineCount} cols · maxLines=4`,
          ),
        ),
      );
    } catch (error) {
      children.push(
        Box(
          { position: "absolute", left: 810, top: 40 },
          Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
        ),
      );
    }
  }

  // Vertical: fit shrink
  {
    const vFitText =
      "名前はまだ無い。どこで生まれたかとんと見当がつかぬ。何でも薄暗いじめじめした所で泣いていた事だけは記憶している。";
    try {
      const result = engine.layoutTextFlowWithExclusions({
        text: vFitText,
        fontFamily: FA,
        fontSizePx: 20,
        lineHeight: 1.5,
        language: "ja",
        wrap: "char",
        writingMode: "vertical-rl",
        fit: "shrink",
        minFontSizePx: 8,
        flowBox: { x: 0, y: 0, width: 120, height: canvasHeight - 46 },
        exclusions: [],
      });
      children.push(
        Box({
          position: "absolute",
          left: 970,
          top: 30,
          width: 120,
          height: canvasHeight - 46,
          borderColor: "#474747",
          borderWidth: 1,
        }),
      );
      const chosenSize = result.chosenFontSizePx ?? 20;
      renderVerticalFlowFragments(children, result, chosenSize, 1.5, "#e2e8f0", 970, 30);
      children.push(
        Box(
          { position: "absolute", left: 970, top: canvasHeight - 12, width: 120 },
          Text(
            { font: FA, fontSizePx: 9, color: "#64748b", wrap: "none" },
            `fit: ${chosenSize.toFixed(1)}px`,
          ),
        ),
      );
    } catch (error) {
      children.push(
        Box(
          { position: "absolute", left: 970, top: 40 },
          Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
        ),
      );
    }
  }

  return Canvas({ width: canvasWidth, height: canvasHeight, background: "#1a1a1a" }, ...children);
}

// ---------------------------------------------------------------------------
// Flow Rich preset
// ---------------------------------------------------------------------------

function buildRichSection(
  engine: Engine,
  children: VNode[],
  obs: FlowRichObstacles,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const circ = obs.richCirc;
  try {
    const result = engine.layoutTextFlowWithExclusions({
      fontFamily: FA,
      fontSizePx: 14,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      text: "",
      flowBox: { x: 16, y: 30, width: 252, height: canvasHeight - 40 },
      exclusions: [{ kind: "circle", cx: circ.cx, cy: circ.cy, r: circ.r, marginPx: 6 }],
      spans: [
        { text: "枕草子", fontSizePx: 20, color: "#fbbf24" },
        { text: "　春はあけぼの。やうやう白くなりゆく山際、少し明かりて、" },
        { text: "紫だちたる雲", color: "#a78bfa" },
        {
          text: "の細くたなびきたる。夏は夜。月のころはさらなり、闇もなほ、蛍の多く飛びちがひたる。また、ただ一つ二つなど、ほのかにうち光りて行くもをかし。雨など降るもをかし。",
        },
      ],
    });
    children.push(...renderFlowWarnings(result.warnings, 16, 18));
    const circlePathData = `M ${circ.cx - circ.r} ${circ.cy} A ${circ.r} ${circ.r} 0 1 1 ${circ.cx + circ.r} ${circ.cy} A ${circ.r} ${circ.r} 0 1 1 ${circ.cx - circ.r} ${circ.cy} Z`;
    children.push(
      Path({ d: circlePathData, width: canvasWidth, height: canvasHeight, fill: "#1e3a5f" }),
    );
    renderStyledFlowFragments(children, result, 14, 1.5, "#e2e8f0");
  } catch (error) {
    children.push(
      Box(
        { position: "absolute", left: 16, top: 34 },
        Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
      ),
    );
  }
}

function buildVerticalSection(
  engine: Engine,
  children: VNode[],
  obs: FlowRichObstacles,
  canvasHeight: number,
): void {
  const fontSize = 14;
  const lineHeight = 1.5;
  const rect = obs.verticalRect;
  const text =
    "祇園精舎の鐘の声、諸行無常の響きあり。沙羅双樹の花の色、盛者必衰の理をあらはす。おごれる人も久しからず、ただ春の夜の夢のごとし。たけき者も遂にはほろびぬ。";
  try {
    const result = engine.layoutTextFlowWithExclusions({
      text,
      fontFamily: FA,
      fontSizePx: fontSize,
      lineHeight: lineHeight,
      language: "ja",
      wrap: "char",
      writingMode: "vertical-rl",
      flowBox: { x: 300, y: 30, width: 236, height: canvasHeight - 40 },
      exclusions: [
        { kind: "rect", x: rect.x, y: rect.y, width: rect.w, height: rect.h, marginPx: 6 },
      ],
    });
    children.push(
      ...renderFlowWarnings(result.warnings, 300, 6, "Vertical-RL (drag) · tofu demo: 祇"),
    );
    children.push(
      Box({
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        background: "#1e3a5f",
        borderRadius: 4,
      }),
    );
    renderVerticalColumnFragments(children, result, fontSize, lineHeight, "#e2e8f0");
  } catch (error) {
    children.push(
      Box(
        { position: "absolute", left: 300, top: 34 },
        Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
      ),
    );
  }
}

function buildRubySection(
  engine: Engine,
  children: VNode[],
  obs: FlowRichObstacles,
  canvasHeight: number,
): void {
  const fontSize = 15;
  const lineHeight = 1.9;
  const rubyRect = obs.rubyRect;
  try {
    const result = engine.layoutTextFlowWithExclusions({
      fontFamily: FA,
      fontSizePx: fontSize,
      lineHeight: lineHeight,
      language: "ja",
      wrap: "char",
      text: "",
      flowBox: { x: 564, y: 30, width: 260, height: canvasHeight - 40 },
      exclusions: [
        {
          kind: "rect",
          x: rubyRect.x,
          y: rubyRect.y,
          width: rubyRect.w,
          height: rubyRect.h,
          marginPx: 6,
        },
      ],
      spans: [
        { text: "枕草子", rubyText: "まくらのそうし", rubyFontSizePx: 7 },
        { text: "　" },
        { text: "春", rubyText: "はる", rubyFontSizePx: 7 },
        { text: "はあけぼの。" },
        { text: "白", rubyText: "しろ", rubyFontSizePx: 7 },
        { text: "くなりゆく" },
        { text: "山際", rubyText: "やまぎわ", rubyFontSizePx: 7 },
        { text: "、" },
        { text: "紫", rubyText: "むらさき", rubyFontSizePx: 7, color: "#a78bfa" },
        { text: "だちたる" },
        { text: "雲", rubyText: "くも", rubyFontSizePx: 7 },
        { text: "の" },
        { text: "細", rubyText: "ほそ", rubyFontSizePx: 7 },
        { text: "くたなびきたる。" },
        { text: "夏", rubyText: "なつ", rubyFontSizePx: 7 },
        { text: "は" },
        { text: "夜", rubyText: "よる", rubyFontSizePx: 7 },
        { text: "。" },
        { text: "月", rubyText: "つき", rubyFontSizePx: 7 },
        { text: "のころはさらなり、" },
        { text: "闇", rubyText: "やみ", rubyFontSizePx: 7 },
        { text: "もなほ、" },
        { text: "蛍", rubyText: "ほたる", rubyFontSizePx: 7, color: "#86efac" },
        { text: "の" },
        { text: "多", rubyText: "おお", rubyFontSizePx: 7 },
        { text: "く" },
        { text: "飛", rubyText: "と", rubyFontSizePx: 7 },
        { text: "びちがひたる。" },
      ],
    });
    children.push(...renderFlowWarnings(result.warnings, 564, 18));
    children.push(
      Box({
        position: "absolute",
        left: rubyRect.x,
        top: rubyRect.y,
        width: rubyRect.w,
        height: rubyRect.h,
        background: "#1e3a5f",
        borderRadius: 4,
      }),
    );
    renderRubyFlowFragments(children, result, fontSize, lineHeight, "#e2e8f0", 0, 0);
  } catch (error) {
    children.push(
      Box(
        { position: "absolute", left: 564, top: 34 },
        Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
      ),
    );
  }
}

export function buildFlowRichVNode(engine: Engine, obs: FlowRichObstacles): VNode {
  const canvasWidth = 840;
  const canvasHeight = 280;
  const children: VNode[] = [];

  // Section labels
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

  buildRichSection(engine, children, obs, canvasWidth, canvasHeight);
  buildVerticalSection(engine, children, obs, canvasHeight);
  buildRubySection(engine, children, obs, canvasHeight);

  return Canvas({ width: canvasWidth, height: canvasHeight, background: "#1a1a1a" }, ...children);
}
