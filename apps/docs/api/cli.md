---
title: CLI Diagnostics
---

# CLI Diagnostics

Use CLI diagnostics when your input starts as an SVG file or `.scene.json` and you need a report before committing generated assets.

## `boundsvg inspect`

```bash
boundsvg inspect \
  --input card.svg \
  --default-font NotoSansJP \
  --font NotoSansJP:400:normal:./fonts/NotoSansJP-Regular.ttf \
  --output-format json
```

`inspect` builds the same VNode input as `export`, then reports canvas size, node counts, draw order, node ID validation, warnings, missing glyph counts, overflow text node counts, and bboxes.

## `boundsvg doctor`

```bash
boundsvg doctor \
  --font NotoSansJP:400:normal:./fonts/NotoSansJP-Regular.ttf
```

`doctor` checks Node WASM initialization, the font files passed with `--font`, and whether an ffmpeg is available for `--format mp4`. It is a local environment check, not a replacement for rendering a scene. A missing ffmpeg is reported, not failed — only MP4 export needs one.

## Export Reports

```bash
boundsvg export \
  --input card.scene.json \
  --font NotoSansJP:400:normal:./fonts/NotoSansJP-Regular.ttf \
  --report card.report.json
```

Use `--report <file>` when a CI job should keep the diagnostics as an artifact. Use `--inspect` when a local export should print the JSON report to stderr while still writing the rendered SVG or PNG.

## WebP, GIF and MP4 Export

```bash
boundsvg export \
  --input card.scene.json \
  --font NotoSansJP:400:normal:./fonts/NotoSansJP-Regular.ttf \
  --format webp \
  --output card.webp
```

`--format webp` writes a lossless (VP8L) still image. When `--input` is a file
and `--format` is omitted, an output path ending in `.webp`, `.gif` or `.mp4`
selects that format on its own.

Animated output samples a declarative animation and needs `--duration-ms`:

```bash
boundsvg export \
  --input card.scene.json \
  --font NotoSansJP:400:normal:./fonts/NotoSansJP-Regular.ttf \
  --format animated-webp \
  --duration-ms 2000 --fps 20 --iterations infinite \
  --output card.webp
```

`--format gif` writes an animated GIF instead. For `animated-webp` and `gif`,
`--fps` is 1–60 (default 20). `--iterations` is a total-play count: use
`1`–`65535` for animated WebP, `1`–`65536` for GIF, or `infinite`; omission
defaults to `infinite`. `--duration-ms`, `--fps`, `--iterations` and `--bitrate`
are usage errors on a still format. `--scale` applies to every raster format.
This omission default is CLI-only: the Core and Worker animated-raster APIs
require callers to supply `iterations` explicitly.

`--format mp4` differs on all three: `--fps` goes up to 120 (default 30) and
also accepts the NTSC decimals `23.976` / `29.97` / `59.94` and a rational such
as `30000/1001`; `--iterations` is refused, because video has no play-count
field; and
`--bitrate` applies only here. See [Video Export](/guides/video-export).

The removed `--loop` flag is a migration error, not an alias. Convert old
values as follows:

| Format        | Old value           | Replacement             |
| ------------- | ------------------- | ----------------------- |
| animated WebP | `--loop 0`          | `--iterations infinite` |
| animated WebP | `--loop N`, `N > 0` | `--iterations N`        |
| GIF           | `--loop 0`          | `--iterations infinite` |
| GIF           | `--loop N`, `N > 0` | `--iterations N+1`      |

Because `animated-webp` and `webp` share the `.webp` extension, animated WebP
always needs the explicit `--format`. `.gif` is unambiguous — there is no still
GIF format — so a `.gif` output path is enough.

## Layered Export

`--format layered-svg` and `--format layered-png` emit a directory of per-layer files plus a `manifest.json`. See the [Layered Export guide](/guides/layered-export) for the conceptual model.

```bash
boundsvg export \
  --format layered-svg \
  --input card.scene.json \
  --font NotoSansJP:400:normal:./fonts/NotoSansJP-Regular.ttf \
  --output out/card.layers
```

```
out/card.layers/
├── manifest.json
├── 000-background.svg
├── 001-textBox.svg
└── 002-text.svg
```

Each layer file name is `NNN-<sanitized-id>.<ext>`, where `NNN` is the layer's zero-padded position in the back-to-front `layers` array — its index, not its `paintOrder` value (the layer's lowest index into `ir.drawOrder`; that sequence counts draw operations rather than layers — one node can emit several, and some entries belong to no layer at all, so the index and `paintOrder` can diverge) — and the id is reduced to `[A-Za-z0-9_-]` with `-` replacing anything else and runs of `-` collapsed to one; case is preserved. An id with no allowed characters becomes `-` (`日本語` → `001--.svg`), never empty. Join on each layer's `fileName` in `manifest.json` rather than rebuilding the name. stdout is not supported for layered formats.

`manifest.json` for `layered-svg`:

```json
{
  "width": 320,
  "height": 180,
  "layers": [
    {
      "id": "background",
      "fileName": "000-background.svg",
      "mode": "independent",
      "paintOrder": 0,
      "nodeIds": ["bg"],
      "bbox": { "x": 0, "y": 0, "width": 320, "height": 180 },
      "warnings": []
    }
  ]
}
```

`manifest.json` for `layered-png` adds `pixelWidth` / `pixelHeight` at the top level, matching the rasterized output resolution after `--scale` resolution.
