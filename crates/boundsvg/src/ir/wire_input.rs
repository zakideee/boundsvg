//! Consume-only IR projections and their conversion into rendering-domain values.

use serde::Deserialize;

use super::types::{
    AnimationEasing, AnimationIterations, AnimationKeyframe, AnimationSpec, AnimationSpring,
    AnimationSteps, AnimationTransform2D, BBox, BorderRadius, BoxShadow, Gradient, HandlersRef,
    IrFillRule, IrNode, IrNodeKind, IrTextAlign, ShapePartBounds, ShapePartPaint, ShapePathPart,
    StrokeLinecap, StrokeLinejoin, StrokeScaling, TextOutlinePath, TextPathMetadata,
    TextShadowLayer, TextStrokeLayer, TextUnitAnimation, TextUnitAnimationOrder,
    TextUnitAnimationSample,
};
use crate::font::shaping::GlyphInfo;
use crate::text::types::{Line, PositionedGlyph, TextRunStyle};

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "HandlersRef"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Decode handlers ref before constructing the domain value.
#[expect(
    clippy::struct_field_names,
    reason = "Field names match the event-handler wire contract."
)]
pub(crate) struct HandlersRefInput {
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    // Mouse actions
    pub on_click: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_double_click: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_context_menu: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    // Pointer events
    pub on_pointer_down: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_pointer_up: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_pointer_cancel: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_pointer_move: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_pointer_enter: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_pointer_leave: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_pointer_over: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_pointer_out: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    // Mouse events
    pub on_mouse_down: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_mouse_up: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_mouse_move: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_mouse_enter: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_mouse_leave: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_mouse_over: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_mouse_out: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    // Touch events
    pub on_touch_start: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_touch_end: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub on_touch_move: Option<String>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "TextOutlinePath"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Decode text outline path before constructing the domain value.
pub(crate) struct TextOutlinePathInput {
    // Identity and geometry
    pub node_id: String,
    pub d: String,
    pub fill: String,
    pub glyph_ids: Vec<u32>,
    pub text: String,
    pub bbox: BBox,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    // Source mapping
    pub unit_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "usize"))]
    pub source_start: Option<usize>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "usize"))]
    pub source_end: Option<usize>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub source_role: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "u32"))]
    pub paint_range_index: Option<u32>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "Vec<TextStrokeLayer>"))]
    // Text effects
    pub strokes: Option<Vec<TextStrokeLayer>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "Vec<TextShadowLayer>"))]
    pub shadows: Option<Vec<TextShadowLayer>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "bool"))]
    pub missing_glyph: Option<bool>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "ShapePartPaint"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Decode shape part paint before constructing the domain value.
pub(crate) struct ShapePartPaintInput {
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub fill: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub stroke: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub stroke_width: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub stroke_linecap: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub stroke_linejoin: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub stroke_dasharray: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub stroke_miterlimit: Option<f64>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "ShapePathPart"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Decode shape path part before constructing the domain value.
pub(crate) struct ShapePathPartInput {
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub part_id: Option<String>,
    pub d: String,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub stroke_d: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "ShapePartBounds"))]
    pub bounds: Option<ShapePartBounds>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "ShapePartPaintInput"))]
    pub paint: Option<ShapePartPaintInput>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "AnimationTransform2D"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Decode animation transform2d before constructing the domain value.
pub(crate) struct AnimationTransform2DInput {
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub translate_x: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub translate_y: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub scale_x: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub scale_y: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub rotate_deg: Option<f64>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "AnimationKeyframe"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Decode animation keyframe before constructing the domain value.
pub(crate) struct AnimationKeyframeInput {
    pub at: f64,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub opacity: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "AnimationTransform2DInput"))]
    pub transform: Option<AnimationTransform2DInput>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "AnimationSpring"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Decode animation spring before constructing the domain value.
pub(crate) struct AnimationSpringInput {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub stiffness: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub damping: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub mass: Option<f64>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "AnimationSteps"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Decode animation steps before constructing the domain value.
pub(crate) struct AnimationStepsInput {
    #[serde(rename = "type")]
    pub kind: String,
    pub count: f64,

    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub position: Option<String>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "AnimationSpec"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Decode animation spec before constructing the domain value.
pub(crate) struct AnimationSpecInput {
    pub keyframes: Vec<AnimationKeyframeInput>,
    pub duration_ms: f64,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub delay_ms: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "AnimationEasingInput"))]
    pub easing: Option<AnimationEasingInput>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "AnimationIterations"))]
    pub iterations: Option<AnimationIterations>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "String"))]
    pub fill: Option<String>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "TextUnitAnimation"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Decode text unit animation before constructing the domain value.
pub(crate) struct TextUnitAnimationInput {
    pub by: crate::text::unit_map::TextUnitKind,
    pub animation: AnimationSpecInput,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub delay_step_ms: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "TextUnitAnimationOrder"))]
    pub order: Option<TextUnitAnimationOrder>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(
        feature = "ir-schema",
        schemars(with = "crate::text::unit_map::TextUnitRubyMode")
    )]
    pub ruby: Option<crate::text::unit_map::TextUnitRubyMode>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "TextUnitAnimationSample"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Decode text unit animation sample before constructing the domain value.
pub(crate) struct TextUnitAnimationSampleInput {
    pub unit_id: String,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "BBox"))]
    pub bbox: Option<BBox>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "f64"))]
    pub opacity: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "boundshape::Transform2D"))]
    pub transform: Option<boundshape::Transform2D>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "IrNode"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Decode ir node before constructing the domain value.
pub(crate) struct IrNodeInput {
    pub node_id: String,
    pub bbox: BBox,
    #[serde(flatten)]
    pub kind: IrNodeKindInput,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "AnimationEasing"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
/// Decode animation easing before constructing the domain value.
pub(crate) enum AnimationEasingInput {
    Named(String),
    CubicBezier([f64; 4]),
    Spring(AnimationSpringInput),
    Steps(AnimationStepsInput),
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "IrNodeKind"))]
#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
/// Decode ir node kind before constructing the domain value.
pub(crate) enum IrNodeKindInput {
    Group {
        #[serde(default)]
        children: Vec<IrNodeInput>,
        clip_path: Option<BBox>,
        clip_border_radius: Option<BorderRadius>,
        opacity: Option<f64>,
        box_shadow: Option<BoxShadow>,
        meta: Option<std::collections::BTreeMap<String, String>>,
        transform: Option<boundshape::Transform2D>,
        animation: Option<AnimationSpecInput>,
        on: Option<Box<HandlersRefInput>>,
    },

    Rect {
        fill: Option<String>,
        gradient: Option<Gradient>,
        stroke: Option<String>,
        stroke_width: Option<f64>,
        stroke_scaling: Option<StrokeScaling>,
        border_radius: Option<BorderRadius>,
        stroke_linecap: Option<StrokeLinecap>,
        stroke_linejoin: Option<StrokeLinejoin>,
        stroke_dasharray: Option<String>,
        stroke_miterlimit: Option<f64>,
    },

    Text {
        lines: Vec<LineWire>,
        font: String,
        font_fallback: Option<Vec<String>>,
        font_size_px: f64,
        font_weight: Option<u16>,
        font_style: Option<String>,
        letter_spacing_px: Option<f64>,
        font_variation_settings: Option<String>,
        font_feature_settings: Option<String>,
        color: String,
        text_align: IrTextAlign,
        layout_box: BBox,
        writing_mode: Option<String>,
        language: Option<String>,
        line_height_px: f64,
        text_layout_kind: Option<String>,
        source_text: Option<String>,
        display_text: Option<String>,
        text_path: Option<Box<TextPathMetadata>>,
        glyph_paths: Option<Vec<TextOutlinePathInput>>,
        unit_map: Option<crate::text::unit_map::TextUnitMap>,
        unit_animation: Option<TextUnitAnimationInput>,
        unit_animation_samples: Option<Vec<TextUnitAnimationSampleInput>>,
        stroke: Option<String>,
        stroke_width: Option<f64>,
        stroke_linecap: Option<StrokeLinecap>,
        stroke_linejoin: Option<StrokeLinejoin>,
        stroke_dasharray: Option<String>,
        stroke_miterlimit: Option<f64>,
        strokes: Option<Vec<TextStrokeLayer>>,
        shadows: Option<Vec<TextShadowLayer>>,
        text_decorations: Option<Vec<crate::text::types::TextDecorationFragment>>,
        on: Option<Box<HandlersRefInput>>,
    },

    Image {
        src: String,
        preserve_aspect_ratio: String,
        on: Option<HandlersRefInput>,
    },

    Path {
        path_data: String,
        fill: Option<String>,
        stroke: Option<String>,
        stroke_width: Option<f64>,
        stroke_scaling: Option<StrokeScaling>,
        fill_rule: Option<IrFillRule>,
        stroke_linecap: Option<StrokeLinecap>,
        stroke_linejoin: Option<StrokeLinejoin>,
        stroke_dasharray: Option<String>,
        stroke_miterlimit: Option<f64>,
        on: Option<HandlersRefInput>,
    },

    Svg {
        #[serde(rename = "svgContent")]
        content: String,
        #[serde(rename = "svgViewBox")]
        view_box: Option<String>,
        preserve_aspect_ratio: String,
        on: Option<HandlersRefInput>,
    },

    Shape {
        shape_parts: Vec<ShapePathPartInput>,
        fill: Option<String>,
        stroke: Option<String>,
        stroke_width: Option<f64>,
        fill_rule: Option<IrFillRule>,
        stroke_linecap: Option<StrokeLinecap>,
        stroke_linejoin: Option<StrokeLinejoin>,
        stroke_dasharray: Option<String>,
        stroke_miterlimit: Option<f64>,
        on: Option<HandlersRefInput>,
    },
}

// ---------------------------------------------------------------------------
// Domain conversions
// ---------------------------------------------------------------------------

impl From<HandlersRefInput> for HandlersRef {
    fn from(input: HandlersRefInput) -> Self {
        Self {
            on_click: input.on_click,
            on_double_click: input.on_double_click,
            on_context_menu: input.on_context_menu,
            on_pointer_down: input.on_pointer_down,
            on_pointer_up: input.on_pointer_up,
            on_pointer_cancel: input.on_pointer_cancel,
            on_pointer_move: input.on_pointer_move,
            on_pointer_enter: input.on_pointer_enter,
            on_pointer_leave: input.on_pointer_leave,
            on_pointer_over: input.on_pointer_over,
            on_pointer_out: input.on_pointer_out,
            on_mouse_down: input.on_mouse_down,
            on_mouse_up: input.on_mouse_up,
            on_mouse_move: input.on_mouse_move,
            on_mouse_enter: input.on_mouse_enter,
            on_mouse_leave: input.on_mouse_leave,
            on_mouse_over: input.on_mouse_over,
            on_mouse_out: input.on_mouse_out,
            on_touch_start: input.on_touch_start,
            on_touch_end: input.on_touch_end,
            on_touch_move: input.on_touch_move,
        }
    }
}

impl From<TextOutlinePathInput> for TextOutlinePath {
    fn from(input: TextOutlinePathInput) -> Self {
        Self {
            node_id: input.node_id,
            d: input.d,
            fill: input.fill,
            glyph_ids: input.glyph_ids,
            text: input.text,
            bbox: input.bbox,
            unit_id: input.unit_id,
            source_start: input.source_start,
            source_end: input.source_end,
            source_role: input.source_role,
            paint_range_index: input.paint_range_index,
            strokes: input.strokes,
            shadows: input.shadows,
            missing_glyph: input.missing_glyph,
        }
    }
}

impl From<ShapePartPaintInput> for ShapePartPaint {
    fn from(input: ShapePartPaintInput) -> Self {
        Self {
            fill: input.fill,
            stroke: input.stroke,
            stroke_width: input.stroke_width,
            stroke_linecap: input.stroke_linecap,
            stroke_linejoin: input.stroke_linejoin,
            stroke_dasharray: input.stroke_dasharray,
            stroke_miterlimit: input.stroke_miterlimit,
        }
    }
}

impl From<ShapePathPartInput> for ShapePathPart {
    fn from(input: ShapePathPartInput) -> Self {
        Self {
            part_id: input.part_id,
            d: input.d,
            stroke_d: input.stroke_d,
            bounds: input.bounds,
            paint: input.paint.map(std::convert::Into::into),
        }
    }
}

impl From<AnimationTransform2DInput> for AnimationTransform2D {
    fn from(input: AnimationTransform2DInput) -> Self {
        Self {
            translate_x: input.translate_x,
            translate_y: input.translate_y,
            scale_x: input.scale_x,
            scale_y: input.scale_y,
            rotate_deg: input.rotate_deg,
        }
    }
}

impl From<AnimationKeyframeInput> for AnimationKeyframe {
    fn from(input: AnimationKeyframeInput) -> Self {
        Self {
            at: input.at,
            opacity: input.opacity,
            transform: input.transform.map(std::convert::Into::into),
        }
    }
}

impl From<AnimationSpringInput> for AnimationSpring {
    fn from(input: AnimationSpringInput) -> Self {
        Self {
            kind: input.kind,
            stiffness: input.stiffness,
            damping: input.damping,
            mass: input.mass,
        }
    }
}

impl From<AnimationStepsInput> for AnimationSteps {
    fn from(input: AnimationStepsInput) -> Self {
        Self {
            kind: input.kind,
            count: input.count,
            position: input.position,
        }
    }
}

impl From<AnimationSpecInput> for AnimationSpec {
    fn from(input: AnimationSpecInput) -> Self {
        Self {
            keyframes: input
                .keyframes
                .into_iter()
                .map(std::convert::Into::into)
                .collect(),
            duration_ms: input.duration_ms,
            delay_ms: input.delay_ms,
            easing: input.easing.map(std::convert::Into::into),
            iterations: input.iterations,
            fill: input.fill,
        }
    }
}

impl From<TextUnitAnimationInput> for TextUnitAnimation {
    fn from(input: TextUnitAnimationInput) -> Self {
        Self {
            by: input.by,
            animation: input.animation.into(),
            delay_step_ms: input.delay_step_ms,
            order: input.order,
            ruby: input.ruby,
        }
    }
}

impl From<TextUnitAnimationSampleInput> for TextUnitAnimationSample {
    fn from(input: TextUnitAnimationSampleInput) -> Self {
        Self {
            unit_id: input.unit_id,
            bbox: input.bbox,
            opacity: input.opacity,
            transform: input.transform,
        }
    }
}

impl From<IrNodeInput> for IrNode {
    fn from(input: IrNodeInput) -> Self {
        Self {
            node_id: input.node_id,
            bbox: input.bbox,
            kind: input.kind.into(),
        }
    }
}

impl From<AnimationEasingInput> for AnimationEasing {
    fn from(input: AnimationEasingInput) -> Self {
        match input {
            AnimationEasingInput::Named(name) => Self::Named(name),
            AnimationEasingInput::CubicBezier(points) => Self::CubicBezier(points),
            AnimationEasingInput::Spring(spring) => Self::Spring(spring.into()),
            AnimationEasingInput::Steps(steps) => Self::Steps(steps.into()),
        }
    }
}

impl From<IrNodeKindInput> for IrNodeKind {
    fn from(input: IrNodeKindInput) -> Self {
        match input {
            IrNodeKindInput::Group {
                children,
                clip_path,
                clip_border_radius,
                opacity,
                box_shadow,
                meta,
                transform,
                animation,
                on,
            } => Self::Group {
                children: children.into_iter().map(std::convert::Into::into).collect(),
                clip_path,
                clip_border_radius,
                opacity,
                box_shadow,
                meta,
                transform,
                animation: animation.map(std::convert::Into::into),
                on: on.map(|field| Box::new((*field).into())),
            },
            IrNodeKindInput::Rect {
                fill,
                gradient,
                stroke,
                stroke_width,
                stroke_scaling,
                border_radius,
                stroke_linecap,
                stroke_linejoin,
                stroke_dasharray,
                stroke_miterlimit,
            } => Self::Rect {
                fill,
                gradient,
                stroke,
                stroke_width,
                stroke_scaling,
                border_radius,
                stroke_linecap,
                stroke_linejoin,
                stroke_dasharray,
                stroke_miterlimit,
            },
            IrNodeKindInput::Text {
                lines,
                font,
                font_fallback,
                font_size_px,
                font_weight,
                font_style,
                letter_spacing_px,
                font_variation_settings,
                font_feature_settings,
                color,
                text_align,
                layout_box,
                writing_mode,
                language,
                line_height_px,
                text_layout_kind,
                source_text,
                display_text,
                text_path,
                glyph_paths,
                unit_map,
                unit_animation,
                unit_animation_samples,
                stroke,
                stroke_width,
                stroke_linecap,
                stroke_linejoin,
                stroke_dasharray,
                stroke_miterlimit,
                strokes,
                shadows,
                text_decorations,
                on,
            } => Self::Text {
                lines: lines.into_iter().map(Line::from).collect(),
                font,
                font_fallback,
                font_size_px,
                font_weight,
                font_style,
                letter_spacing_px,
                font_variation_settings,
                font_feature_settings,
                color,
                text_align,
                layout_box,
                writing_mode,
                language,
                line_height_px,
                text_layout_kind,
                source_text,
                display_text,
                text_path,
                glyph_paths: glyph_paths
                    .map(|field| field.into_iter().map(std::convert::Into::into).collect()),
                unit_map,
                unit_animation: unit_animation.map(std::convert::Into::into),
                unit_animation_samples: unit_animation_samples
                    .map(|field| field.into_iter().map(std::convert::Into::into).collect()),
                stroke,
                stroke_width,
                stroke_linecap,
                stroke_linejoin,
                stroke_dasharray,
                stroke_miterlimit,
                strokes,
                shadows,
                text_decorations,
                on: on.map(|field| Box::new((*field).into())),
            },
            IrNodeKindInput::Image {
                src,
                preserve_aspect_ratio,
                on,
            } => Self::Image {
                src,
                preserve_aspect_ratio,
                on: on.map(std::convert::Into::into),
            },
            IrNodeKindInput::Path {
                path_data,
                fill,
                stroke,
                stroke_width,
                stroke_scaling,
                fill_rule,
                stroke_linecap,
                stroke_linejoin,
                stroke_dasharray,
                stroke_miterlimit,
                on,
            } => Self::Path {
                path_data,
                fill,
                stroke,
                stroke_width,
                stroke_scaling,
                fill_rule,
                stroke_linecap,
                stroke_linejoin,
                stroke_dasharray,
                stroke_miterlimit,
                on: on.map(std::convert::Into::into),
            },
            IrNodeKindInput::Svg {
                content,
                view_box,
                preserve_aspect_ratio,
                on,
            } => Self::Svg {
                content,
                view_box,
                preserve_aspect_ratio,
                on: on.map(std::convert::Into::into),
            },
            IrNodeKindInput::Shape {
                shape_parts,
                fill,
                stroke,
                stroke_width,
                fill_rule,
                stroke_linecap,
                stroke_linejoin,
                stroke_dasharray,
                stroke_miterlimit,
                on,
            } => Self::Shape {
                shape_parts: shape_parts
                    .into_iter()
                    .map(std::convert::Into::into)
                    .collect(),
                fill,
                stroke,
                stroke_width,
                fill_rule,
                stroke_linecap,
                stroke_linejoin,
                stroke_dasharray,
                stroke_miterlimit,
                on: on.map(std::convert::Into::into),
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Projected text lines
// ---------------------------------------------------------------------------

/// Fragment input accepts absent style because colorless styles are omitted on output.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LineFragmentWire {
    pub(super) text: String,
    pub(super) glyphs: Vec<GlyphInfo>,
    pub(super) width: f64,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "TextRunStyle"))]
    pub(super) style: Option<TextRunStyle>,
}

/// Consume projection for the public text-line wire shape.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LineWire {
    pub(super) text: String,
    pub(super) glyphs: Vec<GlyphInfo>,
    pub(super) width: f64,
    pub(super) baseline_y: f64,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "Vec<LineFragmentWire>"))]
    pub(super) fragments: Option<Vec<LineFragmentWire>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    #[cfg_attr(feature = "ir-schema", schemars(with = "Vec<PositionedGlyph>"))]
    pub(super) positioned_glyphs: Option<Vec<PositionedGlyph>>,
}

impl From<LineWire> for Line {
    fn from(input: LineWire) -> Self {
        Self {
            text: input.text,
            glyphs: input.glyphs,
            width: input.width,
            baseline_y: input.baseline_y,
            fragments: input.fragments.map(|fragments| {
                fragments
                    .into_iter()
                    .map(|fragment| crate::text::types::LineFragment {
                        text: fragment.text,
                        glyphs: fragment.glyphs,
                        width: fragment.width,
                        style: fragment.style.unwrap_or_else(placeholder_style),
                    })
                    .collect()
            }),
            positioned_glyphs: input.positioned_glyphs,
        }
    }
}

fn placeholder_style() -> TextRunStyle {
    TextRunStyle {
        font: String::new(),
        fallback: Vec::new(),
        font_weight: 400,
        font_style: crate::font::FontStyle::Normal,
        font_size_px: 0.0,
        letter_spacing_px: 0.0,
        text_orientation: None,
        font_variation_settings: None,
        font_feature_settings: None,
        color: None,
        text_strokes: None,
        text_shadows: None,
        language: None,
    }
}

/// Decode the optional authoring value and immediately discard its wire representation.
///
/// # Errors
///
/// Returns the input DTO decode error, including rejection of present null.
pub(crate) fn deserialize_optional_animation<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<AnimationSpec>, D::Error> {
    AnimationSpecInput::deserialize(deserializer).map(|input| Some(input.into()))
}

/// Decode the optional authoring value and immediately discard its wire representation.
///
/// # Errors
///
/// Returns the input DTO decode error, including rejection of present null.
pub(crate) fn deserialize_optional_unit_animation<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<TextUnitAnimation>, D::Error> {
    TextUnitAnimationInput::deserialize(deserializer).map(|input| Some(input.into()))
}

/// Decode the optional authoring value and immediately discard its wire representation.
///
/// # Errors
///
/// Returns the input DTO decode error, including rejection of present null.
pub(crate) fn deserialize_optional_easing<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<AnimationEasing>, D::Error> {
    AnimationEasingInput::deserialize(deserializer).map(|input| Some(input.into()))
}

/// Decode inline animation entries without carrying transport types into IR construction.
///
/// # Errors
///
/// Returns the map or animation input decode failure.
pub(crate) fn deserialize_optional_animation_map<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<std::collections::BTreeMap<String, AnimationSpec>>, D::Error> {
    std::collections::BTreeMap::<String, AnimationSpecInput>::deserialize(deserializer).map(
        |entries| {
            Some(
                entries
                    .into_iter()
                    .map(|(key, animation)| (key, animation.into()))
                    .collect(),
            )
        },
    )
}
