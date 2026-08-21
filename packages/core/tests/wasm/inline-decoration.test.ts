import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "./test-prerequisites.js";

/**
 * boundtext computes `inline_box_decorations` for decorated `Inline`
 * runs, but the WASM layout DTO had no field for them, so the background,
 * border, and border radius were dropped between the engine and the IR — the
 * decoration silently never rendered.
 */
function decoratedText(): ReturnType<typeof createElement> {
  return createElement(
    "Canvas",
    { width: 420, height: 140, background: "#ffffff" },
    createElement(
      "Text",
      {
        id: "deco",
        font: "NotoSansJP",
        fontSizePx: 20,
        color: "#111111",
        width: 380,
        language: "ja",
      },
      "装飾付き",
      createElement(
        "Inline",
        {
          background: "#fde68a",
          borderColor: "#d97706",
          borderWidth: 1,
          borderRadius: [3, 3, 3, 3],
          paddingInline: [4, 4],
          color: "#7c2d12",
        },
        "インライン強調",
      ),
      "が行をまたいでも安定して描画される。",
    ),
  );
}

function paddingOnlyText(
  writingMode: "horizontal-tb" | "vertical-rl",
  withPadding: boolean,
): ReturnType<typeof createElement> {
  const inlineProps = withPadding ? { paddingInline: [5, 9] as [number, number] } : {};
  return createElement(
    "Canvas",
    { width: 420, height: 240, background: "#ffffff" },
    createElement(
      "Text",
      {
        id: "padding-only",
        font: "NotoSansJP",
        fontSizePx: 20,
        color: "#111111",
        language: "ja",
        writingMode,
        ...(writingMode === "horizontal-tb"
          ? { width: 380 }
          : { height: 180, textOrientation: "upright" as const }),
      },
      "前",
      createElement("Inline", inlineProps, "天地"),
      "後",
    ),
  );
}

describe("Inline decoration rendering", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
  });

  it("emits the decoration background and border into the SVG", () => {
    const svg = engine.renderToSvg(decoratedText());

    expect(svg).toContain("#fde68a");
    expect(svg).toContain("#d97706");
  });

  it("emits a decoration rect into the IR, painted before the text", () => {
    const { ir } = engine.renderToSvgAndIR(decoratedText());

    const decorationIndex = ir.drawOrder.findIndex((id) => id.startsWith("deco:ibox"));
    const textIndex = ir.drawOrder.indexOf("deco");

    expect(decorationIndex).toBeGreaterThanOrEqual(0);
    expect(textIndex).toBeGreaterThanOrEqual(0);
    // Background must paint behind the glyphs it wraps.
    expect(decorationIndex).toBeLessThan(textIndex);
  });

  it("changes the rasterized output (the decoration is actually painted)", () => {
    const withDecoration = engine.renderToPng(decoratedText());
    const withoutDecoration = engine.renderToPng(
      createElement(
        "Canvas",
        { width: 420, height: 140, background: "#ffffff" },
        createElement(
          "Text",
          {
            id: "deco",
            font: "NotoSansJP",
            fontSizePx: 20,
            color: "#111111",
            width: 380,
            language: "ja",
          },
          "装飾付き",
          createElement("Inline", { color: "#7c2d12" }, "インライン強調"),
          "が行をまたいでも安定して描画される。",
        ),
      ),
    );

    expect(Buffer.from(withDecoration).equals(Buffer.from(withoutDecoration))).toBe(false);
  });

  it("reserves paint-free padding advance without emitting a decoration node", () => {
    for (const writingMode of ["horizontal-tb", "vertical-rl"] as const) {
      const omitted = engine.renderToSvgAndIR(paddingOnlyText(writingMode, false));
      const padded = engine.renderToSvgAndIR(paddingOnlyText(writingMode, true));

      expect(padded.ir.drawOrder.some((nodeId) => nodeId.startsWith("padding-only:ibox"))).toBe(
        false,
      );
      expect(padded.svg).not.toBe(omitted.svg);

      const omittedPng = engine.renderToPng(paddingOnlyText(writingMode, false));
      const paddedPng = engine.renderToPng(paddingOnlyText(writingMode, true));
      expect(Buffer.from(paddedPng).equals(Buffer.from(omittedPng))).toBe(false);
    }
  });
});
