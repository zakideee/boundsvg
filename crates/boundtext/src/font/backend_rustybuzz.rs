//! Default `Shaper` implementation using `rustybuzz`.

use std::str::FromStr;
use std::sync::Arc;

use rustybuzz::{Direction, Face as BuzzFace, Feature, Language, UnicodeBuffer, Variation};
use self_cell::self_cell;

use super::backend::{
    RawShapedGlyph, ShapeDirection, ShapeFeature, ShapeVariation, Shaper, ShaperFace,
};

/// `Shaper` implementation backed by the `rustybuzz` crate.
pub struct RustybuzzShaper;

impl Shaper for RustybuzzShaper {
    fn create_face(&self, data: Arc<Vec<u8>>) -> Option<Box<dyn ShaperFace>> {
        let cell =
            BuzzFaceCell::try_new(data, |bytes| BuzzFace::from_slice(bytes, 0).ok_or(())).ok()?;
        Some(Box::new(RustybuzzShaperFace { cell }))
    }
}

type BuzzFaceDependent<'a> = BuzzFace<'a>;

self_cell!(
    /// Owns the font bytes together with the `rustybuzz::Face` parsed from them.
    /// `BuzzFace` borrows the byte slice, so the pair must live in one cell.
    struct BuzzFaceCell {
        owner: Arc<Vec<u8>>,
        #[covariant]
        dependent: BuzzFaceDependent,
    }
);

/// `ShaperFace` implementation holding a parse-once `rustybuzz::Face`.
struct RustybuzzShaperFace {
    cell: BuzzFaceCell,
}

impl ShaperFace for RustybuzzShaperFace {
    fn shape(
        &self,
        text: &str,
        direction: ShapeDirection,
        language: Option<&str>,
        features: &[ShapeFeature],
        variations: &[ShapeVariation],
    ) -> Vec<RawShapedGlyph> {
        self.cell.with_dependent(|_, face| {
            if variations.is_empty() {
                shape_with_face(face, text, direction, language, features)
            } else {
                // set_variations mutates the face, so apply axes to a per-call clone.
                // The face borrows the font bytes; cloning copies table references only.
                let buzz_variations: Vec<Variation> = variations
                    .iter()
                    .map(|v| Variation {
                        tag: ttf_parser::Tag::from_bytes(&v.tag),
                        value: v.value,
                    })
                    .collect();
                let mut varied_face = face.clone();
                varied_face.set_variations(&buzz_variations);
                shape_with_face(&varied_face, text, direction, language, features)
            }
        })
    }
}

fn shape_with_face(
    face: &BuzzFace<'_>,
    text: &str,
    direction: ShapeDirection,
    language: Option<&str>,
    features: &[ShapeFeature],
) -> Vec<RawShapedGlyph> {
    let mut buffer = UnicodeBuffer::new();
    buffer.push_str(text);
    buffer.guess_segment_properties();

    if direction == ShapeDirection::TopToBottom {
        buffer.set_direction(Direction::TopToBottom);
    }

    if let Some(lang_str) = language {
        if let Ok(lang) = Language::from_str(lang_str) {
            buffer.set_language(lang);
        }
    }

    let buzz_features: Vec<Feature> = features
        .iter()
        .map(|f| Feature::new(ttf_parser::Tag::from_bytes(&f.tag), f.value, ..))
        .collect();

    let output = rustybuzz::shape(face, &buzz_features, buffer);
    let positions = output.glyph_positions();
    let infos = output.glyph_infos();

    infos
        .iter()
        .zip(positions.iter())
        .map(|(info, pos)| RawShapedGlyph {
            glyph_id: info.glyph_id,
            x_advance: pos.x_advance,
            y_advance: pos.y_advance,
            x_offset: pos.x_offset,
            y_offset: pos.y_offset,
            cluster: info.cluster,
        })
        .collect()
}
