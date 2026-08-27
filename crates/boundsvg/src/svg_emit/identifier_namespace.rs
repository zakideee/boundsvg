//! Allocation of boundsvg-generated, document-global SVG identifiers.
//!
//! Every generated DOM id, keyframe name, and generated class must pass
//! through this module. Keeping the role vocabulary here prevents a new
//! emitter site from accidentally omitting `resourceIdPrefix`.

use crate::svg_emit::xml::to_css_safe_resource_id;

/// A document-global identifier role owned by boundsvg.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SvgIdentifierRole {
    AnimationClass,
    AnimationKeyframes,
    CanvasStrokeClass,
    ClipPathId,
    DebugOverlayClass,
    FilterId,
    GradientId,
    SharedShapePathId,
}

impl SvgIdentifierRole {
    fn is_generated_class(self) -> bool {
        matches!(
            self,
            SvgIdentifierRole::AnimationClass
                | SvgIdentifierRole::CanvasStrokeClass
                | SvgIdentifierRole::DebugOverlayClass
        )
    }

    fn local_token(self, safe_owner: &str) -> String {
        match self {
            SvgIdentifierRole::AnimationClass => format!("anim-{safe_owner}"),
            SvgIdentifierRole::AnimationKeyframes => format!("anim-{safe_owner}-keyframes"),
            SvgIdentifierRole::CanvasStrokeClass => format!("vstroke-{safe_owner}"),
            SvgIdentifierRole::ClipPathId => format!("clip-{safe_owner}"),
            SvgIdentifierRole::DebugOverlayClass => "debug-overlay".to_string(),
            SvgIdentifierRole::FilterId => format!("filter-{safe_owner}"),
            SvgIdentifierRole::GradientId => format!("grad-{safe_owner}"),
            SvgIdentifierRole::SharedShapePathId => format!("sp-{safe_owner}"),
        }
    }
}

/// Deterministic allocator for boundsvg-generated SVG identifiers.
///
/// The caller-provided prefix is normalized once. Separate rendered documents
/// are guaranteed not to share generated identifiers when their normalized
/// prefixes are non-empty and pairwise prefix-free. Merely different prefixes
/// are not sufficient because the prefix is intentionally kept literal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SvgIdentifierNamespace {
    normalized_prefix: String,
}

impl SvgIdentifierNamespace {
    pub(crate) fn new(raw_prefix: &str) -> Self {
        Self {
            normalized_prefix: to_css_safe_resource_id(raw_prefix),
        }
    }

    /// Allocate one identifier in its generated role.
    pub(crate) fn identifier(&self, role: SvgIdentifierRole, owner: &str) -> String {
        let safe_owner = to_css_safe_resource_id(owner);
        let local_token = role.local_token(&safe_owner);

        // Preserve the legacy unprefixed debug class byte-for-byte. With an
        // explicit prefix it joins the same `bsvg-<prefix>...` class namespace
        // as animation and canvas-stroke classes.
        if role == SvgIdentifierRole::DebugOverlayClass && self.normalized_prefix.is_empty() {
            return local_token;
        }

        if role.is_generated_class() {
            format!("bsvg-{}{local_token}", self.normalized_prefix)
        } else {
            format!("{}{local_token}", self.normalized_prefix)
        }
    }

    /// Allocate a deterministic collision suffix. Ordinal one is the base
    /// token; later ordinals append `-2`, `-3`, and so on.
    pub(crate) fn identifier_with_ordinal(
        &self,
        role: SvgIdentifierRole,
        owner: &str,
        ordinal: usize,
    ) -> String {
        let base_identifier = self.identifier(role, owner);
        if ordinal <= 1 {
            base_identifier
        } else {
            format!("{base_identifier}-{ordinal}")
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    const ROLES: [SvgIdentifierRole; 8] = [
        SvgIdentifierRole::AnimationClass,
        SvgIdentifierRole::AnimationKeyframes,
        SvgIdentifierRole::CanvasStrokeClass,
        SvgIdentifierRole::ClipPathId,
        SvgIdentifierRole::DebugOverlayClass,
        SvgIdentifierRole::FilterId,
        SvgIdentifierRole::GradientId,
        SvgIdentifierRole::SharedShapePathId,
    ];

    #[test]
    fn preserves_every_legacy_unprefixed_token_shape() {
        let namespace = SvgIdentifierNamespace::new("");
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::AnimationClass, "node:1"),
            "bsvg-anim-node:1"
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::AnimationKeyframes, "node:1"),
            "anim-node:1-keyframes"
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::CanvasStrokeClass, "node:1"),
            "bsvg-vstroke-node:1"
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::ClipPathId, "node:1"),
            "clip-node:1"
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::DebugOverlayClass, ""),
            "debug-overlay"
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::FilterId, "node:1"),
            "filter-node:1"
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::GradientId, "node:1"),
            "grad-node:1"
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::SharedShapePathId, "abc123"),
            "sp-abc123"
        );
        assert_eq!(
            namespace.identifier_with_ordinal(SvgIdentifierRole::CanvasStrokeClass, "node:1", 2),
            "bsvg-vstroke-node:1-2"
        );
        assert_eq!(
            namespace.identifier_with_ordinal(SvgIdentifierRole::SharedShapePathId, "abc123", 2),
            "sp-abc123-2"
        );
    }

    #[test]
    fn applies_one_normalized_namespace_to_every_token_role() {
        let raw_prefix = "doc one/";
        let normalized_prefix = to_css_safe_resource_id(raw_prefix);
        let namespace = SvgIdentifierNamespace::new(raw_prefix);

        assert_eq!(
            namespace.identifier(SvgIdentifierRole::AnimationClass, "node"),
            format!("bsvg-{normalized_prefix}anim-node")
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::AnimationKeyframes, "node"),
            format!("{normalized_prefix}anim-node-keyframes")
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::CanvasStrokeClass, "node"),
            format!("bsvg-{normalized_prefix}vstroke-node")
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::ClipPathId, "node"),
            format!("{normalized_prefix}clip-node")
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::DebugOverlayClass, ""),
            format!("bsvg-{normalized_prefix}debug-overlay")
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::FilterId, "node"),
            format!("{normalized_prefix}filter-node")
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::GradientId, "node"),
            format!("{normalized_prefix}grad-node")
        );
        assert_eq!(
            namespace.identifier(SvgIdentifierRole::SharedShapePathId, "abc123"),
            format!("{normalized_prefix}sp-abc123")
        );
    }

    #[test]
    fn pairwise_prefix_free_namespaces_produce_disjoint_generated_tokens() {
        let namespaces: Vec<SvgIdentifierNamespace> = (0..32)
            .map(|scope_index| SvgIdentifierNamespace::new(&format!("scope-{scope_index:02}-")))
            .collect();
        let generated_sets: Vec<BTreeSet<String>> = namespaces
            .iter()
            .map(|namespace| {
                ROLES
                    .iter()
                    .flat_map(|role| {
                        ["node", "clip-node", "node:unit:10"]
                            .into_iter()
                            .flat_map(move |owner| {
                                (1..=3).map(move |ordinal| {
                                    namespace.identifier_with_ordinal(*role, owner, ordinal)
                                })
                            })
                    })
                    .collect()
            })
            .collect();

        for left_index in 0..generated_sets.len() {
            for right_index in (left_index + 1)..generated_sets.len() {
                assert!(
                    generated_sets[left_index].is_disjoint(&generated_sets[right_index]),
                    "scope {left_index} intersects scope {right_index}"
                );
            }
        }
    }

    #[test]
    fn prefix_extension_pairs_are_intentionally_outside_the_guarantee() {
        let shorter = SvgIdentifierNamespace::new("doc-");
        let extension = SvgIdentifierNamespace::new("doc-clip-");

        assert_eq!(
            shorter.identifier(SvgIdentifierRole::ClipPathId, "clip-x"),
            extension.identifier(SvgIdentifierRole::ClipPathId, "x")
        );
    }
}
