//! Every optional floating-point field in the directional IR output is injected independently.

use super::{types, wire_input};
use crate::wire::finite::{FiniteOutput, OutputConstructionError};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

fn assert_non_finite_field<Input, Domain>(
    fixture: &Value,
    field: &'static str,
    set_number: impl Fn(&mut Domain, f64),
) where
    Input: DeserializeOwned,
    Domain: From<Input> + Serialize,
{
    for finite in [-f64::MAX, -0.0, 0.0, f64::MAX] {
        let decoded: Input = serde_json::from_value(fixture.clone()).expect("valid input fixture");
        let mut domain = Domain::from(decoded);
        set_number(&mut domain, finite);
        let output = FiniteOutput::try_new(domain).expect("finite output");
        let encoded = serde_json::to_value(output).expect("finite JSON");
        assert_eq!(encoded[field], json!(finite));
    }
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let decoded: Input = serde_json::from_value(fixture.clone()).expect("valid input fixture");
        let mut domain = Domain::from(decoded);
        set_number(&mut domain, invalid);
        let error = FiniteOutput::try_new(domain)
            .err()
            .expect("non-finite output");
        assert_eq!(error, OutputConstructionError::NonFinite { field });
    }
}

#[test]
fn opacity_in_animation_keyframe_must_be_finite() {
    assert_non_finite_field::<wire_input::AnimationKeyframeInput, types::AnimationKeyframe>(
        &json!({"at": 0}),
        "opacity",
        |domain, number| domain.opacity = Some(number),
    );
}

#[test]
fn delay_ms_in_animation_spec_must_be_finite() {
    assert_non_finite_field::<wire_input::AnimationSpecInput, types::AnimationSpec>(
        &json!({"keyframes": [{"at": 0}, {"at": 1}], "durationMs": 100}),
        "delayMs",
        |domain, number| domain.delay_ms = Some(number),
    );
}

#[test]
fn stiffness_in_animation_spring_must_be_finite() {
    assert_non_finite_field::<wire_input::AnimationSpringInput, types::AnimationSpring>(
        &json!({"type": "spring"}),
        "stiffness",
        |domain, number| domain.stiffness = Some(number),
    );
}

#[test]
fn damping_in_animation_spring_must_be_finite() {
    assert_non_finite_field::<wire_input::AnimationSpringInput, types::AnimationSpring>(
        &json!({"type": "spring"}),
        "damping",
        |domain, number| domain.damping = Some(number),
    );
}

#[test]
fn mass_in_animation_spring_must_be_finite() {
    assert_non_finite_field::<wire_input::AnimationSpringInput, types::AnimationSpring>(
        &json!({"type": "spring"}),
        "mass",
        |domain, number| domain.mass = Some(number),
    );
}

#[test]
fn translate_x_in_animation_transform2_d_must_be_finite() {
    assert_non_finite_field::<wire_input::AnimationTransform2DInput, types::AnimationTransform2D>(
        &json!({}),
        "translateX",
        |domain, number| domain.translate_x = Some(number),
    );
}

#[test]
fn translate_y_in_animation_transform2_d_must_be_finite() {
    assert_non_finite_field::<wire_input::AnimationTransform2DInput, types::AnimationTransform2D>(
        &json!({}),
        "translateY",
        |domain, number| domain.translate_y = Some(number),
    );
}

#[test]
fn scale_x_in_animation_transform2_d_must_be_finite() {
    assert_non_finite_field::<wire_input::AnimationTransform2DInput, types::AnimationTransform2D>(
        &json!({}),
        "scaleX",
        |domain, number| domain.scale_x = Some(number),
    );
}

#[test]
fn scale_y_in_animation_transform2_d_must_be_finite() {
    assert_non_finite_field::<wire_input::AnimationTransform2DInput, types::AnimationTransform2D>(
        &json!({}),
        "scaleY",
        |domain, number| domain.scale_y = Some(number),
    );
}

#[test]
fn rotate_deg_in_animation_transform2_d_must_be_finite() {
    assert_non_finite_field::<wire_input::AnimationTransform2DInput, types::AnimationTransform2D>(
        &json!({}),
        "rotateDeg",
        |domain, number| domain.rotate_deg = Some(number),
    );
}

#[test]
fn stroke_width_in_shape_part_paint_must_be_finite() {
    assert_non_finite_field::<wire_input::ShapePartPaintInput, types::ShapePartPaint>(
        &json!({}),
        "strokeWidth",
        |domain, number| domain.stroke_width = Some(number),
    );
}

#[test]
fn stroke_miterlimit_in_shape_part_paint_must_be_finite() {
    assert_non_finite_field::<wire_input::ShapePartPaintInput, types::ShapePartPaint>(
        &json!({}),
        "strokeMiterlimit",
        |domain, number| domain.stroke_miterlimit = Some(number),
    );
}

#[test]
fn delay_step_ms_in_text_unit_animation_must_be_finite() {
    assert_non_finite_field::<wire_input::TextUnitAnimationInput, types::TextUnitAnimation>(
        &json!({"by": "cluster", "animation": {"keyframes": [{"at": 0}, {"at": 1}], "durationMs": 100}}),
        "delayStepMs",
        |domain, number| domain.delay_step_ms = Some(number),
    );
}

#[test]
fn opacity_in_text_unit_animation_sample_must_be_finite() {
    assert_non_finite_field::<
        wire_input::TextUnitAnimationSampleInput,
        types::TextUnitAnimationSample,
    >(&json!({"unitId": "unit"}), "opacity", |domain, number| {
        domain.opacity = Some(number);
    });
}
