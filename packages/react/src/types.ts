import type { FontLoader } from "@boundsvg/browser/fonts";
import type {
  CompileOptions,
  Engine,
  GeometryDoc,
  OutputCommonOptions,
  SymbolDefinition,
} from "@boundsvg/core";
import type { WasmModule } from "@boundsvg/core/wasm";
import type { WorkerEngine } from "@boundsvg/worker";

// ---------------------------------------------------------------------------
// Interactive event types
// ---------------------------------------------------------------------------

export type {
  EventCallback,
  InteractiveHandlerProps,
  PointerEventInfo,
} from "@boundsvg/browser/events";

/** Font definition for BoundSvgProvider */
export type FontDefinition = {
  /** Font alias used in Text component's `font` prop */
  alias: string;
  /** Font weight (default: 400) */
  weight?: number;
  /** Font style (default: "normal") */
  style?: "normal" | "italic";
  /** Font source: URL string, URL object, or raw font data */
  source: string | URL | Uint8Array;
};

/** Worker initialization mode, module URL, timeout, and fallback notification for the Provider. */
export type WorkerConfig = {
  mode: "prefer" | "required";
  url?: URL;
  timeoutMs?: number;
  onFallback?: (error: Error) => void;
};

/** Defaults shared by every direct render family. Artifact-specific options stay per call. */
export type BoundSvgDefaultCommonOptions = CompileOptions & OutputCommonOptions;

/** Explicit invalidation for inputs changed in place. */
export type RenderInputOptions = {
  /** Non-negative safe integer. Change this value after mutating an input in place. */
  revision?: number;
};

/** Configuration for BoundSvgProvider */
export type BoundSvgConfig = {
  /**
   * Pre-loaded WasmModule instance.
   * When provided, skips automatic WASM loading from @boundsvg/browser.
   * Useful for testing or custom loading scenarios.
   *
   * Ignored in Worker mode (`worker` option) — the Worker loads its own WASM.
   * Only used in `worker.mode === "prefer"` if Worker initialization fails
   * and falls back to main thread.
   */
  wasm?: WasmModule;
  /** Font definitions to register */
  fonts: FontDefinition[];
  /** Custom browser font loader for URL source fetching and caching */
  fontLoader?: FontLoader;
  /** Fetch options used when the default or custom font loader resolves URL sources */
  fontFetchOptions?: RequestInit;
  /** Compile and output-common defaults applied to direct render calls. */
  defaultCommonOptions?: BoundSvgDefaultCommonOptions;
  /** Pre-registered geometry definitions for Shape components using geometryId */
  geometries?: Array<{ id: string; doc: GeometryDoc }>;
  /** Pre-registered symbol definitions for Symbol components using symbolId */
  symbols?: Array<{ id: string; def: SymbolDefinition }>;

  /** Change after mutating font, geometry, or symbol values in place. Non-negative safe integer. */
  resourcesRevision?: number;

  /**
   * Enable Worker-based off-main-thread rendering.
   *
   * - `mode: "prefer"`: falls back to main-thread Engine when Worker initialization fails
   * - `mode: "required"`: reports initialization failure without fallback
   * - `url`: creates a Worker from the given URL (e.g. `new URL("@boundsvg/worker/worker", import.meta.url)`)
   * - `undefined`: uses main-thread Engine (default)
   *
   * Once the Worker initializes, `engine` in the context is `null` and the async Worker
   * hooks in `@boundsvg/react/async` (e.g. `useRenderToSvgAsync`) support both execution modes.
   */
  worker?: WorkerConfig;
};

/** Initialization status of the BoundSvgProvider */
export type BoundSvgStatus = "idle" | "loading" | "ready" | "error";

/** Value provided by BoundSvgContext */
export type BoundSvgContextValue = {
  /** The initialized Engine instance (null while loading, and once a Worker has initialized) */
  engine: Engine | null;
  /** The initialized WorkerEngine instance (null while loading or in main-thread mode) */
  workerEngine: WorkerEngine | null;
  /** Current initialization status */
  status: BoundSvgStatus;
  /** Error that occurred during initialization (if any) */
  error: Error | null;
  /** Compile and output-common defaults from config. */
  defaultCommonOptions?: BoundSvgDefaultCommonOptions;
};
