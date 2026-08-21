import { Box, Canvas, Path, Text, type VNode } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import { renderFlowWarnings, renderVerticalFlowFragments } from "../flow-helpers";
import { flowObstacles } from "../obstacle-state";
import type { Preset } from "../types";

export const textFlowPreset: Preset = {
  title: "Text Flow",
  description:
    "Obstacle avoidance with ellipsis and fit-shrink for horizontal (left pair) and vertical-rl (right pair). Drag obstacles to reflow text.",
  source: `import { Box, Canvas, Text } from "@boundsvg/core";

const text = "春はあけぼの。やうやう白くなりゆく山際、少し明かりて、" +
  "紫だちたる雲の細くたなびきたる。夏は夜。月のころはさらなり…";

// Obstacle avoidance with maxLines + ellipsis
const result = engine.layoutTextFlowWithExclusions({
  text,
  fontFamily: "${FA}",
  fontSizePx: 14,
  lineHeight: 1.5,
  language: "ja",
  wrap: "char",
  maxLines: 7,
  ellipsis: true,
  flowBox: { x: 16, y: 36, width: 372, height: 314 },
  exclusions: [
    { kind: "rect", x: 260, y: 40, width: 130, height: 70, marginPx: 8 },
    { kind: "circle", cx: 100, cy: 180, r: 55, marginPx: 8 },
  ],
});

// Render: each fragment becomes an absolute-positioned Text node
const children = [];
const lhPx = 14 * 1.5;
for (const line of result.lines) {
  for (const frag of line.fragments) {
    children.push(
      Box(
        { position: "absolute", left: frag.x, top: frag.y,
          width: frag.availableInlineSizePx, height: lhPx, overflow: "clip" },
        Text({ font: "${FA}", fontSizePx: 14, color: "#e2e8f0",
          language: "ja", wrap: "none", lineHeight: 1 }, frag.text),
      ),
    );
  }
}

// Fit-shrink: auto-sizes font to fill the flow box
const fitResult = engine.layoutTextFlowWithExclusions({
  text: "名前はまだ無い。どこで生まれたかとんと見当がつかぬ。…",
  fontFamily: "${FA}", fontSizePx: 22, lineHeight: 1.4,
  language: "ja", wrap: "char",
  fit: "shrink", minFontSizePx: 8,
  flowBox: { x: 420, y: 36, width: 364, height: 314 },
  exclusions: [{ kind: "rect", x: 580, y: 60, width: 130, height: 80, marginPx: 8 }],
});
// fitResult.chosenFontSizePx — the auto-chosen font size

const vnode = Canvas(
  { width: 1120, height: 360, background: "#1a1a1a" },
  ...children,
);

const svg = engine.renderToSvg(vnode);`,
  build: (engine?) => {
    const canvasWidth = 1120;
    const canvasHeight = 360;
    if (!engine) {
      return Canvas({ width: canvasWidth, height: canvasHeight, background: "#1a1a1a" });
    }

    const children: VNode[] = [];

    // --- Section labels ---
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

    // --- Left: obstacle avoidance + ellipsis ---
    {
      const fontSize = 14;
      const lineHeight = 1.5;
      const rect = flowObstacles.left.rect;
      const circ = flowObstacles.left.circ;
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
            { kind: "circle", cx: circ.cx, cy: circ.cy, r: circ.r, marginPx: 8 },
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
        const circlePathData = `M ${circ.cx - circ.r} ${circ.cy} A ${circ.r} ${circ.r} 0 1 1 ${circ.cx + circ.r} ${circ.cy} A ${circ.r} ${circ.r} 0 1 1 ${circ.cx - circ.r} ${circ.cy} Z`;
        children.push(
          Path({ d: circlePathData, width: canvasWidth, height: canvasHeight, fill: "#1e3a5f" }),
        );
        const lhPx = fontSize * lineHeight;
        for (const line of result.lines) {
          for (const frag of line.fragments) {
            children.push(
              Box(
                {
                  position: "absolute",
                  left: frag.x,
                  top: frag.y,
                  width: frag.availableInlineSizePx,
                  height: lhPx,
                  overflow: "clip",
                },
                Text(
                  {
                    font: FA,
                    fontSizePx: fontSize,
                    color: "#e2e8f0",
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
            { position: "absolute", left: 16, top: 40 },
            Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
          ),
        );
      }
    }

    // --- Right: fit shrink ---
    {
      const fitRect = flowObstacles.right.rect;
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
        const lhPx = chosenSize * 1.4;
        for (const line of result.lines) {
          for (const frag of line.fragments) {
            children.push(
              Box(
                {
                  position: "absolute",
                  left: frag.x,
                  top: frag.y,
                  width: frag.availableInlineSizePx,
                  height: lhPx,
                  overflow: "clip",
                },
                Text(
                  {
                    font: FA,
                    fontSizePx: chosenSize,
                    color: "#e2e8f0",
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
            { position: "absolute", left: 420, top: 40 },
            Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
          ),
        );
      }
    }

    // --- Vertical: ellipsis + maxLines ---
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

    // --- Vertical: fit shrink ---
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
  },
};
