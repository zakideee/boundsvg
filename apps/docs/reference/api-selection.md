---
title: Choosing an API
---

# Choosing an API

boundsvg exposes layout facts, sampled render facts, and rendered artifacts at
different pipeline stages. Choose the API by the question you need to answer;
their bounding boxes are not interchangeable.

## Capability map

| Question                                                                  | API                                                                                                                                       | Entry point                                | Animation and coordinates                                                                                                 |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| What did layout allocate before animation?                                | `engine.renderToLayoutTree(input, options?)`                                                                                              | `@boundsvg/core`                           | Returns layout coordinates. `LayoutRenderOptions` accepts only `skipValidation`; there is no `timeMs`.                    |
| What opacity and local transform does the semantic IR contain at time t?  | `engine.renderToIR(input, { timeMs })`                                                                                                    | `@boundsvg/core`                           | Samples animation into IR. A node's `bbox` remains its pre-transform layout box; read its sampled `transform` separately. |
| Where is each node in canvas space at time t?                             | `inspectScene(engine, input, { timeMs })`                                                                                                 | `@boundsvg/core`                           | Samples IR, composes node and ancestor transforms, and reports `transformBox` and `visualBBox`.                           |
| I already have sampled IR; how do I derive positioned boxes?              | `collectInspectionBBoxes(ir)`                                                                                                             | `@boundsvg/core/inspect`                   | Uses the transforms already present in the supplied IR. It does not sample a scene itself.                                |
| What animation channels resolve for each animated node at time t?         | `engine.sampleAnimationState(input, timeMs)`                                                                                              | `@boundsvg/core`                           | Returns resolved node-local opacity and affine transform. It does not compose ancestor transforms or return boxes.        |
| Which semantic node is a hit candidate at a canvas point?                 | `hitTest(ir, x, y)` or `engine.hitTest(ir, x, y)`                                                                                         | `@boundsvg/core/scene` or `@boundsvg/core` | Uses sampled transforms, conservative Path geometry/stroke bounds, and rectangular or rounded ancestor clips.             |
| How do I render many explicit times without repeating layout and shaping? | `engine.renderFrames(input, { timesMs, format })`                                                                                         | `@boundsvg/core`                           | Prepares the scene once and samples the requested output frames. This is an output API, not a batch inspection API.       |
| How do I flow, measure, or shrink-wrap text without rendering?            | `layoutTextFlow`, `layoutTextFlowWithExclusions`, `measureTextBlock`, `measureIntrinsicInlineSize`, `shrinkwrapText`, or `shrinkwrapFlow` | `Engine` from `@boundsvg/core`             | Returns text layout facts without scene geometry. All six methods use the same structured text-layout fatal contract.     |
| How do I see diagnostic bounds over a render?                             | `debug: true`, `BoundSvgDebugOverlay`, or `NodeInspectorPanel`                                                                            | `@boundsvg/core`, `@boundsvg/react/debug`  | Human-facing diagnostic presentation. Use inspection APIs for assertions and editor state.                                |

## Inspection bbox semantics

For every inspected IR node, `InspectionBBox` contains three related views:

- `layoutBBox` is the node's IR `bbox`, before its own or ancestor transforms.
- `transformBox` contains the four layout-box corners after composing the node's
  sampled transform with every ancestor transform.
- `visualBBox` is the axis-aligned canvas-space rectangle enclosing those four
  transformed corners.

`visualBBox` is positioned geometry, not exact painted ink. It does not expand
for strokes or shadows, and it does not subtract clipping or opacity. Rotated
content is represented by its axis-aligned enclosure; use `transformBox` when
the four transformed corners matter.

Path hit-test candidates use Rust-derived conservative geometry/stroke bounds
separate from the layout box. Explicit rectangular and rounded clips are tested
in their original coordinates for their owner and descendants, including nested
and transformed clips. `hitTest`, `hitTestWithIndex`, and candidate enumeration
use the same rules. Generic spatial indexes and inspection selection retain
their placement-box semantics.

Core returns candidates rather than exact painted ink: a curved Path's bounds
can contain empty space, and text/shadows are not pixel-accurate. Browser event
helpers and React interaction check painted Path fill/stroke before selecting
the final target. React also accounts for native canvas-stable stroke paint at
the current pointer under SVG viewport scaling. Core candidates assume output
scale one for canvas-stable strokes. A Browser-only adapter using those
candidates cannot recover additional stroke paint introduced by host CSS
scaling; use React interaction for that native hit-stack handling.

Use IR produced by the matching engine version. Schema-34 Path output requires
`pathGeometry`; older hand-built or saved IR must be regenerated with
`engine.renderToIR(scene)` before hit testing. Layout `bbox` cannot substitute
for missing derived geometry. These rules cover static rendering and explicit
`timeMs` samples; they do not synchronize a playing SVG's live clock and hit
index at every animation instant.

`inspectScene` performs a layout-tree render and an IR render, then derives maps,
boxes, validation, warnings, and stats. That complete snapshot is convenient for
CI and editor tooling, but it costs more than requesting only IR or only layout.
There is currently no prepared batch-inspection API for many times; call
`inspectScene` for each required sample or use `renderFrames` when rendered frame
bytes are the actual result you need.

## Layout-reactive changes

Node animation is post-layout. When state changes text, dimensions, wrapping, or
other layout inputs, materialize the scene for that state and run the normal
layout/render pipeline again. `timeMs` samples declared animation tracks; it does
not interpolate arbitrary scene props or make layout itself time-dependent.
