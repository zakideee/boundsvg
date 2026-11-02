//! Bounded transform chains for geometry that introduces a nonzero shear.

use super::{GeometryNode, ShapeError, Transform2D, parse_path_bounds};

/// Largest local physical coordinate for skew-bearing geometry, in px.
pub(crate) const SKEW_COORDINATE_MAX: f64 = 1_048_576.0;
/// Largest local scale magnitude on a skew-bearing transform chain.
pub(crate) const SKEW_SCALE_MAX: f64 = 2048.0;
/// Largest product of noncontracting gains on a skew-bearing chain.
pub(crate) const SKEW_GAIN_MAX: f64 = 65_536.0;

/// Whether a transform introduces a shear rather than an identity skew channel.
pub(crate) fn has_skew(transform: &Transform2D) -> bool {
    transform.skew_x_deg.unwrap_or(0.0) != 0.0 || transform.skew_y_deg.unwrap_or(0.0) != 0.0
}

/// Bound the Euclidean linear gain; a rotation has gain one at every angle.
///
/// # Errors
///
/// Returns `InvalidTransform` when a channel is outside the skew chain domain.
pub(crate) fn bounded_transform_gain(transform: &Transform2D) -> Result<f64, ShapeError> {
    let lengths = [
        transform.translate_x,
        transform.translate_y,
        transform.origin_x,
        transform.origin_y,
        transform.rotate_deg,
    ];
    if lengths
        .into_iter()
        .flatten()
        .any(|value| !value.is_finite() || value.abs() > SKEW_COORDINATE_MAX)
    {
        return Err(ShapeError::InvalidTransform);
    }
    let scales = [
        transform.scale_x.unwrap_or(1.0),
        transform.scale_y.unwrap_or(1.0),
    ];
    if scales
        .iter()
        .any(|scale| !scale.is_finite() || scale.abs() > SKEW_SCALE_MAX)
    {
        return Err(ShapeError::InvalidTransform);
    }
    let angles = [
        transform.skew_x_deg.unwrap_or(0.0),
        transform.skew_y_deg.unwrap_or(0.0),
    ];
    if angles
        .iter()
        .any(|angle| !angle.is_finite() || angle.abs() > 60.0)
    {
        return Err(ShapeError::InvalidTransform);
    }
    let shear_gain = angles.into_iter().fold(1.0, |gain, angle| {
        gain * if angle == 0.0 { 1.0 } else { 4.0 }
    });
    Ok((scales[0].abs().max(scales[1].abs()) * shear_gain).max(1.0))
}

/// Validate only paths influenced by skew and the transforms leading to them.
///
/// # Errors
///
/// Returns `InvalidTransform` for out-of-domain geometry or a chain gain overflow.
pub(crate) fn validate_geometry_skew(root: &GeometryNode) -> Result<Option<f64>, ShapeError> {
    fn visit(node: &GeometryNode, inherited: bool) -> Result<Option<f64>, ShapeError> {
        match node {
            GeometryNode::Path { d, .. } => {
                if !inherited {
                    return Ok(None);
                }
                let geometry = parse_path_bounds(d);
                if geometry.error_offset.is_some()
                    || geometry.bounds.is_some_and(|bounds| {
                        [bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y]
                            .iter()
                            .any(|coordinate| coordinate.abs() > SKEW_COORDINATE_MAX)
                    })
                {
                    return Err(ShapeError::InvalidTransform);
                }
                Ok(Some(1.0))
            }
            GeometryNode::Group { children, .. } | GeometryNode::Boolean { children, .. } => {
                let mut maximum: Option<f64> = inherited.then_some(1.0);
                for child in children {
                    if let Some(gain) = visit(child, inherited)? {
                        maximum = Some(maximum.unwrap_or(1.0).max(gain));
                    }
                }
                Ok(maximum)
            }
            GeometryNode::Transform {
                transform, child, ..
            } => {
                let own = has_skew(transform);
                let descendant = visit(child, inherited || own)?;
                let Some(descendant) = descendant.or_else(|| own.then_some(1.0)) else {
                    return Ok(None);
                };
                let local = bounded_transform_gain(transform)?;
                if upper_gain_product(local, descendant) > SKEW_GAIN_MAX {
                    return Err(ShapeError::InvalidTransform);
                }
                Ok(Some(upper_gain_product(local, descendant)))
            }
        }
    }
    visit(root, false)
}

/// Multiply nonnegative gains without losing a positive rounding residual.
pub(crate) fn upper_gain_product(left: f64, right: f64) -> f64 {
    let product = left * right;
    if left.mul_add(right, -product) > 0.0 {
        product.next_up()
    } else {
        product
    }
}

/// Bound viewport baking and paint operands before evaluating skew geometry.
///
/// # Errors
///
/// Returns `InvalidTransform` if the physical target or its chain gain exceeds the supported domain.
pub(crate) fn validate_compile_options(
    geometry: &super::GeometryDoc,
    options: &super::CompileGeometryOptions,
    skew_gain: f64,
) -> Result<(), ShapeError> {
    let viewport = options.viewport.as_ref();
    let target_width = viewport.map_or(geometry.view_box.width, |value| value.width);
    let target_height = viewport.map_or(geometry.view_box.height, |value| value.height);
    let padding = super::stroke_padding(options.paint.as_ref());
    let source_width = if geometry.view_box.width == 0.0 {
        1.0
    } else {
        geometry.view_box.width
    };
    let source_height = if geometry.view_box.height == 0.0 {
        1.0
    } else {
        geometry.view_box.height
    };
    if [target_width, target_height, padding]
        .iter()
        .any(|value| !value.is_finite() || value.abs() > SKEW_COORDINATE_MAX)
    {
        return Err(ShapeError::InvalidTransform);
    }
    let (scale_x, scale_y) = super::aspect_ratio_scales(
        (target_width - padding * 2.0).max(0.0) / source_width,
        (target_height - padding * 2.0).max(0.0) / source_height,
        options.preserve_aspect_ratio,
    );
    let viewport_gain = scale_x.abs().max(scale_y.abs()).max(1.0);
    if !viewport_gain.is_finite()
        || viewport_gain > SKEW_SCALE_MAX
        || upper_gain_product(skew_gain, viewport_gain) > SKEW_GAIN_MAX
    {
        return Err(ShapeError::InvalidTransform);
    }
    Ok(())
}

/// Check the actual viewport-baked paths and their paint expansion.
///
/// # Errors
///
/// Returns `InvalidTransform` when a compiled control point or stroke exceeds the local physical domain.
pub(crate) fn validate_compiled_paths(
    d: &str,
    stroke_path: &str,
    options: &super::CompileGeometryOptions,
) -> Result<(), ShapeError> {
    let paint = options.paint.as_ref();
    let outset = paint
        .filter(|paint| {
            paint
                .stroke
                .as_deref()
                .is_some_and(|color| !color.trim().is_empty() && color.trim() != "none")
        })
        .map_or(0.0, |paint| {
            paint.stroke_width.unwrap_or(1.0).abs()
                * 0.5
                * paint.stroke_miterlimit.unwrap_or(4.0).max(1.0)
        });
    for path in [d, stroke_path] {
        if parse_path_bounds(path).bounds.is_some_and(|bounds| {
            [bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y]
                .iter()
                .any(|coordinate| {
                    !coordinate.is_finite() || coordinate.abs() + outset > SKEW_COORDINATE_MAX
                })
        }) {
            return Err(ShapeError::InvalidTransform);
        }
    }

    Ok(())
}
