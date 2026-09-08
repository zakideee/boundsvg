//! Shrinkwrap DTO mapping with geometry-only candidate providers.

use super::conversions::{
    ExclusionRegionProvider, convert_flow_result, convert_flow_span, convert_shrinkwrap_status,
};
use super::geometry::{FlowBox, FlowExclusionShape};
use super::types::{
    ShrinkwrapFlowInput, ShrinkwrapFlowResultDto, ShrinkwrapTextInput, ShrinkwrapTextResult,
};
use crate::font::shaping::ShapeOptions;
use crate::font::{FontContext, FontRegistry, FontStyle};
use crate::layout::types::{parse_feature_settings_opt, parse_variation_settings_opt};
use crate::text::flow as bt_flow;
use crate::text::shrinkwrap::{
    self, FlowShrinkwrapRequest, ShrinkwrapConfig, ShrinkwrapRegionProvider, TextShrinkwrapRequest,
};
use crate::text::types::{Language, WhiteSpaceMode, WrapMode, WritingMode};

struct CandidateExclusionRegions<'a> {
    exclusions: &'a [FlowExclusionShape],
}

impl ShrinkwrapRegionProvider for CandidateExclusionRegions<'_> {
    fn regions(
        &self,
        bounds: bt_flow::FlowBounds,
        query: bt_flow::RegionQuery,
    ) -> Result<Vec<bt_flow::FlowRegion>, boundtext::RegionProviderError> {
        let flow_box = FlowBox {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        };
        let regions = ExclusionRegionProvider {
            flow_box: &flow_box,
            exclusions: self.exclusions,
        };
        bt_flow::RegionProvider::regions(&regions, query)
    }
}

pub(crate) fn shrinkwrap_text(
    input: &ShrinkwrapTextInput,
    registry: &FontRegistry,
) -> Result<ShrinkwrapTextResult, boundtext::TextLayoutError> {
    let font_families = super::build_font_families(&input.font_family, input.fallback.as_deref());
    let font_style = match input.font_style.as_deref() {
        Some("italic") => FontStyle::Italic,
        _ => FontStyle::Normal,
    };
    let font_context = FontContext {
        registry,
        fallback_registry: None,
        families: &font_families,
        weight: input.font_weight.unwrap_or(400),
        style: &font_style,
    };
    let writing_mode = WritingMode::from_option(input.writing_mode.as_deref());
    let spans = input
        .spans
        .as_ref()
        .map(|spans| spans.iter().map(convert_flow_span).collect::<Vec<_>>());
    let request = TextShrinkwrapRequest {
        text: &input.text,
        spans: spans.as_deref(),
        rich_text: input.rich_text.as_deref(),
        font_size_px: input.font_size_px,
        line_height: input.line_height,
        line_height_px: input.line_height_px,
        letter_spacing_px: input.letter_spacing_px.unwrap_or(0.0),
        language: Language::from_option(input.language.as_deref()),
        wrap: input
            .wrap
            .as_deref()
            .map_or(WrapMode::Char, WrapMode::parse_str),
        white_space: WhiteSpaceMode::from_option(input.white_space.as_deref()),
        tab_size: input.tab_size.unwrap_or(4),
        hanging_punctuation: input.hanging_punctuation.unwrap_or(false),
        writing_mode,
        shape_options: ShapeOptions {
            writing_mode: input.writing_mode.clone(),
            language: input.language.clone(),
            vertical_feature_priority: (writing_mode == WritingMode::VerticalRl)
                .then(|| "true".into()),
            text_orientation: input.text_orientation.clone(),
            font_variation_settings: parse_variation_settings_opt(
                input.font_variation_settings.as_deref(),
            ),
            font_feature_settings: parse_feature_settings_opt(
                input.font_feature_settings.as_deref(),
            ),
        },
        max_width: input.max_width,
        max_height: input.max_height,
        min_width: input.min_width,
        min_height: input.min_height,
        target_line_count: input.target_line_count,
        config: ShrinkwrapConfig {
            epsilon_px: input.epsilon_px.unwrap_or(0.25),
            max_iterations: input.max_iterations.unwrap_or(12),
        },
    };
    let layout_result = shrinkwrap::shrinkwrap_text(
        &request,
        &font_context,
        &CandidateExclusionRegions { exclusions: &[] },
    )?;
    Ok(ShrinkwrapTextResult {
        status: convert_shrinkwrap_status(layout_result.status),
        chosen_width_px: layout_result.chosen_width_px,
        chosen_height_px: layout_result.chosen_height_px,
        line_count: layout_result.line_count,
        used_width: layout_result.used_width,
        used_height: layout_result.used_height,
        max_line_width: layout_result.max_line_width,
    })
}

pub(crate) fn shrinkwrap_flow(
    input: &ShrinkwrapFlowInput,
    registry: &FontRegistry,
) -> Result<ShrinkwrapFlowResultDto, boundtext::TextLayoutError> {
    let font_families = super::build_font_families(&input.font_family, input.fallback.as_deref());
    let font_style = match input.font_style.as_deref() {
        Some("italic") => FontStyle::Italic,
        _ => FontStyle::Normal,
    };
    let font_context = FontContext {
        registry,
        fallback_registry: None,
        families: &font_families,
        weight: input.font_weight.unwrap_or(400),
        style: &font_style,
    };
    let writing_mode = WritingMode::from_option(input.writing_mode.as_deref());
    let spans = input
        .spans
        .as_ref()
        .map(|spans| spans.iter().map(convert_flow_span).collect::<Vec<_>>());
    let request = FlowShrinkwrapRequest {
        text: &input.text,
        spans: spans.as_deref(),
        rich_text: input.rich_text.as_deref(),
        font_size_px: input.font_size_px,
        line_height: input.line_height,
        line_height_px: input.line_height_px,
        letter_spacing_px: input.letter_spacing_px.unwrap_or(0.0),
        language: Language::from_option(input.language.as_deref()),
        wrap: input
            .wrap
            .as_deref()
            .map_or(WrapMode::Char, WrapMode::parse_str),
        hanging_punctuation: input.hanging_punctuation.unwrap_or(false),
        writing_mode,
        shape_options: ShapeOptions {
            writing_mode: input.writing_mode.clone(),
            language: input.language.clone(),
            vertical_feature_priority: (writing_mode == WritingMode::VerticalRl)
                .then(|| "true".into()),
            text_orientation: input.text_orientation.clone(),
            font_variation_settings: parse_variation_settings_opt(
                input.font_variation_settings.as_deref(),
            ),
            font_feature_settings: parse_feature_settings_opt(
                input.font_feature_settings.as_deref(),
            ),
        },
        flow_bounds: bt_flow::FlowBounds {
            x: input.flow_box.x,
            y: input.flow_box.y,
            width: input.flow_box.width,
            height: input.flow_box.height,
        },
        min_region_width: input.min_region_width_px,
        max_lines: input.max_lines,
        min_width: input.min_width,
        min_height: input.min_height,
        target_line_count: input.target_line_count,
        config: ShrinkwrapConfig {
            epsilon_px: input.shrinkwrap_epsilon_px.unwrap_or(0.25),
            max_iterations: input.shrinkwrap_max_iterations.unwrap_or(12),
        },
    };
    let layout_result = shrinkwrap::shrinkwrap_flow(
        &request,
        &font_context,
        &CandidateExclusionRegions {
            exclusions: &input.exclusions,
        },
    )?;
    Ok(ShrinkwrapFlowResultDto {
        status: convert_shrinkwrap_status(layout_result.status),
        chosen_width_px: layout_result.chosen_width_px,
        chosen_height_px: layout_result.chosen_height_px,
        used_line_count: layout_result.used_line_count,
        used_height: layout_result.used_height,
        layout: convert_flow_result(layout_result.layout),
    })
}
