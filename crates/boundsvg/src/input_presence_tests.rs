//! Runtime coverage for the remaining export-local input objects.

use crate::wire::test_support::{NumericWireType, assert_numeric_field};
use serde_json::json;

use super::{
    CompileShapeSvgInput, HitTestShapePartsInput, LayoutTransitionCompileOptionsInput,
    PositionedGlyphPathRequest, RenderShapeRegionSvgInput, ValidateLayeredSvgCompositionInput,
};
use crate::raster_anim::AnimationEncodeInput;
use crate::rasterize::{FontFamilyConfig, RasterizeOptions};
use crate::wire::test_support::assert_optional_field;

#[test]
fn animation_encode_input_preserves_optional_presence() {
    let fixture = json!({"frames": [{"svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"/>", "durationMs": 100}], "iterations": 1, "options": {}});
    assert_optional_field::<AnimationEncodeInput>(&fixture, "options", |input| {
        input.options.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<AnimationEncodeInput>(unknown).is_err());
}

#[test]
fn compile_shape_svg_input_preserves_optional_presence() {
    let fixture = json!({"geometry": {"viewBox": {"x": 0, "y": 0, "width": 10, "height": 10}, "root": {"kind": "path", "d": "M0 0 L10 0 L10 10 Z"}}, "paint": {"fill": "#000000"}, "viewport": {"width": 10, "height": 10}});
    assert_optional_field::<CompileShapeSvgInput>(&fixture, "paint", |input| input.paint.is_none());
    assert_optional_field::<CompileShapeSvgInput>(&fixture, "viewport", |input| {
        input.viewport.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<CompileShapeSvgInput>(unknown).is_ok());
}

#[test]
fn font_family_config_preserves_optional_presence() {
    let fixture = json!({"serif": "Fixture", "sansSerif": "Fixture", "cursive": "Fixture", "fantasy": "Fixture", "monospace": "Fixture"});
    assert_optional_field::<FontFamilyConfig>(&fixture, "serif", |input| input.serif.is_none());
    assert_optional_field::<FontFamilyConfig>(&fixture, "sansSerif", |input| {
        input.sans_serif.is_none()
    });
    assert_optional_field::<FontFamilyConfig>(&fixture, "cursive", |input| input.cursive.is_none());
    assert_optional_field::<FontFamilyConfig>(&fixture, "fantasy", |input| input.fantasy.is_none());
    assert_optional_field::<FontFamilyConfig>(&fixture, "monospace", |input| {
        input.monospace.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<FontFamilyConfig>(unknown).is_ok());
}

#[test]
fn hit_test_shape_parts_input_preserves_optional_presence() {
    let fixture = json!({"geometry": {"viewBox": {"x": 0, "y": 0, "width": 10, "height": 10}, "root": {"kind": "path", "d": "M0 0 L10 0 L10 10 Z"}}, "point": {"x": 1, "y": 1}, "options": {}});
    assert_optional_field::<HitTestShapePartsInput>(&fixture, "options", |input| {
        input.options.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<HitTestShapePartsInput>(unknown).is_ok());
}

#[test]
fn layout_transition_compile_options_input_preserves_optional_presence() {
    let fixture = json!({"textPathMode": "merged"});
    assert_optional_field::<LayoutTransitionCompileOptionsInput>(
        &fixture,
        "textPathMode",
        |input| input.text_path_mode.is_none(),
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<LayoutTransitionCompileOptionsInput>(unknown).is_err());
}

#[test]
fn positioned_glyph_path_request_preserves_optional_presence() {
    let fixture = json!({"glyphId": 1, "fontSizePx": 16, "originX": 0, "originY": 0, "rotationDeg": 0, "writingMode": "horizontal-tb", "fontAlias": "Fixture", "fontWeight": 400, "fontStyle": "normal", "baselineRotationDeg": 0, "inlineScale": 1, "fontVariationSettings": "normal"});
    assert_optional_field::<PositionedGlyphPathRequest>(&fixture, "baselineRotationDeg", |input| {
        input.baseline_rotation_deg.is_none()
    });
    assert_numeric_field::<PositionedGlyphPathRequest>(
        &fixture,
        "baselineRotationDeg",
        NumericWireType::Float64,
    );
    assert_optional_field::<PositionedGlyphPathRequest>(&fixture, "inlineScale", |input| {
        input.inline_scale.is_none()
    });
    assert_numeric_field::<PositionedGlyphPathRequest>(
        &fixture,
        "inlineScale",
        NumericWireType::Float64,
    );
    assert_optional_field::<PositionedGlyphPathRequest>(
        &fixture,
        "fontVariationSettings",
        |input| input.font_variation_settings.is_none(),
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<PositionedGlyphPathRequest>(unknown).is_ok());
}

#[test]
fn rasterize_options_preserves_optional_presence() {
    let fixture = json!({"background": "#ffffff", "scale": 1, "oversizeBehavior": "autoAdjust", "fontFamilies": {"serif": "Fixture"}, "generator": {"name": "example", "version": "1.0.0"}});
    assert_optional_field::<RasterizeOptions>(&fixture, "background", |input| {
        input.background.is_none()
    });
    assert_optional_field::<RasterizeOptions>(&fixture, "scale", |input| input.scale.is_none());
    assert_numeric_field::<RasterizeOptions>(&fixture, "scale", NumericWireType::Float64);
    assert_optional_field::<RasterizeOptions>(&fixture, "oversizeBehavior", |input| {
        input.oversize_behavior.is_none()
    });
    assert_optional_field::<RasterizeOptions>(&fixture, "fontFamilies", |input| {
        input.font_families.is_none()
    });
    assert_optional_field::<RasterizeOptions>(&fixture, "generator", |input| {
        input.generator.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<RasterizeOptions>(unknown).is_ok());
}

#[test]
fn render_shape_region_svg_input_preserves_optional_presence() {
    let fixture = json!({"region": {"contours": []}, "paint": {"fill": "#000000"}, "viewport": {"width": 10, "height": 10}});
    assert_optional_field::<RenderShapeRegionSvgInput>(&fixture, "paint", |input| {
        input.paint.is_none()
    });
    assert_optional_field::<RenderShapeRegionSvgInput>(&fixture, "viewport", |input| {
        input.viewport.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<RenderShapeRegionSvgInput>(unknown).is_ok());
}

#[test]
fn validate_layered_svg_composition_input_preserves_optional_presence() {
    let fixture = json!({"singleSvg": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"/>", "layers": [], "options": {}});
    assert_optional_field::<ValidateLayeredSvgCompositionInput>(&fixture, "options", |input| {
        input.options.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<ValidateLayeredSvgCompositionInput>(unknown).is_ok());
}

#[test]
fn emit_ir_debug_preserves_presence() {
    let fixture = json!({
        "root": {
            "nodeId": "root", "type": "group",
            "bbox": {"x": 0, "y": 0, "w": 100, "h": 80}, "children": []
        },
        "width": 100, "height": 80, "debug": false
    });
    assert_optional_field::<super::EmitIrInput>(&fixture, "debug", |input| input.debug.is_none());
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<super::EmitIrInput>(unknown).is_ok());
}
