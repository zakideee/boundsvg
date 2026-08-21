/**
 * Rehydrate a `StructuredError` JSON into a `FatalError` or `RecoverableError` instance.
 *
 * The Worker serializes all errors to `StructuredError` (JSON-safe) before
 * sending them back via `postMessage`. This module converts them back into
 * proper Error subclass instances so that main-thread callers get the same
 * error types they would from a direct `Engine` call.
 */

import { FatalError, RecoverableError, type StructuredError } from "@boundsvg/core";

type StructuredErrorContext = NonNullable<StructuredError["context"]>;
type RehydratedErrorContext = StructuredErrorContext & {
  stage?: StructuredError["stage"];
  nodeId?: string;
};

/**
 * Build the `context` bag expected by `FatalError` / `RecoverableError`
 * constructors, which extract `stage` and `nodeId` from `context`.
 */
function buildContext(error: StructuredError): RehydratedErrorContext | undefined {
  const ctx: RehydratedErrorContext = {};
  let hasKey = false;

  if (error.stage !== undefined) {
    ctx.stage = error.stage;
    hasKey = true;
  }
  if (error.nodeId !== undefined) {
    ctx.nodeId = error.nodeId;
    hasKey = true;
  }
  if (error.context !== undefined) {
    // Merge original context, preserving stage/nodeId set above
    Object.assign(ctx, error.context, {
      ...(error.stage !== undefined && { stage: error.stage }),
      ...(error.nodeId !== undefined && { nodeId: error.nodeId }),
    });
    hasKey = true;
  }

  return hasKey ? ctx : undefined;
}

/**
 * Convert a `StructuredError` JSON back into a `FatalError` or `RecoverableError`.
 */
export function rehydrateError(error: StructuredError): FatalError | RecoverableError {
  const ctx = buildContext(error);

  if (error.severity === "recoverable") {
    return new RecoverableError(error.code, error.message, {
      fallback: error.fallback ?? "",
      context: ctx,
    });
  }
  return new FatalError(error.code, error.message, ctx);
}
