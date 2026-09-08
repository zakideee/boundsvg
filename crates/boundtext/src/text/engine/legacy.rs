//! Raw authored glyph projection retained independently of resolved layout.

use crate::font::FontContext;
use crate::font::shaping::{GlyphInfo, ShapeOptions, measure_width, shape_text_with_options};

/// Unwrapped authored glyphs for consumers of the legacy measurement fields.
///
/// This projection carries no layout or warning authority. In particular, a
/// renderer may obtain it when a fixed-size node has no resolved text result.
#[derive(Debug, Clone)]
pub struct LegacyUnwrappedGlyphProjection {
    pub glyphs: Vec<GlyphInfo>,
    pub measured_width: f64,
}

/// Project raw authored text using the first face in the registry lookup chain.
///
/// Whitespace, authored size, and missing glyphs are retained: per-glyph fallback
/// and resolved layout would change the legacy fields. Returns `None` when no
/// requested face can be resolved.
#[must_use]
pub fn project_legacy_unwrapped_glyphs(
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
    shape_options: &ShapeOptions,
    font_context: &FontContext<'_>,
) -> Option<LegacyUnwrappedGlyphProjection> {
    let font_entry = font_context
        .registry
        .resolve_chain(
            font_context.families,
            font_context.weight,
            font_context.style,
        )
        .or_else(|| {
            font_context.fallback_registry.and_then(|registry| {
                registry.resolve_chain(
                    font_context.families,
                    font_context.weight,
                    font_context.style,
                )
            })
        })?;
    let glyphs = shape_text_with_options(
        font_context.registry,
        font_entry,
        text,
        font_size_px,
        letter_spacing_px,
        shape_options,
    );
    let measured_width = measure_width(&glyphs);
    Some(LegacyUnwrappedGlyphProjection {
        glyphs,
        measured_width,
    })
}
