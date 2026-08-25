use super::super::fit;
use super::super::inline_runs;
use super::super::rich;
use super::super::types::{
    FitMode, Language, LineFragment, PositionedGlyph, RichTextResourceViolation, TextLayoutRequest,
    TextLayoutResult, TextOrientation, TextRunStyle, TextSpanInput, is_text_fit_certified_monotone,
    validate_rich_text_resources,
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

/// Perform authoritative text layout for every supported text input shape.
///
/// # Errors
///
/// Returns [`crate::TextLayoutError`] when normalization, shaping, breaking,
/// fitting, or final display projection cannot produce a complete result.
pub fn layout_text(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
) -> Result<TextLayoutResult, crate::TextLayoutError> {
    layout_text_with_options(req, font_ctx, false)
}

/// Perform text layout while retaining the synthetic positioned glyphs needed
/// to derive stable unit metadata. Normal callers should use [`layout_text`]
/// so ellipsis output remains byte-compatible with the legacy layout shape.
///
/// # Errors
///
/// Returns [`crate::TextLayoutError`] under the same authoritative validation,
/// fit, and projection failures as [`layout_text`].
pub fn layout_text_with_unit_metadata(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
) -> Result<TextLayoutResult, crate::TextLayoutError> {
    layout_text_with_options(req, font_ctx, true)
}

fn layout_text_with_options(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    should_include_unit_metadata: bool,
) -> Result<TextLayoutResult, crate::TextLayoutError> {
    validate_layout_request_resources(req)?;
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
    let mut layout_result =
        layout_text_inner_authoritative(layout_request, font_ctx, should_include_unit_metadata)?;
    let has_positioned_glyphs = layout_result.lines.iter().any(|line| {
        line.positioned_glyphs
            .as_ref()
            .is_some_and(|glyphs| !glyphs.is_empty())
    });
    if has_positioned_glyphs {
        super::super::decoration::resolve_text_decorations(req, font_ctx, &mut layout_result);
    } else if coalesced_spans.is_some() && !layout_result.lines.is_empty() {
        let mut decoration_layout =
            layout_text_inner_authoritative(layout_request, font_ctx, true)?;
        super::super::decoration::resolve_text_decorations(req, font_ctx, &mut decoration_layout);
        layout_result.text_decorations = decoration_layout.text_decorations;
    }

    if layout_request.spans.is_some_and(|spans| !spans.is_empty()) {
        materialize_span_fragments(layout_request, &mut layout_result);
    }

    // PreWrap: convert spaces to NBSP to prevent SVG whitespace collapsing
    if req.white_space == super::super::types::WhiteSpaceMode::PreWrap {
        layout_result.convert_spaces_to_nbsp();
    }

    record_text_materialization(&layout_result);

    Ok(layout_result)
}

fn materialize_span_fragments(req: &TextLayoutRequest<'_>, layout_result: &mut TextLayoutResult) {
    let Some(spans) = req.spans.filter(|spans| !spans.is_empty()) else {
        return;
    };
    let mut source_end = 0_u32;
    let span_ranges = spans
        .iter()
        .map(|span| {
            let source_start = source_end;
            source_end = source_end.saturating_add(
                u32::try_from(super::super::grapheme::grapheme_split(&span.text).len())
                    .unwrap_or(u32::MAX),
            );
            (source_start, source_end, span)
        })
        .collect::<Vec<_>>();

    for line in &mut layout_result.lines {
        let Some(positioned_glyphs) = line.positioned_glyphs.as_deref() else {
            continue;
        };
        if positioned_glyphs.iter().any(|glyph| {
            glyph.source_role.as_deref() != Some("content") && glyph.synthetic_kind.is_none()
        }) {
            continue;
        }

        let mut fragments: Vec<LineFragment> = Vec::new();
        let mut previous_cluster: Option<MaterializedClusterIdentity<'_>> = None;
        let mut cluster_start_in_fragment = 0_u32;
        for glyph in positioned_glyphs {
            let span = glyph.source_start.and_then(|source_start| {
                span_ranges
                    .iter()
                    .find(|(start, end, _)| *start <= source_start && source_start < *end)
                    .map(|(_, _, span)| *span)
            });
            let style =
                text_run_style_for_glyph(req, layout_result.chosen_font_size_px, glyph, span);
            if fragments
                .last()
                .is_none_or(|fragment| fragment.style != style)
            {
                fragments.push(LineFragment {
                    text: String::new(),
                    glyphs: Vec::new(),
                    width: 0.0,
                    style,
                });
                previous_cluster = None;
            }
            let Some(fragment) = fragments.last_mut() else {
                continue;
            };
            let cluster = MaterializedClusterIdentity {
                source_start: glyph.source_start,
                source_end: glyph.source_end,
                cluster_start: glyph.cluster_start,
                cluster_end: glyph.cluster_end,
                synthetic_kind: glyph.synthetic_kind.as_deref(),
            };
            if previous_cluster != Some(cluster) {
                cluster_start_in_fragment = u32::try_from(fragment.text.len()).unwrap_or(u32::MAX);
                fragment.text.push_str(&glyph.text);
                previous_cluster = Some(cluster);
            }
            fragment.glyphs.push(GlyphInfo {
                glyph_id: glyph.glyph_id,
                x_advance: glyph.x_advance,
                y_advance: glyph.y_advance,
                x_offset: glyph.x_offset,
                y_offset: glyph.y_offset,
                cluster: cluster_start_in_fragment,
                font_alias: Some(glyph.font_alias.clone()),
                font_weight: Some(glyph.font_weight),
                font_style: Some(glyph.font_style.clone()),
                rotation_deg: Some(glyph.rotation_deg),
            });
            fragment.width += if req.is_vertical() {
                if glyph.y_advance == 0.0 {
                    glyph.x_advance.abs()
                } else {
                    glyph.y_advance.abs()
                }
            } else {
                glyph.x_advance
            };
        }
        if !fragments.is_empty()
            && fragments
                .iter()
                .map(|fragment| fragment.text.as_str())
                .collect::<String>()
                == line.text
        {
            line.fragments = Some(fragments);
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct MaterializedClusterIdentity<'a> {
    source_start: Option<u32>,
    source_end: Option<u32>,
    cluster_start: u32,
    cluster_end: u32,
    synthetic_kind: Option<&'a str>,
}

fn text_run_style_for_glyph(
    req: &TextLayoutRequest<'_>,
    chosen_font_size_px: f64,
    glyph: &PositionedGlyph,
    span: Option<&TextSpanInput>,
) -> TextRunStyle {
    let authored_font_size = span.map_or(req.font_size_px, |span| span.font_size_px);
    let resolved_font_size = glyph.font_size_px.unwrap_or(chosen_font_size_px);
    let scale = if authored_font_size > 0.0 {
        resolved_font_size / authored_font_size
    } else {
        1.0
    };
    let letter_spacing_px = span
        .and_then(|span| span.letter_spacing_px)
        .unwrap_or(req.letter_spacing_px)
        * scale;
    TextRunStyle {
        font: glyph.font_alias.clone(),
        fallback: glyph.font_fallback.clone(),
        font_weight: glyph.font_weight,
        font_style: glyph.font_style.clone(),
        font_size_px: resolved_font_size,
        letter_spacing_px,
        text_orientation: span
            .and_then(|span| span.text_orientation.as_deref())
            .map(|orientation| TextOrientation::from_option(Some(orientation))),
        font_variation_settings: glyph
            .font_variation_settings
            .clone()
            .or_else(|| span.and_then(|span| span.font_variation_settings.clone())),
        font_feature_settings: glyph
            .font_feature_settings
            .clone()
            .or_else(|| span.and_then(|span| span.font_feature_settings.clone())),
        color: glyph
            .fill
            .clone()
            .or_else(|| span.and_then(|span| span.color.clone())),
        text_strokes: glyph
            .text_strokes
            .clone()
            .or_else(|| span.and_then(|span| span.text_strokes.clone())),
        text_shadows: glyph
            .text_shadows
            .clone()
            .or_else(|| span.and_then(|span| span.text_shadows.clone())),
        language: span.and_then(|span| span.language.clone()),
    }
}

fn validate_layout_request_resources(
    req: &TextLayoutRequest<'_>,
) -> Result<(), crate::TextLayoutError> {
    let Some(nodes) = req.rich_text else {
        return Ok(());
    };
    validate_rich_text_resources(nodes).map_err(|violation| match violation {
        RichTextResourceViolation::Depth { actual, limit } => {
            crate::TextLayoutError::RichTextDepthLimit { actual, limit }
        }
        RichTextResourceViolation::InlineRects { required, limit } => {
            crate::TextLayoutError::InlineRectLimit { required, limit }
        }
    })
}

fn record_text_materialization(layout_result: &TextLayoutResult) {
    #[cfg(any(test, feature = "phase-trace"))]
    {
        let glyph_count = layout_result
            .lines
            .iter()
            .map(|line| {
                line.positioned_glyphs
                    .as_ref()
                    .map_or(line.glyphs.len(), std::vec::Vec::len)
            })
            .sum();
        crate::phase_trace::record_materialization(
            layout_result.lines.len(),
            glyph_count,
            layout_result.inline_box_decorations.len() + layout_result.text_decorations.len(),
            layout_result.inline_rects.len(),
        );
    }
    #[cfg(not(any(test, feature = "phase-trace")))]
    let _ = layout_result;
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

fn layout_text_inner_authoritative(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    should_include_unit_metadata: bool,
) -> Result<TextLayoutResult, crate::TextLayoutError> {
    ensure_text_fit_budget(req)?;
    // Measure and fit the complete authored document first. Only when that
    // complete plan overflows does any input shape enter the canonical rich
    // projection. Resource feasibility is checked before the first exact
    // prefix candidate is shaped.
    if req.ellipsis && req.max_lines.is_some() {
        let complete_request = TextLayoutRequest {
            ellipsis: false,
            ..req.clone()
        };
        let complete = layout_text_inner(&complete_request, font_ctx, should_include_unit_metadata)
            .ok_or(crate::TextLayoutError::PreparationFailed)?;
        if is_complete_text_plan_fit(req, &complete) {
            return Ok(complete);
        }

        let chosen_font_size_px = complete.chosen_font_size_px;

        if req.has_rich_text() {
            ensure_ellipsis_candidate_budget(req, font_ctx)?;
            return rich::layout_rich_text_at_selected_font_size(
                req,
                font_ctx,
                chosen_font_size_px,
            )
            .ok_or(crate::TextLayoutError::PreparationFailed);
        }
        let canonical_nodes = promote_request_to_rich_nodes(req);
        let canonical_request = TextLayoutRequest {
            text: "",
            spans: None,
            rich_text: Some(&canonical_nodes),
            ..req.clone()
        };
        ensure_ellipsis_candidate_budget(&canonical_request, font_ctx)?;
        return rich::layout_rich_text_at_selected_font_size(
            &canonical_request,
            font_ctx,
            chosen_font_size_px,
        )
        .ok_or(crate::TextLayoutError::PreparationFailed);
    }

    layout_text_inner(req, font_ctx, should_include_unit_metadata)
        .ok_or(crate::TextLayoutError::PreparationFailed)
}

fn ensure_text_fit_budget(req: &TextLayoutRequest<'_>) -> Result<(), crate::TextLayoutError> {
    if req.fit == FitMode::None || is_text_fit_certified_monotone(req) {
        return Ok(());
    }
    let (lower, upper, step) = match req.fit {
        FitMode::Shrink => (
            req.min_font_size_px
                .unwrap_or(8.0)
                .max(f64::EPSILON)
                .min(req.font_size_px),
            req.font_size_px,
            req.shrink_epsilon_px.unwrap_or(0.25),
        ),
        FitMode::Grow => (
            req.font_size_px,
            req.max_font_size_px
                .unwrap_or(req.font_size_px * 4.0)
                .max(req.font_size_px),
            req.grow_epsilon_px.unwrap_or(0.25),
        ),
        FitMode::None => return Ok(()),
    };
    super::super::flow::ensure_grid_budget(lower, upper, step, req.fit_max_probes).map_err(
        |error| match error {
            crate::BoundtextError::InvalidFitStep => crate::TextLayoutError::InvalidFitStep,
            crate::BoundtextError::FitProbeLimit { required, limit } => {
                crate::TextLayoutError::FitProbeLimit { required, limit }
            }
            _ => crate::TextLayoutError::PreparationFailed,
        },
    )?;
    Ok(())
}

fn ensure_ellipsis_candidate_budget(
    req: &TextLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
) -> Result<(), crate::TextLayoutError> {
    let required = rich::ellipsis_candidate_upper_bound(req, font_ctx);
    let limit = super::super::ellipsis_plan::ELLIPSIS_CANDIDATES_MAX;
    if required > limit {
        return Err(crate::TextLayoutError::EllipsisCandidateLimit { required, limit });
    }
    Ok(())
}

pub(crate) fn layout_text_inner(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    should_include_unit_metadata: bool,
) -> Option<TextLayoutResult> {
    layout_text_inner_with_span_promotion(req, font_ctx, should_include_unit_metadata, true)
}

/// Text-on-path has already canonicalized shaping runs and paint ranges. It
/// must retain those prepared span boundaries while obtaining the initial
/// straight-line glyph plan.
pub(crate) fn layout_text_inner_with_prepared_spans(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    should_include_unit_metadata: bool,
) -> Option<TextLayoutResult> {
    layout_text_inner_with_span_promotion(req, font_ctx, should_include_unit_metadata, false)
}

fn layout_text_inner_with_span_promotion(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    should_include_unit_metadata: bool,
    should_promote_spans: bool,
) -> Option<TextLayoutResult> {
    if should_promote_spans
        && !req.has_rich_text()
        && let Some(spans) = req.spans.filter(|spans| !spans.is_empty())
    {
        let rich_nodes = promote_spans_to_rich_nodes(spans);
        let rich_request = TextLayoutRequest {
            spans: None,
            rich_text: Some(&rich_nodes),
            ..req.clone()
        };
        return rich::layout_rich_text(&rich_request, font_ctx);
    }
    if req.has_rich_text() || req.text_indent.unwrap_or(0.0) != 0.0 || req.fit != FitMode::None {
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
        return fit_shrink_for_request(req, font_ctx, should_include_unit_metadata);
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

fn is_complete_text_plan_fit(
    req: &TextLayoutRequest<'_>,
    layout_result: &TextLayoutResult,
) -> bool {
    layout_result.overflow.overflow_type == "none"
        && layout_result.lines.len() <= req.max_lines.unwrap_or(usize::MAX)
        && layout_result.bbox.w <= req.max_width + 0.001
        && req
            .max_height
            .is_none_or(|max_height| layout_result.bbox.h <= max_height + 0.001)
}

fn promote_request_to_rich_nodes(
    req: &TextLayoutRequest<'_>,
) -> Vec<super::super::types::RichTextNodeInput> {
    if let Some(spans) = req.spans.filter(|spans| !spans.is_empty()) {
        promote_spans_to_rich_nodes(spans)
    } else {
        vec![super::super::types::RichTextNodeInput::Text {
            text: req.text.to_string(),
        }]
    }
}

fn promote_spans_to_rich_nodes(
    spans: &[TextSpanInput],
) -> Vec<super::super::types::RichTextNodeInput> {
    spans
        .iter()
        .map(|span| super::super::types::RichTextNodeInput::Span {
            text: span.text.clone(),
            style: super::super::types::RichTextStyleInput {
                font_family: span.font_family.clone(),
                font_weight: span.font_weight,
                font_style: span.font_style.clone(),
                font_size_px: span.font_size_px,
                line_height: None,
                line_height_px: None,
                letter_spacing_px: span.letter_spacing_px,
                language: span.language.clone(),
                color: span.color.clone(),
                text_strokes: span.text_strokes.clone(),
                text_shadows: span.text_shadows.clone(),
                font_variation_settings: span.font_variation_settings.clone(),
                font_feature_settings: span.font_feature_settings.clone(),
                text_orientation: span.text_orientation.clone(),
                text_decoration: span.text_decoration.clone(),
            },
        })
        .collect()
}

fn fit_shrink_for_request(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    should_include_unit_metadata: bool,
) -> Option<TextLayoutResult> {
    if should_include_unit_metadata {
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
