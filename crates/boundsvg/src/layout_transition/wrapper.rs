use std::collections::BTreeMap;

use serde_json::Value;

use crate::ir::types::{AnimationSpec, BBox, IrNode, IrNodeKind};

use super::affine::{AxisAlignedAffine, bbox_world_delta};
use super::manifest::{SemanticManifest, SemanticManifestEntry, required_entry_bbox};
use super::plan::LayoutTransitionPlanInput;
use super::signature::{signature_has_non_identity_transform, signature_has_painted_canvas_stroke};
use super::{CompatibilityCategory, CompatibilityMismatch};

pub(super) const GENERATED_WRAPPER_ID_PREFIX: &str = "__boundsvg:layout-transition-wrapper:";
pub(super) const GENERATED_PROVENANCE_KEY: &str = "boundsvg.generated";
pub(super) const GENERATED_PROVENANCE_VALUE: &str = "layout-transition-wrapper";
pub(super) const GENERATED_SOURCE_NODE_ID_KEY: &str = "boundsvg.sourceNodeId";

#[derive(Debug)]
pub(super) struct GeneratedWrapperSpec {
    wrapper_id: String,
    pub(super) source_node_id: String,
    bbox: BBox,
    animation: AnimationSpec,
}

#[derive(Debug, Clone)]
struct NonUniformGeneratedScale {
    source_node_id: String,
    scale_x: f64,
    scale_y: f64,
}

impl SemanticManifest {
    pub(super) fn generated_wrapper_specs(
        &self,
        target: &Self,
        plan: &LayoutTransitionPlanInput,
    ) -> Result<BTreeMap<String, GeneratedWrapperSpec>, CompatibilityMismatch> {
        let mut generated_world_by_id = BTreeMap::new();
        let mut canvas_stroke_scale_issue_by_id = BTreeMap::new();
        let mut specs = BTreeMap::new();
        for (preorder_index, reference_entry) in self.entries.iter().enumerate() {
            let target_index = target
                .index_by_id
                .get(&reference_entry.node_id)
                .ok_or_else(|| CompatibilityMismatch {
                    category: CompatibilityCategory::Id,
                    node_id: reference_entry.node_id.clone(),
                    expected: "same authored ID set as reference".to_string(),
                    observed: "missing from target state".to_string(),
                })?;
            let target_entry = &target.entries[*target_index];
            let reference_bbox = required_entry_bbox(reference_entry, "reference")?;
            let target_bbox = required_entry_bbox(target_entry, "target")?;
            let generated_world =
                bbox_world_delta(reference_bbox, target_bbox, &reference_entry.node_id)?;
            let (parent_world, parent_scale_issue) = parent_generated_state(
                reference_entry,
                &generated_world_by_id,
                &canvas_stroke_scale_issue_by_id,
            )?;
            let local_residual = parent_world
                .inverse(&reference_entry.node_id)?
                .multiply(generated_world);
            let scale_issue = parent_scale_issue.or_else(|| {
                (local_residual.scale_x != local_residual.scale_y).then(|| {
                    NonUniformGeneratedScale {
                        source_node_id: reference_entry.node_id.clone(),
                        scale_x: local_residual.scale_x,
                        scale_y: local_residual.scale_y,
                    }
                })
            });
            generated_world_by_id.insert(reference_entry.node_id.clone(), generated_world);
            canvas_stroke_scale_issue_by_id
                .insert(reference_entry.node_id.clone(), scale_issue.clone());

            validate_generated_scale_contract(reference_entry, generated_world, scale_issue)?;
            if local_residual.is_identity() {
                continue;
            }
            let wrapper_id = format!(
                "{GENERATED_WRAPPER_ID_PREFIX}{preorder_index}:{}",
                reference_entry.node_id
            );
            let animation =
                plan.generated_animation(reference_bbox, local_residual, &reference_entry.node_id)?;
            specs.insert(
                reference_entry.node_id.clone(),
                GeneratedWrapperSpec {
                    wrapper_id,
                    source_node_id: reference_entry.node_id.clone(),
                    bbox: reference_bbox,
                    animation,
                },
            );
        }
        Ok(specs)
    }
}

fn parent_generated_state(
    entry: &SemanticManifestEntry,
    generated_world_by_id: &BTreeMap<String, AxisAlignedAffine>,
    scale_issue_by_id: &BTreeMap<String, Option<NonUniformGeneratedScale>>,
) -> Result<(AxisAlignedAffine, Option<NonUniformGeneratedScale>), CompatibilityMismatch> {
    let Some(parent_id) = entry.parent_id.as_deref() else {
        return Ok((AxisAlignedAffine::identity(), None));
    };
    let parent_world =
        *generated_world_by_id
            .get(parent_id)
            .ok_or_else(|| CompatibilityMismatch {
                category: CompatibilityCategory::Parent,
                node_id: entry.node_id.clone(),
                expected: "parent generated world transform available in stable preorder"
                    .to_string(),
                observed: format!("missing parent transform for {parent_id:?}"),
            })?;
    let parent_scale_issue =
        scale_issue_by_id
            .get(parent_id)
            .cloned()
            .ok_or_else(|| CompatibilityMismatch {
                category: CompatibilityCategory::Parent,
                node_id: entry.node_id.clone(),
                expected: "parent generated scale path available in stable preorder".to_string(),
                observed: format!("missing parent scale path for {parent_id:?}"),
            })?;
    Ok((parent_world, parent_scale_issue))
}

fn validate_generated_scale_contract(
    entry: &SemanticManifestEntry,
    generated_world: AxisAlignedAffine,
    scale_issue: Option<NonUniformGeneratedScale>,
) -> Result<(), CompatibilityMismatch> {
    if signature_has_painted_canvas_stroke(&entry.paint_signature)
        && let Some(scale_issue) = scale_issue
    {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Stroke,
            node_id: entry.node_id.clone(),
            expected:
                "uniform positive generated local scale on every wrapper ancestor for canvas-stable stroke"
                    .to_string(),
            observed: format!(
                "non-uniform generated local scale x={}, y={} at source node {}",
                scale_issue.scale_x,
                scale_issue.scale_y,
                Value::String(scale_issue.source_node_id)
            ),
        });
    }
    if generated_world.scale_x == 1.0 && generated_world.scale_y == 1.0 {
        return Ok(());
    }
    if signature_has_non_identity_transform(&entry.paint_signature) {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Paint,
            node_id: entry.node_id.clone(),
            expected: "no non-identity authored static transform under generated scale".to_string(),
            observed: "generated world scale with authored static transform".to_string(),
        });
    }
    if signature_has_non_identity_transform(&entry.animation_signature) {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Animation,
            node_id: entry.node_id.clone(),
            expected: "no authored transform animation channel under generated scale".to_string(),
            observed: "generated world scale with authored transform animation".to_string(),
        });
    }
    Ok(())
}

pub(super) fn validate_reserved_wrapper_namespace(
    root: &IrNode,
) -> Result<(), CompatibilityMismatch> {
    if root.node_id.starts_with(GENERATED_WRAPPER_ID_PREFIX) {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Id,
            node_id: root.node_id.clone(),
            expected:
                "authored and internal IR IDs outside the reserved transition wrapper namespace"
                    .to_string(),
            observed: format!("ID uses reserved prefix {GENERATED_WRAPPER_ID_PREFIX:?}"),
        });
    }
    if let IrNodeKind::Group { children, .. } = &root.kind {
        for child in children {
            validate_reserved_wrapper_namespace(child)?;
        }
    }
    Ok(())
}

pub(super) fn inject_generated_wrappers(
    mut node: IrNode,
    wrapper_specs: &mut BTreeMap<String, GeneratedWrapperSpec>,
) -> IrNode {
    // Semantic correspondence is attached to the unique authored Group, while
    // production IR may contain a same-ID paint leaf inside that Group. Claim
    // the spec before descending so the leaf cannot consume its owner's
    // wrapper and leave clips, transforms, or sibling paint behind.
    let wrapper_spec = if matches!(&node.kind, IrNodeKind::Group { .. }) {
        wrapper_specs.remove(&node.node_id)
    } else {
        None
    };
    if let IrNodeKind::Group { children, .. } = &mut node.kind {
        let original_children = std::mem::take(children);
        *children = original_children
            .into_iter()
            .map(|child| inject_generated_wrappers(child, wrapper_specs))
            .collect();
    }

    let Some(spec) = wrapper_spec else {
        return node;
    };
    let mut meta = BTreeMap::new();
    meta.insert(
        GENERATED_PROVENANCE_KEY.to_string(),
        GENERATED_PROVENANCE_VALUE.to_string(),
    );
    meta.insert(
        GENERATED_SOURCE_NODE_ID_KEY.to_string(),
        spec.source_node_id,
    );
    IrNode {
        node_id: spec.wrapper_id,
        bbox: spec.bbox,
        kind: IrNodeKind::Group {
            children: vec![node],
            clip_path: None,
            clip_border_radius: None,
            opacity: None,
            box_shadow: None,
            meta: Some(meta),
            transform: None,
            animation: Some(spec.animation),
            on: None,
        },
    }
}
