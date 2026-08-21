import { createHash } from "node:crypto";
import type { Engine, Frame, RecoverableError, StructuredError } from "@boundsvg/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WasmEngineHandle } from "../../core/src/wasm/index.js";
import {
  createPortableLayoutTransitionInput,
  PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS,
} from "../../core/tests/animation/fixtures/layout-transition.js";
import {
  createEngineFromHandle,
  createFontedWasmHandle,
} from "../../core/tests/helpers/wasm-render-engine.js";
import type { WorkerLayoutTransitionInput } from "../src/layout-transition-transport.js";
import type { WorkerRequest, WorkerResponse } from "../src/protocol.js";
import { WorkerEngine, type WorkerLike } from "../src/worker-engine.js";
import { WorkerPool } from "../src/worker-pool.js";

type WorkerListener = (event: MessageEvent | ErrorEvent) => void;

type ActiveStream = {
  iterator: Iterator<Frame>;
  schedule: Array<{ index: number; timeMs: number }>;
};

/**
 * Executes real core operations behind the Worker request/response boundary.
 * Dedicated dispatch tests pin the worker-script switch; this fixture pins the
 * bytes and compiled-frame behavior behind it.
 */
class CoreBackedWorker implements WorkerLike {
  readonly terminate = () => {
    this.closeStreams();
    this.engine.dispose();
  };
  compileCount = 0;
  private readonly listeners = new Map<string, Set<WorkerListener>>();
  private readonly streams = new Map<number, ActiveStream>();

  constructor(private readonly engine: Engine) {}

  postMessage(message: unknown): void {
    const request = structuredClone(message) as WorkerRequest;
    queueMicrotask(() => {
      try {
        this.handle(request);
      } catch (error) {
        this.respond({ id: request.id, type: "error", error: toStructuredError(error) });
      }
    });
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener as WorkerListener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener as WorkerListener);
  }

  private handle(request: WorkerRequest): void {
    switch (request.type) {
      case "init":
        this.respond({ id: request.id, type: "init-ok" });
        return;
      case "render-layout-transition-animated-webp": {
        const { skipValidation, textPathMode, ...renderOptions } = request.options;
        const compiled = this.compile(request.transition, { skipValidation, textPathMode });
        const warnings: StructuredError[] = [];
        const webp = this.engine.renderCompiledToAnimatedWebp(compiled, {
          ...renderOptions,
          onWarning: collectWarning(warnings),
        });
        this.respond({ id: request.id, type: "render-animated-webp-ok", webp, warnings });
        return;
      }
      case "render-layout-transition-animated-gif": {
        const { skipValidation, textPathMode, ...renderOptions } = request.options;
        const compiled = this.compile(request.transition, { skipValidation, textPathMode });
        const warnings: StructuredError[] = [];
        const gif = this.engine.renderCompiledToAnimatedGif(compiled, {
          ...renderOptions,
          onWarning: collectWarning(warnings),
        });
        this.respond({ id: request.id, type: "render-animated-gif-ok", gif, warnings });
        return;
      }
      case "open-layout-transition-frame-stream": {
        const { skipValidation, textPathMode, ...renderOptions } = request.options;
        const compiled = this.compile(request.transition, { skipValidation, textPathMode });
        const warnings: StructuredError[] = [];
        const iterator = this.engine
          .renderCompiledFrames(compiled, {
            ...renderOptions,
            timesMs: request.schedule.map((entry) => entry.timeMs),
            onWarning: collectWarning(warnings),
          })
          [Symbol.iterator]();
        this.streams.set(request.id, { iterator, schedule: request.schedule });
        this.respond({
          id: request.id,
          type: "open-frame-stream-ok",
          streamId: request.id,
          warnings,
        });
        return;
      }
      case "next-frame-stream": {
        const stream = this.streams.get(request.streamId);
        if (!stream) {
          throw new Error(`missing stream ${request.streamId}`);
        }
        const result = stream.iterator.next();
        if (result.done) {
          this.streams.delete(request.streamId);
          this.respond({
            id: request.id,
            type: "next-frame-stream-ok",
            streamId: request.streamId,
            done: true,
          });
          return;
        }
        const scheduleEntry = stream.schedule[result.value.index];
        if (!scheduleEntry) {
          throw new Error(`missing schedule entry ${result.value.index}`);
        }
        const frame = { ...result.value, index: scheduleEntry.index };
        if (result.value.index + 1 >= stream.schedule.length) {
          this.streams.delete(request.streamId);
        }
        this.respond({
          id: request.id,
          type: "next-frame-stream-ok",
          streamId: request.streamId,
          done: false,
          frame,
        });
        return;
      }
      case "close-frame-stream":
        this.streams.get(request.streamId)?.iterator.return?.();
        this.streams.delete(request.streamId);
        this.respond({
          id: request.id,
          type: "close-frame-stream-ok",
          streamId: request.streamId,
        });
        return;
      case "dispose":
        this.closeStreams();
        this.engine.dispose();
        this.respond({ id: request.id, type: "dispose-ok" });
        return;
      default:
        throw new Error(`unsupported test request ${request.type}`);
    }
  }

  private compile(
    transition: WorkerLayoutTransitionInput,
    options: { skipValidation?: boolean; textPathMode?: "merged" | "glyphs" },
  ) {
    this.compileCount += 1;
    return this.engine.compileLayoutTransition(transition, options);
  }

  private closeStreams(): void {
    for (const stream of this.streams.values()) {
      stream.iterator.return?.();
    }
    this.streams.clear();
  }

  private respond(response: WorkerResponse): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data: structuredClone(response) } as MessageEvent);
    }
  }
}

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

function realEngine(): Engine {
  return createEngineFromHandle(handle, {
    svgToPngFn: handle.createSvgToPngFn(),
    svgsToAnimatedWebpFn: handle.createSvgsToAnimatedWebpFn(),
    svgsToAnimatedGifFn: handle.createSvgsToAnimatedGifFn(),
  });
}

function portableTransition(): WorkerLayoutTransitionInput {
  return createPortableLayoutTransitionInput() as WorkerLayoutTransitionInput;
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function collectWarning(warnings: StructuredError[]): (warning: RecoverableError) => void {
  return (warning) => warnings.push(warning.toJSON());
}

function toStructuredError(error: unknown): StructuredError {
  if (
    typeof error === "object" &&
    error !== null &&
    typeof Reflect.get(error, "toJSON") === "function"
  ) {
    return Reflect.apply(Reflect.get(error, "toJSON") as () => StructuredError, error, []);
  }
  return {
    severity: "fatal",
    code: "TEST_WORKER_FAILURE",
    message: error instanceof Error ? error.message : String(error),
  };
}

async function collectFrames(frames: AsyncIterable<Frame>): Promise<Frame[]> {
  const collected: Frame[] = [];
  for await (const frame of frames) {
    collected.push(frame);
  }
  return collected;
}

describe("portable layout transition through fixed Worker protocol families", () => {
  it("encodes actual WebP and GIF bytes after one Worker-local compile each", async () => {
    const coreWorker = new CoreBackedWorker(realEngine());
    const workerEngine = await WorkerEngine.create({ worker: coreWorker, fonts: [] });
    const timesMs = PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS.map((checkpoint) => checkpoint.timeMs);
    const schedule = {
      timesMs,
      frameDurationsMs: [300, 400, 300, 100],
      loop: 2,
    } as const;

    const webp = await workerEngine.renderLayoutTransitionToAnimatedWebp(
      portableTransition(),
      schedule,
    );
    const gif = await workerEngine.renderLayoutTransitionToAnimatedGif(
      portableTransition(),
      schedule,
    );

    expect(new TextDecoder().decode(webp.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(webp.subarray(8, 12))).toBe("WEBP");
    expect(new TextDecoder().decode(gif.subarray(0, 6))).toBe("GIF89a");
    expect(coreWorker.compileCount).toBe(2);
    workerEngine.dispose();
  });

  it("streams actual PNG checkpoints in order with one compile per active Worker", async () => {
    const workers = [new CoreBackedWorker(realEngine()), new CoreBackedWorker(realEngine())];
    let workerIndex = 0;
    const pool = await WorkerPool.create({
      worker: () => workers[workerIndex++] as WorkerLike,
      concurrency: workers.length,
      fonts: [],
    });
    const transition = portableTransition();
    const timesMs = PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS.map((checkpoint) => checkpoint.timeMs);
    const frames = await collectFrames(
      pool.renderLayoutTransitionFrames(transition, { timesMs, format: "png" }),
    );

    const directEngine = realEngine();
    const compiled = directEngine.compileLayoutTransition(transition);
    const expectedDigests = timesMs.map((timeMs) =>
      createHash("sha256")
        .update(directEngine.renderCompiledToPng(compiled, { animation: "static", timeMs }))
        .digest("hex"),
    );
    expect(frames.map((frame) => frame.timeMs)).toEqual(timesMs);
    expect(
      frames.map((frame) =>
        frame.format === "png" ? createHash("sha256").update(frame.data).digest("hex") : "svg",
      ),
    ).toEqual(expectedDigests);
    expect(
      frames.map((frame) => (frame.format === "png" ? pngSize(frame.data) : undefined)),
    ).toEqual(timesMs.map(() => ({ width: 480, height: 480 })));
    expect(workers.map((worker) => worker.compileCount)).toEqual([1, 1]);

    directEngine.dispose();
    pool.dispose();
  });
});
