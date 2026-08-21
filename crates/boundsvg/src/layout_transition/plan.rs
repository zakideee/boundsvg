use serde::Deserialize;

use crate::ir::types::{
    AnimationEasing, AnimationIterations, AnimationKeyframe, AnimationSpec, BBox,
};

use super::affine::AxisAlignedAffine;
use super::{CompatibilityCategory, CompatibilityMismatch};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LayoutTransitionPlanInput {
    checkpoints: Vec<LayoutTransitionCheckpointInput>,
    #[serde(default)]
    easing: Option<AnimationEasing>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayoutTransitionCheckpointInput {
    time_ms: f64,
    state_index: u8,
}

impl LayoutTransitionPlanInput {
    pub(crate) fn validate(&self, node_id: &str) -> Result<(), CompatibilityMismatch> {
        if self.checkpoints.len() != 4 {
            return Err(schedule_mismatch(
                node_id,
                "exactly four checkpoints",
                format!("{} checkpoints", self.checkpoints.len()),
            ));
        }
        let expected_states = [0_u8, 1, 1, 0];
        let mut previous_time_ms = f64::NEG_INFINITY;
        for (index, checkpoint) in self.checkpoints.iter().enumerate() {
            if !checkpoint.time_ms.is_finite()
                || checkpoint.time_ms < 0.0
                || (index == 0 && checkpoint.time_ms != 0.0)
                || (index > 0 && checkpoint.time_ms <= previous_time_ms)
            {
                return Err(schedule_mismatch(
                    node_id,
                    "finite non-negative times starting at 0 and strictly increasing",
                    format!("invalid time {} at checkpoint {index}", checkpoint.time_ms),
                ));
            }
            if checkpoint.state_index != expected_states[index] {
                return Err(schedule_mismatch(
                    node_id,
                    "state indices [0, 1, 1, 0]",
                    format!(
                        "state index {} at checkpoint {index}",
                        checkpoint.state_index
                    ),
                ));
            }
            previous_time_ms = checkpoint.time_ms;
        }

        let animation = AnimationSpec {
            keyframes: vec![
                AnimationKeyframe {
                    at: 0.0,
                    opacity: Some(1.0),
                    transform: None,
                },
                AnimationKeyframe {
                    at: 1.0,
                    opacity: Some(1.0),
                    transform: None,
                },
            ],
            duration_ms: previous_time_ms,
            delay_ms: None,
            easing: self.easing.clone(),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        crate::ir::animation::validate_animation_spec(&animation, node_id).map_err(|error| {
            schedule_mismatch(
                node_id,
                "a supported single easing and positive final duration",
                error.to_string(),
            )
        })
    }

    pub(super) fn generated_animation(
        &self,
        reference_bbox: BBox,
        target_residual: AxisAlignedAffine,
        node_id: &str,
    ) -> Result<AnimationSpec, CompatibilityMismatch> {
        let duration_ms = self
            .checkpoints
            .last()
            .map(|checkpoint| checkpoint.time_ms)
            .ok_or_else(|| {
                schedule_mismatch(
                    node_id,
                    "at least one validated transition checkpoint",
                    "empty checkpoint list",
                )
            })?;
        let keyframes = self
            .checkpoints
            .iter()
            .map(|checkpoint| {
                let affine = if checkpoint.state_index == 0 {
                    AxisAlignedAffine::identity()
                } else {
                    target_residual
                };
                Ok(AnimationKeyframe {
                    at: checkpoint.time_ms / duration_ms,
                    opacity: None,
                    transform: Some(affine.to_animation_transform(reference_bbox, node_id)?),
                })
            })
            .collect::<Result<Vec<_>, CompatibilityMismatch>>()?;
        let animation = AnimationSpec {
            keyframes,
            duration_ms,
            delay_ms: None,
            easing: self.easing.clone(),
            iterations: Some(AnimationIterations::Count(1.0)),
            fill: Some("both".to_string()),
        };
        crate::ir::animation::validate_animation_spec(&animation, node_id).map_err(|error| {
            schedule_mismatch(
                node_id,
                "a valid generated transform animation",
                error.to_string(),
            )
        })?;
        Ok(animation)
    }
}

fn schedule_mismatch(
    node_id: &str,
    expected: impl Into<String>,
    observed: impl Into<String>,
) -> CompatibilityMismatch {
    CompatibilityMismatch {
        category: CompatibilityCategory::Schedule,
        node_id: node_id.to_string(),
        expected: expected.into(),
        observed: observed.into(),
    }
}
