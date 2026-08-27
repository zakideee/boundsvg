#![expect(
    clippy::too_many_lines,
    reason = "render/layout orchestration keeps stateful pipeline phases together for auditability"
)]
#![expect(
    clippy::cognitive_complexity,
    reason = "layout/style mapping and text measurement encode many independent SVG/CSS compatibility branches"
)]

pub mod error;
pub mod flow;
pub mod font;
#[cfg(feature = "resvg-backend")]
pub mod gif_anim;
pub mod image_url;
pub mod ir;
#[cfg(feature = "ir-schema")]
pub mod ir_schema;
pub mod layout;
mod layout_transition;
pub mod output_generator;
#[cfg(test)]
mod pipeline_phase_trace;
#[cfg(feature = "resvg-backend")]
pub mod raster_anim;
#[cfg(feature = "resvg-backend")]
pub mod rasterize;
pub mod render_backend;
#[cfg(feature = "resvg-backend")]
pub mod render_resvg;
pub mod scene;
pub mod svg_emit;
#[cfg(feature = "resvg-backend")]
pub mod webp_anim;
#[cfg(feature = "resvg-backend")]
pub mod webp_encode;
pub use boundtext::text;

use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use wasm_bindgen::prelude::*;

use boundshape::{
    CompileGeometryOptions, DivideRegions as ShapeDivideRegions, GeometryDoc as ShapeGeometryDoc,
    GeometryIntersection as ShapeGeometryIntersection, GeometryPaint, GeometryPreserveAspectRatio,
    GeometryViewport, Region as ShapeRegion, SymbolDefinition as ShapeSymbolDefinition,
    SymbolResolutionOptions as ShapeSymbolResolutionOptions,
};
use font::{FontRegistry, FontStyle};
use render_backend::Renderer;
#[cfg(feature = "resvg-backend")]
use render_resvg::ResvgRenderer;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PositionedGlyphPathRequest {
    glyph_id: u32,
    font_size_px: f64,
    origin_x: f64,
    origin_y: f64,
    rotation_deg: u16,
    #[serde(default)]
    baseline_rotation_deg: Option<f64>,
    #[serde(default)]
    inline_scale: Option<f64>,
    writing_mode: String,
    font_alias: String,
    font_weight: u16,
    font_style: String,
    font_variation_settings: Option<String>,
    #[serde(default)]
    show_missing_glyphs: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompileShapeSvgInput {
    geometry: ShapeGeometryDoc,
    #[serde(default)]
    paint: Option<GeometryPaint>,
    #[serde(default)]
    viewport: Option<GeometryViewport>,
    #[serde(default)]
    preserve_aspect_ratio: GeometryPreserveAspectRatio,
    #[serde(default)]
    part_ids: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveSymbolGeometryInput {
    definition: ShapeSymbolDefinition,
    options: ShapeSymbolResolutionOptions,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvaluateShapeRegionInput {
    geometry: ShapeGeometryDoc,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvaluateShapePartsInput {
    geometry: ShapeGeometryDoc,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShapeBooleanPairInput {
    lhs: ShapeGeometryDoc,
    rhs: ShapeGeometryDoc,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderShapeRegionSvgInput {
    region: ShapeRegion,
    #[serde(default)]
    paint: Option<GeometryPaint>,
    #[serde(default)]
    viewport: Option<GeometryViewport>,
    #[serde(default)]
    preserve_aspect_ratio: GeometryPreserveAspectRatio,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidateLayeredSvgCompositionInput {
    single_svg: String,
    layers: Vec<rasterize::LayeredSvgValidationLayerInput>,
    #[serde(default)]
    options: Option<rasterize::RasterizeOptions>,
}

/// SVG render/emit options mirroring the TS `EmitSvgOptions` /
/// `RenderOptions` camelCase JSON (`packages/core/src/engine.ts`).
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderSvgOptionsInput {
    /// Scale factor — multiplies the root `width`/`height` attributes.
    #[serde(default)]
    scale: Option<f64>,
    /// Debug overlay: `boolean | { parts?: string[] }`.
    #[serde(default)]
    debug: Option<DebugOverlayInput>,
    /// Accepted for API parity; the current TS emitter threads the flag but
    /// never reads it, so it has no effect on the output.
    #[expect(
        dead_code,
        reason = "mirrors the TS EmitSvgOptions shape; the TS emitter carries the flag without reading it"
    )]
    #[serde(default)]
    rasterizer_compat: Option<bool>,
    /// Prefix applied to boundsvg-generated resource IDs in `<defs>`.
    #[serde(default)]
    resource_id_prefix: Option<String>,
    /// Text outline grouping mode ("merged" | "glyphs"); default "merged".
    /// `render_to_ir` also reads it for Text nodes with unit animation.
    #[serde(default)]
    text_path_mode: Option<String>,
    /// Render synthetic tofu rectangles for missing glyphs. Default false.
    /// `render_to_ir` also reads it for Text nodes with unit animation.
    #[serde(default)]
    show_missing_glyphs: Option<bool>,
    /// SVG animation emit mode. SVG defaults to declarative; PNG callers
    /// explicitly request static sampling.
    #[serde(default)]
    animation: Option<AnimationRenderModeInput>,
    /// Deterministic animation sampling time in milliseconds.
    #[serde(default)]
    time_ms: Option<f64>,
    /// Emit a `prefers-reduced-motion` opt-out alongside declarative
    /// animation CSS. Defaults to `keep`, which leaves output unchanged.
    #[serde(default)]
    reduced_motion: Option<ReducedMotionInput>,
    /// Internal `render_to_ir` control used by `compileScene` to retain the
    /// unsampled source IR for later compiled-scene emission.
    #[serde(default)]
    sample_animation: Option<bool>,
    /// Internal transport control: return the same fully resolved IR used by
    /// one-shot SVG emission. False keeps the selective `render_to_ir` shape.
    #[serde(default)]
    return_resolved_ir: Option<bool>,
    /// Internal transport control for compiled unit-animation scenes.
    #[serde(default)]
    preserve_resolved_unit_outlines: Option<bool>,
    /// Raster-only safety gate. When true, preflight and outline resolution
    /// consume the same parsed IR inside one native operation.
    #[serde(default)]
    enforce_png_outline_glyph_limit: bool,
    /// Public package/service identity embedded in the exported file.
    #[serde(default)]
    generator: Option<output_generator::OutputGenerator>,
}

/// Compile-only options for layout transitions. Authored animation tracks are
/// always retained, so `sampleAnimation` is deliberately not accepted.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayoutTransitionCompileOptionsInput {
    #[serde(default)]
    text_path_mode: Option<String>,
}

/// Raster preflight limit. The request predicate and traversal live in the
/// Rust outline resolver beside materialization.
const PNG_MAX_OUTLINE_GLYPHS: usize = 16_384;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderToIrOutput<'a> {
    ir: &'a ir::types::Ir,
    warnings: &'a [ir::types::RenderWarning],
}

fn collect_text_node_ids<'a>(node: &'a ir::types::IrNode, target: &mut Vec<&'a str>) {
    match &node.kind {
        ir::types::IrNodeKind::Group { children, .. } => {
            for child in children {
                collect_text_node_ids(child, target);
            }
        }
        ir::types::IrNodeKind::Text { .. } => target.push(&node.node_id),
        _ => {}
    }
}

/// Subset of the public TS `IR` shape consumed by SVG emission.
///
/// `drawOrder` and `warnings` are intentionally omitted: neither affects the
/// paint scene. Keeping this wire type shared prevents the one-shot and
/// prepared emit paths from drifting.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmitIrInput {
    root: ir::types::IrNode,
    width: f64,
    height: f64,
    #[serde(default)]
    debug: Option<bool>,
}

#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum AnimationRenderModeInput {
    #[default]
    Declarative,
    Static,
}

#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum ReducedMotionInput {
    #[default]
    Keep,
    Pause,
}

/// Wire shape of the TS `boolean | DebugOverlayConfig` debug option.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(untagged)]
enum DebugOverlayInput {
    Flag(bool),
    Config(DebugOverlayConfigInput),
}

/// Wire shape of the TS `DebugOverlayConfig`.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DebugOverlayConfigInput {
    #[serde(default)]
    parts: Option<Vec<String>>,
}

/// Parse the options JSON for the SVG render/emit exports.
/// An empty/whitespace payload means "no options".
fn parse_render_svg_options(options_json: &str) -> Result<RenderSvgOptionsInput, JsValue> {
    if options_json.trim().is_empty() {
        return Ok(RenderSvgOptionsInput::default());
    }
    serde_json::from_str(options_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid SVG emit options JSON: {e}")))
}

fn text_decoration_wire_error(
    node_id: Option<&str>,
    message: impl Into<String>,
) -> error::EngineError {
    error::EngineError::Structured {
        code: "TEXT_DECORATION_INVALID".to_string(),
        message: message.into(),
        stage: Some("validate".to_string()),
        node_id: node_id.map(str::to_string),
    }
}

fn text_decoration_skip_ink_unsupported(node_id: Option<&str>) -> error::EngineError {
    error::EngineError::Structured {
        code: "TEXT_DECORATION_SKIP_INK_UNSUPPORTED".to_string(),
        message: "textDecoration.skipInk=\"all\" requires underline or overline.".to_string(),
        stage: Some("validate".to_string()),
        node_id: node_id.map(str::to_string),
    }
}

fn validate_text_decoration_wire_value(
    value: &serde_json::Value,
    node_id: Option<&str>,
) -> Result<(), error::EngineError> {
    const ALLOWED_KEYS: [&str; 6] = [
        "line",
        "color",
        "style",
        "thicknessPx",
        "offsetPx",
        "skipInk",
    ];

    let Some(decoration) = value.as_object() else {
        return Err(text_decoration_wire_error(
            node_id,
            "textDecoration must be an object.",
        ));
    };
    if decoration
        .keys()
        .any(|key| !ALLOWED_KEYS.contains(&key.as_str()))
    {
        return Err(text_decoration_wire_error(
            node_id,
            "textDecoration contains an unknown property.",
        ));
    }
    let Some(lines) = decoration.get("line").and_then(serde_json::Value::as_array) else {
        return Err(text_decoration_wire_error(
            node_id,
            "textDecoration.line must be a non-empty array.",
        ));
    };
    if lines.is_empty() {
        return Err(text_decoration_wire_error(
            node_id,
            "textDecoration.line must not be empty.",
        ));
    }
    let mut seen_lines = std::collections::HashSet::new();
    for line in lines {
        let Some(line) = line.as_str() else {
            return Err(text_decoration_wire_error(
                node_id,
                "textDecoration.line contains an invalid value.",
            ));
        };
        if !matches!(line, "underline" | "overline" | "line-through") {
            return Err(text_decoration_wire_error(
                node_id,
                "textDecoration.line contains an invalid value.",
            ));
        }
        if !seen_lines.insert(line) {
            return Err(text_decoration_wire_error(
                node_id,
                "textDecoration.line must not contain duplicates.",
            ));
        }
    }
    let Some(color) = decoration.get("color").and_then(serde_json::Value::as_str) else {
        return Err(text_decoration_wire_error(
            node_id,
            "textDecoration.color must be a valid color.",
        ));
    };
    if !ir::gradient::is_valid_color(color) {
        return Err(text_decoration_wire_error(
            node_id,
            "textDecoration.color must be a valid color.",
        ));
    }
    if decoration.get("style").is_some_and(|style| {
        !matches!(
            style.as_str(),
            Some("solid" | "double" | "dotted" | "dashed" | "wavy")
        )
    }) {
        return Err(text_decoration_wire_error(
            node_id,
            "textDecoration.style must be solid, double, dotted, dashed, or wavy.",
        ));
    }
    if decoration
        .get("skipInk")
        .is_some_and(|skip_ink| !matches!(skip_ink.as_str(), Some("none" | "all")))
    {
        return Err(text_decoration_wire_error(
            node_id,
            "textDecoration.skipInk must be none or all.",
        ));
    }
    if decoration
        .get("skipInk")
        .and_then(serde_json::Value::as_str)
        == Some("all")
        && !seen_lines.contains("underline")
        && !seen_lines.contains("overline")
    {
        return Err(text_decoration_skip_ink_unsupported(node_id));
    }
    if decoration.get("thicknessPx").is_some_and(|thickness| {
        thickness
            .as_f64()
            .is_none_or(|thickness| !thickness.is_finite() || thickness <= 0.0)
    }) {
        return Err(text_decoration_wire_error(
            node_id,
            "textDecoration.thicknessPx must be a positive finite number.",
        ));
    }
    if decoration
        .get("offsetPx")
        .is_some_and(|offset| offset.as_f64().is_none_or(|offset| !offset.is_finite()))
    {
        return Err(text_decoration_wire_error(
            node_id,
            "textDecoration.offsetPx must be a finite number.",
        ));
    }
    Ok(())
}

fn validate_rich_text_decoration_wire_values(
    values: &[serde_json::Value],
    node_id: Option<&str>,
) -> Result<(), error::EngineError> {
    for value in values {
        let Some(rich_node) = value.as_object() else {
            continue;
        };
        if let Some(style) = rich_node
            .get("style")
            .and_then(serde_json::Value::as_object)
            && let Some(decoration) = style.get("textDecoration")
        {
            validate_text_decoration_wire_value(decoration, node_id)?;
        }
        for child_key in ["children", "base", "rt"] {
            if let Some(children) = rich_node
                .get(child_key)
                .and_then(serde_json::Value::as_array)
            {
                validate_rich_text_decoration_wire_values(children, node_id)?;
            }
        }
        if let Some(levels) = rich_node
            .get("rtLevels")
            .and_then(serde_json::Value::as_array)
        {
            for level in levels {
                if let Some(children) = level.as_array() {
                    validate_rich_text_decoration_wire_values(children, node_id)?;
                }
            }
        }
    }
    Ok(())
}

fn validate_layout_text_decoration_wire_values(
    value: &serde_json::Value,
) -> Result<(), error::EngineError> {
    let Some(layout_node) = value.as_object() else {
        return Ok(());
    };
    let node_id = layout_node
        .get("nodeId")
        .and_then(serde_json::Value::as_str);
    if let Some(text) = layout_node
        .get("text")
        .and_then(serde_json::Value::as_object)
    {
        if let Some(spans) = text.get("spans").and_then(serde_json::Value::as_array) {
            for span in spans {
                if let Some(decoration) =
                    span.as_object().and_then(|span| span.get("textDecoration"))
                {
                    validate_text_decoration_wire_value(decoration, node_id)?;
                }
            }
        }
        if let Some(rich_text) = text.get("richText").and_then(serde_json::Value::as_array) {
            validate_rich_text_decoration_wire_values(rich_text, node_id)?;
        }
    }
    if let Some(text_path) = layout_node
        .get("textPath")
        .and_then(serde_json::Value::as_object)
        && let Some(spans) = text_path.get("spans").and_then(serde_json::Value::as_array)
    {
        for span in spans {
            if let Some(decoration) = span.as_object().and_then(|span| span.get("textDecoration")) {
                validate_text_decoration_wire_value(decoration, node_id)?;
            }
        }
    }
    if let Some(children) = layout_node
        .get("children")
        .and_then(serde_json::Value::as_array)
    {
        for child in children {
            validate_layout_text_decoration_wire_values(child)?;
        }
    }
    Ok(())
}

fn parse_layout_input(input_json: &str) -> Result<layout::LayoutInput, JsValue> {
    #[cfg(test)]
    pipeline_phase_trace::record_layout_input_parse();
    let raw_input: serde_json::Value = serde_json::from_str(input_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid input JSON: {e}")))?;
    if let Some(root) = raw_input.get("root") {
        validate_layout_text_decoration_wire_values(root)
            .map_err(|error| engine_error_to_render_envelope(&error))?;
    }
    serde_json::from_value(raw_input)
        .map_err(|e| JsValue::from_str(&format!("Invalid input JSON: {e}")))
}

fn parse_layout_input_with_raw(
    input_json: &str,
) -> Result<(layout::LayoutInput, serde_json::Value), JsValue> {
    #[cfg(test)]
    pipeline_phase_trace::record_layout_input_parse();
    let raw_input: serde_json::Value = serde_json::from_str(input_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid input JSON: {error}")))?;
    if let Some(root) = raw_input.get("root") {
        validate_layout_text_decoration_wire_values(root)
            .map_err(|error| engine_error_to_render_envelope(&error))?;
    }
    let input = serde_json::from_value(raw_input.clone())
        .map_err(|error| JsValue::from_str(&format!("Invalid input JSON: {error}")))?;
    Ok((input, raw_input))
}

fn to_paint_scene_options(
    options: &RenderSvgOptionsInput,
) -> Result<scene::PaintSceneOptions, error::EngineError> {
    if let Some(generator) = &options.generator {
        generator.validate()?;
    }
    Ok(scene::PaintSceneOptions {
        scale: options.scale.unwrap_or(1.0),
        debug: match &options.debug {
            None => scene::DebugOverlaySetting::Unset,
            Some(DebugOverlayInput::Flag(enabled)) => scene::DebugOverlaySetting::Flag(*enabled),
            Some(DebugOverlayInput::Config(config)) => {
                scene::DebugOverlaySetting::Config(config.parts.clone())
            }
        },
        resource_id_prefix: options.resource_id_prefix.clone().unwrap_or_default(),
        animation_mode: match options.animation.unwrap_or_default() {
            AnimationRenderModeInput::Declarative => scene::AnimationMode::Declarative,
            AnimationRenderModeInput::Static => scene::AnimationMode::Static,
        },
        time_ms: options.time_ms.unwrap_or(0.0),
        reduced_motion: match options.reduced_motion.unwrap_or_default() {
            ReducedMotionInput::Keep => scene::ReducedMotionMode::Keep,
            ReducedMotionInput::Pause => scene::ReducedMotionMode::Pause,
        },
        generator: options.generator.clone(),
    })
}

fn to_outline_resolve_options(
    options: &RenderSvgOptionsInput,
) -> svg_emit::outline_resolver::OutlineResolveOptions {
    svg_emit::outline_resolver::OutlineResolveOptions {
        text_path_mode: svg_emit::outline_resolver::TextPathMode::parse_str(
            options.text_path_mode.as_deref().unwrap_or("merged"),
        ),
        show_missing_glyphs: options.show_missing_glyphs.unwrap_or(false),
        preserve_resolved_unit_outlines: options.preserve_resolved_unit_outlines.unwrap_or(false),
    }
}

fn parse_emit_ir(ir_json: &str) -> Result<ir::types::Ir, JsValue> {
    #[cfg(test)]
    pipeline_phase_trace::record_emit_ir_parse();
    let input: EmitIrInput = serde_json::from_str(ir_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid IR JSON: {e}")))?;
    let parsed_ir = ir::types::Ir {
        root: input.root,
        draw_order: Vec::new(),
        width: input.width,
        height: input.height,
        debug: input.debug,
        warnings: Vec::new(),
    };
    // Hand-authored IRs bypass the VNode build path that vets nested SVG
    // content. Both one-shot and prepared entry points are trust boundaries.
    assert_ir_svg_content_safe(&parsed_ir.root)?;
    ir::animation::validate_text_animation_budgets(&parsed_ir.root)
        .map_err(|error| engine_error_to_render_envelope(&error))?;
    Ok(parsed_ir)
}

fn emit_prepared_ir(
    prepared_ir: &ir::types::Ir,
    options: &RenderSvgOptionsInput,
) -> Result<String, JsValue> {
    let sampled_ir = ir::animation::sample_animation(prepared_ir, options.time_ms.unwrap_or(0.0))
        .map_err(|e| engine_error_to_render_envelope(&e))?;
    let paint_options =
        to_paint_scene_options(options).map_err(|e| engine_error_to_render_envelope(&e))?;
    let paint_scene = scene::resolve_paint_scene(&sampled_ir, &paint_options)
        .map_err(|e| engine_error_to_render_envelope(&e))?;
    svg_emit::emitter::emit_svg_scene(&paint_scene).map_err(|e| engine_error_to_render_envelope(&e))
}

/// Serialize an error as the structured JSON envelope the TS engine
/// backend rebuilds into a `FatalError` (code / message / stage / nodeId).
fn render_error_envelope(
    code: &str,
    message: &str,
    stage: Option<&str>,
    node_id: Option<&str>,
) -> JsValue {
    let envelope = serde_json::json!({
        "code": code,
        "message": message,
        "stage": stage,
        "nodeId": node_id,
    });
    JsValue::from_str(&envelope.to_string())
}

fn transition_compatibility_error_to_js(
    mismatch: &layout_transition::CompatibilityMismatch,
) -> JsValue {
    let category = mismatch.category.as_str();
    let (code, stage) = if mismatch.category == layout_transition::CompatibilityCategory::Schedule {
        ("LAYOUT_TRANSITION_INVALID_SCHEDULE", "validate")
    } else {
        ("LAYOUT_TRANSITION_INCOMPATIBLE", "layout")
    };
    let quoted_node_id = serde_json::Value::String(mismatch.node_id.clone()).to_string();
    let message = format!(
        "Layout transition {category} mismatch for node {quoted_node_id}: expected {}, observed {}",
        mismatch.expected, mismatch.observed
    );
    let envelope = serde_json::json!({
        "code": code,
        "message": message,
        "stage": stage,
        "nodeId": mismatch.node_id,
        "context": {
            "stage": stage,
            "nodeId": mismatch.node_id,
            "category": category,
            "expected": mismatch.expected,
            "observed": mismatch.observed,
        },
    });
    JsValue::from_str(&envelope.to_string())
}

/// Map an [`error::EngineError`] onto the structured envelope, preserving
/// the TS `FatalError` contract for structured errors and falling back to a
/// generic code otherwise.
fn engine_error_to_render_envelope(error: &error::EngineError) -> JsValue {
    match error {
        error::EngineError::Structured {
            code,
            message,
            stage,
            node_id,
        } => render_error_envelope(code, message, stage.as_deref(), node_id.as_deref()),
        other => render_error_envelope("WASM_RENDER_FAILED", &other.to_string(), None, None),
    }
}

fn raster_error_to_js_value(error: error::EngineError) -> JsValue {
    match error {
        structured @ error::EngineError::Structured { .. } => {
            engine_error_to_render_envelope(&structured)
        }
        other => JsValue::from_str(&other.to_string()),
    }
}

fn assert_png_outline_glyph_limit(ir: &ir::types::Ir) -> Result<(), JsValue> {
    let Some(exceeded) = svg_emit::outline_resolver::find_outline_glyph_limit_exceeded(
        &ir.root,
        PNG_MAX_OUTLINE_GLYPHS,
    ) else {
        return Ok(());
    };
    let message = format!(
        "PNG rendering exceeds the outline glyph limit of {}.",
        exceeded.max_glyphs
    );
    let envelope = serde_json::json!({
        "code": "PNG_OUTLINE_GLYPH_LIMIT",
        "message": message,
        "stage": "emit",
        "nodeId": exceeded.node_id,
        "context": {
            "stage": "emit",
            "nodeId": exceeded.node_id,
            "maxGlyphs": exceeded.max_glyphs,
            "actualGlyphs": exceeded.actual_glyphs,
        },
    });
    Err(JsValue::from_str(&envelope.to_string()))
}

fn resolve_emit_ir(
    ir_json: &str,
    options_json: &str,
    registry: &FontRegistry,
) -> Result<(ir::types::Ir, RenderSvgOptionsInput), JsValue> {
    let mut parsed_ir = parse_emit_ir(ir_json)?;
    let options = parse_render_svg_options(options_json)?;
    if options.enforce_png_outline_glyph_limit {
        assert_png_outline_glyph_limit(&parsed_ir)?;
    }
    #[cfg(test)]
    pipeline_phase_trace::record_full_outline_resolve();
    svg_emit::outline_resolver::resolve_text_outlines(
        &mut parsed_ir.root,
        registry,
        &to_outline_resolve_options(&options),
    )
    .map_err(|error| engine_error_to_render_envelope(&error))?;
    Ok((parsed_ir, options))
}

fn assert_raster_scene_owner(scene: &BoundSvgRasterScene, owner: &Arc<()>) -> Result<(), JsValue> {
    if Arc::ptr_eq(owner, &scene.owner) {
        return Ok(());
    }
    Err(render_error_envelope(
        "RASTER_SCENE_WRONG_ENGINE",
        "Raster scene belongs to a different engine instance",
        Some("engine"),
        None,
    ))
}

fn resolve_raster_scene_outlines(
    scene: &mut BoundSvgRasterScene,
    registry: &FontRegistry,
) -> Result<(), JsValue> {
    if scene.resolved {
        return Ok(());
    }
    #[cfg(test)]
    pipeline_phase_trace::record_full_outline_resolve();
    svg_emit::outline_resolver::resolve_text_outlines(
        &mut scene.ir.root,
        registry,
        &to_outline_resolve_options(&scene.options),
    )
    .map_err(|error| engine_error_to_render_envelope(&error))?;
    scene.resolved = true;
    Ok(())
}

/// Reject unsafe nested SVG content in an externally supplied IR.
/// Mirrors the `VNode` build path check (`unsafe_svg_reason`),
/// walking every `Svg` node's content.
fn assert_ir_svg_content_safe(node: &ir::types::IrNode) -> Result<(), JsValue> {
    if let ir::types::IrNodeKind::Svg { content, .. } = &node.kind {
        if let Some(reason) = ir::svg_security::unsafe_svg_reason(content) {
            return Err(render_error_envelope(
                "VALIDATION",
                &format!("Validation error: Svg content contains disallowed markup ({reason})"),
                Some("ir"),
                Some(&node.node_id),
            ));
        }
    }
    if let ir::types::IrNodeKind::Group { children, .. } = &node.kind {
        for child in children {
            assert_ir_svg_content_safe(child)?;
        }
    }
    Ok(())
}

/// Guard the render entry point against a malformed canvas size
/// (mirrors the TS `assertRenderableCanvas`).
fn assert_renderable_canvas(ir: &ir::types::Ir) -> Result<(), JsValue> {
    for (name, value) in [("width", ir.width), ("height", ir.height)] {
        if !value.is_finite() || value <= 0.0 {
            let value_text = svg_emit::num_format::format_js_number(value);
            return Err(render_error_envelope(
                "INVALID_CANVAS_SIZE",
                &format!("Compiled scene has an invalid canvas {name}: {value_text}"),
                Some("emit"),
                None,
            ));
        }
    }
    Ok(())
}

/// Run the ordinary layout → IR → selective outline pipeline while retaining
/// the typed layout input for private transition provenance.
fn compile_layout_input_to_ir(
    input: &layout::LayoutInput,
    options: &RenderSvgOptionsInput,
    registry: &FontRegistry,
) -> Result<ir::types::Ir, JsValue> {
    let output = layout::compute_full_layout_with_registry(input, registry)
        .map_err(|error| engine_error_to_render_envelope(&error))?;
    let node_outputs: std::collections::HashMap<String, layout::LayoutNodeOutput> = output
        .nodes
        .into_iter()
        .map(|node| (node.node_id.clone(), node))
        .collect();
    let mut built_ir = ir::builder::build_ir(&input.root, &node_outputs)
        .map_err(|error| engine_error_to_render_envelope(&error))?;

    assert_renderable_canvas(&built_ir)?;
    let requested_scale = options.scale.unwrap_or(1.0);
    if !requested_scale.is_finite() || requested_scale <= 0.0 {
        let scale_text = svg_emit::num_format::format_js_number(requested_scale);
        return Err(render_error_envelope(
            "SVG_INVALID_SCALE",
            &format!("Invalid SVG scale factor: {scale_text}"),
            Some("emit"),
            None,
        ));
    }

    svg_emit::text_decoration_resolver::resolve_text_decoration_skip_ink(
        &mut built_ir.root,
        registry,
        &mut built_ir.warnings,
    )
    .map_err(|error| engine_error_to_render_envelope(&error))?;
    #[cfg(test)]
    pipeline_phase_trace::record_animated_outline_resolve();
    svg_emit::outline_resolver::resolve_animated_text_outlines(
        &mut built_ir.root,
        registry,
        &to_outline_resolve_options(options),
    )
    .map_err(|error| engine_error_to_render_envelope(&error))?;

    if options.sample_animation.unwrap_or(true) {
        ir::animation::sample_animation(&built_ir, options.time_ms.unwrap_or(0.0))
            .map_err(|error| engine_error_to_render_envelope(&error))
    } else {
        ir::animation::validate_animations(&built_ir)
            .map_err(|error| engine_error_to_render_envelope(&error))?;
        Ok(built_ir)
    }
}

fn compile_transition_inputs_with<Compile>(
    reference_input: &layout::LayoutInput,
    reference_raw: &serde_json::Value,
    target_input: &layout::LayoutInput,
    target_raw: &serde_json::Value,
    transition_plan: &layout_transition::LayoutTransitionPlanInput,
    mut compile: Compile,
) -> Result<ir::types::Ir, JsValue>
where
    Compile: FnMut(&layout::LayoutInput) -> Result<ir::types::Ir, JsValue>,
{
    let reference_ir = compile(reference_input)?;
    let reference_state = layout_transition::CompiledTransitionState::from_layout_input(
        reference_input,
        reference_raw,
        reference_ir,
    )
    .map_err(|mismatch| transition_compatibility_error_to_js(&mismatch))?;
    let target_ir = compile(target_input)?;
    let target_state = layout_transition::CompiledTransitionState::from_layout_input(
        target_input,
        target_raw,
        target_ir,
    )
    .map_err(|mismatch| transition_compatibility_error_to_js(&mismatch))?;

    reference_state
        .into_transition_ir(target_state, transition_plan)
        .map_err(|mismatch| transition_compatibility_error_to_js(&mismatch))
}

// ---------------------------------------------------------------------------
// Instance-based engine (each instance owns its own FontRegistry)
// ---------------------------------------------------------------------------

/// Instance-based engine that owns its own `FontRegistry`.
/// Each JS-side instance gets isolated font state — no cross-contamination.
///
/// ```js
/// const engine = new BoundSvgEngine();
/// engine.register_font(data, "NotoSansJP", 400, "normal");
/// const svg = engine.compute_layout(inputJson);
/// engine.free(); // release Rust-side memory
/// ```
#[wasm_bindgen]
pub struct BoundSvgEngine {
    registry: FontRegistry,
    renderer: Arc<dyn Renderer>,
    owner: Arc<()>,
}

/// Parsed, outline-resolved IR retained for repeated deterministic sampling.
///
/// The owner token ties the value to the `BoundSvgEngine` instance that
/// created it. JavaScript receives this as an opaque wasm-bindgen object; the
/// public API never exposes a numeric handle.
#[wasm_bindgen]
pub struct BoundSvgPreparedScene {
    ir: ir::types::Ir,
    owner: Arc<()>,
}

/// Parsed raster IR retained across the observable TS warning/resolution
/// callbacks. Glyph-limit preflight runs before construction returns; outline
/// resolution and SVG emission are explicit later operations on the same IR.
#[wasm_bindgen]
pub struct BoundSvgRasterScene {
    ir: ir::types::Ir,
    options: RenderSvgOptionsInput,
    owner: Arc<()>,
    resolved: bool,
}

impl Default for BoundSvgEngine {
    fn default() -> Self {
        Self::create()
    }
}

// Native Rust API (not wasm_bindgen — usable in native tests and as a library)
impl BoundSvgEngine {
    /// Create a new engine instance with an empty font registry (native).
    #[must_use]
    pub fn create() -> Self {
        BoundSvgEngine {
            registry: FontRegistry::new(),
            renderer: Arc::new(ResvgRenderer),
            owner: Arc::new(()),
        }
    }

    /// Create a new engine instance with a custom renderer.
    pub fn with_renderer(renderer: Arc<dyn Renderer>) -> Self {
        BoundSvgEngine {
            registry: FontRegistry::new(),
            renderer,
            owner: Arc::new(()),
        }
    }

    /// Get a reference to the internal font registry.
    #[must_use]
    pub fn registry(&self) -> &FontRegistry {
        &self.registry
    }

    /// Get a mutable reference to the internal font registry.
    pub fn registry_mut(&mut self) -> &mut FontRegistry {
        &mut self.registry
    }
}

/// Version of the JSON DTO contract across the WASM boundary.
///
/// Bump whenever any WASM-boundary DTO field or exported function signature
/// changes. The matching TS constant is
/// `EXPECTED_WASM_SCHEMA_VERSION` in `packages/core/src/wasm/index.ts`;
/// both sides must change in the same commit.
pub const WASM_SCHEMA_VERSION: u32 = 26;

/// Returns the WASM DTO schema version for the init-time handshake.
#[wasm_bindgen]
#[must_use]
pub fn wasm_schema_version() -> u32 {
    WASM_SCHEMA_VERSION
}

/// Compile a shape geometry document to a standalone SVG document string.
///
/// # Errors
///
/// Returns `JsValue` if the input JSON is invalid or geometry compilation fails.
#[wasm_bindgen]
pub fn compile_shape_svg(json_input: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let input: CompileShapeSvgInput = serde_json::from_str(json_input)
            .map_err(|e| JsValue::from_str(&format!("Invalid shape compile input: {e}")))?;
        let options = CompileGeometryOptions {
            paint: input.paint,
            viewport: input.viewport,
            preserve_aspect_ratio: input.preserve_aspect_ratio,
            part_ids: input.part_ids,
        };
        boundshape::compile_geometry_to_svg_document(&input.geometry, Some(&options))
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }))
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HitTestShapePartsInput {
    geometry: ShapeGeometryDoc,
    point: boundshape::Point2D,
    #[serde(default)]
    options: Option<boundshape::HitTestOptions>,
}

/// Precise per-part hit test in geometry coordinates. Additive export
/// (no schema bump).
///
/// # Errors
///
/// Returns `JsValue` if the input JSON is invalid, evaluation fails, or serialization fails.
#[wasm_bindgen]
pub fn hit_test_shape_parts(json_input: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let input: HitTestShapePartsInput = serde_json::from_str(json_input)
            .map_err(|e| JsValue::from_str(&format!("Invalid shape hit-test input: {e}")))?;
        let hits = boundshape::hit_test_geometry_parts(
            &input.geometry,
            input.point,
            input.options.as_ref(),
        )
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
        serde_json::to_string(&hits)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize shape hits: {e}")))
    }))
}

/// Compile a shape geometry document into per-part path data (viewport-baked)
/// instead of an SVG document string. Additive export (no schema bump):
/// same input DTO as `compile_shape_svg`.
///
/// # Errors
///
/// Returns `JsValue` if the input JSON is invalid, compilation fails, or serialization fails.
#[wasm_bindgen]
pub fn compile_shape_paths(json_input: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let input: CompileShapeSvgInput = serde_json::from_str(json_input)
            .map_err(|e| JsValue::from_str(&format!("Invalid shape compile input: {e}")))?;
        let options = CompileGeometryOptions {
            paint: input.paint,
            viewport: input.viewport,
            preserve_aspect_ratio: input.preserve_aspect_ratio,
            part_ids: input.part_ids,
        };
        let parts = boundshape::compile_geometry_paths(&input.geometry, Some(&options))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        serde_json::to_string(&parts).map_err(|e| {
            JsValue::from_str(&format!("Failed to serialize compiled shape paths: {e}"))
        })
    }))
}

/// Resolve a symbol definition to concrete geometry.
///
/// # Errors
///
/// Returns `JsValue` if the input JSON is invalid, symbol resolution fails,
/// the resolved geometry exceeds its depth limit, or serialization fails.
#[wasm_bindgen]
pub fn resolve_symbol_geometry(json_input: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let input: ResolveSymbolGeometryInput = serde_json::from_str(json_input)
            .map_err(|e| JsValue::from_str(&format!("Invalid symbol resolve input: {e}")))?;
        let geometry = boundshape::resolve_symbol_geometry(&input.definition, &input.options)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        serde_json::to_string(&geometry)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize symbol geometry: {e}")))
    }))
}

/// Evaluate a shape geometry document into its addressable parts.
///
/// # Errors
///
/// Returns `JsValue` if the input JSON is invalid, evaluation fails, or serialization fails.
#[wasm_bindgen]
pub fn evaluate_shape_parts(json_input: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let input: EvaluateShapePartsInput = serde_json::from_str(json_input)
            .map_err(|e| JsValue::from_str(&format!("Invalid shape parts input: {e}")))?;
        let parts = boundshape::evaluate_geometry_parts(&input.geometry)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        serde_json::to_string(&parts)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize shape parts: {e}")))
    }))
}

/// Evaluate a shape geometry document into a boolean-resolved region.
///
/// # Errors
///
/// Returns `JsValue` if the input JSON is invalid, evaluation fails, or serialization fails.
#[wasm_bindgen]
pub fn evaluate_shape_region(json_input: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let input: EvaluateShapeRegionInput = serde_json::from_str(json_input)
            .map_err(|e| JsValue::from_str(&format!("Invalid shape region input: {e}")))?;
        let region = boundshape::evaluate_geometry(&input.geometry)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        serde_json::to_string(&region)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize shape region: {e}")))
    }))
}

/// Render an evaluated shape region to an SVG document string.
///
/// # Errors
///
/// Returns `JsValue` if the input JSON is invalid.
#[wasm_bindgen]
pub fn render_shape_region_svg(json_input: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let input: RenderShapeRegionSvgInput = serde_json::from_str(json_input)
            .map_err(|e| JsValue::from_str(&format!("Invalid shape region render input: {e}")))?;
        let options = CompileGeometryOptions {
            paint: input.paint,
            viewport: input.viewport,
            preserve_aspect_ratio: input.preserve_aspect_ratio,
            part_ids: false,
        };
        Ok(boundshape::region_to_svg(&input.region, Some(&options)))
    }))
}

/// Divide two shape geometries into intersection/difference regions.
///
/// # Errors
///
/// Returns `JsValue` if the input JSON is invalid, evaluation fails, or serialization fails.
#[wasm_bindgen]
pub fn divide_shape_regions(json_input: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let input: ShapeBooleanPairInput = serde_json::from_str(json_input)
            .map_err(|e| JsValue::from_str(&format!("Invalid divide regions input: {e}")))?;
        let lhs = boundshape::evaluate_geometry(&input.lhs)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let rhs = boundshape::evaluate_geometry(&input.rhs)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let result: ShapeDivideRegions = boundshape::divide_regions(&lhs, &rhs)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        serde_json::to_string(&result)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize divide result: {e}")))
    }))
}

/// Compute intersection points between two shape geometries.
///
/// # Errors
///
/// Returns `JsValue` if the input JSON is invalid, computation fails, or serialization fails.
#[wasm_bindgen]
pub fn compute_shape_intersections(json_input: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let input: ShapeBooleanPairInput = serde_json::from_str(json_input)
            .map_err(|e| JsValue::from_str(&format!("Invalid shape intersections input: {e}")))?;
        let result: Vec<ShapeGeometryIntersection> =
            boundshape::intersections_between_geometries(&input.lhs, &input.rhs)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
        serde_json::to_string(&result)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize intersections: {e}")))
    }))
}

// Every exported method routes through `catch_unwind_to_js` so a panic surfaces
// as a JS exception instead of trapping the WASM instance (see the helper's docs
// for why `AssertUnwindSafe` is sound here).
#[wasm_bindgen]
impl BoundSvgEngine {
    /// Create a new engine instance with an empty font registry.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if a panic occurs during construction (converted by the panic guard).
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<BoundSvgEngine, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            console_error_panic_hook::set_once();
            Ok(BoundSvgEngine {
                registry: FontRegistry::new(),
                renderer: Arc::new(ResvgRenderer),
                owner: Arc::new(()),
            })
        }))
    }

    /// Register a font into this instance's registry.
    /// Accepts WOFF2, TTF, or OTF data — WOFF2 is decoded before registration.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if WOFF2 decoding or font registration fails.
    pub fn register_font(
        &mut self,
        data: &[u8],
        alias: &str,
        weight: u16,
        style: &str,
    ) -> Result<(), JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let font_style = parse_font_style(style);
            let decoded = font::decode::decode_font(data.to_vec())
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            self.registry
                .register(decoded, alias.to_string(), weight, font_style)
                .map_err(|e| JsValue::from_str(&e.to_string()))
        }))
    }

    /// Compute layout from JSON input using this instance's font registry.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the input JSON is invalid or layout computation fails.
    pub fn compute_layout(&self, input_json: &str) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let input = parse_layout_input(input_json)?;
            let output = layout::compute_full_layout_with_registry(&input, &self.registry)
                .map_err(|error| engine_error_to_render_envelope(&error))?;
            serde_json::to_string(&output)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {e}")))
        }))
    }

    /// Compute layout and build the IR in one call, returning
    /// `{ ir, warnings }` where `ir` matches the public TS IR contract.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the input JSON is invalid, layout computation
    /// fails, or IR building hits a validation error.
    pub fn render_to_ir(&self, input_json: &str, options_json: &str) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let input = parse_layout_input(input_json)?;
            let options = parse_render_svg_options(options_json)?;
            let sampled_ir = compile_layout_input_to_ir(&input, &options, &self.registry)?;
            serde_json::to_string(&RenderToIrOutput {
                ir: &sampled_ir,
                warnings: &sampled_ir.warnings,
            })
            .map_err(|error| JsValue::from_str(&format!("Failed to serialize IR output: {error}")))
        }))
    }

    /// Compile two layout states once each, validate private semantic
    /// compatibility, and return the generated transition as ordinary IR.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` when an input/options payload is invalid, ordinary
    /// compilation fails, or the two semantic states are incompatible.
    pub fn compile_layout_transition(
        &self,
        reference_input_json: &str,
        target_input_json: &str,
        transition_plan_json: &str,
        options_json: &str,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let (reference_input, reference_raw) =
                parse_layout_input_with_raw(reference_input_json)?;
            let (target_input, target_raw) = parse_layout_input_with_raw(target_input_json)?;
            let transition_plan: layout_transition::LayoutTransitionPlanInput =
                serde_json::from_str(transition_plan_json).map_err(|error| {
                    JsValue::from_str(&format!("Invalid layout transition plan JSON: {error}"))
                })?;
            transition_plan
                .validate(&reference_input.root.node_id)
                .map_err(|mismatch| transition_compatibility_error_to_js(&mismatch))?;
            let compile_options: LayoutTransitionCompileOptionsInput =
                serde_json::from_str(options_json).map_err(|error| {
                    JsValue::from_str(&format!("Invalid layout transition options JSON: {error}"))
                })?;
            let options = RenderSvgOptionsInput {
                text_path_mode: compile_options.text_path_mode,
                sample_animation: Some(false),
                ..RenderSvgOptionsInput::default()
            };

            let transition_ir = compile_transition_inputs_with(
                &reference_input,
                &reference_raw,
                &target_input,
                &target_raw,
                &transition_plan,
                |input| compile_layout_input_to_ir(input, &options, &self.registry),
            )?;
            serde_json::to_string(&RenderToIrOutput {
                ir: &transition_ir,
                warnings: &transition_ir.warnings,
            })
            .map_err(|error| JsValue::from_str(&format!("Failed to serialize IR output: {error}")))
        }))
    }

    /// Compute layout, build the IR, resolve text outlines, and emit the SVG
    /// document in one call. The string-only path returns warnings and the
    /// text-node IDs needed by TS postconditions; the SVG+IR path additionally
    /// returns the same fully resolved public IR used by the emitter.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if any JSON payload is invalid, layout/IR building
    /// fails, the canvas size or scale is invalid, or a referenced font is
    /// missing.
    pub fn render_to_svg(&self, input_json: &str, options_json: &str) -> Result<String, JsValue> {
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct RenderToSvgOutput<'a> {
            svg: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            ir: Option<&'a serde_json::value::RawValue>,
            warnings: &'a [ir::types::RenderWarning],
            text_node_ids: Vec<&'a str>,
        }

        catch_unwind_to_js(AssertUnwindSafe(|| {
            let input = parse_layout_input(input_json)?;
            let options = parse_render_svg_options(options_json)?;
            let output = layout::compute_full_layout_with_registry(&input, &self.registry)
                .map_err(|e| engine_error_to_render_envelope(&e))?;
            let node_outputs: std::collections::HashMap<String, layout::LayoutNodeOutput> = output
                .nodes
                .into_iter()
                .map(|node| (node.node_id.clone(), node))
                .collect();
            let mut built_ir = ir::builder::build_ir(&input.root, &node_outputs)
                .map_err(|e| engine_error_to_render_envelope(&e))?;
            svg_emit::text_decoration_resolver::resolve_text_decoration_skip_ink(
                &mut built_ir.root,
                &self.registry,
                &mut built_ir.warnings,
            )
            .map_err(|e| engine_error_to_render_envelope(&e))?;
            svg_emit::outline_resolver::resolve_animated_text_outlines(
                &mut built_ir.root,
                &self.registry,
                &to_outline_resolve_options(&options),
            )
            .map_err(|e| engine_error_to_render_envelope(&e))?;
            let mut sampled_ir =
                ir::animation::sample_animation(&built_ir, options.time_ms.unwrap_or(0.0))
                    .map_err(|e| engine_error_to_render_envelope(&e))?;

            let mut outline_options = to_outline_resolve_options(&options);
            outline_options.preserve_resolved_unit_outlines = true;
            svg_emit::outline_resolver::resolve_text_outlines(
                &mut sampled_ir.root,
                &self.registry,
                &outline_options,
            )
            .map_err(|e| engine_error_to_render_envelope(&e))?;

            let paint_options = to_paint_scene_options(&options)
                .map_err(|e| engine_error_to_render_envelope(&e))?;
            let paint_scene = scene::resolve_paint_scene(&sampled_ir, &paint_options)
                .map_err(|e| engine_error_to_render_envelope(&e))?;
            let svg = svg_emit::emitter::emit_svg_scene(&paint_scene)
                .map_err(|e| engine_error_to_render_envelope(&e))?;

            let resolved_ir_raw = if options.return_resolved_ir.unwrap_or(false) {
                Some(serde_json::value::to_raw_value(&sampled_ir).map_err(|e| {
                    JsValue::from_str(&format!("Failed to serialize IR output: {e}"))
                })?)
            } else {
                None
            };
            let mut text_node_ids = Vec::new();
            collect_text_node_ids(&sampled_ir.root, &mut text_node_ids);

            serde_json::to_string(&RenderToSvgOutput {
                svg: &svg,
                ir: resolved_ir_raw.as_deref(),
                warnings: &sampled_ir.warnings,
                text_node_ids,
            })
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize SVG output: {e}")))
        }))
    }

    /// Emit an SVG document string from a public-IR JSON payload
    /// (the TS `IR` contract shape). Mirrors the TS `emitSvg(ir, options)`
    /// entry point: no canvas/scale guards, no outline resolution — text
    /// nodes emit from the `glyphPaths` already present on the IR.
    ///
    /// Hand-authored-IR limitation: text nodes must carry the fields the
    /// engine always emits (`lines`, `font`, `fontSizePx`, `color`,
    /// `textAlign`, `layoutBox`, `lineHeightPx`). The TS emitter papers
    /// over their absence with fallbacks (`fontSizePx ?? 16`,
    /// `layoutBox ?? bbox`, `lineHeightPx ?? bbox.h / lineCount`, undefined
    /// `textAlign` behaving as `start`); the Rust IR model makes them
    /// required, so such a hand-written payload is rejected at
    /// deserialization instead. Engine-produced IRs are unaffected.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the IR or options JSON is invalid or a
    /// non-finite number reaches an attribute formatting site.
    pub fn emit_svg_from_ir(&self, ir_json: &str, options_json: &str) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let parsed_ir = parse_emit_ir(ir_json)?;
            let options = parse_render_svg_options(options_json)?;
            emit_prepared_ir(&parsed_ir, &options)
        }))
    }

    /// Resolve every text outline on a public-IR payload and return the
    /// resolved IR envelope. Used only by APIs whose caller consumes IR.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the IR/options JSON is invalid or outline
    /// materialization fails.
    pub fn resolve_ir(&self, ir_json: &str, options_json: &str) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let (parsed_ir, _) = resolve_emit_ir(ir_json, options_json, &self.registry)?;
            serde_json::to_string(&RenderToIrOutput {
                ir: &parsed_ir,
                warnings: &parsed_ir.warnings,
            })
            .map_err(|error| {
                JsValue::from_str(&format!("Failed to serialize resolved IR output: {error}"))
            })
        }))
    }

    /// Run the bounded PNG outline-request preflight on public IR.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the IR JSON is invalid.
    pub fn preflight_ir(&self, ir_json: &str) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let parsed_ir = parse_emit_ir(ir_json)?;
            serde_json::to_string(
                &svg_emit::outline_resolver::find_outline_glyph_limit_exceeded(
                    &parsed_ir.root,
                    PNG_MAX_OUTLINE_GLYPHS,
                ),
            )
            .map_err(|error| {
                JsValue::from_str(&format!("Failed to serialize IR preflight: {error}"))
            })
        }))
    }

    /// Parse one raster IR snapshot, run the outline glyph-limit preflight,
    /// and retain both IR and immutable outline/emit options for later stages.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the IR/options JSON is invalid, unsafe, or exceeds
    /// the raster outline request limit.
    pub fn preflight_raster_scene(
        &self,
        ir_json: &str,
        options_json: &str,
    ) -> Result<BoundSvgRasterScene, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let parsed_ir = parse_emit_ir(ir_json)?;
            let options = parse_render_svg_options(options_json)?;
            assert_png_outline_glyph_limit(&parsed_ir)?;
            Ok(BoundSvgRasterScene {
                ir: parsed_ir,
                options,
                owner: Arc::clone(&self.owner),
                resolved: false,
            })
        }))
    }

    /// Resolve outlines and emit from a preflighted raster scene without a
    /// second full-IR transfer.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the scene belongs to another engine, outline
    /// materialization fails, or SVG emission fails.
    pub fn resolve_and_emit_raster_scene(
        &self,
        scene: &mut BoundSvgRasterScene,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            assert_raster_scene_owner(scene, &self.owner)?;
            resolve_raster_scene_outlines(scene, &self.registry)?;
            emit_prepared_ir(&scene.ir, &scene.options)
        }))
    }

    /// Resolve and return the retained IR for layered consumers.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the scene belongs to another engine, outline
    /// materialization fails, or the resolved IR cannot be serialized.
    pub fn resolve_raster_scene_to_ir(
        &self,
        scene: &mut BoundSvgRasterScene,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            assert_raster_scene_owner(scene, &self.owner)?;
            resolve_raster_scene_outlines(scene, &self.registry)?;
            serde_json::to_string(&RenderToIrOutput {
                ir: &scene.ir,
                warnings: &scene.ir.warnings,
            })
            .map_err(|error| {
                JsValue::from_str(&format!("Failed to serialize resolved raster IR: {error}"))
            })
        }))
    }

    /// Resolve the retained IR in place for repeated frame sampling.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the scene belongs to another engine or outline
    /// materialization fails.
    pub fn resolve_raster_scene(&self, scene: &mut BoundSvgRasterScene) -> Result<(), JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            assert_raster_scene_owner(scene, &self.owner)?;
            resolve_raster_scene_outlines(scene, &self.registry)
        }))
    }

    /// Emit one sampled frame from a resolved raster scene.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the scene belongs to another engine, has not been
    /// resolved, the options JSON is invalid, or SVG emission fails.
    pub fn render_raster_scene_to_svg(
        &self,
        scene: &BoundSvgRasterScene,
        options_json: &str,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            assert_raster_scene_owner(scene, &self.owner)?;
            if !scene.resolved {
                return Err(render_error_envelope(
                    "RASTER_SCENE_NOT_RESOLVED",
                    "Raster scene must be resolved before frame emission",
                    Some("engine"),
                    None,
                ));
            }
            let options = parse_render_svg_options(options_json)?;
            emit_prepared_ir(&scene.ir, &options)
        }))
    }

    /// Resolve text outlines and emit SVG without returning the resolved IR.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the IR/options JSON is invalid, outline
    /// materialization fails, or SVG emission fails.
    pub fn resolve_and_emit_svg_from_ir(
        &self,
        ir_json: &str,
        options_json: &str,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let (parsed_ir, options) = resolve_emit_ir(ir_json, options_json, &self.registry)?;
            emit_prepared_ir(&parsed_ir, &options)
        }))
    }

    /// Sample per-node animation state (opacity / transform) at a given time.
    ///
    /// Additive read API for editors and inspectors: it neither changes the
    /// DTO shape nor the schema version. Only nodes with a node-level
    /// animation track are returned.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the IR JSON is invalid, the time is negative or
    /// non-finite, or an animation spec is malformed.
    pub fn sample_animation_state(&self, ir_json: &str, time_ms: f64) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let parsed_ir = parse_emit_ir(ir_json)?;
            let samples = ir::animation::sample_animation_state(&parsed_ir, time_ms)
                .map_err(|e| engine_error_to_render_envelope(&e))?;
            serde_json::to_string(&samples).map_err(|e| {
                JsValue::from_str(&format!("Failed to serialize animation state: {e}"))
            })
        }))
    }

    /// Parse and retain an outline-resolved public IR for repeated frame
    /// sampling. The returned scene is owned by this engine instance.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the IR JSON is invalid or contains unsafe nested
    /// SVG content.
    pub fn prepare_scene(
        &self,
        ir_json: &str,
        options_json: &str,
    ) -> Result<BoundSvgPreparedScene, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let (parsed_ir, _) = resolve_emit_ir(ir_json, options_json, &self.registry)?;
            Ok(BoundSvgPreparedScene {
                ir: parsed_ir,
                owner: Arc::clone(&self.owner),
            })
        }))
    }

    /// Sample and emit an SVG from a prepared scene owned by this engine.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` for cross-engine handles, invalid options, invalid
    /// animation samples, or SVG emission failures.
    pub fn render_prepared_to_svg(
        &self,
        prepared: &BoundSvgPreparedScene,
        options_json: &str,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            if !Arc::ptr_eq(&self.owner, &prepared.owner) {
                return Err(render_error_envelope(
                    "PREPARED_SCENE_WRONG_ENGINE",
                    "Prepared scene belongs to a different engine instance",
                    Some("engine"),
                    None,
                ));
            }
            let options = parse_render_svg_options(options_json)?;
            emit_prepared_ir(&prepared.ir, &options)
        }))
    }

    /// Layout text with per-line variable widths using the cursor-based flow API.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the input JSON is invalid, font is not found, or serialization fails.
    pub fn layout_text_flow(&self, json_input: &str) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let input: flow::TextFlowInput = serde_json::from_str(json_input)
                .map_err(|e| JsValue::from_str(&format!("Invalid flow input: {e}")))?;
            let result = flow::layout_text_flow(&input, &self.registry)
                .map_err(|e| JsValue::from_str(&e))?;
            serde_json::to_string(&result)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize flow result: {e}")))
        }))
    }

    /// Layout text flow with shape exclusions (geometry-aware flow layout).
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if input JSON is invalid, font is not found, or serialization fails.
    pub fn layout_text_flow_with_exclusions(&self, json_input: &str) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let input: flow::TextFlowWithExclusionsInput = serde_json::from_str(json_input)
                .map_err(|e| JsValue::from_str(&format!("Invalid exclusion flow input: {e}")))?;
            let flow_layout = flow::layout_text_flow_with_exclusions(&input, &self.registry)
                .map_err(|error| {
                    render_error_envelope(error.code(), &error.to_string(), Some("text"), None)
                })?;
            serde_json::to_string(&flow_layout).map_err(|e| {
                JsValue::from_str(&format!("Failed to serialize exclusion flow result: {e}"))
            })
        }))
    }

    /// Measure a text block and return line count, used width/height, etc.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if input JSON is invalid, font is not found, or serialization fails.
    pub fn measure_text_block(&self, json_input: &str) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let input: flow::MeasureTextBlockInput = serde_json::from_str(json_input)
                .map_err(|e| JsValue::from_str(&format!("Invalid measure input: {e}")))?;
            let result = flow::measure_text_block(&input, &self.registry)
                .map_err(|e| JsValue::from_str(&e))?;
            serde_json::to_string(&result)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize measure result: {e}")))
        }))
    }

    /// Find the minimum width preserving the current line count (shrinkwrap).
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if input JSON is invalid, font is not found, or serialization fails.
    pub fn shrinkwrap_text(&self, json_input: &str) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let input: flow::ShrinkwrapTextInput = serde_json::from_str(json_input)
                .map_err(|e| JsValue::from_str(&format!("Invalid shrinkwrap input: {e}")))?;
            let shrinkwrap = flow::shrinkwrap_text(&input, &self.registry).map_err(|error| {
                render_error_envelope(error.code(), &error.to_string(), Some("text"), None)
            })?;
            serde_json::to_string(&shrinkwrap).map_err(|e| {
                JsValue::from_str(&format!("Failed to serialize shrinkwrap result: {e}"))
            })
        }))
    }

    /// Shrinkwrap flow layout with exclusions: find minimum flow box size
    /// preserving line/column count.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if input JSON is invalid, font is not found, or serialization fails.
    pub fn shrinkwrap_flow(&self, json_input: &str) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let input: flow::ShrinkwrapFlowInput = serde_json::from_str(json_input)
                .map_err(|e| JsValue::from_str(&format!("Invalid shrinkwrap flow input: {e}")))?;
            let flow_shrinkwrap =
                flow::shrinkwrap_flow(&input, &self.registry).map_err(|error| {
                    render_error_envelope(error.code(), &error.to_string(), Some("text"), None)
                })?;
            serde_json::to_string(&flow_shrinkwrap).map_err(|e| {
                JsValue::from_str(&format!("Failed to serialize shrinkwrap flow result: {e}"))
            })
        }))
    }

    /// Measure intrinsic (min-content / max-content) inline sizes for text.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if input JSON is invalid, font is not found, or serialization fails.
    pub fn measure_intrinsic_inline_size(&self, json_input: &str) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let input: flow::IntrinsicInlineSizeInput =
                serde_json::from_str(json_input).map_err(|e| {
                    JsValue::from_str(&format!("Invalid intrinsic inline-size input: {e}"))
                })?;
            let result = flow::measure_intrinsic_inline_size(&input, &self.registry)
                .map_err(|e| JsValue::from_str(&e))?;
            serde_json::to_string(&result).map_err(|e| {
                JsValue::from_str(&format!(
                    "Failed to serialize intrinsic inline-size result: {e}"
                ))
            })
        }))
    }

    /// Shape text using a registered font from this instance's registry.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the font is not found or serialization fails.
    pub fn shape_text_registered(
        &self,
        alias: &str,
        weight: u16,
        style: &str,
        text: &str,
        font_size_px: f64,
        letter_spacing_px: f64,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let font_style = parse_font_style(style);
            let entry = self
                .registry
                .resolve(alias, weight, &font_style)
                .ok_or_else(|| {
                    JsValue::from_str(&format!(
                        "Font not found: alias={alias}, weight={weight}, style={style}"
                    ))
                })?;
            let glyphs = font::shaping::shape_text(
                &self.registry,
                entry,
                text,
                font_size_px,
                letter_spacing_px,
            );
            serde_json::to_string(&glyphs)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize: {e}")))
        }))
    }

    /// Shape text using this instance's registry with shaping options.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if options JSON is invalid, font is not found, or serialization fails.
    // WASM API: font shaping requires alias, weight, style, text, size, spacing, and options
    #[expect(
        clippy::too_many_arguments,
        reason = "wasm_bindgen requires flat parameter lists"
    )]
    pub fn shape_text_registered_with_options(
        &self,
        alias: &str,
        weight: u16,
        style: &str,
        text: &str,
        font_size_px: f64,
        letter_spacing_px: f64,
        options_json: &str,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let font_style = parse_font_style(style);
            let options: font::shaping::ShapeOptions = serde_json::from_str(options_json)
                .map_err(|e| JsValue::from_str(&format!("Invalid shape options JSON: {e}")))?;
            let entry = self
                .registry
                .resolve(alias, weight, &font_style)
                .ok_or_else(|| {
                    JsValue::from_str(&format!(
                        "Font not found: alias={alias}, weight={weight}, style={style}"
                    ))
                })?;
            let glyphs = font::shaping::shape_text_with_options(
                &self.registry,
                entry,
                text,
                font_size_px,
                letter_spacing_px,
                &options,
            );
            serde_json::to_string(&glyphs)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize: {e}")))
        }))
    }

    /// Shape text using fallback chain from this instance's registry.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if aliases JSON is invalid or serialization fails.
    pub fn shape_text_registered_with_fallback(
        &self,
        aliases_json: &str,
        weight: u16,
        style: &str,
        text: &str,
        font_size_px: f64,
        letter_spacing_px: f64,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let font_style = parse_font_style(style);
            let aliases = decode_alias_chain_json(aliases_json)?;
            let font_ctx = font::FontContext {
                registry: &self.registry,
                fallback_registry: None,
                families: &aliases,
                weight,
                style: &font_style,
            };
            let shaped = font::shaping::shape_with_fallback_and_options(
                &font_ctx,
                text,
                font_size_px,
                letter_spacing_px,
                &font::shaping::ShapeOptions::default(),
            );
            serde_json::to_string(&shaped.glyphs)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize: {e}")))
        }))
    }

    /// Shape text with fallback chain and shaping options from this instance's registry.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if aliases or options JSON is invalid, or serialization fails.
    // WASM API: fallback shaping requires aliases, weight, style, text, size, spacing, and options
    #[expect(
        clippy::too_many_arguments,
        reason = "wasm_bindgen requires flat parameter lists"
    )]
    pub fn shape_text_registered_with_fallback_with_options(
        &self,
        aliases_json: &str,
        weight: u16,
        style: &str,
        text: &str,
        font_size_px: f64,
        letter_spacing_px: f64,
        options_json: &str,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let font_style = parse_font_style(style);
            let aliases = decode_alias_chain_json(aliases_json)?;
            let options: font::shaping::ShapeOptions = serde_json::from_str(options_json)
                .map_err(|e| JsValue::from_str(&format!("Invalid shape options JSON: {e}")))?;
            let font_ctx = font::FontContext {
                registry: &self.registry,
                fallback_registry: None,
                families: &aliases,
                weight,
                style: &font_style,
            };
            let shaped = font::shaping::shape_with_fallback_and_options(
                &font_ctx,
                text,
                font_size_px,
                letter_spacing_px,
                &options,
            );
            serde_json::to_string(&shaped.glyphs)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize: {e}")))
        }))
    }

    /// Resolve the shared raster scale contract without parsing or emitting SVG.
    /// This internal boundary is used by cross-language conformance tests and
    /// independently exercises the same resolver as every raster encoder.
    ///
    /// # Errors
    ///
    /// Returns a structured `JsValue` for invalid scale/canvas inputs or a
    /// two-decimal output axis that cannot be represented above zero pixels.
    pub fn resolve_raster_scale(
        &self,
        width: f64,
        height: f64,
        requested_scale: f64,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let resolution = rasterize::resolve_png_scale(width, height, requested_scale)
                .map_err(raster_error_to_js_value)?;
            Ok(serde_json::json!({
                "appliedScale": resolution.applied_scale,
                "requestedWidth": resolution.requested_width,
                "requestedHeight": resolution.requested_height,
                "outputWidth": resolution.output_width,
                "outputHeight": resolution.output_height,
                "adjusted": resolution.adjusted,
            })
            .to_string())
        }))
    }

    /// Rasterize SVG string to PNG bytes using this instance's font registry.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if SVG parsing or PNG rasterization fails.
    pub fn svg_to_png(&self, svg_string: &str) -> Result<Vec<u8>, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let (alias_map, font_arcs) = self.registry.rasterize_font_data();
            self.renderer
                .svg_to_png(
                    svg_string,
                    &alias_map,
                    &font_arcs,
                    &rasterize::RasterizeOptions::default(),
                )
                .map_err(raster_error_to_js_value)
        }))
    }

    /// Rasterize SVG string to PNG bytes with options using this instance's font registry.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if options JSON is invalid or rasterization fails.
    pub fn svg_to_png_with_options(
        &self,
        svg_string: &str,
        options_json: &str,
    ) -> Result<Vec<u8>, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let options: rasterize::RasterizeOptions = serde_json::from_str(options_json)
                .map_err(|e| JsValue::from_str(&format!("Invalid rasterize options JSON: {e}")))?;
            let (alias_map, font_arcs) = self.registry.rasterize_font_data();
            self.renderer
                .svg_to_png(svg_string, &alias_map, &font_arcs, &options)
                .map_err(raster_error_to_js_value)
        }))
    }

    /// Rasterize SVG string to lossless WebP bytes with options using this instance's font registry.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if options JSON is invalid or rasterization fails.
    pub fn svg_to_webp_with_options(
        &self,
        svg_string: &str,
        options_json: &str,
    ) -> Result<Vec<u8>, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let options: rasterize::RasterizeOptions = serde_json::from_str(options_json)
                .map_err(|e| JsValue::from_str(&format!("Invalid rasterize options JSON: {e}")))?;
            let (alias_map, font_arcs) = self.registry.rasterize_font_data();
            self.renderer
                .svg_to_webp(svg_string, &alias_map, &font_arcs, &options)
                .map_err(raster_error_to_js_value)
        }))
    }

    /// Encode pre-sampled SVG frames into an animated lossless WebP.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the input JSON is invalid, or if rasterization or
    /// container assembly fails.
    pub fn svgs_to_animated_webp(&self, input_json: &str) -> Result<Vec<u8>, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let input: raster_anim::AnimationEncodeInput = serde_json::from_str(input_json)
                .map_err(|e| {
                    JsValue::from_str(&format!("Invalid animated WebP input JSON: {e}"))
                })?;
            let (alias_map, font_arcs) = self.registry.rasterize_font_data();
            webp_anim::encode_animated_webp(&input, &alias_map, &font_arcs)
                .map_err(raster_error_to_js_value)
        }))
    }

    /// Encode pre-sampled SVG frames into an animated GIF.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the input JSON is invalid, or if rasterization or
    /// GIF encoding fails.
    pub fn svgs_to_animated_gif(&self, input_json: &str) -> Result<Vec<u8>, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let input: raster_anim::AnimationEncodeInput = serde_json::from_str(input_json)
                .map_err(|e| JsValue::from_str(&format!("Invalid animated GIF input JSON: {e}")))?;
            let (alias_map, font_arcs) = self.registry.rasterize_font_data();
            gif_anim::encode_animated_gif(&input, &alias_map, &font_arcs)
                .map_err(raster_error_to_js_value)
        }))
    }

    /// Validate layered SVG composition by rasterizing single and layered outputs.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the input JSON is invalid, validation fails, or serialization fails.
    pub fn validate_layered_svg_composition(&self, input_json: &str) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let input: ValidateLayeredSvgCompositionInput = serde_json::from_str(input_json)
                .map_err(|e| {
                    JsValue::from_str(&format!(
                        "Invalid layered composition validation input: {e}"
                    ))
                })?;
            let (alias_map, font_arcs) = self.registry.rasterize_font_data();
            let options = input.options.unwrap_or_default();
            let metrics = rasterize::validate_layered_svg_composition(
                &input.single_svg,
                &input.layers,
                &alias_map,
                &font_arcs,
                &options,
            )
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
            serde_json::to_string(&metrics).map_err(|e| {
                JsValue::from_str(&format!(
                    "Failed to serialize layered composition validation result: {e}"
                ))
            })
        }))
    }

    /// Extract glyph outline paths using this instance's registry.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the font is not found or serialization fails.
    // WASM API: glyph path extraction requires alias, weight, style, text, size, baseline, and x
    #[expect(
        clippy::too_many_arguments,
        reason = "wasm_bindgen requires flat parameter lists"
    )]
    pub fn extract_glyph_paths(
        &self,
        alias: &str,
        weight: u16,
        style: &str,
        text: &str,
        font_size_px: f64,
        baseline_y: f64,
        start_x: f64,
        letter_spacing_px: f64,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let font_style = parse_font_style(style);
            let entry = self
                .registry
                .resolve(alias, weight, &font_style)
                .ok_or_else(|| {
                    JsValue::from_str(&format!(
                        "Font not found: alias={alias}, weight={weight}, style={style}"
                    ))
                })?;
            let glyphs = font::shaping::shape_text(
                &self.registry,
                entry,
                text,
                font_size_px,
                letter_spacing_px,
            );
            let positions: Vec<font::outline::GlyphPosition> = glyphs
                .iter()
                .map(|g| font::outline::GlyphPosition {
                    glyph_id: g.glyph_id,
                    x_advance: g.x_advance,
                    x_offset: g.x_offset,
                    y_offset: g.y_offset,
                })
                .collect();
            let paths = font::outline::extract_glyph_paths(
                self.registry.backend(),
                &entry.data,
                font_size_px,
                baseline_y,
                start_x,
                &positions,
                &[],
            );
            serde_json::to_string(&paths)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize glyph paths: {e}")))
        }))
    }

    /// Extract glyph outline paths with shaping options using this instance's registry.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if options JSON is invalid, font is not found, or serialization fails.
    // WASM API: glyph path extraction with options requires font params + layout params + options
    #[expect(
        clippy::too_many_arguments,
        reason = "wasm_bindgen requires flat parameter lists"
    )]
    pub fn extract_glyph_paths_with_options(
        &self,
        alias: &str,
        weight: u16,
        style: &str,
        text: &str,
        font_size_px: f64,
        baseline_y: f64,
        start_x: f64,
        letter_spacing_px: f64,
        options_json: &str,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let font_style = parse_font_style(style);
            let options: font::shaping::ShapeOptions = serde_json::from_str(options_json)
                .map_err(|e| JsValue::from_str(&format!("Invalid shape options JSON: {e}")))?;
            let entry = self
                .registry
                .resolve(alias, weight, &font_style)
                .ok_or_else(|| {
                    JsValue::from_str(&format!(
                        "Font not found: alias={alias}, weight={weight}, style={style}"
                    ))
                })?;
            let glyphs = font::shaping::shape_text_with_options(
                &self.registry,
                entry,
                text,
                font_size_px,
                letter_spacing_px,
                &options,
            );
            let is_vertical = options.writing_mode.as_deref() == Some("vertical-rl");
            let variations = font::shaping::to_shape_variations(&options.font_variation_settings);
            let positions = to_glyph_positions(&glyphs, is_vertical);
            let paths = font::outline::extract_glyph_paths(
                self.registry.backend(),
                &entry.data,
                font_size_px,
                baseline_y,
                start_x,
                &positions,
                &variations,
            );
            serde_json::to_string(&paths)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize glyph paths: {e}")))
        }))
    }

    /// Extract glyph outline paths with fallback chain using this instance's registry.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if aliases JSON is invalid, font is not found, or serialization fails.
    // WASM API: fallback glyph path extraction requires aliases, font params, and layout params
    #[expect(
        clippy::too_many_arguments,
        reason = "wasm_bindgen requires flat parameter lists"
    )]
    pub fn extract_glyph_paths_with_fallback(
        &self,
        aliases_json: &str,
        weight: u16,
        style: &str,
        text: &str,
        font_size_px: f64,
        baseline_y: f64,
        start_x: f64,
        letter_spacing_px: f64,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let font_style = parse_font_style(style);
            let aliases = decode_alias_chain_json(aliases_json)?;
            let options = font::shaping::ShapeOptions::default();
            let font_ctx = font::FontContext {
                registry: &self.registry,
                fallback_registry: None,
                families: &aliases,
                weight,
                style: &font_style,
            };
            let shaped = font::shaping::shape_with_fallback_and_options(
                &font_ctx,
                text,
                font_size_px,
                letter_spacing_px,
                &options,
            );
            let mut cursor_x = start_x;
            let mut paths: Vec<font::outline::GlyphPath> = Vec::new();
            for run in &shaped.runs {
                let entry =
                    self.registry
                        .resolve(&run.alias, weight, &font_style)
                        .ok_or_else(|| {
                            JsValue::from_str(&format!(
                                "Font not found while extracting fallback paths: alias={}, weight={weight}, style={style}",
                                run.alias
                            ))
                        })?;
                let positions = to_glyph_positions(&run.glyphs, false);
                let mut run_paths = font::outline::extract_glyph_paths(
                    self.registry.backend(),
                    &entry.data,
                    font_size_px,
                    baseline_y,
                    cursor_x,
                    &positions,
                    &[],
                );
                paths.append(&mut run_paths);
                cursor_x += run.glyphs.iter().map(|g| g.x_advance).sum::<f64>();
            }
            serde_json::to_string(&paths)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize glyph paths: {e}")))
        }))
    }

    /// Extract glyph outline paths with fallback chain and shaping options.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if aliases or options JSON is invalid, font is not found, or serialization fails.
    // WASM API: fallback glyph path extraction with options requires all font + layout + options
    #[expect(
        clippy::too_many_arguments,
        reason = "wasm_bindgen requires flat parameter lists"
    )]
    pub fn extract_glyph_paths_with_fallback_with_options(
        &self,
        aliases_json: &str,
        weight: u16,
        style: &str,
        text: &str,
        font_size_px: f64,
        baseline_y: f64,
        start_x: f64,
        letter_spacing_px: f64,
        options_json: &str,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let font_style = parse_font_style(style);
            let aliases = decode_alias_chain_json(aliases_json)?;
            let options: font::shaping::ShapeOptions = serde_json::from_str(options_json)
                .map_err(|e| JsValue::from_str(&format!("Invalid shape options JSON: {e}")))?;
            let is_vertical = options.writing_mode.as_deref() == Some("vertical-rl");
            let variations = font::shaping::to_shape_variations(&options.font_variation_settings);
            let font_ctx = font::FontContext {
                registry: &self.registry,
                fallback_registry: None,
                families: &aliases,
                weight,
                style: &font_style,
            };
            let shaped = font::shaping::shape_with_fallback_and_options(
                &font_ctx,
                text,
                font_size_px,
                letter_spacing_px,
                &options,
            );
            let mut cursor_x = start_x;
            let mut paths: Vec<font::outline::GlyphPath> = Vec::new();
            for run in &shaped.runs {
                let entry =
                    self.registry
                        .resolve(&run.alias, weight, &font_style)
                        .ok_or_else(|| {
                            JsValue::from_str(&format!(
                                "Font not found while extracting fallback paths: alias={}, weight={weight}, style={style}",
                                run.alias
                            ))
                        })?;
                let positions = to_glyph_positions(&run.glyphs, is_vertical);
                let mut run_paths = font::outline::extract_glyph_paths(
                    self.registry.backend(),
                    &entry.data,
                    font_size_px,
                    baseline_y,
                    cursor_x,
                    &positions,
                    &variations,
                );
                paths.append(&mut run_paths);
                if !is_vertical {
                    cursor_x += run.glyphs.iter().map(|g| g.x_advance).sum::<f64>();
                }
            }
            serde_json::to_string(&paths)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize glyph paths: {e}")))
        }))
    }

    /// Extract positioned glyph outline paths using already-shaped glyph data.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if the glyph JSON is invalid, font is not found, or serialization fails.
    pub fn extract_positioned_glyph_paths(&self, glyphs_json: &str) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let inputs: Vec<PositionedGlyphPathRequest> = serde_json::from_str(glyphs_json)
                .map_err(|e| JsValue::from_str(&format!("Invalid positioned glyph JSON: {e}")))?;
            let mut paths = Vec::with_capacity(inputs.len());

            for (request_index, input) in inputs.iter().enumerate() {
                let font_style = parse_font_style(&input.font_style);
                let entry = self
                    .registry
                    .resolve(&input.font_alias, input.font_weight, &font_style)
                    .ok_or_else(|| {
                        JsValue::from_str(&format!(
                            "Font not found: alias={}, weight={}, style={}",
                            input.font_alias, input.font_weight, input.font_style
                        ))
                    })?;

                let variations = input
                    .font_variation_settings
                    .as_deref()
                    .map(font::shaping::parse_css_font_variation_settings)
                    .map(|vs| font::shaping::to_shape_variations(&vs))
                    .unwrap_or_default();
                let face = self
                    .registry
                    .backend()
                    .create_face(&entry.data, &variations)
                    .map_err(|e| JsValue::from_str(&format!("Failed to parse font face: {e}")))?;

                let outline_input = font::outline::PositionedGlyphPathInput {
                    glyph_id: input.glyph_id,
                    font_size_px: input.font_size_px,
                    origin_x: input.origin_x,
                    origin_y: input.origin_y,
                    rotation_deg: input.rotation_deg,
                    baseline_rotation_deg: input.baseline_rotation_deg,
                    inline_scale: input.inline_scale,
                    writing_mode: input.writing_mode.clone(),
                    request_index,
                    show_missing_glyphs: input.show_missing_glyphs,
                };

                if let Some(path) =
                    font::outline::extract_positioned_glyph_path(face.as_ref(), &outline_input)
                        .map_err(|error| JsValue::from_str(&error.to_string()))?
                {
                    paths.push(path);
                }
            }

            serde_json::to_string(&paths).map_err(|e| {
                JsValue::from_str(&format!("Failed to serialize positioned glyph paths: {e}"))
            })
        }))
    }

    /// Shape text with variation axes using this instance's registry.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if variations JSON is invalid, font is not found, or serialization fails.
    // WASM API: variation shaping requires alias, weight, style, text, size, spacing, and axes
    #[expect(
        clippy::too_many_arguments,
        reason = "wasm_bindgen requires flat parameter lists"
    )]
    pub fn shape_text_with_variations(
        &self,
        alias: &str,
        weight: u16,
        style: &str,
        text: &str,
        font_size_px: f64,
        letter_spacing_px: f64,
        variations_json: &str,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let font_style = parse_font_style(style);
            let variations: Vec<font::shaping::VariationSetting> =
                serde_json::from_str(variations_json)
                    .map_err(|e| JsValue::from_str(&format!("Invalid variations JSON: {e}")))?;
            let entry = self
                .registry
                .resolve(alias, weight, &font_style)
                .ok_or_else(|| {
                    JsValue::from_str(&format!(
                        "Font not found: alias={alias}, weight={weight}, style={style}"
                    ))
                })?;
            let options = font::shaping::ShapeOptions {
                font_variation_settings: variations,
                ..font::shaping::ShapeOptions::default()
            };
            let glyphs = font::shaping::shape_text_with_options(
                &self.registry,
                entry,
                text,
                font_size_px,
                letter_spacing_px,
                &options,
            );
            serde_json::to_string(&glyphs)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize: {e}")))
        }))
    }

    /// Shape text with variation axes + shaping options using this instance's registry.
    ///
    /// # Errors
    ///
    /// Returns `JsValue` if variations or options JSON is invalid, font is not found, or serialization fails.
    // WASM API: variation shaping with options requires all font + variation + option params
    #[expect(
        clippy::too_many_arguments,
        reason = "wasm_bindgen requires flat parameter lists"
    )]
    pub fn shape_text_with_variations_with_options(
        &self,
        alias: &str,
        weight: u16,
        style: &str,
        text: &str,
        font_size_px: f64,
        letter_spacing_px: f64,
        variations_json: &str,
        options_json: &str,
    ) -> Result<String, JsValue> {
        catch_unwind_to_js(AssertUnwindSafe(|| {
            let font_style = parse_font_style(style);
            let variations: Vec<font::shaping::VariationSetting> =
                serde_json::from_str(variations_json)
                    .map_err(|e| JsValue::from_str(&format!("Invalid variations JSON: {e}")))?;
            let mut options: font::shaping::ShapeOptions = serde_json::from_str(options_json)
                .map_err(|e| JsValue::from_str(&format!("Invalid shape options JSON: {e}")))?;
            options.font_variation_settings = variations;
            let entry = self
                .registry
                .resolve(alias, weight, &font_style)
                .ok_or_else(|| {
                    JsValue::from_str(&format!(
                        "Font not found: alias={alias}, weight={weight}, style={style}"
                    ))
                })?;
            let glyphs = font::shaping::shape_text_with_options(
                &self.registry,
                entry,
                text,
                font_size_px,
                letter_spacing_px,
                &options,
            );
            serde_json::to_string(&glyphs)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize: {e}")))
        }))
    }
}

/// Format a caught panic payload into a stable, user-facing message.
fn panic_payload_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        format!("WASM panic: {s}")
    } else if let Some(s) = payload.downcast_ref::<String>() {
        format!("WASM panic: {s}")
    } else {
        "WASM panic: unknown error".to_string()
    }
}

/// Wrap a closure with `catch_unwind`, converting panics to `JsValue` errors.
///
/// Release builds use `panic = "unwind"`; without this guard a panic escaping a
/// `#[wasm_bindgen]` export traps the WASM instance and every later call fails.
/// `AssertUnwindSafe` at the call sites is sound: WASM is single-threaded and the
/// only cross-call state is the append-only `FontRegistry`, so a caught panic
/// cannot leave state that breaks subsequent calls.
fn catch_unwind_to_js<F, T>(f: F) -> Result<T, JsValue>
where
    F: FnOnce() -> Result<T, JsValue> + std::panic::UnwindSafe,
{
    std::panic::catch_unwind(f)
        .unwrap_or_else(|panic_info| Err(JsValue::from_str(&panic_payload_message(&*panic_info))))
}

fn parse_font_style(style_str: &str) -> FontStyle {
    match style_str {
        "italic" => FontStyle::Italic,
        _ => FontStyle::Normal,
    }
}

fn decode_alias_chain_json(aliases_json: &str) -> Result<Vec<String>, JsValue> {
    let aliases: Vec<String> = serde_json::from_str(aliases_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid aliases JSON: {e}")))?;
    let mut normalized: Vec<String> = Vec::new();
    for alias in aliases {
        let trimmed = alias.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !normalized.iter().any(|v| v == trimmed) {
            normalized.push(trimmed.to_string());
        }
    }
    if normalized.is_empty() {
        return Err(JsValue::from_str(
            "aliases_json must contain at least one alias",
        ));
    }
    Ok(normalized)
}

fn to_glyph_positions(
    glyphs: &[font::shaping::GlyphInfo],
    is_vertical: bool,
) -> Vec<font::outline::GlyphPosition> {
    glyphs
        .iter()
        .map(|g| font::outline::GlyphPosition {
            glyph_id: g.glyph_id,
            x_advance: if is_vertical { 0.0 } else { g.x_advance },
            x_offset: if is_vertical { 0.0 } else { g.x_offset },
            y_offset: if is_vertical { 0.0 } else { g.y_offset },
        })
        .collect()
}

/// Get font metrics (ascender, descender, unitsPerEm) as JSON.
///
/// # Errors
///
/// Returns `JsValue` if WOFF2 decoding or font parsing fails.
#[wasm_bindgen]
pub fn get_font_metrics(font_data: &[u8]) -> Result<String, JsValue> {
    let font_data = font_data.to_vec();
    catch_unwind_to_js(AssertUnwindSafe(move || {
        let decoded =
            font::decode::decode_font(font_data).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let entry = font::FontEntry::new(decoded, "tmp".into(), 400, FontStyle::Normal)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let metrics = serde_json::json!({
            "unitsPerEm": entry.units_per_em,
            "ascender": entry.ascender,
            "descender": entry.descender,
        });
        Ok(metrics.to_string())
    }))
}

/// Shape text and return glyph info as JSON.
///
/// # Errors
///
/// Returns `JsValue` if WOFF2 decoding, font parsing, or serialization fails.
#[wasm_bindgen]
pub fn shape_text(
    font_data: &[u8],
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
) -> Result<String, JsValue> {
    let font_data = font_data.to_vec();
    let text = text.to_string();
    catch_unwind_to_js(AssertUnwindSafe(move || {
        let decoded =
            font::decode::decode_font(font_data).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let entry = font::FontEntry::new(decoded, "tmp".into(), 400, FontStyle::Normal)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let registry = font::FontRegistry::new();
        let glyphs =
            font::shaping::shape_text(&registry, &entry, &text, font_size_px, letter_spacing_px);
        serde_json::to_string(&glyphs)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize: {e}")))
    }))
}

/// Split text into grapheme clusters (simple code-point based)
///
/// # Errors
///
/// Returns `JsValue` if a panic occurs during splitting (converted by the panic guard).
#[wasm_bindgen]
pub fn grapheme_split(text: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let clusters = text::grapheme::grapheme_split(text);
        Ok(serde_json::to_string(&clusters).unwrap_or_else(|_| "[]".to_string()))
    }))
}

/// Extract external image href values from an SVG string.
/// Returns JSON array of non-data-URI hrefs found in `<image>` elements.
/// Used by the TS side to resolve relative/external URLs before rendering.
///
/// # Errors
///
/// Returns `JsValue` if SVG parsing or JSON serialization fails.
#[wasm_bindgen]
pub fn extract_image_hrefs(svg_string: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let hrefs =
            image_url::extract_image_hrefs(svg_string).map_err(|e| JsValue::from_str(&e))?;
        serde_json::to_string(&hrefs)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize image hrefs: {e}")))
    }))
}

/// Extract image hrefs rejected by the external-image safety policy.
/// Returns a JSON array of decoded, deduplicated href values.
///
/// # Errors
///
/// Returns `JsValue` if SVG parsing or JSON serialization fails.
#[wasm_bindgen]
pub fn extract_skipped_image_hrefs(svg_string: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let hrefs = image_url::extract_skipped_image_hrefs(svg_string)
            .map_err(|e| JsValue::from_str(&e))?;
        serde_json::to_string(&hrefs).map_err(|e| {
            JsValue::from_str(&format!("Failed to serialize skipped image hrefs: {e}"))
        })
    }))
}

/// Replace safe `<image>` hrefs according to a JSON string map.
///
/// # Errors
///
/// Returns `JsValue` if the replacement JSON or SVG is invalid.
#[wasm_bindgen]
pub fn replace_image_hrefs(svg_string: &str, replacements_json: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let replacements: std::collections::HashMap<String, String> =
            serde_json::from_str(replacements_json).map_err(|e| {
                JsValue::from_str(&format!("Failed to parse image href replacements: {e}"))
            })?;
        image_url::replace_image_hrefs(svg_string, &replacements).map_err(|e| JsValue::from_str(&e))
    }))
}

/// Get UAX#14 line break opportunities for text.
/// Returns JSON array of byte offsets where line breaks are allowed.
///
/// # Errors
///
/// Returns `JsValue` if a panic occurs during analysis (converted by the panic guard).
#[wasm_bindgen]
pub fn uax14_line_breaks(text: &str) -> Result<String, JsValue> {
    catch_unwind_to_js(AssertUnwindSafe(|| {
        let offsets = text::linebreak::uax14_break_opportunities(text);
        Ok(serde_json::to_string(&offsets).unwrap_or_else(|_| "[]".to_string()))
    }))
}

// `JsValue` cannot be constructed on native targets, so the guard is tested via
// `catch_unwind` + the payload formatter instead of `catch_unwind_to_js` itself.
#[cfg(test)]
mod tests {
    use super::{
        BoundSvgEngine, panic_payload_message, pipeline_phase_trace,
        validate_layout_text_decoration_wire_values,
    };

    fn phase_trace_transition_state(slot_height: u32) -> String {
        serde_json::json!({
            "root": {
                "nodeId": "scene",
                "nodeType": "canvas",
                "authoredId": true,
                "style": {
                    "flexDirection": "column",
                    "alignItems": "stretch",
                    "justifyContent": "flex-start",
                    "width": 200,
                    "height": 140
                },
                "children": [{
                    "nodeId": "slot",
                    "nodeType": "box",
                    "authoredId": true,
                    "style": {
                        "flexDirection": "column",
                        "alignItems": "stretch",
                        "justifyContent": "flex-start",
                        "width": 180,
                        "height": slot_height
                    },
                    "children": [],
                    "visual": { "background": "#112233" }
                }, {
                    "nodeId": "copy",
                    "nodeType": "text",
                    "authoredId": true,
                    "style": {
                        "flexDirection": "column",
                        "alignItems": "stretch",
                        "justifyContent": "flex-start",
                        "width": 180
                    },
                    "children": [],
                    "text": {
                        "content": "phase trace",
                        "fontSizePx": 16,
                        "lineHeightPx": 24,
                        "fontFamily": ["NotoSansJP"],
                        "fontWeight": 400,
                        "fontStyle": "normal",
                        "wrap": "word"
                    },
                    "visual": { "color": "#000000" }
                }],
                "visual": { "background": "#ffffff" }
            },
            "fonts": []
        })
        .to_string()
    }

    fn phase_trace_engine() -> BoundSvgEngine {
        let font_data = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("fixture font should exist");
        let decoded = crate::font::decode::decode_font(font_data).expect("font should decode");
        let mut engine = BoundSvgEngine::create();
        engine
            .registry_mut()
            .register(
                decoded,
                "NotoSansJP".to_string(),
                400,
                crate::font::FontStyle::Normal,
            )
            .expect("font should register");
        engine
    }

    #[test]
    fn str_panic_payload_formats_as_error_message() {
        let payload = std::panic::catch_unwind(|| panic!("boom")).unwrap_err();
        assert_eq!(panic_payload_message(&*payload), "WASM panic: boom");
    }

    #[test]
    fn string_panic_payload_formats_as_error_message() {
        let payload = std::panic::catch_unwind(|| panic!("boom: {}", 42)).unwrap_err();
        assert_eq!(panic_payload_message(&*payload), "WASM panic: boom: 42");
    }

    #[test]
    fn decoration_wire_preflight_accepts_ts_color_formats_and_ignores_metadata() {
        let input = serde_json::json!({
            "nodeId": "text",
            "text": {
                "spans": [{
                    "textDecoration": {
                        "line": ["underline"],
                        "color": "hsl(200,100%,50%)"
                    }
                }]
            },
            "visual": { "meta": { "textDecoration": "metadata" } },
            "children": []
        });
        validate_layout_text_decoration_wire_values(&input).expect("valid decoration wire input");
    }

    #[test]
    fn decoration_wire_preflight_accepts_every_pattern_style() {
        for style in ["solid", "double", "dotted", "dashed", "wavy"] {
            let input = serde_json::json!({
                "nodeId": "text",
                "text": {
                    "spans": [{
                        "textDecoration": {
                            "line": ["underline"],
                            "color": "#112233",
                            "style": style
                        }
                    }]
                },
                "children": []
            });
            validate_layout_text_decoration_wire_values(&input)
                .expect("pattern style should pass wire preflight");
        }
    }

    #[test]
    fn decoration_wire_preflight_accepts_skip_ink_and_rejects_line_through_only_all() {
        let valid = serde_json::json!({
            "nodeId": "text",
            "text": {
                "spans": [{
                    "textDecoration": {
                        "line": ["underline", "line-through"],
                        "color": "#112233",
                        "skipInk": "all"
                    }
                }]
            },
            "children": []
        });
        validate_layout_text_decoration_wire_values(&valid).expect("skip ink wire input");

        let unsupported = serde_json::json!({
            "nodeId": "text",
            "text": {
                "spans": [{
                    "textDecoration": {
                        "line": ["line-through"],
                        "color": "#112233",
                        "skipInk": "all"
                    }
                }]
            },
            "children": []
        });
        let error = validate_layout_text_decoration_wire_values(&unsupported)
            .expect_err("line-through-only skip ink");
        assert!(matches!(
            error,
            crate::error::EngineError::Structured { ref code, .. }
                if code == "TEXT_DECORATION_SKIP_INK_UNSUPPORTED"
        ));
    }

    #[test]
    fn decoration_wire_preflight_returns_the_stable_code_before_serde() {
        let input = serde_json::json!({
            "nodeId": "text",
            "text": {
                "spans": [{
                    "textDecoration": {
                        "line": ["underline"],
                        "color": "#112233",
                        "style": "zigzag"
                    }
                }]
            },
            "children": []
        });
        let error = validate_layout_text_decoration_wire_values(&input)
            .expect_err("invalid decoration should be rejected");
        assert!(matches!(
            error,
            crate::error::EngineError::Structured {
                ref code,
                ref node_id,
                ..
            } if code == "TEXT_DECORATION_INVALID" && node_id.as_deref() == Some("text")
        ));
    }

    #[test]
    fn transition_compile_options_reject_render_only_sampling_controls() {
        let error = serde_json::from_str::<super::LayoutTransitionCompileOptionsInput>(
            r#"{"sampleAnimation":false}"#,
        )
        .expect_err("transition options must not silently override caller sampling controls");

        assert!(
            error
                .to_string()
                .contains("unknown field `sampleAnimation`")
        );
    }

    #[test]
    fn transition_compile_runs_real_pipeline_phases_once_per_state() {
        let engine = phase_trace_engine();
        let reference_input = phase_trace_transition_state(24);
        let target_input = phase_trace_transition_state(48);
        let compile_options = r#"{"sampleAnimation":false}"#;

        let standalone_shape_calls = [&reference_input, &target_input].map(|input| {
            pipeline_phase_trace::reset();
            boundtext::phase_trace::reset_backend_shape_calls();
            engine
                .render_to_ir(input, compile_options)
                .expect("standalone state should compile");
            let phase_counts = pipeline_phase_trace::snapshot();
            assert_eq!(phase_counts.layout_input_parses, 1);
            assert_eq!(phase_counts.layout_runs, 1);
            assert_eq!(phase_counts.animated_outline_resolves, 1);
            assert_eq!(phase_counts.emit_ir_parses, 0);
            assert_eq!(phase_counts.full_outline_resolves, 0);
            let shape_calls = boundtext::phase_trace::current_backend_shape_calls();
            assert!(shape_calls > 0, "fixture must execute real backend shaping");
            shape_calls
        });

        pipeline_phase_trace::reset();
        boundtext::phase_trace::reset_backend_shape_calls();
        let transition_json = engine
            .compile_layout_transition(
                &reference_input,
                &target_input,
                r#"{"checkpoints":[{"timeMs":0,"stateIndex":0},{"timeMs":300,"stateIndex":1},{"timeMs":700,"stateIndex":1},{"timeMs":1000,"stateIndex":0}],"easing":"ease-in-out"}"#,
                "{}",
            )
            .expect("transition should compile");
        let compile_phase_counts = pipeline_phase_trace::snapshot();
        let transition_shape_calls = boundtext::phase_trace::current_backend_shape_calls();
        assert_eq!(compile_phase_counts.layout_input_parses, 2);
        assert_eq!(compile_phase_counts.layout_runs, 2);
        assert_eq!(compile_phase_counts.animated_outline_resolves, 2);
        assert_eq!(compile_phase_counts.emit_ir_parses, 0);
        assert_eq!(compile_phase_counts.full_outline_resolves, 0);
        assert_eq!(
            transition_shape_calls,
            standalone_shape_calls.iter().sum::<usize>()
        );

        let transition_envelope: serde_json::Value =
            serde_json::from_str(&transition_json).expect("transition envelope should deserialize");
        assert_eq!(transition_envelope["ir"]["root"]["nodeId"], "scene");
    }
}
