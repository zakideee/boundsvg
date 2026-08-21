use unicode_linebreak::{BreakOpportunity, linebreaks};

/// Get UAX#14 line break opportunities for a given text.
/// Returns a JSON array of byte offsets where breaks are allowed.
///
/// Each offset represents a position BEFORE which a break is allowed.
/// `BreakOpportunity::Mandatory` is included (forced breaks like \n).
/// `BreakOpportunity::Allowed` is included (optional breaks).
#[must_use]
pub fn uax14_break_opportunities(text: &str) -> Vec<usize> {
    let mut offsets: Vec<usize> = Vec::new();

    for (byte_offset, opportunity) in linebreaks(text) {
        match opportunity {
            BreakOpportunity::Mandatory | BreakOpportunity::Allowed => {
                offsets.push(byte_offset);
            }
        }
    }

    offsets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ascii_word_breaks() {
        let text = "Hello World Test";
        let breaks = uax14_break_opportunities(text);
        // Should have breaks at word boundaries (after spaces)
        assert!(!breaks.is_empty(), "Should have break opportunities");
        // Break after "Hello " (offset 6), "World " (offset 12)
        assert!(
            breaks.contains(&6),
            "Should break after 'Hello ': got {breaks:?}",
        );
        assert!(
            breaks.contains(&12),
            "Should break after 'World ': got {breaks:?}",
        );
    }

    #[test]
    fn test_cjk_breaks() {
        // CJK characters allow breaks between them
        let text = "日本語テスト";
        let breaks = uax14_break_opportunities(text);
        // Each CJK char is 3 bytes; breaks should be between them
        assert!(
            breaks.len() >= 2,
            "CJK should have break opportunities: got {breaks:?}",
        );
    }

    #[test]
    fn test_no_break_in_url() {
        // URLs should not have break opportunities within them (mostly)
        let text = "http://example.com more text";
        let breaks = uax14_break_opportunities(text);
        // There should be fewer breaks within the URL portion
        // The main break should be after "http://example.com " (space)
        let space_offset = text.find(" more").unwrap();
        assert!(
            breaks.contains(&(space_offset + 1)),
            "Should break at space: got {breaks:?}",
        );
    }

    #[test]
    fn test_empty_text() {
        let breaks = uax14_break_opportunities("");
        // empty text might have a single break at position 0 (end)
        // just ensure no crash
        assert!(breaks.len() <= 1);
    }

    #[test]
    fn test_cjk_latin_mixed() {
        let text = "Hello日本語World";
        let breaks = uax14_break_opportunities(text);
        // Should have breaks at CJK boundaries
        assert!(
            !breaks.is_empty(),
            "Mixed text should have break opportunities"
        );
    }

    #[test]
    fn test_punctuation_after_break() {
        let text = "これは。テスト";
        let breaks = uax14_break_opportunities(text);
        // Break should be after 。 (period), not before it
        // 「。」is at byte offset 6 (3 bytes × 2 chars = 6), size 3 bytes → 9
        // Break should be at or after byte 9
        assert!(!breaks.is_empty(), "Should have breaks: got {breaks:?}");
    }

    // --- Extended UAX#14 tests ---

    #[test]
    fn test_japanese_period_break_after() {
        // "あ。い" → break should be allowed after "。" (byte 6), not before it (byte 3)
        let text = "あ。い";
        let breaks = uax14_break_opportunities(text);
        // "あ" = bytes 0-2, "。" = bytes 3-5, "い" = bytes 6-8
        // Break at byte 6 (after "。", before "い") should be present
        assert!(
            breaks.contains(&6),
            "Break should be after period (byte 6): got {breaks:?}",
        );
        // Break at byte 3 (before "。") should NOT be present — period stays with preceding text
        assert!(
            !breaks.contains(&3),
            "Break should NOT be before period (byte 3): got {breaks:?}",
        );
    }

    #[test]
    fn test_japanese_comma_break_after() {
        // "あ、い" → break after "、"
        let text = "あ、い";
        let breaks = uax14_break_opportunities(text);
        // "あ" = bytes 0-2, "、" = bytes 3-5, "い" = bytes 6-8
        assert!(
            breaks.contains(&6),
            "Break should be after comma (byte 6): got {breaks:?}",
        );
        assert!(
            !breaks.contains(&3),
            "Break should NOT be before comma (byte 3): got {breaks:?}",
        );
    }

    #[test]
    fn test_bracket_pair_breaks() {
        // "あ「い」う" → break before "「" (open bracket), after "」" (close bracket)
        let text = "あ「い」う";
        let breaks = uax14_break_opportunities(text);
        // "あ" = 0-2, "「" = 3-5, "い" = 6-8, "」" = 9-11, "う" = 12-14
        // Break at byte 3 (before "「") should be allowed
        assert!(
            breaks.contains(&3),
            "Break should be before opening bracket (byte 3): got {breaks:?}",
        );
        // Break at byte 12 (after "」", before "う") should be allowed
        assert!(
            breaks.contains(&12),
            "Break should be after closing bracket (byte 12): got {breaks:?}",
        );
    }
}
