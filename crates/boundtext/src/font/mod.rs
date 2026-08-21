pub mod backend;
#[cfg(feature = "rustybuzz-backend")]
pub mod backend_rustybuzz;
#[cfg(feature = "ttfparser-backend")]
pub mod backend_ttfparser;
pub mod line_metrics;
pub mod outline;
pub mod registry;
pub mod shaping;
pub mod vertical_orientation;

pub use outline::{
    GlyphPath, GlyphPosition, PositionedGlyphPathInput, extract_glyph_paths,
    extract_positioned_glyph_path,
};
pub use registry::{FontEntry, FontKey, FontRegistry, FontStyle, RasterizeFontData};
pub use shaping::{
    FallbackGlyphRun, FallbackShapeResult, FeatureSetting, GlyphInfo, ShapeOptions,
    VariationSetting, measure_width, parse_css_font_feature_settings,
    parse_css_font_variation_settings, shape_text, shape_text_with_options, shape_with_fallback,
    shape_with_fallback_and_options, to_css_font_feature_settings, to_css_font_variation_settings,
    to_shape_variations,
};

/// Immutable font resolution context passed through the text layout pipeline.
///
/// Groups the font registry, optional fallback registry, font family chain,
/// weight, and style — the five parameters that appear together in most
/// text-shaping and layout functions.
#[derive(Clone, Copy)]
pub struct FontContext<'a> {
    /// Primary font registry.
    pub registry: &'a FontRegistry,
    /// Optional fallback registry (e.g., system fonts).
    pub fallback_registry: Option<&'a FontRegistry>,
    /// Ordered font family aliases for resolution chain.
    pub families: &'a [String],
    /// CSS font-weight (100–900).
    pub weight: u16,
    /// CSS font-style (Normal / Italic).
    pub style: &'a FontStyle,
}
