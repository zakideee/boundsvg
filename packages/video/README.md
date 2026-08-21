# @boundsvg/video

Browser MP4 export for boundsvg — WebCodecs H.264 encoding with a bundled MP4 muxer.

## Installation

> Not yet published to npm — build from source. See the [monorepo README](https://github.com/zakideee/boundsvg) for setup instructions.

## Usage

```ts
import { renderToMp4 } from "@boundsvg/video";

const mp4 = await renderToMp4(engine, scene, {
  durationMs: 3000,
  frameRate: 30,
});
```

Fractional NTSC rates are given in their exact rational form (or by alias):

```ts
const mp4 = await renderToMp4(engine, scene, {
  durationMs: 3000,
  frameRate: { numerator: 30000, denominator: 1001 }, // same as 29.97
});
```

An existing PNG frame sequence — from a worker pool, for instance — can be encoded directly:

```ts
import { encodePngFramesToMp4 } from "@boundsvg/video";

const mp4 = await encodePngFramesToMp4(frames, {
  frameRate: 30,
  frameCount: frames.length,
});
```

`frameCount` is optional. Without it the container index is sized for the 3600-frame ceiling,
which leaves roughly 59 KB of padding in the file; passing the real count removes it. A stream
longer than the declared count is rejected at that frame.

Every frame must be the same size — the first one fixes the output dimensions.

## Loading the muxer wasm

The bundled muxer binary is loaded on first use from `boundmp4_bg.wasm` next to the package's
own module. When a bundler moves the module without the binary, point the loader at it before
exporting anything:

```ts
import { initVideoWasm } from "@boundsvg/video";
import wasmUrl from "@boundsvg/video/dist/boundmp4_bg.wasm?url";

await initVideoWasm(new URL(wasmUrl, import.meta.url));
```

`initVideoWasm` also accepts a `Response`, a `WebAssembly.Module`, or the raw bytes. Calling it
is optional and idempotent; a failed load can be retried.

## Requirements

Browsers only. The encoder is the browser's own WebCodecs `VideoEncoder`, which Node.js and
Cloudflare Workers do not provide. Node-side MP4 export through an external ffmpeg lives in
`@boundsvg/cli` (`--format mp4`).

H.264 in yuv420 carries no alpha and needs even dimensions, so frames are padded to even sizes
and composited over `background` (default `#ffffff`). A translucent `background` is rejected
rather than silently composited against black.

The default codec string is `avc1.640028` — H.264 High profile, level 4.0, which covers 1080p30.
Larger or faster exports need a higher level, e.g. `codec: "avc1.640033"` (5.1) for 1080p60 or
4K; otherwise the browser rejects the configuration.

One encoded sample per frame, in order, is required: the container gives every sample the same
duration, so it cannot express the reordering an encoder emitting B-frames would produce. An
export that gets reordered or dropped output fails with `VIDEO_ENCODER_UNSUPPORTED` rather than
producing a file that plays wrong. Verified on Chrome 134 (Linux).

A single export is capped at 256 MiB of encoded video.

## Errors

Failures throw `FatalError` from `@boundsvg/core`, with `code` set to one of:

| Code                        | Meaning                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `VIDEO_INVALID_FRAME_RATE`  | `frameRate` is not a supported integer, alias, or rational                                       |
| `VIDEO_INVALID_SCHEDULE`    | `durationMs` / `timesMs` do not describe a schedule the container can represent                  |
| `VIDEO_INVALID_OPTION`      | any other option value — `bitrate`, `background`, `frameCount`                                   |
| `VIDEO_INVALID_FRAMES`      | the frames themselves — wrong format, inconsistent size, too few, more than declared             |
| `VIDEO_TOO_MANY_FRAMES`     | the export exceeds the 3600-frame ceiling                                                        |
| `VIDEO_ENCODER_UNSUPPORTED` | WebCodecs is missing, rejects the configuration, or produces output the container cannot express |
| `VIDEO_EXPORT_ABORTED`      | the `signal` was aborted                                                                         |

Errors raised by the frame sampler propagate unchanged from `@boundsvg/core` — for example
`PNG_PIXEL_LIMIT` when `rasterOversizeBehavior: "error"` — so a `catch` should not assume the
code starts with `VIDEO_`.

Encoded bytes depend on the browser's encoder and are therefore outside the boundsvg byte
determinism contract. What stays deterministic is the input: the PNG frames `renderFrames`
produces. Decoding them, compositing them onto a canvas, and encoding them are all the
browser's work.

## Documentation

Full documentation: <https://github.com/zakideee/boundsvg>

## License

MIT OR Apache-2.0

The bundled MP4 muxer wasm includes [shiguredo_mp4](https://github.com/shiguredo/mp4-rs)
(Apache-2.0). Video is encoded by the browser's own codec implementation; no codec ships with
this package.
