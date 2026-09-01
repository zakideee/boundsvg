//! C2b closed public operation-error contract.

use boundtext::font::FontContext;
use boundtext::text::engine::{MeasuredTextBlock, measure_text_lines};
use boundtext::text::flow::{FlowRegion, RegionProvider, RegionQuery};
use boundtext::text::types::PlainTextMeasurementRequest;
use boundtext::{
    FlowRegionError, FlowRegionField, RegionProviderError, RegionQueryError, RegionQueryField,
    TextConstraintField, TextLayoutError, TextLayoutInvariant, TextPreparationPhase,
    TextRequestError,
};

struct FailingRegionProvider;

impl RegionProvider for FailingRegionProvider {
    fn regions(&self, _query: RegionQuery) -> Result<Vec<FlowRegion>, RegionProviderError> {
        Err(RegionProviderError::Unavailable)
    }
}

fn assert_plain_measurement_signature<'request, 'fonts>(
    request: &PlainTextMeasurementRequest<'request>,
    font_context: &FontContext<'fonts>,
) -> Result<MeasuredTextBlock, TextLayoutError> {
    measure_text_lines(request, font_context)
}

#[test]
fn text_layout_error_exposes_only_closed_typed_reasons() {
    let errors = [
        TextLayoutError::InvalidRequest {
            reason: TextRequestError::MissingLineWidths,
        },
        TextLayoutError::InvalidRequest {
            reason: TextRequestError::MissingInlineConstraint {
                field: TextConstraintField::MaxWidth,
            },
        },
        TextLayoutError::InvalidRequest {
            reason: TextRequestError::ConflictingTextSources,
        },
        TextLayoutError::InvalidRequest {
            reason: TextRequestError::InvalidRequestShape,
        },
        TextLayoutError::FontUnavailable {
            run_index: 0,
            families: vec!["Fixture".to_string()],
            weight: 400,
            style: boundtext::font::FontStyle::Normal,
        },
        TextLayoutError::PreparationFailed {
            phase: TextPreparationPhase::PlainShaping,
        },
        TextLayoutError::InvalidFitStep,
        TextLayoutError::FitProbeLimit {
            required: 2,
            limit: 1,
        },
        TextLayoutError::EllipsisCandidateLimit {
            required: 2,
            limit: 1,
        },
        TextLayoutError::RichTextDepthLimit {
            actual: 49,
            limit: 48,
        },
        TextLayoutError::InlineRectLimit {
            required: 4_097,
            limit: 4_096,
        },
        TextLayoutError::InvalidRegionQuery {
            reason: RegionQueryError::NonFiniteBounds {
                field: RegionQueryField::FlowWidth,
            },
        },
        TextLayoutError::InvalidRegionQuery {
            reason: RegionQueryError::ReversedCrossRange,
        },
        TextLayoutError::InvalidRegionQuery {
            reason: RegionQueryError::NegativeMinimumInlineSize,
        },
        TextLayoutError::RegionProviderFailure {
            reason: RegionProviderError::Unavailable,
        },
        TextLayoutError::InvalidFlowRegion {
            index: 3,
            reason: FlowRegionError::NonFiniteInterval {
                field: FlowRegionField::InlineStart,
            },
        },
        TextLayoutError::InvalidFlowRegion {
            index: 3,
            reason: FlowRegionError::IntervalBelowMinimum {
                actual: 1.0,
                minimum: 2.0,
            },
        },
        TextLayoutError::InvalidFlowRegion {
            index: 3,
            reason: FlowRegionError::IntervalOutsideFrame {
                start: 1.0,
                end: 3.0,
                frame_start: 0.0,
                frame_end: 2.0,
            },
        },
        TextLayoutError::InvalidFlowRegion {
            index: 3,
            reason: FlowRegionError::OverlappingIntervals {
                previous_end: 2.0,
                current_start: 1.0,
            },
        },
        TextLayoutError::RegionQueryLimit { limit: 1 },
        TextLayoutError::RegionIntervalLimit {
            required: 2,
            limit: 1,
        },
        TextLayoutError::InvariantViolation {
            invariant: TextLayoutInvariant::LineRangeMissing,
        },
        TextLayoutError::InvariantViolation {
            invariant: TextLayoutInvariant::LineRangeReversed,
        },
        TextLayoutError::InvariantViolation {
            invariant: TextLayoutInvariant::LineRangeOutOfBounds,
        },
        TextLayoutError::InvariantViolation {
            invariant: TextLayoutInvariant::LineRangeNotUtf8Boundary,
        },
        TextLayoutError::InvariantViolation {
            invariant: TextLayoutInvariant::FlowMadeNoProgress,
        },
    ];

    assert_eq!(errors.len(), 26);
    assert!(errors.iter().all(|error| !error.to_string().is_empty()));
}

#[test]
fn provider_reasons_are_closed_and_cloneable_for_budget_memoization() {
    let reasons = [
        RegionProviderError::Unavailable,
        RegionProviderError::UnsupportedQuery,
        RegionProviderError::ResourceExhausted,
        RegionProviderError::InternalFailure,
    ];
    assert_eq!(reasons.to_vec(), reasons);

    let provider = FailingRegionProvider;
    let result = provider.regions(RegionQuery {
        writing_mode: boundtext::text::types::WritingMode::HorizontalTb,
        cross_start_px: 0.0,
        cross_end_px: 16.0,
        min_inline_size_px: 1.0,
    });
    assert_eq!(result, Err(RegionProviderError::Unavailable));
}

#[test]
fn plain_measurement_has_a_narrow_request_and_typed_result() {
    let _ = assert_plain_measurement_signature;
}

#[test]
fn boundtext_error_source_contains_no_layout_operation_variants() {
    let source = include_str!("../src/error.rs");
    for removed in [
        "InvalidFitStep",
        "FitProbeLimit",
        "EllipsisCandidateLimit",
        "RichTextDepthLimit",
        "InlineRectLimit",
        "FlowLayout(String)",
        "InvalidRegionQuery(String)",
        "InvalidFlowRegion",
        "RegionQueryLimit",
        "RegionIntervalLimit",
    ] {
        let boundtext_error = source
            .split("pub enum BoundtextError")
            .nth(1)
            .and_then(|tail| tail.split("pub enum TextLayoutError").next())
            .expect("BoundtextError source range");
        assert!(
            !boundtext_error.contains(removed),
            "stale BoundtextError variant: {removed}"
        );
    }
}
