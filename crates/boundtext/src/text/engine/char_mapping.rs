use crate::font::shaping::GlyphInfo;

// ---------------------------------------------------------------------------
// Char ↔ Glyph mapping
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub(super) struct GlyphRange {
    pub(super) start: usize,
    pub(super) end: usize,
}

pub(super) struct CharGlyphMap {
    pub(super) advances: Vec<f64>,
    pub(super) glyph_ranges: Vec<GlyphRange>,
    pub(super) glyph_spans: Vec<GlyphCharSpan>,
    pub(super) char_byte_offsets: Vec<u32>,
}

#[derive(Debug, Clone)]
pub(super) struct GlyphCharSpan {
    pub(super) start: usize,
    pub(super) end: usize,
}

/// Build a mapping from character index to glyph info.
/// Uses cluster (byte offset) from each glyph to map back to characters.
pub(super) fn build_char_to_glyph_map(
    chars: &[&str],
    glyphs: &[GlyphInfo],
    _text: &str,
) -> CharGlyphMap {
    let char_count = chars.len();
    let mut advances: Vec<f64> = vec![0.0; char_count];
    let mut glyph_ranges: Vec<GlyphRange> = (0..char_count)
        .map(|_| GlyphRange { start: 0, end: 0 })
        .collect();

    // Build byte offset → char index mapping
    let byte_to_char_idx = build_byte_to_char_map(chars);
    let char_byte_offsets = build_char_byte_offsets(chars);
    let glyph_spans = build_glyph_char_spans(glyphs, &byte_to_char_idx, char_count);

    // Assign glyph advances to character positions
    for (gi, glyph) in glyphs.iter().enumerate() {
        let char_idx = byte_to_char_idx
            .get(glyph.cluster as usize)
            .copied()
            .unwrap_or(0);
        if char_idx < char_count {
            advances[char_idx] += glyph.x_advance;
            let range = &mut glyph_ranges[char_idx];
            if range.start == 0 && range.end == 0 {
                range.start = gi;
                range.end = gi + 1;
            } else {
                range.end = gi + 1;
            }
        }
    }

    CharGlyphMap {
        advances,
        glyph_ranges,
        glyph_spans,
        char_byte_offsets,
    }
}

/// Build byte offset → character index mapping.
pub(crate) fn build_byte_to_char_map(chars: &[&str]) -> Vec<usize> {
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
pub(crate) fn build_char_byte_offsets(chars: &[&str]) -> Vec<u32> {
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
