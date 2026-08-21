import { Box, type Engine, Flex, InlineBox, Rt, Ruby, Text, type VNode } from "@boundsvg/core";
import { horizontalFlowCrossExtent } from "../../playground-shared/flow-metrics.js";
import { FONT_ALIAS as FA } from "./config";
import { renderFlowFragments, renderVerticalFlowFragments } from "./flow-helpers";
import { CAPTION_RUBY_SPANS, renderRubyFlowFragments } from "./ruby-helpers";

export function buildShrinkwrapEnglishSection(
  engine: Engine,
  children: VNode[],
  yBase: number,
): void {
  const fontSize = 12;
  const lineHeight = 1.5;
  const text =
    "In spring, it is the dawn that is most beautiful. " +
    "As the light creeps over the hills, their outlines are dyed a faint red " +
    "and wisps of purplish cloud trail over them.";
  const fixedWidth = 200;

  try {
    // Fixed-width paragraph
    const fixedResult = engine.layoutTextFlowWithExclusions({
      text,
      fontFamily: FA,
      fontSizePx: fontSize,
      lineHeight: lineHeight,
      language: "en",
      wrap: "word",
      flowBox: { x: 16, y: yBase, width: fixedWidth, height: 200 },
      exclusions: [],
    });

    const fixedH = fixedResult.usedLineCount * fontSize * lineHeight;
    children.push(
      Box({
        position: "absolute",
        left: 16,
        top: yBase,
        width: fixedWidth,
        height: fixedH,
        borderColor: "#474747",
        borderWidth: 1,
      }),
    );
    renderFlowFragments(children, fixedResult, fontSize, lineHeight, "#94a3b8");

    // Shrinkwrapped paragraph
    const shrinkwrap = engine.shrinkwrapText({
      text,
      fontFamily: FA,
      fontSizePx: fontSize,
      lineHeight: lineHeight,
      language: "en",
      wrap: "word",
      maxWidth: fixedWidth,
    });

    if (shrinkwrap.status === "satisfied" && shrinkwrap.chosenWidthPx != null) {
      const swY = yBase + fixedH + 26;
      const swResult = engine.layoutTextFlowWithExclusions({
        text,
        fontFamily: FA,
        fontSizePx: fontSize,
        lineHeight: lineHeight,
        language: "en",
        wrap: "word",
        flowBox: { x: 16, y: swY, width: shrinkwrap.chosenWidthPx, height: 200 },
        exclusions: [],
      });

      children.push(
        Box({
          position: "absolute",
          left: 16,
          top: swY,
          width: shrinkwrap.chosenWidthPx,
          height: swResult.usedLineCount * fontSize * lineHeight,
          borderColor: "#22d3ee",
          borderWidth: 1,
        }),
      );
      renderFlowFragments(children, swResult, fontSize, lineHeight, "#e2e8f0");

      children.push(
        Box(
          { position: "absolute", left: 16, top: swY - 14 },
          Text(
            { font: FA, fontSizePx: 10, color: "#22d3ee" },
            `Shrinkwrap ${shrinkwrap.chosenWidthPx.toFixed(1)}px`,
          ),
        ),
      );
    }

    children.push(
      Box(
        { position: "absolute", left: 16, top: yBase - 14 },
        Text(
          { font: FA, fontSizePx: 10, color: "#64748b" },
          `Fixed ${fixedWidth}px \u00b7 ${fixedResult.usedLineCount} lines`,
        ),
      ),
    );
  } catch (error) {
    children.push(
      Box(
        { position: "absolute", left: 16, top: yBase },
        Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
      ),
    );
  }
}

export function buildShrinkwrapVerticalSection(
  engine: Engine,
  children: VNode[],
  xBase: number,
  yBase: number,
): void {
  const fontSize = 16;
  const lineHeight = 1.4;
  const blockW = 120;
  const blockH = 160;
  const text = "縦組みABC123。句読点と英数字の向きを見ながら高さだけを詰める。";
  const flowExclusionEntry = {
    kind: "rect" as const,
    x: 30,
    y: 56,
    width: 28,
    height: 56,
    marginPx: 4,
  };
  const flowExclusion = [flowExclusionEntry];

  try {
    const fixedPlain = engine.layoutTextFlowWithExclusions({
      text,
      fontFamily: FA,
      fontSizePx: fontSize,
      lineHeight: lineHeight,
      language: "ja",
      wrap: "char",
      writingMode: "vertical-rl",
      textOrientation: "upright",
      flowBox: { x: 0, y: 0, width: blockW, height: blockH },
      exclusions: [],
    });
    children.push(
      Box({
        position: "absolute",
        left: xBase,
        top: yBase,
        width: blockW,
        height: blockH,
        borderColor: "#474747",
        borderWidth: 1,
      }),
    );
    renderVerticalFlowFragments(
      children,
      fixedPlain,
      fontSize,
      lineHeight,
      "#94a3b8",
      xBase,
      yBase,
    );

    const swPlain = engine.shrinkwrapText({
      text,
      fontFamily: FA,
      fontSizePx: fontSize,
      lineHeight: lineHeight,
      language: "ja",
      wrap: "char",
      hangingPunctuation: true,
      writingMode: "vertical-rl",
      textOrientation: "upright",
      maxWidth: blockW,
      maxHeight: blockH,
      minHeight: 48,
    });

    if (swPlain.status === "satisfied" && swPlain.chosenHeightPx != null) {
      const tightPlainY = yBase + blockH + 26;
      const tightPlain = engine.layoutTextFlowWithExclusions({
        text,
        fontFamily: FA,
        fontSizePx: fontSize,
        lineHeight: lineHeight,
        language: "ja",
        wrap: "char",
        writingMode: "vertical-rl",
        textOrientation: "upright",
        flowBox: { x: 0, y: 0, width: blockW, height: swPlain.chosenHeightPx },
        exclusions: [],
      });
      children.push(
        Box({
          position: "absolute",
          left: xBase,
          top: tightPlainY,
          width: blockW,
          height: swPlain.chosenHeightPx,
          borderColor: "#22d3ee",
          borderWidth: 1,
        }),
      );
      renderVerticalFlowFragments(
        children,
        tightPlain,
        fontSize,
        lineHeight,
        "#e2e8f0",
        xBase,
        tightPlainY,
      );
      children.push(
        Box(
          { position: "absolute", left: xBase, top: tightPlainY - 14 },
          Text(
            { font: FA, fontSizePx: 10, color: "#22d3ee" },
            `Plain ${swPlain.chosenHeightPx.toFixed(1)}px`,
          ),
        ),
      );
    }

    const fixedFlow = engine.layoutTextFlowWithExclusions({
      text,
      fontFamily: FA,
      fontSizePx: fontSize,
      lineHeight: lineHeight,
      language: "ja",
      wrap: "char",
      writingMode: "vertical-rl",
      textOrientation: "upright",
      flowBox: { x: 0, y: 0, width: blockW, height: blockH },
      exclusions: flowExclusion,
    });
    const flowX = xBase + 150;
    children.push(
      Box({
        position: "absolute",
        left: flowX,
        top: yBase,
        width: blockW,
        height: blockH,
        borderColor: "#474747",
        borderWidth: 1,
      }),
    );
    children.push(
      Box({
        position: "absolute",
        left: flowX + flowExclusionEntry.x,
        top: yBase + flowExclusionEntry.y,
        width: flowExclusionEntry.width,
        height: flowExclusionEntry.height,
        background: "#1e3a5f",
        borderRadius: 4,
      }),
    );
    renderVerticalFlowFragments(children, fixedFlow, fontSize, lineHeight, "#94a3b8", flowX, yBase);

    const swFlow = engine.shrinkwrapFlow({
      text,
      fontFamily: FA,
      fontSizePx: fontSize,
      lineHeight: lineHeight,
      language: "ja",
      wrap: "char",
      writingMode: "vertical-rl",
      textOrientation: "upright",
      flowBox: { x: 0, y: 0, width: blockW, height: blockH },
      exclusions: flowExclusion,
      minHeight: 48,
      targetLineCount: fixedFlow.usedLineCount,
    });

    if (swFlow.status === "satisfied" && swFlow.chosenHeightPx != null) {
      const tightFlowY = yBase + blockH + 26;
      children.push(
        Box({
          position: "absolute",
          left: flowX,
          top: tightFlowY,
          width: blockW,
          height: swFlow.chosenHeightPx,
          borderColor: "#22d3ee",
          borderWidth: 1,
        }),
      );
      children.push(
        Box({
          position: "absolute",
          left: flowX + flowExclusionEntry.x,
          top: tightFlowY + flowExclusionEntry.y,
          width: flowExclusionEntry.width,
          height: flowExclusionEntry.height,
          background: "#1e3a5f",
          borderRadius: 4,
        }),
      );
      renderVerticalFlowFragments(
        children,
        swFlow.layout,
        fontSize,
        lineHeight,
        "#e2e8f0",
        flowX,
        tightFlowY,
      );
      children.push(
        Box(
          { position: "absolute", left: flowX, top: tightFlowY - 14 },
          Text(
            { font: FA, fontSizePx: 10, color: "#22d3ee" },
            `Flow ${swFlow.chosenHeightPx.toFixed(1)}px`,
          ),
        ),
      );
    }

    // --- richText shrinkwrap (vertical) ---
    const richX = xBase + 300;
    const richStyle = {
      font: FA,
      fontWeight: 400,
      fontStyle: "normal" as const,
      fontSizePx: fontSize,
      color: "#e2e8f0",
      letterSpacingPx: 0,
    };
    const richNodes = [
      {
        kind: "ruby" as const,
        style: richStyle,
        base: [{ kind: "text" as const, text: "星空" }],
        rt: [
          {
            kind: "span" as const,
            text: "ほしぞら",
            style: { ...richStyle, fontSizePx: 8 },
          },
        ],
      },
      { kind: "text" as const, text: "を" },
      {
        kind: "inlineBox" as const,
        style: richStyle,
        background: "#1e3a5f",
        borderColor: "#22d3ee",
        borderWidth: 1,
        paddingInline: [2, 2] as [number, number],
        borderRadius: 3,
        children: [{ kind: "text" as const, text: "見上げる" }],
      },
      { kind: "text" as const, text: "夜明け前" },
    ];
    const swRich = engine.shrinkwrapText({
      text: "",
      fontFamily: FA,
      fontSizePx: fontSize,
      lineHeight: lineHeight,
      language: "ja",
      wrap: "char",
      hangingPunctuation: true,
      writingMode: "vertical-rl",
      textOrientation: "upright",
      maxWidth: blockW,
      maxHeight: blockH,
      minHeight: 48,
      richText: richNodes,
    });

    if (swRich.status === "satisfied" && swRich.chosenHeightPx != null) {
      children.push(
        Box({
          position: "absolute",
          left: richX,
          top: yBase,
          width: blockW,
          height: swRich.chosenHeightPx,
          borderColor: "#22d3ee",
          borderWidth: 1,
        }),
      );
      children.push(
        Box(
          {
            position: "absolute",
            left: richX,
            top: yBase,
            width: blockW,
            height: swRich.chosenHeightPx,
            overflow: "clip",
          },
          Flex(
            {
              direction: "row",
              width: blockW,
              height: swRich.chosenHeightPx,
            },
            Text(
              {
                font: FA,
                fontSizePx: fontSize,
                color: "#e2e8f0",
                lineHeight: lineHeight,
                wrap: "char",
                language: "ja",
                writingMode: "vertical-rl",
                textOrientation: "upright",
                flexGrow: 1,
                preferredFrame: { h: swRich.chosenHeightPx },
              },
              Ruby(
                { rubyPosition: "over", rubyAlign: "center" },
                "星空",
                Rt({ fontSizePx: 8, color: "#fca5a5" }, "ほしぞら"),
              ),
              "を",
              InlineBox(
                {
                  paddingInline: [2, 2],
                  background: "#1e3a5f",
                  borderColor: "#22d3ee",
                  borderWidth: 1,
                  borderRadius: 3,
                  color: "#bfdbfe",
                },
                "見上げる",
              ),
              "夜明け前",
            ),
          ),
        ),
      );
      children.push(
        Box(
          { position: "absolute", left: richX, top: yBase - 14 },
          Text(
            { font: FA, fontSizePx: 10, color: "#22d3ee" },
            `Rich ${swRich.chosenHeightPx.toFixed(1)}px`,
          ),
        ),
      );
    }

    children.push(
      Box(
        { position: "absolute", left: xBase, top: yBase - 14 },
        Text(
          { font: FA, fontSizePx: 10, color: "#64748b" },
          `Fixed ${blockH}px \u00b7 ${fixedPlain.usedLineCount} cols`,
        ),
      ),
    );
    children.push(
      Box(
        { position: "absolute", left: flowX, top: yBase - 14 },
        Text(
          { font: FA, fontSizePx: 10, color: "#64748b" },
          `Obstacle ${blockH}px \u00b7 ${fixedFlow.usedLineCount} cols`,
        ),
      ),
    );
  } catch (error) {
    children.push(
      Box(
        { position: "absolute", left: xBase, top: yBase },
        Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
      ),
    );
  }
}

export function buildShrinkwrapRubySection(
  engine: Engine,
  children: VNode[],
  xBase: number,
  yBase: number,
): void {
  const fontSize = 14;
  const lineHeight = 1.9;
  const thumbW = 50;
  const thumbH = 25;
  const thumbMargin = 6;
  const captionWidth = 350;
  const captionHeight = 200;
  const exclusions = [
    { kind: "rect" as const, x: 0, y: 0, width: thumbW, height: thumbH, marginPx: thumbMargin },
  ];

  try {
    // --- Fixed width (top) ---
    const fixedResult = engine.layoutTextFlowWithExclusions({
      text: "",
      fontFamily: FA,
      fontSizePx: fontSize,
      lineHeight: lineHeight,
      language: "ja",
      wrap: "char",
      flowBox: { x: 0, y: 0, width: captionWidth, height: captionHeight },
      exclusions,
      spans: CAPTION_RUBY_SPANS,
    });

    const fixedH = horizontalFlowCrossExtent(fixedResult, 0);
    children.push(
      Box({
        position: "absolute",
        left: xBase,
        top: yBase,
        width: captionWidth,
        height: fixedH,
        borderColor: "#474747",
        borderWidth: 1,
      }),
    );
    children.push(
      Box({
        position: "absolute",
        left: xBase,
        top: yBase,
        width: thumbW,
        height: thumbH,
        background: "#1e3a5f",
        borderRadius: 4,
      }),
    );
    renderRubyFlowFragments(children, fixedResult, fontSize, lineHeight, "#e2e8f0", xBase, yBase);

    // --- Shrinkwrapped (bottom) ---
    const shrinkwrap = engine.shrinkwrapFlow({
      text: "",
      fontFamily: FA,
      fontSizePx: fontSize,
      lineHeight: lineHeight,
      language: "ja",
      wrap: "char",
      flowBox: { x: 0, y: 0, width: captionWidth, height: captionHeight },
      exclusions,
      spans: CAPTION_RUBY_SPANS,
      targetLineCount: fixedResult.usedLineCount,
    });

    if (shrinkwrap.status === "satisfied" && shrinkwrap.chosenWidthPx != null) {
      const tightW = shrinkwrap.chosenWidthPx;
      const tightY = yBase + fixedH + 26;

      const tightResult = shrinkwrap.layout;
      const tightH = horizontalFlowCrossExtent(tightResult, 0);
      children.push(
        Box({
          position: "absolute",
          left: xBase,
          top: tightY,
          width: tightW,
          height: tightH,
          borderColor: "#22d3ee",
          borderWidth: 1,
        }),
      );
      children.push(
        Box({
          position: "absolute",
          left: xBase,
          top: tightY,
          width: thumbW,
          height: thumbH,
          background: "#1e3a5f",
          borderRadius: 4,
        }),
      );
      renderRubyFlowFragments(
        children,
        tightResult,
        fontSize,
        lineHeight,
        "#e2e8f0",
        xBase,
        tightY,
      );

      children.push(
        Box(
          { position: "absolute", left: xBase, top: tightY - 14 },
          Text({ font: FA, fontSizePx: 10, color: "#22d3ee" }, `Shrinkwrap ${tightW.toFixed(1)}px`),
        ),
      );
    }

    children.push(
      Box(
        { position: "absolute", left: xBase, top: yBase - 14 },
        Text(
          { font: FA, fontSizePx: 10, color: "#64748b" },
          `Fixed ${captionWidth}px \u00b7 ${fixedResult.usedLineCount} lines`,
        ),
      ),
    );
  } catch (error) {
    children.push(
      Box(
        { position: "absolute", left: xBase, top: yBase },
        Text({ font: FA, fontSizePx: 12, color: "#ef4444", wrap: "char" }, String(error)),
      ),
    );
  }
}
