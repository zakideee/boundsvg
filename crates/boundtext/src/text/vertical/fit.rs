use super::column_breaking::{VerticalBreakResult, break_vertical_columns};
use super::common::{language_to_option_string, language_to_str};
use super::shape::shape_text_vertical;
use crate::font::FontContext;
use crate::font::line_metrics::resolve_line_metrics_for_style;
use crate::font::shaping::ShapeOptions;
use crate::text::engine::{apply_feature_settings_to_lines, apply_variation_settings_to_lines};
use crate::text::kinsoku::{get_hanging_chars, get_kinsoku_profile};
use crate::text::types::{
    Line, TextBBox, TextLayoutRequest, TextLayoutResult, TextOrientation, TextOverflow,
    TextWarning, build_notdef_warnings, collect_notdef_from_glyphs,
};

// ---------------------------------------------------------------------------
// Vertical fit (binary search)
// ---------------------------------------------------------------------------

/// Default minimum font size for shrink (px).
const DEFAULT_MIN_FONT_SIZE: f64 = 8.0;
/// Default convergence epsilon (px).
const DEFAULT_EPSILON: f64 = 0.25;
/// Default max binary search iterations.
const DEFAULT_MAX_ITERATIONS: usize = 12;
/// Default max font size multiplier for grow.
const DEFAULT_GROW_MULTIPLIER: f64 = 4.0;

fn resolve_line_height(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
) -> f64 {
    resolve_line_metrics_for_style(
        font_ctx.registry,
        font_ctx.fallback_registry,
        font_ctx.families,
        font_ctx.weight,
        font_ctx.style,
        font_size_px,
        req.line_height,
        req.line_height_px,
    )
    .line_height_px
}

/// Check if vertical text fits within constraints.
///
/// `all_placed` must be false when maxLines truncation dropped columns —
/// a layout that silently lost text is never "fitting".
pub(super) fn vertical_text_fits(
    columns: &[Line],
    req: &TextLayoutRequest,
    line_height_px: f64,
    all_placed: bool,
) -> bool {
    if !all_placed {
        return false;
    }
    let total_width = columns.len() as f64 * line_height_px;
    if total_width > req.max_width {
        return false;
    }

    // Check maxLines (max columns for vertical)
    if let Some(max) = req.max_lines {
        if columns.len() > max {
            return false;
        }
    }

    // Check height constraint (each column's height)
    if let Some(max_h) = req.max_height {
        for col in columns {
            if col.width > max_h {
                return false;
            }
        }
    }

    true
}

/// Layout vertical text at a specific font size (for fit binary search).
fn layout_vertical_at_size(
    req: &TextLayoutRequest,
    font_size_px: f64,
    font_ctx: &FontContext<'_>,
) -> Option<VerticalAtSizeResult> {
    let line_height_px = resolve_line_height(req, font_ctx, font_size_px);
    let kinsoku_profile = get_kinsoku_profile(Some(language_to_str(req.language)));
    let hanging_chars = get_hanging_chars(req.hanging_punctuation);

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

    // Same white-space preprocessing as the non-fit vertical path.
    let preprocessed_text = crate::text::types::preprocess_text_for_white_space(
        req.text,
        req.white_space,
        req.tab_size,
    );
    let text = preprocessed_text.as_str();

    let glyphs = shape_text_vertical(
        font_ctx,
        text,
        font_size_px,
        crate::text::fit::scaled_letter_spacing(req, font_size_px),
        &shape_options,
    )?;

    // Collect notdef warnings from shaped glyphs
    let primary_alias = font_ctx.families.first().map_or("", |s| s.as_str());
    let warnings = build_notdef_warnings(&collect_notdef_from_glyphs(&glyphs, text, primary_alias));

    let max_column_height = req.max_height.unwrap_or(req.max_width);

    let VerticalBreakResult {
        mut columns,
        kinsoku_unresolved,
    } = break_vertical_columns(
        &glyphs,
        text,
        max_column_height,
        req.effective_wrap(),
        font_size_px,
        line_height_px,
        kinsoku_profile,
        req.uax14_breaks,
        hanging_chars,
        req.has_forced_newline_breaks(),
    );

    // Propagate variation/feature settings to positioned glyphs
    apply_variation_settings_to_lines(&mut columns, &req.font_variation_settings);
    apply_feature_settings_to_lines(&mut columns, &req.font_feature_settings);

    let all_placed = req.max_lines.is_none_or(|max| columns.len() <= max);
    let truncated_columns = if let Some(max) = req.max_lines {
        if columns.len() > max {
            columns.into_iter().take(max).collect()
        } else {
            columns
        }
    } else {
        columns
    };

    let total_width = truncated_columns.len() as f64 * line_height_px;
    let mut max_column_h: f64 = 0.0;
    for col in &truncated_columns {
        if col.width > max_column_h {
            max_column_h = col.width;
        }
    }

    Some(VerticalAtSizeResult {
        columns: truncated_columns,
        line_height_px,
        total_width,
        max_column_h,
        kinsoku_unresolved,
        warnings,
        all_placed,
    })
}

struct VerticalAtSizeResult {
    columns: Vec<Line>,
    line_height_px: f64,
    total_width: f64,
    max_column_h: f64,
    kinsoku_unresolved: bool,
    warnings: Vec<TextWarning>,
    /// False when maxLines truncation dropped columns at this size.
    all_placed: bool,
}

/// Shrink-to-fit for vertical text with boundary evaluation.
///
/// Same algorithm as horizontal `fit_shrink`: evaluate boundaries first,
/// then binary search with invariant `lo=fit, hi=overflow`.
pub(super) fn fit_vertical_shrink(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
) -> Option<TextLayoutResult> {
    let min_size = req
        .min_font_size_px
        .unwrap_or(DEFAULT_MIN_FONT_SIZE)
        .max(f64::EPSILON)
        .min(req.font_size_px);
    let epsilon = req.shrink_epsilon_px.unwrap_or(DEFAULT_EPSILON);
    let max_iter = req.shrink_max_iterations.unwrap_or(DEFAULT_MAX_ITERATIONS);

    // Step 1: check if original size already fits
    let at_initial = layout_vertical_at_size(req, req.font_size_px, font_ctx)?;
    if vertical_text_fits(
        &at_initial.columns,
        req,
        at_initial.line_height_px,
        at_initial.all_placed,
    ) {
        let overflow = if at_initial.kinsoku_unresolved {
            TextOverflow::kinsoku_unresolved()
        } else {
            TextOverflow::none()
        };
        return Some(build_vertical_fit_result(
            at_initial,
            req.font_size_px,
            overflow,
        ));
    }

    // Step 2: check if min size fits
    let at_min = layout_vertical_at_size(req, min_size, font_ctx)?;
    if !vertical_text_fits(
        &at_min.columns,
        req,
        at_min.line_height_px,
        at_min.all_placed,
    ) {
        if req.ellipsis
            && req.max_lines.is_some()
            && let Some(layout_result) = layout_vertical_ellipsis_at_size(req, font_ctx, min_size)
        {
            return Some(layout_result);
        }
        let overflow = if at_min.kinsoku_unresolved {
            TextOverflow::kinsoku_unresolved()
        } else {
            TextOverflow::cannot_fit()
        };
        return Some(build_vertical_fit_result(at_min, min_size, overflow));
    }

    // Step 3: binary search -- invariant: lo fits, hi overflows
    let mut lo = min_size;
    let mut hi = req.font_size_px;
    let mut best_size = lo;

    for _ in 0..max_iter {
        if hi - lo < epsilon {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        let at_mid = layout_vertical_at_size(req, mid, font_ctx)?;
        if vertical_text_fits(
            &at_mid.columns,
            req,
            at_mid.line_height_px,
            at_mid.all_placed,
        ) {
            lo = mid;
            best_size = mid;
        } else {
            hi = mid;
        }
    }

    // Step 4: build final layout at best size
    let at_best = layout_vertical_at_size(req, best_size, font_ctx)?;
    let overflow = if at_best.kinsoku_unresolved {
        TextOverflow::kinsoku_unresolved()
    } else {
        TextOverflow::none()
    };
    Some(build_vertical_fit_result(at_best, best_size, overflow))
}

fn layout_vertical_ellipsis_at_size(
    req: &TextLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
) -> Option<TextLayoutResult> {
    let final_request = TextLayoutRequest {
        font_size_px,
        letter_spacing_px: crate::text::fit::scaled_letter_spacing(req, font_size_px),
        fit: crate::text::types::FitMode::None,
        min_font_size_px: None,
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
        ..req.clone()
    };
    let mut layout_result = super::layout_vertical_text(&final_request, font_ctx)?;
    if layout_result.lines.is_empty() {
        layout_result.overflow = TextOverflow::cannot_fit();
    }
    Some(layout_result)
}

/// Grow-to-fit for vertical text with boundary evaluation.
///
/// Same algorithm as horizontal `fit_grow`: evaluate boundaries first,
/// then binary search with invariant `lo=fit, hi=overflow`.
pub(super) fn fit_vertical_grow(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
) -> Option<TextLayoutResult> {
    let max_size = req
        .max_font_size_px
        .unwrap_or(req.font_size_px * DEFAULT_GROW_MULTIPLIER)
        .max(req.font_size_px);
    let epsilon = req.grow_epsilon_px.unwrap_or(DEFAULT_EPSILON);
    let max_iter = req.grow_max_iterations.unwrap_or(DEFAULT_MAX_ITERATIONS);

    // Step 1: initial size must fit -- otherwise grow is impossible
    let at_initial = layout_vertical_at_size(req, req.font_size_px, font_ctx)?;
    if !vertical_text_fits(
        &at_initial.columns,
        req,
        at_initial.line_height_px,
        at_initial.all_placed,
    ) {
        let overflow = if at_initial.kinsoku_unresolved {
            TextOverflow::kinsoku_unresolved()
        } else {
            TextOverflow::overflow("initial font size does not fit; cannot grow")
        };
        return Some(build_vertical_fit_result(
            at_initial,
            req.font_size_px,
            overflow,
        ));
    }

    // Step 2: check if max size fits -- if so, use it directly
    let at_max = layout_vertical_at_size(req, max_size, font_ctx)?;
    if vertical_text_fits(
        &at_max.columns,
        req,
        at_max.line_height_px,
        at_max.all_placed,
    ) {
        let overflow = if at_max.kinsoku_unresolved {
            TextOverflow::kinsoku_unresolved()
        } else {
            TextOverflow::none()
        };
        return Some(build_vertical_fit_result(at_max, max_size, overflow));
    }

    // Step 3: binary search -- invariant: lo fits, hi overflows
    let mut lo = req.font_size_px;
    let mut hi = max_size;
    let mut best_size = lo;

    for _ in 0..max_iter {
        if hi - lo < epsilon {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        let at_mid = layout_vertical_at_size(req, mid, font_ctx)?;
        if vertical_text_fits(
            &at_mid.columns,
            req,
            at_mid.line_height_px,
            at_mid.all_placed,
        ) {
            lo = mid;
            best_size = mid;
        } else {
            hi = mid;
        }
    }

    // Step 4: build final layout at best size
    let at_best = layout_vertical_at_size(req, best_size, font_ctx)?;
    let overflow = if at_best.kinsoku_unresolved {
        TextOverflow::kinsoku_unresolved()
    } else {
        TextOverflow::none()
    };
    Some(build_vertical_fit_result(at_best, best_size, overflow))
}

/// Build a `TextLayoutResult` from a `VerticalAtSizeResult`.
fn build_vertical_fit_result(
    at_size: VerticalAtSizeResult,
    font_size_px: f64,
    overflow: TextOverflow,
) -> TextLayoutResult {
    TextLayoutResult {
        lines: at_size.columns,
        bbox: TextBBox {
            x: 0.0,
            y: 0.0,
            w: at_size.total_width,
            h: at_size.max_column_h,
        },
        chosen_font_size_px: font_size_px,
        overflow,
        source_text: None,
        display_text: None,
        unit_map: None,
        warnings: at_size.warnings,
        inline_box_decorations: Vec::new(),
        text_decorations: Vec::new(),
        inline_rects: Vec::new(),
    }
}
