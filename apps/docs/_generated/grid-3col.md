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
          <path d="M17.41,31.68L17.41,30.46L20.03,30.46L20.03,21.71L17.94,21.71L17.94,20.78Q18.72,20.64 19.3,20.43Q19.89,20.22 20.37,19.95L21.49,19.95L21.49,30.46L23.84,30.46L23.84,31.68L17.41,31.68Z" fill="#fff"/>
        </g>
      </g>
    </g>
    <g data-boundsvg-node-id="auto:0.0.1">
      <rect x="143" y="16" width="114" height="168" rx="8" ry="8" fill="#8b5cf6"/>
      <g data-boundsvg-node-id="auto:0.0.1.0">
        <g data-boundsvg-node-id="auto:0.0.1.0" data-boundsvg-text="2" aria-label="2">
          <path d="M143.7,31.68L143.7,30.82Q145.54,29.2 146.74,27.87Q147.93,26.54 148.5,25.4Q149.08,24.26 149.08,23.25Q149.08,22.58 148.85,22.05Q148.62,21.52 148.14,21.22Q147.66,20.93 146.92,20.93Q146.2,20.93 145.58,21.31Q144.97,21.7 144.49,22.29L143.64,21.46Q144.34,20.67 145.16,20.21Q145.98,19.74 147.1,19.74Q148.15,19.74 148.91,20.17Q149.67,20.59 150.1,21.37Q150.52,22.14 150.52,23.18Q150.52,24.35 149.94,25.55Q149.35,26.75 148.32,27.99Q147.29,29.23 145.91,30.53Q146.38,30.5 146.88,30.46Q147.38,30.42 147.83,30.42L151.08,30.42L151.08,31.68L143.7,31.68Z" fill="#fff"/>
        </g>
      </g>
    </g>
    <g data-boundsvg-node-id="auto:0.0.2">
      <rect x="269" y="16" width="115" height="168" rx="8" ry="8" fill="#ec4899"/>
      <g data-boundsvg-node-id="auto:0.0.2.0">
        <g data-boundsvg-node-id="auto:0.0.2.0" data-boundsvg-text="3" aria-label="3">
          <path d="M273.21,31.89Q272.3,31.89 271.6,31.66Q270.9,31.44 270.38,31.07Q269.85,30.7 269.46,30.27L270.22,29.33Q270.73,29.86 271.42,30.26Q272.12,30.67 273.11,30.67Q273.82,30.67 274.35,30.41Q274.89,30.14 275.19,29.66Q275.5,29.17 275.5,28.5Q275.5,27.79 275.15,27.26Q274.81,26.74 274.01,26.44Q273.21,26.14 271.85,26.14L271.85,25.02Q273.06,25.02 273.77,24.73Q274.47,24.43 274.78,23.92Q275.1,23.41 275.1,22.78Q275.1,21.94 274.57,21.43Q274.04,20.93 273.11,20.93Q272.41,20.93 271.79,21.25Q271.18,21.57 270.68,22.06L269.9,21.14Q270.57,20.53 271.36,20.14Q272.15,19.74 273.16,19.74Q274.15,19.74 274.93,20.09Q275.7,20.43 276.14,21.09Q276.58,21.74 276.58,22.67Q276.58,23.74 276.01,24.45Q275.43,25.15 274.5,25.49L274.5,25.57Q275.19,25.73 275.75,26.13Q276.31,26.53 276.65,27.14Q276.98,27.74 276.98,28.54Q276.98,29.58 276.47,30.34Q275.96,31.09 275.11,31.49Q274.26,31.89 273.21,31.89Z" fill="#fff"/>
        </g>
      </g>
    </g>
  </g>
</svg>
```

</details>
