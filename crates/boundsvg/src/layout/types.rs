use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::flow::geometry::FlowExclusionShape;
use crate::font::FontStyle;
use crate::font::shaping;
use crate::text::types::{
    RichTextNodeInput, TextShadowLayer, TextSpanInput, TextStrokeLayer, default_weight,
};

/// Input node from TS side (JSON)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutInput {
    pub root: LayoutNodeInput,
    #[serde(default)]
    pub fonts: Vec<FontInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontInput {
    pub alias: String,
    #[serde(default = "default_weight")]
    pub weight: u16,
    #[serde(default)]
    pub style: FontStyle,
    pub data: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutNodeInput {
    pub node_id: String,
    pub node_type: String,
    /// Whether `node_id` came from an authored source ID rather than the
    /// deterministic TS auto-ID generator.
    pub authored_id: bool,
    #[serde(default)]
    pub style: TaffyStyleInput,
    #[serde(default)]
    pub children: Vec<LayoutNodeInput>,
    /// For text nodes
    #[serde(default)]
    pub text: Option<TextInput>,
    /// For `TextOnPath` nodes.
    #[serde(default)]
    pub text_path: Option<TextPathInput>,
    /// For image nodes
    #[serde(default)]
    pub image: Option<ImageInput>,
    /// Visual properties for IR building. Deserialized and held for the Rust
    /// IR builder.
    #[serde(default)]
    pub visual: Option<VisualInput>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaffyStyleInput {
    pub display: Option<String>,
    pub flex_direction: Option<String>,
    pub flex_wrap: Option<String>,
    pub align_items: Option<String>,
    pub justify_content: Option<String>,
    pub align_self: Option<String>,
    pub flex_grow: Option<f32>,
    pub flex_shrink: Option<f32>,
    pub flex_basis: Option<f32>,
    pub gap: Option<f32>,
    pub row_gap: Option<f32>,
    pub column_gap: Option<f32>,
    pub width: Option<f32>,
    pub height: Option<f32>,
    pub min_width: Option<f32>,
    pub min_height: Option<f32>,
    pub max_width: Option<f32>,
    pub max_height: Option<f32>,
    pub padding: Option<[f32; 4]>,
    pub margin: Option<[f32; 4]>,
    pub overflow: Option<String>,
    // Grid-specific
    pub grid_template_columns: Option<Vec<String>>,
    pub grid_template_rows: Option<Vec<String>>,
    pub grid_column_start: Option<i16>,
    pub grid_column_end: Option<i16>,
    pub grid_row_start: Option<i16>,
    pub grid_row_end: Option<i16>,
    pub justify_items: Option<String>,
    // Positioning
    pub position: Option<String>,
    /// [top, right, bottom, left]; `None` per side = auto (side not specified).
    pub inset: Option<[Option<f32>; 4]>,
    // Aspect ratio
    pub aspect_ratio: Option<f32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextInput {
    pub content: String,
    #[serde(default)]
    pub spans: Option<Vec<TextSpanInput>>,
    #[serde(default)]
    pub rich_text: Option<Vec<RichTextNodeInput>>,
    pub font_size_px: f64,
    #[serde(default)]
    pub line_height: Option<f64>,
    #[serde(default)]
    pub line_height_px: Option<f64>,
    #[serde(default)]
    pub letter_spacing_px: Option<f64>,
    #[serde(default)]
    pub text_indent: Option<f64>,
    #[serde(default)]
    pub font_family: Vec<String>,
    #[serde(default = "default_weight")]
    pub font_weight: u16,
    #[serde(default)]
    pub font_style: FontStyle,
    #[serde(default = "default_wrap")]
    pub wrap: String,
    #[serde(default)]
    pub max_lines: Option<usize>,
    #[serde(default)]
    pub preferred_frame: Option<PreferredFrame>,
    #[serde(default)]
    pub writing_mode: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub text_orientation: Option<String>,
    #[serde(default)]
    pub fit: Option<String>,
    #[serde(default)]
    pub min_font_size_px: Option<f64>,
    #[serde(default)]
    pub shrink_epsilon_px: Option<f64>,
    #[serde(default)]
    pub shrink_max_iterations: Option<usize>,
    #[serde(default)]
    pub max_font_size_px: Option<f64>,
    #[serde(default)]
    pub grow_epsilon_px: Option<f64>,
    #[serde(default)]
    pub grow_max_iterations: Option<usize>,
    #[serde(default)]
    pub fit_max_probes: Option<usize>,
    #[serde(default)]
    pub ellipsis: Option<bool>,
    #[serde(default)]
    pub hanging_punctuation: Option<bool>,
    #[serde(default)]
    pub white_space: Option<String>,
    #[serde(default)]
    pub tab_size: Option<u32>,
    #[serde(default)]
    pub(crate) flow: Option<TextFlowLayoutInput>,
    #[serde(default)]
    pub font_variation_settings: Option<String>,
    #[serde(default)]
    pub font_feature_settings: Option<String>,
    /// Internal opt-in consumed by the text unit foundation for per-unit
    /// animation layout.
    #[serde(default)]
    pub unit_map: Option<TextUnitMapRequest>,
    #[serde(default)]
    pub text_decoration_range_count: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPathInput {
    pub spans: Vec<TextSpanInput>,
    pub decoration_owner_ids: Vec<Option<u32>>,
    #[serde(default)]
    pub text_decoration_range_count: Option<usize>,
    pub source_item_count: usize,
    pub inline_count: usize,
    pub d: String,
    pub font_size_px: f64,
    #[serde(default)]
    pub letter_spacing_px: Option<f64>,
    #[serde(default)]
    pub font_family: Vec<String>,
    #[serde(default = "default_weight")]
    pub font_weight: u16,
    #[serde(default)]
    pub font_style: FontStyle,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub font_variation_settings: Option<String>,
    #[serde(default)]
    pub font_feature_settings: Option<String>,
    #[serde(default)]
    pub start_offset_px: Option<f64>,
    #[serde(default)]
    pub text_anchor: Option<String>,
    #[serde(default)]
    pub path_direction: Option<String>,
    #[serde(default)]
    pub path_normal: Option<String>,
    #[serde(default)]
    pub path_offset_px: Option<f64>,
    #[serde(default)]
    pub path_fit: Option<String>,
    #[serde(default)]
    pub path_overflow: Option<String>,
    #[serde(default)]
    pub unit_map: Option<TextUnitMapRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowLayoutInput {
    #[serde(default)]
    pub(crate) exclusions: Vec<FlowExclusionShape>,
    #[serde(default)]
    pub(crate) min_region_width_px: Option<f64>,
}

#[derive(Debug, Clone, Copy, Deserialize, Hash)]
#[serde(rename_all = "camelCase")]
pub struct TextUnitMapRequest {
    pub kind: crate::text::unit_map::TextUnitKind,
    pub ruby: crate::text::unit_map::TextUnitRubyMode,
}

pub(crate) fn default_wrap() -> String {
    "char".to_string()
}

pub(crate) fn parse_variation_settings_opt(css: Option<&str>) -> Vec<shaping::VariationSetting> {
    css.map(shaping::parse_css_font_variation_settings)
        .unwrap_or_default()
}

pub(crate) fn parse_feature_settings_opt(css: Option<&str>) -> Vec<shaping::FeatureSetting> {
    css.map(shaping::parse_css_font_feature_settings)
        .unwrap_or_default()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferredFrame {
    pub w: Option<f32>,
    pub h: Option<f32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInput {
    pub width: f32,
    pub height: f32,
}

/// Raw visual props carried from the TS serializer for IR building.
/// Values are transported uninterpreted (gradient strings, box-shadow
/// strings, raw border radius); interpretation happens at IR build.
/// Text style fields already carried by [`TextInput`] are not duplicated
/// here; only text visuals the text pipeline does not transport (color,
/// alignment, stroke/shadow layers, unset-vs-default weight) are included.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualInput {
    // Box visuals
    pub background: Option<String>,
    pub border_width: Option<f64>,
    pub border_color: Option<String>,
    pub border_radius: Option<BorderRadiusInputValue>,
    pub overflow: Option<String>,
    pub box_shadow: Option<String>,
    pub opacity: Option<f64>,
    pub z_index: Option<f64>,
    pub transform: Option<boundshape::Transform2D>,
    pub animation: Option<crate::ir::types::AnimationSpec>,
    pub unit_animation: Option<crate::ir::types::TextUnitAnimation>,
    pub inline_rect_animations: Option<BTreeMap<String, crate::ir::types::AnimationSpec>>,
    /// Animations for fragmentable decorated-span fragments, keyed by the
    /// `spanKey` echoed on `InlineBoxDecoration` outputs.
    pub inline_decoration_animations: Option<BTreeMap<String, crate::ir::types::AnimationSpec>>,
    pub meta: Option<BTreeMap<String, String>>,
    /// Canvas-only declarative debug overlay flag.
    pub debug: Option<bool>,

    // Stroke styling (border rect / path / shape)
    pub stroke_scaling: Option<crate::ir::types::StrokeScaling>,
    pub stroke_linecap: Option<String>,
    pub stroke_linejoin: Option<String>,
    pub stroke_dasharray: Option<String>,
    pub stroke_miterlimit: Option<f64>,

    // Paint (path / shape)
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub stroke_width: Option<f64>,
    pub fill_rule: Option<String>,

    // Path
    pub d: Option<String>,

    // Text visuals not carried by TextInput
    pub color: Option<String>,
    pub text_align: Option<String>,
    /// Raw author value; `TextInput.font_weight` is defaulted on the wire and
    /// cannot distinguish unset from 400.
    pub font_weight: Option<u16>,
    /// Raw author value; `TextInput.font_family` folds the fallback list into
    /// one array and cannot distinguish an empty list from unset.
    pub font_fallback: Option<Vec<String>>,
    pub text_stroke: Option<String>,
    pub text_stroke_width: Option<f64>,
    pub text_stroke_linecap: Option<String>,
    pub text_stroke_linejoin: Option<String>,
    pub text_stroke_dasharray: Option<String>,
    pub text_stroke_miterlimit: Option<f64>,
    pub text_strokes: Option<Vec<TextStrokeLayer>>,
    pub text_shadows: Option<Vec<TextShadowLayer>>,

    // Image
    /// Embedded image source (data URI or reference URL). The TS serializer
    /// converts byte sources to data URIs; absence means the source could
    /// not be embedded (load-failure fallback at IR build).
    pub src: Option<String>,
    pub object_fit: Option<String>,
    pub object_position: Option<String>,

    // Nested svg
    pub svg_content: Option<String>,
    pub content_id_prefix: Option<String>,
    /// Raw prop value ("none" | "meet" | "slice"); shared by Svg and Shape.
    pub preserve_aspect_ratio: Option<String>,

    // Shape / Symbol (registry references resolved by the TS serializer)
    pub shape_geometry: Option<boundshape::GeometryDoc>,
    /// Raw registry id; carried so unresolvable-reference diagnostics can
    /// name the id even though resolution happens at serialization.
    pub shape_geometry_id: Option<String>,
    pub symbol_definition: Option<boundshape::SymbolDefinition>,
    /// Raw registry id (see `shape_geometry_id`).
    pub symbol_id: Option<String>,
    pub emit_part_ids: Option<bool>,
    pub part_paint: Option<PartPaintMap>,

    // Event handlers
    pub handlers: Option<HandlersInput>,
}

/// Raw border radius: uniform number or [topLeft, topRight, bottomRight,
/// bottomLeft]. Clamping to the box happens at IR build, not on the wire.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum BorderRadiusInputValue {
    Uniform(f64),
    PerCorner([f64; 4]),
}

/// partPaint entries in authored (JSON insertion) order. A sorted map would
/// reorder the unknown-part warnings the IR builder emits, and warning order
/// is part of the observable contract.
#[derive(Debug, Clone)]
pub struct PartPaintMap(pub Vec<(String, PartPaintOverrideInput)>);

impl PartPaintMap {
    #[must_use]
    pub fn get(&self, part_id: &str) -> Option<&PartPaintOverrideInput> {
        self.0
            .iter()
            .find(|(key, _)| key == part_id)
            .map(|(_, entry)| entry)
    }
}

impl<'de> serde::Deserialize<'de> for PartPaintMap {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct EntriesVisitor;

        impl<'de> serde::de::Visitor<'de> for EntriesVisitor {
            type Value = PartPaintMap;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a partPaint object")
            }

            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<PartPaintMap, A::Error> {
                let mut entries = Vec::new();
                while let Some(entry) = map.next_entry::<String, PartPaintOverrideInput>()? {
                    entries.push(entry);
                }
                Ok(PartPaintMap(entries))
            }
        }

        deserializer.deserialize_map(EntriesVisitor)
    }
}

/// Per-part paint override; mirrors TS `PartPaintOverride`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartPaintOverrideInput {
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub stroke_width: Option<f64>,
    pub stroke_linecap: Option<String>,
    pub stroke_linejoin: Option<String>,
    pub stroke_dasharray: Option<String>,
    pub stroke_miterlimit: Option<f64>,
}

/// Event handler references keyed by handler name; mirrors TS `HandlersRef`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandlersInput {
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

/// Output layout result for TS side (JSON)
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutOutput {
    pub nodes: Vec<LayoutNodeOutput>,
    pub measure_call_count: usize,
    pub measure_cache_hits: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutNodeOutput {
    pub node_id: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_layout: Option<TextLayoutOutput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLayoutOutput {
    pub glyphs: Vec<shaping::GlyphInfo>,
    pub measured_width: f64,
    pub measured_height: f64,
    /// Full text layout from the Rust Text Engine (when available).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines: Option<Vec<crate::text::types::Line>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bbox: Option<crate::text::types::TextBBox>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chosen_font_size_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overflow: Option<crate::text::types::TextOverflow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_text: Option<String>,
    /// Opt-in stable text paint-unit metadata from boundtext.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_map: Option<crate::text::unit_map::TextUnitMap>,
    /// Recoverable text warnings (e.g. `MISSING_GLYPH`). Omitted when empty
    /// so the JSON stays byte-identical for warning-free layouts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<crate::text::types::TextWarning>,
    /// Background / border rectangles for `Inline` and `InlineBox` decorations,
    /// in text-local coordinates. Omitted when empty so the JSON stays
    /// byte-identical for undecorated text.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inline_box_decorations: Vec<crate::text::types::InlineBoxDecoration>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub text_decorations: Vec<crate::text::types::TextDecorationFragment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inline_rects: Vec<crate::text::types::InlineRectFragment>,
}

pub(super) const MEASURE_CACHE_MAX: usize = 256;
pub(super) const SHAPED_CACHE_MAX: usize = 128;
