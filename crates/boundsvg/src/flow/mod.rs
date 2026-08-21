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

use crate::text::types::{MAX_RICH_TEXT_DEPTH, RichTextNodeInput, first_excess_rich_text_depth};

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

fn validate_rich_text_depth(rich_text: Option<&[RichTextNodeInput]>) -> Result<(), String> {
    if let Some(actual_depth) = rich_text.and_then(first_excess_rich_text_depth) {
        return Err(format!(
            "Validation error: rich text exceeds max depth ({MAX_RICH_TEXT_DEPTH}); actual depth {actual_depth}"
        ));
    }
    Ok(())
}

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
