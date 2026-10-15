//! Independent geometry and boundary contracts for the released font backends.

#![cfg(all(feature = "skrifa-backend", feature = "harfrust-backend"))]

use std::{collections::BTreeMap, sync::Arc};

use boundtext::{
    BoundtextError,
    error::FontFailureReason,
    font::{
        backend::{FontBackend, ShapeDirection, ShapeVariation, Shaper},
        backend_harfrust::HarfRustShaper,
        backend_skrifa::SkrifaBackend,
    },
};
use read_fonts::{FontRef, TableProvider};

/// Original static TrueType fixture with an outlined A and an empty space.
const STATIC_FONT: &[u8] = include_bytes!("../../../fixtures/fonts/only-a.ttf");
/// Original variable TrueType fixture with independent outline and metric deltas.
const VARIABLE_FONT: &[u8] = include_bytes!("../../../fixtures/fonts/only-a-variable.ttf");

/// Assemble a valid maximum-count font from original, independently authored tables.
fn maximum_font(variable: bool) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let source = FontRef::new(if variable { VARIABLE_FONT } else { STATIC_FONT })?;
    let mut tables: BTreeMap<[u8; 4], Vec<u8>> = source
        .table_directory()
        .table_records()
        .iter()
        .map(|record| {
            Ok((
                record.tag().to_be_bytes(),
                source
                    .table_data(record.tag())
                    .ok_or("missing fixture table")?
                    .as_bytes()
                    .to_vec(),
            ))
        })
        .collect::<Result<_, Box<dyn std::error::Error>>>()?;
    tables.get_mut(b"maxp").ok_or("missing fixture table")?[4..6]
        .copy_from_slice(&u16::MAX.to_be_bytes());
    tables.get_mut(b"head").ok_or("missing fixture table")?[50..52]
        .copy_from_slice(&1_i16.to_be_bytes());
    tables.get_mut(b"head").ok_or("missing fixture table")?[8..12].fill(0);
    for (header, metrics) in [(b"hhea", b"hmtx"), (b"vhea", b"vmtx")] {
        tables.get_mut(header).ok_or("missing fixture table")?[34..36]
            .copy_from_slice(&1_u16.to_be_bytes());
        let first = tables[metrics][..4].to_vec();
        let mut values = vec![0; 4 + 2 * (usize::from(u16::MAX) - 1)];
        values[..4].copy_from_slice(&first);
        tables.insert(*metrics, values);
    }
    let glyph_bytes = tables[b"glyf"].len();
    let mut locations = vec![0; 4 * (usize::from(u16::MAX) + 1)];
    locations[4 * usize::from(u16::MAX)..]
        .copy_from_slice(&u32::try_from(glyph_bytes)?.to_be_bytes());
    tables.insert(*b"loca", locations);
    let mut cmap = vec![0, 0, 0, 1, 0, 3, 0, 10, 0, 0, 0, 12, 0, 12, 0, 0];
    for value in [40_u32, 0, 2, 32, 32, 1, 65, 65, u32::from(u16::MAX) - 1] {
        cmap.extend(value.to_be_bytes());
    }
    tables.insert(*b"cmap", cmap);
    if variable {
        let gvar = source.gvar()?;
        let start = gvar.glyph_variation_data_offsets().get(2)?.get();
        let end = gvar.glyph_variation_data_offsets().get(3)?.get();
        let glyph_variation = gvar.glyph_variation_data_for_range(start as usize..end as usize)?;
        let shared_start = gvar.shared_tuples_offset().to_u32() as usize;
        let shared_len =
            usize::from(gvar.shared_tuple_count()) * usize::from(gvar.axis_count()) * 2;
        let shared = &gvar.as_bytes()[shared_start..shared_start + shared_len];
        let offset_bytes = 4 * (usize::from(u16::MAX) + 1);
        let mut variations = vec![0, 1, 0, 0];
        variations.extend(gvar.axis_count().to_be_bytes());
        variations.extend(gvar.shared_tuple_count().to_be_bytes());
        variations.extend(u32::try_from(20 + offset_bytes)?.to_be_bytes());
        variations.extend(u16::MAX.to_be_bytes());
        variations.extend(1_u16.to_be_bytes());
        variations.extend(u32::try_from(20 + offset_bytes + shared_len)?.to_be_bytes());
        variations.resize(20 + offset_bytes, 0);
        variations[20 + offset_bytes - 4..]
            .copy_from_slice(&u32::try_from(glyph_variation.len())?.to_be_bytes());
        variations.extend(shared);
        variations.extend(glyph_variation.as_bytes());
        tables.insert(*b"gvar", variations);
        for tag in [b"HVAR", b"VVAR", b"MVAR", b"VORG"] {
            tables.remove(tag);
        }
    }
    encode_font(tables)
}

/// Serialize the fixture table directory with valid checksums.
fn encode_font(tables: BTreeMap<[u8; 4], Vec<u8>>) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let count = u16::try_from(tables.len())?;
    let search_range = (1_u16 << count.ilog2()) * 16;
    let mut bytes = 0x0001_0000_u32.to_be_bytes().to_vec();
    for value in [
        count,
        search_range,
        u16::try_from(count.ilog2())?,
        count * 16 - search_range,
    ] {
        bytes.extend(value.to_be_bytes());
    }
    bytes.resize(12 + tables.len() * 16, 0);
    let mut head_offset = 0;
    for (index, (tag, table)) in tables.into_iter().enumerate() {
        let offset = bytes.len();
        if tag == *b"head" {
            head_offset = offset;
        }
        let mut record = tag.to_vec();
        for value in [
            checksum(&table),
            u32::try_from(offset)?,
            u32::try_from(table.len())?,
        ] {
            record.extend(value.to_be_bytes());
        }
        bytes[12 + index * 16..28 + index * 16].copy_from_slice(&record);
        bytes.extend(table);
        bytes.resize(bytes.len().next_multiple_of(4), 0);
    }
    let adjustment = 0xb1b0_afba_u32.wrapping_sub(checksum(&bytes));
    bytes[head_offset + 8..head_offset + 12].copy_from_slice(&adjustment.to_be_bytes());
    Ok(bytes)
}

fn checksum(bytes: &[u8]) -> u32 {
    bytes.chunks(4).fold(0_u32, |sum, chunk| {
        let mut word = [0; 4];
        word[..chunk.len()].copy_from_slice(chunk);
        sum.wrapping_add(u32::from_be_bytes(word))
    })
}

#[test]
fn maximum_nonempty_glyph_and_varied_fraction_survive_without_wrapping() {
    for variable in [false, true] {
        let data = Arc::new(maximum_font(variable).unwrap());
        let variations = [ShapeVariation {
            tag: *b"wght",
            value: 655.0,
        }];
        let face = SkrifaBackend
            .create_face_shared(data.clone(), &variations)
            .unwrap();
        assert_eq!(face.glyph_count(), 65_535);
        let bbox = face.glyph_bounding_box(65_534).unwrap().unwrap();
        let expected_width = if variable {
            200.0 + 50.0 * 8356.0 / 16384.0
        } else {
            200.0
        };
        assert_eq!(
            [bbox.x_min, bbox.y_min, bbox.x_max, bbox.y_max],
            [0.0, 0.0, expected_width, 300.0]
        );
        assert!(face.glyph_bounding_box(1).unwrap().is_none());
        for glyph_id in [65_535, 65_536, u32::MAX] {
            assert_eq!(
                face.glyph_bounding_box(glyph_id),
                Err(BoundtextError::FontOutline {
                    reason: FontFailureReason::InvalidGlyphId,
                    glyph_id
                })
            );
        }
        let shaper = HarfRustShaper.create_face(data).unwrap();
        let glyphs = shaper
            .shape("A", ShapeDirection::Horizontal, None, &[], &variations)
            .unwrap();
        assert_eq!(glyphs.len(), 1);
        assert_eq!(glyphs[0].glyph_id, 65_534);
    }
}

#[test]
fn varied_metric_queries_keep_fractions_and_leave_registration_at_default() {
    let before = SkrifaBackend.parse_metrics(VARIABLE_FONT).unwrap();
    let face = SkrifaBackend
        .create_face(
            VARIABLE_FONT,
            &[ShapeVariation {
                tag: *b"wght",
                value: 655.0,
            }],
        )
        .unwrap();
    let delta = 50.0 * 8356.0 / 16384.0;
    assert_eq!(face.ascender(), 800.0 + delta);
    assert_eq!(face.glyph_hor_advance(2).unwrap(), Some(600.0 + delta));
    assert_eq!(face.glyph_y_origin(2).unwrap(), Some(950.0 + delta));
    assert_eq!(face.glyph_ver_side_bearing(2).unwrap(), Some(100.0 + delta));
    let after = SkrifaBackend.parse_metrics(VARIABLE_FONT).unwrap();
    assert_eq!([before.ascender, after.ascender], [800.0, 800.0]);
}

#[test]
fn call_specific_state_does_not_leak_and_nonfinite_axes_are_errors() {
    let shaper = HarfRustShaper
        .create_face(Arc::new(VARIABLE_FONT.to_vec()))
        .unwrap();
    let light = [ShapeVariation {
        tag: *b"wght",
        value: 100.0,
    }];
    let bold = [ShapeVariation {
        tag: *b"wght",
        value: 900.0,
    }];
    let run = |variations: &[ShapeVariation]| {
        shaper
            .shape(
                "AA",
                ShapeDirection::Horizontal,
                Some("en"),
                &[],
                variations,
            )
            .unwrap()
    };
    let before = run(&light);
    let different = run(&bold);
    let after = run(&light);
    assert_eq!(
        before
            .iter()
            .map(|glyph| glyph.x_advance)
            .collect::<Vec<_>>(),
        after
            .iter()
            .map(|glyph| glyph.x_advance)
            .collect::<Vec<_>>()
    );
    assert_ne!(before[0].x_advance, different[0].x_advance);
    for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        let variations = [ShapeVariation {
            tag: *b"wght",
            value,
        }];
        assert!(matches!(
            shaper.shape("A", ShapeDirection::Horizontal, None, &[], &variations),
            Err(BoundtextError::TextShaping {
                reason: FontFailureReason::NonFiniteVariation
            })
        ));
        assert!(
            SkrifaBackend
                .create_face(VARIABLE_FONT, &variations)
                .is_err()
        );
    }
    assert_eq!(run(&light)[0].x_advance, before[0].x_advance);
}
