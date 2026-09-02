use crate::font::FontContext;
use crate::font::shaping::{GlyphInfo, ShapeOptions};

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
    crate::text::shape_checked_text_run(
        font_ctx,
        text,
        font_size_px,
        letter_spacing_px,
        shape_options,
        0,
        crate::TextPreparationPhase::VerticalLayout,
    )
}
