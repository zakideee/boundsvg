//! Exercise the real render-option DTOs independently of the field inventory.

use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use super::{
    AnimatedSvgOptionsInput, AnimationRenderModeInput, DebugOverlayConfigInput, DebugOverlayInput,
    RenderSvgOptions, RenderSvgOptionsInput, StaticSvgOptionsInput,
};

fn common_options() -> Value {
    json!({
        "scale": 1.0,
        "debug": { "parts": ["bbox"] },
        "rasterizerCompat": false,
        "resourceIdPrefix": "scene-",
        "nodeIdMetadata": "include",
        "textPathMode": "merged",
        "showMissingGlyphs": false,
        "timeMs": 0.0,
        "returnResolvedIr": false,
        "preserveResolvedUnitOutlines": false,
        "generator": { "name": "example", "version": "1.0.0" }
    })
}

fn assert_option_presence<T: DeserializeOwned>(fixture: &Value, required_keys: &[&str]) {
    serde_json::from_value::<T>(fixture.clone()).expect("valid complete options");
    let fields = fixture.as_object().expect("options object");
    for (field, original) in fields {
        if required_keys.contains(&field.as_str()) {
            continue;
        }
        let mut omitted = fixture.clone();
        omitted
            .as_object_mut()
            .expect("options object")
            .remove(field);
        assert!(
            serde_json::from_value::<T>(omitted).is_ok(),
            "{field}: missing"
        );

        let mut present_null = fixture.clone();
        present_null[field] = Value::Null;
        assert!(
            serde_json::from_value::<T>(present_null).is_err(),
            "{field}: null"
        );

        let mut wrong_type = fixture.clone();
        wrong_type[field] = if original.is_object() || original.is_array() {
            json!(37)
        } else {
            json!([])
        };
        assert!(
            serde_json::from_value::<T>(wrong_type).is_err(),
            "{field}: wrong type"
        );
    }
}

#[test]
fn static_options_preserve_presence_and_domain_values() {
    let fixture = common_options();
    assert_option_presence::<StaticSvgOptionsInput>(&fixture, &[]);
    let options: RenderSvgOptions = serde_json::from_value::<StaticSvgOptionsInput>(fixture)
        .expect("static options")
        .into();
    assert_eq!(options.scale, Some(1.0));
    assert_eq!(options.time_ms, Some(0.0));
    assert_eq!(options.show_missing_glyphs, Some(false));
    assert_eq!(options.resource_id_prefix.as_deref(), Some("scene-"));
    assert!(matches!(
        options.animation,
        Some(AnimationRenderModeInput::Static)
    ));
    assert!(options.timeline_playback.is_none());
    assert!(!options.enforce_png_outline_glyph_limit);
}

#[test]
fn animated_options_keep_required_playback_during_presence_checks() {
    let mut fixture = common_options();
    fixture["playback"] = json!({ "mode": "independent" });
    fixture["reducedMotion"] = json!("keep");
    assert_option_presence::<AnimatedSvgOptionsInput>(&fixture, &["playback"]);
    let options: RenderSvgOptions = serde_json::from_value::<AnimatedSvgOptionsInput>(fixture)
        .expect("animated options")
        .into();
    assert!(matches!(
        options.animation,
        Some(AnimationRenderModeInput::Declarative)
    ));
    assert!(options.timeline_playback.is_none());
    assert_eq!(options.time_ms, Some(0.0));
    assert_eq!(options.return_resolved_ir, Some(false));
}

#[test]
fn render_options_preserve_presence_and_internal_defaults() {
    let mut fixture = common_options();
    fixture["animation"] = json!("static");
    fixture["reducedMotion"] = json!("pause");
    fixture["sampleAnimation"] = json!(false);
    assert_option_presence::<RenderSvgOptionsInput>(&fixture, &[]);
    let options: RenderSvgOptions = serde_json::from_value::<RenderSvgOptionsInput>(fixture)
        .expect("render options")
        .into();
    assert_eq!(options.sample_animation, Some(false));
    assert_eq!(options.preserve_resolved_unit_outlines, Some(false));
    assert!(options.timeline_playback.is_none());

    let defaults: RenderSvgOptions = serde_json::from_str::<RenderSvgOptionsInput>("{}")
        .expect("omitted options")
        .into();
    assert!(defaults.scale.is_none());
    assert!(defaults.animation.is_none());
    assert!(defaults.sample_animation.is_none());
    assert!(!defaults.enforce_png_outline_glyph_limit);
}

#[test]
fn debug_parts_reject_null_and_preserve_empty_values() {
    assert_option_presence::<DebugOverlayConfigInput>(&json!({ "parts": ["bbox"] }), &[]);
    let empty: DebugOverlayConfigInput =
        serde_json::from_str(r#"{"parts":[]}"#).expect("empty parts");
    assert_eq!(empty.parts, Some(vec![]));
    for fixture in [
        json!({ "debug": false }),
        json!({ "debug": { "parts": [] } }),
    ] {
        let options: RenderSvgOptionsInput = serde_json::from_value(fixture).expect("debug value");
        assert!(options.debug.is_some());
    }
    let options: RenderSvgOptionsInput =
        serde_json::from_value(json!({ "debug": false })).expect("false debug");
    assert!(matches!(
        options.debug,
        Some(DebugOverlayInput::Flag(false))
    ));
    for fixture in [
        json!({ "debug": { "parts": null } }),
        json!({ "debug": { "parts": [null] } }),
    ] {
        assert!(serde_json::from_value::<RenderSvgOptionsInput>(fixture).is_err());
    }
}

#[test]
fn unknown_fields_keep_each_object_policy() {
    assert!(serde_json::from_value::<RenderSvgOptionsInput>(json!({ "extra": true })).is_ok());
    assert!(serde_json::from_value::<DebugOverlayConfigInput>(json!({ "extra": true })).is_ok());
    assert!(serde_json::from_value::<StaticSvgOptionsInput>(json!({ "extra": true })).is_err());
    assert!(
        serde_json::from_value::<AnimatedSvgOptionsInput>(json!({
            "playback": { "mode": "independent" }, "extra": true
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<RenderSvgOptionsInput>(json!({
            "generator": { "name": "example", "version": "1.0.0", "extra": true }
        }))
        .is_err()
    );
}

#[test]
fn numeric_codec_preserves_finite_values_and_rejects_overflow() {
    for field in ["scale", "timeMs"] {
        for token in [
            "-1.7976931348623157e308",
            "-0.0",
            "0",
            "1",
            "1.7976931348623157e308",
        ] {
            let input_json = format!(r#"{{"{field}":{token}}}"#);
            assert!(serde_json::from_str::<RenderSvgOptionsInput>(&input_json).is_ok());
            assert!(serde_json::from_str::<StaticSvgOptionsInput>(&input_json).is_ok());
            let animated_json =
                format!(r#"{{"playback":{{"mode":"independent"}},"{field}":{token}}}"#);
            assert!(serde_json::from_str::<AnimatedSvgOptionsInput>(&animated_json).is_ok());
        }
        let input_json = format!(r#"{{"{field}":1e400}}"#);
        assert!(serde_json::from_str::<RenderSvgOptionsInput>(&input_json).is_err());
        assert!(serde_json::from_str::<StaticSvgOptionsInput>(&input_json).is_err());
        let animated_json = format!(r#"{{"playback":{{"mode":"independent"}},"{field}":1e400}}"#);
        assert!(serde_json::from_str::<AnimatedSvgOptionsInput>(&animated_json).is_err());
    }
}
