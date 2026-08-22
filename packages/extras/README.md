# @boundsvg/extras

Unstyled utility components for boundsvg layouts.

## Installation

```bash
npm install @boundsvg/extras
```

## When to use

Use this package when application scenes repeat the same low-level layout props and you want a small utility layer without adding a theme or template system.

```tsx
import { Canvas, Box, Text } from "@boundsvg/core";
import { Center, FitText, HStack, ImageCover, VStack } from "@boundsvg/extras";

const coverSvg =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">' +
      '<rect width="160" height="120" fill="#164e63"/>' +
      "</svg>",
  );

const vnode = (
  <Canvas width={460} height={220} background="#111827">
    {Center(
      { width: 460, height: 220 },
      HStack(
        { gap: 16, padding: 18 },
        Box(
          { width: 150, height: 132, overflow: "clip", borderRadius: 8 },
          ImageCover({ src: coverSvg, width: 150, height: 132 }),
        ),
        VStack(
          { gap: 10, width: 230 },
          FitText(
            {
              font: "NotoSansJP",
              fontSizePx: 28,
              color: "#f8fafc",
              preferredFrame: { w: 220, h: 42 },
            },
            "Utility layout",
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

The helpers return normal boundsvg VNodes. You can render or inspect them with `@boundsvg/core`, pass them through `@boundsvg/react`, or transform them with `@boundsvg/core/vnode`.

## Documentation

Full documentation: <https://github.com/zakideee/boundsvg>

## License

MIT OR Apache-2.0
