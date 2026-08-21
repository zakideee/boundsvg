//! Default `Renderer` implementation using `resvg` / `usvg` / `tiny-skia`.

use std::sync::Arc;

use crate::error::EngineError;
use crate::rasterize::RasterizeOptions;
use crate::render_backend::Renderer;

/// `Renderer` implementation backed by the `resvg` crate.
pub struct ResvgRenderer;

impl Renderer for ResvgRenderer {
    fn svg_to_png(
        &self,
        svg_string: &str,
        alias_map: &[(String, String)],
        font_data: &[Arc<Vec<u8>>],
        options: &RasterizeOptions,
    ) -> Result<Vec<u8>, EngineError> {
        crate::rasterize::svg_to_png(svg_string, alias_map, font_data, options)
    }

    fn svg_to_webp(
        &self,
        svg_string: &str,
        alias_map: &[(String, String)],
        font_data: &[Arc<Vec<u8>>],
        options: &RasterizeOptions,
    ) -> Result<Vec<u8>, EngineError> {
        crate::webp_encode::svg_to_webp(svg_string, alias_map, font_data, options)
    }
}
