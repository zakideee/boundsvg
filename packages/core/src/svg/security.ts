/**
 * Safety scan for raw `Svg` content (third-party markup embedded verbatim).
 *
 * Structural patterns are matched on the raw source: element and attribute
 * names cannot be written as character references in XML, so no decoding is
 * needed for them. URI-bearing values are a different matter — `href`,
 * `src`, and CSS `url()` values go through XML entity decoding by the
 * consumer, so `java&#x73;cript:` and `javascript:` are the same URI. Those
 * are decoded first and then checked against a scheme allowlist.
 */
const UNSAFE_STRUCTURE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /<\s*script\b/i, reason: "<script> is not allowed" },
  { pattern: /<\s*foreignObject\b/i, reason: "<foreignObject> is not allowed" },
  {
    pattern: /\son[a-z][a-z0-9_-]*\s*=/i,
    reason: "inline event handler attributes are not allowed",
  },
];

/** URI schemes permitted in raw SVG content. A value with no scheme (a relative path or a `#fragment`) is always allowed. */
const ALLOWED_URI_SCHEMES = new Set(["http", "https", "mailto"]);

/** `data:` URIs are allowed only for image payloads (they cannot execute in an `<image>` or `<use>` reference). */
const ALLOWED_DATA_MEDIA_TYPE = /^data:image\/[a-z0-9.+-]+[;,]/;

const URI_ATTRIBUTE_PATTERN = /\b(?:xlink:href|href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * Decode XML character references (`&#106;`, `&#x6a;`) and the five
 * predefined entities, then drop ASCII whitespace and control characters.
 *
 * Both steps are what a consumer does before resolving a URI, so a scheme
 * check that skips them can be walked straight past.
 */
function decodeReference(reference: string): string | null {
  if (reference.startsWith("#x") || reference.startsWith("#X")) {
    const code = Number.parseInt(reference.slice(2), 16);
    return Number.isNaN(code) ? null : String.fromCodePoint(code);
  }
  if (reference.startsWith("#")) {
    const code = Number.parseInt(reference.slice(1), 10);
    return Number.isNaN(code) ? null : String.fromCodePoint(code);
  }
  return NAMED_ENTITIES[reference.toLowerCase()] ?? null;
}

function normalizeUriValue(value: string): string {
  const decoded = value.replace(
    /&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, reference: string) => decodeReference(reference) ?? match,
  );
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point — they are ignored by URI parsers.
  return decoded.replace(/[\u0000-\u0020\u007f]/g, "").toLowerCase();
}

/** `null` when the value carries no scheme (relative path or fragment). */
function uriScheme(normalized: string): string | null {
  const match = normalized.match(/^([a-z][a-z0-9+.-]*):/);
  return match ? (match[1] ?? null) : null;
}

function unsafeUriReason(rawValue: string): string | null {
  const normalized = normalizeUriValue(rawValue);
  const scheme = uriScheme(normalized);
  if (scheme === null) {
    return null;
  }
  if (ALLOWED_URI_SCHEMES.has(scheme)) {
    return null;
  }
  if (scheme === "data") {
    if (ALLOWED_DATA_MEDIA_TYPE.test(normalized)) {
      return null;
    }
    return "data: URI is allowed only for image media types";
  }
  return `"${scheme}:" URI scheme is not allowed`;
}

function scanUriValues(content: string, pattern: RegExp): string | null {
  pattern.lastIndex = 0;
  let match = pattern.exec(content);
  while (match !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    const reason = unsafeUriReason(value);
    if (reason) {
      return reason;
    }
    match = pattern.exec(content);
  }
  return null;
}

export function getUnsafeSvgReason(content: string): string | null {
  for (const { pattern, reason } of UNSAFE_STRUCTURE_PATTERNS) {
    if (pattern.test(content)) {
      return reason;
    }
  }
  return scanUriValues(content, URI_ATTRIBUTE_PATTERN) ?? scanUriValues(content, CSS_URL_PATTERN);
}
