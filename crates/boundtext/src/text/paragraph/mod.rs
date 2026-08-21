//! Width-independent shaped paragraph for two-phase layout.
//!
//! `shape_paragraph()` performs expensive shaping once and stores font-unit
//! glyph data. `layout_paragraph()` / `measure_paragraph()` then perform cheap
//! relayout at any (`font_size`, `max_width`) combination without re-shaping.

use std::sync::Arc;

use crate::font::FontStyle;
use crate::font::shaping::{FeatureSetting, VariationSetting};
use crate::text::kinsoku::KinsokuProfile;

mod ellipsis;
mod layout;
mod shape;

pub use ellipsis::{find_ellipsis_truncation_point, find_ellipsis_truncation_point_vertical};
pub use layout::{
    LineRange, ParagraphMeasure, layout_next_flow_column, layout_next_flow_line, layout_next_line,
    layout_paragraph, measure_paragraph, measure_paragraph_with_lines,
    measure_paragraph_with_lines_and_indent,
};
pub use shape::{collect_notdef_chars, shape_paragraph, shape_paragraph_with_options};

pub(crate) use layout::{
    BreakCursor, EllipsisTruncation, LayoutLine, LayoutLineFragment, LayoutOverflowReason,
    compute_advances_px, compute_vertical_advances_px, find_breakable,
};
pub(crate) use shape::build_uax14_break_set;

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

/// Font-unit glyph (no px scaling applied).
#[derive(Debug, Clone)]
pub struct ShapedGlyph {
    pub glyph_id: u32,
    pub x_advance_funits: i32,
    pub y_advance_funits: i32,
    /// Orientation-normalized inline advance for vertical layout. Sideways
    /// glyphs use their horizontal metric instead of the raw vertical em cell.
    pub vertical_inline_advance_funits: Option<i64>,
    pub x_offset_funits: i32,
    pub y_offset_funits: i32,
    pub cluster: u32,
    pub font_alias: String,
    pub font_weight: u16,
    pub font_style: FontStyle,
}

/// Width-independent intermediate representation produced by `shape_paragraph`.
#[derive(Debug, Clone)]
pub struct ShapedParagraph {
    pub text: Arc<str>,
    pub glyphs: Vec<ShapedGlyph>,
    pub units_per_em: u16,
    /// Per-character total advance in font units (summed from all glyphs mapped
    /// to each character).
    pub char_advances_funits: Vec<i64>,
    /// Per-character letter-spacing tracking count (1 for each glyph that
    /// receives tracking, accumulated per char).
    pub tracking_counts: Vec<u32>,
    pub char_byte_offsets: Vec<u32>,
    pub glyph_ranges: Vec<GlyphRange>,
    pub glyph_char_spans: Vec<GlyphCharSpan>,
    pub uax14_break_flags: Option<Vec<bool>>,
    pub kinsoku_profile: Option<&'static KinsokuProfile>,
    pub hanging_chars: Option<&'static [char]>,
    pub letter_spacing_px: f64,
    /// Stored for the fit shaping-once relayout, where the caller needs
    /// to propagate variation/feature settings to positioned glyphs.
    #[allow(dead_code)]
    pub font_variation_settings: Vec<VariationSetting>,
    #[allow(dead_code)]
    pub font_feature_settings: Vec<FeatureSetting>,
}

#[derive(Debug, Clone)]
pub struct GlyphRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone)]
pub struct GlyphCharSpan {
    pub start: usize,
    pub end: usize,
}

#[cfg(test)]
mod tests;
