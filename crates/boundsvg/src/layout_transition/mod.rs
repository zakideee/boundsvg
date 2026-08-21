//! Compile two compatible layout states into one post-layout transition IR.
//!
//! Semantic provenance is reconstructed from the private layout transport and
//! remains scoped to this operation. The public IR intentionally carries only
//! the generated wrapper provenance needed by downstream inspection.

mod affine;
mod manifest;
mod plan;
mod signature;
mod wrapper;

#[cfg(test)]
mod tests;

use std::collections::BTreeSet;

use serde_json::Value;

use crate::ir::types::{Ir, RenderWarning};
use crate::layout::LayoutInput;

use manifest::SemanticManifest;
pub(crate) use plan::LayoutTransitionPlanInput;
use wrapper::{inject_generated_wrappers, validate_reserved_wrapper_namespace};

#[cfg(test)]
use affine::{AxisAlignedAffine, bbox_world_delta};
#[cfg(test)]
use manifest::describe_parent;
#[cfg(test)]
use signature::{signature_has_non_identity_transform, signature_has_painted_canvas_stroke};
#[cfg(test)]
use wrapper::{
    GENERATED_PROVENANCE_KEY, GENERATED_PROVENANCE_VALUE, GENERATED_SOURCE_NODE_ID_KEY,
    GENERATED_WRAPPER_ID_PREFIX,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

    pub(crate) fn into_transition_ir(
        mut self,
        target: Self,
        plan: &LayoutTransitionPlanInput,
    ) -> Result<Ir, CompatibilityMismatch> {
        self.validate_compatibility(&target)?;
        plan.validate(&self.ir.root.node_id)?;
        validate_reserved_wrapper_namespace(&self.ir.root)?;
        validate_reserved_wrapper_namespace(&target.ir.root)?;
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
    pub(crate) fn semantic_node_count(&self) -> usize {
        self.semantic_manifest.entries.len()
    }

    #[cfg(test)]
    pub(crate) fn ir(&self) -> &Ir {
        &self.ir
    }
}

fn merge_transition_warnings(reference: &mut Vec<RenderWarning>, target: Vec<RenderWarning>) {
    let mut seen = reference
        .iter()
        .map(warning_key)
        .collect::<BTreeSet<String>>();
    for warning in target {
        let key = warning_key(&warning);
        if seen.insert(key) {
            reference.push(warning);
        }
    }
}

fn warning_key(warning: &RenderWarning) -> String {
    serde_json::to_string(warning).unwrap_or_else(|_| {
        format!(
            "{:?}|{}|{}|{:?}|{:?}",
            warning.stage, warning.code, warning.message, warning.node_id, warning.fallback
        )
    })
}
