//! C2b first-failing effective-run identity.

use std::error::Error;

use boundtext::TextLayoutError;
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::engine::layout_text;
use boundtext::text::types::{
    FitMode, Language, RichTextNodeInput, RichTextStyleInput, TextLayoutRequest, TextOrientation,
    TextSpanInput, WhiteSpaceMode, WrapMode, WritingMode,
};

fn fixture_registry() -> Result<FontRegistry, Box<dyn Error>> {
    let mut registry = FontRegistry::new();
    let font_bytes = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
    ))?;
    registry.register(font_bytes, "Good".to_string(), 400, FontStyle::Normal)?;
    Ok(registry)
}

fn request<'a>(
    text: &'a str,
    spans: Option<&'a [TextSpanInput]>,
    rich_text: Option<&'a [RichTextNodeInput]>,
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
        max_height: None,
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: None,
        ellipsis: false,
        language: Language::Auto,
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: TextOrientation::Mixed,
        uax14_breaks: None,
        hanging_punctuation: false,
        font_variation_settings: Vec::new(),
        font_feature_settings: Vec::new(),
        min_font_size_px: None,
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
        fit_max_probes: None,
    }
}

fn span(text: &str, family: &str) -> TextSpanInput {
    TextSpanInput {
        text: text.to_string(),
        font_family: vec![family.to_string()],
        font_weight: 400,
        font_style: FontStyle::Normal,
        font_size_px: 16.0,
        letter_spacing_px: Some(0.0),
        language: None,
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

fn rich_style(family: &str) -> RichTextStyleInput {
    RichTextStyleInput {
        font_family: vec![family.to_string()],
        font_weight: 400,
        font_style: FontStyle::Normal,
        font_size_px: 16.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: Some(0.0),
        language: None,
        color: None,
        text_strokes: None,
        text_shadows: None,
        font_variation_settings: None,
        font_feature_settings: None,
        text_orientation: None,
        text_decoration: None,
    }
}

fn expect_missing_run<T>(result: Result<T, TextLayoutError>, run_index: usize, family: &str) {
    let Err(error) = result else {
        assert!(result.is_err(), "expected FontUnavailable");
        return;
    };
    match &error {
        TextLayoutError::FontUnavailable {
            run_index: actual_index,
            families,
            weight,
            style,
        } => {
            assert_eq!(*actual_index, run_index);
            assert_eq!(families, &[family]);
            assert_eq!(*weight, 400);
            assert_eq!(*style, FontStyle::Normal);
        }
        other => assert!(
            matches!(other, TextLayoutError::FontUnavailable { .. }),
            "expected FontUnavailable, got {other:?}"
        ),
    }
}

#[test]
fn plain_missing_font_is_run_zero() {
    let registry = FontRegistry::new();
    let families = vec!["Missing".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    expect_missing_run(
        layout_text(&request("A", None, None), &font_context),
        0,
        "Missing",
    );
}

#[test]
fn spans_report_the_first_failing_non_empty_authored_run() -> Result<(), Box<dyn Error>> {
    let registry = fixture_registry()?;
    let families = vec!["Good".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    let spans = vec![
        span("", "MissingBeforeText"),
        span("A", "Good"),
        span("B", "Missing"),
    ];
    expect_missing_run(
        layout_text(&request("AB", Some(&spans), None), &font_context),
        1,
        "Missing",
    );
    Ok(())
}

#[test]
fn nested_rich_text_preserves_depth_first_effective_run_order() -> Result<(), Box<dyn Error>> {
    let registry = fixture_registry()?;
    let families = vec!["Good".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    let rich_text = vec![
        RichTextNodeInput::Span {
            text: "A".to_string(),
            style: rich_style("Good"),
        },
        RichTextNodeInput::InlineBox {
            style: rich_style("Good"),
            children: vec![RichTextNodeInput::Span {
                text: "B".to_string(),
                style: rich_style("Missing"),
            }],
            padding_inline: None,
            background: None,
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: None,
        },
    ];
    expect_missing_run(
        layout_text(&request("", None, Some(&rich_text)), &font_context),
        1,
        "Missing",
    );
    Ok(())
}

#[test]
fn ruby_annotation_follows_its_base_in_effective_run_order() -> Result<(), Box<dyn Error>> {
    let registry = fixture_registry()?;
    let families = vec!["Good".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    let rich_text = vec![RichTextNodeInput::Ruby {
        ruby_position: None,
        ruby_align: None,
        ruby_gap_px: None,
        ruby_offset_px: None,
        ruby_line_sizing: None,
        style: rich_style("Good"),
        base: vec![RichTextNodeInput::Span {
            text: "本".to_string(),
            style: rich_style("Good"),
        }],
        rt: vec![RichTextNodeInput::Span {
            text: "ほん".to_string(),
            style: rich_style("Missing"),
        }],
        rt_levels: Vec::new(),
    }];
    expect_missing_run(
        layout_text(&request("", None, Some(&rich_text)), &font_context),
        1,
        "Missing",
    );
    Ok(())
}
