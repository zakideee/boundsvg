// ---------------------------------------------------------------------------
// SVG Image Inliner — resolve external <image> hrefs to data URIs
// ---------------------------------------------------------------------------
// Uses WASM-side XML parsing (extract_image_hrefs) to detect external image
// references. The WASM side validates href safety (blocks path traversal,
// dangerous URI schemes, absolute paths). This TS side only handles
// resolution and data URI replacement.
// ---------------------------------------------------------------------------

import { FatalError } from "../errors.js";
import {
  wasmExtractImageHrefs,
  wasmExtractSkippedImageHrefs,
  wasmReplaceImageHrefs,
} from "../wasm/index.js";

const MIME_TYPE_PATTERN =
  /^[A-Za-z][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;[^,\r\n]*)?$/;

/** Resolved image data returned by the resolver callback */
export type ResolvedImage = {
  data: Uint8Array;
  mime: string;
};

/** Result of inlining external images */
export type InlineImagesResult = {
  /** SVG string with external hrefs replaced by data URIs */
  svg: string;
  /** Hrefs that were successfully inlined */
  inlined: string[];
  /** Hrefs that could not be resolved (resolver returned null) */
  failed: string[];
  /**
   * Hrefs the safety filter refused to resolve (path traversal, dangerous
   * schemes). They stay in the SVG as external references, so an offline
   * pipeline must know about them — they used to appear in no list at all.
   */
  skipped: string[];
};

/**
 * Resolver function type.
 * Given an href string from an <image> element, returns the image data
 * and MIME type, or null if the image cannot be resolved.
 */
export type ImageResolver = (href: string) => Promise<ResolvedImage | null>;

/**
 * Inline external image references in an SVG string.
 *
 * 1. Extracts safe, non-data-URI hrefs from <image> elements (via WASM XML
 *    parser, which also validates href safety)
 * 2. Calls resolver for each href
 * 3. Replaces href values with data URIs in the SVG string
 *
 * @param svgString - Input SVG string
 * @param resolver - Async function to resolve href → image data
 * @returns SVG with inlined images, plus lists of inlined/failed hrefs
 */
export async function inlineExternalImages(
  svgString: string,
  resolver: ImageResolver,
): Promise<InlineImagesResult> {
  // WASM side filters out data URIs and unsafe hrefs (traversal, dangerous schemes, etc.)
  const hrefs = wasmExtractImageHrefs(svgString);

  const skipped = wasmExtractSkippedImageHrefs(svgString);

  if (hrefs.length === 0) {
    return { svg: svgString, inlined: [], failed: [], skipped };
  }

  // Resolve all images in parallel
  const resolved = await Promise.all(
    hrefs.map(async (href) => {
      const result = await resolver(href);
      return { href, result };
    }),
  );

  const inlined: string[] = [];
  const failed: string[] = [];
  const replacements: Record<string, string> = {};

  for (const { href, result: imageData } of resolved) {
    if (!imageData) {
      failed.push(href);
      continue;
    }
    // A resolver returning the wrong shape used to produce
    // `data:undefined;base64,...` — a data URI that renders nothing, with no
    // error anywhere.
    assertResolvedImage(imageData, href);

    const base64 = uint8ArrayToBase64(imageData.data);
    const dataUri = `data:${imageData.mime.trim()};base64,${base64}`;

    replacements[href] = dataUri;
    inlined.push(href);
  }

  return {
    svg:
      Object.keys(replacements).length > 0
        ? wasmReplaceImageHrefs(svgString, replacements)
        : svgString,
    inlined,
    failed,
    skipped,
  };
}

function assertResolvedImage(image: ResolvedImage, href: string): void {
  if (
    !(image.data instanceof Uint8Array) ||
    typeof image.mime !== "string" ||
    !MIME_TYPE_PATTERN.test(image.mime.trim())
  ) {
    throw new FatalError(
      "IMAGE_RESOLVER_INVALID_RESULT",
      `Image resolver returned an invalid result for "${href}": expected { data: Uint8Array, mime: valid MIME type }`,
      { stage: "ir" },
    );
  }
}

/** Convert Uint8Array to base64 string */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Use btoa in browser environments, Buffer in Node.js
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}
