use super::break_finding::{FindBreaksResult, find_vertical_breaks};
use super::common::language_to_str;
use super::glyph_mapping::{VerticalCharMap, build_vertical_char_map};
use super::layout::{build_column_ranges, build_columns_from_breaks};
use crate::font::shaping::GlyphInfo;
use crate::text::grapheme::grapheme_split;
use crate::text::kinsoku::{get_hanging_chars, get_kinsoku_profile};
use crate::text::types::{Language, Line, WrapMode};

// ---------------------------------------------------------------------------
// Vertical column breaking
// ---------------------------------------------------------------------------

pub(crate) struct VerticalBreakResult {
    pub(crate) columns: Vec<Line>,
    pub(crate) kinsoku_unresolved: bool,
}

pub(crate) struct VariableVerticalBreakResult {
    pub(crate) columns: Vec<Line>,
    pub(crate) column_ranges: Vec<(usize, usize)>,
}

/// Break text into vertical columns.
///
/// Each returned "Line" represents a vertical column:
/// - `text`: the text content of this column
/// - `width`: the total height of glyphs in this column (vertical advance)
/// - `baseline_y`: the X offset for this column (columns progress right-to-left)
// vertical column breaking requires glyph data, text, dimension constraints, kinsoku, and breaks
#[expect(
    clippy::too_many_arguments,
    reason = "vertical text layout requires font context and orientation parameters"
)]
pub(crate) fn break_vertical_columns(
    glyphs: &[GlyphInfo],
    text: &str,
    max_height: f64,
    wrap: WrapMode,
    _font_size_px: f64,
    line_height_px: f64,
    kinsoku: Option<&crate::text::kinsoku::KinsokuProfile>,
    uax14_breaks: Option<&[usize]>,
    hanging_chars: Option<&[char]>,
    force_newline_breaks: bool,
) -> VerticalBreakResult {
    if text.is_empty() {
        return VerticalBreakResult {
            columns: vec![Line {
                text: String::new(),
                glyphs: Vec::new(),
                width: 0.0,
                baseline_y: 0.0,
                fragments: None,
                positioned_glyphs: Some(Vec::new()),
            }],
            kinsoku_unresolved: false,
        };
    }

    let chars = grapheme_split(text);
    let chars_ref: Vec<&str> = chars.iter().map(std::string::String::as_str).collect();

    let VerticalCharMap {
        advances,
        glyph_ranges,
        placements,
        glyph_spans,
        char_byte_offsets,
    } = build_vertical_char_map(&chars_ref, glyphs);

    if wrap == WrapMode::None && !force_newline_breaks {
        let columns = build_columns_from_breaks(
            &[],
            &chars_ref,
            &advances,
            &placements,
            &glyph_ranges,
            &glyph_spans,
            &char_byte_offsets,
            glyphs,
            text,
            line_height_px,
        );
        return VerticalBreakResult {
            columns,
            kinsoku_unresolved: false,
        };
    }

    // Build UAX#14 break set
    let uax14_break_set =
        super::break_finding::build_uax14_break_set_vertical(&chars_ref, uax14_breaks, text);

    let FindBreaksResult {
        column_breaks,
        kinsoku_unresolved,
    } = find_vertical_breaks(
        &chars_ref,
        &advances,
        &[max_height],
        uax14_break_set.as_deref(),
        kinsoku,
        hanging_chars,
        force_newline_breaks,
    );

    let columns = build_columns_from_breaks(
        &column_breaks,
        &chars_ref,
        &advances,
        &placements,
        &glyph_ranges,
        &glyph_spans,
        &char_byte_offsets,
        glyphs,
        text,
        line_height_px,
    );

    VerticalBreakResult {
        columns,
        kinsoku_unresolved,
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "vertical text layout requires font context and orientation parameters"
)]
pub(crate) fn break_vertical_columns_with_variable_heights(
    glyphs: &[GlyphInfo],
    text: &str,
    max_heights: &[f64],
    wrap: WrapMode,
    _font_size_px: f64,
    line_height_px: f64,
    language: Language,
    uax14_breaks: Option<&[usize]>,
    hanging_punctuation: bool,
    force_newline_breaks: bool,
) -> VariableVerticalBreakResult {
    if max_heights.is_empty() {
        return VariableVerticalBreakResult {
            columns: Vec::new(),
            column_ranges: Vec::new(),
        };
    }

    let kinsoku_profile = get_kinsoku_profile(Some(language_to_str(language)));
    let hanging_chars = get_hanging_chars(hanging_punctuation);

    if text.is_empty() {
        return VariableVerticalBreakResult {
            columns: Vec::new(),
            column_ranges: Vec::new(),
        };
    }

    let chars = grapheme_split(text);
    let chars_ref: Vec<&str> = chars.iter().map(std::string::String::as_str).collect();

    let VerticalCharMap {
        advances,
        glyph_ranges,
        placements,
        glyph_spans,
        char_byte_offsets,
    } = build_vertical_char_map(&chars_ref, glyphs);

    if wrap == WrapMode::None && !force_newline_breaks {
        let columns = build_columns_from_breaks(
            &[],
            &chars_ref,
            &advances,
            &placements,
            &glyph_ranges,
            &glyph_spans,
            &char_byte_offsets,
            glyphs,
            text,
            line_height_px,
        );
        return VariableVerticalBreakResult {
            columns,
            column_ranges: vec![(0, chars_ref.len())],
        };
    }

    let uax14_break_set =
        super::break_finding::build_uax14_break_set_vertical(&chars_ref, uax14_breaks, text);
    let FindBreaksResult {
        column_breaks,
        kinsoku_unresolved: _,
    } = find_vertical_breaks(
        &chars_ref,
        &advances,
        max_heights,
        uax14_break_set.as_deref(),
        kinsoku_profile,
        hanging_chars,
        force_newline_breaks,
    );

    let columns = build_columns_from_breaks(
        &column_breaks,
        &chars_ref,
        &advances,
        &placements,
        &glyph_ranges,
        &glyph_spans,
        &char_byte_offsets,
        glyphs,
        text,
        line_height_px,
    );

    let column_ranges = build_column_ranges(&chars_ref, &column_breaks);

    VariableVerticalBreakResult {
        columns,
        column_ranges,
    }
}

/// Lightweight vertical measurement for shrinkwrap-style binary search.
#[derive(Debug, Clone)]
pub struct VerticalMeasure {
    pub line_count: usize,
    pub used_width: f64,
    pub used_height: f64,
    pub kinsoku_unresolved: bool,
}

#[must_use]
pub(crate) fn min_possible_height(glyphs: &[GlyphInfo], text: &str) -> f64 {
    if text.is_empty() {
        return 0.0;
    }

    let chars = grapheme_split(text);
    let chars_ref: Vec<&str> = chars.iter().map(std::string::String::as_str).collect();
    let char_map = build_vertical_char_map(&chars_ref, glyphs);
    char_map.advances.into_iter().fold(0.0_f64, f64::max)
}

#[must_use]
pub(crate) fn measure_vertical_glyphs(
    glyphs: &[GlyphInfo],
    text: &str,
    max_height: f64,
    wrap: WrapMode,
    font_size_px: f64,
    line_height_px: f64,
    language: Language,
    uax14_breaks: Option<&[usize]>,
    hanging_punctuation: bool,
    force_newline_breaks: bool,
) -> VerticalMeasure {
    let kinsoku_profile = get_kinsoku_profile(Some(language_to_str(language)));
    let hanging_chars = get_hanging_chars(hanging_punctuation);
    let VerticalBreakResult {
        columns,
        kinsoku_unresolved,
    } = break_vertical_columns(
        glyphs,
        text,
        max_height,
        wrap,
        font_size_px,
        line_height_px,
        kinsoku_profile,
        uax14_breaks,
        hanging_chars,
        force_newline_breaks,
    );

    let used_width = columns.len() as f64 * line_height_px;
    let used_height = columns
        .iter()
        .map(|column| column.width)
        .fold(0.0_f64, f64::max);

    VerticalMeasure {
        line_count: columns.len(),
        used_width,
        used_height,
        kinsoku_unresolved,
    }
}
