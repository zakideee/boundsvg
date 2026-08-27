import type {
  EmitAnimatedSvgOptions,
  EmitSvgOptions,
  LayeredPngOptions,
  LayeredSvgOptions,
  RenderAnimatedSvgOptions,
  RenderPngFramesOptions,
  RenderPngOptions,
  RenderSvgFramesOptions,
  RenderSvgOptions,
} from "../../dist/index.js";

// @ts-expect-error the cross-format 0.2 alias was removed in 0.3
type RemovedRenderOptions = import("../../dist/index.js").RenderOptions;
// @ts-expect-error the cross-format 0.2 emit alias was removed in 0.3
type RemovedEmitOptions = import("../../dist/index.js").EmitOptions;

const staticOptions: RenderSvgOptions = {
  timeMs: 0,
  nodeIdMetadata: "omit",
  resourceIdPrefix: "document-a-",
};
const animatedOptions: RenderAnimatedSvgOptions = {
  playback: { mode: "independent" },
  reducedMotion: "pause",
  nodeIdMetadata: "include",
};
const staticEmitOptions: EmitSvgOptions = { timeMs: 0, nodeIdMetadata: "omit" };
const animatedEmitOptions: EmitAnimatedSvgOptions = {
  playback: { mode: "independent" },
};
void staticOptions;
void animatedOptions;
void staticEmitOptions;
void animatedEmitOptions;
void (undefined as unknown as RemovedRenderOptions);
void (undefined as unknown as RemovedEmitOptions);

// @ts-expect-error animated SVG requires an explicit playback contract
const missingPlayback: RenderAnimatedSvgOptions = {};
void missingPlayback;

const invalidPlayback: RenderAnimatedSvgOptions = {
  // @ts-expect-error document timeline playback is not part of the 0.3 contract
  playback: { mode: "document" },
};
void invalidPlayback;

const invalidStaticReducedMotion: RenderSvgOptions = {
  // @ts-expect-error reducedMotion belongs to animated SVG only
  reducedMotion: "pause",
};
void invalidStaticReducedMotion;

const invalidStaticPlayback: RenderSvgOptions = {
  // @ts-expect-error playback belongs to animated SVG only
  playback: { mode: "independent" },
};
void invalidStaticPlayback;

const invalidRasterPrefix: RenderPngOptions = {
  // @ts-expect-error resourceIdPrefix belongs to SVG output only
  resourceIdPrefix: "svg-only-",
};
void invalidRasterPrefix;

const invalidRasterMetadata: RenderPngOptions = {
  // @ts-expect-error nodeIdMetadata belongs to SVG output only
  nodeIdMetadata: "omit",
};
void invalidRasterMetadata;

const invalidLayeredSvgPlayback: LayeredSvgOptions = {
  // @ts-expect-error layered SVG output is static-only in 0.3
  playback: { mode: "independent" },
};
void invalidLayeredSvgPlayback;

const invalidLayeredPngMetadata: LayeredPngOptions = {
  // @ts-expect-error layered PNG does not accept SVG metadata options
  nodeIdMetadata: "omit",
};
void invalidLayeredPngMetadata;

const svgFrames: RenderSvgFramesOptions = {
  format: "svg",
  timesMs: [0, 100],
  nodeIdMetadata: "omit",
};
const pngFrames: RenderPngFramesOptions = {
  format: "png",
  timesMs: [0, 100],
  rasterBackground: "#ffffff",
};
void svgFrames;
void pngFrames;

const invalidSvgFrameRasterOption: RenderSvgFramesOptions = {
  format: "svg",
  timesMs: [0],
  // @ts-expect-error rasterBackground belongs to PNG frames only
  rasterBackground: "#ffffff",
};
void invalidSvgFrameRasterOption;

const invalidPngFrameSvgOption: RenderPngFramesOptions = {
  format: "png",
  timesMs: [0],
  // @ts-expect-error resourceIdPrefix belongs to SVG frames only
  resourceIdPrefix: "svg-only-",
};
void invalidPngFrameSvgOption;

const invalidLegacyAnimation: RenderSvgOptions = {
  // @ts-expect-error the legacy animation selector was removed
  animation: "static",
};
void invalidLegacyAnimation;
