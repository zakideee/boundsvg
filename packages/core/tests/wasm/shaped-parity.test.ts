/**
 * Regression tests verifying that the ShapedParagraph fast path
 * does not break text layout semantics when accessed through the WASM pipeline.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import type { IRNode } from "../../src/ir/types.js";
import type { LayoutNode } from "../../src/layout/types.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import {
  assertWasmPkgAvailable,
  loadInterVariableFont,
  loadSubsetFont,
} from "./test-prerequisites.js";

function findTextNode(node: IRNode): IRNode | null {
  if (node.type === "text") {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findTextNode(child);
    if (found) {
      return found;
    }
  }
  return null;
}

function findTextLayoutNode(node: LayoutNode): LayoutNode | null {
  if (node.textLayout) {
    return node;
  }
  for (const child of node.children) {
    const found = findTextLayoutNode(child);
    if (found) {
      return found;
    }
  }
  return null;
}

type FitControlProps = {
  shrinkEpsilonPx?: number;
  shrinkMaxIterations?: number;
  growEpsilonPx?: number;
  growMaxIterations?: number;
};

function renderFitControlResult(engine: Engine, fit: "shrink" | "grow", controls: FitControlProps) {
  const vnode = createElement(
    "Canvas",
    { width: 120, height: 40 },
    createElement(
      "Text",
      {
        font: "NotoSansJP",
        fontSizePx: fit === "shrink" ? 48 : 16,
        wrap: "none",
        fit,
        minFontSizePx: 8,
        maxFontSizePx: 100,
        ...controls,
      },
      "テスト",
    ),
  );
  const textNode = findTextLayoutNode(engine.renderToLayoutTree(vnode).root);
  expect(textNode).not.toBeNull();
  return textNode!.textLayout!.resolvedTextLayout;
}

describe("Shaped parity regression", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    const notoData = loadSubsetFont();
    const interData = loadInterVariableFont();
    engine = await createEngineAsync({
      fonts: [
        { alias: "NotoSansJP", weight: 400, style: "normal", data: notoData },
        { alias: "Inter", weight: 400, style: "normal", data: interData },
      ],
    });
  });

  // -----------------------------------------------------------------------
  // 1. Multi-width measure stability
  // -----------------------------------------------------------------------
  it("multi-width measure stability", () => {
    const text =
      "テキストレイアウトの安定性を検証するテストです。複数の幅で同じテキストを表示します。";
    const widths = [100, 200, 300, 500];
    const lineCounts: number[] = [];

    for (const w of widths) {
      const vnode = createElement(
        "Canvas",
        { width: w, height: 600 },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 20,
            color: "#000",
            wrap: "char",
            language: "ja",
          },
          text,
        ),
      );
      const ir = engine.renderToIR(vnode);
      const textNode = findTextNode(ir.root);
      expect(textNode).not.toBeNull();
      const lines = textNode!.lines!;
      expect(lines.length).toBeGreaterThan(0);

      // Each line width should not exceed container width (with small tolerance)
      for (const line of lines) {
        expect(line.width).toBeLessThanOrEqual(w + 1);
      }

      lineCounts.push(lines.length);
    }

    // Line count should monotonically decrease (or stay same) as width increases
    for (let i = 1; i < lineCounts.length; i++) {
      expect(lineCounts[i]).toBeLessThanOrEqual(lineCounts[i - 1]!);
    }
  });

  // -----------------------------------------------------------------------
  // 2. hangingPunctuation comparison
  // -----------------------------------------------------------------------
  it("hangingPunctuation changes line breaks", () => {
    // Use a width that is tight enough that punctuation hanging makes a difference.
    // At width ~140px with 20px font, each line fits ~7 CJK chars. Hanging punctuation
    // allows 。 and 、 to overhang, potentially fitting one more char on the line.
    const text = "あいうえお。かきくけこ、さしすせそ。たちつてと、なにぬねの。はひふへほ。";

    function renderWithHanging(hanging: boolean): string[] {
      const vnode = createElement(
        "Canvas",
        { width: 140, height: 500 },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 20,
            color: "#000",
            wrap: "char",
            language: "ja",
            hangingPunctuation: hanging,
          },
          text,
        ),
      );
      const ir = engine.renderToIR(vnode);
      const textNode = findTextNode(ir.root);
      expect(textNode).not.toBeNull();
      return textNode!.lines!.map((line) => line.text);
    }

    const linesOff = renderWithHanging(false);
    const linesOn = renderWithHanging(true);

    expect(linesOff.length).toBeGreaterThan(1);
    expect(linesOn.length).toBeGreaterThan(1);

    // Hanging punctuation should produce different line breaks
    const offJoined = linesOff.join("|");
    const onJoined = linesOn.join("|");
    expect(offJoined).not.toBe(onJoined);
  });

  // -----------------------------------------------------------------------
  // 3. textIndent fallback
  // -----------------------------------------------------------------------
  it("textIndent renders without crash", () => {
    const vnode = createElement(
      "Canvas",
      { width: 300, height: 200 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 18,
          color: "#000",
          wrap: "char",
          language: "ja",
          textIndent: 40,
        },
        "字下げのあるテキストです。準備パスの対象外で既存パスにフォールバックします。",
      ),
    );
    const ir = engine.renderToIR(vnode);
    const textNode = findTextNode(ir.root);
    expect(textNode).not.toBeNull();
    expect(textNode!.lines!.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 4. maxLines overflow
  // -----------------------------------------------------------------------
  it("maxLines truncates lines and reports overflow", () => {
    const longText =
      "これは非常に長いテキストです。改行が複数回発生するように十分な長さにしています。三行以上になるはずです。";
    const vnode = createElement(
      "Canvas",
      { width: 200, height: 400 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 18,
          color: "#000",
          wrap: "char",
          language: "ja",
          maxLines: 2,
        },
        longText,
      ),
    );

    // Check IR for line count
    const ir = engine.renderToIR(vnode);
    const textNode = findTextNode(ir.root);
    expect(textNode).not.toBeNull();
    expect(textNode!.lines!.length).toBeLessThanOrEqual(2);

    // Check layout tree for overflow
    const layoutResult = engine.renderToLayoutTree(vnode);
    const layoutNode = findTextLayoutNode(layoutResult.root);
    expect(layoutNode).not.toBeNull();
    const overflow = layoutNode!.textLayout!.resolvedTextLayout.overflow;
    expect(overflow.type).toBe("overflow");
    expect(overflow.reason).toContain("maxLines");
  });

  // -----------------------------------------------------------------------
  // 5. fit=shrink cannot_fit
  // -----------------------------------------------------------------------
  it("fit=shrink reduces font size", () => {
    const vnode = createElement(
      "Canvas",
      { width: 120, height: 40 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 48,
          color: "#000",
          wrap: "char",
          language: "ja",
          fit: "shrink",
          maxLines: 1,
        },
        "テスト文字列です",
      ),
    );

    const layoutResult = engine.renderToLayoutTree(vnode);
    const layoutNode = findTextLayoutNode(layoutResult.root);
    expect(layoutNode).not.toBeNull();
    const { chosenFontSizePx } = layoutNode!.textLayout!.resolvedTextLayout;
    expect(chosenFontSizePx).toBeLessThan(48);
    expect(chosenFontSizePx).toBeGreaterThan(0);
  });

  it("fit=shrink honors explicit Text width without wrapping", () => {
    const vnode = createElement(
      "Canvas",
      { width: 500, height: 120 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 64,
          color: "#000",
          width: 380,
          fit: "shrink",
          wrap: "none",
          language: "ja",
        },
        "長いテキストは縮小される",
      ),
    );

    const layoutResult = engine.renderToLayoutTree(vnode);
    const layoutNode = findTextLayoutNode(layoutResult.root);
    expect(layoutNode).not.toBeNull();
    expect(layoutNode!.bbox.width).toBeLessThanOrEqual(380);

    const resolved = layoutNode!.textLayout!.resolvedTextLayout;
    expect(resolved.chosenFontSizePx).toBeLessThan(64);
    expect(resolved.lines).toHaveLength(1);
    expect(resolved.lines[0]!.width).toBeLessThanOrEqual(380);
    expect(resolved.bbox.w).toBeLessThanOrEqual(380);

    const textNode = findTextNode(engine.renderToIR(vnode).root);
    expect(textNode).not.toBeNull();
    expect(textNode!.bbox.w).toBeLessThanOrEqual(380);
  });

  // -----------------------------------------------------------------------
  // 6. fit=grow initial-doesn't-fit
  // -----------------------------------------------------------------------
  it("fit=grow increases font size for short text in large box", () => {
    // Short text in a large container — grow should increase font size beyond initial 16px.
    const vnode = createElement(
      "Canvas",
      { width: 600, height: 300 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 16,
          color: "#000",
          wrap: "char",
          language: "ja",
          fit: "grow",
        },
        "短い",
      ),
    );

    const layoutResult = engine.renderToLayoutTree(vnode);
    const layoutNode = findTextLayoutNode(layoutResult.root);
    expect(layoutNode).not.toBeNull();
    const { chosenFontSizePx } = layoutNode!.textLayout!.resolvedTextLayout;
    // Should grow beyond initial 16px since there's plenty of room
    expect(chosenFontSizePx).toBeGreaterThan(16);
  });

  it("shrink convergence controls bound termination and improve monotonically", () => {
    const coarse = renderFitControlResult(engine, "shrink", { shrinkEpsilonPx: 100 });
    const zeroIterations = renderFitControlResult(engine, "shrink", {
      shrinkEpsilonPx: 0.0001,
      shrinkMaxIterations: 0,
    });
    const fourIterations = renderFitControlResult(engine, "shrink", {
      shrinkEpsilonPx: 0.0001,
      shrinkMaxIterations: 4,
    });
    const converged = renderFitControlResult(engine, "shrink", {
      shrinkEpsilonPx: 0.0001,
      shrinkMaxIterations: 20,
      growEpsilonPx: 100,
      growMaxIterations: 0,
    });

    expect(coarse.chosenFontSizePx).toBe(8);
    expect(zeroIterations.chosenFontSizePx).toBe(8);
    expect(fourIterations.chosenFontSizePx).toBeGreaterThan(zeroIterations.chosenFontSizePx);
    expect(converged.chosenFontSizePx).toBeGreaterThan(fourIterations.chosenFontSizePx);
    expect(converged.chosenFontSizePx).toBeGreaterThan(39.9);
    expect(converged.lines).toHaveLength(1);
    expect(converged.lines[0]!.width).toBeLessThanOrEqual(120);
  });

  it("grow convergence controls bound termination and improve monotonically", () => {
    const coarse = renderFitControlResult(engine, "grow", { growEpsilonPx: 100 });
    const zeroIterations = renderFitControlResult(engine, "grow", {
      growEpsilonPx: 0.0001,
      growMaxIterations: 0,
    });
    const fourIterations = renderFitControlResult(engine, "grow", {
      growEpsilonPx: 0.0001,
      growMaxIterations: 4,
    });
    const converged = renderFitControlResult(engine, "grow", {
      shrinkEpsilonPx: 100,
      shrinkMaxIterations: 0,
      growEpsilonPx: 0.0001,
      growMaxIterations: 20,
    });

    expect(coarse.chosenFontSizePx).toBe(16);
    expect(zeroIterations.chosenFontSizePx).toBe(16);
    expect(fourIterations.chosenFontSizePx).toBeGreaterThan(zeroIterations.chosenFontSizePx);
    expect(converged.chosenFontSizePx).toBeGreaterThan(fourIterations.chosenFontSizePx);
    expect(converged.chosenFontSizePx).toBeGreaterThan(39.9);
    expect(converged.lines).toHaveLength(1);
    expect(converged.lines[0]!.width).toBeLessThanOrEqual(120);
  });

  // -----------------------------------------------------------------------
  // 7. fontVariationSettings
  // -----------------------------------------------------------------------
  it("fontVariationSettings appear in positionedGlyphs", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 100 },
      createElement(
        "Text",
        {
          font: "Inter",
          fontSizePx: 24,
          color: "#000",
          fontVariationSettings: "'wght' 700",
        },
        "Hello Variable Font",
      ),
    );

    const ir = engine.renderToIR(vnode);
    const textNode = findTextNode(ir.root);
    expect(textNode).not.toBeNull();
    expect(textNode!.lines!.length).toBeGreaterThan(0);

    // Check that fontVariationSettings is propagated
    expect(textNode!.fontVariationSettings).toBe("'wght' 700");

    // Verify positionedGlyphs exist
    const posGlyphs = textNode!.lines!.flatMap((l) => l.positionedGlyphs ?? []);
    expect(posGlyphs.length).toBeGreaterThan(0);
    for (const glyph of posGlyphs) {
      expect(glyph.fontVariationSettings).toBe("'wght' 700");
    }
  });

  // -----------------------------------------------------------------------
  // 8. letterSpacing stability
  // -----------------------------------------------------------------------
  it("letterSpacing produces stable widths", () => {
    const cases = [
      { label: "Latin", text: "Hello World" },
      { label: "CJK", text: "日本語テスト" },
      { label: "Mixed", text: "Hello日本語" },
    ];

    for (const { label, text } of cases) {
      const makeVNode = () =>
        createElement(
          "Canvas",
          { width: 500, height: 100 },
          createElement(
            "Text",
            {
              font: "NotoSansJP",
              fontSizePx: 20,
              color: "#000",
              letterSpacingPx: 2,
            },
            text,
          ),
        );

      const ir1 = engine.renderToIR(makeVNode());
      const ir2 = engine.renderToIR(makeVNode());

      const lines1 = findTextNode(ir1.root)!.lines!;
      const lines2 = findTextNode(ir2.root)!.lines!;

      expect(lines1.length, `${label}: lines exist`).toBeGreaterThan(0);
      expect(lines1.length, `${label}: line count stable`).toBe(lines2.length);

      for (let i = 0; i < lines1.length; i++) {
        expect(lines1[i]!.width, `${label}: line ${i} width > 0`).toBeGreaterThan(0);
        expect(lines1[i]!.width, `${label}: line ${i} width stable`).toBe(lines2[i]!.width);
      }
    }
  });

  // -----------------------------------------------------------------------
  // 9. vertical / rich text non-shaped
  // -----------------------------------------------------------------------
  it("vertical and rich text render correctly outside shaped path", () => {
    // Vertical text
    const verticalVNode = createElement(
      "Canvas",
      { width: 300, height: 200 },
      createElement(
        "Box",
        { width: 300, height: 200 },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 24,
            color: "#000",
            writingMode: "vertical-rl",
            wrap: "char",
            language: "ja",
          },
          "縦書きテスト",
        ),
      ),
    );

    const verticalIR = engine.renderToIR(verticalVNode);
    const verticalText = findTextNode(verticalIR.root);
    expect(verticalText).not.toBeNull();
    expect(verticalText!.lines!.length).toBeGreaterThan(0);

    // Rich text with Inline span
    const richVNode = createElement(
      "Canvas",
      { width: 400, height: 100 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 20,
          color: "#000",
          wrap: "char",
          language: "ja",
        },
        "通常テキスト",
        createElement("Inline", { color: "#ff0000" }, "赤いテキスト"),
        "終わり",
      ),
    );

    const richIR = engine.renderToIR(richVNode);
    const richText = findTextNode(richIR.root);
    expect(richText).not.toBeNull();
    expect(richText!.lines!.length).toBeGreaterThan(0);
  });

  it.each([
    {
      writingMode: "horizontal-tb" as const,
      text: "あ。い",
      inlineSize: 20,
      expectedLines: ["あ", "。", "い"],
    },
    {
      writingMode: "vertical-rl" as const,
      text: "あ。い",
      inlineSize: 20,
      expectedLines: ["あ", "。", "い"],
    },
    {
      writingMode: "horizontal-tb" as const,
      text: "日本語、組版。天地",
      inlineSize: 60,
      expectedLines: ["日本", "語、組", "版。天", "地"],
    },
    {
      writingMode: "vertical-rl" as const,
      text: "日本語、組版。天地",
      inlineSize: 60,
      expectedLines: ["日本", "語、組", "版。天", "地"],
    },
  ])("matches plain Japanese word boundaries in rich $writingMode rendering", ({
    writingMode,
    text,
    inlineSize,
    expectedLines,
  }) => {
    const textProps = {
      font: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      color: "#000000",
      language: "ja" as const,
      wrap: "word" as const,
      writingMode,
      textOrientation: "upright" as const,
      width: writingMode === "vertical-rl" ? 240 : inlineSize,
      height: writingMode === "vertical-rl" ? inlineSize : 240,
    };
    const renderLines = (child: string | ReturnType<typeof createElement>): string[] => {
      const vnode = createElement(
        "Canvas",
        { width: 300, height: 300 },
        createElement("Text", textProps, child),
      );
      const textNode = findTextNode(engine.renderToIR(vnode).root);
      expect(textNode).not.toBeNull();
      return textNode?.lines?.map((line) => line.text) ?? [];
    };

    expect(renderLines(text)).toEqual(expectedLines);
    expect(renderLines(createElement("Inline", { color: "#111111" }, text))).toEqual(expectedLines);
  });

  it("preserves contextual glyph placement in a fragmentable rich run", () => {
    const text = "AVAVAVAV";
    const textProps = {
      font: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.5,
      color: "#000000",
      language: "ja" as const,
      wrap: "word" as const,
      width: 47,
      height: 200,
    };
    const renderSignature = (child: string | ReturnType<typeof createElement>) => {
      const vnode = createElement(
        "Canvas",
        { width: 100, height: 220 },
        createElement("Text", textProps, child),
      );
      const textNode = findTextNode(engine.renderToIR(vnode).root);
      expect(textNode).not.toBeNull();
      return textNode?.lines?.map((line) => ({
        text: line.text,
        width: line.width,
        glyphs: line.positionedGlyphs?.map((glyph) => ({
          glyphId: glyph.glyphId,
          text: glyph.text,
          originX: glyph.originX,
          xAdvance: glyph.xAdvance,
        })),
      }));
    };
    const plain = renderSignature(text);
    const rich = renderSignature(createElement("Inline", { color: "#111111" }, text));

    expect(plain?.map((line) => line.text)).toEqual(["AVAV", "AVAV"]);
    expect(rich).toEqual(plain);
  });

  // -----------------------------------------------------------------------
  // 10. fontSize-only diff
  // -----------------------------------------------------------------------
  it("different fontSize produces different line counts", () => {
    const text = "同じテキストをフォントサイズだけ変えて表示します。行数が変わるはずです。";

    function getLineCount(fontSizePx: number): number {
      const vnode = createElement(
        "Canvas",
        { width: 200, height: 600 },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx,
            color: "#000",
            wrap: "char",
            language: "ja",
          },
          text,
        ),
      );
      const ir = engine.renderToIR(vnode);
      return findTextNode(ir.root)!.lines!.length;
    }

    const lines16 = getLineCount(16);
    const lines32 = getLineCount(32);

    expect(lines16).toBeGreaterThan(0);
    expect(lines32).toBeGreaterThan(0);
    // Larger font should produce more lines in same container
    expect(lines32).toBeGreaterThan(lines16);
  });

  // -----------------------------------------------------------------------
  // 11. Engine.layoutTextFlow end-to-end
  // -----------------------------------------------------------------------
  it("Engine.layoutTextFlow returns flow lines", () => {
    const result = engine.layoutTextFlow({
      text: "あいうえおかきくけこさしすせそ",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      language: "ja",
      wrap: "char",
      lineWidths: [60, 100, 200],
    });
    expect(result.exhausted).toBe(true);
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.lines[0]!.inlineAdvancePx).toBeLessThanOrEqual(61);
    const combined = result.lines.map((l) => l.text).join("");
    expect(combined).toBe("あいうえおかきくけこさしすせそ");
  });
});
