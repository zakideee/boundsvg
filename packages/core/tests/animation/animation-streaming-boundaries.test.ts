import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { createAnimatedRasterCollector } from "../../src/animation-output.js";
import { createEngineAsync, Engine, type RenderAnimatedGifOptions } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import { createWasmEngineInstance } from "../../src/wasm/index.js";
import { createEngineFromHandle } from "../helpers/wasm-render-engine.js";

/** Valid raster input keeps strict boundary checks independent of scene decoding. */
const SCENE = createElement("Canvas", { width: 8, height: 8, background: "#fff" });

for (const format of ["webp", "gif"] as const) {
  describe(`${format} streaming entrance boundaries`, () => {
    it("rejects timeMs on direct, compiled and compiled-transition options before adopting the sink", async () => {
      const engine = await createEngineAsync({});
      const sink = { write: vi.fn(), patch: vi.fn(), finish: vi.fn(), abort: vi.fn() };
      try {
        const compiled = engine.compile(SCENE);
        const transition = engine.compileLayoutTransition({
          states: {
            A: { type: "Canvas", id: "canvas", width: 8, height: 8, children: [] },
            B: { type: "Canvas", id: "canvas", width: 8, height: 8, children: [] },
          },
          checkpoints: [
            { timeMs: 0, state: "A" },
            { timeMs: 5, state: "B" },
            { timeMs: 15, state: "B" },
            { timeMs: 20, state: "A" },
          ],
        });
        const options = { durationMs: 20, fps: 20, iterations: 1, timeMs: 0 };
        await expect(
          format === "webp"
            ? engine.renderToAnimatedWebp(SCENE, options, sink)
            : engine.renderToAnimatedGif(SCENE, options, sink),
        ).rejects.toMatchObject({ code: "UNSUPPORTED_RENDER_OPTION" });
        for (const scene of [compiled, transition]) {
          await expect(
            format === "webp"
              ? engine.renderCompiledToAnimatedWebp(scene, options, sink)
              : engine.renderCompiledToAnimatedGif(scene, options, sink),
          ).rejects.toMatchObject({ code: "UNSUPPORTED_RENDER_OPTION" });
        }
        expect(sink.write).not.toHaveBeenCalled();
        expect(sink.abort).not.toHaveBeenCalled();
      } finally {
        engine.dispose();
      }
    });
    it("accepts cross-realm explicit arrays, non-monotonic times and optional undefined", async () => {
      const engine = await createEngineAsync({});
      const collector = createAnimatedRasterCollector();
      try {
        const arrays = runInNewContext("({timesMs:[9,0,9],frameDurationsMs:[1,25,60000]})") as {
          timesMs: number[];
          frameDurationsMs: number[];
        };
        const options = { ...arrays, iterations: 1, fps: undefined, durationMs: undefined };
        const result =
          format === "webp"
            ? await engine.renderToAnimatedWebp(SCENE, options, collector)
            : await engine.renderToAnimatedGif(SCENE, options, collector);
        expect(result.frameCount).toBe(3);
        expect(collector.takeBytes().length).toBe(result.bytesWritten);
      } finally {
        await collector.abort("caller cleanup");
        engine.dispose();
      }
    });

    it("copies cross-realm schedule indices without custom iterator or species hooks", async () => {
      const engine = await createEngineAsync({});
      const collector = createAnimatedRasterCollector();
      const arrays = runInNewContext("({timesMs:[9,0,9],frameDurationsMs:[20,25,30]})") as {
        timesMs: number[];
        frameDurationsMs: number[];
      };
      const unexpected = vi.fn(() => {
        throw new Error("Unexpected schedule iterable hook");
      });
      for (const array of [arrays.timesMs, arrays.frameDurationsMs]) {
        Object.defineProperty(array, Symbol.iterator, { value: unexpected });
        Object.defineProperty(array, "constructor", { get: unexpected });
      }
      try {
        const result =
          format === "webp"
            ? await engine.renderToAnimatedWebp(SCENE, { ...arrays, iterations: 1 }, collector)
            : await engine.renderToAnimatedGif(SCENE, { ...arrays, iterations: 1 }, collector);
        expect(result.frameCount).toBe(3);
        expect(collector.takeBytes().length).toBe(result.bytesWritten);
        expect(unexpected).not.toHaveBeenCalled();
      } finally {
        await collector.abort("cleanup");
        engine.dispose();
      }
    });

    it.each([
      { durationMs: 1, fps: null },
      { durationMs: null },
      { durationMs: 1, timesMs: null },
      { durationMs: 1, timesMs: false },
      { durationMs: 1, frameDurationsMs: null },
      { timesMs: new Float64Array([0]), frameDurationsMs: [20] },
      { timesMs: new Set([0]), frameDurationsMs: [20] },
      { timesMs: [0], frameDurationsMs: new Uint16Array([20]) },
      { timesMs: [0], frameDurationsMs: null },
      { durationMs: 1, fps: "20" },
      { durationMs: 1, fps: Object(20) },
      { durationMs: 1, fps: Number.NaN },
    ])("rejects malformed schedule before compilation: %j", async (malformed) => {
      const compile = vi.fn(() => {
        throw new Error("unexpected compilation");
      });
      const engine = new Engine({
        computeLayoutFn: () => "{}",
        renderToIrFn: compile,
        preflightRasterSceneFn: () => {
          throw new Error("unexpected preparation");
        },
        openAnimatedRasterSessionFn: () => {
          throw new Error("unexpected native session");
        },
      });
      const collector = createAnimatedRasterCollector();
      const options = { ...malformed, iterations: 1 } as unknown as RenderAnimatedGifOptions;
      try {
        const promise =
          format === "webp"
            ? engine.renderToAnimatedWebp(SCENE, options, collector)
            : engine.renderToAnimatedGif(SCENE, options, collector);
        await expect(promise).rejects.toMatchObject({
          code:
            format === "webp" ? "ANIMATED_WEBP_INVALID_SCHEDULE" : "ANIMATED_GIF_INVALID_SCHEDULE",
        });
        expect(compile).not.toHaveBeenCalled();
      } finally {
        await collector.abort("fresh sink cleanup");
        engine.dispose();
      }
    });

    it("rejects late invalid entries before compile even after a yielded scan batch", async () => {
      const compile = vi.fn(() => {
        throw new Error("unexpected compilation");
      });
      const engine = new Engine({
        computeLayoutFn: () => "{}",
        renderToIrFn: compile,
        preflightRasterSceneFn: () => {
          throw new Error("unexpected preparation");
        },
        openAnimatedRasterSessionFn: () => {
          throw new Error("unexpected native session");
        },
      });
      const collector = createAnimatedRasterCollector();
      const options = {
        timesMs: Array.from({ length: 5000 }, (_, index) => index),
        frameDurationsMs: new Array<number>(5000).fill(20),
        iterations: 1,
      };
      options.timesMs[4999] = Number.NaN;
      try {
        const promise =
          format === "webp"
            ? engine.renderToAnimatedWebp(SCENE, options, collector)
            : engine.renderToAnimatedGif(SCENE, options, collector);
        await expect(promise).rejects.toMatchObject({
          code:
            format === "webp" ? "ANIMATED_WEBP_INVALID_SCHEDULE" : "ANIMATED_GIF_INVALID_SCHEDULE",
        });
        expect(compile).not.toHaveBeenCalled();
      } finally {
        await collector.abort("cleanup");
        engine.dispose();
      }
    });

    it("checks disposal caused by a snapshot getter before compilation", async () => {
      const compile = vi.fn(() => {
        throw new Error("unexpected compilation");
      });
      const engine = new Engine({
        computeLayoutFn: () => "{}",
        renderToIrFn: compile,
        preflightRasterSceneFn: () => {
          throw new Error("unexpected preparation");
        },
        openAnimatedRasterSessionFn: () => {
          throw new Error("unexpected native session");
        },
      });
      const input = createElement("Canvas", { width: 8, height: 8 });
      Object.defineProperty(input.props, "background", {
        enumerable: true,
        get() {
          engine.dispose();
          return "#fff";
        },
      });
      const collector = createAnimatedRasterCollector();
      try {
        const promise =
          format === "webp"
            ? engine.renderToAnimatedWebp(input, { durationMs: 1, iterations: 1 }, collector)
            : engine.renderToAnimatedGif(input, { durationMs: 1, iterations: 1 }, collector);
        await expect(promise).rejects.toMatchObject({ code: "ENGINE_DISPOSED" });
        expect(compile).not.toHaveBeenCalled();
      } finally {
        await collector.abort("cleanup");
      }
    });

    it("preserves the requested format when rejecting an unsupported snapshot object", async () => {
      const engine = await createEngineAsync({});
      const input = createElement("Canvas", { width: 8, height: 8 });
      Object.assign(input.props, { background: new Date(0) });
      const collector = createAnimatedRasterCollector();
      try {
        const promise =
          format === "webp"
            ? engine.renderToAnimatedWebp(input, { durationMs: 1, iterations: 1 }, collector)
            : engine.renderToAnimatedGif(input, { durationMs: 1, iterations: 1 }, collector);
        await expect(promise).rejects.toMatchObject({
          code: "ANIMATED_RASTER_SESSION_INVALID_INPUT",
          context: { format, operation: "open", reason: "wrongType" },
        });
      } finally {
        await collector.abort("fresh output cleanup");
        engine.dispose();
      }
    });

    it("authenticates closed write options and native AbortSignal without adopting fresh output", async () => {
      const engine = await createEngineAsync({});
      try {
        for (const control of [
          null,
          [],
          { extra: 0 },
          { signal: null },
          { signal: {} },
          { signal: { aborted: false, addEventListener() {} } },
        ]) {
          const abort = vi.fn();
          const sink = { write: vi.fn(), patch: vi.fn(), finish: vi.fn(), abort };
          const options = { durationMs: 1, iterations: 1 };
          const writeOptions = control as unknown as { signal?: AbortSignal };
          const promise =
            format === "webp"
              ? engine.renderToAnimatedWebp(SCENE, options, sink, writeOptions)
              : engine.renderToAnimatedGif(SCENE, options, sink, writeOptions);
          await expect(promise).rejects.toMatchObject({
            code: "ANIMATED_RASTER_SESSION_INVALID_INPUT",
          });
          expect(abort).not.toHaveBeenCalled();
          await sink.abort();
        }
      } finally {
        engine.dispose();
      }
    });
  });

  it.each([326, 1001])(
    `${format} encodes authored SVG totaling over 64 MiB across %i samples`,
    { timeout: 120_000 },
    async (frameCount) => {
      await initNodeWasm();
      const handle = createWasmEngineInstance();
      const openNative = handle.createOpenAnimatedRasterSessionFn();
      if (!openNative) {
        throw new Error("Missing native session");
      }
      let maximumChunk = 0;
      let currentFrame = 0;
      const engine = createEngineFromHandle(handle, {
        openAnimatedRasterSessionFn: (options) => {
          const session = openNative(options);
          return {
            push: (scene, timeMs, durationMs) => {
              currentFrame += 1;
              session.push(scene, timeMs, durationMs);
            },
            readChunk: () => session.readChunk(),
            finish: () => session.finish(),
            abort: () => session.abort(),
            dispose: () => session.dispose(),
          };
        },
      });
      // A self-authored XML comment makes each native SVG large without changing raster pixels.
      const content = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><!--${"x".repeat(240 * 1024)}--><rect width="8" height="8" fill="#e32"/></svg>`;
      const scene = createElement(
        "Canvas",
        { width: 8, height: 8 },
        createElement("Svg", { content, width: 8, height: 8 }),
      );
      const emittedFrame = engine.renderToSvg(scene, { timeMs: 0 });
      expect(emittedFrame).toContain(`<!--${"x".repeat(240 * 1024)}-->`);
      const emittedFrameBytes = new TextEncoder().encode(emittedFrame).byteLength;
      expect(emittedFrameBytes).toBeGreaterThanOrEqual(240 * 1024);
      const sink = {
        write: (chunk: Uint8Array) => {
          maximumChunk = Math.max(maximumChunk, chunk.length);
        },
        patch: vi.fn(),
        finish: vi.fn(),
        abort: vi.fn(),
      };
      try {
        const options = { durationMs: frameCount * 50, fps: 20, iterations: 1 };
        const result =
          format === "webp"
            ? await engine.renderToAnimatedWebp(scene, options, sink)
            : await engine.renderToAnimatedGif(scene, options, sink);
        expect(result.frameCount).toBe(frameCount);
        expect(currentFrame).toBe(frameCount);
        expect(emittedFrameBytes * result.frameCount).toBeGreaterThan(64 * 1024 * 1024);
        expect(maximumChunk).toBeLessThanOrEqual(65536);
        expect(sink.finish).toHaveBeenCalledOnce();
        expect(sink.abort).not.toHaveBeenCalled();
        expect(sink.patch).toHaveBeenCalledTimes(format === "webp" ? 1 : 0);
      } finally {
        engine.dispose();
        handle.dispose();
      }
    },
  );
}
