//! Document-level animation sampling and CSS timeline planning.
//!
//! Authored track sampling remains owned by [`super::animation`]. This module
//! maps a caller-provided document clock onto that sampler and compiles the
//! finite CSS vocabulary used by standalone animated SVG output.

use std::collections::HashMap;
#[cfg(test)]
use std::{
    sync::{LazyLock, Mutex},
    thread::ThreadId,
};

use boundshape::Transform2D;
use serde_json::json;

use super::animation::{self, ResolvedEasing};
use super::types::{
    AnimationIterations, AnimationKeyframe, AnimationSpec, AnimationTransform2D, BBox, Ir, IrNode,
    IrNodeKind, TextUnitAnimationOrder,
};
use crate::error::EngineError;
use crate::svg_emit::num_format::format_js_number;

pub const MAX_TIMELINE_DURATION_MS: f64 = 4_294_967_296.0;
pub const MAX_TIMELINE_ITERATIONS: f64 = 1_048_576.0;
pub const MAX_TIMELINE_TIME_MS: f64 = 4_503_599_627_370_496.0;
pub const MAX_TIMELINE_TIME_RATIO: f64 = 2_147_483_648.0;
pub const MAX_TIMELINE_KEYFRAME_STOPS: usize = 16_384;
pub const MAX_TIMELINE_CSS_BYTES: usize = 16_777_216;

const CARVE_OUT_SCALE: f64 = 1_048_576.0;

#[cfg(test)]
static COMPILE_TRACK_TRACE: LazyLock<Mutex<HashMap<ThreadId, Vec<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DocumentIterationCount {
    Finite(f64),
    Infinite,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DocumentPlayback {
    pub duration_ms: f64,
    pub iterations: DocumentIterationCount,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CssIterationCount {
    Finite(f64),
    Infinite,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DocumentCssTiming {
    pub delay_ms: f64,
    pub iterations: CssIterationCount,
    pub final_hold: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimelineOwnerKind {
    Node,
    TextUnit,
}

impl TimelineOwnerKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Node => "node",
            Self::TextUnit => "textUnit",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum CompiledCssEasing {
    Linear,
    OutputScaledLinear(f64),
    CubicBezier([f64; 4]),
    StepEnd,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DocumentKeyframe {
    pub time_ms: f64,
    pub value: AnimationKeyframe,
    pub easing_to_next: Option<CompiledCssEasing>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DocumentTrackPlan {
    pub owner_kind: TimelineOwnerKind,
    pub owner_id: String,
    pub unit_id: Option<String>,
    pub animation_name_owner: String,
    pub bbox: BBox,
    pub keyframes: Vec<DocumentKeyframe>,
    pub discontinuities_ms: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DocumentAnimationPlan {
    pub duration_ms: f64,
    pub css_iteration_count: CssIterationCount,
    pub css_delay_ms: f64,
    pub final_hold: bool,
    pub tracks: Vec<DocumentTrackPlan>,
    pub keyframe_stop_count: usize,
    pub exact_css_bytes: usize,
}

fn timeline_error(
    code: &str,
    message: impl Into<String>,
    context: serde_json::Value,
) -> EngineError {
    EngineError::StructuredContext {
        code: code.to_string(),
        message: message.into(),
        stage: Some("validate".to_string()),
        node_id: None,
        context: Box::new(context),
    }
}

fn invalid_timeline(field: &str, received: impl Into<String>) -> EngineError {
    timeline_error(
        "ANIMATED_SVG_INVALID_TIMELINE",
        format!("Animated SVG timeline {field} is outside the supported range"),
        json!({
            "field": field,
            "received": received.into(),
        }),
    )
}

fn validate_duration(duration_ms: f64) -> Result<(), EngineError> {
    if !duration_ms.is_finite() || !(1.0..=MAX_TIMELINE_DURATION_MS).contains(&duration_ms) {
        return Err(invalid_timeline(
            "durationMs",
            format_js_number(duration_ms),
        ));
    }
    Ok(())
}

fn validate_iterations(iterations: DocumentIterationCount) -> Result<(), EngineError> {
    if let DocumentIterationCount::Finite(count) = iterations
        && (!count.is_finite() || count <= 0.0 || count > MAX_TIMELINE_ITERATIONS)
    {
        return Err(invalid_timeline("iterations", format_js_number(count)));
    }
    Ok(())
}

fn validate_time(time_ms: f64) -> Result<(), EngineError> {
    if !time_ms.is_finite() || !(0.0..=MAX_TIMELINE_TIME_MS).contains(&time_ms) {
        return Err(invalid_timeline("timeMs", format_js_number(time_ms)));
    }
    Ok(())
}

/// Validate the public timeline range and the precision of the document
/// elapsed-to-cycle mapping.
///
/// # Errors
///
/// Returns a code-specific structured timeline error.
pub fn validate_document_playback(
    playback: DocumentPlayback,
    time_ms: f64,
) -> Result<(), EngineError> {
    validate_duration(playback.duration_ms)?;
    validate_iterations(playback.iterations)?;
    validate_time(time_ms)?;
    let ratio = time_ms / playback.duration_ms;
    if ratio > MAX_TIMELINE_TIME_RATIO {
        return Err(timeline_error(
            "ANIMATED_SVG_TIMELINE_PRECISION_LOSS",
            "Animated SVG timeline timeMs/durationMs ratio exceeds the supported precision limit",
            json!({
                "kind": "time-ratio",
                "timeMs": time_ms,
                "durationMs": playback.duration_ms,
                "limitRatio": MAX_TIMELINE_TIME_RATIO,
            }),
        ));
    }
    Ok(())
}

impl DocumentPlayback {
    #[must_use]
    pub fn delta_ms(self) -> f64 {
        self.duration_ms / CARVE_OUT_SCALE
    }

    /// Map document elapsed time onto the existing authored sampler domain.
    #[must_use]
    pub fn authored_sample_time_ms(self, time_ms: f64) -> f64 {
        if let DocumentIterationCount::Finite(count) = self.iterations
            && time_ms >= count * self.duration_ms
        {
            let fraction = count.fract();
            return if fraction == 0.0 {
                self.duration_ms
            } else {
                fraction * self.duration_ms
            };
        }
        let cycle_index = (time_ms / self.duration_ms).floor();
        time_ms - cycle_index * self.duration_ms
    }

    /// Derive the bounded CSS delay and remaining iteration count.
    #[must_use]
    pub fn css_timing(self, time_ms: f64) -> DocumentCssTiming {
        if let DocumentIterationCount::Finite(count) = self.iterations
            && time_ms >= count * self.duration_ms
        {
            let fraction = count.fract();
            let hold_progress = if fraction == 0.0 { 1.0 } else { fraction };
            return DocumentCssTiming {
                delay_ms: -(hold_progress * self.duration_ms),
                iterations: CssIterationCount::Finite(hold_progress),
                final_hold: true,
            };
        }

        let consumed_iterations = (time_ms / self.duration_ms).floor();
        let phase_ms = time_ms - consumed_iterations * self.duration_ms;
        let iterations = match self.iterations {
            DocumentIterationCount::Finite(count) => {
                CssIterationCount::Finite(count - consumed_iterations)
            }
            DocumentIterationCount::Infinite => CssIterationCount::Infinite,
        };
        DocumentCssTiming {
            delay_ms: -phase_ms,
            iterations,
            final_hold: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
struct TrackValue {
    opacity: Option<f64>,
    transform: Option<AnimationTransform2D>,
}

impl TrackValue {
    fn to_keyframe(&self) -> AnimationKeyframe {
        AnimationKeyframe {
            at: 0.0,
            opacity: self.opacity,
            transform: self.transform.clone(),
        }
    }

    fn channel_values(&self) -> Vec<f64> {
        let mut values = Vec::with_capacity(6);
        if let Some(opacity) = self.opacity {
            values.push(opacity);
        }
        if let Some(transform) = &self.transform {
            values.extend([
                transform.translate_x.unwrap_or(0.0),
                transform.translate_y.unwrap_or(0.0),
                transform.scale_x.unwrap_or(1.0),
                transform.scale_y.unwrap_or(1.0),
                transform.rotate_deg.unwrap_or(0.0),
            ]);
        }
        values
    }

    fn approximately_equals(&self, other: &Self) -> bool {
        let left = self.channel_values();
        let right = other.channel_values();
        left.len() == right.len()
            && left.iter().zip(right).all(|(left_value, right_value)| {
                let scale = left_value.abs().max(right_value.abs()).max(1.0);
                (left_value - right_value).abs() <= f64::EPSILON * scale * 16.0
            })
    }
}

#[derive(Debug, Clone)]
struct TrackSource {
    owner_kind: TimelineOwnerKind,
    owner_id: String,
    unit_id: Option<String>,
    animation_name_owner: String,
    bbox: BBox,
    spec: AnimationSpec,
    base_value: TrackValue,
}

#[derive(Debug, Clone, PartialEq)]
enum PieceEasing {
    Constant,
    Linear,
    CubicBezier([f64; 4]),
}

#[derive(Debug, Clone, PartialEq)]
struct FunctionPiece {
    start_ms: f64,
    end_ms: f64,
    start_value: TrackValue,
    end_value: TrackValue,
    easing: PieceEasing,
}

#[derive(Debug, Clone, Copy)]
struct CubicPoint {
    x: f64,
    y: f64,
}

fn timeline_unrepresentable(
    source: &TrackSource,
    reason: &str,
    boundary_time_ms: f64,
    migration: Option<&str>,
) -> EngineError {
    let mut context = json!({
        "ownerKind": source.owner_kind.as_str(),
        "ownerId": source.owner_id,
        "reason": reason,
        "boundaryTimeMs": boundary_time_ms,
    });
    if let Some(unit_id) = &source.unit_id {
        context["unitId"] = json!(unit_id);
    }
    if let Some(migration) = migration {
        context["migration"] = json!(migration);
    }
    EngineError::StructuredContext {
        code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE".to_string(),
        message: format!(
            "Animated SVG timeline cannot represent {} track {:?}: {reason}",
            source.owner_kind.as_str(),
            source.owner_id
        ),
        stage: Some("emit".to_string()),
        node_id: Some(source.owner_id.clone()),
        context: Box::new(context),
    }
}

fn timeline_precision_error(kind: &str, left_time_ms: f64, right_time_ms: f64) -> EngineError {
    EngineError::StructuredContext {
        code: "ANIMATED_SVG_TIMELINE_PRECISION_LOSS".to_string(),
        message: format!("Animated SVG timeline keyframe precision check failed: {kind}"),
        stage: Some("emit".to_string()),
        node_id: None,
        context: Box::new(json!({
            "kind": kind,
            "leftTimeMs": left_time_ms,
            "rightTimeMs": right_time_ms,
        })),
    }
}

fn timeline_limit_error(metric: &str, actual: f64, limit: usize) -> EngineError {
    let finite_actual = if actual.is_finite() { actual } else { f64::MAX };
    EngineError::StructuredContext {
        code: "ANIMATED_SVG_TIMELINE_LIMIT".to_string(),
        message: format!("Animated SVG timeline {metric} exceeds the supported limit"),
        stage: Some("emit".to_string()),
        node_id: None,
        context: Box::new(json!({
            "metric": metric,
            "actual": finite_actual,
            "limit": limit,
        })),
    }
}

fn animation_channels(spec: &AnimationSpec) -> (bool, bool) {
    (
        spec.keyframes
            .iter()
            .any(|keyframe| keyframe.opacity.is_some()),
        spec.keyframes
            .iter()
            .any(|keyframe| keyframe.transform.is_some()),
    )
}

fn identity_animation_transform() -> AnimationTransform2D {
    AnimationTransform2D {
        translate_x: Some(0.0),
        translate_y: Some(0.0),
        scale_x: Some(1.0),
        scale_y: Some(1.0),
        rotate_deg: Some(0.0),
    }
}

fn sampled_transform_value(transform: &Transform2D) -> AnimationTransform2D {
    AnimationTransform2D {
        translate_x: Some(transform.translate_x.unwrap_or(0.0)),
        translate_y: Some(transform.translate_y.unwrap_or(0.0)),
        scale_x: Some(transform.scale_x.unwrap_or(1.0)),
        scale_y: Some(transform.scale_y.unwrap_or(1.0)),
        rotate_deg: Some(transform.rotate_deg.unwrap_or(0.0)),
    }
}

fn base_transform_value(transform: Option<&Transform2D>, bbox: BBox) -> AnimationTransform2D {
    let Some(transform) = transform else {
        return identity_animation_transform();
    };
    let translate_x = transform.translate_x.unwrap_or(0.0);
    let translate_y = transform.translate_y.unwrap_or(0.0);
    let scale_x = transform.scale_x.unwrap_or(1.0);
    let scale_y = transform.scale_y.unwrap_or(1.0);
    let rotate_deg = transform.rotate_deg.unwrap_or(0.0);
    let origin_x = transform.origin_x.unwrap_or(0.0);
    let origin_y = transform.origin_y.unwrap_or(0.0);
    let center_x = bbox.w / 2.0;
    let center_y = bbox.h / 2.0;
    let radians = rotate_deg.to_radians();
    let (sin, cos) = radians.sin_cos();
    let matrix_a = cos * scale_x;
    let matrix_b = sin * scale_x;
    let matrix_c = -sin * scale_y;
    let matrix_d = cos * scale_y;
    let offset_x = origin_x - center_x;
    let offset_y = origin_y - center_y;
    AnimationTransform2D {
        translate_x: Some(translate_x + offset_x - (matrix_a * offset_x + matrix_c * offset_y)),
        translate_y: Some(translate_y + offset_y - (matrix_b * offset_x + matrix_d * offset_y)),
        scale_x: Some(scale_x),
        scale_y: Some(scale_y),
        rotate_deg: Some(rotate_deg),
    }
}

fn collect_track_sources(node: &IrNode, sources: &mut Vec<TrackSource>) {
    match &node.kind {
        IrNodeKind::Group {
            children,
            opacity,
            transform,
            animation,
            ..
        } => {
            if let Some(spec) = animation {
                let (animates_opacity, animates_transform) = animation_channels(spec);
                sources.push(TrackSource {
                    owner_kind: TimelineOwnerKind::Node,
                    owner_id: node.node_id.clone(),
                    unit_id: None,
                    animation_name_owner: node.node_id.clone(),
                    bbox: node.bbox,
                    spec: spec.clone(),
                    base_value: TrackValue {
                        opacity: animates_opacity.then_some(opacity.unwrap_or(1.0)),
                        transform: animates_transform
                            .then(|| base_transform_value(transform.as_ref(), node.bbox)),
                    },
                });
            }
            for child in children {
                collect_track_sources(child, sources);
            }
        }
        IrNodeKind::Text {
            unit_map: Some(unit_map),
            unit_animation: Some(unit_animation),
            unit_animation_samples: Some(samples),
            ..
        } => {
            let use_visual_order =
                matches!(unit_animation.order, Some(TextUnitAnimationOrder::Visual));
            let unit_orders: HashMap<&str, (u32, u32)> = unit_map
                .units
                .iter()
                .map(|unit| {
                    (
                        unit.unit_id.as_str(),
                        (unit.logical_order, unit.visual_order),
                    )
                })
                .collect();
            let (animates_opacity, animates_transform) =
                animation_channels(&unit_animation.animation);
            for (unit_index, sample) in samples.iter().enumerate() {
                let Some(bbox) = sample.bbox else {
                    continue;
                };
                let Some((logical_order, visual_order)) =
                    unit_orders.get(sample.unit_id.as_str()).copied()
                else {
                    continue;
                };
                let order_index = if use_visual_order {
                    visual_order
                } else {
                    logical_order
                };
                let mut spec = unit_animation.animation.clone();
                spec.delay_ms = Some(
                    spec.delay_ms.unwrap_or(0.0)
                        + f64::from(order_index) * unit_animation.delay_step_ms.unwrap_or(0.0),
                );
                sources.push(TrackSource {
                    owner_kind: TimelineOwnerKind::TextUnit,
                    owner_id: node.node_id.clone(),
                    unit_id: Some(sample.unit_id.clone()),
                    animation_name_owner: format!("{}:unit:{unit_index}", node.node_id),
                    bbox,
                    spec,
                    base_value: TrackValue {
                        opacity: animates_opacity.then_some(1.0),
                        transform: animates_transform.then(identity_animation_transform),
                    },
                });
            }
        }
        _ => {}
    }
}

fn source_iterations(spec: &AnimationSpec) -> Option<f64> {
    match spec.iterations.as_ref() {
        Some(AnimationIterations::Count(count)) => Some(*count),
        Some(AnimationIterations::Infinite(_)) => None,
        None => Some(1.0),
    }
}

fn base_transition_time_ms(source: &TrackSource, playback: DocumentPlayback) -> Option<f64> {
    if source.spec.fill.as_deref() == Some("both") {
        return None;
    }
    let delay_ms = source.spec.delay_ms.unwrap_or(0.0);
    let active_end_ms = source_iterations(&source.spec)
        .map(|iterations| delay_ms + iterations * source.spec.duration_ms);
    if delay_ms >= playback.duration_ms || active_end_ms.is_some_and(|end_ms| end_ms <= 0.0) {
        return Some(0.0);
    }
    if delay_ms > 0.0 {
        return Some(delay_ms);
    }
    active_end_ms
        .filter(|end_ms| *end_ms <= playback.duration_ms)
        .map(|end_ms| end_ms.max(0.0))
}

fn spec_values_are_constant(spec: &AnimationSpec) -> bool {
    let Some(first) = spec.keyframes.first() else {
        return true;
    };
    spec.keyframes
        .iter()
        .all(|keyframe| keyframe.opacity == first.opacity && keyframe.transform == first.transform)
}

fn same_time(left: f64, right: f64) -> bool {
    let scale = left.abs().max(right.abs()).max(1.0);
    (left - right).abs() <= f64::EPSILON * scale * 16.0
}

fn previous_f64(value: f64) -> f64 {
    if value > 0.0 {
        f64::from_bits(value.to_bits() - 1)
    } else {
        value
    }
}

fn push_boundary(boundaries: &mut Vec<f64>, time_ms: f64, duration_ms: f64) {
    if time_ms >= 0.0 && time_ms <= duration_ms && time_ms.is_finite() {
        boundaries.push(time_ms.clamp(0.0, duration_ms));
    }
}

#[derive(Debug, Clone)]
struct LocalBoundaryPattern {
    fixed_offsets: Vec<f64>,
    step_segments: Vec<(f64, f64, f64)>,
}

impl LocalBoundaryPattern {
    fn count_offsets_between(&self, lower: f64, upper: f64) -> f64 {
        let fixed_count = self
            .fixed_offsets
            .iter()
            .filter(|offset| **offset > lower && **offset < upper)
            .count() as f64;
        self.step_segments
            .iter()
            .fold(fixed_count, |count, (start, end, steps)| {
                let span = end - start;
                let first = ((((lower - start) / span) * steps).floor() + 1.0).max(1.0);
                let last = ((((upper - start) / span) * steps).ceil() - 1.0).min(steps - 1.0);
                count + (last - first + 1.0).max(0.0)
            })
    }

    fn count_offsets_in_open_source_range(&self, start: f64, end: f64) -> f64 {
        if end <= start {
            return 0.0;
        }
        let start_iteration = start.floor();
        let end_iteration = end.floor();
        let start_progress = start - start_iteration;
        let end_progress = end - end_iteration;
        if start_iteration == end_iteration {
            return self.count_offsets_between(start_progress, end_progress);
        }
        let first_count = self.count_offsets_between(start_progress, 1.0);
        let full_iteration_count = (end_iteration - start_iteration - 1.0).max(0.0);
        let offsets_per_iteration = self.count_offsets_between(-1.0, 1.0);
        let last_count = self.count_offsets_between(-1.0, end_progress);
        first_count + full_iteration_count * offsets_per_iteration + last_count
    }

    fn minimum_full_iteration_gap(&self) -> Option<f64> {
        if !self.step_segments.is_empty() {
            let mut minimum_gap = f64::INFINITY;
            let mut previous_boundary = 0.0_f64;
            for (segment_start, segment_end, steps) in &self.step_segments {
                let leading_gap = segment_start - previous_boundary;
                if leading_gap > 0.0 {
                    minimum_gap = minimum_gap.min(leading_gap);
                }
                let step_gap = (segment_end - segment_start) / steps;
                if step_gap > 0.0 {
                    minimum_gap = minimum_gap.min(step_gap);
                }
                previous_boundary = *segment_end;
            }
            let trailing_gap = 1.0 - previous_boundary;
            if trailing_gap > 0.0 {
                minimum_gap = minimum_gap.min(trailing_gap);
            }
            return minimum_gap.is_finite().then_some(minimum_gap);
        }
        self.fixed_offsets
            .iter()
            .copied()
            .chain(std::iter::once(1.0))
            .try_fold((None, f64::INFINITY), |(previous, minimum), offset| {
                let next_minimum = previous.map_or(minimum, |previous_offset| {
                    minimum.min(offset - previous_offset)
                });
                Some((Some(offset), next_minimum))
            })
            .and_then(|(_, minimum)| (minimum > 0.0).then_some(minimum))
    }
}

fn derivative_roots(first: f64, second: f64) -> Vec<f64> {
    let polynomial_a = 3.0 * first - 3.0 * second + 1.0;
    let polynomial_b = -6.0 * first + 3.0 * second;
    let polynomial_c = 3.0 * first;
    let quadratic_a = 3.0 * polynomial_a;
    let quadratic_b = 2.0 * polynomial_b;
    let quadratic_c = polynomial_c;
    let mut roots = Vec::new();
    if quadratic_a.abs() <= f64::EPSILON {
        if quadratic_b.abs() > f64::EPSILON {
            roots.push(-quadratic_c / quadratic_b);
        }
    } else {
        let discriminant = quadratic_b * quadratic_b - 4.0 * quadratic_a * quadratic_c;
        if discriminant >= 0.0 {
            let square_root = discriminant.sqrt();
            roots.push((-quadratic_b - square_root) / (2.0 * quadratic_a));
            roots.push((-quadratic_b + square_root) / (2.0 * quadratic_a));
        }
    }
    if first == 0.0
        && let Some((root_index, root)) = roots
            .iter()
            .enumerate()
            .min_by(|(_, left), (_, right)| left.abs().total_cmp(&right.abs()))
        && same_time(*root, 0.0)
    {
        roots.remove(root_index);
    }
    if second == 1.0
        && let Some((root_index, root)) = roots
            .iter()
            .enumerate()
            .min_by(|(_, left), (_, right)| (1.0 - **left).abs().total_cmp(&(1.0 - **right).abs()))
        && same_time(*root, 1.0)
    {
        roots.remove(root_index);
    }
    roots.retain(|root| *root > 0.0 && *root < 1.0 && root.is_finite());
    roots.sort_by(f64::total_cmp);
    roots.dedup_by(|left, right| same_time(*left, *right));
    roots
}

fn cubic_coordinate(parameter: f64, first: f64, second: f64) -> f64 {
    let inverse = 1.0 - parameter;
    3.0 * inverse * inverse * parameter * first
        + 3.0 * inverse * parameter * parameter * second
        + parameter * parameter * parameter
}

fn cubic_coordinate_derivative(parameter: f64, first: f64, second: f64) -> f64 {
    3.0 * (1.0 - parameter) * (1.0 - parameter) * first
        + 6.0 * (1.0 - parameter) * parameter * (second - first)
        + 3.0 * parameter * parameter * (1.0 - second)
}

fn cubic_roots_for_value(first: f64, second: f64, target: f64) -> Vec<f64> {
    let mut partitions = vec![0.0];
    partitions.extend(derivative_roots(first, second));
    partitions.push(1.0);
    let mut roots = Vec::new();
    for pair in partitions.windows(2) {
        let [low_bound, high_bound] = pair else {
            continue;
        };
        let low_value = cubic_coordinate(*low_bound, first, second) - target;
        let high_value = cubic_coordinate(*high_bound, first, second) - target;
        if low_value.abs() <= 1.0e-12 {
            roots.push(*low_bound);
        }
        if high_value.abs() <= 1.0e-12 {
            roots.push(*high_bound);
        }
        if low_value.signum() == high_value.signum() || low_value == 0.0 || high_value == 0.0 {
            continue;
        }
        let mut low = *low_bound;
        let mut high = *high_bound;
        let mut current_low_value = low_value;
        for _ in 0..80 {
            let middle = f64::midpoint(low, high);
            let middle_value = cubic_coordinate(middle, first, second) - target;
            if middle_value.signum() == current_low_value.signum() {
                low = middle;
                current_low_value = middle_value;
            } else {
                high = middle;
            }
        }
        roots.push(f64::midpoint(low, high));
    }
    roots.retain(|root| *root > 0.0 && *root < 1.0 && root.is_finite());
    roots.sort_by(f64::total_cmp);
    roots.dedup_by(|left, right| same_time(*left, *right));
    roots
}

fn parameter_for_x(curve: [f64; 4], input_progress: f64) -> f64 {
    if input_progress <= 0.0 {
        return 0.0;
    }
    if input_progress >= 1.0 {
        return 1.0;
    }
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..80 {
        let middle = f64::midpoint(low, high);
        if cubic_coordinate(middle, curve[0], curve[2]) < input_progress {
            low = middle;
        } else {
            high = middle;
        }
    }
    f64::midpoint(low, high)
}

fn cubic_point(curve: [f64; 4], parameter: f64) -> CubicPoint {
    CubicPoint {
        x: cubic_coordinate(parameter, curve[0], curve[2]),
        y: cubic_coordinate(parameter, curve[1], curve[3]),
    }
}

fn cubic_derivative_point(curve: [f64; 4], parameter: f64) -> CubicPoint {
    CubicPoint {
        x: cubic_coordinate_derivative(parameter, curve[0], curve[2]),
        y: cubic_coordinate_derivative(parameter, curve[1], curve[3]),
    }
}

fn cubic_subcurve(curve: [f64; 4], input_start: f64, input_end: f64) -> Option<[f64; 4]> {
    let start_parameter = parameter_for_x(curve, input_start);
    let end_parameter = parameter_for_x(curve, input_end);
    let start = cubic_point(curve, start_parameter);
    let end = cubic_point(curve, end_parameter);
    let parameter_span = end_parameter - start_parameter;
    let start_derivative = cubic_derivative_point(curve, start_parameter);
    let end_derivative = cubic_derivative_point(curve, end_parameter);
    let control1 = CubicPoint {
        x: start.x + parameter_span * start_derivative.x / 3.0,
        y: start.y + parameter_span * start_derivative.y / 3.0,
    };
    let control2 = CubicPoint {
        x: end.x - parameter_span * end_derivative.x / 3.0,
        y: end.y - parameter_span * end_derivative.y / 3.0,
    };
    let x_span = end.x - start.x;
    let y_span = end.y - start.y;
    if x_span <= 0.0 || y_span.abs() <= f64::EPSILON {
        return None;
    }
    Some([
        (control1.x - start.x) / x_span,
        (control1.y - start.y) / y_span,
        (control2.x - start.x) / x_span,
        (control2.y - start.y) / y_span,
    ])
}

fn interpolate_transform(
    from: &AnimationTransform2D,
    to: &AnimationTransform2D,
    progress: f64,
) -> AnimationTransform2D {
    let interpolate = |from: Option<f64>, to: Option<f64>, identity: f64| {
        let from_value = from.unwrap_or(identity);
        let to_value = to.unwrap_or(identity);
        Some(from_value + (to_value - from_value) * progress)
    };
    AnimationTransform2D {
        translate_x: interpolate(from.translate_x, to.translate_x, 0.0),
        translate_y: interpolate(from.translate_y, to.translate_y, 0.0),
        scale_x: interpolate(from.scale_x, to.scale_x, 1.0),
        scale_y: interpolate(from.scale_y, to.scale_y, 1.0),
        rotate_deg: interpolate(from.rotate_deg, to.rotate_deg, 0.0),
    }
}

fn interpolate_keyframes(
    from: &AnimationKeyframe,
    to: &AnimationKeyframe,
    progress: f64,
) -> TrackValue {
    TrackValue {
        opacity: match (from.opacity, to.opacity) {
            (Some(from_opacity), Some(to_opacity)) => {
                Some((from_opacity + (to_opacity - from_opacity) * progress).clamp(0.0, 1.0))
            }
            _ => None,
        },
        transform: match (from.transform.as_ref(), to.transform.as_ref()) {
            (Some(from_transform), Some(to_transform)) => Some(interpolate_transform(
                from_transform,
                to_transform,
                progress,
            )),
            _ => None,
        },
    }
}

fn keyframe_segment_index(keyframes: &[AnimationKeyframe], progress: f64) -> Option<usize> {
    if keyframes.len() < 2 || progress < keyframes.first()?.at || progress >= keyframes.last()?.at {
        return None;
    }
    keyframes.windows(2).position(|pair| progress < pair[1].at)
}

fn evaluate_segment(
    spec: &AnimationSpec,
    segment_index: usize,
    input_progress: f64,
    resolved_easing: ResolvedEasing,
) -> TrackValue {
    let from = &spec.keyframes[segment_index];
    let to = &spec.keyframes[segment_index + 1];
    let segment_duration_ms = spec.duration_ms * (to.at - from.at);
    let eased_progress = animation::apply_easing(
        input_progress.clamp(0.0, 1.0),
        resolved_easing,
        false,
        segment_duration_ms,
    );
    interpolate_keyframes(from, to, eased_progress)
}

fn exact_track_value(source: &TrackSource, time_ms: f64) -> Result<TrackValue, EngineError> {
    let (sampled_opacity, sampled_transform) = animation::sample_spec(
        &source.spec,
        &source.owner_id,
        time_ms,
        source.spec.delay_ms.unwrap_or(0.0),
        source.bbox.w,
        source.bbox.h,
    )?;
    Ok(TrackValue {
        opacity: source
            .base_value
            .opacity
            .map(|base_opacity| sampled_opacity.unwrap_or(base_opacity)),
        transform: source.base_value.transform.as_ref().map(|base_transform| {
            sampled_transform
                .as_ref()
                .map_or_else(|| base_transform.clone(), sampled_transform_value)
        }),
    })
}

fn cubic_segment_boundary_progresses(
    spec: &AnimationSpec,
    segment_index: usize,
    curve: [f64; 4],
) -> Vec<f64> {
    let from = &spec.keyframes[segment_index];
    let to = &spec.keyframes[segment_index + 1];
    let segment_span = to.at - from.at;
    let mut parameters = Vec::new();
    if let (Some(from_opacity), Some(to_opacity)) = (from.opacity, to.opacity)
        && from_opacity != to_opacity
    {
        for threshold in [0.0, 1.0] {
            let target = (threshold - from_opacity) / (to_opacity - from_opacity);
            parameters.extend(cubic_roots_for_value(curve[1], curve[3], target));
        }
    }
    parameters.sort_by(f64::total_cmp);
    parameters.dedup_by(|left, right| same_time(*left, *right));
    parameters
        .into_iter()
        .map(|parameter| from.at + cubic_coordinate(parameter, curve[0], curve[2]) * segment_span)
        .collect()
}

fn keyframe_values_vary(from: &AnimationKeyframe, to: &AnimationKeyframe) -> bool {
    from.opacity != to.opacity || from.transform != to.transform
}

#[derive(Debug, Clone, Copy)]
struct DocumentCutCubicSegment {
    visible_start: f64,
    visible_end: f64,
    cuts_document_start: bool,
    cuts_document_end: bool,
}

fn document_cut_cubic_boundary_progresses(
    spec: &AnimationSpec,
    segment_index: usize,
    curve: [f64; 4],
    document_cut: DocumentCutCubicSegment,
    existing_progresses: &[f64],
) -> Vec<f64> {
    if !document_cut.cuts_document_start && !document_cut.cuts_document_end {
        return Vec::new();
    }
    let from = &spec.keyframes[segment_index];
    let to = &spec.keyframes[segment_index + 1];
    if !keyframe_values_vary(from, to) {
        return Vec::new();
    }
    let segment_span = to.at - from.at;
    let input_start = ((document_cut.visible_start - from.at) / segment_span).clamp(0.0, 1.0);
    let input_end = ((document_cut.visible_end - from.at) / segment_span).clamp(0.0, 1.0);
    let mut input_boundaries = vec![input_start];
    input_boundaries.extend(existing_progresses.iter().filter_map(|progress| {
        let input = (*progress - from.at) / segment_span;
        (input > input_start && input < input_end).then_some(input)
    }));
    input_boundaries.push(input_end);
    input_boundaries.sort_by(f64::total_cmp);
    input_boundaries.dedup_by(|left, right| same_time(*left, *right));

    let start_parameter = parameter_for_x(curve, input_start);
    let end_parameter = parameter_for_x(curve, input_end);
    let mut progresses = Vec::new();
    for pair in input_boundaries.windows(2) {
        let [piece_start, piece_end] = pair else {
            continue;
        };
        let touches_document_cut = (document_cut.cuts_document_start
            && *piece_start == input_start)
            || (document_cut.cuts_document_end && *piece_end == input_end);
        if !touches_document_cut || cubic_subcurve(curve, *piece_start, *piece_end).is_some() {
            continue;
        }
        for parameter in derivative_roots(curve[1], curve[3]) {
            if parameter <= start_parameter || parameter >= end_parameter {
                continue;
            }
            let input = cubic_coordinate(parameter, curve[0], curve[2]);
            if input > *piece_start && input < *piece_end {
                progresses.push(from.at + input * segment_span);
            }
        }
    }
    progresses.sort_by(f64::total_cmp);
    progresses.dedup_by(|left, right| same_time(*left, *right));
    progresses
}

fn local_boundary_pattern(
    spec: &AnimationSpec,
    resolved_easing: ResolvedEasing,
) -> LocalBoundaryPattern {
    let mut fixed_offsets = vec![0.0];
    fixed_offsets.extend(
        spec.keyframes
            .iter()
            .map(|keyframe| keyframe.at)
            .filter(|offset| *offset > 0.0 && *offset < 1.0),
    );
    let mut step_segments = Vec::new();
    match resolved_easing {
        ResolvedEasing::Cubic(curve) => {
            for segment_index in 0..spec.keyframes.len().saturating_sub(1) {
                fixed_offsets.extend(cubic_segment_boundary_progresses(
                    spec,
                    segment_index,
                    curve,
                ));
            }
        }
        ResolvedEasing::Steps { count, .. } => {
            step_segments.extend(
                spec.keyframes
                    .windows(2)
                    .map(|pair| (pair[0].at, pair[1].at, count)),
            );
        }
        ResolvedEasing::Spring { .. } => {}
    }
    fixed_offsets.sort_by(f64::total_cmp);
    fixed_offsets.dedup_by(|left, right| *left == *right);
    LocalBoundaryPattern {
        fixed_offsets,
        step_segments,
    }
}

fn semantic_track_stop_count(
    source: &TrackSource,
    playback: DocumentPlayback,
    resolved_easing: ResolvedEasing,
) -> f64 {
    let delay_ms = source.spec.delay_ms.unwrap_or(0.0);
    if spec_values_are_constant(&source.spec) {
        let mut boundaries = vec![0.0, playback.duration_ms];
        push_boundary(&mut boundaries, delay_ms, playback.duration_ms);
        if let Some(iterations) = source_iterations(&source.spec) {
            push_boundary(
                &mut boundaries,
                delay_ms + iterations * source.spec.duration_ms,
                playback.duration_ms,
            );
        }
        boundaries.sort_by(f64::total_cmp);
        boundaries.dedup_by(|left, right| *left == *right);
        return boundaries.len() as f64;
    }

    let active_start_ms = delay_ms.max(0.0).min(playback.duration_ms);
    let active_end_ms = source_iterations(&source.spec)
        .map_or(playback.duration_ms, |iterations| {
            (delay_ms + iterations * source.spec.duration_ms).min(playback.duration_ms)
        });
    if !active_start_ms.is_finite()
        || !active_end_ms.is_finite()
        || active_end_ms <= active_start_ms
    {
        return 2.0;
    }

    let source_start = (active_start_ms - delay_ms) / source.spec.duration_ms;
    let source_end = (active_end_ms - delay_ms) / source.spec.duration_ms;
    if !source_start.is_finite() || !source_end.is_finite() {
        return f64::INFINITY;
    }
    let pattern = local_boundary_pattern(&source.spec, resolved_easing);
    let mut stop_count = 2.0
        + pattern.count_offsets_in_open_source_range(source_start.max(0.0), source_end.max(0.0));
    if active_start_ms > 0.0 && active_start_ms < playback.duration_ms {
        stop_count += 1.0;
    }
    if active_end_ms > active_start_ms && active_end_ms < playback.duration_ms {
        stop_count += 1.0;
    }
    stop_count
}

fn visit_iteration_boundaries<F>(
    source: &TrackSource,
    iteration_start_ms: f64,
    iteration_progress_limit: f64,
    playback: DocumentPlayback,
    resolved_easing: ResolvedEasing,
    visitor: &mut F,
) -> Result<(), EngineError>
where
    F: FnMut(f64) -> Result<(), EngineError>,
{
    let visible_start_ms = iteration_start_ms.max(0.0);
    let visible_end_ms = (iteration_start_ms + iteration_progress_limit * source.spec.duration_ms)
        .min(playback.duration_ms);
    if visible_end_ms <= visible_start_ms {
        return Ok(());
    }
    let visible_progress_start =
        ((visible_start_ms - iteration_start_ms) / source.spec.duration_ms).clamp(0.0, 1.0);
    let visible_progress_end = ((visible_end_ms - iteration_start_ms) / source.spec.duration_ms)
        .clamp(0.0, iteration_progress_limit);

    for (segment_index, pair) in source.spec.keyframes.windows(2).enumerate() {
        let segment_start = pair[0].at;
        let segment_end = pair[1].at;
        let segment_visible_start = segment_start.max(visible_progress_start);
        let segment_visible_end = segment_end.min(visible_progress_end);
        if segment_visible_end <= segment_visible_start {
            if segment_start >= visible_progress_end {
                break;
            }
            continue;
        }
        let boundary_time_ms =
            |progress: f64| iteration_start_ms + progress * source.spec.duration_ms;
        visitor(boundary_time_ms(segment_visible_start))?;

        match resolved_easing {
            ResolvedEasing::Steps { count, .. } => {
                let segment_span = segment_end - segment_start;
                let first_step =
                    ((((segment_visible_start - segment_start) / segment_span) * count).floor()
                        + 1.0)
                        .max(1.0);
                let step_end = ((((segment_visible_end - segment_start) / segment_span) * count)
                    .ceil())
                .min(count);
                let mut step_index = first_step;
                while step_index < step_end {
                    let step_progress = step_index / count;
                    let iteration_progress = segment_start + step_progress * segment_span;
                    let step_time_ms = boundary_time_ms(iteration_progress);
                    visitor(step_time_ms)?;
                    let next_step_index = step_index + 1.0;
                    if next_step_index == step_index && next_step_index < step_end {
                        return Err(timeline_precision_error(
                            "f32-order",
                            step_time_ms,
                            step_time_ms,
                        ));
                    }
                    step_index = next_step_index;
                }
            }
            ResolvedEasing::Cubic(curve) => {
                let mut progresses =
                    cubic_segment_boundary_progresses(&source.spec, segment_index, curve);
                let cuts_document_start = visible_start_ms == 0.0
                    && segment_visible_start == visible_progress_start
                    && segment_visible_start > segment_start;
                let cuts_document_end = visible_end_ms == playback.duration_ms
                    && segment_visible_end == visible_progress_end
                    && segment_visible_end < segment_end;
                progresses.extend(document_cut_cubic_boundary_progresses(
                    &source.spec,
                    segment_index,
                    curve,
                    DocumentCutCubicSegment {
                        visible_start: segment_visible_start,
                        visible_end: segment_visible_end,
                        cuts_document_start,
                        cuts_document_end,
                    },
                    &progresses,
                ));
                progresses.sort_by(f64::total_cmp);
                progresses.dedup_by(|left, right| same_time(*left, *right));
                for iteration_progress in progresses {
                    if iteration_progress > segment_visible_start
                        && iteration_progress < segment_visible_end
                    {
                        visitor(boundary_time_ms(iteration_progress))?;
                    }
                }
            }
            ResolvedEasing::Spring { .. } => {
                return Err(timeline_unrepresentable(
                    source,
                    "spring-easing",
                    visible_start_ms,
                    Some("Use playback mode independent for this animation track."),
                ));
            }
        }
        visitor(boundary_time_ms(segment_visible_end))?;
        if segment_end >= visible_progress_end {
            break;
        }
    }
    Ok(())
}

fn visit_distinct_boundary<F>(
    previous_boundary: &mut Option<f64>,
    time_ms: f64,
    playback: DocumentPlayback,
    visitor: &mut F,
) -> Result<(), EngineError>
where
    F: FnMut(f64) -> Result<(), EngineError>,
{
    if !time_ms.is_finite() || time_ms < 0.0 || time_ms > playback.duration_ms {
        return Ok(());
    }
    let clamped_time_ms = time_ms.clamp(0.0, playback.duration_ms);
    if previous_boundary.is_some_and(|previous| previous == clamped_time_ms) {
        return Ok(());
    }
    visitor(clamped_time_ms)?;
    *previous_boundary = Some(clamped_time_ms);
    Ok(())
}

fn visit_track_boundaries_with<F>(
    source: &TrackSource,
    playback: DocumentPlayback,
    resolved_easing: ResolvedEasing,
    visitor: &mut F,
) -> Result<(), EngineError>
where
    F: FnMut(f64) -> Result<(), EngineError>,
{
    // The visitor keeps precision and count passes at O(1) output memory. A
    // full boundary vector is materialized only by the post-budget plan sink.
    let mut previous_boundary = None;
    visit_distinct_boundary(&mut previous_boundary, 0.0, playback, visitor)?;
    let delay_ms = source.spec.delay_ms.unwrap_or(0.0);
    let source_iteration_count = source_iterations(&source.spec);

    if spec_values_are_constant(&source.spec) {
        let mut boundaries = Vec::with_capacity(2);
        push_boundary(&mut boundaries, delay_ms, playback.duration_ms);
        if let Some(count) = source_iteration_count {
            push_boundary(
                &mut boundaries,
                delay_ms + count * source.spec.duration_ms,
                playback.duration_ms,
            );
        }
        boundaries.sort_by(f64::total_cmp);
        boundaries.dedup_by(|left, right| *left == *right);
        for boundary in boundaries {
            visit_distinct_boundary(&mut previous_boundary, boundary, playback, visitor)?;
        }
        visit_distinct_boundary(
            &mut previous_boundary,
            playback.duration_ms,
            playback,
            visitor,
        )?;
        return Ok(());
    }

    let first_iteration = ((-delay_ms) / source.spec.duration_ms).floor().max(0.0);
    if !first_iteration.is_finite() || first_iteration > MAX_TIMELINE_TIME_MS {
        return Err(timeline_precision_error(
            "f32-order",
            0.0,
            playback.duration_ms,
        ));
    }
    let mut iteration_index = first_iteration;
    loop {
        if let Some(count) = source_iteration_count
            && iteration_index >= count.ceil()
        {
            break;
        }
        let iteration_start_ms = delay_ms + iteration_index * source.spec.duration_ms;
        if iteration_start_ms >= playback.duration_ms {
            break;
        }
        let iteration_progress_limit =
            source_iteration_count.map_or(1.0, |count| (count - iteration_index).clamp(0.0, 1.0));
        let iteration_end_ms =
            iteration_start_ms + iteration_progress_limit * source.spec.duration_ms;
        if iteration_end_ms > 0.0 {
            visit_iteration_boundaries(
                source,
                iteration_start_ms,
                iteration_progress_limit,
                playback,
                resolved_easing,
                &mut |boundary| {
                    visit_distinct_boundary(&mut previous_boundary, boundary, playback, visitor)
                },
            )?;
        }
        let next_iteration_index = iteration_index + 1.0;
        if next_iteration_index == iteration_index {
            return Err(timeline_precision_error(
                "f32-order",
                iteration_start_ms.max(0.0),
                iteration_start_ms.max(0.0),
            ));
        }
        iteration_index = next_iteration_index;
    }
    visit_distinct_boundary(
        &mut previous_boundary,
        playback.duration_ms,
        playback,
        visitor,
    )
}

fn collect_boundaries(
    source: &TrackSource,
    playback: DocumentPlayback,
    resolved_easing: ResolvedEasing,
) -> Result<Vec<f64>, EngineError> {
    let mut boundaries = Vec::new();
    visit_track_boundaries_with(source, playback, resolved_easing, &mut |boundary| {
        boundaries.push(boundary);
        Ok(())
    })?;
    Ok(boundaries)
}

fn function_piece(
    source: &TrackSource,
    start_ms: f64,
    end_ms: f64,
    resolved_easing: ResolvedEasing,
) -> Result<FunctionPiece, EngineError> {
    let midpoint_ms = f64::midpoint(start_ms, end_ms);
    let delay_ms = source.spec.delay_ms.unwrap_or(0.0);
    let active_time_ms = midpoint_ms - delay_ms;
    let source_iteration_count = source_iterations(&source.spec);
    let after_active = source_iteration_count
        .is_some_and(|count| active_time_ms >= source.spec.duration_ms * count);
    if active_time_ms < 0.0 || after_active {
        let value = exact_track_value(source, midpoint_ms)?;
        return Ok(FunctionPiece {
            start_ms,
            end_ms,
            start_value: value.clone(),
            end_value: value,
            easing: PieceEasing::Constant,
        });
    }

    let iteration_position = active_time_ms / source.spec.duration_ms;
    let iteration_index = iteration_position.floor();
    let midpoint_progress = iteration_position - iteration_index;
    let Some(segment_index) = keyframe_segment_index(&source.spec.keyframes, midpoint_progress)
    else {
        let value = exact_track_value(source, midpoint_ms)?;
        return Ok(FunctionPiece {
            start_ms,
            end_ms,
            start_value: value.clone(),
            end_value: value,
            easing: PieceEasing::Constant,
        });
    };
    let from = &source.spec.keyframes[segment_index];
    let to = &source.spec.keyframes[segment_index + 1];
    let iteration_start_ms = delay_ms + iteration_index * source.spec.duration_ms;
    let progress_at = |time_ms: f64| {
        ((time_ms - iteration_start_ms) / source.spec.duration_ms - from.at) / (to.at - from.at)
    };
    let input_start = progress_at(start_ms).clamp(0.0, 1.0);
    let input_end = progress_at(end_ms).clamp(0.0, 1.0);
    match resolved_easing {
        ResolvedEasing::Steps { .. } => {
            let value = evaluate_segment(
                &source.spec,
                segment_index,
                progress_at(midpoint_ms),
                resolved_easing,
            );
            Ok(FunctionPiece {
                start_ms,
                end_ms,
                start_value: value.clone(),
                end_value: value,
                easing: PieceEasing::Constant,
            })
        }
        ResolvedEasing::Cubic(curve) => {
            let start_value =
                evaluate_segment(&source.spec, segment_index, input_start, resolved_easing);
            let end_value =
                evaluate_segment(&source.spec, segment_index, input_end, resolved_easing);
            let midpoint_value = evaluate_segment(
                &source.spec,
                segment_index,
                progress_at(midpoint_ms),
                resolved_easing,
            );
            if start_value.approximately_equals(&end_value)
                && start_value.approximately_equals(&midpoint_value)
            {
                return Ok(FunctionPiece {
                    start_ms,
                    end_ms,
                    start_value: start_value.clone(),
                    end_value: start_value,
                    easing: PieceEasing::Constant,
                });
            }
            if curve == [0.0, 0.0, 1.0, 1.0] {
                return Ok(FunctionPiece {
                    start_ms,
                    end_ms,
                    start_value,
                    end_value,
                    easing: PieceEasing::Linear,
                });
            }
            let Some(subcurve) = cubic_subcurve(curve, input_start, input_end) else {
                return Err(timeline_unrepresentable(
                    source,
                    "cubic-subcurve-unrepresentable",
                    end_ms,
                    None,
                ));
            };
            Ok(FunctionPiece {
                start_ms,
                end_ms,
                start_value,
                end_value,
                easing: PieceEasing::CubicBezier(subcurve),
            })
        }
        ResolvedEasing::Spring { .. } => Err(timeline_unrepresentable(
            source,
            "spring-easing",
            start_ms,
            Some("Use playback mode independent for this animation track."),
        )),
    }
}

fn output_scaled_alpha(
    source: &TrackSource,
    start: &TrackValue,
    left: &TrackValue,
    right: &TrackValue,
    boundary_time_ms: f64,
) -> Result<f64, EngineError> {
    let start_channels = start.channel_values();
    let left_channels = left.channel_values();
    let right_channels = right.channel_values();
    let mut resolved_alpha = None;
    for ((start_value, left_value), right_value) in start_channels
        .into_iter()
        .zip(left_channels)
        .zip(right_channels)
    {
        if start_value == left_value && start_value == right_value {
            continue;
        }
        let delta = right_value - start_value;
        if delta == 0.0 {
            return Err(timeline_unrepresentable(
                source,
                "zero-delta-jump",
                boundary_time_ms,
                None,
            ));
        }
        let numerator = left_value - start_value;
        if !delta.is_finite() || !numerator.is_finite() {
            return Err(timeline_unrepresentable(
                source,
                "linear-jump-unrepresentable",
                boundary_time_ms,
                None,
            ));
        }
        let alpha = numerator / delta;
        if !alpha.is_finite() {
            return Err(timeline_unrepresentable(
                source,
                "linear-jump-unrepresentable",
                boundary_time_ms,
                None,
            ));
        }
        if let Some(expected_alpha) = resolved_alpha
            && alpha != expected_alpha
        {
            return Err(timeline_unrepresentable(
                source,
                "mixed-channel-jump",
                boundary_time_ms,
                None,
            ));
        }
        resolved_alpha = Some(alpha);
    }
    Ok(resolved_alpha.unwrap_or(0.0))
}

fn compile_piece_easing(
    source: &TrackSource,
    piece: &FunctionPiece,
    right_value: &TrackValue,
) -> Result<CompiledCssEasing, EngineError> {
    let has_jump = piece.end_value != *right_value;
    match (&piece.easing, has_jump) {
        (PieceEasing::Constant, _) => Ok(CompiledCssEasing::StepEnd),
        (PieceEasing::Linear, false) => Ok(CompiledCssEasing::Linear),
        (PieceEasing::Linear, true) => {
            Ok(CompiledCssEasing::OutputScaledLinear(output_scaled_alpha(
                source,
                &piece.start_value,
                &piece.end_value,
                right_value,
                piece.end_ms,
            )?))
        }
        (PieceEasing::CubicBezier(curve), false) => Ok(CompiledCssEasing::CubicBezier(*curve)),
        (PieceEasing::CubicBezier(_), true) => Err(timeline_unrepresentable(
            source,
            "cubic-into-jump",
            piece.end_ms,
            None,
        )),
    }
}

#[cfg(test)]
fn precision_preflight(
    keyframes: &[DocumentKeyframe],
    playback: DocumentPlayback,
) -> Result<(), EngineError> {
    let mut state = PrecisionPreflightState::new(playback);
    for keyframe in keyframes {
        state.visit(keyframe.time_ms)?;
    }
    Ok(())
}

struct PrecisionPreflightState {
    playback: DocumentPlayback,
    minimum_separation_ms: f64,
    previous: Option<(f64, f32, String)>,
}

impl PrecisionPreflightState {
    fn new(playback: DocumentPlayback) -> Self {
        Self {
            playback,
            minimum_separation_ms: 4.0 * playback.delta_ms().max(0.001),
            previous: None,
        }
    }

    fn visit(&mut self, time_ms: f64) -> Result<(), EngineError> {
        let normalized = time_ms / self.playback.duration_ms;
        #[expect(
            clippy::cast_possible_truncation,
            reason = "the contract explicitly preflights browser binary32 keyframe offsets"
        )]
        let normalized_f32 = normalized as f32;
        let selector = format_js_number(normalized * 100.0);
        if let Some((previous_time_ms, previous_normalized_f32, previous_selector)) = &self.previous
        {
            if normalized_f32 <= *previous_normalized_f32 {
                return Err(timeline_precision_error(
                    "f32-order",
                    *previous_time_ms,
                    time_ms,
                ));
            }
            if time_ms - *previous_time_ms < self.minimum_separation_ms {
                return Err(timeline_precision_error(
                    "separation",
                    *previous_time_ms,
                    time_ms,
                ));
            }
            if selector == *previous_selector {
                return Err(timeline_precision_error(
                    "selector-collision",
                    *previous_time_ms,
                    time_ms,
                ));
            }
        }
        self.previous = Some((time_ms, normalized_f32, selector));
        Ok(())
    }
}

fn resolve_track_easing(
    source: &TrackSource,
    playback: DocumentPlayback,
) -> Result<ResolvedEasing, EngineError> {
    if let Some(boundary_time_ms) = base_transition_time_ms(source, playback)
        && source
            .base_value
            .transform
            .as_ref()
            .is_some_and(|transform| {
                [
                    transform.translate_x,
                    transform.translate_y,
                    transform.scale_x,
                    transform.scale_y,
                    transform.rotate_deg,
                ]
                .into_iter()
                .flatten()
                .any(|value| !value.is_finite())
            })
    {
        return Err(timeline_unrepresentable(
            source,
            "base-transition-unrepresentable",
            boundary_time_ms,
            None,
        ));
    }
    let resolved_easing = animation::resolve_easing(source.spec.easing.as_ref(), &source.owner_id)?;
    if matches!(resolved_easing, ResolvedEasing::Spring { .. }) {
        return Err(timeline_unrepresentable(
            source,
            "spring-easing",
            0.0,
            Some("Use playback mode independent for this animation track."),
        ));
    }
    Ok(resolved_easing)
}

fn selected_representability_iterations(
    source: &TrackSource,
    playback: DocumentPlayback,
) -> Vec<f64> {
    if spec_values_are_constant(&source.spec) {
        return Vec::new();
    }
    let delay_ms = source.spec.delay_ms.unwrap_or(0.0);
    let first_iteration = ((-delay_ms) / source.spec.duration_ms).floor().max(0.0);
    let active_end_ms = source_iterations(&source.spec).map_or(playback.duration_ms, |count| {
        delay_ms + count * source.spec.duration_ms
    });
    let visible_end_ms = active_end_ms.min(playback.duration_ms);
    if !first_iteration.is_finite() || visible_end_ms <= 0.0 || delay_ms >= playback.duration_ms {
        return Vec::new();
    }
    let end_position = (visible_end_ms - delay_ms) / source.spec.duration_ms;
    if !end_position.is_finite() || end_position <= first_iteration {
        return Vec::new();
    }
    let last_iteration = previous_f64(end_position).floor().max(first_iteration);
    // Authored iterations repeat exactly. The visible head, the first complete
    // successor (when present), and the visible tail cover every distinct
    // authored interval plus the earliest seam and both document cuts.
    let mut iterations = vec![first_iteration];
    let second_iteration = first_iteration + 1.0;
    if second_iteration > first_iteration && second_iteration <= last_iteration {
        iterations.push(second_iteration);
    }
    if last_iteration > first_iteration {
        iterations.push(last_iteration);
    }
    iterations.sort_by(f64::total_cmp);
    iterations.dedup_by(|left, right| *left == *right);
    iterations
}

fn representability_preflight(
    source: &TrackSource,
    playback: DocumentPlayback,
    resolved_easing: ResolvedEasing,
) -> Result<(), EngineError> {
    if !matches!(resolved_easing, ResolvedEasing::Steps { .. }) {
        let delay_ms = source.spec.delay_ms.unwrap_or(0.0);
        let source_iteration_count = source_iterations(&source.spec);
        for iteration_index in selected_representability_iterations(source, playback) {
            let iteration_start_ms = delay_ms + iteration_index * source.spec.duration_ms;
            let iteration_progress_limit = source_iteration_count
                .map_or(1.0, |count| (count - iteration_index).clamp(0.0, 1.0));
            let mut boundaries = Vec::new();
            visit_iteration_boundaries(
                source,
                iteration_start_ms,
                iteration_progress_limit,
                playback,
                resolved_easing,
                &mut |boundary| {
                    boundaries.push(boundary);
                    Ok(())
                },
            )?;
            boundaries.sort_by(f64::total_cmp);
            boundaries.dedup_by(|left, right| *left == *right);
            for pair in boundaries.windows(2) {
                let [start_ms, end_ms] = pair else {
                    continue;
                };
                if end_ms <= start_ms {
                    continue;
                }
                let piece = function_piece(source, *start_ms, *end_ms, resolved_easing)?;
                let right_value = exact_track_value(source, *end_ms)?;
                compile_piece_easing(source, &piece, &right_value)?;
            }
        }
    }

    if let Some(boundary_time_ms) = final_hold_discontinuity(source, playback, resolved_easing)? {
        return Err(timeline_unrepresentable(
            source,
            "final-hold-on-discontinuity",
            boundary_time_ms,
            None,
        ));
    }
    Ok(())
}

fn push_nearby_step_boundaries(
    candidates: &mut Vec<f64>,
    source: &TrackSource,
    iteration_index: f64,
    iteration_progress_limit: f64,
    target_progress: f64,
    count: f64,
) {
    let delay_ms = source.spec.delay_ms.unwrap_or(0.0);
    let iteration_start_ms = delay_ms + iteration_index * source.spec.duration_ms;
    for pair in source.spec.keyframes.windows(2) {
        let segment_start = pair[0].at;
        let segment_end = pair[1].at;
        let visible_segment_end = segment_end.min(iteration_progress_limit);
        if visible_segment_end <= segment_start {
            continue;
        }
        let segment_span = segment_end - segment_start;
        let target_step =
            ((target_progress - segment_start) / segment_span * count).clamp(0.0, count);
        let floor_step = target_step.floor();
        for step_index in [
            floor_step - 1.0,
            floor_step,
            target_step.ceil(),
            target_step.ceil() + 1.0,
        ] {
            if step_index <= 0.0 || step_index >= count {
                continue;
            }
            let progress = segment_start + (step_index / count) * segment_span;
            if progress < visible_segment_end {
                candidates.push(iteration_start_ms + progress * source.spec.duration_ms);
            }
        }
    }
}

fn final_hold_discontinuity(
    source: &TrackSource,
    playback: DocumentPlayback,
    resolved_easing: ResolvedEasing,
) -> Result<Option<f64>, EngineError> {
    let DocumentIterationCount::Finite(iterations) = playback.iterations else {
        return Ok(None);
    };
    let fraction = iterations.fract();
    if fraction == 0.0 {
        return Ok(None);
    }
    let hold_time_ms = fraction * playback.duration_ms;
    let delta_ms = playback.delta_ms();
    let exact_start = exact_track_value(source, 0.0)?;
    let exact_end = exact_track_value(source, playback.duration_ms)?;
    if exact_start != exact_end && hold_time_ms < delta_ms {
        return Ok(Some(0.0));
    }

    let delay_ms = source.spec.delay_ms.unwrap_or(0.0);
    let mut candidates = vec![0.0, playback.duration_ms, delay_ms];
    if let Some(count) = source_iterations(&source.spec) {
        candidates.push(delay_ms + count * source.spec.duration_ms);
    }
    if !spec_values_are_constant(&source.spec) {
        let target_position = (hold_time_ms - delay_ms) / source.spec.duration_ms;
        let target_iteration = target_position.floor();
        let pattern = local_boundary_pattern(&source.spec, resolved_easing);
        for iteration_index in [
            (target_iteration - 1.0).max(0.0),
            target_iteration.max(0.0),
            (target_iteration + 1.0).max(0.0),
        ] {
            if let Some(count) = source_iterations(&source.spec)
                && iteration_index >= count.ceil()
            {
                continue;
            }
            let iteration_progress_limit = source_iterations(&source.spec)
                .map_or(1.0, |count| (count - iteration_index).clamp(0.0, 1.0));
            if iteration_progress_limit <= 0.0 {
                continue;
            }
            let iteration_start_ms = delay_ms + iteration_index * source.spec.duration_ms;
            for progress in pattern
                .fixed_offsets
                .iter()
                .copied()
                .chain(std::iter::once(iteration_progress_limit))
            {
                if progress <= iteration_progress_limit {
                    candidates.push(iteration_start_ms + progress * source.spec.duration_ms);
                }
            }
            if let ResolvedEasing::Steps { count, .. } = resolved_easing {
                push_nearby_step_boundaries(
                    &mut candidates,
                    source,
                    iteration_index,
                    iteration_progress_limit,
                    target_position - iteration_index,
                    count,
                );
            }
        }
    }

    candidates.retain(|candidate| {
        candidate.is_finite() && *candidate >= 0.0 && *candidate <= playback.duration_ms
    });
    candidates.sort_by(f64::total_cmp);
    candidates.dedup_by(|left, right| *left == *right);
    let mut discontinuities = Vec::new();
    for candidate in candidates {
        if candidate == 0.0 {
            continue;
        }
        let left_value = exact_track_value(source, previous_f64(candidate))?;
        let right_value = exact_track_value(source, candidate)?;
        if left_value.approximately_equals(&right_value) {
            continue;
        }
        discontinuities.push(if candidate == playback.duration_ms {
            0.0
        } else {
            candidate
        });
    }
    discontinuities.sort_by(f64::total_cmp);
    discontinuities.dedup_by(|left, right| *left == *right);
    Ok(discontinuities
        .into_iter()
        .find(|boundary| (hold_time_ms - boundary).abs() < delta_ms))
}

fn compile_track(
    source: &TrackSource,
    playback: DocumentPlayback,
    resolved_easing: ResolvedEasing,
) -> Result<DocumentTrackPlan, EngineError> {
    #[cfg(test)]
    COMPILE_TRACK_TRACE
        .lock()
        .expect("compile track trace should not be poisoned")
        .entry(std::thread::current().id())
        .or_default()
        .push(source.owner_id.clone());

    let boundaries = collect_boundaries(source, playback, resolved_easing)?;
    let mut pieces = Vec::with_capacity(boundaries.len().saturating_sub(1));
    for pair in boundaries.windows(2) {
        let [start_ms, end_ms] = pair else {
            continue;
        };
        if end_ms > start_ms {
            pieces.push(function_piece(source, *start_ms, *end_ms, resolved_easing)?);
        }
    }
    if pieces.is_empty() {
        return Err(timeline_precision_error(
            "f32-order",
            0.0,
            playback.duration_ms,
        ));
    }
    let exact_start = exact_track_value(source, 0.0)?;
    let exact_end = exact_track_value(source, playback.duration_ms)?;
    let mut keyframes = vec![DocumentKeyframe {
        time_ms: 0.0,
        value: exact_start.to_keyframe(),
        easing_to_next: None,
    }];
    let mut discontinuities_ms = Vec::new();
    for (piece_index, piece) in pieces.iter().enumerate() {
        let right_value = pieces.get(piece_index + 1).map_or_else(
            || exact_end.clone(),
            |next_piece| next_piece.start_value.clone(),
        );
        if piece.end_value != right_value {
            discontinuities_ms.push(if piece.end_ms == playback.duration_ms {
                0.0
            } else {
                piece.end_ms
            });
        }
        let easing = compile_piece_easing(source, piece, &right_value)?;
        if let Some(previous_keyframe) = keyframes.last_mut() {
            previous_keyframe.easing_to_next = Some(easing);
        }
        keyframes.push(DocumentKeyframe {
            time_ms: piece.end_ms,
            value: right_value.to_keyframe(),
            easing_to_next: None,
        });
    }
    if exact_start != exact_end {
        discontinuities_ms.push(0.0);
    }
    discontinuities_ms.sort_by(f64::total_cmp);
    discontinuities_ms.dedup_by(|left, right| same_time(*left, *right));
    Ok(DocumentTrackPlan {
        owner_kind: source.owner_kind,
        owner_id: source.owner_id.clone(),
        unit_id: source.unit_id.clone(),
        animation_name_owner: source.animation_name_owner.clone(),
        bbox: source.bbox,
        keyframes,
        discontinuities_ms,
    })
}

fn steps_track_precision_is_guaranteed(
    source: &TrackSource,
    playback: DocumentPlayback,
    resolved_easing: ResolvedEasing,
) -> bool {
    if spec_values_are_constant(&source.spec) {
        return false;
    }
    let ResolvedEasing::Steps { .. } = resolved_easing else {
        return false;
    };
    let delay_ms = source.spec.delay_ms.unwrap_or(0.0);
    let active_start_ms = delay_ms.max(0.0).min(playback.duration_ms);
    let active_end_ms = source_iterations(&source.spec)
        .map_or(playback.duration_ms, |iterations| {
            (delay_ms + iterations * source.spec.duration_ms).min(playback.duration_ms)
        });
    if active_end_ms <= active_start_ms {
        return true;
    }
    let source_start = (active_start_ms - delay_ms) / source.spec.duration_ms;
    let source_end = (active_end_ms - delay_ms) / source.spec.duration_ms;
    if !source_start.is_finite()
        || !source_end.is_finite()
        || source_start.fract() != 0.0
        || source_end.fract() != 0.0
    {
        return false;
    }
    let Some(local_gap) =
        local_boundary_pattern(&source.spec, resolved_easing).minimum_full_iteration_gap()
    else {
        return false;
    };
    let minimum_separation_ms = 4.0 * playback.delta_ms().max(0.001);
    let mut minimum_gap_ms = local_gap * source.spec.duration_ms;
    if active_start_ms > 0.0 {
        minimum_gap_ms = minimum_gap_ms.min(active_start_ms);
    }
    if active_end_ms < playback.duration_ms {
        minimum_gap_ms = minimum_gap_ms.min(playback.duration_ms - active_end_ms);
    }
    minimum_gap_ms >= minimum_separation_ms
}

fn saturating_finite_stop_count(left: f64, right: f64) -> f64 {
    let sum = left + right;
    if sum.is_finite() { sum } else { f64::MAX }
}

#[derive(Debug, Clone, Copy)]
struct TrackAnalysis {
    // Representation is proven from bounded head/pattern/tail windows. The
    // precision pass then streams offsets, and budget failure precedes the
    // only DocumentTrackPlan expansion.
    resolved_easing: ResolvedEasing,
}

fn precision_preflight_track(
    source: &TrackSource,
    playback: DocumentPlayback,
    resolved_easing: ResolvedEasing,
) -> Result<(), EngineError> {
    if steps_track_precision_is_guaranteed(source, playback, resolved_easing) {
        return Ok(());
    }
    let mut state = PrecisionPreflightState::new(playback);
    visit_track_boundaries_with(source, playback, resolved_easing, &mut |boundary| {
        state.visit(boundary)
    })
}

fn analyzed_track_stop_count(
    source: &TrackSource,
    playback: DocumentPlayback,
    resolved_easing: ResolvedEasing,
) -> Result<f64, EngineError> {
    if matches!(resolved_easing, ResolvedEasing::Steps { .. }) {
        return Ok(semantic_track_stop_count(source, playback, resolved_easing));
    }
    let mut stop_count = 0.0;
    visit_track_boundaries_with(source, playback, resolved_easing, &mut |_| {
        stop_count = saturating_finite_stop_count(stop_count, 1.0);
        Ok(())
    })?;
    Ok(stop_count)
}

fn preflight_document_tracks(
    sources: &[TrackSource],
    playback: DocumentPlayback,
) -> Result<(Vec<TrackAnalysis>, f64), EngineError> {
    let mut analyses = Vec::with_capacity(sources.len());
    for source in sources {
        let resolved_easing = resolve_track_easing(source, playback)?;
        representability_preflight(source, playback, resolved_easing)?;
        analyses.push(TrackAnalysis { resolved_easing });
    }

    for (source, analysis) in sources.iter().zip(&analyses) {
        precision_preflight_track(source, playback, analysis.resolved_easing)?;
    }

    let mut stop_count = 0.0;
    for (source, analysis) in sources.iter().zip(&analyses) {
        let track_stop_count =
            analyzed_track_stop_count(source, playback, analysis.resolved_easing)?;
        stop_count = saturating_finite_stop_count(stop_count, track_stop_count);
    }
    if stop_count > MAX_TIMELINE_KEYFRAME_STOPS as f64 {
        return Err(timeline_limit_error(
            "keyframeStops",
            stop_count,
            MAX_TIMELINE_KEYFRAME_STOPS,
        ));
    }
    Ok((analyses, stop_count))
}

#[cfg(test)]
fn compile_document_animation_plan(
    ir: &Ir,
    playback: DocumentPlayback,
    time_ms: f64,
) -> Result<DocumentAnimationPlan, EngineError> {
    compile_document_animation_plan_with_prefix(ir, playback, time_ms, "", false)
}

/// Compile and byte-budget every document track using the caller's SVG
/// identifier namespace.
///
/// # Errors
///
/// Returns the first deterministic validation, representability, precision,
/// or budget failure in pipeline order.
pub fn compile_document_animation_plan_with_prefix(
    ir: &Ir,
    playback: DocumentPlayback,
    time_ms: f64,
    resource_id_prefix: &str,
    include_reduced_motion: bool,
) -> Result<DocumentAnimationPlan, EngineError> {
    validate_document_playback(playback, time_ms)?;
    animation::validate_animations(ir)?;
    let timing = playback.css_timing(time_ms);
    let mut sources = Vec::new();
    collect_track_sources(&ir.root, &mut sources);
    let (analyses, preflight_stop_count) = preflight_document_tracks(&sources, playback)?;
    let mut tracks = Vec::with_capacity(sources.len());
    for (source, analysis) in sources.iter().zip(analyses) {
        let track = compile_track(source, playback, analysis.resolved_easing)?;
        tracks.push(track);
    }
    let keyframe_stop_count = tracks.iter().try_fold(0_usize, |count, track| {
        count.checked_add(track.keyframes.len()).ok_or_else(|| {
            timeline_limit_error("keyframeStops", f64::MAX, MAX_TIMELINE_KEYFRAME_STOPS)
        })
    })?;
    debug_assert_eq!(keyframe_stop_count as f64, preflight_stop_count);
    if keyframe_stop_count > MAX_TIMELINE_KEYFRAME_STOPS {
        return Err(timeline_limit_error(
            "keyframeStops",
            keyframe_stop_count as f64,
            MAX_TIMELINE_KEYFRAME_STOPS,
        ));
    }
    let mut plan = DocumentAnimationPlan {
        duration_ms: playback.duration_ms,
        css_iteration_count: timing.iterations,
        css_delay_ms: timing.delay_ms,
        final_hold: timing.final_hold,
        tracks,
        keyframe_stop_count,
        exact_css_bytes: 0,
    };
    plan.exact_css_bytes = crate::svg_emit::emitter::timeline_plan_css_byte_count(
        &plan,
        resource_id_prefix,
        include_reduced_motion,
    )?;
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::types::{AnimationEasing, AnimationSpring, AnimationSteps};

    fn timeline_ir(spec: AnimationSpec) -> Ir {
        Ir {
            root: IrNode {
                node_id: "animated-node".to_string(),
                bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
                kind: IrNodeKind::Group {
                    children: Vec::new(),
                    clip_path: None,
                    clip_border_radius: None,
                    opacity: Some(0.25),
                    box_shadow: None,
                    meta: None,
                    transform: None,
                    animation: Some(spec),
                    on: None,
                },
            },
            draw_order: Vec::new(),
            width: 100.0,
            height: 50.0,
            debug: None,
            warnings: Vec::new(),
        }
    }

    fn animated_group(node_id: &str, spec: AnimationSpec) -> IrNode {
        IrNode {
            node_id: node_id.to_string(),
            bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
            kind: IrNodeKind::Group {
                children: Vec::new(),
                clip_path: None,
                clip_border_radius: None,
                opacity: Some(0.25),
                box_shadow: None,
                meta: None,
                transform: None,
                animation: Some(spec),
                on: None,
            },
        }
    }

    fn animated_text_unit(node_id: &str, unit_id: &str, spec: &AnimationSpec) -> IrNode {
        serde_json::from_value(json!({
            "nodeId": node_id,
            "bbox": { "x": 0.0, "y": 0.0, "w": 100.0, "h": 20.0 },
            "type": "text",
            "lines": [],
            "font": "Fixture",
            "fontSizePx": 16.0,
            "color": "#000000",
            "textAlign": "start",
            "layoutBox": { "x": 0.0, "y": 0.0, "w": 100.0, "h": 20.0 },
            "lineHeightPx": 20.0,
            "glyphPaths": [],
            "unitMap": {
                "kind": "cluster",
                "ruby": "with-base",
                "units": [{
                    "unitId": unit_id,
                    "kind": "cluster",
                    "sourceStart": 0,
                    "sourceEnd": 1,
                    "lineId": "line-0",
                    "logicalOrder": 0,
                    "visualOrder": 0,
                    "members": []
                }]
            },
            "unitAnimation": {
                "by": "cluster",
                "animation": spec,
                "delayStepMs": 0.0,
                "order": "logical"
            },
            "unitAnimationSamples": [{
                "unitId": unit_id,
                "bbox": { "x": 0.0, "y": 0.0, "w": 10.0, "h": 20.0 }
            }]
        }))
        .expect("text-unit fixture should deserialize")
    }

    fn opacity_spec(easing: AnimationEasing) -> AnimationSpec {
        AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(0.0),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(1.0),
                    transform: None,
                },
            ],
            duration_ms: 100.0,
            delay_ms: Some(20.0),
            easing: Some(easing),
            iterations: Some(AnimationIterations::Infinite("infinite".to_string())),
            fill: Some("both".to_string()),
        }
    }

    fn infinite_playback() -> DocumentPlayback {
        DocumentPlayback {
            duration_ms: 200.0,
            iterations: DocumentIterationCount::Infinite,
        }
    }

    fn representable_linear_spec() -> AnimationSpec {
        let mut spec = opacity_spec(AnimationEasing::Named("linear".to_string()));
        spec.iterations = Some(AnimationIterations::Count(1.0));
        spec.fill = Some("none".to_string());
        spec
    }

    fn finite_playback(iterations: f64) -> DocumentPlayback {
        DocumentPlayback {
            duration_ms: 200.0,
            iterations: DocumentIterationCount::Finite(iterations),
        }
    }

    #[test]
    fn maps_the_full_document_time_domain_to_the_authored_sampler() {
        let finite = finite_playback(2.5);
        assert_eq!(finite.authored_sample_time_ms(0.0), 0.0);
        assert_eq!(finite.authored_sample_time_ms(150.0), 150.0);
        assert_eq!(finite.authored_sample_time_ms(450.0), 50.0);
        assert_eq!(finite.authored_sample_time_ms(500.0), 100.0);
        assert_eq!(finite.authored_sample_time_ms(700.0), 100.0);

        let integer = finite_playback(2.0);
        assert_eq!(integer.authored_sample_time_ms(400.0), 200.0);
        assert_eq!(integer.authored_sample_time_ms(700.0), 200.0);

        let infinite = DocumentPlayback {
            duration_ms: 200.0,
            iterations: DocumentIterationCount::Infinite,
        };
        assert_eq!(infinite.authored_sample_time_ms(600.0), 0.0);
        assert_eq!(infinite.authored_sample_time_ms(650.0), 50.0);
    }

    #[test]
    fn document_sampler_property_matches_the_closed_form_domain_table() {
        for duration_ms in [1.0, 200.0, 31_415.926_535, 1_000_000.0] {
            for iterations in [
                DocumentIterationCount::Infinite,
                DocumentIterationCount::Finite(0.25),
                DocumentIterationCount::Finite(1.0),
                DocumentIterationCount::Finite(2.75),
                DocumentIterationCount::Finite(8.0),
            ] {
                let playback = DocumentPlayback {
                    duration_ms,
                    iterations,
                };
                for sample_index in 0..=80 {
                    let time_ms = f64::from(sample_index) * duration_ms / 7.0;
                    let expected = match iterations {
                        DocumentIterationCount::Finite(count) if time_ms >= count * duration_ms => {
                            let fraction = count.fract();
                            if fraction == 0.0 {
                                duration_ms
                            } else {
                                fraction * duration_ms
                            }
                        }
                        _ if sample_index % 7 == 0 => 0.0,
                        _ => time_ms % duration_ms,
                    };
                    let observed = playback.authored_sample_time_ms(time_ms);
                    let tolerance =
                        f64::EPSILON * expected.abs().max(observed.abs()).max(duration_ms) * 32.0;
                    assert!(
                        (observed - expected).abs() <= tolerance,
                        "D={duration_ms}, iterations={iterations:?}, time={time_ms}, expected={expected}, observed={observed}"
                    );
                    let css_timing = playback.css_timing(time_ms);
                    assert!(css_timing.delay_ms <= 0.0);
                    assert!(css_timing.delay_ms >= -duration_ms);
                    if let CssIterationCount::Finite(count) = css_timing.iterations {
                        assert!(count > 0.0);
                    }
                }
            }
        }
    }

    #[test]
    fn derives_bounded_delay_for_active_playback() {
        assert_eq!(
            finite_playback(3.5).css_timing(450.0),
            DocumentCssTiming {
                delay_ms: -50.0,
                iterations: CssIterationCount::Finite(1.5),
                final_hold: false,
            }
        );
        let infinite = DocumentPlayback {
            duration_ms: 200.0,
            iterations: DocumentIterationCount::Infinite,
        };
        assert_eq!(
            infinite.css_timing(600.0),
            DocumentCssTiming {
                delay_ms: -0.0,
                iterations: CssIterationCount::Infinite,
                final_hold: false,
            }
        );
    }

    #[test]
    fn derives_time_independent_final_hold_timing() {
        for time_ms in [500.0, 500.001, 700.0] {
            assert_eq!(
                finite_playback(2.5).css_timing(time_ms),
                DocumentCssTiming {
                    delay_ms: -100.0,
                    iterations: CssIterationCount::Finite(0.5),
                    final_hold: true,
                }
            );
        }
        for time_ms in [400.0, 400.001, 700.0] {
            assert_eq!(
                finite_playback(2.0).css_timing(time_ms),
                DocumentCssTiming {
                    delay_ms: -200.0,
                    iterations: CssIterationCount::Finite(1.0),
                    final_hold: true,
                }
            );
        }
    }

    #[test]
    fn rejects_invalid_ranges_in_pipeline_order() {
        let invalid_duration = DocumentPlayback {
            duration_ms: 0.0,
            iterations: DocumentIterationCount::Finite(1.0),
        };
        assert!(matches!(
            validate_document_playback(invalid_duration, 0.0),
            Err(EngineError::StructuredContext { ref code, .. })
                if code == "ANIMATED_SVG_INVALID_TIMELINE"
        ));

        let invalid_iterations = DocumentPlayback {
            duration_ms: 200.0,
            iterations: DocumentIterationCount::Finite(MAX_TIMELINE_ITERATIONS + 1.0),
        };
        assert!(matches!(
            validate_document_playback(invalid_iterations, 0.0),
            Err(EngineError::StructuredContext { ref code, .. })
                if code == "ANIMATED_SVG_INVALID_TIMELINE"
        ));

        assert!(matches!(
            validate_document_playback(finite_playback(1.0), -1.0),
            Err(EngineError::StructuredContext { ref code, .. })
                if code == "ANIMATED_SVG_INVALID_TIMELINE"
        ));

        let error = validate_document_playback(invalid_duration, 0.0)
            .expect_err("duration should retain its wire context");
        let EngineError::StructuredContext { context, stage, .. } = error else {
            panic!("duration should produce timeline context");
        };
        assert_eq!(stage.as_deref(), Some("validate"));
        assert_eq!(
            *context,
            json!({
                "field": "durationMs",
                "received": "0",
            })
        );
    }

    #[test]
    fn rejects_a_document_time_ratio_that_loses_cycle_precision() {
        let playback = DocumentPlayback {
            duration_ms: 1.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let error = validate_document_playback(playback, MAX_TIMELINE_TIME_RATIO + 1.0)
            .expect_err("ratio should fail");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("expected structured timeline error");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_PRECISION_LOSS");
        assert_eq!(context["kind"], "time-ratio");
    }

    #[test]
    fn compiles_linear_iteration_jumps_with_output_scaled_linear() {
        let plan = compile_document_animation_plan(
            &timeline_ir(representable_linear_spec()),
            infinite_playback(),
            0.0,
        )
        .expect("linear timeline should compile");
        let track = &plan.tracks[0];
        let seam = track
            .keyframes
            .iter()
            .position(|keyframe| same_time(keyframe.time_ms, 120.0))
            .expect("iteration seam should be present");
        assert!(matches!(
            track.keyframes[seam - 1].easing_to_next,
            Some(CompiledCssEasing::OutputScaledLinear(_))
        ));
        assert!(
            track
                .discontinuities_ms
                .iter()
                .any(|time_ms| same_time(*time_ms, 120.0))
        );
    }

    #[test]
    fn rejects_non_finite_output_scaled_linear_easing() {
        let mut source = timeline_ir(representable_linear_spec());
        let IrNodeKind::Group { opacity, .. } = &mut source.root.kind else {
            panic!("group fixture expected");
        };
        *opacity = Some(f64::from_bits(1));

        let error = compile_document_animation_plan(&source, infinite_playback(), 0.0)
            .expect_err("timeline CSS must not contain a non-finite linear easing value");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("non-finite output scaling should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
        assert_eq!(context["reason"], "linear-jump-unrepresentable");
        assert_eq!(context["boundaryTimeMs"], 120.0);
    }

    #[test]
    fn expands_steps_to_piecewise_constant_intervals() {
        let mut spec = opacity_spec(AnimationEasing::Steps(AnimationSteps {
            kind: "steps".to_string(),
            count: 4.0,
            position: Some("jump-end".to_string()),
        }));
        spec.duration_ms = 200.0;
        spec.delay_ms = Some(0.0);
        let plan = compile_document_animation_plan(&timeline_ir(spec), infinite_playback(), 0.0)
            .expect("steps timeline should compile");
        let track = &plan.tracks[0];
        assert_eq!(
            track
                .keyframes
                .iter()
                .map(|keyframe| keyframe.time_ms)
                .collect::<Vec<_>>(),
            vec![0.0, 50.0, 100.0, 150.0, 200.0]
        );
        assert!(
            track.keyframes[..4].iter().all(|keyframe| matches!(
                keyframe.easing_to_next,
                Some(CompiledCssEasing::StepEnd)
            ))
        );
    }

    #[test]
    fn cuts_a_cubic_curve_at_the_document_end() {
        let mut spec = opacity_spec(AnimationEasing::CubicBezier([0.3, 1.6, 0.7, 1.4]));
        spec.duration_ms = 200.0;
        spec.delay_ms = Some(120.0);
        spec.iterations = Some(AnimationIterations::Count(1.0));
        let plan = compile_document_animation_plan(&timeline_ir(spec), infinite_playback(), 0.0)
            .expect("cut cubic should compile");
        assert!(plan.tracks[0].keyframes.iter().any(|keyframe| matches!(
            keyframe.easing_to_next,
            Some(CompiledCssEasing::CubicBezier(_))
        )));
        assert_eq!(
            plan.tracks[0]
                .keyframes
                .last()
                .map(|keyframe| keyframe.time_ms),
            Some(200.0)
        );
    }

    #[test]
    fn splits_a_nonmonotone_document_cut_cubic_at_output_extrema() {
        let spec = AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: None,
                    transform: Some(AnimationTransform2D {
                        translate_x: Some(0.0),
                        ..AnimationTransform2D::default()
                    }),
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: None,
                    transform: Some(AnimationTransform2D {
                        translate_x: Some(100.0),
                        ..AnimationTransform2D::default()
                    }),
                },
            ],
            duration_ms: 1_600.0,
            delay_ms: Some(-250.0),
            easing: Some(AnimationEasing::CubicBezier([0.0, 13.0 / 9.0, 1.0, 0.0])),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: 1_100.0,
            iterations: DocumentIterationCount::Infinite,
        };

        let plan = compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
            .expect("document-cut output extrema should make every cubic piece representable");
        let low_parameter = (13.0 - 13.0_f64.sqrt()) / 24.0;
        let high_parameter = (13.0 + 13.0_f64.sqrt()) / 24.0;
        let expected = [
            0.0,
            -250.0 + cubic_coordinate(low_parameter, 0.0, 1.0) * 1_600.0,
            -250.0 + cubic_coordinate(high_parameter, 0.0, 1.0) * 1_600.0,
            1_100.0,
        ];
        let observed = plan.tracks[0]
            .keyframes
            .iter()
            .map(|keyframe| keyframe.time_ms)
            .collect::<Vec<_>>();
        assert_eq!(observed.len(), expected.len());
        for (observed_time, expected_time) in observed.iter().zip(expected) {
            assert!((observed_time - expected_time).abs() < 1.0e-9);
        }
        assert!(
            plan.tracks[0].keyframes[..3]
                .iter()
                .all(|keyframe| matches!(
                    keyframe.easing_to_next,
                    Some(CompiledCssEasing::CubicBezier(_))
                ))
        );
    }

    #[test]
    fn keeps_an_exact_cubic_endpoint_as_one_timeline_stop() {
        let mut spec = opacity_spec(AnimationEasing::Named("ease".to_string()));
        spec.duration_ms = 600.0;
        spec.delay_ms = Some(0.0);
        spec.iterations = Some(AnimationIterations::Count(1.0));
        spec.fill = Some("both".to_string());
        let playback = DocumentPlayback {
            duration_ms: 1_000.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let plan = compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
            .expect("the standard cubic endpoint should not create a numeric duplicate");

        assert_eq!(
            plan.tracks[0]
                .keyframes
                .iter()
                .map(|keyframe| keyframe.time_ms)
                .collect::<Vec<_>>(),
            vec![0.0, 600.0, 1_000.0]
        );
    }

    #[test]
    fn does_not_split_transform_only_cubic_at_output_extrema() {
        let spec = AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: None,
                    transform: Some(AnimationTransform2D {
                        translate_x: Some(0.0),
                        ..AnimationTransform2D::default()
                    }),
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: None,
                    transform: Some(AnimationTransform2D {
                        translate_x: Some(100.0),
                        ..AnimationTransform2D::default()
                    }),
                },
            ],
            duration_ms: 200.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::CubicBezier([0.5, -1.0e-6, 0.5, 1.0])),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };

        let plan = compile_document_animation_plan(&timeline_ir(spec), infinite_playback(), 0.0)
            .expect("transform values are not clamped at cubic output extrema");
        assert_eq!(
            plan.tracks[0]
                .keyframes
                .iter()
                .map(|keyframe| keyframe.time_ms)
                .collect::<Vec<_>>(),
            vec![0.0, 200.0]
        );
        assert!(matches!(
            plan.tracks[0].keyframes[0].easing_to_next,
            Some(CompiledCssEasing::CubicBezier(_))
        ));
    }

    #[test]
    fn rejects_spring_easing_without_approximating() {
        let spec = opacity_spec(AnimationEasing::Spring(AnimationSpring {
            kind: "spring".to_string(),
            stiffness: None,
            damping: None,
            mass: None,
        }));
        let error = compile_document_animation_plan(&timeline_ir(spec), infinite_playback(), 0.0)
            .expect_err("spring should fail");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("spring should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
        assert_eq!(
            *context,
            json!({
                "ownerKind": "node",
                "ownerId": "animated-node",
                "reason": "spring-easing",
                "boundaryTimeMs": 0.0,
                "migration": "Use playback mode independent for this animation track.",
            })
        );
    }

    #[test]
    fn rejects_a_cubic_interval_that_flows_into_an_iteration_jump() {
        let spec = opacity_spec(AnimationEasing::Named("ease-in".to_string()));
        let error = compile_document_animation_plan(&timeline_ir(spec), infinite_playback(), 0.0)
            .expect_err("cubic jump should fail");
        let EngineError::StructuredContext { context, .. } = error else {
            panic!("cubic jump should produce timeline context");
        };
        assert_eq!(context["reason"], "cubic-into-jump");
        assert_eq!(context["boundaryTimeMs"], 120.0);
    }

    #[test]
    fn rejects_fractional_final_hold_on_a_discontinuity() {
        let mut spec = opacity_spec(AnimationEasing::Steps(AnimationSteps {
            kind: "steps".to_string(),
            count: 4.0,
            position: Some("jump-end".to_string()),
        }));
        spec.duration_ms = 200.0;
        spec.delay_ms = Some(0.0);
        let playback = DocumentPlayback {
            duration_ms: 200.0,
            iterations: DocumentIterationCount::Finite(0.75),
        };
        let error = compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
            .expect_err("hold on a step boundary should fail");
        let EngineError::StructuredContext { context, .. } = error else {
            panic!("hold collision should produce timeline context");
        };
        assert_eq!(context["reason"], "final-hold-on-discontinuity");
        assert_eq!(context["boundaryTimeMs"], 150.0);
    }

    #[test]
    fn normalizes_document_end_discontinuities_for_fractional_final_hold() {
        let mut spec = opacity_spec(AnimationEasing::Steps(AnimationSteps {
            kind: "steps".to_string(),
            count: 2.0,
            position: Some("jump-end".to_string()),
        }));
        spec.duration_ms = 200.0;
        spec.delay_ms = Some(0.0);
        let source = timeline_ir(spec);
        let near_cycle_start = DocumentPlayback {
            duration_ms: 200.0,
            iterations: DocumentIterationCount::Finite(2.0_f64.powi(-21)),
        };
        let error = compile_document_animation_plan(&source, near_cycle_start, 0.0)
            .expect_err("the document-end seam belongs to S at cycle time zero");
        let EngineError::StructuredContext { context, .. } = error else {
            panic!("normalized hold collision should produce timeline context");
        };
        assert_eq!(context["reason"], "final-hold-on-discontinuity");
        assert_eq!(context["boundaryTimeMs"], 0.0);

        let near_cycle_end = DocumentPlayback {
            duration_ms: 200.0,
            iterations: DocumentIterationCount::Finite(1.0 - 2.0_f64.powi(-21)),
        };
        compile_document_animation_plan(&source, near_cycle_end, 0.0)
            .expect("a final hold near D must not collide with S at cycle time zero");
    }

    #[test]
    fn preserves_near_document_end_discontinuity_provenance() {
        for duration_ms in [200.0, 31_415.926_535, 1_000_000.0] {
            let make_source = |source_duration_ms| {
                let spec = AnimationSpec {
                    keyframes: vec![
                        AnimationKeyframe {
                            at: 0.0,
                            opacity: Some(0.0),
                            transform: None,
                        },
                        AnimationKeyframe {
                            at: 0.5,
                            opacity: Some(1.0),
                            transform: None,
                        },
                        AnimationKeyframe {
                            at: 1.0,
                            opacity: Some(0.0),
                            transform: None,
                        },
                    ],
                    duration_ms: source_duration_ms,
                    delay_ms: Some(0.0),
                    easing: Some(AnimationEasing::Steps(AnimationSteps {
                        kind: "steps".to_string(),
                        count: 1.0,
                        position: Some("jump-end".to_string()),
                    })),
                    iterations: Some(AnimationIterations::Count(1.0)),
                    fill: Some("none".to_string()),
                };
                let mut source = timeline_ir(spec);
                let IrNodeKind::Group { opacity, .. } = &mut source.root.kind else {
                    panic!("group fixture expected");
                };
                *opacity = Some(0.0);
                source
            };
            let playback = DocumentPlayback {
                duration_ms,
                iterations: DocumentIterationCount::Finite(2.0_f64.powi(-21)),
            };

            let exact_error =
                compile_document_animation_plan(&make_source(duration_ms), playback, 0.0)
                    .expect_err("an exact document-end jump belongs to the global seam");
            let EngineError::StructuredContext {
                context: exact_context,
                ..
            } = exact_error
            else {
                panic!("exact seam should produce timeline context");
            };
            assert_eq!(exact_context["reason"], "final-hold-on-discontinuity");
            assert_eq!(exact_context["boundaryTimeMs"], 0.0);

            let near_end_ms = previous_f64(duration_ms);
            let near_error =
                compile_document_animation_plan(&make_source(near_end_ms), playback, 0.0)
                    .expect_err("a distinct near-D stop must reach precision preflight");
            let EngineError::StructuredContext {
                code,
                context: near_context,
                ..
            } = near_error
            else {
                panic!("near-D stop should produce timeline context");
            };
            assert_eq!(code, "ANIMATED_SVG_TIMELINE_PRECISION_LOSS");
            assert_eq!(near_context["kind"], "f32-order");
            assert_eq!(near_context["leftTimeMs"], near_end_ms);
            assert_eq!(near_context["rightTimeMs"], duration_ms);
        }
    }

    #[test]
    fn keeps_keyframes_independent_of_active_time_but_freezes_case_b() {
        let source = timeline_ir(representable_linear_spec());
        let playback = DocumentPlayback {
            duration_ms: 200.0,
            iterations: DocumentIterationCount::Finite(2.5),
        };
        let at_start =
            compile_document_animation_plan(&source, playback, 0.0).expect("start should compile");
        let mid_cycle = compile_document_animation_plan(&source, playback, 250.0)
            .expect("mid cycle should compile");
        assert_eq!(at_start.tracks, mid_cycle.tracks);
        assert_ne!(at_start.css_delay_ms, mid_cycle.css_delay_ms);

        let at_hold =
            compile_document_animation_plan(&source, playback, 500.0).expect("hold should compile");
        let after_hold = compile_document_animation_plan(&source, playback, 700.0)
            .expect("post hold should compile");
        assert_eq!(at_hold, after_hold);
    }

    #[test]
    fn accepts_plain_linear_and_opacity_clamp_plateau_intervals() {
        let mut linear = opacity_spec(AnimationEasing::Named("linear".to_string()));
        linear.duration_ms = 200.0;
        linear.delay_ms = Some(0.0);
        linear.iterations = Some(AnimationIterations::Count(1.0));
        linear.fill = Some("both".to_string());
        let linear_plan =
            compile_document_animation_plan(&timeline_ir(linear), infinite_playback(), 0.0)
                .expect("plain linear interval should compile");
        assert!(matches!(
            linear_plan.tracks[0].keyframes[0].easing_to_next,
            Some(CompiledCssEasing::Linear)
        ));

        let mut overshoot = opacity_spec(AnimationEasing::CubicBezier([0.3, 1.6, 0.7, 1.4]));
        overshoot.duration_ms = 200.0;
        overshoot.delay_ms = Some(0.0);
        overshoot.iterations = Some(AnimationIterations::Count(1.0));
        overshoot.fill = Some("both".to_string());
        let overshoot_plan =
            compile_document_animation_plan(&timeline_ir(overshoot), infinite_playback(), 0.0)
                .expect("clamped overshoot should compile");
        assert!(overshoot_plan.tracks[0].keyframes.windows(2).any(|pair| {
            pair[0].value.opacity == Some(1.0)
                && pair[1].value.opacity == Some(1.0)
                && matches!(pair[0].easing_to_next, Some(CompiledCssEasing::StepEnd))
        }));
    }

    #[test]
    fn budgets_only_source_iterations_that_intersect_the_document_cycle() {
        let mut spec = opacity_spec(AnimationEasing::Named("linear".to_string()));
        spec.duration_ms = 1.0;
        spec.delay_ms = Some(19_999.0);
        spec.iterations = Some(AnimationIterations::Count(1.0));
        spec.fill = Some("both".to_string());
        let playback = DocumentPlayback {
            duration_ms: 20_000.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let plan = compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
            .expect("one intersecting iteration should stay below the budget");
        assert_eq!(
            plan.tracks[0]
                .keyframes
                .iter()
                .map(|keyframe| keyframe.time_ms)
                .collect::<Vec<_>>(),
            vec![0.0, 19_999.0, 20_000.0]
        );
    }

    #[test]
    fn rebases_a_finite_base_transform_and_rejects_non_finite_conversion() {
        let base_transform = Transform2D {
            translate_x: Some(7.0),
            translate_y: Some(-3.0),
            scale_x: Some(1.25),
            scale_y: Some(0.75),
            rotate_deg: Some(30.0),
            origin_x: Some(10.0),
            origin_y: Some(12.0),
        };
        let bbox = BBox::new(20.0, 30.0, 100.0, 50.0);
        let rebased = base_transform_value(Some(&base_transform), bbox);
        let spec = AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: None,
                    transform: Some(rebased.clone()),
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: None,
                    transform: Some(rebased.clone()),
                },
            ],
            duration_ms: 100.0,
            delay_ms: Some(20.0),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("none".to_string()),
        };
        let mut source = timeline_ir(spec.clone());
        source.root.bbox = bbox;
        let IrNodeKind::Group { transform, .. } = &mut source.root.kind else {
            panic!("group fixture expected");
        };
        *transform = Some(base_transform);
        let plan = compile_document_animation_plan(&source, infinite_playback(), 0.0)
            .expect("finite base transform should be exactly re-based");
        assert_eq!(plan.tracks[0].keyframes[0].value.transform, Some(rebased));

        let IrNodeKind::Group { transform, .. } = &mut source.root.kind else {
            panic!("group fixture expected");
        };
        *transform = Some(Transform2D {
            scale_x: Some(f64::MAX),
            origin_x: Some(f64::MAX),
            ..Transform2D::default()
        });
        let error = compile_document_animation_plan(&source, infinite_playback(), 0.0)
            .expect_err("overflowing base conversion should fail");
        let EngineError::StructuredContext { context, .. } = error else {
            panic!("base conversion should produce timeline context");
        };
        assert_eq!(context["reason"], "base-transition-unrepresentable");
    }

    #[test]
    fn representability_precedes_precision_across_owner_traversal() {
        let precision_spec = AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(0.0),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 0.5,
                    opacity: Some(0.4),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 0.500_000_001,
                    opacity: Some(0.6),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(1.0),
                    transform: None,
                },
            ],
            duration_ms: 1_000_000.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        let spring_spec = opacity_spec(AnimationEasing::Spring(AnimationSpring {
            kind: "spring".to_string(),
            stiffness: None,
            damping: None,
            mass: None,
        }));
        let source = Ir {
            root: IrNode {
                node_id: "root".to_string(),
                bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
                kind: IrNodeKind::Group {
                    children: vec![
                        animated_group("precision-first", precision_spec),
                        animated_group("spring-second", spring_spec),
                    ],
                    clip_path: None,
                    clip_border_radius: None,
                    opacity: None,
                    box_shadow: None,
                    meta: None,
                    transform: None,
                    animation: None,
                    on: None,
                },
            },
            draw_order: Vec::new(),
            width: 100.0,
            height: 50.0,
            debug: None,
            warnings: Vec::new(),
        };
        let playback = DocumentPlayback {
            duration_ms: 1_000_000.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let error = compile_document_animation_plan(&source, playback, 0.0)
            .expect_err("representability must win before precision");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("pipeline order should return a structured error");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
        assert_eq!(context["ownerId"], "spring-second");
        assert_eq!(context["reason"], "spring-easing");
    }

    #[test]
    fn text_unit_representability_precedes_earlier_node_precision_and_budget() {
        let precision_spec = AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(0.0),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 0.5,
                    opacity: Some(0.4),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 0.500_000_001,
                    opacity: Some(0.6),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(1.0),
                    transform: None,
                },
            ],
            duration_ms: 1_000_000.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        let mut budget_spec = opacity_spec(AnimationEasing::Steps(AnimationSteps {
            kind: "steps".to_string(),
            count: 20_000.0,
            position: Some("jump-end".to_string()),
        }));
        budget_spec.duration_ms = 1_000_000.0;
        budget_spec.delay_ms = Some(0.0);
        let spring_spec = opacity_spec(AnimationEasing::Spring(AnimationSpring {
            kind: "spring".to_string(),
            stiffness: None,
            damping: None,
            mass: None,
        }));

        for (early_owner_id, early_spec) in [
            ("precision-first", precision_spec),
            ("budget-first", budget_spec),
        ] {
            let source = Ir {
                root: IrNode {
                    node_id: "root".to_string(),
                    bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
                    kind: IrNodeKind::Group {
                        children: vec![
                            animated_group(early_owner_id, early_spec),
                            animated_text_unit("copy", "unit-a", &spring_spec),
                        ],
                        clip_path: None,
                        clip_border_radius: None,
                        opacity: None,
                        box_shadow: None,
                        meta: None,
                        transform: None,
                        animation: None,
                        on: None,
                    },
                },
                draw_order: Vec::new(),
                width: 100.0,
                height: 50.0,
                debug: None,
                warnings: Vec::new(),
            };
            let playback = DocumentPlayback {
                duration_ms: 1_000_000.0,
                iterations: DocumentIterationCount::Infinite,
            };
            let error = compile_document_animation_plan(&source, playback, 0.0)
                .expect_err("all owner representability checks must precede precision and budget");
            let EngineError::StructuredContext { code, context, .. } = error else {
                panic!("text-unit representability should produce timeline context");
            };
            assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
            assert_eq!(context["ownerKind"], "textUnit");
            assert_eq!(context["ownerId"], "copy");
            assert_eq!(context["unitId"], "unit-a");
            assert_eq!(context["reason"], "spring-easing");
        }
    }

    #[test]
    fn compiles_text_units_in_sample_order_with_visual_delay_order() {
        let root: IrNode = serde_json::from_value(json!({
                "nodeId": "copy",
                "bbox": { "x": 0.0, "y": 0.0, "w": 100.0, "h": 20.0 },
                "type": "text",
                "lines": [],
                "font": "Fixture",
                "fontSizePx": 16.0,
                "color": "#000000",
                "textAlign": "start",
                "layoutBox": { "x": 0.0, "y": 0.0, "w": 100.0, "h": 20.0 },
                "lineHeightPx": 20.0,
                "glyphPaths": [],
                "unitMap": {
                    "kind": "cluster",
                    "ruby": "with-base",
                    "units": [{
                        "unitId": "unit-a",
                        "kind": "cluster",
                        "sourceStart": 0,
                        "sourceEnd": 1,
                        "lineId": "line-0",
                        "logicalOrder": 0,
                        "visualOrder": 1,
                        "members": []
                    }, {
                        "unitId": "unit-b",
                        "kind": "cluster",
                        "sourceStart": 1,
                        "sourceEnd": 2,
                        "lineId": "line-0",
                        "logicalOrder": 1,
                        "visualOrder": 0,
                        "members": []
                    }]
                },
                "unitAnimation": {
                    "by": "cluster",
                    "animation": {
                        "keyframes": [
                            { "at": 0.0, "opacity": 0.0 },
                            { "at": 1.0, "opacity": 1.0 }
                        ],
                        "durationMs": 100.0,
                        "delayMs": 0.0,
                        "easing": "linear",
                        "iterations": 1.0,
                        "fill": "both"
                    },
                    "delayStepMs": 20.0,
                    "order": "visual"
                },
                "unitAnimationSamples": [{
                    "unitId": "unit-a",
                    "bbox": { "x": 0.0, "y": 0.0, "w": 10.0, "h": 20.0 }
                }, {
                    "unitId": "unit-b",
                    "bbox": { "x": 12.0, "y": 0.0, "w": 10.0, "h": 20.0 }
                }]
        }))
        .expect("text-unit fixture should deserialize");
        let source = Ir {
            root,
            draw_order: Vec::new(),
            width: 100.0,
            height: 20.0,
            debug: None,
            warnings: Vec::new(),
        };
        let plan = compile_document_animation_plan(&source, infinite_playback(), 0.0)
            .expect("text units should compile");
        assert_eq!(plan.tracks.len(), 2);
        assert_eq!(plan.tracks[0].owner_kind, TimelineOwnerKind::TextUnit);
        assert_eq!(plan.tracks[0].unit_id.as_deref(), Some("unit-a"));
        assert_eq!(plan.tracks[1].unit_id.as_deref(), Some("unit-b"));
        assert!(
            plan.tracks[0]
                .keyframes
                .iter()
                .any(|keyframe| same_time(keyframe.time_ms, 20.0))
        );
        assert!(
            !plan.tracks[1]
                .keyframes
                .iter()
                .any(|keyframe| same_time(keyframe.time_ms, 20.0))
        );
    }

    #[test]
    fn reports_separation_after_binary32_order_passes() {
        let keyframes = vec![
            DocumentKeyframe {
                time_ms: 0.0,
                value: AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(0.0),
                    transform: None,
                },
                easing_to_next: Some(CompiledCssEasing::Linear),
            },
            DocumentKeyframe {
                time_ms: 0.002,
                value: AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(1.0),
                    transform: None,
                },
                easing_to_next: None,
            },
        ];
        let playback = DocumentPlayback {
            duration_ms: 100.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let error = precision_preflight(&keyframes, playback)
            .expect_err("stops below the carve-out separation should fail");
        let EngineError::StructuredContext { context, stage, .. } = error else {
            panic!("separation should produce timeline context");
        };
        assert_eq!(stage.as_deref(), Some("emit"));
        assert_eq!(
            *context,
            json!({
                "kind": "separation",
                "leftTimeMs": 0.0,
                "rightTimeMs": 0.002,
            })
        );
    }

    #[test]
    fn rejects_zero_delta_linear_jumps() {
        let spec = opacity_spec(AnimationEasing::Named("linear".to_string()));
        let error = compile_document_animation_plan(&timeline_ir(spec), infinite_playback(), 0.0)
            .expect_err("a linear loop back to its start value is not representable");
        let EngineError::StructuredContext { context, .. } = error else {
            panic!("zero delta should produce timeline context");
        };
        assert_eq!(context["reason"], "zero-delta-jump");
    }

    #[test]
    fn rejects_mixed_channel_jump_scaling() {
        let mut spec = representable_linear_spec();
        for (index, keyframe) in spec.keyframes.iter_mut().enumerate() {
            keyframe.transform = Some(AnimationTransform2D {
                translate_x: Some(index as f64 * 100.0),
                ..AnimationTransform2D::default()
            });
        }
        let mut source = timeline_ir(spec);
        let IrNodeKind::Group { transform, .. } = &mut source.root.kind else {
            panic!("group fixture expected");
        };
        *transform = Some(Transform2D {
            translate_x: Some(50.0),
            ..Transform2D::default()
        });
        let error = compile_document_animation_plan(&source, infinite_playback(), 0.0)
            .expect_err("channels need different output scaling");
        let EngineError::StructuredContext { context, .. } = error else {
            panic!("mixed channels should produce timeline context");
        };
        assert_eq!(context["reason"], "mixed-channel-jump");
    }

    #[test]
    fn detects_f32_stop_order_before_separation() {
        let spec = AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(0.0),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 0.5,
                    opacity: Some(0.4),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 0.500_000_001,
                    opacity: Some(0.6),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(1.0),
                    transform: None,
                },
            ],
            duration_ms: 1_000_000.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: 1_000_000.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let error = compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
            .expect_err("binary32-colliding stops should fail");
        let EngineError::StructuredContext { context, .. } = error else {
            panic!("precision should produce timeline context");
        };
        assert_eq!(context["kind"], "f32-order");
    }

    #[test]
    fn reports_the_first_owner_representability_failure() {
        let ir = Ir {
            root: IrNode {
                node_id: "root".to_string(),
                bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
                kind: IrNodeKind::Group {
                    children: vec![
                        animated_group(
                            "cubic-first",
                            opacity_spec(AnimationEasing::Named("ease-in".to_string())),
                        ),
                        animated_group(
                            "spring-second",
                            opacity_spec(AnimationEasing::Spring(AnimationSpring {
                                kind: "spring".to_string(),
                                stiffness: None,
                                damping: None,
                                mass: None,
                            })),
                        ),
                    ],
                    clip_path: None,
                    clip_border_radius: None,
                    opacity: None,
                    box_shadow: None,
                    meta: None,
                    transform: None,
                    animation: None,
                    on: None,
                },
            },
            draw_order: Vec::new(),
            width: 100.0,
            height: 50.0,
            debug: None,
            warnings: Vec::new(),
        };

        let error = compile_document_animation_plan(&ir, infinite_playback(), 0.0)
            .expect_err("the first owner should win within the representability stage");
        let EngineError::StructuredContext { context, .. } = error else {
            panic!("representability should produce timeline context");
        };
        assert_eq!(context["ownerId"], "cubic-first");
        assert_eq!(context["reason"], "cubic-into-jump");
    }

    #[test]
    fn reports_final_hold_before_a_later_owner_failure() {
        let mut hold_spec = opacity_spec(AnimationEasing::Steps(AnimationSteps {
            kind: "steps".to_string(),
            count: 2.0,
            position: Some("jump-end".to_string()),
        }));
        hold_spec.duration_ms = 300.0;
        hold_spec.delay_ms = Some(0.0);
        let ir = Ir {
            root: IrNode {
                node_id: "root".to_string(),
                bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
                kind: IrNodeKind::Group {
                    children: vec![
                        animated_group("hold-first", hold_spec),
                        animated_group(
                            "cubic-second",
                            opacity_spec(AnimationEasing::Named("ease-in".to_string())),
                        ),
                    ],
                    clip_path: None,
                    clip_border_radius: None,
                    opacity: None,
                    box_shadow: None,
                    meta: None,
                    transform: None,
                    animation: None,
                    on: None,
                },
            },
            draw_order: Vec::new(),
            width: 100.0,
            height: 50.0,
            debug: None,
            warnings: Vec::new(),
        };
        let playback = DocumentPlayback {
            duration_ms: 400.0,
            iterations: DocumentIterationCount::Finite(1.375),
        };

        let error = compile_document_animation_plan(&ir, playback, 0.0)
            .expect_err("the first owner's final hold collision should win");
        let EngineError::StructuredContext { context, .. } = error else {
            panic!("final hold should produce timeline context");
        };
        assert_eq!(context["ownerId"], "hold-first");
        assert_eq!(context["reason"], "final-hold-on-discontinuity");
        assert_eq!(context["boundaryTimeMs"], 150.0);
    }

    #[test]
    fn does_not_deduplicate_distinct_authored_stops_before_precision_preflight() {
        let next_after_half = f64::from_bits(0.5_f64.to_bits() + 1);
        let spec = AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(0.0),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 0.5,
                    opacity: Some(0.4),
                    transform: None,
                },
                AnimationKeyframe {
                    at: next_after_half,
                    opacity: Some(0.6),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(1.0),
                    transform: None,
                },
            ],
            duration_ms: 1_000_000.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: 1_000_000.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let error = compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
            .expect_err("distinct binary64 stops must reach precision preflight");
        let EngineError::StructuredContext { context, .. } = error else {
            panic!("precision should produce timeline context");
        };
        assert_eq!(context["kind"], "f32-order");
    }

    #[test]
    fn enforces_the_inclusive_keyframe_stop_budget() {
        let make_steps = |count| {
            let mut spec = opacity_spec(AnimationEasing::Steps(AnimationSteps {
                kind: "steps".to_string(),
                count,
                position: Some("jump-end".to_string()),
            }));
            spec.duration_ms = MAX_TIMELINE_DURATION_MS;
            spec.delay_ms = Some(0.0);
            spec
        };
        let playback = DocumentPlayback {
            duration_ms: MAX_TIMELINE_DURATION_MS,
            iterations: DocumentIterationCount::Infinite,
        };
        let test_thread_id = std::thread::current().id();
        COMPILE_TRACK_TRACE
            .lock()
            .expect("compile track trace should not be poisoned")
            .entry(test_thread_id)
            .or_default()
            .clear();
        let at_limit = compile_document_animation_plan(
            &timeline_ir(make_steps((MAX_TIMELINE_KEYFRAME_STOPS - 1) as f64)),
            playback,
            0.0,
        )
        .expect("exact stop limit should compile");
        assert_eq!(at_limit.keyframe_stop_count, MAX_TIMELINE_KEYFRAME_STOPS);
        let trace = COMPILE_TRACK_TRACE
            .lock()
            .expect("compile track trace should not be poisoned");
        assert_eq!(
            trace.get(&test_thread_id),
            Some(&vec!["animated-node".to_string()])
        );
        drop(trace);

        let error = compile_document_animation_plan(
            &timeline_ir(make_steps(MAX_TIMELINE_KEYFRAME_STOPS as f64)),
            playback,
            0.0,
        )
        .expect_err("one stop above the limit should fail");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("budget should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_LIMIT");
        assert_eq!(
            *context,
            json!({
                "metric": "keyframeStops",
                "actual": (MAX_TIMELINE_KEYFRAME_STOPS + 1) as f64,
                "limit": MAX_TIMELINE_KEYFRAME_STOPS,
            })
        );
    }

    #[test]
    fn rejects_aggregate_linear_tracks_before_plan_expansion() {
        let make_spec = || AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(0.0),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 0.5,
                    opacity: Some(1.0),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(0.0),
                    transform: None,
                },
            ],
            duration_ms: 200.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Infinite("infinite".to_string())),
            fill: Some("both".to_string()),
        };
        let source = Ir {
            root: IrNode {
                node_id: "root".to_string(),
                bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
                kind: IrNodeKind::Group {
                    children: vec![
                        animated_group("linear-first", make_spec()),
                        animated_group("linear-second", make_spec()),
                    ],
                    clip_path: None,
                    clip_border_radius: None,
                    opacity: None,
                    box_shadow: None,
                    meta: None,
                    transform: None,
                    animation: None,
                    on: None,
                },
            },
            draw_order: Vec::new(),
            width: 100.0,
            height: 50.0,
            debug: None,
            warnings: Vec::new(),
        };
        let playback = DocumentPlayback {
            duration_ms: 1_000_000.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let test_thread_id = std::thread::current().id();
        COMPILE_TRACK_TRACE
            .lock()
            .expect("compile track trace should not be poisoned")
            .entry(test_thread_id)
            .or_default()
            .clear();

        let error = compile_document_animation_plan(&source, playback, 0.0)
            .expect_err("the aggregate linear count should fail before plan expansion");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("aggregate budget should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_LIMIT");
        assert_eq!(context["actual"], 20_002.0);
        let trace = COMPILE_TRACK_TRACE
            .lock()
            .expect("compile track trace should not be poisoned");
        assert_eq!(trace.get(&test_thread_id), Some(&Vec::new()));
    }

    #[test]
    fn reports_the_exact_large_single_track_budget() {
        let mut spec = opacity_spec(AnimationEasing::Steps(AnimationSteps {
            kind: "steps".to_string(),
            count: 20_000.0,
            position: Some("jump-end".to_string()),
        }));
        spec.duration_ms = MAX_TIMELINE_DURATION_MS;
        spec.delay_ms = Some(0.0);
        let playback = DocumentPlayback {
            duration_ms: MAX_TIMELINE_DURATION_MS,
            iterations: DocumentIterationCount::Infinite,
        };

        let error = compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
            .expect_err("a large precision-safe track should report its exact stop count");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("large single-track budget should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_LIMIT");
        assert_eq!(context["actual"], 20_001.0);
        assert_eq!(context["limit"], MAX_TIMELINE_KEYFRAME_STOPS);
    }

    #[test]
    fn rejects_aggregate_steps_before_expanding_closed_form_tracks() {
        let make_spec = |easing| AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(0.0),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(1.0),
                    transform: None,
                },
            ],
            duration_ms: 1_000_000.0,
            delay_ms: Some(0.0),
            easing: Some(easing),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        let near_limit_steps = || {
            make_spec(AnimationEasing::Steps(AnimationSteps {
                kind: "steps".to_string(),
                count: 8_191.0,
                position: Some("jump-end".to_string()),
            }))
        };
        let ir = Ir {
            root: IrNode {
                node_id: "root".to_string(),
                bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
                kind: IrNodeKind::Group {
                    children: vec![
                        animated_group(
                            "linear-first",
                            make_spec(AnimationEasing::Named("linear".to_string())),
                        ),
                        animated_group("steps-second", near_limit_steps()),
                        animated_group("steps-third", near_limit_steps()),
                    ],
                    clip_path: None,
                    clip_border_radius: None,
                    opacity: None,
                    box_shadow: None,
                    meta: None,
                    transform: None,
                    animation: None,
                    on: None,
                },
            },
            draw_order: Vec::new(),
            width: 100.0,
            height: 50.0,
            debug: None,
            warnings: Vec::new(),
        };
        let playback = DocumentPlayback {
            duration_ms: 1_000_000.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let test_thread_id = std::thread::current().id();
        COMPILE_TRACK_TRACE
            .lock()
            .expect("compile track trace should not be poisoned")
            .entry(test_thread_id)
            .or_default()
            .clear();

        let error = compile_document_animation_plan(&ir, playback, 0.0)
            .expect_err("the aggregate count should fail before output track allocation");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("aggregate budget should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_LIMIT");
        assert_eq!(
            *context,
            json!({
                "metric": "keyframeStops",
                "actual": 16_386.0,
                "limit": MAX_TIMELINE_KEYFRAME_STOPS,
            })
        );
        let trace = COMPILE_TRACK_TRACE
            .lock()
            .expect("compile track trace should not be poisoned");
        assert_eq!(trace.get(&test_thread_id), Some(&Vec::new()));
    }

    #[test]
    fn reports_precision_before_an_extreme_stop_budget() {
        let mut spec = opacity_spec(AnimationEasing::Steps(AnimationSteps {
            kind: "steps".to_string(),
            count: 1.0e308,
            position: Some("jump-end".to_string()),
        }));
        spec.duration_ms = 1.0;
        spec.delay_ms = Some(0.0);
        let playback = DocumentPlayback {
            duration_ms: MAX_TIMELINE_DURATION_MS,
            iterations: DocumentIterationCount::Infinite,
        };

        let error = compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
            .expect_err("precision must precede an extreme semantic budget");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("extreme precision should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_PRECISION_LOSS");
        assert_eq!(context["kind"], "f32-order");
        assert_eq!(context["leftTimeMs"], 0.0);
    }

    #[test]
    fn preflights_repeated_step_budget_in_closed_form_after_representability() {
        let repeated_step_spec = || AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(0.0),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(1.0),
                    transform: None,
                },
            ],
            duration_ms: 1.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Steps(AnimationSteps {
                kind: "steps".to_string(),
                count: 1.0,
                position: Some("jump-end".to_string()),
            })),
            iterations: Some(AnimationIterations::Infinite("infinite".to_string())),
            fill: Some("both".to_string()),
        };
        let repeated_children = (0..13)
            .map(|index| animated_group(&format!("step-{index}"), repeated_step_spec()))
            .collect::<Vec<_>>();
        let repeated_ir = |children| Ir {
            root: IrNode {
                node_id: "root".to_string(),
                bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
                kind: IrNodeKind::Group {
                    children,
                    clip_path: None,
                    clip_border_radius: None,
                    opacity: None,
                    box_shadow: None,
                    meta: None,
                    transform: None,
                    animation: None,
                    on: None,
                },
            },
            draw_order: Vec::new(),
            width: 100.0,
            height: 50.0,
            debug: None,
            warnings: Vec::new(),
        };
        let playback = DocumentPlayback {
            duration_ms: 10_000.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let error =
            compile_document_animation_plan(&repeated_ir(repeated_children.clone()), playback, 0.0)
                .expect_err("aggregate repeated stops should fail before expansion");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("closed-form budget should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_LIMIT");
        assert_eq!(context["metric"], "keyframeStops");
        assert_eq!(context["actual"], 130_013.0);

        let mut representability_children = repeated_children;
        representability_children.push(animated_group(
            "spring-after-budget",
            opacity_spec(AnimationEasing::Spring(AnimationSpring {
                kind: "spring".to_string(),
                stiffness: None,
                damping: None,
                mass: None,
            })),
        ));
        let error =
            compile_document_animation_plan(&repeated_ir(representability_children), playback, 0.0)
                .expect_err("representability must precede the closed-form budget");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("representability should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
        assert_eq!(context["ownerId"], "spring-after-budget");
        assert_eq!(context["reason"], "spring-easing");
    }

    #[test]
    fn representative_semantic_expansion_matches_the_two_pass_stop_count() {
        const TRACK_COUNT: usize = 828;
        const FOUR_STOP_TRACKS: usize = 294;
        const STEP_TRACKS: usize = 814;
        const INFINITE_TRACKS: usize = 13;
        const EXPECTED_STOPS: usize = 2_778;

        let children = (0..TRACK_COUNT)
            .map(|track_index| {
                let selector_count = if track_index < FOUR_STOP_TRACKS { 4 } else { 3 };
                let keyframes = (0..selector_count)
                    .map(|selector_index| AnimationKeyframe {
                        at: f64::from(selector_index) / f64::from(selector_count - 1),
                        opacity: Some(f64::from(selector_index % 2)),
                        transform: None,
                    })
                    .collect();
                let easing = if track_index < STEP_TRACKS {
                    AnimationEasing::Steps(AnimationSteps {
                        kind: "steps".to_string(),
                        count: 1.0,
                        position: Some("jump-end".to_string()),
                    })
                } else {
                    AnimationEasing::Named("linear".to_string())
                };
                let iterations = if track_index < INFINITE_TRACKS {
                    AnimationIterations::Infinite("infinite".to_string())
                } else {
                    AnimationIterations::Count(1.0)
                };
                animated_group(
                    &format!("representative-{track_index}"),
                    AnimationSpec {
                        keyframes,
                        duration_ms: 200.0,
                        delay_ms: Some(0.0),
                        easing: Some(easing),
                        iterations: Some(iterations),
                        fill: Some("both".to_string()),
                    },
                )
            })
            .collect();
        let ir = Ir {
            root: IrNode {
                node_id: "root".to_string(),
                bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
                kind: IrNodeKind::Group {
                    children,
                    clip_path: None,
                    clip_border_radius: None,
                    opacity: None,
                    box_shadow: None,
                    meta: None,
                    transform: None,
                    animation: None,
                    on: None,
                },
            },
            draw_order: Vec::new(),
            width: 100.0,
            height: 50.0,
            debug: None,
            warnings: Vec::new(),
        };
        let playback = DocumentPlayback {
            duration_ms: 200.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let plan = compile_document_animation_plan_with_prefix(
            &ir,
            playback,
            0.0,
            "representative-",
            false,
        )
        .expect("representative semantic expansion should compile");

        assert_eq!(plan.tracks.len(), TRACK_COUNT);
        assert_eq!(plan.keyframe_stop_count, EXPECTED_STOPS);
        assert_eq!(
            plan.exact_css_bytes,
            crate::svg_emit::emitter::timeline_plan_css_byte_count(
                &plan,
                "representative-",
                false,
            )
            .expect("the count pass should match the accepted plan")
        );
    }

    #[test]
    fn cubic_subcurve_reproduces_the_original_interval() {
        let curve = [0.3, 1.6, 0.7, 1.4];
        let input_start = 0.2;
        let input_end = 0.6;
        let subcurve = cubic_subcurve(curve, input_start, input_end)
            .expect("non-degenerate cubic subcurve expected");
        let source_start =
            animation::apply_easing(input_start, ResolvedEasing::Cubic(curve), false, 100.0);
        let source_end =
            animation::apply_easing(input_end, ResolvedEasing::Cubic(curve), false, 100.0);
        for progress in [0.0, 0.1, 0.5, 0.9, 1.0] {
            let source_input = input_start + (input_end - input_start) * progress;
            let source_value =
                animation::apply_easing(source_input, ResolvedEasing::Cubic(curve), false, 100.0);
            let normalized_source = (source_value - source_start) / (source_end - source_start);
            let subcurve_value =
                animation::apply_easing(progress, ResolvedEasing::Cubic(subcurve), false, 100.0);
            assert!((normalized_source - subcurve_value).abs() < 1.0e-6);
        }
    }
}
