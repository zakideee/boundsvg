//! Checked layout distinguishes empty output from typed shaping failures.

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use boundtext::error::FontFailureReason;
use boundtext::font::backend::{
    RawShapedGlyph, ShapeDirection, ShapeFeature, ShapeVariation, Shaper, ShaperFace,
};
use boundtext::font::backend_skrifa::SkrifaBackend;
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::engine::layout_text;
use boundtext::text::fit::fit_shrink;
use boundtext::text::inline_runs::prepare_inline_runs;
use boundtext::text::rich::layout_rich_text;
use boundtext::text::types::{
    FitMode, Language, RichTextNodeInput, RichTextStyleInput, TextLayoutRequest, TextOrientation,
    TextSpanInput, WhiteSpaceMode, WrapMode, WritingMode,
};
use boundtext::{BoundtextError, TextLayoutError, TextPreparationPhase};

struct EmptyShaper;

struct EmptyShaperFace;

struct FailingShaper {
    failure: BoundtextError,
    should_fail: Arc<AtomicBool>,
}

struct FailingShaperFace {
    failure: BoundtextError,
    should_fail: Arc<AtomicBool>,
    successful_face: Box<dyn ShaperFace>,
}

impl Shaper for FailingShaper {
    fn create_face(&self, data: Arc<Vec<u8>>) -> Result<Box<dyn ShaperFace>, BoundtextError> {
        Ok(Box::new(FailingShaperFace {
            failure: self.failure.clone(),
            should_fail: self.should_fail.clone(),
            successful_face: boundtext::font::backend_harfrust::HarfRustShaper.create_face(data)?,
        }))
    }
}

impl ShaperFace for FailingShaperFace {
    fn shape(
        &self,
        text: &str,
        direction: ShapeDirection,
        language: Option<&str>,
        features: &[ShapeFeature],
        variations: &[ShapeVariation],
    ) -> Result<Vec<RawShapedGlyph>, BoundtextError> {
        if self.should_fail.load(Ordering::Relaxed) {
            return Err(self.failure.clone());
        }
        self.successful_face
            .shape(text, direction, language, features, variations)
    }
}

impl Shaper for EmptyShaper {
    fn create_face(
        &self,
        _data: Arc<Vec<u8>>,
    ) -> Result<Box<dyn ShaperFace>, boundtext::BoundtextError> {
        Ok(Box::new(EmptyShaperFace))
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
    ) -> Result<Vec<RawShapedGlyph>, boundtext::BoundtextError> {
        Ok(Vec::new())
    }
}

fn empty_shaper_registry() -> Result<FontRegistry, Box<dyn std::error::Error>> {
    let mut registry = FontRegistry::with_backend(Arc::new(SkrifaBackend), Arc::new(EmptyShaper));
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

fn assert_rich_shaping_failure(font_context: &FontContext<'_>, failure: &BoundtextError) {
    let rich_inputs = [
        vec![RichTextNodeInput::Span {
            text: "A".to_string(),
            style: rich_style(),
        }],
        vec![RichTextNodeInput::Ruby {
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
        }],
    ];
    for rich_input in &rich_inputs {
        assert_eq!(
            layout_rich_text(
                &request(
                    "",
                    None,
                    Some(rich_input),
                    FitMode::None,
                    WritingMode::HorizontalTb,
                ),
                font_context,
            )
            .err(),
            Some(TextLayoutError::Font(failure.clone()))
        );
    }
}

#[test]
fn typed_shaping_failures_reach_every_layout_caller_and_do_not_poison_recovery()
-> Result<(), Box<dyn std::error::Error>> {
    let failures = [
        BoundtextError::TextShaping {
            reason: FontFailureReason::AlreadyShaped,
        },
        BoundtextError::TextShaping {
            reason: FontFailureReason::DirectionUnset,
        },
        BoundtextError::TextShaping {
            reason: FontFailureReason::BufferPreparationFailed,
        },
        BoundtextError::TextShaping {
            reason: FontFailureReason::AllocationFailed,
        },
        BoundtextError::TextShapingLimitExceeded,
    ];
    for failure in failures {
        let should_fail = Arc::new(AtomicBool::new(true));
        let mut registry = FontRegistry::with_backend(
            Arc::new(SkrifaBackend),
            Arc::new(FailingShaper {
                failure: failure.clone(),
                should_fail: should_fail.clone(),
            }),
        );
        registry.register(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
            ))?,
            "EmptyShaper".to_string(),
            400,
            FontStyle::Normal,
        )?;
        let families = vec!["EmptyShaper".to_string()];
        let style = FontStyle::Normal;
        let font_context = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &style,
        };
        for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            for fit in [FitMode::None, FitMode::Shrink] {
                let layout_request = request("A", None, None, fit, writing_mode);
                assert_eq!(
                    layout_text(&layout_request, &font_context).err(),
                    Some(TextLayoutError::Font(failure.clone()))
                );
            }
        }
        let spans = vec![span("A")];
        assert_eq!(
            prepare_inline_runs(
                &spans,
                &font_context,
                0.0,
                Language::En,
                false,
                &[None],
                false,
            )
            .err(),
            Some(TextLayoutError::Font(failure.clone()))
        );
        assert_rich_shaping_failure(&font_context, &failure);
        should_fail.store(false, Ordering::Relaxed);
        let recovered = layout_text(
            &request("A", None, None, FitMode::None, WritingMode::HorizontalTb),
            &font_context,
        )?;
        assert_eq!(recovered.lines.len(), 1);
    }
    Ok(())
}
