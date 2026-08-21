//! Backend-neutral trait definitions for font parsing, shaping, and outline extraction.
//!
//! These traits abstract the concrete dependencies (ttf-parser, rustybuzz) so that
//! alternative backends can be substituted via `FontRegistry::with_backend()`.

use std::sync::Arc;

use crate::error::BoundtextError;

// ---------------------------------------------------------------------------
// Backend-neutral types
// ---------------------------------------------------------------------------

/// Raw shaped glyph in font units, before scaling or vertical adjustment.
#[derive(Debug, Clone)]
pub struct RawShapedGlyph {
    pub glyph_id: u32,
    pub x_advance: i32,
    pub y_advance: i32,
    pub x_offset: i32,
    pub y_offset: i32,
    pub cluster: u32,
}

/// Font metrics extracted at registration time.
#[derive(Debug, Clone)]
pub struct FontMetrics {
    pub units_per_em: u16,
    pub ascender: i16,
    pub line_gap: i16,
    pub typographic_ascender: i16,
    pub typographic_descender: i16,
    pub typographic_line_gap: i16,
    pub descender: i16,
    pub vertical_ascender: Option<i16>,
    pub vertical_descender: Option<i16>,
    pub vertical_line_gap: Option<i16>,
    pub family_name: Option<String>,
    pub has_vorg: bool,
    pub default_vert_origin_y: Option<i16>,
    pub underline_position: Option<i16>,
    pub underline_thickness: Option<i16>,
    pub strikeout_position: Option<i16>,
    pub strikeout_thickness: Option<i16>,
}

/// Glyph bounding box in font units.
#[derive(Debug, Clone, Copy)]
pub struct GlyphBBox {
    pub x_min: i16,
    pub y_min: i16,
    pub x_max: i16,
    pub y_max: i16,
}

/// Shaping direction hint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShapeDirection {
    LeftToRight,
    TopToBottom,
}

/// An OpenType feature tag + value (e.g. `b"liga"`, `1`).
#[derive(Debug, Clone)]
pub struct ShapeFeature {
    pub tag: [u8; 4],
    pub value: u32,
}

/// A font variation axis tag + value (e.g. `b"wght"`, `700.0`).
#[derive(Debug, Clone)]
pub struct ShapeVariation {
    pub tag: [u8; 4],
    pub value: f32,
}

// ---------------------------------------------------------------------------
// Outline builder (replaces ttf_parser::OutlineBuilder)
// ---------------------------------------------------------------------------

/// Callback trait for receiving glyph outline commands.
pub trait OutlineBuilder {
    fn move_to(&mut self, x: f32, y: f32);
    fn line_to(&mut self, x: f32, y: f32);
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32);
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32);
    fn close(&mut self);
}

// ---------------------------------------------------------------------------
// FontFace — per-glyph metric queries on a parsed font
// ---------------------------------------------------------------------------

/// A parsed font face for per-glyph metric queries and outline extraction.
///
/// Implementations own whatever internal state they need (e.g. parsed tables,
/// Arc-wrapped font bytes). No lifetime parameters are exposed to callers.
pub trait FontFace: Send + Sync {
    fn units_per_em(&self) -> u16;
    fn ascender(&self) -> i16;
    fn descender(&self) -> i16;
    fn typographic_ascender(&self) -> Option<i16>;
    fn typographic_descender(&self) -> Option<i16>;

    fn underline_position(&self) -> Option<i16> {
        None
    }

    fn underline_thickness(&self) -> Option<i16> {
        None
    }

    fn strikeout_position(&self) -> Option<i16> {
        None
    }

    fn strikeout_thickness(&self) -> Option<i16> {
        None
    }

    /// Horizontal advance width for a glyph.
    fn glyph_hor_advance(&self, glyph_id: u16) -> Option<u16>;

    /// Vertical origin Y for a glyph (from VORG table or vmtx).
    fn glyph_y_origin(&self, glyph_id: u16) -> Option<i16>;

    /// Vertical side bearing for a glyph.
    fn glyph_ver_side_bearing(&self, glyph_id: u16) -> Option<i16>;

    /// Glyph bounding box.
    fn glyph_bounding_box(&self, glyph_id: u16) -> Option<GlyphBBox>;

    /// Extract the glyph outline, calling the builder callbacks.
    /// Returns `true` if the glyph has an outline.
    fn outline_glyph(&self, glyph_id: u16, builder: &mut dyn OutlineBuilder) -> bool;
}

// ---------------------------------------------------------------------------
// FontBackend — font parsing and metric extraction
// ---------------------------------------------------------------------------

/// Abstracts font data parsing (e.g. ttf-parser, fontations/skrifa).
pub trait FontBackend: Send + Sync {
    /// Parse raw font bytes and extract registration-time metrics.
    ///
    /// # Errors
    ///
    /// Returns `BoundtextError` if the font data is invalid or cannot be parsed.
    fn parse_metrics(&self, data: &[u8]) -> Result<FontMetrics, BoundtextError>;

    /// Create a `FontFace` for per-glyph queries.
    /// The implementation may store a clone/Arc of the data internally.
    /// `variations` contains font variation axis values (e.g. wght=700) to apply;
    /// unknown axes are silently ignored.
    ///
    /// # Errors
    ///
    /// Returns `BoundtextError` if the font data is invalid or face creation fails.
    fn create_face(
        &self,
        data: &[u8],
        variations: &[ShapeVariation],
    ) -> Result<Box<dyn FontFace>, BoundtextError>;

    /// Zero-copy variant of [`create_face`](Self::create_face) used by `FontEntry`'s
    /// face cache. The default implementation copies the bytes; backends that can
    /// hold the `Arc` directly should override it.
    ///
    /// # Errors
    ///
    /// Returns `BoundtextError` if the font data is invalid or face creation fails.
    fn create_face_shared(
        &self,
        data: Arc<Vec<u8>>,
        variations: &[ShapeVariation],
    ) -> Result<Box<dyn FontFace>, BoundtextError> {
        self.create_face(&data, variations)
    }
}

// ---------------------------------------------------------------------------
// Shaper — text shaping
// ---------------------------------------------------------------------------

/// A shaping-ready parsed font. Created once per font via [`Shaper::create_face`]
/// and reused across shape calls so the font is not re-parsed per call.
pub trait ShaperFace: Send + Sync {
    /// Shape `text` and return raw glyph positions in font units.
    ///
    /// `variations` are applied per call; implementations must not let one call's
    /// axes leak into the next (e.g. apply them to a per-call clone of the face).
    fn shape(
        &self,
        text: &str,
        direction: ShapeDirection,
        language: Option<&str>,
        features: &[ShapeFeature],
        variations: &[ShapeVariation],
    ) -> Vec<RawShapedGlyph>;
}

/// Abstracts text shaping (e.g. rustybuzz, cosmic-text, swash).
pub trait Shaper: Send + Sync {
    /// Parse `data` into a reusable [`ShaperFace`].
    /// Returns `None` if the font data cannot be parsed.
    fn create_face(&self, data: Arc<Vec<u8>>) -> Option<Box<dyn ShaperFace>>;
}
