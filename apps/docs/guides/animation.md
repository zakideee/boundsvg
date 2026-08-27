---
title: Animation
---

# Animation

boundsvg can emit an editable SVG that plays a CSS animation in a compatible
viewer, or bake the same scene at an exact `timeMs` for SVG and PNG output.
Declarative `animate` and `animateUnits` tracks are post-layout: text shaping,
fitting, line breaking, and Taffy layout finish before any tracked value is
applied. Layout-reactive output instead materializes a complete static scene at
each time, as described below.

## What animates

`animate` and `animateUnits` tracks support exactly these paint channels:

- `opacity`
- `transform.translateX`
- `transform.translateY`
- `transform.scaleX`
- `transform.scaleY`
- `transform.rotateDeg`

Width, height, position, font size, colors, and every other layout or paint
property are not `animate`/`animateUnits` track targets. Materialize changing
layout props per frame when layout must react. A node track pivots around the
center of the node's layout bbox; a text unit track pivots around the union of
that unit's resolved outline ink bboxes. `originX` and `originY` are not
accepted inside animation keyframes. The unit bbox covers glyph fill outlines;
stroke width and shadow offset/blur expansion do not enlarge it.

## The `animate` prop

`Flex`, `Grid`, `Box`, `Text`, `TextOnPath`, `Image`, `Path`, `Svg`, `Shape`,
and `Symbol` accept `animate?: AnimationSpec`. `InlineRect` accepts the same
track inside rich text. Give animated logical nodes an explicit `id` so their
generated resource names stay stable when siblings change.

```tsx
import type { AnimationSpec } from "@boundsvg/core";

const entrance: AnimationSpec = {
  keyframes: [
    {
      at: 0,
      opacity: 0,
      transform: {
        translateY: 24,
        rotateDeg: -4,
        scaleX: 0.9,
        scaleY: 0.9,
      },
    },
    {
      at: 1,
      opacity: 1,
      transform: {
        translateY: 0,
        rotateDeg: 0,
        scaleX: 1,
        scaleY: 1,
      },
    },
  ],
  durationMs: 800,
  easing: "ease-out",
  iterations: 1,
  fill: "both",
};

const scene = (
  <Canvas width={320} height={180} background="#0f172a">
    <Box
      id="entrance-card"
      width={120}
      height={80}
      background="#38bdf8"
      borderRadius={16}
      animate={entrance}
    />
  </Canvas>
);
```

Every keyframe has a normalized `at` value in `0..1`. Values must be strictly
increasing, and an animation needs at least two keyframes. If any keyframe uses
`opacity`, every keyframe must define `opacity`; the same rule applies to
`transform`. Omitted transform channels use their identity values (`0` for
translation and rotation, `1` for scale).

| `AnimationSpec` field | Type                           | Default  | Meaning                                                               |
| --------------------- | ------------------------------ | -------- | --------------------------------------------------------------------- |
| `keyframes`           | `readonly AnimationKeyframe[]` | required | At least two strictly increasing frames                               |
| `durationMs`          | `number`                       | required | Positive finite duration                                              |
| `delayMs`             | `number`                       | `0`      | Finite delay before the first iteration                               |
| `easing`              | `AnimationEasing`              | `"ease"` | Named, step, spring, or cubic-bezier easing                           |
| `iterations`          | `number \| "infinite"`         | `1`      | Positive iteration count; fractional counts are allowed               |
| `fill`                | `"none" \| "both"`             | `"none"` | Whether the first/last pose applies outside the active animation time |

`delayMs` may be negative. A negative delay starts the animation as if it
had already been running for that amount of time.

The first and last `at` values do not have to be `0` and `1`; boundsvg holds
the nearest keyframe through an uncovered endpoint.

## Step easing

Use step easing for a hard switch such as a blinking caret. The keywords and
object form are part of `AnimationEasing`:

```ts
type AnimationStepPosition =
  | "jump-start"
  | "jump-end"
  | "jump-none"
  | "jump-both";

type StepEasing =
  | "step-start"
  | "step-end"
  | {
      type: "steps";
      count: number;
      position?: AnimationStepPosition;
    };

const caretBlink: AnimationSpec = {
  keyframes: [
    { at: 0, opacity: 1 },
    { at: 1, opacity: 0 },
  ],
  durationMs: 560,
  easing: { type: "steps", count: 2, position: "jump-none" },
  iterations: "infinite",
  fill: "both",
};
```

`count` must be a positive integer; `jump-none` requires at least two steps.
The caret example uses two `jump-none` steps so each iteration spends one half
at each endpoint; `steps(1, jump-end)` would hold the first keyframe until the
iteration boundary instead of producing a visible blink.
The object form defaults to `jump-end`. `step-start` is equivalent to
`steps(1, jump-start)`, and `step-end` to `steps(1, jump-end)`. Short
`"start"`/`"end"` aliases and raw CSS strings such as `"steps(4,end)"` are not
accepted. Declarative SVG keeps the keyword form or emits the canonical
`steps(count, jump-position)` spelling; static SVG and PNG sample the same
boundary algorithm. Invalid step input throws `ANIMATION_INVALID_SPEC`.

At a positive delay with `fill: "both"`, the pre-start value is the first
keyframe without applying a step jump. At the exact active start, step easing
does apply. A non-final iteration boundary is the next iteration's progress
zero. At the exact final boundary, an integer iteration count resolves to the
last keyframe; a fractional count resolves at its fractional progress.

## Spring easing

Spring easing evaluates the unit step response of a damped spring in closed
form. There is no numerical integration and no randomness, so the sampled pose
and the emitted SVG stay byte deterministic.

```ts
type AnimationSpring = {
  type: "spring";
  stiffness?: number;
  damping?: number;
  mass?: number;
};

const popIn: AnimationSpec = {
  keyframes: [
    { at: 0, opacity: 0, transform: { scaleX: 0.8, scaleY: 0.8 } },
    { at: 1, opacity: 1, transform: { scaleX: 1, scaleY: 1 } },
  ],
  durationMs: 700,
  easing: { type: "spring", stiffness: 170, damping: 14 },
};
```

| Parameter   | Default | Accepted range |
| ----------- | ------- | -------------- |
| `stiffness` | `100`   | `1..1000`      |
| `damping`   | `10`    | `1..100`       |
| `mass`      | `1`     | `0.1..10`      |

Out-of-range or non-finite values throw `ANIMATION_INVALID_SPEC`.

The damping ratio `damping / (2 * sqrt(stiffness * mass))` selects the
behaviour. Below `1` the curve overshoots past the target keyframe and settles
back; at `1` it approaches without overshoot; above `1` it approaches more
slowly. Overshoot is intentional: progress above `1` extrapolates the keyframe
pair, so a scale animating to `1` passes slightly beyond it before settling.
`opacity` is the exception — it stays clamped to `0..1`, the same range keyframe
validation enforces, so an overshooting easing never emits an out-of-range
opacity.

Progress is always exactly `0` at the start of a keyframe segment and clamped to
exactly `1` at its end, so the authored keyframe values are always reached. A
spring that has not settled by the end of its segment therefore snaps to the
final value.

That snap is easy to hit. How much is left at the end of a segment depends on
the damping ratio `zeta = damping / (2 * sqrt(stiffness * mass))`, with
`omega0 = sqrt(stiffness / mass)` and `T` the segment duration in seconds. What
decays is `e^(-rate * T)`, and the rate is not the same in all three regimes:

| Regime     | Decay rate                           | Residual at the segment end                                                |
| ---------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `zeta < 1` | `zeta * omega0`                      | about `e^(-rate * T) / sqrt(1 - zeta^2)`                                   |
| `zeta = 1` | `omega0`                             | `e^(-rate * T) * (1 + omega0 * T)`                                         |
| `zeta > 1` | `omega0 * (zeta - sqrt(zeta^2 - 1))` | about `e^(-rate * T) * (zeta + sqrt(zeta^2 - 1)) / (2 * sqrt(zeta^2 - 1))` |

The overdamped row is the one that surprises people: past critical damping the
rate _falls_ as `damping` rises, so adding damping to remove overshoot makes the
spring settle more slowly, not faster. `stiffness: 100, damping: 40` over 700 ms
still leaves 17 percent — a far bigger jump than the underdamped defaults.

So raising `damping` is only a fix below critical. Above it, lengthen the
segment or raise `stiffness` instead. The example above uses 700 ms for exactly
that reason.

Declarative SVG expands the curve into a CSS `linear()` timing function with 65
fixed-point stops, preceded by a plain `animation-timing-function: linear`
declaration. A viewer that does not implement `linear()` drops the second
declaration while parsing and keeps the first, so the spring degrades to
straight interpolation between its keyframes rather than to the initial value
`ease`. Viewers that do support it take the later declaration. The base pose
matches the sampled `timeMs` either way. Static SVG and PNG use the exact
closed form rather than the stops, so still output is unaffected by the stop
count.

64 intervals also bound how much oscillation the emitted curve can carry. A
segment spanning many oscillations (large `stiffness`, small `mass`, small
`damping`, or a long duration) aliases: the CSS playback curve stops resembling
the closed form once the segment covers more than roughly eight oscillations.
Static sampling stays exact either way. Keep fast springs to short segments.

Because CSS applies one timing function per keyframe segment, the emitted
`linear()` is derived from the first authored segment. With two keyframes, or
with evenly spaced keyframes, that matches the static sampler exactly. With
unevenly spaced keyframes, later segments play back on the first segment's
curve while static sampling still uses each segment's own duration.

Spring easing on `animateUnits` repeats the whole `linear()` list — about 660
bytes — once per animated unit, because each unit gets its own rule. A
cluster-level track over a long string can add hundreds of kilobytes of CSS.
Prefer a node-level `animate` when the stagger does not need per-unit springs.

## Reading resolved values

`engine.sampleAnimationState(scene, timeMs)` reports what each animated node
resolves to at a time, without rendering:

```ts
engine.sampleAnimationState(scene, 250);
// [{ nodeId: "card", opacity: 0.71, transform: { a: 1, b: 0, c: 0, d: 1, e: 12, f: 0 } }]
```

`transform` is the composed affine matrix in SVG order — `(x, y)` maps to
`(a*x + c*y + e, b*x + d*y + f)` — with the node-center origin already folded
in, so it matches what the emitter draws rather than the authoring channels.

Only nodes carrying a node-level `animate` track appear. Text unit tracks
resolve per paint unit, so they have no single opacity or transform to report
and are deliberately absent.

This is a read API for inspectors and downstream editors. It does not render;
pair it with a static render at the same `timeMs`.

## Typing and IME composition

boundsvg does not expose keyboard, composition-event, selection, candidate, or
IME state APIs. A downstream scene materializer owns `committed`, `composing`,
conversion, and candidate-selection state, then builds a complete static scene
for each frame. Core supplies the deterministic visual vocabulary:

```tsx
function typingFrame(committed: string, composing: string) {
  return (
    <Text font="NotoSansJP" fontSizePx={40} whiteSpace="pre-wrap">
      {committed}
      <Inline
        textDecoration={{
          line: "underline",
          color: "#60a5fa",
          thicknessPx: 2,
        }}
      >
        {composing}
      </Inline>
      <InlineRect
        inlineSizePx={2}
        blockSizePx="line"
        color="#111827"
        animate={caretBlink}
      />
    </Text>
  );
}
```

Render a candidate window with ordinary `Box` and `Text` nodes in that same
materialized scene. When committed/composing content or wrapping changes, run
the normal full-scene layout again. Only the caret's opacity/transform track is
native post-layout animation; the text and candidate state are authored as
inputs.

## Text unit animation

`Text` and `TextOnPath` also accept `animateUnits?: TextUnitAnimation`. It
reuses `AnimationSpec`, but applies the sampled opacity/transform pose
independently to resolved text paint units.

```tsx
import type { TextUnitAnimation } from "@boundsvg/core";

const clusterEntrance: TextUnitAnimation = {
  by: "cluster",
  delayStepMs: 45,
  order: "logical",
  ruby: "with-base",
  animation: {
    keyframes: [
      { at: 0, opacity: 0, transform: { translateY: 12 } },
      { at: 1, opacity: 1, transform: { translateY: 0 } },
    ],
    durationMs: 240,
    easing: "ease-out",
    fill: "both",
  },
};

const title = (
  <Text
    id="title"
    font="NotoSansJP"
    fontSizePx={36}
    animateUnits={clusterEntrance}
  >
    office émoji 👨‍👩‍👧 日本語
  </Text>
);
```

| Field         | Type                        | Default       | Meaning                                                                  |
| ------------- | --------------------------- | ------------- | ------------------------------------------------------------------------ |
| `by`          | `"cluster" \| "line"`       | required      | Target shaping clusters, or resolved lines/vertical columns              |
| `animation`   | `AnimationSpec`             | required      | Post-layout opacity/transform track applied to every unit                |
| `delayStepMs` | `number`                    | `0`           | Non-negative linear delay added per unit index                           |
| `order`       | `"logical" \| "visual"`     | `"logical"`   | Select the stagger index; it never changes glyph paint order             |
| `ruby`        | `"with-base" \| "separate"` | `"with-base"` | Move annotations with their base cluster, or assign separate paint units |

Cluster means a shaping cluster, not a JavaScript character or arbitrary
grapheme slice. A ligature, combining sequence, CJK character, or emoji remains
an indivisible shaped unit. `order: "visual"` follows current resolved
inline-axis placement; it does not introduce additional Unicode bidi
reordering. Line units are layout-local, so a reflow can change line membership
and stagger assignment. Cluster identity remains tied to logical source ranges
across reflow.

`animate` and `animateUnits` may coexist on one text node: the logical node
receives the outer track and each resolved unit receives its unit track. Unit
animation does not change shaping, fitting, line/path placement, advances,
chosen font size, or accessibility labeling. It opts that node into per-unit
outline paint while non-target text keeps merged output. Sampled opacity
multiplies the node and unit values; transforms compose by applying the node
transform first and the unit transform second.

For `TextOnPath`, unit animation is allowed only when every non-empty effective
range is decoration-free. A root decoration stopped by
`Inline textDecoration="none"` across all text is therefore allowed, while any
remaining root or Inline decoration throws
`TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED`. This restriction avoids
implicitly splitting curved decoration into independently moving units;
node-level `animate` can still move/fade the complete decorated result.

## Output modes

```ts
const animatedSvg = engine.renderToAnimatedSvg(scene, {
  playback: { mode: "independent" },
  timeMs: 0,
});

const stillSvg = engine.renderToSvg(scene, {
  timeMs: 400,
});

const stillPng = engine.renderToPng(scene, {
  timeMs: 400,
});
```

| Output                            | Behavior                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `renderToAnimatedSvg`             | Emits CSS `@keyframes`; required `playback: { mode: "independent" }` preserves every authored track. |
| `renderToSvg`                     | Emits a static pose with no animation CSS. Animated input requires an explicit `timeMs`.             |
| `renderToPng` / `renderToWebp`    | Samples a static pose at `timeMs`; SVG-only playback and namespace options are rejected.             |
| `renderToAnimatedWebp` / `...Gif` | Samples the requested frame schedule; a required `iterations` controls total container plays.        |

`timeMs` must be a non-negative finite number. It is optional for nonanimated
static input and selects the base pose of animated SVG output. When more
than one generated SVG is embedded inline in the same document, give each one
a stable `resourceIdPrefix`. The prefixes, after boundsvg's CSS-safe
normalization, must be non-empty and pairwise prefix-free for generated
animation names, classes, resources, and references to be guaranteed disjoint.
For example, fixed-width scopes are suitable; `doc-` and `doc-clip-` are not,
because the former is a prefix of the latter.

The animated SVG method does not infer or synchronize a document duration.
The 0.3 `AnimatedSvgPlayback` union supports only independent authored tracks;
there is no `mode: "timeline"`, document `durationMs`, or document-level
iteration option.

### Migrating output-mode calls to 0.3

Audit every no-option `renderToSvg(scene)` call whose scene may contain
`animate` or `animateUnits`; choose either a deterministic static time or the
animated entry point. Then migrate mechanically:

- `renderToSvg(scene, { animation: "static", timeMs })` becomes
  `renderToSvg(scene, { timeMs })`.
- `renderToSvg(scene, { animation: "declarative", ... })` becomes
  `renderToAnimatedSvg(scene, { playback: { mode: "independent" }, ... })`.
- Remove `animation` from PNG/WebP calls and keep the explicit `timeMs`.
- Make the same choice for `renderToSvgAndIR`, compiled methods, Worker calls,
  React components, and hooks. Removed or artifact-incompatible own keys fail;
  they are not silently projected away.

### Canvas-stable strokes

A solid `Flex`, `Grid`, or `Box` border, or a solid `Path` stroke, can opt out
of a camera's post-layout scale while retaining normal layout and geometry:

```tsx
<Box
  id="camera"
  width={96}
  height={64}
  animate={{
    keyframes: [
      { at: 0, transform: { scaleX: 1, scaleY: 1 } },
      { at: 1, transform: { scaleX: 1.6, scaleY: 1.6 } },
    ],
    durationMs: 800,
    easing: "linear",
  }}
>
  <Box
    width={40}
    height={20}
    borderWidth={1}
    borderColor="#8b7cf6"
    strokeScaling="canvas"
  />
  <Path
    d="M1 1H39V19H1Z"
    width={40}
    height={20}
    fill="none"
    stroke="#8b7cf6"
    strokeWidth={1}
    strokeScaling="canvas"
  />
</Box>
```

Declarative SVG uses the standard SVG non-scaling stroke behavior in viewers
that support it. The same SVG also contains a deterministic `timeMs` fallback
width for static renderers, so PNG, WebP, GIF, and sampled MP4 frames use the
same canvas-space meaning. The render method's `scale` remains an
output-resolution multiplier: a 1 px canvas-space stroke produces 2 device
pixels at scale 2. For SVG, scale multiplies root `width` / `height` and the
canvas-stroke restoration CSS width; it leaves `viewBox`, child geometry, and
ordinary non-canvas-stroke attributes unchanged.

Only similarity transforms are accepted for an ancestor of a canvas-stable
stroke. Non-uniform scale, axis reflection, and dashed strokes fail explicitly
instead of being approximated. Translation can still move coverage between
adjacent pixels; this option reduces scale-driven width pulsing, not all
subpixel antialiasing changes.

## What is guaranteed

`timeMs` is part of the render input. Given the same scene, assets, boundsvg
version, render options, and `timeMs`, static SVG and PNG bytes are reproducible.

An animated SVG also carries the sampled `timeMs` pose in ordinary SVG
attributes. A static renderer such as resvg ignores the animation CSS and sees
that **base pose**. Rasterizing it produces the same PNG bytes as
`renderToPng(scene, { timeMs })`.

## What is not guaranteed

CSS playback uses the SVG viewer's animation clock and interpolation engine.
The exact browser frame shown at a wall-clock instant is outside the determinism
contract. Playback also requires a viewer that honors inline CSS animations;
viewers without that support, static renderers such as resvg, and environments
that block the animation style show the `timeMs` base-pose still image instead.

## Reduced motion

`reducedMotion: "pause"` appends one media block that stops every animation the
render started:

```ts
engine.renderToAnimatedSvg(scene, {
  playback: { mode: "independent" },
  reducedMotion: "pause",
});
```

```css
@media (prefers-reduced-motion: reduce) {
  .bsvg-anim-card,
  .bsvg-anim-badge {
    animation: none !important;
  }
}
```

The result is the `timeMs` pose held still, not an unstyled element: the base
pose already lives in the element's attributes, so stopping playback leaves a
coherent frame. The selector list covers node and text-unit tracks alike, and the block is
emitted last so it wins over the per-class rules.

The default is `"keep"`, which emits nothing — a render that never passes the
option and one that passes `"keep"` produce identical bytes. Opting in is
deliberate: the extra CSS changes the output, and the determinism contract makes
that the caller's choice rather than a silent default.

Static SVG has no animation CSS and does not accept `reducedMotion`.

The application embedding the SVG may prefer to own the policy instead. Render a
representative poster frame in static mode when reduced motion is requested:

```tsx
return prefersReducedMotion ? (
  <BoundSvg vnode={scene} renderOptions={{ timeMs: 400 }} />
) : (
  <AnimatedBoundSvg
    vnode={scene}
    renderOptions={{ playback: { mode: "independent" }, timeMs: 0 }}
  />
);
```

## Sampling, IR, and compiled scenes

`renderToIR(scene, { timeMs })` always returns the pose sampled at `timeMs` plus
the semantic `animation` track. Only `timeMs` changes the sampled pose. Pause an editor at a
fixed time, request a new IR, and use that IR for hit-testing or selection.

`compile(scene)` keeps the raw animation track. Each
static compiled call samples that immutable compiled scene at its own `timeMs`,
while `renderCompiledToAnimatedSvg` preserves independent playback.

```ts
const compiled = engine.compile(scene);
const frames = [0, 100, 200, 300].map((timeMs) =>
  engine.renderCompiledToPng(compiled, {
    timeMs,
  }),
);
```

For a complete fixed-scene frame schedule, `renderFrames` compiles
and prepares once, then samples every requested time without repeating
validation, layout, shaping, outline resolution, or IR parsing:

```ts
for (const frame of engine.renderFrames(scene, {
  timesMs: [600, 0, 1_400, 600],
  format: "png",
})) {
  await writeFrame(frame.index, frame.data);
}
```

The iterable is synchronous, single-use, and owns its native prepared scene.
Exhausting or closing it releases that state. Every frame is sampled in static
mode, and output order exactly follows the input schedule, including duplicate
and non-monotonic times. Iterating the same object again yields no frames and
does not throw; request a new iterable for another pass.

For parallel, ordered sampling, `WorkerPool.renderFrames` returns an
`AsyncIterable<Frame>`. It prepares the fixed scene inside each Worker, bounds
pending/buffered results by concurrency, and supports `AbortSignal`. See the
[`@boundsvg/worker` API](/api/worker).

`renderToAnimatedWebp` and `renderToAnimatedGif` package the same sampling into
a single animated file. Their required `iterations` option controls total
container plays independently of each node animation's own iteration setting —
see [PNG, WebP & GIF Export](/guides/png-export).
There is still no APNG API; for MP4 see [Video Export](/guides/video-export),
or pass sampled PNG frames to an external encoder for any other movie format.

## Layout-reactive animation

There is no core layout-animation track. To animate width, height, gap, font
size, text content, or exclusion geometry, build the complete static scene for
each `timeMs` and run the normal full-scene layout. One narrow exception
exists: two discrete layouts of an otherwise identical scene can be compiled
into a single A → B → hold → A track — see
[Layout Transitions](./layout-transitions). In a Worker pool, stream
those `{ timeMs, scene }` values through `renderMaterializedFrames`.

```ts
import type { SceneNode } from "@boundsvg/core";

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
        children: [
          {
            type: "Text",
            font: "NotoSansJP",
            fontSizePx: 40,
            minFontSizePx: 18,
            fit: "shrink",
            wrap: "char",
            children: ["幅に合わせて再整形"],
          },
        ],
      },
    ],
  };
}
```

Choose where a changing value lives according to the intended semantics:

| Model           | Put changing values in                                                    | Result                                                                                                             |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Rigid           | `animate` / `transform`                                                   | Shaped and laid-out paint moves as one object; no reflow or refit                                                  |
| Layout-reactive | Static props in each materialized scene                                   | Full-scene layout recomputes parents, siblings, intrinsic sizes, wrapping, fitting, ellipsis, ruby, and exclusions |
| Mixed           | Layout values in static props; paint motion in `animate` / `animateUnits` | Reflow first, then sample the remaining post-layout tracks at the frame's `timeMs`                                 |

For example, transforming a drawn obstacle does not move a static text-flow
exclusion; the paint and flow intentionally become desynchronized. To make text
follow it, materialize the exclusion geometry at the new position too.

The same rule applies to `TextOnPath`: changing `d`, content, Inline
shaping/paint/decoration, font/layout inputs, `startOffsetPx`, `textAnchor`,
`pathDirection`, `pathNormal`, `pathOffsetPx`, `pathFit`, or `pathOverflow`
requires a newly materialized scene and full path layout for that frame. Those
values are not native post-layout channels. A regular `animate` or allowed
`animateUnits` track may still move or fade the already positioned outlines.

Layout justification such as Flex/Grid `justifyContent` is recomputed with the
rest of the materialized scene. This does not add a text-justification value to
`textAlign`; supported text alignment remains `start`, `center`, or `end`.

The application owns the pure `timeMs -> SceneNode` generator, interpolation,
springs, schedules, and I/O. `renderMaterializedFrames` accepts plain scenes,
not callbacks or promises inside scenes, and performs a normal full-scene
layout for every input. Keep the root Canvas fixed for video; padding and
cropping belong in the downstream wrapper.

## Text unit budgets

Per-unit outline painting is intentionally bounded across the complete scene:

| Budget                    | Warn above | Fail above |
| ------------------------- | ---------: | ---------: |
| Animated text units       |      1,024 |      4,096 |
| Estimated paint fragments |      2,048 |      8,192 |

The fragment estimate counts each unit's shadows, strokes, and fill. Warnings
are delivered through `onWarning`; exceeding a fatal limit throws rather than
silently dropping paint. The constants are exported from `@boundsvg/core`.

## Layered export

Layered SVG and PNG use one `timeMs` across every layer. A source containing
`animate` or `animateUnits` records `animated: true` and the sampled `timeMs` in
its manifest, including static SVG/PNG export. See [Layered Export](/guides/layered-export)
for compositing-island behavior and validation.

## Limitations

- Core has no declarative tracks for layout properties. Materialize a complete
  static scene per time when layout must react.
- Node transforms pivot at the layout bbox center; text unit transforms pivot
  at the resolved unit-outline ink bbox center. Custom `originX`/`originY`
  values are not supported.
- `Text` and `TextOnPath` support cluster and line paint-unit tracks. Arbitrary grapheme,
  word/fragment addressing, clip reveal, stroke-dash drawing, rich-text span
  tracks, and geometry-part tracks are not supported.
- `TextOnPath` does not have native path-layout tracks. Materialize changing
  path geometry, placement, fit, overflow, content, Inline style/decoration,
  and font/layout inputs through materialized scenes.
- `animateUnits.order: "visual"` does not add full Unicode bidi reordering.
- Spring easing covers the damped step response only. Other physics easing,
  per-property springs, and velocity handoff are not supported.
- Playback and frame encoding remain downstream responsibilities. Reduced motion
  is available as an opt-in emit option; choosing when to request it is still the
  embedding application's call.
