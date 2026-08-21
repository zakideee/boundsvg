import { beforeAll, describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

/** RIFF container header: "RIFF" + u32 payload length + "WEBP" + first chunk id. */
function readWebpChunkIds(bytes: Uint8Array): { riff: string; form: string; firstChunk: string } {
  const decoder = new TextDecoder();
  return {
    riff: decoder.decode(bytes.subarray(0, 4)),
    form: decoder.decode(bytes.subarray(8, 12)),
    firstChunk: decoder.decode(bytes.subarray(12, 16)),
  };
}

/**
 * Read the canvas size the encoder actually recorded, straight out of the
 * VP8L bitstream header: a 0x2f signature byte, then 14 bits of `width - 1`
 * and 14 bits of `height - 1`, packed LSB-first. Byte 20 is the first payload
 * byte (12 RIFF/WEBP bytes + 8 bytes of "VP8L" chunk header).
 */
function readVp8lCanvasSize(bytes: Uint8Array): { width: number; height: number } {
  expect(bytes[20], "VP8L signature byte").toBe(0x2f);
  const header = new DataView(bytes.buffer, bytes.byteOffset + 21, 4).getUint32(0, true);
  return {
    width: (header & 0x3fff) + 1,
    height: ((header >>> 14) & 0x3fff) + 1,
  };
}

function createCard(): ReturnType<typeof createElement> {
  return createElement(
    "Canvas",
    { width: 200, height: 120, background: "#0f172a" },
    createElement("Text", { font: "NotoSansJP", fontSizePx: 24, color: "#ffffff" }, "WebP output"),
  );
}

describe("renderToWebp", () => {
  let handle: WasmEngineHandle;
  let encodeWebp: NonNullable<ReturnType<WasmEngineHandle["createSvgToWebpFn"]>>;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
    const created = handle.createSvgToWebpFn();
    // A WASM build without the export would make every assertion below vacuous.
    expect(created, "WASM build must expose svg_to_webp_with_options").toBeDefined();
    if (!created) {
      throw new Error("unreachable");
    }
    encodeWebp = created;
  });

  it("emits a lossless VP8L WebP at the canvas size", () => {
    const engine = createEngineFromHandle(handle, { svgToWebpFn: encodeWebp });

    const webp = engine.renderToWebp(createCard());

    expect(readWebpChunkIds(webp)).toEqual({ riff: "RIFF", form: "WEBP", firstChunk: "VP8L" });
    expect(readVp8lCanvasSize(webp)).toEqual({ width: 200, height: 120 });
  });

  it("produces identical bytes for identical input", () => {
    const engine = createEngineFromHandle(handle, { svgToWebpFn: encodeWebp });

    const first = engine.renderToWebp(createCard());
    const second = engine.renderToWebp(createCard());

    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it("applies scale through the same raster path as PNG", () => {
    const engine = createEngineFromHandle(handle, { svgToWebpFn: encodeWebp });

    const doubled = engine.renderToWebp(createCard(), { scale: 2 });

    expect(readVp8lCanvasSize(doubled)).toEqual({ width: 400, height: 240 });
  });

  it("auto-adjusts an oversized scale down to the raster cap", () => {
    const engine = createEngineFromHandle(handle, { svgToWebpFn: encodeWebp });
    const wide = createElement("Canvas", { width: 2000, height: 500 });

    const webp = engine.renderToWebp(wide, { scale: 4 });

    // The 3840 px long-edge cap clamps 4x down to 1.92x.
    expect(readVp8lCanvasSize(webp)).toEqual({ width: 3840, height: 960 });
  });

  it("honors rasterOversizeBehavior: error", () => {
    const engine = createEngineFromHandle(handle, { svgToWebpFn: encodeWebp });
    const oversized = createElement("Canvas", { width: 3000, height: 2000 });

    try {
      engine.renderToWebp(oversized, { scale: 2, rasterOversizeBehavior: "error" });
      expect.unreachable("oversized WebP render must fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FatalError);
      expect((error as FatalError).code).toBe("PNG_PIXEL_LIMIT");
    }
  });

  it("forwards rasterBackground to the encoder", () => {
    const captured: Array<{ background?: string } | undefined> = [];
    const engine = createEngineFromHandle(handle, {
      svgToWebpFn: (svg, options) => {
        captured.push(options);
        return encodeWebp(svg, options);
      },
    });
    const transparent = createElement("Canvas", { width: 40, height: 20 });

    const withBackground = engine.renderToWebp(transparent, { rasterBackground: "#ff00ff" });
    const withoutBackground = engine.renderToWebp(transparent);

    expect(captured[0]?.background).toBe("#ff00ff");
    expect(captured[1]?.background).toBeUndefined();
    // An opaque magenta fill and an empty transparent canvas cannot encode to
    // the same bytes, so the option reaches the encoder and not just the DTO.
    expect(Array.from(withBackground)).not.toEqual(Array.from(withoutBackground));
  });

  it("reports WEBP_NO_ENCODER when the engine has no WebP encoder wired", () => {
    const engine = createEngineFromHandle(handle);

    try {
      engine.renderToWebp(createCard());
      expect.unreachable("renderToWebp must fail without an encoder");
    } catch (error) {
      expect(error).toBeInstanceOf(FatalError);
      expect((error as FatalError).code).toBe("WEBP_NO_ENCODER");
    }
  });
});
