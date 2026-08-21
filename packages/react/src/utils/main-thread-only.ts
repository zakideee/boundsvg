import { FatalError } from "@boundsvg/core";
import type { BoundSvgStatus } from "../types.js";

/**
 * Explain why a main-thread-only hook cannot run.
 *
 * Once the Worker initializes the provider sets `engine` to `null` while `status` stays
 * `"ready"`, so these hooks used to return `isReady: false` with `error: null`
 * — the component rendered nothing and reported no problem at all. The caller
 * now gets an error naming the async Worker hook to use instead.
 */
export function resolveMainThreadEngineError(
  hookName: string,
  context: { status: BoundSvgStatus; engine: unknown; workerEngine: unknown },
): Error | null {
  if (context.status !== "ready" || context.engine || !context.workerEngine) {
    return null;
  }
  return new FatalError(
    "MAIN_THREAD_ENGINE_REQUIRED",
    `${hookName} requires the main-thread Engine, which is not available in Worker mode. Use the async Worker hooks (useRenderToSvgAsync / useRenderToPngAsync), or disable Worker mode.`,
    { stage: "engine" },
  );
}
