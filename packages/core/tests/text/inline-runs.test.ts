import { describe, expect, it } from "vitest";
import { flattenRichText, flattenTextOnPathRuns } from "../../src/text/inline-runs.js";
import { createElement } from "../../src/vnode/create-element.js";

describe("flattenRichText — Canvas language inheritance", () => {
  it("uses canvasLanguage when Text has no explicit language", () => {
    const vnode = createElement("Text", { font: "Arial", fontSizePx: 16 }, "hello");
    const flattened = flattenRichText(vnode, "ja");
    expect(flattened.runs[0]?.style.language).toBe("ja");
  });

  it("Text-level language overrides canvasLanguage", () => {
    const vnode = createElement("Text", { font: "Arial", fontSizePx: 16, language: "en" }, "hello");
    const flattened = flattenRichText(vnode, "ja");
    expect(flattened.runs[0]?.style.language).toBe("en");
  });

  it("language is undefined when neither Text nor Canvas specifies it", () => {
    const vnode = createElement("Text", { font: "Arial", fontSizePx: 16 }, "hello");
    const flattened = flattenRichText(vnode);
    expect(flattened.runs[0]?.style.language).toBeUndefined();
  });

  it("Inline child inherits canvasLanguage through Text base style", () => {
    const vnode = createElement(
      "Text",
      { font: "Arial", fontSizePx: 16 },
      createElement("Inline", {}, "hello"),
    );
    const flattened = flattenRichText(vnode, "ja");
    expect(flattened.runs[0]?.style.language).toBe("ja");
  });

  it("Inline child explicit language overrides inherited canvasLanguage", () => {
    const vnode = createElement(
      "Text",
      { font: "Arial", fontSizePx: 16 },
      createElement("Inline", { language: "en" }, "hello"),
    );
    const flattened = flattenRichText(vnode, "ja");
    expect(flattened.runs[0]?.style.language).toBe("en");
  });
});

describe("flattenRichText", () => {
  it("normalizes scalar root stroke and applies inherit, replace, and clear semantics", () => {
    const children = () => [
      "A",
      createElement("Inline", { color: "#222222" }, "B"),
      createElement(
        "Inline",
        {
          textStrokes: [{ color: "#00ff00", widthPx: 2 }],
          textShadows: [],
        },
        "C",
      ),
      createElement("Inline", { textStrokes: [], textShadows: [] }, "D"),
    ];
    const rootProps = {
      font: "NotoSansJP",
      fontSizePx: 32,
      color: "#111111",
      textStroke: "#ffffff",
      textStrokeWidth: 3,
      textShadows: [{ dx: 1, dy: 2, color: "#000000" }],
    } as const;
    const text = createElement("Text", rootProps, ...children());
    const flattenedText = flattenRichText(text);
    expect(
      flattenedText.runs.map((run) => ({
        text: run.text,
        color: run.style.color,
        strokes: run.style.textStrokes,
        shadows: run.style.textShadows,
      })),
    ).toEqual([
      {
        text: "A",
        color: "#111111",
        strokes: [expect.objectContaining({ color: "#ffffff", widthPx: 3 })],
        shadows: [{ dx: 1, dy: 2, color: "#000000" }],
      },
      {
        text: "B",
        color: "#222222",
        strokes: [expect.objectContaining({ color: "#ffffff", widthPx: 3 })],
        shadows: [{ dx: 1, dy: 2, color: "#000000" }],
      },
      {
        text: "C",
        color: "#111111",
        strokes: [{ color: "#00ff00", widthPx: 2 }],
        shadows: [],
      },
      { text: "D", color: "#111111", strokes: [], shadows: [] },
    ]);
    expect(flattenedText.richText?.[0]).toEqual(
      expect.objectContaining({
        kind: "span",
        text: "A",
        style: expect.objectContaining({
          textStrokes: [expect.objectContaining({ color: "#ffffff", widthPx: 3 })],
          textShadows: [{ dx: 1, dy: 2, color: "#000000" }],
        }),
      }),
    );

    const textOnPath = createElement(
      "TextOnPath",
      { ...rootProps, d: "M0 20L300 20", width: 300, height: 40 },
      ...children(),
    );
    expect(flattenTextOnPathRuns(textOnPath).runs).toEqual(flattenedText.runs);
  });

  it("assigns stable preorder IDs and keeps InlineRect out of text runs", () => {
    const blink = {
      keyframes: [
        { at: 0, opacity: 0 },
        { at: 1, opacity: 1 },
      ],
      durationMs: 500,
      easing: { type: "steps", count: 1, position: "jump-end" },
    } as const;
    const vnode = createElement(
      "Text",
      { id: "typing", font: "NotoSansJP", fontSizePx: 32 },
      "A",
      createElement(
        "Inline",
        {},
        createElement("InlineRect", { inlineSizePx: 2, color: "#111827", animate: blink }),
      ),
      createElement(
        "InlineBox",
        {},
        "B",
        createElement("InlineRect", {
          inlineSizePx: 10,
          blockSizePx: 2,
          advancePx: 10,
          blockAlign: "end",
          color: "#2563eb",
          opacity: 0.5,
          paintOrder: "behind",
        }),
      ),
    );

    const flattened = flattenRichText(vnode, undefined, "resolved-text-id");

    expect(flattened.text).toBe("AB");
    expect(flattened.runs.map((run) => run.text)).toEqual(["AB"]);
    expect(flattened.inlineRectAnimations).toEqual({
      "resolved-text-id:inline-rect:0": blink,
    });
    expect(flattened.richText).toEqual([
      expect.objectContaining({ kind: "text", text: "A" }),
      expect.objectContaining({
        kind: "inlineRect",
        fragmentId: "resolved-text-id:inline-rect:0",
        inlineSizePx: 2,
        color: "#111827",
      }),
      expect.objectContaining({
        kind: "inlineBox",
        children: [
          expect.objectContaining({ kind: "text", text: "B" }),
          expect.objectContaining({
            kind: "inlineRect",
            fragmentId: "resolved-text-id:inline-rect:1",
            advancePx: 10,
            paintOrder: "behind",
          }),
        ],
      }),
    ]);
  });

  it("keeps decoration ranges separate without selecting rich layout by themselves", () => {
    const vnode = createElement(
      "Text",
      {
        font: "NotoSansJP",
        fontSizePx: 32,
        color: "#111111",
        textDecoration: { line: ["line-through", "underline"], color: "#ef4444" },
      },
      "A",
      createElement("Inline", { textDecoration: "none" }, "B"),
      createElement("Inline", { textDecoration: { line: "overline" } }, "C"),
      "D",
    );

    const flattened = flattenRichText(vnode);
    expect(flattened.hasRichContent).toBe(false);
    expect(flattened.richText).toBeUndefined();
    expect(flattened.runs.map((run) => [run.text, run.style.textDecoration])).toEqual([
      [
        "A",
        {
          line: ["underline", "line-through"],
          color: "#ef4444",
          style: undefined,
          thicknessPx: undefined,
          offsetPx: undefined,
        },
      ],
      ["B", "none"],
      [
        "C",
        {
          line: ["overline"],
          color: undefined,
          style: undefined,
          thicknessPx: undefined,
          offsetPx: undefined,
        },
      ],
      [
        "D",
        {
          line: ["underline", "line-through"],
          color: "#ef4444",
          style: undefined,
          thicknessPx: undefined,
          offsetPx: undefined,
        },
      ],
    ]);
  });

  it("does not inherit Text decoration into Rt annotations", () => {
    const vnode = createElement(
      "Text",
      {
        font: "NotoSansJP",
        fontSizePx: 32,
        textDecoration: { line: "underline" },
      },
      createElement(
        "Ruby",
        {},
        "漢",
        createElement("Rt", {}, "かん"),
        createElement("Rt", { textDecoration: { line: "overline" } }, "kan"),
      ),
    );

    const flattened = flattenRichText(vnode);
    const ruby = flattened.richText?.find((node) => node.kind === "ruby");
    expect(ruby?.kind).toBe("ruby");
    if (ruby?.kind !== "ruby") {
      throw new TypeError("Missing ruby node");
    }
    expect(ruby.rtLevels?.[0]?.[0]).toEqual(
      expect.objectContaining({
        style: expect.objectContaining({ textDecoration: "none" }),
      }),
    );
    expect(ruby.rtLevels?.[1]?.[0]).toEqual(
      expect.objectContaining({
        style: expect.objectContaining({
          textDecoration: expect.objectContaining({ line: ["overline"] }),
        }),
      }),
    );
  });

  it("preserves adjacent manual TCY ranges with matching styles", () => {
    const vnode = createElement(
      "Text",
      {
        font: "NotoSansJP",
        fontSizePx: 32,
        writingMode: "vertical-rl",
      },
      createElement("Inline", { textCombineUpright: "all" }, "12"),
      createElement("Inline", { textCombineUpright: "all" }, "34"),
    );

    const flattened = flattenRichText(vnode);
    expect(flattened.richText).toEqual([
      expect.objectContaining({ kind: "combine", text: "12" }),
      expect.objectContaining({ kind: "combine", text: "34" }),
    ]);
  });

  it("still coalesces adjacent ordinary spans with matching styles", () => {
    const vnode = createElement(
      "Text",
      { font: "NotoSansJP", fontSizePx: 32 },
      createElement("Inline", { color: "#ef4444" }, "A"),
      createElement("Inline", { color: "#ef4444" }, "B"),
    );

    const flattened = flattenRichText(vnode);
    expect(flattened.richText).toEqual([expect.objectContaining({ kind: "span", text: "AB" })]);
  });

  it("preserves Inline semantics inside recursively nested InlineBoxes", () => {
    const vnode = createElement(
      "Text",
      {
        font: "NotoSansJP",
        fontSizePx: 32,
        writingMode: "vertical-rl",
      },
      createElement(
        "InlineBox",
        {},
        createElement("Inline", { color: "#2563eb" }, "年"),
        createElement(
          "InlineBox",
          {},
          createElement("Inline", { color: "#ef4444", textCombineUpright: "all" }, "12"),
        ),
      ),
    );

    const flattened = flattenRichText(vnode);
    expect(flattened.richText).toEqual([
      expect.objectContaining({
        kind: "inlineBox",
        children: [
          expect.objectContaining({
            kind: "span",
            text: "年",
            style: expect.objectContaining({ color: "#2563eb" }),
          }),
          expect.objectContaining({
            kind: "inlineBox",
            children: [
              expect.objectContaining({
                kind: "combine",
                text: "12",
                style: expect.objectContaining({ color: "#ef4444" }),
              }),
            ],
          }),
        ],
      }),
    ]);
  });

  it("preserves Text-level line height in rich text spans and ruby base", () => {
    const vnode = createElement(
      "Text",
      {
        font: "NotoSansJP",
        fontSizePx: 22,
        lineHeight: 1.8,
        lineHeightPx: 52,
      },
      "前",
      createElement("Ruby", {}, "境界", createElement("Rt", {}, "きょうかい")),
    );

    const flattened = flattenRichText(vnode);
    expect(flattened.runs[0]?.style).toEqual(
      expect.objectContaining({
        lineHeight: 1.8,
        lineHeightPx: 52,
      }),
    );

    const ruby = flattened.richText?.find((node) => node.kind === "ruby");
    expect(ruby).toEqual(
      expect.objectContaining({
        style: expect.objectContaining({
          lineHeight: 1.8,
          lineHeightPx: 52,
        }),
      }),
    );
    expect(ruby?.base[0]).toEqual({
      kind: "text",
      text: "境界",
    });
    expect(ruby?.rt[0]).toEqual({
      kind: "span",
      text: "きょうかい",
      style: expect.objectContaining({
        lineHeight: 1,
        lineHeightPx: undefined,
      }),
    });
  });

  it("preserves ruby annotation style overrides", () => {
    const vnode = createElement(
      "Text",
      {
        font: "NotoSansJP",
        fontSizePx: 38,
        color: "#f8fafc",
      },
      "東",
      createElement(
        "Ruby",
        {
          rubyPosition: "alternate",
          rubyAlign: "space-between",
          rubyGapPx: -1,
          rubyOffsetPx: 2,
          rubyLineSizing: "css",
        },
        "京",
        createElement("Rt", { color: "#fca5a5" }, "きょう"),
        createElement("Rt", { color: "#93c5fd" }, "Tokyo"),
      ),
      "都",
    );

    const flattened = flattenRichText(vnode);
    const ruby = flattened.richText?.find((node) => node.kind === "ruby");

    expect(ruby).toBeDefined();
    expect(ruby?.kind).toBe("ruby");
    expect(ruby?.rubyPosition).toBe("alternate");
    expect(ruby?.rubyAlign).toBe("space-between");
    expect(ruby?.rubyGapPx).toBe(-1);
    expect(ruby?.rubyOffsetPx).toBe(2);
    expect(ruby?.rubyLineSizing).toBe("css");
    expect(ruby?.rt).toEqual([
      {
        kind: "span",
        text: "きょう",
        style: expect.objectContaining({
          color: "#fca5a5",
          fontSizePx: 19,
          lineHeight: 1,
        }),
      },
    ]);
    expect(ruby?.rtLevels).toHaveLength(2);
    expect(ruby?.rtLevels?.[1]).toEqual([
      {
        kind: "span",
        text: "Tokyo",
        style: expect.objectContaining({
          color: "#93c5fd",
          fontSizePx: 19,
          lineHeight: 1,
        }),
      },
    ]);
  });

  it("defaults rubyPosition to alternate", () => {
    const vnode = createElement(
      "Text",
      { font: "NotoSansJP", fontSizePx: 32 },
      createElement("Ruby", {}, "京", createElement("Rt", {}, "きょう")),
    );

    const flattened = flattenRichText(vnode);
    const ruby = flattened.richText?.find((node) => node.kind === "ruby");

    expect(ruby?.rubyPosition).toBe("alternate");
    expect(ruby?.rubyLineSizing).toBeUndefined();
  });
});
