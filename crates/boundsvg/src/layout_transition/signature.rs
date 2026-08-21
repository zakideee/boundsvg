use std::collections::BTreeSet;

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
pub(super) const CANVAS_STROKE_SIGNATURE_KEYS: &[&str] = &[
    "strokeScaling",
    "borderWidth",
    "borderColor",
    "strokeWidth",
    "stroke",
];

pub(super) struct SemanticSourceSignatures {
    pub(super) content: Value,
    pub(super) paint: Value,
    pub(super) animation: Value,
}

pub(super) fn semantic_source_signatures(
    raw_node: &Value,
    node_id: &str,
) -> Result<SemanticSourceSignatures, CompatibilityMismatch> {
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
            "translateX" | "translateY" | "rotateDeg" => number != 0.0,
            "scaleX" | "scaleY" => number != 1.0,
            _ => false,
        }
    })
}

pub(super) fn signature_has_painted_canvas_stroke(signature: &Value) -> bool {
    let Some(paint) = signature.as_object() else {
        return false;
    };
    let [
        stroke_scaling,
        border_width,
        border_color,
        _stroke_width,
        stroke,
    ] = CANVAS_STROKE_SIGNATURE_KEYS
    else {
        return false;
    };
    if paint.get(*stroke_scaling).and_then(Value::as_str) != Some("canvas") {
        return false;
    }
    let border_is_painted = paint
        .get(*border_width)
        .and_then(Value::as_f64)
        .is_some_and(|width| width > 0.0)
        && paint
            .get(*border_color)
            .and_then(Value::as_str)
            .is_some_and(|color| color != "none");
    // Keep this in lockstep with scene::resolve_canvas_stroke: Path paint is
    // selected by its stroke color, while every finite authored width
    // (including zero) still enters canvas-stroke transform validation.
    let path_is_painted = paint
        .get(*stroke)
        .and_then(Value::as_str)
        .is_some_and(|color| {
            let normalized_color = color.trim();
            !normalized_color.is_empty() && !normalized_color.eq_ignore_ascii_case("none")
        });
    border_is_painted || path_is_painted
}

pub(super) fn text_flow_signature(
    root: &IrNode,
    owner_id: &str,
    semantic_ids: &BTreeSet<String>,
) -> Value {
    fn collect(
        node: &IrNode,
        owner_id: &str,
        semantic_ids: &BTreeSet<String>,
        signatures: &mut Vec<Value>,
    ) {
        match &node.kind {
            IrNodeKind::Group { children, .. } => {
                if node.node_id != owner_id && semantic_ids.contains(&node.node_id) {
                    return;
                }
                for child in children {
                    collect(child, owner_id, semantic_ids, signatures);
                }
            }
            IrNodeKind::Text {
                lines,
                source_text,
                display_text,
                ..
            } => {
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
    collect(root, owner_id, semantic_ids, &mut signatures);
    Value::Array(signatures)
}
