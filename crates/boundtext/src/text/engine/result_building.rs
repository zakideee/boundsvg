use super::char_mapping::{GlyphCharSpan, GlyphRange};
use super::line_breaking::BreakLineRange;
use crate::font::shaping::{self, GlyphInfo};
use crate::text::types::{Line, PositionedGlyph, TextBBox, TextLayoutResult, TextOverflow};

// ---------------------------------------------------------------------------
// Line building helpers
// ---------------------------------------------------------------------------

// line building requires break indices, char data, glyph mappings, spans, and text
#[expect(
    clippy::too_many_arguments,
    reason = "text layout pipeline passes font context and layout constraints through stages"
)]
pub(super) fn build_lines_from_breaks(
    line_ranges: &[BreakLineRange],
    chars: &[&str],
    advances: &[f64],
    glyph_ranges: &[GlyphRange],
    glyph_spans: &[GlyphCharSpan],
    char_byte_offsets: &[u32],
    glyphs: &[GlyphInfo],
    text: &str,
    line_height_px: f64,
    baseline_offset_px: f64,
    text_indent: f64,
) -> Vec<Line> {
    let mut lines: Vec<Line> = Vec::new();

    for (line_index, range) in line_ranges.iter().enumerate() {
        let start = range.char_start.min(chars.len());
        let end = range.char_end.clamp(start, chars.len());
        let line_text: String = chars[start..end].join("");
        let line_indent = if line_index == 0 { text_indent } else { 0.0 };
        let mut line_width: f64 = line_indent;
        let mut line_glyph_indices: Vec<usize> = Vec::new();

        for (advance, range) in advances[start..end].iter().zip(&glyph_ranges[start..end]) {
            line_width += advance;
            for gi in range.start..range.end {
                if line_glyph_indices.last().copied() != Some(gi) {
                    line_glyph_indices.push(gi);
                }
            }
        }

        let line_glyphs: Vec<GlyphInfo> = line_glyph_indices
            .iter()
            .filter_map(|&gi| glyphs.get(gi).cloned())
            .collect();
        let baseline_y = baseline_offset_px + line_index as f64 * line_height_px;
        let mut positioned_glyphs = build_line_positioned_glyphs(
            &line_glyph_indices,
            glyphs,
            glyph_spans,
            text,
            char_byte_offsets,
            start,
            end,
            baseline_y,
        );
        for glyph in &mut positioned_glyphs {
            glyph.translate(line_indent, 0.0);
        }

        lines.push(Line {
            text: line_text,
            glyphs: line_glyphs,
            width: line_width,
            baseline_y,
            fragments: None,
            positioned_glyphs: Some(positioned_glyphs),
        });
    }

    lines
}

pub(super) fn build_horizontal_positioned_glyphs(
    glyphs: &[GlyphInfo],
    glyph_spans: &[GlyphCharSpan],
    text: &str,
    char_byte_offsets: &[u32],
    baseline_y: f64,
) -> Vec<PositionedGlyph> {
    let glyph_indices: Vec<usize> = (0..glyphs.len()).collect();
    build_line_positioned_glyphs(
        &glyph_indices,
        glyphs,
        glyph_spans,
        text,
        char_byte_offsets,
        0,
        char_byte_offsets.len().saturating_sub(1),
        baseline_y,
    )
}

/// Resolve glyph positions and logical source ranges for a fully shaped text
/// fragment. Ellipsis uses this after shaping its synthetic visible string so
/// unit metadata and outline resolution consume the same glyph mapping.
pub(crate) fn build_positioned_glyphs_for_text(
    glyphs: &[GlyphInfo],
    text: &str,
    baseline_y: f64,
) -> Vec<PositionedGlyph> {
    let graphemes = crate::text::grapheme::grapheme_split(text);
    let grapheme_refs: Vec<&str> = graphemes.iter().map(String::as_str).collect();
    let mapping = super::char_mapping::build_char_to_glyph_map(&grapheme_refs, glyphs, text);
    build_horizontal_positioned_glyphs(
        glyphs,
        &mapping.glyph_spans,
        text,
        &mapping.char_byte_offsets,
        baseline_y,
    )
}

// positioned glyph resolution requires glyph data, span info, text, offsets, and line boundaries
#[expect(
    clippy::cast_possible_truncation,
    reason = "byte offsets within text strings; text length is well within u32::MAX"
)]
#[expect(
    clippy::too_many_arguments,
    reason = "text layout pipeline passes font context and layout constraints through stages"
)]
fn build_line_positioned_glyphs(
    glyph_indices: &[usize],
    glyphs: &[GlyphInfo],
    glyph_spans: &[GlyphCharSpan],
    text: &str,
    char_byte_offsets: &[u32],
    line_start_char: usize,
    line_end_char: usize,
    baseline_y: f64,
) -> Vec<PositionedGlyph> {
    let mut cursor_x = 0.0;
    let mut positioned = Vec::with_capacity(glyph_indices.len());

    for &glyph_index in glyph_indices {
        let Some(glyph) = glyphs.get(glyph_index) else {
            continue;
        };
        let span = glyph_spans
            .get(glyph_index)
            .cloned()
            .unwrap_or(GlyphCharSpan {
                start: line_start_char,
                end: (line_start_char + 1).min(line_end_char),
            });
        let span_start = span.start.max(line_start_char).min(line_end_char);
        let span_end = span.end.max(span_start + 1).min(line_end_char);
        let start_byte = char_byte_offsets.get(span_start).copied().unwrap_or(0) as usize;
        let end_byte = char_byte_offsets
            .get(span_end)
            .copied()
            .unwrap_or(text.len() as u32) as usize;
        let glyph_text = text.get(start_byte..end_byte).unwrap_or("").to_string();
        let font_alias = glyph.font_alias.clone().unwrap_or_default();
        let font_weight = glyph.font_weight.unwrap_or(400);
        let font_style = glyph
            .font_style
            .clone()
            .unwrap_or(crate::font::FontStyle::Normal);

        positioned.push(PositionedGlyph {
            glyph_id: glyph.glyph_id,
            text: glyph_text,
            cluster_start: start_byte as u32,
            cluster_end: end_byte as u32,
            source_start: Some(span_start as u32),
            source_end: Some(span_end as u32),
            source_role: Some("content".to_string()),
            decoration_source_start: Some(span_start as u32),
            decoration_source_end: Some(span_end as u32),
            decoration_level: None,
            path_decoration_owner_id: None,
            path_distance_start_px: None,
            path_distance_end_px: None,
            text_decoration_geometry: None,
            font_alias,
            font_fallback: Vec::new(),
            font_weight,
            font_style,
            font_size_px: None,
            font_variation_settings: None,
            font_feature_settings: None,
            fill: None,
            text_strokes: None,
            text_shadows: None,
            paint_range_index: None,
            origin_x: cursor_x + glyph.x_offset,
            origin_y: baseline_y + glyph.y_offset,
            x_offset: glyph.x_offset,
            y_offset: glyph.y_offset,
            x_advance: glyph.x_advance,
            y_advance: glyph.y_advance,
            rotation_deg: glyph.rotation_deg.unwrap_or(0),
            baseline_rotation_deg: None,
            inline_scale: None,
            synthetic_kind: None,
            outline_writing_mode: None,
            absolute_position: None,
        });
        cursor_x += glyph.x_advance;
    }

    positioned
}

// ---------------------------------------------------------------------------
// Variation settings propagation
// ---------------------------------------------------------------------------

/// Patch `font_variation_settings` on all `PositionedGlyph`s in the given lines.
/// Only sets the field when it is currently `None` (avoids overwriting per-span values
/// already set by the rich-text path).
pub fn apply_variation_settings_to_lines(
    lines: &mut [Line],
    settings: &[shaping::VariationSetting],
) {
    if settings.is_empty() {
        return;
    }
    let css = shaping::to_css_font_variation_settings(settings);
    if css.is_empty() {
        return;
    }
    for line in lines {
        if let Some(ref mut pgs) = line.positioned_glyphs {
            for pg in pgs {
                if pg.font_variation_settings.is_none() {
                    pg.font_variation_settings = Some(css.clone());
                }
            }
        }
    }
}

/// Patch `font_feature_settings` on all `PositionedGlyph`s in the given lines.
/// Only sets the field when it is currently `None` (avoids overwriting per-span values
/// already set by the rich-text path).
pub fn apply_feature_settings_to_lines(lines: &mut [Line], settings: &[shaping::FeatureSetting]) {
    if settings.is_empty() {
        return;
    }
    let css = shaping::to_css_font_feature_settings(settings);
    if css.is_empty() {
        return;
    }
    for line in lines {
        if let Some(ref mut pgs) = line.positioned_glyphs {
            for pg in pgs {
                if pg.font_feature_settings.is_none() {
                    pg.font_feature_settings = Some(css.clone());
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Result building
// ---------------------------------------------------------------------------

#[must_use]
pub fn build_horizontal_result(
    truncated_lines: Vec<Line>,
    total_line_count: usize,
    line_height_px: f64,
    font_size_px: f64,
    kinsoku_unresolved: bool,
) -> TextLayoutResult {
    build_horizontal_result_with_warnings(
        truncated_lines,
        total_line_count,
        line_height_px,
        font_size_px,
        kinsoku_unresolved,
        Vec::new(),
    )
}

#[must_use]
pub fn build_horizontal_result_with_warnings(
    truncated_lines: Vec<Line>,
    total_line_count: usize,
    line_height_px: f64,
    font_size_px: f64,
    kinsoku_unresolved: bool,
    warnings: Vec<super::super::types::TextWarning>,
) -> TextLayoutResult {
    build_horizontal_result_with_constraints(
        truncated_lines,
        total_line_count,
        line_height_px,
        font_size_px,
        kinsoku_unresolved,
        None,
        None,
        warnings,
    )
}

#[expect(
    clippy::too_many_arguments,
    reason = "result construction combines layout metrics, constraints, and warnings"
)]
#[must_use]
pub fn build_horizontal_result_with_constraints(
    truncated_lines: Vec<Line>,
    total_line_count: usize,
    line_height_px: f64,
    font_size_px: f64,
    kinsoku_unresolved: bool,
    max_width: Option<f64>,
    max_height: Option<f64>,
    warnings: Vec<super::super::types::TextWarning>,
) -> TextLayoutResult {
    let mut max_line_width: f64 = 0.0;
    for l in &truncated_lines {
        if l.width > max_line_width {
            max_line_width = l.width;
        }
    }
    let total_height = truncated_lines.len() as f64 * line_height_px;
    let has_overflow = total_line_count > truncated_lines.len();

    let overflow = if kinsoku_unresolved {
        TextOverflow::kinsoku_unresolved()
    } else if has_overflow {
        TextOverflow::overflow("lines truncated by maxLines")
    } else if let Some(constraint_overflow) =
        detect_constraint_overflow(max_line_width, total_height, max_width, max_height)
    {
        constraint_overflow
    } else {
        TextOverflow::none()
    };

    TextLayoutResult {
        lines: truncated_lines,
        bbox: TextBBox {
            x: 0.0,
            y: 0.0,
            w: max_line_width,
            h: total_height,
        },
        chosen_font_size_px: font_size_px,
        overflow,
        source_text: None,
        display_text: None,
        unit_map: None,
        warnings,
        inline_box_decorations: Vec::new(),
        text_decorations: Vec::new(),
        inline_rects: Vec::new(),
    }
}

const CONSTRAINT_EPSILON: f64 = 0.001;

pub(crate) fn detect_constraint_overflow(
    width: f64,
    height: f64,
    max_width: Option<f64>,
    max_height: Option<f64>,
) -> Option<TextOverflow> {
    if let Some(max_w) = max_width {
        if width > max_w + CONSTRAINT_EPSILON {
            return Some(TextOverflow::overflow("text exceeds maxWidth"));
        }
    }

    if let Some(max_h) = max_height {
        if height > max_h + CONSTRAINT_EPSILON {
            return Some(TextOverflow::overflow("text exceeds maxHeight"));
        }
    }

    None
}
