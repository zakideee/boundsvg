use super::super::engine::{apply_feature_settings_to_lines, apply_variation_settings_to_lines};
use super::super::engine::{break_lines_internal, measure_break_fit};
use super::super::paragraph;
use super::super::types::{
    Language, Line, TextBBox, TextLayoutRequest, TextLayoutResult, TextOverflow, TextWarning,
    build_notdef_warnings, collect_notdef_from_glyphs,
};
use crate::font::FontContext;
use crate::font::line_metrics::{LineMetrics, resolve_line_metrics_for_style};
use crate::font::shaping::{GlyphInfo, ShapeOptions};

/// Default minimum font size for shrink (px).
pub(super) const DEFAULT_MIN_FONT_SIZE: f64 = 8.0;
/// Default convergence epsilon (px).
pub(super) const DEFAULT_EPSILON: f64 = 0.25;
/// Default max binary search iterations.
pub(super) const DEFAULT_MAX_ITERATIONS: usize = 12;
/// Default max font size multiplier for grow.
pub(super) const DEFAULT_GROW_MULTIPLIER: f64 = 4.0;

/// Resolve line height in px.
pub(super) fn resolve_line_metrics(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
) -> LineMetrics {
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
}

/// Resolve line height in px.
pub(super) fn resolve_line_height(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
) -> f64 {
    resolve_line_metrics(req, font_ctx, font_size_px).line_height_px
}

/// Return a finite, positive proportional scale for a settled fit size.
pub(crate) fn selected_font_size_scale(
    authored_font_size_px: f64,
    chosen_font_size_px: f64,
) -> f64 {
    if !authored_font_size_px.is_finite()
        || authored_font_size_px <= 0.0
        || !chosen_font_size_px.is_finite()
        || chosen_font_size_px <= 0.0
    {
        return 1.0;
    }

    let scale = chosen_font_size_px / authored_font_size_px;
    if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    }
}

/// Scale authored tracking with the selected fit candidate.
pub(crate) fn scaled_letter_spacing(req: &TextLayoutRequest<'_>, font_size_px: f64) -> f64 {
    req.letter_spacing_px * selected_font_size_scale(req.font_size_px, font_size_px)
}

/// Check if text fits within the given constraints (horizontal).
#[cfg(test)]
pub(super) fn text_fits(
    lines: &[Line],
    max_width: f64,
    max_lines: Option<usize>,
    max_height: Option<f64>,
    line_height_px: f64,
) -> bool {
    for line in lines {
        if line.width > max_width {
            return false;
        }
    }
    if let Some(max) = max_lines {
        if lines.len() > max {
            return false;
        }
    }
    if let Some(max_h) = max_height {
        let total_height = lines.len() as f64 * line_height_px;
        if total_height > max_h {
            return false;
        }
    }
    true
}

/// Build a horizontal result from lines.
pub(super) fn build_result(
    lines: Vec<Line>,
    font_size_px: f64,
    line_height_px: f64,
    overflow: TextOverflow,
    warnings: Vec<TextWarning>,
) -> TextLayoutResult {
    let mut max_w: f64 = 0.0;
    for l in &lines {
        if l.width > max_w {
            max_w = l.width;
        }
    }
    let total_height = lines.len() as f64 * line_height_px;
    TextLayoutResult {
        lines,
        bbox: TextBBox {
            x: 0.0,
            y: 0.0,
            w: max_w,
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

/// Collect notdef warnings from laid-out lines.
///
/// Each `Line` carries its own `text` and `glyphs` (`GlyphInfo`).
/// We iterate all lines, collect notdef entries, then build warnings.
pub(super) fn collect_warnings_from_lines(lines: &[Line], font_alias: &str) -> Vec<TextWarning> {
    let mut all_notdef = Vec::new();
    for line in lines {
        all_notdef.extend(collect_notdef_from_glyphs(
            &line.glyphs,
            &line.text,
            font_alias,
        ));
    }
    build_notdef_warnings(&all_notdef)
}

/// Shape text at a given font size using the font registry.
pub(super) fn shape_at_size(
    font_ctx: &FontContext<'_>,
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
    shape_options: &ShapeOptions,
) -> Result<Vec<GlyphInfo>, crate::TextLayoutError> {
    crate::text::shape_checked_text_run(
        font_ctx,
        text,
        font_size_px,
        letter_spacing_px,
        shape_options,
        0,
        crate::TextPreparationPhase::PlainShaping,
    )
}

pub(super) fn language_to_str(lang: Language) -> &'static str {
    match lang {
        Language::Ja => "ja",
        Language::En => "en",
        Language::Auto => "auto",
    }
}

/// Measure whether text fits at the given font size (lightweight, no Line construction).
pub(super) fn measure_fits_at_size(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    shape_options: &ShapeOptions,
    kinsoku_profile: Option<&crate::text::kinsoku::KinsokuProfile>,
    hanging_chars: Option<&[char]>,
) -> Result<bool, crate::TextLayoutError> {
    let line_height_px = resolve_line_height(req, font_ctx, font_size_px);
    let glyphs = shape_at_size(
        font_ctx,
        req.text,
        font_size_px,
        scaled_letter_spacing(req, font_size_px),
        shape_options,
    )?;
    let measure = measure_break_fit(
        &glyphs,
        req.text,
        req.max_width,
        req.wrap,
        kinsoku_profile,
        req.uax14_breaks,
        hanging_chars,
    );
    Ok(measure.fits(req.max_width, req.max_lines, req.max_height, line_height_px))
}

/// Build a full layout result at the given font size, using the same break
/// conditions as the normal layout path.
pub(super) fn layout_at_size(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    shape_options: &ShapeOptions,
    kinsoku_profile: Option<&crate::text::kinsoku::KinsokuProfile>,
    hanging_chars: Option<&[char]>,
) -> Result<(Vec<Line>, f64, bool), crate::TextLayoutError> {
    let line_metrics = resolve_line_metrics(req, font_ctx, font_size_px);
    let line_height_px = line_metrics.line_height_px;
    let glyphs = shape_at_size(
        font_ctx,
        req.text,
        font_size_px,
        scaled_letter_spacing(req, font_size_px),
        shape_options,
    )?;
    let mut break_result = break_lines_internal(
        &glyphs,
        req.text,
        req.max_width,
        req.wrap,
        kinsoku_profile,
        line_height_px,
        line_metrics.baseline_offset_px,
        req.uax14_breaks,
        hanging_chars,
    );
    apply_variation_settings_to_lines(&mut break_result.lines, &req.font_variation_settings);
    apply_feature_settings_to_lines(&mut break_result.lines, &req.font_feature_settings);
    Ok((
        break_result.lines,
        line_height_px,
        break_result.kinsoku_unresolved,
    ))
}

/// Build final `TextLayoutResult` from a shaped paragraph (success path).
/// Applies maxLines truncation and detects overflow from truncation or kinsoku.
pub(super) fn fit_build_shaped(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    kinsoku_unresolved: bool,
) -> TextLayoutResult {
    let line_metrics = resolve_line_metrics(req, font_ctx, font_size_px);
    let lh = line_metrics.line_height_px;
    let mut break_result = paragraph::layout_paragraph(
        pp,
        font_size_px,
        lh,
        line_metrics.baseline_offset_px,
        req.max_width,
        req.effective_wrap(),
        req.has_forced_newline_breaks(),
    );

    apply_variation_settings_to_lines(&mut break_result.lines, &req.font_variation_settings);
    apply_feature_settings_to_lines(&mut break_result.lines, &req.font_feature_settings);

    let total_line_count = break_result.lines.len();
    let truncated_lines = if let Some(max) = req.max_lines {
        if break_result.lines.len() > max {
            break_result.lines.into_iter().take(max).collect()
        } else {
            break_result.lines
        }
    } else {
        break_result.lines
    };

    let overflow = if total_line_count > truncated_lines.len() {
        TextOverflow::overflow("lines truncated by maxLines")
    } else if kinsoku_unresolved || break_result.kinsoku_unresolved {
        TextOverflow::kinsoku_unresolved()
    } else {
        TextOverflow::none()
    };

    let warnings = build_notdef_warnings(&paragraph::collect_notdef_chars(pp));
    build_result(truncated_lines, font_size_px, lh, overflow, warnings)
}

/// Build final `TextLayoutResult` from a shaped paragraph (failure path).
/// Does NOT apply maxLines truncation — returns all lines, matching the
/// existing non-shaped path for `cannot_fit` / initial-doesn't-fit cases.
pub(super) fn fit_build_shaped_failure(
    pp: &paragraph::ShapedParagraph,
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    overflow: TextOverflow,
) -> TextLayoutResult {
    let line_metrics = resolve_line_metrics(req, font_ctx, font_size_px);
    let lh = line_metrics.line_height_px;
    let mut break_result = paragraph::layout_paragraph(
        pp,
        font_size_px,
        lh,
        line_metrics.baseline_offset_px,
        req.max_width,
        req.effective_wrap(),
        req.has_forced_newline_breaks(),
    );

    apply_variation_settings_to_lines(&mut break_result.lines, &req.font_variation_settings);
    apply_feature_settings_to_lines(&mut break_result.lines, &req.font_feature_settings);

    let warnings = build_notdef_warnings(&paragraph::collect_notdef_chars(pp));
    build_result(break_result.lines, font_size_px, lh, overflow, warnings)
}
