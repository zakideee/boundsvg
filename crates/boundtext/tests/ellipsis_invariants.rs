//! Ellipsis invariants: the kept line fits its box, and the width the engine
//! reports is the width the kept text actually shapes to.
//!
//! Both broke when `apply_ellipsis` measured with default shaping options: it
//! kept text sized at the default instance of a variable font while the line
//! rendered at the requested weight.

// Integration tests always build with `cfg(test)`; declaring it lets clippy's
// `allow-*-in-tests` config apply to helper functions in this file.
#![cfg(test)]

use boundtext::TextLayoutError;
use boundtext::font::shaping::{ShapeOptions, VariationSetting, shape_with_fallback_and_options};
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::ellipsis::apply_ellipsis;
use boundtext::text::engine::layout_text_with_unit_metadata;
use boundtext::text::types::{
    FitMode, InlineRectInput, Language, MAX_INLINE_RECTS, MAX_RICH_TEXT_DEPTH, RichTextNodeInput,
    RichTextStyleInput, TextDecorationInput, TextDecorationLine, TextDecorationSkipInk,
    TextDecorationStyle, TextLayoutRequest, TextOrientation, TextSpanInput, WhiteSpaceMode,
    WrapMode, WritingMode,
};
use boundtext::text::unit_map::{
    TextUnitKind, TextUnitRubyMode, TextUnitSourceRole, build_text_unit_map_for_request,
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
        fit_max_probes: None,
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
    let layout_result =
        layout_text_with_unit_metadata(&layout_request(source, 72.0), &font_context)
            .expect("ordinary ellipsis layout");

    assert_eq!(layout_result.source_text.as_deref(), Some(source));
    assert!(layout_result.display_text.as_deref().is_some_and(|text| {
        text.ends_with('\u{2026}') && source.starts_with(text.trim_end_matches('\u{2026}'))
    }));
    let marker = layout_result
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
    let layout_result = layout_text_with_unit_metadata(&layout_request(source, 1.0), &font_context)
        .expect("zero-ink ellipsis layout");

    assert_eq!(layout_result.source_text.as_deref(), Some(source));
    assert_eq!(layout_result.display_text.as_deref(), Some(""));
    assert_eq!(layout_result.bbox.w, 0.0);
    assert!(
        layout_result
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
fn overflowing_ellipsis_rejects_an_unbounded_exact_candidate_set() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let source = "あ".repeat(1_025);
    let request = layout_request(&source, 1.0);

    let error = layout_text_with_unit_metadata(&request, &font_context)
        .expect_err("candidate budget must fail before projection");
    assert_eq!(
        error,
        TextLayoutError::EllipsisCandidateLimit {
            required: 1_026,
            limit: 1_024,
        }
    );
}

#[test]
fn a_large_non_overflowing_document_does_not_spend_the_ellipsis_budget() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let source = "あ".repeat(1_025);
    let request = layout_request(&source, 1_000_000.0);

    let layout_result = layout_text_with_unit_metadata(&request, &font_context)
        .expect("a complete fitting document needs no candidate search");
    assert_eq!(layout_result.overflow.overflow_type, "none");
    assert_eq!(layout_result.display_text, None);
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
    let layout_result =
        layout_text_with_unit_metadata(&request, &font_context).expect("vertical ellipsis layout");

    assert_eq!(layout_result.source_text.as_deref(), Some(source));
    assert!(
        layout_result
            .display_text
            .as_deref()
            .is_some_and(|text| text.ends_with('\u{2026}'))
    );
    let marker = layout_result
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
fn ellipsis_never_splits_an_extended_grapheme_cluster() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let source = "A\u{0301}B👨‍👩‍👧‍👦C";
    let source_graphemes = boundtext::text::grapheme::grapheme_split(source);

    for max_width in (8..96).step_by(4) {
        let request = layout_request(source, f64::from(max_width));
        let layout_result = layout_text_with_unit_metadata(&request, &font_context)
            .expect("combining-sequence ellipsis layout");
        let Some(display) = layout_result.display_text.as_deref() else {
            continue;
        };
        let Some(prefix) = display.strip_suffix('\u{2026}') else {
            continue;
        };
        assert!(
            (0..=source_graphemes.len()).any(|keep| source_graphemes[..keep].concat() == prefix),
            "display prefix {prefix:?} is not an EGC prefix of {source:?}"
        );
    }
}

#[test]
fn ligature_prefix_is_reshaped_as_end_of_text() {
    let font_registry = registry("VF", "Inter-Variable.ttf");
    let families = vec!["VF".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let source = "office office";
    let mut selected = None;
    for max_width in (32..160).step_by(2) {
        let mut request = layout_request(source, f64::from(max_width));
        request.language = Language::En;
        let layout_result = layout_text_with_unit_metadata(&request, &font_context)
            .expect("ligature ellipsis layout");
        let Some(prefix) = layout_result
            .display_text
            .as_deref()
            .and_then(|display| display.strip_suffix('\u{2026}'))
        else {
            continue;
        };
        if matches!(prefix, "of" | "off") {
            selected = Some((prefix.to_string(), layout_result));
            break;
        }
    }
    let (prefix, layout_result) =
        selected.expect("fixture must cut inside the original ffi ligature");
    let expected = shape_with_fallback_and_options(
        &font_context,
        &prefix,
        24.0,
        0.0,
        &ShapeOptions::default(),
    );
    let actual_ids = layout_result
        .lines
        .iter()
        .filter_map(|line| line.positioned_glyphs.as_deref())
        .flatten()
        .filter(|glyph| glyph.synthetic_kind.is_none())
        .map(|glyph| glyph.glyph_id)
        .collect::<Vec<_>>();
    let mut expected_glyphs = expected.glyphs;
    expected_glyphs.sort_by_key(|glyph| glyph.cluster);
    let expected_ids = expected_glyphs
        .iter()
        .map(|glyph| glyph.glyph_id)
        .collect::<Vec<_>>();

    assert_eq!(actual_ids, expected_ids);
}

#[test]
fn arabic_prefix_recomputes_its_contextual_end_form() {
    let font_registry = registry("Arabic", "ContextualArabicTest.ttf");
    let families = vec!["Arabic".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let source = "ببببب";
    let request = layout_request(source, 58.0);
    let layout_result = layout_text_with_unit_metadata(&request, &font_context)
        .expect("Arabic contextual ellipsis layout");
    let prefix = layout_result
        .display_text
        .as_deref()
        .and_then(|display| display.strip_suffix('\u{2026}'))
        .expect("truncated Arabic prefix");
    assert_eq!(prefix, "ببب");

    let expected =
        shape_with_fallback_and_options(&font_context, prefix, 24.0, 0.0, &ShapeOptions::default());
    let mut expected_glyphs = expected.glyphs;
    expected_glyphs.sort_by_key(|glyph| glyph.cluster);
    let expected_ids = expected_glyphs
        .iter()
        .map(|glyph| glyph.glyph_id)
        .collect::<Vec<_>>();
    let actual_ids = layout_result
        .lines
        .iter()
        .filter_map(|line| line.positioned_glyphs.as_deref())
        .flatten()
        .filter(|glyph| glyph.synthetic_kind.is_none())
        .map(|glyph| glyph.glyph_id)
        .collect::<Vec<_>>();

    assert_eq!(actual_ids, expected_ids);
    assert!(
        expected_ids.contains(&6),
        "the retained prefix must use the fixture's final-form glyph"
    );
}

#[test]
fn synthetic_marker_is_shaped_in_an_isolated_run() {
    let font_registry = registry("Context", "ContextualArabicTest.ttf");
    let families = vec!["Context".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let mut request = layout_request("AAAA", 31.0);
    request.language = Language::En;

    let layout_result = layout_text_with_unit_metadata(&request, &font_context)
        .expect("synthetic marker isolation layout");
    assert_eq!(layout_result.display_text.as_deref(), Some("A\u{2026}"));

    let glyphs = layout_result
        .lines
        .iter()
        .filter_map(|line| line.positioned_glyphs.as_deref())
        .flatten()
        .collect::<Vec<_>>();
    let authored_a =
        shape_with_fallback_and_options(&font_context, "A", 24.0, 0.0, &ShapeOptions::default());
    let marker = shape_with_fallback_and_options(
        &font_context,
        "\u{2026}",
        24.0,
        0.0,
        &ShapeOptions::default(),
    );

    assert_eq!(glyphs.len(), 2, "A + ellipsis ligature must not form");
    assert_eq!(glyphs[0].glyph_id, authored_a.glyphs[0].glyph_id);
    assert_eq!(glyphs[1].glyph_id, marker.glyphs[0].glyph_id);
    assert_eq!(glyphs[0].synthetic_kind, None);
    assert_eq!(glyphs[1].synthetic_kind.as_deref(), Some("ellipsis"));
    assert_eq!(glyphs[1].source_start, None);
    assert_eq!(glyphs[1].source_end, None);
}

#[test]
fn paint_and_line_box_boundaries_preserve_arabic_contextual_shaping() {
    let font_registry = registry("Arabic", "ContextualArabicTest.ttf");
    let families = vec!["Arabic".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let mut red_style = rich_style(24.0, "#ff0000");
    red_style.font_family = families.clone();
    red_style.language = Some("ar".to_string());
    let mut blue_style = red_style.clone();
    blue_style.color = Some("#0000ff".to_string());
    blue_style.line_height_px = Some(40.0);
    let rich_text = vec![
        RichTextNodeInput::Span {
            text: "بب".to_string(),
            style: red_style,
        },
        RichTextNodeInput::DecoratedSpan {
            style: blue_style,
            children: vec![RichTextNodeInput::Text {
                text: "بب".to_string(),
            }],
            padding_inline: None,
            background: Some("#eeeeff".to_string()),
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: Some("arabic-context".to_string()),
        },
    ];
    let mut request = layout_request("", 1_000.0);
    request.rich_text = Some(&rich_text);
    request.max_lines = None;
    request.ellipsis = false;
    request.language = Language::Auto;

    let layout_result = layout_text_with_unit_metadata(&request, &font_context)
        .expect("paint-separated Arabic layout");
    let actual = layout_result
        .lines
        .iter()
        .filter_map(|line| line.positioned_glyphs.as_deref())
        .flatten()
        .collect::<Vec<_>>();
    let expected =
        shape_with_fallback_and_options(&font_context, "بببب", 24.0, 0.0, &ShapeOptions::default());
    let mut expected_glyphs = expected.glyphs;
    expected_glyphs.sort_by_key(|glyph| glyph.cluster);

    assert_eq!(
        actual
            .iter()
            .map(|glyph| glyph.glyph_id)
            .collect::<Vec<_>>(),
        expected_glyphs
            .iter()
            .map(|glyph| glyph.glyph_id)
            .collect::<Vec<_>>()
    );
    assert!(actual.iter().all(|glyph| {
        if glyph.source_start.unwrap_or_default() < 2 {
            glyph.fill.as_deref() == Some("#ff0000")
        } else {
            glyph.fill.as_deref() == Some("#0000ff")
        }
    }));
    assert!(
        layout_result
            .inline_box_decorations
            .iter()
            .any(|decoration| { decoration.span_key.as_deref() == Some("arabic-context") })
    );
}

#[test]
fn ruby_keeps_global_base_identity_and_local_annotation_decoration_identity() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let ruby_style = rich_style(24.0, "#111111");
    let mut annotation_style = rich_style(12.0, "#111111");
    annotation_style.text_decoration = Some(TextDecorationInput {
        line: vec![TextDecorationLine::Overline],
        color: "#3b82f6".to_string(),
        style: TextDecorationStyle::Solid,
        thickness_px: None,
        offset_px: 0.0,
        skip_ink: TextDecorationSkipInk::None,
    });
    let rich_text = vec![
        RichTextNodeInput::Text {
            text: "AB".to_string(),
        },
        RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: ruby_style,
            base: vec![RichTextNodeInput::Text {
                text: "漢".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "かん".to_string(),
                style: annotation_style,
            }],
            rt_levels: Vec::new(),
        },
    ];
    let mut request = layout_request("", 1_000.0);
    request.rich_text = Some(&rich_text);
    request.max_lines = None;
    request.ellipsis = false;

    let layout_result = layout_text_with_unit_metadata(&request, &font_context)
        .expect("ruby decoration projection layout");
    let annotation_glyphs = layout_result
        .lines
        .iter()
        .filter_map(|line| line.positioned_glyphs.as_deref())
        .flatten()
        .filter(|glyph| glyph.source_role.as_deref() == Some("rubyAnnotation"))
        .collect::<Vec<_>>();

    assert!(!annotation_glyphs.is_empty());
    assert!(annotation_glyphs.iter().all(|glyph| {
        glyph.source_start == Some(2)
            && glyph.source_end == Some(3)
            && glyph.decoration_source_start.is_some_and(|start| start < 2)
            && glyph.decoration_source_end.is_some_and(|end| end <= 2)
    }));
    assert!(layout_result.text_decorations.iter().any(|fragment| {
        fragment.line == TextDecorationLine::Overline
            && fragment.source_start == 0
            && fragment.source_end == 2
            && !fragment.paths.is_empty()
    }));
}

#[test]
fn ruby_after_content_keeps_annotation_clusters_local_without_phantom_units() {
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
            text: "AB".to_string(),
        },
        RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: rich_style(24.0, "#111111"),
            base: vec![RichTextNodeInput::Text {
                text: "漢".to_string(),
            }],
            rt: vec![RichTextNodeInput::Text {
                text: "かん".to_string(),
            }],
            rt_levels: Vec::new(),
        },
    ];
    let mut request = layout_request("", 1_000.0);
    request.rich_text = Some(&rich_text);
    request.max_lines = None;
    request.ellipsis = false;

    let layout_result = layout_text_with_unit_metadata(&request, &font_context)
        .expect("ruby source projection layout");
    let annotation_cluster_ranges = layout_result
        .lines
        .iter()
        .filter_map(|line| line.positioned_glyphs.as_deref())
        .flatten()
        .filter(|glyph| glyph.source_role.as_deref() == Some("rubyAnnotation"))
        .map(|glyph| (glyph.cluster_start, glyph.cluster_end))
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        annotation_cluster_ranges,
        std::collections::BTreeSet::from([(0, 3), (3, 6)])
    );

    let unit_map = build_text_unit_map_for_request(
        &layout_result,
        &request,
        &font_context,
        TextUnitKind::Cluster,
        TextUnitRubyMode::Separate,
    )
    .expect("ruby unit map");
    assert_eq!(unit_map.units.len(), 5);
    assert!(unit_map.units.iter().all(|unit| !unit.members.is_empty()));
    assert_eq!(
        unit_map
            .units
            .iter()
            .filter(|unit| {
                unit.members
                    .iter()
                    .any(|member| member.source_role == TextUnitSourceRole::RubyAnnotation)
            })
            .count(),
        2
    );
}

#[test]
fn nested_inline_box_children_keep_one_global_source_identity() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let rich_text = vec![RichTextNodeInput::InlineBox {
        style: rich_style(24.0, "#111111"),
        children: vec![
            RichTextNodeInput::Text {
                text: "AB".to_string(),
            },
            RichTextNodeInput::InlineBox {
                style: rich_style(24.0, "#222222"),
                children: vec![RichTextNodeInput::Text {
                    text: "CD".to_string(),
                }],
                padding_inline: None,
                background: None,
                border_color: None,
                border_width: None,
                border_radius: None,
                span_key: Some("nested-source".to_string()),
            },
        ],
        padding_inline: None,
        background: None,
        border_color: None,
        border_width: None,
        border_radius: None,
        span_key: Some("outer-source".to_string()),
    }];

    for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
        let mut request = layout_request("", 1_000.0);
        request.rich_text = Some(&rich_text);
        request.max_lines = None;
        request.ellipsis = false;
        request.writing_mode = writing_mode;
        request.max_height = Some(1_000.0);

        let layout_result = layout_text_with_unit_metadata(&request, &font_context)
            .expect("nested inline-box source projection layout");
        let source_and_cluster_ranges = layout_result
            .lines
            .iter()
            .filter_map(|line| line.positioned_glyphs.as_deref())
            .flatten()
            .filter(|glyph| glyph.source_role.as_deref() == Some("content"))
            .map(|glyph| {
                (
                    glyph.source_start,
                    glyph.source_end,
                    glyph.cluster_start,
                    glyph.cluster_end,
                )
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            source_and_cluster_ranges,
            std::collections::BTreeSet::from([
                (Some(0), Some(1), 0, 1),
                (Some(1), Some(2), 1, 2),
                (Some(2), Some(3), 2, 3),
                (Some(3), Some(4), 3, 4),
            ])
        );

        let unit_map = build_text_unit_map_for_request(
            &layout_result,
            &request,
            &font_context,
            TextUnitKind::Cluster,
            TextUnitRubyMode::Separate,
        )
        .expect("nested inline-box unit map");
        assert_eq!(unit_map.units.len(), 4);
        assert!(unit_map.units.iter().all(|unit| !unit.members.is_empty()));
    }
}

#[test]
fn multi_segment_ruby_keeps_contiguous_level_local_clusters() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let rich_text = vec![RichTextNodeInput::Ruby {
        ruby_position: Some("over".to_string()),
        ruby_align: Some("center".to_string()),
        ruby_gap_px: None,
        ruby_offset_px: None,
        ruby_line_sizing: None,
        style: rich_style(24.0, "#111111"),
        base: vec![
            RichTextNodeInput::Span {
                text: "漢".to_string(),
                style: rich_style(24.0, "#111111"),
            },
            RichTextNodeInput::Span {
                text: "字".to_string(),
                style: rich_style(24.0, "#222222"),
            },
        ],
        rt: vec![
            RichTextNodeInput::Span {
                text: "か".to_string(),
                style: rich_style(12.0, "#333333"),
            },
            RichTextNodeInput::Span {
                text: "ん".to_string(),
                style: rich_style(12.0, "#444444"),
            },
        ],
        rt_levels: Vec::new(),
    }];

    for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
        let mut request = layout_request("", 1_000.0);
        request.rich_text = Some(&rich_text);
        request.max_lines = None;
        request.ellipsis = false;
        request.writing_mode = writing_mode;
        request.max_height = Some(1_000.0);

        let layout_result = layout_text_with_unit_metadata(&request, &font_context)
            .expect("multi-segment ruby layout");
        for role in ["rubyBase", "rubyAnnotation"] {
            let cluster_ranges = layout_result
                .lines
                .iter()
                .filter_map(|line| line.positioned_glyphs.as_deref())
                .flatten()
                .filter(|glyph| glyph.source_role.as_deref() == Some(role))
                .map(|glyph| (glyph.cluster_start, glyph.cluster_end))
                .collect::<std::collections::BTreeSet<_>>();
            assert_eq!(
                cluster_ranges,
                std::collections::BTreeSet::from([(0, 3), (3, 6)]),
                "{writing_mode:?} {role}"
            );
        }

        let unit_map = build_text_unit_map_for_request(
            &layout_result,
            &request,
            &font_context,
            TextUnitKind::Cluster,
            TextUnitRubyMode::Separate,
        )
        .expect("multi-segment ruby unit map");
        assert_eq!(unit_map.units.len(), 4);
        assert!(unit_map.units.iter().all(|unit| !unit.members.is_empty()));
    }
}

#[test]
fn equal_ruby_annotation_levels_remain_distinct_units() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let rich_text = vec![RichTextNodeInput::Ruby {
        ruby_position: Some("alternate".to_string()),
        ruby_align: Some("center".to_string()),
        ruby_gap_px: None,
        ruby_offset_px: None,
        ruby_line_sizing: None,
        style: rich_style(24.0, "#111111"),
        base: vec![RichTextNodeInput::Text {
            text: "漢".to_string(),
        }],
        rt: Vec::new(),
        rt_levels: vec![
            vec![RichTextNodeInput::Text {
                text: "か".to_string(),
            }],
            vec![RichTextNodeInput::Text {
                text: "か".to_string(),
            }],
        ],
    }];

    for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
        let mut request = layout_request("", 1_000.0);
        request.rich_text = Some(&rich_text);
        request.max_lines = None;
        request.ellipsis = false;
        request.writing_mode = writing_mode;
        request.max_height = Some(1_000.0);

        let layout_result = layout_text_with_unit_metadata(&request, &font_context)
            .expect("multi-level ruby layout");
        let unit_map = build_text_unit_map_for_request(
            &layout_result,
            &request,
            &font_context,
            TextUnitKind::Cluster,
            TextUnitRubyMode::Separate,
        )
        .expect("multi-level ruby unit map");
        let annotation_units = unit_map
            .units
            .iter()
            .filter(|unit| {
                unit.members
                    .iter()
                    .any(|member| member.source_role == TextUnitSourceRole::RubyAnnotation)
            })
            .collect::<Vec<_>>();
        assert_eq!(annotation_units.len(), 2, "{writing_mode:?}");
        assert_ne!(annotation_units[0].unit_id, annotation_units[1].unit_id);
        assert!(unit_map.units.iter().all(|unit| !unit.members.is_empty()));

        let omitted_rich_text = vec![
            RichTextNodeInput::Text {
                text: "AAAA".to_string(),
            },
            rich_text[0].clone(),
        ];
        let mut omitted_request = layout_request("", 50.0);
        omitted_request.rich_text = Some(&omitted_rich_text);
        omitted_request.writing_mode = writing_mode;
        omitted_request.max_height = Some(50.0);
        let omitted_layout = layout_text_with_unit_metadata(&omitted_request, &font_context)
            .expect("omitted multi-level ruby layout");
        let omitted_unit_map = build_text_unit_map_for_request(
            &omitted_layout,
            &omitted_request,
            &font_context,
            TextUnitKind::Cluster,
            TextUnitRubyMode::Separate,
        )
        .expect("omitted multi-level ruby unit map");
        assert!(
            omitted_layout
                .display_text
                .as_deref()
                .is_some_and(|text| text.ends_with('\u{2026}')),
            "{writing_mode:?}: {:?}",
            omitted_layout.display_text
        );
        assert_eq!(omitted_unit_map.units.len(), 7, "{writing_mode:?}");
        assert_eq!(
            omitted_unit_map
                .units
                .iter()
                .map(|unit| unit.unit_id.as_str())
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            7,
            "{writing_mode:?}"
        );
        assert!(
            omitted_unit_map
                .units
                .iter()
                .filter(|unit| unit.members.is_empty())
                .count()
                >= 3,
            "{writing_mode:?}: display={:?}, members={:?}",
            omitted_layout.display_text,
            omitted_unit_map
                .units
                .iter()
                .map(|unit| unit.members.len())
                .collect::<Vec<_>>()
        );
    }
}

#[test]
fn word_ellipsis_honors_supplied_uax14_boundaries() {
    let font_registry = registry("VF", "Inter-Variable.ttf");
    let families = vec!["VF".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let supplied_breaks = [3_usize];
    let mut request = layout_request("abcdef", 75.0);
    request.language = Language::En;
    request.wrap = WrapMode::Word;
    request.uax14_breaks = Some(&supplied_breaks);
    let layout_result = layout_text_with_unit_metadata(&request, &font_context)
        .expect("supplied UAX #14 ellipsis layout");

    assert_eq!(layout_result.display_text.as_deref(), Some("abc\u{2026}"));
}

#[test]
fn vertical_rich_shrink_selects_size_from_the_complete_document() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let rich_text = vec![RichTextNodeInput::Text {
        text: "あいうえおかきくけこさしすせそ".to_string(),
    }];
    let mut request = layout_request("", 200.0);
    request.rich_text = Some(&rich_text);
    request.writing_mode = WritingMode::VerticalRl;
    request.max_height = Some(60.0);
    request.fit = FitMode::Shrink;
    request.min_font_size_px = Some(20.0);

    request.ellipsis = false;
    let complete = layout_text_with_unit_metadata(&request, &font_context)
        .expect("complete-document shrink layout");
    request.ellipsis = true;
    let projected =
        layout_text_with_unit_metadata(&request, &font_context).expect("projected shrink layout");

    assert_eq!(projected.chosen_font_size_px, complete.chosen_font_size_px);
    assert_eq!(projected.chosen_font_size_px, 20.0);
    assert!(
        projected
            .display_text
            .as_deref()
            .is_some_and(|text| text.ends_with('\u{2026}'))
    );
}

#[test]
fn grow_rejects_the_complete_document_before_applying_ellipsis() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let rich_text = vec![RichTextNodeInput::Text {
        text: "あいうえおかきくけこさしすせそ".to_string(),
    }];
    let mut request = layout_request("", 72.0);
    request.rich_text = Some(&rich_text);
    request.fit = FitMode::Grow;
    request.max_font_size_px = Some(48.0);

    request.ellipsis = false;
    let complete = layout_text_with_unit_metadata(&request, &font_context)
        .expect("complete-document grow rejection");
    request.ellipsis = true;
    let projected = layout_text_with_unit_metadata(&request, &font_context)
        .expect("post-grow ellipsis projection");

    assert_eq!(complete.chosen_font_size_px, request.font_size_px);
    assert_eq!(projected.chosen_font_size_px, complete.chosen_font_size_px);
    assert!(
        projected
            .display_text
            .as_deref()
            .is_some_and(|text| text.ends_with('\u{2026}'))
    );
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
    let layout_result =
        layout_text_with_unit_metadata(&request, &font_context).expect("span ellipsis layout");

    assert_eq!(layout_result.source_text.as_deref(), Some(source.as_str()));
    let marker = layout_result
        .lines
        .iter()
        .filter_map(|line| line.positioned_glyphs.as_deref())
        .flatten()
        .find(|glyph| glyph.synthetic_kind.as_deref() == Some("ellipsis"))
        .expect("synthetic span ellipsis glyph");
    assert_eq!(marker.font_size_px, Some(32.0));
    assert_eq!(marker.fill.as_deref(), Some("#0000ff"));
    assert_eq!(marker.source_start, None);
    assert_eq!(marker.source_end, None);
    assert_eq!(marker.source_role, None);
}

#[test]
fn mixed_metrics_and_negative_tracking_choose_the_longest_exact_prefix() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let mut large = rich_style(34.0, "#ff0000");
    large.letter_spacing_px = Some(-5.0);
    let mut small = rich_style(18.0, "#0000ff");
    small.letter_spacing_px = Some(-2.0);
    let authored = [("AVAV", large), ("あいうえお", small)];
    let rich_text = authored
        .iter()
        .map(|(text, style)| RichTextNodeInput::Span {
            text: (*text).to_string(),
            style: style.clone(),
        })
        .collect::<Vec<_>>();
    let source = authored.iter().map(|(text, _)| *text).collect::<String>();
    let mut request = layout_request("", 94.0);
    request.rich_text = Some(&rich_text);
    request.language = Language::En;
    let selected = layout_text_with_unit_metadata(&request, &font_context)
        .expect("mixed-metric ellipsis layout");
    let selected_prefix = selected
        .display_text
        .as_deref()
        .and_then(|display| display.strip_suffix('\u{2026}'))
        .expect("ellipsis display prefix");

    let grapheme_runs = authored
        .iter()
        .map(|(text, _)| boundtext::text::grapheme::grapheme_split(text))
        .collect::<Vec<_>>();
    let total = grapheme_runs.iter().map(Vec::len).sum::<usize>();
    let mut longest_fitting = None;
    for keep in (0..total).rev() {
        let mut remaining = keep;
        let mut candidate_nodes = Vec::new();
        let mut omitted_style = None;
        for ((_, style), graphemes) in authored.iter().zip(&grapheme_runs) {
            let take = remaining.min(graphemes.len());
            if take > 0 {
                candidate_nodes.push(RichTextNodeInput::Span {
                    text: graphemes[..take].concat(),
                    style: style.clone(),
                });
            }
            remaining -= take;
            if take < graphemes.len() {
                omitted_style = Some(style.clone());
                break;
            }
        }
        candidate_nodes.push(RichTextNodeInput::Span {
            text: "\u{2026}".to_string(),
            style: omitted_style.expect("candidate omits one authored grapheme"),
        });
        let mut candidate_request = layout_request("", request.max_width);
        candidate_request.rich_text = Some(&candidate_nodes);
        candidate_request.ellipsis = false;
        candidate_request.language = Language::En;
        let candidate = layout_text_with_unit_metadata(&candidate_request, &font_context)
            .expect("exact candidate layout");
        if candidate.overflow.overflow_type == "none" && candidate.lines.len() <= 1 {
            longest_fitting = Some(keep);
            break;
        }
    }

    let selected_keep = boundtext::text::grapheme::grapheme_split(selected_prefix).len();
    assert_eq!(
        selected_keep,
        longest_fitting.expect("a legal candidate fits")
    );
    assert!(source.starts_with(selected_prefix));
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

fn nested_decorated_resource_input(depth: usize) -> Vec<RichTextNodeInput> {
    let mut node = RichTextNodeInput::Text {
        text: "guard".to_string(),
    };
    for index in 0..depth {
        node = RichTextNodeInput::DecoratedSpan {
            style: rich_style(16.0, "#111111"),
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

#[test]
fn authoritative_layout_rejects_over_depth_rich_input_before_shaping() {
    let font_registry = FontRegistry::new();
    let families = vec!["missing".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let rich_text = nested_decorated_resource_input(MAX_RICH_TEXT_DEPTH + 1);
    let mut request = layout_request("", 100.0);
    request.rich_text = Some(&rich_text);

    assert_eq!(
        layout_text_with_unit_metadata(&request, &font_context)
            .expect_err("over-depth input must fail before recursive flattening"),
        TextLayoutError::RichTextDepthLimit {
            actual: MAX_RICH_TEXT_DEPTH + 1,
            limit: MAX_RICH_TEXT_DEPTH,
        }
    );
}

#[test]
fn authoritative_layout_rejects_inline_rect_resource_exhaustion_before_shaping() {
    let font_registry = FontRegistry::new();
    let families = vec!["missing".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let rich_text = (0..=MAX_INLINE_RECTS)
        .map(|index| RichTextNodeInput::InlineRect {
            rect: InlineRectInput {
                fragment_id: format!("rect-{index}"),
                inline_size_px: 1.0,
                block_size_px: None,
                advance_px: None,
                block_align: None,
                color: "#111111".to_string(),
                border_radius_px: None,
                opacity: None,
                paint_order: None,
            },
        })
        .collect::<Vec<_>>();
    let mut request = layout_request("", 100.0);
    request.rich_text = Some(&rich_text);

    assert_eq!(
        layout_text_with_unit_metadata(&request, &font_context)
            .expect_err("inline-rect exhaustion must fail before materialization"),
        TextLayoutError::InlineRectLimit {
            required: MAX_INLINE_RECTS + 1,
            limit: MAX_INLINE_RECTS,
        }
    );
}

#[test]
fn nested_decorated_spans_fragment_without_losing_either_owner() {
    let font_registry = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let rich_text = vec![RichTextNodeInput::DecoratedSpan {
        style: rich_style(24.0, "#111111"),
        children: vec![RichTextNodeInput::DecoratedSpan {
            style: rich_style(24.0, "#222222"),
            children: vec![RichTextNodeInput::Text {
                text: "あいうえおかきくけこ".to_string(),
            }],
            padding_inline: Some([2.0, 2.0]),
            background: Some("#ffeeaa".to_string()),
            border_color: Some("#aa7700".to_string()),
            border_width: Some(1.0),
            border_radius: Some([3.0; 4]),
            span_key: Some("inner".to_string()),
        }],
        padding_inline: Some([3.0, 3.0]),
        background: Some("#ddeeff".to_string()),
        border_color: Some("#225588".to_string()),
        border_width: Some(1.0),
        border_radius: Some([4.0; 4]),
        span_key: Some("outer".to_string()),
    }];
    let mut request = layout_request("", 58.0);
    request.rich_text = Some(&rich_text);
    request.max_lines = None;
    request.ellipsis = false;

    let layout_result = layout_text_with_unit_metadata(&request, &font_context)
        .expect("nested fragmentable decoration layout");
    let outer_fragments = layout_result
        .inline_box_decorations
        .iter()
        .filter(|decoration| decoration.span_key.as_deref() == Some("outer"))
        .count();
    let inner_fragments = layout_result
        .inline_box_decorations
        .iter()
        .filter(|decoration| decoration.span_key.as_deref() == Some("inner"))
        .count();

    assert!(
        layout_result.lines.len() >= 2,
        "the nested span must remain wrappable"
    );
    assert!(outer_fragments >= 2, "outer owner must fragment per line");
    assert!(inner_fragments >= 2, "inner owner must fragment per line");
    for owner_pair in layout_result.inline_box_decorations.chunks_exact(2) {
        assert_eq!(owner_pair[0].span_key.as_deref(), Some("outer"));
        assert_eq!(owner_pair[1].span_key.as_deref(), Some("inner"));
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
    let layout_result =
        layout_text_with_unit_metadata(&request, &font_context).expect("decorated rich ellipsis");

    let marker = layout_result
        .lines
        .iter()
        .filter_map(|line| line.positioned_glyphs.as_deref())
        .flatten()
        .find(|glyph| glyph.synthetic_kind.as_deref() == Some("ellipsis"))
        .expect("synthetic rich ellipsis glyph");
    assert_eq!(marker.font_size_px, Some(32.0));
    assert_eq!(marker.fill.as_deref(), Some("#0000ff"));
    assert!(
        layout_result
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
                text: missing.repeat(4),
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
    let layout_result =
        layout_text_with_unit_metadata(&request, &font_context).expect("atomic rich ellipsis");

    assert_eq!(layout_result.display_text.as_deref(), Some("A\u{2026}"));
    assert!(layout_result.lines.iter().all(|line| {
        line.positioned_glyphs.as_deref().is_none_or(|glyphs| {
            glyphs
                .iter()
                .all(|glyph| glyph.source_role.as_deref() != Some("rubyAnnotation"))
        })
    }));
    assert!(
        layout_result
            .inline_box_decorations
            .iter()
            .all(|decoration| decoration.span_key.as_deref() != Some("omitted-box"))
    );
    assert!(
        layout_result
            .inline_rects
            .iter()
            .all(|rect| rect.fragment_id != "omitted-rect")
    );
    assert!(
        layout_result.warnings.iter().all(|warning| {
            warning.code != "LONG_RUBY_ANNOTATION" && !warning.message.contains("10FFFF")
        }),
        "omitted atomic descendants must not commit owned warnings: {:?}",
        layout_result.warnings
    );
}

#[test]
fn rich_ellipsis_commits_warning_owned_by_a_retained_atomic_node() {
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
        RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: rich_style(24.0, "#222222"),
            base: vec![RichTextNodeInput::Text {
                text: "A".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "AAAA".to_string(),
                style: rich_style(8.0, "#444444"),
            }],
            rt_levels: Vec::new(),
        },
        RichTextNodeInput::Text {
            text: "BBBBBBBBBBBB".to_string(),
        },
    ];
    let mut request = layout_request("", 80.0);
    request.language = Language::En;
    request.rich_text = Some(&rich_text);

    let layout_result = layout_text_with_unit_metadata(&request, &font_context)
        .expect("retained ruby warning ellipsis layout");

    assert!(
        layout_result
            .display_text
            .as_deref()
            .is_some_and(|display| display.starts_with('A') && display.ends_with('\u{2026}')),
        "the warning-owning ruby must be retained: {:?}",
        layout_result.display_text
    );
    assert!(
        layout_result
            .warnings
            .iter()
            .any(|warning| warning.code == "LONG_RUBY_ANNOTATION"),
        "a warning owned by the retained atomic node must be committed: {:?}",
        layout_result.warnings
    );
}

#[test]
fn synthetic_marker_diagnostics_are_committed() {
    let mut font_registry = FontRegistry::new();
    font_registry
        .register(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../vendor/ttf-parser/tests/fonts/demo.ttf"
            ))
            .expect("single-glyph fixture font"),
            "OnlyA".to_string(),
            400,
            FontStyle::Normal,
        )
        .expect("register single-glyph fixture font");
    let families = vec!["OnlyA".to_string()];
    let font_context = FontContext {
        registry: &font_registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let request = layout_request("AAAAAAAAAAAAAAAA", 40.0);
    let layout_result = layout_text_with_unit_metadata(&request, &font_context)
        .expect("synthetic missing-glyph marker layout");

    assert!(
        layout_result
            .warnings
            .iter()
            .any(|warning| warning.message.contains("U+2026")),
        "the selected synthetic marker must retain its own warning: {:?}",
        layout_result.warnings
    );
    assert!(layout_result.lines.iter().any(|line| {
        line.positioned_glyphs.as_deref().is_some_and(|glyphs| {
            glyphs
                .iter()
                .any(|glyph| glyph.synthetic_kind.as_deref() == Some("ellipsis"))
        })
    }));
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
