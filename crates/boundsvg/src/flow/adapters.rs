use super::conversions::{
    ExclusionRegionProvider, convert_flow_result, convert_flow_span, convert_simple_result,
};
use super::types::{
    TextFlowInput, TextFlowResult, TextFlowWithExclusionsInput, TextFlowWithExclusionsResult,
};
use crate::font::{FontContext, FontRegistry, FontStyle};
use crate::layout::types::{TextInput, parse_feature_settings_opt, parse_variation_settings_opt};
use crate::text::flow as bt_flow;
use crate::text::types::{
    FitMode, Language, TextLayoutRequest, TextLayoutResult, TextOrientation, WhiteSpaceMode,
    WrapMode, WritingMode,
};
use crate::text::types::{preprocess_span_texts_for_white_space, preprocess_text_for_white_space};

// ---------------------------------------------------------------------------
// Adapter: simple flow
// ---------------------------------------------------------------------------

pub(crate) fn layout_text_flow(
    input: &TextFlowInput,
    registry: &FontRegistry,
) -> Result<TextFlowResult, boundtext::TextLayoutError> {
    let font_families = super::build_font_families(&input.font_family, input.fallback.as_deref());
    let font_style = match input.font_style.as_deref() {
        Some("italic") => FontStyle::Italic,
        _ => FontStyle::Normal,
    };
    let font_ctx = FontContext {
        registry,
        fallback_registry: None,
        families: &font_families,
        weight: input.font_weight.unwrap_or(400),
        style: &font_style,
    };

    let language = Language::from_option(input.language.as_deref());
    let white_space =
        WhiteSpaceMode::from_option(input.white_space.as_deref().or(Some("pre-wrap")));
    let raw_wrap = input
        .wrap
        .as_deref()
        .map_or(WrapMode::Char, WrapMode::parse_str);
    let wrap = if white_space == WhiteSpaceMode::NoWrap {
        WrapMode::None
    } else {
        raw_wrap
    };
    let writing_mode = WritingMode::from_option(input.writing_mode.as_deref());
    let normalized_text =
        preprocess_text_for_white_space(&input.text, white_space, input.tab_size.unwrap_or(4));

    let req = bt_flow::FlowSimpleRequest {
        text: &normalized_text,
        font_size_px: input.font_size_px,
        line_height: input.line_height,
        letter_spacing_px: input.letter_spacing_px.unwrap_or(0.0),
        language,
        wrap,
        hanging_punctuation: input.hanging_punctuation.unwrap_or(false),
        line_widths: &input.line_widths,
        writing_mode,
        text_orientation: crate::text::types::TextOrientation::from_option(
            input.text_orientation.as_deref(),
        ),
        font_variation_settings: parse_variation_settings_opt(
            input.font_variation_settings.as_deref(),
        ),
        font_feature_settings: parse_feature_settings_opt(input.font_feature_settings.as_deref()),
    };

    let flow_layout = bt_flow::layout_flow_simple(&req, &font_ctx)?;
    Ok(convert_simple_result(flow_layout))
}

// ---------------------------------------------------------------------------
// Adapter: exclusion-based flow
// ---------------------------------------------------------------------------

/// Resolve diagnostics-oriented flow against boundsvg exclusion geometry.
///
/// # Errors
///
/// Returns a typed validation, resource, provider, shaping, or layout failure.
pub(crate) fn layout_text_flow_with_exclusions(
    input: &TextFlowWithExclusionsInput,
    registry: &FontRegistry,
) -> Result<TextFlowWithExclusionsResult, boundtext::TextLayoutError> {
    let font_families = super::build_font_families(&input.font_family, input.fallback.as_deref());
    let font_style = match input.font_style.as_deref() {
        Some("italic") => FontStyle::Italic,
        _ => FontStyle::Normal,
    };
    let font_ctx = FontContext {
        registry,
        fallback_registry: None,
        families: &font_families,
        weight: input.font_weight.unwrap_or(400),
        style: &font_style,
    };

    let language = Language::from_option(input.language.as_deref());
    let white_space =
        WhiteSpaceMode::from_option(input.white_space.as_deref().or(Some("pre-wrap")));
    let raw_wrap = input
        .wrap
        .as_deref()
        .map_or(WrapMode::Char, WrapMode::parse_str);
    let wrap = if white_space == WhiteSpaceMode::NoWrap {
        WrapMode::None
    } else {
        raw_wrap
    };
    let writing_mode = WritingMode::from_option(input.writing_mode.as_deref());

    let rich_text_ref = input.rich_text.as_deref().filter(|nodes| !nodes.is_empty());
    let mut bt_spans: Option<Vec<bt_flow::FlowTextSpan>> =
        if let Some(spans) = input.spans.as_ref().filter(|spans| !spans.is_empty()) {
            Some(spans.iter().map(convert_flow_span).collect())
        } else if rich_text_ref.is_none() && !input.text.is_empty() && font_families.len() > 1 {
            Some(vec![bt_flow::FlowTextSpan::plain(input.text.clone())])
        } else {
            None
        };
    if let Some(spans) = bt_spans.as_mut() {
        let span_texts = spans
            .iter()
            .map(|span| span.text.as_str())
            .collect::<Vec<_>>();
        if let Some(normalized_span_texts) = preprocess_span_texts_for_white_space(
            &span_texts,
            white_space,
            input.tab_size.unwrap_or(4),
        ) {
            for (span, normalized_text) in spans.iter_mut().zip(normalized_span_texts) {
                span.text = normalized_text;
            }
        }
    }
    let bt_spans_ref = bt_spans.as_deref();
    if bt_spans_ref.is_some_and(|spans| !spans.is_empty()) && rich_text_ref.is_some() {
        return Err(boundtext::TextLayoutError::InvalidRequest {
            reason: boundtext::TextRequestError::ConflictingTextSources,
        });
    }

    let shape_options = crate::font::shaping::ShapeOptions {
        writing_mode: input.writing_mode.clone(),
        language: input.language.clone(),
        vertical_feature_priority: if writing_mode == WritingMode::VerticalRl {
            Some("true".to_string())
        } else {
            None
        },
        text_orientation: input.text_orientation.clone(),
        font_variation_settings: parse_variation_settings_opt(
            input.font_variation_settings.as_deref(),
        ),
        font_feature_settings: parse_feature_settings_opt(input.font_feature_settings.as_deref()),
    };

    let flow_bounds = bt_flow::FlowBounds {
        x: input.flow_box.x,
        y: input.flow_box.y,
        width: input.flow_box.width,
        height: input.flow_box.height,
    };

    let region_provider = ExclusionRegionProvider {
        flow_box: &input.flow_box,
        exclusions: &input.exclusions,
    };
    let normalized_text =
        preprocess_text_for_white_space(&input.text, white_space, input.tab_size.unwrap_or(4));

    let req = bt_flow::FlowLayoutRequest {
        text: if bt_spans_ref.is_some() || rich_text_ref.is_some() {
            ""
        } else {
            &normalized_text
        },
        font_size_px: input.font_size_px,
        line_height: input.line_height,
        line_height_px: input.line_height_px,
        letter_spacing_px: input.letter_spacing_px.unwrap_or(0.0),
        language,
        wrap,
        white_space,
        tab_size: input.tab_size.unwrap_or(4),
        hanging_punctuation: input.hanging_punctuation.unwrap_or(false),
        flow_bounds,
        min_region_width: input.min_region_width_px,
        max_lines: input.max_lines,
        ellipsis: input.ellipsis.unwrap_or(false),
        fit: input.fit.as_deref(),
        spans: bt_spans_ref,
        rich_text: rich_text_ref,
        writing_mode,
        text_orientation: input.text_orientation.as_deref(),
        min_font_size_px: input.min_font_size_px,
        max_font_size_px: input.max_font_size_px,
        fit_epsilon_px: input.fit_epsilon_px,
        fit_max_iterations: input.fit_max_iterations,
        fit_max_probes: input.fit_max_probes,
        shape_options,
    };

    let flow_layout = bt_flow::layout_flow_with_regions(&req, &font_ctx, &region_provider)?;
    Ok(convert_flow_result(flow_layout))
}

/// Layout a renderable Text node around exclusions in one boundtext pass.
///
/// # Errors
///
/// Returns a typed validation, resource, provider, shaping, or layout failure.
pub(crate) fn layout_resolved_text_flow(
    text_input: &TextInput,
    width: f64,
    height: f64,
    registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
) -> Result<TextLayoutResult, boundtext::TextLayoutError> {
    let flow = text_input
        .flow
        .as_ref()
        .ok_or(boundtext::TextLayoutError::InvalidRequest {
            reason: boundtext::TextRequestError::InvalidRequestShape,
        })?;

    let font_families = if text_input.font_family.is_empty() {
        vec!["default".to_string()]
    } else {
        text_input.font_family.clone()
    };
    let font_ctx = FontContext {
        registry,
        fallback_registry,
        families: &font_families,
        weight: text_input.font_weight,
        style: &text_input.font_style,
    };
    let language = Language::from_option(text_input.language.as_deref());
    let white_space = WhiteSpaceMode::from_option(text_input.white_space.as_deref());
    let raw_wrap = WrapMode::parse_str(&text_input.wrap);
    let wrap = if white_space == WhiteSpaceMode::NoWrap {
        WrapMode::None
    } else {
        raw_wrap
    };
    let writing_mode = WritingMode::from_option(text_input.writing_mode.as_deref());
    let rich_text = text_input
        .rich_text
        .as_deref()
        .filter(|nodes| !nodes.is_empty());
    let coalesced_decoration_spans = text_input
        .spans
        .as_deref()
        .filter(|_| rich_text.is_none())
        .filter(|spans| spans.iter().any(|span| span.text_decoration.is_some()))
        .map(crate::text::decoration::coalesce_decoration_only_spans);
    let layout_spans = coalesced_decoration_spans
        .as_deref()
        .or(text_input.spans.as_deref());
    let flow_spans = if rich_text.is_some() {
        None
    } else {
        layout_spans.filter(|spans| !spans.is_empty()).map(|spans| {
            spans
                .iter()
                .map(|span| bt_flow::FlowTextSpan {
                    text: span.text.clone(),
                    font_family: span.font_family.first().cloned(),
                    fallback: (span.font_family.len() > 1).then(|| span.font_family[1..].to_vec()),
                    font_weight: Some(span.font_weight),
                    font_style: Some(match span.font_style {
                        FontStyle::Italic => "italic".to_string(),
                        FontStyle::Normal => "normal".to_string(),
                    }),
                    font_size_px: Some(span.font_size_px),
                    letter_spacing_px: span.letter_spacing_px,
                    color: span.color.clone(),
                    font_variation_settings: span.font_variation_settings.clone(),
                    font_feature_settings: span.font_feature_settings.clone(),
                    ruby_text: None,
                    ruby_position: None,
                    ruby_align: None,
                    ruby_font_size_px: None,
                    ruby_color: None,
                })
                .collect::<Vec<_>>()
        })
    };
    let shape_options = crate::font::shaping::ShapeOptions {
        writing_mode: text_input.writing_mode.clone(),
        language: text_input.language.clone(),
        vertical_feature_priority: (writing_mode == WritingMode::VerticalRl)
            .then(|| "true".to_string()),
        text_orientation: text_input.text_orientation.clone(),
        font_variation_settings: parse_variation_settings_opt(
            text_input.font_variation_settings.as_deref(),
        ),
        font_feature_settings: parse_feature_settings_opt(
            text_input.font_feature_settings.as_deref(),
        ),
    };
    let flow_box = super::geometry::FlowBox {
        x: 0.0,
        y: 0.0,
        width,
        height,
    };
    let region_provider = ExclusionRegionProvider {
        flow_box: &flow_box,
        exclusions: &flow.exclusions,
    };
    let request = bt_flow::FlowLayoutRequest {
        text: if flow_spans.is_some() || rich_text.is_some() {
            ""
        } else {
            &text_input.content
        },
        font_size_px: text_input.font_size_px,
        line_height: text_input.line_height,
        line_height_px: text_input.line_height_px,
        letter_spacing_px: text_input.letter_spacing_px.unwrap_or(0.0),
        language,
        wrap,
        white_space,
        tab_size: text_input.tab_size.unwrap_or(4),
        hanging_punctuation: text_input.hanging_punctuation.unwrap_or(false),
        flow_bounds: bt_flow::FlowBounds {
            x: 0.0,
            y: 0.0,
            width,
            height,
        },
        min_region_width: flow.min_region_width_px,
        max_lines: text_input.max_lines,
        ellipsis: text_input.ellipsis.unwrap_or(false),
        fit: text_input.fit.as_deref(),
        spans: flow_spans.as_deref(),
        rich_text,
        writing_mode,
        text_orientation: text_input.text_orientation.as_deref(),
        min_font_size_px: text_input.min_font_size_px,
        max_font_size_px: text_input.max_font_size_px,
        fit_epsilon_px: text_input.shrink_epsilon_px.or(text_input.grow_epsilon_px),
        fit_max_iterations: text_input
            .shrink_max_iterations
            .or(text_input.grow_max_iterations),
        fit_max_probes: text_input.fit_max_probes,
        shape_options,
    };

    let mut result =
        bt_flow::layout_resolved_flow_with_regions(&request, &font_ctx, &region_provider)?;
    let decoration_request = TextLayoutRequest {
        text: &text_input.content,
        spans: text_input.spans.as_deref(),
        rich_text,
        font_size_px: text_input.font_size_px,
        line_height: text_input.line_height,
        line_height_px: text_input.line_height_px,
        letter_spacing_px: text_input.letter_spacing_px.unwrap_or(0.0),
        text_indent: text_input.text_indent,
        max_width: width,
        max_height: Some(height),
        wrap,
        white_space,
        tab_size: text_input.tab_size.unwrap_or(4),
        fit: match text_input.fit.as_deref() {
            Some("shrink") => FitMode::Shrink,
            Some("grow") => FitMode::Grow,
            _ => FitMode::None,
        },
        max_lines: text_input.max_lines,
        ellipsis: text_input.ellipsis.unwrap_or(false),
        language,
        writing_mode,
        text_orientation: TextOrientation::from_option(text_input.text_orientation.as_deref()),
        uax14_breaks: None,
        hanging_punctuation: text_input.hanging_punctuation.unwrap_or(false),
        font_variation_settings: parse_variation_settings_opt(
            text_input.font_variation_settings.as_deref(),
        ),
        font_feature_settings: parse_feature_settings_opt(
            text_input.font_feature_settings.as_deref(),
        ),
        min_font_size_px: text_input.min_font_size_px,
        shrink_epsilon_px: text_input.shrink_epsilon_px,
        shrink_max_iterations: text_input.shrink_max_iterations,
        max_font_size_px: text_input.max_font_size_px,
        grow_epsilon_px: text_input.grow_epsilon_px,
        grow_max_iterations: text_input.grow_max_iterations,
        fit_max_probes: text_input.fit_max_probes,
    };
    crate::text::decoration::resolve_text_decorations(&decoration_request, &font_ctx, &mut result);
    Ok(result)
}
