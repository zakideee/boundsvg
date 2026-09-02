//! Public logical-region provider invariants.

#![cfg(test)]

use std::cell::RefCell;

use boundtext::font::shaping::ShapeOptions;
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::flow::{
    FlowBounds, FlowLayoutRequest, FlowRegion, RETURNED_REGIONS_MAX, RegionProvider, RegionQuery,
    layout_flow_with_regions, measure_flow,
};
use boundtext::text::paragraph::shape_paragraph_with_options;
use boundtext::text::types::{Language, WhiteSpaceMode, WrapMode, WritingMode};
use boundtext::text::types::{MAX_RICH_TEXT_DEPTH, RichTextNodeInput, RichTextStyleInput};
use boundtext::{RegionProviderError, TextLayoutError};

fn font_registry() -> FontRegistry {
    let mut registry = FontRegistry::new();
    registry
        .register(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
            ))
            .expect("fixture font"),
            "Noto".to_string(),
            400,
            FontStyle::Normal,
        )
        .expect("register fixture font");
    registry
}

fn request<'a>(writing_mode: WritingMode) -> FlowLayoutRequest<'a> {
    FlowLayoutRequest {
        text: "あいう",
        font_size_px: 16.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        language: Language::Ja,
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        hanging_punctuation: false,
        flow_bounds: FlowBounds {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 120.0,
        },
        min_region_width: None,
        max_lines: Some(1),
        ellipsis: false,
        fit: None,
        spans: None,
        rich_text: None,
        writing_mode,
        text_orientation: None,
        min_font_size_px: None,
        max_font_size_px: None,
        fit_epsilon_px: None,
        fit_max_iterations: None,
        fit_max_probes: None,
        shape_options: ShapeOptions::default(),
    }
}

fn nested_decorated_resource_input(depth: usize) -> Vec<RichTextNodeInput> {
    let style = RichTextStyleInput {
        font_family: vec!["Noto".to_string()],
        font_weight: 400,
        font_style: FontStyle::Normal,
        font_size_px: 16.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: Some(0.0),
        language: Some("ja".to_string()),
        color: None,
        text_strokes: None,
        text_shadows: None,
        font_variation_settings: None,
        font_feature_settings: None,
        text_orientation: None,
        text_decoration: None,
    };
    let mut node = RichTextNodeInput::Text {
        text: "境界".to_string(),
    };
    for index in 0..depth {
        node = RichTextNodeInput::DecoratedSpan {
            style: style.clone(),
            children: vec![node],
            padding_inline: None,
            background: None,
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: Some(format!("depth-{index}")),
        };
    }
    vec![node]
}

struct RecordingProvider {
    queries: RefCell<Vec<RegionQuery>>,
}

impl RegionProvider for RecordingProvider {
    fn regions(&self, query: RegionQuery) -> Result<Vec<FlowRegion>, RegionProviderError> {
        self.queries.borrow_mut().push(query);
        let region = match query.writing_mode {
            WritingMode::HorizontalTb => FlowRegion {
                inline_start_px: 10.0,
                inline_size_px: 100.0,
            },
            WritingMode::VerticalRl => FlowRegion {
                inline_start_px: 20.0,
                inline_size_px: 120.0,
            },
        };
        Ok(vec![region])
    }
}

#[test]
fn provider_queries_use_logical_block_offsets_in_both_writing_modes() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
        let provider = RecordingProvider {
            queries: RefCell::new(Vec::new()),
        };
        layout_flow_with_regions(&request(writing_mode), &font_context, &provider)
            .expect("logical region layout");
        let queries = provider.queries.borrow();
        let first = queries.first().expect("at least one region query");
        assert_eq!(first.writing_mode, writing_mode);
        assert_eq!(first.cross_start_px, 0.0);
        assert!(first.cross_end_px > first.cross_start_px);
        assert!(first.min_inline_size_px > 0.0);
    }
}

struct OverlappingProvider;

impl RegionProvider for OverlappingProvider {
    fn regions(&self, _query: RegionQuery) -> Result<Vec<FlowRegion>, RegionProviderError> {
        Ok(vec![
            FlowRegion {
                inline_start_px: 10.0,
                inline_size_px: 80.0,
            },
            FlowRegion {
                inline_start_px: 70.0,
                inline_size_px: 40.0,
            },
        ])
    }
}

#[test]
fn overlapping_provider_output_is_a_typed_fatal_error() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let error = layout_flow_with_regions(
        &request(WritingMode::HorizontalTb),
        &font_context,
        &OverlappingProvider,
    )
    .expect_err("overlapping regions must not produce a partial layout");

    assert!(matches!(
        error,
        TextLayoutError::InvalidFlowRegion { index: 1, .. }
    ));
}

struct FailingProvider;

impl RegionProvider for FailingProvider {
    fn regions(&self, _query: RegionQuery) -> Result<Vec<FlowRegion>, RegionProviderError> {
        Err(RegionProviderError::Unavailable)
    }
}

#[test]
fn provider_failure_aborts_without_becoming_an_empty_region() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let error = layout_flow_with_regions(
        &request(WritingMode::HorizontalTb),
        &font_context,
        &FailingProvider,
    )
    .expect_err("provider failure must abort the complete layout");

    assert_eq!(
        error,
        TextLayoutError::RegionProviderFailure {
            reason: RegionProviderError::Unavailable,
        }
    );
}

struct ExcessiveIntervalProvider;

impl RegionProvider for ExcessiveIntervalProvider {
    fn regions(&self, _query: RegionQuery) -> Result<Vec<FlowRegion>, RegionProviderError> {
        Ok(vec![
            FlowRegion {
                inline_start_px: 10.0,
                inline_size_px: 0.0,
            };
            RETURNED_REGIONS_MAX + 1
        ])
    }
}

#[test]
fn measurement_enforces_the_returned_interval_budget() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let paragraph = shape_paragraph_with_options(
        "あ",
        &font_context,
        Language::Ja,
        WrapMode::Char,
        false,
        &ShapeOptions::default(),
        None,
        0.0,
        true,
    )
    .expect("shaped paragraph");

    let error = measure_flow(
        &paragraph,
        16.0,
        19.2,
        &request(WritingMode::HorizontalTb).flow_bounds,
        &ExcessiveIntervalProvider,
        0.0,
        Some(1),
        WrapMode::Char,
    )
    .expect_err("measurement must enforce the provider interval budget");

    assert_eq!(
        error,
        TextLayoutError::RegionIntervalLimit {
            required: RETURNED_REGIONS_MAX + 1,
            limit: RETURNED_REGIONS_MAX,
        }
    );
}

#[test]
fn rich_resource_failure_precedes_every_region_query() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let rich_text = nested_decorated_resource_input(MAX_RICH_TEXT_DEPTH + 1);
    let provider = RecordingProvider {
        queries: RefCell::new(Vec::new()),
    };
    let mut flow_request = request(WritingMode::VerticalRl);
    flow_request.text = "";
    flow_request.rich_text = Some(&rich_text);

    let error = layout_flow_with_regions(&flow_request, &font_context, &provider)
        .expect_err("over-depth rich input must abort before geometry");
    assert_eq!(
        error,
        TextLayoutError::RichTextDepthLimit {
            actual: MAX_RICH_TEXT_DEPTH + 1,
            limit: MAX_RICH_TEXT_DEPTH,
        }
    );
    assert!(provider.queries.borrow().is_empty());
}
