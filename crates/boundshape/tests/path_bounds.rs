//! General Path enclosure, completed-prefix, and strict-parser regression oracles.

use boundshape::{PathBounds, measure_single_svg_path, parse_path_bounds};

#[test]
fn relative_repeated_commands_and_multiple_subpaths_keep_all_extrema() {
    let parsed = parse_path_bounds("m10 10 20 0 h-5 v20 l-10 0 z M-40 -20 l5 10");
    assert_eq!(parsed.error_offset, None);
    assert_eq!(
        parsed.bounds,
        Some(PathBounds {
            min_x: -40.0,
            min_y: -20.0,
            max_x: 30.0,
            max_y: 30.0
        })
    );
}

#[test]
fn curves_use_control_hulls_and_reflected_controls() {
    let parsed = parse_path_bounds("M0 0 C10 40 20 -20 30 0 S50 20 60 0 Q70 -40 80 0 T100 0");
    assert_eq!(parsed.error_offset, None);
    assert_eq!(
        parsed.bounds,
        Some(PathBounds {
            min_x: 0.0,
            min_y: -40.0,
            max_x: 100.0,
            max_y: 40.0
        })
    );
}

#[test]
fn failures_retain_each_completed_argument_group_and_contour() {
    for path in [
        "M0 0 L10 10 #",
        "M0 0 L10 10 20",
        "M0 0 C1 1 2 2 10 10 4 4",
        "M0 0 Q1 1 10 10 4",
        "M0 0 S1 1 10 10 4",
        "M0 0 T10 10 4",
        "M0 0 H10 V10 M20",
        "M0 0 L10 10 A10 10 0 2 1 30 30",
        "M0 0 L10 10 M1e308 0 l1e308 0",
    ] {
        let parsed = parse_path_bounds(path);
        assert!(parsed.error_offset.is_some(), "{path}");
        assert_eq!(
            parsed.bounds,
            Some(PathBounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 10.0,
                max_y: 10.0
            }),
            "{path}"
        );
    }
    assert_eq!(parse_path_bounds("M0 0L10 10 #").error_offset, Some(11));
}

#[test]
fn zero_and_tiny_drawable_segments_remain_distinct_from_bare_moves() {
    for path in ["", "M40 40", "M40 40 M50 50"] {
        assert_eq!(parse_path_bounds(path).bounds, None);
        assert_eq!(parse_path_bounds(path).error_offset, None);
    }
    for path in ["M40 40Z", "M40 40L40 40", "M40 40H40", "M40 40V40"] {
        assert_eq!(
            parse_path_bounds(path).bounds,
            Some(PathBounds {
                min_x: 40.0,
                min_y: 40.0,
                max_x: 40.0,
                max_y: 40.0
            })
        );
    }
    let parsed = parse_path_bounds("M0 0L0.00000000001 0");
    assert_eq!(parsed.bounds.expect("tiny drawable line").max_x, 1e-11);
    assert!(measure_single_svg_path("M0 0L0 0").is_err());
    assert!(measure_single_svg_path("M0 0L10 10 #").is_err());
    assert!(measure_single_svg_path("M0 0C1 1 2 2 10 10 4 4").is_err());
}

#[test]
fn finite_extrema_do_not_require_a_representable_span() {
    let parsed = parse_path_bounds("M-1e308 0L1e308 10");
    assert_eq!(parsed.error_offset, None);
    let bounds = parsed.bounds.expect("finite endpoints");
    assert!(bounds.min_x.is_finite() && bounds.max_x.is_finite());
    assert!((bounds.max_x - bounds.min_x).is_infinite());
}

#[test]
fn original_arcs_are_enclosed_after_radius_correction() {
    for path in [
        "M0 0A10 10 0 0 1 20 0",
        "M0 0a1e-200 1e-200 0 0 1 100 0",
        "M0 0A1e12 1e12 37 0 1 100 0",
        "M0 0A20 10 45 0110 20",
    ] {
        let parsed = parse_path_bounds(path);
        assert_eq!(parsed.error_offset, None, "{path}");
        let bounds = parsed.bounds.expect("drawable arc");
        assert!(bounds.min_x <= 0.0 && bounds.min_y <= -10.0);
        assert!(bounds.max_x >= 20.0 && bounds.max_y >= 10.0);
        assert!(
            [bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y]
                .iter()
                .all(|value| value.is_finite())
        );
    }
    assert_eq!(
        parse_path_bounds("M10 10A0 10 0 0 1 30 20").bounds,
        Some(PathBounds {
            min_x: 10.0,
            min_y: 10.0,
            max_x: 30.0,
            max_y: 20.0
        })
    );
    assert_eq!(parse_path_bounds("M10 10A20 20 0 1 1 10 10").bounds, None);
}

#[test]
fn native_paint_projection_retains_subnormal_arcs_and_later_segments() {
    for path_data in [
        "M10 50A1e-320 10 0 0 0 90 50V90",
        "M10 50A10 1e-320 90 0 0 90 50V90",
    ] {
        let parsed = parse_path_bounds(path_data);
        assert!(
            parsed.error_offset.is_some(),
            "authored ellipse arithmetic degradation remains explicit"
        );
        let bounds = parsed.bounds.expect("native zero-radius arc paints a line");
        assert!(bounds.min_x <= 10.0 && bounds.max_x >= 90.0);
        assert!(bounds.min_y <= 50.0 && bounds.max_y >= 90.0);
        assert!(
            [bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y]
                .iter()
                .all(|value| value.is_finite())
        );
    }
}

#[test]
fn native_float_relative_rounding_cannot_escape_the_candidate_enclosure() {
    let parsed = parse_path_bounds("M100000000 20h3h3h3h3h3h3h3h3");
    let bounds = parsed.bounds.expect("relative lines");
    assert!(bounds.min_x <= 100_000_000.0 && bounds.max_x >= 100_000_024.0);
    assert!(parsed.error_offset.is_none());
    // Native floats round each +3 at this magnitude back to the starting x;
    // authored doubles retain the whole 24px progression. Both are enclosed.
}
