//! Compile-front-end checks for skew-bearing scene chains and resolved paint resources.

use std::collections::HashMap;

use boundshape::Transform2D;

use super::types::{
    AnimationEasing, AnimationSpec, AnimationTransform2D, BBox, BoxClip, Ir, IrNode, IrNodeKind,
    TextPaint,
};
use crate::error::EngineError;

/// Physical local coordinate ceiling in px for skew-bearing paint.
const COORDINATE_MAX: f64 = 1_048_576.0;
/// Largest magnitude of a local scale on a skew-bearing chain.
const SCALE_MAX: f64 = 2048.0;
/// Largest product of noncontracting linear gains along one affected chain.
const GAIN_MAX: f64 = 65_536.0;
/// Maximum generated-node chain depth covered by the forward error reserve.
const CHAIN_DEPTH_MAX: usize = 256;

// FMA recovers the exact product's positive residual for bounded normal gains.
// Exact products (including identity and powers of two) stay exact at the ceiling.
fn upper_product(left: f64, right: f64) -> f64 {
    if left == 0.0 || right == 0.0 {
        return 0.0;
    }
    let product = left * right;
    if left.mul_add(right, -product) > 0.0 {
        product.next_up()
    } else {
        product
    }
}

// Error-free addition for finite bounded channel operands (including subnormals).
fn sum_with_residual(left: f64, right: f64) -> (f64, f64) {
    let sum = left + right;
    let right_virtual = sum - left;
    (
        sum,
        (left - (sum - right_virtual)) + (right - right_virtual),
    )
}

fn directed_sum(left: f64, right: f64, is_upper: bool) -> f64 {
    let (sum, residual) = sum_with_residual(left, right);
    if is_upper && residual > 0.0 {
        sum.next_up()
    } else if !is_upper && residual < 0.0 {
        sum.next_down()
    } else {
        sum
    }
}

// FMA recovers multiplication's residual; very small products reserve a subnormal ulp.
fn product_bounds(left: f64, right: f64) -> (f64, f64) {
    let product = left * right;
    if left == 0.0 || right == 0.0 {
        return (product, product);
    }
    if product.abs() < f64::MIN_POSITIVE * 18_014_398_509_481_984.0 {
        return (product.next_down(), product.next_up());
    }
    let residual = left.mul_add(right, -product);
    (
        if residual < 0.0 {
            product.next_down()
        } else {
            product
        },
        if residual > 0.0 {
            product.next_up()
        } else {
            product
        },
    )
}

// Bound one authored channel endpoint without rounding an unsafe easing hull inward.
fn interpolated_bounds(start: f64, end: f64, easing: f64) -> (f64, f64) {
    if start == end || easing == 0.0 {
        return (start, start);
    }
    if easing == 1.0 {
        return (end, end);
    }
    let (delta, delta_residual) = sum_with_residual(end, -start);
    let product = delta * easing;
    if !product.is_finite() {
        return (f64::NEG_INFINITY, f64::INFINITY);
    }
    let product_residual = delta.mul_add(easing, -product);
    let (sum, sum_residual) = sum_with_residual(start, product);
    let residual_bounds = if delta != 0.0
        && easing != 0.0
        && product.abs() < f64::MIN_POSITIVE * 18_014_398_509_481_984.0
    {
        (product_residual.next_down(), product_residual.next_up())
    } else {
        (product_residual, product_residual)
    };
    let delta_error = product_bounds(delta_residual, easing);
    let lower = directed_sum(
        directed_sum(
            directed_sum(sum, sum_residual, false),
            residual_bounds.0,
            false,
        ),
        delta_error.0,
        false,
    );
    let upper = directed_sum(
        directed_sum(
            directed_sum(sum, sum_residual, true),
            residual_bounds.1,
            true,
        ),
        delta_error.1,
        true,
    );
    (lower, upper)
}

fn upper_sum(left: f64, right: f64) -> f64 {
    if !left.is_finite() || !right.is_finite() {
        return f64::INFINITY;
    }
    directed_sum(left, right, true)
}

// SQRT_2 is rounded above the exact root, so this encloses the Euclidean norm.
fn radial_upper(horizontal: f64, vertical: f64) -> f64 {
    upper_product(
        horizontal.abs().max(vertical.abs()),
        std::f64::consts::SQRT_2,
    )
}

fn stroke_outset(stroke: Option<&str>, width: Option<f64>, miter: Option<f64>) -> f64 {
    if stroke
        .is_none_or(|color| color.trim().is_empty() || color.trim().eq_ignore_ascii_case("none"))
    {
        return 0.0;
    }
    upper_product(
        width.unwrap_or(1.0).abs() * 0.5,
        miter.unwrap_or(4.0).max(1.0),
    )
}

fn invalid(node_id: &str, reason: &str) -> EngineError {
    EngineError::Structured {
        code: "VALIDATION".to_string(),
        message: format!("Node {node_id}: {reason}"),
        stage: Some(crate::diagnostics::PipelineStage::Ir),
        node_id: Some(node_id.to_string()),
    }
}

fn has_skew(transform: &Transform2D) -> bool {
    transform.skew_x_deg.unwrap_or(0.0) != 0.0 || transform.skew_y_deg.unwrap_or(0.0) != 0.0
}

fn track_has_skew(spec: &AnimationSpec) -> bool {
    spec.keyframes
        .iter()
        .filter_map(|frame| frame.transform.as_ref())
        .any(|transform| {
            transform.skew_x_deg.unwrap_or(0.0) != 0.0 || transform.skew_y_deg.unwrap_or(0.0) != 0.0
        })
}

fn magnitude(
    values: impl IntoIterator<Item = f64>,
    limit: f64,
    node_id: &str,
) -> Result<f64, EngineError> {
    let mut maximum = 0.0_f64;
    for value in values {
        if !value.is_finite() || value.abs() > limit {
            return Err(invalid(
                node_id,
                "value exceeds the supported skew envelope",
            ));
        }
        maximum = maximum.max(value.abs());
    }
    Ok(maximum)
}

fn bbox_magnitude(bbox: BBox) -> f64 {
    bbox.x
        .abs()
        .max(bbox.y.abs())
        .max((bbox.x + bbox.w).abs())
        .max((bbox.y + bbox.h).abs())
}

/// Conservative internal radial enclosure; infinity is confined here until an affected check rejects it.
fn animated_radius(spec: &AnimationSpec, radius: f64, origin_radius: f64) -> f64 {
    let (low, high) = match &spec.easing {
        Some(AnimationEasing::CubicBezier([_, first, _, second])) => {
            (first.min(*second).min(0.0), first.max(*second).max(1.0))
        }
        Some(AnimationEasing::Spring(_)) => (0.0, 2.0),
        _ => (0.0, 1.0),
    };
    let mut maximum = radius;
    for frames in spec.keyframes.windows(2) {
        let (Some(start), Some(end)) = (&frames[0].transform, &frames[1].transform) else {
            continue;
        };
        let channels = |transform: &AnimationTransform2D| {
            [
                transform.translate_x.unwrap_or(0.0),
                transform.translate_y.unwrap_or(0.0),
                transform.rotate_deg.unwrap_or(0.0),
                transform.scale_x.unwrap_or(1.0),
                transform.scale_y.unwrap_or(1.0),
                transform.skew_x_deg.unwrap_or(0.0),
                transform.skew_y_deg.unwrap_or(0.0),
            ]
        };
        let start_channels = channels(start);
        let end_channels = channels(end);
        let mut bounds = [0.0_f64; 7];
        for index in 0..7 {
            let lower_endpoint =
                interpolated_bounds(start_channels[index], end_channels[index], low);
            let upper_endpoint =
                interpolated_bounds(start_channels[index], end_channels[index], high);
            let endpoints = [
                lower_endpoint.0,
                lower_endpoint.1,
                upper_endpoint.0,
                upper_endpoint.1,
            ];
            if endpoints.iter().any(|value| !value.is_finite()) {
                return f64::INFINITY;
            }
            bounds[index] = endpoints.into_iter().map(f64::abs).fold(0.0, f64::max);
        }
        let gain = bounds[3].max(bounds[4])
            * if bounds[5] == 0.0 { 1.0 } else { 4.0 }
            * if bounds[6] == 0.0 { 1.0 } else { 4.0 };
        let is_identity_linear = start_channels[2..] == [0.0, 1.0, 1.0, 0.0, 0.0]
            && end_channels[2..] == [0.0, 1.0, 1.0, 0.0, 0.0];
        let shift = radial_upper(bounds[0], bounds[1])
            + if is_identity_linear {
                0.0
            } else {
                (1.0 + gain) * origin_radius
            };
        maximum = maximum.max(upper_sum(upper_product(radius, gain), shift));
    }
    maximum
}

fn path_radius(path: &str, origin_x: f64, origin_y: f64) -> f64 {
    boundshape::parse_path_bounds(path)
        .bounds
        .map_or(0.0, |bounds| {
            (bounds.min_x + origin_x)
                .abs()
                .max((bounds.max_x + origin_x).abs())
                .hypot(
                    (bounds.min_y + origin_y)
                        .abs()
                        .max((bounds.max_y + origin_y).abs()),
                )
        })
}

fn filter_radius(
    radius: f64,
    dx: f64,
    dy: f64,
    blur: f64,
    spread: f64,
    node_id: &str,
) -> Result<f64, EngineError> {
    let (minimum_percent, _) =
        crate::svg_emit::emitter::filter_region_percent(dx, dy, blur, spread)?;
    let coordinate_bound = upper_product(
        radius,
        upper_sum(1.0, upper_product(-minimum_percent / 100.0, 2.0)),
    );
    magnitude([coordinate_bound], COORDINATE_MAX, node_id)?;
    Ok(upper_product(coordinate_bound, std::f64::consts::SQRT_2))
}

fn static_gain(
    transform: &Transform2D,
    bbox: BBox,
    node_id: &str,
    is_sampled_pose: bool,
) -> Result<f64, EngineError> {
    magnitude(
        [
            transform.translate_x,
            transform.translate_y,
            transform.rotate_deg,
        ]
        .into_iter()
        .flatten(),
        COORDINATE_MAX,
        node_id,
    )?;
    magnitude(
        [
            bbox.x + transform.origin_x.unwrap_or(0.0),
            bbox.y + transform.origin_y.unwrap_or(0.0),
        ],
        COORDINATE_MAX,
        node_id,
    )?;
    let scale = magnitude(
        [
            transform.scale_x.unwrap_or(1.0),
            transform.scale_y.unwrap_or(1.0),
        ],
        SCALE_MAX,
        node_id,
    )?;
    let mut gain = scale.max(1.0);
    for angle in [
        transform.skew_x_deg.unwrap_or(0.0),
        transform.skew_y_deg.unwrap_or(0.0),
    ] {
        magnitude([angle], if is_sampled_pose { 70.0 } else { 60.0 }, node_id)?;
        if is_sampled_pose && angle.abs() >= 70.0 {
            return Err(invalid(
                node_id,
                "sampled skew exceeds its execution envelope",
            ));
        }
        if angle != 0.0 {
            gain *= 4.0;
        }
    }
    Ok(gain)
}

fn easing_hull(spec: &AnimationSpec, node_id: &str) -> Result<(f64, f64), EngineError> {
    match &spec.easing {
        Some(AnimationEasing::CubicBezier([_, first, _, second])) => {
            magnitude([*first, *second], COORDINATE_MAX, node_id)?;
            Ok((first.min(*second).min(0.0), first.max(*second).max(1.0)))
        }
        Some(AnimationEasing::Spring(_)) => Ok((0.0, 2.0)),
        _ => Ok((0.0, 1.0)),
    }
}

fn animated_gain(spec: &AnimationSpec, bbox: BBox, node_id: &str) -> Result<f64, EngineError> {
    let (low, high) = easing_hull(spec, node_id)?;
    magnitude(
        [bbox.x + bbox.w / 2.0, bbox.y + bbox.h / 2.0],
        COORDINATE_MAX,
        node_id,
    )?;
    let mut gain = 1.0_f64;
    for frames in spec.keyframes.windows(2) {
        let (Some(start), Some(end)) = (&frames[0].transform, &frames[1].transform) else {
            continue;
        };
        let channels = |transform: &AnimationTransform2D| {
            [
                transform.translate_x.unwrap_or(0.0),
                transform.translate_y.unwrap_or(0.0),
                transform.rotate_deg.unwrap_or(0.0),
                transform.scale_x.unwrap_or(1.0),
                transform.scale_y.unwrap_or(1.0),
                transform.skew_x_deg.unwrap_or(0.0),
                transform.skew_y_deg.unwrap_or(0.0),
            ]
        };
        let start_channels = channels(start);
        let end_channels = channels(end);
        let mut maxima = [0.0; 7];
        for index in 0..7 {
            let limit = if index < 3 {
                COORDINATE_MAX
            } else if index < 5 {
                SCALE_MAX
            } else {
                60.0
            };
            magnitude([start_channels[index], end_channels[index]], limit, node_id)?;
            let lower_endpoint =
                interpolated_bounds(start_channels[index], end_channels[index], low);
            let upper_endpoint =
                interpolated_bounds(start_channels[index], end_channels[index], high);
            maxima[index] = magnitude(
                [
                    lower_endpoint.0,
                    lower_endpoint.1,
                    upper_endpoint.0,
                    upper_endpoint.1,
                ],
                limit,
                node_id,
            )?;
        }
        let shear_x = if maxima[5] == 0.0 { 1.0 } else { 4.0 };
        let shear_y = if maxima[6] == 0.0 { 1.0 } else { 4.0 };
        gain = gain.max(maxima[3].max(maxima[4]).max(1.0) * shear_x * shear_y);
    }
    Ok(gain)
}

fn path_magnitude(
    path: &str,
    origin_x: f64,
    origin_y: f64,
    node_id: &str,
) -> Result<f64, EngineError> {
    let parsed = boundshape::parse_path_bounds(path);
    if parsed.error_offset.is_some() {
        return Err(invalid(
            node_id,
            "skew requires completely bounded Path geometry",
        ));
    }
    let Some(bounds) = parsed.bounds else {
        return Ok(0.0);
    };
    magnitude(
        [bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y],
        COORDINATE_MAX,
        node_id,
    )?;
    magnitude(
        [
            bounds.min_x + origin_x,
            bounds.max_x + origin_x,
            bounds.min_y + origin_y,
            bounds.max_y + origin_y,
        ],
        COORDINATE_MAX,
        node_id,
    )
}

fn validate_resources(node: &IrNode) -> Result<(), EngineError> {
    if let IrNodeKind::Group {
        clip: Some(clip), ..
    } = &node.kind
        && let BoxClip::BoxContour(contour) = clip
    {
        let bbox = contour.bbox;
        if [
            bbox.x,
            bbox.y,
            bbox.w,
            bbox.h,
            bbox.x + bbox.w,
            bbox.y + bbox.h,
        ]
        .iter()
        .any(|coordinate| !coordinate.is_finite())
            || bbox.w < 0.0
            || bbox.h < 0.0
            || contour.corners.iter().any(|corner| {
                !corner.rx.is_finite()
                    || !corner.ry.is_finite()
                    || corner.rx < 0.0
                    || corner.ry < 0.0
                    || corner.rx > bbox.w / 2.0
                    || corner.ry > bbox.h / 2.0
            })
        {
            return Err(invalid(&node.node_id, "invalid resolved box clip"));
        }
    }
    if let IrNodeKind::Text {
        glyph_paths,
        gradients,
        color,
        lines,
        text_decorations,
        ..
    } = &node.kind
    {
        let resources = gradients.as_deref().unwrap_or_default();
        for resource in resources {
            if resource.bbox != node.bbox {
                return Err(invalid(
                    &node.node_id,
                    "text gradient must share its parent Text bbox",
                ));
            }
            let (numbers, stops) = match &resource.gradient {
                super::types::Gradient::Linear { geometry, stops } => (
                    vec![
                        geometry.start_x,
                        geometry.start_y,
                        geometry.end_x,
                        geometry.end_y,
                    ],
                    stops,
                ),
                super::types::Gradient::Radial { geometry, stops } => (
                    vec![
                        geometry.center_x,
                        geometry.center_y,
                        geometry.radius_x,
                        geometry.radius_y,
                    ],
                    stops,
                ),
            };
            if numbers.iter().any(|value| !value.is_finite())
                || stops
                    .iter()
                    .any(|stop| !stop.offset.is_finite() || !(0.0..=1.0).contains(&stop.offset))
            {
                return Err(invalid(
                    &node.node_id,
                    "non-finite or invalid resolved text gradient",
                ));
            }
        }
        let resource_colors: std::collections::HashSet<&str> = resources
            .iter()
            .map(|resource| resource.color.as_str())
            .collect();
        for paint in std::iter::once(color.as_str())
            .chain(lines.iter().flat_map(|line| {
                line.positioned_glyphs
                    .iter()
                    .flatten()
                    .filter_map(|glyph| glyph.fill.as_deref())
            }))
            .chain(lines.iter().flat_map(|line| {
                line.fragments
                    .iter()
                    .flatten()
                    .filter_map(|fragment| fragment.style.color.as_deref())
            }))
            .chain(
                text_decorations
                    .iter()
                    .flatten()
                    .map(|fragment| fragment.color.as_str()),
            )
        {
            if super::gradient::is_supported_gradient_function(paint)
                && !resource_colors.contains(paint)
            {
                return Err(invalid(
                    &node.node_id,
                    "gradient text IR requires its resolved parent Text resource table",
                ));
            }
        }

        for path in glyph_paths.iter().flatten() {
            if let TextPaint::Gradient { gradient_index } = path.fill
                && gradient_index as usize >= resources.len()
            {
                return Err(invalid(
                    &node.node_id,
                    "outline gradient index is outside the parent Text table",
                ));
            }
        }
    }
    Ok(())
}

/// Validate available geometry before rendering; outline materialization is checked on its later boundary.
///
/// # Errors
///
/// Returns structured validation errors for unsafe skew combinations or malformed resolved resources.
pub(crate) fn validate(ir: &Ir) -> Result<(), EngineError> {
    validate_with_geometry(ir, &HashMap::new())
}

/// Include source geometry gains that are baked out of Shape nodes during IR construction.
///
/// # Errors
///
/// Returns structured validation errors before any SVG/raster/outline export is returned.
pub(crate) fn validate_with_geometry(
    ir: &Ir,
    geometry_gains: &HashMap<String, f64>,
) -> Result<(), EngineError> {
    if geometry_gains.is_empty() && !tree_has_skew(&ir.root) {
        return validate_resource_tree(&ir.root);
    }
    let (affected, _) = visit(&ir.root, false, 0, geometry_gains)?;
    if affected.is_some() {
        magnitude([ir.width, ir.height], COORDINATE_MAX, &ir.root.node_id)?;
    }
    Ok(())
}

fn visit(
    node: &IrNode,
    has_skew_ancestor: bool,
    depth: usize,
    geometry_gains: &HashMap<String, f64>,
) -> Result<(Option<f64>, f64), EngineError> {
    validate_resources(node)?;
    let geometry_gain = if matches!(node.kind, IrNodeKind::Shape { .. }) {
        geometry_gains.get(&node.node_id).copied()
    } else {
        None
    };
    let has_own_skew = geometry_gain.is_some()
        || match &node.kind {
            IrNodeKind::Group {
                transform,
                animation,
                ..
            } => {
                transform.as_ref().is_some_and(has_skew)
                    || animation.as_ref().is_some_and(track_has_skew)
            }
            IrNodeKind::Text { unit_animation, .. } => unit_animation
                .as_ref()
                .is_some_and(|animation| track_has_skew(&animation.animation)),
            _ => false,
        };
    let is_affected = has_skew_ancestor || has_own_skew;
    if is_affected && let IrNodeKind::Text { gradients, .. } = &node.kind {
        for resource in gradients.iter().flatten() {
            let coordinates = match &resource.gradient {
                super::types::Gradient::Linear { geometry, .. } => [
                    geometry.start_x,
                    geometry.start_y,
                    geometry.end_x,
                    geometry.end_y,
                ],
                super::types::Gradient::Radial { geometry, .. } => [
                    geometry.center_x,
                    geometry.center_y,
                    geometry.radius_x,
                    geometry.radius_y,
                ],
            };
            magnitude(coordinates, COORDINATE_MAX * 2.0, &node.node_id)?;
        }
    }

    let mut descendant_gain = is_affected.then_some(1.0_f64);
    let mut paint_radius = if matches!(node.kind, IrNodeKind::Group { .. }) {
        0.0
    } else {
        bbox_magnitude(node.bbox) * std::f64::consts::SQRT_2
    };
    if let IrNodeKind::Group { children, .. } = &node.kind {
        for child in children {
            let (child_gain, child_radius) = visit(child, is_affected, depth + 1, geometry_gains)?;
            paint_radius = paint_radius.max(child_radius);
            if let Some(child_gain) = child_gain {
                descendant_gain = Some(descendant_gain.unwrap_or(1.0).max(child_gain));
            }
        }
    }
    let local_gain = if let Some(descendant_gain) = descendant_gain {
        if depth > CHAIN_DEPTH_MAX {
            return Err(invalid(
                &node.node_id,
                "skew chain exceeds 256 generated nodes",
            ));
        }
        let mut local_gain = geometry_gain.unwrap_or(1.0);
        if let IrNodeKind::Group {
            transform,
            animation,
            ..
        } = &node.kind
        {
            if let Some(transform) = transform {
                local_gain = local_gain.max(static_gain(
                    transform,
                    node.bbox,
                    &node.node_id,
                    animation.is_some(),
                )?);
            }
            if let Some(animation) = animation {
                local_gain = local_gain.max(animated_gain(animation, node.bbox, &node.node_id)?);
            }
        }
        if let IrNodeKind::Text {
            unit_animation: Some(animation),
            ..
        } = &node.kind
        {
            local_gain = local_gain.max(animated_gain(
                &animation.animation,
                node.bbox,
                &node.node_id,
            )?);
        }
        if upper_product(local_gain, descendant_gain) > GAIN_MAX {
            return Err(invalid(&node.node_id, "skew chain gain exceeds 65536"));
        }
        local_gain
    } else {
        1.0
    };
    match &node.kind {
        IrNodeKind::Path { path_geometry, .. } => {
            if let Some(bounds) = path_geometry.bounds {
                paint_radius = (bounds.min_x + node.bbox.x)
                    .abs()
                    .max((bounds.max_x + node.bbox.x).abs())
                    .hypot(
                        (bounds.min_y + node.bbox.y)
                            .abs()
                            .max((bounds.max_y + node.bbox.y).abs()),
                    )
                    + path_geometry.stroke_outset.radius * path_geometry.stroke_outset.multiplier;
            }
        }
        IrNodeKind::Rect {
            stroke,
            stroke_width,
            stroke_miterlimit,
            ..
        } => {
            paint_radius += stroke_outset(stroke.as_deref(), *stroke_width, *stroke_miterlimit);
        }
        IrNodeKind::Shape {
            shape_parts,
            stroke,
            stroke_width,
            stroke_miterlimit,
            ..
        } => {
            for part in shape_parts {
                let paint = part.paint.as_ref();
                let outset = stroke_outset(
                    paint
                        .and_then(|paint| paint.stroke.as_deref())
                        .or(stroke.as_deref()),
                    paint.and_then(|paint| paint.stroke_width).or(*stroke_width),
                    paint
                        .and_then(|paint| paint.stroke_miterlimit)
                        .or(*stroke_miterlimit),
                );
                paint_radius =
                    paint_radius.max(path_radius(&part.d, node.bbox.x, node.bbox.y) + outset);
                if let Some(path) = &part.stroke_d {
                    paint_radius =
                        paint_radius.max(path_radius(path, node.bbox.x, node.bbox.y) + outset);
                }
            }
        }
        IrNodeKind::Text {
            glyph_paths,
            text_decorations,
            unit_animation,
            strokes,
            stroke,
            stroke_width,
            stroke_miterlimit,
            ..
        } => {
            let node_outset = strokes.as_ref().map_or_else(
                || stroke_outset(stroke.as_deref(), *stroke_width, *stroke_miterlimit),
                |layers| {
                    layers
                        .iter()
                        .map(|layer| {
                            stroke_outset(
                                Some(&layer.color),
                                Some(layer.width_px),
                                layer.miterlimit,
                            )
                        })
                        .fold(0.0_f64, f64::max)
                },
            );
            paint_radius += node_outset;
            for path in glyph_paths.iter().flatten() {
                let outset = path.strokes.as_ref().map_or(node_outset, |layers| {
                    layers
                        .iter()
                        .map(|layer| {
                            stroke_outset(
                                Some(&layer.color),
                                Some(layer.width_px),
                                layer.miterlimit,
                            )
                        })
                        .fold(0.0_f64, f64::max)
                });
                paint_radius = paint_radius.max(path_radius(&path.d, 0.0, 0.0) + outset);
            }
            for fragment in text_decorations.iter().flatten() {
                for path in &fragment.paths {
                    paint_radius =
                        paint_radius.max(path_radius(&path.d, path.origin_x, path.origin_y));
                }
            }
            if let Some(animation) = unit_animation {
                paint_radius = animated_radius(&animation.animation, paint_radius, paint_radius);
            }
        }
        _ => {}
    }
    if let IrNodeKind::Group {
        box_shadow: Some(shadow),
        ..
    } = &node.kind
        && descendant_gain.is_some()
    {
        paint_radius = filter_radius(
            paint_radius,
            shadow.dx,
            shadow.dy,
            shadow.blur,
            shadow.spread,
            &node.node_id,
        )?;
    }
    if let IrNodeKind::Text {
        shadows,
        glyph_paths,
        ..
    } = &node.kind
        && descendant_gain.is_some()
    {
        let source_radius = paint_radius;
        for shadow in shadows.iter().flatten().chain(
            glyph_paths
                .iter()
                .flatten()
                .flat_map(|path| path.shadows.iter().flatten()),
        ) {
            paint_radius = paint_radius.max(filter_radius(
                source_radius,
                shadow.dx,
                shadow.dy,
                shadow.blur_px.unwrap_or(0.0),
                0.0,
                &node.node_id,
            )?);
        }
    }
    if let IrNodeKind::Group {
        clip: Some(clip), ..
    } = &node.kind
    {
        paint_radius = match clip {
            BoxClip::Empty => 0.0,
            BoxClip::BoxContour(contour) => {
                paint_radius.min(bbox_magnitude(contour.bbox) * std::f64::consts::SQRT_2)
            }
        };
    }
    if is_affected && !matches!(node.kind, IrNodeKind::Group { .. }) {
        magnitude(
            [paint_radius],
            COORDINATE_MAX * std::f64::consts::SQRT_2,
            &node.node_id,
        )?;
    }
    let local_radius = paint_radius;
    if let IrNodeKind::Group {
        transform,
        animation,
        ..
    } = &node.kind
    {
        if let Some(transform) = transform {
            let gain = transform
                .scale_x
                .unwrap_or(1.0)
                .abs()
                .max(transform.scale_y.unwrap_or(1.0).abs())
                * if transform.skew_x_deg.unwrap_or(0.0) == 0.0 {
                    1.0
                } else {
                    4.0
                }
                * if transform.skew_y_deg.unwrap_or(0.0) == 0.0 {
                    1.0
                } else {
                    4.0
                };
            let linear_identity = transform.rotate_deg.unwrap_or(0.0) == 0.0
                && gain == 1.0
                && transform.scale_x.unwrap_or(1.0) == 1.0
                && transform.scale_y.unwrap_or(1.0) == 1.0;
            let origin_radius = (node.bbox.x + transform.origin_x.unwrap_or(0.0))
                .hypot(node.bbox.y + transform.origin_y.unwrap_or(0.0));
            let shift = transform
                .translate_x
                .unwrap_or(0.0)
                .hypot(transform.translate_y.unwrap_or(0.0))
                + if linear_identity {
                    0.0
                } else {
                    (1.0 + gain) * origin_radius
                };
            paint_radius = paint_radius * gain + shift;
        }
        if let Some(animation) = animation {
            let origin_radius =
                (node.bbox.x + node.bbox.w / 2.0).hypot(node.bbox.y + node.bbox.h / 2.0);
            paint_radius =
                paint_radius.max(animated_radius(animation, local_radius, origin_radius));
        }
    }
    let Some(descendant_gain) = descendant_gain else {
        return Ok((None, paint_radius));
    };
    if is_affected {
        magnitude(
            [
                node.bbox.x,
                node.bbox.y,
                node.bbox.w,
                node.bbox.h,
                node.bbox.x + node.bbox.w,
                node.bbox.y + node.bbox.h,
            ],
            COORDINATE_MAX,
            &node.node_id,
        )?;
        match &node.kind {
            IrNodeKind::Path {
                path_data,
                path_geometry,
                ..
            } => {
                let extent = path_magnitude(path_data, node.bbox.x, node.bbox.y, &node.node_id)?;
                magnitude(
                    [extent
                        + path_geometry.stroke_outset.radius
                            * path_geometry.stroke_outset.multiplier],
                    COORDINATE_MAX,
                    &node.node_id,
                )?;
            }
            IrNodeKind::Text {
                glyph_paths,
                text_decorations,
                ..
            } => {
                for path in glyph_paths.iter().flatten() {
                    path_magnitude(&path.d, 0.0, 0.0, &node.node_id)?;
                }
                for fragment in text_decorations.iter().flatten() {
                    for path in &fragment.paths {
                        path_magnitude(&path.d, path.origin_x, path.origin_y, &node.node_id)?;
                    }
                }
            }
            IrNodeKind::Shape { shape_parts, .. } => {
                for part in shape_parts {
                    path_magnitude(&part.d, node.bbox.x, node.bbox.y, &node.node_id)?;
                    if let Some(stroke) = &part.stroke_d {
                        path_magnitude(stroke, node.bbox.x, node.bbox.y, &node.node_id)?;
                    }
                }
            }
            _ => {}
        }
    }
    Ok((
        Some(upper_product(local_gain, descendant_gain)),
        paint_radius,
    ))
}

fn tree_has_skew(node: &IrNode) -> bool {
    match &node.kind {
        IrNodeKind::Group {
            transform,
            animation,
            children,
            ..
        } => {
            transform.as_ref().is_some_and(has_skew)
                || animation.as_ref().is_some_and(track_has_skew)
                || children.iter().any(tree_has_skew)
        }
        IrNodeKind::Text { unit_animation, .. } => unit_animation
            .as_ref()
            .is_some_and(|animation| track_has_skew(&animation.animation)),
        _ => false,
    }
}

fn validate_resource_tree(node: &IrNode) -> Result<(), EngineError> {
    validate_resources(node)?;
    if let IrNodeKind::Group { children, .. } = &node.kind {
        for child in children {
            validate_resource_tree(child)?;
        }
    }
    Ok(())
}

/// Check the actual glyph geometry at the native outline materialization boundary.
///
/// # Errors
///
/// Returns structured validation errors for malformed paint resources or unsafe skew paint geometry.
pub(crate) fn validate_resolved_root(root: &IrNode) -> Result<(), EngineError> {
    if !tree_has_skew(root) {
        return validate_resource_tree(root);
    }
    visit(root, false, 0, &HashMap::new())?;
    Ok(())
}

fn validate_css_skew_segment(
    start: Option<&AnimationTransform2D>,
    end: Option<&AnimationTransform2D>,
    hull: (f64, f64),
    node_id: &str,
) -> Result<(), EngineError> {
    if !hull.0.is_finite() || !hull.1.is_finite() {
        return Err(invalid(node_id, "non-finite CSS easing hull"));
    }
    for (first, last) in [
        (
            start.and_then(|value| value.skew_x_deg).unwrap_or(0.0),
            end.and_then(|value| value.skew_x_deg).unwrap_or(0.0),
        ),
        (
            start.and_then(|value| value.skew_y_deg).unwrap_or(0.0),
            end.and_then(|value| value.skew_y_deg).unwrap_or(0.0),
        ),
    ] {
        for easing in [hull.0, hull.1] {
            let (lower, upper) = interpolated_bounds(first, last, easing);
            if !lower.is_finite() || !upper.is_finite() || lower.abs().max(upper.abs()) >= 70.0 {
                return Err(invalid(
                    node_id,
                    "CSS skew interpolation exceeds its execution envelope",
                ));
            }
        }
    }
    Ok(())
}

/// Check the actual CSS easing operands before collecting an independent skew track.
///
/// # Errors
///
/// Returns structured validation errors when a declared interval cannot stay inside the skew execution guard.
pub(crate) fn validate_independent_css_skew(
    spec: &AnimationSpec,
    node_id: &str,
) -> Result<(), EngineError> {
    if !track_has_skew(spec) {
        return Ok(());
    }
    let hull = match &spec.easing {
        Some(AnimationEasing::CubicBezier([_, first, _, second])) => {
            let first = crate::svg_emit::num_format::round_number(*first, 6)?;
            let second = crate::svg_emit::num_format::round_number(*second, 6)?;
            (first.min(second).min(0.0), first.max(second).max(1.0))
        }
        Some(AnimationEasing::Spring(_)) => (-0.000_001, 2.000_001),
        _ => (0.0, 1.0),
    };
    for pair in spec.keyframes.windows(2) {
        validate_css_skew_segment(
            pair[0].transform.as_ref(),
            pair[1].transform.as_ref(),
            hull,
            node_id,
        )?;
    }
    Ok(())
}

/// Check the resolved document-timeline curves that CSS will interpolate.
///
/// # Errors
///
/// Returns structured validation errors before emission for a non-finite or out-of-envelope skew segment.
pub(crate) fn validate_timeline_css_skew(
    keyframes: &[super::animation_timeline::DocumentKeyframe],
    node_id: &str,
) -> Result<(), EngineError> {
    use super::animation_timeline::CompiledCssEasing;
    if !keyframes
        .iter()
        .filter_map(|keyframe| keyframe.value.transform.as_ref())
        .any(|transform| {
            transform.skew_x_deg.unwrap_or(0.0) != 0.0 || transform.skew_y_deg.unwrap_or(0.0) != 0.0
        })
    {
        return Ok(());
    }
    for pair in keyframes.windows(2) {
        let hull = match &pair[0].easing_to_next {
            Some(CompiledCssEasing::CubicBezier([_, first, _, second])) => {
                (first.min(*second).min(0.0), first.max(*second).max(1.0))
            }
            Some(CompiledCssEasing::OutputScaledLinear(alpha)) => (alpha.min(0.0), alpha.max(1.0)),
            _ => (0.0, 1.0),
        };
        validate_css_skew_segment(
            pair[0].value.transform.as_ref(),
            pair[1].value.transform.as_ref(),
            hull,
            node_id,
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::wire_input::IrNodeInput;
    use serde_json::json;

    fn scene(transform: &serde_json::Value) -> Ir {
        Ir { root: IrNode::from(serde_json::from_value::<IrNodeInput>(json!({ "ownership": { "role": "source" },
            "type":"group", "nodeId":"owner", "bbox":{"x":0,"y":0,"w":100,"h":100},
            "transform":transform, "children":[{ "ownership": { "role": "source" },"type":"rect","nodeId":"paint","bbox":{"x":0,"y":0,"w":100,"h":100},"fill":"red"}]
        })).expect("fixture")), width:100.0,height:100.0,warnings:vec![],debug:None }
    }

    #[test]
    fn resolved_clip_axes_stay_in_the_shared_box_contour_domain() {
        for radius in [0.0, 50.0, -1.0, 50.0_f64.next_up(), 80.0] {
            let mut ir = scene(&json!({}));
            if let IrNodeKind::Group { clip, .. } = &mut ir.root.kind {
                *clip = Some(BoxClip::BoxContour(super::super::types::BoxContour {
                    bbox: ir.root.bbox,
                    corners: [super::super::types::CornerRadius {
                        rx: radius,
                        ry: radius,
                    }; 4],
                }));
            }
            assert_eq!(validate(&ir).is_ok(), (0.0..=50.0).contains(&radius));
        }
    }

    #[test]
    fn angle_scale_and_viewport_boundaries_are_closed_before_paint() {
        for angle in [-60.0, 60.0] {
            assert!(
                validate(&scene(
                    &json!({"skewXDeg":angle,"scaleX":2048,"scaleY":2048})
                ))
                .is_ok()
            );
        }
        assert!(validate(&scene(&json!({"skewXDeg":60.0_f64.next_up()}))).is_err());
        assert!(validate(&scene(&json!({"skewXDeg":1,"scaleX":2048.0_f64.next_up()}))).is_err());
        assert!(validate(&scene(&json!({"skewXDeg":1,"scaleX":1e38}))).is_err());
        let mut viewport = scene(&json!({"skewXDeg":12}));
        viewport.width = COORDINATE_MAX;
        assert!(validate(&viewport).is_ok());
        viewport.width = COORDINATE_MAX.next_up();
        assert!(validate(&viewport).is_err());
        assert!(validate(&scene(&json!({"skewXDeg":-0.0,"scaleX":1e308}))).is_ok());
    }

    #[test]
    fn rotations_do_not_spend_the_gain_budget_and_exact_gain_ceiling_is_accepted() {
        let mut ir = scene(&json!({"skewXDeg":12}));
        for index in 0..48 {
            ir.root = IrNode {
                ownership: crate::ir::ownership::IrNodeOwnership::Source {
                    on: None,
                    meta: None,
                },
                node_id: format!("rotation-{index}"),
                bbox: ir.root.bbox,
                kind: IrNodeKind::Group {
                    transform: Some(Transform2D {
                        rotate_deg: Some(45.0),
                        ..Default::default()
                    }),
                    children: vec![ir.root],
                    clip: None,
                    opacity: None,
                    box_shadow: None,
                    animation: None,
                },
            };
        }
        assert!(validate(&ir).is_ok());
        let mut ir = scene(&json!({"skewXDeg":12,"skewYDeg":12}));
        for index in 0..3 {
            ir.root = IrNode {
                ownership: crate::ir::ownership::IrNodeOwnership::Source {
                    on: None,
                    meta: None,
                },
                node_id: format!("shear-{index}"),
                bbox: ir.root.bbox,
                kind: IrNodeKind::Group {
                    transform: Some(Transform2D {
                        skew_x_deg: Some(12.0),
                        skew_y_deg: Some(12.0),
                        ..Default::default()
                    }),
                    children: vec![ir.root],
                    clip: None,
                    opacity: None,
                    box_shadow: None,
                    animation: None,
                },
            };
        }
        assert!(validate(&ir).is_ok());
        if let IrNodeKind::Group {
            transform: Some(transform),
            ..
        } = &mut ir.root.kind
        {
            transform.scale_x = Some(1.00001);
        }
        assert!(validate(&ir).is_err());
        assert_eq!(upper_product(1.0, GAIN_MAX), GAIN_MAX);
    }

    #[test]
    fn easing_is_checked_as_a_tuple_instead_of_banning_springs() {
        let mut ir = scene(&json!({}));
        for (start, end, accepted) in [(0, 12, true), (52, 60, false)] {
            if let IrNodeKind::Group { animation, .. } = &mut ir.root.kind {
                *animation=Some(serde_json::from_value::<crate::ir::wire_input::AnimationSpecInput>(json!({
                    "durationMs":400,"easing":{"type":"spring"},"keyframes":[{"at":0,"transform":{"skewXDeg":start}},{"at":1,"transform":{"skewXDeg":end}}]
                })).expect("spring").into());
            }
            assert_eq!(validate(&ir).is_ok(), accepted);
        }
    }
    #[test]
    fn css_skew_segments_share_the_execution_guard_after_rounding_and_timeline_cuts() {
        let first = AnimationTransform2D {
            skew_x_deg: Some(12.0),
            skew_y_deg: Some(-7.0),
            ..Default::default()
        };
        let last = AnimationTransform2D {
            skew_x_deg: Some(60.0),
            skew_y_deg: Some(0.0),
            ..Default::default()
        };
        assert!(validate_css_skew_segment(Some(&first), Some(&last), (0.0, 1.0), "owner").is_ok());
        assert!(validate_css_skew_segment(Some(&first), Some(&last), (0.0, 2.0), "owner").is_err());
        assert!(
            validate_css_skew_segment(
                Some(&first),
                Some(&first),
                (f64::NEG_INFINITY, 1.0),
                "owner"
            )
            .is_err()
        );
        assert_eq!(interpolated_bounds(12.0, 60.0, 1.0), (60.0, 60.0));
        assert_eq!(upper_product(1.0, 65_536.0), 65_536.0);
    }
}
