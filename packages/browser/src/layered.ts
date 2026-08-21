import type { LayeredPngResult, LayeredSvgResult } from "@boundsvg/core";
import { sortLayersByPaintOrder } from "@boundsvg/core";
import { pngToBlob, pngToDataUrl } from "./png.js";

const SVG_MIME_TYPE = "image/svg+xml";

/**
 * Convert each layer's PNG bytes into a `data:image/png;base64,...` URL.
 * Ordering matches `result.layers` (not reordered by paint order).
 */
export function layeredPngToDataUrls(result: LayeredPngResult): string[] {
  return result.layers.map((layer) => pngToDataUrl(layer.png));
}

/**
 * Convert each layer's PNG bytes into an `image/png` Blob.
 * Ordering matches `result.layers`.
 */
export function layeredPngToBlobs(result: LayeredPngResult): Blob[] {
  return result.layers.map((layer) => pngToBlob(layer.png));
}

/**
 * Convert each layer's SVG markup into a `data:image/svg+xml;base64,...` URL.
 * UTF-8 safe: multi-byte characters in the markup are preserved via
 * `TextEncoder` before base64 encoding.
 * Ordering matches `result.layers`.
 */
export function layeredSvgToDataUrls(result: LayeredSvgResult): string[] {
  return result.layers.map((layer) => svgToDataUrl(layer.svg));
}

export type ComposeLayeredSvgInlineOptions = {
  /**
   * Stacking order for the returned fragment.
   * - `"paint"` (default): layers are emitted sorted by `paintOrder` ascending,
   *   so the last DOM node is the front-most layer.
   * - `"array"`: layers are emitted in `result.layers` order verbatim.
   */
  order?: "paint" | "array";
};

/**
 * Build a stacked HTML fragment string that composes all layer SVGs into a
 * single positioned container.
 *
 * The returned markup is:
 *   `<div style="position:relative;width:Wpx;height:Hpx">
 *      <div style="position:absolute;inset:0">{svg0}</div>
 *      <div style="position:absolute;inset:0">{svg1}</div>
 *      ...
 *    </div>`
 *
 * Layer SVG strings are emitted verbatim. Callers are responsible for trusting
 * the source (layered SVG produced by boundsvg is safe).
 */
export function composeLayeredSvgInline(
  result: LayeredSvgResult,
  options?: ComposeLayeredSvgInlineOptions,
): string {
  const order = options?.order ?? "paint";
  const orderedLayers = order === "paint" ? sortLayersByPaintOrder(result.layers) : result.layers;
  const children = orderedLayers
    .map((layer) => `<div style="position:absolute;inset:0">${layer.svg}</div>`)
    .join("");
  return `<div style="position:relative;width:${result.width}px;height:${result.height}px">${children}</div>`;
}

function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:${SVG_MIME_TYPE};base64,${btoa(binary)}`;
}
