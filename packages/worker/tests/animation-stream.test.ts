import { createRequire } from "node:module";
import { type AnimatedRasterSink, FatalError, type SceneNode } from "@boundsvg/core";
import { decodeAnimatedRasterFatal } from "@boundsvg/core/wasm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerRequest, WorkerResponse } from "../src/protocol.js";
import { WorkerEngine, type WorkerLike } from "../src/worker-engine.js";
import { WorkerRequestScheduler } from "../src/worker-request-scheduler.js";

/** Minimal serialized canvas used by animation stream state and fault tests. */
const scene: SceneNode = { type: "Canvas", width: 8, height: 8, children: [] };
/** Fixed explicit-play schedule used by animation stream state tests. */
const schedule = { durationMs: 100, fps: 20, iterations: 1 as const };
/** Load distributed CommonJS entries independently of the source test resolver. */
const loadPackageEntry = createRequire(import.meta.url);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

class StreamWorker implements WorkerLike {
  requests: WorkerRequest[] = [];
  terminate = vi.fn();
  deferClose = true;
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  private pulls = new Map<number, number>();
  postMessage(request: WorkerRequest): void {
    this.requests.push(request);
    if (request.type === "init") {
      this.respond({ id: request.id, type: "init-ok" });
    } else if (
      request.type === "open-raster-stream" ||
      request.type === "open-layout-transition-raster-stream"
    ) {
      this.respond({ id: request.id, type: "open-raster-stream-ok", streamId: request.id });
    } else if (request.type === "next-raster-stream") {
      const index = this.pulls.get(request.streamId) ?? 0;
      this.pulls.set(request.streamId, index + 1);
      const base = {
        id: request.id,
        type: "next-raster-stream-ok" as const,
        streamId: request.streamId,
      };
      if (index === 0) {
        this.respond({ ...base, kind: "ready", warnings: [] });
      } else if (index === 1) {
        this.respond({ ...base, kind: "chunk", chunk: new Uint8Array([71, 73, 70]).buffer });
      } else {
        this.respond({
          ...base,
          kind: "finished",
          result: { format: "gif", frameCount: 2, bytesWritten: 3 },
        });
      }
    } else if (request.type === "close-raster-stream" && !this.deferClose) {
      this.acknowledgeClose();
    } else if (request.type === "render-svg") {
      this.respond({ id: request.id, type: "render-svg-ok", svg: "<svg/>", warnings: [] });
    }
  }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }
  respond(response: WorkerResponse): void {
    for (const listener of this.listeners.get("message") ?? []) {
      if (typeof listener === "function") {
        listener({ data: response } as MessageEvent);
      }
    }
  }
  respondUnknown(value: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) {
      if (typeof listener === "function") {
        listener({ data: value } as MessageEvent);
      }
    }
  }
  crash(message: string): void {
    for (const listener of this.listeners.get("error") ?? []) {
      if (typeof listener === "function") {
        listener({ message } as ErrorEvent);
      }
    }
  }
  acknowledgeClose(): void {
    const close = this.requests.findLast((request) => request.type === "close-raster-stream");
    if (close?.type === "close-raster-stream") {
      this.respond({ id: close.id, type: "close-raster-stream-ok", streamId: close.streamId });
    }
  }
}

function sink(): AnimatedRasterSink {
  return { write: vi.fn(), finish: vi.fn(), abort: vi.fn() };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("animated Worker callback ownership", () => {
  it("rejects scene and transition shapes before adoption and before an active job's busy error", async () => {
    const worker = new StreamWorker();
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 1000 });
    const writing = deferred();
    const outer = { ...sink(), write: vi.fn(() => writing.promise) };
    let pending: Promise<unknown> | undefined;
    try {
      for (const active of [false, true]) {
        if (active) {
          pending = engine.renderToAnimatedGif(scene, schedule, outer);
          await flush();
        }
        for (const input of [null, [], false]) {
          const invalidScene = input as unknown as SceneNode;
          const invalidTransition = input as unknown as Parameters<
            WorkerEngine["renderLayoutTransitionToAnimatedGif"]
          >[0];
          for (const write of [
            engine.renderToAnimatedGif.bind(engine, invalidScene, schedule),
            engine.renderToAnimatedWebp.bind(engine, invalidScene, schedule),
            engine.renderLayoutTransitionToAnimatedGif.bind(engine, invalidTransition, schedule),
            engine.renderLayoutTransitionToAnimatedWebp.bind(engine, invalidTransition, schedule),
          ]) {
            const destination = { ...sink(), patch: vi.fn() };
            await expect(write(destination)).rejects.toMatchObject({
              code: "ANIMATED_RASTER_SESSION_INVALID_INPUT",
              context: { operation: "open", reason: "wrongType", field: "options" },
            });
            expect(destination.abort).not.toHaveBeenCalled();
          }
        }
      }
      expect(outer.abort).not.toHaveBeenCalled();
    } finally {
      writing.resolve();
      await pending;
      worker.acknowledgeClose();
      engine.dispose();
    }
  });

  it("adopts a pre-aborted signal's sink and keeps the main lease until cleanup settles", async () => {
    const worker = new StreamWorker();
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 1000 });
    const controller = new AbortController();
    controller.abort();
    const cleanup = deferred();
    const destination = { ...sink(), abort: vi.fn(() => cleanup.promise) };
    const failure = await engine
      .renderToAnimatedGif(scene, schedule, destination, { signal: controller.signal })
      .catch((error) => error as FatalError);
    expect(failure).toMatchObject({
      code: "ANIMATED_RASTER_ABORTED",
      context: { operation: "open", reason: "signal" },
    });
    expect(destination.abort).toHaveBeenCalledExactlyOnceWith(failure);
    expect(worker.requests.some((request) => request.type === "open-raster-stream")).toBe(false);
    const fresh = sink();
    await expect(engine.renderToAnimatedGif(scene, schedule, fresh)).rejects.toMatchObject({
      code: "ANIMATED_RASTER_JOB_BUSY",
    });
    expect(fresh.abort).not.toHaveBeenCalled();
    cleanup.resolve();
    await flush();
    await engine.renderToAnimatedGif(scene, schedule, sink());
    worker.acknowledgeClose();
    engine.dispose();
  });

  it("authenticates option values before busy without adopting a nested destination", async () => {
    const worker = new StreamWorker();
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 1000 });
    const writing = deferred();
    const outer = { ...sink(), write: vi.fn(() => writing.promise) };
    const pending = engine.renderToAnimatedGif(scene, schedule, outer);
    await flush();
    for (const options of [
      { debug: null },
      { generator: null },
      { skipValidation: null },
      { showMissingGlyphs: null },
      { rasterBackground: null },
      { textPathMode: null },
    ]) {
      const destination = sink();
      await expect(
        engine.renderToAnimatedGif(
          scene,
          { ...schedule, ...options } as unknown as typeof schedule,
          destination,
        ),
      ).rejects.toMatchObject({
        code: "ANIMATED_RASTER_SESSION_INVALID_INPUT",
        context: { reason: "nullField", field: "options" },
      });
      expect(destination.abort).not.toHaveBeenCalled();
    }
    expect(outer.abort).not.toHaveBeenCalled();
    writing.resolve();
    await pending;
    worker.acknowledgeClose();
    engine.dispose();
  });

  it("preserves a validated local storage error and cause through a failed finish", async () => {
    const worker = new StreamWorker();
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 1000 });
    const storage = new Error("injected rename permission failure");
    const failure = new FatalError("ANIMATED_RASTER_SINK_FAILED", "storage failure", {
      stage: "emit",
      context: { format: "gif", operation: "finish", reason: "storage", field: "sink" },
    });
    Object.defineProperty(failure, "cause", { value: storage });
    const destination = { ...sink(), finish: vi.fn(() => Promise.reject(failure)) };
    await expect(engine.renderToAnimatedGif(scene, schedule, destination)).rejects.toBe(failure);
    expect(Reflect.get(failure, "cause")).toBe(storage);
    expect(destination.abort).toHaveBeenCalledExactlyOnceWith(failure);
    worker.acknowledgeClose();
    engine.dispose();
  });

  it("preserves sink error identity across CommonJS package entries", async () => {
    const { WorkerEngine: DistributedWorkerEngine } = loadPackageEntry("../dist/index.cjs") as {
      WorkerEngine: typeof WorkerEngine;
    };
    const { FatalError: PublicFatalError } = loadPackageEntry("@boundsvg/core") as {
      FatalError: typeof FatalError;
    };
    const worker = new StreamWorker();
    const engine = await DistributedWorkerEngine.create({ worker, fonts: [], timeout: 1000 });
    const storage = new Error("storage write failed");
    const failure = new PublicFatalError("ANIMATED_RASTER_SINK_FAILED", "storage failure", {
      stage: "emit",
      context: { format: "gif", operation: "finish", reason: "storage", field: "sink" },
    });
    Object.defineProperty(failure, "cause", { value: storage });
    const destination = { ...sink(), finish: vi.fn(() => Promise.reject(failure)) };
    await expect(engine.renderToAnimatedGif(scene, schedule, destination)).rejects.toBe(failure);
    expect(Reflect.get(failure, "cause")).toBe(storage);
    expect(destination.abort).toHaveBeenCalledExactlyOnceWith(failure);
    worker.acknowledgeClose();
    engine.dispose();
  });

  it("preserves remote animation diagnostics as public CommonJS fatal instances", async () => {
    const { WorkerEngine: DistributedWorkerEngine } = loadPackageEntry("../dist/index.cjs") as {
      WorkerEngine: typeof WorkerEngine;
    };
    const { FatalError: PublicFatalError } = loadPackageEntry("@boundsvg/core") as {
      FatalError: typeof FatalError;
    };
    const worker = new StreamWorker();
    const engine = await DistributedWorkerEngine.create({ worker, fonts: [], timeout: 1000 });
    const failure = new PublicFatalError("ANIMATED_RASTER_SESSION_INVALID_INPUT", "invalid time", {
      stage: "emit",
      context: { format: "gif", operation: "push", reason: "outOfDomain", field: "timeMs" },
    });
    const postMessage = worker.postMessage.bind(worker);
    vi.spyOn(worker, "postMessage").mockImplementation((request) => {
      if (request.type === "next-raster-stream") {
        worker.respond({ id: request.id, type: "error", error: failure.toJSON() });
      } else {
        postMessage(request);
      }
    });
    const destination = sink();
    const rejected = await engine
      .renderToAnimatedGif(scene, schedule, destination)
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(PublicFatalError);
    expect(rejected).toMatchObject({ code: failure.code, context: failure.context });
    expect(destination.abort).toHaveBeenCalledExactlyOnceWith(rejected);
    worker.acknowledgeClose();
    engine.dispose();
  });

  it("settles success before remote close acknowledgement and queues the next animation behind it", async () => {
    const worker = new StreamWorker();
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 1000 });
    expect(await engine.renderToAnimatedGif(scene, schedule, sink())).toEqual({
      format: "gif",
      frameCount: 2,
      bytesWritten: 3,
    });
    const second = engine.renderToAnimatedGif(scene, schedule, sink());
    await flush();
    expect(worker.requests.filter((request) => request.type === "open-raster-stream")).toHaveLength(
      1,
    );
    worker.acknowledgeClose();
    expect(await second).toEqual({ format: "gif", frameCount: 2, bytesWritten: 3 });
    worker.acknowledgeClose();
    engine.dispose();
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("rejects an expired write immediately but retains the main lease through callback and abort cleanup", async () => {
    vi.useFakeTimers();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const worker = new StreamWorker();
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 50 });
    const write = deferred();
    const cleanup = deferred();
    const destination = {
      write: vi.fn(() => write.promise),
      finish: vi.fn(),
      abort: vi.fn(() => cleanup.promise),
    };
    const observed = engine
      .renderToAnimatedGif(scene, schedule, destination)
      .catch((error) => error as FatalError);
    await flush();
    // Generic requests remain available while sink backpressure owns the animation.
    expect(await engine.renderToSvg(scene)).toBe("<svg/>");
    clock = 50;
    await vi.advanceTimersByTimeAsync(50);
    const error = await observed;
    expect(error).toMatchObject({
      code: "ANIMATED_RASTER_ABORTED",
      context: { operation: "write", reason: "deadline" },
    });
    const nested = sink();
    await expect(engine.renderToAnimatedGif(scene, schedule, nested)).rejects.toMatchObject({
      code: "ANIMATED_RASTER_JOB_BUSY",
    });
    expect(nested.abort).not.toHaveBeenCalled();
    write.resolve();
    await flush();
    expect(destination.abort).toHaveBeenCalledOnce();
    await expect(engine.renderToAnimatedGif(scene, schedule, sink())).rejects.toMatchObject({
      code: "ANIMATED_RASTER_JOB_BUSY",
    });
    cleanup.resolve();
    await flush();
    worker.acknowledgeClose();
    expect(await engine.renderToAnimatedGif(scene, schedule, sink())).toMatchObject({
      format: "gif",
    });
    worker.acknowledgeClose();
    engine.dispose();
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("keeps an expired finish rejection immutable while preserving a later committed destination", async () => {
    vi.useFakeTimers();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const worker = new StreamWorker();
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 50 });
    const finish = deferred();
    const destination = { write: vi.fn(), finish: vi.fn(() => finish.promise), abort: vi.fn() };
    const observed = engine
      .renderToAnimatedGif(scene, schedule, destination)
      .catch((error) => error as FatalError);
    await flush();
    expect(destination.finish).toHaveBeenCalledOnce();
    clock = 50;
    await vi.advanceTimersByTimeAsync(50);
    const error = await observed;
    expect(error).toMatchObject({ context: { operation: "finish", reason: "deadline" } });
    finish.resolve();
    await flush();
    expect(await observed).toBe(error);
    expect(destination.abort).not.toHaveBeenCalled();
    worker.acknowledgeClose();
    engine.dispose();
  });

  it("checks absolute time in a finish continuation even when the timer task has not run", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const worker = new StreamWorker();
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 50 });
    const finish = deferred();
    const destination = { write: vi.fn(), finish: () => finish.promise, abort: vi.fn() };
    const observed = engine
      .renderToAnimatedGif(scene, schedule, destination)
      .catch((error) => error as FatalError);
    await flush();
    clock = 51;
    finish.resolve();
    expect(await observed).toMatchObject({
      code: "ANIMATED_RASTER_ABORTED",
      context: { operation: "finish", reason: "deadline" },
    });
    expect(destination.abort).not.toHaveBeenCalled();
    worker.acknowledgeClose();
    engine.dispose();
  });

  it("fails future admission after a close timeout without rewriting an earlier success or terminating an external Worker", async () => {
    vi.useFakeTimers();
    const worker = new StreamWorker();
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 50 });
    const success = await engine.renderToAnimatedGif(scene, schedule, sink());
    await vi.advanceTimersByTimeAsync(50);
    await expect(engine.renderToSvg(scene)).rejects.toMatchObject({
      code: "WORKER_REQUEST_TIMEOUT",
    });
    expect(success.format).toBe("gif");
    expect(worker.terminate).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("authenticates closed options and native signals before adopting a fresh sink", async () => {
    const worker = new StreamWorker();
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 1000 });
    const destination = sink();
    await expect(
      engine.renderToAnimatedGif(scene, schedule, destination, { signal: {} as AbortSignal }),
    ).rejects.toMatchObject({ code: "ANIMATED_RASTER_SESSION_INVALID_INPUT" });
    await expect(
      engine.renderToAnimatedGif(
        scene,
        { ...schedule, extra: true } as typeof schedule,
        destination,
      ),
    ).rejects.toMatchObject({ context: { reason: "unknownField" } });
    expect(destination.abort).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("preserves an uncorrelatable protocol failure through a pending write and cleanup", async () => {
    const worker = new StreamWorker();
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 1000 });
    const write = deferred();
    const destination = { ...sink(), write: vi.fn(() => write.promise) };
    const observed = engine
      .renderToAnimatedGif(scene, schedule, destination)
      .catch((error) => error as FatalError);
    await flush();
    expect(destination.write).toHaveBeenCalledOnce();
    worker.respondUnknown({ id: Number.NaN, type: "invalid-response" });
    const failure = await observed;
    expect(failure).toMatchObject({ code: "WORKER_PROTOCOL_INVALID_RESPONSE" });
    expect(destination.abort).not.toHaveBeenCalled();
    expect(destination.finish).not.toHaveBeenCalled();
    write.resolve();
    await flush();
    expect(destination.abort).toHaveBeenCalledExactlyOnceWith(failure);
    expect(await observed).toBe(failure);
    expect(worker.terminate).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("preserves a Worker crash while a later already-called finish commits", async () => {
    const worker = new StreamWorker();
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 1000 });
    const finish = deferred();
    const destination = { ...sink(), finish: vi.fn(() => finish.promise) };
    const observed = engine
      .renderToAnimatedGif(scene, schedule, destination)
      .catch((error) => error as FatalError);
    await flush();
    expect(destination.finish).toHaveBeenCalledOnce();
    worker.crash("fixed worker crash");
    const failure = await observed;
    expect(failure).toMatchObject({
      code: "WORKER_CRASHED",
      context: { workerMessage: "fixed worker crash" },
    });
    finish.resolve();
    await flush();
    expect(await observed).toBe(failure);
    expect(destination.abort).not.toHaveBeenCalled();
    expect(worker.terminate).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("retains a scheduler timeout as cause when an expired open response arrives before timer delivery", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const worker = new StreamWorker();
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 1000 });
    const post = worker.postMessage.bind(worker);
    let open: Extract<WorkerRequest, { type: "open-raster-stream" }> | undefined;
    vi.spyOn(worker, "postMessage").mockImplementation((request) => {
      if (request.type === "open-raster-stream") {
        worker.requests.push(request);
        open = request;
      } else {
        post(request);
      }
    });
    const observed = engine
      .renderToAnimatedGif(scene, schedule, sink())
      .catch((error) => error as FatalError);
    await flush();
    expect(open).toBeDefined();
    if (!open) {
      throw new Error("Missing pending open request");
    }
    clock = 1001;
    worker.respond({ id: open.id, type: "open-raster-stream-ok", streamId: open.id });
    const failure = await observed;
    expect(failure).toMatchObject({
      code: "ANIMATED_RASTER_ABORTED",
      context: { reason: "deadline", operation: "open" },
      cause: {
        code: "WORKER_REQUEST_TIMEOUT",
        context: { requestId: open.id, requestType: "open-raster-stream", timeoutMs: 1000 },
      },
    });
    await flush();
    worker.acknowledgeClose();
    engine.dispose();
  });

  it("drains accepted animation callbacks before requesting physical cleanup and shares the drain Promise", async () => {
    const worker = new StreamWorker();
    worker.deferClose = false;
    const engine = await WorkerEngine.create({ worker, fonts: [], timeout: 1000 });
    const write = deferred();
    const destination = { ...sink(), write: () => write.promise };
    const render = engine.renderToAnimatedGif(scene, schedule, destination);
    await flush();
    const drain = engine.drain();
    expect(engine.drain()).toBe(drain);
    await expect(engine.renderToSvg(scene)).rejects.toMatchObject({
      code: "WORKER_ENGINE_DRAINING",
    });
    expect(worker.requests.some((request) => request.type === "close-raster-stream")).toBe(false);
    write.resolve();
    expect(await render).toMatchObject({ format: "gif" });
    await drain;
    engine.dispose();
  });
});

describe("raster scheduler reservations", () => {
  it("keeps pull and close separate from queue32 while preserving generic FIFO", async () => {
    const posted: WorkerRequest[] = [];
    let nextId = 100;
    const scheduler = new WorkerRequestScheduler(1000, {
      post: (request) => {
        posted.push(request);
      },
      nextRequestId: () => nextId++,
    });
    const open = scheduler.sendRasterOpen(
      { id: 1, type: "open-raster-stream", format: "gif", scene, options: schedule },
      { deadline: performance.now() + 1000 },
    );
    scheduler.receive(1, { id: 1, type: "open-raster-stream-ok", streamId: 1 });
    await open;
    const blocker = scheduler.send({ id: 2, type: "render-svg", scene });
    const queued = Array.from({ length: 32 }, (_, index) =>
      scheduler.send({ id: 3 + index, type: "render-svg", scene }),
    );
    await expect(scheduler.send({ id: 90, type: "render-svg", scene })).rejects.toMatchObject({
      code: "WORKER_QUEUE_FULL",
    });
    const pull = scheduler.sendRasterPull(
      { id: 91, type: "next-raster-stream", streamId: 1 },
      { deadline: performance.now() + 1000 },
    );
    scheduler.receive(2, { id: 2, type: "render-svg-ok", svg: "", warnings: [] });
    await blocker;
    expect(posted.at(-1)?.id).toBe(3);
    for (let id = 3; id <= 34; id += 1) {
      scheduler.receive(id, { id, type: "render-svg-ok", svg: "", warnings: [] });
    }
    await Promise.all(queued);
    expect(posted.at(-1)?.id).toBe(91);
    const close = scheduler.closeStream(1);
    expect(posted.at(-1)?.id).toBe(91);
    scheduler.receive(91, {
      id: 91,
      type: "next-raster-stream-ok",
      streamId: 1,
      kind: "preparing",
    });
    await pull;
    expect(posted.at(-1)?.type).toBe("close-raster-stream");
    scheduler.receive(100, { id: 100, type: "close-raster-stream-ok", streamId: 1 });
    await close;
    await scheduler.finish();
    scheduler.dispose();
  });
});

describe("native frame diagnostic transport", () => {
  it("preserves new owner and sample fields while rejecting the removed SVG field", () => {
    for (const [family, reason, field] of [
      ["SESSION_INVALID_STATE", "wrongEngine", undefined],
      ["SESSION_INVALID_INPUT", "outOfDomain", "timeMs"],
      ["SESSION_INVALID_INPUT", "nullField", "renderOptions"],
    ] as const) {
      const serialized = {
        severity: "fatal",
        code: `ANIMATED_RASTER_${family}`,
        message: "Native frame failed",
        stage: "emit",
        context: {
          format: "gif",
          operation: "push",
          reason,
          ...(field === undefined ? {} : { field }),
        },
      };
      expect(decodeAnimatedRasterFatal(JSON.stringify(serialized))?.toJSON()).toEqual(serialized);
      expect(
        decodeAnimatedRasterFatal({
          ...serialized,
          context: { ...serialized.context, field: "svg" },
        }),
      ).toBeUndefined();
    }
  });
});
