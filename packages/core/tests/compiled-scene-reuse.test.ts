/**
 * Contract test: compile-once → render-many is stable.
 *
 * `CompiledScene` is a public, reusable artifact. Emitting from the same
 * compiled scene repeatedly — including across the PNG path, which emits with
 * rasterizer-compat options — must never change the SVG bytes. A failure here
 * means emit mutated the compiled IR (the clone-before-emit contract broke).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../src/engine.js";
import { createElement } from "../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "./helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

function createTestEngine(): Engine {
  return createEngineFromHandle(handle, {
    svgToPngFn: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  });
}

// The URL-string image is deliberate: it produces an IMAGE_SRC_NOT_EMBEDDED
// warning at compile time, so the warning-accumulation assertion below starts
// from a non-empty warnings array instead of vacuously comparing 0 to 0.
const scene = createElement(
  "Canvas",
  { width: 320, height: 180 },
  createElement("Box", { width: 320, height: 90, background: "#336699" }),
  createElement("Image", {
    src: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mediaType: "image/png",
    width: 64,
    height: 64,
  }),
  createElement("Image", {
    src: "https://example.test/remote.png",
    width: 64,
    height: 64,
  }),
);

describe("CompiledScene reuse", () => {
  it("emits byte-identical SVG from the same CompiledScene twice", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(scene);

    const firstSvg = engine.renderCompiledToSvg(compiled);
    const secondSvg = engine.renderCompiledToSvg(compiled);

    expect(secondSvg).toBe(firstSvg);
  });

  it("matches the single-shot renderToSvg output", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(scene);

    expect(engine.renderCompiledToSvg(compiled)).toBe(engine.renderToSvg(scene));
  });

  it("keeps SVG output stable after rendering PNG from the same CompiledScene", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(scene);

    const svgBefore = engine.renderCompiledToSvg(compiled);
    engine.renderCompiledToPng(compiled);
    engine.renderCompiledToPng(compiled);
    const svgAfter = engine.renderCompiledToSvg(compiled);

    expect(svgAfter).toBe(svgBefore);
  });

  it("does not accumulate warnings in the compiled IR across renders", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(scene);
    const warningCount = compiled.ir.warnings.length;
    expect(warningCount).toBeGreaterThan(0);

    engine.renderCompiledToSvg(compiled);
    engine.renderCompiledToPng(compiled);
    engine.renderCompiledToSvg(compiled);

    expect(compiled.ir.warnings.length).toBe(warningCount);
  });
});
