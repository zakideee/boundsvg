import type { RenderAnimatedSvgOptions, VNode } from "@boundsvg/core";
import { useMemo } from "react";
import { resolveMainThreadEngineError } from "../utils/main-thread-only.js";
import { useBoundSvg } from "./use-boundsvg.js";
import {
  captureRenderNotifications,
  NO_RENDER_NOTIFICATION_DELIVERIES,
  type RenderNotificationDelivery,
  useCommitPhaseRenderNotifications,
} from "./use-commit-phase-render-notifications.js";
import type { UseRenderToSvgResult } from "./use-render-svg.js";
import {
  useStructurallyStableRenderOptions,
  useStructurallyStableValue,
} from "./use-structurally-stable-value.js";

type AnimatedSvgRenderComputation = {
  result: UseRenderToSvgResult;
  deliveries: readonly RenderNotificationDelivery[];
};

/** Reactively render authored animation tracks to declarative SVG. */
export function useRenderToAnimatedSvg(
  vnode: VNode | null,
  options: RenderAnimatedSvgOptions,
): UseRenderToSvgResult {
  const { engine, workerEngine, status, defaultCommonOptions } = useBoundSvg();
  const stableVNode = useStructurallyStableValue(vnode);
  const stableOptions = useStructurallyStableRenderOptions(options);
  const stableDefaultCommonOptions = useStructurallyStableRenderOptions(defaultCommonOptions);

  const computation = useMemo<AnimatedSvgRenderComputation>(() => {
    if (status !== "ready" || !engine || !stableVNode) {
      const error = resolveMainThreadEngineError("useRenderToAnimatedSvg", {
        status,
        engine,
        workerEngine,
      });
      return {
        result: { svg: null, error, isReady: false },
        deliveries: NO_RENDER_NOTIFICATION_DELIVERIES,
      };
    }

    const mergedOptions = {
      ...stableDefaultCommonOptions,
      ...stableOptions,
    } as RenderAnimatedSvgOptions;
    const captured = captureRenderNotifications(mergedOptions);
    try {
      const svg = engine.renderToAnimatedSvg(stableVNode, captured.options);
      return {
        result: { svg, error: null, isReady: true },
        deliveries: [captured.delivery],
      };
    } catch (error: unknown) {
      return {
        result: {
          svg: null,
          error: error instanceof Error ? error : new Error(String(error)),
          isReady: false,
        },
        deliveries: [captured.delivery],
      };
    }
  }, [engine, workerEngine, status, stableVNode, stableOptions, stableDefaultCommonOptions]);
  useCommitPhaseRenderNotifications(computation.deliveries);
  return computation.result;
}
