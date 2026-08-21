use crate::ir::types::{AnimationTransform2D, BBox};

use super::{CompatibilityCategory, CompatibilityMismatch};

/// Axis-aligned affine in SVG multiplication order:
/// `(x, y) -> (scale_x * x + translate_x, scale_y * y + translate_y)`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct AxisAlignedAffine {
    pub(super) scale_x: f64,
    pub(super) scale_y: f64,
    pub(super) translate_x: f64,
    pub(super) translate_y: f64,
}

impl AxisAlignedAffine {
    pub(super) const fn identity() -> Self {
        Self {
            scale_x: 1.0,
            scale_y: 1.0,
            translate_x: 0.0,
            translate_y: 0.0,
        }
    }

    /// Compose `self * rhs`, so `rhs` is applied to a point first.
    pub(super) fn multiply(self, rhs: Self) -> Self {
        Self {
            scale_x: self.scale_x * rhs.scale_x,
            scale_y: self.scale_y * rhs.scale_y,
            translate_x: self.scale_x * rhs.translate_x + self.translate_x,
            translate_y: self.scale_y * rhs.translate_y + self.translate_y,
        }
    }

    pub(super) fn is_identity(self) -> bool {
        self.scale_x == 1.0
            && self.scale_y == 1.0
            && self.translate_x == 0.0
            && self.translate_y == 0.0
    }

    pub(super) fn inverse(self, node_id: &str) -> Result<Self, CompatibilityMismatch> {
        if !self.scale_x.is_finite()
            || !self.scale_y.is_finite()
            || !self.translate_x.is_finite()
            || !self.translate_y.is_finite()
            || self.scale_x == 0.0
            || self.scale_y == 0.0
        {
            return Err(geometry_mismatch(
                node_id,
                "an invertible finite generated parent transform",
                format!("non-invertible affine {self:?}"),
            ));
        }
        Ok(Self {
            scale_x: 1.0 / self.scale_x,
            scale_y: 1.0 / self.scale_y,
            translate_x: -self.translate_x / self.scale_x,
            translate_y: -self.translate_y / self.scale_y,
        })
    }

    pub(super) fn to_animation_transform(
        self,
        reference_bbox: BBox,
        node_id: &str,
    ) -> Result<AnimationTransform2D, CompatibilityMismatch> {
        let center_x = reference_bbox.x + reference_bbox.w / 2.0;
        let center_y = reference_bbox.y + reference_bbox.h / 2.0;
        let translate_x = self.translate_x - center_x * (1.0 - self.scale_x);
        let translate_y = self.translate_y - center_y * (1.0 - self.scale_y);
        if !translate_x.is_finite() || !translate_y.is_finite() {
            return Err(geometry_mismatch(
                node_id,
                "finite translate/scale animation channels",
                format!("undecomposable affine {self:?}"),
            ));
        }
        Ok(AnimationTransform2D {
            translate_x: Some(translate_x),
            translate_y: Some(translate_y),
            scale_x: Some(self.scale_x),
            scale_y: Some(self.scale_y),
            rotate_deg: None,
        })
    }
}

pub(super) fn bbox_world_delta(
    reference_bbox: BBox,
    target_bbox: BBox,
    node_id: &str,
) -> Result<AxisAlignedAffine, CompatibilityMismatch> {
    validate_transition_bbox(reference_bbox, node_id, "reference")?;
    validate_transition_bbox(target_bbox, node_id, "target")?;
    let scale_x = bbox_axis_scale(reference_bbox.w, target_bbox.w, node_id, "width")?;
    let scale_y = bbox_axis_scale(reference_bbox.h, target_bbox.h, node_id, "height")?;
    let delta = AxisAlignedAffine {
        scale_x,
        scale_y,
        translate_x: target_bbox.x - scale_x * reference_bbox.x,
        translate_y: target_bbox.y - scale_y * reference_bbox.y,
    };
    if !delta.translate_x.is_finite() || !delta.translate_y.is_finite() {
        return Err(geometry_mismatch(
            node_id,
            "a finite bbox-to-bbox world transform",
            format!("non-finite affine {delta:?}"),
        ));
    }
    Ok(delta)
}

fn bbox_axis_scale(
    reference_extent: f64,
    target_extent: f64,
    node_id: &str,
    axis_name: &str,
) -> Result<f64, CompatibilityMismatch> {
    if reference_extent == target_extent {
        return Ok(1.0);
    }
    if reference_extent == 0.0 || target_extent == 0.0 {
        return Err(geometry_mismatch(
            node_id,
            format!("non-zero {axis_name} in both states when it changes"),
            format!("reference {reference_extent}, target {target_extent}"),
        ));
    }
    let scale = target_extent / reference_extent;
    if !scale.is_finite() || scale == 0.0 {
        return Err(geometry_mismatch(
            node_id,
            format!("a finite invertible generated {axis_name} scale"),
            scale.to_string(),
        ));
    }
    Ok(scale)
}

fn validate_transition_bbox(
    bbox: BBox,
    node_id: &str,
    state_name: &str,
) -> Result<(), CompatibilityMismatch> {
    if !bbox.x.is_finite()
        || !bbox.y.is_finite()
        || !bbox.w.is_finite()
        || !bbox.h.is_finite()
        || bbox.w < 0.0
        || bbox.h < 0.0
    {
        return Err(geometry_mismatch(
            node_id,
            format!("a finite non-negative {state_name} bbox"),
            describe_bbox(bbox),
        ));
    }
    Ok(())
}

pub(super) fn describe_bbox(bbox: BBox) -> String {
    format!("x={}, y={}, w={}, h={}", bbox.x, bbox.y, bbox.w, bbox.h)
}

fn geometry_mismatch(
    node_id: &str,
    expected: impl Into<String>,
    observed: impl Into<String>,
) -> CompatibilityMismatch {
    CompatibilityMismatch {
        category: CompatibilityCategory::Bbox,
        node_id: node_id.to_string(),
        expected: expected.into(),
        observed: observed.into(),
    }
}
