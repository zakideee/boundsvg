import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import type { CanvasSceneNode } from "../../src/scene/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

function createTestEngine(): Engine {
  return createEngineFromHandle(handle);
}

const simpleVNode = createElement(
  "Canvas",
  { width: 200, height: 100 },
  createElement("Box", { width: 50, height: 50, background: "#ff0000" }),
);

const simpleSceneNode: CanvasSceneNode = {
  type: "Canvas",
  width: 200,
  height: 100,
  children: [
    {
      type: "Box",
      width: 50,
      height: 50,
      background: "#ff0000",
      children: [],
    },
  ],
};

describe("Engine.compile()", () => {
  it("returns CompiledScene with ir, width, height", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(simpleVNode);
    expect(compiled.ir).toBeDefined();
    expect(compiled.ir.root).toBeDefined();
    expect(compiled.width).toBe(200);
    expect(compiled.height).toBe(100);
  });

  it("accepts SceneNode input", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(simpleSceneNode);
    expect(compiled.ir).toBeDefined();
    expect(compiled.width).toBe(200);
    expect(compiled.height).toBe(100);
  });

  it("supports skipValidation option", () => {
    const engine = createTestEngine();
    // Should not throw even though Box is not a valid root
    // (skipValidation bypasses the Canvas-root check)
    const boxNode = createElement("Box", { width: 100, height: 100 });
    const compiled = engine.compile(boxNode, { skipValidation: true });
    expect(compiled.ir).toBeDefined();
  });
});

describe("Engine.renderCompiledToSvg()", () => {
  it("produces SVG from CompiledScene", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(simpleVNode);
    const svg = engine.renderCompiledToSvg(compiled);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("200");
    expect(svg).toContain("100");
  });

  it("produces same SVG as renderToSvg", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(simpleVNode);
    const svgDirect = engine.renderToSvg(simpleVNode);
    const svgFromCompiled = engine.renderCompiledToSvg(compiled);
    expect(svgFromCompiled).toBe(svgDirect);
  });

  it("can render the same CompiledScene twice", () => {
    const engine = createTestEngine();
    const compiled = engine.compile(simpleVNode);
    const svg1 = engine.renderCompiledToSvg(compiled);
    const svg2 = engine.renderCompiledToSvg(compiled);
    expect(svg1).toBe(svg2);
  });
});

describe("Engine.renderCompiledToPng()", () => {
  it("throws when no svgToPngFn", () => {
    // createEngineFromHandle does not wire svgToPngFn by default
    const engine = createTestEngine();
    const compiled = engine.compile(simpleVNode);
    expect(() => engine.renderCompiledToPng(compiled)).toThrow(/svgToPngFn/);
  });

  it("rasterizes when svgToPngFn is provided", () => {
    const engine = createEngineFromHandle(handle, {
      svgToPngFn: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const compiled = engine.compile(simpleVNode);
    const png = engine.renderCompiledToPng(compiled);
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
  });

  it("does not mutate CompiledScene (immutability)", () => {
    const engine = createEngineFromHandle(handle, {
      svgToPngFn: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const compiled = engine.compile(simpleVNode);
    const warningsBefore = compiled.ir.warnings.length;

    // Render PNG twice — warnings must not accumulate in original IR
    engine.renderCompiledToPng(compiled);
    engine.renderCompiledToPng(compiled);
    expect(compiled.ir.warnings.length).toBe(warningsBefore);

    // SVG after PNG must produce the same output as SVG before PNG
    const svgBefore = engine.renderCompiledToSvg(compiled);
    engine.renderCompiledToPng(compiled);
    const svgAfter = engine.renderCompiledToSvg(compiled);
    expect(svgAfter).toBe(svgBefore);
  });
});

describe("compile with SceneNode", () => {
  it("renderToSvg with SceneNode matches VNode output", () => {
    const engine = createTestEngine();
    const svgFromVNode = engine.renderToSvg(simpleVNode);
    const svgFromScene = engine.renderToSvg(simpleSceneNode);
    expect(svgFromScene).toBe(svgFromVNode);
  });
});
