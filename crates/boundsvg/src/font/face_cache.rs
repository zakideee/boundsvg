//! Reuse one immutable face for consecutive glyphs within an outline operation.

use std::sync::Arc;

use boundtext::BoundtextError;
use boundtext::error::FontFailureReason;
use boundtext::font::backend::{FontBackend, FontFace, ShapeVariation};

use super::FontEntry;

/// Retain at most the last face; a new extraction operation starts with an empty cache.
pub(crate) struct OutlineFaceCache<'font> {
    backend: &'font dyn FontBackend,
    entry: Option<&'font FontEntry>,
    variations: Vec<ShapeVariation>,
    face: Option<Arc<dyn FontFace>>,
}

impl<'font> OutlineFaceCache<'font> {
    /// Start an empty operation cache bound to one font backend.
    #[must_use]
    pub(crate) fn new(backend: &'font dyn FontBackend) -> Self {
        Self {
            backend,
            entry: None,
            variations: Vec::new(),
            face: None,
        }
    }

    /// Resolve the exact registered entry and authored variation coordinates.
    ///
    /// # Errors
    ///
    /// Preserve face construction failures and leave the previous entry intact on failure.
    pub(crate) fn resolve(
        &mut self,
        entry: &'font FontEntry,
        variations: &[ShapeVariation],
    ) -> Result<Arc<dyn FontFace>, BoundtextError> {
        let same_entry = self
            .entry
            .is_some_and(|previous| std::ptr::eq(previous, entry));
        let same_location = self.variations.len() == variations.len()
            && self
                .variations
                .iter()
                .zip(variations)
                .all(|(previous, current)| {
                    previous.tag == current.tag
                        && previous.value.to_bits() == current.value.to_bits()
                });
        if same_entry
            && same_location
            && let Some(face) = &self.face
        {
            return Ok(Arc::clone(face));
        }
        let mut location = Vec::new();
        location
            .try_reserve_exact(variations.len())
            .map_err(|_| BoundtextError::FontParse {
                reason: FontFailureReason::AllocationFailed,
                table: None,
                face_index: 0,
            })?;
        location.extend_from_slice(variations);
        let face = entry.font_face(self.backend, variations)?;
        self.entry = Some(entry);
        self.variations = location;
        self.face = Some(Arc::clone(&face));
        Ok(face)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::{FontRegistry, FontStyle};

    fn variable_registry() -> FontRegistry {
        let mut registry = FontRegistry::new();
        let bytes = include_bytes!("../../../../fixtures/fonts/Inter-Variable.ttf");
        for alias in ["First", "Second"] {
            registry
                .register(bytes.to_vec(), alias.into(), 400, FontStyle::Normal)
                .unwrap();
        }
        registry
    }

    #[test]
    fn reuse_requires_the_same_entry_and_location_within_one_operation() {
        let registry = variable_registry();
        let first = registry.resolve("First", 400, &FontStyle::Normal).unwrap();
        let second = registry.resolve("Second", 400, &FontStyle::Normal).unwrap();
        let regular = [ShapeVariation {
            tag: *b"wght",
            value: 400.0,
        }];
        let bold = [ShapeVariation {
            tag: *b"wght",
            value: 900.0,
        }];
        let mut cache = OutlineFaceCache::new(registry.backend());
        let initial = cache.resolve(first, &regular).unwrap();
        let repeated = cache.resolve(first, &regular).unwrap();
        assert!(Arc::ptr_eq(&initial, &repeated));
        let varied = cache.resolve(first, &bold).unwrap();
        assert!(!Arc::ptr_eq(&initial, &varied));
        let other_entry = cache.resolve(second, &bold).unwrap();
        assert!(!Arc::ptr_eq(&varied, &other_entry));
        let mut separate_operation = OutlineFaceCache::new(registry.backend());
        let separate = separate_operation.resolve(second, &bold).unwrap();
        assert!(!Arc::ptr_eq(&other_entry, &separate));
    }

    #[test]
    fn a_failed_location_cannot_replace_or_hide_the_last_successful_face() {
        let registry = variable_registry();
        let entry = registry.resolve("First", 400, &FontStyle::Normal).unwrap();
        let regular = [ShapeVariation {
            tag: *b"wght",
            value: 400.0,
        }];
        let mut cache = OutlineFaceCache::new(registry.backend());
        let initial = cache.resolve(entry, &regular).unwrap();
        assert!(matches!(
            cache.resolve(
                entry,
                &[ShapeVariation {
                    tag: *b"wght",
                    value: f32::NAN,
                }]
            ),
            Err(BoundtextError::TextShaping {
                reason: FontFailureReason::NonFiniteVariation
            })
        ));
        let recovered = cache.resolve(entry, &regular).unwrap();
        assert!(Arc::ptr_eq(&initial, &recovered));
    }
}
