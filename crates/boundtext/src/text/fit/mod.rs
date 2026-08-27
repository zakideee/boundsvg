//! Legacy binary-search fit helpers retained as direct Rust APIs.
//!
//! Boundary evaluation ensures the binary search invariant `lo=fit, hi=overflow`
//! before entering the loop, and the fit path uses the same break conditions
//! (`uax14_breaks`, `hanging_punctuation`, kinsoku) as the normal layout path.
//! Checked callers should use [`crate::text::engine::layout_text`], which owns
//! content certification, exact-grid work budgets, and typed failures. Changing
//! these `Option`-returning helpers requires a separate breaking API migration.

mod common;
mod grow;
mod shrink;
#[cfg(test)]
mod tests;

pub(crate) use common::{scaled_letter_spacing, selected_font_size_scale};
pub use grow::fit_grow;
pub use shrink::fit_shrink;
pub(crate) use shrink::fit_shrink_with_unit_metadata;
