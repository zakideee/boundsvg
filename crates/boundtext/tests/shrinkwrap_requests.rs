//! Shrinkwrap applicability, language, and source-route contracts.

use std::cell::Cell;

use boundtext::font::shaping::ShapeOptions;
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::flow::{FlowBounds, FlowRegion, FlowTextSpan, RegionQuery};
use boundtext::text::paragraph::shape_paragraph_with_options;
use boundtext::text::shrinkwrap::{
    ShrinkwrapConfig, ShrinkwrapRegionProvider, ShrinkwrapStatus, TextShrinkwrapRequest,
    shrinkwrap_text,
};
use boundtext::text::types::{Language, WhiteSpaceMode, WrapMode, WritingMode};

struct CandidateRegions {
    queries: Cell<usize>,
}

impl ShrinkwrapRegionProvider for CandidateRegions {
    fn regions(
        &self,
        bounds: FlowBounds,
        query: RegionQuery,
    ) -> Result<Vec<FlowRegion>, boundtext::RegionProviderError> {
        self.queries.set(self.queries.get() + 1);
        let (inline_start_px, inline_size_px) = match query.writing_mode {
            WritingMode::HorizontalTb => (bounds.x, bounds.width),
            WritingMode::VerticalRl => (bounds.y, bounds.height),
        };
        Ok(if inline_size_px >= query.min_inline_size_px {
            vec![FlowRegion {
                inline_start_px,
                inline_size_px,
            }]
        } else {
            Vec::new()
        })
    }
}

fn registry() -> Result<FontRegistry, Box<dyn std::error::Error>> {
    let mut registry = FontRegistry::new();
    registry.register(
        std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))?,
        "NotoSansJP".into(),
        400,
        FontStyle::Normal,
    )?;
    Ok(registry)
}

fn request(text: &str) -> TextShrinkwrapRequest<'_> {
    TextShrinkwrapRequest {
        text,
        spans: None,
        rich_text: None,
        font_size_px: 20.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        language: Language::Auto,
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        hanging_punctuation: false,
        writing_mode: WritingMode::HorizontalTb,
        shape_options: ShapeOptions::default(),
        max_width: 180.0,
        max_height: None,
        min_width: None,
        min_height: None,
        target_line_count: None,
        config: ShrinkwrapConfig::default(),
    }
}

#[test]
fn paragraph_non_applicability_uses_full_layout_without_a_geometry_probe()
-> Result<(), Box<dyn std::error::Error>> {
    let registry = registry()?;
    let families = ["NotoSansJP".into()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let regions = CandidateRegions {
        queries: Cell::new(0),
    };
    for text in ["Hello 🎉", "Hello 龘"] {
        assert!(
            shape_paragraph_with_options(
                text,
                &font_context,
                Language::Auto,
                WrapMode::Char,
                false,
                &ShapeOptions::default(),
                None,
                0.0,
                false
            )
            .is_none()
        );
        let layout_result = shrinkwrap_text(&request(text), &font_context, &regions)
            .expect("fallback owner layout");
        assert_eq!(layout_result.status, ShrinkwrapStatus::Satisfied);
        assert_eq!(layout_result.chosen_width_px, Some(73.75));
        assert_eq!(layout_result.line_count, 1);
        assert_eq!(layout_result.used_height, 24.0);
        assert_eq!(layout_result.max_line_width, Some(73.600_000_000_000_01));
        assert!(layout_result.chosen_height_px.is_none());
        assert!(layout_result.used_width.is_none());
    }
    assert_eq!(regions.queries.get(), 0);
    Ok(())
}

#[test]
fn explicit_language_tag_changes_only_the_applicable_paragraph_shaping()
-> Result<(), Box<dyn std::error::Error>> {
    let registry = registry()?;
    let families = ["NotoSansJP".into()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let regions = CandidateRegions {
        queries: Cell::new(0),
    };
    for (language, expected_lines, expected_advance) in [
        (Language::Auto, 1, 31.28),
        (Language::En, 1, 31.28),
        (Language::Ja, 2, 21.66),
    ] {
        let text_request = TextShrinkwrapRequest {
            language,
            max_width: 32.8,
            line_height: Some(1.5),
            ..request("A\"A")
        };
        assert!(
            shape_paragraph_with_options(
                text_request.text,
                &font_context,
                language,
                WrapMode::Char,
                false,
                &ShapeOptions::default(),
                None,
                0.0,
                false
            )
            .is_some()
        );
        let layout_result =
            shrinkwrap_text(&text_request, &font_context, &regions).expect("applicable paragraph");
        assert_eq!(layout_result.line_count, expected_lines);
        assert_eq!(layout_result.max_line_width, Some(expected_advance));
    }
    assert_eq!(regions.queries.get(), 0);
    Ok(())
}

/// Preserve the source/orientation matrix and its exact search expectations.
const SOURCE_ROUTE_CASES: [(bool, WhiteSpaceMode, WritingMode, f64, usize, f64); 6] = [
    (
        false,
        WhiteSpaceMode::Normal,
        WritingMode::HorizontalTb,
        132.03125,
        2,
        60.0,
    ),
    (
        false,
        WhiteSpaceMode::Normal,
        WritingMode::VerticalRl,
        132.1875,
        2,
        132.08,
    ),
    (
        true,
        WhiteSpaceMode::Normal,
        WritingMode::HorizontalTb,
        152.03125,
        2,
        60.0,
    ),
    (
        true,
        WhiteSpaceMode::Normal,
        WritingMode::VerticalRl,
        152.1875,
        2,
        152.080_000_000_000_04,
    ),
    (
        true,
        WhiteSpaceMode::PreWrap,
        WritingMode::HorizontalTb,
        107.5,
        3,
        90.0,
    ),
    (
        true,
        WhiteSpaceMode::PreWrap,
        WritingMode::VerticalRl,
        107.65625,
        3,
        107.600_000_000_000_02,
    ),
];

#[test]
fn source_and_orientation_routes_retain_their_search_results()
-> Result<(), Box<dyn std::error::Error>> {
    let registry = registry()?;
    let families = ["NotoSansJP".into()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let text = "A\t B\r\nあいうえお Hello world";
    let spans = [FlowTextSpan::plain(text.into())];
    for (has_spans, white_space, writing_mode, chosen_size, line_count, used_height) in
        SOURCE_ROUTE_CASES
    {
        let regions = CandidateRegions {
            queries: Cell::new(0),
        };
        let text_request = TextShrinkwrapRequest {
            spans: has_spans.then_some(spans.as_slice()),
            white_space,
            writing_mode,
            line_height: Some(1.5),
            max_height: Some(180.0),
            shape_options: ShapeOptions {
                writing_mode: Some(
                    if writing_mode == WritingMode::VerticalRl {
                        "vertical-rl"
                    } else {
                        "horizontal-tb"
                    }
                    .into(),
                ),
                vertical_feature_priority: (writing_mode == WritingMode::VerticalRl)
                    .then(|| "true".into()),
                ..ShapeOptions::default()
            },
            ..request(if has_spans { "" } else { text })
        };
        let layout_result = shrinkwrap_text(&text_request, &font_context, &regions)
            .expect("source-specific shrinkwrap");
        assert_eq!(layout_result.status, ShrinkwrapStatus::Satisfied);
        assert_eq!(
            layout_result
                .chosen_width_px
                .or(layout_result.chosen_height_px),
            Some(chosen_size)
        );
        assert_eq!(layout_result.line_count, line_count);
        assert_eq!(layout_result.used_height, used_height);
        assert_eq!(
            regions.queries.get() > 0,
            has_spans && white_space == WhiteSpaceMode::Normal
        );
        assert_eq!(
            layout_result.chosen_width_px.is_some(),
            writing_mode == WritingMode::HorizontalTb
        );
        assert_eq!(
            layout_result.used_width.is_some(),
            writing_mode == WritingMode::VerticalRl
        );
    }
    Ok(())
}
