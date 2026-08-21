import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import type { RecoverableError } from "../../src/errors.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import {
  assertWasmPkgAvailable,
  loadJetBrainsMonoFont,
  loadSubsetFont,
} from "./test-prerequisites.js";

function textCanvas(content: string): ReturnType<typeof createElement> {
  return createElement(
    "Canvas",
    { width: 600, height: 200 },
    createElement(
      "Text",
      { id: "warn-text", font: "NotoSansJP", fontSizePx: 24, width: 560 },
      content,
    ),
  );
}

function collectKinsokuWarnings(
  engine: Engine,
  scene: ReturnType<typeof createElement>,
  route: "svg" | "png",
): RecoverableError[] {
  const warnings: RecoverableError[] = [];
  const options = { onWarning: (warning: RecoverableError) => warnings.push(warning) };
  if (route === "svg") {
    engine.renderToSvg(scene, options);
  } else {
    engine.renderToPng(scene, options);
  }
  return warnings.filter((warning) => warning.code === "KINSOKU_UNRESOLVED");
}

describe("recoverable warning delivery", () => {
  let engine: Engine;
  let monoEngine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
    monoEngine = await createEngineAsync({
      fonts: [
        { alias: "JetBrainsMono", weight: 400, style: "normal", data: loadJetBrainsMonoFont() },
      ],
    });
  });

  it("delivers MISSING_GLYPH to onWarning on renderToSvg", () => {
    const warnings: RecoverableError[] = [];
    const svg = engine.renderToSvg(textCanvas("絵文字🎉テスト"), {
      onWarning: (warning) => warnings.push(warning),
    });
    expect(svg).toContain("<svg");
    const missing = warnings.filter((warning) => warning.code === "MISSING_GLYPH");
    expect(missing).toHaveLength(1);
    // Engine-bridged message uses U+ notation and carries the node id.
    expect(missing[0]!.message).toContain("U+1F389");
    expect(missing[0]!.nodeId).toBe("warn-text");
    expect(missing[0]!.stage).toBe("text");
    expect(missing[0]!.fallback).toBe("blank");
  });

  it("delivers the same warnings on renderToPng", () => {
    const warnings: RecoverableError[] = [];
    const png = engine.renderToPng(textCanvas("絵文字🎉テスト"), {
      onWarning: (warning) => warnings.push(warning),
    });
    expect(png.length).toBeGreaterThan(0);
    expect(warnings.some((warning) => warning.code === "MISSING_GLYPH")).toBe(true);
  });

  it("snapshots layered PNG scale before warning callbacks can mutate options", () => {
    const warningCodes: string[] = [];
    const options = {
      scale: 1,
      onWarning: (warning: RecoverableError) => {
        warningCodes.push(warning.code);
        options.scale = Number.MAX_VALUE;
      },
    };

    const layered = engine.renderToLayeredPng(textCanvas("絵文字🎉テスト"), options);

    expect(warningCodes).toContain("MISSING_GLYPH");
    expect(layered.pixelWidth).toBe(600);
    expect(layered.pixelHeight).toBe(200);
    expect(layered.layers.length).toBeGreaterThan(0);
  });

  it("stays silent for fully covered text", () => {
    const warnings: RecoverableError[] = [];
    engine.renderToSvg(textCanvas("あいうえお"), {
      onWarning: (warning) => warnings.push(warning),
    });
    expect(warnings).toEqual([]);
  });

  it("delivers MISSING_GLYPH when a Latin-only primary font renders Japanese", () => {
    const warnings: RecoverableError[] = [];
    const vnode = createElement(
      "Canvas",
      { width: 600, height: 200 },
      createElement(
        "Text",
        { id: "mono-cjk", font: "JetBrainsMono", fontSizePx: 24, width: 560 },
        "日本語",
      ),
    );

    monoEngine.renderToSvg(vnode, {
      onWarning: (warning) => warnings.push(warning),
    });

    expect(warnings.map((warning) => warning.code)).toContain("MISSING_GLYPH");
  });

  it("reaches kinsoku and rich-text warning variants through renderToSvg", () => {
    const collect = (child: ReturnType<typeof createElement>) => {
      const warnings: RecoverableError[] = [];
      engine.renderToSvg(createElement("Canvas", { width: 300, height: 200 }, child), {
        onWarning: (warning) => warnings.push(warning),
      });
      return warnings.map((warning) => warning.code);
    };

    const kinsokuCodes = collect(
      createElement(
        "Text",
        {
          id: "kinsoku",
          font: "NotoSansJP",
          fontSizePx: 20,
          width: 25,
          language: "ja",
          wrap: "char",
        },
        "。。。",
      ),
    );

    const rubyCodes = collect(
      createElement(
        "Text",
        { id: "ruby", font: "NotoSansJP", fontSizePx: 24, width: 260 },
        createElement(
          "Ruby",
          { rubyPosition: "inter-character" },
          "字",
          createElement("Rt", {}, "とてもながいルビ"),
        ),
      ),
    );

    const nestedInlineBox = createElement(
      "InlineBox",
      {},
      createElement(
        "InlineBox",
        {},
        createElement("InlineBox", {}, createElement("InlineBox", {}, "深い")),
      ),
    );
    const depthCodes = collect(
      createElement(
        "Text",
        { id: "depth", font: "NotoSansJP", fontSizePx: 20, width: 260 },
        nestedInlineBox,
      ),
    );

    expect(kinsokuCodes).toContain("KINSOKU_UNRESOLVED");
    expect(rubyCodes).toContain("LONG_RUBY_ANNOTATION");
    expect(rubyCodes).toContain("RUBY_INTER_CHARACTER_FALLBACK");
    expect(depthCodes).toContain("INLINE_BOX_MAX_DEPTH");
  });

  it("delivers kinsoku recovery warnings for equivalent plain and rich text", () => {
    for (const writingMode of ["horizontal-tb", "vertical-rl"] as const) {
      for (const representation of ["plain", "rich"] as const) {
        const content =
          representation === "plain"
            ? "。".repeat(12)
            : createElement("Inline", { color: "#dc2626" }, "。".repeat(12));
        const scene = createElement(
          "Canvas",
          { width: 300, height: 300 },
          createElement(
            "Text",
            {
              id: `kinsoku-${writingMode}-${representation}`,
              font: "NotoSansJP",
              fontSizePx: 20,
              language: "ja",
              wrap: "char",
              writingMode,
              ...(writingMode === "horizontal-tb" ? { width: 40 } : { height: 40 }),
            },
            content,
          ),
        );

        for (const route of ["svg", "png"] as const) {
          expect(collectKinsokuWarnings(engine, scene, route)).toHaveLength(1);
        }
      }
    }
  });

  it("reaches defensive IR fallback warnings through WASM layout and render", () => {
    const collect = (
      child: ReturnType<typeof createElement>,
      options?: { skipValidation?: boolean },
    ) => {
      const warnings: RecoverableError[] = [];
      engine.renderToSvg(createElement("Canvas", { width: 300, height: 200 }, child), {
        ...options,
        onWarning: (warning) => warnings.push(warning),
      });
      return warnings.map((warning) => warning.code);
    };

    // @ts-expect-error intentional malformed runtime input exercises the documented fallback.
    const missingImage = createElement("Image", { id: "missing", width: 40, height: 40 });
    const imageCodes = collect(missingImage, { skipValidation: true });
    const embeddedTextCodes = collect(
      createElement("Svg", {
        id: "raw-svg",
        width: 80,
        height: 40,
        content: '<svg viewBox="0 0 80 40"><text x="4" y="20">label</text></svg>',
      }),
    );
    const partPaintCodes = collect(
      createElement("Shape", {
        id: "shape",
        width: 100,
        height: 100,
        geometry: {
          viewBox: { width: 100, height: 100 },
          root: {
            kind: "group",
            children: [{ kind: "path", nodeId: "known", d: "M0 0H100V100H0Z" }],
          },
        },
        fill: "#000",
        partPaint: { unknown: { fill: "#f00" } },
      }),
    );

    expect(imageCodes).toContain("IMAGE_LOAD_FAILED");
    expect(embeddedTextCodes).toContain("SVG_EMBEDDED_TEXT");
    expect(partPaintCodes).toContain("SHAPE_PART_PAINT_UNKNOWN_PART");
  });

  it("delivers PNG_RESOLUTION_ADJUSTED from the real raster path", () => {
    const warnings: RecoverableError[] = [];
    const png = engine.renderToPng(createElement("Canvas", { width: 5000, height: 2 }), {
      onWarning: (warning) => warnings.push(warning),
    });

    expect(png.length).toBeGreaterThan(0);
    // Exact cardinality guards against delivering the warning once from the
    // cloned IR and again from the scale-adjustment callback.
    expect(warnings.map((warning) => warning.code)).toEqual(["PNG_RESOLUTION_ADJUSTED"]);
  });
});
