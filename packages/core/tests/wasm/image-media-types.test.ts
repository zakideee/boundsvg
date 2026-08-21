/**
 * Which raster formats an Image's `mediaType` may declare. The rasterizer
 * decodes PNG, JPEG, GIF and WebP, so all four have to be expressible — a
 * caller holding WebP bytes should not need a type assertion to say so.
 * Fixtures come from the engine's own encoders, so they stay in step with
 * what it emits.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine, type EngineInput } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { ImageProps } from "../../src/vnode/types.js";
import { assertWasmPkgAvailable } from "./test-prerequisites.js";

const SIZE = 16;
const FILL = "#c0397b";

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function solidScene(background: string): EngineInput {
  return createElement("Canvas", { width: SIZE, height: SIZE, background });
}

function embeddedScene(src: Uint8Array, mediaType: ImageProps["mediaType"]): EngineInput {
  return createElement(
    "Canvas",
    { width: SIZE, height: SIZE },
    createElement("Image", { src, mediaType, width: SIZE, height: SIZE }),
  );
}

describe("Image mediaType raster formats", () => {
  let engine: Engine;
  let solidPng: Uint8Array;
  let blankPng: Uint8Array;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({});
    solidPng = engine.renderToPng(solidScene(FILL));
    blankPng = engine.renderToPng(createElement("Canvas", { width: SIZE, height: SIZE }));
  });

  const cases = [
    { mediaType: "image/png", encode: (): Uint8Array => engine.renderToPng(solidScene(FILL)) },
    { mediaType: "image/webp", encode: (): Uint8Array => engine.renderToWebp(solidScene(FILL)) },
    {
      mediaType: "image/gif",
      encode: (): Uint8Array =>
        engine.renderToAnimatedGif(solidScene(FILL), {
          timesMs: [0],
          frameDurationsMs: [100],
        }),
    },
  ] as const;

  for (const { mediaType, encode } of cases) {
    it(`rasterizes an embedded ${mediaType} buffer`, () => {
      const rendered = engine.renderToPng(embeddedScene(encode(), mediaType));
      // A format the rasterizer cannot decode is dropped with a warning
      // rather than an error, which would leave the canvas blank.
      expect(bytesEqual(rendered, blankPng)).toBe(false);
      expect(bytesEqual(rendered, solidPng)).toBe(true);
    });
  }
});
