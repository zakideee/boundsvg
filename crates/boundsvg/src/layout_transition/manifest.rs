use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::ir::types::{BBox, IrNode, IrNodeKind};
use crate::layout::LayoutNodeInput;

use super::affine::describe_bbox;
use super::signature::{semantic_source_signatures, text_flow_signature};
use super::{CompatibilityCategory, CompatibilityMismatch};

#[derive(Debug, Clone, PartialEq)]
pub(super) struct SemanticManifestEntry {
    pub(super) node_id: String,
    pub(super) node_kind: String,
    pub(super) parent_id: Option<String>,
    pub(super) sibling_order: usize,
    pub(super) content_signature: Value,
    pub(super) paint_signature: Value,
    pub(super) animation_signature: Value,
    pub(super) text_flow_signature: Value,
    pub(super) bbox: Option<BBox>,
}

#[derive(Debug)]
pub(super) struct SemanticManifest {
    pub(super) entries: Vec<SemanticManifestEntry>,
    pub(super) index_by_id: BTreeMap<String, usize>,
}

impl SemanticManifest {
    pub(super) fn from_root(
        root: &LayoutNodeInput,
        raw_root: &Value,
    ) -> Result<Self, CompatibilityMismatch> {
        let mut entries = Vec::new();
        let mut index_by_id = BTreeMap::new();
        collect_semantic_entries(root, raw_root, None, 0, &mut entries, &mut index_by_id)?;
        Ok(Self {
            entries,
            index_by_id,
        })
    }

    pub(super) fn attach_ir_groups(&mut self, root: &IrNode) -> Result<(), CompatibilityMismatch> {
        let mut group_nodes = BTreeMap::new();
        collect_group_nodes(root, &mut group_nodes);
        let semantic_ids = self.index_by_id.keys().cloned().collect::<BTreeSet<_>>();
        for entry in &mut self.entries {
            let matching_groups = group_nodes.get(&entry.node_id);
            let observed_count = matching_groups.map_or(0, Vec::len);
            if observed_count != 1 {
                return Err(CompatibilityMismatch {
                    category: CompatibilityCategory::Id,
                    node_id: entry.node_id.clone(),
                    expected: "exactly one semantic IR Group".to_string(),
                    observed: format!("{observed_count} matching IR Groups"),
                });
            }
            let group = matching_groups
                .and_then(|groups| groups.first())
                .copied()
                .ok_or_else(|| CompatibilityMismatch {
                    category: CompatibilityCategory::Id,
                    node_id: entry.node_id.clone(),
                    expected: "exactly one semantic IR Group".to_string(),
                    observed: "missing matching IR Group".to_string(),
                })?;
            validate_bbox(entry, group.bbox)?;
            entry.bbox = Some(group.bbox);
            entry.text_flow_signature = text_flow_signature(group, &entry.node_id, &semantic_ids);
        }
        Ok(())
    }

    pub(super) fn validate_compatibility(
        &self,
        target: &Self,
    ) -> Result<(), CompatibilityMismatch> {
        for reference_entry in &self.entries {
            let Some(target_index) = target.index_by_id.get(&reference_entry.node_id) else {
                return Err(CompatibilityMismatch {
                    category: CompatibilityCategory::Id,
                    node_id: reference_entry.node_id.clone(),
                    expected: "same authored ID set as reference".to_string(),
                    observed: "missing from target state".to_string(),
                });
            };
            compare_entry(reference_entry, &target.entries[*target_index])?;
        }
        for target_entry in &target.entries {
            if !self.index_by_id.contains_key(&target_entry.node_id) {
                return Err(CompatibilityMismatch {
                    category: CompatibilityCategory::Id,
                    node_id: target_entry.node_id.clone(),
                    expected: "same authored ID set as reference".to_string(),
                    observed: "present only in target state".to_string(),
                });
            }
        }
        Ok(())
    }
}

fn collect_semantic_entries(
    node: &LayoutNodeInput,
    raw_node: &Value,
    parent_id: Option<&str>,
    sibling_order: usize,
    entries: &mut Vec<SemanticManifestEntry>,
    index_by_id: &mut BTreeMap<String, usize>,
) -> Result<(), CompatibilityMismatch> {
    if !node.authored_id {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Id,
            node_id: node.node_id.clone(),
            expected: "authored explicit ID".to_string(),
            observed: "generated ID".to_string(),
        });
    }
    if index_by_id.contains_key(&node.node_id) {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Id,
            node_id: node.node_id.clone(),
            expected: "unique authored ID".to_string(),
            observed: "duplicate authored ID".to_string(),
        });
    }
    let raw_node_id = raw_node.get("nodeId").and_then(Value::as_str);
    if raw_node_id != Some(node.node_id.as_str()) {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Id,
            node_id: node.node_id.clone(),
            expected: "raw and typed semantic node IDs to match".to_string(),
            observed: raw_node_id.unwrap_or("<missing>").to_string(),
        });
    }
    let signatures = semantic_source_signatures(raw_node, &node.node_id)?;

    let entry_index = entries.len();
    index_by_id.insert(node.node_id.clone(), entry_index);
    entries.push(SemanticManifestEntry {
        node_id: node.node_id.clone(),
        node_kind: node.node_type.clone(),
        parent_id: parent_id.map(str::to_string),
        sibling_order,
        content_signature: signatures.content,
        paint_signature: signatures.paint,
        animation_signature: signatures.animation,
        text_flow_signature: Value::Array(Vec::new()),
        bbox: None,
    });

    let raw_children = raw_node
        .get("children")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    if raw_children.len() != node.children.len() {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Id,
            node_id: node.node_id.clone(),
            expected: format!("{} semantic children", node.children.len()),
            observed: format!("{} raw children", raw_children.len()),
        });
    }
    for (child_order, child) in node.children.iter().enumerate() {
        collect_semantic_entries(
            child,
            &raw_children[child_order],
            Some(&node.node_id),
            child_order,
            entries,
            index_by_id,
        )?;
    }
    Ok(())
}

fn collect_group_nodes<'a>(node: &'a IrNode, group_nodes: &mut BTreeMap<String, Vec<&'a IrNode>>) {
    if let IrNodeKind::Group { children, .. } = &node.kind {
        group_nodes
            .entry(node.node_id.clone())
            .or_default()
            .push(node);
        for child in children {
            collect_group_nodes(child, group_nodes);
        }
    }
}

fn compare_entry(
    reference: &SemanticManifestEntry,
    target: &SemanticManifestEntry,
) -> Result<(), CompatibilityMismatch> {
    if reference.node_kind != target.node_kind {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Kind,
            node_id: reference.node_id.clone(),
            expected: reference.node_kind.clone(),
            observed: target.node_kind.clone(),
        });
    }
    if reference.parent_id != target.parent_id {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Parent,
            node_id: reference.node_id.clone(),
            expected: describe_parent(reference.parent_id.as_deref()),
            observed: describe_parent(target.parent_id.as_deref()),
        });
    }
    if reference.sibling_order != target.sibling_order {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Order,
            node_id: reference.node_id.clone(),
            expected: reference.sibling_order.to_string(),
            observed: target.sibling_order.to_string(),
        });
    }
    if reference.content_signature != target.content_signature
        || reference.text_flow_signature != target.text_flow_signature
    {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Content,
            node_id: reference.node_id.clone(),
            expected: "same source content and line/glyph sequence as reference".to_string(),
            observed: "content or text flow differs in target state".to_string(),
        });
    }
    if reference.paint_signature != target.paint_signature {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Paint,
            node_id: reference.node_id.clone(),
            expected: "same paint, static transform, metadata, and handlers as reference"
                .to_string(),
            observed: "paint or authored static data differs in target state".to_string(),
        });
    }
    if reference.animation_signature != target.animation_signature {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Animation,
            node_id: reference.node_id.clone(),
            expected: "same authored animation as reference".to_string(),
            observed: "authored animation differs in target state".to_string(),
        });
    }
    validate_bbox_pair(reference, target)
}

fn validate_bbox(entry: &SemanticManifestEntry, bbox: BBox) -> Result<(), CompatibilityMismatch> {
    if !bbox.x.is_finite() || !bbox.y.is_finite() || !bbox.w.is_finite() || !bbox.h.is_finite() {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Bbox,
            node_id: entry.node_id.clone(),
            expected: "finite bbox coordinates and dimensions".to_string(),
            observed: describe_bbox(bbox),
        });
    }
    if bbox.w < 0.0 || bbox.h < 0.0 {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Bbox,
            node_id: entry.node_id.clone(),
            expected: "non-negative bbox dimensions".to_string(),
            observed: describe_bbox(bbox),
        });
    }
    Ok(())
}

fn validate_bbox_pair(
    reference: &SemanticManifestEntry,
    target: &SemanticManifestEntry,
) -> Result<(), CompatibilityMismatch> {
    let reference_bbox = required_entry_bbox(reference, "reference")?;
    let target_bbox = required_entry_bbox(target, "target")?;
    if (reference_bbox.w != target_bbox.w && (reference_bbox.w == 0.0 || target_bbox.w == 0.0))
        || (reference_bbox.h != target_bbox.h && (reference_bbox.h == 0.0 || target_bbox.h == 0.0))
    {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Bbox,
            node_id: reference.node_id.clone(),
            expected: "non-zero dimensions on every axis that changes size".to_string(),
            observed: format!(
                "reference {}, target {}",
                describe_bbox(reference_bbox),
                describe_bbox(target_bbox)
            ),
        });
    }
    Ok(())
}

pub(super) fn required_entry_bbox(
    entry: &SemanticManifestEntry,
    state_name: &str,
) -> Result<BBox, CompatibilityMismatch> {
    entry.bbox.ok_or_else(|| CompatibilityMismatch {
        category: CompatibilityCategory::Bbox,
        node_id: entry.node_id.clone(),
        expected: format!("{state_name} semantic bbox"),
        observed: format!("missing {state_name} bbox"),
    })
}

pub(super) fn describe_parent(parent_id: Option<&str>) -> String {
    parent_id.map_or_else(
        || "root (no parent)".to_string(),
        |node_id| format!("parent {node_id:?}"),
    )
}
