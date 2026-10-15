use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use crate::error::{BoundtextError, FontFailureReason};

use super::backend::{FontBackend, FontFace, ShapeVariation, Shaper, ShaperFace};

/// Recognize the generic CSS family names supported by registry fallback.
pub(crate) fn is_css_generic_font_family(alias: &str) -> bool {
    matches!(
        alias.trim().to_ascii_lowercase().as_str(),
        "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy"
    )
}
#[cfg(feature = "harfrust-backend")]
use super::backend_harfrust::HarfRustShaper;
#[cfg(feature = "skrifa-backend")]
use super::backend_skrifa::SkrifaBackend;

/// Font data organized for rasterization: alias→family-name mapping and Arc-wrapped font bytes.
pub type RasterizeFontData = (Vec<(String, String)>, Vec<Arc<Vec<u8>>>);

/// Key for font lookup: (alias, weight, style)
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct FontKey {
    pub alias: String,
    pub weight: u16,
    pub style: FontStyle,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Hash, PartialEq, Eq, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
/// Registered font style used for face lookup and serialized glyph provenance.
pub enum FontStyle {
    #[default]
    Normal,
    Italic,
}

/// Stored font data with parsed metrics
pub struct FontEntry {
    /// Immutable admitted font bytes shared by shaping, outlines, and rasterization.
    pub data: Arc<Vec<u8>>,
    /// Registered family alias, weight, and style used for face lookup.
    pub key: FontKey,
    /// OpenType scale in 16..=16384 font units per em.
    pub units_per_em: u16,
    /// Number of addressable glyphs, including .notdef.
    pub glyph_count: u32,
    /// Selected default-location horizontal ascender in font units, positive upward.
    pub ascender: f64,
    /// Selected default-location horizontal line gap in font units.
    pub line_gap: f64,
    /// Nonzero OS/2 typo ascender, falling back to the selected ascender, in font units.
    pub typographic_ascender: f64,
    /// Nonzero OS/2 typo descender, falling back to the selected descender, in font units.
    pub typographic_descender: f64,
    /// Default OS/2 typo gap when present, otherwise the selected gap, in font units.
    pub typographic_line_gap: f64,
    /// Selected default-location horizontal descender in font units, normally negative.
    pub descender: f64,
    /// Default upward vhea ascender in font units; None means vhea is absent.
    pub vertical_ascender: Option<f64>,
    /// Default downward vhea descender in font units; None means vhea is absent.
    pub vertical_descender: Option<f64>,
    /// Default vhea line gap in font units; None means vhea is absent.
    pub vertical_line_gap: Option<f64>,
    /// Whether the font contains a VORG (Vertical Origin) table
    pub has_vorg: bool,
    /// Default upward VORG origin in font units; None means VORG is absent.
    pub default_vert_origin_y: Option<f64>,
    /// Default post underline position in upward font units; None means post is absent.
    pub underline_position: Option<f64>,
    /// Default post underline thickness in font units; None means post is absent.
    pub underline_thickness: Option<f64>,
    /// Default OS/2 strikeout position in upward font units; None means OS/2 is absent.
    pub strikeout_position: Option<f64>,
    /// Default OS/2 strikeout thickness in font units; None means OS/2 is absent.
    pub strikeout_thickness: Option<f64>,
    /// Cached font family name extracted from the name table at registration time
    pub family_name: Option<String>,
    /// The registry admits this face before insertion and reuses its result.
    shaper_face: OnceLock<Result<Box<dyn ShaperFace>, BoundtextError>>,
    /// Parse-once metric/outline face for the unvaried (no variation axes) case.
    /// Varied faces are immutable instances created separately for each call.
    unvaried_face: OnceLock<Result<Arc<dyn FontFace>, BoundtextError>>,
}

impl FontEntry {
    /// Create a new `FontEntry` using the given backend to parse metrics.
    ///
    /// # Errors
    ///
    /// Returns `BoundtextError` if the backend fails to parse the font data.
    pub fn with_backend(
        data: Vec<u8>,
        alias: String,
        weight: u16,
        style: FontStyle,
        backend: &dyn FontBackend,
    ) -> Result<Self, BoundtextError> {
        let metrics = backend.parse_metrics(&data)?;
        if !(16..=16384).contains(&metrics.units_per_em) {
            return Err(BoundtextError::FontParse {
                reason: FontFailureReason::InvalidUnitsPerEm,
                table: Some("head"),
                face_index: 0,
            });
        }
        if !(1..=65535).contains(&metrics.glyph_count) {
            return Err(BoundtextError::FontParse {
                reason: FontFailureReason::InvalidGlyphCount,
                table: Some("maxp"),
                face_index: 0,
            });
        }
        if [
            metrics.ascender,
            metrics.descender,
            metrics.line_gap,
            metrics.typographic_ascender,
            metrics.typographic_descender,
            metrics.typographic_line_gap,
        ]
        .iter()
        .chain(
            [
                metrics.vertical_ascender,
                metrics.vertical_descender,
                metrics.vertical_line_gap,
                metrics.default_vert_origin_y,
                metrics.underline_position,
                metrics.underline_thickness,
                metrics.strikeout_position,
                metrics.strikeout_thickness,
            ]
            .iter()
            .flatten(),
        )
        .any(|value| !value.is_finite())
        {
            return Err(BoundtextError::FontParse {
                reason: FontFailureReason::NonFiniteMetric,
                table: None,
                face_index: 0,
            });
        }

        Ok(FontEntry {
            data: Arc::new(data),
            key: FontKey {
                alias,
                weight,
                style,
            },
            units_per_em: metrics.units_per_em,
            glyph_count: metrics.glyph_count,
            ascender: metrics.ascender,
            line_gap: metrics.line_gap,
            typographic_ascender: metrics.typographic_ascender,
            typographic_descender: metrics.typographic_descender,
            typographic_line_gap: metrics.typographic_line_gap,
            descender: metrics.descender,
            vertical_ascender: metrics.vertical_ascender,
            vertical_descender: metrics.vertical_descender,
            vertical_line_gap: metrics.vertical_line_gap,
            has_vorg: metrics.has_vorg,
            default_vert_origin_y: metrics.default_vert_origin_y,
            underline_position: metrics.underline_position,
            underline_thickness: metrics.underline_thickness,
            strikeout_position: metrics.strikeout_position,
            strikeout_thickness: metrics.strikeout_thickness,
            family_name: metrics.family_name,
            shaper_face: OnceLock::new(),
            unvaried_face: OnceLock::new(),
        })
    }

    /// Return the parse-once shaping face for this font, creating it on first use.
    ///
    /// # Errors
    ///
    /// Preserve a failed admission or face construction on subsequent calls.
    pub fn shaper_face(&self, shaper: &dyn Shaper) -> Result<&dyn ShaperFace, BoundtextError> {
        self.shaper_face
            .get_or_init(|| shaper.create_face(Arc::clone(&self.data)))
            .as_ref()
            .map(std::convert::AsRef::as_ref)
            .map_err(Clone::clone)
    }

    /// Return a metric/outline face for this font. The unvaried face is parsed
    /// once and shared; a non-empty `variations` slice forces a per-call face
    /// at the requested immutable variation location.
    ///
    /// # Errors
    ///
    /// Preserve parsing and variation failures instead of treating them as absence.
    pub fn font_face(
        &self,
        backend: &dyn FontBackend,
        variations: &[ShapeVariation],
    ) -> Result<Arc<dyn FontFace>, BoundtextError> {
        if variations.is_empty() {
            self.unvaried_face
                .get_or_init(|| {
                    backend
                        .create_face_shared(Arc::clone(&self.data), &[])
                        .map(Arc::from)
                })
                .clone()
        } else {
            backend
                .create_face_shared(Arc::clone(&self.data), variations)
                .map(Arc::from)
        }
    }

    /// Create a new `FontEntry` using Skrifa.
    ///
    /// # Errors
    ///
    /// Returns `BoundtextError` if the font data is invalid or cannot be parsed.
    #[cfg(feature = "skrifa-backend")]
    pub fn new(
        data: Vec<u8>,
        alias: String,
        weight: u16,
        style: FontStyle,
    ) -> Result<Self, BoundtextError> {
        let backend = SkrifaBackend;
        Self::with_backend(data, alias, weight, style, &backend)
    }
}

/// Font registry: stores fonts and resolves by alias + weight + style.
///
/// Holds `Arc<dyn FontBackend>` and `Arc<dyn Shaper>` for backend-agnostic
/// font parsing and text shaping (rustls `CryptoProvider` pattern).
pub struct FontRegistry {
    fonts: HashMap<FontKey, FontEntry>,
    backend: Arc<dyn FontBackend>,
    shaper: Arc<dyn Shaper>,
}

#[cfg(all(feature = "skrifa-backend", feature = "harfrust-backend"))]
impl Default for FontRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl FontRegistry {
    /// Create a new `FontRegistry` with Skrifa and `HarfRust`.
    #[cfg(all(feature = "skrifa-backend", feature = "harfrust-backend"))]
    #[must_use]
    pub fn new() -> Self {
        FontRegistry {
            fonts: HashMap::new(),
            backend: Arc::new(SkrifaBackend),
            shaper: Arc::new(HarfRustShaper),
        }
    }

    /// Create a new `FontRegistry` with custom backends.
    pub fn with_backend(backend: Arc<dyn FontBackend>, shaper: Arc<dyn Shaper>) -> Self {
        FontRegistry {
            fonts: HashMap::new(),
            backend,
            shaper,
        }
    }

    /// Access the font parsing backend.
    #[must_use]
    pub fn backend(&self) -> &dyn FontBackend {
        &*self.backend
    }

    /// Access the text shaping backend.
    #[must_use]
    pub fn shaper(&self) -> &dyn Shaper {
        &*self.shaper
    }

    /// Register a font into the registry.
    ///
    /// # Errors
    ///
    /// Returns `BoundtextError` if the font is already registered or font data parsing fails.
    pub fn register(
        &mut self,
        data: Vec<u8>,
        alias: String,
        weight: u16,
        style: FontStyle,
    ) -> Result<(), BoundtextError> {
        let key = FontKey {
            alias: alias.clone(),
            weight,
            style: style.clone(),
        };
        if self.fonts.contains_key(&key) {
            return Err(BoundtextError::FontAlreadyRegistered {
                alias,
                weight,
                style: format!("{style:?}"),
            });
        }
        let entry = FontEntry::with_backend(data, alias, weight, style, &*self.backend)?;
        entry.shaper_face(&*self.shaper)?;
        self.fonts
            .try_reserve(1)
            .map_err(|_| BoundtextError::FontParse {
                reason: FontFailureReason::AllocationFailed,
                table: None,
                face_index: 0,
            })?;
        self.fonts.insert(key, entry);
        Ok(())
    }

    #[must_use]
    /// Resolve an exact face or the closest registered weight, preferring matching style and lower weight on ties.
    pub fn resolve(&self, alias: &str, weight: u16, style: &FontStyle) -> Option<&FontEntry> {
        let key = FontKey {
            alias: alias.to_string(),
            weight,
            style: style.clone(),
        };
        if let Some(entry) = self.fonts.get(&key) {
            return Some(entry);
        }
        // Closest match within the alias (documented contract: closest weight
        // by simple distance; matching style preferred; weight-distance ties
        // go to the lower weight). Exact-only lookup made any weight or style
        // without a registered face fail outright with TEXT_NO_LAYOUT.
        self.fonts
            .iter()
            .filter(|(candidate, _)| candidate.alias == alias)
            .min_by_key(|(candidate, _)| {
                (
                    u8::from(candidate.style != *style),
                    candidate.weight.abs_diff(weight),
                    candidate.weight,
                )
            })
            .map(|(_, entry)| entry)
    }

    /// Resolve with fallback chain: try each alias in order
    #[must_use]
    pub fn resolve_chain(
        &self,
        aliases: &[String],
        weight: u16,
        style: &FontStyle,
    ) -> Option<&FontEntry> {
        for alias in aliases {
            let normalized_alias = alias.trim();
            if normalized_alias.is_empty() || is_css_generic_font_family(normalized_alias) {
                continue;
            }
            if let Some(entry) = self.resolve(normalized_alias, weight, style) {
                return Some(entry);
            }
        }
        None
    }

    /// Collect alias→family-name mapping and Arc-wrapped font data for rasterization.
    ///
    /// Returns `(alias_map, font_arcs)` where:
    /// - `alias_map`: `(alias, actual_family_name)` pairs for SVG font-family substitution
    /// - `font_arcs`: `Arc<Vec<u8>>` references for zero-copy fontdb loading
    ///
    /// No font data is cloned — only Arc reference counts are incremented.
    #[must_use]
    pub fn rasterize_font_data(&self) -> RasterizeFontData {
        let mut alias_map = Vec::new();
        let mut font_arcs = Vec::new();

        for entry in self.fonts.values() {
            if let Some(ref family_name) = entry.family_name
                && !entry.key.alias.is_empty()
            {
                alias_map.push((entry.key.alias.clone(), family_name.clone()));
            }
            font_arcs.push(Arc::clone(&entry.data));
        }

        (alias_map, font_arcs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_font_data() -> Vec<u8> {
        std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font file not found")
    }

    /// Documented contract: closest weight (simple distance), matching
    /// style preferred, distance ties to the lower weight. Exact-only
    /// lookup previously failed any unregistered (weight, style) with
    /// `TEXT_NO_LAYOUT`.
    #[test]
    fn resolve_closest_weight_and_style_fallback() {
        let mut reg = FontRegistry::new();
        reg.register(test_font_data(), "Noto".into(), 400, FontStyle::Normal)
            .unwrap();
        reg.register(test_font_data(), "Noto".into(), 700, FontStyle::Normal)
            .unwrap();

        // Closest by distance.
        assert_eq!(
            reg.resolve("Noto", 500, &FontStyle::Normal)
                .unwrap()
                .key
                .weight,
            400
        );
        assert_eq!(
            reg.resolve("Noto", 600, &FontStyle::Normal)
                .unwrap()
                .key
                .weight,
            700
        );
        assert_eq!(
            reg.resolve("Noto", 900, &FontStyle::Normal)
                .unwrap()
                .key
                .weight,
            700
        );
        // Equidistant tie goes to the lower weight.
        assert_eq!(
            reg.resolve("Noto", 550, &FontStyle::Normal)
                .unwrap()
                .key
                .weight,
            400
        );
        // Requested italic with only normal registered: style falls back.
        let italic = reg.resolve("Noto", 400, &FontStyle::Italic).unwrap();
        assert_eq!(italic.key.weight, 400);
        // Unknown alias still resolves to nothing.
        assert!(reg.resolve("Missing", 400, &FontStyle::Normal).is_none());
    }

    #[test]
    fn test_register_and_resolve() {
        let mut reg = FontRegistry::new();
        reg.register(
            test_font_data(),
            "NotoSansJP".into(),
            400,
            FontStyle::Normal,
        )
        .unwrap();
        let entry = reg.resolve("NotoSansJP", 400, &FontStyle::Normal);
        assert!(entry.is_some());
        let entry = entry.unwrap();
        assert!(entry.units_per_em > 0);
    }

    #[test]
    fn test_duplicate_registration_error() {
        let mut reg = FontRegistry::new();
        reg.register(
            test_font_data(),
            "NotoSansJP".into(),
            400,
            FontStyle::Normal,
        )
        .unwrap();
        let result = reg.register(
            test_font_data(),
            "NotoSansJP".into(),
            400,
            FontStyle::Normal,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_not_found() {
        let reg = FontRegistry::new();
        assert!(reg.resolve("Missing", 400, &FontStyle::Normal).is_none());
    }

    #[test]
    fn test_resolve_chain() {
        let mut reg = FontRegistry::new();
        reg.register(
            test_font_data(),
            "NotoSansJP".into(),
            400,
            FontStyle::Normal,
        )
        .unwrap();
        let result = reg.resolve_chain(
            &["Missing".into(), "NotoSansJP".into()],
            400,
            &FontStyle::Normal,
        );
        assert!(result.is_some());
    }
}
