# @boundsvg/video

Browser MP4 export for boundsvg — WebCodecs H.264 encoding with a bundled MP4 muxer.

## Installation

```bash
npm install @boundsvg/video
```

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
export that gets reordered or dropped output fails with `VIDEO_SAMPLE_ORDER_INVALID` or
`VIDEO_SAMPLE_COUNT_MISMATCH` rather than
producing a file that plays wrong. Verified on Chrome 134 (Linux).

A single export is capped at 256 MiB of encoded video.

## Errors

Failures throw `FatalError` from `@boundsvg/core`, with `code` set to one of:

| Code                        | Meaning                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `VIDEO_INVALID_FRAME_RATE`  | `frameRate` is not a supported integer, alias, or rational                           |
| `VIDEO_INVALID_SCHEDULE`    | `durationMs` / `timesMs` do not describe a schedule the container can represent      |
| `VIDEO_INVALID_OPTION`      | any other option value — `bitrate`, `background`, `frameCount`                       |
| `VIDEO_INVALID_FRAMES`      | the frames themselves — wrong format, inconsistent size, too few, more than declared |
| `VIDEO_TOO_MANY_FRAMES`     | the export exceeds the 3600-frame ceiling                                            |
| `VIDEO_ENCODER_UNSUPPORTED` | A required runtime capability is missing or the encoder configuration is rejected    |
| `VIDEO_EXPORT_ABORTED`      | the `signal` was aborted                                                             |

Errors raised by the frame sampler propagate unchanged from `@boundsvg/core` — for example
`PNG_PIXEL_LIMIT` when `rasterOversizeBehavior: "error"` — so a `catch` should not assume the
code starts with `VIDEO_`.

Encoded bytes depend on the browser's encoder and are therefore outside the boundsvg byte
determinism contract. What stays deterministic is the input: the PNG frames `renderFrames`
produces. Decoding them, compositing them onto a canvas, and encoding them are all the
browser's work.

## Structured Video diagnostics

Encoder, frame preparation and muxer failures use the existing `FatalError` from
`@boundsvg/core`. These diagnostics have a fixed `code`, `message` and `stage`,
with `domain: "video"`, `category` and `operation` in `context`. Only validated
native muxer failures include `context.reason`. Absent context fields are omitted.
External exception messages, URLs and sample bytes are not copied into diagnostics.

| Code                             | Category             | Stage      | Message                                              |
| -------------------------------- | -------------------- | ---------- | ---------------------------------------------------- |
| `VIDEO_ENCODER_UNSUPPORTED`      | `encoderUnsupported` | `emit`     | Video encoding is unavailable for this configuration |
| `VIDEO_ENCODER_FAILED`           | `encoderFailure`     | `emit`     | Video encoding failed                                |
| `VIDEO_MUXER_LOAD_FAILED`        | `load`               | `wasm`     | MP4 muxer could not be initialized                   |
| `VIDEO_MUXER_ABI_MISMATCH`       | `protocol`           | `wasm`     | MP4 muxer schema does not match this package         |
| `VIDEO_MUXER_INVALID_INPUT`      | `invalidInput`       | `validate` | MP4 muxer input is invalid                           |
| `VIDEO_MUXER_MISSING_INPUT`      | `missingInput`       | `emit`     | MP4 muxer requires an input that was not supplied    |
| `VIDEO_MUXER_INVALID_STATE`      | `invalidState`       | `emit`     | MP4 muxer operation is invalid in its current state  |
| `VIDEO_MUXER_RESOURCE_LIMIT`     | `resource`           | `emit`     | MP4 output exceeds the supported resource limit      |
| `VIDEO_MUXER_ALLOCATION_FAILED`  | `resource`           | `emit`     | MP4 muxer could not allocate output storage          |
| `VIDEO_MUXER_WRITE_FAILED`       | `container`          | `emit`     | MP4 container assembly failed                        |
| `VIDEO_MUXER_PROTOCOL_ERROR`     | `protocol`           | `wasm`     | MP4 muxer returned an invalid failure                |
| `VIDEO_SAMPLE_ORDER_INVALID`     | `sampleOrder`        | `emit`     | Encoded samples are not in presentation order        |
| `VIDEO_SAMPLE_COUNT_MISMATCH`    | `sampleCount`        | `emit`     | Encoded sample count does not match submitted frames |
| `VIDEO_FRAME_PREPARATION_FAILED` | `framePreparation`   | `emit`     | Video frame could not be prepared                    |

```ts
import { FatalError } from "@boundsvg/core";
import { initVideoWasm } from "@boundsvg/video";

try {
  await initVideoWasm();
} catch (error) {
  if (error instanceof FatalError && error.code === "VIDEO_MUXER_LOAD_FAILED") {
    console.error(error.code, error.context?.operation);
  } else {
    throw error;
  }
}
```

Direct `initVideoWasm()` calls now reject with typed load or ABI diagnostics, so
replace raw exception/message matching with `FatalError.code` checks. Failed
initialization can be retried with a later input; concurrent calls share initialization,
and the first successful input remains authoritative. The bundled MP4 glue and binary
must use the same independent schema revision. An ABI mismatch is checked again on
retry; if the generated glue already retains an incompatible instance, load a fresh
module realm with the matching binary. Retrying alone does not replace that instance.

`VIDEO_ENCODER_UNSUPPORTED` now means missing runtime capability or rejected encoder
configuration. Encoding execution failures use `VIDEO_ENCODER_FAILED`; missing input,
invalid input, container assembly, resource limits and sample order/count each have
their own codes. Capability checks occur when used, preserving bitmap → canvas →
encoder ordering. A failed or finished container writer cannot be reused. Cleanup
does not replace a primary failure. Frame-producer, progress and warning callback
failures propagate unchanged, so not every failure has a `VIDEO_` code.

## Documentation

Full documentation: <https://github.com/zakideee/boundsvg>

## License

MIT OR Apache-2.0

The bundled MP4 muxer wasm includes [shiguredo_mp4](https://github.com/shiguredo/mp4-rs)
(Apache-2.0). Video is encoded by the browser's own codec implementation; no codec ships with
this package.
