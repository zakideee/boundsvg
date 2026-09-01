use serde::{Deserialize, Serialize};

use crate::diagnostics::SerializedRecoverableError;
use crate::flow::geometry::{FlowBox, FlowExclusionShape};
use crate::text::types::RichTextNodeInput;

// ---------------------------------------------------------------------------
// WASM DTO types (serde-annotated, kept for JSON bridge)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowInput {
    pub text: String,
    pub font_family: String,
    pub fallback: Option<Vec<String>>,
    pub font_weight: Option<u16>,
    pub font_style: Option<String>,
    pub font_size_px: f64,
    pub line_height: Option<f64>,
    pub letter_spacing_px: Option<f64>,
    pub language: Option<String>,
    pub wrap: Option<String>,
    pub white_space: Option<String>,
    pub tab_size: Option<u32>,
    pub hanging_punctuation: Option<bool>,
    pub line_widths: Vec<f64>,
    pub writing_mode: Option<String>,
    pub text_orientation: Option<String>,
    pub font_variation_settings: Option<String>,
    pub font_feature_settings: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowLine {
    pub text: String,
    pub char_start: usize,
    pub char_end: usize,
    pub inline_advance_px: f64,
    pub available_inline_size_px: f64,
}

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowWithExclusionsInput {
    pub text: String,
    pub font_family: String,
    pub fallback: Option<Vec<String>>,
    pub font_weight: Option<u16>,
    pub font_style: Option<String>,
    pub font_size_px: f64,
    pub line_height: Option<f64>,
    pub line_height_px: Option<f64>,
    pub letter_spacing_px: Option<f64>,
    pub language: Option<String>,
    pub wrap: Option<String>,
    pub hanging_punctuation: Option<bool>,
    pub white_space: Option<String>,
    pub tab_size: Option<u32>,
    pub flow_box: FlowBox,
    pub exclusions: Vec<FlowExclusionShape>,
    pub min_region_width_px: Option<f64>,
    pub max_lines: Option<usize>,
    pub ellipsis: Option<bool>,
    pub fit: Option<String>,
    pub min_font_size_px: Option<f64>,
    pub max_font_size_px: Option<f64>,
    pub fit_epsilon_px: Option<f64>,
    pub fit_max_iterations: Option<usize>,
    /// Work limit for an uncertified exact-grid fit search.
    pub fit_max_probes: Option<usize>,
    pub spans: Option<Vec<FlowTextSpanDto>>,
    pub rich_text: Option<Vec<RichTextNodeInput>>,
    pub writing_mode: Option<String>,
    pub text_orientation: Option<String>,
    pub font_variation_settings: Option<String>,
    pub font_feature_settings: Option<String>,
}

/// Span input DTO (serde-annotated). Named `Dto` to avoid collision with
/// `boundtext::text::flow::FlowTextSpan`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FlowTextSpanDto {
    pub text: String,
    pub font_family: Option<String>,
    pub fallback: Option<Vec<String>>,
    pub font_weight: Option<u16>,
    pub font_style: Option<String>,
    pub font_size_px: Option<f64>,
    pub letter_spacing_px: Option<f64>,
    pub color: Option<String>,
    pub font_variation_settings: Option<String>,
    pub font_feature_settings: Option<String>,
    /// Ruby annotation text (e.g. furigana). When present, this span is
    /// treated as a ruby base + annotation pair: the base text is `text`,
    /// the annotation is `ruby_text`, and the pair is indivisible during
    /// line breaking.
    pub ruby_text: Option<String>,
    pub ruby_position: Option<String>,
    pub ruby_align: Option<String>,
    /// Style overrides for the ruby annotation text.
    pub ruby_font_size_px: Option<f64>,
    pub ruby_color: Option<String>,
}

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

/// Ruby annotation attached to a flow fragment.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowRubyAnnotation {
    /// Annotation text (e.g. furigana reading).
    pub text: String,
    /// "over" (default) or "under".
    pub position: String,
    /// "start", "center", "space-between", "space-around" (default).
    pub align: String,
    /// Style for the annotation text.
    pub style: TextFlowFragmentStyle,
    /// Gap between annotation and base text (px).
    pub gap_px: f64,
    pub offset_px: f64,
    pub line_sizing: String,
    pub levels: Vec<TextFlowRubyAnnotationLevel>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowRubyAnnotationRun {
    pub text: String,
    pub style: TextFlowFragmentStyle,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowRubyAnnotationLevel {
    pub text: String,
    pub position: String,
    pub runs: Vec<TextFlowRubyAnnotationRun>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFlowFragment {
    pub text: String,
    pub char_start: usize,
    pub char_end: usize,
    pub x: f64,
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
    pub style: Option<TextFlowFragmentStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ruby: Option<TextFlowRubyAnnotation>,
}

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
    /// Legacy over-side annotation extent (font size + frame gap) for manual
    /// fragment rendering. Never add this value to a measured height.
    pub top_ruby_overflow_px: f64,
    /// Legacy under-side annotation extent (font size + frame gap) for manual
    /// fragment rendering. Never add this value to a measured height.
    pub bottom_ruby_overflow_px: f64,
}

// ---------------------------------------------------------------------------
// Measure text block DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeasureTextBlockInput {
    pub text: String,
    pub font_family: String,
    pub fallback: Option<Vec<String>>,
    pub font_weight: Option<u16>,
    pub font_style: Option<String>,
    pub font_size_px: f64,
    pub line_height: Option<f64>,
    pub line_height_px: Option<f64>,
    pub letter_spacing_px: Option<f64>,
    pub text_indent: Option<f64>,
    pub language: Option<String>,
    pub wrap: Option<String>,
    pub hanging_punctuation: Option<bool>,
    pub max_width: Option<f64>,
    pub max_height: Option<f64>,
    pub writing_mode: Option<String>,
    pub text_orientation: Option<String>,
    pub white_space: Option<String>,
    pub tab_size: Option<u32>,
    pub font_variation_settings: Option<String>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShrinkwrapTextInput {
    pub text: String,
    pub font_family: String,
    pub fallback: Option<Vec<String>>,
    pub font_weight: Option<u16>,
    pub font_style: Option<String>,
    pub font_size_px: f64,
    pub line_height: Option<f64>,
    pub line_height_px: Option<f64>,
    pub letter_spacing_px: Option<f64>,
    pub language: Option<String>,
    pub wrap: Option<String>,
    pub hanging_punctuation: Option<bool>,
    pub writing_mode: Option<String>,
    pub text_orientation: Option<String>,
    pub max_width: f64,
    pub max_height: Option<f64>,
    pub min_width: Option<f64>,
    pub min_height: Option<f64>,
    pub target_line_count: Option<usize>,
    pub epsilon_px: Option<f64>,
    pub max_iterations: Option<usize>,
    pub white_space: Option<String>,
    pub tab_size: Option<u32>,
    pub spans: Option<Vec<FlowTextSpanDto>>,
    pub rich_text: Option<Vec<RichTextNodeInput>>,
    pub font_variation_settings: Option<String>,
    pub font_feature_settings: Option<String>,
}

/// WASM-facing shrinkwrap status enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ShrinkwrapStatusDto {
    Satisfied,
    Infeasible,
}

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShrinkwrapFlowInput {
    // --- text ---
    pub text: String,
    pub font_family: String,
    pub fallback: Option<Vec<String>>,
    pub font_weight: Option<u16>,
    pub font_style: Option<String>,
    pub font_size_px: f64,
    pub line_height: Option<f64>,
    pub line_height_px: Option<f64>,
    pub letter_spacing_px: Option<f64>,
    pub language: Option<String>,
    pub wrap: Option<String>,
    pub hanging_punctuation: Option<bool>,
    // --- layout geometry ---
    pub flow_box: FlowBox,
    pub exclusions: Vec<FlowExclusionShape>,
    pub min_region_width_px: Option<f64>,
    pub max_lines: Option<usize>,
    pub writing_mode: Option<String>,
    pub text_orientation: Option<String>,
    // --- shrinkwrap ---
    /// Minimum search width for horizontal shrinkwrap.
    pub min_width: Option<f64>,
    /// Minimum search height for vertical-rl shrinkwrap.
    pub min_height: Option<f64>,
    pub target_line_count: Option<usize>,
    pub shrinkwrap_epsilon_px: Option<f64>,
    pub shrinkwrap_max_iterations: Option<usize>,
    // --- inline spans (optional) ---
    pub spans: Option<Vec<FlowTextSpanDto>>,
    pub rich_text: Option<Vec<RichTextNodeInput>>,
    pub font_variation_settings: Option<String>,
    pub font_feature_settings: Option<String>,
}

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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntrinsicInlineSizeInput {
    pub text: String,
    pub font_family: String,
    pub fallback: Option<Vec<String>>,
    pub font_weight: Option<u16>,
    pub font_style: Option<String>,
    pub font_size_px: f64,
    pub line_height: Option<f64>,
    pub line_height_px: Option<f64>,
    pub letter_spacing_px: Option<f64>,
    pub text_indent: Option<f64>,
    pub language: Option<String>,
    pub rich_text: Option<Vec<RichTextNodeInput>>,
    #[serde(rename = "writingMode")]
    pub writing_mode: Option<String>,
    pub text_orientation: Option<String>,
    pub white_space: Option<String>,
    pub tab_size: Option<u32>,
    pub font_variation_settings: Option<String>,
    pub font_feature_settings: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntrinsicInlineSizeResult {
    pub min_content_inline_size: f64,
    pub max_content_inline_size: f64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<SerializedRecoverableError>,
}
