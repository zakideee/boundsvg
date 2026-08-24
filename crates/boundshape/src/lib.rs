use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BooleanOp {
    Union,
    Subtract,
    Intersect,
    Xor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RegionAxis {
    X,
    Y,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DivideRegions {
    pub subtract: Region,
    pub intersect: Region,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryViewBox {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform2D {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translate_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translate_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotate_deg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_y: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum GeometryNode {
    Path {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        node_id: Option<String>,
        d: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fill_rule: Option<String>,
    },
    Group {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        node_id: Option<String>,
        children: Vec<GeometryNode>,
    },
    Transform {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        node_id: Option<String>,
        transform: Transform2D,
        child: Box<GeometryNode>,
    },
    Boolean {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        node_id: Option<String>,
        op: BooleanOp,
        children: Vec<GeometryNode>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryDoc {
    pub view_box: GeometryViewBox,
    pub root: GeometryNode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ElasticSegmentRole {
    FixedStart,
    Stretch,
    FixedEnd,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElasticFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElasticSegment {
    pub node_id: String,
    pub axis: String,
    pub role: ElasticSegmentRole,
    pub frame: ElasticFrame,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolDefinition {
    pub geometry: GeometryDoc,
    #[serde(default)]
    pub elastic_segments: Vec<ElasticSegment>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryPaint {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f64>,
    /// Fill rule emitted as paint and used as the compile-time default for
    /// authored paths whose geometry does not declare its own rule.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill_rule: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_linecap: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_linejoin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_dasharray: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_miterlimit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryViewport {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GeometryPreserveAspectRatio {
    #[default]
    None,
    Meet,
    Slice,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileGeometryOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paint: Option<GeometryPaint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewport: Option<GeometryViewport>,
    #[serde(default)]
    pub preserve_aspect_ratio: GeometryPreserveAspectRatio,
    /// Emit one `<path data-boundsvg-part-id="...">` per addressable part
    /// instead of a single fused path. Opt-in: splitting overlapping parts
    /// into separate elements changes paint semantics for `evenodd` fills and
    /// group opacity over the overlap.
    #[serde(default)]
    pub part_ids: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolResolutionOptions {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point2D {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MeasuredPath {
    points: Vec<MeasuredPathPoint>,
    contour: Contour,
    total_length: f64,
    closed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PathSample {
    pub point: Point2D,
    pub tangent: Point2D,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathTraversalDirection {
    Forward,
    Reverse,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct MeasuredPathPoint {
    point: Point2D,
    cumulative_length: f64,
    segment_index: usize,
    segment_t: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contour {
    pub segments: Vec<CurveSegment>,
    /// Whether SVG path serialization closes this contour with `Z`.
    /// Evaluated fills are closed; authored stroke geometry may be open.
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub closed: bool,
}

const fn default_true() -> bool {
    true
}

#[expect(
    clippy::trivially_copy_pass_by_ref,
    reason = "serde skip_serializing_if predicates receive a reference"
)]
const fn is_true(value: &bool) -> bool {
    *value
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub contours: Vec<Contour>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryIntersection {
    pub point: Point2D,
    pub t_a: f64,
    pub t_b: f64,
    pub contour_index_a: usize,
    pub segment_index_a: usize,
    pub contour_index_b: usize,
    pub segment_index_b: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum CurveSegment {
    Line {
        p0: Point2D,
        p1: Point2D,
    },
    Quad {
        p0: Point2D,
        p1: Point2D,
        p2: Point2D,
    },
    Cubic {
        p0: Point2D,
        p1: Point2D,
        p2: Point2D,
        p3: Point2D,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum ShapeError {
    #[error("boolean nodes require at least 2 children")]
    BooleanChildCount,
    #[error("invalid path data")]
    InvalidPathData,
    #[error("path command `{0}` is not supported")]
    UnsupportedPathCommand(char),
    #[error("boolean evaluation could not reconstruct a closed boundary")]
    BooleanTopology,
    #[error("duplicate addressable part id `{0}`")]
    DuplicatePartId(String),
    #[error("geometry tree exceeds max depth ({MAX_GEOMETRY_TREE_DEPTH})")]
    GeometryDepthLimit,
    #[error("path measurement supports exactly one drawable subpath")]
    PathMeasureMultipleSubpaths,
    #[error("path measurement requires a non-zero path length")]
    PathMeasureZeroLength,
    #[error("path measurement exceeded its complexity limit")]
    PathMeasureComplexityLimit,
    #[error("path offset geometry could not be materialized")]
    PathOffsetGeometry,
    #[error("path offset sampling exceeded its complexity limit")]
    PathOffsetSampleLimit,
    #[error("boolean curve-segment pair budget exceeded")]
    BooleanPairLimit,
    #[error("region axis clip requires a finite increasing interval")]
    RegionClipInterval,
    #[error("region axis clip requires axis-monotonic contour segments")]
    RegionClipNonMonotonic,
}

#[derive(Debug, Clone, Copy)]
struct GeometryTolerance {
    position_epsilon: f64,
    parameter_epsilon: f64,
    snap_epsilon: f64,
    sample_epsilon: f64,
    flatness_epsilon: f64,
    bbox_epsilon: f64,
    max_intersection_depth: usize,
}

impl Default for GeometryTolerance {
    fn default() -> Self {
        Self {
            position_epsilon: 1e-4,
            parameter_epsilon: 1e-6,
            snap_epsilon: 0.01,
            sample_epsilon: 0.02,
            flatness_epsilon: 0.02,
            bbox_epsilon: 0.01,
            max_intersection_depth: 32,
        }
    }
}

const MAX_TOPOLOGY_RECURSION: usize = 32;
/// Maximum authored geometry-node depth, counting the document root as depth 0.
pub const MAX_GEOMETRY_TREE_DEPTH: usize = 48;
const LINE_COLLINEAR_DIRECTION_EPSILON: f64 = 1e-4;
const LINE_MERGE_DIRECTION_EPSILON: f64 = 1e-6;
const LINE_PARALLEL_DIRECTION_EPSILON: f64 = 1e-12;
const PATH_MEASURE_FLATNESS_TOLERANCE: f64 = 0.01;
const PATH_MEASURE_MAX_RECURSION_DEPTH: usize = 20;
const PATH_MEASURE_MAX_POINTS: usize = 65_536;
const PATH_MEASURE_MIN_LENGTH: f64 = 1e-6;

#[cfg(test)]
std::thread_local! {
    // A public Boolean call resets this once; recursive XOR passes accumulate.
    static BOOLEAN_SEGMENT_PAIR_UPPER_BOUND: std::cell::Cell<usize> = const {
        std::cell::Cell::new(0)
    };
    static FORCE_BOOLEAN_INTERSECTION_PAIRING: std::cell::Cell<bool> = const {
        std::cell::Cell::new(false)
    };
    static REGION_INTERSECTION_SEGMENT_PAIR_UPPER_BOUND: std::cell::Cell<usize> = const {
        std::cell::Cell::new(0)
    };
    static BOOLEAN_SEGMENT_PAIR_CANDIDATE_COUNT: std::cell::Cell<usize> = const {
        std::cell::Cell::new(0)
    };
    static REGION_INTERSECTION_SEGMENT_PAIR_CANDIDATE_COUNT: std::cell::Cell<usize> = const {
        std::cell::Cell::new(0)
    };
    static CONTOUR_SELF_INTERSECTION_CANDIDATE_COUNT: std::cell::Cell<usize> = const {
        std::cell::Cell::new(0)
    };
    static SELF_INTERSECTION_SPLIT_CANDIDATE_COUNT: std::cell::Cell<usize> = const {
        std::cell::Cell::new(0)
    };
    static POINT_IN_REGION_EDGE_CANDIDATE_COUNT: std::cell::Cell<usize> = const {
        std::cell::Cell::new(0)
    };
    static FORCE_BBOX_INDEX_FULL_SCAN: std::cell::Cell<bool> = const {
        std::cell::Cell::new(false)
    };
}

#[cfg(test)]
fn force_boolean_intersection_pairing() -> bool {
    FORCE_BOOLEAN_INTERSECTION_PAIRING.with(std::cell::Cell::get)
}

#[cfg(not(test))]
const fn force_boolean_intersection_pairing() -> bool {
    false
}

#[cfg(test)]
fn force_bbox_index_full_scan() -> bool {
    FORCE_BBOX_INDEX_FULL_SCAN.with(std::cell::Cell::get)
}

#[cfg(not(test))]
const fn force_bbox_index_full_scan() -> bool {
    false
}

#[cfg(test)]
fn record_boolean_pair_upper_bound(lhs_count: usize, rhs_count: usize) {
    BOOLEAN_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| {
        pair_count.set(
            pair_count
                .get()
                .saturating_add(lhs_count.saturating_mul(rhs_count)),
        );
    });
}

#[cfg(not(test))]
const fn record_boolean_pair_upper_bound(_lhs_count: usize, _rhs_count: usize) {}

#[cfg(test)]
fn record_boolean_pair_candidates(candidate_count: usize) {
    BOOLEAN_SEGMENT_PAIR_CANDIDATE_COUNT.with(|total_candidate_count| {
        total_candidate_count.set(total_candidate_count.get().saturating_add(candidate_count));
    });
}

#[cfg(not(test))]
const fn record_boolean_pair_candidates(_candidate_count: usize) {}

#[cfg(test)]
fn record_region_intersection_pair_candidates(candidate_count: usize) {
    REGION_INTERSECTION_SEGMENT_PAIR_CANDIDATE_COUNT.with(|total_candidate_count| {
        total_candidate_count.set(total_candidate_count.get().saturating_add(candidate_count));
    });
}

#[cfg(not(test))]
const fn record_region_intersection_pair_candidates(_candidate_count: usize) {}

#[derive(Debug, Clone, Copy)]
struct AffineMatrix {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
    f: f64,
}

#[derive(Debug)]
struct ElasticContext<'a> {
    segments: &'a [ElasticSegment],
    source_width: f64,
    source_height: f64,
    target_width: f64,
    target_height: f64,
}

#[derive(Debug, Clone)]
struct IndexedSegment {
    contour_index: usize,
    segment_index: usize,
    segment: CurveSegment,
    bbox: BBox,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RegionSide {
    Lhs,
    Rhs,
}

#[derive(Debug, Clone)]
struct EdgePiece {
    segment: CurveSegment,
    start_node: usize,
    end_node: usize,
    used: bool,
}

#[derive(Debug, Clone, Copy)]
struct CurveIntersection {
    t_a: f64,
    t_b: f64,
}

#[derive(Debug, Clone, Copy)]
struct CurveSubdivision {
    bbox: BBox,
    parameter_range: (f64, f64),
}

#[derive(Debug, Clone, Copy)]
struct BBox {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

const BBOX_INDEX_LEAF_CAPACITY: usize = 8;
const BBOX_INDEX_MIN_WORK: usize = 48 * 48;
const BBOX_INDEX_MIN_QUERIES: usize = 48;

#[inline]
fn should_use_bbox_index(item_count: usize, query_count: usize) -> bool {
    let tree_depth = ceil_log2(item_count);
    let minimum_query_count = BBOX_INDEX_MIN_QUERIES.max(tree_depth.saturating_mul(tree_depth));
    item_count > BBOX_INDEX_LEAF_CAPACITY
        && query_count >= minimum_query_count
        && item_count.saturating_mul(query_count) >= BBOX_INDEX_MIN_WORK
}

fn ceil_log2(value: usize) -> usize {
    let mut remaining = value.saturating_sub(1);
    let mut exponent = 0usize;
    while remaining > 0 {
        remaining >>= 1;
        exponent += 1;
    }
    exponent
}

#[derive(Debug, Clone)]
struct BBoxIndex {
    nodes: Vec<BBoxIndexNode>,
    root: Option<usize>,
    non_finite_indices: Vec<usize>,
    item_count: usize,
}

#[derive(Debug, Clone)]
struct BBoxIndexNode {
    bbox: BBox,
    kind: BBoxIndexNodeKind,
}

#[derive(Debug, Clone)]
enum BBoxIndexNodeKind {
    Leaf(Vec<usize>),
    Branch { left: usize, right: usize },
}

#[derive(Debug, Clone)]
struct PreparedContour {
    flattened: Vec<Point2D>,
    bbox: BBox,
    is_ccw: bool,
    edge_index: Option<BBoxIndex>,
}

#[derive(Debug, Clone)]
struct PreparedRegion {
    bbox: Option<BBox>,
    contours: Vec<PreparedContour>,
}

/// Axis-aligned bounds of an evaluated part, in document coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One addressable part of an evaluated geometry document.
///
/// Part granularity follows the authoring tree: `group`/`transform` nodes are
/// transparent containers whose children stay individually addressable, while
/// a `boolean` node is a single part - its children fuse and are not
/// addressable after evaluation. `part_id` is the node's `node_id` when set,
/// otherwise `part:<index>` in traversal order (positional, so it shifts when
/// the geometry structure changes).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluatedPart {
    pub part_id: String,
    pub region: Region,
    /// Geometry a stroke should follow (see `CompiledGeometryPart::stroke_d`).
    pub stroke_region: Region,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<PartBounds>,
}

/// Evaluates a geometry document into its addressable parts.
///
/// Each part is evaluated with every ancestor `transform` baked in, using the
/// same kernel path as [`evaluate_geometry`]; concatenating all part regions
/// covers the same area as the whole-document evaluation (parts do not merge
/// across part boundaries).
///
/// # Errors
///
/// Returns `ShapeError` when the document contains invalid path data or a
/// boolean operation cannot be evaluated.
pub fn evaluate_geometry_parts(doc: &GeometryDoc) -> Result<Vec<EvaluatedPart>, ShapeError> {
    evaluate_geometry_parts_with_default_fill_rule(doc, None)
}

fn evaluate_geometry_parts_with_default_fill_rule(
    doc: &GeometryDoc,
    default_fill_rule: Option<&str>,
) -> Result<Vec<EvaluatedPart>, ShapeError> {
    validate_geometry_tree_depth(&doc.root)?;
    validate_unique_part_ids(&doc.root)?;
    let mut parts = Vec::new();
    collect_parts(&doc.root, &mut Vec::new(), &mut parts, default_fill_rule)?;
    Ok(parts)
}

fn validate_unique_part_ids(root: &GeometryNode) -> Result<(), ShapeError> {
    fn visit(
        node: &GeometryNode,
        seen: &mut HashSet<String>,
        next_part_index: &mut usize,
    ) -> Result<(), ShapeError> {
        match node {
            GeometryNode::Group { children, .. } => {
                for child in children {
                    visit(child, seen, next_part_index)?;
                }
            }
            GeometryNode::Transform { child, .. } => visit(child, seen, next_part_index)?,
            GeometryNode::Path { node_id, .. } | GeometryNode::Boolean { node_id, .. } => {
                let part_id = node_id
                    .clone()
                    .unwrap_or_else(|| format!("part:{}", *next_part_index));
                *next_part_index += 1;
                if !seen.insert(part_id.clone()) {
                    return Err(ShapeError::DuplicatePartId(part_id));
                }
                // Boolean children fuse into the boolean node and are not
                // addressable parts, so their authoring IDs do not share this
                // namespace.
            }
        }
        Ok(())
    }

    let mut next_part_index = 0;
    visit(root, &mut HashSet::new(), &mut next_part_index)
}

fn collect_parts(
    node: &GeometryNode,
    transform_stack: &mut Vec<Transform2D>,
    parts: &mut Vec<EvaluatedPart>,
    default_fill_rule: Option<&str>,
) -> Result<(), ShapeError> {
    match node {
        GeometryNode::Group { children, .. } => {
            for child in children {
                collect_parts(child, transform_stack, parts, default_fill_rule)?;
            }
            Ok(())
        }
        GeometryNode::Transform {
            transform, child, ..
        } => {
            transform_stack.push(transform.clone());
            let result = collect_parts(child, transform_stack, parts, default_fill_rule);
            transform_stack.pop();
            result
        }
        GeometryNode::Path { .. } | GeometryNode::Boolean { .. } => {
            let mut wrapped = node.clone();
            for transform in transform_stack.iter().rev() {
                wrapped = GeometryNode::Transform {
                    node_id: None,
                    transform: transform.clone(),
                    child: Box::new(wrapped),
                };
            }
            let region =
                evaluate_geometry_node_with_default_fill_rule(&wrapped, default_fill_rule)?;
            let stroke_region = evaluate_stroke_geometry(&wrapped, default_fill_rule)?;
            let part_id =
                node_id(node).map_or_else(|| format!("part:{}", parts.len()), str::to_owned);
            // A zero-area contour has no fill bbox but does have a stroke path,
            // so the part's bounds come from whichever geometry survived.
            let bounds = region_bbox(&region)
                .or_else(|| region_bbox(&stroke_region))
                .map(|bbox| PartBounds {
                    x: bbox.min_x,
                    y: bbox.min_y,
                    width: bbox.max_x - bbox.min_x,
                    height: bbox.max_y - bbox.min_y,
                });
            parts.push(EvaluatedPart {
                part_id,
                region,
                stroke_region,
                bounds,
            });
            Ok(())
        }
    }
}

/// Evaluates a declarative geometry document into a concrete region.
///
/// # Errors
///
/// Returns `ShapeError` when the document contains invalid path data or a
/// boolean operation cannot be evaluated.
pub fn evaluate_geometry(doc: &GeometryDoc) -> Result<Region, ShapeError> {
    validate_geometry_tree_depth(&doc.root)?;
    evaluate_geometry_node(&doc.root)
}

/// Applies a boolean operation between two regions.
///
/// # Errors
///
/// Returns `ShapeError` when segment intersection or edge tracing cannot build
/// a valid output region.
pub fn boolean_regions(lhs: &Region, rhs: &Region, op: BooleanOp) -> Result<Region, ShapeError> {
    let tolerance = GeometryTolerance::default();
    #[cfg(test)]
    {
        BOOLEAN_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| pair_count.set(0));
        BOOLEAN_SEGMENT_PAIR_CANDIDATE_COUNT.with(|pair_count| pair_count.set(0));
        CONTOUR_SELF_INTERSECTION_CANDIDATE_COUNT.with(|candidate_count| candidate_count.set(0));
        SELF_INTERSECTION_SPLIT_CANDIDATE_COUNT.with(|candidate_count| candidate_count.set(0));
        POINT_IN_REGION_EDGE_CANDIDATE_COUNT.with(|candidate_count| candidate_count.set(0));
    }
    // Curved operands flatten for topological robustness; the output
    // re-fits smooth polyline runs back to cubics exactly once, at this
    // public boundary. All-line results pass through byte-identical.
    let result = boolean_regions_impl(lhs, rhs, op, None)?;
    Ok(refit_region_curves(result, tolerance))
}

/// Applies a boolean operation while charging every curve-segment pair that
/// reaches the intersection loop against a caller-owned budget.
///
/// # Errors
///
/// Returns [`ShapeError::BooleanPairLimit`] before visiting a pair that would
/// exceed `remaining_pair_budget`, or the same topology errors as
/// [`boolean_regions`].
pub fn boolean_regions_with_pair_budget(
    lhs: &Region,
    rhs: &Region,
    op: BooleanOp,
    remaining_pair_budget: &mut usize,
) -> Result<Region, ShapeError> {
    let tolerance = GeometryTolerance::default();
    let result = boolean_regions_impl(lhs, rhs, op, Some(remaining_pair_budget))?;
    Ok(refit_region_curves(result, tolerance))
}

/// Projects the positive-area intersection boundary components of two
/// regions onto one axis while charging the same candidate-pair budget as a
/// boolean operation.
///
/// Unlike [`boolean_regions_with_pair_budget`], this does not reconstruct
/// closed output contours. It is intended for consumers that only need the
/// occupied axis intervals and therefore can retain the boolean kernel's
/// exact edge classification even when an otherwise valid edge set is too
/// ambiguous to trace into contours.
///
/// # Errors
///
/// Returns [`ShapeError::BooleanPairLimit`] before visiting a pair that would
/// exceed `remaining_pair_budget`.
pub fn intersection_axis_intervals_with_pair_budget(
    lhs: &Region,
    rhs: &Region,
    axis: RegionAxis,
    remaining_pair_budget: &mut usize,
) -> Result<Vec<(f64, f64)>, ShapeError> {
    let tolerance = GeometryTolerance::default();
    if lhs == rhs {
        let mut intervals = lhs
            .contours
            .iter()
            .filter_map(|contour| {
                let connected = Region {
                    contours: vec![contour.clone()],
                };
                if !region_has_positive_area(&connected) {
                    return None;
                }
                region_axis_bounds(&connected).map(|(min_x, min_y, max_x, max_y)| match axis {
                    RegionAxis::X => (min_x, max_x),
                    RegionAxis::Y => (min_y, max_y),
                })
            })
            .collect::<Vec<_>>();
        intervals.sort_by(|left, right| {
            left.0
                .total_cmp(&right.0)
                .then_with(|| left.1.total_cmp(&right.1))
        });
        return Ok(intervals);
    }

    let edges = collect_boolean_result_edges(
        lhs,
        rhs,
        BooleanOp::Intersect,
        Some(remaining_pair_budget),
        tolerance,
    )?;
    if edges.is_empty() {
        return Ok(Vec::new());
    }

    let mut edge_indices_by_node: HashMap<usize, Vec<usize>> = HashMap::new();
    for (edge_index, edge) in edges.iter().enumerate() {
        edge_indices_by_node
            .entry(edge.start_node)
            .or_default()
            .push(edge_index);
        edge_indices_by_node
            .entry(edge.end_node)
            .or_default()
            .push(edge_index);
    }

    let mut visited = vec![false; edges.len()];
    let mut intervals = Vec::new();
    for first_edge_index in 0..edges.len() {
        if visited[first_edge_index] {
            continue;
        }
        let mut pending = vec![first_edge_index];
        visited[first_edge_index] = true;
        let mut interval_min = f64::INFINITY;
        let mut interval_max = f64::NEG_INFINITY;
        while let Some(edge_index) = pending.pop() {
            let edge = &edges[edge_index];
            let edge_bbox = edge.segment.bbox();
            let (edge_min, edge_max) = match axis {
                RegionAxis::X => (edge_bbox.min_x, edge_bbox.max_x),
                RegionAxis::Y => (edge_bbox.min_y, edge_bbox.max_y),
            };
            interval_min = interval_min.min(edge_min);
            interval_max = interval_max.max(edge_max);
            for node_index in [edge.start_node, edge.end_node] {
                if let Some(connected_edge_indices) = edge_indices_by_node.get(&node_index) {
                    for &candidate_index in connected_edge_indices {
                        if !visited[candidate_index] {
                            visited[candidate_index] = true;
                            pending.push(candidate_index);
                        }
                    }
                }
            }
        }
        if interval_min.is_finite()
            && interval_max.is_finite()
            && interval_max - interval_min > tolerance.position_epsilon
        {
            intervals.push((interval_min, interval_max));
        }
    }
    intervals.sort_by(|left, right| {
        left.0
            .total_cmp(&right.0)
            .then_with(|| left.1.total_cmp(&right.1))
    });
    Ok(intervals)
}

fn boolean_regions_impl(
    lhs: &Region,
    rhs: &Region,
    op: BooleanOp,
    mut remaining_pair_budget: Option<&mut usize>,
) -> Result<Region, ShapeError> {
    let tolerance = GeometryTolerance::default();
    if lhs == rhs {
        return Ok(match op {
            BooleanOp::Union | BooleanOp::Intersect => stabilize_region(lhs.clone(), tolerance),
            BooleanOp::Subtract | BooleanOp::Xor => Region {
                contours: Vec::new(),
            },
        });
    }

    if op == BooleanOp::Xor {
        let union = boolean_regions_impl(
            lhs,
            rhs,
            BooleanOp::Union,
            remaining_pair_budget.as_deref_mut(),
        )?;
        let intersect = boolean_regions_impl(
            lhs,
            rhs,
            BooleanOp::Intersect,
            remaining_pair_budget.as_deref_mut(),
        )?;
        return boolean_regions_impl(
            &union,
            &intersect,
            BooleanOp::Subtract,
            remaining_pair_budget,
        );
    }

    let edges = collect_boolean_result_edges(lhs, rhs, op, remaining_pair_budget, tolerance)?;
    trace_edges_to_region(edges, tolerance)
}

fn collect_boolean_result_edges(
    lhs: &Region,
    rhs: &Region,
    op: BooleanOp,
    remaining_pair_budget: Option<&mut usize>,
    tolerance: GeometryTolerance,
) -> Result<Vec<EdgePiece>, ShapeError> {
    let has_curves = region_contains_curves(lhs) || region_contains_curves(rhs);
    let lhs_flattened;
    let rhs_flattened;
    let (source_lhs, source_rhs) = if has_curves {
        lhs_flattened = flatten_region_curves(lhs, tolerance);
        rhs_flattened = flatten_region_curves(rhs, tolerance);
        (&lhs_flattened, &rhs_flattened)
    } else {
        (lhs, rhs)
    };

    let lhs_segments = indexed_segments(source_lhs);
    let rhs_segments = indexed_segments(source_rhs);
    let mut lhs_params = vec![vec![0.0, 1.0]; lhs_segments.len()];
    let mut rhs_params = vec![vec![0.0, 1.0]; rhs_segments.len()];

    if force_boolean_intersection_pairing()
        || !region_bboxes_are_disjoint(source_lhs, source_rhs, tolerance)
    {
        collect_boolean_intersection_parameters(
            &lhs_segments,
            &rhs_segments,
            &mut lhs_params,
            &mut rhs_params,
            tolerance,
            remaining_pair_budget,
        )?;
    }

    let expected_membership_queries = lhs_segments.len().saturating_add(rhs_segments.len());
    let prepared_lhs =
        prepare_region_with_edge_index(source_lhs, tolerance, expected_membership_queries);
    let prepared_rhs =
        prepare_region_with_edge_index(source_rhs, tolerance, expected_membership_queries);
    let mut edges = Vec::new();

    collect_boolean_edges(
        &mut edges,
        &lhs_segments,
        &lhs_params,
        RegionSide::Lhs,
        source_lhs,
        source_rhs,
        &prepared_lhs,
        &prepared_rhs,
        op,
        tolerance,
    );
    collect_boolean_edges(
        &mut edges,
        &rhs_segments,
        &rhs_params,
        RegionSide::Rhs,
        source_lhs,
        source_rhs,
        &prepared_lhs,
        &prepared_rhs,
        op,
        tolerance,
    );

    canonicalize_edge_topology(&mut edges, tolerance);
    deduplicate_coincident_edges(&mut edges, tolerance);

    Ok(edges)
}

fn collect_boolean_intersection_parameters(
    lhs_segments: &[IndexedSegment],
    rhs_segments: &[IndexedSegment],
    lhs_params: &mut [Vec<f64>],
    rhs_params: &mut [Vec<f64>],
    tolerance: GeometryTolerance,
    mut remaining_pair_budget: Option<&mut usize>,
) -> Result<(), ShapeError> {
    record_boolean_pair_upper_bound(lhs_segments.len(), rhs_segments.len());
    if !should_use_bbox_index(rhs_segments.len(), lhs_segments.len()) {
        let pair_count = lhs_segments.len().saturating_mul(rhs_segments.len());
        consume_boolean_pair_budget(&mut remaining_pair_budget, pair_count)?;
        record_boolean_pair_candidates(pair_count);
        for (lhs_index, lhs_segment) in lhs_segments.iter().enumerate() {
            for (rhs_index, rhs_segment) in rhs_segments.iter().enumerate() {
                append_pair_intersection_parameters(
                    lhs_segment,
                    rhs_segment,
                    &mut lhs_params[lhs_index],
                    &mut rhs_params[rhs_index],
                    tolerance,
                );
            }
        }
        return Ok(());
    }

    let rhs_bboxes = rhs_segments
        .iter()
        .map(|indexed_segment| indexed_segment.bbox)
        .collect::<Vec<_>>();
    let rhs_bbox_index = BBoxIndex::new(&rhs_bboxes);
    let mut rhs_candidates = Vec::new();
    for (lhs_index, lhs_segment) in lhs_segments.iter().enumerate() {
        rhs_bbox_index.query_into(
            lhs_segment.bbox,
            tolerance.bbox_epsilon,
            &mut rhs_candidates,
        );
        consume_boolean_pair_budget(&mut remaining_pair_budget, rhs_candidates.len())?;
        record_boolean_pair_candidates(rhs_candidates.len());
        for &rhs_index in &rhs_candidates {
            append_pair_intersection_parameters(
                lhs_segment,
                &rhs_segments[rhs_index],
                &mut lhs_params[lhs_index],
                &mut rhs_params[rhs_index],
                tolerance,
            );
        }
    }
    Ok(())
}

fn consume_boolean_pair_budget(
    remaining_pair_budget: &mut Option<&mut usize>,
    pair_count: usize,
) -> Result<(), ShapeError> {
    let Some(remaining) = remaining_pair_budget.as_deref_mut() else {
        return Ok(());
    };
    if pair_count > *remaining {
        return Err(ShapeError::BooleanPairLimit);
    }
    *remaining -= pair_count;
    Ok(())
}

#[inline]
fn append_pair_intersection_parameters(
    lhs_segment: &IndexedSegment,
    rhs_segment: &IndexedSegment,
    lhs_params: &mut Vec<f64>,
    rhs_params: &mut Vec<f64>,
    tolerance: GeometryTolerance,
) {
    for intersection in intersect_curve_segments_with_bboxes(
        &lhs_segment.segment,
        &rhs_segment.segment,
        lhs_segment.bbox,
        rhs_segment.bbox,
        tolerance,
    ) {
        lhs_params.push(intersection.t_a);
        rhs_params.push(intersection.t_b);
    }
}

fn region_bboxes_are_disjoint(lhs: &Region, rhs: &Region, tolerance: GeometryTolerance) -> bool {
    // These are unions of the exact segment bboxes tested by
    // `intersect_curve_segments_with_bboxes` with the same epsilon. Disjoint
    // region boxes therefore prove every segment pair takes that empty path.
    match (region_bbox(lhs), region_bbox(rhs)) {
        (Some(lhs_bbox), Some(rhs_bbox)) if lhs_bbox.is_finite() && rhs_bbox.is_finite() => {
            !lhs_bbox.intersects(rhs_bbox, tolerance.bbox_epsilon)
        }
        (Some(_), Some(_)) => false,
        _ => true,
    }
}

const fn segment_variant_rank(segment: &CurveSegment) -> u8 {
    match segment {
        CurveSegment::Line { .. } => 0,
        CurveSegment::Quad { .. } => 1,
        CurveSegment::Cubic { .. } => 2,
    }
}

fn compare_segments_exact(lhs: &CurveSegment, rhs: &CurveSegment) -> Ordering {
    match (lhs, rhs) {
        (
            CurveSegment::Line {
                p0: lhs_p0,
                p1: lhs_p1,
            },
            CurveSegment::Line {
                p0: rhs_p0,
                p1: rhs_p1,
            },
        ) => compare_points_exact(*lhs_p0, *rhs_p0)
            .then_with(|| compare_points_exact(*lhs_p1, *rhs_p1)),
        (
            CurveSegment::Quad {
                p0: lhs_p0,
                p1: lhs_p1,
                p2: lhs_p2,
            },
            CurveSegment::Quad {
                p0: rhs_p0,
                p1: rhs_p1,
                p2: rhs_p2,
            },
        ) => compare_points_exact(*lhs_p0, *rhs_p0)
            .then_with(|| compare_points_exact(*lhs_p1, *rhs_p1))
            .then_with(|| compare_points_exact(*lhs_p2, *rhs_p2)),
        (
            CurveSegment::Cubic {
                p0: lhs_p0,
                p1: lhs_p1,
                p2: lhs_p2,
                p3: lhs_p3,
            },
            CurveSegment::Cubic {
                p0: rhs_p0,
                p1: rhs_p1,
                p2: rhs_p2,
                p3: rhs_p3,
            },
        ) => compare_points_exact(*lhs_p0, *rhs_p0)
            .then_with(|| compare_points_exact(*lhs_p1, *rhs_p1))
            .then_with(|| compare_points_exact(*lhs_p2, *rhs_p2))
            .then_with(|| compare_points_exact(*lhs_p3, *rhs_p3)),
        // Differing variants: the rank order decides.
        _ => segment_variant_rank(lhs).cmp(&segment_variant_rank(rhs)),
    }
}

fn compare_points_exact(lhs: Point2D, rhs: Point2D) -> Ordering {
    lhs.y
        .total_cmp(&rhs.y)
        .then_with(|| lhs.x.total_cmp(&rhs.x))
}

/// Computes subtract and intersect results for two regions.
///
/// # Errors
///
/// Returns `ShapeError` when either derived boolean operation fails.
pub fn divide_regions(lhs: &Region, rhs: &Region) -> Result<DivideRegions, ShapeError> {
    Ok(DivideRegions {
        subtract: boolean_regions(lhs, rhs, BooleanOp::Subtract)?,
        intersect: boolean_regions(lhs, rhs, BooleanOp::Intersect)?,
    })
}

#[must_use]
pub fn intersections_between_regions(lhs: &Region, rhs: &Region) -> Vec<GeometryIntersection> {
    let tolerance = GeometryTolerance::default();
    #[cfg(test)]
    {
        REGION_INTERSECTION_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| pair_count.set(0));
        REGION_INTERSECTION_SEGMENT_PAIR_CANDIDATE_COUNT.with(|pair_count| pair_count.set(0));
    }
    if region_bboxes_are_disjoint(lhs, rhs, tolerance) {
        return Vec::new();
    }
    let lhs_segments = indexed_segments(lhs);
    let rhs_segments = indexed_segments(rhs);
    #[cfg(test)]
    REGION_INTERSECTION_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| {
        pair_count.set(lhs_segments.len().saturating_mul(rhs_segments.len()));
    });
    let mut intersections = Vec::new();
    if should_use_bbox_index(rhs_segments.len(), lhs_segments.len()) {
        let rhs_bboxes = rhs_segments
            .iter()
            .map(|indexed_segment| indexed_segment.bbox)
            .collect::<Vec<_>>();
        let rhs_bbox_index = BBoxIndex::new(&rhs_bboxes);
        let mut rhs_candidates = Vec::new();
        for lhs_segment in &lhs_segments {
            rhs_bbox_index.query_into(
                lhs_segment.bbox,
                tolerance.bbox_epsilon,
                &mut rhs_candidates,
            );
            record_region_intersection_pair_candidates(rhs_candidates.len());
            for &rhs_index in &rhs_candidates {
                append_geometry_pair_intersections(
                    lhs_segment,
                    &rhs_segments[rhs_index],
                    tolerance,
                    &mut intersections,
                );
            }
        }
    } else {
        record_region_intersection_pair_candidates(
            lhs_segments.len().saturating_mul(rhs_segments.len()),
        );
        for lhs_segment in &lhs_segments {
            for rhs_segment in &rhs_segments {
                append_geometry_pair_intersections(
                    lhs_segment,
                    rhs_segment,
                    tolerance,
                    &mut intersections,
                );
            }
        }
    }

    canonicalize_geometry_intersections(&mut intersections, tolerance);
    intersections
}

#[inline]
fn append_geometry_pair_intersections(
    lhs_segment: &IndexedSegment,
    rhs_segment: &IndexedSegment,
    tolerance: GeometryTolerance,
    intersections: &mut Vec<GeometryIntersection>,
) {
    for intersection in intersect_curve_segments_with_bboxes(
        &lhs_segment.segment,
        &rhs_segment.segment,
        lhs_segment.bbox,
        rhs_segment.bbox,
        tolerance,
    ) {
        intersections.push(GeometryIntersection {
            point: lhs_segment.segment.eval(intersection.t_a),
            t_a: intersection.t_a,
            t_b: intersection.t_b,
            contour_index_a: lhs_segment.contour_index,
            segment_index_a: lhs_segment.segment_index,
            contour_index_b: rhs_segment.contour_index,
            segment_index_b: rhs_segment.segment_index,
        });
    }
}

/// Finds intersections between two declarative geometry documents.
///
/// # Errors
///
/// Returns `ShapeError` when either document cannot be evaluated.
pub fn intersections_between_geometries(
    lhs: &GeometryDoc,
    rhs: &GeometryDoc,
) -> Result<Vec<GeometryIntersection>, ShapeError> {
    let lhs_region = evaluate_geometry(lhs)?;
    let rhs_region = evaluate_geometry(rhs)?;
    Ok(intersections_between_regions(&lhs_region, &rhs_region))
}

#[must_use]
pub fn region_to_path(region: &Region) -> String {
    let mut fragments = Vec::new();
    for contour in &region.contours {
        if contour.segments.is_empty() {
            continue;
        }
        let start = contour.segments[0].start();
        let mut commands = Vec::new();
        commands.push(format!(
            "M{},{}",
            format_path_number(start.x),
            format_path_number(start.y)
        ));
        let last_index = contour.segments.len().saturating_sub(1);
        for (segment_index, segment) in contour.segments.iter().enumerate() {
            let is_redundant_close_line = contour.closed
                && segment_index == last_index
                && matches!(
                    segment,
                    CurveSegment::Line { p1, .. }
                        if points_close(*p1, start, GeometryTolerance::default().position_epsilon)
                );
            if is_redundant_close_line {
                continue;
            }
            commands.push(segment_to_path_command(segment));
        }
        if contour.closed {
            commands.push("Z".to_string());
        }
        fragments.push(commands.join(""));
    }
    fragments.join(" ")
}

/// Returns exact axis-aligned bounds for a concrete region. Curve extrema,
/// rather than control-point bounds, define the result.
#[must_use]
pub fn region_axis_bounds(region: &Region) -> Option<(f64, f64, f64, f64)> {
    region_exact_bbox(region).map(|bbox| (bbox.min_x, bbox.min_y, bbox.max_x, bbox.max_y))
}

/// Returns whether at least one contour encloses positive area at the boolean
/// kernel's deterministic tolerance.
#[must_use]
pub fn region_has_positive_area(region: &Region) -> bool {
    let tolerance = GeometryTolerance::default();
    region.contours.iter().any(|contour| {
        contour_area_abs(contour, tolerance)
            > tolerance.position_epsilon * tolerance.position_epsilon
    })
}

/// Clips axis-monotonic region contours to one closed axis interval.
///
/// This is an analytic slab clip: retained curve segments keep their original
/// degree, clip-boundary joins are lines, and the returned region is
/// canonicalized. Each source contour must be monotonic along `axis` within
/// every segment; this covers resolved decoration cells and strips without
/// flattening their curves.
///
/// # Errors
///
/// Returns [`ShapeError::RegionClipInterval`] for a non-finite or empty
/// interval and [`ShapeError::RegionClipNonMonotonic`] when a segment's
/// control polygon is not monotonic along the selected axis.
pub fn clip_monotonic_region_to_axis_interval(
    region: &Region,
    axis: RegionAxis,
    interval_min: f64,
    interval_max: f64,
) -> Result<Region, ShapeError> {
    if !interval_min.is_finite() || !interval_max.is_finite() || interval_max <= interval_min {
        return Err(ShapeError::RegionClipInterval);
    }
    let tolerance = GeometryTolerance::default();
    let mut contours = Vec::new();
    for contour in &region.contours {
        let Some(clipped_contour) =
            clip_monotonic_contour_to_axis_interval(contour, axis, interval_min, interval_max)?
        else {
            continue;
        };
        if contour_area_abs(&clipped_contour, tolerance)
            > tolerance.position_epsilon * tolerance.position_epsilon
        {
            contours.push(clipped_contour);
        }
    }
    Ok(stabilize_region(Region { contours }, tolerance))
}

/// Canonicalizes contour orientation, start points, ordering, and redundant
/// line segments using the boolean kernel's deterministic tolerance.
#[must_use]
pub fn canonicalize_region(region: Region) -> Region {
    stabilize_region(region, GeometryTolerance::default())
}

/// Resolves self-intersections and canonicalizes a concrete nonzero-filled
/// region without reparsing it through SVG path data.
///
/// # Errors
///
/// Returns [`ShapeError::BooleanTopology`] when a deterministic positive fill
/// cannot be reconstructed.
pub fn normalize_filled_region(region: Region) -> Result<Region, ShapeError> {
    let tolerance = GeometryTolerance::default();
    normalize_region(region, "nonzero", tolerance).map(|value| stabilize_region(value, tolerance))
}

#[must_use]
pub fn region_to_svg(region: &Region, options: Option<&CompileGeometryOptions>) -> String {
    let bbox = region_bbox(region).unwrap_or(BBox {
        min_x: 0.0,
        min_y: 0.0,
        max_x: 0.0,
        max_y: 0.0,
    });
    let target_width = options
        .and_then(|value| value.viewport.as_ref())
        .map_or(bbox.max_x - bbox.min_x, |value| value.width);
    let target_height = options
        .and_then(|value| value.viewport.as_ref())
        .map_or(bbox.max_y - bbox.min_y, |value| value.height);
    let fitted_region = fit_region_to_target_box(
        region,
        &bbox,
        target_width,
        target_height,
        options.and_then(|value| value.paint.as_ref()),
        options.map_or(GeometryPreserveAspectRatio::None, |value| {
            value.preserve_aspect_ratio
        }),
    );
    let view_box = GeometryViewBox {
        x: 0.0,
        y: 0.0,
        width: target_width,
        height: target_height,
    };
    render_region_svg(
        &fitted_region,
        &view_box,
        options.and_then(|value| value.paint.as_ref()),
    )
}

/// Resolve a symbol definition for the requested output dimensions.
///
/// # Errors
///
/// Returns [`ShapeError::GeometryDepthLimit`] when either the authored symbol
/// geometry or its resolved elastic wrapper exceeds the geometry-tree depth
/// limit.
pub fn resolve_symbol_geometry(
    definition: &SymbolDefinition,
    options: &SymbolResolutionOptions,
) -> Result<GeometryDoc, ShapeError> {
    validate_geometry_tree_depth(&definition.geometry.root)?;
    let width = if options.width > 0.0 {
        options.width
    } else {
        definition.geometry.view_box.width
    };
    let height = if options.height > 0.0 {
        options.height
    } else {
        definition.geometry.view_box.height
    };

    if definition.elastic_segments.is_empty() {
        return Ok(definition.geometry.clone());
    }

    let view_box = GeometryViewBox {
        x: definition.geometry.view_box.x,
        y: definition.geometry.view_box.y,
        width: resolve_resolved_size(
            "x",
            definition.geometry.view_box.width,
            &definition.elastic_segments,
            width,
        ),
        height: resolve_resolved_size(
            "y",
            definition.geometry.view_box.height,
            &definition.elastic_segments,
            height,
        ),
    };

    let ctx = ElasticContext {
        segments: &definition.elastic_segments,
        source_width: definition.geometry.view_box.width,
        source_height: definition.geometry.view_box.height,
        target_width: width,
        target_height: height,
    };

    let geometry = GeometryDoc {
        view_box,
        root: apply_elastic_segments(&definition.geometry.root, &ctx),
    };
    validate_geometry_tree_depth(&geometry.root)?;
    Ok(geometry)
}

/// Hit-test tuning for [`hit_test_geometry_parts`]. All values are in
/// geometry (viewBox) units - callers working in canvas px convert first.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitTestOptions {
    /// Stroke band width; a point within `stroke_width / 2 + tolerance` of a
    /// part boundary reports a stroke hit (which wins over fill, matching
    /// paint order). `None` or `0` disables stroke hits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f64>,
    /// Extra slop added to the stroke band (defaults to the kernel position
    /// epsilon).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tolerance: Option<f64>,
    /// Default fill rule for paths that do not declare one themselves.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill_rule: Option<String>,
}

/// How a part was hit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PartHitKind {
    Fill,
    Stroke,
}

/// One hit part, in document (paint) order - the topmost hit is last.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartHit {
    pub part_id: String,
    pub hit: PartHitKind,
}

/// Precise per-part hit test in geometry coordinates.
///
/// Parts are evaluated with the same kernel path as
/// [`evaluate_geometry_parts`]; fill containment uses the canonicalized
/// region (curves flatten at the default tolerance), stroke hits use the
/// distance to the flattened boundary.
///
/// # Errors
///
/// Returns `ShapeError` when the document contains invalid path data or a
/// boolean operation cannot be evaluated.
pub fn hit_test_geometry_parts(
    doc: &GeometryDoc,
    point: Point2D,
    options: Option<&HitTestOptions>,
) -> Result<Vec<PartHit>, ShapeError> {
    let tolerance = GeometryTolerance::default();
    let slop = options
        .and_then(|value| value.tolerance)
        .unwrap_or(tolerance.position_epsilon);
    let stroke_band = options
        .and_then(|value| value.stroke_width)
        .filter(|value| *value > 0.0)
        .map(|value| value * 0.5 + slop);

    let default_fill_rule = options.and_then(|value| value.fill_rule.as_deref());
    let parts = evaluate_geometry_parts_with_default_fill_rule(doc, default_fill_rule)?;
    let mut hits = Vec::new();
    for part in &parts {
        let stroke_hit = stroke_band.is_some_and(|band| {
            region_boundary_distance(&part.stroke_region, point, tolerance) <= band
        });
        if stroke_hit {
            hits.push(PartHit {
                part_id: part.part_id.clone(),
                hit: PartHitKind::Stroke,
            });
            continue;
        }
        let prepared = prepare_region(&part.region, tolerance);
        if point_in_region(&part.region, &prepared, point) {
            hits.push(PartHit {
                part_id: part.part_id.clone(),
                hit: PartHitKind::Fill,
            });
        }
    }
    Ok(hits)
}

fn region_boundary_distance(region: &Region, point: Point2D, tolerance: GeometryTolerance) -> f64 {
    let mut min_distance = f64::INFINITY;
    for contour in &region.contours {
        let polyline = flatten_contour(contour, tolerance);
        for window in polyline.windows(2) {
            min_distance = min_distance.min(point_segment_distance(point, window[0], window[1]));
        }
    }
    min_distance
}

fn point_segment_distance(point: Point2D, start: Point2D, end: Point2D) -> f64 {
    let segment = subtract_points(end, start);
    let length_squared = segment.x * segment.x + segment.y * segment.y;
    if length_squared <= 1e-24 {
        return point_distance(point, start);
    }
    let to_point = subtract_points(point, start);
    let t = clamp_unit((to_point.x * segment.x + to_point.y * segment.y) / length_squared);
    point_distance(point, lerp_point(start, end, t))
}

/// One compiled part of a geometry document: viewport-baked path data plus
/// the baked axis-aligned bounds (in viewport coordinates).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledGeometryPart {
    /// `None` when the document compiled as a single fused region
    /// (`part_ids: false`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part_id: Option<String>,
    pub d: String,
    /// Path a stroke should follow, when it differs from `d`.
    ///
    /// Fill normalization drops zero-area contours and retraces
    /// self-intersections, so `d` alone cannot stroke a line or a crossing
    /// outline. `None` means `d` already is the stroke path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_d: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<PartBounds>,
}

/// Compiles a geometry document into per-part path data instead of an SVG
/// document string. Same evaluation, baking, and serialization as
/// [`compile_geometry_to_svg_document`]; empty parts are skipped exactly like
/// the SVG renderers skip empty paths.
///
/// # Errors
///
/// Returns `ShapeError` when the document contains invalid path data or a
/// boolean operation cannot be evaluated.
pub fn compile_geometry_paths(
    geometry: &GeometryDoc,
    options: Option<&CompileGeometryOptions>,
) -> Result<Vec<CompiledGeometryPart>, ShapeError> {
    validate_geometry_tree_depth(&geometry.root)?;
    validate_unique_part_ids(&geometry.root)?;
    let compiled_options = options.cloned().unwrap_or_default();
    let default_fill_rule = compiled_options
        .paint
        .as_ref()
        .and_then(|paint| paint.fill_rule.as_deref());
    let bake = |region: &Region| -> Region {
        bake_region_to_viewport(
            region,
            &geometry.view_box,
            compiled_options.viewport.as_ref(),
            compiled_options.paint.as_ref(),
            compiled_options.preserve_aspect_ratio,
        )
    };
    let to_part = |part_id: Option<String>,
                   region: Region,
                   stroke_region: Region|
     -> Option<CompiledGeometryPart> {
        let d = region_to_path(&region);
        let stroke_path = region_to_path(&stroke_region);
        // A shape whose fill normalized to nothing (a line, a zero-area
        // contour) still has a stroke to draw. Only a shape with neither is
        // empty.
        if d.is_empty() && stroke_path.is_empty() {
            return None;
        }
        // `d` already strokes correctly for the common case; carry a separate
        // stroke path only when normalization changed the geometry.
        let stroke_d = (stroke_path != d).then_some(stroke_path);
        let bounds = region_bbox(&region)
            .or_else(|| region_bbox(&stroke_region))
            .map(|bbox| PartBounds {
                x: bbox.min_x,
                y: bbox.min_y,
                width: bbox.max_x - bbox.min_x,
                height: bbox.max_y - bbox.min_y,
            });
        Some(CompiledGeometryPart {
            part_id,
            d,
            stroke_d,
            bounds,
        })
    };
    if compiled_options.part_ids {
        let parts = evaluate_geometry_parts_with_default_fill_rule(geometry, default_fill_rule)?;
        return Ok(parts
            .into_iter()
            .filter_map(|part| {
                to_part(
                    Some(part.part_id),
                    bake(&part.region),
                    bake(&part.stroke_region),
                )
            })
            .collect());
    }
    let region = evaluate_geometry_node_with_default_fill_rule(&geometry.root, default_fill_rule)?;
    let stroke_region = evaluate_stroke_geometry(&geometry.root, default_fill_rule)?;
    Ok(to_part(None, bake(&region), bake(&stroke_region))
        .into_iter()
        .collect())
}

/// Compiles a geometry document into an SVG document string.
///
/// # Errors
///
/// Returns `ShapeError` when geometry evaluation or viewport baking fails.
pub fn compile_geometry_to_svg_document(
    geometry: &GeometryDoc,
    options: Option<&CompileGeometryOptions>,
) -> Result<String, ShapeError> {
    let compiled_options = options.cloned().unwrap_or_default();
    let baked_view_box = GeometryViewBox {
        x: 0.0,
        y: 0.0,
        width: compiled_options
            .viewport
            .as_ref()
            .map_or(geometry.view_box.width, |value| value.width),
        height: compiled_options
            .viewport
            .as_ref()
            .map_or(geometry.view_box.height, |value| value.height),
    };
    let parts = compile_geometry_paths(geometry, Some(&compiled_options))?;
    Ok(render_compiled_parts_svg(
        &parts,
        &baked_view_box,
        compiled_options.paint.as_ref(),
    ))
}

#[must_use]
pub fn transform_to_svg(transform: &Transform2D) -> String {
    let mut commands = Vec::new();
    if transform.translate_x.unwrap_or(0.0) != 0.0 || transform.translate_y.unwrap_or(0.0) != 0.0 {
        commands.push(format!(
            "translate({} {})",
            format_svg_number(transform.translate_x.unwrap_or(0.0)),
            format_svg_number(transform.translate_y.unwrap_or(0.0))
        ));
    }

    let origin_x = transform.origin_x.unwrap_or(0.0);
    let origin_y = transform.origin_y.unwrap_or(0.0);
    if let Some(rotate_deg) = transform.rotate_deg {
        commands.push(format!(
            "rotate({} {} {})",
            format_svg_number(rotate_deg),
            format_svg_number(origin_x),
            format_svg_number(origin_y)
        ));
    }
    if transform.scale_x.is_some() || transform.scale_y.is_some() {
        let scale_x = transform.scale_x.unwrap_or(1.0);
        let scale_y = transform.scale_y.unwrap_or(1.0);
        if origin_x != 0.0 || origin_y != 0.0 {
            commands.push(format!(
                "translate({} {})",
                format_svg_number(origin_x),
                format_svg_number(origin_y)
            ));
            commands.push(format!(
                "scale({} {})",
                format_svg_number(scale_x),
                format_svg_number(scale_y)
            ));
            commands.push(format!(
                "translate({} {})",
                format_svg_number(-origin_x),
                format_svg_number(-origin_y)
            ));
        } else {
            commands.push(format!(
                "scale({} {})",
                format_svg_number(scale_x),
                format_svg_number(scale_y)
            ));
        }
    }
    commands.join(" ")
}

fn evaluate_geometry_node(node: &GeometryNode) -> Result<Region, ShapeError> {
    evaluate_geometry_node_with_default_fill_rule(node, None)
}

/// Validate a geometry tree before recursive processing.
///
/// # Errors
///
/// Returns [`ShapeError::GeometryDepthLimit`] when a node exceeds
/// [`MAX_GEOMETRY_TREE_DEPTH`].
pub fn validate_geometry_tree_depth(root: &GeometryNode) -> Result<(), ShapeError> {
    let mut pending = vec![(root, 0usize)];
    while let Some((node, depth)) = pending.pop() {
        if depth > MAX_GEOMETRY_TREE_DEPTH {
            return Err(ShapeError::GeometryDepthLimit);
        }
        match node {
            GeometryNode::Path { .. } => {}
            GeometryNode::Transform { child, .. } => {
                pending.push((child, depth + 1));
            }
            GeometryNode::Group { children, .. } | GeometryNode::Boolean { children, .. } => {
                pending.extend(children.iter().map(|child| (child, depth + 1)));
            }
        }
    }
    Ok(())
}

fn evaluate_geometry_node_with_default_fill_rule(
    node: &GeometryNode,
    default_fill_rule: Option<&str>,
) -> Result<Region, ShapeError> {
    match node {
        GeometryNode::Path { d, fill_rule, .. } => {
            parse_path_region(d, fill_rule.as_deref().or(default_fill_rule))
        }
        GeometryNode::Group { children, .. } => {
            let mut contours = Vec::new();
            for child in children {
                contours.extend(
                    evaluate_geometry_node_with_default_fill_rule(child, default_fill_rule)?
                        .contours,
                );
            }
            Ok(Region { contours })
        }
        GeometryNode::Transform {
            transform, child, ..
        } => {
            let region = evaluate_geometry_node_with_default_fill_rule(child, default_fill_rule)?;
            Ok(transform_region(&region, transform_to_matrix(transform)))
        }
        GeometryNode::Boolean { op, children, .. } => {
            if children.len() < 2 {
                return Err(ShapeError::BooleanChildCount);
            }
            let mut iter = children.iter();
            let Some(first_child) = iter.next() else {
                return Err(ShapeError::BooleanChildCount);
            };
            let mut current =
                evaluate_geometry_node_with_default_fill_rule(first_child, default_fill_rule)?;
            for child in iter {
                let next_region =
                    evaluate_geometry_node_with_default_fill_rule(child, default_fill_rule)?;
                current = boolean_regions(&current, &next_region, *op)?;
            }
            Ok(current)
        }
    }
}

fn parse_path_region(path_data: &str, fill_rule: Option<&str>) -> Result<Region, ShapeError> {
    let authored = close_region_for_fill(parse_path_contours(path_data)?);
    normalize_region(
        authored,
        fill_rule.unwrap_or("nonzero"),
        GeometryTolerance::default(),
    )
}

/// SVG fills implicitly close every open subpath without changing its stroke.
/// Boolean evaluation therefore receives only this closed fill projection.
fn close_region_for_fill(mut region: Region) -> Region {
    for contour in &mut region.contours {
        if contour.closed || contour.segments.is_empty() {
            continue;
        }
        let start = contour.segments[0].start();
        let end = contour.segments.last().map_or(start, CurveSegment::end);
        if !points_close(start, end, GeometryTolerance::default().position_epsilon) {
            contour
                .segments
                .push(CurveSegment::Line { p0: end, p1: start });
        }
        contour.closed = true;
    }
    region
}

/// Parse path data into the contours the author drew, before any fill-topology
/// normalization.
///
/// Fill normalization retraces self-intersections and discards contours with no
/// area — correct for filling, wrong for stroking, where a zero-area contour is
/// exactly the line the author asked for. Stroking works from this region.
#[expect(
    clippy::too_many_lines,
    reason = "SVG path parsing keeps command state in one loop to preserve path command semantics"
)]
#[expect(
    clippy::cognitive_complexity,
    reason = "SVG path command state is intentionally handled in one parser loop"
)]
fn parse_path_contours(path_data: &str) -> Result<Region, ShapeError> {
    let tokens = tokenize_path_data(path_data)?;
    if tokens.is_empty() {
        return Ok(Region {
            contours: Vec::new(),
        });
    }

    let mut index = 0usize;
    let mut current_command: Option<char> = None;
    let mut saw_initial_moveto = false;
    let mut contours = Vec::new();
    let mut current_segments = Vec::new();
    let mut current = Point2D { x: 0.0, y: 0.0 };
    let mut subpath_start: Option<Point2D> = None;
    // Control point of the previous cubic / quadratic, for the smooth commands.
    // SVG reflects it through the current point; with no previous curve of the
    // matching kind, the reflection collapses onto the current point.
    let mut previous_cubic_control: Option<Point2D> = None;
    let mut previous_quad_control: Option<Point2D> = None;

    while index < tokens.len() {
        let token = &tokens[index];
        let command = if is_command_token(token) {
            let command = token.chars().next().unwrap_or_default();
            index += 1;
            current_command = Some(command);
            command
        } else {
            current_command.ok_or(ShapeError::InvalidPathData)?
        };

        let is_relative = command.is_ascii_lowercase();
        let upper = command.to_ascii_uppercase();
        if !saw_initial_moveto {
            if upper != 'M' {
                return Err(ShapeError::InvalidPathData);
            }
            saw_initial_moveto = true;
        }
        // SVG reflects the previous control point only when the previous command
        // was a curve of the matching kind; otherwise the reflection is the
        // current point. Clearing here and letting the curve arms re-set it
        // keeps that rule in one place.
        if !matches!(upper, 'C' | 'S') {
            previous_cubic_control = None;
        }
        if !matches!(upper, 'Q' | 'T') {
            previous_quad_control = None;
        }
        match upper {
            'M' => {
                // A moveto ends the previous subpath. Keep a drawn open
                // subpath for stroking; its fill projection closes it later.
                if !current_segments.is_empty() {
                    contours.push(Contour {
                        segments: std::mem::take(&mut current_segments),
                        closed: false,
                    });
                }
                let (mut point, next_index) = read_point_token(&tokens, index)?;
                if is_relative {
                    point = add_points(current, point);
                }
                index = next_index;
                current = point;
                subpath_start = Some(point);
                while let Some((mut next_point, consumed)) = try_read_point_token(&tokens, index) {
                    if is_relative {
                        next_point = add_points(current, next_point);
                    }
                    if points_close(
                        current,
                        next_point,
                        GeometryTolerance::default().position_epsilon,
                    ) {
                        index = consumed;
                        current = next_point;
                        continue;
                    }
                    current_segments.push(CurveSegment::Line {
                        p0: current,
                        p1: next_point,
                    });
                    current = next_point;
                    index = consumed;
                }
            }
            'L' => {
                let mut consumed_any = false;
                while let Some((mut point, consumed)) = try_read_point_token(&tokens, index) {
                    if is_relative {
                        point = add_points(current, point);
                    }
                    if !points_close(
                        current,
                        point,
                        GeometryTolerance::default().position_epsilon,
                    ) {
                        current_segments.push(CurveSegment::Line {
                            p0: current,
                            p1: point,
                        });
                    }
                    current = point;
                    index = consumed;
                    consumed_any = true;
                }
                if !consumed_any {
                    return Err(ShapeError::InvalidPathData);
                }
            }
            'H' => {
                let mut consumed_any = false;
                while let Some((x, consumed)) = try_read_number_token(&tokens, index) {
                    let point = Point2D {
                        x: if is_relative { current.x + x } else { x },
                        y: current.y,
                    };
                    if !points_close(
                        current,
                        point,
                        GeometryTolerance::default().position_epsilon,
                    ) {
                        current_segments.push(CurveSegment::Line {
                            p0: current,
                            p1: point,
                        });
                    }
                    current = point;
                    index = consumed;
                    consumed_any = true;
                }
                if !consumed_any {
                    return Err(ShapeError::InvalidPathData);
                }
            }
            'V' => {
                let mut consumed_any = false;
                while let Some((y, consumed)) = try_read_number_token(&tokens, index) {
                    let point = Point2D {
                        x: current.x,
                        y: if is_relative { current.y + y } else { y },
                    };
                    if !points_close(
                        current,
                        point,
                        GeometryTolerance::default().position_epsilon,
                    ) {
                        current_segments.push(CurveSegment::Line {
                            p0: current,
                            p1: point,
                        });
                    }
                    current = point;
                    index = consumed;
                    consumed_any = true;
                }
                if !consumed_any {
                    return Err(ShapeError::InvalidPathData);
                }
            }
            'S' => {
                let run = read_smooth_cubic_run(
                    &tokens,
                    index,
                    is_relative,
                    current,
                    previous_cubic_control,
                )?;
                current_segments.extend(run.segments);
                previous_cubic_control = run.control;
                current = run.current;
                index = run.next_index;
            }
            'T' => {
                let run = read_smooth_quad_run(
                    &tokens,
                    index,
                    is_relative,
                    current,
                    previous_quad_control,
                )?;
                current_segments.extend(run.segments);
                previous_quad_control = run.control;
                current = run.current;
                index = run.next_index;
            }
            'Q' => {
                let run = read_quad_run(&tokens, index, is_relative, current)?;
                current_segments.extend(run.segments);
                previous_quad_control = run.control;
                current = run.current;
                index = run.next_index;
            }
            'C' => {
                let run = read_cubic_run(&tokens, index, is_relative, current)?;
                current_segments.extend(run.segments);
                previous_cubic_control = run.control;
                current = run.current;
                index = run.next_index;
            }
            'A' => {
                let mut consumed_any = false;
                while let Some((arc, consumed)) = try_read_arc_token(&tokens, index) {
                    let end_point = if is_relative {
                        add_points(current, arc.end)
                    } else {
                        arc.end
                    };
                    let segments = arc_to_cubic_segments(current, end_point, &arc);
                    for segment in segments {
                        current_segments.push(segment);
                    }
                    current = end_point;
                    index = consumed;
                    consumed_any = true;
                }
                if !consumed_any {
                    return Err(ShapeError::InvalidPathData);
                }
            }
            'Z' => {
                let Some(start_point) = subpath_start else {
                    return Err(ShapeError::InvalidPathData);
                };
                if !points_close(
                    current,
                    start_point,
                    GeometryTolerance::default().position_epsilon,
                ) {
                    current_segments.push(CurveSegment::Line {
                        p0: current,
                        p1: start_point,
                    });
                }
                // A subpath that collapsed to a point ("M400 400Z") closes into
                // nothing. Drop it instead of failing the whole path: it is
                // valid SVG, it renders as nothing, and the rest of the path
                // may well describe a real shape.
                if !current_segments.is_empty() {
                    contours.push(Contour {
                        segments: current_segments,
                        closed: true,
                    });
                    current_segments = Vec::new();
                }
                current = start_point;
                // SVG starts a following non-moveto subpath at the point of
                // the just-closed subpath. Keeping the start also makes a
                // repeated closepath a valid no-op.
                subpath_start = Some(start_point);
                current_command = None;
            }
            unsupported => {
                return Err(ShapeError::UnsupportedPathCommand(unsupported));
            }
        }
    }

    // A trailing bare moveto draws nothing. A trailing drawn subpath remains
    // open for stroke geometry and is implicitly closed only for filling.
    if !current_segments.is_empty() {
        contours.push(Contour {
            segments: current_segments,
            closed: false,
        });
    }

    Ok(Region { contours })
}

/// Parses and measures one drawable open or authored-closed SVG subpath.
///
/// # Errors
///
/// Returns [`ShapeError`] when the path data is invalid, has zero or multiple
/// drawable subpaths, or exceeds the deterministic flattening limits.
pub fn measure_single_svg_path(path_data: &str) -> Result<MeasuredPath, ShapeError> {
    let mut contours = parse_path_contours(path_data)?.contours;
    if contours.is_empty() {
        return Err(ShapeError::PathMeasureZeroLength);
    }
    if contours.len() > 1 {
        return Err(ShapeError::PathMeasureMultipleSubpaths);
    }

    let contour = contours.pop().ok_or(ShapeError::PathMeasureZeroLength)?;
    let closed = contour.closed;
    let start = contour
        .segments
        .first()
        .map(CurveSegment::start)
        .ok_or(ShapeError::PathMeasureZeroLength)?;
    if !point_is_finite(start) {
        return Err(ShapeError::InvalidPathData);
    }

    let initial_capacity = contour
        .segments
        .len()
        .saturating_add(1)
        .min(PATH_MEASURE_MAX_POINTS);
    let mut points = Vec::with_capacity(initial_capacity);
    points.push(MeasuredPathPoint {
        point: start,
        cumulative_length: 0.0,
        segment_index: 0,
        segment_t: 0.0,
    });
    for (segment_index, segment) in contour.segments.iter().enumerate() {
        flatten_path_measure_segment(segment, segment_index, 0.0, 1.0, 0, &mut points)?;
    }
    if closed {
        let measured_end = points
            .last()
            .map(|point| point.point)
            .ok_or(ShapeError::PathMeasureZeroLength)?;
        if checked_point_distance(measured_end, start)? > 0.0 {
            append_measured_path_point(
                &mut points,
                start,
                contour.segments.len().saturating_sub(1),
                1.0,
            )?;
        }
    }

    let total_length = points.last().map_or(0.0, |point| point.cumulative_length);
    if total_length < PATH_MEASURE_MIN_LENGTH {
        return Err(ShapeError::PathMeasureZeroLength);
    }
    Ok(MeasuredPath {
        points,
        contour,
        total_length,
        closed,
    })
}

impl MeasuredPath {
    #[must_use]
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    #[must_use]
    pub fn total_length(&self) -> f64 {
        self.total_length
    }

    #[must_use]
    pub fn sample(
        &self,
        logical_distance: f64,
        direction: PathTraversalDirection,
    ) -> Option<PathSample> {
        if !logical_distance.is_finite()
            || logical_distance < 0.0
            || logical_distance > self.total_length
            || (self.closed && logical_distance == self.total_length)
        {
            return None;
        }

        let authored_distance = match direction {
            PathTraversalDirection::Forward => logical_distance,
            PathTraversalDirection::Reverse if self.closed && logical_distance == 0.0 => {
                self.total_length
            }
            PathTraversalDirection::Reverse => self.total_length - logical_distance,
        };
        let mut sample = self.sample_authored(authored_distance)?;
        if direction == PathTraversalDirection::Reverse {
            sample.tangent = scale_point(sample.tangent, -1.0);
        }
        Some(sample)
    }

    /// Samples the retained original curve at an unwrapped logical distance.
    /// This is intended for derived geometry; legacy glyph placement should
    /// continue to use [`Self::sample`] and its stable measured-chord bytes.
    ///
    /// # Errors
    ///
    /// Returns a path-offset geometry or complexity error when the distance
    /// cannot be sampled deterministically from the retained curve.
    pub fn sample_original_unwrapped(
        &self,
        logical_distance: f64,
        direction: PathTraversalDirection,
    ) -> Result<PathSample, ShapeError> {
        let sample = exact_measured_path_sample(self, logical_distance, direction)?;
        Ok(PathSample {
            point: sample.point,
            tangent: sample.tangent,
        })
    }

    fn sample_authored(&self, distance: f64) -> Option<PathSample> {
        let upper_index = self
            .points
            .partition_point(|point| point.cumulative_length < distance);
        let chord_end_index = upper_index.max(1);
        let chord_start = self.points.get(chord_end_index - 1)?;
        let chord_end = self.points.get(chord_end_index)?;
        let chord_length = chord_end.cumulative_length - chord_start.cumulative_length;
        let interpolation = (distance - chord_start.cumulative_length) / chord_length;
        let chord_vector = subtract_points(chord_end.point, chord_start.point);
        let tangent_length = chord_vector.x.hypot(chord_vector.y);
        Some(PathSample {
            point: lerp_point(chord_start.point, chord_end.point, interpolation),
            tangent: scale_point(chord_vector, 1.0 / tangent_length),
        })
    }
}

#[derive(Debug, Clone, Copy)]
struct ExactMeasuredPathSample {
    point: Point2D,
    tangent: Point2D,
    segment_index: usize,
}

#[derive(Debug, Clone, Copy)]
struct OffsetCenterSample {
    logical_distance: f64,
    base_point: Point2D,
    point: Point2D,
    tangent: Point2D,
    segment_index: usize,
    displacement: f64,
}

#[derive(Debug, Clone, Copy)]
enum PathIntervalSide {
    Before,
    After,
}

const PATH_OFFSET_SAGITTA_TOLERANCE: f64 = 0.01;
const PATH_OFFSET_DISPLACEMENT_TOLERANCE: f64 = 0.01;
const PATH_OFFSET_MAX_TANGENT_ANGLE_RAD: f64 = PI / 36.0;
// The two half-chords bound the full local centerline turn to five degrees.
const PATH_OFFSET_MAX_CENTERLINE_HALF_ANGLE_RAD: f64 = PI / 72.0;
const PATH_OFFSET_MAX_RECURSION_DEPTH: usize = 20;
const PATH_OFFSET_MITER_DENOMINATOR_EPSILON: f64 = 1e-6;
const PATH_OFFSET_MITER_LIMIT: f64 = 4.0;

/// Builds one deterministic filled band over an unwrapped logical interval of
/// a measured path. The caller supplies the signed normal displacement at each
/// logical distance; the helper is otherwise independent of text semantics.
///
/// The legacy [`MeasuredPath::sample`] table remains the distance oracle, but
/// geometry points are evaluated on the retained original line / quadratic /
/// cubic segment. Adaptive subdivision enforces the path, tangent, and caller
/// displacement tolerances before constructing mitered offset edges.
///
/// # Errors
///
/// Returns [`ShapeError::PathOffsetGeometry`] for non-finite input, a cusp,
/// an excessive miter, or unresolved filled topology. Returns
/// [`ShapeError::PathOffsetSampleLimit`] before exceeding the caller-owned
/// sample budget.
pub fn measured_path_offset_band<F>(
    path: &MeasuredPath,
    logical_start: f64,
    logical_end: f64,
    direction: PathTraversalDirection,
    half_width: f64,
    remaining_sample_budget: &mut usize,
    displacement: F,
) -> Result<Region, ShapeError>
where
    F: Fn(f64) -> f64,
{
    if !half_width.is_finite() || half_width <= 0.0 {
        return Err(ShapeError::PathOffsetGeometry);
    }

    let centerline = measured_path_offset_centerline(
        path,
        logical_start,
        logical_end,
        direction,
        None,
        remaining_sample_budget,
        &displacement,
    )?;
    normalized_offset_centerline_region(&centerline, half_width)
}

/// Builds deterministic filled offset-band contours whose logical spans are
/// locally bounded without resampling or resetting the caller's displacement
/// phase. Adjacent contours reuse boundary cross-sections computed from the
/// complete centerline, including authored-join miters.
///
/// The complete centerline and authored-join miters are resolved once, then
/// split into adjacent closed contours. Their nonzero fill is identical at
/// the path serializer's 0.01px precision while each contour keeps a local
/// bbox.
///
/// # Errors
///
/// Returns the same errors as [`measured_path_offset_band`], plus
/// [`ShapeError::PathOffsetGeometry`] when `target_logical_span` is not
/// finite and positive.
#[expect(
    clippy::too_many_arguments,
    reason = "path interval, traversal, chunk bound, budget, and displacement are explicit"
)]
pub fn measured_path_offset_band_chunks<F>(
    path: &MeasuredPath,
    logical_start: f64,
    logical_end: f64,
    direction: PathTraversalDirection,
    half_width: f64,
    target_logical_span: f64,
    remaining_sample_budget: &mut usize,
    displacement: F,
) -> Result<Region, ShapeError>
where
    F: Fn(f64) -> f64,
{
    if !half_width.is_finite()
        || half_width <= 0.0
        || !target_logical_span.is_finite()
        || target_logical_span <= 0.0
    {
        return Err(ShapeError::PathOffsetGeometry);
    }
    let centerline = measured_path_offset_centerline(
        path,
        logical_start,
        logical_end,
        direction,
        Some(target_logical_span * 0.25),
        remaining_sample_budget,
        &displacement,
    )?;
    let (left_boundary, right_boundary) = offset_centerline_boundaries(&centerline, half_width)?;
    let mut contours = Vec::new();
    let mut chunk_start = 0_usize;
    while chunk_start + 1 < centerline.len() {
        let chunk_limit = centerline[chunk_start].logical_distance + target_logical_span;
        let mut chunk_end = centerline
            .partition_point(|sample| sample.logical_distance <= chunk_limit)
            .saturating_sub(1)
            .max(chunk_start + 1);
        chunk_end = chunk_end.min(centerline.len() - 1);
        if let Some(authored_join_index) = (chunk_start + 1..chunk_end).find(|sample_index| {
            centerline[*sample_index].segment_index != centerline[*sample_index + 1].segment_index
        }) {
            chunk_end = authored_join_index;
        }
        let contour = quantize_offset_contour(offset_boundary_contour(
            &left_boundary,
            &right_boundary,
            chunk_start,
            chunk_end,
        )?);
        let connected_chunk = Region {
            contours: vec![contour],
        };
        if !region_has_positive_area(&connected_chunk) {
            return Err(ShapeError::PathOffsetGeometry);
        }
        match normalize_region(connected_chunk, "nonzero", GeometryTolerance::default()) {
            Ok(normalized_chunk) => contours.extend(normalized_chunk.contours),
            Err(_) => {
                for cell_start in chunk_start..chunk_end {
                    let cell_contour = quantize_offset_contour(offset_boundary_contour(
                        &left_boundary,
                        &right_boundary,
                        cell_start,
                        cell_start + 1,
                    )?);
                    let normalized_cell = normalize_region(
                        Region {
                            contours: vec![cell_contour],
                        },
                        "nonzero",
                        GeometryTolerance::default(),
                    )
                    .map_err(|_| ShapeError::PathOffsetGeometry)?;
                    if normalized_cell.contours.is_empty()
                        || !region_has_positive_area(&normalized_cell)
                    {
                        return Err(ShapeError::PathOffsetGeometry);
                    }
                    contours.extend(normalized_cell.contours);
                }
            }
        }
        chunk_start = chunk_end;
    }
    if contours.is_empty() {
        return Err(ShapeError::PathOffsetGeometry);
    }
    Ok(canonicalize_region(Region { contours }))
}

fn measured_path_offset_centerline<F>(
    path: &MeasuredPath,
    logical_start: f64,
    logical_end: f64,
    direction: PathTraversalDirection,
    maximum_knot_span: Option<f64>,
    remaining_sample_budget: &mut usize,
    displacement: &F,
) -> Result<Vec<OffsetCenterSample>, ShapeError>
where
    F: Fn(f64) -> f64,
{
    if !logical_start.is_finite()
        || !logical_end.is_finite()
        || logical_end <= logical_start
        || (!path.closed && (logical_start < 0.0 || logical_end > path.total_length))
        || (path.closed && logical_end - logical_start > path.total_length + 1e-9)
    {
        return Err(ShapeError::PathOffsetGeometry);
    }
    let mut knots = measured_path_interval_knots(path, logical_start, logical_end, direction)?;
    if let Some(maximum_knot_span) = maximum_knot_span {
        let estimated_knots = ((logical_end - logical_start) / maximum_knot_span).ceil();
        if !maximum_knot_span.is_finite()
            || maximum_knot_span <= 0.0
            || !estimated_knots.is_finite()
            || estimated_knots > *remaining_sample_budget as f64
        {
            return Err(ShapeError::PathOffsetSampleLimit);
        }
        let mut knot = logical_start + maximum_knot_span;
        while knot < logical_end {
            knots.push(knot);
            let next = knot + maximum_knot_span;
            if next <= knot {
                return Err(ShapeError::PathOffsetGeometry);
            }
            knot = next;
        }
        knots.sort_by(f64::total_cmp);
        knots.dedup_by(|left, right| left.to_bits() == right.to_bits());
    }
    let mut cached_samples = HashMap::<(u64, usize, u8), OffsetCenterSample>::new();
    let mut centerline = Vec::new();
    for knot_pair in knots.windows(2) {
        let pair_middle = (knot_pair[0] + knot_pair[1]) * 0.5;
        let pair_segment_index =
            exact_measured_path_sample(path, pair_middle, direction)?.segment_index;
        let first = offset_center_sample(
            path,
            knot_pair[0],
            pair_segment_index,
            PathIntervalSide::After,
            direction,
            displacement,
            remaining_sample_budget,
            &mut cached_samples,
        )?;
        if centerline.is_empty() {
            centerline.push(first);
        }
        append_adaptive_offset_samples(
            path,
            knot_pair[0],
            knot_pair[1],
            direction,
            displacement,
            0,
            remaining_sample_budget,
            &mut cached_samples,
            &mut centerline,
        )?;
    }
    centerline.dedup_by(|left, right| {
        left.logical_distance.to_bits() == right.logical_distance.to_bits()
    });
    if centerline.len() < 2 {
        return Err(ShapeError::PathOffsetGeometry);
    }
    miter_offset_centerline_at_authored_joins(&mut centerline)?;
    Ok(centerline)
}

fn normalized_offset_centerline_region(
    centerline: &[OffsetCenterSample],
    half_width: f64,
) -> Result<Region, ShapeError> {
    let contour = offset_centerline_contour(centerline, half_width)?;
    let normalized = normalize_region(
        Region {
            contours: vec![contour],
        },
        "nonzero",
        GeometryTolerance::default(),
    )
    .map_err(|_| ShapeError::PathOffsetGeometry)?;
    if normalized.contours.is_empty() || !region_has_positive_area(&normalized) {
        return Err(ShapeError::PathOffsetGeometry);
    }
    Ok(canonicalize_region(normalized))
}

/// Projects the boundary of a positive-area region to the nearest branch of
/// one caller-limited unwrapped path interval.
///
/// Ties are resolved by world distance, distance from `preferred_distance`,
/// then measured segment order. Candidate pairs share the caller's remaining
/// budget with surrounding boolean operations.
///
/// # Errors
///
/// Returns [`ShapeError::BooleanPairLimit`] before visiting a candidate pair
/// beyond the supplied budget and [`ShapeError::PathOffsetGeometry`] when the
/// interval cannot be sampled deterministically.
pub fn project_region_to_measured_path_interval(
    region: &Region,
    path: &MeasuredPath,
    logical_start: f64,
    logical_end: f64,
    preferred_distance: f64,
    direction: PathTraversalDirection,
    remaining_pair_budget: &mut usize,
) -> Result<Option<(f64, f64)>, ShapeError> {
    if !preferred_distance.is_finite() {
        return Err(ShapeError::PathOffsetGeometry);
    }
    let tolerance = GeometryTolerance::default();
    let mut boundary_points = Vec::new();
    for contour in &region.contours {
        boundary_points.extend(flatten_contour(contour, tolerance));
    }
    project_boundary_points_to_measured_path_interval(
        &boundary_points,
        path,
        logical_start,
        logical_end,
        preferred_distance,
        direction,
        remaining_pair_budget,
    )
}

/// Projects classified positive-area intersection edges to the nearest branch
/// of one caller-limited unwrapped path interval without reconstructing the
/// intersection contours.
///
/// This is the deterministic fallback for consumers that need path-distance
/// occupancy when the boolean edge set is valid but contour tracing is
/// topologically ambiguous.
///
/// # Errors
///
/// Returns [`ShapeError::BooleanPairLimit`] before exceeding the shared
/// candidate-pair budget and [`ShapeError::PathOffsetGeometry`] for invalid
/// path-distance inputs.
#[expect(
    clippy::too_many_arguments,
    reason = "intersection regions, projection interval, traversal, and shared budget are explicit"
)]
pub fn project_region_intersection_to_measured_path_interval(
    lhs: &Region,
    rhs: &Region,
    path: &MeasuredPath,
    logical_start: f64,
    logical_end: f64,
    preferred_distance: f64,
    direction: PathTraversalDirection,
    remaining_pair_budget: &mut usize,
) -> Result<Option<(f64, f64)>, ShapeError> {
    if !preferred_distance.is_finite() {
        return Err(ShapeError::PathOffsetGeometry);
    }
    let tolerance = GeometryTolerance::default();
    let edges = collect_boolean_result_edges(
        lhs,
        rhs,
        BooleanOp::Intersect,
        Some(remaining_pair_budget),
        tolerance,
    )?;
    let mut boundary_points = Vec::with_capacity(edges.len().saturating_mul(2));
    for edge in edges {
        boundary_points.push(edge.segment.start());
        boundary_points.push(edge.segment.end());
    }
    project_boundary_points_to_measured_path_interval(
        &boundary_points,
        path,
        logical_start,
        logical_end,
        preferred_distance,
        direction,
        remaining_pair_budget,
    )
}

fn project_boundary_points_to_measured_path_interval(
    boundary_points: &[Point2D],
    path: &MeasuredPath,
    logical_start: f64,
    logical_end: f64,
    preferred_distance: f64,
    direction: PathTraversalDirection,
    remaining_pair_budget: &mut usize,
) -> Result<Option<(f64, f64)>, ShapeError> {
    if boundary_points.is_empty() {
        return Ok(None);
    }
    let knots = measured_path_interval_knots(path, logical_start, logical_end, direction)?;
    if knots.len() < 2 {
        return Ok(None);
    }
    let path_samples = knots
        .iter()
        .map(|logical_distance| {
            exact_measured_path_sample(path, *logical_distance, direction)
                .map(|sample| (*logical_distance, sample.point, sample.segment_index))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let pair_count = boundary_points
        .len()
        .checked_mul(path_samples.len().saturating_sub(1))
        .ok_or(ShapeError::BooleanPairLimit)?;
    if pair_count > *remaining_pair_budget {
        return Err(ShapeError::BooleanPairLimit);
    }
    *remaining_pair_budget -= pair_count;

    let mut projected_min = f64::INFINITY;
    let mut projected_max = f64::NEG_INFINITY;
    for boundary_point in boundary_points {
        let mut best: Option<(f64, f64, usize, f64)> = None;
        for pair in path_samples.windows(2) {
            let (q0, p0, first_segment_index) = pair[0];
            let (q1, p1, second_segment_index) = pair[1];
            let segment = subtract_points(p1, p0);
            let length_squared = dot(segment, segment);
            if !length_squared.is_finite() || length_squared <= f64::EPSILON {
                continue;
            }
            let to_point = subtract_points(*boundary_point, p0);
            let parameter = (dot(to_point, segment) / length_squared).clamp(0.0, 1.0);
            let projected_point = Point2D {
                x: p0.x + segment.x * parameter,
                y: p0.y + segment.y * parameter,
            };
            let delta = subtract_points(*boundary_point, projected_point);
            let world_distance_squared = dot(delta, delta);
            let logical_distance = q0 + (q1 - q0) * parameter;
            let preferred_delta = (logical_distance - preferred_distance).abs();
            let segment_index = first_segment_index.min(second_segment_index);
            let candidate = (
                world_distance_squared,
                preferred_delta,
                segment_index,
                logical_distance,
            );
            if best.is_none_or(|current| {
                candidate.0.total_cmp(&current.0) == Ordering::Less
                    || (candidate.0.to_bits() == current.0.to_bits()
                        && (candidate.1.total_cmp(&current.1) == Ordering::Less
                            || (candidate.1.to_bits() == current.1.to_bits()
                                && candidate.2 < current.2)))
            }) {
                best = Some(candidate);
            }
        }
        if let Some((_, _, _, logical_distance)) = best {
            projected_min = projected_min.min(logical_distance);
            projected_max = projected_max.max(logical_distance);
        }
    }
    if projected_min.is_finite() && projected_max.is_finite() {
        Ok(Some((projected_min, projected_max)))
    } else {
        Ok(None)
    }
}

fn measured_path_interval_knots(
    path: &MeasuredPath,
    logical_start: f64,
    logical_end: f64,
    direction: PathTraversalDirection,
) -> Result<Vec<f64>, ShapeError> {
    if !logical_start.is_finite()
        || !logical_end.is_finite()
        || logical_end <= logical_start
        || (!path.closed && (logical_start < 0.0 || logical_end > path.total_length))
        || (path.closed && logical_end - logical_start > path.total_length + 1e-9)
    {
        return Err(ShapeError::PathOffsetGeometry);
    }
    let mut knots = vec![logical_start, logical_end];
    for point in &path.points {
        let base_distance = match direction {
            PathTraversalDirection::Forward => point.cumulative_length,
            PathTraversalDirection::Reverse => path.total_length - point.cumulative_length,
        };
        if path.closed {
            let cycle = ((logical_start - base_distance) / path.total_length).ceil();
            let lifted = base_distance + cycle * path.total_length;
            for candidate in [lifted, lifted + path.total_length] {
                if candidate > logical_start && candidate < logical_end {
                    knots.push(candidate);
                }
            }
        } else if base_distance > logical_start && base_distance < logical_end {
            knots.push(base_distance);
        }
    }
    knots.sort_by(f64::total_cmp);
    knots.dedup_by(|left, right| left.to_bits() == right.to_bits());
    Ok(knots)
}

fn exact_measured_path_sample(
    path: &MeasuredPath,
    logical_distance: f64,
    direction: PathTraversalDirection,
) -> Result<ExactMeasuredPathSample, ShapeError> {
    if !logical_distance.is_finite() {
        return Err(ShapeError::PathOffsetGeometry);
    }
    let physical_distance = if path.closed {
        logical_distance.rem_euclid(path.total_length)
    } else if logical_distance >= 0.0 && logical_distance <= path.total_length {
        logical_distance
    } else {
        return Err(ShapeError::PathOffsetGeometry);
    };
    let authored_distance = match direction {
        PathTraversalDirection::Forward => physical_distance,
        PathTraversalDirection::Reverse if physical_distance == 0.0 && logical_distance != 0.0 => {
            path.total_length
        }
        PathTraversalDirection::Reverse => path.total_length - physical_distance,
    };
    let upper_index = path
        .points
        .partition_point(|point| point.cumulative_length < authored_distance)
        .max(1)
        .min(path.points.len().saturating_sub(1));
    let lower = path
        .points
        .get(upper_index.saturating_sub(1))
        .ok_or(ShapeError::PathOffsetGeometry)?;
    let upper = path
        .points
        .get(upper_index)
        .ok_or(ShapeError::PathOffsetGeometry)?;
    let chord_length = upper.cumulative_length - lower.cumulative_length;
    if !chord_length.is_finite() || chord_length <= 0.0 {
        return Err(ShapeError::PathOffsetGeometry);
    }
    let interpolation =
        ((authored_distance - lower.cumulative_length) / chord_length).clamp(0.0, 1.0);
    let segment_index = upper.segment_index;
    let segment = path
        .contour
        .segments
        .get(segment_index)
        .ok_or(ShapeError::PathOffsetGeometry)?;
    let lower_t = if lower.segment_index == segment_index {
        lower.segment_t
    } else {
        0.0
    };
    let segment_t = lower_t + (upper.segment_t - lower_t) * interpolation;
    let point = segment.eval(segment_t);
    let mut tangent = curve_segment_tangent(segment, segment_t)?;
    if direction == PathTraversalDirection::Reverse {
        tangent = scale_point(tangent, -1.0);
    }
    if !point_is_finite(point) || !point_is_finite(tangent) {
        return Err(ShapeError::PathOffsetGeometry);
    }
    Ok(ExactMeasuredPathSample {
        point,
        tangent,
        segment_index,
    })
}

fn exact_measured_path_sample_on_segment(
    path: &MeasuredPath,
    logical_distance: f64,
    direction: PathTraversalDirection,
    segment_index: usize,
    side: PathIntervalSide,
) -> Result<ExactMeasuredPathSample, ShapeError> {
    let physical_distance = if path.closed {
        logical_distance.rem_euclid(path.total_length)
    } else if logical_distance >= 0.0 && logical_distance <= path.total_length {
        logical_distance
    } else {
        return Err(ShapeError::PathOffsetGeometry);
    };
    let authored_distance = if path.closed && physical_distance == 0.0 {
        match (direction, side) {
            (PathTraversalDirection::Forward, PathIntervalSide::Before)
            | (PathTraversalDirection::Reverse, PathIntervalSide::After) => path.total_length,
            (PathTraversalDirection::Forward, PathIntervalSide::After)
            | (PathTraversalDirection::Reverse, PathIntervalSide::Before) => 0.0,
        }
    } else {
        match direction {
            PathTraversalDirection::Forward => physical_distance,
            PathTraversalDirection::Reverse => path.total_length - physical_distance,
        }
    };
    let (lower, upper) = path
        .points
        .windows(2)
        .find_map(|pair| {
            let lower = &pair[0];
            let upper = &pair[1];
            (upper.segment_index == segment_index
                && authored_distance >= lower.cumulative_length
                && authored_distance <= upper.cumulative_length)
                .then_some((lower, upper))
        })
        .ok_or(ShapeError::PathOffsetGeometry)?;
    let chord_length = upper.cumulative_length - lower.cumulative_length;
    if !chord_length.is_finite() || chord_length <= 0.0 {
        return Err(ShapeError::PathOffsetGeometry);
    }
    let interpolation =
        ((authored_distance - lower.cumulative_length) / chord_length).clamp(0.0, 1.0);
    let segment = path
        .contour
        .segments
        .get(segment_index)
        .ok_or(ShapeError::PathOffsetGeometry)?;
    let lower_t = if lower.segment_index == segment_index {
        lower.segment_t
    } else {
        0.0
    };
    let segment_t = lower_t + (upper.segment_t - lower_t) * interpolation;
    let point = segment.eval(segment_t);
    let mut tangent = curve_segment_tangent(segment, segment_t)?;
    if direction == PathTraversalDirection::Reverse {
        tangent = scale_point(tangent, -1.0);
    }
    if !point_is_finite(point) || !point_is_finite(tangent) {
        return Err(ShapeError::PathOffsetGeometry);
    }
    Ok(ExactMeasuredPathSample {
        point,
        tangent,
        segment_index,
    })
}

fn curve_segment_tangent(segment: &CurveSegment, t: f64) -> Result<Point2D, ShapeError> {
    let derivative = match segment {
        CurveSegment::Line { p0, p1 } => subtract_points(*p1, *p0),
        CurveSegment::Quad { p0, p1, p2 } => {
            let first = scale_point(subtract_points(*p1, *p0), 2.0 * (1.0 - t));
            let second = scale_point(subtract_points(*p2, *p1), 2.0 * t);
            Point2D {
                x: first.x + second.x,
                y: first.y + second.y,
            }
        }
        CurveSegment::Cubic { p0, p1, p2, p3 } => {
            let first = scale_point(subtract_points(*p1, *p0), 3.0 * (1.0 - t).powi(2));
            let second = scale_point(subtract_points(*p2, *p1), 6.0 * (1.0 - t) * t);
            let third = scale_point(subtract_points(*p3, *p2), 3.0 * t.powi(2));
            Point2D {
                x: first.x + second.x + third.x,
                y: first.y + second.y + third.y,
            }
        }
    };
    let length = derivative.x.hypot(derivative.y);
    if !length.is_finite() || length <= f64::EPSILON {
        return Err(ShapeError::PathOffsetGeometry);
    }
    Ok(scale_point(derivative, 1.0 / length))
}

#[expect(
    clippy::too_many_arguments,
    reason = "path sample identity, traversal, displacement, cache, and caller budget are explicit"
)]
fn offset_center_sample<F>(
    path: &MeasuredPath,
    logical_distance: f64,
    segment_index: usize,
    side: PathIntervalSide,
    direction: PathTraversalDirection,
    displacement: &F,
    remaining_sample_budget: &mut usize,
    cached_samples: &mut HashMap<(u64, usize, u8), OffsetCenterSample>,
) -> Result<OffsetCenterSample, ShapeError>
where
    F: Fn(f64) -> f64,
{
    let side_key = if path.closed && logical_distance.rem_euclid(path.total_length) == 0.0 {
        match side {
            PathIntervalSide::Before => 1,
            PathIntervalSide::After => 2,
        }
    } else {
        0
    };
    let cache_key = (logical_distance.to_bits(), segment_index, side_key);
    if let Some(sample) = cached_samples.get(&cache_key) {
        return Ok(*sample);
    }
    if *remaining_sample_budget == 0 {
        return Err(ShapeError::PathOffsetSampleLimit);
    }
    let base = exact_measured_path_sample_on_segment(
        path,
        logical_distance,
        direction,
        segment_index,
        side,
    )?;
    let offset = displacement(logical_distance);
    if !offset.is_finite() {
        return Err(ShapeError::PathOffsetGeometry);
    }
    let normal = Point2D {
        x: -base.tangent.y,
        y: base.tangent.x,
    };
    let point = Point2D {
        x: base.point.x + normal.x * offset,
        y: base.point.y + normal.y * offset,
    };
    if !point_is_finite(point) {
        return Err(ShapeError::PathOffsetGeometry);
    }
    *remaining_sample_budget -= 1;
    let sample = OffsetCenterSample {
        logical_distance,
        base_point: base.point,
        point,
        tangent: base.tangent,
        segment_index: base.segment_index,
        displacement: offset,
    };
    cached_samples.insert(cache_key, sample);
    Ok(sample)
}

fn miter_offset_centerline_at_authored_joins(
    centerline: &mut [OffsetCenterSample],
) -> Result<(), ShapeError> {
    if centerline.len() < 3 {
        return Ok(());
    }
    for index in 1..centerline.len() - 1 {
        let previous = centerline[index - 1];
        let current = centerline[index];
        let next = centerline[index + 1];
        if previous.segment_index == next.segment_index {
            continue;
        }
        let incoming = normalize_point(subtract_points(current.base_point, previous.base_point))
            .ok_or(ShapeError::PathOffsetGeometry)?;
        let outgoing = normalize_point(subtract_points(next.base_point, current.base_point))
            .ok_or(ShapeError::PathOffsetGeometry)?;
        let incoming_normal = Point2D {
            x: -incoming.y,
            y: incoming.x,
        };
        let outgoing_normal = Point2D {
            x: -outgoing.y,
            y: outgoing.x,
        };
        let normal_sum = Point2D {
            x: incoming_normal.x + outgoing_normal.x,
            y: incoming_normal.y + outgoing_normal.y,
        };
        let normal_length = normal_sum.x.hypot(normal_sum.y);
        if !normal_length.is_finite() || normal_length <= PATH_OFFSET_MITER_DENOMINATOR_EPSILON {
            return Err(ShapeError::PathOffsetGeometry);
        }
        let miter = scale_point(normal_sum, 1.0 / normal_length);
        let denominator = dot(miter, outgoing_normal).abs();
        if denominator < PATH_OFFSET_MITER_DENOMINATOR_EPSILON {
            return Err(ShapeError::PathOffsetGeometry);
        }
        let miter_scale = current.displacement / denominator;
        let point = Point2D {
            x: current.base_point.x + miter.x * miter_scale,
            y: current.base_point.y + miter.y * miter_scale,
        };
        if !point_is_finite(point) {
            return Err(ShapeError::PathOffsetGeometry);
        }
        centerline[index].point = point;
    }
    Ok(())
}

#[expect(
    clippy::too_many_arguments,
    reason = "adaptive geometry state is explicit"
)]
fn append_adaptive_offset_samples<F>(
    path: &MeasuredPath,
    logical_start: f64,
    logical_end: f64,
    direction: PathTraversalDirection,
    displacement: &F,
    depth: usize,
    remaining_sample_budget: &mut usize,
    cached_samples: &mut HashMap<(u64, usize, u8), OffsetCenterSample>,
    output: &mut Vec<OffsetCenterSample>,
) -> Result<(), ShapeError>
where
    F: Fn(f64) -> f64,
{
    let logical_middle = (logical_start + logical_end) * 0.5;
    if logical_middle <= logical_start || logical_middle >= logical_end {
        return Err(ShapeError::PathOffsetGeometry);
    }
    let segment_index = exact_measured_path_sample(path, logical_middle, direction)?.segment_index;
    let start = offset_center_sample(
        path,
        logical_start,
        segment_index,
        PathIntervalSide::After,
        direction,
        displacement,
        remaining_sample_budget,
        cached_samples,
    )?;
    let end = offset_center_sample(
        path,
        logical_end,
        segment_index,
        PathIntervalSide::Before,
        direction,
        displacement,
        remaining_sample_budget,
        cached_samples,
    )?;
    let middle = offset_center_sample(
        path,
        logical_middle,
        segment_index,
        PathIntervalSide::After,
        direction,
        displacement,
        remaining_sample_budget,
        cached_samples,
    )?;
    let chord_middle = lerp_point(start.point, end.point, 0.5);
    let sagitta = checked_point_distance(middle.point, chord_middle)?;
    let tangent_dot = dot(start.tangent, end.tangent).clamp(-1.0, 1.0);
    let tangent_angle = tangent_dot.acos();
    let left_center_direction = normalize_point(subtract_points(middle.point, start.point))
        .ok_or(ShapeError::PathOffsetGeometry)?;
    let right_center_direction = normalize_point(subtract_points(end.point, middle.point))
        .ok_or(ShapeError::PathOffsetGeometry)?;
    let centerline_tangent_angle = dot(left_center_direction, right_center_direction)
        .clamp(-1.0, 1.0)
        .acos();
    let start_base = exact_measured_path_sample(path, logical_start, direction)?;
    let end_base = exact_measured_path_sample(path, logical_end, direction)?;
    let displacement_error = {
        let start_offset = displacement(logical_start);
        let end_offset = displacement(logical_end);
        let middle_offset = displacement(logical_middle);
        (middle_offset - (start_offset + end_offset) * 0.5).abs()
    };
    let tangent_within_tolerance = start_base.segment_index != end_base.segment_index
        || tangent_angle <= PATH_OFFSET_MAX_TANGENT_ANGLE_RAD;
    if sagitta <= PATH_OFFSET_SAGITTA_TOLERANCE
        && displacement_error <= PATH_OFFSET_DISPLACEMENT_TOLERANCE
        && tangent_within_tolerance
        && centerline_tangent_angle <= PATH_OFFSET_MAX_CENTERLINE_HALF_ANGLE_RAD
    {
        output.push(end);
        return Ok(());
    }
    if depth >= PATH_OFFSET_MAX_RECURSION_DEPTH {
        return Err(ShapeError::PathOffsetGeometry);
    }
    append_adaptive_offset_samples(
        path,
        logical_start,
        logical_middle,
        direction,
        displacement,
        depth + 1,
        remaining_sample_budget,
        cached_samples,
        output,
    )?;
    append_adaptive_offset_samples(
        path,
        logical_middle,
        logical_end,
        direction,
        displacement,
        depth + 1,
        remaining_sample_budget,
        cached_samples,
        output,
    )
}

fn offset_centerline_contour(
    centerline: &[OffsetCenterSample],
    half_width: f64,
) -> Result<Contour, ShapeError> {
    let (left, right) = offset_centerline_boundaries(centerline, half_width)?;
    offset_boundary_contour(&left, &right, 0, centerline.len() - 1)
}

fn offset_centerline_boundaries(
    centerline: &[OffsetCenterSample],
    half_width: f64,
) -> Result<(Vec<Point2D>, Vec<Point2D>), ShapeError> {
    let directions = centerline
        .windows(2)
        .map(|pair| {
            let delta = subtract_points(pair[1].point, pair[0].point);
            let length = delta.x.hypot(delta.y);
            if !length.is_finite() || length <= f64::EPSILON {
                return Err(ShapeError::PathOffsetGeometry);
            }
            Ok(scale_point(delta, 1.0 / length))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut left = Vec::with_capacity(centerline.len());
    let mut right = Vec::with_capacity(centerline.len());
    for (index, sample) in centerline.iter().enumerate() {
        let (normal, miter_scale) = if index == 0 {
            let direction = directions[0];
            (
                Point2D {
                    x: -direction.y,
                    y: direction.x,
                },
                half_width,
            )
        } else if index + 1 == centerline.len() {
            let direction = directions[directions.len() - 1];
            (
                Point2D {
                    x: -direction.y,
                    y: direction.x,
                },
                half_width,
            )
        } else {
            let previous = directions[index - 1];
            let next = directions[index];
            let previous_normal = Point2D {
                x: -previous.y,
                y: previous.x,
            };
            let next_normal = Point2D {
                x: -next.y,
                y: next.x,
            };
            let normal_sum = Point2D {
                x: previous_normal.x + next_normal.x,
                y: previous_normal.y + next_normal.y,
            };
            let normal_length = normal_sum.x.hypot(normal_sum.y);
            if !normal_length.is_finite() || normal_length <= PATH_OFFSET_MITER_DENOMINATOR_EPSILON
            {
                return Err(ShapeError::PathOffsetGeometry);
            }
            let miter = scale_point(normal_sum, 1.0 / normal_length);
            let denominator = dot(miter, next_normal).abs();
            if denominator < PATH_OFFSET_MITER_DENOMINATOR_EPSILON {
                return Err(ShapeError::PathOffsetGeometry);
            }
            let scale = half_width / denominator;
            if !scale.is_finite() || scale > half_width * PATH_OFFSET_MITER_LIMIT {
                return Err(ShapeError::PathOffsetGeometry);
            }
            (miter, scale)
        };
        left.push(Point2D {
            x: sample.point.x + normal.x * miter_scale,
            y: sample.point.y + normal.y * miter_scale,
        });
        right.push(Point2D {
            x: sample.point.x - normal.x * miter_scale,
            y: sample.point.y - normal.y * miter_scale,
        });
    }
    if left
        .iter()
        .chain(&right)
        .any(|point| !point_is_finite(*point))
    {
        return Err(ShapeError::PathOffsetGeometry);
    }
    Ok((left, right))
}

fn offset_boundary_contour(
    left: &[Point2D],
    right: &[Point2D],
    start_index: usize,
    end_index: usize,
) -> Result<Contour, ShapeError> {
    if start_index >= end_index || end_index >= left.len() || left.len() != right.len() {
        return Err(ShapeError::PathOffsetGeometry);
    }
    let mut polygon = left[start_index..=end_index].to_vec();
    polygon.extend(right[start_index..=end_index].iter().rev().copied());
    let first = *polygon.first().ok_or(ShapeError::PathOffsetGeometry)?;
    polygon.push(first);
    let segments = polygon
        .windows(2)
        .filter(|pair| !points_close(pair[0], pair[1], f64::EPSILON))
        .map(|pair| CurveSegment::Line {
            p0: pair[0],
            p1: pair[1],
        })
        .collect::<Vec<_>>();
    if segments.len() < 3 {
        return Err(ShapeError::PathOffsetGeometry);
    }
    Ok(Contour {
        segments,
        closed: true,
    })
}

fn quantize_offset_contour(contour: Contour) -> Contour {
    // region_to_path serializes at 0.01px. Resolve topology on that same
    // lattice so a valid chunk cannot become self-intersecting when reparsed.
    let quantize_point = |point: Point2D| Point2D {
        x: (point.x * 100.0).round() / 100.0,
        y: (point.y * 100.0).round() / 100.0,
    };
    Contour {
        segments: contour
            .segments
            .into_iter()
            .map(|segment| match segment {
                CurveSegment::Line { p0, p1 } => CurveSegment::Line {
                    p0: quantize_point(p0),
                    p1: quantize_point(p1),
                },
                CurveSegment::Quad { p0, p1, p2 } => CurveSegment::Quad {
                    p0: quantize_point(p0),
                    p1: quantize_point(p1),
                    p2: quantize_point(p2),
                },
                CurveSegment::Cubic { p0, p1, p2, p3 } => CurveSegment::Cubic {
                    p0: quantize_point(p0),
                    p1: quantize_point(p1),
                    p2: quantize_point(p2),
                    p3: quantize_point(p3),
                },
            })
            .collect(),
        closed: contour.closed,
    }
}

fn flatten_path_measure_segment(
    segment: &CurveSegment,
    segment_index: usize,
    t_start: f64,
    t_end: f64,
    depth: usize,
    points: &mut Vec<MeasuredPathPoint>,
) -> Result<(), ShapeError> {
    match segment {
        CurveSegment::Line { p1, .. } => {
            append_measured_path_point(points, *p1, segment_index, t_end)
        }
        CurveSegment::Quad { p0, p1, p2 } => {
            let control_polygon_length = checked_path_measure_length(&[*p0, *p1, *p2])?;
            let chord_length = checked_point_distance(*p0, *p2)?;
            flatten_path_measure_curve(
                segment,
                *p2,
                control_polygon_length,
                chord_length,
                segment_index,
                t_start,
                t_end,
                depth,
                points,
            )
        }
        CurveSegment::Cubic { p0, p1, p2, p3 } => {
            let control_polygon_length = checked_path_measure_length(&[*p0, *p1, *p2, *p3])?;
            let chord_length = checked_point_distance(*p0, *p3)?;
            flatten_path_measure_curve(
                segment,
                *p3,
                control_polygon_length,
                chord_length,
                segment_index,
                t_start,
                t_end,
                depth,
                points,
            )
        }
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "adaptive curve interval and accumulated measurement state are explicit"
)]
fn flatten_path_measure_curve(
    segment: &CurveSegment,
    end: Point2D,
    control_polygon_length: f64,
    chord_length: f64,
    segment_index: usize,
    t_start: f64,
    t_end: f64,
    depth: usize,
    points: &mut Vec<MeasuredPathPoint>,
) -> Result<(), ShapeError> {
    if control_polygon_length - chord_length <= PATH_MEASURE_FLATNESS_TOLERANCE {
        return append_measured_path_point(points, end, segment_index, t_end);
    }
    if depth >= PATH_MEASURE_MAX_RECURSION_DEPTH {
        return Err(ShapeError::PathMeasureComplexityLimit);
    }

    let (left, right) = segment.split(0.5);
    let t_middle = (t_start + t_end) * 0.5;
    flatten_path_measure_segment(&left, segment_index, t_start, t_middle, depth + 1, points)?;
    flatten_path_measure_segment(&right, segment_index, t_middle, t_end, depth + 1, points)
}

fn append_measured_path_point(
    points: &mut Vec<MeasuredPathPoint>,
    point: Point2D,
    segment_index: usize,
    segment_t: f64,
) -> Result<(), ShapeError> {
    let previous = points.last().ok_or(ShapeError::InvalidPathData)?;
    let chord_length = checked_point_distance(previous.point, point)?;
    if chord_length == 0.0 {
        return Ok(());
    }
    if points.len() >= PATH_MEASURE_MAX_POINTS {
        return Err(ShapeError::PathMeasureComplexityLimit);
    }
    let cumulative_length = previous.cumulative_length + chord_length;
    if !cumulative_length.is_finite() || cumulative_length <= previous.cumulative_length {
        return Err(ShapeError::InvalidPathData);
    }
    points.push(MeasuredPathPoint {
        point,
        cumulative_length,
        segment_index,
        segment_t,
    });
    Ok(())
}

fn checked_path_measure_length(points: &[Point2D]) -> Result<f64, ShapeError> {
    let mut length = 0.0;
    for point_pair in points.windows(2) {
        length += checked_point_distance(point_pair[0], point_pair[1])?;
        if !length.is_finite() {
            return Err(ShapeError::InvalidPathData);
        }
    }
    Ok(length)
}

fn checked_point_distance(left: Point2D, right: Point2D) -> Result<f64, ShapeError> {
    if !point_is_finite(left) || !point_is_finite(right) {
        return Err(ShapeError::InvalidPathData);
    }
    let delta_x = right.x - left.x;
    let delta_y = right.y - left.y;
    let distance = delta_x.hypot(delta_y);
    if !distance.is_finite() {
        return Err(ShapeError::InvalidPathData);
    }
    Ok(distance)
}

fn point_is_finite(point: Point2D) -> bool {
    point.x.is_finite() && point.y.is_finite()
}

/// Evaluate the geometry a stroke should follow.
///
/// Leaf paths, groups and transforms stroke what the author drew. A boolean
/// strokes its result: its children fuse into one part, so stroking them
/// individually would draw the seams the operation just removed. Author both
/// outlines separately with a `Group` if you want both stroked. Boolean
/// operands use the same compile-level default fill rule as the fill region.
fn evaluate_stroke_geometry(
    node: &GeometryNode,
    default_fill_rule: Option<&str>,
) -> Result<Region, ShapeError> {
    match node {
        GeometryNode::Path { d, .. } => parse_path_contours(d),
        GeometryNode::Group { children, .. } => {
            let mut contours = Vec::new();
            for child in children {
                contours.extend(evaluate_stroke_geometry(child, default_fill_rule)?.contours);
            }
            Ok(Region { contours })
        }
        GeometryNode::Transform {
            transform, child, ..
        } => {
            let region = evaluate_stroke_geometry(child, default_fill_rule)?;
            Ok(transform_region(&region, transform_to_matrix(transform)))
        }
        GeometryNode::Boolean { .. } => {
            evaluate_geometry_node_with_default_fill_rule(node, default_fill_rule)
        }
    }
}

fn normalize_region(
    region: Region,
    fill_rule: &str,
    tolerance: GeometryTolerance,
) -> Result<Region, ShapeError> {
    normalize_region_with_depth(region, fill_rule, tolerance, 0)
}

fn normalize_region_with_depth(
    mut region: Region,
    fill_rule: &str,
    tolerance: GeometryTolerance,
    topology_depth: usize,
) -> Result<Region, ShapeError> {
    if topology_depth > MAX_TOPOLOGY_RECURSION {
        return Err(ShapeError::BooleanTopology);
    }

    let mut normalized_contours = Vec::new();
    for contour in &region.contours {
        normalized_contours.extend(resolve_contour_topology(
            contour,
            fill_rule,
            tolerance,
            topology_depth + 1,
        )?);
    }
    region.contours = normalized_contours;

    let contour_count = region.contours.len();
    let mut flattened = Vec::with_capacity(contour_count);
    let mut orientation = Vec::with_capacity(contour_count);

    for contour in &region.contours {
        let polyline = flatten_contour(contour, tolerance);
        let signed_area = signed_area(&polyline);
        let is_ccw = signed_area > 0.0;
        flattened.push(polyline);
        orientation.push(is_ccw);
    }

    for contour_index in 0..contour_count {
        let (left_filled, right_filled) = probe_contour_fill_sides(
            &region.contours[contour_index],
            &flattened,
            &orientation,
            fill_rule,
            tolerance,
        );
        let should_reverse = (left_filled && !right_filled && !orientation[contour_index])
            || (!left_filled && right_filled && orientation[contour_index]);
        if should_reverse {
            region.contours[contour_index] = reverse_contour(&region.contours[contour_index]);
        }
    }

    Ok(region)
}

fn resolve_contour_topology(
    contour: &Contour,
    fill_rule: &str,
    tolerance: GeometryTolerance,
    topology_depth: usize,
) -> Result<Vec<Contour>, ShapeError> {
    if !contour_has_self_intersections(contour, tolerance) {
        return Ok(vec![contour.clone()]);
    }
    trace_self_intersecting_contour(contour, fill_rule, tolerance, topology_depth)
}

fn contour_has_self_intersections(contour: &Contour, tolerance: GeometryTolerance) -> bool {
    let polyline = flatten_contour(contour, tolerance);
    if polyline.len() < 4 {
        return true;
    }
    let segment_count = polyline.len().saturating_sub(1);
    if !should_use_bbox_index(segment_count, segment_count) {
        return polyline_has_self_intersections_linear(&polyline, tolerance);
    }
    let segment_bboxes = polyline
        .windows(2)
        .map(BBox::from_points)
        .collect::<Vec<_>>();
    let bbox_index = BBoxIndex::new(&segment_bboxes);
    let mut candidates = Vec::new();
    for first_index in 0..segment_count {
        let first_start = polyline[first_index];
        let first_end = polyline[first_index + 1];
        // A proper line crossing requires exact bbox overlap. The position
        // epsilon is therefore conservative here and matches the strict
        // orientation predicate below; no larger curve-bbox reject applies.
        bbox_index.query_into(
            segment_bboxes[first_index],
            tolerance.position_epsilon,
            &mut candidates,
        );
        #[cfg(test)]
        CONTOUR_SELF_INTERSECTION_CANDIDATE_COUNT.with(|candidate_count| {
            candidate_count.set(candidate_count.get().saturating_add(candidates.len()));
        });
        for &second_index in &candidates {
            if second_index <= first_index {
                continue;
            }
            if contour_segment_pair_is_adjacent(first_index, second_index, segment_count) {
                continue;
            }
            let second_start = polyline[second_index];
            let second_end = polyline[second_index + 1];
            if segments_intersect_strict(
                first_start,
                first_end,
                second_start,
                second_end,
                tolerance.position_epsilon,
            ) {
                return true;
            }
        }
    }
    false
}

fn polyline_has_self_intersections_linear(
    polyline: &[Point2D],
    tolerance: GeometryTolerance,
) -> bool {
    let segment_count = polyline.len().saturating_sub(1);
    for first_index in 0..segment_count {
        for second_index in (first_index + 1)..segment_count {
            if contour_segment_pair_is_adjacent(first_index, second_index, segment_count) {
                continue;
            }
            if segments_intersect_strict(
                polyline[first_index],
                polyline[first_index + 1],
                polyline[second_index],
                polyline[second_index + 1],
                tolerance.position_epsilon,
            ) {
                return true;
            }
        }
    }
    false
}

const fn contour_segment_pair_is_adjacent(
    first_index: usize,
    second_index: usize,
    segment_count: usize,
) -> bool {
    second_index == first_index + 1 || (first_index == 0 && second_index + 1 == segment_count)
}

fn self_intersection_split_parameters(
    indexed_segments: &[IndexedSegment],
    tolerance: GeometryTolerance,
) -> Vec<Vec<f64>> {
    let mut split_parameters = vec![vec![0.0, 1.0]; indexed_segments.len()];
    if !should_use_bbox_index(indexed_segments.len(), indexed_segments.len()) {
        for first_index in 0..indexed_segments.len() {
            for second_index in (first_index + 1)..indexed_segments.len() {
                if contour_segment_pair_is_adjacent(
                    first_index,
                    second_index,
                    indexed_segments.len(),
                ) {
                    continue;
                }
                append_self_intersection_parameters(
                    indexed_segments,
                    &mut split_parameters,
                    first_index,
                    second_index,
                    tolerance,
                );
            }
        }
        return split_parameters;
    }

    let segment_bboxes = indexed_segments
        .iter()
        .map(|indexed_segment| indexed_segment.bbox)
        .collect::<Vec<_>>();
    let bbox_index = BBoxIndex::new(&segment_bboxes);
    let mut candidates = Vec::new();

    for first_index in 0..indexed_segments.len() {
        bbox_index.query_into(
            indexed_segments[first_index].bbox,
            tolerance.bbox_epsilon,
            &mut candidates,
        );
        #[cfg(test)]
        SELF_INTERSECTION_SPLIT_CANDIDATE_COUNT.with(|candidate_count| {
            candidate_count.set(candidate_count.get().saturating_add(candidates.len()));
        });
        for &second_index in &candidates {
            if second_index <= first_index {
                continue;
            }
            if contour_segment_pair_is_adjacent(first_index, second_index, indexed_segments.len()) {
                continue;
            }
            append_self_intersection_parameters(
                indexed_segments,
                &mut split_parameters,
                first_index,
                second_index,
                tolerance,
            );
        }
    }
    split_parameters
}

fn append_self_intersection_parameters(
    indexed_segments: &[IndexedSegment],
    split_parameters: &mut [Vec<f64>],
    first_index: usize,
    second_index: usize,
    tolerance: GeometryTolerance,
) {
    let (first_parameters, second_parameters) = split_parameters.split_at_mut(second_index);
    for intersection in intersect_curve_segments_with_bboxes(
        &indexed_segments[first_index].segment,
        &indexed_segments[second_index].segment,
        indexed_segments[first_index].bbox,
        indexed_segments[second_index].bbox,
        tolerance,
    ) {
        first_parameters[first_index].push(intersection.t_a);
        second_parameters[0].push(intersection.t_b);
    }
}

fn trace_self_intersecting_contour(
    contour: &Contour,
    fill_rule: &str,
    tolerance: GeometryTolerance,
    topology_depth: usize,
) -> Result<Vec<Contour>, ShapeError> {
    let trace_with_tolerance = |trace_tolerance| match trace_self_intersecting_contour_once(
        contour,
        fill_rule,
        trace_tolerance,
        topology_depth,
    ) {
        Err(ShapeError::BooleanTopology)
            if contour
                .segments
                .iter()
                .any(|segment| !matches!(segment, CurveSegment::Line { .. })) =>
        {
            let flattened = flatten_contour_to_lines(contour, trace_tolerance)
                .ok_or(ShapeError::BooleanTopology)?;
            trace_self_intersecting_contour_once(
                &flattened,
                fill_rule,
                trace_tolerance,
                topology_depth,
            )
        }
        result => result,
    };
    let result = trace_with_tolerance(tolerance);
    if !matches!(result, Err(ShapeError::BooleanTopology)) {
        return result;
    }

    // Rounded font outlines can leave a narrow loop whose two fill-side
    // probes cross the same boundary at the default distance. Retrying only
    // failed topology traces with a smaller deterministic probe preserves
    // successful output while recovering the actual nonzero fill boundary.
    trace_with_tolerance(GeometryTolerance {
        sample_epsilon: tolerance.sample_epsilon * 0.5,
        ..tolerance
    })
}

fn trace_self_intersecting_contour_once(
    contour: &Contour,
    fill_rule: &str,
    tolerance: GeometryTolerance,
    topology_depth: usize,
) -> Result<Vec<Contour>, ShapeError> {
    if topology_depth > MAX_TOPOLOGY_RECURSION {
        return Err(ShapeError::BooleanTopology);
    }

    let indexed_segments = contour
        .segments
        .iter()
        .enumerate()
        .map(|(segment_index, segment)| IndexedSegment {
            contour_index: 0,
            segment_index,
            segment: segment.clone(),
            bbox: segment.bbox(),
        })
        .collect::<Vec<_>>();
    let split_parameters = self_intersection_split_parameters(&indexed_segments, tolerance);

    let mut edges = Vec::new();
    for (indexed_segment, params) in indexed_segments.iter().zip(split_parameters.iter()) {
        let mut sorted_params = params.clone();
        canonicalize_parameters(&mut sorted_params, &indexed_segment.segment, tolerance);
        for window in sorted_params.windows(2) {
            let t_start = window[0];
            let t_end = window[1];
            let mut piece = indexed_segment.segment.slice(t_start, t_end);
            if segment_spatial_extent(&piece) <= tolerance.snap_epsilon {
                continue;
            }
            let midpoint = piece.eval(0.5);
            let tangent = piece.derivative(0.5);
            let tangent_length = point_length(tangent);
            if tangent_length <= tolerance.position_epsilon {
                continue;
            }
            let normal = Point2D {
                x: -tangent.y / tangent_length,
                y: tangent.x / tangent_length,
            };
            let left_inside = point_in_contours_with_fill_rule(
                std::slice::from_ref(contour),
                add_points(midpoint, scale_point(normal, tolerance.sample_epsilon)),
                fill_rule,
                tolerance,
            );
            let right_inside = point_in_contours_with_fill_rule(
                std::slice::from_ref(contour),
                add_points(midpoint, scale_point(normal, -tolerance.sample_epsilon)),
                fill_rule,
                tolerance,
            );
            if left_inside == right_inside {
                continue;
            }
            if right_inside && !left_inside {
                piece = piece.reversed();
            }
            let start = piece.start();
            let end = piece.end();
            if points_close(start, end, tolerance.position_epsilon) {
                continue;
            }
            edges.push(EdgePiece {
                segment: piece,
                start_node: 0,
                end_node: 0,
                used: false,
            });
        }
    }

    Ok(trace_edges_to_region_with_depth(edges, tolerance, topology_depth + 1)?.contours)
}

fn indexed_segments(region: &Region) -> Vec<IndexedSegment> {
    let mut indexed = Vec::new();
    for (contour_index, contour) in region.contours.iter().enumerate() {
        for (segment_index, segment) in contour.segments.iter().enumerate() {
            indexed.push(IndexedSegment {
                contour_index,
                segment_index,
                segment: segment.clone(),
                bbox: segment.bbox(),
            });
        }
    }
    indexed
}

fn region_contains_curves(region: &Region) -> bool {
    region.contours.iter().any(|contour| {
        contour
            .segments
            .iter()
            .any(|segment| !matches!(segment, CurveSegment::Line { .. }))
    })
}

// ---------------------------------------------------------------------------
// Curve re-fitting
//
// Boolean evaluation flattens curved operands (topological robustness over
// exact curve-curve intersection). This pass reconstructs compact
// cubics from the flattened output: contours split at corners, and each
// smooth non-collinear run is least-squares-fit (Schneider, Graphics Gems
// "FitCurves") within a deterministic tolerance. Straight and two-point runs
// pass through segment-by-segment, so all-line results (rectilinear
// booleans) are byte-identical to the pre-refit output.
// ---------------------------------------------------------------------------

/// Vertices turning less than ~20 degrees are treated as smooth.
const REFIT_SMOOTH_COS: f64 = 0.94;
/// Max distance between the fitted cubic and the flattened polyline.
const REFIT_ERROR_FACTOR: f64 = 2.0; // x flatness_epsilon
const REFIT_REPARAM_ITERATIONS: usize = 4;
const REFIT_MAX_SPLIT_DEPTH: usize = 12;

fn refit_region_curves(region: Region, tolerance: GeometryTolerance) -> Region {
    Region {
        contours: region
            .contours
            .into_iter()
            .map(|contour| refit_contour_curves(contour, tolerance))
            .collect(),
    }
}

fn refit_contour_curves(contour: Contour, tolerance: GeometryTolerance) -> Contour {
    // Collect the contour as a point ring; bail out (pass through) if any
    // segment is not a line - post-boolean contours are all lines, and mixed
    // content means someone else produced this region.
    let mut points: Vec<Point2D> = Vec::with_capacity(contour.segments.len() + 1);
    for (index, segment) in contour.segments.iter().enumerate() {
        let CurveSegment::Line { p0, p1 } = segment else {
            return contour;
        };
        if index == 0 {
            points.push(*p0);
        }
        points.push(*p1);
    }
    if points.len() < 4 {
        return contour;
    }
    let Some(&last_point) = points.last() else {
        return contour;
    };
    let closed = points_close(points[0], last_point, tolerance.position_epsilon);
    if closed {
        points.pop();
    }
    let count = points.len();
    if count < 3 {
        return contour;
    }

    // Corner indices. For open chains both endpoints are corners.
    let mut corners: Vec<usize> = Vec::new();
    let smooth_at = |index: usize| -> bool {
        let previous = points[(index + count - 1) % count];
        let current = points[index];
        let next = points[(index + 1) % count];
        let incoming = subtract_points(current, previous);
        let outgoing = subtract_points(next, current);
        let incoming_length = point_length(incoming);
        let outgoing_length = point_length(outgoing);
        if incoming_length <= 1e-12 || outgoing_length <= 1e-12 {
            return false;
        }
        let cos = (incoming.x * outgoing.x + incoming.y * outgoing.y)
            / (incoming_length * outgoing_length);
        cos >= REFIT_SMOOTH_COS
    };
    if closed {
        for index in 0..count {
            if !smooth_at(index) {
                corners.push(index);
            }
        }
        if corners.is_empty() {
            // Fully smooth loop (e.g. a flattened circle): deterministic
            // split at index 0.
            corners.push(0);
        }
        // Keep the contour's original start point whenever it is a run
        // boundary - rotating the ring changes the emitted start vertex,
        // which must stay stable for output determinism.
        if let Some(zero_position) = corners.iter().position(|&index| index == 0) {
            corners.rotate_left(zero_position);
        }
    } else {
        corners.push(0);
        for index in 1..count - 1 {
            if !smooth_at(index) {
                corners.push(index);
            }
        }
        corners.push(count - 1);
    }

    let max_error = tolerance.flatness_epsilon * REFIT_ERROR_FACTOR;
    let mut segments: Vec<CurveSegment> = Vec::new();
    let mut any_fitted = false;
    let run_count = if closed {
        corners.len()
    } else {
        corners.len() - 1
    };
    for run_index in 0..run_count {
        let start = corners[run_index];
        let end = corners[(run_index + 1) % corners.len()];
        let mut run: Vec<Point2D> = vec![points[start]];
        let mut cursor = start;
        loop {
            cursor = (cursor + 1) % count;
            run.push(points[cursor]);
            if cursor == end {
                break;
            }
            if run.len() > count + 1 {
                // Degenerate corner layout; fall back to the original contour.
                return contour;
            }
        }
        any_fitted |= append_refit_run(&mut segments, &run, max_error, tolerance);
    }
    // Nothing was fitted: return the ORIGINAL contour so all-line results
    // stay byte-identical (the rebuild would re-derive the closing segment
    // and, for rotated rings, the start vertex).
    if !any_fitted || segments.is_empty() {
        return contour;
    }
    Contour {
        segments,
        closed: contour.closed,
    }
}

/// Returns true when the run was replaced by fitted cubics.
fn append_refit_run(
    segments: &mut Vec<CurveSegment>,
    run: &[Point2D],
    max_error: f64,
    tolerance: GeometryTolerance,
) -> bool {
    let passthrough = |segments: &mut Vec<CurveSegment>| {
        for window in run.windows(2) {
            segments.push(CurveSegment::Line {
                p0: window[0],
                p1: window[1],
            });
        }
    };
    if run.len() < 4 {
        passthrough(segments);
        return false;
    }
    // Straight runs stay as their original line segments (no merging - this
    // keeps rectilinear boolean output byte-identical).
    let &[first, .., last] = run else {
        passthrough(segments);
        return false;
    };
    let collinear = run
        .iter()
        .all(|point| point_line_distance(*point, first, last) <= tolerance.position_epsilon);
    if collinear {
        passthrough(segments);
        return false;
    }
    let left_tangent = normalize_direction(subtract_points(run[1], run[0]));
    let right_tangent = normalize_direction(subtract_points(run[run.len() - 2], last));
    let mut fitted: Vec<CurveSegment> = Vec::new();
    if fit_cubic_run(run, left_tangent, right_tangent, max_error, 0, &mut fitted).is_ok()
        && fitted.len() < run.len() - 1
        && fitted_run_matches_polyline(&fitted, run, max_error)
    {
        segments.append(&mut fitted);
        true
    } else {
        passthrough(segments);
        false
    }
}

/// Independent acceptance check: densely sample the fitted cubics and
/// measure the distance to the source polyline. The per-point error inside
/// the fitter only looks at the sample parameters, which a cubic can
/// oscillate between (and the two-point heuristic is never error-checked).
fn fitted_run_matches_polyline(fitted: &[CurveSegment], run: &[Point2D], max_error: f64) -> bool {
    const SAMPLES_PER_CURVE: usize = 16;
    for segment in fitted {
        for step in 0..=SAMPLES_PER_CURVE {
            #[expect(clippy::cast_precision_loss, reason = "small sample counts")]
            let u = step as f64 / SAMPLES_PER_CURVE as f64;
            let sample = evaluate_cubic(segment, u);
            let mut best = f64::INFINITY;
            for window in run.windows(2) {
                best = best.min(point_segment_distance(sample, window[0], window[1]));
                if best <= max_error {
                    break;
                }
            }
            if best > max_error {
                return false;
            }
        }
    }
    true
}

fn normalize_direction(vector: Point2D) -> Point2D {
    let length = point_length(vector);
    if length <= 1e-12 {
        Point2D { x: 0.0, y: 0.0 }
    } else {
        Point2D {
            x: vector.x / length,
            y: vector.y / length,
        }
    }
}

struct RefitOverflow;

fn fit_cubic_run(
    run: &[Point2D],
    left_tangent: Point2D,
    right_tangent: Point2D,
    max_error: f64,
    depth: usize,
    out: &mut Vec<CurveSegment>,
) -> Result<(), RefitOverflow> {
    if depth > REFIT_MAX_SPLIT_DEPTH {
        return Err(RefitOverflow);
    }
    let n = run.len();
    if n == 2 {
        let distance = point_distance(run[0], run[1]) / 3.0;
        out.push(CurveSegment::Cubic {
            p0: run[0],
            p1: Point2D {
                x: run[0].x + left_tangent.x * distance,
                y: run[0].y + left_tangent.y * distance,
            },
            p2: Point2D {
                x: run[1].x + right_tangent.x * distance,
                y: run[1].y + right_tangent.y * distance,
            },
            p3: run[1],
        });
        return Ok(());
    }

    // Chord-length parameterization.
    let mut parameters: Vec<f64> = Vec::with_capacity(n);
    let mut arc_length = 0.0;
    parameters.push(arc_length);
    for window in run.windows(2) {
        arc_length += point_distance(window[0], window[1]);
        parameters.push(arc_length);
    }
    let total = arc_length;
    if total <= 1e-12 {
        return Ok(());
    }
    for value in &mut parameters {
        *value /= total;
    }

    let mut best_curve = generate_bezier(run, &parameters, left_tangent, right_tangent);
    let (mut error, mut split_index) = refit_max_error(run, &best_curve, &parameters);
    if error <= max_error {
        out.push(best_curve);
        return Ok(());
    }

    // Newton-Raphson reparameterization for near-miss fits.
    if error <= max_error * 16.0 {
        let mut reparameterized = parameters.clone();
        for _ in 0..REFIT_REPARAM_ITERATIONS {
            for (point, parameter) in run.iter().zip(reparameterized.iter_mut()) {
                *parameter = newton_raphson_root(&best_curve, *point, *parameter);
            }
            best_curve = generate_bezier(run, &reparameterized, left_tangent, right_tangent);
            let (next_error, next_split) = refit_max_error(run, &best_curve, &reparameterized);
            error = next_error;
            split_index = next_split;
            if error <= max_error {
                out.push(best_curve);
                return Ok(());
            }
        }
    }

    // Split at the max-error point and recurse.
    let split = split_index.clamp(1, n - 2);
    let center_tangent = normalize_direction(subtract_points(run[split - 1], run[split + 1]));
    let right_of_left = Point2D {
        x: -center_tangent.x,
        y: -center_tangent.y,
    };
    fit_cubic_run(
        &run[..=split],
        left_tangent,
        center_tangent,
        max_error,
        depth + 1,
        out,
    )?;
    fit_cubic_run(
        &run[split..],
        right_of_left,
        right_tangent,
        max_error,
        depth + 1,
        out,
    )
}

fn generate_bezier(
    run: &[Point2D],
    parameters: &[f64],
    left_tangent: Point2D,
    right_tangent: Point2D,
) -> CurveSegment {
    let &[first, .., last] = run else {
        // Callers always pass runs of at least two points; a shorter run has
        // no chord to fit, so collapse to a degenerate line.
        let point = run.first().copied().unwrap_or(Point2D { x: 0.0, y: 0.0 });
        return CurveSegment::Line {
            p0: point,
            p1: point,
        };
    };
    let mut c = [[0.0_f64; 2]; 2];
    let mut x = [0.0_f64; 2];
    for (point, &u) in run.iter().zip(parameters.iter()) {
        let b0 = (1.0 - u).powi(3);
        let b1 = 3.0 * u * (1.0 - u).powi(2);
        let b2 = 3.0 * u * u * (1.0 - u);
        let b3 = u.powi(3);
        let a1 = Point2D {
            x: left_tangent.x * b1,
            y: left_tangent.y * b1,
        };
        let a2 = Point2D {
            x: right_tangent.x * b2,
            y: right_tangent.y * b2,
        };
        c[0][0] += a1.x * a1.x + a1.y * a1.y;
        c[0][1] += a1.x * a2.x + a1.y * a2.y;
        c[1][0] = c[0][1];
        c[1][1] += a2.x * a2.x + a2.y * a2.y;
        let tmp = Point2D {
            x: point.x - (first.x * (b0 + b1) + last.x * (b2 + b3)),
            y: point.y - (first.y * (b0 + b1) + last.y * (b2 + b3)),
        };
        x[0] += a1.x * tmp.x + a1.y * tmp.y;
        x[1] += a2.x * tmp.x + a2.y * tmp.y;
    }
    let det_c0_c1 = c[0][0] * c[1][1] - c[1][0] * c[0][1];
    let det_c0_x = c[0][0] * x[1] - c[1][0] * x[0];
    let det_x_c1 = x[0] * c[1][1] - x[1] * c[0][1];
    let alpha_left = if det_c0_c1.abs() <= 1e-12 {
        0.0
    } else {
        det_x_c1 / det_c0_c1
    };
    let alpha_right = if det_c0_c1.abs() <= 1e-12 {
        0.0
    } else {
        det_c0_x / det_c0_c1
    };
    let segment_length = point_distance(first, last);
    let epsilon = 1.0e-6 * segment_length;
    if alpha_left < epsilon || alpha_right < epsilon {
        // Wu/Barsky heuristic fallback.
        let distance = segment_length / 3.0;
        return CurveSegment::Cubic {
            p0: first,
            p1: Point2D {
                x: first.x + left_tangent.x * distance,
                y: first.y + left_tangent.y * distance,
            },
            p2: Point2D {
                x: last.x + right_tangent.x * distance,
                y: last.y + right_tangent.y * distance,
            },
            p3: last,
        };
    }
    CurveSegment::Cubic {
        p0: first,
        p1: Point2D {
            x: first.x + left_tangent.x * alpha_left,
            y: first.y + left_tangent.y * alpha_left,
        },
        p2: Point2D {
            x: last.x + right_tangent.x * alpha_right,
            y: last.y + right_tangent.y * alpha_right,
        },
        p3: last,
    }
}

fn refit_max_error(run: &[Point2D], curve: &CurveSegment, parameters: &[f64]) -> (f64, usize) {
    let mut max_distance = 0.0_f64;
    let mut split_index = run.len() / 2;
    for (index, (point, &u)) in run.iter().zip(parameters.iter()).enumerate() {
        let on_curve = evaluate_cubic(curve, u);
        let distance = point_distance(on_curve, *point);
        if distance > max_distance {
            max_distance = distance;
            split_index = index;
        }
    }
    (max_distance, split_index)
}

fn evaluate_cubic(curve: &CurveSegment, u: f64) -> Point2D {
    let CurveSegment::Cubic { p0, p1, p2, p3 } = curve else {
        return curve.start();
    };
    let t = u;
    let mt = 1.0 - t;
    Point2D {
        x: mt.powi(3) * p0.x
            + 3.0 * mt * mt * t * p1.x
            + 3.0 * mt * t * t * p2.x
            + t.powi(3) * p3.x,
        y: mt.powi(3) * p0.y
            + 3.0 * mt * mt * t * p1.y
            + 3.0 * mt * t * t * p2.y
            + t.powi(3) * p3.y,
    }
}

fn newton_raphson_root(curve: &CurveSegment, point: Point2D, u: f64) -> f64 {
    let CurveSegment::Cubic { p0, p1, p2, p3 } = curve else {
        return u;
    };
    let q = evaluate_cubic(curve, u);
    // First derivative control points.
    let d1 = [
        Point2D {
            x: 3.0 * (p1.x - p0.x),
            y: 3.0 * (p1.y - p0.y),
        },
        Point2D {
            x: 3.0 * (p2.x - p1.x),
            y: 3.0 * (p2.y - p1.y),
        },
        Point2D {
            x: 3.0 * (p3.x - p2.x),
            y: 3.0 * (p3.y - p2.y),
        },
    ];
    let mt = 1.0 - u;
    let q1 = Point2D {
        x: mt * mt * d1[0].x + 2.0 * mt * u * d1[1].x + u * u * d1[2].x,
        y: mt * mt * d1[0].y + 2.0 * mt * u * d1[1].y + u * u * d1[2].y,
    };
    let q2 = Point2D {
        x: 6.0 * mt * (d1[1].x - d1[0].x) / 3.0 + 6.0 * u * (d1[2].x - d1[1].x) / 3.0,
        y: 6.0 * mt * (d1[1].y - d1[0].y) / 3.0 + 6.0 * u * (d1[2].y - d1[1].y) / 3.0,
    };
    let diff = Point2D {
        x: q.x - point.x,
        y: q.y - point.y,
    };
    let numerator = diff.x * q1.x + diff.y * q1.y;
    let denominator = q1.x * q1.x + q1.y * q1.y + diff.x * q2.x + diff.y * q2.y;
    if denominator.abs() <= 1e-12 {
        return u;
    }
    (u - numerator / denominator).clamp(0.0, 1.0)
}

fn flatten_region_curves(region: &Region, tolerance: GeometryTolerance) -> Region {
    Region {
        contours: region
            .contours
            .iter()
            .filter_map(|contour| flatten_contour_to_lines(contour, tolerance))
            .collect(),
    }
}

fn flatten_contour_to_lines(contour: &Contour, tolerance: GeometryTolerance) -> Option<Contour> {
    let polyline = flatten_contour(contour, tolerance);
    if polyline.len() < 2 {
        return None;
    }

    let mut segments = Vec::with_capacity(polyline.len().saturating_sub(1));
    for window in polyline.windows(2) {
        let p0 = window[0];
        let p1 = window[1];
        if points_close(p0, p1, tolerance.position_epsilon) {
            continue;
        }
        segments.push(CurveSegment::Line { p0, p1 });
    }
    if segments.is_empty() {
        return None;
    }
    Some(Contour {
        segments,
        closed: contour.closed,
    })
}

#[allow(clippy::too_many_arguments)]
fn collect_boolean_edges(
    edges: &mut Vec<EdgePiece>,
    indexed_segments: &[IndexedSegment],
    split_parameters: &[Vec<f64>],
    source_side: RegionSide,
    lhs: &Region,
    rhs: &Region,
    prepared_lhs: &PreparedRegion,
    prepared_rhs: &PreparedRegion,
    op: BooleanOp,
    tolerance: GeometryTolerance,
) {
    for (indexed_segment, params) in indexed_segments.iter().zip(split_parameters.iter()) {
        let mut sorted_params = params.clone();
        canonicalize_parameters(&mut sorted_params, &indexed_segment.segment, tolerance);
        for window in sorted_params.windows(2) {
            let t_start = window[0];
            let t_end = window[1];
            let mut piece = indexed_segment.segment.slice(t_start, t_end);
            if segment_spatial_extent(&piece) <= tolerance.snap_epsilon {
                continue;
            }
            let midpoint = piece.eval(0.5);
            let tangent = piece.derivative(0.5);
            let tangent_length = point_length(tangent);
            if tangent_length <= tolerance.position_epsilon {
                continue;
            }
            let normal = Point2D {
                x: -tangent.y / tangent_length,
                y: tangent.x / tangent_length,
            };
            let (left_inside, right_inside) = probe_boolean_side_membership(
                &piece,
                source_side,
                lhs,
                rhs,
                prepared_lhs,
                prepared_rhs,
                op,
                tolerance,
                midpoint,
                normal,
            );
            if left_inside == right_inside {
                continue;
            }
            if right_inside && !left_inside {
                piece = piece.reversed();
            }
            let start = piece.start();
            let end = piece.end();
            if points_close(start, end, tolerance.position_epsilon) {
                continue;
            }
            edges.push(EdgePiece {
                segment: piece,
                start_node: 0,
                end_node: 0,
                used: false,
            });
        }
    }
}

/// Makes traversal of a completed edge set independent of insertion order.
///
/// `NodeSnapper` intentionally retains the first point found by its tolerance
/// lookup. Sorting the complete edge set first gives equivalent edge sets the
/// same node IDs and trace start order, while preserving the directed segment
/// geometry used for fill semantics. This does not make intersection discovery
/// itself symmetric: polygon-only P3 covers line intersections, while known
/// near-parallel flattened-curve asymmetries remain tracked by F2/F3.
fn canonicalize_edge_topology(edges: &mut [EdgePiece], tolerance: GeometryTolerance) {
    edges.sort_by(|lhs, rhs| compare_segments_exact(&lhs.segment, &rhs.segment));
    let mut node_snapper = NodeSnapper::default();
    for edge in edges {
        edge.start_node = node_snapper.index_for(edge.segment.start(), tolerance.snap_epsilon);
        edge.end_node = node_snapper.index_for(edge.segment.end(), tolerance.snap_epsilon);
    }
}

fn deduplicate_coincident_edges(edges: &mut Vec<EdgePiece>, tolerance: GeometryTolerance) {
    // Keep the first edge for each canonical node/geometry key. The trace-time
    // canonicalization relies on this retaining a sorted subset whose removed
    // duplicates introduced no representative nodes of their own.
    let mut seen = HashSet::new();
    edges.retain(|edge| seen.insert(edge_piece_key(edge, tolerance)));
}

fn edge_piece_key(edge: &EdgePiece, tolerance: GeometryTolerance) -> EdgePieceKey {
    (
        edge.start_node,
        edge.end_node,
        segment_geometry_key(&edge.segment, tolerance),
    )
}

type EdgePieceKey = (usize, usize, SegmentGeometryKey);
type PointKey = (i64, i64);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum SegmentGeometryKey {
    Line(PointKey, PointKey),
    Quad(PointKey, PointKey, PointKey),
    Cubic(PointKey, PointKey, PointKey, PointKey),
}

fn segment_geometry_key(
    segment: &CurveSegment,
    tolerance: GeometryTolerance,
) -> SegmentGeometryKey {
    match segment {
        CurveSegment::Line { p0, p1 } => {
            SegmentGeometryKey::Line(point_key(*p0, tolerance), point_key(*p1, tolerance))
        }
        CurveSegment::Quad { p0, p1, p2 } => SegmentGeometryKey::Quad(
            point_key(*p0, tolerance),
            point_key(*p1, tolerance),
            point_key(*p2, tolerance),
        ),
        CurveSegment::Cubic { p0, p1, p2, p3 } => SegmentGeometryKey::Cubic(
            point_key(*p0, tolerance),
            point_key(*p1, tolerance),
            point_key(*p2, tolerance),
            point_key(*p3, tolerance),
        ),
    }
}

fn boolean_result_membership(
    _source_side: RegionSide,
    lhs: &Region,
    rhs: &Region,
    prepared_lhs: &PreparedRegion,
    prepared_rhs: &PreparedRegion,
    point: Point2D,
    op: BooleanOp,
) -> bool {
    match op {
        BooleanOp::Union => {
            point_in_region(lhs, prepared_lhs, point) || point_in_region(rhs, prepared_rhs, point)
        }
        BooleanOp::Subtract => {
            point_in_region(lhs, prepared_lhs, point) && !point_in_region(rhs, prepared_rhs, point)
        }
        BooleanOp::Intersect => {
            point_in_region(lhs, prepared_lhs, point) && point_in_region(rhs, prepared_rhs, point)
        }
        BooleanOp::Xor => {
            point_in_region(lhs, prepared_lhs, point) != point_in_region(rhs, prepared_rhs, point)
        }
    }
}

fn trace_edges_to_region(
    edges: Vec<EdgePiece>,
    tolerance: GeometryTolerance,
) -> Result<Region, ShapeError> {
    trace_edges_to_region_with_depth(edges, tolerance, 0)
}

fn trace_edges_to_region_with_depth(
    mut edges: Vec<EdgePiece>,
    tolerance: GeometryTolerance,
    topology_depth: usize,
) -> Result<Region, ShapeError> {
    if topology_depth > MAX_TOPOLOGY_RECURSION {
        return Err(ShapeError::BooleanTopology);
    }

    if edges.is_empty() {
        return Ok(Region {
            contours: Vec::new(),
        });
    }

    canonicalize_edge_topology(&mut edges, tolerance);

    let mut outgoing: HashMap<usize, Vec<usize>> = HashMap::new();
    for (edge_index, edge) in edges.iter().enumerate() {
        outgoing
            .entry(edge.start_node)
            .or_default()
            .push(edge_index);
    }

    let mut contours = Vec::new();
    for edge_index in 0..edges.len() {
        if edges[edge_index].used {
            continue;
        }
        let start_node = edges[edge_index].start_node;
        let mut current_edge_index = edge_index;
        let mut contour_segments = Vec::new();
        let max_steps = edges.len().saturating_mul(2).max(8);
        for _ in 0..max_steps {
            if edges[current_edge_index].used {
                return Err(ShapeError::BooleanTopology);
            }
            edges[current_edge_index].used = true;
            contour_segments.push(edges[current_edge_index].segment.clone());
            let end_node = edges[current_edge_index].end_node;
            if end_node == start_node {
                break;
            }
            let Some(candidates) = outgoing.get(&end_node) else {
                return Err(ShapeError::BooleanTopology);
            };
            let Some(next_index) =
                select_next_edge(&edges, current_edge_index, candidates, tolerance)
            else {
                return Err(ShapeError::BooleanTopology);
            };
            current_edge_index = next_index;
        }
        let contour = Contour {
            segments: contour_segments,
            closed: true,
        };
        if !contour.segments.is_empty() {
            contours.push(contour);
        }
    }

    let region = normalize_region_with_depth(
        Region { contours },
        "nonzero",
        tolerance,
        topology_depth + 1,
    )?;
    Ok(stabilize_region(region, tolerance))
}

fn stabilize_region(region: Region, tolerance: GeometryTolerance) -> Region {
    let mut contours = region
        .contours
        .into_iter()
        .filter(|contour| !contour.segments.is_empty())
        .map(|contour| {
            let pruned = remove_short_line_segments(&contour, tolerance);
            let simplified = simplify_contour_lines(&pruned, tolerance);
            let canonical = canonicalize_contour_start(&simplified, tolerance);
            let simplified = simplify_contour_lines(&canonical, tolerance);
            remove_short_line_segments(&simplified, tolerance)
        })
        .collect::<Vec<_>>();
    contours = orient_contours_by_nesting(contours, tolerance)
        .into_iter()
        .map(|contour| {
            let canonical = canonicalize_contour_start(&contour, tolerance);
            simplify_contour_lines(&canonical, tolerance)
        })
        .collect();
    contours.sort_by(|left, right| compare_contours(left, right, tolerance));
    Region { contours }
}

fn orient_contours_by_nesting(
    contours: Vec<Contour>,
    tolerance: GeometryTolerance,
) -> Vec<Contour> {
    let flattened = contours
        .iter()
        .map(|contour| flatten_contour(contour, tolerance))
        .collect::<Vec<_>>();
    let samples = contours
        .iter()
        .zip(flattened.iter())
        .map(|(contour, polyline)| contour_interior_sample(contour, polyline, tolerance))
        .collect::<Vec<_>>();

    contours
        .into_iter()
        .enumerate()
        .map(|(contour_index, contour)| {
            let polyline = &flattened[contour_index];
            if polyline.len() < 4 {
                return contour;
            }
            let actual_ccw = signed_area(polyline) > 0.0;
            let Some(sample) = samples[contour_index] else {
                return contour;
            };
            let containing_count = flattened
                .iter()
                .enumerate()
                .filter(|(other_index, other_polyline)| {
                    *other_index != contour_index
                        && other_polyline.len() >= 4
                        && point_in_polygon_evenodd(sample, other_polyline)
                })
                .count();
            let expected_ccw = containing_count % 2 == 0;
            if actual_ccw == expected_ccw {
                contour
            } else {
                reverse_contour(&contour)
            }
        })
        .collect()
}

fn contour_interior_sample(
    contour: &Contour,
    polyline: &[Point2D],
    tolerance: GeometryTolerance,
) -> Option<Point2D> {
    let is_ccw = signed_area(polyline) > 0.0;
    for segment in &contour.segments {
        let midpoint = segment.eval(0.5);
        let tangent = segment.derivative(0.5);
        let tangent_length = point_length(tangent);
        if tangent_length <= tolerance.position_epsilon {
            continue;
        }
        let normal = Point2D {
            x: -tangent.y / tangent_length,
            y: tangent.x / tangent_length,
        };
        let direction = if is_ccw { 1.0 } else { -1.0 };
        for distance in probe_distances(segment.bbox().max_dimension()) {
            let sample = add_points(midpoint, scale_point(normal, distance * direction));
            if point_in_polygon_evenodd(sample, polyline) {
                return Some(sample);
            }
        }
    }
    None
}

fn remove_short_line_segments(contour: &Contour, tolerance: GeometryTolerance) -> Contour {
    Contour {
        segments: contour
            .segments
            .iter()
            .filter(|segment| match segment {
                CurveSegment::Line { p0, p1 } => point_distance(*p0, *p1) > tolerance.snap_epsilon,
                CurveSegment::Quad { .. } | CurveSegment::Cubic { .. } => true,
            })
            .cloned()
            .collect(),
        closed: contour.closed,
    }
}

fn simplify_contour_lines(contour: &Contour, tolerance: GeometryTolerance) -> Contour {
    if contour.segments.len() <= 1 {
        return contour.clone();
    }

    let mut segments = contour.segments.clone();
    loop {
        let mut changed = false;
        let mut simplified = Vec::with_capacity(segments.len());
        for segment in segments {
            if let Some(previous) = simplified.last_mut()
                && let Some(merged) = merge_line_segments(previous, &segment, tolerance)
            {
                *previous = merged;
                changed = true;
                continue;
            }
            simplified.push(segment);
        }

        if simplified.len() > 1 {
            let first = simplified.first().cloned();
            let last = simplified.last().cloned();
            if let (Some(first_segment), Some(last_segment)) = (first, last)
                && let Some(merged) = merge_line_segments(&last_segment, &first_segment, tolerance)
            {
                simplified[0] = merged;
                simplified.pop();
                changed = true;
            }
        }

        if !changed {
            return Contour {
                segments: simplified,
                closed: contour.closed,
            };
        }
        segments = simplified;
    }
}

fn merge_line_segments(
    left: &CurveSegment,
    right: &CurveSegment,
    tolerance: GeometryTolerance,
) -> Option<CurveSegment> {
    let (left_start, left_end) = left.as_line()?;
    let (right_start, right_end) = right.as_line()?;
    if !points_close(left_end, right_start, tolerance.position_epsilon) {
        return None;
    }
    let left_delta = subtract_points(left_end, left_start);
    let right_delta = subtract_points(right_end, right_start);
    let left_length = left_delta.x.hypot(left_delta.y);
    let right_length = right_delta.x.hypot(right_delta.y);
    if left_length == 0.0
        || right_length == 0.0
        || !left_length.is_finite()
        || !right_length.is_finite()
    {
        return None;
    }
    let left_direction = Point2D {
        x: left_delta.x / left_length,
        y: left_delta.y / left_length,
    };
    let right_direction = Point2D {
        x: right_delta.x / right_length,
        y: right_delta.y / right_length,
    };
    if cross(left_direction, right_direction).abs() > LINE_MERGE_DIRECTION_EPSILON {
        return None;
    }
    let merged_delta = subtract_points(right_end, left_start);
    let merged_length = merged_delta.x.hypot(merged_delta.y);
    if merged_length == 0.0 || !merged_length.is_finite() {
        return None;
    }
    let merged_direction = Point2D {
        x: merged_delta.x / merged_length,
        y: merged_delta.y / merged_length,
    };
    let left_join_distance = cross(left_delta, merged_direction).abs();
    let right_join_distance =
        cross(subtract_points(right_start, left_start), merged_direction).abs();
    if left_join_distance.max(right_join_distance) > tolerance.position_epsilon {
        return None;
    }
    if dot(left_direction, right_direction) <= 0.0 {
        return None;
    }
    Some(CurveSegment::Line {
        p0: left_start,
        p1: right_end,
    })
}

fn canonicalize_contour_start(contour: &Contour, tolerance: GeometryTolerance) -> Contour {
    if contour.segments.len() <= 1 {
        return contour.clone();
    }

    let mut best_index = 0usize;
    for index in 1..contour.segments.len() {
        if point_key(contour.segments[index].start(), tolerance)
            < point_key(contour.segments[best_index].start(), tolerance)
        {
            best_index = index;
        }
    }

    if best_index == 0 {
        return contour.clone();
    }

    let mut segments = Vec::with_capacity(contour.segments.len());
    segments.extend_from_slice(&contour.segments[best_index..]);
    segments.extend_from_slice(&contour.segments[..best_index]);
    Contour {
        segments,
        closed: contour.closed,
    }
}

fn compare_contours(
    left: &Contour,
    right: &Contour,
    tolerance: GeometryTolerance,
) -> std::cmp::Ordering {
    let left_bbox = contour_bbox(left).unwrap_or(BBox {
        min_x: 0.0,
        min_y: 0.0,
        max_x: 0.0,
        max_y: 0.0,
    });
    let right_bbox = contour_bbox(right).unwrap_or(BBox {
        min_x: 0.0,
        min_y: 0.0,
        max_x: 0.0,
        max_y: 0.0,
    });
    let left_start = left
        .segments
        .first()
        .map_or((0, 0), |segment| point_key(segment.start(), tolerance));
    let right_start = right
        .segments
        .first()
        .map_or((0, 0), |segment| point_key(segment.start(), tolerance));

    bbox_key(left_bbox, tolerance)
        .cmp(&bbox_key(right_bbox, tolerance))
        .then_with(|| left_start.cmp(&right_start))
        .then_with(|| {
            let left_area = quantize_number(
                contour_area_abs(left, tolerance),
                tolerance.position_epsilon,
            );
            let right_area = quantize_number(
                contour_area_abs(right, tolerance),
                tolerance.position_epsilon,
            );
            right_area.cmp(&left_area)
        })
        .then_with(|| left.segments.len().cmp(&right.segments.len()))
}

fn edge_candidate_precedes(
    left: &EdgePiece,
    right: &EdgePiece,
    tolerance: GeometryTolerance,
) -> bool {
    edge_candidate_key(left, tolerance) < edge_candidate_key(right, tolerance)
}

fn edge_candidate_key(
    edge: &EdgePiece,
    tolerance: GeometryTolerance,
) -> ((i64, i64), (i64, i64), usize, usize) {
    (
        point_key(edge.segment.start(), tolerance),
        point_key(edge.segment.end(), tolerance),
        edge.start_node,
        edge.end_node,
    )
}

fn select_next_edge(
    edges: &[EdgePiece],
    current_edge_index: usize,
    candidates: &[usize],
    tolerance: GeometryTolerance,
) -> Option<usize> {
    let incoming = normalize_point(edges[current_edge_index].segment.derivative(1.0))?;
    let mut best: Option<(usize, f64)> = None;
    for candidate_index in candidates {
        let candidate = &edges[*candidate_index];
        if candidate.used {
            continue;
        }
        if candidate.end_node == edges[current_edge_index].start_node
            && candidate.start_node == edges[current_edge_index].end_node
        {
            continue;
        }
        let outgoing = normalize_point(candidate.segment.derivative(0.0))?;
        let delta = positive_angle_delta(point_angle(incoming), point_angle(outgoing), tolerance);
        match best {
            Some((best_index, best_delta))
                if delta > best_delta + tolerance.parameter_epsilon
                    || ((delta - best_delta).abs() <= tolerance.parameter_epsilon
                        && !edge_candidate_precedes(candidate, &edges[best_index], tolerance)) => {}
            _ => {
                best = Some((*candidate_index, delta));
            }
        }
    }
    best.map(|(index, _)| index)
}

fn prepare_region(region: &Region, tolerance: GeometryTolerance) -> PreparedRegion {
    prepare_region_impl(region, tolerance, None)
}

fn prepare_region_with_edge_index(
    region: &Region,
    tolerance: GeometryTolerance,
    expected_query_count: usize,
) -> PreparedRegion {
    prepare_region_impl(region, tolerance, Some(expected_query_count))
}

fn prepare_region_impl(
    region: &Region,
    tolerance: GeometryTolerance,
    expected_query_count: Option<usize>,
) -> PreparedRegion {
    let mut bbox: Option<BBox> = None;
    let mut contours = Vec::with_capacity(region.contours.len());
    for contour in &region.contours {
        if contour.segments.is_empty() {
            continue;
        }
        let flattened = flatten_contour(contour, tolerance);
        if flattened.len() < 2 {
            continue;
        }
        let contour_bbox = BBox::from_points(&flattened);
        let is_ccw = signed_area(&flattened) > 0.0;
        let edge_count = flattened.len().saturating_sub(1);
        let edge_index = expected_query_count
            .filter(|query_count| should_use_bbox_index(edge_count, *query_count))
            .map(|_| {
                let edge_bboxes = flattened
                    .windows(2)
                    .map(BBox::from_points)
                    .collect::<Vec<_>>();
                BBoxIndex::new(&edge_bboxes)
            });
        bbox = Some(match bbox {
            Some(current) => current.union(contour_bbox),
            None => contour_bbox,
        });
        contours.push(PreparedContour {
            flattened,
            bbox: contour_bbox,
            is_ccw,
            edge_index,
        });
    }
    PreparedRegion { bbox, contours }
}

fn point_in_region(_region: &Region, prepared: &PreparedRegion, point: Point2D) -> bool {
    let tolerance = GeometryTolerance::default();
    let Some(bbox) = prepared.bbox else {
        return false;
    };
    if !bbox.contains(point, tolerance.position_epsilon) {
        return false;
    }

    // Canonical Regions encode holes by contour orientation, so containment
    // uses nonzero winding across the prepared contours. Each contour's
    // half-open point test stays stable when a ray passes through a vertex;
    // orientation then decides whether that boundary adds or removes fill.
    let mut winding = 0i32;
    for prepared_contour in &prepared.contours {
        if !prepared_contour
            .bbox
            .contains(point, tolerance.position_epsilon)
        {
            continue;
        }
        if point_in_prepared_contour_halfopen(prepared_contour, point) {
            winding += if prepared_contour.is_ccw { 1 } else { -1 };
        }
    }
    winding != 0
}

/// Even-odd point-in-polygon over a prepared closed polyline with the half-open rule.
///
/// Repeated Boolean probes use a rightward-ray bbox query. A point at or to the
/// right of the contour maximum cannot have a strict rightward crossing. A
/// single-use prepared region (such as hit testing) keeps the linear scan so
/// index construction does not outweigh its one containment query.
fn point_in_prepared_contour_halfopen(contour: &PreparedContour, point: Point2D) -> bool {
    let Some(edge_index) = &contour.edge_index else {
        return point_in_closed_polyline_halfopen(&contour.flattened, point);
    };
    if point.x.is_finite() && point.x >= contour.bbox.max_x {
        return false;
    }
    let query_bbox = BBox {
        min_x: point.x,
        min_y: point.y,
        max_x: contour.bbox.max_x,
        max_y: point.y,
    };
    let mut inside = false;
    let candidate_count = edge_index.visit_candidates(query_bbox, 0.0, |edge_index| {
        let a = contour.flattened[edge_index];
        let b = contour.flattened[edge_index + 1];
        if (a.y > point.y) != (b.y > point.y) {
            let x_at_ray = halfopen_ray_crossing_x(a, b, point.y);
            if x_at_ray > point.x {
                inside = !inside;
            }
        }
    });
    #[cfg(test)]
    POINT_IN_REGION_EDGE_CANDIDATE_COUNT.with(|total_candidate_count| {
        total_candidate_count.set(total_candidate_count.get().saturating_add(candidate_count));
    });
    #[cfg(not(test))]
    let _ = candidate_count;
    inside
}

fn point_in_closed_polyline_halfopen(polyline: &[Point2D], point: Point2D) -> bool {
    let mut inside = false;
    for edge in polyline.windows(2) {
        let a = edge[0];
        let b = edge[1];
        if (a.y > point.y) != (b.y > point.y) {
            let x_at_ray = halfopen_ray_crossing_x(a, b, point.y);
            if x_at_ray > point.x {
                inside = !inside;
            }
        }
    }
    inside
}

#[inline]
fn halfopen_ray_crossing_x(start: Point2D, end: Point2D, ray_y: f64) -> f64 {
    let interpolated = start.x + ((ray_y - start.y) / (end.y - start.y)) * (end.x - start.x);
    let min_x = start.x.min(end.x);
    let max_x = start.x.max(end.x);
    if interpolated < min_x {
        min_x
    } else if interpolated > max_x {
        max_x
    } else {
        interpolated
    }
}

fn point_in_contours_with_fill_rule(
    contours: &[Contour],
    point: Point2D,
    fill_rule: &str,
    tolerance: GeometryTolerance,
) -> bool {
    let mut crossings = 0usize;
    let mut winding = 0i32;

    for contour in contours {
        let polyline = flatten_contour(contour, tolerance);
        if polyline.len() < 2 {
            continue;
        }
        for segment in polyline.windows(2) {
            let start = segment[0];
            let end = segment[1];
            if (start.y - point.y).abs() <= tolerance.position_epsilon
                && (end.y - point.y).abs() <= tolerance.position_epsilon
            {
                continue;
            }
            let straddles =
                (start.y <= point.y && end.y > point.y) || (start.y > point.y && end.y <= point.y);
            if !straddles {
                continue;
            }
            let t = (point.y - start.y) / (end.y - start.y);
            let x = start.x + (end.x - start.x) * t;
            if x <= point.x + tolerance.position_epsilon {
                continue;
            }
            crossings += 1;
            if end.y > start.y {
                winding += 1;
            } else {
                winding -= 1;
            }
        }
    }

    match fill_rule {
        "evenodd" => crossings % 2 == 1,
        _ => winding != 0,
    }
}

#[cfg(test)]
fn intersect_curve_segments(
    left: &CurveSegment,
    right: &CurveSegment,
    tolerance: GeometryTolerance,
) -> Vec<CurveIntersection> {
    intersect_curve_segments_with_bboxes(left, right, left.bbox(), right.bbox(), tolerance)
}

fn intersect_curve_segments_with_bboxes(
    left: &CurveSegment,
    right: &CurveSegment,
    left_bbox: BBox,
    right_bbox: BBox,
    tolerance: GeometryTolerance,
) -> Vec<CurveIntersection> {
    if !left_bbox.intersects(right_bbox, tolerance.bbox_epsilon) {
        return Vec::new();
    }
    let mut intersections = Vec::new();
    record_shared_endpoints(left, right, &mut intersections, tolerance);
    if let Some(line_left) = left.as_line() {
        if let Some(line_right) = right.as_line() {
            intersections.extend(line_line_intersections(line_left, line_right, tolerance));
            canonicalize_intersections(&mut intersections, left, right, tolerance);
            return intersections;
        }
        intersections.extend(line_curve_intersections(line_left, right, tolerance));
        canonicalize_intersections(&mut intersections, left, right, tolerance);
        return intersections;
    }
    if let Some(line_right) = right.as_line() {
        intersections.extend(
            line_curve_intersections(line_right, left, tolerance)
                .into_iter()
                .map(|intersection| CurveIntersection {
                    t_a: intersection.t_b,
                    t_b: intersection.t_a,
                }),
        );
        canonicalize_intersections(&mut intersections, left, right, tolerance);
        return intersections;
    }
    recurse_curve_intersections(
        left,
        right,
        CurveSubdivision {
            bbox: left_bbox,
            parameter_range: (0.0, 1.0),
        },
        CurveSubdivision {
            bbox: right_bbox,
            parameter_range: (0.0, 1.0),
        },
        0,
        tolerance,
        &mut intersections,
    );
    canonicalize_intersections(&mut intersections, left, right, tolerance);
    intersections
}

fn recurse_curve_intersections(
    left: &CurveSegment,
    right: &CurveSegment,
    left_subdivision: CurveSubdivision,
    right_subdivision: CurveSubdivision,
    depth: usize,
    tolerance: GeometryTolerance,
    out: &mut Vec<CurveIntersection>,
) {
    if !left_subdivision
        .bbox
        .intersects(right_subdivision.bbox, tolerance.bbox_epsilon)
    {
        return;
    }

    let left_flat = left.is_flat_enough(tolerance.flatness_epsilon);
    let right_flat = right.is_flat_enough(tolerance.flatness_epsilon);
    if depth >= tolerance.max_intersection_depth || (left_flat && right_flat) {
        for intersection in line_line_intersections(
            (left.start(), left.end()),
            (right.start(), right.end()),
            tolerance,
        ) {
            out.push(CurveIntersection {
                t_a: left_subdivision.parameter_range.0
                    + (left_subdivision.parameter_range.1 - left_subdivision.parameter_range.0)
                        * intersection.t_a,
                t_b: right_subdivision.parameter_range.0
                    + (right_subdivision.parameter_range.1 - right_subdivision.parameter_range.0)
                        * intersection.t_b,
            });
        }
        return;
    }

    if left_subdivision.bbox.max_dimension() >= right_subdivision.bbox.max_dimension() {
        let (left_first, left_second) = left.split(0.5);
        let mid = (left_subdivision.parameter_range.0 + left_subdivision.parameter_range.1) * 0.5;
        recurse_curve_intersections(
            &left_first,
            right,
            CurveSubdivision {
                bbox: left_first.bbox(),
                parameter_range: (left_subdivision.parameter_range.0, mid),
            },
            right_subdivision,
            depth + 1,
            tolerance,
            out,
        );
        recurse_curve_intersections(
            &left_second,
            right,
            CurveSubdivision {
                bbox: left_second.bbox(),
                parameter_range: (mid, left_subdivision.parameter_range.1),
            },
            right_subdivision,
            depth + 1,
            tolerance,
            out,
        );
    } else {
        let (right_first, right_second) = right.split(0.5);
        let mid = (right_subdivision.parameter_range.0 + right_subdivision.parameter_range.1) * 0.5;
        recurse_curve_intersections(
            left,
            &right_first,
            left_subdivision,
            CurveSubdivision {
                bbox: right_first.bbox(),
                parameter_range: (right_subdivision.parameter_range.0, mid),
            },
            depth + 1,
            tolerance,
            out,
        );
        recurse_curve_intersections(
            left,
            &right_second,
            left_subdivision,
            CurveSubdivision {
                bbox: right_second.bbox(),
                parameter_range: (mid, right_subdivision.parameter_range.1),
            },
            depth + 1,
            tolerance,
            out,
        );
    }
}

fn line_line_intersections(
    left: (Point2D, Point2D),
    right: (Point2D, Point2D),
    tolerance: GeometryTolerance,
) -> Vec<CurveIntersection> {
    let left_delta = subtract_points(left.1, left.0);
    let right_delta = subtract_points(right.1, right.0);
    let left_length = left_delta.x.hypot(left_delta.y);
    let right_length = right_delta.x.hypot(right_delta.y);
    if left_length == 0.0
        || right_length == 0.0
        || !left_length.is_finite()
        || !right_length.is_finite()
    {
        return Vec::new();
    }
    let left_direction = Point2D {
        x: left_delta.x / left_length,
        y: left_delta.y / left_length,
    };
    let right_direction = Point2D {
        x: right_delta.x / right_length,
        y: right_delta.y / right_length,
    };
    let direction_cross = cross(left_direction, right_direction);
    let right_start_distance = cross(subtract_points(right.0, left.0), left_direction).abs();
    let right_end_distance = cross(subtract_points(right.1, left.0), left_direction).abs();
    let left_start_distance = cross(subtract_points(left.0, right.0), right_direction).abs();
    let left_end_distance = cross(subtract_points(left.1, right.0), right_direction).abs();
    let maximum_line_distance = right_start_distance
        .max(right_end_distance)
        .max(left_start_distance)
        .max(left_end_distance);
    if maximum_line_distance <= tolerance.position_epsilon
        && direction_cross.abs() <= LINE_COLLINEAR_DIRECTION_EPSILON
    {
        let mut intersections = Vec::new();
        for point in [right.0, right.1] {
            if let (Some(t_a), Some(t_b)) = (
                parameter_on_line(left.0, left.1, point),
                parameter_on_line(right.0, right.1, point),
            ) {
                if parameter_within_segment(t_a, left_length, tolerance)
                    && parameter_within_segment(t_b, right_length, tolerance)
                {
                    intersections.push(CurveIntersection {
                        t_a: clamp_unit(t_a),
                        t_b: clamp_unit(t_b),
                    });
                }
            }
        }
        for point in [left.0, left.1] {
            if let (Some(t_a), Some(t_b)) = (
                parameter_on_line(left.0, left.1, point),
                parameter_on_line(right.0, right.1, point),
            ) {
                if parameter_within_segment(t_a, left_length, tolerance)
                    && parameter_within_segment(t_b, right_length, tolerance)
                {
                    intersections.push(CurveIntersection {
                        t_a: clamp_unit(t_a),
                        t_b: clamp_unit(t_b),
                    });
                }
            }
        }
        return intersections;
    }

    if direction_cross.abs() <= LINE_PARALLEL_DIRECTION_EPSILON {
        return Vec::new();
    }

    let offset = subtract_points(right.0, left.0);
    let t_a = cross(offset, right_direction) / (direction_cross * left_length);
    let t_b = cross(offset, left_direction) / (direction_cross * right_length);
    if parameter_within_segment(t_a, left_length, tolerance)
        && parameter_within_segment(t_b, right_length, tolerance)
    {
        vec![CurveIntersection {
            t_a: clamp_unit(t_a),
            t_b: clamp_unit(t_b),
        }]
    } else {
        Vec::new()
    }
}

fn parameter_on_line(start: Point2D, end: Point2D, point: Point2D) -> Option<f64> {
    let delta = subtract_points(end, start);
    if delta.x.abs() >= delta.y.abs() {
        if delta.x == 0.0 {
            return None;
        }
        Some((point.x - start.x) / delta.x)
    } else {
        Some((point.y - start.y) / delta.y)
    }
}

fn parameter_within_segment(
    parameter: f64,
    segment_length: f64,
    tolerance: GeometryTolerance,
) -> bool {
    if !parameter.is_finite() || !segment_length.is_finite() || segment_length <= 0.0 {
        return false;
    }
    let parameter_slack = tolerance
        .parameter_epsilon
        .min(tolerance.position_epsilon / segment_length);
    (-parameter_slack..=1.0 + parameter_slack).contains(&parameter)
}

fn line_quadratic_roots(
    line: (Point2D, Point2D),
    p0: Point2D,
    p1: Point2D,
    p2: Point2D,
    tolerance: GeometryTolerance,
) -> Vec<f64> {
    let line_delta = subtract_points(line.1, line.0);
    let local_p0 = subtract_points(p0, line.0);
    let local_p1 = subtract_points(p1, line.0);
    let local_p2 = subtract_points(p2, line.0);
    let a = add_points(add_points(local_p0, local_p2), scale_point(local_p1, -2.0));
    let b = scale_point(subtract_points(local_p1, local_p0), 2.0);
    let c = local_p0;
    let line_delta_absolute_terms = weighted_absolute_point_sum(&[(2.0, line_delta)]);
    let raw_coefficient_roundoff = [
        cross_product_error_bound(
            a,
            weighted_absolute_point_sum(&[(1.0, local_p0), (1.0, local_p2), (2.0, local_p1)]),
            line_delta,
            line_delta_absolute_terms,
        ),
        cross_product_error_bound(
            b,
            weighted_absolute_point_sum(&[(2.0, local_p1), (2.0, local_p0)]),
            line_delta,
            line_delta_absolute_terms,
        ),
        cross_product_error_bound(
            c,
            weighted_absolute_point_sum(&[(2.0, local_p0)]),
            line_delta,
            line_delta_absolute_terms,
        ),
    ];
    solve_quadratic_roots_with_coefficient_roundoff(
        cross(a, line_delta),
        cross(b, line_delta),
        cross(c, line_delta),
        raw_coefficient_roundoff,
        tolerance.parameter_epsilon,
    )
}

fn line_curve_intersections(
    line: (Point2D, Point2D),
    curve: &CurveSegment,
    tolerance: GeometryTolerance,
) -> Vec<CurveIntersection> {
    match curve {
        CurveSegment::Line { .. } => Vec::new(),
        CurveSegment::Quad { p0, p1, p2 } => {
            let roots = line_quadratic_roots(line, *p0, *p1, *p2, tolerance);
            roots
                .into_iter()
                .filter_map(|t_curve| {
                    let point = curve.eval(t_curve);
                    let t_line = parameter_on_segment(line, point, tolerance)?;
                    Some(CurveIntersection {
                        t_a: t_line,
                        t_b: t_curve,
                    })
                })
                .collect()
        }
        CurveSegment::Cubic { p0, p1, p2, p3 } => {
            let line_delta = subtract_points(line.1, line.0);
            // Form the power-basis vectors in line-local coordinates. Their
            // mathematical values are translation-invariant, and removing the
            // common offset keeps both their f64 error and its bound invariant too.
            let local_p0 = subtract_points(*p0, line.0);
            let local_p1 = subtract_points(*p1, line.0);
            let local_p2 = subtract_points(*p2, line.0);
            let local_p3 = subtract_points(*p3, line.0);
            let a = add_points(
                add_points(scale_point(local_p1, 3.0), local_p3),
                add_points(scale_point(local_p0, -1.0), scale_point(local_p2, -3.0)),
            );
            let b = add_points(
                add_points(scale_point(local_p0, 3.0), scale_point(local_p2, 3.0)),
                scale_point(local_p1, -6.0),
            );
            let c = scale_point(subtract_points(local_p1, local_p0), 3.0);
            let d_vector = local_p0;
            let line_delta_absolute_terms = weighted_absolute_point_sum(&[(2.0, line_delta)]);
            let raw_coefficient_roundoff = [
                cross_product_error_bound(
                    a,
                    weighted_absolute_point_sum(&[
                        (3.0, local_p1),
                        (1.0, local_p3),
                        (1.0, local_p0),
                        (3.0, local_p2),
                    ]),
                    line_delta,
                    line_delta_absolute_terms,
                ),
                cross_product_error_bound(
                    b,
                    weighted_absolute_point_sum(&[
                        (3.0, local_p0),
                        (3.0, local_p2),
                        (6.0, local_p1),
                    ]),
                    line_delta,
                    line_delta_absolute_terms,
                ),
                cross_product_error_bound(
                    c,
                    weighted_absolute_point_sum(&[(3.0, local_p1), (3.0, local_p0)]),
                    line_delta,
                    line_delta_absolute_terms,
                ),
                cross_product_error_bound(
                    d_vector,
                    weighted_absolute_point_sum(&[(2.0, local_p0)]),
                    line_delta,
                    line_delta_absolute_terms,
                ),
            ];
            let raw_coefficients = [
                cross(a, line_delta),
                cross(b, line_delta),
                cross(c, line_delta),
                cross(d_vector, line_delta),
            ];
            let accurate_coefficients =
                accurate_cubic_line_coefficients(line, [*p0, *p1, *p2, *p3]);
            let roots = solve_cubic_roots_with_accurate_coefficients(
                raw_coefficients,
                accurate_coefficients,
                raw_coefficient_roundoff,
                tolerance,
            );
            roots
                .into_iter()
                .filter_map(|t_curve| {
                    let point = curve.eval(t_curve);
                    let t_line = parameter_on_segment(line, point, tolerance)?;
                    Some(CurveIntersection {
                        t_a: t_line,
                        t_b: t_curve,
                    })
                })
                .collect()
        }
    }
}

fn parameter_on_segment(
    segment: (Point2D, Point2D),
    point: Point2D,
    tolerance: GeometryTolerance,
) -> Option<f64> {
    let delta = subtract_points(segment.1, segment.0);
    let length = delta.x.hypot(delta.y);
    if length == 0.0 || !length.is_finite() {
        return None;
    }
    let direction = Point2D {
        x: delta.x / length,
        y: delta.y / length,
    };
    let to_point = subtract_points(point, segment.0);
    let projected_distance = dot(to_point, direction);
    let projected = projected_distance / length;
    let closest = Point2D {
        x: segment.0.x + direction.x * projected_distance,
        y: segment.0.y + direction.y * projected_distance,
    };
    // Analytic curve roots are approximate; retain a two-sample-wide absolute
    // band before accepting their projection onto the finite line segment.
    if point_distance(point, closest) <= tolerance.sample_epsilon * 2.0
        && parameter_within_segment(projected, length, tolerance)
    {
        Some(clamp_unit(projected))
    } else {
        None
    }
}

#[cfg(test)]
fn solve_quadratic_roots(a: f64, b: f64, c: f64, epsilon: f64) -> Vec<f64> {
    solve_quadratic_roots_with_coefficient_roundoff(a, b, c, [0.0; 3], epsilon)
}

fn normalized_coefficient_zero_bound(roundoff: f64) -> f64 {
    roundoff + f64::EPSILON * 8.0
}

fn solve_quadratic_roots_with_coefficient_roundoff(
    a: f64,
    b: f64,
    c: f64,
    raw_coefficient_roundoff: [f64; 3],
    epsilon: f64,
) -> Vec<f64> {
    let mut roots = Vec::new();
    if !a.is_finite()
        || !b.is_finite()
        || !c.is_finite()
        || raw_coefficient_roundoff
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0)
    {
        return roots;
    }
    let coefficient_scale = a.abs().max(b.abs()).max(c.abs());
    if coefficient_scale == 0.0 {
        return roots;
    }
    let a = a / coefficient_scale;
    let b = b / coefficient_scale;
    let c = c / coefficient_scale;
    let coefficient_roundoff = raw_coefficient_roundoff.map(|value| value / coefficient_scale);
    if coefficient_roundoff.iter().any(|value| !value.is_finite()) {
        return roots;
    }
    if a.abs() <= normalized_coefficient_zero_bound(coefficient_roundoff[0]) {
        if b.abs() <= normalized_coefficient_zero_bound(coefficient_roundoff[1]) {
            return roots;
        }
        let root = -c / b;
        if (-epsilon..=1.0 + epsilon).contains(&root) {
            roots.push(clamp_unit(root));
        }
        return roots;
    }
    let discriminant = b * b - 4.0 * a * c;
    let discriminant_roundoff = 2.0 * b.abs() * coefficient_roundoff[1]
        + coefficient_roundoff[1] * coefficient_roundoff[1]
        + 4.0
            * (a.abs() * coefficient_roundoff[2]
                + c.abs() * coefficient_roundoff[0]
                + coefficient_roundoff[0] * coefficient_roundoff[2])
        + (b * b).abs().max((4.0 * a * c).abs()).max(1.0) * f64::EPSILON * 16.0;
    if !discriminant_roundoff.is_finite() {
        return roots;
    }
    if discriminant < -discriminant_roundoff {
        return roots;
    }
    if discriminant.abs() <= discriminant_roundoff {
        let root = -b / (2.0 * a);
        if (-epsilon..=1.0 + epsilon).contains(&root) {
            roots.push(clamp_unit(root));
        }
        return roots;
    }
    let sqrt_discriminant = discriminant.sqrt();
    let stable_numerator = -0.5 * (b + sqrt_discriminant.copysign(b));
    let root1 = stable_numerator / a;
    let root2 = c / stable_numerator;
    for root in [root1, root2] {
        if (-epsilon..=1.0 + epsilon).contains(&root) {
            roots.push(clamp_unit(root));
        }
    }
    roots.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    roots.dedup_by(|left, right| *left == *right);
    roots
}

fn solve_cubic_derivative_roots(
    a: f64,
    b: f64,
    c: f64,
    coefficient_roundoff: [f64; 4],
    parameter_epsilon: f64,
) -> Vec<f64> {
    solve_quadratic_roots_with_coefficient_roundoff(
        3.0 * a,
        2.0 * b,
        c,
        [
            coefficient_roundoff[0] * 3.0,
            coefficient_roundoff[1] * 2.0,
            coefficient_roundoff[2],
        ],
        parameter_epsilon,
    )
}

#[derive(Clone, Copy)]
struct DoubleDouble {
    high: f64,
    low: f64,
}

impl DoubleDouble {
    fn from_f64(value: f64) -> Self {
        Self {
            high: value,
            low: 0.0,
        }
    }

    fn normalized(high: f64, low: f64) -> Self {
        let sum = high + low;
        let virtual_low = sum - high;
        let error = (high - (sum - virtual_low)) + (low - virtual_low);
        Self {
            high: sum,
            low: error,
        }
    }

    fn add(self, other: Self) -> Self {
        let high_sum = Self::normalized(self.high, other.high);
        let low_sum = Self::normalized(self.low, other.low);
        let combined_low = high_sum.low + low_sum.high;
        let first_normalization = Self::normalized(high_sum.high, combined_low);
        Self::normalized(
            first_normalization.high,
            first_normalization.low + low_sum.low,
        )
    }

    fn subtract(self, other: Self) -> Self {
        self.add(Self {
            high: -other.high,
            low: -other.low,
        })
    }

    fn multiply(self, other: Self) -> Self {
        let product = self.high * other.high;
        let product_error = self.high.mul_add(other.high, -product);
        let cross_terms = self.high * other.low + self.low * other.high + self.low * other.low;
        Self::normalized(product, product_error + cross_terms)
    }

    fn scale(self, factor: f64) -> Self {
        self.multiply(Self::from_f64(factor))
    }

    fn value(self) -> f64 {
        self.high + self.low
    }

    fn signum(self) -> f64 {
        if self.high == 0.0 {
            self.low.signum()
        } else {
            self.high.signum()
        }
    }

    fn is_zero(self) -> bool {
        self.high == 0.0 && self.low == 0.0
    }

    fn is_finite(self) -> bool {
        self.high.is_finite() && self.low.is_finite()
    }

    fn magnitude(self) -> f64 {
        self.high.abs() + self.low.abs()
    }
}

#[derive(Clone, Copy)]
struct AccurateCubicCoefficients {
    values: [DoubleDouble; 4],
    operand_magnitudes: [f64; 4],
}

impl AccurateCubicCoefficients {
    #[cfg(test)]
    fn from_f64(coefficients: [f64; 4]) -> Self {
        Self {
            values: coefficients.map(DoubleDouble::from_f64),
            operand_magnitudes: [0.0; 4],
        }
    }
}

fn accurate_cubic_line_coefficients(
    line: (Point2D, Point2D),
    control_points: [Point2D; 4],
) -> Option<AccurateCubicCoefficients> {
    let line_delta_x = DoubleDouble::from_f64(line.1.x).subtract(DoubleDouble::from_f64(line.0.x));
    let line_delta_y = DoubleDouble::from_f64(line.1.y).subtract(DoubleDouble::from_f64(line.0.y));
    let local_points = control_points.map(|point| {
        let local_x = DoubleDouble::from_f64(point.x).subtract(DoubleDouble::from_f64(line.0.x));
        let local_y = DoubleDouble::from_f64(point.y).subtract(DoubleDouble::from_f64(line.0.y));
        (local_x, local_y)
    });
    let line_values = local_points.map(|(local_x, local_y)| {
        local_x
            .multiply(line_delta_y)
            .subtract(local_y.multiply(line_delta_x))
    });
    let line_operand_magnitudes = local_points.map(|(local_x, local_y)| {
        local_x.magnitude() * line_delta_y.magnitude()
            + local_y.magnitude() * line_delta_x.magnitude()
    });
    let coefficients = [
        line_values[1]
            .scale(3.0)
            .add(line_values[3])
            .subtract(line_values[0])
            .subtract(line_values[2].scale(3.0)),
        line_values[0]
            .scale(3.0)
            .add(line_values[2].scale(3.0))
            .subtract(line_values[1].scale(6.0)),
        line_values[1].subtract(line_values[0]).scale(3.0),
        line_values[0],
    ];
    let operand_magnitudes = [
        line_operand_magnitudes[1] * 3.0
            + line_operand_magnitudes[3]
            + line_operand_magnitudes[0]
            + line_operand_magnitudes[2] * 3.0,
        line_operand_magnitudes[0] * 3.0
            + line_operand_magnitudes[2] * 3.0
            + line_operand_magnitudes[1] * 6.0,
        (line_operand_magnitudes[1] + line_operand_magnitudes[0]) * 3.0,
        line_operand_magnitudes[0],
    ];
    (coefficients
        .iter()
        .all(|coefficient| coefficient.is_finite())
        && operand_magnitudes
            .iter()
            .all(|magnitude| magnitude.is_finite()))
    .then_some(AccurateCubicCoefficients {
        values: coefficients,
        operand_magnitudes,
    })
}

fn evaluate_cubic_double_double(coefficients: [DoubleDouble; 4], parameter: f64) -> DoubleDouble {
    let parameter = DoubleDouble::from_f64(parameter);
    coefficients[0]
        .multiply(parameter)
        .add(coefficients[1])
        .multiply(parameter)
        .add(coefficients[2])
        .multiply(parameter)
        .add(coefficients[3])
}

fn double_double_cubic_roundoff(
    coefficients: [DoubleDouble; 4],
    coefficient_operand_magnitudes: [f64; 4],
    parameter: f64,
) -> f64 {
    let absolute_parameter = parameter.abs();
    let term_magnitude = ((coefficients[0].value().abs() * absolute_parameter
        + coefficients[1].value().abs())
        * absolute_parameter
        + coefficients[2].value().abs())
        * absolute_parameter
        + coefficients[3].value().abs();
    let propagated_operand_magnitude = ((coefficient_operand_magnitudes[0] * absolute_parameter
        + coefficient_operand_magnitudes[1])
        * absolute_parameter
        + coefficient_operand_magnitudes[2])
        * absolute_parameter
        + coefficient_operand_magnitudes[3];
    (term_magnitude * f64::EPSILON * f64::EPSILON * 128.0
        + propagated_operand_magnitude * f64::EPSILON * f64::EPSILON * 32.0)
        .max(f64::MIN_POSITIVE)
}

fn refine_cubic_derivative_root(coefficients: [DoubleDouble; 4], initial: f64) -> f64 {
    let derivative_coefficients = [
        coefficients[0].scale(3.0),
        coefficients[1].scale(2.0),
        coefficients[2],
    ];
    let mut parameter = initial;
    for _ in 0..32 {
        let parameter_value = DoubleDouble::from_f64(parameter);
        let value = derivative_coefficients[0]
            .multiply(parameter_value)
            .add(derivative_coefficients[1])
            .multiply(parameter_value)
            .add(derivative_coefficients[2]);
        let slope = derivative_coefficients[0]
            .scale(2.0)
            .multiply(parameter_value)
            .add(derivative_coefficients[1]);
        let slope = slope.value();
        if slope == 0.0 || !slope.is_finite() {
            break;
        }
        let refined = parameter - value.value() / slope;
        if !refined.is_finite() || refined == parameter {
            break;
        }
        parameter = refined;
    }
    clamp_unit(parameter)
}

fn solve_clustered_cubic_roots(
    raw_coefficients: [f64; 4],
    accurate_coefficients: AccurateCubicCoefficients,
    raw_coefficient_roundoff: [f64; 4],
    derivative_roots: &[f64],
) -> Vec<f64> {
    let maximum_coefficient = raw_coefficients
        .iter()
        .fold(0.0_f64, |maximum, coefficient| {
            maximum.max(coefficient.abs())
        });
    let coefficient_scale = power_of_two_normalization_scale(maximum_coefficient);
    let scale_reciprocal = coefficient_scale.recip();
    let coefficients = accurate_coefficients
        .values
        .map(|coefficient| coefficient.scale(scale_reciprocal));
    let coefficient_operand_magnitudes = accurate_coefficients
        .operand_magnitudes
        .map(|magnitude| magnitude / coefficient_scale);
    let rounded_coefficients = raw_coefficients.map(|coefficient| coefficient / coefficient_scale);
    let coefficient_roundoff =
        raw_coefficient_roundoff.map(|roundoff| roundoff / coefficient_scale);
    let mut refined_derivative_roots = derivative_roots
        .iter()
        .map(|root| refine_cubic_derivative_root(coefficients, *root))
        .collect::<Vec<_>>();
    refined_derivative_roots
        .sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    refined_derivative_roots.dedup_by(|left, right| *left == *right);
    let mut breakpoints = Vec::with_capacity(refined_derivative_roots.len() + 2);
    breakpoints.push(0.0);
    breakpoints.extend(refined_derivative_roots);
    breakpoints.push(1.0);
    breakpoints.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    breakpoints.dedup_by(|left, right| *left == *right);

    let values = breakpoints
        .iter()
        .map(|parameter| evaluate_cubic_double_double(coefficients, *parameter))
        .collect::<Vec<_>>();
    let mut breakpoint_is_root = vec![false; breakpoints.len()];
    let mut roots = Vec::new();
    for (index, (parameter, value)) in breakpoints.iter().zip(&values).enumerate() {
        let is_endpoint = index == 0 || index + 1 == breakpoints.len();
        // Preserve the existing geometric uncertainty band at finite-segment
        // endpoints. At interior extrema, use the compensated Horner bound:
        // the ordinary f64 bound is wider than three spatially distinct roots
        // can be in polynomial space. Candidate points are still checked
        // against the source line by parameter_on_segment before publication.
        let zero_bound = if is_endpoint {
            cubic_polynomial_roundoff(rounded_coefficients, coefficient_roundoff, *parameter)
        } else {
            double_double_cubic_roundoff(coefficients, coefficient_operand_magnitudes, *parameter)
        };
        if value.value().abs() <= zero_bound {
            breakpoint_is_root[index] = true;
            roots.push(*parameter);
        }
    }

    for index in 0..breakpoints.len() - 1 {
        if breakpoint_is_root[index] || breakpoint_is_root[index + 1] {
            continue;
        }
        let mut left = breakpoints[index];
        let mut right = breakpoints[index + 1];
        let mut left_value = values[index];
        if left_value.signum() == values[index + 1].signum() {
            continue;
        }
        for _ in 0..64 {
            let middle = (left + right) * 0.5;
            let middle_value = evaluate_cubic_double_double(coefficients, middle);
            if middle == left || middle == right || middle_value.is_zero() {
                left = middle;
                right = middle;
                break;
            }
            if left_value.signum() == middle_value.signum() {
                left = middle;
                left_value = middle_value;
            } else {
                right = middle;
            }
        }
        roots.push((left + right) * 0.5);
    }

    for root in &mut roots {
        *root = clamp_unit(*root);
    }
    roots.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    roots.dedup_by(|left, right| *left == *right);
    roots
}

fn solve_accurate_cubic_derivative_roots(
    raw_coefficients: [f64; 4],
    accurate_coefficients: AccurateCubicCoefficients,
    parameter_epsilon: f64,
) -> Vec<f64> {
    let maximum_coefficient = raw_coefficients
        .iter()
        .fold(0.0_f64, |maximum, coefficient| {
            maximum.max(coefficient.abs())
        });
    let coefficient_scale = power_of_two_normalization_scale(maximum_coefficient);
    let scale_reciprocal = coefficient_scale.recip();
    let [a, b, c, _] = accurate_coefficients
        .values
        .map(|coefficient| coefficient.scale(scale_reciprocal).value());
    // These f64 roots only seed the compensated Newton refinement. The
    // quadratic discriminant floor leaves clusters below roughly 2e-8 outside
    // this recovery path; spatially distinct cases above it are refined there.
    solve_cubic_derivative_roots(a, b, c, [0.0; 4], parameter_epsilon)
}

#[cfg(test)]
fn solve_cubic_roots(a: f64, b: f64, c: f64, d: f64, tolerance: GeometryTolerance) -> Vec<f64> {
    solve_cubic_roots_with_coefficient_roundoff(a, b, c, d, [0.0; 4], tolerance)
}

fn cubic_polynomial_roundoff(
    coefficients: [f64; 4],
    coefficient_roundoff: [f64; 4],
    parameter: f64,
) -> f64 {
    let absolute_parameter = parameter.abs();
    let term_magnitude = ((coefficients[0].abs() * absolute_parameter + coefficients[1].abs())
        * absolute_parameter
        + coefficients[2].abs())
        * absolute_parameter
        + coefficients[3].abs();
    let propagated_coefficient_roundoff = ((coefficient_roundoff[0] * absolute_parameter
        + coefficient_roundoff[1])
        * absolute_parameter
        + coefficient_roundoff[2])
        * absolute_parameter
        + coefficient_roundoff[3];
    term_magnitude.max(1.0) * f64::EPSILON * 16.0 + propagated_coefficient_roundoff
}

fn power_of_two_normalization_scale(maximum_magnitude: f64) -> f64 {
    let exponent_bits = maximum_magnitude.to_bits() & (0x7ff_u64 << 52);
    if exponent_bits == 0 {
        f64::MIN_POSITIVE
    } else {
        f64::from_bits(exponent_bits)
    }
}

#[cfg(test)]
fn solve_cubic_roots_with_coefficient_roundoff(
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    raw_coefficient_roundoff: [f64; 4],
    tolerance: GeometryTolerance,
) -> Vec<f64> {
    solve_cubic_roots_with_accurate_coefficients(
        [a, b, c, d],
        Some(AccurateCubicCoefficients::from_f64([a, b, c, d])),
        raw_coefficient_roundoff,
        tolerance,
    )
}

fn cubic_solver_inputs_are_valid(
    raw_coefficients: [f64; 4],
    accurate_coefficients: Option<AccurateCubicCoefficients>,
    coefficient_roundoff: [f64; 4],
) -> bool {
    let accurate_coefficients_are_valid = accurate_coefficients.is_none_or(|coefficients| {
        coefficients
            .values
            .iter()
            .all(|coefficient| coefficient.is_finite())
            && coefficients
                .operand_magnitudes
                .iter()
                .all(|magnitude| magnitude.is_finite() && *magnitude >= 0.0)
    });
    raw_coefficients
        .iter()
        .all(|coefficient| coefficient.is_finite())
        && accurate_coefficients_are_valid
        && coefficient_roundoff
            .iter()
            .all(|roundoff| roundoff.is_finite() && *roundoff >= 0.0)
}

fn solve_cubic_roots_from_breakpoints(
    coefficients: [f64; 4],
    coefficient_roundoff: [f64; 4],
    mut breakpoints: Vec<f64>,
    parameter_epsilon: f64,
) -> Vec<f64> {
    let [a, b, c, d] = coefficients;
    let polynomial = |parameter: f64| ((a * parameter + b) * parameter + c) * parameter + d;
    let polynomial_roundoff =
        |parameter: f64| cubic_polynomial_roundoff(coefficients, coefficient_roundoff, parameter);
    breakpoints.push(0.0);
    breakpoints.push(1.0);
    breakpoints.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    breakpoints.dedup_by(|left, right| (*left - *right).abs() <= parameter_epsilon);

    let mut roots = breakpoints
        .iter()
        .filter(|root| polynomial(**root).abs() <= polynomial_roundoff(**root))
        .map(|root| clamp_unit(*root))
        .collect::<Vec<_>>();
    for window in breakpoints.windows(2) {
        let mut left = window[0];
        let mut right = window[1];
        let mut left_value = polynomial(left);
        let right_value = polynomial(right);
        if left_value.abs() <= polynomial_roundoff(left)
            || right_value.abs() <= polynomial_roundoff(right)
            || left_value.signum() == right_value.signum()
        {
            continue;
        }
        // A parameter-only stopping threshold turns into an unbounded spatial
        // residual as coordinates grow. Refine to f64 stagnation instead.
        for _ in 0..64 {
            let middle = (left + right) * 0.5;
            let middle_value = polynomial(middle);
            if middle == left || middle == right || middle_value == 0.0 {
                left = middle;
                right = middle;
                break;
            }
            if left_value.signum() == middle_value.signum() {
                left = middle;
                left_value = middle_value;
            } else {
                right = middle;
            }
        }
        roots.push(clamp_unit((left + right) * 0.5));
    }
    roots.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    // Breakpoint roots skip both adjacent windows; every other window has one
    // strict sign change. The roots are distinct by construction and must not
    // be tolerance-deduped here.
    roots
}

fn solve_cubic_roots_with_accurate_coefficients(
    raw_coefficients: [f64; 4],
    accurate_coefficients: Option<AccurateCubicCoefficients>,
    raw_coefficient_roundoff: [f64; 4],
    tolerance: GeometryTolerance,
) -> Vec<f64> {
    if !cubic_solver_inputs_are_valid(
        raw_coefficients,
        accurate_coefficients,
        raw_coefficient_roundoff,
    ) {
        return Vec::new();
    }
    let [a, b, c, d] = raw_coefficients;
    let coefficient_scale = a.abs().max(b.abs()).max(c.abs()).max(d.abs());
    if coefficient_scale == 0.0 {
        return Vec::new();
    }
    let clustered_coefficients = [a, b, c, d];
    let clustered_coefficient_roundoff = raw_coefficient_roundoff;
    let a = a / coefficient_scale;
    let b = b / coefficient_scale;
    let c = c / coefficient_scale;
    let d = d / coefficient_scale;
    let coefficient_roundoff = raw_coefficient_roundoff.map(|value| value / coefficient_scale);
    // Production bounds are scale-coupled to these coefficients. Keep a
    // defensive check here so future callers cannot turn an oversized finite
    // bound into an infinite zero-acceptance threshold during normalization.
    if coefficient_roundoff.iter().any(|value| !value.is_finite()) {
        return Vec::new();
    }
    let cubic_coefficient_zero_bound = normalized_coefficient_zero_bound(coefficient_roundoff[0]);
    if a.abs() <= cubic_coefficient_zero_bound {
        return solve_quadratic_roots_with_coefficient_roundoff(
            b,
            c,
            d,
            [
                coefficient_roundoff[1],
                coefficient_roundoff[2],
                coefficient_roundoff[3],
            ],
            tolerance.parameter_epsilon,
        );
    }

    let polynomial = |t: f64| ((a * t + b) * t + c) * t + d;
    // The helper bounds normalized Horner evaluation and propagates the
    // line-local cross-product coefficient cancellation error.
    let polynomial_roundoff =
        |t: f64| cubic_polynomial_roundoff([a, b, c, d], coefficient_roundoff, t);
    let derivative_roots =
        solve_cubic_derivative_roots(a, b, c, coefficient_roundoff, tolerance.parameter_epsilon);
    if let Some(accurate_coefficients) = accurate_coefficients {
        let accurate_derivative_roots = solve_accurate_cubic_derivative_roots(
            clustered_coefficients,
            accurate_coefficients,
            tolerance.parameter_epsilon,
        );
        let clustered_derivative_roots = if accurate_derivative_roots.len() == 2 {
            &accurate_derivative_roots
        } else {
            &derivative_roots
        };
        let clustered_or_ambiguous_extrema = clustered_derivative_roots.len() == 2
            && (clustered_derivative_roots[1] - clustered_derivative_roots[0]
                <= tolerance.parameter_epsilon
                || clustered_derivative_roots
                    .iter()
                    .all(|root| polynomial(*root).abs() <= polynomial_roundoff(*root)));
        if clustered_or_ambiguous_extrema {
            return solve_clustered_cubic_roots(
                clustered_coefficients,
                accurate_coefficients,
                clustered_coefficient_roundoff,
                clustered_derivative_roots,
            );
        }
    }
    solve_cubic_roots_from_breakpoints(
        [a, b, c, d],
        coefficient_roundoff,
        derivative_roots,
        tolerance.parameter_epsilon,
    )
}

fn canonicalize_parameters(
    values: &mut Vec<f64>,
    segment: &CurveSegment,
    tolerance: GeometryTolerance,
) {
    for value in values.iter_mut() {
        *value = clamp_unit(*value);
    }
    values.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    values.dedup_by(|left, right| {
        (*left - *right).abs() <= tolerance.parameter_epsilon
            && points_close(
                segment.eval(*left),
                segment.eval(*right),
                tolerance.position_epsilon,
            )
    });
}

fn canonicalize_intersections(
    values: &mut Vec<CurveIntersection>,
    left_segment: &CurveSegment,
    right_segment: &CurveSegment,
    tolerance: GeometryTolerance,
) {
    for value in values.iter_mut() {
        value.t_a = clamp_unit(value.t_a);
        value.t_b = clamp_unit(value.t_b);
    }
    values.sort_by(|left, right| {
        left.t_a
            .partial_cmp(&right.t_a)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                left.t_b
                    .partial_cmp(&right.t_b)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });
    values.dedup_by(|left, right| {
        (left.t_a - right.t_a).abs() <= tolerance.parameter_epsilon
            && (left.t_b - right.t_b).abs() <= tolerance.parameter_epsilon
            && points_close(
                left_segment.eval(left.t_a),
                left_segment.eval(right.t_a),
                tolerance.position_epsilon,
            )
            && points_close(
                right_segment.eval(left.t_b),
                right_segment.eval(right.t_b),
                tolerance.position_epsilon,
            )
    });
}

fn canonicalize_geometry_intersections(
    values: &mut Vec<GeometryIntersection>,
    tolerance: GeometryTolerance,
) {
    values.sort_by(|left, right| {
        point_key(left.point, tolerance)
            .cmp(&point_key(right.point, tolerance))
            .then_with(|| left.contour_index_a.cmp(&right.contour_index_a))
            .then_with(|| left.segment_index_a.cmp(&right.segment_index_a))
            .then_with(|| left.contour_index_b.cmp(&right.contour_index_b))
            .then_with(|| left.segment_index_b.cmp(&right.segment_index_b))
            .then_with(|| {
                quantize_number(left.t_a, tolerance.parameter_epsilon)
                    .cmp(&quantize_number(right.t_a, tolerance.parameter_epsilon))
            })
            .then_with(|| {
                quantize_number(left.t_b, tolerance.parameter_epsilon)
                    .cmp(&quantize_number(right.t_b, tolerance.parameter_epsilon))
            })
    });
    values.dedup_by(|left, right| {
        points_close(left.point, right.point, tolerance.position_epsilon)
            && left.contour_index_a == right.contour_index_a
            && left.segment_index_a == right.segment_index_a
            && left.contour_index_b == right.contour_index_b
            && left.segment_index_b == right.segment_index_b
            && (left.t_a - right.t_a).abs() <= tolerance.parameter_epsilon
            && (left.t_b - right.t_b).abs() <= tolerance.parameter_epsilon
    });
}

fn record_shared_endpoints(
    left: &CurveSegment,
    right: &CurveSegment,
    out: &mut Vec<CurveIntersection>,
    tolerance: GeometryTolerance,
) {
    let left_start = left.start();
    let left_end = left.end();
    let right_start = right.start();
    let right_end = right.end();

    if points_close(left_start, right_start, tolerance.position_epsilon) {
        out.push(CurveIntersection { t_a: 0.0, t_b: 0.0 });
    }
    if points_close(left_start, right_end, tolerance.position_epsilon) {
        out.push(CurveIntersection { t_a: 0.0, t_b: 1.0 });
    }
    if points_close(left_end, right_start, tolerance.position_epsilon) {
        out.push(CurveIntersection { t_a: 1.0, t_b: 0.0 });
    }
    if points_close(left_end, right_end, tolerance.position_epsilon) {
        out.push(CurveIntersection { t_a: 1.0, t_b: 1.0 });
    }
}

fn bake_region_to_viewport(
    region: &Region,
    view_box: &GeometryViewBox,
    viewport: Option<&GeometryViewport>,
    paint: Option<&GeometryPaint>,
    preserve_aspect_ratio: GeometryPreserveAspectRatio,
) -> Region {
    let target_width = viewport.map_or(view_box.width, |value| value.width);
    let target_height = viewport.map_or(view_box.height, |value| value.height);
    let stroke_padding = stroke_padding(paint);
    let inner_width = (target_width - stroke_padding * 2.0).max(0.0);
    let inner_height = (target_height - stroke_padding * 2.0).max(0.0);
    let source_width = if view_box.width == 0.0 {
        1.0
    } else {
        view_box.width
    };
    let source_height = if view_box.height == 0.0 {
        1.0
    } else {
        view_box.height
    };
    let unconstrained_scale_x = inner_width / source_width;
    let unconstrained_scale_y = inner_height / source_height;
    let (scale_x, scale_y) = aspect_ratio_scales(
        unconstrained_scale_x,
        unconstrained_scale_y,
        preserve_aspect_ratio,
    );
    let matrix = AffineMatrix {
        a: scale_x,
        b: 0.0,
        c: 0.0,
        d: scale_y,
        e: stroke_padding + (inner_width - source_width * scale_x) * 0.5 - view_box.x * scale_x,
        f: stroke_padding + (inner_height - source_height * scale_y) * 0.5 - view_box.y * scale_y,
    };
    transform_region(region, matrix)
}

fn aspect_ratio_scales(
    scale_x: f64,
    scale_y: f64,
    preserve_aspect_ratio: GeometryPreserveAspectRatio,
) -> (f64, f64) {
    match preserve_aspect_ratio {
        GeometryPreserveAspectRatio::None => (scale_x, scale_y),
        GeometryPreserveAspectRatio::Meet => {
            let uniform_scale = scale_x.min(scale_y);
            (uniform_scale, uniform_scale)
        }
        GeometryPreserveAspectRatio::Slice => {
            let uniform_scale = scale_x.max(scale_y);
            (uniform_scale, uniform_scale)
        }
    }
}

fn fit_region_to_target_box(
    region: &Region,
    source_bbox: &BBox,
    target_width: f64,
    target_height: f64,
    paint: Option<&GeometryPaint>,
    preserve_aspect_ratio: GeometryPreserveAspectRatio,
) -> Region {
    let stroke_padding = stroke_padding(paint);
    let inner_width = (target_width - stroke_padding * 2.0).max(0.0);
    let inner_height = (target_height - stroke_padding * 2.0).max(0.0);
    let source_width = (source_bbox.max_x - source_bbox.min_x).max(1.0);
    let source_height = (source_bbox.max_y - source_bbox.min_y).max(1.0);
    let (scale_x, scale_y) = aspect_ratio_scales(
        inner_width / source_width,
        inner_height / source_height,
        preserve_aspect_ratio,
    );
    let matrix = AffineMatrix {
        a: scale_x,
        b: 0.0,
        c: 0.0,
        d: scale_y,
        e: stroke_padding + (inner_width - source_width * scale_x) * 0.5
            - source_bbox.min_x * scale_x,
        f: stroke_padding + (inner_height - source_height * scale_y) * 0.5
            - source_bbox.min_y * scale_y,
    };
    transform_region(region, matrix)
}

fn transform_region(region: &Region, matrix: AffineMatrix) -> Region {
    let flips_orientation = matrix.determinant() < 0.0;
    let contours = region
        .contours
        .iter()
        .map(|contour| {
            let transformed = Contour {
                segments: contour
                    .segments
                    .iter()
                    .map(|segment| segment.transform(matrix))
                    .collect(),
                closed: contour.closed,
            };
            if flips_orientation {
                reverse_contour(&transformed)
            } else {
                transformed
            }
        })
        .collect();
    Region { contours }
}

fn render_compiled_parts_svg(
    parts: &[CompiledGeometryPart],
    view_box: &GeometryViewBox,
    paint: Option<&GeometryPaint>,
) -> String {
    use std::fmt::Write as _;
    let mut body = String::new();
    for part in parts {
        let part_id_attribute = part.part_id.as_ref().map_or_else(String::new, |part_id| {
            format!(" data-boundsvg-part-id=\"{}\"", escape_xml(part_id))
        });
        if let Some(stroke_path) = part.stroke_d.as_deref() {
            let should_fill = paint.is_none_or(|value| {
                value.fill.as_deref().is_some_and(|fill| fill != "none")
                    || (value.fill.is_none() && value.stroke.is_none())
            });
            let should_stroke = paint
                .and_then(|value| value.stroke.as_deref())
                .is_some_and(|stroke| stroke != "none");
            let emits_fill = !part.d.is_empty() && should_fill;
            // Element opacity applies after fill and stroke have been
            // composited together. Splitting them into two independently
            // translucent paths would darken their overlap, so preserve the
            // original compositing group when both paths are emitted.
            let group_opacity = (emits_fill && should_stroke)
                .then(|| paint.and_then(|value| value.opacity))
                .flatten();
            let mut split_body = String::new();
            if emits_fill {
                let fill_paint = paint.map(|value| GeometryPaint {
                    stroke: None,
                    stroke_width: None,
                    stroke_linecap: None,
                    stroke_linejoin: None,
                    stroke_dasharray: None,
                    stroke_miterlimit: None,
                    opacity: if group_opacity.is_some() {
                        None
                    } else {
                        value.opacity
                    },
                    ..value.clone()
                });
                let _ = write!(
                    split_body,
                    "<path{} d=\"{}\"{} />",
                    part_id_attribute,
                    escape_xml(&part.d),
                    build_native_paint_attributes(fill_paint.as_ref())
                );
            }
            if should_stroke {
                let stroke_paint = paint.map(|value| GeometryPaint {
                    fill: Some("none".to_string()),
                    fill_rule: None,
                    opacity: if group_opacity.is_some() {
                        None
                    } else {
                        value.opacity
                    },
                    ..value.clone()
                });
                let _ = write!(
                    split_body,
                    "<path{} d=\"{}\"{} />",
                    part_id_attribute,
                    escape_xml(stroke_path),
                    build_native_paint_attributes(stroke_paint.as_ref())
                );
            }
            if let Some(opacity) = group_opacity {
                let _ = write!(
                    body,
                    "<g opacity=\"{}\">{}</g>",
                    format_svg_number(opacity),
                    split_body
                );
            } else {
                body.push_str(&split_body);
            }
            continue;
        }
        if part.d.is_empty() {
            continue;
        }
        let _ = write!(
            body,
            "<path{} d=\"{}\"{} />",
            part_id_attribute,
            escape_xml(&part.d),
            build_native_paint_attributes(paint)
        );
    }
    let view_box_value = format!(
        "0 0 {} {}",
        format_svg_number(view_box.width),
        format_svg_number(view_box.height)
    );
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{}\"><g>{}</g></svg>",
        escape_xml(&view_box_value),
        body
    )
}

fn render_region_svg(
    region: &Region,
    view_box: &GeometryViewBox,
    paint: Option<&GeometryPaint>,
) -> String {
    let path = region_to_path(region);
    let body = if path.is_empty() {
        String::new()
    } else {
        render_region_body(region, &path, paint)
    };
    let view_box_value = format!(
        "0 0 {} {}",
        format_svg_number(view_box.width),
        format_svg_number(view_box.height)
    );
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{}\"><g>{}</g></svg>",
        escape_xml(&view_box_value),
        body
    )
}

fn render_region_body(region: &Region, fill_path: &str, paint: Option<&GeometryPaint>) -> String {
    let Some(paint) = paint else {
        return format!("<path d=\"{}\" />", escape_xml(fill_path));
    };

    let _ = region;
    format!(
        "<path d=\"{}\"{} />",
        escape_xml(fill_path),
        build_native_paint_attributes(Some(paint))
    )
}

fn stroke_padding(paint: Option<&GeometryPaint>) -> f64 {
    paint
        .and_then(|value| {
            value
                .stroke
                .as_ref()
                .filter(|stroke| stroke.as_str() != "none")
                .map(|_| value.stroke_width.unwrap_or(1.0) * 0.5)
        })
        .filter(|value| *value > 0.0)
        .unwrap_or(0.0)
}

fn reverse_contour(contour: &Contour) -> Contour {
    let mut reversed_segments = Vec::with_capacity(contour.segments.len());
    for segment in contour.segments.iter().rev() {
        reversed_segments.push(segment.reversed());
    }
    Contour {
        segments: reversed_segments,
        closed: contour.closed,
    }
}

fn resolve_resolved_size(axis: &str, source: f64, segments: &[ElasticSegment], target: f64) -> f64 {
    if segments.iter().any(|segment| segment.axis == axis) {
        target
    } else {
        source
    }
}

fn apply_elastic_segments(node: &GeometryNode, ctx: &ElasticContext<'_>) -> GeometryNode {
    let mut transformed_node =
        map_geometry_children(node, |child| apply_elastic_segments(child, ctx));
    let Some(current_node_id) = node_id(node) else {
        return transformed_node;
    };

    for segment in ctx
        .segments
        .iter()
        .filter(|candidate| candidate.node_id == current_node_id)
    {
        transformed_node = apply_elastic_segment(transformed_node, segment, ctx);
    }
    transformed_node
}

fn apply_elastic_segment(
    transformed_node: GeometryNode,
    segment: &ElasticSegment,
    ctx: &ElasticContext<'_>,
) -> GeometryNode {
    let axis_target = if segment.axis == "x" {
        ctx.target_width
    } else {
        ctx.target_height
    };
    let axis_source = if segment.axis == "x" {
        ctx.source_width
    } else {
        ctx.source_height
    };
    let delta = axis_target - axis_source;
    if delta == 0.0 {
        return transformed_node;
    }

    match segment.role {
        ElasticSegmentRole::FixedStart => transformed_node,
        ElasticSegmentRole::FixedEnd => wrap_with_transform(
            transformed_node,
            if segment.axis == "x" {
                Transform2D {
                    translate_x: Some(delta),
                    ..Transform2D::default()
                }
            } else {
                Transform2D {
                    translate_y: Some(delta),
                    ..Transform2D::default()
                }
            },
        ),
        ElasticSegmentRole::Stretch => {
            let frame_size = if segment.axis == "x" {
                segment.frame.width
            } else {
                segment.frame.height
            };
            if frame_size <= 0.0 {
                return transformed_node;
            }
            let scale = (frame_size + delta) / frame_size;
            if segment.axis == "x" {
                wrap_with_transform(
                    transformed_node,
                    Transform2D {
                        scale_x: Some(scale),
                        origin_x: Some(segment.frame.x),
                        ..Transform2D::default()
                    },
                )
            } else {
                wrap_with_transform(
                    transformed_node,
                    Transform2D {
                        scale_y: Some(scale),
                        origin_y: Some(segment.frame.y),
                        ..Transform2D::default()
                    },
                )
            }
        }
    }
}

fn node_id(node: &GeometryNode) -> Option<&str> {
    match node {
        GeometryNode::Path { node_id, .. }
        | GeometryNode::Group { node_id, .. }
        | GeometryNode::Transform { node_id, .. }
        | GeometryNode::Boolean { node_id, .. } => node_id.as_deref(),
    }
}

fn wrap_with_transform(node: GeometryNode, transform: Transform2D) -> GeometryNode {
    let node_id = node_id(&node).map(ToOwned::to_owned);
    GeometryNode::Transform {
        node_id,
        transform,
        child: Box::new(node),
    }
}

fn map_geometry_children(
    node: &GeometryNode,
    mut map_child: impl FnMut(&GeometryNode) -> GeometryNode,
) -> GeometryNode {
    match node {
        GeometryNode::Path { .. } => node.clone(),
        GeometryNode::Group { node_id, children } => GeometryNode::Group {
            node_id: node_id.clone(),
            children: children.iter().map(&mut map_child).collect(),
        },
        GeometryNode::Transform {
            node_id,
            transform,
            child,
        } => GeometryNode::Transform {
            node_id: node_id.clone(),
            transform: transform.clone(),
            child: Box::new(map_child(child)),
        },
        GeometryNode::Boolean {
            node_id,
            op,
            children,
        } => GeometryNode::Boolean {
            node_id: node_id.clone(),
            op: *op,
            children: children.iter().map(&mut map_child).collect(),
        },
    }
}

fn tokenize_path_data(path_data: &str) -> Result<Vec<String>, ShapeError> {
    let bytes = path_data.as_bytes();
    let mut tokens = Vec::new();
    let mut index = 0usize;
    while index < bytes.len() {
        let byte = bytes[index];
        if matches!(byte, b' ' | b'\n' | b'\r' | b'\t' | b'\x0c' | b',') {
            index += 1;
            continue;
        }
        if (byte as char).is_ascii_alphabetic() {
            tokens.push((byte as char).to_string());
            index += 1;
            continue;
        }

        let start = index;
        if matches!(bytes[index], b'+' | b'-') {
            index += 1;
        }
        while index < bytes.len() && (bytes[index] as char).is_ascii_digit() {
            index += 1;
        }
        if index < bytes.len() && bytes[index] == b'.' {
            index += 1;
            while index < bytes.len() && (bytes[index] as char).is_ascii_digit() {
                index += 1;
            }
        }
        if index < bytes.len() && matches!(bytes[index], b'e' | b'E') {
            index += 1;
            if index < bytes.len() && matches!(bytes[index], b'+' | b'-') {
                index += 1;
            }
            while index < bytes.len() && (bytes[index] as char).is_ascii_digit() {
                index += 1;
            }
        }
        if index == start || (index == start + 1 && matches!(bytes[start], b'+' | b'-')) {
            return Err(ShapeError::InvalidPathData);
        }
        tokens.push(path_data[start..index].to_string());
    }
    Ok(tokens)
}

fn is_command_token(token: &str) -> bool {
    token.len() == 1
        && token
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphabetic())
}

fn read_number_token(tokens: &[String], index: usize) -> Result<(f64, usize), ShapeError> {
    let token = tokens.get(index).ok_or(ShapeError::InvalidPathData)?;
    if is_command_token(token) {
        return Err(ShapeError::InvalidPathData);
    }
    token
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
        .map(|value| (value, index + 1))
        .ok_or(ShapeError::InvalidPathData)
}

fn try_read_number_token(tokens: &[String], index: usize) -> Option<(f64, usize)> {
    let token = tokens.get(index)?;
    if is_command_token(token) {
        return None;
    }
    token
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
        .map(|value| (value, index + 1))
}

fn read_point_token(tokens: &[String], index: usize) -> Result<(Point2D, usize), ShapeError> {
    let (x, next_index) = read_number_token(tokens, index)?;
    let (y, final_index) = read_number_token(tokens, next_index)?;
    Ok((Point2D { x, y }, final_index))
}

fn try_read_point_token(tokens: &[String], index: usize) -> Option<(Point2D, usize)> {
    let (x, next_index) = try_read_number_token(tokens, index)?;
    let (y, final_index) = try_read_number_token(tokens, next_index)?;
    Some((Point2D { x, y }, final_index))
}

#[derive(Debug, Clone, Copy)]
struct ArcToken {
    rx: f64,
    ry: f64,
    x_axis_rotation_deg: f64,
    large_arc: bool,
    sweep: bool,
    end: Point2D,
}

#[derive(Clone, Copy)]
struct ArcArgumentCursor {
    token_index: usize,
    byte_offset: usize,
}

impl ArcArgumentCursor {
    fn at_token(token_index: usize) -> Self {
        Self {
            token_index,
            byte_offset: 0,
        }
    }

    fn skip_consumed_tokens(mut self, tokens: &[String]) -> Self {
        while tokens
            .get(self.token_index)
            .is_some_and(|token| self.byte_offset == token.len())
        {
            self.token_index += 1;
            self.byte_offset = 0;
        }
        self
    }
}

fn read_arc_flag(
    tokens: &[String],
    cursor: ArcArgumentCursor,
) -> Result<(bool, ArcArgumentCursor), ShapeError> {
    let mut cursor = cursor.skip_consumed_tokens(tokens);
    let token = tokens
        .get(cursor.token_index)
        .ok_or(ShapeError::InvalidPathData)?;
    let value = match token.as_bytes().get(cursor.byte_offset) {
        Some(b'0') => false,
        Some(b'1') => true,
        _ => return Err(ShapeError::InvalidPathData),
    };
    cursor.byte_offset += 1;
    Ok((value, cursor))
}

fn read_arc_number(
    tokens: &[String],
    cursor: ArcArgumentCursor,
) -> Result<(f64, ArcArgumentCursor), ShapeError> {
    let cursor = cursor.skip_consumed_tokens(tokens);
    let token = tokens
        .get(cursor.token_index)
        .ok_or(ShapeError::InvalidPathData)?;
    if is_command_token(token) {
        return Err(ShapeError::InvalidPathData);
    }
    let value = token[cursor.byte_offset..]
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
        .ok_or(ShapeError::InvalidPathData)?;
    Ok((value, ArcArgumentCursor::at_token(cursor.token_index + 1)))
}

fn try_read_arc_token(tokens: &[String], index: usize) -> Option<(ArcToken, usize)> {
    let (rx, next_index) = try_read_number_token(tokens, index)?;
    let (ry, next_index) = try_read_number_token(tokens, next_index)?;
    let (x_axis_rotation_deg, next_index) = try_read_number_token(tokens, next_index)?;
    let cursor = ArcArgumentCursor::at_token(next_index);
    let (large_arc, cursor) = read_arc_flag(tokens, cursor).ok()?;
    let (sweep, cursor) = read_arc_flag(tokens, cursor).ok()?;
    let (end_x, cursor) = read_arc_number(tokens, cursor).ok()?;
    let (end_y, cursor) = read_arc_number(tokens, cursor).ok()?;
    let next_index = cursor.skip_consumed_tokens(tokens).token_index;
    Some((
        ArcToken {
            rx,
            ry,
            x_axis_rotation_deg,
            large_arc,
            sweep,
            end: Point2D { x: end_x, y: end_y },
        },
        next_index,
    ))
}

#[expect(
    clippy::too_many_lines,
    reason = "SVG elliptical arc conversion follows the spec algorithm and keeps intermediate values together"
)]
fn arc_to_cubic_segments(start: Point2D, end: Point2D, arc: &ArcToken) -> Vec<CurveSegment> {
    let mut rx = arc.rx.abs();
    let mut ry = arc.ry.abs();
    if rx <= f64::EPSILON || ry <= f64::EPSILON || points_close(start, end, 1e-9) {
        return vec![CurveSegment::Line { p0: start, p1: end }];
    }

    let phi = arc.x_axis_rotation_deg.to_radians();
    let cos_phi = phi.cos();
    let sin_phi = phi.sin();
    let dx = (start.x - end.x) * 0.5;
    let dy = (start.y - end.y) * 0.5;
    let x1p = cos_phi * dx + sin_phi * dy;
    let y1p = -sin_phi * dx + cos_phi * dy;

    let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if lambda > 1.0 {
        let scale = lambda.sqrt();
        rx *= scale;
        ry *= scale;
    }

    let rx_sq = rx * rx;
    let ry_sq = ry * ry;
    let x1p_sq = x1p * x1p;
    let y1p_sq = y1p * y1p;
    let numerator = (rx_sq * ry_sq) - (rx_sq * y1p_sq) - (ry_sq * x1p_sq);
    let denominator = (rx_sq * y1p_sq) + (ry_sq * x1p_sq);
    let factor = if denominator <= f64::EPSILON {
        0.0
    } else {
        (numerator / denominator).max(0.0).sqrt()
    };
    let sign = if arc.large_arc == arc.sweep {
        -1.0
    } else {
        1.0
    };
    let cxp = sign * factor * ((rx * y1p) / ry);
    let cyp = sign * factor * (-(ry * x1p) / rx);
    let center = Point2D {
        x: cos_phi * cxp - sin_phi * cyp + (start.x + end.x) * 0.5,
        y: sin_phi * cxp + cos_phi * cyp + (start.y + end.y) * 0.5,
    };

    let unit_start = Point2D {
        x: (x1p - cxp) / rx,
        y: (y1p - cyp) / ry,
    };
    let unit_end = Point2D {
        x: (-x1p - cxp) / rx,
        y: (-y1p - cyp) / ry,
    };

    let start_angle = vector_angle(Point2D { x: 1.0, y: 0.0 }, unit_start);
    let mut delta_angle = vector_angle(unit_start, unit_end);
    if !arc.sweep && delta_angle > 0.0 {
        delta_angle -= PI * 2.0;
    } else if arc.sweep && delta_angle < 0.0 {
        delta_angle += PI * 2.0;
    }

    let abs_delta_angle = delta_angle.abs();
    let segment_count = if abs_delta_angle <= PI * 0.5 {
        1
    } else if abs_delta_angle <= PI {
        2
    } else if abs_delta_angle <= PI * 1.5 {
        3
    } else {
        4
    };
    let step = delta_angle / segment_count as f64;
    let mut segments = Vec::with_capacity(segment_count);
    let mut current_angle = start_angle;
    let mut current_point = start;
    for _ in 0..segment_count {
        let next_angle = current_angle + step;
        let delta = next_angle - current_angle;
        let alpha = (4.0 / 3.0) * (delta * 0.25).tan();

        let unit_p0 = Point2D {
            x: current_angle.cos(),
            y: current_angle.sin(),
        };
        let unit_p3 = Point2D {
            x: next_angle.cos(),
            y: next_angle.sin(),
        };
        let unit_c1 = Point2D {
            x: unit_p0.x - alpha * unit_p0.y,
            y: unit_p0.y + alpha * unit_p0.x,
        };
        let unit_c2 = Point2D {
            x: unit_p3.x + alpha * unit_p3.y,
            y: unit_p3.y - alpha * unit_p3.x,
        };

        let p1 = map_ellipse_point(unit_c1, center, rx, ry, cos_phi, sin_phi);
        let p2 = map_ellipse_point(unit_c2, center, rx, ry, cos_phi, sin_phi);
        let mut p3 = map_ellipse_point(unit_p3, center, rx, ry, cos_phi, sin_phi);
        if (next_angle - (start_angle + delta_angle)).abs() <= 1e-9 {
            p3 = end;
        }

        segments.push(CurveSegment::Cubic {
            p0: current_point,
            p1,
            p2,
            p3,
        });
        current_point = p3;
        current_angle = next_angle;
    }

    segments
}

fn map_ellipse_point(
    unit: Point2D,
    center: Point2D,
    rx: f64,
    ry: f64,
    cos_phi: f64,
    sin_phi: f64,
) -> Point2D {
    Point2D {
        x: center.x + rx * cos_phi * unit.x - ry * sin_phi * unit.y,
        y: center.y + rx * sin_phi * unit.x + ry * cos_phi * unit.y,
    }
}

fn vector_angle(left: Point2D, right: Point2D) -> f64 {
    cross(left, right).atan2(dot(left, right))
}

fn build_native_paint_attributes(paint: Option<&GeometryPaint>) -> String {
    let Some(paint) = paint else {
        return String::new();
    };

    let mut attributes = Vec::new();
    if let Some(fill) = paint.fill.as_deref() {
        attributes.push(format!("fill=\"{}\"", escape_xml(fill)));
    } else if paint.stroke.is_some() {
        attributes.push("fill=\"none\"".to_string());
    }
    if let Some(stroke) = paint.stroke.as_deref() {
        attributes.push(format!("stroke=\"{}\"", escape_xml(stroke)));
    }
    if let Some(stroke_width) = paint.stroke_width {
        attributes.push(format!(
            "stroke-width=\"{}\"",
            format_svg_number(stroke_width)
        ));
    }
    if let Some(linecap) = paint.stroke_linecap.as_deref() {
        attributes.push(format!("stroke-linecap=\"{}\"", escape_xml(linecap)));
    }
    if let Some(linejoin) = paint.stroke_linejoin.as_deref() {
        attributes.push(format!("stroke-linejoin=\"{}\"", escape_xml(linejoin)));
    }
    if let Some(dasharray) = paint.stroke_dasharray.as_deref() {
        attributes.push(format!("stroke-dasharray=\"{}\"", escape_xml(dasharray)));
    }
    if let Some(miterlimit) = paint.stroke_miterlimit {
        attributes.push(format!(
            "stroke-miterlimit=\"{}\"",
            format_svg_number(miterlimit)
        ));
    }
    if let Some(opacity) = paint.opacity {
        attributes.push(format!("opacity=\"{}\"", format_svg_number(opacity)));
    }
    if attributes.is_empty() {
        String::new()
    } else {
        format!(" {}", attributes.join(" "))
    }
}

fn segment_to_path_command(segment: &CurveSegment) -> String {
    match segment {
        CurveSegment::Line { p1, .. } => {
            format!("L{},{}", format_path_number(p1.x), format_path_number(p1.y))
        }
        CurveSegment::Quad { p1, p2, .. } => format!(
            "Q{},{} {},{}",
            format_path_number(p1.x),
            format_path_number(p1.y),
            format_path_number(p2.x),
            format_path_number(p2.y)
        ),
        CurveSegment::Cubic { p1, p2, p3, .. } => format!(
            "C{},{} {},{} {},{}",
            format_path_number(p1.x),
            format_path_number(p1.y),
            format_path_number(p2.x),
            format_path_number(p2.y),
            format_path_number(p3.x),
            format_path_number(p3.y)
        ),
    }
}

fn region_bbox(region: &Region) -> Option<BBox> {
    let mut bbox: Option<BBox> = None;
    for contour in &region.contours {
        for segment in &contour.segments {
            bbox = Some(match bbox {
                Some(current) => current.union(segment.bbox()),
                None => segment.bbox(),
            });
        }
    }
    bbox
}

fn region_exact_bbox(region: &Region) -> Option<BBox> {
    let mut bbox: Option<BBox> = None;
    for contour in &region.contours {
        for segment in &contour.segments {
            bbox = Some(match bbox {
                Some(current) => current.union(segment.exact_bbox()),
                None => segment.exact_bbox(),
            });
        }
    }
    bbox
}

fn clip_monotonic_contour_to_axis_interval(
    contour: &Contour,
    axis: RegionAxis,
    interval_min: f64,
    interval_max: f64,
) -> Result<Option<Contour>, ShapeError> {
    let tolerance = GeometryTolerance::default();
    let mut retained_segments: Vec<CurveSegment> = Vec::new();
    for segment in &contour.segments {
        let Some(clipped_segment) =
            clip_monotonic_segment_to_axis_interval(segment, axis, interval_min, interval_max)?
        else {
            continue;
        };
        if let Some(previous_end) = retained_segments.last().map(CurveSegment::end)
            && !points_close(
                previous_end,
                clipped_segment.start(),
                tolerance.position_epsilon,
            )
        {
            ensure_clip_boundary_join(
                previous_end,
                clipped_segment.start(),
                axis,
                interval_min,
                interval_max,
                tolerance,
            )?;
            retained_segments.push(CurveSegment::Line {
                p0: previous_end,
                p1: clipped_segment.start(),
            });
        }
        retained_segments.push(clipped_segment);
    }
    let Some(first_start) = retained_segments.first().map(CurveSegment::start) else {
        return Ok(None);
    };
    let Some(last_end) = retained_segments.last().map(CurveSegment::end) else {
        return Ok(None);
    };
    if !points_close(last_end, first_start, tolerance.position_epsilon) {
        ensure_clip_boundary_join(
            last_end,
            first_start,
            axis,
            interval_min,
            interval_max,
            tolerance,
        )?;
        retained_segments.push(CurveSegment::Line {
            p0: last_end,
            p1: first_start,
        });
    }
    Ok(Some(Contour {
        segments: retained_segments,
        closed: true,
    }))
}

fn ensure_clip_boundary_join(
    start: Point2D,
    end: Point2D,
    axis: RegionAxis,
    interval_min: f64,
    interval_max: f64,
    tolerance: GeometryTolerance,
) -> Result<(), ShapeError> {
    let start_axis = region_axis_coordinate(start, axis);
    let end_axis = region_axis_coordinate(end, axis);
    let same_min_boundary = (start_axis - interval_min).abs() <= tolerance.position_epsilon
        && (end_axis - interval_min).abs() <= tolerance.position_epsilon;
    let same_max_boundary = (start_axis - interval_max).abs() <= tolerance.position_epsilon
        && (end_axis - interval_max).abs() <= tolerance.position_epsilon;
    if same_min_boundary || same_max_boundary {
        Ok(())
    } else {
        Err(ShapeError::RegionClipNonMonotonic)
    }
}

fn clip_monotonic_segment_to_axis_interval(
    segment: &CurveSegment,
    axis: RegionAxis,
    interval_min: f64,
    interval_max: f64,
) -> Result<Option<CurveSegment>, ShapeError> {
    let tolerance = GeometryTolerance::default();
    if !segment_is_axis_monotonic(segment, axis, tolerance.position_epsilon) {
        return Err(ShapeError::RegionClipNonMonotonic);
    }
    let start_axis = region_axis_coordinate(segment.start(), axis);
    let end_axis = region_axis_coordinate(segment.end(), axis);
    if (end_axis - start_axis).abs() <= tolerance.position_epsilon {
        return Ok((start_axis >= interval_min - tolerance.position_epsilon
            && start_axis <= interval_max + tolerance.position_epsilon)
            .then(|| segment.clone()));
    }
    let segment_min = start_axis.min(end_axis);
    let segment_max = start_axis.max(end_axis);
    if segment_max < interval_min || segment_min > interval_max {
        return Ok(None);
    }
    let increasing = end_axis > start_axis;
    let (t0, t1) = if increasing {
        (
            if interval_min <= start_axis {
                0.0
            } else {
                solve_monotonic_segment_axis(segment, axis, interval_min, true)
            },
            if interval_max >= end_axis {
                1.0
            } else {
                solve_monotonic_segment_axis(segment, axis, interval_max, true)
            },
        )
    } else {
        (
            if interval_max >= start_axis {
                0.0
            } else {
                solve_monotonic_segment_axis(segment, axis, interval_max, false)
            },
            if interval_min <= end_axis {
                1.0
            } else {
                solve_monotonic_segment_axis(segment, axis, interval_min, false)
            },
        )
    };
    if t1 - t0 <= f64::EPSILON {
        return Ok(None);
    }
    Ok(Some(curve_segment_subsegment(segment, t0, t1)))
}

fn segment_is_axis_monotonic(segment: &CurveSegment, axis: RegionAxis, epsilon: f64) -> bool {
    let coordinates = match segment {
        CurveSegment::Line { p0, p1 } => vec![
            region_axis_coordinate(*p0, axis),
            region_axis_coordinate(*p1, axis),
        ],
        CurveSegment::Quad { p0, p1, p2 } => vec![
            region_axis_coordinate(*p0, axis),
            region_axis_coordinate(*p1, axis),
            region_axis_coordinate(*p2, axis),
        ],
        CurveSegment::Cubic { p0, p1, p2, p3 } => vec![
            region_axis_coordinate(*p0, axis),
            region_axis_coordinate(*p1, axis),
            region_axis_coordinate(*p2, axis),
            region_axis_coordinate(*p3, axis),
        ],
    };
    coordinates
        .windows(2)
        .all(|pair| pair[0] <= pair[1] + epsilon)
        || coordinates
            .windows(2)
            .all(|pair| pair[0] + epsilon >= pair[1])
}

fn solve_monotonic_segment_axis(
    segment: &CurveSegment,
    axis: RegionAxis,
    target: f64,
    increasing: bool,
) -> f64 {
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..64 {
        let middle = (low + high) * 0.5;
        let coordinate = region_axis_coordinate(segment.eval(middle), axis);
        if (coordinate < target) == increasing {
            low = middle;
        } else {
            high = middle;
        }
    }
    (low + high) * 0.5
}

fn region_axis_coordinate(point: Point2D, axis: RegionAxis) -> f64 {
    match axis {
        RegionAxis::X => point.x,
        RegionAxis::Y => point.y,
    }
}

fn curve_segment_subsegment(segment: &CurveSegment, t0: f64, t1: f64) -> CurveSegment {
    let (_, right) = segment.split(t0);
    let remaining = 1.0 - t0;
    let local_t = if remaining <= f64::EPSILON {
        0.0
    } else {
        (t1 - t0) / remaining
    };
    right.split(local_t).0
}

fn flatten_contour(contour: &Contour, tolerance: GeometryTolerance) -> Vec<Point2D> {
    let mut points = Vec::new();
    let Some(first_segment) = contour.segments.first() else {
        return points;
    };
    points.push(first_segment.start());
    for segment in &contour.segments {
        let mut segment_points = Vec::new();
        segment.flatten(tolerance.flatness_epsilon, &mut segment_points);
        if !segment_points.is_empty() {
            segment_points.remove(0);
        }
        points.extend(segment_points);
    }
    if contour.closed
        && let Some(first_point) = points.first().copied()
        && points.last().copied().is_some_and(|last_point| {
            !points_close(first_point, last_point, tolerance.position_epsilon)
        })
    {
        points.push(first_point);
    }
    points
}

fn signed_area(polyline: &[Point2D]) -> f64 {
    let mut area = 0.0;
    for window in polyline.windows(2) {
        let first = window[0];
        let second = window[1];
        area += first.x * second.y - second.x * first.y;
    }
    area * 0.5
}

fn probe_contour_fill_sides(
    contour: &Contour,
    flattened: &[Vec<Point2D>],
    orientation: &[bool],
    fill_rule: &str,
    tolerance: GeometryTolerance,
) -> (bool, bool) {
    let Some(segment) = contour.segments.first() else {
        // An empty contour has no sides to probe; report both as unfilled so
        // the caller leaves its orientation untouched.
        return (false, false);
    };
    let midpoint = segment.eval(0.5);
    let tangent = segment.derivative(0.5);
    let tangent_length = point_length(tangent);
    if tangent_length <= tolerance.position_epsilon {
        let filled = raw_fill_membership(midpoint, flattened, orientation, fill_rule);
        return (filled, filled);
    }
    let normal = Point2D {
        x: -tangent.y / tangent_length,
        y: tangent.x / tangent_length,
    };
    let contour_bbox = contour
        .segments
        .iter()
        .fold(None, |bbox: Option<BBox>, segment| {
            Some(match bbox {
                Some(current) => current.union(segment.bbox()),
                None => segment.bbox(),
            })
        })
        .unwrap_or(BBox {
            min_x: midpoint.x,
            min_y: midpoint.y,
            max_x: midpoint.x,
            max_y: midpoint.y,
        });
    for distance in probe_distances(contour_bbox.max_dimension()) {
        let left_sample = add_points(midpoint, scale_point(normal, distance));
        let right_sample = add_points(midpoint, scale_point(normal, -distance));
        let left_filled = raw_fill_membership(left_sample, flattened, orientation, fill_rule);
        let right_filled = raw_fill_membership(right_sample, flattened, orientation, fill_rule);
        if left_filled != right_filled {
            return (left_filled, right_filled);
        }
    }
    let left_sample = add_points(midpoint, scale_point(normal, tolerance.sample_epsilon));
    let right_sample = add_points(midpoint, scale_point(normal, -tolerance.sample_epsilon));
    (
        raw_fill_membership(left_sample, flattened, orientation, fill_rule),
        raw_fill_membership(right_sample, flattened, orientation, fill_rule),
    )
}

fn raw_fill_membership(
    point: Point2D,
    flattened: &[Vec<Point2D>],
    orientation: &[bool],
    fill_rule: &str,
) -> bool {
    if fill_rule.eq_ignore_ascii_case("evenodd") {
        let count = flattened
            .iter()
            .filter(|polyline| point_in_polygon_evenodd(point, polyline))
            .count();
        return count % 2 == 1;
    }

    let mut winding = 0i32;
    for (polyline, is_ccw) in flattened.iter().zip(orientation.iter()) {
        if point_in_polygon_evenodd(point, polyline) {
            winding += if *is_ccw { 1 } else { -1 };
        }
    }
    winding != 0
}

#[allow(clippy::too_many_arguments)]
fn probe_boolean_side_membership(
    piece: &CurveSegment,
    source_side: RegionSide,
    lhs: &Region,
    rhs: &Region,
    prepared_lhs: &PreparedRegion,
    prepared_rhs: &PreparedRegion,
    op: BooleanOp,
    tolerance: GeometryTolerance,
    midpoint: Point2D,
    normal: Point2D,
) -> (bool, bool) {
    let max_dimension = piece.bbox().max_dimension();
    let max_probe_distance = (max_dimension * 0.02).max(tolerance.position_epsilon);
    for distance in probe_distances(max_dimension) {
        if distance > max_probe_distance {
            break;
        }
        let left_sample = add_points(midpoint, scale_point(normal, distance));
        let right_sample = add_points(midpoint, scale_point(normal, -distance));
        let left_inside = boolean_result_membership(
            source_side,
            lhs,
            rhs,
            prepared_lhs,
            prepared_rhs,
            left_sample,
            op,
        );
        let right_inside = boolean_result_membership(
            source_side,
            lhs,
            rhs,
            prepared_lhs,
            prepared_rhs,
            right_sample,
            op,
        );
        if left_inside != right_inside {
            return (left_inside, right_inside);
        }
    }
    let fallback_distance = tolerance.sample_epsilon.min(max_probe_distance);
    let left_sample = add_points(midpoint, scale_point(normal, fallback_distance));
    let right_sample = add_points(midpoint, scale_point(normal, -fallback_distance));
    (
        boolean_result_membership(
            source_side,
            lhs,
            rhs,
            prepared_lhs,
            prepared_rhs,
            left_sample,
            op,
        ),
        boolean_result_membership(
            source_side,
            lhs,
            rhs,
            prepared_lhs,
            prepared_rhs,
            right_sample,
            op,
        ),
    )
}

fn probe_distances(max_dimension: f64) -> [f64; 8] {
    let base = (max_dimension.max(1.0)) * 1e-4;
    [
        base,
        base * 2.0,
        base * 4.0,
        base * 8.0,
        base * 16.0,
        base * 32.0,
        base * 64.0,
        base * 128.0,
    ]
}

fn point_in_polygon_evenodd(point: Point2D, polyline: &[Point2D]) -> bool {
    let mut inside = false;
    for window in polyline.windows(2) {
        let first = window[0];
        let second = window[1];
        let intersects = ((first.y > point.y) != (second.y > point.y))
            && (point.x
                < (second.x - first.x) * (point.y - first.y) / (second.y - first.y + 1e-12)
                    + first.x);
        if intersects {
            inside = !inside;
        }
    }
    inside
}

fn segments_intersect_strict(
    a0: Point2D,
    a1: Point2D,
    b0: Point2D,
    b1: Point2D,
    epsilon: f64,
) -> bool {
    let shared_endpoint = points_close(a0, b0, epsilon)
        || points_close(a0, b1, epsilon)
        || points_close(a1, b0, epsilon)
        || points_close(a1, b1, epsilon);
    if shared_endpoint {
        return false;
    }
    let orientation1 = orient(a0, a1, b0);
    let orientation2 = orient(a0, a1, b1);
    let orientation3 = orient(b0, b1, a0);
    let orientation4 = orient(b0, b1, a1);
    (orientation1 > epsilon && orientation2 < -epsilon
        || orientation1 < -epsilon && orientation2 > epsilon)
        && (orientation3 > epsilon && orientation4 < -epsilon
            || orientation3 < -epsilon && orientation4 > epsilon)
}

fn orient(a: Point2D, b: Point2D, c: Point2D) -> f64 {
    cross(subtract_points(b, a), subtract_points(c, a))
}

fn positive_angle_delta(from: f64, to: f64, tolerance: GeometryTolerance) -> f64 {
    let mut delta = to - from;
    while delta <= tolerance.parameter_epsilon {
        delta += PI * 2.0;
    }
    delta
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn format_path_number(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    let normalized = if rounded == -0.0 { 0.0 } else { rounded };
    format_svg_number(normalized)
}

fn format_svg_number(value: f64) -> String {
    let mut formatted = value.to_string();
    if let Some(stripped) = formatted.strip_suffix(".0") {
        formatted = stripped.to_string();
    }
    formatted
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "geometry keys intentionally quantize finite coordinates into integer buckets"
)]
fn quantize_number(value: f64, epsilon: f64) -> i64 {
    let normalized = if epsilon <= 0.0 { 1e-6 } else { epsilon };
    (value / normalized).round() as i64
}

fn point_key(point: Point2D, tolerance: GeometryTolerance) -> (i64, i64) {
    (
        quantize_number(point.y, tolerance.position_epsilon),
        quantize_number(point.x, tolerance.position_epsilon),
    )
}

fn bbox_key(bbox: BBox, tolerance: GeometryTolerance) -> (i64, i64, i64, i64) {
    (
        quantize_number(bbox.min_y, tolerance.position_epsilon),
        quantize_number(bbox.min_x, tolerance.position_epsilon),
        quantize_number(bbox.max_y, tolerance.position_epsilon),
        quantize_number(bbox.max_x, tolerance.position_epsilon),
    )
}

fn contour_bbox(contour: &Contour) -> Option<BBox> {
    contour
        .segments
        .iter()
        .fold(None, |bbox: Option<BBox>, segment| {
            Some(match bbox {
                Some(current) => current.union(segment.bbox()),
                None => segment.bbox(),
            })
        })
}

fn contour_area_abs(contour: &Contour, tolerance: GeometryTolerance) -> f64 {
    let flattened = flatten_contour(contour, tolerance);
    signed_area(&flattened).abs()
}

fn transform_to_matrix(transform: &Transform2D) -> AffineMatrix {
    let mut matrix = AffineMatrix::identity();
    if transform.translate_x.unwrap_or(0.0) != 0.0 || transform.translate_y.unwrap_or(0.0) != 0.0 {
        matrix = multiply_matrices(
            matrix,
            AffineMatrix::translate(
                transform.translate_x.unwrap_or(0.0),
                transform.translate_y.unwrap_or(0.0),
            ),
        );
    }
    let origin_x = transform.origin_x.unwrap_or(0.0);
    let origin_y = transform.origin_y.unwrap_or(0.0);
    if let Some(rotate_deg) = transform.rotate_deg {
        matrix = multiply_matrices(matrix, AffineMatrix::rotate(rotate_deg, origin_x, origin_y));
    }
    if transform.scale_x.is_some() || transform.scale_y.is_some() {
        let scale_x = transform.scale_x.unwrap_or(1.0);
        let scale_y = transform.scale_y.unwrap_or(1.0);
        if origin_x != 0.0 || origin_y != 0.0 {
            matrix = multiply_matrices(matrix, AffineMatrix::translate(origin_x, origin_y));
            matrix = multiply_matrices(matrix, AffineMatrix::scale(scale_x, scale_y));
            matrix = multiply_matrices(matrix, AffineMatrix::translate(-origin_x, -origin_y));
        } else {
            matrix = multiply_matrices(matrix, AffineMatrix::scale(scale_x, scale_y));
        }
    }
    matrix
}

fn multiply_matrices(left: AffineMatrix, right: AffineMatrix) -> AffineMatrix {
    AffineMatrix {
        a: left.a * right.a + left.c * right.b,
        b: left.b * right.a + left.d * right.b,
        c: left.a * right.c + left.c * right.d,
        d: left.b * right.c + left.d * right.d,
        e: left.a * right.e + left.c * right.f + left.e,
        f: left.b * right.e + left.d * right.f + left.f,
    }
}

impl AffineMatrix {
    const fn identity() -> Self {
        Self {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            e: 0.0,
            f: 0.0,
        }
    }

    const fn translate(tx: f64, ty: f64) -> Self {
        Self {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            e: tx,
            f: ty,
        }
    }

    const fn scale(scale_x: f64, scale_y: f64) -> Self {
        Self {
            a: scale_x,
            b: 0.0,
            c: 0.0,
            d: scale_y,
            e: 0.0,
            f: 0.0,
        }
    }

    fn rotate(degrees: f64, origin_x: f64, origin_y: f64) -> Self {
        let radians = degrees.to_radians();
        let cos = radians.cos();
        let sin = radians.sin();
        multiply_matrices(
            multiply_matrices(
                Self::translate(origin_x, origin_y),
                Self {
                    a: cos,
                    b: sin,
                    c: -sin,
                    d: cos,
                    e: 0.0,
                    f: 0.0,
                },
            ),
            Self::translate(-origin_x, -origin_y),
        )
    }

    fn apply(self, point: Point2D) -> Point2D {
        Point2D {
            x: self.a * point.x + self.c * point.y + self.e,
            y: self.b * point.x + self.d * point.y + self.f,
        }
    }

    fn determinant(self) -> f64 {
        self.a * self.d - self.b * self.c
    }
}

impl BBox {
    fn from_points(points: &[Point2D]) -> Self {
        let mut min_x = points[0].x;
        let mut min_y = points[0].y;
        let mut max_x = points[0].x;
        let mut max_y = points[0].y;
        for point in points.iter().skip(1) {
            min_x = min_x.min(point.x);
            min_y = min_y.min(point.y);
            max_x = max_x.max(point.x);
            max_y = max_y.max(point.y);
        }
        Self {
            min_x,
            min_y,
            max_x,
            max_y,
        }
    }

    fn union(self, other: Self) -> Self {
        Self {
            min_x: self.min_x.min(other.min_x),
            min_y: self.min_y.min(other.min_y),
            max_x: self.max_x.max(other.max_x),
            max_y: self.max_y.max(other.max_y),
        }
    }

    fn max_dimension(self) -> f64 {
        (self.max_x - self.min_x).max(self.max_y - self.min_y)
    }

    fn is_finite(self) -> bool {
        self.min_x.is_finite()
            && self.min_y.is_finite()
            && self.max_x.is_finite()
            && self.max_y.is_finite()
    }

    fn intersects(self, other: Self, epsilon: f64) -> bool {
        self.min_x <= other.max_x + epsilon
            && self.max_x + epsilon >= other.min_x
            && self.min_y <= other.max_y + epsilon
            && self.max_y + epsilon >= other.min_y
    }

    fn contains(self, point: Point2D, epsilon: f64) -> bool {
        point.x >= self.min_x - epsilon
            && point.x <= self.max_x + epsilon
            && point.y >= self.min_y - epsilon
            && point.y <= self.max_y + epsilon
    }
}

impl BBoxIndex {
    fn new(bboxes: &[BBox]) -> Self {
        let mut finite_indices = Vec::with_capacity(bboxes.len());
        let mut non_finite_indices = Vec::new();
        for (index, bbox) in bboxes.iter().enumerate() {
            if bbox.is_finite() {
                finite_indices.push(index);
            } else {
                non_finite_indices.push(index);
            }
        }

        let mut index = Self {
            nodes: Vec::new(),
            root: None,
            non_finite_indices,
            item_count: bboxes.len(),
        };
        if !finite_indices.is_empty() {
            index.root = Some(index.build_node(bboxes, &mut finite_indices));
        }
        index
    }

    fn build_node(&mut self, bboxes: &[BBox], indices: &mut [usize]) -> usize {
        let bbox = indices
            .iter()
            .skip(1)
            .fold(bboxes[indices[0]], |current, item_index| {
                current.union(bboxes[*item_index])
            });
        if indices.len() <= BBOX_INDEX_LEAF_CAPACITY {
            let node_index = self.nodes.len();
            self.nodes.push(BBoxIndexNode {
                bbox,
                kind: BBoxIndexNodeKind::Leaf(indices.to_vec()),
            });
            return node_index;
        }

        let split_horizontal = (bbox.max_x - bbox.min_x) >= (bbox.max_y - bbox.min_y);
        let middle = indices.len() / 2;
        indices.select_nth_unstable_by(middle, |left_index, right_index| {
            compare_bbox_centers(bboxes[*left_index], bboxes[*right_index], split_horizontal)
                .then_with(|| left_index.cmp(right_index))
        });
        let (left_indices, right_indices) = indices.split_at_mut(middle);
        let left = self.build_node(bboxes, left_indices);
        let right = self.build_node(bboxes, right_indices);
        let node_index = self.nodes.len();
        self.nodes.push(BBoxIndexNode {
            bbox,
            kind: BBoxIndexNodeKind::Branch { left, right },
        });
        node_index
    }

    /// Collects a conservative candidate superset in original item order.
    ///
    /// Callers must use an epsilon at least as large as the downstream bbox
    /// rejection tolerance. Exact predicates such as half-open ray crossings
    /// can use zero. Non-finite inputs deliberately fall back to every item.
    fn query_into(&self, bbox: BBox, epsilon: f64, candidates: &mut Vec<usize>) {
        candidates.clear();
        if force_bbox_index_full_scan() || !bbox.is_finite() || !epsilon.is_finite() {
            candidates.extend(0..self.item_count);
            return;
        }

        candidates.extend(&self.non_finite_indices);
        let Some(root) = self.root else {
            return;
        };
        self.collect_node_candidates(root, bbox, epsilon, candidates);
        candidates.sort_unstable();
    }

    fn collect_node_candidates(
        &self,
        node_index: usize,
        bbox: BBox,
        epsilon: f64,
        candidates: &mut Vec<usize>,
    ) {
        let node = &self.nodes[node_index];
        if !node.bbox.intersects(bbox, epsilon) {
            return;
        }
        match &node.kind {
            BBoxIndexNodeKind::Leaf(indices) => candidates.extend(indices),
            BBoxIndexNodeKind::Branch { left, right } => {
                self.collect_node_candidates(*left, bbox, epsilon, candidates);
                self.collect_node_candidates(*right, bbox, epsilon, candidates);
            }
        }
    }

    /// Visits a conservative candidate superset without allocating.
    /// Candidate order is unspecified, so this is only for order-independent
    /// predicates such as even-odd ray-crossing parity.
    fn visit_candidates(&self, bbox: BBox, epsilon: f64, mut visit: impl FnMut(usize)) -> usize {
        if force_bbox_index_full_scan() || !bbox.is_finite() || !epsilon.is_finite() {
            for item_index in 0..self.item_count {
                visit(item_index);
            }
            return self.item_count;
        }

        let mut candidate_count = self.non_finite_indices.len();
        for &item_index in &self.non_finite_indices {
            visit(item_index);
        }
        if let Some(root) = self.root {
            candidate_count += self.visit_node_candidates(root, bbox, epsilon, &mut visit);
        }
        candidate_count
    }

    fn visit_node_candidates(
        &self,
        node_index: usize,
        bbox: BBox,
        epsilon: f64,
        visit: &mut impl FnMut(usize),
    ) -> usize {
        let node = &self.nodes[node_index];
        if !node.bbox.intersects(bbox, epsilon) {
            return 0;
        }
        match &node.kind {
            BBoxIndexNodeKind::Leaf(indices) => {
                for &item_index in indices {
                    visit(item_index);
                }
                indices.len()
            }
            BBoxIndexNodeKind::Branch { left, right } => {
                self.visit_node_candidates(*left, bbox, epsilon, visit)
                    + self.visit_node_candidates(*right, bbox, epsilon, visit)
            }
        }
    }

    #[cfg(test)]
    fn query(&self, bbox: BBox, epsilon: f64) -> Vec<usize> {
        let mut candidates = Vec::new();
        self.query_into(bbox, epsilon, &mut candidates);
        candidates
    }
}

fn compare_bbox_centers(lhs: BBox, rhs: BBox, horizontal: bool) -> Ordering {
    if horizontal {
        (lhs.min_x * 0.5 + lhs.max_x * 0.5)
            .total_cmp(&(rhs.min_x * 0.5 + rhs.max_x * 0.5))
            .then_with(|| lhs.min_x.total_cmp(&rhs.min_x))
            .then_with(|| lhs.max_x.total_cmp(&rhs.max_x))
    } else {
        (lhs.min_y * 0.5 + lhs.max_y * 0.5)
            .total_cmp(&(rhs.min_y * 0.5 + rhs.max_y * 0.5))
            .then_with(|| lhs.min_y.total_cmp(&rhs.min_y))
            .then_with(|| lhs.max_y.total_cmp(&rhs.max_y))
    }
}

impl CurveSegment {
    fn start(&self) -> Point2D {
        match self {
            Self::Line { p0, .. } | Self::Quad { p0, .. } | Self::Cubic { p0, .. } => *p0,
        }
    }

    fn end(&self) -> Point2D {
        match self {
            Self::Line { p1, .. } => *p1,
            Self::Quad { p2, .. } => *p2,
            Self::Cubic { p3, .. } => *p3,
        }
    }

    fn eval(&self, t: f64) -> Point2D {
        let t = clamp_unit(t);
        match self {
            Self::Line { p0, p1 } => lerp_point(*p0, *p1, t),
            Self::Quad { p0, p1, p2 } => {
                let ab = lerp_point(*p0, *p1, t);
                let bc = lerp_point(*p1, *p2, t);
                lerp_point(ab, bc, t)
            }
            Self::Cubic { p0, p1, p2, p3 } => {
                let ab = lerp_point(*p0, *p1, t);
                let bc = lerp_point(*p1, *p2, t);
                let cd = lerp_point(*p2, *p3, t);
                let abbc = lerp_point(ab, bc, t);
                let bccd = lerp_point(bc, cd, t);
                lerp_point(abbc, bccd, t)
            }
        }
    }

    fn derivative(&self, t: f64) -> Point2D {
        let t = clamp_unit(t);
        match self {
            Self::Line { p0, p1 } => subtract_points(*p1, *p0),
            Self::Quad { p0, p1, p2 } => {
                let left = scale_point(subtract_points(*p1, *p0), 2.0 * (1.0 - t));
                let right = scale_point(subtract_points(*p2, *p1), 2.0 * t);
                add_points(left, right)
            }
            Self::Cubic { p0, p1, p2, p3 } => {
                let mt = 1.0 - t;
                let left = scale_point(subtract_points(*p1, *p0), 3.0 * mt * mt);
                let middle = scale_point(subtract_points(*p2, *p1), 6.0 * mt * t);
                let right = scale_point(subtract_points(*p3, *p2), 3.0 * t * t);
                add_points(add_points(left, middle), right)
            }
        }
    }

    fn bbox(&self) -> BBox {
        match self {
            Self::Line { p0, p1 } => BBox::from_points(&[*p0, *p1]),
            Self::Quad { p0, p1, p2 } => BBox::from_points(&[*p0, *p1, *p2]),
            Self::Cubic { p0, p1, p2, p3 } => BBox::from_points(&[*p0, *p1, *p2, *p3]),
        }
    }

    fn exact_bbox(&self) -> BBox {
        match self {
            Self::Line { p0, p1 } => BBox::from_points(&[*p0, *p1]),
            Self::Quad { p0, p1, p2 } => {
                let mut points = vec![*p0, *p2];
                for (start, control, end) in [(p0.x, p1.x, p2.x), (p0.y, p1.y, p2.y)] {
                    let denominator = start - 2.0 * control + end;
                    if denominator.abs() <= f64::EPSILON {
                        continue;
                    }
                    let t = (start - control) / denominator;
                    if t > 0.0 && t < 1.0 {
                        points.push(self.eval(t));
                    }
                }
                BBox::from_points(&points)
            }
            Self::Cubic { p0, p1, p2, p3 } => {
                let mut points = vec![*p0, *p3];
                let tolerance = GeometryTolerance::default();
                for (start, control1, control2, end) in
                    [(p0.x, p1.x, p2.x, p3.x), (p0.y, p1.y, p2.y, p3.y)]
                {
                    let cubic = -start + 3.0 * control1 - 3.0 * control2 + end;
                    let quadratic = 3.0 * start - 6.0 * control1 + 3.0 * control2;
                    let linear = -3.0 * start + 3.0 * control1;
                    for t in solve_quadratic_roots_with_coefficient_roundoff(
                        3.0 * cubic,
                        2.0 * quadratic,
                        linear,
                        [0.0; 3],
                        tolerance.parameter_epsilon,
                    ) {
                        if t > 0.0 && t < 1.0 {
                            points.push(self.eval(t));
                        }
                    }
                }
                BBox::from_points(&points)
            }
        }
    }

    fn reversed(&self) -> Self {
        match self {
            Self::Line { p0, p1 } => Self::Line { p0: *p1, p1: *p0 },
            Self::Quad { p0, p1, p2 } => Self::Quad {
                p0: *p2,
                p1: *p1,
                p2: *p0,
            },
            Self::Cubic { p0, p1, p2, p3 } => Self::Cubic {
                p0: *p3,
                p1: *p2,
                p2: *p1,
                p3: *p0,
            },
        }
    }

    fn split(&self, t: f64) -> (Self, Self) {
        let t = clamp_unit(t);
        match self {
            Self::Line { p0, p1 } => {
                let mid = lerp_point(*p0, *p1, t);
                (
                    Self::Line { p0: *p0, p1: mid },
                    Self::Line { p0: mid, p1: *p1 },
                )
            }
            Self::Quad { p0, p1, p2 } => {
                let p01 = lerp_point(*p0, *p1, t);
                let p12 = lerp_point(*p1, *p2, t);
                let mid = lerp_point(p01, p12, t);
                (
                    Self::Quad {
                        p0: *p0,
                        p1: p01,
                        p2: mid,
                    },
                    Self::Quad {
                        p0: mid,
                        p1: p12,
                        p2: *p2,
                    },
                )
            }
            Self::Cubic { p0, p1, p2, p3 } => {
                let p01 = lerp_point(*p0, *p1, t);
                let p12 = lerp_point(*p1, *p2, t);
                let p23 = lerp_point(*p2, *p3, t);
                let p012 = lerp_point(p01, p12, t);
                let p123 = lerp_point(p12, p23, t);
                let mid = lerp_point(p012, p123, t);
                (
                    Self::Cubic {
                        p0: *p0,
                        p1: p01,
                        p2: p012,
                        p3: mid,
                    },
                    Self::Cubic {
                        p0: mid,
                        p1: p123,
                        p2: p23,
                        p3: *p3,
                    },
                )
            }
        }
    }

    fn slice(&self, t0: f64, t1: f64) -> Self {
        let start = clamp_unit(t0);
        let end = clamp_unit(t1);
        if start <= 0.0 && end >= 1.0 {
            return self.clone();
        }
        let (left, _) = self.split(end);
        if start <= 0.0 {
            return left;
        }
        let relative = if end <= start {
            0.0
        } else {
            (start / end).clamp(0.0, 1.0)
        };
        let (_, slice) = left.split(relative);
        slice
    }

    fn transform(&self, matrix: AffineMatrix) -> Self {
        match self {
            Self::Line { p0, p1 } => Self::Line {
                p0: matrix.apply(*p0),
                p1: matrix.apply(*p1),
            },
            Self::Quad { p0, p1, p2 } => Self::Quad {
                p0: matrix.apply(*p0),
                p1: matrix.apply(*p1),
                p2: matrix.apply(*p2),
            },
            Self::Cubic { p0, p1, p2, p3 } => Self::Cubic {
                p0: matrix.apply(*p0),
                p1: matrix.apply(*p1),
                p2: matrix.apply(*p2),
                p3: matrix.apply(*p3),
            },
        }
    }

    fn flatten(&self, flatness: f64, out: &mut Vec<Point2D>) {
        match self {
            Self::Line { p0, p1 } => {
                if out.is_empty() {
                    out.push(*p0);
                }
                out.push(*p1);
            }
            Self::Quad { .. } | Self::Cubic { .. } => {
                if self.is_flat_enough(flatness) {
                    if out.is_empty() {
                        out.push(self.start());
                    }
                    out.push(self.end());
                    return;
                }
                let (first, second) = self.split(0.5);
                // `second` starts where `first` ended and only pushes its own
                // start when `out` is empty, so the midpoint must stay — popping
                // it here would collapse every curve to its chord.
                first.flatten(flatness, out);
                second.flatten(flatness, out);
            }
        }
    }

    fn is_flat_enough(&self, flatness: f64) -> bool {
        match self {
            Self::Line { .. } => true,
            Self::Quad { p0, p1, p2 } => point_line_distance(*p1, *p0, *p2) <= flatness,
            Self::Cubic { p0, p1, p2, p3 } => {
                point_line_distance(*p1, *p0, *p3) <= flatness
                    && point_line_distance(*p2, *p0, *p3) <= flatness
            }
        }
    }

    fn as_line(&self) -> Option<(Point2D, Point2D)> {
        match self {
            Self::Line { p0, p1 } => Some((*p0, *p1)),
            _ => None,
        }
    }
}

#[derive(Debug, Default)]
struct NodeSnapper {
    points: Vec<Point2D>,
    indices: HashMap<(i64, i64), usize>,
}

impl NodeSnapper {
    fn index_for(&mut self, point: Point2D, epsilon: f64) -> usize {
        let key = (
            quantize_number(point.x, epsilon),
            quantize_number(point.y, epsilon),
        );

        let mut best: Option<(usize, f64)> = None;
        for x in key.0.saturating_sub(1)..=key.0.saturating_add(1) {
            for y in key.1.saturating_sub(1)..=key.1.saturating_add(1) {
                let neighbor_key = (x, y);
                let Some(index) = self.indices.get(&neighbor_key).copied() else {
                    continue;
                };
                let distance = point_distance(point, self.points[index]);
                if distance > epsilon {
                    continue;
                }
                match best {
                    Some((best_index, best_distance))
                        if distance > best_distance
                            || ((distance - best_distance).abs() <= epsilon * 0.1
                                && index >= best_index) => {}
                    _ => {
                        best = Some((index, distance));
                    }
                }
            }
        }
        if let Some((index, _)) = best {
            return index;
        }

        let index = self.points.len();
        self.points.push(point);
        self.indices.insert(key, index);
        index
    }
}

fn point_line_distance(point: Point2D, line_start: Point2D, line_end: Point2D) -> f64 {
    let line = subtract_points(line_end, line_start);
    let length = point_length(line);
    if length <= 1e-12 {
        return point_distance(point, line_start);
    }
    cross(subtract_points(point, line_start), line).abs() / length
}

fn clamp_unit(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn lerp_point(left: Point2D, right: Point2D, t: f64) -> Point2D {
    Point2D {
        x: left.x + (right.x - left.x) * t,
        y: left.y + (right.y - left.y) * t,
    }
}

/// Read a `C`/`c` run: each group is `control1 control2 end`.
fn read_cubic_run(
    tokens: &[String],
    mut index: usize,
    is_relative: bool,
    mut current: Point2D,
) -> Result<SmoothRun, ShapeError> {
    let mut segments = Vec::new();
    let mut control = None;
    while let Some((mut control1, control1_index)) = try_read_point_token(tokens, index) {
        let (mut control2, control2_index) = read_point_token(tokens, control1_index)?;
        let (mut end_point, next_index) = read_point_token(tokens, control2_index)?;
        if is_relative {
            control1 = add_points(current, control1);
            control2 = add_points(current, control2);
            end_point = add_points(current, end_point);
        }
        segments.push(CurveSegment::Cubic {
            p0: current,
            p1: control1,
            p2: control2,
            p3: end_point,
        });
        control = Some(control2);
        current = end_point;
        index = next_index;
    }
    if segments.is_empty() {
        return Err(ShapeError::InvalidPathData);
    }
    Ok(SmoothRun {
        segments,
        control,
        current,
        next_index: index,
    })
}

/// Read a `Q`/`q` run: each group is `control end`.
fn read_quad_run(
    tokens: &[String],
    mut index: usize,
    is_relative: bool,
    mut current: Point2D,
) -> Result<SmoothRun, ShapeError> {
    let mut segments = Vec::new();
    let mut control = None;
    while let Some((mut point, control_index)) = try_read_point_token(tokens, index) {
        let (mut end_point, next_index) = read_point_token(tokens, control_index)?;
        if is_relative {
            point = add_points(current, point);
            end_point = add_points(current, end_point);
        }
        segments.push(CurveSegment::Quad {
            p0: current,
            p1: point,
            p2: end_point,
        });
        control = Some(point);
        current = end_point;
        index = next_index;
    }
    if segments.is_empty() {
        return Err(ShapeError::InvalidPathData);
    }
    Ok(SmoothRun {
        segments,
        control,
        current,
        next_index: index,
    })
}

/// One run of repeated smooth-curve argument groups.
struct SmoothRun {
    segments: Vec<CurveSegment>,
    /// Control point to reflect for a following smooth command of the same kind.
    control: Option<Point2D>,
    current: Point2D,
    next_index: usize,
}

/// Read an `S`/`s` run: each group is `control2 end`, with the first control
/// point reflected from the previous cubic.
fn read_smooth_cubic_run(
    tokens: &[String],
    mut index: usize,
    is_relative: bool,
    mut current: Point2D,
    previous_control: Option<Point2D>,
) -> Result<SmoothRun, ShapeError> {
    let mut segments = Vec::new();
    let mut control = previous_control;
    while let Some((mut control2, control2_index)) = try_read_point_token(tokens, index) {
        let (mut end_point, next_index) = read_point_token(tokens, control2_index)?;
        if is_relative {
            control2 = add_points(current, control2);
            end_point = add_points(current, end_point);
        }
        segments.push(CurveSegment::Cubic {
            p0: current,
            p1: reflect_control(current, control),
            p2: control2,
            p3: end_point,
        });
        control = Some(control2);
        current = end_point;
        index = next_index;
    }
    if segments.is_empty() {
        return Err(ShapeError::InvalidPathData);
    }
    Ok(SmoothRun {
        segments,
        control,
        current,
        next_index: index,
    })
}

/// Read a `T`/`t` run: each group is just `end`, with the control point
/// reflected from the previous quadratic.
fn read_smooth_quad_run(
    tokens: &[String],
    mut index: usize,
    is_relative: bool,
    mut current: Point2D,
    previous_control: Option<Point2D>,
) -> Result<SmoothRun, ShapeError> {
    let mut segments = Vec::new();
    let mut control = previous_control;
    while let Some((mut end_point, next_index)) = try_read_point_token(tokens, index) {
        if is_relative {
            end_point = add_points(current, end_point);
        }
        let reflected = reflect_control(current, control);
        segments.push(CurveSegment::Quad {
            p0: current,
            p1: reflected,
            p2: end_point,
        });
        control = Some(reflected);
        current = end_point;
        index = next_index;
    }
    if segments.is_empty() {
        return Err(ShapeError::InvalidPathData);
    }
    Ok(SmoothRun {
        segments,
        control,
        current,
        next_index: index,
    })
}

/// Reflect the previous control point through the current point.
///
/// With no previous curve of the matching kind, SVG puts the control point on
/// the current point.
fn reflect_control(current: Point2D, previous_control: Option<Point2D>) -> Point2D {
    previous_control.map_or(current, |control| Point2D {
        x: 2.0f64.mul_add(current.x, -control.x),
        y: 2.0f64.mul_add(current.y, -control.y),
    })
}

fn add_points(left: Point2D, right: Point2D) -> Point2D {
    Point2D {
        x: left.x + right.x,
        y: left.y + right.y,
    }
}

fn subtract_points(left: Point2D, right: Point2D) -> Point2D {
    Point2D {
        x: left.x - right.x,
        y: left.y - right.y,
    }
}

fn scale_point(point: Point2D, scale: f64) -> Point2D {
    Point2D {
        x: point.x * scale,
        y: point.y * scale,
    }
}

fn weighted_absolute_point_sum(terms: &[(f64, Point2D)]) -> Point2D {
    Point2D {
        x: terms
            .iter()
            .map(|(weight, point)| weight * point.x.abs())
            .sum(),
        y: terms
            .iter()
            .map(|(weight, point)| weight * point.y.abs())
            .sum(),
    }
}

fn cross_product_error_bound(
    left: Point2D,
    left_absolute_terms: Point2D,
    right: Point2D,
    right_absolute_terms: Point2D,
) -> f64 {
    // Four unit roundoffs cover the longest current coefficient construction:
    // the cubic leading term. Quad coefficients use at most three.
    const RELATIVE_BOUND: f64 = f64::EPSILON * 2.0;
    // Scale each product before summing so a finite cross product cannot lose
    // its error bound merely because the unscaled absolute-value sum overflows.
    let product_magnitude =
        (RELATIVE_BOUND * left.x * right.y).abs() + (RELATIVE_BOUND * left.y * right.x).abs();
    let operand_roundoff = (RELATIVE_BOUND * left_absolute_terms.x) * right.y.abs()
        + (RELATIVE_BOUND * left.x.abs()) * right_absolute_terms.y
        + (RELATIVE_BOUND * left_absolute_terms.y) * right.x.abs()
        + (RELATIVE_BOUND * left.y.abs()) * right_absolute_terms.x;
    product_magnitude + operand_roundoff
}

fn cross(left: Point2D, right: Point2D) -> f64 {
    left.x * right.y - left.y * right.x
}

fn dot(left: Point2D, right: Point2D) -> f64 {
    left.x * right.x + left.y * right.y
}

fn point_length(point: Point2D) -> f64 {
    (point.x * point.x + point.y * point.y).sqrt()
}

fn point_distance(left: Point2D, right: Point2D) -> f64 {
    point_length(subtract_points(left, right))
}

fn segment_spatial_extent(segment: &CurveSegment) -> f64 {
    let bbox = segment.bbox();
    (bbox.max_x - bbox.min_x).hypot(bbox.max_y - bbox.min_y)
}

fn points_close(left: Point2D, right: Point2D, epsilon: f64) -> bool {
    point_distance(left, right) <= epsilon
}

fn normalize_point(point: Point2D) -> Option<Point2D> {
    let length = point_length(point);
    if length <= 1e-12 {
        return None;
    }
    Some(scale_point(point, 1.0 / length))
}

fn point_angle(point: Point2D) -> f64 {
    point.y.atan2(point.x)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shape_error_runtime_origin_test(error: &ShapeError) -> &'static str {
        match error {
            ShapeError::BooleanChildCount
            | ShapeError::InvalidPathData
            | ShapeError::UnsupportedPathCommand(_)
            | ShapeError::BooleanTopology
            | ShapeError::DuplicatePartId(_)
            | ShapeError::PathMeasureMultipleSubpaths
            | ShapeError::PathMeasureZeroLength
            | ShapeError::PathMeasureComplexityLimit => {
                "error_reachability::parse_and_part_errors_have_runtime_origins"
            }
            ShapeError::BooleanPairLimit
            | ShapeError::RegionClipInterval
            | ShapeError::RegionClipNonMonotonic => {
                "error_reachability::region_operation_limits_and_clip_preconditions_have_runtime_origins"
            }
            ShapeError::GeometryDepthLimit => {
                "error_reachability::geometry_depth_limit_has_a_runtime_origin"
            }
            ShapeError::PathOffsetGeometry => {
                "open_path_measurement::offset_band_rejects_an_authored_cusp"
            }
            ShapeError::PathOffsetSampleLimit => {
                "open_path_measurement::original_curve_offset_band_is_filled_and_budgeted"
            }
        }
    }

    #[test]
    fn shape_error_variants_name_runtime_origin_tests() {
        assert_eq!(
            shape_error_runtime_origin_test(&ShapeError::GeometryDepthLimit),
            "error_reachability::geometry_depth_limit_has_a_runtime_origin"
        );
        assert_eq!(
            shape_error_runtime_origin_test(&ShapeError::PathOffsetSampleLimit),
            "open_path_measurement::original_curve_offset_band_is_filled_and_budgeted"
        );
    }

    #[test]
    fn measured_path_table_is_finite_and_strictly_increasing() {
        let measured =
            measure_single_svg_path("M0 0Q50 100 100 0C125 -50 175 -50 200 0A50 50 0 0 1 250 50")
                .expect("measured path");

        assert!(measured.points.len() > 4);
        assert_eq!(measured.points[0].cumulative_length, 0.0);
        assert_eq!(
            measured.points.last().map(|point| point.cumulative_length),
            Some(measured.total_length),
        );
        for measured_point in &measured.points {
            assert!(point_is_finite(measured_point.point));
            assert!(measured_point.cumulative_length.is_finite());
        }
        for measured_point_pair in measured.points.windows(2) {
            assert!(
                measured_point_pair[0].cumulative_length < measured_point_pair[1].cumulative_length
            );
        }
    }

    fn rect_path() -> GeometryNode {
        GeometryNode::Path {
            node_id: None,
            d: "M16 0H184V80H16Z".to_string(),
            fill_rule: None,
        }
    }

    fn full_rect_path(width: f64, height: f64) -> GeometryNode {
        GeometryNode::Path {
            node_id: None,
            d: format!("M0 0H{width}V{height}H0Z"),
            fill_rule: None,
        }
    }

    #[test]
    fn parse_path_region_normalizes_hv_into_line_commands() {
        let region = evaluate_geometry(&GeometryDoc {
            view_box: GeometryViewBox {
                x: 0.0,
                y: 0.0,
                width: 24.0,
                height: 24.0,
            },
            root: GeometryNode::Path {
                node_id: None,
                d: "M0 0H24V24H0Z".to_string(),
                fill_rule: None,
            },
        })
        .expect("geometry should parse");
        assert_eq!(region.contours.len(), 1);
        assert_eq!(region.contours[0].segments.len(), 4);
        assert_eq!(region_to_path(&region), "M0,0L24,0L24,24L0,24Z");
    }

    #[test]
    fn evaluate_geometry_supports_relative_commands() {
        let region = evaluate_geometry(&GeometryDoc {
            view_box: GeometryViewBox {
                x: 0.0,
                y: 0.0,
                width: 24.0,
                height: 24.0,
            },
            root: GeometryNode::Path {
                node_id: None,
                d: "m0 0l10 0l0 10z".to_string(),
                fill_rule: None,
            },
        })
        .expect("relative commands should normalize");
        assert_eq!(region_to_path(&region), "M0,0L10,0L10,10Z");
    }

    #[test]
    fn evaluate_geometry_supports_arc_commands() {
        let region = evaluate_geometry(&GeometryDoc {
            view_box: GeometryViewBox {
                x: 0.0,
                y: 0.0,
                width: 120.0,
                height: 120.0,
            },
            root: GeometryNode::Path {
                node_id: None,
                d: "M80 20A20 20 0 1 1 40 20Z".to_string(),
                fill_rule: None,
            },
        })
        .expect("arc commands should normalize");
        let path = region_to_path(&region);
        assert!(path.starts_with("M80,20C"));
        assert!(path.ends_with('Z'));
    }

    #[test]
    fn evaluate_geometry_implicitly_closes_open_subpaths_for_fill() {
        let region = evaluate_geometry(&GeometryDoc {
            view_box: GeometryViewBox {
                x: 0.0,
                y: 0.0,
                width: 120.0,
                height: 120.0,
            },
            root: GeometryNode::Path {
                node_id: None,
                d: "M0 0L60 0L60 60".to_string(),
                fill_rule: None,
            },
        })
        .expect("SVG fill semantics close an open subpath");
        assert_eq!(region_to_path(&region), "M0,0L60,0L60,60Z");
    }

    #[test]
    fn evaluate_geometry_normalizes_self_intersections() {
        let region = evaluate_geometry(&GeometryDoc {
            view_box: GeometryViewBox {
                x: 0.0,
                y: 0.0,
                width: 120.0,
                height: 120.0,
            },
            root: GeometryNode::Path {
                node_id: None,
                d: "M0 0L120 120L0 120L120 0Z".to_string(),
                fill_rule: None,
            },
        })
        .expect("self-intersections should normalize");
        assert!(!region.contours.is_empty());
    }

    #[test]
    fn evaluate_geometry_normalizes_a_rotated_self_intersecting_glyph_outline() {
        let path_data = "M173.44,104.74L163.21,86.48L165.82,86.07L171.75,96.92Q172.26,97.85 173.05,99.42Q173.84,100.99 174.93,103.3L174.45,103.38Q174.76,100.78 175.02,99.08Q175.28,97.37 175.46,96.33L177.62,84.18L180.25,83.76L176.29,104.29L173.44,104.74Z";
        let region = parse_path_region(path_data, None).expect("glyph outline should normalize");
        assert!(!region.contours.is_empty());
        assert!(region_axis_bounds(&region).is_some());
    }

    #[test]
    fn evaluate_geometry_normalizes_a_looping_japanese_glyph_outline() {
        let path_data = concat!(
            "M351.24,66.9Q349.92,66.9 349.02,66.68Q348.12,66.47 347.68,66.09",
            "Q347.24,65.71 347.24,65.2Q347.24,64.86 347.45,64.54Q347.66,64.22 348.09,63.96",
            "Q348.52,63.7 349.15,63.55Q349.78,63.4 350.58,63.4Q351.58,63.4 352.36,63.67",
            "Q353.14,63.93 353.6,64.37Q354.06,64.82 354.06,65.34Q354.06,65.98 353.53,66.41",
            "Q353,66.83 352.09,67.05Q351.18,67.27 350.02,67.27Q349.02,67.27 347.98,67.11",
            "Q346.94,66.95 345.98,66.58Q345.02,66.22 344.23,65.58Q343.44,64.95 342.92,63.98",
            "L344.24,63.25Q344.56,64 345.06,64.59Q345.56,65.18 346.28,65.59",
            "Q347,66 347.96,66.21Q348.92,66.42 350.16,66.42Q351.52,66.42 352.12,66.11",
            "Q352.72,65.79 352.72,65.34Q352.72,65.05 352.47,64.8Q352.22,64.55 351.74,64.39",
            "Q351.26,64.23 350.6,64.23Q349.66,64.23 349.14,64.56Q348.62,64.9 348.62,65.35",
            "Q348.62,65.69 348.97,65.93Q349.32,66.17 350.03,66.28Q350.74,66.38 351.8,66.29",
            "L351.24,66.9Z"
        );
        let region = parse_path_region(path_data, None).expect("glyph outline should normalize");
        assert!(!region.contours.is_empty());
        assert!(region_axis_bounds(&region).is_some());
    }

    #[test]
    fn compile_geometry_to_svg_document_bakes_viewport_scale() {
        let svg = compile_geometry_to_svg_document(
            &GeometryDoc {
                view_box: GeometryViewBox {
                    x: 0.0,
                    y: 0.0,
                    width: 200.0,
                    height: 120.0,
                },
                root: rect_path(),
            },
            Some(&CompileGeometryOptions {
                viewport: Some(GeometryViewport {
                    width: 400.0,
                    height: 240.0,
                }),
                ..CompileGeometryOptions::default()
            }),
        )
        .expect("svg compile should succeed");

        assert!(svg.contains("viewBox=\"0 0 400 240\""));
        assert!(svg.contains("d=\"M32,0L368,0L368,160L32,160Z\""));
    }

    #[test]
    fn compile_geometry_to_svg_document_honors_preserve_aspect_ratio() {
        let geometry = GeometryDoc {
            view_box: GeometryViewBox {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 50.0,
            },
            root: full_rect_path(100.0, 50.0),
        };
        let cases = [
            (
                GeometryPreserveAspectRatio::None,
                "M0,0L200,0L200,200L0,200Z",
            ),
            (
                GeometryPreserveAspectRatio::Meet,
                "M0,50L200,50L200,150L0,150Z",
            ),
            (
                GeometryPreserveAspectRatio::Slice,
                "M-100,0L300,0L300,200L-100,200Z",
            ),
        ];

        for (preserve_aspect_ratio, expected_path) in cases {
            let svg = compile_geometry_to_svg_document(
                &geometry,
                Some(&CompileGeometryOptions {
                    viewport: Some(GeometryViewport {
                        width: 200.0,
                        height: 200.0,
                    }),
                    preserve_aspect_ratio,
                    ..CompileGeometryOptions::default()
                }),
            )
            .expect("svg compile should succeed");
            assert!(
                svg.contains(expected_path),
                "preserve_aspect_ratio={preserve_aspect_ratio:?}, svg={svg}"
            );
        }
    }

    #[test]
    fn compile_geometry_to_svg_document_insets_by_half_stroke_width() {
        let cases = [
            (1.0, "M0.5,0.5L399.5,0.5L399.5,239.5L0.5,239.5Z"),
            (2.0, "M1,1L399,1L399,239L1,239Z"),
            (4.0, "M2,2L398,2L398,238L2,238Z"),
            (8.0, "M4,4L396,4L396,236L4,236Z"),
        ];

        for (stroke_width, expected_path) in cases {
            let svg = compile_geometry_to_svg_document(
                &GeometryDoc {
                    view_box: GeometryViewBox {
                        x: 0.0,
                        y: 0.0,
                        width: 200.0,
                        height: 120.0,
                    },
                    root: full_rect_path(200.0, 120.0),
                },
                Some(&CompileGeometryOptions {
                    paint: Some(GeometryPaint {
                        fill: Some("#0f172a".to_string()),
                        stroke: Some("#475569".to_string()),
                        stroke_width: Some(stroke_width),
                        ..GeometryPaint::default()
                    }),
                    viewport: Some(GeometryViewport {
                        width: 400.0,
                        height: 240.0,
                    }),
                    ..CompileGeometryOptions::default()
                }),
            )
            .expect("svg compile should succeed");

            assert!(
                svg.contains(expected_path),
                "stroke_width={stroke_width} should inset path by half the stroke width, svg={svg}"
            );
        }
    }

    #[test]
    fn subtract_boolean_returns_notched_boundary_without_clip_path() {
        let svg = compile_geometry_to_svg_document(
            &GeometryDoc {
                view_box: GeometryViewBox {
                    x: 0.0,
                    y: 0.0,
                    width: 300.0,
                    height: 200.0,
                },
                root: GeometryNode::Boolean {
                    node_id: None,
                    op: BooleanOp::Subtract,
                    children: vec![
                        GeometryNode::Path {
                            node_id: None,
                            d: "M16 0H284V200H16Z".to_string(),
                            fill_rule: None,
                        },
                        GeometryNode::Path {
                            node_id: None,
                            d: "M150 0Q150 30 125 30Q100 30 100 0Z".to_string(),
                            fill_rule: None,
                        },
                    ],
                },
            },
            Some(&CompileGeometryOptions {
                paint: Some(GeometryPaint {
                    fill: Some("#0f172a".to_string()),
                    stroke: Some("#475569".to_string()),
                    stroke_width: Some(2.0),
                    ..GeometryPaint::default()
                }),
                ..CompileGeometryOptions::default()
            }),
        )
        .expect("svg compile should succeed");

        assert!(!svg.contains("clip-path="));
        assert!(svg.contains("<path d=\"M"));
        assert!(svg.contains('L'));
        assert!(svg.matches("<path d=").count() >= 1);
        assert!(svg.contains("stroke=\"#475569\""));
    }

    #[test]
    fn xor_boolean_returns_compound_region() {
        let region = boolean_regions(
            &evaluate_geometry(&GeometryDoc {
                view_box: GeometryViewBox {
                    x: 0.0,
                    y: 0.0,
                    width: 140.0,
                    height: 120.0,
                },
                root: GeometryNode::Path {
                    node_id: None,
                    d: "M60 60C60 93.137 33.137 120 0 120C-33.137 120 -60 93.137 -60 60C-60 26.863 -33.137 0 0 0C33.137 0 60 26.863 60 60Z".to_string(),
                    fill_rule: None,
                },
            })
            .expect("lhs should parse"),
            &evaluate_geometry(&GeometryDoc {
                view_box: GeometryViewBox {
                    x: 0.0,
                    y: 0.0,
                    width: 140.0,
                    height: 120.0,
                },
                root: GeometryNode::Path {
                    node_id: None,
                    d: "M140 60C140 93.137 113.137 120 80 120C46.863 120 20 93.137 20 60C20 26.863 46.863 0 80 0C113.137 0 140 26.863 140 60Z".to_string(),
                    fill_rule: None,
                },
            })
            .expect("rhs should parse"),
            BooleanOp::Xor,
        )
        .expect("xor should succeed");

        assert!(!region.contours.is_empty());
    }

    #[test]
    fn divide_regions_returns_subtract_and_intersect() {
        let lhs = evaluate_geometry(&GeometryDoc {
            view_box: GeometryViewBox {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            },
            root: GeometryNode::Path {
                node_id: None,
                d: "M0 0H100V100H0Z".to_string(),
                fill_rule: None,
            },
        })
        .expect("lhs should parse");
        let rhs = evaluate_geometry(&GeometryDoc {
            view_box: GeometryViewBox {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            },
            root: GeometryNode::Path {
                node_id: None,
                d: "M25 25H75V75H25Z".to_string(),
                fill_rule: None,
            },
        })
        .expect("rhs should parse");

        let divided = divide_regions(&lhs, &rhs).expect("divide should succeed");
        assert!(!divided.subtract.contours.is_empty());
        assert!(!divided.intersect.contours.is_empty());
    }

    #[test]
    fn intersections_between_geometries_reports_points_and_indices() {
        let intersections = intersections_between_geometries(
            &GeometryDoc {
                view_box: GeometryViewBox {
                    x: 0.0,
                    y: 0.0,
                    width: 120.0,
                    height: 120.0,
                },
                root: GeometryNode::Path {
                    node_id: None,
                    d: "M10 60L60 10L110 60L60 110Z".to_string(),
                    fill_rule: None,
                },
            },
            &GeometryDoc {
                view_box: GeometryViewBox {
                    x: 0.0,
                    y: 0.0,
                    width: 120.0,
                    height: 120.0,
                },
                root: GeometryNode::Path {
                    node_id: None,
                    d: "M45 15H105V75H45Z".to_string(),
                    fill_rule: None,
                },
            },
        )
        .expect("intersection query should succeed");

        assert!(!intersections.is_empty());
        assert_eq!(intersections[0].contour_index_a, 0);
        assert_eq!(intersections[0].contour_index_b, 0);
    }

    #[test]
    fn evaluate_geometry_supports_nested_boolean_and_transform_nodes() {
        let region = evaluate_geometry(&GeometryDoc {
            view_box: GeometryViewBox {
                x: 0.0,
                y: 0.0,
                width: 220.0,
                height: 120.0,
            },
            root: GeometryNode::Transform {
                node_id: None,
                transform: Transform2D {
                    translate_x: Some(20.0),
                    translate_y: Some(10.0),
                    ..Transform2D::default()
                },
                child: Box::new(GeometryNode::Boolean {
                    node_id: None,
                    op: BooleanOp::Union,
                    children: vec![
                        GeometryNode::Boolean {
                            node_id: None,
                            op: BooleanOp::Subtract,
                            children: vec![
                                GeometryNode::Path {
                                    node_id: None,
                                    d: "M0 0H120V80H0Z".to_string(),
                                    fill_rule: None,
                                },
                                GeometryNode::Path {
                                    node_id: None,
                                    d: "M70 0Q70 30 50 30Q30 30 30 0Z".to_string(),
                                    fill_rule: None,
                                },
                            ],
                        },
                        GeometryNode::Path {
                            node_id: None,
                            d: "M110 20H180V70H110Z".to_string(),
                            fill_rule: None,
                        },
                    ],
                }),
            },
        })
        .expect("nested boolean with transform should evaluate");

        let path = region_to_path(&region);
        assert!(path.starts_with("M20,10"));
        assert!(path.contains("L200,30"));
    }

    #[test]
    fn resolve_symbol_geometry_stretches_elastic_segments() {
        let symbol = SymbolDefinition {
            geometry: GeometryDoc {
                view_box: GeometryViewBox {
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 20.0,
                },
                root: GeometryNode::Group {
                    node_id: None,
                    children: vec![
                        GeometryNode::Path {
                            node_id: Some("shaft".to_string()),
                            d: "M10 8H70V12H10Z".to_string(),
                            fill_rule: None,
                        },
                        GeometryNode::Path {
                            node_id: Some("head".to_string()),
                            d: "M70 4L100 10L70 16Z".to_string(),
                            fill_rule: None,
                        },
                    ],
                },
            },
            elastic_segments: vec![
                ElasticSegment {
                    node_id: "shaft".to_string(),
                    axis: "x".to_string(),
                    role: ElasticSegmentRole::Stretch,
                    frame: ElasticFrame {
                        x: 10.0,
                        y: 0.0,
                        width: 60.0,
                        height: 20.0,
                    },
                },
                ElasticSegment {
                    node_id: "head".to_string(),
                    axis: "x".to_string(),
                    role: ElasticSegmentRole::FixedEnd,
                    frame: ElasticFrame {
                        x: 70.0,
                        y: 0.0,
                        width: 30.0,
                        height: 20.0,
                    },
                },
            ],
        };

        let resolved = resolve_symbol_geometry(
            &symbol,
            &SymbolResolutionOptions {
                width: 160.0,
                height: 20.0,
            },
        )
        .expect("symbol should resolve");
        let compiled =
            compile_geometry_to_svg_document(&resolved, None).expect("svg compile should succeed");

        assert!(compiled.contains("M10,8L130,8L130,12L10,12Z"));
        assert!(compiled.contains("M130,4L160,10L130,16Z"));
    }

    #[test]
    fn resolve_symbol_geometry_applies_both_axes_to_the_same_node() {
        let symbol = SymbolDefinition {
            geometry: GeometryDoc {
                view_box: GeometryViewBox {
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 100.0,
                },
                root: GeometryNode::Path {
                    node_id: Some("body".to_string()),
                    d: "M0 0H100V100H0Z".to_string(),
                    fill_rule: None,
                },
            },
            elastic_segments: vec![
                ElasticSegment {
                    node_id: "body".to_string(),
                    axis: "x".to_string(),
                    role: ElasticSegmentRole::Stretch,
                    frame: ElasticFrame {
                        x: 0.0,
                        y: 0.0,
                        width: 100.0,
                        height: 100.0,
                    },
                },
                ElasticSegment {
                    node_id: "body".to_string(),
                    axis: "y".to_string(),
                    role: ElasticSegmentRole::Stretch,
                    frame: ElasticFrame {
                        x: 0.0,
                        y: 0.0,
                        width: 100.0,
                        height: 100.0,
                    },
                },
            ],
        };

        let resolved = resolve_symbol_geometry(
            &symbol,
            &SymbolResolutionOptions {
                width: 200.0,
                height: 200.0,
            },
        )
        .expect("symbol should resolve");
        let parts = evaluate_geometry_parts(&resolved).expect("resolved parts");
        assert_eq!(parts[0].bounds.unwrap().width, 200.0);
        assert_eq!(parts[0].bounds.unwrap().height, 200.0);
    }
}

#[cfg(test)]
mod touch_point_boolean_tests {
    use super::*;

    fn region(d: &str) -> Region {
        parse_path_region(d, None).expect("parse")
    }

    /// Regression: a normalized self-intersecting path leaves two contours
    /// meeting at a point; a boolean with an operand that bridges that touch
    /// point failed with "could not reconstruct a closed boundary".
    #[test]
    fn boolean_with_operand_bridging_touch_point() {
        // Bow-tie already normalized into two triangles sharing (50,50).
        let bow_tie = region("M10,10L90,10L50,50Z M50,50L90,90L10,90Z");
        let bridge = region("M40,40H60V60H40Z");

        for op in [
            BooleanOp::Union,
            BooleanOp::Subtract,
            BooleanOp::Intersect,
            BooleanOp::Xor,
        ] {
            let result = boolean_regions(&bow_tie, &bridge, op);
            assert!(
                result.is_ok(),
                "boolean {op:?} with touch-point bridge must succeed: {:?}",
                result.err()
            );
        }
    }

    /// Determinism: repeated evaluation must produce identical output.
    #[test]
    fn boolean_touch_point_is_deterministic() {
        let bow_tie = region("M10,10L90,10L50,50Z M50,50L90,90L10,90Z");
        let bridge = region("M40,40H60V60H40Z");
        let first = boolean_regions(&bow_tie, &bridge, BooleanOp::Union).expect("union");
        for _ in 0..10 {
            let again = boolean_regions(&bow_tie, &bridge, BooleanOp::Union).expect("union");
            assert_eq!(first, again);
        }
    }
}

#[cfg(test)]
mod line_intersection_symmetry_tests {
    use super::*;

    fn assert_swapped_intersections(left: (Point2D, Point2D), right: (Point2D, Point2D)) {
        let tolerance = GeometryTolerance::default();
        let mut forward_pairs = line_line_intersections(left, right, tolerance)
            .into_iter()
            .map(|intersection| (intersection.t_a, intersection.t_b))
            .collect::<Vec<_>>();
        let mut reversed_pairs = line_line_intersections(right, left, tolerance)
            .into_iter()
            .map(|intersection| (intersection.t_b, intersection.t_a))
            .collect::<Vec<_>>();
        let pair_order = |lhs: &(f64, f64), rhs: &(f64, f64)| {
            lhs.0
                .total_cmp(&rhs.0)
                .then_with(|| lhs.1.total_cmp(&rhs.1))
        };
        forward_pairs.sort_by(pair_order);
        reversed_pairs.sort_by(pair_order);

        assert_eq!(
            forward_pairs.len(),
            reversed_pairs.len(),
            "left={left:?} right={right:?} forward={forward_pairs:?} reversed={reversed_pairs:?}"
        );
        for (forward_pair, reversed_pair) in forward_pairs.iter().zip(&reversed_pairs) {
            assert!(
                (forward_pair.0 - reversed_pair.0).abs() <= 1e-9
                    && (forward_pair.1 - reversed_pair.1).abs() <= 1e-9,
                "left={left:?} right={right:?} forward={forward_pairs:?} reversed={reversed_pairs:?}"
            );
        }
    }

    fn assert_line_cubic_intersection_invariant(
        line: &CurveSegment,
        cubic: &CurveSegment,
        expected_line_parameter: f64,
        expected_curve_parameter: f64,
        expected_count: usize,
    ) {
        let CurveSegment::Cubic { p0, p1, p2, p3 } = cubic else {
            panic!("expected a cubic segment");
        };
        let reversed_cubic = CurveSegment::Cubic {
            p0: *p3,
            p1: *p2,
            p2: *p1,
            p3: *p0,
        };
        let reversed_curve_parameter = 1.0 - expected_curve_parameter;
        let tolerance = GeometryTolerance::default();
        let cases = [
            (
                intersect_curve_segments(line, cubic, tolerance),
                expected_line_parameter,
                expected_curve_parameter,
            ),
            (
                intersect_curve_segments(cubic, line, tolerance),
                expected_curve_parameter,
                expected_line_parameter,
            ),
            (
                intersect_curve_segments(line, &reversed_cubic, tolerance),
                expected_line_parameter,
                reversed_curve_parameter,
            ),
            (
                intersect_curve_segments(&reversed_cubic, line, tolerance),
                reversed_curve_parameter,
                expected_line_parameter,
            ),
        ];
        for (intersections, expected_t_a, expected_t_b) in cases {
            assert_eq!(
                intersections.len(),
                expected_count,
                "intersections={intersections:?}"
            );
            assert!(
                intersections.iter().any(|intersection| {
                    (intersection.t_a - expected_t_a).abs() <= 1e-6
                        && (intersection.t_b - expected_t_b).abs() <= 1e-6
                }),
                "expected ({expected_t_a}, {expected_t_b}), intersections={intersections:?}"
            );
        }
    }

    #[test]
    fn separated_parallel_segments_stay_disjoint_when_operands_swap() {
        let long_segment = (Point2D { x: 0.0, y: 0.0 }, Point2D { x: 100.0, y: 0.0 });
        let short_segment = (
            Point2D { x: 50.0, y: 0.001 },
            Point2D { x: 50.01, y: 0.001 },
        );
        let tolerance = GeometryTolerance::default();

        let forward = line_line_intersections(long_segment, short_segment, tolerance);
        let reversed = line_line_intersections(short_segment, long_segment, tolerance);

        assert!(forward.is_empty(), "forward={forward:?}");
        assert!(reversed.is_empty(), "reversed={reversed:?}");
    }

    #[test]
    fn short_perpendicular_segments_report_only_their_crossing() {
        let horizontal = (Point2D { x: 0.0, y: 0.0 }, Point2D { x: 0.01, y: 0.0 });
        let vertical = (
            Point2D {
                x: 0.005,
                y: -0.005,
            },
            Point2D { x: 0.005, y: 0.005 },
        );

        for intersections in [
            line_line_intersections(horizontal, vertical, GeometryTolerance::default()),
            line_line_intersections(vertical, horizontal, GeometryTolerance::default()),
        ] {
            assert_eq!(intersections.len(), 1, "intersections={intersections:?}");
            assert!(
                (intersections[0].t_a - 0.5).abs() <= 1e-12,
                "intersections={intersections:?}"
            );
            assert!(
                (intersections[0].t_b - 0.5).abs() <= 1e-12,
                "intersections={intersections:?}"
            );
        }
    }

    #[test]
    fn tiny_perpendicular_segments_report_only_their_crossing() {
        let horizontal = (
            Point2D { x: 0.0, y: 0.0 },
            Point2D {
                x: 0.000_01,
                y: 0.0,
            },
        );
        let vertical = (
            Point2D {
                x: 0.000_005,
                y: -0.000_005,
            },
            Point2D {
                x: 0.000_005,
                y: 0.000_005,
            },
        );

        for intersections in [
            line_line_intersections(horizontal, vertical, GeometryTolerance::default()),
            line_line_intersections(vertical, horizontal, GeometryTolerance::default()),
        ] {
            assert_eq!(intersections.len(), 1, "intersections={intersections:?}");
            assert!((intersections[0].t_a - 0.5).abs() <= 1e-12);
            assert!((intersections[0].t_b - 0.5).abs() <= 1e-12);
        }
    }

    #[test]
    fn sub_epsilon_segment_still_reports_a_transverse_crossing() {
        let short_horizontal = (Point2D { x: 0.0, y: 0.0 }, Point2D { x: 0.00005, y: 0.0 });
        let vertical = (
            Point2D {
                x: 0.000_025,
                y: -1.0,
            },
            Point2D {
                x: 0.000_025,
                y: 1.0,
            },
        );

        for intersections in [
            line_line_intersections(short_horizontal, vertical, GeometryTolerance::default()),
            line_line_intersections(vertical, short_horizontal, GeometryTolerance::default()),
        ] {
            assert_eq!(intersections.len(), 1, "intersections={intersections:?}");
            assert!((intersections[0].t_a - 0.5).abs() <= f64::EPSILON);
            assert!((intersections[0].t_b - 0.5).abs() <= f64::EPSILON);
        }
    }

    #[test]
    fn shallow_angle_segments_report_their_interior_crossing() {
        let horizontal = (Point2D { x: 0.0, y: 0.0 }, Point2D { x: 1_000.0, y: 0.0 });
        let shallow_crossing = (
            Point2D { x: 0.0, y: -0.0005 },
            Point2D {
                x: 1_000.0,
                y: 0.0005,
            },
        );

        for intersections in [
            line_line_intersections(horizontal, shallow_crossing, GeometryTolerance::default()),
            line_line_intersections(shallow_crossing, horizontal, GeometryTolerance::default()),
        ] {
            assert_eq!(intersections.len(), 1, "intersections={intersections:?}");
            assert!((intersections[0].t_a - 0.5).abs() <= 1e-12);
            assert!((intersections[0].t_b - 0.5).abs() <= 1e-12);
        }
    }

    #[test]
    fn short_nearly_collinear_segments_preserve_both_overlap_splits() {
        let left = (Point2D { x: 0.0, y: 0.0 }, Point2D { x: 0.001, y: 0.0 });
        let right = (
            Point2D { x: 0.0005, y: 0.0 },
            Point2D {
                x: 0.0015,
                y: 0.000_000_01,
            },
        );

        for intersections in [
            line_line_intersections(left, right, GeometryTolerance::default()),
            line_line_intersections(right, left, GeometryTolerance::default()),
        ] {
            assert_eq!(intersections.len(), 2, "intersections={intersections:?}");
        }
        assert_swapped_intersections(left, right);
    }

    #[test]
    fn near_parallel_segments_only_report_their_actual_shared_endpoint() {
        let horizontal = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D { x: 1_000.0, y: 0.0 },
        };
        let diverging = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D {
                x: 1_000.0,
                y: 0.0005,
            },
        };
        let tolerance = GeometryTolerance::default();

        for intersections in [
            intersect_curve_segments(&horizontal, &diverging, tolerance),
            intersect_curve_segments(&diverging, &horizontal, tolerance),
        ] {
            assert_eq!(intersections.len(), 1, "intersections={intersections:?}");
            assert_eq!(intersections[0].t_a, 0.0);
            assert_eq!(intersections[0].t_b, 0.0);
        }
    }

    #[test]
    fn line_intersections_are_symmetric_across_scale_grid() {
        let lengths = [0.0002, 0.001, 0.01, 1.0, 100.0];
        let offsets = [0.0, 0.00005, 0.001];
        let angles = [0.0, 1e-7, 1e-5, PI / 4.0, PI / 2.0];

        for left_length in lengths {
            let left = (
                Point2D { x: 0.0, y: 0.0 },
                Point2D {
                    x: left_length,
                    y: 0.0,
                },
            );
            for right_length in lengths {
                for offset in offsets {
                    for angle in angles {
                        let center = Point2D {
                            x: left_length * 0.5,
                            y: offset,
                        };
                        let half_delta = Point2D {
                            x: angle.cos() * right_length * 0.5,
                            y: angle.sin() * right_length * 0.5,
                        };
                        let right = (
                            subtract_points(center, half_delta),
                            add_points(center, half_delta),
                        );
                        assert_swapped_intersections(left, right);
                    }
                }
            }
        }
    }

    #[test]
    fn short_real_corner_is_not_merged_as_a_straight_line() {
        let left = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D { x: 0.011, y: 0.0 },
        };
        let right = CurveSegment::Line {
            p0: Point2D { x: 0.011, y: 0.0 },
            p1: Point2D {
                x: 0.011 + 0.011 * (PI / 6.0).cos(),
                y: 0.011 * (PI / 6.0).sin(),
            },
        };

        assert!(merge_line_segments(&left, &right, GeometryTolerance::default()).is_none());
    }

    #[test]
    fn aligned_line_segments_still_merge() {
        let left = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D { x: 1.0, y: 0.0 },
        };
        let right = CurveSegment::Line {
            p0: Point2D { x: 1.0, y: 0.0 },
            p1: Point2D { x: 2.0, y: 0.0 },
        };

        assert_eq!(
            merge_line_segments(&left, &right, GeometryTolerance::default()),
            Some(CurveSegment::Line {
                p0: Point2D { x: 0.0, y: 0.0 },
                p1: Point2D { x: 2.0, y: 0.0 },
            })
        );
    }

    #[test]
    fn large_scale_kink_outside_angular_tolerance_is_not_merged() {
        let left = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D { x: 100.0, y: 0.0 },
        };
        let right = CurveSegment::Line {
            p0: Point2D { x: 100.0, y: 0.0 },
            p1: Point2D {
                x: 200.0,
                y: 0.0002,
            },
        };

        assert!(merge_line_segments(&left, &right, GeometryTolerance::default()).is_none());
    }

    #[test]
    fn large_scale_nearly_aligned_segments_merge_within_tolerances() {
        let left = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D { x: 100.0, y: 0.0 },
        };
        let right = CurveSegment::Line {
            p0: Point2D { x: 100.0, y: 0.0 },
            p1: Point2D {
                x: 200.0,
                y: 0.00005,
            },
        };

        assert_eq!(
            merge_line_segments(&left, &right, GeometryTolerance::default()),
            Some(CurveSegment::Line {
                p0: Point2D { x: 0.0, y: 0.0 },
                p1: Point2D {
                    x: 200.0,
                    y: 0.00005,
                },
            })
        );
    }

    #[test]
    fn line_quadratic_crossing_is_invariant_across_subpixel_scales() {
        let intersections_at_scale = |scale: f64| {
            let line = (Point2D { x: 0.0, y: 0.0 }, Point2D { x: scale, y: 0.0 });
            let quadratic = CurveSegment::Quad {
                p0: Point2D {
                    x: scale * 0.5,
                    y: -scale,
                },
                p1: Point2D {
                    x: scale * 0.5,
                    y: 0.0,
                },
                p2: Point2D {
                    x: scale * 0.5,
                    y: scale,
                },
            };
            line_curve_intersections(line, &quadratic, GeometryTolerance::default())
        };

        for intersections in [
            intersections_at_scale(0.0005),
            intersections_at_scale(0.005),
            intersections_at_scale(0.05),
        ] {
            assert_eq!(intersections.len(), 1, "intersections={intersections:?}");
            assert!((intersections[0].t_a - 0.5).abs() <= 1e-12);
            assert!((intersections[0].t_b - 0.5).abs() <= 1e-12);
        }
    }

    #[test]
    fn line_cubic_crossing_is_invariant_across_subpixel_scales() {
        let intersections_at_scale = |scale: f64| {
            let line = CurveSegment::Line {
                p0: Point2D { x: 0.0, y: 0.0 },
                p1: Point2D { x: scale, y: 0.0 },
            };
            let cubic = CurveSegment::Cubic {
                p0: Point2D {
                    x: scale * 0.5,
                    y: -scale,
                },
                p1: Point2D {
                    x: scale * 0.5,
                    y: -scale,
                },
                p2: Point2D {
                    x: scale * 0.5,
                    y: scale,
                },
                p3: Point2D {
                    x: scale * 0.5,
                    y: scale,
                },
            };
            (
                intersect_curve_segments(&line, &cubic, GeometryTolerance::default()),
                intersect_curve_segments(&cubic, &line, GeometryTolerance::default()),
            )
        };

        for scale in [0.0005, 0.005, 0.05] {
            let (forward, reversed) = intersections_at_scale(scale);
            for intersections in [forward, reversed] {
                assert_eq!(
                    intersections.len(),
                    1,
                    "scale={scale} intersections={intersections:?}"
                );
                assert!((intersections[0].t_a - 0.5).abs() <= 1e-6);
                assert!((intersections[0].t_b - 0.5).abs() <= 1e-6);
            }
        }
    }

    #[test]
    fn polynomial_root_solvers_are_invariant_to_coefficient_scale() {
        let tolerance = GeometryTolerance::default();
        for scale in [1e-24, 1e-12, 1.0, 1e12, 1e24] {
            let quadratic_roots =
                solve_quadratic_roots(scale, -scale, 0.1875 * scale, tolerance.parameter_epsilon);
            assert_eq!(
                quadratic_roots.len(),
                2,
                "scale={scale} roots={quadratic_roots:?}"
            );
            assert!((quadratic_roots[0] - 0.25).abs() <= 1e-12);
            assert!((quadratic_roots[1] - 0.75).abs() <= 1e-12);

            let cubic_roots = solve_cubic_roots(
                scale,
                -1.5 * scale,
                0.6875 * scale,
                -0.09375 * scale,
                tolerance,
            );
            assert_eq!(cubic_roots.len(), 3, "scale={scale} roots={cubic_roots:?}");
            for (root, expected) in cubic_roots.iter().zip([0.25, 0.5, 0.75]) {
                assert!(
                    (root - expected).abs() <= 1e-6,
                    "scale={scale} roots={cubic_roots:?}"
                );
            }
        }
    }

    #[test]
    fn quadratic_near_tangent_distinguishes_two_crossings_from_a_near_miss() {
        let width = 10_000.0;
        let height = 10_000.0;
        let root_separation = 0.0005;
        let line = (Point2D { x: 0.0, y: 0.0 }, Point2D { x: width, y: 0.0 });
        let intersections_for_constant = |constant: f64| {
            let quadratic = CurveSegment::Quad {
                p0: Point2D {
                    x: 0.0,
                    y: constant * height,
                },
                p1: Point2D {
                    x: width * 0.5,
                    y: (constant - 0.5) * height,
                },
                p2: Point2D {
                    x: width,
                    y: constant * height,
                },
            };
            line_curve_intersections(line, &quadratic, GeometryTolerance::default())
        };

        let crossing_constant = 0.25 - root_separation * root_separation * 0.25;
        let crossings = intersections_for_constant(crossing_constant);
        assert_eq!(crossings.len(), 2, "crossings={crossings:?}");
        assert!((crossings[0].t_b - (0.5 - root_separation * 0.5)).abs() <= 1e-9);
        assert!((crossings[1].t_b - (0.5 + root_separation * 0.5)).abs() <= 1e-9);

        let miss_constant = 0.25 + root_separation * root_separation * 0.25;
        let near_miss = intersections_for_constant(miss_constant);
        assert!(near_miss.is_empty(), "near_miss={near_miss:?}");
    }

    #[test]
    fn cubic_shallow_extremum_preserves_both_nearby_crossings() {
        let width = 10_000.0;
        let height = 10_000.0;
        let roots = [0.4995, 0.5005, 1.5];
        let power_a = 1.0;
        let power_b = -(roots[0] + roots[1] + roots[2]);
        let power_c = roots[0] * roots[1] + roots[0] * roots[2] + roots[1] * roots[2];
        let power_d = -roots[0] * roots[1] * roots[2];
        let cubic = CurveSegment::Cubic {
            p0: Point2D {
                x: 0.0,
                y: power_d * height,
            },
            p1: Point2D {
                x: width / 3.0,
                y: (power_d + power_c / 3.0) * height,
            },
            p2: Point2D {
                x: width * 2.0 / 3.0,
                y: (power_d + power_b / 3.0 + power_c * 2.0 / 3.0) * height,
            },
            p3: Point2D {
                x: width,
                y: (power_a + power_b + power_c + power_d) * height,
            },
        };
        let line = (Point2D { x: 0.0, y: 0.0 }, Point2D { x: width, y: 0.0 });

        let intersections = line_curve_intersections(line, &cubic, GeometryTolerance::default());
        assert_eq!(intersections.len(), 2, "intersections={intersections:?}");
        assert!((intersections[0].t_b - roots[0]).abs() <= 1e-6);
        assert!((intersections[1].t_b - roots[1]).abs() <= 1e-6);
    }

    #[test]
    fn line_cubic_crossing_is_invariant_at_large_coordinate_scales() {
        let expected_root = 0.123_456_789;
        let roots = [expected_root, 2.0, 3.0];
        let power_a = 1.0;
        let power_b = -(roots[0] + roots[1] + roots[2]);
        let power_c = roots[0] * roots[1] + roots[0] * roots[2] + roots[1] * roots[2];
        let power_d = -roots[0] * roots[1] * roots[2];
        let intersections_at_scale = |scale: f64| {
            let cubic = CurveSegment::Cubic {
                p0: Point2D {
                    x: 0.0,
                    y: power_d * scale,
                },
                p1: Point2D {
                    x: scale / 3.0,
                    y: (power_d + power_c / 3.0) * scale,
                },
                p2: Point2D {
                    x: scale * 2.0 / 3.0,
                    y: (power_d + power_b / 3.0 + power_c * 2.0 / 3.0) * scale,
                },
                p3: Point2D {
                    x: scale,
                    y: (power_a + power_b + power_c + power_d) * scale,
                },
            };
            let line = CurveSegment::Line {
                p0: Point2D { x: 0.0, y: 0.0 },
                p1: Point2D {
                    x: scale * 2.0,
                    y: 0.0,
                },
            };
            (
                intersect_curve_segments(&line, &cubic, GeometryTolerance::default()),
                intersect_curve_segments(&cubic, &line, GeometryTolerance::default()),
            )
        };

        for scale in [10_000.0, 100_000.0, 1_000_000.0, 100_000_000.0] {
            let (forward, reversed) = intersections_at_scale(scale);
            assert_eq!(forward.len(), 1, "scale={scale} forward={forward:?}");
            assert!((forward[0].t_a - expected_root * 0.5).abs() <= 1e-12);
            assert!((forward[0].t_b - expected_root).abs() <= 1e-12);

            assert_eq!(reversed.len(), 1, "scale={scale} reversed={reversed:?}");
            assert!((reversed[0].t_a - expected_root).abs() <= 1e-12);
            assert!((reversed[0].t_b - expected_root * 0.5).abs() <= 1e-12);
        }
    }

    #[test]
    fn large_cubic_keeps_nearby_but_spatially_distinct_crossings() {
        let scale = 100_000_000.0;
        let root_separation = 0.000_003_5;
        let roots = [
            0.5 - root_separation * 0.5,
            0.5 + root_separation * 0.5,
            -1.0,
        ];
        let power_a = 1.0;
        let power_b = -(roots[0] + roots[1] + roots[2]);
        let power_c = roots[0] * roots[1] + roots[0] * roots[2] + roots[1] * roots[2];
        let power_d = -roots[0] * roots[1] * roots[2];
        let cubic = CurveSegment::Cubic {
            p0: Point2D {
                x: 0.0,
                y: power_d * scale,
            },
            p1: Point2D {
                x: scale / 3.0,
                y: (power_d + power_c / 3.0) * scale,
            },
            p2: Point2D {
                x: scale * 2.0 / 3.0,
                y: (power_d + power_b / 3.0 + power_c * 2.0 / 3.0) * scale,
            },
            p3: Point2D {
                x: scale,
                y: (power_a + power_b + power_c + power_d) * scale,
            },
        };
        let line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D {
                x: scale * 2.0,
                y: 0.0,
            },
        };

        let forward = intersect_curve_segments(&line, &cubic, GeometryTolerance::default());
        let reversed = intersect_curve_segments(&cubic, &line, GeometryTolerance::default());
        assert_eq!(forward.len(), 2, "forward={forward:?}");
        assert_eq!(reversed.len(), 2, "reversed={reversed:?}");
        for (intersection_index, expected_root) in roots[..2].iter().enumerate() {
            assert!((forward[intersection_index].t_a - expected_root * 0.5).abs() <= 1e-10);
            assert!((forward[intersection_index].t_b - expected_root).abs() <= 1e-10);
            assert!((reversed[intersection_index].t_a - expected_root).abs() <= 1e-10);
            assert!((reversed[intersection_index].t_b - expected_root * 0.5).abs() <= 1e-10);
        }
        assert!(
            ((forward[1].t_a - forward[0].t_a) * scale * 2.0 - 350.0).abs() <= 0.01,
            "forward={forward:?}"
        );
    }

    #[test]
    fn canonicalization_keeps_spatially_distinct_nearby_crossings() {
        let scale = 1_000_000_000.0;
        let root_separation = 0.000_000_8;
        let roots = [
            0.5 - root_separation * 0.5,
            0.5 + root_separation * 0.5,
            -1.0,
        ];
        let power_a = 1.0;
        let power_b = -(roots[0] + roots[1] + roots[2]);
        let power_c = roots[0] * roots[1] + roots[0] * roots[2] + roots[1] * roots[2];
        let power_d = -roots[0] * roots[1] * roots[2];
        let cubic = CurveSegment::Cubic {
            p0: Point2D {
                x: 0.0,
                y: power_d * scale,
            },
            p1: Point2D {
                x: scale / 3.0,
                y: (power_d + power_c / 3.0) * scale,
            },
            p2: Point2D {
                x: scale * 2.0 / 3.0,
                y: (power_d + power_b / 3.0 + power_c * 2.0 / 3.0) * scale,
            },
            p3: Point2D {
                x: scale,
                y: (power_a + power_b + power_c + power_d) * scale,
            },
        };
        let line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D {
                x: scale * 2.0,
                y: 0.0,
            },
        };
        let tolerance = GeometryTolerance::default();

        let raw = line_curve_intersections(line.as_line().unwrap(), &cubic, tolerance);
        assert_eq!(raw.len(), 2, "raw={raw:?}");
        let raw_distance = point_distance(cubic.eval(raw[0].t_b), cubic.eval(raw[1].t_b));
        assert!((raw_distance - 800.0).abs() <= 0.1, "raw={raw:?}");

        let forward = intersect_curve_segments(&line, &cubic, tolerance);
        let reversed = intersect_curve_segments(&cubic, &line, tolerance);
        assert_eq!(forward.len(), 2, "forward={forward:?}");
        assert_eq!(reversed.len(), 2, "reversed={reversed:?}");

        let mut split_parameters = roots[..2].to_vec();
        canonicalize_parameters(&mut split_parameters, &cubic, tolerance);
        assert_eq!(split_parameters.len(), 2, "params={split_parameters:?}");

        let line_region = Region {
            contours: vec![Contour {
                segments: vec![line],
                closed: false,
            }],
        };
        let cubic_region = Region {
            contours: vec![Contour {
                segments: vec![cubic.clone()],
                closed: false,
            }],
        };
        let public_forward = intersections_between_regions(&line_region, &cubic_region);
        let public_reversed = intersections_between_regions(&cubic_region, &line_region);
        assert_eq!(public_forward.len(), 2, "public_forward={public_forward:?}");
        assert_eq!(
            public_reversed.len(),
            2,
            "public_reversed={public_reversed:?}"
        );
    }

    #[test]
    fn parameter_canonicalization_uses_the_spatial_tolerance_boundary() {
        let short_line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D { x: 10.0, y: 0.0 },
        };
        let long_line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D { x: 1_000.0, y: 0.0 },
        };
        let original_parameters = vec![0.5 - 0.000_000_1, 0.5 + 0.000_000_1];
        let mut spatially_equivalent = original_parameters.clone();
        let mut spatially_distinct = original_parameters;

        canonicalize_parameters(
            &mut spatially_equivalent,
            &short_line,
            GeometryTolerance::default(),
        );
        canonicalize_parameters(
            &mut spatially_distinct,
            &long_line,
            GeometryTolerance::default(),
        );

        assert_eq!(
            spatially_equivalent.len(),
            1,
            "params={spatially_equivalent:?}"
        );
        assert_eq!(spatially_distinct.len(), 2, "params={spatially_distinct:?}");
    }

    #[test]
    fn spatial_extent_distinguishes_a_closed_loop_from_a_sub_snap_piece() {
        let tolerance = GeometryTolerance::default();
        let cubic_loop = CurveSegment::Cubic {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D {
                x: 100.0,
                y: -100.0,
            },
            p2: Point2D { x: 100.0, y: 100.0 },
            p3: Point2D { x: 0.0, y: 0.0 },
        };
        let sub_snap_line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D {
                x: tolerance.snap_epsilon * 0.5,
                y: 0.0,
            },
        };

        assert!(segment_spatial_extent(&cubic_loop) > 100.0);
        assert!(segment_spatial_extent(&sub_snap_line) <= tolerance.snap_epsilon);
    }

    #[test]
    fn large_quadratic_preserves_spatially_distinct_nearby_crossings() {
        let scale = 1_000_000_000.0;
        let root_separation = 0.000_000_8;
        let roots = [0.5 - root_separation * 0.5, 0.5 + root_separation * 0.5];
        let power_a = 1.0;
        let power_b = -(roots[0] + roots[1]);
        let power_c = roots[0] * roots[1];
        let quadratic = CurveSegment::Quad {
            p0: Point2D {
                x: 0.0,
                y: power_c * scale,
            },
            p1: Point2D {
                x: scale * 0.5,
                y: (power_c + power_b * 0.5) * scale,
            },
            p2: Point2D {
                x: scale,
                y: (power_a + power_b + power_c) * scale,
            },
        };
        let line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D { x: scale, y: 0.0 },
        };
        let tolerance = GeometryTolerance::default();

        let raw = line_curve_intersections(line.as_line().unwrap(), &quadratic, tolerance);
        assert_eq!(raw.len(), 2, "raw={raw:?}");
        let crossing_distance =
            point_distance(quadratic.eval(raw[0].t_b), quadratic.eval(raw[1].t_b));
        assert!((crossing_distance - 800.0).abs() <= 0.1, "raw={raw:?}");

        let line_region = Region {
            contours: vec![Contour {
                segments: vec![line],
                closed: false,
            }],
        };
        let quadratic_region = Region {
            contours: vec![Contour {
                segments: vec![quadratic],
                closed: false,
            }],
        };
        let public_forward = intersections_between_regions(&line_region, &quadratic_region);
        let public_reversed = intersections_between_regions(&quadratic_region, &line_region);
        assert_eq!(public_forward.len(), 2, "public_forward={public_forward:?}");
        assert_eq!(
            public_reversed.len(),
            2,
            "public_reversed={public_reversed:?}"
        );
    }

    #[test]
    fn translated_large_quadratic_keeps_spatially_distinct_crossings() {
        let scale = 1_000_000_000.0;
        let translation = Point2D {
            x: 1_000_000_000.0,
            y: -1_000_000_000.0,
        };
        let root_separation = 0.000_000_8;
        let roots = [0.5 - root_separation * 0.5, 0.5 + root_separation * 0.5];
        let power_b = -(roots[0] + roots[1]);
        let power_c = roots[0] * roots[1];
        let quadratic = CurveSegment::Quad {
            p0: Point2D {
                x: translation.x,
                y: translation.y + power_c * scale,
            },
            p1: Point2D {
                x: translation.x + scale * 0.5,
                y: translation.y + (power_c + power_b * 0.5) * scale,
            },
            p2: Point2D {
                x: translation.x + scale,
                y: translation.y + (1.0 + power_b + power_c) * scale,
            },
        };
        let line = CurveSegment::Line {
            p0: translation,
            p1: Point2D {
                x: translation.x + scale,
                y: translation.y,
            },
        };
        let tolerance = GeometryTolerance::default();

        let forward = intersect_curve_segments(&line, &quadratic, tolerance);
        let reversed = intersect_curve_segments(&quadratic, &line, tolerance);
        assert_eq!(forward.len(), 2, "forward={forward:?}");
        assert_eq!(reversed.len(), 2, "reversed={reversed:?}");
        let crossing_distance = point_distance(
            quadratic.eval(forward[0].t_b),
            quadratic.eval(forward[1].t_b),
        );
        assert!(
            (crossing_distance - 800.0).abs() <= 0.2,
            "forward={forward:?}"
        );
    }

    #[test]
    fn large_quadratic_distinguishes_a_tangent_from_a_near_miss() {
        let scale = 1_000_000_000.0;
        let root_separation = 0.000_000_8;
        let root_radius = root_separation * 0.5;
        let line = (Point2D { x: 0.0, y: 0.0 }, Point2D { x: scale, y: 0.0 });
        let intersections_for_constant = |power_c: f64| {
            let quadratic = CurveSegment::Quad {
                p0: Point2D {
                    x: 0.0,
                    y: power_c * scale,
                },
                p1: Point2D {
                    x: scale * 0.5,
                    y: (power_c - 0.5) * scale,
                },
                p2: Point2D {
                    x: scale,
                    y: power_c * scale,
                },
            };
            line_curve_intersections(line, &quadratic, GeometryTolerance::default())
        };

        let tangent = intersections_for_constant(0.25);
        assert_eq!(tangent.len(), 1, "tangent={tangent:?}");
        assert!((tangent[0].t_b - 0.5).abs() <= f64::EPSILON);

        let near_miss = intersections_for_constant(0.25 + root_radius * root_radius);
        assert!(near_miss.is_empty(), "near_miss={near_miss:?}");
    }

    #[test]
    fn quadratic_discriminant_classification_is_stable_across_a_scale_translation_grid() {
        let tolerance = GeometryTolerance::default();
        for scale in [1_000_000.0, 1_000_000_000.0] {
            for translation_factor in [0.0, 3.0] {
                let translation = Point2D {
                    x: scale * translation_factor,
                    y: -scale * translation_factor,
                };
                let line = (
                    translation,
                    Point2D {
                        x: translation.x + scale,
                        y: translation.y,
                    },
                );
                for root_separation in [0.000_000_8, 0.000_002, 0.000_1] {
                    let root_radius = root_separation * 0.5;
                    let intersections_for_constant = |power_c: f64| {
                        let quadratic = CurveSegment::Quad {
                            p0: Point2D {
                                x: translation.x,
                                y: translation.y + power_c * scale,
                            },
                            p1: Point2D {
                                x: translation.x + scale * 0.5,
                                y: translation.y + (power_c - 0.5) * scale,
                            },
                            p2: Point2D {
                                x: translation.x + scale,
                                y: translation.y + power_c * scale,
                            },
                        };
                        line_curve_intersections(line, &quadratic, tolerance)
                    };
                    let context = format!(
                        "scale={scale} translation_factor={translation_factor} separation={root_separation}"
                    );

                    let crossings = intersections_for_constant(0.25 - root_radius * root_radius);
                    let tangent = intersections_for_constant(0.25);
                    let near_miss = intersections_for_constant(0.25 + root_radius * root_radius);
                    assert_eq!(crossings.len(), 2, "{context} crossings={crossings:?}");
                    assert_eq!(tangent.len(), 1, "{context} tangent={tangent:?}");
                    assert!(near_miss.is_empty(), "{context} near_miss={near_miss:?}");
                }
            }
        }
    }

    #[test]
    fn small_cubic_coefficient_preserves_spatially_significant_crossings() {
        let scale = 1_000_000_000.0;
        let root_separation = 0.000_000_8;
        let roots = [0.5 - root_separation * 0.5, 0.5 + root_separation * 0.5];
        let power_a = 0.000_000_5;
        let third_root = -1.0 / power_a - roots[0] - roots[1];
        let power_b = -power_a * (roots[0] + roots[1] + third_root);
        let power_c =
            power_a * (roots[0] * roots[1] + roots[0] * third_root + roots[1] * third_root);
        let power_d = -power_a * roots[0] * roots[1] * third_root;
        let cubic = CurveSegment::Cubic {
            p0: Point2D {
                x: 0.0,
                y: power_d * scale,
            },
            p1: Point2D {
                x: scale / 3.0,
                y: (power_d + power_c / 3.0) * scale,
            },
            p2: Point2D {
                x: scale * 2.0 / 3.0,
                y: (power_d + power_b / 3.0 + power_c * 2.0 / 3.0) * scale,
            },
            p3: Point2D {
                x: scale,
                y: (power_a + power_b + power_c + power_d) * scale,
            },
        };
        let line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D { x: scale, y: 0.0 },
        };
        let tolerance = GeometryTolerance::default();

        let raw = line_curve_intersections(line.as_line().unwrap(), &cubic, tolerance);
        assert_eq!(raw.len(), 2, "raw={raw:?}");
        for (intersection, expected_root) in raw.iter().zip(roots) {
            assert!(
                (intersection.t_b - expected_root).abs() <= 0.000_000_01,
                "raw={raw:?}"
            );
        }
        let crossing_distance = point_distance(cubic.eval(raw[0].t_b), cubic.eval(raw[1].t_b));
        assert!((crossing_distance - 800.0).abs() <= 0.1, "raw={raw:?}");

        let forward = intersect_curve_segments(&line, &cubic, tolerance);
        let reversed = intersect_curve_segments(&cubic, &line, tolerance);
        assert_eq!(forward.len(), 2, "forward={forward:?}");
        assert_eq!(reversed.len(), 2, "reversed={reversed:?}");
    }

    fn assert_sloped_clustered_cubic_crossings(
        cubic: &CurveSegment,
        roots: [f64; 3],
        scale: f64,
        tolerance: GeometryTolerance,
    ) {
        let x_translation = 1_000_000.0;
        let slope = 2.0_f64.powi(-22);
        let sloped_point = |point: Point2D| Point2D {
            x: x_translation + point.x,
            y: point.x * slope + point.y,
        };
        let CurveSegment::Cubic { p0, p1, p2, p3 } = cubic else {
            panic!("test fixture is cubic");
        };
        let sloped_cubic = CurveSegment::Cubic {
            p0: sloped_point(*p0),
            p1: sloped_point(*p1),
            p2: sloped_point(*p2),
            p3: sloped_point(*p3),
        };
        let sloped_start = Point2D {
            x: x_translation,
            y: 0.0,
        };
        let sloped_end = Point2D {
            x: x_translation + scale,
            y: scale * slope,
        };
        for (label, sloped_line) in [
            (
                "sloped_cluster",
                CurveSegment::Line {
                    p0: sloped_start,
                    p1: sloped_end,
                },
            ),
            (
                "reversed_sloped_cluster",
                CurveSegment::Line {
                    p0: sloped_end,
                    p1: sloped_start,
                },
            ),
        ] {
            let raw =
                line_curve_intersections(sloped_line.as_line().unwrap(), &sloped_cubic, tolerance);
            assert_eq!(raw.len(), 3, "{label} raw={raw:?}");
            for (intersection, expected_root) in raw.iter().zip(roots) {
                assert!(
                    (intersection.t_b - expected_root).abs() <= 1e-9,
                    "{label} raw={raw:?} expected={roots:?}"
                );
            }
            assert_raw_and_public_intersection_count(
                &sloped_line,
                &sloped_cubic,
                3,
                label,
                tolerance,
            );
        }
    }

    #[test]
    fn clustered_cubic_crossings_remain_spatially_distinct() {
        let root_radius = 2.0f64.powi(-21);
        let roots = [0.5 - root_radius, 0.5, 0.5 + root_radius];
        let power_a = 1.0;
        let power_b = -(roots[0] + roots[1] + roots[2]);
        let power_c = roots[0] * roots[1] + roots[0] * roots[2] + roots[1] * roots[2];
        let power_d = -roots[0] * roots[1] * roots[2];
        let coordinate_step = 2.0f64.powi(30);
        let scale = coordinate_step * 3.0;
        let cubic = CurveSegment::Cubic {
            p0: Point2D {
                x: 0.0,
                y: power_d * 3.0,
            },
            p1: Point2D {
                x: coordinate_step,
                y: power_d * 3.0 + power_c,
            },
            p2: Point2D {
                x: coordinate_step * 2.0,
                y: power_d * 3.0 + power_b + power_c * 2.0,
            },
            p3: Point2D {
                x: scale,
                y: (power_a + power_b + power_c + power_d) * 3.0,
            },
        };
        let line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D { x: scale, y: 0.0 },
        };
        let tolerance = GeometryTolerance::default();

        let raw = line_curve_intersections(line.as_line().unwrap(), &cubic, tolerance);
        assert_eq!(raw.len(), 3, "raw={raw:?}");
        for (intersection, expected_root) in raw.iter().zip(roots) {
            assert!(
                (intersection.t_b - expected_root).abs() <= 1e-12,
                "raw={raw:?} expected={roots:?}"
            );
        }
        for crossings in raw.windows(2) {
            let distance =
                point_distance(cubic.eval(crossings[0].t_b), cubic.eval(crossings[1].t_b));
            assert!((distance - 1_536.0).abs() <= 0.1, "raw={raw:?}");
        }
        let CurveSegment::Cubic { p0, p1, p2, p3 } = &cubic else {
            panic!("test fixture is cubic");
        };
        let reversed_cubic = CurveSegment::Cubic {
            p0: *p3,
            p1: *p2,
            p2: *p1,
            p3: *p0,
        };
        let reversed_raw =
            line_curve_intersections(line.as_line().unwrap(), &reversed_cubic, tolerance);
        assert_eq!(reversed_raw.len(), 3, "reversed_raw={reversed_raw:?}");
        for (intersection, expected_root) in reversed_raw.iter().zip(roots) {
            assert!(
                (intersection.t_b - expected_root).abs() <= 1e-12,
                "reversed_raw={reversed_raw:?} expected={roots:?}"
            );
        }

        let line_region = Region {
            contours: vec![Contour {
                segments: vec![line],
                closed: false,
            }],
        };
        let cubic_region = Region {
            contours: vec![Contour {
                segments: vec![cubic.clone()],
                closed: false,
            }],
        };
        let public_forward = intersections_between_regions(&line_region, &cubic_region);
        let public_reversed = intersections_between_regions(&cubic_region, &line_region);
        assert_eq!(public_forward.len(), 3, "public_forward={public_forward:?}");
        assert_eq!(
            public_reversed.len(),
            3,
            "public_reversed={public_reversed:?}"
        );
        for (forward, reversed) in public_forward.iter().zip(&public_reversed) {
            assert!(
                point_distance(forward.point, reversed.point) <= tolerance.position_epsilon,
                "public_forward={public_forward:?} public_reversed={public_reversed:?}"
            );
        }
        for crossings in public_forward.windows(2) {
            assert!(
                (point_distance(crossings[0].point, crossings[1].point) - 1_536.0).abs() <= 0.1,
                "public_forward={public_forward:?}"
            );
        }

        assert_sloped_clustered_cubic_crossings(&cubic, roots, scale, tolerance);
    }

    #[test]
    fn roundoff_ambiguous_cubic_extrema_preserve_public_crossings() {
        let root_radius = 2.0_f64.powi(-19);
        let roots = [0.5 - root_radius, 0.5, 0.5 + root_radius];
        let power_a = 1.0;
        let power_b = -1.5;
        let power_c = 0.75 - root_radius * root_radius;
        let power_d = -0.125 + root_radius * root_radius * 0.5;
        let coordinate_step = 2.0_f64.powi(30);
        let scale = coordinate_step * 3.0;
        let cubic = CurveSegment::Cubic {
            p0: Point2D {
                x: 0.0,
                y: power_d * 3.0,
            },
            p1: Point2D {
                x: coordinate_step,
                y: power_d * 3.0 + power_c,
            },
            p2: Point2D {
                x: coordinate_step * 2.0,
                y: power_d * 3.0 + power_b + power_c * 2.0,
            },
            p3: Point2D {
                x: scale,
                y: (power_a + power_b + power_c + power_d) * 3.0,
            },
        };
        let line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D { x: scale, y: 0.0 },
        };
        for root in roots {
            assert_line_cubic_intersection_invariant(&line, &cubic, root, root, 3);
        }

        let line_region = Region {
            contours: vec![Contour {
                segments: vec![line],
                closed: false,
            }],
        };
        let cubic_region = Region {
            contours: vec![Contour {
                segments: vec![cubic],
                closed: false,
            }],
        };
        let forward = intersections_between_regions(&line_region, &cubic_region);
        let reversed = intersections_between_regions(&cubic_region, &line_region);
        assert_eq!(forward.len(), 3, "forward={forward:?}");
        assert_eq!(reversed.len(), 3, "reversed={reversed:?}");
    }

    #[test]
    fn large_cubic_does_not_replace_nearby_crossings_with_their_extremum() {
        let scale = 1_000_000_000.0;
        let root_separation = 0.000_001_5;
        let roots = [
            0.5 - root_separation * 0.5,
            0.5 + root_separation * 0.5,
            -1.0,
        ];
        let power_a = 1.0;
        let power_b = -(roots[0] + roots[1] + roots[2]);
        let power_c = roots[0] * roots[1] + roots[0] * roots[2] + roots[1] * roots[2];
        let power_d = -roots[0] * roots[1] * roots[2];
        let cubic = CurveSegment::Cubic {
            p0: Point2D {
                x: 0.0,
                y: power_d * scale,
            },
            p1: Point2D {
                x: scale / 3.0,
                y: (power_d + power_c / 3.0) * scale,
            },
            p2: Point2D {
                x: scale * 2.0 / 3.0,
                y: (power_d + power_b / 3.0 + power_c * 2.0 / 3.0) * scale,
            },
            p3: Point2D {
                x: scale,
                y: (power_a + power_b + power_c + power_d) * scale,
            },
        };
        let line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D {
                x: scale * 2.0,
                y: 0.0,
            },
        };

        let forward = intersect_curve_segments(&line, &cubic, GeometryTolerance::default());
        let reversed = intersect_curve_segments(&cubic, &line, GeometryTolerance::default());
        assert_eq!(forward.len(), 2, "forward={forward:?}");
        assert_eq!(reversed.len(), 2, "reversed={reversed:?}");
        for (intersection_index, expected_root) in roots[..2].iter().enumerate() {
            assert!((forward[intersection_index].t_a - expected_root * 0.5).abs() <= 1e-10);
            assert!((forward[intersection_index].t_b - expected_root).abs() <= 1e-10);
            assert!((reversed[intersection_index].t_a - expected_root).abs() <= 1e-10);
            assert!((reversed[intersection_index].t_b - expected_root * 0.5).abs() <= 1e-10);
        }
        let first_crossing = cubic.eval(forward[0].t_b);
        let second_crossing = cubic.eval(forward[1].t_b);
        assert!((point_distance(first_crossing, second_crossing) - 1_500.0).abs() <= 0.1);
    }

    #[test]
    fn translated_large_cubic_keeps_spatially_distinct_crossings() {
        let offset = 1_000_000_000.0;
        let extent = 1_000_000.0;
        let root_separation = 0.000_002;
        let roots = [
            0.5 - root_separation * 0.5,
            0.5 + root_separation * 0.5,
            -1.0,
        ];
        let power_a = 1.0;
        let power_b = -(roots[0] + roots[1] + roots[2]);
        let power_c = roots[0] * roots[1] + roots[0] * roots[2] + roots[1] * roots[2];
        let power_d = -roots[0] * roots[1] * roots[2];
        let cubic = CurveSegment::Cubic {
            p0: Point2D {
                x: offset,
                y: offset + power_d * extent,
            },
            p1: Point2D {
                x: offset + extent / 3.0,
                y: offset + (power_d + power_c / 3.0) * extent,
            },
            p2: Point2D {
                x: offset + extent * 2.0 / 3.0,
                y: offset + (power_d + power_b / 3.0 + power_c * 2.0 / 3.0) * extent,
            },
            p3: Point2D {
                x: offset + extent,
                y: offset + (power_a + power_b + power_c + power_d) * extent,
            },
        };
        let line = CurveSegment::Line {
            p0: Point2D {
                x: offset - extent,
                y: offset,
            },
            p1: Point2D {
                x: offset + extent * 2.0,
                y: offset,
            },
        };

        let forward = intersect_curve_segments(&line, &cubic, GeometryTolerance::default());
        let reversed = intersect_curve_segments(&cubic, &line, GeometryTolerance::default());
        assert_eq!(forward.len(), 2, "forward={forward:?}");
        assert_eq!(reversed.len(), 2, "reversed={reversed:?}");
        for (intersection_index, expected_root) in roots[..2].iter().enumerate() {
            let expected_line_parameter = (1.0 + expected_root) / 3.0;
            assert!((forward[intersection_index].t_a - expected_line_parameter).abs() <= 1e-8);
            assert!((forward[intersection_index].t_b - expected_root).abs() <= 1e-8);
            assert!((reversed[intersection_index].t_a - expected_root).abs() <= 1e-8);
            assert!((reversed[intersection_index].t_b - expected_line_parameter).abs() <= 1e-8);
        }
        let first_crossing = cubic.eval(forward[0].t_b);
        let second_crossing = cubic.eval(forward[1].t_b);
        assert!((point_distance(first_crossing, second_crossing) - 2.0).abs() <= 0.01);
    }

    #[test]
    fn rounded_line_cubic_start_contact_is_invariant_to_direction_and_operand_order() {
        let line = CurveSegment::Line {
            p0: Point2D {
                x: 0.494_141_423_472_662_54,
                y: -0.449_588_501_907_155_8,
            },
            p1: Point2D {
                x: -0.242_680_156_121_552_8,
                y: -0.074_421_912_132_334_4,
            },
        };
        let cubic = CurveSegment::Cubic {
            p0: Point2D {
                x: 0.239_466_993_340_039_9,
                y: -0.319_916_217_460_328_06,
            },
            p1: Point2D {
                x: 0.161_627_864_788_826_13,
                y: -0.428_068_596_629_626_76,
            },
            p2: Point2D {
                x: -0.013_514_605_343_204_283,
                y: -0.257_308_927_594_890_2,
            },
            p3: Point2D {
                x: -0.255_242_409_350_646_35,
                y: -0.229_864_731_501_259_36,
            },
        };
        let expected_line_parameter = parameter_on_line(line.start(), line.end(), cubic.start())
            .expect("non-degenerate line");
        // The authored start contact is 1.68e-17 px off the exact f64 line after
        // rounding, so it must remain inside the propagated coefficient bound.
        assert_line_cubic_intersection_invariant(&line, &cubic, expected_line_parameter, 0.0, 1);
    }

    #[test]
    fn distant_small_cubic_keeps_its_rounded_start_contact() {
        let line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D {
                x: -366.097_510_173_578_14,
                y: -930.576_494_999_044_6,
            },
        };
        let cubic = CurveSegment::Cubic {
            p0: Point2D {
                x: -222.986_361_649_101_04,
                y: -566.804_911_504_655_9,
            },
            p1: Point2D {
                x: -222.430_352_807_810_04,
                y: -567.383_432_554_817_7,
            },
            p2: Point2D {
                x: -223.027_146_520_561_4,
                y: -566.693_775_054_268_9,
            },
            p3: Point2D {
                x: -223.285_964_678_650_37,
                y: -566.306_498_419_160_9,
            },
        };
        let expected_line_parameter = parameter_on_line(line.start(), line.end(), cubic.start())
            .expect("non-degenerate line");
        // This intended start contact is 2.91e-14 px off the exact f64 line.
        assert_line_cubic_intersection_invariant(&line, &cubic, expected_line_parameter, 0.0, 2);
    }

    #[test]
    fn distant_small_cubic_keeps_its_near_tangent_crossing_pair() {
        let expected_curve_parameter = 0.689_978_390_420_917_7;
        let line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D {
                x: 809.264_706_440_027_9,
                y: 587.444_154_716_459_4,
            },
        };
        let cubic = CurveSegment::Cubic {
            p0: Point2D {
                x: 377.080_585_193_354_5,
                y: 275.143_144_043_243_4,
            },
            p1: Point2D {
                x: 378.114_988_731_511_35,
                y: 274.285_576_667_231_6,
            },
            p2: Point2D {
                x: 378.351_801_099_846_85,
                y: 274.526_773_111_954_6,
            },
            p3: Point2D {
                x: 378.496_785_275_691_8,
                y: 274.894_472_330_842_9,
            },
        };
        let tangent_point = cubic.eval(expected_curve_parameter);
        let expected_line_parameter = parameter_on_line(line.start(), line.end(), tangent_point)
            .expect("non-degenerate line");
        // The rounded curve has two exact crossings 3.19e-7 apart. The solver
        // represents that sub-parameter-epsilon pair by their shared extremum.
        assert_line_cubic_intersection_invariant(
            &line,
            &cubic,
            expected_line_parameter,
            expected_curve_parameter,
            1,
        );
    }

    #[test]
    fn polynomial_root_solvers_keep_tangent_and_endpoint_roots() {
        let tolerance = GeometryTolerance::default();
        let quadratic_tangent = solve_quadratic_roots(1.0, -1.0, 0.25, tolerance.parameter_epsilon);
        assert_eq!(quadratic_tangent, vec![0.5]);

        for tangent_root in [0.125, 0.3, 0.5, 0.9] {
            let other_root = 1.5;
            let cubic_tangent = solve_cubic_roots(
                1.0,
                -(2.0 * tangent_root + other_root),
                tangent_root * tangent_root + 2.0 * tangent_root * other_root,
                -tangent_root * tangent_root * other_root,
                tolerance,
            );
            assert_eq!(
                cubic_tangent.len(),
                1,
                "tangent_root={tangent_root} roots={cubic_tangent:?}"
            );
            assert!(
                (cubic_tangent[0] - tangent_root).abs() <= 1e-6,
                "tangent_root={tangent_root} roots={cubic_tangent:?}"
            );
        }

        let cubic_near_miss = solve_cubic_roots(1.0, 0.0, -0.75, 0.25 + 1e-14, tolerance);
        assert!(
            cubic_near_miss.is_empty(),
            "near miss must not become a tangent root: {cubic_near_miss:?}"
        );

        let cubic_endpoint = solve_cubic_roots(1.0, -2.0, 0.75, 0.0, tolerance);
        assert_eq!(cubic_endpoint.len(), 2, "roots={cubic_endpoint:?}");
        assert!((cubic_endpoint[0] - 0.0).abs() <= 1e-12);
        assert!((cubic_endpoint[1] - 0.5).abs() <= 1e-6);
    }

    #[test]
    fn polynomial_root_solvers_reject_non_finite_coefficients() {
        let tolerance = GeometryTolerance::default();
        assert!(solve_quadratic_roots(f64::NAN, 1.0, 0.0, tolerance.parameter_epsilon).is_empty());
        for invalid_roundoff in [f64::INFINITY, -f64::EPSILON] {
            assert!(
                solve_quadratic_roots_with_coefficient_roundoff(
                    1.0,
                    -1.0,
                    0.25,
                    [invalid_roundoff, 0.0, 0.0],
                    tolerance.parameter_epsilon,
                )
                .is_empty()
            );
        }
        assert!(solve_cubic_roots(1.0, f64::INFINITY, 0.0, 0.0, tolerance).is_empty());
        for invalid_roundoff in [f64::INFINITY, -f64::EPSILON] {
            assert!(
                solve_cubic_roots_with_coefficient_roundoff(
                    1.0,
                    0.0,
                    0.0,
                    0.0,
                    [invalid_roundoff, 0.0, 0.0, 0.0],
                    tolerance,
                )
                .is_empty()
            );
        }
        assert!(solve_quadratic_roots(0.0, 0.0, 0.0, tolerance.parameter_epsilon).is_empty());
        assert!(solve_cubic_roots(0.0, 0.0, 0.0, 0.0, tolerance).is_empty());
    }

    #[test]
    fn clustered_cubic_solver_preserves_the_rounded_polynomial_root_count() {
        let tolerance = GeometryTolerance::default();
        let coefficient_scales = [2.0_f64.powi(-300), 1.0, 2.0_f64.powi(300)];
        for root_radius in [0.000_000_4, 0.000_000_8, 0.000_001, 0.000_001_1] {
            let roots = [0.5 - root_radius, 0.5, 0.5 + root_radius];
            let b = -(roots[0] + roots[1] + roots[2]);
            let c = roots[0] * roots[1] + roots[0] * roots[2] + roots[1] * roots[2];
            let d = -roots[0] * roots[1] * roots[2];
            for coefficient_scale in coefficient_scales {
                let solved = solve_cubic_roots(
                    coefficient_scale,
                    b * coefficient_scale,
                    c * coefficient_scale,
                    d * coefficient_scale,
                    tolerance,
                );

                assert_eq!(
                    solved.len(),
                    1,
                    "radius={root_radius} scale={coefficient_scale} c={c:.17e} d={d:.17e} solved={solved:?}"
                );
            }
        }

        for root_radius in [0.000_000_5_f64, 0.000_001_2] {
            let roots = [0.5 - root_radius, 0.5, 0.5 + root_radius];
            let b = -(roots[0] + roots[1] + roots[2]);
            let c = roots[0] * roots[1] + roots[0] * roots[2] + roots[1] * roots[2];
            let d = -roots[0] * roots[1] * roots[2];
            let rounded_root_radius = (0.75 - c).sqrt();
            assert_eq!(b, -1.5, "radius={root_radius}");
            assert_eq!(d, -0.125 + 0.5 * (0.75 - c), "radius={root_radius}");
            let expected = [0.5 - rounded_root_radius, 0.5, 0.5 + rounded_root_radius];
            for coefficient_scale in coefficient_scales {
                let solved = solve_cubic_roots(
                    coefficient_scale,
                    b * coefficient_scale,
                    c * coefficient_scale,
                    d * coefficient_scale,
                    tolerance,
                );

                assert_eq!(
                    solved.len(),
                    3,
                    "radius={root_radius} scale={coefficient_scale} solved={solved:?}"
                );
                for (actual_root, expected_root) in solved.iter().zip(expected) {
                    assert!(
                        (actual_root - expected_root).abs() <= 1e-14,
                        "radius={root_radius} scale={coefficient_scale} solved={solved:?} expected={expected:?}"
                    );
                }
            }
        }

        let dyadic_radius = 2.0_f64.powi(-21);
        let dyadic_three_root_coefficients = [
            1.0,
            -1.5,
            0.75 - dyadic_radius * dyadic_radius,
            -0.125 + dyadic_radius * dyadic_radius * 0.5,
        ];
        let dyadic_extremum_radius = 2.0_f64.powi(-22);
        let dyadic_p = -3.0 * dyadic_extremum_radius * dyadic_extremum_radius;
        let dyadic_one_root_coefficients =
            [1.0, -1.5, 0.75 + dyadic_p, -0.125 - dyadic_p * 0.5 - 0.0625];
        for coefficients in [dyadic_three_root_coefficients, dyadic_one_root_coefficients] {
            let baseline = solve_cubic_roots(
                coefficients[0],
                coefficients[1],
                coefficients[2],
                coefficients[3],
                tolerance,
            );
            for coefficient_scale in [3.0, 10.0] {
                let scaled = solve_cubic_roots(
                    coefficients[0] * coefficient_scale,
                    coefficients[1] * coefficient_scale,
                    coefficients[2] * coefficient_scale,
                    coefficients[3] * coefficient_scale,
                    tolerance,
                );
                assert_eq!(
                    scaled.len(),
                    baseline.len(),
                    "scaled={scaled:?} baseline={baseline:?}"
                );
                for (actual, expected) in scaled.iter().zip(&baseline) {
                    assert!(
                        (*actual - *expected).abs() <= 1e-14,
                        "scale={coefficient_scale} scaled={scaled:?} baseline={baseline:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn clustered_cubic_operand_error_bound_preserves_three_roots_at_its_calibration_edge() {
        let tolerance = GeometryTolerance::default();
        let radius = 2.0_f64.powi(-21);
        let coefficients = [
            1.0,
            -1.5,
            0.75 - radius * radius,
            -0.125 + radius * radius * 0.5,
        ];
        let accurate_coefficients = AccurateCubicCoefficients {
            values: coefficients.map(DoubleDouble::from_f64),
            operand_magnitudes: [5_000_000_000.0; 4],
        };
        let roots = solve_cubic_roots_with_accurate_coefficients(
            coefficients,
            Some(accurate_coefficients),
            [1e-15; 4],
            tolerance,
        );
        let expected = [0.5 - radius, 0.5, 0.5 + radius];
        assert_eq!(roots.len(), 3, "roots={roots:?}");
        for (actual, expected) in roots.iter().zip(expected) {
            assert!(
                (*actual - expected).abs() <= 1e-14,
                "roots={roots:?} expected={expected:?}"
            );
        }
    }

    fn assert_raw_and_public_intersection_count(
        line: &CurveSegment,
        cubic: &CurveSegment,
        expected_count: usize,
        label: &str,
        tolerance: GeometryTolerance,
    ) {
        let raw = line_curve_intersections(line.as_line().unwrap(), cubic, tolerance);
        assert_eq!(raw.len(), expected_count, "{label} raw={raw:?}");
        let line_region = Region {
            contours: vec![Contour {
                segments: vec![line.clone()],
                closed: false,
            }],
        };
        let cubic_region = Region {
            contours: vec![Contour {
                segments: vec![cubic.clone()],
                closed: false,
            }],
        };
        let forward = intersections_between_regions(&line_region, &cubic_region);
        let reversed = intersections_between_regions(&cubic_region, &line_region);
        assert_eq!(forward.len(), expected_count, "{label} forward={forward:?}");
        assert_eq!(
            reversed.len(),
            expected_count,
            "{label} reversed={reversed:?}"
        );
    }

    fn assert_sloped_tangent_trichotomy(tolerance: GeometryTolerance) {
        let coordinate_step = 2.0_f64.powi(30);
        let scale = coordinate_step * 3.0;
        let x_translation = 1_000_000.0;
        let line = CurveSegment::Line {
            p0: Point2D {
                x: x_translation,
                y: 0.0,
            },
            p1: Point2D {
                x: x_translation + scale,
                y: 768.0,
            },
        };
        let control_offset = 2.0_f64.powi(-13);
        let control_y = [
            1.0,
            -1.0 - control_offset,
            1.0 + control_offset * 2.0,
            -1.0 - control_offset * 3.0,
        ];
        let vertical_offset = 2.0_f64.powi(-42);
        let cubic_for_offset = |offset: f64| CurveSegment::Cubic {
            p0: Point2D {
                x: x_translation,
                y: control_y[0] + offset,
            },
            p1: Point2D {
                x: x_translation + coordinate_step,
                y: 256.0 + control_y[1] + offset,
            },
            p2: Point2D {
                x: x_translation + coordinate_step * 2.0,
                y: 512.0 + control_y[2] + offset,
            },
            p3: Point2D {
                x: x_translation + scale,
                y: 768.0 + control_y[3] + offset,
            },
        };
        for (label, offset, expected_count) in [
            ("sloped_tangent", 0.0, 2),
            ("sloped_near_miss", -vertical_offset, 1),
            ("sloped_split_tangent", vertical_offset, 3),
        ] {
            assert_raw_and_public_intersection_count(
                &line,
                &cubic_for_offset(offset),
                expected_count,
                label,
                tolerance,
            );
        }
    }

    fn assert_clustered_cubic_geometry_root_counts(tolerance: GeometryTolerance) {
        let coordinate_step = 2.0_f64.powi(30);
        let scale = coordinate_step * 3.0;
        let line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D { x: scale, y: 0.0 },
        };
        let control_offset = 2.0_f64.powi(-16);
        let control_y = [
            1.0,
            -1.0 - control_offset,
            1.0 + control_offset * 2.0,
            -1.0 - control_offset * 3.0,
        ];
        let vertical_offset = 2.0_f64.powi(-51);
        let cubic_for_offset = |offset: f64| CurveSegment::Cubic {
            p0: Point2D {
                x: 0.0,
                y: control_y[0] + offset,
            },
            p1: Point2D {
                x: coordinate_step,
                y: control_y[1] + offset,
            },
            p2: Point2D {
                x: coordinate_step * 2.0,
                y: control_y[2] + offset,
            },
            p3: Point2D {
                x: scale,
                y: control_y[3] + offset,
            },
        };
        for (label, offset, expected_count) in [
            ("tangent", 0.0, 2),
            ("near_miss", -vertical_offset, 1),
            ("split_tangent", vertical_offset, 3),
        ] {
            let cubic = cubic_for_offset(offset);
            assert_raw_and_public_intersection_count(
                &line,
                &cubic,
                expected_count,
                label,
                tolerance,
            );
        }

        let tangent = cubic_for_offset(0.0);
        let CurveSegment::Cubic { p0, p1, p2, p3 } = tangent else {
            panic!("test fixture is cubic");
        };
        let translation = 1_000_000.0;
        let diagonal_point = |point: Point2D| Point2D {
            x: translation + point.x,
            y: translation + point.x + point.y,
        };
        let diagonal_cubic = CurveSegment::Cubic {
            p0: diagonal_point(p0),
            p1: diagonal_point(p1),
            p2: diagonal_point(p2),
            p3: diagonal_point(p3),
        };
        let diagonal_start = Point2D {
            x: translation,
            y: translation,
        };
        let diagonal_end = Point2D {
            x: translation + scale,
            y: translation + scale,
        };
        for (label, diagonal_line) in [
            (
                "diagonal_tangent",
                CurveSegment::Line {
                    p0: diagonal_start,
                    p1: diagonal_end,
                },
            ),
            (
                "reversed_diagonal_tangent",
                CurveSegment::Line {
                    p0: diagonal_end,
                    p1: diagonal_start,
                },
            ),
        ] {
            assert_raw_and_public_intersection_count(
                &diagonal_line,
                &diagonal_cubic,
                2,
                label,
                tolerance,
            );
        }
        assert_sloped_tangent_trichotomy(tolerance);
    }

    #[test]
    fn clustered_cubic_solver_distinguishes_a_tangent_from_a_near_miss() {
        let tolerance = GeometryTolerance::default();
        let center = 0.125;
        let radius = 2.0_f64.powi(-20);
        let coefficients = [
            1.0,
            -3.0 * center,
            3.0 * center * center - 3.0 * radius * radius,
            -center * center * center
                + 3.0 * radius * radius * center
                + 2.0 * radius * radius * radius,
        ];
        let tangent_roots = solve_cubic_roots(
            coefficients[0],
            coefficients[1],
            coefficients[2],
            coefficients[3],
            tolerance,
        );
        let expected = [center - 2.0 * radius, center + radius];
        assert_eq!(tangent_roots.len(), 2, "roots={tangent_roots:?}");
        for (actual, expected) in tangent_roots.iter().zip(expected) {
            assert!(
                (*actual - expected).abs() <= 1e-14,
                "roots={tangent_roots:?} expected={expected:?}"
            );
        }

        let near_miss_offset = 2.0_f64.powi(-59);
        let near_miss = solve_cubic_roots(
            coefficients[0],
            coefficients[1],
            coefficients[2],
            coefficients[3] + near_miss_offset,
            tolerance,
        );
        assert_eq!(near_miss.len(), 1, "near_miss={near_miss:?}");

        let split_tangent = solve_cubic_roots(
            coefficients[0],
            coefficients[1],
            coefficients[2],
            coefficients[3] - near_miss_offset,
            tolerance,
        );
        assert_eq!(split_tangent.len(), 3, "split_tangent={split_tangent:?}");
        assert_clustered_cubic_geometry_root_counts(tolerance);
    }

    #[test]
    fn clustered_cubic_single_root_remains_spatially_accurate() {
        let tolerance = GeometryTolerance::default();
        let depressed_p = -1.875e-13;
        let cancellation_target = 0.500_122_5;
        let shifted_target = cancellation_target - 0.5;
        let cancellation_q =
            -(shifted_target * shifted_target * shifted_target) - depressed_p * shifted_target;
        let cancellation_coefficients = [
            1.0,
            -1.5,
            0.75 + depressed_p,
            -0.125 - depressed_p * 0.5 + cancellation_q,
        ];
        let cancellation_roots = solve_cubic_roots(
            cancellation_coefficients[0],
            cancellation_coefficients[1],
            cancellation_coefficients[2],
            cancellation_coefficients[3],
            tolerance,
        );
        // This is the high-precision root of the rounded f64 coefficients;
        // their last-bit changes shift it slightly from cancellation_target.
        let cancellation_expected = 0.500_122_500_202_556_4;
        assert_eq!(cancellation_roots.len(), 1, "roots={cancellation_roots:?}");
        assert!(
            (cancellation_roots[0] - cancellation_expected).abs() <= 1e-14,
            "roots={cancellation_roots:?} expected={cancellation_expected}"
        );

        let depressed_q = -0.064;
        let power_a = 1.0;
        let power_b = -1.5;
        let power_c = 0.75 + depressed_p;
        let power_d = -0.125 - depressed_p * 0.5 + depressed_q;
        let expected_root = 0.900_000_000_000_156_2;
        let roots = solve_cubic_roots(power_a, power_b, power_c, power_d, tolerance);
        assert_eq!(roots.len(), 1, "roots={roots:?}");
        assert!(
            (roots[0] - expected_root).abs() <= 1e-12,
            "roots={roots:?} expected={expected_root}"
        );

        let scale = 1_000_000_000.0;
        let cubic = CurveSegment::Cubic {
            p0: Point2D {
                x: 0.0,
                y: power_d * scale,
            },
            p1: Point2D {
                x: scale / 3.0,
                y: (power_d + power_c / 3.0) * scale,
            },
            p2: Point2D {
                x: scale * 2.0 / 3.0,
                y: (power_d + power_c * 2.0 / 3.0 + power_b / 3.0) * scale,
            },
            p3: Point2D {
                x: scale,
                y: (power_a + power_b + power_c + power_d) * scale,
            },
        };
        let line = CurveSegment::Line {
            p0: Point2D { x: 0.0, y: 0.0 },
            p1: Point2D { x: scale, y: 0.0 },
        };
        assert_line_cubic_intersection_invariant(&line, &cubic, expected_root, expected_root, 1);
    }

    fn rectangle_contour(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Contour {
        let points = [
            Point2D { x: min_x, y: min_y },
            Point2D { x: max_x, y: min_y },
            Point2D { x: max_x, y: max_y },
            Point2D { x: min_x, y: max_y },
            Point2D { x: min_x, y: min_y },
        ];
        Contour {
            segments: points
                .windows(2)
                .map(|window| CurveSegment::Line {
                    p0: window[0],
                    p1: window[1],
                })
                .collect(),
            closed: true,
        }
    }

    #[test]
    fn intersection_axis_intervals_preserve_disconnected_overlap_and_tangency() {
        let lhs = Region {
            contours: vec![
                rectangle_contour(0.0, 0.0, 10.0, 4.0),
                rectangle_contour(20.0, 0.0, 30.0, 4.0),
            ],
        };
        let crossing = Region {
            contours: vec![rectangle_contour(5.0, 1.0, 25.0, 3.0)],
        };
        let mut budget = 64;
        let intervals = intersection_axis_intervals_with_pair_budget(
            &lhs,
            &crossing,
            RegionAxis::X,
            &mut budget,
        )
        .expect("projected intersection");
        assert_eq!(intervals, vec![(5.0, 10.0), (20.0, 25.0)]);

        let tangent = Region {
            contours: vec![rectangle_contour(10.0, 1.0, 20.0, 3.0)],
        };
        let mut tangent_budget = 64;
        assert!(
            intersection_axis_intervals_with_pair_budget(
                &lhs,
                &tangent,
                RegionAxis::X,
                &mut tangent_budget,
            )
            .expect("tangent projection")
            .is_empty()
        );
    }

    #[test]
    fn intersection_axis_intervals_charge_the_boolean_pair_budget() {
        let lhs = Region {
            contours: vec![rectangle_contour(0.0, 0.0, 10.0, 4.0)],
        };
        let rhs = Region {
            contours: vec![rectangle_contour(5.0, 1.0, 15.0, 3.0)],
        };
        let mut budget = 0;
        assert_eq!(
            intersection_axis_intervals_with_pair_budget(&lhs, &rhs, RegionAxis::X, &mut budget,),
            Err(ShapeError::BooleanPairLimit)
        );
    }

    fn closed_cubic_region(scale: f64, translate_x: f64) -> Region {
        Region {
            contours: vec![Contour {
                segments: vec![CurveSegment::Cubic {
                    p0: Point2D {
                        x: translate_x,
                        y: 0.0,
                    },
                    p1: Point2D {
                        x: translate_x,
                        y: scale,
                    },
                    p2: Point2D {
                        x: translate_x + scale,
                        y: scale,
                    },
                    p3: Point2D {
                        x: translate_x,
                        y: 0.0,
                    },
                }],
                closed: true,
            }],
        }
    }

    fn polygon_circle(segment_count: usize, radius: f64, translate_x: f64) -> Region {
        let mut points = (0..segment_count)
            .map(|index| {
                let angle = std::f64::consts::TAU * index as f64 / segment_count as f64;
                Point2D {
                    x: translate_x + radius * angle.cos(),
                    y: radius * angle.sin(),
                }
            })
            .collect::<Vec<_>>();
        points.push(points[0]);
        Region {
            contours: vec![Contour {
                segments: points
                    .windows(2)
                    .map(|window| CurveSegment::Line {
                        p0: window[0],
                        p1: window[1],
                    })
                    .collect(),
                closed: true,
            }],
        }
    }

    fn with_forced_bbox_index_full_scan<T>(force_full_scan: bool, action: impl FnOnce() -> T) -> T {
        struct FullScanOverrideReset(bool);

        impl Drop for FullScanOverrideReset {
            fn drop(&mut self) {
                FORCE_BBOX_INDEX_FULL_SCAN
                    .with(|full_scan_override| full_scan_override.set(self.0));
            }
        }

        let previous_override = FORCE_BBOX_INDEX_FULL_SCAN
            .with(|full_scan_override| full_scan_override.replace(force_full_scan));
        let _reset = FullScanOverrideReset(previous_override);
        action()
    }

    fn boolean_path_result_with_forced_bbox_index(
        lhs: &Region,
        rhs: &Region,
        op: BooleanOp,
        force_full_scan: bool,
    ) -> Result<String, ShapeError> {
        with_forced_bbox_index_full_scan(force_full_scan, || {
            boolean_regions(lhs, rhs, op).map(|region| region_to_path(&region))
        })
    }

    fn assert_large_disjoint_intersection_skip(
        lhs: &Region,
        rhs: &Region,
        tolerance: GeometryTolerance,
    ) -> (usize, usize) {
        let flattened_lhs = flatten_region_curves(lhs, tolerance);
        let flattened_rhs = flatten_region_curves(rhs, tolerance);
        let lhs_segment_count = indexed_segments(&flattened_lhs).len();
        let rhs_segment_count = indexed_segments(&flattened_rhs).len();
        assert!(intersections_between_regions(&flattened_lhs, &flattened_rhs).is_empty());
        REGION_INTERSECTION_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| {
            assert_eq!(pair_count.get(), 0);
        });
        (lhs_segment_count, rhs_segment_count)
    }

    fn boolean_path_result_with_forced_pairing(
        lhs: &Region,
        rhs: &Region,
        op: BooleanOp,
        force_pairing: bool,
    ) -> Result<String, ShapeError> {
        struct PairingOverrideReset(bool);

        impl Drop for PairingOverrideReset {
            fn drop(&mut self) {
                FORCE_BOOLEAN_INTERSECTION_PAIRING
                    .with(|pairing_override| pairing_override.set(self.0));
            }
        }

        let previous_override = FORCE_BOOLEAN_INTERSECTION_PAIRING
            .with(|pairing_override| pairing_override.replace(force_pairing));
        let _reset = PairingOverrideReset(previous_override);
        boolean_regions(lhs, rhs, op).map(|region| region_to_path(&region))
    }

    #[test]
    fn disjoint_curved_booleans_skip_all_segment_pairing() {
        let tolerance = GeometryTolerance::default();
        let scale = 1_000_000.0;
        let lhs = closed_cubic_region(scale, 0.0);
        let rhs = closed_cubic_region(scale, scale * 3.0);
        let (lhs_segment_count, rhs_segment_count) =
            assert_large_disjoint_intersection_skip(&lhs, &rhs, tolerance);
        assert!(lhs_segment_count >= 8_000, "lhs={lhs_segment_count}");
        assert!(rhs_segment_count >= 8_000, "rhs={rhs_segment_count}");
        assert!(
            lhs_segment_count.saturating_mul(rhs_segment_count) >= 60_000_000,
            "lhs={lhs_segment_count} rhs={rhs_segment_count}"
        );
        let result = boolean_regions(&lhs, &rhs, BooleanOp::Union).expect("disjoint union");
        assert_eq!(result.contours.len(), 2);
        assert!(result.contours.iter().all(|contour| contour.closed));
        BOOLEAN_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| {
            assert_eq!(pair_count.get(), 0);
        });
        let lhs_result = Region {
            contours: vec![result.contours[0].clone()],
        };
        let translated_rhs_result = transform_region(
            &Region {
                contours: vec![result.contours[1].clone()],
            },
            AffineMatrix {
                a: 1.0,
                b: 0.0,
                c: 0.0,
                d: 1.0,
                e: -scale * 3.0,
                f: 0.0,
            },
        );
        assert_eq!(
            region_to_path(&lhs_result),
            region_to_path(&translated_rhs_result)
        );

        let semantic_scale = 100.0;
        let semantic_lhs = closed_cubic_region(semantic_scale, 0.0);
        let semantic_rhs = closed_cubic_region(semantic_scale, semantic_scale * 3.0);
        let empty = Region {
            contours: Vec::new(),
        };
        let semantic_union = boolean_regions(&semantic_lhs, &semantic_rhs, BooleanOp::Union)
            .expect("semantic disjoint union");
        let lhs_only =
            boolean_regions(&semantic_lhs, &empty, BooleanOp::Union).expect("lhs union empty");
        let rhs_only =
            boolean_regions(&semantic_rhs, &empty, BooleanOp::Union).expect("rhs union empty");
        assert_eq!(
            region_to_path(&semantic_union),
            format!(
                "{} {}",
                region_to_path(&lhs_only),
                region_to_path(&rhs_only)
            )
        );

        for (op, expected_contour_count) in [
            (BooleanOp::Union, 2),
            (BooleanOp::Subtract, 1),
            (BooleanOp::Intersect, 0),
            (BooleanOp::Xor, 2),
        ] {
            let result =
                boolean_regions(&semantic_lhs, &semantic_rhs, op).expect("disjoint boolean");
            assert_eq!(result.contours.len(), expected_contour_count, "op={op:?}");
            BOOLEAN_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| {
                assert_eq!(pair_count.get(), 0, "op={op:?}");
            });
        }

        for op in [BooleanOp::Union, BooleanOp::Intersect, BooleanOp::Xor] {
            let forward = boolean_regions(&semantic_lhs, &semantic_rhs, op)
                .expect("forward disjoint boolean");
            let reversed = boolean_regions(&semantic_rhs, &semantic_lhs, op)
                .expect("reversed disjoint boolean");
            assert_eq!(
                region_to_path(&forward),
                region_to_path(&reversed),
                "op={op:?}"
            );
        }

        for (left, right, op, expected_contour_count) in [
            (&semantic_lhs, &empty, BooleanOp::Union, 1),
            (&semantic_lhs, &empty, BooleanOp::Subtract, 1),
            (&semantic_lhs, &empty, BooleanOp::Intersect, 0),
            (&semantic_lhs, &empty, BooleanOp::Xor, 1),
            (&empty, &semantic_rhs, BooleanOp::Union, 1),
            (&empty, &semantic_rhs, BooleanOp::Subtract, 0),
            (&empty, &semantic_rhs, BooleanOp::Intersect, 0),
            (&empty, &semantic_rhs, BooleanOp::Xor, 1),
        ] {
            let result = boolean_regions(left, right, op).expect("empty-operand boolean");
            assert_eq!(result.contours.len(), expected_contour_count, "op={op:?}");
            BOOLEAN_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| {
                assert_eq!(pair_count.get(), 0, "op={op:?}");
            });
        }
    }

    #[test]
    fn disjoint_boolean_skip_preserves_normalization_and_validation() {
        let far = Region {
            contours: vec![rectangle_contour(100.0, 0.0, 101.0, 1.0)],
        };
        let nested_same_orientation = Region {
            contours: vec![
                rectangle_contour(0.0, 0.0, 10.0, 10.0),
                rectangle_contour(3.0, 3.0, 7.0, 7.0),
            ],
        };
        let union = boolean_regions(&nested_same_orientation, &far, BooleanOp::Union)
            .expect("normalized disjoint union");
        assert_eq!(
            region_to_path(&union),
            "M0,0L10,0L10,10L0,10Z M100,0L101,0L101,1L100,1Z"
        );

        let duplicate = Region {
            contours: vec![
                rectangle_contour(0.0, 0.0, 2.0, 2.0),
                rectangle_contour(0.0, 0.0, 2.0, 2.0),
            ],
        };
        let deduplicated = boolean_regions(&duplicate, &far, BooleanOp::Union)
            .expect("deduplicated disjoint union");
        assert_eq!(
            region_to_path(&deduplicated),
            "M0,0L2,0L2,2L0,2Z M100,0L101,0L101,1L100,1Z"
        );

        let bow_tie = Region {
            contours: vec![Contour {
                segments: [
                    Point2D { x: 0.0, y: 0.0 },
                    Point2D { x: 4.0, y: 4.0 },
                    Point2D { x: 4.0, y: 0.0 },
                    Point2D { x: 0.0, y: 4.0 },
                    Point2D { x: 0.0, y: 0.0 },
                ]
                .windows(2)
                .map(|window| CurveSegment::Line {
                    p0: window[0],
                    p1: window[1],
                })
                .collect(),
                closed: true,
            }],
        };
        let mut open = Region {
            contours: vec![rectangle_contour(0.0, 0.0, 2.0, 2.0)],
        };
        open.contours[0].segments.pop();
        open.contours[0].closed = false;
        let non_finite = Region {
            contours: vec![Contour {
                segments: vec![
                    CurveSegment::Line {
                        p0: Point2D { x: 0.0, y: 0.0 },
                        p1: Point2D {
                            x: f64::NAN,
                            y: 0.0,
                        },
                    },
                    CurveSegment::Line {
                        p0: Point2D {
                            x: f64::NAN,
                            y: 0.0,
                        },
                        p1: Point2D { x: 1.0, y: 1.0 },
                    },
                    CurveSegment::Line {
                        p0: Point2D { x: 1.0, y: 1.0 },
                        p1: Point2D { x: 0.0, y: 0.0 },
                    },
                ],
                closed: true,
            }],
        };
        for invalid in [&bow_tie, &open, &non_finite] {
            assert_eq!(
                boolean_regions(invalid, &far, BooleanOp::Union),
                Err(ShapeError::BooleanTopology)
            );
        }

        for operand in [
            &nested_same_orientation,
            &duplicate,
            &bow_tie,
            &open,
            &non_finite,
        ] {
            assert_eq!(
                boolean_path_result_with_forced_pairing(operand, &far, BooleanOp::Union, false,),
                boolean_path_result_with_forced_pairing(operand, &far, BooleanOp::Union, true,)
            );
        }
    }

    #[test]
    fn long_segment_parameter_slack_does_not_create_out_of_bbox_splits() {
        let lhs = Region {
            contours: vec![rectangle_contour(0.0, -1.0, 1.0, 1.0)],
        };
        let long_edge_start = Point2D {
            x: -200_000.02,
            y: 0.0,
        };
        let long_edge_end = Point2D { x: -0.02, y: 0.0 };
        let rhs = Region {
            contours: vec![Contour {
                segments: vec![
                    CurveSegment::Line {
                        p0: long_edge_start,
                        p1: long_edge_end,
                    },
                    CurveSegment::Line {
                        p0: long_edge_end,
                        p1: Point2D {
                            x: -200_000.02,
                            y: -1.0,
                        },
                    },
                    CurveSegment::Line {
                        p0: Point2D {
                            x: -200_000.02,
                            y: -1.0,
                        },
                        p1: long_edge_start,
                    },
                ],
                closed: true,
            }],
        };
        let lhs_left_edge = lhs.contours[0].segments.last().expect("lhs left edge");
        let rhs_long_edge = &rhs.contours[0].segments[0];
        assert!(
            intersect_curve_segments(lhs_left_edge, rhs_long_edge, GeometryTolerance::default())
                .is_empty()
        );

        for op in [
            BooleanOp::Union,
            BooleanOp::Subtract,
            BooleanOp::Intersect,
            BooleanOp::Xor,
        ] {
            let expected_path = match op {
                BooleanOp::Union | BooleanOp::Xor => {
                    "M-200000.02,-1L-0.02,0L-200000.02,0Z M0,-1L1,-1L1,1L0,1Z"
                }
                BooleanOp::Subtract => "M0,-1L1,-1L1,1L0,1Z",
                BooleanOp::Intersect => "",
            };
            assert_eq!(
                boolean_path_result_with_forced_pairing(&lhs, &rhs, op, false),
                Ok(expected_path.to_owned()),
                "op={op:?}"
            );
            assert_eq!(
                boolean_path_result_with_forced_pairing(&lhs, &rhs, op, false),
                boolean_path_result_with_forced_pairing(&lhs, &rhs, op, true),
                "op={op:?}"
            );
        }

        let overlapping = Region {
            contours: vec![rectangle_contour(0.5, -0.5, 1.5, 0.5)],
        };
        for op in [
            BooleanOp::Union,
            BooleanOp::Subtract,
            BooleanOp::Intersect,
            BooleanOp::Xor,
        ] {
            assert_eq!(
                boolean_path_result_with_forced_pairing(&lhs, &overlapping, op, false),
                boolean_path_result_with_forced_pairing(&lhs, &overlapping, op, true),
                "overlapping op={op:?}"
            );
        }
    }

    #[test]
    fn long_segment_parameter_slack_stays_within_absolute_position_tolerance() {
        let rectangle = Region {
            contours: vec![rectangle_contour(0.0, -3.0, 200_000.0, 0.0)],
        };
        let wedge_points = [
            Point2D {
                x: 199_995.0,
                y: 5.0,
            },
            Point2D {
                x: 200_000.1,
                y: -0.02,
            },
            Point2D {
                x: 200_005.0,
                y: 5.0,
            },
            Point2D {
                x: 199_995.0,
                y: 5.0,
            },
        ];
        let wedge = Region {
            contours: vec![Contour {
                segments: wedge_points
                    .windows(2)
                    .map(|window| CurveSegment::Line {
                        p0: window[0],
                        p1: window[1],
                    })
                    .collect(),
                closed: true,
            }],
        };

        assert!(!region_bboxes_are_disjoint(
            &rectangle,
            &wedge,
            GeometryTolerance::default()
        ));
        assert!(intersections_between_regions(&rectangle, &wedge).is_empty());
        assert!(intersections_between_regions(&wedge, &rectangle).is_empty());

        for op in [
            BooleanOp::Union,
            BooleanOp::Subtract,
            BooleanOp::Intersect,
            BooleanOp::Xor,
        ] {
            let expected_path = match op {
                BooleanOp::Union | BooleanOp::Xor => {
                    "M0,-3L200000,-3L200000,0L0,0Z M200000.1,-0.02L200005,5L199995,5Z"
                }
                BooleanOp::Subtract => "M0,-3L200000,-3L200000,0L0,0Z",
                BooleanOp::Intersect => "",
            };
            assert_eq!(
                boolean_path_result_with_forced_pairing(&rectangle, &wedge, op, false),
                Ok(expected_path.to_owned()),
                "op={op:?}"
            );
            assert_eq!(
                boolean_path_result_with_forced_pairing(&rectangle, &wedge, op, false),
                boolean_path_result_with_forced_pairing(&rectangle, &wedge, op, true),
                "op={op:?}"
            );
        }
    }

    #[test]
    fn overlapping_region_bounds_use_local_bbox_candidates() {
        let tolerance = GeometryTolerance::default();
        let segment_count = 4_096;
        let outer = polygon_circle(segment_count, 100.0, 0.0);
        let inner = polygon_circle(segment_count, 50.0, 0.0);
        assert!(!region_bboxes_are_disjoint(&outer, &inner, tolerance));

        let union = boolean_regions(&outer, &inner, BooleanOp::Union).expect("concentric union");
        assert_eq!(union.contours.len(), 1);
        BOOLEAN_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| {
            assert_eq!(pair_count.get(), segment_count * segment_count);
        });
        let boolean_candidates = BOOLEAN_SEGMENT_PAIR_CANDIDATE_COUNT.with(std::cell::Cell::get);
        let contour_self_candidates =
            CONTOUR_SELF_INTERSECTION_CANDIDATE_COUNT.with(std::cell::Cell::get);
        let split_candidates = SELF_INTERSECTION_SPLIT_CANDIDATE_COUNT.with(std::cell::Cell::get);
        let membership_candidates = POINT_IN_REGION_EDGE_CANDIDATE_COUNT.with(std::cell::Cell::get);
        assert_eq!(boolean_candidates, 0);
        // A simple contour should visit fewer than two leaf buckets per edge.
        assert!(contour_self_candidates > 0);
        assert!(contour_self_candidates < segment_count * BBOX_INDEX_LEAF_CAPACITY * 2);
        assert_eq!(split_candidates, 0);
        // Each source edge can exhaust every probe distance plus the fallback,
        // on two sides, against two regions, for both operands. Averaged over
        // these smooth contours, each query must stay within one leaf bucket.
        let max_membership_queries_per_source_edge = (probe_distances(1.0).len() + 1) * 2 * 2 * 2;
        let membership_candidate_bound =
            segment_count * max_membership_queries_per_source_edge * BBOX_INDEX_LEAF_CAPACITY;
        assert!(membership_candidates > 0);
        assert!(membership_candidates < membership_candidate_bound);

        assert!(intersections_between_regions(&outer, &inner).is_empty());
        REGION_INTERSECTION_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| {
            assert_eq!(pair_count.get(), segment_count * segment_count);
        });
        REGION_INTERSECTION_SEGMENT_PAIR_CANDIDATE_COUNT.with(|pair_count| {
            assert_eq!(pair_count.get(), 0);
        });

        let crossing = polygon_circle(segment_count, 100.0, 100.0);
        let crossing_union =
            boolean_regions(&outer, &crossing, BooleanOp::Union).expect("crossing union");
        assert!(!crossing_union.contours.is_empty());
        BOOLEAN_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| {
            assert_eq!(pair_count.get(), segment_count * segment_count);
        });
        BOOLEAN_SEGMENT_PAIR_CANDIDATE_COUNT.with(|pair_count| {
            // Two smooth crossing boundaries should average less than one
            // leaf bucket per lhs edge, not every rhs edge.
            assert!(pair_count.get() > 0);
            assert!(pair_count.get() < segment_count * BBOX_INDEX_LEAF_CAPACITY);
        });

        assert!(!intersections_between_regions(&outer, &crossing).is_empty());
        REGION_INTERSECTION_SEGMENT_PAIR_CANDIDATE_COUNT.with(|pair_count| {
            assert!(pair_count.get() > 0);
            assert!(pair_count.get() < segment_count * BBOX_INDEX_LEAF_CAPACITY);
        });

        let mut locally_self_intersecting =
            polygon_circle(segment_count, 100.0, 0.0).contours.remove(0);
        let p0 = locally_self_intersecting.segments[0].start();
        let p1 = locally_self_intersecting.segments[1].start();
        let p2 = locally_self_intersecting.segments[2].start();
        let p3 = locally_self_intersecting.segments[3].start();
        locally_self_intersecting.segments[0] = CurveSegment::Line { p0, p1: p2 };
        locally_self_intersecting.segments[1] = CurveSegment::Line { p0: p2, p1 };
        locally_self_intersecting.segments[2] = CurveSegment::Line { p0: p1, p1: p3 };
        let indexed_self_segments = locally_self_intersecting
            .segments
            .iter()
            .enumerate()
            .map(|(segment_index, segment)| IndexedSegment {
                contour_index: 0,
                segment_index,
                segment: segment.clone(),
                bbox: segment.bbox(),
            })
            .collect::<Vec<_>>();
        SELF_INTERSECTION_SPLIT_CANDIDATE_COUNT.with(|candidate_count| candidate_count.set(0));
        let split_parameters =
            self_intersection_split_parameters(&indexed_self_segments, tolerance);
        assert!(
            split_parameters
                .iter()
                .any(|parameters| parameters.len() > 2)
        );
        SELF_INTERSECTION_SPLIT_CANDIDATE_COUNT.with(|candidate_count| {
            assert!(candidate_count.get() > 0);
            assert!(candidate_count.get() < segment_count * BBOX_INDEX_LEAF_CAPACITY * 4);
        });
    }

    #[test]
    fn small_bbox_workloads_keep_the_linear_scan_path() {
        let segment_count = 32;
        assert!(!should_use_bbox_index(segment_count, segment_count));
        assert!(!should_use_bbox_index(segment_count, segment_count * 2));
        assert!(!should_use_bbox_index(4_096, 3));
        let detailed_query_floor = ceil_log2(4_096).pow(2);
        assert!(!should_use_bbox_index(4_096, detailed_query_floor - 1));
        assert!(should_use_bbox_index(48, 48));
        assert!(should_use_bbox_index(4_096, detailed_query_floor));

        let lhs = polygon_circle(segment_count, 100.0, 0.0);
        let rhs = polygon_circle(segment_count, 100.0, 100.0);
        assert!(
            !boolean_regions(&lhs, &rhs, BooleanOp::Union)
                .expect("small crossing union")
                .contours
                .is_empty()
        );
        BOOLEAN_SEGMENT_PAIR_CANDIDATE_COUNT.with(|candidate_count| {
            assert_eq!(candidate_count.get(), segment_count * segment_count);
        });
        CONTOUR_SELF_INTERSECTION_CANDIDATE_COUNT.with(|candidate_count| {
            assert_eq!(candidate_count.get(), 0);
        });
        POINT_IN_REGION_EDGE_CANDIDATE_COUNT.with(|candidate_count| {
            assert_eq!(candidate_count.get(), 0);
        });

        assert!(!intersections_between_regions(&lhs, &rhs).is_empty());
        REGION_INTERSECTION_SEGMENT_PAIR_CANDIDATE_COUNT.with(|candidate_count| {
            assert_eq!(candidate_count.get(), segment_count * segment_count);
        });

        let coarse_lhs = polygon_circle(3, 100.0, 100.0);
        let detailed_rhs = polygon_circle(4_096, 100.0, 0.0);
        assert!(!intersections_between_regions(&coarse_lhs, &detailed_rhs).is_empty());
        REGION_INTERSECTION_SEGMENT_PAIR_CANDIDATE_COUNT.with(|candidate_count| {
            assert_eq!(candidate_count.get(), 3 * 4_096);
        });
    }

    #[test]
    fn bbox_index_matches_full_scan_for_overlapping_boolean_regions() {
        let cases = [
            (
                "crossing",
                polygon_circle(96, 100.0, 0.0),
                polygon_circle(96, 100.0, 100.0),
            ),
            (
                "concentric",
                polygon_circle(96, 100.0, 0.0),
                polygon_circle(96, 50.0, 0.0),
            ),
        ];
        for (case, lhs, rhs) in cases {
            for op in [
                BooleanOp::Union,
                BooleanOp::Subtract,
                BooleanOp::Intersect,
                BooleanOp::Xor,
            ] {
                assert_eq!(
                    boolean_path_result_with_forced_bbox_index(&lhs, &rhs, op, false),
                    boolean_path_result_with_forced_bbox_index(&lhs, &rhs, op, true),
                    "case={case} op={op:?}"
                );
            }

            let optimized = with_forced_bbox_index_full_scan(false, || {
                intersections_between_regions(&lhs, &rhs)
            });
            let full_scan = with_forced_bbox_index_full_scan(true, || {
                intersections_between_regions(&lhs, &rhs)
            });
            assert_eq!(optimized, full_scan, "case={case}");
        }
    }

    #[test]
    fn bbox_index_matches_linear_scan_for_branching_containment_and_self_intersections() {
        let tolerance = GeometryTolerance::default();
        let small_region = polygon_circle(32, 100.0, 0.0);
        let small_prepared = prepare_region_with_edge_index(&small_region, tolerance, 64);
        assert!(small_prepared.contours[0].edge_index.is_none());

        let region = polygon_circle(128, 100.0, 0.0);
        let linear_prepared = prepare_region(&region, tolerance);
        assert!(
            linear_prepared
                .contours
                .iter()
                .all(|contour| contour.edge_index.is_none())
        );
        let prepared = prepare_region_with_edge_index(&region, tolerance, 256);
        assert!(
            prepared.contours[0]
                .edge_index
                .as_ref()
                .is_some_and(|index| index.nodes.len() > 1)
        );
        for x_step in -6..=6 {
            for y_step in -6..=6 {
                let point = Point2D {
                    x: f64::from(x_step) * 20.0,
                    y: f64::from(y_step) * 20.0,
                };
                let expected =
                    point_in_closed_polyline_halfopen(&prepared.contours[0].flattened, point);
                let optimized = with_forced_bbox_index_full_scan(false, || {
                    point_in_prepared_contour_halfopen(&prepared.contours[0], point)
                });
                let full_scan = with_forced_bbox_index_full_scan(true, || {
                    point_in_prepared_contour_halfopen(&prepared.contours[0], point)
                });
                assert_eq!(optimized, expected, "point={point:?}");
                assert_eq!(optimized, full_scan, "point={point:?}");
                assert_eq!(
                    point_in_region(&region, &linear_prepared, point),
                    point_in_region(&region, &prepared, point),
                    "prepared point={point:?}"
                );
            }
        }

        let star_segment_count = 65;
        let mut star_points = (0..star_segment_count)
            .map(|index| {
                let vertex_index = (index * 7) % star_segment_count;
                let angle =
                    std::f64::consts::TAU * f64::from(vertex_index) / f64::from(star_segment_count);
                Point2D {
                    x: 100.0 * angle.cos(),
                    y: 100.0 * angle.sin(),
                }
            })
            .collect::<Vec<_>>();
        star_points.push(star_points[0]);
        let self_intersecting = Contour {
            segments: star_points
                .windows(2)
                .map(|window| CurveSegment::Line {
                    p0: window[0],
                    p1: window[1],
                })
                .collect::<Vec<_>>(),
            closed: true,
        };
        let optimized_has_intersection = with_forced_bbox_index_full_scan(false, || {
            contour_has_self_intersections(&self_intersecting, tolerance)
        });
        let full_scan_has_intersection = with_forced_bbox_index_full_scan(true, || {
            contour_has_self_intersections(&self_intersecting, tolerance)
        });
        assert!(optimized_has_intersection);
        assert_eq!(optimized_has_intersection, full_scan_has_intersection);

        let indexed_segments = self_intersecting
            .segments
            .iter()
            .enumerate()
            .map(|(segment_index, segment)| IndexedSegment {
                contour_index: 0,
                segment_index,
                segment: segment.clone(),
                bbox: segment.bbox(),
            })
            .collect::<Vec<_>>();
        let segment_bboxes = indexed_segments
            .iter()
            .map(|segment| segment.bbox)
            .collect::<Vec<_>>();
        assert!(BBoxIndex::new(&segment_bboxes).nodes.len() > 1);
        let optimized_parameters = with_forced_bbox_index_full_scan(false, || {
            self_intersection_split_parameters(&indexed_segments, tolerance)
        });
        let full_scan_parameters = with_forced_bbox_index_full_scan(true, || {
            self_intersection_split_parameters(&indexed_segments, tolerance)
        });
        assert_eq!(optimized_parameters, full_scan_parameters);
    }

    #[test]
    fn halfopen_ray_clamps_floating_point_overshoot_to_the_edge_bbox() {
        let edge_start = Point2D {
            x: -942_196.175_435_864_5,
            y: 411_582.813_244_804_74,
        };
        let edge_end = Point2D {
            x: 214_788.288_312_027_93,
            y: 257_425.596_464_183_88,
        };
        let point = Point2D {
            x: 214_788.288_312_027_96,
            y: edge_end.y,
        };
        let raw_interpolation = edge_start.x
            + ((point.y - edge_start.y) / (edge_end.y - edge_start.y))
                * (edge_end.x - edge_start.x);
        assert!(raw_interpolation > point.x);
        assert_eq!(
            halfopen_ray_crossing_x(edge_start, edge_end, point.y),
            edge_end.x
        );

        let mut bboxes = vec![BBox::from_points(&[edge_start, edge_end])];
        bboxes.extend((0..7).map(|index| BBox {
            min_x: -900_000.0 + f64::from(index) * 50_000.0,
            min_y: point.y - 1.0,
            max_x: -899_999.0 + f64::from(index) * 50_000.0,
            max_y: point.y + 1.0,
        }));
        bboxes.extend((0..8).map(|index| BBox {
            min_x: 300_000.0 + f64::from(index) * 50_000.0,
            min_y: point.y - 1.0,
            max_x: 300_001.0 + f64::from(index) * 50_000.0,
            max_y: point.y + 1.0,
        }));
        let index = BBoxIndex::new(&bboxes);
        let ray_bbox = BBox {
            min_x: point.x,
            min_y: point.y,
            max_x: 1_000_000.0,
            max_y: point.y,
        };
        assert!(!index.query(ray_bbox, 0.0).contains(&0));

        let flattened = vec![
            edge_start,
            edge_end,
            Point2D {
                x: -1_000_000.0,
                y: 200_000.0,
            },
            edge_start,
        ];
        let edge_bboxes = flattened
            .windows(2)
            .map(BBox::from_points)
            .collect::<Vec<_>>();
        let prepared_contour = PreparedContour {
            bbox: BBox::from_points(&flattened),
            is_ccw: signed_area(&flattened) > 0.0,
            edge_index: Some(BBoxIndex::new(&edge_bboxes)),
            flattened,
        };
        assert!(!point_in_closed_polyline_halfopen(
            &prepared_contour.flattened,
            point
        ));
        assert!(!point_in_prepared_contour_halfopen(
            &prepared_contour,
            point
        ));
    }

    #[test]
    fn bbox_index_non_finite_queries_fall_back_to_all_candidates() {
        let mut bboxes = (0..16)
            .map(|index| BBox {
                min_x: f64::from(index) * 10.0,
                min_y: 0.0,
                max_x: f64::from(index) * 10.0 + 1.0,
                max_y: 1.0,
            })
            .collect::<Vec<_>>();
        bboxes.push(BBox {
            min_x: f64::NAN,
            min_y: 0.0,
            max_x: 2.0,
            max_y: 2.0,
        });
        let index = BBoxIndex::new(&bboxes);
        assert!(index.nodes.len() > 1);
        let far_query = BBox {
            min_x: 1_000.0,
            min_y: 1_000.0,
            max_x: 1_001.0,
            max_y: 1_001.0,
        };
        assert_eq!(index.query(far_query, 0.0), vec![16]);
        assert_eq!(index.query(bboxes[16], 0.0), (0..17).collect::<Vec<_>>());
    }

    #[test]
    fn disjoint_boolean_intersection_skip_respects_the_bbox_tolerance_boundary() {
        let square = |offset_x: f64| Region {
            contours: vec![rectangle_contour(offset_x, 0.0, offset_x + 1.0, 1.0)],
        };
        let lhs = square(0.0);
        let within_tolerance = square(1.005);
        let at_tolerance = square(1.01);
        let outside_tolerance = square(1.02);

        boolean_regions(&lhs, &within_tolerance, BooleanOp::Union).expect("nearby union");
        BOOLEAN_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| {
            assert_eq!(pair_count.get(), 16);
        });

        boolean_regions(&lhs, &at_tolerance, BooleanOp::Union).expect("boundary union");
        BOOLEAN_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| {
            assert_eq!(pair_count.get(), 16);
        });

        boolean_regions(&lhs, &outside_tolerance, BooleanOp::Union).expect("disjoint union");
        BOOLEAN_SEGMENT_PAIR_UPPER_BOUND.with(|pair_count| {
            assert_eq!(pair_count.get(), 0);
        });
    }
}
