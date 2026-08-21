import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import type { IRNode } from "../../src/ir/types.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "./test-prerequisites.js";

function pngBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

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

function findTextNodes(node: IRNode): IRNode[] {
  const result: IRNode[] = [];
  const walk = (current: IRNode) => {
    if (current.type === "text") {
      result.push(current);
    }
    for (const child of current.children ?? []) {
      walk(child);
    }
  };
  walk(node);
  return result;
}

function findNodeById(node: IRNode, nodeId: string): IRNode | null {
  if (node.nodeId === nodeId) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findNodeById(child, nodeId);
    if (found) {
      return found;
    }
  }
  return null;
}

function bboxCenterX(bbox: { x: number; w: number }): number {
  return bbox.x + bbox.w / 2;
}

function collectLineIndexesForGlyphTexts(
  node: IRNode | null,
  targets: string[],
): Map<string, number[]> {
  const wanted = new Set(targets);
  const indexes = new Map<string, number[]>();

  node?.lines?.forEach((line, lineIndex) => {
    for (const glyph of line.positionedGlyphs ?? []) {
      if (!wanted.has(glyph.text)) {
        continue;
      }
      const existing = indexes.get(glyph.text) ?? [];
      existing.push(lineIndex);
      indexes.set(glyph.text, existing);
    }
  });

  return indexes;
}

function makeEmbeddedSvgImageDataUrl(showLabel: boolean): string {
  const label = showLabel
    ? `<text x="16" y="156" font-size="20" fill="#ffffff" font-family="sans-serif">SVG Image</text>`
    : "";
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180" viewBox="0 0 240 180">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#2a2a72"/>
        <stop offset="100%" stop-color="#009ffd"/>
      </linearGradient>
    </defs>
    <rect width="240" height="180" fill="url(#g)"/>
    <circle cx="188" cy="42" r="22" fill="#ffd166" opacity="0.85"/>
    <rect x="0" y="120" width="240" height="60" fill="#111827" opacity="0.5"/>
    ${label}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`;
}

describe("Real WASM pipeline", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    const fontData = loadSubsetFont();
    engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: fontData }],
    });
  });

  it("renders Canvas + Box with background to SVG", () => {
    const vnode = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement("Box", {
        id: "box1",
        width: 200,
        height: 100,
        background: "#ff0000",
      }),
    );

    const svg = engine.renderToSvg(vnode);
    expect(svg).toContain("<svg");
    expect(svg).toContain('viewBox="0 0 800 600"');
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain("</svg>");
  });

  it("emits CSS gradient geometry without object-bounding-box distortion", () => {
    const renderBackground = (id: string, background: string) =>
      engine.renderToSvg(
        createElement(
          "Canvas",
          { width: 192, height: 108 },
          createElement("Box", { id, width: 192, height: 108, background }),
        ),
      );

    const linear = renderBackground("linear", "linear-gradient(45deg, red, blue)");
    expect(linear).toContain(
      '<linearGradient id="grad-linear:bg" gradientUnits="userSpaceOnUse" x1="21" y1="129" x2="171" y2="-21">',
    );

    const radialDefault = renderBackground("radial-default", "radial-gradient(red, blue)");
    expect(radialDefault).toContain('gradientTransform="matrix(135.7645 0 0 76.3675 96 54)"');

    const radialCorner = renderBackground(
      "radial-corner",
      "radial-gradient(circle at 100% 100%, red, blue)",
    );
    expect(radialCorner).toContain('gradientTransform="matrix(220.2907 0 0 220.2907 192 108)"');

    expect(() => renderBackground("invalid", "linear-gradient(45degrees, red, blue)")).toThrow(
      /unsupported or invalid gradient syntax/,
    );
  });

  it("renders Canvas + Text (Japanese) to SVG", () => {
    const vnode = createElement(
      "Canvas",
      { width: 800, height: 600 },
      createElement(
        "Text",
        {
          id: "txt1",
          font: "NotoSansJP",
          fontSizePx: 24,
          color: "#333333",
        },
        "テスト文字列",
      ),
    );

    const svg = engine.renderToSvg(vnode);
    expect(svg).toContain("テスト文字列");
    expect(svg).toContain('fill="#333333"');
    expect(svg).toContain('data-boundsvg-text="テスト文字列"');
    expect(svg).toContain("<path");
  });

  it("renders to IR with correct structure", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Box", {
        id: "b1",
        width: 200,
        height: 100,
        background: "#0000ff",
      }),
    );

    const ir = engine.renderToIR(vnode);
    expect(ir.width).toBe(400);
    expect(ir.height).toBe(300);
    expect(ir.root.type).toBe("group");
    expect(ir.drawOrder.length).toBeGreaterThan(0);
    expect(ir.warnings).toHaveLength(0);
  });

  it("decodes omitted text-effect options from fragment and rich-inline carriers", () => {
    const fragmentVNode = createElement(
      "Canvas",
      { width: 320, height: 120 },
      createElement(
        "Text",
        {
          id: "rich-effects",
          font: "NotoSansJP",
          fontSizePx: 28,
          color: "#2563eb",
          textStrokes: [{ color: "#ffffff", widthPx: 3 }],
          textShadows: [{ dx: 2, dy: 2, color: "#00000080" }],
        },
        createElement("Inline", {}, "境界"),
      ),
    );

    const fragmentTextNode = findTextNode(engine.renderToIR(fragmentVNode).root);
    const fragment = fragmentTextNode?.lines
      ?.flatMap((line) => line.fragments ?? [])
      .find((candidate) => candidate.style?.color === "#2563eb");
    const stroke = fragment?.style?.textStrokes?.[0];
    const shadow = fragment?.style?.textShadows?.[0];

    expect(stroke).toEqual({ color: "#ffffff", widthPx: 3 });
    expect(stroke).not.toHaveProperty("linejoin");
    expect(stroke).not.toHaveProperty("linecap");
    expect(stroke).not.toHaveProperty("dasharray");
    expect(stroke).not.toHaveProperty("miterlimit");
    expect(shadow).toEqual({ dx: 2, dy: 2, color: "#00000080" });
    expect(shadow).not.toHaveProperty("blurPx");

    const richInlineVNode = createElement(
      "Canvas",
      { width: 320, height: 120 },
      createElement(
        "Text",
        {
          id: "rich-inline-effects",
          font: "NotoSansJP",
          fontSizePx: 28,
          color: "#111827",
        },
        "root",
        createElement(
          "Inline",
          {
            color: "#2563eb",
            textStrokes: [{ color: "#ffffff", widthPx: 3 }],
            textShadows: [{ dx: 2, dy: 2, color: "#00000080" }],
          },
          "境界",
        ),
      ),
    );
    const richTextNode = findTextNode(engine.renderToIR(richInlineVNode).root);
    const richGlyph = richTextNode?.lines
      ?.flatMap((line) => line.positionedGlyphs ?? [])
      .find((glyph) => glyph.text === "境");
    expect(richGlyph?.textStrokes?.[0]).toEqual({ color: "#ffffff", widthPx: 3 });
    expect(richGlyph?.textShadows?.[0]).toEqual({
      dx: 2,
      dy: 2,
      color: "#00000080",
    });
    expect(richGlyph?.textStrokes?.[0]).not.toHaveProperty("linejoin");
    expect(richGlyph?.textShadows?.[0]).not.toHaveProperty("blurPx");
  });

  it("uses preferredFrame for text measurement inside definite Text size", () => {
    const content = "天地玄黄宇宙洪荒日月盈昃辰宿列張寒来暑往秋収冬蔵";
    const makeHorizontal = (preferredWidth?: number) =>
      createElement(
        "Canvas",
        { width: 400, height: 400 },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 20,
            width: 280,
            wrap: "char",
            ...(preferredWidth === undefined ? {} : { preferredFrame: { w: preferredWidth } }),
          },
          content,
        ),
      );
    const makeHorizontalAuto = (preferredWidth?: number) =>
      createElement(
        "Canvas",
        { width: 400, height: 400 },
        createElement(
          "Flex",
          { direction: "row", alignItems: "start" },
          createElement(
            "Text",
            {
              font: "NotoSansJP",
              fontSizePx: 20,
              wrap: "char",
              ...(preferredWidth === undefined ? {} : { preferredFrame: { w: preferredWidth } }),
            },
            content,
          ),
        ),
      );
    const makeVertical = (preferredHeight?: number) =>
      createElement(
        "Canvas",
        { width: 400, height: 400 },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 20,
            height: 280,
            writingMode: "vertical-rl",
            textOrientation: "upright",
            wrap: "char",
            ...(preferredHeight === undefined ? {} : { preferredFrame: { h: preferredHeight } }),
          },
          content,
        ),
      );

    const horizontalWithout = engine.renderToLayoutTree(makeHorizontal()).root.children[0];
    const horizontalWith = engine.renderToLayoutTree(makeHorizontal(80)).root.children[0];
    expect(horizontalWith?.bbox.width).toBe(280);
    expect(horizontalWith?.textLayout?.resolvedTextLayout.bbox.w).toBeLessThanOrEqual(80.01);
    expect(horizontalWith?.textLayout?.resolvedTextLayout.lines.length).toBeGreaterThan(
      horizontalWithout?.textLayout?.resolvedTextLayout.lines.length ?? 0,
    );

    const verticalWithout = engine.renderToLayoutTree(makeVertical()).root.children[0];
    const verticalWith = engine.renderToLayoutTree(makeVertical(80)).root.children[0];
    expect(verticalWith?.bbox.height).toBe(280);
    expect(verticalWith?.textLayout?.resolvedTextLayout.bbox.h).toBeLessThanOrEqual(80.01);
    expect(verticalWith?.textLayout?.resolvedTextLayout.lines.length).toBeGreaterThan(
      verticalWithout?.textLayout?.resolvedTextLayout.lines.length ?? 0,
    );

    expect(engine.renderToSvg(makeHorizontal(80))).not.toBe(engine.renderToSvg(makeHorizontal()));
    expect(
      pngBytesEqual(engine.renderToPng(makeVertical(80)), engine.renderToPng(makeVertical())),
    ).toBe(false);

    const horizontalEqualFrame = engine.renderToLayoutTree(makeHorizontal(280)).root.children[0];
    expect(horizontalEqualFrame?.textLayout?.resolvedTextLayout).toEqual(
      horizontalWithout?.textLayout?.resolvedTextLayout,
    );
    expect(engine.renderToSvg(makeHorizontal(280))).toBe(engine.renderToSvg(makeHorizontal()));

    const horizontalAutoWithout = engine.renderToLayoutTree(makeHorizontalAuto()).root.children[0]
      ?.children[0];
    const horizontalAutoWith = engine.renderToLayoutTree(makeHorizontalAuto(80)).root.children[0]
      ?.children[0];
    expect(horizontalAutoWithout?.bbox.width).toBeGreaterThan(80);
    expect(horizontalAutoWith?.bbox.width).toBe(80);
    expect(horizontalAutoWith?.textLayout?.resolvedTextLayout.lines.length).toBeGreaterThan(
      horizontalAutoWithout?.textLayout?.resolvedTextLayout.lines.length ?? 0,
    );
  });

  it("keeps flexGrow columns inside parent padding when justifyContent=center", () => {
    const vnode = createElement(
      "Canvas",
      { width: 800, height: 600, background: "#1a1a1a" },
      createElement(
        "Flex",
        {
          id: "outer",
          direction: "row",
          justifyContent: "center",
          alignItems: "stretch",
          width: 800,
          height: 600,
          padding: 40,
          gap: 32,
        },
        createElement(
          "Flex",
          { id: "left", direction: "column", flexGrow: 1 },
          createElement(
            "Text",
            { id: "label", font: "NotoSansJP", fontSizePx: 14, color: "#64748b", language: "ja" },
            "NFC正規化テスト (横書き)",
          ),
          createElement(
            "Text",
            {
              id: "body",
              font: "NotoSansJP",
              fontSizePx: 28,
              color: "#fef3c7",
              wrap: "char",
              language: "ja",
            },
            "NFD濁点テスト：か\u{3099}き\u{3099}く\u{3099}。波ダッシュ～変換テスト〜。",
          ),
        ),
        createElement(
          "Flex",
          { id: "right", direction: "column", flexGrow: 1 },
          createElement(
            "Text",
            {
              id: "vertical",
              font: "NotoSansJP",
              fontSizePx: 22,
              color: "#a5f3fc",
              writingMode: "vertical-rl",
              wrap: "char",
              language: "ja",
            },
            "縦書きでABCと123の位置を確認。句読点（。、）も正しく配置される。",
          ),
        ),
      ),
    );

    const ir = engine.renderToIR(vnode);
    const label = findNodeById(ir.root, "label");
    const body = findNodeById(ir.root, "body");
    const left = findNodeById(ir.root, "left");
    const right = findNodeById(ir.root, "right");

    expect(label?.bbox.x).toBeGreaterThanOrEqual(39.5);
    expect(body?.bbox.x).toBeGreaterThanOrEqual(39.5);
    expect(left?.bbox.x).toBeGreaterThanOrEqual(39.5);
    expect((right?.bbox.x ?? 0) + (right?.bbox.w ?? 0)).toBeLessThanOrEqual(760.5);
  });

  it("keeps multi-column vertical text inside parent padding when pushed by a flex spacer", () => {
    // Regression: min/max-content width for vertical text must not clamp to a
    // single column. A flex spacer pushed the vertical text right and its real
    // multi-column width overflowed past the right padding (clipped).
    const vnode = createElement(
      "Canvas",
      { width: 800, height: 300, background: "#1a1a1a" },
      createElement(
        "Flex",
        { direction: "row", width: 800, height: 300, padding: [20, 24, 20, 24] },
        createElement("Flex", { flexGrow: 1 }),
        createElement(
          "Text",
          {
            id: "vtext",
            font: "NotoSansJP",
            fontSizePx: 28,
            color: "#fef3c7",
            writingMode: "vertical-rl",
            wrap: "char",
            language: "ja",
            hangingPunctuation: true,
          },
          "縦書きのサンプルです。句読点（。、）は行頭禁則によりぶら下げ配置されます。長い文章でも自然な折り返しが行われ、読みやすいレイアウトを維持します。",
        ),
      ),
    );

    const vtext = findNodeById(engine.renderToIR(vnode).root, "vtext");
    // Right edge must stay within the right padding (800 - 24 = 776).
    expect((vtext?.bbox.x ?? 0) + (vtext?.bbox.w ?? 0)).toBeLessThanOrEqual(776.5);
    // Box must not be clamped to a single column then flushed to the right edge.
    expect(vtext?.bbox.w ?? 0).toBeGreaterThan(100);
  });

  it("renders to PNG with valid magic bytes", () => {
    const vnode = createElement(
      "Canvas",
      { width: 200, height: 100 },
      createElement("Box", {
        width: 200,
        height: 100,
        background: "#00ff00",
      }),
    );

    const png = engine.renderToPng(vnode);
    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });

  it("renders vertical text into PNG when writingMode=vertical-rl", () => {
    const backgroundOnly = createElement(
      "Canvas",
      { width: 360, height: 360, background: "#0b1020" },
      createElement("Box", { width: 360, height: 360 }),
    );
    const withVerticalText = createElement(
      "Canvas",
      { width: 360, height: 360, background: "#0b1020" },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 42,
          color: "#fef3c7",
          writingMode: "vertical-rl",
          lineHeight: 1.3,
          wrap: "char",
          language: "ja",
          hangingPunctuation: true,
        },
        "縦書きサンプル。句読点の位置も確認できます。",
      ),
    );

    const pngBase = engine.renderToPng(backgroundOnly);
    const pngWithText = engine.renderToPng(withVerticalText);
    expect(pngBytesEqual(pngBase, pngWithText)).toBe(false);
  });

  it("keeps textOrientation='upright' ASCII upright in vertical text", () => {
    const vnode = createElement(
      "Canvas",
      { width: 320, height: 520, background: "#0b1020" },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 36,
          color: "#fef3c7",
          writingMode: "vertical-rl",
          wrap: "char",
          language: "ja",
          lineHeight: 1.4,
        },
        "縦組みで",
        createElement("Inline", { textOrientation: "upright", color: "#93c5fd" }, "API"),
        "を確認する",
      ),
    );

    const textNode = findTextNode(engine.renderToIR(vnode).root);
    const asciiGlyphs =
      textNode?.lines?.flatMap((line) =>
        (line.positionedGlyphs ?? []).filter((glyph) => /^[API]$/.test(glyph.text)),
      ) ?? [];

    expect(asciiGlyphs.length).toBeGreaterThan(0);
    asciiGlyphs.forEach((glyph) => {
      expect(glyph.rotationDeg).toBe(0);
    });
  });

  it("supports shrinkwrapText for vertical-rl plain text", () => {
    const result = engine.shrinkwrapText({
      text: "天地玄黄宇宙洪荒日月盈昃",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.4,
      language: "ja",
      wrap: "char",
      hangingPunctuation: true,
      writingMode: "vertical-rl",
      textOrientation: "upright",
      maxWidth: 120,
      maxHeight: 220,
      minHeight: 40,
    });

    expect(result.status).toBe("satisfied");
    expect("chosenHeightPx" in result).toBe(true);
    expect(result.chosenHeightPx).toBeDefined();
    expect(result.usedWidth).toBeLessThanOrEqual(120);
  });

  it("supports shrinkwrapFlow for vertical-rl with textOrientation", () => {
    const result = engine.shrinkwrapFlow({
      text: "",
      fontFamily: "NotoSansJP",
      fontSizePx: 20,
      lineHeight: 1.4,
      language: "ja",
      wrap: "char",
      writingMode: "vertical-rl",
      textOrientation: "upright",
      flowBox: { x: 0, y: 0, width: 120, height: 220 },
      exclusions: [],
      minHeight: 40,
      spans: [{ text: "縦組み" }, { text: "ABC123", color: "#93c5fd" }],
    });

    expect(result.status).toBe("satisfied");
    expect(result.chosenHeightPx).toBeDefined();
    expect(result.layout.lines.length).toBeGreaterThan(0);
  });

  it("keeps textCombineUpright content within a shorter vertical advance", () => {
    const plain = createElement(
      "Canvas",
      { width: 220, height: 520, background: "#111827" },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 36,
          color: "#e2e8f0",
          writingMode: "vertical-rl",
          wrap: "none",
          language: "ja",
          lineHeight: 1.4,
        },
        "令和2026年",
      ),
    );
    const combined = createElement(
      "Canvas",
      { width: 220, height: 520, background: "#111827" },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 36,
          color: "#e2e8f0",
          writingMode: "vertical-rl",
          wrap: "none",
          language: "ja",
          lineHeight: 1.4,
        },
        "令和",
        createElement("Inline", { textCombineUpright: "all", color: "#38bdf8" }, "2026"),
        "年",
      ),
    );

    const plainText = findTextNode(engine.renderToIR(plain).root);
    const combinedText = findTextNode(engine.renderToIR(combined).root);
    const combinedDigits =
      combinedText?.lines?.flatMap((line) =>
        (line.positionedGlyphs ?? []).filter((glyph) => /^[0-9]$/.test(glyph.text)),
      ) ?? [];
    expect(plainText?.bbox.h).toBeGreaterThan(0);
    expect(combinedText?.bbox.h).toBeGreaterThan(0);
    expect(combinedText!.bbox.h).toBeLessThan(plainText!.bbox.h);
    expect(combinedDigits).toHaveLength(4);
    combinedDigits.forEach((glyph) => {
      expect(glyph.outlineWritingMode).toBe("horizontal-tb");
    });
  });

  it("keeps adjacent manual TCY ranges in separate cells when their styles match", () => {
    const makeScene = (variant: "single" | "split-same" | "split-distinct-style") => {
      const digitChildren =
        variant === "single"
          ? [createElement("Inline", { textCombineUpright: "all" }, "1234")]
          : [
              createElement("Inline", { textCombineUpright: "all" }, "12"),
              createElement(
                "Inline",
                {
                  textCombineUpright: "all",
                  ...(variant === "split-distinct-style" ? { color: "#0f172a" } : {}),
                },
                "34",
              ),
            ];
      return createElement(
        "Canvas",
        { width: 320, height: 280, background: "#ffffff" },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 32,
            lineHeight: 1.2,
            color: "#111827",
            language: "ja",
            wrap: "char",
            writingMode: "vertical-rl",
            height: 220,
          },
          "年",
          ...digitChildren,
          "月",
        ),
      );
    };
    const single = findTextNode(engine.renderToIR(makeScene("single")).root);
    const splitSame = findTextNode(engine.renderToIR(makeScene("split-same")).root);
    const splitDistinctStyle = findTextNode(
      engine.renderToIR(makeScene("split-distinct-style")).root,
    );
    const splitDigits = new Map(
      splitSame?.lines?.flatMap((line) =>
        (line.positionedGlyphs ?? [])
          .filter((glyph) => /^[1-4]$/.test(glyph.text))
          .map((glyph) => [glyph.text, glyph] as const),
      ),
    );

    expect(splitSame?.bbox.h).toBeGreaterThan(single?.bbox.h ?? Number.POSITIVE_INFINITY);
    expect(splitSame?.bbox.h).toBeCloseTo(splitDistinctStyle?.bbox.h ?? 0);
    expect(splitDigits.get("1")?.originY).toBeCloseTo(splitDigits.get("2")?.originY ?? 0);
    expect(splitDigits.get("3")?.originY).toBeCloseTo(splitDigits.get("4")?.originY ?? 0);
    expect(splitDigits.get("1")?.originY).not.toBeCloseTo(splitDigits.get("3")?.originY ?? 0);
  });

  it("honors manual TCY inside direct and nested InlineBoxes", () => {
    const makeScene = (
      writingMode: "horizontal-tb" | "vertical-rl",
      nesting: 1 | 2,
      combine: boolean,
    ) => {
      const inline = createElement("Inline", combine ? { textCombineUpright: "all" } : {}, "12");
      const inner = createElement("InlineBox", { paddingInline: [3, 3] }, inline);
      const subject =
        nesting === 1 ? inner : createElement("InlineBox", { paddingInline: [3, 3] }, inner);
      return createElement(
        "Canvas",
        { width: 320, height: 280, background: "#ffffff" },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 32,
            lineHeight: 1.2,
            color: "#111827",
            language: "ja",
            wrap: "char",
            writingMode,
            ...(writingMode === "vertical-rl" ? { height: 220 } : { width: 260 }),
          },
          "年",
          subject,
          "月",
        ),
      );
    };
    const renderText = (
      writingMode: "horizontal-tb" | "vertical-rl",
      nesting: 1 | 2,
      combine: boolean,
    ) => findTextNode(engine.renderToIR(makeScene(writingMode, nesting, combine)).root);

    for (const nesting of [1, 2] as const) {
      const plain = renderText("vertical-rl", nesting, false);
      const combined = renderText("vertical-rl", nesting, true);
      const combinedDigits =
        combined?.lines?.flatMap((line) =>
          (line.positionedGlyphs ?? []).filter((glyph) => /^[12]$/.test(glyph.text)),
        ) ?? [];

      expect(combined?.bbox.h).toBeLessThan(plain?.bbox.h ?? 0);
      expect(combinedDigits).toHaveLength(2);
      expect(combinedDigits[0]?.originY).toBeCloseTo(combinedDigits[1]?.originY ?? 0);
      combinedDigits.forEach((glyph) => {
        expect(glyph.rotationDeg).toBe(0);
        expect(glyph.outlineWritingMode).toBe("horizontal-tb");
      });
    }

    for (const nesting of [1, 2] as const) {
      expect(renderText("horizontal-tb", nesting, true)).toEqual(
        renderText("horizontal-tb", nesting, false),
      );
    }
  });

  it("applies textIndent to the first horizontal line and first vertical column", () => {
    const horizontalBase = createElement(
      "Canvas",
      { width: 640, height: 240, background: "#131a24" },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 28,
          color: "#f8fafc",
          wrap: "char",
          lineHeight: 1.6,
        },
        "textIndent の比較です。折り返しても二行目以降は揃います。",
      ),
    );
    const horizontalIndented = createElement(
      "Canvas",
      { width: 640, height: 240, background: "#131a24" },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 28,
          color: "#f8fafc",
          wrap: "char",
          lineHeight: 1.6,
          textIndent: 48,
        },
        "textIndent の比較です。折り返しても二行目以降は揃います。",
      ),
    );
    const verticalBase = createElement(
      "Canvas",
      { width: 320, height: 520, background: "#131a24" },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 30,
          color: "#fde68a",
          writingMode: "vertical-rl",
          wrap: "char",
          language: "ja",
          lineHeight: 1.45,
        },
        "縦組みの字下げ比較です。",
      ),
    );
    const verticalIndented = createElement(
      "Canvas",
      { width: 320, height: 520, background: "#131a24" },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 30,
          color: "#fde68a",
          writingMode: "vertical-rl",
          wrap: "char",
          language: "ja",
          lineHeight: 1.45,
          textIndent: 36,
        },
        "縦組みの字下げ比較です。",
      ),
    );

    const baseHorizontalFirst = findTextNode(engine.renderToIR(horizontalBase).root)?.lines?.[0]
      ?.positionedGlyphs?.[0];
    const indentedHorizontalFirst = findTextNode(engine.renderToIR(horizontalIndented).root)
      ?.lines?.[0]?.positionedGlyphs?.[0];
    const baseVerticalFirst = findTextNode(engine.renderToIR(verticalBase).root)?.lines?.[0]
      ?.positionedGlyphs?.[0];
    const indentedVerticalFirst = findTextNode(engine.renderToIR(verticalIndented).root)?.lines?.[0]
      ?.positionedGlyphs?.[0];

    expect(indentedHorizontalFirst?.originX).toBeGreaterThan(baseHorizontalFirst?.originX ?? 0);
    expect(indentedVerticalFirst?.originY).toBeGreaterThan(baseVerticalFirst?.originY ?? 0);
  });

  it("renders the vertical advanced template without panicking", () => {
    const vnode = createElement(
      "Canvas",
      { width: 840, height: 460, background: "#0b1020" },
      createElement(
        "Flex",
        { direction: "row", width: 840, height: 460, padding: 24, gap: 24 },
        createElement(
          "Flex",
          { direction: "column", width: 132, height: 412 },
          createElement(
            "Text",
            {
              font: "NotoSansJP",
              fontSizePx: 34,
              color: "#fef3c7",
              writingMode: "vertical-rl",
              lineHeight: 1.35,
              wrap: "char",
              textIndent: 24,
              language: "ja",
              flexGrow: 1,
            },
            "令和",
            createElement("Inline", { textCombineUpright: "all", color: "#fca5a5" }, "2026"),
            "年の",
            createElement("Inline", { textOrientation: "upright", color: "#93c5fd" }, "API"),
            "設計を縦組みで確認します。",
          ),
        ),
        createElement(
          "Flex",
          { direction: "column", width: 636, height: 412 },
          createElement(
            "Text",
            {
              font: "NotoSansJP",
              fontSizePx: 26,
              color: "#cbd5e1",
              wrap: "char",
              lineHeight: 1.6,
              textIndent: 48,
              flexGrow: 1,
            },
            "横組み側では textIndent の効き方を比較します。先頭だけを下げ、二行目以降は揃えたままにします。",
          ),
        ),
      ),
    );

    const ir = engine.renderToIR(vnode);
    const textNodes = findTextNodes(ir.root);

    expect(textNodes).toHaveLength(2);
    expect(textNodes.every((node) => node.bbox.x >= 0 && node.bbox.y >= 0)).toBe(true);
    expect(textNodes.every((node) => node.bbox.x + node.bbox.w <= 840)).toBe(true);
    expect(textNodes.every((node) => node.bbox.y + node.bbox.h <= 460)).toBe(true);
  });

  it("keeps horizontal ruby inline flow anchored and expands vertical columns for side annotations", () => {
    const horizontalPlain = createElement(
      "Canvas",
      { width: 420, height: 240, background: "#101826" },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 38, color: "#f8fafc", wrap: "char" },
        "東京都",
      ),
    );
    const horizontalRuby = createElement(
      "Canvas",
      { width: 420, height: 240, background: "#101826" },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 38, color: "#f8fafc", wrap: "char" },
        "東",
        createElement("Ruby", {}, "京", createElement("Rt", {}, "きょう")),
        "都",
      ),
    );
    const verticalPlain = createElement(
      "Canvas",
      { width: 260, height: 520, background: "#101826" },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 30,
          color: "#fde68a",
          writingMode: "vertical-rl",
          wrap: "char",
          language: "ja",
          lineHeight: 1.4,
        },
        "古都案内",
      ),
    );
    const verticalRuby = createElement(
      "Canvas",
      { width: 260, height: 520, background: "#101826" },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 30,
          color: "#fde68a",
          writingMode: "vertical-rl",
          wrap: "char",
          language: "ja",
          lineHeight: 1.4,
        },
        "古",
        createElement("Ruby", { rubyPosition: "under" }, "都", createElement("Rt", {}, "みやこ")),
        "案内",
      ),
    );

    const horizontalPlainNode = findTextNode(engine.renderToIR(horizontalPlain).root);
    const horizontalRubyNode = findTextNode(engine.renderToIR(horizontalRuby).root);
    const verticalPlainNode = findTextNode(engine.renderToIR(verticalPlain).root);
    const verticalRubyNode = findTextNode(engine.renderToIR(verticalRuby).root);

    expect(horizontalRubyNode!.bbox.h).toBeGreaterThan(horizontalPlainNode!.bbox.h);
    expect(horizontalRubyNode!.bbox.w).toBeCloseTo(horizontalPlainNode!.bbox.w, 4);
    expect(verticalRubyNode!.bbox.w).toBeGreaterThan(verticalPlainNode!.bbox.w + 2);
    expect(verticalRubyNode!.bbox.h).toBeCloseTo(verticalPlainNode!.bbox.h, 4);
  });

  it("does not push neighboring base glyphs when ruby is wider than its base", () => {
    const horizontalPlain = createElement(
      "Canvas",
      { width: 420, height: 220, background: "#101826" },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 38, color: "#f8fafc", wrap: "none", lineHeight: 1.45 },
        "東京都",
      ),
    );
    const horizontalRuby = createElement(
      "Canvas",
      { width: 420, height: 220, background: "#101826" },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 38, color: "#f8fafc", wrap: "none", lineHeight: 1.45 },
        "東",
        createElement(
          "Ruby",
          { rubyPosition: "over", rubyAlign: "start" },
          "京",
          createElement("Rt", { fontSizePx: 15, color: "#fca5a5" }, "きょう"),
        ),
        "都",
      ),
    );
    const verticalPlain = createElement(
      "Canvas",
      { width: 260, height: 520, background: "#101826" },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 30,
          color: "#fde68a",
          writingMode: "vertical-rl",
          wrap: "none",
          language: "ja",
          lineHeight: 1.4,
        },
        "古都案内",
      ),
    );
    const verticalRuby = createElement(
      "Canvas",
      { width: 260, height: 520, background: "#101826" },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 30,
          color: "#fde68a",
          writingMode: "vertical-rl",
          wrap: "none",
          language: "ja",
          lineHeight: 1.4,
        },
        "古",
        createElement(
          "Ruby",
          { rubyPosition: "under", rubyAlign: "start" },
          "都",
          createElement("Rt", { fontSizePx: 12, color: "#93c5fd" }, "みやこ"),
        ),
        "案内",
      ),
    );

    const horizontalPlainGlyphs =
      findTextNode(engine.renderToIR(horizontalPlain).root)?.lines?.flatMap(
        (line) => line.positionedGlyphs ?? [],
      ) ?? [];
    const horizontalRubyGlyphs =
      findTextNode(engine.renderToIR(horizontalRuby).root)?.lines?.flatMap(
        (line) => line.positionedGlyphs ?? [],
      ) ?? [];
    const verticalPlainGlyphs =
      findTextNode(engine.renderToIR(verticalPlain).root)?.lines?.flatMap(
        (line) => line.positionedGlyphs ?? [],
      ) ?? [];
    const verticalRubyGlyphs =
      findTextNode(engine.renderToIR(verticalRuby).root)?.lines?.flatMap(
        (line) => line.positionedGlyphs ?? [],
      ) ?? [];

    const horizontalPlainNext = horizontalPlainGlyphs.find((glyph) => glyph.text === "都");
    const horizontalRubyNext = horizontalRubyGlyphs.find((glyph) => glyph.text === "都");
    const verticalPlainNext = verticalPlainGlyphs.find((glyph) => glyph.text === "案");
    const verticalRubyNext = verticalRubyGlyphs.find((glyph) => glyph.text === "案");

    expect(horizontalRubyNext?.originX).toBeCloseTo(horizontalPlainNext?.originX ?? 0, 4);
    expect(verticalRubyNext?.originY).toBeCloseTo(verticalPlainNext?.originY ?? 0, 4);
  });

  it("keeps constrained vertical ruby samples wrapped across multiple columns", () => {
    const plain = createElement(
      "Canvas",
      { width: 260, height: 420, background: "#0f172a" },
      createElement(
        "Flex",
        {
          direction: "column",
          justifyContent: "start",
          alignItems: "start",
          width: 260,
          height: 420,
          padding: 20,
        },
        createElement(
          "Flex",
          {
            direction: "column",
            width: 208,
            height: 380,
            gap: 12,
            padding: 14,
            background: "#0f172a",
            borderRadius: 14,
          },
          createElement(
            "Text",
            { font: "NotoSansJP", fontSizePx: 13, color: "#64748b", wrap: "char" },
            "Vertical rubyPosition over / under with interactive font sizing.",
          ),
          createElement(
            "Flex",
            { direction: "row", width: 180, height: 334 },
            createElement(
              "Text",
              {
                font: "NotoSansJP",
                fontSizePx: 28,
                color: "#fde68a",
                writingMode: "vertical-rl",
                lineHeight: 1.35,
                wrap: "char",
                language: "ja",
                flexGrow: 1,
                preferredFrame: { h: 334 },
              },
              "古都散策では都案内を片手に巡ります。",
            ),
          ),
        ),
      ),
    );
    const ruby = createElement(
      "Canvas",
      { width: 260, height: 420, background: "#0f172a" },
      createElement(
        "Flex",
        {
          direction: "column",
          justifyContent: "start",
          alignItems: "start",
          width: 260,
          height: 420,
          padding: 20,
        },
        createElement(
          "Flex",
          {
            direction: "column",
            width: 208,
            height: 380,
            gap: 12,
            padding: 14,
            background: "#0f172a",
            borderRadius: 14,
          },
          createElement(
            "Text",
            { font: "NotoSansJP", fontSizePx: 13, color: "#64748b", wrap: "char" },
            "Vertical rubyPosition over / under with interactive font sizing.",
          ),
          createElement(
            "Flex",
            { direction: "row", width: 180, height: 334 },
            createElement(
              "Text",
              {
                font: "NotoSansJP",
                fontSizePx: 28,
                color: "#fde68a",
                writingMode: "vertical-rl",
                lineHeight: 1.35,
                wrap: "char",
                language: "ja",
                flexGrow: 1,
                preferredFrame: { h: 334 },
              },
              createElement(
                "Ruby",
                { rubyPosition: "over", rubyAlign: "space-around" },
                "古都散策",
                createElement(
                  "Rt",
                  { fontSizePx: 11, lineHeight: 1, color: "#fca5a5" },
                  "ことさんさく",
                ),
              ),
              "では",
              createElement(
                "Ruby",
                { rubyPosition: "under", rubyAlign: "space-between" },
                "都案内",
                createElement(
                  "Rt",
                  { fontSizePx: 11, lineHeight: 1, color: "#93c5fd" },
                  "みやこあんない",
                ),
              ),
              "を片手に巡ります。",
            ),
          ),
        ),
      ),
    );

    const plainNode = findTextNode(engine.renderToIR(plain).root);
    const rubyNode = findTextNode(engine.renderToIR(ruby).root);

    expect(plainNode?.lines?.length ?? 0).toBeGreaterThan(1);
    expect(rubyNode?.lines?.length ?? 0).toBeGreaterThan(1);
    expect(rubyNode!.bbox.w).toBeGreaterThanOrEqual(plainNode!.bbox.w);
  });

  it("keeps ASCII runs intact in constrained vertical ruby text under wrap=char", () => {
    const vnode = createElement(
      "Canvas",
      { width: 300, height: 300, background: "#0b1020" },
      createElement(
        "Flex",
        {
          direction: "row",
          width: 300,
          height: 300,
          padding: 18,
        },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 22,
            color: "#e2e8f0",
            writingMode: "vertical-rl",
            wrap: "char",
            language: "ja",
            lineHeight: 1.9,
            preferredFrame: { h: 264 },
            flexGrow: 1,
          },
          "導入ではJSXから",
          createElement(
            "Ruby",
            { rubyPosition: "under" },
            "再現性",
            createElement("Rt", { color: "#93c5fd", fontSizePx: 11 }, "さいげんせい"),
          ),
          "のあるSVG/PNGを生成します。",
        ),
      ),
    );

    const textNode = findTextNode(engine.renderToIR(vnode).root);
    expect(textNode?.lines?.length ?? 0).toBeGreaterThan(1);

    const lineTexts = (textNode?.lines ?? []).map((line) => line.text ?? "");
    expect(lineTexts.some((line) => line.includes("JSX"))).toBe(true);
    expect(lineTexts.some((line) => line.includes("PNG"))).toBe(true);
  });

  it("uses a smaller default font size for ruby annotations across both ruby positions", () => {
    const vnode = createElement(
      "Canvas",
      { width: 980, height: 420, background: "#131a24" },
      createElement(
        "Flex",
        { direction: "row", width: 980, height: 420, padding: 24, gap: 24 },
        createElement(
          "Flex",
          { direction: "column", flexGrow: 1, gap: 16 },
          createElement(
            "Text",
            {
              font: "NotoSansJP",
              fontSizePx: 38,
              color: "#f8fafc",
              wrap: "char",
              lineHeight: 1.45,
            },
            "東",
            createElement(
              "Ruby",
              { rubyPosition: "over" },
              "京",
              createElement("Rt", { color: "#fca5a5" }, "き"),
            ),
            "都と",
            createElement(
              "Ruby",
              { rubyPosition: "under" },
              "阪",
              createElement("Rt", { color: "#93c5fd" }, "は"),
            ),
            "の散歩",
          ),
        ),
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 30,
            color: "#fde68a",
            writingMode: "vertical-rl",
            lineHeight: 1.4,
            wrap: "char",
            language: "ja",
          },
          createElement(
            "Ruby",
            { rubyPosition: "over" },
            "都",
            createElement("Rt", { color: "#fca5a5" }, "み"),
          ),
          "案",
          createElement(
            "Ruby",
            { rubyPosition: "under" },
            "内",
            createElement("Rt", { color: "#93c5fd" }, "な"),
          ),
          "路",
        ),
      ),
    );

    const textNodes = findTextNodes(engine.renderToIR(vnode).root);
    const svg = engine.renderToSvg(vnode);
    const hasGlyphText = (node: IRNode, target: string): boolean =>
      (node.lines ?? []).some((line) =>
        (line.positionedGlyphs ?? []).some((glyph) => glyph.text === target),
      );
    const horizontalNode = textNodes.find(
      (node) =>
        hasGlyphText(node, "京") &&
        hasGlyphText(node, "き") &&
        hasGlyphText(node, "阪") &&
        hasGlyphText(node, "は"),
    );
    const verticalNode = textNodes.find(
      (node) =>
        hasGlyphText(node, "都") &&
        hasGlyphText(node, "み") &&
        hasGlyphText(node, "内") &&
        hasGlyphText(node, "な"),
    );
    const horizontalGlyphs =
      horizontalNode?.lines?.flatMap((line) => line.positionedGlyphs ?? []) ?? [];
    const verticalGlyphs =
      verticalNode?.lines?.flatMap((line) => line.positionedGlyphs ?? []) ?? [];

    const horizontalOverBase = horizontalGlyphs.find((glyph) => glyph.text === "京");
    const horizontalOverRt = horizontalGlyphs.find((glyph) => glyph.text === "き");
    const horizontalUnderBase = horizontalGlyphs.find((glyph) => glyph.text === "阪");
    const horizontalUnderRt = horizontalGlyphs.find((glyph) => glyph.text === "は");
    const verticalOverBase = verticalGlyphs.find((glyph) => glyph.text === "都");
    const verticalOverRt = verticalGlyphs.find((glyph) => glyph.text === "み");
    const verticalUnderBase = verticalGlyphs.find((glyph) => glyph.text === "内");
    const verticalUnderRt = verticalGlyphs.find((glyph) => glyph.text === "な");

    expect(horizontalOverBase?.fontSizePx).toBe(38);
    expect(horizontalUnderBase?.fontSizePx).toBe(38);
    expect(horizontalOverRt?.fontSizePx).toBe(19);
    expect(horizontalUnderRt?.fontSizePx).toBe(19);
    expect(verticalOverBase?.fontSizePx).toBe(30);
    expect(verticalUnderBase?.fontSizePx).toBe(30);
    expect(verticalOverRt?.fontSizePx).toBe(15);
    expect(verticalUnderRt?.fontSizePx).toBe(15);
    expect(horizontalOverRt?.fill).toBe("#fca5a5");
    expect(horizontalUnderRt?.fill).toBe("#93c5fd");
    expect(verticalOverRt?.fill).toBe("#fca5a5");
    expect(verticalUnderRt?.fill).toBe("#93c5fd");

    const horizontalOverDy = (horizontalOverRt?.originY ?? 0) - (horizontalOverBase?.originY ?? 0);
    const horizontalUnderDy =
      (horizontalUnderRt?.originY ?? 0) - (horizontalUnderBase?.originY ?? 0);
    expect(horizontalOverDy).toBeLessThan(-8);
    expect(horizontalUnderDy).toBeGreaterThan(8);

    const verticalOverDx = (verticalOverRt?.originX ?? 0) - (verticalOverBase?.originX ?? 0);
    const verticalUnderDx = (verticalUnderRt?.originX ?? 0) - (verticalUnderBase?.originX ?? 0);
    expect(Math.abs(verticalOverDx)).toBeGreaterThan(4);
    expect(Math.abs(verticalUnderDx)).toBeGreaterThan(4);
    expect(verticalOverDx * verticalUnderDx).toBeLessThan(0);

    expect(svg).toContain('fill="#fca5a5"');
    expect(svg).toContain('fill="#93c5fd"');
  });

  it("supports rubyAlign for multi-character ruby annotations", () => {
    const centered = createElement(
      "Canvas",
      { width: 420, height: 180, background: "#101826" },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 28, color: "#f8fafc", wrap: "none" },
        createElement(
          "Ruby",
          { rubyPosition: "over", rubyAlign: "center" },
          "東京都内",
          createElement("Rt", { fontSizePx: 10, color: "#fca5a5" }, "とう"),
        ),
      ),
    );
    const spaced = createElement(
      "Canvas",
      { width: 420, height: 180, background: "#101826" },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 28, color: "#f8fafc", wrap: "none" },
        createElement(
          "Ruby",
          { rubyPosition: "over", rubyAlign: "space-between" },
          "東京都内",
          createElement("Rt", { fontSizePx: 10, color: "#fca5a5" }, "とう"),
        ),
      ),
    );

    const centeredNode = findTextNode(engine.renderToIR(centered).root);
    const spacedNode = findTextNode(engine.renderToIR(spaced).root);
    const centeredGlyphs =
      centeredNode?.lines?.flatMap((line) => line.positionedGlyphs ?? []) ?? [];
    const spacedGlyphs = spacedNode?.lines?.flatMap((line) => line.positionedGlyphs ?? []) ?? [];

    const centeredRtFirst = centeredGlyphs.find((glyph) => glyph.text === "と");
    const centeredRtLast = centeredGlyphs.find((glyph) => glyph.text === "う");
    const spacedRtFirst = spacedGlyphs.find((glyph) => glyph.text === "と");
    const spacedRtLast = spacedGlyphs.find((glyph) => glyph.text === "う");

    const centeredDelta = (centeredRtLast?.originX ?? 0) - (centeredRtFirst?.originX ?? 0);
    const spacedDelta = (spacedRtLast?.originX ?? 0) - (spacedRtFirst?.originX ?? 0);

    expect(spacedDelta).toBeGreaterThan(centeredDelta + 10);
  });

  it("supports explicit Rt lineHeight when sizing ruby annotations", () => {
    const compact = createElement(
      "Canvas",
      { width: 320, height: 180, background: "#101826" },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 38, color: "#f8fafc", wrap: "none" },
        createElement(
          "Ruby",
          { rubyPosition: "over" },
          "京",
          createElement("Rt", { fontSizePx: 15, lineHeight: 1, color: "#fca5a5" }, "き"),
        ),
      ),
    );
    const loose = createElement(
      "Canvas",
      { width: 320, height: 220, background: "#101826" },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 38, color: "#f8fafc", wrap: "none" },
        createElement(
          "Ruby",
          { rubyPosition: "over" },
          "京",
          createElement("Rt", { fontSizePx: 15, lineHeight: 2, color: "#fca5a5" }, "き"),
        ),
      ),
    );

    const compactNode = findTextNode(engine.renderToIR(compact).root);
    const looseNode = findTextNode(engine.renderToIR(loose).root);

    expect(looseNode!.bbox.h).toBeGreaterThan(compactNode!.bbox.h + 10);
  });

  it.each([
    "horizontal-tb",
    "vertical-rl",
  ] as const)("renders multi-level Ruby inside InlineBox in %s writing", (writingMode) => {
    const vnode = createElement(
      "Canvas",
      writingMode === "vertical-rl"
        ? { width: 240, height: 480, background: "#ffffff" }
        : { width: 480, height: 220, background: "#ffffff" },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 32,
          color: "#111827",
          wrap: "none",
          writingMode,
        },
        "前",
        createElement(
          "InlineBox",
          { paddingInline: [8, 10], background: "#dcfce7" },
          "枠",
          createElement(
            "Ruby",
            { rubyPosition: "alternate", rubyAlign: "space-between" },
            createElement("Inline", { color: "#059669" }, "東京"),
            createElement(
              "Rt",
              { fontSizePx: 12 },
              createElement("Inline", { color: "#ef4444" }, "とう"),
            ),
            createElement("Rt", { fontSizePx: 10, color: "#2563eb" }, "EN"),
          ),
        ),
        "後",
      ),
    );

    const textNode = findTextNode(engine.renderToIR(vnode).root);
    const glyphs = textNode?.lines?.flatMap((line) => line.positionedGlyphs ?? []) ?? [];
    const baseText = glyphs
      .filter((glyph) => glyph.sourceRole === "rubyBase")
      .map((glyph) => glyph.text)
      .join("");
    const firstAnnotation = glyphs
      .filter((glyph) => glyph.sourceRole === "rubyAnnotation" && glyph.fill === "#ef4444")
      .map((glyph) => glyph.text)
      .join("");
    const secondAnnotation = glyphs
      .filter((glyph) => glyph.sourceRole === "rubyAnnotation" && glyph.fill === "#2563eb")
      .map((glyph) => glyph.text)
      .join("");

    expect(textNode?.lines?.map((line) => line.text)).toEqual(["前枠東京後"]);
    expect(baseText).toBe("東京");
    expect(
      glyphs
        .filter((glyph) => glyph.sourceRole === "rubyBase")
        .every((glyph) => glyph.fill === "#059669"),
    ).toBe(true);
    expect(firstAnnotation).toBe("とう");
    expect(secondAnnotation).toBe("EN");
  });

  it("rejects invalid InlineBox structure before actual-WASM layout", () => {
    const invalidChild = createElement(
      "Canvas",
      { width: 320, height: 160 },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 24 },
        // @ts-expect-error intentional invalid runtime validation case
        createElement("InlineBox", {}, createElement("Box", { width: 20, height: 20 })),
      ),
    );
    const unsupportedProp = createElement(
      "Canvas",
      { width: 320, height: 160 },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 24 },
        // @ts-expect-error intentional invalid runtime validation case
        createElement("InlineBox", { textCombineUpright: "all" }, "本文"),
      ),
    );

    expect(() => engine.renderToIR(invalidChild)).toThrow(
      "InlineBox children must be strings, Inline, InlineBox, InlineRect, or Ruby only",
    );
    expect(() => engine.renderToIR(unsupportedProp)).toThrow(
      'InlineBox does not support prop "textCombineUpright"',
    );
  });

  it("respects explicit ruby annotation font sizes", () => {
    const vnode = createElement(
      "Canvas",
      { width: 920, height: 420, background: "#131a24" },
      createElement(
        "Flex",
        { direction: "row", width: 920, height: 420, padding: 24, gap: 24 },
        createElement(
          "Flex",
          { direction: "column", flexGrow: 1, gap: 16 },
          createElement(
            "Text",
            { font: "NotoSansJP", fontSizePx: 38, color: "#f8fafc", wrap: "char" },
            "東",
            createElement(
              "Ruby",
              { rubyPosition: "over" },
              "京",
              createElement("Rt", { fontSizePx: 15, color: "#fca5a5" }, "きょう"),
            ),
            "都の散歩",
          ),
        ),
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 30,
            color: "#fde68a",
            writingMode: "vertical-rl",
            lineHeight: 1.4,
            wrap: "char",
            language: "ja",
          },
          "古",
          createElement(
            "Ruby",
            { rubyPosition: "under" },
            "都",
            createElement("Rt", { fontSizePx: 12, color: "#93c5fd" }, "みやこ"),
          ),
          "案内",
        ),
      ),
    );

    const textNodes = findTextNodes(engine.renderToIR(vnode).root);
    const hasGlyphText = (node: IRNode, target: string): boolean =>
      (node.lines ?? []).some((line) =>
        (line.positionedGlyphs ?? []).some((glyph) => glyph.text === target),
      );
    const horizontalNode = textNodes.find(
      (node) => hasGlyphText(node, "京") && hasGlyphText(node, "き") && hasGlyphText(node, "東"),
    );
    const verticalNode = textNodes.find(
      (node) => hasGlyphText(node, "都") && hasGlyphText(node, "み") && hasGlyphText(node, "古"),
    );
    const horizontalGlyphs =
      horizontalNode?.lines?.flatMap((line) => line.positionedGlyphs ?? []) ?? [];
    const verticalGlyphs =
      verticalNode?.lines?.flatMap((line) => line.positionedGlyphs ?? []) ?? [];

    expect(horizontalGlyphs.find((glyph) => glyph.text === "き")?.fontSizePx).toBe(15);
    expect(verticalGlyphs.find((glyph) => glyph.text === "み")?.fontSizePx).toBe(12);
  });

  it("keeps multi-character ruby tokens intact when wrapping horizontally and vertically", () => {
    const horizontal = createElement(
      "Canvas",
      { width: 380, height: 240, background: "#131a24" },
      createElement(
        "Flex",
        {
          direction: "column",
          justifyContent: "start",
          alignItems: "start",
          width: 380,
          height: 240,
          padding: 20,
        },
        createElement(
          "Flex",
          {
            direction: "column",
            width: 340,
            gap: 8,
            padding: 14,
            background: "#0f172a",
            borderRadius: 14,
          },
          createElement(
            "Text",
            { font: "NotoSansJP", fontSizePx: 13, color: "#64748b", wrap: "char" },
            "Multi-character ruby in horizontal text.",
          ),
          createElement(
            "Flex",
            { direction: "row", width: 312 },
            createElement(
              "Text",
              {
                font: "NotoSansJP",
                fontSizePx: 24,
                color: "#dbeafe",
                wrap: "char",
                lineHeight: 1.55,
                flexGrow: 1,
              },
              "週末は",
              createElement(
                "Ruby",
                { rubyPosition: "over" },
                "東京都内",
                createElement("Rt", { fontSizePx: 10, color: "#fca5a5" }, "とうきょうとない"),
              ),
              "の案内を巡ります。",
            ),
          ),
        ),
      ),
    );

    const vertical = createElement(
      "Canvas",
      { width: 260, height: 420, background: "#0f172a" },
      createElement(
        "Flex",
        {
          direction: "column",
          justifyContent: "start",
          alignItems: "start",
          width: 260,
          height: 420,
          padding: 20,
        },
        createElement(
          "Flex",
          {
            direction: "column",
            width: 208,
            height: 380,
            gap: 12,
            padding: 14,
            background: "#0f172a",
            borderRadius: 14,
          },
          createElement(
            "Text",
            { font: "NotoSansJP", fontSizePx: 13, color: "#64748b", wrap: "char" },
            "Constrained height: multi-character vertical ruby wraps into multiple columns.",
          ),
          createElement(
            "Flex",
            { direction: "row", width: 180, height: 334 },
            createElement(
              "Text",
              {
                font: "NotoSansJP",
                fontSizePx: 28,
                color: "#fde68a",
                writingMode: "vertical-rl",
                wrap: "char",
                lineHeight: 1.35,
                language: "ja",
                flexGrow: 1,
                preferredFrame: { h: 334 },
              },
              "古都散策では",
              createElement(
                "Ruby",
                { rubyPosition: "under" },
                "都案内",
                createElement("Rt", { fontSizePx: 11, color: "#93c5fd" }, "みやこあんない"),
              ),
              "を片手に巡ります。",
            ),
          ),
        ),
      ),
    );

    const horizontalNodes = findTextNodes(engine.renderToIR(horizontal).root);
    const verticalNodes = findTextNodes(engine.renderToIR(vertical).root);
    const hasGlyphText = (node: IRNode, target: string): boolean =>
      (node.lines ?? []).some((line) =>
        (line.positionedGlyphs ?? []).some((glyph) => glyph.text === target),
      );

    const horizontalNode = horizontalNodes.find(
      (node) =>
        hasGlyphText(node, "東") &&
        hasGlyphText(node, "京") &&
        hasGlyphText(node, "都") &&
        hasGlyphText(node, "内") &&
        hasGlyphText(node, "週"),
    );
    const verticalNode = verticalNodes.find(
      (node) =>
        hasGlyphText(node, "都") &&
        hasGlyphText(node, "案") &&
        hasGlyphText(node, "内") &&
        hasGlyphText(node, "古"),
    );

    expect(verticalNode?.lines?.length ?? 0).toBeGreaterThan(1);

    const horizontalRubyIndexes = collectLineIndexesForGlyphTexts(horizontalNode ?? null, [
      "東",
      "京",
      "都",
      "内",
    ]);
    const verticalRubyIndexes = collectLineIndexesForGlyphTexts(verticalNode ?? null, [
      "都",
      "案",
      "内",
    ]);

    const horizontalLines = new Set([...horizontalRubyIndexes.values()].flat());
    const verticalLines = new Set([...verticalRubyIndexes.values()].flat());

    expect(horizontalLines.size).toBe(1);
    expect(verticalLines.size).toBe(1);
  });

  it("uses proportional advances for rotated halfwidth ASCII and hyphen in vertical text", () => {
    const text = "ABC123-";
    const horizontal = createElement(
      "Canvas",
      { width: 720, height: 120 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 48,
          color: "#f8fafc",
          wrap: "none",
        },
        text,
      ),
    );
    const vertical = createElement(
      "Canvas",
      { width: 160, height: 720 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 48,
          color: "#f8fafc",
          writingMode: "vertical-rl",
          wrap: "none",
        },
        text,
      ),
    );

    const horizontalText = findTextNode(engine.renderToIR(horizontal).root);
    const verticalText = findTextNode(engine.renderToIR(vertical).root);
    const horizontalAdvances =
      horizontalText?.lines?.flatMap((line) =>
        (line.positionedGlyphs ?? []).map((glyph) => glyph.xAdvance),
      ) ?? [];
    const verticalAdvances =
      verticalText?.lines?.flatMap((line) =>
        (line.positionedGlyphs ?? [])
          .filter((glyph) => glyph.rotationDeg === 90)
          .map((glyph) => Math.abs(glyph.yAdvance)),
      ) ?? [];

    expect(verticalAdvances).toHaveLength(horizontalAdvances.length);
    verticalAdvances.forEach((advance, index) => {
      expect(Math.abs(advance - horizontalAdvances[index]!)).toBeLessThan(0.1);
    });
  });

  it("keeps a visible gap between rotated halfwidth glyphs and following upright CJK", () => {
    const vnode = createElement(
      "Canvas",
      { width: 900, height: 480, background: "#1a1a1a" },
      createElement(
        "Flex",
        {
          direction: "row",
          justifyContent: "center",
          alignItems: "center",
          width: 900,
          height: 480,
          padding: 20,
        },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 36,
            color: "#f8fafc",
            writingMode: "vertical-rl",
            wrap: "char",
            language: "ja",
            lineHeight: 1.5,
          },
          "縦書きでABCと123の位置を確認。句読点（。、）も正しく配置される。",
        ),
      ),
    );

    const outlines = engine.renderToTextOutlines(vnode, { textPathMode: "glyphs" });
    const paths = outlines[0]?.paths ?? [];
    const pairs = [
      { from: "で", to: "A" },
      { from: "C", to: "と" },
      { from: "と", to: "1" },
      { from: "3", to: "の" },
    ];

    for (const { from, to } of pairs) {
      const fromPath = paths.find((path) => path.text === from);
      const toPath = paths.find((path) => path.text === to);

      expect(fromPath, `${from}->${to}`).toBeDefined();
      expect(toPath, `${from}->${to}`).toBeDefined();
      expect(
        toPath!.bbox.y - (fromPath!.bbox.y + fromPath!.bbox.h),
        `${from}->${to}`,
      ).toBeGreaterThan(0.1);
    }

    const aIndex = paths.findIndex((path) => path.text === "A");
    const columnAnchorIndex = paths.findIndex(
      (path, index) => path.text === "と" && index > aIndex,
    );
    expect(aIndex).toBeGreaterThanOrEqual(0);
    expect(columnAnchorIndex).toBeGreaterThanOrEqual(0);

    const columnCenter = bboxCenterX(paths[columnAnchorIndex]!.bbox);
    for (const label of ["A", "B", "C", "1", "2", "3"]) {
      const glyphPath = paths.find((path) => path.text === label);
      expect(glyphPath, label).toBeDefined();
      expect(Math.abs(bboxCenterX(glyphPath!.bbox) - columnCenter), label).toBeLessThan(2.5);
    }
  });

  it("keeps a visible gap before upright vertical dash-like glyphs", () => {
    const cases = ["と—", "とー"];

    for (const text of cases) {
      const vnode = createElement(
        "Canvas",
        { width: 200, height: 200 },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 48,
            color: "#f8fafc",
            writingMode: "vertical-rl",
            wrap: "none",
            language: "ja",
          },
          text,
        ),
      );

      const outlines = engine.renderToTextOutlines(vnode, { textPathMode: "glyphs" });
      const paths = outlines[0]?.paths ?? [];

      expect(paths, text).toHaveLength(2);
      expect(paths[1]!.bbox.y - (paths[0]!.bbox.y + paths[0]!.bbox.h), text).toBeGreaterThan(0.1);
    }
  });

  it("keeps a visible gap around multi-cell vertical em dash ligatures", () => {
    const vnode = createElement(
      "Canvas",
      { width: 220, height: 260 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 36,
          color: "#f8fafc",
          writingMode: "vertical-rl",
          wrap: "none",
          language: "ja",
          lineHeight: 1.5,
        },
        "と——な",
      ),
    );

    const paths = engine.renderToTextOutlines(vnode, { textPathMode: "glyphs" })[0]?.paths ?? [];

    expect(paths).toHaveLength(3);
    expect(paths[1]!.text).toBe("——");
    expect(paths[1]!.bbox.h).toBeGreaterThan(paths[1]!.bbox.w * 8);
    expect(paths[1]!.bbox.y - (paths[0]!.bbox.y + paths[0]!.bbox.h)).toBeGreaterThan(0.1);
    expect(paths[2]!.bbox.y - (paths[1]!.bbox.y + paths[1]!.bbox.h)).toBeGreaterThan(0.1);
  });

  it("keeps Japanese ellipsis leaders upright in vertical text", () => {
    const vnode = createElement(
      "Canvas",
      { width: 220, height: 260 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 36,
          color: "#f8fafc",
          writingMode: "vertical-rl",
          wrap: "none",
          language: "ja",
        },
        "号……も",
      ),
    );

    const paths = engine.renderToTextOutlines(vnode, { textPathMode: "glyphs" })[0]?.paths ?? [];
    const leaders = paths.filter((path) => path.text === "…");

    expect(leaders).toHaveLength(2);
    for (const leader of leaders) {
      expect(leader.bbox.h).toBeGreaterThan(leader.bbox.w * 3);
    }
  });

  it("keeps a visible gap between rotated tilde and following upright CJK", () => {
    const vnode = createElement(
      "Canvas",
      { width: 220, height: 260 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 42,
          color: "#f8fafc",
          writingMode: "vertical-rl",
          wrap: "none",
          language: "ja",
        },
        "~の",
      ),
    );

    const textNode = findTextNode(engine.renderToIR(vnode).root);
    const paths = engine.renderToTextOutlines(vnode, { textPathMode: "glyphs" })[0]?.paths ?? [];

    expect(textNode?.lines).toHaveLength(1);
    expect(paths).toHaveLength(2);
    expect(paths[0]!.text).toBe("~");
    expect(paths[1]!.text).toBe("の");
    expect(paths[1]!.bbox.y - (paths[0]!.bbox.y + paths[0]!.bbox.h)).toBeGreaterThan(0.1);
  });

  it("keeps sideways punctuation on their native upper/lower side within the column", () => {
    const vnode = createElement(
      "Canvas",
      { width: 220, height: 320 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 42,
          color: "#f8fafc",
          writingMode: "vertical-rl",
          wrap: "none",
          language: "ja",
        },
        'A,."',
      ),
    );

    const paths = engine.renderToTextOutlines(vnode, { textPathMode: "glyphs" })[0]?.paths ?? [];

    expect(paths).toHaveLength(4);
    expect(paths.map((path) => path.text)).toEqual(["A", ",", ".", '"']);

    const anchorX = bboxCenterX(paths[0]!.bbox);
    const commaX = bboxCenterX(paths[1]!.bbox);
    const periodX = bboxCenterX(paths[2]!.bbox);
    const quoteX = bboxCenterX(paths[3]!.bbox);

    expect(Math.abs(commaX - anchorX)).toBeGreaterThan(2);
    expect(Math.abs(periodX - anchorX)).toBeGreaterThan(2);
    expect(Math.abs(quoteX - anchorX)).toBeGreaterThan(2);
    expect(commaX).toBeLessThan(anchorX);
    expect(periodX).toBeLessThan(anchorX);
    expect(quoteX).toBeGreaterThan(anchorX);
  });

  it("keeps multi-cell vertical dash ligatures and ASCII punctuation separated in template text", () => {
    const text =
      "縦書きサンプル。句読点（。、い）とABC・123,.!?~の位置確認。半角ダッシュ——や括弧「あ」も検証。全角ーも正しい位置に配置されることを確認。";
    const vnode = createElement(
      "Canvas",
      { width: 640, height: 420, background: "#0b1020" },
      createElement(
        "Flex",
        {
          direction: "row",
          justifyContent: "center",
          alignItems: "center",
          width: 640,
          height: 420,
          padding: 20,
          overflow: "clip",
        },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 42,
            color: "#fef3c7",
            writingMode: "vertical-rl",
            lineHeight: 1.3,
            wrap: "char",
            fit: "shrink",
            language: "ja",
            hangingPunctuation: true,
          },
          text,
        ),
      ),
    );

    const textNode = findTextNode(engine.renderToIR(vnode).root);
    const paths = engine.renderToTextOutlines(vnode, { textPathMode: "glyphs" })[0]?.paths ?? [];
    const dashPair = paths.find((path) => path.text === "——");
    const beforeDash = paths.find((path) => path.text === "ュ");
    const afterDash = paths.find((path) => path.text === "や");

    expect(textNode).toBeDefined();
    expect(beforeDash).toBeDefined();
    expect(dashPair).toBeDefined();
    expect(afterDash).toBeDefined();
    expect(dashPair!.bbox.h).toBeGreaterThan(dashPair!.bbox.w * 8);
    expect(dashPair!.bbox.y - (beforeDash!.bbox.y + beforeDash!.bbox.h)).toBeGreaterThan(0.1);
    expect(afterDash!.bbox.y - (dashPair!.bbox.y + dashPair!.bbox.h)).toBeGreaterThan(0.1);

    const punctuationPairs = [
      ["3", ","],
      [",", "."],
      [".", "!"],
      ["!", "?"],
      ["?", "~"],
    ] as const;

    for (const [from, to] of punctuationPairs) {
      const fromPath = paths.find((path) => path.text === from);
      const toPath = paths.find((path) => path.text === to);

      expect(fromPath, `${from}->${to}`).toBeDefined();
      expect(toPath, `${from}->${to}`).toBeDefined();
      expect(
        toPath!.bbox.y - (fromPath!.bbox.y + fromPath!.bbox.h),
        `${from}->${to}`,
      ).toBeGreaterThan(0.1);
    }

    const tildeIndex = paths.findIndex((path) => path.text === "~");
    const nextNo =
      tildeIndex >= 0 ? paths.slice(tildeIndex + 1).find((path) => path.text === "の") : null;
    expect(tildeIndex).toBeGreaterThanOrEqual(0);
    expect(nextNo, "~->の").toBeDefined();
    const tildeCenterX = bboxCenterX(paths[tildeIndex]!.bbox);
    const nextNoCenterX = bboxCenterX(nextNo!.bbox);
    if (Math.abs(tildeCenterX - nextNoCenterX) < 4) {
      expect(
        paths[tildeIndex]!.bbox.y + paths[tildeIndex]!.bbox.h,
        "~->の leading edge",
      ).toBeLessThan(nextNo!.bbox.y - 0.1);
    } else {
      expect(nextNoCenterX, "~->の next column").toBeLessThan(tildeCenterX - 1);
    }

    const minY = Math.min(...paths.map((path) => path.bbox.y));
    expect(minY - textNode!.bbox.y).toBeGreaterThanOrEqual(-1);
    expect(minY - textNode!.bbox.y).toBeLessThan(4);

    const aIndex = paths.findIndex((path) => path.text === "A");
    const anchorIndex = paths.findIndex((path, index) => path.text === "・" && index > aIndex);
    expect(aIndex).toBeGreaterThanOrEqual(0);
    expect(anchorIndex).toBeGreaterThanOrEqual(0);

    const columnCenter = bboxCenterX(paths[anchorIndex]!.bbox);
    for (const label of ["A", "B", "C", "1", "2", "3"]) {
      const glyphPath = paths.find((path) => path.text === label);
      expect(glyphPath, `template ${label}`).toBeDefined();
      expect(
        Math.abs(bboxCenterX(glyphPath!.bbox) - columnCenter),
        `template ${label}`,
      ).toBeLessThan(2.5);
    }
  });

  it("renders text inside embedded SVG image into PNG", () => {
    const withoutLabel = createElement(
      "Canvas",
      { width: 320, height: 240, background: "#0f172a" },
      createElement("Image", {
        src: makeEmbeddedSvgImageDataUrl(false),
        width: 240,
        height: 180,
        objectFit: "cover",
      }),
    );
    const withLabel = createElement(
      "Canvas",
      { width: 320, height: 240, background: "#0f172a" },
      createElement("Image", {
        src: makeEmbeddedSvgImageDataUrl(true),
        width: 240,
        height: 180,
        objectFit: "cover",
      }),
    );

    const pngWithoutLabel = engine.renderToPng(withoutLabel);
    const pngWithLabel = engine.renderToPng(withLabel);
    expect(pngBytesEqual(pngWithoutLabel, pngWithLabel)).toBe(false);
  });

  it("hitTest works on rendered IR", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement(
        "Text",
        {
          id: "clickable-text",
          font: "NotoSansJP",
          fontSizePx: 20,
        },
        "Click me",
      ),
    );

    const ir = engine.renderToIR(vnode);
    // Text node should be at approximately (0,0) and have some size
    const hit = engine.hitTest(ir, 5, 5);
    expect(hit).toBe("clickable-text");
  });

  it("handles overflow=clip with clipPath in SVG", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 300 },
      createElement("Box", {
        id: "clipped-box",
        width: 200,
        height: 100,
        overflow: "clip",
        background: "#ff0000",
      }),
    );

    const svg = engine.renderToSvg(vnode);
    expect(svg).toContain("<clipPath");
    expect(svg).toContain("clip-path=");
  });

  it("renders E2E: Canvas + Flex + Text(Japanese, shrink) → SVG", () => {
    const vnode = createElement(
      "Canvas",
      { width: 1280, height: 720 },
      createElement(
        "Flex",
        { direction: "column", gap: 10 },
        createElement(
          "Text",
          {
            id: "title",
            font: "NotoSansJP",
            fontSizePx: 48,
            color: "#ffffff",
            fit: "shrink",
            wrap: "char",
          },
          "テロップテキスト: 自動縮小テスト",
        ),
        createElement(
          "Text",
          {
            id: "subtitle",
            font: "NotoSansJP",
            fontSizePx: 24,
            color: "#cccccc",
          },
          "サブタイトル",
        ),
      ),
    );

    const svg = engine.renderToSvg(vnode);
    expect(svg).toContain("<svg");
    expect(svg).toContain("テロップテキスト");
    expect(svg).toContain("サブタイトル");
    expect(svg).toContain("</svg>");

    // SVG should be valid XML (basic check)
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});
