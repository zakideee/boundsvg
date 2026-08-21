import {
  Box,
  type Engine,
  type GeometryDoc,
  geometryToFlowExclusion,
  Shape,
  Text,
  type VNode,
} from "@boundsvg/core";
import type { TextFlowFragment } from "@boundsvg/core/wasm";
import { FONT_ALIAS as FA } from "./config";
import { renderFlowWarnings } from "./flow-helpers";
import { flowRichObstacles } from "./obstacle-state";

function buildFlowFragmentVNode(
  frag: TextFlowFragment,
  baseFontSize: number,
  lineHeightPx: number,
): VNode {
  const fragFs = frag.style?.fontSizePx ?? baseFontSize;
  const fragColor = frag.style?.color ?? "#e2e8f0";
  const rubyFs = frag.ruby?.style.fontSizePx ?? 7;
  const rubyGap = frag.ruby ? 2 : 0;
  const rubyOver = frag.ruby?.position !== "under";
  const rubyInsetTop = frag.ruby && rubyOver ? rubyFs + rubyGap : 0;
  const rubyInsetBottom = frag.ruby && !rubyOver ? rubyFs + rubyGap : 0;
  const fragAscent = fragFs * 0.8;
  const yShift = (frag.baselineOffset ?? fragAscent) - fragAscent;
  const fragChildren: VNode[] = [
    Box(
      { position: "absolute", left: 0, top: rubyInsetTop },
      Text(
        {
          font: FA,
          fontSizePx: fragFs,
          color: fragColor,
          language: "ja",
          wrap: "none",
          lineHeight: 1,
        },
        frag.text,
      ),
    ),
  ];
  if (frag.ruby) {
    fragChildren.unshift(
      Box(
        {
          position: "absolute",
          left: 0,
          top: rubyOver ? 0 : rubyInsetTop + lineHeightPx + rubyGap,
        },
        Text(
          { font: FA, fontSizePx: rubyFs, color: frag.ruby.style.color ?? "#94a3b8" },
          frag.ruby.text,
        ),
      ),
    );
  }
  return Box(
    {
      position: "absolute",
      left: frag.x,
      top: frag.y - rubyInsetTop + yShift,
      width: frag.availableInlineSizePx,
      height: rubyInsetTop + lineHeightPx + rubyInsetBottom,
      overflow: "clip",
    },
    ...fragChildren,
  );
}

// One geometry drives BOTH the drawn circle and the text exclusion
// (geometryToFlowExclusion), instead of hand-duplicating path data.
const CIRCLE_KAPPA = 27.614237;
const FLOW_CIRCLE_GEOMETRY: GeometryDoc = {
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

export function buildFlowRichSection(
  engine: Engine,
  children: VNode[],
  canvasHeight: number,
): void {
  const circ = flowRichObstacles.rich;
  try {
    const result = engine.layoutTextFlowWithExclusions({
      fontFamily: FA,
      fontSizePx: 14,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      text: "",
      flowBox: { x: 16, y: 30, width: 252, height: canvasHeight - 40 },
      exclusions: [
        geometryToFlowExclusion(FLOW_CIRCLE_GEOMETRY, {
          x: circ.cx - circ.r,
          y: circ.cy - circ.r,
          width: circ.r * 2,
          height: circ.r * 2,
          marginPx: 6,
        }),
      ],
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
    children.push(
      Shape({
        geometry: FLOW_CIRCLE_GEOMETRY,
        width: circ.r * 2,
        height: circ.r * 2,
        fill: "#1e3a5f",
        position: "absolute",
        left: circ.cx - circ.r,
        top: circ.cy - circ.r,
      }),
    );
    const defLh = 14 * 1.5;
    for (const line of result.lines) {
      for (const frag of line.fragments) {
        const fragFs = frag.style?.fontSizePx ?? 14;
        const fragColor = frag.style?.color ?? "#e2e8f0";
        const fragAscent = fragFs * 0.8;
        const yShift = (frag.baselineOffset ?? fragAscent) - fragAscent;
        children.push(
          Box(
            {
              position: "absolute",
              left: frag.x,
              top: frag.y + yShift,
              width: frag.availableInlineSizePx,
              height: defLh,
              overflow: "clip",
            },
            Text(
              {
                font: FA,
                fontSizePx: fragFs,
                color: fragColor,
                language: "ja",
                wrap: "none",
                lineHeight: 1,
              },
              frag.text,
            ),
          ),
        );
      }
    }
  } catch (error) {
    children.push(
      Box(
        { position: "absolute", left: 16, top: 34 },
        Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
      ),
    );
  }
}

export function buildFlowVerticalSection(
  engine: Engine,
  children: VNode[],
  canvasHeight: number,
): void {
  const fontSize = 14;
  const lineHeight = 1.5;
  const rect = flowRichObstacles.vertical;
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
      ...renderFlowWarnings(
        result.warnings,
        300,
        6,
        "Vertical-RL (drag) · tofu demo (intentional): 祇",
      ),
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
    const colW = fontSize * lineHeight;
    for (const line of result.lines) {
      for (const frag of line.fragments) {
        children.push(
          Box(
            {
              position: "absolute",
              left: frag.x,
              top: frag.y,
              width: colW,
              height: frag.availableInlineSizePx,
              overflow: "clip",
            },
            Text(
              {
                font: FA,
                fontSizePx: fontSize,
                color: "#e2e8f0",
                language: "ja",
                wrap: "none",
                writingMode: "vertical-rl",
                lineHeight: 1,
              },
              frag.text,
            ),
          ),
        );
      }
    }
  } catch (error) {
    children.push(
      Box(
        { position: "absolute", left: 300, top: 34 },
        Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
      ),
    );
  }
}

export function buildFlowRubySection(
  engine: Engine,
  children: VNode[],
  canvasHeight: number,
): void {
  const fontSize = 15;
  const lineHeight = 1.9;
  const rubyRect = flowRichObstacles.ruby;
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
    const lhPx = fontSize * lineHeight;
    for (const line of result.lines) {
      for (const frag of line.fragments) {
        children.push(buildFlowFragmentVNode(frag, fontSize, lhPx));
      }
    }
  } catch (error) {
    children.push(
      Box(
        { position: "absolute", left: 564, top: 34 },
        Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
      ),
    );
  }
}
