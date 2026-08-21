//! Extract external image href values from an SVG string.
//!
//! Uses roxmltree to properly parse the SVG and find `<image>` elements
//! with `href` or `xlink:href` attributes. Returns only safe, non-data-URI
//! hrefs (i.e., external references that need resolution).
//!
//! Unsafe hrefs (path traversal, dangerous schemes, absolute filesystem
//! paths, UNC paths) are filtered out before being returned to the caller.

use std::collections::{HashMap, HashSet};

const XLINK_NS: &str = "http://www.w3.org/1999/xlink";

/// Check if an image href is unsafe.
/// Returns `Some(reason)` if the href should be blocked, `None` if safe.
fn unsafe_href_reason(href: &str) -> Option<&'static str> {
    // Match the raw-SVG scheme policy after XML parsing has decoded character
    // references. URI consumers ignore ASCII whitespace/control characters in
    // schemes, so `java&#x09;script:` must be treated as `javascript:` rather
    // than passed to the caller's resolver.
    if let Some(scheme) = normalized_uri_scheme(href) {
        if !matches!(scheme.as_str(), "http" | "https" | "mailto" | "data") {
            return Some("URI scheme is not allowed");
        }
    }

    // Percent-decode for traversal detection
    let decoded = percent_decode(href);

    // Block path traversal (raw and percent-encoded)
    if contains_path_traversal(&decoded) {
        return Some("path traversal");
    }

    // Block absolute filesystem paths (Unix: /etc, Windows: C:\)
    let decoded_bytes = decoded.as_bytes();
    if decoded_bytes.first() == Some(&b'/') && decoded_bytes.get(1).is_some_and(|b| *b != b'/') {
        return Some("absolute filesystem path");
    }
    if decoded_bytes.len() >= 3
        && decoded_bytes[0].is_ascii_alphabetic()
        && decoded_bytes[1] == b':'
        && (decoded_bytes[2] == b'\\' || decoded_bytes[2] == b'/')
    {
        return Some("absolute filesystem path");
    }

    // Block UNC paths (\\server\share)
    if decoded.starts_with("\\\\") {
        return Some("UNC path");
    }

    // Block protocol-relative URLs (//evil.com/path)
    if decoded.starts_with("//") {
        return Some("protocol-relative URL");
    }

    None
}

fn normalized_uri_value(href: &str) -> String {
    href.chars()
        .filter(|character| !character.is_ascii_control() && !character.is_ascii_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

fn normalized_uri_scheme(href: &str) -> Option<String> {
    let normalized = normalized_uri_value(href);
    let (candidate, _) = normalized.split_once(':')?;
    let mut characters = candidate.chars();
    if !characters
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic())
        || !characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '+' | '.' | '-')
        })
    {
        return None;
    }
    Some(candidate.to_string())
}

/// Check if a (decoded) path contains traversal sequences
fn contains_path_traversal(path: &str) -> bool {
    for segment in path.split(&['/', '\\'][..]) {
        if segment == ".." {
            return true;
        }
    }
    false
}

/// Simple percent-decoding (handles %XX sequences)
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut result = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                result.push(hi << 4 | lo);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&result).into_owned()
}

fn hex_val(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Extract non-data-URI, safe image hrefs from an SVG string.
///
/// Returns a deduplicated list of href values from `<image>` elements
/// that pass safety validation. Blocked hrefs (data URIs, path traversal,
/// dangerous schemes, absolute paths) are silently excluded.
///
/// # Errors
///
/// Returns an error string if the SVG cannot be parsed.
pub fn extract_image_hrefs(svg_string: &str) -> Result<Vec<String>, String> {
    let doc =
        roxmltree::Document::parse(svg_string).map_err(|e| format!("Failed to parse SVG: {e}"))?;

    let mut hrefs: Vec<String> = Vec::new();
    let mut seen = HashSet::new();

    for node in doc.descendants() {
        if !node.is_element() || node.tag_name().name() != "image" {
            continue;
        }

        let href = node
            .attribute("href")
            .or_else(|| node.attribute((XLINK_NS, "href")));

        if let Some(value) = href {
            let trimmed = value.trim();
            if trimmed.is_empty() || is_data_uri(trimmed) {
                continue;
            }
            if unsafe_href_reason(trimmed).is_some() {
                continue;
            }
            if seen.insert(trimmed.to_string()) {
                hrefs.push(trimmed.to_string());
            }
        }
    }

    Ok(hrefs)
}

/// Extract unsafe image hrefs rejected by the same safety policy used by
/// [`extract_image_hrefs`]. Keeping this classification in Rust avoids a
/// second, regex-based XML/safety implementation in the TS image inliner.
///
/// # Errors
///
/// Returns an error when the SVG string is not well-formed XML.
pub fn extract_skipped_image_hrefs(svg_string: &str) -> Result<Vec<String>, String> {
    let doc =
        roxmltree::Document::parse(svg_string).map_err(|e| format!("Failed to parse SVG: {e}"))?;
    let mut hrefs = Vec::new();
    let mut seen = HashSet::new();

    for node in doc.descendants() {
        if !node.is_element() || node.tag_name().name() != "image" {
            continue;
        }
        let href = node
            .attribute("href")
            .or_else(|| node.attribute((XLINK_NS, "href")));
        if let Some(value) = href {
            let trimmed = value.trim();
            if !trimmed.is_empty()
                && !is_data_uri(trimmed)
                && unsafe_href_reason(trimmed).is_some()
                && seen.insert(trimmed.to_string())
            {
                hrefs.push(trimmed.to_string());
            }
        }
    }

    Ok(hrefs)
}

/// Replace safe `<image>` href values using XML parser-provided source ranges.
/// This changes only image attributes (never `<a href>`), and works when the
/// original value contains XML entities or surrounding whitespace.
///
/// # Errors
///
/// Returns an error when the SVG string is not well-formed XML.
pub fn replace_image_hrefs<S: std::hash::BuildHasher>(
    svg_string: &str,
    replacements: &HashMap<String, String, S>,
) -> Result<String, String> {
    let doc =
        roxmltree::Document::parse(svg_string).map_err(|e| format!("Failed to parse SVG: {e}"))?;
    let mut ranges = Vec::new();

    for node in doc.descendants() {
        if !node.is_element() || node.tag_name().name() != "image" {
            continue;
        }
        let attribute = node
            .attribute_node("href")
            .or_else(|| node.attribute_node((XLINK_NS, "href")));
        let Some(attribute) = attribute else {
            continue;
        };
        let href = attribute.value().trim();
        if unsafe_href_reason(href).is_some() || is_data_uri(href) {
            continue;
        }
        if let Some(replacement) = replacements.get(href) {
            ranges.push((attribute.range_value(), escape_attribute_value(replacement)));
        }
    }

    let mut result = svg_string.to_string();
    for (range, replacement) in ranges.into_iter().rev() {
        result.replace_range(range, &replacement);
    }
    Ok(result)
}

fn is_data_uri(href: &str) -> bool {
    normalized_uri_scheme(href).is_some_and(|scheme| scheme == "data")
}

fn escape_attribute_value(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- extraction tests --

    #[test]
    fn extracts_relative_href() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="background.png" width="100" height="100"/>
        </svg>"#;
        assert_eq!(extract_image_hrefs(svg).unwrap(), vec!["background.png"]);
    }

    #[test]
    fn extracts_xlink_href() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
            <image xlink:href="map.png" width="200" height="100"/>
        </svg>"#;
        assert_eq!(extract_image_hrefs(svg).unwrap(), vec!["map.png"]);
    }

    #[test]
    fn extracts_absolute_url() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="https://example.com/image.png" width="100" height="100"/>
        </svg>"#;
        assert_eq!(
            extract_image_hrefs(svg).unwrap(),
            vec!["https://example.com/image.png"]
        );
    }

    #[test]
    fn deduplicates_same_href() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="bg.png" width="100" height="100"/>
            <image href="bg.png" width="200" height="200"/>
        </svg>"#;
        assert_eq!(extract_image_hrefs(svg).unwrap(), vec!["bg.png"]);
    }

    #[test]
    fn mixed_data_and_external() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="data:image/png;base64,AAAA" width="100" height="100"/>
            <image href="terrain.png" width="200" height="100"/>
            <image href="borders.svg" width="200" height="100"/>
        </svg>"#;
        assert_eq!(
            extract_image_hrefs(svg).unwrap(),
            vec!["terrain.png", "borders.svg"]
        );
    }

    #[test]
    fn no_images() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" fill="red"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn skips_empty_href() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="" width="100" height="100"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn skips_data_uri() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="data:image/png;base64,AAAA" width="100" height="100"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn skips_data_uri_case_insensitively() {
        let svg = r#"<svg><image href="DATA:image/png;base64,AAAA"/></svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
        assert!(extract_skipped_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn reports_only_real_unsafe_image_attributes() {
        let svg = r#"<svg><!-- <image href="../../comment"/> --><image aria-label="a > b" href="..&#x2F;secret.png"/></svg>"#;
        assert_eq!(
            extract_skipped_image_hrefs(svg).unwrap(),
            vec!["../secret.png"]
        );
    }

    #[test]
    fn replaces_only_image_href_source_ranges() {
        let svg = r#"<svg><a href="a&amp;b.png"/><image href=" a&amp;b.png "/></svg>"#;
        let replacements = HashMap::from([(
            "a&b.png".to_string(),
            "data:image/png;base64,AA==".to_string(),
        )]);
        assert_eq!(
            replace_image_hrefs(svg, &replacements).unwrap(),
            r#"<svg><a href="a&amp;b.png"/><image href="data:image/png;base64,AA=="/></svg>"#
        );
    }

    // -- safety validation tests --

    #[test]
    fn blocks_path_traversal() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="../secret.png" width="100" height="100"/>
            <image href="../../etc/passwd" width="100" height="100"/>
            <image href="images/../../secret" width="100" height="100"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn blocks_encoded_path_traversal() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="%2e%2e/secret.png" width="100" height="100"/>
            <image href="..%2fsecret.png" width="100" height="100"/>
            <image href="%2e%2e%2fetc%2fpasswd" width="100" height="100"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn blocks_backslash_traversal() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="foo\..\bar" width="100" height="100"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn blocks_javascript_scheme() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="javascript:alert(1)" width="100" height="100"/>
            <image href="JAVASCRIPT:void(0)" width="100" height="100"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn blocks_obfuscated_and_non_allowlisted_schemes() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="java&#x09;script:alert(1)"/>
            <image href="java&#10;script:alert(2)"/>
            <image href="ftp://example.com/image.png"/>
            <image href="blob:https://example.com/id"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
        assert_eq!(
            extract_skipped_image_hrefs(svg).unwrap(),
            vec![
                "java\tscript:alert(1)",
                "java\nscript:alert(2)",
                "ftp://example.com/image.png",
                "blob:https://example.com/id",
            ]
        );
    }

    #[test]
    fn skips_obfuscated_data_scheme_without_resolving_it() {
        let svg = r#"<svg><image href="da&#x09;ta:image/png;base64,AAAA"/></svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
        assert!(extract_skipped_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn blocks_file_scheme() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="file:///etc/passwd" width="100" height="100"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn blocks_vbscript_scheme() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="vbscript:MsgBox" width="100" height="100"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn blocks_absolute_unix_path() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="/etc/passwd" width="100" height="100"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn blocks_absolute_windows_path() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="C:\Windows\system.ini" width="100" height="100"/>
            <image href="D:/images/bg.png" width="100" height="100"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn blocks_unc_path() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="\\server\share\file.png" width="100" height="100"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
    }

    #[test]
    fn blocks_protocol_relative_url() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg">
            <image href="//evil.com/steal.png" width="100" height="100"/>
        </svg>"#;
        assert!(extract_image_hrefs(svg).unwrap().is_empty());
    }

    // -- unsafe_href_reason unit tests --

    #[test]
    fn safe_simple_relative() {
        assert!(unsafe_href_reason("background.png").is_none());
        assert!(unsafe_href_reason("images/bg.jpg").is_none());
        assert!(unsafe_href_reason("./terrain.png").is_none());
    }

    #[test]
    fn safe_http_urls() {
        assert!(unsafe_href_reason("https://example.com/img.png").is_none());
        assert!(unsafe_href_reason("http://cdn.example.com/bg.jpg").is_none());
    }

    #[test]
    fn blocks_protocol_relative() {
        assert_eq!(
            unsafe_href_reason("//evil.com/steal.png"),
            Some("protocol-relative URL")
        );
    }
}
