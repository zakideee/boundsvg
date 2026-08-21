use thiserror::Error;

#[derive(Debug, Error)]
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
