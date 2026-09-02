use super::column_breaking::{VerticalBreakResult, break_vertical_columns};
use super::common::{language_to_option_string, language_to_str};
use super::fit::{fit_vertical_grow, fit_vertical_shrink};
use super::layout::build_vertical_result_with_constraints;
use super::shape::shape_text_vertical;
use crate::font::FontContext;
use crate::font::line_metrics::resolve_line_metrics_for_style;
use crate::font::shaping::ShapeOptions;
use crate::text::engine::{apply_feature_settings_to_lines, apply_variation_settings_to_lines};
use crate::text::grapheme::grapheme_split;
use crate::text::kinsoku::{get_hanging_chars, get_kinsoku_profile};
use crate::text::types::{
    FitMode, Line, TextLayoutResult, TextOrientation, build_notdef_warnings,
    collect_notdef_from_glyphs,
};

fn shape_vertical_ellipsis_candidate(
    font_ctx: &FontContext<'_>,
    prefix: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
    shape_options: &ShapeOptions,
) -> Result<Vec<crate::font::shaping::GlyphInfo>, crate::TextLayoutError> {
    let mut prefix_glyphs = shape_text_vertical(
        font_ctx,
        prefix,
        font_size_px,
        letter_spacing_px,
        shape_options,
    )?;
    let mut marker_glyphs = shape_text_vertical(
        font_ctx,
        "\u{2026}",
        font_size_px,
        letter_spacing_px,
        shape_options,
    )?;
    if !prefix_glyphs.is_empty()
        && !marker_glyphs.is_empty()
        && letter_spacing_px != 0.0
        && let Some(last_prefix_glyph) = prefix_glyphs.last_mut()
    {
        last_prefix_glyph.y_advance = crate::font::shaping::add_vertical_inline_tracking(
            last_prefix_glyph.y_advance,
            letter_spacing_px,
        );
    }
    let marker_cluster_offset = u32::try_from(prefix.len()).unwrap_or(u32::MAX);
    for marker_glyph in &mut marker_glyphs {
        marker_glyph.cluster = marker_glyph.cluster.saturating_add(marker_cluster_offset);
    }
    prefix_glyphs.extend(marker_glyphs);
    Ok(prefix_glyphs)
}

fn mark_vertical_ellipsis(columns: &mut [Line], marker_cluster_start: u32) {
    for glyph in columns
        .iter_mut()
        .filter_map(|column| column.positioned_glyphs.as_mut())
        .flatten()
    {
        if glyph.cluster_end <= marker_cluster_start {
            continue;
        }
        glyph.source_start = None;
        glyph.source_end = None;
        glyph.source_role = None;
        glyph.decoration_source_start = None;
        glyph.decoration_source_end = None;
        glyph.synthetic_kind = Some("ellipsis".to_string());
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Perform direct vertical layout: shaping -> column breaking -> result building.
///
/// # Errors
///
/// Returns the first font, shaping, fit, or ellipsis failure.
pub fn layout_vertical_text(
    req: &crate::text::types::TextLayoutRequest,
    font_ctx: &FontContext<'_>,
) -> Result<TextLayoutResult, crate::TextLayoutError> {
    // Handle fit=shrink/grow via vertical-specific binary search
    if req.fit == FitMode::Shrink {
        return fit_vertical_shrink(req, font_ctx);
    }
    if req.fit == FitMode::Grow {
        return fit_vertical_grow(req, font_ctx);
    }

    let line_height_px = resolve_line_metrics_for_style(
        font_ctx.registry,
        font_ctx.fallback_registry,
        font_ctx.families,
        font_ctx.weight,
        font_ctx.style,
        req.font_size_px,
        req.line_height,
        req.line_height_px,
    )
    .line_height_px;
    let kinsoku_profile = get_kinsoku_profile(Some(language_to_str(req.language)));
    let hanging_chars = get_hanging_chars(req.hanging_punctuation);

    // Shape text with vertical options
    let shape_options = ShapeOptions {
        writing_mode: Some("vertical-rl".to_string()),
        language: language_to_option_string(req.language),
        vertical_feature_priority: None,
        text_orientation: match req.text_orientation {
            TextOrientation::Upright => Some("upright".to_string()),
            TextOrientation::Mixed => None,
        },
        font_variation_settings: req.font_variation_settings.clone(),
        font_feature_settings: req.font_feature_settings.clone(),
    };

    // Honor white-space preprocessing before shaping, same as the
    // horizontal path (normal/nowrap collapse runs of spaces; pre-wrap
    // expands tabs by tabSize).
    let preprocessed_text = crate::text::types::preprocess_text_for_white_space(
        req.text,
        req.white_space,
        req.tab_size,
    );
    let text = preprocessed_text.as_str();

    let glyphs = shape_text_vertical(
        font_ctx,
        text,
        req.font_size_px,
        req.letter_spacing_px,
        &shape_options,
    )?;

    // Collect notdef warnings from shaped glyphs
    let primary_alias = font_ctx.families.first().map_or("", |s| s.as_str());
    let warnings = build_notdef_warnings(&collect_notdef_from_glyphs(&glyphs, text, primary_alias));

    // Use maxHeight as the column height constraint, fall back to maxWidth
    let max_column_height = req.max_height.unwrap_or(req.max_width);

    let VerticalBreakResult {
        mut columns,
        kinsoku_unresolved,
    } = break_vertical_columns(
        &glyphs,
        text,
        max_column_height,
        req.effective_wrap(),
        req.font_size_px,
        line_height_px,
        kinsoku_profile,
        req.uax14_breaks,
        hanging_chars,
        req.has_forced_newline_breaks(),
    );

    // Propagate variation/feature settings to positioned glyphs
    apply_variation_settings_to_lines(&mut columns, &req.font_variation_settings);
    apply_feature_settings_to_lines(&mut columns, &req.font_feature_settings);

    // Enforce maxLines (max number of columns)
    let total_column_count = columns.len();
    let mut projected_display_text = None;
    let mut selected_warnings = warnings;
    let mut has_selected_kinsoku_violation = kinsoku_unresolved;
    let truncated_columns = if let Some(max) = req.max_lines {
        if columns.len() > max {
            let mut kept: Vec<Line> = columns.into_iter().take(max).collect();
            if req.ellipsis && max > 0 {
                let clusters = grapheme_split(text);
                let cluster_refs = clusters.iter().map(String::as_str).collect::<Vec<_>>();
                let legal_candidates = (0..clusters.len()).filter(|keep| {
                    kinsoku_profile.is_none_or(|profile| {
                        crate::text::kinsoku::is_valid_ellipsis_boundary(
                            &cluster_refs,
                            *keep,
                            profile,
                        )
                    })
                });
                let selected = crate::text::ellipsis_plan::try_select_longest_fitting(
                    legal_candidates,
                    |keep| {
                        let prefix = clusters[..keep].concat();
                        let candidate = format!("{prefix}\u{2026}");
                        let cand_glyphs = shape_vertical_ellipsis_candidate(
                            font_ctx,
                            &prefix,
                            req.font_size_px,
                            req.letter_spacing_px,
                            &shape_options,
                        )?;
                        let marker_cluster_start = u32::try_from(prefix.len()).unwrap_or(u32::MAX);
                        let VerticalBreakResult {
                            mut columns,
                            kinsoku_unresolved,
                        } = break_vertical_columns(
                            &cand_glyphs,
                            &candidate,
                            max_column_height,
                            req.effective_wrap(),
                            req.font_size_px,
                            line_height_px,
                            kinsoku_profile,
                            req.uax14_breaks,
                            hanging_chars,
                            false,
                        );
                        mark_vertical_ellipsis(&mut columns, marker_cluster_start);
                        Ok(Some((candidate, cand_glyphs, columns, kinsoku_unresolved)))
                    },
                    |(_, _, candidate_columns, _)| {
                        candidate_columns.len() <= max
                            && candidate_columns
                                .iter()
                                .all(|column| column.width <= max_column_height + 0.01)
                            && candidate_columns.len() as f64 * line_height_px
                                <= req.max_width + 0.01
                    },
                )?;
                if let Some((
                    _keep,
                    (display_text, cand_glyphs, mut columns, candidate_kinsoku_unresolved),
                )) = selected
                {
                    apply_variation_settings_to_lines(&mut columns, &req.font_variation_settings);
                    apply_feature_settings_to_lines(&mut columns, &req.font_feature_settings);
                    selected_warnings = build_notdef_warnings(&collect_notdef_from_glyphs(
                        &cand_glyphs,
                        &display_text,
                        primary_alias,
                    ));
                    has_selected_kinsoku_violation = candidate_kinsoku_unresolved;
                    projected_display_text = Some(display_text);
                    kept = columns;
                } else {
                    selected_warnings = Vec::new();
                    has_selected_kinsoku_violation = false;
                    projected_display_text = Some(String::new());
                    kept.clear();
                }
            }
            kept
        } else {
            columns
        }
    } else {
        columns
    };

    let mut layout_result = build_vertical_result_with_constraints(
        truncated_columns,
        total_column_count,
        line_height_px,
        req.font_size_px,
        has_selected_kinsoku_violation,
        Some(req.max_width),
        req.max_height,
        selected_warnings,
    );
    if let Some(display_text) = projected_display_text {
        layout_result.source_text = Some(text.to_string());
        layout_result.display_text = Some(display_text);
    }
    Ok(layout_result)
}
