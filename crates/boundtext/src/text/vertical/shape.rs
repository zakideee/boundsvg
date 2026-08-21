use super::common::resolve_font;
use crate::font::FontContext;
use crate::font::shaping::{self, GlyphInfo, ShapeOptions};

// ---------------------------------------------------------------------------
// Shaping helper (vertical)
// ---------------------------------------------------------------------------

pub(crate) fn shape_text_vertical(
    font_ctx: &FontContext<'_>,
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
    shape_options: &ShapeOptions,
) -> Option<Vec<GlyphInfo>> {
    if text.is_empty() {
        return Some(Vec::new());
    }

    if font_ctx.families.len() > 1 {
        let result = shaping::shape_with_fallback_and_options(
            font_ctx,
            text,
            font_size_px,
            letter_spacing_px,
            shape_options,
        );
        if !result.glyphs.is_empty() {
            return Some(result.glyphs);
        }
        if let Some(fallback) = font_ctx.fallback_registry {
            let fallback_ctx = FontContext {
                registry: fallback,
                fallback_registry: None,
                families: font_ctx.families,
                weight: font_ctx.weight,
                style: font_ctx.style,
            };
            let result = shaping::shape_with_fallback_and_options(
                &fallback_ctx,
                text,
                font_size_px,
                letter_spacing_px,
                shape_options,
            );
            if !result.glyphs.is_empty() {
                return Some(result.glyphs);
            }
        }
    }

    let font_entry = resolve_font(
        font_ctx.registry,
        font_ctx.fallback_registry,
        font_ctx.families,
        font_ctx.weight,
        font_ctx.style,
    )?;
    Some(shaping::shape_text_with_options(
        font_ctx.registry,
        font_entry,
        text,
        font_size_px,
        letter_spacing_px,
        shape_options,
    ))
}
