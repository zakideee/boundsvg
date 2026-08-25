//! Rust Text Engine — horizontal text layout + line breaking.
//!
//! Performs shaping → line-break → wrap, producing a `TextLayoutResult`
//! consumed by the rendering pipeline (and serializable across WASM).
//!
//! Horizontal layout, kinsoku, fit, ellipsis, and vertical text.
//! Inline runs support mixed-style text spans.

mod api;
mod break_detection;
mod char_mapping;
mod line_breaking;
mod result_building;
#[cfg(test)]
mod tests;

// Re-export public API
pub use api::{
    MeasuredTextBlock, MeasuredTextLine, layout_text, layout_text_with_unit_metadata,
    measure_text_lines,
};
pub use line_breaking::{BreakMeasure, BreakResult};
pub use result_building::{
    apply_feature_settings_to_lines, apply_variation_settings_to_lines, build_horizontal_result,
    build_horizontal_result_with_constraints, build_horizontal_result_with_warnings,
};

// Re-export pub(crate) items
pub(crate) use api::language_to_str;
pub(crate) use api::layout_text_inner_with_prepared_spans;
pub(crate) use char_mapping::{build_byte_to_char_map, build_char_byte_offsets};
pub(crate) use line_breaking::{break_lines_internal, measure_break_fit};
pub(crate) use result_building::build_positioned_glyphs_for_text;
pub(crate) use result_building::detect_constraint_overflow;
