use thiserror::Error;

use crate::font::FontStyle;

/// Failures owned by font registration, backend construction, or glyph-outline input.
#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum BoundtextError {
    #[error("Failed to parse font: {0}")]
    FontParse(String),

    #[error("Font already registered: alias={alias}, weight={weight}, style={style:?}")]
    FontAlreadyRegistered {
        alias: String,
        weight: u16,
        style: String,
    },

    #[error("Baseline glyph rotation must be finite")]
    InvalidBaselineRotation,

    #[error("Positioned glyph inline scale must be positive and finite")]
    InvalidInlineScale,
}

/// Request constraints which cannot be represented by a text-layout operation.
#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
pub enum TextConstraintField {
    #[error("max width")]
    MaxWidth,
    #[error("line widths")]
    LineWidths,
    #[error("flow bounds")]
    FlowBounds,
}

/// Closed reasons for rejecting a domain request.
#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
pub enum TextRequestError {
    #[error("line widths are required")]
    MissingLineWidths,
    #[error("the required inline constraint is missing: {field}")]
    MissingInlineConstraint { field: TextConstraintField },
    #[error("plain, span, and rich text sources conflict")]
    ConflictingTextSources,
    #[error("the request shape is invalid")]
    InvalidRequestShape,
}

/// Closed preparation phase identity for failures without a more specific cause.
#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
pub enum TextPreparationPhase {
    #[error("font resolution")]
    FontResolution,
    #[error("plain shaping")]
    PlainShaping,
    #[error("span shaping")]
    SpanShaping,
    #[error("rich preparation")]
    RichPreparation,
    #[error("vertical layout")]
    VerticalLayout,
    #[error("flow preparation")]
    FlowPreparation,
    #[error("result projection")]
    ResultProjection,
}

/// Numeric query field rejected before calling a region provider.
#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
pub enum RegionQueryField {
    #[error("flow x")]
    FlowX,
    #[error("flow y")]
    FlowY,
    #[error("flow width")]
    FlowWidth,
    #[error("flow height")]
    FlowHeight,
    #[error("cross start")]
    CrossStart,
    #[error("cross end")]
    CrossEnd,
    #[error("minimum inline size")]
    MinimumInlineSize,
}

/// Closed reasons for rejecting a region query.
#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
pub enum RegionQueryError {
    #[error("a region-query bound is not finite: {field}")]
    NonFiniteBounds { field: RegionQueryField },
    #[error("a flow-frame extent is negative: {field}")]
    NegativeFlowExtent { field: RegionQueryField },
    #[error("the cross-axis range is reversed")]
    ReversedCrossRange,
    #[error("the minimum inline size is negative")]
    NegativeMinimumInlineSize,
}

/// Closed failures which a geometry provider may return.
#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
pub enum RegionProviderError {
    #[error("region provider is unavailable")]
    Unavailable,
    #[error("region provider does not support the query")]
    UnsupportedQuery,
    #[error("region provider exhausted its resources")]
    ResourceExhausted,
    #[error("region provider failed internally")]
    InternalFailure,
}

/// Numeric field in an invalid provider interval.
#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
pub enum FlowRegionField {
    #[error("inline start")]
    InlineStart,
    #[error("inline size")]
    InlineSize,
    #[error("inline end")]
    InlineEnd,
}

/// Closed reasons for rejecting a returned flow interval.
#[derive(Debug, Clone, Copy, Error, PartialEq)]
pub enum FlowRegionError {
    #[error("a flow interval field is not finite: {field}")]
    NonFiniteInterval { field: FlowRegionField },
    #[error("flow interval {actual} is below the minimum {minimum}")]
    IntervalBelowMinimum { actual: f64, minimum: f64 },
    #[error("flow interval [{start}, {end}] lies outside frame [{frame_start}, {frame_end}]")]
    IntervalOutsideFrame {
        start: f64,
        end: f64,
        frame_start: f64,
        frame_end: f64,
    },
    #[error("flow interval starts at {current_start} before the previous end {previous_end}")]
    OverlappingIntervals {
        previous_end: f64,
        current_start: f64,
    },
}

/// Checked invariant whose violation must not become partial success or panic.
#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
pub enum TextLayoutInvariant {
    #[error("line range is missing")]
    LineRangeMissing,
    #[error("line range is reversed")]
    LineRangeReversed,
    #[error("line range is outside the source text")]
    LineRangeOutOfBounds,
    #[error("line range is not on UTF-8 boundaries")]
    LineRangeNotUtf8Boundary,
    #[error("flow layout made no progress")]
    FlowMadeNoProgress,
}

/// Fatal failure of the authoritative text-layout operation.
#[derive(Debug, Clone, Error, PartialEq)]
pub enum TextLayoutError {
    #[error("invalid text-layout request: {reason}")]
    InvalidRequest { reason: TextRequestError },

    #[error(
        "no requested font is available for run {run_index}: families={families:?}, weight={weight}, style={style:?}"
    )]
    FontUnavailable {
        run_index: usize,
        families: Vec<String>,
        weight: u16,
        style: FontStyle,
    },

    #[error("text-layout preparation failed during {phase}")]
    PreparationFailed { phase: TextPreparationPhase },

    #[error("text fit step must be positive and finite")]
    InvalidFitStep,

    #[error("text fit requires {required} probes, exceeding the limit of {limit}")]
    FitProbeLimit { required: usize, limit: usize },

    #[error(
        "text ellipsis requires up to {required} exact candidates, exceeding the limit of {limit}"
    )]
    EllipsisCandidateLimit { required: usize, limit: usize },

    #[error("rich text depth {actual} exceeds the limit of {limit}")]
    RichTextDepthLimit { actual: usize, limit: usize },

    #[error("rich text contains {required} inline rectangles, exceeding the limit of {limit}")]
    InlineRectLimit { required: usize, limit: usize },

    #[error("invalid region query: {reason}")]
    InvalidRegionQuery { reason: RegionQueryError },

    #[error("region provider failure: {reason}")]
    RegionProviderFailure { reason: RegionProviderError },

    #[error("invalid flow region at index {index}: {reason}")]
    InvalidFlowRegion {
        index: usize,
        reason: FlowRegionError,
    },

    #[error("flow layout exceeded the deterministic region-query limit of {limit}")]
    RegionQueryLimit { limit: usize },

    #[error(
        "flow layout requires {required} returned intervals, exceeding the deterministic limit of {limit}"
    )]
    RegionIntervalLimit { required: usize, limit: usize },

    #[error("text-layout invariant failed: {invariant}")]
    InvariantViolation { invariant: TextLayoutInvariant },
}
