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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Perform full vertical text layout: shaping -> column breaking -> result building.
///
/// This is the Rust equivalent of TS `layoutVerticalText()`.
#[must_use]
pub fn layout_vertical_text(
    req: &crate::text::types::TextLayoutRequest,
    font_ctx: &FontContext<'_>,
) -> Option<TextLayoutResult> {
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
    let truncated_columns = if let Some(max) = req.max_lines {
        if columns.len() > max {
            let mut kept: Vec<Line> = columns.into_iter().take(max).collect();
            if req.ellipsis && max > 0 {
                // Apply a vertical-aware ellipsis: re-lay-out progressively
                // shorter text until "<prefix>…" fits within `max` columns.
                // Re-running the same shape/break machinery keeps positions
                // consistent with a first-class layout of the final text.
                let kept_text: String = kept.iter().map(|c| c.text.as_str()).collect();
                let clusters = grapheme_split(&kept_text);
                for cut in (0..=clusters.len()).rev() {
                    let candidate: String = clusters[..cut].concat() + "\u{2026}";
                    let Some(cand_glyphs) = shape_text_vertical(
                        font_ctx,
                        &candidate,
                        req.font_size_px,
                        req.letter_spacing_px,
                        &shape_options,
                    ) else {
                        continue;
                    };
                    let VerticalBreakResult {
                        columns: mut cand_columns,
                        kinsoku_unresolved: _,
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
                    let fits = cand_columns.len() <= max
                        && cand_columns
                            .iter()
                            .all(|c| c.width <= max_column_height + 0.01);
                    if fits {
                        apply_variation_settings_to_lines(
                            &mut cand_columns,
                            &req.font_variation_settings,
                        );
                        apply_feature_settings_to_lines(
                            &mut cand_columns,
                            &req.font_feature_settings,
                        );
                        kept = cand_columns;
                        break;
                    }
                }
            }
            kept
        } else {
            columns
        }
    } else {
        columns
    };

    Some(build_vertical_result_with_constraints(
        truncated_columns,
        total_column_count,
        line_height_px,
        req.font_size_px,
        kinsoku_unresolved,
        Some(req.max_width),
        req.max_height,
        warnings,
    ))
}
