import { FatalError } from "@boundsvg/core";

/**
 * Stop an export the caller has abandoned.
 *
 * @throws FatalError `VIDEO_EXPORT_ABORTED` when the signal is already aborted.
 */
export function throwIfExportAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new FatalError("VIDEO_EXPORT_ABORTED", "video export was aborted", {
      context: {
        // Described rather than carried: structured errors must survive JSON, and
        // an abort reason is usually a DOMException, which stringifies to {}.
        reason: describeAbortReason(signal.reason),
      },
    });
  }
}

function describeAbortReason(reason: unknown): string {
  if (reason === undefined) {
    return "aborted";
  }
  return reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
}
