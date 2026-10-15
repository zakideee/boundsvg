//! Admit the OpenType tables shared by the metric, shaping, and raster paths.

use std::collections::HashSet;

use read_fonts::tables::{gpos, gsub, layout::Lookup};
use read_fonts::{FontData, FontRead, FontRef, TableProvider, types::Tag};

use crate::error::{BoundtextError, FontFailureReason};

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum VisitKind {
    Directory,
    SubstitutionLookup,
    PositionLookup,
    SubstitutionSubtable(u16),
    PositionSubtable(u16),
    CharacterSubtable,
    LocationOffsets(bool),
    VariationStore,
    VariationData,
    GlyphVariationOffsets,
}

#[derive(Default)]
struct Admission {
    visited: HashSet<(usize, VisitKind)>,
}

impl Admission {
    fn visit(
        &mut self,
        data: FontData<'_>,
        kind: VisitKind,
        face_index: u32,
        table: Option<&'static str>,
    ) -> Result<bool, BoundtextError> {
        let key = (data.as_bytes().as_ptr() as usize, kind);
        if self.visited.contains(&key) {
            return Ok(false);
        }
        self.visited
            .try_reserve(1)
            .map_err(|_| parse_error(FontFailureReason::AllocationFailed, table, face_index))?;
        self.visited.insert(key);
        Ok(true)
    }
}

/// Construct a font-admission diagnostic without retaining source font bytes.
pub(crate) fn parse_error(
    reason: FontFailureReason,
    table: Option<&'static str>,
    face_index: u32,
) -> BoundtextError {
    BoundtextError::FontParse {
        reason,
        table,
        face_index,
    }
}

/// Distinguish an absent OpenType table from a present table that fails parsing.
pub(crate) fn has_table(font: &FontRef<'_>, tag: [u8; 4]) -> bool {
    font.table_directory()
        .table_records()
        .iter()
        .any(|record| record.tag() == Tag::new(&tag))
}

/// Validate each distinct face before it enters a shaping or raster font database.
///
/// Unknown tables are ignored. Lookup visits are keyed by target and expected
/// type, so shared references do not multiply traversal work or bypass parsing.
///
/// # Errors
///
/// Return a structured font error for an invalid container, required table,
/// metric table, variation axis, or GSUB/GPOS lookup reference.
pub fn validate_font_collection(data: &[u8]) -> Result<(), BoundtextError> {
    let file = read_fonts::FileRef::new(data)
        .map_err(|_| parse_error(FontFailureReason::InvalidData, None, 0))?;
    let mut admission = Admission::default();
    let mut face_count = 0usize;
    for (face_number, face) in file.fonts().enumerate() {
        let face_index = u32::try_from(face_number)
            .map_err(|_| parse_error(FontFailureReason::InvalidData, None, 0))?;
        let font =
            face.map_err(|_| parse_error(FontFailureReason::InvalidData, None, face_index))?;
        face_count += 1;
        if !admission.visit(
            font.table_directory().offset_data(),
            VisitKind::Directory,
            face_index,
            None,
        )? {
            continue;
        }
        validate_face(&font, face_index, &mut admission)?;
    }
    if face_count == 0 {
        return Err(parse_error(FontFailureReason::InvalidData, None, 0));
    }
    Ok(())
}

fn validate_face(
    font: &FontRef<'_>,
    face_index: u32,
    admission: &mut Admission,
) -> Result<(), BoundtextError> {
    let invalid = |table| parse_error(FontFailureReason::InvalidTable, Some(table), face_index);
    let head = font.head().map_err(|_| invalid("head"))?;
    if !(16..=16384).contains(&head.units_per_em()) {
        return Err(parse_error(
            FontFailureReason::InvalidUnitsPerEm,
            Some("head"),
            face_index,
        ));
    }
    let maxp = font.maxp().map_err(|_| invalid("maxp"))?;
    let glyph_count = maxp.num_glyphs();
    if glyph_count == 0 {
        return Err(parse_error(
            FontFailureReason::InvalidGlyphCount,
            Some("maxp"),
            face_index,
        ));
    }
    let hhea = font.hhea().map_err(|_| invalid("hhea"))?;
    let hmtx = font.hmtx().map_err(|_| invalid("hmtx"))?;
    let horizontal_count = hhea.number_of_h_metrics();
    if horizontal_count == 0
        || horizontal_count > glyph_count
        || hmtx.h_metrics().len() != usize::from(horizontal_count)
        || hmtx.left_side_bearings().len() < usize::from(glyph_count - horizontal_count)
    {
        return Err(invalid("hmtx"));
    }
    macro_rules! check_optional {
        ($tag:expr, $method:ident, $label:literal) => {
            if has_table(font, $tag) {
                font.$method().map_err(|_| invalid($label))?;
            }
        };
    }
    check_optional!(*b"OS/2", os2, "OS/2");
    check_optional!(*b"post", post, "post");
    check_optional!(*b"name", name, "name");
    check_optional!(*b"cmap", cmap, "cmap");
    check_optional!(*b"VORG", vorg, "VORG");
    check_optional!(*b"avar", avar, "avar");
    check_optional!(*b"gvar", gvar, "gvar");
    check_optional!(*b"HVAR", hvar, "HVAR");
    check_optional!(*b"VVAR", vvar, "VVAR");
    check_optional!(*b"MVAR", mvar, "MVAR");
    if has_table(font, *b"fvar") {
        let fvar = font.fvar().map_err(|_| invalid("fvar"))?;
        let axes = fvar.axes().map_err(|_| invalid("fvar"))?;
        if axes.iter().any(|axis| {
            axis.min_value() > axis.default_value() || axis.default_value() > axis.max_value()
        }) {
            return Err(parse_error(
                FontFailureReason::InvalidVariationAxis,
                Some("fvar"),
                face_index,
            ));
        }
    }
    if has_table(font, *b"vhea") || has_table(font, *b"vmtx") {
        let vhea = font.vhea().map_err(|_| invalid("vhea"))?;
        let vmtx = font.vmtx().map_err(|_| invalid("vmtx"))?;
        let vertical_count = vhea.number_of_long_ver_metrics();
        if vertical_count == 0
            || vertical_count > glyph_count
            || vmtx.v_metrics().len() != usize::from(vertical_count)
            || vmtx.top_side_bearings().len() < usize::from(glyph_count - vertical_count)
        {
            return Err(invalid("vmtx"));
        }
    }
    if has_table(font, *b"glyf") {
        let glyf = font.glyf().map_err(|_| invalid("glyf"))?;
        let loca = font
            .loca(Some(head.index_to_loc_format() == 1))
            .map_err(|_| invalid("loca"))?;
        if !matches!(head.index_to_loc_format(), 0 | 1)
            || loca.len() < usize::from(glyph_count)
            || loca.get_raw(usize::from(glyph_count)).is_none_or(|offset| {
                usize::try_from(offset)
                    .ok()
                    .is_none_or(|end| end > glyf.offset_data().len())
            })
        {
            return Err(invalid("loca"));
        }
        let location_data = font
            .table_data(Tag::new(b"loca"))
            .ok_or_else(|| invalid("loca"))?;
        if admission.visit(
            location_data,
            VisitKind::LocationOffsets(head.index_to_loc_format() == 1),
            face_index,
            Some("loca"),
        )? && !loca.all_offsets_are_ascending()
        {
            return Err(invalid("loca"));
        }
    } else if has_table(font, *b"CFF ") {
        font.cff().map_err(|_| invalid("CFF "))?;
    } else if has_table(font, *b"CFF2") {
        font.cff2().map_err(|_| invalid("CFF2"))?;
    } else {
        return Err(parse_error(FontFailureReason::NoOutlines, None, face_index));
    }
    validate_references(font, admission, face_index)?;
    if has_table(font, *b"GSUB") {
        let table = font.gsub().map_err(|_| invalid("GSUB"))?;
        let lookups = table.lookup_list().map_err(|_| invalid("GSUB"))?;
        for index in 0..lookups.lookup_offsets().len() {
            let offset = lookups.lookup_offsets()[index].get().to_u32() as usize;
            if offset == 0 {
                return Err(invalid("GSUB"));
            }
            let target = lookups
                .offset_data()
                .slice(offset..)
                .ok_or_else(|| invalid("GSUB"))?;
            if !admission.visit(
                target,
                VisitKind::SubstitutionLookup,
                face_index,
                Some("GSUB"),
            )? {
                continue;
            }
            let lookup = lookups.lookups().get(index).map_err(|_| invalid("GSUB"))?;
            validate_substitution(lookup, admission, face_index)?;
        }
    }
    if has_table(font, *b"GPOS") {
        let table = font.gpos().map_err(|_| invalid("GPOS"))?;
        let lookups = table.lookup_list().map_err(|_| invalid("GPOS"))?;
        for index in 0..lookups.lookup_offsets().len() {
            let offset = lookups.lookup_offsets()[index].get().to_u32() as usize;
            if offset == 0 {
                return Err(invalid("GPOS"));
            }
            let target = lookups
                .offset_data()
                .slice(offset..)
                .ok_or_else(|| invalid("GPOS"))?;
            if !admission.visit(target, VisitKind::PositionLookup, face_index, Some("GPOS"))? {
                continue;
            }
            let lookup = lookups.lookups().get(index).map_err(|_| invalid("GPOS"))?;
            validate_position(lookup, admission, face_index)?;
        }
    }
    Ok(())
}

fn validate_references(
    font: &FontRef<'_>,
    admission: &mut Admission,
    face_index: u32,
) -> Result<(), BoundtextError> {
    let invalid = |table| parse_error(FontFailureReason::InvalidTable, Some(table), face_index);
    if has_table(font, *b"name") {
        let name = font.name().map_err(|_| invalid("name"))?;
        if name.version() > 1 || usize::from(name.storage_offset()) > name.offset_data().len() {
            return Err(invalid("name"));
        }
        for record in name.name_record() {
            record
                .string(name.string_data())
                .map_err(|_| invalid("name"))?;
        }
        for record in name.lang_tag_record().into_iter().flatten() {
            record
                .lang_tag(name.string_data())
                .map_err(|_| invalid("name"))?;
        }
    }
    if has_table(font, *b"cmap") {
        let cmap = font.cmap().map_err(|_| invalid("cmap"))?;
        for record in cmap.encoding_records() {
            let offset = record.subtable_offset().to_u32() as usize;
            let data = cmap
                .offset_data()
                .slice(offset..)
                .filter(|_| offset != 0)
                .ok_or_else(|| invalid("cmap"))?;
            if admission.visit(data, VisitKind::CharacterSubtable, face_index, Some("cmap"))? {
                record
                    .subtable(cmap.offset_data())
                    .map_err(|_| invalid("cmap"))?;
            }
        }
    }
    if has_table(font, *b"avar") {
        let avar = font.avar().map_err(|_| invalid("avar"))?;
        for segment in avar.axis_segment_maps().iter() {
            segment.map_err(|_| invalid("avar"))?;
        }
    }
    if has_table(font, *b"gvar") {
        let gvar = font.gvar().map_err(|_| invalid("gvar"))?;
        gvar.shared_tuples().map_err(|_| invalid("gvar"))?;
        if admission.visit(
            gvar.offset_data(),
            VisitKind::GlyphVariationOffsets,
            face_index,
            Some("gvar"),
        )? {
            let mut previous = 0;
            for offset in gvar.glyph_variation_data_offsets().iter() {
                let offset = offset.map_err(|_| invalid("gvar"))?.get();
                if offset < previous {
                    return Err(invalid("gvar"));
                }
                previous = offset;
            }
            gvar.glyph_variation_data_for_range(0..previous as usize)
                .map_err(|_| invalid("gvar"))?;
        }
    }
    if has_table(font, *b"HVAR") {
        let table = font.hvar().map_err(|_| invalid("HVAR"))?;
        validate_variation_store(
            &table.item_variation_store().map_err(|_| invalid("HVAR"))?,
            admission,
            face_index,
            "HVAR",
        )?;
        table
            .advance_width_mapping()
            .transpose()
            .map_err(|_| invalid("HVAR"))?;
        table
            .lsb_mapping()
            .transpose()
            .map_err(|_| invalid("HVAR"))?;
        table
            .rsb_mapping()
            .transpose()
            .map_err(|_| invalid("HVAR"))?;
    }
    if has_table(font, *b"VVAR") {
        let table = font.vvar().map_err(|_| invalid("VVAR"))?;
        validate_variation_store(
            &table.item_variation_store().map_err(|_| invalid("VVAR"))?,
            admission,
            face_index,
            "VVAR",
        )?;
        table
            .advance_height_mapping()
            .transpose()
            .map_err(|_| invalid("VVAR"))?;
        table
            .tsb_mapping()
            .transpose()
            .map_err(|_| invalid("VVAR"))?;
        table
            .bsb_mapping()
            .transpose()
            .map_err(|_| invalid("VVAR"))?;
        table
            .v_org_mapping()
            .transpose()
            .map_err(|_| invalid("VVAR"))?;
    }
    if has_table(font, *b"MVAR") {
        let table = font.mvar().map_err(|_| invalid("MVAR"))?;
        if let Some(store) = table.item_variation_store() {
            validate_variation_store(
                &store.map_err(|_| invalid("MVAR"))?,
                admission,
                face_index,
                "MVAR",
            )?;
        } else if !table.value_records().is_empty() {
            return Err(invalid("MVAR"));
        }
    }
    Ok(())
}

fn validate_variation_store(
    store: &read_fonts::tables::variations::ItemVariationStore<'_>,
    admission: &mut Admission,
    face_index: u32,
    table: &'static str,
) -> Result<(), BoundtextError> {
    let invalid = || parse_error(FontFailureReason::InvalidTable, Some(table), face_index);
    if !admission.visit(
        store.offset_data(),
        VisitKind::VariationStore,
        face_index,
        Some(table),
    )? {
        return Ok(());
    }
    let regions = store.variation_region_list().map_err(|_| invalid())?;
    for data in store.item_variation_data().iter().flatten() {
        let data = data.map_err(|_| invalid())?;
        if admission.visit(
            data.offset_data(),
            VisitKind::VariationData,
            face_index,
            Some(table),
        )? && data
            .region_indexes()
            .iter()
            .any(|index| index.get() >= regions.region_count())
        {
            return Err(invalid());
        }
    }
    Ok(())
}

fn validate_lookup<'a, T: FontRead<'a, Args = ()>>(
    lookup: &Lookup<'a, T>,
    admission: &mut Admission,
    face_index: u32,
    is_position: bool,
) -> Result<(), BoundtextError> {
    let table = if is_position { "GPOS" } else { "GSUB" };
    for index in 0..lookup.subtable_offsets().len() {
        let offset = lookup.subtable_offsets()[index].get().to_u32() as usize;
        let target = lookup
            .offset_data()
            .slice(offset..)
            .filter(|_| offset != 0)
            .ok_or_else(|| parse_error(FontFailureReason::InvalidTable, Some(table), face_index))?;
        let kind = if is_position {
            VisitKind::PositionSubtable(lookup.lookup_type())
        } else {
            VisitKind::SubstitutionSubtable(lookup.lookup_type())
        };
        if admission.visit(target, kind, face_index, Some(table))? {
            lookup.subtables().get(index).map_err(|_| {
                parse_error(FontFailureReason::InvalidTable, Some(table), face_index)
            })?;
        }
    }
    Ok(())
}

fn validate_substitution(
    lookup: gsub::SubstitutionLookup<'_>,
    admission: &mut Admission,
    face_index: u32,
) -> Result<(), BoundtextError> {
    macro_rules! ordinary {
        ($lookup:expr) => {
            validate_lookup(&$lookup, admission, face_index, false)
        };
    }
    match lookup {
        gsub::SubstitutionLookup::Single(lookup) => ordinary!(lookup),
        gsub::SubstitutionLookup::Multiple(lookup) => ordinary!(lookup),
        gsub::SubstitutionLookup::Alternate(lookup) => ordinary!(lookup),
        gsub::SubstitutionLookup::Ligature(lookup) => ordinary!(lookup),
        gsub::SubstitutionLookup::Contextual(lookup) => ordinary!(lookup),
        gsub::SubstitutionLookup::ChainContextual(lookup) => ordinary!(lookup),
        gsub::SubstitutionLookup::Reverse(lookup) => ordinary!(lookup),
        gsub::SubstitutionLookup::Extension(lookup) => {
            let mut expected_type = None;
            macro_rules! extension {
                ($subtable:expr) => {{
                    let subtable = $subtable;
                    let kind = subtable.extension_lookup_type();
                    if expected_type.is_some_and(|expected| expected != kind)
                        || subtable.subst_format() != 1
                    {
                        return Err(parse_error(
                            FontFailureReason::InvalidTable,
                            Some("GSUB"),
                            face_index,
                        ));
                    }
                    expected_type = Some(kind);
                    let offset = subtable.extension_offset().to_u32() as usize;
                    let target = subtable
                        .offset_data()
                        .slice(offset..)
                        .filter(|_| offset != 0)
                        .ok_or_else(|| {
                            parse_error(FontFailureReason::InvalidTable, Some("GSUB"), face_index)
                        })?;
                    if admission.visit(
                        target,
                        VisitKind::SubstitutionSubtable(kind),
                        face_index,
                        Some("GSUB"),
                    )? {
                        subtable.extension().map_err(|_| {
                            parse_error(FontFailureReason::InvalidTable, Some("GSUB"), face_index)
                        })?;
                    }
                }};
            }
            for index in 0..lookup.subtable_offsets().len() {
                if lookup.subtable_offsets()[index].get().to_u32() == 0 {
                    return Err(parse_error(
                        FontFailureReason::InvalidTable,
                        Some("GSUB"),
                        face_index,
                    ));
                }
                match lookup.subtables().get(index).map_err(|_| {
                    parse_error(FontFailureReason::InvalidTable, Some("GSUB"), face_index)
                })? {
                    gsub::ExtensionSubtable::Single(subtable) => extension!(subtable),
                    gsub::ExtensionSubtable::Multiple(subtable) => extension!(subtable),
                    gsub::ExtensionSubtable::Alternate(subtable) => extension!(subtable),
                    gsub::ExtensionSubtable::Ligature(subtable) => extension!(subtable),
                    gsub::ExtensionSubtable::Contextual(subtable) => extension!(subtable),
                    gsub::ExtensionSubtable::ChainContextual(subtable) => extension!(subtable),
                    gsub::ExtensionSubtable::Reverse(subtable) => extension!(subtable),
                }
            }
            Ok(())
        }
    }
}

fn validate_position(
    lookup: gpos::PositionLookup<'_>,
    admission: &mut Admission,
    face_index: u32,
) -> Result<(), BoundtextError> {
    macro_rules! ordinary {
        ($lookup:expr) => {
            validate_lookup(&$lookup, admission, face_index, true)
        };
    }
    match lookup {
        gpos::PositionLookup::Single(lookup) => ordinary!(lookup),
        gpos::PositionLookup::Pair(lookup) => ordinary!(lookup),
        gpos::PositionLookup::Cursive(lookup) => ordinary!(lookup),
        gpos::PositionLookup::MarkToBase(lookup) => ordinary!(lookup),
        gpos::PositionLookup::MarkToLig(lookup) => ordinary!(lookup),
        gpos::PositionLookup::MarkToMark(lookup) => ordinary!(lookup),
        gpos::PositionLookup::Contextual(lookup) => ordinary!(lookup),
        gpos::PositionLookup::ChainContextual(lookup) => ordinary!(lookup),
        gpos::PositionLookup::Extension(lookup) => {
            let mut expected_type = None;
            macro_rules! extension {
                ($subtable:expr) => {{
                    let subtable = $subtable;
                    let kind = subtable.extension_lookup_type();
                    if expected_type.is_some_and(|expected| expected != kind)
                        || subtable.pos_format() != 1
                    {
                        return Err(parse_error(
                            FontFailureReason::InvalidTable,
                            Some("GPOS"),
                            face_index,
                        ));
                    }
                    expected_type = Some(kind);
                    let offset = subtable.extension_offset().to_u32() as usize;
                    let target = subtable
                        .offset_data()
                        .slice(offset..)
                        .filter(|_| offset != 0)
                        .ok_or_else(|| {
                            parse_error(FontFailureReason::InvalidTable, Some("GPOS"), face_index)
                        })?;
                    if admission.visit(
                        target,
                        VisitKind::PositionSubtable(kind),
                        face_index,
                        Some("GPOS"),
                    )? {
                        subtable.extension().map_err(|_| {
                            parse_error(FontFailureReason::InvalidTable, Some("GPOS"), face_index)
                        })?;
                    }
                }};
            }
            for index in 0..lookup.subtable_offsets().len() {
                if lookup.subtable_offsets()[index].get().to_u32() == 0 {
                    return Err(parse_error(
                        FontFailureReason::InvalidTable,
                        Some("GPOS"),
                        face_index,
                    ));
                }
                match lookup.subtables().get(index).map_err(|_| {
                    parse_error(FontFailureReason::InvalidTable, Some("GPOS"), face_index)
                })? {
                    gpos::ExtensionSubtable::Single(subtable) => extension!(subtable),
                    gpos::ExtensionSubtable::Pair(subtable) => extension!(subtable),
                    gpos::ExtensionSubtable::Cursive(subtable) => extension!(subtable),
                    gpos::ExtensionSubtable::MarkToBase(subtable) => extension!(subtable),
                    gpos::ExtensionSubtable::MarkToLig(subtable) => extension!(subtable),
                    gpos::ExtensionSubtable::MarkToMark(subtable) => extension!(subtable),
                    gpos::ExtensionSubtable::Contextual(subtable) => extension!(subtable),
                    gpos::ExtensionSubtable::ChainContextual(subtable) => extension!(subtable),
                }
            }
            Ok(())
        }
    }
}
