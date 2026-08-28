import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  animatedSvgTimelineLimits,
  type CompiledScene,
  createElement,
  createEngineAsync,
  type Engine,
  FatalError,
  MAX_ANIMATION_FRAMES,
  MAX_ANIMATION_SVG_PAYLOAD_CHARS,
  RASTER_DIMENSION_SATURATION,
  RASTER_MAX_LONG_EDGE,
  RASTER_MAX_PIXELS,
  resolveRasterScale,
  type SceneNode,
  type VNode,
} from "../src/index.js";
import { initNodeWasm } from "../src/node.js";
import { createWasmEngineInstance, type WasmEngineHandle } from "../src/wasm/index.js";

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function gifSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function uint24Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function webpSize(bytes: Uint8Array): { width: number; height: number } {
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X") {
    return { width: uint24Le(bytes, 24) + 1, height: uint24Le(bytes, 27) + 1 };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = new DataView(bytes.buffer, bytes.byteOffset + 21, 4).getUint32(0, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  throw new Error(`Unsupported WebP dimension chunk: ${chunk}`);
}

const INTEGER_PIXEL_ROUNDING_BOUNDARY = {
  width: 22,
  height: 38,
  requestedScale: Math.sqrt(RASTER_MAX_PIXELS / (22 * 38)),
};

const EXACT_PIXEL_CAP = {
  width: 19,
  height: 19,
  requestedScale: Math.sqrt(RASTER_MAX_PIXELS / (19 * 19)),
};

type RasterScaleFixture = {
  label: string;
  width: number;
  height: number;
  requestedScale: number;
};

type RasterContractNumber = number | "NaN" | "Infinity" | "-Infinity" | "MAX_VALUE";

type RasterContractExpected =
  | { kind: "error"; code: string }
  | {
      kind: "ok";
      appliedScale: number;
      requestedWidth: number;
      requestedHeight: number;
      outputWidth: number;
      outputHeight: number;
      adjusted: boolean;
      strict: "accept" | "PNG_PIXEL_LIMIT";
    };

type RasterContractFixture = {
  label: string;
  width: RasterContractNumber;
  height: RasterContractNumber;
  effectiveWidth?: RasterContractNumber;
  effectiveHeight?: RasterContractNumber;
  requestedScale: RasterContractNumber;
  authoredResolverExpected?: RasterContractExpected;
  expected: RasterContractExpected;
  allRasterPaths?: boolean;
  canvasQuantization?: boolean;
};

const rasterContractFixtureDocument = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../../fixtures/conformance/raster-contract-cases.json"),
    "utf8",
  ),
) as { schemaVersion: number; cases: RasterContractFixture[] };
const rasterContractFixtures = rasterContractFixtureDocument.cases;

function decodeContractNumber(value: RasterContractNumber): number {
  switch (value) {
    case "NaN":
      return Number.NaN;
    case "Infinity":
      return Number.POSITIVE_INFINITY;
    case "-Infinity":
      return Number.NEGATIVE_INFINITY;
    case "MAX_VALUE":
      return Number.MAX_VALUE;
    default:
      return value;
  }
}

function captureFatalCode(run: () => unknown): string {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(FatalError);
  return (thrown as FatalError).code;
}

function captureFatalContract(run: () => unknown): { code: string; stage: string | undefined } {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(FatalError);
  const fatalError = thrown as FatalError;
  return { code: fatalError.code, stage: fatalError.stage };
}

function captureWasmStructuredCode(run: () => unknown): string {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  const serialized =
    typeof thrown === "string" ? thrown : thrown instanceof Error ? thrown.message : String(thrown);
  const objectStart = serialized.indexOf("{");
  expect(objectStart).toBeGreaterThanOrEqual(0);
  const envelope = JSON.parse(serialized.slice(objectStart)) as { code?: unknown };
  expect(typeof envelope.code).toBe("string");
  return String(envelope.code);
}

function expectWithinRasterCaps({ width, height }: { width: number; height: number }): void {
  expect(Math.max(width, height)).toBeLessThanOrEqual(RASTER_MAX_LONG_EDGE);
  expect(width * height).toBeLessThanOrEqual(RASTER_MAX_PIXELS);
}

type RasterScaleMatrixAudit = {
  inspectedCases: number;
  falseAdjustmentCount: number;
  falseAdjustmentSamples: RasterScaleFixture[];
  capViolationCount: number;
  capViolationSamples: RasterScaleFixture[];
};

function inspectRasterScaleFixture(
  fixture: RasterScaleFixture,
  audit: RasterScaleMatrixAudit,
): void {
  const resolution = resolveRasterScale(fixture);
  audit.inspectedCases += 1;
  const outputViolatesCaps =
    Math.max(resolution.outputWidth, resolution.outputHeight) > RASTER_MAX_LONG_EDGE ||
    resolution.outputWidth * resolution.outputHeight > RASTER_MAX_PIXELS;
  if (!resolution.adjusted && outputViolatesCaps) {
    audit.capViolationCount += 1;
    if (audit.capViolationSamples.length < 20) {
      audit.capViolationSamples.push(fixture);
    }
  }
  const requestedFits =
    Math.max(resolution.requestedWidth, resolution.requestedHeight) <= RASTER_MAX_LONG_EDGE &&
    resolution.requestedWidth * resolution.requestedHeight <= RASTER_MAX_PIXELS;
  if (requestedFits && resolution.adjusted) {
    audit.falseAdjustmentCount += 1;
    if (audit.falseAdjustmentSamples.length < 20) {
      audit.falseAdjustmentSamples.push(fixture);
    }
  }
}

function auditRasterScaleBoundaryMatrix(): RasterScaleMatrixAudit {
  const audit: RasterScaleMatrixAudit = {
    inspectedCases: 0,
    falseAdjustmentCount: 0,
    falseAdjustmentSamples: [],
    capViolationCount: 0,
    capViolationSamples: [],
  };
  for (let width = 1; width <= 256; width += 1) {
    for (let height = 1; height <= 256; height += 1) {
      const longEdgeScale = RASTER_MAX_LONG_EDGE / Math.max(width, height);
      const pixelScale = Math.sqrt(RASTER_MAX_PIXELS / (width * height));
      const scales = [
        0.5,
        1,
        1.0001,
        2,
        longEdgeScale,
        pixelScale,
        longEdgeScale * (1 + Number.EPSILON),
        pixelScale * (1 + Number.EPSILON),
        Math.min(longEdgeScale, pixelScale),
      ];
      for (const requestedScale of scales) {
        inspectRasterScaleFixture(
          { label: `${width}x${height}@${requestedScale}`, width, height, requestedScale },
          audit,
        );
      }
    }
  }
  return audit;
}

describe("public render capability contract", () => {
  let engine: Engine;
  let rustHandle: WasmEngineHandle;

  beforeAll(async () => {
    await initNodeWasm();
    engine = await createEngineAsync({});
    rustHandle = createWasmEngineInstance();
  });

  afterAll(() => {
    engine?.dispose();
    rustHandle?.dispose();
  });

  it("publishes the hard limits enforced by the render pipeline", () => {
    expect(rasterContractFixtureDocument.schemaVersion).toBe(2);
    expect(RASTER_MAX_LONG_EDGE).toBe(3_840);
    expect(RASTER_MAX_PIXELS).toBe(8_294_400);
    expect(RASTER_DIMENSION_SATURATION).toBe(4_294_967_295);
    expect(MAX_ANIMATION_FRAMES).toBe(300);
    expect(MAX_ANIMATION_SVG_PAYLOAD_CHARS).toBe(67_108_864);
    expect(animatedSvgTimelineLimits).toEqual({
      maxKeyframeStops: 16_384,
      maxCssBytes: 16_777_216,
    });
    expect(Object.isFrozen(animatedSvgTimelineLimits)).toBe(true);
  });

  it("terminates and rejects a non-finite public resolver input", () => {
    const moduleUrl = pathToFileURL(path.resolve(__dirname, "../src/render-capabilities.ts")).href;
    const script = `
      import { resolveRasterScale } from ${JSON.stringify(moduleUrl)};
      try {
        resolveRasterScale({ width: 10, height: 10, requestedScale: Number.NaN });
        process.stdout.write("accepted");
      } catch (error) {
        process.stdout.write(String(error?.code ?? "unknown"));
      }
    `;
    const child = spawnSync(
      process.execPath,
      ["--import=tsx", "--input-type=module", "--eval", script],
      { encoding: "utf8", timeout: 2_000 },
    );

    expect(child.signal).toBeNull();
    expect(child.status).toBe(0);
    expect(child.stdout).toBe("PNG_INVALID_SCALE");
  });

  it("uses post-layout IR dimensions when a large integer Canvas is quantized", () => {
    const width = 16_777_217;
    const height = 100;
    const requestedScale = 1_000.005_02 / width;
    const authoredResolution = resolveRasterScale({ width, height, requestedScale });
    const exactBoundary = engine.compile(createElement("Canvas", { width: 16_777_216, height }));
    const compiled = engine.compile(createElement("Canvas", { width, height }));
    const currentIrResolution = resolveRasterScale({
      width: compiled.ir.width,
      height: compiled.ir.height,
      requestedScale,
    });

    expect(exactBoundary.ir.width).toBe(16_777_216);
    expect({ width: compiled.ir.width, height: compiled.ir.height }).toEqual({
      width: 16_777_216,
      height: 100,
    });
    expect({
      width: authoredResolution.outputWidth,
      height: authoredResolution.outputHeight,
    }).toEqual({
      width: 1_001,
      height: 1,
    });
    expect({
      width: currentIrResolution.outputWidth,
      height: currentIrResolution.outputHeight,
    }).toEqual({
      width: 1_000,
      height: 1,
    });
    expect(pngSize(engine.renderCompiledToPng(compiled, { scale: requestedScale }))).toEqual({
      width: currentIrResolution.outputWidth,
      height: currentIrResolution.outputHeight,
    });
  });

  it("uses current compiled IR dimensions as the render prediction source", () => {
    const compiled = engine.compile(createElement("Canvas", { width: 10, height: 10 }));
    compiled.ir.width = 20;
    compiled.ir.root.bbox.w = 20;
    const currentIrResolution = resolveRasterScale({
      width: compiled.ir.width,
      height: compiled.ir.height,
      requestedScale: 1,
    });

    expect({ width: compiled.width, height: compiled.height }).toEqual({ width: 10, height: 10 });
    expect(pngSize(engine.renderCompiledToPng(compiled))).toEqual({
      width: currentIrResolution.outputWidth,
      height: currentIrResolution.outputHeight,
    });
  });

  it("passes every shared contract case through both TS and the real Rust boundary", () => {
    let parityCases = 0;
    for (const fixture of rasterContractFixtures) {
      const input = {
        width: decodeContractNumber(fixture.effectiveWidth ?? fixture.width),
        height: decodeContractNumber(fixture.effectiveHeight ?? fixture.height),
        requestedScale: decodeContractNumber(fixture.requestedScale),
      };
      if (fixture.expected.kind === "error") {
        expect(
          captureFatalCode(() => resolveRasterScale(input)),
          fixture.label,
        ).toBe(fixture.expected.code);
        expect(
          captureWasmStructuredCode(() =>
            rustHandle.resolveRasterScale(input.width, input.height, input.requestedScale),
          ),
          fixture.label,
        ).toBe(fixture.expected.code);
        parityCases += 1;
        continue;
      }
      const expected = {
        appliedScale: fixture.expected.appliedScale,
        requestedWidth: fixture.expected.requestedWidth,
        requestedHeight: fixture.expected.requestedHeight,
        outputWidth: fixture.expected.outputWidth,
        outputHeight: fixture.expected.outputHeight,
        adjusted: fixture.expected.adjusted,
      };
      expect(resolveRasterScale(input), fixture.label).toEqual(expected);
      expect(
        rustHandle.resolveRasterScale(input.width, input.height, input.requestedScale),
        fixture.label,
      ).toEqual(expected);
      parityCases += 1;
    }
    expect(parityCases).toBe(rasterContractFixtures.length);
  });

  it("keeps authored resolver results explicit when Canvas layout changes the raster base", () => {
    let authoredResolverCases = 0;
    for (const fixture of rasterContractFixtures) {
      const expected = fixture.authoredResolverExpected;
      if (expected === undefined) {
        continue;
      }
      const input = {
        width: decodeContractNumber(fixture.width),
        height: decodeContractNumber(fixture.height),
        requestedScale: decodeContractNumber(fixture.requestedScale),
      };
      if (expected.kind === "error") {
        expect(
          captureFatalCode(() => resolveRasterScale(input)),
          fixture.label,
        ).toBe(expected.code);
        expect(
          captureWasmStructuredCode(() =>
            rustHandle.resolveRasterScale(input.width, input.height, input.requestedScale),
          ),
          fixture.label,
        ).toBe(expected.code);
      } else {
        const expectedResolution = {
          appliedScale: expected.appliedScale,
          requestedWidth: expected.requestedWidth,
          requestedHeight: expected.requestedHeight,
          outputWidth: expected.outputWidth,
          outputHeight: expected.outputHeight,
          adjusted: expected.adjusted,
        };
        expect(resolveRasterScale(input), fixture.label).toEqual(expectedResolution);
        expect(
          rustHandle.resolveRasterScale(input.width, input.height, input.requestedScale),
          fixture.label,
        ).toEqual(expectedResolution);
      }
      authoredResolverCases += 1;
    }
    expect(authoredResolverCases).toBe(10);
  });

  it.each([
    { label: "inside", width: 320, height: 180, requestedScale: 2, bound: false },
    { label: "long edge", width: 5_000, height: 1_000, requestedScale: 1, bound: true },
    { label: "pixel area", width: 2_560, height: 2_560, requestedScale: 2, bound: true },
    {
      label: "fractional scale rounding edge",
      width: 100,
      height: 100,
      requestedScale: 1.000_01,
      bound: false,
    },
    {
      label: "pixel-cap rounding edge",
      width: 1_010,
      height: 1_010,
      requestedScale: 10,
      bound: true,
    },
  ])("matches the real Rust rasterizer at the $label boundary", ({
    width,
    height,
    requestedScale,
    bound,
  }) => {
    const resolution = resolveRasterScale({ width, height, requestedScale });
    expect(resolution.adjusted).toBe(bound);

    const scene = createElement("Canvas", { width, height });
    const png = engine.renderToPng(scene, {
      scale: requestedScale,
      rasterOversizeBehavior: "auto-adjust",
    });
    expect(pngSize(png)).toEqual({
      width: resolution.outputWidth,
      height: resolution.outputHeight,
    });

    const strictRender = (): Uint8Array =>
      engine.renderToPng(scene, {
        scale: requestedScale,
        rasterOversizeBehavior: "error",
      });
    if (resolution.adjusted) {
      expect(strictRender).toThrow(/4K-equivalent cap/u);
    } else {
      expect(pngSize(strictRender())).toEqual({
        width: resolution.outputWidth,
        height: resolution.outputHeight,
      });
    }
  });

  it("rejects a degenerate prediction and render with the same structured code", () => {
    expect(
      captureFatalCode(() => resolveRasterScale({ width: 0, height: 20, requestedScale: 2 })),
    ).toBe("INVALID_CANVAS_SIZE");
    expect(
      captureFatalCode(() => engine.renderToPng(createElement("Canvas", { width: 0, height: 20 }))),
    ).toBe("INVALID_CANVAS_SIZE");
  });

  it("reduces the continuous pixel-cap scale until the final integer dimensions fit", () => {
    const resolution = resolveRasterScale(INTEGER_PIXEL_ROUNDING_BOUNDARY);

    expect(resolution.adjusted).toBe(true);
    expectWithinRasterCaps({
      width: resolution.outputWidth,
      height: resolution.outputHeight,
    });
  });

  it("keeps an emitter-rounded exact-cap request unchanged", () => {
    expect(resolveRasterScale(EXACT_PIXEL_CAP)).toEqual({
      appliedScale: EXACT_PIXEL_CAP.requestedScale,
      requestedWidth: 2_880,
      requestedHeight: 2_880,
      outputWidth: 2_880,
      outputHeight: 2_880,
      adjusted: false,
    });
  });

  it("does not warn or reject a real exact-cap PNG", () => {
    const onPngResolutionAdjusted = vi.fn();
    const scene = createElement("Canvas", {
      width: EXACT_PIXEL_CAP.width,
      height: EXACT_PIXEL_CAP.height,
    });
    const autoAdjusted = engine.renderToPng(scene, {
      scale: EXACT_PIXEL_CAP.requestedScale,
      onPngResolutionAdjusted,
    });

    expect(pngSize(autoAdjusted)).toEqual({ width: 2_880, height: 2_880 });
    expect(onPngResolutionAdjusted).not.toHaveBeenCalled();
    expect(
      pngSize(
        engine.renderToPng(scene, {
          scale: EXACT_PIXEL_CAP.requestedScale,
          rasterOversizeBehavior: "error",
        }),
      ),
    ).toEqual({ width: 2_880, height: 2_880 });
  });

  it("keeps the real auto-adjusted PNG within the integer pixel cap", () => {
    const { width, height, requestedScale } = INTEGER_PIXEL_ROUNDING_BOUNDARY;
    const png = engine.renderToPng(createElement("Canvas", { width, height }), {
      scale: requestedScale,
      rasterOversizeBehavior: "auto-adjust",
    });
    const actualSize = pngSize(png);

    expect(actualSize).toEqual({
      width: resolveRasterScale(INTEGER_PIXEL_ROUNDING_BOUNDARY).outputWidth,
      height: resolveRasterScale(INTEGER_PIXEL_ROUNDING_BOUNDARY).outputHeight,
    });
    expectWithinRasterCaps(actualSize);
  });

  it("rejects the integer pixel-cap rounding boundary in strict mode", () => {
    const { width, height, requestedScale } = INTEGER_PIXEL_ROUNDING_BOUNDARY;

    expect(() =>
      engine.renderToPng(createElement("Canvas", { width, height }), {
        scale: requestedScale,
        rasterOversizeBehavior: "error",
      }),
    ).toThrow(/4K-equivalent cap/u);
  });

  it("guarantees both integer caps across an exhaustive ceil-boundary matrix", () => {
    const violations: Array<{
      width: number;
      height: number;
      outputWidth: number;
      outputHeight: number;
    }> = [];
    let inspectedCases = 0;
    for (let width = 1; width <= 128; width += 1) {
      for (let height = 1; height <= 128; height += 1) {
        const requestedScale = Math.min(
          RASTER_MAX_LONG_EDGE / Math.max(width, height),
          Math.sqrt(RASTER_MAX_PIXELS / (width * height)),
        );
        const resolution = resolveRasterScale({ width, height, requestedScale });
        inspectedCases += 1;
        if (
          Math.max(resolution.outputWidth, resolution.outputHeight) > RASTER_MAX_LONG_EDGE ||
          resolution.outputWidth * resolution.outputHeight > RASTER_MAX_PIXELS
        ) {
          violations.push({
            width,
            height,
            outputWidth: resolution.outputWidth,
            outputHeight: resolution.outputHeight,
          });
        }
      }
    }

    expect(inspectedCases).toBe(16_384);
    expect(violations).toEqual([]);
  });

  it("never adjusts an emitter-rounded legal request across 589,824 boundary cases", () => {
    const audit = auditRasterScaleBoundaryMatrix();

    expect(audit.inspectedCases).toBe(589_824);
    expect({ count: audit.capViolationCount, samples: audit.capViolationSamples }).toEqual({
      count: 0,
      samples: [],
    });
    expect({
      count: audit.falseAdjustmentCount,
      samples: audit.falseAdjustmentSamples,
    }).toEqual({
      count: 0,
      samples: [],
    });
  });

  it("avoids intermediate-area overflow for finite dimensions", () => {
    const resolution = resolveRasterScale({
      width: Number.MAX_VALUE,
      height: Number.MAX_VALUE,
      requestedScale: Number.MAX_VALUE,
    });

    expect(resolution.appliedScale).toBeGreaterThan(0);
    expect(Number.isFinite(resolution.appliedScale)).toBe(true);
    expect(resolution.outputWidth).toBeGreaterThan(0);
    expect(resolution.outputHeight).toBeGreaterThan(0);
    expectWithinRasterCaps({
      width: resolution.outputWidth,
      height: resolution.outputHeight,
    });
  });

  it.each(
    rasterContractFixtures.filter(
      (fixture) => fixture.allRasterPaths === true && fixture.expected.kind === "error",
    ),
  )("returns $expected.code from every raster path for $label", (fixture) => {
    const width = decodeContractNumber(fixture.width);
    const height = decodeContractNumber(fixture.height);
    const requestedScale = decodeContractNumber(fixture.requestedScale);
    const scene = createElement("Canvas", { width, height, background: "#2563eb" });
    const renderers: Array<{ label: string; run: () => unknown }> = [
      {
        label: "still PNG",
        run: () => engine.renderToPng(scene, { scale: requestedScale }),
      },
      {
        label: "still WebP",
        run: () => engine.renderToWebp(scene, { scale: requestedScale }),
      },
      {
        label: "frame PNG",
        run: () => [
          ...engine.renderFrames(scene, {
            format: "png",
            timesMs: [0],
            scale: requestedScale,
          }),
        ],
      },
      {
        label: "layered PNG",
        run: () => engine.renderToLayeredPng(scene, { scale: requestedScale }),
      },
      {
        label: "animated GIF",
        run: () =>
          engine.renderToAnimatedGif(scene, {
            iterations: "infinite",
            durationMs: 20,
            fps: 50,
            scale: requestedScale,
          }),
      },
      {
        label: "animated WebP",
        run: () =>
          engine.renderToAnimatedWebp(scene, {
            iterations: "infinite",
            durationMs: 20,
            fps: 50,
            scale: requestedScale,
          }),
      },
    ];

    if (fixture.expected.kind !== "error") {
      throw new Error("Expected an error fixture");
    }
    for (const renderer of renderers) {
      expect(captureFatalCode(renderer.run), renderer.label).toBe(fixture.expected.code);
    }
  }, 30_000);

  it("reports the same non-finite Canvas contract across every raster input kind", () => {
    const nonFiniteValues = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const mismatches: Array<{
      inputKind: "VNode" | "SceneNode" | "mutable CompiledScene";
      route: string;
      value: string;
      actual: { code: string; stage: string | undefined };
    }> = [];
    let routeChecks = 0;

    const inspect = (
      inputKind: "VNode" | "SceneNode" | "mutable CompiledScene",
      route: string,
      value: number,
      run: () => unknown,
    ): void => {
      const actual = captureFatalContract(run);
      routeChecks += 1;
      if (actual.code !== "INVALID_CANVAS_SIZE" || actual.stage !== "emit") {
        mismatches.push({ inputKind, route, value: String(value), actual });
      }
    };

    for (const width of nonFiniteValues) {
      const vnode: VNode = createElement("Canvas", { width, height: 10 });
      const sceneNode: SceneNode = { type: "Canvas", width, height: 10, children: [] };
      for (const [inputKind, input] of [
        ["VNode", vnode],
        ["SceneNode", sceneNode],
      ] as const) {
        const routes: Array<{ label: string; run: () => unknown }> = [
          { label: "still PNG", run: () => engine.renderToPng(input) },
          { label: "still WebP", run: () => engine.renderToWebp(input) },
          {
            label: "frame PNG",
            run: () => [...engine.renderFrames(input, { format: "png", timesMs: [0] })],
          },
          { label: "layered PNG", run: () => engine.renderToLayeredPng(input) },
          {
            label: "animated GIF",
            run: () =>
              engine.renderToAnimatedGif(input, {
                iterations: "infinite",
                timesMs: [0],
                frameDurationsMs: [20],
              }),
          },
          {
            label: "animated WebP",
            run: () =>
              engine.renderToAnimatedWebp(input, {
                iterations: "infinite",
                timesMs: [0],
                frameDurationsMs: [20],
              }),
          },
        ];
        for (const route of routes) {
          inspect(inputKind, route.label, width, route.run);
        }
      }

      const compiled: CompiledScene = engine.compile(
        createElement("Canvas", { width: 10, height: 10 }),
      );
      compiled.ir.width = width;
      inspect("mutable CompiledScene", "compiled PNG", width, () =>
        engine.renderCompiledToPng(compiled),
      );
    }

    expect({ routeChecks, mismatches }).toEqual({ routeChecks: 39, mismatches: [] });
  }, 30_000);

  it("rejects a root Canvas accessor without reading it across every raster route", () => {
    let getterReadCount = 0;
    const sceneNode = {
      type: "Canvas",
      height: 10,
      children: [],
    } as unknown as SceneNode;
    Object.defineProperty(sceneNode, "width", {
      configurable: true,
      enumerable: true,
      get: () => {
        getterReadCount += 1;
        throw new Error("getter executed");
      },
    });
    const routes: Array<{ label: string; run: () => unknown }> = [
      { label: "still PNG", run: () => engine.renderToPng(sceneNode) },
      { label: "still WebP", run: () => engine.renderToWebp(sceneNode) },
      {
        label: "frame PNG",
        run: () => [...engine.renderFrames(sceneNode, { format: "png", timesMs: [0] })],
      },
      { label: "layered PNG", run: () => engine.renderToLayeredPng(sceneNode) },
      {
        label: "animated GIF",
        run: () =>
          engine.renderToAnimatedGif(sceneNode, {
            iterations: "infinite",
            timesMs: [0],
            frameDurationsMs: [20],
          }),
      },
      {
        label: "animated WebP",
        run: () =>
          engine.renderToAnimatedWebp(sceneNode, {
            iterations: "infinite",
            timesMs: [0],
            frameDurationsMs: [20],
          }),
      },
    ];
    const results = routes.map(({ label, run }) => {
      try {
        run();
        return { label, code: "accepted", stage: undefined };
      } catch (error) {
        return error instanceof FatalError
          ? { label, code: error.code, stage: error.stage }
          : {
              label,
              code: error instanceof Error ? error.message : String(error),
              stage: undefined,
            };
      }
    });

    expect({ getterReadCount, results }).toEqual({
      getterReadCount: 0,
      results: routes.map(({ label }) => ({
        label,
        code: "SCENE_NOT_SERIALIZABLE",
        stage: "engine",
      })),
    });
  }, 30_000);

  it("matches Canvas quantization across 10 compile and 120 auto/strict raster route checks", () => {
    const quantizationFixtures = rasterContractFixtures.filter(
      (fixture) => fixture.canvasQuantization === true,
    );
    let routeChecks = 0;

    expect(quantizationFixtures).toHaveLength(10);
    for (const fixture of quantizationFixtures) {
      const width = decodeContractNumber(fixture.width);
      const height = decodeContractNumber(fixture.height);
      const requestedScale = decodeContractNumber(fixture.requestedScale);
      const scene = createElement("Canvas", { width, height, background: "#2563eb" });
      if (fixture.expected.kind === "error") {
        expect(
          captureFatalContract(() => engine.compile(scene)),
          fixture.label,
        ).toEqual({
          code: fixture.expected.code,
          stage: "emit",
        });
      } else {
        const compiled = engine.compile(scene);
        expect({ width: compiled.ir.width, height: compiled.ir.height }, fixture.label).toEqual({
          width: decodeContractNumber(fixture.effectiveWidth ?? fixture.width),
          height: decodeContractNumber(fixture.effectiveHeight ?? fixture.height),
        });
      }
      for (const rasterOversizeBehavior of ["auto-adjust", "error"] as const) {
        const commonOptions = { scale: requestedScale, rasterOversizeBehavior };
        const routes: Array<{
          label: string;
          run: () => { width: number; height: number };
        }> = [
          {
            label: "still PNG",
            run: () => pngSize(engine.renderToPng(scene, commonOptions)),
          },
          {
            label: "still WebP",
            run: () => webpSize(engine.renderToWebp(scene, commonOptions)),
          },
          {
            label: "frame PNG",
            run: () => {
              const frame = [
                ...engine.renderFrames(scene, {
                  ...commonOptions,
                  format: "png",
                  timesMs: [0],
                }),
              ][0];
              if (frame?.format !== "png") {
                throw new Error("Expected one PNG frame");
              }
              return pngSize(frame.data);
            },
          },
          {
            label: "layered PNG",
            run: () => {
              const layered = engine.renderToLayeredPng(scene, commonOptions);
              return { width: layered.pixelWidth, height: layered.pixelHeight };
            },
          },
          {
            label: "animated GIF",
            run: () =>
              gifSize(
                engine.renderToAnimatedGif(scene, {
                  iterations: "infinite",
                  ...commonOptions,
                  timesMs: [0],
                  frameDurationsMs: [20],
                }),
              ),
          },
          {
            label: "animated WebP",
            run: () =>
              webpSize(
                engine.renderToAnimatedWebp(scene, {
                  iterations: "infinite",
                  ...commonOptions,
                  timesMs: [0],
                  frameDurationsMs: [20],
                }),
              ),
          },
        ];

        for (const route of routes) {
          const assertionLabel = `${fixture.label} / ${rasterOversizeBehavior} / ${route.label}`;
          if (fixture.expected.kind === "error") {
            expect(captureFatalContract(route.run), assertionLabel).toEqual({
              code: fixture.expected.code,
              stage: "emit",
            });
          } else {
            expect(route.run(), assertionLabel).toEqual({
              width: fixture.expected.outputWidth,
              height: fixture.expected.outputHeight,
            });
          }
          routeChecks += 1;
        }
      }
    }

    expect(routeChecks).toBe(120);
  }, 60_000);

  it("uses the resolved finite scale before the first layered PNG emit", () => {
    const scene = createElement("Canvas", { width: 10, height: 10, background: "#2563eb" });
    const expected = resolveRasterScale({
      width: 10,
      height: 10,
      requestedScale: Number.MAX_VALUE,
    });

    expect(pngSize(engine.renderToPng(scene, { scale: Number.MAX_VALUE }))).toEqual({
      width: expected.outputWidth,
      height: expected.outputHeight,
    });
    const layered = engine.renderToLayeredPng(scene, { scale: Number.MAX_VALUE });
    expect({ width: layered.pixelWidth, height: layered.pixelHeight }).toEqual({
      width: expected.outputWidth,
      height: expected.outputHeight,
    });
    for (const layer of layered.layers) {
      expect(pngSize(layer.png)).toEqual({
        width: expected.outputWidth,
        height: expected.outputHeight,
      });
    }
  }, 30_000);

  it.each(
    rasterContractFixtures.filter(
      (fixture) => fixture.allRasterPaths === true && fixture.expected.kind === "ok",
    ),
  )("applies the fixture dimensions to every raster path at $label", (fixture) => {
    const width = decodeContractNumber(fixture.width);
    const height = decodeContractNumber(fixture.height);
    const requestedScale = decodeContractNumber(fixture.requestedScale);
    const resolution = resolveRasterScale({ width, height, requestedScale });
    const scene = createElement("Canvas", { width, height, background: "#2563eb" });
    const rasterOptions = {
      scale: requestedScale,
      rasterOversizeBehavior: "auto-adjust" as const,
    };
    const animatedRasterOptions = {
      ...rasterOptions,
      timesMs: [0],
      frameDurationsMs: [20],
      iterations: "infinite" as const,
    };
    const expected = {
      width: resolution.outputWidth,
      height: resolution.outputHeight,
    };

    expect(pngSize(engine.renderToPng(scene, rasterOptions))).toEqual(expected);
    expect(webpSize(engine.renderToWebp(scene, rasterOptions))).toEqual(expected);
    for (const frame of engine.renderFrames(scene, {
      ...rasterOptions,
      timesMs: [0, 20],
      format: "png",
    })) {
      expect(frame.format).toBe("png");
      if (frame.format === "png") {
        expect(pngSize(frame.data)).toEqual(expected);
      }
    }
    const layered = engine.renderToLayeredPng(scene, rasterOptions);
    expect({ width: layered.pixelWidth, height: layered.pixelHeight }).toEqual(expected);
    for (const layer of layered.layers) {
      expect(pngSize(layer.png)).toEqual(expected);
    }
    expect(gifSize(engine.renderToAnimatedGif(scene, animatedRasterOptions))).toEqual(expected);
    expect(webpSize(engine.renderToAnimatedWebp(scene, animatedRasterOptions))).toEqual(expected);
  }, 60_000);

  it("keeps the public frame cap in step with the Rust trust boundary", () => {
    const rustSource = fs.readFileSync(
      path.resolve(__dirname, "../../../crates/boundsvg/src/raster_anim.rs"),
      "utf8",
    );
    expect(rustSource).toContain(
      `pub const MAX_ANIMATION_FRAMES: usize = ${MAX_ANIMATION_FRAMES};`,
    );
  });
});
