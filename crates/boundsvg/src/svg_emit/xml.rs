//! XML escaping and resource-id derivation for SVG emission.
//!
//! Mirrors `packages/core/src/svg/utils.ts` (`escapeXml`) and
//! `packages/core/src/svg/resource-id.ts` (`toCssSafeResourceId`), plus the
//! FNV-1a content hash used for def resource ids.

use std::fmt::Write as _;

// ---------------------------------------------------------------------------
// XML escaping
// ---------------------------------------------------------------------------

/// Whether a character is in the XML 1.0 forbidden set the TS emitter drops
/// (U+0000..=U+0008, U+000B, U+000C, U+000E..=U+001F, U+FFFE, U+FFFF).
fn is_xml_forbidden(ch: char) -> bool {
    matches!(ch,
        '\u{0000}'..='\u{0008}'
            | '\u{000b}'
            | '\u{000c}'
            | '\u{000e}'..='\u{001f}'
            | '\u{fffe}'
            | '\u{ffff}')
}

/// Escape special XML characters in text content, dropping characters that
/// XML 1.0 does not permit at all. Mirrors TS `escapeXml`.
#[must_use]
pub fn escape_xml(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for ch in text.chars() {
        if is_xml_forbidden(ch) {
            continue;
        }
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

/// Serialize an arbitrary string as a CSS identifier.
///
/// This follows the escaping rules used by `CSS.escape()`. Animation class
/// selectors and keyframe names use the same resource-id token as SVG
/// attributes, so escaping happens only at the CSS serialization boundary.
#[must_use]
pub fn escape_css_identifier(identifier: &str) -> String {
    let characters: Vec<char> = identifier.chars().collect();
    let mut escaped = String::with_capacity(identifier.len());

    for (index, ch) in characters.iter().copied().enumerate() {
        let code_point = u32::from(ch);
        let requires_hex_escape = (code_point <= 0x1f)
            || code_point == 0x7f
            || (index == 0 && ch.is_ascii_digit())
            || (index == 1
                && ch.is_ascii_digit()
                && characters.first().is_some_and(|first| *first == '-'));
        if code_point == 0 {
            escaped.push('\u{fffd}');
        } else if requires_hex_escape {
            escaped.push('\\');
            let _ = write!(&mut escaped, "{code_point:x} ");
        } else if index == 0 && ch == '-' && characters.len() == 1 {
            escaped.push_str("\\-");
        } else if code_point >= 0x80 || ch == '-' || ch == '_' || ch.is_ascii_alphanumeric() {
            escaped.push(ch);
        } else {
            escaped.push('\\');
            escaped.push(ch);
        }
    }

    escaped
}

// ---------------------------------------------------------------------------
// FNV-1a over UTF-16 code units (matches JS charCodeAt iteration)
// ---------------------------------------------------------------------------

const FNV_OFFSET_BASIS: u32 = 0x811c_9dc5;
const FNV_PRIME: u32 = 0x0100_0193;

/// 32-bit FNV-1a over the string's UTF-16 code units, formatted base36.
/// Matches `stableHash` in `packages/core/src/svg/resource-id.ts`.
#[must_use]
pub fn fnv1a_hash_base36(input: &str) -> String {
    let mut hash = FNV_OFFSET_BASIS;
    for code_unit in input.encode_utf16() {
        hash ^= u32::from(code_unit);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    to_base36(hash)
}

/// Format an unsigned 32-bit value the way JS `Number.prototype.toString(36)`
/// does for integers (lowercase digits, no padding).
fn to_base36(mut value: u32) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_string();
    }
    let mut digits: Vec<u8> = Vec::new();
    while value > 0 {
        digits.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    digits.reverse();
    // Base36 digits are ASCII by construction.
    String::from_utf8(digits).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// CSS-safe resource ids
// ---------------------------------------------------------------------------

/// Whether a UTF-16 code unit survives verbatim inside an unquoted
/// `url(#...)` reference (TS class `[A-Za-z0-9_.:-]`).
fn is_css_safe_code_unit(code_unit: u16) -> bool {
    let Ok(byte) = u8::try_from(code_unit) else {
        return false;
    };
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b':' | b'-')
}

/// Derive a reference-safe resource id from a raw node id.
///
/// Ids that are already safe pass through unchanged; ids that need
/// replacement get a hash suffix of the raw id. The replacement runs per
/// UTF-16 code unit (a non-BMP character becomes two underscores), matching
/// the TS regex over JS string code units.
#[must_use]
pub fn to_css_safe_resource_id(raw_id: &str) -> String {
    let mut sanitized = String::with_capacity(raw_id.len());
    let mut changed = false;
    for code_unit in raw_id.encode_utf16() {
        if is_css_safe_code_unit(code_unit) {
            // Safe code units are ASCII, so the cast is lossless.
            sanitized.push(char::from(u8::try_from(code_unit).unwrap_or(b'_')));
        } else {
            sanitized.push('_');
            changed = true;
        }
    }
    if !changed {
        return raw_id.to_string();
    }
    format!("{sanitized}-{}", fnv1a_hash_base36(raw_id))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_the_five_xml_entities_in_ts_order() {
        assert_eq!(
            escape_xml(r#"a&b<c>d"e'f"#),
            "a&amp;b&lt;c&gt;d&quot;e&apos;f"
        );
    }

    #[test]
    fn serializes_css_identifiers_without_changing_the_underlying_token() {
        assert_eq!(
            escape_css_identifier("bsvg-anim-scope:one.card"),
            "bsvg-anim-scope\\:one\\.card"
        );
        assert_eq!(escape_css_identifier("1card"), "\\31 card");
        assert_eq!(escape_css_identifier("-1card"), "-\\31 card");
        assert_eq!(escape_css_identifier("-"), "\\-");
    }

    #[test]
    fn drops_forbidden_characters_but_keeps_legal_controls() {
        assert_eq!(escape_xml("a\u{0000}b\u{000b}c\u{fffe}d"), "abcd");
        assert_eq!(escape_xml("a\tb\nc\rd\u{007f}e"), "a\tb\nc\rd\u{007f}e");
    }

    #[test]
    fn safe_ids_pass_through_unchanged() {
        assert_eq!(to_css_safe_resource_id("node-1:bg.x_Y"), "node-1:bg.x_Y");
    }

    #[test]
    fn unsafe_ids_get_underscores_and_a_hash_suffix() {
        let safe = to_css_safe_resource_id("a b");
        assert!(safe.starts_with("a_b-"));
        // Distinct raw ids that sanitize identically stay distinct.
        assert_ne!(
            to_css_safe_resource_id("a b"),
            to_css_safe_resource_id("a#b")
        );
    }

    #[test]
    fn non_bmp_characters_replace_per_utf16_code_unit() {
        // "😀" is a surrogate pair in JS: two code units → two underscores.
        let safe = to_css_safe_resource_id("😀");
        assert!(safe.starts_with("__-"));
    }

    #[test]
    fn fnv1a_matches_the_js_reference_values() {
        // Values computed with the TS implementation (Math.imul + >>> 0).
        assert_eq!(fnv1a_hash_base36(""), to_base36(0x811c_9dc5));
        let mut expected: u32 = 0x811c_9dc5;
        expected ^= u32::from(b'a');
        expected = expected.wrapping_mul(0x0100_0193);
        assert_eq!(fnv1a_hash_base36("a"), to_base36(expected));
    }
}
