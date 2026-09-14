//! Borrowed produce-only projections for rendering-domain IR values.

use serde::{Serialize, Serializer};

use super::types::{
    AnimationEasing, AnimationIterations, AnimationKeyframe, AnimationSpec, AnimationSpring,
    AnimationSteps, AnimationTransform2D, BBox, BorderRadius, BoxShadow, Gradient, HandlersRef,
    IrFillRule, IrNode, IrNodeKind, IrTextAlign, ShapePartBounds, ShapePartPaint, ShapePathPart,
    StrokeLinecap, StrokeLinejoin, StrokeScaling, TextOutlinePath, TextPathMetadata,
    TextShadowLayer, TextStrokeLayer, TextUnitAnimation, TextUnitAnimationOrder,
    TextUnitAnimationSample,
};
#[cfg(feature = "ir-schema")]
use super::types::{
    AnimationFillSchema, AnimationSpringKindSchema, AnimationStepPositionSchema,
    AnimationStepsKindSchema, NamedAnimationEasingSchema, TextLayoutKindSchema,
};
use crate::font::shaping::GlyphInfo;
use crate::text::types::{Line, PositionedGlyph, TextRunStyle};

/// Event handler references (string identifiers for hit testing).
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "HandlersRef"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[expect(
    clippy::struct_field_names,
    reason = "Field names match the event-handler wire contract."
)]
pub(crate) struct HandlersRefOutput<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    // Mouse actions
    pub on_click: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_double_click: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_context_menu: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    // Pointer events
    pub on_pointer_down: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_up: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_cancel: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_move: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_enter: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_leave: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_over: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_out: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    // Mouse events
    pub on_mouse_down: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mouse_up: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mouse_move: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mouse_enter: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mouse_leave: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mouse_over: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mouse_out: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    // Touch events
    pub on_touch_start: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_touch_end: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_touch_move: Option<&'a str>,
}

/// A text run resolved to glyph outline paths.
/// Mirrors TS `TextOutlinePath` (`packages/core/src/text/types.ts`).
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "TextOutlinePath"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextOutlinePathOutput<'a> {
    // Identity and geometry
    pub node_id: &'a str,
    pub d: &'a str,
    pub fill: &'a str,
    pub glyph_ids: &'a [u32],
    pub text: &'a str,
    pub bbox: &'a BBox,
    #[serde(skip_serializing_if = "Option::is_none")]
    // Source mapping
    pub unit_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_start: Option<&'a usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_end: Option<&'a usize>,
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "Option<boundtext::schema::DirectionalSchema<crate::text::unit_map::TextUnitSourceRole, String>>"
        )
    )]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_role: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paint_range_index: Option<&'a u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    // Text effects
    pub strokes: Option<&'a [TextStrokeLayer]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadows: Option<&'a [TextShadowLayer]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_glyph: Option<&'a bool>,
}

/// Per-part paint override; unset fields inherit the node paint.
/// Mirrors the `paint` member of TS `ShapePathPart`.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "ShapePartPaint"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShapePartPaintOutput<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<&'a f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_linecap: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_linejoin: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_dasharray: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_miterlimit: Option<&'a f64>,
}

/// One baked part of a shape IR node. Mirrors TS `ShapePathPart`.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "ShapePathPart"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShapePathPartOutput<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part_id: Option<&'a str>,
    pub d: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_d: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<&'a ShapePartBounds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paint: Option<ShapePartPaintOutput<'a>>,
}

/// Transform channels allowed in animation keyframes. Animation origins are
/// fixed to the logical node center and are therefore intentionally absent.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "AnimationTransform2D"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnimationTransform2DOutput<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translate_x: Option<&'a f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translate_y: Option<&'a f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_x: Option<&'a f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_y: Option<&'a f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotate_deg: Option<&'a f64>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "AnimationKeyframe"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnimationKeyframeOutput<'a> {
    pub at: &'a f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<&'a f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<AnimationTransform2DOutput<'a>>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "AnimationSpring"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnimationSpringOutput<'a> {
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "boundtext::schema::DirectionalSchema<boundtext::schema::StringEnumSchema<AnimationSpringKindSchema>, String>"
        )
    )]
    #[serde(rename = "type")]
    pub kind: &'a str,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stiffness: Option<&'a f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damping: Option<&'a f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mass: Option<&'a f64>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "AnimationSteps"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnimationStepsOutput<'a> {
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "boundtext::schema::DirectionalSchema<boundtext::schema::StringEnumSchema<AnimationStepsKindSchema>, String>"
        )
    )]
    #[serde(rename = "type")]
    pub kind: &'a str,
    pub count: &'a f64,
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "boundtext::schema::DirectionalSchema<boundtext::schema::StringEnumSchema<AnimationStepPositionSchema>, String>"
        )
    )]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<&'a str>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "AnimationSpec"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnimationSpecOutput<'a> {
    pub keyframes: Vec<AnimationKeyframeOutput<'a>>,
    pub duration_ms: &'a f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_ms: Option<&'a f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub easing: Option<AnimationEasingOutput<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iterations: Option<&'a AnimationIterations>,
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "Option<boundtext::schema::DirectionalSchema<boundtext::schema::StringEnumSchema<AnimationFillSchema>, String>>"
        )
    )]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<&'a str>,
}

/// Raw text paint-unit animation semantic retained after sampling.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "TextUnitAnimation"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextUnitAnimationOutput<'a> {
    pub by: &'a crate::text::unit_map::TextUnitKind,
    pub animation: AnimationSpecOutput<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_step_ms: Option<&'a f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<&'a TextUnitAnimationOrder>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ruby: Option<&'a crate::text::unit_map::TextUnitRubyMode>,
}

/// Actual outline bounds and sampled pose for one text paint unit.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "TextUnitAnimationSample"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextUnitAnimationSampleOutput<'a> {
    pub unit_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bbox: Option<&'a BBox>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<&'a f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<&'a boundshape::Transform2D>,
}

/// An IR node in the rendering tree.
/// Serializes flat (kind fields inline next to `nodeId`/`bbox`, plus a
/// `type` discriminant) to match the TS `IRNode` shape.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "IrNode"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IrNodeOutput<'a> {
    pub node_id: &'a str,
    pub bbox: &'a BBox,
    #[serde(flatten)]
    pub kind: IrNodeKindOutput<'a>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "AnimationEasing"))]
#[derive(Serialize)]
#[serde(untagged)]
pub(crate) enum AnimationEasingOutput<'a> {
    Named(
        #[cfg_attr(
            feature = "ir-schema",
            schemars(
                with = "boundtext::schema::DirectionalSchema<boundtext::schema::StringEnumSchema<NamedAnimationEasingSchema>, String>"
            )
        )]
        &'a str,
    ),
    CubicBezier(&'a [f64; 4]),
    Spring(AnimationSpringOutput<'a>),
    Steps(AnimationStepsOutput<'a>),
}

/// The type-specific payload of an IR node.
///
/// Large event-handler tables on container and text nodes are boxed so the
/// common enum value stays compact without adding indirection to paint data.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "ir-schema", schemars(rename = "IrNodeKind"))]
#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
#[expect(
    clippy::large_enum_variant,
    reason = "Borrowed output projections avoid a separate allocation for every node variant."
)]
pub(crate) enum IrNodeKindOutput<'a> {
    /// Container group (may clip children).
    Group {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        children: Vec<IrNodeOutput<'a>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        clip_path: Option<&'a BBox>,
        #[serde(skip_serializing_if = "Option::is_none")]
        clip_border_radius: Option<&'a BorderRadius>,
        #[serde(skip_serializing_if = "Option::is_none")]
        opacity: Option<&'a f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        box_shadow: Option<&'a BoxShadow>,
        #[serde(skip_serializing_if = "Option::is_none")]
        meta: Option<&'a std::collections::BTreeMap<String, String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        transform: Option<&'a boundshape::Transform2D>,
        #[serde(skip_serializing_if = "Option::is_none")]
        animation: Option<AnimationSpecOutput<'a>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on: Option<HandlersRefOutput<'a>>,
    },

    /// Filled/stroked rectangle.
    Rect {
        #[serde(skip_serializing_if = "Option::is_none")]
        fill: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        gradient: Option<&'a Gradient>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_width: Option<&'a f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_scaling: Option<&'a StrokeScaling>,
        #[serde(skip_serializing_if = "Option::is_none")]
        border_radius: Option<&'a BorderRadius>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linecap: Option<&'a StrokeLinecap>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linejoin: Option<&'a StrokeLinejoin>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_dasharray: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_miterlimit: Option<&'a f64>,
    },

    /// Text node with line-broken content.
    Text {
        #[cfg_attr(feature = "ir-schema", schemars(schema_with = "lines_schema"))]
        #[serde(
            serialize_with = "serialize_lines_ts_projection",
            deserialize_with = "deserialize_lines_ts_projection"
        )]
        lines: &'a [Line],
        font: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        font_fallback: Option<&'a [String]>,
        font_size_px: &'a f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        font_weight: Option<&'a u16>,
        #[cfg_attr(
            feature = "ir-schema",
            schemars(
                with = "Option<boundtext::schema::DirectionalSchema<crate::font::FontStyle, String>>"
            )
        )]
        #[serde(skip_serializing_if = "Option::is_none")]
        font_style: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        letter_spacing_px: Option<&'a f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        font_variation_settings: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        font_feature_settings: Option<&'a str>,
        color: &'a str,
        text_align: &'a IrTextAlign,
        /// Allotted text layout box; `bbox` is the aligned measured block.
        layout_box: &'a BBox,
        #[cfg_attr(
            feature = "ir-schema",
            schemars(
                with = "Option<boundtext::schema::DirectionalSchema<crate::text::types::WritingMode, String>>"
            )
        )]
        #[serde(skip_serializing_if = "Option::is_none")]
        writing_mode: Option<&'a str>,
        #[cfg_attr(
            feature = "ir-schema",
            schemars(
                with = "Option<boundtext::schema::DirectionalSchema<crate::text::types::Language, String>>"
            )
        )]
        #[serde(skip_serializing_if = "Option::is_none")]
        language: Option<&'a str>,
        line_height_px: &'a f64,
        #[cfg_attr(
            feature = "ir-schema",
            schemars(
                with = "Option<boundtext::schema::DirectionalSchema<boundtext::schema::StringEnumSchema<TextLayoutKindSchema>, String>>"
            )
        )]
        #[serde(skip_serializing_if = "Option::is_none")]
        text_layout_kind: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        source_text: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        display_text: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text_path: Option<&'a TextPathMetadata>,
        #[serde(skip_serializing_if = "Option::is_none")]
        glyph_paths: Option<Vec<TextOutlinePathOutput<'a>>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        /// Stable paint-unit metadata generated by boundtext for opt-in text.
        unit_map: Option<&'a crate::text::unit_map::TextUnitMap>,
        #[serde(skip_serializing_if = "Option::is_none")]
        /// Raw unit animation semantic retained across frame sampling.
        unit_animation: Option<TextUnitAnimationOutput<'a>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        /// Per-unit actual outline bounds and sampled pose.
        unit_animation_samples: Option<Vec<TextUnitAnimationSampleOutput<'a>>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_width: Option<&'a f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linecap: Option<&'a StrokeLinecap>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linejoin: Option<&'a StrokeLinejoin>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_dasharray: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_miterlimit: Option<&'a f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        strokes: Option<&'a [TextStrokeLayer]>,
        #[serde(skip_serializing_if = "Option::is_none")]
        shadows: Option<&'a [TextShadowLayer]>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text_decorations: Option<&'a [crate::text::types::TextDecorationFragment]>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on: Option<HandlersRefOutput<'a>>,
    },

    /// Raster image (base64 data URI).
    Image {
        src: &'a str,
        preserve_aspect_ratio: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        on: Option<HandlersRefOutput<'a>>,
    },

    /// SVG path element.
    Path {
        path_data: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        fill: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_width: Option<&'a f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_scaling: Option<&'a StrokeScaling>,
        #[serde(skip_serializing_if = "Option::is_none")]
        fill_rule: Option<&'a IrFillRule>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linecap: Option<&'a StrokeLinecap>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linejoin: Option<&'a StrokeLinejoin>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_dasharray: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_miterlimit: Option<&'a f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on: Option<HandlersRefOutput<'a>>,
    },

    /// Nested SVG content.
    Svg {
        #[serde(rename = "svgContent")]
        content: &'a str,
        #[serde(rename = "svgViewBox", skip_serializing_if = "Option::is_none")]
        view_box: Option<&'a str>,
        preserve_aspect_ratio: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        on: Option<HandlersRefOutput<'a>>,
    },

    /// Structural shape with viewport-baked part paths.
    Shape {
        shape_parts: Vec<ShapePathPartOutput<'a>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        fill: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_width: Option<&'a f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        fill_rule: Option<&'a IrFillRule>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linecap: Option<&'a StrokeLinecap>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linejoin: Option<&'a StrokeLinejoin>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_dasharray: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_miterlimit: Option<&'a f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on: Option<HandlersRefOutput<'a>>,
    },
}

// ---------------------------------------------------------------------------
// Borrowed domain conversions
// ---------------------------------------------------------------------------

impl<'a> From<&'a HandlersRef> for HandlersRefOutput<'a> {
    fn from(input: &'a HandlersRef) -> Self {
        Self {
            on_click: input.on_click.as_deref(),
            on_double_click: input.on_double_click.as_deref(),
            on_context_menu: input.on_context_menu.as_deref(),
            on_pointer_down: input.on_pointer_down.as_deref(),
            on_pointer_up: input.on_pointer_up.as_deref(),
            on_pointer_cancel: input.on_pointer_cancel.as_deref(),
            on_pointer_move: input.on_pointer_move.as_deref(),
            on_pointer_enter: input.on_pointer_enter.as_deref(),
            on_pointer_leave: input.on_pointer_leave.as_deref(),
            on_pointer_over: input.on_pointer_over.as_deref(),
            on_pointer_out: input.on_pointer_out.as_deref(),
            on_mouse_down: input.on_mouse_down.as_deref(),
            on_mouse_up: input.on_mouse_up.as_deref(),
            on_mouse_move: input.on_mouse_move.as_deref(),
            on_mouse_enter: input.on_mouse_enter.as_deref(),
            on_mouse_leave: input.on_mouse_leave.as_deref(),
            on_mouse_over: input.on_mouse_over.as_deref(),
            on_mouse_out: input.on_mouse_out.as_deref(),
            on_touch_start: input.on_touch_start.as_deref(),
            on_touch_end: input.on_touch_end.as_deref(),
            on_touch_move: input.on_touch_move.as_deref(),
        }
    }
}

impl<'a> From<&'a TextOutlinePath> for TextOutlinePathOutput<'a> {
    fn from(input: &'a TextOutlinePath) -> Self {
        Self {
            node_id: input.node_id.as_str(),
            d: input.d.as_str(),
            fill: input.fill.as_str(),
            glyph_ids: input.glyph_ids.as_slice(),
            text: input.text.as_str(),
            bbox: &input.bbox,
            unit_id: input.unit_id.as_deref(),
            source_start: input.source_start.as_ref(),
            source_end: input.source_end.as_ref(),
            source_role: input.source_role.as_deref(),
            paint_range_index: input.paint_range_index.as_ref(),
            strokes: input.strokes.as_deref(),
            shadows: input.shadows.as_deref(),
            missing_glyph: input.missing_glyph.as_ref(),
        }
    }
}

impl<'a> From<&'a ShapePartPaint> for ShapePartPaintOutput<'a> {
    fn from(input: &'a ShapePartPaint) -> Self {
        Self {
            fill: input.fill.as_deref(),
            stroke: input.stroke.as_deref(),
            stroke_width: input.stroke_width.as_ref(),
            stroke_linecap: input.stroke_linecap.as_deref(),
            stroke_linejoin: input.stroke_linejoin.as_deref(),
            stroke_dasharray: input.stroke_dasharray.as_deref(),
            stroke_miterlimit: input.stroke_miterlimit.as_ref(),
        }
    }
}

impl<'a> From<&'a ShapePathPart> for ShapePathPartOutput<'a> {
    fn from(input: &'a ShapePathPart) -> Self {
        Self {
            part_id: input.part_id.as_deref(),
            d: input.d.as_str(),
            stroke_d: input.stroke_d.as_deref(),
            bounds: input.bounds.as_ref(),
            paint: input.paint.as_ref().map(ShapePartPaintOutput::from),
        }
    }
}

impl<'a> From<&'a AnimationTransform2D> for AnimationTransform2DOutput<'a> {
    fn from(input: &'a AnimationTransform2D) -> Self {
        Self {
            translate_x: input.translate_x.as_ref(),
            translate_y: input.translate_y.as_ref(),
            scale_x: input.scale_x.as_ref(),
            scale_y: input.scale_y.as_ref(),
            rotate_deg: input.rotate_deg.as_ref(),
        }
    }
}

impl<'a> From<&'a AnimationKeyframe> for AnimationKeyframeOutput<'a> {
    fn from(input: &'a AnimationKeyframe) -> Self {
        Self {
            at: &input.at,
            opacity: input.opacity.as_ref(),
            transform: input
                .transform
                .as_ref()
                .map(AnimationTransform2DOutput::from),
        }
    }
}

impl<'a> From<&'a AnimationSpring> for AnimationSpringOutput<'a> {
    fn from(input: &'a AnimationSpring) -> Self {
        Self {
            kind: input.kind.as_str(),
            stiffness: input.stiffness.as_ref(),
            damping: input.damping.as_ref(),
            mass: input.mass.as_ref(),
        }
    }
}

impl<'a> From<&'a AnimationSteps> for AnimationStepsOutput<'a> {
    fn from(input: &'a AnimationSteps) -> Self {
        Self {
            kind: input.kind.as_str(),
            count: &input.count,
            position: input.position.as_deref(),
        }
    }
}

impl<'a> From<&'a AnimationSpec> for AnimationSpecOutput<'a> {
    fn from(input: &'a AnimationSpec) -> Self {
        Self {
            keyframes: input
                .keyframes
                .iter()
                .map(AnimationKeyframeOutput::from)
                .collect(),
            duration_ms: &input.duration_ms,
            delay_ms: input.delay_ms.as_ref(),
            easing: input.easing.as_ref().map(AnimationEasingOutput::from),
            iterations: input.iterations.as_ref(),
            fill: input.fill.as_deref(),
        }
    }
}

impl<'a> From<&'a TextUnitAnimation> for TextUnitAnimationOutput<'a> {
    fn from(input: &'a TextUnitAnimation) -> Self {
        Self {
            by: &input.by,
            animation: AnimationSpecOutput::from(&input.animation),
            delay_step_ms: input.delay_step_ms.as_ref(),
            order: input.order.as_ref(),
            ruby: input.ruby.as_ref(),
        }
    }
}

impl<'a> From<&'a TextUnitAnimationSample> for TextUnitAnimationSampleOutput<'a> {
    fn from(input: &'a TextUnitAnimationSample) -> Self {
        Self {
            unit_id: input.unit_id.as_str(),
            bbox: input.bbox.as_ref(),
            opacity: input.opacity.as_ref(),
            transform: input.transform.as_ref(),
        }
    }
}

impl<'a> From<&'a IrNode> for IrNodeOutput<'a> {
    fn from(input: &'a IrNode) -> Self {
        Self {
            node_id: input.node_id.as_str(),
            bbox: &input.bbox,
            kind: IrNodeKindOutput::from(&input.kind),
        }
    }
}

impl<'a> From<&'a AnimationEasing> for AnimationEasingOutput<'a> {
    fn from(input: &'a AnimationEasing) -> Self {
        match input {
            AnimationEasing::Named(name) => Self::Named(name),
            AnimationEasing::CubicBezier(points) => Self::CubicBezier(points),
            AnimationEasing::Spring(spring) => Self::Spring(spring.into()),
            AnimationEasing::Steps(steps) => Self::Steps(steps.into()),
        }
    }
}

impl<'a> From<&'a IrNodeKind> for IrNodeKindOutput<'a> {
    fn from(input: &'a IrNodeKind) -> Self {
        match input {
            IrNodeKind::Group {
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
                children: children.iter().map(IrNodeOutput::from).collect(),
                clip_path: clip_path.as_ref(),
                clip_border_radius: clip_border_radius.as_ref(),
                opacity: opacity.as_ref(),
                box_shadow: box_shadow.as_ref(),
                meta: meta.as_ref(),
                transform: transform.as_ref(),
                animation: animation.as_ref().map(AnimationSpecOutput::from),
                on: on
                    .as_ref()
                    .map(|field| HandlersRefOutput::from(field.as_ref())),
            },
            IrNodeKind::Rect {
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
                fill: fill.as_ref().map(std::string::String::as_str),
                gradient: gradient.as_ref(),
                stroke: stroke.as_ref().map(std::string::String::as_str),
                stroke_width: stroke_width.as_ref(),
                stroke_scaling: stroke_scaling.as_ref(),
                border_radius: border_radius.as_ref(),
                stroke_linecap: stroke_linecap.as_ref(),
                stroke_linejoin: stroke_linejoin.as_ref(),
                stroke_dasharray: stroke_dasharray.as_ref().map(std::string::String::as_str),
                stroke_miterlimit: stroke_miterlimit.as_ref(),
            },
            IrNodeKind::Text {
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
                lines: lines.as_slice(),
                font: font.as_str(),
                font_fallback: font_fallback.as_ref().map(std::vec::Vec::as_slice),
                font_size_px,
                font_weight: font_weight.as_ref(),
                font_style: font_style.as_ref().map(std::string::String::as_str),
                letter_spacing_px: letter_spacing_px.as_ref(),
                font_variation_settings: font_variation_settings
                    .as_ref()
                    .map(std::string::String::as_str),
                font_feature_settings: font_feature_settings
                    .as_ref()
                    .map(std::string::String::as_str),
                color: color.as_str(),
                text_align,
                layout_box,
                writing_mode: writing_mode.as_ref().map(std::string::String::as_str),
                language: language.as_ref().map(std::string::String::as_str),
                line_height_px,
                text_layout_kind: text_layout_kind.as_ref().map(std::string::String::as_str),
                source_text: source_text.as_ref().map(std::string::String::as_str),
                display_text: display_text.as_ref().map(std::string::String::as_str),
                text_path: text_path.as_ref().map(std::convert::AsRef::as_ref),
                glyph_paths: glyph_paths
                    .as_ref()
                    .map(|field| field.iter().map(TextOutlinePathOutput::from).collect()),
                unit_map: unit_map.as_ref(),
                unit_animation: unit_animation.as_ref().map(TextUnitAnimationOutput::from),
                unit_animation_samples: unit_animation_samples.as_ref().map(|field| {
                    field
                        .iter()
                        .map(TextUnitAnimationSampleOutput::from)
                        .collect()
                }),
                stroke: stroke.as_ref().map(std::string::String::as_str),
                stroke_width: stroke_width.as_ref(),
                stroke_linecap: stroke_linecap.as_ref(),
                stroke_linejoin: stroke_linejoin.as_ref(),
                stroke_dasharray: stroke_dasharray.as_ref().map(std::string::String::as_str),
                stroke_miterlimit: stroke_miterlimit.as_ref(),
                strokes: strokes.as_ref().map(std::vec::Vec::as_slice),
                shadows: shadows.as_ref().map(std::vec::Vec::as_slice),
                text_decorations: text_decorations.as_ref().map(std::vec::Vec::as_slice),
                on: on
                    .as_ref()
                    .map(|field| HandlersRefOutput::from(field.as_ref())),
            },
            IrNodeKind::Image {
                src,
                preserve_aspect_ratio,
                on,
            } => Self::Image {
                src: src.as_str(),
                preserve_aspect_ratio: preserve_aspect_ratio.as_str(),
                on: on.as_ref().map(HandlersRefOutput::from),
            },
            IrNodeKind::Path {
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
                path_data: path_data.as_str(),
                fill: fill.as_ref().map(std::string::String::as_str),
                stroke: stroke.as_ref().map(std::string::String::as_str),
                stroke_width: stroke_width.as_ref(),
                stroke_scaling: stroke_scaling.as_ref(),
                fill_rule: fill_rule.as_ref(),
                stroke_linecap: stroke_linecap.as_ref(),
                stroke_linejoin: stroke_linejoin.as_ref(),
                stroke_dasharray: stroke_dasharray.as_ref().map(std::string::String::as_str),
                stroke_miterlimit: stroke_miterlimit.as_ref(),
                on: on.as_ref().map(HandlersRefOutput::from),
            },
            IrNodeKind::Svg {
                content,
                view_box,
                preserve_aspect_ratio,
                on,
            } => Self::Svg {
                content: content.as_str(),
                view_box: view_box.as_ref().map(std::string::String::as_str),
                preserve_aspect_ratio: preserve_aspect_ratio.as_str(),
                on: on.as_ref().map(HandlersRefOutput::from),
            },
            IrNodeKind::Shape {
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
                shape_parts: shape_parts.iter().map(ShapePathPartOutput::from).collect(),
                fill: fill.as_ref().map(std::string::String::as_str),
                stroke: stroke.as_ref().map(std::string::String::as_str),
                stroke_width: stroke_width.as_ref(),
                fill_rule: fill_rule.as_ref(),
                stroke_linecap: stroke_linecap.as_ref(),
                stroke_linejoin: stroke_linejoin.as_ref(),
                stroke_dasharray: stroke_dasharray.as_ref().map(std::string::String::as_str),
                stroke_miterlimit: stroke_miterlimit.as_ref(),
                on: on.as_ref().map(HandlersRefOutput::from),
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Projected text lines
// ---------------------------------------------------------------------------

/// Exact serialized form of a color-bearing inline style.
///
/// The layout type keeps `color` optional, but the IR serializer emits a
/// fragment style only when that color is present. Keeping this as a real Rust
/// projection makes the serializer and the serialize-direction schema share
/// one structural source.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextRunStyleProjection<'a> {
    font: &'a str,
    #[serde(skip_serializing_if = "<[String]>::is_empty")]
    fallback: &'a [String],
    font_weight: u16,
    font_style: &'a crate::font::FontStyle,
    font_size_px: f64,
    letter_spacing_px: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    text_orientation: Option<&'a crate::text::types::TextOrientation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    font_variation_settings: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    font_feature_settings: Option<&'a str>,
    color: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    text_strokes: Option<&'a Vec<TextStrokeLayer>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text_shadows: Option<&'a Vec<TextShadowLayer>>,
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "Option<boundtext::schema::DirectionalSchema<crate::text::types::Language, String>>"
        )
    )]
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<&'a str>,
}

impl<'a> TextRunStyleProjection<'a> {
    fn from_color_bearing(style: &'a TextRunStyle) -> Option<Self> {
        Some(Self {
            font: &style.font,
            fallback: &style.fallback,
            font_weight: style.font_weight,
            font_style: &style.font_style,
            font_size_px: style.font_size_px,
            letter_spacing_px: style.letter_spacing_px,
            text_orientation: style.text_orientation.as_ref(),
            font_variation_settings: style.font_variation_settings.as_deref(),
            font_feature_settings: style.font_feature_settings.as_deref(),
            color: style.color.as_deref()?,
            text_strokes: style.text_strokes.as_ref(),
            text_shadows: style.text_shadows.as_ref(),
            language: style.language.as_deref(),
        })
    }
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FragmentProjection<'a> {
    text: &'a str,
    glyphs: &'a [GlyphInfo],
    width: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    style: Option<TextRunStyleProjection<'a>>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LineProjection<'a> {
    text: &'a str,
    glyphs: &'a [GlyphInfo],
    width: f64,
    baseline_y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    fragments: Option<Vec<FragmentProjection<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    positioned_glyphs: Option<&'a Vec<PositionedGlyph>>,
}

/// Serialize IR text lines the way the TS layout parser projects them:
/// fragment `style` is omitted when it has no explicit color (the TS side
/// drops color-less styles when parsing the layout transport).
pub(super) fn serialize_lines_ts_projection<S: Serializer>(
    lines: &[Line],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let projected: Vec<LineProjection> = lines
        .iter()
        .map(|line| LineProjection {
            text: &line.text,
            glyphs: &line.glyphs,
            width: line.width,
            baseline_y: line.baseline_y,
            fragments: line.fragments.as_ref().map(|fragments| {
                fragments
                    .iter()
                    .map(|fragment| FragmentProjection {
                        text: &fragment.text,
                        glyphs: &fragment.glyphs,
                        width: fragment.width,
                        style: TextRunStyleProjection::from_color_bearing(&fragment.style),
                    })
                    .collect()
            }),
            positioned_glyphs: line.positioned_glyphs.as_ref(),
        })
        .collect();

    projected.serialize(serializer)
}

#[cfg(feature = "ir-schema")]
fn lines_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<Vec<LineProjection<'static>>>()
}
