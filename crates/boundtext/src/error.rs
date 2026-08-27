use thiserror::Error;

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

    #[error("Text fit step must be positive and finite")]
    InvalidFitStep,

    #[error("Text fit requires {required} probes, exceeding the limit of {limit}")]
    FitProbeLimit { required: usize, limit: usize },

    #[error(
        "Text ellipsis requires up to {required} exact candidates, exceeding the limit of {limit}"
    )]
    EllipsisCandidateLimit { required: usize, limit: usize },

    #[error("Rich text depth {actual} exceeds the limit of {limit}")]
    RichTextDepthLimit { actual: usize, limit: usize },

    #[error("Rich text contains {required} inline rectangles, exceeding the limit of {limit}")]
    InlineRectLimit { required: usize, limit: usize },

    #[error("Flow layout failed: {0}")]
    FlowLayout(String),

    #[error("Invalid flow-region query: {0}")]
    InvalidRegionQuery(String),

    #[error("Invalid flow region at index {index}: {reason}")]
    InvalidFlowRegion { index: usize, reason: String },

    #[error("Flow layout exceeded the deterministic region-query limit of {limit}")]
    RegionQueryLimit { limit: usize },

    #[error(
        "Flow layout requires {required} returned intervals, exceeding the deterministic limit of {limit}"
    )]
    RegionIntervalLimit { required: usize, limit: usize },
}

/// Fatal failure of the authoritative text-layout operation.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum TextLayoutError {
    #[error("Text layout could not prepare or shape the complete request")]
    PreparationFailed,

    #[error(
        "Text ellipsis requires up to {required} exact candidates, exceeding the limit of {limit}"
    )]
    EllipsisCandidateLimit { required: usize, limit: usize },

    #[error("Text fit step must be positive and finite")]
    InvalidFitStep,

    #[error("Text fit requires {required} probes, exceeding the limit of {limit}")]
    FitProbeLimit { required: usize, limit: usize },

    #[error("Rich text depth {actual} exceeds the limit of {limit}")]
    RichTextDepthLimit { actual: usize, limit: usize },

    #[error("Rich text contains {required} inline rectangles, exceeding the limit of {limit}")]
    InlineRectLimit { required: usize, limit: usize },
}
