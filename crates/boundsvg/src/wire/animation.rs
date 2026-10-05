//! Presence and primitive-type validation before exact animated-session deserialization.

use serde_json::value::RawValue;
use serde_json::{Map, Value};

use crate::error::EngineError;
use crate::raster_anim::{
    AnimatedRasterFormat, AnimatedRasterIterations, AnimationFailureReason,
    AnimationSessionOptions, animation_failure,
};
use crate::rasterize::RasterizeOptions;

/// Decode one object without interpreting parse-error text or echoing untrusted keys.
///
/// # Errors
///
/// Return a closed malformedJson, wrongType or unknownField diagnostic.
fn parse_object(
    raw: &str,
    format: AnimatedRasterFormat,
    operation: &str,
    keys: &[&str],
) -> Result<Map<String, Value>, EngineError> {
    let value: Value = serde_json::from_str(raw).map_err(|_| {
        animation_failure(
            format,
            operation,
            AnimationFailureReason::MalformedJson,
            None,
            None,
        )
    })?;
    let Value::Object(object) = value else {
        return Err(animation_failure(
            format,
            operation,
            AnimationFailureReason::WrongType,
            None,
            None,
        ));
    };
    let format =
        if operation == "open" && object.get("format").and_then(Value::as_str) == Some("gif") {
            AnimatedRasterFormat::Gif
        } else {
            format
        };
    if object.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err(animation_failure(
            format,
            operation,
            AnimationFailureReason::UnknownField,
            None,
            None,
        ));
    }
    Ok(object)
}

/// Authenticate a required field's missing, null and primitive-type states.
///
/// # Errors
///
/// Return a field-specific missingField, nullField or wrongType diagnostic.
fn assert_required(
    object: &Map<String, Value>,
    field: &str,
    format: AnimatedRasterFormat,
    operation: &str,
    accepts: impl FnOnce(&Value) -> bool,
) -> Result<(), EngineError> {
    let reason = match object.get(field) {
        None => Some(AnimationFailureReason::MissingField),
        Some(Value::Null) => Some(AnimationFailureReason::NullField),
        Some(value) if !accepts(value) => Some(AnimationFailureReason::WrongType),
        Some(_) => None,
    };
    if let Some(reason) = reason {
        return Err(animation_failure(
            format,
            operation,
            reason,
            Some(field),
            None,
        ));
    }
    Ok(())
}

/// Parse an open request while retaining serde's exact integer-token rejection.
///
/// # Errors
///
/// Return a presence, type, keyword, exact-integer or nested-options diagnostic.
pub(crate) fn parse_open(
    raw: &str,
) -> Result<
    (
        AnimatedRasterFormat,
        AnimationSessionOptions,
        AnimationRenderOptionsInput,
    ),
    EngineError,
> {
    let object = parse_object(
        raw,
        AnimatedRasterFormat::Webp,
        "open",
        &[
            "format",
            "frameCount",
            "iterations",
            "options",
            "renderOptions",
        ],
    )?;
    let format = match object.get("format").and_then(Value::as_str) {
        Some("gif") => AnimatedRasterFormat::Gif,
        _ => AnimatedRasterFormat::Webp,
    };
    assert_required(&object, "format", format, "open", Value::is_string)?;
    assert_required(&object, "frameCount", format, "open", Value::is_number)?;
    assert_required(&object, "iterations", format, "open", |value| {
        value.is_number() || value.is_string()
    })?;
    if object.contains_key("options") {
        assert_required(&object, "options", format, "open", Value::is_object)?;
    }
    assert_required(&object, "renderOptions", format, "open", Value::is_object)?;
    if !matches!(
        object.get("format").and_then(Value::as_str),
        Some("webp" | "gif")
    ) {
        return Err(animation_failure(
            format,
            "open",
            AnimationFailureReason::OutOfDomain,
            Some("format"),
            None,
        ));
    }
    // Parse each original token after all presence/type checks; a Value
    // roundtrip could turn an exponent or negative zero into an integer.
    // Raw fields keep integer spelling and reject root duplicates after root shape checks.
    let field_tokens: OpenFieldTokens<'_> = serde_json::from_str(raw).map_err(|_| {
        animation_failure(
            format,
            "open",
            AnimationFailureReason::OutOfDomain,
            None,
            None,
        )
    })?;
    let frame_count = parse_field(field_tokens.frame_count, "frameCount", format, "open")?;
    let iterations: AnimatedRasterIterations =
        parse_field(field_tokens.iterations, "iterations", format, "open")?;
    let raster_options = if let Some(token) = field_tokens.options {
        parse_field(token, "options", format, "open")?
    } else {
        RasterizeOptions::default()
    };
    let render_shape = object
        .get("renderOptions")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            render_options_failure(
                format,
                AnimationFailureReason::WrongType,
                Some("renderOptions"),
            )
        })?;
    assert_render_shape(render_shape, format)?;
    let render_options = parse_render_options(field_tokens.render_options.get(), format)?;
    Ok((
        format,
        AnimationSessionOptions {
            frame_count,
            iterations,
            raster_options,
        },
        render_options,
    ))
}

/// Retain original field tokens while rejecting root duplicates before ordered domain checks.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct OpenFieldTokens<'a> {
    /// Retain this spelling for duplicate authentication; format was resolved from the shape pass.
    #[serde(borrow, rename = "format")]
    _format: &'a RawValue,
    /// Original integer spelling for the frame-count boundary.
    #[serde(borrow, rename = "frameCount")]
    frame_count: &'a RawValue,
    /// Original integer or keyword spelling for the iteration boundary.
    #[serde(borrow, rename = "iterations")]
    iterations: &'a RawValue,
    /// Optional raster settings already authenticated for presence and object shape.
    #[serde(default, borrow, rename = "options")]
    options: Option<&'a RawValue>,
    /// Fixed emission settings whose nested shape and domain are checked in order.
    #[serde(borrow, rename = "renderOptions")]
    render_options: &'a RawValue,
}

/// Decode a previously authenticated field from its original JSON token.
///
/// # Errors
///
/// Return a closed field-specific domain error on exact-integer or nested DTO failure.
fn parse_field<'a, T: serde::Deserialize<'a>>(
    token: &'a RawValue,
    field: &str,
    format: AnimatedRasterFormat,
    operation: &str,
) -> Result<T, EngineError> {
    serde_json::from_str(token.get()).map_err(|_| {
        animation_failure(
            format,
            operation,
            AnimationFailureReason::OutOfDomain,
            Some(field),
            None,
        )
    })
}

/// Only static sampling is accepted by the incremental raster bridge.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AnimationStaticMode {
    /// Sample one authored time without emitting declarative animation markup.
    Static,
}

/// Closed SVG emission settings owned once by a native animation session.
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct AnimationRenderOptionsInput {
    /// Required static emission mode.
    pub(crate) animation: AnimationStaticMode,
    /// Applied raster scale after the shared resolution preflight.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub(crate) scale: Option<f64>,
    /// Existing boolean or selected-parts debug overlay.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub(crate) debug: Option<crate::DebugOverlayInput>,
    /// Already sanitized prefix for emitted SVG resource identifiers.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub(crate) resource_id_prefix: Option<String>,
    /// Existing include/omit node identity policy.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub(crate) node_id_metadata: Option<crate::NodeIdMetadataInput>,
    /// Existing parity flag, without changing the emitter's interpretation.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub(crate) rasterizer_compat: Option<bool>,
    /// Validated public package/service identity.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub(crate) generator: Option<crate::output_generator::OutputGenerator>,
}

/// Construct a field-specific fixed-setting diagnostic without echoing source or untrusted keys.
fn render_options_failure(
    format: AnimatedRasterFormat,
    reason: AnimationFailureReason,
    field: Option<&str>,
) -> EngineError {
    animation_failure(format, "open", reason, field, None)
}

/// Authenticate a nested object's closed keys before inspecting its fields.
fn assert_render_keys(
    object: &Map<String, Value>,
    keys: &[&str],
    format: AnimatedRasterFormat,
) -> Result<(), EngineError> {
    if object.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err(render_options_failure(
            format,
            AnimationFailureReason::UnknownField,
            Some("renderOptions"),
        ));
    }
    Ok(())
}

/// Authenticate one emission field while keeping nested diagnostic identities closed.
fn assert_render_required(
    object: &Map<String, Value>,
    field: &str,
    format: AnimatedRasterFormat,
    accepts: impl FnOnce(&Value) -> bool,
) -> Result<(), EngineError> {
    let reason = match object.get(field) {
        None => Some(AnimationFailureReason::MissingField),
        Some(Value::Null) => Some(AnimationFailureReason::NullField),
        Some(option) if !accepts(option) => Some(AnimationFailureReason::WrongType),
        Some(_) => None,
    };
    if let Some(reason) = reason {
        return Err(render_options_failure(
            format,
            reason,
            Some("renderOptions"),
        ));
    }
    Ok(())
}

/// Authenticate optional emission fields without accepting null as absence.
fn assert_render_optional(
    object: &Map<String, Value>,
    field: &str,
    format: AnimatedRasterFormat,
    accepts: impl FnOnce(&Value) -> bool,
) -> Result<(), EngineError> {
    if object.contains_key(field) {
        assert_render_required(object, field, format, accepts)?;
    }
    Ok(())
}

/// Check the complete emission shape before exact-token or numeric-domain checks.
fn assert_render_shape(
    options: &Map<String, Value>,
    format: AnimatedRasterFormat,
) -> Result<(), EngineError> {
    assert_render_keys(
        options,
        &[
            "animation",
            "scale",
            "debug",
            "resourceIdPrefix",
            "nodeIdMetadata",
            "rasterizerCompat",
            "generator",
        ],
        format,
    )?;
    assert_render_required(options, "animation", format, Value::is_string)?;
    assert_render_optional(options, "scale", format, Value::is_number)?;
    assert_render_optional(options, "debug", format, |option| {
        option.is_boolean() || option.is_object()
    })?;
    if let Some(Value::Object(debug)) = options.get("debug") {
        assert_render_keys(debug, &["parts"], format)?;
        assert_render_optional(debug, "parts", format, Value::is_array)?;
        if let Some(Value::Array(parts)) = debug.get("parts") {
            if parts.iter().any(|part| !part.is_string()) {
                return Err(render_options_failure(
                    format,
                    AnimationFailureReason::WrongType,
                    Some("renderOptions"),
                ));
            }
        }
    }
    assert_render_optional(options, "resourceIdPrefix", format, Value::is_string)?;
    assert_render_optional(options, "nodeIdMetadata", format, Value::is_string)?;
    assert_render_optional(options, "rasterizerCompat", format, Value::is_boolean)?;
    assert_render_optional(options, "generator", format, Value::is_object)?;
    if let Some(Value::Object(generator)) = options.get("generator") {
        assert_render_keys(generator, &["name", "version"], format)?;
        assert_render_required(generator, "name", format, Value::is_string)?;
        assert_render_required(generator, "version", format, Value::is_string)?;
    }
    Ok(())
}

/// Decode fixed settings only after all nested presence/type checks have passed.
///
/// # Errors
///
/// Return a closed duplicate, keyword or emission-domain diagnostic.
fn parse_render_options(
    raw: &str,
    format: AnimatedRasterFormat,
) -> Result<AnimationRenderOptionsInput, EngineError> {
    let domain = || {
        render_options_failure(
            format,
            AnimationFailureReason::OutOfDomain,
            Some("renderOptions"),
        )
    };
    let render_options: AnimationRenderOptionsInput =
        serde_json::from_str(raw).map_err(|_| domain())?;
    if render_options
        .scale
        .is_some_and(|scale| !scale.is_finite() || scale <= 0.0)
    {
        return Err(domain());
    }
    if let Some(crate::DebugOverlayInput::Config(debug)) = &render_options.debug {
        if debug.parts.as_ref().is_some_and(|parts| {
            parts.iter().any(|part| {
                !matches!(
                    part.as_str(),
                    "specified" | "layout" | "actual" | "baseline"
                )
            })
        }) {
            return Err(domain());
        }
    }
    if render_options
        .generator
        .as_ref()
        .is_some_and(|generator| generator.validate().is_err())
    {
        return Err(domain());
    }
    Ok(render_options)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diagnostic(raw: &str) -> (String, Option<String>) {
        let EngineError::StructuredContext { context, .. } =
            parse_open(raw).err().expect("invalid open")
        else {
            panic!("expected structured diagnostic");
        };
        assert_eq!(context["operation"], "open");
        (
            context["reason"].as_str().expect("reason").into(),
            context
                .get("field")
                .and_then(Value::as_str)
                .map(str::to_owned),
        )
    }

    #[test]
    fn fixed_configuration_is_required_and_shape_precedes_domains() {
        for (tail, reason) in [
            ("", "missingField"),
            (",\"renderOptions\":null", "nullField"),
            (",\"renderOptions\":false", "wrongType"),
        ] {
            let raw = format!(r#"{{"format":"gif","frameCount":1.0,"iterations":1{tail}}}"#);
            assert_eq!(
                diagnostic(&raw),
                (reason.into(), Some("renderOptions".into()))
            );
        }
        assert_eq!(
            diagnostic(
                r#"{"format":"gif","frameCount":1,"iterations":1,"renderOptions":{"animation":"wrong","debug":{"parts":null}}}"#
            ),
            ("nullField".into(), Some("renderOptions".into()))
        );
        assert_eq!(
            diagnostic(
                r#"{"format":"gif","frameCount":1e0,"iterations":1,"renderOptions":{"animation":"static"}}"#
            ),
            ("outOfDomain".into(), Some("frameCount".into()))
        );
    }

    #[test]
    fn escaped_root_keys_keep_original_integer_tokens_and_duplicate_order() {
        let raw = r#"{"\u0066ormat":"gif","frame\u0043ount":1,"iterations":1,"render\u004fptions":{"animation":"static"}}"#;
        let (format, options, _) = parse_open(raw).expect("valid escaped root keys");
        assert_eq!(format, AnimatedRasterFormat::Gif);
        assert_eq!(options.frame_count, 1);
        assert_eq!(
            diagnostic(
                r#"{"\u0066ormat":"gif","frame\u0043ount":1.0,"iterations":1,"renderOptions":{"animation":"static"}}"#
            ),
            ("outOfDomain".into(), Some("frameCount".into()))
        );
        assert_eq!(
            diagnostic(
                r#"{"format":"gif","\u0066ormat":"gif","frameCount":1,"iterations":1,"renderOptions":{"animation":"static"}}"#
            ),
            ("outOfDomain".into(), None)
        );
    }

    #[test]
    fn root_duplicates_follow_root_shape_and_precede_token_domains() {
        for field in [
            "format",
            "frameCount",
            "iterations",
            "options",
            "renderOptions",
        ] {
            let token = match field {
                "format" => r#""gif""#,
                "frameCount" | "iterations" => "1",
                "options" => "{}",
                _ => r#"{"animation":"static"}"#,
            };
            let raw = format!(
                r#"{{"format":"gif","frameCount":1,"iterations":1,"options":{{}},"renderOptions":{{"animation":"static"}},"{field}":{token}}}"#
            );
            assert_eq!(diagnostic(&raw), ("outOfDomain".into(), None), "{field}");
        }
        assert_eq!(
            diagnostic(
                r#"{"format":"gif","format":"gif","frameCount":1,"iterations":1,"renderOptions":{"animation":"static"},"extra":1}"#
            ),
            ("unknownField".into(), None)
        );
        assert_eq!(
            diagnostic(
                r#"{"format":"gif","format":"gif","frameCount":1,"iterations":1,"renderOptions":null}"#
            ),
            ("nullField".into(), Some("renderOptions".into()))
        );
    }

    #[test]
    fn fixed_and_nested_duplicates_and_domains_are_closed() {
        for settings in [
            r#"{"animation":"static","animation":"static"}"#,
            r#"{"animation":"static","debug":{"parts":[],"parts":[]}}"#,
            r#"{"animation":"static","generator":{"name":"pkg","name":"pkg","version":"1"}}"#,
            r#"{"animation":"static","scale":0}"#,
            r#"{"animation":"static","nodeIdMetadata":"other"}"#,
            r#"{"animation":"static","debug":{"parts":["other"]}}"#,
            r#"{"animation":"static","generator":{"name":"Wrong","version":"1"}}"#,
        ] {
            let raw = format!(
                r#"{{"format":"gif","frameCount":1,"iterations":1,"renderOptions":{settings}}}"#
            );
            assert_eq!(
                diagnostic(&raw),
                ("outOfDomain".into(), Some("renderOptions".into())),
                "{settings}"
            );
        }
        assert_eq!(
            diagnostic(
                r#"{"format":"gif","frameCount":1,"iterations":1,"renderOptions":{"animation":"static","animation":"static","scale":null}}"#
            ),
            ("nullField".into(), Some("renderOptions".into()))
        );
    }

    #[test]
    fn fixed_settings_keep_unicode_and_positive_subnormal_scale() {
        let raw = r#"{"format":"gif","frameCount":1,"iterations":1,"renderOptions":{"animation":"static","scale":5e-324,"resourceIdPrefix":"日本語 \ud83d\ude00","debug":{"parts":["layout","layout"]}}}"#;
        let (_, _, options) = parse_open(raw).expect("valid fixed settings");
        assert_eq!(options.scale.expect("scale").to_bits(), 1);
        assert_eq!(options.resource_id_prefix.as_deref(), Some("日本語 😀"));
        assert_eq!(
            diagnostic(
                r#"{"format":"gif","frameCount":1,"iterations":1,"renderOptions":{"animation":"static","resourceIdPrefix":"\ud800"}}"#
            ),
            ("malformedJson".into(), None)
        );
    }
}
