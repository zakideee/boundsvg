import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { RenderAnimatedWebpOptions } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import { MAX_ANIMATION_SVG_PAYLOAD_CHARS } from "../../src/render-capabilities.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { AnimationEncodeInput, WasmEngineHandle } from "../../src/wasm/index.js";
import {
  createPortableLayoutTransitionInput,
  PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS,
} from "../animation/fixtures/layout-transition.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

const decoder = new TextDecoder();

function readChunkId(bytes: Uint8Array, offset: number): string {
  return decoder.decode(bytes.subarray(offset, offset + 4));
}

/** VP8X payload byte 0 holds the feature flags; the chunk starts at byte 12. */
function readVp8xFlags(bytes: Uint8Array): number {
  return bytes[20] ?? 0;
}

/** VP8X canvas width/height are stored as little-endian u24 values minus one. */
function readVp8xCanvasSize(bytes: Uint8Array): { width: number; height: number } {
  const readU24 = (offset: number): number =>
    (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
  return { width: readU24(24) + 1, height: readU24(27) + 1 };
}

/** ANIM payload bytes 4-5 hold the loop count; the chunk starts at byte 30. */
function readLoopCount(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset + 42, 2).getUint16(0, true);
}

/** Every ANMF chunk in paint order, with the frame duration it declares. */
function readFrameDurations(bytes: Uint8Array): number[] {
  const durations: number[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = readChunkId(bytes, offset);
    const payloadLength = view.getUint32(offset + 4, true);
    if (chunkId === "ANMF") {
      const durationOffset = offset + 8 + 12;
      durations.push(
        (bytes[durationOffset] ?? 0) |
          ((bytes[durationOffset + 1] ?? 0) << 8) |
          ((bytes[durationOffset + 2] ?? 0) << 16),
      );
    }
    offset += 8 + payloadLength + (payloadLength % 2);
  }
  return durations;
}

/** A scene whose opacity animates, so sampled frames genuinely differ. */
function createFadingScene(): ReturnType<typeof createElement> {
  return createElement(
    "Canvas",
    { width: 60, height: 40, background: "#ffffff" },
    createElement("Box", {
      id: "fading-box",
      width: 60,
      height: 40,
      background: "#2563eb",
      animate: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 1000,
        fill: "both",
      },
    }),
  );
}

describe("renderToAnimatedWebp", () => {
  let handle: WasmEngineHandle;
  let encodeAnimatedWebp: NonNullable<ReturnType<WasmEngineHandle["createSvgsToAnimatedWebpFn"]>>;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
    const created = handle.createSvgsToAnimatedWebpFn();
    expect(created, "WASM build must expose svgs_to_animated_webp").toBeDefined();
    if (!created) {
      throw new Error("unreachable");
    }
    encodeAnimatedWebp = created;
  });

  function createEngine(overrides = {}) {
    return createEngineFromHandle(handle, {
      svgsToAnimatedWebpFn: encodeAnimatedWebp,
      ...overrides,
    });
  }

  it("emits an animated extended-format WebP", () => {
    const webp = createEngine().renderToAnimatedWebp(createFadingScene(), {
      iterations: "infinite",
      durationMs: 500,
      fps: 10,
    });

    expect(readChunkId(webp, 0)).toBe("RIFF");
    expect(readChunkId(webp, 8)).toBe("WEBP");
    expect(readChunkId(webp, 12)).toBe("VP8X");
    // Alpha (0x10) + animation (0x02).
    expect(readVp8xFlags(webp)).toBe(0x12);
    expect(readChunkId(webp, 30)).toBe("ANIM");
  });

  it("encodes a compiled scene without re-entering the compile transport", () => {
    let compileCount = 0;
    let rasterPreflightCount = 0;
    const engine = createEngine({
      renderToIrFn: (inputJson: string, optionsJson: string) => {
        compileCount += 1;
        return handle.renderToIr(inputJson, optionsJson);
      },
      preflightRasterSceneFn: (irJson: string, optionsJson: string) => {
        rasterPreflightCount += 1;
        return handle.preflightRasterScene(irJson, optionsJson);
      },
    });
    const scene = createFadingScene();
    const compiled = engine.compile(scene);
    expect(compileCount).toBe(1);

    compileCount = 0;
    const options = {
      timesMs: [0, 250, 900],
      frameDurationsMs: [250, 650, 100],
      iterations: 3,
    } as const;
    const compiledWebp = engine.renderCompiledToAnimatedWebp(compiled, options);
    expect(compileCount).toBe(0);
    expect(rasterPreflightCount).toBe(1);

    const sourceWebp = engine.renderToAnimatedWebp(scene, options);
    expect(compileCount).toBe(1);
    expect(rasterPreflightCount).toBe(2);
    expect(compiledWebp).toEqual(sourceWebp);
  });

  it("accepts a layout transition CompiledScene directly", () => {
    const captured: AnimationEncodeInput[] = [];
    const engine = createEngine({
      svgsToAnimatedWebpFn: (input: AnimationEncodeInput) => {
        captured.push(input);
        return encodeAnimatedWebp(input);
      },
    });
    const compiled = engine.compileLayoutTransition(createPortableLayoutTransitionInput());
    const timesMs = PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS.map((checkpoint) => checkpoint.timeMs);
    const webp = engine.renderCompiledToAnimatedWebp(compiled, {
      timesMs,
      frameDurationsMs: [300, 400, 300, 100],
      iterations: 2,
    });

    expect(readChunkId(webp, 0)).toBe("RIFF");
    expect(readChunkId(webp, 8)).toBe("WEBP");
    expect(readVp8xCanvasSize(webp)).toEqual({ width: 480, height: 480 });
    expect(readFrameDurations(webp)).toEqual([300, 400, 300, 100]);
    expect(readLoopCount(webp)).toBe(2);
    expect(captured[0]?.iterations).toBe(2);
    expect(captured[0]?.frames).toHaveLength(timesMs.length);
    for (const [index, timeMs] of timesMs.entries()) {
      expect(captured[0]?.frames[index]).toEqual({
        svg: engine.renderCompiledToSvg(compiled, { animation: "static", timeMs }),
        durationMs: [300, 400, 300, 100][index],
      });
    }
  });

  it("derives frame count and duration from fps and durationMs", () => {
    const webp = createEngine().renderToAnimatedWebp(createFadingScene(), {
      iterations: "infinite",
      durationMs: 500,
      fps: 10,
    });

    // ceil(500 * 10 / 1000) = 5 frames, each round(1000 / 10) = 100 ms.
    expect(readFrameDurations(webp)).toEqual([100, 100, 100, 100, 100]);
  });

  it("samples at least two frames even for a very short duration", () => {
    const webp = createEngine().renderToAnimatedWebp(createFadingScene(), {
      iterations: "infinite",
      durationMs: 1,
      fps: 10,
    });

    // Two frames cannot be shorter than 1 ms each, so the floor stretches the
    // request from 1 ms to 2 ms rather than to a whole 100 ms frame period.
    expect(readFrameDurations(webp)).toEqual([1, 1]);
  });

  it("plays for exactly durationMs when the frame grid does not divide it", () => {
    const engine = createEngine();
    const scene = createFadingScene();
    const cases: Array<{ durationMs: number; fps: number }> = [
      { durationMs: 450, fps: 10 },
      { durationMs: 1000, fps: 3 },
      { durationMs: 333, fps: 12 },
      { durationMs: 1000, fps: 1 },
    ];

    for (const { durationMs, fps } of cases) {
      const durations = readFrameDurations(
        engine.renderToAnimatedWebp(scene, { iterations: "infinite", durationMs, fps }),
      );
      expect(
        durations.reduce((sum, frameDurationMs) => sum + frameDurationMs, 0),
        `${durationMs} ms at ${fps} fps`,
      ).toBe(durationMs);
    }
  });

  it("honors an explicit timesMs / frameDurationsMs schedule", () => {
    const webp = createEngine().renderToAnimatedWebp(createFadingScene(), {
      iterations: "infinite",
      timesMs: [0, 250, 900],
      frameDurationsMs: [250, 650, 100],
    });

    expect(readFrameDurations(webp)).toEqual([250, 650, 100]);
  });

  it("stores total plays directly in the ANIM field", () => {
    const engine = createEngine();
    const scene = createFadingScene();

    for (const [iterations, expectedField] of [
      ["infinite", 0],
      [1, 1],
      [65_535, 65_535],
    ] as const) {
      expect(
        readLoopCount(engine.renderToAnimatedWebp(scene, { durationMs: 200, fps: 10, iterations })),
      ).toBe(expectedField);
    }
  });

  it("samples distinct frames from an animated scene", () => {
    const webp = createEngine().renderToAnimatedWebp(createFadingScene(), {
      iterations: "infinite",
      durationMs: 1000,
      fps: 4,
    });

    // Each ANMF carries its own VP8L payload; a static render would repeat the
    // same chunk bytes for every frame.
    const anmfPayloads = splitAnmfPayloads(webp);
    expect(anmfPayloads.length).toBeGreaterThan(1);
    expect(new Set(anmfPayloads.map((payload) => payload.join(","))).size).toBeGreaterThan(1);
  });

  it("produces identical bytes for identical input", () => {
    const engine = createEngine();
    const first = engine.renderToAnimatedWebp(createFadingScene(), {
      iterations: "infinite",
      durationMs: 400,
      fps: 10,
    });
    const second = engine.renderToAnimatedWebp(createFadingScene(), {
      iterations: "infinite",
      durationMs: 400,
      fps: 10,
    });

    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it("works for a scene with no animation", () => {
    const still = createElement("Canvas", { width: 20, height: 10, background: "#0f172a" });

    const webp = createEngine().renderToAnimatedWebp(still, {
      iterations: "infinite",
      durationMs: 300,
      fps: 10,
    });

    expect(readChunkId(webp, 12)).toBe("VP8X");
    expect(readFrameDurations(webp)).toEqual([100, 100, 100]);
  });

  it("applies scale once through the shared emitted-root dimensions", () => {
    const captured: AnimationEncodeInput[] = [];
    const engine = createEngine({
      svgsToAnimatedWebpFn: (input: AnimationEncodeInput) => {
        captured.push(input);
        return encodeAnimatedWebp(input);
      },
    });

    engine.renderToAnimatedWebp(createFadingScene(), {
      iterations: "infinite",
      durationMs: 200,
      fps: 10,
      scale: 2,
    });

    const input = captured[0];
    expect(input?.options.scale).toBeUndefined();
    expect(input?.frames[0]?.svg).toContain('width="120"');
  });

  it("rejects malformed schedules", () => {
    const engine = createEngine();
    const scene = createFadingScene();
    const cases: Array<[string, () => unknown]> = [
      [
        "mismatched frameDurationsMs length",
        () =>
          engine.renderToAnimatedWebp(scene, {
            iterations: "infinite",
            timesMs: [0, 100],
            frameDurationsMs: [50],
          }),
      ],
      [
        "missing frameDurationsMs",
        () => engine.renderToAnimatedWebp(scene, { iterations: "infinite", timesMs: [0, 100] }),
      ],
      [
        "non-integer frame duration",
        () =>
          engine.renderToAnimatedWebp(scene, {
            iterations: "infinite",
            timesMs: [0],
            frameDurationsMs: [16.5],
          }),
      ],
      [
        "missing durationMs",
        () => engine.renderToAnimatedWebp(scene, { iterations: "infinite", fps: 10 }),
      ],
      [
        "timesMs combined with fps",
        () =>
          engine.renderToAnimatedWebp(scene, {
            iterations: "infinite",
            timesMs: [0],
            frameDurationsMs: [100],
            fps: 10,
          }),
      ],
    ];

    for (const [label, run] of cases) {
      try {
        run();
        expect.unreachable(`${label} must be rejected`);
      } catch (error) {
        expect(error, label).toBeInstanceOf(FatalError);
        expect((error as FatalError).code, label).toBe("ANIMATED_WEBP_INVALID_SCHEDULE");
      }
    }
  });

  it("rejects a schedule longer than the frame cap", () => {
    const engine = createEngine();

    try {
      engine.renderToAnimatedWebp(createFadingScene(), {
        iterations: "infinite",
        durationMs: 20_000,
        fps: 60,
      });
      expect.unreachable("301+ frames must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(FatalError);
      expect((error as FatalError).code).toBe("ANIMATED_WEBP_TOO_MANY_FRAMES");
    }
  });

  it("keeps the displayed timeline equal to the sampled one", () => {
    // 60 fps: a rounded 1000/fps would emit 17 ms per frame and run ahead of
    // the 16.667 ms sample grid. Telescoped boundaries must total the span.
    const webp = createEngine().renderToAnimatedWebp(createFadingScene(), {
      iterations: "infinite",
      durationMs: 1000,
      fps: 60,
    });

    const durations = readFrameDurations(webp);
    expect(durations).toHaveLength(60);
    expect(durations.reduce((sum, durationMs) => sum + durationMs, 0)).toBe(1000);
    expect(new Set(durations)).toEqual(new Set([16, 17]));
  });

  it("rejects a too-long explicit schedule and out-of-range values", () => {
    const engine = createEngine();
    const scene = createFadingScene();
    const overCap = Array.from({ length: 301 }, (_unused, index) => index * 10);

    try {
      engine.renderToAnimatedWebp(scene, {
        iterations: "infinite",
        timesMs: overCap,
        frameDurationsMs: overCap.map(() => 10),
      });
      expect.unreachable("an explicit 301-frame schedule must be rejected");
    } catch (error) {
      expect((error as FatalError).code).toBe("ANIMATED_WEBP_TOO_MANY_FRAMES");
    }

    try {
      engine.renderToAnimatedWebp(scene, {
        iterations: "infinite",
        timesMs: [0],
        frameDurationsMs: [60_001],
      });
      expect.unreachable("a duration past 60000 ms must be rejected");
    } catch (error) {
      expect((error as FatalError).code).toBe("ANIMATED_WEBP_INVALID_SCHEDULE");
    }
  });

  it("requires a valid total play count before sampling or encoding", () => {
    let encodeCount = 0;
    const engine = createEngine({
      svgsToAnimatedWebpFn: () => {
        encodeCount += 1;
        return new Uint8Array([1]);
      },
    });
    const invalidIterations: unknown[] = [
      undefined,
      0,
      -1,
      1.5,
      65_536,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      "forever",
    ];

    for (const iterations of invalidIterations) {
      try {
        engine.renderToAnimatedWebp(createFadingScene(), {
          durationMs: 200,
          iterations,
        } as RenderAnimatedWebpOptions);
        expect.unreachable(`iterations ${String(iterations)} must be rejected`);
      } catch (error) {
        expect(error, String(iterations)).toBeInstanceOf(FatalError);
        expect((error as FatalError).code, String(iterations)).toBe(
          "ANIMATED_WEBP_INVALID_SCHEDULE",
        );
      }
    }
    expect(encodeCount).toBe(0);
  });

  it("rejects an invalid scale the way renderToWebp does", () => {
    const engine = createEngine();

    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      try {
        engine.renderToAnimatedWebp(createFadingScene(), {
          iterations: "infinite",
          durationMs: 200,
          scale,
        });
        expect.unreachable(`scale ${String(scale)} must be rejected`);
      } catch (error) {
        expect((error as FatalError).code, String(scale)).toBe("PNG_INVALID_SCALE");
      }
    }
  });

  it("applies the raster resolution cap like the still path", () => {
    const engine = createEngine();
    const oversized = createElement("Canvas", { width: 3000, height: 2000 });

    try {
      engine.renderToAnimatedWebp(oversized, {
        iterations: "infinite",
        durationMs: 200,
        fps: 10,
        scale: 2,
        rasterOversizeBehavior: "error",
      });
      expect.unreachable("an oversized animated render must fail");
    } catch (error) {
      expect((error as FatalError).code).toBe("PNG_PIXEL_LIMIT");
    }
  });

  it("reports a resolution adjustment through onPngResolutionAdjusted", () => {
    const adjustments: Array<{ requestedScale: number; appliedScale: number }> = [];
    const engine = createEngine();

    engine.renderToAnimatedWebp(createElement("Canvas", { width: 2000, height: 500 }), {
      iterations: "infinite",
      durationMs: 200,
      fps: 10,
      scale: 4,
      onPngResolutionAdjusted: (warning) => adjustments.push(warning),
    });

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]?.requestedScale).toBe(4);
    expect(adjustments[0]?.appliedScale).toBeLessThan(4);
  });

  it("keeps scale auto-adjustment and warning delivery identical for compiled input", () => {
    const scene = createElement("Canvas", { width: 2000, height: 500 });
    const run = (compiledInput: boolean) => {
      const captured: AnimationEncodeInput[] = [];
      const adjustments: Array<{ requestedScale: number; appliedScale: number }> = [];
      const warningCodes: string[] = [];
      const engine = createEngine({
        svgsToAnimatedWebpFn: (input: AnimationEncodeInput) => {
          captured.push(input);
          return new Uint8Array([1]);
        },
      });
      const options = {
        timesMs: [0],
        frameDurationsMs: [100],
        iterations: "infinite",
        scale: 4,
        onPngResolutionAdjusted: (warning: { requestedScale: number; appliedScale: number }) =>
          adjustments.push(warning),
        onWarning: (warning: { code: string }) => warningCodes.push(warning.code),
      } as const;
      if (compiledInput) {
        engine.renderCompiledToAnimatedWebp(engine.compile(scene), options);
      } else {
        engine.renderToAnimatedWebp(scene, options);
      }
      return { adjustments, warningCodes, svg: captured[0]?.frames[0]?.svg };
    };

    const source = run(false);
    const compiled = run(true);
    expect(compiled).toEqual(source);
    expect(compiled.adjustments).toHaveLength(1);
    expect(compiled.warningCodes).toEqual(["PNG_RESOLUTION_ADJUSTED"]);
    expect(compiled.svg).toContain('width="3840"');
  });

  it("enforces the WebP SVG payload cap and releases compiled frame state", () => {
    let encodeCount = 0;
    let disposeCount = 0;
    const oversizedSvg = {
      length: Math.floor(MAX_ANIMATION_SVG_PAYLOAD_CHARS / 2) + 1,
    } as unknown as string;
    const engine = createEngine({
      preflightRasterSceneFn: () => ({
        renderToSvg: () => oversizedSvg,
        resolveAndEmitToSvg: () => oversizedSvg,
        resolveToIr: () => "{}",
        resolve: () => {},
        dispose: () => {
          disposeCount += 1;
        },
      }),
      svgsToAnimatedWebpFn: () => {
        encodeCount += 1;
        return new Uint8Array([1]);
      },
    });
    const compiled = engine.compile(createFadingScene());

    expect(() =>
      engine.renderCompiledToAnimatedWebp(compiled, {
        timesMs: [0, 1],
        frameDurationsMs: [1, 1],
        iterations: "infinite",
      }),
    ).toThrowError(expect.objectContaining({ code: "ANIMATED_WEBP_PAYLOAD_LIMIT" }));
    expect(encodeCount).toBe(0);
    expect(disposeCount).toBe(1);
  });

  it("keeps every shared limit in step with the Rust validator", () => {
    // Duplicated constants: TS rejects early for a good message, Rust rejects
    // as the trust boundary. Drift would let one accept what the other refuses.
    const rustSource = fs.readFileSync(
      path.resolve(__dirname, "../../../../crates/boundsvg/src/raster_anim.rs"),
      "utf8",
    );
    expect(rustSource).toContain("const MIN_FRAME_DURATION_MS: u32 = 1;");
    expect(rustSource).toContain("const MAX_FRAME_DURATION_MS: u32 = 60_000;");
    const webpSource = fs.readFileSync(
      path.resolve(__dirname, "../../../../crates/boundsvg/src/webp_anim.rs"),
      "utf8",
    );
    expect(webpSource).toContain("const MAX_WEBP_ITERATIONS: u32 = 65_535;");
  });

  it("encodes a single frame exactly as renderToWebp does", () => {
    const engine = createEngineFromHandle(handle, {
      svgsToAnimatedWebpFn: encodeAnimatedWebp,
      svgToWebpFn: handle.createSvgToWebpFn(),
    });
    const still = createElement("Canvas", { width: 40, height: 24, background: "#0f172a" });

    const animated = engine.renderToAnimatedWebp(still, {
      iterations: "infinite",
      timesMs: [0],
      frameDurationsMs: [100],
      scale: 2,
    });
    const singleWebp = engine.renderToWebp(still, { scale: 2 });

    // The animated frame embeds the still encoder's own VP8L chunk, so the two
    // paths must agree on the rasterized pixels — this is what would catch the
    // scale being applied in the SVG emitter for one and in resvg for the other.
    const frameChunk = splitAnmfPayloads(animated)[0]?.subarray(16);
    expect(frameChunk).toEqual(singleWebp.subarray(12));
  });

  it("rejects every malformed schedule shape", () => {
    const engine = createEngine();
    const scene = createFadingScene();
    const cases: Array<[string, RenderAnimatedWebpOptions]> = [
      ["fps below the range", { durationMs: 200, fps: 0, iterations: "infinite" }],
      ["fps above the range", { durationMs: 200, fps: 61, iterations: "infinite" }],
      ["non-finite fps", { durationMs: 200, fps: Number.NaN, iterations: "infinite" }],
      ["zero durationMs", { durationMs: 0, iterations: "infinite" }],
      ["negative durationMs", { durationMs: -5, iterations: "infinite" }],
      ["non-finite durationMs", { durationMs: Number.POSITIVE_INFINITY, iterations: "infinite" }],
      ["empty timesMs", { timesMs: [], frameDurationsMs: [], iterations: "infinite" }],
      ["negative sample time", { timesMs: [-1], frameDurationsMs: [100], iterations: "infinite" }],
      [
        "non-finite sample time",
        { timesMs: [Number.NaN], frameDurationsMs: [100], iterations: "infinite" },
      ],
      [
        "frameDurationsMs without timesMs",
        { durationMs: 200, frameDurationsMs: [100], iterations: "infinite" },
      ],
      ["zero frame duration", { timesMs: [0], frameDurationsMs: [0], iterations: "infinite" }],
    ];

    for (const [label, options] of cases) {
      try {
        engine.renderToAnimatedWebp(scene, options);
        expect.unreachable(`${label} must be rejected`);
      } catch (error) {
        expect(error, label).toBeInstanceOf(FatalError);
        expect((error as FatalError).code, label).toBe("ANIMATED_WEBP_INVALID_SCHEDULE");
      }
    }
  });

  it("keeps sample times inside the requested window", () => {
    const captured: AnimationEncodeInput[] = [];
    const engine = createEngine({
      svgsToAnimatedWebpFn: (input: AnimationEncodeInput) => {
        captured.push(input);
        return encodeAnimatedWebp(input);
      },
    });

    // Below one frame period the two-frame floor would otherwise sample the
    // second frame at 1000/fps — far past the animation the caller asked for.
    engine.renderToAnimatedWebp(createFadingScene(), {
      iterations: "infinite",
      durationMs: 100,
      fps: 1,
    });

    const svgs = captured[0]?.frames.map((frame) => frame.svg) ?? [];
    expect(svgs).toHaveLength(2);
    // At t=100 ms of a 1000 ms fade the box is still mostly transparent, so
    // the second frame must not equal the fully opaque end state.
    expect(svgs[1]).not.toBe(
      engine.renderToSvg(createFadingScene(), { animation: "static", timeMs: 1000 }),
    );
  });

  it("reports WEBP_NO_ENCODER when no animated encoder is wired", () => {
    const engine = createEngineFromHandle(handle);

    try {
      engine.renderToAnimatedWebp(createFadingScene(), { iterations: "infinite", durationMs: 200 });
      expect.unreachable("renderToAnimatedWebp must fail without an encoder");
    } catch (error) {
      expect(error).toBeInstanceOf(FatalError);
      expect((error as FatalError).code).toBe("WEBP_NO_ENCODER");
    }
  });
});

/** Payload bytes of every ANMF chunk, frame data included. */
function splitAnmfPayloads(bytes: Uint8Array): Uint8Array[] {
  const payloads: Uint8Array[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = readChunkId(bytes, offset);
    const payloadLength = view.getUint32(offset + 4, true);
    if (chunkId === "ANMF") {
      payloads.push(bytes.subarray(offset + 8, offset + 8 + payloadLength));
    }
    offset += 8 + payloadLength + (payloadLength % 2);
  }
  return payloads;
}
