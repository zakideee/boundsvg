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
) -> Result<Vec<GlyphInfo>, crate::TextLayoutError> {
    if text.is_empty() {
        return Ok(Vec::new());
    }

    if font_ctx.families.len() > 1 {
        let result = shaping::shape_with_fallback_and_options_checked(
            font_ctx,
            text,
            font_size_px,
            letter_spacing_px,
            shape_options,
        )
        .ok_or_else(|| crate::TextLayoutError::FontUnavailable {
            run_index: 0,
            families: font_ctx.families.to_vec(),
            weight: font_ctx.weight,
            style: font_ctx.style.clone(),
        })?;
        if !result.glyphs.is_empty() {
            return Ok(result.glyphs);
        }
        return Err(crate::TextLayoutError::PreparationFailed {
            phase: crate::TextPreparationPhase::VerticalLayout,
        });
    }

    let font_entry = resolve_font(
        font_ctx.registry,
        font_ctx.fallback_registry,
        font_ctx.families,
        font_ctx.weight,
        font_ctx.style,
    )
    .ok_or_else(|| crate::TextLayoutError::FontUnavailable {
        run_index: 0,
        families: font_ctx.families.to_vec(),
        weight: font_ctx.weight,
        style: font_ctx.style.clone(),
    })?;
    Ok(shaping::shape_text_with_options(
        font_ctx.registry,
        font_entry,
        text,
        font_size_px,
        letter_spacing_px,
        shape_options,
    ))
}
