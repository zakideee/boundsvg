//! Retain shaped plain inline runs and their grapheme-to-style mapping.

use super::super::kinsoku::KinsokuProfile;
use super::super::types::{NotdefInfo, TextShadowLayer, TextStrokeLayer};
use crate::font::FontStyle;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A segment tracks which portion of the merged grapheme array belongs to which run.
pub struct RunSegment {
    /// Zero-based non-empty effective run identity in authored order.
    pub(crate) run_index: usize,
    pub(crate) span: SpanRef,
    pub(crate) graphemes: Vec<String>,
    /// First grapheme index (inclusive).
    pub start: usize,
    /// Last grapheme index (exclusive).
    pub end: usize,
    /// Index into the original authored spans.
    /// Preserved even when empty spans are skipped during shaping.
    pub span_index: usize,
}

/// Reference to a span's shaping parameters (avoids cloning full `TextSpanInput`).
pub(crate) struct SpanRef {
    pub(crate) font_families: Vec<String>,
    pub(crate) font_weight: u16,
    pub(crate) font_style: FontStyle,
    pub(crate) font_size_px: f64,
    pub(crate) letter_spacing_px: f64,
    pub(crate) language: Option<String>,
    pub(crate) text_orientation: Option<String>,
    pub(crate) color: Option<String>,
    pub(crate) text_strokes: Option<Vec<TextStrokeLayer>>,
    pub(crate) text_shadows: Option<Vec<TextShadowLayer>>,
    pub(crate) font_variation_settings: Option<String>,
    pub(crate) font_feature_settings: Option<String>,
}

/// Pre-shaped inline runs ready for cursor-based flow layout.
///
/// Pixel-unit analog of `ShapedParagraph` for multi-font text. Cannot be
/// relaid-out at different font sizes (advances are already in px).
pub struct ShapedInlineRuns {
    /// Concatenated text from all spans.
    pub text: String,
    /// Per-grapheme advance in px (already scaled, includes letter-spacing).
    pub grapheme_advances_px: Vec<f64>,
    /// Run segments mapping grapheme ranges to span styles.
    pub segments: Vec<RunSegment>,
    /// Grapheme strings for kinsoku/break-boundary checks.
    pub graphemes: Vec<String>,
    /// Per-grapheme byte offsets in the concatenated text.
    pub char_byte_offsets: Vec<u32>,
    /// Per-grapheme UAX#14 break opportunities.
    pub uax14_break_flags: Option<Vec<bool>>,
    /// Kinsoku profile (from base language).
    pub kinsoku_profile: Option<&'static KinsokuProfile>,
    /// Hanging punctuation chars (from base setting).
    pub hanging_chars: Option<&'static [char]>,
    /// Characters that produced .notdef (`glyph_id=0`) during shaping.
    pub notdef_infos: Vec<NotdefInfo>,
}
