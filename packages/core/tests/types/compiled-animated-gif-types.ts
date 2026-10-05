import type {
  AnimatedRasterSink,
  AnimatedRasterWriteResult,
  CompiledScene,
  Engine,
  EngineOptions,
  RenderCompiledAnimatedGifOptions,
} from "../../dist/index.js";

/** Type-only engine fixture for checking compiled animation signatures. */
declare const engine: Engine;
/** Type-only compiled scene fixture for checking animation calls. */
declare const compiled: CompiledScene;
/** Type-only forward GIF sink required by the compiled animation call. */
declare const sink: AnimatedRasterSink;

/** Accepted compiled animation schedule, iteration, and scale options. */
const options: RenderCompiledAnimatedGifOptions = {
  timesMs: [0, 300, 700, 1_000],
  frameDurationsMs: [300, 400, 300, 100],
  iterations: 2,
  scale: 2,
};
/** Promise result witness for metadata returned by sink-based animated rendering. */
const completed: Promise<AnimatedRasterWriteResult> = engine.renderCompiledToAnimatedGif(
  compiled,
  options,
  sink,
);
void completed;

// @ts-expect-error animated rendering requires an explicit output sink
engine.renderCompiledToAnimatedGif(compiled, options);
/** Rejected byte-return assignment used to check the sink-based result contract. */
// @ts-expect-error the asynchronous result is metadata rather than encoded bytes
const bytes: Uint8Array = engine.renderCompiledToAnimatedGif(compiled, options, sink);
void bytes;

/** Rejected source-validation option on a compiled animation request. */
const invalidCompiledValidation: RenderCompiledAnimatedGifOptions = {
  durationMs: 1_000,
  iterations: "infinite",
  // @ts-expect-error validation is a source-input concern
  skipValidation: true,
};
void invalidCompiledValidation;

/** Rejected text-path option that is fixed when the scene is compiled. */
const invalidCompiledTextPathMode: RenderCompiledAnimatedGifOptions = {
  durationMs: 1_000,
  iterations: "infinite",
  // @ts-expect-error textPathMode is fixed on CompiledScene
  textPathMode: "glyphs",
};
void invalidCompiledTextPathMode;

/** Rejected animation request without an explicit total-play count. */
// @ts-expect-error animated raster total plays must be explicit
const missingIterations: RenderCompiledAnimatedGifOptions = { durationMs: 1_000 };
void missingIterations;

/** Type witness for fixed settings received by an animation backend hook. */
type OpenAnimationInput = Parameters<NonNullable<EngineOptions["openAnimatedRasterSessionFn"]>>[0];
/** Accepted fixed session configuration, distinct from scalar frame controls. */
const openAnimationInput: OpenAnimationInput = {
  format: "gif",
  frameCount: 1,
  iterations: 1,
  options: {},
  renderOptions: { animation: "static" },
};
void openAnimationInput;
/** Required fixed configuration cannot be omitted from a backend hook call. */
// @ts-expect-error renderOptions is required at open
const missingAnimationSettings: OpenAnimationInput = {
  format: "gif",
  frameCount: 1,
  iterations: 1,
  options: {},
};
void missingAnimationSettings;
/** Sample time varies per push and is absent from fixed emission configuration. */
const invalidAnimationSettings: OpenAnimationInput = {
  ...openAnimationInput,
  renderOptions: {
    animation: "static",
    // @ts-expect-error timeMs belongs to scalar pushes
    timeMs: 0,
  },
};
void invalidAnimationSettings;
