import { FatalError } from "@boundsvg/core";

/** Default transport deadline, including time spent in the queue. */
const DEFAULT_TIMEOUT_MS = 30_000;
/** Timers use a signed 32-bit millisecond delay. */
const TIMEOUT_MAX_MS = 2_147_483_647;

/** Validate deadlines before any Worker is created. */
export function resolveWorkerTimeout(timeout: number | undefined): number {
  if (timeout === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > TIMEOUT_MAX_MS) {
    throw new FatalError(
      "WORKER_INVALID_TIMEOUT",
      "Worker timeout must be an integer from 1 to 2147483647 milliseconds",
      { stage: "validate", context: { field: "timeout" } },
    );
  }
  return timeout;
}
