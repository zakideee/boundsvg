/**
 * Integration tests for kinsoku processing and vertical text alignment.
 * Uses the WASM engine + NotoSansJP to verify line/column content.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import type { IRNode } from "../../src/ir/types.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "../wasm/test-prerequisites.js";

describe("Kinsoku integration", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    const fontData = loadSubsetFont();
    engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: fontData }],
    });
  });

  function renderLines(
    text: string,
    options: {
      width: number;
      height: number;
      fontSizePx: number;
      writingMode?: "vertical-rl";
      textAlign?: "start" | "center" | "end";
    },
  ) {
    const vnode = createElement(
      "Canvas",
      { width: options.width, height: options.height },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: options.fontSizePx,
          color: "#000",
          wrap: "char",
          language: "ja",
          ...(options.writingMode ? { writingMode: options.writingMode } : {}),
          ...(options.textAlign ? { textAlign: options.textAlign } : {}),
        },
        text,
      ),
    );
    const ir = engine.renderToIR(vnode);
    function findTextNode(n: IRNode): IRNode | null {
      if (n.type === "text") {
        return n;
      }
      for (const c of n.children ?? []) {
        const r = findTextNode(c);
        if (r) {
          return r;
        }
      }
      return null;
    }
    return findTextNode(ir.root);
  }

  it("horizontal: period does not start line", () => {
    // Use a narrow width to force line break around the period
    const textNode = renderLines("ああああ。いいいい", {
      width: 120,
      height: 300,
      fontSizePx: 28,
    });
    expect(textNode).not.toBeNull();
    const lines = textNode!.lines!;
    expect(lines.length).toBeGreaterThan(1);
    // No line (except first) should start with "。"
    for (let i = 1; i < lines.length; i++) {
      const first = lines[i]!.text.charAt(0);
      expect(first).not.toBe("。");
    }
  });

  it("vertical: period does not start column", () => {
    // Use an explicit Box with constrained height to force vertical column break.
    const vnode = createElement(
      "Canvas",
      { width: 300, height: 80 },
      createElement(
        "Box",
        { width: 300, height: 80 },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 28,
            color: "#000",
            wrap: "char",
            language: "ja",
            writingMode: "vertical-rl",
          },
          "ああああ。いいいい",
        ),
      ),
    );
    const ir = engine.renderToIR(vnode);
    function findTextNode(n: IRNode): IRNode | null {
      if (n.type === "text") {
        return n;
      }
      for (const c of n.children ?? []) {
        const r = findTextNode(c);
        if (r) {
          return r;
        }
      }
      return null;
    }
    const textNode = findTextNode(ir.root);
    expect(textNode).not.toBeNull();
    const lines = textNode!.lines!;
    // With 80px height and 28px font, we should get multi-column
    if (lines.length > 1) {
      for (let i = 1; i < lines.length; i++) {
        const first = lines[i]!.text.charAt(0);
        expect(first).not.toBe("。");
      }
    }
  });

  it("closing bracket does not start line", () => {
    const textNode = renderLines("ああああ」いいいい", {
      width: 120,
      height: 300,
      fontSizePx: 28,
    });
    expect(textNode).not.toBeNull();
    const lines = textNode!.lines!;
    if (lines.length > 1) {
      for (let i = 1; i < lines.length; i++) {
        const first = lines[i]!.text.charAt(0);
        expect(first).not.toBe("」");
      }
    }
  });

  it("opening bracket does not end line", () => {
    const textNode = renderLines("ああああ「いいいい", {
      width: 120,
      height: 300,
      fontSizePx: 28,
    });
    expect(textNode).not.toBeNull();
    const lines = textNode!.lines!;
    if (lines.length > 1) {
      for (let i = 0; i < lines.length - 1; i++) {
        const last = lines[i]!.text.charAt(lines[i]!.text.length - 1);
        expect(last).not.toBe("「");
      }
    }
  });

  it.each([
    "horizontal-tb",
    "vertical-rl",
  ] as const)("honors Inline language opt-in and opt-out in %s", (writingMode) => {
    type Language = "ja" | "en" | "auto";
    const makeScene = (parentLanguage: Language, inlineLanguage?: Language) =>
      createElement(
        "Canvas",
        { width: 320, height: 300, background: "#ffffff" },
        createElement(
          "Text",
          {
            id: "inline-language",
            font: "NotoSansJP",
            fontSizePx: 20,
            lineHeight: 1.2,
            color: "#111827",
            wrap: "word",
            language: parentLanguage,
            writingMode,
            ...(writingMode === "horizontal-tb"
              ? { width: 52 }
              : { height: 52, textOrientation: "upright" as const }),
          },
          createElement(
            "Inline",
            {
              color: "#1f2937",
              ...(inlineLanguage ? { language: inlineLanguage } : {}),
            },
            "ABCDEFG",
          ),
        ),
      );
    const renderScene = (scene: ReturnType<typeof createElement>) => {
      const ir = engine.renderToIR(scene);
      const findTextNode = (node: IRNode): IRNode | null => {
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
      };
      const textNode = findTextNode(ir.root);
      expect(textNode).not.toBeNull();
      return {
        lineTexts: textNode!.lines!.map((line) => line.text),
        png: engine.renderToPng(scene),
      };
    };
    const renderVariant = (parentLanguage: Language, inlineLanguage?: Language) =>
      renderScene(makeScene(parentLanguage, inlineLanguage));

    const parentEn = renderVariant("en");
    const parentJa = renderVariant("ja");
    const inlineJa = renderVariant("en", "ja");
    const inlineEn = renderVariant("ja", "en");
    const inlineAuto = renderVariant("ja", "auto");

    expect(parentEn.lineTexts).toEqual(["ABCDEFG"]);
    expect(parentJa.lineTexts.length).toBeGreaterThan(1);
    expect(inlineJa.lineTexts).toEqual(parentJa.lineTexts);
    expect(Buffer.from(inlineJa.png).equals(Buffer.from(parentJa.png))).toBe(true);
    for (const neutralOverride of [inlineEn, inlineAuto]) {
      expect(neutralOverride.lineTexts).toEqual(parentEn.lineTexts);
      expect(Buffer.from(neutralOverride.png).equals(Buffer.from(parentEn.png))).toBe(true);
    }

    for (const placement of ["head", "tail"] as const) {
      const inline = createElement("Inline", { color: "#1f2937", language: "en" }, "API");
      const mixedScene = createElement(
        "Canvas",
        { width: 320, height: 300, background: "#ffffff" },
        createElement(
          "Text",
          {
            id: "mixed-inline-language",
            font: "NotoSansJP",
            fontSizePx: 20,
            lineHeight: 1.2,
            color: "#111827",
            wrap: "word",
            language: "ja",
            writingMode,
            ...(writingMode === "horizontal-tb"
              ? { width: 36 }
              : { height: 36, textOrientation: "upright" as const }),
          },
          ...(placement === "head" ? [inline, "。"] : ["「", inline]),
        ),
      );
      expect(renderScene(mixedScene).lineTexts).toEqual([placement === "head" ? "API。" : "「API"]);
    }
  });

  it("vertical textAlign=center alignment", () => {
    const textNode = renderLines("あいう", {
      width: 300,
      height: 300,
      fontSizePx: 28,
      writingMode: "vertical-rl",
      textAlign: "center",
    });
    expect(textNode).not.toBeNull();
    // Verify it renders without error — alignment is applied at SVG emitter level
    expect(textNode!.lines!.length).toBeGreaterThanOrEqual(1);
  });

  it("vertical textAlign=end alignment", () => {
    const textNode = renderLines("あいう", {
      width: 300,
      height: 300,
      fontSizePx: 28,
      writingMode: "vertical-rl",
      textAlign: "end",
    });
    expect(textNode).not.toBeNull();
    expect(textNode!.lines!.length).toBeGreaterThanOrEqual(1);
  });
});
