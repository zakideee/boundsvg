import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import {
  assertWasmPkgAvailable,
  loadJetBrainsMonoFont,
  loadSubsetFont,
} from "./test-prerequisites.js";

function textCanvas(font: string, text: string) {
  return createElement(
    "Canvas",
    { width: 400, height: 120 },
    createElement("Text", { font, fontSizePx: 24, color: "#000000" }, text),
  );
}

describe("Engine.registerFonts (post-creation registration)", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
  });

  it("renders with a font registered after engine creation", () => {
    engine.registerFonts([
      { alias: "JetBrainsMono", weight: 400, style: "normal", data: loadJetBrainsMonoFont() },
    ]);
    const svg = engine.renderToSvg(textCanvas("JetBrainsMono", "later"));
    expect(svg).toContain("<svg");
    expect(svg).toContain('data-boundsvg-text="later"');
  });

  it("throws on duplicate alias/weight/style registration", () => {
    expect(() =>
      engine.registerFonts([
        { alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() },
      ]),
    ).toThrow();
  });

  it("throws NO_FONT_REGISTRATION_API when the engine has no registration backend", async () => {
    const { Engine } = await import("../../src/engine.js");
    const bare = new Engine({ computeLayoutFn: () => "" });
    expect(() =>
      bare.registerFonts([
        { alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() },
      ]),
    ).toThrow("registerFonts is not available");
  });
});
