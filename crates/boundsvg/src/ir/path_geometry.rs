//! Canonical output-only Path geometry, independent of layout placement.

use super::types::{PathGeometry, PathStrokeOutset, StrokeLinecap, StrokeLinejoin, StrokeScaling};
use crate::svg_emit::num_format::round_finite_number;

/// Derive conservative geometry once at Path construction, retaining the
/// completed prefix of malformed data without changing rendering failures.
///
/// Stroke factors cover both authored and emitted decimal widths. Invalid
/// negative SVG widths use the native one-pixel default. Non-finite domain
/// fields still fail through the existing finite-output/emission validation;
/// this projection does not introduce a new failure phase.
pub(crate) fn derive_path_geometry(
    path_data: &str,
    stroke: Option<&str>,
    stroke_width: Option<f64>,
    stroke_scaling: Option<StrokeScaling>,
    stroke_linecap: Option<StrokeLinecap>,
    stroke_linejoin: Option<StrokeLinejoin>,
    stroke_miterlimit: Option<f64>,
) -> PathGeometry {
    let parsed = boundshape::parse_path_bounds(path_data);
    let has_stroke = stroke.is_some_and(|paint| !paint.is_empty() && paint != "none");
    let width = stroke_width
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or(1.0);
    let precision = if stroke_scaling == Some(StrokeScaling::Canvas) {
        6
    } else {
        2
    };
    let radius = if has_stroke {
        width.max(round_finite_number(width, precision)) * 0.5
    } else {
        0.0
    };
    let cap_multiplier = if stroke_linecap == Some(StrokeLinecap::Square) {
        std::f64::consts::SQRT_2
    } else {
        1.0
    };
    let join_multiplier =
        if stroke_linejoin.unwrap_or(StrokeLinejoin::Miter) == StrokeLinejoin::Miter {
            let limit = stroke_miterlimit
                .filter(|value| value.is_finite() && *value >= 1.0)
                .unwrap_or(4.0);
            limit.max(round_finite_number(limit, 2))
        } else {
            1.0
        };
    PathGeometry {
        bounds: parsed.bounds,
        stroke_outset: PathStrokeOutset {
            radius,
            multiplier: cap_multiplier.max(join_multiplier),
        },
        is_complete: parsed.error_offset.is_none(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stroke_defaults_caps_joins_and_decimal_widths_are_conservative() {
        let geometry = |width, scaling, cap, join, miter| {
            derive_path_geometry("M0 0L10 0", Some("red"), width, scaling, cap, join, miter)
                .stroke_outset
        };
        assert_eq!(
            geometry(None, None, None, None, None),
            PathStrokeOutset {
                radius: 0.5,
                multiplier: 4.0
            }
        );
        assert_eq!(
            geometry(Some(-20.0), None, None, None, Some(-2.0)).radius,
            0.5
        );
        assert_eq!(geometry(Some(0.0), None, None, None, None).radius, 0.0);
        assert_eq!(
            geometry(Some(1.006), None, None, Some(StrokeLinejoin::Bevel), None).radius,
            0.505
        );
        assert_eq!(
            geometry(
                Some(1.000_000_6),
                Some(StrokeScaling::Canvas),
                None,
                None,
                None
            )
            .radius,
            0.500_000_5
        );
        assert_eq!(
            geometry(
                Some(2.0),
                None,
                Some(StrokeLinecap::Square),
                Some(StrokeLinejoin::Round),
                None
            )
            .multiplier,
            std::f64::consts::SQRT_2
        );
        assert_eq!(
            geometry(Some(2.0), None, None, None, Some(1.001)).multiplier,
            1.001
        );
        let huge = geometry(Some(f64::MAX), None, None, None, Some(f64::MAX));
        assert!(huge.radius.is_finite() && huge.multiplier.is_finite());
        assert_eq!(huge.radius * huge.multiplier, f64::INFINITY);
    }
}
