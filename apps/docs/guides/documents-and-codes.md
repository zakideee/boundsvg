---
title: Documents & Codes
---

# Documents & Codes

boundsvg suits fixed-layout documents — receipts, certificates, labels, name
cards — where you need deterministic output and precise text fitting. This
guide shows the layout patterns and how to embed QR codes and barcodes.

boundsvg does not generate codes itself (that stays a zero-dependency
decision); you generate the code with a dedicated library and embed the result
as an `<Image>` (PNG/JPEG bytes) or `<Svg>` (SVG markup).

## A receipt layout

`Flex` with `direction="column"` gives you a vertical document; `justifyContent`
and borders handle rules and spacing. `fit="shrink"` keeps a long store name or
item title inside its box instead of overflowing.

```tsx
<Canvas width={380} height={560} background="#ffffff">
  <Flex direction="column" width={380} height={560} padding={24} gap={12}>
    <Text font="NotoSansJP" fontSizePx={22} fit="shrink" width={332}>
      ○○ストア 渋谷店
    </Text>
    <Text font="NotoSansJP" fontSizePx={12} color="#666666">
      2026-07-06 14:32 レジ #3
    </Text>

    <Box height={1} background="#000000" />

    <Flex direction="row" justifyContent="space-between" width={332}>
      <Text font="NotoSansJP" fontSizePx={14}>
        珈琲豆 200g
      </Text>
      <Text font="JetBrainsMono" fontSizePx={14}>
        ¥1,280
      </Text>
    </Flex>
    <Flex direction="row" justifyContent="space-between" width={332}>
      <Text font="NotoSansJP" fontSizePx={14}>
        フィルター
      </Text>
      <Text font="JetBrainsMono" fontSizePx={14}>
        ¥480
      </Text>
    </Flex>

    <Box height={1} background="#000000" />

    <Flex direction="row" justifyContent="space-between" width={332}>
      <Text font="NotoSansJP" fontSizePx={16} fontWeight={700}>
        合計
      </Text>
      <Text font="JetBrainsMono" fontSizePx={16} fontWeight={700}>
        ¥1,760
      </Text>
    </Flex>
  </Flex>
</Canvas>
```

## Embedding a QR code (SVG)

Generate the QR as an SVG string, then embed it with `<Svg>`. SVG stays crisp at
any scale. Note the [determinism contract](/reference/determinism): a QR that is
pure `<path>`/`<rect>` (as most generators emit) is fully covered; avoid `<text>`
inside embedded SVG.

```tsx
import QRCode from "qrcode"; // any generator that outputs an SVG string

const qrSvg = await QRCode.toString("https://example.com/receipt/abc123", {
  type: "svg",
  margin: 0,
});

<Canvas width={200} height={240} background="#ffffff">
  <Flex
    direction="column"
    alignItems="center"
    width={200}
    height={240}
    padding={16}
    gap={8}
  >
    <Svg content={qrSvg} width={160} height={160} />
    <Text font="JetBrainsMono" fontSizePx={12} color="#333333">
      abc123
    </Text>
  </Flex>
</Canvas>;
```

## Embedding a barcode (PNG bytes)

If your generator produces raster bytes, pass them to `<Image>` with the matching
`mediaType`. `objectFit="contain"` keeps the aspect ratio inside the box.

```tsx
const barcodePng: Uint8Array = await generateBarcodePng("4901234567894");

<Image
  src={barcodePng}
  mediaType="image/png"
  width={280}
  height={80}
  objectFit="contain"
/>;
```

For raster output (`renderToPng`, `renderToWebp`, and the animated variants),
embedded raster images decode as PNG, JPEG, WebP, or GIF — AVIF is not
supported.

## Tips

- Prefer SVG codes over raster when you can — they scale losslessly and keep the
  output within the determinism contract.
- Use a **monospace** font (JetBrains Mono) for amounts and codes so digits align
  in columns.
- `fit="shrink"` on variable-length fields (store names, product titles) prevents
  overflow without manual truncation; add `ellipsis` with `maxLines` when you'd
  rather clip than shrink.
- Generate at the final pixel size and pin the boundsvg version if you snapshot
  the output — see [Versioning & Stability](/getting-started/versioning).
