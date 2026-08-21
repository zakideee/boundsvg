import { pngToDataUrl } from "@boundsvg/browser/png";
import type { Engine, RenderOptions, VNode } from "@boundsvg/core";
import { useMemo } from "react";
import { resolveMainThreadEngineError } from "../utils/main-thread-only.js";
import { useBoundSvg } from "./use-boundsvg.js";
import {
  type CapturedRenderNotifications,
  captureRenderNotifications,
  createRenderNotificationDelivery,
  NO_RENDER_NOTIFICATION_DELIVERIES,
  type RenderNotificationDelivery,
  useCommitPhaseRenderNotifications,
} from "./use-commit-phase-render-notifications.js";
import {
  useStructurallyStableRenderOptions,
  useStructurallyStableValue,
} from "./use-structurally-stable-value.js";

export type UseRenderToPngResult = {
  /** Rendered PNG as Uint8Array (null while not ready or on error) */
  png: Uint8Array | null;
  /** PNG as data URL for use in <img src> (null while not ready or on error) */
  dataUrl: string | null;
  /** Render error (null on success) */
  error: Error | null;
  /** Whether the engine is ready and PNG was produced */
  isReady: boolean;
};

type CachedPngResult = {
  png: Uint8Array;
  dataUrl: string;
  notifications: CapturedRenderNotifications;
};

type PngRenderComputation = {
  result: UseRenderToPngResult;
  deliveries: readonly RenderNotificationDelivery[];
};

type CacheByOptions = WeakMap<RenderOptions, CachedPngResult>;
type CacheByDefaultOptions = WeakMap<RenderOptions, CacheByOptions>;
type CacheByVNode = WeakMap<VNode, CacheByDefaultOptions>;

const EMPTY_RENDER_OPTIONS: RenderOptions = {};
const pngRenderCache = new WeakMap<Engine, CacheByVNode>();

function getCachedPngResult(
  engine: Engine,
  vnode: VNode,
  {
    defaultOptionsKey,
    optionsKey,
  }: { defaultOptionsKey: RenderOptions; optionsKey: RenderOptions },
): CachedPngResult | null {
  const byVNode = pngRenderCache.get(engine);
  if (!byVNode) {
    return null;
  }
  const byDefaultOptions = byVNode.get(vnode);
  if (!byDefaultOptions) {
    return null;
  }
  const byOptions = byDefaultOptions.get(defaultOptionsKey);
  if (!byOptions) {
    return null;
  }
  return byOptions.get(optionsKey) ?? null;
}

function cachePngResult(
  engine: Engine,
  vnode: VNode,
  {
    defaultOptionsKey,
    optionsKey,
    result,
  }: { defaultOptionsKey: RenderOptions; optionsKey: RenderOptions; result: CachedPngResult },
): void {
  let byVNode = pngRenderCache.get(engine);
  if (!byVNode) {
    byVNode = new WeakMap<VNode, CacheByDefaultOptions>();
    pngRenderCache.set(engine, byVNode);
  }

  let byDefaultOptions = byVNode.get(vnode);
  if (!byDefaultOptions) {
    byDefaultOptions = new WeakMap<RenderOptions, CacheByOptions>();
    byVNode.set(vnode, byDefaultOptions);
  }

  let byOptions = byDefaultOptions.get(defaultOptionsKey);
  if (!byOptions) {
    byOptions = new WeakMap<RenderOptions, CachedPngResult>();
    byDefaultOptions.set(defaultOptionsKey, byOptions);
  }

  byOptions.set(optionsKey, result);
}

/**
 * Reactively render a VNode to PNG.
 * Re-renders when the VNode or render-option values change.
 */
export function useRenderToPng(vnode: VNode | null, options?: RenderOptions): UseRenderToPngResult {
  const { engine, workerEngine, status, defaultRenderOptions } = useBoundSvg();
  const stableVNode = useStructurallyStableValue(vnode);
  const stableOptions = useStructurallyStableRenderOptions(options);
  const stableDefaultRenderOptions = useStructurallyStableRenderOptions(defaultRenderOptions);

  const computation = useMemo<PngRenderComputation>(() => {
    if (status !== "ready" || !engine || !stableVNode) {
      const error = resolveMainThreadEngineError("useRenderToPng", {
        status,
        engine,
        workerEngine,
      });
      return {
        result: { png: null, dataUrl: null, error, isReady: false },
        deliveries: NO_RENDER_NOTIFICATION_DELIVERIES,
      };
    }

    const defaultOptionsKey = stableDefaultRenderOptions ?? EMPTY_RENDER_OPTIONS;
    const optionsKey = stableOptions ?? EMPTY_RENDER_OPTIONS;
    const mergedOptions = { ...stableDefaultRenderOptions, ...stableOptions };
    const cached = getCachedPngResult(engine, stableVNode, { defaultOptionsKey, optionsKey });
    if (cached) {
      return {
        result: { png: cached.png, dataUrl: cached.dataUrl, error: null, isReady: true },
        deliveries: [createRenderNotificationDelivery(mergedOptions, cached.notifications)],
      };
    }

    const captured = captureRenderNotifications(mergedOptions);
    try {
      const png = engine.renderToPng(stableVNode, captured.options);
      const dataUrl = pngToDataUrl(png);
      const result = { png, dataUrl, notifications: captured.notifications };
      cachePngResult(engine, stableVNode, { defaultOptionsKey, optionsKey, result });
      return {
        result: { png, dataUrl, error: null, isReady: true },
        deliveries: [captured.delivery],
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        result: { png: null, dataUrl: null, error, isReady: false },
        deliveries: [captured.delivery],
      };
    }
  }, [engine, workerEngine, status, stableVNode, stableOptions, stableDefaultRenderOptions]);
  useCommitPhaseRenderNotifications(computation.deliveries);
  return computation.result;
}
