//! Vertical text layout support (vertical-rl).
//!
//! Ported from packages/core/src/text/vertical-layout.ts.
//!
//! In vertical-rl mode:
//! - Glyphs advance top-to-bottom within a column
//! - Columns progress right-to-left
//! - Each "line" represents a vertical column
//! - Line breaking triggers when cumulative glyph height exceeds maxHeight
//! - Uses vertical advances (yAdvance) when available
//! - Falls back to horizontal advances (xAdvance) for fonts lacking vertical metrics

mod api;
mod break_finding;
mod column_breaking;
mod common;
mod fit;
mod glyph_mapping;
mod layout;
mod shape;

pub use api::layout_vertical_text;
pub use column_breaking::VerticalMeasure;
pub(crate) use column_breaking::{
    break_vertical_columns_with_variable_heights, measure_vertical_glyphs, min_possible_height,
};
pub(crate) use shape::shape_text_vertical;

#[cfg(test)]
pub(crate) use column_breaking::break_vertical_columns;
#[cfg(test)]
mod tests;
