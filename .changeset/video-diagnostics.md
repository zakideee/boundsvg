---
"@boundsvg/video": minor
---

Report encoder, frame preparation, MP4 initialization, input, state, resource, container and sample-order failures through stable FatalError codes and bounded Video context. VIDEO_ENCODER_UNSUPPORTED now describes missing capabilities or rejected configurations; execution and muxing failures have separate codes.

Direct initVideoWasm failures now use VIDEO_MUXER_LOAD_FAILED or VIDEO_MUXER_ABI_MISMATCH. Match codes instead of raw messages. Failed initialization can be retried, but an incompatible instance retained by generated glue requires a fresh module realm with matching MP4 glue and binary. Successful output for identical encoded samples is unchanged.
