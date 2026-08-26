use serde::{Deserialize, Serialize};

use crate::font::FontStyle;
use crate::font::line_metrics::FALLBACK_NORMAL_LINE_HEIGHT_FACTOR;
use crate::font::shaping::{FeatureSetting, GlyphInfo, VariationSetting};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WrapMode {
    None,
    Word,
    Char,
}

impl WrapMode {
    #[must_use]
    pub fn parse_str(value: &str) -> Self {
        match value {
            "none" => WrapMode::None,
            "word" => WrapMode::Word,
            _ => WrapMode::Char,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FitMode {
    None,
    Shrink,
    Grow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextAlign {
    Start,
    Center,
    End,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "schema", schemars(rename_all = "kebab-case"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WritingMode {
    HorizontalTb,
    VerticalRl,
}

impl WritingMode {
    #[must_use]
    pub fn from_option(value: Option<&str>) -> Self {
        match value {
            Some("vertical-rl") => WritingMode::VerticalRl,
            _ => WritingMode::HorizontalTb,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WhiteSpaceMode {
    Normal,
    NoWrap,
    PreWrap,
}

impl WhiteSpaceMode {
    #[must_use]
    pub fn from_option(value: Option<&str>) -> Self {
        match value {
            Some("nowrap") => WhiteSpaceMode::NoWrap,
            Some("pre-wrap") => WhiteSpaceMode::PreWrap,
            _ => WhiteSpaceMode::Normal,
        }
    }
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "schema", schemars(rename_all = "lowercase"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    Ja,
    En,
    Auto,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextOrientation {
    Mixed,
    Upright,
}

impl TextOrientation {
    #[must_use]
    pub fn from_option(value: Option<&str>) -> Self {
        match value {
            Some("upright") => TextOrientation::Upright,
            _ => TextOrientation::Mixed,
        }
    }
}

impl Language {
    #[must_use]
    pub fn from_option(value: Option<&str>) -> Self {
        match value {
            Some("ja") => Language::Ja,
            Some("en") => Language::En,
            _ => Language::Auto,
        }
    }
}

// ---------------------------------------------------------------------------
// Text layout result types (Rust → TS via JSON)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextOverflow {
    #[serde(rename = "type")]
    pub overflow_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl TextOverflow {
    /// Return whether this status means that a layout constraint was violated.
    #[must_use]
    pub(crate) fn is_constraint_overflow(&self) -> bool {
        !matches!(self.overflow_type.as_str(), "none" | "kinsoku_unresolved")
    }

    #[must_use]
    pub fn none() -> Self {
        Self {
            overflow_type: "none".to_string(),
            reason: None,
        }
    }

    #[must_use]
    pub fn overflow(reason: &str) -> Self {
        Self {
            overflow_type: "overflow".to_string(),
            reason: Some(reason.to_string()),
        }
    }

    #[must_use]
    pub fn kinsoku_unresolved() -> Self {
        Self {
            overflow_type: "kinsoku_unresolved".to_string(),
            reason: None,
        }
    }

    #[must_use]
    pub fn cannot_fit() -> Self {
        Self {
            overflow_type: "cannot_fit".to_string(),
            reason: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextDecorationLine {
    Underline,
    Overline,
    LineThrough,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextDecorationStyle {
    #[default]
    Solid,
    Double,
    Dotted,
    Dashed,
    Wavy,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextDecorationSkipInk {
    #[default]
    None,
    All,
}

#[cfg(feature = "schema")]
struct SerializedTextDecorationSkipInk;

#[cfg(feature = "schema")]
impl crate::schema::StringEnumSchemaDomain for SerializedTextDecorationSkipInk {
    const NAME: &'static str = "SerializedTextDecorationSkipInk";
    const VALUES: &'static [&'static str] = &["all"];
}

#[cfg(feature = "schema")]
struct TextStrokeLinecapSchema;

#[cfg(feature = "schema")]
impl crate::schema::StringEnumSchemaDomain for TextStrokeLinecapSchema {
    const NAME: &'static str = "TextStrokeLinecapSchema";
    const VALUES: &'static [&'static str] = &["butt", "round", "square"];
}

#[cfg(feature = "schema")]
struct TextStrokeLinejoinSchema;

#[cfg(feature = "schema")]
impl crate::schema::StringEnumSchemaDomain for TextStrokeLinejoinSchema {
    const NAME: &'static str = "TextStrokeLinejoinSchema";
    const VALUES: &'static [&'static str] = &["miter", "round", "bevel"];
}

#[cfg(feature = "schema")]
struct SyntheticGlyphKindSchema;

#[cfg(feature = "schema")]
impl crate::schema::StringEnumSchemaDomain for SyntheticGlyphKindSchema {
    const NAME: &'static str = "SyntheticGlyphKindSchema";
    const VALUES: &'static [&'static str] = &["ellipsis"];
}

const fn is_skip_ink_none(value: &TextDecorationSkipInk) -> bool {
    matches!(value, TextDecorationSkipInk::None)
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextDecorationInput {
    pub line: Vec<TextDecorationLine>,
    pub color: String,
    #[serde(default)]
    pub style: TextDecorationStyle,
    #[serde(default)]
    pub thickness_px: Option<f64>,
    #[serde(default)]
    pub offset_px: f64,
    #[serde(default)]
    pub skip_ink: TextDecorationSkipInk,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDecorationPaintPath {
    #[serde(skip)]
    pub line_index: u32,
    pub d: String,
    pub origin_x: f64,
    pub origin_y: f64,
    pub contour_count: u32,
    pub segment_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_distance_start_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_distance_end_px: Option<f64>,
    #[serde(skip)]
    pub path_phase_origin_px: Option<f64>,
    #[serde(skip)]
    pub error: Option<TextDecorationPaintError>,
    #[serde(skip)]
    pub thickness_px: f64,
    #[serde(skip)]
    pub decoration_owner_id: Option<u32>,
    #[serde(skip)]
    pub path_normal_offset_px: Option<f64>,
    #[serde(skip)]
    pub path_ribbon_half_width_px: Option<f64>,
    #[serde(skip)]
    pub path_sample_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextDecorationPaintError {
    ComplexityLimit,
    Geometry,
    PatternLimit,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDecorationFragment {
    pub line: TextDecorationLine,
    pub style: TextDecorationStyle,
    pub color: String,
    #[cfg_attr(
        feature = "schema",
        schemars(
            with = "crate::schema::DirectionalSchema<crate::schema::StringEnumSchema<SerializedTextDecorationSkipInk>, TextDecorationSkipInk>"
        )
    )]
    #[serde(default, skip_serializing_if = "is_skip_ink_none")]
    pub skip_ink: TextDecorationSkipInk,
    pub paths: Vec<TextDecorationPaintPath>,
    pub source_start: u32,
    pub source_end: u32,
}

/// Physical geometry used when a glyph participates in an atomic inline box
/// whose logical decoration axes differ from the glyph's shaping axes.
#[derive(Debug, Clone, Copy)]
#[doc(hidden)]
pub struct TextDecorationGlyphGeometry {
    pub inline_start: f64,
    pub inline_end: f64,
    pub baseline: f64,
    pub block_half_extent: f64,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionedGlyph {
    pub glyph_id: u32,
    pub text: String,
    /// Inclusive UTF-8 byte offset in the glyph's shaping source. Content and
    /// ruby-base glyphs use the normalized base document; ruby annotations use
    /// their annotation level's local text.
    pub cluster_start: u32,
    /// Exclusive UTF-8 byte offset in the same shaping source. The cluster
    /// range is not a cross-role identity; use the source role or the unit map
    /// when comparing glyphs from different source namespaces.
    pub cluster_end: u32,
    /// Grapheme range in the logical base text, stable for selection across
    /// rich-text runs. Ruby annotations point to the base-text range they
    /// annotate.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_start: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_end: Option<u32>,
    #[cfg_attr(
        feature = "schema",
        schemars(
            with = "Option<crate::schema::DirectionalSchema<super::unit_map::TextUnitSourceRole, String>>"
        )
    )]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_role: Option<String>,
    /// Internal source range used only by text-decoration resolution. Ruby
    /// annotations keep their own local range here while public source fields
    /// continue to point at the annotated base text.
    #[serde(skip)]
    pub decoration_source_start: Option<u32>,
    #[serde(skip)]
    pub decoration_source_end: Option<u32>,
    /// Internal namespace for decoration-local source coordinates. Ruby
    /// annotations also use it to keep equal text on distinct annotation
    /// levels from collapsing into one unit-map identity.
    #[serde(skip)]
    pub decoration_level: Option<u32>,
    #[serde(skip)]
    pub path_decoration_owner_id: Option<u32>,
    #[serde(skip)]
    pub path_distance_start_px: Option<f64>,
    #[serde(skip)]
    pub path_distance_end_px: Option<f64>,
    #[serde(skip)]
    #[doc(hidden)]
    pub text_decoration_geometry: Option<TextDecorationGlyphGeometry>,
    pub font_alias: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub font_fallback: Vec<String>,
    pub font_weight: u16,
    pub font_style: FontStyle,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_variation_settings: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_feature_settings: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_strokes: Option<Vec<TextStrokeLayer>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_shadows: Option<Vec<TextShadowLayer>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paint_range_index: Option<u32>,
    pub origin_x: f64,
    pub origin_y: f64,
    pub x_offset: f64,
    pub y_offset: f64,
    pub x_advance: f64,
    pub y_advance: f64,
    pub rotation_deg: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_rotation_deg: Option<f64>,
    /// Additive scale along the shaped inline axis, applied before baseline
    /// rotation. Absent and `1` are canonical-equivalent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inline_scale: Option<f64>,
    /// Identifies glyphs synthesized by layout rather than sourced from the
    /// authored text.
    #[cfg_attr(
        feature = "schema",
        schemars(
            with = "Option<crate::schema::DirectionalSchema<crate::schema::StringEnumSchema<SyntheticGlyphKindSchema>, String>>"
        )
    )]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synthetic_kind: Option<String>,
    #[cfg_attr(
        feature = "schema",
        schemars(with = "Option<crate::schema::DirectionalSchema<WritingMode, String>>")
    )]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline_writing_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub absolute_position: Option<bool>,
}

impl PositionedGlyph {
    pub(crate) fn translate(&mut self, dx: f64, dy: f64) {
        self.origin_x += dx;
        self.origin_y += dy;
        if let Some(geometry) = self.text_decoration_geometry.as_mut() {
            geometry.inline_start += dy;
            geometry.inline_end += dy;
            geometry.baseline += dx;
        }
    }
}

/// Style information for a text run fragment.
/// Carried on each `LineFragment` so the SVG emitter can set per-fragment
/// font-family, font-size, color, etc.
///
/// Field names match the canonical TS `TextRunStyle` interface
/// (`packages/core/src/text/types.ts`).
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRunStyle {
    /// Primary font alias (first element of font-family chain).
    pub font: String,
    /// Fallback font aliases (remaining elements of font-family chain).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fallback: Vec<String>,
    pub font_weight: u16,
    pub font_style: FontStyle,
    pub font_size_px: f64,
    pub letter_spacing_px: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_orientation: Option<TextOrientation>,
    /// Font variation settings string (e.g. `"wght" 700`).
    /// Populated from `VNode` props via enriched input.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_variation_settings: Option<String>,
    /// Font feature settings string (e.g. `"liga" 1, "smcp" 1`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_feature_settings: Option<String>,
    /// Per-fragment color. Populated from `VNode` props via enriched input;
    /// `None` means inherit from the parent Text node's color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_strokes: Option<Vec<TextStrokeLayer>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_shadows: Option<Vec<TextShadowLayer>>,
    #[cfg_attr(
        feature = "schema",
        schemars(with = "Option<crate::schema::DirectionalSchema<Language, String>>")
    )]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineFragment {
    pub text: String,
    pub glyphs: Vec<GlyphInfo>,
    pub width: f64,
    /// Per-fragment style for inline runs (font, color, etc.).
    /// Always populated by `inline_runs::apply_inline_fragments()`.
    pub style: TextRunStyle,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub text: String,
    pub glyphs: Vec<GlyphInfo>,
    pub width: f64,
    pub baseline_y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fragments: Option<Vec<LineFragment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub positioned_glyphs: Option<Vec<PositionedGlyph>>,
}

/// Resolved physical geometry for an authored inline rectangle.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineRectFragment {
    pub fragment_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub color: String,
    pub border_radius_px: f64,
    pub opacity: f64,
    pub paint_order: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLayoutResult {
    pub lines: Vec<Line>,
    pub bbox: TextBBox,
    pub chosen_font_size_px: f64,
    pub overflow: TextOverflow,
    /// Authored source text when layout creates a distinct display sequence.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_text: Option<String>,
    /// Shaped display sequence when it differs semantically from the source.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_text: Option<String>,
    /// Stable paint-unit metadata. Generated only for an opt-in caller after
    /// layout has completed, so ordinary text serialization remains unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_map: Option<super::unit_map::TextUnitMap>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<TextWarning>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inline_box_decorations: Vec<InlineBoxDecoration>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub text_decorations: Vec<TextDecorationFragment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inline_rects: Vec<InlineRectFragment>,
}

impl TextLayoutResult {
    /// Replace ASCII spaces with NBSP (U+00A0) in all `PositionedGlyph.text`
    /// fields. Used in `PreWrap` mode to prevent SVG whitespace collapsing.
    pub fn convert_spaces_to_nbsp(&mut self) {
        for line in &mut self.lines {
            if let Some(glyphs) = &mut line.positioned_glyphs {
                for glyph in glyphs {
                    if glyph.text.contains(' ') {
                        glyph.text = glyph.text.replace(' ', "\u{00A0}");
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// InlineBox decoration metadata (Rust → consumer via layout result)
// ---------------------------------------------------------------------------

/// Decoration metadata for an `InlineBox` positioned during rich text layout.
///
/// Coordinates are relative to the text block origin (top-left of `TextBBox`).
/// - `x`: token start on its line.
/// - `y`: line top (`baseline_y` minus ascent-based offset).
/// - `width`: total token advance (children + `padding_inline` + `border_width` * 2).
/// - `height`: line box height (`line_height_px`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineBoxDecoration {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_width: Option<f64>,
    /// Per-corner border radii: [top-left, top-right, bottom-right, bottom-left].
    /// `None` means no rounding. Uniform radius is represented as [r, r, r, r].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_radius: Option<[f64; 4]>,
    /// Provenance key echoed from `RichTextNodeInput::DecoratedSpan::span_key`.
    /// `None` for atomic `InlineBox` decorations and unkeyed spans.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span_key: Option<String>,
}

// ---------------------------------------------------------------------------
// Intrinsic inline-size measurement result
// ---------------------------------------------------------------------------

/// Min-content and max-content intrinsic inline sizes for text.
///
/// - `min_content_inline_size`: the widest single unbreakable token (atomic inline box
///   or shaped grapheme cluster).
/// - `max_content_inline_size`: the widest logical inline run without inline-size
///   constraints. In horizontal text this is physical line width; in vertical
///   text this is physical column height. Newline-only tokens act as separators.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntrinsicInlineSizes {
    pub min_content_inline_size: f64,
    pub max_content_inline_size: f64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<TextWarning>,
}

// ---------------------------------------------------------------------------
// Text layout request (internal — not deserialized from JSON)
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct TextLayoutRequest<'a> {
    pub text: &'a str,
    pub spans: Option<&'a [TextSpanInput]>,
    pub rich_text: Option<&'a [RichTextNodeInput]>,
    pub font_size_px: f64,
    pub line_height: Option<f64>,
    pub line_height_px: Option<f64>,
    pub letter_spacing_px: f64,
    pub text_indent: Option<f64>,
    pub max_width: f64,
    pub max_height: Option<f64>,
    pub wrap: WrapMode,
    pub white_space: WhiteSpaceMode,
    pub tab_size: u32,
    pub fit: FitMode,
    pub max_lines: Option<usize>,
    pub ellipsis: bool,
    pub language: Language,
    pub writing_mode: WritingMode,
    pub text_orientation: TextOrientation,
    pub uax14_breaks: Option<&'a [usize]>,
    pub hanging_punctuation: bool,
    /// Font variation settings (parsed from CSS `font-variation-settings`).
    pub font_variation_settings: Vec<VariationSetting>,
    /// Font feature settings (parsed from CSS `font-feature-settings`).
    pub font_feature_settings: Vec<FeatureSetting>,
    // Fit params
    pub min_font_size_px: Option<f64>,
    pub shrink_epsilon_px: Option<f64>,
    pub shrink_max_iterations: Option<usize>,
    pub max_font_size_px: Option<f64>,
    pub grow_epsilon_px: Option<f64>,
    pub grow_max_iterations: Option<usize>,
    /// Work limit for an uncertified exact-grid fit search.
    pub fit_max_probes: Option<usize>,
}

impl TextLayoutRequest<'_> {
    /// Resolve effective line height in px.
    ///
    /// This fallback does not have access to a font registry. Layout code that
    /// has a `FontContext` should use font-metrics based helpers instead.
    #[must_use]
    pub fn resolve_line_height_px(&self) -> f64 {
        self.line_height_px.unwrap_or_else(|| {
            self.font_size_px
                * self
                    .line_height
                    .unwrap_or(FALLBACK_NORMAL_LINE_HEIGHT_FACTOR)
        })
    }

    /// Check if vertical writing mode.
    #[must_use]
    pub fn is_vertical(&self) -> bool {
        self.writing_mode == WritingMode::VerticalRl
    }

    #[must_use]
    pub fn has_rich_text(&self) -> bool {
        self.rich_text.is_some_and(|nodes| !nodes.is_empty())
    }

    /// Effective wrap mode, accounting for `white_space`.
    /// `NoWrap` overrides any wrap setting to `WrapMode::None`.
    #[must_use]
    pub fn effective_wrap(&self) -> WrapMode {
        if self.white_space == WhiteSpaceMode::NoWrap {
            WrapMode::None
        } else {
            self.wrap
        }
    }

    /// Whether `\n` should force a line break (true for `PreWrap`).
    #[must_use]
    pub fn has_forced_newline_breaks(&self) -> bool {
        self.white_space == WhiteSpaceMode::PreWrap
    }
}

/// Whether the authored fit predicate has the scalar preconditions required
/// for binary refinement.
///
/// Negative tracking can make line topology non-monotone as font size changes:
/// a larger run can overlap enough to fit again after an intermediate size
/// overflowed. Negative proportional line/ruby offsets have the same proof
/// problem. Such inputs must use exact-grid search.
pub(crate) fn is_text_fit_certified_monotone(req: &TextLayoutRequest<'_>) -> bool {
    if req.letter_spacing_px < 0.0 || req.line_height.is_some_and(|value| value < 0.0) {
        return false;
    }
    if req.spans.is_some_and(|spans| {
        spans.iter().any(|span| {
            span.font_size_px < 0.0 || span.letter_spacing_px.is_some_and(|value| value < 0.0)
        })
    }) {
        return false;
    }
    is_rich_text_fit_certified_monotone(req.rich_text)
}

/// Determine whether every rich style preserves monotone font-size fit.
pub(crate) fn is_rich_text_fit_certified_monotone(rich_text: Option<&[RichTextNodeInput]>) -> bool {
    let Some(nodes) = rich_text else {
        return true;
    };
    let mut pending = nodes.iter().collect::<Vec<_>>();
    while let Some(node) = pending.pop() {
        let is_style_uncertified = |style: &RichTextStyleInput| {
            style.font_size_px < 0.0
                || style.letter_spacing_px.is_some_and(|value| value < 0.0)
                || style.line_height.is_some_and(|value| value < 0.0)
        };
        match node {
            RichTextNodeInput::Text { .. } | RichTextNodeInput::InlineRect { .. } => {}
            RichTextNodeInput::Span { style, .. } | RichTextNodeInput::Combine { style, .. } => {
                if is_style_uncertified(style) {
                    return false;
                }
            }
            RichTextNodeInput::Ruby {
                style,
                base,
                rt,
                rt_levels,
                ruby_gap_px,
                ruby_offset_px,
                ..
            } => {
                if is_style_uncertified(style)
                    || ruby_gap_px.is_some_and(|value| value < 0.0)
                    || ruby_offset_px.is_some_and(|value| value < 0.0)
                {
                    return false;
                }
                pending.extend(base);
                pending.extend(rt);
                for level in rt_levels {
                    pending.extend(level);
                }
            }
            RichTextNodeInput::InlineBox {
                style, children, ..
            }
            | RichTextNodeInput::DecoratedSpan {
                style, children, ..
            } => {
                if is_style_uncertified(style) {
                    return false;
                }
                pending.extend(children);
            }
        }
    }
    true
}

/// Expand tab characters to spaces.
///
/// Used in `PreWrap` mode before shaping.
#[must_use]
pub fn expand_tabs(text: &str, tab_size: u32) -> String {
    let spaces: String = " ".repeat(tab_size as usize);
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\t', &spaces)
}

/// Collapse runs of ASCII whitespace into a single space, matching
/// CSS `white-space: normal` semantics.
///
/// - Sequences of spaces, tabs, `\n`, and `\r` become a single ` `.
/// - Leading and trailing whitespace is removed.
#[must_use]
pub fn collapse_whitespace(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut in_ws = false;
    for ch in text.chars() {
        if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
            if !in_ws && !result.is_empty() {
                result.push(' ');
            }
            in_ws = true;
        } else {
            in_ws = false;
            result.push(ch);
        }
    }
    if result.ends_with(' ') {
        result.pop();
    }
    result
}

/// Preprocess plain text according to the requested `white-space` mode.
///
/// - `Normal`: collapse ASCII whitespace runs to a single space.
/// - `NoWrap`: same collapse behavior as `Normal`, but wrapping is disabled later.
/// - `PreWrap`: preserve spaces/newlines and only expand tabs.
#[must_use]
pub fn preprocess_text_for_white_space(
    text: &str,
    white_space: WhiteSpaceMode,
    tab_size: u32,
) -> String {
    match white_space {
        WhiteSpaceMode::Normal | WhiteSpaceMode::NoWrap => collapse_whitespace(text),
        WhiteSpaceMode::PreWrap => expand_tabs(text, tab_size),
    }
}

/// Normalize white space across a sequence of style-run texts.
///
/// Mirrors [`preprocess_text_for_white_space`] applied to the concatenated
/// text, but distributes the result back onto the individual runs so
/// style boundaries are preserved: a whitespace run collapsing across a
/// boundary keeps its single space in the run where it started.
///
/// Returns `None` when no run text changes.
#[must_use]
pub fn preprocess_span_texts_for_white_space(
    texts: &[&str],
    white_space: WhiteSpaceMode,
    tab_size: u32,
) -> Option<Vec<String>> {
    let normalized: Vec<String> = match white_space {
        WhiteSpaceMode::PreWrap => texts.iter().map(|t| expand_tabs(t, tab_size)).collect(),
        WhiteSpaceMode::Normal | WhiteSpaceMode::NoWrap => {
            let mut out: Vec<String> = texts
                .iter()
                .map(|t| String::with_capacity(t.len()))
                .collect();
            let mut in_ws = false;
            let mut seen_non_ws = false;
            // Run index of a space that is currently the last emitted char.
            let mut last_emitted_space: Option<usize> = None;
            for (run_index, text) in texts.iter().enumerate() {
                for ch in text.chars() {
                    if matches!(ch, ' ' | '\t' | '\n' | '\r') {
                        if !in_ws && seen_non_ws {
                            out[run_index].push(' ');
                            last_emitted_space = Some(run_index);
                        }
                        in_ws = true;
                    } else {
                        in_ws = false;
                        seen_non_ws = true;
                        last_emitted_space = None;
                        out[run_index].push(ch);
                    }
                }
            }
            // The whole sequence must not end with a collapsed space.
            if let Some(run_index) = last_emitted_space {
                out[run_index].pop();
            }
            out
        }
    };

    if normalized
        .iter()
        .zip(texts)
        .all(|(new_text, old_text)| new_text == old_text)
    {
        None
    } else {
        Some(normalized)
    }
}

// ---------------------------------------------------------------------------
// Text input types (moved from engine layout.rs)
// ---------------------------------------------------------------------------

#[must_use]
pub fn default_weight() -> u16 {
    400
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
/// Canonical wire representation of one text outline layer.
///
/// This type is shared by boundtext input/output and boundsvg IR so serde
/// optionality cannot drift between carriers.
pub struct TextStrokeLayer {
    pub color: String,
    pub width_px: f64,
    #[cfg_attr(
        feature = "schema",
        schemars(
            with = "Option<crate::schema::DirectionalSchema<crate::schema::StringEnumSchema<TextStrokeLinejoinSchema>, String>>"
        )
    )]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linejoin: Option<String>,
    #[cfg_attr(
        feature = "schema",
        schemars(
            with = "Option<crate::schema::DirectionalSchema<crate::schema::StringEnumSchema<TextStrokeLinecapSchema>, String>>"
        )
    )]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linecap: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dasharray: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub miterlimit: Option<f64>,
}

/// Canonical wire representation of one text drop-shadow layer.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextShadowLayer {
    pub dx: f64,
    pub dy: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blur_px: Option<f64>,
    pub color: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSpanInput {
    pub text: String,
    #[serde(default)]
    pub font_family: Vec<String>,
    #[serde(default = "default_weight")]
    pub font_weight: u16,
    #[serde(default)]
    pub font_style: FontStyle,
    pub font_size_px: f64,
    #[serde(default)]
    pub letter_spacing_px: Option<f64>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub text_orientation: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub text_strokes: Option<Vec<TextStrokeLayer>>,
    #[serde(default)]
    pub text_shadows: Option<Vec<TextShadowLayer>>,
    #[serde(default)]
    pub font_variation_settings: Option<String>,
    #[serde(default)]
    pub font_feature_settings: Option<String>,
    #[serde(default)]
    pub text_decoration: Option<TextDecorationInput>,
    /// Internal bridge marker: this span exists only to carry paint metadata
    /// for an otherwise plain Text node and must not select the span layout path.
    #[serde(default)]
    pub decoration_transport_only: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichTextStyleInput {
    #[serde(default)]
    pub font_family: Vec<String>,
    #[serde(default = "default_weight")]
    pub font_weight: u16,
    #[serde(default)]
    pub font_style: FontStyle,
    pub font_size_px: f64,
    #[serde(default)]
    pub line_height: Option<f64>,
    #[serde(default)]
    pub line_height_px: Option<f64>,
    #[serde(default)]
    pub letter_spacing_px: Option<f64>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub text_strokes: Option<Vec<TextStrokeLayer>>,
    #[serde(default)]
    pub text_shadows: Option<Vec<TextShadowLayer>>,
    #[serde(default)]
    pub font_variation_settings: Option<String>,
    #[serde(default)]
    pub font_feature_settings: Option<String>,
    #[serde(default)]
    pub text_orientation: Option<String>,
    #[serde(default)]
    pub text_decoration: Option<TextDecorationInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichTextDecorationRunInput {
    pub text: String,
    #[serde(default)]
    pub text_decoration: Option<TextDecorationInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum InlineRectBlockSizeInput {
    Pixels(f64),
    Line(String),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineRectInput {
    pub fragment_id: String,
    pub inline_size_px: f64,
    #[serde(default)]
    pub block_size_px: Option<InlineRectBlockSizeInput>,
    #[serde(default)]
    pub advance_px: Option<f64>,
    #[serde(default)]
    pub block_align: Option<String>,
    pub color: String,
    #[serde(default)]
    pub border_radius_px: Option<f64>,
    #[serde(default)]
    pub opacity: Option<f64>,
    #[serde(default)]
    pub paint_order: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RichTextNodeInput {
    Text {
        text: String,
    },
    Span {
        text: String,
        style: RichTextStyleInput,
    },
    Combine {
        text: String,
        style: RichTextStyleInput,
        #[serde(rename = "decorationRuns", default)]
        decoration_runs: Vec<RichTextDecorationRunInput>,
    },
    Ruby {
        #[serde(rename = "rubyPosition", default)]
        ruby_position: Option<String>,
        #[serde(rename = "rubyAlign", default)]
        ruby_align: Option<String>,
        #[serde(rename = "rubyGapPx", default)]
        ruby_gap_px: Option<f64>,
        #[serde(rename = "rubyOffsetPx", default)]
        ruby_offset_px: Option<f64>,
        #[serde(rename = "rubyLineSizing", default)]
        ruby_line_sizing: Option<String>,
        style: RichTextStyleInput,
        #[serde(default)]
        base: Vec<RichTextNodeInput>,
        #[serde(default)]
        rt: Vec<RichTextNodeInput>,
        #[serde(rename = "rtLevels", default)]
        rt_levels: Vec<Vec<RichTextNodeInput>>,
    },
    InlineBox {
        style: RichTextStyleInput,
        #[serde(default)]
        children: Vec<RichTextNodeInput>,
        #[serde(rename = "paddingInline", default)]
        padding_inline: Option<[f64; 2]>,
        #[serde(default)]
        background: Option<String>,
        #[serde(rename = "borderColor", default)]
        border_color: Option<String>,
        #[serde(rename = "borderWidth", default)]
        border_width: Option<f64>,
        #[serde(rename = "borderRadius", default)]
        border_radius: Option<f64>,
        /// Opaque caller-assigned provenance key, echoed on the decoration
        /// fragment this box produces so callers can address it (e.g. to
        /// animate it).
        #[serde(rename = "spanKey", default)]
        span_key: Option<String>,
    },
    InlineRect {
        #[serde(flatten)]
        rect: InlineRectInput,
    },
    /// Fragmentable decorated inline span. Unlike `InlineBox` (atomic),
    /// children are grapheme-split and can wrap across lines, producing
    /// per-line decoration fragments.
    DecoratedSpan {
        style: RichTextStyleInput,
        #[serde(default)]
        children: Vec<RichTextNodeInput>,
        #[serde(rename = "paddingInline", default)]
        padding_inline: Option<[f64; 2]>,
        #[serde(default)]
        background: Option<String>,
        #[serde(rename = "borderColor", default)]
        border_color: Option<String>,
        #[serde(rename = "borderWidth", default)]
        border_width: Option<f64>,
        #[serde(rename = "borderRadius", default)]
        border_radius: Option<[f64; 4]>,
        /// Opaque caller-assigned provenance key, echoed on every decoration
        /// fragment this span produces so callers can address fragments of a
        /// specific span (e.g. to animate them).
        #[serde(rename = "spanKey", default)]
        span_key: Option<String>,
    },
}

/// Recursive rich-text containers through depth 48 are accepted; leaf nodes add no depth.
/// Keep this value aligned with `packages/core/src/text/rich-text-limits.ts`.
pub const MAX_RICH_TEXT_DEPTH: usize = 48;
/// Maximum authored inline rectangles accepted for one Text node.
pub const MAX_INLINE_RECTS: usize = 4_096;

/// Identify which recursive rich-text resource limit was exceeded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RichTextResourceViolation {
    /// Authored nesting exceeded the maximum accepted depth.
    Depth { actual: usize, limit: usize },
    /// Authored inline rectangles exceeded the per-layout limit.
    InlineRects { required: usize, limit: usize },
}

/// Validate recursive rich-text resources without recursively walking the input.
///
/// This guard must run before flattening so an over-depth public Rust input
/// cannot exhaust the call stack even when it bypasses the TypeScript and
/// `boundsvg` validators.
///
/// # Errors
///
/// Returns the first depth or inline-rectangle limit exceeded by the input.
pub(crate) fn validate_rich_text_resources(
    nodes: &[RichTextNodeInput],
) -> Result<(), RichTextResourceViolation> {
    let mut inline_rect_count = 0_usize;
    let mut pending: Vec<(&RichTextNodeInput, usize)> =
        nodes.iter().map(|node| (node, 0_usize)).collect();

    while let Some((node, parent_container_depth)) = pending.pop() {
        match node {
            RichTextNodeInput::Ruby {
                base,
                rt,
                rt_levels,
                ..
            } => {
                let container_depth = parent_container_depth.saturating_add(1);
                if container_depth > MAX_RICH_TEXT_DEPTH {
                    return Err(RichTextResourceViolation::Depth {
                        actual: container_depth,
                        limit: MAX_RICH_TEXT_DEPTH,
                    });
                }
                pending.extend(base.iter().map(|child| (child, container_depth)));
                pending.extend(rt.iter().map(|child| (child, container_depth)));
                for level in rt_levels {
                    pending.extend(level.iter().map(|child| (child, container_depth)));
                }
            }
            RichTextNodeInput::InlineBox { children, .. }
            | RichTextNodeInput::DecoratedSpan { children, .. } => {
                let container_depth = parent_container_depth.saturating_add(1);
                if container_depth > MAX_RICH_TEXT_DEPTH {
                    return Err(RichTextResourceViolation::Depth {
                        actual: container_depth,
                        limit: MAX_RICH_TEXT_DEPTH,
                    });
                }
                pending.extend(children.iter().map(|child| (child, container_depth)));
            }
            RichTextNodeInput::InlineRect { .. } => {
                inline_rect_count = inline_rect_count.saturating_add(1);
                if inline_rect_count > MAX_INLINE_RECTS {
                    return Err(RichTextResourceViolation::InlineRects {
                        required: inline_rect_count,
                        limit: MAX_INLINE_RECTS,
                    });
                }
            }
            RichTextNodeInput::Text { .. }
            | RichTextNodeInput::Span { .. }
            | RichTextNodeInput::Combine { .. } => {}
        }
    }

    Ok(())
}

/// Return the first container depth beyond the supported rich-text resource boundary.
#[must_use]
pub fn first_excess_rich_text_depth(nodes: &[RichTextNodeInput]) -> Option<usize> {
    let mut pending: Vec<(&RichTextNodeInput, usize)> =
        nodes.iter().map(|node| (node, 0_usize)).collect();

    while let Some((node, parent_container_depth)) = pending.pop() {
        match node {
            RichTextNodeInput::Ruby {
                base,
                rt,
                rt_levels,
                ..
            } => {
                let container_depth = parent_container_depth + 1;
                if container_depth > MAX_RICH_TEXT_DEPTH {
                    return Some(container_depth);
                }
                pending.extend(base.iter().map(|child| (child, container_depth)));
                pending.extend(rt.iter().map(|child| (child, container_depth)));
                for level in rt_levels {
                    pending.extend(level.iter().map(|child| (child, container_depth)));
                }
            }
            RichTextNodeInput::InlineBox { children, .. }
            | RichTextNodeInput::DecoratedSpan { children, .. } => {
                let container_depth = parent_container_depth + 1;
                if container_depth > MAX_RICH_TEXT_DEPTH {
                    return Some(container_depth);
                }
                pending.extend(children.iter().map(|child| (child, container_depth)));
            }
            RichTextNodeInput::Text { .. }
            | RichTextNodeInput::Span { .. }
            | RichTextNodeInput::Combine { .. }
            | RichTextNodeInput::InlineRect { .. } => {}
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Shared text warnings
// ---------------------------------------------------------------------------

/// A diagnostic warning produced during text layout or flow.
///
/// Used by both `TextLayoutResult` and flow results so that consumers
/// (IR builder, SVG emitter) receive warnings without re-scanning glyphs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextWarning {
    /// Warning code (e.g. `"MISSING_GLYPH"`).
    pub code: String,
    /// Human-readable description.
    pub message: String,
    /// Fallback action taken (e.g. `"blank"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,
}

// ---------------------------------------------------------------------------
// .notdef (missing glyph) diagnostics
// ---------------------------------------------------------------------------

/// A single missing-glyph entry detected during shaping.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotdefInfo {
    /// The character(s) that produced `glyph_id=0`.
    pub character: String,
    /// The font alias that was used when shaping.
    pub font_alias: String,
}

/// Collect `.notdef` entries from shaped glyph info and source text.
///
/// Walks `glyphs`, finds those with `glyph_id == 0`, maps back to the
/// source character via `cluster` byte offset, and deduplicates.
#[must_use]
pub fn collect_notdef_from_glyphs(
    glyphs: &[crate::font::shaping::GlyphInfo],
    text: &str,
    font_alias: &str,
) -> Vec<NotdefInfo> {
    let byte_len = u32::try_from(text.len()).unwrap_or(u32::MAX);
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    for glyph in glyphs {
        if glyph.glyph_id != 0 {
            continue;
        }
        let start = glyph.cluster;
        if start >= byte_len {
            continue;
        }
        let Some(c) = text[start as usize..].chars().next() else {
            continue;
        };
        if c.is_control() || c.is_whitespace() {
            continue;
        }
        let ch = c.to_string();
        let alias = glyph
            .font_alias
            .as_deref()
            .unwrap_or(font_alias)
            .to_string();
        let key = (ch.clone(), alias.clone());
        if seen.insert(key) {
            result.push(NotdefInfo {
                character: ch,
                font_alias: alias,
            });
        }
    }
    result
}

/// Collect `.notdef` entries from positioned glyphs.
///
/// Unlike [`collect_notdef_from_glyphs`] which works with raw `GlyphInfo`,
/// this operates on `PositionedGlyph` where each glyph already carries its
/// own `text` and `font_alias` fields.
#[must_use]
pub fn collect_notdef_from_positioned_glyphs(glyphs: &[PositionedGlyph]) -> Vec<NotdefInfo> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    for glyph in glyphs {
        if glyph.glyph_id != 0 {
            continue;
        }
        let Some(c) = glyph.text.chars().next() else {
            continue;
        };
        // Skip control/whitespace characters
        if c.is_control() || c.is_whitespace() {
            continue;
        }
        let ch = c.to_string();
        let key = (ch.clone(), glyph.font_alias.clone());
        if seen.insert(key) {
            result.push(NotdefInfo {
                character: ch,
                font_alias: glyph.font_alias.clone(),
            });
        }
    }
    result
}

/// Build `TextWarning` entries from `.notdef` detection results.
/// Groups characters by font alias for a readable message.
#[must_use]
pub fn build_notdef_warnings(infos: &[NotdefInfo]) -> Vec<TextWarning> {
    if infos.is_empty() {
        return Vec::new();
    }

    let mut by_font: std::collections::BTreeMap<&str, Vec<&str>> =
        std::collections::BTreeMap::new();
    for info in infos {
        by_font
            .entry(&info.font_alias)
            .or_default()
            .push(&info.character);
    }

    by_font
        .into_iter()
        .map(|(alias, chars)| {
            let label = if alias.is_empty() {
                "unknown font".to_string()
            } else {
                format!("\"{alias}\"")
            };
            let chars_display: Vec<String> = chars
                .iter()
                .map(|c| {
                    let mut chars = c.chars();
                    if let (Some(ch), None) = (chars.next(), chars.next()) {
                        format!("U+{:04X} ({})", ch as u32, c)
                    } else {
                        (*c).to_string()
                    }
                })
                .collect();
            TextWarning {
                code: "MISSING_GLYPH".to_string(),
                message: format!(
                    "Font {label} is missing glyphs for: {}",
                    chars_display.join(", ")
                ),
                fallback: Some("blank".to_string()),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rich_text_style() -> RichTextStyleInput {
        RichTextStyleInput {
            font_family: vec!["NotoSansJP".to_string()],
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px: 12.0,
            line_height: None,
            line_height_px: None,
            letter_spacing_px: None,
            language: Some("ja".to_string()),
            color: None,
            text_strokes: None,
            text_shadows: None,
            font_variation_settings: None,
            font_feature_settings: None,
            text_orientation: None,
            text_decoration: None,
        }
    }

    fn nested_rich_text(depth: usize) -> Vec<RichTextNodeInput> {
        let mut node = RichTextNodeInput::Text {
            text: "境界".to_string(),
        };
        for _ in 1..=depth {
            node = RichTextNodeInput::DecoratedSpan {
                style: rich_text_style(),
                children: vec![node],
                padding_inline: None,
                background: None,
                border_color: None,
                border_width: None,
                border_radius: None,
                span_key: None,
            };
        }
        vec![node]
    }

    fn nested_inline_box_rich_text(depth: usize) -> Vec<RichTextNodeInput> {
        let mut node = RichTextNodeInput::Text {
            text: "境界".to_string(),
        };
        for _ in 1..=depth {
            node = RichTextNodeInput::InlineBox {
                style: rich_text_style(),
                children: vec![node],
                padding_inline: None,
                background: None,
                border_color: None,
                border_width: None,
                border_radius: None,
                span_key: None,
            };
        }
        vec![node]
    }

    fn nested_ruby_level_rich_text(depth: usize) -> Vec<RichTextNodeInput> {
        let mut node = RichTextNodeInput::Text {
            text: "境界".to_string(),
        };
        for _ in 1..=depth {
            node = RichTextNodeInput::Ruby {
                ruby_position: None,
                ruby_align: None,
                ruby_gap_px: None,
                ruby_offset_px: None,
                ruby_line_sizing: None,
                style: rich_text_style(),
                base: vec![],
                rt: vec![],
                rt_levels: vec![vec![node]],
            };
        }
        vec![node]
    }

    #[test]
    fn rich_text_depth_boundary_accepts_48_and_rejects_49() {
        assert_eq!(
            first_excess_rich_text_depth(&nested_rich_text(MAX_RICH_TEXT_DEPTH)),
            None
        );
        assert_eq!(
            first_excess_rich_text_depth(&nested_rich_text(MAX_RICH_TEXT_DEPTH + 1)),
            Some(MAX_RICH_TEXT_DEPTH + 1)
        );
    }

    #[test]
    fn rich_text_depth_boundary_covers_inline_box_and_ruby_levels() {
        for nodes in [
            nested_inline_box_rich_text(MAX_RICH_TEXT_DEPTH),
            nested_ruby_level_rich_text(MAX_RICH_TEXT_DEPTH),
        ] {
            assert_eq!(first_excess_rich_text_depth(&nodes), None);
        }
        for nodes in [
            nested_inline_box_rich_text(MAX_RICH_TEXT_DEPTH + 1),
            nested_ruby_level_rich_text(MAX_RICH_TEXT_DEPTH + 1),
        ] {
            assert_eq!(
                first_excess_rich_text_depth(&nodes),
                Some(MAX_RICH_TEXT_DEPTH + 1)
            );
        }
    }

    #[test]
    fn white_space_mode_from_option() {
        assert_eq!(WhiteSpaceMode::from_option(None), WhiteSpaceMode::Normal);
        assert_eq!(
            WhiteSpaceMode::from_option(Some("normal")),
            WhiteSpaceMode::Normal
        );
        assert_eq!(
            WhiteSpaceMode::from_option(Some("nowrap")),
            WhiteSpaceMode::NoWrap
        );
        assert_eq!(
            WhiteSpaceMode::from_option(Some("pre-wrap")),
            WhiteSpaceMode::PreWrap
        );
    }

    #[test]
    fn expand_tabs_replaces_tabs() {
        assert_eq!(expand_tabs("a\tb", 4), "a    b");
        assert_eq!(expand_tabs("no tabs", 4), "no tabs");
        assert_eq!(expand_tabs("\t\t", 2), "    ");
    }

    #[test]
    fn convert_spaces_to_nbsp_in_result() {
        let mut result = TextLayoutResult {
            lines: vec![Line {
                text: "hello world".to_string(),
                glyphs: vec![],
                width: 100.0,
                baseline_y: 12.0,
                fragments: None,
                positioned_glyphs: Some(vec![PositionedGlyph {
                    glyph_id: 0,
                    text: "hello world".to_string(),
                    cluster_start: 0,
                    cluster_end: 11,
                    source_start: Some(0),
                    source_end: Some(11),
                    source_role: Some("content".to_string()),
                    decoration_source_start: Some(0),
                    decoration_source_end: Some(11),
                    decoration_level: None,
                    path_decoration_owner_id: None,
                    path_distance_start_px: None,
                    path_distance_end_px: None,
                    text_decoration_geometry: None,
                    font_alias: "test".to_string(),
                    font_fallback: vec![],
                    font_weight: 400,
                    font_style: FontStyle::Normal,
                    font_size_px: None,
                    font_variation_settings: None,
                    font_feature_settings: None,
                    fill: None,
                    text_strokes: None,
                    text_shadows: None,
                    paint_range_index: None,
                    origin_x: 0.0,
                    origin_y: 0.0,
                    x_offset: 0.0,
                    y_offset: 0.0,
                    x_advance: 100.0,
                    y_advance: 0.0,
                    rotation_deg: 0,
                    baseline_rotation_deg: None,
                    inline_scale: None,
                    synthetic_kind: None,
                    outline_writing_mode: None,
                    absolute_position: None,
                }]),
            }],
            bbox: TextBBox {
                x: 0.0,
                y: 0.0,
                w: 100.0,
                h: 12.0,
            },
            chosen_font_size_px: 16.0,
            overflow: TextOverflow::none(),
            source_text: None,
            display_text: None,
            unit_map: None,
            warnings: vec![],
            inline_box_decorations: vec![],
            text_decorations: vec![],
            inline_rects: vec![],
        };
        result.convert_spaces_to_nbsp();
        let glyph = &result.lines[0].positioned_glyphs.as_ref().unwrap()[0];
        assert_eq!(glyph.text, "hello\u{00a0}world");
    }

    #[test]
    fn collapse_whitespace_collapses_runs() {
        assert_eq!(collapse_whitespace("a   b"), "a b");
        assert_eq!(collapse_whitespace("a\tb"), "a b");
        assert_eq!(collapse_whitespace("a\nb"), "a b");
        assert_eq!(collapse_whitespace("a \t\n b"), "a b");
    }

    #[test]
    fn collapse_whitespace_trims_edges() {
        assert_eq!(collapse_whitespace("  hello  "), "hello");
        assert_eq!(collapse_whitespace("\n\nhello\n\n"), "hello");
    }

    #[test]
    fn collapse_whitespace_preserves_single_spaces() {
        assert_eq!(collapse_whitespace("a b c"), "a b c");
        assert_eq!(collapse_whitespace("no change"), "no change");
    }

    #[test]
    fn collapse_whitespace_empty() {
        assert_eq!(collapse_whitespace(""), "");
        assert_eq!(collapse_whitespace("   "), "");
    }

    #[test]
    fn preprocess_text_for_white_space_collapses_nowrap_like_normal() {
        assert_eq!(
            preprocess_text_for_white_space("a   b\nc", WhiteSpaceMode::NoWrap, 4),
            "a b c"
        );
    }
}
