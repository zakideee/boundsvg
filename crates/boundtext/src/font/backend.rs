//! Backend-neutral contracts for font metrics, shaping, and outline extraction.

use std::sync::Arc;

use crate::error::{BoundtextError, FontFailureReason};

/// A shaped glyph in font units before layout scaling or vertical adjustment.
#[derive(Debug, Clone)]
pub struct RawShapedGlyph {
    /// An OpenType glyph ID strictly smaller than the face's glyph count.
    pub glyph_id: u32,
    /// Signed horizontal advance at the font's units-per-em scale.
    pub x_advance: i32,
    /// Signed vertical advance at the font's units-per-em scale.
    pub y_advance: i32,
    /// Signed horizontal placement offset in font units.
    pub x_offset: i32,
    /// Signed upward placement offset in font units.
    pub y_offset: i32,
    /// A UTF-8 byte boundary in the original input; RTL order may decrease.
    pub cluster: u32,
}

/// Registration metrics at the default variation location, in finite font units.
#[derive(Debug, Clone)]
pub struct FontMetrics {
    /// The OpenType scale, in 16..=16384 units per em.
    pub units_per_em: u16,
    /// The number of glyphs, including .notdef, in 1..=65535.
    pub glyph_count: u32,
    /// The selected horizontal ascender, positive upward.
    pub ascender: f64,
    /// The selected horizontal line gap, before line-height normalization.
    pub line_gap: f64,
    /// Nonzero OS/2 typo ascender, falling back to the selected ascender.
    pub typographic_ascender: f64,
    /// Nonzero OS/2 typo descender, falling back to the selected descender.
    pub typographic_descender: f64,
    /// OS/2 typo gap when that table exists, otherwise the selected gap.
    pub typographic_line_gap: f64,
    /// The selected horizontal descender, normally negative.
    pub descender: f64,
    /// The upward vhea ascender; None means vhea is absent.
    pub vertical_ascender: Option<f64>,
    /// The downward vhea descender; None means vhea is absent.
    pub vertical_descender: Option<f64>,
    /// The vhea line gap; None means vhea is absent.
    pub vertical_line_gap: Option<f64>,
    /// The first decodable typographic family name, then ordinary family name.
    pub family_name: Option<String>,
    /// Whether a valid VORG table is present.
    pub has_vorg: bool,
    /// The default upward VORG origin; None means VORG is absent.
    pub default_vert_origin_y: Option<f64>,
    /// The post underline position, positive upward; None means post is absent.
    pub underline_position: Option<f64>,
    /// The post underline thickness; None means post is absent.
    pub underline_thickness: Option<f64>,
    /// The OS/2 strikeout position, positive upward; None means OS/2 is absent.
    pub strikeout_position: Option<f64>,
    /// The OS/2 strikeout thickness; None means OS/2 is absent.
    pub strikeout_thickness: Option<f64>,
}

/// Finite control bounds of the emitted outline, including curve control points.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GlyphBBox {
    /// The smallest emitted x coordinate in font units.
    pub x_min: f64,
    /// The smallest emitted upward y coordinate in font units.
    pub y_min: f64,
    /// The largest emitted x coordinate in font units.
    pub x_max: f64,
    /// The largest emitted upward y coordinate in font units.
    pub y_max: f64,
}

/// Select vertical shaping or infer a horizontal run's direction from its text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShapeDirection {
    /// Guess horizontal script and direction, including right-to-left scripts.
    Horizontal,
    /// Shape from top to bottom with vertical OpenType features.
    TopToBottom,
}

/// An OpenType feature applied over the complete input range.
#[derive(Debug, Clone)]
pub struct ShapeFeature {
    /// The four-byte OpenType tag.
    pub tag: [u8; 4],
    /// The full unsigned feature value; zero disables the feature.
    pub value: u32,
}

/// A finite axis value in design coordinates; unknown axes are ignored.
#[derive(Debug, Clone)]
pub struct ShapeVariation {
    /// The four-byte OpenType axis tag.
    pub tag: [u8; 4],
    /// The finite design coordinate, normalized by the font's axis range.
    pub value: f32,
}

/// Receive finite, unhinted outline coordinates in font units.
///
/// An operation returning Err may have emitted a prefix; callers must discard it.
pub trait OutlineBuilder {
    /// Start a contour at an absolute point.
    fn move_to(&mut self, x: f32, y: f32);
    /// Append a straight segment to an absolute point.
    fn line_to(&mut self, x: f32, y: f32);
    /// Append a quadratic segment with one control point.
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32);
    /// Append a cubic segment with two control points.
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32);
    /// Close the current contour.
    fn close(&mut self);
}

/// A face at one immutable variation location, owning its font bytes safely.
pub trait FontFace: Send + Sync {
    /// Return the OpenType scale in units per em.
    fn units_per_em(&self) -> u16;
    /// Return the number of glyphs, including .notdef.
    fn glyph_count(&self) -> u32;
    /// Return the selected varied horizontal ascender in font units.
    fn ascender(&self) -> f64;
    /// Return the selected varied horizontal descender in font units.
    fn descender(&self) -> f64;
    /// Return the varied OS/2 typo ascender; None means OS/2 is absent.
    fn typographic_ascender(&self) -> Option<f64>;
    /// Return the varied OS/2 typo descender; None means OS/2 is absent.
    fn typographic_descender(&self) -> Option<f64>;
    /// Return the varied underline position; None means post is absent.
    fn underline_position(&self) -> Option<f64> {
        None
    }
    /// Return the varied underline thickness; None means post is absent.
    fn underline_thickness(&self) -> Option<f64> {
        None
    }
    /// Return the varied strikeout position; None means OS/2 is absent.
    fn strikeout_position(&self) -> Option<f64> {
        None
    }
    /// Return the varied strikeout thickness; None means OS/2 is absent.
    fn strikeout_thickness(&self) -> Option<f64> {
        None
    }

    /// Query a varied horizontal advance in finite font units.
    ///
    /// # Errors
    ///
    /// Return a structured failure for an invalid glyph or unreadable metric.
    fn glyph_hor_advance(&self, glyph_id: u32) -> Result<Option<f64>, BoundtextError>;

    /// Query an upward varied VORG origin; None means VORG is absent.
    ///
    /// # Errors
    ///
    /// Return a structured failure for an invalid glyph or unreadable metric.
    fn glyph_y_origin(&self, glyph_id: u32) -> Result<Option<f64>, BoundtextError>;

    /// Query a varied vmtx top side bearing; None means vmtx is absent.
    ///
    /// # Errors
    ///
    /// Return a structured failure for an invalid glyph or unreadable metric.
    fn glyph_ver_side_bearing(&self, glyph_id: u32) -> Result<Option<f64>, BoundtextError>;

    /// Draw into the callback and return its control bounds, or None for an empty glyph.
    ///
    /// # Errors
    ///
    /// Return a structured failure for an invalid glyph, failed drawing, or nonfinite coordinates.
    fn outline_glyph(
        &self,
        glyph_id: u32,
        builder: &mut dyn OutlineBuilder,
    ) -> Result<Option<GlyphBBox>, BoundtextError>;

    /// Compute control bounds through the same unhinted path as outline drawing.
    ///
    /// # Errors
    ///
    /// Return the drawing failure instead of confusing it with an empty glyph.
    fn glyph_bounding_box(&self, glyph_id: u32) -> Result<Option<GlyphBBox>, BoundtextError> {
        self.outline_glyph(glyph_id, &mut EmptyOutlineBuilder)
    }
}

struct EmptyOutlineBuilder;
impl OutlineBuilder for EmptyOutlineBuilder {
    fn move_to(&mut self, _: f32, _: f32) {}
    fn line_to(&mut self, _: f32, _: f32) {}
    fn quad_to(&mut self, _: f32, _: f32, _: f32, _: f32) {}
    fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, _: f32, _: f32) {}
    fn close(&mut self) {}
}

/// Parse registration metrics and construct immutable metric/outline faces.
pub trait FontBackend: Send + Sync {
    /// Read default-location metrics without changing registration state.
    ///
    /// # Errors
    ///
    /// Return a structured failure for invalid font data or required tables.
    fn parse_metrics(&self, data: &[u8]) -> Result<FontMetrics, BoundtextError>;

    /// Create an owning face at the supplied finite variation coordinates.
    ///
    /// # Errors
    ///
    /// Return a structured failure for invalid data, coordinates, or face construction.
    fn create_face(
        &self,
        data: &[u8],
        variations: &[ShapeVariation],
    ) -> Result<Box<dyn FontFace>, BoundtextError>;

    /// Create a face sharing the caller's immutable font bytes.
    ///
    /// # Errors
    ///
    /// Return the same failures as `create_face`, preserving allocation failure.
    fn create_face_shared(
        &self,
        data: Arc<Vec<u8>>,
        variations: &[ShapeVariation],
    ) -> Result<Box<dyn FontFace>, BoundtextError> {
        self.create_face(&data, variations)
    }
}

/// A reusable owning font whose shaping buffers and instances are local to each call.
pub trait ShaperFace: Send + Sync {
    /// Shape the complete input at its original UTF-8 byte clusters.
    ///
    /// # Errors
    ///
    /// Return a structured failure for shaping, buffer limits, allocation, or invalid output.
    /// Never return partial glyphs as successful output.
    fn shape(
        &self,
        text: &str,
        direction: ShapeDirection,
        language: Option<&str>,
        features: &[ShapeFeature],
        variations: &[ShapeVariation],
    ) -> Result<Vec<RawShapedGlyph>, BoundtextError>;
}

/// Construct reusable shaping faces independently of the outline backend.
pub trait Shaper: Send + Sync {
    /// Admit and parse bytes into a reusable owning shaping face.
    ///
    /// # Errors
    ///
    /// Return a structured failure if font admission or face construction fails.
    fn create_face(&self, data: Arc<Vec<u8>>) -> Result<Box<dyn ShaperFace>, BoundtextError>;
}

/// Reject nonfinite variation inputs before either backend uses them.
///
/// # Errors
///
/// Returns a shaping failure when any variation value is NaN or infinite.
pub(crate) fn validate_variations(variations: &[ShapeVariation]) -> Result<(), BoundtextError> {
    if variations
        .iter()
        .any(|variation| !variation.value.is_finite())
    {
        return Err(BoundtextError::TextShaping {
            reason: FontFailureReason::NonFiniteVariation,
        });
    }
    Ok(())
}

/// Validate glyph IDs and UTF-8 cluster boundaries in the complete shaped output.
///
/// # Errors
///
/// Returns the first out-of-range glyph ID or invalid UTF-8 cluster, with its glyph index.
pub(crate) fn validate_shaped_glyphs(
    text: &str,
    glyph_count: u32,
    glyphs: &[RawShapedGlyph],
) -> Result<(), BoundtextError> {
    for (glyph_index, glyph) in glyphs.iter().enumerate() {
        let reason = if glyph.glyph_id >= glyph_count {
            Some(FontFailureReason::InvalidGlyphId)
        } else if usize::try_from(glyph.cluster)
            .ok()
            .is_none_or(|cluster| cluster >= text.len() || !text.is_char_boundary(cluster))
        {
            Some(FontFailureReason::InvalidCluster)
        } else {
            None
        };
        if let Some(reason) = reason {
            return Err(BoundtextError::InvalidShapedOutput {
                reason,
                glyph_index,
            });
        }
    }
    Ok(())
}
