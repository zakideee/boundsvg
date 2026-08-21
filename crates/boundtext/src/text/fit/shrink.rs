use super::super::ellipsis;
use super::super::kinsoku::{get_hanging_chars, get_kinsoku_profile};
use super::super::paragraph;
use super::super::types::{TextLayoutRequest, TextOverflow, TextSpanInput};
use super::common::{
    DEFAULT_EPSILON, DEFAULT_MAX_ITERATIONS, DEFAULT_MIN_FONT_SIZE, build_result,
    collect_warnings_from_lines, fit_build_shaped, fit_build_shaped_failure, language_to_str,
    layout_at_size, measure_fits_at_size, resolve_line_height, text_fits,
};
use crate::font::FontContext;
use crate::font::shaping::ShapeOptions;

// ---------------------------------------------------------------------------
// Horizontal fit
// ---------------------------------------------------------------------------

/// Perform shrink-to-fit with boundary evaluation.
///
/// Algorithm:
/// 1. Evaluate at `req.font_size_px` — if it fits, return immediately.
/// 2. Evaluate at `min_font_size` — if it doesn't fit, try ellipsis fallback
///    (when `req.ellipsis == true`) or return `cannot_fit`.
/// 3. Binary search `[min_font_size, font_size_px]` with invariant
///    `lo=fit, hi=overflow`.
/// 4. Build final layout once at the best found size.
#[must_use]
pub fn fit_shrink(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    min_font_size_px: Option<f64>,
    shrink_epsilon_px: Option<f64>,
    shrink_max_iterations: Option<usize>,
) -> Option<crate::text::types::TextLayoutResult> {
    fit_shrink_internal(
        req,
        font_ctx,
        min_font_size_px,
        shrink_epsilon_px,
        shrink_max_iterations,
        false,
    )
}

pub(crate) fn fit_shrink_with_unit_metadata(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    min_font_size_px: Option<f64>,
    shrink_epsilon_px: Option<f64>,
    shrink_max_iterations: Option<usize>,
) -> Option<crate::text::types::TextLayoutResult> {
    fit_shrink_internal(
        req,
        font_ctx,
        min_font_size_px,
        shrink_epsilon_px,
        shrink_max_iterations,
        true,
    )
}

fn fit_shrink_internal(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    min_font_size_px: Option<f64>,
    shrink_epsilon_px: Option<f64>,
    shrink_max_iterations: Option<usize>,
    include_unit_metadata: bool,
) -> Option<crate::text::types::TextLayoutResult> {
    let min_size = min_font_size_px
        .unwrap_or(DEFAULT_MIN_FONT_SIZE)
        .max(f64::EPSILON)
        .min(req.font_size_px);
    let epsilon = shrink_epsilon_px.unwrap_or(DEFAULT_EPSILON);
    let max_iter = shrink_max_iterations.unwrap_or(DEFAULT_MAX_ITERATIONS);

    // Try shaped path: shape once, binary search with measure_paragraph only.
    if req.spans.is_none_or(<[TextSpanInput]>::is_empty) {
        let shape_options = ShapeOptions {
            font_variation_settings: req.font_variation_settings.clone(),
            font_feature_settings: req.font_feature_settings.clone(),
            ..ShapeOptions::default()
        };
        let expanded;
        let text = if req.has_forced_newline_breaks() {
            expanded = super::super::types::expand_tabs(req.text, req.tab_size);
            &expanded
        } else {
            req.text
        };
        if let Some(pp) = paragraph::shape_paragraph(
            text,
            font_ctx,
            req.language,
            req.effective_wrap(),
            req.hanging_punctuation,
            &shape_options,
            req.uax14_breaks,
            req.letter_spacing_px,
        ) {
            return fit_shrink_shaped(
                req,
                font_ctx,
                &pp,
                min_size,
                epsilon,
                max_iter,
                include_unit_metadata,
            );
        }
    }

    // Fallback: existing path (multi-font fallback, inline runs, etc.)
    let kinsoku_profile = get_kinsoku_profile(Some(language_to_str(req.language)));
    let hanging_chars = get_hanging_chars(req.hanging_punctuation);
    let shape_options = ShapeOptions {
        font_variation_settings: req.font_variation_settings.clone(),
        font_feature_settings: req.font_feature_settings.clone(),
        ..ShapeOptions::default()
    };

    let primary_alias = font_ctx.families.first().map_or("", |s| s.as_str());

    // Step 1: check if original size already fits
    let initial_fits = measure_fits_at_size(
        req,
        font_ctx,
        req.font_size_px,
        &shape_options,
        kinsoku_profile,
        hanging_chars,
    )?;
    if initial_fits {
        let (lines, lh, kinsoku_unresolved) = layout_at_size(
            req,
            font_ctx,
            req.font_size_px,
            &shape_options,
            kinsoku_profile,
            hanging_chars,
        )?;
        let overflow = if kinsoku_unresolved {
            TextOverflow::kinsoku_unresolved()
        } else {
            TextOverflow::none()
        };
        let warnings = collect_warnings_from_lines(&lines, primary_alias);
        return Some(build_result(
            lines,
            req.font_size_px,
            lh,
            overflow,
            warnings,
        ));
    }

    // Step 2: check if min size fits
    let min_fits = measure_fits_at_size(
        req,
        font_ctx,
        min_size,
        &shape_options,
        kinsoku_profile,
        hanging_chars,
    )?;
    if !min_fits {
        // Try ellipsis fallback at min size when enabled
        if req.ellipsis {
            return shrink_ellipsis_fallback(
                req,
                font_ctx,
                min_size,
                &shape_options,
                kinsoku_profile,
                hanging_chars,
                include_unit_metadata,
            );
        }
        // Cannot fit even at min size
        let (lines, lh, kinsoku_unresolved) = layout_at_size(
            req,
            font_ctx,
            min_size,
            &shape_options,
            kinsoku_profile,
            hanging_chars,
        )?;
        let overflow = if kinsoku_unresolved {
            TextOverflow::kinsoku_unresolved()
        } else {
            TextOverflow::cannot_fit()
        };
        let warnings = collect_warnings_from_lines(&lines, primary_alias);
        return Some(build_result(lines, min_size, lh, overflow, warnings));
    }

    // Step 3: binary search — invariant: lo fits, hi overflows
    let mut lo = min_size;
    let mut hi = req.font_size_px;
    let mut best_size = lo;

    for _ in 0..max_iter {
        if hi - lo < epsilon {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        let fits = measure_fits_at_size(
            req,
            font_ctx,
            mid,
            &shape_options,
            kinsoku_profile,
            hanging_chars,
        )?;
        if fits {
            lo = mid;
            best_size = mid;
        } else {
            hi = mid;
        }
    }

    // Step 4: build final layout at best size
    let (lines, lh, kinsoku_unresolved) = layout_at_size(
        req,
        font_ctx,
        best_size,
        &shape_options,
        kinsoku_profile,
        hanging_chars,
    )?;
    let overflow = if kinsoku_unresolved {
        TextOverflow::kinsoku_unresolved()
    } else {
        TextOverflow::none()
    };
    let warnings = collect_warnings_from_lines(&lines, primary_alias);
    Some(build_result(lines, best_size, lh, overflow, warnings))
}

/// Ellipsis fallback when shrink cannot fit at min font size.
pub(super) fn shrink_ellipsis_fallback(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    shape_options: &ShapeOptions,
    kinsoku_profile: Option<&crate::text::kinsoku::KinsokuProfile>,
    hanging_chars: Option<&[char]>,
    include_unit_metadata: bool,
) -> Option<crate::text::types::TextLayoutResult> {
    let line_metrics = super::common::resolve_line_metrics(req, font_ctx, font_size_px);
    let line_height_px = line_metrics.line_height_px;
    let primary_alias = font_ctx.families.first().map_or("", |s| s.as_str());

    // Single-line ellipsis uses the same condition as the normal layout path.
    if req.max_lines == Some(1) {
        let ellipsis_line = if include_unit_metadata {
            ellipsis::apply_ellipsis_with_unit_metadata(
                req.text,
                req.max_width,
                font_ctx,
                font_size_px,
                req.letter_spacing_px,
                line_height_px,
                line_metrics.baseline_offset_px,
                kinsoku_profile,
                shape_options,
            )
        } else {
            ellipsis::apply_ellipsis(
                req.text,
                req.max_width,
                font_ctx,
                font_size_px,
                req.letter_spacing_px,
                line_height_px,
                line_metrics.baseline_offset_px,
                kinsoku_profile,
                shape_options,
            )
        };
        if let Some(ellipsis_line) = ellipsis_line {
            let ellipsis_lines = vec![ellipsis_line];
            if text_fits(
                &ellipsis_lines,
                req.max_width,
                req.max_lines,
                req.max_height,
                line_height_px,
            ) {
                let warnings = collect_warnings_from_lines(&ellipsis_lines, primary_alias);
                return Some(build_result(
                    ellipsis_lines,
                    font_size_px,
                    line_height_px,
                    TextOverflow::overflow("ellipsis applied at min font size"),
                    warnings,
                ));
            }
        }
    }

    // Multi-line ellipsis
    if let Some(max_lines) = req.max_lines {
        if max_lines > 1 {
            let (lines, lh, _) = layout_at_size(
                req,
                font_ctx,
                font_size_px,
                shape_options,
                kinsoku_profile,
                hanging_chars,
            )?;
            let ellipsis_lines = if include_unit_metadata {
                ellipsis::apply_multiline_ellipsis_with_unit_metadata(
                    &lines,
                    max_lines,
                    req.max_width,
                    font_ctx,
                    font_size_px,
                    req.letter_spacing_px,
                    lh,
                    line_metrics.baseline_offset_px,
                    kinsoku_profile,
                    shape_options,
                )
            } else {
                ellipsis::apply_multiline_ellipsis(
                    &lines,
                    max_lines,
                    req.max_width,
                    font_ctx,
                    font_size_px,
                    req.letter_spacing_px,
                    lh,
                    line_metrics.baseline_offset_px,
                    kinsoku_profile,
                    shape_options,
                )
            };
            if let Some(ellipsis_lines) = ellipsis_lines {
                if text_fits(
                    &ellipsis_lines,
                    req.max_width,
                    req.max_lines,
                    req.max_height,
                    lh,
                ) {
                    let warnings = collect_warnings_from_lines(&ellipsis_lines, primary_alias);
                    return Some(build_result(
                        ellipsis_lines,
                        font_size_px,
                        lh,
                        TextOverflow::overflow("ellipsis applied at min font size"),
                        warnings,
                    ));
                }
            }
        }
    }

    // Even ellipsis didn't help
    let (lines, lh, _) = layout_at_size(
        req,
        font_ctx,
        font_size_px,
        shape_options,
        kinsoku_profile,
        hanging_chars,
    )?;
    let warnings = collect_warnings_from_lines(&lines, primary_alias);
    Some(build_result(
        lines,
        font_size_px,
        lh,
        TextOverflow::cannot_fit(),
        warnings,
    ))
}

// ---------------------------------------------------------------------------
// Shaped-path fit (shaping once, relayout per iteration)
// ---------------------------------------------------------------------------

/// Shrink-to-fit using a `ShapedParagraph`. Shapes once; the binary search
/// only runs `measure_paragraph` (pure arithmetic on cached advances).
fn fit_shrink_shaped(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    pp: &paragraph::ShapedParagraph,
    min_size: f64,
    epsilon: f64,
    max_iter: usize,
    include_unit_metadata: bool,
) -> Option<crate::text::types::TextLayoutResult> {
    // Step 1: does original size already fit?
    let lh = resolve_line_height(req, font_ctx, req.font_size_px);
    let measurement = paragraph::measure_paragraph(
        pp,
        req.font_size_px,
        lh,
        req.max_width,
        req.effective_wrap(),
        req.has_forced_newline_breaks(),
    );
    if measurement.fits(req.max_width, req.max_lines, req.max_height, lh) {
        return Some(fit_build_shaped(
            req,
            font_ctx,
            pp,
            req.font_size_px,
            measurement.kinsoku_unresolved,
        ));
    }

    // Step 2: does min size fit?
    let lh_min = resolve_line_height(req, font_ctx, min_size);
    let m_min = paragraph::measure_paragraph(
        pp,
        min_size,
        lh_min,
        req.max_width,
        req.effective_wrap(),
        req.has_forced_newline_breaks(),
    );
    if !m_min.fits(req.max_width, req.max_lines, req.max_height, lh_min) {
        // Ellipsis fallback still needs re-shaping (truncated text) — use existing path.
        if req.ellipsis {
            let kinsoku_profile = get_kinsoku_profile(Some(language_to_str(req.language)));
            let hanging_chars = get_hanging_chars(req.hanging_punctuation);
            let shape_options = ShapeOptions {
                font_variation_settings: req.font_variation_settings.clone(),
                font_feature_settings: req.font_feature_settings.clone(),
                ..ShapeOptions::default()
            };
            return shrink_ellipsis_fallback(
                req,
                font_ctx,
                min_size,
                &shape_options,
                kinsoku_profile,
                hanging_chars,
                include_unit_metadata,
            );
        }
        // Cannot fit even at min size — return all lines without truncation.
        let overflow = if m_min.kinsoku_unresolved {
            TextOverflow::kinsoku_unresolved()
        } else {
            TextOverflow::cannot_fit()
        };
        return Some(fit_build_shaped_failure(
            pp, req, font_ctx, min_size, overflow,
        ));
    }

    // Step 3: binary search — measure_paragraph only (no shaping)
    let mut lo = min_size;
    let mut hi = req.font_size_px;
    let mut best_size = lo;

    for _ in 0..max_iter {
        if hi - lo < epsilon {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        let lh_mid = resolve_line_height(req, font_ctx, mid);
        let m_mid = paragraph::measure_paragraph(
            pp,
            mid,
            lh_mid,
            req.max_width,
            req.effective_wrap(),
            req.has_forced_newline_breaks(),
        );
        if m_mid.fits(req.max_width, req.max_lines, req.max_height, lh_mid) {
            lo = mid;
            best_size = mid;
        } else {
            hi = mid;
        }
    }

    // Step 4: build final layout at best size
    let lh_best = resolve_line_height(req, font_ctx, best_size);
    let m_best = paragraph::measure_paragraph(
        pp,
        best_size,
        lh_best,
        req.max_width,
        req.effective_wrap(),
        req.has_forced_newline_breaks(),
    );
    Some(fit_build_shaped(
        req,
        font_ctx,
        pp,
        best_size,
        m_best.kinsoku_unresolved,
    ))
}
