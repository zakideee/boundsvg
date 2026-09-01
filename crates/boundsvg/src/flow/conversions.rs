use super::geometry;
use super::types::{
    FlowOverflowReason, FlowTextSpanDto, ShrinkwrapStatusDto, TextFlowExclusionLine,
    TextFlowFragment, TextFlowFragmentStyle, TextFlowLine, TextFlowResult, TextFlowRubyAnnotation,
    TextFlowRubyAnnotationLevel, TextFlowRubyAnnotationRun, TextFlowWithExclusionsResult,
};
use crate::diagnostics::text_warning_to_recoverable;
use crate::text::flow as bt_flow;
use crate::text::shrinkwrap;

// ---------------------------------------------------------------------------
// Exclusion region provider
// ---------------------------------------------------------------------------

/// Adapt boundsvg exclusion geometry to boundtext's logical-region contract.
pub(super) struct ExclusionRegionProvider<'a> {
    pub flow_box: &'a geometry::FlowBox,
    pub exclusions: &'a [geometry::FlowExclusionShape],
}

impl bt_flow::RegionProvider for ExclusionRegionProvider<'_> {
    fn regions(
        &self,
        query: bt_flow::RegionQuery,
    ) -> Result<Vec<bt_flow::FlowRegion>, boundtext::RegionProviderError> {
        let regions = match query.writing_mode {
            crate::text::types::WritingMode::HorizontalTb => {
                let band_top = self.flow_box.y + query.cross_start_px;
                let band_bottom = self.flow_box.y + query.cross_end_px;
                geometry::compute_line_regions(
                    self.flow_box,
                    self.exclusions,
                    band_top,
                    band_bottom,
                    query.min_inline_size_px,
                )
                .iter()
                .map(|region| bt_flow::FlowRegion {
                    inline_start_px: region.x,
                    inline_size_px: region.width,
                })
                .collect()
            }
            crate::text::types::WritingMode::VerticalRl => {
                let right = self.flow_box.x + self.flow_box.width - query.cross_start_px;
                let left = self.flow_box.x + self.flow_box.width - query.cross_end_px;
                geometry::compute_column_regions(
                    self.flow_box,
                    self.exclusions,
                    left,
                    right,
                    query.min_inline_size_px,
                )
                .iter()
                .map(|region| bt_flow::FlowRegion {
                    inline_start_px: region.y,
                    inline_size_px: region.height,
                })
                .collect()
            }
        };
        Ok(regions)
    }

    fn fit_search_kind(&self) -> bt_flow::FitSearchKind {
        if self.exclusions.is_empty() {
            bt_flow::FitSearchKind::CertifiedMonotone
        } else {
            bt_flow::FitSearchKind::Uncertified
        }
    }
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/// Convert a `FlowTextSpanDto` to `boundtext::text::flow::FlowTextSpan`.
pub(super) fn convert_flow_span(dto: &FlowTextSpanDto) -> bt_flow::FlowTextSpan {
    bt_flow::FlowTextSpan {
        text: dto.text.clone(),
        font_family: dto.font_family.clone(),
        fallback: dto.fallback.clone(),
        font_weight: dto.font_weight,
        font_style: dto.font_style.clone(),
        font_size_px: dto.font_size_px,
        letter_spacing_px: dto.letter_spacing_px,
        color: dto.color.clone(),
        font_variation_settings: dto.font_variation_settings.clone(),
        font_feature_settings: dto.font_feature_settings.clone(),
        ruby_text: dto.ruby_text.clone(),
        ruby_position: dto.ruby_position.clone(),
        ruby_align: dto.ruby_align.clone(),
        ruby_font_size_px: dto.ruby_font_size_px,
        ruby_color: dto.ruby_color.clone(),
    }
}

/// Convert a `bt_flow::FlowOverflowReason` to the serde-annotated DTO version.
pub(super) fn convert_overflow_reason(reason: bt_flow::FlowOverflowReason) -> FlowOverflowReason {
    match reason {
        bt_flow::FlowOverflowReason::MaxLinesTruncated => FlowOverflowReason::MaxLinesTruncated,
        bt_flow::FlowOverflowReason::FlowBoxExhausted => FlowOverflowReason::FlowBoxExhausted,
        bt_flow::FlowOverflowReason::CannotFit => FlowOverflowReason::CannotFit,
    }
}

/// Convert a `bt_flow::FlowFragmentStyle` to `TextFlowFragmentStyle`.
pub(super) fn convert_fragment_style(style: &bt_flow::FlowFragmentStyle) -> TextFlowFragmentStyle {
    TextFlowFragmentStyle {
        font_family: style.font_family.clone(),
        font_weight: style.font_weight,
        font_style: style.font_style.clone(),
        font_size_px: style.font_size_px,
        letter_spacing_px: style.letter_spacing_px,
        color: style.color.clone(),
    }
}

/// Convert a `bt_flow::FlowRubyAnnotation` to `TextFlowRubyAnnotation`.
pub(super) fn convert_ruby_annotation(
    ruby: &bt_flow::FlowRubyAnnotation,
) -> TextFlowRubyAnnotation {
    TextFlowRubyAnnotation {
        text: ruby.text.clone(),
        position: ruby.position.clone(),
        align: ruby.align.clone(),
        style: convert_fragment_style(&ruby.style),
        gap_px: ruby.gap_px,
        offset_px: ruby.offset_px,
        line_sizing: ruby.line_sizing.clone(),
        levels: ruby
            .levels
            .iter()
            .map(|level| TextFlowRubyAnnotationLevel {
                text: level.text.clone(),
                position: level.position.clone(),
                runs: level
                    .runs
                    .iter()
                    .map(|run| TextFlowRubyAnnotationRun {
                        text: run.text.clone(),
                        style: convert_fragment_style(&run.style),
                    })
                    .collect(),
            })
            .collect(),
    }
}

/// Convert a `bt_flow::FlowFragment` to `TextFlowFragment`.
pub(super) fn convert_fragment(frag: &bt_flow::FlowFragment) -> TextFlowFragment {
    TextFlowFragment {
        text: frag.text.clone(),
        char_start: frag.char_start,
        char_end: frag.char_end,
        x: frag.x,
        y: frag.y,
        inline_advance_px: frag.inline_advance_px,
        available_inline_size_px: frag.available_inline_size_px,
        region_index: frag.region_index,
        baseline_offset: frag.baseline_offset,
        overflow_reason: frag.overflow_reason.clone(),
        style: frag.style.as_ref().map(convert_fragment_style),
        ruby: frag.ruby.as_ref().map(convert_ruby_annotation),
    }
}

/// Convert a `bt_flow::FlowSimpleResult` to `TextFlowResult`.
pub(super) fn convert_simple_result(result: bt_flow::FlowSimpleResult) -> TextFlowResult {
    TextFlowResult {
        lines: result
            .lines
            .into_iter()
            .map(|l| TextFlowLine {
                text: l.text,
                char_start: l.char_start,
                char_end: l.char_end,
                inline_advance_px: l.inline_advance_px,
                available_inline_size_px: l.available_inline_size_px,
            })
            .collect(),
        exhausted: result.exhausted,
        warnings: result
            .warnings
            .iter()
            .map(|warning| text_warning_to_recoverable(warning, None))
            .collect(),
    }
}

/// Convert a `bt_flow::FlowLayoutResult` to `TextFlowWithExclusionsResult`.
pub(super) fn convert_flow_result(
    result: bt_flow::FlowLayoutResult,
) -> TextFlowWithExclusionsResult {
    let (top_ruby_overflow_px, bottom_ruby_overflow_px) = bt_flow::compute_ruby_overflow(&result);
    TextFlowWithExclusionsResult {
        lines: result
            .lines
            .into_iter()
            .map(|vl| TextFlowExclusionLine {
                fragments: vl.fragments.iter().map(convert_fragment).collect(),
                line_index: vl.line_index,
                cross_size: vl.cross_size,
            })
            .collect(),
        exhausted: result.exhausted,
        used_line_count: result.used_line_count,
        overflow_reason: result.overflow_reason.map(convert_overflow_reason),
        chosen_font_size_px: result.chosen_font_size_px,
        warnings: result
            .warnings
            .iter()
            .map(|warning| text_warning_to_recoverable(warning, None))
            .collect(),
        top_ruby_overflow_px,
        bottom_ruby_overflow_px,
    }
}

pub(super) fn convert_shrinkwrap_status(
    status: shrinkwrap::ShrinkwrapStatus,
) -> ShrinkwrapStatusDto {
    match status {
        shrinkwrap::ShrinkwrapStatus::Satisfied => ShrinkwrapStatusDto::Satisfied,
        shrinkwrap::ShrinkwrapStatus::Infeasible => ShrinkwrapStatusDto::Infeasible,
    }
}
