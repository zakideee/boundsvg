import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "./test-prerequisites.js";

/**
 * Regressions exercised through the real WASM engine (the mock
 * validator used by the unit tests never crossed the wasm-bindgen `this`
 * boundary, so a detached-method bug made every real validation "skipped").
 */
describe("layered composition validation via real WASM", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
  });

  it("actually runs (not skipped) and passes for an opaque scene", () => {
    const result = engine.renderToLayeredSvg(
      createElement(
        "Canvas",
        { width: 100, height: 100, background: "#ffffff" },
        createElement("Box", {
          id: "a",
          layer: "back",
          position: "absolute",
          left: 0,
          top: 0,
          width: 60,
          height: 60,
          background: "#ff0000",
        }),
        createElement("Box", {
          id: "b",
          layer: "front",
          position: "absolute",
          left: 30,
          top: 30,
          width: 60,
          height: 60,
          background: "#0000ff",
        }),
      ),
      { validateComposition: { enabled: true } },
    );

    expect(result.compositionValidation?.status).toBe("passed");
  });

  it("tolerates 1-LSB quantization on translucent layers", () => {
    // Re-compositing quantized 8-bit layers legitimately differs from the
    // single-pass render by one LSB; that must not be reported as a mismatch.
    const result = engine.renderToLayeredSvg(
      createElement(
        "Canvas",
        { width: 40, height: 40, background: "#ff0000" },
        createElement("Box", {
          id: "translucent",
          layer: "top",
          position: "absolute",
          left: 0,
          top: 0,
          width: 40,
          height: 40,
          background: "#0000ff",
          opacity: 0.5,
        }),
      ),
      { validateComposition: { enabled: true } },
    );

    expect(result.compositionValidation?.status).toBe("passed");
  });

  it("passes when a drawing layer also contains a non-drawing atomic fragment", () => {
    const result = engine.renderToLayeredSvg(
      createElement(
        "Canvas",
        { width: 100, height: 100 },
        createElement("Box", {
          id: "base",
          layer: "base",
          position: "absolute",
          left: 0,
          top: 0,
          width: 100,
          height: 100,
          background: "#0000ff",
        }),
        createElement("Box", {
          id: "back",
          layer: "back",
          position: "absolute",
          left: 0,
          top: 0,
          width: 100,
          height: 100,
          background: "#00ff00",
        }),
        createElement("Box", {
          id: "empty-front",
          layer: "front",
          position: "absolute",
          left: 0,
          top: 0,
          width: 100,
          height: 100,
          overflow: "clip",
          borderRadius: 4,
        }),
        createElement("Box", {
          id: "drawn-front",
          layer: "front",
          position: "absolute",
          left: 0,
          top: 0,
          width: 100,
          height: 100,
          background: "#ff0000",
        }),
      ),
      { validateComposition: { enabled: true } },
    );

    expect(result.layers.map((layer) => layer.paintOrder)).toEqual([0, 1, 2]);
    expect(result.compositionValidation?.status).toBe("passed");
  });
});

describe("transformed shape part bboxes", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
      geometries: [
        {
          id: "two-part",
          doc: {
            viewBox: { width: 100, height: 100 },
            root: {
              kind: "group" as const,
              children: [
                { kind: "path" as const, nodeId: "left", d: "M0 0H50V100H0Z" },
                { kind: "path" as const, nodeId: "right", d: "M50 0H100V100H50Z" },
              ],
            },
          },
        },
      ],
    });
  });

  it("reports part bboxes in canvas coordinates, transforms applied", () => {
    const untransformed = engine.renderToLayeredSvg(
      createElement(
        "Canvas",
        { width: 200, height: 200 },
        createElement("Shape", {
          id: "s",
          layer: "only",
          geometryId: "two-part",
          width: 100,
          height: 100,
          fill: "#000000",
          emitPartIds: true,
        }),
      ),
    );
    const translated = engine.renderToLayeredSvg(
      createElement(
        "Canvas",
        { width: 200, height: 200 },
        createElement("Shape", {
          id: "s",
          layer: "only",
          geometryId: "two-part",
          width: 100,
          height: 100,
          fill: "#000000",
          emitPartIds: true,
          transform: { translateX: 50, translateY: 30 },
        }),
      ),
    );

    const partBBox = (result: typeof untransformed, partId: string) =>
      result.manifest.layers[0]?.parts?.find((part) => part.partId === partId)?.bbox;

    const base = partBBox(untransformed, "left");
    const moved = partBBox(translated, "left");
    expect(base).toBeDefined();
    expect(moved).toBeDefined();
    // The docs define parts[].bbox as canvas coordinates: the node transform
    // must shift the reported part bounds, not leave them at layout position.
    expect(moved!.x).toBeCloseTo(base!.x + 50, 1);
    expect(moved!.y).toBeCloseTo(base!.y + 30, 1);
  });
});
