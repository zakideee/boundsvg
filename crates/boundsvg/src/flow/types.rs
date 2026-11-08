//! Input and output DTOs for the boundtext flow adapters.

use serde::{Deserialize, Serialize};

use crate::diagnostics::SerializedRecoverableError;
use crate::flow::geometry::{FlowBox, FlowExclusionShape};
use crate::text::types::RichTextNodeInput;

// ---------------------------------------------------------------------------
// WASM DTO types (serde-annotated, kept for JSON bridge)
// ---------------------------------------------------------------------------

/// Accept plain text with authored per-line region widths.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowInput {
    pub text: String,
    pub font_family: String,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub fallback: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_weight: Option<u16>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_style: Option<String>,
    pub font_size_px: f64,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub line_height: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub letter_spacing_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub language: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub wrap: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub white_space: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub tab_size: Option<u32>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub hanging_punctuation: Option<bool>,
    pub line_widths: Vec<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub writing_mode: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub text_orientation: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_variation_settings: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_feature_settings: Option<String>,
}

/// Report one plain flow line and its diagnostic grapheme range.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowLine {
    pub text: String,
    pub char_start: usize,
    pub char_end: usize,
    pub inline_advance_px: f64,
    pub available_inline_size_px: f64,
}

/// Report plain flow lines, exhaustion, and recoverable diagnostics.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowResult {
    pub lines: Vec<TextFlowLine>,
    pub exhausted: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<SerializedRecoverableError>,
}

// ---------------------------------------------------------------------------
// Exclusion-based flow layout DTOs
// ---------------------------------------------------------------------------

/// Accept authored content and exclusion geometry for canonical boundtext measurement.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowWithExclusionsInput {
    pub text: String,
    pub font_family: String,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub fallback: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_weight: Option<u16>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_style: Option<String>,
    pub font_size_px: f64,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub line_height: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub line_height_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub letter_spacing_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub language: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub wrap: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub hanging_punctuation: Option<bool>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub white_space: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub tab_size: Option<u32>,
    pub flow_box: FlowBox,
    pub exclusions: Vec<FlowExclusionShape>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub min_region_width_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub max_lines: Option<usize>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub ellipsis: Option<bool>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub fit: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub min_font_size_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub max_font_size_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub fit_epsilon_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub fit_max_iterations: Option<usize>,
    /// Work limit for an uncertified exact-grid fit search.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub fit_max_probes: Option<usize>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub spans: Option<Vec<FlowTextSpanDto>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub rich_text: Option<Vec<RichTextNodeInput>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub writing_mode: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub text_orientation: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_variation_settings: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_feature_settings: Option<String>,
}

/// Span input DTO (serde-annotated). Named `Dto` to avoid collision with
/// `boundtext::text::flow::FlowTextSpan`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FlowTextSpanDto {
    pub text: String,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_family: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub fallback: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_weight: Option<u16>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_style: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_size_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub letter_spacing_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub color: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_variation_settings: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_feature_settings: Option<String>,
    /// Ruby annotation text (e.g. furigana). When present, this span is
    /// treated as a ruby base + annotation pair: the base text is `text`,
    /// the annotation is `ruby_text`, and the pair is indivisible during
    /// line breaking.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub ruby_text: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub ruby_position: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub ruby_align: Option<String>,
    /// Style overrides for the ruby annotation text.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub ruby_font_size_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub ruby_color: Option<String>,
}

/// Retain plain-span style facts for diagnostics, without defining a rendering recipe.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowFragmentStyle {
    pub font_family: String,
    pub font_weight: u16,
    pub font_style: String,
    pub font_size_px: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letter_spacing_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// Report a reserved cell and diagnostic range; render the authored Text to obtain glyph placement.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowFragment {
    pub text: String,
    /// Start of a grapheme range on plain paths, or a token range on canonical rich paths.
    pub char_start: usize,
    /// Exclusive end in the same diagnostic index space as `char_start`.
    pub char_end: usize,
    /// Physical flow-coordinate x of the reserved cell, not the base glyph's paint origin.
    pub x: f64,
    /// Physical flow-coordinate y of the reserved cell, not an annotation paint origin.
    pub y: f64,
    /// Consumed inline advance in px (physical width for horizontal, physical height for vertical).
    pub inline_advance_px: f64,
    /// Available inline size of the region in px.
    pub available_inline_size_px: f64,
    pub region_index: usize,
    /// Shared cross-axis reference offset within the line box.
    /// For horizontal text, this is the distance from line top to the
    /// alphabetic baseline. For vertical text, this is the distance from the
    /// column's left edge to its centerline. All fragments in one line share it.
    pub baseline_offset: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overflow_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Plain-span diagnostic style; absent for every fragment of a canonical rich document.
    pub style: Option<TextFlowFragmentStyle>,
}

/// Report one line or column's measured cross-axis size and region fragments.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowExclusionLine {
    pub fragments: Vec<TextFlowFragment>,
    pub line_index: usize,
    /// Cross-axis size of the line (height for horizontal, column width for
    /// vertical). A mixed-size / ruby line is taller than the base line
    /// height, so consumers cannot derive this from line positions alone.
    pub cross_size: f64,
}

/// Why the flow layout stopped before consuming all text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FlowOverflowReason {
    /// `max_lines` limit reached with remaining text.
    MaxLinesTruncated,
    /// Flow box bottom reached with remaining text.
    FlowBoxExhausted,
    /// Even at the extreme font size, text does not fit.
    CannotFit,
}

/// Report measured layout facts without exposing a fragment-based text rendering protocol.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowWithExclusionsResult {
    pub lines: Vec<TextFlowExclusionLine>,
    pub exhausted: bool,
    pub used_line_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overflow_reason: Option<FlowOverflowReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chosen_font_size_px: Option<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<SerializedRecoverableError>,
}

// ---------------------------------------------------------------------------
// Measure text block DTOs
// ---------------------------------------------------------------------------

/// Accept content and frame constraints for block measurement.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeasureTextBlockInput {
    pub text: String,
    pub font_family: String,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub fallback: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_weight: Option<u16>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_style: Option<String>,
    pub font_size_px: f64,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub line_height: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub line_height_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub letter_spacing_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub text_indent: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub language: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub wrap: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub hanging_punctuation: Option<bool>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub max_width: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub max_height: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub writing_mode: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub text_orientation: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub white_space: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub tab_size: Option<u32>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_variation_settings: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_feature_settings: Option<String>,
}

/// Per-line break diagnostics for `measureTextBlock` (horizontal only for
/// now — vertical lines carry no character ranges; use `layoutTextFlow` for
/// vertical per-line data).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeasureTextBlockLineDto {
    /// Grapheme-cluster range [start, end) in the input text.
    pub char_start: usize,
    pub char_end: usize,
    /// The line's text (whitespace-normalized form — exactly what was measured).
    pub text: String,
    /// Consumed inline advance of the line in px.
    pub inline_advance_px: f64,
    /// Kinsoku backtracking failed for this line (forced break).
    pub kinsoku_unresolved: bool,
}

/// Report measured block dimensions and optional line diagnostics.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeasureTextBlockResult {
    pub line_count: usize,
    pub used_width: f64,
    pub used_height: f64,
    /// Present for horizontal writing mode; omitted for vertical.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines: Option<Vec<MeasureTextBlockLineDto>>,
}

// ---------------------------------------------------------------------------
// Shrinkwrap text DTOs
// ---------------------------------------------------------------------------

/// Accept content and bounded inline-size search controls.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShrinkwrapTextInput {
    pub text: String,
    pub font_family: String,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub fallback: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_weight: Option<u16>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_style: Option<String>,
    pub font_size_px: f64,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub line_height: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub line_height_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub letter_spacing_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub language: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub wrap: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub hanging_punctuation: Option<bool>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub writing_mode: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub text_orientation: Option<String>,
    pub max_width: f64,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub max_height: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub min_width: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub min_height: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub target_line_count: Option<usize>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub epsilon_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub max_iterations: Option<usize>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub white_space: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub tab_size: Option<u32>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub spans: Option<Vec<FlowTextSpanDto>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub rich_text: Option<Vec<RichTextNodeInput>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_variation_settings: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_feature_settings: Option<String>,
}

/// WASM-facing shrinkwrap status enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ShrinkwrapStatusDto {
    Satisfied,
    Infeasible,
}

/// Report the chosen inline size and measured block dimensions.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShrinkwrapTextResult {
    pub status: ShrinkwrapStatusDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chosen_width_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chosen_height_px: Option<f64>,
    pub line_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_width: Option<f64>,
    pub used_height: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_line_width: Option<f64>,
}

// ---------------------------------------------------------------------------
// Shrinkwrap flow DTOs
// ---------------------------------------------------------------------------

/// Accept authored content, exclusions, and bounded flow-size search controls.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShrinkwrapFlowInput {
    // --- text ---
    pub text: String,
    pub font_family: String,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub fallback: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_weight: Option<u16>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_style: Option<String>,
    pub font_size_px: f64,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub line_height: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub line_height_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub letter_spacing_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub language: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub wrap: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub hanging_punctuation: Option<bool>,
    // --- layout geometry ---
    pub flow_box: FlowBox,
    pub exclusions: Vec<FlowExclusionShape>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub min_region_width_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub max_lines: Option<usize>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub writing_mode: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub text_orientation: Option<String>,
    // --- shrinkwrap ---
    /// Minimum search width for horizontal shrinkwrap.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub min_width: Option<f64>,
    /// Minimum search height for vertical-rl shrinkwrap.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub min_height: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub target_line_count: Option<usize>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub shrinkwrap_epsilon_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub shrinkwrap_max_iterations: Option<usize>,
    // --- inline spans (optional) ---
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub spans: Option<Vec<FlowTextSpanDto>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub rich_text: Option<Vec<RichTextNodeInput>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_variation_settings: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_feature_settings: Option<String>,
}

/// Report the selected flow frame and its measurement-only layout.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShrinkwrapFlowResultDto {
    pub status: ShrinkwrapStatusDto,
    /// Chosen width for horizontal shrinkwrap. Absent for vertical-rl.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chosen_width_px: Option<f64>,
    /// Chosen height for vertical-rl shrinkwrap. Absent for horizontal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chosen_height_px: Option<f64>,
    pub used_line_count: usize,
    /// Actual used height from the layout result.
    pub used_height: f64,
    pub layout: TextFlowWithExclusionsResult,
}

// ---------------------------------------------------------------------------
// Intrinsic inline-size DTOs
// ---------------------------------------------------------------------------

/// Accept content for min-content and max-content inline measurement.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntrinsicInlineSizeInput {
    pub text: String,
    pub font_family: String,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub fallback: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_weight: Option<u16>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_style: Option<String>,
    pub font_size_px: f64,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub line_height: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub line_height_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub letter_spacing_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub text_indent: Option<f64>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub language: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub rich_text: Option<Vec<RichTextNodeInput>>,
    #[serde(rename = "writingMode")]
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub writing_mode: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub text_orientation: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub white_space: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub tab_size: Option<u32>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_variation_settings: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub font_feature_settings: Option<String>,
}

/// Report intrinsic inline dimensions and recoverable diagnostics.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntrinsicInlineSizeResult {
    pub min_content_inline_size: f64,
    pub max_content_inline_size: f64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<SerializedRecoverableError>,
}
