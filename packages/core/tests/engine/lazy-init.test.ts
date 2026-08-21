import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  compileScene,
  dispose,
  init,
  isInitialized,
  renderCompiledToPng,
  renderCompiledToSvg,
  renderToSvg,
  renderToSvgAndIR,
} from "../../src/render.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createFontedWasmHandle, engineOptionsFromHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

describe("lazy init", () => {
  beforeEach(() => {
    dispose();
  });

  it("isInitialized returns false before init", () => {
    expect(isInitialized()).toBe(false);
  });

  it("renderToSvg throws if not initialized", () => {
    const vnode = createElement("Canvas", { width: 400, height: 300 });
    expect(() => renderToSvg(vnode)).toThrow("Engine not initialized");
  });

  it("init() makes isInitialized return true", () => {
    init(engineOptionsFromHandle(handle));
    expect(isInitialized()).toBe(true);
  });

  it("renderToSvg works after init", () => {
    init(engineOptionsFromHandle(handle));
    const vnode = createElement("Canvas", { width: 400, height: 300 });
    const svg = renderToSvg(vnode);
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox");
  });

  it("exposes default-engine compile and compiled render helpers", () => {
    init(engineOptionsFromHandle(handle, { svgToPngFn: () => new Uint8Array([0x89, 0x50]) }));
    const vnode = createElement("Canvas", { width: 400, height: 300 });

    const { svg, ir } = renderToSvgAndIR(vnode);
    const compiled = compileScene(vnode);

    expect(svg).toContain("<svg");
    expect(ir.width).toBe(400);
    expect(compiled.width).toBe(400);
    expect(renderCompiledToSvg(compiled)).toContain("<svg");
    expect(renderCompiledToPng(compiled)).toEqual(new Uint8Array([0x89, 0x50]));
  });

  it("double init is a no-op (no error)", () => {
    init(engineOptionsFromHandle(handle));
    init(engineOptionsFromHandle(handle)); // Should not throw
    expect(isInitialized()).toBe(true);
  });

  it("dispose resets initialization state", () => {
    init(engineOptionsFromHandle(handle));
    expect(isInitialized()).toBe(true);
    dispose();
    expect(isInitialized()).toBe(false);
  });

  it("can re-init after dispose", () => {
    init(engineOptionsFromHandle(handle));
    dispose();
    init(engineOptionsFromHandle(handle));
    expect(isInitialized()).toBe(true);
    const vnode = createElement("Canvas", { width: 400, height: 300 });
    expect(() => renderToSvg(vnode)).not.toThrow();
  });
});
