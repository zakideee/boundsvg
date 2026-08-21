use crate::font::shaping::GlyphInfo;

// ---------------------------------------------------------------------------
// Vertical char <-> glyph mapping
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub(super) struct GlyphRange {
    pub(super) start: usize,
    pub(super) end: usize,
}

pub(super) struct VerticalCharMap {
    pub(super) advances: Vec<f64>,
    pub(super) glyph_ranges: Vec<GlyphRange>,
    pub(super) placements: Vec<VerticalCharPlacement>,
    pub(super) glyph_spans: Vec<GlyphCharSpan>,
    pub(super) char_byte_offsets: Vec<u32>,
}

#[derive(Clone)]
pub(super) struct VerticalCharPlacement {
    pub(super) advance: f64,
    pub(super) x_offset: f64,
    pub(super) y_offset: f64,
}

#[derive(Clone)]
pub(super) struct GlyphCharSpan {
    pub(super) start: usize,
    pub(super) end: usize,
}

/// Get the vertical advance for a glyph.
/// Uses |yAdvance| if > 0, otherwise falls back to |xAdvance|.
pub(super) fn glyph_advance_in_vertical(glyph: &GlyphInfo) -> f64 {
    let y = glyph.y_advance.abs();
    if y > 0.0 { y } else { glyph.x_advance.abs() }
}

/// Build byte offset -> character index mapping.
fn build_byte_to_char_index(chars: &[&str]) -> Vec<usize> {
    let total_bytes: usize = chars.iter().map(|c| c.len()).sum();
    let mut map = vec![0usize; total_bytes + 1];
    let mut byte_offset = 0;
    for (i, ch) in chars.iter().enumerate() {
        for j in 0..ch.len() {
            if byte_offset + j < map.len() {
                map[byte_offset + j] = i;
            }
        }
        byte_offset += ch.len();
    }
    map
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "individual char byte lengths are 1-4; accumulated offset fits in u32 for any realistic text"
)]
fn build_char_byte_offsets(chars: &[&str]) -> Vec<u32> {
    let mut offsets = Vec::with_capacity(chars.len() + 1);
    let mut byte_offset = 0u32;
    for ch in chars {
        offsets.push(byte_offset);
        byte_offset += ch.len() as u32;
    }
    offsets.push(byte_offset);
    offsets
}

fn build_glyph_char_spans(
    glyphs: &[GlyphInfo],
    byte_to_char_idx: &[usize],
    char_count: usize,
) -> Vec<GlyphCharSpan> {
    glyphs
        .iter()
        .enumerate()
        .map(|(idx, glyph)| {
            let start = byte_to_char_idx
                .get(glyph.cluster as usize)
                .copied()
                .unwrap_or(0)
                .min(char_count);
            let mut next_cluster = glyph.cluster as usize;
            for next in glyphs.iter().skip(idx + 1) {
                let candidate = next.cluster as usize;
                if candidate > next_cluster {
                    next_cluster = candidate;
                    break;
                }
            }
            let end = if idx + 1 >= glyphs.len() {
                char_count
            } else {
                byte_to_char_idx
                    .get(next_cluster)
                    .copied()
                    .unwrap_or(char_count)
                    .max(start + 1)
                    .min(char_count)
            };
            GlyphCharSpan { start, end }
        })
        .collect()
}

/// Distribute ligature advances evenly across all covered characters.
fn distribute_ligature_advances(
    chars: &[&str],
    glyphs: &[GlyphInfo],
    byte_to_char_idx: &[usize],
    advances: &mut [f64],
    placements: &mut [VerticalCharPlacement],
    has_placement: &mut [bool],
    glyph_ranges: &mut [GlyphRange],
) {
    for gi in 0..glyphs.len() {
        let glyph = &glyphs[gi];
        let start_char_idx = *byte_to_char_idx.get(glyph.cluster as usize).unwrap_or(&0);

        // Determine end of this glyph's character span
        let end_char_idx = if gi + 1 < glyphs.len() {
            *byte_to_char_idx
                .get(glyphs[gi + 1].cluster as usize)
                .unwrap_or(&chars.len())
        } else {
            chars.len()
        };

        let covered_count = end_char_idx - start_char_idx;
        if covered_count > 1 {
            let total_advance = advances[start_char_idx];
            let per_char = total_advance / covered_count as f64;
            let shared_x_offset = placements[start_char_idx].x_offset;
            let shared_y_offset = placements[start_char_idx].y_offset;
            for ci in start_char_idx..end_char_idx {
                advances[ci] = per_char;
                placements[ci] = VerticalCharPlacement {
                    advance: per_char,
                    x_offset: shared_x_offset,
                    y_offset: shared_y_offset,
                };
                has_placement[ci] = true;
                glyph_ranges[ci] = glyph_ranges[start_char_idx].clone();
            }
        }
    }
}

/// Build a mapping from character index to glyph advance for vertical layout.
pub(super) fn build_vertical_char_map(chars: &[&str], glyphs: &[GlyphInfo]) -> VerticalCharMap {
    let char_count = chars.len();
    let mut advances = vec![0.0f64; char_count];
    let mut glyph_ranges: Vec<GlyphRange> = (0..char_count)
        .map(|_| GlyphRange { start: 0, end: 0 })
        .collect();
    let mut placements: Vec<VerticalCharPlacement> = chars
        .iter()
        .map(|_| VerticalCharPlacement {
            advance: 0.0,
            x_offset: 0.0,
            y_offset: 0.0,
        })
        .collect();
    let mut has_placement = vec![false; char_count];

    let byte_to_char_idx = build_byte_to_char_index(chars);
    let char_byte_offsets = build_char_byte_offsets(chars);
    let glyph_spans = build_glyph_char_spans(glyphs, &byte_to_char_idx, char_count);

    for (gi, glyph) in glyphs.iter().enumerate() {
        let char_idx = *byte_to_char_idx.get(glyph.cluster as usize).unwrap_or(&0);
        if char_idx >= char_count {
            continue;
        }
        let advance = glyph_advance_in_vertical(glyph);
        advances[char_idx] += advance;

        if !has_placement[char_idx] {
            placements[char_idx] = VerticalCharPlacement {
                advance: 0.0,
                x_offset: glyph.x_offset,
                y_offset: glyph.y_offset,
            };
            has_placement[char_idx] = true;
        }
        placements[char_idx].advance += advance;

        let range = &mut glyph_ranges[char_idx];
        if range.start == 0 && range.end == 0 {
            range.start = gi;
            range.end = gi + 1;
        } else {
            range.end = gi + 1;
        }
    }

    distribute_ligature_advances(
        chars,
        glyphs,
        &byte_to_char_idx,
        &mut advances,
        &mut placements,
        &mut has_placement,
        &mut glyph_ranges,
    );

    VerticalCharMap {
        advances,
        glyph_ranges,
        placements,
        glyph_spans,
        char_byte_offsets,
    }
}
