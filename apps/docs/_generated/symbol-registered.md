```tsx
import {
  Canvas,
  Symbol,
  createEngineAsync,
  type SymbolDefinition,
} from "@boundsvg/core";

const arrow: SymbolDefinition = {
  geometry: {
    viewBox: { width: 100, height: 20 },
    root: {
      kind: "group",
      children: [
        { kind: "path", nodeId: "tail", d: "M0 8H10V12H0Z" },
        { kind: "path", nodeId: "shaft", d: "M10 8H70V12H10Z" },
        { kind: "path", nodeId: "head", d: "M70 4L100 10L70 16Z" },
      ],
    },
  },
  elasticSegments: [
    {
      nodeId: "tail",
      axis: "x",
      role: "fixed-start",
      frame: { x: 0, y: 0, width: 10, height: 20 },
    },
    {
      nodeId: "shaft",
      axis: "x",
      role: "stretch",
      frame: { x: 10, y: 0, width: 60, height: 20 },
    },
    {
      nodeId: "head",
      axis: "x",
      role: "fixed-end",
      frame: { x: 70, y: 0, width: 30, height: 20 },
    },
  ],
};

const engine = await createEngineAsync({});
engine.registerSymbol("arrow", arrow);

<Canvas width={280} height={120} background="#111827">
  <Symbol symbolId="arrow" width={220} height={24} fill="#f8fafc" />
</Canvas>;
```

<div class="example-output">
  <img src="/generated/symbol-registered.svg" alt="symbol-registered example" />
</div>

<details>
<summary>Generated SVG</summary>

```xml
<svg xmlns="http://www.w3.org/2000/svg" data-boundsvg-node-id="auto:0" viewBox="0 0 280 120" width="280" height="120">
  <rect x="0" y="0" width="280" height="120" fill="#111827"/>
  <g data-boundsvg-node-id="auto:0.0">
    <svg data-boundsvg-node-id="auto:0.0" x="0" y="0" width="220" height="24" overflow="hidden">
      <path d="M0,9.6L10,9.6L10,14.4L0,14.4Z M10,9.6L190,9.6L190,14.4L10,14.4Z M190,4.8L220,12L190,19.2Z" fill="#f8fafc"/>
    </svg>
  </g>
</svg>
```

</details>
