import { pngToDataUrl } from "@boundsvg/browser/png";
import type { RenderPngOptions, VNode } from "@boundsvg/core";
import { useMemo } from "react";
import type { RenderInputOptions } from "../types.js";
import { resolveMainThreadEngineError } from "../utils/main-thread-only.js";
import { useBoundSvg } from "./use-boundsvg.js";
import {
  captureRenderNotifications,
  NO_RENDER_NOTIFICATION_DELIVERIES,
  type RenderNotificationDelivery,
  useCommitPhaseRenderNotifications,
} from "./use-commit-phase-render-notifications.js";
import { useRenderInput } from "./use-render-input.js";
import { useStructurallyStableRenderOptions } from "./use-structurally-stable-value.js";

/** Synchronous PNG bytes and data URL with readiness or failure state. */
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

type PngRenderComputation = {
  result: UseRenderToPngResult;
  deliveries: readonly RenderNotificationDelivery[];
};

/**
 * Reactively render a VNode to PNG.
 * Re-renders when the VNode or render-option values change.
 */
export function useRenderToPng(
  vnode: VNode | null,
  options?: RenderPngOptions,
  inputOptions?: RenderInputOptions,
): UseRenderToPngResult {
  const { engine, workerEngine, status, defaultCommonOptions } = useBoundSvg();
  const renderInput = useRenderInput(vnode, engine, inputOptions);
  const stableOptions = useStructurallyStableRenderOptions(options);
  const stableDefaultCommonOptions = useStructurallyStableRenderOptions(defaultCommonOptions);

  const computation = useMemo<PngRenderComputation>(() => {
    if (status !== "ready" || !engine || !renderInput.vnode) {
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

    const mergedOptions = { ...stableDefaultCommonOptions, ...stableOptions };
    const captured = captureRenderNotifications(mergedOptions);
    try {
      const png = engine.renderToPng(renderInput.vnode, captured.options);
      const dataUrl = pngToDataUrl(png);
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
  }, [engine, workerEngine, status, renderInput, stableOptions, stableDefaultCommonOptions]);
  useCommitPhaseRenderNotifications(computation.deliveries);
  return { ...computation.result, png: computation.result.png?.slice() ?? null };
}
