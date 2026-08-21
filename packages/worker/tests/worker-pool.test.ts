import { FatalError, type SceneNode, type StructuredError } from "@boundsvg/core";
import { describe, expect, it, vi } from "vitest";
import type { WorkerLayoutTransitionInput } from "../src/layout-transition-transport.js";
import type {
  IndexedFrameTime,
  WorkerFrameRenderOptions,
  WorkerRequest,
  WorkerResponse,
} from "../src/protocol.js";
import {
  DEFAULT_WORKER_POOL_CONCURRENCY,
  MAX_WORKER_POOL_CONCURRENCY,
  type MaterializedFrameInput,
  type MaterializedFrameSource,
  WorkerPool,
} from "../src/worker-pool.js";

type MockEventListener = (event: MessageEvent | ErrorEvent) => void;

type MockFrameStream = {
  schedule: IndexedFrameTime[];
  options: WorkerFrameRenderOptions;
  cursor: number;
};

class PoolMockWorker {
  readonly terminate = vi.fn();
  readonly initRequests: Array<Extract<WorkerRequest, { type: "init" }>> = [];
  readonly openedSchedules: IndexedFrameTime[][] = [];
  readonly openedTransitions: WorkerLayoutTransitionInput[] = [];
  readonly closedStreamIds: number[] = [];
  readonly renderRequests: Array<Extract<WorkerRequest, { type: "render-svg" | "render-png" }>> =
    [];
  nextRequestCount = 0;
  prepareCount = 0;
  initErrorCode: string | undefined;
  failIndex: number | undefined;
  openResponseDelay = 0;
  warnings: StructuredError[] = [];
  delayForIndex: (index: number) => number = () => 0;
  returnedIndex: (index: number) => number = (index) => index;
  renderDelayForTime: (timeMs: number) => number = () => 0;
  warningsForTime: (timeMs: number) => StructuredError[] = () => this.warnings;
  failRenderTime: number | undefined;

  private readonly listeners = new Map<string, Set<MockEventListener>>();
  private readonly streams = new Map<number, MockFrameStream>();

  readonly postMessage = vi.fn((request: WorkerRequest) => {
    switch (request.type) {
      case "init":
        this.initRequests.push(structuredClone(request));
        queueMicrotask(() => {
          if (this.initErrorCode) {
            this.respond({
              id: request.id,
              type: "error",
              error: {
                severity: "fatal",
                code: this.initErrorCode,
                message: "mock initialization failed",
              },
            });
            return;
          }
          this.respond({ id: request.id, type: "init-ok" });
        });
        break;
      case "open-frame-stream":
      case "open-layout-transition-frame-stream":
        this.prepareCount += 1;
        if (request.type === "open-layout-transition-frame-stream") {
          this.openedTransitions.push(structuredClone(request.transition));
        }
        this.openedSchedules.push(structuredClone(request.schedule));
        this.streams.set(request.id, {
          schedule: request.schedule,
          options: request.options,
          cursor: 0,
        });
        setTimeout(
          () =>
            this.respond({
              id: request.id,
              type: "open-frame-stream-ok",
              streamId: request.id,
              warnings: structuredClone(this.warnings),
            }),
          this.openResponseDelay,
        );
        break;
      case "next-frame-stream": {
        this.nextRequestCount += 1;
        const stream = this.streams.get(request.streamId);
        const scheduleEntry = stream?.schedule[stream.cursor++];
        const delay = this.delayForIndex(scheduleEntry?.index ?? -1);
        setTimeout(() => {
          if (!stream || !scheduleEntry) {
            this.respond({
              id: request.id,
              type: "next-frame-stream-ok",
              streamId: request.streamId,
              done: true,
            });
            return;
          }
          if (scheduleEntry.index === this.failIndex) {
            this.respond({
              id: request.id,
              type: "error",
              error: {
                severity: "fatal",
                code: "TEST_FRAME_FAILURE",
                message: `failed frame ${scheduleEntry.index}`,
                stage: "emit",
              },
            });
            return;
          }
          const returnedIndex = this.returnedIndex(scheduleEntry.index);
          const response: WorkerResponse =
            stream.options.format === "svg"
              ? {
                  id: request.id,
                  type: "next-frame-stream-ok",
                  streamId: request.streamId,
                  done: false,
                  frame: {
                    index: returnedIndex,
                    timeMs: scheduleEntry.timeMs,
                    format: "svg",
                    data: `<svg data-index="${returnedIndex}"/>`,
                  },
                }
              : {
                  id: request.id,
                  type: "next-frame-stream-ok",
                  streamId: request.streamId,
                  done: false,
                  frame: {
                    index: returnedIndex,
                    timeMs: scheduleEntry.timeMs,
                    format: "png",
                    data: new Uint8Array([returnedIndex, scheduleEntry.timeMs % 256]),
                  },
                };
          this.respond(response);
        }, delay);
        break;
      }
      case "close-frame-stream":
        this.closedStreamIds.push(request.streamId);
        this.streams.delete(request.streamId);
        queueMicrotask(() =>
          this.respond({
            id: request.id,
            type: "close-frame-stream-ok",
            streamId: request.streamId,
          }),
        );
        break;
      case "render-svg":
      case "render-png": {
        this.renderRequests.push(structuredClone(request));
        const timeMs = request.options?.timeMs ?? 0;
        setTimeout(() => {
          if (timeMs === this.failRenderTime) {
            this.respond({
              id: request.id,
              type: "error",
              error: {
                severity: "fatal",
                code: "TEST_MATERIALIZED_FAILURE",
                message: `failed materialized frame at ${timeMs}`,
                stage: "emit",
              },
            });
            return;
          }
          const sceneJson = JSON.stringify(request.scene);
          this.respond(
            request.type === "render-svg"
              ? {
                  id: request.id,
                  type: "render-svg-ok",
                  svg: `<svg data-time="${timeMs}">${sceneJson}</svg>`,
                  warnings: structuredClone(this.warningsForTime(timeMs)),
                }
              : {
                  id: request.id,
                  type: "render-png-ok",
                  png: new TextEncoder().encode(`${timeMs}:${sceneJson}`),
                  warnings: structuredClone(this.warningsForTime(timeMs)),
                },
          );
        }, this.renderDelayForTime(timeMs));
        break;
      }
      case "dispose":
        this.streams.clear();
        break;
      default:
        break;
    }
  });

  addEventListener(type: string, listener: MockEventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<MockEventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: MockEventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  private respond(response: WorkerResponse): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data: response } as MessageEvent);
    }
  }
}

const SCENE: SceneNode = { type: "Canvas", width: 100, height: 100, children: [] };

function transitionInput(): WorkerLayoutTransitionInput {
  return {
    states: {
      A: {
        type: "Canvas",
        width: 100,
        height: 100,
        children: [{ type: "Box", id: "slot", width: 40, height: 20, children: [] }],
      },
      B: {
        type: "Canvas",
        width: 100,
        height: 100,
        children: [{ type: "Box", id: "slot", width: 40, height: 60, children: [] }],
      },
    },
    checkpoints: [
      { timeMs: 0, state: "A" },
      { timeMs: 100, state: "B" },
      { timeMs: 200, state: "B" },
      { timeMs: 300, state: "A" },
    ],
  };
}

async function createPool(
  workers: PoolMockWorker[],
  options?: { fonts?: ArrayBuffer[]; concurrency?: number; timeout?: number },
): Promise<WorkerPool> {
  let workerIndex = 0;
  return WorkerPool.create({
    worker: () => workers[workerIndex++] as never,
    concurrency: options?.concurrency ?? workers.length,
    fonts: (options?.fonts ?? []).map((data, index) => ({
      alias: `font-${index}`,
      weight: 400,
      style: "normal",
      data,
    })),
    timeout: options?.timeout ?? 1_000,
  });
}

async function collectFrames(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

describe("WorkerPool", () => {
  it("defaults to a conservative two-Worker pool", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    const pool = await createPool(workers, { concurrency: DEFAULT_WORKER_POOL_CONCURRENCY });

    expect(pool.concurrency).toBe(2);
    pool.dispose();
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });

  it.each([
    0,
    1.5,
    MAX_WORKER_POOL_CONCURRENCY + 1,
  ])("rejects invalid concurrency %s before creating Workers", async (concurrency) => {
    let factoryCalls = 0;
    await expect(
      WorkerPool.create({
        worker: () => {
          factoryCalls += 1;
          return new PoolMockWorker() as never;
        },
        concurrency,
        fonts: [],
      }),
    ).rejects.toMatchObject({ code: "WORKER_POOL_INVALID_CONCURRENCY" });
    expect(factoryCalls).toBe(0);
  });

  it("copies one immutable font snapshot per Worker", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker(), new PoolMockWorker()];
    const source = new Uint8Array([1, 2, 3, 4]);
    const pool = await createPool(workers, { fonts: [source.buffer] });
    source[0] = 99;

    const workerBuffers = workers.map((worker) => worker.initRequests[0]!.fonts[0]!.data);
    expect(workerBuffers.map((buffer) => [...new Uint8Array(buffer)])).toEqual([
      [1, 2, 3, 4],
      [1, 2, 3, 4],
      [1, 2, 3, 4],
    ]);
    expect(new Set(workerBuffers).size).toBe(3);
    expect(workerBuffers).not.toContain(source.buffer);
    pool.dispose();
  });

  it("rejects a detached font snapshot before creating Workers", async () => {
    const source = new ArrayBuffer(4);
    structuredClone(source, { transfer: [source] });
    let factoryCalls = 0;

    await expect(
      WorkerPool.create({
        worker: () => {
          factoryCalls += 1;
          return new PoolMockWorker() as never;
        },
        fonts: [{ alias: "detached", weight: 400, style: "normal", data: source }],
      }),
    ).rejects.toMatchObject({ code: "WORKER_POOL_ASSET_SNAPSHOT_FAILED" });
    expect(factoryCalls).toBe(0);
  });

  it("terminates every factory Worker when one pool slot fails initialization", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker(), new PoolMockWorker()];
    workers[1]!.initErrorCode = "TEST_INIT_FAILURE";

    await expect(createPool(workers)).rejects.toMatchObject({ code: "TEST_INIT_FAILURE" });

    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });

  it("rejects a factory that reuses a Worker and terminates it once", async () => {
    const worker = new PoolMockWorker();

    await expect(
      WorkerPool.create({
        worker: () => worker as never,
        concurrency: 2,
        fonts: [],
      }),
    ).rejects.toMatchObject({ code: "WORKER_POOL_DUPLICATE_WORKER" });

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("prepares once per Worker and yields duplicate non-monotonic times in input order", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker(), new PoolMockWorker()];
    workers[0]!.delayForIndex = (index) => (index === 0 ? 25 : 1);
    workers[1]!.delayForIndex = () => 1;
    workers[2]!.delayForIndex = () => 5;
    const pool = await createPool(workers);
    const timesMs = [600, 0, 1_400, 600, 10, 0];

    const frames = await collectFrames(pool.renderFrames(SCENE, { timesMs, format: "svg" }));

    expect(frames).toMatchObject(
      timesMs.map((timeMs, index) => ({ index, timeMs, format: "svg" })),
    );
    expect(workers.map((worker) => worker.prepareCount)).toEqual([1, 1, 1]);
    expect(workers.map((worker) => worker.openedSchedules[0]?.map((entry) => entry.index))).toEqual(
      [
        [0, 3],
        [1, 4],
        [2, 5],
      ],
    );
    pool.dispose();
  });

  it("snapshots and partitions a transition across bounded frame streams", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    const pool = await createPool(workers);
    const transition = transitionInput();
    const frames = pool.renderLayoutTransitionFrames(transition, {
      timesMs: [0, 100, 200, 300],
      format: "png",
    });
    const firstState = transition.states.A;
    if (firstState?.type === "Canvas") {
      firstState.width = 999;
    }

    await expect(collectFrames(frames)).resolves.toMatchObject([
      { index: 0, timeMs: 0, format: "png" },
      { index: 1, timeMs: 100, format: "png" },
      { index: 2, timeMs: 200, format: "png" },
      { index: 3, timeMs: 300, format: "png" },
    ]);
    expect(workers.map((worker) => worker.prepareCount)).toEqual([1, 1]);
    expect(
      workers.map((worker) =>
        worker.openedTransitions[0]?.states.A?.type === "Canvas"
          ? worker.openedTransitions[0].states.A.width
          : undefined,
      ),
    ).toEqual([100, 100]);
    expect(workers.map((worker) => worker.openedSchedules[0]?.map((entry) => entry.index))).toEqual(
      [
        [0, 2],
        [1, 3],
      ],
    );
    pool.dispose();
  });

  it("rejects invalid transition transport before opening a stream", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    const pool = await createPool(workers);
    const transition = transitionInput() as unknown as { hidden: undefined };
    transition.hidden = undefined;

    expect(() =>
      pool.renderLayoutTransitionFrames(transition as unknown as WorkerLayoutTransitionInput, {
        timesMs: [0],
        format: "svg",
      }),
    ).toThrowError(expect.objectContaining({ code: "WORKER_LAYOUT_TRANSITION_NOT_SERIALIZABLE" }));
    expect(workers.map((worker) => worker.prepareCount)).toEqual([0, 0]);
    pool.dispose();
  });

  it("closes transition streams on iterator return, abort, and fatal frame errors", async () => {
    const returnWorkers = [new PoolMockWorker(), new PoolMockWorker()];
    const returnPool = await createPool(returnWorkers);
    const iterator = returnPool
      .renderLayoutTransitionFrames(transitionInput(), {
        timesMs: [0, 100, 200, 300],
        format: "svg",
      })
      [Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect(returnWorkers.map((worker) => worker.closedStreamIds.length)).toEqual([1, 1]);
    returnPool.dispose();

    const abortWorkers = [new PoolMockWorker(), new PoolMockWorker()];
    const abortPool = await createPool(abortWorkers);
    const abortController = new AbortController();
    const abortIterator = abortPool
      .renderLayoutTransitionFrames(transitionInput(), {
        timesMs: [0, 100, 200, 300],
        format: "svg",
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();
    await abortIterator.next();
    abortController.abort();
    await expect(abortIterator.next()).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() =>
      expect(abortWorkers.map((worker) => worker.closedStreamIds.length)).toEqual([1, 1]),
    );
    abortPool.dispose();

    const fatalWorkers = [new PoolMockWorker(), new PoolMockWorker()];
    fatalWorkers[1]!.failIndex = 1;
    const fatalPool = await createPool(fatalWorkers);
    await expect(
      collectFrames(
        fatalPool.renderLayoutTransitionFrames(transitionInput(), {
          timesMs: [0, 100],
          format: "svg",
        }),
      ),
    ).rejects.toMatchObject({ code: "TEST_FRAME_FAILURE" });
    expect(fatalWorkers.map((worker) => worker.closedStreamIds.length)).toEqual([1, 1]);
    fatalPool.dispose();
  });

  it("best-effort closes a transition stream whose open response times out", async () => {
    const worker = new PoolMockWorker();
    worker.openResponseDelay = 40;
    const pool = await createPool([worker], { timeout: 10 });

    await expect(
      collectFrames(
        pool.renderLayoutTransitionFrames(transitionInput(), {
          timesMs: [0],
          format: "svg",
        }),
      ),
    ).rejects.toMatchObject({ code: "WORKER_REQUEST_TIMEOUT" });
    await vi.waitFor(() => expect(worker.closedStreamIds).toHaveLength(1));
    worker.openResponseDelay = 0;
    await new Promise((resolve) => setTimeout(resolve, 50));
    pool.dispose();
  });

  it("pool disposal rejects an active transition and terminates every Worker", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    for (const worker of workers) {
      worker.delayForIndex = () => 100;
    }
    const pool = await createPool(workers);
    const iterator = pool
      .renderLayoutTransitionFrames(transitionInput(), {
        timesMs: [0, 100, 200, 300],
        format: "svg",
      })
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    await vi.waitFor(() =>
      expect(workers.reduce((sum, worker) => sum + worker.nextRequestCount, 0)).toBe(2),
    );

    pool.dispose();

    await expect(pending).rejects.toMatchObject({ code: "WORKER_POOL_DISPOSED" });
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });

  it("keeps pending plus buffered work bounded by concurrency for a slow consumer", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker(), new PoolMockWorker()];
    const pool = await createPool(workers);
    const iterator = pool
      .renderFrames(SCENE, { timesMs: [0, 1, 2, 3, 4, 5], format: "svg" })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ value: { index: 0 }, done: false });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(workers.reduce((sum, worker) => sum + worker.nextRequestCount, 0)).toBe(3);

    await expect(iterator.next()).resolves.toMatchObject({ value: { index: 1 }, done: false });
    expect(workers.reduce((sum, worker) => sum + worker.nextRequestCount, 0)).toBe(4);
    await iterator.return?.();
    pool.dispose();
  });

  it("forwards identical preparation warnings only once", async () => {
    const warning: StructuredError = {
      severity: "recoverable",
      code: "TEST_WARNING",
      message: "one warning",
      fallback: "none",
      stage: "text",
    };
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    for (const worker of workers) {
      worker.warnings = [warning];
    }
    const delivered: string[] = [];
    const pool = await createPool(workers);

    await collectFrames(
      pool.renderFrames(SCENE, {
        timesMs: [0, 1],
        format: "svg",
        onWarning: (received) => delivered.push(received.code),
      }),
    );

    expect(delivered).toEqual(["TEST_WARNING"]);
    pool.dispose();
  });

  it("fails and closes all streams when Worker preparation warnings diverge", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    workers[0]!.warnings = [
      {
        severity: "recoverable",
        code: "FIRST_WARNING",
        message: "first",
        fallback: "none",
      },
    ];
    workers[1]!.warnings = [
      {
        severity: "recoverable",
        code: "SECOND_WARNING",
        message: "second",
        fallback: "none",
      },
    ];
    const pool = await createPool(workers);

    await expect(
      collectFrames(pool.renderFrames(SCENE, { timesMs: [0, 1], format: "svg" })),
    ).rejects.toMatchObject({ code: "WORKER_POOL_WARNING_MISMATCH" });
    expect(workers.map((worker) => worker.closedStreamIds.length)).toEqual([1, 1]);
    pool.dispose();
  });

  it("fails and closes all streams when a Worker returns a corrupt frame index", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    workers[0]!.returnedIndex = () => 99;
    const pool = await createPool(workers);

    await expect(
      collectFrames(pool.renderFrames(SCENE, { timesMs: [0, 1], format: "svg" })),
    ).rejects.toMatchObject({ code: "WORKER_FRAME_STREAM_CORRUPT" });
    expect(workers.map((worker) => worker.closedStreamIds.length)).toEqual([1, 1]);
    pool.dispose();
  });

  it("best-effort closes a prepared stream whose open response times out", async () => {
    const worker = new PoolMockWorker();
    worker.openResponseDelay = 40;
    const pool = await createPool([worker], { timeout: 10 });

    await expect(
      collectFrames(pool.renderFrames(SCENE, { timesMs: [0], format: "svg" })),
    ).rejects.toThrow("timed out");
    await vi.waitFor(() => expect(worker.closedStreamIds).toHaveLength(1));
    worker.openResponseDelay = 0;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(
      collectFrames(pool.renderFrames(SCENE, { timesMs: [7], format: "svg" })),
    ).resolves.toMatchObject([{ index: 0, timeMs: 7, format: "svg" }]);
    pool.dispose();
  });

  it("closes every Worker stream on iterator return", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    const pool = await createPool(workers);
    const iterator = pool
      .renderFrames(SCENE, { timesMs: [0, 1, 2, 3], format: "png" })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { index: 0, format: "png" },
      done: false,
    });
    await iterator.return?.();

    expect(workers.map((worker) => worker.closedStreamIds.length)).toEqual([1, 1]);
    await expect(
      collectFrames(pool.renderFrames(SCENE, { timesMs: [8, 9], format: "png" })),
    ).resolves.toMatchObject([
      { index: 0, timeMs: 8, format: "png" },
      { index: 1, timeMs: 9, format: "png" },
    ]);
    pool.dispose();
  });

  it("aborts an active stream and rejects the next read", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    const pool = await createPool(workers);
    const abortController = new AbortController();
    const iterator = pool
      .renderFrames(SCENE, {
        timesMs: [0, 1, 2, 3],
        format: "svg",
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();

    await iterator.next();
    abortController.abort("test abort");
    await vi.waitFor(() =>
      expect(workers.map((worker) => worker.closedStreamIds.length)).toEqual([1, 1]),
    );
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      collectFrames(pool.renderFrames(SCENE, { timesMs: [8, 9], format: "svg" })),
    ).resolves.toMatchObject([
      { index: 0, timeMs: 8, format: "svg" },
      { index: 1, timeMs: 9, format: "svg" },
    ]);
    pool.dispose();
  });

  it("rejects a pre-aborted stream before preparing on any Worker", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    const pool = await createPool(workers);
    const abortController = new AbortController();
    abortController.abort("already aborted");

    await expect(
      collectFrames(
        pool.renderFrames(SCENE, {
          timesMs: [0, 1],
          format: "svg",
          signal: abortController.signal,
        }),
      ),
    ).rejects.toBeInstanceOf(DOMException);
    expect(workers.map((worker) => worker.prepareCount)).toEqual([0, 0]);
    expect(workers.map((worker) => worker.closedStreamIds.length)).toEqual([0, 0]);
    pool.dispose();
  });

  it("closes the whole stream on the first fatal Worker result", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    workers[0]!.delayForIndex = () => 20;
    workers[1]!.failIndex = 1;
    const pool = await createPool(workers);
    const yielded: number[] = [];

    await expect(
      (async () => {
        for await (const frame of pool.renderFrames(SCENE, {
          timesMs: [0, 1, 2, 3],
          format: "svg",
        })) {
          yielded.push(frame.index);
        }
      })(),
    ).rejects.toMatchObject({ code: "TEST_FRAME_FAILURE" });
    expect(yielded).toEqual([]);
    expect(workers.map((worker) => worker.closedStreamIds.length)).toEqual([1, 1]);
    workers[0]!.delayForIndex = () => 0;
    workers[1]!.failIndex = undefined;
    await expect(
      collectFrames(pool.renderFrames(SCENE, { timesMs: [8, 9], format: "svg" })),
    ).resolves.toMatchObject([
      { index: 0, timeMs: 8, format: "svg" },
      { index: 1, timeMs: 9, format: "svg" },
    ]);
    pool.dispose();
  });

  it("validates the complete schedule before opening any prepared stream", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    const pool = await createPool(workers);

    expect(() =>
      pool.renderFrames(SCENE, { timesMs: [0, Number.NaN, 2], format: "svg" }),
    ).toThrowError(FatalError);
    expect(workers.map((worker) => worker.prepareCount)).toEqual([0, 0]);

    workers[0]!.warnings = [
      {
        severity: "recoverable",
        code: "EMPTY_SCHEDULE_WARNING",
        message: "warning from scene preparation",
      },
    ];
    const delivered: string[] = [];
    expect(
      await collectFrames(
        pool.renderFrames(SCENE, {
          timesMs: [],
          format: "svg",
          onWarning: (warning) => delivered.push(warning.code),
        }),
      ),
    ).toEqual([]);
    expect(delivered).toEqual(["EMPTY_SCHEDULE_WARNING"]);
    expect(workers.map((worker) => worker.prepareCount)).toEqual([1, 0]);
    expect(workers.map((worker) => worker.closedStreamIds.length)).toEqual([1, 0]);
    pool.dispose();
  });

  it("pool disposal rejects active work and terminates factory Workers", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    for (const worker of workers) {
      worker.delayForIndex = () => 100;
    }
    const pool = await createPool(workers);
    const iterator = pool
      .renderFrames(SCENE, { timesMs: [0, 1, 2, 3], format: "svg" })
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    await vi.waitFor(() =>
      expect(workers.reduce((sum, worker) => sum + worker.nextRequestCount, 0)).toBe(2),
    );

    pool.dispose();

    await expect(pending).rejects.toMatchObject({
      name: "FatalError",
      code: "WORKER_POOL_DISPOSED",
      stage: "engine",
    });
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });

  it("keeps the pool disposal error when disposed while a stream is opening", async () => {
    const worker = new PoolMockWorker();
    worker.openResponseDelay = 100;
    const pool = await createPool([worker]);
    const pending = pool
      .renderFrames(SCENE, { timesMs: [0], format: "svg" })
      [Symbol.asyncIterator]()
      .next();
    await vi.waitFor(() => expect(worker.prepareCount).toBe(1));

    pool.dispose();

    await expect(pending).rejects.toMatchObject({
      name: "FatalError",
      code: "WORKER_POOL_DISPOSED",
      stage: "engine",
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("disposes idempotently through both explicit and symbol paths", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    const pool = await createPool(workers);
    const disposable = pool as unknown as Record<symbol, () => void>;

    disposable[Symbol.dispose]?.();
    pool.dispose();

    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
    expect(() => pool.renderFrames(SCENE, { timesMs: [0], format: "svg" })).toThrowError(
      expect.objectContaining({
        name: "FatalError",
        code: "WORKER_POOL_DISPOSED",
        stage: "engine",
      }),
    );
  });
});

function sceneWithWidth(width: number): SceneNode {
  return {
    type: "Canvas",
    width: 320,
    height: 180,
    children: [{ type: "Box", id: `box-${width}`, width, height: 40, children: [] }],
  };
}

describe("WorkerPool materialized frames", () => {
  it("renders sync materialized scenes in input order with static sampling", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker(), new PoolMockWorker()];
    workers[0]!.renderDelayForTime = (timeMs) => (timeMs === 600 ? 25 : 1);
    const pool = await createPool(workers);
    const inputs = [
      { timeMs: 600, scene: sceneWithWidth(80) },
      { timeMs: 0, scene: sceneWithWidth(120) },
      { timeMs: 1_400, scene: sceneWithWidth(160) },
      { timeMs: 600, scene: sceneWithWidth(200) },
    ];

    const frames = await collectFrames(pool.renderMaterializedFrames(inputs, { format: "svg" }));

    expect(frames).toMatchObject(
      inputs.map((input, index) => ({ index, timeMs: input.timeMs, format: "svg" })),
    );
    expect(frames.map((frame) => String(Reflect.get(frame as object, "data")))).toEqual(
      inputs.map(
        (input) => `<svg data-time="${input.timeMs}">${JSON.stringify(input.scene)}</svg>`,
      ),
    );
    expect(
      workers
        .flatMap((worker) => worker.renderRequests)
        .every(
          (request) =>
            request.options?.animation === "static" && typeof request.options.timeMs === "number",
        ),
    ).toBe(true);
    pool.dispose();
  });

  it("matches concurrency one and many for async input and PNG bytes", async () => {
    const inputs = [
      { timeMs: 900, scene: sceneWithWidth(90) },
      { timeMs: 10, scene: sceneWithWidth(110) },
      { timeMs: 900, scene: sceneWithWidth(130) },
    ];
    const render = async (workers: PoolMockWorker[]) => {
      const pool = await createPool(workers);
      async function* source(): AsyncGenerator<MaterializedFrameInput> {
        for (const input of inputs) {
          await Promise.resolve();
          yield input;
        }
      }
      const frames = await collectFrames(
        pool.renderMaterializedFrames(source(), { format: "png" }),
      );
      pool.dispose();
      return frames;
    };

    expect(
      await render([new PoolMockWorker(), new PoolMockWorker(), new PoolMockWorker()]),
    ).toEqual(await render([new PoolMockWorker()]));
  });

  it("bounds input consumption and buffered results by concurrency", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker(), new PoolMockWorker()];
    const pool = await createPool(workers);
    let consumed = 0;
    async function* source(): AsyncGenerator<MaterializedFrameInput> {
      for (let index = 0; index < 8; index += 1) {
        consumed += 1;
        yield { timeMs: index, scene: sceneWithWidth(80 + index) };
      }
    }
    const iterator = pool
      .renderMaterializedFrames(source(), { format: "svg" })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ value: { index: 0 }, done: false });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(consumed).toBe(3);
    expect(workers.reduce((sum, worker) => sum + worker.renderRequests.length, 0)).toBe(3);

    await expect(iterator.next()).resolves.toMatchObject({ value: { index: 1 }, done: false });
    expect(consumed).toBe(4);
    expect(workers.reduce((sum, worker) => sum + worker.renderRequests.length, 0)).toBe(4);
    await iterator.return?.();
    pool.dispose();
  });

  it("forwards per-frame warnings in input order rather than completion order", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    workers[0]!.renderDelayForTime = () => 25;
    for (const worker of workers) {
      worker.warningsForTime = (timeMs) => [
        {
          severity: "recoverable",
          code: `WARNING_${timeMs}`,
          message: `warning at ${timeMs}`,
          fallback: "none",
        },
      ];
    }
    const delivered: string[] = [];
    const pool = await createPool(workers);

    await collectFrames(
      pool.renderMaterializedFrames(
        [
          { timeMs: 0, scene: sceneWithWidth(80) },
          { timeMs: 1, scene: sceneWithWidth(90) },
        ],
        {
          format: "svg",
          onWarning: (warning) => delivered.push(warning.code),
        },
      ),
    );

    expect(delivered).toEqual(["WARNING_0", "WARNING_1"]);
    pool.dispose();
  });

  it("validates each delayed time before enqueue and preserves prior yielded frames", async () => {
    const worker = new PoolMockWorker();
    const pool = await createPool([worker]);
    const inputs = [
      { timeMs: 0, scene: sceneWithWidth(80) },
      { timeMs: Number.NaN, scene: sceneWithWidth(100) },
    ];
    const iterator = pool
      .renderMaterializedFrames(inputs, { format: "svg" })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ value: { index: 0 }, done: false });
    await expect(iterator.next()).rejects.toMatchObject({ code: "ANIMATION_INVALID_TIME" });
    expect(worker.renderRequests).toHaveLength(1);
    pool.dispose();
  });

  it("rejects non-serializable scenes before sending a Worker request", async () => {
    const worker = new PoolMockWorker();
    const pool = await createPool([worker]);
    const scene = { ...sceneWithWidth(80), callback: () => undefined } as unknown as SceneNode;

    await expect(
      collectFrames(pool.renderMaterializedFrames([{ timeMs: 0, scene }], { format: "svg" })),
    ).rejects.toMatchObject({ code: "WORKER_MATERIALIZED_FRAME_NOT_SERIALIZABLE" });
    expect(worker.renderRequests).toHaveLength(0);
    pool.dispose();
  });

  it("rejects a non-iterable materialized source", async () => {
    const worker = new PoolMockWorker();
    const pool = await createPool([worker]);

    await expect(
      collectFrames(
        pool.renderMaterializedFrames(42 as unknown as MaterializedFrameSource, {
          format: "svg",
        }),
      ),
    ).rejects.toMatchObject({ code: "WORKER_MATERIALIZED_SOURCE_NOT_ITERABLE" });
    expect(worker.renderRequests).toHaveLength(0);
    pool.dispose();
  });

  it.each([
    ["primitive", 42],
    ["missing scene", { timeMs: 0 }],
    ["missing time", { scene: sceneWithWidth(80) }],
    ["class input", new (class MaterializedFixture {})()],
  ])("rejects an invalid materialized frame shape: %s", async (_label, value) => {
    const worker = new PoolMockWorker();
    const pool = await createPool([worker]);
    const source = [value] as unknown as MaterializedFrameInput[];

    await expect(
      collectFrames(pool.renderMaterializedFrames(source, { format: "svg" })),
    ).rejects.toMatchObject({ code: "WORKER_MATERIALIZED_FRAME_INVALID" });
    expect(worker.renderRequests).toHaveLength(0);
    pool.dispose();
  });

  it("calls source return on consumer return and source failure", async () => {
    const worker = new PoolMockWorker();
    const pool = await createPool([worker]);
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    let nextIndex = 0;
    const source: AsyncIterable<MaterializedFrameInput> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (nextIndex === 1) {
            throw new Error("source failed");
          }
          nextIndex += 1;
          return { done: false as const, value: { timeMs: 0, scene: sceneWithWidth(80) } };
        },
        return: returned,
      }),
    };
    const iterator = pool
      .renderMaterializedFrames(source, { format: "svg" })
      [Symbol.asyncIterator]();

    await iterator.next();
    await expect(iterator.next()).rejects.toThrow("source failed");
    expect(returned).toHaveBeenCalledTimes(1);

    const infiniteSource: AsyncIterable<MaterializedFrameInput> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: { timeMs: 0, scene: sceneWithWidth(80) } }),
        return: returned,
      }),
    };
    const returnedIterator = pool
      .renderMaterializedFrames(infiniteSource, { format: "svg" })
      [Symbol.asyncIterator]();
    await returnedIterator.next();
    await returnedIterator.return?.();
    expect(returned).toHaveBeenCalledTimes(2);
    pool.dispose();
  });

  it("closes an empty source without opening a Worker job", async () => {
    const worker = new PoolMockWorker();
    const pool = await createPool([worker]);
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    const source: AsyncIterable<MaterializedFrameInput> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true, value: undefined }),
        return: returned,
      }),
    };

    expect(await collectFrames(pool.renderMaterializedFrames(source, { format: "svg" }))).toEqual(
      [],
    );
    expect(returned).toHaveBeenCalledTimes(1);
    expect(worker.renderRequests).toHaveLength(0);
    pool.dispose();
  });

  it("runs a sync generator finally block on consumer return", async () => {
    const worker = new PoolMockWorker();
    const pool = await createPool([worker]);
    let finalized = 0;
    function* source(): Generator<MaterializedFrameInput> {
      try {
        while (true) {
          yield { timeMs: 0, scene: sceneWithWidth(80) };
        }
      } finally {
        finalized += 1;
      }
    }
    const iterator = pool
      .renderMaterializedFrames(source(), { format: "svg" })
      [Symbol.asyncIterator]();

    await iterator.next();
    await iterator.return?.();

    expect(finalized).toBe(1);
    pool.dispose();
  });

  it("aborts while an async source pull is pending without enqueueing a frame", async () => {
    const worker = new PoolMockWorker();
    const pool = await createPool([worker]);
    const abortController = new AbortController();
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    const source: AsyncIterable<MaterializedFrameInput> = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<MaterializedFrameInput>>(() => undefined),
        return: returned,
      }),
    };
    const iterator = pool
      .renderMaterializedFrames(source, {
        format: "svg",
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    abortController.abort("stop source");

    await expect(pending).rejects.toBeInstanceOf(DOMException);
    expect(worker.renderRequests).toHaveLength(0);
    expect(returned).toHaveBeenCalledTimes(1);
    await expect(
      collectFrames(
        pool.renderMaterializedFrames([{ timeMs: 8, scene: sceneWithWidth(88) }], {
          format: "svg",
        }),
      ),
    ).resolves.toHaveLength(1);
    pool.dispose();
  });

  it("stops the source after the first fatal Worker result", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker()];
    workers[1]!.failRenderTime = 1;
    workers[0]!.renderDelayForTime = () => 25;
    const pool = await createPool(workers);
    let consumed = 0;
    let returned = false;
    const source: AsyncIterable<MaterializedFrameInput> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          const timeMs = consumed;
          consumed += 1;
          return { done: false, value: { timeMs, scene: sceneWithWidth(80 + timeMs) } };
        },
        return: async () => {
          returned = true;
          return { done: true, value: undefined };
        },
      }),
    };

    await expect(
      collectFrames(pool.renderMaterializedFrames(source, { format: "svg" })),
    ).rejects.toMatchObject({ code: "TEST_MATERIALIZED_FAILURE" });
    expect(consumed).toBe(2);
    expect(returned).toBe(true);
    workers[0]!.renderDelayForTime = () => 0;
    workers[1]!.failRenderTime = undefined;
    await expect(
      collectFrames(
        pool.renderMaterializedFrames([{ timeMs: 8, scene: sceneWithWidth(88) }], {
          format: "svg",
        }),
      ),
    ).resolves.toHaveLength(1);
    pool.dispose();
  });

  it("pool disposal rejects active materialized work and closes its source", async () => {
    const worker = new PoolMockWorker();
    worker.renderDelayForTime = () => 100;
    const pool = await createPool([worker]);
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    const source: AsyncIterable<MaterializedFrameInput> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: { timeMs: 0, scene: sceneWithWidth(80) } }),
        return: returned,
      }),
    };
    const pending = pool
      .renderMaterializedFrames(source, { format: "svg" })
      [Symbol.asyncIterator]()
      .next();
    await vi.waitFor(() => expect(worker.renderRequests).toHaveLength(1));

    pool.dispose();

    await expect(pending).rejects.toMatchObject({
      name: "FatalError",
      code: "WORKER_POOL_DISPOSED",
      stage: "engine",
    });
    expect(returned).toHaveBeenCalledTimes(1);
  });

  it("uses only active Workers when the source is shorter than concurrency", async () => {
    const workers = [new PoolMockWorker(), new PoolMockWorker(), new PoolMockWorker()];
    const pool = await createPool(workers);

    await collectFrames(
      pool.renderMaterializedFrames([{ timeMs: 0, scene: sceneWithWidth(80) }], {
        format: "svg",
      }),
    );

    expect(workers.map((worker) => worker.renderRequests.length)).toEqual([1, 0, 0]);
    pool.dispose();
  });

  it("rejects materialized rendering synchronously after pool disposal", async () => {
    const pool = await createPool([new PoolMockWorker()]);
    pool.dispose();

    expect(() =>
      pool.renderMaterializedFrames([{ timeMs: 0, scene: sceneWithWidth(80) }], {
        format: "svg",
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "FatalError",
        code: "WORKER_POOL_DISPOSED",
        stage: "engine",
      }),
    );
  });
});
