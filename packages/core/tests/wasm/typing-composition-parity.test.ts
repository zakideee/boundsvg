import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import type { IRNode, IRTextNode } from "../../src/ir/types.js";
import { parsePathBBox } from "../../src/path/utils.js";
import { fromSceneDocument, toSceneDocument } from "../../src/scene/from-vnode.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

type ImeStage = {
  id: string;
  committed: string;
  active: string;
  converted?: boolean;
};

const IME_STAGES: readonly ImeStage[] = [
  { id: "committed", committed: "入力: ", active: "" },
  { id: "hiragana", committed: "入力: ", active: "きょう" },
  { id: "converted", committed: "入力: ", active: "今日", converted: true },
  { id: "commit", committed: "入力: 今日", active: "" },
];

const TERMINAL_CONTENT = [
  "",
  "pnpm",
  "pnpm test",
  "pnpm test\nPASS typing composition parity",
] as const;

function findNode(root: IRNode, nodeId: string): IRNode {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node?.nodeId === nodeId) {
      return node;
    }
    pending.push(...(node?.children ?? []));
  }
  throw new TypeError(`Missing IR node ${nodeId}`);
}

function findText(root: IRNode, nodeId: string): IRTextNode {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node?.type === "text" && node.nodeId === nodeId) {
      return node;
    }
    pending.push(...(node?.children ?? []));
  }
  throw new TypeError(`Missing Text IR node ${nodeId}`);
}

function createCaret(color = "#22c55e"): VNode {
  return createElement("InlineRect", {
    inlineSizePx: 2,
    color,
  });
}

function buildTerminalScene(content: string, includeCaret = true): VNode {
  return createElement(
    "Canvas",
    { width: 260, height: 180, background: "#020617" },
    createElement(
      "Text",
      {
        id: "terminal",
        font: "JetBrainsMono",
        fallback: ["NotoSansJP"],
        fontSizePx: 20,
        lineHeightPx: 28,
        width: 150,
        height: 150,
        wrap: "char",
        whiteSpace: "pre-wrap",
        color: "#e2e8f0",
      },
      "$ ",
      content,
      ...(includeCaret ? [createCaret()] : []),
    ),
  );
}

function buildImeScene(stage: ImeStage): VNode {
  const active = stage.active
    ? createElement(
        "Inline",
        {
          textDecoration: {
            line: "underline",
            style: stage.converted ? "double" : "solid",
            color: stage.converted ? "#a855f7" : "#2563eb",
            thicknessPx: 2,
          },
        },
        stage.active,
      )
    : undefined;
  return createElement(
    "Canvas",
    { width: 380, height: 120, background: "#f8fafc" },
    createElement(
      "Text",
      {
        id: "ime",
        font: "NotoSansJP",
        fontSizePx: 32,
        lineHeightPx: 44,
        width: 340,
        color: "#111827",
      },
      stage.committed,
      ...(active ? [active] : []),
      createCaret("#111827"),
    ),
  );
}

function buildVerticalCompositionScene(decorated: boolean, includeCaret = true): VNode {
  return createElement(
    "Canvas",
    { width: 180, height: 280, background: "#f8fafc" },
    createElement(
      "Text",
      {
        id: "vertical-composition",
        font: "NotoSansJP",
        fontSizePx: 28,
        lineHeightPx: 40,
        width: 120,
        height: 240,
        writingMode: "vertical-rl",
        textOrientation: "upright",
        wrap: "char",
        color: "#111827",
      },
      "確定",
      createElement(
        "Inline",
        decorated
          ? {
              textDecoration: {
                line: "underline",
                color: "#2563eb",
                thicknessPx: 2,
              },
            }
          : {},
        "へんかん",
      ),
      ...(includeCaret
        ? [
            createElement("InlineRect", {
              inlineSizePx: 18,
              blockSizePx: 3,
              blockAlign: "end",
              color: "#2563eb",
            }),
          ]
        : []),
    ),
  );
}

function buildClusterBoundaryScene(decorated: boolean): VNode {
  const inlineProps = decorated
    ? { textDecoration: { line: "underline" as const, color: "#ef4444" } }
    : {};
  const children: VNode["children"] = decorated
    ? [
        "f",
        createElement("Inline", inlineProps, "i"),
        " e",
        createElement("Inline", inlineProps, "\u0301"),
      ]
    : ["fi e\u0301"];
  return createElement(
    "Canvas",
    { width: 300, height: 100, background: "#ffffff" },
    createElement(
      "Text",
      {
        id: "cluster-boundaries",
        font: "InterVariable",
        fallback: ["NotoSansJP"],
        fontSizePx: 40,
        fontFeatureSettings: '"liga" 1',
        language: "en",
        color: "#111827",
      },
      ...children,
    ),
  );
}

function positionedGlyphIdentity(text: IRTextNode): unknown {
  return text.lines.map((line) =>
    line.positionedGlyphs?.map((glyph) => ({
      glyphId: glyph.glyphId,
      text: glyph.text,
      clusterStart: glyph.clusterStart,
      clusterEnd: glyph.clusterEnd,
      sourceStart: glyph.sourceStart,
      sourceEnd: glyph.sourceEnd,
      sourceRole: glyph.sourceRole,
      originX: glyph.originX,
      originY: glyph.originY,
      xAdvance: glyph.xAdvance,
      yAdvance: glyph.yAdvance,
    })),
  );
}

function lineLayoutIdentity(text: IRTextNode): unknown {
  return text.lines.map((line) => ({
    text: line.text,
    width: line.width,
  }));
}

describe("typing and composition real-WASM parity", () => {
  let handle: WasmEngineHandle;
  let engine: Engine;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
    engine = createEngineFromHandle(handle, { svgToPngFn: handle.createSvgToPngFn() });
  });

  afterAll(() => {
    engine.dispose();
    handle.dispose();
  });

  it("reflows growing terminal content and keeps a zero-advance caret at the final pen", () => {
    const lineCounts: number[] = [];
    for (const content of TERMINAL_CONTENT) {
      const withCaret = engine.renderToIR(buildTerminalScene(content));
      const withoutCaret = engine.renderToIR(buildTerminalScene(content, false));
      const withCaretText = findText(withCaret.root, "terminal");
      const withoutCaretText = findText(withoutCaret.root, "terminal");
      const caret = findNode(withCaret.root, "terminal:inline-rect:0");
      const finalGlyph = withCaretText.lines.at(-1)?.positionedGlyphs?.at(-1);

      expect(lineLayoutIdentity(withCaretText)).toEqual(lineLayoutIdentity(withoutCaretText));
      expect(withCaretText.glyphPaths).toEqual(withoutCaretText.glyphPaths);
      expect(withCaretText.bbox).toEqual(withoutCaretText.bbox);
      expect(caret.bbox.w).toBe(2);
      expect(caret.bbox.h).toBe(28);
      expect(finalGlyph).toBeDefined();
      expect(caret.bbox.x).toBeCloseTo(
        (finalGlyph?.originX ?? Number.NaN) + (finalGlyph?.xAdvance ?? Number.NaN),
        5,
      );
      lineCounts.push(withCaretText.lines.length);
    }

    expect(lineCounts[0]).toBe(1);
    expect(lineCounts.at(-1)).toBeGreaterThan(lineCounts[0] ?? 0);
    expect(
      findText(engine.renderToIR(buildTerminalScene(TERMINAL_CONTENT[3])).root, "terminal").lines,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("PASS") })]),
    );
  });

  it("materializes committed, hiragana, converted, and committed IME states byte-identically", () => {
    const renderedSvgs: string[] = [];
    for (const stage of IME_STAGES) {
      const direct = buildImeScene(stage);
      const materialized = fromSceneDocument(toSceneDocument(direct));
      const directIr = engine.renderToIR(direct);
      const text = findText(directIr.root, "ime");
      const expectedText = stage.committed + stage.active;

      expect(text.lines.map((line) => line.text).join("")).toBe(expectedText);
      expect(findNode(directIr.root, "ime:inline-rect:0").bbox.w).toBe(2);
      if (stage.active) {
        expect(text.textDecorations).toEqual([
          expect.objectContaining({
            line: "underline",
            style: stage.converted ? "double" : "solid",
          }),
        ]);
      } else {
        expect(text.textDecorations ?? []).toEqual([]);
      }

      const directSvg = engine.renderToSvg(direct, {});
      renderedSvgs.push(directSvg);
      expect(engine.renderToSvg(materialized, {})).toBe(directSvg);
      expect(engine.renderToPng(materialized, {})).toEqual(engine.renderToPng(direct, {}));
      expect(directSvg).toContain(`aria-label="${expectedText}"`);
    }

    expect(new Set(renderedSvgs)).toHaveLength(IME_STAGES.length);
  });

  it("keeps vertical composition layout stable while adding underline and caret paint", () => {
    const plain = findText(
      engine.renderToIR(buildVerticalCompositionScene(false, false)).root,
      "vertical-composition",
    );
    const decoratedScene = buildVerticalCompositionScene(true);
    const decoratedIr = engine.renderToIR(decoratedScene);
    const decorated = findText(decoratedIr.root, "vertical-composition");
    const caret = findNode(decoratedIr.root, "vertical-composition:inline-rect:0");
    const decorationPaths = decorated.textDecorations?.flatMap((fragment) => fragment.paths);

    expect(lineLayoutIdentity(decorated)).toEqual(lineLayoutIdentity(plain));
    expect(decorated.glyphPaths).toEqual(plain.glyphPaths);
    expect(decorated.layoutBox).toEqual(plain.layoutBox);
    expect(decorated.bbox.x).toBeLessThanOrEqual(plain.bbox.x);
    expect(decorated.bbox.y).toBeLessThanOrEqual(plain.bbox.y);
    expect(decorated.bbox.x + decorated.bbox.w).toBeGreaterThanOrEqual(plain.bbox.x + plain.bbox.w);
    expect(decorated.bbox.y + decorated.bbox.h).toBeGreaterThanOrEqual(plain.bbox.y + plain.bbox.h);
    expect(decorationPaths?.length).toBeGreaterThan(0);
    expect(
      decorationPaths?.every((path) => {
        const bbox = parsePathBBox(path.d);
        return bbox !== null && bbox.maxY - bbox.minY > bbox.maxX - bbox.minX;
      }),
    ).toBe(true);
    expect(caret.bbox).toMatchObject({ w: 3, h: 18 });

    const materialized = fromSceneDocument(toSceneDocument(decoratedScene));
    expect(engine.renderToSvg(materialized, {})).toBe(engine.renderToSvg(decoratedScene, {}));
    expect(engine.renderToPng(materialized, {})).toEqual(engine.renderToPng(decoratedScene, {}));
  });

  it("keeps ligature and combining cluster identity across decoration-only boundaries", () => {
    const plain = findText(
      engine.renderToIR(buildClusterBoundaryScene(false)).root,
      "cluster-boundaries",
    );
    const decorated = findText(
      engine.renderToIR(buildClusterBoundaryScene(true)).root,
      "cluster-boundaries",
    );

    expect(positionedGlyphIdentity(decorated)).toEqual(positionedGlyphIdentity(plain));
    expect(decorated.glyphPaths).toEqual(plain.glyphPaths);
    expect(lineLayoutIdentity(decorated)).toEqual(lineLayoutIdentity(plain));
    expect(decorated.textDecorations).toHaveLength(2);
    const glyphs = decorated.lines.flatMap((line) => line.positionedGlyphs ?? []);
    expect(
      glyphs.filter((glyph) => glyph.clusterEnd - glyph.clusterStart > 1).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
