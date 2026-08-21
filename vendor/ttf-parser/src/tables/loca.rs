//! An [Index to Location Table](https://docs.microsoft.com/en-us/typography/opentype/spec/loca)
//! implementation.

use core::convert::TryFrom;
use core::num::NonZeroU16;
use core::ops::Range;

// PATCHED (boundsvg vendored fix, see README-PATCH.md): this file carries the
// upstream fix for 65535-glyph fonts (harfbuzz/ttf-parser commit 3a193ba,
// unreleased as of 0.25.1). A well-formed font with `maxp.numGlyphs == u16::MAX`
// has 65536 loca offsets; the released code held the offset count in `u16`, so
// parsing discarded the whole table and every outline silently disappeared.
// The index type is widened to `u32`, matching upstream.
use crate::parser::{LazyArray32, NumFrom, Stream};
use crate::{GlyphId, IndexToLocationFormat};

/// An [Index to Location Table](https://docs.microsoft.com/en-us/typography/opentype/spec/loca).
#[derive(Clone, Copy, Debug)]
pub enum Table<'a> {
    /// Short offsets.
    Short(LazyArray32<'a, u16>),
    /// Long offsets.
    Long(LazyArray32<'a, u32>),
}

impl<'a> Table<'a> {
    /// Parses a table from raw data.
    ///
    /// - `number_of_glyphs` is from the `maxp` table.
    /// - `format` is from the `head` table.
    pub fn parse(
        number_of_glyphs: NonZeroU16,
        format: IndexToLocationFormat,
        data: &'a [u8],
    ) -> Option<Self> {
        // The number of ranges is `maxp.numGlyphs + 1`.
        let mut total: u32 = u32::from(number_of_glyphs.get()) + 1;

        // By the spec, the number of `loca` offsets is `maxp.numGlyphs + 1`.
        // But some malformed fonts can have less glyphs than that.
        // In which case we try to parse only the available offsets
        // and do not return an error, since the expected data length
        // would go beyond table's length.
        //
        // In case when `loca` has more data than needed we simply ignore the rest.
        let actual_total = match format {
            IndexToLocationFormat::Short => data.len() / 2,
            IndexToLocationFormat::Long => data.len() / 4,
        };
        let actual_total = u32::try_from(actual_total).ok()?;
        total = total.min(actual_total);

        let mut s = Stream::new(data);
        match format {
            IndexToLocationFormat::Short => Some(Table::Short(s.read_array32::<u16>(total)?)),
            IndexToLocationFormat::Long => Some(Table::Long(s.read_array32::<u32>(total)?)),
        }
    }

    /// Returns the number of offsets.
    #[inline]
    pub fn len(&self) -> u32 {
        match self {
            Table::Short(ref array) => array.len(),
            Table::Long(ref array) => array.len(),
        }
    }

    /// Checks if there are any offsets.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Returns glyph's range in the `glyf` table.
    #[inline]
    pub fn glyph_range(&self, glyph_id: GlyphId) -> Option<Range<usize>> {
        let glyph_id = u32::from(glyph_id.0);

        // Glyph ID must be smaller than total number of values in a `loca` array.
        if glyph_id + 1 >= self.len() {
            return None;
        }

        let range = match self {
            Table::Short(ref array) => {
                // 'The actual local offset divided by 2 is stored.'
                usize::from(array.get(glyph_id)?) * 2..usize::from(array.get(glyph_id + 1)?) * 2
            }
            Table::Long(ref array) => {
                usize::num_from(array.get(glyph_id)?)..usize::num_from(array.get(glyph_id + 1)?)
            }
        };

        if range.start >= range.end {
            // 'The offsets must be in ascending order.'
            // And range cannot be empty.
            None
        } else {
            Some(range)
        }
    }
}

#[cfg(test)]
mod boundsvg_patch_tests {
    use super::*;

    #[test]
    fn keeps_every_offset_for_the_maximum_glyph_count() {
        // A spec-complete table: 65535 glyphs, therefore 65536 long offsets,
        // ascending so that every glyph range is non-empty.
        let offsets_count = usize::from(u16::MAX) + 1;
        let mut data = vec![0u8; offsets_count * 4];
        for (index, chunk) in data.chunks_exact_mut(4).enumerate() {
            chunk.copy_from_slice(&(index as u32).to_be_bytes());
        }
        let glyph_count = NonZeroU16::new(u16::MAX).expect("u16::MAX is nonzero");

        let table = Table::parse(glyph_count, IndexToLocationFormat::Long, &data)
            .expect("the maximum glyph-count loca table must remain available");

        assert_eq!(table.len(), u32::from(u16::MAX) + 1);
        assert_eq!(table.glyph_range(GlyphId(0)), Some(0..1));
        // The last valid glyph id must keep its offset pair: this is exactly
        // what a u16 offset count (or a clamp to 65535) loses.
        assert_eq!(
            table.glyph_range(GlyphId(u16::MAX - 1)),
            Some(usize::from(u16::MAX - 1)..usize::from(u16::MAX))
        );
        // Glyph id 65535 does not exist when numGlyphs == 65535.
        assert_eq!(table.glyph_range(GlyphId(u16::MAX)), None);
    }
}
