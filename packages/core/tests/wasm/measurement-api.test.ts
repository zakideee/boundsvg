import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import {
  assertWasmPkgAvailable,
  loadInterVariableFont,
  loadJetBrainsMonoFont,
  loadSubsetFont,
} from "./test-prerequisites.js";

describe("Measurement WASM APIs", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [
        {
          alias: "NotoSansJP",
          weight: 400,
          style: "normal",
          data: loadSubsetFont(),
        },
        {
          alias: "JetBrainsMono",
          weight: 400,
          style: "normal",
          data: loadJetBrainsMonoFont(),
        },
        {
          alias: "Inter",
          weight: 400,
          style: "normal",
          data: loadInterVariableFont(),
        },
      ],
    });
  });

  it("keeps vertical measureTextBlock as a wrap constraint instead of an overflow limit", () => {
    const loose = engine.measureTextBlock({
      text: "天地玄黄宇宙洪荒",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.4,
      language: "ja",
      wrap: "char",
      writingMode: "vertical-rl",
      textOrientation: "upright",
      maxHeight: 100,
    });

    const tight = engine.measureTextBlock({
      text: "天地玄黄宇宙洪荒",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.4,
      language: "ja",
      wrap: "char",
      writingMode: "vertical-rl",
      textOrientation: "upright",
      maxHeight: 48,
    });

    expect(tight.lineCount).toBeGreaterThanOrEqual(loose.lineCount);
    expect(tight.usedWidth).toBeGreaterThanOrEqual(loose.usedWidth);
    expect(tight.usedHeight).toBeLessThanOrEqual(49);
    // Vertical mode carries no per-line diagnostics (use layoutTextFlow).
    expect(loose.lines).toBeUndefined();
  });

  it("surfaces deterministic exact-search limits as typed fatal errors", () => {
    expect(() =>
      engine.layoutTextFlowWithExclusions({
        text: "あ".repeat(1_025),
        fontFamily: "NotoSansJP",
        fontSizePx: 24,
        language: "ja",
        wrap: "char",
        flowBox: { x: 0, y: 0, width: 72, height: 200 },
        exclusions: [],
        maxLines: 1,
        ellipsis: true,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "FatalError",
        code: "TEXT_ELLIPSIS_CANDIDATE_LIMIT",
        stage: "text",
      }),
    );

    expect(() =>
      engine.layoutTextFlowWithExclusions({
        text: "あいうえおかきくけこ",
        fontFamily: "NotoSansJP",
        fontSizePx: 32,
        language: "ja",
        wrap: "char",
        flowBox: { x: 0, y: 0, width: 96, height: 72 },
        exclusions: [{ kind: "rect", x: 40, y: 0, width: 16, height: 32 }],
        maxLines: 2,
        fit: "shrink",
        minFontSizePx: 16,
        fitEpsilonPx: 0.25,
        fitMaxProbes: 1,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "FatalError",
        code: "TEXT_FIT_PROBE_LIMIT",
        stage: "text",
      }),
    );
  });

  it("keeps flow whitespace defaults compatible and normalizes hard breaks", () => {
    const common = {
      text: "a\tb\r\nc",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineWidths: [240],
    } as const;
    expect(engine.layoutTextFlow(common)).toEqual(
      engine.layoutTextFlow({ ...common, whiteSpace: "pre-wrap", tabSize: 4 }),
    );
    expect(
      engine.layoutTextFlow({
        ...common,
        text: "a\tb",
        whiteSpace: "pre-wrap",
        tabSize: 2,
      }).lines[0]?.text,
    ).toBe("a  b");

    for (const writingMode of ["horizontal-tb", "vertical-rl"] as const) {
      const result = engine.layoutTextFlow({
        ...common,
        text: "a\r\n\nb\r",
        whiteSpace: "pre-wrap",
        writingMode,
        textOrientation: "upright",
      });
      expect(result.lines.map((line) => line.text)).toEqual(["a", "", "b", ""]);
      expect(result.lines.map((line) => [line.charStart, line.charEnd])).toEqual([
        [0, 1],
        [2, 2],
        [3, 4],
        [5, 5],
      ]);
    }
  });

  it("matches renderer fallback shaping, textIndent, and explicit line height", () => {
    const fallbackText = "日本語の組版";
    const fallbackMeasured = engine.measureTextBlock({
      text: fallbackText,
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 24,
      maxWidth: 500,
    });
    const fallbackRendered = findTextNode(
      engine.renderToSvgAndIR(
        createElement(
          "Canvas",
          { width: 520, height: 100 },
          createElement(
            "Text",
            {
              font: "JetBrainsMono",
              fallback: ["NotoSansJP"],
              fontSizePx: 24,
              width: 500,
            },
            fallbackText,
          ),
        ),
      ).ir.root as unknown as TestIrNode,
    );
    expect(fallbackMeasured.usedWidth).toBeCloseTo(fallbackRendered.lines?.[0]?.width ?? 0, 6);

    const preWrap = engine.measureTextBlock({
      text: "日\n\n本\n",
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      textIndent: 1,
      whiteSpace: "pre-wrap",
      maxWidth: 100,
    });
    expect(preWrap.lines?.map((line) => line.text)).toEqual(["日", "", "本", ""]);
    expect(preWrap.lines?.map((line) => [line.charStart, line.charEnd])).toEqual([
      [0, 1],
      [2, 2],
      [3, 4],
      [5, 5],
    ]);
    const preWrapRendered = findTextNode(
      engine.renderToSvgAndIR(
        createElement(
          "Canvas",
          { width: 120, height: 120 },
          createElement(
            "Text",
            {
              font: "JetBrainsMono",
              fallback: ["NotoSansJP"],
              fontSizePx: 20,
              textIndent: 1,
              whiteSpace: "pre-wrap",
              width: 100,
            },
            "日\n\n本\n",
          ),
        ),
      ).ir.root as unknown as TestIrNode,
    );
    expect(preWrapRendered.lines?.map((line) => line.text)).toEqual(["日", "", "本", ""]);

    const nonBreakingSpace = engine.measureTextBlock({
      text: "日\u00a0本",
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      whiteSpace: "pre-wrap",
      maxWidth: 100,
    });
    expect(nonBreakingSpace.lines?.map((line) => line.text).join("")).toBe("日\u00a0本");

    const indentedText = "あいうえおかきくけこ";
    for (const lineHeightProps of [{ lineHeight: 1.5 }, { lineHeightPx: 32 }]) {
      const measured = engine.measureTextBlock({
        text: indentedText,
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
        textIndent: 30,
        maxWidth: 100,
        ...lineHeightProps,
      });
      const rendered = findTextNode(
        engine.renderToSvgAndIR(
          createElement(
            "Canvas",
            { width: 120, height: 140 },
            createElement(
              "Text",
              {
                font: "NotoSansJP",
                fontSizePx: 20,
                textIndent: 30,
                width: 100,
                ...lineHeightProps,
              },
              indentedText,
            ),
          ),
        ).ir.root as unknown as TestIrNode,
      );

      expect(measured.lineCount).toBe(3);
      expect(measured.usedHeight).toBe(lineHeightProps.lineHeightPx ? 96 : 90);
      expect(measured.usedWidth).toBe(100);
      expect(measured.usedHeight).toBeCloseTo(rendered.bbox.h, 6);
      expect(measured.lines?.map((line) => line.inlineAdvancePx)).toEqual([90, 100, 40]);
    }

    const hangingIndentMeasured = engine.measureTextBlock({
      text: indentedText,
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      textIndent: -20,
      maxWidth: 100,
    });
    const hangingIndentRendered = findTextNode(
      engine.renderToSvgAndIR(
        createElement(
          "Canvas",
          { width: 120, height: 100 },
          createElement(
            "Text",
            {
              font: "NotoSansJP",
              fontSizePx: 20,
              textIndent: -20,
              width: 100,
            },
            indentedText,
          ),
        ),
      ).ir.root as unknown as TestIrNode,
    );
    expect(hangingIndentMeasured.lines?.map((line) => line.inlineAdvancePx)).toEqual([100, 80]);
    expect(hangingIndentMeasured.lines?.map((line) => line.inlineAdvancePx)).toEqual(
      hangingIndentRendered.lines?.map((line) => line.width),
    );
  });

  it("applies fallback and textIndent to intrinsic inline sizes", () => {
    const text = "日本語";
    const primary = engine.measureIntrinsicInlineSize({
      text,
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
    });
    const fallback = engine.measureIntrinsicInlineSize({
      text,
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
    });
    const indented = engine.measureIntrinsicInlineSize({
      text,
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      textIndent: 30,
    });

    expect(fallback.minContentInlineSize).toBeCloseTo(primary.minContentInlineSize, 6);
    expect(fallback.maxContentInlineSize).toBeCloseTo(primary.maxContentInlineSize, 6);
    expect(indented.maxContentInlineSize - fallback.maxContentInlineSize).toBeCloseTo(30, 6);
  });

  it("honors explicit lineHeightPx across exclusion and shrinkwrap content paths", () => {
    const text = "あいうえおかきくけこ";
    const contentVariants = [
      { name: "plain", text },
      { name: "spans", text: "", spans: [{ text }] },
      { name: "richText", text: "", richText: [{ kind: "text" as const, text }] },
    ];
    const common = {
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.2,
      lineHeightPx: 48,
      language: "ja" as const,
      wrap: "char" as const,
    };

    for (const contentVariant of contentVariants) {
      const { name: variantName, ...content } = contentVariant;
      const exclusion = engine.layoutTextFlowWithExclusions({
        ...common,
        ...content,
        flowBox: { x: 0, y: 0, width: 60, height: 192 },
        exclusions: [],
      });
      expect(
        exclusion.lines.map((line) => line.crossSize),
        `${variantName}: horizontal exclusion crossSize`,
      ).toEqual([48, 48, 48, 48]);
      expect(
        exclusion.lines.map((line) => line.fragments[0]?.y),
        `${variantName}: horizontal exclusion y`,
      ).toEqual([0, 48, 96, 144]);

      const shrinkwrap = engine.shrinkwrapText({
        ...common,
        ...content,
        maxWidth: 60,
        targetLineCount: 4,
      });
      expect(shrinkwrap.lineCount, `${variantName}: shrinkwrap line count`).toBe(4);
      expect(shrinkwrap.usedHeight, `${variantName}: shrinkwrap used height`).toBe(192);

      const flowShrinkwrap = engine.shrinkwrapFlow({
        ...common,
        ...content,
        flowBox: { x: 0, y: 0, width: 60, height: 192 },
        exclusions: [],
        targetLineCount: 4,
      });
      expect(
        flowShrinkwrap.layout.lines.map((line) => line.crossSize),
        `${variantName}: flow shrinkwrap crossSize`,
      ).toEqual([48, 48, 48, 48]);
      expect(flowShrinkwrap.usedHeight, `${variantName}: flow shrinkwrap height`).toBe(192);

      const verticalCommon = {
        ...common,
        writingMode: "vertical-rl" as const,
        textOrientation: "upright" as const,
      };
      const verticalExclusion = engine.layoutTextFlowWithExclusions({
        ...verticalCommon,
        ...content,
        flowBox: { x: 0, y: 0, width: 192, height: 60 },
        exclusions: [],
      });
      expect(
        verticalExclusion.lines.map((line) => line.crossSize),
        `${variantName}: vertical exclusion crossSize`,
      ).toEqual([48, 48, 48, 48]);
      expect(
        verticalExclusion.lines.map((line) => line.fragments[0]?.x),
        `${variantName}: vertical exclusion x`,
      ).toEqual([144, 96, 48, 0]);

      const verticalShrinkwrap = engine.shrinkwrapText({
        ...verticalCommon,
        ...content,
        maxWidth: 192,
        maxHeight: 60,
        targetLineCount: 4,
      });
      expect(verticalShrinkwrap.lineCount, `${variantName}: vertical line count`).toBe(4);
      expect(verticalShrinkwrap.usedWidth, `${variantName}: vertical used width`).toBe(192);

      const verticalFlowShrinkwrap = engine.shrinkwrapFlow({
        ...verticalCommon,
        ...content,
        flowBox: { x: 0, y: 0, width: 192, height: 60 },
        exclusions: [],
        targetLineCount: 4,
      });
      expect(
        verticalFlowShrinkwrap.layout.lines.map((line) => line.crossSize),
        `${variantName}: vertical flow shrinkwrap crossSize`,
      ).toEqual([48, 48, 48, 48]);
    }

    const fitted = engine.layoutTextFlowWithExclusions({
      ...common,
      text: "あいうえおかきくけこさしすせそ",
      fontSizePx: 24,
      flowBox: { x: 0, y: 0, width: 60, height: 144 },
      exclusions: [],
      fit: "shrink",
      minFontSizePx: 8,
    });
    expect(fitted.chosenFontSizePx).toBe(12);
    expect(fitted.lines.map((line) => line.crossSize)).toEqual([48, 48, 48]);

    const tightLineHeight = engine.shrinkwrapText({
      text: "",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeightPx: 2,
      maxWidth: 20,
      targetLineCount: 10,
      spans: [{ text }],
    });
    expect(tightLineHeight.status).toBe("satisfied");
    expect(tightLineHeight.lineCount).toBe(10);
    expect(tightLineHeight.usedHeight).toBe(20);

    const rubyBaseStyle = {
      font: "NotoSansJP",
      fontWeight: 400,
      fontStyle: "normal" as const,
      fontSizePx: 16,
      lineHeightPx: 40,
      letterSpacingPx: 0,
      language: "ja" as const,
      color: "#111111",
    };
    const rubyAnnotationStyle = {
      ...rubyBaseStyle,
      fontSizePx: 8,
      lineHeight: 1,
      lineHeightPx: undefined,
    };
    const richRubyFlow = engine.shrinkwrapFlow({
      text: "",
      fontFamily: "NotoSansJP",
      fontSizePx: 16,
      lineHeightPx: 40,
      flowBox: { x: 0, y: 0, width: 200, height: 200 },
      exclusions: [],
      richText: [
        {
          kind: "ruby",
          style: rubyBaseStyle,
          base: [{ kind: "text", text: "漢字" }],
          rt: [{ kind: "span", text: "かんじ", style: rubyAnnotationStyle }],
        },
      ],
    });
    expect(richRubyFlow.layout.lines.map((line) => line.crossSize)).toEqual([40]);
    expect(richRubyFlow.layout.topRubyOverflowPx).toBe(8);
  });

  it("keeps ruby shrinkwrap metrics route-independent and contains atomic bases", () => {
    const buildRubyContent = (
      kind: "spans" | "richText",
      rubyPosition: "over" | "under",
      lineHeightPx?: number,
    ) => {
      if (kind === "spans") {
        return {
          spans: [
            {
              text: "漢字",
              rubyText: "かんじ",
              rubyFontSizePx: 8,
              rubyPosition,
            },
          ],
        };
      }

      const baseStyle = {
        font: "NotoSansJP",
        fontWeight: 400,
        fontStyle: "normal" as const,
        fontSizePx: 16,
        lineHeight: 1.2,
        ...(lineHeightPx === undefined ? {} : { lineHeightPx }),
        letterSpacingPx: 0,
        language: "ja" as const,
        color: "#111111",
        textOrientation: "upright" as const,
      };
      return {
        richText: [
          {
            kind: "ruby" as const,
            rubyPosition,
            style: baseStyle,
            base: [{ kind: "text" as const, text: "漢字" }],
            rt: [
              {
                kind: "span" as const,
                text: "かんじ",
                style: {
                  ...baseStyle,
                  fontSizePx: 8,
                  lineHeight: 1,
                  lineHeightPx: undefined,
                },
              },
            ],
          },
        ],
      };
    };

    const lineHeightCases = [
      { name: "relative", lineHeightPx: undefined, expectedCrossSize: 24 },
      { name: "explicit-px", lineHeightPx: 40, expectedCrossSize: 40 },
    ];

    const rubyCases = (["spans", "richText"] as const).flatMap((kind) =>
      (["over", "under"] as const).flatMap((rubyPosition) =>
        lineHeightCases.map((lineHeightCase) => ({ kind, rubyPosition, lineHeightCase })),
      ),
    );
    for (const { kind, rubyPosition, lineHeightCase } of rubyCases) {
      const lineHeightProps =
        lineHeightCase.lineHeightPx === undefined
          ? { lineHeight: 1.2 }
          : { lineHeight: 1.2, lineHeightPx: lineHeightCase.lineHeightPx };
      const rubyContent = buildRubyContent(kind, rubyPosition, lineHeightCase.lineHeightPx);
      const diagnostic = `${kind}/${rubyPosition}/${lineHeightCase.name}`;
      const common = {
        text: "",
        fontFamily: "NotoSansJP",
        fontSizePx: 16,
        ...lineHeightProps,
        ...rubyContent,
      };

      const normal = engine.shrinkwrapText({
        ...common,
        minWidth: 200,
        maxWidth: 200,
        targetLineCount: 1,
        whiteSpace: "normal",
      });
      const preWrap = engine.shrinkwrapText({
        ...common,
        minWidth: 200,
        maxWidth: 200,
        targetLineCount: 1,
        whiteSpace: "pre-wrap",
      });
      expect(normal.usedHeight, `${diagnostic}: normal height`).toBe(
        lineHeightCase.expectedCrossSize,
      );
      expect(preWrap.usedHeight, `${diagnostic}: pre-wrap height`).toBe(
        lineHeightCase.expectedCrossSize,
      );

      const verticalNormal = engine.shrinkwrapText({
        ...common,
        writingMode: "vertical-rl",
        textOrientation: "upright",
        maxWidth: 200,
        minHeight: 200,
        maxHeight: 200,
        targetLineCount: 1,
        whiteSpace: "normal",
      });
      const verticalPreWrap = engine.shrinkwrapText({
        ...common,
        writingMode: "vertical-rl",
        textOrientation: "upright",
        maxWidth: 200,
        minHeight: 200,
        maxHeight: 200,
        targetLineCount: 1,
        whiteSpace: "pre-wrap",
      });
      expect(verticalNormal.usedWidth, `${diagnostic}: normal vertical width`).toBe(
        lineHeightCase.expectedCrossSize,
      );
      expect(verticalPreWrap.usedWidth, `${diagnostic}: pre-wrap vertical width`).toBe(
        lineHeightCase.expectedCrossSize,
      );

      if (rubyPosition === "over") {
        const textSearch = engine.shrinkwrapText({
          ...common,
          maxWidth: 200,
          targetLineCount: 1,
        });
        expect(textSearch.status, `${diagnostic}: text search status`).toBe("satisfied");
        expect(textSearch.lineCount, `${diagnostic}: text search lines`).toBe(1);
        expect(
          textSearch.chosenWidthPx,
          `${diagnostic}: text search containment`,
        ).toBeGreaterThanOrEqual(textSearch.maxLineWidth ?? Number.POSITIVE_INFINITY);

        const flowSearch = engine.shrinkwrapFlow({
          ...common,
          flowBox: { x: 0, y: 0, width: 200, height: 200 },
          exclusions: [],
          targetLineCount: 1,
        });
        const fragment = flowSearch.layout.lines[0]?.fragments[0];
        expect(flowSearch.status, `${diagnostic}: flow search status`).toBe("satisfied");
        expect(flowSearch.usedLineCount, `${diagnostic}: flow search lines`).toBe(1);
        expect(fragment, `${diagnostic}: final fragment`).toBeDefined();
        expect(
          fragment?.inlineAdvancePx ?? Number.POSITIVE_INFINITY,
          `${diagnostic}: final fragment containment`,
        ).toBeLessThanOrEqual(fragment?.availableInlineSizePx ?? Number.NEGATIVE_INFINITY);
        expect(flowSearch.usedHeight, `${diagnostic}: flow used height`).toBe(
          lineHeightCase.expectedCrossSize,
        );
      }
    }

    for (const rubyPosition of ["over", "under"] as const) {
      const verticalCommon = {
        text: "",
        fontFamily: "NotoSansJP",
        fontSizePx: 16,
        lineHeight: 1.2,
        writingMode: "vertical-rl" as const,
        textOrientation: "upright" as const,
        flowBox: { x: 0, y: 0, width: 200, height: 200 },
        exclusions: [],
      };
      const spansLayout = engine.layoutTextFlowWithExclusions({
        ...verticalCommon,
        ...buildRubyContent("spans", rubyPosition),
      });
      const richLayout = engine.layoutTextFlowWithExclusions({
        ...verticalCommon,
        ...buildRubyContent("richText", rubyPosition),
      });
      expect(spansLayout.lines[0]?.crossSize).toBe(richLayout.lines[0]?.crossSize);
      expect(spansLayout.lines[0]?.fragments[0]?.baselineOffset).toBeCloseTo(
        richLayout.lines[0]?.fragments[0]?.baselineOffset ?? Number.NaN,
        6,
      );
    }

    for (const kind of ["spans", "richText"] as const) {
      const layout = engine.layoutTextFlowWithExclusions({
        text: "",
        fontFamily: "NotoSansJP",
        fontSizePx: 16,
        lineHeight: 1.2,
        flowBox: { x: 0, y: 10, width: 200, height: 100 },
        // This obstacle is strictly above the resolved line box. The old
        // spans route probed an extra ruby band above y=10 and saw it anyway.
        exclusions: [{ kind: "rect", x: 0, y: 1, width: 100, height: 8 }],
        ...buildRubyContent(kind, "over"),
      });
      expect(layout.lines[0]?.fragments[0]?.x, `${kind}: stale ruby probe x`).toBe(0);
      expect(
        layout.lines[0]?.fragments[0]?.availableInlineSizePx,
        `${kind}: stale ruby probe width`,
      ).toBe(200);
    }
  });

  it("aligns mixed plain and ruby line boxes across content and whitespace routes", () => {
    const mixedBaseStyle = {
      font: "NotoSansJP",
      fontWeight: 400,
      fontStyle: "normal" as const,
      fontSizePx: 20,
      lineHeight: 1.5,
      letterSpacingPx: 0,
      language: "ja" as const,
      color: "#111111",
      textOrientation: "upright" as const,
    };
    const mixedContents = [
      {
        name: "spans",
        content: {
          spans: [
            { text: "前" },
            { text: "漢字", rubyText: "かんじ", rubyFontSizePx: 10 },
            { text: "後" },
          ],
        },
      },
      {
        name: "richText",
        content: {
          richText: [
            { kind: "span" as const, text: "前", style: mixedBaseStyle },
            {
              kind: "ruby" as const,
              style: mixedBaseStyle,
              base: [{ kind: "text" as const, text: "漢字" }],
              rt: [
                {
                  kind: "span" as const,
                  text: "かんじ",
                  style: { ...mixedBaseStyle, fontSizePx: 10, lineHeight: 1 },
                },
              ],
            },
            { kind: "span" as const, text: "後", style: mixedBaseStyle },
          ],
        },
      },
    ];
    const writingCases = [
      { writingMode: "horizontal-tb" as const, expectedCrossSize: 35, expectedReference: 27.6 },
      { writingMode: "vertical-rl" as const, expectedCrossSize: 30, expectedReference: 15 },
    ];
    for (const { writingMode, expectedCrossSize, expectedReference } of writingCases) {
      for (const mixedContent of mixedContents) {
        const common = {
          text: "",
          fontFamily: "NotoSansJP",
          fontSizePx: 20,
          lineHeight: 1.5,
          writingMode,
          textOrientation: "upright" as const,
          ...mixedContent.content,
        };
        const layout = engine.layoutTextFlowWithExclusions({
          ...common,
          flowBox: { x: 0, y: 0, width: 200, height: 200 },
          exclusions: [],
        });
        expect(layout.lines[0]?.crossSize, `${mixedContent.name}/${writingMode}: crossSize`).toBe(
          expectedCrossSize,
        );
        expect(
          layout.lines[0]?.fragments[0]?.baselineOffset,
          `${mixedContent.name}/${writingMode}: reference offset`,
        ).toBe(expectedReference);

        for (const whiteSpace of ["normal", "pre-wrap"] as const) {
          const shrinkwrapped = engine.shrinkwrapText({
            ...common,
            minWidth: 200,
            maxWidth: 200,
            minHeight: 200,
            maxHeight: 200,
            targetLineCount: 1,
            whiteSpace,
          });
          const measuredCrossSize =
            writingMode === "vertical-rl" ? shrinkwrapped.usedWidth : shrinkwrapped.usedHeight;
          expect(
            measuredCrossSize,
            `${mixedContent.name}/${writingMode}/${whiteSpace}: shrinkwrap crossSize`,
          ).toBe(expectedCrossSize);
        }
      }
    }

    const plainVertical = engine.layoutTextFlowWithExclusions({
      text: "前漢字後",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      writingMode: "vertical-rl",
      textOrientation: "upright",
      flowBox: { x: 0, y: 0, width: 200, height: 200 },
      exclusions: [],
    });
    expect(plainVertical.lines[0]?.crossSize).toBe(30);
    expect(plainVertical.lines[0]?.fragments[0]?.baselineOffset).toBe(15);
  });

  it("distinguishes intentional hanging punctuation from uncontained nowrap flow", () => {
    const text = "あいうえお」。かきくけこ」。さしすせそ";
    const richStyle = {
      font: "NotoSansJP",
      fontWeight: 400,
      fontStyle: "normal" as const,
      fontSizePx: 20,
      lineHeight: 1.5,
      letterSpacingPx: 0,
      language: "ja" as const,
      color: "#111111",
    };
    const contentVariants = [
      { name: "plain", content: { text } },
      { name: "spans", content: { text: "", spans: [{ text }] } },
      {
        name: "richText",
        content: {
          text: "",
          richText: [{ kind: "span" as const, text, style: richStyle }],
        },
      },
    ];

    for (const variant of contentVariants) {
      const common = {
        ...variant.content,
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
        lineHeight: 1.5,
        language: "ja" as const,
        wrap: "char" as const,
        hangingPunctuation: true,
        flowBox: { x: 0, y: 0, width: 100, height: 90 },
        exclusions: [],
      };
      const layout = engine.layoutTextFlowWithExclusions(common);
      expect(layout.exhausted, `${variant.name}: hanging layout exhausted`).toBe(true);
      expect(layout.lines, `${variant.name}: hanging line count`).toHaveLength(3);
      expect(
        layout.lines
          .flatMap((line) => line.fragments)
          .filter((fragment) => fragment.overflowReason === "hangingPunctuation"),
        `${variant.name}: hanging overflow diagnostics`,
      ).toHaveLength(2);

      const fitted = engine.layoutTextFlowWithExclusions({
        ...common,
        fit: "shrink",
        minFontSizePx: 8,
      });
      expect(fitted.chosenFontSizePx, `${variant.name}: hanging fit size`).toBe(20);

      const shrinkwrapped = engine.shrinkwrapFlow({
        ...common,
        flowBox: { ...common.flowBox, height: 200 },
        targetLineCount: 3,
      });
      expect(shrinkwrapped.status, `${variant.name}: hanging shrinkwrap status`).toBe("satisfied");
      expect(shrinkwrapped.chosenWidthPx, `${variant.name}: hanging shrinkwrap width`).toBe(100);
    }

    const pathologicalHangingText = "ああ」。、、、";
    const pathologicalHangingVariants = [
      { name: "plain", content: { text: pathologicalHangingText } },
      {
        name: "spans",
        content: { text: "", spans: [{ text: pathologicalHangingText }] },
      },
      {
        name: "richText",
        content: {
          text: "",
          richText: [{ kind: "span" as const, text: pathologicalHangingText, style: richStyle }],
        },
      },
    ];
    for (const variant of pathologicalHangingVariants) {
      const fitted = engine.layoutTextFlowWithExclusions({
        ...variant.content,
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
        lineHeight: 1.5,
        language: "ja",
        wrap: "char",
        hangingPunctuation: true,
        fit: "shrink",
        minFontSizePx: 8,
        flowBox: { x: 0, y: 0, width: 40, height: 60 },
        exclusions: [],
      });
      expect(
        fitted.chosenFontSizePx,
        `${variant.name}: pathological hanging tail cannot keep requested size`,
      ).toBeLessThan(20);
    }

    const multiRegionText = "あいうえお、かきくけこさ";
    const multiRegionVariants = [
      { name: "plain", content: { text: multiRegionText } },
      { name: "spans", content: { text: "", spans: [{ text: multiRegionText }] } },
      {
        name: "richText",
        content: {
          text: "",
          richText: [{ kind: "span" as const, text: multiRegionText, style: richStyle }],
        },
      },
    ];
    const multiRegionSignatures = multiRegionVariants.map((variant) => {
      const layout = engine.layoutTextFlowWithExclusions({
        ...variant.content,
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
        lineHeight: 1.5,
        language: "ja",
        wrap: "char",
        hangingPunctuation: true,
        flowBox: { x: 0, y: 0, width: 240, height: 60 },
        exclusions: [{ kind: "rect", x: 100, y: 0, width: 40, height: 30 }],
      });
      const firstLine = layout.lines[0];
      const regionZero = firstLine?.fragments.filter((fragment) => fragment.regionIndex === 0);
      expect(regionZero?.map((fragment) => fragment.text).join(""), variant.name).toBe(
        "あいうえお",
      );
      expect(regionZero?.some((fragment) => fragment.overflowReason !== undefined)).toBe(false);
      const byRegion = new Map<number, string>();
      for (const fragment of firstLine?.fragments ?? []) {
        byRegion.set(
          fragment.regionIndex,
          `${byRegion.get(fragment.regionIndex) ?? ""}${fragment.text}`,
        );
      }
      return [...byRegion.entries()];
    });
    expect(multiRegionSignatures[1]).toEqual(multiRegionSignatures[0]);
    expect(multiRegionSignatures[2]).toEqual(multiRegionSignatures[0]);

    const wordMultiRegionVariants = [
      { name: "plain", content: { text: "Hello world" } },
      { name: "spans", content: { text: "", spans: [{ text: "Hello world" }] } },
      {
        name: "richText",
        content: {
          text: "",
          richText: [{ kind: "span" as const, text: "Hello world", style: richStyle }],
        },
      },
    ];
    for (const variant of wordMultiRegionVariants) {
      const common = {
        ...variant.content,
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
        lineHeight: 1.5,
        language: "en" as const,
        wrap: "word" as const,
        flowBox: { x: 0, y: 0, width: 360, height: 60 },
        exclusions: [{ kind: "rect" as const, x: 40, y: 0, width: 20, height: 30 }],
      };
      const layout = engine.layoutTextFlowWithExclusions(common);
      expect(layout.exhausted, `${variant.name}: word flow exhausted`).toBe(true);
      const firstLine = layout.lines[0];
      expect(
        firstLine?.fragments.some((fragment) => fragment.regionIndex === 0),
        `${variant.name}: unbreakable word deferred from narrow region`,
      ).toBe(false);
      const byRegion = new Map<number, { advance: number; available: number; text: string }>();
      for (const fragment of firstLine?.fragments ?? []) {
        const region = byRegion.get(fragment.regionIndex) ?? {
          advance: 0,
          available: fragment.availableInlineSizePx,
          text: "",
        };
        region.advance += fragment.inlineAdvancePx;
        region.available = Math.min(region.available, fragment.availableInlineSizePx);
        region.text += fragment.text;
        byRegion.set(fragment.regionIndex, region);
      }
      expect(
        [...byRegion.values()].every(({ advance, available }) => advance <= available + 1e-6),
        `${variant.name}: word regions contained`,
      ).toBe(true);
      expect([...byRegion.values()].map(({ text }) => text).join(""), variant.name).toBe(
        "Hello world",
      );

      const fitted = engine.layoutTextFlowWithExclusions({
        ...common,
        fit: "shrink",
        minFontSizePx: 8,
      });
      expect(fitted.chosenFontSizePx, `${variant.name}: contained word fit size`).toBe(20);
    }

    const atomicRubyVariants = [
      {
        name: "spans",
        content: {
          spans: [{ text: "前" }, { text: "漢字", rubyText: "かんじ", rubyFontSizePx: 10 }],
        },
      },
      {
        name: "richText",
        content: {
          richText: [
            { kind: "span" as const, text: "前", style: richStyle },
            {
              kind: "ruby" as const,
              style: richStyle,
              base: [{ kind: "text" as const, text: "漢字" }],
              rt: [
                {
                  kind: "span" as const,
                  text: "かんじ",
                  style: { ...richStyle, fontSizePx: 10, lineHeight: 1 },
                },
              ],
            },
          ],
        },
      },
    ];
    for (const variant of atomicRubyVariants) {
      const common = {
        ...variant.content,
        text: "",
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
        lineHeight: 1.5,
        language: "ja" as const,
        wrap: "char" as const,
        flowBox: { x: 0, y: 0, width: 240, height: 100 },
        exclusions: [{ kind: "rect" as const, x: 50, y: 0, width: 70, height: 50 }],
      };
      const layout = engine.layoutTextFlowWithExclusions(common);
      expect(layout.exhausted, `${variant.name}: atomic ruby exhausted`).toBe(true);
      expect(
        layout.lines[0]?.fragments
          .filter((fragment) => fragment.regionIndex === 0)
          .map((fragment) => fragment.text)
          .join(""),
        `${variant.name}: legal prefix retained before atomic ruby`,
      ).toBe("前");

      const fitted = engine.layoutTextFlowWithExclusions({
        ...common,
        fit: "shrink",
        minFontSizePx: 8,
      });
      expect(fitted.chosenFontSizePx, `${variant.name}: atomic ruby fit size`).toBe(20);

      const shrinkwrapped = engine.shrinkwrapFlow({
        ...common,
        targetLineCount: 1,
      });
      expect(shrinkwrapped.status, `${variant.name}: atomic ruby shrinkwrap`).toBe("satisfied");
    }

    const nowrapText = "abcdefghijklmnop";
    const nowrapVariants = [
      { name: "plain", content: { text: nowrapText } },
      { name: "spans", content: { text: "", spans: [{ text: nowrapText }] } },
      {
        name: "richText",
        content: {
          text: "",
          richText: [{ kind: "span" as const, text: nowrapText, style: richStyle }],
        },
      },
    ];
    for (const variant of nowrapVariants) {
      const common = {
        ...variant.content,
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
        lineHeight: 1.5,
        wrap: "none" as const,
        flowBox: { x: 0, y: 0, width: 80, height: 60 },
        exclusions: [],
      };
      const fitted = engine.layoutTextFlowWithExclusions({
        ...common,
        fit: "shrink",
        minFontSizePx: 8,
      });
      expect(fitted.chosenFontSizePx, `${variant.name}: nowrap fit shrinks`).toBeLessThan(20);
      const fittedAdvance = fitted.lines[0]?.fragments.reduce(
        (sum, fragment) => sum + fragment.inlineAdvancePx,
        0,
      );
      expect(fittedAdvance, `${variant.name}: fitted nowrap containment`).toBeLessThanOrEqual(80);

      const shrinkwrapped = engine.shrinkwrapFlow({
        ...common,
        flowBox: { ...common.flowBox, width: 200 },
        targetLineCount: 1,
      });
      const line = shrinkwrapped.layout.lines[0];
      const finalAdvance = line?.fragments.reduce(
        (sum, fragment) => sum + fragment.inlineAdvancePx,
        0,
      );
      expect(shrinkwrapped.status, `${variant.name}: nowrap shrinkwrap status`).toBe("satisfied");
      expect(finalAdvance, `${variant.name}: nowrap shrinkwrap containment`).toBeLessThanOrEqual(
        line?.fragments[0]?.availableInlineSizePx ?? Number.NEGATIVE_INFINITY,
      );
    }

    const multiRegionNowrapVariants = [
      { name: "plain", content: { text: nowrapText } },
      { name: "spans", content: { text: "", spans: [{ text: nowrapText }] } },
      {
        name: "richText",
        content: {
          text: "",
          richText: [{ kind: "span" as const, text: nowrapText, style: richStyle }],
        },
      },
    ];
    for (const variant of multiRegionNowrapVariants) {
      const layout = engine.layoutTextFlowWithExclusions({
        ...variant.content,
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
        lineHeight: 1.5,
        wrap: "none",
        flowBox: { x: 0, y: 0, width: 360, height: 60 },
        exclusions: [{ kind: "rect", x: 40, y: 0, width: 20, height: 30 }],
      });
      expect(
        layout.lines[0]?.fragments.some((fragment) => fragment.regionIndex === 0),
        `${variant.name}: nowrap run deferred from narrow region`,
      ).toBe(false);
    }

    const richNowrapHanging = engine.layoutTextFlowWithExclusions({
      text: "",
      richText: [
        { kind: "span", text: "あいうえ", style: richStyle },
        { kind: "span", text: "。", style: richStyle },
      ],
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja",
      wrap: "none",
      hangingPunctuation: true,
      fit: "shrink",
      minFontSizePx: 8,
      flowBox: { x: 0, y: 0, width: 80, height: 60 },
      exclusions: [],
    });
    expect(richNowrapHanging.chosenFontSizePx).toBeLessThan(20);

    const narrowGap = engine.shrinkwrapFlow({
      text: "あいうえおかきくけこ",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      wrap: "char",
      flowBox: { x: 0, y: 0, width: 200, height: 120 },
      exclusions: [{ kind: "rect", x: 100, y: 0, width: 85, height: 120 }],
      targetLineCount: 2,
    });
    expect(narrowGap.status).toBe("satisfied");
    expect(narrowGap.chosenWidthPx).toBe(100);
    expect(narrowGap.usedLineCount).toBe(2);
    expect(
      narrowGap.layout.lines
        .flatMap((line) => line.fragments)
        .every((fragment) => fragment.availableInlineSizePx >= 20),
    ).toBe(true);
  });

  const verticalCharParityCases = [
    {
      name: "proportional sideways advances",
      font: "NotoSansJP" as const,
      text: "abc",
      textOrientation: "mixed" as const,
      height: 25,
      expected: [
        ["ab", 23.62],
        ["c", 10.2],
      ] as const,
    },
    {
      name: "UAX boundary before a sideways run",
      font: "NotoSansJP" as const,
      text: "日本abc組版",
      textOrientation: "mixed" as const,
      height: 32,
      expected: [
        ["日", 20],
        ["本", 20],
        ["ab", 23.62],
        ["c組", 30.2],
        ["版", 20],
      ] as const,
    },
    {
      name: "upright whitespace boundary",
      font: "NotoSansJP" as const,
      text: "abc defgh",
      textOrientation: "upright" as const,
      height: 60,
      expected: [
        ["abc", 60],
        [" ", 20],
        ["def", 60],
        ["gh", 40],
      ] as const,
    },
    {
      name: "oversized first grapheme progress",
      font: "Inter" as const,
      text: "a",
      textOrientation: "upright" as const,
      height: 20,
      expected: [["a", 24.199219]] as const,
    },
  ];

  it.each(
    verticalCharParityCases,
  )("matches plain, spans, rich text, and renderer for vertical char-wrap $name", ({
    text,
    font,
    textOrientation,
    height,
    expected,
  }) => {
    const richStyle = {
      font,
      fontWeight: 400,
      fontStyle: "normal" as const,
      fontSizePx: 20,
      lineHeight: 1.5,
      letterSpacingPx: 0,
      language: "en" as const,
      color: "#111111",
      textOrientation,
    };
    const common = {
      fontFamily: font,
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "en" as const,
      wrap: "char" as const,
      writingMode: "vertical-rl" as const,
      textOrientation,
      flowBox: { x: 0, y: 0, width: 240, height },
      exclusions: [],
    };
    const layouts = [
      engine.layoutTextFlowWithExclusions({ ...common, text }),
      engine.layoutTextFlowWithExclusions({ ...common, text: "", spans: [{ text }] }),
      engine.layoutTextFlowWithExclusions({
        ...common,
        text: "",
        richText: [{ kind: "span", text, style: richStyle }],
      }),
    ];

    expect(layouts.map(verticalFlowLineSignature)).toEqual([expected, expected, expected]);

    const renderedText = findTextNode(
      engine.renderToSvgAndIR(
        createElement(
          "Canvas",
          { width: 240, height: 120 },
          createElement(
            "Text",
            {
              font,
              fontSizePx: 20,
              lineHeight: 1.5,
              language: "en",
              wrap: "char",
              writingMode: "vertical-rl",
              textOrientation,
              width: 240,
              height,
            },
            text,
          ),
        ),
      ).ir.root as unknown as TestIrNode,
    );
    expect(renderedText.lines?.map((line) => [line.text, Number(line.width.toFixed(6))])).toEqual(
      expected,
    );
  });

  const zeroAdvanceVerticalCases = [
    { name: "combining mark", text: "e\u{0301}\u{0301}", comparison: "e" },
    { name: "zero-width space", text: "a\u{200b}b", comparison: "ab" },
  ];

  it.each(zeroAdvanceVerticalCases)("does not allocate a phantom vertical advance to a $name", ({
    text,
    comparison,
  }) => {
    const richStyle = {
      font: "Inter",
      fontWeight: 400,
      fontStyle: "normal" as const,
      fontSizePx: 20,
      lineHeight: 1.5,
      letterSpacingPx: 0,
      language: "en" as const,
      color: "#111111",
      textOrientation: "mixed" as const,
    };
    const common = {
      fontFamily: "Inter",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "en" as const,
      wrap: "char" as const,
      writingMode: "vertical-rl" as const,
      textOrientation: "mixed" as const,
      flowBox: { x: 0, y: 0, width: 120, height: 100 },
      exclusions: [],
    };
    const layouts = [
      engine.layoutTextFlowWithExclusions({ ...common, text }),
      engine.layoutTextFlowWithExclusions({ ...common, text: "", spans: [{ text }] }),
      engine.layoutTextFlowWithExclusions({
        ...common,
        text: "",
        richText: [{ kind: "span", text, style: richStyle }],
      }),
    ];
    const comparisonLayout = engine.layoutTextFlowWithExclusions({
      ...common,
      text: comparison,
    });
    const expectedAdvance = flowInlineAdvance(comparisonLayout);

    expect(layouts.map(flowInlineAdvance)).toEqual([
      expectedAdvance,
      expectedAdvance,
      expectedAdvance,
    ]);

    const renderWidth = (renderText: string): number =>
      findTextNode(
        engine.renderToSvgAndIR(
          createElement(
            "Canvas",
            { width: 120, height: 120 },
            createElement(
              "Text",
              {
                font: "Inter",
                fontSizePx: 20,
                language: "en",
                wrap: "char",
                writingMode: "vertical-rl",
                textOrientation: "mixed",
                width: 120,
                height: 100,
              },
              renderText,
            ),
          ),
        ).ir.root as unknown as TestIrNode,
      ).lines?.reduce((advance, line) => advance + line.width, 0) ?? Number.NaN;
    expect(renderWidth(text)).toBeCloseTo(renderWidth(comparison), 6);
  });

  it.each([
    2, -2,
  ])("keeps vertical %spx tracking on a trailing mark aligned across run boundaries", (letterSpacingPx) => {
    const markedCluster = "e\u{0301}\u{0301}";
    const text = `${markedCluster}b`;
    const richStyle = {
      font: "Inter",
      fontWeight: 400,
      fontStyle: "normal" as const,
      fontSizePx: 20,
      lineHeight: 1.5,
      letterSpacingPx,
      language: "en" as const,
      color: "#111111",
      textOrientation: "mixed" as const,
    };
    const common = {
      fontFamily: "Inter",
      fontSizePx: 20,
      lineHeight: 1.5,
      letterSpacingPx,
      language: "en" as const,
      wrap: "char" as const,
      writingMode: "vertical-rl" as const,
      textOrientation: "mixed" as const,
      flowBox: { x: 0, y: 0, width: 120, height: 100 },
      exclusions: [],
    };
    const variants = [
      engine.layoutTextFlowWithExclusions({ ...common, text }),
      engine.layoutTextFlowWithExclusions({
        ...common,
        text: "",
        spans: [{ text: markedCluster }, { text: "b" }],
      }),
      engine.layoutTextFlowWithExclusions({
        ...common,
        text: "",
        richText: [
          { kind: "span", text: markedCluster, style: richStyle },
          { kind: "span", text: "b", style: richStyle },
        ],
      }),
    ];
    const untrackedAdvance = flowInlineAdvance(
      engine.layoutTextFlowWithExclusions({ ...common, text, letterSpacingPx: 0 }),
    );
    const expectedAdvance = Number((untrackedAdvance + letterSpacingPx).toFixed(6));

    expect(variants.map(flowInlineAdvance)).toEqual([
      expectedAdvance,
      expectedAdvance,
      expectedAdvance,
    ]);
  });

  it("keeps plain vertical char wrapping aligned with spans through exclusion regions", () => {
    const text = "日本abc組版天地123縦書";
    const common = {
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "en" as const,
      wrap: "char" as const,
      writingMode: "vertical-rl" as const,
      textOrientation: "mixed" as const,
      flowBox: { x: 0, y: 0, width: 240, height: 100 },
      exclusions: [
        { kind: "rect" as const, x: 0, y: 25, width: 240, height: 10 },
        { kind: "rect" as const, x: 0, y: 65, width: 240, height: 10 },
      ],
    };
    const plain = engine.layoutTextFlowWithExclusions({ ...common, text });
    const spans = engine.layoutTextFlowWithExclusions({
      ...common,
      text: "",
      spans: [{ text }],
    });

    expect(plain.exhausted).toBe(true);
    expect(exclusionTextByRegion(plain)).toEqual(exclusionTextByRegion(spans));
  });

  const richKinsokuFlowCases = [
    {
      writingMode: "horizontal-tb" as const,
      flowBox: { x: 0, y: 0, width: 20, height: 240 },
    },
    {
      writingMode: "vertical-rl" as const,
      flowBox: { x: 0, y: 0, width: 240, height: 20 },
    },
  ];

  it.each(
    richKinsokuFlowCases,
  )("keeps rich Japanese punctuation with its line in $writingMode flow", ({
    writingMode,
    flowBox,
  }) => {
    const text = "日本語、組版。天地";
    const expected = ["日", "本", "語、", "組", "版。", "天", "地"];
    const richStyle = {
      font: "NotoSansJP",
      fontWeight: 400,
      fontStyle: "normal" as const,
      fontSizePx: 20,
      lineHeight: 1.5,
      letterSpacingPx: 0,
      language: "ja" as const,
      color: "#111111",
      textOrientation: "upright" as const,
    };
    const common = {
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja" as const,
      wrap: "char" as const,
      writingMode,
      textOrientation: "upright" as const,
      hangingPunctuation: false,
      flowBox,
      exclusions: [],
    };
    const plain = engine.layoutTextFlowWithExclusions({ ...common, text });
    const spans = engine.layoutTextFlowWithExclusions({
      ...common,
      text: "",
      spans: [{ text }],
    });
    const rich = engine.layoutTextFlowWithExclusions({
      ...common,
      text: "",
      richText: [{ kind: "span", text, style: richStyle }],
    });
    const lineTexts = (result: typeof plain): string[] =>
      result.lines.map((line) => line.fragments.map((fragment) => fragment.text).join(""));

    expect([plain, spans, rich].map((result) => result.exhausted)).toEqual([true, true, true]);
    expect([plain, spans, rich].map(lineTexts)).toEqual([expected, expected, expected]);
    expect(
      rich.lines
        .flatMap((line) => line.fragments)
        .filter((fragment) => fragment.overflowReason === "kinsokuAbsorb")
        .map((fragment) => fragment.text),
    ).toEqual(["、", "。"]);
  });

  it.each([
    "horizontal-tb",
    "vertical-rl",
  ] as const)("does not falsely absorb after an opaque inline box in %s flow", (writingMode) => {
    const style = {
      font: "NotoSansJP",
      fontWeight: 400,
      fontStyle: "normal" as const,
      fontSizePx: 20,
      lineHeight: 1.5,
      letterSpacingPx: 0,
      language: "ja" as const,
      color: "#111111",
      textOrientation: "upright" as const,
    };
    const inlineBox = {
      kind: "inlineBox" as const,
      style,
      children: [{ kind: "text" as const, text: "「注」" }],
    };
    const common = {
      text: "",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja" as const,
      wrap: "char" as const,
      writingMode,
      textOrientation: "upright" as const,
      exclusions: [],
    };
    const generous = engine.layoutTextFlowWithExclusions({
      ...common,
      flowBox: { x: 0, y: 0, width: 500, height: 500 },
      richText: [inlineBox],
    });
    const atomicAdvance = flowInlineAdvance(generous);
    const narrow = engine.layoutTextFlowWithExclusions({
      ...common,
      flowBox:
        writingMode === "vertical-rl"
          ? { x: 0, y: 0, width: 240, height: atomicAdvance }
          : { x: 0, y: 0, width: atomicAdvance, height: 240 },
      richText: [inlineBox, { kind: "span", text: "本文", style }],
    });

    expect(narrow.lines[0]?.fragments.map((fragment) => fragment.text).join("")).toBe("「注」");
    expect(narrow.lines[0]?.fragments.some((fragment) => fragment.overflowReason)).toBe(false);
  });

  const richKinsokuExclusionCases = [
    {
      writingMode: "horizontal-tb" as const,
      flowBox: { x: 0, y: 0, width: 60, height: 30 },
      exclusion: { kind: "rect" as const, x: 20, y: 0, width: 20, height: 30 },
    },
    {
      writingMode: "vertical-rl" as const,
      flowBox: { x: 0, y: 0, width: 30, height: 60 },
      exclusion: { kind: "rect" as const, x: 0, y: 20, width: 30, height: 20 },
    },
  ];

  it.each(
    richKinsokuExclusionCases,
  )("absorbs rich punctuation only in the final $writingMode exclusion region", ({
    writingMode,
    flowBox,
    exclusion,
  }) => {
    const text = "日日。";
    const style = {
      font: "NotoSansJP",
      fontWeight: 400,
      fontStyle: "normal" as const,
      fontSizePx: 20,
      lineHeight: 1.5,
      letterSpacingPx: 0,
      language: "ja" as const,
      color: "#111111",
      textOrientation: "upright" as const,
    };
    const common = {
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja" as const,
      wrap: "char" as const,
      writingMode,
      textOrientation: "upright" as const,
      flowBox,
      exclusions: [exclusion],
    };
    const plain = engine.layoutTextFlowWithExclusions({ ...common, text });
    const spans = engine.layoutTextFlowWithExclusions({
      ...common,
      text: "",
      spans: [{ text }],
    });
    const rich = engine.layoutTextFlowWithExclusions({
      ...common,
      text: "",
      richText: [{ kind: "span", text, style }],
    });
    const lineTexts = (result: typeof plain): string[] =>
      result.lines.map((line) => line.fragments.map((fragment) => fragment.text).join(""));

    expect([plain, spans, rich].map(lineTexts)).toEqual([[text], [text], [text]]);
    expect(rich.lines[0]?.fragments.at(-1)?.overflowReason).toBe("kinsokuAbsorb");
  });

  const unbreakableWordWritingCases = [
    {
      writingMode: "horizontal-tb" as const,
      textOrientation: "mixed" as const,
      singleFlowBox: { x: 0, y: 0, width: 120, height: 90 },
      multiFlowBox: { x: 0, y: 0, width: 400, height: 90 },
      exclusions: [
        { kind: "rect" as const, x: 30, y: 0, width: 20, height: 30 },
        { kind: "rect" as const, x: 70, y: 0, width: 20, height: 30 },
      ],
    },
    {
      writingMode: "vertical-rl" as const,
      textOrientation: "upright" as const,
      singleFlowBox: { x: 0, y: 0, width: 90, height: 120 },
      multiFlowBox: { x: 0, y: 0, width: 90, height: 360 },
      exclusions: [
        { kind: "rect" as const, x: 60, y: 30, width: 30, height: 20 },
        { kind: "rect" as const, x: 60, y: 70, width: 30, height: 20 },
      ],
    },
  ];

  it.each(
    unbreakableWordWritingCases,
  )("keeps unbreakable rich words intact across $writingMode final flow regions", ({
    writingMode,
    textOrientation,
    singleFlowBox,
    multiFlowBox,
    exclusions,
  }) => {
    const text = "Supercalifragilistic";
    const multiRegionText = `${text} tail words`;
    const richStyle = {
      font: "NotoSansJP",
      fontWeight: 400,
      fontStyle: "normal" as const,
      fontSizePx: 20,
      lineHeight: 1.5,
      letterSpacingPx: 0,
      language: "en" as const,
      color: "#111111",
      textOrientation,
    };
    const common = {
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "en" as const,
      wrap: "word" as const,
      writingMode,
      textOrientation,
    };
    const contentVariants = [
      { name: "plain", content: { text } },
      { name: "spans", content: { text: "", spans: [{ text }] } },
      {
        name: "richText",
        content: {
          text: "",
          richText: [{ kind: "span" as const, text, style: richStyle }],
        },
      },
    ];

    for (const variant of contentVariants) {
      const layout = engine.layoutTextFlowWithExclusions({
        ...common,
        ...variant.content,
        flowBox: singleFlowBox,
        exclusions: [],
      });
      expect(layout.exhausted, `${writingMode}/${variant.name}: exhausted`).toBe(true);
      expect(layout.lines, `${writingMode}/${variant.name}: one intact word`).toHaveLength(1);
      expect(flowText(layout), `${writingMode}/${variant.name}: text`).toBe(text);
      expect(
        layout.lines[0]?.fragments.reduce(
          (advance, fragment) => advance + fragment.inlineAdvancePx,
          0,
        ),
        `${writingMode}/${variant.name}: intentional word overflow`,
      ).toBeGreaterThan(layout.lines[0]?.fragments[0]?.availableInlineSizePx ?? Infinity);

      const fitted = engine.layoutTextFlowWithExclusions({
        ...common,
        ...variant.content,
        fit: "shrink",
        minFontSizePx: 5,
        flowBox: singleFlowBox,
        exclusions: [],
      });
      const fittedAdvance = fitted.lines[0]?.fragments.reduce(
        (advance, fragment) => advance + fragment.inlineAdvancePx,
        0,
      );
      expect(fitted.chosenFontSizePx, `${writingMode}/${variant.name}: fit shrinks`).toBeLessThan(
        20,
      );
      expect(
        fittedAdvance,
        `${writingMode}/${variant.name}: fitted word containment`,
      ).toBeLessThanOrEqual(
        fitted.lines[0]?.fragments[0]?.availableInlineSizePx ?? Number.NEGATIVE_INFINITY,
      );
    }

    const multiRegionVariants = [
      { name: "plain", content: { text: multiRegionText } },
      {
        name: "spans",
        content: { text: "", spans: [{ text: multiRegionText }] },
      },
      {
        name: "richText",
        content: {
          text: "",
          richText: [{ kind: "span" as const, text: multiRegionText, style: richStyle }],
        },
      },
    ];
    const signatures = multiRegionVariants.map((variant) => {
      const layout = engine.layoutTextFlowWithExclusions({
        ...common,
        ...variant.content,
        flowBox: multiFlowBox,
        exclusions,
      });
      expect(layout.exhausted, `${writingMode}/${variant.name}: multi-region exhausted`).toBe(true);
      expect(flowText(layout), `${writingMode}/${variant.name}: multi-region text`).toBe(
        multiRegionText,
      );
      return exclusionTextByRegion(layout);
    });
    expect(signatures[1], `${writingMode}: spans parity`).toEqual(signatures[0]);
    expect(signatures[2], `${writingMode}: rich parity`).toEqual(signatures[0]);
  });

  it.each([
    {
      writingMode: "horizontal-tb" as const,
      textOrientation: "mixed" as const,
      flowBox: { x: 0, y: 0, width: 21, height: 360 },
      exclusions: [],
      expectedLines: ["A", "B", "C", "D", "E", "F", "G", "HI", "J", "K"],
    },
    {
      writingMode: "vertical-rl" as const,
      textOrientation: "upright" as const,
      flowBox: { x: 0, y: 0, width: 360, height: 21 },
      exclusions: [],
      expectedLines: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"],
    },
    {
      writingMode: "horizontal-tb" as const,
      textOrientation: "mixed" as const,
      flowBox: { x: 0, y: 0, width: 60, height: 360 },
      exclusions: [{ kind: "rect" as const, x: 20, y: 0, width: 20, height: 360 }],
      expectedLines: ["A", "B", "C", "D", "E", "F", "G", "H", "IJ", "K"],
    },
    {
      writingMode: "vertical-rl" as const,
      textOrientation: "upright" as const,
      flowBox: { x: 0, y: 0, width: 360, height: 60 },
      exclusions: [{ kind: "rect" as const, x: 0, y: 20, width: 360, height: 20 }],
      expectedLines: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"],
    },
  ])("keeps rich Japanese word wrapping contained in $writingMode flow", ({
    writingMode,
    textOrientation,
    flowBox,
    exclusions,
    expectedLines,
  }) => {
    const text = "ABCDEFGHIJK";
    const richStyle = {
      font: "NotoSansJP",
      fontWeight: 400,
      fontStyle: "normal" as const,
      fontSizePx: 20,
      lineHeight: 1.5,
      letterSpacingPx: 0,
      language: "ja" as const,
      color: "#111111",
      textOrientation,
    };
    const common = {
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja" as const,
      wrap: "word" as const,
      writingMode,
      textOrientation,
      flowBox,
      exclusions,
    };
    const variants = [
      engine.layoutTextFlowWithExclusions({ ...common, text }),
      engine.layoutTextFlowWithExclusions({
        ...common,
        text: "",
        spans: [{ text }],
      }),
      engine.layoutTextFlowWithExclusions({
        ...common,
        text: "",
        richText: [{ kind: "span", text, style: richStyle }],
      }),
    ];
    const lineTexts = (result: (typeof variants)[number]): string[] =>
      result.lines.map((line) => line.fragments.map((fragment) => fragment.text).join(""));

    expect(variants.map((result) => result.exhausted)).toEqual([true, true, true]);
    expect(variants.map(lineTexts)).toEqual([expectedLines, expectedLines, expectedLines]);
    for (const result of variants) {
      for (const line of result.lines) {
        const advancesByRegion = new Map<number, { advance: number; available: number }>();
        for (const fragment of line.fragments) {
          const region = advancesByRegion.get(fragment.regionIndex) ?? {
            advance: 0,
            available: fragment.availableInlineSizePx,
          };
          region.advance += fragment.inlineAdvancePx;
          advancesByRegion.set(fragment.regionIndex, region);
        }
        for (const region of advancesByRegion.values()) {
          expect(region.advance).toBeLessThanOrEqual(region.available);
        }
      }
    }
  });

  it.each(richKinsokuFlowCases)("repairs forced rich word boundaries in $writingMode flow", ({
    writingMode,
    flowBox,
  }) => {
    const text = "あ。い";
    const expectedLines = ["あ。", "い"];
    const richStyle = {
      font: "NotoSansJP",
      fontWeight: 400,
      fontStyle: "normal" as const,
      fontSizePx: 20,
      lineHeight: 1.5,
      letterSpacingPx: 0,
      language: "ja" as const,
      color: "#111111",
      textOrientation: "upright" as const,
    };
    const common = {
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja" as const,
      wrap: "word" as const,
      writingMode,
      textOrientation: "upright" as const,
      hangingPunctuation: false,
      flowBox,
      exclusions: [],
    };
    const variants = [
      engine.layoutTextFlowWithExclusions({ ...common, text }),
      engine.layoutTextFlowWithExclusions({
        ...common,
        text: "",
        spans: [{ text }],
      }),
      engine.layoutTextFlowWithExclusions({
        ...common,
        text: "",
        richText: [{ kind: "span", text, style: richStyle }],
      }),
    ];
    const lineTexts = (result: (typeof variants)[number]): string[] =>
      result.lines.map((line) => line.fragments.map((fragment) => fragment.text).join(""));

    expect(variants.map(lineTexts)).toEqual([expectedLines, expectedLines, expectedLines]);
    expect(variants[2]?.lines[0]?.fragments.at(-1)?.overflowReason).toBe("kinsokuAbsorb");
  });

  it("keeps same-run contextual shaping aligned between spans and rich flow", () => {
    const text = "AVAVAVAV";
    const common = {
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja" as const,
      wrap: "word" as const,
      writingMode: "horizontal-tb" as const,
      textOrientation: "mixed" as const,
      flowBox: { x: 0, y: 0, width: 47, height: 300 },
      exclusions: [],
    };
    const spans = engine.layoutTextFlowWithExclusions({
      ...common,
      text: "",
      spans: [{ text }],
    });
    const rich = engine.layoutTextFlowWithExclusions({
      ...common,
      text: "",
      richText: [
        {
          kind: "span",
          text,
          style: {
            font: "NotoSansJP",
            fontWeight: 400,
            fontStyle: "normal",
            fontSizePx: 20,
            lineHeight: 1.5,
            letterSpacingPx: 0,
            language: "ja",
            color: "#111111",
            textOrientation: "mixed",
          },
        },
      ],
    });
    const signature = (result: typeof spans) =>
      result.lines.map((line) => ({
        text: line.fragments.map((fragment) => fragment.text).join(""),
        advance: line.fragments.reduce((sum, fragment) => sum + fragment.inlineAdvancePx, 0),
      }));

    expect(signature(spans)).toEqual([
      { text: "AVAV", advance: 45.88 },
      { text: "AVAV", advance: 46.24 },
    ]);
    expect(signature(rich)).toEqual(signature(spans));
  });

  it("applies the renderer fallback chain across every flow and shrinkwrap API", () => {
    const text = "日本語の組版品質";
    const primaryFlow = engine.layoutTextFlow({
      text,
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      lineWidths: [64, 84],
    });
    const fallbackFlow = engine.layoutTextFlow({
      text,
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      lineWidths: [64, 84],
    });
    expect(fallbackFlow.exhausted).toBe(true);
    expect(fallbackFlow.lines.map(flowLineSignature)).toEqual(
      primaryFlow.lines.map(flowLineSignature),
    );

    const flowBox = { x: 0, y: 0, width: 84, height: 240 };
    const primaryExclusion = engine.layoutTextFlowWithExclusions({
      text,
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      flowBox,
      exclusions: [],
    });
    const fallbackExclusion = engine.layoutTextFlowWithExclusions({
      text,
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      flowBox,
      exclusions: [],
    });
    expect(flowText(fallbackExclusion)).toBe(text);
    expect(fallbackExclusion.exhausted).toBe(true);
    expect(exclusionGeometry(fallbackExclusion)).toEqual(exclusionGeometry(primaryExclusion));

    const spanFallbackExclusion = engine.layoutTextFlowWithExclusions({
      text: "",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      flowBox,
      exclusions: [],
      spans: [{ text, fontFamily: "JetBrainsMono", fallback: ["NotoSansJP"] }],
    });
    expect(flowText(spanFallbackExclusion)).toBe(text);
    expect(exclusionGeometry(spanFallbackExclusion)).toEqual(exclusionGeometry(fallbackExclusion));

    const primaryShrinkwrap = engine.shrinkwrapText({
      text,
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      maxWidth: 200,
      targetLineCount: 2,
    });
    const fallbackShrinkwrap = engine.shrinkwrapText({
      text,
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      maxWidth: 200,
      targetLineCount: 2,
    });
    expect(fallbackShrinkwrap.status).toBe(primaryShrinkwrap.status);
    expect(fallbackShrinkwrap.lineCount).toBe(primaryShrinkwrap.lineCount);
    expect(fallbackShrinkwrap.chosenWidthPx ?? 0).toBeCloseTo(
      primaryShrinkwrap.chosenWidthPx ?? 0,
      6,
    );
    expect(fallbackShrinkwrap.maxLineWidth ?? 0).toBeCloseTo(
      primaryShrinkwrap.maxLineWidth ?? 0,
      6,
    );

    const primaryFlowShrinkwrap = engine.shrinkwrapFlow({
      text,
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      flowBox: { x: 0, y: 0, width: 200, height: 240 },
      exclusions: [],
      targetLineCount: 2,
    });
    const fallbackFlowShrinkwrap = engine.shrinkwrapFlow({
      text,
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      flowBox: { x: 0, y: 0, width: 200, height: 240 },
      exclusions: [],
      targetLineCount: 2,
    });
    expect(fallbackFlowShrinkwrap.status).toBe(primaryFlowShrinkwrap.status);
    expect(fallbackFlowShrinkwrap.usedLineCount).toBe(primaryFlowShrinkwrap.usedLineCount);
    expect(fallbackFlowShrinkwrap.chosenWidthPx ?? 0).toBeCloseTo(
      primaryFlowShrinkwrap.chosenWidthPx ?? 0,
      6,
    );
    expect(exclusionGeometry(fallbackFlowShrinkwrap.layout)).toEqual(
      exclusionGeometry(primaryFlowShrinkwrap.layout),
    );
  });

  it("preserves fallback flow behavior in vertical writing", () => {
    const text = "日本語の縦組品質";
    const common = {
      text,
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja" as const,
      wrap: "char" as const,
      writingMode: "vertical-rl" as const,
      textOrientation: "upright" as const,
    };
    const primaryFlow = engine.layoutTextFlow({
      ...common,
      fontFamily: "NotoSansJP",
      lineWidths: [64, 84],
    });
    const fallbackFlow = engine.layoutTextFlow({
      ...common,
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      lineWidths: [64, 84],
    });
    expect(fallbackFlow.exhausted).toBe(true);
    expect(fallbackFlow.lines.map(flowLineSignature)).toEqual(
      primaryFlow.lines.map(flowLineSignature),
    );

    const primaryShrinkwrap = engine.shrinkwrapText({
      ...common,
      fontFamily: "NotoSansJP",
      maxWidth: 240,
      maxHeight: 180,
      targetLineCount: 2,
    });
    const fallbackShrinkwrap = engine.shrinkwrapText({
      ...common,
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      maxWidth: 240,
      maxHeight: 180,
      targetLineCount: 2,
    });
    expect(fallbackShrinkwrap.status).toBe(primaryShrinkwrap.status);
    expect(fallbackShrinkwrap.lineCount).toBe(primaryShrinkwrap.lineCount);
    expect(fallbackShrinkwrap.chosenHeightPx ?? 0).toBeCloseTo(
      primaryShrinkwrap.chosenHeightPx ?? 0,
      6,
    );
    expect(fallbackShrinkwrap.usedWidth ?? 0).toBeCloseTo(primaryShrinkwrap.usedWidth ?? 0, 6);

    const primaryFlowShrinkwrap = engine.shrinkwrapFlow({
      ...common,
      fontFamily: "NotoSansJP",
      flowBox: { x: 0, y: 0, width: 240, height: 180 },
      exclusions: [],
      targetLineCount: 2,
    });
    const fallbackFlowShrinkwrap = engine.shrinkwrapFlow({
      ...common,
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      flowBox: { x: 0, y: 0, width: 240, height: 180 },
      exclusions: [],
      targetLineCount: 2,
    });
    expect(fallbackFlowShrinkwrap.status).toBe(primaryFlowShrinkwrap.status);
    expect(fallbackFlowShrinkwrap.chosenHeightPx ?? 0).toBeCloseTo(
      primaryFlowShrinkwrap.chosenHeightPx ?? 0,
      6,
    );
    expect(exclusionGeometry(fallbackFlowShrinkwrap.layout)).toEqual(
      exclusionGeometry(primaryFlowShrinkwrap.layout),
    );
  });

  it("keeps plain-flow results stable when the fallback is unused or the text is empty", () => {
    const common = {
      text: " A  B C ",
      fontFamily: "JetBrainsMono",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "en" as const,
      wrap: "char" as const,
    };
    const fallback = ["NotoSansJP"];
    const plainFlow = engine.layoutTextFlow({ ...common, lineWidths: [48, 72] });
    const fallbackFlow = engine.layoutTextFlow({ ...common, fallback, lineWidths: [48, 72] });
    expect(fallbackFlow.lines.map(flowLineSignature)).toEqual(
      plainFlow.lines.map(flowLineSignature),
    );
    expect(fallbackFlow.lines.map((line) => line.text).join("")).toBe(common.text);

    const plainWhitespaceFlow = engine.layoutTextFlow({
      ...common,
      text: "   ",
      lineWidths: [48],
    });
    const fallbackWhitespaceFlow = engine.layoutTextFlow({
      ...common,
      text: "   ",
      fallback,
      lineWidths: [48],
    });
    expect(fallbackWhitespaceFlow).toEqual(plainWhitespaceFlow);
    expect(fallbackWhitespaceFlow.exhausted).toBe(true);

    const plainNewlineFlow = engine.layoutTextFlow({
      ...common,
      text: "A\n\nB\n",
      lineWidths: [48],
    });
    const fallbackNewlineFlow = engine.layoutTextFlow({
      ...common,
      text: "A\n\nB\n",
      fallback,
      lineWidths: [48],
    });
    expect(fallbackNewlineFlow).toEqual(plainNewlineFlow);

    const flowBox = { x: 0, y: 0, width: 72, height: 240 };
    const plainExclusion = engine.layoutTextFlowWithExclusions({
      ...common,
      flowBox,
      exclusions: [],
    });
    const fallbackExclusion = engine.layoutTextFlowWithExclusions({
      ...common,
      fallback,
      flowBox,
      exclusions: [],
    });
    expect(exclusionGeometry(fallbackExclusion)).toEqual(exclusionGeometry(plainExclusion));

    const plainShrinkwrap = engine.shrinkwrapText({
      ...common,
      maxWidth: 180,
      targetLineCount: 2,
    });
    const fallbackShrinkwrap = engine.shrinkwrapText({
      ...common,
      fallback,
      maxWidth: 180,
      targetLineCount: 2,
    });
    expect(fallbackShrinkwrap.status).toBe(plainShrinkwrap.status);
    expect(fallbackShrinkwrap.lineCount).toBe(plainShrinkwrap.lineCount);
    expect(fallbackShrinkwrap.maxLineWidth).toBe(plainShrinkwrap.maxLineWidth);
    expect(fallbackShrinkwrap.usedHeight).toBe(plainShrinkwrap.usedHeight);
    expect(fallbackShrinkwrap.chosenWidthPx ?? 0).toBeCloseTo(
      plainShrinkwrap.chosenWidthPx ?? 0,
      1,
    );

    const plainFlowShrinkwrap = engine.shrinkwrapFlow({
      ...common,
      flowBox: { x: 0, y: 0, width: 180, height: 240 },
      exclusions: [],
      targetLineCount: 2,
    });
    const fallbackFlowShrinkwrap = engine.shrinkwrapFlow({
      ...common,
      fallback,
      flowBox: { x: 0, y: 0, width: 180, height: 240 },
      exclusions: [],
      targetLineCount: 2,
    });
    expect(exclusionGeometry(fallbackFlowShrinkwrap.layout)).toEqual(
      exclusionGeometry(plainFlowShrinkwrap.layout),
    );
    expect(fallbackFlowShrinkwrap.chosenWidthPx).toBe(plainFlowShrinkwrap.chosenWidthPx);

    const emptyCommon = { ...common, text: "" };
    expect(engine.layoutTextFlow({ ...emptyCommon, fallback, lineWidths: [72] })).toEqual(
      engine.layoutTextFlow({ ...emptyCommon, lineWidths: [72] }),
    );
    expect(
      engine.layoutTextFlowWithExclusions({
        ...emptyCommon,
        fallback,
        flowBox,
        exclusions: [],
      }),
    ).toEqual(engine.layoutTextFlowWithExclusions({ ...emptyCommon, flowBox, exclusions: [] }));
    expect(
      engine.shrinkwrapText({ ...emptyCommon, fallback, maxWidth: 180, targetLineCount: 1 }),
    ).toEqual(engine.shrinkwrapText({ ...emptyCommon, maxWidth: 180, targetLineCount: 1 }));
    expect(
      engine.shrinkwrapFlow({
        ...emptyCommon,
        fallback,
        flowBox: { x: 0, y: 0, width: 180, height: 240 },
        exclusions: [],
        targetLineCount: 1,
      }),
    ).toEqual(
      engine.shrinkwrapFlow({
        ...emptyCommon,
        flowBox: { x: 0, y: 0, width: 180, height: 240 },
        exclusions: [],
        targetLineCount: 1,
      }),
    );
  });

  it("exposes the already-supported whitespace controls on shrinkwrapText", () => {
    const compact = engine.shrinkwrapText({
      text: "あ\tい",
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      lineHeight: 1.2,
      maxWidth: 300,
      targetLineCount: 1,
      whiteSpace: "pre-wrap",
      tabSize: 2,
    });
    const expanded = engine.shrinkwrapText({
      text: "あ\tい",
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      lineHeight: 1.2,
      maxWidth: 300,
      targetLineCount: 1,
      whiteSpace: "pre-wrap",
      tabSize: 8,
    });

    expect(expanded.chosenWidthPx).toBeGreaterThan(compact.chosenWidthPx);

    const forcedNewlines = engine.shrinkwrapText({
      text: "あ\n\nい\n",
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      lineHeight: 1.2,
      maxWidth: 300,
      whiteSpace: "pre-wrap",
    });
    expect(forcedNewlines.lineCount).toBe(4);
    expect(forcedNewlines).toEqual(
      engine.shrinkwrapText({
        text: "あ\n\nい\n",
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
        lineHeight: 1.2,
        maxWidth: 300,
        whiteSpace: "pre-wrap",
      }),
    );

    const verticalForcedNewlines = engine.shrinkwrapText({
      text: "あ\n\nい\n",
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      lineHeight: 1.2,
      writingMode: "vertical-rl",
      textOrientation: "upright",
      maxWidth: 120,
      maxHeight: 300,
      whiteSpace: "pre-wrap",
    });
    expect(verticalForcedNewlines.lineCount).toBe(4);
    expect(verticalForcedNewlines).toEqual(
      engine.shrinkwrapText({
        text: "あ\n\nい\n",
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
        lineHeight: 1.2,
        writingMode: "vertical-rl",
        textOrientation: "upright",
        maxWidth: 120,
        maxHeight: 300,
        whiteSpace: "pre-wrap",
      }),
    );

    const authoredSpanNewlines = engine.shrinkwrapText({
      text: "",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.2,
      maxWidth: 300,
      whiteSpace: "pre-wrap",
      spans: [{ text: "あ\n\nい\n" }],
    });
    expect(authoredSpanNewlines).toEqual(forcedNewlines);

    const richTextNewlines = engine.shrinkwrapText({
      text: "",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.2,
      maxWidth: 300,
      whiteSpace: "pre-wrap",
      richText: [{ kind: "text", text: "あ\n\nい\n" }],
    });
    expect(richTextNewlines).toEqual(forcedNewlines);

    const rubyNewline = engine.shrinkwrapText({
      text: "",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.2,
      maxWidth: 300,
      whiteSpace: "pre-wrap",
      spans: [{ text: "春", rubyText: "はる" }, { text: "\n" }, { text: "夏" }],
    });
    expect(rubyNewline.status).toBe("satisfied");
    expect(rubyNewline.lineCount).toBe(2);

    const compactAuthoredTab = engine.shrinkwrapText({
      text: "",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      maxWidth: 300,
      whiteSpace: "pre-wrap",
      tabSize: 2,
      spans: [{ text: "あ\tい" }],
    });
    const expandedAuthoredTab = engine.shrinkwrapText({
      text: "",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      maxWidth: 300,
      whiteSpace: "pre-wrap",
      tabSize: 8,
      spans: [{ text: "あ\tい" }],
    });
    expect(expandedAuthoredTab.chosenWidthPx).toBeGreaterThan(compactAuthoredTab.chosenWidthPx);

    const nowrapForcedLine = engine.shrinkwrapText({
      text: "abcdefghij\nx",
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      maxWidth: 300,
      wrap: "none",
      whiteSpace: "pre-wrap",
    });
    expect(nowrapForcedLine.status).toBe("satisfied");
    expect(nowrapForcedLine.chosenWidthPx ?? 0).toBeGreaterThanOrEqual(
      nowrapForcedLine.maxLineWidth ?? Number.POSITIVE_INFINITY,
    );

    const verticalNowrapForcedLine = engine.shrinkwrapText({
      text: "abcdefghij\nx",
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      writingMode: "vertical-rl",
      maxWidth: 120,
      maxHeight: 300,
      wrap: "none",
      whiteSpace: "pre-wrap",
    });
    expect(verticalNowrapForcedLine.status).toBe("satisfied");
    expect(verticalNowrapForcedLine.chosenHeightPx ?? 0).toBeGreaterThanOrEqual(
      verticalNowrapForcedLine.usedHeight,
    );

    const leadingNewlineIntrinsic = engine.measureIntrinsicInlineSize({
      text: "\nあ",
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      whiteSpace: "pre-wrap",
    });
    const contentIntrinsic = engine.measureIntrinsicInlineSize({
      text: "あ",
      fontFamily: "JetBrainsMono",
      fallback: ["NotoSansJP"],
      fontSizePx: 20,
      whiteSpace: "pre-wrap",
    });
    expect(leadingNewlineIntrinsic.minContentInlineSize).toBe(
      contentIntrinsic.minContentInlineSize,
    );

    expect(
      engine.shrinkwrapText({
        text: " \t ",
        fontFamily: "JetBrainsMono",
        fallback: ["NotoSansJP"],
        fontSizePx: 20,
        maxWidth: 300,
      }),
    ).toEqual(
      engine.shrinkwrapText({
        text: " \t ",
        fontFamily: "JetBrainsMono",
        fontSizePx: 20,
        maxWidth: 300,
      }),
    );
  });

  it("returns per-line break diagnostics for horizontal measureTextBlock", () => {
    const text = "あいうえおかきくけこさしすせそ";
    const result = engine.measureTextBlock({
      text,
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      maxWidth: 100,
    });

    expect(result.lineCount).toBeGreaterThanOrEqual(2);
    const lines = result.lines;
    expect(lines).toBeDefined();
    expect(lines!.length).toBe(result.lineCount);
    // Contiguous coverage of the full text in grapheme clusters.
    expect(lines![0]!.charStart).toBe(0);
    expect(lines![lines!.length - 1]!.charEnd).toBe([...text].length);
    for (let i = 1; i < lines!.length; i++) {
      expect(lines![i]!.charStart).toBe(lines![i - 1]!.charEnd);
    }
    // Aggregate width equals the widest line.
    const maxLineWidth = Math.max(...lines!.map((line) => line.inlineAdvancePx));
    expect(maxLineWidth).toBeCloseTo(result.usedWidth, 6);
    for (const line of lines!) {
      expect(line.kinsokuUnresolved).toBe(false);
    }
    // Engine-side line text reassembles the measured text exactly.
    expect(lines!.map((line) => line.text).join("")).toBe(text);
  });

  it("rejects unregistered font aliases at the measurement entry", () => {
    expect(() =>
      engine.measureTextBlock({
        text: "あいうえお",
        fontFamily: "NotoSansJP-typo",
        fontSizePx: 20,
        maxWidth: 100,
      }),
    ).toThrowError(/FONT_ALIAS_NOT_REGISTERED|unregistered font alias/);

    expect(() =>
      engine.layoutTextFlow({
        text: "あいうえお",
        fontFamily: "NotoSansJP-typo",
        fontSizePx: 20,
        lineWidths: [100],
      }),
    ).toThrowError(/unregistered font alias/);

    expect(() =>
      engine.measureTextBlock({
        text: "あいうえお",
        fontFamily: "NotoSansJP",
        fallback: ["AlsoMissing"],
        fontSizePx: 20,
        maxWidth: 100,
      }),
    ).toThrowError(/AlsoMissing/);

    // Span-level overrides are validated too.
    expect(() =>
      engine.shrinkwrapText({
        text: "あいうえお",
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
        maxWidth: 100,
        spans: [{ text: "あい", fontFamily: "AlsoMissing" }],
      }),
    ).toThrowError(/AlsoMissing/);

    expect(() =>
      engine.shrinkwrapFlow({
        text: "",
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
        flowBox: { x: 0, y: 0, width: 100, height: 100 },
        exclusions: [],
        spans: [{ text: "あい", fallback: ["AlsoMissing"] }],
      }),
    ).toThrowError(/AlsoMissing/);

    const nestedStyle = {
      font: "NotoSansJP",
      fallback: ["AlsoMissing"],
      fontWeight: 400,
      fontStyle: "normal" as const,
      color: "#000000",
      fontSizePx: 20,
      letterSpacingPx: 0,
    };
    expect(() =>
      engine.measureIntrinsicInlineSize({
        text: "",
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
        richText: [
          {
            kind: "inlineBox",
            style: nestedStyle,
            children: [{ kind: "text", text: "あ" }],
          },
        ],
      }),
    ).toThrowError(/AlsoMissing/);

    // Generic CSS families stay exempt (resolved at rasterization time).
    expect(() =>
      engine.measureIntrinsicInlineSize({
        text: "abc",
        fontFamily: "NotoSansJP",
        fontSizePx: 20,
      }),
    ).not.toThrowError();

    expect(() =>
      engine.measureTextBlock({
        text: "あいうえお",
        fontFamily: " NotoSansJP ",
        fallback: ["", "   ", "NotoSansJP"],
        fontSizePx: 20,
        maxWidth: 100,
      }),
    ).not.toThrowError();
  });

  it("exposes measureIntrinsicInlineSize and supports vertical rich text", () => {
    const engineRecord = engine as unknown as Record<string, unknown>;
    expect("measureIntrinsicInlineSize" in engineRecord).toBe(true);
    expect("measureIntrinsicWidth" in engineRecord).toBe(false);

    const style = {
      font: "NotoSansJP",
      fontWeight: 400,
      fontStyle: "normal" as const,
      color: "#f8fafc",
      fontSizePx: 18,
      lineHeight: 1.4,
      letterSpacingPx: 0,
      textOrientation: "upright" as const,
    };

    const result = engine.measureIntrinsicInlineSize({
      text: "",
      fontFamily: "NotoSansJP",
      fontSizePx: 18,
      language: "ja",
      writingMode: "vertical-rl",
      textOrientation: "upright",
      richText: [
        {
          kind: "ruby",
          style,
          base: [{ kind: "text", text: "春" }],
          rt: [{ kind: "span", text: "はる", style: { ...style, fontSizePx: 9 } }],
        },
        {
          kind: "combine",
          text: "2026",
          style,
        },
      ],
    });

    expect(result.minContentInlineSize).toBeGreaterThan(0);
    expect(result.maxContentInlineSize).toBeGreaterThanOrEqual(result.minContentInlineSize);
  });

  it("bridges real mixed-size crossSize values through WASM", () => {
    const result = engine.layoutTextFlowWithExclusions({
      text: "大小大",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      language: "ja",
      wrap: "char",
      flowBox: { x: 0, y: 0, width: 30, height: 108 },
      exclusions: [],
      spans: [
        { text: "大", fontSizePx: 30 },
        { text: "小", fontSizePx: 12 },
        { text: "大", fontSizePx: 30 },
      ],
    });

    expect(result.exhausted).toBe(true);
    expect(result.lines.map((line) => line.crossSize)).toEqual([45, 18, 45]);
    expect(result.lines.map((line) => line.fragments[0]?.y)).toEqual([0, 45, 63]);
  });
});

type TestIrNode = {
  type?: string;
  bbox: { x: number; y: number; w: number; h: number };
  lines?: Array<{ text: string; width: number }>;
  children?: TestIrNode[];
};

function findTextNode(node: TestIrNode): TestIrNode {
  if (node.type === "text") {
    return node;
  }
  for (const child of node.children ?? []) {
    const match = findTextNodeOrUndefined(child);
    if (match) {
      return match;
    }
  }
  throw new Error("Expected rendered text node");
}

function findTextNodeOrUndefined(node: TestIrNode): TestIrNode | undefined {
  if (node.type === "text") {
    return node;
  }
  for (const child of node.children ?? []) {
    const match = findTextNodeOrUndefined(child);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function flowLineSignature(line: {
  text: string;
  charStart: number;
  charEnd: number;
  inlineAdvancePx: number;
  availableInlineSizePx: number;
}): [string, number, number, number, number] {
  return [
    line.text,
    line.charStart,
    line.charEnd,
    rounded(line.inlineAdvancePx),
    rounded(line.availableInlineSizePx),
  ];
}

function flowText(result: { lines: Array<{ fragments: Array<{ text: string }> }> }): string {
  return result.lines
    .flatMap((line) => line.fragments)
    .map((fragment) => fragment.text)
    .join("");
}

function verticalFlowLineSignature(result: {
  lines: Array<{ fragments: Array<{ text: string; inlineAdvancePx: number }> }>;
}): Array<[string, number]> {
  return result.lines.map((line) => [
    line.fragments.map((fragment) => fragment.text).join(""),
    Number(
      line.fragments
        .reduce((advance, fragment) => advance + fragment.inlineAdvancePx, 0)
        .toFixed(6),
    ),
  ]);
}

function flowInlineAdvance(result: {
  lines: Array<{ fragments: Array<{ inlineAdvancePx: number }> }>;
}): number {
  return Number(
    result.lines
      .flatMap((line) => line.fragments)
      .reduce((advance, fragment) => advance + fragment.inlineAdvancePx, 0)
      .toFixed(6),
  );
}

function exclusionTextByRegion(result: {
  lines: Array<{ fragments: Array<{ regionIndex: number; text: string }> }>;
}): Array<Array<[number, string]>> {
  return result.lines.map((line) => {
    const textByRegion = new Map<number, string>();
    for (const fragment of line.fragments) {
      textByRegion.set(
        fragment.regionIndex,
        `${textByRegion.get(fragment.regionIndex) ?? ""}${fragment.text}`,
      );
    }
    return [...textByRegion];
  });
}

function exclusionGeometry(result: {
  usedLineCount: number;
  lines: Array<{
    crossSize: number;
    fragments: Array<{
      text: string;
      charStart: number;
      charEnd: number;
      x: number;
      y: number;
      inlineAdvancePx: number;
      availableInlineSizePx: number;
    }>;
  }>;
}): unknown {
  return {
    usedLineCount: result.usedLineCount,
    lines: result.lines.map((line) => ({
      crossSize: rounded(line.crossSize),
      fragments: line.fragments.map((fragment) => ({
        text: fragment.text,
        charStart: fragment.charStart,
        charEnd: fragment.charEnd,
        x: rounded(fragment.x),
        y: rounded(fragment.y),
        inlineAdvancePx: rounded(fragment.inlineAdvancePx),
        availableInlineSizePx: rounded(fragment.availableInlineSizePx),
      })),
    })),
  };
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
