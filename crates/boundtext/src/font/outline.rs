use serde::Serialize;

use super::backend;
use crate::error::BoundtextError;

/// SVG path data for a single glyph, positioned at (x, y)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphPath {
    pub d: String,
    pub x: f64,
    pub y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glyph_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_index: Option<usize>,
}

/// Transform parameters for glyph outline path rendering.
struct PathTransform {
    scale: f64,
    offset_x: f64,
    offset_y: f64,
    shift_x: f64,
    shift_y: f64,
    rotation_deg: u16,
    baseline_rotation_deg: Option<f64>,
    inline_scale: f64,
    pivot_x: f64,
    pivot_y: f64,
}

impl PathTransform {
    fn apply_positioned_rotations(&self, tx: f64, ty: f64) -> (f64, f64) {
        let inline_scaled_x = self.pivot_x + (tx - self.pivot_x) * self.inline_scale;
        let (oriented_x, oriented_y) = if self.rotation_deg == 90 {
            let dx = inline_scaled_x - self.pivot_x;
            let dy = ty - self.pivot_y;
            (self.pivot_x - dy, self.pivot_y + dx)
        } else {
            (inline_scaled_x, ty)
        };

        let Some(baseline_rotation_deg) = self
            .baseline_rotation_deg
            .filter(|baseline_rotation_deg| *baseline_rotation_deg != 0.0)
        else {
            return (oriented_x, oriented_y);
        };
        let normalized_rotation_deg = baseline_rotation_deg % 360.0;
        let (sin, cos) = normalized_rotation_deg.to_radians().sin_cos();
        let dx = oriented_x - self.pivot_x;
        let dy = oriented_y - self.pivot_y;
        (
            self.pivot_x + cos * dx - sin * dy,
            self.pivot_y + sin * dx + cos * dy,
        )
    }
}

/// Collects SVG path commands from `backend::OutlineBuilder`
struct PathBuilder {
    commands: Vec<String>,
    transform: PathTransform,
}

impl PathBuilder {
    fn new(transform: PathTransform) -> Self {
        PathBuilder {
            commands: Vec::new(),
            transform,
        }
    }

    fn transform(&self, x: f32, y: f32) -> (f64, f64) {
        let tx =
            f64::from(x) * self.transform.scale + self.transform.offset_x + self.transform.shift_x;
        let ty =
            self.transform.offset_y - f64::from(y) * self.transform.scale + self.transform.shift_y;
        self.transform.apply_positioned_rotations(tx, ty)
    }

    fn fmt(value: f64) -> String {
        // Round to 2 decimal places, strip trailing zeros
        let formatted = format!("{value:.2}");
        let formatted = formatted.trim_end_matches('0');
        let formatted = formatted.trim_end_matches('.');
        formatted.to_string()
    }

    fn to_path_string(&self) -> String {
        self.commands.join("")
    }
}

impl backend::OutlineBuilder for PathBuilder {
    fn move_to(&mut self, x: f32, y: f32) {
        let (tx, ty) = self.transform(x, y);
        let cmd = format!("M{},{}", Self::fmt(tx), Self::fmt(ty));
        self.commands.push(cmd);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let (tx, ty) = self.transform(x, y);
        let cmd = format!("L{},{}", Self::fmt(tx), Self::fmt(ty));
        self.commands.push(cmd);
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let (tx1, ty1) = self.transform(x1, y1);
        let (tx, ty) = self.transform(x, y);
        let cmd = format!(
            "Q{},{} {},{}",
            Self::fmt(tx1),
            Self::fmt(ty1),
            Self::fmt(tx),
            Self::fmt(ty),
        );
        self.commands.push(cmd);
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let (tx1, ty1) = self.transform(x1, y1);
        let (tx2, ty2) = self.transform(x2, y2);
        let (tx, ty) = self.transform(x, y);
        let cmd = format!(
            "C{},{} {},{} {},{}",
            Self::fmt(tx1),
            Self::fmt(ty1),
            Self::fmt(tx2),
            Self::fmt(ty2),
            Self::fmt(tx),
            Self::fmt(ty),
        );
        self.commands.push(cmd);
    }

    fn close(&mut self) {
        self.commands.push("Z".to_string());
    }
}

/// Position info for a glyph (from shaping result)
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphPosition {
    pub glyph_id: u32,
    pub x_advance: f64,
    pub x_offset: f64,
    pub y_offset: f64,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionedGlyphPathInput {
    pub glyph_id: u32,
    pub font_size_px: f64,
    pub origin_x: f64,
    pub origin_y: f64,
    pub rotation_deg: u16,
    #[serde(default)]
    pub baseline_rotation_deg: Option<f64>,
    #[serde(default)]
    pub inline_scale: Option<f64>,
    pub writing_mode: String,
    pub request_index: usize,
    pub show_missing_glyphs: bool,
}

/// Extract glyph outline paths for a sequence of positioned glyphs.
///
/// - `font_backend`: backend used to create a `FontFace`
/// - `font_data`: raw font bytes
/// - `font_size_px`: desired font size in px
/// - `baseline_y`: Y position of the text baseline in the SVG coordinate space
/// - `start_x`: starting X position
/// - `positions`: glyph positions from shaping
///
/// Returns a list of SVG path data strings (one per glyph that has outlines).
#[expect(
    clippy::cast_possible_truncation,
    reason = "glyph IDs are OpenType u16 stored as u32 in GlyphPosition; truncation is correct"
)]
pub fn extract_glyph_paths(
    font_backend: &dyn backend::FontBackend,
    font_data: &[u8],
    font_size_px: f64,
    baseline_y: f64,
    start_x: f64,
    positions: &[GlyphPosition],
    variations: &[backend::ShapeVariation],
) -> Vec<GlyphPath> {
    let Ok(face) = font_backend.create_face(font_data, variations) else {
        return Vec::new();
    };

    let units_per_em = f64::from(face.units_per_em());
    let scale = font_size_px / units_per_em;
    let mut cursor_x = start_x;
    let mut paths = Vec::new();

    for pos in positions {
        let glyph_id = pos.glyph_id as u16;
        let gx = cursor_x + pos.x_offset;
        let gy = baseline_y + pos.y_offset;

        let mut builder = PathBuilder::new(PathTransform {
            scale,
            offset_x: gx,
            offset_y: gy,
            shift_x: 0.0,
            shift_y: 0.0,
            rotation_deg: 0,
            baseline_rotation_deg: None,
            inline_scale: 1.0,
            pivot_x: gx,
            pivot_y: gy,
        });

        if face.outline_glyph(glyph_id, &mut builder) {
            let path_data = builder.to_path_string();
            if !path_data.is_empty() {
                paths.push(GlyphPath {
                    d: path_data,
                    x: gx,
                    y: gy,
                    glyph_id: None,
                    request_index: None,
                });
            }
        }

        cursor_x += pos.x_advance;
    }

    paths
}

/// Extract one already-positioned glyph outline around its baseline origin.
///
/// # Errors
///
/// Returns [`BoundtextError::InvalidBaselineRotation`] when the additive
/// baseline rotation is not finite, or [`BoundtextError::InvalidInlineScale`]
/// when the inline-axis scale is not positive and finite.
#[expect(
    clippy::cast_possible_truncation,
    reason = "glyph IDs are OpenType u16 stored as u32; truncation is correct"
)]
pub fn extract_positioned_glyph_path(
    face: &dyn backend::FontFace,
    input: &PositionedGlyphPathInput,
) -> Result<Option<GlyphPath>, BoundtextError> {
    if input
        .baseline_rotation_deg
        .is_some_and(|baseline_rotation_deg| !baseline_rotation_deg.is_finite())
    {
        return Err(BoundtextError::InvalidBaselineRotation);
    }
    let inline_scale = input.inline_scale.unwrap_or(1.0);
    if !inline_scale.is_finite() || inline_scale <= 0.0 {
        return Err(BoundtextError::InvalidInlineScale);
    }
    let glyph_id = input.glyph_id as u16;
    let units_per_em = f64::from(face.units_per_em());
    let scale = input.font_size_px / units_per_em;

    // For .notdef (glyph_id=0) with show_missing_glyphs, always use synthetic
    // tofu marker — never render the font's own .notdef outline (which may be
    // a filled rectangle indistinguishable from a real glyph).
    if glyph_id == 0 && input.show_missing_glyphs {
        return Ok(Some(build_tofu_rect(face, input, scale)));
    }

    let Some(bbox) = face.glyph_bounding_box(glyph_id) else {
        return Ok(None);
    };

    let (shift_x, shift_y) = if input.writing_mode == "vertical-rl" {
        if input.rotation_deg == 90 {
            let center_x = (f64::from(bbox.x_min) + f64::from(bbox.x_max)) * 0.5 * scale;
            let font_center_y = face
                .typographic_ascender()
                .map_or(f64::from(face.ascender()), f64::from)
                .mul_add(
                    0.5,
                    face.typographic_descender()
                        .map_or(f64::from(face.descender()), f64::from)
                        * 0.5,
                )
                * scale;
            (-center_x, font_center_y)
        } else {
            (
                face.glyph_hor_advance(glyph_id)
                    .map_or(-input.font_size_px * 0.5, |advance| {
                        -(f64::from(advance) * scale * 0.5)
                    }),
                0.0,
            )
        }
    } else {
        (0.0, 0.0)
    };

    let mut builder = PathBuilder::new(PathTransform {
        scale,
        offset_x: input.origin_x,
        offset_y: input.origin_y,
        shift_x,
        shift_y,
        rotation_deg: input.rotation_deg,
        baseline_rotation_deg: input.baseline_rotation_deg,
        inline_scale,
        pivot_x: input.origin_x,
        pivot_y: input.origin_y,
    });

    if !face.outline_glyph(glyph_id, &mut builder) {
        return Ok(None);
    }

    let path_data = builder.to_path_string();
    if path_data.is_empty() {
        return Ok(None);
    }

    Ok(Some(GlyphPath {
        d: path_data,
        x: input.origin_x,
        y: input.origin_y,
        glyph_id: Some(input.glyph_id),
        request_index: Some(input.request_index),
    }))
}

/// Synthesize a tofu marker for a missing glyph.
///
/// Draws a border rectangle with an interior cross (×) so it is visually
/// distinct from regular glyphs that contain squares.
/// Uses `font_size_px` as the cell width so the marker aligns with
/// surrounding characters (especially for full-width CJK text).
fn build_tofu_rect(
    face: &dyn backend::FontFace,
    input: &PositionedGlyphPathInput,
    scale: f64,
) -> GlyphPath {
    // Use font_size_px as width so the marker matches surrounding glyph cells.
    let cell = input.font_size_px;
    let ascender = face
        .typographic_ascender()
        .map_or(f64::from(face.ascender()), f64::from)
        * scale;
    let descender = face
        .typographic_descender()
        .map_or(f64::from(face.descender()), f64::from)
        * scale;
    let em_height = ascender - descender;

    // Vertical writing mode: center horizontally like normal upright glyphs
    let (shift_x, shift_y) = if input.writing_mode == "vertical-rl" {
        (-(cell * 0.5), 0.0)
    } else {
        (0.0, 0.0)
    };

    // Inset by ~12% on each side
    let inset = cell * 0.12;

    let rect_x = input.origin_x + shift_x + inset;
    let rect_y = input.origin_y + shift_y - ascender + inset;
    let rect_width = (cell - inset * 2.0).max(0.5);
    let rect_height = (em_height - inset * 2.0).max(0.5);
    let rect_right = rect_x + rect_width;
    let negative_rect_width = -rect_width;

    // Preserve the established tofu bytes unless the additive rotation is active.
    let inline_scale = input.inline_scale.unwrap_or(1.0);
    let path_data = if input.baseline_rotation_deg.unwrap_or(0.0) == 0.0 && inline_scale == 1.0 {
        // Border rect + interior cross (×)
        format!(
            "M{rect_x:.2} {rect_y:.2}h{rect_width:.2}v{rect_height:.2}h{negative_rect_width:.2}Z\
             M{rect_x:.2} {rect_y:.2}l{rect_width:.2} {rect_height:.2}\
             M{rect_right:.2} {rect_y:.2}l{negative_rect_width:.2} {rect_height:.2}",
        )
    } else {
        let transform = PathTransform {
            scale: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
            shift_x: 0.0,
            shift_y: 0.0,
            rotation_deg: input.rotation_deg,
            baseline_rotation_deg: input.baseline_rotation_deg,
            inline_scale,
            pivot_x: input.origin_x,
            pivot_y: input.origin_y,
        };
        let rect_bottom = rect_y + rect_height;
        let points = [
            transform.apply_positioned_rotations(rect_x, rect_y),
            transform.apply_positioned_rotations(rect_right, rect_y),
            transform.apply_positioned_rotations(rect_right, rect_bottom),
            transform.apply_positioned_rotations(rect_x, rect_bottom),
        ];
        format!(
            "M{},{}L{},{}L{},{}L{},{}ZM{},{}L{},{}M{},{}L{},{}",
            PathBuilder::fmt(points[0].0),
            PathBuilder::fmt(points[0].1),
            PathBuilder::fmt(points[1].0),
            PathBuilder::fmt(points[1].1),
            PathBuilder::fmt(points[2].0),
            PathBuilder::fmt(points[2].1),
            PathBuilder::fmt(points[3].0),
            PathBuilder::fmt(points[3].1),
            PathBuilder::fmt(points[0].0),
            PathBuilder::fmt(points[0].1),
            PathBuilder::fmt(points[2].0),
            PathBuilder::fmt(points[2].1),
            PathBuilder::fmt(points[1].0),
            PathBuilder::fmt(points[1].1),
            PathBuilder::fmt(points[3].0),
            PathBuilder::fmt(points[3].1),
        )
    };

    GlyphPath {
        d: path_data,
        x: input.origin_x,
        y: input.origin_y,
        glyph_id: Some(input.glyph_id),
        request_index: Some(input.request_index),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::backend::FontBackend;
    use crate::font::backend_ttfparser::TtfParserBackend;
    use crate::font::shaping;
    use crate::font::{FontEntry, FontRegistry, FontStyle};

    fn test_font_data() -> Vec<u8> {
        std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font file not found")
    }

    fn test_backend() -> TtfParserBackend {
        TtfParserBackend
    }

    #[test]
    fn test_extract_ascii_paths() {
        let data = test_font_data();
        let backend = test_backend();
        let registry = FontRegistry::new();
        let entry = FontEntry::new(data.clone(), "Test".into(), 400, FontStyle::Normal).unwrap();
        let glyphs = shaping::shape_text(&registry, &entry, "AB", 24.0, 0.0);

        let positions: Vec<GlyphPosition> = glyphs
            .iter()
            .map(|g| GlyphPosition {
                glyph_id: g.glyph_id,
                x_advance: g.x_advance,
                x_offset: g.x_offset,
                y_offset: g.y_offset,
            })
            .collect();

        let paths = extract_glyph_paths(&backend, &data, 24.0, 20.0, 0.0, &positions, &[]);
        assert!(!paths.is_empty(), "Should produce paths for ASCII glyphs");
        for p in &paths {
            assert!(p.d.starts_with('M'), "Path should start with M command");
            assert!(p.d.contains('Z'), "Path should be closed with Z");
        }
    }

    #[test]
    fn test_extract_cjk_paths() {
        let data = test_font_data();
        let backend = test_backend();
        let registry = FontRegistry::new();
        let entry = FontEntry::new(data.clone(), "Test".into(), 400, FontStyle::Normal).unwrap();
        let glyphs = shaping::shape_text(&registry, &entry, "あ", 24.0, 0.0);

        let positions: Vec<GlyphPosition> = glyphs
            .iter()
            .map(|g| GlyphPosition {
                glyph_id: g.glyph_id,
                x_advance: g.x_advance,
                x_offset: g.x_offset,
                y_offset: g.y_offset,
            })
            .collect();

        let paths = extract_glyph_paths(&backend, &data, 24.0, 20.0, 0.0, &positions, &[]);
        assert!(!paths.is_empty(), "Should produce paths for CJK glyphs");
    }

    #[test]
    fn test_empty_text_returns_empty() {
        let data = test_font_data();
        let backend = test_backend();
        let paths = extract_glyph_paths(&backend, &data, 24.0, 20.0, 0.0, &[], &[]);
        assert!(paths.is_empty());
    }

    #[test]
    fn test_path_positioning() {
        let data = test_font_data();
        let backend = test_backend();
        let registry = FontRegistry::new();
        let entry = FontEntry::new(data.clone(), "Test".into(), 400, FontStyle::Normal).unwrap();
        let glyphs = shaping::shape_text(&registry, &entry, "AB", 24.0, 0.0);

        let positions: Vec<GlyphPosition> = glyphs
            .iter()
            .map(|g| GlyphPosition {
                glyph_id: g.glyph_id,
                x_advance: g.x_advance,
                x_offset: g.x_offset,
                y_offset: g.y_offset,
            })
            .collect();

        let paths = extract_glyph_paths(&backend, &data, 24.0, 20.0, 10.0, &positions, &[]);
        assert!(paths.len() >= 2);
        // First glyph starts at x=10
        assert!((paths[0].x - 10.0).abs() < 0.01);
        // Second glyph starts further right
        assert!(paths[1].x > paths[0].x);
    }

    #[test]
    #[expect(
        clippy::cast_possible_truncation,
        reason = "glyph IDs are OpenType u16 stored as u32; truncation is correct"
    )]
    fn test_vertical_rotated_punctuation_preserves_cross_axis_side() {
        let data = test_font_data();
        let backend = test_backend();
        let entry = FontEntry::new(data.clone(), "Test".into(), 400, FontStyle::Normal).unwrap();
        let face = backend.create_face(&data, &[]).expect("create face");
        let options = shaping::ShapeOptions {
            writing_mode: Some("vertical-rl".into()),
            language: Some("ja".into()),
            vertical_feature_priority: None,
            text_orientation: None,
            font_variation_settings: Vec::new(),
            font_feature_settings: Vec::new(),
        };
        let registry = FontRegistry::new();
        let glyphs =
            shaping::shape_text_with_options(&registry, &entry, "A,.\"", 42.0, 0.0, &options);
        assert_eq!(glyphs.len(), 4);

        let scale = 42.0 / f64::from(face.units_per_em());
        let font_center_y = face
            .typographic_ascender()
            .map_or(f64::from(face.ascender()), f64::from)
            .mul_add(
                0.5,
                face.typographic_descender()
                    .map_or(f64::from(face.descender()), f64::from)
                    * 0.5,
            )
            * scale;
        let cross_axis_offsets: Vec<f64> = glyphs
            .iter()
            .map(|glyph| {
                let glyph_id = glyph.glyph_id as u16;
                let bbox = face.glyph_bounding_box(glyph_id).expect("bbox");
                let bbox_center_y = (f64::from(bbox.y_min) + f64::from(bbox.y_max)) * 0.5 * scale;
                bbox_center_y - font_center_y
            })
            .collect();

        assert!(
            cross_axis_offsets[0].abs() < 3.0,
            "Latin letters should stay near the column center: {cross_axis_offsets:?}",
        );
        assert!(
            cross_axis_offsets[1] < -2.0 && cross_axis_offsets[2] < -2.0,
            "comma/period should remain on the lower-side cross-axis after rotation: {cross_axis_offsets:?}",
        );
        assert!(
            cross_axis_offsets[3] > 2.0,
            "double quote should remain on the upper-side cross-axis after rotation: {cross_axis_offsets:?}",
        );
    }

    // -----------------------------------------------------------------------
    // Tofu marker tests (missing glyph / show_missing_glyphs)
    // -----------------------------------------------------------------------

    fn make_face(data: &[u8]) -> Box<dyn backend::FontFace + '_> {
        TtfParserBackend
            .create_face(data, &[])
            .expect("create face")
    }

    #[test]
    fn tofu_marker_returned_for_notdef_with_show_missing_glyphs() {
        let data = test_font_data();
        let face = make_face(&data);
        let input = PositionedGlyphPathInput {
            glyph_id: 0,
            font_size_px: 16.0,
            origin_x: 10.0,
            origin_y: 20.0,
            rotation_deg: 0,
            baseline_rotation_deg: None,
            inline_scale: None,
            writing_mode: "horizontal-tb".to_string(),
            request_index: 0,
            show_missing_glyphs: true,
        };
        let path = extract_positioned_glyph_path(face.as_ref(), &input).expect("valid rotation");
        assert!(path.is_some(), "should return synthetic tofu marker");
        let gp = path.unwrap();
        // Tofu marker has rect + cross: two M commands after the initial one
        let m_count = gp.d.matches('M').count();
        assert!(
            m_count >= 3,
            "tofu should have rect + cross (3 M commands), got {m_count}"
        );
    }

    #[test]
    fn notdef_without_flag_returns_font_outline_or_none() {
        let data = test_font_data();
        let face = make_face(&data);
        let input = PositionedGlyphPathInput {
            glyph_id: 0,
            font_size_px: 16.0,
            origin_x: 10.0,
            origin_y: 20.0,
            rotation_deg: 0,
            baseline_rotation_deg: None,
            inline_scale: None,
            writing_mode: "horizontal-tb".to_string(),
            request_index: 0,
            show_missing_glyphs: false,
        };
        let path = extract_positioned_glyph_path(face.as_ref(), &input).expect("valid rotation");
        // With show_missing_glyphs=false, result depends on font's .notdef outline.
        // Either None or the font's own outline — but NOT the synthetic tofu marker.
        if let Some(gp) = &path {
            // If the font has a .notdef outline it should be a simple rect (1 M),
            // not our synthetic rect+cross (3 M).
            let m_count = gp.d.matches('M').count();
            assert!(
                m_count < 3,
                "should not be synthetic tofu marker when flag is off"
            );
        }
    }

    #[test]
    fn tofu_marker_horizontal_position() {
        let data = test_font_data();
        let face = make_face(&data);
        let input = PositionedGlyphPathInput {
            glyph_id: 0,
            font_size_px: 20.0,
            origin_x: 50.0,
            origin_y: 100.0,
            rotation_deg: 0,
            baseline_rotation_deg: None,
            inline_scale: None,
            writing_mode: "horizontal-tb".to_string(),
            request_index: 0,
            show_missing_glyphs: true,
        };
        let gp = extract_positioned_glyph_path(face.as_ref(), &input)
            .expect("valid rotation")
            .expect("tofu path");
        // Path should start near origin_x (with inset)
        assert!(
            gp.d.starts_with("M5"),
            "horizontal tofu should start near origin_x=50"
        );
    }

    #[test]
    fn tofu_marker_vertical_centered() {
        let data = test_font_data();
        let face = make_face(&data);
        let input_h = PositionedGlyphPathInput {
            glyph_id: 0,
            font_size_px: 20.0,
            origin_x: 50.0,
            origin_y: 100.0,
            rotation_deg: 0,
            baseline_rotation_deg: None,
            inline_scale: None,
            writing_mode: "horizontal-tb".to_string(),
            request_index: 0,
            show_missing_glyphs: true,
        };
        let input_v = PositionedGlyphPathInput {
            writing_mode: "vertical-rl".to_string(),
            ..input_h.clone()
        };
        let path_h = extract_positioned_glyph_path(face.as_ref(), &input_h)
            .expect("valid rotation")
            .expect("horizontal tofu path");
        let path_v = extract_positioned_glyph_path(face.as_ref(), &input_v)
            .expect("valid rotation")
            .expect("vertical tofu path");
        // Vertical tofu should be shifted left (centered) compared to horizontal
        assert_ne!(
            path_h.d, path_v.d,
            "vertical tofu should differ from horizontal due to centering shift"
        );
    }

    fn inter_variable_data() -> Vec<u8> {
        std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/Inter-Variable.ttf"
        ))
        .expect("Inter-Variable.ttf not found")
    }

    fn positioned_input(glyph_id: u32) -> PositionedGlyphPathInput {
        PositionedGlyphPathInput {
            glyph_id,
            font_size_px: 48.0,
            origin_x: 100.0,
            origin_y: 120.0,
            rotation_deg: 0,
            baseline_rotation_deg: None,
            inline_scale: None,
            writing_mode: "horizontal-tb".to_string(),
            request_index: 0,
            show_missing_glyphs: false,
        }
    }

    fn glyph_id_for_text(data: &[u8], text: &str) -> u32 {
        let registry = FontRegistry::new();
        let entry = FontEntry::new(data.to_vec(), "Test".into(), 400, FontStyle::Normal)
            .expect("font entry");
        shaping::shape_text(&registry, &entry, text, 48.0, 0.0)[0].glyph_id
    }

    #[test]
    fn baseline_rotation_absent_and_zero_preserve_outline_bytes() {
        let data = test_font_data();
        let face = make_face(&data);
        let input = positioned_input(glyph_id_for_text(&data, "A"));
        let absent = extract_positioned_glyph_path(face.as_ref(), &input)
            .expect("valid rotation")
            .expect("glyph path");
        let zero = extract_positioned_glyph_path(
            face.as_ref(),
            &PositionedGlyphPathInput {
                baseline_rotation_deg: Some(0.0),
                ..input
            },
        )
        .expect("valid rotation")
        .expect("glyph path");

        assert_eq!(absent.d, zero.d);
    }

    #[test]
    fn baseline_rotation_is_additive_after_existing_glyph_orientation() {
        let transform = PathTransform {
            scale: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
            shift_x: 0.0,
            shift_y: 0.0,
            rotation_deg: 90,
            baseline_rotation_deg: Some(45.0),
            inline_scale: 1.0,
            pivot_x: 100.0,
            pivot_y: 120.0,
        };

        let (x, y) = transform.apply_positioned_rotations(110.0, 120.0);
        let diagonal = 10.0 / 2.0_f64.sqrt();
        assert!((x - (100.0 - diagonal)).abs() < 1e-12);
        assert!((y - (120.0 + diagonal)).abs() < 1e-12);
    }

    #[test]
    fn baseline_rotation_changes_outline_and_synthetic_tofu_around_origin() {
        let data = test_font_data();
        let face = make_face(&data);
        let glyph_id = glyph_id_for_text(&data, "A");
        let input = positioned_input(glyph_id);
        let unrotated = extract_positioned_glyph_path(face.as_ref(), &input)
            .expect("valid rotation")
            .expect("glyph path");
        let rotated = extract_positioned_glyph_path(
            face.as_ref(),
            &PositionedGlyphPathInput {
                baseline_rotation_deg: Some(45.0),
                ..input.clone()
            },
        )
        .expect("valid rotation")
        .expect("glyph path");
        assert_ne!(unrotated.d, rotated.d);

        let tofu_input = PositionedGlyphPathInput {
            glyph_id: 0,
            baseline_rotation_deg: Some(45.0),
            show_missing_glyphs: true,
            ..input
        };
        let tofu = extract_positioned_glyph_path(face.as_ref(), &tofu_input)
            .expect("valid rotation")
            .expect("tofu path");
        assert!(tofu.d.starts_with('M'));
        assert!(tofu.d.contains('Z'));
        assert!(!tofu.d.contains("NaN"));
        assert!(!tofu.d.contains("inf"));
    }

    #[test]
    fn baseline_rotation_rejects_non_finite_values() {
        let data = test_font_data();
        let face = make_face(&data);
        let glyph_id = glyph_id_for_text(&data, "A");

        for baseline_rotation_deg in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let result = extract_positioned_glyph_path(
                face.as_ref(),
                &PositionedGlyphPathInput {
                    baseline_rotation_deg: Some(baseline_rotation_deg),
                    ..positioned_input(glyph_id)
                },
            );
            assert!(matches!(
                result,
                Err(BoundtextError::InvalidBaselineRotation)
            ));
        }
    }

    #[test]
    fn baseline_rotation_normalizes_large_finite_values_before_radians() {
        let transform = PathTransform {
            scale: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
            shift_x: 0.0,
            shift_y: 0.0,
            rotation_deg: 0,
            baseline_rotation_deg: Some(f64::MAX),
            inline_scale: 1.0,
            pivot_x: 100.0,
            pivot_y: 120.0,
        };

        let (x, y) = transform.apply_positioned_rotations(110.0, 120.0);
        assert!(x.is_finite());
        assert!(y.is_finite());
    }

    #[test]
    fn inline_scale_is_applied_before_orientation_and_baseline_rotation() {
        let transform = PathTransform {
            scale: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
            shift_x: 0.0,
            shift_y: 0.0,
            rotation_deg: 90,
            baseline_rotation_deg: Some(45.0),
            inline_scale: 2.0,
            pivot_x: 100.0,
            pivot_y: 120.0,
        };

        let (x, y) = transform.apply_positioned_rotations(110.0, 120.0);
        let diagonal = 20.0 / 2.0_f64.sqrt();
        assert!((x - (100.0 - diagonal)).abs() < 1e-12);
        assert!((y - (120.0 + diagonal)).abs() < 1e-12);
    }

    #[test]
    fn inline_scale_changes_outline_and_tofu_and_rejects_invalid_values() {
        let data = test_font_data();
        let face = make_face(&data);
        let glyph_id = glyph_id_for_text(&data, "A");
        let input = positioned_input(glyph_id);
        let natural = extract_positioned_glyph_path(face.as_ref(), &input)
            .expect("valid natural scale")
            .expect("glyph outline");
        let scaled = extract_positioned_glyph_path(
            face.as_ref(),
            &PositionedGlyphPathInput {
                inline_scale: Some(2.0),
                ..input.clone()
            },
        )
        .expect("valid inline scale")
        .expect("scaled glyph outline");
        assert_ne!(natural.d, scaled.d);

        let tofu_natural = extract_positioned_glyph_path(
            face.as_ref(),
            &PositionedGlyphPathInput {
                glyph_id: 0,
                show_missing_glyphs: true,
                ..input.clone()
            },
        )
        .expect("natural tofu")
        .expect("natural tofu outline");
        let tofu_scaled = extract_positioned_glyph_path(
            face.as_ref(),
            &PositionedGlyphPathInput {
                glyph_id: 0,
                show_missing_glyphs: true,
                inline_scale: Some(2.0),
                ..input.clone()
            },
        )
        .expect("scaled tofu")
        .expect("scaled tofu outline");
        assert_ne!(tofu_natural.d, tofu_scaled.d);

        for inline_scale in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            let error = extract_positioned_glyph_path(
                face.as_ref(),
                &PositionedGlyphPathInput {
                    inline_scale: Some(inline_scale),
                    ..input.clone()
                },
            )
            .expect_err("invalid inline scale");
            assert!(matches!(error, BoundtextError::InvalidInlineScale));
        }
    }

    #[test]
    fn extract_glyph_paths_respects_variations() {
        let data = inter_variable_data();
        let backend = test_backend();
        let registry = FontRegistry::new();
        let entry = FontEntry::new(data.clone(), "Inter".into(), 400, FontStyle::Normal).unwrap();
        let glyphs = shaping::shape_text(&registry, &entry, "H", 48.0, 0.0);

        let positions: Vec<GlyphPosition> = glyphs
            .iter()
            .map(|g| GlyphPosition {
                glyph_id: g.glyph_id,
                x_advance: g.x_advance,
                x_offset: g.x_offset,
                y_offset: g.y_offset,
            })
            .collect();

        let paths_default = extract_glyph_paths(&backend, &data, 48.0, 40.0, 0.0, &positions, &[]);
        let paths_bold = extract_glyph_paths(
            &backend,
            &data,
            48.0,
            40.0,
            0.0,
            &positions,
            &[backend::ShapeVariation {
                tag: *b"wght",
                value: 900.0,
            }],
        );

        assert!(!paths_default.is_empty(), "default should produce paths");
        assert!(!paths_bold.is_empty(), "bold should produce paths");
        assert_ne!(
            paths_default[0].d, paths_bold[0].d,
            "wght=900 paths should differ from default"
        );
    }
}
