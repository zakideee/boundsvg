//! Intermediate Representation (IR) types for the rendering pipeline.
//!
//! IR is built from layout results and consumed by the SVG/PNG emitter.
//! Serialization mirrors the public TS IR contract
//! (`packages/core/src/ir/types.ts`): flat nodes with a `type` discriminant,
//! camelCase keys, and unset fields omitted. Field additions must keep the
//! serialized JSON shape-identical to what the TS IR builder produces.
//!
//! Input DTOs in `wire_input` convert into these domain values. Native
//! serialization delegates to the borrowed `wire_output` projections, which
//! retain the public field names and omission rules.

use serde::{Deserialize, Serialize, Serializer};

#[cfg(test)]
use super::wire_output::serialize_lines_ts_projection;
use crate::diagnostics::SerializedRecoverableError;
use crate::text::types::Line;
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

#[derive(Debug, Clone, Default)]

pub struct HandlersRef {
    pub on_click: Option<String>,

    pub on_double_click: Option<String>,

    pub on_context_menu: Option<String>,

    pub on_pointer_down: Option<String>,

    pub on_pointer_up: Option<String>,

    pub on_pointer_cancel: Option<String>,

    pub on_pointer_move: Option<String>,

    pub on_pointer_enter: Option<String>,

    pub on_pointer_leave: Option<String>,

    pub on_pointer_over: Option<String>,

    pub on_pointer_out: Option<String>,

    pub on_mouse_down: Option<String>,

    pub on_mouse_up: Option<String>,

    pub on_mouse_move: Option<String>,

    pub on_mouse_enter: Option<String>,

    pub on_mouse_leave: Option<String>,

    pub on_mouse_over: Option<String>,

    pub on_mouse_out: Option<String>,

    pub on_touch_start: Option<String>,

    pub on_touch_end: Option<String>,

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

#[derive(Debug, Clone)]

pub struct TextOutlinePath {
    pub node_id: String,
    pub d: String,
    pub fill: String,
    pub glyph_ids: Vec<u32>,
    pub text: String,
    pub bbox: BBox,

    pub unit_id: Option<String>,

    pub source_start: Option<usize>,

    pub source_end: Option<usize>,

    pub source_role: Option<String>,

    pub paint_range_index: Option<u32>,

    pub strokes: Option<Vec<TextStrokeLayer>>,

    pub shadows: Option<Vec<TextShadowLayer>>,

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

#[derive(Debug, Clone)]

pub struct ShapePartPaint {
    pub fill: Option<String>,

    pub stroke: Option<String>,

    pub stroke_width: Option<f64>,

    pub stroke_linecap: Option<String>,

    pub stroke_linejoin: Option<String>,

    pub stroke_dasharray: Option<String>,

    pub stroke_miterlimit: Option<f64>,
}

/// One baked part of a shape IR node. Mirrors TS `ShapePathPart`.

#[derive(Debug, Clone)]

pub struct ShapePathPart {
    pub part_id: Option<String>,
    pub d: String,

    pub stroke_d: Option<String>,

    pub bounds: Option<ShapePartBounds>,

    pub paint: Option<ShapePartPaint>,
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

/// Transform channels allowed in animation keyframes. Animation origins are
/// fixed to the logical node center and are therefore intentionally absent.

#[derive(Debug, Clone, Default, PartialEq)]

pub struct AnimationTransform2D {
    pub translate_x: Option<f64>,

    pub translate_y: Option<f64>,

    pub scale_x: Option<f64>,

    pub scale_y: Option<f64>,

    pub rotate_deg: Option<f64>,
}

#[cfg(feature = "ir-schema")]
pub(super) struct NamedAnimationEasingSchema;

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
pub(super) struct AnimationSpringKindSchema;

#[cfg(feature = "ir-schema")]
impl boundtext::schema::StringEnumSchemaDomain for AnimationSpringKindSchema {
    const NAME: &'static str = "AnimationSpringKindSchema";
    const VALUES: &'static [&'static str] = &["spring"];
}

#[cfg(feature = "ir-schema")]
pub(super) struct AnimationStepsKindSchema;

#[cfg(feature = "ir-schema")]
impl boundtext::schema::StringEnumSchemaDomain for AnimationStepsKindSchema {
    const NAME: &'static str = "AnimationStepsKindSchema";
    const VALUES: &'static [&'static str] = &["steps"];
}

#[cfg(feature = "ir-schema")]
pub(super) struct AnimationStepPositionSchema;

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
pub(super) struct AnimationFillSchema;

#[cfg(feature = "ir-schema")]
impl boundtext::schema::StringEnumSchemaDomain for AnimationFillSchema {
    const NAME: &'static str = "AnimationFillSchema";
    const VALUES: &'static [&'static str] = &["none", "both"];
}

#[cfg(feature = "ir-schema")]
pub(super) struct TextLayoutKindSchema;

#[cfg(feature = "ir-schema")]
impl boundtext::schema::StringEnumSchemaDomain for TextLayoutKindSchema {
    const NAME: &'static str = "TextLayoutKindSchema";
    const VALUES: &'static [&'static str] = &["path"];
}

#[derive(Debug, Clone, PartialEq)]

pub struct AnimationKeyframe {
    pub at: f64,

    pub opacity: Option<f64>,

    pub transform: Option<AnimationTransform2D>,
}

#[derive(Debug, Clone, PartialEq)]

pub enum AnimationEasing {
    Named(String),
    CubicBezier([f64; 4]),
    // Untagged variants are tried in declaration order and `AnimationSteps` also
    // carries a `type` field, so `Spring` must precede it. Both structs deny
    // unknown fields, which keeps the two object shapes mutually exclusive; the
    // `type` string itself is checked during animation validation.
    Spring(AnimationSpring),
    Steps(AnimationSteps),
}

#[derive(Debug, Clone, PartialEq)]

pub struct AnimationSpring {
    pub kind: String,

    pub stiffness: Option<f64>,

    pub damping: Option<f64>,

    pub mass: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]

pub struct AnimationSteps {
    pub kind: String,
    pub count: f64,

    pub position: Option<String>,
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

#[derive(Debug, Clone, PartialEq)]

pub struct AnimationSpec {
    pub keyframes: Vec<AnimationKeyframe>,
    pub duration_ms: f64,

    pub delay_ms: Option<f64>,

    pub easing: Option<AnimationEasing>,

    pub iterations: Option<AnimationIterations>,

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

#[derive(Debug, Clone, PartialEq)]

pub struct TextUnitAnimation {
    pub by: crate::text::unit_map::TextUnitKind,
    pub animation: AnimationSpec,

    pub delay_step_ms: Option<f64>,

    pub order: Option<TextUnitAnimationOrder>,

    pub ruby: Option<crate::text::unit_map::TextUnitRubyMode>,
}

/// Actual outline bounds and sampled pose for one text paint unit.

#[derive(Debug, Clone, PartialEq)]

pub struct TextUnitAnimationSample {
    pub unit_id: String,

    pub bbox: Option<BBox>,

    pub opacity: Option<f64>,

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

#[cfg(test)]
use super::wire_input::LineWire;

// IR node
// ---------------------------------------------------------------------------

/// An IR node in the rendering tree.
/// Serializes flat (kind fields inline next to `nodeId`/`bbox`, plus a
/// `type` discriminant) to match the TS `IRNode` shape.

#[derive(Debug, Clone)]

pub struct IrNode {
    pub node_id: String,
    pub bbox: BBox,

    pub kind: IrNodeKind,
}

/// The type-specific payload of an IR node.
///
/// Large event-handler tables on container and text nodes are boxed so the
/// common enum value stays compact without adding indirection to paint data.

#[derive(Debug, Clone)]

pub enum IrNodeKind {
    /// Container group (may clip children).
    Group {
        children: Vec<IrNode>,

        clip_path: Option<BBox>,

        clip_border_radius: Option<BorderRadius>,

        opacity: Option<f64>,

        box_shadow: Option<BoxShadow>,

        meta: Option<std::collections::BTreeMap<String, String>>,

        transform: Option<boundshape::Transform2D>,

        animation: Option<AnimationSpec>,

        on: Option<Box<HandlersRef>>,
    },

    /// Filled/stroked rectangle.
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

    /// Text node with line-broken content.
    Text {
        lines: Vec<Line>,
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
        /// Allotted text layout box; `bbox` is the aligned measured block.
        layout_box: BBox,

        writing_mode: Option<String>,

        language: Option<String>,
        line_height_px: f64,

        text_layout_kind: Option<String>,

        source_text: Option<String>,

        display_text: Option<String>,

        text_path: Option<Box<TextPathMetadata>>,

        glyph_paths: Option<Vec<TextOutlinePath>>,
        /// Stable paint-unit metadata generated by boundtext for opt-in text.
        unit_map: Option<crate::text::unit_map::TextUnitMap>,
        /// Raw unit animation semantic retained across frame sampling.
        unit_animation: Option<TextUnitAnimation>,
        /// Per-unit actual outline bounds and sampled pose.
        unit_animation_samples: Option<Vec<TextUnitAnimationSample>>,
        // Stroke
        stroke: Option<String>,

        stroke_width: Option<f64>,

        stroke_linecap: Option<StrokeLinecap>,

        stroke_linejoin: Option<StrokeLinejoin>,

        stroke_dasharray: Option<String>,

        stroke_miterlimit: Option<f64>,
        // Multi-layer text effects (take precedence over scalar stroke fields)
        strokes: Option<Vec<TextStrokeLayer>>,

        shadows: Option<Vec<TextShadowLayer>>,

        text_decorations: Option<Vec<crate::text::types::TextDecorationFragment>>,
        // Event handlers
        on: Option<Box<HandlersRef>>,
    },

    /// Raster image (base64 data URI).
    Image {
        src: String,
        preserve_aspect_ratio: String,

        on: Option<HandlersRef>,
    },

    /// SVG path element.
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

        on: Option<HandlersRef>,
    },

    /// Nested SVG content.
    Svg {
        content: String,

        view_box: Option<String>,
        preserve_aspect_ratio: String,

        on: Option<HandlersRef>,
    },

    /// Structural shape with viewport-baked part paths.
    Shape {
        shape_parts: Vec<ShapePathPart>,

        fill: Option<String>,

        stroke: Option<String>,

        stroke_width: Option<f64>,

        fill_rule: Option<IrFillRule>,

        stroke_linecap: Option<StrokeLinecap>,

        stroke_linejoin: Option<StrokeLinejoin>,

        stroke_dasharray: Option<String>,

        stroke_miterlimit: Option<f64>,

        on: Option<HandlersRef>,
    },
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
/// Diagnostics remain internal and are serialized only by the surrounding
/// render envelope.
#[derive(Debug, Clone)]
pub struct Ir {
    pub root: IrNode,
    /// Node IDs in z-ascending order (back-to-front).
    pub draw_order: Vec<String>,
    pub width: f64,
    pub height: f64,
    /// Declarative Canvas debug overlay default; omitted unless enabled.
    pub debug: Option<bool>,
    pub warnings: Vec<SerializedRecoverableError>,
}

/// Borrowed structural projection used at every IR wire boundary.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralIr<'a> {
    #[cfg_attr(
        feature = "ir-schema",
        schemars(with = "super::wire_output::IrNodeOutput<'static>")
    )]
    pub root: &'a IrNode,
    pub draw_order: &'a [String],
    pub width: f64,
    pub height: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debug: Option<bool>,
}

impl Ir {
    #[must_use]
    pub fn structural(&self) -> StructuralIr<'_> {
        StructuralIr {
            root: &self.root,
            draw_order: &self.draw_order,
            width: self.width,
            height: self.height,
            debug: self.debug,
        }
    }
}

impl Serialize for Ir {
    fn serialize<SerializerType>(
        &self,
        serializer: SerializerType,
    ) -> Result<SerializerType::Ok, SerializerType::Error>
    where
        SerializerType: Serializer,
    {
        self.structural().serialize(serializer)
    }
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

impl Serialize for HandlersRef {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::HandlersRefOutput::from(self).serialize(serializer)
    }
}

impl Serialize for TextOutlinePath {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::TextOutlinePathOutput::from(self).serialize(serializer)
    }
}

impl Serialize for ShapePartPaint {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::ShapePartPaintOutput::from(self).serialize(serializer)
    }
}

impl Serialize for ShapePathPart {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::ShapePathPartOutput::from(self).serialize(serializer)
    }
}

impl Serialize for AnimationTransform2D {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::AnimationTransform2DOutput::from(self).serialize(serializer)
    }
}

impl Serialize for AnimationKeyframe {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::AnimationKeyframeOutput::from(self).serialize(serializer)
    }
}

impl Serialize for AnimationSpring {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::AnimationSpringOutput::from(self).serialize(serializer)
    }
}

impl Serialize for AnimationSteps {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::AnimationStepsOutput::from(self).serialize(serializer)
    }
}

impl Serialize for AnimationSpec {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::AnimationSpecOutput::from(self).serialize(serializer)
    }
}

impl Serialize for TextUnitAnimation {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::TextUnitAnimationOutput::from(self).serialize(serializer)
    }
}

impl Serialize for TextUnitAnimationSample {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::TextUnitAnimationSampleOutput::from(self).serialize(serializer)
    }
}

impl Serialize for IrNode {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::IrNodeOutput::from(self).serialize(serializer)
    }
}

impl Serialize for AnimationEasing {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::AnimationEasingOutput::from(self).serialize(serializer)
    }
}

impl Serialize for IrNodeKind {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        super::wire_output::IrNodeKindOutput::from(self).serialize(serializer)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::{PipelineStage, RecoverableCode, SerializedRecoverableError};

    #[test]
    fn recoverable_warning_constructor_fixes_the_required_wire_fields() {
        let warning = SerializedRecoverableError::recoverable(
            RecoverableCode::ImageLoadFailed,
            "warning message",
            PipelineStage::Ir,
            Some("node-1".to_string()),
            "deterministic fallback",
        );

        assert_eq!(warning.code, "IMAGE_LOAD_FAILED");
        assert_eq!(warning.message, "warning message");
        assert_eq!(warning.stage, PipelineStage::Ir);
        assert_eq!(warning.node_id.as_deref(), Some("node-1"));
        assert_eq!(warning.fallback, "deterministic fallback");
    }

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
        let deserialized: IrNode =
            serde_json::from_str::<crate::ir::wire_input::IrNodeInput>(&serialized)
                .map(IrNode::from)
                .expect("deserializes");
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
        let lines: Vec<Line> = serde_json::from_str::<Vec<LineWire>>(wire)
            .expect("deserializes")
            .into_iter()
            .map(Line::from)
            .collect();
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
