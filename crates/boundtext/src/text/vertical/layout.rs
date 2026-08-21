use super::glyph_mapping::{GlyphCharSpan, GlyphRange, VerticalCharPlacement};
use crate::font::shaping::GlyphInfo;
use crate::text::engine::detect_constraint_overflow;
use crate::text::types::{
    Line, PositionedGlyph, TextBBox, TextLayoutResult, TextOverflow, TextWarning,
};

// ---------------------------------------------------------------------------
// Column building
// ---------------------------------------------------------------------------

// column building requires break data, char arrays, placements, glyph mappings, and text
#[expect(
    clippy::too_many_arguments,
    reason = "vertical text layout requires font context and orientation parameters"
)]
pub(super) fn build_columns_from_breaks(
    column_breaks: &[usize],
    chars: &[&str],
    advances: &[f64],
    placements: &[VerticalCharPlacement],
    glyph_ranges: &[GlyphRange],
    glyph_spans: &[GlyphCharSpan],
    char_byte_offsets: &[u32],
    glyphs: &[GlyphInfo],
    text: &str,
    line_height_px: f64,
) -> Vec<Line> {
    let mut columns: Vec<Line> = Vec::new();
    let mut start = 0;
    let mut all_breaks: Vec<usize> = column_breaks.to_vec();
    all_breaks.push(chars.len());
    let column_width = line_height_px;

    for (ci, &end) in all_breaks.iter().enumerate() {
        let content_end = if end > start && chars.get(end - 1) == Some(&"\n") {
            end - 1
        } else {
            end
        };
        let col_text: String = chars[start..content_end].join("");
        let mut col_height: f64 = 0.0;
        let mut col_glyph_indices: Vec<usize> = Vec::new();

        for (idx, range) in glyph_ranges
            .iter()
            .enumerate()
            .take(content_end)
            .skip(start)
        {
            col_height += advances.get(idx).copied().unwrap_or(0.0);
            for gi in range.start..range.end {
                if col_glyph_indices.last().copied() != Some(gi) {
                    col_glyph_indices.push(gi);
                }
            }
        }

        let col_glyphs: Vec<GlyphInfo> = col_glyph_indices
            .iter()
            .filter_map(|&gi| glyphs.get(gi).cloned())
            .collect();
        let positioned_glyphs = build_column_positioned_glyphs(
            &col_glyph_indices,
            glyphs,
            glyph_spans,
            placements,
            advances,
            text,
            char_byte_offsets,
            start,
            content_end,
        );

        columns.push(Line {
            text: col_text,
            glyphs: col_glyphs,
            width: col_height,
            baseline_y: ci as f64 * column_width,
            fragments: None,
            positioned_glyphs: Some(positioned_glyphs),
        });

        start = end;
    }

    columns
}

pub(super) fn build_column_ranges(chars: &[&str], column_breaks: &[usize]) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut start = 0usize;
    for &end in column_breaks {
        let content_end = if end > start && chars.get(end - 1) == Some(&"\n") {
            end - 1
        } else {
            end
        };
        ranges.push((start, content_end));
        start = end;
    }
    ranges.push((start, chars.len()));
    ranges
}

// positioned glyph resolution requires glyph data, span info, placements, text, and column bounds
#[expect(
    clippy::cast_possible_truncation,
    reason = "byte offsets within text strings; text length is well within u32::MAX"
)]
#[expect(
    clippy::too_many_arguments,
    reason = "vertical text layout requires font context and orientation parameters"
)]
pub(super) fn build_column_positioned_glyphs(
    glyph_indices: &[usize],
    glyphs: &[GlyphInfo],
    glyph_spans: &[GlyphCharSpan],
    placements: &[VerticalCharPlacement],
    advances: &[f64],
    text: &str,
    char_byte_offsets: &[u32],
    column_start: usize,
    column_end: usize,
) -> Vec<PositionedGlyph> {
    let mut positioned = Vec::with_capacity(glyph_indices.len());

    for &glyph_index in glyph_indices {
        let Some(glyph) = glyphs.get(glyph_index) else {
            continue;
        };
        let span = glyph_spans
            .get(glyph_index)
            .cloned()
            .unwrap_or(GlyphCharSpan {
                start: column_start,
                end: (column_start + 1).min(column_end),
            });
        if span.start < column_start || span.start >= column_end {
            continue;
        }

        let span_start = span.start.max(column_start).min(column_end);
        let span_end = span.end.max(span_start + 1).min(column_end);
        let start_byte = char_byte_offsets.get(span_start).copied().unwrap_or(0) as usize;
        let end_byte = char_byte_offsets
            .get(span_end)
            .copied()
            .unwrap_or(text.len() as u32) as usize;
        let glyph_text = text.get(start_byte..end_byte).unwrap_or("").to_string();
        let placement = placements
            .get(span.start)
            .cloned()
            .unwrap_or(VerticalCharPlacement {
                advance: 0.0,
                x_offset: glyph.x_offset,
                y_offset: glyph.y_offset,
            });
        let anchor_y = advances[column_start..span.start].iter().sum::<f64>();
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
            font_alias: glyph.font_alias.clone().unwrap_or_default(),
            font_fallback: Vec::new(),
            font_weight: glyph.font_weight.unwrap_or(400),
            font_style: glyph
                .font_style
                .clone()
                .unwrap_or(crate::font::FontStyle::Normal),
            font_size_px: None,
            font_variation_settings: None,
            font_feature_settings: None,
            fill: None,
            text_strokes: None,
            text_shadows: None,
            paint_range_index: None,
            origin_x: placement.x_offset,
            origin_y: anchor_y + placement.y_offset,
            x_offset: placement.x_offset,
            y_offset: placement.y_offset,
            x_advance: glyph.x_advance,
            y_advance: glyph.y_advance,
            rotation_deg: glyph.rotation_deg.unwrap_or(0),
            baseline_rotation_deg: None,
            inline_scale: None,
            synthetic_kind: None,
            outline_writing_mode: None,
            absolute_position: None,
        });
    }

    positioned
}

// ---------------------------------------------------------------------------
// Result building
// ---------------------------------------------------------------------------

#[cfg(test)]
pub(super) fn build_vertical_result(
    truncated_columns: Vec<Line>,
    total_column_count: usize,
    line_height_px: f64,
    font_size_px: f64,
    kinsoku_unresolved: bool,
    warnings: Vec<TextWarning>,
) -> TextLayoutResult {
    build_vertical_result_with_constraints(
        truncated_columns,
        total_column_count,
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
    reason = "vertical result construction combines layout metrics, constraints, and warnings"
)]
pub(super) fn build_vertical_result_with_constraints(
    truncated_columns: Vec<Line>,
    total_column_count: usize,
    line_height_px: f64,
    font_size_px: f64,
    kinsoku_unresolved: bool,
    max_width: Option<f64>,
    max_height: Option<f64>,
    warnings: Vec<TextWarning>,
) -> TextLayoutResult {
    let total_width = truncated_columns.len() as f64 * line_height_px;
    let mut max_column_h: f64 = 0.0;
    for col in &truncated_columns {
        if col.width > max_column_h {
            max_column_h = col.width;
        }
    }

    let has_overflow = total_column_count > truncated_columns.len();
    let overflow = if kinsoku_unresolved {
        TextOverflow::kinsoku_unresolved()
    } else if has_overflow {
        TextOverflow::overflow("columns truncated by maxLines")
    } else if let Some(constraint_overflow) =
        detect_constraint_overflow(total_width, max_column_h, max_width, max_height)
    {
        constraint_overflow
    } else {
        TextOverflow::none()
    };

    TextLayoutResult {
        lines: truncated_columns,
        bbox: TextBBox {
            x: 0.0,
            y: 0.0,
            w: total_width,
            h: max_column_h,
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
