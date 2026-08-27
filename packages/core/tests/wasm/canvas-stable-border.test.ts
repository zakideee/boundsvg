import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { AnimationSpec, StrokeScaling, VNode } from "../../src/vnode/types.js";
import { createWasmEngineInstance, type WasmEngineHandle } from "../../src/wasm/index.js";
import { assertWasmPkgAvailable } from "./test-prerequisites.js";

const CANVAS_SIZE = 64;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableBorderScene(
  options: {
    cameraScale?: number;
    cameraScaleY?: number;
    strokeScaling?: StrokeScaling;
    animation?: AnimationSpec;
    dasharray?: string;
    layer?: string;
  } = {},
): VNode {
  const cameraScale = options.cameraScale ?? 1;
  return createElement(
    "Canvas",
    { width: CANVAS_SIZE, height: CANVAS_SIZE },
    createElement(
      "Box",
      {
        id: "camera",
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        transform: {
          scaleX: cameraScale,
          scaleY: options.cameraScaleY ?? cameraScale,
          originX: 0,
          originY: 0,
        },
        animate: options.animation,
      },
      createElement("Box", {
        id: "hairline",
        layer: options.layer,
        position: "absolute",
        left: 10,
        top: 10,
        width: 20,
        height: 20,
        borderWidth: 1,
        borderColor: "#ffffff",
        strokeScaling: options.strokeScaling,
        strokeDasharray: options.dasharray,
      }),
    ),
  );
}

function defaultPathStrokeScene(cameraScale = 1.6): VNode {
  return createElement(
    "Canvas",
    { width: CANVAS_SIZE, height: CANVAS_SIZE },
    createElement(
      "Box",
      {
        id: "camera",
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        transform: {
          scaleX: cameraScale,
          scaleY: cameraScale,
          originX: 0,
          originY: 0,
        },
      },
      createElement("Path", {
        id: "legacy-path",
        position: "absolute",
        left: 10,
        top: 10,
        width: 20,
        height: 20,
        d: "M1 1H19V19H1Z",
        fill: "none",
        stroke: "#ffffff",
        strokeWidth: 1,
      }),
    ),
  );
}

function stablePathStrokeScene(
  options: {
    cameraScale?: number;
    cameraScaleY?: number;
    strokeScaling?: StrokeScaling;
    animation?: AnimationSpec;
    dasharray?: string;
    layer?: string;
    omitStrokeWidth?: boolean;
  } = {},
): VNode {
  const cameraScale = options.cameraScale ?? 1;
  return createElement(
    "Canvas",
    { width: CANVAS_SIZE, height: CANVAS_SIZE },
    createElement(
      "Box",
      {
        id: "path-camera",
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        transform: {
          scaleX: cameraScale,
          scaleY: options.cameraScaleY ?? cameraScale,
          originX: 0,
          originY: 0,
        },
        animate: options.animation,
      },
      createElement("Path", {
        id: "hairline-path",
        layer: options.layer,
        position: "absolute",
        left: 8,
        top: 8,
        width: 20,
        height: 20,
        d: "M2 2H18V18H2Z",
        fill: "none",
        stroke: "#ffffff",
        strokeWidth: options.omitStrokeWidth ? undefined : 1,
        strokeScaling: options.strokeScaling,
        strokeDasharray: options.dasharray,
      }),
    ),
  );
}

function animatedPathStrokeScene(endScale = 1): VNode {
  return stablePathStrokeScene({
    strokeScaling: "canvas",
    animation: {
      keyframes: [
        { at: 0, transform: { scaleX: 1.6, scaleY: 1.6 } },
        { at: 1, transform: { scaleX: endScale, scaleY: endScale } },
      ],
      durationMs: 100,
      easing: "linear",
      fill: "both",
    },
  });
}

function animatedCameraScene(endScale = 1): VNode {
  return stableBorderScene({
    strokeScaling: "canvas",
    animation: {
      keyframes: [
        { at: 0, transform: { scaleX: 1.6, scaleY: 1.6 } },
        { at: 1, transform: { scaleX: endScale, scaleY: endScale } },
      ],
      durationMs: 100,
      easing: "linear",
      fill: "both",
    },
  });
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function readRgbaPngPayload(png: Uint8Array): {
  width: number;
  height: number;
  filtered: Uint8Array;
} {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idatChunks: Uint8Array[] = [];
  while (offset < png.length) {
    const length = readU32(png, offset);
    const type = String.fromCharCode(...png.slice(offset + 4, offset + 8));
    const payload = png.slice(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = readU32(payload, 0);
      height = readU32(payload, 4);
      expect(payload[8]).toBe(8);
      expect(payload[9]).toBe(6);
      expect(payload[12]).toBe(0);
    } else if (type === "IDAT") {
      idatChunks.push(payload);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  const compressed = Buffer.concat(idatChunks.map((chunk) => Buffer.from(chunk)));
  return { width, height, filtered: inflateSync(compressed) };
}

function reconstructFilteredByte(
  filter: number,
  raw: number,
  left: number,
  up: number,
  upperLeft: number,
): number {
  if (filter === 0) {
    return raw;
  }
  if (filter === 1) {
    return raw + left;
  }
  if (filter === 2) {
    return raw + up;
  }
  if (filter === 3) {
    return raw + Math.floor((left + up) / 2);
  }
  return raw + paeth(left, up, upperLeft);
}

function unfilterRgba(filtered: Uint8Array, width: number, height: number): Uint8Array {
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const rgba = new Uint8Array(width * height * bytesPerPixel);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset] ?? 0;
    expect(filter).toBeLessThanOrEqual(4);
    sourceOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset + x] ?? 0;
      const destination = y * stride + x;
      const left = x >= bytesPerPixel ? (rgba[destination - bytesPerPixel] ?? 0) : 0;
      const up = y > 0 ? (rgba[destination - stride] ?? 0) : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? (rgba[destination - stride - 4] ?? 0) : 0;
      const reconstructed = reconstructFilteredByte(filter, raw, left, up, upperLeft);
      rgba[destination] = reconstructed & 0xff;
    }
    sourceOffset += stride;
  }
  return rgba;
}

function decodeRgbaPng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const { width, height, filtered } = readRgbaPngPayload(png);
  const rgba = unfilterRgba(filtered, width, height);
  return { width, height, rgba };
}

function alphaEnergyAtColumn(png: Uint8Array, x: number): number {
  const { width, height, rgba } = decodeRgbaPng(png);
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x).toBeLessThan(width);
  let energy = 0;
  for (let y = 0; y < height; y += 1) {
    energy += rgba[(y * width + x) * 4 + 3] ?? 0;
  }
  return energy;
}

function alphaCoverageWidthAtColumn(png: Uint8Array, x: number, edgeY: number): number {
  const { width, height, rgba } = decodeRgbaPng(png);
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x).toBeLessThan(width);
  let coverageWidth = 0;
  const startY = Math.max(0, edgeY - 4);
  const endY = Math.min(height - 1, edgeY + 4);
  for (let y = startY; y <= endY; y += 1) {
    if ((rgba[(y * width + x) * 4 + 3] ?? 0) > 0) {
      coverageWidth += 1;
    }
  }
  return coverageWidth;
}

function expectStructuredFatal(
  operation: () => unknown,
  code: string,
  nodeId: string,
  stage: string,
): void {
  expect(operation).toThrowError(expect.objectContaining({ code, nodeId, stage }));
}

describe("canvas-stable Box and Path strokes through the real WASM pipeline", () => {
  let engine: Engine;
  let rasterHandle: WasmEngineHandle;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({});
    rasterHandle = createWasmEngineInstance();
  });

  afterAll(() => {
    engine.dispose();
    rasterHandle.dispose();
  });

  it("keeps omitted and explicit transform behavior byte-identical", () => {
    const omitted = stableBorderScene();
    const explicit = stableBorderScene({ strokeScaling: "transform" });
    expect(engine.renderToIR(explicit)).toEqual(engine.renderToIR(omitted));
    expect(engine.renderToSvg(explicit)).toBe(engine.renderToSvg(omitted));
    expect(engine.renderToPng(explicit)).toEqual(engine.renderToPng(omitted));
  });

  it("pins the default (transform-scaled) Box IR, SVG, and raster bytes", () => {
    const scene = stableBorderScene({ cameraScale: 1.6 });
    expect(sha256(JSON.stringify(engine.renderToIR(scene)))).toBe(
      "1b045b36d56804c7a49db6084e7455291043991ca4788549cded9ddf5e9863bd",
    );
    expect(sha256(engine.renderToSvg(scene))).toBe(
      "0aa79ec55986b6ba5848ce18f7734a37a45bdff08e675bf36ef9ebc5b5678f6d",
    );
    expect(sha256(engine.renderToPng(scene))).toBe(
      "0b273664c740ebda319299728ece0823f70b3d44c777d729420138f301ddb691",
    );
  });

  it("pins the default (transform-scaled) Path IR, SVG, and raster bytes", () => {
    const scene = defaultPathStrokeScene();
    expect(sha256(JSON.stringify(engine.renderToIR(scene)))).toBe(
      "499348200d6ee4766536226a8faf4912ad481f92d0863674321230802e08763e",
    );
    expect(sha256(engine.renderToSvg(scene))).toBe(
      "1294132c71639e75137912b10e4afb16774941dea23a75a0b1654be8855e6dc1",
    );
    expect(sha256(engine.renderToPng(scene))).toBe(
      "e47f5e4a952eec010cb456817db464a81beca8f7c8b566776d03da6b765883fe",
    );
  });

  it("uses camera scale for fallback but reserves output scale for resolution", () => {
    const svg = engine.renderToSvg(
      stableBorderScene({ cameraScale: 1.6, strokeScaling: "canvas" }),
      { scale: 2 },
    );
    expect(svg).toContain('width="128" height="128"');
    expect(svg).toContain('class="bsvg-vstroke-hairline"');
    expect(svg).toContain('stroke-width="0.625"');
    expect(svg).toContain("stroke-width: 2;");
    expect(svg).toContain("vector-effect: non-scaling-stroke;");

    const shrunkSvg = engine.renderToSvg(
      stableBorderScene({ cameraScale: 0.5, strokeScaling: "canvas" }),
    );
    expect(shrunkSvg).toContain('stroke-width="2"');
  });

  it("composes nested authored rotation and similarity scales", () => {
    const scene = createElement(
      "Canvas",
      { width: 96, height: 64 },
      createElement(
        "Box",
        {
          id: "outer",
          width: 96,
          height: 64,
          transform: { scaleX: 2, scaleY: 2, originX: 0, originY: 0 },
        },
        createElement(
          "Box",
          {
            id: "rotated",
            width: 48,
            height: 32,
            transform: { rotateDeg: 30, scaleX: 1.5, scaleY: 1.5 },
          },
          createElement("Box", {
            id: "hairline",
            width: 20,
            height: 10,
            borderWidth: 1,
            borderColor: "#fff",
            strokeScaling: "canvas",
          }),
        ),
      ),
    );
    expect(engine.renderToSvg(scene)).toContain('stroke-width="0.333333"');
  });

  it("samples animation fallback widths at start, middle, and end", () => {
    const scene = animatedCameraScene();
    const frames = [...engine.renderFrames(scene, { timesMs: [0, 50, 100], format: "svg" })];
    expect(
      frames.map((frame) =>
        frame.format === "svg" ? frame.data.match(/stroke-width="([^"]+)"/)?.[1] : undefined,
      ),
    ).toEqual(["0.625", "0.769231", "1"]);
    for (const [timeMs, expectedWidth] of [
      [0, "0.625"],
      [50, "0.769231"],
      [100, "1"],
    ] as const) {
      const svg = engine.renderToSvg(scene, { timeMs });
      expect(svg).toContain(`stroke-width="${expectedWidth}"`);
      expect(svg).toContain("vector-effect: non-scaling-stroke");
    }
  });

  it("keeps declarative SVG and static PNG on the same sampled base pose", () => {
    const scene = animatedCameraScene();
    for (const timeMs of [0, 50, 100]) {
      const declarativeSvg = engine.renderToAnimatedSvg(scene, {
        playback: { mode: "independent" },
        timeMs,
      });
      const rasterizedDeclarative = rasterHandle.createSvgToPngFn()(declarativeSvg);
      expect(rasterizedDeclarative).toEqual(engine.renderToPng(scene, { timeMs }));
    }
  });

  it("keeps canvas-space alpha energy stable and applies final raster scale once", () => {
    const unit = engine.renderToPng(stableBorderScene({ cameraScale: 1, strokeScaling: "canvas" }));
    const shrunk = engine.renderToPng(
      stableBorderScene({ cameraScale: 0.5, strokeScaling: "canvas" }),
    );
    const zoomed = engine.renderToPng(
      stableBorderScene({ cameraScale: 1.6, strokeScaling: "canvas" }),
    );
    const transformScaled = engine.renderToPng(
      stableBorderScene({ cameraScale: 1.6, strokeScaling: "transform" }),
    );
    const highResolution = engine.renderToPng(
      stableBorderScene({ cameraScale: 1.6, strokeScaling: "canvas" }),
      { scale: 2 },
    );

    const unitEnergy = alphaEnergyAtColumn(unit, 20);
    const shrunkEnergy = alphaEnergyAtColumn(shrunk, 10);
    const zoomedEnergy = alphaEnergyAtColumn(zoomed, 32);
    const transformEnergy = alphaEnergyAtColumn(transformScaled, 32);
    const highResolutionEnergy = alphaEnergyAtColumn(highResolution, 64);
    expect(Math.abs(shrunkEnergy - unitEnergy)).toBeLessThanOrEqual(8);
    expect(alphaCoverageWidthAtColumn(shrunk, 10, 5)).toBe(
      alphaCoverageWidthAtColumn(unit, 20, 10),
    );
    expect(Math.abs(zoomedEnergy - unitEnergy)).toBeLessThanOrEqual(8);
    expect(alphaCoverageWidthAtColumn(zoomed, 32, 16)).toBe(
      alphaCoverageWidthAtColumn(unit, 20, 10),
    );
    expect(transformEnergy).toBeGreaterThan(zoomedEnergy * 1.35);
    expect(Math.abs(highResolutionEnergy - unitEnergy * 2)).toBeLessThanOrEqual(16);
  });

  it("encodes WebP, animated WebP, GIF, and PNG containers from canvas-stable frames", () => {
    const scene = animatedCameraScene();
    const webp = engine.renderToWebp(scene, { timeMs: 50 });
    const animatedWebp = engine.renderToAnimatedWebp(scene, {
      iterations: "infinite",
      timesMs: [0, 50, 100],
      frameDurationsMs: [50, 50, 50],
    });
    const gif = engine.renderToAnimatedGif(scene, {
      iterations: "infinite",
      timesMs: [0, 50, 100],
      frameDurationsMs: [50, 50, 50],
    });
    const pngFrames = [...engine.renderFrames(scene, { timesMs: [0, 50, 100], format: "png" })];

    expect(String.fromCharCode(...webp.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...animatedWebp.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...gif.slice(0, 6))).toMatch(/^GIF8[79]a$/);
    expect(pngFrames).toHaveLength(3);
    expect(pngFrames.every((frame) => frame.data.length > 100)).toBe(true);
  });

  it("preserves ancestor transforms and bbox semantics in layered SVG and PNG", () => {
    const canvasScene = stableBorderScene({
      cameraScale: 1.6,
      strokeScaling: "canvas",
      layer: "hairline",
    });
    const transformScene = stableBorderScene({
      cameraScale: 1.6,
      strokeScaling: "transform",
      layer: "hairline",
    });
    const layered = engine.renderToLayeredSvg(canvasScene, {
      validateComposition: { enabled: true },
    });
    const baseline = engine.renderToLayeredSvg(transformScene, {});
    const png = engine.renderToLayeredPng(canvasScene, {
      validateComposition: { enabled: true },
    });

    expect(layered.layers[0]?.svg).toContain("scale(1.6 1.6)");
    expect(layered.layers[0]?.svg).toContain('stroke-width="0.625"');
    expect(layered.compositionValidation?.status).toBe("passed");
    expect(layered.manifest.layers[0]?.bbox).toEqual(baseline.manifest.layers[0]?.bbox);
    expect(png.layers[0]?.png.length).toBeGreaterThan(100);
    expect(png.compositionValidation?.status).toBe("passed");
  });

  it("rejects non-uniform transforms, axis mirrors, unsafe keyframes, and dasharrays", () => {
    expectStructuredFatal(
      () =>
        engine.renderToSvg(
          stableBorderScene({ cameraScale: 2, cameraScaleY: 1, strokeScaling: "canvas" }),
        ),
      "CANVAS_STROKE_UNSUPPORTED_TRANSFORM",
      "hairline",
      "emit",
    );
    expectStructuredFatal(
      () =>
        engine.renderToSvg(
          stableBorderScene({ cameraScale: -1, cameraScaleY: 1, strokeScaling: "canvas" }),
        ),
      "CANVAS_STROKE_UNSUPPORTED_TRANSFORM",
      "hairline",
      "emit",
    );
    expectStructuredFatal(
      () =>
        engine.renderToSvg(
          stableBorderScene({
            strokeScaling: "canvas",
            animation: {
              keyframes: [
                { at: 0, transform: { scaleX: 1, scaleY: 1 } },
                { at: 1, transform: { scaleX: 2, scaleY: 1 } },
              ],
              durationMs: 100,
            },
          }),
          { timeMs: 0 },
        ),
      "CANVAS_STROKE_UNSUPPORTED_TRANSFORM",
      "hairline",
      "emit",
    );
    expectStructuredFatal(
      () => engine.renderToSvg(stableBorderScene({ strokeScaling: "canvas", dasharray: "4,2" })),
      "CANVAS_STROKE_DASH_UNSUPPORTED",
      "hairline",
      "validate",
    );
  });

  it("uses fallback width zero for a sampled zero-scale keyframe", () => {
    const svg = engine.renderToSvg(animatedCameraScene(0), {
      timeMs: 100,
    });
    expect(svg).toContain('stroke-width="0"');
  });

  it("keeps omitted and explicit transform Path output byte-identical", () => {
    const omitted = stablePathStrokeScene();
    const explicit = stablePathStrokeScene({ strokeScaling: "transform" });
    expect(engine.renderToIR(explicit)).toEqual(engine.renderToIR(omitted));
    expect(engine.renderToSvg(explicit)).toBe(engine.renderToSvg(omitted));
    expect(engine.renderToPng(explicit)).toEqual(engine.renderToPng(omitted));
  });

  it("uses nested authored Path scale for fallback and output scale only for resolution", () => {
    const scene = createElement(
      "Canvas",
      { width: 96, height: 64 },
      createElement(
        "Box",
        {
          id: "outer",
          width: 96,
          height: 64,
          transform: { scaleX: 2, scaleY: 2, originX: 0, originY: 0 },
        },
        createElement("Path", {
          id: "rotated-path",
          d: "M1 1H19V19H1Z",
          width: 20,
          height: 20,
          fill: "none",
          stroke: "#fff",
          strokeWidth: 1,
          strokeScaling: "canvas",
          transform: { rotateDeg: 30, scaleX: 1.5, scaleY: 1.5 },
        }),
      ),
    );
    const svg = engine.renderToSvg(scene, { scale: 2 });
    expect(svg).toContain('width="192" height="128"');
    expect(svg).toContain('class="bsvg-vstroke-rotated-path"');
    expect(svg).toContain('stroke-width="0.333333"');
    expect(svg).toContain("stroke-width: 2;");

    const defaultWidthSvg = engine.renderToSvg(
      stablePathStrokeScene({
        cameraScale: 0.5,
        strokeScaling: "canvas",
        omitStrokeWidth: true,
      }),
    );
    expect(defaultWidthSvg).toContain('stroke-width="2"');
    expect(defaultWidthSvg).toContain("stroke-width: 1;");
  });

  it("samples animated Path fallback widths at start, middle, and end", () => {
    const scene = animatedPathStrokeScene();
    const frames = [...engine.renderFrames(scene, { timesMs: [0, 50, 100], format: "svg" })];
    expect(
      frames.map((frame) =>
        frame.format === "svg" ? frame.data.match(/stroke-width="([^"]+)"/)?.[1] : undefined,
      ),
    ).toEqual(["0.625", "0.769231", "1"]);
    for (const timeMs of [0, 50, 100]) {
      const declarativeSvg = engine.renderToAnimatedSvg(scene, {
        playback: { mode: "independent" },
        timeMs,
      });
      expect(declarativeSvg).toContain("vector-effect: non-scaling-stroke");
      expect(rasterHandle.createSvgToPngFn()(declarativeSvg)).toEqual(
        engine.renderToPng(scene, { timeMs }),
      );
    }
  });

  it("keeps Path canvas-space coverage stable and applies final raster scale once", () => {
    const unit = engine.renderToPng(stablePathStrokeScene({ strokeScaling: "canvas" }));
    const shrunk = engine.renderToPng(
      stablePathStrokeScene({ cameraScale: 0.5, strokeScaling: "canvas" }),
    );
    const zoomed = engine.renderToPng(
      stablePathStrokeScene({ cameraScale: 1.6, strokeScaling: "canvas" }),
    );
    const transformScaled = engine.renderToPng(
      stablePathStrokeScene({ cameraScale: 1.6, strokeScaling: "transform" }),
    );
    const highResolution = engine.renderToPng(
      stablePathStrokeScene({ cameraScale: 1.6, strokeScaling: "canvas" }),
      { scale: 2 },
    );

    const unitEnergy = alphaEnergyAtColumn(unit, 18);
    const shrunkEnergy = alphaEnergyAtColumn(shrunk, 9);
    const zoomedEnergy = alphaEnergyAtColumn(zoomed, 29);
    const transformEnergy = alphaEnergyAtColumn(transformScaled, 29);
    const highResolutionEnergy = alphaEnergyAtColumn(highResolution, 58);
    expect(Math.abs(shrunkEnergy - unitEnergy)).toBeLessThanOrEqual(8);
    expect(alphaCoverageWidthAtColumn(shrunk, 9, 5)).toBe(alphaCoverageWidthAtColumn(unit, 18, 10));
    expect(Math.abs(zoomedEnergy - unitEnergy)).toBeLessThanOrEqual(8);
    expect(alphaCoverageWidthAtColumn(zoomed, 29, 16)).toBe(
      alphaCoverageWidthAtColumn(unit, 18, 10),
    );
    expect(transformEnergy).toBeGreaterThan(zoomedEnergy * 1.35);
    expect(Math.abs(highResolutionEnergy - unitEnergy * 2)).toBeLessThanOrEqual(16);
  });

  it("encodes Path frames across static, animated, and layered raster formats", () => {
    const scene = animatedPathStrokeScene();
    const webp = engine.renderToWebp(scene, { timeMs: 50 });
    const animatedWebp = engine.renderToAnimatedWebp(scene, {
      iterations: "infinite",
      timesMs: [0, 50, 100],
      frameDurationsMs: [50, 50, 50],
    });
    const gif = engine.renderToAnimatedGif(scene, {
      iterations: "infinite",
      timesMs: [0, 50, 100],
      frameDurationsMs: [50, 50, 50],
    });
    const canvasLayered = engine.renderToLayeredSvg(
      stablePathStrokeScene({ cameraScale: 1.6, strokeScaling: "canvas", layer: "path" }),
      { validateComposition: { enabled: true } },
    );
    const transformLayered = engine.renderToLayeredSvg(
      stablePathStrokeScene({ cameraScale: 1.6, strokeScaling: "transform", layer: "path" }),
      {},
    );

    expect(String.fromCharCode(...webp.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...animatedWebp.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...gif.slice(0, 6))).toMatch(/^GIF8[79]a$/);
    expect(canvasLayered.layers[0]?.svg).toContain('stroke-width="0.625"');
    expect(canvasLayered.compositionValidation?.status).toBe("passed");
    expect(canvasLayered.manifest.layers[0]?.bbox).toEqual(
      transformLayered.manifest.layers[0]?.bbox,
    );
  });

  it("rejects unsupported Path transforms and dasharrays with structured errors", () => {
    const unpainted = createElement(
      "Canvas",
      { width: 20, height: 20 },
      createElement(
        "Box",
        { transform: { scaleX: 2, scaleY: 1 } },
        createElement("Path", {
          id: "unpainted-path",
          d: "M0 0L10 10",
          width: 10,
          height: 10,
          strokeScaling: "canvas",
          strokeDasharray: "4,2",
        }),
        createElement("Path", {
          id: "none-path",
          d: "M10 0L0 10",
          width: 10,
          height: 10,
          stroke: "none",
          strokeScaling: "canvas",
          strokeDasharray: "4,2",
        }),
      ),
    );
    const unpaintedSvg = engine.renderToSvg(unpainted);
    expect(unpaintedSvg).not.toContain("bsvg-vstroke-unpainted-path");
    expect(unpaintedSvg).not.toContain("bsvg-vstroke-none-path");

    expectStructuredFatal(
      () =>
        engine.renderToSvg(
          stablePathStrokeScene({ cameraScale: 2, cameraScaleY: 1, strokeScaling: "canvas" }),
        ),
      "CANVAS_STROKE_UNSUPPORTED_TRANSFORM",
      "hairline-path",
      "emit",
    );
    expectStructuredFatal(
      () =>
        engine.renderToSvg(
          stablePathStrokeScene({ cameraScale: -1, cameraScaleY: 1, strokeScaling: "canvas" }),
        ),
      "CANVAS_STROKE_UNSUPPORTED_TRANSFORM",
      "hairline-path",
      "emit",
    );
    expectStructuredFatal(
      () =>
        engine.renderToSvg(
          stablePathStrokeScene({
            strokeScaling: "canvas",
            animation: {
              keyframes: [
                { at: 0, transform: { scaleX: 1, scaleY: 1 } },
                { at: 1, transform: { scaleX: 2, scaleY: 1 } },
              ],
              durationMs: 100,
            },
          }),
          { timeMs: 0 },
        ),
      "CANVAS_STROKE_UNSUPPORTED_TRANSFORM",
      "hairline-path",
      "emit",
    );
    expectStructuredFatal(
      () =>
        engine.renderToSvg(stablePathStrokeScene({ strokeScaling: "canvas", dasharray: "4,2" })),
      "CANVAS_STROKE_DASH_UNSUPPORTED",
      "hairline-path",
      "validate",
    );
    expect(engine.renderToSvg(animatedPathStrokeScene(0), { timeMs: 100 })).toContain(
      'stroke-width="0"',
    );
  });
});
