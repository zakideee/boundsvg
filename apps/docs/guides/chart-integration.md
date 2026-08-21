---
title: Chart Integration
---

# Chart Integration

`boundsvg` does not include chart semantics. Instead, external libraries can generate boundsvg scenes by targeting the low-level geometry and symbol APIs.

## Recommended Split

- `@boundsvg/core`: scene graph, layout, render pipeline, `Shape`, `Symbol`
- `@boundsvg/shape`: geometry documents and symbol definitions
- an external chart library: scales, axes, series, legends, chart layout

## What an external chart library should emit

Chart libraries should output normal boundsvg scenes:

```tsx
<Canvas width={640} height={360}>
  <Box padding={24}>
    <Text font="NotoSansJP" fontSizePx={14}>
      Scatter Plot
    </Text>
    <Symbol symbolId="marker" width={12} height={12} fill="#2563eb" />
  </Box>
</Canvas>
```

## What Stays Out Of boundsvg

These concerns belong in the external chart library, not in boundsvg core:

- scale construction
- axis generation
- series transforms
- legend layout
- pie / bar / scatter / line semantics

These concerns stay inside boundsvg and `@boundsvg/shape`:

- geometry kernels
- symbol expansion
- scene layout
- SVG / PNG rendering
