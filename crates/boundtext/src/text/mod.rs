pub mod decoration;
pub mod ellipsis;
pub(crate) mod ellipsis_plan;
pub mod engine;
pub mod fit;
pub mod flow;
pub mod grapheme;
pub mod inline_runs;
pub mod kinsoku;
pub mod linebreak;
pub mod paragraph;
pub mod path;
pub mod rich;
pub mod shrinkwrap;
pub mod types;
pub mod unit_map;
pub mod vertical;

use crate::font::FontContext;
use crate::font::shaping::{self, GlyphInfo, ShapeOptions};

/// Shape one non-empty effective text run for a checked layout operation.
///
/// Font lookup and the empty-glyph failure boundary are intentionally shared
/// by plain, span, rich, fit, and vertical callers. Low-level shaping remains
/// fallible-by-empty, while checked layout never treats a non-empty run with
/// no produced glyphs as a successful layout.
pub(crate) fn shape_checked_text_run(
    font_context: &FontContext<'_>,
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
    shape_options: &ShapeOptions,
    run_index: usize,
    phase: crate::TextPreparationPhase,
) -> Result<Vec<GlyphInfo>, crate::TextLayoutError> {
    if text.is_empty() {
        return Ok(Vec::new());
    }

    let glyphs = if font_context.families.len() > 1 {
        shaping::shape_with_fallback_and_options_checked(
            font_context,
            text,
            font_size_px,
            letter_spacing_px,
            shape_options,
        )
        .ok_or_else(|| crate::TextLayoutError::FontUnavailable {
            run_index,
            families: font_context.families.to_vec(),
            weight: font_context.weight,
            style: font_context.style.clone(),
        })?
        .glyphs
    } else {
        let font_entry = crate::font::line_metrics::resolve_font_entry(
            font_context.registry,
            font_context.fallback_registry,
            font_context.families,
            font_context.weight,
            font_context.style,
        )
        .ok_or_else(|| crate::TextLayoutError::FontUnavailable {
            run_index,
            families: font_context.families.to_vec(),
            weight: font_context.weight,
            style: font_context.style.clone(),
        })?;
        shaping::shape_text_with_options(
            font_context.registry,
            font_entry,
            text,
            font_size_px,
            letter_spacing_px,
            shape_options,
        )
    };

    if glyphs.is_empty() {
        return Err(crate::TextLayoutError::PreparationFailed { phase });
    }
    Ok(glyphs)
}
