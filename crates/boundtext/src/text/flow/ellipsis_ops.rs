use crate::font::FontContext;
use crate::font::shaping::{
    ShapeOptions, parse_css_font_feature_settings, parse_css_font_variation_settings,
};
use crate::text::ellipsis;
use crate::text::inline_runs;
use crate::text::paragraph;
use crate::text::types::TextSpanInput;

use super::FlowLine;

const ELLIPSIS_REFINE_WINDOW: usize = 3;

/// Shaping options for the span that the ellipsis is appended to.
///
/// The ellipsis must be measured with the same variation / feature settings as
/// the run it terminates; measuring it with default options mis-sizes the
/// truncated fragment for variable fonts and for feature-altered advances.
fn span_shape_options(span: &TextSpanInput, writing_mode: Option<&str>) -> ShapeOptions {
    ShapeOptions {
        writing_mode: writing_mode.map(String::from),
        language: span.language.clone(),
        vertical_feature_priority: writing_mode.map(|_| "true".to_string()),
        text_orientation: span.text_orientation.clone(),
        font_variation_settings: span
            .font_variation_settings
            .as_deref()
            .map(parse_css_font_variation_settings)
            .unwrap_or_default(),
        font_feature_settings: span
            .font_feature_settings
            .as_deref()
            .map(parse_css_font_feature_settings)
            .unwrap_or_default(),
    }
}

// ---------------------------------------------------------------------------
// Ellipsis post-processing (horizontal, single-font)
// ---------------------------------------------------------------------------

pub(super) fn apply_ellipsis_horizontal(
    flow_lines: &mut [FlowLine],
    pp: &paragraph::ShapedParagraph,
    font_ctx: &FontContext<'_>,
    settled_font_size: f64,
    letter_spacing: f64,
    shape_options: &ShapeOptions,
) {
    let Some(last_line) = flow_lines.last_mut() else {
        return;
    };
    let Some(last_fragment) = last_line.fragments.last_mut() else {
        return;
    };

    let Some(ellipsis_advance) = ellipsis::shape_ellipsis_advance_with_options(
        font_ctx,
        settled_font_size,
        letter_spacing,
        shape_options,
        false,
    ) else {
        return;
    };
    let Some(truncation) = paragraph::find_ellipsis_truncation_point(
        pp,
        settled_font_size,
        last_fragment.char_start,
        last_fragment.char_end,
        last_fragment.available_inline_size_px,
        ellipsis_advance,
    ) else {
        return;
    };

    let byte_start = pp.char_byte_offsets[last_fragment.char_start] as usize;
    let max_width = last_fragment.available_inline_size_px;
    let min_pos = truncation
        .truncate_at
        .saturating_sub(ELLIPSIS_REFINE_WINDOW)
        .max(last_fragment.char_start);

    let mut trunc_at = truncation.truncate_at;
    let mut verified = false;
    while trunc_at >= min_pos {
        let byte_end = pp.char_byte_offsets[trunc_at] as usize;
        let candidate = format!("{}\u{2026}", &pp.text[byte_start..byte_end]);

        if let Some(actual_width) = ellipsis::measure_text_advance(
            font_ctx,
            &candidate,
            settled_font_size,
            letter_spacing,
            shape_options,
            false,
        ) && actual_width <= max_width
        {
            last_fragment.text = candidate;
            last_fragment.char_end = trunc_at;
            last_fragment.inline_advance_px = actual_width;
            last_fragment.overflow_reason = Some("ellipsis".to_string());
            verified = true;
            break;
        }

        if trunc_at == min_pos {
            break;
        }
        trunc_at -= 1;
    }

    if !verified {
        let ellipsis_only = "\u{2026}".to_string();
        if let Some(width) = ellipsis::measure_text_advance(
            font_ctx,
            &ellipsis_only,
            settled_font_size,
            letter_spacing,
            shape_options,
            false,
        ) && width <= max_width
        {
            last_fragment.text = ellipsis_only;
            last_fragment.char_end = last_fragment.char_start;
            last_fragment.inline_advance_px = width;
            last_fragment.overflow_reason = Some("ellipsis".to_string());
        }
    }
}

// ---------------------------------------------------------------------------
// Ellipsis post-processing (vertical, single-font)
// ---------------------------------------------------------------------------

pub(super) fn apply_ellipsis_vertical(
    flow_lines: &mut [FlowLine],
    pp: &paragraph::ShapedParagraph,
    font_ctx: &FontContext<'_>,
    settled_font_size: f64,
    letter_spacing: f64,
    shape_options: &ShapeOptions,
) {
    let Some(last_line) = flow_lines.last_mut() else {
        return;
    };
    let Some(last_fragment) = last_line.fragments.last_mut() else {
        return;
    };

    let Some(ellipsis_advance) = ellipsis::shape_ellipsis_advance_with_options(
        font_ctx,
        settled_font_size,
        letter_spacing,
        shape_options,
        true,
    ) else {
        return;
    };
    let Some(truncation) = paragraph::find_ellipsis_truncation_point_vertical(
        pp,
        settled_font_size,
        last_fragment.char_start,
        last_fragment.char_end,
        last_fragment.available_inline_size_px,
        ellipsis_advance,
    ) else {
        return;
    };

    let byte_start = pp.char_byte_offsets[last_fragment.char_start] as usize;
    let max_height = last_fragment.available_inline_size_px;
    let min_pos = truncation
        .truncate_at
        .saturating_sub(ELLIPSIS_REFINE_WINDOW)
        .max(last_fragment.char_start);

    let mut trunc_at = truncation.truncate_at;
    let mut verified = false;
    while trunc_at >= min_pos {
        let byte_end = pp.char_byte_offsets[trunc_at] as usize;
        let candidate = format!("{}\u{2026}", &pp.text[byte_start..byte_end]);

        if let Some(actual_width) = ellipsis::measure_text_advance(
            font_ctx,
            &candidate,
            settled_font_size,
            letter_spacing,
            shape_options,
            true,
        ) && actual_width <= max_height
        {
            last_fragment.text = candidate;
            last_fragment.char_end = trunc_at;
            last_fragment.inline_advance_px = actual_width;
            last_fragment.overflow_reason = Some("ellipsis".to_string());
            verified = true;
            break;
        }

        if trunc_at == min_pos {
            break;
        }
        trunc_at -= 1;
    }

    if !verified {
        let ellipsis_only = "\u{2026}".to_string();
        if let Some(width) = ellipsis::measure_text_advance(
            font_ctx,
            &ellipsis_only,
            settled_font_size,
            letter_spacing,
            shape_options,
            true,
        ) && width <= max_height
        {
            last_fragment.text = ellipsis_only;
            last_fragment.char_end = last_fragment.char_start;
            last_fragment.inline_advance_px = width;
            last_fragment.overflow_reason = Some("ellipsis".to_string());
        }
    }
}

// ---------------------------------------------------------------------------
// Ellipsis post-processing (inline runs, horizontal)
// ---------------------------------------------------------------------------

pub(super) fn apply_ellipsis_inline(
    flow_lines: &mut [FlowLine],
    shaped_runs: &inline_runs::ShapedInlineRuns,
    text_spans: &[TextSpanInput],
    font_ctx: &FontContext<'_>,
) {
    let Some(last_line) = flow_lines.last_mut() else {
        return;
    };
    let Some(last_fragment) = last_line.fragments.last_mut() else {
        return;
    };

    let frag_span_idx = shaped_runs
        .segments
        .iter()
        .find(|segment| {
            segment.start <= last_fragment.char_start && last_fragment.char_start < segment.end
        })
        .map_or(0, |segment| segment.span_index);
    let frag_span = &text_spans[frag_span_idx.min(text_spans.len() - 1)];
    let frag_families = frag_span.font_family.clone();
    let trailing_ctx = FontContext {
        registry: font_ctx.registry,
        fallback_registry: None,
        families: &frag_families,
        weight: frag_span.font_weight,
        style: &frag_span.font_style,
    };
    let trailing_letter_spacing = frag_span.letter_spacing_px.unwrap_or(0.0);
    let horizontal_shape_opts = span_shape_options(frag_span, None);

    let Some(ellipsis_advance) = ellipsis::shape_ellipsis_advance_with_options(
        &trailing_ctx,
        frag_span.font_size_px,
        trailing_letter_spacing,
        &horizontal_shape_opts,
        false,
    ) else {
        return;
    };
    let Some(truncation) = inline_runs::find_ellipsis_truncation_point_inline(
        shaped_runs,
        last_fragment.char_start,
        last_fragment.char_end,
        last_fragment.available_inline_size_px,
        ellipsis_advance,
    ) else {
        return;
    };

    let byte_start = shaped_runs.char_byte_offsets[last_fragment.char_start] as usize;
    let max_width = last_fragment.available_inline_size_px;
    let min_pos = truncation
        .truncate_at
        .saturating_sub(ELLIPSIS_REFINE_WINDOW)
        .max(last_fragment.char_start);

    let mut trunc_at = truncation.truncate_at;
    let mut verified = false;
    while trunc_at >= min_pos {
        let byte_end = shaped_runs.char_byte_offsets[trunc_at] as usize;
        let candidate = format!("{}\u{2026}", &shaped_runs.text[byte_start..byte_end]);
        if let Some(actual_width) = ellipsis::measure_text_advance(
            &trailing_ctx,
            &candidate,
            frag_span.font_size_px,
            trailing_letter_spacing,
            &horizontal_shape_opts,
            false,
        ) && actual_width <= max_width
        {
            last_fragment.text = candidate;
            last_fragment.char_end = trunc_at;
            last_fragment.inline_advance_px = actual_width;
            last_fragment.overflow_reason = Some("ellipsis".to_string());
            verified = true;
            break;
        }

        if trunc_at == min_pos {
            break;
        }
        trunc_at -= 1;
    }

    if !verified {
        let ellipsis_only = "\u{2026}".to_string();
        if let Some(width) = ellipsis::measure_text_advance(
            &trailing_ctx,
            &ellipsis_only,
            frag_span.font_size_px,
            trailing_letter_spacing,
            &horizontal_shape_opts,
            false,
        ) && width <= max_width
        {
            last_fragment.text = ellipsis_only;
            last_fragment.char_end = last_fragment.char_start;
            last_fragment.inline_advance_px = width;
            last_fragment.overflow_reason = Some("ellipsis".to_string());
        }
    }
}

// ---------------------------------------------------------------------------
// Ellipsis post-processing (inline runs, vertical)
// ---------------------------------------------------------------------------

pub(super) fn apply_ellipsis_vertical_inline(
    flow_lines: &mut [FlowLine],
    shaped_runs: &inline_runs::ShapedInlineRuns,
    text_spans: &[TextSpanInput],
    font_ctx: &FontContext<'_>,
    language: Option<&str>,
    text_orientation: Option<&str>,
) {
    let Some(last_line) = flow_lines.last_mut() else {
        return;
    };
    let Some(last_fragment) = last_line.fragments.last_mut() else {
        return;
    };

    let frag_span_idx = shaped_runs
        .segments
        .iter()
        .find(|segment| {
            segment.start <= last_fragment.char_start && last_fragment.char_start < segment.end
        })
        .map_or(0, |segment| segment.span_index);
    let frag_span = &text_spans[frag_span_idx.min(text_spans.len() - 1)];
    let frag_families = frag_span.font_family.clone();
    let trailing_ctx = FontContext {
        registry: font_ctx.registry,
        fallback_registry: None,
        families: &frag_families,
        weight: frag_span.font_weight,
        style: &frag_span.font_style,
    };
    let trailing_letter_spacing = frag_span.letter_spacing_px.unwrap_or(0.0);
    let vertical_shape_opts = ShapeOptions {
        language: language.map(String::from),
        text_orientation: text_orientation.map(String::from),
        ..span_shape_options(frag_span, Some("vertical-rl"))
    };

    let Some(ellipsis_advance) = ellipsis::shape_ellipsis_advance_with_options(
        &trailing_ctx,
        frag_span.font_size_px,
        trailing_letter_spacing,
        &vertical_shape_opts,
        true,
    ) else {
        return;
    };
    let Some(truncation) = inline_runs::find_ellipsis_truncation_point_inline(
        shaped_runs,
        last_fragment.char_start,
        last_fragment.char_end,
        last_fragment.available_inline_size_px,
        ellipsis_advance,
    ) else {
        return;
    };

    let byte_start = shaped_runs.char_byte_offsets[last_fragment.char_start] as usize;
    let max_height = last_fragment.available_inline_size_px;
    let min_pos = truncation
        .truncate_at
        .saturating_sub(ELLIPSIS_REFINE_WINDOW)
        .max(last_fragment.char_start);

    let mut trunc_at = truncation.truncate_at;
    let mut verified = false;
    while trunc_at >= min_pos {
        let byte_end = shaped_runs.char_byte_offsets[trunc_at] as usize;
        let candidate = format!("{}\u{2026}", &shaped_runs.text[byte_start..byte_end]);
        if let Some(actual_advance) = ellipsis::measure_text_advance(
            &trailing_ctx,
            &candidate,
            frag_span.font_size_px,
            trailing_letter_spacing,
            &vertical_shape_opts,
            true,
        ) && actual_advance <= max_height
        {
            last_fragment.text = candidate;
            last_fragment.char_end = trunc_at;
            last_fragment.inline_advance_px = actual_advance;
            last_fragment.overflow_reason = Some("ellipsis".to_string());
            verified = true;
            break;
        }

        if trunc_at == min_pos {
            break;
        }
        trunc_at -= 1;
    }

    if !verified {
        let ellipsis_only = "\u{2026}".to_string();
        if let Some(width) = ellipsis::measure_text_advance(
            &trailing_ctx,
            &ellipsis_only,
            frag_span.font_size_px,
            trailing_letter_spacing,
            &vertical_shape_opts,
            true,
        ) && width <= max_height
        {
            last_fragment.text = ellipsis_only;
            last_fragment.char_end = last_fragment.char_start;
            last_fragment.inline_advance_px = width;
            last_fragment.overflow_reason = Some("ellipsis".to_string());
        }
    }
}
