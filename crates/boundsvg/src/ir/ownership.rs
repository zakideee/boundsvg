//! Structural source ownership and occurrence identity for one IR snapshot.

use std::collections::{BTreeMap, HashMap};

use super::types::{HandlersRef, IrNode, IrNodeKind};
use crate::error::EngineError;

/// Relationship between a node and the semantic source that owns its paint.
#[derive(Debug, Clone)]
pub enum IrNodeOwnership {
    /// Semantic entity; event handlers and application metadata live only here.
    Source {
        /// Application callback references owned by this semantic occurrence.
        on: Option<Box<HandlersRef>>,
        /// Application metadata validated against the authoring key and UTF-16 limits.
        meta: Option<BTreeMap<String, String>>,
    },
    /// The source's sole primary paint primitive.
    Content {
        /// Label of the nearest structural source ancestor, checked without ID lookup.
        owner_node_id: String,
    },
    /// Non-selectable paint belonging to the source.
    Decoration {
        /// Label of the nearest structural source ancestor.
        owner_node_id: String,
    },
    /// Transparent structural group belonging to a source occurrence.
    Wrapper {
        /// Label of the structural owner selected by placement.
        owner_node_id: String,
        /// Whether the owner is the source ancestor or the one direct source child.
        placement: WrapperPlacement,
    },
}

/// Whether a wrapper belongs to a source ancestor or its one direct source child.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WrapperPlacement {
    /// The nearest source ancestor owns the wrapper.
    Inner,
    /// The one direct source child owns the wrapper.
    Outer,
}

impl IrNodeOwnership {
    /// Event references owned by this source, if any.
    #[must_use]
    pub fn handlers(&self) -> Option<&HandlersRef> {
        match self {
            Self::Source { on, .. } => on.as_deref(),
            _ => None,
        }
    }

    /// Application metadata owned by this source, if any.
    #[must_use]
    pub fn metadata(&self) -> Option<&BTreeMap<String, String>> {
        match self {
            Self::Source { meta, .. } => meta.as_ref(),
            _ => None,
        }
    }

    /// Whether this occurrence is a semantic source.
    #[must_use]
    pub fn is_source(&self) -> bool {
        matches!(self, Self::Source { .. })
    }

    /// Serialized role vocabulary shared by scene and DOM association output.
    #[must_use]
    pub fn role(&self) -> &'static str {
        match self {
            Self::Source { .. } => "source",
            Self::Content { .. } => "content",
            Self::Decoration { .. } => "decoration",
            Self::Wrapper { .. } => "wrapper",
        }
    }
}

/// Semantic occurrence reference in one IR snapshot, not a persistent document ID.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrSourceRef {
    /// Preorder ordinal of the owning source, including wrappers in the count.
    pub source_index: usize,
    /// Semantic label; distinct source occurrences may share it.
    pub node_id: String,
}

/// One physical node and its unambiguous source occurrence in an indexed tree.
#[derive(Debug)]
pub struct IrNodeOccurrence<'a> {
    /// Borrow of the physical node in this exact snapshot.
    pub node: &'a IrNode,
    /// Preorder ordinal including all wrappers.
    pub node_index: usize,
    /// Preorder ordinal of the structurally resolved source.
    pub source_index: usize,
    /// Primitive ordinal in tree order; groups have no paint ordinal.
    pub paint_order: Option<usize>,
    /// Traversal rank at entry, before descendants.
    pub enter_order: usize,
    /// Traversal rank at exit, after descendants.
    pub leave_order: usize,
}

/// Structural facts about a semantic source, without copying its paint geometry.
#[derive(Debug)]
pub struct IrSourceInfo {
    /// Nearest source ancestor, independent of repeated labels.
    pub parent_source_index: Option<usize>,
    /// Sole primary paint, or none for a source frame without content.
    pub primary_node_index: Option<usize>,
    /// Source depth with wrappers transparent.
    pub depth: usize,
}

/// Snapshot-local ownership projection; indices are not persistent document IDs.
#[derive(Debug)]
pub struct IrSourceIndex<'a> {
    /// All physical occurrences in preorder.
    pub nodes: Vec<IrNodeOccurrence<'a>>,
    /// Source-owned facts keyed by the source preorder ordinal.
    pub sources: HashMap<usize, IrSourceInfo>,
    node_indices: HashMap<*const IrNode, usize>,
}

fn invalid(node: &IrNode, message: &str) -> EngineError {
    EngineError::Structured {
        code: "VALIDATION".to_string(),
        message: message.to_string(),
        stage: Some(crate::diagnostics::PipelineStage::Ir),
        node_id: Some(node.node_id.clone()),
    }
}

/// Validate the existing application-metadata contract at every IR entry.
///
/// # Errors
///
/// Returns `VALIDATION` for invalid keys, more than sixteen keys, or values
/// longer than 256 UTF-16 code units.
pub(crate) fn validate_source_meta(
    node_id: &str,
    meta: &BTreeMap<String, String>,
) -> Result<(), EngineError> {
    let key_is_valid = |key: &str| {
        let bytes = key.as_bytes();
        !bytes.is_empty()
            && bytes.len() <= 32
            && bytes[0].is_ascii_lowercase()
            && bytes
                .iter()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
    };
    if meta.len() > 16
        || meta
            .iter()
            .any(|(key, value)| !key_is_valid(key) || value.encode_utf16().count() > 256)
    {
        return Err(EngineError::Structured {
            code: "VALIDATION".to_string(),
            message: "Source meta requires at most 16 lowercase ASCII keys of 1..32 characters and string values of at most 256 UTF-16 code units.".to_string(),
            stage: Some(crate::diagnostics::PipelineStage::Ir),
            node_id: Some(node_id.to_string()),
        });
    }
    Ok(())
}

/// Index and validate structural ownership in O(nodes + owner ID bytes).
///
/// # Errors
///
/// Returns `VALIDATION` for invalid kind/role combinations, unresolved local
/// owners, invalid wrapper placement, multiple primary paints, or source meta.
pub fn build_source_index(root: &IrNode) -> Result<IrSourceIndex<'_>, EngineError> {
    enum Task<'a> {
        Enter(&'a IrNode, Option<usize>),
        Leave(usize),
    }
    let mut index = IrSourceIndex {
        nodes: Vec::new(),
        sources: HashMap::new(),
        node_indices: HashMap::new(),
    };
    let mut stack = vec![Task::Enter(root, None)];
    let mut paint_order = 0;
    let mut event_order = 0;
    while let Some(task) = stack.pop() {
        let (node, parent_source) = match task {
            Task::Enter(node, parent) => (node, parent),
            Task::Leave(node_index) => {
                index.nodes[node_index].leave_order = event_order;
                event_order += 1;
                continue;
            }
        };
        let node_index = index.nodes.len();
        index
            .node_indices
            .insert(std::ptr::from_ref(node), node_index);
        let is_group = matches!(node.kind, IrNodeKind::Group { .. });
        let source_index = match &node.ownership {
            IrNodeOwnership::Source { meta, .. } => {
                if let Some(meta) = meta {
                    validate_source_meta(&node.node_id, meta)?;
                }
                let depth = parent_source.map_or(0, |parent| index.sources[&parent].depth + 1);
                index.sources.insert(
                    node_index,
                    IrSourceInfo {
                        parent_source_index: parent_source,
                        primary_node_index: (!is_group).then_some(node_index),
                        depth,
                    },
                );
                node_index
            }
            IrNodeOwnership::Wrapper {
                owner_node_id,
                placement: WrapperPlacement::Outer,
            } => {
                let IrNodeKind::Group { children, .. } = &node.kind else {
                    return Err(invalid(node, "A wrapper must be a group."));
                };
                if children.len() != 1
                    || !children[0].ownership.is_source()
                    || children[0].node_id != *owner_node_id
                {
                    return Err(invalid(
                        node,
                        "An outer wrapper requires exactly one direct source child matching ownerNodeId.",
                    ));
                }
                node_index + 1
            }
            ownership => {
                let owner = parent_source.ok_or_else(|| {
                    invalid(
                        node,
                        "A non-source node requires its nearest source ancestor.",
                    )
                })?;
                let owner_id = &index.nodes[owner].node.node_id;
                let declared_owner = match ownership {
                    IrNodeOwnership::Content { owner_node_id }
                    | IrNodeOwnership::Decoration { owner_node_id } => {
                        if is_group {
                            return Err(invalid(
                                node,
                                "Content and decoration must be paint primitives.",
                            ));
                        }
                        owner_node_id
                    }
                    IrNodeOwnership::Wrapper { owner_node_id, .. } => {
                        if !is_group {
                            return Err(invalid(node, "A wrapper must be a group."));
                        }
                        owner_node_id
                    }
                    IrNodeOwnership::Source { .. } => {
                        return Err(invalid(node, "Unexpected source ownership branch."));
                    }
                };
                if declared_owner != owner_id {
                    return Err(invalid(
                        node,
                        "ownerNodeId must match the nearest source ancestor.",
                    ));
                }
                if matches!(ownership, IrNodeOwnership::Content { .. }) {
                    let source = index
                        .sources
                        .get_mut(&owner)
                        .ok_or_else(|| invalid(node, "Missing structural source ancestor."))?;
                    if source.primary_node_index.replace(node_index).is_some() {
                        return Err(invalid(
                            node,
                            "A source occurrence may own at most one content primitive.",
                        ));
                    }
                }
                owner
            }
        };
        let current_paint = if is_group {
            None
        } else {
            let current = paint_order;
            paint_order += 1;
            Some(current)
        };
        index.nodes.push(IrNodeOccurrence {
            node,
            node_index,
            source_index,
            paint_order: current_paint,
            enter_order: event_order,
            leave_order: event_order,
        });
        event_order += 1;
        stack.push(Task::Leave(node_index));
        if let IrNodeKind::Group { children, .. } = &node.kind {
            let next_source = if node.ownership.is_source() {
                Some(node_index)
            } else {
                parent_source
            };
            for child in children.iter().rev() {
                stack.push(Task::Enter(child, next_source));
            }
        }
    }
    Ok(index)
}

impl<'a> IrSourceIndex<'a> {
    /// Find the occurrence of a node borrowed from this exact snapshot.
    ///
    /// # Panics
    ///
    /// Panics if the node was not borrowed from the indexed tree.
    pub(crate) fn occurrence(&self, node: &IrNode) -> &IrNodeOccurrence<'a> {
        &self.nodes[self.node_indices[&std::ptr::from_ref(node)]]
    }

    /// Generated resource key for one physical node, independent of its label.
    ///
    /// # Panics
    ///
    /// Panics if the node was not borrowed from the indexed tree.
    pub(crate) fn resource_key(&self, node: &IrNode) -> String {
        node_resource_key(self.occurrence(node).node_index)
    }
}

/// Stable resource key within one snapshot, independent of semantic node labels.
pub(crate) fn node_resource_key(node_index: usize) -> String {
    format!("n{node_index}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn source(node_id: &str, children: &[Value]) -> Value {
        json!({"type":"group","nodeId":node_id,"ownership":{"role":"source"},"bbox":{"x":0,"y":0,"w":40,"h":30},"children":children})
    }

    fn paint(node_id: &str, role: &str, owner: &str) -> Value {
        json!({"type":"rect","nodeId":node_id,"ownership":{"role":role,"ownerNodeId":owner},"bbox":{"x":0,"y":0,"w":40,"h":30},"fill":"red"})
    }

    fn valid(value: Value) -> bool {
        serde_json::from_value::<super::super::wire_input::IrNodeInput>(value)
            .map(IrNode::from)
            .is_ok_and(|root| build_source_index(&root).is_ok())
    }

    #[test]
    fn same_labels_resolve_by_structure_and_count_primary_through_inner_wrappers() {
        let mut inner = source("same:content", &[paint("same", "content", "same")]);
        inner["ownership"] = json!({"role":"wrapper","placement":"inner","ownerNodeId":"same"});
        let mut outer = source(
            "same",
            &[source("same", &[paint("same", "content", "same")])],
        );
        outer["ownership"] = json!({"role":"wrapper","placement":"outer","ownerNodeId":"same"});
        let root: IrNode = IrNode::from(
            serde_json::from_value::<super::super::wire_input::IrNodeInput>(source(
                "same",
                &[inner, outer],
            ))
            .expect("wire"),
        );
        let index = build_source_index(&root).expect("structurally distinct sources");
        assert_eq!(index.nodes[1].source_index, 0);
        assert_eq!(index.nodes[2].source_index, 0);
        assert_eq!(index.nodes[3].source_index, 4);
        assert_eq!(index.sources[&0].primary_node_index, Some(2));
        assert_eq!(index.sources[&4].primary_node_index, Some(5));
        assert_eq!(index.sources[&4].parent_source_index, Some(0));
    }

    #[test]
    fn rejects_invalid_roles_owners_placement_and_duplicate_primary() {
        assert!(!valid(paint("root", "content", "root")));
        assert!(!valid(source("root", &[paint("x", "content", "other")])));
        assert!(!valid(source(
            "root",
            &[paint("a", "content", "root"), paint("b", "content", "root")]
        )));
        for ownership in [
            json!({"role":"wrapper","ownerNodeId":"root","placement":"inner"}),
            json!({"role":"wrapper","ownerNodeId":"root","placement":"outer"}),
            json!({"role":"content","ownerNodeId":"root"}),
            json!({"role":"decoration","ownerNodeId":"root"}),
        ] {
            let mut root = source("root", &[]);
            root["ownership"] = ownership;
            assert!(!valid(root));
        }
        let mut outer = source("frame", &[source("root", &[])]);
        outer["ownership"] = json!({"role":"wrapper","ownerNodeId":"root","placement":"outer"});
        assert!(valid(outer.clone()));
        outer["children"] = json!([outer["children"][0], source("root", &[])]);
        assert!(!valid(outer));
    }

    #[test]
    fn ownership_is_required_closed_and_non_null_in_every_variant() {
        let baseline = source("root", &[]);
        for ownership in [
            Value::Null,
            json!({}),
            json!({"role":"source","ownerNodeId":"root"}),
            json!({"role":"source","placement":"inner"}),
            json!({"role":"source","on":null}),
            json!({"role":"source","meta":null}),
            json!({"role":"source","on":{"unknown":"x"}}),
            json!({"role":"source","on":{"onClick":null}}),
            json!({"role":"source","extra":1}),
        ] {
            let mut input = baseline.clone();
            input["ownership"] = ownership;
            assert!(!valid(input));
        }
        let mut absent = baseline;
        absent.as_object_mut().expect("object").remove("ownership");
        assert!(!valid(absent));
        let mut decoration = paint("paint", "decoration", "root");
        decoration["ownership"]["on"] = json!({"onClick":"x"});
        assert!(!valid(source("root", &[decoration])));
    }

    #[test]
    fn metadata_matches_authoring_keys_and_utf16_limits() {
        for (key, value, accepted) in [
            ("a", "😀".repeat(128), true),
            ("a", "😀".repeat(129), false),
            ("a\" data-extra=\"x", "value".into(), false),
            ("a_b", "value".into(), false),
            ("a-9", "value".into(), true),
        ] {
            let mut input = source("root", &[]);
            input["ownership"]["meta"] = json!({key: value});
            assert_eq!(valid(input), accepted);
        }
        let mut input = source("root", &[]);
        input["ownership"]["meta"] = Value::Object(
            (0..17)
                .map(|ordinal| (format!("k{ordinal}"), json!("value")))
                .collect(),
        );
        assert!(!valid(input));
    }

    #[test]
    fn root_is_painted_and_only_source_anchors_carry_business_identity() {
        let mut root = source(
            "root",
            &[
                paint("root", "content", "root"),
                paint("root:outline", "decoration", "root"),
            ],
        );
        root["opacity"] = json!(0.5);
        root["transform"] = json!({"translateX":4});
        root["ownership"]["meta"] = json!({"kind":"card"});
        let ir = super::super::types::Ir {
            root: IrNode::from(
                serde_json::from_value::<super::super::wire_input::IrNodeInput>(root)
                    .expect("wire"),
            ),
            width: 40.0,
            height: 30.0,
            debug: None,
            warnings: Vec::new(),
        };
        let scene =
            crate::scene::resolve_paint_scene(&ir, &crate::scene::PaintSceneOptions::default())
                .expect("scene");
        let svg = crate::svg_emit::emitter::emit_svg_scene(
            &scene,
            crate::svg_emit::emitter::SvgEmitOptions::default(),
        )
        .expect("svg");
        assert!(
            !svg.lines()
                .next()
                .expect("envelope")
                .contains("data-boundsvg-node-id")
        );
        assert_eq!(svg.matches("data-boundsvg-node-id=").count(), 1);
        assert_eq!(svg.matches("data-boundsvg-meta-kind=").count(), 1);
        assert!(svg.contains("opacity=\"0.5\""));
        assert!(svg.contains("data-boundsvg-role=\"content\""));
        assert!(svg.contains("data-boundsvg-role=\"decoration\""));
    }
}
