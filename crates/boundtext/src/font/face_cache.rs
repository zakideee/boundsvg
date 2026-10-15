//! Reuse one immutable face for consecutive glyphs within a metric or outline operation.

use std::sync::Arc;

use super::backend::{FontBackend, FontFace, ShapeVariation};
use crate::BoundtextError;
use crate::error::FontFailureReason;

use super::FontEntry;

/// Retain at most the last face; a new metric or outline operation starts with an empty cache.
pub struct FontFaceCache<'font> {
    /// The last successful backend; None before the first resolved face.
    backend: Option<&'font dyn FontBackend>,
    /// The last successfully resolved registered entry; None before the first success.
    entry: Option<&'font FontEntry>,
    /// Design coordinates for the cached face, compared by exact tags and f32 bits.
    variations: Vec<ShapeVariation>,
    /// The last successful face; failed resolution retains the preceding cached state.
    face: Option<Arc<dyn FontFace>>,
}

impl Default for FontFaceCache<'_> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'font> FontFaceCache<'font> {
    /// Start an empty operation cache without retaining any font or backend.
    #[must_use]
    pub fn new() -> Self {
        Self {
            backend: None,
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
    pub fn resolve(
        &mut self,
        backend: &'font dyn FontBackend,
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
        let same_backend = self
            .backend
            .is_some_and(|previous| std::ptr::eq(previous, backend));
        if same_backend
            && same_entry
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
        let face = entry.font_face(backend, variations)?;
        self.backend = Some(backend);
        self.entry = Some(entry);
        self.variations = location;
        self.face = Some(Arc::clone(&face));
        Ok(face)
    }
}

#[cfg(all(test, feature = "skrifa-backend", feature = "harfrust-backend"))]
mod tests {
    use super::*;
    use crate::font::{FontRegistry, FontStyle};

    fn variable_registry() -> Result<FontRegistry, BoundtextError> {
        let mut registry = FontRegistry::new();
        let bytes = include_bytes!("../../../../fixtures/fonts/Inter-Variable.ttf");
        for alias in ["First", "Second"] {
            registry.register(bytes.to_vec(), alias.into(), 400, FontStyle::Normal)?;
        }
        Ok(registry)
    }

    #[test]
    fn reuse_requires_the_same_entry_and_location_within_one_operation() {
        let registry = variable_registry().unwrap();
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
        let mut cache = FontFaceCache::new();
        let initial = cache.resolve(registry.backend(), first, &regular).unwrap();
        let repeated = cache.resolve(registry.backend(), first, &regular).unwrap();
        assert!(Arc::ptr_eq(&initial, &repeated));
        let varied = cache.resolve(registry.backend(), first, &bold).unwrap();
        assert!(!Arc::ptr_eq(&initial, &varied));
        let other_entry = cache.resolve(registry.backend(), second, &bold).unwrap();
        assert!(!Arc::ptr_eq(&varied, &other_entry));
        let mut separate_operation = FontFaceCache::new();
        let separate = separate_operation
            .resolve(registry.backend(), second, &bold)
            .unwrap();
        assert!(!Arc::ptr_eq(&other_entry, &separate));
    }

    #[test]
    fn a_failed_location_cannot_replace_or_hide_the_last_successful_face() {
        let registry = variable_registry().unwrap();
        let entry = registry.resolve("First", 400, &FontStyle::Normal).unwrap();
        let regular = [ShapeVariation {
            tag: *b"wght",
            value: 400.0,
        }];
        let mut cache = FontFaceCache::new();
        let initial = cache.resolve(registry.backend(), entry, &regular).unwrap();
        assert!(matches!(
            cache.resolve(
                registry.backend(),
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
        let recovered = cache.resolve(registry.backend(), entry, &regular).unwrap();
        assert!(Arc::ptr_eq(&initial, &recovered));
    }
    struct CountingBackend {
        calls: std::sync::atomic::AtomicUsize,
    }

    impl FontBackend for CountingBackend {
        fn parse_metrics(
            &self,
            data: &[u8],
        ) -> Result<super::super::backend::FontMetrics, BoundtextError> {
            super::super::backend_skrifa::SkrifaBackend.parse_metrics(data)
        }

        fn create_face(
            &self,
            data: &[u8],
            variations: &[ShapeVariation],
        ) -> Result<Box<dyn FontFace>, BoundtextError> {
            self.calls
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            super::super::backend_skrifa::SkrifaBackend.create_face(data, variations)
        }
    }

    #[test]
    fn changing_backend_cannot_reuse_a_previous_backends_face() {
        let registry = variable_registry().unwrap();
        let entry = registry.resolve("First", 400, &FontStyle::Normal).unwrap();
        let first_backend = CountingBackend {
            calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let second_backend = CountingBackend {
            calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let variations = [ShapeVariation {
            tag: *b"wght",
            value: 400.0,
        }];
        let mut cache = FontFaceCache::new();
        let first_face = cache.resolve(&first_backend, entry, &variations).unwrap();
        let repeated = cache.resolve(&first_backend, entry, &variations).unwrap();
        assert!(Arc::ptr_eq(&first_face, &repeated));
        let second_face = cache.resolve(&second_backend, entry, &variations).unwrap();
        assert!(!Arc::ptr_eq(&first_face, &second_face));
        assert_eq!(
            first_backend
                .calls
                .load(std::sync::atomic::Ordering::Relaxed),
            1
        );
        assert_eq!(
            second_backend
                .calls
                .load(std::sync::atomic::Ordering::Relaxed),
            1
        );
        let restored = cache.resolve(&first_backend, entry, &variations).unwrap();
        assert!(!Arc::ptr_eq(&first_face, &restored));
        assert_eq!(
            first_backend
                .calls
                .load(std::sync::atomic::Ordering::Relaxed),
            2
        );
    }
}
