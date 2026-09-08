//! Request-level shrinkwrap algorithms with geometry supplied by the renderer.

use crate::font::FontContext;
use crate::font::line_metrics::resolve_line_metrics_for_style;
use crate::font::shaping::ShapeOptions;
use crate::text::types::{
    FitMode, Language, MAX_RICH_TEXT_DEPTH, RichTextNodeInput, TextLayoutRequest, TextOrientation,
    WhiteSpaceMode, WrapMode, WritingMode, first_excess_rich_text_depth,
    preprocess_span_texts_for_white_space, preprocess_text_for_white_space,
};
use crate::text::{flow as bt_flow, inline_runs, paragraph, shrinkwrap};

/// Raw text and authored constraints for the orientation-specific shrinkwrap routes.
pub struct TextShrinkwrapRequest<'a> {
    pub text: &'a str,
    pub spans: Option<&'a [bt_flow::FlowTextSpan]>,
    pub rich_text: Option<&'a [RichTextNodeInput]>,
    pub font_size_px: f64,
    pub line_height: Option<f64>,
    pub line_height_px: Option<f64>,
    pub letter_spacing_px: f64,
    pub language: Language,
    pub wrap: WrapMode,
    pub white_space: WhiteSpaceMode,
    pub tab_size: u32,
    pub hanging_punctuation: bool,
    pub writing_mode: WritingMode,
    pub shape_options: ShapeOptions,
    pub max_width: f64,
    pub max_height: Option<f64>,
    pub min_width: Option<f64>,
    pub min_height: Option<f64>,
    pub target_line_count: Option<usize>,
    pub config: shrinkwrap::ShrinkwrapConfig,
}

/// Shrinkwrap measurements whose optional extents follow the writing mode.
#[derive(Debug)]
pub struct TextShrinkwrapResult {
    pub status: shrinkwrap::ShrinkwrapStatus,
    pub chosen_width_px: Option<f64>,
    pub chosen_height_px: Option<f64>,
    pub line_count: usize,
    pub used_width: Option<f64>,
    pub used_height: f64,
    pub max_line_width: Option<f64>,
}

/// Supplies geometry for a candidate frame without deciding text feasibility.
pub trait ShrinkwrapRegionProvider {
    /// Return usable regions for one candidate frame and line band.
    ///
    /// # Errors
    ///
    /// Returns the existing typed geometry-provider failure.
    fn regions(
        &self,
        bounds: bt_flow::FlowBounds,
        query: bt_flow::RegionQuery,
    ) -> Result<Vec<bt_flow::FlowRegion>, crate::RegionProviderError>;
}

struct CandidateRegions<'a, P> {
    bounds: bt_flow::FlowBounds,
    provider: &'a P,
}

impl<P: ShrinkwrapRegionProvider> bt_flow::RegionProvider for CandidateRegions<'_, P> {
    fn regions(
        &self,
        query: bt_flow::RegionQuery,
    ) -> Result<Vec<bt_flow::FlowRegion>, crate::RegionProviderError> {
        self.provider.regions(self.bounds, query)
    }
}

fn layout_shrinkwrap_candidate(
    request: &bt_flow::FlowLayoutRequest<'_>,
    font_context: &FontContext<'_>,
    regions: &impl bt_flow::RegionProvider,
) -> Result<bt_flow::FlowLayoutResult, crate::TextLayoutError> {
    bt_flow::validate_flow_request_resources(request)?;
    let budgeted_regions = bt_flow::BudgetedRegionProvider::new(regions);
    let flow_layout =
        bt_flow::layout_flow_with_regions_budgeted(request, font_context, &budgeted_regions)?;
    bt_flow::record_flow_materialization(&flow_layout);
    Ok(flow_layout)
}

fn plain_layout_request<'a>(input: &TextShrinkwrapRequest<'a>) -> TextLayoutRequest<'a> {
    TextLayoutRequest {
        text: input.text,
        spans: None,
        rich_text: None,
        font_size_px: input.font_size_px,
        line_height: input.line_height,
        line_height_px: input.line_height_px,
        letter_spacing_px: input.letter_spacing_px,
        text_indent: None,
        max_width: input.max_width,
        max_height: input.max_height,
        wrap: input.wrap,
        white_space: input.white_space,
        tab_size: input.tab_size,
        fit: FitMode::None,
        max_lines: None,
        ellipsis: false,
        language: input.language,
        writing_mode: input.writing_mode,
        text_orientation: TextOrientation::from_option(
            input.shape_options.text_orientation.as_deref(),
        ),
        uax14_breaks: None,
        hanging_punctuation: input.hanging_punctuation,
        font_variation_settings: input.shape_options.font_variation_settings.clone(),
        font_feature_settings: input.shape_options.font_feature_settings.clone(),
        min_font_size_px: None,
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
        fit_max_probes: None,
    }
}

/// Headroom for synthesized unconstrained flow height. Tight authored line
/// heights can be smaller than the font's ascent/descent, while mixed-size
/// runs and ruby can extend farther; the unit count also includes annotation
/// text, providing additional room for stacked ruby levels.
const UNCONSTRAINED_FONT_EXTENT_MULTIPLIER: f64 = 2.0;

fn count_rich_text_units(nodes: &[RichTextNodeInput]) -> usize {
    nodes
        .iter()
        .map(|node| match node {
            RichTextNodeInput::Text { text }
            | RichTextNodeInput::Span { text, .. }
            | RichTextNodeInput::Combine { text, .. } => text.chars().count(),
            RichTextNodeInput::Ruby {
                base,
                rt,
                rt_levels,
                ..
            } => {
                let annotation_units = if rt_levels.is_empty() {
                    count_rich_text_units(rt)
                } else {
                    rt_levels
                        .iter()
                        .map(|level| count_rich_text_units(level))
                        .sum()
                };
                count_rich_text_units(base) + annotation_units
            }
            RichTextNodeInput::InlineBox { children, .. }
            | RichTextNodeInput::DecoratedSpan { children, .. } => count_rich_text_units(children),
            RichTextNodeInput::InlineRect { .. } => 1,
        })
        .sum()
}

fn max_rich_text_font_size_px(nodes: &[RichTextNodeInput], inherited_font_size_px: f64) -> f64 {
    nodes.iter().fold(inherited_font_size_px, |maximum, node| {
        let node_maximum = match node {
            RichTextNodeInput::Text { .. } | RichTextNodeInput::InlineRect { .. } => {
                inherited_font_size_px
            }
            RichTextNodeInput::Span { style, .. } | RichTextNodeInput::Combine { style, .. } => {
                style.font_size_px
            }
            RichTextNodeInput::Ruby {
                style,
                base,
                rt,
                rt_levels,
                ..
            } => {
                let base_maximum = max_rich_text_font_size_px(base, style.font_size_px);
                let annotation_maximum = max_rich_text_font_size_px(rt, style.font_size_px);
                rt_levels.iter().fold(
                    style.font_size_px.max(base_maximum).max(annotation_maximum),
                    |level_maximum, level| {
                        level_maximum.max(max_rich_text_font_size_px(level, style.font_size_px))
                    },
                )
            }
            RichTextNodeInput::InlineBox {
                style, children, ..
            }
            | RichTextNodeInput::DecoratedSpan {
                style, children, ..
            } => style
                .font_size_px
                .max(max_rich_text_font_size_px(children, style.font_size_px)),
        };
        maximum.max(node_maximum)
    })
}

fn max_flow_span_font_size_px(spans: &[bt_flow::FlowTextSpan], base_font_size_px: f64) -> f64 {
    spans.iter().fold(base_font_size_px, |maximum, span| {
        maximum
            .max(span.font_size_px.unwrap_or(base_font_size_px))
            .max(span.ruby_font_size_px.unwrap_or(0.0))
    })
}

fn compute_horizontal_max_line_width(layout_result: &bt_flow::FlowLayoutResult) -> f64 {
    layout_result
        .lines
        .iter()
        .map(|line| {
            let min_x = line
                .fragments
                .iter()
                .map(|fragment| fragment.x)
                .fold(f64::INFINITY, f64::min);
            let max_x = line
                .fragments
                .iter()
                .map(|fragment| fragment.x + fragment.inline_advance_px)
                .fold(0.0_f64, f64::max);
            if min_x.is_finite() {
                (max_x - min_x).max(0.0)
            } else {
                0.0
            }
        })
        .fold(0.0_f64, f64::max)
}

fn compute_vertical_used_width(
    flow_bounds: &bt_flow::FlowBounds,
    layout_result: &bt_flow::FlowLayoutResult,
) -> f64 {
    let right_edge = flow_bounds.x + flow_bounds.width;
    layout_result
        .lines
        .iter()
        .filter_map(|line| {
            line.fragments
                .first()
                .map(|fragment| right_edge - fragment.x)
        })
        .fold(0.0_f64, f64::max)
        .max(0.0)
}

fn compute_flow_used_height(
    flow_bounds: &bt_flow::FlowBounds,
    layout_result: &bt_flow::FlowLayoutResult,
    is_vertical: bool,
) -> f64 {
    if layout_result.lines.is_empty() {
        return 0.0;
    }

    let fb_y = flow_bounds.y;
    if is_vertical {
        // In vertical flow, `inline_advance_px` is the fragment's physical height on screen.
        // Ruby extents are already reflected in fragment geometry, so no extra
        // top/bottom overflow term is added here.
        layout_result
            .lines
            .iter()
            .flat_map(|line| line.fragments.iter())
            .map(|fragment| fragment.y + fragment.inline_advance_px)
            .fold(0.0_f64, f64::max)
            - fb_y
    } else {
        layout_result
            .lines
            .iter()
            .filter_map(|line| {
                line.fragments
                    .first()
                    .map(|fragment| fragment.y + line.cross_size)
            })
            .fold(0.0_f64, f64::max)
            - fb_y
    }
    .max(0.0)
}

/// Shrinkwrap raw text while retaining each source and writing-mode route.
///
/// # Errors
///
/// Returns the first typed resource, provider, preparation, or layout failure.
pub fn shrinkwrap_text(
    input: &TextShrinkwrapRequest<'_>,
    font_ctx: &FontContext<'_>,
    region_provider: &impl ShrinkwrapRegionProvider,
) -> Result<TextShrinkwrapResult, crate::TextLayoutError> {
    let font_families = font_ctx.families;
    let language = input.language;
    let white_space = input.white_space;
    let effective_wrap = if white_space == WhiteSpaceMode::NoWrap {
        WrapMode::None
    } else {
        input.wrap
    };
    let force_newline = white_space == WhiteSpaceMode::PreWrap;
    let line_height_px = resolve_line_metrics_for_style(
        font_ctx.registry,
        font_ctx.fallback_registry,
        font_ctx.families,
        font_ctx.weight,
        font_ctx.style,
        input.font_size_px,
        input.line_height,
        input.line_height_px,
    )
    .line_height_px;
    let writing_mode = input.writing_mode;
    let is_vertical = writing_mode == WritingMode::VerticalRl;
    let shape_options = ShapeOptions {
        writing_mode: (writing_mode == WritingMode::VerticalRl).then(|| "vertical-rl".into()),
        vertical_feature_priority: (writing_mode == WritingMode::VerticalRl).then(|| "true".into()),
        language: match language {
            Language::Ja => Some("ja".into()),
            Language::En => Some("en".into()),
            Language::Auto => None,
        },
        ..input.shape_options.clone()
    };
    let has_authored_spans = input.spans.as_ref().is_some_and(|spans| !spans.is_empty());
    let has_rich_text = input
        .rich_text
        .as_ref()
        .is_some_and(|nodes| !nodes.is_empty());

    if has_authored_spans && has_rich_text {
        return Err(crate::TextLayoutError::InvalidRequest {
            reason: crate::TextRequestError::ConflictingTextSources,
        });
    }

    let preprocessed = crate::text::types::preprocess_text_for_white_space(
        input.text,
        white_space,
        input.tab_size,
    );
    let text = preprocessed.as_str();
    let synthetic_spans =
        if !has_authored_spans && !has_rich_text && !text.is_empty() && font_families.len() > 1 {
            Some(vec![bt_flow::FlowTextSpan::plain(text.to_string())])
        } else {
            None
        };
    let has_spans = has_authored_spans || synthetic_spans.is_some();
    let bt_spans: Option<Vec<bt_flow::FlowTextSpan>> = input
        .spans
        .as_ref()
        .filter(|spans| !spans.is_empty())
        .map_or_else(|| synthetic_spans, |spans| Some(spans.to_vec()));
    let bt_spans_ref = bt_spans.as_deref();
    let rich_text_ref = input.rich_text.filter(|nodes| !nodes.is_empty());
    if let Some(actual_depth) = rich_text_ref.and_then(first_excess_rich_text_depth) {
        return Err(crate::TextLayoutError::RichTextDepthLimit {
            actual: actual_depth,
            limit: MAX_RICH_TEXT_DEPTH,
        });
    }

    let config = &input.config;

    if force_newline && (has_spans || has_rich_text) {
        let converted_rich_text;
        let preformatted_rich_text = if let Some(flow_spans) = bt_spans_ref {
            let (text_spans, _) = bt_flow::build_inline_runs_inputs(
                flow_spans,
                font_ctx,
                input.font_size_px,
                input.letter_spacing_px,
                language,
                input.shape_options.text_orientation.as_deref(),
                &shape_options,
            );
            converted_rich_text = bt_flow::build_flow_rich_text_inputs(
                flow_spans,
                &text_spans,
                input.line_height,
                input.line_height_px,
            );
            Some(converted_rich_text.as_slice())
        } else {
            rich_text_ref
        };
        let layout_req = TextLayoutRequest {
            text,
            spans: None,
            rich_text: preformatted_rich_text,
            font_size_px: input.font_size_px,
            line_height: input.line_height,
            line_height_px: input.line_height_px,
            letter_spacing_px: input.letter_spacing_px,
            text_indent: None,
            max_width: input.max_width,
            max_height: input.max_height,
            wrap: effective_wrap,
            white_space: WhiteSpaceMode::PreWrap,
            tab_size: input.tab_size,
            fit: FitMode::None,
            max_lines: None,
            ellipsis: false,
            language,
            writing_mode,
            text_orientation: TextOrientation::from_option(
                input.shape_options.text_orientation.as_deref(),
            ),
            uax14_breaks: None,
            hanging_punctuation: input.hanging_punctuation,
            font_variation_settings: shape_options.font_variation_settings.clone(),
            font_feature_settings: shape_options.font_feature_settings.clone(),
            min_font_size_px: None,
            shrink_epsilon_px: None,
            shrink_max_iterations: None,
            max_font_size_px: None,
            grow_epsilon_px: None,
            grow_max_iterations: None,
            fit_max_probes: None,
        };
        if is_vertical {
            let max_height = input
                .max_height
                .ok_or(crate::TextLayoutError::InvalidRequest {
                    reason: crate::TextRequestError::MissingInlineConstraint {
                        field: crate::TextConstraintField::FlowBounds,
                    },
                })?;
            let result = shrinkwrap::shrinkwrap_text_layout_vertical(
                &layout_req,
                font_ctx,
                input.target_line_count,
                input.min_height,
                max_height,
                input.max_width,
                config,
            )?;
            return Ok(TextShrinkwrapResult {
                status: result.status,
                chosen_width_px: None,
                chosen_height_px: Some(result.chosen_height_px),
                line_count: result.line_count,
                used_width: Some(result.used_width),
                used_height: result.used_height,
                max_line_width: None,
            });
        }

        let result = shrinkwrap::shrinkwrap_text_layout_horizontal(
            &layout_req,
            font_ctx,
            input.target_line_count,
            input.min_width,
            input.max_width,
            config,
        )?;
        return Ok(TextShrinkwrapResult {
            status: result.status,
            chosen_width_px: Some(result.chosen_width_px),
            chosen_height_px: None,
            line_count: result.line_count,
            used_width: None,
            used_height: result.used_height,
            max_line_width: Some(result.max_line_width),
        });
    }

    if has_spans || has_rich_text {
        let estimated_units = if let Some(spans) = bt_spans_ref {
            spans
                .iter()
                .map(|span| span.text.chars().count())
                .sum::<usize>()
        } else if let Some(nodes) = rich_text_ref {
            count_rich_text_units(nodes)
        } else {
            text.chars().count()
        }
        .max(input.target_line_count.unwrap_or(1))
        .max(1);
        let max_authored_font_size_px = if let Some(spans) = bt_spans_ref {
            max_flow_span_font_size_px(spans, input.font_size_px)
        } else if let Some(nodes) = rich_text_ref {
            max_rich_text_font_size_px(nodes, input.font_size_px)
        } else {
            input.font_size_px
        };
        let conservative_line_extent = line_height_px
            .max(max_authored_font_size_px * UNCONSTRAINED_FONT_EXTENT_MULTIPLIER)
            .max(1.0);
        let unconstrained_height = (estimated_units as f64 + 2.0) * conservative_line_extent;
        let horizontal_cross_extent = unconstrained_height.max(line_height_px.max(1.0));

        let build_req = |flow_bounds: bt_flow::FlowBounds| bt_flow::FlowLayoutRequest {
            text: if has_spans || has_rich_text { "" } else { text },
            font_size_px: input.font_size_px,
            line_height: input.line_height,
            line_height_px: input.line_height_px,
            letter_spacing_px: input.letter_spacing_px,
            language,
            wrap: effective_wrap,
            white_space,
            tab_size: input.tab_size,
            hanging_punctuation: input.hanging_punctuation,
            flow_bounds,
            min_region_width: None,
            max_lines: None,
            ellipsis: false,
            fit: None,
            spans: bt_spans_ref,
            rich_text: rich_text_ref,
            writing_mode,
            text_orientation: input.shape_options.text_orientation.as_deref(),
            min_font_size_px: None,
            max_font_size_px: None,
            fit_epsilon_px: None,
            fit_max_iterations: None,
            fit_max_probes: None,
            shape_options: shape_options.clone(),
        };

        let layout_at = |candidate: f64| -> Result<
            (bt_flow::FlowLayoutResult, bt_flow::FlowBounds),
            crate::TextLayoutError,
        > {
            let flow_box = if is_vertical {
                bt_flow::FlowBounds {
                    x: 0.0,
                    y: 0.0,
                    width: input.max_width,
                    height: candidate,
                }
            } else {
                bt_flow::FlowBounds {
                    x: 0.0,
                    y: 0.0,
                    width: candidate,
                    height: horizontal_cross_extent,
                }
            };
            let regions = CandidateRegions {
                bounds: flow_box,
                provider: region_provider,
            };
            let flow_bounds = bt_flow::FlowBounds {
                x: flow_box.x,
                y: flow_box.y,
                width: flow_box.width,
                height: flow_box.height,
            };
            let req = build_req(flow_bounds);
            let layout_result = layout_shrinkwrap_candidate(&req, font_ctx, &regions)?;
            Ok((layout_result, flow_bounds))
        };

        let original_size = if is_vertical {
            input
                .max_height
                .ok_or(crate::TextLayoutError::InvalidRequest {
                    reason: crate::TextRequestError::MissingInlineConstraint {
                        field: crate::TextConstraintField::FlowBounds,
                    },
                })?
        } else {
            input.max_width
        };
        let min_size = if is_vertical {
            input
                .min_height
                .unwrap_or(input.font_size_px)
                .max(input.font_size_px.min(original_size))
        } else {
            input
                .min_width
                .unwrap_or(input.font_size_px)
                .max(input.font_size_px.min(original_size))
        };
        let (max_layout, _) = layout_at(original_size)?;
        let target_line_count = input
            .target_line_count
            .unwrap_or(max_layout.used_line_count);

        let (status, chosen_size) = if !max_layout.exhausted
            || !bt_flow::flow_layout_is_contained(&max_layout)
            || max_layout.used_line_count > target_line_count
        {
            (shrinkwrap::ShrinkwrapStatus::Infeasible, original_size)
        } else {
            let (min_layout, _) = layout_at(min_size)?;
            if min_layout.exhausted
                && bt_flow::flow_layout_is_contained(&min_layout)
                && min_layout.used_line_count == target_line_count
            {
                (shrinkwrap::ShrinkwrapStatus::Satisfied, min_size)
            } else if min_layout.exhausted
                && bt_flow::flow_layout_is_contained(&min_layout)
                && min_layout.used_line_count < target_line_count
            {
                (shrinkwrap::ShrinkwrapStatus::Infeasible, original_size)
            } else {
                let mut lo = min_size;
                let mut hi = original_size;
                for _ in 0..config.max_iterations {
                    if hi - lo < config.epsilon_px {
                        break;
                    }
                    let mid = f64::midpoint(lo, hi);
                    let (mid_layout, _) = layout_at(mid)?;
                    if mid_layout.exhausted
                        && bt_flow::flow_layout_is_contained(&mid_layout)
                        && mid_layout.used_line_count <= target_line_count
                    {
                        hi = mid;
                    } else {
                        lo = mid;
                    }
                }
                let (hi_layout, _) = layout_at(hi)?;
                if hi_layout.exhausted
                    && bt_flow::flow_layout_is_contained(&hi_layout)
                    && hi_layout.used_line_count == target_line_count
                {
                    (shrinkwrap::ShrinkwrapStatus::Satisfied, hi)
                } else {
                    (shrinkwrap::ShrinkwrapStatus::Infeasible, original_size)
                }
            }
        };

        let (final_layout, final_bounds) = layout_at(chosen_size)?;
        let used_height = compute_flow_used_height(&final_bounds, &final_layout, is_vertical);

        return Ok(TextShrinkwrapResult {
            status,
            chosen_width_px: if is_vertical { None } else { Some(chosen_size) },
            chosen_height_px: if is_vertical { Some(chosen_size) } else { None },
            line_count: final_layout.used_line_count,
            used_width: if is_vertical {
                Some(compute_vertical_used_width(&final_bounds, &final_layout))
            } else {
                None
            },
            used_height,
            max_line_width: if is_vertical {
                None
            } else {
                Some(compute_horizontal_max_line_width(&final_layout))
            },
        });
    }

    if is_vertical {
        let max_height = input
            .max_height
            .ok_or(crate::TextLayoutError::InvalidRequest {
                reason: crate::TextRequestError::MissingInlineConstraint {
                    field: crate::TextConstraintField::FlowBounds,
                },
            })?;
        let result = shrinkwrap::shrinkwrap_vertical_text(
            text,
            font_ctx,
            input.font_size_px,
            line_height_px,
            input.letter_spacing_px,
            language,
            effective_wrap,
            input.hanging_punctuation,
            &ShapeOptions {
                writing_mode: shape_options.writing_mode.clone(),
                language: shape_options.language.clone(),
                vertical_feature_priority: Some("true".to_string()),
                text_orientation: input.shape_options.text_orientation.clone(),
                font_variation_settings: shape_options.font_variation_settings.clone(),
                font_feature_settings: shape_options.font_feature_settings.clone(),
            },
            input.target_line_count,
            input.max_width,
            input.min_height.unwrap_or(0.0),
            max_height,
            config,
            force_newline,
        )?;

        Ok(TextShrinkwrapResult {
            status: result.status,
            chosen_width_px: None,
            chosen_height_px: Some(result.chosen_height_px),
            line_count: result.line_count,
            used_width: Some(result.used_width),
            used_height: result.used_height,
            max_line_width: None,
        })
    } else {
        let pp = paragraph::shape_paragraph_with_options(
            text,
            font_ctx,
            language,
            effective_wrap,
            input.hanging_punctuation,
            &ShapeOptions {
                font_variation_settings: shape_options.font_variation_settings.clone(),
                font_feature_settings: shape_options.font_feature_settings.clone(),
                language: shape_options.language.clone(),
                ..ShapeOptions::default()
            },
            None,
            input.letter_spacing_px,
            force_newline,
        );
        let Some(pp) = pp else {
            let layout_request = plain_layout_request(input);
            let fallback_result = shrinkwrap::shrinkwrap_text_layout_horizontal(
                &layout_request,
                font_ctx,
                input.target_line_count,
                input.min_width,
                input.max_width,
                config,
            )?;
            return Ok(TextShrinkwrapResult {
                status: fallback_result.status,
                chosen_width_px: Some(fallback_result.chosen_width_px),
                chosen_height_px: None,
                line_count: fallback_result.line_count,
                used_width: None,
                used_height: fallback_result.used_height,
                max_line_width: Some(fallback_result.max_line_width),
            });
        };

        let target_line_count = if let Some(t) = input.target_line_count {
            t
        } else {
            let measurement = paragraph::measure_paragraph(
                &pp,
                input.font_size_px,
                line_height_px,
                input.max_width,
                effective_wrap,
                force_newline,
            );
            measurement.line_count
        };

        let min_width = input
            .min_width
            .unwrap_or_else(|| shrinkwrap::min_possible_width(&pp, input.font_size_px));

        let result = shrinkwrap::shrinkwrap_paragraph(
            &pp,
            input.font_size_px,
            line_height_px,
            target_line_count,
            min_width,
            input.max_width,
            effective_wrap,
            config,
            force_newline,
        );

        Ok(TextShrinkwrapResult {
            status: result.status,
            chosen_width_px: Some(result.chosen_width_px),
            chosen_height_px: None,
            line_count: result.line_count,
            used_width: None,
            used_height: result.used_height,
            max_line_width: Some(result.max_line_width),
        })
    }
}

/// Raw region-flow input and the existing bounded-search constraints.
pub struct FlowShrinkwrapRequest<'a> {
    pub text: &'a str,
    pub spans: Option<&'a [bt_flow::FlowTextSpan]>,
    pub rich_text: Option<&'a [RichTextNodeInput]>,
    pub font_size_px: f64,
    pub line_height: Option<f64>,
    pub line_height_px: Option<f64>,
    pub letter_spacing_px: f64,
    pub language: Language,
    pub wrap: WrapMode,
    pub hanging_punctuation: bool,
    pub writing_mode: WritingMode,
    pub shape_options: ShapeOptions,
    pub flow_bounds: bt_flow::FlowBounds,
    pub min_region_width: Option<f64>,
    pub max_lines: Option<usize>,
    pub min_width: Option<f64>,
    pub min_height: Option<f64>,
    pub target_line_count: Option<usize>,
    pub config: shrinkwrap::ShrinkwrapConfig,
}

/// Final candidate and its authoritative flow layout.
#[derive(Debug)]
pub struct FlowShrinkwrapResult {
    pub status: shrinkwrap::ShrinkwrapStatus,
    pub chosen_width_px: Option<f64>,
    pub chosen_height_px: Option<f64>,
    pub used_line_count: usize,
    pub used_height: f64,
    pub layout: bt_flow::FlowLayoutResult,
}

fn shrinkwrap_preparation_error(font_context: &FontContext<'_>) -> crate::TextLayoutError {
    let has_font = font_context
        .registry
        .resolve_chain(
            font_context.families,
            font_context.weight,
            font_context.style,
        )
        .or_else(|| {
            font_context.fallback_registry.and_then(|registry| {
                registry.resolve_chain(
                    font_context.families,
                    font_context.weight,
                    font_context.style,
                )
            })
        })
        .is_some();
    if has_font {
        crate::TextLayoutError::PreparationFailed {
            phase: crate::TextPreparationPhase::PlainShaping,
        }
    } else {
        crate::TextLayoutError::FontUnavailable {
            run_index: 0,
            families: font_context.families.to_vec(),
            weight: font_context.weight,
            style: font_context.style.clone(),
        }
    }
}

/// Search candidate flow frames while the provider supplies geometry alone.
///
/// # Errors
///
/// Returns the first typed shaping, resource, provider, or layout failure.
pub fn shrinkwrap_flow(
    input: &FlowShrinkwrapRequest<'_>,
    font_ctx: &FontContext<'_>,
    region_provider: &impl ShrinkwrapRegionProvider,
) -> Result<FlowShrinkwrapResult, crate::TextLayoutError> {
    let font_families = font_ctx.families;
    let language = input.language;
    let white_space = WhiteSpaceMode::PreWrap;
    let wrap = input.wrap;
    let writing_mode = input.writing_mode;
    let normalized_text = preprocess_text_for_white_space(input.text, white_space, 4);
    let line_height_px = resolve_line_metrics_for_style(
        font_ctx.registry,
        font_ctx.fallback_registry,
        font_ctx.families,
        font_ctx.weight,
        font_ctx.style,
        input.font_size_px,
        input.line_height,
        input.line_height_px,
    )
    .line_height_px;
    // Match the final boundtext layout default. A zero default lets the
    // lightweight measure path accept regions that final layout filters out.
    let min_region_width = input.min_region_width.unwrap_or(input.font_size_px);
    let epsilon = input.config.epsilon_px;
    let max_iter = input.config.max_iterations;

    let is_vertical = writing_mode == WritingMode::VerticalRl;
    let shape_options = ShapeOptions {
        writing_mode: (writing_mode == WritingMode::VerticalRl).then(|| "vertical-rl".into()),
        vertical_feature_priority: (writing_mode == WritingMode::VerticalRl).then(|| "true".into()),
        language: match language {
            Language::Ja => Some("ja".into()),
            Language::En => Some("en".into()),
            Language::Auto => None,
        },
        ..input.shape_options.clone()
    };
    // Convert spans (if provided) and shape once.
    let has_authored_spans = input.spans.as_ref().is_some_and(|s| !s.is_empty());
    let has_rich_text = input
        .rich_text
        .as_ref()
        .is_some_and(|nodes| !nodes.is_empty());
    if has_authored_spans && has_rich_text {
        return Err(crate::TextLayoutError::InvalidRequest {
            reason: crate::TextRequestError::ConflictingTextSources,
        });
    }
    let synthetic_spans = if !has_authored_spans
        && !has_rich_text
        && !normalized_text.is_empty()
        && font_families.len() > 1
    {
        Some(vec![bt_flow::FlowTextSpan::plain(normalized_text.clone())])
    } else {
        None
    };
    let has_spans = has_authored_spans || synthetic_spans.is_some();
    let mut bt_spans: Option<Vec<bt_flow::FlowTextSpan>> = input
        .spans
        .as_ref()
        .filter(|spans| !spans.is_empty())
        .map_or_else(|| synthetic_spans, |spans| Some(spans.to_vec()));
    if let Some(spans) = bt_spans.as_mut() {
        let span_texts = spans
            .iter()
            .map(|span| span.text.as_str())
            .collect::<Vec<_>>();
        if let Some(normalized_span_texts) =
            preprocess_span_texts_for_white_space(&span_texts, white_space, 4)
        {
            for (span, normalized_text) in spans.iter_mut().zip(normalized_span_texts) {
                span.text = normalized_text;
            }
        }
    }
    let bt_spans_ref = bt_spans.as_deref();
    let rich_text_ref = input.rich_text.filter(|nodes| !nodes.is_empty());

    // Shape: inline-runs path (spans) or plain paragraph path.
    let inline_inputs = if let Some(bt_spans) = bt_spans_ref {
        let (text_spans, ruby_info) = bt_flow::build_inline_runs_inputs(
            bt_spans,
            font_ctx,
            input.font_size_px,
            input.letter_spacing_px,
            language,
            input.shape_options.text_orientation.as_deref(),
            &shape_options,
        );
        let shaped_runs = inline_runs::prepare_inline_runs(
            &text_spans,
            font_ctx,
            input.letter_spacing_px,
            language,
            input.hanging_punctuation,
            &ruby_info,
            is_vertical,
        )?;
        Some((text_spans, shaped_runs))
    } else {
        None
    };

    let pp = if !has_spans && !has_rich_text {
        Some(
            paragraph::shape_paragraph_with_options(
                &normalized_text,
                font_ctx,
                language,
                wrap,
                input.hanging_punctuation,
                &shape_options,
                None,
                input.letter_spacing_px,
                true,
            )
            .ok_or_else(|| shrinkwrap_preparation_error(font_ctx))?,
        )
    } else {
        None
    };

    let build_req = |flow_bounds: bt_flow::FlowBounds| bt_flow::FlowLayoutRequest {
        text: if has_spans || has_rich_text {
            ""
        } else {
            &normalized_text
        },
        font_size_px: input.font_size_px,
        line_height: input.line_height,
        line_height_px: input.line_height_px,
        letter_spacing_px: input.letter_spacing_px,
        language,
        wrap,
        white_space,
        tab_size: 4,
        hanging_punctuation: input.hanging_punctuation,
        flow_bounds,
        min_region_width: input.min_region_width,
        max_lines: input.max_lines,
        ellipsis: false,
        fit: None,
        spans: bt_spans_ref,
        rich_text: rich_text_ref,
        writing_mode,
        text_orientation: input.shape_options.text_orientation.as_deref(),
        min_font_size_px: None,
        max_font_size_px: None,
        fit_epsilon_px: None,
        fit_max_iterations: None,
        fit_max_probes: None,
        shape_options: shape_options.clone(),
    };

    // Unified measure closure: delegates to inline, rich, or plain path.
    let measure_at = |candidate: f64| -> Result<(usize, bool), crate::TextLayoutError> {
        let fb = if is_vertical {
            bt_flow::FlowBounds {
                x: input.flow_bounds.x,
                y: input.flow_bounds.y,
                width: input.flow_bounds.width,
                height: candidate,
            }
        } else {
            bt_flow::FlowBounds {
                x: input.flow_bounds.x,
                y: input.flow_bounds.y,
                width: candidate,
                height: input.flow_bounds.height,
            }
        };
        let regions = CandidateRegions {
            bounds: fb,
            provider: region_provider,
        };
        let bt_fb = bt_flow::FlowBounds {
            x: fb.x,
            y: fb.y,
            width: fb.width,
            height: fb.height,
        };

        if let Some((text_spans, runs)) = inline_inputs.as_ref() {
            let measurement = if is_vertical {
                let column_width = line_height_px;
                bt_flow::measure_flow_vertical_inline_with_styles(
                    runs,
                    text_spans,
                    font_ctx,
                    input.font_size_px,
                    column_width,
                    input.line_height,
                    input.line_height_px,
                    &bt_fb,
                    &regions,
                    min_region_width,
                    input.max_lines,
                    wrap,
                )
            } else {
                bt_flow::measure_flow_inline_with_styles(
                    runs,
                    text_spans,
                    font_ctx,
                    input.font_size_px,
                    line_height_px,
                    input.line_height,
                    input.line_height_px,
                    &bt_fb,
                    &regions,
                    min_region_width,
                    input.max_lines,
                    wrap,
                )
            }?;
            Ok((measurement.used_line_count, measurement.fits()))
        } else if has_rich_text {
            let req = build_req(bt_fb);
            let result = layout_shrinkwrap_candidate(&req, font_ctx, &regions)?;
            let fits = result.exhausted && bt_flow::flow_layout_is_contained(&result);
            Ok((result.used_line_count, fits))
        } else {
            let Some(pp) = pp.as_ref() else {
                return Err(crate::TextLayoutError::PreparationFailed {
                    phase: crate::TextPreparationPhase::FlowPreparation,
                });
            };
            let measurement = if is_vertical {
                let column_width = line_height_px;
                bt_flow::measure_flow_vertical(
                    pp,
                    input.font_size_px,
                    column_width,
                    &bt_fb,
                    &regions,
                    min_region_width,
                    input.max_lines,
                    wrap,
                )
            } else {
                bt_flow::measure_flow(
                    pp,
                    input.font_size_px,
                    line_height_px,
                    &bt_fb,
                    &regions,
                    min_region_width,
                    input.max_lines,
                    wrap,
                )
            }?;
            Ok((measurement.used_line_count, measurement.fits()))
        }
    };

    let target_line_count = if let Some(t) = input.target_line_count {
        t
    } else {
        let measurement = measure_at(if is_vertical {
            input.flow_bounds.height
        } else {
            input.flow_bounds.width
        })?;
        measurement.0
    };

    // Determine search variable and range.
    let original_size = if is_vertical {
        input.flow_bounds.height
    } else {
        input.flow_bounds.width
    };
    let min_size = if is_vertical {
        input.min_height.unwrap_or(0.0_f64).max(0.0)
    } else {
        input.min_width.unwrap_or(0.0_f64).max(0.0)
    };

    // Check feasibility at original size.
    let status;
    let chosen_size;

    let (orig_lines, orig_exhausted) = measure_at(original_size)?;
    if !orig_exhausted || orig_lines > target_line_count {
        status = shrinkwrap::ShrinkwrapStatus::Infeasible;
        chosen_size = original_size;
    } else {
        let (min_lines, min_exhausted) = measure_at(min_size)?;
        if min_exhausted && min_lines == target_line_count {
            status = shrinkwrap::ShrinkwrapStatus::Satisfied;
            chosen_size = min_size;
        } else {
            let mut lo = min_size;
            let mut hi = original_size;
            for _ in 0..max_iter {
                if hi - lo < epsilon {
                    break;
                }
                let mid = f64::midpoint(lo, hi);
                let (mid_lines, mid_exhausted) = measure_at(mid)?;
                if mid_exhausted && mid_lines <= target_line_count {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            let (hi_lines, hi_exhausted) = measure_at(hi)?;
            if hi_exhausted && hi_lines == target_line_count {
                status = shrinkwrap::ShrinkwrapStatus::Satisfied;
                chosen_size = hi;
            } else {
                status = shrinkwrap::ShrinkwrapStatus::Infeasible;
                chosen_size = original_size;
            }
        }
    }

    // Build final layout at chosen size.
    let final_fb = if is_vertical {
        bt_flow::FlowBounds {
            x: input.flow_bounds.x,
            y: input.flow_bounds.y,
            width: input.flow_bounds.width,
            height: chosen_size,
        }
    } else {
        bt_flow::FlowBounds {
            x: input.flow_bounds.x,
            y: input.flow_bounds.y,
            width: chosen_size,
            height: input.flow_bounds.height,
        }
    };
    let final_regions = CandidateRegions {
        bounds: final_fb,
        provider: region_provider,
    };
    let final_flow_bounds = bt_flow::FlowBounds {
        x: final_fb.x,
        y: final_fb.y,
        width: final_fb.width,
        height: final_fb.height,
    };

    let req = build_req(final_flow_bounds);

    let layout_result = layout_shrinkwrap_candidate(&req, font_ctx, &final_regions)?;
    let used_line_count = layout_result.used_line_count;

    let used_height = compute_flow_used_height(&final_flow_bounds, &layout_result, is_vertical);

    Ok(FlowShrinkwrapResult {
        status,
        chosen_width_px: if is_vertical { None } else { Some(chosen_size) },
        chosen_height_px: if is_vertical { Some(chosen_size) } else { None },
        used_line_count,
        used_height,
        layout: layout_result,
    })
}
