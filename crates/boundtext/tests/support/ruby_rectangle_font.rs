//! Supply unhinted rectangular glyphs with fixed analytical metrics through the public backend seam.

#![cfg(test)]

use std::sync::Arc;

use boundtext::BoundtextError;
use boundtext::font::backend::{
    FontBackend, FontFace, FontMetrics, GlyphBBox, OutlineBuilder, RawShapedGlyph, ShapeDirection,
    ShapeFeature, ShapeVariation, Shaper, ShaperFace,
};
use boundtext::font::{FontRegistry, FontStyle};

struct RectangleFont;

fn bounds(glyph: u32) -> Option<GlyphBBox> {
    let (bottom, top) = match glyph {
        0 => return None,
        1 => (0.0, 899.0),
        2..=4 => (0.0, 100.0),
        6 => (969.0, 970.0),
        // A tall lender loses outward separation at size = 1 / (0.905 - 0.899).
        8 => (0.0, 905.0),
        _ => (0.0, 700.0),
    };
    Some(GlyphBBox {
        x_min: 0.0,
        x_max: 1000.0,
        y_min: bottom,
        y_max: top,
    })
}

impl FontBackend for RectangleFont {
    fn parse_metrics(&self, _: &[u8]) -> Result<FontMetrics, BoundtextError> {
        Ok(FontMetrics {
            units_per_em: 1000,
            glyph_count: 9,
            ascender: 800.0,
            descender: -200.0,
            line_gap: 0.0,
            typographic_ascender: 800.0,
            typographic_descender: -200.0,
            typographic_line_gap: 0.0,
            vertical_ascender: None,
            vertical_descender: None,
            vertical_line_gap: None,
            family_name: Some("Ruby Rectangles".to_string()),
            has_vorg: false,
            default_vert_origin_y: None,
            underline_position: None,
            underline_thickness: None,
            strikeout_position: None,
            strikeout_thickness: None,
        })
    }

    fn create_face(
        &self,
        _: &[u8],
        _: &[ShapeVariation],
    ) -> Result<Box<dyn FontFace>, BoundtextError> {
        Ok(Box::new(Self))
    }
}

impl FontFace for RectangleFont {
    fn units_per_em(&self) -> u16 {
        1000
    }
    fn glyph_count(&self) -> u32 {
        9
    }
    fn ascender(&self) -> f64 {
        800.0
    }
    fn descender(&self) -> f64 {
        -200.0
    }
    fn typographic_ascender(&self) -> Option<f64> {
        Some(800.0)
    }
    fn typographic_descender(&self) -> Option<f64> {
        Some(-200.0)
    }
    fn glyph_hor_advance(&self, _: u32) -> Result<Option<f64>, BoundtextError> {
        Ok(Some(1000.0))
    }
    fn glyph_y_origin(&self, _: u32) -> Result<Option<f64>, BoundtextError> {
        Ok(None)
    }
    fn glyph_ver_side_bearing(&self, _: u32) -> Result<Option<f64>, BoundtextError> {
        Ok(None)
    }

    fn outline_glyph(
        &self,
        glyph: u32,
        builder: &mut dyn OutlineBuilder,
    ) -> Result<Option<GlyphBBox>, BoundtextError> {
        let Some(bounds) = bounds(glyph) else {
            return Ok(None);
        };
        #[expect(
            clippy::cast_possible_truncation,
            reason = "fixture coordinates are exact small integer font units"
        )]
        let (left, right, bottom, top) = (
            bounds.x_min as f32,
            bounds.x_max as f32,
            bounds.y_min as f32,
            bounds.y_max as f32,
        );
        builder.move_to(left, bottom);
        builder.line_to(right, bottom);
        builder.line_to(right, top);
        builder.line_to(left, top);
        builder.close();
        Ok(Some(bounds))
    }
}

impl Shaper for RectangleFont {
    fn create_face(&self, _: Arc<Vec<u8>>) -> Result<Box<dyn ShaperFace>, BoundtextError> {
        Ok(Box::new(Self))
    }
}

impl ShaperFace for RectangleFont {
    fn shape(
        &self,
        text: &str,
        direction: ShapeDirection,
        _: Option<&str>,
        _: &[ShapeFeature],
        _: &[ShapeVariation],
    ) -> Result<Vec<RawShapedGlyph>, BoundtextError> {
        Ok(text
            .char_indices()
            .map(|(offset, character)| {
                let glyph_id = match character {
                    '行' => 1,
                    'お' => 2,
                    'こ' => 3,
                    'な' => 4,
                    'う' => 5,
                    'ァ' => 6,
                    '漢' => 7,
                    'ぃ' => 8,
                    _ => 0,
                };
                let (x_advance, y_advance) = if direction == ShapeDirection::TopToBottom {
                    (0, -1000)
                } else {
                    (1000, 0)
                };
                RawShapedGlyph {
                    glyph_id,
                    x_advance,
                    y_advance,
                    x_offset: 0,
                    y_offset: 0,
                    cluster: u32::try_from(offset).expect("fixture text fits a source index"),
                }
            })
            .collect())
    }
}

/// Register the analytical font without relying on platform lookup or external font bytes.
///
/// # Errors
///
/// Return registry errors if the fixture's fixed backend metrics violate admission invariants.
pub(super) fn registry() -> Result<FontRegistry, BoundtextError> {
    let mut registry = FontRegistry::with_backend(Arc::new(RectangleFont), Arc::new(RectangleFont));
    registry.register(
        b"ruby-rectangles".to_vec(),
        "Noto".to_string(),
        400,
        FontStyle::Normal,
    )?;
    Ok(registry)
}
