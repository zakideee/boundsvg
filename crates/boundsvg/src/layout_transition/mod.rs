//! Compile two compatible layout states into one post-layout transition IR.
//!
//! Authored state correspondence uses the layout transport. Structural IR
//! ownership distinguishes semantic source groups from generated outer wrappers.

mod affine;
mod manifest;
mod plan;
mod signature;
mod wrapper;

#[cfg(test)]
mod tests;

use serde_json::Value;

use crate::diagnostics::SerializedRecoverableError;
use crate::ir::types::Ir;
use crate::layout::LayoutInput;

use manifest::SemanticManifest;
pub(crate) use plan::LayoutTransitionPlanInput;
use wrapper::inject_generated_wrappers;

#[cfg(test)]
use affine::{AxisAlignedAffine, bbox_world_delta};
#[cfg(test)]
use manifest::describe_parent;
#[cfg(test)]
use signature::{signature_has_non_identity_transform, signature_has_painted_canvas_stroke};
#[cfg(test)]
use wrapper::GENERATED_WRAPPER_ID_PREFIX;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Stable category used to report incompatible authored transition states.
pub(crate) enum CompatibilityCategory {
    Id,
    Canvas,
    Kind,
    Parent,
    Order,
    Content,
    Paint,
    Animation,
    Stroke,
    Bbox,
    Schedule,
}

impl CompatibilityCategory {
    /// Return the public diagnostic category token.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Id => "id",
            Self::Canvas => "canvas",
            Self::Kind => "kind",
            Self::Parent => "parent",
            Self::Order => "order",
            Self::Content => "content",
            Self::Paint => "paint",
            Self::Animation => "animation",
            Self::Stroke => "stroke",
            Self::Bbox => "bbox",
            Self::Schedule => "schedule",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
/// First incompatible source fact, with expected and observed descriptions.
pub(crate) struct CompatibilityMismatch {
    pub(crate) category: CompatibilityCategory,
    pub(crate) node_id: String,
    pub(crate) expected: String,
    pub(crate) observed: String,
}

/// Private state envelope retained only during one transition compilation.
#[derive(Debug)]
pub(crate) struct CompiledTransitionState {
    ir: Ir,
    semantic_manifest: SemanticManifest,
}

impl CompiledTransitionState {
    /// Associate authored source entries with exactly one resolved source group.
    ///
    /// # Errors
    ///
    /// Returns a mismatch for absent transport roots or ambiguous/missing source groups.
    pub(crate) fn from_layout_input(
        input: &LayoutInput,
        raw_input: &Value,
        ir: Ir,
    ) -> Result<Self, CompatibilityMismatch> {
        let raw_root = raw_input.get("root").ok_or_else(|| CompatibilityMismatch {
            category: CompatibilityCategory::Id,
            node_id: input.root.node_id.clone(),
            expected: "layout transport root".to_string(),
            observed: "missing raw root".to_string(),
        })?;
        let mut semantic_manifest = SemanticManifest::from_root(&input.root, raw_root)?;
        semantic_manifest.attach_ir_groups(&ir.root)?;
        Ok(Self {
            ir,
            semantic_manifest,
        })
    }

    /// Compare canvas size and authored source signatures against the target state.
    ///
    /// # Errors
    ///
    /// Returns the first incompatible canvas, source, paint, content or animation fact.
    pub(crate) fn validate_compatibility(
        &self,
        target: &Self,
    ) -> Result<(), CompatibilityMismatch> {
        if self.ir.width != target.ir.width || self.ir.height != target.ir.height {
            return Err(CompatibilityMismatch {
                category: CompatibilityCategory::Canvas,
                node_id: self.ir.root.node_id.clone(),
                expected: format!("{}x{}", self.ir.width, self.ir.height),
                observed: format!("{}x{}", target.ir.width, target.ir.height),
            });
        }
        self.semantic_manifest
            .validate_compatibility(&target.semantic_manifest)
    }

    /// Consume compatible states and place outer animation wrappers around source groups.
    ///
    /// # Errors
    ///
    /// Returns a mismatch for incompatible states, an invalid schedule or missing wrapper targets.
    pub(crate) fn into_transition_ir(
        mut self,
        target: Self,
        plan: &LayoutTransitionPlanInput,
    ) -> Result<Ir, CompatibilityMismatch> {
        self.validate_compatibility(&target)?;
        plan.validate(&self.ir.root.node_id)?;
        let mut wrapper_specs = self
            .semantic_manifest
            .generated_wrapper_specs(&target.semantic_manifest, plan)?;
        merge_transition_warnings(&mut self.ir.warnings, target.ir.warnings);
        self.ir.root = inject_generated_wrappers(self.ir.root, &mut wrapper_specs);
        if let Some(missing_spec) = wrapper_specs.into_values().next() {
            return Err(CompatibilityMismatch {
                category: CompatibilityCategory::Id,
                node_id: missing_spec.source_node_id,
                expected: "semantic IR Group available for generated wrapper injection".to_string(),
                observed: "semantic IR Group disappeared after compatibility validation"
                    .to_string(),
            });
        }
        Ok(self.ir)
    }

    #[cfg(test)]
    /// Count authored source entries represented by this compiled state.
    pub(crate) fn semantic_node_count(&self) -> usize {
        self.semantic_manifest.entries.len()
    }

    #[cfg(test)]
    /// Borrow the compiled reference snapshot for transition assertions.
    pub(crate) fn ir(&self) -> &Ir {
        &self.ir
    }
}

fn merge_transition_warnings(
    reference: &mut Vec<SerializedRecoverableError>,
    target: Vec<SerializedRecoverableError>,
) {
    reference.extend(target);
}
