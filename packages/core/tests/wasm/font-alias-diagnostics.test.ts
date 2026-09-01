import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import {
  assertWasmPkgAvailable,
  loadJetBrainsMonoFont,
  loadSubsetFont,
} from "./test-prerequisites.js";

function textCanvas(font: string, fallback?: string[]): ReturnType<typeof createElement> {
  return createElement(
    "Canvas",
    { id: "scene", width: 400, height: 200 },
    createElement("Text", { id: "txt-alias", font, fallback, fontSizePx: 24 }, "テスト"),
  );
}

function renderError(engine: Engine, vnode: ReturnType<typeof createElement>): FatalError {
  return captureFatal(() => engine.renderToSvg(vnode));
}

function captureFatal(action: () => unknown): FatalError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    return error as FatalError;
  }
  throw new Error("expected operation to throw");
}

function expectFontUnavailable(
  error: FatalError,
  requestedAliases: string[],
  runIndex = 0,
  nodeId = "txt-alias",
): void {
  expect(error).toMatchObject({
    code: "TEXT_FONT_UNAVAILABLE",
    message: "No requested font is available for text layout.",
    stage: "text",
    nodeId,
    context: {
      operation: "renderTextLayout",
      runIndex,
      requestedAliases,
      omittedAliasCount: 0,
      fontWeight: 400,
      fontStyle: "normal",
    },
  });
}

describe("font alias diagnostics", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [
        { alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() },
        {
          alias: "JetBrainsMono",
          weight: 400,
          style: "normal",
          data: loadJetBrainsMonoFont(),
        },
      ],
    });
  });

  it("reports an unresolvable primary alias from the Rust owner", () => {
    const error = renderError(engine, textCanvas("NotoSansJP-typo"));
    expectFontUnavailable(error, ["NotoSansJP-typo"]);
    expect(error.message).not.toContain("NotoSansJP-typo");
  });

  it("uses the same Rust diagnosis on layout, raster, and layout-transition routes", () => {
    const missingFontScene = textCanvas("RouteMissing");
    const transition = {
      states: { reference: missingFontScene, target: missingFontScene },
      checkpoints: [
        { timeMs: 0, state: "reference" },
        { timeMs: 100, state: "target" },
        { timeMs: 200, state: "target" },
        { timeMs: 300, state: "reference" },
      ],
    } as const;
    const actions = [
      () => engine.renderToLayoutTree(missingFontScene),
      () => engine.renderToIR(missingFontScene),
      () => engine.renderToPng(missingFontScene),
      () => engine.compileLayoutTransition(transition),
    ];

    for (const action of actions) {
      expectFontUnavailable(captureFatal(action), ["RouteMissing"]);
    }
  });

  it("reports unregistered aliases from the fallback chain", () => {
    const error = renderError(engine, textCanvas("NotoSansJP-typo", ["AlsoMissing"]));
    expectFontUnavailable(error, ["NotoSansJP-typo", "AlsoMissing"]);
  });

  it("does not preflight an unused missing fallback when the primary resolves", () => {
    expect(engine.renderToSvg(textCanvas("NotoSansJP", ["FallbackMissing"]))).toContain("<svg");
  });

  it("allows generic CSS families in a fallback chain", () => {
    expect(engine.renderToSvg(textCanvas("NotoSansJP", ["sans-serif"]))).toContain("<svg");
  });

  it.each([
    {
      name: "Inline",
      child: createElement("Inline", { font: "InlineMissing" }, "本文"),
      missingAlias: "InlineMissing",
    },
    {
      name: "InlineBox",
      child: createElement("InlineBox", { font: "InlineBoxMissing" }, "本文"),
      missingAlias: "InlineBoxMissing",
    },
    {
      name: "Rt",
      child: createElement("Ruby", {}, "本", createElement("Rt", { font: "RtMissing" }, "ほん")),
      missingAlias: "RtMissing",
    },
  ])("reports the first failing $name effective run", ({ child, missingAlias, name }) => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 200 },
      createElement("Text", { id: "rich-alias", font: "NotoSansJP", fontSizePx: 24 }, child),
    );

    const error = renderError(engine, vnode);
    expectFontUnavailable(error, [missingAlias], name === "Rt" ? 1 : 0, "rich-alias");
  });

  it("does not reject unused or fully overridden nested aliases", () => {
    const vnode = createElement(
      "Canvas",
      { width: 400, height: 200 },
      createElement(
        "Text",
        { id: "unused-alias", font: "NotoSansJP", fontSizePx: 24 },
        createElement("Inline", { font: "UnusedMissing" }),
        createElement(
          "Inline",
          { font: "OverriddenMissing" },
          createElement("Inline", { font: "NotoSansJP" }, "本文"),
        ),
      ),
    );

    expect(engine.renderToSvg(vnode)).toContain("<svg");
  });

  it("uses a registered Inline override instead of the parent font", () => {
    const render = (font: "NotoSansJP" | "JetBrainsMono") =>
      engine.renderToSvg(
        createElement(
          "Canvas",
          { width: 400, height: 200 },
          createElement(
            "Text",
            { font: "NotoSansJP", fontSizePx: 24 },
            createElement("Inline", { font }, "ABC"),
          ),
        ),
      );

    expect(render("JetBrainsMono")).not.toBe(render("NotoSansJP"));
  });

  it("renders normally when the primary alias is registered", () => {
    const svg = engine.renderToSvg(textCanvas("NotoSansJP"));
    expect(svg).toContain("<svg");
  });

  it("reports a generic-only chain through the Rust font authority", () => {
    const error = renderError(engine, textCanvas("sans-serif"));
    expect(error).toMatchObject({
      code: "TEXT_FONT_UNAVAILABLE",
      message: "No requested font is available for text layout.",
      stage: "text",
      context: {
        operation: "renderTextLayout",
        runIndex: 0,
        requestedAliases: ["sans-serif"],
        omittedAliasCount: 0,
        fontWeight: 400,
        fontStyle: "normal",
      },
    });
  });

  it("accepts aliases added later via registerFonts", () => {
    const error = renderError(engine, textCanvas("NotoSansJP-late"));
    expectFontUnavailable(error, ["NotoSansJP-late"]);

    engine.registerFonts([{ alias: "NotoSansJP-late", weight: 400, data: loadSubsetFont() }]);
    const svg = engine.renderToSvg(textCanvas("NotoSansJP-late"));
    expect(svg).toContain("<svg");
  });
});
