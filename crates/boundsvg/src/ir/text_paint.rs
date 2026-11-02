//! Resolve text gradient resources in the final parent Text block coordinate frame.

use std::collections::HashMap;

use super::gradient::{is_supported_gradient_function, resolve_gradient_for_box};
use super::types::{IrNode, IrNodeKind, TextGradient, TextPaint};
use crate::error::EngineError;

/// Register distinct text paints in first-use order without changing text layout.
///
/// # Errors
///
/// Returns structured validation errors for malformed gradients or unsupported path text paint.
pub(crate) fn resolve_text_paints(node: &mut IrNode) -> Result<(), EngineError> {
    if let IrNodeKind::Group { children, .. } = &mut node.kind {
        for child in children {
            resolve_text_paints(child)?;
        }
        return Ok(());
    }
    let IrNodeKind::Text {
        color,
        lines,
        text_decorations,
        text_layout_kind,
        gradients,
        ..
    } = &mut node.kind
    else {
        return Ok(());
    };
    let mut indices = HashMap::<String, usize>::new();
    let mut resources = Vec::new();
    let mut register = |paint: &str| -> Result<(), EngineError> {
        if !is_supported_gradient_function(paint) || indices.contains_key(paint) {
            return Ok(());
        }
        let invalid = || EngineError::Structured {
            code: "VALIDATION".to_string(),
            message: "Invalid text gradient, or gradient paint on TextOnPath.".to_string(),
            stage: Some(crate::diagnostics::PipelineStage::Ir),
            node_id: Some(node.node_id.clone()),
        };
        if text_layout_kind.as_deref() == Some("path") {
            return Err(invalid());
        }
        let gradient =
            resolve_gradient_for_box(paint, node.bbox.w, node.bbox.h).ok_or_else(invalid)?;
        indices.insert(paint.to_string(), resources.len());
        resources.push(TextGradient {
            color: paint.to_string(),
            bbox: node.bbox,
            gradient,
        });
        Ok(())
    };
    register(color)?;
    for line in lines {
        for glyph in line.positioned_glyphs.iter().flatten() {
            if let Some(fill) = &glyph.fill {
                register(fill)?;
            }
        }
        for fragment in line.fragments.iter().flatten() {
            if let Some(fill) = fragment.style.color.as_deref() {
                register(fill)?;
            }
        }
    }
    for fragment in text_decorations.iter().flatten() {
        register(&fragment.color)?;
    }
    *gradients = (!resources.is_empty()).then_some(resources);
    Ok(())
}

/// Resolve an outline fill through the Text's already parsed resource table.
pub(crate) fn resolve_outline_paint(paint: &str, indices: &HashMap<&str, u32>) -> TextPaint {
    indices.get(paint).map_or_else(
        || TextPaint::Solid(paint.to_string()),
        |index| TextPaint::Gradient {
            gradient_index: *index,
        },
    )
}
