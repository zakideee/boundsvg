//! Read explicit OpenType metrics and draw floating point outlines with Skrifa.

use std::sync::Arc;

use read_fonts::{
    FontRef, TableProvider, model,
    types::{F2Dot14, GlyphId, Tag},
};
use skrifa::{
    MetadataProvider,
    instance::{LocationRef, Size},
    outline::{DrawSettings, Hinting, OutlinePen, pen::PathStyle},
};

use super::{
    admission::{has_table, parse_error, validate_font_collection},
    backend::{
        FontBackend, FontFace, FontMetrics, GlyphBBox, OutlineBuilder, ShapeVariation,
        validate_variations,
    },
};
use crate::error::{BoundtextError, FontFailureReason};

/// Read metrics and unhinted outlines using the released Fontations libraries.
pub struct SkrifaBackend;

impl FontBackend for SkrifaBackend {
    fn parse_metrics(&self, data: &[u8]) -> Result<FontMetrics, BoundtextError> {
        validate_font_collection(data)?;
        read_metrics(&font_ref(data)?, &[], true)
    }

    fn create_face(
        &self,
        data: &[u8],
        variations: &[ShapeVariation],
    ) -> Result<Box<dyn FontFace>, BoundtextError> {
        let mut bytes = Vec::new();
        bytes
            .try_reserve_exact(data.len())
            .map_err(|_| parse_error(FontFailureReason::AllocationFailed, None, 0))?;
        bytes.extend_from_slice(data);
        self.create_face_shared(Arc::new(bytes), variations)
    }

    fn create_face_shared(
        &self,
        data: Arc<Vec<u8>>,
        variations: &[ShapeVariation],
    ) -> Result<Box<dyn FontFace>, BoundtextError> {
        validate_variations(variations)?;
        validate_font_collection(&data)?;
        let shared: Arc<dyn AsRef<[u8]> + Send + Sync> = data.clone();
        let font = model::Font::new(model::Blob::Shared(shared), 0)
            .ok_or_else(|| parse_error(FontFailureReason::InvalidData, None, 0))?;
        let mut settings = Vec::new();
        settings
            .try_reserve_exact(variations.len())
            .map_err(|_| parse_error(FontFailureReason::AllocationFailed, None, 0))?;
        settings.extend(
            variations
                .iter()
                .map(|variation| model::Variation::new(Tag::new(&variation.tag), variation.value)),
        );
        let font = font.instance_builder().variations(&settings).build();
        let reference = font_ref(&data)?;
        let metrics = read_metrics(&reference, font.normalized_coords(), false)?;
        let typo_ascender = if has_table(&reference, *b"OS/2") {
            Some(varied_metric(
                &reference,
                font.normalized_coords(),
                f64::from(
                    reference
                        .os2()
                        .map_err(|_| invalid_table("OS/2"))?
                        .s_typo_ascender(),
                ),
                *b"hasc",
            )?)
        } else {
            None
        };
        let typo_descender = if has_table(&reference, *b"OS/2") {
            Some(varied_metric(
                &reference,
                font.normalized_coords(),
                f64::from(
                    reference
                        .os2()
                        .map_err(|_| invalid_table("OS/2"))?
                        .s_typo_descender(),
                ),
                *b"hdsc",
            )?)
        } else {
            None
        };
        Ok(Box::new(SkrifaFace {
            data,
            font,
            metrics,
            typo_ascender,
            typo_descender,
        }))
    }
}

fn font_ref(data: &[u8]) -> Result<FontRef<'_>, BoundtextError> {
    FontRef::from_index(data, 0).map_err(|_| parse_error(FontFailureReason::InvalidData, None, 0))
}

fn invalid_table(table: &'static str) -> BoundtextError {
    parse_error(FontFailureReason::InvalidTable, Some(table), 0)
}

fn finite_metric(value: f64) -> Result<f64, BoundtextError> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(parse_error(FontFailureReason::NonFiniteMetric, None, 0))
    }
}

/// Apply MVAR without the integer rounding performed by convenience metrics APIs.
fn varied_metric(
    font: &FontRef<'_>,
    coords: &[F2Dot14],
    value: f64,
    tag: [u8; 4],
) -> Result<f64, BoundtextError> {
    if !has_table(font, *b"MVAR") {
        return finite_metric(value);
    }
    let mvar = font.mvar().map_err(|_| invalid_table("MVAR"))?;
    let Some(record) = mvar
        .value_records()
        .iter()
        .find(|record| record.value_tag() == Tag::new(&tag))
    else {
        return finite_metric(value);
    };
    let store = mvar
        .item_variation_store()
        .ok_or_else(|| invalid_table("MVAR"))?
        .map_err(|_| invalid_table("MVAR"))?;
    let delta = store
        .compute_delta(
            read_fonts::tables::variations::DeltaSetIndex {
                outer: record.delta_set_outer_index(),
                inner: record.delta_set_inner_index(),
            },
            coords,
        )
        .ok_or_else(|| invalid_table("MVAR"))?;
    finite_metric(value + delta.to_f64())
}

/// Keep hhea/OS/2 field selection explicit; library default policies differ.
fn read_metrics(
    font: &FontRef<'_>,
    coords: &[F2Dot14],
    include_name: bool,
) -> Result<FontMetrics, BoundtextError> {
    let head = font.head().map_err(|_| invalid_table("head"))?;
    let maxp = font.maxp().map_err(|_| invalid_table("maxp"))?;
    let hhea = font.hhea().map_err(|_| invalid_table("hhea"))?;
    let os2 = if has_table(font, *b"OS/2") {
        Some(font.os2().map_err(|_| invalid_table("OS/2"))?)
    } else {
        None
    };
    let typo_ascender = os2
        .as_ref()
        .map(|table| varied_metric(font, coords, f64::from(table.s_typo_ascender()), *b"hasc"))
        .transpose()?;
    let typo_descender = os2
        .as_ref()
        .map(|table| varied_metric(font, coords, f64::from(table.s_typo_descender()), *b"hdsc"))
        .transpose()?;
    let typo_gap = os2
        .as_ref()
        .map(|table| varied_metric(font, coords, f64::from(table.s_typo_line_gap()), *b"hlgp"))
        .transpose()?;
    let use_typo = os2
        .as_ref()
        .is_some_and(|table| table.version() >= 4 && table.fs_selection().bits() & (1 << 7) != 0);
    let mut ascender = f64::from(hhea.ascender().to_i16());
    let mut descender = f64::from(hhea.descender().to_i16());
    let mut line_gap = f64::from(hhea.line_gap().to_i16());
    if let Some(table) = &os2 {
        if use_typo {
            ascender = typo_ascender.ok_or_else(|| invalid_table("OS/2"))?;
            descender = typo_descender.ok_or_else(|| invalid_table("OS/2"))?;
            line_gap = typo_gap.ok_or_else(|| invalid_table("OS/2"))?;
        } else {
            if hhea.ascender().to_i16() == 0 {
                ascender = if table.s_typo_ascender() != 0 {
                    typo_ascender.ok_or_else(|| invalid_table("OS/2"))?
                } else {
                    varied_metric(font, coords, f64::from(table.us_win_ascent()), *b"hcla")?
                };
            }
            if hhea.descender().to_i16() == 0 {
                descender = if table.s_typo_descender() != 0 {
                    typo_descender.ok_or_else(|| invalid_table("OS/2"))?
                } else {
                    -varied_metric(font, coords, f64::from(table.us_win_descent()), *b"hcld")?
                };
            }
            if hhea.ascender().to_i16() == 0 || hhea.descender().to_i16() == 0 {
                line_gap = if table.s_typo_ascender() != 0 || table.s_typo_descender() != 0 {
                    typo_gap.ok_or_else(|| invalid_table("OS/2"))?
                } else {
                    0.0
                };
            }
        }
    }
    let vertical = if has_table(font, *b"vhea") {
        Some(font.vhea().map_err(|_| invalid_table("vhea"))?)
    } else {
        None
    };
    let vorg = if has_table(font, *b"VORG") {
        Some(font.vorg().map_err(|_| invalid_table("VORG"))?)
    } else {
        None
    };
    let post = if has_table(font, *b"post") {
        Some(font.post().map_err(|_| invalid_table("post"))?)
    } else {
        None
    };
    Ok(FontMetrics {
        units_per_em: head.units_per_em(),
        glyph_count: u32::from(maxp.num_glyphs()),
        ascender: finite_metric(ascender)?,
        descender: finite_metric(descender)?,
        line_gap: finite_metric(line_gap)?,
        typographic_ascender: typo_ascender
            .filter(|value| *value != 0.0)
            .unwrap_or(ascender),
        typographic_descender: typo_descender
            .filter(|value| *value != 0.0)
            .unwrap_or(descender),
        typographic_line_gap: typo_gap.unwrap_or(line_gap),
        vertical_ascender: vertical
            .as_ref()
            .map(|table| {
                varied_metric(font, coords, f64::from(table.ascender().to_i16()), *b"vasc")
            })
            .transpose()?,
        vertical_descender: vertical
            .as_ref()
            .map(|table| {
                varied_metric(
                    font,
                    coords,
                    f64::from(table.descender().to_i16()),
                    *b"vdsc",
                )
            })
            .transpose()?,
        vertical_line_gap: vertical
            .as_ref()
            .map(|table| {
                varied_metric(font, coords, f64::from(table.line_gap().to_i16()), *b"vlgp")
            })
            .transpose()?,
        family_name: if include_name {
            family_name(font)?
        } else {
            None
        },
        has_vorg: vorg.is_some(),
        default_vert_origin_y: vorg.map(|table| f64::from(table.default_vert_origin_y())),
        underline_position: post
            .as_ref()
            .map(|table| {
                varied_metric(
                    font,
                    coords,
                    f64::from(table.underline_position().to_i16()),
                    *b"undo",
                )
            })
            .transpose()?,
        underline_thickness: post
            .as_ref()
            .map(|table| {
                varied_metric(
                    font,
                    coords,
                    f64::from(table.underline_thickness().to_i16()),
                    *b"unds",
                )
            })
            .transpose()?,
        strikeout_position: os2
            .as_ref()
            .map(|table| {
                varied_metric(
                    font,
                    coords,
                    f64::from(table.y_strikeout_position()),
                    *b"stro",
                )
            })
            .transpose()?,
        strikeout_thickness: os2
            .as_ref()
            .map(|table| varied_metric(font, coords, f64::from(table.y_strikeout_size()), *b"strs"))
            .transpose()?,
    })
}

/// Use the first strictly decodable Unicode ID 16, then ID 1, in record order.
fn family_name(font: &FontRef<'_>) -> Result<Option<String>, BoundtextError> {
    if !has_table(font, *b"name") {
        return Ok(None);
    }
    let name = font.name().map_err(|_| invalid_table("name"))?;
    let storage = name
        .offset_data()
        .as_bytes()
        .get(usize::from(name.storage_offset())..)
        .ok_or_else(|| invalid_table("name"))?;
    let mut ordinary = None;
    let mut typographic = None;
    for record in name.name_record() {
        let start = record.string_offset().to_u32() as usize;
        let end = start
            .checked_add(usize::from(record.length()))
            .ok_or_else(|| invalid_table("name"))?;
        let bytes = storage
            .get(start..end)
            .ok_or_else(|| invalid_table("name"))?;
        if !record.is_unicode() || bytes.len() % 2 != 0 {
            continue;
        }
        let id = record.name_id().to_u16();
        if !((id == 16 && typographic.is_none()) || (id == 1 && ordinary.is_none())) {
            continue;
        }
        let mut text = String::new();
        text.try_reserve(
            bytes
                .len()
                .checked_mul(2)
                .ok_or_else(|| invalid_table("name"))?,
        )
        .map_err(|_| parse_error(FontFailureReason::AllocationFailed, Some("name"), 0))?;
        let mut valid = true;
        for character in char::decode_utf16(
            bytes
                .chunks_exact(2)
                .map(|pair| u16::from_be_bytes([pair[0], pair[1]])),
        ) {
            if let Ok(character) = character {
                text.push(character);
            } else {
                valid = false;
                break;
            }
        }
        if valid {
            if id == 16 {
                typographic = Some(text);
            } else {
                ordinary = Some(text);
            }
        }
    }
    Ok(typographic.or(ordinary))
}

struct SkrifaFace {
    data: Arc<Vec<u8>>,
    font: model::Font,
    metrics: FontMetrics,
    typo_ascender: Option<f64>,
    typo_descender: Option<f64>,
}

impl SkrifaFace {
    fn glyph(&self, glyph_id: u32) -> Result<GlyphId, BoundtextError> {
        if glyph_id >= self.metrics.glyph_count {
            return Err(BoundtextError::FontOutline {
                reason: FontFailureReason::InvalidGlyphId,
                glyph_id,
            });
        }
        Ok(GlyphId::new(glyph_id))
    }
}

impl FontFace for SkrifaFace {
    fn units_per_em(&self) -> u16 {
        self.metrics.units_per_em
    }
    fn glyph_count(&self) -> u32 {
        self.metrics.glyph_count
    }
    fn ascender(&self) -> f64 {
        self.metrics.ascender
    }
    fn descender(&self) -> f64 {
        self.metrics.descender
    }
    fn typographic_ascender(&self) -> Option<f64> {
        self.typo_ascender
    }
    fn typographic_descender(&self) -> Option<f64> {
        self.typo_descender
    }
    fn underline_position(&self) -> Option<f64> {
        self.metrics.underline_position
    }
    fn underline_thickness(&self) -> Option<f64> {
        self.metrics.underline_thickness
    }
    fn strikeout_position(&self) -> Option<f64> {
        self.metrics.strikeout_position
    }
    fn strikeout_thickness(&self) -> Option<f64> {
        self.metrics.strikeout_thickness
    }

    fn glyph_hor_advance(&self, glyph_id: u32) -> Result<Option<f64>, BoundtextError> {
        let glyph = self.glyph(glyph_id)?;
        let font = font_ref(&self.data)?;
        if has_table(&font, *b"HVAR") {
            let metrics = font.hmtx().map_err(|_| invalid_table("hmtx"))?;
            let index = usize::try_from(glyph_id).map_err(|_| invalid_table("hmtx"))?;
            let metric = metrics
                .h_metrics()
                .get(index)
                .or_else(|| metrics.h_metrics().last())
                .ok_or_else(|| invalid_table("hmtx"))?;
            let delta = font
                .hvar()
                .map_err(|_| invalid_table("HVAR"))?
                .advance_delta(glyph, self.font.normalized_coords())
                .ok_or_else(|| invalid_table("HVAR"))?;
            return finite_metric(f64::from(metric.advance()) + delta.to_f64()).map(Some);
        }
        if has_table(&font, *b"gvar") {
            font.gvar()
                .map_err(|_| invalid_table("gvar"))?
                .glyph_variation_data(glyph)
                .map_err(|_| invalid_table("gvar"))?;
        }
        finite_metric(self.font.glyph_metrics().h_advance_exact(glyph).to_f64()).map(Some)
    }

    fn glyph_y_origin(&self, glyph_id: u32) -> Result<Option<f64>, BoundtextError> {
        let glyph = self.glyph(glyph_id)?;
        let font = font_ref(&self.data)?;
        if !has_table(&font, *b"VORG") {
            return Ok(None);
        }
        let mut origin = f64::from(
            font.vorg()
                .map_err(|_| invalid_table("VORG"))?
                .vertical_origin_y(glyph),
        );
        if has_table(&font, *b"VVAR") {
            let vvar = font.vvar().map_err(|_| invalid_table("VVAR"))?;
            if vvar.v_org_mapping().is_some() {
                origin += vvar
                    .v_origin_y_delta(glyph, self.font.normalized_coords())
                    .ok_or_else(|| invalid_table("VVAR"))?
                    .to_f64();
            }
        }
        finite_metric(origin).map(Some)
    }

    fn glyph_ver_side_bearing(&self, glyph_id: u32) -> Result<Option<f64>, BoundtextError> {
        let glyph = self.glyph(glyph_id)?;
        let font = font_ref(&self.data)?;
        if !has_table(&font, *b"vmtx") {
            return Ok(None);
        }
        let vmtx = font.vmtx().map_err(|_| invalid_table("vmtx"))?;
        let index = usize::try_from(glyph_id).map_err(|_| invalid_table("vmtx"))?;
        let mut bearing = if let Some(metric) = vmtx.v_metrics().get(index) {
            f64::from(metric.side_bearing())
        } else {
            f64::from(
                vmtx.top_side_bearings()
                    .get(index - vmtx.v_metrics().len())
                    .ok_or_else(|| invalid_table("vmtx"))?
                    .get(),
            )
        };
        if has_table(&font, *b"VVAR") {
            let vvar = font.vvar().map_err(|_| invalid_table("VVAR"))?;
            if vvar.tsb_mapping().is_some() {
                bearing += vvar
                    .tsb_delta(glyph, self.font.normalized_coords())
                    .ok_or_else(|| invalid_table("VVAR"))?
                    .to_f64();
            }
        }
        finite_metric(bearing).map(Some)
    }

    fn outline_glyph(
        &self,
        glyph_id: u32,
        builder: &mut dyn OutlineBuilder,
    ) -> Result<Option<GlyphBBox>, BoundtextError> {
        let glyph = self.glyph(glyph_id)?;
        let font = font_ref(&self.data)?;
        if has_table(&font, *b"gvar") {
            font.gvar()
                .map_err(|_| invalid_table("gvar"))?
                .glyph_variation_data(glyph)
                .map_err(|_| BoundtextError::FontOutline {
                    reason: FontFailureReason::DrawingFailed,
                    glyph_id,
                })?;
        }
        let outline = font
            .outline_glyphs()
            .get(glyph)
            .ok_or(BoundtextError::FontOutline {
                reason: FontFailureReason::DrawingFailed,
                glyph_id,
            })?;
        let mut memory = Vec::new();
        let memory_size = outline.draw_memory_size(Hinting::None);
        memory
            .try_reserve_exact(memory_size)
            .map_err(|_| BoundtextError::FontOutline {
                reason: FontFailureReason::AllocationFailed,
                glyph_id,
            })?;
        memory.resize(memory_size, 0);
        let settings = DrawSettings::unhinted(
            Size::unscaled(),
            LocationRef::new(self.font.normalized_coords()),
        )
        .with_path_style(PathStyle::HarfBuzz)
        .with_memory(Some(&mut memory));
        let mut pen = BoundsPen {
            builder,
            bounds: None,
            finite: true,
        };
        outline
            .draw(settings, &mut pen)
            .map_err(|_| BoundtextError::FontOutline {
                reason: FontFailureReason::DrawingFailed,
                glyph_id,
            })?;
        if !pen.finite {
            return Err(BoundtextError::FontOutline {
                reason: FontFailureReason::NonFiniteMetric,
                glyph_id,
            });
        }
        Ok(pen.bounds)
    }
}

struct BoundsPen<'a> {
    builder: &'a mut dyn OutlineBuilder,
    bounds: Option<GlyphBBox>,
    finite: bool,
}

impl BoundsPen<'_> {
    fn point(&mut self, x: f32, y: f32) {
        if !x.is_finite() || !y.is_finite() {
            self.finite = false;
            return;
        }
        let (x, y) = (f64::from(x), f64::from(y));
        if let Some(bounds) = &mut self.bounds {
            bounds.x_min = bounds.x_min.min(x);
            bounds.x_max = bounds.x_max.max(x);
            bounds.y_min = bounds.y_min.min(y);
            bounds.y_max = bounds.y_max.max(y);
        } else {
            self.bounds = Some(GlyphBBox {
                x_min: x,
                y_min: y,
                x_max: x,
                y_max: y,
            });
        }
    }
}

impl OutlinePen for BoundsPen<'_> {
    fn move_to(&mut self, x: f32, y: f32) {
        self.point(x, y);
        if self.finite {
            self.builder.move_to(x, y);
        }
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.point(x, y);
        if self.finite {
            self.builder.line_to(x, y);
        }
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        self.point(x1, y1);
        self.point(x, y);
        if self.finite {
            self.builder.quad_to(x1, y1, x, y);
        }
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.point(x1, y1);
        self.point(x2, y2);
        self.point(x, y);
        if self.finite {
            self.builder.curve_to(x1, y1, x2, y2, x, y);
        }
    }
    fn close(&mut self) {
        if self.finite {
            self.builder.close();
        }
    }
}
