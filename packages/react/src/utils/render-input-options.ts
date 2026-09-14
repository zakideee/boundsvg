import { FatalError } from "@boundsvg/core";
import type { RenderExecutionOptions } from "../execution/types.js";

/** Validate React-only controls before scheduling any work. */
export function validateRenderExecutionOptions(options: RenderExecutionOptions | undefined): void {
  if (options === undefined) {
    return;
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw invalidRenderExecutionOption("executionOptions");
  }
  resolveRenderRevision(options.revision);
  if (
    options.retainPreviousResult !== undefined &&
    typeof options.retainPreviousResult !== "boolean"
  ) {
    throw invalidRenderExecutionOption("retainPreviousResult");
  }
  if (options.onError !== undefined && typeof options.onError !== "function") {
    throw invalidRenderExecutionOption("onError");
  }
}

function invalidRenderExecutionOption(field: string): FatalError {
  return new FatalError("INVALID_RENDER_EXECUTION_OPTION", "Invalid render execution option", {
    stage: "validate",
    context: { field },
  });
}

/** Validate an explicit revision without coercing null or out-of-domain values. */
export function resolveRenderRevision(revision: number | undefined, field = "revision"): number {
  if (revision === undefined) {
    return 0;
  }
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw invalidRenderExecutionOption(field);
  }
  return revision;
}
