import type { PngResolutionAdjustedWarning, RecoverableError } from "@boundsvg/core";
import { useEffect } from "react";

type RenderCallbackOptions = {
  onWarning?: (warning: RecoverableError) => void;
  onPngResolutionAdjusted?: (warning: PngResolutionAdjustedWarning) => void;
};

export type CapturedRenderNotifications = {
  events: Array<
    | { type: "warning"; warning: RecoverableError }
    | { type: "pngResolutionAdjusted"; warning: PngResolutionAdjustedWarning }
  >;
};

export type RenderNotificationDelivery = CapturedRenderNotifications & {
  onWarning: RenderCallbackOptions["onWarning"];
  onPngResolutionAdjusted: RenderCallbackOptions["onPngResolutionAdjusted"];
  delivered: boolean;
};

type CapturedRenderOptions<O> = {
  options: O;
  notifications: CapturedRenderNotifications;
  delivery: RenderNotificationDelivery;
};

export const NO_RENDER_NOTIFICATION_DELIVERIES: readonly RenderNotificationDelivery[] = [];

export function createRenderNotificationDelivery(
  options: RenderCallbackOptions,
  notifications: CapturedRenderNotifications,
): RenderNotificationDelivery {
  return {
    ...notifications,
    onWarning: options.onWarning,
    onPngResolutionAdjusted: options.onPngResolutionAdjusted,
    delivered: false,
  };
}

/**
 * Replace consumer callbacks with render-local collectors.
 *
 * Synchronous Engine calls may run while React is rendering. The collected
 * notifications are delivered only if that generation reaches commit.
 */
export function captureRenderNotifications<O extends RenderCallbackOptions>(
  options: O,
): CapturedRenderOptions<O> {
  const notifications: CapturedRenderNotifications = {
    events: [],
  };
  const capturedOptions = { ...options };
  if (options.onWarning !== undefined) {
    capturedOptions.onWarning = (warning) =>
      notifications.events.push({ type: "warning", warning });
  }
  if (options.onPngResolutionAdjusted !== undefined) {
    capturedOptions.onPngResolutionAdjusted = (warning) =>
      notifications.events.push({ type: "pngResolutionAdjusted", warning });
  }
  return {
    options: capturedOptions,
    notifications,
    delivery: createRenderNotificationDelivery(options, notifications),
  };
}

/** Deliver a committed render generation exactly once, including StrictMode's effect replay. */
export function useCommitPhaseRenderNotifications(
  deliveries: readonly RenderNotificationDelivery[],
): void {
  useEffect(() => {
    for (const delivery of deliveries) {
      if (delivery.delivered) {
        continue;
      }
      delivery.delivered = true;
      for (const event of delivery.events) {
        if (event.type === "warning") {
          delivery.onWarning?.(event.warning);
        } else {
          delivery.onPngResolutionAdjusted?.(event.warning);
        }
      }
    }
  }, [deliveries]);
}
