---
title: Quick Start
---

# Quick Start

Install `@boundsvg/core` first — see [Installation](/getting-started/installation).

## Node.js (Core)

```tsx
// tsconfig.json: { "jsx": "react-jsx", "jsxImportSource": "@boundsvg/core" }
import { createEngineAsync, Canvas, Flex, Text } from "@boundsvg/core";
import fs from "node:fs";

const fontData = fs.readFileSync("path/to/NotoSansJP-Regular.ttf");

const engine = await createEngineAsync({
  fonts: [
    { alias: "NotoSansJP", data: fontData, weight: 400, style: "normal" },
  ],
});

const node = (
  <Canvas width={600} height={200} background="#ffffff">
    <Flex
      direction="column"
      alignItems="center"
      justifyContent="center"
      width={600}
      height={200}
    >
      <Text font="NotoSansJP" fontSizePx={32} color="#333333">
        Hello, boundsvg!
      </Text>
    </Flex>
  </Canvas>
);

const svg = engine.renderToSvg(node);
console.log(svg);
```

**Output:**

<!--@include: ../_generated/quickstart-hello.md-->

## React (Browser)

```tsx
import { BoundSvg, Canvas, Text } from "@boundsvg/react";
import { BoundSvgProvider } from "@boundsvg/react/provider";
```

::: tip
See the [React Integration Guide](/guides/react-integration) for a complete example.
:::
