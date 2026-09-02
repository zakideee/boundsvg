//! Checked text layout must reject a non-empty run when a custom shaper
//! produces no glyphs.

use std::sync::Arc;

use boundtext::font::backend::{
    RawShapedGlyph, ShapeDirection, ShapeFeature, ShapeVariation, Shaper, ShaperFace,
};
use boundtext::font::backend_ttfparser::TtfParserBackend;
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::engine::layout_text;
use boundtext::text::fit::fit_shrink;
use boundtext::text::inline_runs::prepare_inline_runs;
use boundtext::text::rich::layout_rich_text;
use boundtext::text::types::{
    FitMode, Language, RichTextNodeInput, RichTextStyleInput, TextLayoutRequest, TextOrientation,
    TextSpanInput, WhiteSpaceMode, WrapMode, WritingMode,
};
use boundtext::{TextLayoutError, TextPreparationPhase};

struct EmptyShaper;

struct EmptyShaperFace;

impl Shaper for EmptyShaper {
    fn create_face(&self, _data: Arc<Vec<u8>>) -> Option<Box<dyn ShaperFace>> {
        Some(Box::new(EmptyShaperFace))
    }
}

impl ShaperFace for EmptyShaperFace {
    fn shape(
        &self,
        _text: &str,
        _direction: ShapeDirection,
        _language: Option<&str>,
        _features: &[ShapeFeature],
        _variations: &[ShapeVariation],
    ) -> Vec<RawShapedGlyph> {
        Vec::new()
    }
}

fn empty_shaper_registry() -> Result<FontRegistry, Box<dyn std::error::Error>> {
    let mut registry =
        FontRegistry::with_backend(Arc::new(TtfParserBackend), Arc::new(EmptyShaper));
    registry.register(
        std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))?,
        "EmptyShaper".to_string(),
        400,
        FontStyle::Normal,
    )?;
    Ok(registry)
}

fn request<'a>(
    text: &'a str,
    spans: Option<&'a [TextSpanInput]>,
    rich_text: Option<&'a [RichTextNodeInput]>,
    fit: FitMode,
    writing_mode: WritingMode,
) -> TextLayoutRequest<'a> {
    TextLayoutRequest {
        text,
        spans,
        rich_text,
        font_size_px: 16.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 100.0,
        max_height: Some(100.0),
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit,
        max_lines: None,
        ellipsis: false,
        language: Language::En,
        writing_mode,
        text_orientation: TextOrientation::Mixed,
        uax14_breaks: None,
        hanging_punctuation: false,
        font_variation_settings: Vec::new(),
        font_feature_settings: Vec::new(),
        min_font_size_px: Some(8.0),
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
        fit_max_probes: None,
    }
}

fn span(text: &str) -> TextSpanInput {
    TextSpanInput {
        text: text.to_string(),
        font_family: vec!["EmptyShaper".to_string()],
        font_weight: 400,
        font_style: FontStyle::Normal,
        font_size_px: 16.0,
        letter_spacing_px: Some(0.0),
        language: Some("en".to_string()),
        text_orientation: None,
        color: None,
        text_strokes: None,
        text_shadows: None,
        font_variation_settings: None,
        font_feature_settings: None,
        text_decoration: None,
        decoration_transport_only: false,
    }
}

fn rich_style() -> RichTextStyleInput {
    RichTextStyleInput {
        font_family: vec!["EmptyShaper".to_string()],
        font_weight: 400,
        font_style: FontStyle::Normal,
        font_size_px: 16.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: Some(0.0),
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

fn expect_phase<T>(result: Result<T, TextLayoutError>, phase: TextPreparationPhase) {
    assert_eq!(
        result.err(),
        Some(TextLayoutError::PreparationFailed { phase })
    );
}

#[test]
fn plain_vertical_and_fit_reject_empty_single_family_shaping()
-> Result<(), Box<dyn std::error::Error>> {
    let registry = empty_shaper_registry()?;
    let families = vec!["EmptyShaper".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };

    expect_phase(
        layout_text(
            &request("A", None, None, FitMode::None, WritingMode::HorizontalTb),
            &font_context,
        ),
        TextPreparationPhase::PlainShaping,
    );
    expect_phase(
        layout_text(
            &request("A", None, None, FitMode::None, WritingMode::VerticalRl),
            &font_context,
        ),
        TextPreparationPhase::VerticalLayout,
    );
    let fit_request = request("A", None, None, FitMode::Shrink, WritingMode::HorizontalTb);
    expect_phase(
        fit_shrink(&fit_request, &font_context, Some(8.0), None, None),
        TextPreparationPhase::PlainShaping,
    );
    Ok(())
}

#[test]
fn span_rich_and_ruby_reject_empty_single_family_shaping() -> Result<(), Box<dyn std::error::Error>>
{
    let registry = empty_shaper_registry()?;
    let families = vec!["EmptyShaper".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };

    let spans = vec![span("A")];
    expect_phase(
        prepare_inline_runs(
            &spans,
            &font_context,
            0.0,
            Language::En,
            false,
            &[None],
            false,
        ),
        TextPreparationPhase::SpanShaping,
    );

    let rich_text = vec![RichTextNodeInput::Span {
        text: "A".to_string(),
        style: rich_style(),
    }];
    expect_phase(
        layout_rich_text(
            &request(
                "",
                None,
                Some(&rich_text),
                FitMode::None,
                WritingMode::HorizontalTb,
            ),
            &font_context,
        ),
        TextPreparationPhase::RichPreparation,
    );

    let ruby = vec![RichTextNodeInput::Ruby {
        ruby_position: None,
        ruby_align: None,
        ruby_gap_px: None,
        ruby_offset_px: None,
        ruby_line_sizing: None,
        style: rich_style(),
        base: vec![RichTextNodeInput::Text {
            text: "A".to_string(),
        }],
        rt: vec![RichTextNodeInput::Text {
            text: "a".to_string(),
        }],
        rt_levels: Vec::new(),
    }];
    expect_phase(
        layout_rich_text(
            &request(
                "",
                None,
                Some(&ruby),
                FitMode::None,
                WritingMode::HorizontalTb,
            ),
            &font_context,
        ),
        TextPreparationPhase::RichPreparation,
    );
    Ok(())
}
