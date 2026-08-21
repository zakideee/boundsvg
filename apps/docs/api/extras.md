---
title: "@boundsvg/extras"
---

# @boundsvg/extras

Unstyled VNode utility components for application code. Each helper returns a normal boundsvg VNode and can be rendered, inspected, or transformed like a VNode created directly from `@boundsvg/core`.

```tsx
import { Canvas, Text } from "@boundsvg/core";
import { Center, FitText, HStack, VStack } from "@boundsvg/extras";

const vnode = (
  <Canvas width={360} height={160} background="#111827">
    {Center(
      { width: 360, height: 160 },
      HStack(
        { gap: 12 },
        VStack(
          { gap: 4, width: 240 },
          FitText(
            {
              font: "NotoSansJP",
              fontSizePx: 28,
              color: "#f8fafc",
              preferredFrame: { w: 240, h: 36 },
            },
            "Reusable layout",
          ),
          Text(
            { font: "NotoSansJP", fontSizePx: 14, color: "#cbd5e1" },
            "No theme included.",
          ),
        ),
      ),
    )}
  </Canvas>
);
```

## Utilities

| API          | Description                                       |
| ------------ | ------------------------------------------------- |
| `HStack`     | `Flex` with `direction: "row"`                    |
| `VStack`     | `Flex` with `direction: "column"`                 |
| `Center`     | `Flex` with centered cross-axis and main-axis     |
| `Spacer`     | Empty `Box` helper for deliberate spacing         |
| `Inset`      | `Box` helper that maps `inset` to `padding`       |
| `Frame`      | Pass-through `Box` wrapper for naming structure   |
| `Absolute`   | `Box` with `position: "absolute"`                 |
| `TextBox`    | `Text` helper that maps `width`/`height` to frame |
| `FitText`    | `Text` with default `fit: "shrink"`               |
| `ImageCover` | `Image` with `objectFit: "cover"`                 |

Extras intentionally does not include styled cards, badges, templates, or brand primitives. Keep product styling in your application.

## Animation presets

Pure functions that build an `AnimationSpec` for a component's `animate` prop.
They add no engine or WASM behaviour — the returned value is the same core type
you would have written by hand.

```ts
import { Box } from "@boundsvg/core";
import { popInAnimation, staggerAnimations } from "@boundsvg/extras";

Box({
  width: 80,
  height: 80,
  background: "#2563eb",
  animate: popInAnimation(),
});
```

| API                  | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| `fadeInAnimation`    | Opacity 0 to 1                                               |
| `fadeOutAnimation`   | Opacity 1 to 0                                               |
| `slideInAnimation`   | Travels in from one edge while fading in                     |
| `scaleInAnimation`   | Grows from a smaller scale while fading in                   |
| `rotateInAnimation`  | Rotates into place while fading in                           |
| `popInAnimation`     | Scales in on a spring, overshooting slightly before settling |
| `staggerAnimations`  | Repeats one spec, offsetting each copy by a fixed interval   |
| `sequenceAnimations` | Chains specs so each starts when the previous one finishes   |

Every preset takes `durationMs`, `delayMs`, and `easing` overrides. `popInAnimation`
takes spring parameters (`stiffness`, `damping`, `mass`) instead of `easing`, since
the spring is the point of the preset. Its 700 ms default is chosen so the spring
settles: a shorter segment leaves a residual that snaps to the final keyframe. See
the [animation guide](/guides/animation) for how that residual behaves.

```ts
// Four copies, 80ms apart.
staggerAnimations(fadeInAnimation(), { count: 4, intervalMs: 80 });

// Back to back, with a 40ms pause between.
sequenceAnimations([fadeInAnimation(), scaleInAnimation()], { gapMs: 40 });
```

`sequenceAnimations` accumulates `delayMs + durationMs * iterations + gapMs`. A spec
with `iterations: "infinite"` may only be last, since nothing after it would ever
start; anywhere else throws `ANIMATION_SEQUENCE_INFINITE`.
