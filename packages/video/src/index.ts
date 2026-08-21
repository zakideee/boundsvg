/**
 * Browser MP4 export for boundsvg.
 *
 * Frames are sampled deterministically by `@boundsvg/core`, encoded by the
 * browser's WebCodecs H.264 encoder, and framed by a bundled MP4 muxer. No
 * codec ships with this package, and encoded bytes are outside the byte
 * determinism contract.
 */

export type { PngFrameInput } from "./encode-frames.js";
export type { VideoFrameRate } from "./frame-rate.js";
export type { Mp4ExportOptions, PngFramesMp4ExportOptions } from "./mp4.js";
export { encodePngFramesToMp4, renderCompiledToMp4, renderToMp4 } from "./mp4.js";
export { initVideoWasm } from "./mp4-writer.js";
