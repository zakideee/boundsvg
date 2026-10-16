//! Renderer trait for SVG rasterization (PNG and lossless WebP).

use std::sync::Arc;

use boundtext::font::backend::FontAdmission;

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

    /// Rasterize registered fonts with optional immutable-allocation admission proofs.
    ///
    /// The default preserves custom renderers' raw-font implementation. A renderer
    /// using the proofs must verify allocation identity before skipping admission.
    ///
    /// # Errors
    ///
    /// Return the renderer's SVG, font, rasterization or PNG encoding failure.
    fn svg_to_png_with_admission(
        &self,
        svg_string: &str,
        alias_map: &[(String, String)],
        font_data: &[Arc<Vec<u8>>],
        _admissions: &[Option<FontAdmission>],
        options: &RasterizeOptions,
    ) -> Result<Vec<u8>, EngineError> {
        self.svg_to_png(svg_string, alias_map, font_data, options)
    }

    /// Rasterize registered fonts to lossless WebP using optional matching proofs.
    ///
    /// Custom renderers retain their raw-font implementation by default.
    ///
    /// # Errors
    ///
    /// Return the renderer's SVG, font, rasterization or WebP encoding failure.
    fn svg_to_webp_with_admission(
        &self,
        svg_string: &str,
        alias_map: &[(String, String)],
        font_data: &[Arc<Vec<u8>>],
        _admissions: &[Option<FontAdmission>],
        options: &RasterizeOptions,
    ) -> Result<Vec<u8>, EngineError> {
        self.svg_to_webp(svg_string, alias_map, font_data, options)
    }
}
