//! Real flow-input presence fixtures; numeric and shaping semantics stay with their adapters.

use crate::wire::test_support::{NumericWireType, assert_numeric_field};
use serde_json::json;

use super::types::{
    FlowTextSpanDto, IntrinsicInlineSizeInput, MeasureTextBlockInput, ShrinkwrapFlowInput,
    ShrinkwrapTextInput, TextFlowInput, TextFlowWithExclusionsInput,
};
use crate::wire::test_support::assert_optional_field;

#[test]
fn flow_text_span_dto_preserves_optional_presence() {
    let fixture = json!({"text": "漢字", "fontFamily": "Fixture", "fallback": [], "fontWeight": 400, "fontStyle": "normal", "fontSizePx": 16, "letterSpacingPx": 0, "color": "#000000", "fontVariationSettings": "normal", "fontFeatureSettings": "normal", "rubyText": "かん", "rubyPosition": "over", "rubyAlign": "center", "rubyFontSizePx": 8, "rubyColor": "#000000"});
    assert_optional_field::<FlowTextSpanDto>(&fixture, "fontFamily", |input| {
        input.font_family.is_none()
    });
    assert_optional_field::<FlowTextSpanDto>(&fixture, "fallback", |input| {
        input.fallback.is_none()
    });
    assert_optional_field::<FlowTextSpanDto>(&fixture, "fontWeight", |input| {
        input.font_weight.is_none()
    });
    assert_numeric_field::<FlowTextSpanDto>(&fixture, "fontWeight", NumericWireType::Unsigned16);
    assert_optional_field::<FlowTextSpanDto>(&fixture, "fontStyle", |input| {
        input.font_style.is_none()
    });
    assert_optional_field::<FlowTextSpanDto>(&fixture, "fontSizePx", |input| {
        input.font_size_px.is_none()
    });
    assert_numeric_field::<FlowTextSpanDto>(&fixture, "fontSizePx", NumericWireType::Float64);
    assert_optional_field::<FlowTextSpanDto>(&fixture, "letterSpacingPx", |input| {
        input.letter_spacing_px.is_none()
    });
    assert_numeric_field::<FlowTextSpanDto>(&fixture, "letterSpacingPx", NumericWireType::Float64);
    assert_optional_field::<FlowTextSpanDto>(&fixture, "color", |input| input.color.is_none());
    assert_optional_field::<FlowTextSpanDto>(&fixture, "fontVariationSettings", |input| {
        input.font_variation_settings.is_none()
    });
    assert_optional_field::<FlowTextSpanDto>(&fixture, "fontFeatureSettings", |input| {
        input.font_feature_settings.is_none()
    });
    assert_optional_field::<FlowTextSpanDto>(&fixture, "rubyText", |input| {
        input.ruby_text.is_none()
    });
    assert_optional_field::<FlowTextSpanDto>(&fixture, "rubyPosition", |input| {
        input.ruby_position.is_none()
    });
    assert_optional_field::<FlowTextSpanDto>(&fixture, "rubyAlign", |input| {
        input.ruby_align.is_none()
    });
    assert_optional_field::<FlowTextSpanDto>(&fixture, "rubyFontSizePx", |input| {
        input.ruby_font_size_px.is_none()
    });
    assert_numeric_field::<FlowTextSpanDto>(&fixture, "rubyFontSizePx", NumericWireType::Float64);
    assert_optional_field::<FlowTextSpanDto>(&fixture, "rubyColor", |input| {
        input.ruby_color.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<FlowTextSpanDto>(unknown).is_ok());
}

#[test]
fn intrinsic_inline_size_input_preserves_optional_presence() {
    let fixture = json!({"text": "漢字", "fontFamily": "Fixture", "fontSizePx": 16, "fallback": [], "fontWeight": 400, "fontStyle": "normal", "lineHeight": 1.2, "lineHeightPx": 20, "letterSpacingPx": 0, "textIndent": 0, "language": "ja", "richText": [], "writingMode": "horizontal-tb", "textOrientation": "mixed", "whiteSpace": "normal", "tabSize": 4, "fontVariationSettings": "normal", "fontFeatureSettings": "normal"});
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "fallback", |input| {
        input.fallback.is_none()
    });
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "fontWeight", |input| {
        input.font_weight.is_none()
    });
    assert_numeric_field::<IntrinsicInlineSizeInput>(
        &fixture,
        "fontWeight",
        NumericWireType::Unsigned16,
    );
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "fontStyle", |input| {
        input.font_style.is_none()
    });
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "lineHeight", |input| {
        input.line_height.is_none()
    });
    assert_numeric_field::<IntrinsicInlineSizeInput>(
        &fixture,
        "lineHeight",
        NumericWireType::Float64,
    );
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "lineHeightPx", |input| {
        input.line_height_px.is_none()
    });
    assert_numeric_field::<IntrinsicInlineSizeInput>(
        &fixture,
        "lineHeightPx",
        NumericWireType::Float64,
    );
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "letterSpacingPx", |input| {
        input.letter_spacing_px.is_none()
    });
    assert_numeric_field::<IntrinsicInlineSizeInput>(
        &fixture,
        "letterSpacingPx",
        NumericWireType::Float64,
    );
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "textIndent", |input| {
        input.text_indent.is_none()
    });
    assert_numeric_field::<IntrinsicInlineSizeInput>(
        &fixture,
        "textIndent",
        NumericWireType::Float64,
    );
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "language", |input| {
        input.language.is_none()
    });
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "richText", |input| {
        input.rich_text.is_none()
    });
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "writingMode", |input| {
        input.writing_mode.is_none()
    });
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "textOrientation", |input| {
        input.text_orientation.is_none()
    });
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "whiteSpace", |input| {
        input.white_space.is_none()
    });
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "tabSize", |input| {
        input.tab_size.is_none()
    });
    assert_numeric_field::<IntrinsicInlineSizeInput>(
        &fixture,
        "tabSize",
        NumericWireType::Unsigned32,
    );
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "fontVariationSettings", |input| {
        input.font_variation_settings.is_none()
    });
    assert_optional_field::<IntrinsicInlineSizeInput>(&fixture, "fontFeatureSettings", |input| {
        input.font_feature_settings.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<IntrinsicInlineSizeInput>(unknown).is_ok());
}

#[test]
fn measure_text_block_input_preserves_optional_presence() {
    let fixture = json!({"text": "漢字", "fontFamily": "Fixture", "fontSizePx": 16, "fallback": [], "fontWeight": 400, "fontStyle": "normal", "lineHeight": 1.2, "lineHeightPx": 20, "letterSpacingPx": 0, "textIndent": 0, "language": "ja", "wrap": "char", "hangingPunctuation": false, "maxWidth": 100, "maxHeight": 100, "writingMode": "horizontal-tb", "textOrientation": "mixed", "whiteSpace": "normal", "tabSize": 4, "fontVariationSettings": "normal", "fontFeatureSettings": "normal"});
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "fallback", |input| {
        input.fallback.is_none()
    });
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "fontWeight", |input| {
        input.font_weight.is_none()
    });
    assert_numeric_field::<MeasureTextBlockInput>(
        &fixture,
        "fontWeight",
        NumericWireType::Unsigned16,
    );
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "fontStyle", |input| {
        input.font_style.is_none()
    });
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "lineHeight", |input| {
        input.line_height.is_none()
    });
    assert_numeric_field::<MeasureTextBlockInput>(&fixture, "lineHeight", NumericWireType::Float64);
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "lineHeightPx", |input| {
        input.line_height_px.is_none()
    });
    assert_numeric_field::<MeasureTextBlockInput>(
        &fixture,
        "lineHeightPx",
        NumericWireType::Float64,
    );
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "letterSpacingPx", |input| {
        input.letter_spacing_px.is_none()
    });
    assert_numeric_field::<MeasureTextBlockInput>(
        &fixture,
        "letterSpacingPx",
        NumericWireType::Float64,
    );
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "textIndent", |input| {
        input.text_indent.is_none()
    });
    assert_numeric_field::<MeasureTextBlockInput>(&fixture, "textIndent", NumericWireType::Float64);
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "language", |input| {
        input.language.is_none()
    });
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "wrap", |input| input.wrap.is_none());
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "hangingPunctuation", |input| {
        input.hanging_punctuation.is_none()
    });
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "maxWidth", |input| {
        input.max_width.is_none()
    });
    assert_numeric_field::<MeasureTextBlockInput>(&fixture, "maxWidth", NumericWireType::Float64);
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "maxHeight", |input| {
        input.max_height.is_none()
    });
    assert_numeric_field::<MeasureTextBlockInput>(&fixture, "maxHeight", NumericWireType::Float64);
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "writingMode", |input| {
        input.writing_mode.is_none()
    });
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "textOrientation", |input| {
        input.text_orientation.is_none()
    });
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "whiteSpace", |input| {
        input.white_space.is_none()
    });
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "tabSize", |input| {
        input.tab_size.is_none()
    });
    assert_numeric_field::<MeasureTextBlockInput>(&fixture, "tabSize", NumericWireType::Unsigned32);
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "fontVariationSettings", |input| {
        input.font_variation_settings.is_none()
    });
    assert_optional_field::<MeasureTextBlockInput>(&fixture, "fontFeatureSettings", |input| {
        input.font_feature_settings.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<MeasureTextBlockInput>(unknown).is_ok());
}

#[test]
fn shrinkwrap_flow_input_preserves_optional_presence() {
    let fixture = json!({"text": "漢字", "fontFamily": "Fixture", "fontSizePx": 16, "flowBox": {"x": 0, "y": 0, "width": 100, "height": 100}, "exclusions": [], "fallback": [], "fontWeight": 400, "fontStyle": "normal", "lineHeight": 1.2, "lineHeightPx": 20, "letterSpacingPx": 0, "language": "ja", "wrap": "char", "hangingPunctuation": false, "minRegionWidthPx": 1, "maxLines": 4, "writingMode": "horizontal-tb", "textOrientation": "mixed", "minWidth": 1, "minHeight": 1, "targetLineCount": 2, "shrinkwrapEpsilonPx": 0.25, "shrinkwrapMaxIterations": 12, "spans": [], "richText": [], "fontVariationSettings": "normal", "fontFeatureSettings": "normal"});
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "fallback", |input| {
        input.fallback.is_none()
    });
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "fontWeight", |input| {
        input.font_weight.is_none()
    });
    assert_numeric_field::<ShrinkwrapFlowInput>(
        &fixture,
        "fontWeight",
        NumericWireType::Unsigned16,
    );
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "fontStyle", |input| {
        input.font_style.is_none()
    });
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "lineHeight", |input| {
        input.line_height.is_none()
    });
    assert_numeric_field::<ShrinkwrapFlowInput>(&fixture, "lineHeight", NumericWireType::Float64);
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "lineHeightPx", |input| {
        input.line_height_px.is_none()
    });
    assert_numeric_field::<ShrinkwrapFlowInput>(&fixture, "lineHeightPx", NumericWireType::Float64);
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "letterSpacingPx", |input| {
        input.letter_spacing_px.is_none()
    });
    assert_numeric_field::<ShrinkwrapFlowInput>(
        &fixture,
        "letterSpacingPx",
        NumericWireType::Float64,
    );
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "language", |input| {
        input.language.is_none()
    });
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "wrap", |input| input.wrap.is_none());
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "hangingPunctuation", |input| {
        input.hanging_punctuation.is_none()
    });
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "minRegionWidthPx", |input| {
        input.min_region_width_px.is_none()
    });
    assert_numeric_field::<ShrinkwrapFlowInput>(
        &fixture,
        "minRegionWidthPx",
        NumericWireType::Float64,
    );
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "maxLines", |input| {
        input.max_lines.is_none()
    });
    assert_numeric_field::<ShrinkwrapFlowInput>(
        &fixture,
        "maxLines",
        NumericWireType::UnsignedSize,
    );
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "writingMode", |input| {
        input.writing_mode.is_none()
    });
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "textOrientation", |input| {
        input.text_orientation.is_none()
    });
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "minWidth", |input| {
        input.min_width.is_none()
    });
    assert_numeric_field::<ShrinkwrapFlowInput>(&fixture, "minWidth", NumericWireType::Float64);
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "minHeight", |input| {
        input.min_height.is_none()
    });
    assert_numeric_field::<ShrinkwrapFlowInput>(&fixture, "minHeight", NumericWireType::Float64);
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "targetLineCount", |input| {
        input.target_line_count.is_none()
    });
    assert_numeric_field::<ShrinkwrapFlowInput>(
        &fixture,
        "targetLineCount",
        NumericWireType::UnsignedSize,
    );
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "shrinkwrapEpsilonPx", |input| {
        input.shrinkwrap_epsilon_px.is_none()
    });
    assert_numeric_field::<ShrinkwrapFlowInput>(
        &fixture,
        "shrinkwrapEpsilonPx",
        NumericWireType::Float64,
    );
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "shrinkwrapMaxIterations", |input| {
        input.shrinkwrap_max_iterations.is_none()
    });
    assert_numeric_field::<ShrinkwrapFlowInput>(
        &fixture,
        "shrinkwrapMaxIterations",
        NumericWireType::UnsignedSize,
    );
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "spans", |input| input.spans.is_none());
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "richText", |input| {
        input.rich_text.is_none()
    });
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "fontVariationSettings", |input| {
        input.font_variation_settings.is_none()
    });
    assert_optional_field::<ShrinkwrapFlowInput>(&fixture, "fontFeatureSettings", |input| {
        input.font_feature_settings.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<ShrinkwrapFlowInput>(unknown).is_ok());
}

#[test]
fn shrinkwrap_text_input_preserves_optional_presence() {
    let fixture = json!({"text": "漢字", "fontFamily": "Fixture", "fontSizePx": 16, "maxWidth": 100, "fallback": [], "fontWeight": 400, "fontStyle": "normal", "lineHeight": 1.2, "lineHeightPx": 20, "letterSpacingPx": 0, "language": "ja", "wrap": "char", "hangingPunctuation": false, "writingMode": "horizontal-tb", "textOrientation": "mixed", "maxHeight": 100, "minWidth": 1, "minHeight": 1, "targetLineCount": 2, "epsilonPx": 0.25, "maxIterations": 12, "whiteSpace": "normal", "tabSize": 4, "spans": [], "richText": [], "fontVariationSettings": "normal", "fontFeatureSettings": "normal"});
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "fallback", |input| {
        input.fallback.is_none()
    });
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "fontWeight", |input| {
        input.font_weight.is_none()
    });
    assert_numeric_field::<ShrinkwrapTextInput>(
        &fixture,
        "fontWeight",
        NumericWireType::Unsigned16,
    );
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "fontStyle", |input| {
        input.font_style.is_none()
    });
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "lineHeight", |input| {
        input.line_height.is_none()
    });
    assert_numeric_field::<ShrinkwrapTextInput>(&fixture, "lineHeight", NumericWireType::Float64);
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "lineHeightPx", |input| {
        input.line_height_px.is_none()
    });
    assert_numeric_field::<ShrinkwrapTextInput>(&fixture, "lineHeightPx", NumericWireType::Float64);
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "letterSpacingPx", |input| {
        input.letter_spacing_px.is_none()
    });
    assert_numeric_field::<ShrinkwrapTextInput>(
        &fixture,
        "letterSpacingPx",
        NumericWireType::Float64,
    );
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "language", |input| {
        input.language.is_none()
    });
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "wrap", |input| input.wrap.is_none());
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "hangingPunctuation", |input| {
        input.hanging_punctuation.is_none()
    });
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "writingMode", |input| {
        input.writing_mode.is_none()
    });
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "textOrientation", |input| {
        input.text_orientation.is_none()
    });
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "maxHeight", |input| {
        input.max_height.is_none()
    });
    assert_numeric_field::<ShrinkwrapTextInput>(&fixture, "maxHeight", NumericWireType::Float64);
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "minWidth", |input| {
        input.min_width.is_none()
    });
    assert_numeric_field::<ShrinkwrapTextInput>(&fixture, "minWidth", NumericWireType::Float64);
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "minHeight", |input| {
        input.min_height.is_none()
    });
    assert_numeric_field::<ShrinkwrapTextInput>(&fixture, "minHeight", NumericWireType::Float64);
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "targetLineCount", |input| {
        input.target_line_count.is_none()
    });
    assert_numeric_field::<ShrinkwrapTextInput>(
        &fixture,
        "targetLineCount",
        NumericWireType::UnsignedSize,
    );
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "epsilonPx", |input| {
        input.epsilon_px.is_none()
    });
    assert_numeric_field::<ShrinkwrapTextInput>(&fixture, "epsilonPx", NumericWireType::Float64);
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "maxIterations", |input| {
        input.max_iterations.is_none()
    });
    assert_numeric_field::<ShrinkwrapTextInput>(
        &fixture,
        "maxIterations",
        NumericWireType::UnsignedSize,
    );
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "whiteSpace", |input| {
        input.white_space.is_none()
    });
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "tabSize", |input| {
        input.tab_size.is_none()
    });
    assert_numeric_field::<ShrinkwrapTextInput>(&fixture, "tabSize", NumericWireType::Unsigned32);
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "spans", |input| input.spans.is_none());
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "richText", |input| {
        input.rich_text.is_none()
    });
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "fontVariationSettings", |input| {
        input.font_variation_settings.is_none()
    });
    assert_optional_field::<ShrinkwrapTextInput>(&fixture, "fontFeatureSettings", |input| {
        input.font_feature_settings.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<ShrinkwrapTextInput>(unknown).is_ok());
}

#[test]
fn text_flow_input_preserves_optional_presence() {
    let fixture = json!({"text": "漢字", "fontFamily": "Fixture", "fontSizePx": 16, "lineWidths": [100], "fallback": [], "fontWeight": 400, "fontStyle": "normal", "lineHeight": 1.2, "letterSpacingPx": 0, "language": "ja", "wrap": "char", "whiteSpace": "normal", "tabSize": 4, "hangingPunctuation": false, "writingMode": "horizontal-tb", "textOrientation": "mixed", "fontVariationSettings": "normal", "fontFeatureSettings": "normal"});
    assert_optional_field::<TextFlowInput>(&fixture, "fallback", |input| input.fallback.is_none());
    assert_optional_field::<TextFlowInput>(&fixture, "fontWeight", |input| {
        input.font_weight.is_none()
    });
    assert_numeric_field::<TextFlowInput>(&fixture, "fontWeight", NumericWireType::Unsigned16);
    assert_optional_field::<TextFlowInput>(&fixture, "fontStyle", |input| {
        input.font_style.is_none()
    });
    assert_optional_field::<TextFlowInput>(&fixture, "lineHeight", |input| {
        input.line_height.is_none()
    });
    assert_numeric_field::<TextFlowInput>(&fixture, "lineHeight", NumericWireType::Float64);
    assert_optional_field::<TextFlowInput>(&fixture, "letterSpacingPx", |input| {
        input.letter_spacing_px.is_none()
    });
    assert_numeric_field::<TextFlowInput>(&fixture, "letterSpacingPx", NumericWireType::Float64);
    assert_optional_field::<TextFlowInput>(&fixture, "language", |input| input.language.is_none());
    assert_optional_field::<TextFlowInput>(&fixture, "wrap", |input| input.wrap.is_none());
    assert_optional_field::<TextFlowInput>(&fixture, "whiteSpace", |input| {
        input.white_space.is_none()
    });
    assert_optional_field::<TextFlowInput>(&fixture, "tabSize", |input| input.tab_size.is_none());
    assert_numeric_field::<TextFlowInput>(&fixture, "tabSize", NumericWireType::Unsigned32);
    assert_optional_field::<TextFlowInput>(&fixture, "hangingPunctuation", |input| {
        input.hanging_punctuation.is_none()
    });
    assert_optional_field::<TextFlowInput>(&fixture, "writingMode", |input| {
        input.writing_mode.is_none()
    });
    assert_optional_field::<TextFlowInput>(&fixture, "textOrientation", |input| {
        input.text_orientation.is_none()
    });
    assert_optional_field::<TextFlowInput>(&fixture, "fontVariationSettings", |input| {
        input.font_variation_settings.is_none()
    });
    assert_optional_field::<TextFlowInput>(&fixture, "fontFeatureSettings", |input| {
        input.font_feature_settings.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<TextFlowInput>(unknown).is_ok());
}

#[test]
fn text_flow_with_exclusions_input_preserves_optional_presence() {
    let fixture = json!({"text": "漢字", "fontFamily": "Fixture", "fontSizePx": 16, "flowBox": {"x": 0, "y": 0, "width": 100, "height": 100}, "exclusions": [], "fallback": [], "fontWeight": 400, "fontStyle": "normal", "lineHeight": 1.2, "lineHeightPx": 20, "letterSpacingPx": 0, "language": "ja", "wrap": "char", "hangingPunctuation": false, "whiteSpace": "normal", "tabSize": 4, "minRegionWidthPx": 1, "maxLines": 4, "ellipsis": false, "fit": "shrink", "minFontSizePx": 8, "maxFontSizePx": 24, "fitEpsilonPx": 0.25, "fitMaxIterations": 12, "fitMaxProbes": 100, "spans": [], "richText": [], "writingMode": "horizontal-tb", "textOrientation": "mixed", "fontVariationSettings": "normal", "fontFeatureSettings": "normal"});
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "fallback", |input| {
        input.fallback.is_none()
    });
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "fontWeight", |input| {
        input.font_weight.is_none()
    });
    assert_numeric_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "fontWeight",
        NumericWireType::Unsigned16,
    );
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "fontStyle", |input| {
        input.font_style.is_none()
    });
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "lineHeight", |input| {
        input.line_height.is_none()
    });
    assert_numeric_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "lineHeight",
        NumericWireType::Float64,
    );
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "lineHeightPx", |input| {
        input.line_height_px.is_none()
    });
    assert_numeric_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "lineHeightPx",
        NumericWireType::Float64,
    );
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "letterSpacingPx", |input| {
        input.letter_spacing_px.is_none()
    });
    assert_numeric_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "letterSpacingPx",
        NumericWireType::Float64,
    );
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "language", |input| {
        input.language.is_none()
    });
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "wrap", |input| {
        input.wrap.is_none()
    });
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "hangingPunctuation", |input| {
        input.hanging_punctuation.is_none()
    });
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "whiteSpace", |input| {
        input.white_space.is_none()
    });
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "tabSize", |input| {
        input.tab_size.is_none()
    });
    assert_numeric_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "tabSize",
        NumericWireType::Unsigned32,
    );
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "minRegionWidthPx", |input| {
        input.min_region_width_px.is_none()
    });
    assert_numeric_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "minRegionWidthPx",
        NumericWireType::Float64,
    );
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "maxLines", |input| {
        input.max_lines.is_none()
    });
    assert_numeric_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "maxLines",
        NumericWireType::UnsignedSize,
    );
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "ellipsis", |input| {
        input.ellipsis.is_none()
    });
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "fit", |input| {
        input.fit.is_none()
    });
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "minFontSizePx", |input| {
        input.min_font_size_px.is_none()
    });
    assert_numeric_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "minFontSizePx",
        NumericWireType::Float64,
    );
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "maxFontSizePx", |input| {
        input.max_font_size_px.is_none()
    });
    assert_numeric_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "maxFontSizePx",
        NumericWireType::Float64,
    );
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "fitEpsilonPx", |input| {
        input.fit_epsilon_px.is_none()
    });
    assert_numeric_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "fitEpsilonPx",
        NumericWireType::Float64,
    );
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "fitMaxIterations", |input| {
        input.fit_max_iterations.is_none()
    });
    assert_numeric_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "fitMaxIterations",
        NumericWireType::UnsignedSize,
    );
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "fitMaxProbes", |input| {
        input.fit_max_probes.is_none()
    });
    assert_numeric_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "fitMaxProbes",
        NumericWireType::UnsignedSize,
    );
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "spans", |input| {
        input.spans.is_none()
    });
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "richText", |input| {
        input.rich_text.is_none()
    });
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "writingMode", |input| {
        input.writing_mode.is_none()
    });
    assert_optional_field::<TextFlowWithExclusionsInput>(&fixture, "textOrientation", |input| {
        input.text_orientation.is_none()
    });
    assert_optional_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "fontVariationSettings",
        |input| input.font_variation_settings.is_none(),
    );
    assert_optional_field::<TextFlowWithExclusionsInput>(
        &fixture,
        "fontFeatureSettings",
        |input| input.font_feature_settings.is_none(),
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<TextFlowWithExclusionsInput>(unknown).is_ok());
}
