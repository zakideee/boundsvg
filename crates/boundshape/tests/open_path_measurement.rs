use std::fmt::Write;

use boundshape::{
    Contour, CurveSegment, PathTraversalDirection, Point2D, Region, ShapeError,
    measure_single_svg_path, measured_path_offset_band,
    project_region_intersection_to_measured_path_interval,
    project_region_to_measured_path_interval, region_axis_bounds,
};
use proptest::prelude::*;

const EPSILON: f64 = 1e-12;

fn assert_close(actual: f64, expected: f64, epsilon: f64) {
    assert!(
        (actual - expected).abs() <= epsilon,
        "expected {expected:.17}, got {actual:.17} (epsilon {epsilon})",
    );
}

fn assert_point_close(actual: Point2D, expected: Point2D, epsilon: f64) {
    assert_close(actual.x, expected.x, epsilon);
    assert_close(actual.y, expected.y, epsilon);
}

#[test]
fn line_length_and_samples_are_exact() {
    let measured = measure_single_svg_path("M1 2l3 4h5v-2").expect("open polyline");
    assert_eq!(measured.total_length(), 12.0);

    let start = measured
        .sample(0.0, PathTraversalDirection::Forward)
        .expect("start sample");
    assert_eq!(start.point, Point2D { x: 1.0, y: 2.0 });
    assert_point_close(start.tangent, Point2D { x: 0.6, y: 0.8 }, EPSILON);

    let first_midpoint = measured
        .sample(2.5, PathTraversalDirection::Forward)
        .expect("first midpoint");
    assert_eq!(first_midpoint.point, Point2D { x: 2.5, y: 4.0 });
    assert_point_close(first_midpoint.tangent, Point2D { x: 0.6, y: 0.8 }, EPSILON);

    let vertex = measured
        .sample(5.0, PathTraversalDirection::Forward)
        .expect("vertex sample");
    assert_eq!(vertex.point, Point2D { x: 4.0, y: 6.0 });
    assert_point_close(vertex.tangent, Point2D { x: 0.6, y: 0.8 }, EPSILON);

    let horizontal = measured
        .sample(7.0, PathTraversalDirection::Forward)
        .expect("horizontal sample");
    assert_eq!(horizontal.point, Point2D { x: 6.0, y: 6.0 });
    assert_eq!(horizontal.tangent, Point2D { x: 1.0, y: 0.0 });

    let end = measured
        .sample(12.0, PathTraversalDirection::Forward)
        .expect("end sample");
    assert_eq!(end.point, Point2D { x: 9.0, y: 4.0 });
    assert_eq!(end.tangent, Point2D { x: 0.0, y: -1.0 });

    for outside in [-1.0, 12.000_001, f64::NAN, f64::INFINITY] {
        assert_eq!(
            measured.sample(outside, PathTraversalDirection::Forward),
            None,
            "distance={outside}",
        );
    }
}

#[test]
fn equivalent_svg_commands_have_identical_measurements() {
    let absolute = measure_single_svg_path("M0 0L3 4H8V6").expect("absolute path");
    let relative = measure_single_svg_path("m0 0 3 4h5v2").expect("relative path");
    assert_eq!(absolute, relative);

    let smooth_quad = measure_single_svg_path("M0 0Q10 20 20 0T40 0").expect("smooth quadratic");
    let explicit_quad =
        measure_single_svg_path("M0 0Q10 20 20 0Q30 -20 40 0").expect("explicit quadratic");
    assert_eq!(smooth_quad, explicit_quad);

    let smooth_cubic =
        measure_single_svg_path("M0 0C5 10 15 10 20 0S35 -10 40 0").expect("smooth cubic");
    let explicit_cubic =
        measure_single_svg_path("M0 0C5 10 15 10 20 0C25 -10 35 -10 40 0").expect("explicit cubic");
    assert_eq!(smooth_cubic, explicit_cubic);

    let compact_arc =
        measure_single_svg_path("M20 100A40 40 0 01120 100").expect("compact arc flags");
    let separated_arc =
        measure_single_svg_path("M20 100A40 40 0 0 1 120 100").expect("separated arc flags");
    assert_eq!(compact_arc, separated_arc);
}

#[test]
fn curve_length_and_samples_match_the_golden_table() {
    let measured =
        measure_single_svg_path("M0 0Q50 100 100 0C125 -50 175 -50 200 0A50 50 0 0 1 250 50")
            .expect("quadratic, cubic, and arc path");

    assert_eq!(measured.total_length(), 358.049_716_627_362_5);
    let golden_samples = [
        (
            0.0,
            Point2D { x: 0.0, y: 0.0 },
            Point2D {
                x: 0.470_588_235_294_117_6,
                y: 0.882_352_941_176_470_6,
            },
        ),
        (
            0.125,
            Point2D {
                x: 24.665_866_873_698_93,
                y: 37.144_983_553_305_12,
            },
            Point2D {
                x: 0.685_364_699_004_990_6,
                y: 0.728_199_992_692_802_6,
            },
        ),
        (
            0.5,
            Point2D {
                x: 118.551_000_202_808_77,
                y: -24.808_680_672_613_47,
            },
            Point2D {
                x: 0.744_330_941_644_622_8,
                y: -0.667_810_938_297_979_3,
            },
        ),
        (
            0.875,
            Point2D {
                x: 231.245_240_016_656_77,
                y: 10.999_255_389_009_548,
            },
            Point2D {
                x: 0.800_850_182_965_615_4,
                y: 0.598_864_746_369_272_3,
            },
        ),
        (
            1.0,
            Point2D { x: 250.0, y: 50.0 },
            Point2D {
                x: 0.050_431_399_468_966_94,
                y: 0.998_727_527_380_516_7,
            },
        ),
    ];
    for (fraction, expected_point, expected_tangent) in golden_samples {
        let sample = measured
            .sample(
                measured.total_length() * fraction,
                PathTraversalDirection::Forward,
            )
            .expect("golden sample");
        assert_eq!(sample.point, expected_point, "fraction={fraction}");
        assert_point_close(sample.tangent, expected_tangent, EPSILON);
    }
}

#[test]
fn reversing_a_curve_reverses_samples_and_tangents() {
    let forward = measure_single_svg_path("M0 0C20 80 80 80 100 0").expect("forward curve");
    let reverse = measure_single_svg_path("M100 0C80 80 20 80 0 0").expect("reverse curve");
    assert_close(forward.total_length(), reverse.total_length(), 1e-10);

    // Non-dyadic interior distances avoid a subdivision vertex, whose
    // lower-bound tangent intentionally belongs to the incoming chord.
    for fraction in [0.0, 0.13, 0.37, 0.61, 0.89, 1.0] {
        let forward_sample = forward
            .sample(
                forward.total_length() * fraction,
                PathTraversalDirection::Forward,
            )
            .expect("forward sample");
        let reverse_sample = reverse
            .sample(
                reverse.total_length() * (1.0 - fraction),
                PathTraversalDirection::Forward,
            )
            .expect("reverse sample");
        assert_point_close(forward_sample.point, reverse_sample.point, 1e-10);
        assert_close(forward_sample.tangent.x, -reverse_sample.tangent.x, 1e-12);
        assert_close(forward_sample.tangent.y, -reverse_sample.tangent.y, 1e-12);
    }
}

#[test]
fn authored_close_is_distinct_from_coincident_open_endpoints() {
    let open = measure_single_svg_path("M0 0L10 0L0 0").expect("coincident open path");
    let closed = measure_single_svg_path("M0 0L10 0Z").expect("authored closed path");

    assert!(!open.is_closed());
    assert!(closed.is_closed());
    assert_eq!(open.total_length(), 20.0);
    assert_eq!(closed.total_length(), 20.0);
    assert!(
        open.sample(open.total_length(), PathTraversalDirection::Forward)
            .is_some()
    );
    assert!(
        closed
            .sample(closed.total_length(), PathTraversalDirection::Forward)
            .is_none()
    );

    let short_close = measure_single_svg_path("M0 0L10 0L0.00005 0Z").expect("short close");
    assert_eq!(short_close.total_length(), 20.0);
}

#[test]
fn direction_aware_samples_use_distinct_open_endpoints_and_closed_seam_tangents() {
    let open = measure_single_svg_path("M2 3L12 3").expect("open line");
    let reverse_start = open
        .sample(0.0, PathTraversalDirection::Reverse)
        .expect("reverse open start");
    let reverse_end = open
        .sample(open.total_length(), PathTraversalDirection::Reverse)
        .expect("reverse open end");
    assert_eq!(reverse_start.point, Point2D { x: 12.0, y: 3.0 });
    assert_eq!(reverse_end.point, Point2D { x: 2.0, y: 3.0 });
    assert_eq!(reverse_start.tangent, Point2D { x: -1.0, y: -0.0 });
    assert_eq!(reverse_end.tangent, Point2D { x: -1.0, y: -0.0 });

    let closed = measure_single_svg_path("M0 0L10 0L10 20Z").expect("asymmetric closed path");
    let forward_seam = closed
        .sample(0.0, PathTraversalDirection::Forward)
        .expect("forward seam");
    let reverse_seam = closed
        .sample(0.0, PathTraversalDirection::Reverse)
        .expect("reverse seam");
    assert_eq!(forward_seam.point, Point2D { x: 0.0, y: 0.0 });
    assert_eq!(forward_seam.tangent, Point2D { x: 1.0, y: 0.0 });
    assert_eq!(reverse_seam.point, Point2D { x: 0.0, y: 0.0 });
    assert_point_close(
        reverse_seam.tangent,
        Point2D {
            x: 1.0 / 5.0_f64.sqrt(),
            y: 2.0 / 5.0_f64.sqrt(),
        },
        EPSILON,
    );
}

#[test]
fn original_curve_offset_band_is_filled_and_budgeted() {
    let measured = measure_single_svg_path("M0 0Q50 80 100 0").expect("quadratic path");
    let mut sample_budget = 10_000;
    let band = measured_path_offset_band(
        &measured,
        0.0,
        measured.total_length(),
        PathTraversalDirection::Forward,
        1.0,
        &mut sample_budget,
        |_| 5.0,
    )
    .expect("curved offset band");
    let (_, min_y, _, max_y) = region_axis_bounds(&band).expect("band bounds");
    assert!(max_y > min_y);
    assert!(sample_budget < 10_000);

    let mut insufficient_budget = 2;
    assert_eq!(
        measured_path_offset_band(
            &measured,
            0.0,
            measured.total_length(),
            PathTraversalDirection::Forward,
            1.0,
            &mut insufficient_budget,
            |_| 0.0,
        ),
        Err(ShapeError::PathOffsetSampleLimit),
    );
}

#[test]
fn partial_wavy_offset_band_keeps_its_butt_endpoint() {
    let measured = measure_single_svg_path("M0 0L100 0").expect("straight path");
    let mut sample_budget = 10_000;
    let band = measured_path_offset_band(
        &measured,
        0.0,
        80.0,
        PathTraversalDirection::Forward,
        1.0,
        &mut sample_budget,
        |distance| 3.0 * (2.0 * std::f64::consts::PI * distance / 12.0).sin(),
    )
    .expect("partial wavy band");
    assert!(region_axis_bounds(&band).is_some());
}

#[test]
fn offset_band_rejects_an_authored_cusp() {
    let measured = measure_single_svg_path("M0 0L10 0L0 0").expect("cusp path");
    let mut sample_budget = 128;
    assert_eq!(
        measured_path_offset_band(
            &measured,
            0.0,
            measured.total_length(),
            PathTraversalDirection::Forward,
            1.0,
            &mut sample_budget,
            |_| 0.0,
        ),
        Err(ShapeError::PathOffsetGeometry),
    );
}

#[test]
fn offset_band_miters_an_authored_corner_in_both_directions() {
    let measured = measure_single_svg_path("M0 0L20 0L20 20").expect("corner path");
    for direction in [
        PathTraversalDirection::Forward,
        PathTraversalDirection::Reverse,
    ] {
        let mut sample_budget = 128;
        let band = measured_path_offset_band(
            &measured,
            10.0,
            30.0,
            direction,
            1.0,
            &mut sample_budget,
            |_| 4.0,
        )
        .expect("mitered corner band");
        assert!(region_axis_bounds(&band).is_some());
        assert!(sample_budget < 128);
    }

    let closed = measure_single_svg_path("M20 20L330 20L330 150L20 150Z").expect("closed corners");
    for direction in [
        PathTraversalDirection::Forward,
        PathTraversalDirection::Reverse,
    ] {
        let mut sample_budget = 10_000;
        assert!(
            measured_path_offset_band(
                &closed,
                35.0,
                880.0,
                direction,
                1.0,
                &mut sample_budget,
                |_| -2.0,
            )
            .is_ok(),
            "closed direction={direction:?}",
        );
    }
}

#[test]
fn region_projection_stays_within_the_caller_branch_interval() {
    let measured = measure_single_svg_path("M0 0L20 0").expect("projection path");
    let rectangle = Region {
        contours: vec![Contour {
            segments: vec![
                CurveSegment::Line {
                    p0: Point2D { x: 4.0, y: -1.0 },
                    p1: Point2D { x: 6.0, y: -1.0 },
                },
                CurveSegment::Line {
                    p0: Point2D { x: 6.0, y: -1.0 },
                    p1: Point2D { x: 6.0, y: 1.0 },
                },
                CurveSegment::Line {
                    p0: Point2D { x: 6.0, y: 1.0 },
                    p1: Point2D { x: 4.0, y: 1.0 },
                },
                CurveSegment::Line {
                    p0: Point2D { x: 4.0, y: 1.0 },
                    p1: Point2D { x: 4.0, y: -1.0 },
                },
            ],
            closed: true,
        }],
    };
    let mut pair_budget = 128;
    let projected = project_region_to_measured_path_interval(
        &rectangle,
        &measured,
        2.0,
        8.0,
        5.0,
        PathTraversalDirection::Forward,
        &mut pair_budget,
    )
    .expect("projection")
    .expect("occupied interval");
    assert_close(projected.0, 4.0, 1e-9);
    assert_close(projected.1, 6.0, 1e-9);
}

#[test]
fn classified_intersection_projection_is_exact_and_uses_the_shared_budget() {
    let measured = measure_single_svg_path("M0 0L20 0").expect("projection path");
    let rectangle = |min_x: f64, max_x: f64, min_y: f64, max_y: f64| Region {
        contours: vec![Contour {
            segments: vec![
                CurveSegment::Line {
                    p0: Point2D { x: min_x, y: min_y },
                    p1: Point2D { x: max_x, y: min_y },
                },
                CurveSegment::Line {
                    p0: Point2D { x: max_x, y: min_y },
                    p1: Point2D { x: max_x, y: max_y },
                },
                CurveSegment::Line {
                    p0: Point2D { x: max_x, y: max_y },
                    p1: Point2D { x: min_x, y: max_y },
                },
                CurveSegment::Line {
                    p0: Point2D { x: min_x, y: max_y },
                    p1: Point2D { x: min_x, y: min_y },
                },
            ],
            closed: true,
        }],
    };
    let decoration = rectangle(4.0, 8.0, -1.0, 1.0);
    let ink = rectangle(5.0, 6.0, -2.0, 0.5);
    let initial_budget = 1_024;
    let mut remaining_budget = initial_budget;
    let projected = project_region_intersection_to_measured_path_interval(
        &decoration,
        &ink,
        &measured,
        2.0,
        10.0,
        5.5,
        PathTraversalDirection::Forward,
        &mut remaining_budget,
    )
    .expect("classified intersection projection")
    .expect("occupied interval");
    assert_close(projected.0, 5.0, 1e-9);
    assert_close(projected.1, 6.0, 1e-9);

    let consumed = initial_budget - remaining_budget;
    let mut exact_budget = consumed;
    assert!(
        project_region_intersection_to_measured_path_interval(
            &decoration,
            &ink,
            &measured,
            2.0,
            10.0,
            5.5,
            PathTraversalDirection::Forward,
            &mut exact_budget,
        )
        .is_ok()
    );
    let mut insufficient_budget = consumed - 1;
    assert_eq!(
        project_region_intersection_to_measured_path_interval(
            &decoration,
            &ink,
            &measured,
            2.0,
            10.0,
            5.5,
            PathTraversalDirection::Forward,
            &mut insufficient_budget,
        ),
        Err(ShapeError::BooleanPairLimit),
    );
}

#[test]
fn invalid_or_unsupported_paths_return_specific_errors() {
    for invalid in ["L10 0", "M0 0L", "M0 0L1e309 0"] {
        assert_eq!(
            measure_single_svg_path(invalid),
            Err(ShapeError::InvalidPathData),
            "path={invalid}",
        );
    }
    assert_eq!(
        measure_single_svg_path("M0 0X10 0"),
        Err(ShapeError::UnsupportedPathCommand('X')),
    );
    assert_eq!(
        measure_single_svg_path("M0 0l1e308 0l1e308 0"),
        Err(ShapeError::InvalidPathData),
    );
    assert_eq!(
        measure_single_svg_path("M0 0L10 0M20 0L30 0"),
        Err(ShapeError::PathMeasureMultipleSubpaths),
    );
    for zero_length in ["", "M0 0", "M0 0L0 0"] {
        assert_eq!(
            measure_single_svg_path(zero_length),
            Err(ShapeError::PathMeasureZeroLength),
            "path={zero_length}",
        );
    }

    let one_drawable_subpath =
        measure_single_svg_path("M0 0ZM10 0L20 0").expect("one drawable subpath");
    assert_eq!(one_drawable_subpath.total_length(), 10.0);
}

#[test]
fn finite_small_and_large_coordinates_remain_measurable() {
    let small = measure_single_svg_path("M0 0L0.001 0").expect("small finite line");
    assert_eq!(small.total_length(), 0.001);

    let large =
        measure_single_svg_path("M1e150 0L1.000000000000001e150 0").expect("large finite line");
    assert!(large.total_length().is_finite());
    assert!(large.total_length() > 0.0);
}

#[test]
fn recursion_and_point_budgets_fail_without_forcing_an_approximation() {
    assert_eq!(
        measure_single_svg_path("M0 0C0 1e100 1e100 1e100 1e100 0"),
        Err(ShapeError::PathMeasureComplexityLimit),
    );

    let below_limit = alternating_line_path(65_534);
    let measured_below = measure_single_svg_path(&below_limit).expect("65,535 measured points");
    assert_eq!(measured_below.total_length(), 65_534.0);

    let at_limit = alternating_line_path(65_535);
    let measured = measure_single_svg_path(&at_limit).expect("65,536 measured points");
    assert_eq!(measured.total_length(), 65_535.0);

    let over_limit = alternating_line_path(65_536);
    assert_eq!(
        measure_single_svg_path(&over_limit),
        Err(ShapeError::PathMeasureComplexityLimit),
    );
}

#[test]
fn repeated_measurement_is_bit_stable() {
    let path = "M5 10q20 60 50 10t50 -10c20 -40 40 40 60 0s40 -40 60 0a25 30 15 0 1 50 20";
    let first = measure_single_svg_path(path).expect("first measurement");
    for _ in 0..16 {
        assert_eq!(
            measure_single_svg_path(path).expect("repeated measurement"),
            first,
        );
    }
}

fn alternating_line_path(segment_count: usize) -> String {
    let mut path = String::from("M0 0");
    for segment_index in 0..segment_count {
        let x = (segment_index + 1) % 2;
        assert!(write!(path, "L{x} 0").is_ok());
    }
    path
}

proptest! {
    #[test]
    fn monotonic_polylines_have_finite_ordered_samples_and_unit_tangents(
        deltas in prop::collection::vec((1i16..1000, -100i16..100), 1..32),
    ) {
        let mut path = String::from("M0 0");
        let mut expected_length = 0.0;
        for (delta_x, delta_y) in deltas {
            write!(path, "l{delta_x} {delta_y}").expect("write to string");
            expected_length += f64::from(delta_x).hypot(f64::from(delta_y));
        }
        let measured = measure_single_svg_path(&path).expect("generated polyline");
        prop_assert_eq!(measured.total_length(), expected_length);

        let mut previous_x = f64::NEG_INFINITY;
        for sample_index in 0..=64 {
            let distance = measured.total_length() * f64::from(sample_index) / 64.0;
            let sample = measured
                .sample(distance, PathTraversalDirection::Forward)
                .expect("in-range sample");
            prop_assert!(sample.point.x.is_finite());
            prop_assert!(sample.point.y.is_finite());
            prop_assert!(sample.point.x + EPSILON >= previous_x);
            previous_x = sample.point.x;

            let tangent_length = sample.tangent.x.hypot(sample.tangent.y);
            prop_assert!((tangent_length - 1.0).abs() <= EPSILON);
        }
    }

    #[test]
    fn reversed_lines_have_equal_lengths_and_opposite_tangents(
        start_x in -10_000i32..10_000,
        start_y in -10_000i32..10_000,
        delta_x in -10_000i32..10_000,
        delta_y in -10_000i32..10_000,
    ) {
        prop_assume!(delta_x != 0 || delta_y != 0);
        let end_x = start_x + delta_x;
        let end_y = start_y + delta_y;
        let forward_path = format!("M{start_x} {start_y}L{end_x} {end_y}");
        let reverse_path = format!("M{end_x} {end_y}L{start_x} {start_y}");
        let forward = measure_single_svg_path(&forward_path).expect("forward line");
        let reverse = measure_single_svg_path(&reverse_path).expect("reverse line");
        prop_assert_eq!(forward.total_length(), reverse.total_length());

        let forward_sample = forward
            .sample(forward.total_length() / 2.0, PathTraversalDirection::Forward)
            .expect("forward sample");
        let reverse_sample = reverse
            .sample(reverse.total_length() / 2.0, PathTraversalDirection::Forward)
            .expect("reverse sample");
        prop_assert!((forward_sample.point.x - reverse_sample.point.x).abs() <= EPSILON);
        prop_assert!((forward_sample.point.y - reverse_sample.point.y).abs() <= EPSILON);
        prop_assert!((forward_sample.tangent.x + reverse_sample.tangent.x).abs() <= EPSILON);
        prop_assert!((forward_sample.tangent.y + reverse_sample.tangent.y).abs() <= EPSILON);
    }
}
