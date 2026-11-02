use serde_json::{Map, Value, json};

use crate::ir::types::{IrNode, IrNodeKind};

use super::{CompatibilityCategory, CompatibilityMismatch};

/// Every top-level key currently accepted by the TS layout node transport.
/// The bridge-schema test compares this list with `WasmNodeInput` so a new
/// transport field cannot silently bypass transition compatibility.
pub(super) const LAYOUT_NODE_TRANSPORT_KEYS: &[&str] = &[
    "authoredId",
    "children",
    "image",
    "nodeId",
    "nodeType",
    "style",
    "text",
    "textPath",
    "visual",
];

/// Reviewed visual keys used by canvas-stable stroke preflight.
pub(super) const CANVAS_STROKE_SIGNATURE_KEYS: &[&str] =
    &["strokeScaling", "outline", "strokeWidth", "stroke"];

/// Separate content, paint, and animation facts used for semantic transition compatibility.
pub(super) struct SemanticSourceSignatures {
    pub(super) content: Value,
    pub(super) paint: Value,
    pub(super) animation: Value,
}

/// Partition the layout transport into content, paint, and animation signatures.
///
/// # Errors
///
/// Returns a compatibility mismatch for non-object input or unknown top-level transport keys.
pub(super) fn semantic_source_signatures(
    raw_node: &Value,
    node_id: &str,
) -> Result<SemanticSourceSignatures, CompatibilityMismatch> {
    /// Visual transport fields that change source content rather than paint-only presentation.
    const CONTENT_VISUAL_KEYS: &[&str] = &[
        "src",
        "d",
        "svgContent",
        "contentIdPrefix",
        "preserveAspectRatio",
        "shapeGeometry",
        "shapeGeometryId",
        "symbolDefinition",
        "symbolId",
        "emitPartIds",
    ];
    /// Visual transport fields that belong to authored animation compatibility.
    const ANIMATION_VISUAL_KEYS: &[&str] = &[
        "animation",
        "unitAnimation",
        "inlineRectAnimations",
        "inlineDecorationAnimations",
    ];

    let raw_object = raw_node.as_object().ok_or_else(|| CompatibilityMismatch {
        category: CompatibilityCategory::Paint,
        node_id: node_id.to_string(),
        expected: "layout transport node object".to_string(),
        observed: "non-object layout transport node".to_string(),
    })?;
    if let Some(unknown_key) = raw_object
        .keys()
        .find(|key| !LAYOUT_NODE_TRANSPORT_KEYS.contains(&key.as_str()))
    {
        return Err(CompatibilityMismatch {
            category: CompatibilityCategory::Paint,
            node_id: node_id.to_string(),
            expected: "known layout transport top-level keys".to_string(),
            observed: format!("unknown top-level key {unknown_key:?}"),
        });
    }

    let mut content = Map::new();
    for key in ["text", "textPath", "image"] {
        if let Some(value) = raw_node.get(key) {
            content.insert(key.to_string(), value.clone());
        }
    }

    let mut paint = Map::new();
    let mut animation = Map::new();
    if let Some(visual) = raw_node.get("visual").and_then(Value::as_object) {
        for (key, value) in visual {
            if CONTENT_VISUAL_KEYS.contains(&key.as_str()) {
                content.insert(key.clone(), value.clone());
            } else if ANIMATION_VISUAL_KEYS.contains(&key.as_str()) {
                animation.insert(key.clone(), value.clone());
            } else {
                // Unknown visual properties deliberately fail closed as paint
                // signature data rather than disappearing from comparison.
                paint.insert(key.clone(), value.clone());
            }
        }
    }
    Ok(SemanticSourceSignatures {
        content: Value::Object(content),
        paint: Value::Object(paint),
        animation: Value::Object(animation),
    })
}

/// Detect a non-neutral authored transform recursively, including either skew channel.
pub(super) fn signature_has_non_identity_transform(signature: &Value) -> bool {
    match signature {
        Value::Array(values) => values.iter().any(signature_has_non_identity_transform),
        Value::Object(object) => object.iter().any(|(key, value)| {
            if key == "transform" {
                return transform_value_is_non_identity(value);
            }
            signature_has_non_identity_transform(value)
        }),
        _ => false,
    }
}

fn transform_value_is_non_identity(value: &Value) -> bool {
    let Some(transform) = value.as_object() else {
        return false;
    };
    transform.iter().any(|(key, channel)| {
        let Some(number) = channel.as_f64() else {
            return false;
        };
        match key.as_str() {
            "translateX" | "translateY" | "rotateDeg" | "skewXDeg" | "skewYDeg" => number != 0.0,
            "scaleX" | "scaleY" => number != 1.0,
            _ => false,
        }
    })
}

/// Detect Path or owner-outline paint that requires similarity-only transition wrappers.
pub(super) fn signature_has_painted_canvas_stroke(signature: &Value) -> bool {
    let [scaling_key, outline_key, _width_key, stroke_key] = CANVAS_STROKE_SIGNATURE_KEYS else {
        return false;
    };
    let painted_line = |paint: &Value| {
        paint.get(*scaling_key).and_then(Value::as_str) == Some("canvas")
            && paint
                .get(*stroke_key)
                .and_then(Value::as_str)
                .is_some_and(|color| {
                    !color.trim().is_empty() && !color.trim().eq_ignore_ascii_case("none")
                })
    };
    painted_line(signature)
        || signature.get(*outline_key).is_some_and(|outline| {
            outline
                .get("strokeWidth")
                .and_then(Value::as_f64)
                .unwrap_or(1.0)
                > 0.0
                && painted_line(outline)
        })
}

/// Describe primary text flow inside this source scope, excluding decorative and nested-source text.
pub(super) fn text_flow_signature(root: &IrNode) -> Value {
    fn collect(node: &IrNode, is_root: bool, signatures: &mut Vec<Value>) {
        if !is_root && node.ownership.is_source() {
            return;
        }
        match &node.kind {
            IrNodeKind::Group { children, .. } => {
                for child in children {
                    collect(child, false, signatures);
                }
            }
            IrNodeKind::Text {
                lines,
                source_text,
                display_text,
                ..
            } => {
                if matches!(
                    &node.ownership,
                    crate::ir::ownership::IrNodeOwnership::Decoration { .. }
                ) {
                    return;
                }
                let line_signatures = lines
                    .iter()
                    .map(|line| {
                        json!({
                            "text": line.text,
                            "glyphs": line.glyphs.iter().map(|glyph| json!({
                                "glyphId": glyph.glyph_id,
                                "cluster": glyph.cluster,
                                "fontAlias": glyph.font_alias,
                                "fontWeight": glyph.font_weight,
                                "fontStyle": glyph.font_style,
                                "rotationDeg": glyph.rotation_deg,
                            })).collect::<Vec<_>>(),
                            "fragments": line.fragments.as_ref().map(|fragments| fragments.iter().map(|fragment| json!({
                                "text": fragment.text,
                                "glyphs": fragment.glyphs.iter().map(|glyph| json!({
                                    "glyphId": glyph.glyph_id,
                                    "cluster": glyph.cluster,
                                    "fontAlias": glyph.font_alias,
                                    "fontWeight": glyph.font_weight,
                                    "fontStyle": glyph.font_style,
                                    "rotationDeg": glyph.rotation_deg,
                                })).collect::<Vec<_>>(),
                            })).collect::<Vec<_>>()),
                        })
                    })
                    .collect::<Vec<_>>();
                signatures.push(json!({
                    "nodeId": node.node_id,
                    "sourceText": source_text,
                    "displayText": display_text,
                    "lines": line_signatures,
                }));
            }
            _ => {}
        }
    }

    let mut signatures = Vec::new();
    collect(root, true, &mut signatures);
    Value::Array(signatures)
}
