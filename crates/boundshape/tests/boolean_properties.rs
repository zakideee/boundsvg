//! Property-based tests for the boundshape boolean kernel.
//!
//! Random closed simple shapes (radial polygons and kappa-approximated
//! ellipses, optionally wrapped in an affine transform) are combined through
//! `GeometryNode::Boolean` and checked for algebraic invariants: absence of
//! panics, determinism, commutativity, idempotence, monotonicity, area
//! partitioning, associativity, and `divide_regions` consistency. Areas are
//! measured by an independent flatten + shoelace helper defined in this file.

use std::{
    f64::consts::{PI, TAU},
    sync::atomic::{AtomicU32, Ordering},
};

use boundshape::{
    BooleanOp, Contour, CurveSegment, GeometryDoc, GeometryNode, GeometryViewBox, Point2D, Region,
    ShapeError, Transform2D, divide_regions, evaluate_geometry, region_to_path,
};
use proptest::prelude::*;
use proptest::test_runner::TestCaseError;

// ---------------------------------------------------------------------------
// Boolean-kernel regression cases pinned from the property-test findings.
// Minimal inputs live in the f1..f7 helpers and `*_repro` tests below.
// ---------------------------------------------------------------------------
//
// F1 — union(A, A) emitted every contour twice, doubling the measured area.
//     Reproduced for every generated shape, so P4 covers the full domain.
//     Pinned: f1_self_union_square_preserves_area_repro.
//
// F2 — resolved failure history: booleans over cubic (ellipse) boundaries
//     intermittently returned wrong regions, including empty or partial
//     unions and order-dependent subtract/intersect results. P3/P5/P6/P7 now
//     keep cubic operands in their full-domain regression coverage.
//     Pinned: f2_containing_cubic_union_is_non_empty_repro,
//     f2_overlapping_cubic_union_is_order_stable_repro.
//
// F3 — resolved failure history: intermittent, order-dependent
//     BooleanTopology failures where union(A, B) succeeded while union(B, A)
//     failed.
//     Pinned: f3_union_order_does_not_change_topology_result_repro.
//
// F4 — resolved failure history: boolean evaluation could crash with a stack
//     overflow for intersect(xor(A, B), C) when the xor contours met
//     tangentially. The exact fixture remains pinned and P1/P2/P8 now execute
//     in process so a recurrence fails the property binary directly.
//     Pinned: fixtures/stack_overflow_boolean.json via
//     f4_stack_overflow_fixture_returns_instead_of_crashing_repro.
//
// F5 — resolved failure history: the xor area identity
//     (xor = union − intersect, by area) failed for transformed polygon pairs
//     whose xor contours pinched at boundary crossings.
//     Pinned: f5_xor_identity_matches_union_minus_intersect_repro.
//
// F6 — the canonical union output was not operand-order-stable: one pair
//     flipped whole-contour orientation between operand orders (the affected
//     output also carried a degenerate needle spike that likely broke the
//     fill-side probing used for canonical orientation); another pair
//     emitted an order-dependent micro-vertex, two vertices exactly
//     snap_epsilon apart in one order and a single vertex in the other.
//     Pinned: f6_union_canonical_output_is_order_stable_repro, with inputs
//     in f6_micro_vertex_nodes.
//
// F7 — a generated concave union exposed two independent failures at a
//     kernel-snapped touch point: union emitted two sibling contours in one
//     operand order and one pinched contour in the other (breaking
//     commutativity), and the property-test area oracle misclassified the
//     siblings as an outer boundary plus a hole because it sampled
//     containment at a boundary vertex. The kernel now canonicalizes the
//     completed edge graph before node snapping and tracing; canonical
//     regions encode holes by opposing winding, so filled area is the
//     absolute sum of signed contour areas.
//     Pinned: f7_area_helper_adds_snap_touching_union_contours,
//     f7_snap_touching_union_is_order_stable.

// F8 — line/line parallel and collinear classification compared an area-like
//     cross product directly with a pixel-distance epsilon. The same two
//     separated parallel segments therefore returned zero intersections with
//     the 100 px segment first, but two false endpoint intersections with the
//     0.01 px segment first. Short perpendicular 0.01 px segments likewise
//     returned both endpoints instead of their single center crossing. The
//     kernel now uses symmetric perpendicular distances for collinearity and
//     a dimensionless direction guard only before division. P9 adds cubic
//     ellipses to the in-process exact operand-order checks.
//
// F9 — line/curve projection compared a squared line length with a pixel
//     epsilon, so true intersections disappeared below a 0.01 px line length.
//     Quadratic and cubic root solvers also compared geometry-scaled
//     polynomial coefficients with absolute parameter/sample tolerances. The
//     kernel now normalizes line projection and polynomial coefficients, with
//     pinned quadratic/cubic crossings across subpixel geometry scales.

// F10 — cubic root bisection stopped once its parameter interval reached
//     1e-6, but the subsequent line-segment acceptance check used a fixed
//     0.04 px spatial band. A crossing preserved at 10,000 px therefore
//     disappeared after scaling the same line and cubic to 1,000,000 px.
//     Cubic brackets now refine for up to 64 halvings, stopping early at f64
//     stagnation, with a pinned crossing checked in both operand orders from
//     10,000 through 100,000,000 px.

// F11 — cubic root deduplication treated every pair within 4e-6 in parameter
//     space as the same root. Two valid crossings 3.5e-6 apart therefore
//     collapsed to one even when scaling placed them 350 px apart. Cubic roots
//     are distinct by construction after breakpoint handling, so the invalid
//     tolerance deduplication is removed and this pair is pinned in both
//     operand orders.

// F12 — cubic breakpoint classification treated every normalized polynomial
//     value within 1e-12 as an exact root. Two valid crossings 1.5e-6 apart
//     were therefore replaced by their non-root extremum, even when scaling
//     placed the crossings 1,500 px apart. Breakpoint zero tests now use a
//     normalized f64 roundoff bound, distinguishing that nonzero extremum from
//     roots representable within coefficient and evaluation roundoff. The
//     coefficients are formed in line-local coordinates so the classification
//     remains invariant under a common translation.

// F13 — intersection and split canonicalization treated every parameter pair
//     within 1e-6 as the same location. Two cubic-line crossings 8e-7 apart
//     therefore collapsed twice, even though scaling placed them 800 px apart:
//     first in the intersection list and then in the boolean split parameters.
//     Parameter proximity is now only a candidate filter; both curve points
//     must also agree within the spatial tolerance before either location is
//     removed, and short-parameter pieces are retained when longer than the
//     topology snap tolerance.

// ---------------------------------------------------------------------------
// Document helpers
// ---------------------------------------------------------------------------

/// Fixed square view box for every generated document.
const VIEW_BOX_SIZE: f64 = 400.0;

fn geometry_doc(root: GeometryNode) -> GeometryDoc {
    GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: VIEW_BOX_SIZE,
            height: VIEW_BOX_SIZE,
        },
        root,
    }
}

fn path_node(d: impl Into<String>) -> GeometryNode {
    GeometryNode::Path {
        node_id: None,
        d: d.into(),
        fill_rule: None,
    }
}

fn boolean_node(op: BooleanOp, children: Vec<GeometryNode>) -> GeometryNode {
    GeometryNode::Boolean {
        node_id: None,
        op,
        children,
    }
}

fn binary_boolean_doc(op: BooleanOp, lhs: GeometryNode, rhs: GeometryNode) -> GeometryDoc {
    geometry_doc(boolean_node(op, vec![lhs, rhs]))
}

// ---------------------------------------------------------------------------
// Area helper (independent flattening; relies on canonical Region winding)
// ---------------------------------------------------------------------------

/// Number of linear subdivisions used to flatten Quad/Cubic segments.
const CURVE_FLATTEN_STEPS: usize = 16;

/// Relative tolerance for area comparisons (1% of the larger area).
const AREA_RELATIVE_EPSILON: f64 = 0.01;

/// Absolute floor for the area comparison tolerance.
const AREA_EPSILON_FLOOR: f64 = 1.0;

fn segment_point_at(segment: &CurveSegment, t: f64) -> Point2D {
    let one_minus_t = 1.0 - t;
    match segment {
        CurveSegment::Line { p0, p1 } => Point2D {
            x: p0.x + (p1.x - p0.x) * t,
            y: p0.y + (p1.y - p0.y) * t,
        },
        CurveSegment::Quad { p0, p1, p2 } => Point2D {
            x: one_minus_t * one_minus_t * p0.x + 2.0 * one_minus_t * t * p1.x + t * t * p2.x,
            y: one_minus_t * one_minus_t * p0.y + 2.0 * one_minus_t * t * p1.y + t * t * p2.y,
        },
        CurveSegment::Cubic { p0, p1, p2, p3 } => Point2D {
            x: one_minus_t * one_minus_t * one_minus_t * p0.x
                + 3.0 * one_minus_t * one_minus_t * t * p1.x
                + 3.0 * one_minus_t * t * t * p2.x
                + t * t * t * p3.x,
            y: one_minus_t * one_minus_t * one_minus_t * p0.y
                + 3.0 * one_minus_t * one_minus_t * t * p1.y
                + 3.0 * one_minus_t * t * t * p2.y
                + t * t * t * p3.y,
        },
    }
}

/// Flattens a contour into a closed polyline (last vertex implicitly
/// connects back to the first). Curve samples stop before t = 1 because the
/// segment end point equals the next segment's start point.
fn contour_polyline(contour: &Contour) -> Vec<Point2D> {
    let mut polyline = Vec::new();
    for segment in &contour.segments {
        match segment {
            CurveSegment::Line { p0, .. } => polyline.push(*p0),
            CurveSegment::Quad { .. } | CurveSegment::Cubic { .. } => {
                for step in 0..CURVE_FLATTEN_STEPS {
                    let t = step as f64 / CURVE_FLATTEN_STEPS as f64;
                    polyline.push(segment_point_at(segment, t));
                }
            }
        }
    }
    polyline
}

/// Shoelace signed area of a closed polyline.
fn polyline_signed_area(polyline: &[Point2D]) -> f64 {
    let mut doubled_area = 0.0;
    for (vertex_index, current) in polyline.iter().enumerate() {
        let next = polyline[(vertex_index + 1) % polyline.len()];
        doubled_area += current.x * next.y - next.x * current.y;
    }
    doubled_area / 2.0
}

/// Shoelace signed area of a contour after flattening curve segments.
fn contour_signed_area(contour: &Contour) -> f64 {
    polyline_signed_area(&contour_polyline(contour))
}

/// Total filled area of a region.
///
/// Evaluated regions are canonicalized for nonzero fill: outer boundaries and
/// holes have opposite winding. Summing signed contour areas therefore adds
/// sibling contours and subtracts holes at every nesting depth. Inferring
/// nesting from a contour vertex is unsafe because sibling contours may touch
/// at that vertex after kernel snapping.
fn region_area(region: &Region) -> f64 {
    region
        .contours
        .iter()
        .map(contour_signed_area)
        .sum::<f64>()
        .abs()
}

fn area_epsilon(left: f64, right: f64) -> f64 {
    (left.max(right) * AREA_RELATIVE_EPSILON).max(AREA_EPSILON_FLOOR)
}

fn areas_close(left: f64, right: f64) -> bool {
    (left - right).abs() <= area_epsilon(left, right)
}

// ---------------------------------------------------------------------------
// Area helper unit tests (fix the winding/nesting interpretation)
// ---------------------------------------------------------------------------

#[test]
fn area_helper_measures_axis_aligned_square() {
    let region = evaluate_geometry(&geometry_doc(path_node("M0 0H100V100H0Z")))
        .expect("square should evaluate");
    let area = region_area(&region);
    assert!((area - 10_000.0).abs() <= 1.0, "area={area}");
}

#[test]
fn area_helper_measures_cubic_circle_within_half_percent() {
    let region = evaluate_geometry(&geometry_doc(path_node(ellipse_path_data(
        200.0, 200.0, 50.0, 50.0,
    ))))
    .expect("circle should evaluate");
    let area = region_area(&region);
    let expected = PI * 2_500.0;
    assert!(
        ((area - expected) / expected).abs() < 0.005,
        "area={area} expected={expected}"
    );
}

#[test]
fn area_helper_donut_hole_uses_opposite_winding() {
    let donut_doc = binary_boolean_doc(
        BooleanOp::Subtract,
        path_node("M100 100H300V300H100Z"),
        path_node("M150 150H250V250H150Z"),
    );
    let region = evaluate_geometry(&donut_doc).expect("donut should evaluate");
    let signed_areas: Vec<f64> = region.contours.iter().map(contour_signed_area).collect();
    assert_eq!(signed_areas.len(), 2, "signed_areas={signed_areas:?}");
    // Boolean output is normalized for nonzero fill: holes use the opposite
    // winding from their containing outer boundary.
    assert!(
        signed_areas[0] * signed_areas[1] < 0.0,
        "expected hole to oppose the outer winding: {signed_areas:?}"
    );
    let area = region_area(&region);
    assert!(
        (area - 30_000.0).abs() <= 300.0,
        "donut area should be outer minus inner: area={area}"
    );
}

#[test]
fn area_helper_nested_island_alternates_winding() {
    let donut_node = boolean_node(
        BooleanOp::Subtract,
        vec![
            path_node("M50 50H350V350H50Z"),
            path_node("M100 100H300V300H100Z"),
        ],
    );
    let island_node = path_node("M150 150H250V250H150Z");
    let region = evaluate_geometry(&binary_boolean_doc(
        BooleanOp::Union,
        donut_node,
        island_node,
    ))
    .expect("nested island should evaluate");
    let signed_areas: Vec<f64> = region.contours.iter().map(contour_signed_area).collect();
    let positive_count = signed_areas.iter().filter(|area| **area > 0.0).count();
    let negative_count = signed_areas.iter().filter(|area| **area < 0.0).count();

    assert_eq!(signed_areas.len(), 3, "signed_areas={signed_areas:?}");
    assert_eq!(positive_count, 2, "signed_areas={signed_areas:?}");
    assert_eq!(negative_count, 1, "signed_areas={signed_areas:?}");
    assert!(
        (region_area(&region) - 60_000.0).abs() <= 600.0,
        "nested island area should be outer - hole + island: signed_areas={signed_areas:?}"
    );
}

// ---------------------------------------------------------------------------
// Shape generators
// ---------------------------------------------------------------------------

/// Cubic bezier quarter-circle handle length (4/3 * tan(pi/8)).
const ELLIPSE_KAPPA: f64 = 0.552_284_749_830_793_6;

fn ellipse_path_data(center_x: f64, center_y: f64, radius_x: f64, radius_y: f64) -> String {
    let handle_x = ELLIPSE_KAPPA * radius_x;
    let handle_y = ELLIPSE_KAPPA * radius_y;
    let x_east = center_x + radius_x;
    let x_west = center_x - radius_x;
    let y_south = center_y + radius_y;
    let y_north = center_y - radius_y;
    let x_handle_east = center_x + handle_x;
    let x_handle_west = center_x - handle_x;
    let y_handle_south = center_y + handle_y;
    let y_handle_north = center_y - handle_y;
    format!(
        "M{x_east} {center_y} \
         C{x_east} {y_handle_south} {x_handle_east} {y_south} {center_x} {y_south} \
         C{x_handle_west} {y_south} {x_west} {y_handle_south} {x_west} {center_y} \
         C{x_west} {y_handle_north} {x_handle_west} {y_north} {center_x} {y_north} \
         C{x_handle_east} {y_north} {x_east} {y_handle_north} {x_east} {center_y} Z"
    )
}

/// Simple closed polygon: vertices at strictly increasing angles around a
/// random center with per-vertex radius jitter (star-shaped, hence simple).
fn arb_radial_polygon() -> BoxedStrategy<(GeometryNode, f64, f64)> {
    (50.0_f64..250.0, 50.0_f64..250.0, 3_usize..=12)
        .prop_flat_map(|(center_x, center_y, vertex_count)| {
            proptest::collection::vec((0.05_f64..0.95, 10.0_f64..100.0), vertex_count).prop_map(
                move |vertex_params| {
                    let vertex_count_f64 = vertex_params.len() as f64;
                    let mut commands = Vec::with_capacity(vertex_params.len() + 1);
                    for (vertex_index, (angle_fraction, radius)) in vertex_params.iter().enumerate()
                    {
                        // Restricting the fractional offset to (0.05, 0.95)
                        // keeps the vertex angles strictly increasing.
                        let angle = TAU * (vertex_index as f64 + angle_fraction) / vertex_count_f64;
                        let x = center_x + radius * angle.cos();
                        let y = center_y + radius * angle.sin();
                        let command = if vertex_index == 0 { "M" } else { "L" };
                        commands.push(format!("{command}{x} {y}"));
                    }
                    commands.push("Z".to_string());
                    (path_node(commands.join(" ")), center_x, center_y)
                },
            )
        })
        .boxed()
}

/// Circle-ish shape: a 4-cubic-bezier ellipse with randomized center/radii.
fn arb_ellipse() -> BoxedStrategy<(GeometryNode, f64, f64)> {
    (
        50.0_f64..250.0,
        50.0_f64..250.0,
        10.0_f64..100.0,
        10.0_f64..100.0,
    )
        .prop_map(|(center_x, center_y, radius_x, radius_y)| {
            (
                path_node(ellipse_path_data(center_x, center_y, radius_x, radius_y)),
                center_x,
                center_y,
            )
        })
        .boxed()
}

/// Optionally wraps a base shape in a translate/scale/rotate transform whose
/// origin is the shape center.
fn with_optional_transform(
    base_shape: BoxedStrategy<(GeometryNode, f64, f64)>,
) -> BoxedStrategy<GeometryNode> {
    let transform_params = proptest::option::of((
        -200.0_f64..200.0,
        -200.0_f64..200.0,
        0.25_f64..4.0,
        0.0_f64..360.0,
    ));
    (base_shape, transform_params)
        .prop_map(|((shape, center_x, center_y), params)| match params {
            None => shape,
            Some((translate_x, translate_y, scale, rotate_deg)) => GeometryNode::Transform {
                node_id: None,
                transform: Transform2D {
                    translate_x: Some(translate_x),
                    translate_y: Some(translate_y),
                    scale_x: Some(scale),
                    scale_y: Some(scale),
                    rotate_deg: Some(rotate_deg),
                    origin_x: Some(center_x),
                    origin_y: Some(center_y),
                },
                child: Box::new(shape),
            },
        })
        .boxed()
}

/// Full shape domain: polygon or ellipse, optionally transformed.
fn arb_shape_node() -> BoxedStrategy<GeometryNode> {
    with_optional_transform(prop_oneof![arb_radial_polygon(), arb_ellipse()].boxed())
}

fn arb_boolean_op() -> BoxedStrategy<BooleanOp> {
    prop_oneof![
        Just(BooleanOp::Union),
        Just(BooleanOp::Subtract),
        Just(BooleanOp::Intersect),
        Just(BooleanOp::Xor),
    ]
    .boxed()
}

/// 2-3 shapes under one random boolean op, or a nested
/// `boolean(boolean(A, B), C)` composition.
fn arb_composed_doc() -> BoxedStrategy<GeometryDoc> {
    let flat_doc = (
        arb_boolean_op(),
        proptest::collection::vec(arb_shape_node(), 2..=3),
    )
        .prop_map(|(op, children)| geometry_doc(boolean_node(op, children)));
    let nested_doc = (
        arb_boolean_op(),
        arb_boolean_op(),
        arb_shape_node(),
        arb_shape_node(),
        arb_shape_node(),
    )
        .prop_map(|(outer_op, inner_op, shape_a, shape_b, shape_c)| {
            geometry_doc(boolean_node(
                outer_op,
                vec![boolean_node(inner_op, vec![shape_a, shape_b]), shape_c],
            ))
        });
    prop_oneof![flat_doc, nested_doc].boxed()
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

/// Default case count when `PROPTEST_CASES` is not set.
const PROPTEST_CASES_DEFAULT: u32 = 64;

fn configured_cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(PROPTEST_CASES_DEFAULT)
}

struct PropertyStats {
    name: &'static str,
    attempts: AtomicU32,
    successful: AtomicU32,
    topology_rejects: AtomicU32,
    empty_union_rejects: AtomicU32,
}

impl PropertyStats {
    const fn new(name: &'static str) -> Self {
        Self {
            name,
            attempts: AtomicU32::new(0),
            successful: AtomicU32::new(0),
            topology_rejects: AtomicU32::new(0),
            empty_union_rejects: AtomicU32::new(0),
        }
    }

    fn record_attempt(&self) {
        self.attempts.fetch_add(1, Ordering::Relaxed);
    }

    fn record_topology_reject(&self) {
        self.topology_rejects.fetch_add(1, Ordering::Relaxed);
    }

    fn record_empty_union_reject(&self) {
        self.empty_union_rejects.fetch_add(1, Ordering::Relaxed);
    }

    fn record_success(&self) {
        let successful = self.successful.fetch_add(1, Ordering::Relaxed) + 1;
        if successful != configured_cases() {
            return;
        }
        let attempts = self.attempts.load(Ordering::Relaxed);
        let topology_rejects = self.topology_rejects.load(Ordering::Relaxed);
        let empty_union_rejects = self.empty_union_rejects.load(Ordering::Relaxed);
        let topology_reject_rate = if attempts == 0 {
            0.0
        } else {
            f64::from(topology_rejects) / f64::from(attempts)
        };
        eprintln!(
            "property-stats name={} successful={} topology-rejects={} empty-union-rejects={} attempts={} topology-reject-rate={:.4}",
            self.name,
            successful,
            topology_rejects,
            empty_union_rejects,
            attempts,
            topology_reject_rate,
        );
    }
}

static P3_STATS: PropertyStats = PropertyStats::new("P3 commutativity");
static P5_STATS: PropertyStats = PropertyStats::new("P5 monotonicity");
static P6_PARTITION_STATS: PropertyStats = PropertyStats::new("P6 partition");
static P6_XOR_STATS: PropertyStats = PropertyStats::new("P6 xor");
static P7_STATS: PropertyStats = PropertyStats::new("P7 associativity");

fn require_region(doc: &GeometryDoc, label: &str) -> Result<Region, TestCaseError> {
    evaluate_geometry(doc)
        .map_err(|error| TestCaseError::fail(format!("{label} failed to evaluate: {error}")))
}

fn require_area(doc: &GeometryDoc, label: &str) -> Result<f64, TestCaseError> {
    require_region(doc, label).map(|region| region_area(&region))
}

/// Evaluates a boolean document for area-focused properties. Topology errors
/// are rejected because those properties compare successful regions rather
/// than error classification.
fn region_or_reject_topology(
    doc: &GeometryDoc,
    label: &str,
    property_stats: &PropertyStats,
) -> Result<Region, TestCaseError> {
    match evaluate_geometry(doc) {
        Ok(region) => Ok(region),
        Err(ShapeError::BooleanTopology) => {
            property_stats.record_topology_reject();
            Err(TestCaseError::reject(format!(
                "{label} hit BooleanTopology"
            )))
        }
        Err(error) => Err(TestCaseError::fail(format!(
            "{label} failed to evaluate: {error}"
        ))),
    }
}

/// Fail the property when a union of non-empty inputs comes back empty.
fn require_non_empty_union(
    union_region: &Region,
    label: &str,
    property_stats: &PropertyStats,
) -> Result<(), TestCaseError> {
    if union_region.contours.is_empty() {
        property_stats.record_empty_union_reject();
        return Err(TestCaseError::fail(format!(
            "{label} returned an empty region for non-empty inputs"
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// In-process evaluation
// ---------------------------------------------------------------------------

fn evaluation_outcome(doc: &GeometryDoc) -> String {
    match evaluate_geometry(doc) {
        Ok(region) => format!("OK {}", region_to_path(&region)),
        Err(error) => format!("ERR {error}"),
    }
}

fn commutative_consistency_verdict(shape_a: &GeometryNode, shape_b: &GeometryNode) -> String {
    for op in [BooleanOp::Union, BooleanOp::Intersect, BooleanOp::Xor] {
        let forward = evaluate_geometry(&binary_boolean_doc(op, shape_a.clone(), shape_b.clone()));
        let reversed = evaluate_geometry(&binary_boolean_doc(op, shape_b.clone(), shape_a.clone()));
        match (forward, reversed) {
            (Ok(forward_region), Ok(reversed_region)) => {
                let forward_path = region_to_path(&forward_region);
                let reversed_path = region_to_path(&reversed_region);
                if forward_path != reversed_path {
                    return format!(
                        "FAIL {op:?} path changed with operand order: {forward_path} != {reversed_path}"
                    );
                }
            }
            (Err(forward_error), Err(reversed_error)) => {
                if forward_error != reversed_error {
                    return format!(
                        "FAIL {op:?} error changed with operand order: {forward_error} != {reversed_error}"
                    );
                }
            }
            (Ok(_), Err(reversed_error)) => {
                return format!(
                    "FAIL {op:?}(B,A) failed while {op:?}(A,B) succeeded: {reversed_error}"
                );
            }
            (Err(forward_error), Ok(_)) => {
                return format!(
                    "FAIL {op:?}(A,B) failed while {op:?}(B,A) succeeded: {forward_error}"
                );
            }
        }
    }
    "PASS".to_string()
}

/// Compares `divide_regions` against the standalone Subtract/Intersect
/// evaluations and returns "PASS" or a single-line "FAIL <detail>" verdict.
fn divide_consistency_verdict(shape_a: &GeometryNode, shape_b: &GeometryNode) -> String {
    let lhs_region = match evaluate_geometry(&geometry_doc(shape_a.clone())) {
        Ok(region) => region,
        Err(error) => return format!("FAIL lhs shape failed to evaluate: {error}"),
    };
    let rhs_region = match evaluate_geometry(&geometry_doc(shape_b.clone())) {
        Ok(region) => region,
        Err(error) => return format!("FAIL rhs shape failed to evaluate: {error}"),
    };
    let divided = divide_regions(&lhs_region, &rhs_region);
    let subtract_result = evaluate_geometry(&binary_boolean_doc(
        BooleanOp::Subtract,
        shape_a.clone(),
        shape_b.clone(),
    ));
    let intersect_result = evaluate_geometry(&binary_boolean_doc(
        BooleanOp::Intersect,
        shape_a.clone(),
        shape_b.clone(),
    ));
    match divided {
        Ok(divided_regions) => match (subtract_result, intersect_result) {
            (Ok(subtract_region), Ok(intersect_region)) => {
                let divided_subtract_path = region_to_path(&divided_regions.subtract);
                let standalone_subtract_path = region_to_path(&subtract_region);
                if divided_subtract_path != standalone_subtract_path {
                    return format!(
                        "FAIL divide subtract {divided_subtract_path} != standalone {standalone_subtract_path}"
                    );
                }
                let divided_intersect_path = region_to_path(&divided_regions.intersect);
                let standalone_intersect_path = region_to_path(&intersect_region);
                if divided_intersect_path != standalone_intersect_path {
                    return format!(
                        "FAIL divide intersect {divided_intersect_path} != standalone {standalone_intersect_path}"
                    );
                }
                "PASS".to_string()
            }
            (Err(error), _) => {
                format!("FAIL standalone subtract failed while divide succeeded: {error}")
            }
            (_, Err(error)) => {
                format!("FAIL standalone intersect failed while divide succeeded: {error}")
            }
        },
        Err(divide_error) => {
            if subtract_result.is_err() || intersect_result.is_err() {
                "PASS".to_string()
            } else {
                format!("FAIL divide_regions failed ({divide_error}) but standalone ops succeeded")
            }
        }
    }
}

/// Deterministic regression for the former stack-overflow input.
#[test]
fn f4_stack_overflow_repro() {
    let doc: GeometryDoc =
        serde_json::from_str(include_str!("fixtures/stack_overflow_boolean.json"))
            .expect("fixture should parse");
    // Completing without aborting the process is the assertion; the result
    // value itself is irrelevant here.
    let _ = evaluate_geometry(&doc);
}

fn f2_containing_ellipse_node() -> GeometryNode {
    GeometryNode::Transform {
        node_id: None,
        transform: Transform2D {
            translate_x: Some(0.0),
            translate_y: Some(0.0),
            scale_x: Some(2.988_127_876_365_231_5),
            scale_y: Some(2.988_127_876_365_231_5),
            rotate_deg: Some(297.485_532_345_754_3),
            origin_x: Some(50.0),
            origin_y: Some(50.0),
        },
        child: Box::new(path_node(ellipse_path_data(50.0, 50.0, 10.0, 10.0))),
    }
}

fn f2_triangle_node() -> GeometryNode {
    path_node(
        "M59.94521895368273 51.045284632676534 \
         L44.12214747707527 58.09016994374947 \
         L45.93263356924199 40.86454542357399 Z",
    )
}

fn f2_ellipse_pair_nodes() -> (GeometryNode, GeometryNode) {
    (
        path_node(
            "M146.92873855059682 195.21780932701938 \
             C146.92873855059682 200.7406568253273 103.53226412183076 205.21780932701938 50 205.21780932701938 \
             C-3.5322641218307567 205.21780932701938 -46.92873855059682 200.7406568253273 -46.92873855059682 195.21780932701938 \
             C-46.92873855059682 189.69496182871146 -3.5322641218307567 185.21780932701938 50 185.21780932701938 \
             C103.53226412183076 185.21780932701938 146.92873855059682 189.69496182871146 146.92873855059682 195.21780932701938 Z",
        ),
        path_node(
            "M189.10513650303463 226.10465197535962 \
             C189.10513650303463 269.7229810149792 164.47929443623536 305.08262312698594 134.10177877177048 305.08262312698594 \
             C103.72426310730562 305.08262312698594 79.09842104050634 269.7229810149792 79.09842104050634 226.10465197535962 \
             C79.09842104050634 182.48632293574002 103.72426310730562 147.1266808237333 134.10177877177048 147.1266808237333 \
             C164.47929443623536 147.1266808237333 189.10513650303463 182.48632293574002 189.10513650303463 226.10465197535962 Z",
        ),
    )
}

fn f3_order_dependent_topology_nodes() -> (GeometryNode, GeometryNode) {
    (
        path_node(
            "M331.9758647425375 247.79816950016425 \
             C331.9758647425375 278.48775437839043 289.81487082116115 303.36657852762465 237.80664914078545 303.36657852762465 \
             C185.79842746040975 303.36657852762465 143.63743353903342 278.48775437839043 143.63743353903342 247.79816950016425 \
             C143.63743353903342 217.10858462193806 185.79842746040975 192.22976047270384 237.80664914078545 192.22976047270384 \
             C289.81487082116115 192.22976047270384 331.9758647425375 217.10858462193806 331.9758647425375 247.79816950016425 Z",
        ),
        GeometryNode::Transform {
            node_id: None,
            transform: Transform2D {
                translate_x: Some(-77.204_584_490_677_65),
                translate_y: Some(44.436_793_078_809_45),
                scale_x: Some(1.566_547_643_326_623),
                scale_y: Some(1.566_547_643_326_623),
                rotate_deg: Some(321.055_020_247_799_1),
                origin_x: Some(166.130_052_238_504_85),
                origin_y: Some(183.952_947_944_324_62),
            },
            child: Box::new(path_node(
                "M234.02561593086259 220.63147596831823 \
                 L197.30636237883235 271.76619885617697 \
                 L163.4696837828381 193.59257655128314 \
                 L156.93477451299034 187.88319826086385 \
                 L157.32409691993746 179.21426131959464 \
                 L164.34448329051847 174.11365205833832 \
                 L172.70943949790197 176.4222332842885 Z",
            )),
        },
    )
}

fn f5_xor_identity_nodes() -> (GeometryNode, GeometryNode) {
    (
        GeometryNode::Transform {
            node_id: None,
            transform: Transform2D {
                translate_x: Some(20.704_825_067_308_743),
                translate_y: Some(-166.402_689_398_229_77),
                scale_x: Some(2.023_788_849_633_062_3),
                scale_y: Some(2.023_788_849_633_062_3),
                rotate_deg: Some(213.919_135_828_812_93),
                origin_x: Some(50.0),
                origin_y: Some(50.0),
            },
            child: Box::new(path_node(
                "M59.20368154163175 80.90620991632733 \
                 L43.54775158153064 42.36007262165669 \
                 L64.48636370336087 46.76187522782837 Z",
            )),
        },
        GeometryNode::Transform {
            node_id: None,
            transform: Transform2D {
                translate_x: Some(-182.602_049_684_446_43),
                translate_y: Some(-175.163_986_451_246_4),
                scale_x: Some(3.287_298_548_508_667),
                scale_y: Some(3.287_298_548_508_667),
                rotate_deg: Some(150.823_426_350_999),
                origin_x: Some(231.934_008_586_561_62),
                origin_y: Some(54.801_893_216_613_97),
            },
            child: Box::new(path_node(
                "M221.15766651611034 82.7481599416792 \
                 L226.05615606363688 62.89206316036344 \
                 L195.44935437289166 -32.63210180663915 Z",
            )),
        },
    )
}

fn f6_micro_vertex_nodes() -> (GeometryNode, GeometryNode) {
    (
        path_node(
            "M189.00821960795403 160.79654496227903 \
             L185.80393670087622 167.74717189904518 \
             L177.24147997147287 205.56669664722645 \
             L137.88115088255734 187.75644418854935 \
             L137.98225774520247 158.79172946052225 \
             L172.22792179021738 153.06072171033148 \
             L179.4085274031375 150.4116564422811 \
             L186.35915433990365 153.6159393493589 Z",
        ),
        path_node(
            "M154.82969892001194 186.71606601196547 \
             L71.79416205410462 191.77528767021096 \
             L-31.201853936898857 154.26884778953823 \
             L-29.429393314176025 120.94942192888917 \
             L60.01445829274083 122.83143286157306 \
             L142.36084868921725 110.2164435096706 Z",
        ),
    )
}

fn f7_concave_union_nodes() -> (GeometryNode, GeometryNode) {
    let shape_a = path_node(
        "M190.06727773227968 255.9174947018871 L165.3344232207423 289.8709514728864 \
         L116.25431216509597 297.3293096946001 L106.75658964538371 235.22960520648846 \
         L99.52474306239051 207.56379430026305 L155.7041447634457 176.30258258086815 \
         L256.01478512794097 240.28811430344953 Z",
    );
    let shape_b = path_node(
        "M228.41385710855818 153.89946517795926 L224.4045019075221 195.05535370141743 \
         L189.37597900765675 166.58485203983614 L152.295066841423 177.28666068039752 \
         L130.8837087792427 134.4011581810051 L176.53994430007998 117.26081188781971 \
         L177.22412981666147 68.30565465838251 L198.69813431035564 91.56491595658593 \
         L277.2489291882795 91.04156629899535 Z",
    );
    (shape_a, shape_b)
}

const F7_EXPECTED_UNION_AREA: f64 = 18_004.066_591_293_48;

// ---------------------------------------------------------------------------
// Pinned repro tests for known findings
// ---------------------------------------------------------------------------

#[test]
fn f1_self_union_square_preserves_area_repro() {
    let square = path_node("M100 100H200V200H100Z");
    let square_area = require_area(&geometry_doc(square.clone()), "square").expect("square area");
    let self_union_region = require_region(
        &binary_boolean_doc(BooleanOp::Union, square.clone(), square),
        "self-union",
    )
    .expect("self-union should evaluate");
    let self_union_area = region_area(&self_union_region);
    assert!(
        areas_close(self_union_area, square_area),
        "self-union area {self_union_area} differs from square area {square_area}; path={}",
        region_to_path(&self_union_region)
    );
}

#[test]
fn f2_containing_cubic_union_is_non_empty_repro() {
    let union_region = require_region(
        &binary_boolean_doc(
            BooleanOp::Union,
            f2_triangle_node(),
            f2_containing_ellipse_node(),
        ),
        "containing cubic union",
    )
    .expect("containing cubic union should evaluate");
    assert!(
        !union_region.contours.is_empty(),
        "containing cubic union returned an empty region"
    );
}

#[test]
fn f2_overlapping_cubic_union_is_order_stable_repro() {
    let (ellipse_a, ellipse_b) = f2_ellipse_pair_nodes();
    let forward_region = require_region(
        &binary_boolean_doc(BooleanOp::Union, ellipse_a.clone(), ellipse_b.clone()),
        "union(A,B)",
    )
    .expect("union(A,B) should evaluate");
    let reversed_region = require_region(
        &binary_boolean_doc(BooleanOp::Union, ellipse_b, ellipse_a),
        "union(B,A)",
    )
    .expect("union(B,A) should evaluate");
    assert!(
        !forward_region.contours.is_empty(),
        "union(A,B) returned an empty region"
    );
    assert_eq!(
        region_to_path(&forward_region),
        region_to_path(&reversed_region),
        "union path changed with operand order"
    );
}

#[test]
fn f3_union_order_does_not_change_topology_result_repro() {
    let (ellipse, polygon) = f3_order_dependent_topology_nodes();
    let forward_region = evaluate_geometry(&binary_boolean_doc(
        BooleanOp::Union,
        ellipse.clone(),
        polygon.clone(),
    ))
    .expect("union(A,B) should evaluate");
    let reversed_region =
        evaluate_geometry(&binary_boolean_doc(BooleanOp::Union, polygon, ellipse))
            .expect("union(B,A) should evaluate");
    assert_eq!(
        region_to_path(&forward_region),
        region_to_path(&reversed_region)
    );
}

#[test]
fn f4_stack_overflow_fixture_returns_instead_of_crashing_repro() {
    let doc: GeometryDoc =
        serde_json::from_str(include_str!("fixtures/stack_overflow_boolean.json"))
            .expect("fixture should parse");
    let first = evaluation_outcome(&doc);
    let second = evaluation_outcome(&doc);
    assert_eq!(first, second);
}

#[test]
fn f5_xor_identity_matches_union_minus_intersect_repro() {
    let (shape_a, shape_b) = f5_xor_identity_nodes();
    let union_region = require_region(
        &binary_boolean_doc(BooleanOp::Union, shape_a.clone(), shape_b.clone()),
        "union",
    )
    .expect("union should evaluate");
    let intersect_region = require_region(
        &binary_boolean_doc(BooleanOp::Intersect, shape_a.clone(), shape_b.clone()),
        "intersect",
    )
    .expect("intersect should evaluate");
    let xor_region = require_region(&binary_boolean_doc(BooleanOp::Xor, shape_a, shape_b), "xor")
        .expect("xor should evaluate");
    let expected_xor_area = region_area(&union_region) - region_area(&intersect_region);
    let xor_area = region_area(&xor_region);
    assert!(
        areas_close(xor_area, expected_xor_area),
        "xor {xor_area} != union - intersect {expected_xor_area}; xor_path={}",
        region_to_path(&xor_region)
    );
}

#[test]
fn f6_union_canonical_output_is_order_stable_repro() {
    let (shape_a, shape_b) = f6_micro_vertex_nodes();
    let forward_region = require_region(
        &binary_boolean_doc(BooleanOp::Union, shape_a.clone(), shape_b.clone()),
        "union(A,B)",
    )
    .expect("union(A,B) should evaluate");
    let reversed_region = require_region(
        &binary_boolean_doc(BooleanOp::Union, shape_b, shape_a),
        "union(B,A)",
    )
    .expect("union(B,A) should evaluate");
    assert_eq!(
        region_to_path(&forward_region),
        region_to_path(&reversed_region)
    );
}

#[test]
fn f7_area_helper_adds_snap_touching_union_contours() {
    let (shape_a, shape_b) = f7_concave_union_nodes();
    let area_a = require_area(&geometry_doc(shape_a.clone()), "shape A").expect("shape A area");
    let area_b = require_area(&geometry_doc(shape_b.clone()), "shape B").expect("shape B area");
    let union_region = require_region(
        &binary_boolean_doc(BooleanOp::Union, shape_a, shape_b),
        "union",
    )
    .expect("union should evaluate");
    let union_area = region_area(&union_region);
    let measured_input_sum = area_a + area_b;

    assert!(
        areas_close(measured_input_sum, F7_EXPECTED_UNION_AREA),
        "input sum {measured_input_sum} != fixed fixture area {F7_EXPECTED_UNION_AREA}"
    );
    assert!(
        areas_close(union_area, F7_EXPECTED_UNION_AREA),
        "union area {union_area} != fixed fixture area {F7_EXPECTED_UNION_AREA}; union_path={}",
        region_to_path(&union_region)
    );
}

#[test]
fn f7_snap_touching_union_is_order_stable() {
    let (shape_a, shape_b) = f7_concave_union_nodes();
    let forward_region = require_region(
        &binary_boolean_doc(BooleanOp::Union, shape_a.clone(), shape_b.clone()),
        "union(A,B)",
    )
    .expect("union(A,B) should evaluate");
    let reversed_region = require_region(
        &binary_boolean_doc(BooleanOp::Union, shape_b, shape_a),
        "union(B,A)",
    )
    .expect("union(B,A) should evaluate");

    assert_eq!(
        region_to_path(&forward_region),
        region_to_path(&reversed_region)
    );
}

#[test]
fn f13_spatially_distinct_nearby_splits_preserve_boolean_notch() {
    let large_rectangle = path_node("M0 0H2000000000V1000000000H0Z");
    let narrow_rectangle = path_node("M1000000000 -500H1000000800V500H1000000000Z");
    let cases = [
        (
            BooleanOp::Subtract,
            "M0,0L1000000000,0L1000000000,500L1000000800,500L1000000800,0L2000000000,0L2000000000,1000000000L0,1000000000Z",
        ),
        (
            BooleanOp::Union,
            "M1000000000,-500L1000000800,-500L1000000800,0L2000000000,0L2000000000,1000000000L0,1000000000L0,0L1000000000,0Z",
        ),
    ];

    for (op, expected_path) in cases {
        let region = evaluate_geometry(&binary_boolean_doc(
            op,
            large_rectangle.clone(),
            narrow_rectangle.clone(),
        ))
        .expect("spatially distinct split parameters should preserve the boolean notch");

        assert_eq!(region_to_path(&region), expected_path, "op={op:?}");
    }
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: configured_cases(),
        ..ProptestConfig::default()
    })]

    // P1: evaluation must return Ok/Err for any generated document; a panic
    // or stack overflow fails the property binary.
    #[test]
    fn p1_evaluate_geometry_never_panics(doc in arb_composed_doc()) {
        let _ = evaluate_geometry(&doc);
    }

    // P2: repeated evaluation is byte-for-byte deterministic (canonical path
    // for Ok, error display for Err).
    #[test]
    fn p2_evaluation_is_deterministic(doc in arb_composed_doc()) {
        let first = evaluation_outcome(&doc);
        let second = evaluation_outcome(&doc);
        prop_assert_eq!(first, second);
    }

    // P3: in-process full-domain detector for operand-order stability on
    // canonical paths and topology errors.
    #[test]
    fn p3_commutative_boolean_ops_are_order_stable(
        shape_a in arb_shape_node(),
        shape_b in arb_shape_node(),
    ) {
        P3_STATS.record_attempt();
        for op in [BooleanOp::Union, BooleanOp::Intersect, BooleanOp::Xor] {
            let forward = evaluate_geometry(&binary_boolean_doc(
                op,
                shape_a.clone(),
                shape_b.clone(),
            ));
            let reversed = evaluate_geometry(&binary_boolean_doc(
                op,
                shape_b.clone(),
                shape_a.clone(),
            ));
            match (forward, reversed) {
                (Ok(forward_region), Ok(reversed_order_region)) => {
                    let forward_path = region_to_path(&forward_region);
                    let reversed_order_path = region_to_path(&reversed_order_region);
                    prop_assert_eq!(
                        forward_path,
                        reversed_order_path,
                        "{:?} path changed with operand order",
                        op
                    );
                }
                (Err(forward_error), Err(reversed_error)) => {
                    prop_assert_eq!(
                        forward_error,
                        reversed_error,
                        "{:?} error changed with operand order",
                        op
                    );
                }
                (Ok(_), Err(reversed_error)) => {
                    return Err(TestCaseError::fail(format!(
                        "{op:?}(B,A) failed while {op:?}(A,B) succeeded: {reversed_error}"
                    )));
                }
                (Err(forward_error), Ok(_)) => {
                    return Err(TestCaseError::fail(format!(
                        "{op:?}(A,B) failed while {op:?}(B,A) succeeded: {forward_error}"
                    )));
                }
            }
        }
        P3_STATS.record_success();
    }

    // P4: union of a shape with itself preserves the shape's area.
    #[test]
    fn p4_self_union_preserves_area(shape in arb_shape_node()) {
        let shape_area = require_area(&geometry_doc(shape.clone()), "shape")?;
        let self_union_area = require_area(
            &binary_boolean_doc(BooleanOp::Union, shape.clone(), shape),
            "self-union",
        )?;
        prop_assert!(
            areas_close(self_union_area, shape_area),
            "self-union area {self_union_area} differs from shape area {shape_area}"
        );
    }

    // P5: union can only grow the larger input, intersect can only shrink
    // the smaller input.
    #[test]
    fn p5_union_and_intersect_areas_are_monotonic(
        shape_a in arb_shape_node(),
        shape_b in arb_shape_node(),
    ) {
        P5_STATS.record_attempt();
        let area_a = require_area(&geometry_doc(shape_a.clone()), "lhs shape")?;
        let area_b = require_area(&geometry_doc(shape_b.clone()), "rhs shape")?;
        let union_region = region_or_reject_topology(
            &binary_boolean_doc(BooleanOp::Union, shape_a.clone(), shape_b.clone()),
            "union",
            &P5_STATS,
        )?;
        require_non_empty_union(&union_region, "union", &P5_STATS)?;
        let intersect_region = region_or_reject_topology(
            &binary_boolean_doc(BooleanOp::Intersect, shape_a, shape_b),
            "intersect",
            &P5_STATS,
        )?;
        let union_area = region_area(&union_region);
        let intersect_area = region_area(&intersect_region);
        let larger_input_area = area_a.max(area_b);
        let smaller_input_area = area_a.min(area_b);
        prop_assert!(
            union_area >= larger_input_area - area_epsilon(union_area, larger_input_area),
            "union area {union_area} < max input area {larger_input_area}"
        );
        prop_assert!(
            intersect_area
                <= smaller_input_area + area_epsilon(intersect_area, smaller_input_area),
            "intersect area {intersect_area} > min input area {smaller_input_area}"
        );
        P5_STATS.record_success();
    }

    // P6 (partition half): subtract and intersect partition the lhs area.
    #[test]
    fn p6_subtract_intersect_partition_lhs_area(
        shape_a in arb_shape_node(),
        shape_b in arb_shape_node(),
    ) {
        P6_PARTITION_STATS.record_attempt();
        let area_a = require_area(&geometry_doc(shape_a.clone()), "lhs shape")?;
        let subtract_region = region_or_reject_topology(
            &binary_boolean_doc(BooleanOp::Subtract, shape_a.clone(), shape_b.clone()),
            "subtract",
            &P6_PARTITION_STATS,
        )?;
        let intersect_region = region_or_reject_topology(
            &binary_boolean_doc(BooleanOp::Intersect, shape_a, shape_b),
            "intersect",
            &P6_PARTITION_STATS,
        )?;
        let subtract_area = region_area(&subtract_region);
        let intersect_area = region_area(&intersect_region);
        prop_assert!(
            areas_close(subtract_area + intersect_area, area_a),
            "subtract {subtract_area} + intersect {intersect_area} != lhs area {area_a}"
        );
        P6_PARTITION_STATS.record_success();
    }

    // P6 (xor half): xor equals union minus intersect by area.
    #[test]
    fn p6_xor_identity_matches_union_minus_intersect(
        shape_a in arb_shape_node(),
        shape_b in arb_shape_node(),
    ) {
        P6_XOR_STATS.record_attempt();
        let union_region = region_or_reject_topology(
            &binary_boolean_doc(BooleanOp::Union, shape_a.clone(), shape_b.clone()),
            "union",
            &P6_XOR_STATS,
        )?;
        require_non_empty_union(&union_region, "union", &P6_XOR_STATS)?;
        let intersect_region = region_or_reject_topology(
            &binary_boolean_doc(BooleanOp::Intersect, shape_a.clone(), shape_b.clone()),
            "intersect",
            &P6_XOR_STATS,
        )?;
        let xor_region = region_or_reject_topology(
            &binary_boolean_doc(BooleanOp::Xor, shape_a, shape_b),
            "xor",
            &P6_XOR_STATS,
        )?;
        let union_area = region_area(&union_region);
        let intersect_area = region_area(&intersect_region);
        let xor_area = region_area(&xor_region);
        prop_assert!(
            areas_close(xor_area, union_area - intersect_area),
            "xor {xor_area} != union {union_area} - intersect {intersect_area}"
        );
        P6_XOR_STATS.record_success();
    }

    // P7: union is associative up to the area tolerance.
    #[test]
    fn p7_union_is_associative_by_area(
        shape_a in arb_shape_node(),
        shape_b in arb_shape_node(),
        shape_c in arb_shape_node(),
    ) {
        P7_STATS.record_attempt();
        let left_doc = geometry_doc(boolean_node(
            BooleanOp::Union,
            vec![
                boolean_node(BooleanOp::Union, vec![shape_a.clone(), shape_b.clone()]),
                shape_c.clone(),
            ],
        ));
        let right_doc = geometry_doc(boolean_node(
            BooleanOp::Union,
            vec![shape_a, boolean_node(BooleanOp::Union, vec![shape_b, shape_c])],
        ));
        let left_region =
            region_or_reject_topology(&left_doc, "union(union(A,B),C)", &P7_STATS)?;
        require_non_empty_union(&left_region, "union(union(A,B),C)", &P7_STATS)?;
        let right_region =
            region_or_reject_topology(&right_doc, "union(A,union(B,C))", &P7_STATS)?;
        require_non_empty_union(&right_region, "union(A,union(B,C))", &P7_STATS)?;
        let left_area = region_area(&left_region);
        let right_area = region_area(&right_region);
        prop_assert!(
            areas_close(left_area, right_area),
            "associativity mismatch: {left_area} vs {right_area}"
        );
        P7_STATS.record_success();
    }

    // P8: divide_regions returns exactly the standalone Subtract/Intersect
    // evaluations.
    #[test]
    fn p8_divide_regions_matches_standalone_ops(
        shape_a in arb_shape_node(),
        shape_b in arb_shape_node(),
    ) {
        let verdict = divide_consistency_verdict(&shape_a, &shape_b);
        prop_assert!(verdict == "PASS", "divide consistency failed: {verdict}");
    }

    // P9: curve and polygon operands must preserve the exact path/error when
    // any commutative operation swaps its operands.
    #[test]
    fn p9_commutative_ops_are_order_stable_for_full_shape_domain(
        shape_a in arb_shape_node(),
        shape_b in arb_shape_node(),
    ) {
        let verdict = commutative_consistency_verdict(&shape_a, &shape_b);
        prop_assert!(verdict == "PASS", "commutative consistency failed: {verdict}");
    }
}
