```tsx
<Canvas width={400} height={100} background="#0f172a">
  <Flex
    direction="row"
    justifyContent="space-between"
    alignItems="center"
    width={400}
    height={100}
    padding={16}
  >
    <Box width={60} height={60} background="#3b82f6" borderRadius={8} />
    <Box width={60} height={60} background="#8b5cf6" borderRadius={8} />
    <Box width={60} height={60} background="#ec4899" borderRadius={8} />
  </Flex>
</Canvas>
```

<div class="example-output">
  <img src="/generated/flex-space-between.svg" alt="flex-space-between example" />
</div>

<details>
<summary>Generated SVG</summary>

```xml
<svg xmlns="http://www.w3.org/2000/svg" data-boundsvg-node-id="auto:0" viewBox="0 0 400 100" width="400" height="100">
  <rect x="0" y="0" width="400" height="100" fill="#0f172a"/>
  <g data-boundsvg-node-id="auto:0.0">
    <g data-boundsvg-node-id="auto:0.0.0">
      <rect x="16" y="20" width="60" height="60" rx="8" ry="8" fill="#3b82f6"/>
    </g>
    <g data-boundsvg-node-id="auto:0.0.1">
      <rect x="170" y="20" width="60" height="60" rx="8" ry="8" fill="#8b5cf6"/>
    </g>
    <g data-boundsvg-node-id="auto:0.0.2">
      <rect x="324" y="20" width="60" height="60" rx="8" ry="8" fill="#ec4899"/>
    </g>
  </g>
</svg>
```

</details>
