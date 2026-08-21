import type { RenderOptions, VNode } from "@boundsvg/core";
import { useMemo } from "react";
import { resolveMainThreadEngineError } from "../utils/main-thread-only.js";
import { useBoundSvg } from "./use-boundsvg.js";
import {
  captureRenderNotifications,
  NO_RENDER_NOTIFICATION_DELIVERIES,
  type RenderNotificationDelivery,
  useCommitPhaseRenderNotifications,
} from "./use-commit-phase-render-notifications.js";
import {
  useStructurallyStableRenderOptions,
  useStructurallyStableValue,
} from "./use-structurally-stable-value.js";

export type UseRenderToSvgResult = {
  /** Rendered SVG string (null while engine is not ready or on error) */
  svg: string | null;
  /** Render error (null on success) */
  error: Error | null;
  /** Whether the engine is ready and SVG was produced */
  isReady: boolean;
};

type SvgRenderComputation = {
  result: UseRenderToSvgResult;
  deliveries: readonly RenderNotificationDelivery[];
};

/**
 * Reactively render a VNode to an SVG string.
 * Re-renders when the VNode or render-option values change.
 */
export function useRenderToSvg(vnode: VNode | null, options?: RenderOptions): UseRenderToSvgResult {
  const { engine, workerEngine, status, defaultRenderOptions } = useBoundSvg();
  const stableVNode = useStructurallyStableValue(vnode);
  const stableOptions = useStructurallyStableRenderOptions(options);
  const stableDefaultRenderOptions = useStructurallyStableRenderOptions(defaultRenderOptions);

  const computation = useMemo<SvgRenderComputation>(() => {
    if (status !== "ready" || !engine || !stableVNode) {
      const error = resolveMainThreadEngineError("useRenderToSvg", {
        status,
        engine,
        workerEngine,
      });
      return {
        result: { svg: null, error, isReady: false },
        deliveries: NO_RENDER_NOTIFICATION_DELIVERIES,
      };
    }

    const mergedOptions = { ...stableDefaultRenderOptions, ...stableOptions };
    const captured = captureRenderNotifications(mergedOptions);
    try {
      const svg = engine.renderToSvg(stableVNode, captured.options);
      return {
        result: { svg, error: null, isReady: true },
        deliveries: [captured.delivery],
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        result: { svg: null, error, isReady: false },
        deliveries: [captured.delivery],
      };
    }
  }, [engine, workerEngine, status, stableVNode, stableOptions, stableDefaultRenderOptions]);
  useCommitPhaseRenderNotifications(computation.deliveries);
  return computation.result;
}
