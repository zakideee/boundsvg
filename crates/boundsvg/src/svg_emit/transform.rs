//! SVG transform attribute emission.
//!
//! Mirrors `packages/core/src/transform.ts`: `transformToSvg`,
//! `resolveNodeLocalTransform`, `hasTransform`, and the emitter's
//! `getTransformAttr`. Numbers format via ECMAScript `String(number)`
//! (`formatSvgNumber` there is observably identical to `String`).

use boundshape::Transform2D;

use super::num_format::format_js_number;
use crate::ir::types::BBox;

/// SVG-order affine matrix: `(x, y) -> (a*x + c*y + e, b*x + d*y + f)`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct AffineMatrix {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl AffineMatrix {
    #[must_use]
    pub const fn identity() -> Self {
        Self {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            e: 0.0,
            f: 0.0,
        }
    }

    #[must_use]
    pub fn multiply(self, rhs: Self) -> Self {
        Self {
            a: self.a * rhs.a + self.c * rhs.b,
            b: self.b * rhs.a + self.d * rhs.b,
            c: self.a * rhs.c + self.c * rhs.d,
            d: self.b * rhs.c + self.d * rhs.d,
            e: self.a * rhs.e + self.c * rhs.f + self.e,
            f: self.b * rhs.e + self.d * rhs.f + self.f,
        }
    }
}

fn translate_matrix(tx: f64, ty: f64) -> AffineMatrix {
    AffineMatrix {
        e: tx,
        f: ty,
        ..AffineMatrix::identity()
    }
}

fn rotate_matrix(angle_deg: f64, origin_x: f64, origin_y: f64) -> AffineMatrix {
    let (sin, cos) = angle_deg.to_radians().sin_cos();
    let rotation = AffineMatrix {
        a: cos,
        b: sin,
        c: -sin,
        d: cos,
        e: 0.0,
        f: 0.0,
    };
    translate_matrix(origin_x, origin_y)
        .multiply(rotation)
        .multiply(translate_matrix(-origin_x, -origin_y))
}

fn scale_matrix(scale_x: f64, scale_y: f64, origin_x: f64, origin_y: f64) -> AffineMatrix {
    let scale = AffineMatrix {
        a: scale_x,
        b: 0.0,
        c: 0.0,
        d: scale_y,
        e: 0.0,
        f: 0.0,
    };
    translate_matrix(origin_x, origin_y)
        .multiply(scale)
        .multiply(translate_matrix(-origin_x, -origin_y))
}

/// Build the SVG `transform` attribute value for a transform.
/// Mirrors TS `transformToSvg` — command order is translate → rotate →
/// scale (with the origin translate sandwich when the origin is non-zero).
#[must_use]
pub fn transform_to_svg(transform: &Transform2D) -> String {
    let mut commands: Vec<String> = Vec::new();
    let translate_x = transform.translate_x.unwrap_or(0.0);
    let translate_y = transform.translate_y.unwrap_or(0.0);
    if translate_x != 0.0 || translate_y != 0.0 {
        commands.push(format!(
            "translate({} {})",
            format_js_number(translate_x),
            format_js_number(translate_y)
        ));
    }

    let origin_x = transform.origin_x.unwrap_or(0.0);
    let origin_y = transform.origin_y.unwrap_or(0.0);
    if let Some(rotate_deg) = transform.rotate_deg {
        commands.push(format!(
            "rotate({} {} {})",
            format_js_number(rotate_deg),
            format_js_number(origin_x),
            format_js_number(origin_y)
        ));
    }
    if transform.scale_x.is_some() || transform.scale_y.is_some() {
        let scale_x = transform.scale_x.unwrap_or(1.0);
        let scale_y = transform.scale_y.unwrap_or(1.0);
        if origin_x != 0.0 || origin_y != 0.0 {
            commands.push(format!(
                "translate({} {})",
                format_js_number(origin_x),
                format_js_number(origin_y)
            ));
            commands.push(format!(
                "scale({} {})",
                format_js_number(scale_x),
                format_js_number(scale_y)
            ));
            commands.push(format!(
                "translate({} {})",
                format_js_number(-origin_x),
                format_js_number(-origin_y)
            ));
        } else {
            commands.push(format!(
                "scale({} {})",
                format_js_number(scale_x),
                format_js_number(scale_y)
            ));
        }
    }
    commands.join(" ")
}

/// Mirror of TS `hasTransform`: a transform paints only when its SVG
/// attribute value is non-empty.
#[must_use]
pub fn has_transform(transform: &Transform2D) -> bool {
    !transform_to_svg(transform).is_empty()
}

/// Rebase the transform origin onto the node's bbox origin.
/// Mirrors TS `resolveNodeLocalTransform`.
#[must_use]
pub fn resolve_node_local_transform(transform: &Transform2D, bbox: BBox) -> Transform2D {
    Transform2D {
        origin_x: Some(bbox.x + transform.origin_x.unwrap_or(0.0)),
        origin_y: Some(bbox.y + transform.origin_y.unwrap_or(0.0)),
        ..transform.clone()
    }
}

/// Resolved `transform` attribute value for a node, or `None` when the node
/// has no painting transform. Mirrors the emitter's `getTransformAttr`.
#[must_use]
pub fn node_transform_attr(transform: Option<&Transform2D>, bbox: BBox) -> Option<String> {
    let transform = transform?;
    if !has_transform(transform) {
        return None;
    }
    let scene_transform = resolve_node_local_transform(transform, bbox);
    let transform_attr = transform_to_svg(&scene_transform);
    if transform_attr.is_empty() {
        None
    } else {
        Some(transform_attr)
    }
}

/// Resolve a node transform to the same affine matrix represented by the SVG
/// transform attribute. Matrix composition follows the emitted command order.
#[must_use]
pub(crate) fn node_transform_matrix(transform: Option<&Transform2D>, bbox: BBox) -> AffineMatrix {
    let Some(transform) = transform else {
        return AffineMatrix::identity();
    };
    if !has_transform(transform) {
        return AffineMatrix::identity();
    }
    let resolved = resolve_node_local_transform(transform, bbox);
    let mut matrix = AffineMatrix::identity();
    let translate_x = resolved.translate_x.unwrap_or(0.0);
    let translate_y = resolved.translate_y.unwrap_or(0.0);
    if translate_x != 0.0 || translate_y != 0.0 {
        matrix = matrix.multiply(translate_matrix(translate_x, translate_y));
    }
    if let Some(rotate_deg) = resolved.rotate_deg {
        matrix = matrix.multiply(rotate_matrix(
            rotate_deg,
            resolved.origin_x.unwrap_or(0.0),
            resolved.origin_y.unwrap_or(0.0),
        ));
    }
    if resolved.scale_x.is_some() || resolved.scale_y.is_some() {
        matrix = matrix.multiply(scale_matrix(
            resolved.scale_x.unwrap_or(1.0),
            resolved.scale_y.unwrap_or(1.0),
            resolved.origin_x.unwrap_or(0.0),
            resolved.origin_y.unwrap_or(0.0),
        ));
    }
    matrix
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn bbox(x: f64, y: f64) -> BBox {
        BBox::new(x, y, 10.0, 10.0)
    }

    #[test]
    fn zero_translate_is_a_no_op() {
        let transform = Transform2D {
            translate_x: Some(0.0),
            translate_y: Some(0.0),
            ..Transform2D::default()
        };
        assert!(!has_transform(&transform));
        assert_eq!(node_transform_attr(Some(&transform), bbox(0.0, 0.0)), None);
    }

    #[test]
    fn identity_rotate_still_emits() {
        let transform = Transform2D {
            rotate_deg: Some(0.0),
            origin_x: Some(10.0),
            origin_y: Some(20.0),
            ..Transform2D::default()
        };
        assert_eq!(
            node_transform_attr(Some(&transform), bbox(5.0, 5.0)),
            Some("rotate(0 15 25)".to_string())
        );
    }

    #[test]
    fn scale_with_origin_uses_the_translate_sandwich() {
        let transform = Transform2D {
            scale_x: Some(2.0),
            origin_x: Some(1.0),
            origin_y: Some(2.0),
            ..Transform2D::default()
        };
        assert_eq!(
            transform_to_svg(&transform),
            "translate(1 2) scale(2 1) translate(-1 -2)"
        );
    }

    #[test]
    fn command_order_is_translate_rotate_scale() {
        let transform = Transform2D {
            translate_x: Some(3.0),
            rotate_deg: Some(45.0),
            scale_x: Some(2.0),
            scale_y: Some(3.0),
            ..Transform2D::default()
        };
        assert_eq!(
            transform_to_svg(&transform),
            "translate(3 0) rotate(45 0 0) scale(2 3)"
        );
    }

    #[test]
    fn affine_matrix_matches_the_typescript_reference_order() {
        let transform = Transform2D {
            translate_x: Some(3.0),
            translate_y: Some(-4.0),
            rotate_deg: Some(90.0),
            scale_x: Some(2.0),
            scale_y: Some(2.0),
            origin_x: Some(1.0),
            origin_y: Some(2.0),
        };
        let matrix = node_transform_matrix(Some(&transform), bbox(5.0, 7.0));
        assert!((matrix.a - 0.0).abs() < 1e-12);
        assert!((matrix.b - 2.0).abs() < 1e-12);
        assert!((matrix.c + 2.0).abs() < 1e-12);
        assert!((matrix.d - 0.0).abs() < 1e-12);
        assert!((matrix.e - 27.0).abs() < 1e-12);
        assert!((matrix.f + 7.0).abs() < 1e-12);
    }

    #[test]
    fn affine_matrix_multiplication_matches_nested_svg_groups() {
        let parent = AffineMatrix {
            a: 2.0,
            d: 2.0,
            ..AffineMatrix::identity()
        };
        let child = translate_matrix(3.0, 4.0);
        assert_eq!(
            parent.multiply(child),
            AffineMatrix {
                a: 2.0,
                b: 0.0,
                c: 0.0,
                d: 2.0,
                e: 6.0,
                f: 8.0,
            }
        );
    }
}
