// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { BrowserFontDefinition, ResolvedBrowserFont } from "@boundsvg/browser/fonts";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoundSvgConfig, BoundSvgContextValue } from "../src/types.js";

type MockEngine = {
  dispose: ReturnType<typeof vi.fn>;
};

type MockWorkerEngine = {
  dispose: ReturnType<typeof vi.fn>;
};

class MockWorker {
  constructor(
    public url: string | URL,
    public options?: WorkerOptions,
  ) {
    createdWorkers.push(this);
  }

  postMessage = vi.fn();
  terminate = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
}

const createdEngines: MockEngine[] = [];
const createdWorkerEngines: MockWorkerEngine[] = [];
const createdWorkers: MockWorker[] = [];

const mockPreloadFonts = vi.fn(
  async (
    fonts: ReadonlyArray<BrowserFontDefinition>,
    _options?: unknown,
  ): Promise<ResolvedBrowserFont[]> =>
    fonts.map((fontEntry) => ({
      alias: fontEntry.alias,
      weight: fontEntry.weight ?? 400,
      style: fontEntry.style ?? "normal",
      data: fontEntry.source instanceof Uint8Array ? fontEntry.source : new Uint8Array([9, 9, 9]),
    })),
);

const mockCreateEngineAsync = vi.fn(async (_options?: unknown) => {
  const engine: MockEngine = { dispose: vi.fn() };
  createdEngines.push(engine);
  return engine;
});

const mockWorkerEngineCreate = vi.fn(async (_options?: unknown) => {
  const workerEngine: MockWorkerEngine = { dispose: vi.fn() };
  createdWorkerEngines.push(workerEngine);
  return workerEngine;
});

const mockInitWasm = vi.fn(async (_module?: unknown) => undefined);
const mockLoadWasmModule = vi.fn(async () => ({}));

class MockFatalError extends Error {
  readonly code: string;
  readonly stage: string | undefined;

  constructor(code: string, message: string, context?: { stage?: string }) {
    super(message);
    this.name = "FatalError";
    this.code = code;
    this.stage = context?.stage;
  }
}

vi.stubGlobal("Worker", MockWorker);

vi.mock("@boundsvg/browser/fonts", () => ({
  preloadFonts: mockPreloadFonts,
}));

vi.mock("@boundsvg/core", () => ({
  createEngineAsync: mockCreateEngineAsync,
  FatalError: MockFatalError,
}));

vi.mock("@boundsvg/core/wasm", () => ({
  initWasm: mockInitWasm,
}));

vi.mock("@boundsvg/browser", () => ({
  loadWasmModule: mockLoadWasmModule,
}));

vi.mock("@boundsvg/worker", () => ({
  WorkerEngine: {
    create: (options: unknown) => mockWorkerEngineCreate(options),
  },
}));

const { BoundSvgProvider } = await import("../src/provider.js");
const { useBoundSvg } = await import("../src/hooks/use-boundsvg.js");

let currentSnapshot: BoundSvgContextValue | null = null;

function ContextProbe() {
  currentSnapshot = useBoundSvg();
  return <div data-status={currentSnapshot.status} />;
}

function mount(ui: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return {
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  createdEngines.length = 0;
  createdWorkerEngines.length = 0;
  createdWorkers.length = 0;
  currentSnapshot = null;
  mockCreateEngineAsync.mockImplementation(async (_options?: unknown) => {
    const engine: MockEngine = { dispose: vi.fn() };
    createdEngines.push(engine);
    return engine;
  });
  mockWorkerEngineCreate.mockImplementation(async (_options?: unknown) => {
    const workerEngine: MockWorkerEngine = { dispose: vi.fn() };
    createdWorkerEngines.push(workerEngine);
    return workerEngine;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("BoundSvgProvider config stability", () => {
  it.each([
    ["main thread", undefined],
    ["Worker", { mode: "required" as const }],
  ])("rejects legacy Provider defaults synchronously before %s initialization", (_label, worker) => {
    const config = {
      fonts: [],
      defaultRenderOptions: { scale: 2 },
      ...(worker && { worker }),
    } as unknown as BoundSvgConfig;
    let thrown: unknown;
    try {
      mount(
        <BoundSvgProvider config={config}>
          <ContextProbe />
        </BoundSvgProvider>,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      name: "FatalError",
      code: "UNSUPPORTED_LEGACY_RENDER_OPTION",
      stage: "validate",
    });
    expect(mockPreloadFonts).not.toHaveBeenCalled();
    expect(mockCreateEngineAsync).not.toHaveBeenCalled();
    expect(mockWorkerEngineCreate).not.toHaveBeenCalled();
    expect(createdWorkers).toHaveLength(0);
  });

  it.each([
    ["main thread", undefined],
    ["Worker", { mode: "required" as const }],
  ])("rejects legacy keys inside defaultCommonOptions before %s initialization", (_label, worker) => {
    const config = {
      fonts: [],
      defaultCommonOptions: { animation: "declarative" },
      ...(worker && { worker }),
    } as unknown as BoundSvgConfig;
    let thrown: unknown;
    try {
      mount(
        <BoundSvgProvider config={config}>
          <ContextProbe />
        </BoundSvgProvider>,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      name: "FatalError",
      code: "UNSUPPORTED_LEGACY_RENDER_OPTION",
      stage: "validate",
    });
    expect(mockPreloadFonts).not.toHaveBeenCalled();
    expect(mockCreateEngineAsync).not.toHaveBeenCalled();
    expect(mockWorkerEngineCreate).not.toHaveBeenCalled();
    expect(createdWorkers).toHaveLength(0);
  });

  it.each([
    ["main thread", undefined],
    ["Worker", { mode: "required" as const }],
  ])("rejects artifact-specific common defaults synchronously before %s initialization", (_label, worker) => {
    const config = {
      fonts: [],
      defaultCommonOptions: { resourceIdPrefix: "preview-" },
      ...(worker && { worker }),
    } as unknown as BoundSvgConfig;
    let thrown: unknown;
    try {
      mount(
        <BoundSvgProvider config={config}>
          <ContextProbe />
        </BoundSvgProvider>,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      name: "FatalError",
      code: "UNSUPPORTED_RENDER_OPTION",
      stage: "validate",
    });
    expect(mockPreloadFonts).not.toHaveBeenCalled();
    expect(mockCreateEngineAsync).not.toHaveBeenCalled();
    expect(mockWorkerEngineCreate).not.toHaveBeenCalled();
    expect(createdWorkers).toHaveLength(0);
  });

  it("does not recreate a main-thread Engine for a fresh equal inline config", async () => {
    let setLabel!: (label: string) => void;
    function Parent() {
      const [label, setValue] = useState("first");
      setLabel = setValue;
      return (
        <div data-label={label}>
          <BoundSvgProvider config={{ fonts: [] }} fallback={<ContextProbe />}>
            <ContextProbe />
          </BoundSvgProvider>
        </div>
      );
    }
    const mounted = mount(<Parent />);
    await flush();
    act(() => setLabel("latest"));
    await flush();

    expect(mockPreloadFonts).toHaveBeenCalledTimes(1);
    expect(mockCreateEngineAsync).toHaveBeenCalledTimes(1);
    expect(createdEngines[0]?.dispose).not.toHaveBeenCalled();
    expect(currentSnapshot?.status).toBe("ready");
    mounted.unmount();
  });

  it("does not recreate an Engine for equal nested config values and callbacks", async () => {
    const warningLabels: string[] = [];
    let setLabel!: (label: string) => void;
    function Parent() {
      const [label, setValue] = useState("first");
      setLabel = setValue;
      return (
        <BoundSvgProvider
          config={{
            fonts: [{ alias: "sans", source: "/font.woff2" }],
            defaultCommonOptions: {
              debug: { parts: ["layout"] },
              onWarning: () => warningLabels.push(label),
            },
          }}
          fallback={<ContextProbe />}
        >
          <div data-label={label}>
            <ContextProbe />
          </div>
        </BoundSvgProvider>
      );
    }
    const mounted = mount(<Parent />);
    await flush();
    const firstDefaultCommonOptions = currentSnapshot?.defaultCommonOptions;
    act(() => setLabel("latest"));
    await flush();

    expect(mockPreloadFonts).toHaveBeenCalledTimes(1);
    expect(mockCreateEngineAsync).toHaveBeenCalledTimes(1);
    expect(currentSnapshot?.defaultCommonOptions).toBe(firstDefaultCommonOptions);
    currentSnapshot?.defaultCommonOptions?.onWarning?.(new Error("test warning") as never);
    expect(warningLabels).toEqual(["latest"]);
    mounted.unmount();
  });

  it("does not recreate a WorkerEngine for a fresh equal inline config", async () => {
    let setLabel!: (label: string) => void;
    function Parent() {
      const [label, setValue] = useState("first");
      setLabel = setValue;
      return (
        <div data-label={label}>
          <BoundSvgProvider
            config={{ fonts: [], worker: { mode: "prefer", timeoutMs: 1234 } }}
            fallback={<ContextProbe />}
          >
            <ContextProbe />
          </BoundSvgProvider>
        </div>
      );
    }
    const mounted = mount(<Parent />);
    await flush();
    act(() => setLabel("latest"));
    await flush();

    expect(mockWorkerEngineCreate).toHaveBeenCalledTimes(1);
    expect(createdWorkerEngines[0]?.dispose).not.toHaveBeenCalled();
    expect(createdWorkers[0]?.terminate).not.toHaveBeenCalled();
    expect(currentSnapshot?.status).toBe("ready");
    mounted.unmount();
  });

  it("recreates the Engine exactly once for a real font config change", async () => {
    let setSource!: (source: Uint8Array) => void;
    function Parent() {
      const [source, setValue] = useState(() => new Uint8Array([1]));
      setSource = setValue;
      return (
        <BoundSvgProvider
          config={{ fonts: [{ alias: "sans", source }] }}
          fallback={<ContextProbe />}
        >
          <ContextProbe />
        </BoundSvgProvider>
      );
    }
    const mounted = mount(<Parent />);
    await flush();
    act(() => setSource(new Uint8Array([2])));
    await flush();

    expect(mockPreloadFonts).toHaveBeenCalledTimes(2);
    expect(mockCreateEngineAsync).toHaveBeenCalledTimes(2);
    expect(createdEngines[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(mockPreloadFonts.mock.calls[1]?.[0]?.[0]?.source).toEqual(new Uint8Array([2]));
    mounted.unmount();
  });

  it("updates default common options without recreating the Engine", async () => {
    let setScale!: (scale: number) => void;
    function Parent() {
      const [scale, setValue] = useState(1);
      setScale = setValue;
      return (
        <BoundSvgProvider
          config={{ fonts: [], defaultCommonOptions: { scale } }}
          fallback={<ContextProbe />}
        >
          <ContextProbe />
        </BoundSvgProvider>
      );
    }
    const mounted = mount(<Parent />);
    await flush();
    act(() => setScale(2));
    await flush();

    expect(mockCreateEngineAsync).toHaveBeenCalledTimes(1);
    expect(createdEngines[0]?.dispose).not.toHaveBeenCalled();
    expect(currentSnapshot?.defaultCommonOptions?.scale).toBe(2);
    expect(currentSnapshot?.status).toBe("ready");
    mounted.unmount();
  });

  it("keeps one pending Worker attempt and delivers fallback to the latest closure", async () => {
    const failureGate = deferred<void>();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockWorkerEngineCreate.mockImplementationOnce(async () => {
      await failureGate.promise;
      throw new Error("worker unavailable");
    });
    const fallbackLabels: string[] = [];
    let setLabel!: (label: string) => void;
    function Parent() {
      const [label, setValue] = useState("first");
      setLabel = setValue;
      return (
        <BoundSvgProvider
          config={{
            fonts: [],
            worker: {
              mode: "prefer",
              onFallback: () => fallbackLabels.push(label),
            },
          }}
          fallback={<ContextProbe />}
        >
          <ContextProbe />
        </BoundSvgProvider>
      );
    }
    const mounted = mount(<Parent />);
    await flush();
    act(() => setLabel("latest"));
    await flush();
    failureGate.resolve();
    await flush();
    await flush();

    expect(mockWorkerEngineCreate).toHaveBeenCalledTimes(1);
    expect(fallbackLabels).toEqual(["latest"]);
    expect(mockCreateEngineAsync).toHaveBeenCalledTimes(1);
    expect(currentSnapshot?.status).toBe("ready");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("falling back to main thread"),
      expect.any(Error),
    );
    mounted.unmount();
  });

  it("recreates a WorkerEngine exactly once for a real Worker option change", async () => {
    let setTimeoutMs!: (timeoutMs: number) => void;
    function Parent() {
      const [timeoutMs, setValue] = useState(1000);
      setTimeoutMs = setValue;
      return (
        <BoundSvgProvider
          config={{ fonts: [], worker: { mode: "prefer", timeoutMs } }}
          fallback={<ContextProbe />}
        >
          <ContextProbe />
        </BoundSvgProvider>
      );
    }
    const mounted = mount(<Parent />);
    await flush();
    act(() => setTimeoutMs(2000));
    await flush();

    expect(mockWorkerEngineCreate).toHaveBeenCalledTimes(2);
    expect(createdWorkerEngines[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(createdWorkers[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(mockWorkerEngineCreate.mock.calls[1]?.[0]).toMatchObject({ timeout: 2000 });
    mounted.unmount();
  });
});
