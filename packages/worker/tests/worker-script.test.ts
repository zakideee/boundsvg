import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerRequest, WorkerResponse } from "../src/protocol.js";

const workerEngineMethods = vi.hoisted(() => ({
  dispose: vi.fn(),
  frameIteratorReturn: vi.fn(),
  compileLayoutTransition: vi.fn(() => ({ marker: "compiled-transition" })),
  renderCompiledToAnimatedWebp: vi.fn(() => new Uint8Array([0x52, 0x49, 0x46, 0x46])),
  renderCompiledToAnimatedGif: vi.fn(() => new Uint8Array([0x47, 0x49, 0x46])),
  renderFrames: vi.fn((_scene: unknown, options: { timesMs: number[]; format: "svg" | "png" }) => {
    let nextIndex = 0;
    return {
      [Symbol.iterator]() {
        return this;
      },
      next() {
        const timeMs = options.timesMs[nextIndex];
        if (timeMs === undefined) {
          return { done: true, value: undefined };
        }
        const index = nextIndex;
        nextIndex += 1;
        return {
          done: false,
          value:
            options.format === "svg"
              ? { index, timeMs, format: "svg" as const, data: `<svg data-local="${index}"/>` }
              : { index, timeMs, format: "png" as const, data: new Uint8Array([index]) },
        };
      },
      return() {
        workerEngineMethods.frameIteratorReturn();
        return { done: true, value: undefined };
      },
    };
  }),
  renderCompiledFrames: vi.fn(
    (_compiled: unknown, options: { timesMs: number[]; format: "svg" | "png" }) =>
      workerEngineMethods.renderFrames(undefined, options),
  ),
  layoutTextFlow: vi.fn((input: unknown) => ({ api: "layoutTextFlow", input })),
  layoutTextFlowWithExclusions: vi.fn((input: unknown) => ({
    api: "layoutTextFlowWithExclusions",
    input,
  })),
  measureTextBlock: vi.fn((input: unknown) => ({ api: "measureTextBlock", input })),
  shrinkwrapText: vi.fn((input: unknown) => ({ api: "shrinkwrapText", input })),
  shrinkwrapFlow: vi.fn((input: unknown) => ({ api: "shrinkwrapFlow", input })),
  measureIntrinsicInlineSize: vi.fn((input: unknown) => ({
    api: "measureIntrinsicInlineSize",
    input,
  })),
}));

vi.mock("@boundsvg/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@boundsvg/core")>();
  return {
    ...actual,
    createEngineAsync: vi.fn(async () => workerEngineMethods as never),
  };
});

vi.mock("@boundsvg/core/wasm", () => ({
  initWasm: vi.fn(async () => undefined),
}));

vi.mock("@boundsvg/browser/wasm", () => ({
  loadWasmModule: vi.fn(async () => ({})),
}));

class TestWorkerScope {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly responses: WorkerResponse[] = [];

  postMessage(message: unknown): void {
    this.responses.push(structuredClone(message) as WorkerResponse);
  }

  send(request: WorkerRequest): void {
    this.onmessage?.({ data: structuredClone(request) } as MessageEvent);
  }
}

describe("worker script measurement dispatch", () => {
  let scope: TestWorkerScope;

  beforeEach(async () => {
    scope = new TestWorkerScope();
    vi.stubGlobal("self", scope);
    await import("../src/worker-script.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("dispatches all measurement APIs across the message boundary", async () => {
    scope.send({ id: 1, type: "init", fonts: [] });
    await vi.waitFor(() => expect(scope.responses).toContainEqual({ id: 1, type: "init-ok" }));

    const requests: WorkerRequest[] = [
      { id: 2, type: "layout-text-flow", input: { marker: 2 } as never },
      { id: 3, type: "layout-text-flow-with-exclusions", input: { marker: 3 } as never },
      { id: 4, type: "measure-text-block", input: { marker: 4 } as never },
      { id: 5, type: "shrinkwrap-text", input: { marker: 5 } as never },
      { id: 6, type: "shrinkwrap-flow", input: { marker: 6 } as never },
      { id: 7, type: "measure-intrinsic-inline-size", input: { marker: 7 } as never },
    ];
    for (const request of requests) {
      scope.send(request);
    }

    await vi.waitFor(() => expect(scope.responses).toHaveLength(7));
    expect(scope.responses.map((response) => response.type)).toEqual([
      "init-ok",
      "layout-text-flow-ok",
      "layout-text-flow-with-exclusions-ok",
      "measure-text-block-ok",
      "shrinkwrap-text-ok",
      "shrinkwrap-flow-ok",
      "measure-intrinsic-inline-size-ok",
    ]);
    expect(scope.responses.slice(1).map((response) => Reflect.get(response, "result"))).toEqual([
      { api: "layoutTextFlow", input: { marker: 2 } },
      { api: "layoutTextFlowWithExclusions", input: { marker: 3 } },
      { api: "measureTextBlock", input: { marker: 4 } },
      { api: "shrinkwrapText", input: { marker: 5 } },
      { api: "shrinkwrapFlow", input: { marker: 6 } },
      { api: "measureIntrinsicInlineSize", input: { marker: 7 } },
    ]);
  });

  it("keeps prepared frame iterators Worker-local and remaps global indices", async () => {
    scope.send({ id: 1, type: "init", fonts: [] });
    await vi.waitFor(() => expect(scope.responses).toContainEqual({ id: 1, type: "init-ok" }));

    scope.send({
      id: 2,
      type: "open-frame-stream",
      scene: { type: "Canvas", width: 100, height: 100, children: [] },
      schedule: [
        { index: 4, timeMs: 600 },
        { index: 1, timeMs: 0 },
      ],
      options: { format: "svg" },
    });
    await vi.waitFor(() =>
      expect(scope.responses).toContainEqual({
        id: 2,
        type: "open-frame-stream-ok",
        streamId: 2,
        warnings: [],
      }),
    );

    scope.send({ id: 3, type: "next-frame-stream", streamId: 2 });
    scope.send({ id: 4, type: "next-frame-stream", streamId: 2 });
    await vi.waitFor(() => expect(scope.responses).toHaveLength(4));

    expect(scope.responses.slice(2)).toEqual([
      {
        id: 3,
        type: "next-frame-stream-ok",
        streamId: 2,
        done: false,
        frame: { index: 4, timeMs: 600, format: "svg", data: '<svg data-local="0"/>' },
      },
      {
        id: 4,
        type: "next-frame-stream-ok",
        streamId: 2,
        done: false,
        frame: { index: 1, timeMs: 0, format: "svg", data: '<svg data-local="1"/>' },
      },
    ]);
    expect(workerEngineMethods.renderFrames).toHaveBeenCalledTimes(1);
    expect(workerEngineMethods.renderFrames.mock.calls[0]?.[1]).toMatchObject({
      timesMs: [600, 0],
      format: "svg",
    });
  });

  it("closes an active prepared iterator on close and dispose", async () => {
    scope.send({ id: 1, type: "init", fonts: [] });
    await vi.waitFor(() => expect(scope.responses).toHaveLength(1));
    const open = (id: number) =>
      scope.send({
        id,
        type: "open-frame-stream",
        scene: { type: "Canvas", width: 100, height: 100, children: [] },
        schedule: [{ index: 0, timeMs: 0 }],
        options: { format: "svg" },
      });

    open(2);
    await vi.waitFor(() => expect(scope.responses).toHaveLength(2));
    scope.send({ id: 3, type: "close-frame-stream", streamId: 2 });
    await vi.waitFor(() =>
      expect(workerEngineMethods.frameIteratorReturn).toHaveBeenCalledTimes(1),
    );

    open(4);
    await vi.waitFor(() => expect(scope.responses).toHaveLength(4));
    scope.send({ id: 5, type: "dispose" });
    await vi.waitFor(() =>
      expect(workerEngineMethods.frameIteratorReturn).toHaveBeenCalledTimes(2),
    );
    expect(workerEngineMethods.dispose).toHaveBeenCalled();
  });

  it("compiles transition raster requests inside the Worker before encoding", async () => {
    scope.send({ id: 1, type: "init", fonts: [] });
    await vi.waitFor(() => expect(scope.responses).toHaveLength(1));
    const transition = {
      states: {
        A: { type: "Canvas" as const, width: 100, height: 100, children: [] },
        B: { type: "Canvas" as const, width: 100, height: 100, children: [] },
      },
      checkpoints: [
        { timeMs: 0, state: "A" },
        { timeMs: 100, state: "B" },
        { timeMs: 200, state: "B" },
        { timeMs: 300, state: "A" },
      ],
    } as const;

    scope.send({
      id: 2,
      type: "render-layout-transition-animated-webp",
      transition,
      options: { durationMs: 300, textPathMode: "glyphs" },
    });
    scope.send({
      id: 3,
      type: "render-layout-transition-animated-gif",
      transition,
      options: { durationMs: 300 },
    });

    await vi.waitFor(() => expect(scope.responses).toHaveLength(3));
    expect(scope.responses.slice(1).map((response) => response.type)).toEqual([
      "render-animated-webp-ok",
      "render-animated-gif-ok",
    ]);
    expect(workerEngineMethods.compileLayoutTransition).toHaveBeenNthCalledWith(1, transition, {
      skipValidation: undefined,
      textPathMode: "glyphs",
    });
    expect(workerEngineMethods.renderCompiledToAnimatedWebp).toHaveBeenCalledWith(
      { marker: "compiled-transition" },
      expect.objectContaining({ durationMs: 300, onWarning: expect.any(Function) }),
    );
    expect(workerEngineMethods.renderCompiledToAnimatedGif).toHaveBeenCalledWith(
      { marker: "compiled-transition" },
      expect.objectContaining({ durationMs: 300, onWarning: expect.any(Function) }),
    );
  });

  it("keeps compiled transition frame iterators Worker-local", async () => {
    scope.send({ id: 1, type: "init", fonts: [] });
    await vi.waitFor(() => expect(scope.responses).toHaveLength(1));
    const transition = {
      states: {
        A: { type: "Canvas" as const, width: 100, height: 100, children: [] },
        B: { type: "Canvas" as const, width: 100, height: 100, children: [] },
      },
      checkpoints: [
        { timeMs: 0, state: "A" },
        { timeMs: 100, state: "B" },
        { timeMs: 200, state: "B" },
        { timeMs: 300, state: "A" },
      ],
    } as const;

    scope.send({
      id: 2,
      type: "open-layout-transition-frame-stream",
      transition,
      schedule: [{ index: 7, timeMs: 200 }],
      options: { format: "png" },
    });
    await vi.waitFor(() => expect(scope.responses).toHaveLength(2));
    scope.send({ id: 3, type: "next-frame-stream", streamId: 2 });
    await vi.waitFor(() => expect(scope.responses).toHaveLength(3));

    expect(workerEngineMethods.compileLayoutTransition).toHaveBeenCalledWith(transition, {
      skipValidation: undefined,
      textPathMode: undefined,
    });
    expect(workerEngineMethods.renderCompiledFrames).toHaveBeenCalledWith(
      { marker: "compiled-transition" },
      expect.objectContaining({ timesMs: [200], format: "png" }),
    );
    expect(scope.responses[2]).toMatchObject({
      type: "next-frame-stream-ok",
      frame: { index: 7, timeMs: 200, format: "png" },
    });
  });
});
