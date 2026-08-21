import {
  assertSerializableSceneTransport,
  FatalError,
  type Frame,
  type GeometryDoc,
  isSceneNode,
  type RenderFramesOptions,
  type RenderOptions,
  type SceneNode,
  type StructuredError,
  type SymbolDefinition,
} from "@boundsvg/core";
import {
  snapshotWorkerLayoutTransitionInput,
  type WorkerLayoutTransitionInput,
} from "./layout-transition-transport.js";
import type {
  FontTransfer,
  IndexedFrameTime,
  WorkerFrameRenderOptions,
  WorkerRenderOptions,
} from "./protocol.js";
import {
  forwardWorkerWarnings,
  getWorkerPoolEndpoint,
  WorkerEngine,
  type WorkerLike,
  type WorkerPoolEndpoint,
} from "./worker-engine.js";

/**
 * Measured conservative default: every Worker duplicates WASM, registered
 * assets, prepared IR, and raster working memory. See the worker-pool memory
 * benchmark before increasing concurrency for an application's asset set.
 */
export const DEFAULT_WORKER_POOL_CONCURRENCY = 2;

/** Explicit safety ceiling for accidental Worker/WASM memory multiplication. */
export const MAX_WORKER_POOL_CONCURRENCY = 8;

export type WorkerPoolWorkerFactory = () => WorkerLike;

export type WorkerPoolOptions = {
  /** Worker module URL, or a factory whose returned Workers are owned by the pool. */
  worker: URL | WorkerPoolWorkerFactory;
  /** Independent Worker/WASM instances. Default: 2. Maximum: 8. */
  concurrency?: number;
  /** Fonts copied into an immutable pool snapshot, then transferred once per Worker. */
  fonts: FontTransfer[];
  /** Geometry definitions copied into the immutable pool asset snapshot. */
  geometries?: Array<{ id: string; doc: GeometryDoc }>;
  /** Symbol definitions copied into the immutable pool asset snapshot. */
  symbols?: Array<{ id: string; def: SymbolDefinition }>;
  /** Timeout in ms for initialization and individual Worker protocol calls. */
  timeout?: number;
};

export type WorkerPoolRenderFramesOptions = Omit<RenderFramesOptions, "timesMs"> & {
  /** Non-negative finite sample times. Duplicates and non-monotonic order are preserved. */
  timesMs: readonly number[];
  /** Stops new work and closes every prepared Worker stream owned by this call. */
  signal?: AbortSignal;
};

/** One fully materialized, independently renderable scene at an exact time. */
export type MaterializedFrameInput = {
  timeMs: number;
  /** Strict JSON-lossless SceneNode; explicit `undefined` properties are rejected. */
  scene: SceneNode;
};

/** Lazily consumed materialized-scene input, bounded by pool concurrency. */
export type MaterializedFrameSource =
  | Iterable<MaterializedFrameInput>
  | AsyncIterable<MaterializedFrameInput>;

export type WorkerPoolMaterializedFramesOptions = Omit<RenderOptions, "animation" | "timeMs"> & {
  /** Payload format for every returned frame. */
  format: "svg" | "png";
  /** Stops source consumption, starts no new jobs, and closes the source iterator. */
  signal?: AbortSignal;
};

type AssetSnapshot = {
  fonts: FontTransfer[];
  geometries?: Array<{ id: string; doc: GeometryDoc }>;
  symbols?: Array<{ id: string; def: SymbolDefinition }>;
};

type AssignedWorker = {
  slot: number;
  endpoint: WorkerPoolEndpoint;
  schedule: IndexedFrameTime[];
};

type OpenedWorkerStream = AssignedWorker & {
  streamId: number;
  warnings: StructuredError[];
  received: number;
};

type FrameCompletion =
  | { kind: "frame"; stream: OpenedWorkerStream; frame: Frame | undefined }
  | { kind: "error"; stream: OpenedWorkerStream; error: unknown };

type FrameCallbacks = Pick<RenderFramesOptions, "onWarning" | "onPngResolutionAdjusted">;

type RunFramesInput = {
  source:
    | { kind: "scene"; scene: SceneNode }
    | { kind: "layout-transition"; transition: WorkerLayoutTransitionInput };
  timesMs: readonly number[];
  workerOptions: WorkerFrameRenderOptions;
  callbacks: FrameCallbacks;
  signal?: AbortSignal;
};

type MaterializedCallbacks = Pick<RenderOptions, "onWarning" | "onPngResolutionAdjusted">;

type RunMaterializedFramesInput = {
  source: MaterializedFrameSource;
  format: "svg" | "png";
  workerOptions: Omit<WorkerRenderOptions, "animation" | "timeMs">;
  callbacks: MaterializedCallbacks;
  signal?: AbortSignal;
};

type MaterializedCompletion =
  | {
      kind: "frame";
      slot: number;
      frame: Frame;
      warnings: StructuredError[];
    }
  | { kind: "error"; slot: number; error: unknown };

type ActivePoolOperation = {
  fail(error: unknown): void;
};

const workerPoolDisposeSymbol = Symbol.dispose;

export class WorkerPool {
  readonly concurrency: number;

  private readonly engines: WorkerEngine[];
  private readonly factoryWorkers: WorkerLike[];
  private readonly activeOperations = new Set<ActivePoolOperation>();
  private disposed = false;

  private constructor(engines: WorkerEngine[], factoryWorkers: WorkerLike[], concurrency: number) {
    this.engines = engines;
    this.factoryWorkers = factoryWorkers;
    this.concurrency = concurrency;
  }

  /** Create a pool with isolated Worker/WASM instances and copied asset snapshots. */
  static async create(options: WorkerPoolOptions): Promise<WorkerPool> {
    const concurrency = validateConcurrency(options.concurrency);
    const snapshot = createAssetSnapshot(options);
    const factoryWorkers: WorkerLike[] = [];
    const factoryWorkerSet = new Set<WorkerLike>();

    const initialization = Array.from({ length: concurrency }, async () => {
      const workerOption =
        typeof options.worker === "function"
          ? createFactoryWorker(options.worker, factoryWorkers, factoryWorkerSet)
          : options.worker;
      return WorkerEngine.create({
        worker: workerOption,
        fonts: cloneFonts(snapshot.fonts),
        ...(snapshot.geometries !== undefined && {
          geometries: cloneStructuredAsset(snapshot.geometries, "geometries"),
        }),
        ...(snapshot.symbols !== undefined && {
          symbols: cloneStructuredAsset(snapshot.symbols, "symbols"),
        }),
        ...(options.timeout !== undefined && { timeout: options.timeout }),
      });
    });

    const settled = await Promise.allSettled(initialization);
    const engines: WorkerEngine[] = [];
    let firstError: unknown;
    for (const result of settled) {
      if (result.status === "fulfilled") {
        engines.push(result.value);
      } else if (firstError === undefined) {
        firstError = result.reason;
      }
    }
    if (firstError !== undefined) {
      for (const engine of engines) {
        engine.dispose();
      }
      for (const worker of factoryWorkers) {
        worker.terminate();
      }
      throw firstError;
    }

    return new WorkerPool(engines, factoryWorkers, concurrency);
  }

  /**
   * Sample one declarative scene at explicit times across worker-local
   * prepared scenes. Frames are yielded in input order. At most one result
   * per active Worker is pending or buffered, so a slow consumer applies
   * backpressure with a fixed `concurrency` bound. Cancellation prevents new
   * frame requests; a synchronous frame already rendering inside a Worker may
   * finish before that Worker's prepared stream is released.
   */
  renderFrames(scene: SceneNode, options: WorkerPoolRenderFramesOptions): AsyncIterable<Frame> {
    this.assertNotDisposed();
    const timesMs = validateFrameSchedule(options);
    const sceneSnapshot = cloneStructuredAsset(scene, "scene");
    const { signal, callbacks, workerOptions } = splitFrameOptions(options);
    return this.runFrames({
      source: { kind: "scene", scene: sceneSnapshot },
      timesMs,
      workerOptions,
      callbacks,
      signal,
    });
  }

  /**
   * Compile a two-state transition in each active Worker, then sample assigned
   * frames through the same ordered, backpressured streams as `renderFrames`.
   * Compiled IR remains Worker-local and is not transported.
   */
  renderLayoutTransitionFrames(
    transition: WorkerLayoutTransitionInput,
    options: WorkerPoolRenderFramesOptions,
  ): AsyncIterable<Frame> {
    this.assertNotDisposed();
    const timesMs = validateFrameSchedule(options);
    const transitionSnapshot = snapshotWorkerLayoutTransitionInput(transition);
    const { signal, callbacks, workerOptions } = splitFrameOptions(options);
    return this.runFrames({
      source: { kind: "layout-transition", transition: transitionSnapshot },
      timesMs,
      workerOptions,
      callbacks,
      signal,
    });
  }

  /**
   * Render a bounded sync or async stream of fully materialized scenes. Every
   * scene receives a normal full-scene layout in a Worker. Input is consumed
   * lazily, output is yielded in consumption order, and at most `concurrency`
   * frames are pending or buffered. Unlike the raw structured-clone transport,
   * scenes must be strict JSON-lossless objects: explicit `undefined`, custom
   * instances, accessors, functions, promises, and cycles are rejected.
   */
  renderMaterializedFrames(
    source: MaterializedFrameSource,
    options: WorkerPoolMaterializedFramesOptions,
  ): AsyncIterable<Frame> {
    this.assertNotDisposed();
    const splitOptions = splitMaterializedFrameOptions(options);
    return this.runMaterializedFrames({ source, ...splitOptions });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const error = workerPoolDisposedError();
    for (const activeOperation of this.activeOperations) {
      activeOperation.fail(error);
    }
    this.activeOperations.clear();
    for (const engine of this.engines) {
      engine.dispose();
    }
    for (const worker of this.factoryWorkers) {
      worker.terminate();
    }
  }

  [workerPoolDisposeSymbol](): void {
    this.dispose();
  }

  private async *runFrames(input: RunFramesInput): AsyncGenerator<Frame, void, undefined> {
    this.assertNotDisposed();
    const assignedWorkers = assignSchedule(this.engines, input.timesMs);
    const controller = new PooledFrameController(input.signal);
    this.activeOperations.add(controller);
    try {
      const streams = await controller.open(assignedWorkers, input.source, input.workerOptions);
      assertMatchingWarnings(streams);
      forwardWorkerWarnings(
        streams[0]?.warnings ?? [],
        input.callbacks.onWarning,
        input.callbacks.onPngResolutionAdjusted,
      );
      if (input.timesMs.length > 0) {
        yield* yieldOrderedFrames({
          controller,
          streams,
          timesMs: input.timesMs,
          format: input.workerOptions.format,
        });
      }
    } catch (error) {
      controller.fail(error);
      await controller.close();
      throw error;
    } finally {
      await controller.close();
      this.activeOperations.delete(controller);
    }
  }

  private async *runMaterializedFrames(
    input: RunMaterializedFramesInput,
  ): AsyncGenerator<Frame, void, undefined> {
    this.assertNotDisposed();
    const controller = new MaterializedFrameController(input.source, input.signal);
    this.activeOperations.add(controller);
    try {
      yield* yieldMaterializedFrames({
        controller,
        endpoints: this.engines.map(getWorkerPoolEndpoint),
        format: input.format,
        workerOptions: input.workerOptions,
        callbacks: input.callbacks,
      });
    } catch (error) {
      controller.fail(error);
      throw error;
    } finally {
      await controller.close();
      this.activeOperations.delete(controller);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw workerPoolDisposedError();
    }
  }
}

class PooledFrameController {
  private readonly openedStreams: OpenedWorkerStream[] = [];
  private failed = false;
  private failure: unknown;
  private readonly abortHandler: (() => void) | undefined;

  constructor(private readonly signal?: AbortSignal) {
    if (signal) {
      this.abortHandler = () => {
        this.fail(createAbortError(signal.reason));
      };
      signal.addEventListener("abort", this.abortHandler, { once: true });
      if (signal.aborted) {
        this.fail(createAbortError(signal.reason));
      }
    }
  }

  async open(
    assignedWorkers: AssignedWorker[],
    source: RunFramesInput["source"],
    options: WorkerFrameRenderOptions,
  ): Promise<OpenedWorkerStream[]> {
    this.throwIfFailed();
    const settled = await Promise.allSettled(
      assignedWorkers.map(async (assignedWorker) => {
        const opened =
          source.kind === "scene"
            ? await assignedWorker.endpoint.open(source.scene, assignedWorker.schedule, options)
            : await assignedWorker.endpoint.openLayoutTransition(
                source.transition,
                assignedWorker.schedule,
                options,
              );
        return { ...assignedWorker, ...opened, received: 0 };
      }),
    );

    let firstError: unknown;
    for (const result of settled) {
      if (result.status === "fulfilled") {
        this.openedStreams.push(result.value);
      } else if (firstError === undefined) {
        firstError = result.reason;
      }
    }
    if (firstError !== undefined) {
      this.fail(firstError);
      await this.close();
    }
    this.throwIfFailed();
    return this.openedStreams;
  }

  fail(error: unknown): void {
    if (!this.failed) {
      this.failed = true;
      this.failure = error;
    }
    void this.close();
  }

  throwIfFailed(): void {
    if (this.failed) {
      throw this.failure;
    }
  }

  close(): Promise<void> {
    return this.closeOpenedStreams();
  }

  private async closeOpenedStreams(): Promise<void> {
    if (this.signal && this.abortHandler) {
      this.signal.removeEventListener("abort", this.abortHandler);
    }
    const streams = this.openedStreams.splice(0);
    await Promise.all(
      streams.map(async (stream) => {
        try {
          await stream.endpoint.close(stream.streamId);
        } catch {
          // A worker error or pool disposal may already have reclaimed the stream.
        }
      }),
    );
  }
}

type MaterializedFailure = { kind: "failure"; error: unknown };

class MaterializedFrameController implements ActivePoolOperation {
  private readonly source: AsyncIterator<MaterializedFrameInput>;
  private readonly failurePromise: Promise<MaterializedFailure>;
  private resolveFailure: ((failure: MaterializedFailure) => void) | undefined;
  private failed = false;
  private failure: unknown;
  private closePromise: Promise<void> | undefined;
  private readonly abortHandler: (() => void) | undefined;

  constructor(
    source: MaterializedFrameSource,
    private readonly signal?: AbortSignal,
  ) {
    this.source = getMaterializedFrameIterator(source);
    this.failurePromise = new Promise((resolve) => {
      this.resolveFailure = resolve;
    });
    if (signal) {
      this.abortHandler = () => this.fail(createAbortError(signal.reason));
      signal.addEventListener("abort", this.abortHandler, { once: true });
      if (signal.aborted) {
        this.fail(createAbortError(signal.reason));
      }
    }
  }

  async nextInput(): Promise<IteratorResult<MaterializedFrameInput, unknown>> {
    this.throwIfFailed();
    const sourceResult = Promise.resolve()
      .then(() => this.source.next())
      .then(
        (result) => ({ kind: "input" as const, result }),
        (error: unknown) => ({ kind: "source-error" as const, error }),
      );
    const outcome = await Promise.race([sourceResult, this.failurePromise]);
    if (outcome.kind === "failure") {
      throw outcome.error;
    }
    if (outcome.kind === "source-error") {
      this.fail(outcome.error);
      throw outcome.error;
    }
    this.throwIfFailed();
    return outcome.result;
  }

  fail(error: unknown): void {
    if (!this.failed) {
      this.failed = true;
      this.failure = error;
      this.resolveFailure?.({ kind: "failure", error });
      this.resolveFailure = undefined;
    }
    void this.close().catch(() => {
      // The original stream failure remains authoritative.
    });
  }

  throwIfFailed(): void {
    if (this.failed) {
      throw this.failure;
    }
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      if (this.signal && this.abortHandler) {
        this.signal.removeEventListener("abort", this.abortHandler);
      }
      this.closePromise = Promise.resolve()
        .then(() => this.source.return?.())
        .then(() => undefined);
    }
    return this.closePromise.catch((error: unknown) => {
      if (!this.failed) {
        throw error;
      }
    });
  }
}

class AsyncFromSyncMaterializedIterator implements AsyncIterator<MaterializedFrameInput> {
  constructor(private readonly source: Iterator<MaterializedFrameInput>) {}

  async next(): Promise<IteratorResult<MaterializedFrameInput>> {
    return this.source.next();
  }

  async return(): Promise<IteratorResult<MaterializedFrameInput>> {
    return this.source.return?.() ?? { done: true, value: undefined };
  }
}

function getMaterializedFrameIterator(
  source: MaterializedFrameSource,
): AsyncIterator<MaterializedFrameInput> {
  if ((typeof source !== "object" && typeof source !== "function") || source === null) {
    throw materializedSourceError();
  }
  const asyncIteratorFactory: unknown = Reflect.get(source, Symbol.asyncIterator);
  if (typeof asyncIteratorFactory === "function") {
    const iterator: unknown = Reflect.apply(asyncIteratorFactory, source, []);
    if (isIteratorLike(iterator)) {
      return iterator as AsyncIterator<MaterializedFrameInput>;
    }
    throw materializedSourceError();
  }
  const iteratorFactory: unknown = Reflect.get(source, Symbol.iterator);
  if (typeof iteratorFactory === "function") {
    const iterator: unknown = Reflect.apply(iteratorFactory, source, []);
    if (isIteratorLike(iterator)) {
      return new AsyncFromSyncMaterializedIterator(iterator as Iterator<MaterializedFrameInput>);
    }
  }
  throw materializedSourceError();
}

function isIteratorLike(value: unknown): value is { next: (...args: unknown[]) => unknown } {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof Reflect.get(value, "next") === "function"
  );
}

function materializedSourceError(): FatalError {
  return new FatalError(
    "WORKER_MATERIALIZED_SOURCE_NOT_ITERABLE",
    "Materialized frames must be an Iterable or AsyncIterable",
    { stage: "engine" },
  );
}

function validateConcurrency(value: number | undefined): number {
  const concurrency = value ?? DEFAULT_WORKER_POOL_CONCURRENCY;
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_WORKER_POOL_CONCURRENCY
  ) {
    throw new FatalError(
      "WORKER_POOL_INVALID_CONCURRENCY",
      `Worker pool concurrency must be an integer from 1 to ${MAX_WORKER_POOL_CONCURRENCY}, got ${String(concurrency)}`,
      { stage: "engine" },
    );
  }
  return concurrency;
}

function createAssetSnapshot(options: WorkerPoolOptions): AssetSnapshot {
  return {
    fonts: cloneFonts(options.fonts),
    ...(options.geometries !== undefined && {
      geometries: cloneStructuredAsset(options.geometries, "geometries"),
    }),
    ...(options.symbols !== undefined && {
      symbols: cloneStructuredAsset(options.symbols, "symbols"),
    }),
  };
}

function cloneFonts(fonts: readonly FontTransfer[]): FontTransfer[] {
  try {
    return fonts.map((font) => ({ ...font, data: font.data.slice(0) }));
  } catch (error) {
    throw assetSnapshotError("fonts", error);
  }
}

function cloneStructuredAsset<Value>(value: Value, name: string): Value {
  try {
    return structuredClone(value);
  } catch (error) {
    throw assetSnapshotError(name, error);
  }
}

function assetSnapshotError(name: string, error: unknown): FatalError {
  return new FatalError(
    "WORKER_POOL_ASSET_SNAPSHOT_FAILED",
    `Worker pool could not snapshot ${name}: ${error instanceof Error ? error.message : String(error)}`,
    { stage: "engine", asset: name },
  );
}

function createFactoryWorker(
  factory: WorkerPoolWorkerFactory,
  workers: WorkerLike[],
  workerSet: Set<WorkerLike>,
): WorkerLike {
  const worker = factory();
  if (workerSet.has(worker)) {
    throw new FatalError(
      "WORKER_POOL_DUPLICATE_WORKER",
      "Worker pool factory must return a new Worker instance for every slot",
      { stage: "engine" },
    );
  }
  workerSet.add(worker);
  workers.push(worker);
  return worker;
}

function validateFrameSchedule(options: WorkerPoolRenderFramesOptions | undefined): number[] {
  if (!options || (options.format !== "svg" && options.format !== "png")) {
    throw new FatalError(
      "ANIMATION_INVALID_FRAME_FORMAT",
      `Frame format must be "svg" or "png", got ${String(options?.format)}`,
      { stage: "emit" },
    );
  }
  if (!Array.isArray(options.timesMs)) {
    throw new FatalError(
      "ANIMATION_INVALID_TIMES",
      "Frame timesMs must be an array of non-negative finite numbers",
      { stage: "emit" },
    );
  }
  const timesMs = [...options.timesMs];
  for (const timeMs of timesMs) {
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      throw new FatalError(
        "ANIMATION_INVALID_TIME",
        `Animation timeMs must be a non-negative finite number, got ${String(timeMs)}`,
        { stage: "emit" },
      );
    }
  }
  return timesMs;
}

function splitFrameOptions(options: WorkerPoolRenderFramesOptions): {
  signal: AbortSignal | undefined;
  callbacks: FrameCallbacks;
  workerOptions: WorkerFrameRenderOptions;
} {
  const {
    timesMs: _timesMs,
    signal,
    onWarning,
    onPngResolutionAdjusted,
    ...workerOptions
  } = options;
  return {
    signal,
    callbacks: { onWarning, onPngResolutionAdjusted },
    workerOptions,
  };
}

function splitMaterializedFrameOptions(
  options: WorkerPoolMaterializedFramesOptions | undefined,
): Omit<RunMaterializedFramesInput, "source"> {
  if (!options || (options.format !== "svg" && options.format !== "png")) {
    throw new FatalError(
      "ANIMATION_INVALID_FRAME_FORMAT",
      `Frame format must be "svg" or "png", got ${String(options?.format)}`,
      { stage: "emit" },
    );
  }
  const { signal, format, onWarning, onPngResolutionAdjusted, ...workerOptions } = options;
  return {
    signal,
    format,
    callbacks: { onWarning, onPngResolutionAdjusted },
    workerOptions,
  };
}

function assignSchedule(
  engines: readonly WorkerEngine[],
  timesMs: readonly number[],
): AssignedWorker[] {
  // Core compiles even an empty schedule and therefore still reports scene
  // warnings. Prepare one Worker so the pool preserves that observable result.
  const activeCount = Math.min(engines.length, Math.max(1, timesMs.length));
  const assignments = engines.slice(0, activeCount).map((engine, slot) => ({
    slot,
    endpoint: getWorkerPoolEndpoint(engine),
    schedule: [] as IndexedFrameTime[],
  }));
  for (const [index, timeMs] of timesMs.entries()) {
    const assignment = assignments[index % activeCount];
    if (!assignment) {
      throw frameStreamCorrupt(`No Worker assignment exists for frame index ${index}`);
    }
    assignment.schedule.push({ index, timeMs });
  }
  return assignments;
}

function assertMatchingWarnings(streams: readonly OpenedWorkerStream[]): void {
  // Warnings are part of the observable deterministic result. Silently choosing
  // one Worker's warning set would hide asset or preparation divergence.
  const firstWarnings = JSON.stringify(streams[0]?.warnings ?? []);
  for (const stream of streams.slice(1)) {
    if (JSON.stringify(stream.warnings) !== firstWarnings) {
      throw new FatalError(
        "WORKER_POOL_WARNING_MISMATCH",
        "Worker pool instances returned different preparation warnings for the same scene",
        { stage: "engine" },
      );
    }
  }
}

function requestNextFrame(
  controller: PooledFrameController,
  stream: OpenedWorkerStream,
): Promise<FrameCompletion> {
  return stream.endpoint.next(stream.streamId).then(
    (frame) => ({ kind: "frame" as const, stream, frame }),
    (error: unknown) => {
      controller.fail(error);
      return { kind: "error" as const, stream, error };
    },
  );
}

function validateReturnedFrame(input: {
  frame: Frame;
  timesMs: readonly number[];
  format: "svg" | "png";
  buffered: ReadonlyMap<number, unknown>;
}): void {
  const { frame, timesMs, format, buffered } = input;
  if (
    !Number.isInteger(frame.index) ||
    frame.index < 0 ||
    frame.index >= timesMs.length ||
    frame.timeMs !== timesMs[frame.index] ||
    frame.format !== format ||
    buffered.has(frame.index)
  ) {
    throw frameStreamCorrupt(`Worker returned invalid or duplicate frame index ${frame.index}`);
  }
}

async function* yieldOrderedFrames(input: {
  controller: PooledFrameController;
  streams: OpenedWorkerStream[];
  timesMs: readonly number[];
  format: "svg" | "png";
}): AsyncGenerator<Frame, void, undefined> {
  const pending = new Map<number, Promise<FrameCompletion>>();
  const buffered = new Map<number, { frame: Frame; stream: OpenedWorkerStream }>();
  for (const stream of input.streams) {
    pending.set(stream.slot, requestNextFrame(input.controller, stream));
  }

  for (let expectedIndex = 0; expectedIndex < input.timesMs.length; expectedIndex += 1) {
    input.controller.throwIfFailed();
    while (!buffered.has(expectedIndex)) {
      if (pending.size === 0) {
        throw frameStreamCorrupt(`No Worker can produce frame index ${expectedIndex}`);
      }
      const completion = await Promise.race(pending.values());
      pending.delete(completion.stream.slot);
      input.controller.throwIfFailed();
      if (completion.kind === "error") {
        throw completion.error;
      }
      const frame = completion.frame;
      if (!frame) {
        throw frameStreamCorrupt(
          `Worker ${completion.stream.slot} ended before its assigned schedule`,
        );
      }
      validateReturnedFrame({
        frame,
        timesMs: input.timesMs,
        format: input.format,
        buffered,
      });
      completion.stream.received += 1;
      buffered.set(frame.index, { frame, stream: completion.stream });
    }

    input.controller.throwIfFailed();
    const bufferedFrame = buffered.get(expectedIndex);
    if (!bufferedFrame) {
      throw frameStreamCorrupt(`Frame index ${expectedIndex} disappeared from the buffer`);
    }
    buffered.delete(expectedIndex);
    yield bufferedFrame.frame;

    input.controller.throwIfFailed();
    if (bufferedFrame.stream.received < bufferedFrame.stream.schedule.length) {
      pending.set(
        bufferedFrame.stream.slot,
        requestNextFrame(input.controller, bufferedFrame.stream),
      );
    }
  }
}

type MaterializedQueueState = {
  nextInputIndex: number;
  expectedIndex: number;
  sourceDone: boolean;
  availableSlots: number[];
  pending: Map<number, Promise<MaterializedCompletion>>;
  buffered: Map<number, Extract<MaterializedCompletion, { kind: "frame" }>>;
};

async function* yieldMaterializedFrames(input: {
  controller: MaterializedFrameController;
  endpoints: WorkerPoolEndpoint[];
  format: "svg" | "png";
  workerOptions: Omit<WorkerRenderOptions, "animation" | "timeMs">;
  callbacks: MaterializedCallbacks;
}): AsyncGenerator<Frame, void, undefined> {
  const state: MaterializedQueueState = {
    nextInputIndex: 0,
    expectedIndex: 0,
    sourceDone: false,
    availableSlots: input.endpoints.map((_, slot) => slot),
    pending: new Map(),
    buffered: new Map(),
  };
  await fillMaterializedQueue({ ...input, state });

  while (state.pending.size > 0 || state.buffered.size > 0 || !state.sourceDone) {
    input.controller.throwIfFailed();
    const ready = state.buffered.get(state.expectedIndex);
    if (ready) {
      state.buffered.delete(state.expectedIndex);
      forwardWorkerWarnings(
        ready.warnings,
        input.callbacks.onWarning,
        input.callbacks.onPngResolutionAdjusted,
      );
      yield ready.frame;
      state.expectedIndex += 1;
      await fillMaterializedQueue({ ...input, state });
      continue;
    }

    if (state.pending.size === 0) {
      if (state.sourceDone) {
        throw frameStreamCorrupt(`Materialized frame ${state.expectedIndex} was not produced`);
      }
      await fillMaterializedQueue({ ...input, state });
      continue;
    }

    const completion = await Promise.race(state.pending.values());
    state.pending.delete(completion.slot);
    state.availableSlots.push(completion.slot);
    input.controller.throwIfFailed();
    if (completion.kind === "error") {
      throw completion.error;
    }
    state.buffered.set(completion.frame.index, completion);
  }
}

async function fillMaterializedQueue(input: {
  controller: MaterializedFrameController;
  endpoints: WorkerPoolEndpoint[];
  format: "svg" | "png";
  workerOptions: Omit<WorkerRenderOptions, "animation" | "timeMs">;
  state: MaterializedQueueState;
}): Promise<void> {
  while (
    !input.state.sourceDone &&
    input.state.pending.size + input.state.buffered.size < input.endpoints.length &&
    input.state.availableSlots.length > 0
  ) {
    input.controller.throwIfFailed();
    const sourceResult = await input.controller.nextInput();
    if (sourceResult.done) {
      input.state.sourceDone = true;
      return;
    }
    const frameInput = validateMaterializedFrameInput(
      sourceResult.value,
      input.state.nextInputIndex,
    );
    const slot = input.state.availableSlots.shift();
    if (slot === undefined) {
      throw frameStreamCorrupt("No Worker slot is available for a materialized frame");
    }
    const endpoint = input.endpoints[slot];
    if (!endpoint) {
      throw frameStreamCorrupt(`Worker slot ${slot} does not exist`);
    }
    const index = input.state.nextInputIndex;
    input.state.nextInputIndex += 1;
    input.state.pending.set(
      slot,
      requestMaterializedFrame({
        controller: input.controller,
        endpoint,
        slot,
        index,
        frameInput,
        format: input.format,
        workerOptions: input.workerOptions,
      }),
    );
  }
}

function requestMaterializedFrame(input: {
  controller: MaterializedFrameController;
  endpoint: WorkerPoolEndpoint;
  slot: number;
  index: number;
  frameInput: MaterializedFrameInput;
  format: "svg" | "png";
  workerOptions: Omit<WorkerRenderOptions, "animation" | "timeMs">;
}): Promise<MaterializedCompletion> {
  return input.endpoint
    .render(input.frameInput.scene, input.format, {
      ...input.workerOptions,
      animation: "static",
      timeMs: input.frameInput.timeMs,
    })
    .then(
      (rendered) => ({
        kind: "frame" as const,
        slot: input.slot,
        frame:
          rendered.format === "svg"
            ? {
                index: input.index,
                timeMs: input.frameInput.timeMs,
                format: "svg" as const,
                data: rendered.data,
              }
            : {
                index: input.index,
                timeMs: input.frameInput.timeMs,
                format: "png" as const,
                data: rendered.data,
              },
        warnings: rendered.warnings,
      }),
      (error: unknown) => {
        input.controller.fail(error);
        return { kind: "error" as const, slot: input.slot, error };
      },
    );
}

function validateMaterializedFrameInput(value: unknown, index: number): MaterializedFrameInput {
  if (!isPlainObject(value)) {
    throw materializedInputError(index, "input must be a plain object");
  }
  const timeDescriptor = Object.getOwnPropertyDescriptor(value, "timeMs");
  const sceneDescriptor = Object.getOwnPropertyDescriptor(value, "scene");
  if (!timeDescriptor || !("value" in timeDescriptor)) {
    throw materializedInputError(index, "timeMs must be an own data property");
  }
  if (!sceneDescriptor || !("value" in sceneDescriptor)) {
    throw materializedInputError(index, "scene must be an own data property");
  }
  const timeMs: unknown = timeDescriptor.value;
  if (typeof timeMs !== "number" || !Number.isFinite(timeMs) || timeMs < 0) {
    throw new FatalError(
      "ANIMATION_INVALID_TIME",
      `Animation timeMs must be a non-negative finite number, got ${String(timeMs)}`,
      { stage: "emit", frameIndex: index },
    );
  }
  const scene: unknown = sceneDescriptor.value;
  if (!isSceneNode(scene)) {
    throw materializedInputError(index, "scene must be a supported SceneNode");
  }
  assertSerializableSceneTransport(scene, index);
  return { timeMs, scene };
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function materializedInputError(index: number, reason: string): FatalError {
  return new FatalError(
    "WORKER_MATERIALIZED_FRAME_INVALID",
    `Materialized frame ${index} is invalid: ${reason}`,
    { stage: "engine", frameIndex: index },
  );
}

function frameStreamCorrupt(message: string): FatalError {
  return new FatalError("WORKER_FRAME_STREAM_CORRUPT", message, { stage: "engine" });
}

function workerPoolDisposedError(): FatalError {
  return new FatalError("WORKER_POOL_DISPOSED", "WorkerPool has been disposed", {
    stage: "engine",
  });
}

function createAbortError(reason: unknown): DOMException {
  const error = new DOMException("Worker frame stream was aborted", "AbortError");
  if (reason !== undefined) {
    Object.defineProperty(error, "cause", { configurable: true, value: reason });
  }
  return error;
}
