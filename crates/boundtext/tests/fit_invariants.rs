//! Public fit-search invariants for content whose layout predicate is not
//! certified monotone.

#![cfg(test)]

use boundtext::TextLayoutError;
use boundtext::font::shaping::ShapeOptions;
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::engine::layout_text;
use boundtext::text::flow::{
    FitSearchKind, FlowBounds, FlowLayoutRequest, FlowRegion, RegionProvider, RegionQuery,
    layout_flow_with_regions,
};
use boundtext::text::types::{
    FitMode, InlineRectInput, Language, RichTextNodeInput, RichTextStyleInput, TextLayoutRequest,
    TextOrientation, WhiteSpaceMode, WrapMode, WritingMode,
};

/// Authored font size used by the adversarial fit fixture.
const INITIAL_SIZE_PX: f64 = 60.0;
/// Lower endpoint of the exact shrink grid.
const MIN_SIZE_PX: f64 = 8.0;
/// Public exact-grid step exercised by the fixture.
const FIT_STEP_PX: f64 = 0.25;
/// Inclusive shrink-grid candidate count for the fixture bounds.
const REQUIRED_PROBES: usize = 209;
/// Inclusive grow-grid candidate count for the fixture bounds.
const GROW_REQUIRED_PROBES: usize = 129;

struct RectRegions {
    width: f64,
    height: f64,
}

impl RegionProvider for RectRegions {
    fn regions(&self, query: RegionQuery) -> Result<Vec<FlowRegion>, boundtext::BoundtextError> {
        if query.cross_start_px >= 0.0
            && query.cross_end_px <= self.height
            && self.width >= query.min_inline_size_px
        {
            Ok(vec![FlowRegion {
                inline_start_px: 0.0,
                inline_size_px: self.width,
            }])
        } else {
            Ok(Vec::new())
        }
    }

    fn fit_search_kind(&self) -> FitSearchKind {
        FitSearchKind::CertifiedMonotone
    }
}

fn font_registry() -> FontRegistry {
    let mut registry = FontRegistry::new();
    registry
        .register(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
            ))
            .expect("fixture font"),
            "FitProbe".to_string(),
            400,
            FontStyle::Normal,
        )
        .expect("register fixture font");
    registry
}

fn span_style(font_size_px: f64, letter_spacing_px: f64) -> RichTextStyleInput {
    RichTextStyleInput {
        font_family: vec!["FitProbe".to_string()],
        font_weight: 400,
        font_style: FontStyle::Normal,
        font_size_px,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: Some(letter_spacing_px),
        language: Some("en".to_string()),
        color: None,
        text_strokes: None,
        text_shadows: None,
        font_variation_settings: None,
        font_feature_settings: None,
        text_orientation: None,
        text_decoration: None,
    }
}

fn adversarial_nodes(font_size_px: f64) -> Vec<RichTextNodeInput> {
    let scale = font_size_px / 40.0;
    vec![
        RichTextNodeInput::Span {
            text: "i".to_string(),
            style: span_style(font_size_px, -60.0 * scale),
        },
        RichTextNodeInput::InlineRect {
            rect: InlineRectInput {
                fragment_id: "atomic".to_string(),
                inline_size_px: 50.0,
                block_size_px: None,
                advance_px: Some(50.0),
                block_align: None,
                color: "#000000".to_string(),
                border_radius_px: None,
                opacity: None,
                paint_order: None,
            },
        },
    ]
}

fn request(nodes: &[RichTextNodeInput]) -> TextLayoutRequest<'_> {
    TextLayoutRequest {
        text: "",
        spans: None,
        rich_text: Some(nodes),
        font_size_px: INITIAL_SIZE_PX,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 35.0,
        max_height: Some(50.0),
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::Shrink,
        max_lines: Some(1),
        ellipsis: false,
        language: Language::En,
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: TextOrientation::Mixed,
        uax14_breaks: None,
        hanging_punctuation: false,
        font_variation_settings: Vec::new(),
        font_feature_settings: Vec::new(),
        min_font_size_px: Some(MIN_SIZE_PX),
        shrink_epsilon_px: Some(FIT_STEP_PX),
        shrink_max_iterations: Some(12),
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
        fit_max_probes: Some(REQUIRED_PROBES),
    }
}

fn flow_request(nodes: &[RichTextNodeInput]) -> FlowLayoutRequest<'_> {
    FlowLayoutRequest {
        text: "",
        font_size_px: INITIAL_SIZE_PX,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        language: Language::En,
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        hanging_punctuation: false,
        flow_bounds: FlowBounds {
            x: 0.0,
            y: 0.0,
            width: 35.0,
            height: 50.0,
        },
        min_region_width: Some(1.0),
        max_lines: Some(1),
        ellipsis: false,
        fit: Some("shrink"),
        spans: None,
        rich_text: Some(nodes),
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: None,
        min_font_size_px: Some(MIN_SIZE_PX),
        max_font_size_px: None,
        fit_epsilon_px: Some(FIT_STEP_PX),
        fit_max_iterations: Some(12),
        fit_max_probes: Some(REQUIRED_PROBES),
        shape_options: ShapeOptions::default(),
    }
}

fn exhaustive_largest_fitting_size(font_context: &FontContext<'_>) -> f64 {
    let mut largest = None;
    for probe_index in 0..REQUIRED_PROBES {
        let font_size_px = MIN_SIZE_PX + probe_index as f64 * FIT_STEP_PX;
        let nodes = adversarial_nodes(font_size_px);
        let mut candidate_request = request(&nodes);
        candidate_request.font_size_px = font_size_px;
        candidate_request.fit = FitMode::None;
        let layout_result =
            layout_text(&candidate_request, font_context).expect("exact candidate layout");
        let is_fit = layout_result.overflow.overflow_type == "none"
            && layout_result.lines.len() <= 1
            && layout_result.bbox.w <= candidate_request.max_width + 0.001
            && layout_result.bbox.h
                <= candidate_request
                    .max_height
                    .expect("the fixture defines a height constraint")
                    + 0.001;
        if is_fit {
            largest = Some(font_size_px);
        }
    }
    largest.expect("at least the minimum grid size fits")
}

#[test]
fn negative_tracking_fit_selects_the_largest_exact_grid_candidate() {
    let registry = font_registry();
    let families = vec!["FitProbe".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let nodes = adversarial_nodes(INITIAL_SIZE_PX);
    let selected = layout_text(&request(&nodes), &font_context).expect("exact-grid fit layout");
    let exhaustive = exhaustive_largest_fitting_size(&font_context);

    assert_eq!(exhaustive, 41.5);
    assert_eq!(selected.chosen_font_size_px, exhaustive);
    assert_eq!(selected.overflow.overflow_type, "none");
}

#[test]
fn negative_tracking_fit_rejects_an_insufficient_grid_budget_before_layout() {
    let registry = font_registry();
    let families = vec!["FitProbe".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let nodes = adversarial_nodes(INITIAL_SIZE_PX);
    let mut bounded_request = request(&nodes);
    bounded_request.fit_max_probes = Some(REQUIRED_PROBES - 1);

    assert_eq!(
        layout_text(&bounded_request, &font_context)
            .expect_err("the complete exact grid must be preflighted"),
        TextLayoutError::FitProbeLimit {
            required: REQUIRED_PROBES,
            limit: REQUIRED_PROBES - 1,
        }
    );
}

#[test]
fn negative_tracking_forces_exact_grid_even_with_a_certified_flow_provider() {
    let registry = font_registry();
    let families = vec!["FitProbe".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let regions = RectRegions {
        width: 35.0,
        height: 50.0,
    };
    let nodes = adversarial_nodes(INITIAL_SIZE_PX);

    let layout_result = layout_flow_with_regions(&flow_request(&nodes), &font_context, &regions)
        .expect("content-aware exact-grid flow fit");

    assert_eq!(layout_result.chosen_font_size_px, Some(41.5));
    assert!(layout_result.exhausted);
    assert_eq!(layout_result.overflow_reason, None);
}

#[test]
fn grow_requires_the_authored_size_to_fit_before_considering_a_larger_island() {
    let registry = font_registry();
    let families = vec!["FitProbe".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let initial_nodes = adversarial_nodes(MIN_SIZE_PX);
    let mut grow_request = request(&initial_nodes);
    grow_request.font_size_px = MIN_SIZE_PX;
    grow_request.fit = FitMode::Grow;
    grow_request.max_font_size_px = Some(40.0);
    grow_request.grow_epsilon_px = Some(FIT_STEP_PX);
    grow_request.grow_max_iterations = Some(12);
    grow_request.fit_max_probes = Some(GROW_REQUIRED_PROBES);

    let layout_result = layout_text(&grow_request, &font_context).expect("ineligible grow layout");

    let larger_nodes = adversarial_nodes(40.0);
    let mut larger_request = request(&larger_nodes);
    larger_request.font_size_px = 40.0;
    larger_request.fit = FitMode::None;
    let larger = layout_text(&larger_request, &font_context).expect("larger fit island");
    assert_eq!(larger.overflow.overflow_type, "none");
    assert_eq!(layout_result.chosen_font_size_px, MIN_SIZE_PX);
    assert_eq!(layout_result.overflow.overflow_type, "overflow");
    assert_eq!(
        layout_result.overflow.reason.as_deref(),
        Some("initial font size does not fit; cannot grow")
    );
}

#[test]
fn kinsoku_diagnostic_does_not_mask_fit_constraint_failures() {
    let registry = font_registry();
    let families = vec!["FitProbe".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
        for fit in [FitMode::Shrink, FitMode::Grow] {
            for source_length in [12, 14] {
                let source = "。".repeat(source_length);
                let request = TextLayoutRequest {
                    text: &source,
                    spans: None,
                    rich_text: None,
                    font_size_px: 20.0,
                    line_height: Some(1.2),
                    line_height_px: None,
                    letter_spacing_px: 0.0,
                    text_indent: None,
                    max_width: if writing_mode == WritingMode::HorizontalTb {
                        40.0
                    } else {
                        300.0
                    },
                    max_height: Some(if writing_mode == WritingMode::HorizontalTb {
                        300.0
                    } else {
                        40.0
                    }),
                    wrap: WrapMode::Char,
                    white_space: WhiteSpaceMode::Normal,
                    tab_size: 4,
                    fit,
                    max_lines: Some(6),
                    ellipsis: false,
                    language: Language::Ja,
                    writing_mode,
                    text_orientation: TextOrientation::Mixed,
                    uax14_breaks: None,
                    hanging_punctuation: false,
                    font_variation_settings: Vec::new(),
                    font_feature_settings: Vec::new(),
                    min_font_size_px: Some(20.0),
                    shrink_epsilon_px: Some(0.25),
                    shrink_max_iterations: Some(1),
                    max_font_size_px: Some(24.0),
                    grow_epsilon_px: Some(0.25),
                    grow_max_iterations: Some(1),
                    fit_max_probes: None,
                };

                let layout_result =
                    layout_text(&request, &font_context).expect("kinsoku fit result");
                let expected_overflow = if source_length == 12 {
                    "kinsoku_unresolved"
                } else if fit == FitMode::Shrink {
                    "cannot_fit"
                } else {
                    "overflow"
                };
                assert_eq!(
                    layout_result.overflow.overflow_type, expected_overflow,
                    "{writing_mode:?} {fit:?} source_length={source_length}"
                );
            }
        }
    }
}
