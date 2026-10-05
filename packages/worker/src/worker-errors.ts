import { type DiagnosticContext, FatalError } from "@boundsvg/core";
import { formatUnknownWorkerFailure } from "./diagnostic-format.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";

/** Construct an engine-stage lifecycle failure with the originating transport context. */
export function workerLifecycleError(
  code: string,
  message: string,
  context: DiagnosticContext = {},
): FatalError {
  return new FatalError(code, message, {
    stage: "engine",
    context: {
      ...context,
    },
  });
}

/** Report that a disposed WorkerEngine cannot accept another operation. */
export function workerEngineDisposedError(): FatalError {
  return workerLifecycleError("WORKER_ENGINE_DISPOSED", "WorkerEngine has been disposed");
}

/** Identify a reply that violates the protocol for its outstanding request. */
export function invalidWorkerResponseError(requestId: number): FatalError {
  return workerLifecycleError(
    "WORKER_PROTOCOL_INVALID_RESPONSE",
    `Worker returned an invalid response for request ${requestId}`,
    { requestId },
  );
}

/** Report a valid reply type that does not match the outstanding operation. */
export function unexpectedWorkerResponseError(
  responseType: WorkerResponse["type"],
  expectedResponseType: WorkerResponse["type"],
  messageContext = "",
): FatalError {
  return workerLifecycleError(
    "WORKER_PROTOCOL_UNEXPECTED_RESPONSE",
    `Unexpected response type${messageContext}: ${responseType}`,
    { responseType, expectedResponseType },
  );
}

/** Include the request identity and elapsed limit when a response deadline expires. */
export function workerTimeoutError(
  request: Pick<WorkerRequest, "id" | "type">,
  timeoutMs: number,
): FatalError {
  return workerLifecycleError(
    "WORKER_REQUEST_TIMEOUT",
    `Worker request timed out after ${timeoutMs}ms (id=${request.id})`,
    { requestId: request.id, requestType: request.type, timeoutMs },
  );
}

/** Report a posting failure with safe cause text and the originating request identity. */
export function workerTransportError(request: WorkerRequest, error: unknown): FatalError {
  const causeMessage = describeWorkerFailure(error);
  return workerLifecycleError(
    "WORKER_TRANSPORT_FAILED",
    `Worker request could not be posted: ${causeMessage}`,
    { requestId: request.id, requestType: request.type, causeMessage },
  );
}

/** Format an unknown transport failure without invoking unchecked accessors or coercion. */
export function describeWorkerFailure(error: unknown): string {
  return formatUnknownWorkerFailure(error, "Unknown Worker transport failure");
}
