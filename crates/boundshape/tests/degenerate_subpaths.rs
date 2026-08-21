//! Degenerate path data must not destroy a valid shape.
//!
//! A subpath that draws nothing — `M400 400Z`, or a trailing `M400 400` — is
//! valid SVG that renders as nothing. The parser used to reject the whole path
//! (`EmptyPath` / `OpenSubpath`), so one stray subpath from an exporter took the
//! rest of the shape down with it. A subpath that *did* draw and was never
//! closed is still rejected.
//!
//! The property tests generate well-formed radial polygons and ellipses only,
//! so none of this was reachable from them.

use boundshape::{
    BooleanOp, Contour, CurveSegment, GeometryDoc, GeometryNode, GeometryViewBox, Point2D,
    evaluate_geometry, region_to_path,
};

const VIEW: f64 = 1000.0;

fn doc(root: GeometryNode) -> GeometryDoc {
    GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: VIEW,
            height: VIEW,
        },
        root,
    }
}

fn path(d: &str) -> GeometryNode {
    GeometryNode::Path {
        node_id: None,
        d: d.into(),
        fill_rule: None,
    }
}

fn boolean(op: BooleanOp, lhs: &str, rhs: &str) -> GeometryDoc {
    doc(GeometryNode::Boolean {
        node_id: None,
        op,
        children: vec![path(lhs), path(rhs)],
    })
}

fn seg_point(segment: &CurveSegment, t: f64) -> Point2D {
    let u = 1.0 - t;
    match segment {
        CurveSegment::Line { p0, p1 } => Point2D {
            x: p0.x + (p1.x - p0.x) * t,
            y: p0.y + (p1.y - p0.y) * t,
        },
        CurveSegment::Quad { p0, p1, p2 } => Point2D {
            x: u * u * p0.x + 2.0 * u * t * p1.x + t * t * p2.x,
            y: u * u * p0.y + 2.0 * u * t * p1.y + t * t * p2.y,
        },
        CurveSegment::Cubic { p0, p1, p2, p3 } => Point2D {
            x: u * u * u * p0.x
                + 3.0 * u * u * t * p1.x
                + 3.0 * u * t * t * p2.x
                + t * t * t * p3.x,
            y: u * u * u * p0.y
                + 3.0 * u * u * t * p1.y
                + 3.0 * u * t * t * p2.y
                + t * t * t * p3.y,
        },
    }
}

fn contour_area(contour: &Contour) -> f64 {
    let mut points: Vec<Point2D> = Vec::new();
    for segment in &contour.segments {
        for step in 0..16 {
            points.push(seg_point(segment, f64::from(step) / 16.0));
        }
    }
    if points.len() < 3 {
        return 0.0;
    }
    let mut sum = 0.0;
    for i in 0..points.len() {
        let a = points[i];
        let b = points[(i + 1) % points.len()];
        sum += a.x * b.y - b.x * a.y;
    }
    sum / 2.0
}

fn area(d: &GeometryDoc) -> Option<f64> {
    let region = evaluate_geometry(d).ok()?;
    Some(region.contours.iter().map(|c| contour_area(c).abs()).sum())
}

const SQUARE: &str = "M100 100H300V300H100Z";
const SAME: &str = "M100 100H300V300H100Z";
const ZERO_AREA: &str = "M100 100H300V100H100Z"; // collinear, no area
const DEGENERATE_POINT: &str = "M100 100H100V100H100Z";
const OPEN: &str = "M100 100H300V300H100"; // no Z
const BOWTIE: &str = "M100 100L300 300L300 100L100 300Z"; // self-intersecting
const SHARED_EDGE: &str = "M300 100H500V300H300Z"; // touches SQUARE along x=300
const TINY: &str = "M100 100H100.000001V100.000001H100Z";
const HUGE: &str = "M-1e9 -1e9H1e9V1e9H-1e9Z";

#[test]
fn degenerate_inputs_do_not_panic_and_stay_deterministic() {
    let cases: &[(&str, &str, &str)] = &[
        ("identical squares", SQUARE, SAME),
        ("zero-area vs square", SQUARE, ZERO_AREA),
        ("degenerate point vs square", SQUARE, DEGENERATE_POINT),
        ("open contour vs square", SQUARE, OPEN),
        ("bowtie vs square", SQUARE, BOWTIE),
        ("shared edge", SQUARE, SHARED_EDGE),
        ("tiny vs square", SQUARE, TINY),
        ("huge vs square", SQUARE, HUGE),
        ("zero-area vs zero-area", ZERO_AREA, ZERO_AREA),
        ("bowtie vs bowtie", BOWTIE, BOWTIE),
    ];
    let ops = [
        (BooleanOp::Union, "union"),
        (BooleanOp::Intersect, "intersect"),
        (BooleanOp::Subtract, "subtract"),
        (BooleanOp::Xor, "xor"),
    ];

    let mut report = Vec::new();
    for (label, lhs, rhs) in cases {
        for (op, op_name) in &ops {
            let d = boolean(*op, lhs, rhs);
            let first = evaluate_geometry(&d);
            let second = evaluate_geometry(&d);
            let same = match (&first, &second) {
                (Ok(a), Ok(b)) => region_to_path(a) == region_to_path(b),
                (Err(_), Err(_)) => true,
                _ => false,
            };
            let outcome = match &first {
                Ok(r) => format!(
                    "ok contours={} area={:.2}",
                    r.contours.len(),
                    r.contours
                        .iter()
                        .map(|c| contour_area(c).abs())
                        .sum::<f64>()
                ),
                Err(e) => format!("ERR {e:?}"),
            };
            report.push(format!(
                "{label:28} {op_name:9} {outcome}{}",
                if same { "" } else { "   <<< NONDETERMINISTIC" }
            ));
        }
    }
    for line in &report {
        println!("{line}");
    }
    assert!(
        !report.iter().any(|l| l.contains("NONDETERMINISTIC")),
        "nondeterministic evaluation on degenerate input"
    );
}

#[test]
fn zero_area_variants_are_handled_consistently() {
    // Every one of these has zero area. Do they behave the same way?
    let variants: &[(&str, &str)] = &[
        ("collinear (200px wide)", "M100 100H300V100H100Z"),
        ("zero-width rect", "M100 100H100V300H100Z"),
        ("zero-height rect", "M100 100H300V100H100Z"),
        ("single point", "M100 100H100V100H100Z"),
        ("1e-6 square", "M100 100H100.000001V100.000001H100Z"),
        ("1e-3 square", "M100 100H100.001V100.001H100Z"),
        ("0.1 square", "M100 100H100.1V100.1H100Z"),
        ("degenerate line", "M100 100L300 300Z"),
    ];
    for (label, d) in variants {
        let alone = evaluate_geometry(&doc(path(d)));
        let unioned = evaluate_geometry(&boolean(BooleanOp::Union, SQUARE, d));
        assert!(alone.is_ok(), "{label}: zero-area path errored: {alone:?}");
        let union_area = unioned.as_ref().map_or(f64::NAN, |r| {
            r.contours
                .iter()
                .map(|c| contour_area(c).abs())
                .sum::<f64>()
        });
        assert!(
            (union_area - 40000.0).abs() < 1.0,
            "{label}: union with a square should be the square, got {union_area:?}"
        );
        println!(
            "{label:24} alone={:20} union(square, it)={}",
            match &alone {
                Ok(r) => format!("ok contours={}", r.contours.len()),
                Err(e) => format!("ERR {e:?}"),
            },
            match &unioned {
                Ok(r) => format!(
                    "ok contours={} area={:.1}",
                    r.contours.len(),
                    r.contours
                        .iter()
                        .map(|c| contour_area(c).abs())
                        .sum::<f64>()
                ),
                Err(e) => format!("ERR {e:?}  <<< union with a square FAILS"),
            }
        );
    }
}

#[test]
fn identical_shapes_satisfy_the_algebraic_identities() {
    let a = area(&doc(path(SQUARE))).expect("square");
    let union = area(&boolean(BooleanOp::Union, SQUARE, SAME)).expect("union");
    let intersect = area(&boolean(BooleanOp::Intersect, SQUARE, SAME)).expect("intersect");
    let subtract = area(&boolean(BooleanOp::Subtract, SQUARE, SAME)).expect("subtract");
    let xor = area(&boolean(BooleanOp::Xor, SQUARE, SAME)).expect("xor");
    println!(
        "A={a:.2} union={union:.2} intersect={intersect:.2} subtract={subtract:.2} xor={xor:.2}"
    );

    let tol = a * 0.01 + 1.0;
    assert!((union - a).abs() < tol, "union(A,A) should be A");
    assert!((intersect - a).abs() < tol, "intersect(A,A) should be A");
    assert!(subtract.abs() < tol, "subtract(A,A) should be empty");
    assert!(xor.abs() < tol, "xor(A,A) should be empty");
}

#[test]
fn shared_edge_union_area_is_the_sum() {
    let a = area(&doc(path(SQUARE))).expect("a");
    let b = area(&doc(path(SHARED_EDGE))).expect("b");
    let union = area(&boolean(BooleanOp::Union, SQUARE, SHARED_EDGE)).expect("union");
    let intersect = area(&boolean(BooleanOp::Intersect, SQUARE, SHARED_EDGE)).expect("intersect");
    println!("A={a:.2} B={b:.2} union={union:.2} intersect={intersect:.2}");
    let tol = (a + b) * 0.01 + 1.0;
    assert!(
        (union - (a + b)).abs() < tol,
        "edge-adjacent union should be A+B, got {union:.2} vs {:.2}",
        a + b
    );
    assert!(
        intersect.abs() < tol,
        "edge-adjacent intersect should be empty, got {intersect:.2}"
    );
}

#[test]
fn a_degenerate_subpath_must_not_kill_a_valid_shape() {
    let cases: &[(&str, &str)] = &[
        ("valid square alone", "M100 100H300V300H100Z"),
        ("square + point subpath", "M100 100H300V300H100Z M400 400Z"),
        ("square + empty moveto", "M100 100H300V300H100Z M400 400"),
        ("point subpath first", "M400 400Z M100 100H300V300H100Z"),
    ];
    for (label, d) in cases {
        let result = evaluate_geometry(&doc(path(d)));
        let area_of = result.as_ref().map_or(f64::NAN, |r| {
            r.contours
                .iter()
                .map(|c| contour_area(c).abs())
                .sum::<f64>()
        });
        assert!(
            (area_of - 40000.0).abs() < 1.0,
            "{label}: the valid square was lost ({result:?})"
        );
        println!(
            "{label:26} {}",
            match &result {
                Ok(r) => format!(
                    "ok contours={} area={:.1}",
                    r.contours.len(),
                    r.contours
                        .iter()
                        .map(|c| contour_area(c).abs())
                        .sum::<f64>()
                ),
                Err(e) => format!("ERR {e:?}   <<< a valid square was lost"),
            }
        );
    }
}

#[test]
fn svg_empty_path_and_form_feed_whitespace_are_non_fatal() {
    let empty = evaluate_geometry(&doc(path("   \n\t\r\u{000c}"))).expect("empty SVG path");
    assert!(empty.contours.is_empty());

    let with_form_feed = evaluate_geometry(&doc(path("M100\u{000c}100H300V300H100Z")))
        .expect("form-feed is SVG whitespace");
    assert!(
        (with_form_feed
            .contours
            .iter()
            .map(contour_area)
            .map(f64::abs)
            .sum::<f64>()
            - 40000.0)
            .abs()
            < 1.0
    );
}

#[test]
fn closepath_state_matches_svg_following_command_rules() {
    for d in [
        "M100 100H300V300H100ZZ",
        "M100 100H300V300H100ZL200 100L200 200Z",
    ] {
        let result = evaluate_geometry(&doc(path(d)));
        assert!(
            result.is_ok(),
            "valid command after closepath failed: {result:?}"
        );
    }
}

#[test]
fn non_finite_coordinates_are_rejected_before_the_geometry_kernel() {
    for d in [
        "M1e309 0L0 0Z",
        "M0 0L-1e309 0Z",
        "M0 0A1e309 10 0 0 1 20 0Z",
    ] {
        let result = evaluate_geometry(&doc(path(d)));
        assert!(
            result.is_err(),
            "non-finite path coordinate was accepted: {result:?}"
        );
    }
}

#[test]
fn malformed_path_bytes_return_instead_of_stalling_the_tokenizer() {
    for d in ["M0 0;L10 0Z", "M0 0#L10 0Z", "M0 0\u{3000}L10 0Z"] {
        let result = evaluate_geometry(&doc(path(d)));
        assert!(
            result.is_err(),
            "malformed path data was accepted: {result:?}"
        );
    }
}

#[test]
fn extreme_finite_coordinates_do_not_overflow_snap_bucket_neighbors() {
    let extreme = "M1e150 1e150H2e150V2e150H1e150Z";
    let square = "M5 5H15V15H5Z";
    for op in [
        BooleanOp::Union,
        BooleanOp::Intersect,
        BooleanOp::Subtract,
        BooleanOp::Xor,
    ] {
        let first = evaluate_geometry(&boolean(op, extreme, square));
        let second = evaluate_geometry(&boolean(op, extreme, square));
        assert_eq!(
            first.as_ref().map(region_to_path).ok(),
            second.as_ref().map(region_to_path).ok(),
            "extreme-coordinate outcome must remain deterministic"
        );
    }
}
