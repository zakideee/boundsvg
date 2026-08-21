/// Simple code-point based grapheme splitting
/// Does NOT handle combining characters or multi-codepoint grapheme clusters.
/// For full Unicode segmentation, enable the "unicode-full" feature.
#[must_use]
pub fn simple_grapheme_split(text: &str) -> Vec<String> {
    text.chars().map(|c| c.to_string()).collect()
}

/// Full Unicode grapheme segmentation (behind feature flag)
#[cfg(feature = "unicode-full")]
pub fn full_grapheme_split(text: &str) -> Vec<String> {
    use unicode_segmentation::UnicodeSegmentation;
    text.graphemes(true)
        .map(std::string::ToString::to_string)
        .collect()
}

/// Splits text into the grapheme clusters used as line-break, char-wrap,
/// and truncation units.
///
/// With the `unicode-full` feature this is UAX#29 extended grapheme cluster
/// segmentation; without it, a per-code-point fallback is used (combining
/// marks and multi-codepoint emoji sequences are split apart).
#[must_use]
pub fn grapheme_split(text: &str) -> Vec<String> {
    #[cfg(feature = "unicode-full")]
    {
        full_grapheme_split(text)
    }
    #[cfg(not(feature = "unicode-full"))]
    {
        simple_grapheme_split(text)
    }
}

/// Returns the grapheme count (simple version)
#[must_use]
pub fn grapheme_count(text: &str) -> usize {
    text.chars().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_ascii() {
        let result = simple_grapheme_split("Hello");
        assert_eq!(result, vec!["H", "e", "l", "l", "o"]);
    }

    #[test]
    fn test_simple_japanese() {
        let result = simple_grapheme_split("あいう");
        assert_eq!(result, vec!["あ", "い", "う"]);
    }

    #[test]
    fn test_simple_mixed() {
        let result = simple_grapheme_split("Aあ1");
        assert_eq!(result, vec!["A", "あ", "1"]);
    }

    #[test]
    fn test_empty() {
        let result = simple_grapheme_split("");
        assert!(result.is_empty());
    }

    #[test]
    fn test_grapheme_count() {
        assert_eq!(grapheme_count("Hello"), 5);
        assert_eq!(grapheme_count("こんにちは"), 5);
        assert_eq!(grapheme_count(""), 0);
    }

    #[cfg(feature = "unicode-full")]
    #[test]
    fn test_full_grapheme_split() {
        let result = full_grapheme_split("Hello");
        assert_eq!(result, vec!["H", "e", "l", "l", "o"]);
    }

    #[cfg(feature = "unicode-full")]
    #[test]
    fn test_dispatch_keeps_zwj_emoji_sequence_intact() {
        let result =
            grapheme_split("a\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}b");
        assert_eq!(result.len(), 3);
        assert_eq!(result[0], "a");
        assert_eq!(result[2], "b");
    }

    #[cfg(feature = "unicode-full")]
    #[test]
    fn test_dispatch_keeps_regional_indicator_flags_intact() {
        let result = grapheme_split("\u{1F1EF}\u{1F1F5}\u{1F1FA}\u{1F1F8}");
        assert_eq!(result.len(), 2);
    }

    #[cfg(feature = "unicode-full")]
    #[test]
    fn test_dispatch_keeps_combining_mark_cluster_intact() {
        let result = grapheme_split("か\u{3099}な");
        assert_eq!(result, vec!["か\u{3099}", "な"]);
    }

    #[cfg(not(feature = "unicode-full"))]
    #[test]
    fn test_dispatch_falls_back_to_code_points() {
        let result = grapheme_split("か\u{3099}");
        assert_eq!(result.len(), 2);
    }
}
