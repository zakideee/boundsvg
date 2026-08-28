import type { RenderIrOptions, VNode } from "@boundsvg/core";
import { inspectScene, type SceneInspection } from "@boundsvg/core/inspect";
import { useMemo } from "react";
import { useBoundSvg } from "./hooks/use-boundsvg.js";
import {
  captureRenderNotifications,
  NO_RENDER_NOTIFICATION_DELIVERIES,
  type RenderNotificationDelivery,
  useCommitPhaseRenderNotifications,
} from "./hooks/use-commit-phase-render-notifications.js";
import {
  useStructurallyStableRenderOptions,
  useStructurallyStableValue,
} from "./hooks/use-structurally-stable-value.js";
import { pickRenderIrOptions } from "./utils/render-options.js";

export type {
  InspectionBBox,
  InspectionRect,
  InspectionStats,
  InspectionTransformBox,
  SceneInspection,
} from "@boundsvg/core/inspect";

export type UseBoundSvgInspectionResult = {
  inspection: SceneInspection | null;
  error: Error | null;
  isReady: boolean;
};

type InspectionComputation = {
  result: UseBoundSvgInspectionResult;
  deliveries: readonly RenderNotificationDelivery[];
};

/**
 * Inspect a VNode with the Provider engine and return layout, IR, maps, bboxes,
 * warnings, and node ID validation for preview tooling.
 */
export function useBoundSvgInspection(
  vnode: VNode | null,
  options?: RenderIrOptions,
): UseBoundSvgInspectionResult {
  const { engine, status, defaultCommonOptions } = useBoundSvg();
  const stableVNode = useStructurallyStableValue(vnode);
  const stableOptions = useStructurallyStableRenderOptions(options);
  const stableDefaultCommonOptions = useStructurallyStableRenderOptions(defaultCommonOptions);

  const computation = useMemo<InspectionComputation>(() => {
    if (status !== "ready" || !engine || !stableVNode) {
      return {
        result: { inspection: null, error: null, isReady: false },
        deliveries: NO_RENDER_NOTIFICATION_DELIVERIES,
      };
    }

    const mergedOptions = { ...pickRenderIrOptions(stableDefaultCommonOptions), ...stableOptions };
    const captured = captureRenderNotifications(mergedOptions);
    try {
      const inspection = inspectScene(engine, stableVNode, captured.options);
      return {
        result: { inspection, error: null, isReady: true },
        deliveries: [captured.delivery],
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        result: { inspection: null, error, isReady: false },
        deliveries: [captured.delivery],
      };
    }
  }, [engine, status, stableVNode, stableOptions, stableDefaultCommonOptions]);
  useCommitPhaseRenderNotifications(computation.deliveries);
  return computation.result;
}
