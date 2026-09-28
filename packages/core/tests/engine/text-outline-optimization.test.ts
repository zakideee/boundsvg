import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IRNode, IRTextNode } from "../../src/ir/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

function findTextNode(node: IRNode): IRTextNode | undefined {
  if (node.type === "text") {
    return node;
  }
  if (node.type === "group") {
    for (const child of node.children ?? []) {
      const textNode = findTextNode(child);
      if (textNode) {
        return textNode;
      }
    }
  }
  return undefined;
}

function scene() {
  return createElement(
    "Canvas",
    { width: 400, height: 120, background: "#ffffff" },
    createElement(
      "Text",
      { id: "sample", font: "NotoSansJP", fontSizePx: 24, color: "#000000", wrap: "none" },
      "Hello, Canvas!",
    ),
  );
}

function firstTextPath(svg: string): string {
  const path = svg.match(/<path d="([^"]+)"/)?.[1];
  if (!path) {
    throw new TypeError("Expected text path");
  }
  return path;
}

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

describe("text outline SVG serialization", () => {
  it("shortens emitted paths while preserving IR and text outlines", () => {
    const engine = createEngineFromHandle(handle);
    const input = scene();
    const { svg, ir } = engine.renderToSvgAndIR(input);
    const textNode = findTextNode(ir.root);
    const originalPath = textNode?.glyphPaths?.[0]?.d;
    expect(originalPath).toBeDefined();
    expect(originalPath).toMatch(/^M/);
    expect(firstTextPath(svg).length).toBeLessThan(originalPath!.length);
    expect(textNode?.glyphPaths?.[0]?.d).toBe(originalPath);
    expect(engine.renderToTextOutlines(input)[0]?.paths[0]?.d).toBe(originalPath);
    const compiled = engine.compile(input);
    expect(engine.renderCompiledToSvg(compiled)).toBe(svg);
    expect(engine.renderCompiledToTextOutlines(compiled)[0]?.paths[0]?.d).toBe(originalPath);
  });

  it("passes the shortened SVG to an injected PNG rasterizer", () => {
    let rasterInput = "";
    const engine = createEngineFromHandle(handle, {
      svgToPngFn: (svg) => {
        rasterInput = svg;
        return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      },
    });
    const input = scene();
    const svg = engine.renderToSvg(input);
    engine.renderToPng(input);
    expect(firstTextPath(rasterInput)).toBe(firstTextPath(svg));
  });

  it("uses the same shortened path in animated, compiled, frame, and layered SVG", () => {
    const engine = createEngineFromHandle(handle);
    const input = scene();
    const compiled = engine.compile(input);
    const path = firstTextPath(engine.renderToSvg(input));
    const animatedOptions = { playback: { mode: "independent" as const } };
    const outputs = [
      engine.renderToAnimatedSvg(input, animatedOptions),
      engine.renderToAnimatedSvgAndIR(input, animatedOptions).svg,
      engine.renderCompiledToAnimatedSvg(compiled, animatedOptions),
      ...[...engine.renderFrames(input, { format: "svg" as const, timesMs: [0] })].map(
        (frame) => frame.data,
      ),
      ...[...engine.renderCompiledFrames(compiled, { format: "svg" as const, timesMs: [0] })].map(
        (frame) => frame.data,
      ),
      ...engine
        .renderToLayeredSvg(input)
        .layers.map((layer) => layer.svg)
        .filter((svg) => svg.includes("data-boundsvg-text")),
    ];
    expect(outputs.length).toBeGreaterThan(5);
    for (const svg of outputs) {
      expect(firstTextPath(svg)).toBe(path);
    }
  });

  it("passes shortened paths through every raster entry", () => {
    const rasterSvgs: string[] = [];
    const pngRasterizer = handle.createSvgToPngFn();
    const webpRasterizer = handle.createSvgToWebpFn();
    const engine = createEngineFromHandle(handle, {
      svgToPngFn: (svg, options) => {
        rasterSvgs.push(svg);
        return pngRasterizer(svg, options);
      },
      svgToWebpFn: (svg, options) => {
        rasterSvgs.push(svg);
        return webpRasterizer(svg, options);
      },
      svgsToAnimatedWebpFn: (input) => {
        rasterSvgs.push(...input.frames.map((frame) => frame.svg));
        return new Uint8Array([1]);
      },
      svgsToAnimatedGifFn: (input) => {
        rasterSvgs.push(...input.frames.map((frame) => frame.svg));
        return new Uint8Array([1]);
      },
    });
    const input = scene();
    const compiled = engine.compile(input);
    const expectedPath = firstTextPath(engine.renderToSvg(input));
    engine.renderToPng(input);
    engine.renderCompiledToPng(compiled);
    engine.renderToWebp(input);
    engine.renderToAnimatedWebp(input, { durationMs: 100, fps: 10, iterations: 1 });
    engine.renderToAnimatedGif(input, { durationMs: 100, fps: 10, iterations: 1 });
    engine.renderToLayeredPng(input);
    [...engine.renderFrames(input, { format: "png", timesMs: [0] })];
    [...engine.renderCompiledFrames(compiled, { format: "png", timesMs: [0] })];
    const textRasterSvgs = rasterSvgs.filter((svg) => svg.includes("data-boundsvg-text"));
    expect(textRasterSvgs.length).toBeGreaterThanOrEqual(8);
    for (const svg of textRasterSvgs) {
      expect(firstTextPath(svg)).toBe(expectedPath);
    }
  });
});
