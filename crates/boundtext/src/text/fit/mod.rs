//! Binary search fit (shrink/grow) for text layout.
//!
//! Boundary evaluation ensures the binary search invariant `lo=fit, hi=overflow`
//! before entering the loop, and the fit path uses the same break conditions
//! (`uax14_breaks`, `hanging_punctuation`, kinsoku) as the normal layout path.

mod common;
mod grow;
mod shrink;
#[cfg(test)]
mod tests;

pub use grow::fit_grow;
pub use shrink::fit_shrink;
pub(crate) use shrink::fit_shrink_with_unit_metadata;
