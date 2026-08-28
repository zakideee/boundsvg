import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine, OutputGenerator } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { AnimationEncodeInput, WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

const GENERATOR: OutputGenerator = {
  name: "@scope/aaaa",
  version: "1.2.3-beta.1",
};
const SOFTWARE = "@scope/aaaa/1.2.3-beta.1";
const decoder = new TextDecoder();

let handle: WasmEngineHandle;
let engine: Engine;

function staticScene() {
  return createElement(
    "Canvas",
    { width: 80, height: 40, background: "#ffffff" },
    createElement("Box", { width: 80, height: 40, background: "#2563eb" }),
  );
}

function animatedScene() {
  return createElement(
    "Canvas",
    { width: 80, height: 40, background: "#ffffff" },
    createElement("Box", {
      width: 80,
      height: 40,
      background: "#2563eb",
      animate: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 200,
      },
    }),
  );
}

function pngSoftware(bytes: Uint8Array): string | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const payloadLength = view.getUint32(offset);
    const chunkType = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + payloadLength;
    if (payloadEnd + 4 > bytes.length) {
      return undefined;
    }
    const payload = bytes.subarray(payloadStart, payloadEnd);
    if (chunkType === "iTXt" && decoder.decode(payload.subarray(0, 8)) === "Software") {
      return decoder.decode(payload.subarray(13));
    }
    offset = payloadEnd + 4;
  }
  return undefined;
}

function riffChunk(bytes: Uint8Array, expectedId: string): Uint8Array | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = decoder.decode(bytes.subarray(offset, offset + 4));
    const payloadLength = view.getUint32(offset + 4, true);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + payloadLength;
    if (payloadEnd > bytes.length) {
      return undefined;
    }
    if (chunkId === expectedId) {
      return bytes.subarray(payloadStart, payloadEnd);
    }
    offset = payloadEnd + (payloadLength % 2);
  }
  return undefined;
}

function countBytes(bytes: Uint8Array, expected: Uint8Array): number {
  let count = 0;
  for (let offset = 0; offset + expected.length <= bytes.length; offset += 1) {
    if (expected.every((byte, index) => bytes[offset + index] === byte)) {
      count += 1;
    }
  }
  return count;
}

beforeAll(async () => {
  handle = await createFontedWasmHandle();
  const svgToWebpFn = handle.createSvgToWebpFn();
  const svgsToAnimatedWebpFn = handle.createSvgsToAnimatedWebpFn();
  const svgsToAnimatedGifFn = handle.createSvgsToAnimatedGifFn();
  expect(svgToWebpFn).toBeDefined();
  expect(svgsToAnimatedWebpFn).toBeDefined();
  expect(svgsToAnimatedGifFn).toBeDefined();
  engine = createEngineFromHandle(handle, {
    svgToPngFn: handle.createSvgToPngFn(),
    ...(svgToWebpFn !== undefined && { svgToWebpFn }),
    ...(svgsToAnimatedWebpFn !== undefined && { svgsToAnimatedWebpFn }),
    ...(svgsToAnimatedGifFn !== undefined && { svgsToAnimatedGifFn }),
  });
});

afterAll(() => {
  handle.dispose();
});

describe("output generator metadata", () => {
  it("embeds the constrained identity in SVG, PNG, and still WebP", () => {
    const svg = engine.renderToSvg(staticScene(), { generator: GENERATOR });
    expect(svg).toContain(
      '<metadata data-boundsvg-generator="@scope/aaaa" data-boundsvg-generator-version="1.2.3-beta.1"/>',
    );
    expect(engine.renderToSvg(staticScene())).not.toContain("data-boundsvg-generator");

    const png = engine.renderToPng(staticScene(), { generator: GENERATOR });
    expect(pngSoftware(png)).toBe(SOFTWARE);
    expect(pngSoftware(engine.renderToPng(staticScene()))).toBeUndefined();

    const webp = engine.renderToWebp(staticScene(), { generator: GENERATOR });
    const xmp = riffChunk(webp, "XMP ");
    expect(xmp).toBeDefined();
    expect(decoder.decode(xmp)).toContain("<boundsvg:name>@scope/aaaa</boundsvg:name>");
    expect(riffChunk(engine.renderToWebp(staticScene()), "XMP ")).toBeUndefined();

    expect(engine.renderToSvg(staticScene(), { generator: GENERATOR })).toBe(svg);
    expect(engine.renderToPng(staticScene(), { generator: GENERATOR })).toEqual(png);
    expect(engine.renderToWebp(staticScene(), { generator: GENERATOR })).toEqual(webp);
  });

  it("writes metadata once on each completed animated container", () => {
    let capturedWebpInput: AnimationEncodeInput | undefined;
    const encodeWebp = handle.createSvgsToAnimatedWebpFn();
    const encodeGif = handle.createSvgsToAnimatedGifFn();
    expect(encodeWebp).toBeDefined();
    expect(encodeGif).toBeDefined();
    const capturingEngine = createEngineFromHandle(handle, {
      svgsToAnimatedWebpFn: (input) => {
        capturedWebpInput = input;
        if (!encodeWebp) {
          throw new TypeError("animated WebP encoder is unavailable");
        }
        return encodeWebp(input);
      },
      ...(encodeGif !== undefined && { svgsToAnimatedGifFn: encodeGif }),
    });

    const webp = capturingEngine.renderToAnimatedWebp(animatedScene(), {
      iterations: "infinite",
      durationMs: 200,
      fps: 10,
      generator: GENERATOR,
    });
    expect(capturedWebpInput?.options.generator).toEqual(GENERATOR);
    expect(
      capturedWebpInput?.frames.every((frame) => !frame.svg.includes("data-boundsvg-generator")),
    ).toBe(true);
    expect(countBytes(webp, new TextEncoder().encode("XMP "))).toBe(1);

    const gif = capturingEngine.renderToAnimatedGif(animatedScene(), {
      iterations: "infinite",
      durationMs: 200,
      fps: 10,
      generator: GENERATOR,
    });
    const comment = new TextEncoder().encode(
      'boundsvg-generator:{"name":"@scope/aaaa","version":"1.2.3-beta.1"}',
    );
    expect(countBytes(gif, comment)).toBe(1);
  });

  it("propagates through compiled, frame, and layered output entry points", () => {
    const compiled = engine.compile(staticScene());
    expect(engine.renderCompiledToSvg(compiled, { generator: GENERATOR })).toContain(
      'data-boundsvg-generator="@scope/aaaa"',
    );
    expect(pngSoftware(engine.renderCompiledToPng(compiled, { generator: GENERATOR }))).toBe(
      SOFTWARE,
    );

    const svgFrame = [
      ...engine.renderFrames(staticScene(), {
        timesMs: [0],
        format: "svg",
        generator: GENERATOR,
      }),
    ][0];
    expect(svgFrame?.format).toBe("svg");
    expect(svgFrame?.data).toContain('data-boundsvg-generator="@scope/aaaa"');
    const pngFrame = [
      ...engine.renderFrames(staticScene(), {
        timesMs: [0],
        format: "png",
        generator: GENERATOR,
      }),
    ][0];
    expect(pngFrame?.format).toBe("png");
    if (pngFrame?.format === "png") {
      expect(pngSoftware(pngFrame.data)).toBe(SOFTWARE);
    }

    const layeredScene = createElement(
      "Canvas",
      { width: 80, height: 40 },
      createElement("Box", {
        layer: "background",
        width: 80,
        height: 40,
        background: "#ffffff",
      }),
      createElement("Box", {
        layer: "content",
        width: 40,
        height: 20,
        background: "#2563eb",
      }),
    );
    const layeredSvg = engine.renderToLayeredSvg(layeredScene, { generator: GENERATOR });
    expect(layeredSvg.layers.length).toBeGreaterThan(0);
    expect(
      layeredSvg.layers.every((layer) =>
        layer.svg.includes('data-boundsvg-generator="@scope/aaaa"'),
      ),
    ).toBe(true);
    const layeredPng = engine.renderToLayeredPng(layeredScene, { generator: GENERATOR });
    expect(layeredPng.layers.length).toBeGreaterThan(0);
    expect(layeredPng.layers.every((layer) => pngSoftware(layer.png) === SOFTWARE)).toBe(true);
  });

  it("rejects freeform, hidden, and unknown generator fields", () => {
    const invalidName = { name: "aaaa\nignore", version: "1.0.0" };
    expect(() => engine.renderToSvg(staticScene(), { generator: invalidName })).toThrowError(
      expect.objectContaining({ code: "VALIDATION" }),
    );
    expect(() =>
      engine.renderToPng(staticScene(), {
        generator: { name: "aaaa", version: "１.０.０" },
      }),
    ).toThrowError(/generator\.version must start with an ASCII letter or digit/);

    const unknownField = {
      name: "aaaa",
      version: "1.0.0",
      requestId: "request-123",
    } as unknown as OutputGenerator;
    try {
      engine.renderToSvg(staticScene(), { generator: unknownField });
      expect.unreachable("unknown generator fields must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(FatalError);
    }
  });
});
