//! Validate relative origins and resolve them against completed outer layout boxes.

use boundshape::Transform2D;

use super::types::BBox;
use crate::diagnostics::PipelineStage;
use crate::error::EngineError;
use crate::layout::types::{LayoutNodeInput, RelativePosition};

fn invalid(node_id: &str, reason: &str) -> EngineError {
    EngineError::Structured {
        code: "VALIDATION".into(),
        message: format!("Validation error: transformOrigin {reason}"),
        stage: Some(PipelineStage::Ir),
        node_id: Some(node_id.into()),
    }
}

/// Validate owner, ratio domain, and pixel-origin exclusion before building paint.
///
/// # Errors
///
/// Return structured `VALIDATION` with the owning node id for invalid input.
pub(super) fn validate_transform_origin(input: &LayoutNodeInput) -> Result<(), EngineError> {
    let Some(visual) = &input.visual else {
        return Ok(());
    };
    let Some(origin) = visual.transform_origin else {
        return Ok(());
    };
    if !matches!(
        input.node_type.as_str(),
        "flex" | "grid" | "box" | "text" | "image" | "path" | "svg" | "shape" | "symbol"
    ) {
        return Err(invalid(
            &input.node_id,
            "is not supported by this node type",
        ));
    }
    for ratio in [origin.x, origin.y] {
        if !ratio.is_finite()
            || !(0.0..=1.0).contains(&ratio)
            || (ratio != 0.0 && ratio < f64::MIN_POSITIVE)
        {
            return Err(invalid(
                &input.node_id,
                "ratios must be zero or finite normal numbers between 0 and 1",
            ));
        }
    }
    if visual
        .transform
        .as_ref()
        .is_some_and(|transform| transform.origin_x.is_some() || transform.origin_y.is_some())
    {
        return Err(invalid(
            &input.node_id,
            "cannot be combined with transform.originX or transform.originY",
        ));
    }
    Ok(())
}

/// Resolve a validated relative origin into the existing numeric, node-local transform.
///
/// # Errors
///
/// Return structured `VALIDATION` for invalid layout dimensions or non-finite origins.
pub(super) fn resolve_transform_origin(
    transform: &mut Transform2D,
    origin: RelativePosition,
    bbox: BBox,
    node_id: &str,
) -> Result<(), EngineError> {
    let origin_x = bbox.w * origin.x;
    let origin_y = bbox.h * origin.y;
    if bbox.w < 0.0
        || bbox.h < 0.0
        || [
            bbox.x,
            bbox.y,
            bbox.w,
            bbox.h,
            origin_x,
            origin_y,
            bbox.x + origin_x,
            bbox.y + origin_y,
        ]
        .iter()
        .any(|coordinate| !coordinate.is_finite())
    {
        return Err(invalid(
            node_id,
            "requires a finite nonnegative layout box and finite resolved origins",
        ));
    }
    transform.origin_x = Some(if origin_x == 0.0 { 0.0 } else { origin_x });
    transform.origin_y = Some(if origin_y == 0.0 { 0.0 } else { origin_y });
    Ok(())
}
