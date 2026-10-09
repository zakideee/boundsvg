//! Conservative general Path bounds without topology normalization or stroke loss.

use serde::Serialize;

use super::path_tokens::{PathToken, PathTokens};
use super::{
    ArcToken, CurveSegment, Point2D, ShapeError, add_points, is_command_token, read_number_token,
    read_point_token, reflect_control, try_read_arc_token,
};

/// Outward ULP reserve for the short endpoint/rotation/ratio/hypot enclosure calculation.
const ARC_BOUNDS_ROUNDING_ULPS: u32 = 8;

/// One radius to reach the start plus at most sqrt(2) radii for the control
/// hull of the existing at-most-quarter-arc cubic representation.
const ARC_PAINT_ENCLOSURE_FACTOR: f64 = 3.0;

/// Finite geometry extrema in the authored Path coordinate system.
///
/// Extrema avoid overflowing a width subtraction for widely separated finite points.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathBounds {
    /// Leftmost conservative geometry coordinate.
    pub min_x: f64,
    /// Topmost conservative geometry coordinate.
    pub min_y: f64,
    /// Rightmost conservative geometry coordinate.
    pub max_x: f64,
    /// Bottommost conservative geometry coordinate.
    pub max_y: f64,
}

/// Authored and native-paint enclosures with an explicit authored failure offset.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PathBoundsParse {
    /// No drawable segment means no geometry; zero-length drawn segments have point bounds.
    pub bounds: Option<PathBounds>,
    /// None means complete authored consumption, including empty or move-only
    /// input. Native paint may continue beyond an authored numeric failure.
    pub error_offset: Option<usize>,
}

impl PathBounds {
    /// Enclose finite control points; Bézier paint lies inside their convex hull.
    ///
    /// # Errors
    ///
    /// Returns `InvalidPathData` for no points or a non-finite projected point.
    fn from_points(points: &[Point2D]) -> Result<Self, ShapeError> {
        let first = points.first().ok_or(ShapeError::InvalidPathData)?;
        let mut bounds = Self {
            min_x: first.x,
            min_y: first.y,
            max_x: first.x,
            max_y: first.y,
        };
        for point in points {
            if !point.x.is_finite() || !point.y.is_finite() {
                return Err(ShapeError::InvalidPathData);
            }
            bounds.min_x = bounds.min_x.min(point.x);
            bounds.min_y = bounds.min_y.min(point.y);
            bounds.max_x = bounds.max_x.max(point.x);
            bounds.max_y = bounds.max_y.max(point.y);
        }
        Ok(bounds)
    }

    /// Accumulate completed segments without applying the topology parser's epsilon.
    fn include(&mut self, bounds: Self) {
        self.min_x = self.min_x.min(bounds.min_x);
        self.min_y = self.min_y.min(bounds.min_y);
        self.max_x = self.max_x.max(bounds.max_x);
        self.max_y = self.max_y.max(bounds.max_y);
    }
}

/// One complete Bézier group shared with the strict run readers.
pub(super) struct CurveGroup {
    /// Completed control polygon in the selected scalar representation.
    pub(super) segment: CurveSegment,
    /// First unconsumed token after this complete argument group.
    pub(super) next_index: usize,
}

/// Scalar projection for authored geometry and a conservative native-paint view.
#[derive(Clone, Copy)]
pub(super) enum ScalarProjection {
    /// Preserve authored finite doubles and strict Shape behavior.
    Authored,
    /// Include float-coordinate native paint without rewriting source data.
    Paint,
}

impl ScalarProjection {
    /// Project a parsed coordinate into the observed finite native float range.
    /// This output-only view includes Firefox's finite parse limit and both
    /// browsers' subnormal underflow. It is not an authored-input correction.
    fn input(self, scalar: f64) -> f64 {
        match self {
            Self::Authored => scalar,
            Self::Paint => {
                let limit = f64::from(f32::MAX);
                let finite = if scalar > limit {
                    limit
                } else if scalar < -limit {
                    -limit
                } else {
                    scalar
                };
                project_native_float(finite)
            }
        }
    }

    /// Match float arithmetic after input parsing. Overflow remains non-finite
    /// and terminates this projection instead of being silently saturated.
    fn arithmetic(self, scalar: f64) -> f64 {
        match self {
            Self::Authored => scalar,
            Self::Paint => project_native_float(scalar),
        }
    }

    /// Project incoming coordinate pairs before relative arithmetic.
    fn point(self, point: Point2D) -> Point2D {
        Point2D {
            x: self.input(point.x),
            y: self.input(point.y),
        }
    }

    /// Round the result of relative/reflected coordinate arithmetic.
    fn result_point(self, point: Point2D) -> Point2D {
        Point2D {
            x: self.arithmetic(point.x),
            y: self.arithmetic(point.y),
        }
    }
}

/// Round into the native SVG float representation for output-only enclosure.
/// Precision loss is the behavior being enclosed; this never rewrites authored data.
#[expect(
    clippy::cast_possible_truncation,
    reason = "output enclosure must reproduce native SVG float rounding without rewriting input"
)]
fn project_native_float(scalar: f64) -> f64 {
    f64::from(scalar as f32)
}

/// Read one complete curve group so bounds callers retain earlier valid groups.
///
/// # Errors
///
/// Returns `ShapeError` for incomplete/invalid arguments or a non-curve command.
pub(super) fn read_curve_group<T: AsRef<str>>(
    command: char,
    tokens: &[T],
    index: usize,
    is_relative: bool,
    current: Point2D,
    previous_control: Option<Point2D>,
) -> Result<CurveGroup, ShapeError> {
    read_projected_curve_group(
        command,
        tokens,
        index,
        is_relative,
        current,
        previous_control,
        ScalarProjection::Authored,
    )
}

/// Read one shared curve group in the selected scalar representation.
///
/// # Errors
///
/// Returns the strict reader's argument/command errors. Non-finite projected
/// coordinates remain explicit for the bounds accumulator to reject.
fn read_projected_curve_group<T: AsRef<str>>(
    command: char,
    tokens: &[T],
    index: usize,
    is_relative: bool,
    current: Point2D,
    previous_control: Option<Point2D>,
    projection: ScalarProjection,
) -> Result<CurveGroup, ShapeError> {
    let point = |position| -> Result<(Point2D, usize), ShapeError> {
        let (authored, next) = read_point_token(tokens, position)?;
        let authored = projection.point(authored);
        Ok((
            if is_relative {
                projection.result_point(add_points(current, authored))
            } else {
                authored
            },
            next,
        ))
    };
    let (segment, next_index) = match command {
        'C' => {
            let (control1, next) = point(index)?;
            let (control2, next) = point(next)?;
            let (end, next) = point(next)?;
            (
                CurveSegment::Cubic {
                    p0: current,
                    p1: control1,
                    p2: control2,
                    p3: end,
                },
                next,
            )
        }
        'S' => {
            let (control2, next) = point(index)?;
            let (end, next) = point(next)?;
            (
                CurveSegment::Cubic {
                    p0: current,
                    p1: projection.result_point(reflect_control(current, previous_control)),
                    p2: control2,
                    p3: end,
                },
                next,
            )
        }
        'Q' => {
            let (control, next) = point(index)?;
            let (end, next) = point(next)?;
            (
                CurveSegment::Quad {
                    p0: current,
                    p1: control,
                    p2: end,
                },
                next,
            )
        }
        'T' => {
            let (end, next) = point(index)?;
            (
                CurveSegment::Quad {
                    p0: current,
                    p1: projection.result_point(reflect_control(current, previous_control)),
                    p2: end,
                },
                next,
            )
        }
        other => return Err(ShapeError::UnsupportedPathCommand(other)),
    };
    Ok(CurveGroup {
        segment,
        next_index,
    })
}

/// State for one argument group; errors do not discard previously enclosed geometry.
struct BoundsReader<'a> {
    tokens: &'a [PathToken<'a>],
    projection: ScalarProjection,
    index: usize,
    current: Point2D,
    start: Option<Point2D>,
    cubic_control: Option<Point2D>,
    quad_control: Option<Point2D>,
    bounds: Option<PathBounds>,
}

impl BoundsReader<'_> {
    /// Union finite bounds only after a complete drawable segment was read.
    fn include(&mut self, bounds: PathBounds) {
        if let Some(accumulated) = self.bounds.as_mut() {
            accumulated.include(bounds);
        } else {
            self.bounds = Some(bounds);
        }
    }

    /// Read a horizontal/vertical segment without changing the other axis.
    ///
    /// # Errors
    ///
    /// Returns the numeric reader's error or a non-finite projected endpoint.
    fn axis_group(&mut self, upper: char, is_relative: bool) -> Result<(), ShapeError> {
        let (coordinate, next) = read_number_token(self.tokens, self.index)?;
        let coordinate = self.projection.input(coordinate);
        let end = if upper == 'H' {
            Point2D {
                x: if is_relative {
                    self.projection.arithmetic(self.current.x + coordinate)
                } else {
                    coordinate
                },
                y: self.current.y,
            }
        } else {
            Point2D {
                x: self.current.x,
                y: if is_relative {
                    self.projection.arithmetic(self.current.y + coordinate)
                } else {
                    coordinate
                },
            }
        };
        self.include(PathBounds::from_points(&[self.current, end])?);
        self.current = end;
        self.index = next;
        Ok(())
    }

    /// Read one command group, retaining raw tiny/zero geometry for cap paint.
    ///
    /// # Errors
    ///
    /// Returns the first incomplete, unsupported, or non-finite projected segment.
    fn group(&mut self, command: char) -> Result<(), ShapeError> {
        let is_relative = command.is_ascii_lowercase();
        let upper = command.to_ascii_uppercase();
        if !matches!(upper, 'C' | 'S') {
            self.cubic_control = None;
        }
        if !matches!(upper, 'Q' | 'T') {
            self.quad_control = None;
        }
        match upper {
            'M' | 'L' => {
                let (point, next) = read_point_token(self.tokens, self.index)?;
                let point = self.projection.point(point);
                let end = if is_relative {
                    self.projection
                        .result_point(add_points(self.current, point))
                } else {
                    point
                };
                let bounds = PathBounds::from_points(&[self.current, end])?;
                if upper == 'M' {
                    self.start = Some(end);
                } else {
                    self.include(bounds);
                }
                self.current = end;
                self.index = next;
            }
            'H' | 'V' => self.axis_group(upper, is_relative)?,
            'C' | 'S' | 'Q' | 'T' => {
                let previous = if matches!(upper, 'C' | 'S') {
                    self.cubic_control
                } else {
                    self.quad_control
                };
                let group = read_projected_curve_group(
                    upper,
                    self.tokens,
                    self.index,
                    is_relative,
                    self.current,
                    previous,
                    self.projection,
                )?;
                let bounds = match group.segment {
                    CurveSegment::Cubic { p0, p1, p2, p3 } => {
                        let bounds = PathBounds::from_points(&[p0, p1, p2, p3])?;
                        self.cubic_control = Some(p2);
                        self.current = p3;
                        bounds
                    }
                    CurveSegment::Quad { p0, p1, p2 } => {
                        let bounds = PathBounds::from_points(&[p0, p1, p2])?;
                        self.quad_control = Some(p1);
                        self.current = p2;
                        bounds
                    }
                    CurveSegment::Line { .. } => return Err(ShapeError::InvalidPathData),
                };
                self.include(bounds);
                self.index = group.next_index;
            }
            'A' => {
                let (arc, next) = try_read_arc_token(self.tokens, self.index)
                    .ok_or(ShapeError::InvalidPathData)?;
                let end = if is_relative {
                    self.projection
                        .result_point(add_points(self.current, self.projection.point(arc.end)))
                } else {
                    self.projection.point(arc.end)
                };
                PathBounds::from_points(&[self.current, end])?;
                if self.current == end {
                    // Native SVG paints round/square caps for a zero-length arc segment.
                    self.include(PathBounds::from_points(&[self.current])?);
                } else {
                    self.include(match self.projection {
                        ScalarProjection::Authored => arc_bounds(self.current, end, &arc)?,
                        ScalarProjection::Paint => paint_arc_bounds(self.current, end, &arc)?,
                    });
                }
                self.current = end;
                self.index = next;
            }
            'Z' => {
                let start = self.start.ok_or(ShapeError::InvalidPathData)?;
                self.include(PathBounds::from_points(&[self.current, start])?);
                self.current = start;
            }
            other => return Err(ShapeError::UnsupportedPathCommand(other)),
        }
        Ok(())
    }
}

/// Advance a nonnegative finite extent by the documented rounding reserve.
/// An overflow remains non-finite for the enclosing bounds validation to report.
/// Positive IEEE-754 bit ordering supplies next-up behavior on the supported MSRV.
fn outward_arc_extent(mut extent: f64) -> f64 {
    for _ in 0..ARC_BOUNDS_ROUNDING_ULPS {
        if !extent.is_finite() {
            return extent;
        }
        extent = f64::from_bits(extent.to_bits() + 1);
    }
    extent
}

/// Enclose the original ellipse without relying on approximate cubic ink bounds.
///
/// After SVG radius correction, every ellipse point is within the larger radius
/// of its center, as is its start. Their distance is therefore at most twice
/// that radius. This deliberately loose bound avoids cancellation in center
/// calculations for almost straight, very large-radius arcs.
///
/// # Errors
///
/// Returns `InvalidPathData` if required projected extrema cannot remain finite.
fn arc_bounds(start: Point2D, end: Point2D, arc: &ArcToken) -> Result<PathBounds, ShapeError> {
    let rx = arc.rx.abs();
    let ry = arc.ry.abs();
    if rx == 0.0 || ry == 0.0 {
        return PathBounds::from_points(&[start, end]);
    }
    let (sin, cos) = (arc.x_axis_rotation_deg % 360.0).to_radians().sin_cos();
    let half_x = start.x * 0.5 - end.x * 0.5;
    let half_y = start.y * 0.5 - end.y * 0.5;
    let rotated_x = cos * half_x + sin * half_y;
    let rotated_y = -sin * half_x + cos * half_y;
    // Compute corrected radii directly, avoiding squared radii and tiny-radii underflow.
    let x_term = if rotated_y == 0.0 {
        0.0
    } else {
        (rx / ry) * rotated_y
    };
    let y_term = if rotated_x == 0.0 {
        0.0
    } else {
        (ry / rx) * rotated_x
    };
    if [rotated_x, rotated_y, x_term, y_term]
        .iter()
        .any(|scalar| !scalar.is_finite())
    {
        return Err(ShapeError::InvalidPathData);
    }
    let corrected_x = rx.max(rotated_x.hypot(x_term));
    let corrected_y = ry.max(y_term.hypot(rotated_y));
    let extent = outward_arc_extent(2.0 * corrected_x.max(corrected_y));
    PathBounds::from_points(&[
        Point2D {
            x: start.x - extent,
            y: start.y - extent,
        },
        Point2D {
            x: start.x + extent,
            y: start.y + extent,
        },
        end,
    ])
}

/// Enclose native float arc paint independently of angle quantization.
///
/// The SVG correction factor is at most the half-chord length divided by the
/// smaller radius. Multiplying the larger radius by that factor encloses the
/// entire ellipse for any rotation. The factor also encloses quarter-arc
/// cubic control hulls; zero projected radii paint a line. All
/// native float inputs remain far inside finite double arithmetic here.
///
/// # Errors
///
/// Returns `InvalidPathData` if a projected endpoint is not finite.
fn paint_arc_bounds(
    start: Point2D,
    end: Point2D,
    arc: &ArcToken,
) -> Result<PathBounds, ShapeError> {
    let rx = ScalarProjection::Paint.input(arc.rx).abs();
    let ry = ScalarProjection::Paint.input(arc.ry).abs();
    if rx == 0.0 || ry == 0.0 {
        return PathBounds::from_points(&[start, end]);
    }
    let half_chord = (start.x * 0.5 - end.x * 0.5).hypot(start.y * 0.5 - end.y * 0.5);
    let corrected_radius = rx.max(ry) * (half_chord / rx.min(ry)).max(1.0);
    let extent = outward_arc_extent(corrected_radius * ARC_PAINT_ENCLOSURE_FACTOR);
    PathBounds::from_points(&[
        Point2D {
            x: start.x - extent,
            y: start.y - extent,
        },
        Point2D {
            x: start.x + extent,
            y: start.y + extent,
        },
        end,
    ])
}

/// Parse conservative general SVG Path bounds, retaining a completed drawable prefix.
///
/// No topology, flattening, position epsilon, or new source rejection is applied.
/// Failure is explicit in `error_offset`; the caller can preserve raw SVG emission.
/// Tokens borrow the source once. Two linear projections share its argument
/// readers: authored doubles and native paint floats. Their finite bounds are
/// unioned so subnormal arcs, relative rounding and finite native parse limits
/// cannot discard visible paint. `error_offset` describes the authored view.
#[must_use]
pub fn parse_path_bounds(path_data: &str) -> PathBoundsParse {
    let mut lexer = PathTokens::new(path_data);
    let mut tokens = Vec::new();
    let mut lexical_error = None;
    while let Some(token) = lexer.next() {
        if let Ok(token) = token {
            tokens.push(token);
        } else {
            lexical_error = Some(lexer.offset());
            break;
        }
    }
    let mut authored = project_bounds(&tokens, lexical_error, ScalarProjection::Authored);
    let paint = project_bounds(&tokens, lexical_error, ScalarProjection::Paint);
    if let Some(paint_bounds) = paint.bounds {
        if let Some(authored_bounds) = authored.bounds.as_mut() {
            authored_bounds.include(paint_bounds);
        } else {
            authored.bounds = Some(paint_bounds);
        }
    }
    authored
}

/// Walk one shared token slice; representation failures retain its completed prefix.
fn project_bounds<'a>(
    tokens: &'a [PathToken<'a>],
    lexical_error: Option<usize>,
    projection: ScalarProjection,
) -> PathBoundsParse {
    let mut reader = BoundsReader {
        tokens,
        projection,
        index: 0,
        current: Point2D { x: 0.0, y: 0.0 },
        start: None,
        cubic_control: None,
        quad_control: None,
        bounds: None,
    };
    let mut command = None;
    while reader.index < reader.tokens.len() {
        let offset = reader.tokens[reader.index].offset;
        let token = reader.tokens[reader.index].text;
        if is_command_token(token) {
            command = token.chars().next();
            reader.index += 1;
        }
        let Some(current_command) = command else {
            return PathBoundsParse {
                bounds: reader.bounds,
                error_offset: Some(offset),
            };
        };
        if reader.start.is_none() && !matches!(current_command, 'M' | 'm') {
            return PathBoundsParse {
                bounds: reader.bounds,
                error_offset: Some(offset),
            };
        }
        if reader.group(current_command).is_err() {
            return PathBoundsParse {
                bounds: reader.bounds,
                error_offset: Some(offset),
            };
        }
        command = match current_command {
            'M' => Some('L'),
            'm' => Some('l'),
            'Z' | 'z' => None,
            other => Some(other),
        };
    }
    PathBoundsParse {
        bounds: reader.bounds,
        error_offset: lexical_error,
    }
}
