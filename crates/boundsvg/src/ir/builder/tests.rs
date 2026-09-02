//! IR builder tests using transport-level inputs (the same JSON shapes the
//! TS serializer produces), asserting on the serialized IR JSON so the tests
//! pin the public TS IR contract shape.

use std::collections::HashMap;

use serde_json::{Value, json};

use boundshape::MAX_GEOMETRY_TREE_DEPTH;

use super::{build_ir, parse_svg_content};
use crate::diagnostics::text_warning_to_recoverable;
use crate::error::EngineError;
use crate::layout::types::{LayoutNodeInput, LayoutNodeOutput, TextLayoutOutput};
use crate::text::types::{
    Line, TextBBox, TextDecorationFragment, TextDecorationLine, TextDecorationPaintPath,
    TextDecorationStyle, TextOverflow,
};

fn parse_node(mut node_json: Value) -> LayoutNodeInput {
    fn add_authored_id(node: &mut Value) {
        let object = node.as_object_mut().expect("node should be an object");
        object
            .entry("authoredId")
            .or_insert_with(|| Value::Bool(true));
        if let Some(Value::Array(children)) = object.get_mut("children") {
            for child in children {
                add_authored_id(child);
            }
        }
    }

    add_authored_id(&mut node_json);
    serde_json::from_value(node_json).expect("node JSON should deserialize")
}

fn output(node_id: &str, x: f32, y: f32, width: f32, height: f32) -> LayoutNodeOutput {
    LayoutNodeOutput {
        node_id: node_id.to_string(),
        x,
        y,
        width,
        height,
        text_layout: None,
    }
}

fn outputs_map(entries: Vec<LayoutNodeOutput>) -> HashMap<String, LayoutNodeOutput> {
    entries
        .into_iter()
        .map(|entry| (entry.node_id.clone(), entry))
        .collect()
}

fn build_json(root: Value, outputs: Vec<LayoutNodeOutput>) -> Value {
    let root_input = parse_node(root);
    let ir = build_ir(&root_input, &outputs_map(outputs)).expect("build_ir should succeed");
    public_ir_json(&ir)
}

fn public_ir_json(ir: &crate::ir::types::Ir) -> Value {
    let mut value = serde_json::to_value(ir.structural()).expect("structural IR should serialize");
    value
        .as_object_mut()
        .expect("structural IR should be an object")
        .insert(
            "warnings".to_string(),
            serde_json::to_value(&ir.warnings).expect("IR warnings should serialize"),
        );
    value
}

fn simple_text_layout(text: &str, w: f64, h: f64) -> TextLayoutOutput {
    TextLayoutOutput {
        glyphs: Vec::new(),
        measured_width: w,
        measured_height: h,
        lines: Some(vec![Line {
            text: text.to_string(),
            glyphs: Vec::new(),
            width: w,
            baseline_y: h * 0.8,
            fragments: None,
            positioned_glyphs: None,
        }]),
        bbox: Some(TextBBox {
            x: 0.0,
            y: 0.0,
            w,
            h,
        }),
        chosen_font_size_px: Some(16.0),
        overflow: Some(TextOverflow::none()),
        source_text: None,
        display_text: None,
        unit_map: None,
        warnings: Vec::new(),
        inline_box_decorations: Vec::new(),
        text_decorations: Vec::new(),
        inline_rects: Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Group / container behavior
// ---------------------------------------------------------------------------

#[test]
fn serializes_flat_nodes_with_type_tag_and_omits_unset_fields() {
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [],
        }),
        vec![output("root", 0.0, 0.0, 100.0, 50.0)],
    );

    assert_eq!(
        ir,
        json!({
            "root": {
                "type": "group",
                "nodeId": "root",
                "bbox": { "x": 0.0, "y": 0.0, "w": 100.0, "h": 50.0 },
            },
            "drawOrder": [],
            "width": 100.0,
            "height": 50.0,
            "warnings": [],
        })
    );
}

#[test]
fn builds_background_and_border_rects_in_draw_order() {
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [{
                "nodeId": "box",
                "nodeType": "box",
                "children": [],
                "visual": {
                    "background": "#fff",
                    "borderWidth": 2.0,
                    "borderColor": "#333",
                    "borderRadius": 4.0,
                    "strokeDasharray": "5,5",
                },
            }],
        }),
        vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("box", 10.0, 10.0, 50.0, 40.0),
        ],
    );

    assert_eq!(ir["drawOrder"], json!(["box:bg", "box:border"]));
    let box_children = &ir["root"]["children"][0]["children"];
    assert_eq!(
        box_children[0],
        json!({
            "type": "rect",
            "nodeId": "box:bg",
            "bbox": { "x": 10.0, "y": 10.0, "w": 50.0, "h": 40.0 },
            "fill": "#fff",
            "borderRadius": 4.0,
        })
    );
    assert_eq!(box_children[1]["stroke"], json!("#333"));
    assert_eq!(box_children[1]["strokeWidth"], json!(2.0));
    assert_eq!(box_children[1]["strokeDasharray"], json!("5,5"));
}

#[test]
fn carries_canvas_stroke_scaling_only_to_the_border_rect() {
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [{
                "nodeId": "box",
                "nodeType": "box",
                "children": [],
                "visual": {
                    "background": "#fff",
                    "borderWidth": 1.0,
                    "borderColor": "#333",
                    "strokeScaling": "canvas",
                },
            }],
        }),
        vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("box", 10.0, 10.0, 50.0, 40.0),
        ],
    );

    let box_children = &ir["root"]["children"][0]["children"];
    assert!(box_children[0].get("strokeScaling").is_none());
    assert_eq!(box_children[1]["strokeScaling"], json!("canvas"));
}

#[test]
fn carries_canvas_stroke_scaling_to_path_ir() {
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [{
                "nodeId": "path",
                "nodeType": "path",
                "children": [],
                "visual": {
                    "d": "M0 0L10 10",
                    "stroke": "#fff",
                    "strokeWidth": 1.0,
                    "strokeScaling": "canvas",
                },
            }],
        }),
        vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("path", 10.0, 10.0, 50.0, 40.0),
        ],
    );

    assert_eq!(
        ir["root"]["children"][0]["children"][0]["strokeScaling"],
        json!("canvas")
    );
}

#[test]
fn omits_unspecified_stroke_scaling_from_ir() {
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [{
                "nodeId": "box",
                "nodeType": "box",
                "children": [],
                "visual": {
                    "borderWidth": 1.0,
                    "borderColor": "#333",
                },
            }],
        }),
        vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("box", 10.0, 10.0, 50.0, 40.0),
        ],
    );

    assert!(
        ir["root"]["children"][0]["children"][0]
            .get("strokeScaling")
            .is_none()
    );
}

#[test]
fn keeps_authored_zero_border_radius() {
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [{
                "nodeId": "box",
                "nodeType": "box",
                "children": [],
                "visual": { "background": "#fff", "borderRadius": 0.0 },
            }],
        }),
        vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("box", 0.0, 0.0, 50.0, 40.0),
        ],
    );

    assert_eq!(
        ir["root"]["children"][0]["children"][0]["borderRadius"],
        json!(0.0)
    );
}

#[test]
fn parses_gradient_backgrounds() {
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [],
            "visual": { "background": "linear-gradient(to right, #ff0000, #0000ff)" },
        }),
        vec![output("root", 0.0, 0.0, 100.0, 100.0)],
    );

    let bg = &ir["root"]["children"][0];
    assert_eq!(bg["gradient"]["type"], json!("linear"));
    assert!(bg.get("fill").is_none());
}

#[test]
fn resolves_gradient_geometry_from_the_layout_box() {
    let linear_ir = build_json(
        json!({
            "nodeId": "linear",
            "nodeType": "canvas",
            "children": [],
            "visual": { "background": "linear-gradient(to top right, red, blue)" },
        }),
        vec![output("linear", 0.0, 0.0, 160.0, 90.0)],
    );
    let linear = &linear_ir["root"]["children"][0]["gradient"];
    assert!(
        (linear["angle"].as_f64().expect("linear angle") - 29.357_753_542_791_276).abs() < 1e-10
    );

    let radial_ir = build_json(
        json!({
            "nodeId": "radial",
            "nodeType": "canvas",
            "children": [],
            "visual": { "background": "radial-gradient(circle at 100% 100%, red, blue)" },
        }),
        vec![output("radial", 0.0, 0.0, 200.0, 100.0)],
    );
    let geometry = &radial_ir["root"]["children"][0]["gradient"]["geometry"];
    assert_eq!(geometry["centerX"], json!(200.0));
    assert_eq!(geometry["centerY"], json!(100.0));
    assert!(
        (geometry["radiusX"].as_f64().expect("radial radius") - 200.0_f64.hypot(100.0)).abs()
            < 1e-10
    );
    assert_eq!(geometry["radiusX"], geometry["radiusY"]);
}

#[test]
fn rejects_gradient_preludes_that_cannot_be_honored() {
    let root_input = parse_node(json!({
        "nodeId": "invalid-gradient",
        "nodeType": "canvas",
        "children": [],
        "visual": { "background": "linear-gradient(45degrees, red, blue)" },
    }));
    let error = build_ir(
        &root_input,
        &outputs_map(vec![output("invalid-gradient", 0.0, 0.0, 160.0, 90.0)]),
    )
    .expect_err("unknown gradient prelude must fail instead of changing direction");

    match error {
        crate::error::EngineError::Structured {
            code,
            stage,
            node_id,
            ..
        } => {
            assert_eq!(code, "VALIDATION");
            assert_eq!(stage.as_ref(), Some(&crate::diagnostics::PipelineStage::Ir));
            assert_eq!(node_id.as_deref(), Some("invalid-gradient"));
        }
        other => panic!("expected structured validation error, got {other:?}"),
    }
}

#[test]
fn sorts_container_children_by_z_index_stably() {
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [
                { "nodeId": "a", "nodeType": "box", "children": [], "visual": { "zIndex": 1.0 } },
                { "nodeId": "b", "nodeType": "box", "children": [] },
                { "nodeId": "c", "nodeType": "box", "children": [], "visual": { "zIndex": -1.0 } },
                { "nodeId": "d", "nodeType": "box", "children": [] },
            ],
        }),
        vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("a", 0.0, 0.0, 10.0, 10.0),
            output("b", 0.0, 0.0, 10.0, 10.0),
            output("c", 0.0, 0.0, 10.0, 10.0),
            output("d", 0.0, 0.0, 10.0, 10.0),
        ],
    );

    let order: Vec<&str> = ir["root"]["children"]
        .as_array()
        .expect("children array")
        .iter()
        .map(|child| child["nodeId"].as_str().expect("nodeId"))
        .collect();
    assert_eq!(order, vec!["c", "b", "d", "a"]);
}

#[test]
fn attaches_meta_transform_opacity_and_interactive_handlers_to_groups() {
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [{
                "nodeId": "card",
                "nodeType": "box",
                "children": [],
                "visual": {
                    "opacity": 0.5,
                    "meta": { "role": "card" },
                    "transform": { "rotateDeg": 45.0, "originX": 10.0, "originY": 10.0 },
                    "handlers": { "onClick": "select" },
                },
            }],
        }),
        vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("card", 0.0, 0.0, 50.0, 50.0),
        ],
    );

    let card = &ir["root"]["children"][0];
    assert_eq!(card["opacity"], json!(0.5));
    assert_eq!(card["meta"], json!({ "role": "card" }));
    assert_eq!(
        card["transform"],
        json!({ "rotateDeg": 45.0, "originX": 10.0, "originY": 10.0 })
    );
    assert_eq!(card["on"], json!({ "onClick": "select" }));
    // Interactive containers join drawOrder after their children
    assert_eq!(ir["drawOrder"], json!(["card"]));
}

#[test]
fn drops_identity_transform_and_full_opacity() {
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [{
                "nodeId": "box",
                "nodeType": "box",
                "children": [],
                "visual": {
                    "opacity": 1.0,
                    "transform": { "translateX": 0.0, "translateY": 0.0 },
                    "meta": {},
                },
            }],
        }),
        vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("box", 0.0, 0.0, 50.0, 50.0),
        ],
    );

    let node = &ir["root"]["children"][0];
    assert!(node.get("opacity").is_none());
    assert!(node.get("transform").is_none());
    assert!(node.get("meta").is_none());
}

#[test]
fn clips_overflow_and_rounded_images() {
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [{
                "nodeId": "img",
                "nodeType": "image",
                "children": [],
                "visual": {
                    "src": "data:image/png;base64,AA==",
                    "borderRadius": [1.0, 2.0, 3.0, 4.0],
                },
            }],
        }),
        vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("img", 0.0, 0.0, 40.0, 40.0),
        ],
    );

    let group = &ir["root"]["children"][0];
    assert_eq!(
        group["clipPath"],
        json!({ "x": 0.0, "y": 0.0, "w": 40.0, "h": 40.0 })
    );
    assert_eq!(
        group["clipBorderRadius"],
        json!({ "tl": 1.0, "tr": 2.0, "br": 3.0, "bl": 4.0 })
    );
}

#[test]
fn sets_canvas_debug_flag_only_when_true() {
    let with_debug = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [],
            "visual": { "debug": true },
        }),
        vec![output("root", 0.0, 0.0, 10.0, 10.0)],
    );
    assert_eq!(with_debug["debug"], json!(true));

    let without_debug = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [],
            "visual": { "debug": false },
        }),
        vec![output("root", 0.0, 0.0, 10.0, 10.0)],
    );
    assert!(without_debug.get("debug").is_none());
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

fn text_node_input(visual: &Value) -> Value {
    json!({
        "nodeId": "txt",
        "nodeType": "text",
        "children": [],
        "text": {
            "content": "hello",
            "fontSizePx": 16.0,
            "fontFamily": ["Main", "Fallback"],
            "writingMode": "horizontal-tb",
            "language": "en",
        },
        "visual": visual,
    })
}

fn text_outputs(
    layout_w: f32,
    layout_h: f32,
    measured_w: f64,
    measured_h: f64,
) -> Vec<LayoutNodeOutput> {
    let mut text_output = output("txt", 5.0, 5.0, layout_w, layout_h);
    text_output.text_layout = Some(simple_text_layout("hello", measured_w, measured_h));
    vec![output("root", 0.0, 0.0, 200.0, 100.0), text_output]
}

fn build_text_ir(visual: &Value, outputs: Vec<LayoutNodeOutput>) -> Value {
    build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [text_node_input(visual)],
        }),
        outputs,
    )
}

fn build_text_decoration_budget_ir(
    path_count: usize,
) -> Result<crate::ir::types::Ir, crate::error::EngineError> {
    build_text_decoration_complexity_ir(path_count, 1, 4)
}

fn build_text_decoration_complexity_ir(
    path_count: usize,
    contour_count: u32,
    segment_count: u32,
) -> Result<crate::ir::types::Ir, crate::error::EngineError> {
    let mut text_output = output("txt", 5.0, 5.0, 100.0, 20.0);
    let mut layout = simple_text_layout("hello", 60.0, 18.0);
    layout.text_decorations = vec![TextDecorationFragment {
        line: TextDecorationLine::Underline,
        style: TextDecorationStyle::Solid,
        color: "#111111".to_string(),
        skip_ink: crate::text::types::TextDecorationSkipInk::None,
        paths: vec![
            TextDecorationPaintPath {
                line_index: 0,
                d: "M0,-0.5L1,-0.5L1,0.5L0,0.5Z".to_string(),
                origin_x: 0.0,
                origin_y: 15.0,
                contour_count,
                segment_count,
                path_distance_start_px: None,
                path_distance_end_px: None,
                path_phase_origin_px: None,
                error: None,
                thickness_px: 1.0,
                decoration_owner_id: None,
                path_normal_offset_px: None,
                path_ribbon_half_width_px: None,
                path_sample_count: 0,
            };
            path_count
        ],
        source_start: 0,
        source_end: 5,
    }];
    text_output.text_layout = Some(layout);
    let root = parse_node(json!({
        "nodeId": "root",
        "nodeType": "canvas",
        "children": [text_node_input(&json!({}))],
    }));
    build_ir(
        &root,
        &outputs_map(vec![output("root", 0.0, 0.0, 200.0, 100.0), text_output]),
    )
}

#[test]
fn enforces_text_decoration_pattern_budgets() {
    for contour_count in [
        crate::text::decoration::MAX_TEXT_DECORATION_PATTERN_CONTOURS - 1,
        crate::text::decoration::MAX_TEXT_DECORATION_PATTERN_CONTOURS,
    ] {
        build_text_decoration_complexity_ir(
            1,
            u32::try_from(contour_count).expect("contour limit fits u32"),
            4,
        )
        .expect("decoration contour boundary should render");
    }
    let contour_error = build_text_decoration_complexity_ir(
        1,
        u32::try_from(crate::text::decoration::MAX_TEXT_DECORATION_PATTERN_CONTOURS + 1)
            .expect("contour limit fits u32"),
        4,
    )
    .expect_err("one contour beyond the limit should fail");
    assert!(matches!(
        contour_error,
        crate::error::EngineError::Structured { ref code, .. }
            if code == "TEXT_DECORATION_PATTERN_LIMIT"
    ));

    for segment_count in [
        crate::text::decoration::MAX_TEXT_DECORATION_PATTERN_SEGMENTS - 1,
        crate::text::decoration::MAX_TEXT_DECORATION_PATTERN_SEGMENTS,
    ] {
        build_text_decoration_complexity_ir(
            1,
            1,
            u32::try_from(segment_count).expect("segment limit fits u32"),
        )
        .expect("decoration segment boundary should render");
    }
    let segment_error = build_text_decoration_complexity_ir(
        1,
        1,
        u32::try_from(crate::text::decoration::MAX_TEXT_DECORATION_PATTERN_SEGMENTS + 1)
            .expect("segment limit fits u32"),
    )
    .expect_err("one segment beyond the limit should fail");
    assert!(matches!(
        segment_error,
        crate::error::EngineError::Structured { ref code, .. }
            if code == "TEXT_DECORATION_PATTERN_LIMIT"
    ));
}

#[test]
fn enforces_resolved_text_decoration_path_budget() {
    build_text_decoration_budget_ir(crate::text::decoration::MAX_TEXT_DECORATION_PATHS - 1)
        .expect("one below the decoration path limit should render");
    build_text_decoration_budget_ir(crate::text::decoration::MAX_TEXT_DECORATION_PATHS)
        .expect("the exact decoration path limit should render");
    let error =
        build_text_decoration_budget_ir(crate::text::decoration::MAX_TEXT_DECORATION_PATHS + 1)
            .expect_err("one decoration path beyond the limit should fail");
    assert!(matches!(
        error,
        crate::error::EngineError::Structured { ref code, .. }
            if code == "TEXT_DECORATION_COMPLEXITY_LIMIT"
    ));
}

#[test]
fn builds_text_node_with_aligned_bbox_and_layout_box() {
    let ir = build_text_ir(
        &json!({ "color": "#123456", "textAlign": "center", "fontWeight": 700 }),
        text_outputs(100.0, 20.0, 60.0, 18.0),
    );

    let text = &ir["root"]["children"][0]["children"][0];
    assert_eq!(text["type"], json!("text"));
    assert_eq!(text["font"], json!("Main"));
    assert!(text.get("fontFallback").is_none());
    assert_eq!(text["fontSizePx"], json!(16.0));
    assert_eq!(text["fontWeight"], json!(700));
    assert_eq!(text["color"], json!("#123456"));
    assert_eq!(text["textAlign"], json!("center"));
    assert_eq!(text["language"], json!("en"));
    // center alignment: x = 5 + (100 - 60) / 2 = 25
    assert_eq!(
        text["bbox"],
        json!({ "x": 25.0, "y": 5.0, "w": 60.0, "h": 18.0 })
    );
    assert_eq!(
        text["layoutBox"],
        json!({ "x": 5.0, "y": 5.0, "w": 100.0, "h": 20.0 })
    );
    // lineHeightPx fallback: measured h / line count = 18 / 1
    assert_eq!(text["lineHeightPx"], json!(18.0));
    assert_eq!(ir["drawOrder"], json!(["txt"]));
}

#[test]
fn carries_opt_in_text_unit_metadata_into_ir() {
    let mut text_output = output("txt", 5.0, 5.0, 100.0, 20.0);
    let mut layout = simple_text_layout("hello", 60.0, 18.0);
    layout.unit_map = Some(crate::text::unit_map::TextUnitMap {
        kind: crate::text::unit_map::TextUnitKind::Cluster,
        ruby: crate::text::unit_map::TextUnitRubyMode::WithBase,
        units: vec![crate::text::unit_map::TextUnitMapEntry {
            unit_id: "opaque-unit".to_string(),
            kind: crate::text::unit_map::TextUnitKind::Cluster,
            source_start: 0,
            source_end: 1,
            line_id: "opaque-line".to_string(),
            logical_order: 0,
            visual_order: 0,
            members: vec![crate::text::unit_map::TextUnitGlyphMember {
                line_index: 0,
                glyph_index: 0,
                source_role: crate::text::unit_map::TextUnitSourceRole::Content,
            }],
        }],
    });
    text_output.text_layout = Some(layout);
    let ir = build_text_ir(
        &json!({}),
        vec![output("root", 0.0, 0.0, 200.0, 100.0), text_output],
    );
    let unit_map = &ir["root"]["children"][0]["children"][0]["unitMap"];
    assert_eq!(unit_map["kind"], json!("cluster"));
    assert_eq!(unit_map["ruby"], json!("with-base"));
    assert_eq!(unit_map["units"][0]["unitId"], json!("opaque-unit"));
    assert_eq!(
        unit_map["units"][0]["members"][0]["sourceRole"],
        json!("content")
    );
}

fn build_budget_text_ir(
    unit_count: usize,
    stroke_count: usize,
    shadow_count: usize,
) -> Result<crate::ir::types::Ir, crate::error::EngineError> {
    build_budget_text_ir_for_unit_counts(&[unit_count], stroke_count, shadow_count)
}

fn build_budget_text_ir_for_unit_counts(
    unit_counts: &[usize],
    stroke_count: usize,
    shadow_count: usize,
) -> Result<crate::ir::types::Ir, crate::error::EngineError> {
    let text_specs: Vec<(usize, usize, usize)> = unit_counts
        .iter()
        .copied()
        .map(|unit_count| (unit_count, stroke_count, shadow_count))
        .collect();
    build_budget_text_ir_for_specs(&text_specs)
}

fn build_budget_text_ir_for_specs(
    text_specs: &[(usize, usize, usize)],
) -> Result<crate::ir::types::Ir, crate::error::EngineError> {
    let mut children = Vec::new();
    let mut node_outputs = vec![output("root", 0.0, 0.0, 200.0, 100.0)];
    for (text_index, (unit_count, stroke_count, shadow_count)) in
        text_specs.iter().copied().enumerate()
    {
        let strokes: Vec<Value> = (0..stroke_count)
            .map(|_| json!({ "color": "#000000", "widthPx": 1.0 }))
            .collect();
        let shadows: Vec<Value> = (0..shadow_count)
            .map(|_| json!({ "dx": 0.0, "dy": 0.0, "color": "#000000" }))
            .collect();
        let visual = json!({
            "unitAnimation": {
                "by": "cluster",
                "animation": {
                    "keyframes": [
                        { "at": 0.0, "opacity": 0.0 },
                        { "at": 1.0, "opacity": 1.0 }
                    ],
                    "durationMs": 100.0
                }
            },
            "textStrokes": strokes,
            "textShadows": shadows
        });
        let node_id = format!("txt-{text_index}");
        let mut input = text_node_input(&visual);
        input["nodeId"] = json!(node_id.clone());
        children.push(input);

        let mut text_output = output(&node_id, 5.0, 5.0, 100.0, 20.0);
        let mut layout = simple_text_layout("hello", 60.0, 18.0);
        layout.unit_map = Some(crate::text::unit_map::TextUnitMap {
            kind: crate::text::unit_map::TextUnitKind::Cluster,
            ruby: crate::text::unit_map::TextUnitRubyMode::WithBase,
            units: (0..unit_count)
                .map(|index| {
                    let source_start = u32::try_from(index).expect("test unit index fits u32");
                    crate::text::unit_map::TextUnitMapEntry {
                        unit_id: format!("{node_id}-unit-{index}"),
                        kind: crate::text::unit_map::TextUnitKind::Cluster,
                        source_start,
                        source_end: source_start
                            .checked_add(1)
                            .expect("test source end fits u32"),
                        line_id: format!("{node_id}-line"),
                        logical_order: source_start,
                        visual_order: source_start,
                        members: Vec::new(),
                    }
                })
                .collect(),
        });
        text_output.text_layout = Some(layout);
        node_outputs.push(text_output);
    }
    let root = parse_node(json!({
        "nodeId": "root",
        "nodeType": "canvas",
        "children": children,
    }));
    build_ir(&root, &outputs_map(node_outputs))
}

#[test]
fn enforces_text_animation_unit_budget_without_truncation() {
    let at_warning_threshold = build_budget_text_ir(
        crate::ir::types::TEXT_ANIMATION_UNIT_WARNING_THRESHOLD,
        0,
        0,
    )
    .expect("the exact unit warning threshold should render");
    assert!(
        at_warning_threshold
            .warnings
            .iter()
            .all(|warning| warning.code != "TEXT_ANIMATION_UNIT_COUNT_HIGH")
    );

    let above_warning_threshold = build_budget_text_ir(
        crate::ir::types::TEXT_ANIMATION_UNIT_WARNING_THRESHOLD + 1,
        0,
        0,
    )
    .expect("one unit above the warning threshold should render");
    assert!(
        above_warning_threshold
            .warnings
            .iter()
            .any(|warning| warning.code == "TEXT_ANIMATION_UNIT_COUNT_HIGH")
    );

    let at_limit = build_budget_text_ir(crate::ir::types::MAX_TEXT_ANIMATION_UNITS, 0, 0)
        .expect("the exact unit limit should render");
    assert_eq!(
        at_limit
            .warnings
            .iter()
            .filter(|warning| warning.code == "TEXT_ANIMATION_UNIT_COUNT_HIGH")
            .count(),
        1
    );

    let error = build_budget_text_ir(crate::ir::types::MAX_TEXT_ANIMATION_UNITS + 1, 0, 0)
        .expect_err("one unit beyond the limit should fail");
    assert!(matches!(
        error,
        crate::error::EngineError::Structured { ref code, .. }
            if code == "TEXT_ANIMATION_UNIT_LIMIT_EXCEEDED"
    ));
}

#[test]
fn enforces_text_animation_fragment_budget_and_warning_threshold() {
    let warning_threshold = crate::ir::types::TEXT_ANIMATION_FRAGMENT_WARNING_THRESHOLD;
    let fragment_limit = crate::ir::types::MAX_TEXT_ANIMATION_FRAGMENTS;
    let at_warning_threshold = build_budget_text_ir_for_specs(&[(warning_threshold, 0, 0)])
        .expect("the exact fragment warning threshold should render");
    assert!(
        at_warning_threshold
            .warnings
            .iter()
            .all(|warning| warning.code != "TEXT_ANIMATION_FRAGMENT_COUNT_HIGH")
    );

    let warning_ir = build_budget_text_ir_for_specs(&[(warning_threshold - 1, 0, 0), (1, 1, 0)])
        .expect("one fragment above the warning threshold should render");
    assert!(
        warning_ir
            .warnings
            .iter()
            .any(|warning| warning.code == "TEXT_ANIMATION_FRAGMENT_COUNT_HIGH")
    );

    build_budget_text_ir_for_specs(&[(fragment_limit / 2, 1, 0)])
        .expect("the exact fragment limit should render");
    let error = build_budget_text_ir_for_specs(&[(fragment_limit / 2 - 1, 1, 0), (1, 2, 0)])
        .expect_err("one fragment beyond the fragment budget should fail");
    assert!(matches!(
        error,
        crate::error::EngineError::Structured { ref code, .. }
            if code == "TEXT_ANIMATION_FRAGMENT_LIMIT_EXCEEDED"
    ));

    build_budget_text_ir_for_unit_counts(&[2_048, 2_048], 1, 0)
        .expect("fragment estimates from multiple Text nodes sum to the exact scene limit");
    let aggregate_error = build_budget_text_ir_for_unit_counts(&[2_048, 2_048], 2, 0)
        .expect_err("fragment estimates from multiple Text nodes must be combined");
    assert!(matches!(
        aggregate_error,
        crate::error::EngineError::Structured { ref code, .. }
            if code == "TEXT_ANIMATION_FRAGMENT_LIMIT_EXCEEDED"
    ));
}

#[test]
fn preserves_empty_font_fallback_distinct_from_unset() {
    let ir = build_text_ir(
        &json!({ "fontFallback": [] }),
        text_outputs(100.0, 20.0, 60.0, 18.0),
    );
    let text = &ir["root"]["children"][0]["children"][0];
    assert_eq!(text["fontFallback"], json!([]));
    // Unset color falls back to black; unset weight is omitted
    assert_eq!(text["color"], json!("#000000"));
    assert!(text.get("fontWeight").is_none());
}

#[test]
fn applies_scalar_text_stroke_with_round_default_linejoin() {
    let ir = build_text_ir(
        &json!({ "textStroke": "#000", "textStrokeWidth": 2.0 }),
        text_outputs(100.0, 20.0, 60.0, 18.0),
    );
    let text = &ir["root"]["children"][0]["children"][0];
    assert_eq!(text["stroke"], json!("#000"));
    assert_eq!(text["strokeWidth"], json!(2.0));
    assert_eq!(text["strokeLinejoin"], json!("round"));
    assert!(text.get("strokeLinecap").is_none());
}

#[test]
fn zero_text_stroke_width_is_omitted() {
    let ir = build_text_ir(
        &json!({ "textStroke": "#000", "textStrokeWidth": 0.0 }),
        text_outputs(100.0, 20.0, 60.0, 18.0),
    );
    let text = &ir["root"]["children"][0]["children"][0];
    assert!(text.get("strokeWidth").is_none());
}

#[test]
fn emits_inline_box_decorations_before_text() {
    let mut text_output = output("txt", 5.0, 5.0, 100.0, 20.0);
    let mut layout = simple_text_layout("hello", 60.0, 18.0);
    layout.inline_box_decorations = vec![
        crate::text::types::InlineBoxDecoration {
            x: 1.0,
            y: 2.0,
            width: 10.0,
            height: 5.0,
            background: Some("#ff0".to_string()),
            border_color: None,
            border_width: None,
            border_radius: Some([1.0, 1.0, 1.0, 1.0]),
            span_key: None,
        },
        crate::text::types::InlineBoxDecoration {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
            background: None,
            border_color: None,
            border_width: Some(2.0),
            border_radius: None,
            span_key: None,
        },
    ];
    text_output.text_layout = Some(layout);
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [text_node_input(&json!({}))],
        }),
        vec![output("root", 0.0, 0.0, 200.0, 100.0), text_output],
    );

    // Invisible decoration (no background, no border color) is skipped
    assert_eq!(ir["drawOrder"], json!(["txt:ibox0", "txt"]));
    let decoration = &ir["root"]["children"][0]["children"][0];
    assert_eq!(decoration["nodeId"], json!("txt:ibox0"));
    assert_eq!(
        decoration["bbox"],
        json!({ "x": 6.0, "y": 7.0, "w": 10.0, "h": 5.0 })
    );
    assert_eq!(decoration["fill"], json!("#ff0"));
    assert_eq!(
        decoration["borderRadius"],
        json!({ "tl": 1.0, "tr": 1.0, "br": 1.0, "bl": 1.0 })
    );
}

#[test]
fn emits_inline_rects_in_fixed_paint_order_with_fragment_animation() {
    let mut text_output = output("txt", 5.0, 7.0, 100.0, 24.0);
    let mut layout = simple_text_layout("hello", 60.0, 20.0);
    layout.inline_rects = vec![
        crate::text::types::InlineRectFragment {
            fragment_id: "txt:inline-rect:0".to_string(),
            x: 10.0,
            y: 2.0,
            width: 4.0,
            height: 10.0,
            color: "#f00".to_string(),
            border_radius_px: 8.0,
            opacity: 0.5,
            paint_order: "behind".to_string(),
        },
        crate::text::types::InlineRectFragment {
            fragment_id: "txt:inline-rect:1".to_string(),
            x: 20.0,
            y: 3.0,
            width: 2.0,
            height: 20.0,
            color: "#00f".to_string(),
            border_radius_px: 0.0,
            opacity: 1.0,
            paint_order: "front".to_string(),
        },
    ];
    text_output.text_layout = Some(layout);
    let ir = build_text_ir(
        &json!({
            "inlineRectAnimations": {
                "txt:inline-rect:1": {
                    "keyframes": [
                        { "at": 0.0, "opacity": 0.0 },
                        { "at": 1.0, "opacity": 1.0 }
                    ],
                    "durationMs": 500.0,
                    "easing": { "type": "steps", "count": 1.0, "position": "jump-end" }
                }
            }
        }),
        vec![output("root", 0.0, 0.0, 200.0, 100.0), text_output],
    );

    let children = ir["root"]["children"][0]["children"]
        .as_array()
        .expect("text group children");
    assert_eq!(children.len(), 3);
    assert_eq!(children[0]["nodeId"], json!("txt:inline-rect:0"));
    assert_eq!(children[1]["nodeId"], json!("txt"));
    assert_eq!(children[2]["nodeId"], json!("txt:inline-rect:1"));
    assert_eq!(
        children[0]["bbox"],
        json!({ "x": 15.0, "y": 9.0, "w": 4.0, "h": 10.0 })
    );
    assert_eq!(children[0]["opacity"], json!(0.5));
    assert_eq!(children[0]["children"][0]["borderRadius"], json!(2.0));
    assert_eq!(children[2]["animation"]["durationMs"], json!(500.0));
    assert_eq!(
        children[2]["animation"]["easing"],
        json!({ "type": "steps", "count": 1.0, "position": "jump-end" })
    );
    assert_eq!(
        ir["drawOrder"],
        json!(["txt:inline-rect:0:rect", "txt", "txt:inline-rect:1:rect"])
    );
}

#[test]
fn vertical_text_aligns_from_the_right_edge() {
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [{
                "nodeId": "txt",
                "nodeType": "text",
                "children": [],
                "text": {
                    "content": "縦",
                    "fontSizePx": 16.0,
                    "fontFamily": ["Main"],
                    "writingMode": "vertical-rl",
                },
                "visual": {},
            }],
        }),
        text_outputs(40.0, 100.0, 20.0, 80.0),
    );
    let text = &ir["root"]["children"][0]["children"][0];
    // x = layout.x + layout.w - measured.w = 5 + 40 - 20 = 25
    assert_eq!(
        text["bbox"],
        json!({ "x": 25.0, "y": 5.0, "w": 20.0, "h": 80.0 })
    );
    assert_eq!(text["writingMode"], json!("vertical-rl"));
    // vertical lineHeight fallback: measured w / line count = 20
    assert_eq!(text["lineHeightPx"], json!(20.0));
}

#[test]
fn propagates_bridged_text_warnings_and_kinsoku_overflow() {
    let mut text_output = output("txt", 5.0, 5.0, 100.0, 20.0);
    let mut layout = simple_text_layout("hello", 60.0, 18.0);
    layout.warnings = vec![text_warning_to_recoverable(
        &crate::text::types::TextWarning {
            code: crate::text::types::TextWarningCode::MissingGlyph,
            message: "Font \"Main\" is missing glyphs for: ☃".to_string(),
            fallback: "blank".to_string(),
        },
        Some("txt".to_string()),
    )];
    layout.overflow = Some(TextOverflow {
        overflow_type: "kinsoku_unresolved".to_string(),
        reason: Some("no break opportunity".to_string()),
    });
    text_output.text_layout = Some(layout);
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [text_node_input(&json!({}))],
        }),
        vec![output("root", 0.0, 0.0, 200.0, 100.0), text_output],
    );

    assert_eq!(
        ir["warnings"],
        json!([
            {
                "severity": "recoverable",
                "code": "MISSING_GLYPH",
                "message": "Font \"Main\" is missing glyphs for: ☃",
                "stage": "text",
                "nodeId": "txt",
                "fallback": "blank",
            },
            {
                "severity": "recoverable",
                "code": "KINSOKU_UNRESOLVED",
                "message": "Kinsoku line breaking could not be fully resolved for text node \"txt\"; a forced break was used (no break opportunity).",
                "stage": "text",
                "nodeId": "txt",
                "fallback": "forced-break",
            },
        ])
    );
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

fn build_image_ir(visual: &Value) -> Value {
    build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [{
                "nodeId": "img",
                "nodeType": "image",
                "children": [],
                "visual": visual,
            }],
        }),
        vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("img", 0.0, 0.0, 40.0, 30.0),
        ],
    )
}

#[test]
fn embeds_data_uri_images_without_warnings() {
    let ir = build_image_ir(&json!({ "src": "data:image/png;base64,AA==", "objectFit": "cover" }));
    let image = &ir["root"]["children"][0]["children"][0];
    assert_eq!(image["type"], json!("image"));
    assert_eq!(image["preserveAspectRatio"], json!("xMidYMid slice"));
    assert_eq!(ir["warnings"], json!([]));
}

#[test]
fn warns_on_reference_src_but_keeps_the_reference() {
    let ir = build_image_ir(&json!({ "src": "https://example.com/a.png" }));
    let image = &ir["root"]["children"][0]["children"][0];
    assert_eq!(image["src"], json!("https://example.com/a.png"));
    assert_eq!(image["preserveAspectRatio"], json!("none"));
    assert_eq!(ir["warnings"][0]["code"], json!("IMAGE_SRC_NOT_EMBEDDED"));
    assert_eq!(ir["warnings"].as_array().map(Vec::len), Some(1));
}

#[test]
fn falls_back_to_placeholder_rect_when_src_is_missing() {
    let ir = build_image_ir(&json!({}));
    let placeholder = &ir["root"]["children"][0]["children"][0];
    assert_eq!(placeholder["type"], json!("rect"));
    assert_eq!(placeholder["fill"], json!("#cccccc"));
    assert_eq!(ir["warnings"][0]["code"], json!("IMAGE_LOAD_FAILED"));
    assert_eq!(ir["warnings"].as_array().map(Vec::len), Some(1));
}

#[test]
fn empty_string_src_emits_both_warnings_and_placeholder() {
    let ir = build_image_ir(&json!({ "src": "" }));
    assert_eq!(ir["warnings"][0]["code"], json!("IMAGE_SRC_NOT_EMBEDDED"));
    assert_eq!(ir["warnings"][1]["code"], json!("IMAGE_LOAD_FAILED"));
    let placeholder = &ir["root"]["children"][0]["children"][0];
    assert_eq!(placeholder["type"], json!("rect"));
}

// ---------------------------------------------------------------------------
// Nested svg
// ---------------------------------------------------------------------------

#[test]
fn parses_nested_svg_content_and_prefixes_ids() {
    let content = concat!(
        "<svg viewBox=\"0 0 10 10\">",
        "<defs><linearGradient id=\"g\"><stop/></linearGradient></defs>",
        "<style>#g { opacity: 1 } .cls { fill: #abc }</style>",
        "<rect fill=\"url(#g)\" data-part-id=\"x\"/>",
        "</svg>",
    );
    let ir = build_json(
        json!({
            "nodeId": "root",
            "nodeType": "canvas",
            "children": [{
                "nodeId": "nested",
                "nodeType": "svg",
                "children": [],
                "visual": {
                    "svgContent": content,
                    "contentIdPrefix": "p-",
                    "preserveAspectRatio": "slice",
                },
            }],
        }),
        vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("nested", 0.0, 0.0, 40.0, 40.0),
        ],
    );

    let svg = &ir["root"]["children"][0]["children"][0];
    assert_eq!(svg["svgViewBox"], json!("0 0 10 10"));
    assert_eq!(svg["preserveAspectRatio"], json!("xMidYMid slice"));
    let inner = svg["svgContent"].as_str().expect("svgContent string");
    assert!(
        inner.contains("id=\"p-g\""),
        "id definition prefixed: {inner}"
    );
    assert!(
        inner.contains("url(#p-g)"),
        "url reference prefixed: {inner}"
    );
    assert!(
        inner.contains("#p-g { opacity: 1 }"),
        "css selector prefixed: {inner}"
    );
    assert!(
        inner.contains("data-part-id=\"x\""),
        "hyphenated attribute untouched: {inner}"
    );
    assert!(inner.contains("fill: #abc"), "hex color untouched: {inner}");
}

#[test]
fn reports_content_id_prefix_rewrite_errors_with_ir_node_context() {
    let root = parse_node(json!({
        "nodeId": "root",
        "nodeType": "canvas",
        "children": [{
            "nodeId": "nested",
            "nodeType": "svg",
            "children": [],
            "visual": {
                "svgContent": "<svg><g id=\"x\"/><rect fill=\"url(#x\"/></svg>",
                "contentIdPrefix": "p-",
            },
        }],
    }));
    let error = build_ir(
        &root,
        &outputs_map(vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("nested", 0.0, 0.0, 40.0, 40.0),
        ]),
    )
    .expect_err("known-local malformed reference should fail");

    assert!(matches!(
        error,
        EngineError::Structured { code, stage, node_id, .. }
            if code == "CONTENT_ID_PREFIX_UNSUPPORTED_REFERENCE"
                && stage.as_ref() == Some(&crate::diagnostics::PipelineStage::Ir)
                && node_id.as_deref() == Some("nested")
    ));
}

#[test]
fn bypasses_id_scanning_when_content_id_prefix_is_absent_or_empty() {
    let malformed_inner = "<g id=\"x/><animate begin='x.begin'/>";

    let (_, absent_output) =
        parse_svg_content(malformed_inner, None).expect("absent prefix should pass through");
    let (_, empty_output) =
        parse_svg_content(malformed_inner, Some("")).expect("empty prefix should pass through");

    assert_eq!(absent_output, malformed_inner);
    assert_eq!(empty_output, malformed_inner);
}

#[test]
fn rejects_unsafe_svg_content() {
    let root = parse_node(json!({
        "nodeId": "root",
        "nodeType": "canvas",
        "children": [{
            "nodeId": "nested",
            "nodeType": "svg",
            "children": [],
            "visual": { "svgContent": "<svg><script>alert(1)</script></svg>" },
        }],
    }));
    let result = build_ir(
        &root,
        &outputs_map(vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("nested", 0.0, 0.0, 40.0, 40.0),
        ]),
    );
    let error = result.expect_err("unsafe svg should fail").to_string();
    assert!(error.contains("disallowed markup"), "{error}");
}

// ---------------------------------------------------------------------------
// Shape / Symbol
// ---------------------------------------------------------------------------

fn shape_visual(extra: &Value) -> Value {
    let mut visual = json!({
        "shapeGeometry": {
            "viewBox": { "width": 10.0, "height": 10.0 },
            "root": {
                "kind": "group",
                "children": [
                    { "kind": "path", "nodeId": "left", "d": "M0 0 H4 V10 H0 Z" },
                    { "kind": "path", "nodeId": "right", "d": "M6 0 H10 V10 H6 Z" },
                ],
            },
        },
    });
    if let (Some(base), Some(extra_map)) = (visual.as_object_mut(), extra.as_object()) {
        for (key, value) in extra_map {
            base.insert(key.clone(), value.clone());
        }
    }
    visual
}

fn build_shape_ir(visual: &Value) -> Result<Value, crate::error::EngineError> {
    let root = parse_node(json!({
        "nodeId": "root",
        "nodeType": "canvas",
        "children": [{
            "nodeId": "shp",
            "nodeType": "shape",
            "children": [],
            "visual": visual,
        }],
    }));
    let ir = build_ir(
        &root,
        &outputs_map(vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("shp", 0.0, 0.0, 20.0, 20.0),
        ]),
    )?;
    Ok(public_ir_json(&ir))
}

fn nested_geometry(depth: usize, leaf_id: Option<&str>) -> Value {
    let mut root = json!({
        "kind": "path",
        "d": "M0 0 H10 V10 H0 Z",
    });
    if let Some(node_id) = leaf_id {
        root["nodeId"] = json!(node_id);
    }
    for _ in 0..depth {
        root = json!({
            "kind": "transform",
            "transform": {},
            "child": root,
        });
    }
    json!({
        "viewBox": { "width": 10.0, "height": 10.0 },
        "root": root,
    })
}

fn build_symbol_ir(symbol_definition: &Value) -> Result<Value, EngineError> {
    let root = parse_node(json!({
        "nodeId": "root",
        "nodeType": "canvas",
        "children": [{
            "nodeId": "sym",
            "nodeType": "symbol",
            "children": [],
            "visual": { "symbolDefinition": symbol_definition },
        }],
    }));
    let ir = build_ir(
        &root,
        &outputs_map(vec![
            output("root", 0.0, 0.0, 100.0, 100.0),
            output("sym", 0.0, 0.0, 20.0, 10.0),
        ]),
    )?;
    Ok(public_ir_json(&ir))
}

#[test]
fn reports_geometry_depth_errors_before_shape_compilation() {
    let error = build_shape_ir(&json!({
        "shapeGeometry": nested_geometry(MAX_GEOMETRY_TREE_DEPTH + 1, None),
    }))
    .expect_err("over-depth geometry should fail");
    let EngineError::StructuredContext {
        code,
        message,
        stage,
        node_id,
        context,
    } = error
    else {
        panic!("expected a structured context error");
    };
    assert_eq!(code, "SHAPE_GEOMETRY_MAX_DEPTH");
    assert_eq!(message, "Shape geometry exceeds the maximum tree depth.");
    assert_eq!(stage, Some(crate::diagnostics::PipelineStage::Validate));
    assert_eq!(node_id.as_deref(), Some("shp"));
    assert_eq!(
        *context,
        json!({
            "operation": "renderShape",
            "actual": MAX_GEOMETRY_TREE_DEPTH + 1,
            "limit": MAX_GEOMETRY_TREE_DEPTH,
        })
    );
}

#[test]
fn reports_depth_added_while_resolving_elastic_symbols() {
    let error = build_symbol_ir(&json!({
        "geometry": nested_geometry(MAX_GEOMETRY_TREE_DEPTH, Some("elastic")),
        "elasticSegments": [{
            "nodeId": "elastic",
            "axis": "x",
            "role": "stretch",
            "frame": { "x": 0.0, "y": 0.0, "width": 10.0, "height": 10.0 },
        }],
    }))
    .expect_err("resolved over-depth geometry should fail");
    let EngineError::StructuredContext {
        code,
        message,
        stage,
        node_id,
        context,
    } = error
    else {
        panic!("expected a structured context error");
    };
    assert_eq!(code, "SHAPE_GEOMETRY_MAX_DEPTH");
    assert_eq!(message, "Shape geometry exceeds the maximum tree depth.");
    assert_eq!(stage, Some(crate::diagnostics::PipelineStage::Validate));
    assert_eq!(node_id.as_deref(), Some("sym"));
    assert_eq!(
        *context,
        json!({
            "operation": "renderSymbol",
            "actual": MAX_GEOMETRY_TREE_DEPTH + 1,
            "limit": MAX_GEOMETRY_TREE_DEPTH,
        })
    );
}

#[test]
fn compiles_shape_parts_baked_to_the_node_box() {
    let ir = build_shape_ir(&shape_visual(&json!({ "fill": "#0f0" }))).expect("shape builds");
    let shape = &ir["root"]["children"][0]["children"][0];
    assert_eq!(shape["type"], json!("shape"));
    assert_eq!(shape["fill"], json!("#0f0"));
    let parts = shape["shapeParts"].as_array().expect("parts");
    // No partPaint and no emitPartIds → single fused part without ids
    assert_eq!(parts.len(), 1);
    assert!(parts[0].get("partId").is_none());
    assert!(parts[0]["d"].as_str().is_some_and(|d| !d.is_empty()));
    assert_eq!(ir["drawOrder"], json!(["shp"]));
}

#[test]
fn splits_parts_for_part_paint_without_emitting_ids() {
    let ir = build_shape_ir(&shape_visual(&json!({
        "partPaint": { "left": { "fill": "#f00" } },
    })))
    .expect("shape builds");
    let parts = ir["root"]["children"][0]["children"][0]["shapeParts"]
        .as_array()
        .expect("parts")
        .clone();
    assert_eq!(parts.len(), 2);
    assert!(parts.iter().all(|part| part.get("partId").is_none()));
    let painted: Vec<&Value> = parts
        .iter()
        .filter(|part| part.get("paint").is_some())
        .collect();
    assert_eq!(painted.len(), 1);
    assert_eq!(painted[0]["paint"], json!({ "fill": "#f00" }));
}

#[test]
fn emits_part_ids_when_opted_in() {
    let ir = build_shape_ir(&shape_visual(&json!({ "emitPartIds": true }))).expect("shape builds");
    let parts = ir["root"]["children"][0]["children"][0]["shapeParts"]
        .as_array()
        .expect("parts")
        .clone();
    let ids: Vec<&str> = parts
        .iter()
        .map(|part| part["partId"].as_str().expect("partId"))
        .collect();
    assert_eq!(ids, vec!["left", "right"]);
}

#[test]
fn warns_on_unknown_part_paint_ids() {
    let ir = build_shape_ir(&shape_visual(&json!({
        "partPaint": { "ghost": { "fill": "#f00" } },
    })))
    .expect("shape builds");
    assert_eq!(
        ir["warnings"][0]["code"],
        json!("SHAPE_PART_PAINT_UNKNOWN_PART")
    );
    assert_eq!(
        ir["warnings"][0]["message"],
        json!("partPaint references unknown partId \"ghost\"; entry ignored.")
    );
}

#[test]
fn keeps_unknown_part_paint_warnings_in_authored_order() {
    // TS iterates Object.keys(partPaint) in insertion order; a sorted map
    // would flip zebra/apple. Parsed from a raw JSON string because a
    // serde_json::Value round-trip would itself sort the keys.
    let node_json = r##"{
        "nodeId": "shp",
        "nodeType": "shape",
        "authoredId": true,
        "children": [],
        "visual": {
            "shapeGeometry": {
                "viewBox": { "width": 10.0, "height": 10.0 },
                "root": { "kind": "path", "nodeId": "only", "d": "M0 0 H10 V10 H0 Z" }
            },
            "partPaint": { "zebra": { "fill": "#f00" }, "apple": { "fill": "#00f" } }
        }
    }"##;
    let root: LayoutNodeInput = serde_json::from_str(node_json).expect("node JSON");
    let ir = build_ir(
        &root,
        &outputs_map(vec![output("shp", 0.0, 0.0, 20.0, 20.0)]),
    )
    .expect("shape builds");
    let ir = public_ir_json(&ir);
    let messages: Vec<&str> = ir["warnings"]
        .as_array()
        .expect("warnings")
        .iter()
        .map(|warning| warning["message"].as_str().expect("message"))
        .collect();
    assert_eq!(messages.len(), 2);
    assert!(messages[0].contains("\"zebra\""), "{messages:?}");
    assert!(messages[1].contains("\"apple\""), "{messages:?}");
}

#[test]
fn rejects_duplicate_addressable_part_ids() {
    let error = build_shape_ir(&json!({
        "shapeGeometry": {
            "viewBox": { "width": 10.0, "height": 10.0 },
            "root": {
                "kind": "group",
                "children": [
                    { "kind": "path", "nodeId": "dup", "d": "M0 0 H4 V4 H0 Z" },
                    { "kind": "path", "nodeId": "dup", "d": "M6 6 H10 V10 H6 Z" },
                ],
            },
        },
    }))
    .expect_err("duplicate ids should fail");
    let EngineError::StructuredContext {
        code,
        message,
        stage,
        node_id,
        context,
    } = error
    else {
        panic!("expected a structured context error");
    };
    assert_eq!(code, "SHAPE_DUPLICATE_PART_ID");
    assert_eq!(message, "Shape contains a duplicate addressable part id.");
    assert_eq!(stage, Some(crate::diagnostics::PipelineStage::Validate));
    assert_eq!(node_id.as_deref(), Some("shp"));
    assert_eq!(
        *context,
        json!({
            "operation": "renderShape",
            "partIdPrefix": "dup",
            "omittedPartIdByteCount": 0,
        })
    );
}

#[test]
fn reports_unresolvable_shape_references_with_the_id() {
    let error = build_shape_ir(&json!({ "shapeGeometryId": "missing-geometry" }))
        .expect_err("unresolvable reference should fail")
        .to_string();
    assert!(
        error.contains("Shape references unknown geometryId \"missing-geometry\"."),
        "{error}"
    );

    let error = build_shape_ir(&json!({}))
        .expect_err("missing reference should fail")
        .to_string();
    assert!(
        error.contains("Shape requires either a geometry object or geometryId."),
        "{error}"
    );
}
