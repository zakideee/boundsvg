---
title: "@boundsvg/worker"
---

# @boundsvg/worker

Worker adapter for running the WASM engine off the main thread. `WorkerEngine`
mirrors one-shot render and measurement calls. `WorkerPool` adds ordered,
bounded frame streams for animation workloads.

## WorkerPool

### `WorkerPool.create(options)`

Creates independent Worker/WASM instances. Each pool slot receives its own
private copy of the supplied fonts, geometries, and symbols, isolated from
later caller mutations.

```ts
import { WorkerPool } from "@boundsvg/worker";

const fontData = await fetch("/fonts/NotoSansJP.ttf").then((response) =>
  response.arrayBuffer(),
);

const pool = await WorkerPool.create({
  worker: () =>
    new Worker(new URL("@boundsvg/worker/worker", import.meta.url), {
      type: "module",
    }),
  concurrency: 2,
  fonts: [
    {
      alias: "NotoSansJP",
      weight: 400,
      style: "normal",
      data: fontData,
    },
  ],
});
```

| Option        | Type                                           | Required | Default  | Description                                                                       |
| ------------- | ---------------------------------------------- | -------- | -------- | --------------------------------------------------------------------------------- |
| `worker`      | `URL \| WorkerPoolWorkerFactory`               | Yes      | —        | Worker module URL or a factory returning a fresh Worker for every pool slot       |
| `concurrency` | `number`                                       | No       | `2`      | Independent Worker count; integer from 1 through 8                                |
| `fonts`       | `FontTransfer[]`                               | Yes      | —        | Font bytes and descriptors copied into the pool snapshot                          |
| `geometries`  | `Array<{ id: string; doc: GeometryDoc }>`      | No       | —        | Geometry registry snapshot                                                        |
| `symbols`     | `Array<{ id: string; def: SymbolDefinition }>` | No       | —        | Symbol registry snapshot                                                          |
| `timeout`     | `number`                                       | No       | `30_000` | Initialization and individual protocol-call timeout inherited from `WorkerEngine` |

`DEFAULT_WORKER_POOL_CONCURRENCY` is `2` and
`MAX_WORKER_POOL_CONCURRENCY` is `8`. Every slot duplicates WASM state and
registered asset memory, so select concurrency from measured memory and startup
cost rather than CPU count alone. Mutating the caller's arrays or font buffers
after `create()` starts does not change the pool snapshot.

A local benchmark harness measures the actual
`WorkerPool` path in isolated 1/2/4/8-worker Node processes. It includes the
parent font snapshot, per-slot Engine/WASM/font ownership, materialized-scene
scheduling and buffering, and SVG/PNG result transfer. Every case has one
discarded warmup and five measured repetitions. This is an ownership-topology
benchmark, not a claim that every browser has the same RSS. In a reference
run, peak RSS grew from roughly 0.1 GiB with one slot to roughly 0.4 GiB with
eight slots. Exact values and min/max bands shift with allocator state,
runtime version, and hardware.
Slots initialize concurrently, so startup is generally flat at low concurrency
and the ordering of the one- and two-slot timings carries no signal; contention
becomes visible at higher concurrency. The measured memory growth is why the
default stays at `2`; applications should rerun the benchmark with
representative assets before opting into a larger pool.

### `pool.renderFrames(scene, options)`

For fixed-layout sampling, each Worker prepares the same scene and samples its
assigned times without repeating layout, shaping, outline resolution, or IR
parsing for every frame. `scene` must be a transport-safe `SceneNode`; convert
a VNode with `toSceneDocument` from `@boundsvg/core` before starting the stream.

```ts
const abortController = new AbortController();

for await (const frame of pool.renderFrames(scene, {
  timesMs: [600, 0, 1_400, 600],
  format: "png",
  signal: abortController.signal,
  onWarning: (warning) => console.warn(warning.code, warning.message),
})) {
  await saveFrame(frame.index, frame.data);
}
```

```ts
type WorkerPoolRenderFramesOptions = Omit<RenderFramesOptions, "timesMs"> & {
  timesMs: readonly number[];
  signal?: AbortSignal;
};
```

- Frame `index` and yield order always follow `timesMs` input order, regardless
  of Worker completion order. Duplicate and non-monotonic times are preserved.
- SVG output is always statically sampled. PNG rasterizes the same static pose.
- At most one result per active Worker is pending or buffered. A slow consumer
  therefore applies backpressure bounded by `concurrency`.
- Aborting or closing the async iterator starts no new requests and releases
  every prepared Worker stream. A synchronous WASM render already in progress
  may finish before its result is discarded.
- Preparation warnings are collected eagerly and forwarded once before the
  first frame. All active Workers must return identical warning sequences;
  divergence is a fatal `WORKER_POOL_WARNING_MISMATCH`. An empty schedule still
  prepares one Worker so scene warnings are not lost.

### `pool.renderMaterializedFrames(source, options)`

This path accepts a sync or async stream of independently materialized static
scenes. Each scene goes through the normal full-scene validation, layout,
shaping, and render pipeline in a Worker.

```ts
import type { SceneNode } from "@boundsvg/core";
import type { MaterializedFrameInput } from "@boundsvg/worker";

function sceneAt(timeMs: number): SceneNode {
  const progress = Math.min(1, timeMs / 1_000);
  return {
    type: "Canvas",
    width: 640,
    height: 360,
    children: [
      {
        type: "Box",
        width: 120 + 240 * progress,
        height: 160,
        children: [],
      },
    ],
  };
}

function* materialize(
  timesMs: readonly number[],
): Iterable<MaterializedFrameInput> {
  for (const timeMs of timesMs) {
    yield { timeMs, scene: sceneAt(timeMs) };
  }
}

for await (const frame of pool.renderMaterializedFrames(
  materialize([0, 250, 500, 750, 1_000]),
  { format: "svg" },
)) {
  consume(frame);
}
```

```ts
type MaterializedFrameInput = {
  timeMs: number;
  scene: SceneNode;
};

type MaterializedFrameSource =
  | Iterable<MaterializedFrameInput>
  | AsyncIterable<MaterializedFrameInput>;

type WorkerPoolMaterializedFramesOptions =
  | (Omit<RenderSvgOptions, "timeMs"> & { format: "svg"; signal?: AbortSignal })
  | (Omit<RenderPngOptions, "timeMs"> & {
      format: "png";
      signal?: AbortSignal;
    });
```

The source is consumed lazily and total pending or buffered frames are bounded
by `concurrency`. `timeMs` is validated after an input is pulled and before it
is enqueued. A frame failure closes the whole stream at that index; frames
already yielded remain valid, and no later frame is yielded.

Recoverable warnings from each materialized render are forwarded once,
immediately before that frame is yielded in input order. Supply `onWarning` in
the format-specific options to receive them. SVG-only namespace/metadata keys
are rejected on PNG streams, and raster-only keys are rejected on SVG streams.

Materialized scenes use a strict JSON-lossless transport contract. Plain
objects, arrays, strings, booleans, finite numbers, and `null` are accepted.
Functions, promises, class instances, accessors, symbol keys, explicit
`undefined`, non-finite numbers, sparse arrays, cycles, and excessive nesting
are rejected before a Worker request is sent. Do not rely on `JSON.stringify`
silently dropping unsupported values.

A companion benchmark measures both frame time and sampled heap allocation
for the recursive predicate by scene size. In a standalone reference run
(isolated from other suites to avoid a warmed runtime), 10/100/1,000-node
scenes took 0.019/0.149/1.344 ms and allocated
32.15/295.60/2,902.08 KiB per validation. That was 6.1/10.7/12.3% of direct SVG
render time and 20.0/25.1/31.4% of its sampled allocation, respectively. Timing
and allocation operations receive equal warmup and sample counts. The benchmark
uses the Node inspector sampling profiler and is intended for comparative
regression measurements, not exact per-object accounting.

## Fixed-layout and materialized rendering

| Path                       | Use it when                                                                     | Layout work                                             |
| -------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `renderFrames`             | One scene has only post-layout `animate`/`animateUnits` tracks                  | Prepare once per active Worker, then sample paint poses |
| `renderMaterializedFrames` | Width, text, exclusion geometry, or `TextOnPath` geometry/placement/fit changes | Full-scene layout for every materialized scene          |

`renderMaterializedFrames` intentionally accepts scenes, not callbacks or
timeline tracks. The caller owns interpolation, spring evaluation, schedules,
and the purity of its `timeMs -> SceneNode` generator. See
[Layout-reactive animation](/guides/animation#layout-reactive-animation) for
rigid, reactive, and mixed semantics.

`TextOnPath` uses the same validation, rich Inline shaping/paint/decoration,
stable fatal errors,
resolved outlines, and SVG/PNG results through `WorkerEngine` and `WorkerPool`
as through the direct Node/browser engines. If `d`, path placement, fit,
overflow, content, Inline style/decoration, or font/layout inputs change, put
the complete static `TextOnPath` node in each materialized scene; those fields
are not post-layout animation tracks.

## Ownership and disposal

The pool owns every Worker it uses, whether created from a URL or returned by a
factory, plus the Worker engine instances, prepared streams, and copied asset
snapshots. Always dispose it when finished:

```ts
try {
  // consume one or more frame streams
} finally {
  pool.dispose();
}
```

`dispose()` is idempotent and `pool[Symbol.dispose]()` is equivalent. Disposing
the pool rejects active work, closes active sources, releases prepared state,
and terminates every Worker. A pool cannot be reused after disposal.

## WorkerEngine

`WorkerEngine.create(options)` creates a single-Worker proxy for asynchronous
one-shot static SVG, independent animated SVG, PNG, WebP, animated WebP,
animated GIF, IR, layered, and text
measurement calls. Raster buffers are transferred back without an extra copy. Use `WorkerPool` when you need ordered
multi-frame scheduling; use `WorkerEngine` when a single off-main-thread engine
is sufficient.

Both APIs load assets inside the Worker and must be disposed explicitly. They
do not fetch fonts or images implicitly; provide bytes through their options or
through an application-owned loading layer. `WorkerEngine.create` transfers
the supplied font `ArrayBuffer`s directly, detaching them on the caller side;
copy buffers first if the application must retain them. `WorkerPool.create`
does not detach caller buffers because it snapshots every font before transfer.

Static and animated SVG calls are distinct and match the Core contract:

```ts
const still = await workerEngine.renderToSvg(scene, { timeMs: 400 });
const animated = await workerEngine.renderToAnimatedSvg(scene, {
  playback: { mode: "independent" },
  resourceIdPrefix: "worker-0042-",
  nodeIdMetadata: "omit",
});

const stillArtifacts = await workerEngine.renderToSvgAndIR(scene, {
  timeMs: 400,
});
const animatedArtifacts = await workerEngine.renderToAnimatedSvgAndIR(scene, {
  playback: { mode: "independent" },
});
```

An animated scene sent to a static SVG method requires explicit `timeMs`.
Worker-safe protocol option types omit callbacks that cannot be cloned;
`WorkerEngine` accepts the corresponding Core types, returns warnings in the
response, and invokes callbacks on the caller side. Structured fatal errors and
unknown/legacy option rejection match the direct Engine.

## Worker error codes

Failures specific to `WorkerEngine` and `WorkerPool` are `FatalError`
instances, but `FatalError.code` is a `string`, so use this table as the code
inventory. "Retry" describes whether repeating the same operation is
appropriate; rows that require a new engine or pool cannot be retried on the
disposed or failed instance.

| Code                                         | Meaning                                                                                                                              | Retry                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `WORKER_CRASHED`                             | The Worker emitted an error event and its `WorkerEngine` was disposed.                                                               | Create a new engine or pool, then retry. Report repeated crashes.                                   |
| `WORKER_CREATION_FAILED`                     | The Worker constructor failed, for example because of its URL, CSP, or runtime environment.                                          | Fix the environment or Worker URL, then retry creation.                                             |
| `WORKER_ENGINE_DISPOSED`                     | A request targeted a disposed `WorkerEngine`.                                                                                        | Not on that instance; create a new engine.                                                          |
| `WORKER_FRAME_ENDPOINT_UNAVAILABLE`          | An engine without the internal frame endpoint was used by a pool.                                                                    | No automatic retry; recreate the pool and report if it repeats.                                     |
| `WORKER_FRAME_STREAM_CORRUPT`                | A frame stream returned an index or time that does not match its prepared schedule, or the pool's assignment state was inconsistent. | No automatic retry; recreate the pool and report the protocol failure.                              |
| `WORKER_FRAME_STREAM_EXISTS`                 | The Worker received a duplicate open request for an active stream ID.                                                                | No automatic retry; recreate the pool and report the protocol failure.                              |
| `WORKER_FRAME_STREAM_NOT_FOUND`              | The Worker received a next or close request for an unknown stream ID.                                                                | Restart the frame operation; report if it repeats.                                                  |
| `WORKER_INVALID_MESSAGE`                     | The Worker received a value that is not a valid boundsvg Worker request.                                                             | Verify matching package versions and rebuild the Worker bundle before retrying.                     |
| `WORKER_MATERIALIZED_FRAME_INVALID`          | A materialized item is not the required `{ timeMs, scene }` data shape.                                                              | Fix the item, then retry.                                                                           |
| `WORKER_MATERIALIZED_FRAME_NOT_SERIALIZABLE` | A materialized scene is not losslessly transferable under the documented JSON transport contract.                                    | Fix the reported path in the scene, then retry.                                                     |
| `WORKER_MATERIALIZED_SOURCE_NOT_ITERABLE`    | The materialized frame source is neither an `Iterable` nor an `AsyncIterable`.                                                       | Supply a supported source, then retry.                                                              |
| `WORKER_NOT_INITIALIZED`                     | A render request reached the Worker before successful initialization.                                                                | Initialize through `WorkerEngine.create()` or recreate the pool, then retry.                        |
| `WORKER_POOL_ASSET_SNAPSHOT_FAILED`          | The pool could not copy a font, geometry, or symbol snapshot.                                                                        | Replace the invalid or detached asset data, then retry creation.                                    |
| `WORKER_POOL_DISPOSED`                       | Work targeted a disposed pool, or active pool work was cancelled by disposal.                                                        | Not on that pool; create a new pool.                                                                |
| `WORKER_POOL_DUPLICATE_WORKER`               | A pool factory returned the same Worker instance for more than one slot.                                                             | Fix the factory to return a new Worker for every call, then retry creation.                         |
| `WORKER_POOL_INVALID_CONCURRENCY`            | Pool concurrency is not an integer from 1 through 8.                                                                                 | Fix `concurrency`, then retry creation.                                                             |
| `WORKER_POOL_WARNING_MISMATCH`               | Pool Workers returned different preparation warnings for the same scene.                                                             | No automatic retry; verify assets and package versions, then recreate the pool.                     |
| `WORKER_PROTOCOL_INVALID_RESPONSE`           | A response has no valid Worker protocol shape for its request ID.                                                                    | Verify package versions and rebuild the Worker bundle; report if it persists.                       |
| `WORKER_PROTOCOL_UNEXPECTED_RESPONSE`        | A valid response type does not match the request that was sent.                                                                      | Verify package versions and rebuild the Worker bundle; report if it persists.                       |
| `WORKER_PROTOCOL_WARNING_SEVERITY`           | The Worker returned a non-recoverable entry in a warning list.                                                                       | No automatic retry; report the protocol failure.                                                    |
| `WORKER_REQUEST_TIMEOUT`                     | Initialization or a request exceeded the configured timeout.                                                                         | Check workload and timeout; retry if the render is safe to repeat, or recreate an unhealthy Worker. |
| `WORKER_TRANSPORT_FAILED`                    | `postMessage` failed before the request could be transported.                                                                        | Fix invalid or detached transfer data; recreate the Worker if needed, then retry.                   |
| `WORKER_UNHANDLED_ERROR`                     | An exception not represented by a boundsvg `FatalError` escaped inside the Worker.                                                   | No automatic retry; inspect the message and report the underlying error.                            |
