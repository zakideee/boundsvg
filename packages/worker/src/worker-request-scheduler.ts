import { FatalError } from "@boundsvg/core";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";
import {
  invalidWorkerResponseError,
  workerEngineDisposedError,
  workerLifecycleError,
  workerTimeoutError,
  workerTransportError,
} from "./worker-errors.js";

/** Maximum accepted requests waiting for the physical Worker slot. */
const QUEUE_LIMIT = 32;

type Completion = {
  resolve: (response: WorkerResponse) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  deadline: number;
  signal?: AbortSignal;
  handleAbort?: () => void;
};

type ScheduledRequest = {
  id: number;
  type: WorkerRequest["type"];
  request: WorkerRequest | undefined;
  completion: Completion | undefined;
};

type StreamControl = {
  streamId: number;
  entry: ScheduledRequest;
  promise: Promise<WorkerResponse>;
};

type IdleWait = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

type SchedulerTransport = {
  post: (request: WorkerRequest) => void;
  nextRequestId: () => number;
  handleFailure: () => void;
};

/** Own one physical RPC slot, bounded admission, and one reserved stream-close request. */
export class WorkerRequestScheduler {
  private readonly queue: ScheduledRequest[] = [];
  private inFlight: ScheduledRequest | undefined;
  private control: StreamControl | undefined;
  private streamId: number | undefined;
  private streamFailure: unknown;
  private idleWait: IdleWait | undefined;
  private drainPromise: Promise<void> | undefined;
  private isDraining = false;
  private isDisposed = false;

  constructor(
    private readonly timeoutMs: number,
    private readonly transport: SchedulerTransport,
  ) {}

  /** Reject terminal admission before snapshotting a caller's input. */
  assertAccepting(): void {
    if (this.isDisposed) {
      throw workerEngineDisposedError();
    }
    if (this.isDraining) {
      throw workerLifecycleError("WORKER_ENGINE_DRAINING", "WorkerEngine is draining");
    }
  }

  /** Admit an ordinary request without replacing any other consumer's work. */
  send(request: WorkerRequest, signal?: AbortSignal): Promise<WorkerResponse> {
    try {
      this.assertAccepting();
      if (signal?.aborted) {
        throw abortedRequestError(request);
      }
      if (this.queue.length >= QUEUE_LIMIT) {
        throw workerLifecycleError("WORKER_QUEUE_FULL", "Worker request queue is full", {
          queueLimit: QUEUE_LIMIT,
        });
      }
      const snapshot = snapshotRequest(request);
      const { entry, promise } = this.createEntry(snapshot, signal);
      this.queue.push(entry);
      this.pump();
      return promise;
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }

  /** Close a potentially opened stream after its in-flight operation physically finishes. */
  closeStream(streamId: number): Promise<WorkerResponse> {
    if (this.isDisposed) {
      return Promise.reject(workerEngineDisposedError());
    }
    if (this.control?.streamId === streamId) {
      return this.control.promise;
    }
    if (this.streamFailure !== undefined) {
      return Promise.reject(this.streamFailure);
    }
    if (this.streamId !== streamId) {
      return Promise.resolve({ id: streamId, type: "close-frame-stream-ok", streamId });
    }
    if (this.control) {
      return Promise.reject(
        workerLifecycleError("WORKER_POOL_BUSY", "WorkerPool already has an active operation", {
          operationLimit: 1,
        }),
      );
    }
    try {
      const request: WorkerRequest = {
        id: this.transport.nextRequestId(),
        type: "close-frame-stream",
        streamId,
      };
      const { entry, promise } = this.createEntry(request);
      this.control = { streamId, entry, promise };
      this.pump();
      return promise;
    } catch (error: unknown) {
      this.streamFailure = error;
      return Promise.reject(error);
    }
  }

  /** Consume only the response correlated to the occupied physical slot. */
  receive(id: number, response: WorkerResponse | undefined): boolean {
    const entry = this.inFlight;
    if (!entry || entry.id !== id) {
      return false;
    }
    if (entry.completion && performance.now() >= entry.completion.deadline) {
      this.expire(entry);
    }
    if (entry.type === "close-frame-stream") {
      if (response?.type === "close-frame-stream-ok" && response.streamId === this.streamId) {
        this.streamId = undefined;
      } else {
        this.streamFailure =
          response?.type === "error"
            ? FatalError.fromSerialized(response.error)
            : invalidWorkerResponseError(id);
      }
      this.control = undefined;
    }
    if (response) {
      this.settle(entry, { response });
    } else {
      this.settle(entry, { error: invalidWorkerResponseError(id) });
    }
    this.inFlight = undefined;
    this.pump();
    return true;
  }

  /** Wait for accepted work and stream-close acknowledgement without closing admission. */
  finish(): Promise<void> {
    if (this.idleWait) {
      return this.idleWait.promise;
    }
    if (this.isDisposed) {
      return Promise.reject(workerEngineDisposedError());
    }
    if (this.streamFailure !== undefined) {
      return Promise.reject(this.streamFailure);
    }
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const timer = setTimeout(() => {
      this.rejectIdleWait(
        workerLifecycleError("WORKER_DRAIN_TIMEOUT", "Worker drain timed out", {
          timeoutMs: this.timeoutMs,
        }),
      );
    }, this.timeoutMs);
    this.idleWait = { promise, resolve, reject, timer };
    this.pump();
    return promise;
  }

  /** Close admission permanently; repeat callers share the original deadline and Promise. */
  drain(): Promise<void> {
    if (!this.drainPromise) {
      this.isDraining = true;
      this.drainPromise = this.finish();
    }
    return this.drainPromise;
  }

  /** Terminate all local requests and release timers, signal listeners, and payloads. */
  dispose(error: unknown | ((id: number) => unknown) = workerEngineDisposedError()): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    const entries = new Set([
      ...this.queue,
      ...(this.inFlight ? [this.inFlight] : []),
      ...(this.control ? [this.control.entry] : []),
    ]);
    this.queue.length = 0;
    this.inFlight = undefined;
    this.control = undefined;
    this.streamId = undefined;
    this.streamFailure = undefined;
    for (const entry of entries) {
      this.settle(entry, { error: typeof error === "function" ? error(entry.id) : error });
      entry.request = undefined;
    }
    this.rejectIdleWait(typeof error === "function" ? workerEngineDisposedError() : error);
  }

  private createEntry(request: WorkerRequest, signal?: AbortSignal) {
    const entry: ScheduledRequest = {
      id: request.id,
      type: request.type,
      request,
      completion: undefined,
    };
    const promise = new Promise<WorkerResponse>((resolve, reject) => {
      const deadline = performance.now() + this.timeoutMs;
      const timer = setTimeout(() => this.expire(entry), this.timeoutMs);
      const handleAbort = signal ? () => this.cancel(entry, abortedRequestError(entry)) : undefined;
      entry.completion = { resolve, reject, timer, deadline, signal, handleAbort };
      if (signal && handleAbort) {
        signal.addEventListener("abort", handleAbort, { once: true });
      }
    });
    return { entry, promise };
  }

  private settle(
    entry: ScheduledRequest,
    outcome: { response: WorkerResponse } | { error: unknown },
  ): void {
    const completion = entry.completion;
    if (!completion) {
      return;
    }
    entry.completion = undefined;
    clearTimeout(completion.timer);
    if (completion.signal && completion.handleAbort) {
      completion.signal.removeEventListener("abort", completion.handleAbort);
    }
    if ("response" in outcome) {
      completion.resolve(outcome.response);
    } else {
      completion.reject(outcome.error);
    }
  }

  private expire(entry: ScheduledRequest): void {
    this.cancel(entry, workerTimeoutError(entry, this.timeoutMs));
  }

  private cancel(entry: ScheduledRequest, error: unknown): void {
    this.settle(entry, { error });
    entry.request = undefined;
    const queueIndex = this.queue.indexOf(entry);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }
    if (entry === this.control?.entry) {
      this.streamFailure = error;
      if (this.inFlight !== entry) {
        this.control = undefined;
      }
      this.rejectIdleWait(error);
    }
    if (this.inFlight === entry && isStreamOpen(entry.type)) {
      void this.closeStream(entry.id).catch(() => undefined);
    }
    this.pump();
  }

  private pump(): void {
    if (this.isDisposed || this.inFlight) {
      return;
    }
    const entry = this.control?.entry ?? this.queue.shift();
    if (entry) {
      const request = entry.request;
      if (!request || !entry.completion) {
        this.pump();
        return;
      }
      if (performance.now() >= entry.completion.deadline) {
        this.expire(entry);
        return;
      }
      this.inFlight = entry;
      entry.request = undefined;
      if (isStreamOpen(request.type)) {
        this.streamId = request.id;
      }
      try {
        this.transport.post(request);
      } catch (error: unknown) {
        this.dispose(workerTransportError(request, error));
        this.transport.handleFailure();
      }
      return;
    }
    if (!this.idleWait) {
      return;
    }
    if (this.streamFailure !== undefined) {
      this.rejectIdleWait(this.streamFailure);
    } else if (this.streamId !== undefined) {
      void this.closeStream(this.streamId).catch((error: unknown) => this.rejectIdleWait(error));
    } else {
      const waiter = this.idleWait;
      this.idleWait = undefined;
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private rejectIdleWait(error: unknown): void {
    const waiter = this.idleWait;
    if (waiter) {
      this.idleWait = undefined;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

function isStreamOpen(type: WorkerRequest["type"]): boolean {
  return type === "open-frame-stream" || type === "open-layout-transition-frame-stream";
}

function abortedRequestError(request: Pick<WorkerRequest, "id" | "type">): FatalError {
  return workerLifecycleError("WORKER_REQUEST_ABORTED", "Worker request was aborted", {
    requestId: request.id,
    requestType: request.type,
  });
}

function snapshotRequest(request: WorkerRequest): WorkerRequest {
  try {
    // Scene and transition inputs have already crossed their detached decoders.
    // Preserve init's zero-copy buffers until postMessage actually transfers them.
    return {
      ...request,
      ...("options" in request ? { options: structuredClone(request.options) } : {}),
      ...("input" in request ? { input: structuredClone(request.input) } : {}),
      ...("schedule" in request ? { schedule: structuredClone(request.schedule) } : {}),
    } as WorkerRequest;
  } catch (error: unknown) {
    throw workerTransportError(request, error);
  }
}
