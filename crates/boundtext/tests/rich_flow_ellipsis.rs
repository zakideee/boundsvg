//! Public rich-flow ellipsis projection invariants.

#![cfg(test)]

use boundtext::font::shaping::ShapeOptions;
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::flow::{
    FlowBounds, FlowLayoutRequest, FlowRegion, RegionProvider, RegionQuery,
    layout_flow_with_regions, layout_resolved_flow_with_regions,
};
use boundtext::text::types::{
    Language, RichTextNodeInput, RichTextStyleInput, TextWarningCode, WhiteSpaceMode, WrapMode,
    WritingMode,
};

struct RectRegions {
    width: f64,
    height: f64,
}

impl RegionProvider for RectRegions {
    fn regions(
        &self,
        query: RegionQuery,
    ) -> Result<Vec<FlowRegion>, boundtext::RegionProviderError> {
        let (inline_size, cross_limit) = match query.writing_mode {
            WritingMode::HorizontalTb => (self.width, self.height),
            WritingMode::VerticalRl => (self.height, self.width),
        };
        if query.cross_start_px >= 0.0
            && query.cross_end_px <= cross_limit
            && inline_size >= query.min_inline_size_px
        {
            Ok(vec![FlowRegion {
                inline_start_px: 0.0,
                inline_size_px: inline_size,
            }])
        } else {
            Ok(Vec::new())
        }
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
            "Noto".to_string(),
            400,
            FontStyle::Normal,
        )
        .expect("register fixture font");
    registry
}

fn rich_style(color: &str) -> RichTextStyleInput {
    RichTextStyleInput {
        font_family: vec!["Noto".to_string()],
        font_weight: 400,
        font_style: FontStyle::Normal,
        font_size_px: 24.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: Some(0.0),
        language: Some("ja".to_string()),
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
fn rich_flow_ellipsis_is_a_source_less_synthetic_glyph() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    let rich_text = vec![RichTextNodeInput::Text {
        text: "あいうえおかきくけこさしすせそ".to_string(),
    }];
    let regions = RectRegions {
        width: 72.0,
        height: 200.0,
    };
    let request = FlowLayoutRequest {
        text: "",
        font_size_px: 24.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        language: Language::Ja,
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        hanging_punctuation: false,
        flow_bounds: FlowBounds {
            x: 0.0,
            y: 0.0,
            width: regions.width,
            height: regions.height,
        },
        min_region_width: None,
        max_lines: Some(1),
        ellipsis: true,
        fit: None,
        spans: None,
        rich_text: Some(&rich_text),
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: None,
        min_font_size_px: None,
        max_font_size_px: None,
        fit_epsilon_px: None,
        fit_max_iterations: None,
        fit_max_probes: None,
        shape_options: ShapeOptions::default(),
    };

    let flow_layout =
        layout_flow_with_regions(&request, &font_context, &regions).expect("rich flow layout");
    let marker = flow_layout
        .lines
        .iter()
        .flat_map(|line| &line.fragments)
        .flat_map(|fragment| &fragment.positioned_glyphs)
        .find(|glyph| glyph.text == "\u{2026}")
        .expect("ellipsis glyph");

    assert_eq!(marker.synthetic_kind.as_deref(), Some("ellipsis"));
    assert_eq!(marker.source_start, None);
    assert_eq!(marker.source_end, None);
    assert_eq!(marker.source_role, None);
}

#[test]
fn rich_flow_ellipsis_commits_only_retained_authored_node_warnings() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    let mut annotation_style = rich_style("#444444");
    annotation_style.font_size_px = 8.0;
    let rich_text = vec![
        RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: rich_style("#222222"),
            base: vec![RichTextNodeInput::Text {
                text: "A".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "AAAA".to_string(),
                style: annotation_style,
            }],
            rt_levels: Vec::new(),
        },
        RichTextNodeInput::Text {
            text: "BBBBBBBBBBBB".to_string(),
        },
    ];
    let regions = RectRegions {
        width: 80.0,
        height: 100.0,
    };
    let request = FlowLayoutRequest {
        text: "",
        font_size_px: 24.0,
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
            width: regions.width,
            height: regions.height,
        },
        min_region_width: None,
        max_lines: Some(1),
        ellipsis: true,
        fit: None,
        spans: None,
        rich_text: Some(&rich_text),
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: None,
        min_font_size_px: None,
        max_font_size_px: None,
        fit_epsilon_px: None,
        fit_max_iterations: None,
        fit_max_probes: None,
        shape_options: ShapeOptions::default(),
    };

    let flow_layout =
        layout_flow_with_regions(&request, &font_context, &regions).expect("rich flow warnings");
    let display = flow_layout
        .lines
        .iter()
        .flat_map(|line| &line.fragments)
        .map(|fragment| fragment.text.as_str())
        .collect::<String>();

    assert!(display.starts_with('A') && display.ends_with('\u{2026}'));
    assert!(
        flow_layout
            .warnings
            .iter()
            .any(|warning| warning.code == TextWarningCode::LongRubyAnnotation),
        "retained atomic warning must survive flow projection: {:?}",
        flow_layout.warnings
    );
}

#[test]
fn zero_line_rich_flow_discards_omitted_missing_glyph_warnings() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    let rich_text = vec![RichTextNodeInput::Text {
        text: "🦀".to_string(),
    }];
    let regions = RectRegions {
        width: 80.0,
        height: 1.0,
    };
    let request = FlowLayoutRequest {
        text: "",
        font_size_px: 24.0,
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
            width: regions.width,
            height: regions.height,
        },
        min_region_width: None,
        max_lines: Some(1),
        ellipsis: true,
        fit: None,
        spans: None,
        rich_text: Some(&rich_text),
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: None,
        min_font_size_px: None,
        max_font_size_px: None,
        fit_epsilon_px: None,
        fit_max_iterations: None,
        fit_max_probes: None,
        shape_options: ShapeOptions::default(),
    };

    let flow_layout =
        layout_flow_with_regions(&request, &font_context, &regions).expect("zero-line flow");
    assert!(flow_layout.lines.is_empty());
    assert!(
        flow_layout
            .warnings
            .iter()
            .all(|warning| warning.code != TextWarningCode::MissingGlyph),
        "warnings from fully omitted authored content must be discarded: {:?}",
        flow_layout.warnings
    );
}

#[test]
fn resolved_rich_flow_ellipsis_preserves_source_and_display_text() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    let source = "あいうえおかきくけこさしすせそ";
    let rich_text = vec![RichTextNodeInput::Text {
        text: source.to_string(),
    }];
    let regions = RectRegions {
        width: 72.0,
        height: 200.0,
    };
    let request = FlowLayoutRequest {
        text: "",
        font_size_px: 24.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        language: Language::Ja,
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        hanging_punctuation: false,
        flow_bounds: FlowBounds {
            x: 0.0,
            y: 0.0,
            width: regions.width,
            height: regions.height,
        },
        min_region_width: None,
        max_lines: Some(1),
        ellipsis: true,
        fit: None,
        spans: None,
        rich_text: Some(&rich_text),
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: None,
        min_font_size_px: None,
        max_font_size_px: None,
        fit_epsilon_px: None,
        fit_max_iterations: None,
        fit_max_probes: None,
        shape_options: ShapeOptions::default(),
    };

    let layout_result = layout_resolved_flow_with_regions(&request, &font_context, &regions)
        .expect("resolved rich flow ellipsis");
    assert_eq!(layout_result.source_text.as_deref(), Some(source));
    assert!(
        layout_result
            .display_text
            .as_deref()
            .is_some_and(|display| display.ends_with('…') && display != source),
        "projected display text must describe the selected ellipsis output: {:?}",
        layout_result.display_text
    );
}

#[test]
fn rich_flow_rejects_an_unbounded_exact_candidate_set() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    let rich_text = vec![RichTextNodeInput::Text {
        text: "あ".repeat(1_025),
    }];
    let regions = RectRegions {
        width: 72.0,
        height: 200.0,
    };
    let request = FlowLayoutRequest {
        text: "",
        font_size_px: 24.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        language: Language::Ja,
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        hanging_punctuation: false,
        flow_bounds: FlowBounds {
            x: 0.0,
            y: 0.0,
            width: regions.width,
            height: regions.height,
        },
        min_region_width: None,
        max_lines: Some(1),
        ellipsis: true,
        fit: None,
        spans: None,
        rich_text: Some(&rich_text),
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: None,
        min_font_size_px: None,
        max_font_size_px: None,
        fit_epsilon_px: None,
        fit_max_iterations: None,
        fit_max_probes: None,
        shape_options: ShapeOptions::default(),
    };

    let error = layout_flow_with_regions(&request, &font_context, &regions)
        .expect_err("candidate budget must fail before flow projection");
    assert_eq!(
        error,
        boundtext::TextLayoutError::EllipsisCandidateLimit {
            required: 1_026,
            limit: 1_024,
        }
    );
}

#[test]
fn vertical_rich_flow_materializes_nested_owners_but_not_the_omitted_suffix() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    let rich_text = vec![RichTextNodeInput::DecoratedSpan {
        style: rich_style("#111111"),
        children: vec![
            RichTextNodeInput::DecoratedSpan {
                style: rich_style("#222222"),
                children: vec![RichTextNodeInput::Text {
                    text: "あいうえおかきくけこさしすせそ".to_string(),
                }],
                padding_inline: Some([2.0, 2.0]),
                background: Some("#ffeeaa".to_string()),
                border_color: Some("#aa7700".to_string()),
                border_width: Some(1.0),
                border_radius: Some([3.0; 4]),
                span_key: Some("inner-kept".to_string()),
            },
            RichTextNodeInput::DecoratedSpan {
                style: rich_style("#990000"),
                children: vec![RichTextNodeInput::Text {
                    text: "省略される末尾".to_string(),
                }],
                padding_inline: Some([2.0, 2.0]),
                background: Some("#ffdddd".to_string()),
                border_color: None,
                border_width: None,
                border_radius: None,
                span_key: Some("omitted-owner".to_string()),
            },
        ],
        padding_inline: Some([3.0, 3.0]),
        background: Some("#ddeeff".to_string()),
        border_color: Some("#225588".to_string()),
        border_width: Some(1.0),
        border_radius: Some([4.0; 4]),
        span_key: Some("outer-kept".to_string()),
    }];
    let regions = RectRegions {
        width: 120.0,
        height: 72.0,
    };
    let request = FlowLayoutRequest {
        text: "",
        font_size_px: 24.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        language: Language::Ja,
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        hanging_punctuation: false,
        flow_bounds: FlowBounds {
            x: 0.0,
            y: 0.0,
            width: regions.width,
            height: regions.height,
        },
        min_region_width: None,
        max_lines: Some(1),
        ellipsis: true,
        fit: None,
        spans: None,
        rich_text: Some(&rich_text),
        writing_mode: WritingMode::VerticalRl,
        text_orientation: None,
        min_font_size_px: None,
        max_font_size_px: None,
        fit_epsilon_px: None,
        fit_max_iterations: None,
        fit_max_probes: None,
        shape_options: ShapeOptions::default(),
    };

    let flow_layout =
        layout_flow_with_regions(&request, &font_context, &regions).expect("vertical rich flow");
    let keys = flow_layout
        .inline_box_decorations
        .iter()
        .filter_map(|decoration| decoration.span_key.as_deref())
        .collect::<Vec<_>>();
    let marker = flow_layout
        .lines
        .iter()
        .flat_map(|line| &line.fragments)
        .flat_map(|fragment| &fragment.positioned_glyphs)
        .find(|glyph| glyph.synthetic_kind.as_deref() == Some("ellipsis"))
        .expect("synthetic ellipsis");

    assert_eq!(marker.text, "\u{2026}");
    assert!(keys.contains(&"outer-kept"));
    assert!(keys.contains(&"inner-kept"));
    assert!(!keys.contains(&"omitted-owner"));
}
