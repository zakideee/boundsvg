```tsx
<Canvas width={400} height={200} background="#0f172a">
  <Grid
    templateColumns="1fr 1fr 1fr"
    gap={12}
    width={400}
    height={200}
    padding={16}
  >
    <Box background="#3b82f6" borderRadius={8}>
      <Text font="NotoSansJP" fontSizePx={16} color="#fff">
        1
      </Text>
    </Box>
    <Box background="#8b5cf6" borderRadius={8}>
      <Text font="NotoSansJP" fontSizePx={16} color="#fff">
        2
      </Text>
    </Box>
    <Box background="#ec4899" borderRadius={8}>
      <Text font="NotoSansJP" fontSizePx={16} color="#fff">
        3
      </Text>
    </Box>
  </Grid>
</Canvas>
```

<div class="example-output">
  <img src="/generated/grid-3col.svg" alt="grid-3col example" />
</div>

<details>
<summary>Generated SVG</summary>

```xml
<svg xmlns="http://www.w3.org/2000/svg" data-boundsvg-node-id="auto:0" viewBox="0 0 400 200" width="400" height="200">
  <rect x="0" y="0" width="400" height="200" fill="#0f172a"/>
  <g data-boundsvg-node-id="auto:0.0">
    <g data-boundsvg-node-id="auto:0.0.0">
      <rect x="16" y="16" width="115" height="168" rx="8" ry="8" fill="#3b82f6"/>
      <g data-boundsvg-node-id="auto:0.0.0.0">
        <g data-boundsvg-node-id="auto:0.0.0.0" data-boundsvg-text="1" aria-label="1">
          <path d="M17.41 31.68V30.46h2.62V21.71H17.94v-.93q.78-.14 1.36-.35.59-.21 1.07-.48h1.12V30.46h2.35v1.22z" fill="#fff"/>
        </g>
      </g>
    </g>
    <g data-boundsvg-node-id="auto:0.0.1">
      <rect x="143" y="16" width="114" height="168" rx="8" ry="8" fill="#8b5cf6"/>
      <g data-boundsvg-node-id="auto:0.0.1.0">
        <g data-boundsvg-node-id="auto:0.0.1.0" data-boundsvg-text="2" aria-label="2">
          <path d="M143.7 31.68v-.86q1.84-1.62 3.04-2.95q1.19-1.33 1.76-2.47.58-1.14.58-2.15q0-.67-.23-1.2t-.71-.83q-.48-.29-1.22-.29-.72 0-1.34.38-.61.39-1.09.98l-.85-.83q.7-.79 1.52-1.25.82-.47 1.94-.47q1.05 0 1.81.43.76.42 1.19 1.2.42.77.42 1.81q0 1.17-.58 2.37-.59 1.2-1.62 2.44t-2.41 2.54q.47-.03.97-.07t.95-.04h3.25v1.26z" fill="#fff"/>
        </g>
      </g>
    </g>
    <g data-boundsvg-node-id="auto:0.0.2">
      <rect x="269" y="16" width="115" height="168" rx="8" ry="8" fill="#ec4899"/>
      <g data-boundsvg-node-id="auto:0.0.2.0">
        <g data-boundsvg-node-id="auto:0.0.2.0" data-boundsvg-text="3" aria-label="3">
          <path d="M273.21 31.89q-.91 0-1.61-.23-.7-.22-1.22-.59-.53-.37-.92-.8l.76-.94q.51.53 1.2.93.7.41 1.69.41.71 0 1.24-.26.54-.27.84-.75.31-.49.31-1.16q0-.71-.35-1.24-.34-.52-1.14-.82t-2.16-.3V25.02q1.21 0 1.92-.29.7-.3 1.01-.81.32-.51.32-1.14q0-.84-.53-1.35-.53-.5-1.46-.5-.7 0-1.32.32-.61.32-1.11.81l-.78-.92q.67-.61 1.46-1q.79-.4 1.8-.4.99 0 1.77.35.77.34 1.21 1q.44.65.44 1.58q0 1.07-.57 1.78-.58.7-1.51 1.04v.08q.69.16 1.25.56t.9 1.01q.33.6.33 1.4q0 1.04-.51 1.8-.51.75-1.36 1.15t-1.9.4z" fill="#fff"/>
        </g>
      </g>
    </g>
  </g>
</svg>
```

</details>
