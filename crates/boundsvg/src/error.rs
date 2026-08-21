use thiserror::Error;

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
        stage: Option<String>,
        node_id: Option<String>,
    },
}

impl From<EngineError> for String {
    fn from(err: EngineError) -> String {
        err.to_string()
    }
}
