use thiserror::Error;

use crate::diagnostics::PipelineStage;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("Text/font error: {0}")]
    Boundtext(#[from] boundtext::BoundtextError),

    #[error("WOFF2 decompression failed: {0}")]
    Woff2Decode(String),

    #[error("Layout computation failed: {0}")]
    Layout(String),

    #[error("Invalid color '{color}': {reason}")]
    ColorParse { color: String, reason: String },

    #[cfg(feature = "resvg-backend")]
    #[error("Failed to parse SVG: {0}")]
    SvgParse(#[from] usvg::Error),

    #[cfg(not(feature = "resvg-backend"))]
    #[error("Failed to parse SVG: {0}")]
    SvgParse(String),

    #[error("{0}")]
    Rasterize(String),

    #[error("Validation error: {0}")]
    Validation(String),

    /// Error carrying the TS `FatalError` fields so the JS side can rebuild
    /// the exact code / stage / nodeId contract across the WASM boundary.
    #[error("{message}")]
    Structured {
        code: String,
        message: String,
        stage: Option<PipelineStage>,
        node_id: Option<String>,
    },

    /// Structured render failure with a code-specific JSON context payload.
    ///
    /// Most errors only need the common stage/node fields above. Errors with
    /// machine-readable, code-specific details use this variant so the common
    /// constructor does not need a context payload.
    #[error("{message}")]
    StructuredContext {
        code: String,
        message: String,
        stage: Option<PipelineStage>,
        node_id: Option<String>,
        context: Box<serde_json::Value>,
    },
}

impl From<EngineError> for String {
    fn from(err: EngineError) -> String {
        err.to_string()
    }
}
