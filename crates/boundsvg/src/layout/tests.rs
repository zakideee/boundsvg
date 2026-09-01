use super::measure::measure_text_node;
use super::*;
use crate::font::{FontRegistry, FontStyle};
use crate::layout::types::TextUnitMapRequest;
use crate::text::types::{MAX_RICH_TEXT_DEPTH, RichTextNodeInput, RichTextStyleInput};
use ::taffy::prelude::{AvailableSpace, NodeId, Size};
use std::collections::HashMap;

fn test_font_data() -> Vec<u8> {
    std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
    ))
    .expect("Test font")
}

fn plain_text_input(content: &str, font_size_px: f64, wrap: &str) -> TextInput {
    TextInput {
        content: content.into(),
        spans: None,
        rich_text: None,
        font_size_px,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: None,
        text_indent: None,
        font_family: vec!["NotoSansJP".into()],
        font_weight: 400,
        font_style: FontStyle::Normal,
        wrap: wrap.into(),
        max_lines: None,
        preferred_frame: None,
        writing_mode: None,
        language: Some("ja".into()),
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
        font_variation_settings: None,
        font_feature_settings: None,
        unit_map: None,
        text_decoration_range_count: None,
        white_space: None,
        tab_size: None,
        flow: None,
    }
}

fn centered_column_text_input() -> LayoutInput {
    let text_node = |node_id: &str, content: &str| LayoutNodeInput {
        node_id: node_id.into(),
        node_type: "text".into(),
        authored_id: true,
        style: TaffyStyleInput::default(),
        children: vec![],
        text: Some(plain_text_input(content, 13.0, "char")),
        text_path: None,
        image: None,
        visual: None,
    };

    LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(160.0),
                height: Some(120.0),
                ..Default::default()
            },
            children: vec![LayoutNodeInput {
                node_id: "column".into(),
                node_type: "flex".into(),
                authored_id: true,
                style: TaffyStyleInput {
                    flex_direction: Some("column".into()),
                    justify_content: Some("center".into()),
                    align_items: Some("center".into()),
                    width: Some(160.0),
                    height: Some(120.0),
                    padding: Some([12.0, 12.0, 12.0, 12.0]),
                    gap: Some(4.0),
                    ..Default::default()
                },
                children: vec![
                    text_node("t1", "Same transform,"),
                    text_node("t2", "every node type."),
                ],
                text: None,
                text_path: None,
                image: None,
                visual: None,
            }],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![FontInput {
            alias: "NotoSansJP".into(),
            weight: 400,
            style: FontStyle::Normal,
            data: test_font_data(),
        }],
    }
}

fn nested_layout_input(depth: usize) -> LayoutInput {
    let mut child = LayoutNodeInput {
        node_id: format!("box-{depth}"),
        node_type: "box".into(),
        authored_id: true,
        style: TaffyStyleInput::default(),
        children: vec![],
        text: None,
        text_path: None,
        image: None,
        visual: None,
    };
    for current_depth in (1..depth).rev() {
        child = LayoutNodeInput {
            node_id: format!("box-{current_depth}"),
            node_type: "box".into(),
            authored_id: true,
            style: TaffyStyleInput::default(),
            children: vec![child],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        };
    }
    LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(20.0),
                height: Some(20.0),
                ..Default::default()
            },
            children: vec![child],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![],
    }
}

fn rich_text_style() -> RichTextStyleInput {
    RichTextStyleInput {
        font_family: vec!["NotoSansJP".into()],
        font_weight: 400,
        font_style: FontStyle::Normal,
        font_size_px: 12.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: None,
        language: Some("ja".into()),
        color: None,
        text_strokes: None,
        text_shadows: None,
        font_variation_settings: None,
        font_feature_settings: None,
        text_orientation: None,
        text_decoration: None,
    }
}

fn nested_rich_text(depth: usize) -> Vec<RichTextNodeInput> {
    let mut node = RichTextNodeInput::Text {
        text: "境界".into(),
    };
    for _ in 1..=depth {
        node = RichTextNodeInput::DecoratedSpan {
            style: rich_text_style(),
            children: vec![node],
            padding_inline: None,
            background: Some("#ffeeaa".into()),
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: None,
        };
    }
    vec![node]
}

fn rich_text_layout_input(depth: usize) -> LayoutInput {
    let mut text = plain_text_input("", 12.0, "char");
    text.rich_text = Some(nested_rich_text(depth));
    LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(120.0),
                height: Some(60.0),
                ..Default::default()
            },
            children: vec![LayoutNodeInput {
                node_id: "text-boundary".into(),
                node_type: "text".into(),
                authored_id: true,
                style: TaffyStyleInput {
                    width: Some(120.0),
                    ..Default::default()
                },
                children: vec![],
                text: Some(text),
                text_path: None,
                image: None,
                visual: None,
            }],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![FontInput {
            alias: "NotoSansJP".into(),
            weight: 400,
            style: FontStyle::Normal,
            data: test_font_data(),
        }],
    }
}

fn rich_base_decoration_wire_input(range_count: usize, animate_units: bool) -> LayoutInput {
    let rich_text = (0..range_count)
        .map(|_| {
            serde_json::json!({
                "kind": "span",
                "text": "x",
                "style": {
                    "fontSizePx": 16.0,
                    "textDecoration": {
                        "line": ["underline"],
                        "color": "#ff0000",
                        "style": "solid",
                        "offsetPx": 0.0
                    }
                }
            })
        })
        .collect::<Vec<_>>();
    let visual = animate_units.then(|| {
        serde_json::json!({
            "unitAnimation": {
                "by": "cluster",
                "animation": {
                    "keyframes": [{ "at": 0.0 }, { "at": 1.0 }],
                    "durationMs": 100.0
                }
            }
        })
    });
    serde_json::from_value(serde_json::json!({
        "root": {
            "nodeId": "canvas",
            "nodeType": "canvas",
            "authoredId": true,
            "style": { "width": 320.0, "height": 200.0 },
            "children": [{
                "nodeId": "text",
                "nodeType": "text",
                "authoredId": true,
                "text": {
                    "content": "x".repeat(range_count),
                    "fontSizePx": 16.0,
                    "fontFamily": ["NotoSansJP"],
                    "richText": rich_text
                },
                "visual": visual
            }]
        },
        "fonts": [{
            "alias": "NotoSansJP",
            "weight": 400,
            "style": "normal",
            "data": test_font_data()
        }]
    }))
    .expect("rich decoration wire input")
}

fn inline_rect_wire_input(rich_text: &serde_json::Value) -> LayoutInput {
    serde_json::from_value(serde_json::json!({
        "root": {
            "nodeId": "canvas",
            "nodeType": "canvas",
            "authoredId": true,
            "style": { "width": 320.0, "height": 200.0 },
            "children": [{
                "nodeId": "text",
                "nodeType": "text",
                "authoredId": true,
                "text": {
                    "content": "",
                    "fontSizePx": 16.0,
                    "fontFamily": ["NotoSansJP"],
                    "richText": rich_text
                }
            }]
        },
        "fonts": [{
            "alias": "NotoSansJP",
            "weight": 400,
            "style": "normal",
            "data": test_font_data()
        }]
    }))
    .expect("inline rect wire input")
}

fn assert_structured_error_code(error: crate::error::EngineError, expected_code: &str) {
    assert!(matches!(
        error,
        crate::error::EngineError::Structured { code, .. } if code == expected_code
    ));
}

fn text_unit_layout_input(
    content: &str,
    width: f32,
    writing_mode: Option<&str>,
    kind: crate::text::unit_map::TextUnitKind,
    ruby: crate::text::unit_map::TextUnitRubyMode,
) -> LayoutInput {
    let mut text = plain_text_input(content, 18.0, "char");
    text.writing_mode = writing_mode.map(str::to_string);
    text.unit_map = Some(TextUnitMapRequest { kind, ruby });
    LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(width),
                height: Some(180.0),
                ..Default::default()
            },
            children: vec![LayoutNodeInput {
                node_id: "unit-text".into(),
                node_type: "text".into(),
                authored_id: true,
                style: TaffyStyleInput {
                    width: Some(width),
                    height: writing_mode.is_some().then_some(180.0),
                    ..Default::default()
                },
                children: Vec::new(),
                text: Some(text),
                text_path: None,
                image: None,
                visual: None,
            }],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![FontInput {
            alias: "NotoSansJP".into(),
            weight: 400,
            style: FontStyle::Normal,
            data: test_font_data(),
        }],
    }
}

fn text_unit_map(input: &LayoutInput) -> crate::text::unit_map::TextUnitMap {
    compute_full_layout(input)
        .expect("text unit layout")
        .nodes
        .into_iter()
        .find(|node| node.node_id == "unit-text")
        .and_then(|node| node.text_layout)
        .and_then(|layout| layout.unit_map)
        .expect("text unit map")
}

#[test]
fn accepts_maximum_layout_tree_depth() {
    let output = compute_full_layout(&nested_layout_input(MAX_LAYOUT_TREE_DEPTH))
        .expect("maximum layout-tree depth should be accepted");
    assert_eq!(output.nodes.len(), MAX_LAYOUT_TREE_DEPTH + 1);
}

#[test]
fn rejects_layout_tree_beyond_maximum_depth() {
    let error = compute_full_layout(&nested_layout_input(MAX_LAYOUT_TREE_DEPTH + 1))
        .expect_err("over-depth layout tree should be rejected");
    match error {
        crate::error::EngineError::Validation(message) => {
            assert!(message.contains("layout tree exceeds max depth (48)"));
            assert!(message.contains("box-49"));
        }
        other => panic!("expected validation error, got {other:?}"),
    }
}

#[test]
fn accepts_maximum_rich_text_depth() {
    compute_full_layout(&rich_text_layout_input(MAX_RICH_TEXT_DEPTH))
        .expect("maximum rich-text depth should be accepted");
}

#[test]
fn serializes_text_warnings_as_strict_recoverable_layout_diagnostics() {
    let mut input = centered_column_text_input();
    let first_text = input.root.children[0].children[0]
        .text
        .as_mut()
        .expect("first text input");
    first_text.content = "\u{10ffff}".to_string();

    let output = compute_full_layout(&input).expect("missing glyph layout should remain valid");
    let warnings = &output
        .nodes
        .iter()
        .find(|node| node.node_id == "t1")
        .and_then(|node| node.text_layout.as_ref())
        .expect("first text layout")
        .warnings;
    let warning = serde_json::to_value(warnings.first().expect("missing glyph warning"))
        .expect("serialize warning");

    assert_eq!(warning["severity"], "recoverable");
    assert_eq!(warning["code"], "MISSING_GLYPH");
    assert_eq!(warning["fallback"], "blank");
    assert_eq!(warning["stage"], "text");
    assert_eq!(warning["nodeId"], "t1");
    assert!(
        warning["message"]
            .as_str()
            .is_some_and(|message| !message.is_empty())
    );
}

#[test]
fn rejects_rich_text_beyond_maximum_depth_before_layout() {
    let error = compute_full_layout(&rich_text_layout_input(MAX_RICH_TEXT_DEPTH + 1))
        .expect_err("over-depth rich text should be rejected");
    match error {
        crate::error::EngineError::Validation(message) => {
            assert!(message.contains("rich text exceeds max depth (48)"));
            assert!(message.contains("text-boundary"));
            assert!(message.contains("actual depth 49"));
        }
        other => panic!("expected validation error, got {other:?}"),
    }
}

#[test]
fn inline_rect_wire_validation_rejects_invalid_values() {
    let input = inline_rect_wire_input(&serde_json::json!([{
        "kind": "inlineRect",
        "fragmentId": "text:inline-rect:0",
        "inlineSizePx": -1.0,
        "blockSizePx": "not-line",
        "color": "not-a-color"
    }]));
    let error = compute_full_layout(&input).expect_err("invalid inline rect should fail");
    assert_structured_error_code(error, "INLINE_RECT_INVALID");
}

#[test]
fn inline_rect_wire_validation_rejects_ruby_parent() {
    let input = inline_rect_wire_input(&serde_json::json!([{
        "kind": "ruby",
        "style": { "fontSizePx": 16.0 },
        "base": [{
            "kind": "inlineRect",
            "fragmentId": "text:inline-rect:0",
            "inlineSizePx": 2.0,
            "color": "#000"
        }],
        "rt": [{ "kind": "text", "text": "ルビ" }]
    }]));
    let error = compute_full_layout(&input).expect_err("ruby inline rect should fail");
    assert_structured_error_code(error, "INLINE_RECT_INVALID_PARENT");
}

#[test]
fn inline_rect_wire_validation_enforces_resource_limit() {
    let rich_text = (0..=crate::text::types::MAX_INLINE_RECTS)
        .map(|index| {
            serde_json::json!({
                "kind": "inlineRect",
                "fragmentId": format!("text:inline-rect:{index}"),
                "inlineSizePx": 2.0,
                "color": "#000"
            })
        })
        .collect::<Vec<_>>();
    let input = inline_rect_wire_input(&serde_json::Value::Array(rich_text));
    let error = compute_full_layout(&input).expect_err("inline rect limit should fail");
    assert_structured_error_code(error, "INLINE_RECT_COMPLEXITY_LIMIT");
}

#[test]
fn accepts_rich_text_base_decoration_without_mirrored_spans() {
    compute_full_layout(&rich_base_decoration_wire_input(1, false))
        .expect("rich text should carry its own decoration ranges");
}

#[test]
fn rejects_unmirrored_rich_text_decoration_with_unit_animation() {
    let error = compute_full_layout(&rich_base_decoration_wire_input(1, true))
        .expect_err("decorated rich text unit animation should be rejected");
    assert_structured_error_code(error, "TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED");
}

#[test]
fn rejects_unmirrored_rich_text_decoration_beyond_range_limit() {
    let error = compute_full_layout(&rich_base_decoration_wire_input(4_097, false))
        .expect_err("over-budget rich text decoration should be rejected");
    assert_structured_error_code(error, "TEXT_DECORATION_RANGE_LIMIT");
}

#[test]
fn rejects_over_budget_rich_text_even_when_unrelated_spans_are_present() {
    let mut input = rich_base_decoration_wire_input(4_097, false);
    input.root.children[0]
        .text
        .as_mut()
        .expect("text input")
        .spans = Some(vec![
        serde_json::from_value(serde_json::json!({
            "text": "x",
            "fontSizePx": 16.0
        }))
        .expect("dummy span"),
    ]);

    let error = compute_full_layout(&input)
        .expect_err("unrelated spans must not hide rich decoration ranges");
    assert_structured_error_code(error, "TEXT_DECORATION_RANGE_LIMIT");
}

#[test]
fn rejects_over_budget_combine_fallback_ranges_when_run_text_mismatches() {
    let mut input = rich_base_decoration_wire_input(1, false);
    let text = input.root.children[0].text.as_mut().expect("text input");
    text.content = "x".repeat(4_097);
    text.rich_text = Some(
        serde_json::from_value(serde_json::Value::Array(
            (0..4_097)
                .map(|_| {
                    serde_json::json!({
                        "kind": "combine",
                        "text": "x",
                        "style": {
                            "fontSizePx": 16.0,
                            "textDecoration": {
                                "line": ["underline"],
                                "color": "#ff0000",
                                "style": "solid",
                                "offsetPx": 0.0
                            }
                        },
                        "decorationRuns": [{ "text": "mismatch" }]
                    })
                })
                .collect(),
        ))
        .expect("combine rich text"),
    );

    let error = compute_full_layout(&input)
        .expect_err("mismatched paint runs must use the combine style range count");
    assert_structured_error_code(error, "TEXT_DECORATION_RANGE_LIMIT");
}

#[test]
fn text_unit_cluster_ids_survive_real_reflow() {
    let content = "天地玄黄宇宙洪荒日月盈昃";
    let wide = text_unit_map(&text_unit_layout_input(
        content,
        240.0,
        None,
        crate::text::unit_map::TextUnitKind::Cluster,
        crate::text::unit_map::TextUnitRubyMode::WithBase,
    ));
    let narrow = text_unit_map(&text_unit_layout_input(
        content,
        64.0,
        None,
        crate::text::unit_map::TextUnitKind::Cluster,
        crate::text::unit_map::TextUnitRubyMode::WithBase,
    ));
    let wide_ids: std::collections::BTreeSet<&str> = wide
        .units
        .iter()
        .map(|unit| unit.unit_id.as_str())
        .collect();
    let narrow_ids: std::collections::BTreeSet<&str> = narrow
        .units
        .iter()
        .map(|unit| unit.unit_id.as_str())
        .collect();
    assert_eq!(wide_ids, narrow_ids);
    assert!(
        wide.units
            .iter()
            .zip(&narrow.units)
            .any(|(wide_unit, narrow_unit)| wide_unit.line_id != narrow_unit.line_id),
        "reflow should change at least one layout-local line identity",
    );
}

#[test]
fn text_unit_line_map_supports_vertical_columns_and_camel_case_transport() {
    let input = text_unit_layout_input(
        "縦書きの列を複数に分ける確認文です",
        120.0,
        Some("vertical-rl"),
        crate::text::unit_map::TextUnitKind::Line,
        crate::text::unit_map::TextUnitRubyMode::WithBase,
    );
    let output = compute_full_layout(&input).expect("vertical line unit layout");
    let text_layout = output
        .nodes
        .iter()
        .find(|node| node.node_id == "unit-text")
        .and_then(|node| node.text_layout.as_ref())
        .expect("text layout");
    let unit_map = text_layout.unit_map.as_ref().expect("unit map");
    assert_eq!(unit_map.kind, crate::text::unit_map::TextUnitKind::Line);
    assert_eq!(
        unit_map.units.len(),
        text_layout.lines.as_ref().expect("vertical lines").len(),
    );
    assert!(
        unit_map
            .units
            .iter()
            .all(|unit| unit.line_id.starts_with("line:v:"))
    );

    let json = serde_json::to_value(&output).expect("layout transport JSON");
    let transported = &json["nodes"][1]["textLayout"]["unitMap"];
    assert_eq!(transported["kind"], "line");
    assert_eq!(transported["ruby"], "with-base");
    assert!(transported["units"][0]["members"][0]["lineIndex"].is_number());
    assert!(transported["units"][0]["members"][0]["glyphIndex"].is_number());
}

#[test]
fn text_unit_ruby_modes_use_real_rich_text_membership() {
    fn ruby_input(ruby: crate::text::unit_map::TextUnitRubyMode) -> LayoutInput {
        let mut input = text_unit_layout_input(
            "",
            180.0,
            None,
            crate::text::unit_map::TextUnitKind::Cluster,
            ruby,
        );
        let text = input.root.children[0].text.as_mut().expect("text input");
        text.rich_text = Some(vec![
            RichTextNodeInput::Ruby {
                ruby_position: Some("over".into()),
                ruby_align: Some("center".into()),
                ruby_gap_px: None,
                ruby_offset_px: None,
                ruby_line_sizing: None,
                style: rich_text_style(),
                base: vec![RichTextNodeInput::Text {
                    text: "東京".into(),
                }],
                rt: vec![RichTextNodeInput::Text {
                    text: "とうきょう".into(),
                }],
                rt_levels: Vec::new(),
            },
            RichTextNodeInput::Text { text: "駅".into() },
        ]);
        input
    }

    let with_base = text_unit_map(&ruby_input(
        crate::text::unit_map::TextUnitRubyMode::WithBase,
    ));
    let separate = text_unit_map(&ruby_input(
        crate::text::unit_map::TextUnitRubyMode::Separate,
    ));
    let composite = with_base
        .units
        .iter()
        .find(|unit| {
            unit.members.iter().any(|member| {
                member.source_role == crate::text::unit_map::TextUnitSourceRole::RubyAnnotation
            })
        })
        .expect("ruby composite unit");
    assert!(
        composite
            .members
            .iter()
            .any(|member| member.source_role == crate::text::unit_map::TextUnitSourceRole::RubyBase)
    );
    assert!(separate.units.len() > with_base.units.len());

    let mut ruby_units: Vec<&crate::text::unit_map::TextUnitMapEntry> = separate
        .units
        .iter()
        .filter(|unit| unit.source_start < 2)
        .collect();
    ruby_units.sort_by_key(|unit| unit.logical_order);
    let annotation_start = ruby_units
        .iter()
        .position(|unit| {
            unit.members[0].source_role == crate::text::unit_map::TextUnitSourceRole::RubyAnnotation
        })
        .expect("annotation units");
    assert!(ruby_units[..annotation_start].iter().all(|unit| {
        unit.members[0].source_role == crate::text::unit_map::TextUnitSourceRole::RubyBase
    }));
}

#[test]
fn text_unit_map_preserves_real_combining_cjk_and_emoji_sources() {
    let combining = text_unit_map(&text_unit_layout_input(
        "e\u{301}",
        320.0,
        None,
        crate::text::unit_map::TextUnitKind::Cluster,
        crate::text::unit_map::TextUnitRubyMode::WithBase,
    ));
    assert_eq!(
        combining.units.len(),
        1,
        "a base plus combining mark must remain one shaping unit: {:?}",
        combining.units,
    );
    assert_eq!(combining.units[0].source_start, 0);
    assert!(combining.units[0].source_end > 0);

    // Source offsets use the active grapheme segmentation: the default build
    // counts code points while `unicode-full` counts extended graphemes. The
    // shaping-unit contract is identical in both configurations.
    let cjk = text_unit_map(&text_unit_layout_input(
        "漢",
        320.0,
        None,
        crate::text::unit_map::TextUnitKind::Cluster,
        crate::text::unit_map::TextUnitRubyMode::WithBase,
    ));
    assert_eq!(cjk.units.len(), 1);
    assert_eq!(cjk.units[0].source_start, 0);
    assert!(cjk.units[0].source_end > 0);

    let emoji = text_unit_map(&text_unit_layout_input(
        "👨‍👩‍👧‍👦",
        320.0,
        None,
        crate::text::unit_map::TextUnitKind::Cluster,
        crate::text::unit_map::TextUnitRubyMode::WithBase,
    ));
    assert!(
        !emoji.units.is_empty()
            && emoji.units.iter().all(|unit| {
                unit.source_start == 0 && unit.source_end > 0 && !unit.members.is_empty()
            }),
        "emoji fallback clusters must retain the logical emoji source: {:?}",
        emoji.units,
    );
}

#[test]
fn text_unit_map_supports_single_and_multiline_ellipsis() {
    for content in [
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "結合e\u{301}文字と日本語の長い文章です",
        "絵文字👨‍👩‍👧‍👦を含む長い文章です",
    ] {
        for max_lines in [1, 2] {
            let mut input = text_unit_layout_input(
                content,
                64.0,
                None,
                crate::text::unit_map::TextUnitKind::Cluster,
                crate::text::unit_map::TextUnitRubyMode::WithBase,
            );
            let text = input.root.children[0].text.as_mut().expect("text input");
            text.max_lines = Some(max_lines);
            text.ellipsis = Some(true);

            let unit_map = text_unit_map(&input);
            assert!(!unit_map.units.is_empty());
            assert_eq!(
                unit_map.units.iter().map(|unit| unit.source_end).max(),
                Some(
                    u32::try_from(crate::text::grapheme::grapheme_split(content).len())
                        .expect("source count"),
                ),
                "ellipsis must retain the omitted source tail for {content:?} at maxLines={max_lines}",
            );
            assert!(
                unit_map.units.iter().any(|unit| unit.members.is_empty()),
                "omitted source units must remain addressable without borrowing the synthetic marker for {content:?} at maxLines={max_lines}",
            );
        }
    }
}

#[test]
fn text_unit_map_supports_ruby_multiline_ellipsis() {
    let mut input = text_unit_layout_input(
        "",
        72.0,
        None,
        crate::text::unit_map::TextUnitKind::Cluster,
        crate::text::unit_map::TextUnitRubyMode::WithBase,
    );
    let text = input.root.children[0].text.as_mut().expect("text input");
    text.max_lines = Some(2);
    text.ellipsis = Some(true);
    text.rich_text = Some(vec![
        RichTextNodeInput::Ruby {
            ruby_position: Some("over".into()),
            ruby_align: Some("center".into()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: rich_text_style(),
            base: vec![RichTextNodeInput::Text {
                text: "東京".into(),
            }],
            rt: vec![RichTextNodeInput::Text {
                text: "とうきょう".into(),
            }],
            rt_levels: Vec::new(),
        },
        RichTextNodeInput::Text {
            text: "駅から長い文章が続きます".into(),
        },
    ]);

    let unit_map = text_unit_map(&input);
    assert!(!unit_map.units.is_empty());
    assert!(unit_map.units.iter().any(|unit| {
        unit.members.iter().any(|member| {
            member.source_role == crate::text::unit_map::TextUnitSourceRole::RubyAnnotation
        })
    }));
}

#[test]
fn text_measurement_fails_before_unit_map_materialization() {
    let mut input = text_unit_layout_input(
        "missing font",
        120.0,
        None,
        crate::text::unit_map::TextUnitKind::Cluster,
        crate::text::unit_map::TextUnitRubyMode::WithBase,
    );
    input.fonts.clear();
    let error = compute_full_layout(&input).expect_err("unit metadata requires resolved text");
    match error {
        crate::error::EngineError::Structured {
            code,
            stage,
            node_id,
            ..
        } => {
            assert_eq!(code, "TEXT_NO_LAYOUT");
            assert_eq!(
                stage.as_ref(),
                Some(&crate::diagnostics::PipelineStage::Text)
            );
            assert_eq!(node_id.as_deref(), Some("unit-text"));
        }
        other => panic!("expected structured unit-map error, got {other:?}"),
    }
}

#[test]
fn text_measurement_surfaces_the_ellipsis_candidate_limit() {
    let source = "あ".repeat(1_025);
    let mut input = text_unit_layout_input(
        &source,
        1.0,
        None,
        crate::text::unit_map::TextUnitKind::Cluster,
        crate::text::unit_map::TextUnitRubyMode::WithBase,
    );
    let text = input.root.children[0].text.as_mut().expect("text input");
    text.max_lines = Some(1);
    text.ellipsis = Some(true);

    let error = compute_full_layout(&input).expect_err("exact projection must be bounded");
    assert_structured_error_code(error, "TEXT_ELLIPSIS_CANDIDATE_LIMIT");
}

#[test]
fn ordinary_text_measurement_surfaces_the_content_fit_probe_limit() {
    let mut input = text_unit_layout_input(
        "negative tracking fit",
        120.0,
        None,
        crate::text::unit_map::TextUnitKind::Cluster,
        crate::text::unit_map::TextUnitRubyMode::WithBase,
    );
    let text = input.root.children[0].text.as_mut().expect("text input");
    text.letter_spacing_px = Some(-1.0);
    text.fit = Some("shrink".to_string());
    text.min_font_size_px = Some(8.0);
    text.shrink_epsilon_px = Some(0.25);
    text.fit_max_probes = Some(1);

    let error = compute_full_layout(&input).expect_err("ordinary exact fit must be bounded");
    assert_structured_error_code(error, "TEXT_FIT_PROBE_LIMIT");
}

#[test]
fn text_measure_cache_separates_fit_probe_budgets() {
    let mut registry = FontRegistry::new();
    registry
        .register(
            test_font_data(),
            "NotoSansJP".into(),
            400,
            FontStyle::Normal,
        )
        .expect("font registration should succeed");

    let mut permissive = plain_text_input("negative tracking fit", 32.0, "char");
    permissive.letter_spacing_px = Some(-1.0);
    permissive.fit = Some("shrink".to_string());
    permissive.min_font_size_px = Some(8.0);
    permissive.shrink_epsilon_px = Some(0.25);
    permissive.fit_max_probes = Some(128);
    let mut constrained = plain_text_input("negative tracking fit", 32.0, "char");
    constrained.letter_spacing_px = Some(-1.0);
    constrained.fit = Some("shrink".to_string());
    constrained.min_font_size_px = Some(8.0);
    constrained.shrink_epsilon_px = Some(0.25);
    constrained.fit_max_probes = Some(1);

    let available_space = Size {
        width: AvailableSpace::Definite(50.0),
        height: AvailableSpace::Definite(20.0),
    };
    let mut measure_cache = HashMap::new();
    let mut measure_cache_hits = 0;
    let mut shrink_to_fit_widths = HashMap::new();
    let mut shaped_cache = HashMap::new();
    let mut text_results = HashMap::new();

    measure_text_node(
        &permissive,
        &registry,
        None,
        Size::NONE,
        available_space,
        &mut measure_cache,
        &mut measure_cache_hits,
        &mut shrink_to_fit_widths,
        &mut shaped_cache,
        NodeId::new(1),
        &mut text_results,
    )
    .expect("the permissive exact-fit budget should complete");

    let error = measure_text_node(
        &constrained,
        &registry,
        None,
        Size::NONE,
        available_space,
        &mut measure_cache,
        &mut measure_cache_hits,
        &mut shrink_to_fit_widths,
        &mut shaped_cache,
        NodeId::new(2),
        &mut text_results,
    )
    .expect_err("a cached result must not bypass the constrained probe budget");
    assert_structured_error_code(error, "TEXT_FIT_PROBE_LIMIT");
}

#[test]
fn test_simple_layout() {
    let input = LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(400.0),
                height: Some(300.0),
                flex_direction: Some("column".into()),
                ..Default::default()
            },
            children: vec![
                LayoutNodeInput {
                    node_id: "box1".into(),
                    node_type: "box".into(),
                    authored_id: true,
                    style: TaffyStyleInput {
                        width: Some(200.0),
                        height: Some(100.0),
                        ..Default::default()
                    },
                    children: vec![],
                    text: None,
                    text_path: None,
                    image: None,
                    visual: None,
                },
                LayoutNodeInput {
                    node_id: "box2".into(),
                    node_type: "box".into(),
                    authored_id: true,
                    style: TaffyStyleInput {
                        width: Some(200.0),
                        height: Some(100.0),
                        ..Default::default()
                    },
                    children: vec![],
                    text: None,
                    text_path: None,
                    image: None,
                    visual: None,
                },
            ],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![],
    };

    let output = compute_full_layout(&input).unwrap();
    assert_eq!(output.nodes.len(), 3); // canvas + 2 boxes

    let canvas = &output.nodes[0];
    assert_eq!(canvas.node_id, "canvas");
    assert_eq!(canvas.width, 400.0);
    assert_eq!(canvas.height, 300.0);

    let box1 = &output.nodes[1];
    assert_eq!(box1.node_id, "box1");
    assert_eq!(box1.x, 0.0);
    assert_eq!(box1.y, 0.0);
    assert_eq!(box1.width, 200.0);

    let box2 = &output.nodes[2];
    assert_eq!(box2.node_id, "box2");
    assert_eq!(box2.x, 0.0);
    assert_eq!(box2.y, 100.0); // Stacked below box1 in column direction
}

#[test]
fn test_preferred_frame_constrains_text_measurement_inside_definite_layout_size() {
    fn compute_text_layout(is_vertical: bool, preferred_size: Option<f32>) -> LayoutNodeOutput {
        let input = LayoutInput {
            root: LayoutNodeInput {
                node_id: "canvas".into(),
                node_type: "canvas".into(),
                authored_id: true,
                style: TaffyStyleInput {
                    width: Some(400.0),
                    height: Some(400.0),
                    flex_direction: Some("column".into()),
                    ..Default::default()
                },
                children: vec![LayoutNodeInput {
                    node_id: "text".into(),
                    node_type: "text".into(),
                    authored_id: true,
                    style: TaffyStyleInput {
                        width: (!is_vertical).then_some(280.0),
                        height: is_vertical.then_some(280.0),
                        ..Default::default()
                    },
                    children: vec![],
                    text: Some(TextInput {
                        preferred_frame: preferred_size.map(|size| PreferredFrame {
                            w: (!is_vertical).then_some(size),
                            h: is_vertical.then_some(size),
                        }),
                        writing_mode: is_vertical.then(|| "vertical-rl".into()),
                        text_orientation: is_vertical.then(|| "upright".into()),
                        ..plain_text_input(
                            "天地玄黄宇宙洪荒日月盈昃辰宿列張寒来暑往秋収冬蔵",
                            20.0,
                            "char",
                        )
                    }),
                    text_path: None,
                    image: None,
                    visual: None,
                }],
                text: None,
                text_path: None,
                image: None,
                visual: None,
            },
            fonts: vec![FontInput {
                alias: "NotoSansJP".into(),
                weight: 400,
                style: FontStyle::Normal,
                data: test_font_data(),
            }],
        };

        compute_full_layout(&input)
            .expect("layout should succeed")
            .nodes
            .into_iter()
            .find(|node| node.node_id == "text")
            .expect("text node should exist")
    }

    let horizontal_without = compute_text_layout(false, None);
    let horizontal_without_lines = horizontal_without
        .text_layout
        .expect("horizontal layout without preferred frame")
        .lines
        .expect("horizontal lines without preferred frame")
        .len();
    let horizontal = compute_text_layout(false, Some(80.0));
    let horizontal_layout = horizontal.text_layout.expect("horizontal text layout");
    let horizontal_bbox = horizontal_layout.bbox.expect("horizontal text bbox");
    assert_eq!(
        horizontal.width, 280.0,
        "authored layout width must remain definite"
    );
    assert!(
        horizontal_bbox.w <= 80.01,
        "preferred width must constrain text measurement"
    );
    assert!(
        horizontal_layout.lines.expect("horizontal lines").len() > horizontal_without_lines,
        "preferred width must produce narrower line breaking"
    );

    let vertical_without = compute_text_layout(true, None);
    let vertical_without_lines = vertical_without
        .text_layout
        .expect("vertical layout without preferred frame")
        .lines
        .expect("vertical columns without preferred frame")
        .len();
    let vertical = compute_text_layout(true, Some(80.0));
    let vertical_layout = vertical.text_layout.expect("vertical text layout");
    let vertical_bbox = vertical_layout.bbox.expect("vertical text bbox");
    assert_eq!(
        vertical.height, 280.0,
        "authored layout height must remain definite"
    );
    assert!(
        vertical_bbox.h <= 80.01,
        "preferred height must constrain text measurement"
    );
    assert!(
        vertical_layout.lines.expect("vertical columns").len() > vertical_without_lines,
        "preferred height must produce shorter columns"
    );
}

#[test]
fn test_preferred_frame_does_not_clamp_min_content_queries() {
    fn measure_min_content(is_vertical: bool, with_preferred_frame: bool) -> Size<f32> {
        let mut font_registry = FontRegistry::new();
        font_registry
            .register(
                test_font_data(),
                "NotoSansJP".into(),
                400,
                FontStyle::Normal,
            )
            .expect("font registration should succeed");
        let text_input = TextInput {
            preferred_frame: with_preferred_frame.then(|| PreferredFrame {
                w: (!is_vertical).then_some(5.0),
                h: is_vertical.then_some(5.0),
            }),
            writing_mode: is_vertical.then(|| "vertical-rl".into()),
            text_orientation: is_vertical.then(|| "upright".into()),
            ..plain_text_input("天地玄黄宇宙洪荒", 20.0, "char")
        };
        let available_space = if is_vertical {
            Size {
                width: AvailableSpace::MaxContent,
                height: AvailableSpace::MinContent,
            }
        } else {
            Size {
                width: AvailableSpace::MinContent,
                height: AvailableSpace::MaxContent,
            }
        };
        let mut measure_cache = HashMap::new();
        let mut measure_cache_hits = 0;
        let mut shrink_to_fit_widths = HashMap::new();
        let mut shaped_cache = HashMap::new();
        let mut text_results = HashMap::new();

        measure_text_node(
            &text_input,
            &font_registry,
            None,
            Size::NONE,
            available_space,
            &mut measure_cache,
            &mut measure_cache_hits,
            &mut shrink_to_fit_widths,
            &mut shaped_cache,
            NodeId::new(1),
            &mut text_results,
        )
        .expect("text measurement")
    }

    assert_eq!(
        measure_min_content(false, true),
        measure_min_content(false, false),
        "horizontal min-content width must ignore preferredFrame.w"
    );
    assert_eq!(
        measure_min_content(true, true),
        measure_min_content(true, false),
        "vertical min-content height must ignore preferredFrame.h"
    );
}

#[test]
fn centered_column_text_uses_intrinsic_width_and_resolved_height() {
    let output = compute_full_layout(&centered_column_text_input()).expect("layout should succeed");
    let first = output
        .nodes
        .iter()
        .find(|node| node.node_id == "t1")
        .expect("first text layout");
    let second = output
        .nodes
        .iter()
        .find(|node| node.node_id == "t2")
        .expect("second text layout");
    let first_text = first.text_layout.as_ref().expect("first text result");
    let second_text = second.text_layout.as_ref().expect("second text result");

    assert_eq!(first_text.lines.as_ref().map(Vec::len), Some(1));
    assert_eq!(second_text.lines.as_ref().map(Vec::len), Some(1));
    assert!(
        (f64::from(first.width) - first_text.measured_width).abs() < 1.0,
        "first layout width={} measured width={} bbox={:?}",
        first.width,
        first_text.measured_width,
        first_text.bbox
    );
    assert!(
        (f64::from(second.width) - second_text.measured_width).abs() < 1.0,
        "second layout width={} measured width={} bbox={:?}",
        second.width,
        second_text.measured_width,
        second_text.bbox
    );
    assert!(
        (f64::from(first.height) - first_text.measured_height).abs() < 1.0,
        "first layout height={} measured height={}",
        first.height,
        first_text.measured_height
    );
    assert!(
        (f64::from(second.height) - second_text.measured_height).abs() < 1.0,
        "second layout height={} measured height={}",
        second.height,
        second_text.measured_height
    );
    assert!(first.y + first.height <= second.y);
}

#[test]
fn test_flex_grow_center_does_not_overflow_left_edge() {
    let input = LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(800.0),
                height: Some(600.0),
                flex_direction: Some("column".into()),
                ..Default::default()
            },
            children: vec![LayoutNodeInput {
                node_id: "outer".into(),
                node_type: "flex".into(),
                authored_id: true,
                style: TaffyStyleInput {
                    width: Some(800.0),
                    height: Some(600.0),
                    flex_direction: Some("row".into()),
                    justify_content: Some("center".into()),
                    align_items: Some("stretch".into()),
                    padding: Some([40.0, 40.0, 40.0, 40.0]),
                    gap: Some(32.0),
                    ..Default::default()
                },
                children: vec![
                    LayoutNodeInput {
                        node_id: "left".into(),
                        node_type: "flex".into(),
                        authored_id: true,
                        style: TaffyStyleInput {
                            flex_direction: Some("column".into()),
                            flex_grow: Some(1.0),
                            ..Default::default()
                        },
                        children: vec![
                            LayoutNodeInput {
                                node_id: "label".into(),
                                node_type: "text".into(),
                                authored_id: true,
                                style: TaffyStyleInput::default(),
                                children: vec![],
                                text: Some(plain_text_input(
                                    "NFC正規化テスト (横書き)",
                                    14.0,
                                    "char",
                                )),
                                text_path: None,
                                image: None,
                                visual: None,
                            },
                            LayoutNodeInput {
                                node_id: "body".into(),
                                node_type: "text".into(),
                                authored_id: true,
                                style: TaffyStyleInput::default(),
                                children: vec![],
                                text: Some(plain_text_input(
                                    "NFD濁点テスト：か\u{3099}き\u{3099}く\u{3099}。波ダッシュ～変換テスト〜。",
                                    28.0,
                                    "char",
                                )),
                                text_path: None,
                                image: None,
                                visual: None,
                            },
                        ],
                        text: None,
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                    LayoutNodeInput {
                        node_id: "right".into(),
                        node_type: "flex".into(),
                        authored_id: true,
                        style: TaffyStyleInput {
                            flex_direction: Some("column".into()),
                            flex_grow: Some(1.0),
                            ..Default::default()
                        },
                        children: vec![LayoutNodeInput {
                            node_id: "vertical".into(),
                            node_type: "text".into(),
                            authored_id: true,
                            style: TaffyStyleInput::default(),
                            children: vec![],
                            text: Some(TextInput {
                                writing_mode: Some("vertical-rl".into()),
                                ..plain_text_input(
                                    "縦書きでABCと123の位置を確認。句読点（。、）も正しく配置される。",
                                    22.0,
                                    "char",
                                )
                            }),
                            text_path: None,
                            image: None,
                            visual: None,
                        }],
                        text: None,
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                ],
                text: None,
                text_path: None,
                image: None,
                visual: None,
            }],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![FontInput {
            alias: "NotoSansJP".into(),
            weight: 400,
            style: FontStyle::Normal,
            data: test_font_data(),
        }],
    };

    let output = compute_full_layout(&input).unwrap();
    let label = output
        .nodes
        .iter()
        .find(|node| node.node_id == "label")
        .unwrap();
    let body = output
        .nodes
        .iter()
        .find(|node| node.node_id == "body")
        .unwrap();
    let left = output
        .nodes
        .iter()
        .find(|node| node.node_id == "left")
        .unwrap();
    let right = output
        .nodes
        .iter()
        .find(|node| node.node_id == "right")
        .unwrap();

    assert!(
        label.x >= 40.0,
        "label should stay inside outer padding: x={}",
        label.x
    );
    assert!(
        body.x >= 40.0,
        "body should stay inside outer padding: x={}",
        body.x
    );
    assert!(
        left.width + right.width <= 688.0,
        "grow columns should fit outer content width: left={} right={}",
        left.width,
        right.width
    );
}

#[test]
fn test_vertical_text_pushed_by_flex_spacer_keeps_multicolumn_width() {
    let input = LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(800.0),
                height: Some(300.0),
                flex_direction: Some("column".into()),
                ..Default::default()
            },
            children: vec![LayoutNodeInput {
                node_id: "outer".into(),
                node_type: "flex".into(),
                authored_id: true,
                style: TaffyStyleInput {
                    width: Some(800.0),
                    height: Some(300.0),
                    flex_direction: Some("row".into()),
                    padding: Some([20.0, 24.0, 20.0, 24.0]),
                    ..Default::default()
                },
                children: vec![
                    LayoutNodeInput {
                        node_id: "spacer".into(),
                        node_type: "flex".into(),
                        authored_id: true,
                        style: TaffyStyleInput {
                            flex_grow: Some(1.0),
                            ..Default::default()
                        },
                        children: vec![],
                        text: None,
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                    LayoutNodeInput {
                        node_id: "vtext".into(),
                        node_type: "text".into(),
                        authored_id: true,
                        style: TaffyStyleInput::default(),
                        children: vec![],
                        text: Some(TextInput {
                            writing_mode: Some("vertical-rl".into()),
                            hanging_punctuation: Some(true),
                            ..plain_text_input(
                                "縦書きのサンプルです。句読点（。、）は行頭禁則によりぶら下げ配置されます。長い文章でも自然な折り返しが行われ、読みやすいレイアウトを維持します。",
                                28.0,
                                "char",
                            )
                        }),
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                ],
                text: None,
                text_path: None,
                image: None,
                visual: None,
            }],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![FontInput {
            alias: "NotoSansJP".into(),
            weight: 400,
            style: FontStyle::Normal,
            data: test_font_data(),
        }],
    };

    let output = compute_full_layout(&input).unwrap();
    let vtext = output
        .nodes
        .iter()
        .find(|node| node.node_id == "vtext")
        .unwrap();

    assert!(
        vtext.x + vtext.width <= 776.5,
        "vertical text should stay inside right padding: x={} width={}",
        vtext.x,
        vtext.width
    );
    assert!(
        vtext.width > 100.0,
        "vertical text should keep its multi-column measured width: width={}",
        vtext.width
    );
}

#[test]
fn test_layout_with_text_measure() {
    let input = LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(800.0),
                height: Some(600.0),
                flex_direction: Some("column".into()),
                ..Default::default()
            },
            children: vec![LayoutNodeInput {
                node_id: "text1".into(),
                node_type: "text".into(),
                authored_id: true,
                style: TaffyStyleInput::default(),
                children: vec![],
                text: Some(TextInput {
                    content: "Hello World".into(),
                    spans: None,
                    rich_text: None,
                    font_size_px: 16.0,
                    line_height: None,
                    line_height_px: None,
                    letter_spacing_px: None,
                    text_indent: None,
                    font_family: vec!["NotoSansJP".into()],
                    font_weight: 400,
                    font_style: FontStyle::Normal,
                    wrap: "char".into(),
                    max_lines: None,
                    preferred_frame: None,
                    writing_mode: None,
                    language: None,
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
                    font_variation_settings: None,
                    font_feature_settings: None,
                    unit_map: None,
                    text_decoration_range_count: None,
                    white_space: None,
                    tab_size: None,
                    flow: None,
                }),
                text_path: None,
                image: None,
                visual: None,
            }],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![FontInput {
            alias: "NotoSansJP".into(),
            weight: 400,
            style: FontStyle::Normal,
            data: test_font_data(),
        }],
    };

    let output = compute_full_layout(&input).unwrap();
    assert!(
        output.measure_call_count > 0,
        "Text should trigger measure callbacks"
    );
    assert!(
        output.measure_call_count <= 6,
        "Measure should be called at most 6 times per text node"
    );

    let text_node = output.nodes.iter().find(|n| n.node_id == "text1").unwrap();
    assert!(text_node.width > 0.0);
    assert!(text_node.text_layout.is_some());
}

#[test]
fn test_layout_with_rich_text_fallback_produces_complete_text_layout() {
    let input = LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(320.0),
                height: Some(200.0),
                ..Default::default()
            },
            children: vec![LayoutNodeInput {
                node_id: "text1".into(),
                node_type: "text".into(),
                authored_id: true,
                style: TaffyStyleInput {
                    width: Some(200.0),
                    ..Default::default()
                },
                children: vec![],
                text: Some(TextInput {
                    content: "Hello".into(),
                    spans: None,
                    rich_text: Some(vec![RichTextNodeInput::Span {
                        text: "Hello".into(),
                        style: RichTextStyleInput {
                            font_family: vec!["NotoSansJP".into()],
                            font_weight: 700,
                            font_style: FontStyle::Normal,
                            font_size_px: 16.0,
                            line_height: None,
                            line_height_px: None,
                            letter_spacing_px: None,
                            language: None,
                            color: None,
                            text_strokes: None,
                            text_shadows: None,
                            font_variation_settings: None,
                            font_feature_settings: None,
                            text_orientation: None,
                            text_decoration: None,
                        },
                    }]),
                    font_size_px: 16.0,
                    line_height: None,
                    line_height_px: None,
                    letter_spacing_px: None,
                    text_indent: None,
                    font_family: vec!["NotoSansJP".into()],
                    font_weight: 400,
                    font_style: FontStyle::Normal,
                    wrap: "char".into(),
                    max_lines: None,
                    preferred_frame: None,
                    writing_mode: None,
                    language: None,
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
                    font_variation_settings: None,
                    font_feature_settings: None,
                    unit_map: None,
                    text_decoration_range_count: None,
                    white_space: Some("normal".into()),
                    tab_size: None,
                    flow: None,
                }),
                text_path: None,
                image: None,
                visual: None,
            }],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![FontInput {
            alias: "NotoSansJP".into(),
            weight: 400,
            style: FontStyle::Normal,
            data: test_font_data(),
        }],
    };

    let output = compute_full_layout(&input).unwrap();
    let text_node = output.nodes.iter().find(|n| n.node_id == "text1").unwrap();
    let text_layout = text_node
        .text_layout
        .as_ref()
        .expect("fallback text layout should exist");
    assert!(text_layout.lines.is_some());
    assert!(text_layout.bbox.is_some());
    assert!(text_layout.chosen_font_size_px.is_some());
}

#[test]
fn test_layout_with_image_measure() {
    let input = LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(400.0),
                height: Some(300.0),
                align_items: Some("flex-start".into()),
                ..Default::default()
            },
            children: vec![LayoutNodeInput {
                node_id: "img1".into(),
                node_type: "image".into(),
                authored_id: true,
                style: TaffyStyleInput::default(),
                children: vec![],
                text: None,
                text_path: None,
                image: Some(ImageInput {
                    width: 200.0,
                    height: 150.0,
                }),
                visual: None,
            }],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![],
    };

    let output = compute_full_layout(&input).unwrap();
    let img = output.nodes.iter().find(|n| n.node_id == "img1").unwrap();
    assert_eq!(img.width, 200.0);
    assert_eq!(img.height, 150.0);
}

#[test]
fn measure_call_count_is_bounded() {
    // Verify measure call count is reasonable (1-3 per node)
    let input = LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(1280.0),
                height: Some(720.0),
                flex_direction: Some("column".into()),
                ..Default::default()
            },
            children: vec![
                LayoutNodeInput {
                    node_id: "t1".into(),
                    node_type: "text".into(),
                    authored_id: true,
                    style: TaffyStyleInput::default(),
                    children: vec![],
                    text: Some(TextInput {
                        content: "テスト文字列です".into(),
                        spans: None,
                        rich_text: None,
                        font_size_px: 24.0,
                        line_height: None,
                        line_height_px: None,
                        letter_spacing_px: None,
                        text_indent: None,
                        font_family: vec!["NotoSansJP".into()],
                        font_weight: 400,
                        font_style: FontStyle::Normal,
                        wrap: "char".into(),
                        max_lines: None,
                        preferred_frame: None,
                        writing_mode: None,
                        language: None,
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
                        font_variation_settings: None,
                        font_feature_settings: None,
                        unit_map: None,
                        text_decoration_range_count: None,
                        white_space: None,
                        tab_size: None,
                        flow: None,
                    }),
                    text_path: None,
                    image: None,
                    visual: None,
                },
                LayoutNodeInput {
                    node_id: "t2".into(),
                    node_type: "text".into(),
                    authored_id: true,
                    style: TaffyStyleInput::default(),
                    children: vec![],
                    text: Some(TextInput {
                        content: "二つ目のテキスト".into(),
                        spans: None,
                        rich_text: None,
                        font_size_px: 20.0,
                        line_height: None,
                        line_height_px: None,
                        letter_spacing_px: None,
                        text_indent: None,
                        font_family: vec!["NotoSansJP".into()],
                        font_weight: 400,
                        font_style: FontStyle::Normal,
                        wrap: "char".into(),
                        max_lines: None,
                        preferred_frame: None,
                        writing_mode: None,
                        language: None,
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
                        font_variation_settings: None,
                        font_feature_settings: None,
                        unit_map: None,
                        text_decoration_range_count: None,
                        white_space: None,
                        tab_size: None,
                        flow: None,
                    }),
                    text_path: None,
                    image: None,
                    visual: None,
                },
                LayoutNodeInput {
                    node_id: "t3".into(),
                    node_type: "text".into(),
                    authored_id: true,
                    style: TaffyStyleInput::default(),
                    children: vec![],
                    text: Some(TextInput {
                        content: "三つ目のテキストブロック".into(),
                        spans: None,
                        rich_text: None,
                        font_size_px: 18.0,
                        line_height: None,
                        line_height_px: None,
                        letter_spacing_px: None,
                        text_indent: None,
                        font_family: vec!["NotoSansJP".into()],
                        font_weight: 400,
                        font_style: FontStyle::Normal,
                        wrap: "char".into(),
                        max_lines: None,
                        preferred_frame: None,
                        writing_mode: None,
                        language: None,
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
                        font_variation_settings: None,
                        font_feature_settings: None,
                        unit_map: None,
                        text_decoration_range_count: None,
                        white_space: None,
                        tab_size: None,
                        flow: None,
                    }),
                    text_path: None,
                    image: None,
                    visual: None,
                },
            ],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![FontInput {
            alias: "NotoSansJP".into(),
            weight: 400,
            style: FontStyle::Normal,
            data: test_font_data(),
        }],
    };

    let output = compute_full_layout(&input).unwrap();
    // 3 text nodes, each should be measured a reasonable number of times
    assert!(
        output.measure_call_count <= 15,
        "Measure count {} should be <= 15 (5 per node)",
        output.measure_call_count
    );
    assert!(
        output.measure_call_count >= 3,
        "Measure count {} should be >= 3 (at least 1 per node)",
        output.measure_call_count
    );
    eprintln!(
        "measure_call_count = {} for 3 text nodes ({:.1} per node)",
        output.measure_call_count,
        output.measure_call_count as f64 / 3.0
    );
}

#[test]
#[expect(
    clippy::cast_possible_truncation,
    reason = "f64 literal cast to f32 for assertion comparison; no precision concern"
)]
fn test_layout_multiline_text_measure() {
    // Integration test: multiline text through full layout pipeline
    let input = LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(200.0),
                height: Some(400.0),
                flex_direction: Some("column".into()),
                ..Default::default()
            },
            children: vec![LayoutNodeInput {
                node_id: "text1".into(),
                node_type: "text".into(),
                authored_id: true,
                style: TaffyStyleInput::default(),
                children: vec![],
                text: Some(TextInput {
                    content: "あいうえおかきくけこさしすせそ".into(),
                    spans: None,
                    rich_text: None,
                    font_size_px: 24.0,
                    line_height: None,
                    line_height_px: None,
                    letter_spacing_px: None,
                    text_indent: None,
                    font_family: vec!["NotoSansJP".into()],
                    font_weight: 400,
                    font_style: FontStyle::Normal,
                    wrap: "char".into(),
                    max_lines: None,
                    preferred_frame: None,
                    writing_mode: None,
                    language: None,
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
                    font_variation_settings: None,
                    font_feature_settings: None,
                    unit_map: None,
                    text_decoration_range_count: None,
                    white_space: None,
                    tab_size: None,
                    flow: None,
                }),
                text_path: None,
                image: None,
                visual: None,
            }],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![FontInput {
            alias: "NotoSansJP".into(),
            weight: 400,
            style: FontStyle::Normal,
            data: test_font_data(),
        }],
    };

    let output = compute_full_layout(&input).unwrap();
    let text_node = output.nodes.iter().find(|n| n.node_id == "text1").unwrap();
    // Text should wrap within 200px width and have height > 1 line
    assert!(
        text_node.width <= 200.0,
        "Text width {} should be <= 200",
        text_node.width
    );
    let line_height = 24.0 * 1.2; // default line height
    assert!(
        text_node.height > line_height as f32,
        "Text height {} should be > single line height {}",
        text_node.height,
        line_height
    );
}

#[test]
fn test_single_line_shrink_fit_respects_width_without_wrap() {
    let input = LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(680.0),
                height: Some(120.0),
                ..Default::default()
            },
            children: vec![LayoutNodeInput {
                node_id: "telop".into(),
                node_type: "text".into(),
                authored_id: true,
                style: TaffyStyleInput {
                    width: Some(680.0),
                    height: Some(80.0),
                    ..Default::default()
                },
                children: vec![],
                text: Some(TextInput {
                    fit: Some("shrink".into()),
                    ..plain_text_input(
                        "境界線を越えないように単一行テロップを幅いっぱいに縮小する",
                        64.0,
                        "none",
                    )
                }),
                text_path: None,
                image: None,
                visual: None,
            }],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![FontInput {
            alias: "NotoSansJP".into(),
            weight: 400,
            style: FontStyle::Normal,
            data: test_font_data(),
        }],
    };

    let output = compute_full_layout(&input).unwrap();
    let telop = output
        .nodes
        .iter()
        .find(|node| node.node_id == "telop")
        .unwrap();
    let text_layout = telop
        .text_layout
        .as_ref()
        .expect("fit=shrink should produce a text layout");
    let bbox = text_layout
        .bbox
        .as_ref()
        .expect("fit=shrink should return a resolved bbox");
    let chosen_font_size_px = text_layout
        .chosen_font_size_px
        .expect("fit=shrink should return a resolved font size");
    let lines = text_layout
        .lines
        .as_ref()
        .expect("fit=shrink should return resolved lines");

    assert_eq!(lines.len(), 1, "nowrap telop should stay on one line");
    assert!(
        chosen_font_size_px < 64.0,
        "font size should shrink below the requested size: {chosen_font_size_px}"
    );
    assert!(
        bbox.w <= 680.0 + 1.0,
        "resolved text width should fit the 680px bar: {}",
        bbox.w
    );
    assert!(
        telop.width <= 680.0,
        "layout node width should not exceed the fixed bar: {}",
        telop.width
    );
}

#[test]
fn test_grid_2x2_layout() {
    let input = LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(400.0),
                height: Some(300.0),
                ..Default::default()
            },
            children: vec![LayoutNodeInput {
                node_id: "grid".into(),
                node_type: "grid".into(),
                authored_id: true,
                style: TaffyStyleInput {
                    display: Some("grid".into()),
                    width: Some(400.0),
                    height: Some(300.0),
                    grid_template_columns: Some(vec!["200px".into(), "200px".into()]),
                    grid_template_rows: Some(vec!["150px".into(), "150px".into()]),
                    ..Default::default()
                },
                children: vec![
                    LayoutNodeInput {
                        node_id: "cell1".into(),
                        node_type: "box".into(),
                        authored_id: true,
                        style: TaffyStyleInput::default(),
                        children: vec![],
                        text: None,
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                    LayoutNodeInput {
                        node_id: "cell2".into(),
                        node_type: "box".into(),
                        authored_id: true,
                        style: TaffyStyleInput::default(),
                        children: vec![],
                        text: None,
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                    LayoutNodeInput {
                        node_id: "cell3".into(),
                        node_type: "box".into(),
                        authored_id: true,
                        style: TaffyStyleInput::default(),
                        children: vec![],
                        text: None,
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                    LayoutNodeInput {
                        node_id: "cell4".into(),
                        node_type: "box".into(),
                        authored_id: true,
                        style: TaffyStyleInput::default(),
                        children: vec![],
                        text: None,
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                ],
                text: None,
                text_path: None,
                image: None,
                visual: None,
            }],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![],
    };

    let output = compute_full_layout(&input).unwrap();

    let cell1 = output.nodes.iter().find(|n| n.node_id == "cell1").unwrap();
    let cell2 = output.nodes.iter().find(|n| n.node_id == "cell2").unwrap();
    let cell3 = output.nodes.iter().find(|n| n.node_id == "cell3").unwrap();
    let cell4 = output.nodes.iter().find(|n| n.node_id == "cell4").unwrap();

    // Cell 1: top-left (0, 0) 200x150
    assert_eq!(cell1.width, 200.0);
    assert_eq!(cell1.height, 150.0);

    // Cell 2: top-right (200, 0) 200x150
    assert!(
        (cell2.x - cell1.x - 200.0).abs() < 1.0,
        "cell2.x should be 200px right of cell1"
    );
    assert_eq!(cell2.width, 200.0);

    // Cell 3: bottom-left (0, 150) 200x150
    assert!(
        (cell3.y - cell1.y - 150.0).abs() < 1.0,
        "cell3.y should be 150px below cell1"
    );
    assert_eq!(cell3.width, 200.0);

    // Cell 4: bottom-right (200, 150) 200x150
    assert!(
        (cell4.x - cell3.x - 200.0).abs() < 1.0,
        "cell4.x should be 200px right of cell3"
    );
    assert!(
        (cell4.y - cell2.y - 150.0).abs() < 1.0,
        "cell4.y should be 150px below cell2"
    );
}

#[test]
fn test_grid_fr_ratio() {
    let input = LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(300.0),
                height: Some(100.0),
                ..Default::default()
            },
            children: vec![LayoutNodeInput {
                node_id: "grid".into(),
                node_type: "grid".into(),
                authored_id: true,
                style: TaffyStyleInput {
                    display: Some("grid".into()),
                    width: Some(300.0),
                    height: Some(100.0),
                    grid_template_columns: Some(vec!["1fr".into(), "2fr".into()]),
                    grid_template_rows: Some(vec!["100px".into()]),
                    ..Default::default()
                },
                children: vec![
                    LayoutNodeInput {
                        node_id: "col1".into(),
                        node_type: "box".into(),
                        authored_id: true,
                        style: TaffyStyleInput::default(),
                        children: vec![],
                        text: None,
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                    LayoutNodeInput {
                        node_id: "col2".into(),
                        node_type: "box".into(),
                        authored_id: true,
                        style: TaffyStyleInput::default(),
                        children: vec![],
                        text: None,
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                ],
                text: None,
                text_path: None,
                image: None,
                visual: None,
            }],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![],
    };

    let output = compute_full_layout(&input).unwrap();
    let col1 = output.nodes.iter().find(|n| n.node_id == "col1").unwrap();
    let col2 = output.nodes.iter().find(|n| n.node_id == "col2").unwrap();

    // 1fr : 2fr ratio → 100px : 200px
    assert!(
        (col1.width - 100.0).abs() < 1.0,
        "col1 width should be ~100px, got {}",
        col1.width
    );
    assert!(
        (col2.width - 200.0).abs() < 1.0,
        "col2 width should be ~200px, got {}",
        col2.width
    );
}

#[test]
fn test_grid_with_gap() {
    let input = LayoutInput {
        root: LayoutNodeInput {
            node_id: "canvas".into(),
            node_type: "canvas".into(),
            authored_id: true,
            style: TaffyStyleInput {
                width: Some(420.0),
                height: Some(320.0),
                ..Default::default()
            },
            children: vec![LayoutNodeInput {
                node_id: "grid".into(),
                node_type: "grid".into(),
                authored_id: true,
                style: TaffyStyleInput {
                    display: Some("grid".into()),
                    width: Some(420.0),
                    height: Some(320.0),
                    grid_template_columns: Some(vec!["200px".into(), "200px".into()]),
                    grid_template_rows: Some(vec!["150px".into(), "150px".into()]),
                    gap: Some(20.0),
                    ..Default::default()
                },
                children: vec![
                    LayoutNodeInput {
                        node_id: "c1".into(),
                        node_type: "box".into(),
                        authored_id: true,
                        style: TaffyStyleInput::default(),
                        children: vec![],
                        text: None,
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                    LayoutNodeInput {
                        node_id: "c2".into(),
                        node_type: "box".into(),
                        authored_id: true,
                        style: TaffyStyleInput::default(),
                        children: vec![],
                        text: None,
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                    LayoutNodeInput {
                        node_id: "c3".into(),
                        node_type: "box".into(),
                        authored_id: true,
                        style: TaffyStyleInput::default(),
                        children: vec![],
                        text: None,
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                    LayoutNodeInput {
                        node_id: "c4".into(),
                        node_type: "box".into(),
                        authored_id: true,
                        style: TaffyStyleInput::default(),
                        children: vec![],
                        text: None,
                        text_path: None,
                        image: None,
                        visual: None,
                    },
                ],
                text: None,
                text_path: None,
                image: None,
                visual: None,
            }],
            text: None,
            text_path: None,
            image: None,
            visual: None,
        },
        fonts: vec![],
    };

    let output = compute_full_layout(&input).unwrap();
    let c1 = output.nodes.iter().find(|n| n.node_id == "c1").unwrap();
    let c2 = output.nodes.iter().find(|n| n.node_id == "c2").unwrap();

    // c2 should be offset by 200 + 20(gap) = 220 from c1
    let gap_x = c2.x - c1.x - c1.width;
    assert!(
        (gap_x - 20.0).abs() < 1.0,
        "Column gap should be ~20px, got {gap_x}"
    );
}
