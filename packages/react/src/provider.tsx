import { preloadFonts } from "@boundsvg/browser/fonts";
import { createEngineAsync, type Engine, FatalError } from "@boundsvg/core";
import { initWasm } from "@boundsvg/core/wasm";
import type { WorkerEngine } from "@boundsvg/worker";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BoundSvgContext } from "./context.js";
import {
  useStructurallyStableRenderOptions,
  useStructurallyStableValue,
} from "./hooks/use-structurally-stable-value.js";
import type { BoundSvgConfig, BoundSvgContextValue, BoundSvgStatus } from "./types.js";

export { useBoundSvg } from "./hooks/use-boundsvg.js";
export type {
  BoundSvgConfig,
  BoundSvgContextValue,
  BoundSvgDefaultCommonOptions,
  BoundSvgStatus,
  FontDefinition,
  WorkerConfig,
} from "./types.js";

export type BoundSvgProviderProps = {
  /** BoundSvg configuration (WASM, fonts, render options) */
  config: BoundSvgConfig;
  /** Fallback UI shown while loading */
  fallback?: ReactNode;
  /** Children rendered when ready */
  children: ReactNode;
};

type ResolvedFont = {
  alias: string;
  weight: number;
  style: "normal" | "italic";
  data: Uint8Array;
};

type InitializeResult = {
  engine: Engine | null;
  workerEngine: WorkerEngine | null;
  /** Raw Worker created by the provider. Must be terminated on cleanup
   *  because WorkerEngine treats externally-provided Workers as unowned. */
  rawWorker: Worker | null;
};

type InitializeLifecycle = {
  signal: AbortSignal;
  setRawWorker: (worker: Worker | null) => void;
};

type InitializeWorkerOptions = {
  config: BoundSvgConfig;
  workerConfig: NonNullable<BoundSvgConfig["worker"]>;
  resolvedFonts: ResolvedFont[];
  lifecycle: InitializeLifecycle;
};

function emptyInitializeResult(): InitializeResult {
  return { engine: null, workerEngine: null, rawWorker: null };
}

async function resolveFonts(config: BoundSvgConfig): Promise<ResolvedFont[]> {
  const fontLoaderOptions = { fetchOptions: config.fontFetchOptions };
  if (config.fontLoader) {
    return config.fontLoader.preload(config.fonts, fontLoaderOptions);
  }
  return preloadFonts(config.fonts, fontLoaderOptions);
}

async function loadWasmAndCreateEngine(
  config: BoundSvgConfig,
  resolvedFonts: ResolvedFont[],
  lifecycle: InitializeLifecycle,
): Promise<Engine | null> {
  if (config.wasm) {
    await initWasm(config.wasm);
  } else {
    const { loadWasmModule } = await import("@boundsvg/browser");
    if (lifecycle.signal.aborted) {
      return null;
    }
    const wasmModule = await loadWasmModule();
    if (lifecycle.signal.aborted) {
      return null;
    }
    await initWasm(wasmModule);
  }
  if (lifecycle.signal.aborted) {
    return null;
  }
  return createEngineAsync({
    fonts: resolvedFonts,
    geometries: config.geometries,
    symbols: config.symbols,
  });
}

async function initializeWorker({
  config,
  workerConfig,
  resolvedFonts,
  lifecycle,
}: InitializeWorkerOptions): Promise<InitializeResult> {
  // Create the Worker using the `new Worker(new URL(...))` pattern so
  // bundlers (Vite, Webpack 5) can statically detect and bundle the
  // worker script with all its dependencies.
  const worker = workerConfig.url
    ? new Worker(workerConfig.url, { type: "module" })
    : new Worker(new URL("@boundsvg/worker/worker", import.meta.url), {
        type: "module",
      });
  lifecycle.setRawWorker(worker);
  try {
    const { WorkerEngine: WE } = await import("@boundsvg/worker");
    if (lifecycle.signal.aborted) {
      return emptyInitializeResult();
    }
    const fontTransfers = resolvedFonts.map((font) => ({
      alias: font.alias,
      weight: font.weight,
      style: font.style,
      data: font.data.buffer.slice(
        font.data.byteOffset,
        font.data.byteOffset + font.data.byteLength,
      ) as ArrayBuffer,
    }));
    const workerEngine = await WE.create({
      worker,
      fonts: fontTransfers,
      geometries: config.geometries,
      symbols: config.symbols,
      timeout: workerConfig.timeoutMs,
    });
    if (lifecycle.signal.aborted) {
      // Effect cleanup may already have terminated the externally owned Worker.
      workerEngine.dispose();
      return emptyInitializeResult();
    }
    return { engine: null, workerEngine, rawWorker: worker };
  } catch (workerError) {
    if (lifecycle.signal.aborted) {
      return emptyInitializeResult();
    }
    // Terminate the failed Worker before falling back to main thread
    worker.terminate();
    lifecycle.setRawWorker(null);
    const error = workerError instanceof Error ? workerError : new Error(String(workerError));
    if (workerConfig.mode === "required") {
      throw error;
    }
    workerConfig.onFallback?.(error);
    if (lifecycle.signal.aborted) {
      return emptyInitializeResult();
    }
    console.warn(
      "[BoundSvgProvider] Worker initialization failed, falling back to main thread:",
      error,
    );
    const engine = await loadWasmAndCreateEngine(config, resolvedFonts, lifecycle);
    return { engine, workerEngine: null, rawWorker: null };
  }
}

async function initialize(
  config: BoundSvgConfig,
  lifecycle: InitializeLifecycle,
): Promise<InitializeResult> {
  if (config.worker && config.wasm) {
    console.warn(
      "[BoundSvgProvider] Both `worker` and `wasm` are set. " +
        "In Worker mode, WASM is loaded inside the Worker and `wasm` is ignored. " +
        "`wasm` is only used on the main-thread path.",
    );
  }

  // 1. Fetch font data
  const resolvedFonts = await resolveFonts(config);
  if (lifecycle.signal.aborted) {
    return emptyInitializeResult();
  }

  if (config.worker) {
    // 3a. Worker path: create WorkerEngine (WASM is loaded inside the Worker)
    return initializeWorker({ config, workerConfig: config.worker, resolvedFonts, lifecycle });
  }

  // 3b. Main-thread path
  const engine = await loadWasmAndCreateEngine(config, resolvedFonts, lifecycle);
  return { engine, workerEngine: null, rawWorker: null };
}

type WorkerFallbackCallback = NonNullable<NonNullable<BoundSvgConfig["worker"]>["onFallback"]>;

function useStableProviderConfig(config: BoundSvgConfig) {
  const stableDefaultCommonOptions = useStructurallyStableRenderOptions(
    config.defaultCommonOptions,
  );
  const latestWorkerFallbackRef = useRef(config.worker?.onFallback);
  useLayoutEffect(() => {
    latestWorkerFallbackRef.current = config.worker?.onFallback;
  }, [config.worker?.onFallback]);
  const stableWorkerFallbackRef = useRef<WorkerFallbackCallback | null>(null);
  stableWorkerFallbackRef.current ??= (error) => latestWorkerFallbackRef.current?.(error);

  const normalizedWorker =
    config.worker && Object.hasOwn(config.worker, "onFallback")
      ? { ...config.worker, onFallback: stableWorkerFallbackRef.current }
      : config.worker;
  const initializationConfig = useStructurallyStableValue<BoundSvgConfig>({
    ...config,
    worker: normalizedWorker,
    // Render defaults are consumed by hooks and do not affect Engine creation.
    defaultCommonOptions: undefined,
  });
  return { initializationConfig, stableDefaultCommonOptions };
}

const PROVIDER_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "wasm",
  "fonts",
  "fontLoader",
  "fontFetchOptions",
  "defaultCommonOptions",
  "geometries",
  "symbols",
  "worker",
]);

const DEFAULT_COMMON_OPTION_KEYS: ReadonlySet<string> = new Set([
  "skipValidation",
  "textPathMode",
  "scale",
  "debug",
  "onWarning",
  "showMissingGlyphs",
  "generator",
]);

const LEGACY_RENDER_OPTION_KEYS: ReadonlySet<string> = new Set([
  "animation",
  "loop",
  "loopCount",
  "loop_count",
]);

function unsupportedProviderOption(code: string, message: string): FatalError {
  return new FatalError(code, message, { stage: "validate" });
}

function assertOwnProviderKeys(config: BoundSvgConfig): void {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw unsupportedProviderOption(
      "UNSUPPORTED_RENDER_OPTION",
      "BoundSvgProvider config must be an object.",
    );
  }
  for (const key of Object.keys(config)) {
    if (key === "defaultRenderOptions") {
      throw unsupportedProviderOption(
        "UNSUPPORTED_LEGACY_RENDER_OPTION",
        'BoundSvgProvider no longer accepts "defaultRenderOptions". Use "defaultCommonOptions" for compile and output-common defaults; pass artifact-specific options at each component or hook call.',
      );
    }
    if (!PROVIDER_CONFIG_KEYS.has(key)) {
      throw unsupportedProviderOption(
        "UNSUPPORTED_RENDER_OPTION",
        `BoundSvgProvider does not support config option ${JSON.stringify(key)}.`,
      );
    }
  }

  const defaultCommonOptions: unknown = Reflect.get(config, "defaultCommonOptions");
  if (defaultCommonOptions === undefined) {
    return;
  }
  if (
    typeof defaultCommonOptions !== "object" ||
    defaultCommonOptions === null ||
    Array.isArray(defaultCommonOptions)
  ) {
    throw unsupportedProviderOption(
      "UNSUPPORTED_RENDER_OPTION",
      "BoundSvgProvider defaultCommonOptions must be an object.",
    );
  }
  for (const key of Object.keys(defaultCommonOptions)) {
    if (LEGACY_RENDER_OPTION_KEYS.has(key)) {
      throw unsupportedProviderOption(
        "UNSUPPORTED_LEGACY_RENDER_OPTION",
        `BoundSvgProvider defaultCommonOptions no longer accepts ${JSON.stringify(key)}. Use the format-specific render API and options.`,
      );
    }
    if (!DEFAULT_COMMON_OPTION_KEYS.has(key)) {
      throw unsupportedProviderOption(
        "UNSUPPORTED_RENDER_OPTION",
        `BoundSvgProvider defaultCommonOptions does not support ${JSON.stringify(key)}; pass artifact-specific options at the component or hook call.`,
      );
    }
  }
}

export function BoundSvgProvider({ config, fallback, children }: BoundSvgProviderProps) {
  assertOwnProviderKeys(config);
  const { initializationConfig, stableDefaultCommonOptions } = useStableProviderConfig(config);
  const [status, setStatus] = useState<BoundSvgStatus>("idle");
  const [engine, setEngine] = useState<Engine | null>(null);
  const [workerEngine, setWorkerEngine] = useState<WorkerEngine | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [initializedConfig, setInitializedConfig] = useState<BoundSvgConfig | null>(null);

  useEffect(() => {
    let disposed = false;
    const abortController = new AbortController();
    let initializedEngine: Engine | null = null;
    let initializedWorkerEngine: WorkerEngine | null = null;
    let initializedRawWorker: Worker | null = null;

    setStatus("loading");
    setError(null);
    setEngine(null);
    setWorkerEngine(null);
    setInitializedConfig(null);

    initialize(initializationConfig, {
      signal: abortController.signal,
      setRawWorker(worker) {
        initializedRawWorker = worker;
      },
    })
      .then(({ engine: eng, workerEngine: wEng, rawWorker: rw }) => {
        if (disposed) {
          eng?.dispose();
          wEng?.dispose();
          return;
        }
        initializedEngine = eng;
        initializedWorkerEngine = wEng;
        initializedRawWorker = rw;
        setEngine(eng);
        setWorkerEngine(wEng);
        setInitializedConfig(initializationConfig);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (disposed) {
          return;
        }
        const error = err instanceof Error ? err : new Error(String(err));
        console.error("[BoundSvgProvider] Initialization failed:", error);
        setError(error);
        setInitializedConfig(initializationConfig);
        setStatus("error");
      });

    return () => {
      disposed = true;
      abortController.abort();
      if (initializedEngine) {
        initializedEngine.dispose();
      }
      if (initializedWorkerEngine) {
        initializedWorkerEngine.dispose();
      }
      if (initializedRawWorker) {
        initializedRawWorker.terminate();
      }
    };
    // Reinitialize when an Engine-creation config value changes.
  }, [initializationConfig]);

  const isCurrentConfig = initializedConfig === initializationConfig;
  const visibleStatus: BoundSvgStatus = isCurrentConfig ? status : "loading";
  const contextValue: BoundSvgContextValue = {
    engine: isCurrentConfig ? engine : null,
    workerEngine: isCurrentConfig ? workerEngine : null,
    status: visibleStatus,
    error: isCurrentConfig ? error : null,
    defaultCommonOptions: stableDefaultCommonOptions,
  };

  return (
    <BoundSvgContext.Provider value={contextValue}>
      {visibleStatus === "loading" || visibleStatus === "idle" ? (fallback ?? null) : children}
    </BoundSvgContext.Provider>
  );
}
