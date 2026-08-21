import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import type { IRNode, IRTextNode } from "../../src/ir/types.js";
import { fromSceneDocument, toSceneDocument } from "../../src/scene/from-vnode.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { TextProps, VNode } from "../../src/vnode/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

function findNode(node: IRNode, nodeId: string): IRNode {
  if (node.nodeId === nodeId) {
    return node;
  }
  for (const child of node.children ?? []) {
    try {
      return findNode(child, nodeId);
    } catch {
      // Continue the deterministic tree walk.
    }
  }
  throw new TypeError(`Missing IR node ${nodeId}`);
}

function findText(node: IRNode, nodeId: string): IRTextNode {
  if (node.type === "text" && node.nodeId === nodeId) {
    return node;
  }
  for (const child of node.children ?? []) {
    try {
      return findText(child, nodeId);
    } catch {
      // Continue the deterministic tree walk.
    }
  }
  throw new TypeError(`Missing Text IR node ${nodeId}`);
}

function typingScene(children: VNode["children"], props: Partial<TextProps> = {}): VNode {
  return createElement(
    "Canvas",
    { width: 360, height: 220, background: "#ffffff" },
    createElement(
      "Text",
      {
        id: "typing",
        font: "NotoSansJP",
        fontSizePx: 32,
        lineHeightPx: 40,
        color: "#111827",
        width: 320,
        ...props,
      },
      ...children,
    ),
  );
}

describe("InlineRect real WASM rendering", () => {
  let handle: WasmEngineHandle;
  let engine: Engine;
  let rasterize: (svg: string) => Uint8Array;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
    rasterize = handle.createSvgToPngFn();
    engine = createEngineFromHandle(handle, { svgToPngFn: rasterize });
  });

  afterAll(() => {
    engine.dispose();
    handle.dispose();
  });

  it("renders bar, block, and underline cursor geometries with fixed paint order", () => {
    const scene = typingScene([
      createElement("InlineRect", {
        inlineSizePx: 2,
        color: "#111827",
        paintOrder: "behind",
      }),
      createElement("InlineRect", {
        inlineSizePx: 18,
        advancePx: 18,
        color: "#2563eb",
        opacity: 0.45,
      }),
      createElement("InlineRect", {
        inlineSizePx: 18,
        blockSizePx: 2,
        blockAlign: "end",
        color: "#ef4444",
      }),
    ]);
    const ir = engine.renderToIR(scene);
    const text = findText(ir.root, "typing");
    const behind = findNode(ir.root, "typing:inline-rect:0");
    const block = findNode(ir.root, "typing:inline-rect:1");
    const underline = findNode(ir.root, "typing:inline-rect:2");

    expect(behind.bbox).toMatchObject({ w: 2, h: 40 });
    expect(block.bbox).toMatchObject({ w: 18, h: 40 });
    expect(block.type === "group" ? block.opacity : undefined).toBe(0.45);
    expect(underline.bbox).toMatchObject({ w: 18, h: 2 });
    expect(underline.bbox.y).toBeCloseTo(text.bbox.y + text.bbox.h - 2, 5);
    const textGroup = findNode(ir.root, "typing");
    expect(textGroup.type).toBe("group");
    if (textGroup.type !== "group") {
      throw new TypeError("Missing Text wrapper group");
    }
    expect(textGroup.children?.map((child) => child.nodeId)).toEqual([
      "typing:inline-rect:0",
      "typing",
      "typing:inline-rect:1",
      "typing:inline-rect:2",
    ]);
    expect(ir.drawOrder).toContain("typing");
    expect(ir.drawOrder).toEqual([
      "auto:0:bg",
      "typing:inline-rect:0:rect",
      "typing",
      "typing:inline-rect:1:rect",
      "typing:inline-rect:2:rect",
    ]);
  });

  it("keeps zero advance at line end, wraps positive advance, and accepts empty Text", () => {
    const plain = engine.renderToIR(typingScene(["A"]));
    const lineEnd = engine.renderToIR(
      typingScene(["A", createElement("InlineRect", { inlineSizePx: 2, color: "#111827" })]),
    );
    const plainText = findText(plain.root, "typing");
    const lineEndText = findText(lineEnd.root, "typing");
    const caret = findNode(lineEnd.root, "typing:inline-rect:0");
    expect(lineEndText.bbox.w).toBeCloseTo(plainText.bbox.w, 5);
    expect(caret.bbox.x).toBeCloseTo(plainText.bbox.x + plainText.bbox.w, 5);

    const wrapped = engine.renderToIR(
      typingScene(
        [
          createElement("InlineRect", {
            inlineSizePx: 4,
            advancePx: 40,
            color: "#2563eb",
          }),
          "A",
        ],
        { width: 30 },
      ),
    );
    expect(findText(wrapped.root, "typing").lines).toHaveLength(2);

    const empty = engine.renderToIR(
      typingScene([createElement("InlineRect", { inlineSizePx: 2, color: "#111827" })]),
    );
    expect(findNode(empty.root, "typing:inline-rect:0").bbox).toMatchObject({ w: 2, h: 40 });
    expect(
      engine.renderToSvg(
        typingScene([createElement("InlineRect", { inlineSizePx: 2, color: "#111827" })]),
      ),
    ).not.toContain("aria-label");
  });

  it("maps vertical logical axes and preserves authored pixels through fit shrink and flow", () => {
    const vertical = engine.renderToIR(
      typingScene(
        [
          createElement("InlineRect", {
            inlineSizePx: 8,
            blockSizePx: 4,
            blockAlign: "end",
            color: "#2563eb",
          }),
        ],
        { writingMode: "vertical-rl", height: 100 },
      ),
    );
    const verticalText = findText(vertical.root, "typing");
    const verticalRect = findNode(vertical.root, "typing:inline-rect:0");
    expect(verticalRect.bbox).toMatchObject({ w: 4, h: 8 });
    expect(verticalRect.bbox.x).toBeCloseTo(verticalText.bbox.x, 5);

    const fitted = engine.renderToIR(
      typingScene(
        [
          "あいうえおかきくけこ",
          createElement("InlineRect", {
            inlineSizePx: 4,
            blockSizePx: 10,
            color: "#ef4444",
          }),
        ],
        { width: 110, height: 44, fontSizePx: 38, fit: "shrink", minFontSizePx: 8 },
      ),
    );
    expect(findText(fitted.root, "typing").fontSizePx).toBeLessThan(38);
    expect(findNode(fitted.root, "typing:inline-rect:0").bbox).toMatchObject({ w: 4, h: 10 });

    const flowed = engine.renderToIR(
      typingScene(
        [
          "flow ",
          createElement("InlineRect", {
            inlineSizePx: 4,
            advancePx: 8,
            color: "#16a34a",
          }),
          " text around an exclusion ".repeat(4),
        ],
        {
          width: 250,
          height: 170,
          fontSizePx: 20,
          lineHeightPx: 28,
          flowExclusions: [{ kind: "rect", x: 80, y: 20, width: 70, height: 60 }],
        },
      ),
    );
    expect(findNode(flowed.root, "typing:inline-rect:0").bbox).toMatchObject({ w: 4, h: 28 });
  });

  it("excludes InlineRect from text, aria, UnitMap, and unit animation", () => {
    const plainScene = typingScene(["AB"], {
      animateUnits: {
        by: "cluster",
        animation: {
          keyframes: [
            { at: 0, opacity: 0 },
            { at: 1, opacity: 1 },
          ],
          durationMs: 200,
        },
      },
    });
    const rectScene = typingScene(
      ["A", createElement("InlineRect", { inlineSizePx: 2, color: "#111827" }), "B"],
      {
        animateUnits: {
          by: "cluster",
          animation: {
            keyframes: [
              { at: 0, opacity: 0 },
              { at: 1, opacity: 1 },
            ],
            durationMs: 200,
          },
        },
      },
    );
    const plainText = findText(engine.renderToIR(plainScene).root, "typing");
    const rectIr = engine.renderToIR(rectScene);
    const rectText = findText(rectIr.root, "typing");

    expect(rectText.lines.map((line) => line.text).join("")).toBe("AB");
    const unitProjection = (text: IRTextNode) =>
      text.unitMap?.units.map(({ unitId: _unitId, ...unit }) => unit);
    const sampleProjection = (text: IRTextNode) =>
      text.unitAnimationSamples?.map(({ unitId: _unitId, ...sample }) => sample);
    expect(unitProjection(rectText)).toEqual(unitProjection(plainText));
    expect(sampleProjection(rectText)).toEqual(sampleProjection(plainText));
    expect(engine.renderToSvg(rectScene)).toContain('aria-label="AB"');
    expect(engine.renderToSvg(rectScene)).not.toContain(
      "inline-rect:0:rect" + " data-boundsvg-text",
    );
  });

  it("samples a visible step blink and keeps declarative/static output in parity", () => {
    const animated = createElement(
      "Canvas",
      { width: 360, height: 220 },
      createElement(
        "Text",
        { id: "typing", font: "NotoSansJP", fontSizePx: 32 },
        "A",
        createElement("InlineRect", {
          inlineSizePx: 2,
          color: "#111827",
          animate: {
            keyframes: [
              { at: 0, opacity: 1 },
              { at: 1, opacity: 0 },
            ],
            durationMs: 500,
            easing: { type: "steps", count: 2, position: "jump-none" },
            iterations: "infinite",
            fill: "both",
          },
        }),
      ),
    );
    const caretOpacityAt = (timeMs: number) => {
      const caret = findNode(
        engine.renderToIR(animated, { animation: "static", timeMs }).root,
        "typing:inline-rect:0",
      );
      return caret.type === "group" ? caret.opacity : undefined;
    };
    expect(caretOpacityAt(0)).toBe(1);
    expect(caretOpacityAt(250)).toBe(0);
    expect(caretOpacityAt(500)).toBe(1);

    const declarative = engine.renderToSvg(animated, { animation: "declarative", timeMs: 250 });
    expect(declarative).toContain("steps(2, jump-none)");
    expect(rasterize(declarative)).toEqual(
      engine.renderToPng(animated, { animation: "static", timeMs: 250 }),
    );

    for (const opacity of [0, 1]) {
      const direct = typingScene([
        "A",
        createElement("InlineRect", {
          inlineSizePx: 2,
          color: "#111827",
          opacity,
        }),
      ]);
      const materializedA2Frame = fromSceneDocument(toSceneDocument(direct));
      expect(engine.renderToSvg(materializedA2Frame, { animation: "static" })).toBe(
        engine.renderToSvg(direct, { animation: "static" }),
      );
      expect(engine.renderToPng(materializedA2Frame, { animation: "static" })).toEqual(
        engine.renderToPng(direct, { animation: "static" }),
      );
    }
  });
});
