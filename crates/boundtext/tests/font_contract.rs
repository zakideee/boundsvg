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

#[test]
fn finite_authored_inputs_cannot_return_nonfinite_scaled_glyphs() {
    use boundtext::font::{FontRegistry, FontStyle, shaping};

    let mut registry = FontRegistry::new();
    registry
        .register(
            STATIC_FONT.to_vec(),
            "Static".to_string(),
            400,
            FontStyle::Normal,
        )
        .unwrap();
    let entry = registry.resolve("Static", 400, &FontStyle::Normal).unwrap();
    for writing_mode in [None, Some("vertical-rl".to_string())] {
        let options = shaping::ShapeOptions {
            writing_mode,
            ..Default::default()
        };
        assert_eq!(
            shaping::shape_text_with_options(&registry, entry, "AA", f64::MAX, f64::MAX, &options,)
                .unwrap_err(),
            BoundtextError::TextShaping {
                reason: FontFailureReason::NonFiniteMetric,
            }
        );
    }
    let recovered = shaping::shape_text_with_options(
        &registry,
        entry,
        "A",
        20.0,
        0.0,
        &shaping::ShapeOptions::default(),
    )
    .unwrap();
    assert_eq!(recovered[0].x_advance, 12.0);
}

#[test]
fn unresolved_fallback_is_distinct_from_empty_text_with_a_registered_font() {
    use boundtext::font::{FontContext, FontRegistry, FontStyle, shaping};

    let mut registry = FontRegistry::new();
    let families = vec!["Available".to_string()];
    for text in ["A", ""] {
        let context = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        assert_eq!(
            shaping::shape_with_fallback_and_options(
                &context,
                text,
                20.0,
                0.0,
                &shaping::ShapeOptions::default(),
            )
            .unwrap_err(),
            BoundtextError::FontUnavailable { weight: 400 },
        );
    }
    registry
        .register(
            STATIC_FONT.to_vec(),
            "Available".to_string(),
            400,
            FontStyle::Normal,
        )
        .unwrap();
    let context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let empty = shaping::shape_with_fallback_and_options(
        &context,
        "",
        20.0,
        0.0,
        &shaping::ShapeOptions::default(),
    )
    .unwrap();
    assert!(empty.glyphs.is_empty());
    let recovered = shaping::shape_with_fallback_and_options(
        &context,
        "A",
        20.0,
        0.0,
        &shaping::ShapeOptions::default(),
    )
    .unwrap();
    assert_eq!(recovered.glyphs.len(), 1);
}

#[test]
fn admission_proof_is_tied_to_immutable_bytes_and_cannot_admit_another_font() {
    let mut data = Arc::new(STATIC_FONT.to_vec());
    let (_, proof) = SkrifaBackend
        .parse_metrics_with_admission(Arc::clone(&data))
        .unwrap();
    let proof = proof.unwrap();
    assert!(proof.matches_data(&data));
    assert!(Arc::get_mut(&mut data).is_none());
    let face = HarfRustShaper
        .create_face_with_admission(Arc::clone(&data), Some(&proof))
        .unwrap();
    assert_eq!(
        face.shape("A", ShapeDirection::Horizontal, None, &[], &[])
            .unwrap()
            .len(),
        1
    );

    // Author a parseable head with invalid units so the upstream constructor alone is insufficient.
    let table_count = usize::from(u16::from_be_bytes([STATIC_FONT[4], STATIC_FONT[5]]));
    let record = STATIC_FONT[12..]
        .chunks_exact(16)
        .take(table_count)
        .find(|record| &record[..4] == b"head")
        .unwrap();
    let offset = u32::from_be_bytes(record[8..12].try_into().unwrap()) as usize;
    Arc::make_mut(&mut data)[offset + 18..offset + 20].copy_from_slice(&15u16.to_be_bytes());
    assert!(!proof.matches_data(&data));
    let shared: Arc<dyn AsRef<[u8]> + Send + Sync> = data.clone();
    assert!(harfrust::Font::new(harfrust::font::Blob::Shared(shared), 0).is_some());
    for candidate_proof in [None, Some(&proof)] {
        assert!(matches!(
            SkrifaBackend.create_face_with_admission(Arc::clone(&data), &[], candidate_proof),
            Err(BoundtextError::FontParse {
                reason: FontFailureReason::InvalidUnitsPerEm,
                ..
            })
        ));
        assert!(matches!(
            HarfRustShaper.create_face_with_admission(Arc::clone(&data), candidate_proof),
            Err(BoundtextError::FontParse {
                reason: FontFailureReason::InvalidUnitsPerEm,
                ..
            })
        ));
    }
}

/// Build two collection faces sharing table bytes, with a shorter second GSUB view.
fn collection_with_shared_gsub(
    shorten_second: bool,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let original = include_bytes!("../../../fixtures/fonts/ContextualArabicTest.ttf");
    let table_count = usize::from(u16::from_be_bytes([original[4], original[5]]));
    let directory_length = 12 + 16 * table_count;
    let second_offset = (20 + original.len() + 3) & !3;
    let mut collection = b"ttcf".to_vec();
    collection.extend(0x0001_0000_u32.to_be_bytes());
    collection.extend(2_u32.to_be_bytes());
    collection.extend(20_u32.to_be_bytes());
    collection.extend(u32::try_from(second_offset)?.to_be_bytes());
    collection.extend(original);
    collection.resize(second_offset, 0);
    collection.extend(&original[..directory_length]);
    for (face_index, directory_offset) in [20, second_offset].into_iter().enumerate() {
        for record_index in 0..table_count {
            let record_offset = directory_offset + 12 + 16 * record_index;
            let offset =
                u32::from_be_bytes(collection[record_offset + 8..record_offset + 12].try_into()?);
            collection[record_offset + 8..record_offset + 12]
                .copy_from_slice(&(offset + 20).to_be_bytes());
            if shorten_second
                && face_index == 1
                && &collection[record_offset..record_offset + 4] == b"GSUB"
            {
                let table_offset = usize::try_from(offset + 20)?;
                let lookup_list_offset = usize::from(u16::from_be_bytes(
                    collection[table_offset + 8..table_offset + 10].try_into()?,
                ));
                let lookup_count = usize::from(u16::from_be_bytes(
                    collection
                        [table_offset + lookup_list_offset..table_offset + lookup_list_offset + 2]
                        .try_into()?,
                ));
                let offsets_start = table_offset + lookup_list_offset + 2;
                let last_lookup_offset = collection
                    [offsets_start..offsets_start + 2 * lookup_count]
                    .chunks_exact(2)
                    .map(|bytes| usize::from(u16::from_be_bytes([bytes[0], bytes[1]])))
                    .max()
                    .ok_or("original fixture contains at least one GSUB lookup")?;
                let short_length = u32::try_from(lookup_list_offset + last_lookup_offset + 2)?;
                collection[record_offset + 12..record_offset + 16]
                    .copy_from_slice(&short_length.to_be_bytes());
            }
        }
    }
    Ok(collection)
}

#[test]
fn collection_shared_tables_keep_their_individual_bounded_views()
-> Result<(), Box<dyn std::error::Error>> {
    boundtext::font::validate_font_collection(&collection_with_shared_gsub(false)?)?;
    let admission_result =
        boundtext::font::validate_font_collection(&collection_with_shared_gsub(true)?);
    assert!(
        matches!(
            admission_result,
            Err(BoundtextError::FontParse {
                reason: FontFailureReason::InvalidTable,
                table: Some("GSUB"),
                face_index: 1,
            })
        ),
        "{admission_result:?}"
    );
    Ok(())
}
