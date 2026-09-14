//! Exercise finite construction with the actual layout, IR, and animation DTOs.

use serde_json::json;

use crate::diagnostics::PipelineStage;
use crate::error::EngineError;
use crate::ir::animation::{AffineMatrixDto, AnimationStateSample};
use crate::ir::types::{Ir, IrNode};
use crate::ir::wire_input::IrNodeInput;
use crate::layout::types::{LayoutNodeOutput, LayoutOutput, TextLayoutOutput};
use crate::wire::finite::{FiniteOutput, OutputConstructionError};

fn text_output() -> TextLayoutOutput {
    TextLayoutOutput {
        glyphs: Vec::new(),
        measured_width: 0.0,
        measured_height: 20.0,
        lines: None,
        bbox: None,
        chosen_font_size_px: None,
        overflow: None,
        source_text: None,
        display_text: None,
        unit_map: None,
        warnings: Vec::new(),
        inline_box_decorations: Vec::new(),
        text_decorations: Vec::new(),
        inline_rects: Vec::new(),
    }
}

fn assert_wasm_output_error(
    error: OutputConstructionError,
    operation: &'static str,
    field: &'static str,
) {
    let EngineError::StructuredContext {
        code,
        message,
        stage,
        node_id,
        context,
    } = error.into_engine_error(operation)
    else {
        panic!("non-finite output must remain structured");
    };
    assert_eq!(code, "WASM_NON_FINITE_OUTPUT");
    assert_eq!(message, "WASM output contains a non-finite number.");
    assert_eq!(stage, Some(PipelineStage::Wasm));
    assert_eq!(node_id, None);
    assert_eq!(*context, json!({"operation": operation, "field": field}));
}

#[test]
fn text_layout_chosen_size_keeps_its_existing_error_contract() {
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut output = text_output();
        output.chosen_font_size_px = Some(invalid);
        let failure = output.try_output().err().expect("invalid text output");
        let EngineError::StructuredContext {
            code,
            stage,
            context,
            ..
        } = failure
        else {
            panic!("text output must remain structured");
        };
        assert_eq!(code, "TEXT_LAYOUT_OUTPUT_INVALID");
        assert_eq!(stage, Some(PipelineStage::Wasm));
        assert_eq!(
            *context,
            json!({"operation": "renderTextLayout", "phase": "serialize"})
        );
    }
    let absent = text_output();
    let encoded =
        serde_json::to_value(absent.try_output().expect("absent fit size")).expect("JSON");
    assert!(encoded.get("chosenFontSizePx").is_none());
    for number in [-0.0, 0.0, 16.0, f64::MAX] {
        let mut output = text_output();
        output.chosen_font_size_px = Some(number);
        assert!(output.try_output().is_ok());
    }
}

#[test]
fn layout_output_checks_f32_geometry_before_json_conversion() {
    for invalid in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        let output = LayoutOutput {
            nodes: vec![LayoutNodeOutput {
                node_id: "caller-owned-id".to_string(),
                x: 0.0,
                y: 0.0,
                width: invalid,
                height: 20.0,
                text_layout: None,
            }],
            measure_call_count: 0,
            measure_cache_hits: 0,
        };
        let error = FiniteOutput::try_new(output)
            .err()
            .expect("invalid layout geometry");
        assert_wasm_output_error(error, "compute_layout", "width");
    }
}

#[test]
fn animation_output_rejects_optional_opacity_and_every_affine_channel() {
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let sample = AnimationStateSample {
            node_id: "node".to_string(),
            opacity: Some(invalid),
            transform: None,
        };
        let error = FiniteOutput::try_new(vec![sample])
            .err()
            .expect("invalid opacity");
        assert_wasm_output_error(error, "sample_animation_state", "opacity");
        for channel in ["a", "b", "c", "d", "e", "f"] {
            let mut matrix = AffineMatrixDto {
                a: 1.0,
                b: 0.0,
                c: 0.0,
                d: 1.0,
                e: 0.0,
                f: 0.0,
            };
            match channel {
                "a" => matrix.a = invalid,
                "b" => matrix.b = invalid,
                "c" => matrix.c = invalid,
                "d" => matrix.d = invalid,
                "e" => matrix.e = invalid,
                _ => matrix.f = invalid,
            }
            let sample = AnimationStateSample {
                node_id: "node".to_string(),
                opacity: None,
                transform: Some(matrix),
            };
            let error = FiniteOutput::try_new(vec![sample])
                .err()
                .expect("invalid matrix");
            assert_wasm_output_error(error, "sample_animation_state", channel);
        }
    }
    for opacity in [-f64::MAX, -0.0, 0.0, f64::MAX] {
        let sample = AnimationStateSample {
            node_id: "node".to_string(),
            opacity: Some(opacity),
            transform: None,
        };
        let encoded = serde_json::to_value(FiniteOutput::try_new(sample).expect("finite opacity"))
            .expect("JSON");
        assert_eq!(encoded["opacity"], json!(opacity));
    }
    let sample = AnimationStateSample {
        node_id: "node".to_string(),
        opacity: None,
        transform: None,
    };
    assert_eq!(
        serde_json::to_value(FiniteOutput::try_new(vec![sample]).expect("absent pose"))
            .expect("JSON"),
        json!([{"nodeId": "node"}])
    );
}

#[test]
fn finite_animation_inputs_can_report_a_typed_output_overflow() {
    let root = serde_json::from_value::<IrNodeInput>(json!({
        "nodeId": "node", "type": "group", "bbox": {"x":0,"y":0,"w":10,"h":10},
        "animation": {
            "durationMs": 100, "easing": "linear", "fill": "both",
            "keyframes": [
                {"at":0,"transform":{"translateX":-f64::MAX}},
                {"at":1,"transform":{"translateX":f64::MAX}}
            ]
        }
    }))
    .expect("finite input DTO");
    let source = Ir {
        root: IrNode::from(root),
        draw_order: vec!["node".to_string()],
        width: 10.0,
        height: 10.0,
        debug: None,
        warnings: Vec::new(),
    };
    assert!(crate::ir::animation::validate_animations(&source).is_ok());
    let error = crate::ir::animation::sample_animation_state(&source, 50.0)
        .expect_err("overflowed sampled transform");
    let EngineError::StructuredContext {
        code,
        stage,
        context,
        ..
    } = error
    else {
        panic!("typed output failure");
    };
    assert_eq!(code, "WASM_NON_FINITE_OUTPUT");
    assert_eq!(stage, Some(PipelineStage::Wasm));
    assert_eq!(
        *context,
        json!({"operation":"sample_animation_state", "field":"e"})
    );
}
