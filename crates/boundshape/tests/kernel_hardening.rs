// Integration tests always build with `cfg(test)`; declaring it lets clippy's
// `allow-*-in-tests` config apply to helper functions in this file.
#![cfg(test)]

use boundshape::{BooleanOp, GeometryDoc, boolean_regions, evaluate_geometry, region_to_path};

fn load_geometry_fixture(name: &str) -> GeometryDoc {
    let json = match name {
        "subtract_rect_hole" => include_str!("fixtures/subtract_rect_hole.json"),
        "transformed_subtract_rect_hole" => {
            include_str!("fixtures/transformed_subtract_rect_hole.json")
        }
        _ => panic!("unknown fixture: {name}"),
    };
    serde_json::from_str(json).expect("fixture should parse")
}

fn load_expected_path(name: &str) -> &'static str {
    match name {
        "subtract_rect_hole" => include_str!("fixtures/subtract_rect_hole.path.txt").trim(),
        "transformed_subtract_rect_hole" => {
            include_str!("fixtures/transformed_subtract_rect_hole.path.txt").trim()
        }
        _ => panic!("unknown fixture: {name}"),
    }
}

#[test]
fn golden_boolean_fixtures_match_expected_paths() {
    for fixture_name in ["subtract_rect_hole", "transformed_subtract_rect_hole"] {
        let geometry = load_geometry_fixture(fixture_name);
        let region = evaluate_geometry(&geometry).expect("fixture should evaluate");
        let actual_path = region_to_path(&region).expect("serialize fixture");
        let expected_path = load_expected_path(fixture_name);
        assert_eq!(actual_path, expected_path, "fixture={fixture_name}");
    }
}

#[test]
fn repeated_evaluation_is_deterministic_for_golden_fixtures() {
    for fixture_name in ["subtract_rect_hole", "transformed_subtract_rect_hole"] {
        let geometry = load_geometry_fixture(fixture_name);
        let first = region_to_path(&evaluate_geometry(&geometry).expect("first evaluation"))
            .expect("serialize first evaluation");
        for _ in 0..10 {
            let next = region_to_path(&evaluate_geometry(&geometry).expect("repeat evaluation"))
                .expect("serialize repeat evaluation");
            assert_eq!(next, first, "fixture={fixture_name}");
        }
    }
}

#[test]
fn tangent_touch_union_of_cubic_circles_is_stable() {
    let lhs = evaluate_geometry(&GeometryDoc {
        view_box: boundshape::GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 180.0,
            height: 120.0,
        },
        root: boundshape::GeometryNode::Path {
            node_id: None,
            d: "M60 60C60 93.137 33.137 120 0 120C-33.137 120 -60 93.137 -60 60C-60 26.863 -33.137 0 0 0C33.137 0 60 26.863 60 60Z".to_string(),
            fill_rule: None,
        },
    })
    .expect("lhs should parse");
    let rhs = evaluate_geometry(&GeometryDoc {
        view_box: boundshape::GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 180.0,
            height: 120.0,
        },
        root: boundshape::GeometryNode::Path {
            node_id: None,
            d: "M180 60C180 93.137 153.137 120 120 120C86.863 120 60 93.137 60 60C60 26.863 86.863 0 120 0C153.137 0 180 26.863 180 60Z".to_string(),
            fill_rule: None,
        },
    })
    .expect("rhs should parse");

    let first = region_to_path(&boolean_regions(&lhs, &rhs, BooleanOp::Union).expect("union"))
        .expect("serialize union");
    assert!(!first.is_empty());
    for _ in 0..10 {
        let next =
            region_to_path(&boolean_regions(&lhs, &rhs, BooleanOp::Union).expect("repeat union"))
                .expect("serialize repeat union");
        assert_eq!(next, first);
    }
}

#[test]
fn near_coincident_shared_edge_union_stays_stable() {
    let lhs = evaluate_geometry(&GeometryDoc {
        view_box: boundshape::GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 80.0,
            height: 40.0,
        },
        root: boundshape::GeometryNode::Path {
            node_id: None,
            d: "M0 0H40V40H0Z".to_string(),
            fill_rule: None,
        },
    })
    .expect("lhs should parse");
    let rhs = evaluate_geometry(&GeometryDoc {
        view_box: boundshape::GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 80.0,
            height: 40.0,
        },
        root: boundshape::GeometryNode::Path {
            node_id: None,
            d: "M39.99995 0H80V40H39.99995Z".to_string(),
            fill_rule: None,
        },
    })
    .expect("rhs should parse");

    let first = region_to_path(&boolean_regions(&lhs, &rhs, BooleanOp::Union).expect("union"))
        .expect("serialize union");
    assert_eq!(first, "M0,0L80,0L80,40L0,40Z");
    for _ in 0..10 {
        let next =
            region_to_path(&boolean_regions(&lhs, &rhs, BooleanOp::Union).expect("repeat union"))
                .expect("serialize repeat union");
        assert_eq!(next, first);
    }
}

#[test]
fn collinear_partially_overlapping_rect_union_stays_stable() {
    let lhs = evaluate_geometry(&GeometryDoc {
        view_box: boundshape::GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 300.0,
            height: 200.0,
        },
        root: boundshape::GeometryNode::Path {
            node_id: None,
            d: "M20 80H160V120H20Z".to_string(),
            fill_rule: None,
        },
    })
    .expect("lhs should parse");
    let rhs = evaluate_geometry(&GeometryDoc {
        view_box: boundshape::GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 300.0,
            height: 200.0,
        },
        root: boundshape::GeometryNode::Path {
            node_id: None,
            d: "M140 80H280V120H140Z".to_string(),
            fill_rule: None,
        },
    })
    .expect("rhs should parse");

    let first = region_to_path(&boolean_regions(&lhs, &rhs, BooleanOp::Union).expect("union"))
        .expect("serialize union");
    assert_eq!(first, "M20,80L280,80L280,120L20,120Z");
    for _ in 0..10 {
        let next =
            region_to_path(&boolean_regions(&lhs, &rhs, BooleanOp::Union).expect("repeat union"))
                .expect("serialize repeat union");
        assert_eq!(next, first);
    }
}

#[test]
fn evenodd_nested_contours_keep_expected_island_hole_ordering() {
    let region = evaluate_geometry(&GeometryDoc {
        view_box: boundshape::GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 120.0,
        },
        root: boundshape::GeometryNode::Path {
            node_id: None,
            d: "M0 0H120V120H0Z M20 20H100V100H20Z M40 40H80V80H40Z".to_string(),
            fill_rule: Some("evenodd".to_string()),
        },
    })
    .expect("evenodd path should parse");

    assert_eq!(
        region_to_path(&region).expect("serialize region"),
        "M0,0L120,0L120,120L0,120Z M20,20L20,100L100,100L100,20Z M40,40L80,40L80,80L40,80Z",
    );
}

/// Regression for the curve-flattening midpoint loss: `CurveSegment::flatten`
/// used to pop the shared midpoint between the two halves of every split, so
/// any curve collapsed to its chord and a circular hole came out as a diamond.
#[test]
fn curved_subtract_hole_keeps_curve_fidelity() {
    // 120x120 rect minus an approximate circle (4 cubics, r=30 around 60,60).
    let rect = evaluate_geometry(&GeometryDoc {
        view_box: boundshape::GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 120.0,
        },
        root: boundshape::GeometryNode::Path {
            node_id: None,
            d: "M0 0H120V120H0Z".to_string(),
            fill_rule: None,
        },
    })
    .expect("rect should parse");
    let circle = evaluate_geometry(&GeometryDoc {
        view_box: boundshape::GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 120.0,
        },
        root: boundshape::GeometryNode::Path {
            node_id: None,
            d: "M90 60C90 76.5685 76.5685 90 60 90C43.4315 90 30 76.5685 30 60C30 43.4315 43.4315 30 60 30C76.5685 30 90 43.4315 90 60Z".to_string(),
            fill_rule: None,
        },
    })
    .expect("circle should parse");

    let result = boolean_regions(&rect, &circle, BooleanOp::Subtract).expect("subtract");
    assert_eq!(result.contours.len(), 2, "outer boundary + hole");

    let hole = result
        .contours
        .iter()
        .min_by(|a, b| {
            contour_area_abs(a)
                .partial_cmp(&contour_area_abs(b))
                .expect("finite areas")
        })
        .expect("hole contour");
    let hole_area = contour_area_abs(hole);
    let circle_area = std::f64::consts::PI * 30.0 * 30.0;
    // The 4-cubic approximation itself deviates < 0.03% from a true circle;
    // flatten + boolean + curve re-fit must stay well inside 1%.
    assert!(
        (hole_area - circle_area).abs() / circle_area < 0.01,
        "hole area {hole_area} should be within 1% of {circle_area}",
    );
    // Boolean output re-fits smooth flattened runs back to compact cubics:
    // the circular hole must come back as curves, not as the dense
    // polyline (and definitely not as the chord-collapsed diamond).
    assert!(
        hole.segments.len() <= 16,
        "refit hole should be compact, got {} segments",
        hole.segments.len(),
    );
    assert!(
        hole.segments
            .iter()
            .any(|segment| matches!(segment, boundshape::CurveSegment::Cubic { .. })),
        "refit hole should contain cubic segments",
    );

    // Curve re-fit is deterministic: identical inputs, identical output.
    let again = boolean_regions(&rect, &circle, BooleanOp::Subtract).expect("subtract again");
    assert_eq!(region_to_path(&result), region_to_path(&again));
}

fn contour_area_abs(contour: &boundshape::Contour) -> f64 {
    const CURVE_SAMPLES: usize = 32;
    let mut area = 0.0;
    let mut shoelace = |p0: boundshape::Point2D, p1: boundshape::Point2D| {
        area += p0.x * p1.y - p1.x * p0.y;
    };
    for segment in &contour.segments {
        match segment {
            boundshape::CurveSegment::Line { p0, p1 } => shoelace(*p0, *p1),
            boundshape::CurveSegment::Quad { p0, p1, p2 } => {
                let mut previous = *p0;
                for step in 1..=CURVE_SAMPLES {
                    #[expect(clippy::cast_precision_loss, reason = "small sample counts")]
                    let t = step as f64 / CURVE_SAMPLES as f64;
                    let mt = 1.0 - t;
                    let point = boundshape::Point2D {
                        x: mt * mt * p0.x + 2.0 * mt * t * p1.x + t * t * p2.x,
                        y: mt * mt * p0.y + 2.0 * mt * t * p1.y + t * t * p2.y,
                    };
                    shoelace(previous, point);
                    previous = point;
                }
            }
            boundshape::CurveSegment::Cubic { p0, p1, p2, p3 } => {
                let mut previous = *p0;
                for step in 1..=CURVE_SAMPLES {
                    #[expect(clippy::cast_precision_loss, reason = "small sample counts")]
                    let t = step as f64 / CURVE_SAMPLES as f64;
                    let mt = 1.0 - t;
                    let point = boundshape::Point2D {
                        x: mt.powi(3) * p0.x
                            + 3.0 * mt * mt * t * p1.x
                            + 3.0 * mt * t * t * p2.x
                            + t.powi(3) * p3.x,
                        y: mt.powi(3) * p0.y
                            + 3.0 * mt * mt * t * p1.y
                            + 3.0 * mt * t * t * p2.y
                            + t.powi(3) * p3.y,
                    };
                    shoelace(previous, point);
                    previous = point;
                }
            }
        }
    }
    (area * 0.5).abs()
}
