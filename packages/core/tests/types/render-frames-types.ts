import {
  type CompiledScene,
  type Engine,
  type Frame,
  type RenderCompiledFramesOptions,
  type RenderFramesOptions,
  renderCompiledFrames,
  renderFrames,
  type VNode,
} from "../../dist/index.js";

declare const engine: Engine;
declare const scene: VNode;
declare const compiled: CompiledScene;

const options: RenderFramesOptions = {
  timesMs: [600, 0, 1_400, 600] as const,
  format: "svg",
  scale: 2,
};
const engineFrames: Iterable<Frame> = engine.renderFrames(scene, options);
const defaultFrames: Iterable<Frame> = renderFrames(scene, options);
const engineCompiledFrames: Iterable<Frame> = engine.renderCompiledFrames(compiled, options);
const defaultCompiledFrames: Iterable<Frame> = renderCompiledFrames(compiled, options);
void engineFrames;
void defaultFrames;
void engineCompiledFrames;
void defaultCompiledFrames;

const compiledOptions: RenderCompiledFramesOptions = {
  timesMs: [0, 600],
  format: "png",
  scale: 2,
};
void engine.renderCompiledFrames(compiled, compiledOptions);

const invalidCompiledValidation: RenderCompiledFramesOptions = {
  timesMs: [0],
  format: "svg",
  // @ts-expect-error validation is a source-input concern and is not accepted by the compiled entry
  skipValidation: true,
};
void invalidCompiledValidation;

const invalidCompiledTextPathMode: RenderCompiledFramesOptions = {
  timesMs: [0],
  format: "svg",
  // @ts-expect-error textPathMode is fixed on CompiledScene
  textPathMode: "glyphs",
};
void invalidCompiledTextPathMode;

function readFrame(frame: Frame): string | Uint8Array {
  if (frame.format === "svg") {
    const svg: string = frame.data;
    return svg;
  }
  const png: Uint8Array = frame.data;
  return png;
}
void readFrame;

const invalidAnimation: RenderFramesOptions = {
  timesMs: [0],
  format: "svg",
  // @ts-expect-error frame rendering always uses static sampling internally
  animation: "static",
};
void invalidAnimation;

// @ts-expect-error each frame time must come from the explicit timesMs schedule
const invalidSingleTime: RenderFramesOptions = { timesMs: [0], format: "png", timeMs: 0 };
void invalidSingleTime;
