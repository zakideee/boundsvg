//! Ellipsis invariants: the kept line fits its box, and the width the engine
//! reports is the width the kept text actually shapes to.
//!
//! Both broke when `apply_ellipsis` measured with default shaping options: it
//! kept text sized at the default instance of a variable font while the line
//! rendered at the requested weight.

// Integration tests always build with `cfg(test)`; declaring it lets clippy's
// `allow-*-in-tests` config apply to helper functions in this file.
#![cfg(test)]

use boundtext::font::shaping::{ShapeOptions, VariationSetting, shape_with_fallback_and_options};
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::ellipsis::apply_ellipsis;
use boundtext::text::engine::layout_text_with_unit_metadata;
use boundtext::text::types::{
    FitMode, InlineRectInput, Language, RichTextNodeInput, RichTextStyleInput, TextLayoutRequest,
    TextOrientation, TextSpanInput, WhiteSpaceMode, WrapMode, WritingMode,
};

fn registry(alias: &str, path: &str) -> FontRegistry {
    let mut reg = FontRegistry::new();
    reg.register(
        std::fs::read(format!(
            "{}/../../fixtures/fonts/{path}",
            env!("CARGO_MANIFEST_DIR")
        ))
        .expect("font"),
        alias.into(),
        400,
        FontStyle::Normal,
    )
    .unwrap();
    reg
}

fn layout_request(text: &str, max_width: f64) -> TextLayoutRequest<'_> {
    TextLayoutRequest {
        text,
        spans: None,
        rich_text: None,
        font_size_px: 24.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width,
        max_height: None,
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: Some(1),
        ellipsis: true,
        language: Language::Ja,
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
    }
}

fn shape_projected_display_advance(
    font_context: &FontContext<'_>,
    display_text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
    options: &ShapeOptions,
) -> f64 {
    let Some(prefix) = display_text.strip_suffix('\u{2026}') else {
        return shape_with_fallback_and_options(
            font_context,
            display_text,
            font_size_px,
            letter_spacing_px,
            options,
        )
        .glyphs
        .iter()
        .map(|glyph| glyph.x_advance)
        .sum();
    };
    let prefix_advance = shape_with_fallback_and_options(
        font_context,
        prefix,
        font_size_px,
        letter_spacing_px,
        options,
    )
    .glyphs
    .iter()
    .map(|glyph| glyph.x_advance)
    .sum::<f64>();
    let marker_advance = shape_with_fallback_and_options(
        font_context,
        "\u{2026}",
        font_size_px,
        letter_spacing_px,
        options,
    )
    .glyphs
    .iter()
    .map(|glyph| glyph.x_advance)
    .sum::<f64>();
    prefix_advance
        + marker_advance
        + if prefix.is_empty() {
            0.0
        } else {
            letter_spacing_px
        }
}

#[test]
fn ordinary_ellipsis_preserves_source_and_marks_the_marker_synthetic() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let source = "あいうえおかきくけこ";
    let result = layout_text_with_unit_metadata(&layout_request(source, 72.0), &font_context)
        .expect("ordinary ellipsis layout");

    assert_eq!(result.source_text.as_deref(), Some(source));
    assert!(result.display_text.as_deref().is_some_and(|text| {
        text.ends_with('\u{2026}') && source.starts_with(text.trim_end_matches('\u{2026}'))
    }));
    let marker = result
        .lines
        .iter()
        .filter_map(|line| line.positioned_glyphs.as_deref())
        .flatten()
        .find(|glyph| glyph.synthetic_kind.as_deref() == Some("ellipsis"))
        .expect("synthetic ellipsis glyph");
    assert_eq!(marker.source_start, None);
    assert_eq!(marker.source_end, None);
    assert_eq!(marker.source_role, None);
}

#[test]
fn marker_that_cannot_fit_produces_zero_ink_and_retains_source() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let source = "あいうえお";
    let result = layout_text_with_unit_metadata(&layout_request(source, 1.0), &font_context)
        .expect("zero-ink ellipsis layout");

    assert_eq!(result.source_text.as_deref(), Some(source));
    assert_eq!(result.display_text.as_deref(), Some(""));
    assert_eq!(result.bbox.w, 0.0);
    assert!(
        result
            .lines
            .iter()
            .filter_map(|line| line.positioned_glyphs.as_deref())
            .flatten()
            .next()
            .is_none(),
        "marker must not be materialized outside its inline constraint"
    );
}

#[test]
fn vertical_ellipsis_uses_the_same_source_projection() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let source = "あいうえおかきくけこ";
    let mut request = layout_request(source, 100.0);
    request.writing_mode = WritingMode::VerticalRl;
    request.max_height = Some(72.0);
    let result =
        layout_text_with_unit_metadata(&request, &font_context).expect("vertical ellipsis layout");

    assert_eq!(result.source_text.as_deref(), Some(source));
    assert!(
        result
            .display_text
            .as_deref()
            .is_some_and(|text| text.ends_with('\u{2026}'))
    );
    let marker = result
        .lines
        .iter()
        .filter_map(|line| line.positioned_glyphs.as_deref())
        .flatten()
        .find(|glyph| glyph.synthetic_kind.as_deref() == Some("ellipsis"))
        .expect("synthetic vertical ellipsis glyph");
    assert_eq!(marker.source_start, None);
    assert_eq!(marker.source_end, None);
    assert_eq!(marker.source_role, None);
}

#[test]
fn span_ellipsis_uses_the_first_omitted_style_and_synthetic_identity() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let span = |text: &str, font_size_px: f64, color: &str| TextSpanInput {
        text: text.to_string(),
        font_family: families.clone(),
        font_weight: 400,
        font_style: FontStyle::Normal,
        font_size_px,
        letter_spacing_px: Some(0.0),
        language: Some("en".to_string()),
        text_orientation: None,
        color: Some(color.to_string()),
        text_strokes: None,
        text_shadows: None,
        font_variation_settings: None,
        font_feature_settings: None,
        text_decoration: None,
        decoration_transport_only: false,
    };
    let spans = vec![
        span("A", 16.0, "#ff0000"),
        span("BBBBBBBB", 32.0, "#0000ff"),
    ];
    let source = spans
        .iter()
        .map(|span| span.text.as_str())
        .collect::<String>();
    let mut request = layout_request(&source, 52.0);
    request.language = Language::En;
    request.spans = Some(&spans);
    let result =
        layout_text_with_unit_metadata(&request, &font_context).expect("span ellipsis layout");

    assert_eq!(result.source_text.as_deref(), Some(source.as_str()));
    let marker = result
        .lines
        .iter()
        .filter_map(|line| line.positioned_glyphs.as_deref())
        .flatten()
        .find(|glyph| glyph.synthetic_kind.as_deref() == Some("ellipsis"))
        .expect("synthetic span ellipsis glyph");
    let marker_fragment = result
        .lines
        .iter()
        .filter_map(|line| line.fragments.as_deref())
        .flatten()
        .find(|fragment| fragment.text.contains('\u{2026}'))
        .expect("ellipsis run fragment");
    assert_eq!(marker_fragment.style.font_size_px, 32.0);
    assert_eq!(marker_fragment.style.color.as_deref(), Some("#0000ff"));
    assert_eq!(marker.source_start, None);
    assert_eq!(marker.source_end, None);
    assert_eq!(marker.source_role, None);
}

fn rich_style(font_size_px: f64, color: &str) -> RichTextStyleInput {
    RichTextStyleInput {
        font_family: vec!["JP".to_string()],
        font_weight: 400,
        font_style: FontStyle::Normal,
        font_size_px,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: Some(0.0),
        language: Some("en".to_string()),
        color: Some(color.to_string()),
        text_strokes: None,
        text_shadows: None,
        font_variation_settings: None,
        font_feature_settings: None,
        text_orientation: None,
        text_decoration: None,
    }
}

#[test]
fn rich_ellipsis_keeps_first_omitted_fragmentable_decoration_ownership() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let rich_text = vec![
        RichTextNodeInput::Text {
            text: "A".to_string(),
        },
        RichTextNodeInput::DecoratedSpan {
            style: rich_style(32.0, "#0000ff"),
            children: vec![RichTextNodeInput::Text {
                text: "BBBBBBBB".to_string(),
            }],
            padding_inline: Some([2.0, 2.0]),
            background: Some("#eeeeff".to_string()),
            border_color: Some("#0000ff".to_string()),
            border_width: Some(1.0),
            border_radius: Some([2.0; 4]),
            span_key: Some("marker-owner".to_string()),
        },
    ];
    let mut request = layout_request("", 58.0);
    request.language = Language::En;
    request.rich_text = Some(&rich_text);
    let result =
        layout_text_with_unit_metadata(&request, &font_context).expect("decorated rich ellipsis");

    let marker = result
        .lines
        .iter()
        .filter_map(|line| line.positioned_glyphs.as_deref())
        .flatten()
        .find(|glyph| glyph.synthetic_kind.as_deref() == Some("ellipsis"))
        .expect("synthetic rich ellipsis glyph");
    assert_eq!(marker.font_size_px, Some(32.0));
    assert_eq!(marker.fill.as_deref(), Some("#0000ff"));
    assert!(
        result
            .inline_box_decorations
            .iter()
            .any(|decoration| { decoration.span_key.as_deref() == Some("marker-owner") })
    );
}

#[test]
fn rich_ellipsis_omits_atomic_output_and_diagnostics_as_a_unit() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let missing = "\u{10FFFF}";
    let rich_text = vec![
        RichTextNodeInput::Text {
            text: "A".to_string(),
        },
        RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: rich_style(24.0, "#222222"),
            base: vec![RichTextNodeInput::Text {
                text: "東京".to_string(),
            }],
            rt: vec![RichTextNodeInput::Text {
                text: missing.to_string(),
            }],
            rt_levels: Vec::new(),
        },
        RichTextNodeInput::InlineBox {
            style: rich_style(24.0, "#333333"),
            children: vec![RichTextNodeInput::Text {
                text: missing.to_string(),
            }],
            padding_inline: Some([2.0, 2.0]),
            background: Some("#eeeeee".to_string()),
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: Some("omitted-box".to_string()),
        },
        RichTextNodeInput::InlineRect {
            rect: InlineRectInput {
                fragment_id: "omitted-rect".to_string(),
                inline_size_px: 24.0,
                block_size_px: None,
                advance_px: None,
                block_align: None,
                color: "#ff0000".to_string(),
                border_radius_px: None,
                opacity: None,
                paint_order: None,
            },
        },
    ];
    let mut request = layout_request("", 52.0);
    request.rich_text = Some(&rich_text);
    let result =
        layout_text_with_unit_metadata(&request, &font_context).expect("atomic rich ellipsis");

    assert_eq!(result.display_text.as_deref(), Some("A\u{2026}"));
    assert!(result.lines.iter().all(|line| {
        line.positioned_glyphs.as_deref().is_none_or(|glyphs| {
            glyphs
                .iter()
                .all(|glyph| glyph.source_role.as_deref() != Some("rubyAnnotation"))
        })
    }));
    assert!(
        result
            .inline_box_decorations
            .iter()
            .all(|decoration| decoration.span_key.as_deref() != Some("omitted-box"))
    );
    assert!(
        result
            .inline_rects
            .iter()
            .all(|rect| rect.fragment_id != "omitted-rect")
    );
    assert!(
        result
            .warnings
            .iter()
            .all(|warning| !warning.message.contains("10FFFF")),
        "omitted atomic descendants must not commit missing-glyph warnings: {:?}",
        result.warnings
    );
}

#[test]
fn ellipsis_line_always_fits_or_is_ellipsis_only() {
    let jp = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let ctx = FontContext {
        registry: &jp,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let texts = [
        "吾輩は猫である。名前はまだ無い。",
        "これは（括弧）を含む長い日本語のテキストです、句読点も。",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "ABCあいうDEFかきくGHIさしす",
        "🇯🇵👨‍👩‍👧‍👦é\u{0301}あ",
        "一",
        "",
        " ",
    ];
    let letter_spacings = [0.0_f64, -1.0];
    let sizes = [12.0_f64, 48.0];

    let mut violations = Vec::new();
    let mut checked = 0usize;

    for text in texts {
        for &size in &sizes {
            for &ls in &letter_spacings {
                // sweep widths from tiny to generous
                for step in 0..16 {
                    let max_width = f64::from(step) * 8.0;
                    let Some(line) = apply_ellipsis(
                        text,
                        max_width,
                        &ctx,
                        size,
                        ls,
                        size * 1.5,
                        size,
                        None,
                        &ShapeOptions::default(),
                    ) else {
                        continue; // already fits — no truncation
                    };
                    checked += 1;

                    // The engine's own reported width must not exceed the box,
                    // unless the line is the "…" alone (documented best effort).
                    if line.width > max_width + 0.001 && line.text != "\u{2026}" {
                        violations.push(format!(
                            "text={text:?} size={size} ls={ls} max_width={max_width} -> kept {:?} width {:.3}",
                            line.text, line.width
                        ));
                    }

                    // The reported width must equal a real shaping of the kept text.
                    let actual = shape_projected_display_advance(
                        &ctx,
                        &line.text,
                        size,
                        ls,
                        &ShapeOptions::default(),
                    );
                    if (actual - line.width).abs() > 0.01 {
                        violations.push(format!(
                            "REPORTED != ACTUAL text={text:?} size={size} ls={ls} kept={:?} reported={:.3} actual={:.3}",
                            line.text, line.width, actual
                        ));
                    }
                }
            }
        }
    }

    println!(
        "checked {checked} truncations, {} violations",
        violations.len()
    );
    for v in violations.iter().take(12) {
        println!("  {v}");
    }
    assert!(
        violations.is_empty(),
        "{} invariant violations",
        violations.len()
    );
}

#[test]
fn ellipsis_with_variations_still_fits() {
    let vf = registry("VF", "Inter-Variable.ttf");
    let families = vec!["VF".to_string()];
    let ctx = FontContext {
        registry: &vf,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let options = ShapeOptions {
        font_variation_settings: vec![VariationSetting {
            tag: "wght".into(),
            value: 900.0,
        }],
        ..ShapeOptions::default()
    };

    let mut violations = Vec::new();
    for step in 1..50 {
        let max_width = f64::from(step) * 10.0;
        let Some(line) = apply_ellipsis(
            "The quick brown fox jumps over the lazy dog",
            max_width,
            &ctx,
            32.0,
            0.0,
            48.0,
            32.0,
            None,
            &options,
        ) else {
            continue;
        };
        let actual = shape_projected_display_advance(&ctx, &line.text, 32.0, 0.0, &options);
        if actual > max_width + 0.001 && line.text != "\u{2026}" {
            violations.push(format!(
                "max_width={max_width} kept={:?} renders {actual:.2}",
                line.text
            ));
        }
    }
    for v in violations.iter().take(8) {
        println!("  {v}");
    }
    assert!(violations.is_empty(), "{} overflow(s)", violations.len());
}
