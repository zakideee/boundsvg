import { type DiagnosticContext, FatalError } from "@boundsvg/core";
import { formatUnknownWorkerFailure } from "./diagnostic-format.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";

/** Construct or format a Worker transport diagnostic without changing its public envelope. */
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

/** Construct or format a Worker transport diagnostic without changing its public envelope. */
export function workerEngineDisposedError(): FatalError {
  return workerLifecycleError("WORKER_ENGINE_DISPOSED", "WorkerEngine has been disposed");
}

/** Construct or format a Worker transport diagnostic without changing its public envelope. */
export function invalidWorkerResponseError(requestId: number): FatalError {
  return workerLifecycleError(
    "WORKER_PROTOCOL_INVALID_RESPONSE",
    `Worker returned an invalid response for request ${requestId}`,
    { requestId },
  );
}

/** Construct or format a Worker transport diagnostic without changing its public envelope. */
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

/** Construct or format a Worker transport diagnostic without changing its public envelope. */
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

/** Construct or format a Worker transport diagnostic without changing its public envelope. */
export function workerTransportError(request: WorkerRequest, error: unknown): FatalError {
  const causeMessage = describeWorkerFailure(error);
  return workerLifecycleError(
    "WORKER_TRANSPORT_FAILED",
    `Worker request could not be posted: ${causeMessage}`,
    { requestId: request.id, requestType: request.type, causeMessage },
  );
}

/** Construct or format a Worker transport diagnostic without changing its public envelope. */
export function describeWorkerFailure(error: unknown): string {
  return formatUnknownWorkerFailure(error, "Unknown Worker transport failure");
}
