//! Renderer trait for SVG rasterization (PNG and lossless WebP).

use std::sync::Arc;

use crate::error::EngineError;
use crate::rasterize::RasterizeOptions;

/// Abstracts SVG rasterization (e.g. resvg, vello, Cairo).
pub trait Renderer: Send + Sync {
    /// Rasterize an SVG string to PNG bytes.
    ///
    /// # Errors
    ///
    /// Returns `EngineError` if SVG parsing or PNG rasterization fails.
    fn svg_to_png(
        &self,
        svg_string: &str,
        alias_map: &[(String, String)],
        font_data: &[Arc<Vec<u8>>],
        options: &RasterizeOptions,
    ) -> Result<Vec<u8>, EngineError>;

    /// Rasterize an SVG string to lossless (VP8L) WebP bytes.
    ///
    /// # Errors
    ///
    /// Returns `EngineError` if SVG parsing, rasterization, or WebP encoding
    /// fails.
    fn svg_to_webp(
        &self,
        svg_string: &str,
        alias_map: &[(String, String)],
        font_data: &[Arc<Vec<u8>>],
        options: &RasterizeOptions,
    ) -> Result<Vec<u8>, EngineError>;
}
