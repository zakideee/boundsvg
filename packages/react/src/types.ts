import type { FontLoader } from "@boundsvg/browser/fonts";
import type { Engine, GeometryDoc, RenderOptions, SymbolDefinition } from "@boundsvg/core";
import type { WasmModule } from "@boundsvg/core/wasm";
import type { WorkerEngine } from "@boundsvg/worker";

// ---------------------------------------------------------------------------
// Interactive event types
// ---------------------------------------------------------------------------

/** Information passed to event handler callbacks */
export type PointerEventInfo = {
  /** The handler name string (auto-generated ID or user-specified string) */
  handlerName: string;
  /** The nodeId of the IR node that was hit */
  nodeId: string;
  /** SVG-space X coordinate */
  svgX: number;
  /** SVG-space Y coordinate */
  svgY: number;
  /**
   * Original DOM event.
   *
   * Touch-originated events (onTouchStart/End/Move) receive a PointerEvent
   * with `pointerType === "touch"`, NOT a native TouchEvent. This is by design:
   * native TouchEvent is unreliable on real mobile browsers for SVG elements
   * (touchend/touchmove may be silently suppressed). The Pointer Events API
   * unifies mouse/touch/pen and works reliably across all modern browsers.
   *
   * TouchEvent is retained in the union for API compatibility but will not
   * be passed in practice.
   */
  nativeEvent: PointerEvent | MouseEvent | TouchEvent;
};

/** Callback function for interactive events */
export type EventCallback = (info: PointerEventInfo) => void;

/** Event handler props that accept both string references and callback functions */
export type InteractiveHandlerProps = {
  onClick?: EventCallback | string;
  onDoubleClick?: EventCallback | string;
  onContextMenu?: EventCallback | string;
  onPointerDown?: EventCallback | string;
  onPointerUp?: EventCallback | string;
  onPointerCancel?: EventCallback | string;
  onPointerMove?: EventCallback | string;
  onPointerEnter?: EventCallback | string;
  onPointerLeave?: EventCallback | string;
  onPointerOver?: EventCallback | string;
  onPointerOut?: EventCallback | string;
  onMouseDown?: EventCallback | string;
  onMouseUp?: EventCallback | string;
  onMouseMove?: EventCallback | string;
  onMouseEnter?: EventCallback | string;
  onMouseLeave?: EventCallback | string;
  onMouseOver?: EventCallback | string;
  onMouseOut?: EventCallback | string;
  onTouchStart?: EventCallback | string;
  onTouchEnd?: EventCallback | string;
  onTouchMove?: EventCallback | string;
};

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

export type WorkerConfig = {
  mode: "prefer" | "required";
  url?: URL;
  timeoutMs?: number;
  onFallback?: (error: Error) => void;
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
  /** Default RenderOptions applied to all render calls */
  defaultRenderOptions?: RenderOptions;
  /** Pre-registered geometry definitions for Shape components using geometryId */
  geometries?: Array<{ id: string; doc: GeometryDoc }>;
  /** Pre-registered symbol definitions for Symbol components using symbolId */
  symbols?: Array<{ id: string; def: SymbolDefinition }>;

  /**
   * Enable Worker-based off-main-thread rendering.
   *
   * - `mode: "prefer"`: falls back to main-thread Engine when Worker initialization fails
   * - `mode: "required"`: reports initialization failure without fallback
   * - `url`: creates a Worker from the given URL (e.g. `new URL("@boundsvg/worker/worker", import.meta.url)`)
   * - `undefined`: uses main-thread Engine (default)
   *
   * Once the Worker initializes, `engine` in the context is `null` and the async Worker
   * hooks in `@boundsvg/react/worker` (e.g. `useRenderToSvgAsync`) must be used.
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
  /** Default render options from config */
  defaultRenderOptions?: RenderOptions;
};
