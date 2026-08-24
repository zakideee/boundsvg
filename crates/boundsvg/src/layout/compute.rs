use std::collections::HashMap;

use crate::error::EngineError;
use crate::font::FontRegistry;

use super::measure::MeasureContext;
use super::taffy::compute_layout_core;
use super::types::{LayoutInput, LayoutOutput};

/// Compute full layout from JSON input (creates local font registry from input.fonts).
///
/// # Errors
///
/// Returns `EngineError` if font registration or layout computation fails.
pub fn compute_full_layout(input: &LayoutInput) -> Result<LayoutOutput, EngineError> {
    let mut font_registry = FontRegistry::new();
    for font in &input.fonts {
        font_registry.register(
            font.data.clone(),
            font.alias.clone(),
            font.weight,
            font.style.clone(),
        )?;
    }
    compute_layout_inner(input, &font_registry)
}

/// Compute full layout using an external font registry.
/// Any fonts in input.fonts are temporarily added (but not persisted to the global registry).
///
/// # Errors
///
/// Returns `EngineError` if font registration or layout computation fails.
pub fn compute_full_layout_with_registry(
    input: &LayoutInput,
    global_registry: &FontRegistry,
) -> Result<LayoutOutput, EngineError> {
    if input.fonts.is_empty() {
        // Use global registry directly
        return compute_layout_inner(input, global_registry);
    }

    // Build a registry holding only the inline fonts; it takes precedence for
    // this call, with the global registry serving as the per-character fallback.
    let mut local_registry = FontRegistry::new();
    for font in &input.fonts {
        // Ignore duplicate errors (font may already be in global)
        let _ = local_registry.register(
            font.data.clone(),
            font.alias.clone(),
            font.weight,
            font.style.clone(),
        );
    }
    // Use a combined resolver: try local first, then global
    compute_layout_inner_combined(input, &local_registry, global_registry)
}

fn compute_layout_inner_combined(
    input: &LayoutInput,
    primary: &FontRegistry,
    fallback: &FontRegistry,
) -> Result<LayoutOutput, EngineError> {
    let context = MeasureContext {
        font_registry: primary,
        fallback_registry: Some(fallback),
        text_inputs: HashMap::new(),
        text_path_inputs: HashMap::new(),
        image_inputs: HashMap::new(),
        measure_call_count: 0,
        measure_cache: HashMap::new(),
        measure_cache_hits: 0,
        shrink_to_fit_widths: HashMap::new(),
        shaped_cache: HashMap::new(),
        text_results: HashMap::new(),
    };
    compute_layout_core(input, context)
}

fn compute_layout_inner(
    input: &LayoutInput,
    font_registry: &FontRegistry,
) -> Result<LayoutOutput, EngineError> {
    let context = MeasureContext {
        font_registry,
        fallback_registry: None,
        text_inputs: HashMap::new(),
        text_path_inputs: HashMap::new(),
        image_inputs: HashMap::new(),
        measure_call_count: 0,
        measure_cache: HashMap::new(),
        measure_cache_hits: 0,
        shrink_to_fit_widths: HashMap::new(),
        shaped_cache: HashMap::new(),
        text_results: HashMap::new(),
    };
    compute_layout_core(input, context)
}
