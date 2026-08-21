```tsx
import { Canvas, Shape, type GeometryDoc } from "@boundsvg/core";

const badge: GeometryDoc = {
  viewBox: { width: 140, height: 64 },
  root: {
    kind: "path",
    d: "M12 0H128C134.627 0 140 5.373 140 12V52C140 58.627 134.627 64 128 64H12C5.373 64 0 58.627 0 52V12C0 5.373 5.373 0 12 0Z",
  },
};

<Canvas width={220} height={120} background="#0f172a">
  <Shape geometry={badge} width={180} height={82} fill="#38bdf8" />
</Canvas>;
```

<div class="example-output">
  <img src="/generated/shape-basic.svg" alt="shape-basic example" />
</div>

<details>
<summary>Generated SVG</summary>

```xml
<svg xmlns="http://www.w3.org/2000/svg" data-boundsvg-node-id="auto:0" viewBox="0 0 220 120" width="220" height="120">
  <rect x="0" y="0" width="220" height="120" fill="#0f172a"/>
  <g data-boundsvg-node-id="auto:0.0">
    <svg data-boundsvg-node-id="auto:0.0" x="0" y="0" width="180" height="82" overflow="hidden">
      <path d="M15.43,0L164.57,0C173.09,0 180,6.88 180,15.38L180,66.63C180,75.12 173.09,82 164.57,82L15.43,82C6.91,82 0,75.12 0,66.63L0,15.38C0,6.88 6.91,0 15.43,0Z" fill="#38bdf8"/>
    </svg>
  </g>
</svg>
```

</details>
