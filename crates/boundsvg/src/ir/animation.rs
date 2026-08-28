//! Deterministic sampling for post-layout opacity and transform animation.

use std::collections::{HashMap, HashSet};

use boundshape::Transform2D;

use super::types::{
    AnimationEasing, AnimationIterations, AnimationKeyframe, AnimationSpec, AnimationSpring,
    AnimationTransform2D, Ir, IrNode, IrNodeKind, MAX_TEXT_ANIMATION_FRAGMENTS,
    MAX_TEXT_ANIMATION_UNITS, TextUnitAnimationOrder,
};
use crate::error::EngineError;

const DEFAULT_EASING: [f64; 4] = [0.25, 0.1, 0.25, 1.0];

const SPRING_DEFAULT_STIFFNESS: f64 = 100.0;
const SPRING_DEFAULT_DAMPING: f64 = 10.0;
const SPRING_DEFAULT_MASS: f64 = 1.0;
const SPRING_STIFFNESS_MIN: f64 = 1.0;
const SPRING_STIFFNESS_MAX: f64 = 1000.0;
const SPRING_DAMPING_MIN: f64 = 1.0;
const SPRING_DAMPING_MAX: f64 = 100.0;
const SPRING_MASS_MIN: f64 = 0.1;
const SPRING_MASS_MAX: f64 = 10.0;
/// Damping ratios within this distance of 1 use the critically damped closed form.
const SPRING_CRITICAL_EPSILON: f64 = 1.0e-9;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AnimationStepPosition {
    Start,
    End,
    None,
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum ResolvedEasing {
    Cubic([f64; 4]),
    Steps {
        count: f64,
        position: AnimationStepPosition,
    },
    Spring {
        /// Undamped angular frequency in rad/s.
        omega0: f64,
        /// Damping ratio.
        zeta: f64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AnimationPhase {
    Before,
    Active,
    After,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct TimelineSample {
    phase: AnimationPhase,
    progress: f64,
}

fn animation_error(node_id: &str, message: &str) -> EngineError {
    EngineError::Structured {
        code: "ANIMATION_INVALID_SPEC".to_string(),
        message: format!("Invalid animation: {message}"),
        stage: Some("validate".to_string()),
        node_id: Some(node_id.to_string()),
    }
}

fn finite(value: f64) -> bool {
    value.is_finite()
}

/// Validate an animation spec at the IR trust boundary.
///
/// # Errors
///
/// Returns a structured `ANIMATION_INVALID_SPEC` error for malformed values.
pub fn validate_animation_spec(spec: &AnimationSpec, node_id: &str) -> Result<(), EngineError> {
    if spec.keyframes.len() < 2 {
        return Err(animation_error(
            node_id,
            "keyframes must contain at least two entries",
        ));
    }
    if !finite(spec.duration_ms) || spec.duration_ms <= 0.0 {
        return Err(animation_error(
            node_id,
            "durationMs must be a positive finite number",
        ));
    }
    if spec.delay_ms.is_some_and(|delay| !finite(delay)) {
        return Err(animation_error(node_id, "delayMs must be finite"));
    }
    match spec.iterations.as_ref() {
        Some(AnimationIterations::Count(count)) if !finite(*count) || *count <= 0.0 => {
            return Err(animation_error(
                node_id,
                "iterations must be positive or infinite",
            ));
        }
        Some(AnimationIterations::Infinite(value)) if value != "infinite" => {
            return Err(animation_error(
                node_id,
                "iterations string must be infinite",
            ));
        }
        _ => {}
    }
    if spec
        .fill
        .as_deref()
        .is_some_and(|fill| fill != "none" && fill != "both")
    {
        return Err(animation_error(node_id, "fill must be none or both"));
    }
    resolve_easing(spec.easing.as_ref(), node_id)?;

    let mut previous_at = f64::NEG_INFINITY;
    let mut animates_opacity = false;
    let mut animates_transform = false;
    for (index, keyframe) in spec.keyframes.iter().enumerate() {
        if !finite(keyframe.at) || !(0.0..=1.0).contains(&keyframe.at) {
            return Err(animation_error(
                node_id,
                &format!("keyframe {index} at must be in 0..1"),
            ));
        }
        if keyframe.at <= previous_at {
            return Err(animation_error(
                node_id,
                "keyframe at values must be strictly increasing",
            ));
        }
        previous_at = keyframe.at;
        if let Some(opacity) = keyframe.opacity {
            if !finite(opacity) || !(0.0..=1.0).contains(&opacity) {
                return Err(animation_error(
                    node_id,
                    &format!("keyframe {index} opacity must be in 0..1"),
                ));
            }
            animates_opacity = true;
        }
        if let Some(transform) = &keyframe.transform {
            validate_transform(transform, node_id, index)?;
            animates_transform = true;
        }
    }
    if !animates_opacity && !animates_transform {
        return Err(animation_error(
            node_id,
            "keyframes must animate opacity or transform",
        ));
    }
    for (index, keyframe) in spec.keyframes.iter().enumerate() {
        if animates_opacity && keyframe.opacity.is_none() {
            return Err(animation_error(
                node_id,
                &format!("keyframe {index} must define opacity"),
            ));
        }
        if animates_transform && keyframe.transform.is_none() {
            return Err(animation_error(
                node_id,
                &format!("keyframe {index} must define transform"),
            ));
        }
    }
    Ok(())
}

fn validate_transform(
    transform: &AnimationTransform2D,
    node_id: &str,
    index: usize,
) -> Result<(), EngineError> {
    for value in [
        transform.translate_x,
        transform.translate_y,
        transform.scale_x,
        transform.scale_y,
        transform.rotate_deg,
    ]
    .into_iter()
    .flatten()
    {
        if !finite(value) {
            return Err(animation_error(
                node_id,
                &format!("keyframe {index} transform values must be finite"),
            ));
        }
    }
    Ok(())
}

fn resolve_step_position(
    position: Option<&str>,
    node_id: &str,
) -> Result<AnimationStepPosition, EngineError> {
    match position.unwrap_or("jump-end") {
        "jump-start" => Ok(AnimationStepPosition::Start),
        "jump-end" => Ok(AnimationStepPosition::End),
        "jump-none" => Ok(AnimationStepPosition::None),
        "jump-both" => Ok(AnimationStepPosition::Both),
        _ => Err(animation_error(
            node_id,
            "unsupported steps easing position",
        )),
    }
}

fn check_spring_range(
    value: f64,
    min: f64,
    max: f64,
    field: &str,
    node_id: &str,
) -> Result<f64, EngineError> {
    if !finite(value) || value < min || value > max {
        return Err(animation_error(
            node_id,
            &format!("spring easing {field} must be in {min}..{max}"),
        ));
    }
    Ok(value)
}

/// Apply the spring defaults and derive the undamped angular frequency and
/// damping ratio.
///
/// Single source for both the static sampler and the CSS `linear()` expansion,
/// so a change to the defaults can never move only one of them.
fn spring_params(spring: &AnimationSpring) -> (f64, f64) {
    let stiffness = spring.stiffness.unwrap_or(SPRING_DEFAULT_STIFFNESS);
    let damping = spring.damping.unwrap_or(SPRING_DEFAULT_DAMPING);
    let mass = spring.mass.unwrap_or(SPRING_DEFAULT_MASS);
    let omega0 = (stiffness / mass).sqrt();
    let zeta = damping / (2.0 * (stiffness * mass).sqrt());
    (omega0, zeta)
}

/// Validate a spring spec and resolve it to its angular frequency and damping ratio.
fn resolve_spring(spring: &AnimationSpring, node_id: &str) -> Result<(f64, f64), EngineError> {
    if spring.kind != "spring" {
        return Err(animation_error(
            node_id,
            "spring easing type must be spring",
        ));
    }
    check_spring_range(
        spring.stiffness.unwrap_or(SPRING_DEFAULT_STIFFNESS),
        SPRING_STIFFNESS_MIN,
        SPRING_STIFFNESS_MAX,
        "stiffness",
        node_id,
    )?;
    check_spring_range(
        spring.damping.unwrap_or(SPRING_DEFAULT_DAMPING),
        SPRING_DAMPING_MIN,
        SPRING_DAMPING_MAX,
        "damping",
        node_id,
    )?;
    check_spring_range(
        spring.mass.unwrap_or(SPRING_DEFAULT_MASS),
        SPRING_MASS_MIN,
        SPRING_MASS_MAX,
        "mass",
        node_id,
    )?;
    Ok(spring_params(spring))
}

/// Evaluate the unit step response of a damped spring at segment progress `progress`.
///
/// `progress` is normalized within one keyframe segment; the physical time is
/// recovered from `segment_duration_ms`. Overshoot above 1 is intentional, but
/// the segment end is clamped so the final keyframe value is always reached.
fn apply_spring_easing(progress: f64, omega0: f64, zeta: f64, segment_duration_ms: f64) -> f64 {
    if progress <= 0.0 {
        return 0.0;
    }
    if progress >= 1.0 {
        return 1.0;
    }
    let time_s = progress * (segment_duration_ms / 1000.0);
    let decay = zeta * omega0;
    if (zeta - 1.0).abs() <= SPRING_CRITICAL_EPSILON {
        return 1.0 - (-omega0 * time_s).exp() * (1.0 + omega0 * time_s);
    }
    if zeta < 1.0 {
        let omega_d = omega0 * (1.0 - zeta * zeta).sqrt();
        return 1.0
            - (-decay * time_s).exp()
                * ((omega_d * time_s).cos() + (decay / omega_d) * (omega_d * time_s).sin());
    }
    let offset = omega0 * (zeta * zeta - 1.0).sqrt();
    let root1 = -decay + offset;
    let root2 = -decay - offset;
    let first_weight = -root2 / (root1 - root2);
    let second_weight = -root1 / (root1 - root2);
    1.0 - (first_weight * (root1 * time_s).exp() - second_weight * (root2 * time_s).exp())
}

/// Evaluate a spring easing outside validation, for CSS `linear()` expansion.
///
/// Callers run after `validate_animations`, so out-of-range parameters cannot
/// reach here; the defaults still apply to omitted fields.
pub(crate) fn sample_spring_progress(
    spring: &AnimationSpring,
    progress: f64,
    segment_duration_ms: f64,
) -> f64 {
    let (omega0, zeta) = spring_params(spring);
    apply_spring_easing(progress, omega0, zeta, segment_duration_ms)
}

fn resolve_easing(
    easing: Option<&AnimationEasing>,
    node_id: &str,
) -> Result<ResolvedEasing, EngineError> {
    let resolved = match easing {
        None => ResolvedEasing::Cubic(DEFAULT_EASING),
        Some(AnimationEasing::Named(name)) => match name.as_str() {
            "linear" => ResolvedEasing::Cubic([0.0, 0.0, 1.0, 1.0]),
            "ease" => ResolvedEasing::Cubic(DEFAULT_EASING),
            "ease-in" => ResolvedEasing::Cubic([0.42, 0.0, 1.0, 1.0]),
            "ease-out" => ResolvedEasing::Cubic([0.0, 0.0, 0.58, 1.0]),
            "ease-in-out" => ResolvedEasing::Cubic([0.42, 0.0, 0.58, 1.0]),
            "step-start" => ResolvedEasing::Steps {
                count: 1.0,
                position: AnimationStepPosition::Start,
            },
            "step-end" => ResolvedEasing::Steps {
                count: 1.0,
                position: AnimationStepPosition::End,
            },
            _ => return Err(animation_error(node_id, "unsupported easing name")),
        },
        Some(AnimationEasing::CubicBezier(curve)) => ResolvedEasing::Cubic(*curve),
        Some(AnimationEasing::Spring(spring)) => {
            let (omega0, zeta) = resolve_spring(spring, node_id)?;
            ResolvedEasing::Spring { omega0, zeta }
        }
        Some(AnimationEasing::Steps(steps)) => {
            if steps.kind != "steps" {
                return Err(animation_error(node_id, "steps easing type must be steps"));
            }
            if !finite(steps.count) || steps.count <= 0.0 || steps.count.fract() != 0.0 {
                return Err(animation_error(
                    node_id,
                    "steps easing count must be a positive integer",
                ));
            }
            let position = resolve_step_position(steps.position.as_deref(), node_id)?;
            if position == AnimationStepPosition::None && steps.count < 2.0 {
                return Err(animation_error(
                    node_id,
                    "steps easing with jump-none requires count >= 2",
                ));
            }
            ResolvedEasing::Steps {
                count: steps.count,
                position,
            }
        }
    };
    if let ResolvedEasing::Cubic(curve) = resolved {
        if curve.iter().any(|value| !finite(*value))
            || !(0.0..=1.0).contains(&curve[0])
            || !(0.0..=1.0).contains(&curve[2])
        {
            return Err(animation_error(
                node_id,
                "cubic-bezier x coordinates must be in 0..1 and all values finite",
            ));
        }
    }
    Ok(resolved)
}

fn cubic_coordinate(t: f64, first: f64, second: f64) -> f64 {
    let inverse = 1.0 - t;
    3.0 * inverse * inverse * t * first + 3.0 * inverse * t * t * second + t * t * t
}

fn cubic_derivative(t: f64, first: f64, second: f64) -> f64 {
    3.0 * (1.0 - t) * (1.0 - t) * first
        + 6.0 * (1.0 - t) * t * (second - first)
        + 3.0 * t * t * (1.0 - second)
}

fn apply_cubic_easing(progress: f64, curve: [f64; 4]) -> f64 {
    if progress <= 0.0 || progress >= 1.0 {
        return progress.clamp(0.0, 1.0);
    }
    let [x1, y1, x2, y2] = curve;
    let mut parameter = progress;
    for _ in 0..8 {
        let difference = cubic_coordinate(parameter, x1, x2) - progress;
        if difference.abs() <= 1.0e-7 {
            return cubic_coordinate(parameter, y1, y2);
        }
        let derivative = cubic_derivative(parameter, x1, x2);
        if derivative.abs() <= 1.0e-7 {
            break;
        }
        let next = parameter - difference / derivative;
        if !(0.0..=1.0).contains(&next) {
            break;
        }
        parameter = next;
    }

    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..30 {
        parameter = f64::midpoint(low, high);
        if cubic_coordinate(parameter, x1, x2) < progress {
            low = parameter;
        } else {
            high = parameter;
        }
    }
    cubic_coordinate(parameter, y1, y2)
}

fn apply_step_easing(
    progress: f64,
    count: f64,
    position: AnimationStepPosition,
    before: bool,
) -> f64 {
    let scaled = progress * count;
    let mut current_step = scaled.floor();
    if matches!(
        position,
        AnimationStepPosition::Start | AnimationStepPosition::Both
    ) {
        current_step += 1.0;
    }
    if before && scaled.fract() == 0.0 {
        current_step -= 1.0;
    }
    if progress >= 0.0 {
        current_step = current_step.max(0.0);
    }
    let jumps = match position {
        AnimationStepPosition::Start | AnimationStepPosition::End => count,
        AnimationStepPosition::None => count - 1.0,
        AnimationStepPosition::Both => count + 1.0,
    };
    if progress <= 1.0 {
        current_step = current_step.min(jumps);
    }
    current_step / jumps
}

fn apply_easing(
    progress: f64,
    easing: ResolvedEasing,
    before: bool,
    segment_duration_ms: f64,
) -> f64 {
    match easing {
        ResolvedEasing::Cubic(curve) => apply_cubic_easing(progress, curve),
        ResolvedEasing::Steps { count, position } => {
            apply_step_easing(progress, count, position, before)
        }
        ResolvedEasing::Spring { omega0, zeta } => {
            apply_spring_easing(progress, omega0, zeta, segment_duration_ms)
        }
    }
}

fn timeline_sample_with_delay(
    spec: &AnimationSpec,
    time_ms: f64,
    effective_delay_ms: f64,
) -> Option<TimelineSample> {
    let active_time = time_ms - effective_delay_ms;
    let fill_both = spec.fill.as_deref() == Some("both");
    if active_time < 0.0 {
        return fill_both.then_some(TimelineSample {
            phase: AnimationPhase::Before,
            progress: 0.0,
        });
    }

    let iteration_count = match spec.iterations.as_ref() {
        Some(AnimationIterations::Count(count)) => Some(*count),
        Some(AnimationIterations::Infinite(_)) => None,
        None => Some(1.0),
    };
    if let Some(count) = iteration_count {
        let active_duration = spec.duration_ms * count;
        if active_time >= active_duration {
            if !fill_both {
                return None;
            }
            let fraction = count.fract();
            return Some(TimelineSample {
                phase: AnimationPhase::After,
                progress: if fraction == 0.0 { 1.0 } else { fraction },
            });
        }
    }
    let iteration_position = active_time / spec.duration_ms;
    Some(TimelineSample {
        phase: AnimationPhase::Active,
        progress: iteration_position - iteration_position.floor(),
    })
}

fn keyframe_segment(
    keyframes: &[AnimationKeyframe],
    progress: f64,
) -> Option<(&AnimationKeyframe, &AnimationKeyframe, f64)> {
    let first = keyframes.first()?;
    let last = keyframes.last()?;
    if progress < first.at {
        return Some((first, first, 0.0));
    }
    if progress >= last.at {
        return Some((last, last, 0.0));
    }
    for pair in keyframes.windows(2) {
        let [from, to] = pair else {
            continue;
        };
        if progress <= to.at {
            return Some((from, to, (progress - from.at) / (to.at - from.at)));
        }
    }
    Some((last, last, 0.0))
}

fn lerp(from: f64, to: f64, progress: f64) -> f64 {
    from + (to - from) * progress
}

fn transform_channel(value: Option<f64>, identity: f64) -> f64 {
    value.unwrap_or(identity)
}

fn sample_transform(
    from: &AnimationTransform2D,
    to: &AnimationTransform2D,
    progress: f64,
    bbox_width: f64,
    bbox_height: f64,
) -> Transform2D {
    Transform2D {
        translate_x: Some(lerp(
            transform_channel(from.translate_x, 0.0),
            transform_channel(to.translate_x, 0.0),
            progress,
        )),
        translate_y: Some(lerp(
            transform_channel(from.translate_y, 0.0),
            transform_channel(to.translate_y, 0.0),
            progress,
        )),
        scale_x: Some(lerp(
            transform_channel(from.scale_x, 1.0),
            transform_channel(to.scale_x, 1.0),
            progress,
        )),
        scale_y: Some(lerp(
            transform_channel(from.scale_y, 1.0),
            transform_channel(to.scale_y, 1.0),
            progress,
        )),
        rotate_deg: Some(lerp(
            transform_channel(from.rotate_deg, 0.0),
            transform_channel(to.rotate_deg, 0.0),
            progress,
        )),
        origin_x: Some(bbox_width / 2.0),
        origin_y: Some(bbox_height / 2.0),
    }
}

fn sample_spec(
    spec: &AnimationSpec,
    node_id: &str,
    time_ms: f64,
    effective_delay_ms: f64,
    bbox_width: f64,
    bbox_height: f64,
) -> Result<(Option<f64>, Option<Transform2D>), EngineError> {
    let Some(timeline_sample) = timeline_sample_with_delay(spec, time_ms, effective_delay_ms)
    else {
        return Ok((None, None));
    };
    let easing = resolve_easing(spec.easing.as_ref(), node_id)?;
    let Some((from, to, local_progress)) =
        keyframe_segment(&spec.keyframes, timeline_sample.progress)
    else {
        return Err(animation_error(
            node_id,
            "keyframes must contain at least two entries",
        ));
    };
    // Easing is applied per keyframe segment, so a spring's physical time runs
    // over that segment's share of the iteration duration.
    let segment_duration_ms = spec.duration_ms * (to.at - from.at);
    let eased_progress = apply_easing(
        local_progress,
        easing,
        timeline_sample.phase == AnimationPhase::Before,
        segment_duration_ms,
    );
    let opacity = match (from.opacity, to.opacity) {
        // Overshooting easings (spring, or a cubic-bezier with y outside 0..1)
        // extrapolate past the keyframe pair. Transforms may leave their range,
        // but opacity is a 0..1 property that validation enforces on input, so
        // clamp it rather than emitting an attribute every renderer would
        // clamp anyway.
        (Some(from_opacity), Some(to_opacity)) => {
            Some(lerp(from_opacity, to_opacity, eased_progress).clamp(0.0, 1.0))
        }
        _ => None,
    };
    let transform = match (from.transform.as_ref(), to.transform.as_ref()) {
        (Some(from_transform), Some(to_transform)) => Some(sample_transform(
            from_transform,
            to_transform,
            eased_progress,
            bbox_width,
            bbox_height,
        )),
        _ => None,
    };
    Ok((opacity, transform))
}

fn validate_text_unit_animation(node: &IrNode) -> Result<(), EngineError> {
    let IrNodeKind::Text {
        unit_animation: Some(unit_animation),
        unit_map,
        unit_animation_samples,
        ..
    } = &node.kind
    else {
        return Ok(());
    };
    validate_animation_spec(&unit_animation.animation, &node.node_id)?;
    if unit_animation
        .delay_step_ms
        .is_some_and(|delay| !delay.is_finite() || delay < 0.0)
    {
        return Err(animation_error(
            &node.node_id,
            "animateUnits.delayStepMs must be a non-negative finite number",
        ));
    }
    let Some(unit_map) = unit_map else {
        return Err(EngineError::Structured {
            code: "TEXT_UNIT_MAP_UNAVAILABLE".to_string(),
            message: "Text unit animation requires a resolved UnitMap".to_string(),
            stage: Some("text".to_string()),
            node_id: Some(node.node_id.clone()),
        });
    };
    let requested_ruby = unit_animation
        .ruby
        .unwrap_or(crate::text::unit_map::TextUnitRubyMode::WithBase);
    if unit_map.kind != unit_animation.by || requested_ruby != unit_map.ruby {
        return Err(EngineError::Structured {
            code: "TEXT_UNIT_MAP_MISMATCH".to_string(),
            message: "Text unit animation does not match its resolved UnitMap".to_string(),
            stage: Some("text".to_string()),
            node_id: Some(node.node_id.clone()),
        });
    }
    let base_delay_ms = unit_animation.animation.delay_ms.unwrap_or(0.0);
    let delay_step_ms = unit_animation.delay_step_ms.unwrap_or(0.0);
    let use_visual_order = matches!(unit_animation.order, Some(TextUnitAnimationOrder::Visual));
    if unit_map.units.iter().any(|unit| {
        let order_index = if use_visual_order {
            unit.visual_order
        } else {
            unit.logical_order
        };
        !(base_delay_ms + f64::from(order_index) * delay_step_ms).is_finite()
    }) {
        return Err(animation_error(
            &node.node_id,
            "animateUnits effective delays must be finite",
        ));
    }
    let Some(samples) = unit_animation_samples else {
        return Err(EngineError::Structured {
            code: "TEXT_UNIT_OUTLINES_UNAVAILABLE".to_string(),
            message: "Text unit animation requires resolved unit outline bounds".to_string(),
            stage: Some("text".to_string()),
            node_id: Some(node.node_id.clone()),
        });
    };
    let unit_ids: HashSet<&str> = unit_map
        .units
        .iter()
        .map(|unit| unit.unit_id.as_str())
        .collect();
    let sample_ids: HashSet<&str> = samples
        .iter()
        .map(|sample| sample.unit_id.as_str())
        .collect();
    if unit_ids.len() != unit_map.units.len()
        || sample_ids.len() != samples.len()
        || unit_ids != sample_ids
    {
        return Err(EngineError::Structured {
            code: "TEXT_UNIT_SAMPLE_MISMATCH".to_string(),
            message: "Text unit samples must map one-to-one to UnitMap entries".to_string(),
            stage: Some("text".to_string()),
            node_id: Some(node.node_id.clone()),
        });
    }
    if samples.iter().filter_map(|sample| sample.bbox).any(|bbox| {
        !bbox.x.is_finite()
            || !bbox.y.is_finite()
            || !bbox.w.is_finite()
            || !bbox.h.is_finite()
            || bbox.w < 0.0
            || bbox.h < 0.0
    }) {
        return Err(EngineError::Structured {
            code: "TEXT_UNIT_INVALID_BBOX".to_string(),
            message: "Text unit outline bounds must be finite and non-negative".to_string(),
            stage: Some("text".to_string()),
            node_id: Some(node.node_id.clone()),
        });
    }
    Ok(())
}

fn sample_node(node: &mut IrNode, time_ms: f64) -> Result<(), EngineError> {
    let node_id = node.node_id.clone();
    match &mut node.kind {
        IrNodeKind::Group {
            children,
            opacity,
            transform,
            animation,
            ..
        } => {
            if let Some(spec) = animation.as_ref() {
                validate_animation_spec(spec, &node_id)?;
                let (sampled_opacity, sampled_transform) = sample_spec(
                    spec,
                    &node_id,
                    time_ms,
                    spec.delay_ms.unwrap_or(0.0),
                    node.bbox.w,
                    node.bbox.h,
                )?;
                if sampled_opacity.is_some() {
                    *opacity = sampled_opacity;
                }
                if sampled_transform.is_some() {
                    *transform = sampled_transform;
                }
            }
            for child in children {
                sample_node(child, time_ms)?;
            }
        }
        IrNodeKind::Text {
            unit_map,
            unit_animation,
            unit_animation_samples,
            ..
        } => {
            let Some(unit_animation) = unit_animation.as_ref() else {
                return Ok(());
            };
            validate_animation_spec(&unit_animation.animation, &node_id)?;
            let Some(unit_map) = unit_map.as_ref() else {
                return Err(EngineError::Structured {
                    code: "TEXT_UNIT_MAP_UNAVAILABLE".to_string(),
                    message: "Text unit animation requires a resolved UnitMap".to_string(),
                    stage: Some("text".to_string()),
                    node_id: Some(node_id),
                });
            };
            let Some(samples) = unit_animation_samples.as_mut() else {
                return Err(EngineError::Structured {
                    code: "TEXT_UNIT_OUTLINES_UNAVAILABLE".to_string(),
                    message: "Text unit animation requires resolved unit outline bounds"
                        .to_string(),
                    stage: Some("text".to_string()),
                    node_id: Some(node_id),
                });
            };
            let delay_step_ms = unit_animation.delay_step_ms.unwrap_or(0.0);
            let base_delay_ms = unit_animation.animation.delay_ms.unwrap_or(0.0);
            let use_visual_order = matches!(
                unit_animation.order,
                Some(super::types::TextUnitAnimationOrder::Visual)
            );
            let unit_orders: HashMap<&str, (u32, u32)> = unit_map
                .units
                .iter()
                .map(|entry| {
                    (
                        entry.unit_id.as_str(),
                        (entry.logical_order, entry.visual_order),
                    )
                })
                .collect();
            for sample in samples {
                sample.opacity = None;
                sample.transform = None;
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
                let effective_delay_ms = base_delay_ms + f64::from(order_index) * delay_step_ms;
                let Some(bbox) = sample.bbox else {
                    continue;
                };
                (sample.opacity, sample.transform) = sample_spec(
                    &unit_animation.animation,
                    &node_id,
                    time_ms,
                    effective_delay_ms,
                    bbox.w,
                    bbox.h,
                )?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_node(node: &IrNode) -> Result<(), EngineError> {
    match &node.kind {
        IrNodeKind::Group {
            children,
            animation,
            ..
        } => {
            if let Some(spec) = animation {
                validate_animation_spec(spec, &node.node_id)?;
            }
            for child in children {
                validate_node(child)?;
            }
        }
        IrNodeKind::Text { .. } => validate_text_unit_animation(node)?,
        _ => {}
    }
    Ok(())
}

/// Validate every semantic animation track without sampling the IR.
///
/// # Errors
///
/// Returns a structured error for malformed animation data supplied through
/// a raw WASM transport or hand-authored IR.
pub fn validate_animations(ir: &Ir) -> Result<(), EngineError> {
    validate_text_animation_budgets(&ir.root)?;
    validate_node(&ir.root)
}

/// Return whether the IR contains any authored node or text-unit animation.
#[must_use]
pub fn has_animations(ir: &Ir) -> bool {
    fn node_has_animations(node: &IrNode) -> bool {
        match &node.kind {
            IrNodeKind::Group {
                children,
                animation,
                ..
            } => animation.is_some() || children.iter().any(node_has_animations),
            IrNodeKind::Text { unit_animation, .. } => unit_animation.is_some(),
            _ => false,
        }
    }

    node_has_animations(&ir.root)
}

pub(crate) fn text_animation_budget_counts(root: &IrNode) -> (usize, usize) {
    fn text_fragment_count(
        lines: &[crate::text::types::Line],
        unit_map: Option<&crate::text::unit_map::TextUnitMap>,
        root_stroke_count: usize,
        root_shadow_count: usize,
    ) -> usize {
        let Some(unit_map) = unit_map else {
            return 0;
        };
        unit_map
            .units
            .iter()
            .map(|unit| {
                let mut layers_by_paint_range = HashMap::<Option<u32>, (usize, usize)>::new();
                for member in &unit.members {
                    let Some(glyph) = lines
                        .get(member.line_index as usize)
                        .and_then(|line| line.positioned_glyphs.as_ref())
                        .and_then(|glyphs| glyphs.get(member.glyph_index as usize))
                    else {
                        continue;
                    };
                    let stroke_count = glyph
                        .text_strokes
                        .as_ref()
                        .map_or(root_stroke_count, Vec::len);
                    let shadow_count = glyph
                        .text_shadows
                        .as_ref()
                        .map_or(root_shadow_count, Vec::len);
                    let counts = layers_by_paint_range
                        .entry(glyph.paint_range_index)
                        .or_default();
                    counts.0 = counts.0.max(stroke_count);
                    counts.1 = counts.1.max(shadow_count);
                }
                if layers_by_paint_range.is_empty() {
                    return root_stroke_count + root_shadow_count + 1;
                }
                layers_by_paint_range.values().fold(
                    0_usize,
                    |count, (stroke_count, shadow_count)| {
                        count.saturating_add(stroke_count + shadow_count + 1)
                    },
                )
            })
            .fold(0_usize, usize::saturating_add)
    }

    fn collect(node: &IrNode, units: &mut usize, fragments: &mut usize) {
        match &node.kind {
            IrNodeKind::Group { children, .. } => {
                for child in children {
                    collect(child, units, fragments);
                }
            }
            IrNodeKind::Text {
                unit_animation: Some(_),
                unit_map,
                lines,
                stroke,
                strokes,
                shadows,
                ..
            } => {
                let unit_count = unit_map.as_ref().map_or(0, |map| map.units.len());
                let stroke_count = strokes
                    .as_ref()
                    .filter(|layers| !layers.is_empty())
                    .map_or_else(|| usize::from(stroke.is_some()), Vec::len);
                let shadow_count = shadows.as_ref().map_or(0, Vec::len);
                *units = units.saturating_add(unit_count);
                *fragments = fragments.saturating_add(text_fragment_count(
                    lines,
                    unit_map.as_ref(),
                    stroke_count,
                    shadow_count,
                ));
            }
            _ => {}
        }
    }

    let mut unit_count = 0;
    let mut fragment_count = 0;
    collect(root, &mut unit_count, &mut fragment_count);
    (unit_count, fragment_count)
}

pub(crate) fn validate_text_animation_budget_counts(
    unit_count: usize,
    fragment_count: usize,
) -> Result<(), EngineError> {
    if unit_count > MAX_TEXT_ANIMATION_UNITS {
        return Err(EngineError::Structured {
            code: "TEXT_ANIMATION_UNIT_LIMIT_EXCEEDED".to_string(),
            message: format!(
                "Text animation unit count {unit_count} exceeds the scene limit {MAX_TEXT_ANIMATION_UNITS}"
            ),
            stage: Some("layout".to_string()),
            node_id: None,
        });
    }
    if fragment_count > MAX_TEXT_ANIMATION_FRAGMENTS {
        return Err(EngineError::Structured {
            code: "TEXT_ANIMATION_FRAGMENT_LIMIT_EXCEEDED".to_string(),
            message: format!(
                "Text animation fragment estimate {fragment_count} exceeds the scene limit {MAX_TEXT_ANIMATION_FRAGMENTS}"
            ),
            stage: Some("emit".to_string()),
            node_id: None,
        });
    }
    Ok(())
}

pub(crate) fn validate_text_animation_budgets(root: &IrNode) -> Result<(), EngineError> {
    let (unit_count, fragment_count) = text_animation_budget_counts(root);
    validate_text_animation_budget_counts(unit_count, fragment_count)
}

/// One node's resolved animation values at a sampled time.
///
/// `transform` is the composed affine matrix rather than the authoring
/// channels, so a reader does not have to re-derive the origin handling that
/// the emitter applies.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationStateSample {
    pub node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<AffineMatrixDto>,
}

/// SVG-order affine matrix: `(x, y) -> (a*x + c*y + e, b*x + d*y + f)`.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct AffineMatrixDto {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

/// Compose a sampled transform into the matrix the emitter draws.
///
/// The emitter writes `translate(user) translate(origin) rotate scale
/// translate(-origin)`, so this has to fold the origin the same way or the
/// inspector would disagree with what is drawn. The origin must already be
/// rebased onto the node's bbox: `sample_transform` stores a node-local centre
/// (`w / 2`, `h / 2`), while the emitter paints about the absolute centre.
fn transform_to_affine(transform: &Transform2D) -> AffineMatrixDto {
    let translate_x = transform.translate_x.unwrap_or(0.0);
    let translate_y = transform.translate_y.unwrap_or(0.0);
    let scale_x = transform.scale_x.unwrap_or(1.0);
    let scale_y = transform.scale_y.unwrap_or(1.0);
    let origin_x = transform.origin_x.unwrap_or(0.0);
    let origin_y = transform.origin_y.unwrap_or(0.0);
    let radians = transform.rotate_deg.unwrap_or(0.0).to_radians();
    let (sin, cos) = radians.sin_cos();

    // Linear part is rotate * scale.
    let matrix_a = cos * scale_x;
    let matrix_b = sin * scale_x;
    let matrix_c = -sin * scale_y;
    let matrix_d = cos * scale_y;
    AffineMatrixDto {
        a: matrix_a,
        b: matrix_b,
        c: matrix_c,
        d: matrix_d,
        e: translate_x + origin_x - (matrix_a * origin_x + matrix_c * origin_y),
        f: translate_y + origin_y - (matrix_b * origin_x + matrix_d * origin_y),
    }
}

fn collect_animation_state(node: &IrNode, samples: &mut Vec<AnimationStateSample>) {
    if let IrNodeKind::Group {
        children,
        opacity,
        transform,
        animation,
        ..
    } = &node.kind
    {
        if animation.is_some() {
            samples.push(AnimationStateSample {
                node_id: node.node_id.clone(),
                opacity: *opacity,
                transform: transform.as_ref().map(|sampled| {
                    // Same rebase the emitter applies before painting.
                    transform_to_affine(&crate::svg_emit::transform::resolve_node_local_transform(
                        sampled, node.bbox,
                    ))
                }),
            });
        }
        for child in children {
            collect_animation_state(child, samples);
        }
    }
}

/// Sample every animated node's resolved opacity and transform at `time_ms`.
///
/// Only nodes carrying a node-level `animation` track appear. Text unit tracks
/// resolve per paint unit rather than per node, so they have no single
/// opacity/transform to report and are deliberately absent.
///
/// # Errors
///
/// Returns a structured error for a non-finite/negative time or malformed
/// animation semantics, matching `sample_animation`.
pub fn sample_animation_state(
    ir: &Ir,
    time_ms: f64,
) -> Result<Vec<AnimationStateSample>, EngineError> {
    let sampled = sample_animation(ir, time_ms)?;
    let mut samples = Vec::new();
    collect_animation_state(&sampled.root, &mut samples);
    Ok(samples)
}

/// Clone and sample an IR at an explicit timeline time.
///
/// # Errors
///
/// Returns a structured error for a non-finite/negative time or malformed
/// animation semantics on an externally supplied IR.
pub fn sample_animation(ir: &Ir, time_ms: f64) -> Result<Ir, EngineError> {
    if !time_ms.is_finite() || time_ms < 0.0 {
        return Err(EngineError::Structured {
            code: "ANIMATION_INVALID_TIME".to_string(),
            message: "Animation timeMs must be a non-negative finite number".to_string(),
            stage: Some("emit".to_string()),
            node_id: None,
        });
    }
    validate_animations(ir)?;
    let mut sampled = ir.clone();
    sample_node(&mut sampled.root, time_ms)?;
    Ok(sampled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::types::{AnimationSteps, BBox, IrNode};

    fn spec(fill: &str, iterations: f64) -> AnimationSpec {
        AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(0.0),
                    transform: Some(AnimationTransform2D {
                        translate_x: Some(0.0),
                        ..AnimationTransform2D::default()
                    }),
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(1.0),
                    transform: Some(AnimationTransform2D {
                        translate_x: Some(10.0),
                        ..AnimationTransform2D::default()
                    }),
                },
            ],
            duration_ms: 100.0,
            delay_ms: Some(20.0),
            easing: Some(AnimationEasing::Named("linear".to_string())),
            iterations: Some(AnimationIterations::Count(iterations)),
            fill: Some(fill.to_string()),
        }
    }

    fn ir(fill: &str, iterations: f64) -> Ir {
        Ir {
            root: IrNode {
                node_id: "root".to_string(),
                bbox: BBox::new(10.0, 20.0, 80.0, 40.0),
                kind: IrNodeKind::Group {
                    children: Vec::new(),
                    clip_path: None,
                    clip_border_radius: None,
                    opacity: Some(0.75),
                    box_shadow: None,
                    meta: None,
                    transform: None,
                    animation: Some(spec(fill, iterations)),
                    on: None,
                },
            },
            draw_order: Vec::new(),
            width: 100.0,
            height: 100.0,
            debug: None,
            warnings: Vec::new(),
        }
    }

    fn group_values(ir: &Ir) -> Option<(Option<f64>, Option<&Transform2D>)> {
        let IrNodeKind::Group {
            opacity, transform, ..
        } = &ir.root.kind
        else {
            return None;
        };
        Some((*opacity, transform.as_ref()))
    }

    fn set_group_easing(ir: &mut Ir, easing: AnimationEasing) {
        let IrNodeKind::Group {
            animation: Some(animation),
            ..
        } = &mut ir.root.kind
        else {
            panic!("group animation fixture missing");
        };
        animation.easing = Some(easing);
    }

    fn spring(stiffness: f64, damping: f64, mass: f64) -> AnimationEasing {
        AnimationEasing::Spring(AnimationSpring {
            kind: "spring".to_string(),
            stiffness: Some(stiffness),
            damping: Some(damping),
            mass: Some(mass),
        })
    }

    fn spring_error_code(easing: AnimationEasing) -> String {
        let mut source = ir("both", 1.0);
        set_group_easing(&mut source, easing);
        let error = sample_animation(&source, 0.0).expect_err("invalid spring must fail");
        let EngineError::Structured { code, .. } = error else {
            panic!("spring validation must produce a structured error");
        };
        code
    }

    fn text_unit_ir(order: &str) -> Ir {
        let root = serde_json::from_value(serde_json::json!({
            "nodeId": "text",
                "bbox": { "x": 0.0, "y": 0.0, "w": 20.0, "h": 10.0 },
                "type": "text",
                "lines": [],
                "font": "Test",
                "fontSizePx": 10.0,
                "color": "#000000",
            "textAlign": "start",
                "layoutBox": { "x": 0.0, "y": 0.0, "w": 20.0, "h": 10.0 },
                "lineHeightPx": 10.0,
                "unitMap": {
                    "kind": "cluster",
                    "ruby": "with-base",
                    "units": [
                        {
                            "unitId": "first",
                            "kind": "cluster",
                            "sourceStart": 0,
                            "sourceEnd": 1,
                            "lineId": "line",
                            "logicalOrder": 0,
                            "visualOrder": 1,
                            "members": []
                        },
                        {
                            "unitId": "second",
                            "kind": "cluster",
                            "sourceStart": 1,
                            "sourceEnd": 2,
                            "lineId": "line",
                            "logicalOrder": 1,
                            "visualOrder": 0,
                            "members": []
                        }
                    ]
                },
                "unitAnimation": {
                    "by": "cluster",
                    "animation": {
                        "keyframes": [
                            { "at": 0.0, "opacity": 0.0 },
                            { "at": 1.0, "opacity": 1.0 }
                        ],
                        "durationMs": 100.0,
                        "easing": "linear",
                        "fill": "both"
                    },
                    "delayStepMs": 50.0,
                    "order": order,
                    "ruby": "with-base"
                },
                "unitAnimationSamples": [
                    {
                        "unitId": "first",
                        "bbox": { "x": 0.0, "y": 0.0, "w": 10.0, "h": 10.0 }
                    },
                    {
                        "unitId": "second",
                        "bbox": { "x": 10.0, "y": 0.0, "w": 10.0, "h": 10.0 }
                    }
                ]
        }))
        .expect("text unit node fixture deserializes");
        Ir {
            root,
            draw_order: vec!["text".to_string()],
            width: 20.0,
            height: 10.0,
            debug: None,
            warnings: Vec::new(),
        }
    }

    fn unit_opacity(sampled: &Ir, unit_id: &str) -> Option<f64> {
        let IrNodeKind::Text {
            unit_animation_samples: Some(samples),
            ..
        } = &sampled.root.kind
        else {
            return None;
        };
        samples
            .iter()
            .find(|sample| sample.unit_id == unit_id)
            .and_then(|sample| sample.opacity)
    }

    #[test]
    fn samples_boundaries_and_preserves_center_origin() {
        let source = ir("both", 1.0);
        let at_start = sample_animation(&source, 20.0).expect("start samples");
        let at_middle = sample_animation(&source, 70.0).expect("middle samples");
        let at_end = sample_animation(&source, 120.0).expect("end samples");
        assert_eq!(
            group_values(&at_start).map(|values| values.0),
            Some(Some(0.0))
        );
        assert_eq!(
            group_values(&at_middle).map(|values| values.0),
            Some(Some(0.5))
        );
        assert_eq!(
            group_values(&at_end).map(|values| values.0),
            Some(Some(1.0))
        );
        let middle_transform = group_values(&at_middle).and_then(|values| values.1);
        assert_eq!(
            middle_transform.and_then(|value| value.translate_x),
            Some(5.0)
        );
        assert_eq!(
            middle_transform.and_then(|value| value.origin_x),
            Some(40.0)
        );
        assert_eq!(
            middle_transform.and_then(|value| value.origin_y),
            Some(20.0)
        );
    }

    #[test]
    fn fill_none_restores_the_static_pose_outside_the_active_interval() {
        let source = ir("none", 1.0);
        assert_eq!(
            sample_animation(&source, 0.0)
                .ok()
                .as_ref()
                .and_then(group_values)
                .map(|values| values.0),
            Some(Some(0.75))
        );
        assert_eq!(
            sample_animation(&source, 121.0)
                .ok()
                .as_ref()
                .and_then(group_values)
                .map(|values| values.0),
            Some(Some(0.75))
        );
    }

    #[test]
    fn fractional_iterations_hold_the_last_partial_progress() {
        let source = ir("both", 2.5);
        let sampled = sample_animation(&source, 270.0).expect("fractional end samples");
        assert_eq!(
            group_values(&sampled).map(|values| values.0),
            Some(Some(0.5))
        );
    }

    #[test]
    fn matches_css_cubic_bezier_reference_values() {
        let ease_half = apply_cubic_easing(0.5, [0.25, 0.1, 0.25, 1.0]);
        let ease_in_out_quarter = apply_cubic_easing(0.25, [0.42, 0.0, 0.58, 1.0]);
        assert!((ease_half - 0.802_403_387_695_412_6).abs() < 1.0e-6);
        assert!((ease_in_out_quarter - 0.129_161_931_047_319_82).abs() < 1.0e-6);
    }

    #[test]
    fn applies_all_css_step_positions_and_before_flag() {
        assert_eq!(
            apply_step_easing(0.0, 2.0, AnimationStepPosition::Start, false),
            0.5
        );
        assert_eq!(
            apply_step_easing(0.5, 2.0, AnimationStepPosition::Start, false),
            1.0
        );
        assert_eq!(
            apply_step_easing(0.0, 2.0, AnimationStepPosition::End, false),
            0.0
        );
        assert_eq!(
            apply_step_easing(0.5, 2.0, AnimationStepPosition::End, false),
            0.5
        );
        assert_eq!(
            apply_step_easing(0.0, 2.0, AnimationStepPosition::None, false),
            0.0
        );
        assert_eq!(
            apply_step_easing(0.5, 2.0, AnimationStepPosition::None, false),
            1.0
        );
        assert_eq!(
            apply_step_easing(0.0, 2.0, AnimationStepPosition::Both, false),
            1.0 / 3.0
        );
        assert_eq!(
            apply_step_easing(0.5, 2.0, AnimationStepPosition::Both, false),
            2.0 / 3.0
        );
        assert_eq!(
            apply_step_easing(0.0, 2.0, AnimationStepPosition::Start, true),
            0.0
        );
        assert_eq!(
            apply_step_easing(1.0, 2.0, AnimationStepPosition::Both, false),
            1.0
        );
        assert_eq!(
            apply_step_easing(0.8, 5.0, AnimationStepPosition::End, false),
            0.8
        );
    }

    #[test]
    fn distinguishes_delay_fill_from_the_active_step_start_boundary() {
        let mut source = ir("both", 1.0);
        set_group_easing(
            &mut source,
            AnimationEasing::Named("step-start".to_string()),
        );

        let before = sample_animation(&source, 0.0).expect("before samples");
        let active_start = sample_animation(&source, 20.0).expect("active start samples");
        assert_eq!(
            group_values(&before).map(|values| values.0),
            Some(Some(0.0))
        );
        assert_eq!(
            group_values(&active_start).map(|values| values.0),
            Some(Some(1.0))
        );

        set_group_easing(&mut source, AnimationEasing::Named("step-end".to_string()));
        let step_end_start = sample_animation(&source, 20.0).expect("step end start samples");
        assert_eq!(
            group_values(&step_end_start).map(|values| values.0),
            Some(Some(0.0))
        );
    }

    #[test]
    fn samples_step_iteration_and_negative_delay_boundaries() {
        let mut integer = ir("both", 2.0);
        set_group_easing(&mut integer, AnimationEasing::Named("step-end".to_string()));
        let next_iteration = sample_animation(&integer, 120.0).expect("iteration boundary");
        let final_boundary = sample_animation(&integer, 220.0).expect("final boundary");
        assert_eq!(
            group_values(&next_iteration).map(|values| values.0),
            Some(Some(0.0))
        );
        assert_eq!(
            group_values(&final_boundary).map(|values| values.0),
            Some(Some(1.0))
        );

        let mut fractional = ir("both", 2.5);
        set_group_easing(
            &mut fractional,
            AnimationEasing::Steps(AnimationSteps {
                kind: "steps".to_string(),
                count: 2.0,
                position: None,
            }),
        );
        let fractional_end = sample_animation(&fractional, 270.0).expect("fractional boundary");
        assert_eq!(
            group_values(&fractional_end).map(|values| values.0),
            Some(Some(0.5))
        );

        let IrNodeKind::Group {
            animation: Some(animation),
            ..
        } = &mut fractional.root.kind
        else {
            panic!("group animation fixture missing");
        };
        animation.delay_ms = Some(-25.0);
        animation.iterations = Some(AnimationIterations::Count(1.0));
        animation.easing = Some(AnimationEasing::Steps(AnimationSteps {
            kind: "steps".to_string(),
            count: 4.0,
            position: Some("jump-end".to_string()),
        }));
        let negative_delay = sample_animation(&fractional, 0.0).expect("negative delay samples");
        assert_eq!(
            group_values(&negative_delay).map(|values| values.0),
            Some(Some(0.25))
        );
    }

    #[test]
    fn preserves_keyframe_value_at_an_exact_offset_before_stepping() {
        let mut source = ir("both", 1.0);
        let IrNodeKind::Group {
            animation: Some(animation),
            ..
        } = &mut source.root.kind
        else {
            panic!("group animation fixture missing");
        };
        animation.keyframes = vec![
            AnimationKeyframe {
                at: 0.0,
                opacity: Some(0.0),
                transform: Some(AnimationTransform2D::default()),
            },
            AnimationKeyframe {
                at: 0.5,
                opacity: Some(0.4),
                transform: Some(AnimationTransform2D::default()),
            },
            AnimationKeyframe {
                at: 1.0,
                opacity: Some(1.0),
                transform: Some(AnimationTransform2D::default()),
            },
        ];
        animation.easing = Some(AnimationEasing::Named("step-start".to_string()));

        let exact = sample_animation(&source, 70.0).expect("exact keyframe samples");
        let after = sample_animation(&source, 70.001).expect("after keyframe samples");
        assert_eq!(group_values(&exact).map(|values| values.0), Some(Some(0.4)));
        assert_eq!(group_values(&after).map(|values| values.0), Some(Some(1.0)));
    }

    #[test]
    fn rejects_invalid_step_easing_at_the_ir_trust_boundary() {
        for steps in [
            AnimationSteps {
                kind: "step".to_string(),
                count: 2.0,
                position: None,
            },
            AnimationSteps {
                kind: "steps".to_string(),
                count: 0.0,
                position: None,
            },
            AnimationSteps {
                kind: "steps".to_string(),
                count: f64::NAN,
                position: None,
            },
            AnimationSteps {
                kind: "steps".to_string(),
                count: f64::INFINITY,
                position: None,
            },
            AnimationSteps {
                kind: "steps".to_string(),
                count: 1.5,
                position: None,
            },
            AnimationSteps {
                kind: "steps".to_string(),
                count: 1.0,
                position: Some("jump-none".to_string()),
            },
            AnimationSteps {
                kind: "steps".to_string(),
                count: 2.0,
                position: Some("end".to_string()),
            },
        ] {
            let mut animation = spec("both", 1.0);
            animation.easing = Some(AnimationEasing::Steps(steps));
            let error = validate_animation_spec(&animation, "step-node")
                .expect_err("invalid steps must fail");
            assert!(matches!(
                error,
                EngineError::Structured { ref code, .. } if code == "ANIMATION_INVALID_SPEC"
            ));
        }

        for name in ["start", "end", "steps(4, end)"] {
            let mut animation = spec("both", 1.0);
            animation.easing = Some(AnimationEasing::Named(name.to_string()));
            let error = validate_animation_spec(&animation, "step-node")
                .expect_err("raw step aliases must fail");
            assert!(matches!(
                error,
                EngineError::Structured { ref code, .. } if code == "ANIMATION_INVALID_SPEC"
            ));
        }

        for easing_json in [
            serde_json::json!({ "type": "steps", "count": 2, "position": null }),
            serde_json::json!({ "type": "steps", "count": 2, "extra": true }),
        ] {
            assert!(
                serde_json::from_value::<AnimationEasing>(easing_json).is_err(),
                "invalid steps JSON must fail before sampling"
            );
        }
    }

    #[test]
    fn text_unit_stagger_uses_step_easing_at_each_effective_delay() {
        let mut source = text_unit_ir("logical");
        let IrNodeKind::Text {
            unit_animation: Some(unit_animation),
            ..
        } = &mut source.root.kind
        else {
            panic!("text unit animation fixture missing");
        };
        unit_animation.animation.easing = Some(AnimationEasing::Named("step-start".to_string()));

        let first_start = sample_animation(&source, 0.0).expect("first unit start samples");
        assert_eq!(unit_opacity(&first_start, "first"), Some(1.0));
        assert_eq!(unit_opacity(&first_start, "second"), Some(0.0));

        let second_start = sample_animation(&source, 50.0).expect("second unit start samples");
        assert_eq!(unit_opacity(&second_start, "first"), Some(1.0));
        assert_eq!(unit_opacity(&second_start, "second"), Some(1.0));
    }

    #[test]
    fn spring_closed_forms_match_their_damping_regime() {
        // omega0 = 10 rad/s for every case; only the damping ratio changes.
        let underdamped = apply_spring_easing(0.5, 10.0, 0.5, 100.0);
        let critical = apply_spring_easing(0.5, 10.0, 1.0, 100.0);
        let overdamped = apply_spring_easing(0.5, 10.0, 2.0, 100.0);

        assert!(
            (underdamped - 0.104_405_473).abs() < 1.0e-9,
            "{underdamped}"
        );
        assert!((critical - 0.090_204_010).abs() < 1.0e-9, "{critical}");
        assert!((overdamped - 0.069_705_206).abs() < 1.0e-9, "{overdamped}");
        assert!(overdamped < critical && critical < underdamped);
    }

    #[test]
    fn spring_starts_at_zero_and_clamps_to_one_at_the_segment_end() {
        for zeta in [0.5, 1.0, 2.0] {
            assert_eq!(apply_spring_easing(0.0, 10.0, zeta, 100.0), 0.0);
            assert_eq!(apply_spring_easing(1.0, 10.0, zeta, 100.0), 1.0);
        }
    }

    #[test]
    fn spring_uses_the_critical_form_within_the_epsilon_window() {
        let exact = apply_spring_easing(0.5, 10.0, 1.0, 100.0);
        let inside = apply_spring_easing(0.5, 10.0, 1.0 - SPRING_CRITICAL_EPSILON / 2.0, 100.0);
        assert_eq!(exact, inside);
    }

    #[test]
    fn underdamped_spring_overshoots_before_settling() {
        let overshoot = apply_spring_easing(0.35, 10.0, 0.5, 1000.0);
        assert!(overshoot > 1.0, "{overshoot}");
    }

    #[test]
    fn spring_physical_time_scales_with_segment_duration() {
        let short = apply_spring_easing(1.0e-3, 10.0, 0.5, 100.0);
        let long = apply_spring_easing(1.0e-3, 10.0, 0.5, 400.0);
        assert!(long > short, "{long} vs {short}");
    }

    #[test]
    fn spring_defaults_fill_omitted_parameters() {
        let defaults = AnimationEasing::Spring(AnimationSpring {
            kind: "spring".to_string(),
            stiffness: None,
            damping: None,
            mass: None,
        });
        let mut source = ir("both", 1.0);
        set_group_easing(&mut source, defaults);
        let sampled = sample_animation(&source, 20.0).expect("default spring samples");

        let (opacity, _) = group_values(&sampled).expect("group values");
        assert_eq!(opacity, Some(0.0));
        // stiffness 100 / damping 10 / mass 1 resolves to omega0 = 10, zeta = 0.5.
        let midpoint = sample_animation(&source, 70.0).expect("default spring midpoint");
        let (midpoint_opacity, _) = group_values(&midpoint).expect("group values");
        assert!(
            midpoint_opacity.is_some_and(|value| (value - 0.104_405_473).abs() < 1.0e-6),
            "{midpoint_opacity:?}"
        );
    }

    #[test]
    fn spring_parameters_outside_the_supported_range_are_rejected() {
        for easing in [
            spring(0.5, 10.0, 1.0),
            spring(1001.0, 10.0, 1.0),
            spring(100.0, 0.5, 1.0),
            spring(100.0, 101.0, 1.0),
            spring(100.0, 10.0, 0.05),
            spring(100.0, 10.0, 10.5),
            spring(f64::NAN, 10.0, 1.0),
            spring(100.0, f64::INFINITY, 1.0),
        ] {
            assert_eq!(spring_error_code(easing), "ANIMATION_INVALID_SPEC");
        }
    }

    #[test]
    fn spring_easing_type_must_be_spring() {
        let easing: AnimationEasing = serde_json::from_value(serde_json::json!({
            "type": "bounce",
            "stiffness": 100.0
        }))
        .expect("object shape parses as a spring");
        assert_eq!(spring_error_code(easing), "ANIMATION_INVALID_SPEC");
    }

    #[test]
    fn spring_json_round_trips_without_shadowing_steps() {
        let steps: AnimationEasing = serde_json::from_value(serde_json::json!({
            "type": "steps",
            "count": 3,
            "position": "jump-start"
        }))
        .expect("steps easing still parses");
        assert!(matches!(steps, AnimationEasing::Steps(_)));

        let bare: AnimationEasing =
            serde_json::from_value(serde_json::json!({ "type": "spring" })).expect("bare spring");
        assert_eq!(
            serde_json::to_value(&bare).expect("spring serializes"),
            serde_json::json!({ "type": "spring" }),
            "omitted parameters must not serialize as nulls"
        );
    }

    #[test]
    fn text_unit_stagger_uses_the_selected_order_without_reordering_paint() {
        let logical = sample_animation(&text_unit_ir("logical"), 25.0).expect("logical samples");
        let visual = sample_animation(&text_unit_ir("visual"), 25.0).expect("visual samples");

        assert!(unit_opacity(&logical, "first").is_some_and(|value| (value - 0.25).abs() < 1.0e-6));
        assert_eq!(unit_opacity(&logical, "second"), Some(0.0));
        assert_eq!(unit_opacity(&visual, "first"), Some(0.0));
        assert!(unit_opacity(&visual, "second").is_some_and(|value| (value - 0.25).abs() < 1.0e-6));
        assert_eq!(logical.draw_order, visual.draw_order);
    }
    #[test]
    fn animation_state_reports_only_animated_nodes() {
        let source = ir("both", 1.0);
        let samples = sample_animation_state(&source, 70.0).expect("state samples");

        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].node_id, "root");
        assert!(samples[0].opacity.is_some());
        assert!(samples[0].transform.is_some());
    }

    #[test]
    fn animation_state_moves_with_time() {
        let source = ir("both", 1.0);
        let start = sample_animation_state(&source, 20.0).expect("start");
        let middle = sample_animation_state(&source, 70.0).expect("middle");
        let end = sample_animation_state(&source, 120.0).expect("end");

        assert_eq!(start[0].opacity, Some(0.0));
        assert_eq!(end[0].opacity, Some(1.0));
        assert!(
            middle[0]
                .opacity
                .is_some_and(|value| value > 0.0 && value < 1.0)
        );
        // translateX runs 0 -> 10, so e must advance with it.
        assert!(end[0].transform.expect("transform").e > start[0].transform.expect("transform").e);
    }

    #[test]
    fn animation_state_rejects_an_invalid_time() {
        let source = ir("both", 1.0);
        assert!(sample_animation_state(&source, -1.0).is_err());
        assert!(sample_animation_state(&source, f64::NAN).is_err());
    }

    #[test]
    fn affine_matrix_folds_the_origin_like_the_emitter() {
        // 90 degrees about (50, 20) with a 2x scale, then translated by (5, 7).
        let transform = Transform2D {
            translate_x: Some(5.0),
            translate_y: Some(7.0),
            scale_x: Some(2.0),
            scale_y: Some(2.0),
            rotate_deg: Some(90.0),
            origin_x: Some(50.0),
            origin_y: Some(20.0),
        };
        let matrix = transform_to_affine(&transform);

        // The origin itself only moves by the user translation.
        let origin_x = matrix.a * 50.0 + matrix.c * 20.0 + matrix.e;
        let origin_y = matrix.b * 50.0 + matrix.d * 20.0 + matrix.f;
        assert!((origin_x - 55.0).abs() < 1.0e-9, "{origin_x}");
        assert!((origin_y - 27.0).abs() < 1.0e-9, "{origin_y}");

        // A point one unit right of the origin lands two units below it.
        let probe_x = matrix.a * 51.0 + matrix.c * 20.0 + matrix.e;
        let probe_y = matrix.b * 51.0 + matrix.d * 20.0 + matrix.f;
        assert!((probe_x - 55.0).abs() < 1.0e-9, "{probe_x}");
        assert!((probe_y - 29.0).abs() < 1.0e-9, "{probe_y}");
    }

    #[test]
    fn affine_matrix_is_identity_for_an_untouched_transform() {
        let matrix = transform_to_affine(&Transform2D::default());

        assert_eq!(
            matrix,
            AffineMatrixDto {
                a: 1.0,
                b: 0.0,
                c: 0.0,
                d: 1.0,
                e: 0.0,
                f: 0.0
            }
        );
    }
}
