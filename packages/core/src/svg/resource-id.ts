const DEFAULT_RESOURCE_ID_SCOPE = "bsvg";

/**
 * Create a readable, delimiter-terminated literal SVG identifier prefix.
 *
 * When several outputs will share one document, choose scopes whose resulting
 * normalized prefixes are non-empty and pairwise prefix-free. For example,
 * fixed-width scope tokens satisfy that condition; `doc-` and `doc-clip-` do
 * not because the former is a string prefix of the latter.
 */
export function createResourceIdPrefix(scope = DEFAULT_RESOURCE_ID_SCOPE): string {
  const normalized = scope
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safeScope = normalized.length > 0 ? normalized : DEFAULT_RESOURCE_ID_SCOPE;
  return `${safeScope}-`;
}

/**
 * Characters that survive verbatim inside an unquoted `url(#...)` reference.
 * Node ids are user-supplied, so anything else (whitespace, quotes, parens,
 * `#`, `%`, ...) has to be replaced or the reference silently fails to
 * resolve and the clip / gradient / filter is dropped from the render.
 */
const CSS_SAFE_ID_CHARS = /[^A-Za-z0-9_.:-]/g;

/** FNV-1a — a short, stable, dependency-free digest. */
function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Derive a reference-safe resource id from a raw node id.
 *
 * Ids that are already safe pass through unchanged (so existing output stays
 * byte-identical). Ids that need replacement get a hash suffix of the raw id,
 * so two ids that sanitize to the same string stay distinct.
 */
export function toCssSafeResourceId(rawId: string): string {
  const sanitized = rawId.replace(CSS_SAFE_ID_CHARS, "_");
  if (sanitized === rawId) {
    return rawId;
  }
  return `${sanitized}-${stableHash(rawId)}`;
}
