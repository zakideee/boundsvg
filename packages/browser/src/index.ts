/**
 * @boundsvg/browser
 *
 * Browser runtime for boundsvg. Provides WASM module loading and
 * SVG DOM utilities (coordinate translation, path hit-testing).
 *
 * Usage:
 *   import { loadWasmModule } from "@boundsvg/browser";
 *   const wasmModule = await loadWasmModule();
 *   initWasm(wasmModule);
 */

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
export { resolveHitTarget, translateSvgCoords, verifyPathGeometry } from "./svg-event-utils.js";
export { type LoadWasmModuleOptions, loadWasmModule } from "./wasm.js";
