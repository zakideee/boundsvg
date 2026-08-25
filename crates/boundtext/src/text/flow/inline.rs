use crate::font::line_metrics::resolve_line_metrics_for_style;
use crate::font::shaping::{
    ShapeOptions, format_css_font_feature_settings, format_css_font_variation_settings,
};
use crate::font::{FontContext, FontStyle};
use crate::text::inline_runs;
use crate::text::paragraph;
use crate::text::types::{
    Language, RichTextNodeInput, RichTextStyleInput, TextSpanInput, WritingMode,
};

use super::{
    FlowFragment, FlowFragmentStyle, FlowLayoutRequest, FlowMeasure, FlowTextSpan, RegionProvider,
    measure_flow_inline_with_styles, measure_flow_vertical_inline_with_styles,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Convert a `FlowTextSpan` to `TextSpanInput` by merging parent-level defaults.
fn flow_span_to_text_span(
    span: &FlowTextSpan,
    default_font_families: &[String],
    default_font_weight: u16,
    default_font_style: Option<&str>,
    default_font_size_px: f64,
    default_letter_spacing_px: f64,
    language: Option<&str>,
    text_orientation: Option<&str>,
    default_font_variation_settings: Option<&str>,
    default_font_feature_settings: Option<&str>,
) -> TextSpanInput {
    let primary_family = span
        .font_family
        .as_deref()
        .map(str::trim)
        .filter(|family| !family.is_empty())
        .or_else(|| default_font_families.first().map(String::as_str))
        .unwrap_or_default()
        .to_string();
    let inherited_fallback = default_font_families.get(1..).unwrap_or_default();
    let mut font_families = vec![primary_family];
    for family in span.fallback.as_deref().unwrap_or(inherited_fallback) {
        let trimmed = family.trim();
        if !trimmed.is_empty() && !font_families.iter().any(|existing| existing == trimmed) {
            font_families.push(trimmed.to_string());
        }
    }
    TextSpanInput {
        text: span.text.clone(),
        font_family: font_families,
        font_weight: span.font_weight.unwrap_or(default_font_weight),
        font_style: match span.font_style.as_deref().or(default_font_style) {
            Some("italic") => FontStyle::Italic,
            _ => FontStyle::Normal,
        },
        font_size_px: span.font_size_px.unwrap_or(default_font_size_px),
        letter_spacing_px: span
            .letter_spacing_px
            .or(if default_letter_spacing_px == 0.0 {
                None
            } else {
                Some(default_letter_spacing_px)
            }),
        language: language.map(String::from),
        text_orientation: text_orientation.map(String::from),
        color: span.color.clone(),
        text_strokes: None,
        text_shadows: None,
        font_variation_settings: span
            .font_variation_settings
            .clone()
            .or_else(|| default_font_variation_settings.map(str::to_string)),
        font_feature_settings: span
            .font_feature_settings
            .clone()
            .or_else(|| default_font_feature_settings.map(str::to_string)),
        text_decoration: None,
        decoration_transport_only: false,
    }
}

/// Build [`TextSpanInput`] and [`inline_runs::SpanRubyInfo`] vectors from
/// [`FlowTextSpan`] slices. This centralises the default resolution
/// (ruby position = "over", align = "space-around", font-size = 50 % base)
/// shared by `layout_flow_inline`, `layout_flow_vertical_inline`, and
/// the shrinkwrap-flow inline path.
#[must_use]
pub fn build_inline_runs_inputs(
    spans: &[FlowTextSpan],
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    letter_spacing_px: f64,
    language: Language,
    text_orientation: Option<&str>,
    shape_options: &ShapeOptions,
) -> (Vec<TextSpanInput>, Vec<Option<inline_runs::SpanRubyInfo>>) {
    let default_font_style_str = match font_ctx.style {
        FontStyle::Italic => Some("italic"),
        FontStyle::Normal => None,
    };
    let language_str = match language {
        Language::Ja => Some("ja"),
        Language::En => Some("en"),
        Language::Auto => None,
    };
    let default_font_variation_settings =
        format_css_font_variation_settings(&shape_options.font_variation_settings);
    let default_font_feature_settings =
        format_css_font_feature_settings(&shape_options.font_feature_settings);

    let text_spans: Vec<TextSpanInput> = spans
        .iter()
        .map(|span| {
            flow_span_to_text_span(
                span,
                font_ctx.families,
                font_ctx.weight,
                default_font_style_str,
                font_size_px,
                letter_spacing_px,
                language_str,
                text_orientation,
                default_font_variation_settings.as_deref(),
                default_font_feature_settings.as_deref(),
            )
        })
        .collect();

    let ruby_info = spans
        .iter()
        .map(|span| {
            span.ruby_text
                .as_ref()
                .map(|ruby_text| inline_runs::SpanRubyInfo {
                    ruby_text: ruby_text.clone(),
                    ruby_position: span
                        .ruby_position
                        .clone()
                        .unwrap_or_else(|| "over".to_string()),
                    ruby_align: span
                        .ruby_align
                        .clone()
                        .unwrap_or_else(|| "space-around".to_string()),
                    ruby_font_size_px: span.ruby_font_size_px.unwrap_or(font_size_px * 0.5),
                    ruby_color: span.ruby_color.clone(),
                })
        })
        .collect();

    (text_spans, ruby_info)
}

fn text_span_to_rich_style(
    span: &TextSpanInput,
    line_height: Option<f64>,
    line_height_px: Option<f64>,
) -> RichTextStyleInput {
    RichTextStyleInput {
        font_family: span.font_family.clone(),
        font_weight: span.font_weight,
        font_style: span.font_style.clone(),
        font_size_px: span.font_size_px,
        line_height,
        line_height_px,
        letter_spacing_px: span.letter_spacing_px,
        language: span.language.clone(),
        color: span.color.clone(),
        text_strokes: span.text_strokes.clone(),
        text_shadows: span.text_shadows.clone(),
        font_variation_settings: span.font_variation_settings.clone(),
        font_feature_settings: span.font_feature_settings.clone(),
        text_orientation: span.text_orientation.clone(),
        text_decoration: span.text_decoration.clone(),
    }
}

/// Convert resolved legacy flow spans into rich-text nodes so preformatted
/// shrinkwrap can preserve ruby metadata as well as forced newline behavior.
#[must_use]
pub fn build_flow_rich_text_inputs(
    flow_spans: &[FlowTextSpan],
    text_spans: &[TextSpanInput],
    line_height: Option<f64>,
    line_height_px: Option<f64>,
) -> Vec<RichTextNodeInput> {
    flow_spans
        .iter()
        .zip(text_spans)
        .map(|(flow_span, text_span)| {
            let base_style = text_span_to_rich_style(text_span, line_height, line_height_px);
            if let Some(ruby_text) = flow_span.ruby_text.as_ref() {
                let mut annotation_style = base_style.clone();
                annotation_style.font_size_px = flow_span
                    .ruby_font_size_px
                    .unwrap_or(text_span.font_size_px * 0.5);
                annotation_style.line_height = Some(1.0);
                annotation_style.line_height_px = None;
                annotation_style.color = flow_span
                    .ruby_color
                    .clone()
                    .or_else(|| text_span.color.clone());
                RichTextNodeInput::Ruby {
                    ruby_position: flow_span.ruby_position.clone(),
                    ruby_align: flow_span.ruby_align.clone(),
                    ruby_gap_px: None,
                    ruby_offset_px: None,
                    ruby_line_sizing: None,
                    style: base_style,
                    base: vec![RichTextNodeInput::Text {
                        text: flow_span.text.clone(),
                    }],
                    rt: vec![RichTextNodeInput::Span {
                        text: ruby_text.clone(),
                        style: annotation_style,
                    }],
                    rt_levels: Vec::new(),
                }
            } else {
                RichTextNodeInput::Span {
                    text: flow_span.text.clone(),
                    style: base_style,
                }
            }
        })
        .collect()
}

fn scale_flow_span(span: &FlowTextSpan, scale: f64) -> FlowTextSpan {
    let scale_opt = |value: Option<f64>| value.map(|inner| inner * scale);
    FlowTextSpan {
        text: span.text.clone(),
        font_family: span.font_family.clone(),
        fallback: span.fallback.clone(),
        font_weight: span.font_weight,
        font_style: span.font_style.clone(),
        font_size_px: scale_opt(span.font_size_px),
        letter_spacing_px: scale_opt(span.letter_spacing_px),
        color: span.color.clone(),
        font_variation_settings: span.font_variation_settings.clone(),
        font_feature_settings: span.font_feature_settings.clone(),
        ruby_text: span.ruby_text.clone(),
        ruby_position: span.ruby_position.clone(),
        ruby_align: span.ruby_align.clone(),
        ruby_font_size_px: scale_opt(span.ruby_font_size_px),
        ruby_color: span.ruby_color.clone(),
    }
}

pub(super) fn prepare_inline_flow_inputs(
    req: &FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    chosen_font_size_px: f64,
) -> (
    Vec<FlowTextSpan>,
    Vec<TextSpanInput>,
    Vec<Option<inline_runs::SpanRubyInfo>>,
    inline_runs::ShapedInlineRuns,
) {
    // Callers dispatch here only when spans exist; an absent value degrades to
    // an empty inline flow rather than aborting the render.
    let spans_input = req.spans.unwrap_or_default();
    let scale = chosen_font_size_px / req.font_size_px.max(f64::EPSILON);
    let spans = if (scale - 1.0).abs() < f64::EPSILON {
        spans_input.to_vec()
    } else {
        spans_input
            .iter()
            .map(|span| scale_flow_span(span, scale))
            .collect()
    };
    let letter_spacing_px = req.letter_spacing_px * scale;
    let (text_spans, ruby_info) = build_inline_runs_inputs(
        &spans,
        font_ctx,
        chosen_font_size_px,
        letter_spacing_px,
        req.language,
        req.text_orientation,
        &req.shape_options,
    );
    let shaped_runs = inline_runs::prepare_inline_runs(
        &text_spans,
        font_ctx,
        letter_spacing_px,
        req.language,
        req.hanging_punctuation,
        &ruby_info,
        req.writing_mode == WritingMode::VerticalRl,
    );
    (spans, text_spans, ruby_info, shaped_runs)
}

/// Alphabetic baseline offset resolved from font metrics for flow fragments.
pub(super) fn default_alphabetic_baseline_offset_px(
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    line_height: Option<f64>,
    line_height_px: Option<f64>,
) -> f64 {
    super::resolve_flow_baseline_offset_px(font_ctx, font_size_px, line_height, line_height_px)
}

pub(super) fn measure_inline_flow_at_font_size(
    req: &FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    region_provider: &impl RegionProvider,
    chosen_font_size_px: f64,
) -> Result<FlowMeasure, crate::BoundtextError> {
    let (_, text_spans, _, shaped_runs) =
        prepare_inline_flow_inputs(req, font_ctx, chosen_font_size_px);
    let min_region_extent = req.min_region_width.unwrap_or(chosen_font_size_px);

    if req.writing_mode == WritingMode::VerticalRl {
        let column_width = super::resolve_flow_line_height_px(
            font_ctx,
            chosen_font_size_px,
            req.line_height,
            req.line_height_px,
        );
        measure_flow_vertical_inline_with_styles(
            &shaped_runs,
            &text_spans,
            font_ctx,
            chosen_font_size_px,
            column_width,
            req.line_height,
            req.line_height_px,
            &req.flow_bounds,
            region_provider,
            min_region_extent,
            req.max_lines,
            req.wrap,
        )
    } else {
        let line_height_px = super::resolve_flow_line_height_px(
            font_ctx,
            chosen_font_size_px,
            req.line_height,
            req.line_height_px,
        );
        measure_flow_inline_with_styles(
            &shaped_runs,
            &text_spans,
            font_ctx,
            chosen_font_size_px,
            line_height_px,
            req.line_height,
            req.line_height_px,
            &req.flow_bounds,
            region_provider,
            min_region_extent,
            req.max_lines,
            req.wrap,
        )
    }
}

/// Split a `LayoutLineFragment` at run boundaries, attaching per-run style.
pub(super) fn split_fragment_at_run_boundaries(
    fragment: &paragraph::LayoutLineFragment,
    shaped_runs: &inline_runs::ShapedInlineRuns,
    line_top: f64,
    regions: &[(f64, f64)],
    spans: &[TextSpanInput],
    font_ctx: &FontContext<'_>,
    line_height: Option<f64>,
    line_height_px: Option<f64>,
) -> Vec<FlowFragment> {
    let region_x = regions[fragment.region_index].0;
    let region_w = regions[fragment.region_index].1;
    let mut result = Vec::new();
    let mut x = region_x;

    for segment in &shaped_runs.segments {
        let overlap_start = fragment.char_start.max(segment.start);
        let overlap_end = fragment.char_end.min(segment.end);
        if overlap_start >= overlap_end {
            continue;
        }

        let byte_start = shaped_runs.char_byte_offsets[overlap_start] as usize;
        let byte_end = shaped_runs.char_byte_offsets[overlap_end] as usize;
        let text = shaped_runs.text[byte_start..byte_end].to_string();
        let width: f64 = shaped_runs.grapheme_advances_px[overlap_start..overlap_end]
            .iter()
            .sum();

        let span = &spans[segment.span_index.min(spans.len() - 1)];
        let line_metrics = resolve_line_metrics_for_style(
            font_ctx.registry,
            font_ctx.fallback_registry,
            &span.font_family,
            span.font_weight,
            &span.font_style,
            span.font_size_px,
            line_height,
            line_height_px,
        );
        let contains_fragment_tail = overlap_end == fragment.char_end;
        result.push(FlowFragment {
            text,
            char_start: overlap_start,
            char_end: overlap_end,
            x,
            y: line_top,
            inline_advance_px: width,
            available_inline_size_px: region_w,
            region_index: fragment.region_index,
            baseline_offset: line_metrics.baseline_offset_px,
            overflow_reason: if contains_fragment_tail {
                fragment
                    .overflow_reason
                    .map(super::layout_overflow_reason_name)
            } else {
                None
            },
            intentional_overflow_px: if contains_fragment_tail {
                fragment.intentional_overflow_px
            } else {
                0.0
            },
            style: Some(FlowFragmentStyle {
                font_family: span.font_family.first().cloned().unwrap_or_default(),
                font_weight: span.font_weight,
                font_style: match span.font_style {
                    FontStyle::Italic => "italic".to_string(),
                    FontStyle::Normal => "normal".to_string(),
                },
                font_size_px: span.font_size_px,
                letter_spacing_px: span.letter_spacing_px,
                color: span.color.clone(),
            }),
            ruby: shaped_runs
                .ruby_annotations
                .iter()
                .find(|annotation| {
                    overlap_start <= annotation.grapheme_start
                        && annotation.grapheme_end <= overlap_end
                })
                .map(|annotation| super::FlowRubyAnnotation {
                    text: annotation.text.clone(),
                    position: annotation.position.clone(),
                    align: annotation.align.clone(),
                    style: FlowFragmentStyle {
                        font_family: span.font_family.first().cloned().unwrap_or_default(),
                        font_weight: span.font_weight,
                        font_style: match span.font_style {
                            FontStyle::Italic => "italic".to_string(),
                            FontStyle::Normal => "normal".to_string(),
                        },
                        font_size_px: annotation.font_size_px,
                        letter_spacing_px: None,
                        color: annotation.color.clone().or_else(|| span.color.clone()),
                    },
                    gap_px: crate::text::rich::ruby_gap_px(annotation.font_size_px),
                    offset_px: 0.0,
                    line_sizing: "css".to_string(),
                    levels: vec![super::FlowRubyAnnotationLevel {
                        text: annotation.text.clone(),
                        position: annotation.position.clone(),
                        runs: vec![super::FlowRubyAnnotationRun {
                            text: annotation.text.clone(),
                            style: FlowFragmentStyle {
                                font_family: span.font_family.first().cloned().unwrap_or_default(),
                                font_weight: span.font_weight,
                                font_style: match span.font_style {
                                    FontStyle::Italic => "italic".to_string(),
                                    FontStyle::Normal => "normal".to_string(),
                                },
                                font_size_px: annotation.font_size_px,
                                letter_spacing_px: None,
                                color: annotation.color.clone().or_else(|| span.color.clone()),
                            },
                        }],
                    }],
                }),
            positioned_glyphs: Vec::new(),
            inline_rects: Vec::new(),
        });
        x += width;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::FontRegistry;

    #[test]
    fn flow_span_resolves_inherited_and_explicit_fallback_chains() {
        let defaults = vec!["Primary".to_string(), "InheritedFallback".to_string()];
        let inherited = flow_span_to_text_span(
            &FlowTextSpan::plain("日本語".to_string()),
            &defaults,
            400,
            None,
            20.0,
            0.0,
            Some("ja"),
            None,
            Some("\"wght\" 700"),
            Some("\"palt\" 1"),
        );
        assert_eq!(inherited.font_family, defaults);
        assert_eq!(
            inherited.font_variation_settings.as_deref(),
            Some("\"wght\" 700")
        );
        assert_eq!(
            inherited.font_feature_settings.as_deref(),
            Some("\"palt\" 1")
        );

        let explicit = flow_span_to_text_span(
            &FlowTextSpan {
                font_family: Some(" SpanPrimary ".to_string()),
                fallback: Some(vec![
                    " SpanFallback ".to_string(),
                    "SpanPrimary".to_string(),
                    String::new(),
                ]),
                font_variation_settings: Some("\"wght\" 500".to_string()),
                font_feature_settings: Some(String::new()),
                ..FlowTextSpan::plain("日本語".to_string())
            },
            &["ParentPrimary".to_string(), "ParentFallback".to_string()],
            400,
            None,
            20.0,
            0.0,
            Some("ja"),
            None,
            Some("\"wght\" 700"),
            Some("\"palt\" 1"),
        );
        assert_eq!(
            explicit.font_family,
            vec!["SpanPrimary".to_string(), "SpanFallback".to_string()]
        );
        assert_eq!(
            explicit.font_variation_settings.as_deref(),
            Some("\"wght\" 500")
        );
        assert_eq!(explicit.font_feature_settings.as_deref(), Some(""));
    }

    #[test]
    fn flow_ruby_default_align_is_space_around() {
        let registry = FontRegistry::new();
        let families = vec!["NotoSansJP".to_string()];
        let font_style = FontStyle::Normal;
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &font_style,
        };
        let spans = vec![FlowTextSpan {
            text: "京".to_string(),
            font_family: None,
            fallback: None,
            font_weight: None,
            font_style: None,
            font_size_px: None,
            letter_spacing_px: None,
            color: None,
            font_variation_settings: None,
            font_feature_settings: None,
            ruby_text: Some("きょう".to_string()),
            ruby_position: None,
            ruby_align: None,
            ruby_font_size_px: None,
            ruby_color: None,
        }];

        let (text_spans, ruby_info) = build_inline_runs_inputs(
            &spans,
            &font_ctx,
            20.0,
            0.0,
            Language::Ja,
            None,
            &ShapeOptions::default(),
        );
        let ruby = ruby_info[0].as_ref().expect("ruby info");

        assert_eq!(ruby.ruby_position, "over");
        assert_eq!(ruby.ruby_align, "space-around");
        assert_eq!(ruby.ruby_font_size_px, 10.0);

        let rich_text = build_flow_rich_text_inputs(&spans, &text_spans, Some(1.4), Some(40.0));
        let RichTextNodeInput::Ruby { style, rt, .. } = &rich_text[0] else {
            panic!("expected converted ruby node");
        };
        assert_eq!(style.line_height_px, Some(40.0));
        let RichTextNodeInput::Span {
            style: annotation_style,
            ..
        } = &rt[0]
        else {
            panic!("expected converted annotation span");
        };
        assert_eq!(annotation_style.line_height, Some(1.0));
        assert_eq!(annotation_style.line_height_px, None);
    }

    #[test]
    fn fallback_baseline_offset_uses_last_resort_metrics() {
        let registry = FontRegistry::new();
        let families = vec!["NotoSansJP".to_string()];
        let font_style = FontStyle::Normal;
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &font_style,
        };

        assert_eq!(
            default_alphabetic_baseline_offset_px(&font_ctx, 20.0, None, None),
            18.0
        );
    }
}
