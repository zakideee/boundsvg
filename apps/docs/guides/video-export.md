---
title: Video Export
---

# Video Export

boundsvg ships no video codec. H.264 carries patents and ffmpeg is LGPL/GPL, and
neither belongs inside an MIT-licensed engine. What boundsvg provides is the
deterministic part — the PNG frame sequence — and two ways to hand it to an
encoder that is already on the machine.

| Where      | Encoder                                    | Package                         |
| ---------- | ------------------------------------------ | ------------------------------- |
| Browser    | The browser's own WebCodecs `VideoEncoder` | `@boundsvg/video` (opt-in)      |
| Node / CLI | An ffmpeg you installed                    | `@boundsvg/cli`, `--format mp4` |

Cloudflare Workers has no WebCodecs, so browser MP4 export does not run there.

## Browser

```bash
npm install @boundsvg/video
```

```ts
import { renderToMp4 } from "@boundsvg/video";

const mp4: Uint8Array = await renderToMp4(engine, scene, {
  durationMs: 2000,
  frameRate: 30,
});
```

`renderToMp4` samples the animation through the same deterministic frame
sampler `renderFrames` uses, encodes each frame with the browser's H.264
encoder, and writes the container with a small bundled muxer wasm. The muxer is
the only binary that ships; the codec is the browser's.

To encode a frame sequence you already have — from a worker, or from a previous
run — use `encodePngFramesToMp4` instead:

```ts
import { encodePngFramesToMp4 } from "@boundsvg/video";

const mp4 = await encodePngFramesToMp4(frames, { frameRate: 30 });
```

### Requirements

WebCodecs `VideoEncoder` with H.264 support. Feature-detect before offering the
option, rather than failing on click:

```ts
if (typeof VideoEncoder !== "undefined") {
  // MP4 export is possible; a browser can still refuse the codec itself,
  // which surfaces as VIDEO_ENCODER_UNSUPPORTED.
}
```

## Node and the CLI

Install ffmpeg yourself — boundsvg neither bundles nor downloads it.

```bash
# macOS
brew install ffmpeg
# Ubuntu
sudo apt install ffmpeg
# Windows
winget install Gyan.FFmpeg
```

```bash
boundsvg export --input scene.svg --output out.mp4 --format mp4 \
  --default-font NotoSansJP --font NotoSansJP:400:normal:./NotoSansJP.ttf \
  --duration-ms 2000
```

ffmpeg comes from `FFMPEG_PATH` when that is set, and otherwise from `PATH`. It
is not a fallback chain: an `FFMPEG_PATH` that does not run is an error rather
than a reason to try `PATH`. `boundsvg doctor` reports the command it tried; a
missing ffmpeg is reported there as information, not as a failed check, since
only this one format needs it.

### 29.97fps and the other NTSC rates

The NTSC rates are not decimals. 29.97fps is exactly 30000/1001, and no decimal
expresses it — an export that rounds drifts against its own timeline.

`--fps` therefore accepts a whole number, one of the NTSC aliases, or an
explicit rational:

```bash
boundsvg export ... --format mp4 --duration-ms 2000 --fps 30000/1001
boundsvg export ... --format mp4 --duration-ms 2000 --fps 29.97      # same thing
```

Any other decimal is refused rather than approximated. The browser exporter
takes the same three forms — `frameRate: 29.97` or
`frameRate: { numerator: 30000, denominator: 1001 }`.

The browser exporter writes the container itself, so it can be exact by
construction: `timescale = numerator`, every sample lasting `denominator` ticks.
A 3600-frame 30000/1001 clip lands on `3600 × 1001` ticks with no residue.

The CLI hands ffmpeg the rational rate as `-framerate 30000/1001` and ffmpeg
owns the container, including which timebase it writes — a 30fps export comes
out with timescale 15360 and a delta of 512, not 30 and 1. The rate is still
exact; the timescale is simply ffmpeg's to choose.

## Determinism

**Encoded video is outside the byte determinism contract.** The bytes depend on
the encoder that produced them — a browser version, a hardware encoder, an
ffmpeg build. Two runs on different machines will not match.

What stays deterministic is the input: the PNG frames the sampler produces.
Decoding, compositing and encoding them are the platform's work. See the
[Determinism Contract](/reference/determinism).

## Limits

- H.264 only. No VP9, AV1, or WebM.
- Video only — no audio track.
- H.264 in yuv420 needs even dimensions and carries no alpha, so frames are
  padded to even sizes on the right and bottom and composited over an opaque
  background. The browser exporter takes a `background` option, default
  `#ffffff`, and rejects a translucent one rather than compositing it against
  black; the CLI always pads with white.
- 3600 frames per export on both paths. A `durationMs` too short to fill two
  frames rounds up to two rather than being refused, on both paths as well; the
  browser exporter refuses a shorter schedule only when you supply the frames or
  the times yourself.
- 120fps ceiling on both paths.
- No variable frame rate, and no fragmented MP4.
- The browser exporter caps one export at 256 MiB of encoded video.
- The CLI cannot write MP4 to stdout: the faststart pass has to seek.

In the **browser** exporter the default codec string is `avc1.640028` — H.264
High profile, **level 4.0**, which covers 1080p30. Larger or faster exports need
a higher level, or the browser rejects the configuration with
`VIDEO_ENCODER_UNSUPPORTED`. The CLI has no equivalent flag; libx264 picks its
own level.

```ts
await renderToMp4(engine, scene, {
  durationMs: 2000,
  frameRate: 60,
  codec: "avc1.640033", // level 5.1 — 1080p60, 4K
});
```

The browser path additionally requires one encoded sample per frame, in order.
A platform that emits B-frames or drops frames fails the export with
`VIDEO_ENCODER_UNSUPPORTED` rather than producing a file that plays wrong.
