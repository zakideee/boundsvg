import { beforeAll, describe, expect, it } from "vitest";
import { createEngine, createEngineAsync } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import { createWasmEngineInstance } from "../../src/wasm/index.js";
import { engineOptionsFromHandle } from "../helpers/wasm-render-engine.js";
import { loadSubsetFont } from "../wasm/test-prerequisites.js";

beforeAll(async () => {
  await initNodeWasm();
});

function registrationOptions(path: string, font: string) {
  const geometry = {
    viewBox: { width: 20, height: 20 },
    root: { kind: "path" as const, d: path },
  };
  return {
    fonts: [{ alias: font, data: loadSubsetFont() }],
    geometries: [{ id: "shape", doc: geometry }],
    symbols: [{ id: "symbol", def: { geometry, elasticSegments: [] } }],
  };
}

function textScene(font: string) {
  return createElement(
    "Canvas",
    { width: 180, height: 80 },
    createElement("Text", { font, fontSizePx: 20 }, "監査"),
  );
}

function assetScene(type: "Shape" | "Symbol") {
  return createElement(
    "Canvas",
    { width: 80, height: 80 },
    type === "Shape"
      ? createElement("Shape", { geometryId: "shape", width: 40, height: 40, fill: "#2563eb" })
      : createElement("Symbol", { symbolId: "symbol", width: 40, height: 40, fill: "#2563eb" }),
  );
}

describe.each(["sync", "async"] as const)("%s Engine ownership", (mode) => {
  it("keeps two font, geometry and symbol configurations independent", async () => {
    const firstOptions = registrationOptions("M0 0H20V20H0Z", "FirstFont");
    const secondOptions = registrationOptions("M0 0L20 20H0Z", "SecondFont");
    const createConfiguredEngine = async (options: ReturnType<typeof registrationOptions>) => {
      if (mode === "async") {
        return createEngineAsync(options);
      }
      const handle = createWasmEngineInstance();
      const engine = createEngine(
        engineOptionsFromHandle(handle, {
          geometries: options.geometries,
          symbols: options.symbols,
          wasmHandle: handle,
          registerFontFn: (font) => handle.registerFont(font.data, font),
        }),
      );
      engine.registerFonts(options.fonts);
      return engine;
    };
    const [firstEngine, secondEngine] = await Promise.all([
      createConfiguredEngine(firstOptions),
      createConfiguredEngine(secondOptions),
    ]);
    try {
      expect(firstEngine).not.toBe(secondEngine);
      expect(firstEngine.renderToSvg(textScene("FirstFont"))).toContain("<svg");
      expect(secondEngine.renderToSvg(textScene("SecondFont"))).toContain("<svg");
      expect(() => firstEngine.renderToSvg(textScene("SecondFont"))).toThrowError(
        expect.objectContaining({ code: "TEXT_FONT_UNAVAILABLE", stage: "text" }),
      );
      expect(() => secondEngine.renderToSvg(textScene("FirstFont"))).toThrowError(
        expect.objectContaining({ code: "TEXT_FONT_UNAVAILABLE", stage: "text" }),
      );
      for (const type of ["Shape", "Symbol"] as const) {
        const scene = assetScene(type);
        const secondSvg = secondEngine.renderToSvg(scene);
        expect(firstEngine.renderToSvg(scene)).not.toBe(secondSvg);
        expect(secondEngine.renderToSvg(scene)).toBe(secondSvg);
      }
      const secondSvg = secondEngine.renderToSvg(textScene("SecondFont"));
      firstEngine.dispose();
      expect(secondEngine.renderToSvg(textScene("SecondFont"))).toBe(secondSvg);
      expect(() => firstEngine.renderToSvg(textScene("FirstFont"))).toThrow(/disposed/i);
      expect(secondEngine.renderToSvg(assetScene("Shape"))).toContain("<svg");
      expect(secondEngine.renderToSvg(assetScene("Symbol"))).toContain("<svg");
    } finally {
      firstEngine.dispose();
      secondEngine.dispose();
    }
  });
});

describe("compiled Engine ownership", () => {
  it("detaches snapshots and rejects a different Engine even with identical options", async () => {
    const [firstEngine, secondEngine] = await Promise.all([
      createEngineAsync({}),
      createEngineAsync({}),
    ]);
    try {
      const scene = createElement("Canvas", { width: 400, height: 300 });
      const { svg, ir } = firstEngine.renderToSvgAndIR(scene);
      const compiled = firstEngine.compile(scene);
      const snapshot = firstEngine.snapshotCompiledIR(compiled);
      snapshot.width = 1;
      expect(ir.width).toBe(400);
      expect(firstEngine.snapshotCompiledIR(compiled).width).toBe(400);
      expect(firstEngine.renderCompiledToSvg(compiled)).toBe(svg);
      expect(firstEngine.renderCompiledToPng(compiled)).toEqual(firstEngine.renderToPng(scene));
      expect(() => secondEngine.snapshotCompiledIR(compiled)).toThrowError(
        expect.objectContaining({ code: "COMPILED_SCENE_WRONG_ENGINE", stage: "engine" }),
      );
      expect(() => secondEngine.renderCompiledToSvg(compiled)).toThrowError(
        expect.objectContaining({ code: "COMPILED_SCENE_WRONG_ENGINE", stage: "engine" }),
      );
    } finally {
      firstEngine.dispose();
      secondEngine.dispose();
    }
  });
});
