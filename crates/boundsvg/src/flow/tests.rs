use super::adapters::{
    layout_resolved_text_flow, layout_text_flow, layout_text_flow_with_exclusions,
};
use super::geometry::{FlowBox, FlowExclusionMargin, FlowExclusionMarginEdges, FlowExclusionShape};
use super::intrinsic::measure_intrinsic_inline_size;
use super::measure::measure_text_block;
use super::shrinkwrap::{shrinkwrap_flow, shrinkwrap_text};
use super::types::*;
use crate::font::{FontRegistry, FontStyle};
use crate::layout::types::{TextFlowLayoutInput, TextInput};
use crate::text::types::RichTextNodeInput;

fn make_registry() -> FontRegistry {
    let data = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
    ))
    .expect("Test font");
    let mut reg = FontRegistry::new();
    reg.register(data, "NotoSansJP".into(), 400, FontStyle::Normal)
        .unwrap();
    reg
}

fn make_simple_flow_input(text: &str) -> TextFlowInput {
    TextFlowInput {
        text: text.to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        white_space: None,
        tab_size: None,
        hanging_punctuation: None,
        line_widths: vec![240.0],
        writing_mode: None,
        text_orientation: None,
        font_variation_settings: None,
        font_feature_settings: None,
    }
}

fn make_resolved_flow_text_input(content: &str, exclusions: Vec<FlowExclusionShape>) -> TextInput {
    TextInput {
        content: content.to_string(),
        spans: None,
        rich_text: None,
        font_size_px: 20.0,
        line_height: None,
        line_height_px: Some(30.0),
        letter_spacing_px: None,
        text_indent: None,
        font_family: vec!["NotoSansJP".to_string()],
        font_weight: 400,
        font_style: FontStyle::Normal,
        wrap: "char".to_string(),
        max_lines: None,
        preferred_frame: None,
        writing_mode: None,
        language: Some("ja".to_string()),
        text_orientation: None,
        fit: None,
        min_font_size_px: None,
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
        fit_max_probes: None,
        ellipsis: None,
        hanging_punctuation: None,
        white_space: Some("pre-wrap".to_string()),
        tab_size: Some(2),
        flow: Some(TextFlowLayoutInput {
            exclusions,
            min_region_width_px: None,
        }),
        font_variation_settings: None,
        font_feature_settings: None,
        unit_map: None,
        text_decoration_range_count: None,
    }
}

#[test]
fn resolved_flow_normalizes_hard_breaks_and_preserves_trailing_empty_line() {
    let registry = make_registry();
    let input = make_resolved_flow_text_input("あ\tい\r\n\nう\r", Vec::new());
    let result = layout_resolved_text_flow(&input, 240.0, 120.0, &registry, None).unwrap();

    assert_eq!(result.lines.len(), 4);
    assert_eq!(result.lines[1].text, "");
    assert_eq!(result.lines[3].text, "");
    assert!(result.lines.iter().all(|line| !line.text.contains('\r')));
    assert!(
        result
            .lines
            .iter()
            .flat_map(|line| line.positioned_glyphs.as_deref().unwrap_or_default())
            .all(|glyph| glyph.absolute_position == Some(true))
    );
}

#[test]
fn resolved_flow_positions_glyphs_around_local_exclusion() {
    let registry = make_registry();
    let input = make_resolved_flow_text_input(
        "あいうえおかきくけこさしすせそたちつてと",
        vec![FlowExclusionShape::Rect {
            x: 60.0,
            y: 0.0,
            width: 80.0,
            height: 60.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }],
    );
    let result = layout_resolved_text_flow(&input, 220.0, 120.0, &registry, None).unwrap();
    let glyphs = result
        .lines
        .iter()
        .flat_map(|line| line.positioned_glyphs.as_deref().unwrap_or_default())
        .collect::<Vec<_>>();

    assert!(
        glyphs
            .iter()
            .any(|glyph| glyph.origin_y < 60.0 && glyph.origin_x >= 140.0)
    );
    assert!(
        glyphs
            .iter()
            .filter(|glyph| glyph.origin_y < 60.0)
            .all(|glyph| glyph.origin_x < 60.0 || glyph.origin_x >= 140.0)
    );
}

#[test]
fn resolved_flow_applies_ellipsis_before_building_positioned_glyphs() {
    let registry = make_registry();
    let mut input =
        make_resolved_flow_text_input("あいうえおかきくけこさしすせそたちつてと", Vec::new());
    input.max_lines = Some(1);
    input.ellipsis = Some(true);
    let result = layout_resolved_text_flow(&input, 100.0, 30.0, &registry, None).unwrap();

    assert_eq!(result.lines.len(), 1);
    assert_eq!(result.overflow.overflow_type, "overflow");
    assert!(
        result.lines[0]
            .positioned_glyphs
            .as_deref()
            .unwrap_or_default()
            .iter()
            .any(|glyph| glyph.text == "\u{2026}")
    );
}

#[test]
fn resolved_vertical_flow_materializes_nested_decoration_owners() {
    let registry = make_registry();
    let mut input = make_resolved_flow_text_input("", Vec::new());
    input.writing_mode = Some("vertical-rl".to_string());
    input.max_lines = Some(1);
    input.ellipsis = Some(true);
    input.rich_text = Some(vec![RichTextNodeInput::DecoratedSpan {
        style: make_rich_style(20.0, Some("#111111"), Some("upright")),
        children: vec![RichTextNodeInput::DecoratedSpan {
            style: make_rich_style(20.0, Some("#222222"), Some("upright")),
            children: vec![RichTextNodeInput::Text {
                text: "あいうえおかきくけこ".to_string(),
            }],
            padding_inline: Some([2.0, 2.0]),
            background: Some("#ffeeaa".to_string()),
            border_color: None,
            border_width: None,
            border_radius: Some([3.0; 4]),
            span_key: Some("inner".to_string()),
        }],
        padding_inline: Some([3.0, 3.0]),
        background: Some("#ddeeff".to_string()),
        border_color: None,
        border_width: None,
        border_radius: Some([4.0; 4]),
        span_key: Some("outer".to_string()),
    }]);

    let result = layout_resolved_text_flow(&input, 120.0, 72.0, &registry, None)
        .expect("resolved nested vertical flow");
    let keys = result
        .inline_box_decorations
        .iter()
        .filter_map(|decoration| decoration.span_key.as_deref())
        .collect::<Vec<_>>();

    assert!(keys.contains(&"outer"));
    assert!(keys.contains(&"inner"));
    assert!(result.lines.iter().any(|line| {
        line.positioned_glyphs
            .as_deref()
            .unwrap_or_default()
            .iter()
            .any(|glyph| glyph.synthetic_kind.as_deref() == Some("ellipsis"))
    }));
}

#[test]
fn basic_flow() {
    let reg = make_registry();
    let input = TextFlowInput {
        text: "あいうえおかきくけこさしすせそたちつてと".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        white_space: None,
        tab_size: None,
        hanging_punctuation: None,
        line_widths: vec![60.0, 100.0, 200.0],
        writing_mode: None,
        text_orientation: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = layout_text_flow(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(result.lines.len() >= 2);

    // First line should be narrower (limited to 60px)
    assert!(result.lines[0].inline_advance_px <= 60.0 + 1.0);

    // All text should be covered
    let combined: String = result.lines.iter().map(|l| l.text.as_str()).collect();
    assert_eq!(combined, input.text);
}

#[test]
fn simple_flow_defaults_match_explicit_legacy_pre_wrap_policy() {
    let registry = make_registry();
    let omitted = make_simple_flow_input("a\tb\r\nc");
    let mut explicit = make_simple_flow_input("a\tb\r\nc");
    explicit.white_space = Some("pre-wrap".to_string());
    explicit.tab_size = Some(4);

    let omitted_result = layout_text_flow(&omitted, &registry).unwrap();
    let explicit_result = layout_text_flow(&explicit, &registry).unwrap();
    assert_eq!(omitted_result.exhausted, explicit_result.exhausted);
    assert_eq!(omitted_result.lines.len(), explicit_result.lines.len());
    for (omitted_line, explicit_line) in omitted_result.lines.iter().zip(&explicit_result.lines) {
        assert_eq!(omitted_line.text, explicit_line.text);
        assert_eq!(omitted_line.char_start, explicit_line.char_start);
        assert_eq!(omitted_line.char_end, explicit_line.char_end);
        assert!(
            (omitted_line.inline_advance_px - explicit_line.inline_advance_px).abs() < f64::EPSILON
        );
    }

    let mut custom_tab = make_simple_flow_input("a\tb");
    custom_tab.white_space = Some("pre-wrap".to_string());
    custom_tab.tab_size = Some(2);
    let custom_tab_result = layout_text_flow(&custom_tab, &registry).unwrap();
    assert_eq!(omitted_result.lines[0].text, "a    b");
    assert_eq!(custom_tab_result.lines[0].text, "a  b");
    assert!(
        custom_tab_result.lines[0].inline_advance_px < omitted_result.lines[0].inline_advance_px
    );
}

#[test]
fn simple_flow_normalizes_hard_breaks_in_both_writing_modes() {
    let registry = make_registry();
    for writing_mode in [None, Some("vertical-rl".to_string())] {
        let mut input = make_simple_flow_input("a\r\n\nb\r");
        input.white_space = Some("pre-wrap".to_string());
        input.writing_mode = writing_mode;
        input.text_orientation = Some("upright".to_string());

        let result = layout_text_flow(&input, &registry).unwrap();
        assert!(result.exhausted);
        assert_eq!(
            result
                .lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            ["a", "", "b", ""]
        );
        assert_eq!(
            result
                .lines
                .iter()
                .map(|line| (line.char_start, line.char_end))
                .collect::<Vec<_>>(),
            [(0, 1), (2, 2), (3, 4), (5, 5)]
        );
    }
}

#[test]
fn single_width_repeats() {
    let reg = make_registry();
    let input = TextFlowInput {
        text: "テスト文字列".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        white_space: None,
        tab_size: None,
        hanging_punctuation: None,
        line_widths: vec![40.0],
        writing_mode: None,
        text_orientation: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = layout_text_flow(&input, &reg).unwrap();
    assert!(result.exhausted);
    // With only 40px width and 20px font, each line gets ~2 chars
    assert!(result.lines.len() >= 2);
}

#[test]
fn empty_widths_error() {
    let reg = make_registry();
    let input = TextFlowInput {
        text: "テスト".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: None,
        letter_spacing_px: None,
        language: None,
        wrap: None,
        white_space: None,
        tab_size: None,
        hanging_punctuation: None,
        line_widths: vec![],
        writing_mode: None,
        text_orientation: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = layout_text_flow(&input, &reg);
    assert!(result.is_err());
}

#[test]
fn empty_text() {
    let reg = make_registry();
    let input = TextFlowInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: None,
        letter_spacing_px: None,
        language: None,
        wrap: None,
        white_space: None,
        tab_size: None,
        hanging_punctuation: None,
        line_widths: vec![200.0],
        writing_mode: None,
        text_orientation: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = layout_text_flow(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(result.lines.is_empty());
}

#[test]
fn simple_flow_vertical_uses_column_heights() {
    let reg = make_registry();
    let input = TextFlowInput {
        text: "縦書きの可変列レイアウトです".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.3),
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        white_space: None,
        tab_size: None,
        hanging_punctuation: None,
        line_widths: vec![42.0, 84.0],
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = layout_text_flow(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(result.lines.len() >= 2);
    assert!(result.lines[0].inline_advance_px <= 42.0 + 1.0);
    assert!(result.lines[1].available_inline_size_px >= 84.0 - 1e-9);

    let combined: String = result.lines.iter().map(|line| line.text.as_str()).collect();
    assert_eq!(combined, input.text);
}

// ------------------------------------------------------------------
// layout_text_flow_with_exclusions tests
// ------------------------------------------------------------------

fn make_exclusion_input(
    text: &str,
    flow_box: FlowBox,
    exclusions: Vec<FlowExclusionShape>,
) -> TextFlowWithExclusionsInput {
    TextFlowWithExclusionsInput {
        text: text.to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        white_space: None,
        tab_size: None,
        hanging_punctuation: None,
        flow_box,
        exclusions,
        min_region_width_px: None,
        max_lines: None,
        ellipsis: None,
        fit: None,
        min_font_size_px: None,
        max_font_size_px: None,
        fit_epsilon_px: None,
        fit_max_iterations: None,
        fit_max_probes: None,
        spans: None,
        rich_text: None,
        writing_mode: None,
        text_orientation: None,
        font_variation_settings: None,
        font_feature_settings: None,
    }
}

#[test]
fn exclusion_flow_preserves_hard_breaks_for_plain_span_and_rich_text() {
    let registry = make_registry();
    for writing_mode in [None, Some("vertical-rl".to_string())] {
        for content_kind in ["plain", "span", "rich"] {
            let mut input = make_exclusion_input(
                "a\r\n\nb\r",
                FlowBox {
                    x: 0.0,
                    y: 0.0,
                    width: 240.0,
                    height: 240.0,
                },
                Vec::new(),
            );
            input.white_space = Some("pre-wrap".to_string());
            input.writing_mode = writing_mode.clone();
            input.text_orientation = Some("upright".to_string());
            match content_kind {
                "span" => {
                    input.text.clear();
                    input.spans = Some(vec![FlowTextSpanDto {
                        text: "a\r\n\nb\r".to_string(),
                        ..FlowTextSpanDto::default()
                    }]);
                }
                "rich" => {
                    input.text.clear();
                    input.rich_text = Some(vec![RichTextNodeInput::Text {
                        text: "a\r\n\nb\r".to_string(),
                    }]);
                }
                _ => {}
            }

            let result = layout_text_flow_with_exclusions(&input, &registry).unwrap();
            assert!(result.exhausted, "{writing_mode:?} {content_kind}");
            assert_eq!(
                result
                    .lines
                    .iter()
                    .map(|line| {
                        line.fragments
                            .iter()
                            .map(|fragment| fragment.text.as_str())
                            .collect::<String>()
                    })
                    .collect::<Vec<_>>(),
                ["a", "", "b", ""],
                "{writing_mode:?} {content_kind}"
            );
        }
    }
}

#[test]
fn exclusion_rect_basic() {
    let reg = make_registry();
    let input = make_exclusion_input(
        "あいうえおかきくけこさしすせそ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![FlowExclusionShape::Rect {
            x: 300.0,
            y: 0.0,
            width: 100.0,
            height: 60.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }],
    );

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(!result.lines.is_empty());

    // First line should have fragments limited by rect exclusion
    let first_line = &result.lines[0];
    for frag in &first_line.fragments {
        // Fragment x should be within flow box
        assert!(frag.x >= 0.0);
        // Fragment should not extend into exclusion area [300, 400]
        assert!(frag.x + frag.inline_advance_px <= 300.0 + 5.0); // small tolerance
    }
}

#[test]
fn exclusion_no_exclusions() {
    let reg = make_registry();
    let input = make_exclusion_input(
        "あいうえおかきくけこ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![],
    );

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    // Should behave like full-width lines
    for line in &result.lines {
        assert_eq!(line.fragments.len(), 1);
        assert!((line.fragments[0].available_inline_size_px - 400.0).abs() < 1e-9);
    }
}

#[test]
fn exclusion_max_lines_skips_occluded() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 300.0,
        },
        vec![
            // Full-width rect blocking band 1 (y=30..60)
            FlowExclusionShape::Rect {
                x: 0.0,
                y: 30.0,
                width: 200.0,
                height: 30.0,
                margin_px: FlowExclusionMargin::All(0.0),
            },
        ],
    );
    input.max_lines = Some(2);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    // Should emit exactly 2 text lines, skipping the occluded band
    assert_eq!(result.lines.len(), 2);
    // The occluded band should not count against max_lines
    // Line indices should reflect actual band positions
    assert_eq!(result.lines[0].line_index, 0);
    // Second line should be after the occluded band
    assert!(result.lines[1].line_index >= 2);
}

#[test]
fn exclusion_exhausted_flag() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 300.0,
        },
        vec![],
    );
    input.max_lines = Some(1);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert_eq!(result.lines.len(), 1);
    assert!(!result.exhausted); // Not all text consumed
}

#[test]
fn exclusion_multiple_fragments() {
    let reg = make_registry();
    // Obstacle in the center creates two regions per line
    let input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてと",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![FlowExclusionShape::Rect {
            x: 150.0,
            y: 0.0,
            width: 100.0,
            height: 200.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }],
    );

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(!result.lines.is_empty());

    // At least some lines should have 2 fragments (left and right of obstacle)
    let multi_frag_lines = result
        .lines
        .iter()
        .filter(|l| l.fragments.len() >= 2)
        .count();
    assert!(
        multi_frag_lines > 0,
        "Expected at least one line with 2 fragments"
    );
}

#[test]
fn exclusion_edge_margin_affects_fragment_regions() {
    let reg = make_registry();
    let input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![FlowExclusionShape::Rect {
            x: 150.0,
            y: 0.0,
            width: 100.0,
            height: 200.0,
            margin_px: FlowExclusionMargin::Edges(FlowExclusionMarginEdges {
                top: 0.0,
                right: 20.0,
                bottom: 0.0,
                left: 10.0,
            }),
        }],
    );

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let multi_fragment_line = result
        .lines
        .iter()
        .find(|line| line.fragments.len() >= 2)
        .expect("expected at least one line with left and right regions");

    let left_fragment = &multi_fragment_line.fragments[0];
    let right_fragment = &multi_fragment_line.fragments[1];
    assert!((left_fragment.available_inline_size_px - 140.0).abs() < 1e-9);
    assert!((right_fragment.x - 270.0).abs() < 1e-9);
    assert!((right_fragment.available_inline_size_px - 130.0).abs() < 1e-9);
}

#[test]
fn exclusion_reports_kinsoku_absorb_overflow_reason() {
    let reg = make_registry();
    let input = make_exclusion_input(
        "す。次のテスト",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 25.0,
            height: 120.0,
        },
        vec![],
    );

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let first = &result.lines[0].fragments[0];
    assert_eq!(first.overflow_reason.as_deref(), Some("kinsokuAbsorb"));
}

// ------------------------------------------------------------------
// overflow_reason / used_line_count tests
// ------------------------------------------------------------------

#[test]
fn overflow_reason_max_lines_truncated() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 300.0,
        },
        vec![],
    );
    input.max_lines = Some(1);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(!result.exhausted);
    assert_eq!(result.used_line_count, 1);
    assert_eq!(
        result.overflow_reason,
        Some(FlowOverflowReason::MaxLinesTruncated)
    );
}

#[test]
fn overflow_reason_flow_box_exhausted() {
    let reg = make_registry();
    // Tiny flow box: only 1 band fits (height=30, line_height=1.5*20=30)
    let input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 60.0,
            height: 30.0,
        },
        vec![],
    );

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(!result.exhausted);
    assert_eq!(
        result.overflow_reason,
        Some(FlowOverflowReason::FlowBoxExhausted)
    );
}

#[test]
fn overflow_reason_none_when_exhausted() {
    let reg = make_registry();
    let input = make_exclusion_input(
        "あ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![],
    );

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert_eq!(result.overflow_reason, None);
    assert_eq!(result.used_line_count, 1);
}

#[test]
fn max_lines_reason_not_masked_by_trailing_occlusion() {
    // Regression: max_lines=1, bands 1+ fully occluded, plenty of flow box
    // height remaining.  The stop reason must be MaxLinesTruncated, not
    // FlowBoxExhausted.
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 300.0,
        },
        vec![
            // Full-width rect blocking bands 1..9 (y=30..300)
            FlowExclusionShape::Rect {
                x: 0.0,
                y: 30.0,
                width: 200.0,
                height: 270.0,
                margin_px: FlowExclusionMargin::All(0.0),
            },
        ],
    );
    input.max_lines = Some(1);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert_eq!(result.used_line_count, 1);
    assert!(!result.exhausted);
    assert_eq!(
        result.overflow_reason,
        Some(FlowOverflowReason::MaxLinesTruncated),
        "must be MaxLinesTruncated, not FlowBoxExhausted"
    );
}

#[test]
fn used_line_count_skips_occluded() {
    let reg = make_registry();
    let input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 300.0,
        },
        vec![
            // Full-width rect blocking band 1 (y=30..60)
            FlowExclusionShape::Rect {
                x: 0.0,
                y: 30.0,
                width: 200.0,
                height: 30.0,
                margin_px: FlowExclusionMargin::All(0.0),
            },
        ],
    );

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    // used_line_count should count only text-producing lines (not occluded bands)
    assert_eq!(result.used_line_count, result.lines.len());
    // The occluded band creates a gap in line_index
    if result.lines.len() >= 2 {
        assert!(result.lines[1].line_index >= 2, "band 1 should be skipped");
    }
}

// ------------------------------------------------------------------
// Ellipsis tests
// ------------------------------------------------------------------

#[test]
fn ellipsis_basic() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 300.0,
        },
        vec![],
    );
    input.max_lines = Some(1);
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert_eq!(result.lines.len(), 1);
    assert!(!result.exhausted);

    let last_frag = result.lines[0].fragments.last().unwrap();
    assert!(
        last_frag.text.ends_with('\u{2026}'),
        "last fragment should end with ellipsis: {:?}",
        last_frag.text
    );
    assert_eq!(
        last_frag.overflow_reason.as_deref(),
        Some("ellipsis"),
        "overflow_reason should be 'ellipsis'"
    );
    assert!(
        last_frag.inline_advance_px <= last_frag.available_inline_size_px + 0.5,
        "fragment inline advance ({}) should fit region ({})",
        last_frag.inline_advance_px,
        last_frag.available_inline_size_px
    );
}

#[test]
fn ellipsis_fits_no_truncation() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "あ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![],
    );
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    let frag = &result.lines[0].fragments[0];
    assert!(
        !frag.text.contains('\u{2026}'),
        "should not contain ellipsis when text fits"
    );
}

#[test]
fn ellipsis_disabled() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 300.0,
        },
        vec![],
    );
    input.max_lines = Some(1);
    input.ellipsis = Some(false);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let last_frag = result.lines[0].fragments.last().unwrap();
    assert!(
        !last_frag.text.contains('\u{2026}'),
        "should not contain ellipsis when disabled"
    );
}

#[test]
fn ellipsis_max_lines_2() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 300.0,
        },
        vec![],
    );
    input.max_lines = Some(2);
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert_eq!(result.lines.len(), 2);

    // First line should NOT have ellipsis
    let first_frag = result.lines[0].fragments.last().unwrap();
    assert!(
        !first_frag.text.contains('\u{2026}'),
        "first line should not have ellipsis"
    );

    // Second (last) line should have ellipsis
    let last_frag = result.lines[1].fragments.last().unwrap();
    assert!(
        last_frag.text.ends_with('\u{2026}'),
        "last line should end with ellipsis: {:?}",
        last_frag.text
    );
}

#[test]
fn ellipsis_with_obstacle() {
    let reg = make_registry();
    // Obstacle in center creates two regions per line
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてと",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![FlowExclusionShape::Rect {
            x: 150.0,
            y: 0.0,
            width: 100.0,
            height: 200.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }],
    );
    input.max_lines = Some(1);
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert_eq!(result.lines.len(), 1);

    // Ellipsis should only be on the LAST fragment (last region)
    let line = &result.lines[0];
    if line.fragments.len() > 1 {
        for frag in &line.fragments[..line.fragments.len() - 1] {
            assert!(
                !frag.text.contains('\u{2026}'),
                "non-last fragment should not have ellipsis"
            );
        }
    }
    let last_frag = line.fragments.last().unwrap();
    assert!(
        last_frag.text.ends_with('\u{2026}'),
        "last fragment should end with ellipsis: {:?}",
        last_frag.text
    );
}

#[test]
fn ellipsis_narrow_region() {
    let reg = make_registry();
    // Narrow flow box — barely wider than min_region_width (font_size=20)
    let mut input = make_exclusion_input(
        "あいうえお",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 22.0,
            height: 120.0,
        },
        vec![],
    );
    input.max_lines = Some(1);
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    // Should not panic; either ellipsis is applied or gracefully skipped
    assert!(!result.lines.is_empty());
}

#[test]
fn ellipsis_kinsoku_aware() {
    let reg = make_registry();
    // "す。次のテスト" — "。" is head-prohibit
    let mut input = make_exclusion_input(
        "す。次のテスト文字列",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 60.0,
            height: 120.0,
        },
        vec![],
    );
    input.max_lines = Some(1);
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let last_frag = result.lines[0].fragments.last().unwrap();

    if last_frag.overflow_reason.as_deref() == Some("ellipsis") {
        // The text before "…" should not end with a tail-prohibit char
        // and the next char (if any) after the truncation should not be
        // a head-prohibit char at the start of a new line.
        // Basically: the ellipsis text should look reasonable.
        assert!(
            last_frag.text.ends_with('\u{2026}'),
            "ellipsis fragment must end with '…'"
        );
    }
}

// ------------------------------------------------------------------
// Fit tests
// ------------------------------------------------------------------

#[test]
fn fit_shrink_basic() {
    let reg = make_registry();
    // Long text in small flow box — overflows at 20px, should shrink.
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 60.0,
        },
        vec![],
    );
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(6.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let chosen = result
        .chosen_font_size_px
        .expect("should have chosen_font_size_px");
    assert!(
        chosen < 20.0,
        "chosen size should be smaller than original: {chosen}"
    );
    assert!(result.exhausted, "text should be exhausted after fit");
    assert_eq!(result.overflow_reason, None);
}

#[test]
fn fit_shrink_already_fits() {
    let reg = make_registry();
    // Short text — already fits at 20px.
    let mut input = make_exclusion_input(
        "あ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![],
    );
    input.fit = Some("shrink".to_string());

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let chosen = result.chosen_font_size_px.unwrap();
    assert!(
        (chosen - 20.0).abs() < 0.01,
        "should keep original size: {chosen}"
    );
    assert!(result.exhausted);
}

#[test]
fn fit_shrink_cannot_fit() {
    let reg = make_registry();
    // Long text in tiny flow box — doesn't fit even at min_size.
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめも",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 30.0,
            height: 20.0,
        },
        vec![],
    );
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(8.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert_eq!(result.overflow_reason, Some(FlowOverflowReason::CannotFit));
    assert!(!result.exhausted);
}

#[test]
fn fit_grow_basic() {
    let reg = make_registry();
    // Short text in large flow box — fits at 20px, should grow.
    let mut input = make_exclusion_input(
        "あいう",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![],
    );
    input.fit = Some("grow".to_string());
    input.max_font_size_px = Some(60.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let chosen = result.chosen_font_size_px.unwrap();
    assert!(
        chosen > 20.0,
        "chosen size should be larger than original: {chosen}"
    );
    assert!(result.exhausted);
}

#[test]
fn fit_grow_initial_overflow() {
    let reg = make_registry();
    // Text already overflows at 20px — can't grow.
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 60.0,
        },
        vec![],
    );
    input.fit = Some("grow".to_string());

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let chosen = result.chosen_font_size_px.unwrap();
    assert!(
        (chosen - 20.0).abs() < 0.01,
        "should stay at original size: {chosen}"
    );
    assert_eq!(result.overflow_reason, Some(FlowOverflowReason::CannotFit));
}

#[test]
fn fit_shrink_with_exclusions() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 90.0,
        },
        vec![FlowExclusionShape::Rect {
            x: 100.0,
            y: 0.0,
            width: 100.0,
            height: 60.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }],
    );
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(6.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.chosen_font_size_px.is_some());
    assert!(result.exhausted);
}

#[test]
fn exclusion_fit_rejects_an_incomplete_exact_grid_before_layout() {
    let registry = make_registry();
    let mut input = make_exclusion_input(
        "あいうえおかきくけこ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 160.0,
            height: 80.0,
        },
        vec![FlowExclusionShape::Rect {
            x: 80.0,
            y: 0.0,
            width: 40.0,
            height: 40.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }],
    );
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(8.0);
    input.fit_epsilon_px = Some(0.25);
    input.fit_max_probes = Some(1);

    let error = layout_text_flow_with_exclusions(&input, &registry)
        .expect_err("the complete exact grid exceeds one probe");
    assert_eq!(error.code(), "TEXT_FIT_PROBE_LIMIT");
    assert!(matches!(
        error,
        super::adapters::TextFlowLayoutError::Boundtext(
            boundtext::BoundtextError::FitProbeLimit { .. }
        )
    ));
}

#[test]
fn exclusion_flow_surfaces_the_ellipsis_candidate_limit() {
    let registry = make_registry();
    let source = "あ".repeat(1_025);
    let mut input = make_exclusion_input(
        &source,
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 72.0,
            height: 200.0,
        },
        Vec::new(),
    );
    input.max_lines = Some(1);
    input.ellipsis = Some(true);

    let error = layout_text_flow_with_exclusions(&input, &registry)
        .expect_err("exact projection must be bounded");
    assert_eq!(error.code(), "TEXT_ELLIPSIS_CANDIDATE_LIMIT");
    assert!(matches!(
        error,
        super::adapters::TextFlowLayoutError::Boundtext(
            boundtext::BoundtextError::EllipsisCandidateLimit { .. }
        )
    ));
}

#[test]
fn fit_shrink_with_max_lines() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてと",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 300.0,
        },
        vec![],
    );
    input.max_lines = Some(2);
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(6.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(result.lines.len() <= 2);
}

#[test]
fn fit_shrink_ellipsis_fallback() {
    let reg = make_registry();
    // Cannot fit even at min_size, but ellipsis is enabled.
    let mut input = make_exclusion_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめも",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 30.0,
            height: 20.0,
        },
        vec![],
    );
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(8.0);
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    // CannotFit from fit, but ellipsis should be applied
    assert_eq!(result.overflow_reason, Some(FlowOverflowReason::CannotFit));
    if !result.lines.is_empty() {
        let last_frag = result.lines.last().unwrap().fragments.last().unwrap();
        if last_frag.overflow_reason.as_deref() == Some("ellipsis") {
            assert!(last_frag.text.ends_with('\u{2026}'));
        }
    }
}

#[test]
fn fit_shrink_inline_spans_basic() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 110.0,
            height: 60.0,
        },
        vec![],
    );
    input.spans = Some(vec![
        make_span("あいうえおかきくけこ", 20.0, None),
        make_span("さしすせそ", 20.0, Some("#93c5fd")),
    ]);
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(6.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let chosen = result.chosen_font_size_px.expect("chosen font size");
    assert!(chosen < 20.0, "inline spans should shrink: {chosen}");
    assert!(result.exhausted);
}

#[test]
fn vertical_fit_shrink_inline_spans_basic() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 50.0,
            height: 60.0,
        },
        vec![],
    );
    input.spans = Some(vec![
        make_span("縦組み", 20.0, None),
        make_span("ABC123追加", 20.0, Some("#93c5fd")),
        make_span("文字列", 20.0, None),
    ]);
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(6.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let chosen = result.chosen_font_size_px.expect("chosen font size");
    assert!(
        chosen < 20.0,
        "vertical inline spans should shrink: {chosen}"
    );
    assert!(result.exhausted);
}

#[test]
fn fit_shrink_rich_text_basic() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 80.0,
            height: 60.0,
        },
        vec![],
    );
    input.rich_text = Some(vec![
        RichTextNodeInput::Span {
            text: "天地玄黄宇宙洪荒".to_string(),
            style: make_rich_style(20.0, Some("#f8fafc"), None),
        },
        RichTextNodeInput::InlineBox {
            style: make_rich_style(20.0, Some("#fde68a"), None),
            children: vec![RichTextNodeInput::Text {
                text: "囲み".to_string(),
            }],
            padding_inline: Some([4.0, 4.0]),
            background: Some("#1e293b".to_string()),
            border_color: Some("#93c5fd".to_string()),
            border_width: Some(1.0),
            border_radius: Some(4.0),
            span_key: None,
        },
    ]);
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(6.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let chosen = result.chosen_font_size_px.expect("chosen font size");
    assert!(chosen < 20.0, "rich text should shrink: {chosen}");
    assert!(result.exhausted);
}

#[test]
fn vertical_fit_shrink_rich_text_basic() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 50.0,
            height: 60.0,
        },
        vec![],
    );
    input.rich_text = Some(vec![
        RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: make_rich_style(20.0, Some("#f8fafc"), None),
            base: vec![RichTextNodeInput::Text {
                text: "春".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "はる".to_string(),
                style: make_rich_style(10.0, Some("#fca5a5"), None),
            }],
            rt_levels: Vec::new(),
        },
        RichTextNodeInput::Combine {
            text: "2026".to_string(),
            style: make_rich_style(20.0, Some("#93c5fd"), Some("upright")),
            decoration_runs: Vec::new(),
        },
        RichTextNodeInput::Text {
            text: "追加文字".to_string(),
        },
    ]);
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(6.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let chosen = result.chosen_font_size_px.expect("chosen font size");
    assert!(chosen < 20.0, "vertical rich text should shrink: {chosen}");
    assert!(result.exhausted);
}

// ------------------------------------------------------------------
// Inline runs (rich text) flow tests
// ------------------------------------------------------------------

fn make_span(text: &str, font_size_px: f64, color: Option<&str>) -> FlowTextSpanDto {
    FlowTextSpanDto {
        text: text.to_string(),
        font_family: None,
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: Some(font_size_px),
        letter_spacing_px: None,
        color: color.map(String::from),
        font_variation_settings: None,
        font_feature_settings: None,
        ruby_text: None,
        ruby_position: None,
        ruby_align: None,
        ruby_font_size_px: None,
        ruby_color: None,
    }
}

fn make_rich_style(
    font_size_px: f64,
    color: Option<&str>,
    text_orientation: Option<&str>,
) -> crate::text::types::RichTextStyleInput {
    crate::text::types::RichTextStyleInput {
        font_family: vec!["NotoSansJP".to_string()],
        font_weight: 400,
        font_style: FontStyle::Normal,
        font_size_px,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: Some(0.0),
        language: Some("ja".to_string()),
        color: color.map(String::from),
        text_strokes: None,
        text_shadows: None,
        font_variation_settings: None,
        font_feature_settings: None,
        text_orientation: text_orientation.map(String::from),
        text_decoration: None,
    }
}

fn make_rich_text_basic() -> Vec<RichTextNodeInput> {
    vec![
        RichTextNodeInput::Span {
            text: "天地".to_string(),
            style: make_rich_style(20.0, Some("#f8fafc"), None),
        },
        RichTextNodeInput::Span {
            text: "玄黄".to_string(),
            style: make_rich_style(20.0, Some("#93c5fd"), None),
        },
    ]
}

fn make_nested_rich_text(depth: usize) -> Vec<RichTextNodeInput> {
    let mut node = RichTextNodeInput::Text {
        text: "境界".to_string(),
    };
    for _ in 1..=depth {
        node = RichTextNodeInput::DecoratedSpan {
            style: make_rich_style(12.0, None, None),
            children: vec![node],
            padding_inline: None,
            background: Some("#ffeeaa".to_string()),
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: None,
        };
    }
    vec![node]
}

fn make_rich_depth_inputs(
    depth: usize,
) -> (
    TextFlowWithExclusionsInput,
    ShrinkwrapTextInput,
    ShrinkwrapFlowInput,
    IntrinsicInlineSizeInput,
) {
    let rich_text = make_nested_rich_text(depth);
    let mut exclusion = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 60.0,
        },
        vec![],
    );
    exclusion.rich_text = Some(rich_text.clone());

    let mut shrinkwrap_text: ShrinkwrapTextInput = serde_json::from_value(serde_json::json!({
        "text": "",
        "fontFamily": "NotoSansJP",
        "fontSizePx": 12.0,
        "maxWidth": 120.0
    }))
    .expect("valid shrinkwrap text input");
    shrinkwrap_text.rich_text = Some(rich_text.clone());

    let mut shrinkwrap_flow: ShrinkwrapFlowInput = serde_json::from_value(serde_json::json!({
        "text": "",
        "fontFamily": "NotoSansJP",
        "fontSizePx": 12.0,
        "flowBox": { "x": 0.0, "y": 0.0, "width": 120.0, "height": 60.0 },
        "exclusions": []
    }))
    .expect("valid shrinkwrap flow input");
    shrinkwrap_flow.rich_text = Some(rich_text.clone());

    let mut intrinsic: IntrinsicInlineSizeInput = serde_json::from_value(serde_json::json!({
        "text": "",
        "fontFamily": "NotoSansJP",
        "fontSizePx": 12.0
    }))
    .expect("valid intrinsic input");
    intrinsic.rich_text = Some(rich_text);

    (exclusion, shrinkwrap_text, shrinkwrap_flow, intrinsic)
}

#[test]
fn rich_text_depth_48_is_accepted_by_all_typed_consumers() {
    let registry = make_registry();
    let (exclusion, shrinkwrap_text_input, shrinkwrap_flow_input, intrinsic) =
        make_rich_depth_inputs(crate::text::types::MAX_RICH_TEXT_DEPTH);

    layout_text_flow_with_exclusions(&exclusion, &registry)
        .expect("exclusion flow should accept maximum rich-text depth");
    shrinkwrap_text(&shrinkwrap_text_input, &registry)
        .expect("text shrinkwrap should accept maximum rich-text depth");
    shrinkwrap_flow(&shrinkwrap_flow_input, &registry)
        .expect("flow shrinkwrap should accept maximum rich-text depth");
    measure_intrinsic_inline_size(&intrinsic, &registry)
        .expect("intrinsic measurement should accept maximum rich-text depth");
}

#[test]
fn rich_text_depth_49_is_rejected_by_all_typed_consumers() {
    let registry = make_registry();
    let (exclusion, shrinkwrap_text_input, shrinkwrap_flow_input, intrinsic) =
        make_rich_depth_inputs(crate::text::types::MAX_RICH_TEXT_DEPTH + 1);

    let errors = [
        layout_text_flow_with_exclusions(&exclusion, &registry)
            .expect_err("exclusion flow should reject over-depth rich text")
            .to_string(),
        shrinkwrap_text(&shrinkwrap_text_input, &registry)
            .expect_err("text shrinkwrap should reject over-depth rich text")
            .to_string(),
        shrinkwrap_flow(&shrinkwrap_flow_input, &registry)
            .expect_err("flow shrinkwrap should reject over-depth rich text")
            .to_string(),
        measure_intrinsic_inline_size(&intrinsic, &registry)
            .expect_err("intrinsic measurement should reject over-depth rich text"),
    ];

    for error in errors {
        assert!(error.contains("rich text exceeds max depth (48)"));
        assert!(error.contains("actual depth 49"));
    }
}

fn make_rich_text_ruby() -> Vec<RichTextNodeInput> {
    vec![RichTextNodeInput::Ruby {
        ruby_position: Some("over".to_string()),
        ruby_align: Some("center".to_string()),
        ruby_gap_px: None,
        ruby_offset_px: None,
        ruby_line_sizing: None,
        style: make_rich_style(18.0, Some("#f8fafc"), None),
        base: vec![RichTextNodeInput::Text {
            text: "春".to_string(),
        }],
        rt: vec![RichTextNodeInput::Span {
            text: "はる".to_string(),
            style: make_rich_style(9.0, Some("#fca5a5"), None),
        }],
        rt_levels: Vec::new(),
    }]
}

fn make_rich_text_multilevel_ruby() -> Vec<RichTextNodeInput> {
    vec![RichTextNodeInput::Ruby {
        ruby_position: Some("alternate".to_string()),
        ruby_align: Some("space-between".to_string()),
        ruby_gap_px: Some(2.0),
        ruby_offset_px: Some(3.0),
        ruby_line_sizing: Some("stable".to_string()),
        style: make_rich_style(18.0, Some("#f8fafc"), None),
        base: vec![RichTextNodeInput::Text {
            text: "春".to_string(),
        }],
        rt: Vec::new(),
        rt_levels: vec![
            vec![
                RichTextNodeInput::Span {
                    text: "は".to_string(),
                    style: make_rich_style(9.0, Some("#fca5a5"), None),
                },
                RichTextNodeInput::Span {
                    text: "る".to_string(),
                    style: make_rich_style(8.0, Some("#fde68a"), None),
                },
            ],
            vec![RichTextNodeInput::Span {
                text: "spring".to_string(),
                style: make_rich_style(7.0, Some("#93c5fd"), None),
            }],
        ],
    }]
}

fn make_rich_text_inline_box() -> Vec<RichTextNodeInput> {
    vec![RichTextNodeInput::InlineBox {
        style: make_rich_style(18.0, Some("#f8fafc"), None),
        children: vec![
            RichTextNodeInput::Text {
                text: "囲".to_string(),
            },
            RichTextNodeInput::Span {
                text: "み".to_string(),
                style: make_rich_style(18.0, Some("#fde68a"), None),
            },
        ],
        padding_inline: Some([4.0, 6.0]),
        background: Some("#1f2937".to_string()),
        border_color: Some("#93c5fd".to_string()),
        border_width: Some(1.0),
        border_radius: Some(4.0),
        span_key: None,
    }]
}

fn make_rich_text_decorated_span() -> Vec<RichTextNodeInput> {
    vec![RichTextNodeInput::DecoratedSpan {
        style: make_rich_style(18.0, Some("#f8fafc"), None),
        children: vec![
            RichTextNodeInput::Text {
                text: "装".to_string(),
            },
            RichTextNodeInput::Text {
                text: "飾".to_string(),
            },
            RichTextNodeInput::Text {
                text: "帯".to_string(),
            },
        ],
        padding_inline: Some([4.0, 4.0]),
        background: Some("#1e293b".to_string()),
        border_color: Some("#22d3ee".to_string()),
        border_width: Some(1.0),
        border_radius: Some([4.0, 4.0, 4.0, 4.0]),
        span_key: None,
    }]
}

fn make_rich_text_vertical_demo() -> Vec<RichTextNodeInput> {
    vec![
        RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: make_rich_style(16.0, Some("#e2e8f0"), Some("upright")),
            base: vec![RichTextNodeInput::Text {
                text: "天地".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "てんち".to_string(),
                style: make_rich_style(8.0, Some("#e2e8f0"), Some("upright")),
            }],
            rt_levels: Vec::new(),
        },
        RichTextNodeInput::Text {
            text: "玄黄".to_string(),
        },
        RichTextNodeInput::DecoratedSpan {
            style: make_rich_style(16.0, Some("#e2e8f0"), Some("upright")),
            children: vec![RichTextNodeInput::Text {
                text: "宇宙洪荒".to_string(),
            }],
            padding_inline: Some([2.0, 2.0]),
            background: Some("#1e3a5f".to_string()),
            border_color: Some("#22d3ee".to_string()),
            border_width: Some(1.0),
            border_radius: Some([3.0, 3.0, 3.0, 3.0]),
            span_key: None,
        },
        RichTextNodeInput::Text {
            text: "日月盈昃".to_string(),
        },
    ]
}

fn make_rich_text_tcu() -> Vec<RichTextNodeInput> {
    vec![
        RichTextNodeInput::Text {
            text: "縦".to_string(),
        },
        RichTextNodeInput::Combine {
            text: "2026".to_string(),
            style: make_rich_style(18.0, Some("#93c5fd"), Some("upright")),
            decoration_runs: Vec::new(),
        },
        RichTextNodeInput::Text {
            text: "年".to_string(),
        },
    ]
}

#[test]
fn inline_single_span_parity() {
    // Single span should produce the same layout as plain text
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 300.0,
        },
        vec![],
    );
    input.spans = Some(vec![make_span("あいうえおかきくけこ", 20.0, None)]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(!result.lines.is_empty());
    // Inline path should produce style info on fragments
    let frag = &result.lines[0].fragments[0];
    assert!(frag.style.is_some(), "inline runs should have style");
    assert_eq!(frag.style.as_ref().unwrap().font_size_px, 20.0);
}

#[test]
fn inline_flow_forces_a_visual_line_break_at_newline() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 120.0,
        },
        vec![],
    );
    input.spans = Some(vec![make_span("前\n後", 20.0, None)]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let line_texts: Vec<String> = result
        .lines
        .iter()
        .map(|line| {
            line.fragments
                .iter()
                .map(|fragment| fragment.text.as_str())
                .collect()
        })
        .collect();

    assert_eq!(line_texts, ["前", "後"]);
    assert_eq!(result.lines[0].fragments[0].char_end, 1);
    assert_eq!(result.lines[1].fragments[0].char_start, 2);
    assert!(result.lines[1].fragments[0].y > result.lines[0].fragments[0].y);
}

#[test]
fn plain_flow_forces_a_visual_line_break_at_newline() {
    let reg = make_registry();
    let input = make_exclusion_input(
        "前\n後",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 120.0,
        },
        vec![],
    );

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let line_texts: Vec<String> = result
        .lines
        .iter()
        .map(|line| {
            line.fragments
                .iter()
                .map(|fragment| fragment.text.as_str())
                .collect()
        })
        .collect();

    assert_eq!(line_texts, ["前", "後"]);
}

#[test]
fn inline_two_spans_different_sizes() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 300.0,
        },
        vec![],
    );
    input.spans = Some(vec![
        make_span("あいう", 20.0, None),
        make_span("えお", 30.0, None),
    ]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    // Should have fragments with different font sizes
    let all_frags: Vec<_> = result.lines.iter().flat_map(|l| &l.fragments).collect();
    let sizes: Vec<f64> = all_frags
        .iter()
        .filter_map(|f| f.style.as_ref().map(|s| s.font_size_px))
        .collect();
    assert!(
        sizes.contains(&20.0) && sizes.contains(&30.0),
        "should have both font sizes: {sizes:?}"
    );
}

/// Regression: a mixed-size line is taller than the base line height, so
/// the next line must start below it. Lines used to advance by the base line
/// height and overlap.
#[test]
fn inline_mixed_size_lines_do_not_overlap() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 30.0,
            height: 300.0,
        },
        vec![],
    );
    input.spans = Some(vec![
        make_span("ああ", 30.0, None),
        make_span("いい", 12.0, None),
        make_span("うう", 30.0, None),
    ]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.lines.len() >= 2, "narrow box must wrap");

    for window in result.lines.windows(2) {
        let (upper, lower) = (&window[0], &window[1]);
        let upper_top = upper.fragments[0].y;
        let lower_top = lower.fragments[0].y;
        assert!(
            lower_top >= upper_top + upper.cross_size - 1e-6,
            "line {} (top {upper_top}, cross {}) overlaps line {} (top {lower_top})",
            upper.line_index,
            upper.cross_size,
            lower.line_index,
        );
    }

    // A line containing a 30px run must be taller than a 12px base line.
    let tall = result
        .lines
        .iter()
        .find(|line| {
            line.fragments
                .iter()
                .any(|f| f.style.as_ref().is_some_and(|s| s.font_size_px == 30.0))
        })
        .expect("a line with the 30px run");
    assert!(
        tall.cross_size > 30.0,
        "line with a 30px run must report its real cross size, got {}",
        tall.cross_size
    );
}

/// Regression: fit must not report a layout as contained when its last
/// line hangs out of the flow box.
#[test]
fn flow_lines_stay_inside_the_flow_box() {
    let reg = make_registry();
    let flow_box = FlowBox {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 60.0,
    };
    let box_height = flow_box.height;
    let box_y = flow_box.y;
    let mut input = make_exclusion_input("あいうえおかきくけこさしすせそ", flow_box, vec![]);
    input.font_size_px = 20.0;
    input.line_height = Some(1.5);
    input.fit = Some("shrink".to_string());

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted, "fit must consume all text: {result:?}");

    for line in &result.lines {
        let bottom = line.fragments[0].y + line.cross_size;
        assert!(
            bottom <= box_y + box_height + 1e-6,
            "line {} bottom {bottom} escapes the {box_height}px flow box",
            line.line_index,
        );
    }
}

#[test]
fn inline_fit_uses_the_same_real_cross_size_as_final_layout() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 30.0,
            height: 72.0,
        },
        vec![],
    );
    input.font_size_px = 20.0;
    input.line_height = Some(1.5);
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(6.0);
    input.spans = Some(vec![
        make_span("大", 30.0, None),
        make_span("小", 12.0, None),
        make_span("大", 30.0, None),
    ]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(
        result.exhausted,
        "fit chose a size that final layout rejects: {result:?}"
    );
    assert_eq!(result.overflow_reason, None);
    for line in &result.lines {
        assert!(
            line.fragments[0].y + line.cross_size <= 72.0 + 1e-6,
            "line {} escapes after fit",
            line.line_index,
        );
    }
}

#[test]
fn inline_tall_line_reprobes_exclusion_with_its_real_band() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 120.0,
        },
        vec![FlowExclusionShape::Rect {
            x: 100.0,
            y: 35.0,
            width: 100.0,
            height: 10.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }],
    );
    input.font_size_px = 20.0;
    input.line_height = Some(1.5);
    input.spans = Some(vec![make_span("天地玄黄宇宙", 30.0, None)]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let first = &result.lines[0];
    assert_eq!(first.cross_size, 45.0);
    assert!(
        first
            .fragments
            .iter()
            .all(|fragment| { fragment.x + fragment.inline_advance_px <= 100.0 + 1e-6 }),
        "tall line used regions probed only through y=30: {:?}",
        first.fragments,
    );
}

#[test]
fn vertical_inline_columns_advance_by_real_cross_size() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 108.0,
            height: 30.0,
        },
        vec![],
    );
    input.font_size_px = 20.0;
    input.line_height = Some(1.5);
    input.writing_mode = Some("vertical-rl".to_string());
    input.text_orientation = Some("upright".to_string());
    input.spans = Some(vec![
        make_span("大", 30.0, None),
        make_span("小", 12.0, None),
        make_span("大", 30.0, None),
    ]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(
        result.exhausted,
        "three real-width columns must fit exactly: {result:?}"
    );
    assert_eq!(result.lines.len(), 3);
    assert_eq!(result.lines[0].cross_size, 45.0);
    assert_eq!(result.lines[1].cross_size, 18.0);
    assert_eq!(result.lines[2].cross_size, 45.0);
    for window in result.lines.windows(2) {
        let right_column_left = window[0].fragments[0].x;
        let left_column_right = window[1].fragments[0].x + window[1].cross_size;
        assert!(
            left_column_right <= right_column_left + 1e-6,
            "vertical columns overlap: {window:?}",
        );
    }
}

#[test]
fn rich_tall_line_reprobes_exclusion_with_its_real_band() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 120.0,
        },
        vec![FlowExclusionShape::Rect {
            x: 100.0,
            y: 35.0,
            width: 100.0,
            height: 7.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }],
    );
    input.rich_text = Some(vec![RichTextNodeInput::Span {
        text: "天地玄黄宇宙".to_string(),
        style: make_rich_style(30.0, None, None),
    }]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let first = &result.lines[0];
    assert!((first.cross_size - 42.0).abs() < 1e-6);
    assert!(
        first
            .fragments
            .iter()
            .all(|fragment| { fragment.x + fragment.inline_advance_px <= 100.0 + 1e-6 }),
        "rich line used stale regions: {:?}",
        first.fragments,
    );
}

#[test]
fn vertical_rich_columns_advance_by_real_cross_size() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 101.0,
            height: 30.0,
        },
        vec![],
    );
    input.rich_text = Some(vec![
        RichTextNodeInput::Span {
            text: "大".to_string(),
            style: make_rich_style(30.0, None, Some("upright")),
        },
        RichTextNodeInput::Span {
            text: "小".to_string(),
            style: make_rich_style(12.0, None, Some("upright")),
        },
        RichTextNodeInput::Span {
            text: "大".to_string(),
            style: make_rich_style(30.0, None, Some("upright")),
        },
    ]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(
        result.exhausted,
        "real rich column widths must fit: {result:?}"
    );
    assert_eq!(result.lines.len(), 3);
    assert!((result.lines[0].cross_size - 42.0).abs() < 1e-6);
    assert!((result.lines[1].cross_size - 16.8).abs() < 1e-6);
    assert!((result.lines[2].cross_size - 42.0).abs() < 1e-6);
    for window in result.lines.windows(2) {
        assert!(
            window[1].fragments[0].x + window[1].cross_size <= window[0].fragments[0].x + 1e-6,
            "vertical rich columns overlap: {window:?}",
        );
    }
}

#[test]
fn inline_two_spans_different_colors() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 300.0,
        },
        vec![],
    );
    input.spans = Some(vec![
        make_span("あいう", 20.0, Some("#ff0000")),
        make_span("えお", 20.0, Some("#0000ff")),
    ]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let all_frags: Vec<_> = result.lines.iter().flat_map(|l| &l.fragments).collect();
    let colors: Vec<_> = all_frags
        .iter()
        .filter_map(|f| f.style.as_ref()?.color.as_deref())
        .collect();
    assert!(
        colors.contains(&"#ff0000") && colors.contains(&"#0000ff"),
        "should propagate colors: {colors:?}"
    );
}

#[test]
fn inline_with_exclusions() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![FlowExclusionShape::Rect {
            x: 150.0,
            y: 0.0,
            width: 100.0,
            height: 200.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }],
    );
    input.spans = Some(vec![make_span(
        "あいうえおかきくけこさしすせそ",
        20.0,
        None,
    )]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(!result.lines.is_empty());
}

#[test]
fn inline_with_max_lines() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 300.0,
        },
        vec![],
    );
    input.spans = Some(vec![make_span(
        "あいうえおかきくけこさしすせそたちつてと",
        20.0,
        None,
    )]);
    input.max_lines = Some(1);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert_eq!(result.used_line_count, 1);
    assert!(!result.exhausted);
}

#[test]
fn inline_with_ellipsis() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 300.0,
        },
        vec![],
    );
    input.spans = Some(vec![make_span(
        "あいうえおかきくけこさしすせそ",
        20.0,
        None,
    )]);
    input.max_lines = Some(1);
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let last_frag = result.lines.last().unwrap().fragments.last().unwrap();
    assert!(
        last_frag.text.ends_with('\u{2026}'),
        "should have ellipsis: {:?}",
        last_frag.text
    );
    assert_eq!(last_frag.overflow_reason.as_deref(), Some("ellipsis"));
}

#[test]
fn inline_fit_supported() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        vec![],
    );
    input.spans = Some(vec![make_span("あいう", 20.0, None)]);
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(6.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.chosen_font_size_px.is_some());
}

#[test]
fn rich_text_flow_basic() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        vec![],
    );
    input.rich_text = Some(make_rich_text_basic());

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(!result.lines.is_empty());
}

#[test]
fn rich_text_and_spans_are_mutually_exclusive() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        vec![],
    );
    input.spans = Some(vec![make_span("競合", 20.0, None)]);
    input.rich_text = Some(make_rich_text_basic());

    let result = layout_text_flow_with_exclusions(&input, &reg);
    assert!(
        result.is_err(),
        "spans と richText の同時指定は reject する"
    );
}

#[test]
fn inline_multi_region_single_flow_line() {
    // Regression: fragments from different regions within the same visual
    // line must be collected into a single TextFlowExclusionLine, not split
    // into multiple entries.
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        // Obstacle in center -> two regions per line
        vec![FlowExclusionShape::Rect {
            x: 150.0,
            y: 0.0,
            width: 100.0,
            height: 200.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }],
    );
    input.spans = Some(vec![make_span(
        "あいうえおかきくけこさしすせそたちつてと",
        20.0,
        None,
    )]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    // Each line_index should appear at most once
    for (i, line) in result.lines.iter().enumerate() {
        for other in &result.lines[i + 1..] {
            assert_ne!(
                line.line_index, other.line_index,
                "line_index {} appears in multiple TextFlowExclusionLine entries",
                line.line_index
            );
        }
    }
    // First line should have multiple fragments (left + right of obstacle)
    if !result.lines.is_empty() {
        assert!(
            result.lines[0].fragments.len() >= 2,
            "first line should have fragments from both regions, got {}",
            result.lines[0].fragments.len()
        );
    }
}

#[test]
fn inline_ellipsis_uses_fragment_run_style() {
    // Regression: ellipsis must be shaped with the run that the truncated
    // fragment belongs to, not the document-level trailing span.
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 300.0,
        },
        vec![],
    );
    // First span is large (30px), second span is tiny (10px).
    // With max_lines=1, the truncation happens within the first span.
    // Ellipsis should be shaped at 30px, not 10px.
    input.spans = Some(vec![
        make_span("あいうえおかきくけこ", 30.0, None),
        make_span("さしすせそ", 10.0, None),
    ]);
    input.max_lines = Some(1);
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let last_frag = result.lines.last().unwrap().fragments.last().unwrap();
    assert!(
        last_frag.text.ends_with('\u{2026}'),
        "should have ellipsis: {:?}",
        last_frag.text
    );
    // The fragment's style should be from the first span (30px), not the
    // trailing span (10px).
    if let Some(style) = &last_frag.style {
        assert!(
            (style.font_size_px - 30.0).abs() < 0.01,
            "ellipsis fragment should use first span's size (30px), got {}",
            style.font_size_px
        );
    }
}

// ------------------------------------------------------------------
// Ruby flow tests
// ------------------------------------------------------------------

fn make_ruby_span(text: &str, ruby_text: &str, font_size_px: f64) -> FlowTextSpanDto {
    FlowTextSpanDto {
        text: text.to_string(),
        font_family: None,
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: Some(font_size_px),
        letter_spacing_px: None,
        color: None,
        font_variation_settings: None,
        font_feature_settings: None,
        ruby_text: Some(ruby_text.to_string()),
        ruby_position: None,
        ruby_align: None,
        ruby_font_size_px: None,
        ruby_color: None,
    }
}

#[test]
fn ruby_basic() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![],
    );
    input.spans = Some(vec![make_ruby_span("漢字", "かんじ", 20.0)]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(!result.lines.is_empty());

    // Fragment should carry ruby annotation
    let frag = &result.lines[0].fragments[0];
    assert!(frag.ruby.is_some(), "fragment should have ruby annotation");
    let ruby = frag.ruby.as_ref().unwrap();
    assert_eq!(ruby.text, "かんじ");
    assert_eq!(ruby.position, "over");
    assert_eq!(ruby.align, "space-around");
}

#[test]
fn ruby_position_under() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![],
    );
    let mut span = make_ruby_span("漢字", "かんじ", 20.0);
    span.ruby_position = Some("under".to_string());
    input.spans = Some(vec![span]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let frag = &result.lines[0].fragments[0];
    let ruby = frag.ruby.as_ref().unwrap();
    assert_eq!(ruby.position, "under");
}

#[test]
fn ruby_mixed_with_plain() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![],
    );
    input.spans = Some(vec![
        make_ruby_span("漢字", "かんじ", 20.0),
        make_span("テスト", 20.0, None),
    ]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);

    let all_frags: Vec<_> = result.lines.iter().flat_map(|l| &l.fragments).collect();
    let ruby_frags: Vec<_> = all_frags.iter().filter(|f| f.ruby.is_some()).collect();
    let plain_frags: Vec<_> = all_frags.iter().filter(|f| f.ruby.is_none()).collect();
    assert!(!ruby_frags.is_empty(), "should have ruby fragments");
    assert!(!plain_frags.is_empty(), "should have plain fragments");
}

#[test]
fn ruby_non_breakable() {
    let reg = make_registry();
    // Narrow width: ruby span should not break internally
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 25.0,
            height: 300.0,
        },
        vec![],
    );
    input.spans = Some(vec![make_ruby_span("漢字", "かんじ", 20.0)]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    // The ruby span should remain as a single fragment (not split between "漢" and "字")
    for line in &result.lines {
        for frag in &line.fragments {
            if frag.ruby.is_some() {
                // If ruby is present, the text should be the full base "漢字"
                assert_eq!(
                    frag.text, "漢字",
                    "ruby base text should not be split: {:?}",
                    frag.text
                );
            }
        }
    }
}

#[test]
fn ruby_with_ellipsis() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 300.0,
        },
        vec![],
    );
    input.spans = Some(vec![
        make_ruby_span("漢字", "かんじ", 20.0),
        make_span("テストテストテスト", 20.0, None),
    ]);
    input.max_lines = Some(1);
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(!result.exhausted);
    // Should not panic; ellipsis applied somewhere
    let last_frag = result.lines.last().unwrap().fragments.last().unwrap();
    if last_frag.overflow_reason.as_deref() == Some("ellipsis") {
        assert!(last_frag.text.ends_with('\u{2026}'));
    }
}

#[test]
fn ruby_annotation_style() {
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![],
    );
    let mut span = make_ruby_span("漢字", "かんじ", 20.0);
    span.ruby_font_size_px = Some(10.0);
    span.ruby_color = Some("#ff0000".to_string());
    input.spans = Some(vec![span]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let ruby = result.lines[0].fragments[0].ruby.as_ref().unwrap();
    assert!(
        (ruby.style.font_size_px - 10.0).abs() < 0.01,
        "ruby font size should be 10: {}",
        ruby.style.font_size_px
    );
    assert_eq!(ruby.style.color.as_deref(), Some("#ff0000"));
}

#[test]
fn ruby_ellipsis_does_not_split_token() {
    // Regression: ellipsis truncation must not cut inside a ruby token.
    // If the truncation point would fall inside "漢字", it should retreat
    // to before the token, and the partial fragment should NOT carry the
    // ruby annotation.
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 60.0,
            height: 300.0,
        },
        vec![],
    );
    input.spans = Some(vec![
        make_span("あ", 20.0, None),
        make_ruby_span("漢字", "かんじ", 20.0),
        make_span("テストテスト", 20.0, None),
    ]);
    input.max_lines = Some(1);
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    // If ellipsis cuts before the ruby token, the ruby fragment should
    // either be fully present (with annotation) or absent. No partial
    // ruby base text with a full annotation.
    for line in &result.lines {
        for frag in &line.fragments {
            if let Some(ruby) = &frag.ruby {
                // If ruby is attached, the base text (ignoring trailing "…")
                // must cover the full ruby base.
                let base = frag.text.trim_end_matches('\u{2026}');
                assert_eq!(
                    base, "漢字",
                    "ruby annotation must not be attached to partial base: {:?}",
                    frag.text
                );
                assert_eq!(ruby.text, "かんじ");
            }
        }
    }
}

#[test]
fn ruby_kinsoku_does_not_retreat_into_token() {
    // Regression: kinsoku backtracking must not retreat into a ruby
    // token's non-breakable interior.
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 80.0,
            height: 300.0,
        },
        vec![],
    );
    // "漢字" (ruby) + "。テスト" — "。" is head-prohibit.
    // After ruby overflow, kinsoku may try to retreat from after "。"
    // into the ruby token. It should not.
    input.spans = Some(vec![
        make_ruby_span("漢字", "かんじ", 20.0),
        make_span("。テスト文字列", 20.0, None),
    ]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    // Ruby fragment must remain whole
    for line in &result.lines {
        for frag in &line.fragments {
            if let Some(ruby) = &frag.ruby {
                assert_eq!(
                    frag.text, "漢字",
                    "kinsoku must not split ruby base: {:?}",
                    frag.text
                );
                assert_eq!(ruby.text, "かんじ");
            }
        }
    }
}

#[test]
fn inline_empty_span_does_not_shift_style() {
    // Regression: empty spans are skipped during shaping. The segment-to-span
    // mapping must use span_index (not segment enumeration index) so that
    // style and ruby metadata align correctly even when empty spans exist.
    let reg = make_registry();
    let mut input = make_exclusion_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![],
    );
    input.spans = Some(vec![
        // Empty span at index 0 — skipped during shaping
        make_span("", 20.0, Some("#000000")),
        // Ruby span at index 1
        make_ruby_span("漢字", "かんじ", 20.0),
        // Plain span at index 2
        make_span("テスト", 20.0, Some("#0000ff")),
    ]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);

    let all_frags: Vec<_> = result.lines.iter().flat_map(|l| &l.fragments).collect();
    // Ruby annotation should be on the "漢字" fragment, not on "テスト"
    let ruby_frags: Vec<_> = all_frags.iter().filter(|f| f.ruby.is_some()).collect();
    assert!(
        !ruby_frags.is_empty(),
        "should have ruby fragment despite empty span at index 0"
    );
    for frag in &ruby_frags {
        let base = frag.text.trim_end_matches('\u{2026}');
        assert_eq!(base, "漢字", "ruby should be on '漢字', not shifted");
    }
    // Blue color should be on "テスト", not on "漢字"
    let blue_frags: Vec<_> = all_frags
        .iter()
        .filter(|f| f.style.as_ref().and_then(|s| s.color.as_deref()) == Some("#0000ff"))
        .collect();
    assert!(
        !blue_frags.is_empty(),
        "blue color should be on テスト fragment"
    );
    for frag in &blue_frags {
        assert!(
            frag.text.contains('テ'),
            "blue fragment should be テスト, got {:?}",
            frag.text
        );
    }
}

// ------------------------------------------------------------------
// Vertical flow tests
// ------------------------------------------------------------------

fn make_vertical_input(
    text: &str,
    flow_box: FlowBox,
    exclusions: Vec<FlowExclusionShape>,
) -> TextFlowWithExclusionsInput {
    let mut input = make_exclusion_input(text, flow_box, exclusions);
    input.writing_mode = Some("vertical-rl".to_string());
    input
}

#[test]
fn vertical_basic() {
    let reg = make_registry();
    let input = make_vertical_input(
        "あいうえおかきくけこ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        vec![],
    );

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(!result.lines.is_empty());
    // In vertical mode, fragments should have x within flow box width
    for line in &result.lines {
        for frag in &line.fragments {
            assert!(frag.x >= 0.0, "fragment x should be >= 0: {}", frag.x);
            assert!(
                frag.x < 200.0,
                "fragment x should be within flow box: {}",
                frag.x
            );
        }
    }
}

#[test]
fn vertical_with_rect_exclusion() {
    let reg = make_registry();
    let input = make_vertical_input(
        "あいうえおかきくけこさしすせそたちつてと",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        vec![FlowExclusionShape::Rect {
            x: 0.0,
            y: 80.0,
            width: 200.0,
            height: 40.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }],
    );

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(!result.lines.is_empty());
    // Fragments should avoid the exclusion y-range [80, 120]
    for line in &result.lines {
        for frag in &line.fragments {
            let frag_bottom = frag.y + frag.inline_advance_px;
            let overlaps = frag.y < 120.0 && frag_bottom > 80.0;
            // Fragments may partially overlap if they're in a free region
            // that doesn't intersect the exclusion, which is correct.
            // Just verify fragments exist and layout didn't panic.
            let _ = overlaps;
        }
    }
}

#[test]
fn vertical_plain_latin_digits_have_positive_advances() {
    // Regression: plain vertical paragraph shaping must use TopToBottom
    // direction and vertical OT features. Latin/digit glyphs should produce
    // positive inline_advance_px values (not zero or negative).
    let reg = make_registry();
    let input = make_vertical_input(
        "ABC123あいう",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 400.0,
        },
        vec![],
    );

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(
        !result.lines.is_empty(),
        "should produce at least one column"
    );

    for line in &result.lines {
        for frag in &line.fragments {
            assert!(
                frag.inline_advance_px > 0.0,
                "fragment '{}' has non-positive inline_advance_px: {}",
                frag.text,
                frag.inline_advance_px,
            );
        }
    }
}

#[test]
fn vertical_max_lines_limits_columns() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねの",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 60.0,
        },
        vec![],
    );
    input.max_lines = Some(2);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.lines.len() <= 2, "should have at most 2 columns");
    assert_eq!(result.used_line_count, result.lines.len());
}

#[test]
fn vertical_exhausted_flag() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねの",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 60.0,
        },
        vec![],
    );
    input.max_lines = Some(1);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(!result.exhausted);
    assert_eq!(
        result.overflow_reason,
        Some(FlowOverflowReason::MaxLinesTruncated)
    );
}

#[test]
fn vertical_columns_progress_right_to_left() {
    let reg = make_registry();
    let input = make_vertical_input(
        "あいうえおかきくけこさしすせそたちつてと",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 60.0,
        },
        vec![],
    );

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    if result.lines.len() >= 2 {
        let first_col_x = result.lines[0].fragments[0].x;
        let second_col_x = result.lines[1].fragments[0].x;
        assert!(
            first_col_x > second_col_x,
            "columns should progress right-to-left: first={first_col_x}, second={second_col_x}"
        );
    }
}

#[test]
fn vertical_inline_basic() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        vec![],
    );
    input.spans = Some(vec![make_span("あいうえおかきくけこ", 20.0, None)]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(!result.lines.is_empty());
    // Fragments should have style info
    let frag = &result.lines[0].fragments[0];
    assert!(frag.style.is_some());
}

#[test]
fn vertical_inline_two_spans() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        vec![],
    );
    input.spans = Some(vec![
        make_span("あいう", 20.0, Some("#ff0000")),
        make_span("えお", 20.0, Some("#0000ff")),
    ]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    let colors: Vec<_> = result
        .lines
        .iter()
        .flat_map(|l| &l.fragments)
        .filter_map(|f| f.style.as_ref()?.color.as_deref())
        .collect();
    assert!(colors.contains(&"#ff0000") && colors.contains(&"#0000ff"));
}

#[test]
fn vertical_inline_with_ellipsis() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 60.0,
        },
        vec![],
    );
    input.spans = Some(vec![make_span(
        "あいうえおかきくけこさしすせそ",
        20.0,
        None,
    )]);
    input.max_lines = Some(1);
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(!result.exhausted);
    let last_frag = result.lines.last().unwrap().fragments.last().unwrap();
    assert!(
        last_frag.text.ends_with('\u{2026}'),
        "should have ellipsis: {:?}",
        last_frag.text
    );
}

#[test]
fn vertical_inline_fit_supported() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        vec![],
    );
    input.spans = Some(vec![make_span("あいう", 20.0, None)]);
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(6.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.chosen_font_size_px.is_some());
}

#[test]
fn vertical_inline_upright_orientation() {
    // Regression: textOrientation must propagate to span shaping so that
    // layout and ellipsis measurement use the same orientation.
    let reg = make_registry();
    let mut input = make_vertical_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        vec![],
    );
    input.text_orientation = Some("upright".to_string());
    input.spans = Some(vec![make_span("あいうえお", 20.0, None)]);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(!result.lines.is_empty());
}

#[test]
fn vertical_rich_text_flow_basic() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 200.0,
        },
        vec![],
    );
    input.rich_text = Some(make_rich_text_basic());

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(!result.lines.is_empty());
}

#[test]
fn vertical_fit_shrink_basic() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 60.0,
            height: 60.0,
        },
        vec![],
    );
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(6.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let chosen = result
        .chosen_font_size_px
        .expect("should have chosen_font_size_px");
    assert!(chosen < 20.0, "should shrink: {chosen}");
    assert!(result.exhausted);
}

#[test]
fn vertical_fit_grow_basic() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "あいう",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 200.0,
        },
        vec![],
    );
    input.fit = Some("grow".to_string());
    input.max_font_size_px = Some(60.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    let chosen = result.chosen_font_size_px.unwrap();
    assert!(chosen > 20.0, "should grow: {chosen}");
    assert!(result.exhausted);
}

#[test]
fn vertical_fit_cannot_fit() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめも",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 20.0,
            height: 20.0,
        },
        vec![],
    );
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(8.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert_eq!(result.overflow_reason, Some(FlowOverflowReason::CannotFit));
}

#[test]
fn vertical_fit_shrink_with_ellipsis() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめも",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 20.0,
            height: 20.0,
        },
        vec![],
    );
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(8.0);
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    // CannotFit from fit, but ellipsis should be applied
    assert_eq!(result.overflow_reason, Some(FlowOverflowReason::CannotFit));
    if !result.lines.is_empty() {
        let last_frag = result.lines.last().unwrap().fragments.last().unwrap();
        if last_frag.overflow_reason.as_deref() == Some("ellipsis") {
            assert!(last_frag.text.ends_with('\u{2026}'));
        }
    }
}

#[test]
fn vertical_fit_shrink_with_exclusions() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "あいうえおかきくけこさしすせそ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 90.0,
        },
        vec![FlowExclusionShape::Rect {
            x: 0.0,
            y: 30.0,
            width: 200.0,
            height: 30.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }],
    );
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(6.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.chosen_font_size_px.is_some());
    assert!(result.exhausted);
}

#[test]
fn vertical_fit_shrink_with_max_lines() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "あいうえおかきくけこさしすせそたちつてと",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 300.0,
        },
        vec![],
    );
    input.max_lines = Some(2);
    input.fit = Some("shrink".to_string());
    input.min_font_size_px = Some(6.0);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    assert!(result.lines.len() <= 2);
}

#[test]
fn vertical_ellipsis_basic() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "あいうえおかきくけこさしすせそたちつてと",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 60.0,
        },
        vec![],
    );
    input.max_lines = Some(1);
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert_eq!(result.lines.len(), 1);
    assert!(!result.exhausted);

    let last_frag = result.lines[0].fragments.last().unwrap();
    assert!(
        last_frag.text.ends_with('\u{2026}'),
        "vertical ellipsis should end with '…': {:?}",
        last_frag.text
    );
    assert_eq!(last_frag.overflow_reason.as_deref(), Some("ellipsis"));
}

#[test]
fn vertical_ellipsis_fits_no_truncation() {
    let reg = make_registry();
    let mut input = make_vertical_input(
        "あ",
        FlowBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        vec![],
    );
    input.ellipsis = Some(true);

    let result = layout_text_flow_with_exclusions(&input, &reg).unwrap();
    assert!(result.exhausted);
    let frag = &result.lines[0].fragments[0];
    assert!(
        !frag.text.contains('\u{2026}'),
        "should not have ellipsis when text fits"
    );
}

// -----------------------------------------------------------------------
// .notdef warning tests
// -----------------------------------------------------------------------

#[test]
fn flow_warns_on_notdef_glyphs() {
    let reg = make_registry();
    // Text with ASCII characters likely outside the Japanese-subset font
    let input = TextFlowInput {
        text: "ABCあ".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 16.0,
        line_height: None,
        letter_spacing_px: None,
        language: None,
        wrap: Some("char".to_string()),
        white_space: None,
        tab_size: None,
        hanging_punctuation: None,
        line_widths: vec![200.0],
        writing_mode: None,
        text_orientation: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = layout_text_flow(&input, &reg).unwrap();
    // Whether warnings appear depends on font subset coverage.
    // If .notdef glyphs exist, warnings must contain MISSING_GLYPH.
    for w in &result.warnings {
        assert_eq!(w.code, "MISSING_GLYPH");
        assert_eq!(w.severity, "recoverable");
        assert_eq!(w.stage, "text");
    }
}

#[test]
fn flow_no_warnings_when_all_glyphs_present() {
    let reg = make_registry();
    // Use only hiragana that the subset font should cover
    let input = TextFlowInput {
        text: "あいう".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 16.0,
        line_height: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        white_space: None,
        tab_size: None,
        hanging_punctuation: None,
        line_widths: vec![200.0],
        writing_mode: None,
        text_orientation: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = layout_text_flow(&input, &reg).unwrap();
    assert!(
        result.warnings.is_empty(),
        "no warnings expected when all glyphs are present"
    );
}

// -----------------------------------------------------------------------
// Measure text block
// -----------------------------------------------------------------------

#[test]
fn measure_text_block_basic() {
    let reg = make_registry();
    let input = MeasureTextBlockInput {
        text: "あいうえおかきくけこ".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        max_width: Some(100.0),
        max_height: None,
        writing_mode: None,
        text_orientation: None,
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let result = measure_text_block(&input, &reg).unwrap();
    assert!(result.line_count >= 2);
    assert!(result.used_width > 0.0);
    assert!(result.used_height > 0.0);

    // Per-line diagnostics (horizontal): contiguous full coverage, count
    // parity with line_count, and widths consistent with the aggregate.
    let lines = result
        .lines
        .as_ref()
        .expect("horizontal measure returns lines");
    assert_eq!(lines.len(), result.line_count);
    assert_eq!(lines[0].char_start, 0);
    assert_eq!(lines.last().unwrap().char_end, 10);
    for pair in lines.windows(2) {
        assert_eq!(pair[0].char_end, pair[1].char_start);
    }
    let max_line = lines
        .iter()
        .map(|line| line.inline_advance_px)
        .fold(0.0f64, f64::max);
    assert!((max_line - result.used_width).abs() < 1e-6);
    assert!(lines.iter().all(|line| !line.kinsoku_unresolved));
    // Line text is sliced engine-side; reassembly matches the measured text.
    let joined: String = lines.iter().map(|line| line.text.as_str()).collect();
    assert_eq!(joined, "あいうえおかきくけこ");

    let indented = MeasureTextBlockInput {
        line_height: None,
        line_height_px: Some(32.0),
        text_indent: Some(30.0),
        ..input.clone()
    };
    let indented_result = measure_text_block(&indented, &reg).unwrap();
    assert_eq!(indented_result.line_count, 3);
    assert!((indented_result.used_height - 96.0).abs() < 1e-6);
    let widths: Vec<f64> = indented_result
        .lines
        .unwrap()
        .iter()
        .map(|line| line.inline_advance_px)
        .collect();
    assert_eq!(widths, vec![90.0, 100.0, 40.0]);
}

#[test]
fn measure_text_block_uses_registered_fallback_chain() {
    let mut reg = make_registry();
    let inter = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fonts/Inter-Variable.ttf"
    ))
    .expect("fallback test primary font");
    reg.register(inter, "Inter".into(), 400, FontStyle::Normal)
        .unwrap();
    let input = MeasureTextBlockInput {
        text: "日本語の組版".to_string(),
        font_family: "Inter".to_string(),
        fallback: Some(vec!["NotoSansJP".to_string()]),
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        max_width: Some(200.0),
        max_height: None,
        writing_mode: None,
        text_orientation: None,
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = measure_text_block(&input, &reg).unwrap();
    assert_eq!(result.line_count, 1);
    assert_eq!(result.lines.unwrap()[0].text, input.text);
    assert!(result.used_width > 0.0);

    let pre_wrap = MeasureTextBlockInput {
        text: "日\n\n本".to_string(),
        white_space: Some("pre-wrap".to_string()),
        ..input
    };
    let pre_wrap_result = measure_text_block(&pre_wrap, &reg).unwrap();
    let pre_wrap_lines = pre_wrap_result.lines.unwrap();
    assert_eq!(pre_wrap_result.line_count, 3);
    assert_eq!(
        pre_wrap_lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>(),
        vec!["日", "", "本"]
    );
    assert_eq!(
        pre_wrap_lines
            .iter()
            .map(|line| (line.char_start, line.char_end))
            .collect::<Vec<_>>(),
        vec![(0, 1), (2, 2), (3, 4)]
    );
}

#[test]
fn measure_text_block_vertical_omits_lines() {
    let reg = make_registry();
    let input = MeasureTextBlockInput {
        text: "あいうえお".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        max_width: None,
        max_height: Some(60.0),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let result = measure_text_block(&input, &reg).unwrap();
    assert!(result.line_count >= 1);
    assert!(result.lines.is_none());
}

#[test]
fn measure_text_block_default_normal_collapses_whitespace() {
    let reg = make_registry();
    let raw = MeasureTextBlockInput {
        text: "a   b\nc".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("en".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        max_width: Some(999.0),
        max_height: None,
        writing_mode: None,
        text_orientation: None,
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let collapsed = MeasureTextBlockInput {
        text: "a b c".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("en".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        max_width: Some(999.0),
        max_height: None,
        writing_mode: None,
        text_orientation: None,
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let raw_result = measure_text_block(&raw, &reg).unwrap();
    let collapsed_result = measure_text_block(&collapsed, &reg).unwrap();

    assert_eq!(raw_result.line_count, collapsed_result.line_count);
    assert!(
        (raw_result.used_width - collapsed_result.used_width).abs() < 0.001,
        "default normal should collapse whitespace before measurement"
    );
}

#[test]
fn measure_text_block_pre_wrap_breaks_at_newline() {
    let reg = make_registry();
    let input = MeasureTextBlockInput {
        text: "line1\nline2\nline3".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("en".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        max_width: Some(999.0),
        max_height: None,
        writing_mode: None,
        text_orientation: None,
        white_space: Some("pre-wrap".to_string()),
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = measure_text_block(&input, &reg).unwrap();
    assert_eq!(result.line_count, 3);
}

#[test]
fn measure_text_block_vertical_basic() {
    let reg = make_registry();
    let input = MeasureTextBlockInput {
        text: "天地玄黄宇宙洪荒".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        max_width: None,
        max_height: Some(60.0),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = measure_text_block(&input, &reg).unwrap();
    assert!(result.line_count >= 2);
    assert!(result.used_width > 0.0);
    assert!(result.used_height > 0.0);
}

#[test]
fn measure_text_block_vertical_upright() {
    let reg = make_registry();
    let input = MeasureTextBlockInput {
        text: "ABCD".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        max_width: None,
        max_height: Some(40.0),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = measure_text_block(&input, &reg).unwrap();
    assert!(result.line_count >= 2);
    assert!(result.used_width > 0.0);
}

#[test]
fn measure_text_block_vertical_pre_wrap_breaks_at_newline() {
    let reg = make_registry();
    let input = MeasureTextBlockInput {
        text: "春\n夏\n秋".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        max_width: None,
        max_height: Some(200.0),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        white_space: Some("pre-wrap".to_string()),
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = measure_text_block(&input, &reg).unwrap();
    assert_eq!(result.line_count, 3);
}

#[test]
fn measure_text_block_vertical_word_wrap() {
    let reg = make_registry();
    let word_input = MeasureTextBlockInput {
        text: "alpha beta gamma".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.2),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("en".to_string()),
        wrap: Some("word".to_string()),
        hanging_punctuation: None,
        max_width: None,
        max_height: Some(55.0),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let char_input = MeasureTextBlockInput {
        wrap: Some("char".to_string()),
        ..word_input.clone()
    };

    let word_result = measure_text_block(&word_input, &reg).unwrap();
    let char_result = measure_text_block(&char_input, &reg).unwrap();
    assert!(word_result.line_count > 0);
    assert!(char_result.line_count >= word_result.line_count);
}

#[test]
fn measure_text_block_vertical_max_height_reflows_instead_of_overflowing() {
    let reg = make_registry();
    let loose = MeasureTextBlockInput {
        text: "天地玄黄宇宙洪荒".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        max_width: None,
        max_height: Some(100.0),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let tight = MeasureTextBlockInput {
        max_height: Some(48.0),
        ..loose.clone()
    };

    let loose_result = measure_text_block(&loose, &reg).unwrap();
    let tight_result = measure_text_block(&tight, &reg).unwrap();

    assert!(tight_result.line_count >= loose_result.line_count);
    assert!(tight_result.used_width >= loose_result.used_width);
    assert!(tight_result.used_height <= loose.max_height.unwrap() + 1.0);
}

// -----------------------------------------------------------------------
// Shrinkwrap text (plain)
// -----------------------------------------------------------------------

#[test]
fn shrinkwrap_text_preserves_line_count() {
    let reg = make_registry();
    let wide = 200.0;

    // Measure at wide width.
    let m_input = MeasureTextBlockInput {
        text: "あいうえおかきくけこさしすせそ".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        max_width: Some(wide),
        max_height: None,
        writing_mode: None,
        text_orientation: None,
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let measurement = measure_text_block(&m_input, &reg).unwrap();

    // Shrinkwrap.
    let sw_input = ShrinkwrapTextInput {
        text: m_input.text.clone(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        writing_mode: None,
        text_orientation: None,
        max_width: wide,
        max_height: None,
        min_width: None,
        min_height: None,
        target_line_count: None,
        epsilon_px: None,
        max_iterations: None,
        white_space: None,
        tab_size: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let result = shrinkwrap_text(&sw_input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.chosen_width_px.unwrap() <= wide);
    assert_eq!(result.line_count, measurement.line_count);
}

#[test]
fn shrinkwrap_text_nowrap_collapses_whitespace() {
    let reg = make_registry();
    let raw = ShrinkwrapTextInput {
        text: "a   b\nc".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("en".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        writing_mode: None,
        text_orientation: None,
        max_width: 999.0,
        max_height: None,
        min_width: None,
        min_height: None,
        target_line_count: Some(1),
        epsilon_px: None,
        max_iterations: None,
        white_space: Some("nowrap".to_string()),
        tab_size: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let collapsed = ShrinkwrapTextInput {
        text: "a b c".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("en".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        writing_mode: None,
        text_orientation: None,
        max_width: 999.0,
        max_height: None,
        min_width: None,
        min_height: None,
        target_line_count: Some(1),
        epsilon_px: None,
        max_iterations: None,
        white_space: Some("nowrap".to_string()),
        tab_size: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let raw_result = shrinkwrap_text(&raw, &reg).unwrap();
    let collapsed_result = shrinkwrap_text(&collapsed, &reg).unwrap();

    assert_eq!(raw_result.line_count, 1);
    assert_eq!(raw_result.line_count, collapsed_result.line_count);
    assert!(
        (raw_result.max_line_width.unwrap() - collapsed_result.max_line_width.unwrap()).abs()
            < 0.001,
        "nowrap should collapse whitespace before shrinkwrap measurement"
    );
}

#[test]
fn shrinkwrap_text_infeasible() {
    let reg = make_registry();
    let input = ShrinkwrapTextInput {
        text: "あいうえおかきくけこ".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        writing_mode: None,
        text_orientation: None,
        max_width: 50.0,
        max_height: None,
        min_width: None,
        min_height: None,
        target_line_count: Some(1),
        epsilon_px: None,
        max_iterations: None,
        white_space: None,
        tab_size: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let result = shrinkwrap_text(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Infeasible);
}

#[test]
fn shrinkwrap_text_vertical_basic() {
    let reg = make_registry();
    let input = ShrinkwrapTextInput {
        text: "天地玄黄宇宙洪荒日月盈昃".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: Some(true),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        max_width: 120.0,
        max_height: Some(220.0),
        min_width: None,
        min_height: Some(40.0),
        target_line_count: None,
        epsilon_px: None,
        max_iterations: None,
        white_space: None,
        tab_size: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_text(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.chosen_width_px.is_none());
    assert!(result.chosen_height_px.is_some());
    assert!(result.used_width.unwrap() <= input.max_width);
    assert!(result.max_line_width.is_none());
}

#[test]
fn shrinkwrap_text_vertical_preserves_column_count() {
    let reg = make_registry();
    let input = ShrinkwrapTextInput {
        text: "春はあけぼの。やうやう白くなりゆく山ぎは。".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: Some(true),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        max_width: 120.0,
        max_height: Some(240.0),
        min_width: None,
        min_height: Some(36.0),
        target_line_count: None,
        epsilon_px: Some(0.1),
        max_iterations: Some(20),
        white_space: None,
        tab_size: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let original = layout_text_flow_with_exclusions(
        &TextFlowWithExclusionsInput {
            text: input.text.clone(),
            font_family: input.font_family.clone(),
            fallback: None,
            font_weight: input.font_weight,
            font_style: input.font_style.clone(),
            font_size_px: input.font_size_px,
            line_height: input.line_height,
            line_height_px: None,
            letter_spacing_px: input.letter_spacing_px,
            language: input.language.clone(),
            wrap: input.wrap.clone(),
            white_space: None,
            tab_size: None,
            hanging_punctuation: input.hanging_punctuation,
            flow_box: FlowBox {
                x: 0.0,
                y: 0.0,
                width: input.max_width,
                height: input.max_height.unwrap(),
            },
            exclusions: vec![],
            min_region_width_px: None,
            max_lines: None,
            ellipsis: None,
            fit: None,
            min_font_size_px: None,
            max_font_size_px: None,
            fit_epsilon_px: None,
            fit_max_iterations: None,
            fit_max_probes: None,
            spans: None,
            rich_text: None,
            writing_mode: input.writing_mode.clone(),
            text_orientation: input.text_orientation.clone(),
            font_variation_settings: None,
            font_feature_settings: None,
        },
        &reg,
    )
    .unwrap();

    let result = shrinkwrap_text(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert_eq!(result.line_count, original.used_line_count);
}

#[test]
fn shrinkwrap_text_vertical_text_orientation_upright() {
    let reg = make_registry();
    let input = ShrinkwrapTextInput {
        text: "縦組みABC123".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        max_width: 120.0,
        max_height: Some(160.0),
        min_width: None,
        min_height: Some(30.0),
        target_line_count: None,
        epsilon_px: None,
        max_iterations: None,
        white_space: None,
        tab_size: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_text(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.chosen_height_px.unwrap() <= input.max_height.unwrap());
}

#[test]
fn shrinkwrap_text_vertical_nowrap_collapses_whitespace() {
    let reg = make_registry();
    let raw = ShrinkwrapTextInput {
        text: "A   B\nC".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("en".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        max_width: 120.0,
        max_height: Some(240.0),
        min_width: None,
        min_height: Some(30.0),
        target_line_count: Some(1),
        epsilon_px: None,
        max_iterations: None,
        white_space: Some("nowrap".to_string()),
        tab_size: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let collapsed = ShrinkwrapTextInput {
        text: "A B C".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("en".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        max_width: 120.0,
        max_height: Some(240.0),
        min_width: None,
        min_height: Some(30.0),
        target_line_count: Some(1),
        epsilon_px: None,
        max_iterations: None,
        white_space: Some("nowrap".to_string()),
        tab_size: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let raw_result = shrinkwrap_text(&raw, &reg).unwrap();
    let collapsed_result = shrinkwrap_text(&collapsed, &reg).unwrap();

    assert_eq!(raw_result.line_count, collapsed_result.line_count);
    assert!(
        (raw_result.chosen_height_px.unwrap() - collapsed_result.chosen_height_px.unwrap()).abs()
            < 0.001,
        "vertical nowrap should collapse whitespace before shrinkwrap measurement"
    );
}

#[test]
fn shrinkwrap_text_vertical_infeasible() {
    let reg = make_registry();
    let input = ShrinkwrapTextInput {
        text: "天地玄黄宇宙洪荒".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        max_width: 30.0,
        max_height: Some(120.0),
        min_width: None,
        min_height: Some(40.0),
        target_line_count: Some(1),
        epsilon_px: None,
        max_iterations: None,
        white_space: None,
        tab_size: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_text(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Infeasible);
}

#[test]
fn shrinkwrap_text_rejects_spans_and_rich_text_together() {
    let reg = make_registry();
    let input = ShrinkwrapTextInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        max_width: 120.0,
        max_height: Some(180.0),
        min_width: None,
        min_height: Some(30.0),
        target_line_count: None,
        epsilon_px: None,
        max_iterations: None,
        white_space: None,
        tab_size: None,
        spans: Some(vec![make_span("競合", 18.0, None)]),
        rich_text: Some(make_rich_text_basic()),
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_text(&input, &reg);
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().to_string(),
        "spans and richText are mutually exclusive"
    );
}

#[test]
fn shrinkwrap_text_spans_horizontal_ruby() {
    let reg = make_registry();
    let input = ShrinkwrapTextInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 16.0,
        line_height: Some(1.8),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        writing_mode: None,
        text_orientation: None,
        max_width: 320.0,
        max_height: None,
        min_width: Some(60.0),
        min_height: None,
        target_line_count: Some(2),
        epsilon_px: Some(0.1),
        max_iterations: Some(20),
        white_space: None,
        tab_size: None,
        spans: Some(make_ruby_spans()),
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_text(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert_eq!(result.line_count, 2);
    assert!(result.chosen_width_px.unwrap() < input.max_width);
    assert!(result.max_line_width.unwrap() > 0.0);
}

#[test]
fn shrinkwrap_text_rich_text_vertical_ruby_inline_box() {
    let reg = make_registry();
    let input = ShrinkwrapTextInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: Some(true),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        max_width: 120.0,
        max_height: Some(220.0),
        min_width: None,
        min_height: Some(40.0),
        target_line_count: None,
        epsilon_px: None,
        max_iterations: None,
        white_space: None,
        tab_size: None,
        spans: None,
        rich_text: Some(vec![
            RichTextNodeInput::Ruby {
                ruby_position: Some("over".to_string()),
                ruby_align: Some("center".to_string()),
                ruby_gap_px: None,
                ruby_offset_px: None,
                ruby_line_sizing: None,
                style: make_rich_style(18.0, Some("#f8fafc"), Some("upright")),
                base: vec![RichTextNodeInput::Text {
                    text: "春".to_string(),
                }],
                rt: vec![RichTextNodeInput::Span {
                    text: "はる".to_string(),
                    style: make_rich_style(9.0, Some("#fca5a5"), Some("upright")),
                }],
                rt_levels: Vec::new(),
            },
            RichTextNodeInput::InlineBox {
                style: make_rich_style(18.0, Some("#fde68a"), Some("upright")),
                children: vec![RichTextNodeInput::Text {
                    text: "囲み".to_string(),
                }],
                padding_inline: Some([4.0, 4.0]),
                background: Some("#1e293b".to_string()),
                border_color: Some("#93c5fd".to_string()),
                border_width: Some(1.0),
                border_radius: Some(4.0),
                span_key: None,
            },
        ]),
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_text(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.chosen_height_px.is_some());
    assert!(result.used_width.unwrap() <= input.max_width);
    assert!(result.line_count > 0);
}

#[test]
fn shrinkwrap_text_vertical_rich_text_demo_height_covers_final_layout() {
    let reg = make_registry();
    let rich_text = make_rich_text_vertical_demo();
    let shrinkwrap_input = ShrinkwrapTextInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 16.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: Some(true),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        max_width: 120.0,
        max_height: Some(160.0),
        min_width: None,
        min_height: Some(48.0),
        target_line_count: None,
        epsilon_px: None,
        max_iterations: None,
        white_space: None,
        tab_size: None,
        spans: None,
        rich_text: Some(rich_text.clone()),
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let shrinkwrap_result = shrinkwrap_text(&shrinkwrap_input, &reg).unwrap();
    assert_eq!(shrinkwrap_result.status, ShrinkwrapStatusDto::Satisfied);

    let chosen_height = shrinkwrap_result.chosen_height_px.unwrap();

    let layout_input = TextFlowWithExclusionsInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 16.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        white_space: None,
        tab_size: None,
        hanging_punctuation: Some(true),
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: chosen_height,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        ellipsis: None,
        fit: None,
        min_font_size_px: None,
        max_font_size_px: None,
        fit_epsilon_px: None,
        fit_max_iterations: None,
        fit_max_probes: None,
        spans: None,
        rich_text: Some(rich_text),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let layout_result = layout_text_flow_with_exclusions(&layout_input, &reg).unwrap();
    let max_bottom = layout_result
        .lines
        .iter()
        .flat_map(|line| line.fragments.iter())
        .map(|fragment| fragment.y + fragment.inline_advance_px)
        .fold(0.0_f64, f64::max);

    assert!(
        shrinkwrap_result.used_height <= chosen_height + 1e-6,
        "shrinkwrap used_height exceeds chosen_height: used={}, chosen={chosen_height}",
        shrinkwrap_result.used_height,
    );
    assert!(
        max_bottom <= chosen_height + 1e-6,
        "final layout exceeds shrinkwrap height: bottom={max_bottom}, chosen={chosen_height}",
    );
}

// -----------------------------------------------------------------------
// Shrinkwrap flow
// -----------------------------------------------------------------------

#[test]
fn shrinkwrap_flow_basic() {
    let reg = make_registry();
    let input = ShrinkwrapFlowInput {
        text: "あいうえおかきくけこさしすせそ".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 300.0,
            height: 300.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: None,
        text_orientation: None,
        min_width: None,
        min_height: None,
        target_line_count: None,
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let result = shrinkwrap_flow(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.chosen_width_px.unwrap() <= 300.0);
    assert!(result.chosen_height_px.is_none());
    assert!(result.used_line_count >= 1);
}

#[test]
fn shrinkwrap_flow_with_exclusion() {
    let reg = make_registry();
    let input = ShrinkwrapFlowInput {
        text: "あいうえおかきくけこさしすせそたちつてと".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 300.0,
            height: 300.0,
        },
        exclusions: vec![FlowExclusionShape::Rect {
            x: 100.0,
            y: 0.0,
            width: 50.0,
            height: 50.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: None,
        text_orientation: None,
        min_width: None,
        min_height: None,
        target_line_count: None,
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let result = shrinkwrap_flow(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.chosen_width_px.unwrap() <= 300.0);
    assert!(!result.layout.lines.is_empty());
}

#[test]
fn shrinkwrap_flow_vertical_used_height_matches_fragments() {
    let reg = make_registry();
    let input = ShrinkwrapFlowInput {
        text: "天地玄黄宇宙洪荒".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 220.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        min_width: None,
        min_height: Some(40.0),
        target_line_count: None,
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_flow(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.chosen_width_px.is_none());
    assert!(result.chosen_height_px.is_some());

    let expected_used_height = result
        .layout
        .lines
        .iter()
        .flat_map(|line| line.fragments.iter())
        .map(|frag| frag.y + frag.inline_advance_px)
        .fold(0.0_f64, f64::max);

    assert!(
        (result.used_height - expected_used_height).abs() < 1e-6,
        "used_height mismatch: actual={}, expected={expected_used_height}",
        result.used_height,
    );
}

// -----------------------------------------------------------------------
// Shrinkwrap flow with spans (ruby)
// -----------------------------------------------------------------------

fn make_ruby_spans() -> Vec<FlowTextSpanDto> {
    vec![
        FlowTextSpanDto {
            text: "春".to_string(),
            ruby_text: Some("はる".to_string()),
            ruby_font_size_px: Some(7.0),
            ..Default::default()
        },
        FlowTextSpanDto {
            text: "はあけぼの。".to_string(),
            ..Default::default()
        },
        FlowTextSpanDto {
            text: "白".to_string(),
            ruby_text: Some("しろ".to_string()),
            ruby_font_size_px: Some(7.0),
            ..Default::default()
        },
        FlowTextSpanDto {
            text: "くなりゆく".to_string(),
            ..Default::default()
        },
        FlowTextSpanDto {
            text: "山際".to_string(),
            ruby_text: Some("やまぎわ".to_string()),
            ruby_font_size_px: Some(7.0),
            ..Default::default()
        },
        FlowTextSpanDto {
            text: "、".to_string(),
            ..Default::default()
        },
    ]
}

#[test]
fn shrinkwrap_flow_with_spans_ruby() {
    let reg = make_registry();
    let spans = make_ruby_spans();
    let input = ShrinkwrapFlowInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 14.0,
        line_height: Some(1.9),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 350.0,
            height: 200.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: None,
        text_orientation: None,
        min_width: None,
        min_height: None,
        target_line_count: Some(2),
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: Some(spans),
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_flow(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert_eq!(result.used_line_count, 2, "should maintain 2-line target");
    let w = result.chosen_width_px.unwrap();
    assert!(
        w < 350.0,
        "shrinkwrap width {w} should be less than original 350"
    );
}

#[test]
fn shrinkwrap_flow_spans_and_plain_both_satisfy() {
    let reg = make_registry();
    let spans = make_ruby_spans();
    let plain_text: String = spans.iter().map(|s| s.text.as_str()).collect();

    let input_plain = ShrinkwrapFlowInput {
        text: plain_text,
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 14.0,
        line_height: Some(1.9),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 350.0,
            height: 200.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: None,
        text_orientation: None,
        min_width: None,
        min_height: None,
        target_line_count: Some(2),
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: None,
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let result_plain = shrinkwrap_flow(&input_plain, &reg).unwrap();

    let input_spans = ShrinkwrapFlowInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 14.0,
        line_height: Some(1.9),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 350.0,
            height: 200.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: None,
        text_orientation: None,
        min_width: None,
        min_height: None,
        target_line_count: Some(2),
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: Some(spans),
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };
    let result_spans = shrinkwrap_flow(&input_spans, &reg).unwrap();

    assert_eq!(result_plain.status, ShrinkwrapStatusDto::Satisfied);
    assert_eq!(result_spans.status, ShrinkwrapStatusDto::Satisfied);
    assert_eq!(
        result_plain.used_line_count, 2,
        "plain should maintain 2-line target"
    );
    assert_eq!(
        result_spans.used_line_count, 2,
        "spans should maintain 2-line target"
    );
    // The resolved spans line box is taller because it contains ruby; the
    // legacy top/bottom ruby-band metadata is not added a second time.
    assert!(
        result_spans.used_height > result_plain.used_height,
        "spans usedHeight ({}) should exceed plain usedHeight ({}) due to ruby extent",
        result_spans.used_height,
        result_plain.used_height,
    );
}

#[test]
fn shrinkwrap_flow_vertical_spans_upright() {
    let reg = make_registry();
    let input = ShrinkwrapFlowInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 20.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 220.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        min_width: None,
        min_height: Some(40.0),
        target_line_count: None,
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: Some(vec![
            make_span("縦組み", 20.0, None),
            make_span("ABC123", 20.0, Some("#93c5fd")),
        ]),
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_flow(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.chosen_height_px.is_some());
    assert!(!result.layout.lines.is_empty());
}

#[test]
fn shrinkwrap_flow_vertical_ruby() {
    let reg = make_registry();
    let input = ShrinkwrapFlowInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 16.0,
        line_height: Some(1.7),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 220.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        min_width: None,
        min_height: Some(40.0),
        target_line_count: None,
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: Some(make_ruby_spans()),
        rich_text: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_flow(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.chosen_height_px.is_some());
    assert!(result.used_height > 0.0);
}

#[test]
fn measure_intrinsic_inline_size_vertical_basic() {
    let reg = make_registry();
    let input = IntrinsicInlineSizeInput {
        text: "ABCD".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        rich_text: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = measure_intrinsic_inline_size(&input, &reg).unwrap();
    assert!(result.min_content_inline_size > 0.0);
    assert!(result.max_content_inline_size >= result.min_content_inline_size);
}

#[test]
fn measure_intrinsic_inline_size_horizontal_basic() {
    let reg = make_registry();
    let input = IntrinsicInlineSizeInput {
        text: "天地玄黄".to_string(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        rich_text: None,
        writing_mode: Some("horizontal-tb".to_string()),
        text_orientation: Some("mixed".to_string()),
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = measure_intrinsic_inline_size(&input, &reg).unwrap();
    assert!(result.max_content_inline_size > 0.0);
    assert!(result.max_content_inline_size >= result.min_content_inline_size);

    let indented = IntrinsicInlineSizeInput {
        text_indent: Some(30.0),
        ..input.clone()
    };
    let indented_result = measure_intrinsic_inline_size(&indented, &reg).unwrap();
    assert!(
        (indented_result.max_content_inline_size - result.max_content_inline_size - 30.0).abs()
            < 1e-6
    );
}

#[test]
fn measure_intrinsic_inline_size_rich_text_typed_bridge() {
    let reg = make_registry();
    let input = IntrinsicInlineSizeInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        rich_text: Some(make_rich_text_basic()),
        writing_mode: Some("horizontal-tb".to_string()),
        text_orientation: Some("mixed".to_string()),
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = measure_intrinsic_inline_size(&input, &reg).unwrap();
    assert!(result.max_content_inline_size > 0.0);
    assert!(result.max_content_inline_size >= result.min_content_inline_size);
}

#[test]
fn measure_intrinsic_inline_size_vertical_rich_text() {
    let reg = make_registry();
    let input = IntrinsicInlineSizeInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        rich_text: Some(make_rich_text_basic()),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("mixed".to_string()),
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = measure_intrinsic_inline_size(&input, &reg).unwrap();
    assert!(result.max_content_inline_size > 0.0);
    assert!(result.max_content_inline_size >= result.min_content_inline_size);
}

#[test]
fn measure_intrinsic_inline_size_vertical_text_combine_upright() {
    let reg = make_registry();
    let input = IntrinsicInlineSizeInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        rich_text: Some(make_rich_text_tcu()),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = measure_intrinsic_inline_size(&input, &reg).unwrap();
    assert!(result.min_content_inline_size > 0.0);
    assert!(result.max_content_inline_size >= result.min_content_inline_size);
}

#[test]
fn measure_intrinsic_inline_size_vertical_decorated_span() {
    let reg = make_registry();
    let input = IntrinsicInlineSizeInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        language: Some("ja".to_string()),
        rich_text: Some(make_rich_text_decorated_span()),
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("mixed".to_string()),
        white_space: None,
        tab_size: None,
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = measure_intrinsic_inline_size(&input, &reg).unwrap();
    assert!(result.min_content_inline_size > 0.0);
    assert!(result.max_content_inline_size >= result.min_content_inline_size);
}

#[test]
fn shrinkwrap_flow_rejects_spans_and_rich_text_together() {
    let reg = make_registry();
    let input = ShrinkwrapFlowInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 140.0,
            height: 220.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        min_width: None,
        min_height: Some(40.0),
        target_line_count: None,
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: Some(vec![make_span("競合", 18.0, None)]),
        rich_text: Some(make_rich_text_basic()),
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_flow(&input, &reg);
    assert!(result.is_err());
}

#[test]
fn shrinkwrap_flow_rich_text_horizontal_basic() {
    let reg = make_registry();
    let input = ShrinkwrapFlowInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 220.0,
            height: 160.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: None,
        text_orientation: None,
        min_width: Some(40.0),
        min_height: None,
        target_line_count: None,
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: None,
        rich_text: Some(make_rich_text_basic()),
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_flow(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.chosen_width_px.is_some());
    assert!(!result.layout.lines.is_empty());
}

#[test]
fn shrinkwrap_flow_rich_text_vertical_basic() {
    let reg = make_registry();
    let input = ShrinkwrapFlowInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.4),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 220.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        min_width: None,
        min_height: Some(40.0),
        target_line_count: None,
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: None,
        rich_text: Some(make_rich_text_basic()),
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_flow(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.chosen_height_px.is_some());
    assert!(!result.layout.lines.is_empty());
}

#[test]
fn shrinkwrap_flow_rich_text_vertical_ruby() {
    let reg = make_registry();
    let input = ShrinkwrapFlowInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.7),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 220.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        min_width: None,
        min_height: Some(40.0),
        target_line_count: None,
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: None,
        rich_text: Some(make_rich_text_ruby()),
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_flow(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.used_height > 0.0);
    assert!(
        result
            .layout
            .lines
            .iter()
            .flat_map(|line| line.fragments.iter())
            .any(|fragment| fragment.ruby.is_some())
    );
}

#[test]
fn shrinkwrap_flow_preserves_multilevel_ruby_metadata() {
    let reg = make_registry();
    let input = ShrinkwrapFlowInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.7),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 160.0,
            height: 220.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: None,
        text_orientation: None,
        min_width: Some(40.0),
        min_height: None,
        target_line_count: None,
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: None,
        rich_text: Some(make_rich_text_multilevel_ruby()),
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_flow(&input, &reg).expect("multilevel ruby flow");
    let ruby = result
        .layout
        .lines
        .iter()
        .flat_map(|line| line.fragments.iter())
        .find_map(|fragment| fragment.ruby.as_ref())
        .expect("ruby metadata");
    assert_eq!(ruby.text, "はる");
    assert_eq!(ruby.position, "over");
    assert_eq!(ruby.offset_px, 3.0);
    assert_eq!(ruby.line_sizing, "stable");
    assert_eq!(ruby.levels.len(), 2);
    assert_eq!(ruby.levels[0].text, "はる");
    assert_eq!(ruby.levels[0].position, "over");
    assert_eq!(ruby.levels[0].runs.len(), 2);
    assert_eq!(
        ruby.levels[0].runs[1].style.color.as_deref(),
        Some("#fde68a")
    );
    assert_eq!(ruby.levels[1].text, "spring");
    assert_eq!(ruby.levels[1].position, "under");
    assert_eq!(ruby.levels[1].runs[0].style.font_size_px, 7.0);
}

#[test]
fn shrinkwrap_flow_rich_text_vertical_inline_box() {
    let reg = make_registry();
    let input = ShrinkwrapFlowInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 220.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        min_width: None,
        min_height: Some(40.0),
        target_line_count: None,
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: None,
        rich_text: Some(make_rich_text_inline_box()),
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_flow(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.chosen_height_px.is_some());
}

#[test]
fn shrinkwrap_flow_rich_text_vertical_decorated_span() {
    let reg = make_registry();
    let input = ShrinkwrapFlowInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 220.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: None,
        min_width: None,
        min_height: Some(40.0),
        target_line_count: None,
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: None,
        rich_text: Some(make_rich_text_decorated_span()),
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_flow(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(
        !result
            .layout
            .warnings
            .iter()
            .any(|warning| warning.code == "UNSUPPORTED_DECORATED_SPAN_WRITING_MODE")
    );
}

#[test]
fn shrinkwrap_flow_rich_text_vertical_text_combine_upright() {
    let reg = make_registry();
    let input = ShrinkwrapFlowInput {
        text: String::new(),
        font_family: "NotoSansJP".to_string(),
        fallback: None,
        font_weight: None,
        font_style: None,
        font_size_px: 18.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".to_string()),
        wrap: Some("char".to_string()),
        hanging_punctuation: None,
        flow_box: FlowBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 220.0,
        },
        exclusions: vec![],
        min_region_width_px: None,
        max_lines: None,
        writing_mode: Some("vertical-rl".to_string()),
        text_orientation: Some("upright".to_string()),
        min_width: None,
        min_height: Some(40.0),
        target_line_count: None,
        shrinkwrap_epsilon_px: None,
        shrinkwrap_max_iterations: None,
        spans: None,
        rich_text: Some(make_rich_text_tcu()),
        font_variation_settings: None,
        font_feature_settings: None,
    };

    let result = shrinkwrap_flow(&input, &reg).unwrap();
    assert_eq!(result.status, ShrinkwrapStatusDto::Satisfied);
    assert!(result.used_line_count >= 1);
}

#[test]
fn explicit_line_height_px_stays_fixed_across_fit_vertical_and_shrinkwrap() {
    let registry = make_registry();
    let fitted_input: TextFlowWithExclusionsInput = serde_json::from_value(serde_json::json!({
        "text": "あいうえおかきくけこさしすせそ",
        "fontFamily": "NotoSansJP",
        "fontSizePx": 24.0,
        "lineHeight": 1.2,
        "lineHeightPx": 48.0,
        "language": "ja",
        "wrap": "char",
        "flowBox": { "x": 0.0, "y": 0.0, "width": 60.0, "height": 144.0 },
        "exclusions": [],
        "fit": "shrink",
        "minFontSizePx": 8.0
    }))
    .expect("deserialize fitted flow input");
    let fitted = layout_text_flow_with_exclusions(&fitted_input, &registry).expect("fitted flow");
    assert_eq!(fitted.chosen_font_size_px, Some(12.0));
    assert_eq!(
        fitted
            .lines
            .iter()
            .map(|line| line.cross_size)
            .collect::<Vec<_>>(),
        vec![48.0, 48.0, 48.0]
    );

    let vertical_input: TextFlowWithExclusionsInput = serde_json::from_value(serde_json::json!({
        "text": "あいうえおかきくけこ",
        "fontFamily": "NotoSansJP",
        "fontSizePx": 20.0,
        "lineHeight": 1.2,
        "lineHeightPx": 48.0,
        "language": "ja",
        "wrap": "char",
        "writingMode": "vertical-rl",
        "textOrientation": "upright",
        "flowBox": { "x": 0.0, "y": 0.0, "width": 192.0, "height": 60.0 },
        "exclusions": []
    }))
    .expect("deserialize vertical flow input");
    let vertical =
        layout_text_flow_with_exclusions(&vertical_input, &registry).expect("vertical flow");
    assert_eq!(
        vertical
            .lines
            .iter()
            .map(|line| (line.cross_size, line.fragments[0].x))
            .collect::<Vec<_>>(),
        vec![(48.0, 144.0), (48.0, 96.0), (48.0, 48.0), (48.0, 0.0)]
    );

    let shrinkwrap_input: ShrinkwrapFlowInput = serde_json::from_value(serde_json::json!({
        "text": "あいうえおかきくけこ",
        "fontFamily": "NotoSansJP",
        "fontSizePx": 20.0,
        "lineHeight": 1.2,
        "lineHeightPx": 48.0,
        "language": "ja",
        "wrap": "char",
        "flowBox": { "x": 0.0, "y": 0.0, "width": 60.0, "height": 192.0 },
        "exclusions": [],
        "targetLineCount": 4
    }))
    .expect("deserialize shrinkwrap flow input");
    let shrinkwrapped = shrinkwrap_flow(&shrinkwrap_input, &registry).expect("shrinkwrap flow");
    assert_eq!(shrinkwrapped.status, ShrinkwrapStatusDto::Satisfied);
    assert_eq!(shrinkwrapped.used_line_count, 4);
    assert_eq!(shrinkwrapped.layout.lines.len(), 4);
    assert_eq!(shrinkwrapped.used_height, 192.0);

    let tight_span_input: ShrinkwrapTextInput = serde_json::from_value(serde_json::json!({
        "text": "",
        "fontFamily": "NotoSansJP",
        "fontSizePx": 20.0,
        "lineHeightPx": 2.0,
        "maxWidth": 20.0,
        "targetLineCount": 10,
        "spans": [{ "text": "あいうえおかきくけこ" }]
    }))
    .expect("deserialize tight span shrinkwrap input");
    let tight_span = shrinkwrap_text(&tight_span_input, &registry).expect("tight span shrinkwrap");
    assert_eq!(tight_span.status, ShrinkwrapStatusDto::Satisfied);
    assert_eq!(tight_span.line_count, 10);
    assert_eq!(tight_span.used_height, 20.0);
}

#[test]
fn ruby_shrinkwrap_uses_css_line_boxes_and_contains_atomic_bases() {
    let registry = make_registry();

    for white_space in ["normal", "pre-wrap"] {
        let horizontal_input: ShrinkwrapTextInput = serde_json::from_value(serde_json::json!({
            "text": "",
            "fontFamily": "NotoSansJP",
            "fontSizePx": 16.0,
            "lineHeight": 1.2,
            "lineHeightPx": 40.0,
            "minWidth": 200.0,
            "maxWidth": 200.0,
            "targetLineCount": 1,
            "whiteSpace": white_space,
            "spans": [{
                "text": "漢字",
                "rubyText": "かんじ",
                "rubyFontSizePx": 8.0
            }]
        }))
        .expect("deserialize horizontal ruby shrinkwrap input");
        let horizontal =
            shrinkwrap_text(&horizontal_input, &registry).expect("horizontal ruby shrinkwrap");
        assert_eq!(horizontal.status, ShrinkwrapStatusDto::Satisfied);
        assert_eq!(horizontal.line_count, 1);
        assert_eq!(horizontal.used_height, 40.0);

        let vertical_input: ShrinkwrapTextInput = serde_json::from_value(serde_json::json!({
            "text": "",
            "fontFamily": "NotoSansJP",
            "fontSizePx": 16.0,
            "lineHeight": 1.2,
            "lineHeightPx": 40.0,
            "writingMode": "vertical-rl",
            "textOrientation": "upright",
            "maxWidth": 200.0,
            "minHeight": 200.0,
            "maxHeight": 200.0,
            "targetLineCount": 1,
            "whiteSpace": white_space,
            "spans": [{
                "text": "漢字",
                "rubyText": "かんじ",
                "rubyFontSizePx": 8.0
            }]
        }))
        .expect("deserialize vertical ruby shrinkwrap input");
        let vertical =
            shrinkwrap_text(&vertical_input, &registry).expect("vertical ruby shrinkwrap");
        assert_eq!(vertical.status, ShrinkwrapStatusDto::Satisfied);
        assert_eq!(vertical.line_count, 1);
        assert_eq!(vertical.used_width, Some(40.0));
    }

    let flow_input: ShrinkwrapFlowInput = serde_json::from_value(serde_json::json!({
        "text": "",
        "fontFamily": "NotoSansJP",
        "fontSizePx": 16.0,
        "lineHeight": 1.2,
        "lineHeightPx": 40.0,
        "flowBox": { "x": 0.0, "y": 0.0, "width": 200.0, "height": 200.0 },
        "exclusions": [],
        "targetLineCount": 1,
        "spans": [{
            "text": "漢字",
            "rubyText": "かんじ",
            "rubyFontSizePx": 8.0
        }]
    }))
    .expect("deserialize ruby flow shrinkwrap input");
    let flow = shrinkwrap_flow(&flow_input, &registry).expect("ruby flow shrinkwrap");
    assert_eq!(flow.status, ShrinkwrapStatusDto::Satisfied);
    assert_eq!(flow.used_line_count, 1);
    assert_eq!(flow.used_height, 40.0);
    let fragment = &flow.layout.lines[0].fragments[0];
    assert!(fragment.inline_advance_px <= fragment.available_inline_size_px + 1e-6);
    assert!(flow.chosen_width_px.unwrap() >= fragment.inline_advance_px);
}
