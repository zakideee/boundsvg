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

## Scene input validation

For `.scene.json` input, file and option errors are handled first, followed by
JSON syntax, recursive Scene structure, and then conversion or rendering. A
syntax failure is reported as `Invalid JSON in input`. A structurally invalid
document preserves the Core `FatalError` code and fixed message, for example:

```text
Error: Invalid SceneDocument: [SCENE_DECODE_MISSING_FIELD] Scene document is missing a required field.
```

The parsed document is decoded once and the resulting VNode is reused by the
CLI operation. Library callers can use the direct converter, which also runs
one recursive decode before code generation:

```ts
import { convertSceneToComponent } from "@boundsvg/cli";

const { code, warnings } = convertSceneToComponent(scene, options);
```

This rejects malformed nested children, unknown fields, unsafe property
descriptors, cycles, and resource-limit excesses before generation.

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
`--fps` accepts finite decimal rates in 1–60 (default 20), without rounding
down. A positive finite `--duration-ms` is required; fractional and positive
subnormal durations use the same sampled schedule rules as Core. `--iterations` is a total-play count: use
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

## Animated raster storage

Animated file exports stream into a dedicated temporary file in the destination
directory, patch WebP after encoding, then atomically replace the specified
pathname with rename. The prior destination is preserved until successful
rename. Existing regular-file permission bits (`mode & 0o7777`) are captured at
sink open and applied after writes/patches and before close/rename, preserving
bits that the creation umask would otherwise remove.

Replacement changes pathname identity: a final symlink is replaced itself,
while another hardlink keeps the old inode and its old contents. Inode, owner,
ACL, xattr, exclusion of competing process updates, and power-loss durability
are not preserved or guaranteed. The parent directory needs write/rename
permission, which differs from the former direct file write. Abort removes only
the sink's uncommitted temporary file; it does not delete output after rename.
Static output IO is unchanged.

The Node adapter is available separately for application callers:

```ts
import { createAnimatedRasterFileSink } from "@boundsvg/cli/animation";

const sink = await createAnimatedRasterFileSink("animation.webp");
try {
  const result = await engine.renderToAnimatedWebp(
    scene,
    {
      durationMs: 2000,
      fps: 23.976,
      iterations: 1,
    },
    sink,
  );
} catch (error) {
  await sink.abort(error);
  throw error;
}
```

`createAnimatedRasterSpool(directoryPath?)` in the same entry creates owned
patchable temporary storage. Core's `createAnimatedWebpSpoolSink` forwards that
storage to a sequential sink after patching. Animated WebP stdout uses a spool;
GIF can stream directly. Stdout honors backpressure and deferred write errors,
but already written stdout bytes cannot be rolled back. The exporter does not
end or destroy the caller's stdout stream.

Dry run obtains file length from the filesystem instead of collecting animated
output. Watch exports serialize animation jobs per Engine and coalesce repeated
changes to each path into its latest pending update. Animated output has no
fixed frame-count or aggregate-SVG cap; representation limits and existing
raster limits still apply. An explicit Core memory collector retains its own
256 MiB limit.

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
