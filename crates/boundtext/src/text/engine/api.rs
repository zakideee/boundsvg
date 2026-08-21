use super::super::ellipsis;
use super::super::fit;
use super::super::inline_runs;
use super::super::rich;
use super::super::types::{
    FitMode, Language, TextBBox, TextLayoutRequest, TextLayoutResult, TextOrientation,
    TextOverflow, TextSpanInput,
};
use super::super::vertical;
use super::line_breaking::{BreakResult, break_lines_internal_with_options};
use super::result_building::{
    apply_feature_settings_to_lines, apply_variation_settings_to_lines,
    build_horizontal_result_with_constraints,
};
use crate::font::FontContext;
use crate::font::line_metrics::resolve_line_metrics_for_style;
use crate::font::shaping::{
    self, GlyphInfo, ShapeOptions, parse_css_font_feature_settings,
    parse_css_font_variation_settings,
};
use crate::font::{FontRegistry, FontStyle};
use crate::text::kinsoku::{get_hanging_chars, get_kinsoku_profile};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct MeasuredTextLine {
    pub text: String,
    pub char_start: usize,
    pub char_end: usize,
    pub inline_advance_px: f64,
    pub kinsoku_unresolved: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MeasuredTextBlock {
    pub lines: Vec<MeasuredTextLine>,
    pub used_width: f64,
    pub used_height: f64,
}

/// Measure plain horizontal text with the full fallback-capable shaper while
/// retaining authoritative per-line grapheme ranges and kinsoku diagnostics.
#[must_use]
pub fn measure_text_lines(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
) -> Option<MeasuredTextBlock> {
    if req.is_vertical()
        || req.spans.is_some_and(|spans| !spans.is_empty())
        || req.has_rich_text()
        || req.fit != FitMode::None
        || req.ellipsis
    {
        return None;
    }

    let measured_text = super::super::types::preprocess_text_for_white_space(
        req.text,
        req.white_space,
        req.tab_size,
    );
    let shape_options = ShapeOptions {
        writing_mode: None,
        language: language_to_option_string(req.language),
        vertical_feature_priority: None,
        text_orientation: None,
        font_variation_settings: req.font_variation_settings.clone(),
        font_feature_settings: req.font_feature_settings.clone(),
    };
    let glyphs = shape_text_for_layout(
        font_ctx,
        &measured_text,
        req.font_size_px,
        req.letter_spacing_px,
        &shape_options,
    )?;
    let line_metrics = resolve_line_metrics_for_style(
        font_ctx.registry,
        font_ctx.fallback_registry,
        font_ctx.families,
        font_ctx.weight,
        font_ctx.style,
        req.font_size_px,
        req.line_height,
        req.line_height_px,
    );
    let measured_breaks = break_lines_internal_with_options(
        &glyphs,
        &measured_text,
        req.max_width,
        req.effective_wrap(),
        get_kinsoku_profile(Some(language_to_str(req.language))),
        line_metrics.line_height_px,
        line_metrics.baseline_offset_px,
        req.uax14_breaks,
        get_hanging_chars(req.hanging_punctuation),
        req.has_forced_newline_breaks(),
        req.text_indent.unwrap_or(0.0),
    );
    let lines: Vec<MeasuredTextLine> = measured_breaks
        .result
        .lines
        .into_iter()
        .zip(measured_breaks.line_ranges)
        .map(|(line, range)| MeasuredTextLine {
            text: line.text,
            char_start: range.char_start,
            char_end: range.char_end,
            inline_advance_px: line.width,
            kinsoku_unresolved: range.kinsoku_unresolved,
        })
        .collect();
    let used_width = lines
        .iter()
        .map(|line| line.inline_advance_px)
        .fold(0.0_f64, f64::max);
    Some(MeasuredTextBlock {
        used_width,
        used_height: lines.len() as f64 * line_metrics.line_height_px,
        lines,
    })
}

/// Perform full horizontal text layout: shaping → line breaking → wrap.
///
/// Returns `None` when the Rust Text Engine cannot handle the request
/// (e.g. vertical mode, fit, ellipsis, inline runs), so the TS side
/// falls back to its own `layoutText()`.
#[must_use]
pub fn layout_text(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
) -> Option<TextLayoutResult> {
    layout_text_with_options(req, font_ctx, false)
}

/// Perform text layout while retaining the synthetic positioned glyphs needed
/// to derive stable unit metadata. Normal callers should use [`layout_text`]
/// so ellipsis output remains byte-compatible with the legacy layout shape.
#[must_use]
pub fn layout_text_with_unit_metadata(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
) -> Option<TextLayoutResult> {
    layout_text_with_options(req, font_ctx, true)
}

fn layout_text_with_options(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    include_unit_metadata: bool,
) -> Option<TextLayoutResult> {
    let coalesced_spans = req
        .spans
        .filter(|_| req.rich_text.is_none())
        .filter(|spans| spans.iter().any(|span| span.text_decoration.is_some()))
        .map(super::super::decoration::coalesce_decoration_only_spans);
    let coalesced_request = coalesced_spans.as_deref().map(|spans| TextLayoutRequest {
        spans: if spans.len() == 1 && span_matches_plain_request(&spans[0], req, font_ctx) {
            None
        } else {
            Some(spans)
        },
        ..req.clone()
    });
    let layout_request = coalesced_request.as_ref().unwrap_or(req);
    let mut result = layout_text_inner(layout_request, font_ctx, include_unit_metadata)?;
    let has_positioned_glyphs = result.lines.iter().any(|line| {
        line.positioned_glyphs
            .as_ref()
            .is_some_and(|glyphs| !glyphs.is_empty())
    });
    if has_positioned_glyphs {
        super::super::decoration::resolve_text_decorations(req, font_ctx, &mut result);
    } else if coalesced_spans.is_some() && !result.lines.is_empty() {
        let mut decoration_layout = layout_text_inner(layout_request, font_ctx, true)?;
        super::super::decoration::resolve_text_decorations(req, font_ctx, &mut decoration_layout);
        result.text_decorations = decoration_layout.text_decorations;
    }

    // PreWrap: convert spaces to NBSP to prevent SVG whitespace collapsing
    if req.white_space == super::super::types::WhiteSpaceMode::PreWrap {
        result.convert_spaces_to_nbsp();
    }

    Some(result)
}

fn span_matches_plain_request(
    span: &TextSpanInput,
    req: &TextLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
) -> bool {
    span.decoration_transport_only
        && span.text == req.text
        && span.font_family == font_ctx.families
        && span.font_weight == font_ctx.weight
        && span.font_style == *font_ctx.style
        && span.font_size_px == req.font_size_px
        && span.letter_spacing_px.unwrap_or(0.0) == req.letter_spacing_px
        && Language::from_option(span.language.as_deref()) == req.language
        && TextOrientation::from_option(span.text_orientation.as_deref()) == req.text_orientation
        && span
            .font_variation_settings
            .as_deref()
            .map(parse_css_font_variation_settings)
            .unwrap_or_default()
            == req.font_variation_settings
        && span
            .font_feature_settings
            .as_deref()
            .map(parse_css_font_feature_settings)
            .unwrap_or_default()
            == req.font_feature_settings
}

pub(crate) fn layout_text_inner(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    include_unit_metadata: bool,
) -> Option<TextLayoutResult> {
    if req.has_rich_text() || req.text_indent.unwrap_or(0.0) != 0.0 {
        return rich::layout_rich_text(req, font_ctx);
    }

    // Dispatch vertical writing mode to dedicated vertical layout.
    if req.is_vertical() {
        return vertical::layout_vertical_text(req, font_ctx);
    }

    // Normalize white space once so every horizontal sub-path (fit
    // shrink/grow, ellipsis, shaped and legacy line breaking) sees the same
    // text. Rich and vertical dispatches above handle their own
    // preprocessing. For spans, collapse carries across run boundaries and
    // the result is distributed back onto the runs.
    let preprocessed_request_text;
    let normalized_request;
    let normalized_spans: Vec<super::super::types::TextSpanInput>;
    let normalized_spans_text: String;
    let req = if let Some(spans) = req.spans.filter(|spans| !spans.is_empty()) {
        let span_texts: Vec<&str> = spans.iter().map(|s| s.text.as_str()).collect();
        match super::super::types::preprocess_span_texts_for_white_space(
            &span_texts,
            req.white_space,
            req.tab_size,
        ) {
            None => req,
            Some(new_texts) => {
                normalized_spans = spans
                    .iter()
                    .zip(new_texts)
                    .map(|(span, text)| super::super::types::TextSpanInput {
                        text,
                        ..span.clone()
                    })
                    .collect();
                normalized_spans_text = normalized_spans.iter().map(|s| s.text.as_str()).collect();
                normalized_request = TextLayoutRequest {
                    text: normalized_spans_text.as_str(),
                    spans: Some(&normalized_spans),
                    ..req.clone()
                };
                &normalized_request
            }
        }
    } else {
        preprocessed_request_text = super::super::types::preprocess_text_for_white_space(
            req.text,
            req.white_space,
            req.tab_size,
        );
        if preprocessed_request_text == req.text {
            req
        } else {
            normalized_request = TextLayoutRequest {
                text: preprocessed_request_text.as_str(),
                ..req.clone()
            };
            &normalized_request
        }
    };

    // Handle fit=shrink via binary search
    if req.fit == FitMode::Shrink {
        return fit_shrink_for_request(req, font_ctx, include_unit_metadata);
    }

    // Handle fit=grow via upward binary search
    if req.fit == FitMode::Grow {
        return fit::fit_grow(
            req,
            font_ctx,
            req.max_font_size_px,
            req.grow_epsilon_px,
            req.grow_max_iterations,
        );
    }

    let line_metrics = resolve_line_metrics_for_style(
        font_ctx.registry,
        font_ctx.fallback_registry,
        font_ctx.families,
        font_ctx.weight,
        font_ctx.style,
        req.font_size_px,
        req.line_height,
        req.line_height_px,
    );
    let line_height_px = line_metrics.line_height_px;
    let baseline_offset_px = line_metrics.baseline_offset_px;
    let kinsoku_profile = get_kinsoku_profile(Some(language_to_str(req.language)));
    let hanging_chars = get_hanging_chars(req.hanging_punctuation);

    let spans_with_runs = req.spans.filter(|spans| !spans.is_empty());
    let has_runs = spans_with_runs.is_some();

    // Plain text honors white-space preprocessing before shaping.
    let preprocessed_text = super::super::types::preprocess_text_for_white_space(
        req.text,
        req.white_space,
        req.tab_size,
    );
    let text = preprocessed_text.as_str();

    // --- Shaped path: separate shaping from relayout ---
    if !has_runs && req.fit == FitMode::None && !req.ellipsis {
        let prep_shape_options = ShapeOptions {
            writing_mode: None,
            language: language_to_option_string(req.language),
            vertical_feature_priority: None,
            text_orientation: None,
            font_variation_settings: req.font_variation_settings.clone(),
            font_feature_settings: req.font_feature_settings.clone(),
        };
        let effective_wrap = req.effective_wrap();
        // PreWrap text may contain \n which produces .notdef glyphs;
        // allow_notdef lets them through for forced newline break handling.
        if let Some(shaped) = super::super::paragraph::shape_paragraph_with_options(
            text,
            font_ctx,
            req.language,
            effective_wrap,
            req.hanging_punctuation,
            &prep_shape_options,
            req.uax14_breaks,
            req.letter_spacing_px,
            req.has_forced_newline_breaks(),
        ) {
            let notdef_warnings = super::super::types::build_notdef_warnings(
                &super::super::paragraph::collect_notdef_chars(&shaped),
            );
            let break_result = super::super::paragraph::layout_paragraph(
                &shaped,
                req.font_size_px,
                line_height_px,
                baseline_offset_px,
                req.max_width,
                effective_wrap,
                req.has_forced_newline_breaks(),
            );
            let total_line_count = break_result.lines.len();
            let mut truncated_lines = if let Some(max) = req.max_lines {
                if break_result.lines.len() > max {
                    break_result.lines.into_iter().take(max).collect()
                } else {
                    break_result.lines
                }
            } else {
                break_result.lines
            };

            apply_variation_settings_to_lines(&mut truncated_lines, &req.font_variation_settings);
            apply_feature_settings_to_lines(&mut truncated_lines, &req.font_feature_settings);

            return Some(build_horizontal_result_with_constraints(
                truncated_lines,
                total_line_count,
                line_height_px,
                req.font_size_px,
                break_result.kinsoku_unresolved,
                Some(req.max_width),
                req.max_height,
                notdef_warnings,
            ));
        }
    }

    // Shaping options for the non-inline-run path. Hoisted out of the `else`
    // branch below because the ellipsis paths must truncate against the same
    // shaping the body text uses — measuring "…" with default options ignores
    // fontVariationSettings / fontFeatureSettings and mis-sizes the line.
    let shape_options = ShapeOptions {
        writing_mode: None,
        language: language_to_option_string(req.language),
        vertical_feature_priority: None,
        text_orientation: None,
        font_variation_settings: req.font_variation_settings.clone(),
        font_feature_settings: req.font_feature_settings.clone(),
    };

    // Shape text — use inline runs if spans exist, otherwise single shaping
    let (glyphs, run_segments) = if let Some(spans) = spans_with_runs {
        let (g, s) = inline_runs::shape_inline_runs(spans, font_ctx, req.letter_spacing_px);
        (g, Some(s))
    } else {
        let shaped = shape_text_for_layout(
            font_ctx,
            req.text,
            req.font_size_px,
            req.letter_spacing_px,
            &shape_options,
        )?;
        (shaped, None)
    };

    let primary_alias = font_ctx.families.first().map_or("", |s| s.as_str());
    let notdef_warnings = super::super::types::build_notdef_warnings(
        &super::super::types::collect_notdef_from_glyphs(&glyphs, req.text, primary_alias),
    );

    // Handle single-line ellipsis (skip when inline runs are present — TS parity)
    if !has_runs && req.ellipsis && req.max_lines == Some(1) {
        let ellipsis_line = apply_single_line_ellipsis(
            req,
            font_ctx,
            line_height_px,
            baseline_offset_px,
            kinsoku_profile,
            &shape_options,
            include_unit_metadata,
        );
        if let Some(mut ellipsis_line) = ellipsis_line {
            apply_variation_settings_to_lines(
                std::slice::from_mut(&mut ellipsis_line),
                &req.font_variation_settings,
            );
            apply_feature_settings_to_lines(
                std::slice::from_mut(&mut ellipsis_line),
                &req.font_feature_settings,
            );
            return Some(TextLayoutResult {
                bbox: TextBBox {
                    x: 0.0,
                    y: 0.0,
                    w: ellipsis_line.width,
                    h: line_height_px,
                },
                lines: vec![ellipsis_line],
                chosen_font_size_px: req.font_size_px,
                overflow: TextOverflow::overflow("ellipsis applied"),
                source_text: None,
                display_text: None,
                unit_map: None,
                warnings: Vec::new(),
                inline_box_decorations: Vec::new(),
                text_decorations: Vec::new(),
                inline_rects: Vec::new(),
            });
        }
    }

    // Break into lines
    let BreakResult {
        mut lines,
        kinsoku_unresolved,
    } = break_lines_internal_with_options(
        &glyphs,
        text,
        req.max_width,
        req.effective_wrap(),
        kinsoku_profile,
        line_height_px,
        baseline_offset_px,
        req.uax14_breaks,
        hanging_chars,
        req.has_forced_newline_breaks(),
        0.0,
    )
    .result;

    // Propagate variation settings to positioned glyphs (non-rich-text path)
    apply_variation_settings_to_lines(&mut lines, &req.font_variation_settings);
    apply_feature_settings_to_lines(&mut lines, &req.font_feature_settings);

    // Handle multiline ellipsis (skip when inline runs are present — TS parity)
    if !has_runs
        && req.ellipsis
        && let Some(max_lines) = req.max_lines.filter(|&max| max > 1 && lines.len() > max)
    {
        let ellipsis_lines = if include_unit_metadata {
            ellipsis::apply_multiline_ellipsis_with_unit_metadata(
                &lines,
                max_lines,
                req.max_width,
                font_ctx,
                req.font_size_px,
                req.letter_spacing_px,
                line_height_px,
                baseline_offset_px,
                kinsoku_profile,
                &shape_options,
            )
        } else {
            ellipsis::apply_multiline_ellipsis(
                &lines,
                max_lines,
                req.max_width,
                font_ctx,
                req.font_size_px,
                req.letter_spacing_px,
                line_height_px,
                baseline_offset_px,
                kinsoku_profile,
                &shape_options,
            )
        };
        if let Some(mut ellipsis_lines) = ellipsis_lines {
            apply_variation_settings_to_lines(&mut ellipsis_lines, &req.font_variation_settings);
            apply_feature_settings_to_lines(&mut ellipsis_lines, &req.font_feature_settings);
            let mut max_w: f64 = 0.0;
            for l in &ellipsis_lines {
                if l.width > max_w {
                    max_w = l.width;
                }
            }
            return Some(TextLayoutResult {
                bbox: TextBBox {
                    x: 0.0,
                    y: 0.0,
                    w: max_w,
                    h: ellipsis_lines.len() as f64 * line_height_px,
                },
                lines: ellipsis_lines,
                chosen_font_size_px: req.font_size_px,
                overflow: TextOverflow::overflow("ellipsis applied"),
                source_text: None,
                display_text: None,
                unit_map: None,
                warnings: Vec::new(),
                inline_box_decorations: Vec::new(),
                text_decorations: Vec::new(),
                inline_rects: Vec::new(),
            });
        }
    }

    // Spans + ellipsis: relayout with truncated runs. This mirrors the
    // plain-text ellipsis contract; it was previously silently skipped.
    if has_runs && req.ellipsis {
        if let Some(max) = req.max_lines {
            let overflows = if max == 1 {
                lines.len() > 1 || lines.first().is_some_and(|l| l.width > req.max_width)
            } else {
                lines.len() > max
            };
            if overflows {
                if let Some(result) = apply_spans_ellipsis(req, font_ctx, max) {
                    return Some(result);
                }
            }
        }
    }

    // Enforce maxLines (truncate excess lines)
    let total_line_count = lines.len();
    let mut truncated_lines: Vec<super::super::types::Line> = if let Some(max) = req.max_lines {
        if lines.len() > max {
            lines.into_iter().take(max).collect()
        } else {
            lines
        }
    } else {
        lines
    };

    // Apply inline fragments if spans exist
    if let Some(ref segments) = run_segments {
        inline_runs::apply_inline_fragments(
            &mut truncated_lines,
            segments,
            font_ctx.registry,
            font_ctx.fallback_registry,
        );
    }

    Some(build_horizontal_result_with_constraints(
        truncated_lines,
        total_line_count,
        line_height_px,
        req.font_size_px,
        kinsoku_unresolved,
        Some(req.max_width),
        req.max_height,
        notdef_warnings,
    ))
}

// ---------------------------------------------------------------------------
// Spans ellipsis (relayout-based)
// ---------------------------------------------------------------------------

/// Apply ellipsis to styled spans by relayout: truncate the run list at
/// grapheme granularity, append "…" styled as the last kept run, and re-run
/// the same spans layout, binary-searching the largest kept prefix that fits
/// within `max_lines`. The truncation boundary is validated against the
/// kinsoku profile (no "…" directly after a tail-prohibited character).
fn apply_spans_ellipsis(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    max_lines: usize,
) -> Option<TextLayoutResult> {
    use super::super::grapheme::grapheme_split;

    let spans = req.spans?;
    let span_graphemes: Vec<Vec<String>> = spans.iter().map(|s| grapheme_split(&s.text)).collect();
    let total: usize = span_graphemes.iter().map(Vec::len).sum();
    if total == 0 {
        return None;
    }

    let fits = |result: &TextLayoutResult| {
        result.lines.len() <= max_lines
            && result.lines.iter().all(|l| l.width <= req.max_width + 0.01)
    };

    // Binary search the largest keep count whose relayout fits. Keeping
    // everything is known not to fit (the caller checked overflow).
    let mut lo = 0usize;
    let mut hi = total - 1;
    let mut best: Option<(usize, TextLayoutResult)> = None;
    while lo <= hi {
        let mid = lo + (hi - lo) / 2;
        let candidate = relayout_spans_with_ellipsis(req, font_ctx, spans, &span_graphemes, mid)?;
        if fits(&candidate) {
            best = Some((mid, candidate));
            lo = mid + 1;
        } else {
            if mid == 0 {
                break;
            }
            hi = mid - 1;
        }
    }

    let (keep, result) = match best {
        Some(found) => found,
        // Even "…" alone overflows — return it as the best effort.
        None => (
            0,
            relayout_spans_with_ellipsis(req, font_ctx, spans, &span_graphemes, 0)?,
        ),
    };

    // Back up past tail-prohibited characters (same contract as plain).
    let kinsoku_profile = get_kinsoku_profile(Some(language_to_str(req.language)));
    let mut result = result;
    if let Some(profile) = kinsoku_profile {
        let all_graphemes: Vec<&str> = span_graphemes
            .iter()
            .flatten()
            .map(String::as_str)
            .collect();
        let mut adjusted = keep;
        while adjusted > 0
            && !super::super::kinsoku::is_valid_ellipsis_boundary(&all_graphemes, adjusted, profile)
        {
            adjusted -= 1;
        }
        if adjusted != keep {
            result = relayout_spans_with_ellipsis(req, font_ctx, spans, &span_graphemes, adjusted)?;
        }
    }

    result.overflow = TextOverflow::overflow("ellipsis applied");
    Some(result)
}

fn relayout_spans_with_ellipsis(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    spans: &[super::super::types::TextSpanInput],
    span_graphemes: &[Vec<String>],
    keep: usize,
) -> Option<TextLayoutResult> {
    let mut truncated: Vec<super::super::types::TextSpanInput> = Vec::new();
    let mut remaining = keep;
    for (span, graphemes) in spans.iter().zip(span_graphemes) {
        if remaining == 0 {
            break;
        }
        let take = remaining.min(graphemes.len());
        remaining -= take;
        truncated.push(super::super::types::TextSpanInput {
            text: graphemes[..take].concat(),
            ..span.clone()
        });
    }
    match truncated.last_mut() {
        Some(last) => last.text.push('\u{2026}'),
        None => truncated.push(super::super::types::TextSpanInput {
            text: "\u{2026}".to_string(),
            ..spans[0].clone()
        }),
    }

    let concatenated: String = truncated.iter().map(|s| s.text.as_str()).collect();
    let probe = TextLayoutRequest {
        text: concatenated.as_str(),
        spans: Some(&truncated),
        ellipsis: false,
        max_lines: None,
        ..req.clone()
    };
    layout_text_inner(&probe, font_ctx, false)
}

fn fit_shrink_for_request(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    include_unit_metadata: bool,
) -> Option<TextLayoutResult> {
    if include_unit_metadata {
        fit::fit_shrink_with_unit_metadata(
            req,
            font_ctx,
            req.min_font_size_px,
            req.shrink_epsilon_px,
            req.shrink_max_iterations,
        )
    } else {
        fit::fit_shrink(
            req,
            font_ctx,
            req.min_font_size_px,
            req.shrink_epsilon_px,
            req.shrink_max_iterations,
        )
    }
}

fn apply_single_line_ellipsis(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    line_height_px: f64,
    baseline_offset_px: f64,
    kinsoku_profile: Option<&crate::text::kinsoku::KinsokuProfile>,
    shape_options: &ShapeOptions,
    include_unit_metadata: bool,
) -> Option<crate::text::types::Line> {
    if include_unit_metadata {
        ellipsis::apply_ellipsis_with_unit_metadata(
            req.text,
            req.max_width,
            font_ctx,
            req.font_size_px,
            req.letter_spacing_px,
            line_height_px,
            baseline_offset_px,
            kinsoku_profile,
            shape_options,
        )
    } else {
        ellipsis::apply_ellipsis(
            req.text,
            req.max_width,
            font_ctx,
            req.font_size_px,
            req.letter_spacing_px,
            line_height_px,
            baseline_offset_px,
            kinsoku_profile,
            shape_options,
        )
    }
}

// ---------------------------------------------------------------------------
// Shaping helper
// ---------------------------------------------------------------------------

fn shape_text_for_layout(
    font_ctx: &crate::font::FontContext<'_>,
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
    shape_options: &ShapeOptions,
) -> Option<Vec<GlyphInfo>> {
    if text.is_empty() {
        return Some(Vec::new());
    }

    // Try fallback chain shaping if multiple families
    if font_ctx.families.len() > 1 {
        let result = shaping::shape_with_fallback_and_options(
            font_ctx,
            text,
            font_size_px,
            letter_spacing_px,
            shape_options,
        );
        if !result.glyphs.is_empty() {
            return Some(result.glyphs);
        }
        // Try fallback registry
        if let Some(fallback) = font_ctx.fallback_registry {
            let fallback_ctx = crate::font::FontContext {
                registry: fallback,
                fallback_registry: None,
                families: font_ctx.families,
                weight: font_ctx.weight,
                style: font_ctx.style,
            };
            let result = shaping::shape_with_fallback_and_options(
                &fallback_ctx,
                text,
                font_size_px,
                letter_spacing_px,
                shape_options,
            );
            if !result.glyphs.is_empty() {
                return Some(result.glyphs);
            }
        }
    }

    // Single font resolution
    let font_entry = resolve_font(
        font_ctx.registry,
        font_ctx.fallback_registry,
        font_ctx.families,
        font_ctx.weight,
        font_ctx.style,
    )?;
    Some(shaping::shape_text_with_options(
        font_ctx.registry,
        font_entry,
        text,
        font_size_px,
        letter_spacing_px,
        shape_options,
    ))
}

fn resolve_font<'a>(
    font_registry: &'a FontRegistry,
    fallback_registry: Option<&'a FontRegistry>,
    aliases: &[String],
    weight: u16,
    style: &FontStyle,
) -> Option<&'a crate::font::FontEntry> {
    if let Some(entry) = font_registry.resolve_chain(aliases, weight, style) {
        return Some(entry);
    }
    if let Some(fallback) = fallback_registry {
        return fallback.resolve_chain(aliases, weight, style);
    }
    None
}

// ---------------------------------------------------------------------------
// Language helpers
// ---------------------------------------------------------------------------

pub(crate) fn language_to_str(lang: Language) -> &'static str {
    match lang {
        Language::Ja => "ja",
        Language::En => "en",
        Language::Auto => "auto",
    }
}

pub(crate) fn language_to_option_string(lang: Language) -> Option<String> {
    match lang {
        Language::Ja => Some("ja".to_string()),
        Language::En => Some("en".to_string()),
        Language::Auto => None,
    }
}
