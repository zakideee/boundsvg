//! Real directional IR DTO truth tables and canonical output round trips.

use super::types::{
    AnimationKeyframe, AnimationSpec, AnimationSpring, AnimationSteps, AnimationTransform2D,
    HandlersRef, ShapePartPaint, ShapePathPart, TextOutlinePath, TextUnitAnimation,
    TextUnitAnimationSample,
};
use super::wire_input::{
    AnimationKeyframeInput, AnimationSpecInput, AnimationSpringInput, AnimationStepsInput,
    AnimationTransform2DInput, HandlersRefInput, ShapePartPaintInput, ShapePathPartInput,
    TextOutlinePathInput, TextUnitAnimationInput, TextUnitAnimationSampleInput,
};
use crate::wire::test_support::{NumericWireType, assert_numeric_field};
use crate::wire::test_support::{assert_optional_field, assert_output_round_trip};
use serde_json::json;

#[test]
fn path_geometry_is_output_only_and_recomputed_for_every_input_presence() {
    let fixture = json!({"type":"path", "nodeId":"path", "bbox":{"x":10.0,"y":20.0,"w":1.0,"h":1.0}, "pathData":"M-50 0h200v40h-200Z", "stroke":"red", "strokeWidth":3.006, "strokeLinecap":"square", "strokeLinejoin":"miter", "strokeMiterlimit":7.006});
    let mut expected = None;
    for supplied in [
        None,
        Some(serde_json::Value::Null),
        Some(json!(false)),
        Some(json!({"bounds":{"minX":9999},"isComplete":false})),
        Some(json!("invalid")),
    ] {
        let mut input = fixture.clone();
        if let Some(value) = supplied {
            input["pathGeometry"] = value;
        }
        let input_node: super::wire_input::IrNodeInput =
            serde_json::from_value(input).expect("existing Path input remains accepted");
        let node: super::types::IrNode = input_node.into();
        let output = serde_json::to_value(node).expect("finite canonical output");
        let geometry = output["pathGeometry"].clone();
        assert_eq!(
            geometry["bounds"],
            json!({"minX":-50.0,"minY":0.0,"maxX":150.0,"maxY":40.0})
        );
        assert_eq!(geometry["isComplete"], true);
        assert_eq!(
            geometry["strokeOutset"],
            json!({"radius":1.505,"multiplier":7.01})
        );
        if let Some(previous) = &expected {
            assert_eq!(&geometry, previous);
        }
        expected = Some(geometry);
        assert_eq!(output["bbox"], fixture["bbox"]);
    }
}

#[test]
fn empty_and_prefix_path_metadata_have_explicit_output_meanings() {
    for (path_data, bounds, complete) in [
        ("", serde_json::Value::Null, true),
        ("M50 50", serde_json::Value::Null, true),
        (
            "M50 50Z",
            json!({"minX":50.0,"minY":50.0,"maxX":50.0,"maxY":50.0}),
            true,
        ),
        (
            "M0 0L10 10C20 20",
            json!({"minX":0.0,"minY":0.0,"maxX":10.0,"maxY":10.0}),
            false,
        ),
    ] {
        let input = json!({"type":"path","nodeId":"path","bbox":{"x":0.0,"y":0.0,"w":0.0,"h":0.0},"pathData":path_data});
        let input_node: super::wire_input::IrNodeInput =
            serde_json::from_value(input).expect("raw Path input");
        let node: super::types::IrNode = input_node.into();
        let output = serde_json::to_value(node).expect("canonical output");
        assert_eq!(output["pathGeometry"]["bounds"], bounds);
        assert_eq!(output["pathGeometry"]["isComplete"], complete);
        assert_eq!(output["pathGeometry"]["strokeOutset"]["radius"], 0.0);
    }
}

#[test]
fn animation_keyframe_keeps_directional_presence_and_round_trip() {
    let fixture = json!({"at": 0.0, "opacity": 0.0, "transform": {"scaleX": 1.0}});
    assert_optional_field::<AnimationKeyframeInput>(&fixture, "opacity", |input| {
        input.opacity.is_none()
    });
    assert_numeric_field::<AnimationKeyframeInput>(&fixture, "opacity", NumericWireType::Float64);
    assert_optional_field::<AnimationKeyframeInput>(&fixture, "transform", |input| {
        input.transform.is_none()
    });
    assert_output_round_trip::<AnimationKeyframeInput, AnimationKeyframe>(
        &fixture,
        &["opacity", "transform"],
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<AnimationKeyframeInput>(unknown).is_ok());
}

#[test]
fn animation_spec_keeps_directional_presence_and_round_trip() {
    let fixture = json!({"keyframes": [{"at": 0.0}, {"at": 1.0}], "durationMs": 100.0, "delayMs": 0.0, "easing": "linear", "iterations": 1.0, "fill": "forwards"});
    assert_optional_field::<AnimationSpecInput>(&fixture, "delayMs", |input| {
        input.delay_ms.is_none()
    });
    assert_numeric_field::<AnimationSpecInput>(&fixture, "delayMs", NumericWireType::Float64);
    assert_optional_field::<AnimationSpecInput>(&fixture, "easing", |input| input.easing.is_none());
    assert_optional_field::<AnimationSpecInput>(&fixture, "iterations", |input| {
        input.iterations.is_none()
    });
    assert_optional_field::<AnimationSpecInput>(&fixture, "fill", |input| input.fill.is_none());
    assert_output_round_trip::<AnimationSpecInput, AnimationSpec>(
        &fixture,
        &["delayMs", "easing", "iterations", "fill"],
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<AnimationSpecInput>(unknown).is_ok());
}

#[test]
fn animation_spring_keeps_directional_presence_and_round_trip() {
    let fixture = json!({"type": "spring", "stiffness": 100.0, "damping": 10.0, "mass": 1.0});
    assert_optional_field::<AnimationSpringInput>(&fixture, "stiffness", |input| {
        input.stiffness.is_none()
    });
    assert_numeric_field::<AnimationSpringInput>(&fixture, "stiffness", NumericWireType::Float64);
    assert_optional_field::<AnimationSpringInput>(&fixture, "damping", |input| {
        input.damping.is_none()
    });
    assert_numeric_field::<AnimationSpringInput>(&fixture, "damping", NumericWireType::Float64);
    assert_optional_field::<AnimationSpringInput>(&fixture, "mass", |input| input.mass.is_none());
    assert_numeric_field::<AnimationSpringInput>(&fixture, "mass", NumericWireType::Float64);
    assert_output_round_trip::<AnimationSpringInput, AnimationSpring>(
        &fixture,
        &["stiffness", "damping", "mass"],
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<AnimationSpringInput>(unknown).is_err());
}

#[test]
fn animation_steps_keeps_directional_presence_and_round_trip() {
    let fixture = json!({"type": "steps", "count": 3.0, "position": "jump-end"});
    assert_optional_field::<AnimationStepsInput>(&fixture, "position", |input| {
        input.position.is_none()
    });
    assert_output_round_trip::<AnimationStepsInput, AnimationSteps>(&fixture, &["position"]);
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<AnimationStepsInput>(unknown).is_err());
}

#[test]
fn animation_transform2_d_keeps_directional_presence_and_round_trip() {
    let fixture = json!({"translateX": 0.0, "translateY": 0.0, "scaleX": 1.0, "scaleY": 1.0, "rotateDeg": 0.0});
    assert_optional_field::<AnimationTransform2DInput>(&fixture, "translateX", |input| {
        input.translate_x.is_none()
    });
    assert_numeric_field::<AnimationTransform2DInput>(
        &fixture,
        "translateX",
        NumericWireType::Float64,
    );
    assert_optional_field::<AnimationTransform2DInput>(&fixture, "translateY", |input| {
        input.translate_y.is_none()
    });
    assert_numeric_field::<AnimationTransform2DInput>(
        &fixture,
        "translateY",
        NumericWireType::Float64,
    );
    assert_optional_field::<AnimationTransform2DInput>(&fixture, "scaleX", |input| {
        input.scale_x.is_none()
    });
    assert_numeric_field::<AnimationTransform2DInput>(&fixture, "scaleX", NumericWireType::Float64);
    assert_optional_field::<AnimationTransform2DInput>(&fixture, "scaleY", |input| {
        input.scale_y.is_none()
    });
    assert_numeric_field::<AnimationTransform2DInput>(&fixture, "scaleY", NumericWireType::Float64);
    assert_optional_field::<AnimationTransform2DInput>(&fixture, "rotateDeg", |input| {
        input.rotate_deg.is_none()
    });
    assert_numeric_field::<AnimationTransform2DInput>(
        &fixture,
        "rotateDeg",
        NumericWireType::Float64,
    );
    assert_output_round_trip::<AnimationTransform2DInput, AnimationTransform2D>(
        &fixture,
        &["translateX", "translateY", "scaleX", "scaleY", "rotateDeg"],
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<AnimationTransform2DInput>(unknown).is_ok());
}

#[test]
fn handlers_ref_keeps_directional_presence_and_round_trip() {
    let fixture = json!({"onClick": "handler", "onDoubleClick": "handler", "onContextMenu": "handler", "onPointerDown": "handler", "onPointerUp": "handler", "onPointerCancel": "handler", "onPointerMove": "handler", "onPointerEnter": "handler", "onPointerLeave": "handler", "onPointerOver": "handler", "onPointerOut": "handler", "onMouseDown": "handler", "onMouseUp": "handler", "onMouseMove": "handler", "onMouseEnter": "handler", "onMouseLeave": "handler", "onMouseOver": "handler", "onMouseOut": "handler", "onTouchStart": "handler", "onTouchEnd": "handler", "onTouchMove": "handler"});
    assert_optional_field::<HandlersRefInput>(&fixture, "onClick", |input| {
        input.on_click.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onDoubleClick", |input| {
        input.on_double_click.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onContextMenu", |input| {
        input.on_context_menu.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onPointerDown", |input| {
        input.on_pointer_down.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onPointerUp", |input| {
        input.on_pointer_up.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onPointerCancel", |input| {
        input.on_pointer_cancel.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onPointerMove", |input| {
        input.on_pointer_move.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onPointerEnter", |input| {
        input.on_pointer_enter.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onPointerLeave", |input| {
        input.on_pointer_leave.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onPointerOver", |input| {
        input.on_pointer_over.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onPointerOut", |input| {
        input.on_pointer_out.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onMouseDown", |input| {
        input.on_mouse_down.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onMouseUp", |input| {
        input.on_mouse_up.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onMouseMove", |input| {
        input.on_mouse_move.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onMouseEnter", |input| {
        input.on_mouse_enter.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onMouseLeave", |input| {
        input.on_mouse_leave.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onMouseOver", |input| {
        input.on_mouse_over.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onMouseOut", |input| {
        input.on_mouse_out.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onTouchStart", |input| {
        input.on_touch_start.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onTouchEnd", |input| {
        input.on_touch_end.is_none()
    });
    assert_optional_field::<HandlersRefInput>(&fixture, "onTouchMove", |input| {
        input.on_touch_move.is_none()
    });
    assert_output_round_trip::<HandlersRefInput, HandlersRef>(
        &fixture,
        &[
            "onClick",
            "onDoubleClick",
            "onContextMenu",
            "onPointerDown",
            "onPointerUp",
            "onPointerCancel",
            "onPointerMove",
            "onPointerEnter",
            "onPointerLeave",
            "onPointerOver",
            "onPointerOut",
            "onMouseDown",
            "onMouseUp",
            "onMouseMove",
            "onMouseEnter",
            "onMouseLeave",
            "onMouseOver",
            "onMouseOut",
            "onTouchStart",
            "onTouchEnd",
            "onTouchMove",
        ],
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<HandlersRefInput>(unknown).is_ok());
}

#[test]
fn shape_part_paint_keeps_directional_presence_and_round_trip() {
    let fixture = json!({"fill": "#000000", "stroke": "#000000", "strokeWidth": 1.0, "strokeLinecap": "butt", "strokeLinejoin": "miter", "strokeDasharray": "none", "strokeMiterlimit": 4.0});
    assert_optional_field::<ShapePartPaintInput>(&fixture, "fill", |input| input.fill.is_none());
    assert_optional_field::<ShapePartPaintInput>(&fixture, "stroke", |input| {
        input.stroke.is_none()
    });
    assert_optional_field::<ShapePartPaintInput>(&fixture, "strokeWidth", |input| {
        input.stroke_width.is_none()
    });
    assert_numeric_field::<ShapePartPaintInput>(&fixture, "strokeWidth", NumericWireType::Float64);
    assert_optional_field::<ShapePartPaintInput>(&fixture, "strokeLinecap", |input| {
        input.stroke_linecap.is_none()
    });
    assert_optional_field::<ShapePartPaintInput>(&fixture, "strokeLinejoin", |input| {
        input.stroke_linejoin.is_none()
    });
    assert_optional_field::<ShapePartPaintInput>(&fixture, "strokeDasharray", |input| {
        input.stroke_dasharray.is_none()
    });
    assert_optional_field::<ShapePartPaintInput>(&fixture, "strokeMiterlimit", |input| {
        input.stroke_miterlimit.is_none()
    });
    assert_numeric_field::<ShapePartPaintInput>(
        &fixture,
        "strokeMiterlimit",
        NumericWireType::Float64,
    );
    assert_output_round_trip::<ShapePartPaintInput, ShapePartPaint>(
        &fixture,
        &[
            "fill",
            "stroke",
            "strokeWidth",
            "strokeLinecap",
            "strokeLinejoin",
            "strokeDasharray",
            "strokeMiterlimit",
        ],
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<ShapePartPaintInput>(unknown).is_ok());
}

#[test]
fn shape_path_part_keeps_directional_presence_and_round_trip() {
    let fixture = json!({"d": "M0 0 L10 0", "partId": "part", "strokeD": "M0 0 L10 0", "bounds": {"x": 0.0, "y": 0.0, "width": 10.0, "height": 10.0}, "paint": {"fill": "#000000"}});
    assert_optional_field::<ShapePathPartInput>(&fixture, "partId", |input| {
        input.part_id.is_none()
    });
    assert_optional_field::<ShapePathPartInput>(&fixture, "strokeD", |input| {
        input.stroke_d.is_none()
    });
    assert_optional_field::<ShapePathPartInput>(&fixture, "bounds", |input| input.bounds.is_none());
    assert_optional_field::<ShapePathPartInput>(&fixture, "paint", |input| input.paint.is_none());
    assert_output_round_trip::<ShapePathPartInput, ShapePathPart>(
        &fixture,
        &["partId", "strokeD", "bounds", "paint"],
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<ShapePathPartInput>(unknown).is_ok());
}

#[test]
fn text_outline_path_keeps_directional_presence_and_round_trip() {
    let fixture = json!({"nodeId": "node", "d": "M0 0 L10 0", "fill": "#000000", "glyphIds": [], "text": "A", "bbox": {"x": 0.0, "y": 0.0, "w": 10.0, "h": 10.0}, "unitId": "unit", "sourceStart": 0, "sourceEnd": 1, "sourceRole": "content", "paintRangeIndex": 0, "strokes": [], "shadows": [], "missingGlyph": false});
    assert_optional_field::<TextOutlinePathInput>(&fixture, "unitId", |input| {
        input.unit_id.is_none()
    });
    assert_optional_field::<TextOutlinePathInput>(&fixture, "sourceStart", |input| {
        input.source_start.is_none()
    });
    assert_numeric_field::<TextOutlinePathInput>(
        &fixture,
        "sourceStart",
        NumericWireType::UnsignedSize,
    );
    assert_optional_field::<TextOutlinePathInput>(&fixture, "sourceEnd", |input| {
        input.source_end.is_none()
    });
    assert_numeric_field::<TextOutlinePathInput>(
        &fixture,
        "sourceEnd",
        NumericWireType::UnsignedSize,
    );
    assert_optional_field::<TextOutlinePathInput>(&fixture, "sourceRole", |input| {
        input.source_role.is_none()
    });
    assert_optional_field::<TextOutlinePathInput>(&fixture, "paintRangeIndex", |input| {
        input.paint_range_index.is_none()
    });
    assert_numeric_field::<TextOutlinePathInput>(
        &fixture,
        "paintRangeIndex",
        NumericWireType::Unsigned32,
    );
    assert_optional_field::<TextOutlinePathInput>(&fixture, "strokes", |input| {
        input.strokes.is_none()
    });
    assert_optional_field::<TextOutlinePathInput>(&fixture, "shadows", |input| {
        input.shadows.is_none()
    });
    assert_optional_field::<TextOutlinePathInput>(&fixture, "missingGlyph", |input| {
        input.missing_glyph.is_none()
    });
    assert_output_round_trip::<TextOutlinePathInput, TextOutlinePath>(
        &fixture,
        &[
            "unitId",
            "sourceStart",
            "sourceEnd",
            "sourceRole",
            "paintRangeIndex",
            "strokes",
            "shadows",
            "missingGlyph",
        ],
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<TextOutlinePathInput>(unknown).is_ok());
}

#[test]
fn text_unit_animation_keeps_directional_presence_and_round_trip() {
    let fixture = json!({"by": "cluster", "animation": {"keyframes": [{"at": 0.0}, {"at": 1.0}], "durationMs": 100.0}, "delayStepMs": 0.0, "order": "logical", "ruby": "with-base"});
    assert_optional_field::<TextUnitAnimationInput>(&fixture, "delayStepMs", |input| {
        input.delay_step_ms.is_none()
    });
    assert_numeric_field::<TextUnitAnimationInput>(
        &fixture,
        "delayStepMs",
        NumericWireType::Float64,
    );
    assert_optional_field::<TextUnitAnimationInput>(&fixture, "order", |input| {
        input.order.is_none()
    });
    assert_optional_field::<TextUnitAnimationInput>(&fixture, "ruby", |input| input.ruby.is_none());
    assert_output_round_trip::<TextUnitAnimationInput, TextUnitAnimation>(
        &fixture,
        &["delayStepMs", "order", "ruby"],
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<TextUnitAnimationInput>(unknown).is_ok());
}

#[test]
fn text_unit_animation_sample_keeps_directional_presence_and_round_trip() {
    let fixture = json!({"unitId": "unit", "bbox": {"x": 0.0, "y": 0.0, "w": 10.0, "h": 10.0}, "opacity": 0.0, "transform": {"scaleX": 1.0}});
    assert_optional_field::<TextUnitAnimationSampleInput>(&fixture, "bbox", |input| {
        input.bbox.is_none()
    });
    assert_optional_field::<TextUnitAnimationSampleInput>(&fixture, "opacity", |input| {
        input.opacity.is_none()
    });
    assert_numeric_field::<TextUnitAnimationSampleInput>(
        &fixture,
        "opacity",
        NumericWireType::Float64,
    );
    assert_optional_field::<TextUnitAnimationSampleInput>(&fixture, "transform", |input| {
        input.transform.is_none()
    });
    assert_output_round_trip::<TextUnitAnimationSampleInput, TextUnitAnimationSample>(
        &fixture,
        &["bbox", "opacity", "transform"],
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<TextUnitAnimationSampleInput>(unknown).is_ok());
}

#[test]
fn line_projections_preserve_optional_fields_and_placeholder_style() {
    use super::wire_input::{LineFragmentWire, LineWire};
    use crate::text::types::Line;

    let fragment = json!({
        "text": "A", "glyphs": [], "width": 8.0,
        "style": {
            "font": "Fixture", "fontWeight": 400, "fontStyle": "normal",
            "fontSizePx": 16.0, "letterSpacingPx": 0.0, "color": "#000000"
        }
    });
    assert_optional_field::<LineFragmentWire>(&fragment, "style", |input| input.style.is_none());
    let line = json!({
        "text": "A", "glyphs": [], "width": 8.0, "baselineY": 12.0,
        "fragments": [fragment], "positionedGlyphs": []
    });
    assert_optional_field::<LineWire>(&line, "fragments", |input| input.fragments.is_none());
    assert_optional_field::<LineWire>(&line, "positionedGlyphs", |input| {
        input.positioned_glyphs.is_none()
    });
    let mut missing_style = line;
    missing_style["fragments"][0]
        .as_object_mut()
        .expect("fragment")
        .remove("style");
    let decoded: LineWire =
        serde_json::from_value(missing_style).expect("colorless style omission");
    let domain = Line::from(decoded);
    let style = &domain.fragments.expect("fragment retained")[0].style;
    assert_eq!(style.font_weight, 400);
    assert_eq!(style.font_size_px, 0.0);
    assert_eq!(style.letter_spacing_px, 0.0);
    assert!(style.color.is_none());
}
