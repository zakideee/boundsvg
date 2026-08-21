import {
  type CompiledScene,
  type Engine,
  type RenderCompiledAnimatedWebpOptions,
  renderCompiledToAnimatedWebp,
} from "../../dist/index.js";

declare const engine: Engine;
declare const compiled: CompiledScene;

const options: RenderCompiledAnimatedWebpOptions = {
  timesMs: [0, 300, 700, 1_000],
  frameDurationsMs: [300, 400, 300, 100],
  loop: 2,
  scale: 2,
};
const engineBytes: Uint8Array = engine.renderCompiledToAnimatedWebp(compiled, options);
const defaultBytes: Uint8Array = renderCompiledToAnimatedWebp(compiled, options);
void engineBytes;
void defaultBytes;

const invalidCompiledValidation: RenderCompiledAnimatedWebpOptions = {
  durationMs: 1_000,
  // @ts-expect-error validation is a source-input concern
  skipValidation: true,
};
void invalidCompiledValidation;

const invalidCompiledTextPathMode: RenderCompiledAnimatedWebpOptions = {
  durationMs: 1_000,
  // @ts-expect-error textPathMode is fixed on CompiledScene
  textPathMode: "glyphs",
};
void invalidCompiledTextPathMode;
