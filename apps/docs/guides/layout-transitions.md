---
title: Layout Transitions
---

# Layout Transitions

`compileLayoutTransition` compiles exactly two full layouts of the same scene
into one animated `CompiledScene`. Each state is laid out once by the normal
pipeline; the compiler then generates transform tracks that move every matched
node from its position in the first state to its position in the second, holds
there, and returns. The result plays as A → B → hold → A.

This is a narrow tool for one job: the same scene with one layout-driving value
changed — a panel that grows, a message that pushes its siblings down. It is not
a general layout animation system. When content, wrapping, or structure changes
between the states you want, use [layout-reactive
animation](./animation#layout-reactive-animation) instead, which recomputes a
full layout at every sampled time.

## Quick start

```ts
import { compileLayoutTransition, renderCompiledToSvg } from "@boundsvg/core";

// Both states must give every node an explicit unique id — matching between
// the states happens by id, and a node without one fails the compile.
const collapsed = scene(120); // your function returning a SceneNode
const expanded = scene(180); // same scene, different panel height

const compiled = compileLayoutTransition({
  states: { collapsed, expanded },
  checkpoints: [
    { timeMs: 0, state: "collapsed" },
    { timeMs: 300, state: "expanded" },
    { timeMs: 700, state: "expanded" },
    { timeMs: 1000, state: "collapsed" },
  ],
  easing: "ease-in-out",
});

const svg = renderCompiledToSvg(compiled); // one animated SVG document
```

The schedule is fixed in shape: exactly two named states, exactly four
checkpoints, the state sequence `[first, second, second, first]`, a start at
`0`, strictly increasing times, and at most one easing for the whole track. The
last checkpoint time is the duration. Anything else is rejected with
`LAYOUT_TRANSITION_INVALID_SCHEDULE` before any layout runs.

## What the compiler guarantees

- **Checkpoints are exact.** At each of the four checkpoint times, every
  matched node's layout box matches the box of that state compiled on its own.
  The acceptance suite holds this to an absolute `1e-6px` per component on its
  fixed integer fixture; that tolerance is a property of that fixture, not a
  promise about arbitrary floating-point scenes.
- **Flight is approximate.** Between checkpoints, nodes move by interpolating
  post-layout transforms. Their paths are not what a full layout at each
  intermediate time would produce, and nested parent/child motion is not
  linear in world space. If a time between checkpoints must be layout-exact,
  it has to be a checkpoint.
- **Paint comes from the first state.** Text shaping, line breaks, and every
  other painted detail belong to the reference state and are moved, never
  re-rendered. A node whose box scales has its paint scaled with it.
- **Sampling never re-runs layout.** The compiled scene samples like any other:
  no validation, layout, shaping, or outline work happens per frame.

## What the two states must share

Both states must be the same scene in everything except box geometry. The
compiler compares the states and rejects the pair with a single
`LAYOUT_TRANSITION_INCOMPATIBLE` fatal — carrying the node id and a category —
on the first difference it finds:

| Category    | Requirement                                                                  |
| ----------- | ---------------------------------------------------------------------------- |
| `id`        | Every node has an explicit, unique `id`, and both states use the same id set |
| `canvas`    | The effective canvas width and height are identical                          |
| `kind`      | A given id is the same component kind in both states                         |
| `parent`    | A given id has the same parent in both states                                |
| `order`     | Siblings keep their order                                                    |
| `content`   | Text content and its line/glyph flow, image sources, and paths are identical |
| `paint`     | Fills, strokes, static transforms, metadata, and handlers are identical      |
| `animation` | Authored `animate` tracks are identical                                      |
| `bbox`      | Boxes are finite, and no dimension that changes size is zero in either state |
| `stroke`    | A canvas-stable stroke only moves under uniform generated scale              |

Two consequences are worth calling out. Changing a Text node's width so its
lines wrap differently is a `content` mismatch — the compiler will not morph
text layouts. And a node whose generated motion includes scale may not also
carry an authored transform; opacity-only `animate` tracks combine freely with
generated motion, which is what keeps entrance/visibility animations working
inside a transition.

## Warnings

The compiled scene's warnings are the reference state's warnings in their
original order, followed by the second state's, with byte-identical duplicates
removed. `onWarning` on the compiled render entries delivers them once per
render in that order. This differs from an ordinary single compile only in the
appended second-state entries.

## Outputs

A transition compiles to an ordinary `CompiledScene`, so every compiled entry
accepts it:

```ts
import {
  renderCompiledFrames,
  renderCompiledToAnimatedGif,
  renderCompiledToAnimatedWebp,
  renderCompiledToPng,
  renderCompiledToSvg,
} from "@boundsvg/core";
import { renderCompiledToMp4 } from "@boundsvg/video";

renderCompiledToSvg(compiled); // animated SVG
renderCompiledToPng(compiled, { animation: "static", timeMs: 300 }); // a poster
renderCompiledFrames(compiled, { timesMs: [0, 100, 200], format: "png" });
renderCompiledToAnimatedWebp(compiled, { durationMs: 1000, fps: 30 });
renderCompiledToAnimatedGif(compiled, { durationMs: 1000, fps: 25 });
await renderCompiledToMp4(engine, compiled, {
  durationMs: 1000,
  frameRate: 30,
});
```

The compiled IR carries the generated wrapper groups the compiler injects;
each is marked with the meta keys published as
`LAYOUT_TRANSITION_WRAPPER_META`, whose `sourceNodeIdKey` names the authored
node a wrapper moves. Consumers that need to map generated motion back to
authored nodes match those constants rather than copying the strings.

The compiled option types drop `skipValidation` and `textPathMode`: both are
compile-time choices that are already fixed inside the `CompiledScene`.
`renderCompiledFrames` snapshots the scene when called and returns a
single-use iterator; dispose semantics match `renderFrames`.

## Workers

`@boundsvg/worker` runs the whole operation off the main thread. The request
carries the two flattened `SceneNode` states and the checkpoints — not a
compiled scene — and each worker compiles the transition it renders:

```ts
const webp = await workerEngine.renderLayoutTransitionToAnimatedWebp(
  transition,
  options,
);
const gif = await workerEngine.renderLayoutTransitionToAnimatedGif(
  transition,
  options,
);
for await (const frame of workerPool.renderLayoutTransitionFrames(
  transition,
  options,
)) {
  // frame.index, frame.timeMs, frame.data
}
```

Two properties of this route matter when sizing work:

- Requests are limited to 16 MiB of UTF-8 JSON
  (`MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES`). This is a safety cap against
  runaway payloads, not a supported performance envelope.
- Every active worker compiles its own copy of the transition. For small
  scenes the recompile dominates: adding workers raises total CPU and memory
  and can make the wall time worse, not better. Measure before assuming a
  larger pool helps.
