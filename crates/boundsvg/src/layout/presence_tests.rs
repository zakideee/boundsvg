//! Exercise authoring DTO fields without replacing their layout validation owners.

use crate::wire::test_support::{NumericWireType, assert_numeric_field};
use serde_json::json;

use super::types::{
    HandlersInput, LayoutNodeInput, PartPaintOverrideInput, PreferredFrame, TaffyStyleInput,
    TextFlowLayoutInput, TextInput, TextPathInput, VisualInput,
};
use crate::wire::test_support::assert_optional_field;

#[test]
fn handlers_input_preserves_optional_presence() {
    let fixture = json!({"onClick": "handler", "onDoubleClick": "handler", "onContextMenu": "handler", "onPointerDown": "handler", "onPointerUp": "handler", "onPointerCancel": "handler", "onPointerMove": "handler", "onPointerEnter": "handler", "onPointerLeave": "handler", "onPointerOver": "handler", "onPointerOut": "handler", "onMouseDown": "handler", "onMouseUp": "handler", "onMouseMove": "handler", "onMouseEnter": "handler", "onMouseLeave": "handler", "onMouseOver": "handler", "onMouseOut": "handler", "onTouchStart": "handler", "onTouchEnd": "handler", "onTouchMove": "handler"});
    assert_optional_field::<HandlersInput>(&fixture, "onClick", |input| input.on_click.is_none());
    assert_optional_field::<HandlersInput>(&fixture, "onDoubleClick", |input| {
        input.on_double_click.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onContextMenu", |input| {
        input.on_context_menu.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onPointerDown", |input| {
        input.on_pointer_down.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onPointerUp", |input| {
        input.on_pointer_up.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onPointerCancel", |input| {
        input.on_pointer_cancel.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onPointerMove", |input| {
        input.on_pointer_move.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onPointerEnter", |input| {
        input.on_pointer_enter.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onPointerLeave", |input| {
        input.on_pointer_leave.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onPointerOver", |input| {
        input.on_pointer_over.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onPointerOut", |input| {
        input.on_pointer_out.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onMouseDown", |input| {
        input.on_mouse_down.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onMouseUp", |input| {
        input.on_mouse_up.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onMouseMove", |input| {
        input.on_mouse_move.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onMouseEnter", |input| {
        input.on_mouse_enter.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onMouseLeave", |input| {
        input.on_mouse_leave.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onMouseOver", |input| {
        input.on_mouse_over.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onMouseOut", |input| {
        input.on_mouse_out.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onTouchStart", |input| {
        input.on_touch_start.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onTouchEnd", |input| {
        input.on_touch_end.is_none()
    });
    assert_optional_field::<HandlersInput>(&fixture, "onTouchMove", |input| {
        input.on_touch_move.is_none()
    });
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<HandlersInput>(unknown).is_ok());
}

#[test]
fn layout_node_input_preserves_optional_presence() {
    let fixture = json!({"nodeId": "node", "nodeType": "box", "authoredId": true, "style": {}, "children": [], "text": {"content": "漢字", "fontSizePx": 16}, "textPath": {"spans": [], "decorationOwnerIds": [], "sourceItemCount": 0, "inlineCount": 0, "d": "M0 0 L100 0", "fontSizePx": 16}, "image": {"width": 16, "height": 16}, "visual": {}});
    assert_optional_field::<LayoutNodeInput>(&fixture, "text", |input| input.text.is_none());
    assert_optional_field::<LayoutNodeInput>(&fixture, "textPath", |input| {
        input.text_path.is_none()
    });
    assert_optional_field::<LayoutNodeInput>(&fixture, "image", |input| input.image.is_none());
    assert_optional_field::<LayoutNodeInput>(&fixture, "visual", |input| input.visual.is_none());
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<LayoutNodeInput>(unknown).is_ok());
}

#[test]
fn part_paint_override_input_preserves_optional_presence() {
    let fixture = json!({"fill": "#000000", "stroke": "#000000", "strokeWidth": 1, "strokeLinecap": "butt", "strokeLinejoin": "miter", "strokeDasharray": "none", "strokeMiterlimit": 4});
    assert_optional_field::<PartPaintOverrideInput>(&fixture, "fill", |input| input.fill.is_none());
    assert_optional_field::<PartPaintOverrideInput>(&fixture, "stroke", |input| {
        input.stroke.is_none()
    });
    assert_optional_field::<PartPaintOverrideInput>(&fixture, "strokeWidth", |input| {
        input.stroke_width.is_none()
    });
    assert_numeric_field::<PartPaintOverrideInput>(
        &fixture,
        "strokeWidth",
        NumericWireType::Float64,
    );
    assert_optional_field::<PartPaintOverrideInput>(&fixture, "strokeLinecap", |input| {
        input.stroke_linecap.is_none()
    });
    assert_optional_field::<PartPaintOverrideInput>(&fixture, "strokeLinejoin", |input| {
        input.stroke_linejoin.is_none()
    });
    assert_optional_field::<PartPaintOverrideInput>(&fixture, "strokeDasharray", |input| {
        input.stroke_dasharray.is_none()
    });
    assert_optional_field::<PartPaintOverrideInput>(&fixture, "strokeMiterlimit", |input| {
        input.stroke_miterlimit.is_none()
    });
    assert_numeric_field::<PartPaintOverrideInput>(
        &fixture,
        "strokeMiterlimit",
        NumericWireType::Float64,
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<PartPaintOverrideInput>(unknown).is_ok());
}

#[test]
fn preferred_frame_preserves_optional_presence() {
    let fixture = json!({"w": 100, "h": 80});
    assert_optional_field::<PreferredFrame>(&fixture, "w", |input| input.w.is_none());
    assert_numeric_field::<PreferredFrame>(&fixture, "w", NumericWireType::Float32);
    assert_optional_field::<PreferredFrame>(&fixture, "h", |input| input.h.is_none());
    assert_numeric_field::<PreferredFrame>(&fixture, "h", NumericWireType::Float32);
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<PreferredFrame>(unknown).is_ok());
}

#[test]
fn taffy_style_input_preserves_optional_presence() {
    let fixture = json!({"display": "flex", "flexDirection": "row", "flexWrap": "nowrap", "alignItems": "stretch", "justifyContent": "flex-start", "alignSelf": "auto", "flexGrow": 0, "flexShrink": 1, "flexBasis": 16, "gap": 0, "rowGap": 0, "columnGap": 0, "width": 100, "height": 80, "minWidth": 0, "minHeight": 0, "maxWidth": 200, "maxHeight": 200, "padding": [0, 0, 0, 0], "margin": [0, 0, 0, 0], "overflow": "visible", "gridTemplateColumns": ["1fr"], "gridTemplateRows": ["1fr"], "gridColumnStart": 1, "gridColumnEnd": 2, "gridRowStart": 1, "gridRowEnd": 2, "justifyItems": "stretch", "position": "relative", "inset": [null, 0, null, 0], "aspectRatio": 1});
    assert_optional_field::<TaffyStyleInput>(&fixture, "display", |input| input.display.is_none());
    assert_optional_field::<TaffyStyleInput>(&fixture, "flexDirection", |input| {
        input.flex_direction.is_none()
    });
    assert_optional_field::<TaffyStyleInput>(&fixture, "flexWrap", |input| {
        input.flex_wrap.is_none()
    });
    assert_optional_field::<TaffyStyleInput>(&fixture, "alignItems", |input| {
        input.align_items.is_none()
    });
    assert_optional_field::<TaffyStyleInput>(&fixture, "justifyContent", |input| {
        input.justify_content.is_none()
    });
    assert_optional_field::<TaffyStyleInput>(&fixture, "alignSelf", |input| {
        input.align_self.is_none()
    });
    assert_optional_field::<TaffyStyleInput>(&fixture, "flexGrow", |input| {
        input.flex_grow.is_none()
    });
    assert_numeric_field::<TaffyStyleInput>(&fixture, "flexGrow", NumericWireType::Float32);
    assert_optional_field::<TaffyStyleInput>(&fixture, "flexShrink", |input| {
        input.flex_shrink.is_none()
    });
    assert_numeric_field::<TaffyStyleInput>(&fixture, "flexShrink", NumericWireType::Float32);
    assert_optional_field::<TaffyStyleInput>(&fixture, "flexBasis", |input| {
        input.flex_basis.is_none()
    });
    assert_numeric_field::<TaffyStyleInput>(&fixture, "flexBasis", NumericWireType::Float32);
    assert_optional_field::<TaffyStyleInput>(&fixture, "gap", |input| input.gap.is_none());
    assert_numeric_field::<TaffyStyleInput>(&fixture, "gap", NumericWireType::Float32);
    assert_optional_field::<TaffyStyleInput>(&fixture, "rowGap", |input| input.row_gap.is_none());
    assert_numeric_field::<TaffyStyleInput>(&fixture, "rowGap", NumericWireType::Float32);
    assert_optional_field::<TaffyStyleInput>(&fixture, "columnGap", |input| {
        input.column_gap.is_none()
    });
    assert_numeric_field::<TaffyStyleInput>(&fixture, "columnGap", NumericWireType::Float32);
    assert_optional_field::<TaffyStyleInput>(&fixture, "width", |input| input.width.is_none());
    assert_numeric_field::<TaffyStyleInput>(&fixture, "width", NumericWireType::Float32);
    assert_optional_field::<TaffyStyleInput>(&fixture, "height", |input| input.height.is_none());
    assert_numeric_field::<TaffyStyleInput>(&fixture, "height", NumericWireType::Float32);
    assert_optional_field::<TaffyStyleInput>(&fixture, "minWidth", |input| {
        input.min_width.is_none()
    });
    assert_numeric_field::<TaffyStyleInput>(&fixture, "minWidth", NumericWireType::Float32);
    assert_optional_field::<TaffyStyleInput>(&fixture, "minHeight", |input| {
        input.min_height.is_none()
    });
    assert_numeric_field::<TaffyStyleInput>(&fixture, "minHeight", NumericWireType::Float32);
    assert_optional_field::<TaffyStyleInput>(&fixture, "maxWidth", |input| {
        input.max_width.is_none()
    });
    assert_numeric_field::<TaffyStyleInput>(&fixture, "maxWidth", NumericWireType::Float32);
    assert_optional_field::<TaffyStyleInput>(&fixture, "maxHeight", |input| {
        input.max_height.is_none()
    });
    assert_numeric_field::<TaffyStyleInput>(&fixture, "maxHeight", NumericWireType::Float32);
    assert_optional_field::<TaffyStyleInput>(&fixture, "padding", |input| input.padding.is_none());
    assert_optional_field::<TaffyStyleInput>(&fixture, "margin", |input| input.margin.is_none());
    assert_optional_field::<TaffyStyleInput>(&fixture, "overflow", |input| {
        input.overflow.is_none()
    });
    assert_optional_field::<TaffyStyleInput>(&fixture, "gridTemplateColumns", |input| {
        input.grid_template_columns.is_none()
    });
    assert_optional_field::<TaffyStyleInput>(&fixture, "gridTemplateRows", |input| {
        input.grid_template_rows.is_none()
    });
    assert_optional_field::<TaffyStyleInput>(&fixture, "gridColumnStart", |input| {
        input.grid_column_start.is_none()
    });
    assert_numeric_field::<TaffyStyleInput>(&fixture, "gridColumnStart", NumericWireType::Signed16);
    assert_optional_field::<TaffyStyleInput>(&fixture, "gridColumnEnd", |input| {
        input.grid_column_end.is_none()
    });
    assert_numeric_field::<TaffyStyleInput>(&fixture, "gridColumnEnd", NumericWireType::Signed16);
    assert_optional_field::<TaffyStyleInput>(&fixture, "gridRowStart", |input| {
        input.grid_row_start.is_none()
    });
    assert_numeric_field::<TaffyStyleInput>(&fixture, "gridRowStart", NumericWireType::Signed16);
    assert_optional_field::<TaffyStyleInput>(&fixture, "gridRowEnd", |input| {
        input.grid_row_end.is_none()
    });
    assert_numeric_field::<TaffyStyleInput>(&fixture, "gridRowEnd", NumericWireType::Signed16);
    assert_optional_field::<TaffyStyleInput>(&fixture, "justifyItems", |input| {
        input.justify_items.is_none()
    });
    assert_optional_field::<TaffyStyleInput>(&fixture, "position", |input| {
        input.position.is_none()
    });
    assert_optional_field::<TaffyStyleInput>(&fixture, "inset", |input| input.inset.is_none());
    assert_optional_field::<TaffyStyleInput>(&fixture, "aspectRatio", |input| {
        input.aspect_ratio.is_none()
    });
    assert_numeric_field::<TaffyStyleInput>(&fixture, "aspectRatio", NumericWireType::Float32);
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<TaffyStyleInput>(unknown).is_ok());
}

#[test]
fn text_flow_layout_input_preserves_optional_presence() {
    let fixture = json!({"minRegionWidthPx": 1});
    assert_optional_field::<TextFlowLayoutInput>(&fixture, "minRegionWidthPx", |input| {
        input.min_region_width_px.is_none()
    });
    assert_numeric_field::<TextFlowLayoutInput>(
        &fixture,
        "minRegionWidthPx",
        NumericWireType::Float64,
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<TextFlowLayoutInput>(unknown).is_ok());
}

#[test]
fn text_input_preserves_optional_presence() {
    let fixture = json!({"content": "漢字", "fontSizePx": 16, "spans": [], "richText": [], "lineHeight": 1.2, "lineHeightPx": 20, "letterSpacingPx": 0, "textIndent": 0, "maxLines": 4, "preferredFrame": {"w": 100, "h": 80}, "writingMode": "horizontal-tb", "language": "ja", "textOrientation": "mixed", "fit": "shrink", "minFontSizePx": 8, "shrinkEpsilonPx": 0.25, "shrinkMaxIterations": 12, "maxFontSizePx": 24, "growEpsilonPx": 0.25, "growMaxIterations": 12, "fitMaxProbes": 100, "ellipsis": false, "hangingPunctuation": false, "whiteSpace": "normal", "tabSize": 4, "flow": {"exclusions": []}, "fontVariationSettings": "normal", "fontFeatureSettings": "normal", "unitMap": {"kind": "cluster", "ruby": "with-base"}, "textDecorationRangeCount": 0});
    assert_optional_field::<TextInput>(&fixture, "spans", |input| input.spans.is_none());
    assert_optional_field::<TextInput>(&fixture, "richText", |input| input.rich_text.is_none());
    assert_optional_field::<TextInput>(&fixture, "lineHeight", |input| input.line_height.is_none());
    assert_numeric_field::<TextInput>(&fixture, "lineHeight", NumericWireType::Float64);
    assert_optional_field::<TextInput>(&fixture, "lineHeightPx", |input| {
        input.line_height_px.is_none()
    });
    assert_numeric_field::<TextInput>(&fixture, "lineHeightPx", NumericWireType::Float64);
    assert_optional_field::<TextInput>(&fixture, "letterSpacingPx", |input| {
        input.letter_spacing_px.is_none()
    });
    assert_numeric_field::<TextInput>(&fixture, "letterSpacingPx", NumericWireType::Float64);
    assert_optional_field::<TextInput>(&fixture, "textIndent", |input| input.text_indent.is_none());
    assert_numeric_field::<TextInput>(&fixture, "textIndent", NumericWireType::Float64);
    assert_optional_field::<TextInput>(&fixture, "maxLines", |input| input.max_lines.is_none());
    assert_numeric_field::<TextInput>(&fixture, "maxLines", NumericWireType::UnsignedSize);
    assert_optional_field::<TextInput>(&fixture, "preferredFrame", |input| {
        input.preferred_frame.is_none()
    });
    assert_optional_field::<TextInput>(&fixture, "writingMode", |input| {
        input.writing_mode.is_none()
    });
    assert_optional_field::<TextInput>(&fixture, "language", |input| input.language.is_none());
    assert_optional_field::<TextInput>(&fixture, "textOrientation", |input| {
        input.text_orientation.is_none()
    });
    assert_optional_field::<TextInput>(&fixture, "fit", |input| input.fit.is_none());
    assert_optional_field::<TextInput>(&fixture, "minFontSizePx", |input| {
        input.min_font_size_px.is_none()
    });
    assert_numeric_field::<TextInput>(&fixture, "minFontSizePx", NumericWireType::Float64);
    assert_optional_field::<TextInput>(&fixture, "shrinkEpsilonPx", |input| {
        input.shrink_epsilon_px.is_none()
    });
    assert_numeric_field::<TextInput>(&fixture, "shrinkEpsilonPx", NumericWireType::Float64);
    assert_optional_field::<TextInput>(&fixture, "shrinkMaxIterations", |input| {
        input.shrink_max_iterations.is_none()
    });
    assert_numeric_field::<TextInput>(
        &fixture,
        "shrinkMaxIterations",
        NumericWireType::UnsignedSize,
    );
    assert_optional_field::<TextInput>(&fixture, "maxFontSizePx", |input| {
        input.max_font_size_px.is_none()
    });
    assert_numeric_field::<TextInput>(&fixture, "maxFontSizePx", NumericWireType::Float64);
    assert_optional_field::<TextInput>(&fixture, "growEpsilonPx", |input| {
        input.grow_epsilon_px.is_none()
    });
    assert_numeric_field::<TextInput>(&fixture, "growEpsilonPx", NumericWireType::Float64);
    assert_optional_field::<TextInput>(&fixture, "growMaxIterations", |input| {
        input.grow_max_iterations.is_none()
    });
    assert_numeric_field::<TextInput>(&fixture, "growMaxIterations", NumericWireType::UnsignedSize);
    assert_optional_field::<TextInput>(&fixture, "fitMaxProbes", |input| {
        input.fit_max_probes.is_none()
    });
    assert_numeric_field::<TextInput>(&fixture, "fitMaxProbes", NumericWireType::UnsignedSize);
    assert_optional_field::<TextInput>(&fixture, "ellipsis", |input| input.ellipsis.is_none());
    assert_optional_field::<TextInput>(&fixture, "hangingPunctuation", |input| {
        input.hanging_punctuation.is_none()
    });
    assert_optional_field::<TextInput>(&fixture, "whiteSpace", |input| input.white_space.is_none());
    assert_optional_field::<TextInput>(&fixture, "tabSize", |input| input.tab_size.is_none());
    assert_numeric_field::<TextInput>(&fixture, "tabSize", NumericWireType::Unsigned32);
    assert_optional_field::<TextInput>(&fixture, "flow", |input| input.flow.is_none());
    assert_optional_field::<TextInput>(&fixture, "fontVariationSettings", |input| {
        input.font_variation_settings.is_none()
    });
    assert_optional_field::<TextInput>(&fixture, "fontFeatureSettings", |input| {
        input.font_feature_settings.is_none()
    });
    assert_optional_field::<TextInput>(&fixture, "unitMap", |input| input.unit_map.is_none());
    assert_optional_field::<TextInput>(&fixture, "textDecorationRangeCount", |input| {
        input.text_decoration_range_count.is_none()
    });
    assert_numeric_field::<TextInput>(
        &fixture,
        "textDecorationRangeCount",
        NumericWireType::UnsignedSize,
    );
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<TextInput>(unknown).is_ok());
}

#[test]
fn text_path_input_preserves_optional_presence() {
    let fixture = json!({"spans": [], "decorationOwnerIds": [], "sourceItemCount": 0, "inlineCount": 0, "d": "M0 0 L100 0", "fontSizePx": 16, "textDecorationRangeCount": 0, "letterSpacingPx": 0, "language": "ja", "fontVariationSettings": "normal", "fontFeatureSettings": "normal", "startOffsetPx": 0, "textAnchor": "start", "pathDirection": "forward", "pathNormal": "left", "pathOffsetPx": 0, "pathFit": "none", "pathOverflow": "visible", "unitMap": {"kind": "cluster", "ruby": "with-base"}});
    assert_optional_field::<TextPathInput>(&fixture, "textDecorationRangeCount", |input| {
        input.text_decoration_range_count.is_none()
    });
    assert_numeric_field::<TextPathInput>(
        &fixture,
        "textDecorationRangeCount",
        NumericWireType::UnsignedSize,
    );
    assert_optional_field::<TextPathInput>(&fixture, "letterSpacingPx", |input| {
        input.letter_spacing_px.is_none()
    });
    assert_numeric_field::<TextPathInput>(&fixture, "letterSpacingPx", NumericWireType::Float64);
    assert_optional_field::<TextPathInput>(&fixture, "language", |input| input.language.is_none());
    assert_optional_field::<TextPathInput>(&fixture, "fontVariationSettings", |input| {
        input.font_variation_settings.is_none()
    });
    assert_optional_field::<TextPathInput>(&fixture, "fontFeatureSettings", |input| {
        input.font_feature_settings.is_none()
    });
    assert_optional_field::<TextPathInput>(&fixture, "startOffsetPx", |input| {
        input.start_offset_px.is_none()
    });
    assert_numeric_field::<TextPathInput>(&fixture, "startOffsetPx", NumericWireType::Float64);
    assert_optional_field::<TextPathInput>(&fixture, "textAnchor", |input| {
        input.text_anchor.is_none()
    });
    assert_optional_field::<TextPathInput>(&fixture, "pathDirection", |input| {
        input.path_direction.is_none()
    });
    assert_optional_field::<TextPathInput>(&fixture, "pathNormal", |input| {
        input.path_normal.is_none()
    });
    assert_optional_field::<TextPathInput>(&fixture, "pathOffsetPx", |input| {
        input.path_offset_px.is_none()
    });
    assert_numeric_field::<TextPathInput>(&fixture, "pathOffsetPx", NumericWireType::Float64);
    assert_optional_field::<TextPathInput>(&fixture, "pathFit", |input| input.path_fit.is_none());
    assert_optional_field::<TextPathInput>(&fixture, "pathOverflow", |input| {
        input.path_overflow.is_none()
    });
    assert_optional_field::<TextPathInput>(&fixture, "unitMap", |input| input.unit_map.is_none());
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<TextPathInput>(unknown).is_ok());
}

#[test]
fn visual_input_preserves_optional_presence() {
    let fixture: serde_json::Value = serde_json::from_str(
        r##"{
  "background": "#ffffff",
  "borderWidth": 1,
  "borderColor": "#000000",
  "borderRadius": 0,
  "overflow": "visible",
  "boxShadow": "0 0 0 #000000",
  "opacity": 1,
  "zIndex": 0,
  "transform": {},
  "animation": {
    "keyframes": [
      {
        "at": 0
      },
      {
        "at": 1
      }
    ],
    "durationMs": 100
  },
  "unitAnimation": {
    "by": "cluster",
    "animation": {
      "keyframes": [
        {
          "at": 0
        },
        {
          "at": 1
        }
      ],
      "durationMs": 100
    }
  },
  "inlineRectAnimations": {},
  "inlineDecorationAnimations": {},
  "meta": {},
  "debug": false,
  "strokeScaling": "transform",
  "strokeLinecap": "butt",
  "strokeLinejoin": "miter",
  "strokeDasharray": "none",
  "strokeMiterlimit": 4,
  "fill": "#000000",
  "stroke": "#000000",
  "strokeWidth": 1,
  "fillRule": "nonzero",
  "d": "M0 0 L10 10",
  "color": "#000000",
  "textAlign": "left",
  "fontWeight": 400,
  "fontFallback": [],
  "textStroke": "#000000",
  "textStrokeWidth": 1,
  "textStrokeLinecap": "butt",
  "textStrokeLinejoin": "miter",
  "textStrokeDasharray": "none",
  "textStrokeMiterlimit": 4,
  "textStrokes": [],
  "textShadows": [],
  "src": "fixture.png",
  "objectFit": "contain",
  "objectPosition": "center",
  "svgContent": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"/>",
  "contentIdPrefix": "content-",
  "preserveAspectRatio": "meet",
  "shapeGeometry": {
    "viewBox": {
      "x": 0,
      "y": 0,
      "width": 100,
      "height": 100
    },
    "root": {
      "kind": "path",
      "d": "M0 0 L100 0 L100 100 Z"
    }
  },
  "shapeGeometryId": "shape",
  "symbolDefinition": {
    "geometry": {
      "viewBox": {
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100
      },
      "root": {
        "kind": "path",
        "d": "M0 0 L100 0 L100 100 Z"
      }
    }
  },
  "symbolId": "symbol",
  "emitPartIds": false,
  "partPaint": {},
  "handlers": {}
}"##,
    )
    .expect("complete visual fixture");
    assert_optional_field::<VisualInput>(&fixture, "background", |input| {
        input.background.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "borderWidth", |input| {
        input.border_width.is_none()
    });
    assert_numeric_field::<VisualInput>(&fixture, "borderWidth", NumericWireType::Float64);
    assert_optional_field::<VisualInput>(&fixture, "borderColor", |input| {
        input.border_color.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "borderRadius", |input| {
        input.border_radius.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "overflow", |input| input.overflow.is_none());
    assert_optional_field::<VisualInput>(&fixture, "boxShadow", |input| input.box_shadow.is_none());
    assert_optional_field::<VisualInput>(&fixture, "opacity", |input| input.opacity.is_none());
    assert_numeric_field::<VisualInput>(&fixture, "opacity", NumericWireType::Float64);
    assert_optional_field::<VisualInput>(&fixture, "zIndex", |input| input.z_index.is_none());
    assert_numeric_field::<VisualInput>(&fixture, "zIndex", NumericWireType::Float64);
    assert_optional_field::<VisualInput>(&fixture, "transform", |input| input.transform.is_none());
    assert_optional_field::<VisualInput>(&fixture, "animation", |input| input.animation.is_none());
    assert_optional_field::<VisualInput>(&fixture, "unitAnimation", |input| {
        input.unit_animation.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "inlineRectAnimations", |input| {
        input.inline_rect_animations.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "inlineDecorationAnimations", |input| {
        input.inline_decoration_animations.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "meta", |input| input.meta.is_none());
    assert_optional_field::<VisualInput>(&fixture, "debug", |input| input.debug.is_none());
    assert_optional_field::<VisualInput>(&fixture, "strokeScaling", |input| {
        input.stroke_scaling.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "strokeLinecap", |input| {
        input.stroke_linecap.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "strokeLinejoin", |input| {
        input.stroke_linejoin.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "strokeDasharray", |input| {
        input.stroke_dasharray.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "strokeMiterlimit", |input| {
        input.stroke_miterlimit.is_none()
    });
    assert_numeric_field::<VisualInput>(&fixture, "strokeMiterlimit", NumericWireType::Float64);
    assert_optional_field::<VisualInput>(&fixture, "fill", |input| input.fill.is_none());
    assert_optional_field::<VisualInput>(&fixture, "stroke", |input| input.stroke.is_none());
    assert_optional_field::<VisualInput>(&fixture, "strokeWidth", |input| {
        input.stroke_width.is_none()
    });
    assert_numeric_field::<VisualInput>(&fixture, "strokeWidth", NumericWireType::Float64);
    assert_optional_field::<VisualInput>(&fixture, "fillRule", |input| input.fill_rule.is_none());
    assert_optional_field::<VisualInput>(&fixture, "d", |input| input.d.is_none());
    assert_optional_field::<VisualInput>(&fixture, "color", |input| input.color.is_none());
    assert_optional_field::<VisualInput>(&fixture, "textAlign", |input| input.text_align.is_none());
    assert_optional_field::<VisualInput>(&fixture, "fontWeight", |input| {
        input.font_weight.is_none()
    });
    assert_numeric_field::<VisualInput>(&fixture, "fontWeight", NumericWireType::Unsigned16);
    assert_optional_field::<VisualInput>(&fixture, "fontFallback", |input| {
        input.font_fallback.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "textStroke", |input| {
        input.text_stroke.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "textStrokeWidth", |input| {
        input.text_stroke_width.is_none()
    });
    assert_numeric_field::<VisualInput>(&fixture, "textStrokeWidth", NumericWireType::Float64);
    assert_optional_field::<VisualInput>(&fixture, "textStrokeLinecap", |input| {
        input.text_stroke_linecap.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "textStrokeLinejoin", |input| {
        input.text_stroke_linejoin.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "textStrokeDasharray", |input| {
        input.text_stroke_dasharray.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "textStrokeMiterlimit", |input| {
        input.text_stroke_miterlimit.is_none()
    });
    assert_numeric_field::<VisualInput>(&fixture, "textStrokeMiterlimit", NumericWireType::Float64);
    assert_optional_field::<VisualInput>(&fixture, "textStrokes", |input| {
        input.text_strokes.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "textShadows", |input| {
        input.text_shadows.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "src", |input| input.src.is_none());
    assert_optional_field::<VisualInput>(&fixture, "objectFit", |input| input.object_fit.is_none());
    assert_optional_field::<VisualInput>(&fixture, "objectPosition", |input| {
        input.object_position.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "svgContent", |input| {
        input.svg_content.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "contentIdPrefix", |input| {
        input.content_id_prefix.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "preserveAspectRatio", |input| {
        input.preserve_aspect_ratio.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "shapeGeometry", |input| {
        input.shape_geometry.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "shapeGeometryId", |input| {
        input.shape_geometry_id.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "symbolDefinition", |input| {
        input.symbol_definition.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "symbolId", |input| input.symbol_id.is_none());
    assert_optional_field::<VisualInput>(&fixture, "emitPartIds", |input| {
        input.emit_part_ids.is_none()
    });
    assert_optional_field::<VisualInput>(&fixture, "partPaint", |input| input.part_paint.is_none());
    assert_optional_field::<VisualInput>(&fixture, "handlers", |input| input.handlers.is_none());
    let mut unknown = fixture;
    unknown["unknownOption"] = json!(true);
    assert!(serde_json::from_value::<VisualInput>(unknown).is_ok());
}

#[test]
fn inset_null_elements_remain_auto() {
    let style: TaffyStyleInput =
        serde_json::from_value(json!({"inset": [null, 0, null, 2]})).expect("nullable sides");
    assert_eq!(style.inset, Some([None, Some(0.0), None, Some(2.0)]));
    for inset in [
        json!([null]),
        json!([0, 0, 0]),
        json!([0, 0, 0, 0, 0]),
        json!([null, "auto", null, 0]),
    ] {
        assert!(serde_json::from_value::<TaffyStyleInput>(json!({"inset": inset})).is_err());
    }
}

#[test]
fn decoration_owner_vector_is_required_and_preserves_nullable_elements() {
    let fixture = json!({"spans": [], "decorationOwnerIds": [null, 0], "sourceItemCount": 0, "inlineCount": 0, "d": "M0 0 L100 0", "fontSizePx": 16});
    let input: TextPathInput =
        serde_json::from_value(fixture.clone()).expect("nullable owner slots");
    assert_eq!(input.decoration_owner_ids, vec![None, Some(0)]);
    let mut missing = fixture.clone();
    missing
        .as_object_mut()
        .expect("text path")
        .remove("decorationOwnerIds");
    assert!(serde_json::from_value::<TextPathInput>(missing).is_err());
    for owners in [
        json!([null, -1]),
        json!([0.5]),
        json!([4_294_967_296_u64]),
        json!(["0"]),
    ] {
        let mut invalid = fixture.clone();
        invalid["decorationOwnerIds"] = owners;
        assert!(serde_json::from_value::<TextPathInput>(invalid).is_err());
    }
    let mut maximum = fixture.clone();
    maximum["decorationOwnerIds"] = json!([null, u32::MAX]);
    assert_eq!(
        serde_json::from_value::<TextPathInput>(maximum)
            .expect("u32 owner codec")
            .decoration_owner_ids,
        vec![None, Some(u32::MAX)]
    );
    let mut explicit_null = fixture;
    explicit_null["decorationOwnerIds"] = json!(null);
    assert!(serde_json::from_value::<TextPathInput>(explicit_null).is_err());
}
