//! Geometry planner for text flow around exclusion shapes.
//!
//! Given a set of exclusion shapes and a horizontal line band, computes the
//! free regions where text can be placed.  Uses conservative band intersection
//! so that shapes clipping only the top or bottom of a band are never missed.

use kurbo::{CubicBez, Line, ParamCurve, PathSeg, Point, QuadBez};
use serde::Deserialize;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// A box defining the flow area (absolute coordinates).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FlowBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Fill rule for path exclusions (filled closed paths only).
#[derive(Debug, Clone, Copy, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FillRule {
    #[default]
    Nonzero,
    Evenodd,
}

/// Edge-specific clearance around an exclusion shape.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FlowExclusionMarginEdges {
    #[serde(default)]
    pub top: f64,
    #[serde(default)]
    pub right: f64,
    #[serde(default)]
    pub bottom: f64,
    #[serde(default)]
    pub left: f64,
}

/// Scalar or edge-specific exclusion clearance.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(untagged)]
pub(crate) enum FlowExclusionMargin {
    All(f64),
    Edges(FlowExclusionMarginEdges),
}

impl Default for FlowExclusionMargin {
    fn default() -> Self {
        Self::All(0.0)
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct EdgeInsets {
    top: f64,
    right: f64,
    bottom: f64,
    left: f64,
}

impl FlowExclusionMargin {
    fn to_insets(self) -> EdgeInsets {
        match self {
            Self::All(value) => {
                let margin = normalize_margin_px(value);
                EdgeInsets {
                    top: margin,
                    right: margin,
                    bottom: margin,
                    left: margin,
                }
            }
            Self::Edges(edges) => EdgeInsets {
                top: normalize_margin_px(edges.top),
                right: normalize_margin_px(edges.right),
                bottom: normalize_margin_px(edges.bottom),
                left: normalize_margin_px(edges.left),
            },
        }
    }
}

fn normalize_margin_px(value: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        0.0
    }
}

/// A shape that excludes text from flowing through it.
///
/// `margin_px` is conservative clearance around the shape. A scalar expands all
/// edges equally; object input can set top/right/bottom/left independently.
#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum FlowExclusionShape {
    Rect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        #[serde(default)]
        margin_px: FlowExclusionMargin,
    },
    Circle {
        cx: f64,
        cy: f64,
        r: f64,
        #[serde(default)]
        margin_px: FlowExclusionMargin,
    },
    Path {
        d: String,
        #[serde(default)]
        x: f64,
        #[serde(default)]
        y: f64,
        #[serde(default)]
        fill_rule: FillRule,
        #[serde(default)]
        margin_px: FlowExclusionMargin,
    },
}

/// A horizontal interval occupied by an exclusion shape.
#[derive(Debug, Clone, Copy)]
struct OccupiedInterval {
    left: f64,
    right: f64,
}

/// A free region where text can be placed on a given line band.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct FreeRegion {
    pub x: f64,
    pub width: f64,
}

// ---------------------------------------------------------------------------
// Core entry point
// ---------------------------------------------------------------------------

/// Compute free regions for a horizontal band within the flow box.
///
/// 1. For each exclusion, compute the occupied x-interval(s) for the band.
/// 2. Merge overlapping intervals.
/// 3. Subtract from the flow box x-range.
/// 4. Filter out regions narrower than `min_region_width`.
pub(crate) fn compute_line_regions(
    flow_box: &FlowBox,
    exclusions: &[FlowExclusionShape],
    line_top: f64,
    line_bottom: f64,
    min_region_width: f64,
) -> Vec<FreeRegion> {
    let flow_left = flow_box.x;
    let flow_right = flow_box.x + flow_box.width;

    let mut occupied = Vec::new();

    for exclusion in exclusions {
        match exclusion {
            FlowExclusionShape::Rect {
                x,
                y,
                width,
                height,
                margin_px,
            } => {
                occupied_from_rect(
                    *x,
                    *y,
                    *width,
                    *height,
                    margin_px.to_insets(),
                    line_top,
                    line_bottom,
                    &mut occupied,
                );
            }
            FlowExclusionShape::Circle {
                cx,
                cy,
                r,
                margin_px,
            } => {
                occupied_from_circle(
                    *cx,
                    *cy,
                    *r,
                    margin_px.to_insets(),
                    line_top,
                    line_bottom,
                    &mut occupied,
                );
            }
            FlowExclusionShape::Path {
                d,
                x,
                y,
                fill_rule,
                margin_px,
            } => {
                occupied_from_path(
                    d,
                    *x,
                    *y,
                    *fill_rule,
                    margin_px.to_insets(),
                    line_top,
                    line_bottom,
                    &mut occupied,
                );
            }
        }
    }

    merge_intervals(&mut occupied);
    subtract_from_range(flow_left, flow_right, &occupied, min_region_width)
}

/// A free region where text can be placed within a vertical column strip.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct FreeColumnRegion {
    pub y: f64,
    pub height: f64,
}

/// Compute free regions for a vertical column strip within the flow box.
///
/// Mirrors `compute_line_regions` with axes swapped:
/// takes an x-strip `[column_left, column_right]` and returns free
/// y-intervals where text can flow vertically.
pub(crate) fn compute_column_regions(
    flow_box: &FlowBox,
    exclusions: &[FlowExclusionShape],
    column_left: f64,
    column_right: f64,
    min_region_height: f64,
) -> Vec<FreeColumnRegion> {
    let flow_top = flow_box.y;
    let flow_bottom = flow_box.y + flow_box.height;

    let mut occupied = Vec::new();

    for exclusion in exclusions {
        match exclusion {
            FlowExclusionShape::Rect {
                x,
                y,
                width,
                height,
                margin_px,
            } => {
                // Axis-swapped rect: check x-overlap with the column strip,
                // produce y-intervals.
                let insets = margin_px.to_insets();
                let rect_left = *x - insets.left;
                let rect_right = *x + *width + insets.right;

                if column_right > rect_left && column_left < rect_right {
                    occupied.push(OccupiedInterval {
                        left: *y - insets.top,
                        right: *y + *height + insets.bottom,
                    });
                }
            }
            FlowExclusionShape::Circle {
                cx,
                cy,
                r,
                margin_px,
            } => {
                // Axis-swapped circle: find x closest to cx within the strip,
                // compute occupied y-interval.
                let insets = margin_px.to_insets();
                let strip_left = column_left - insets.right;
                let strip_right = column_right + insets.left;
                let x_closest = cx.clamp(strip_left, strip_right);
                let dx = (x_closest - *cx).abs();

                if dx < *r {
                    let dy = (*r * *r - dx * dx).sqrt();
                    occupied.push(OccupiedInterval {
                        left: *cy - dy - insets.top,
                        right: *cy + dy + insets.bottom,
                    });
                }
            }
            FlowExclusionShape::Path {
                d,
                x,
                y,
                fill_rule: _,
                margin_px,
            } => {
                // Conservative: use the path's bounding box for vertical strips.
                // Full scanline intersection on the x-axis is complex; bounding
                // box is a safe approximation.
                if let Some(bbox) = path_bounding_box(d, *x, *y) {
                    let insets = margin_px.to_insets();
                    let bbox_left = bbox.0 - insets.left;
                    let bbox_right = bbox.2 + insets.right;

                    if column_right > bbox_left && column_left < bbox_right {
                        occupied.push(OccupiedInterval {
                            left: bbox.1 - insets.top,
                            right: bbox.3 + insets.bottom,
                        });
                    }
                }
            }
        }
    }

    merge_intervals(&mut occupied);

    // Subtract from flow box y-range, producing free column regions.
    let free_x = subtract_from_range(flow_top, flow_bottom, &occupied, min_region_height);
    free_x
        .into_iter()
        .map(|r| FreeColumnRegion {
            y: r.x,
            height: r.width,
        })
        .collect()
}

/// Compute the bounding box of an SVG path using the existing segment parser.
/// Returns `Some((min_x, min_y, max_x, max_y))` or `None` if the path has no segments.
fn path_bounding_box(
    path_data: &str,
    offset_x: f64,
    offset_y: f64,
) -> Option<(f64, f64, f64, f64)> {
    use kurbo::Shape;

    let segments = parse_path_segments(path_data, offset_x, offset_y);
    if segments.is_empty() {
        return None;
    }

    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;

    for seg in &segments {
        let bb = match seg {
            PathSeg::Line(l) => l.bounding_box(),
            PathSeg::Quad(q) => q.bounding_box(),
            PathSeg::Cubic(c) => c.bounding_box(),
        };
        min_x = min_x.min(bb.x0);
        min_y = min_y.min(bb.y0);
        max_x = max_x.max(bb.x1);
        max_y = max_y.max(bb.y1);
    }

    Some((min_x, min_y, max_x, max_y))
}

// ---------------------------------------------------------------------------
// Per-shape occupied interval computation (horizontal bands)
// ---------------------------------------------------------------------------

#[expect(
    clippy::too_many_arguments,
    reason = "rect geometry requires position, size, margin, and band range"
)]
fn occupied_from_rect(
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    insets: EdgeInsets,
    line_top: f64,
    line_bottom: f64,
    out: &mut Vec<OccupiedInterval>,
) {
    let rect_top = y - insets.top;
    let rect_bottom = y + h + insets.bottom;

    if line_bottom > rect_top && line_top < rect_bottom {
        out.push(OccupiedInterval {
            left: x - insets.left,
            right: x + w + insets.right,
        });
    }
}

fn occupied_from_circle(
    cx: f64,
    cy: f64,
    r: f64,
    insets: EdgeInsets,
    line_top: f64,
    line_bottom: f64,
    out: &mut Vec<OccupiedInterval>,
) {
    // Conservative: find y within the margin-expanded band closest to cy.
    // This gives the widest possible occupied interval within the band.
    let band_top = line_top - insets.bottom;
    let band_bottom = line_bottom + insets.top;
    let y_closest = cy.clamp(band_top, band_bottom);
    let dy = (y_closest - cy).abs();

    if dy >= r {
        return;
    }

    let dx = (r * r - dy * dy).sqrt();
    out.push(OccupiedInterval {
        left: cx - dx - insets.left,
        right: cx + dx + insets.right,
    });
}

// ---------------------------------------------------------------------------
// Path exclusion — boundary + x-extrema guided scanlines
// ---------------------------------------------------------------------------

/// Parse an SVG path `d` attribute and compute occupied intervals for the band.
///
/// Uses required scanlines (band top/mid/bottom) plus x-extrema scanlines from
/// curve segments.  Union of all gives a conservative occupied interval set.
// Path intersection needs font context, shaping options, fill rule, and margin
#[expect(
    clippy::too_many_arguments,
    reason = "path exclusion requires geometry params, fill rule, and margin"
)]
fn occupied_from_path(
    d: &str,
    offset_x: f64,
    offset_y: f64,
    fill_rule: FillRule,
    insets: EdgeInsets,
    line_top: f64,
    line_bottom: f64,
    out: &mut Vec<OccupiedInterval>,
) {
    let band_top = line_top - insets.bottom;
    let band_bottom = line_bottom + insets.top;
    let band_mid = f64::midpoint(band_top, band_bottom);

    let segments = parse_path_segments(d, offset_x, offset_y);
    if segments.is_empty() {
        return;
    }

    // Collect scanline y-values: required (top, mid, bottom) + x-extrema.
    let mut scanline_ys = vec![band_top, band_mid, band_bottom];
    for seg in &segments {
        for t in x_extrema_t_values(seg) {
            let pt = seg.eval(t);
            if pt.y > band_top && pt.y < band_bottom {
                scanline_ys.push(pt.y);
            }
        }
    }
    scanline_ys.sort_by(f64::total_cmp);
    scanline_ys.dedup_by(|a, b| (*a - *b).abs() < 1e-9);

    // For each scanline, compute occupied intervals via fill rule.
    let mut all_occupied = Vec::new();
    for y in &scanline_ys {
        let intervals = scanline_occupied(&segments, *y, fill_rule);
        for iv in intervals {
            all_occupied.push(OccupiedInterval {
                left: iv.left - insets.left,
                right: iv.right + insets.right,
            });
        }
    }

    out.append(&mut all_occupied);
}

/// Parse SVG path `d` into `kurbo::PathSeg` segments, applying translation offset.
fn parse_path_segments(path_data: &str, offset_x: f64, offset_y: f64) -> Vec<PathSeg> {
    use svgtypes::SimplePathSegment;

    let parser = svgtypes::SimplifyingPathParser::from(path_data);
    let mut segments = Vec::new();
    let mut current = Point::new(0.0, 0.0);
    let mut subpath_start = current;

    for item in parser {
        let Ok(seg) = item else { continue };
        match seg {
            SimplePathSegment::MoveTo { x, y } => {
                current = Point::new(x + offset_x, y + offset_y);
                subpath_start = current;
            }
            SimplePathSegment::LineTo { x, y } => {
                let end = Point::new(x + offset_x, y + offset_y);
                segments.push(PathSeg::Line(Line::new(current, end)));
                current = end;
            }
            SimplePathSegment::Quadratic { x1, y1, x, y } => {
                let cp = Point::new(x1 + offset_x, y1 + offset_y);
                let end = Point::new(x + offset_x, y + offset_y);
                segments.push(PathSeg::Quad(QuadBez::new(current, cp, end)));
                current = end;
            }
            SimplePathSegment::CurveTo {
                x1,
                y1,
                x2,
                y2,
                x,
                y,
            } => {
                let cp1 = Point::new(x1 + offset_x, y1 + offset_y);
                let cp2 = Point::new(x2 + offset_x, y2 + offset_y);
                let end = Point::new(x + offset_x, y + offset_y);
                segments.push(PathSeg::Cubic(CubicBez::new(current, cp1, cp2, end)));
                current = end;
            }
            SimplePathSegment::ClosePath => {
                if (current.x - subpath_start.x).abs() > 1e-9
                    || (current.y - subpath_start.y).abs() > 1e-9
                {
                    segments.push(PathSeg::Line(Line::new(current, subpath_start)));
                }
                current = subpath_start;
            }
        }
    }

    segments
}

/// Compute t-values where dx/dt = 0 for a path segment (x-extrema only).
fn x_extrema_t_values(seg: &PathSeg) -> Vec<f64> {
    match seg {
        PathSeg::Line(_) => Vec::new(),
        PathSeg::Quad(q) => {
            // dx/dt = 2[(p1x - p0x) + t(p0x - 2·p1x + p2x)]
            let d0 = q.p1.x - q.p0.x;
            let dd = q.p0.x - 2.0 * q.p1.x + q.p2.x;
            if dd.abs() < 1e-12 {
                return Vec::new();
            }
            let t = -d0 / dd;
            if t > 0.0 && t < 1.0 {
                vec![t]
            } else {
                Vec::new()
            }
        }
        PathSeg::Cubic(c) => {
            // dx/dt = 3[(a - 2b + c)t² + (-2a + 2b)t + a]
            // where a = p1x - p0x, b = p2x - p1x, c = p3x - p2x
            let a = c.p1.x - c.p0.x;
            let b = c.p2.x - c.p1.x;
            let cv = c.p3.x - c.p2.x;
            let qa = a - 2.0 * b + cv;
            let qb = 2.0 * (b - a);
            let qc = a;
            solve_quadratic(qa, qb, qc)
        }
    }
}

/// Solve at² + bt + c = 0, returning roots in (0, 1).
fn solve_quadratic(a: f64, b: f64, c: f64) -> Vec<f64> {
    let mut roots = Vec::new();

    if a.abs() < 1e-12 {
        // Linear: bt + c = 0
        if b.abs() > 1e-12 {
            let t = -c / b;
            if t > 0.0 && t < 1.0 {
                roots.push(t);
            }
        }
        return roots;
    }

    let disc = b * b - 4.0 * a * c;
    if disc < 0.0 {
        return roots;
    }

    let sqrt_disc = disc.sqrt();
    let t1 = (-b - sqrt_disc) / (2.0 * a);
    let t2 = (-b + sqrt_disc) / (2.0 * a);

    if t1 > 0.0 && t1 < 1.0 {
        roots.push(t1);
    }
    if t2 > 0.0 && t2 < 1.0 && (t2 - t1).abs() > 1e-12 {
        roots.push(t2);
    }

    roots
}

/// Compute occupied x-intervals at a given scanline y using fill rule.
fn scanline_occupied(segments: &[PathSeg], y: f64, fill_rule: FillRule) -> Vec<OccupiedInterval> {
    // Collect all x-intersections with their crossing direction (winding).
    let scanline = Line::new((-1e6, y), (1e6, y));

    let mut crossings: Vec<(f64, i32)> = Vec::new();

    for seg in segments {
        let intersections = seg.intersect_line(scanline);
        for isect in intersections {
            let t = isect.segment_t;
            if !(-1e-9..=1.0 + 1e-9).contains(&t) {
                continue;
            }
            let pt = seg.eval(t);

            // Determine crossing direction by evaluating y-tangent.
            let direction = crossing_direction(seg, t);
            crossings.push((pt.x, direction));
        }
    }

    crossings.sort_by(|a, b| a.0.total_cmp(&b.0));

    // Apply fill rule to determine occupied intervals.
    match fill_rule {
        FillRule::Nonzero => intervals_nonzero(&crossings),
        FillRule::Evenodd => intervals_evenodd(&crossings),
    }
}

/// Determine crossing direction (+1 = upward, -1 = downward) at parameter t.
fn crossing_direction(seg: &PathSeg, t: f64) -> i32 {
    let dt = 1e-6;
    let before = seg.eval((t - dt).clamp(0.0, 1.0));
    let after = seg.eval((t + dt).clamp(0.0, 1.0));
    if after.y > before.y { 1 } else { -1 }
}

/// Nonzero winding rule: region is filled when winding number != 0.
fn intervals_nonzero(crossings: &[(f64, i32)]) -> Vec<OccupiedInterval> {
    let mut intervals = Vec::new();
    let mut winding: i32 = 0;
    let mut enter_x = 0.0;

    for &(x, dir) in crossings {
        let was_inside = winding != 0;
        winding += dir;
        let is_inside = winding != 0;

        if !was_inside && is_inside {
            enter_x = x;
        } else if was_inside && !is_inside {
            intervals.push(OccupiedInterval {
                left: enter_x,
                right: x,
            });
        }
    }

    intervals
}

/// Even-odd fill rule: region is filled when crossing count is odd.
fn intervals_evenodd(crossings: &[(f64, i32)]) -> Vec<OccupiedInterval> {
    let mut intervals = Vec::new();
    let mut inside = false;
    let mut enter_x = 0.0;

    for &(x, _) in crossings {
        if inside {
            intervals.push(OccupiedInterval {
                left: enter_x,
                right: x,
            });
            inside = false;
        } else {
            enter_x = x;
            inside = true;
        }
    }

    intervals
}

// ---------------------------------------------------------------------------
// Interval merging and subtraction
// ---------------------------------------------------------------------------

/// Sort and merge overlapping or adjacent occupied intervals.
fn merge_intervals(intervals: &mut Vec<OccupiedInterval>) {
    if intervals.is_empty() {
        return;
    }

    intervals.sort_by(|a, b| a.left.total_cmp(&b.left));

    let mut merged = Vec::with_capacity(intervals.len());
    let mut current = intervals[0];

    for iv in &intervals[1..] {
        if iv.left <= current.right {
            current.right = current.right.max(iv.right);
        } else {
            merged.push(current);
            current = *iv;
        }
    }
    merged.push(current);

    *intervals = merged;
}

/// Subtract occupied intervals from `[flow_left, flow_right]`, returning free regions.
fn subtract_from_range(
    flow_left: f64,
    flow_right: f64,
    occupied: &[OccupiedInterval],
    min_width: f64,
) -> Vec<FreeRegion> {
    let mut regions = Vec::new();
    let mut cursor = flow_left;

    for iv in occupied {
        let clipped_left = iv.left.max(flow_left);
        let clipped_right = iv.right.min(flow_right);

        // Obstacle lies entirely outside the flow range — skip it.
        if clipped_right <= clipped_left {
            continue;
        }

        if clipped_left > cursor {
            let w = clipped_left - cursor;
            if w >= min_width {
                regions.push(FreeRegion {
                    x: cursor,
                    width: w,
                });
            }
        }
        cursor = cursor.max(clipped_right);
    }

    if flow_right > cursor {
        let w = flow_right - cursor;
        if w >= min_width {
            regions.push(FreeRegion {
                x: cursor,
                width: w,
            });
        }
    }

    regions
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn flow_box(x: f64, y: f64, w: f64, h: f64) -> FlowBox {
        FlowBox {
            x,
            y,
            width: w,
            height: h,
        }
    }

    // -- Rect tests --

    #[test]
    fn rect_no_overlap() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        let excl = vec![FlowExclusionShape::Rect {
            x: 300.0,
            y: 100.0,
            width: 80.0,
            height: 50.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }];
        // Band at y=0..20, rect at y=100..150 → no overlap
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 1.0);
        assert_eq!(regions.len(), 1);
        assert!((regions[0].x - 0.0).abs() < 1e-9);
        assert!((regions[0].width - 400.0).abs() < 1e-9);
    }

    #[test]
    fn rect_partial_overlap() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        let excl = vec![FlowExclusionShape::Rect {
            x: 300.0,
            y: 0.0,
            width: 80.0,
            height: 50.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }];
        // Band at y=0..20 overlaps rect at y=0..50
        // Occupied [300, 380], free [0,300] and [380,400]
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 1.0);
        assert_eq!(regions.len(), 2);
        assert!((regions[0].x - 0.0).abs() < 1e-9);
        assert!((regions[0].width - 300.0).abs() < 1e-9);
        assert!((regions[1].x - 380.0).abs() < 1e-9);
        assert!((regions[1].width - 20.0).abs() < 1e-9);
    }

    #[test]
    fn rect_full_width() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        let excl = vec![FlowExclusionShape::Rect {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 50.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }];
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 1.0);
        assert!(regions.is_empty());
    }

    // -- Circle tests --

    #[test]
    fn circle_center_in_band() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        let excl = vec![FlowExclusionShape::Circle {
            cx: 50.0,
            cy: 10.0,
            r: 30.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }];
        // Band y=0..20, center at cy=10 (in band) → dx = r = 30
        // Occupied [20, 80], free [0,20] and [80,400]
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 1.0);
        assert_eq!(regions.len(), 2);
        assert!((regions[0].x - 0.0).abs() < 1e-9);
        assert!((regions[0].width - 20.0).abs() < 1e-9);
        assert!((regions[1].x - 80.0).abs() < 1e-9);
        assert!((regions[1].width - 320.0).abs() < 1e-9);
    }

    #[test]
    fn circle_edge_clip() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        let excl = vec![FlowExclusionShape::Circle {
            cx: 200.0,
            cy: 35.0,
            r: 20.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }];
        // Band y=0..20, circle center at cy=35, r=20
        // y_closest = clamp(35, 0, 20) = 20, dy = 15
        // dx = sqrt(400 - 225) = sqrt(175) ≈ 13.23
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 1.0);
        assert_eq!(regions.len(), 2);
        let expected_dx = (20.0_f64.powi(2) - 15.0_f64.powi(2)).sqrt();
        assert!((regions[0].width - (200.0 - expected_dx)).abs() < 1e-6);
    }

    #[test]
    fn circle_no_overlap() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        let excl = vec![FlowExclusionShape::Circle {
            cx: 200.0,
            cy: 100.0,
            r: 20.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }];
        // Band y=0..20, circle at cy=100, r=20 → no overlap
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 1.0);
        assert_eq!(regions.len(), 1);
        assert!((regions[0].width - 400.0).abs() < 1e-9);
    }

    // -- Overlap merge --

    #[test]
    fn overlapping_exclusions_merge() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        let excl = vec![
            FlowExclusionShape::Rect {
                x: 100.0,
                y: 0.0,
                width: 60.0,
                height: 50.0,
                margin_px: FlowExclusionMargin::All(0.0),
            },
            FlowExclusionShape::Rect {
                x: 140.0,
                y: 0.0,
                width: 60.0,
                height: 50.0,
                margin_px: FlowExclusionMargin::All(0.0),
            },
        ];
        // Rects overlap: [100,160] and [140,200] → merged [100,200]
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 1.0);
        assert_eq!(regions.len(), 2);
        assert!((regions[0].x - 0.0).abs() < 1e-9);
        assert!((regions[0].width - 100.0).abs() < 1e-9);
        assert!((regions[1].x - 200.0).abs() < 1e-9);
        assert!((regions[1].width - 200.0).abs() < 1e-9);
    }

    // -- Margin --

    #[test]
    fn margin_expansion() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        let excl = vec![FlowExclusionShape::Rect {
            x: 150.0,
            y: 5.0,
            width: 100.0,
            height: 40.0,
            margin_px: FlowExclusionMargin::All(10.0),
        }];
        // With margin 10: occupied = [140, 260], band expanded by 10 in both directions
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 1.0);
        assert_eq!(regions.len(), 2);
        assert!((regions[0].width - 140.0).abs() < 1e-9);
        assert!((regions[1].x - 260.0).abs() < 1e-9);
    }

    #[test]
    fn rect_edge_margin_expansion_horizontal() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        let excl = vec![FlowExclusionShape::Rect {
            x: 150.0,
            y: 50.0,
            width: 100.0,
            height: 40.0,
            margin_px: FlowExclusionMargin::Edges(FlowExclusionMarginEdges {
                top: 15.0,
                right: 20.0,
                bottom: 5.0,
                left: 10.0,
            }),
        }];

        let regions = compute_line_regions(&fb, &excl, 40.0, 50.0, 1.0);
        assert_eq!(regions.len(), 2);
        assert!((regions[0].x - 0.0).abs() < 1e-9);
        assert!((regions[0].width - 140.0).abs() < 1e-9);
        assert!((regions[1].x - 270.0).abs() < 1e-9);
        assert!((regions[1].width - 130.0).abs() < 1e-9);
    }

    #[test]
    fn rect_edge_margin_top_and_bottom_affect_band_overlap() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        let excl = vec![FlowExclusionShape::Rect {
            x: 100.0,
            y: 50.0,
            width: 100.0,
            height: 40.0,
            margin_px: FlowExclusionMargin::Edges(FlowExclusionMarginEdges {
                top: 15.0,
                right: 0.0,
                bottom: 12.0,
                left: 0.0,
            }),
        }];

        let top_regions = compute_line_regions(&fb, &excl, 40.0, 45.0, 1.0);
        assert_eq!(top_regions.len(), 2);
        assert!((top_regions[0].width - 100.0).abs() < 1e-9);

        let bottom_regions = compute_line_regions(&fb, &excl, 95.0, 100.0, 1.0);
        assert_eq!(bottom_regions.len(), 2);
        assert!((bottom_regions[1].x - 200.0).abs() < 1e-9);

        let outside_regions = compute_line_regions(&fb, &excl, 102.0, 110.0, 1.0);
        assert_eq!(outside_regions.len(), 1);
        assert!((outside_regions[0].width - 400.0).abs() < 1e-9);
    }

    #[test]
    fn rect_edge_margin_expansion_vertical() {
        let fb = flow_box(0.0, 0.0, 200.0, 300.0);
        let excl = vec![FlowExclusionShape::Rect {
            x: 70.0,
            y: 80.0,
            width: 40.0,
            height: 60.0,
            margin_px: FlowExclusionMargin::Edges(FlowExclusionMarginEdges {
                top: 10.0,
                right: 25.0,
                bottom: 20.0,
                left: 15.0,
            }),
        }];

        let outside = compute_column_regions(&fb, &excl, 30.0, 50.0, 1.0);
        assert_eq!(outside.len(), 1);
        assert!((outside[0].height - 300.0).abs() < 1e-9);

        let regions = compute_column_regions(&fb, &excl, 50.0, 56.0, 1.0);
        assert_eq!(regions.len(), 2);
        assert!((regions[0].y - 0.0).abs() < 1e-9);
        assert!((regions[0].height - 70.0).abs() < 1e-9);
        assert!((regions[1].y - 160.0).abs() < 1e-9);
        assert!((regions[1].height - 140.0).abs() < 1e-9);
    }

    #[test]
    fn circle_edge_margin_expansion_horizontal() {
        let fb = flow_box(0.0, 0.0, 300.0, 200.0);
        let excl = vec![FlowExclusionShape::Circle {
            cx: 100.0,
            cy: 50.0,
            r: 20.0,
            margin_px: FlowExclusionMargin::Edges(FlowExclusionMarginEdges {
                top: 10.0,
                right: 15.0,
                bottom: 0.0,
                left: 5.0,
            }),
        }];

        let regions = compute_line_regions(&fb, &excl, 40.0, 60.0, 1.0);
        assert_eq!(regions.len(), 2);
        assert!((regions[0].width - 75.0).abs() < 1e-9);
        assert!((regions[1].x - 135.0).abs() < 1e-9);
    }

    #[test]
    fn circle_edge_margin_top_affects_above_band() {
        let fb = flow_box(0.0, 0.0, 300.0, 200.0);
        let excl = vec![FlowExclusionShape::Circle {
            cx: 100.0,
            cy: 50.0,
            r: 20.0,
            margin_px: FlowExclusionMargin::Edges(FlowExclusionMarginEdges {
                top: 10.0,
                right: 0.0,
                bottom: 0.0,
                left: 0.0,
            }),
        }];

        let regions = compute_line_regions(&fb, &excl, 20.0, 25.0, 1.0);
        assert_eq!(regions.len(), 2);
    }

    #[test]
    fn circle_edge_margin_bottom_affects_below_band() {
        let fb = flow_box(0.0, 0.0, 300.0, 200.0);
        let excl = vec![FlowExclusionShape::Circle {
            cx: 100.0,
            cy: 50.0,
            r: 20.0,
            margin_px: FlowExclusionMargin::Edges(FlowExclusionMarginEdges {
                top: 0.0,
                right: 0.0,
                bottom: 10.0,
                left: 0.0,
            }),
        }];

        let regions = compute_line_regions(&fb, &excl, 75.0, 80.0, 1.0);
        assert_eq!(regions.len(), 2);
    }

    #[test]
    fn circle_edge_margin_left_affects_left_column() {
        let fb = flow_box(0.0, 0.0, 300.0, 200.0);
        let excl = vec![FlowExclusionShape::Circle {
            cx: 100.0,
            cy: 50.0,
            r: 20.0,
            margin_px: FlowExclusionMargin::Edges(FlowExclusionMarginEdges {
                top: 0.0,
                right: 0.0,
                bottom: 0.0,
                left: 10.0,
            }),
        }];

        let regions = compute_column_regions(&fb, &excl, 75.0, 78.0, 1.0);
        assert_eq!(regions.len(), 2);
    }

    #[test]
    fn path_edge_margin_expansion_horizontal() {
        let fb = flow_box(0.0, 0.0, 300.0, 200.0);
        let excl = vec![FlowExclusionShape::Path {
            d: "M 100 0 L 150 0 L 150 50 L 100 50 Z".to_string(),
            x: 0.0,
            y: 0.0,
            fill_rule: FillRule::Nonzero,
            margin_px: FlowExclusionMargin::Edges(FlowExclusionMarginEdges {
                top: 0.0,
                right: 20.0,
                bottom: 0.0,
                left: 10.0,
            }),
        }];

        let regions = compute_line_regions(&fb, &excl, 10.0, 20.0, 1.0);
        assert_eq!(regions.len(), 2);
        assert!((regions[0].width - 90.0).abs() < 1e-9);
        assert!((regions[1].x - 170.0).abs() < 1e-9);
    }

    #[test]
    fn path_edge_margin_top_affects_above_band() {
        let fb = flow_box(0.0, 0.0, 300.0, 200.0);
        let excl = vec![FlowExclusionShape::Path {
            d: "M 100 50 L 150 50 L 150 100 L 100 100 Z".to_string(),
            x: 0.0,
            y: 0.0,
            fill_rule: FillRule::Nonzero,
            margin_px: FlowExclusionMargin::Edges(FlowExclusionMarginEdges {
                top: 10.0,
                right: 0.0,
                bottom: 0.0,
                left: 0.0,
            }),
        }];

        let regions = compute_line_regions(&fb, &excl, 42.0, 45.0, 1.0);
        assert_eq!(regions.len(), 2);
    }

    #[test]
    fn path_edge_margin_expansion_vertical_uses_bbox() {
        let fb = flow_box(0.0, 0.0, 300.0, 200.0);
        let excl = vec![FlowExclusionShape::Path {
            d: "M 100 0 L 150 0 L 150 50 L 100 50 Z".to_string(),
            x: 0.0,
            y: 0.0,
            fill_rule: FillRule::Nonzero,
            margin_px: FlowExclusionMargin::Edges(FlowExclusionMarginEdges {
                top: 5.0,
                right: 0.0,
                bottom: 7.0,
                left: 10.0,
            }),
        }];

        let regions = compute_column_regions(&fb, &excl, 80.0, 95.0, 1.0);
        assert_eq!(regions.len(), 1);
        assert!((regions[0].y - 57.0).abs() < 1e-9);
        assert!((regions[0].height - 143.0).abs() < 1e-9);
    }

    #[test]
    fn margin_px_deserializes_scalar_and_edges() {
        let scalar: FlowExclusionShape = serde_json::from_str(
            r#"{"kind":"rect","x":0,"y":0,"width":10,"height":10,"marginPx":8}"#,
        )
        .unwrap();
        let FlowExclusionShape::Rect { margin_px, .. } = scalar else {
            panic!("expected rect");
        };
        let scalar_insets = margin_px.to_insets();
        assert!((scalar_insets.left - 8.0).abs() < 1e-9);
        assert!((scalar_insets.right - 8.0).abs() < 1e-9);

        let edges: FlowExclusionShape = serde_json::from_str(
            r#"{"kind":"rect","x":0,"y":0,"width":10,"height":10,"marginPx":{"right":12,"bottom":6}}"#,
        )
        .unwrap();
        let FlowExclusionShape::Rect { margin_px, .. } = edges else {
            panic!("expected rect");
        };
        let edge_insets = margin_px.to_insets();
        assert!((edge_insets.top - 0.0).abs() < 1e-9);
        assert!((edge_insets.right - 12.0).abs() < 1e-9);
        assert!((edge_insets.bottom - 6.0).abs() < 1e-9);
        assert!((edge_insets.left - 0.0).abs() < 1e-9);

        let path: FlowExclusionShape = serde_json::from_str(
            r#"{"kind":"path","d":"M0 0 L10 0 L10 10 Z","fillRule":"evenodd","marginPx":{"left":3}}"#,
        )
        .unwrap();
        let FlowExclusionShape::Path {
            fill_rule,
            margin_px,
            ..
        } = path
        else {
            panic!("expected path");
        };
        assert_eq!(fill_rule, FillRule::Evenodd);
        assert!((margin_px.to_insets().left - 3.0).abs() < 1e-9);
    }

    // -- min_region_width filter --

    #[test]
    fn min_region_width_filter() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        let excl = vec![
            FlowExclusionShape::Rect {
                x: 10.0,
                y: 0.0,
                width: 100.0,
                height: 50.0,
                margin_px: FlowExclusionMargin::All(0.0),
            },
            FlowExclusionShape::Rect {
                x: 300.0,
                y: 0.0,
                width: 100.0,
                height: 50.0,
                margin_px: FlowExclusionMargin::All(0.0),
            },
        ];
        // Free: [0,10] (w=10), [110,300] (w=190)
        // With min_region_width=20, the [0,10] gap is filtered out
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 20.0);
        assert_eq!(regions.len(), 1);
        assert!((regions[0].x - 110.0).abs() < 1e-9);
        assert!((regions[0].width - 190.0).abs() < 1e-9);
    }

    // -- Path tests --

    #[test]
    fn path_triangle() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        // Triangle: (200,0) → (250,100) → (150,100) → close
        let excl = vec![FlowExclusionShape::Path {
            d: "M 200 0 L 250 100 L 150 100 Z".to_string(),
            x: 0.0,
            y: 0.0,
            fill_rule: FillRule::Nonzero,
            margin_px: FlowExclusionMargin::All(0.0),
        }];
        // Band y=40..60, mid=50: at y=50 the triangle spans from ~175 to ~225
        let regions = compute_line_regions(&fb, &excl, 40.0, 60.0, 1.0);
        assert_eq!(regions.len(), 2);
        // Left region should end around 175, right should start around 225
        assert!(regions[0].x + regions[0].width < 200.0);
        assert!(regions[1].x > 200.0);
    }

    #[test]
    fn path_with_offset() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        // Triangle at origin, translated by (100, 0)
        let excl = vec![FlowExclusionShape::Path {
            d: "M 100 0 L 150 100 L 50 100 Z".to_string(),
            x: 100.0,
            y: 0.0,
            fill_rule: FillRule::Nonzero,
            margin_px: FlowExclusionMargin::All(0.0),
        }];
        // Same triangle but shifted right by 100
        let regions = compute_line_regions(&fb, &excl, 40.0, 60.0, 1.0);
        assert_eq!(regions.len(), 2);
        // Center of triangle is now at x=200+100=300? No, the d already has coords.
        // d="M 100 0 L 150 100 L 50 100 Z" + offset(100, 0)
        // = M 200 0, L 250 100, L 150 100, Z
        // Same as previous test
        assert!(regions[0].x + regions[0].width < 200.0);
        assert!(regions[1].x > 200.0);
    }

    #[test]
    fn path_star_evenodd_vs_nonzero() {
        let fb = flow_box(0.0, 0.0, 400.0, 300.0);
        // 5-pointed star as a self-intersecting polygon.
        // Connect every other vertex of a regular pentagon → creates a center hole under evenodd.
        let star_d = "M 200 40 L 248 150 L 160 90 L 240 90 L 152 150 Z";

        let excl_eo = vec![FlowExclusionShape::Path {
            d: star_d.to_string(),
            x: 0.0,
            y: 0.0,
            fill_rule: FillRule::Evenodd,
            margin_px: FlowExclusionMargin::All(0.0),
        }];
        let excl_nz = vec![FlowExclusionShape::Path {
            d: star_d.to_string(),
            x: 0.0,
            y: 0.0,
            fill_rule: FillRule::Nonzero,
            margin_px: FlowExclusionMargin::All(0.0),
        }];

        // Band through the middle of the star
        let regions_eo = compute_line_regions(&fb, &excl_eo, 100.0, 120.0, 1.0);
        let regions_nz = compute_line_regions(&fb, &excl_nz, 100.0, 120.0, 1.0);

        // Evenodd should produce more free regions than nonzero (center hole becomes free)
        assert!(
            regions_eo.len() >= regions_nz.len(),
            "Evenodd should have >= free regions than nonzero: eo={}, nz={}",
            regions_eo.len(),
            regions_nz.len()
        );
    }

    #[test]
    fn band_edge_clip() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        // Circle that only clips the bottom edge of the band
        let excl = vec![FlowExclusionShape::Circle {
            cx: 200.0,
            cy: 25.0,
            r: 10.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }];
        // Band y=0..20, circle at cy=25, r=10 → bottom of circle at y=15 clips band
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 1.0);
        // Should detect the intersection
        assert_eq!(regions.len(), 2);
    }

    // -- Obstacle outside flow box --

    #[test]
    fn rect_entirely_right_of_flow_box() {
        let fb = flow_box(16.0, 0.0, 372.0, 200.0);
        // Obstacle placed far to the right, entirely outside the flow box
        let excl = vec![FlowExclusionShape::Rect {
            x: 400.0,
            y: 0.0,
            width: 130.0,
            height: 70.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }];
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 1.0);
        // Should return the full flow box width, ignoring the out-of-range obstacle
        assert_eq!(regions.len(), 1);
        assert!((regions[0].x - 16.0).abs() < 1e-9);
        assert!((regions[0].width - 372.0).abs() < 1e-9);
    }

    #[test]
    fn rect_entirely_left_of_flow_box() {
        let fb = flow_box(100.0, 0.0, 300.0, 200.0);
        let excl = vec![FlowExclusionShape::Rect {
            x: 0.0,
            y: 0.0,
            width: 50.0,
            height: 50.0,
            margin_px: FlowExclusionMargin::All(0.0),
        }];
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 1.0);
        assert_eq!(regions.len(), 1);
        assert!((regions[0].x - 100.0).abs() < 1e-9);
        assert!((regions[0].width - 300.0).abs() < 1e-9);
    }

    #[test]
    fn rect_right_of_flow_box_with_margin() {
        let fb = flow_box(16.0, 0.0, 372.0, 200.0);
        // Obstacle just outside, but margin makes it partially overlap
        let excl = vec![FlowExclusionShape::Rect {
            x: 392.0,
            y: 0.0,
            width: 80.0,
            height: 50.0,
            margin_px: FlowExclusionMargin::All(8.0),
        }];
        // With margin: occupied [384, 480]. flow_right = 388.
        // clipped_left = max(384, 16) = 384, clipped_right = min(480, 388) = 388
        // 388 > 384 → intersects. Free region: [16, 384] width=368
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 1.0);
        assert_eq!(regions.len(), 1);
        assert!((regions[0].x - 16.0).abs() < 1e-9);
        assert!((regions[0].width - 368.0).abs() < 1e-9);
    }

    // -- NaN robustness --
    // NaN coordinates previously panicked in the interval/scanline sorts
    // (`partial_cmp(...).unwrap()`); `total_cmp` must keep them panic-free.

    #[test]
    fn rect_with_nan_x_does_not_panic() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        // Two overlapping-band rects so merge_intervals actually compares a NaN key.
        let excl = vec![
            FlowExclusionShape::Rect {
                x: f64::NAN,
                y: 0.0,
                width: 50.0,
                height: 50.0,
                margin_px: FlowExclusionMargin::All(0.0),
            },
            FlowExclusionShape::Rect {
                x: 100.0,
                y: 0.0,
                width: 50.0,
                height: 50.0,
                margin_px: FlowExclusionMargin::All(0.0),
            },
        ];
        let regions = compute_line_regions(&fb, &excl, 0.0, 20.0, 1.0);
        for region in &regions {
            assert!(region.width >= 1.0);
        }
    }

    #[test]
    fn path_with_nan_band_does_not_panic() {
        let fb = flow_box(0.0, 0.0, 400.0, 200.0);
        let excl = vec![FlowExclusionShape::Path {
            d: "M 50 0 L 150 0 L 150 100 L 50 100 Z".to_string(),
            x: 0.0,
            y: 0.0,
            fill_rule: FillRule::Nonzero,
            margin_px: FlowExclusionMargin::All(0.0),
        }];
        // NaN band bounds propagate into the scanline y-values before sorting.
        let regions = compute_line_regions(&fb, &excl, f64::NAN, f64::NAN, 1.0);
        for region in &regions {
            assert!(region.width >= 1.0);
        }
    }
}
