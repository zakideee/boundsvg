---
title: Utility Components
---

# Utility Components

`@boundsvg/extras` provides small unstyled VNode helpers for application code. It fills the same role as a utility layer such as drei: it does not add a new renderer, theme, or visual language, but it removes repetitive layout props from common boundsvg scenes.

## Example

<!--@include: ../_generated/extras-layout.md-->

## When to use it

Use extras when a scene is still regular boundsvg but the same layout pattern appears repeatedly:

- `HStack` and `VStack` fix `direction` for row and column stacks.
- `Center` fixes `alignItems` and `justifyContent` to `center`.
- `Inset` names padding intent when wrapping content.
- `FitText` defaults text fitting to `shrink`.
- `ImageCover` fixes `objectFit` to `cover`.

The helpers return normal boundsvg VNodes, so you can still render them with `@boundsvg/core`, pass them to `@boundsvg/react`, inspect them, or transform them with `@boundsvg/core/vnode`.

## Keeping utilities unstyled

Extras deliberately avoids cards, badges, templates, gradients, and brand-specific components. Keep product styling in your application:

```tsx
import { Canvas, Box, Text } from "@boundsvg/core";
import { Center, HStack, VStack } from "@boundsvg/extras";

const vnode = (
  <Canvas width={360} height={160} background="#111827">
    {Center(
      { width: 360, height: 160 },
      HStack(
        { gap: 12 },
        Box({ width: 48, height: 48, background: "#155e75", borderRadius: 8 }),
        VStack(
          { gap: 4, width: 220 },
          Text(
            { font: "NotoSansJP", fontSizePx: 20, color: "#f8fafc" },
            "Reusable block",
          ),
          Text(
            { font: "NotoSansJP", fontSizePx: 13, color: "#cbd5e1" },
            "Your styles stay local.",
          ),
        ),
      ),
    )}
  </Canvas>
);
```
