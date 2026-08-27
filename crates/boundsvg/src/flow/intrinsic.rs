use super::types::{IntrinsicInlineSizeInput, IntrinsicInlineSizeResult};
use crate::font::{FontContext, FontRegistry, FontStyle};
use crate::layout::types::{parse_feature_settings_opt, parse_variation_settings_opt};
use crate::text::rich;
use crate::text::types::{Language, WrapMode, WritingMode};

// ---------------------------------------------------------------------------
// Intrinsic inline-size measurement
// ---------------------------------------------------------------------------

pub(crate) fn measure_intrinsic_inline_size(
    input: &IntrinsicInlineSizeInput,
    registry: &FontRegistry,
) -> Result<IntrinsicInlineSizeResult, String> {
    super::validate_rich_text_depth(input.rich_text.as_deref())?;
    let font_families = super::build_font_families(&input.font_family, input.fallback.as_deref());
    let font_style = match input.font_style.as_deref() {
        Some("italic") => FontStyle::Italic,
        _ => FontStyle::Normal,
    };
    let font_ctx = FontContext {
        registry,
        fallback_registry: None,
        families: &font_families,
        weight: input.font_weight.unwrap_or(400),
        style: &font_style,
    };

    let rich_text_ref = input.rich_text.as_deref().filter(|nodes| !nodes.is_empty());

    let req = crate::text::types::TextLayoutRequest {
        text: &input.text,
        spans: None,
        rich_text: rich_text_ref,
        font_size_px: input.font_size_px,
        line_height: input.line_height,
        line_height_px: input.line_height_px,
        letter_spacing_px: input.letter_spacing_px.unwrap_or(0.0),
        text_indent: input.text_indent,
        max_width: f64::MAX,
        max_height: None,
        wrap: WrapMode::Char,
        white_space: crate::text::types::WhiteSpaceMode::from_option(input.white_space.as_deref()),
        tab_size: input.tab_size.unwrap_or(4),
        fit: crate::text::types::FitMode::None,
        max_lines: None,
        ellipsis: false,
        language: Language::from_option(input.language.as_deref()),
        writing_mode: WritingMode::from_option(input.writing_mode.as_deref()),
        text_orientation: crate::text::types::TextOrientation::from_option(
            input.text_orientation.as_deref(),
        ),
        uax14_breaks: None,
        hanging_punctuation: false,
        font_variation_settings: parse_variation_settings_opt(
            input.font_variation_settings.as_deref(),
        ),
        font_feature_settings: parse_feature_settings_opt(input.font_feature_settings.as_deref()),
        min_font_size_px: None,
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
        fit_max_probes: None,
    };

    let result = rich::measure_intrinsic_inline_size(&req, &font_ctx)
        .ok_or_else(|| "Failed to measure intrinsic inline size".to_string())?;

    Ok(IntrinsicInlineSizeResult {
        min_content_inline_size: result.min_content_inline_size,
        max_content_inline_size: result.max_content_inline_size,
        warnings: result.warnings,
    })
}
