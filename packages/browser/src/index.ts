/**
 * @boundsvg/browser
 *
 * Browser runtime for boundsvg. Provides WASM module loading and
 * SVG DOM utilities and current-scene interaction.
 *
 * Usage:
 *   import { loadWasmModule } from "@boundsvg/browser";
 *   const wasmModule = await loadWasmModule();
 *   initWasm(wasmModule);
 */

export { createAnimatedRasterFileSink, createAnimatedRasterSpool } from "./animation-storage.js";
export type { PngDimensions } from "./assets.js";
export { downloadPng, readPngDimensions } from "./assets.js";
export type {
  BrowserFontDefinition,
  FontLoader,
  FontLoaderOptions,
  ResolvedBrowserFont,
} from "./fonts.js";
export { clearFontCache, createFontLoader, preloadFonts } from "./fonts.js";
export type { ImageLoaderOptions } from "./images.js";
export { createBrowserImageLoader } from "./images.js";
export type {
  EventCallback,
  InteractiveHandlerProps,
  PointerEventInfo,
  SvgCoordinateResult,
  SvgCoordinateUnavailable,
  SvgHitQueryResult,
  SvgHoverState,
  SvgQueryFailure,
  SvgQueryUnavailable,
  TextContextMenuHit,
} from "./interaction-types.js";
export type { IRDomBinding } from "./ir-dom-binding.js";
export { bindIRToSvg } from "./ir-dom-binding.js";
export type { ComposeLayeredSvgInlineOptions } from "./layered.js";
export {
  composeLayeredSvgInline,
  layeredPngToBlobs,
  layeredPngToDataUrls,
  layeredSvgToDataUrls,
} from "./layered.js";
export {
  createPngObjectUrl,
  pngToBlob,
  pngToDataUrl,
  revokePngObjectUrl,
} from "./png.js";
export { queryCurrentSvgHit, translateSvgCoords } from "./svg-event-utils.js";
export type {
  SvgInteractionController,
  SvgInteractionScene,
} from "./svg-interaction-controller.js";
export { createSvgInteractionController } from "./svg-interaction-controller.js";
export { type LoadWasmModuleOptions, loadWasmModule } from "./wasm.js";
