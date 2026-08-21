//! SVG content security checks.
//!
//! Detects potentially dangerous patterns in user-supplied SVG strings:
//! - `<script>` tags
//! - `<foreignObject>` elements
//! - Inline event handler attributes (`onclick=`, `onload=`, etc.)
//! - URI-bearing values (`href` / `src` / CSS `url()`) whose scheme is not
//!   on the allowlist, checked after XML character-reference decoding
//!
//! Ported from `packages/core/src/svg/security.ts`. Structural patterns are
//! matched on the raw source (element/attribute names cannot be written as
//! character references in XML). URI values are decoded first, since a
//! consumer resolves `java&#x73;cript:` and `javascript:` to the same URI, so
//! a scheme check that skips decoding can be walked straight past.

use regex::Regex;
use std::sync::LazyLock;

struct StructurePattern {
    regex: Regex,
    reason: &'static str,
}

#[expect(
    clippy::unwrap_used,
    reason = "patterns are hardcoded literals whose compilation is infallible; the tests below exercise every entry"
)]
fn compile(pattern: &str) -> Regex {
    Regex::new(pattern).unwrap()
}

static UNSAFE_STRUCTURE_PATTERNS: LazyLock<Vec<StructurePattern>> = LazyLock::new(|| {
    vec![
        StructurePattern {
            regex: compile(r"(?i)<\s*script\b"),
            reason: "<script> is not allowed",
        },
        StructurePattern {
            regex: compile(r"(?i)<\s*foreignObject\b"),
            reason: "<foreignObject> is not allowed",
        },
        StructurePattern {
            regex: compile(r"(?i)\son[a-z][a-z0-9_-]*\s*="),
            reason: "inline event handler attributes are not allowed",
        },
    ]
});

/// `\b(?:xlink:href|href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)`
static URI_ATTRIBUTE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    compile(r#"(?i)\b(?:xlink:href|href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#)
});

/// `url(\s*("[^"]*"|'[^']*'|[^)]*)\)`
static CSS_URL_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| compile(r#"(?i)url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)"#));

/// `&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);`
static CHAR_REFERENCE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| compile(r"&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);"));

/// Data-URI media-type allowlist: `^data:image/<type>[;,]`.
static DATA_IMAGE_MEDIA_TYPE: LazyLock<Regex> =
    LazyLock::new(|| compile(r"^data:image/[a-z0-9.+-]+[;,]"));

/// `^([a-z][a-z0-9+.-]*):`
static URI_SCHEME_PATTERN: LazyLock<Regex> = LazyLock::new(|| compile(r"^([a-z][a-z0-9+.-]*):"));

/// URI schemes permitted in raw SVG content. A value with no scheme (a
/// relative path or a `#fragment`) is always allowed.
const ALLOWED_URI_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// Decode one XML character reference (`#106`, `#x6a`) or predefined entity.
fn decode_reference(reference: &str) -> Option<char> {
    if let Some(hex) = reference
        .strip_prefix("#x")
        .or_else(|| reference.strip_prefix("#X"))
    {
        return u32::from_str_radix(hex, 16).ok().and_then(char::from_u32);
    }
    if let Some(decimal) = reference.strip_prefix('#') {
        return decimal.parse::<u32>().ok().and_then(char::from_u32);
    }
    match reference.to_ascii_lowercase().as_str() {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        _ => None,
    }
}

/// Decode character references, drop ASCII whitespace/control chars, lowercase.
/// Mirrors the consumer's normalization before resolving a URI.
fn normalize_uri_value(value: &str) -> String {
    let decoded = CHAR_REFERENCE_PATTERN.replace_all(value, |caps: &regex::Captures| {
        let reference = &caps[1];
        decode_reference(reference).map_or_else(|| caps[0].to_string(), |ch| ch.to_string())
    });
    decoded
        .chars()
        .filter(|ch| !(*ch <= '\u{20}' || *ch == '\u{7f}'))
        .collect::<String>()
        .to_lowercase()
}

/// `None` when the value carries no scheme (relative path or fragment).
fn uri_scheme(normalized: &str) -> Option<String> {
    URI_SCHEME_PATTERN
        .captures(normalized)
        .map(|caps| caps[1].to_string())
}

fn unsafe_uri_reason(raw_value: &str) -> Option<String> {
    let normalized = normalize_uri_value(raw_value);
    let scheme = uri_scheme(&normalized)?;
    if ALLOWED_URI_SCHEMES.contains(&scheme.as_str()) {
        return None;
    }
    if scheme == "data" {
        if DATA_IMAGE_MEDIA_TYPE.is_match(&normalized) {
            return None;
        }
        return Some("data: URI is allowed only for image media types".to_string());
    }
    Some(format!("\"{scheme}:\" URI scheme is not allowed"))
}

fn scan_uri_values(content: &str, pattern: &Regex) -> Option<String> {
    for caps in pattern.captures_iter(content) {
        let value = caps
            .get(1)
            .or_else(|| caps.get(2))
            .or_else(|| caps.get(3))
            .map_or("", |m| m.as_str());
        if let Some(reason) = unsafe_uri_reason(value) {
            return Some(reason);
        }
    }
    None
}

/// Check if SVG content contains unsafe patterns.
///
/// Returns `Some(reason)` if unsafe, `None` if safe.
pub fn unsafe_svg_reason(content: &str) -> Option<String> {
    for pattern in UNSAFE_STRUCTURE_PATTERNS.iter() {
        if pattern.regex.is_match(content) {
            return Some(pattern.reason.to_string());
        }
    }
    scan_uri_values(content, &URI_ATTRIBUTE_PATTERN)
        .or_else(|| scan_uri_values(content, &CSS_URL_PATTERN))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safe_svg() {
        assert!(unsafe_svg_reason("<circle cx=\"50\" cy=\"50\" r=\"40\" fill=\"red\"/>").is_none());
    }

    #[test]
    fn test_safe_relative_and_fragment_and_http() {
        assert!(unsafe_svg_reason("<use href=\"#glyph\"/>").is_none());
        assert!(unsafe_svg_reason("<image href=\"./pic.png\"/>").is_none());
        assert!(unsafe_svg_reason("<a href=\"https://example.com\">x</a>").is_none());
        assert!(unsafe_svg_reason("<image href=\"data:image/png;base64,AA==\"/>").is_none());
    }

    #[test]
    fn test_script_tag() {
        assert_eq!(
            unsafe_svg_reason("<script>alert('xss')</script>").as_deref(),
            Some("<script> is not allowed")
        );
    }

    #[test]
    fn test_script_tag_case_insensitive() {
        assert_eq!(
            unsafe_svg_reason("<SCRIPT>alert('xss')</SCRIPT>").as_deref(),
            Some("<script> is not allowed")
        );
    }

    #[test]
    fn test_script_with_space() {
        assert_eq!(
            unsafe_svg_reason("< script>alert('xss')</ script>").as_deref(),
            Some("<script> is not allowed")
        );
    }

    #[test]
    fn test_foreign_object() {
        assert_eq!(
            unsafe_svg_reason(
                "<foreignObject width=\"100\" height=\"100\"><body xmlns=\"http://www.w3.org/1999/xhtml\"></body></foreignObject>"
            )
            .as_deref(),
            Some("<foreignObject> is not allowed")
        );
    }

    #[test]
    fn test_inline_event_handler() {
        assert_eq!(
            unsafe_svg_reason("<circle onclick=\"alert('xss')\" />").as_deref(),
            Some("inline event handler attributes are not allowed")
        );
    }

    #[test]
    fn test_onload_handler() {
        assert_eq!(
            unsafe_svg_reason("<svg onload=\"alert('xss')\">").as_deref(),
            Some("inline event handler attributes are not allowed")
        );
    }

    #[test]
    fn test_javascript_uri_href() {
        assert_eq!(
            unsafe_svg_reason("<a href=\"javascript:alert('xss')\">").as_deref(),
            Some("\"javascript:\" URI scheme is not allowed")
        );
    }

    #[test]
    fn test_javascript_uri_xlink() {
        assert_eq!(
            unsafe_svg_reason("<a xlink:href=\"javascript:alert('xss')\">").as_deref(),
            Some("\"javascript:\" URI scheme is not allowed")
        );
    }

    #[test]
    fn test_javascript_url_function() {
        assert_eq!(
            unsafe_svg_reason("<rect fill=\"url(javascript:alert('xss'))\"/>").as_deref(),
            Some("\"javascript:\" URI scheme is not allowed")
        );
    }

    #[test]
    fn test_char_reference_obfuscated_javascript() {
        // `java&#x73;cript:` decodes to `javascript:` — must be rejected.
        assert_eq!(
            unsafe_svg_reason("<a href=\"java&#x73;cript:alert(1)\">").as_deref(),
            Some("\"javascript:\" URI scheme is not allowed")
        );
        assert_eq!(
            unsafe_svg_reason("<a href=\"java&#115;cript:alert(1)\">").as_deref(),
            Some("\"javascript:\" URI scheme is not allowed")
        );
    }

    #[test]
    fn test_control_char_obfuscated_scheme() {
        // A tab inside the scheme is stripped by URI parsers.
        assert_eq!(
            unsafe_svg_reason("<a href=\"java\tscript:alert(1)\">").as_deref(),
            Some("\"javascript:\" URI scheme is not allowed")
        );
    }

    #[test]
    fn test_disallowed_schemes() {
        assert_eq!(
            unsafe_svg_reason("<a href=\"vbscript:msgbox(1)\">").as_deref(),
            Some("\"vbscript:\" URI scheme is not allowed")
        );
        assert_eq!(
            unsafe_svg_reason("<image href=\"file:///etc/passwd\"/>").as_deref(),
            Some("\"file:\" URI scheme is not allowed")
        );
    }

    #[test]
    fn test_non_image_data_uri_rejected() {
        assert_eq!(
            unsafe_svg_reason("<a href=\"data:text/html,hello\">").as_deref(),
            Some("data: URI is allowed only for image media types")
        );
    }
}
