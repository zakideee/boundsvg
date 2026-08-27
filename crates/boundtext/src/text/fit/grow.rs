use super::super::kinsoku::{get_hanging_chars, get_kinsoku_profile};
use super::super::paragraph;
use super::super::types::{TextLayoutRequest, TextOverflow, TextSpanInput};
use super::common::{
    DEFAULT_EPSILON, DEFAULT_GROW_MULTIPLIER, DEFAULT_MAX_ITERATIONS, build_result,
    collect_warnings_from_lines, fit_build_shaped, fit_build_shaped_failure, language_to_str,
    layout_at_size, measure_fits_at_size, resolve_line_height,
};
use crate::font::FontContext;
use crate::font::shaping::ShapeOptions;

/// Perform grow-to-fit with boundary evaluation.
///
/// Algorithm:
/// 1. Evaluate at `req.font_size_px` — if it doesn't fit, return `overflow`.
/// 2. Evaluate at `max_font_size` — if it fits, return that result.
/// 3. Binary search `[font_size_px, max_font_size]` with invariant
///    `lo=fit, hi=overflow`.
/// 4. Build final layout once at the best found size.
#[must_use]
pub fn fit_grow(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    max_font_size_px: Option<f64>,
    grow_epsilon_px: Option<f64>,
    grow_max_iterations: Option<usize>,
) -> Option<crate::text::types::TextLayoutResult> {
    let max_size = max_font_size_px
        .unwrap_or(req.font_size_px * DEFAULT_GROW_MULTIPLIER)
        .max(req.font_size_px);
    let epsilon = grow_epsilon_px.unwrap_or(DEFAULT_EPSILON);
    let max_iter = grow_max_iterations.unwrap_or(DEFAULT_MAX_ITERATIONS);

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
            return Some(fit_grow_shaped(
                req, font_ctx, &pp, max_size, epsilon, max_iter,
            ));
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

    // Step 1: initial size must fit — otherwise grow is impossible
    let initial_fits = measure_fits_at_size(
        req,
        font_ctx,
        req.font_size_px,
        &shape_options,
        kinsoku_profile,
        hanging_chars,
    )?;
    if !initial_fits {
        let (lines, lh, _) = layout_at_size(
            req,
            font_ctx,
            req.font_size_px,
            &shape_options,
            kinsoku_profile,
            hanging_chars,
        )?;
        let overflow = TextOverflow::overflow("initial font size does not fit; cannot grow");
        let warnings = collect_warnings_from_lines(&lines, primary_alias);
        return Some(build_result(
            lines,
            req.font_size_px,
            lh,
            overflow,
            warnings,
        ));
    }

    // Step 2: check if max size fits — if so, use it directly
    let max_fits = measure_fits_at_size(
        req,
        font_ctx,
        max_size,
        &shape_options,
        kinsoku_profile,
        hanging_chars,
    )?;
    if max_fits {
        let (lines, lh, kinsoku_unresolved) = layout_at_size(
            req,
            font_ctx,
            max_size,
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
        return Some(build_result(lines, max_size, lh, overflow, warnings));
    }

    // Step 3: binary search — invariant: lo fits, hi overflows
    let mut lo = req.font_size_px;
    let mut hi = max_size;
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

/// Grow-to-fit using a `ShapedParagraph`.
fn fit_grow_shaped(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    pp: &paragraph::ShapedParagraph,
    max_size: f64,
    epsilon: f64,
    max_iter: usize,
) -> crate::text::types::TextLayoutResult {
    // Step 1: initial size must fit
    let lh = resolve_line_height(req, font_ctx, req.font_size_px);
    let measurement = paragraph::measure_paragraph(
        pp,
        req.font_size_px,
        lh,
        req.max_width,
        req.effective_wrap(),
        req.has_forced_newline_breaks(),
    );
    if !measurement.fits(req.max_width, req.max_lines, req.max_height, lh) {
        // Initial size doesn't fit — return all lines without truncation.
        let overflow = TextOverflow::overflow("initial font size does not fit; cannot grow");
        return fit_build_shaped_failure(pp, req, font_ctx, req.font_size_px, overflow);
    }

    // Step 2: check if max size fits
    let lh_max = resolve_line_height(req, font_ctx, max_size);
    let m_max = paragraph::measure_paragraph(
        pp,
        max_size,
        lh_max,
        req.max_width,
        req.effective_wrap(),
        req.has_forced_newline_breaks(),
    );
    if m_max.fits(req.max_width, req.max_lines, req.max_height, lh_max) {
        return fit_build_shaped(req, font_ctx, pp, max_size, m_max.kinsoku_unresolved);
    }

    // Step 3: binary search
    let mut lo = req.font_size_px;
    let mut hi = max_size;
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
    fit_build_shaped(req, font_ctx, pp, best_size, m_best.kinsoku_unresolved)
}
