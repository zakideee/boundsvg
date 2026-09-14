//! Inject invalid numeric results through the real text-operation output boundary.

use serde_json::{Value, json};

use super::types::{
    ShrinkwrapFlowInput, ShrinkwrapFlowResultDto, ShrinkwrapStatusDto, ShrinkwrapTextInput,
    ShrinkwrapTextResult, TextFlowExclusionLine, TextFlowFragment, TextFlowFragmentStyle,
    TextFlowWithExclusionsInput, TextFlowWithExclusionsResult,
};
use crate::text_diagnostics::{TextLayoutDiagnostic, TextLayoutOperation};

fn assert_output_failure(diagnostic: &TextLayoutDiagnostic, operation: TextLayoutOperation) {
    assert_eq!(diagnostic.code, "TEXT_LAYOUT_OUTPUT_INVALID");
    assert_eq!(diagnostic.stage, crate::diagnostics::PipelineStage::Wasm);
    assert_eq!(
        diagnostic.context,
        json!({"operation": operation.as_str(), "phase": "serialize"})
    );
}

fn shrinkwrap_text_output() -> ShrinkwrapTextResult {
    ShrinkwrapTextResult {
        status: ShrinkwrapStatusDto::Satisfied,
        chosen_width_px: Some(100.0),
        chosen_height_px: Some(20.0),
        line_count: 1,
        used_width: Some(80.0),
        used_height: 20.0,
        max_line_width: Some(80.0),
    }
}

fn flow_output() -> TextFlowWithExclusionsResult {
    TextFlowWithExclusionsResult {
        lines: Vec::new(),
        exhausted: false,
        used_line_count: 0,
        overflow_reason: None,
        chosen_font_size_px: Some(16.0),
        warnings: Vec::new(),
        top_ruby_overflow_px: 0.0,
        bottom_ruby_overflow_px: 0.0,
    }
}

fn run_shrinkwrap_text(output: ShrinkwrapTextResult) -> Result<String, TextLayoutDiagnostic> {
    crate::run_text_layout_operation::<ShrinkwrapTextInput, ShrinkwrapTextInput, _, _>(
        TextLayoutOperation::ShrinkwrapText,
        r#"{"text":"A","fontFamily":"Fixture","fontSizePx":16,"maxWidth":100}"#,
        |_| Ok(output),
    )
}

fn run_flow(output: TextFlowWithExclusionsResult) -> Result<String, TextLayoutDiagnostic> {
    crate::run_text_layout_operation::<TextFlowWithExclusionsInput, TextFlowWithExclusionsInput, _, _>(
        TextLayoutOperation::LayoutTextFlowWithExclusions,
        r#"{"text":"A","fontFamily":"Fixture","fontSizePx":16,"flowBox":{"x":0,"y":0,"width":100,"height":80},"exclusions":[]}"#,
        |_| Ok(output),
    )
}

#[test]
fn shrinkwrap_text_optional_numbers_are_omitted_or_finite() {
    for index in 0..4 {
        for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut output = shrinkwrap_text_output();
            match index {
                0 => output.chosen_width_px = Some(invalid),
                1 => output.chosen_height_px = Some(invalid),
                2 => output.used_width = Some(invalid),
                _ => output.max_line_width = Some(invalid),
            }
            assert_output_failure(
                &run_shrinkwrap_text(output).expect_err("invalid output"),
                TextLayoutOperation::ShrinkwrapText,
            );
        }
    }
    let mut absent = shrinkwrap_text_output();
    absent.status = ShrinkwrapStatusDto::Infeasible;
    absent.chosen_width_px = None;
    absent.chosen_height_px = None;
    absent.used_width = None;
    absent.max_line_width = None;
    let encoded: Value =
        serde_json::from_str(&run_shrinkwrap_text(absent).expect("absent dimensions"))
            .expect("JSON");
    for field in [
        "chosenWidthPx",
        "chosenHeightPx",
        "usedWidth",
        "maxLineWidth",
    ] {
        assert!(encoded.get(field).is_none(), "{field}");
    }
    let mut finite = shrinkwrap_text_output();
    finite.chosen_width_px = Some(f64::MAX);
    finite.chosen_height_px = Some(-0.0);
    assert!(run_shrinkwrap_text(finite).is_ok());
}

#[test]
fn shrinkwrap_flow_checks_both_optional_axes() {
    for axis in 0..2 {
        for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let output = ShrinkwrapFlowResultDto {
                status: ShrinkwrapStatusDto::Satisfied,
                chosen_width_px: (axis == 0).then_some(invalid),
                chosen_height_px: (axis == 1).then_some(invalid),
                used_line_count: 1,
                used_height: 20.0,
                layout: flow_output(),
            };
            let failure = crate::run_text_layout_operation::<ShrinkwrapFlowInput, ShrinkwrapFlowInput, _, _>(
                TextLayoutOperation::ShrinkwrapFlow,
                r#"{"text":"A","fontFamily":"Fixture","fontSizePx":16,"flowBox":{"x":0,"y":0,"width":100,"height":80},"exclusions":[]}"#,
                |_| Ok(output),
            ).expect_err("invalid chosen axis");
            assert_output_failure(&failure, TextLayoutOperation::ShrinkwrapFlow);
        }
    }
}

#[test]
fn flow_chosen_size_and_fragment_spacing_fail_at_the_output_boundary() {
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut output = flow_output();
        output.chosen_font_size_px = Some(invalid);
        assert_output_failure(
            &run_flow(output).expect_err("invalid chosen size"),
            TextLayoutOperation::LayoutTextFlowWithExclusions,
        );

        let mut nested = flow_output();
        nested.lines.push(TextFlowExclusionLine {
            line_index: 0,
            cross_size: 20.0,
            fragments: vec![TextFlowFragment {
                text: "A".to_string(),
                char_start: 0,
                char_end: 1,
                x: 0.0,
                y: 0.0,
                inline_advance_px: 10.0,
                available_inline_size_px: 100.0,
                region_index: 0,
                baseline_offset: 12.0,
                overflow_reason: None,
                ruby: None,
                style: Some(TextFlowFragmentStyle {
                    font_family: "Fixture".to_string(),
                    font_weight: 400,
                    font_style: "normal".to_string(),
                    font_size_px: 16.0,
                    letter_spacing_px: Some(invalid),
                    color: None,
                }),
            }],
        });
        assert_output_failure(
            &run_flow(nested).expect_err("invalid nested spacing"),
            TextLayoutOperation::LayoutTextFlowWithExclusions,
        );
    }
    let mut absent = flow_output();
    absent.chosen_font_size_px = None;
    let encoded: Value =
        serde_json::from_str(&run_flow(absent).expect("no fit size")).expect("JSON");
    assert!(encoded.get("chosenFontSizePx").is_none());
}

#[test]
fn shrinkwrap_flow_optional_axes_omit_absence_and_preserve_finite_values() {
    for number in [None, Some(-0.0), Some(f64::MAX)] {
        let output = ShrinkwrapFlowResultDto {
            status: ShrinkwrapStatusDto::Satisfied,
            chosen_width_px: number,
            chosen_height_px: number,
            used_line_count: 1,
            used_height: 20.0,
            layout: flow_output(),
        };
        let encoded = crate::run_text_layout_operation::<ShrinkwrapFlowInput, ShrinkwrapFlowInput, _, _>(
            TextLayoutOperation::ShrinkwrapFlow,
            r#"{"text":"A","fontFamily":"Fixture","fontSizePx":16,"flowBox":{"x":0,"y":0,"width":100,"height":80},"exclusions":[]}"#,
            |_| Ok(output),
        ).expect("finite optional axes");
        let parsed: Value = serde_json::from_str(&encoded).expect("JSON");
        for field in ["chosenWidthPx", "chosenHeightPx"] {
            assert_eq!(parsed.get(field), number.map(|value| json!(value)).as_ref());
        }
    }
}

#[test]
fn fragment_spacing_and_flow_size_preserve_finite_output_presence() {
    for number in [None, Some(-0.0), Some(f64::MAX)] {
        let style = TextFlowFragmentStyle {
            font_family: "Fixture".to_string(),
            font_weight: 400,
            font_style: "normal".to_string(),
            font_size_px: 16.0,
            letter_spacing_px: number,
            color: None,
        };
        let output = crate::wire::finite::FiniteOutput::try_new(style).expect("finite spacing");
        let encoded = serde_json::to_value(output).expect("JSON");
        assert_eq!(
            encoded.get("letterSpacingPx"),
            number.map(|value| json!(value)).as_ref()
        );
        let mut flow = flow_output();
        flow.chosen_font_size_px = number;
        let encoded: Value =
            serde_json::from_str(&run_flow(flow).expect("finite size")).expect("JSON");
        assert_eq!(
            encoded.get("chosenFontSizePx"),
            number.map(|value| json!(value)).as_ref()
        );
    }
}
