import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { createAnimatedRasterJob, OwnedAnimatedRasterJob } from "../../src/animation-job.js";
import {
  createAnimatedRasterCollector,
  createAnimatedWebpSpoolSink,
} from "../../src/animation-output.js";
import { resolveAnimationScheduleDescriptor } from "../../src/animation-schedule.js";
import type { EngineOptions, RenderAnimatedGifOptions } from "../../src/engine.js";
import { Engine } from "../../src/engine.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { AnimationSessionOpenInput } from "../../src/wasm/animation-session.js";
import { WasmEngineHandle, WasmRasterSceneHandle } from "../../src/wasm/index.js";
import type { WasmEngineInstance } from "../../src/wasm/types.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function harness() {
  const events: string[] = [];
  const ir = {
    width: 8,
    height: 4,
    drawOrder: [],
    root: { type: "group", nodeId: "canvas", bbox: { x: 0, y: 0, w: 8, h: 4 }, children: [] },
  };
  let sampledTimes: number[] = [];
  let lastOpen: AnimationSessionOpenInput | undefined;
  const compiledInputs: string[] = [];
  const optionsAtCompile: string[] = [];
  let registeredFont = "entry-font";
  const engineOptions: EngineOptions = {
    fontFamilies: { sansSerif: "entry-family" },
    registerFontFn: (font) => {
      registeredFont = font.alias;
    },
    computeLayoutFn: () => "{}",
    renderToIrFn: (input) => {
      events.push("compile");
      compiledInputs.push(input);
      optionsAtCompile.push(registeredFont);
      expect(input).toContain('"nodeType":"canvas"');
      return JSON.stringify({ ir, warnings: [] });
    },
    preflightRasterSceneFn: () => {
      events.push("prepare");
      const owner = new WasmEngineHandle({
        resolve_raster_scene: () => events.push("resolve"),
      } as unknown as WasmEngineInstance);
      return new WasmRasterSceneHandle(owner, { free: () => events.push("producer-return") });
    },
    openAnimatedRasterSessionFn: (input) => {
      lastOpen = input;
      events.push("open");
      let pending: Uint8Array | null = null;
      let pushed = 0;
      return {
        push: (_scene, timeMs, durationMs) => {
          sampledTimes.push(timeMs);
          events.push(`sample:${timeMs}`);
          pushed += 1;
          events.push(`push:${durationMs}`);
          pending = Uint8Array.of(pushed);
        },
        readChunk: () => {
          const chunk = pending;
          pending = null;
          return chunk;
        },
        finish: () => {
          events.push("container-finish");
          return {
            format: input.format,
            frameCount: pushed,
            bytesWritten: pushed,
            ...(input.format === "webp"
              ? { patch: { offset: 4 as const, bytes: Uint8Array.of(1, 0, 0, 0) } }
              : {}),
          };
        },
        abort: () => {
          events.push("session-abort");
        },
        dispose: () => {
          events.push("session-dispose");
        },
      };
    },
  };
  const engine = new Engine(engineOptions);
  const scene = createElement("Canvas", { width: 8, height: 4 });
  const options: RenderAnimatedGifOptions = {
    timesMs: [0, 1],
    frameDurationsMs: [17, 17],
    iterations: 1,
  };
  return {
    engine,
    engineOptions,
    compiledInputs,
    optionsAtCompile,
    scene,
    options,
    events,
    times: () => sampledTimes,
    opened: () => lastOpen,
    clearTimes: () => {
      sampledTimes = [];
    },
  };
}

describe("shared animated raster job", () => {
  it("shares diagnostic constructors and authentic job factories across CommonJS entries", async () => {
    const require = createRequire(import.meta.url);
    const core = require("../../dist/index.cjs") as typeof import("../../src/index.js");
    const wasm = require("../../dist/wasm.cjs") as typeof import("../../src/wasm.js");
    const fatal = new core.FatalError("ANIMATED_RASTER_SINK_FAILED", "Storage write failed", {
      stage: "emit",
      context: { format: "gif", operation: "write", reason: "write", field: "sink" },
    });
    expect(wasm.decodeAnimatedRasterFatal(fatal)).toBeInstanceOf(core.FatalError);
    expect(wasm.decodeAnimatedRasterFatal(fatal.toJSON())).toBeInstanceOf(core.FatalError);

    const engine = await core.createEngineAsync({});
    const input = {
      format: "gif" as const,
      source: {
        kind: "scene" as const,
        input: core.createElement("Canvas", { width: 8, height: 4 }),
      },
      options: { timesMs: [0, 1], frameDurationsMs: [17, 17], iterations: 1 },
    };
    try {
      const job = wasm.createAnimatedRasterJob(engine, input);
      job.dispose();
      const nextJob = wasm.createAnimatedRasterJob(engine, input);
      nextJob.dispose();
    } finally {
      engine.dispose();
    }
  });

  it("delivers ready before opening or sampling and closes the producer on the last sample", () => {
    const fixture = harness();
    const job = createAnimatedRasterJob(fixture.engine, {
      format: "gif",
      source: { kind: "scene", input: fixture.scene },
      options: fixture.options,
    });
    expect(fixture.events).toEqual([]);
    const ready = job.advance();
    expect(ready.kind).toBe("ready");
    expect(fixture.events).toEqual(["compile", "prepare", "resolve"]);
    expect(job.advance().kind).toBe("chunk");
    expect(job.advance().kind).toBe("chunk");
    expect(fixture.events.at(-1)).toBe("producer-return");
    expect(job.advance().kind).toBe("finished");
    expect(fixture.events).toContain("session-dispose");
    expect(() => job.advance()).toThrow(/alreadyFinished/);
    job.dispose();
  });

  it("scans all explicit entries before compile and aborts an adopted sink on late invalid input", async () => {
    const fixture = harness();
    const abort = vi.fn();
    await expect(
      fixture.engine.renderToAnimatedGif(
        fixture.scene,
        { ...fixture.options, timesMs: [0, NaN] },
        { write: vi.fn(), finish: vi.fn(), abort },
      ),
    ).rejects.toMatchObject({ code: "ANIMATED_GIF_INVALID_SCHEDULE" });
    expect(fixture.events).toEqual([]);
    expect(abort).toHaveBeenCalledOnce();
    await fixture.engine.renderToAnimatedGif(
      fixture.scene,
      fixture.options,
      createAnimatedRasterCollector(),
    );
  });

  it("holds the token across pending writes and abort cleanup without adopting nested sinks", async () => {
    const fixture = harness();
    const write = deferred<void>();
    const cleanup = deferred<void>();
    const started = deferred<void>();
    const controller = new AbortController();
    const sink = {
      write: vi.fn(() => {
        started.resolve();
        return write.promise;
      }),
      finish: vi.fn(),
      abort: vi.fn(() => cleanup.promise),
    };
    const pending = fixture.engine.renderToAnimatedGif(fixture.scene, fixture.options, sink, {
      signal: controller.signal,
    });
    await started.promise;
    controller.abort();
    await expect(
      fixture.engine.renderToAnimatedGif(fixture.scene, fixture.options, sink),
    ).rejects.toMatchObject({ code: "ANIMATED_RASTER_JOB_BUSY" });
    expect(sink.abort).not.toHaveBeenCalled();
    write.resolve();
    await vi.waitFor(() => expect(sink.abort).toHaveBeenCalledOnce());
    await expect(
      fixture.engine.renderToAnimatedGif(
        fixture.scene,
        fixture.options,
        createAnimatedRasterCollector(),
      ),
    ).rejects.toMatchObject({ code: "ANIMATED_RASTER_JOB_BUSY" });
    cleanup.resolve();
    await expect(pending).rejects.toMatchObject({ code: "ANIMATED_RASTER_ABORTED" });
    expect(sink.write).toHaveBeenCalledOnce();
    expect(sink.finish).not.toHaveBeenCalled();
    await fixture.engine.renderToAnimatedGif(
      fixture.scene,
      fixture.options,
      createAnimatedRasterCollector(),
    );
  });

  it("preserves successful already-called finish during cooperative cancellation", async () => {
    const fixture = harness();
    const finish = deferred<void>();
    const started = deferred<void>();
    const controller = new AbortController();
    const sink = {
      write: vi.fn(),
      finish: vi.fn(() => {
        started.resolve();
        return finish.promise;
      }),
      abort: vi.fn(),
    };
    const pending = fixture.engine.renderToAnimatedGif(fixture.scene, fixture.options, sink, {
      signal: controller.signal,
    });
    await started.promise;
    controller.abort();
    finish.resolve();
    await expect(pending).resolves.toMatchObject({ format: "gif", frameCount: 2 });
    expect(sink.abort).not.toHaveBeenCalled();
    await fixture.engine.renderToAnimatedGif(
      fixture.scene,
      fixture.options,
      createAnimatedRasterCollector(),
    );
  });

  it("keeps an already-called spool finish pending through cancellation and completes its forwarding", async () => {
    const fixture = harness();
    const controller = new AbortController();
    const write = deferred<void>();
    const started = deferred<void>();
    const destination = {
      write: vi.fn(() => {
        started.resolve();
        return write.promise;
      }),
      finish: vi.fn(),
      abort: vi.fn(),
    };
    const dispose = vi.fn(async () => undefined);
    const spool = {
      sink: { write: vi.fn(), patch: vi.fn(), finish: vi.fn(), abort: vi.fn() },
      read: vi.fn(async (offset: number) =>
        offset < 2 ? Uint8Array.of(offset + 1) : new Uint8Array(0),
      ),
      dispose,
    };
    const forward = createAnimatedWebpSpoolSink(spool, destination);
    const pending = fixture.engine.renderToAnimatedWebp(fixture.scene, fixture.options, forward, {
      signal: controller.signal,
    });
    await started.promise;
    controller.abort();
    expect(destination.finish).not.toHaveBeenCalled();
    const unadopted = createAnimatedRasterCollector();
    try {
      await expect(
        fixture.engine.renderToAnimatedWebp(fixture.scene, fixture.options, unadopted),
      ).rejects.toMatchObject({ code: "ANIMATED_RASTER_JOB_BUSY" });
      expect(destination.abort).not.toHaveBeenCalled();
    } finally {
      unadopted.abort("caller-owned fresh sink");
    }
    write.resolve();
    await expect(pending).resolves.toMatchObject({ format: "webp", frameCount: 2 });
    expect(destination.write).toHaveBeenCalledTimes(2);
    expect(destination.finish).toHaveBeenCalledOnce();
    expect(destination.abort).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    await forward.abort("late cleanup");
    expect(dispose).toHaveBeenCalledOnce();
    fixture.engine.dispose();
  });

  it("snapshots schedules once before await and delivers timing warnings before open", async () => {
    const fixture = harness();
    const write = deferred<void>();
    let writes = 0;
    const options = {
      ...fixture.options,
      timesMs: [0, 1],
      frameDurationsMs: [17, 17],
      onWarning: () => {
        fixture.events.push("warning");
      },
    };
    const pending = fixture.engine.renderToAnimatedGif(fixture.scene, options, {
      write: () => {
        writes += 1;
        return writes === 1 ? write.promise : undefined;
      },
      finish: () => undefined,
      abort: () => undefined,
    });
    options.timesMs[1] = 900;
    options.frameDurationsMs[1] = 999;
    write.resolve();
    await pending;
    expect(fixture.times()).toEqual([0, 1]);
    expect(fixture.events.indexOf("warning")).toBeLessThan(fixture.events.indexOf("open"));
    expect(fixture.events.filter((event) => event === "push:17")).toHaveLength(2);
  });

  it.each([
    "gif",
    "webp",
  ] as const)("%s reads shape and shaping registries only after the complete schedule scan", (format) => {
    const fixture = harness();
    const scene = createElement(
      "Canvas",
      { width: 8, height: 4 },
      createElement("Shape", { geometryId: "scan-shape", width: 2, height: 2 }),
    );
    fixture.engine.registerGeometry("scan-shape", {
      viewBox: { width: 2, height: 2 },
      root: { kind: "path", d: "M0 0H1V1H0Z" },
    });
    const job = createAnimatedRasterJob(fixture.engine, {
      format,
      source: { kind: "scene", input: scene },
      options: {
        timesMs: Array.from({ length: 4097 }, (_, index) => index),
        frameDurationsMs: new Array<number>(4097).fill(20),
        iterations: 1,
      },
    });
    try {
      expect(job.advance()).toEqual({ kind: "preparing" });
      expect(fixture.compiledInputs).toEqual([]);
      fixture.engine.registerGeometry("scan-shape", {
        viewBox: { width: 2, height: 2 },
        root: { kind: "path", d: "M0 0H2V2H0Z" },
      });
      fixture.engine.registerFonts([{ alias: "scan-font", data: Uint8Array.of(1) }]);
      expect(job.advance().kind).toBe("ready");
      expect(fixture.compiledInputs).toHaveLength(1);
      expect(fixture.compiledInputs[0]).toContain("M0 0H2V2H0Z");
      expect(fixture.compiledInputs[0]).not.toContain("M0 0H1V1H0Z");
      expect(fixture.optionsAtCompile).toEqual(["scan-font"]);
    } finally {
      job.dispose();
      fixture.engine.dispose();
    }
  });

  it("reads raster font mappings after ready warning callbacks and detaches them at open", async () => {
    const fixture = harness();
    const pending = fixture.engine.renderToAnimatedGif(
      fixture.scene,
      {
        ...fixture.options,
        onWarning: () => {
          fixture.engineOptions.fontFamilies = { sansSerif: "ready-family" };
          fixture.engine.registerFonts([{ alias: "ready-font", data: Uint8Array.of(2) }]);
        },
      },
      {
        write: () => {
          fixture.engineOptions.fontFamilies = { sansSerif: "write-family" };
        },
        finish: () => undefined,
        abort: () => undefined,
      },
    );
    await pending;
    expect(fixture.optionsAtCompile).toEqual(["entry-font"]);
    expect(fixture.opened()?.options.fontFamilies).toEqual({ sansSerif: "ready-family" });
    expect(fixture.engineOptions.fontFamilies).toEqual({ sansSerif: "write-family" });
    fixture.engine.dispose();
  });

  it("does not adopt sinks on malformed sink/options/signal or a foreign compiled capability", async () => {
    const fixture = harness();
    const sink = { write: vi.fn(), finish: vi.fn(), abort: vi.fn() };
    await expect(
      fixture.engine.renderToAnimatedGif(
        fixture.scene,
        fixture.options,
        undefined as unknown as typeof sink,
      ),
    ).rejects.toMatchObject({ context: { reason: "missingField" } });
    await expect(
      fixture.engine.renderToAnimatedGif(fixture.scene, fixture.options, sink, {
        signal: { aborted: false } as unknown as AbortSignal,
      }),
    ).rejects.toMatchObject({ context: { reason: "wrongType" } });
    await expect(
      fixture.engine.renderToAnimatedGif(
        fixture.scene,
        { ...fixture.options, onWarning: null } as unknown as RenderAnimatedGifOptions,
        sink,
      ),
    ).rejects.toMatchObject({ context: { reason: "nullField" } });
    expect(sink.abort).not.toHaveBeenCalled();
  });

  it("prepares no source in the first bounded scan batch and can cancel before compile", () => {
    const descriptor = resolveAnimationScheduleDescriptor(
      { fps: 60, durationMs: 1e6 },
      { format: "gif", invalidSchedule: "ANIMATED_GIF_INVALID_SCHEDULE" },
    );
    const prepare = vi.fn(() => {
      throw new Error("unexpected compile");
    });
    const job = new OwnedAnimatedRasterJob({
      format: "gif",
      descriptor,
      isDisposed: () => false,
      prepare,
      open: () => {
        throw new Error("unexpected open");
      },
      release: vi.fn(),
    });
    expect(job.advance()).toEqual({ kind: "preparing" });
    expect(prepare).not.toHaveBeenCalled();
    job.abort();
    job.dispose();
  });
});
