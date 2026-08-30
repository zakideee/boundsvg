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

use super::animation::{self, AnimationStepPosition, ResolvedEasing};
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

const MIN_AUTHORED_TIMELINE_DURATION_MS: f64 = 1.0;
const MAX_AUTHORED_TIMELINE_DELAY_MS: f64 = MAX_TIMELINE_DURATION_MS;
const MIN_AUTHORED_TIMELINE_ITERATIONS: f64 = 1.0 / 4_294_967_296.0;
const AUTHORED_TIMELINE_DOMAIN_MIGRATION: &str =
    "Use playback mode independent or change the authored value to the supported timeline range.";

const CARVE_OUT_SCALE: f64 = 1_048_576.0;

#[cfg(test)]
static COMPILE_TRACK_TRACE: LazyLock<Mutex<HashMap<ThreadId, Vec<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[cfg(test)]
static PREFLIGHT_WINDOW_TRACE: LazyLock<Mutex<HashMap<ThreadId, usize>>> =
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
    fn from_keyframe(keyframe: &AnimationKeyframe) -> Self {
        Self {
            opacity: keyframe.opacity,
            transform: keyframe.transform.clone(),
        }
        .canonicalized()
    }

    fn canonicalized(&self) -> Self {
        Self {
            opacity: self.opacity,
            transform: self
                .transform
                .as_ref()
                .map(|transform| AnimationTransform2D {
                    translate_x: Some(transform.translate_x.unwrap_or(0.0)),
                    translate_y: Some(transform.translate_y.unwrap_or(0.0)),
                    scale_x: Some(transform.scale_x.unwrap_or(1.0)),
                    scale_y: Some(transform.scale_y.unwrap_or(1.0)),
                    rotate_deg: Some(transform.rotate_deg.unwrap_or(0.0)),
                }),
        }
    }

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

#[derive(Debug, Clone, Copy)]
struct TrackIdentity<'a> {
    owner_kind: TimelineOwnerKind,
    owner_id: &'a str,
    unit_id: Option<&'a str>,
}

#[cfg(test)]
impl TrackSource {
    fn identity(&self) -> TrackIdentity<'_> {
        TrackIdentity {
            owner_kind: self.owner_kind,
            owner_id: &self.owner_id,
            unit_id: self.unit_id.as_deref(),
        }
    }
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

fn authored_timeline_value_out_of_domain(
    identity: TrackIdentity<'_>,
    field: &str,
    received: f64,
) -> EngineError {
    let mut context = json!({
        "ownerKind": identity.owner_kind.as_str(),
        "ownerId": identity.owner_id,
        "reason": "authored-value-out-of-domain",
        "field": field,
        "received": format_js_number(received),
        "migration": AUTHORED_TIMELINE_DOMAIN_MIGRATION,
    });
    if let Some(unit_id) = identity.unit_id {
        context["unitId"] = json!(unit_id);
    }
    EngineError::StructuredContext {
        code: "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE".to_string(),
        message: format!(
            "Animated SVG timeline cannot represent {} track {:?}: authored {field} is outside the supported timeline range",
            identity.owner_kind.as_str(),
            identity.owner_id
        ),
        stage: Some("emit".to_string()),
        node_id: Some(identity.owner_id.to_string()),
        context: Box::new(context),
    }
}

fn validate_authored_timeline_delay_domain(
    identity: TrackIdentity<'_>,
    delay_ms: f64,
) -> Result<(), EngineError> {
    if !delay_ms.is_finite()
        || !(-MAX_AUTHORED_TIMELINE_DELAY_MS..=MAX_AUTHORED_TIMELINE_DELAY_MS).contains(&delay_ms)
    {
        return Err(authored_timeline_value_out_of_domain(
            identity, "delayMs", delay_ms,
        ));
    }
    Ok(())
}

fn validate_authored_timeline_spec_domain(
    identity: TrackIdentity<'_>,
    spec: &AnimationSpec,
) -> Result<(), EngineError> {
    let duration_ms = spec.duration_ms;
    if !duration_ms.is_finite()
        || !(MIN_AUTHORED_TIMELINE_DURATION_MS..=MAX_TIMELINE_DURATION_MS).contains(&duration_ms)
    {
        return Err(authored_timeline_value_out_of_domain(
            identity,
            "durationMs",
            duration_ms,
        ));
    }

    validate_authored_timeline_delay_domain(identity, spec.delay_ms.unwrap_or(0.0))?;

    if let Some(AnimationIterations::Count(iterations)) = spec.iterations.as_ref()
        && (!iterations.is_finite()
            || !(MIN_AUTHORED_TIMELINE_ITERATIONS..=MAX_TIMELINE_ITERATIONS).contains(iterations))
    {
        return Err(authored_timeline_value_out_of_domain(
            identity,
            "iterations",
            *iterations,
        ));
    }

    Ok(())
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

fn collect_track_sources_at_node(node: &IrNode, sources: &mut Vec<TrackSource>) {
    match &node.kind {
        IrNodeKind::Group {
            opacity,
            transform,
            animation: Some(spec),
            ..
        } => {
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

#[cfg(test)]
fn collect_track_sources(node: &IrNode, sources: &mut Vec<TrackSource>) {
    collect_track_sources_at_node(node, sources);
    if let IrNodeKind::Group { children, .. } = &node.kind {
        for child in children {
            collect_track_sources(child, sources);
        }
    }
}

fn validate_authored_timeline_node(node: &IrNode) -> Result<(), EngineError> {
    match &node.kind {
        IrNodeKind::Group {
            animation: Some(spec),
            ..
        } => validate_authored_timeline_spec_domain(
            TrackIdentity {
                owner_kind: TimelineOwnerKind::Node,
                owner_id: &node.node_id,
                unit_id: None,
            },
            spec,
        ),
        IrNodeKind::Text {
            unit_animation: Some(unit_animation),
            unit_map,
            ..
        } => {
            validate_authored_timeline_spec_domain(
                TrackIdentity {
                    owner_kind: TimelineOwnerKind::TextUnit,
                    owner_id: &node.node_id,
                    unit_id: None,
                },
                &unit_animation.animation,
            )?;
            let Some(unit_map) = unit_map else {
                return Ok(());
            };
            let use_visual_order =
                matches!(unit_animation.order, Some(TextUnitAnimationOrder::Visual));
            let base_delay_ms = unit_animation.animation.delay_ms.unwrap_or(0.0);
            let delay_step_ms = unit_animation.delay_step_ms.unwrap_or(0.0);
            for unit in &unit_map.units {
                let order_index = if use_visual_order {
                    unit.visual_order
                } else {
                    unit.logical_order
                };
                let effective_delay_ms = base_delay_ms + f64::from(order_index) * delay_step_ms;
                if effective_delay_ms != base_delay_ms {
                    validate_authored_timeline_delay_domain(
                        TrackIdentity {
                            owner_kind: TimelineOwnerKind::TextUnit,
                            owner_id: &node.node_id,
                            unit_id: Some(unit.unit_id.as_str()),
                        },
                        effective_delay_ms,
                    )?;
                }
            }
            Ok(())
        }
        _ => Ok(()),
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
    // Non-positive ends returned above, so a surviving finite end is already positive.
    active_end_ms.filter(|end_ms| *end_ms <= playback.duration_ms)
}

fn spec_values_are_constant(spec: &AnimationSpec) -> bool {
    let Some(first) = spec.keyframes.first() else {
        return true;
    };
    let first_value = TrackValue::from_keyframe(first);
    spec.keyframes
        .iter()
        .all(|keyframe| TrackValue::from_keyframe(keyframe) == first_value)
}

fn same_time(left: f64, right: f64) -> bool {
    let scale = left.abs().max(right.abs()).max(1.0);
    (left - right).abs() <= f64::EPSILON * scale * 16.0
}

#[cfg(test)]
fn previous_f64(value: f64) -> f64 {
    if value > 0.0 {
        f64::from_bits(value.to_bits() - 1)
    } else {
        value
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct CanonicalPieceEndpoint {
    segment_index: usize,
    input_progress: f64,
}

#[derive(Debug, Clone, PartialEq)]
struct CanonicalBoundarySide {
    value: TrackValue,
    piece_endpoint: Option<CanonicalPieceEndpoint>,
}

impl CanonicalBoundarySide {
    fn new(value: &TrackValue, piece_endpoint: Option<CanonicalPieceEndpoint>) -> Self {
        Self {
            value: value.canonicalized(),
            piece_endpoint,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
struct LocalBoundaryEvent {
    progress: f64,
    left: CanonicalBoundarySide,
    right: CanonicalBoundarySide,
}

#[derive(Debug, Clone)]
struct LocalStepSegment {
    segment_index: usize,
    start_progress: f64,
    end_progress: f64,
    step_count: f64,
    step_position: AnimationStepPosition,
    from_value: TrackValue,
    to_value: TrackValue,
}

impl LocalStepSegment {
    fn boundary_event(&self, step_index: f64) -> LocalBoundaryEvent {
        let input_progress = step_index / self.step_count;
        let progress =
            self.start_progress + input_progress * (self.end_progress - self.start_progress);
        let easing = ResolvedEasing::Steps {
            count: self.step_count,
            position: self.step_position,
        };
        let left_progress = animation::apply_easing(input_progress, easing, true, 1.0);
        let right_progress = animation::apply_easing(input_progress, easing, false, 1.0);
        let piece_endpoint = Some(CanonicalPieceEndpoint {
            segment_index: self.segment_index,
            input_progress,
        });
        LocalBoundaryEvent {
            progress,
            left: CanonicalBoundarySide::new(
                &interpolate_track_values(&self.from_value, &self.to_value, left_progress),
                piece_endpoint,
            ),
            right: CanonicalBoundarySide::new(
                &interpolate_track_values(&self.from_value, &self.to_value, right_progress),
                piece_endpoint,
            ),
        }
    }
}

#[derive(Debug, Clone)]
struct LocalBoundaryPattern {
    fixed_events: Vec<LocalBoundaryEvent>,
    step_segments: Vec<LocalStepSegment>,
}

impl LocalBoundaryPattern {
    fn count_offsets_between(&self, lower: f64, upper: f64) -> f64 {
        let fixed_count = self
            .fixed_events
            .iter()
            .filter(|event| event.progress > lower && event.progress < upper)
            .count() as f64;
        self.step_segments
            .iter()
            .fold(fixed_count, |count, segment| {
                let span = segment.end_progress - segment.start_progress;
                let first = ((((lower - segment.start_progress) / span) * segment.step_count)
                    .floor()
                    + 1.0)
                    .max(1.0);
                let last =
                    ((((upper - segment.start_progress) / span) * segment.step_count).ceil() - 1.0)
                        .min(segment.step_count - 1.0);
                count + (last - first + 1.0).max(0.0)
            })
    }

    fn collect_events_between(&self, lower: f64, upper: f64, events: &mut Vec<LocalBoundaryEvent>) {
        events.extend(
            self.fixed_events
                .iter()
                .filter(|event| event.progress > lower && event.progress < upper)
                .cloned(),
        );
        for segment in &self.step_segments {
            let segment_span = segment.end_progress - segment.start_progress;
            let first_step =
                ((((lower - segment.start_progress) / segment_span) * segment.step_count).floor()
                    + 1.0)
                    .max(1.0);
            let step_end =
                ((((upper - segment.start_progress) / segment_span) * segment.step_count).ceil())
                    .min(segment.step_count);
            let mut step_index = first_step;
            while step_index < step_end {
                events.push(segment.boundary_event(step_index));
                step_index += 1.0;
            }
        }
        events.sort_by(|left, right| left.progress.total_cmp(&right.progress));
    }

    fn precision_gap_candidates(&self, lower: f64, upper: f64) -> Vec<f64> {
        let mut candidates = vec![lower, upper];
        candidates.extend(
            self.fixed_events
                .iter()
                .map(|event| event.progress)
                .filter(|progress| *progress > lower && *progress < upper),
        );
        for segment in &self.step_segments {
            let segment_span = segment.end_progress - segment.start_progress;
            let first_step =
                ((((lower - segment.start_progress) / segment_span) * segment.step_count).floor()
                    + 1.0)
                    .max(1.0);
            let step_end =
                ((((upper - segment.start_progress) / segment_span) * segment.step_count).ceil())
                    .min(segment.step_count);
            let last_step = step_end - 1.0;
            let mut step_indices = [first_step, first_step + 1.0, last_step - 1.0, last_step]
                .into_iter()
                .filter(|step_index| *step_index >= first_step && *step_index < step_end)
                .collect::<Vec<_>>();
            step_indices.sort_by(f64::total_cmp);
            step_indices.dedup_by(|left, right| *left == *right);
            for step_index in step_indices {
                candidates.push(
                    segment.start_progress + (step_index / segment.step_count) * segment_span,
                );
            }
        }
        candidates.sort_by(f64::total_cmp);
        candidates
    }

    fn first_nonincrementing_step_progress(&self, lower: f64, upper: f64) -> Option<f64> {
        const FIRST_NONINCREMENTING_INTEGER: f64 = 9_007_199_254_740_992.0;
        self.step_segments.iter().find_map(|segment| {
            let segment_span = segment.end_progress - segment.start_progress;
            let first_step =
                ((((lower - segment.start_progress) / segment_span) * segment.step_count).floor()
                    + 1.0)
                    .max(1.0);
            let step_end =
                ((((upper - segment.start_progress) / segment_span) * segment.step_count).ceil())
                    .min(segment.step_count);
            let step_index = first_step.max(FIRST_NONINCREMENTING_INTEGER);
            (step_index < step_end && step_index + 1.0 == step_index).then_some(
                segment.start_progress + (step_index / segment.step_count) * segment_span,
            )
        })
    }

    fn events_near(&self, target: f64) -> Vec<LocalBoundaryEvent> {
        let mut events = self.fixed_events.clone();
        for segment in &self.step_segments {
            let segment_span = segment.end_progress - segment.start_progress;
            let target_step = ((target - segment.start_progress) / segment_span
                * segment.step_count)
                .clamp(0.0, segment.step_count);
            let floor_step = target_step.floor();
            for step_index in [
                floor_step - 1.0,
                floor_step,
                target_step.ceil(),
                target_step.ceil() + 1.0,
            ] {
                if step_index <= 0.0 || step_index >= segment.step_count {
                    continue;
                }
                events.push(segment.boundary_event(step_index));
            }
        }
        events.sort_by(|left, right| left.progress.total_cmp(&right.progress));
        events.dedup_by(|left, right| left.progress == right.progress);
        events
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum CanonicalBoundaryCoordinate {
    DocumentStart,
    DocumentEnd,
    SourcePosition(f64),
}

#[derive(Debug, Clone, PartialEq)]
struct CanonicalBoundaryEvent {
    coordinate: CanonicalBoundaryCoordinate,
    source_position: f64,
    left: CanonicalBoundarySide,
    exact: TrackValue,
    right: CanonicalBoundarySide,
}

impl CanonicalBoundaryEvent {
    fn plan_value(&self) -> &TrackValue {
        &self.exact
    }

    fn has_observable_boundary_difference(&self) -> bool {
        self.left.value != self.exact || self.exact != self.right.value
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct BoundaryProgramWindow {
    iteration_index: f64,
    lower_progress: f64,
    upper_progress: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct PrecisionCandidatePair {
    left_time: f64,
    right_time: f64,
    nominal_gap: f64,
    rounding_error_bound: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConstructionPrecisionState {
    Constructable,
    Unconstructable,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct RepeatedBoundaryProgram {
    first_iteration: f64,
    repetitions: f64,
}

/// One immutable boundary program shared by every compiler stage.
///
/// Document/active cuts and the visible partial iteration are the bounded
/// head, complete local iterations are the compressed pattern, and the final
/// partial iteration plus active/document cuts are the tail. Count and
/// materialization therefore cannot derive different event sets or values.
#[derive(Debug, Clone)]
struct CanonicalBoundaryProgram {
    playback: DocumentPlayback,
    delay_ms: f64,
    source_duration_ms: f64,
    local_pattern: LocalBoundaryPattern,
    leading_events: Vec<CanonicalBoundaryEvent>,
    head: Option<BoundaryProgramWindow>,
    pattern: Option<RepeatedBoundaryProgram>,
    tail: Option<BoundaryProgramWindow>,
    trailing_events: Vec<CanonicalBoundaryEvent>,
    active_source_range: Option<(f64, f64)>,
    construction_precision_state: ConstructionPrecisionState,
    event_count: f64,
}

impl CanonicalBoundaryProgram {
    fn window_start_progress(window: BoundaryProgramWindow) -> f64 {
        window.lower_progress.max(0.0)
    }

    fn source_position(window: BoundaryProgramWindow, progress: f64) -> f64 {
        window.iteration_index + progress
    }

    fn coordinate_for_source_position(&self, source_position: f64) -> CanonicalBoundaryCoordinate {
        if let Some((source_start, source_end)) = self.active_source_range {
            if source_position == source_start {
                return self
                    .leading_events
                    .last()
                    .map_or(CanonicalBoundaryCoordinate::DocumentStart, |event| {
                        event.coordinate
                    });
            }
            if source_position == source_end {
                return self
                    .trailing_events
                    .first()
                    .map_or(CanonicalBoundaryCoordinate::DocumentEnd, |event| {
                        event.coordinate
                    });
            }
        }
        CanonicalBoundaryCoordinate::SourcePosition(source_position)
    }

    fn coordinate_for_window_progress(
        &self,
        window: BoundaryProgramWindow,
        progress: f64,
    ) -> CanonicalBoundaryCoordinate {
        self.coordinate_for_source_position(Self::source_position(window, progress))
    }

    fn time_ms(&self, coordinate: CanonicalBoundaryCoordinate) -> f64 {
        match coordinate {
            CanonicalBoundaryCoordinate::DocumentStart => 0.0,
            CanonicalBoundaryCoordinate::DocumentEnd => self.playback.duration_ms,
            CanonicalBoundaryCoordinate::SourcePosition(source_position) => {
                let time_ms = self.delay_ms + source_position * self.source_duration_ms;
                // SourcePosition is emitted only inside the validated active document interval.
                debug_assert!((0.0..=self.playback.duration_ms).contains(&time_ms));
                time_ms
            }
        }
    }

    fn active_start_time_ms(&self) -> f64 {
        self.leading_events
            .last()
            .map_or(0.0, |event| self.time_ms(event.coordinate))
    }

    fn canonical_local_event(
        source_position: f64,
        local_event: LocalBoundaryEvent,
    ) -> CanonicalBoundaryEvent {
        let exact = local_event.right.value.clone();
        CanonicalBoundaryEvent {
            coordinate: CanonicalBoundaryCoordinate::SourcePosition(source_position),
            source_position,
            left: local_event.left,
            exact,
            right: local_event.right,
        }
    }

    fn explicit_event_for_source_position(
        &self,
        source_position: f64,
    ) -> Option<CanonicalBoundaryEvent> {
        let (source_start, source_end) = self.active_source_range?;
        if source_position == source_start {
            return self.leading_events.last().cloned();
        }
        if source_position == source_end {
            return self.trailing_events.first().cloned();
        }
        None
    }

    fn endpoint_event_for_window_progress(
        &self,
        window: BoundaryProgramWindow,
        progress: f64,
    ) -> CanonicalBoundaryEvent {
        let source_position = Self::source_position(window, progress);
        if let Some(event) = self.explicit_event_for_source_position(source_position) {
            return event;
        }
        let local_event = self.local_pattern.fixed_events[0].clone();
        Self::canonical_local_event(source_position, local_event)
    }

    fn materialize_window(
        &self,
        window: BoundaryProgramWindow,
        boundaries: &mut Vec<CanonicalBoundaryEvent>,
    ) {
        let mut local_events = Vec::new();
        self.local_pattern.collect_events_between(
            window.lower_progress,
            window.upper_progress,
            &mut local_events,
        );
        boundaries.extend(local_events.into_iter().map(|local_event| {
            let source_position = Self::source_position(window, local_event.progress);
            Self::canonical_local_event(source_position, local_event)
        }));
    }

    fn materialize(&self) -> Vec<CanonicalBoundaryEvent> {
        let mut boundaries = self.leading_events.clone();
        if let Some(head) = self.head {
            self.materialize_window(head, &mut boundaries);
        }
        if let Some(pattern) = self.pattern {
            let mut repetition_index = 0.0;
            while repetition_index < pattern.repetitions {
                self.materialize_window(
                    BoundaryProgramWindow {
                        iteration_index: pattern.first_iteration + repetition_index,
                        lower_progress: -1.0,
                        upper_progress: 1.0,
                    },
                    &mut boundaries,
                );
                repetition_index += 1.0;
            }
        }
        if let Some(tail) = self.tail {
            self.materialize_window(tail, &mut boundaries);
        }
        boundaries.extend(self.trailing_events.iter().cloned());
        boundaries
    }

    fn representative_windows(&self) -> Vec<BoundaryProgramWindow> {
        let mut windows = Vec::new();
        if let Some(head) = self.head {
            windows.push(head);
        }
        if let Some(pattern) = self.pattern {
            let mut repetition_indices = vec![0.0];
            if pattern.repetitions > 1.0 {
                repetition_indices.push(1.0);
                repetition_indices.push(pattern.repetitions - 1.0);
            }
            repetition_indices.sort_by(f64::total_cmp);
            repetition_indices.dedup_by(|left, right| *left == *right);
            windows.extend(repetition_indices.into_iter().map(|repetition_index| {
                BoundaryProgramWindow {
                    iteration_index: pattern.first_iteration + repetition_index,
                    lower_progress: -1.0,
                    upper_progress: 1.0,
                }
            }));
        }
        if let Some(tail) = self.tail {
            windows.push(tail);
        }
        windows
    }

    fn representability_sections(&self) -> Vec<Vec<CanonicalBoundaryEvent>> {
        self.representative_windows()
            .into_iter()
            .map(|window| {
                let start_progress = Self::window_start_progress(window);
                let mut events =
                    vec![self.endpoint_event_for_window_progress(window, start_progress)];
                events.extend(
                    self.local_pattern
                        .fixed_events
                        .iter()
                        .filter(|event| {
                            event.progress > start_progress
                                && event.progress < window.upper_progress
                        })
                        .map(|event| {
                            Self::canonical_local_event(
                                Self::source_position(window, event.progress),
                                event.clone(),
                            )
                        }),
                );
                events.push(self.endpoint_event_for_window_progress(window, window.upper_progress));
                events
            })
            .collect()
    }

    fn nearby_boundary_events(&self, target_time_ms: f64) -> Vec<CanonicalBoundaryEvent> {
        let mut boundaries = self
            .leading_events
            .iter()
            .chain(&self.trailing_events)
            .cloned()
            .collect::<Vec<_>>();
        let target_position = (target_time_ms - self.delay_ms) / self.source_duration_ms;
        let target_iteration = target_position.floor();
        for iteration_index in [
            (target_iteration - 1.0).max(0.0),
            target_iteration.max(0.0),
            target_iteration + 1.0,
        ] {
            let target_progress = target_position - iteration_index;
            for local_event in self.local_pattern.events_near(target_progress) {
                let source_position = iteration_index + local_event.progress;
                if self.contains_open_source_position(source_position) {
                    boundaries.push(Self::canonical_local_event(source_position, local_event));
                }
            }
        }
        boundaries.sort_by(|left, right| {
            self.time_ms(left.coordinate)
                .total_cmp(&self.time_ms(right.coordinate))
        });
        boundaries
    }

    fn contains_open_source_position(&self, source_position: f64) -> bool {
        self.active_source_range
            .is_some_and(|(start, end)| source_position > start && source_position < end)
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
    start: &AnimationTransform2D,
    end: &AnimationTransform2D,
    progress: f64,
) -> AnimationTransform2D {
    let interpolate = |start_component: Option<f64>, end_component: Option<f64>, identity: f64| {
        let resolved_start_component = start_component.unwrap_or(identity);
        let resolved_end_component = end_component.unwrap_or(identity);
        Some(
            resolved_start_component
                + (resolved_end_component - resolved_start_component) * progress,
        )
    };
    AnimationTransform2D {
        translate_x: interpolate(start.translate_x, end.translate_x, 0.0),
        translate_y: interpolate(start.translate_y, end.translate_y, 0.0),
        scale_x: interpolate(start.scale_x, end.scale_x, 1.0),
        scale_y: interpolate(start.scale_y, end.scale_y, 1.0),
        rotate_deg: interpolate(start.rotate_deg, end.rotate_deg, 0.0),
    }
}

fn interpolate_keyframes(
    start: &AnimationKeyframe,
    end: &AnimationKeyframe,
    progress: f64,
) -> TrackValue {
    interpolate_track_values(
        &TrackValue::from_keyframe(start),
        &TrackValue::from_keyframe(end),
        progress,
    )
}

fn interpolate_track_values(start: &TrackValue, end: &TrackValue, progress: f64) -> TrackValue {
    if progress == 0.0 {
        return start.clone();
    }
    if progress == 1.0 {
        return end.clone();
    }
    TrackValue {
        opacity: match (start.opacity, end.opacity) {
            (Some(start_opacity), Some(end_opacity)) => {
                Some((start_opacity + (end_opacity - start_opacity) * progress).clamp(0.0, 1.0))
            }
            _ => None,
        },
        transform: match (start.transform.as_ref(), end.transform.as_ref()) {
            (Some(start_transform), Some(end_transform)) => Some(interpolate_transform(
                start_transform,
                end_transform,
                progress,
            )),
            _ => None,
        },
    }
}

fn transform_interpolation_is_constant(
    start: &AnimationTransform2D,
    end: &AnimationTransform2D,
) -> bool {
    start.translate_x.unwrap_or(0.0) == end.translate_x.unwrap_or(0.0)
        && start.translate_y.unwrap_or(0.0) == end.translate_y.unwrap_or(0.0)
        && start.scale_x.unwrap_or(1.0) == end.scale_x.unwrap_or(1.0)
        && start.scale_y.unwrap_or(1.0) == end.scale_y.unwrap_or(1.0)
        && start.rotate_deg.unwrap_or(0.0) == end.rotate_deg.unwrap_or(0.0)
}

fn segment_interpolation_is_constant(spec: &AnimationSpec, segment_index: usize) -> bool {
    let start_keyframe = &spec.keyframes[segment_index];
    let end_keyframe = &spec.keyframes[segment_index + 1];
    start_keyframe.opacity == end_keyframe.opacity
        && match (
            start_keyframe.transform.as_ref(),
            end_keyframe.transform.as_ref(),
        ) {
            (Some(start_transform), Some(end_transform)) => {
                transform_interpolation_is_constant(start_transform, end_transform)
            }
            (None, None) => true,
            _ => false,
        }
}

fn cubic_raw_opacity_leaves_clamp_range(
    spec: &AnimationSpec,
    segment_index: usize,
    input_start: f64,
    input_end: f64,
    curve: [f64; 4],
) -> bool {
    if (0.0..=1.0).contains(&curve[1]) && (0.0..=1.0).contains(&curve[3]) {
        return false;
    }
    let start_keyframe = &spec.keyframes[segment_index];
    let end_keyframe = &spec.keyframes[segment_index + 1];
    let (Some(start_opacity), Some(end_opacity)) = (start_keyframe.opacity, end_keyframe.opacity)
    else {
        return false;
    };
    if start_opacity == end_opacity {
        return false;
    }

    let parameter_start = parameter_for_x(curve, input_start);
    let parameter_end = parameter_for_x(curve, input_end);
    let mut parameters = vec![parameter_start, parameter_end];
    parameters.extend(
        derivative_roots(curve[1], curve[3])
            .into_iter()
            .filter(|parameter| *parameter > parameter_start && *parameter < parameter_end),
    );
    parameters.into_iter().any(|parameter| {
        let eased_progress = cubic_coordinate(parameter, curve[1], curve[3]);
        let raw_opacity = start_opacity + (end_opacity - start_opacity) * eased_progress;
        !(0.0..=1.0).contains(&raw_opacity)
    })
}

fn evaluate_segment(
    spec: &AnimationSpec,
    segment_index: usize,
    input_progress: f64,
    resolved_easing: ResolvedEasing,
    before: bool,
) -> TrackValue {
    let start_keyframe = &spec.keyframes[segment_index];
    let end_keyframe = &spec.keyframes[segment_index + 1];
    let segment_duration_ms = spec.duration_ms * (end_keyframe.at - start_keyframe.at);
    // active_piece_endpoint derives this ratio from a validated, strictly increasing interval.
    debug_assert!((0.0..=1.0).contains(&input_progress));
    let eased_progress =
        animation::apply_easing(input_progress, resolved_easing, before, segment_duration_ms);
    interpolate_keyframes(start_keyframe, end_keyframe, eased_progress)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CanonicalBoundaryDirection {
    Left,
    Right,
}

fn active_piece_endpoint(
    spec: &AnimationSpec,
    progress: f64,
    direction: CanonicalBoundaryDirection,
) -> Option<CanonicalPieceEndpoint> {
    let first = spec.keyframes.first()?;
    let last = spec.keyframes.last()?;
    let segment_index = match direction {
        CanonicalBoundaryDirection::Left => {
            if progress <= first.at || progress > last.at {
                return None;
            }
            spec.keyframes
                .windows(2)
                .position(|pair| progress > pair[0].at && progress <= pair[1].at)?
        }
        CanonicalBoundaryDirection::Right => {
            if progress < first.at || progress >= last.at {
                return None;
            }
            spec.keyframes
                .windows(2)
                .position(|pair| progress >= pair[0].at && progress < pair[1].at)?
        }
    };
    let start_keyframe = &spec.keyframes[segment_index];
    let end_keyframe = &spec.keyframes[segment_index + 1];
    let input_progress = if progress == start_keyframe.at {
        0.0
    } else if progress == end_keyframe.at {
        1.0
    } else {
        (progress - start_keyframe.at) / (end_keyframe.at - start_keyframe.at)
    };
    Some(CanonicalPieceEndpoint {
        segment_index,
        input_progress,
    })
}

fn active_boundary_side(
    spec: &AnimationSpec,
    progress: f64,
    direction: CanonicalBoundaryDirection,
    resolved_easing: ResolvedEasing,
) -> CanonicalBoundarySide {
    let piece_endpoint = active_piece_endpoint(spec, progress, direction);
    let value = piece_endpoint.map_or_else(
        || {
            let keyframe = if progress <= spec.keyframes[0].at {
                &spec.keyframes[0]
            } else {
                &spec.keyframes[spec.keyframes.len() - 1]
            };
            TrackValue::from_keyframe(keyframe)
        },
        |endpoint| {
            evaluate_segment(
                spec,
                endpoint.segment_index,
                endpoint.input_progress,
                resolved_easing,
                direction == CanonicalBoundaryDirection::Left,
            )
        },
    );
    CanonicalBoundarySide::new(&value, piece_endpoint)
}

fn inactive_boundary_side(value: &TrackValue) -> CanonicalBoundarySide {
    CanonicalBoundarySide::new(value, None)
}

fn source_boundary_side(
    source: &TrackSource,
    source_position: f64,
    direction: CanonicalBoundaryDirection,
    resolved_easing: ResolvedEasing,
) -> CanonicalBoundarySide {
    if !source_position.is_finite() {
        return inactive_boundary_side(&source.base_value);
    }
    let fill_both = source.spec.fill.as_deref() == Some("both");
    if source_position < 0.0
        || (source_position == 0.0 && direction == CanonicalBoundaryDirection::Left)
    {
        return if fill_both {
            active_boundary_side(
                &source.spec,
                0.0,
                CanonicalBoundaryDirection::Left,
                resolved_easing,
            )
        } else {
            inactive_boundary_side(&source.base_value)
        };
    }

    if let Some(iteration_count) = source_iterations(&source.spec)
        && (source_position > iteration_count
            || (source_position == iteration_count
                && direction == CanonicalBoundaryDirection::Right))
    {
        return if fill_both {
            let fraction = iteration_count.fract();
            active_boundary_side(
                &source.spec,
                if fraction == 0.0 { 1.0 } else { fraction },
                CanonicalBoundaryDirection::Right,
                resolved_easing,
            )
        } else {
            inactive_boundary_side(&source.base_value)
        };
    }

    let mut progress = source_position - source_position.floor();
    if direction == CanonicalBoundaryDirection::Left && source_position > 0.0 && progress == 0.0 {
        progress = 1.0;
    }
    active_boundary_side(&source.spec, progress, direction, resolved_easing)
}

fn document_boundary_side(
    source: &TrackSource,
    document_time_ms: f64,
    direction: CanonicalBoundaryDirection,
    resolved_easing: ResolvedEasing,
) -> CanonicalBoundarySide {
    let active_time_ms = document_time_ms - source.spec.delay_ms.unwrap_or(0.0);
    let fill_both = source.spec.fill.as_deref() == Some("both");
    if active_time_ms < 0.0
        || (active_time_ms == 0.0 && direction == CanonicalBoundaryDirection::Left)
    {
        return if fill_both {
            active_boundary_side(
                &source.spec,
                0.0,
                CanonicalBoundaryDirection::Left,
                resolved_easing,
            )
        } else {
            inactive_boundary_side(&source.base_value)
        };
    }

    if let Some(iteration_count) = source_iterations(&source.spec) {
        let active_duration_ms = source.spec.duration_ms * iteration_count;
        if active_time_ms > active_duration_ms
            || (active_time_ms == active_duration_ms
                && direction == CanonicalBoundaryDirection::Right)
        {
            return if fill_both {
                let fraction = iteration_count.fract();
                active_boundary_side(
                    &source.spec,
                    if fraction == 0.0 { 1.0 } else { fraction },
                    CanonicalBoundaryDirection::Right,
                    resolved_easing,
                )
            } else {
                inactive_boundary_side(&source.base_value)
            };
        }
        if active_time_ms == active_duration_ms {
            let fraction = iteration_count.fract();
            return active_boundary_side(
                &source.spec,
                if fraction == 0.0 { 1.0 } else { fraction },
                CanonicalBoundaryDirection::Left,
                resolved_easing,
            );
        }
    }

    let source_position = active_time_ms / source.spec.duration_ms;
    let mut progress = source_position - source_position.floor();
    if direction == CanonicalBoundaryDirection::Left && source_position > 0.0 && progress == 0.0 {
        progress = 1.0;
    }
    active_boundary_side(&source.spec, progress, direction, resolved_easing)
}

fn source_boundary_event(
    source: &TrackSource,
    source_position: f64,
    coordinate: CanonicalBoundaryCoordinate,
    resolved_easing: ResolvedEasing,
) -> CanonicalBoundaryEvent {
    let right = source_boundary_side(
        source,
        source_position,
        CanonicalBoundaryDirection::Right,
        resolved_easing,
    );
    CanonicalBoundaryEvent {
        coordinate,
        source_position,
        left: source_boundary_side(
            source,
            source_position,
            CanonicalBoundaryDirection::Left,
            resolved_easing,
        ),
        exact: right.value.clone(),
        right,
    }
}

fn local_boundary_pattern(
    spec: &AnimationSpec,
    resolved_easing: ResolvedEasing,
) -> LocalBoundaryPattern {
    let mut fixed_progresses = vec![0.0];
    fixed_progresses.extend(
        spec.keyframes
            .iter()
            .map(|keyframe| keyframe.at)
            .filter(|progress| *progress > 0.0 && *progress < 1.0),
    );
    fixed_progresses.sort_by(f64::total_cmp);
    fixed_progresses.dedup_by(|left, right| *left == *right);
    let fixed_events = fixed_progresses
        .into_iter()
        .map(|progress| LocalBoundaryEvent {
            progress,
            left: active_boundary_side(
                spec,
                if progress == 0.0 { 1.0 } else { progress },
                CanonicalBoundaryDirection::Left,
                resolved_easing,
            ),
            right: active_boundary_side(
                spec,
                progress,
                CanonicalBoundaryDirection::Right,
                resolved_easing,
            ),
        })
        .collect();
    let step_segments = match resolved_easing {
        ResolvedEasing::Steps { count, position } => spec
            .keyframes
            .windows(2)
            .enumerate()
            .map(|(segment_index, pair)| LocalStepSegment {
                segment_index,
                start_progress: pair[0].at,
                end_progress: pair[1].at,
                step_count: count,
                step_position: position,
                from_value: TrackValue::from_keyframe(&pair[0]),
                to_value: TrackValue::from_keyframe(&pair[1]),
            })
            .collect(),
        _ => Vec::new(),
    };
    LocalBoundaryPattern {
        fixed_events,
        step_segments,
    }
}

fn build_canonical_boundary_program(
    source: &TrackSource,
    playback: DocumentPlayback,
    resolved_easing: ResolvedEasing,
) -> CanonicalBoundaryProgram {
    let delay_ms = source.spec.delay_ms.unwrap_or(0.0);
    let source_duration_ms = source.spec.duration_ms;
    let local_pattern = local_boundary_pattern(&source.spec, resolved_easing);
    let document_start_position = (0.0 - delay_ms) / source_duration_ms;
    let document_end_position = (playback.duration_ms - delay_ms) / source_duration_ms;
    let finite_source_end = source_iterations(&source.spec);
    let finite_source_ended_by_document_start = finite_source_end.is_some_and(|iteration_count| {
        let active_time_at_document_start_ms = 0.0 - delay_ms;
        let active_duration_ms = source_duration_ms * iteration_count;
        active_time_at_document_start_ms >= active_duration_ms
    });
    let sampled_document_start_right = document_boundary_side(
        source,
        0.0,
        CanonicalBoundaryDirection::Right,
        resolved_easing,
    );
    let document_start_right = if finite_source_ended_by_document_start {
        inactive_boundary_side(&sampled_document_start_right.value)
    } else {
        sampled_document_start_right
    };
    let document_end_left = if finite_source_ended_by_document_start {
        document_start_right.clone()
    } else {
        document_boundary_side(
            source,
            playback.duration_ms,
            CanonicalBoundaryDirection::Left,
            resolved_easing,
        )
    };
    let document_end_exact = if finite_source_ended_by_document_start {
        document_start_right.clone()
    } else {
        document_boundary_side(
            source,
            playback.duration_ms,
            CanonicalBoundaryDirection::Right,
            resolved_easing,
        )
    };
    let mut leading_events = vec![CanonicalBoundaryEvent {
        coordinate: CanonicalBoundaryCoordinate::DocumentStart,
        source_position: document_start_position,
        left: document_end_left.clone(),
        exact: document_start_right.value.clone(),
        right: document_start_right.clone(),
    }];
    let mut trailing_events = Vec::new();

    if delay_ms > 0.0 && delay_ms < playback.duration_ms {
        leading_events.push(source_boundary_event(
            source,
            0.0,
            CanonicalBoundaryCoordinate::SourcePosition(0.0),
            resolved_easing,
        ));
    }
    if let Some(source_end) = finite_source_end {
        let source_end_time_ms = delay_ms + source_end * source_duration_ms;
        if source_end_time_ms > 0.0 && source_end_time_ms < playback.duration_ms {
            trailing_events.push(source_boundary_event(
                source,
                source_end,
                CanonicalBoundaryCoordinate::SourcePosition(source_end),
                resolved_easing,
            ));
        }
    }
    trailing_events.push(CanonicalBoundaryEvent {
        coordinate: CanonicalBoundaryCoordinate::DocumentEnd,
        source_position: document_end_position,
        left: document_end_left,
        exact: document_end_exact.value,
        right: document_start_right,
    });

    let mut head = None;
    let mut pattern = None;
    let mut tail = None;
    let mut active_source_range = None;
    let mut construction_precision_state = ConstructionPrecisionState::Constructable;
    if !spec_values_are_constant(&source.spec) && !finite_source_ended_by_document_start {
        let source_start = ((0.0 - delay_ms) / source_duration_ms).max(0.0);
        let source_end = finite_source_end
            .map_or(document_end_position, |count| {
                count.min(document_end_position)
            })
            .max(0.0);
        if !source_start.is_finite() || !source_end.is_finite() {
            construction_precision_state = ConstructionPrecisionState::Unconstructable;
        } else if source_end > source_start {
            active_source_range = Some((source_start, source_end));
            let start_iteration = source_start.floor();
            let end_iteration = source_end.floor();
            let start_progress = source_start - start_iteration;
            let end_progress = source_end - end_iteration;
            if start_iteration == end_iteration {
                head = Some(BoundaryProgramWindow {
                    iteration_index: start_iteration,
                    lower_progress: start_progress,
                    upper_progress: end_progress,
                });
            } else {
                head = Some(BoundaryProgramWindow {
                    iteration_index: start_iteration,
                    lower_progress: start_progress,
                    upper_progress: 1.0,
                });
                // source_end > source_start and distinct floors imply at least one iteration gap.
                let repetitions = end_iteration - start_iteration - 1.0;
                debug_assert!(repetitions >= 0.0);
                if repetitions > 0.0 {
                    pattern = Some(RepeatedBoundaryProgram {
                        first_iteration: start_iteration + 1.0,
                        repetitions,
                    });
                }
                if end_progress > 0.0 {
                    tail = Some(BoundaryProgramWindow {
                        iteration_index: end_iteration,
                        lower_progress: -1.0,
                        upper_progress: end_progress,
                    });
                }
            }
        }
    }

    let head_count = head.map_or(0.0, |window| {
        local_pattern.count_offsets_between(window.lower_progress, window.upper_progress)
    });
    let pattern_count = pattern.map_or(0.0, |repeated| {
        local_pattern.count_offsets_between(-1.0, 1.0) * repeated.repetitions
    });
    let tail_count = tail.map_or(0.0, |window| {
        local_pattern.count_offsets_between(window.lower_progress, window.upper_progress)
    });
    let explicit_count = (leading_events.len() + trailing_events.len()) as f64;
    let event_count = [explicit_count, head_count, pattern_count, tail_count]
        .into_iter()
        .fold(0.0, saturating_finite_stop_count);

    CanonicalBoundaryProgram {
        playback,
        delay_ms,
        source_duration_ms,
        local_pattern,
        leading_events,
        head,
        pattern,
        tail,
        trailing_events,
        active_source_range,
        construction_precision_state,
        event_count,
    }
}
fn function_piece(
    source: &TrackSource,
    program: &CanonicalBoundaryProgram,
    start_event: &CanonicalBoundaryEvent,
    end_event: &CanonicalBoundaryEvent,
    resolved_easing: ResolvedEasing,
) -> Result<FunctionPiece, EngineError> {
    let start_ms = program.time_ms(start_event.coordinate);
    let end_ms = program.time_ms(end_event.coordinate);
    let start_value = start_event.right.value.clone();
    let end_value = end_event.left.value.clone();
    let (start_endpoint, end_endpoint) = match (
        start_event.right.piece_endpoint,
        end_event.left.piece_endpoint,
    ) {
        (None, None) => {
            if start_value != end_value {
                return Err(timeline_unrepresentable(
                    source,
                    "linear-jump-unrepresentable",
                    end_ms,
                    None,
                ));
            }
            return Ok(FunctionPiece {
                start_ms,
                end_ms,
                start_value,
                end_value,
                easing: PieceEasing::Constant,
            });
        }
        (Some(start_endpoint), Some(end_endpoint))
            if start_endpoint.segment_index == end_endpoint.segment_index =>
        {
            (start_endpoint, end_endpoint)
        }
        _ => {
            return Err(timeline_unrepresentable(
                source,
                "linear-jump-unrepresentable",
                end_ms,
                None,
            ));
        }
    };
    let segment_index = start_endpoint.segment_index;
    let input_start = start_endpoint.input_progress;
    let input_end = end_endpoint.input_progress;
    match resolved_easing {
        ResolvedEasing::Steps { .. } => Ok(FunctionPiece {
            start_ms,
            end_ms,
            start_value,
            end_value,
            easing: PieceEasing::Constant,
        }),
        ResolvedEasing::Cubic(curve) => {
            if cubic_raw_opacity_leaves_clamp_range(
                &source.spec,
                segment_index,
                input_start,
                input_end,
                curve,
            ) {
                return Err(timeline_unrepresentable(
                    source,
                    "clamped-overshoot-cubic",
                    start_ms,
                    Some("Use playback mode independent for this animation track."),
                ));
            }
            if segment_interpolation_is_constant(&source.spec, segment_index) {
                return Ok(FunctionPiece {
                    start_ms,
                    end_ms,
                    start_value,
                    end_value,
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
            if time_ms == *previous_time_ms {
                return Err(timeline_precision_error(
                    "separation",
                    *previous_time_ms,
                    time_ms,
                ));
            }
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

fn resolve_track_easing(source: &TrackSource) -> Result<ResolvedEasing, EngineError> {
    animation::resolve_easing(source.spec.easing.as_ref(), &source.owner_id)
}

struct RepresentabilityFailure {
    boundary_time_ms: f64,
    tie_priority: u8,
    error: EngineError,
}

fn retain_earliest_representability_failure(
    earliest: &mut Option<RepresentabilityFailure>,
    candidate: RepresentabilityFailure,
) {
    let replace = earliest.as_ref().is_none_or(|current| {
        candidate.boundary_time_ms < current.boundary_time_ms
            || (candidate.boundary_time_ms == current.boundary_time_ms
                && candidate.tie_priority < current.tie_priority)
    });
    if replace {
        *earliest = Some(candidate);
    }
}

fn representability_error_time(error: &EngineError, fallback_time_ms: f64) -> f64 {
    match error {
        EngineError::StructuredContext { context, .. } => context["boundaryTimeMs"]
            .as_f64()
            .unwrap_or(fallback_time_ms),
        _ => fallback_time_ms,
    }
}

fn base_transition_failure(
    source: &TrackSource,
    playback: DocumentPlayback,
) -> Option<RepresentabilityFailure> {
    let boundary_time_ms = base_transition_time_ms(source, playback)?;
    let non_finite = source
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
        });
    non_finite.then(|| RepresentabilityFailure {
        boundary_time_ms,
        tie_priority: 0,
        error: timeline_unrepresentable(
            source,
            "base-transition-unrepresentable",
            boundary_time_ms,
            None,
        ),
    })
}

fn representability_preflight(
    source: &TrackSource,
    playback: DocumentPlayback,
    resolved_easing: ResolvedEasing,
    program: &CanonicalBoundaryProgram,
) -> Result<(), EngineError> {
    let mut earliest = base_transition_failure(source, playback);
    if matches!(resolved_easing, ResolvedEasing::Spring { .. }) {
        if let Some(base_failure) = earliest
            && base_failure.boundary_time_ms == 0.0
            && base_failure.tie_priority < 1
        {
            return Err(base_failure.error);
        }
        return Err(timeline_unrepresentable(
            source,
            "spring-easing",
            0.0,
            Some("Use playback mode independent for this animation track."),
        ));
    }

    if !matches!(resolved_easing, ResolvedEasing::Steps { .. }) {
        for boundaries in program.representability_sections() {
            for pair in boundaries.windows(2) {
                let [start_event, end_event] = pair else {
                    continue;
                };
                let start_ms = program.time_ms(start_event.coordinate);
                let end_ms = program.time_ms(end_event.coordinate);
                if end_ms <= start_ms {
                    continue;
                }
                let piece = match function_piece(
                    source,
                    program,
                    start_event,
                    end_event,
                    resolved_easing,
                ) {
                    Ok(piece) => piece,
                    Err(error) => {
                        let boundary_time_ms = representability_error_time(&error, start_ms);
                        retain_earliest_representability_failure(
                            &mut earliest,
                            RepresentabilityFailure {
                                boundary_time_ms,
                                tie_priority: 2,
                                error,
                            },
                        );
                        continue;
                    }
                };
                let right_value = end_event.plan_value();
                if let Err(error) = compile_piece_easing(source, &piece, right_value) {
                    retain_earliest_representability_failure(
                        &mut earliest,
                        RepresentabilityFailure {
                            boundary_time_ms: end_ms,
                            tie_priority: 2,
                            error,
                        },
                    );
                }
            }
        }
    }

    if let Some(boundary_time_ms) = final_hold_discontinuity(playback, program) {
        retain_earliest_representability_failure(
            &mut earliest,
            RepresentabilityFailure {
                boundary_time_ms,
                tie_priority: 3,
                error: timeline_unrepresentable(
                    source,
                    "final-hold-on-discontinuity",
                    boundary_time_ms,
                    None,
                ),
            },
        );
    }
    earliest.map_or(Ok(()), |failure| Err(failure.error))
}

fn final_hold_discontinuity(
    playback: DocumentPlayback,
    program: &CanonicalBoundaryProgram,
) -> Option<f64> {
    let DocumentIterationCount::Finite(iterations) = playback.iterations else {
        return None;
    };
    let fraction = iterations.fract();
    if fraction == 0.0 {
        return None;
    }
    let hold_time_ms = fraction * playback.duration_ms;
    let delta_ms = playback.delta_ms();
    let exact_start = &program.leading_events[0].right.value;
    let exact_end = &program.trailing_events[program.trailing_events.len() - 1]
        .left
        .value;
    if exact_start != exact_end && hold_time_ms < delta_ms {
        return Some(0.0);
    }

    let candidates = program.nearby_boundary_events(hold_time_ms);
    let mut discontinuities = Vec::new();
    for candidate in candidates {
        let candidate_ms = program.time_ms(candidate.coordinate);
        if candidate_ms == 0.0 || candidate.left.value == candidate.right.value {
            continue;
        }
        discontinuities.push(if candidate_ms == playback.duration_ms {
            0.0
        } else {
            candidate_ms
        });
    }
    discontinuities.sort_by(f64::total_cmp);
    discontinuities.dedup_by(|left, right| *left == *right);
    discontinuities
        .into_iter()
        .find(|boundary| (hold_time_ms - boundary).abs() < delta_ms)
}
fn compile_track(
    source: &TrackSource,
    resolved_easing: ResolvedEasing,
    program: &CanonicalBoundaryProgram,
) -> Result<DocumentTrackPlan, EngineError> {
    #[cfg(test)]
    COMPILE_TRACK_TRACE
        .lock()
        .expect("compile track trace should not be poisoned")
        .entry(std::thread::current().id())
        .or_default()
        .push(source.owner_id.clone());

    let boundaries = program.materialize();
    let mut pieces = Vec::with_capacity(boundaries.len().saturating_sub(1));
    for pair in boundaries.windows(2) {
        let [start_event, end_event] = pair else {
            continue;
        };
        let start_ms = program.time_ms(start_event.coordinate);
        let end_ms = program.time_ms(end_event.coordinate);
        if end_ms > start_ms {
            pieces.push((
                function_piece(source, program, start_event, end_event, resolved_easing)?,
                end_event,
            ));
        }
    }
    if pieces.is_empty() {
        return Err(timeline_precision_error(
            "f32-order",
            0.0,
            program.playback.duration_ms,
        ));
    }
    let exact_start = boundaries[0].right.value.clone();
    let exact_end = boundaries[boundaries.len().saturating_sub(1)]
        .left
        .value
        .clone();
    let mut keyframes = vec![DocumentKeyframe {
        time_ms: 0.0,
        value: exact_start.to_keyframe(),
        easing_to_next: None,
    }];
    let mut discontinuities_ms = Vec::new();
    for (piece, end_event) in &pieces {
        let right_value = end_event.plan_value().clone();
        if piece.end_value != right_value {
            discontinuities_ms.push(if piece.end_ms == program.playback.duration_ms {
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

fn saturating_finite_stop_count(left: f64, right: f64) -> f64 {
    let sum = left + right;
    if sum.is_finite() { sum } else { f64::MAX }
}

fn precision_check_pair(
    playback: DocumentPlayback,
    left_time_ms: f64,
    right_time_ms: f64,
) -> Result<(), EngineError> {
    let mut state = PrecisionPreflightState::new(playback);
    state.visit(left_time_ms)?;
    state.visit(right_time_ms)
}

fn source_mapping_error_bound_ms(program: &CanonicalBoundaryProgram, source_position: f64) -> f64 {
    let position_rounding = f64::EPSILON * source_position.abs();
    let scaled_position = source_position * program.source_duration_ms;
    let multiplication_rounding = f64::EPSILON * scaled_position.abs();
    let addition_rounding = f64::EPSILON * (program.delay_ms.abs() + scaled_position.abs());
    4.0 * (position_rounding * program.source_duration_ms.abs()
        + multiplication_rounding
        + addition_rounding)
}

fn coordinate_mapping_error_bound_ms(
    program: &CanonicalBoundaryProgram,
    coordinate: CanonicalBoundaryCoordinate,
) -> f64 {
    if let Some(explicit_event) = program
        .leading_events
        .iter()
        .chain(&program.trailing_events)
        .find(|event| event.coordinate == coordinate)
    {
        return if explicit_event.has_observable_boundary_difference() {
            source_mapping_error_bound_ms(program, explicit_event.source_position)
        } else {
            0.0
        };
    }

    match coordinate {
        CanonicalBoundaryCoordinate::DocumentStart | CanonicalBoundaryCoordinate::DocumentEnd => {
            0.0
        }
        CanonicalBoundaryCoordinate::SourcePosition(source_position) => {
            source_mapping_error_bound_ms(program, source_position)
        }
    }
}

fn precision_preflight_window(
    program: &CanonicalBoundaryProgram,
    window: BoundaryProgramWindow,
) -> Result<(), EngineError> {
    #[cfg(test)]
    {
        let mut trace = PREFLIGHT_WINDOW_TRACE
            .lock()
            .expect("preflight window trace should not be poisoned");
        *trace.entry(std::thread::current().id()).or_default() += 1;
    }
    let lower_progress = CanonicalBoundaryProgram::window_start_progress(window);
    let candidates = program
        .local_pattern
        .precision_gap_candidates(lower_progress, window.upper_progress);
    for pair in candidates.windows(2) {
        let [left_progress, right_progress] = pair else {
            continue;
        };
        let left_position = window.iteration_index + left_progress;
        let right_position = window.iteration_index + right_progress;
        let left_coordinate = program.coordinate_for_source_position(left_position);
        let right_coordinate = program.coordinate_for_source_position(right_position);
        let left_time_ms = program.time_ms(left_coordinate);
        let right_time_ms = program.time_ms(right_coordinate);
        let nominal_gap_ms = (right_position - left_position) * program.source_duration_ms;
        let rounding_error_bound_ms = coordinate_mapping_error_bound_ms(program, left_coordinate)
            + coordinate_mapping_error_bound_ms(program, right_coordinate);
        precision_preflight_candidate_pair(
            program,
            PrecisionCandidatePair {
                left_time: left_time_ms,
                right_time: right_time_ms,
                nominal_gap: nominal_gap_ms,
                rounding_error_bound: rounding_error_bound_ms,
            },
        )?;
    }
    if let Some(progress) = program
        .local_pattern
        .first_nonincrementing_step_progress(lower_progress, window.upper_progress)
    {
        let coordinate = program.coordinate_for_window_progress(window, progress);
        let time_ms = program.time_ms(coordinate);
        return Err(timeline_precision_error("separation", time_ms, time_ms));
    }
    Ok(())
}

fn precision_preflight_candidate_pair(
    program: &CanonicalBoundaryProgram,
    candidate: PrecisionCandidatePair,
) -> Result<(), EngineError> {
    precision_check_pair(program.playback, candidate.left_time, candidate.right_time)?;
    let minimum_separation_ms = 4.0 * program.playback.delta_ms().max(0.001);
    let proven_gap_ms = candidate.nominal_gap - candidate.rounding_error_bound;
    if !candidate.nominal_gap.is_finite()
        || !candidate.rounding_error_bound.is_finite()
        || !proven_gap_ms.is_finite()
        || proven_gap_ms < minimum_separation_ms
    {
        return Err(timeline_precision_error(
            "separation",
            candidate.left_time,
            candidate.right_time,
        ));
    }
    Ok(())
}

fn precision_preflight_events<'a>(
    program: &CanonicalBoundaryProgram,
    events: impl IntoIterator<Item = &'a CanonicalBoundaryEvent>,
) -> Result<(), EngineError> {
    let times = events
        .into_iter()
        .map(|event| program.time_ms(event.coordinate))
        .collect::<Vec<_>>();
    for pair in times.windows(2) {
        let [left_time_ms, right_time_ms] = pair else {
            continue;
        };
        precision_check_pair(program.playback, *left_time_ms, *right_time_ms)?;
    }
    Ok(())
}

fn precision_preflight_explicit_event_pairs(
    program: &CanonicalBoundaryProgram,
) -> Result<(), EngineError> {
    let mut events = program
        .leading_events
        .iter()
        .chain(&program.trailing_events);
    let Some(mut left_event) = events.next() else {
        return Ok(());
    };
    for right_event in events {
        let left_time = program.time_ms(left_event.coordinate);
        let right_time = program.time_ms(right_event.coordinate);
        if left_event.has_observable_boundary_difference()
            || right_event.has_observable_boundary_difference()
        {
            precision_preflight_candidate_pair(
                program,
                PrecisionCandidatePair {
                    left_time,
                    right_time,
                    nominal_gap: (right_event.source_position - left_event.source_position)
                        * program.source_duration_ms,
                    rounding_error_bound: coordinate_mapping_error_bound_ms(
                        program,
                        left_event.coordinate,
                    ) + coordinate_mapping_error_bound_ms(
                        program,
                        right_event.coordinate,
                    ),
                },
            )?;
        } else {
            precision_check_pair(program.playback, left_time, right_time)?;
        }
        left_event = right_event;
    }
    Ok(())
}

fn repeated_precision_window(
    pattern: RepeatedBoundaryProgram,
    repetition_index: f64,
) -> BoundaryProgramWindow {
    BoundaryProgramWindow {
        iteration_index: pattern.first_iteration + repetition_index,
        lower_progress: -1.0,
        upper_progress: 1.0,
    }
}

fn precision_preflight_repeated_pattern(
    program: &CanonicalBoundaryProgram,
    pattern: RepeatedBoundaryProgram,
) -> Result<(), EngineError> {
    precision_preflight_window(program, repeated_precision_window(pattern, 0.0))?;
    if pattern.repetitions <= 1.0 {
        return Ok(());
    }

    let last_repetition = pattern.repetitions - 1.0;
    let last_window = repeated_precision_window(pattern, last_repetition);
    let Err(last_error) = precision_preflight_window(program, last_window) else {
        return Ok(());
    };

    // The proof bound grows monotonically with a non-negative source position.
    // Locate the first failing instance without expanding the repetition.
    let mut safe_repetition = 0.0;
    let mut failing_repetition = last_repetition;
    while failing_repetition - safe_repetition > 1.0 {
        let midpoint = (safe_repetition + (failing_repetition - safe_repetition) / 2.0).floor();
        if precision_preflight_window(program, repeated_precision_window(pattern, midpoint)).is_ok()
        {
            safe_repetition = midpoint;
        } else {
            failing_repetition = midpoint;
        }
    }
    if failing_repetition == last_repetition {
        return Err(last_error);
    }
    precision_preflight_window(
        program,
        repeated_precision_window(pattern, failing_repetition),
    )
}

fn precision_preflight_program(program: &CanonicalBoundaryProgram) -> Result<(), EngineError> {
    if program.construction_precision_state == ConstructionPrecisionState::Unconstructable {
        precision_preflight_events(program, &program.leading_events)?;
        let active_start_time_ms = program.active_start_time_ms();
        return precision_check_pair(program.playback, active_start_time_ms, active_start_time_ms);
    }

    if program.active_source_range.is_none() {
        return precision_preflight_explicit_event_pairs(program);
    }

    precision_preflight_events(program, &program.leading_events)?;
    if let Some(head) = program.head {
        precision_preflight_window(program, head)?;
    }
    if let Some(pattern) = program.pattern {
        precision_preflight_repeated_pattern(program, pattern)?;
    }
    if let Some(tail) = program.tail {
        precision_preflight_window(program, tail)?;
    }
    precision_preflight_events(program, &program.trailing_events)
}

#[derive(Debug, Clone)]
struct TrackAnalysis {
    resolved_easing: ResolvedEasing,
    program: CanonicalBoundaryProgram,
}

fn preflight_document_tracks(
    sources: &[TrackSource],
    playback: DocumentPlayback,
) -> Result<(Vec<TrackAnalysis>, f64), EngineError> {
    let mut analyses = Vec::with_capacity(sources.len());
    for source in sources {
        let resolved_easing = resolve_track_easing(source)?;
        let program = build_canonical_boundary_program(source, playback, resolved_easing);
        representability_preflight(source, playback, resolved_easing, &program)?;
        analyses.push(TrackAnalysis {
            resolved_easing,
            program,
        });
    }

    for analysis in &analyses {
        precision_preflight_program(&analysis.program)?;
    }

    let stop_count = analyses.iter().fold(0.0, |count, analysis| {
        saturating_finite_stop_count(count, analysis.program.event_count)
    });
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
    let mut sources = Vec::new();
    animation::validate_animations_with_node_hooks(
        ir,
        &mut validate_authored_timeline_node,
        &mut |node| {
            collect_track_sources_at_node(node, &mut sources);
            Ok(())
        },
    )?;
    let timing = playback.css_timing(time_ms);
    let (analyses, preflight_stop_count) = preflight_document_tracks(&sources, playback)?;
    let mut tracks = Vec::with_capacity(sources.len());
    for (source, analysis) in sources.iter().zip(&analyses) {
        let track = compile_track(source, analysis.resolved_easing, &analysis.program)?;
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

    fn next_up(value: f64) -> f64 {
        if value.is_nan() || value == f64::INFINITY {
            return value;
        }
        if value == 0.0 {
            return f64::from_bits(1);
        }
        if value > 0.0 {
            f64::from_bits(value.to_bits() + 1)
        } else {
            f64::from_bits(value.to_bits() - 1)
        }
    }

    fn next_down(value: f64) -> f64 {
        if value.is_nan() || value == f64::NEG_INFINITY {
            return value;
        }
        if value == 0.0 {
            return -f64::from_bits(1);
        }
        if value > 0.0 {
            f64::from_bits(value.to_bits() - 1)
        } else {
            f64::from_bits(value.to_bits() + 1)
        }
    }

    fn domain_source(spec: AnimationSpec) -> TrackSource {
        let ir = timeline_ir(spec);
        let mut sources = Vec::new();
        collect_track_sources(&ir.root, &mut sources);
        assert_eq!(sources.len(), 1);
        sources.remove(0)
    }

    fn assert_domain_field(
        field: &str,
        value: f64,
        expected_in_domain: bool,
    ) -> Option<EngineError> {
        let mut spec = representable_linear_spec();
        match field {
            "durationMs" => spec.duration_ms = value,
            "delayMs" => spec.delay_ms = Some(value),
            "iterations" => {
                spec.iterations = Some(AnimationIterations::Count(value));
            }
            _ => panic!("unknown authored timeline field: {field}"),
        }
        let source = domain_source(spec);
        let result = validate_authored_timeline_spec_domain(source.identity(), &source.spec);
        if expected_in_domain {
            result.unwrap_or_else(|error| {
                panic!(
                    "{field}={} should be in the authored timeline domain: {error}",
                    format_js_number(value)
                )
            });
            None
        } else {
            let error = result.expect_err("value outside the authored timeline domain should fail");
            let EngineError::StructuredContext { code, context, .. } = &error else {
                panic!("authored timeline domain failures should carry structured context");
            };
            assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
            assert_eq!(context["reason"], "authored-value-out-of-domain");
            assert_eq!(context["field"], field);
            assert_eq!(context["received"], format_js_number(value));
            assert!(context.get("boundaryTimeMs").is_none());
            Some(error)
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
    fn enforces_every_authored_timeline_field_boundary_at_adjacent_f64_values() {
        for (field, lower, upper) in [
            (
                "durationMs",
                MIN_AUTHORED_TIMELINE_DURATION_MS,
                MAX_TIMELINE_DURATION_MS,
            ),
            (
                "delayMs",
                -MAX_AUTHORED_TIMELINE_DELAY_MS,
                MAX_AUTHORED_TIMELINE_DELAY_MS,
            ),
            (
                "iterations",
                MIN_AUTHORED_TIMELINE_ITERATIONS,
                MAX_TIMELINE_ITERATIONS,
            ),
        ] {
            for (value, expected_in_domain) in [
                (next_down(lower), false),
                (lower, true),
                (next_up(lower), true),
                (next_down(upper), true),
                (upper, true),
                (next_up(upper), false),
            ] {
                assert_domain_field(field, value, expected_in_domain);
            }
        }
    }

    #[test]
    fn rejects_non_finite_authored_values_and_handles_negative_zero_explicitly() {
        for field in ["durationMs", "delayMs", "iterations"] {
            for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
                assert_domain_field(field, value, false);
            }
        }

        let duration_error = assert_domain_field("durationMs", -0.0, false)
            .expect("negative-zero duration should fail");
        let EngineError::StructuredContext {
            context: duration_context,
            ..
        } = duration_error
        else {
            panic!("negative-zero duration should carry context");
        };
        assert_eq!(duration_context["received"], "0");
        assert_domain_field("delayMs", -0.0, true);
        assert_domain_field("iterations", -0.0, false);
    }

    #[test]
    fn authored_domain_failure_uses_the_reason_specific_node_and_text_unit_shapes() {
        let mut spec = representable_linear_spec();
        spec.duration_ms = next_down(MIN_AUTHORED_TIMELINE_DURATION_MS);

        let node_error =
            compile_document_animation_plan(&timeline_ir(spec.clone()), infinite_playback(), 0.0)
                .expect_err("the node track should fail at the timeline domain gate");
        let EngineError::StructuredContext {
            code,
            stage,
            node_id,
            context,
            ..
        } = node_error
        else {
            panic!("node domain failure should carry structured context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
        assert_eq!(stage.as_deref(), Some("emit"));
        assert_eq!(node_id.as_deref(), Some("animated-node"));
        assert_eq!(
            *context,
            json!({
                "ownerKind": "node",
                "ownerId": "animated-node",
                "reason": "authored-value-out-of-domain",
                "field": "durationMs",
                "received": format_js_number(spec.duration_ms),
                "migration": AUTHORED_TIMELINE_DOMAIN_MIGRATION,
            })
        );

        let text_ir = Ir {
            root: animated_text_unit("text-owner", "unit-0", &spec),
            draw_order: Vec::new(),
            width: 100.0,
            height: 20.0,
            debug: None,
            warnings: Vec::new(),
        };
        let text_error = compile_document_animation_plan(&text_ir, infinite_playback(), 0.0)
            .expect_err("the text-unit track should fail at the timeline domain gate");
        let EngineError::StructuredContext { context, .. } = text_error else {
            panic!("text-unit domain failure should carry structured context");
        };
        assert_eq!(
            *context,
            json!({
                "ownerKind": "textUnit",
                "ownerId": "text-owner",
                "reason": "authored-value-out-of-domain",
                "field": "durationMs",
                "received": format_js_number(spec.duration_ms),
                "migration": AUTHORED_TIMELINE_DOMAIN_MIGRATION,
            })
        );
    }

    #[test]
    fn matches_authored_sampler_semantics_at_the_cross_field_domain_corner() {
        let spec = AnimationSpec {
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
            duration_ms: MAX_TIMELINE_DURATION_MS,
            delay_ms: Some(-MAX_AUTHORED_TIMELINE_DELAY_MS),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: 1.0,
            iterations: DocumentIterationCount::Infinite,
        };

        for source in [
            timeline_ir(spec.clone()),
            Ir {
                root: animated_text_unit("text-owner", "unit-0", &spec),
                draw_order: Vec::new(),
                width: 100.0,
                height: 20.0,
                debug: None,
                warnings: Vec::new(),
            },
        ] {
            let plan = compile_document_animation_plan(&source, playback, 0.0)
                .expect("the exact cross-field corner should compile");
            assert_eq!(plan.tracks.len(), 1);
            assert!(
                plan.tracks[0]
                    .keyframes
                    .iter()
                    .all(|keyframe| keyframe.value.opacity == Some(1.0))
            );
        }
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
        let keyframe = |keyframe_offset, translate_x| AnimationKeyframe {
            at: keyframe_offset,
            opacity: None,
            transform: Some(AnimationTransform2D {
                translate_x: Some(translate_x),
                ..AnimationTransform2D::default()
            }),
        };
        let spec = AnimationSpec {
            keyframes: vec![keyframe(0.0, 0.0), keyframe(1.0, 100.0)],
            duration_ms: 200.0,
            delay_ms: Some(120.0),
            easing: Some(AnimationEasing::CubicBezier([0.3, 1.6, 0.7, 1.4])),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
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
    fn rejects_a_nonmonotone_document_cut_cubic_without_synthetic_extrema() {
        let spec = AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: None,
                    transform: Some(AnimationTransform2D {
                        translate_x: Some(0.0),
                        translate_y: Some(0.0),
                        scale_x: Some(1.0),
                        scale_y: Some(1.0),
                        rotate_deg: Some(0.0),
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

        let error = compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
            .expect_err("computed extrema are not canonical boundary events");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("the unrepresentable subcurve should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
        assert_eq!(context["reason"], "cubic-subcurve-unrepresentable");
        assert_eq!(context["boundaryTimeMs"], 1_100.0);
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
    fn rejects_uncut_mixed_and_opacity_only_clamped_overshoot_cubics() {
        let make_keyframe = |keyframe_offset, opacity, translate_x| AnimationKeyframe {
            at: keyframe_offset,
            opacity: Some(opacity),
            transform: Some(AnimationTransform2D {
                translate_x: Some(translate_x),
                ..AnimationTransform2D::default()
            }),
        };
        let spec = AnimationSpec {
            keyframes: vec![make_keyframe(0.0, 0.0, 0.0), make_keyframe(1.0, 1.0, 100.0)],
            duration_ms: 1_000.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::CubicBezier([0.0, 2.0, 1.0, 1.0])),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: 1_000.0,
            iterations: DocumentIterationCount::Infinite,
        };

        for source in [
            timeline_ir(spec.clone()),
            Ir {
                root: animated_text_unit("text-owner", "unit-0", &spec),
                draw_order: Vec::new(),
                width: 100.0,
                height: 20.0,
                debug: None,
                warnings: Vec::new(),
            },
        ] {
            let error = compile_document_animation_plan(&source, playback, 0.0)
                .expect_err("mixed-channel clamp plateaus are not emitted");
            let EngineError::StructuredContext { context, .. } = error else {
                panic!("the mixed overshoot should produce timeline context");
            };
            assert_eq!(context["reason"], "clamped-overshoot-cubic");
        }

        let opacity_only = AnimationSpec {
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
            duration_ms: 1_000.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::CubicBezier([0.0, 2.0, 1.0, 1.0])),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        let error = compile_document_animation_plan(&timeline_ir(opacity_only), playback, 0.0)
            .expect_err("opacity clamp plateaus are not emitted");
        let EngineError::StructuredContext { context, .. } = error else {
            panic!("the opacity overshoot should produce timeline context");
        };
        assert_eq!(context["reason"], "clamped-overshoot-cubic");
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
    fn rejects_one_ulp_final_hold_discontinuities_for_nodes_and_text_units() {
        let next_after_half = f64::from_bits(0.5_f64.to_bits() + 1);
        let opacity_spec = AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(0.5),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 0.5,
                    opacity: Some(next_after_half),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(next_after_half),
                    transform: None,
                },
            ],
            duration_ms: 200.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Steps(AnimationSteps {
                kind: "steps".to_string(),
                count: 1.0,
                position: Some("jump-end".to_string()),
            })),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        let transform_keyframe = |keyframe_offset, translate_x| AnimationKeyframe {
            at: keyframe_offset,
            opacity: None,
            transform: Some(AnimationTransform2D {
                translate_x: Some(translate_x),
                ..AnimationTransform2D::default()
            }),
        };
        let transform_spec = AnimationSpec {
            keyframes: vec![
                transform_keyframe(0.0, 0.5),
                transform_keyframe(0.5, next_after_half),
                transform_keyframe(1.0, next_after_half),
            ],
            ..opacity_spec.clone()
        };
        let playback = DocumentPlayback {
            duration_ms: 200.0,
            iterations: DocumentIterationCount::Finite(0.5),
        };

        for spec in [opacity_spec, transform_spec] {
            for source in [
                timeline_ir(spec.clone()),
                Ir {
                    root: animated_text_unit("text-owner", "unit-0", &spec),
                    draw_order: Vec::new(),
                    width: 100.0,
                    height: 20.0,
                    debug: None,
                    warnings: Vec::new(),
                },
            ] {
                let error = compile_document_animation_plan(&source, playback, 0.0)
                    .expect_err("an exact one-ULP jump at the final hold must be rejected");
                let EngineError::StructuredContext { context, .. } = error else {
                    panic!("one-ULP hold collision should produce timeline context");
                };
                assert_eq!(context["reason"], "final-hold-on-discontinuity");
                assert_eq!(context["boundaryTimeMs"], 100.0);
            }
        }
    }

    #[test]
    fn treats_sparse_and_explicit_identity_transforms_as_continuous() {
        let spec = AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: None,
                    transform: Some(AnimationTransform2D::default()),
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: None,
                    transform: Some(AnimationTransform2D {
                        translate_x: Some(0.0),
                        ..AnimationTransform2D::default()
                    }),
                },
            ],
            duration_ms: 1_000.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: 1_000.0,
            iterations: DocumentIterationCount::Finite(2.0_f64.powi(-21)),
        };

        for source in [
            timeline_ir(spec.clone()),
            Ir {
                root: animated_text_unit("text-owner", "unit-0", &spec),
                draw_order: Vec::new(),
                width: 100.0,
                height: 20.0,
                debug: None,
                warnings: Vec::new(),
            },
        ] {
            let plan = compile_document_animation_plan(&source, playback, 0.0)
                .expect("semantic identity endpoints should be continuous");
            assert_eq!(plan.tracks.len(), 1);
            assert!(plan.tracks[0].discontinuities_ms.is_empty());
            assert!(plan.tracks[0].keyframes.iter().all(|keyframe| {
                keyframe.value.transform.as_ref() == Some(&identity_animation_transform())
            }));
        }
    }

    #[test]
    fn accepts_semantic_identity_at_the_exact_authored_source_end_boundary() {
        let spec = AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: None,
                    transform: Some(AnimationTransform2D::default()),
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: None,
                    transform: Some(AnimationTransform2D {
                        translate_x: Some(0.0),
                        ..AnimationTransform2D::default()
                    }),
                },
            ],
            duration_ms: 4_096.0,
            delay_ms: Some(-MAX_AUTHORED_TIMELINE_DELAY_MS),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Count(MAX_TIMELINE_ITERATIONS)),
            fill: Some("none".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: 2.0,
            iterations: DocumentIterationCount::Infinite,
        };

        for source in [
            timeline_ir(spec.clone()),
            Ir {
                root: animated_text_unit("text-owner", "unit-0", &spec),
                draw_order: Vec::new(),
                width: 100.0,
                height: 20.0,
                debug: None,
                warnings: Vec::new(),
            },
        ] {
            let plan = compile_document_animation_plan(&source, playback, 0.75)
                .expect("an exact in-domain semantic identity source end should compile");
            assert!(plan.tracks[0].keyframes.iter().all(|keyframe| {
                keyframe.value.transform.as_ref() == Some(&identity_animation_transform())
            }));
        }
    }

    #[test]
    fn preserves_the_authored_exact_value_at_a_document_end_step_cut() {
        let spec = AnimationSpec {
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
            duration_ms: 1_000.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Steps(AnimationSteps {
                kind: "steps".to_string(),
                count: 2.0,
                position: Some("jump-end".to_string()),
            })),
            iterations: Some(AnimationIterations::Infinite("infinite".to_string())),
            fill: Some("both".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: 500.0,
            iterations: DocumentIterationCount::Finite(1.0),
        };

        for source in [
            timeline_ir(spec.clone()),
            Ir {
                root: animated_text_unit("text-owner", "unit-0", &spec),
                draw_order: Vec::new(),
                width: 100.0,
                height: 20.0,
                debug: None,
                warnings: Vec::new(),
            },
        ] {
            for (time_ms, final_hold) in [(0.0, false), (500.0, true)] {
                let plan = compile_document_animation_plan(&source, playback, time_ms)
                    .expect("a representable document-end step cut should compile");
                assert_eq!(plan.final_hold, final_hold);
                let last_keyframe = plan.tracks[0]
                    .keyframes
                    .last()
                    .expect("the document-end keyframe should exist");
                assert_eq!(last_keyframe.time_ms, 500.0);
                assert_eq!(last_keyframe.value.opacity, Some(0.5));
            }
        }
    }

    #[test]
    fn preserves_exact_linear_endpoints_for_final_hold_classification() {
        let value_a = 0.5_f64;
        let value_b = f64::from_bits(value_a.to_bits() + 1);
        let keyframe = |keyframe_offset: f64, value: f64, transform: bool| AnimationKeyframe {
            at: keyframe_offset,
            opacity: (!transform).then_some(value),
            transform: transform.then_some(AnimationTransform2D {
                translate_x: Some(value),
                ..AnimationTransform2D::default()
            }),
        };
        let playback = DocumentPlayback {
            duration_ms: 200.0,
            iterations: DocumentIterationCount::Finite(0.5),
        };

        for transform in [false, true] {
            let seam_spec = AnimationSpec {
                keyframes: vec![
                    keyframe(0.0, value_a, transform),
                    keyframe(1.0, value_b, transform),
                ],
                duration_ms: 100.0,
                delay_ms: Some(0.0),
                easing: Some(AnimationEasing::Named("linear".to_string())),
                iterations: Some(AnimationIterations::Infinite("infinite".to_string())),
                fill: Some("both".to_string()),
            };
            let continuous_spec = AnimationSpec {
                keyframes: vec![
                    keyframe(0.0, value_a, transform),
                    keyframe(0.5, value_b, transform),
                    keyframe(1.0, value_b, transform),
                ],
                duration_ms: 200.0,
                delay_ms: Some(0.0),
                easing: Some(AnimationEasing::Named("linear".to_string())),
                iterations: Some(AnimationIterations::Count(1.0)),
                fill: Some("both".to_string()),
            };

            for source in [
                timeline_ir(seam_spec.clone()),
                Ir {
                    root: animated_text_unit("text-owner", "unit-0", &seam_spec),
                    draw_order: Vec::new(),
                    width: 100.0,
                    height: 20.0,
                    debug: None,
                    warnings: Vec::new(),
                },
            ] {
                let error = compile_document_animation_plan(&source, playback, 0.0)
                    .expect_err("a one-ULP iteration seam must remain observable");
                let EngineError::StructuredContext { code, context, .. } = error else {
                    panic!("one-ULP seam should produce timeline context");
                };
                assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
                assert_eq!(context["reason"], "zero-delta-jump");
                assert_eq!(context["boundaryTimeMs"], 100.0);
            }

            for source in [
                timeline_ir(continuous_spec.clone()),
                Ir {
                    root: animated_text_unit("text-owner", "unit-0", &continuous_spec),
                    draw_order: Vec::new(),
                    width: 100.0,
                    height: 20.0,
                    debug: None,
                    warnings: Vec::new(),
                },
            ] {
                compile_document_animation_plan(&source, playback, 0.0)
                    .expect("an exact continuous keyframe boundary must remain continuous");
            }
        }
    }

    #[test]
    fn rejects_clamped_overshoot_cubic_for_nodes_and_text_units() {
        let keyframe =
            |keyframe_offset: f64, opacity: f64, with_transform: bool| AnimationKeyframe {
                at: keyframe_offset,
                opacity: Some(opacity),
                transform: with_transform.then_some(AnimationTransform2D {
                    translate_x: Some(7.0),
                    ..AnimationTransform2D::default()
                }),
            };
        let playback = DocumentPlayback {
            duration_ms: 1_000.0,
            iterations: DocumentIterationCount::Infinite,
        };

        for (duration_ms, delay_ms, curve) in [
            (1_000.0, 0.0, [0.3, 2.3, 0.7, -0.2]),
            (1_000_000.0, 0.0, [0.0, -1.0e16, 1.0, 1.0e16]),
        ] {
            for with_transform in [false, true] {
                let spec = AnimationSpec {
                    keyframes: vec![
                        keyframe(0.0, 0.0, with_transform),
                        keyframe(1.0, 1.0, with_transform),
                    ],
                    duration_ms,
                    delay_ms: Some(delay_ms),
                    easing: Some(AnimationEasing::CubicBezier(curve)),
                    iterations: Some(AnimationIterations::Count(1.0)),
                    fill: Some("both".to_string()),
                };

                for source in [
                    timeline_ir(spec.clone()),
                    Ir {
                        root: animated_text_unit("text-owner", "unit-0", &spec),
                        draw_order: Vec::new(),
                        width: 100.0,
                        height: 20.0,
                        debug: None,
                        warnings: Vec::new(),
                    },
                ] {
                    let error = compile_document_animation_plan(&source, playback, 0.0)
                        .expect_err("a clamped opacity overshoot must not be approximated");
                    let EngineError::StructuredContext { code, context, .. } = error else {
                        panic!("the overshoot should produce timeline context");
                    };
                    assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
                    assert_eq!(context["reason"], "clamped-overshoot-cubic");
                    assert_eq!(
                        context["migration"],
                        "Use playback mode independent for this animation track."
                    );
                }
            }
        }
    }

    #[test]
    fn rejects_extreme_clamped_overshoot_before_plan_expansion() {
        let keyframe =
            |keyframe_offset: f64, opacity: f64, with_transform: bool| AnimationKeyframe {
                at: keyframe_offset,
                opacity: Some(opacity),
                transform: with_transform.then_some(AnimationTransform2D {
                    translate_x: Some(7.0),
                    ..AnimationTransform2D::default()
                }),
            };
        let playback = DocumentPlayback {
            duration_ms: 1_000_000.0,
            iterations: DocumentIterationCount::Infinite,
        };

        for with_transform in [false, true] {
            let spec = AnimationSpec {
                keyframes: vec![
                    keyframe(0.0, 0.0, with_transform),
                    keyframe(1.0, 1.0, with_transform),
                ],
                duration_ms: 1_000_000.0,
                delay_ms: Some(0.0),
                easing: Some(AnimationEasing::CubicBezier([0.0, -1.0e16, 1.0, 1.0e16])),
                iterations: Some(AnimationIterations::Count(1.0)),
                fill: Some("both".to_string()),
            };

            for source in [
                timeline_ir(spec.clone()),
                Ir {
                    root: animated_text_unit("text-owner", "unit-0", &spec),
                    draw_order: Vec::new(),
                    width: 100.0,
                    height: 20.0,
                    debug: None,
                    warnings: Vec::new(),
                },
            ] {
                let test_thread_id = std::thread::current().id();
                COMPILE_TRACK_TRACE
                    .lock()
                    .expect("compile track trace should not be poisoned")
                    .entry(test_thread_id)
                    .or_default()
                    .clear();

                let error = compile_document_animation_plan(&source, playback, 0.0)
                    .expect_err("the extreme raw overshoot must fail representability");
                let EngineError::StructuredContext { code, context, .. } = error else {
                    panic!("the overshoot should produce timeline context");
                };
                assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
                assert_eq!(context["reason"], "clamped-overshoot-cubic");
                let trace = COMPILE_TRACK_TRACE
                    .lock()
                    .expect("compile track trace should not be poisoned");
                assert_eq!(trace.get(&test_thread_id), Some(&Vec::new()));
            }
        }
    }

    #[test]
    fn canonical_boundary_program_count_matches_materialization_at_document_cuts() {
        let keyframe = |keyframe_offset: f64, opacity: f64| AnimationKeyframe {
            at: keyframe_offset,
            opacity: Some(opacity),
            transform: None,
        };
        let playback = DocumentPlayback {
            duration_ms: 1_000.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let specs = [
            (
                AnimationSpec {
                    keyframes: vec![keyframe(0.0, 0.0), keyframe(1.0, 1.0)],
                    duration_ms: 3.0,
                    delay_ms: Some(-2.099_999_999_999_999_6),
                    easing: Some(AnimationEasing::Steps(AnimationSteps {
                        kind: "steps".to_string(),
                        count: 10.0,
                        position: Some("jump-end".to_string()),
                    })),
                    iterations: Some(AnimationIterations::Count(1.0)),
                    fill: Some("both".to_string()),
                },
                6.0,
            ),
            (
                AnimationSpec {
                    keyframes: vec![keyframe(0.0, 0.0), keyframe(1.0, 1.0)],
                    duration_ms: 1.0,
                    delay_ms: Some(999.666_666_666_666_6),
                    easing: Some(AnimationEasing::Steps(AnimationSteps {
                        kind: "steps".to_string(),
                        count: 3.0,
                        position: Some("jump-end".to_string()),
                    })),
                    iterations: Some(AnimationIterations::Count(1.0)),
                    fill: Some("both".to_string()),
                },
                4.0,
            ),
        ];

        for (spec, expected_event_count) in specs {
            for source in [
                timeline_ir(spec.clone()),
                Ir {
                    root: animated_text_unit("text-owner", "unit-0", &spec),
                    draw_order: Vec::new(),
                    width: 100.0,
                    height: 20.0,
                    debug: None,
                    warnings: Vec::new(),
                },
            ] {
                animation::validate_animations(&source).expect("the fixture should validate");
                let mut track_sources = Vec::new();
                collect_track_sources(&source.root, &mut track_sources);
                let track_source = &track_sources[0];
                let resolved_easing =
                    resolve_track_easing(track_source).expect("the easing should resolve");
                let program =
                    build_canonical_boundary_program(track_source, playback, resolved_easing);
                let boundaries = program.materialize();
                assert_eq!(program.event_count, expected_event_count);
                assert_eq!(program.event_count, boundaries.len() as f64);
                assert_eq!(
                    boundaries
                        .first()
                        .map(|event| program.time_ms(event.coordinate)),
                    Some(0.0)
                );
                assert_eq!(
                    boundaries
                        .last()
                        .map(|event| program.time_ms(event.coordinate)),
                    Some(playback.duration_ms)
                );
                let error = precision_preflight_program(&program)
                    .expect_err("the cut-adjacent event must fail separation");
                let EngineError::StructuredContext { context, .. } = error else {
                    panic!("the singularity should produce timeline context");
                };
                assert_eq!(context["kind"], "separation");
            }
        }
    }

    #[test]
    fn does_not_classify_continuous_keyframe_boundaries_as_final_hold_jumps() {
        for easing in [
            AnimationEasing::Named("linear".to_string()),
            AnimationEasing::Named("ease".to_string()),
        ] {
            let spec = AnimationSpec {
                keyframes: vec![
                    AnimationKeyframe {
                        at: 0.0,
                        opacity: Some(0.0),
                        transform: None,
                    },
                    AnimationKeyframe {
                        at: 0.5,
                        opacity: Some(0.5),
                        transform: None,
                    },
                    AnimationKeyframe {
                        at: 1.0,
                        opacity: Some(1.0),
                        transform: None,
                    },
                ],
                duration_ms: 200.0,
                delay_ms: Some(0.0),
                easing: Some(easing),
                iterations: Some(AnimationIterations::Count(1.0)),
                fill: Some("both".to_string()),
            };
            let playback = DocumentPlayback {
                duration_ms: 200.0,
                iterations: DocumentIterationCount::Finite(0.5),
            };
            compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
                .expect("a continuous keyframe boundary is not in the discontinuity set");
        }
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
    fn accepts_plain_linear_and_range_safe_overshoot_cubics() {
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
        overshoot.keyframes[0].opacity = Some(0.4);
        overshoot.keyframes[1].opacity = Some(0.6);
        overshoot.duration_ms = 200.0;
        overshoot.delay_ms = Some(0.0);
        overshoot.iterations = Some(AnimationIterations::Count(1.0));
        overshoot.fill = Some("both".to_string());
        let overshoot_plan =
            compile_document_animation_plan(&timeline_ir(overshoot), infinite_playback(), 0.0)
                .expect("an overshoot curve whose raw opacity stays in range should compile");
        assert_eq!(overshoot_plan.tracks[0].keyframes.len(), 2);
        assert!(matches!(
            overshoot_plan.tracks[0].keyframes[0].easing_to_next,
            Some(CompiledCssEasing::CubicBezier(_))
        ));
    }

    #[test]
    fn accepts_continuous_cubic_tracks_with_decimal_durations() {
        for duration_ms in [1_234.567_8, 999.666, 3.3, 31_415.926_535] {
            let spec = AnimationSpec {
                keyframes: vec![
                    AnimationKeyframe {
                        at: 0.0,
                        opacity: Some(0.0),
                        transform: None,
                    },
                    AnimationKeyframe {
                        at: 0.5,
                        opacity: Some(0.5),
                        transform: None,
                    },
                    AnimationKeyframe {
                        at: 1.0,
                        opacity: Some(0.0),
                        transform: None,
                    },
                ],
                duration_ms,
                delay_ms: Some(0.0),
                easing: Some(AnimationEasing::CubicBezier([0.3, 0.3, 0.7, 0.7])),
                iterations: Some(AnimationIterations::Count(4.0)),
                fill: Some("both".to_string()),
            };
            let playback = DocumentPlayback {
                duration_ms: 4.0 * duration_ms,
                iterations: DocumentIterationCount::Infinite,
            };

            let plan = compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
                .expect("a continuous cubic must not become an iteration jump");
            assert_eq!(plan.keyframe_stop_count, 9);
            assert_eq!(plan.tracks[0].keyframes.len(), 9);
            assert!(plan.tracks[0].discontinuities_ms.is_empty());
            assert!(
                plan.tracks[0]
                    .keyframes
                    .iter()
                    .take(8)
                    .all(|keyframe| matches!(
                        keyframe.easing_to_next,
                        Some(CompiledCssEasing::CubicBezier(_))
                    ))
            );
        }
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
    fn compiles_text_units_in_sample_order_and_validates_every_effective_delay() {
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

        let mut boundary_source = source.clone();
        let IrNodeKind::Text {
            unit_animation: Some(unit_animation),
            unit_animation_samples: Some(samples),
            ..
        } = &mut boundary_source.root.kind
        else {
            panic!("text-unit fixture expected");
        };
        unit_animation.delay_step_ms = Some(MAX_AUTHORED_TIMELINE_DELAY_MS);
        samples[0].bbox = None;
        compile_document_animation_plan(&boundary_source, infinite_playback(), 0.0)
            .expect("a bbox-less unit at the inclusive delay boundary should compile");

        let mut out_of_domain_source = boundary_source;
        let IrNodeKind::Text {
            unit_animation: Some(unit_animation),
            ..
        } = &mut out_of_domain_source.root.kind
        else {
            panic!("text-unit fixture expected");
        };
        unit_animation.delay_step_ms = Some(next_up(MAX_AUTHORED_TIMELINE_DELAY_MS));
        let error =
            compile_document_animation_plan(&out_of_domain_source, infinite_playback(), 0.0)
                .expect_err("a bbox-less unit delay outside the domain should fail");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("effective text-unit delay should carry timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
        assert_eq!(context["ownerKind"], "textUnit");
        assert_eq!(context["ownerId"], "copy");
        assert_eq!(context["unitId"], "unit-a");
        assert_eq!(context["reason"], "authored-value-out-of-domain");
        assert_eq!(context["field"], "delayMs");
        assert_eq!(
            context["received"],
            format_js_number(next_up(MAX_AUTHORED_TIMELINE_DELAY_MS))
        );
        assert!(context.get("boundaryTimeMs").is_none());

        let mut overflow_source = source;
        let IrNodeKind::Text {
            unit_map: Some(unit_map),
            unit_animation: Some(unit_animation),
            unit_animation_samples: Some(samples),
            ..
        } = &mut overflow_source.root.kind
        else {
            panic!("text-unit fixture expected");
        };
        unit_animation.delay_step_ms = Some(f64::MAX);
        unit_animation.order = Some(TextUnitAnimationOrder::Logical);
        let mut third_unit = unit_map.units[1].clone();
        third_unit.unit_id = "unit-c".to_string();
        third_unit.source_start = 2;
        third_unit.source_end = 3;
        third_unit.logical_order = 2;
        third_unit.visual_order = 2;
        unit_map.units.push(third_unit);
        let mut third_sample = samples[1].clone();
        third_sample.unit_id = "unit-c".to_string();
        samples.push(third_sample);
        for sample in samples {
            sample.bbox = None;
        }
        let error = compile_document_animation_plan(&overflow_source, infinite_playback(), 0.0)
            .expect_err("the first finite out-of-domain unit must precede a later overflow");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("effective text-unit delay should carry timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
        assert_eq!(context["ownerKind"], "textUnit");
        assert_eq!(context["ownerId"], "copy");
        assert_eq!(context["unitId"], "unit-b");
        assert_eq!(context["reason"], "authored-value-out-of-domain");
        assert_eq!(context["field"], "delayMs");
        assert_eq!(context["received"], format_js_number(f64::MAX));
        assert!(context.get("boundaryTimeMs").is_none());
    }

    #[test]
    fn preserves_owner_ir_order_between_existing_validation_and_the_domain_gate() {
        let mut malformed_spec = representable_linear_spec();
        malformed_spec.keyframes.pop();
        let mut out_of_domain_spec = representable_linear_spec();
        out_of_domain_spec.duration_ms = next_down(MIN_AUTHORED_TIMELINE_DURATION_MS);
        let grouped_ir = |first: (&str, AnimationSpec), second: (&str, AnimationSpec)| Ir {
            root: IrNode {
                node_id: "root".to_string(),
                bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
                kind: IrNodeKind::Group {
                    children: vec![
                        animated_group(first.0, first.1),
                        animated_group(second.0, second.1),
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

        let malformed_first = grouped_ir(
            ("malformed-first", malformed_spec.clone()),
            ("domain-second", out_of_domain_spec.clone()),
        );
        let error = compile_document_animation_plan(&malformed_first, infinite_playback(), 0.0)
            .expect_err("the first owner's existing validation error should win");
        let EngineError::Structured { code, node_id, .. } = error else {
            panic!("the first malformed owner should retain its existing error shape");
        };
        assert_eq!(code, "ANIMATION_INVALID_SPEC");
        assert_eq!(node_id.as_deref(), Some("malformed-first"));

        let domain_first = grouped_ir(
            ("domain-first", out_of_domain_spec),
            ("malformed-second", malformed_spec),
        );
        let error = compile_document_animation_plan(&domain_first, infinite_playback(), 0.0)
            .expect_err("the first owner's domain error should win");
        let EngineError::StructuredContext {
            code,
            node_id,
            context,
            ..
        } = error
        else {
            panic!("the first domain owner should carry timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
        assert_eq!(node_id.as_deref(), Some("domain-first"));
        assert_eq!(context["reason"], "authored-value-out-of-domain");
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
    fn rejects_a_duration_just_below_the_authored_domain_before_precision_preflight() {
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
            duration_ms: next_down(MIN_AUTHORED_TIMELINE_DURATION_MS),
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Infinite("infinite".to_string())),
            fill: Some("both".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: 1.0,
            iterations: DocumentIterationCount::Infinite,
        };

        let error = compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
            .expect_err("an out-of-domain duration should fail at the compile front-end");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("the authored domain gate should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
        assert_eq!(context["reason"], "authored-value-out-of-domain");
        assert_eq!(context["field"], "durationMs");
        assert_eq!(
            context["received"],
            format_js_number(next_down(MIN_AUTHORED_TIMELINE_DURATION_MS))
        );
        assert!(context.get("boundaryTimeMs").is_none());
    }

    #[test]
    fn rejects_non_finite_precision_candidate_arithmetic() {
        let source = timeline_ir(representable_linear_spec());
        let playback = infinite_playback();
        let mut track_sources = Vec::new();
        collect_track_sources(&source.root, &mut track_sources);
        let track_source = &track_sources[0];
        let resolved_easing = resolve_track_easing(track_source).expect("easing should resolve");
        let program = build_canonical_boundary_program(track_source, playback, resolved_easing);

        for (nominal_gap, rounding_error_bound) in [
            (f64::NAN, 0.0),
            (f64::INFINITY, 0.0),
            (playback.duration_ms, f64::NAN),
            (playback.duration_ms, f64::INFINITY),
        ] {
            let error = precision_preflight_candidate_pair(
                &program,
                PrecisionCandidatePair {
                    left_time: 0.0,
                    right_time: playback.duration_ms,
                    nominal_gap,
                    rounding_error_bound,
                },
            )
            .expect_err("non-finite proof arithmetic must not bypass separation");
            let EngineError::StructuredContext { code, context, .. } = error else {
                panic!("non-finite proof arithmetic should produce timeline context");
            };
            assert_eq!(code, "ANIMATED_SVG_TIMELINE_PRECISION_LOSS");
            assert_eq!(context["kind"], "separation");
            assert_eq!(context["leftTimeMs"], 0.0);
            assert_eq!(context["rightTimeMs"], playback.duration_ms);
        }
    }

    #[test]
    fn reports_unconstructable_construction_precision_from_the_typed_state() {
        let source = timeline_ir(representable_linear_spec());
        let playback = infinite_playback();
        let mut track_sources = Vec::new();
        collect_track_sources(&source.root, &mut track_sources);
        let track_source = &track_sources[0];
        let resolved_easing = resolve_track_easing(track_source).expect("easing should resolve");
        let mut program = build_canonical_boundary_program(track_source, playback, resolved_easing);
        program.construction_precision_state = ConstructionPrecisionState::Unconstructable;
        let active_start_time_ms = program.active_start_time_ms();

        let error = precision_preflight_program(&program)
            .expect_err("unconstructable state must retain the precision diagnosis");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("unconstructable state should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_PRECISION_LOSS");
        assert_eq!(context["kind"], "separation");
        assert_eq!(context["leftTimeMs"], active_start_time_ms);
        assert_eq!(context["rightTimeMs"], active_start_time_ms);
    }

    #[test]
    fn accepts_a_passing_pair_at_the_authored_delay_boundary() {
        let spec = AnimationSpec {
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
            delay_ms: Some(-MAX_AUTHORED_TIMELINE_DELAY_MS),
            easing: Some(AnimationEasing::Named("step-end".to_string())),
            iterations: Some(AnimationIterations::Infinite("infinite".to_string())),
            fill: Some("both".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: 1.0,
            iterations: DocumentIterationCount::Infinite,
        };

        let plan = compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
            .expect("an exact in-domain delay boundary should compile");
        assert_eq!(plan.tracks[0].keyframes.len(), 2);
        assert_eq!(plan.tracks[0].keyframes[0].time_ms, 0.0);
        assert_eq!(plan.tracks[0].keyframes[1].time_ms, 1.0);
        assert!(
            plan.tracks[0]
                .keyframes
                .iter()
                .all(|keyframe| keyframe.value.opacity == Some(0.0))
        );
    }

    #[test]
    fn enforces_the_authored_delay_lower_boundary_for_observable_tracks() {
        let make_spec = |delay_ms| AnimationSpec {
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
            delay_ms: Some(delay_ms),
            easing: Some(AnimationEasing::Named("step-end".to_string())),
            iterations: Some(AnimationIterations::Infinite("infinite".to_string())),
            fill: Some("both".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: 1.0,
            iterations: DocumentIterationCount::Infinite,
        };

        for delay_ms in [
            -MAX_AUTHORED_TIMELINE_DELAY_MS,
            next_down(-MAX_AUTHORED_TIMELINE_DELAY_MS),
        ] {
            let spec = make_spec(delay_ms);
            for source in [
                timeline_ir(spec.clone()),
                Ir {
                    root: animated_text_unit("text-owner", "unit-0", &spec),
                    draw_order: Vec::new(),
                    width: 100.0,
                    height: 20.0,
                    debug: None,
                    warnings: Vec::new(),
                },
            ] {
                let result = compile_document_animation_plan(&source, playback, 0.75);
                if delay_ms == -MAX_AUTHORED_TIMELINE_DELAY_MS {
                    result.expect("the exact authored delay lower boundary should compile");
                } else {
                    let error = result.expect_err("nextDown(delay lower bound) should fail");
                    let EngineError::StructuredContext { code, context, .. } = error else {
                        panic!("delay domain failure should produce timeline context");
                    };
                    assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
                    assert_eq!(context["reason"], "authored-value-out-of-domain");
                    assert_eq!(context["field"], "delayMs");
                    assert!(context.get("boundaryTimeMs").is_none());
                }
            }
        }
    }

    #[test]
    fn enforces_the_authored_iterations_upper_boundary_for_constant_tracks() {
        let make_spec = |iterations| AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(0.0),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(0.0),
                    transform: None,
                },
            ],
            duration_ms: 1.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Named("step-end".to_string())),
            iterations: Some(AnimationIterations::Count(iterations)),
            fill: Some("none".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: 1.0,
            iterations: DocumentIterationCount::Infinite,
        };

        for iterations in [MAX_TIMELINE_ITERATIONS, next_up(MAX_TIMELINE_ITERATIONS)] {
            let spec = make_spec(iterations);
            for source in [
                timeline_ir(spec.clone()),
                Ir {
                    root: animated_text_unit("text-owner", "unit-0", &spec),
                    draw_order: Vec::new(),
                    width: 100.0,
                    height: 20.0,
                    debug: None,
                    warnings: Vec::new(),
                },
            ] {
                let result = compile_document_animation_plan(&source, playback, 0.75);
                if iterations == MAX_TIMELINE_ITERATIONS {
                    result.expect("the exact authored iterations upper boundary should compile");
                } else {
                    let error = result.expect_err("nextUp(iterations upper bound) should fail");
                    let EngineError::StructuredContext { code, context, .. } = error else {
                        panic!("iterations domain failure should produce timeline context");
                    };
                    assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
                    assert_eq!(context["reason"], "authored-value-out-of-domain");
                    assert_eq!(context["field"], "iterations");
                    assert!(context.get("boundaryTimeMs").is_none());
                }
            }
        }
    }

    #[test]
    fn accepts_safe_constant_tracks_at_authored_domain_boundaries() {
        let playback = DocumentPlayback {
            duration_ms: 1.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let constant_spec =
            |opacity: f64, iterations: AnimationIterations, fill: &str| AnimationSpec {
                keyframes: vec![
                    AnimationKeyframe {
                        at: 0.0,
                        opacity: Some(opacity),
                        transform: None,
                    },
                    AnimationKeyframe {
                        at: 1.0,
                        opacity: Some(opacity),
                        transform: None,
                    },
                ],
                duration_ms: 1.0,
                delay_ms: Some(-MAX_AUTHORED_TIMELINE_DELAY_MS),
                easing: Some(AnimationEasing::Named("step-end".to_string())),
                iterations: Some(iterations),
                fill: Some(fill.to_string()),
            };

        for spec in [
            constant_spec(
                0.0,
                AnimationIterations::Infinite("infinite".to_string()),
                "none",
            ),
            constant_spec(
                0.0,
                AnimationIterations::Count(MAX_TIMELINE_ITERATIONS),
                "both",
            ),
        ] {
            for source in [
                timeline_ir(spec.clone()),
                Ir {
                    root: animated_text_unit("text-owner", "unit-0", &spec),
                    draw_order: Vec::new(),
                    width: 100.0,
                    height: 20.0,
                    debug: None,
                    warnings: Vec::new(),
                },
            ] {
                compile_document_animation_plan(&source, playback, 0.75)
                    .expect("an unobservable in-domain endpoint should compile");
            }
        }

        let matching_node_spec = constant_spec(
            0.25,
            AnimationIterations::Count(MAX_TIMELINE_ITERATIONS),
            "none",
        );
        compile_document_animation_plan(&timeline_ir(matching_node_spec), playback, 0.75)
            .expect("a node endpoint matching its base value should compile");
        let matching_text_spec = constant_spec(
            1.0,
            AnimationIterations::Count(MAX_TIMELINE_ITERATIONS),
            "none",
        );
        let matching_text_ir = Ir {
            root: animated_text_unit("text-owner", "unit-0", &matching_text_spec),
            draw_order: Vec::new(),
            width: 100.0,
            height: 20.0,
            debug: None,
            warnings: Vec::new(),
        };
        compile_document_animation_plan(&matching_text_ir, playback, 0.75)
            .expect("a text-unit endpoint matching its base value should compile");
    }

    #[test]
    fn rejects_nonobservable_events_beyond_the_authored_delay_boundary() {
        let constant_spec = |delay_ms: f64, iterations: AnimationIterations| AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(0.0),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(0.0),
                    transform: None,
                },
            ],
            duration_ms: 1.0,
            delay_ms: Some(delay_ms),
            easing: Some(AnimationEasing::Named("step-end".to_string())),
            iterations: Some(iterations),
            fill: Some("both".to_string()),
        };

        let playback = DocumentPlayback {
            duration_ms: 1.0,
            iterations: DocumentIterationCount::Infinite,
        };
        for delay_ms in [
            -MAX_AUTHORED_TIMELINE_DELAY_MS,
            next_down(-MAX_AUTHORED_TIMELINE_DELAY_MS),
        ] {
            let spec = constant_spec(
                delay_ms,
                AnimationIterations::Infinite("infinite".to_string()),
            );
            for source in [
                timeline_ir(spec.clone()),
                Ir {
                    root: animated_text_unit("text-owner", "unit-0", &spec),
                    draw_order: Vec::new(),
                    width: 100.0,
                    height: 20.0,
                    debug: None,
                    warnings: Vec::new(),
                },
            ] {
                let result = compile_document_animation_plan(&source, playback, 0.75);
                if delay_ms == -MAX_AUTHORED_TIMELINE_DELAY_MS {
                    result.expect("the exact delay boundary should remain representable");
                } else {
                    let error =
                        result.expect_err("an unobservable event must not bypass the domain gate");
                    let EngineError::StructuredContext { code, context, .. } = error else {
                        panic!("delay domain failure should produce timeline context");
                    };
                    assert_eq!(code, "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE");
                    assert_eq!(context["reason"], "authored-value-out-of-domain");
                    assert_eq!(context["field"], "delayMs");
                }
            }
        }
    }

    #[test]
    fn preserves_fill_values_at_the_authored_delay_boundaries() {
        let playback = DocumentPlayback {
            duration_ms: 1.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let boundary_spec = |keyframes: Vec<AnimationKeyframe>,
                             delay_ms: f64,
                             iterations: AnimationIterations,
                             fill: &str| AnimationSpec {
            keyframes,
            duration_ms: MIN_AUTHORED_TIMELINE_DURATION_MS,
            delay_ms: Some(delay_ms),
            easing: Some(AnimationEasing::Named("step-end".to_string())),
            iterations: Some(iterations),
            fill: Some(fill.to_string()),
        };

        for (delay_ms, iterations, fill, keyframe_opacities, authored_opacity) in [
            (
                -MAX_AUTHORED_TIMELINE_DELAY_MS,
                AnimationIterations::Count(1.0),
                "both",
                [0.0, 1.0],
                Some(1.0),
            ),
            (
                -MAX_AUTHORED_TIMELINE_DELAY_MS,
                AnimationIterations::Count(1.0),
                "none",
                [0.0, 1.0],
                None,
            ),
            (
                MAX_AUTHORED_TIMELINE_DELAY_MS,
                AnimationIterations::Count(1.0),
                "both",
                [0.0, 1.0],
                Some(0.0),
            ),
            (
                MAX_AUTHORED_TIMELINE_DELAY_MS,
                AnimationIterations::Count(1.0),
                "none",
                [0.0, 1.0],
                None,
            ),
            (
                -MAX_AUTHORED_TIMELINE_DELAY_MS,
                AnimationIterations::Infinite("infinite".to_string()),
                "none",
                [0.0, 0.0],
                Some(0.0),
            ),
        ] {
            let keyframes = vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(keyframe_opacities[0]),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(keyframe_opacities[1]),
                    transform: None,
                },
            ];
            let spec = boundary_spec(keyframes, delay_ms, iterations, fill);
            for (source, base_opacity) in [
                (timeline_ir(spec.clone()), 0.25),
                (
                    Ir {
                        root: animated_text_unit("text-owner", "unit-0", &spec),
                        draw_order: Vec::new(),
                        width: 100.0,
                        height: 20.0,
                        debug: None,
                        warnings: Vec::new(),
                    },
                    1.0,
                ),
            ] {
                let expected_opacity = authored_opacity.unwrap_or(base_opacity);
                let expected_value = TrackValue {
                    opacity: Some(expected_opacity),
                    transform: None,
                }
                .to_keyframe();
                let plan = compile_document_animation_plan(&source, playback, 0.5)
                    .expect("an opacity track should preserve its boundary phase");
                assert!(
                    plan.tracks[0]
                        .keyframes
                        .iter()
                        .all(|keyframe| keyframe.value == expected_value)
                );
            }
        }

        for (delay_ms, iterations, fill, keyframe_translate_x, expected_translate_x) in [
            (
                -MAX_AUTHORED_TIMELINE_DELAY_MS,
                AnimationIterations::Count(1.0),
                "both",
                [7.0, 9.0],
                Some(9.0),
            ),
            (
                -MAX_AUTHORED_TIMELINE_DELAY_MS,
                AnimationIterations::Count(1.0),
                "none",
                [7.0, 9.0],
                None,
            ),
            (
                MAX_AUTHORED_TIMELINE_DELAY_MS,
                AnimationIterations::Count(1.0),
                "both",
                [7.0, 9.0],
                Some(7.0),
            ),
            (
                MAX_AUTHORED_TIMELINE_DELAY_MS,
                AnimationIterations::Count(1.0),
                "none",
                [7.0, 9.0],
                None,
            ),
            (
                -MAX_AUTHORED_TIMELINE_DELAY_MS,
                AnimationIterations::Infinite("infinite".to_string()),
                "none",
                [7.0, 7.0],
                Some(7.0),
            ),
        ] {
            let keyframes = vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: None,
                    transform: Some(AnimationTransform2D {
                        translate_x: Some(keyframe_translate_x[0]),
                        ..AnimationTransform2D::default()
                    }),
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: None,
                    transform: Some(AnimationTransform2D {
                        translate_x: Some(keyframe_translate_x[1]),
                        ..AnimationTransform2D::default()
                    }),
                },
            ];
            let spec = boundary_spec(keyframes, delay_ms, iterations, fill);
            for source in [
                timeline_ir(spec.clone()),
                Ir {
                    root: animated_text_unit("text-owner", "unit-0", &spec),
                    draw_order: Vec::new(),
                    width: 100.0,
                    height: 20.0,
                    debug: None,
                    warnings: Vec::new(),
                },
            ] {
                let plan = compile_document_animation_plan(&source, playback, 0.5)
                    .expect("a transform track should preserve its boundary phase");
                let expected_value = TrackValue {
                    opacity: None,
                    transform: Some(AnimationTransform2D {
                        translate_x: expected_translate_x,
                        ..AnimationTransform2D::default()
                    }),
                }
                .canonicalized()
                .to_keyframe();
                assert!(
                    plan.tracks[0]
                        .keyframes
                        .iter()
                        .all(|keyframe| keyframe.value == expected_value)
                );
            }
        }
    }

    #[test]
    fn normalizes_empty_exact_domain_boundary_ranges_to_the_after_phase() {
        let playback = DocumentPlayback {
            duration_ms: 1.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let assert_static_after_program = |source: &Ir| {
            let mut sources = Vec::new();
            collect_track_sources(&source.root, &mut sources);
            assert_eq!(sources.len(), 1);
            let track_source = &sources[0];
            let resolved_easing =
                resolve_track_easing(track_source).expect("linear should resolve");
            let program = build_canonical_boundary_program(track_source, playback, resolved_easing);
            assert!(program.active_source_range.is_none());
            for event in program
                .leading_events
                .iter()
                .chain(program.trailing_events.iter())
            {
                assert_eq!(event.left.value, event.exact);
                assert_eq!(event.exact, event.right.value);
                assert!(event.left.piece_endpoint.is_none());
                assert!(event.right.piece_endpoint.is_none());
            }
        };
        let exact_boundary_spec = |keyframes: Vec<AnimationKeyframe>,
                                   duration_ms: f64,
                                   iterations: f64,
                                   fill: &str| AnimationSpec {
            keyframes,
            duration_ms,
            delay_ms: Some(-(duration_ms * iterations)),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Count(iterations)),
            fill: Some(fill.to_string()),
        };

        for (duration_ms, iterations, fill, authored_opacity) in [
            (MAX_TIMELINE_DURATION_MS, 1.0, "both", Some(1.0)),
            (MAX_TIMELINE_DURATION_MS, 1.0, "none", None),
            (MAX_TIMELINE_DURATION_MS, 0.5, "both", Some(0.5)),
            (MAX_TIMELINE_DURATION_MS, 0.5, "none", None),
        ] {
            let spec = exact_boundary_spec(
                vec![
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
                duration_ms,
                iterations,
                fill,
            );
            for (source, base_opacity) in [
                (timeline_ir(spec.clone()), 0.25),
                (
                    Ir {
                        root: animated_text_unit("text-owner", "unit-0", &spec),
                        draw_order: Vec::new(),
                        width: 100.0,
                        height: 20.0,
                        debug: None,
                        warnings: Vec::new(),
                    },
                    1.0,
                ),
            ] {
                assert_static_after_program(&source);
                let expected_value = TrackValue {
                    opacity: Some(authored_opacity.unwrap_or(base_opacity)),
                    transform: None,
                }
                .to_keyframe();
                let plan = compile_document_animation_plan(&source, playback, 0.5)
                    .expect("an empty exact-boundary opacity range should compile");
                assert_eq!(plan.tracks[0].keyframes.len(), 2);
                assert!(
                    plan.tracks[0]
                        .keyframes
                        .iter()
                        .all(|keyframe| keyframe.value == expected_value)
                );
            }
        }

        for (duration_ms, iterations, fill, authored_translate_x) in [
            (MAX_TIMELINE_DURATION_MS, 1.0, "both", Some(9.0)),
            (MAX_TIMELINE_DURATION_MS, 1.0, "none", None),
            (MAX_TIMELINE_DURATION_MS, 0.5, "both", Some(8.0)),
            (MAX_TIMELINE_DURATION_MS, 0.5, "none", None),
        ] {
            let spec = exact_boundary_spec(
                vec![
                    AnimationKeyframe {
                        at: 0.0,
                        opacity: None,
                        transform: Some(AnimationTransform2D {
                            translate_x: Some(7.0),
                            ..AnimationTransform2D::default()
                        }),
                    },
                    AnimationKeyframe {
                        at: 1.0,
                        opacity: None,
                        transform: Some(AnimationTransform2D {
                            translate_x: Some(9.0),
                            ..AnimationTransform2D::default()
                        }),
                    },
                ],
                duration_ms,
                iterations,
                fill,
            );
            for source in [
                timeline_ir(spec.clone()),
                Ir {
                    root: animated_text_unit("text-owner", "unit-0", &spec),
                    draw_order: Vec::new(),
                    width: 100.0,
                    height: 20.0,
                    debug: None,
                    warnings: Vec::new(),
                },
            ] {
                assert_static_after_program(&source);
                let expected_value = TrackValue {
                    opacity: None,
                    transform: Some(AnimationTransform2D {
                        translate_x: authored_translate_x,
                        ..AnimationTransform2D::default()
                    }),
                }
                .canonicalized()
                .to_keyframe();
                let plan = compile_document_animation_plan(&source, playback, 0.5)
                    .expect("an empty exact-boundary transform range should compile");
                assert_eq!(plan.tracks[0].keyframes.len(), 2);
                assert!(
                    plan.tracks[0]
                        .keyframes
                        .iter()
                        .all(|keyframe| keyframe.value == expected_value)
                );
            }
        }
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
    fn reports_the_earliest_representability_failure_within_one_owner() {
        let spec = AnimationSpec {
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
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Named("ease".to_string())),
            iterations: Some(AnimationIterations::Infinite("infinite".to_string())),
            fill: Some("both".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: 150.0,
            iterations: DocumentIterationCount::Finite(2.0_f64.powi(-21)),
        };

        for source in [
            timeline_ir(spec.clone()),
            Ir {
                root: animated_text_unit("text-owner", "unit-0", &spec),
                draw_order: Vec::new(),
                width: 100.0,
                height: 20.0,
                debug: None,
                warnings: Vec::new(),
            },
        ] {
            let error = compile_document_animation_plan(&source, playback, 0.0)
                .expect_err("the zero-time final hold must precede a later cubic seam failure");
            let EngineError::StructuredContext { context, .. } = error else {
                panic!("owner-local ordering should produce timeline context");
            };
            assert_eq!(context["reason"], "final-hold-on-discontinuity");
            assert_eq!(context["boundaryTimeMs"], 0.0);
        }
    }

    #[test]
    fn routes_fractional_final_hold_failures_through_the_earliest_collector() {
        let mut spec = opacity_spec(AnimationEasing::CubicBezier([0.3, 2.3, 0.7, -0.2]));
        spec.delay_ms = Some(50.0);

        for iterations in [4.0, 2.6] {
            let playback = DocumentPlayback {
                duration_ms: 200.0,
                iterations: DocumentIterationCount::Finite(iterations),
            };
            let error = compile_document_animation_plan(&timeline_ir(spec.clone()), playback, 0.0)
                .expect_err("the earliest clamped cubic must fail representability");
            let EngineError::StructuredContext { context, .. } = error else {
                panic!("representability should produce timeline context");
            };
            assert_eq!(context["reason"], "clamped-overshoot-cubic");
            assert_eq!(context["boundaryTimeMs"], 50.0);
        }
    }

    #[test]
    fn orders_piece_and_base_transition_failures_by_time_then_reason_priority() {
        let make_source = |iterations| {
            let transform_keyframe = |keyframe_offset, translate_x| AnimationKeyframe {
                at: keyframe_offset,
                opacity: None,
                transform: Some(AnimationTransform2D {
                    translate_x: Some(translate_x),
                    ..AnimationTransform2D::default()
                }),
            };
            let spec = AnimationSpec {
                keyframes: vec![transform_keyframe(0.0, 0.0), transform_keyframe(1.0, 100.0)],
                duration_ms: 100.0,
                delay_ms: Some(0.0),
                easing: Some(AnimationEasing::Named("ease".to_string())),
                iterations: Some(AnimationIterations::Count(iterations)),
                fill: Some("none".to_string()),
            };
            let mut source = timeline_ir(spec);
            let IrNodeKind::Group { transform, .. } = &mut source.root.kind else {
                panic!("group fixture expected");
            };
            *transform = Some(Transform2D {
                scale_x: Some(f64::MAX),
                origin_x: Some(f64::MAX),
                ..Transform2D::default()
            });
            source
        };
        let playback = DocumentPlayback {
            duration_ms: 250.0,
            iterations: DocumentIterationCount::Infinite,
        };

        let earlier_piece = compile_document_animation_plan(&make_source(2.0), playback, 0.0)
            .expect_err("the first cubic seam must precede a later base transition");
        let EngineError::StructuredContext { context, .. } = earlier_piece else {
            panic!("piece ordering should produce timeline context");
        };
        assert_eq!(context["reason"], "cubic-into-jump");
        assert_eq!(context["boundaryTimeMs"], 100.0);

        let tied = compile_document_animation_plan(&make_source(1.0), playback, 0.0)
            .expect_err("the fixed tie priority must make equal-time failures deterministic");
        let EngineError::StructuredContext { context, .. } = tied else {
            panic!("tie ordering should produce timeline context");
        };
        assert_eq!(context["reason"], "base-transition-unrepresentable");
        assert_eq!(context["boundaryTimeMs"], 100.0);
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
    fn classifies_distinct_events_at_the_same_f64_time_as_separation() {
        let playback = DocumentPlayback {
            duration_ms: 1_000.0,
            iterations: DocumentIterationCount::Infinite,
        };
        let mut state = PrecisionPreflightState::new(playback);
        state.visit(500.0).expect("the first event should pass");
        let error = state
            .visit(500.0)
            .expect_err("a distinct event at the same f64 time must fail");
        let EngineError::StructuredContext { context, .. } = error else {
            panic!("the collision should produce timeline context");
        };
        assert_eq!(context["kind"], "separation");
        assert_eq!(context["leftTimeMs"], 500.0);
        assert_eq!(context["rightTimeMs"], 500.0);
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
    fn counts_canonical_program_events_exactly_at_the_aggregate_limit() {
        let make_spec = |stop_count: usize| AnimationSpec {
            keyframes: (0..stop_count)
                .map(|index| {
                    let keyframe_offset = index as f64 / (stop_count - 1) as f64;
                    AnimationKeyframe {
                        at: keyframe_offset,
                        opacity: Some(keyframe_offset),
                        transform: None,
                    }
                })
                .collect(),
            duration_ms: 1_000.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        let grouped_ir = |specs: Vec<AnimationSpec>| Ir {
            root: IrNode {
                node_id: "root".to_string(),
                bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
                kind: IrNodeKind::Group {
                    children: specs
                        .into_iter()
                        .enumerate()
                        .map(|(index, spec)| animated_group(&format!("owner-{index}"), spec))
                        .collect(),
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
            duration_ms: 1_000.0,
            iterations: DocumentIterationCount::Infinite,
        };

        let at_limit =
            compile_document_animation_plan(&grouped_ir(vec![make_spec(4); 4_096]), playback, 0.0)
                .expect("4,096 four-event programs are exactly within the inclusive limit");
        assert_eq!(at_limit.keyframe_stop_count, MAX_TIMELINE_KEYFRAME_STOPS);

        let mut above_limit_specs = vec![make_spec(4); 4_095];
        above_limit_specs.push(make_spec(5));
        let test_thread_id = std::thread::current().id();
        COMPILE_TRACK_TRACE
            .lock()
            .expect("compile track trace should not be poisoned")
            .entry(test_thread_id)
            .or_default()
            .clear();
        let error = compile_document_animation_plan(&grouped_ir(above_limit_specs), playback, 0.0)
            .expect_err("the 16,385th program event must fail before materialization");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("the aggregate stop limit should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_LIMIT");
        assert_eq!(context["actual"], 16_385.0);
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
    fn rejects_repeated_linear_rounding_bound_with_bounded_preflight_visits() {
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
            duration_ms: 32_768.0,
            delay_ms: Some(0.0),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Infinite("infinite".to_string())),
            fill: Some("both".to_string()),
        };
        let playback = DocumentPlayback {
            duration_ms: MAX_TIMELINE_DURATION_MS,
            iterations: DocumentIterationCount::Infinite,
        };
        let test_thread_id = std::thread::current().id();
        PREFLIGHT_WINDOW_TRACE
            .lock()
            .expect("preflight window trace should not be poisoned")
            .insert(test_thread_id, 0);

        let error = compile_document_animation_plan(&timeline_ir(spec), playback, 0.0)
            .expect_err("the repeated linear mapping must preserve the separation margin");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("repeated linear precision should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_PRECISION_LOSS");
        assert_eq!(context["kind"], "separation");
        let visits = PREFLIGHT_WINDOW_TRACE
            .lock()
            .expect("preflight window trace should not be poisoned")
            .get(&test_thread_id)
            .copied()
            .unwrap_or_default();
        assert!(
            visits <= 32,
            "preflight visited {visits} expanded stops instead of a bounded pattern"
        );
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
        assert_eq!(context["rightTimeMs"], 1.0e-308);
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
    fn mixed_track_semantic_expansion_matches_the_two_pass_stop_count() {
        const TRACK_COUNT: usize = 11;
        const FOUR_STOP_TRACKS: usize = 4;
        const STEP_TRACKS: usize = 7;
        const INFINITE_TRACKS: usize = 3;
        const EXPECTED_STOPS: usize = 37;

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
                    &format!("count-check-{track_index}"),
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
        let plan =
            compile_document_animation_plan_with_prefix(&ir, playback, 0.0, "count-check-", false)
                .expect("mixed semantic expansion should compile");

        assert_eq!(plan.tracks.len(), TRACK_COUNT);
        assert_eq!(plan.keyframe_stop_count, EXPECTED_STOPS);
        assert_eq!(
            plan.exact_css_bytes,
            crate::svg_emit::emitter::timeline_plan_css_byte_count(&plan, "count-check-", false,)
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
