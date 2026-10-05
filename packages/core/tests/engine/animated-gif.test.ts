import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RenderAnimatedGifOptions } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import {
  createPortableLayoutTransitionInput,
  PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS,
} from "../animation/fixtures/layout-transition.js";
import {
  type CapturedRasterSession,
  captureRasterSession,
  collectAnimatedRaster,
  createMockRasterSession,
} from "../helpers/animation-collector.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

/** Independent cumulative-boundary oracle; fixture arrays are confined to tests. */
function expectedGifDelaysCs(durations: readonly number[]): number[] {
  let elapsedMs = 0;
  let previousCs = 0;
  return durations.map((duration) => {
    elapsedMs += duration;
    const boundaryCs = Math.floor((elapsedMs + 5) / 10);
    const delay = Math.max(2, Math.min(65_535, boundaryCs - previousCs));
    previousCs = boundaryCs;
    return delay;
  });
}

/** Materialize the previous sampled formula only for finite test fixtures. */
function expectedSampledSchedule({ durationMs, fps }: { durationMs: number; fps: number }) {
  const count = Math.max(2, Math.ceil((durationMs * fps) / 1000));
  const total = Math.max(count, Math.round(durationMs));
  const boundaries = Array.from({ length: count + 1 }, (_, index) =>
    index === count ? total : Math.min(Math.round((index * 1000) / fps), total - (count - index)),
  );
  return {
    frameDurationsMs: Array.from(
      { length: count },
      (_, index) => boundaries[index + 1]! - boundaries[index]!,
    ),
  };
}

/** Text decoder for GIF signatures and application extension markers. */
const decoder = new TextDecoder();

/** GIF87a / GIF89a signature. */
function readSignature(bytes: Uint8Array): string {
  return decoder.decode(bytes.subarray(0, 6));
}

/** Logical screen size, stored as two little-endian u16 after the signature. */
function readCanvasSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

/**
 * Walk the GIF block structure and collect every Graphic Control Extension
 * delay, in centiseconds. Scanning for the 0x21 0xF9 0x04 signature would also
 * match inside LZW image data, so this follows the block lengths instead.
 */
function readFrameDelaysCs(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const delays: number[] = [];
  // Header (6) + logical screen descriptor (7), then the global color table
  // when the descriptor's flag byte announces one — which the encoder does.
  let offset = 13;
  const globalFlags = bytes[10] ?? 0;
  if ((globalFlags & 0x80) !== 0) {
    offset += 3 * 2 ** ((globalFlags & 0x07) + 1);
  }

  const skipSubBlocks = (start: number): number => {
    let cursor = start;
    while (cursor < bytes.length) {
      const size = bytes[cursor] ?? 0;
      cursor += 1 + size;
      if (size === 0) {
        break;
      }
    }
    return cursor;
  };

  while (offset < bytes.length) {
    const marker = bytes[offset];
    if (marker === 0x3b) {
      break;
    }
    if (marker === 0x21) {
      const label = bytes[offset + 1];
      if (label === 0xf9) {
        delays.push(view.getUint16(offset + 4, true));
      }
      offset = skipSubBlocks(offset + 2);
      continue;
    }
    if (marker === 0x2c) {
      const localFlags = bytes[offset + 9] ?? 0;
      let imageOffset = offset + 10;
      if ((localFlags & 0x80) !== 0) {
        imageOffset += 3 * 2 ** ((localFlags & 0x07) + 1);
      }
      // LZW minimum code size, then the image data sub-blocks.
      offset = skipSubBlocks(imageOffset + 1);
      continue;
    }
    break;
  }
  return delays;
}

/**
 * Netscape looping extension: the "NETSCAPE2.0" identifier, then a 3-byte
 * sub-block of [0x01, loop u16].
 */
function readLoopCount(bytes: Uint8Array): number | undefined {
  const identifier = new TextEncoder().encode("NETSCAPE2.0");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + identifier.length + 4 < bytes.length; offset++) {
    if (identifier.every((byte, index) => bytes[offset + index] === byte)) {
      // identifier (11) + sub-block size (1) + 0x01 (1) -> loop u16
      return view.getUint16(offset + identifier.length + 2, true);
    }
  }
  return undefined;
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

describe("renderToAnimatedGif", () => {
  let handle: WasmEngineHandle;
  let encodeAnimatedGif: NonNullable<
    ReturnType<WasmEngineHandle["createOpenAnimatedRasterSessionFn"]>
  >;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
    const created = handle.createOpenAnimatedRasterSessionFn();
    expect(created, "WASM build must expose open_animated_raster").toBeDefined();
    if (!created) {
      throw new Error("unreachable");
    }
    encodeAnimatedGif = created;
  });

  function createEngine(overrides = {}) {
    return createEngineFromHandle(handle, {
      openAnimatedRasterSessionFn: encodeAnimatedGif,
      ...overrides,
    });
  }

  it("maps invalid raster backgrounds to the same render fatal across both containers and source routes", async () => {
    const engine = createEngine();
    const scene = createFadingScene();
    const compiled = engine.compile(scene);
    const options = {
      durationMs: 100,
      fps: 20,
      iterations: 1,
      rasterBackground: "not-a-color",
    } as const;
    try {
      for (const write of [
        engine.renderToAnimatedGif.bind(engine, scene, options),
        engine.renderToAnimatedWebp.bind(engine, scene, options),
        engine.renderCompiledToAnimatedGif.bind(engine, compiled, options),
        engine.renderCompiledToAnimatedWebp.bind(engine, compiled, options),
      ]) {
        const destination = { write: vi.fn(), patch: vi.fn(), finish: vi.fn(), abort: vi.fn() };
        const failure: unknown = await write(destination).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(FatalError);
        expect(failure).toMatchObject({ code: "WASM_RENDER_FAILED", stage: "engine" });
        expect(destination.abort).toHaveBeenCalledExactlyOnceWith(failure);
        expect(destination.finish).not.toHaveBeenCalled();
      }
    } finally {
      engine.dispose();
    }
  });

  it("emits an animated GIF at the canvas size", async () => {
    const gif = await collectAnimatedRaster((sink) =>
      createEngine().renderToAnimatedGif(
        createFadingScene(),
        {
          iterations: "infinite",
          durationMs: 500,
          fps: 10,
        },
        sink,
      ),
    );

    expect(readSignature(gif)).toBe("GIF89a");
    expect(readCanvasSize(gif)).toEqual({ width: 60, height: 40 });
  });

  it("encodes a compiled scene without re-entering the compile transport", async () => {
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
    const compiledGif = await collectAnimatedRaster((sink) =>
      engine.renderCompiledToAnimatedGif(compiled, options, sink),
    );
    expect(compileCount).toBe(0);
    expect(rasterPreflightCount).toBe(1);

    const sourceGif = await collectAnimatedRaster((sink) =>
      engine.renderToAnimatedGif(scene, options, sink),
    );
    expect(compileCount).toBe(1);
    expect(rasterPreflightCount).toBe(2);
    expect(compiledGif).toEqual(sourceGif);
  });

  it("accepts a layout transition CompiledScene directly", async () => {
    const captured: CapturedRasterSession[] = [];
    const engine = createEngine({
      openAnimatedRasterSessionFn: captureRasterSession(encodeAnimatedGif, captured),
    });
    const compiled = engine.compileLayoutTransition(createPortableLayoutTransitionInput());
    const timesMs = PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS.map((checkpoint) => checkpoint.timeMs);
    const gif = await collectAnimatedRaster((sink) =>
      engine.renderCompiledToAnimatedGif(
        compiled,
        {
          timesMs,
          frameDurationsMs: [300, 400, 300, 100],
          iterations: 2,
        },
        sink,
      ),
    );

    expect(readSignature(gif)).toBe("GIF89a");
    expect(readCanvasSize(gif)).toEqual({ width: 480, height: 480 });
    expect(readFrameDelaysCs(gif)).toEqual([30, 40, 30, 10]);
    expect(readLoopCount(gif)).toBe(1);
    expect(captured[0]?.iterations).toBe(2);
    expect(captured[0]?.frames).toHaveLength(timesMs.length);
    for (const [index, timeMs] of timesMs.entries()) {
      expect(captured[0]?.frames[index]).toEqual({
        svg: engine.renderCompiledToSvg(compiled, { timeMs }),
        durationMs: [300, 400, 300, 100][index],
      });
    }
  });

  it("derives centisecond delays from the frame schedule", async () => {
    const gif = await collectAnimatedRaster((sink) =>
      createEngine().renderToAnimatedGif(
        createFadingScene(),
        {
          iterations: "infinite",
          durationMs: 500,
          fps: 10,
        },
        sink,
      ),
    );

    // Five 100 ms frames become five 10 cs delays.
    expect(readFrameDelaysCs(gif)).toEqual([10, 10, 10, 10, 10]);
  });

  it("keeps the total delay equal to the animation length", async () => {
    // 33/34 ms frames: independent rounding would lose a centisecond per pair.
    const gif = await collectAnimatedRaster((sink) =>
      createEngine().renderToAnimatedGif(
        createFadingScene(),
        {
          iterations: "infinite",
          durationMs: 1000,
          fps: 30,
        },
        sink,
      ),
    );

    const delays = readFrameDelaysCs(gif);
    expect(delays).toHaveLength(30);
    expect(delays.reduce((sum, delay) => sum + delay, 0)).toBe(100);
  });

  it("maps total plays to the GIF repeat extension", async () => {
    const engine = createEngine();
    const scene = createFadingScene();

    for (const [iterations, expectedField] of [
      ["infinite", 0],
      [1, undefined],
      [2, 1],
      [65_535, 65_534],
      [65_536, 65_535],
    ] as const) {
      expect(
        readLoopCount(
          await collectAnimatedRaster((sink) =>
            engine.renderToAnimatedGif(scene, { durationMs: 200, fps: 10, iterations }, sink),
          ),
        ),
      ).toBe(expectedField);
    }
  });

  it("applies scale through the shared emitted-root dimensions", async () => {
    const gif = await collectAnimatedRaster((sink) =>
      createEngine().renderToAnimatedGif(
        createFadingScene(),
        {
          iterations: "infinite",
          durationMs: 200,
          fps: 10,
          scale: 2,
        },
        sink,
      ),
    );

    expect(readCanvasSize(gif)).toEqual({ width: 120, height: 80 });
  });

  it("keeps scale auto-adjustment and warning delivery identical for compiled input", async () => {
    const scene = createElement("Canvas", { width: 2000, height: 500 });
    const run = async (compiledInput: boolean) => {
      const captured: CapturedRasterSession[] = [];
      const adjustments: Array<{ requestedScale: number; appliedScale: number }> = [];
      const warningCodes: string[] = [];
      const engine = createEngine({
        openAnimatedRasterSessionFn: captureRasterSession(createMockRasterSession, captured),
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
        await collectAnimatedRaster((sink) =>
          engine.renderCompiledToAnimatedGif(engine.compile(scene), options, sink),
        );
      } else {
        await collectAnimatedRaster((sink) => engine.renderToAnimatedGif(scene, options, sink));
      }
      return { adjustments, warningCodes, svg: captured[0]?.frames[0]?.svg };
    };

    const source = await run(false);
    const compiled = await run(true);
    expect(compiled).toEqual(source);
    expect(compiled.adjustments).toHaveLength(1);
    expect(compiled.warningCodes).toEqual(["PNG_RESOLUTION_ADJUSTED"]);
    expect(compiled.svg).toContain('width="3840"');
  });

  it("produces identical bytes for identical input", async () => {
    const engine = createEngine();
    const first = await collectAnimatedRaster((sink) =>
      engine.renderToAnimatedGif(
        createFadingScene(),
        {
          iterations: "infinite",
          durationMs: 400,
          fps: 10,
        },
        sink,
      ),
    );
    const second = await collectAnimatedRaster((sink) =>
      engine.renderToAnimatedGif(
        createFadingScene(),
        {
          iterations: "infinite",
          durationMs: 400,
          fps: 10,
        },
        sink,
      ),
    );

    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it("reports GIF-specific schedule error codes", async () => {
    const engine = createEngine();
    const scene = createFadingScene();

    try {
      await collectAnimatedRaster((sink) =>
        engine.renderToAnimatedGif(scene, { iterations: "infinite", timesMs: [0, 100] }, sink),
      );
      expect.unreachable("a schedule without frameDurationsMs must be rejected");
    } catch (error) {
      expect((error as FatalError).code).toBe("ANIMATED_GIF_INVALID_SCHEDULE");
    }
  });

  it("requires a valid total play count before sampling or encoding", async () => {
    let encodeCount = 0;
    const engine = createEngine({
      openAnimatedRasterSessionFn: () => {
        encodeCount += 1;
        throw new Error("invalid input must fail before session.open");
      },
    });
    const invalidIterations: unknown[] = [
      undefined,
      0,
      -1,
      1.5,
      65_537,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      "forever",
    ];

    for (const iterations of invalidIterations) {
      try {
        await collectAnimatedRaster((sink) =>
          engine.renderToAnimatedGif(
            createFadingScene(),
            {
              durationMs: 200,
              iterations,
            } as RenderAnimatedGifOptions,
            sink,
          ),
        );
        expect.unreachable(`iterations ${String(iterations)} must be rejected`);
      } catch (error) {
        expect(error, String(iterations)).toBeInstanceOf(FatalError);
        expect((error as FatalError).code, String(iterations)).toBe(
          "ANIMATED_GIF_INVALID_SCHEDULE",
        );
      }
    }
    expect(encodeCount).toBe(0);
  });

  it.each([
    326, 1001,
  ])("encodes every frame of a long sampled GIF with %i frames", async (frameCount) => {
    const engine = createEngine();
    const bytes = await collectAnimatedRaster((sink) =>
      engine.renderToAnimatedGif(
        createElement("Canvas", { width: 2, height: 2, background: "#369" }),
        { durationMs: frameCount * 100, fps: 10, iterations: 1 },
        sink,
      ),
    );
    expect(readFrameDelaysCs(bytes)).toEqual(Array.from({ length: frameCount }, () => 10));
    expect(bytes.at(-1)).toBe(0x3b);
    engine.dispose();
  }, 120000);

  it("reports GIF_NO_ENCODER when no encoder is wired", async () => {
    const engine = createEngineFromHandle(handle, { openAnimatedRasterSessionFn: undefined });

    try {
      await collectAnimatedRaster((sink) =>
        engine.renderToAnimatedGif(
          createFadingScene(),
          { iterations: "infinite", durationMs: 200 },
          sink,
        ),
      );
      expect.unreachable("renderToAnimatedGif must fail without an encoder");
    } catch (error) {
      expect(error).toBeInstanceOf(FatalError);
      expect((error as FatalError).code).toBe("GIF_NO_ENCODER");
    }
  });

  it("emits exactly the delays the TS-side derivation predicts", async () => {
    // The derivation is duplicated: Rust owns the bytes, TS needs it to decide
    // whether to warn. Comparing against the encoded container pins both.
    const engine = createEngine();
    const cases: Array<{ durationMs: number; fps: number }> = [
      { durationMs: 500, fps: 10 },
      { durationMs: 1000, fps: 30 },
      { durationMs: 1000, fps: 60 },
      { durationMs: 333, fps: 12 },
    ];

    for (const { durationMs, fps } of cases) {
      const schedule = expectedSampledSchedule({ durationMs, fps });
      const gif = await collectAnimatedRaster((sink) =>
        engine.renderToAnimatedGif(
          createFadingScene(),
          {
            iterations: "infinite",
            durationMs,
            fps,
          },
          sink,
        ),
      );
      expect(readFrameDelaysCs(gif), `${durationMs} ms at ${fps} fps`).toEqual(
        expectedGifDelaysCs(schedule.frameDurationsMs),
      );
    }
  });

  it("agrees with the encoder on a heterogeneous explicit schedule", async () => {
    // Uniform sampling never exercises the carry or the floor together; an
    // explicit schedule is the only route to mixed short and long frames.
    const frameDurationsMs = [5, 5, 190, 5, 1];
    const gif = await collectAnimatedRaster((sink) =>
      createEngine().renderToAnimatedGif(
        createFadingScene(),
        {
          iterations: "infinite",
          timesMs: [0, 5, 10, 200, 205],
          frameDurationsMs,
        },
        sink,
      ),
    );

    expect(expectedGifDelaysCs(frameDurationsMs)).toEqual([2, 2, 19, 2, 2]);
    expect(readFrameDelaysCs(gif)).toEqual([2, 2, 19, 2, 2]);
  });

  it("rejects an invalid scale the way renderToWebp does", async () => {
    const engine = createEngine();

    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      try {
        await collectAnimatedRaster((sink) =>
          engine.renderToAnimatedGif(
            createFadingScene(),
            {
              iterations: "infinite",
              durationMs: 200,
              scale,
            },
            sink,
          ),
        );
        expect.unreachable(`scale ${String(scale)} must be rejected`);
      } catch (error) {
        expect((error as FatalError).code, String(scale)).toBe("PNG_INVALID_SCALE");
      }
    }
  });

  it("derives the same delays the encoder writes", () => {
    // The TS derivation exists so the engine can decide whether to warn; the
    // encoder owns the bytes. Recompute independently and compare.
    for (let seed = 0; seed < 400; seed++) {
      const frameDurationsMs = Array.from(
        { length: 1 + (seed % 7) },
        (_unused, index) => ((seed * 37 + index * 13) % 120) + 1,
      );
      const delays = expectedGifDelaysCs(frameDurationsMs);
      let elapsedMs = 0;
      let previousCs = 0;
      frameDurationsMs.forEach((durationMs, index) => {
        elapsedMs += durationMs;
        const boundaryCs = Math.floor((elapsedMs + 5) / 10);
        const rawCs = boundaryCs - previousCs;
        previousCs = boundaryCs;
        expect(delays[index], `${frameDurationsMs.join(",")} @${index}`).toBe(Math.max(2, rawCs));
      });
    }
  });

  it("tells a sampled caller to change the schedule, not the frames", async () => {
    const messages: string[] = [];
    await collectAnimatedRaster((sink) =>
      createEngine().renderToAnimatedGif(
        createFadingScene(),
        {
          iterations: "infinite",
          durationMs: 150,
          fps: 1,
          onWarning: (warning) => messages.push(warning.message),
        },
        sink,
      ),
    );
    // The 1 ms frame that trips this is synthesized by the schedule, so
    // "keep every frame longer" is not something the caller can act on.
    expect(messages.join("")).toContain("Raise durationMs, or lower fps");

    const explicit: string[] = [];
    await collectAnimatedRaster((sink) =>
      createEngine().renderToAnimatedGif(
        createFadingScene(),
        {
          iterations: "infinite",
          timesMs: [0],
          frameDurationsMs: [15],
          onWarning: (warning) => explicit.push(warning.message),
        },
        sink,
      ),
    );
    expect(explicit.join("")).toContain("frameDurationsMs entry");
  });

  it("warns when the centisecond floor stretches the animation", async () => {
    const engine = createEngine();
    const warnCodes = async (
      options: Omit<Parameters<typeof engine.renderToAnimatedGif>[1], "iterations">,
    ): Promise<string[]> => {
      const codes: string[] = [];
      await collectAnimatedRaster((sink) =>
        engine.renderToAnimatedGif(
          createFadingScene(),
          {
            iterations: "infinite",
            ...options,
            onWarning: (warning) => codes.push(warning.code),
          },
          sink,
        ),
      );
      return codes;
    };

    // Playback more than 5% longer than asked for.
    for (const options of [
      { durationMs: 1000, fps: 60 },
      { durationMs: 33, fps: 60 },
      { durationMs: 50, fps: 60 },
      // Short sampled durations stretch at ordinary rates too, because the
      // last frame boundary is anchored to durationMs.
      { durationMs: 150, fps: 1 },
      { durationMs: 151, fps: 20 },
      // Explicit sub-20 ms frames the caller wrote out.
      { timesMs: [0, 19, 38, 57, 76], frameDurationsMs: [19, 19, 19, 19, 19] },
      { timesMs: [0], frameDurationsMs: [15] },
    ]) {
      expect(await warnCodes(options), JSON.stringify(options)).toContain(
        "ANIMATED_GIF_TIMING_ADJUSTED",
      );
    }

    // Quiet where the 10 ms quantum alone accounts for the difference: any
    // durationMs off the frame grid leaves a short tail frame, which stretches
    // playback by well under the threshold once the animation is long enough.
    for (const options of [
      { durationMs: 1000, fps: 50 },
      { durationMs: 1001, fps: 20 },
      { durationMs: 2050, fps: 24 },
      { durationMs: 2000, fps: 24 },
      { timesMs: [0, 5, 505], frameDurationsMs: [5, 500, 500] },
    ]) {
      expect(await warnCodes(options), JSON.stringify(options)).not.toContain(
        "ANIMATED_GIF_TIMING_ADJUSTED",
      );
    }
  });

  it("keeps GIF quantum and timing warnings identical for compiled input", async () => {
    const engine = createEngine();
    const scene = createFadingScene();
    const compiled = engine.compile(scene);
    const options = { timesMs: [0], frameDurationsMs: [15] } as const;
    const sourceWarnings: string[] = [];
    const compiledWarnings: string[] = [];

    const source = await collectAnimatedRaster((sink) =>
      engine.renderToAnimatedGif(
        scene,
        {
          iterations: "infinite",
          ...options,
          onWarning: (warning) => sourceWarnings.push(warning.code),
        },
        sink,
      ),
    );
    const prepared = await collectAnimatedRaster((sink) =>
      engine.renderCompiledToAnimatedGif(
        compiled,
        {
          ...options,
          iterations: "infinite",
          onWarning: (warning) => compiledWarnings.push(warning.code),
        },
        sink,
      ),
    );

    expect(readFrameDelaysCs(source)).toEqual([2]);
    expect(readFrameDelaysCs(prepared)).toEqual([2]);
    expect(prepared).toEqual(source);
    expect(compiledWarnings).toEqual(sourceWarnings);
    expect(compiledWarnings).toEqual(["ANIMATED_GIF_TIMING_ADJUSTED"]);
  });
});
