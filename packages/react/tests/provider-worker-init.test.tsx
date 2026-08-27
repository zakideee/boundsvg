// @vitest-environment happy-dom
/** @jsxImportSource react */

/**
 * Tests for BoundSvgProvider Worker initialization paths.
 *
 * Covers:
 * - Worker init success → workerEngine is set, engine is null
 * - Worker init failure → fallback to main-thread Engine
 * - worker + wasm co-specification warning
 *
 * All heavy modules (@boundsvg/core, @boundsvg/browser, @boundsvg/worker) are
 * fully mocked to avoid WASM loading.
 */

import type {
  BrowserFontDefinition,
  FontLoader,
  ResolvedBrowserFont,
} from "@boundsvg/browser/fonts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BoundSvgContextValue } from "../src/types.js";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any module that imports them
// ---------------------------------------------------------------------------

// Stub the global Worker constructor (happy-dom does not provide it).
// The provider now creates `new Worker(url, { type: "module" })` directly
// before passing the instance to WorkerEngine.create().
let lastCreatedWorker: MockWorker | null = null;
class MockWorker {
  constructor(
    public url: string | URL,
    public options?: WorkerOptions,
  ) {
    lastCreatedWorker = this;
  }
  postMessage = vi.fn();
  terminate = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
}
vi.stubGlobal("Worker", MockWorker);

const mockDispose = vi.fn();
const mockWorkerEngine = {
  renderToSvg: vi.fn(async () => "<svg></svg>"),
  renderToPng: vi.fn(async () => new Uint8Array()),
  dispose: mockDispose,
};

const mockEngine = {
  renderToSvg: vi.fn(() => "<svg></svg>"),
  dispose: vi.fn(),
};

const mockWorkerEngineCreate = vi.fn(async (_opts?: unknown) => mockWorkerEngine);
const mockInitWasm = vi.fn(() => undefined);
const mockLoadWasmModule = vi.fn(async () => ({}));

const mockSharedPreloadFonts = vi.fn(
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

const mockFontLoader = {
  load: vi.fn(async (source: BrowserFontDefinition["source"]) => {
    if (source instanceof Uint8Array) {
      return source;
    }
    return new Uint8Array([9, 9, 9]);
  }),
  preload: vi.fn(
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
  ),
  clear: vi.fn(),
} satisfies FontLoader;

vi.mock("@boundsvg/browser/fonts", () => ({
  createFontLoader: vi.fn(() => mockFontLoader),
  preloadFonts: mockSharedPreloadFonts,
}));

vi.mock("@boundsvg/core", () => ({
  createEngineAsync: vi.fn(async () => mockEngine),
  initWasm: vi.fn(async () => undefined),
}));

// The provider imports initWasm from the ./wasm subpath; mocking the root
// specifier above does not cover it, and the real initWasm now rejects the
// dummy modules used here (schema-version handshake).
vi.mock("@boundsvg/core/wasm", () => ({
  initWasm: mockInitWasm,
}));

vi.mock("@boundsvg/browser", () => ({
  loadWasmModule: mockLoadWasmModule,
}));

vi.mock("@boundsvg/worker", () => ({
  WorkerEngine: {
    create: (...args: unknown[]) => mockWorkerEngineCreate(args[0]),
  },
}));

// Import after mocks
const { BoundSvgProvider } = await import("../src/provider.js");
const { useBoundSvg } = await import("../src/hooks/use-boundsvg.js");

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mount(ui: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function render(nextUi: React.ReactNode) {
    act(() => {
      root.render(nextUi);
    });
  }
  render(ui);
  return {
    container,
    render,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

afterEach(() => {
  document.body.innerHTML = "";
  lastCreatedWorker = null;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BoundSvgProvider Worker initialization", () => {
  it("resolves fonts through the default browser font loader", async () => {
    function Probe() {
      return null;
    }
    const fontData = new Uint8Array([0, 1, 2, 3]);
    const config = {
      fonts: [{ alias: "sans", source: fontData }],
      fontFetchOptions: { credentials: "include" as const },
    };

    const { unmount } = mount(
      <BoundSvgProvider config={config}>
        <Probe />
      </BoundSvgProvider>,
    );

    await flush();

    expect(mockSharedPreloadFonts).toHaveBeenCalledWith(config.fonts, {
      fetchOptions: config.fontFetchOptions,
    });
    unmount();
  });

  it("uses a custom font loader when provided", async () => {
    function Probe() {
      return null;
    }
    const customFontLoader = {
      load: vi.fn(async () => new Uint8Array([4])),
      preload: vi.fn(
        async (): Promise<ResolvedBrowserFont[]> => [
          { alias: "custom", weight: 700, style: "italic", data: new Uint8Array([4]) },
        ],
      ),
      clear: vi.fn(),
    } satisfies FontLoader;
    const config = {
      fonts: [{ alias: "custom", source: "/font.woff2" }],
      fontLoader: customFontLoader,
    };

    const { unmount } = mount(
      <BoundSvgProvider config={config}>
        <Probe />
      </BoundSvgProvider>,
    );

    await flush();

    expect(customFontLoader.preload).toHaveBeenCalledWith(config.fonts, {
      fetchOptions: undefined,
    });
    expect(mockSharedPreloadFonts).not.toHaveBeenCalled();
    unmount();
  });

  it("initializes workerEngine when worker.mode=prefer and sets status=ready", async () => {
    let snap: BoundSvgContextValue | null = null;
    function Probe() {
      snap = useBoundSvg();
      return <div>ready:{String(snap.status)}</div>;
    }

    const config = {
      worker: { mode: "prefer" as const, timeoutMs: 1234 },
      fonts: [{ alias: "sans", source: new Uint8Array([0, 1, 2, 3]) }],
      geometries: [
        {
          id: "rect",
          doc: {
            viewBox: { width: 20, height: 10 },
            root: { kind: "path" as const, d: "M0 0H20V10H0Z" },
          },
        },
      ],
      symbols: [
        {
          id: "rect-symbol",
          def: {
            geometry: {
              viewBox: { width: 20, height: 10 },
              root: { kind: "path" as const, d: "M0 0H20V10H0Z" },
            },
          },
        },
      ],
    };

    const { unmount } = mount(
      <BoundSvgProvider config={config}>
        <Probe />
      </BoundSvgProvider>,
    );

    await flush();

    expect(snap!.status).toBe("ready");
    expect(snap!.workerEngine).toBe(mockWorkerEngine);
    expect(snap!.engine).toBeNull();
    expect(mockWorkerEngineCreate).toHaveBeenCalledTimes(1);
    expect(mockWorkerEngineCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 1234,
        geometries: config.geometries,
        symbols: config.symbols,
      }),
    );

    // Raw Worker should not be terminated yet (still in use)
    const workerRef = lastCreatedWorker!;
    expect(workerRef.terminate).not.toHaveBeenCalled();

    // On unmount, both WorkerEngine.dispose() and raw Worker.terminate() are called
    unmount();
    expect(mockDispose).toHaveBeenCalledTimes(1);
    expect(workerRef.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not expose a main Engine from the previous config during a config transition", async () => {
    const snapshots: BoundSvgContextValue[] = [];
    function Probe() {
      snapshots.push(useBoundSvg());
      return null;
    }
    const firstConfig = {
      fonts: [{ alias: "first", source: "/first.woff2" }],
      defaultCommonOptions: { scale: 1 },
    };
    const secondConfig = {
      fonts: [{ alias: "second", source: "/second.woff2" }],
      defaultCommonOptions: { scale: 2 },
    };
    const mounted = mount(
      <BoundSvgProvider config={firstConfig} fallback={<Probe />}>
        <Probe />
      </BoundSvgProvider>,
    );
    await flush();

    const pendingFonts = deferred<ResolvedBrowserFont[]>();
    mockSharedPreloadFonts.mockReturnValueOnce(pendingFonts.promise);
    snapshots.length = 0;
    mounted.render(
      <BoundSvgProvider config={secondConfig} fallback={<Probe />}>
        <Probe />
      </BoundSvgProvider>,
    );

    expect(snapshots.some((snapshot) => snapshot.defaultCommonOptions?.scale === 2)).toBe(true);
    expect(
      snapshots.some(
        (snapshot) => snapshot.engine === mockEngine && snapshot.defaultCommonOptions?.scale === 2,
      ),
    ).toBe(false);
    expect(mockEngine.dispose).toHaveBeenCalledTimes(1);

    pendingFonts.resolve([]);
    await flush();
    mounted.unmount();
  });

  it("does not expose a WorkerEngine from the previous config during a config transition", async () => {
    const snapshots: BoundSvgContextValue[] = [];
    function Probe() {
      snapshots.push(useBoundSvg());
      return null;
    }
    const firstConfig = {
      fonts: [],
      worker: { mode: "prefer" as const, timeoutMs: 1000 },
      defaultCommonOptions: { scale: 1 },
    };
    const secondConfig = {
      fonts: [],
      worker: { mode: "prefer" as const, timeoutMs: 2000 },
      defaultCommonOptions: { scale: 2 },
    };
    const mounted = mount(
      <BoundSvgProvider config={firstConfig} fallback={<Probe />}>
        <Probe />
      </BoundSvgProvider>,
    );
    await flush();

    const firstRawWorker = lastCreatedWorker!;
    const pendingFonts = deferred<ResolvedBrowserFont[]>();
    mockSharedPreloadFonts.mockReturnValueOnce(pendingFonts.promise);
    snapshots.length = 0;
    mounted.render(
      <BoundSvgProvider config={secondConfig} fallback={<Probe />}>
        <Probe />
      </BoundSvgProvider>,
    );

    expect(snapshots.some((snapshot) => snapshot.defaultCommonOptions?.scale === 2)).toBe(true);
    expect(
      snapshots.some(
        (snapshot) =>
          snapshot.workerEngine === mockWorkerEngine && snapshot.defaultCommonOptions?.scale === 2,
      ),
    ).toBe(false);
    expect(mockDispose).toHaveBeenCalledTimes(1);
    expect(firstRawWorker.terminate).toHaveBeenCalledTimes(1);

    pendingFonts.resolve([]);
    await flush();
    mounted.unmount();
  });

  it("terminates the raw Worker while WorkerEngine initialization is pending", async () => {
    const pendingCreate = deferred<typeof mockWorkerEngine>();
    mockWorkerEngineCreate.mockReturnValueOnce(pendingCreate.promise);
    const { unmount } = mount(
      <BoundSvgProvider config={{ worker: { mode: "prefer" }, fonts: [] }}>
        <span>ready</span>
      </BoundSvgProvider>,
    );
    await flush();

    const workerRef = lastCreatedWorker!;
    unmount();
    expect(workerRef.terminate).toHaveBeenCalledTimes(1);

    pendingCreate.resolve(mockWorkerEngine);
    await flush();
    expect(mockDispose).toHaveBeenCalledTimes(1);
    expect(workerRef.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not construct a Worker when fonts resolve after unmount", async () => {
    const pendingFonts = deferred<ResolvedBrowserFont[]>();
    mockSharedPreloadFonts.mockReturnValueOnce(pendingFonts.promise);
    const { unmount } = mount(
      <BoundSvgProvider config={{ worker: { mode: "prefer" }, fonts: [] }}>
        <span>ready</span>
      </BoundSvgProvider>,
    );
    await flush();

    unmount();
    pendingFonts.resolve([]);
    await flush();

    expect(lastCreatedWorker).toBeNull();
    expect(mockWorkerEngineCreate).not.toHaveBeenCalled();
  });

  it("does not continue main-thread initialization when WASM loading resolves after unmount", async () => {
    const pendingWasm = deferred<object>();
    mockLoadWasmModule.mockReturnValueOnce(pendingWasm.promise);
    const { createEngineAsync } = await import("@boundsvg/core");
    const { unmount } = mount(
      <BoundSvgProvider config={{ fonts: [] }}>
        <span>ready</span>
      </BoundSvgProvider>,
    );
    await flush();

    expect(mockLoadWasmModule).toHaveBeenCalledTimes(1);
    unmount();
    pendingWasm.resolve({});
    await flush();

    expect(mockInitWasm).not.toHaveBeenCalled();
    expect(createEngineAsync).not.toHaveBeenCalled();
  });

  it("does not create an Engine when explicit WASM initialization resolves after unmount", async () => {
    const pendingInit = deferred<void>();
    mockInitWasm.mockReturnValueOnce(pendingInit.promise);
    const { createEngineAsync } = await import("@boundsvg/core");
    const { unmount } = mount(
      <BoundSvgProvider config={{ fonts: [], wasm: {} as never }}>
        <span>ready</span>
      </BoundSvgProvider>,
    );
    await flush();

    expect(mockInitWasm).toHaveBeenCalledTimes(1);
    unmount();
    pendingInit.resolve(undefined);
    await flush();

    expect(createEngineAsync).not.toHaveBeenCalled();
  });

  it("disposes an Engine when creation resolves after unmount", async () => {
    const pendingCreate = deferred<typeof mockEngine>();
    const { createEngineAsync } = await import("@boundsvg/core");
    (createEngineAsync as ReturnType<typeof vi.fn>).mockReturnValueOnce(pendingCreate.promise);
    const { unmount } = mount(
      <BoundSvgProvider config={{ fonts: [] }}>
        <span>ready</span>
      </BoundSvgProvider>,
    );
    await flush();

    expect(createEngineAsync).toHaveBeenCalledTimes(1);
    unmount();
    pendingCreate.resolve(mockEngine);
    await flush();

    expect(mockEngine.dispose).toHaveBeenCalledTimes(1);
  });

  it("suppresses Worker fallback when initialization rejects after unmount", async () => {
    const pendingCreate = deferred<typeof mockWorkerEngine>();
    const onFallback = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { createEngineAsync } = await import("@boundsvg/core");
    mockWorkerEngineCreate.mockReturnValueOnce(pendingCreate.promise);
    const { unmount } = mount(
      <BoundSvgProvider config={{ worker: { mode: "prefer", onFallback }, fonts: [] }}>
        <span>ready</span>
      </BoundSvgProvider>,
    );
    await flush();

    const workerRef = lastCreatedWorker!;
    unmount();
    expect(workerRef.terminate).toHaveBeenCalledTimes(1);

    pendingCreate.reject(new Error("late worker failure"));
    await flush();
    expect(onFallback).not.toHaveBeenCalled();
    expect(createEngineAsync).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(workerRef.terminate).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("falls back to main-thread Engine when Worker init fails", async () => {
    mockWorkerEngineCreate.mockRejectedValueOnce(new Error("Worker not supported"));
    const onFallback = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let snap: BoundSvgContextValue | null = null;
    function Probe() {
      snap = useBoundSvg();
      return <div>status:{snap.status}</div>;
    }

    const config = {
      worker: { mode: "prefer" as const, onFallback },
      fonts: [{ alias: "sans", source: new Uint8Array([0, 1, 2, 3]) }],
    };

    const { unmount } = mount(
      <BoundSvgProvider config={config}>
        <Probe />
      </BoundSvgProvider>,
    );

    await flush();

    expect(snap!.status).toBe("ready");
    expect(snap!.workerEngine).toBeNull();
    expect(snap!.engine).toBe(mockEngine);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(expect.any(Error));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Worker initialization failed"),
      expect.any(Error),
    );

    // Failed Worker should have been terminated during fallback
    expect(lastCreatedWorker!.terminate).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
    unmount();
  });

  it("warns when both worker and wasm are set", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    function Probe() {
      return null;
    }

    const config = {
      worker: { mode: "prefer" as const },
      wasm: {} as never, // dummy WasmModule
      fonts: [{ alias: "sans", source: new Uint8Array([0, 1, 2, 3]) }],
    };

    const { unmount } = mount(
      <BoundSvgProvider config={config}>
        <Probe />
      </BoundSvgProvider>,
    );

    await flush();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Both `worker` and `wasm` are set"),
    );
    warnSpy.mockRestore();
    unmount();
  });

  it("shows fallback UI while loading and children when ready", async () => {
    let resolveInit: (() => void) | null = null;
    mockWorkerEngineCreate.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveInit = () => r(mockWorkerEngine);
        }),
    );

    function Child() {
      return <div data-testid="child">loaded</div>;
    }

    const config = {
      worker: { mode: "prefer" as const },
      fonts: [{ alias: "sans", source: new Uint8Array([0, 1, 2, 3]) }],
    };

    const { container, unmount } = mount(
      <BoundSvgProvider config={config} fallback={<div data-testid="fallback">loading</div>}>
        <Child />
      </BoundSvgProvider>,
    );

    await flush();

    // While loading, fallback is shown
    expect(container.textContent).toContain("loading");
    expect(container.textContent).not.toContain("loaded");

    // Resolve init
    act(() => resolveInit!());
    await flush();

    // After ready, children are shown
    expect(container.textContent).toContain("loaded");
    expect(container.textContent).not.toContain("loading");
    unmount();
  });

  it("sets error status when both Worker and fallback fail", async () => {
    mockWorkerEngineCreate.mockRejectedValueOnce(new Error("Worker not supported"));

    // Also make the main-thread fallback fail
    const { createEngineAsync } = await import("@boundsvg/core");
    (createEngineAsync as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("WASM init failed"),
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let snap: BoundSvgContextValue | null = null;
    function Probe() {
      snap = useBoundSvg();
      return <div>status:{snap.status}</div>;
    }

    const config = {
      worker: { mode: "prefer" as const },
      fonts: [{ alias: "sans", source: new Uint8Array([0, 1, 2, 3]) }],
    };

    const { unmount } = mount(
      <BoundSvgProvider config={config}>
        <Probe />
      </BoundSvgProvider>,
    );

    await flush();

    expect(snap!.status).toBe("error");
    expect(snap!.error).not.toBeNull();
    expect(snap!.error!.message).toBe("WASM init failed");
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    unmount();
  });

  it("sets error status without fallback when worker.mode=required", async () => {
    mockWorkerEngineCreate.mockRejectedValueOnce(new Error("Worker not supported"));
    const { createEngineAsync } = await import("@boundsvg/core");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let snap: BoundSvgContextValue | null = null;
    function Probe() {
      snap = useBoundSvg();
      return <div>status:{snap.status}</div>;
    }

    const config = {
      worker: { mode: "required" as const },
      fonts: [{ alias: "sans", source: new Uint8Array([0, 1, 2, 3]) }],
    };

    const { unmount } = mount(
      <BoundSvgProvider config={config}>
        <Probe />
      </BoundSvgProvider>,
    );

    await flush();

    expect(snap!.status).toBe("error");
    expect(snap!.error!.message).toBe("Worker not supported");
    expect(createEngineAsync).not.toHaveBeenCalled();
    expect(lastCreatedWorker!.terminate).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
    unmount();
  });
});
