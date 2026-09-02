import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { FatalError, type RecoverableError } from "../../src/errors.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "./test-prerequisites.js";

/**
 * Emit-hardening regressions, exercised through the real WASM render path.
 */
describe("emit hardening (render path)", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
  });

  it("warns that a referenced (non-embedded) Image src will not rasterize", () => {
    // The render pipeline performs no I/O: a URL or path src survives into the
    // SVG href but is dropped from the PNG. It used to do so with no warning.
    const warnings: RecoverableError[] = [];
    const vnode = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Image", {
        id: "img",
        src: "https://example.com/logo.png",
        width: 50,
        height: 50,
      }),
    );

    const svg = engine.renderToSvg(vnode, { onWarning: (warning) => warnings.push(warning) });

    expect(svg).toContain("https://example.com/logo.png");
    const notEmbedded = warnings.filter((warning) => warning.code === "IMAGE_SRC_NOT_EMBEDDED");
    expect(notEmbedded).toHaveLength(1);
    expect(notEmbedded[0]!.nodeId).toBe("img");
  });

  it("does not warn for an embedded data: URI src", () => {
    const warnings: RecoverableError[] = [];
    const vnode = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Image", {
        id: "img",
        src: "data:image/png;base64,iVBORw0KGgo=",
        width: 50,
        height: 50,
      }),
    );

    engine.renderToSvg(vnode, { onWarning: (warning) => warnings.push(warning) });

    expect(warnings.filter((warning) => warning.code === "IMAGE_SRC_NOT_EMBEDDED")).toHaveLength(0);
  });

  it("keeps overflow clipping when a node id contains reference-unsafe characters", () => {
    // The id lands inside clip-path="url(#...)": before the fix, a space or a
    // quote broke the reference and the clip was silently dropped, letting the
    // oversized child paint outside its parent.
    const pngHash = (nodeId: string, overflow: "clip" | "visible") =>
      createHash("sha256")
        .update(
          engine.renderToPng(
            createElement(
              "Canvas",
              { width: 60, height: 60 },
              createElement(
                "Box",
                { id: nodeId, width: 30, height: 30, overflow },
                createElement("Box", {
                  width: 60,
                  height: 60,
                  background: "#ff0000",
                }),
              ),
            ),
          ),
        )
        .digest("hex");

    const safeClipped = pngHash("plain-id", "clip");
    const unsafeClipped = pngHash(`weird "id" (x)`, "clip");
    const unsafeUnclipped = pngHash(`weird "id" (x)`, "visible");

    // The clip must still take effect (same pixels as the safe id) and must
    // differ from the unclipped render.
    expect(unsafeClipped).toBe(safeClipped);
    expect(unsafeClipped).not.toBe(unsafeUnclipped);
  });

  it("rejects a forged compiled scene before inspecting its canvas", () => {
    const compiled = engine.compile(
      createElement(
        "Canvas",
        { width: 100, height: 20 },
        createElement("Box", { width: 10, height: 10, background: "#000000" }),
      ),
    );
    const forged = { ...compiled, width: Number.NaN };

    for (const render of [
      () => Reflect.apply(engine.renderCompiledToSvg, engine, [forged]),
      () => Reflect.apply(engine.renderCompiledToPng, engine, [forged]),
    ]) {
      expect(render).toThrowError(
        expect.objectContaining({ code: "COMPILED_SCENE_INVALID", stage: "engine" }),
      );
    }
  });
});

describe("renderToSvg scale", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
  });

  it("multiplies the root width/height and keeps the viewBox", () => {
    // scale was accepted by the old shared options but never forwarded to the SVG
    // emitter, so it silently had no effect.
    const svg = engine.renderToSvg(
      createElement(
        "Canvas",
        { width: 240, height: 100 },
        createElement("Box", { width: 40, height: 40, background: "#000000" }),
      ),
      { scale: 1.5 },
    );

    expect(svg).toContain('width="360"');
    expect(svg).toContain('height="150"');
    expect(svg).toContain('viewBox="0 0 240 100"');
  });

  it("rejects a non-positive or non-finite scale", () => {
    const vnode = createElement(
      "Canvas",
      { width: 240, height: 100 },
      createElement("Box", { width: 40, height: 40, background: "#000000" }),
    );
    expect(() => engine.renderToSvg(vnode, { scale: 0 })).toThrow(FatalError);
    expect(() => engine.renderToSvg(vnode, { scale: Number.NaN })).toThrow(FatalError);
  });
});

describe("font closest-match through the render path", () => {
  it("renders an intermediate weight without losing text layout", async () => {
    // Only weight 400 is registered; requesting 500 used to fail the whole
    // render because the registry did exact-match lookup only, contradicting
    // the documented "closest weight wins" contract.
    const engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
    try {
      const svg = engine.renderToSvg(
        createElement(
          "Canvas",
          { width: 240, height: 80 },
          createElement(
            "Text",
            { font: "NotoSansJP", fontSizePx: 24, fontWeight: 500 },
            "五百の重さ",
          ),
        ),
      );
      expect(svg).toContain("<svg");
      expect(svg).toContain("data-boundsvg-text");
    } finally {
      engine.dispose();
    }
  });
});

describe("renderToTextOutlines transforms", () => {
  it("exposes the composed world transform on transformed text nodes", async () => {
    // The SVG output wraps the same paths in transform groups; the outline
    // result used to drop that information, so consumers placed glyphs at
    // the untransformed position.
    const engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
    try {
      const scene = (translate: boolean) =>
        createElement(
          "Canvas",
          { width: 300, height: 80 },
          createElement(
            "Text",
            {
              id: "t",
              font: "NotoSansJP",
              fontSizePx: 24,
              ...(translate ? { transform: { translateX: 120 } } : {}),
            },
            "Outline",
          ),
        );

      const plain = engine.renderToTextOutlines(scene(false));
      const moved = engine.renderToTextOutlines(scene(true));

      expect(plain[0]!.worldTransform).toBeUndefined();
      expect(moved[0]!.worldTransform).toMatchObject({ a: 1, b: 0, c: 0, d: 1, e: 120, f: 0 });
      // Path data itself stays identical (transform is metadata, as in SVG).
      expect(moved[0]!.paths[0]!.d).toBe(plain[0]!.paths[0]!.d);

      const nested = createElement(
        "Canvas",
        { width: 300, height: 80 },
        createElement(
          "Box",
          { width: 100, height: 40, transform: { scaleX: 2 } },
          createElement(
            "Text",
            {
              id: "nested",
              font: "NotoSansJP",
              fontSizePx: 24,
              transform: { translateX: 10 },
            },
            "Outline",
          ),
        ),
      );
      expect(engine.renderToTextOutlines(nested)[0]!.worldTransform).toMatchObject({
        a: 2,
        b: 0,
        c: 0,
        d: 1,
        e: 20,
        f: 0,
      });
    } finally {
      engine.dispose();
    }
  });
});

describe("textAlign", () => {
  it("centers and end-aligns lines within the allotted layout box", async () => {
    // textAlign was inert: the IR text bbox carried the MEASURED text width,
    // so `(bbox.w - lineWidth) / 2` was always 0 and every alignment rendered
    // identically to "start". The existing tests hand-built an IR whose bbox
    // was the layout box, so they never crossed the real pipeline.
    const engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
    try {
      const firstGlyphX = (align: "start" | "center" | "end"): number => {
        const svg = engine.renderToSvg(
          createElement(
            "Canvas",
            { width: 200, height: 50 },
            createElement(
              "Text",
              {
                font: "NotoSansJP",
                fontSizePx: 16,
                color: "#000000",
                width: 200,
                textAlign: align,
              },
              "中央",
            ),
          ),
        );
        const match = svg.match(/<path d="M([-\d.]+)/);
        expect(match, `no glyph path for ${align}`).not.toBeNull();
        return Number(match![1]);
      };

      const start = firstGlyphX("start");
      const center = firstGlyphX("center");
      const end = firstGlyphX("end");

      expect(center).toBeGreaterThan(start);
      expect(end).toBeGreaterThan(center);
      // 200px box, 32px of text: center starts at ~84, end at ~168.
      expect(center - start).toBeCloseTo(84, 0);
      expect(end - start).toBeCloseTo(168, 0);
    } finally {
      engine.dispose();
    }
  });

  it("keeps aligned glyphs inside the text bbox used by outlines and hit testing", async () => {
    const engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
    try {
      const vnode = createElement(
        "Canvas",
        { width: 200, height: 50 },
        createElement(
          "Text",
          {
            id: "aligned",
            font: "NotoSansJP",
            fontSizePx: 16,
            width: 200,
            height: 50,
            textAlign: "end",
          },
          "中央",
        ),
      );
      const compiled = engine.compile(vnode);
      const outlines = engine.renderToTextOutlines(vnode, { textPathMode: "glyphs" });
      const firstPath = outlines[0]?.paths[0];
      expect(outlines[0]?.bbox.x).toBeCloseTo(168, 4);
      expect(outlines[0]?.bbox.w).toBeCloseTo(32, 4);
      expect(firstPath?.bbox.x).toBeGreaterThan(160);
      expect(
        engine.hitTest(
          engine.snapshotCompiledIR(compiled),
          firstPath?.bbox.x ?? 0,
          firstPath?.bbox.y ?? 0,
        ),
      ).toBe("aligned");
    } finally {
      engine.dispose();
    }
  });

  it("places vertical-rl columns from the allotted box's right edge", async () => {
    const engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
    try {
      const vnode = createElement(
        "Canvas",
        { width: 200, height: 200 },
        createElement(
          "Text",
          {
            font: "NotoSansJP",
            fontSizePx: 16,
            width: 200,
            height: 200,
            writingMode: "vertical-rl",
            textAlign: "center",
          },
          "中央",
        ),
      );
      const paths = engine.renderToTextOutlines(vnode, { textPathMode: "glyphs" })[0]?.paths ?? [];
      expect(Math.min(...paths.map((path) => path.bbox.x))).toBeGreaterThan(180);
      expect(Math.min(...paths.map((path) => path.bbox.y))).toBeGreaterThan(70);
    } finally {
      engine.dispose();
    }
  });
});
