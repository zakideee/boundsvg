import type {
  AnimatedRasterWriteResult,
  AnimatedWebpSink,
  CompiledScene,
  Engine,
  RenderCompiledAnimatedWebpOptions,
} from "../../dist/index.js";

/** Type-only engine fixture for checking compiled animation signatures. */
declare const engine: Engine;
/** Type-only compiled scene fixture for checking animation calls. */
declare const compiled: CompiledScene;
/** Type-only seek-and-patch WebP sink required by the compiled animation call. */
declare const sink: AnimatedWebpSink;

/** Accepted compiled animation schedule, iteration, and scale options. */
const options: RenderCompiledAnimatedWebpOptions = {
  timesMs: [0, 300, 700, 1_000],
  frameDurationsMs: [300, 400, 300, 100],
  iterations: 2,
  scale: 2,
};
/** Promise result witness for metadata returned by sink-based animated rendering. */
const completed: Promise<AnimatedRasterWriteResult> = engine.renderCompiledToAnimatedWebp(
  compiled,
  options,
  sink,
);
void completed;

// @ts-expect-error animated rendering requires an explicit output sink
engine.renderCompiledToAnimatedWebp(compiled, options);
/** Rejected byte-return assignment used to check the sink-based result contract. */
// @ts-expect-error the asynchronous result is metadata rather than encoded bytes
const bytes: Uint8Array = engine.renderCompiledToAnimatedWebp(compiled, options, sink);
void bytes;

/** Rejected source-validation option on a compiled animation request. */
const invalidCompiledValidation: RenderCompiledAnimatedWebpOptions = {
  durationMs: 1_000,
  iterations: "infinite",
  // @ts-expect-error validation is a source-input concern
  skipValidation: true,
};
void invalidCompiledValidation;

/** Rejected text-path option that is fixed when the scene is compiled. */
const invalidCompiledTextPathMode: RenderCompiledAnimatedWebpOptions = {
  durationMs: 1_000,
  iterations: "infinite",
  // @ts-expect-error textPathMode is fixed on CompiledScene
  textPathMode: "glyphs",
};
void invalidCompiledTextPathMode;

/** Rejected animation request without an explicit total-play count. */
// @ts-expect-error animated raster total plays must be explicit
const missingIterations: RenderCompiledAnimatedWebpOptions = { durationMs: 1_000 };
void missingIterations;
