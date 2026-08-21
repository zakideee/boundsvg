import { FatalError } from "../errors.js";

/**
 * Characters that XML 1.0 forbids outright — no escape sequence can carry
 * them. They have no glyph, and a document containing one is not parseable
 * (rasterization fails with "non-XML character"), so they are dropped.
 *
 * Tab, LF, and CR are legal and preserved. C1 controls and DEL are legal in
 * XML 1.0 and left alone.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the XML 1.0 forbidden set is the point.
const XML_FORBIDDEN_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;

/**
 * Escape special XML characters in text content, dropping characters that
 * XML 1.0 does not permit at all.
 */
export function escapeXml(text: string): string {
  return text
    .replace(XML_FORBIDDEN_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Format a number for SVG output.
 * Rounds to `precision` decimal places (default 2).
 *
 * @throws {FatalError} when `n` is not finite — `NaN` and `Infinity` have no
 *   SVG representation, and emitting the token produces a document that
 *   silently mis-renders (SVG) or fails to rasterize (PNG).
 */
export function formatNumber(n: number, precision = 2): string {
  if (!Number.isFinite(n)) {
    throw new FatalError("INVALID_NUMBER", `Cannot emit non-finite number to SVG: ${String(n)}`, {
      stage: "emit",
    });
  }
  const factor = 10 ** precision;
  const rounded = Math.round(n * factor) / factor;
  // Rounding overflows to Infinity for values near Number.MAX_VALUE; such
  // magnitudes carry no meaningful decimals, so emit them unrounded.
  return String(Number.isFinite(rounded) ? rounded : n);
}

/**
 * Convert a Uint8Array to a base64 data URI.
 * Works in both Node.js and browser environments.
 */
export function toBase64DataUri(data: Uint8Array, mediaType: string): string {
  const base64 = uint8ToBase64(data);
  return `data:${mediaType};base64,${base64}`;
}

/**
 * Convert Uint8Array to base64 string.
 * Uses Buffer in Node.js, falls back to btoa for browsers.
 */
export function uint8ToBase64(data: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(data).toString("base64");
  }
  // Browser fallback
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
