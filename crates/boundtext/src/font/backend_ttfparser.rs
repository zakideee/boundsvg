//! Default `FontBackend` implementation using `ttf-parser`.

use std::sync::Arc;

use self_cell::self_cell;

use crate::error::BoundtextError;

use super::backend::{
    FontBackend, FontFace, FontMetrics, GlyphBBox, OutlineBuilder, ShapeVariation,
};

/// True when a font that failed outline-table parsing matches the released
/// ttf-parser limitation for fonts with exactly 65535 glyphs: the raw `glyf`
/// table exists in the file, but parsed access to it is unavailable.
fn glyph_count_at_upstream_parser_limit(number_of_glyphs: u16, raw_glyf_present: bool) -> bool {
    number_of_glyphs == u16::MAX && raw_glyf_present
}

/// `FontBackend` implementation backed by the `ttf-parser` crate.
pub struct TtfParserBackend;

impl FontBackend for TtfParserBackend {
    fn parse_metrics(&self, data: &[u8]) -> Result<FontMetrics, BoundtextError> {
        let face = ttf_parser::Face::parse(data, 0)
            .map_err(|e| BoundtextError::FontParse(e.to_string()))?;

        // A face whose outline tables all failed to parse would lay out
        // (metrics/advances come from head/hhea/hmtx) but render every glyph
        // as nothing — reject it at registration instead of failing silently.
        let tables = face.tables();
        if tables.glyf.is_none() && tables.cff.is_none() && tables.cff2.is_none() {
            // Specialize the one known systematic cause: a font with exactly
            // 65535 glyphs has loca/gvar offsets that overflow released
            // ttf-parser's u16 arithmetic, so the tables are present in the
            // file but fail to parse (full Noto Sans CJK hits this). The
            // vendored copy this repository builds against fixes it; see
            // vendor/ttf-parser/README-PATCH.md.
            let raw_glyf_present = face
                .raw_face()
                .table(ttf_parser::Tag::from_bytes(b"glyf"))
                .is_some();
            if glyph_count_at_upstream_parser_limit(face.number_of_glyphs(), raw_glyf_present) {
                return Err(BoundtextError::FontParse(
                    "font declares exactly 65535 glyphs and its outline tables failed to \
                     parse. Released ttf-parser cannot parse fonts with exactly 65535 \
                     glyphs (loca/gvar offset overflow); builds using the patched copy in \
                     vendor/ttf-parser are unaffected. Subset the font below 65535 glyphs, \
                     or apply the vendored ttf-parser patch to your build \
                     (vendor/ttf-parser/README-PATCH.md)"
                        .to_string(),
                ));
            }
            return Err(BoundtextError::FontParse(
                "font has no usable outline table (glyf/CFF/CFF2 missing or unparsable); \
                 text would lay out but not render"
                    .to_string(),
            ));
        }

        let ascender = face.ascender();
        let line_gap = face.line_gap();
        let typographic_ascender = face
            .typographic_ascender()
            .filter(|v| *v != 0)
            .unwrap_or(ascender);
        let descender = face.descender();
        let typographic_descender = face
            .typographic_descender()
            .filter(|v| *v != 0)
            .unwrap_or(descender);
        let typographic_line_gap = face.typographic_line_gap().unwrap_or(line_gap);

        let family_name = extract_family_name(&face);
        let (has_vorg, default_vert_origin_y) = detect_vorg(data);
        let underline_metrics = face.underline_metrics();
        let strikeout_metrics = face.strikeout_metrics();

        Ok(FontMetrics {
            units_per_em: face.units_per_em(),
            ascender,
            line_gap,
            typographic_ascender,
            typographic_descender,
            typographic_line_gap,
            descender,
            vertical_ascender: face.vertical_ascender(),
            vertical_descender: face.vertical_descender(),
            vertical_line_gap: face.vertical_line_gap(),
            family_name,
            has_vorg,
            default_vert_origin_y,
            underline_position: underline_metrics.map(|metrics| metrics.position),
            underline_thickness: underline_metrics.map(|metrics| metrics.thickness),
            strikeout_position: strikeout_metrics.map(|metrics| metrics.position),
            strikeout_thickness: strikeout_metrics.map(|metrics| metrics.thickness),
        })
    }

    fn create_face(
        &self,
        data: &[u8],
        variations: &[ShapeVariation],
    ) -> Result<Box<dyn FontFace>, BoundtextError> {
        self.create_face_shared(Arc::new(data.to_vec()), variations)
    }

    fn create_face_shared(
        &self,
        data: Arc<Vec<u8>>,
        variations: &[ShapeVariation],
    ) -> Result<Box<dyn FontFace>, BoundtextError> {
        let cell = TtfFaceCell::try_new(data, |bytes| {
            let mut face = ttf_parser::Face::parse(bytes, 0)
                .map_err(|e| BoundtextError::FontParse(e.to_string()))?;
            // Variation axes are fixed per FontFace instance, so the mutating
            // set_variation calls happen once here instead of per query.
            for v in variations {
                face.set_variation(ttf_parser::Tag::from_bytes(&v.tag), v.value);
            }
            Ok(face)
        })?;
        Ok(Box::new(TtfParserFontFace { cell }))
    }
}

type TtfFaceDependent<'a> = ttf_parser::Face<'a>;

self_cell!(
    /// Owns the font bytes together with the `ttf_parser::Face` parsed from them.
    /// `Face` borrows the byte slice, so the pair must live in one cell.
    struct TtfFaceCell {
        owner: Arc<Vec<u8>>,
        #[covariant]
        dependent: TtfFaceDependent,
    }
);

/// `FontFace` implementation backed by `ttf-parser`.
///
/// The face (with variations applied) is parsed once at creation; every metric
/// and outline query hits the parsed face directly.
struct TtfParserFontFace {
    cell: TtfFaceCell,
}

impl TtfParserFontFace {
    fn face(&self) -> &ttf_parser::Face<'_> {
        self.cell.borrow_dependent()
    }
}

impl FontFace for TtfParserFontFace {
    fn units_per_em(&self) -> u16 {
        self.face().units_per_em()
    }

    fn ascender(&self) -> i16 {
        self.face().ascender()
    }

    fn descender(&self) -> i16 {
        self.face().descender()
    }

    fn typographic_ascender(&self) -> Option<i16> {
        self.face().typographic_ascender()
    }

    fn typographic_descender(&self) -> Option<i16> {
        self.face().typographic_descender()
    }

    fn underline_position(&self) -> Option<i16> {
        self.face()
            .underline_metrics()
            .map(|metrics| metrics.position)
    }

    fn underline_thickness(&self) -> Option<i16> {
        self.face()
            .underline_metrics()
            .map(|metrics| metrics.thickness)
    }

    fn strikeout_position(&self) -> Option<i16> {
        self.face()
            .strikeout_metrics()
            .map(|metrics| metrics.position)
    }

    fn strikeout_thickness(&self) -> Option<i16> {
        self.face()
            .strikeout_metrics()
            .map(|metrics| metrics.thickness)
    }

    fn glyph_hor_advance(&self, glyph_id: u16) -> Option<u16> {
        self.face().glyph_hor_advance(ttf_parser::GlyphId(glyph_id))
    }

    fn glyph_y_origin(&self, glyph_id: u16) -> Option<i16> {
        self.face().glyph_y_origin(ttf_parser::GlyphId(glyph_id))
    }

    fn glyph_ver_side_bearing(&self, glyph_id: u16) -> Option<i16> {
        self.face()
            .glyph_ver_side_bearing(ttf_parser::GlyphId(glyph_id))
    }

    fn glyph_bounding_box(&self, glyph_id: u16) -> Option<GlyphBBox> {
        let bbox = self
            .face()
            .glyph_bounding_box(ttf_parser::GlyphId(glyph_id))?;
        Some(GlyphBBox {
            x_min: bbox.x_min,
            y_min: bbox.y_min,
            x_max: bbox.x_max,
            y_max: bbox.y_max,
        })
    }

    fn outline_glyph(&self, glyph_id: u16, builder: &mut dyn OutlineBuilder) -> bool {
        let mut adapter = OutlineBuilderAdapter(builder);
        self.face()
            .outline_glyph(ttf_parser::GlyphId(glyph_id), &mut adapter)
            .is_some()
    }
}

/// Adapter that wraps a `backend::OutlineBuilder` as a `ttf_parser::OutlineBuilder`.
struct OutlineBuilderAdapter<'a>(&'a mut dyn OutlineBuilder);

impl ttf_parser::OutlineBuilder for OutlineBuilderAdapter<'_> {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.move_to(x, y);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.line_to(x, y);
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        self.0.quad_to(x1, y1, x, y);
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.0.curve_to(x1, y1, x2, y2, x, y);
    }
    fn close(&mut self) {
        self.0.close();
    }
}

// ---------------------------------------------------------------------------
// Helpers (moved from registry.rs)
// ---------------------------------------------------------------------------

/// Extract the font family name from a parsed face.
/// Prefers typographic family name (name ID 16), falls back to family name (name ID 1).
fn extract_family_name(face: &ttf_parser::Face<'_>) -> Option<String> {
    let mut family = None;
    for name in face.names() {
        if name.name_id == ttf_parser::name_id::TYPOGRAPHIC_FAMILY {
            if let Some(s) = name.to_string() {
                return Some(s);
            }
        }
        if name.name_id == ttf_parser::name_id::FAMILY && family.is_none() {
            family = name.to_string();
        }
    }
    family
}

/// Detect VORG (Vertical Origin) table in raw font data.
/// Returns (`has_vorg`, `default_vert_origin_y`).
fn detect_vorg(data: &[u8]) -> (bool, Option<i16>) {
    if data.len() < 12 {
        return (false, None);
    }

    let num_tables = u16::from_be_bytes([data[4], data[5]]) as usize;
    let vorg_tag = *b"VORG";

    for i in 0..num_tables {
        let record_offset = 12 + i * 16;
        if record_offset + 16 > data.len() {
            break;
        }
        let tag = &data[record_offset..record_offset + 4];
        if tag == vorg_tag {
            let table_offset = u32::from_be_bytes([
                data[record_offset + 8],
                data[record_offset + 9],
                data[record_offset + 10],
                data[record_offset + 11],
            ]) as usize;

            if table_offset + 8 <= data.len() {
                let default_y =
                    i16::from_be_bytes([data[table_offset + 4], data[table_offset + 5]]);
                return (true, Some(default_y));
            }
            return (true, None);
        }
    }

    (false, None)
}

#[cfg(test)]
mod tests {
    #[test]
    fn upstream_parser_limit_requires_both_conditions() {
        assert!(glyph_count_at_upstream_parser_limit(u16::MAX, true));
        assert!(!glyph_count_at_upstream_parser_limit(u16::MAX, false));
        assert!(!glyph_count_at_upstream_parser_limit(65534, true));
        assert!(!glyph_count_at_upstream_parser_limit(0, false));
    }

    use super::*;
    use crate::font::backend::ShapeVariation;

    fn inter_variable_data() -> Vec<u8> {
        std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/Inter-Variable.ttf"
        ))
        .expect("Inter-Variable.ttf not found")
    }

    struct CmdCollector<'a>(&'a mut Vec<String>);
    impl OutlineBuilder for CmdCollector<'_> {
        fn move_to(&mut self, x: f32, y: f32) {
            self.0.push(format!("M{x},{y}"));
        }
        fn line_to(&mut self, x: f32, y: f32) {
            self.0.push(format!("L{x},{y}"));
        }
        fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
            self.0.push(format!("Q{x1},{y1},{x},{y}"));
        }
        fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
            self.0.push(format!("C{x1},{y1},{x2},{y2},{x},{y}"));
        }
        fn close(&mut self) {
            self.0.push("Z".into());
        }
    }

    #[test]
    fn variation_changes_glyph_bounding_box() {
        let data = inter_variable_data();
        let backend = TtfParserBackend;

        let face_default = backend.create_face(&data, &[]).expect("default face");
        let face_bold = backend
            .create_face(
                &data,
                &[ShapeVariation {
                    tag: *b"wght",
                    value: 900.0,
                }],
            )
            .expect("bold face");

        // Glyph ID 43 = 'H' in Inter (cmap varies but a Latin letter will do)
        let face_ref = ttf_parser::Face::parse(&data, 0).unwrap();
        let glyph_id = face_ref
            .glyph_index('H')
            .map(|g| g.0)
            .expect("H should exist in Inter");

        let bbox_default = face_default.glyph_bounding_box(glyph_id).expect("bbox");
        let bbox_bold = face_bold.glyph_bounding_box(glyph_id).expect("bbox");

        assert_ne!(
            bbox_default.x_max, bbox_bold.x_max,
            "wght=900 should produce wider glyph bbox than default"
        );
    }

    #[test]
    fn variation_changes_outline() {
        let data = inter_variable_data();
        let backend = TtfParserBackend;

        let face_default = backend.create_face(&data, &[]).expect("default face");
        let face_bold = backend
            .create_face(
                &data,
                &[ShapeVariation {
                    tag: *b"wght",
                    value: 900.0,
                }],
            )
            .expect("bold face");

        let face_ref = ttf_parser::Face::parse(&data, 0).unwrap();
        let glyph_id = face_ref.glyph_index('H').unwrap().0;

        let mut cmds_default = Vec::new();
        let mut cmds_bold = Vec::new();

        face_default.outline_glyph(glyph_id, &mut CmdCollector(&mut cmds_default));
        face_bold.outline_glyph(glyph_id, &mut CmdCollector(&mut cmds_bold));

        assert!(!cmds_default.is_empty(), "default should have outline");
        assert!(!cmds_bold.is_empty(), "bold should have outline");
        assert_ne!(
            cmds_default, cmds_bold,
            "wght=900 outline should differ from default"
        );
    }
}
