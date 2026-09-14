//! WASM adapter for the `boundtext::text::flow` text flow engine.
//!
//! This module keeps the serde-annotated DTO types needed for the WASM/JSON
//! bridge and delegates all text-core logic to `boundtext::text::flow`.

mod adapters;
mod conversions;
pub(crate) mod geometry;
mod intrinsic;
mod measure;
mod shrinkwrap;
mod types;

fn build_font_families(primary: &str, fallback: Option<&[String]>) -> Vec<String> {
    let mut families = Vec::with_capacity(1 + fallback.map_or(0, <[String]>::len));
    for family in
        std::iter::once(primary).chain(fallback.unwrap_or_default().iter().map(String::as_str))
    {
        let trimmed = family.trim();
        if !trimmed.is_empty() && !families.iter().any(|existing| existing == trimmed) {
            families.push(trimmed.to_string());
        }
    }
    families
}

#[cfg(test)]
mod presence_tests;
#[cfg(test)]
mod tests;

// Re-export everything that lib.rs and other modules need
pub(crate) use adapters::{
    layout_resolved_text_flow, layout_text_flow, layout_text_flow_with_exclusions,
};
pub(crate) use intrinsic::measure_intrinsic_inline_size;
pub(crate) use measure::measure_text_block;
pub(crate) use shrinkwrap::{shrinkwrap_flow, shrinkwrap_text};
pub(crate) use types::{
    IntrinsicInlineSizeInput, MeasureTextBlockInput, ShrinkwrapFlowInput, ShrinkwrapTextInput,
    TextFlowInput, TextFlowWithExclusionsInput,
};

#[cfg(test)]
mod output_tests;
