//! Intermediate Representation (IR) types for the rendering pipeline.
//!
//! IR is built from layout results and consumed by the SVG/PNG emitter.
//! Serialization mirrors the public TS IR contract
//! (`packages/core/src/ir/types.ts`): flat nodes with a `type` discriminant,
//! camelCase keys, and unset fields omitted. Field additions must keep the
//! serialized JSON shape-identical to what the TS IR builder produces.
//!
//! Node types also derive `Deserialize` so `emit_svg_from_ir` can consume a
//! TS-produced IR JSON. The serialize shape stays authoritative; deserialize
//! only has to accept what the TS builder emits (`#[serde(default)]` covers
//! fields the TS side omits).

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::font::shaping::GlyphInfo;
use crate::text::types::{Line, PositionedGlyph, TextRunStyle};
pub use crate::text::types::{TextShadowLayer, TextStrokeLayer};

pub const MAX_TEXT_ANIMATION_UNITS: usize = 4_096;
pub const MAX_TEXT_ANIMATION_FRAGMENTS: usize = 8_192;
pub const TEXT_ANIMATION_UNIT_WARNING_THRESHOLD: usize = 1_024;
pub const TEXT_ANIMATION_FRAGMENT_WARNING_THRESHOLD: usize = 2_048;

// ---------------------------------------------------------------------------
// BBox (reusable bounding box)
// ---------------------------------------------------------------------------

/// Axis-aligned bounding box.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

// ---------------------------------------------------------------------------
// Border radius
// ---------------------------------------------------------------------------

/// Per-corner border radius.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BorderRadii {
    pub tl: f64,
    pub tr: f64,
    pub br: f64,
    pub bl: f64,
}

/// Resolved border radius — uniform or per-corner.
/// Serializes as the TS union `number | BorderRadii`.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BorderRadius {
    Uniform(f64),
    PerCorner(BorderRadii),
}

// ---------------------------------------------------------------------------
// Gradient
// ---------------------------------------------------------------------------

/// A single gradient color stop.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GradientStop {
    pub color: String,
    /// Offset in 0..1 range.
    pub offset: f64,
}

/// Resolved radial-gradient geometry in local gradient-box coordinates.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadialGradientGeometry {
    pub center_x: f64,
    pub center_y: f64,
    pub radius_x: f64,
    pub radius_y: f64,
}

/// Parsed CSS gradient.
/// Serializes as the TS gradient union (`{ type: "linear" | "radial", ... }`).
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Gradient {
    Linear {
        /// Angle in degrees (CSS convention: 0 = to top, 90 = to right).
        angle: f64,
        stops: Vec<GradientStop>,
    },
    Radial {
        /// Present for gradients produced by the layout pipeline. Optional so
        /// previously-authored IR keeps the CSS default geometry at emission.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        geometry: Option<RadialGradientGeometry>,
        stops: Vec<GradientStop>,
    },
}

// ---------------------------------------------------------------------------
// Box shadow
// ---------------------------------------------------------------------------

/// Parsed box-shadow definition.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxShadow {
    pub dx: f64,
    pub dy: f64,
    pub blur: f64,
    pub spread: f64,
    pub color: String,
}

// ---------------------------------------------------------------------------
// Stroke style
// ---------------------------------------------------------------------------

/// Stroke line cap.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StrokeLinecap {
    Butt,
    Round,
    Square,
}

/// Stroke line join.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StrokeLinejoin {
    Miter,
    Round,
    Bevel,
}

/// Whether a supported stroke scales with post-layout transforms or remains
/// stable in canvas user space.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StrokeScaling {
    Transform,
    Canvas,
}

/// Fill rule for paths.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IrFillRule {
    Nonzero,
    Evenodd,
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/// Event handler references (string identifiers for hit testing).
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandlersRef {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_click: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_double_click: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_context_menu: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_down: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_up: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_cancel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_move: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_enter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_leave: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_over: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_pointer_out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mouse_down: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mouse_up: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mouse_move: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mouse_enter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mouse_leave: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mouse_over: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mouse_out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_touch_start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_touch_end: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_touch_move: Option<String>,
}

impl HandlersRef {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.on_click.is_none()
            && self.on_double_click.is_none()
            && self.on_context_menu.is_none()
            && self.on_pointer_down.is_none()
            && self.on_pointer_up.is_none()
            && self.on_pointer_cancel.is_none()
            && self.on_pointer_move.is_none()
            && self.on_pointer_enter.is_none()
            && self.on_pointer_leave.is_none()
            && self.on_pointer_over.is_none()
            && self.on_pointer_out.is_none()
            && self.on_mouse_down.is_none()
            && self.on_mouse_up.is_none()
            && self.on_mouse_move.is_none()
            && self.on_mouse_enter.is_none()
            && self.on_mouse_leave.is_none()
            && self.on_mouse_over.is_none()
            && self.on_mouse_out.is_none()
            && self.on_touch_start.is_none()
            && self.on_touch_end.is_none()
            && self.on_touch_move.is_none()
    }
}

// ---------------------------------------------------------------------------
// Glyph outline path (textPathMode: "glyphs")
// ---------------------------------------------------------------------------

/// A text run resolved to glyph outline paths.
/// Mirrors TS `TextOutlinePath` (`packages/core/src/text/types.ts`).
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextOutlinePath {
    pub node_id: String,
    pub d: String,
    pub fill: String,
    pub glyph_ids: Vec<u32>,
    pub text: String,
    pub bbox: BBox,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_start: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_end: Option<usize>,
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "Option<boundtext::schema::DirectionalSchema<crate::text::unit_map::TextUnitSourceRole, String>>"
        )
    )]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paint_range_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strokes: Option<Vec<TextStrokeLayer>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadows: Option<Vec<TextShadowLayer>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_glyph: Option<bool>,
}

// ---------------------------------------------------------------------------
// Text alignment
// ---------------------------------------------------------------------------

/// Text alignment for SVG emission.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IrTextAlign {
    Start,
    Center,
    End,
}

// ---------------------------------------------------------------------------
// Shape parts (mirror TS ShapePathPart)
// ---------------------------------------------------------------------------

/// Viewport-baked bounds of one shape part.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ShapePartBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Per-part paint override; unset fields inherit the node paint.
/// Mirrors the `paint` member of TS `ShapePathPart`.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapePartPaint {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_linecap: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_linejoin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_dasharray: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_miterlimit: Option<f64>,
}

/// One baked part of a shape IR node. Mirrors TS `ShapePathPart`.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapePathPart {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part_id: Option<String>,
    pub d: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_d: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<ShapePartBounds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paint: Option<ShapePartPaint>,
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

/// Transform channels allowed in animation keyframes. Animation origins are
/// fixed to the logical node center and are therefore intentionally absent.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationTransform2D {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translate_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translate_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotate_deg: Option<f64>,
}

#[cfg(feature = "ir-schema")]
struct NamedAnimationEasingSchema;

#[cfg(feature = "ir-schema")]
impl boundtext::schema::StringEnumSchemaDomain for NamedAnimationEasingSchema {
    const NAME: &'static str = "NamedAnimationEasingSchema";
    const VALUES: &'static [&'static str] = &[
        "linear",
        "ease",
        "ease-in",
        "ease-out",
        "ease-in-out",
        "step-start",
        "step-end",
    ];
}

#[cfg(feature = "ir-schema")]
struct AnimationSpringKindSchema;

#[cfg(feature = "ir-schema")]
impl boundtext::schema::StringEnumSchemaDomain for AnimationSpringKindSchema {
    const NAME: &'static str = "AnimationSpringKindSchema";
    const VALUES: &'static [&'static str] = &["spring"];
}

#[cfg(feature = "ir-schema")]
struct AnimationStepsKindSchema;

#[cfg(feature = "ir-schema")]
impl boundtext::schema::StringEnumSchemaDomain for AnimationStepsKindSchema {
    const NAME: &'static str = "AnimationStepsKindSchema";
    const VALUES: &'static [&'static str] = &["steps"];
}

#[cfg(feature = "ir-schema")]
struct AnimationStepPositionSchema;

#[cfg(feature = "ir-schema")]
impl boundtext::schema::StringEnumSchemaDomain for AnimationStepPositionSchema {
    const NAME: &'static str = "AnimationStepPositionSchema";
    const VALUES: &'static [&'static str] = &["jump-start", "jump-end", "jump-none", "jump-both"];
}

#[cfg(feature = "ir-schema")]
struct AnimationInfiniteSchema;

#[cfg(feature = "ir-schema")]
impl boundtext::schema::StringEnumSchemaDomain for AnimationInfiniteSchema {
    const NAME: &'static str = "AnimationInfiniteSchema";
    const VALUES: &'static [&'static str] = &["infinite"];
}

#[cfg(feature = "ir-schema")]
struct AnimationFillSchema;

#[cfg(feature = "ir-schema")]
impl boundtext::schema::StringEnumSchemaDomain for AnimationFillSchema {
    const NAME: &'static str = "AnimationFillSchema";
    const VALUES: &'static [&'static str] = &["none", "both"];
}

#[cfg(feature = "ir-schema")]
struct TextLayoutKindSchema;

#[cfg(feature = "ir-schema")]
impl boundtext::schema::StringEnumSchemaDomain for TextLayoutKindSchema {
    const NAME: &'static str = "TextLayoutKindSchema";
    const VALUES: &'static [&'static str] = &["path"];
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationKeyframe {
    pub at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<AnimationTransform2D>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AnimationEasing {
    Named(
        #[cfg_attr(
            feature = "ir-schema",
            schemars(
                with = "boundtext::schema::DirectionalSchema<boundtext::schema::StringEnumSchema<NamedAnimationEasingSchema>, String>"
            )
        )]
        String,
    ),
    CubicBezier([f64; 4]),
    // Untagged variants are tried in declaration order and `AnimationSteps` also
    // carries a `type` field, so `Spring` must precede it. Both structs deny
    // unknown fields, which keeps the two object shapes mutually exclusive; the
    // `type` string itself is checked during animation validation.
    Spring(AnimationSpring),
    Steps(AnimationSteps),
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnimationSpring {
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "boundtext::schema::DirectionalSchema<boundtext::schema::StringEnumSchema<AnimationSpringKindSchema>, String>"
        )
    )]
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stiffness: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damping: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mass: Option<f64>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnimationSteps {
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "boundtext::schema::DirectionalSchema<boundtext::schema::StringEnumSchema<AnimationStepsKindSchema>, String>"
        )
    )]
    #[serde(rename = "type")]
    pub kind: String,
    pub count: f64,
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "boundtext::schema::DirectionalSchema<boundtext::schema::StringEnumSchema<AnimationStepPositionSchema>, String>"
        )
    )]
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_animation_step_position"
    )]
    pub position: Option<String>,
}

fn deserialize_animation_step_position<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    // Missing fields use serde(default); requiring a string here rejects an explicit null.
    String::deserialize(deserializer).map(Some)
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AnimationIterations {
    Count(f64),
    Infinite(
        #[cfg_attr(
            feature = "ir-schema",
            schemars(
                with = "boundtext::schema::DirectionalSchema<boundtext::schema::StringEnumSchema<AnimationInfiniteSchema>, String>"
            )
        )]
        String,
    ),
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationSpec {
    pub keyframes: Vec<AnimationKeyframe>,
    pub duration_ms: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub easing: Option<AnimationEasing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iterations: Option<AnimationIterations>,
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "Option<boundtext::schema::DirectionalSchema<boundtext::schema::StringEnumSchema<AnimationFillSchema>, String>>"
        )
    )]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextUnitAnimationOrder {
    Logical,
    Visual,
}

/// Raw text paint-unit animation semantic retained after sampling.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextUnitAnimation {
    pub by: crate::text::unit_map::TextUnitKind,
    pub animation: AnimationSpec,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_step_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<TextUnitAnimationOrder>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ruby: Option<crate::text::unit_map::TextUnitRubyMode>,
}

/// Actual outline bounds and sampled pose for one text paint unit.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextUnitAnimationSample {
    pub unit_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bbox: Option<BBox>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<boundshape::Transform2D>,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPathMetadata {
    pub d: String,
    pub start_offset_px: f64,
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "boundtext::schema::DirectionalSchema<crate::text::path::TextPathAnchor, String>"
        )
    )]
    pub text_anchor: String,
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "boundtext::schema::DirectionalSchema<crate::text::path::TextPathDirection, String>"
        )
    )]
    pub path_direction: String,
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "boundtext::schema::DirectionalSchema<crate::text::path::TextPathNormal, String>"
        )
    )]
    pub path_normal: String,
    pub path_offset_px: f64,
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "boundtext::schema::DirectionalSchema<crate::text::path::TextPathFit, String>"
        )
    )]
    pub path_fit: String,
    #[cfg_attr(
        feature = "ir-schema",
        schemars(
            with = "boundtext::schema::DirectionalSchema<crate::text::path::TextPathOverflow, String>"
        )
    )]
    pub path_overflow: String,
}

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

/// Exact deserialize view accepted by `emit_svg_from_ir` for one fragment.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LineFragmentWire {
    text: String,
    glyphs: Vec<GlyphInfo>,
    width: f64,
    #[serde(default)]
    style: Option<TextRunStyle>,
}

/// Exact deserialize view accepted by `emit_svg_from_ir` for one line.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LineWire {
    text: String,
    glyphs: Vec<GlyphInfo>,
    width: f64,
    baseline_y: f64,
    #[serde(default)]
    fragments: Option<Vec<LineFragmentWire>>,
    #[serde(default)]
    positioned_glyphs: Option<Vec<PositionedGlyph>>,
}

#[cfg(feature = "ir-schema")]
fn lines_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    if generator.contract().is_serialize() {
        generator.subschema_for::<Vec<LineProjection<'static>>>()
    } else {
        generator.subschema_for::<Vec<LineWire>>()
    }
}

// IR node
// ---------------------------------------------------------------------------

/// An IR node in the rendering tree.
/// Serializes flat (kind fields inline next to `nodeId`/`bbox`, plus a
/// `type` discriminant) to match the TS `IRNode` shape.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IrNode {
    pub node_id: String,
    pub bbox: BBox,
    #[serde(flatten)]
    pub kind: IrNodeKind,
}

/// The type-specific payload of an IR node.
///
/// Large event-handler tables on container and text nodes are boxed so the
/// common enum value stays compact without adding indirection to paint data.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum IrNodeKind {
    /// Container group (may clip children).
    Group {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        children: Vec<IrNode>,
        #[serde(skip_serializing_if = "Option::is_none")]
        clip_path: Option<BBox>,
        #[serde(skip_serializing_if = "Option::is_none")]
        clip_border_radius: Option<BorderRadius>,
        #[serde(skip_serializing_if = "Option::is_none")]
        opacity: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        box_shadow: Option<BoxShadow>,
        #[serde(skip_serializing_if = "Option::is_none")]
        meta: Option<std::collections::BTreeMap<String, String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        transform: Option<boundshape::Transform2D>,
        #[serde(skip_serializing_if = "Option::is_none")]
        animation: Option<AnimationSpec>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on: Option<Box<HandlersRef>>,
    },

    /// Filled/stroked rectangle.
    Rect {
        #[serde(skip_serializing_if = "Option::is_none")]
        fill: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        gradient: Option<Gradient>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_width: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_scaling: Option<StrokeScaling>,
        #[serde(skip_serializing_if = "Option::is_none")]
        border_radius: Option<BorderRadius>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linecap: Option<StrokeLinecap>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linejoin: Option<StrokeLinejoin>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_dasharray: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_miterlimit: Option<f64>,
    },

    /// Text node with line-broken content.
    Text {
        #[cfg_attr(feature = "ir-schema", schemars(schema_with = "lines_schema"))]
        #[serde(
            serialize_with = "serialize_lines_ts_projection",
            deserialize_with = "deserialize_lines_ts_projection"
        )]
        lines: Vec<Line>,
        font: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        font_fallback: Option<Vec<String>>,
        font_size_px: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        font_weight: Option<u16>,
        #[cfg_attr(
            feature = "ir-schema",
            schemars(
                with = "Option<boundtext::schema::DirectionalSchema<crate::font::FontStyle, String>>"
            )
        )]
        #[serde(skip_serializing_if = "Option::is_none")]
        font_style: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        letter_spacing_px: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        font_variation_settings: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        font_feature_settings: Option<String>,
        color: String,
        text_align: IrTextAlign,
        /// Allotted text layout box; `bbox` is the aligned measured block.
        layout_box: BBox,
        #[cfg_attr(
            feature = "ir-schema",
            schemars(
                with = "Option<boundtext::schema::DirectionalSchema<crate::text::types::WritingMode, String>>"
            )
        )]
        #[serde(skip_serializing_if = "Option::is_none")]
        writing_mode: Option<String>,
        #[cfg_attr(
            feature = "ir-schema",
            schemars(
                with = "Option<boundtext::schema::DirectionalSchema<crate::text::types::Language, String>>"
            )
        )]
        #[serde(skip_serializing_if = "Option::is_none")]
        language: Option<String>,
        line_height_px: f64,
        #[cfg_attr(
            feature = "ir-schema",
            schemars(
                with = "Option<boundtext::schema::DirectionalSchema<boundtext::schema::StringEnumSchema<TextLayoutKindSchema>, String>>"
            )
        )]
        #[serde(skip_serializing_if = "Option::is_none")]
        text_layout_kind: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        source_text: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        display_text: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text_path: Option<Box<TextPathMetadata>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        glyph_paths: Option<Vec<TextOutlinePath>>,
        /// Stable paint-unit metadata generated by boundtext for opt-in text.
        #[serde(skip_serializing_if = "Option::is_none")]
        unit_map: Option<crate::text::unit_map::TextUnitMap>,
        /// Raw unit animation semantic retained across frame sampling.
        #[serde(skip_serializing_if = "Option::is_none")]
        unit_animation: Option<TextUnitAnimation>,
        /// Per-unit actual outline bounds and sampled pose.
        #[serde(skip_serializing_if = "Option::is_none")]
        unit_animation_samples: Option<Vec<TextUnitAnimationSample>>,
        // Stroke
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_width: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linecap: Option<StrokeLinecap>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linejoin: Option<StrokeLinejoin>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_dasharray: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_miterlimit: Option<f64>,
        // Multi-layer text effects (take precedence over scalar stroke fields)
        #[serde(skip_serializing_if = "Option::is_none")]
        strokes: Option<Vec<TextStrokeLayer>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        shadows: Option<Vec<TextShadowLayer>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text_decorations: Option<Vec<crate::text::types::TextDecorationFragment>>,
        // Event handlers
        #[serde(skip_serializing_if = "Option::is_none")]
        on: Option<Box<HandlersRef>>,
    },

    /// Raster image (base64 data URI).
    Image {
        src: String,
        preserve_aspect_ratio: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        on: Option<HandlersRef>,
    },

    /// SVG path element.
    Path {
        path_data: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        fill: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_width: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_scaling: Option<StrokeScaling>,
        #[serde(skip_serializing_if = "Option::is_none")]
        fill_rule: Option<IrFillRule>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linecap: Option<StrokeLinecap>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linejoin: Option<StrokeLinejoin>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_dasharray: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_miterlimit: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on: Option<HandlersRef>,
    },

    /// Nested SVG content.
    Svg {
        #[serde(rename = "svgContent")]
        content: String,
        #[serde(rename = "svgViewBox", skip_serializing_if = "Option::is_none")]
        view_box: Option<String>,
        preserve_aspect_ratio: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        on: Option<HandlersRef>,
    },

    /// Structural shape with viewport-baked part paths.
    Shape {
        shape_parts: Vec<ShapePathPart>,
        #[serde(skip_serializing_if = "Option::is_none")]
        fill: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_width: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        fill_rule: Option<IrFillRule>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linecap: Option<StrokeLinecap>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_linejoin: Option<StrokeLinejoin>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_dasharray: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stroke_miterlimit: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on: Option<HandlersRef>,
    },
}

/// Serialize IR text lines the way the TS layout parser projects them:
/// fragment `style` is omitted when it has no explicit color (the TS side
/// drops color-less styles when parsing the layout transport).
fn serialize_lines_ts_projection<S: Serializer>(
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

/// Deserialize IR text lines from the TS projection produced by
/// [`serialize_lines_ts_projection`]. A fragment whose `style` was dropped
/// (color-less in the projection) gets an inert placeholder style — the SVG
/// emitter never reads fragment styles, and a deserialized IR is only
/// emitted, never re-serialized.
fn deserialize_lines_ts_projection<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<Line>, D::Error> {
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

    let wires = Vec::<LineWire>::deserialize(deserializer)?;
    Ok(wires
        .into_iter()
        .map(|wire| Line {
            text: wire.text,
            glyphs: wire.glyphs,
            width: wire.width,
            baseline_y: wire.baseline_y,
            fragments: wire.fragments.map(|fragments| {
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
            positioned_glyphs: wire.positioned_glyphs,
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Render warning (structured — matches TS StructuredError contract)
// ---------------------------------------------------------------------------

/// Error severity — matches TS `ErrorSeverity` in `packages/core/src/errors.ts`.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ErrorSeverity {
    Fatal,
    Recoverable,
}

/// Pipeline stages for structured warning/error reporting.
/// Matches TS `PipelineStage` in `packages/core/src/errors.ts`.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PipelineStage {
    Validate,
    Layout,
    Text,
    Ir,
    Emit,
    Wasm,
    Font,
    Engine,
    Analyzer,
}

/// A structured warning emitted during IR build or SVG emission.
///
/// Matches the TS `StructuredError` schema
/// (`{ severity, code, message, stage?, nodeId?, fallback? }`).
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderWarning {
    pub severity: ErrorSeverity,
    pub code: String,
    pub message: String,
    pub stage: PipelineStage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    /// Description of the fallback action taken (e.g. "`placeholder_rect`").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,
}

// ---------------------------------------------------------------------------
// Hit target (returned alongside SVG for TS-side spatial indexing)
// ---------------------------------------------------------------------------

/// A hit-testable target returned from `render_to_svg`.
#[derive(Debug, Clone)]
pub struct HitTarget {
    pub node_id: String,
    pub bbox: BBox,
    pub draw_index: usize,
    pub has_handlers: bool,
    pub handlers: Option<HandlersRef>,
}

// ---------------------------------------------------------------------------
// Complete IR
// ---------------------------------------------------------------------------

/// Complete intermediate representation for a rendered tree.
/// Serializes as the TS `IR` shape (camelCase, `debug` omitted unless true).
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ir {
    pub root: IrNode,
    /// Node IDs in z-ascending order (back-to-front).
    pub draw_order: Vec<String>,
    pub width: f64,
    pub height: f64,
    /// Declarative Canvas debug overlay default; omitted unless enabled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debug: Option<bool>,
    pub warnings: Vec<RenderWarning>,
}

// ---------------------------------------------------------------------------
// Helper impls
// ---------------------------------------------------------------------------

impl BBox {
    #[must_use]
    pub fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
        Self { x, y, w, h }
    }
}

impl BorderRadius {
    /// Check if all corners are zero.
    #[must_use]
    pub fn is_zero(&self) -> bool {
        match self {
            BorderRadius::Uniform(r) => *r == 0.0,
            BorderRadius::PerCorner(radii) => {
                radii.tl == 0.0 && radii.tr == 0.0 && radii.br == 0.0 && radii.bl == 0.0
            }
        }
    }

    /// Check if all corners are the same (uniform).
    #[must_use]
    pub fn is_uniform(&self) -> bool {
        match self {
            BorderRadius::Uniform(_) => true,
            BorderRadius::PerCorner(radii) => {
                radii.tl == radii.tr && radii.tr == radii.br && radii.br == radii.bl
            }
        }
    }

    /// Get the uniform radius value (if uniform).
    #[must_use]
    pub fn uniform_value(&self) -> Option<f64> {
        match self {
            BorderRadius::Uniform(r) => Some(*r),
            BorderRadius::PerCorner(radii) => {
                if radii.tl == radii.tr && radii.tr == radii.br && radii.br == radii.bl {
                    Some(radii.tl)
                } else {
                    None
                }
            }
        }
    }

    /// Get per-corner radii.
    #[must_use]
    pub fn to_radii(&self) -> BorderRadii {
        match self {
            BorderRadius::Uniform(r) => BorderRadii {
                tl: *r,
                tr: *r,
                br: *r,
                bl: *r,
            },
            BorderRadius::PerCorner(radii) => *radii,
        }
    }
}

/// Resolve raw border radius (number or 4-element array) with clamping.
/// A raw zero stays a resolved zero — the TS builder keeps authored zeros
/// in the IR, so filtering them here would break shape parity.
#[must_use]
pub fn resolve_border_radius(
    raw: Option<&BorderRadiusInput>,
    w: f64,
    h: f64,
) -> Option<BorderRadius> {
    let raw = raw?;
    let max_r = w.min(h) / 2.0;

    match raw {
        BorderRadiusInput::Uniform(r) => Some(BorderRadius::Uniform(r.min(max_r))),
        BorderRadiusInput::PerCorner(tl, tr, br, bl) => {
            Some(BorderRadius::PerCorner(BorderRadii {
                tl: tl.min(max_r),
                tr: tr.min(max_r),
                br: br.min(max_r),
                bl: bl.min(max_r),
            }))
        }
    }
}

/// Raw border radius input (before clamping).
#[derive(Debug, Clone)]
pub enum BorderRadiusInput {
    Uniform(f64),
    PerCorner(f64, f64, f64, f64),
}

/// Parse a box-shadow string: `"dx dy \[blur \[spread\]\] \[color\]"`.
/// The leading-number scanner accepts sign and exponent forms, and a shadow
/// with any non-finite value or a negative blur is dropped entirely.
#[must_use]
pub fn parse_box_shadow(value: &str) -> Option<BoxShadow> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut parts: Vec<f64> = Vec::new();
    let mut remaining = trimmed;

    // Parse up to 4 numeric values from the beginning
    for _ in 0..4 {
        let Some((number, rest)) = match_leading_shadow_number(remaining) else {
            break;
        };
        parts.push(number);
        remaining = rest;
    }

    if parts.len() < 2 {
        return None;
    }

    let dx = parts[0];
    let dy = parts[1];
    let blur = if parts.len() > 2 { parts[2] } else { 0.0 };
    let spread = if parts.len() > 3 { parts[3] } else { 0.0 };
    let color_str = remaining.trim();
    let color = if color_str.is_empty() {
        "rgba(0,0,0,0.3)".to_string()
    } else {
        color_str.to_string()
    };

    if !(dx.is_finite() && dy.is_finite() && blur.is_finite() && spread.is_finite()) || blur < 0.0 {
        return None;
    }

    Some(BoxShadow {
        dx,
        dy,
        blur,
        spread,
        color,
    })
}

/// Scan the TS leading-number pattern
/// `^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*` and return the
/// parsed value plus the rest of the input after the match.
fn match_leading_shadow_number(text: &str) -> Option<(f64, &str)> {
    let after_leading_ws = text.trim_start();
    let bytes = after_leading_ws.as_bytes();
    let mut cursor = 0;

    if matches!(bytes.first(), Some(b'+' | b'-')) {
        cursor += 1;
    }

    let integer_digits = count_ascii_digits(&bytes[cursor..]);
    cursor += integer_digits;
    if integer_digits > 0 {
        // \d+ (\.\d*)?
        if bytes.get(cursor) == Some(&b'.') {
            cursor += 1;
            cursor += count_ascii_digits(&bytes[cursor..]);
        }
    } else if bytes.get(cursor) == Some(&b'.') {
        // \.\d+
        cursor += 1;
        let fraction_digits = count_ascii_digits(&bytes[cursor..]);
        if fraction_digits == 0 {
            return None;
        }
        cursor += fraction_digits;
    } else {
        return None;
    }

    // (?:[eE][+-]?\d+)? — consumed only when the full exponent form matches
    if matches!(bytes.get(cursor), Some(b'e' | b'E')) {
        let mut exponent_cursor = cursor + 1;
        if matches!(bytes.get(exponent_cursor), Some(b'+' | b'-')) {
            exponent_cursor += 1;
        }
        let exponent_digits = count_ascii_digits(&bytes[exponent_cursor..]);
        if exponent_digits > 0 {
            cursor = exponent_cursor + exponent_digits;
        }
    }

    let number: f64 = after_leading_ws[..cursor].parse().ok()?;
    Some((number, after_leading_ws[cursor..].trim_start()))
}

fn count_ascii_digits(bytes: &[u8]) -> usize {
    bytes
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bbox_new() {
        let b = BBox::new(10.0, 20.0, 100.0, 50.0);
        assert_eq!(b.x, 10.0);
        assert_eq!(b.y, 20.0);
        assert_eq!(b.w, 100.0);
        assert_eq!(b.h, 50.0);
    }

    #[test]
    fn test_border_radius_uniform() {
        let br = BorderRadius::Uniform(5.0);
        assert!(br.is_uniform());
        assert!(!br.is_zero());
        assert_eq!(br.uniform_value(), Some(5.0));
    }

    #[test]
    fn test_border_radius_per_corner() {
        let br = BorderRadius::PerCorner(BorderRadii {
            tl: 5.0,
            tr: 10.0,
            br: 5.0,
            bl: 10.0,
        });
        assert!(!br.is_uniform());
        assert!(!br.is_zero());
        assert_eq!(br.uniform_value(), None);
    }

    #[test]
    fn test_border_radius_zero() {
        assert!(BorderRadius::Uniform(0.0).is_zero());
        assert!(
            BorderRadius::PerCorner(BorderRadii {
                tl: 0.0,
                tr: 0.0,
                br: 0.0,
                bl: 0.0,
            })
            .is_zero()
        );
    }

    #[test]
    fn test_resolve_border_radius_clamping() {
        // 20x10 rect → max radius = 5
        let raw = BorderRadiusInput::Uniform(8.0);
        let result = resolve_border_radius(Some(&raw), 20.0, 10.0);
        match result {
            Some(BorderRadius::Uniform(r)) => assert_eq!(r, 5.0),
            _ => panic!("expected Uniform(5.0)"),
        }
    }

    #[test]
    fn test_resolve_border_radius_per_corner_clamping() {
        let raw = BorderRadiusInput::PerCorner(3.0, 8.0, 2.0, 10.0);
        let result = resolve_border_radius(Some(&raw), 20.0, 10.0);
        match result {
            Some(BorderRadius::PerCorner(r)) => {
                assert_eq!(r.tl, 3.0);
                assert_eq!(r.tr, 5.0);
                assert_eq!(r.br, 2.0);
                assert_eq!(r.bl, 5.0);
            }
            _ => panic!("expected PerCorner"),
        }
    }

    #[test]
    fn test_resolve_border_radius_none() {
        assert!(resolve_border_radius(None, 100.0, 100.0).is_none());
    }

    #[test]
    fn test_resolve_border_radius_keeps_authored_zero() {
        let raw = BorderRadiusInput::Uniform(0.0);
        match resolve_border_radius(Some(&raw), 100.0, 100.0) {
            Some(BorderRadius::Uniform(radius)) => assert_eq!(radius, 0.0),
            other => panic!("expected Uniform(0.0), got {other:?}"),
        }
    }

    #[test]
    fn test_parse_box_shadow_basic() {
        let bs = parse_box_shadow("5 5 10 2 rgba(0,0,0,0.5)").unwrap();
        assert_eq!(bs.dx, 5.0);
        assert_eq!(bs.dy, 5.0);
        assert_eq!(bs.blur, 10.0);
        assert_eq!(bs.spread, 2.0);
        assert_eq!(bs.color, "rgba(0,0,0,0.5)");
    }

    #[test]
    fn test_parse_box_shadow_minimal() {
        let bs = parse_box_shadow("3 4").unwrap();
        assert_eq!(bs.dx, 3.0);
        assert_eq!(bs.dy, 4.0);
        assert_eq!(bs.blur, 0.0);
        assert_eq!(bs.spread, 0.0);
        assert_eq!(bs.color, "rgba(0,0,0,0.3)");
    }

    #[test]
    fn test_parse_box_shadow_three_values() {
        let bs = parse_box_shadow("2 3 8 #ff0000").unwrap();
        assert_eq!(bs.dx, 2.0);
        assert_eq!(bs.dy, 3.0);
        assert_eq!(bs.blur, 8.0);
        assert_eq!(bs.spread, 0.0);
        assert_eq!(bs.color, "#ff0000");
    }

    #[test]
    fn test_parse_box_shadow_negative() {
        let bs = parse_box_shadow("-2 -3 5 0 red").unwrap();
        assert_eq!(bs.dx, -2.0);
        assert_eq!(bs.dy, -3.0);
        assert_eq!(bs.blur, 5.0);
    }

    #[test]
    fn test_parse_box_shadow_rejects_negative_blur() {
        assert!(parse_box_shadow("2 3 -5 red").is_none());
    }

    #[test]
    fn test_parse_box_shadow_plus_signs_and_exponents() {
        let with_plus = parse_box_shadow("+2 +3 5 red").unwrap();
        assert_eq!(with_plus.dx, 2.0);
        assert_eq!(with_plus.dy, 3.0);
        assert_eq!(with_plus.blur, 5.0);

        let with_exponent = parse_box_shadow("1e2 3 red").unwrap();
        assert_eq!(with_exponent.dx, 100.0);
        assert_eq!(with_exponent.dy, 3.0);
        assert_eq!(with_exponent.color, "red");
    }

    #[test]
    fn test_parse_box_shadow_rejects_non_finite() {
        assert!(parse_box_shadow("1e999 3 red").is_none());
    }

    #[test]
    fn test_parse_box_shadow_empty() {
        assert!(parse_box_shadow("").is_none());
        assert!(parse_box_shadow("  ").is_none());
    }

    #[test]
    fn test_parse_box_shadow_single_value() {
        assert!(parse_box_shadow("5").is_none());
    }

    #[test]
    fn test_handlers_ref_empty() {
        let h = HandlersRef::default();
        assert!(h.is_empty());
    }

    #[test]
    fn test_handlers_ref_not_empty() {
        let h = HandlersRef {
            on_click: Some("handler1".to_string()),
            ..Default::default()
        };
        assert!(!h.is_empty());
    }

    /// The flattened, internally-tagged `IrNodeKind` must survive a
    /// serialize → deserialize → serialize round trip byte-for-byte —
    /// `emit_svg_from_ir` consumes exactly this wire shape.
    #[test]
    fn ir_node_round_trips_through_serde() {
        let text_node = IrNode {
            node_id: "t1".to_string(),
            bbox: BBox::new(1.5, 2.0, 30.0, 12.0),
            kind: IrNodeKind::Text {
                lines: vec![crate::text::types::Line {
                    text: "hi".to_string(),
                    glyphs: Vec::new(),
                    width: 10.0,
                    baseline_y: 9.0,
                    fragments: None,
                    positioned_glyphs: None,
                }],
                font: "TestFont".to_string(),
                font_fallback: None,
                font_size_px: 12.0,
                font_weight: Some(400),
                font_style: None,
                letter_spacing_px: None,
                font_variation_settings: None,
                font_feature_settings: None,
                color: "#111111".to_string(),
                text_align: IrTextAlign::Start,
                layout_box: BBox::new(0.0, 0.0, 40.0, 12.0),
                writing_mode: None,
                language: None,
                line_height_px: 12.0,
                text_layout_kind: None,
                source_text: None,
                display_text: None,
                text_path: None,
                glyph_paths: Some(vec![TextOutlinePath {
                    node_id: "t1".to_string(),
                    d: "M0,0L1,1".to_string(),
                    fill: "#111111".to_string(),
                    strokes: None,
                    shadows: None,
                    paint_range_index: None,
                    glyph_ids: vec![7],
                    text: "h".to_string(),
                    bbox: BBox::new(0.0, 0.0, 1.0, 1.0),
                    unit_id: None,
                    source_start: None,
                    source_end: None,
                    source_role: None,
                    missing_glyph: None,
                }]),
                unit_map: Some(crate::text::unit_map::TextUnitMap {
                    kind: crate::text::unit_map::TextUnitKind::Cluster,
                    ruby: crate::text::unit_map::TextUnitRubyMode::WithBase,
                    units: vec![crate::text::unit_map::TextUnitMapEntry {
                        unit_id: "opaque-cluster-id".to_string(),
                        kind: crate::text::unit_map::TextUnitKind::Cluster,
                        source_start: 0,
                        source_end: 1,
                        line_id: "opaque-line-id".to_string(),
                        logical_order: 0,
                        visual_order: 0,
                        members: vec![crate::text::unit_map::TextUnitGlyphMember {
                            line_index: 0,
                            glyph_index: 0,
                            source_role: crate::text::unit_map::TextUnitSourceRole::Content,
                        }],
                    }],
                }),
                unit_animation: None,
                unit_animation_samples: None,
                stroke: None,
                stroke_width: None,
                stroke_linecap: None,
                stroke_linejoin: None,
                stroke_dasharray: None,
                stroke_miterlimit: None,
                strokes: None,
                shadows: None,
                text_decorations: None,
                on: None,
            },
        };
        let root = IrNode {
            node_id: "canvas".to_string(),
            bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
            kind: IrNodeKind::Group {
                children: vec![
                    IrNode {
                        node_id: "canvas:bg".to_string(),
                        bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
                        kind: IrNodeKind::Rect {
                            fill: Some("#ffffff".to_string()),
                            gradient: None,
                            stroke: None,
                            stroke_width: None,
                            stroke_scaling: None,
                            border_radius: Some(BorderRadius::Uniform(4.0)),
                            stroke_linecap: None,
                            stroke_linejoin: None,
                            stroke_dasharray: None,
                            stroke_miterlimit: None,
                        },
                    },
                    text_node,
                ],
                clip_path: Some(BBox::new(0.0, 0.0, 100.0, 50.0)),
                clip_border_radius: None,
                opacity: None,
                box_shadow: None,
                meta: None,
                transform: None,
                animation: None,
                on: None,
            },
        };

        let serialized = serde_json::to_string(&root).expect("serializes");
        let deserialized: IrNode = serde_json::from_str(&serialized).expect("deserializes");
        let reserialized = serde_json::to_string(&deserialized).expect("re-serializes");
        assert_eq!(serialized, reserialized);
    }

    /// A projected fragment without `style` (color-less) deserializes with
    /// the inert placeholder and re-projects to the same wire bytes.
    #[test]
    fn projected_lines_round_trip_without_fragment_styles() {
        // Drives the (de)serialize functions directly — a derive here would
        // register a phantom DTO in the WASM bridge schema inventory.
        struct LinesProjection<'a>(&'a [Line]);
        impl Serialize for LinesProjection<'_> {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serialize_lines_ts_projection(self.0, serializer)
            }
        }

        // Non-integral numbers so the f64 formatting round-trips textually.
        let wire = r#"[{"text":"ab","glyphs":[],"width":8.5,"baselineY":6.5,"fragments":[{"text":"ab","glyphs":[],"width":8.5}]}]"#;
        let mut wire_deserializer = serde_json::Deserializer::from_str(wire);
        let lines = deserialize_lines_ts_projection(&mut wire_deserializer).expect("deserializes");
        let reserialized = serde_json::to_string(&LinesProjection(&lines)).expect("re-serializes");
        assert_eq!(reserialized, wire);
    }

    #[test]
    fn test_handlers_ref_touch_not_empty() {
        let h = HandlersRef {
            on_touch_start: Some("handleTouch".to_string()),
            ..Default::default()
        };
        assert!(!h.is_empty());
    }
}
