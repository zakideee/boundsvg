import {
  type CompiledScene,
  type Engine,
  type RenderCompiledAnimatedGifOptions,
  renderCompiledToAnimatedGif,
} from "../../dist/index.js";

declare const engine: Engine;
declare const compiled: CompiledScene;

const options: RenderCompiledAnimatedGifOptions = {
  timesMs: [0, 300, 700, 1_000],
  frameDurationsMs: [300, 400, 300, 100],
  loop: 2,
  scale: 2,
};
const engineBytes: Uint8Array = engine.renderCompiledToAnimatedGif(compiled, options);
const defaultBytes: Uint8Array = renderCompiledToAnimatedGif(compiled, options);
void engineBytes;
void defaultBytes;

const invalidCompiledValidation: RenderCompiledAnimatedGifOptions = {
  durationMs: 1_000,
  // @ts-expect-error validation is a source-input concern
  skipValidation: true,
};
void invalidCompiledValidation;

const invalidCompiledTextPathMode: RenderCompiledAnimatedGifOptions = {
  durationMs: 1_000,
  // @ts-expect-error textPathMode is fixed on CompiledScene
  textPathMode: "glyphs",
};
void invalidCompiledTextPathMode;
