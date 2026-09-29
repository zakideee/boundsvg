import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import type { IRNode, IRTextNode } from "../../src/ir/types.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { TextProps } from "../../src/vnode/types.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "./test-prerequisites.js";

function findTextNode(node: IRNode): IRTextNode {
  if (node.type === "text") {
    return node;
  }
  if (node.type === "group") {
    for (const child of node.children) {
      if (child.type === "text" || child.type === "group") {
        try {
          return findTextNode(child);
        } catch {}
      }
    }
  }
  throw new Error("Text node not found in test IR");
}

function findNodeById(node: IRNode, nodeId: string): IRNode | undefined {
  if (node.nodeId === nodeId) {
    return node;
  }
  if (node.type === "group") {
    for (const child of node.children) {
      const found = findNodeById(child, nodeId);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

describe("rich text alignment", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
  });

  it.each([
    "center",
    "end",
  ] as const)("aligns shrink glyphs to the final 600px box: %s", (textAlign) => {
    const scene = createElement(
      "Canvas",
      { width: 600, height: 120 },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 32, width: 600, fit: "shrink", textAlign },
        "Hello",
      ),
    );
    const layoutNode = engine.renderToLayoutTree(scene).root.children[0];
    const localLine = layoutNode?.textLayout?.resolvedTextLayout.lines[0];
    const localOrigin = localLine?.positionedGlyphs?.[0]?.originX;
    const { ir, svg } = engine.renderToSvgAndIR(scene);
    const paintedLine = findTextNode(ir.root).lines[0];
    const paintedOrigin = paintedLine?.positionedGlyphs?.[0]?.originX;
    expect(localLine).toBeDefined();
    expect(localOrigin).toBeDefined();
    expect(paintedOrigin).toBeDefined();
    const available = 600 - (localLine?.width ?? 0);
    const expectedOffset = textAlign === "center" ? available / 2 : available;
    expect((paintedOrigin ?? 0) - (localOrigin ?? 0)).toBeCloseTo(expectedOffset, 5);
    expect(svg).toBe(engine.renderToSvg(scene));
  });

  it("aligns wrapped Inline lines independently", () => {
    const scene = createElement(
      "Canvas",
      { width: 80, height: 180 },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 32, width: 80, textAlign: "center" },
        createElement("Inline", { color: "#e22" }, "Hello World"),
      ),
    );
    const layoutNode = engine.renderToLayoutTree(scene).root.children[0];
    const localLines = layoutNode?.textLayout?.resolvedTextLayout.lines ?? [];
    const paintedLines = findTextNode(engine.renderToSvgAndIR(scene).ir.root).lines;
    expect(localLines.length).toBeGreaterThan(1);
    for (const [index, line] of localLines.entries()) {
      const localOrigin = line.positionedGlyphs?.[0]?.originX ?? 0;
      const paintedOrigin = paintedLines[index]?.positionedGlyphs?.[0]?.originX ?? 0;
      expect(paintedOrigin - localOrigin).toBeCloseTo((80 - line.width) / 2, 5);
    }
    expect(new Set(localLines.map((line) => line.width)).size).toBeGreaterThan(1);
  });

  it.each(["center", "end"] as const)("aligns Inline and Ruby glyphs: %s", (textAlign) => {
    for (const children of [
      [createElement("Inline", { color: "#e22" }, "Hello")],
      [createElement("Ruby", {}, "京", createElement("Rt", {}, "きょう"))],
    ]) {
      const scene = createElement(
        "Canvas",
        { width: 600, height: 120 },
        createElement(
          "Text",
          { font: "NotoSansJP", fontSizePx: 32, width: 600, textAlign },
          ...children,
        ),
      );
      const layoutNode = engine.renderToLayoutTree(scene).root.children[0];
      const localLine = layoutNode?.textLayout?.resolvedTextLayout.lines[0];
      const paintedText = findTextNode(engine.renderToSvgAndIR(scene).ir.root);
      const paintedLine = paintedText.lines[0];
      const localOrigin = localLine?.positionedGlyphs?.[0]?.originX ?? 0;
      const paintedOrigin = paintedLine?.positionedGlyphs?.[0]?.originX ?? 0;
      const available = 600 - (localLine?.width ?? 0);
      expect(paintedOrigin - localOrigin).toBeCloseTo(
        textAlign === "center" ? available / 2 : available,
        5,
      );
    }
  });

  it.each(["start", "center", "end"] as const)("anchors vertical rich columns: %s", (textAlign) => {
    const scene = createElement(
      "Canvas",
      { width: 120, height: 240 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 32,
          width: 120,
          height: 240,
          writingMode: "vertical-rl",
          textAlign,
        },
        createElement("Inline", { color: "#e22" }, "東京"),
      ),
    );
    const layoutNode = engine.renderToLayoutTree(scene).root.children[0];
    const local = layoutNode?.textLayout?.resolvedTextLayout;
    const localLine = local?.lines[0];
    const paintedLine = findTextNode(engine.renderToSvgAndIR(scene).ir.root).lines[0];
    const localGlyph = localLine?.positionedGlyphs?.[0];
    const paintedGlyph = paintedLine?.positionedGlyphs?.[0];
    expect(localGlyph).toBeDefined();
    expect(paintedGlyph).toBeDefined();
    expect((paintedGlyph?.originX ?? 0) - (localGlyph?.originX ?? 0)).toBeCloseTo(
      120 - (local?.bbox.w ?? 0),
      5,
    );
    const available = 240 - (localLine?.width ?? 0);
    const expectedY = textAlign === "center" ? available / 2 : textAlign === "end" ? available : 0;
    expect((paintedGlyph?.originY ?? 0) - (localGlyph?.originY ?? 0)).toBeCloseTo(expectedY, 5);
  });

  it("aligns each vertical rich column and its rectangles", () => {
    const scene = createElement(
      "Canvas",
      { width: 180, height: 130 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 32,
          width: 180,
          height: 110,
          writingMode: "vertical-rl",
          textAlign: "center",
        },
        createElement("Inline", { color: "#e22" }, "東京"),
        createElement("InlineRect", { inlineSizePx: 10, blockSizePx: 8, color: "#238" }),
        createElement("Inline", { color: "#e22" }, "大阪京都奈良"),
        createElement("InlineRect", { inlineSizePx: 10, blockSizePx: 8, color: "#238" }),
        createElement("Inline", { color: "#e22" }, "横浜"),
      ),
    );
    const local = engine.renderToLayoutTree(scene).root.children[0]?.textLayout?.resolvedTextLayout;
    const { ir } = engine.renderToSvgAndIR(scene);
    const painted = findTextNode(ir.root);
    const lines = local?.lines ?? [];
    const rectangles = local?.inlineRects ?? [];
    expect(lines).toHaveLength(4);
    expect(new Set(lines.map((line) => line.width)).size).toBeGreaterThan(1);
    expect(rectangles).toHaveLength(2);
    const crossOffset = painted.layoutBox.w - (local?.bbox.w ?? 0);
    lines.forEach((line, index) => {
      const expectedY = (painted.layoutBox.h - line.width) / 2;
      const localGlyphs = line.positionedGlyphs ?? [];
      const paintedGlyphs = painted.lines[index]?.positionedGlyphs ?? [];
      expect(localGlyphs.length).toBeGreaterThan(0);
      expect(paintedGlyphs).toHaveLength(localGlyphs.length);
      localGlyphs.forEach((glyph, glyphIndex) => {
        const paintedGlyph = paintedGlyphs[glyphIndex];
        expect((paintedGlyph?.originX ?? 0) - glyph.originX).toBeCloseTo(crossOffset, 5);
        expect((paintedGlyph?.originY ?? 0) - glyph.originY).toBeCloseTo(expectedY, 5);
      });
    });
    [0, 2].forEach((lineIndex, rectIndex) => {
      const rectangle = rectangles[rectIndex];
      const paintedRectangle = findNodeById(ir.root, rectangle?.fragmentId ?? "");
      const line = lines[lineIndex];
      expect(rectangle).toBeDefined();
      expect(line).toBeDefined();
      expect(paintedRectangle).toBeDefined();
      expect((rectangle?.x ?? 0) - (line?.positionedGlyphs?.[0]?.originX ?? 0)).toBeCloseTo(
        -(rectangle?.width ?? 0) / 2,
        5,
      );
      expect(
        (paintedRectangle?.bbox.x ?? 0) - (rectangle?.x ?? 0) - painted.layoutBox.x,
      ).toBeCloseTo(crossOffset, 5);
      expect(
        (paintedRectangle?.bbox.y ?? 0) - (rectangle?.y ?? 0) - painted.layoutBox.y,
      ).toBeCloseTo((painted.layoutBox.h - (line?.width ?? 0)) / 2, 5);
    });
  });

  it.each([
    "center",
    "end",
  ] as const)("clamps vertical rich overflow alignment: %s", (textAlign) => {
    const scene = createElement(
      "Canvas",
      { width: 100, height: 40 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 32,
          width: 100,
          height: 20,
          writingMode: "vertical-rl",
          textAlign,
        },
        createElement("Inline", { color: "#e22" }, "東"),
      ),
    );
    const localLine =
      engine.renderToLayoutTree(scene).root.children[0]?.textLayout?.resolvedTextLayout.lines[0];
    const painted = findTextNode(engine.renderToSvgAndIR(scene).ir.root);
    expect(localLine?.width).toBeGreaterThan(painted.layoutBox.h);
    expect(painted.lines[0]?.positionedGlyphs?.[0]?.originY).toBe(
      localLine?.positionedGlyphs?.[0]?.originY,
    );
  });

  it("uses the actual rich result for fit, text indent, ellipsis, and overflow", () => {
    const cases: Array<{
      name: string;
      props: Partial<TextProps>;
      content: string;
      rich?: boolean;
    }> = [
      { name: "grow", props: { fit: "grow", maxFontSizePx: 40 }, content: "Hi" },
      { name: "text indent", props: { textIndent: 20 }, content: "Hello" },
      {
        name: "ellipsis overflow",
        props: { width: 80, maxLines: 1, ellipsis: true },
        content: "Hello World and more",
      },
      {
        name: "unclamped overflow",
        props: { width: 60, wrap: "none" },
        content: "Hello World",
        rich: true,
      },
    ];
    for (const scenario of cases) {
      const scene = createElement(
        "Canvas",
        { width: 600, height: 120 },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 32,
            width: 600,
            textAlign: "center",
            ...scenario.props,
          },
          scenario.rich
            ? createElement("Inline", { color: "#e22" }, scenario.content)
            : scenario.content,
        ),
      );
      const layoutNode = engine.renderToLayoutTree(scene).root.children[0];
      const localLine = layoutNode?.textLayout?.resolvedTextLayout.lines[0];
      const paintedText = findTextNode(engine.renderToSvgAndIR(scene).ir.root);
      const paintedLine = paintedText.lines[0];
      const localOrigin = localLine?.positionedGlyphs?.[0]?.originX;
      const paintedOrigin = paintedLine?.positionedGlyphs?.[0]?.originX;
      expect(localOrigin, scenario.name).toBeDefined();
      expect(paintedOrigin, scenario.name).toBeDefined();
      expect((paintedOrigin ?? 0) - (localOrigin ?? 0), scenario.name).toBeCloseTo(
        (paintedText.layoutBox.w - (localLine?.width ?? 0)) / 2,
        5,
      );
    }
  });

  it("keeps a fitting ellipsis on the plain coordinate path", () => {
    const scene = createElement(
      "Canvas",
      { width: 600, height: 120 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 32,
          width: 600,
          textAlign: "center",
          maxLines: 1,
          ellipsis: true,
        },
        "Hi",
      ),
    );
    const localLine =
      engine.renderToLayoutTree(scene).root.children[0]?.textLayout?.resolvedTextLayout.lines[0];
    const paintedLine = findTextNode(engine.renderToSvgAndIR(scene).ir.root).lines[0];
    expect(paintedLine?.positionedGlyphs?.[0]?.originX).toBe(
      localLine?.positionedGlyphs?.[0]?.originX,
    );
    expect(paintedLine?.text).toBe("Hi");
  });

  it("moves a large InlineRect with its rich line in a preferred frame", () => {
    const scene = createElement(
      "Canvas",
      { width: 600, height: 120 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 32,
          width: 600,
          height: 100,
          preferredFrame: { w: 600, h: 100 },
          textAlign: "center",
        },
        "A",
        createElement("InlineRect", { inlineSizePx: 220, color: "#e22" }),
        "B",
      ),
    );
    const local = engine.renderToLayoutTree(scene).root.children[0]?.textLayout?.resolvedTextLayout;
    const { ir } = engine.renderToSvgAndIR(scene);
    const text = findTextNode(ir.root);
    const firstLine = local?.lines[0];
    const expectedOffset = (text.layoutBox.w - (firstLine?.width ?? 0)) / 2;
    const rectGroup = (ir.root.type === "group" ? ir.root.children : [])
      .flatMap((node) => (node.type === "group" ? node.children : []))
      .find((node) => node.nodeId.endsWith(":inline-rect:0"));
    expect(rectGroup).toBeDefined();
    expect(
      (rectGroup?.bbox.x ?? 0) - text.layoutBox.x - (local?.inlineRects?.[0]?.x ?? 0),
    ).toBeCloseTo(expectedOffset, 5);
  });

  it("keeps finite flow glyphs and rectangles in their preferred frame", () => {
    const scene = createElement(
      "Canvas",
      { width: 600, height: 150 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 32,
          width: 600,
          height: 120,
          preferredFrame: { w: 500, h: 100 },
          textAlign: "center",
          flowExclusions: [{ kind: "rect", x: 80, y: 20, width: 70, height: 60 }],
        },
        "A",
        createElement("InlineRect", { inlineSizePx: 20, color: "#e22" }),
        "B",
      ),
    );
    const local = engine.renderToLayoutTree(scene).root.children[0]?.textLayout?.resolvedTextLayout;
    const { ir } = engine.renderToSvgAndIR(scene);
    const text = findTextNode(ir.root);
    const rect = (ir.root.type === "group" ? ir.root.children : [])
      .flatMap((node) => (node.type === "group" ? node.children : []))
      .find((node) => node.nodeId.endsWith(":inline-rect:0"));
    expect(local?.inlineRects?.[0]).toBeDefined();
    expect(rect).toBeDefined();
    expect(text.bbox.x).toBe(text.layoutBox.x);
    expect(text.bbox.y).toBe(text.layoutBox.y);
    expect(rect?.bbox.x).toBeCloseTo(text.layoutBox.x + (local?.inlineRects?.[0]?.x ?? 0), 5);
    expect(rect?.bbox.y).toBeCloseTo(text.layoutBox.y + (local?.inlineRects?.[0]?.y ?? 0), 5);
    expect(text.lines[0]?.positionedGlyphs?.[0]?.originX).toBe(
      local?.lines[0]?.positionedGlyphs?.[0]?.originX,
    );
  });

  it("aligns rich skip-ink decoration with the painted line", () => {
    const scene = createElement(
      "Canvas",
      { width: 600, height: 120 },
      createElement(
        "Text",
        { font: "NotoSansJP", fontSizePx: 32, width: 600, textAlign: "center" },
        createElement(
          "Inline",
          { textDecoration: { line: "underline", skipInk: "all", color: "#e22" } },
          "Hello",
        ),
      ),
    );
    const local = engine.renderToLayoutTree(scene).root.children[0]?.textLayout?.resolvedTextLayout;
    const painted = findTextNode(engine.renderToSvgAndIR(scene).ir.root);
    const offset = (painted.layoutBox.w - (local?.lines[0]?.width ?? 0)) / 2;
    const localPath = local?.textDecorations?.[0]?.paths[0];
    const paintedPath = painted.textDecorations?.[0]?.paths[0];
    expect(localPath).toBeDefined();
    expect(paintedPath).toBeDefined();
    expect(
      (paintedPath?.originX ?? 0) - (localPath?.originX ?? 0) - painted.layoutBox.x,
    ).toBeCloseTo(offset, 5);
  });
});
