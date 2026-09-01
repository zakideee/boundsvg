use super::types::{MeasureTextBlockInput, MeasureTextBlockLineDto, MeasureTextBlockResult};
use crate::font::line_metrics::resolve_line_metrics_for_style;
use crate::font::shaping::ShapeOptions;
use crate::font::{FontContext, FontRegistry, FontStyle};
use crate::layout::types::{parse_feature_settings_opt, parse_variation_settings_opt};
use crate::text::paragraph;
use crate::text::types::{
    Language, PlainTextMeasurementRequest, TextLayoutRequest, WrapMode, WritingMode,
};

// ---------------------------------------------------------------------------
// Measure text block
// ---------------------------------------------------------------------------

pub(crate) fn measure_text_block(
    input: &MeasureTextBlockInput,
    registry: &FontRegistry,
) -> Result<MeasureTextBlockResult, boundtext::TextLayoutError> {
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

    let language = Language::from_option(input.language.as_deref());
    let white_space = crate::text::types::WhiteSpaceMode::from_option(input.white_space.as_deref());
    let raw_wrap = input
        .wrap
        .as_deref()
        .map_or(WrapMode::Char, WrapMode::parse_str);
    let effective_wrap = if white_space == crate::text::types::WhiteSpaceMode::NoWrap {
        WrapMode::None
    } else {
        raw_wrap
    };
    let force_newline = white_space == crate::text::types::WhiteSpaceMode::PreWrap;
    let line_height_px = resolve_line_metrics_for_style(
        registry,
        None,
        &font_families,
        input.font_weight.unwrap_or(400),
        &font_style,
        input.font_size_px,
        input.line_height,
        input.line_height_px,
    )
    .line_height_px;
    let writing_mode = WritingMode::from_option(input.writing_mode.as_deref());

    let preprocessed = crate::text::types::preprocess_text_for_white_space(
        &input.text,
        white_space,
        input.tab_size.unwrap_or(4),
    );
    let text = preprocessed.as_str();

    if writing_mode == WritingMode::VerticalRl {
        let max_height = input
            .max_height
            .ok_or(boundtext::TextLayoutError::InvalidRequest {
                reason: boundtext::TextRequestError::MissingInlineConstraint {
                    field: boundtext::TextConstraintField::FlowBounds,
                },
            })?;
        let req = TextLayoutRequest {
            text,
            spans: None,
            rich_text: None,
            font_size_px: input.font_size_px,
            line_height: input.line_height,
            line_height_px: input.line_height_px,
            letter_spacing_px: input.letter_spacing_px.unwrap_or(0.0),
            text_indent: input.text_indent,
            max_width: f64::MAX,
            max_height: Some(max_height),
            wrap: effective_wrap,
            white_space,
            tab_size: input.tab_size.unwrap_or(4),
            fit: crate::text::types::FitMode::None,
            max_lines: None,
            ellipsis: false,
            language,
            writing_mode,
            text_orientation: crate::text::types::TextOrientation::from_option(
                input.text_orientation.as_deref(),
            ),
            uax14_breaks: None,
            hanging_punctuation: input.hanging_punctuation.unwrap_or(false),
            font_variation_settings: parse_variation_settings_opt(
                input.font_variation_settings.as_deref(),
            ),
            font_feature_settings: parse_feature_settings_opt(
                input.font_feature_settings.as_deref(),
            ),
            min_font_size_px: None,
            shrink_epsilon_px: None,
            shrink_max_iterations: None,
            max_font_size_px: None,
            grow_epsilon_px: None,
            grow_max_iterations: None,
            fit_max_probes: None,
        };
        let layout_result = crate::text::engine::layout_text(&req, &font_ctx)?;
        return Ok(MeasureTextBlockResult {
            line_count: layout_result.lines.len(),
            used_width: layout_result.bbox.w,
            used_height: layout_result.bbox.h,
            // Vertical lines carry no character ranges; per-line data for
            // vertical text is available via layoutTextFlow.
            lines: None,
        });
    }

    let max_width = input
        .max_width
        .ok_or(boundtext::TextLayoutError::InvalidRequest {
            reason: boundtext::TextRequestError::MissingInlineConstraint {
                field: boundtext::TextConstraintField::MaxWidth,
            },
        })?;

    // The width-independent paragraph fast path cannot represent a fallback
    // chain because its advances are stored in one font's design units. Use
    // the full text engine for multi-font shaping, then derive the same public
    // per-line diagnostics from its authoritative line text.
    if font_families.len() > 1 {
        let req = PlainTextMeasurementRequest {
            text,
            font_size_px: input.font_size_px,
            line_height: input.line_height,
            line_height_px: input.line_height_px,
            letter_spacing_px: input.letter_spacing_px.unwrap_or(0.0),
            text_indent: input.text_indent,
            max_width,
            wrap: effective_wrap,
            white_space,
            tab_size: input.tab_size.unwrap_or(4),
            language,
            uax14_breaks: None,
            hanging_punctuation: input.hanging_punctuation.unwrap_or(false),
            font_variation_settings: parse_variation_settings_opt(
                input.font_variation_settings.as_deref(),
            ),
            font_feature_settings: parse_feature_settings_opt(
                input.font_feature_settings.as_deref(),
            ),
        };
        let result = crate::text::engine::measure_text_lines(&req, &font_ctx)?;
        let lines = result
            .lines
            .iter()
            .map(|line| MeasureTextBlockLineDto {
                char_start: line.char_start,
                char_end: line.char_end,
                text: line.text.clone(),
                inline_advance_px: line.inline_advance_px,
                kinsoku_unresolved: line.kinsoku_unresolved,
            })
            .collect();
        return Ok(MeasureTextBlockResult {
            line_count: result.lines.len(),
            used_width: result.used_width,
            used_height: result.used_height,
            lines: Some(lines),
        });
    }

    let pp = paragraph::shape_paragraph_with_options(
        text,
        &font_ctx,
        language,
        effective_wrap,
        input.hanging_punctuation.unwrap_or(false),
        &ShapeOptions {
            font_variation_settings: parse_variation_settings_opt(
                input.font_variation_settings.as_deref(),
            ),
            font_feature_settings: parse_feature_settings_opt(
                input.font_feature_settings.as_deref(),
            ),
            ..ShapeOptions::default()
        },
        None,
        input.letter_spacing_px.unwrap_or(0.0),
        force_newline,
    )
    .ok_or_else(|| {
        super::font_or_preparation_error(
            &font_ctx,
            0,
            boundtext::TextPreparationPhase::PlainShaping,
        )
    })?;

    let measurement = paragraph::measure_paragraph_with_lines_and_indent(
        &pp,
        input.font_size_px,
        max_width,
        effective_wrap,
        force_newline,
        input.text_indent.unwrap_or(0.0),
    );
    // Slice each line's text out of the measured (whitespace-normalized)
    // paragraph via the shaper's grapheme byte offsets — authoritative, no
    // client-side re-segmentation needed.
    let lines = measurement
        .lines
        .iter()
        .map(|line| {
            Ok(MeasureTextBlockLineDto {
                char_start: line.char_start,
                char_end: line.char_end,
                text: slice_measured_line_text(
                    &pp.text,
                    &pp.char_byte_offsets,
                    line.char_start,
                    line.char_end,
                )?,
                inline_advance_px: line.width,
                kinsoku_unresolved: line.kinsoku_unresolved,
            })
        })
        .collect::<Result<Vec<_>, boundtext::TextLayoutError>>()?;

    Ok(MeasureTextBlockResult {
        line_count: measurement.measure.line_count,
        used_width: measurement.measure.max_line_width,
        used_height: measurement.measure.line_count as f64 * line_height_px,
        lines: Some(lines),
    })
}

fn slice_measured_line_text(
    text: &str,
    byte_offsets: &[u32],
    start: usize,
    end: usize,
) -> Result<String, boundtext::TextLayoutError> {
    let Some(&start_offset) = byte_offsets.get(start) else {
        return Err(boundtext::TextLayoutError::InvariantViolation {
            invariant: boundtext::TextLayoutInvariant::LineRangeMissing,
        });
    };
    let Some(&end_offset) = byte_offsets.get(end) else {
        return Err(boundtext::TextLayoutError::InvariantViolation {
            invariant: boundtext::TextLayoutInvariant::LineRangeMissing,
        });
    };
    let start_offset = start_offset as usize;
    let end_offset = end_offset as usize;
    if start_offset > end_offset {
        return Err(boundtext::TextLayoutError::InvariantViolation {
            invariant: boundtext::TextLayoutInvariant::LineRangeReversed,
        });
    }
    if end_offset > text.len() {
        return Err(boundtext::TextLayoutError::InvariantViolation {
            invariant: boundtext::TextLayoutInvariant::LineRangeOutOfBounds,
        });
    }
    if !text.is_char_boundary(start_offset) || !text.is_char_boundary(end_offset) {
        return Err(boundtext::TextLayoutError::InvariantViolation {
            invariant: boundtext::TextLayoutInvariant::LineRangeNotUtf8Boundary,
        });
    }
    Ok(text[start_offset..end_offset].to_string())
}

#[cfg(test)]
mod c2b_line_range_contract {
    use boundtext::{TextLayoutError, TextLayoutInvariant};

    use super::slice_measured_line_text;

    fn assert_invariant(result: Result<String, TextLayoutError>, expected: TextLayoutInvariant) {
        assert!(matches!(
            result,
            Err(TextLayoutError::InvariantViolation { invariant }) if invariant == expected
        ));
    }

    #[test]
    fn line_range_faults_are_typed_instead_of_becoming_partial_success() {
        assert_invariant(
            slice_measured_line_text("A", &[0, 1], 2, 2),
            TextLayoutInvariant::LineRangeMissing,
        );
        assert_invariant(
            slice_measured_line_text("AB", &[0, 2, 1], 1, 2),
            TextLayoutInvariant::LineRangeReversed,
        );
        assert_invariant(
            slice_measured_line_text("ABC", &[0, 4], 0, 1),
            TextLayoutInvariant::LineRangeOutOfBounds,
        );
        assert_invariant(
            slice_measured_line_text("é", &[0, 1], 0, 1),
            TextLayoutInvariant::LineRangeNotUtf8Boundary,
        );
    }
}
