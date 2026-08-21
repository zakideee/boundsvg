# @boundsvg/react

React bindings for boundsvg — render declarative JSX layouts as SVG or PNG in the browser.

## Installation

> Not yet published to npm — build from source. See the [monorepo README](https://github.com/zakideee/boundsvg) for setup instructions.

## Usage

```tsx
import { BoundSvg, Flex, Text } from "@boundsvg/react";
import { BoundSvgProvider } from "@boundsvg/react/provider";

function App() {
  return (
    <BoundSvgProvider
      config={{ fonts: [{ alias: "Inter", source: "/fonts/Inter.woff2" }] }}
    >
      <BoundSvg width={600} height={400} background="#fff">
        <Flex direction="column" alignItems="center" justifyContent="center">
          <Text font="Inter" fontSizePx={24} color="#333">
            Hello from React!
          </Text>
        </Flex>
      </BoundSvg>
    </BoundSvgProvider>
  );
}
```

Rendering runs on the main thread by default. Pass `worker` in the provider config to move it into a Web Worker via `@boundsvg/worker` and keep the UI thread free.

## When to use the utility entry points

```tsx
import { BoundSvgDebugOverlay } from "@boundsvg/react/debug";
import { useBoundSvgInspection } from "@boundsvg/react/inspect";
import { usePngObjectUrl, useRenderAsset } from "@boundsvg/react/assets";

const { inspection } = useBoundSvgInspection(vnode);
const { png, svg, compiled } = useRenderAsset(vnode, {
  pngOptions: { scale: 2 },
});
const objectUrl = usePngObjectUrl(png);

<BoundSvgDebugOverlay
  inspection={inspection}
  labelMode="summary"
  selectedNodeId="headline"
  highlightedBBoxes={[
    { id: "crop", label: "crop bbox", x: 24, y: 32, w: 240, h: 120 },
  ]}
/>;
```

- `@boundsvg/react/inspect` reads structured scene facts through the Provider engine.
- `@boundsvg/react/debug` renders bbox overlays, labels, node panels, and controlled highlight targets.
- `@boundsvg/react/assets` is for React screens that reuse one compiled scene to preview, download, or embed generated SVG/PNG assets.

## Documentation

Full documentation: <https://github.com/zakideee/boundsvg>

## License

MIT OR Apache-2.0
