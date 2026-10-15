//! Shape complete UTF-8 runs with an owning `HarfRust` font and per-call state.

use std::{str::FromStr, sync::Arc};

use super::admission::{parse_error, validate_font_collection};
use super::backend::{
    FontAdmission, RawShapedGlyph, ShapeDirection, ShapeFeature, ShapeVariation, Shaper,
    ShaperFace, validate_shaped_glyphs, validate_variations,
};
use crate::error::{BoundtextError, FontFailureReason};

/// Construct reusable shaping faces using the released `HarfRust` implementation.
pub struct HarfRustShaper;

impl Shaper for HarfRustShaper {
    fn create_face(&self, data: Arc<Vec<u8>>) -> Result<Box<dyn ShaperFace>, BoundtextError> {
        validate_font_collection(&data)?;
        create_owning_face(data)
    }

    fn create_face_with_admission(
        &self,
        data: Arc<Vec<u8>>,
        admission: Option<&FontAdmission>,
    ) -> Result<Box<dyn ShaperFace>, BoundtextError> {
        if admission.is_some_and(|proof| proof.matches_data(&data)) {
            create_owning_face(data)
        } else {
            self.create_face(data)
        }
    }
}

fn create_owning_face(data: Arc<Vec<u8>>) -> Result<Box<dyn ShaperFace>, BoundtextError> {
    let shared: Arc<dyn AsRef<[u8]> + Send + Sync> = data;
    let font = harfrust::Font::new(harfrust::font::Blob::Shared(shared), 0)
        .ok_or_else(|| parse_error(FontFailureReason::InvalidData, None, 0))?;
    Ok(Box::new(HarfRustFace { font }))
}

struct HarfRustFace {
    font: harfrust::Font,
}

fn allocation_error() -> BoundtextError {
    BoundtextError::TextShaping {
        reason: FontFailureReason::AllocationFailed,
    }
}

impl ShaperFace for HarfRustFace {
    fn shape(
        &self,
        text: &str,
        direction: ShapeDirection,
        language: Option<&str>,
        features: &[ShapeFeature],
        variations: &[ShapeVariation],
    ) -> Result<Vec<RawShapedGlyph>, BoundtextError> {
        u32::try_from(text.len()).map_err(|_| BoundtextError::TextShaping {
            reason: FontFailureReason::InputTooLong,
        })?;
        validate_variations(variations)?;
        if text.is_empty() {
            return Ok(Vec::new());
        }
        let mut axis_settings = Vec::new();
        axis_settings
            .try_reserve_exact(variations.len())
            .map_err(|_| allocation_error())?;
        axis_settings.extend(variations.iter().map(|variation| {
            harfrust::font::Variation::new(harfrust::Tag::new(&variation.tag), variation.value)
        }));
        let instance = self
            .font
            .instance_builder()
            .variations(&axis_settings)
            .build();
        let shaper = harfrust::ShaperFont::new(&instance);
        let mut buffer = harfrust::Buffer::new();
        if !buffer.reserve(text.chars().count()) {
            return Err(BoundtextError::TextShaping {
                reason: FontFailureReason::BufferPreparationFailed,
            });
        }
        buffer.push_str(text);
        if !buffer.allocation_successful() || buffer.len() != text.chars().count() {
            return Err(BoundtextError::TextShaping {
                reason: FontFailureReason::BufferPreparationFailed,
            });
        }
        buffer.guess_segment_properties();
        if direction == ShapeDirection::TopToBottom {
            buffer.set_direction(harfrust::Direction::TopToBottom);
        }
        // Invalid language tags preserve the guessed/default language behavior.
        buffer.set_language(language.and_then(|tag| harfrust::Language::from_str(tag).ok()));
        let mut feature_settings = Vec::new();
        feature_settings
            .try_reserve_exact(features.len())
            .map_err(|_| allocation_error())?;
        feature_settings.extend(features.iter().map(|feature| {
            harfrust::Feature::new(harfrust::Tag::new(&feature.tag), feature.value, ..)
        }));
        harfrust::shape(
            &shaper,
            &mut buffer,
            harfrust::ShapeOptions::default().features(&feature_settings),
        )
        .map_err(|failure| {
            let reason = match failure {
                harfrust::ShapeError::AlreadyShaped => FontFailureReason::AlreadyShaped,
                harfrust::ShapeError::DirectionUnset => FontFailureReason::DirectionUnset,
                harfrust::ShapeError::DirectionMismatch { .. }
                | harfrust::ShapeError::ScriptMismatch { .. } => FontFailureReason::PlanMismatch,
                _ => FontFailureReason::ShapingFailed,
            };
            BoundtextError::TextShaping { reason }
        })?;
        if !buffer.allocation_successful() {
            return Err(BoundtextError::TextShapingLimitExceeded);
        }
        let infos = buffer.glyph_infos();
        let positions = buffer.glyph_positions();
        if infos.len() != positions.len() {
            return Err(BoundtextError::InvalidShapedOutput {
                reason: FontFailureReason::ParallelArrayLengthMismatch,
                glyph_index: 0,
            });
        }
        let mut glyphs = Vec::new();
        glyphs
            .try_reserve_exact(infos.len())
            .map_err(|_| allocation_error())?;
        glyphs.extend(
            infos
                .iter()
                .zip(positions)
                .map(|(glyph, position)| RawShapedGlyph {
                    glyph_id: glyph.glyph_id,
                    x_advance: position.x_advance,
                    y_advance: position.y_advance,
                    x_offset: position.x_offset,
                    y_offset: position.y_offset,
                    cluster: glyph.cluster,
                }),
        );
        validate_shaped_glyphs(text, self.font.num_glyphs(), &glyphs)?;
        Ok(glyphs)
    }
}
