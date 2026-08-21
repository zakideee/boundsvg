use serde_json::json;
use std::collections::BTreeMap;

use super::*;
use crate::font::{FontRegistry, FontStyle};
use crate::ir::types::{
    AnimationKeyframe, AnimationSpec, BBox, ErrorSeverity, IrNode, IrNodeKind, PipelineStage,
    RenderWarning,
};

fn group(node_id: &str, children: Vec<IrNode>) -> IrNode {
    IrNode {
        node_id: node_id.to_string(),
        bbox: BBox {
            x: 0.0,
            y: 0.0,
            w: 100.0,
            h: 100.0,
        },
        kind: IrNodeKind::Group {
            children,
            clip_path: None,
            clip_border_radius: None,
            opacity: None,
            box_shadow: None,
            meta: None,
            transform: None,
            animation: None,
            on: None,
        },
    }
}

fn group_with_bbox(node_id: &str, bbox: BBox, children: Vec<IrNode>) -> IrNode {
    let mut node = group(node_id, children);
    node.bbox = bbox;
    node
}

fn image_with_bbox(node_id: &str, bbox: BBox) -> IrNode {
    IrNode {
        node_id: node_id.to_string(),
        bbox,
        kind: IrNodeKind::Image {
            src: "data:image/png;base64,AA==".to_string(),
            preserve_aspect_ratio: "xMidYMid meet".to_string(),
            on: None,
        },
    }
}

fn ir(root: IrNode) -> Ir {
    ir_with_size(root, 100.0, 100.0)
}

fn ir_with_size(root: IrNode, width: f64, height: f64) -> Ir {
    Ir {
        root,
        draw_order: Vec::new(),
        width,
        height,
        debug: None,
        warnings: Vec::new(),
    }
}

fn two_node_transport(child_kind: &str) -> String {
    json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": [{
                "nodeId": "container",
                "nodeType": child_kind,
                "authoredId": true,
                "children": []
            }]
        }
    })
    .to_string()
}

fn two_node_transport_with_visual(child_kind: &str, visual: &Value) -> String {
    json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": [{
                "nodeId": "container",
                "nodeType": child_kind,
                "authoredId": true,
                "children": [],
                "visual": visual
            }]
        }
    })
    .to_string()
}

fn text_transport(width: u32) -> String {
    json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "style": { "width": 200, "height": 120 },
            "children": [{
                "nodeId": "copy",
                "nodeType": "text",
                "authoredId": true,
                "style": { "width": width },
                "children": [],
                "text": {
                    "content": "one two three four five",
                    "fontSizePx": 16,
                    "lineHeightPx": 24,
                    "fontFamily": ["NotoSansJP"],
                    "fontWeight": 400,
                    "fontStyle": "normal",
                    "wrap": "word"
                },
                "visual": { "color": "#000000" }
            }]
        },
        "fonts": []
    })
    .to_string()
}

fn warning(code: &str) -> RenderWarning {
    RenderWarning {
        severity: ErrorSeverity::Recoverable,
        code: code.to_string(),
        message: format!("warning {code}"),
        stage: PipelineStage::Ir,
        node_id: Some("scene".to_string()),
        fallback: Some("none".to_string()),
    }
}

fn transition_plan() -> LayoutTransitionPlanInput {
    serde_json::from_value(json!({
        "checkpoints": [
            { "timeMs": 0, "stateIndex": 0 },
            { "timeMs": 300, "stateIndex": 1 },
            { "timeMs": 700, "stateIndex": 1 },
            { "timeMs": 1000, "stateIndex": 0 }
        ],
        "easing": "ease-in-out"
    }))
    .expect("test transition plan should deserialize")
}

fn compiled_state(transport_json: &str, compiled_ir: Ir) -> CompiledTransitionState {
    let raw_input: Value =
        serde_json::from_str(transport_json).expect("raw transport should deserialize");
    let input: LayoutInput =
        serde_json::from_value(raw_input.clone()).expect("layout transport should deserialize");
    CompiledTransitionState::from_layout_input(&input, &raw_input, compiled_ir)
        .expect("compiled transition state should build")
}

fn real_compile_registry() -> FontRegistry {
    let font_data = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
    ))
    .expect("fixture font should exist");
    let decoded = crate::font::decode::decode_font(font_data).expect("font should decode");
    let mut registry = FontRegistry::new();
    registry
        .register(decoded, "NotoSansJP".to_string(), 400, FontStyle::Normal)
        .expect("font should register");
    registry
}

fn find_ir_node<'a>(node: &'a IrNode, node_id: &str) -> Option<&'a IrNode> {
    if node.node_id == node_id {
        return Some(node);
    }
    let IrNodeKind::Group { children, .. } = &node.kind else {
        return None;
    };
    children
        .iter()
        .find_map(|child| find_ir_node(child, node_id))
}

fn apply_affine_to_bbox(affine: AxisAlignedAffine, bbox: BBox) -> BBox {
    BBox {
        x: affine.scale_x * bbox.x + affine.translate_x,
        y: affine.scale_y * bbox.y + affine.translate_y,
        w: affine.scale_x * bbox.w,
        h: affine.scale_y * bbox.h,
    }
}

#[test]
fn bbox_world_delta_maps_reference_bbox_to_target_bbox() {
    let reference_bbox = BBox::new(10.0, 20.0, 40.0, 20.0);
    let target_bbox = BBox::new(30.0, 50.0, 80.0, 60.0);

    let delta = bbox_world_delta(reference_bbox, target_bbox, "message")
        .expect("finite non-zero bboxes should produce a world delta");

    assert_eq!(
        delta,
        AxisAlignedAffine {
            scale_x: 2.0,
            scale_y: 3.0,
            translate_x: 10.0,
            translate_y: -10.0,
        }
    );
    assert_eq!(apply_affine_to_bbox(delta, reference_bbox), target_bbox);

    let animation_transform = delta
        .to_animation_transform(reference_bbox, "message")
        .expect("world affine should decompose into existing animation channels");
    assert_eq!(animation_transform.translate_x, Some(40.0));
    assert_eq!(animation_transform.translate_y, Some(50.0));
    assert_eq!(animation_transform.scale_x, Some(2.0));
    assert_eq!(animation_transform.scale_y, Some(3.0));
    assert_eq!(animation_transform.rotate_deg, None);
}

#[test]
fn authored_transform_signature_distinguishes_identity_and_non_identity_channels() {
    for identity in [
        json!({ "transform": {} }),
        json!({ "transform": { "translateX": 0, "translateY": 0 } }),
        json!({ "animation": { "keyframes": [{ "transform": { "scaleX": 1 } }] } }),
        json!({ "animation": { "keyframes": [{ "opacity": 0 }, { "opacity": 1 }] } }),
    ] {
        assert!(!signature_has_non_identity_transform(&identity));
    }
    for non_identity in [
        json!({ "transform": { "translateX": 1 } }),
        json!({ "transform": { "scaleY": 2 } }),
        json!({ "transform": { "translateX": 1.0e-13 } }),
        json!({ "animation": { "keyframes": [{ "transform": { "rotateDeg": 15 } }] } }),
    ] {
        assert!(signature_has_non_identity_transform(&non_identity));
    }
}

#[test]
fn near_identity_generated_affine_is_not_omitted() {
    assert!(
        !AxisAlignedAffine {
            scale_x: 1.0 + 5.0e-13,
            scale_y: 1.0,
            translate_x: 0.0,
            translate_y: 0.0,
        }
        .is_identity()
    );
    assert!(
        !AxisAlignedAffine {
            scale_x: 1.0,
            scale_y: 1.0,
            translate_x: 5.0e-13,
            translate_y: 0.0,
        }
        .is_identity()
    );
}

#[test]
fn canvas_stroke_signature_requires_an_actually_painted_stroke() {
    assert!(signature_has_painted_canvas_stroke(&json!({
        "strokeScaling": "canvas",
        "borderWidth": 2,
        "borderColor": "#ffffff"
    })));
    assert!(signature_has_painted_canvas_stroke(&json!({
        "strokeScaling": "canvas",
        "strokeWidth": 2,
        "stroke": "#ffffff"
    })));
    assert!(signature_has_painted_canvas_stroke(&json!({
        "strokeScaling": "canvas",
        "stroke": "#ffffff"
    })));
    assert!(!signature_has_painted_canvas_stroke(&json!({
        "strokeScaling": "canvas",
        "borderWidth": 0,
        "borderColor": "#ffffff"
    })));
    assert!(signature_has_painted_canvas_stroke(&json!({
        "strokeScaling": "canvas",
        "strokeWidth": 0,
        "stroke": "#ffffff"
    })));
    assert!(!signature_has_painted_canvas_stroke(&json!({
        "strokeScaling": "transform",
        "borderWidth": 2,
        "borderColor": "#ffffff"
    })));
}

#[test]
fn canvas_stroke_rejects_non_uniform_generated_wrapper_ancestor_before_emit() {
    let transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": [{
                "nodeId": "parent",
                "nodeType": "box",
                "authoredId": true,
                "children": [{
                    "nodeId": "stroke-child",
                    "nodeType": "box",
                    "authoredId": true,
                    "visual": {
                        "strokeScaling": "canvas",
                        "borderWidth": 2,
                        "borderColor": "#ffffff"
                    },
                    "children": []
                }]
            }]
        }
    })
    .to_string();
    let reference = compiled_state(
        &transport,
        ir_with_size(
            group_with_bbox(
                "scene",
                BBox::new(0.0, 0.0, 240.0, 240.0),
                vec![group_with_bbox(
                    "parent",
                    BBox::new(20.0, 20.0, 80.0, 80.0),
                    vec![group_with_bbox(
                        "stroke-child",
                        BBox::new(30.0, 30.0, 40.0, 20.0),
                        Vec::new(),
                    )],
                )],
            ),
            240.0,
            240.0,
        ),
    );
    let target = compiled_state(
        &transport,
        ir_with_size(
            group_with_bbox(
                "scene",
                BBox::new(0.0, 0.0, 240.0, 240.0),
                vec![group_with_bbox(
                    "parent",
                    BBox::new(20.0, 20.0, 160.0, 120.0),
                    vec![group_with_bbox(
                        "stroke-child",
                        BBox::new(30.0, 30.0, 80.0, 40.0),
                        Vec::new(),
                    )],
                )],
            ),
            240.0,
            240.0,
        ),
    );

    let mismatch = reference
        .into_transition_ir(target, &transition_plan())
        .expect_err("a non-uniform generated ancestor must fail before the emit path");
    assert_eq!(mismatch.category, CompatibilityCategory::Stroke);
    assert_eq!(mismatch.node_id, "stroke-child");
    assert_eq!(
        mismatch.expected,
        "uniform positive generated local scale on every wrapper ancestor for canvas-stable stroke"
    );
    assert_eq!(
        mismatch.observed,
        "non-uniform generated local scale x=2, y=1.5 at source node \"parent\""
    );
}

#[test]
fn canvas_stroke_matches_emit_path_width_handling_during_compile_preflight() {
    for stroke_width in [None, Some(0)] {
        let mut visual = json!({
            "strokeScaling": "canvas",
            "stroke": "#ffffff"
        });
        if let Some(width) = stroke_width {
            visual["strokeWidth"] = json!(width);
        }
        let transport = json!({
            "root": {
                "nodeId": "scene",
                "nodeType": "canvas",
                "authoredId": true,
                "children": [{
                    "nodeId": "stroke-path",
                    "nodeType": "path",
                    "authoredId": true,
                    "visual": visual,
                    "children": []
                }]
            }
        })
        .to_string();
        let reference = compiled_state(
            &transport,
            ir_with_size(
                group_with_bbox(
                    "scene",
                    BBox::new(0.0, 0.0, 200.0, 100.0),
                    vec![group_with_bbox(
                        "stroke-path",
                        BBox::new(0.0, 0.0, 40.0, 20.0),
                        Vec::new(),
                    )],
                ),
                200.0,
                100.0,
            ),
        );
        let target = compiled_state(
            &transport,
            ir_with_size(
                group_with_bbox(
                    "scene",
                    BBox::new(0.0, 0.0, 200.0, 100.0),
                    vec![group_with_bbox(
                        "stroke-path",
                        BBox::new(0.0, 0.0, 80.0, 20.0),
                        Vec::new(),
                    )],
                ),
                200.0,
                100.0,
            ),
        );

        let mismatch = reference
            .into_transition_ir(target, &transition_plan())
            .expect_err("every Path width handled by emit must be rejected before emit");
        assert_eq!(mismatch.category, CompatibilityCategory::Stroke);
        assert_eq!(mismatch.node_id, "stroke-path");
    }
}

#[test]
fn inverse_and_decomposition_failures_are_structured_bbox_mismatches() {
    let inverse_mismatch = AxisAlignedAffine {
        scale_x: 0.0,
        ..AxisAlignedAffine::identity()
    }
    .inverse("collapsed")
    .expect_err("zero generated scale must not be invertible");
    assert_eq!(inverse_mismatch.category, CompatibilityCategory::Bbox);
    assert_eq!(inverse_mismatch.node_id, "collapsed");
    assert_eq!(
        inverse_mismatch.expected,
        "an invertible finite generated parent transform"
    );

    let decomposition_mismatch = AxisAlignedAffine {
        translate_x: f64::INFINITY,
        ..AxisAlignedAffine::identity()
    }
    .to_animation_transform(BBox::new(0.0, 0.0, 10.0, 10.0), "overflow")
    .expect_err("non-finite animation channel must not be emitted");
    assert_eq!(decomposition_mismatch.category, CompatibilityCategory::Bbox);
    assert_eq!(decomposition_mismatch.node_id, "overflow");
    assert_eq!(
        decomposition_mismatch.expected,
        "finite translate/scale animation channels"
    );
}

#[test]
fn preorder_local_residual_cancels_generated_parent_world_delta() {
    let parent_reference = BBox::new(0.0, 0.0, 100.0, 100.0);
    let parent_target = BBox::new(20.0, 20.0, 200.0, 200.0);
    let child_reference = BBox::new(10.0, 10.0, 20.0, 20.0);
    let child_target = BBox::new(50.0, 50.0, 60.0, 40.0);

    // Stable preorder makes the generated parent world matrix available
    // before calculating the child wrapper's local residual.
    let parent_world = bbox_world_delta(parent_reference, parent_target, "parent")
        .expect("parent delta should be representable");
    let child_world = bbox_world_delta(child_reference, child_target, "child")
        .expect("child delta should be representable");
    let child_local = parent_world
        .inverse("child")
        .expect("parent world delta should be invertible")
        .multiply(child_world);

    assert_eq!(
        child_local,
        AxisAlignedAffine {
            scale_x: 1.5,
            scale_y: 1.0,
            translate_x: 0.0,
            translate_y: 5.0,
        }
    );
    assert_eq!(parent_world.multiply(child_local), child_world);
    assert_eq!(
        apply_affine_to_bbox(parent_world.multiply(child_local), child_reference),
        child_target
    );

    // Applying the raw child world delta inside the parent would double
    // both scale and translation, which is the regression this guards.
    assert_ne!(
        apply_affine_to_bbox(parent_world.multiply(child_world), child_reference),
        child_target
    );
}

#[test]
fn transition_ir_injects_only_required_wrapper_and_preserves_authored_inner_node() {
    let transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": [{
                "nodeId": "parent",
                "nodeType": "box",
                "authoredId": true,
                "children": [{
                    "nodeId": "child",
                    "nodeType": "box",
                    "authoredId": true,
                    "children": []
                }]
            }]
        }
    })
    .to_string();
    let parent_animation = AnimationSpec {
        keyframes: vec![
            AnimationKeyframe {
                at: 0.0,
                opacity: Some(0.25),
                transform: None,
            },
            AnimationKeyframe {
                at: 1.0,
                opacity: Some(1.0),
                transform: None,
            },
        ],
        duration_ms: 200.0,
        delay_ms: None,
        easing: None,
        iterations: None,
        fill: Some("both".to_string()),
    };
    let mut authored_parent = group_with_bbox(
        "parent",
        BBox::new(0.0, 0.0, 100.0, 100.0),
        vec![
            image_with_bbox("parent", BBox::new(0.0, 0.0, 100.0, 100.0)),
            group_with_bbox("child", BBox::new(10.0, 10.0, 20.0, 20.0), Vec::new()),
        ],
    );
    let IrNodeKind::Group {
        animation, meta, ..
    } = &mut authored_parent.kind
    else {
        panic!("test helper always builds Groups");
    };
    *animation = Some(parent_animation);
    *meta = Some(BTreeMap::from([(
        "authored".to_string(),
        "preserved".to_string(),
    )]));
    let authored_parent_snapshot =
        serde_json::to_value(&authored_parent).expect("authored node should serialize");
    let mut reference_ir = ir_with_size(
        group_with_bbox(
            "scene",
            BBox::new(0.0, 0.0, 480.0, 480.0),
            vec![authored_parent],
        ),
        480.0,
        480.0,
    );
    reference_ir.draw_order = vec!["parent".to_string()];
    let mut target_ir = ir_with_size(
        group_with_bbox(
            "scene",
            BBox::new(0.0, 0.0, 480.0, 480.0),
            vec![group_with_bbox(
                "parent",
                BBox::new(20.0, 20.0, 200.0, 200.0),
                vec![
                    image_with_bbox("parent", BBox::new(20.0, 20.0, 200.0, 200.0)),
                    group_with_bbox("child", BBox::new(40.0, 40.0, 40.0, 40.0), Vec::new()),
                ],
            )],
        ),
        480.0,
        480.0,
    );
    target_ir.draw_order = vec!["parent".to_string()];
    let reference = compiled_state(&transport, reference_ir);
    let target = compiled_state(&transport, target_ir);

    let transition_ir = reference
        .into_transition_ir(target, &transition_plan())
        .expect("compatible geometry should compile to generated wrappers");

    assert_eq!(transition_ir.draw_order, vec!["parent"]);
    let wrapper_id = format!("{GENERATED_WRAPPER_ID_PREFIX}1:parent");
    let wrapper = find_ir_node(&transition_ir.root, &wrapper_id)
        .expect("moving parent should have a deterministic generated wrapper");
    let IrNodeKind::Group {
        children,
        meta,
        animation,
        transform,
        on,
        ..
    } = &wrapper.kind
    else {
        panic!("generated wrapper must be an IR Group");
    };
    assert_eq!(children.len(), 1);
    assert_eq!(
        serde_json::to_value(&children[0]).expect("inner node should serialize"),
        authored_parent_snapshot
    );
    assert_eq!(
        meta.as_ref()
            .and_then(|value| value.get(GENERATED_PROVENANCE_KEY))
            .map(String::as_str),
        Some(GENERATED_PROVENANCE_VALUE)
    );
    assert_eq!(
        meta.as_ref()
            .and_then(|value| value.get(GENERATED_SOURCE_NODE_ID_KEY))
            .map(String::as_str),
        Some("parent")
    );
    assert!(transform.is_none());
    assert!(on.is_none());

    let generated_animation = animation
        .as_ref()
        .expect("wrapper should carry exactly one generated animation");
    assert_eq!(generated_animation.duration_ms, 1000.0);
    assert_eq!(generated_animation.fill.as_deref(), Some("both"));
    assert_eq!(
        generated_animation
            .keyframes
            .iter()
            .map(|keyframe| keyframe.at)
            .collect::<Vec<_>>(),
        vec![0.0, 0.3, 0.7, 1.0]
    );
    assert!(
        generated_animation
            .keyframes
            .iter()
            .all(|keyframe| keyframe.opacity.is_none())
    );
    let transforms = generated_animation
        .keyframes
        .iter()
        .map(|keyframe| {
            keyframe
                .transform
                .as_ref()
                .expect("every generated keyframe must declare transform targets")
        })
        .collect::<Vec<_>>();
    assert_eq!(transforms[0].translate_x, Some(0.0));
    assert_eq!(transforms[0].translate_y, Some(0.0));
    assert_eq!(transforms[0].scale_x, Some(1.0));
    assert_eq!(transforms[0].scale_y, Some(1.0));
    assert_eq!(transforms[1].translate_x, Some(70.0));
    assert_eq!(transforms[1].translate_y, Some(70.0));
    assert_eq!(transforms[1].scale_x, Some(2.0));
    assert_eq!(transforms[1].scale_y, Some(2.0));
    assert_eq!(transforms[2], transforms[1]);
    assert_eq!(transforms[3], transforms[0]);

    assert!(find_ir_node(&transition_ir.root, "child").is_some());
    assert!(
        find_ir_node(
            &transition_ir.root,
            &format!("{GENERATED_WRAPPER_ID_PREFIX}2:child")
        )
        .is_none(),
        "child inherits the complete world delta from its parent"
    );
}

#[test]
fn reserved_wrapper_namespace_collision_is_rejected_before_injection() {
    let reserved_id = format!("{GENERATED_WRAPPER_ID_PREFIX}authored");
    let transport = json!({
        "root": {
            "nodeId": reserved_id,
            "nodeType": "canvas",
            "authoredId": true,
            "children": []
        }
    })
    .to_string();
    let reference = compiled_state(
        &transport,
        ir(group(
            &format!("{GENERATED_WRAPPER_ID_PREFIX}authored"),
            Vec::new(),
        )),
    );
    let target = compiled_state(
        &transport,
        ir(group(
            &format!("{GENERATED_WRAPPER_ID_PREFIX}authored"),
            Vec::new(),
        )),
    );

    let mismatch = reference
        .into_transition_ir(target, &transition_plan())
        .expect_err("reserved wrapper namespace must reject authored collisions");
    assert_eq!(mismatch.category, CompatibilityCategory::Id);
    assert_eq!(
        mismatch.node_id,
        format!("{GENERATED_WRAPPER_ID_PREFIX}authored")
    );
    assert_eq!(
        mismatch.expected,
        "authored and internal IR IDs outside the reserved transition wrapper namespace"
    );
}

#[test]
fn real_compile_ir_satisfies_semantic_group_correspondence() {
    let transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "style": {
                "flexDirection": "column",
                "alignItems": "stretch",
                "justifyContent": "flex-start",
                "width": 240,
                "height": 160
            },
            "children": [{
                "nodeId": "panel",
                "nodeType": "box",
                "authoredId": true,
                "style": {
                    "flexDirection": "column",
                    "alignItems": "stretch",
                    "justifyContent": "flex-start",
                    "width": 200,
                    "height": 120
                },
                "children": [{
                    "nodeId": "copy",
                    "nodeType": "text",
                    "authoredId": true,
                    "style": {
                        "flexDirection": "column",
                        "alignItems": "stretch",
                        "justifyContent": "flex-start",
                        "width": 180
                    },
                    "children": [],
                    "text": {
                        "content": "A chip Z",
                        "spans": [{
                            "text": "A chip Z",
                            "fontFamily": ["NotoSansJP"],
                            "fontWeight": 400,
                            "fontStyle": "normal",
                            "fontSizePx": 16,
                            "letterSpacingPx": 0,
                            "textOrientation": "mixed",
                            "color": "#000000"
                        }],
                        "richText": [
                            { "kind": "text", "text": "A " },
                            {
                                "kind": "decoratedSpan",
                                "style": {
                                    "fontFamily": ["NotoSansJP"],
                                    "fontWeight": 400,
                                    "fontStyle": "normal",
                                    "fontSizePx": 16,
                                    "lineHeightPx": 24,
                                    "letterSpacingPx": 0,
                                    "color": "#000000",
                                    "textOrientation": "mixed"
                                },
                                "children": [{ "kind": "text", "text": "chip" }],
                                "paddingInline": [2, 2],
                                "background": "#ffeeaa",
                                "spanKey": "copy:dspan:0"
                            },
                            { "kind": "text", "text": " Z" }
                        ],
                        "fontSizePx": 16,
                        "lineHeightPx": 24,
                        "fontFamily": ["NotoSansJP"],
                        "fontWeight": 400,
                        "fontStyle": "normal",
                        "wrap": "char",
                        "textOrientation": "mixed"
                    },
                    "visual": {
                        "color": "#000000",
                        "inlineDecorationAnimations": {
                            "copy:dspan:0": {
                                "keyframes": [
                                    { "at": 0, "opacity": 0 },
                                    { "at": 1, "opacity": 1 }
                                ],
                                "durationMs": 100
                            }
                        }
                    }
                }, {
                    "nodeId": "hidden",
                    "nodeType": "box",
                    "authoredId": true,
                    "style": {
                        "flexDirection": "column",
                        "alignItems": "stretch",
                        "justifyContent": "flex-start",
                        "width": 20,
                        "height": 20,
                        "display": "none"
                    },
                    "children": [],
                    "visual": { "background": "#ff0000" }
                }],
                "visual": {
                    "background": "#112233",
                    "borderWidth": 2,
                    "borderColor": "#445566"
                }
            }],
            "visual": { "background": "#ffffff" }
        },
        "fonts": []
    })
    .to_string();
    let raw_input: Value =
        serde_json::from_str(&transport).expect("raw transport should deserialize");
    let input: LayoutInput =
        serde_json::from_value(raw_input.clone()).expect("layout transport should deserialize");
    let options = crate::RenderSvgOptionsInput {
        sample_animation: Some(false),
        ..crate::RenderSvgOptionsInput::default()
    };
    let registry = real_compile_registry();
    let compiled_ir = crate::compile_layout_input_to_ir(&input, &options, &registry)
        .expect("real layout/IR compile should succeed");
    let state = CompiledTransitionState::from_layout_input(&input, &raw_input, compiled_ir)
        .expect("real compile IR should match the semantic manifest");

    assert_eq!(state.semantic_node_count(), 4);
    let hidden =
        find_ir_node(&state.ir().root, "hidden").expect("hidden semantic Group should remain");
    assert_eq!(hidden.bbox.w, 0.0);
    assert_eq!(hidden.bbox.h, 0.0);
    assert!(matches!(hidden.kind, IrNodeKind::Group { .. }));
    let inline_group = find_ir_node(&state.ir().root, "copy:ibox0")
        .expect("animated inline paint Group should exist");
    assert!(matches!(inline_group.kind, IrNodeKind::Group { .. }));
}

#[test]
fn kind_mismatch_survives_identical_public_ir() {
    let shared_ir = ir(group("scene", vec![group("container", Vec::new())]));
    let reference = compiled_state(&two_node_transport("box"), shared_ir.clone());
    let target = compiled_state(&two_node_transport("flex"), shared_ir);

    let mismatch = reference
        .validate_compatibility(&target)
        .expect_err("kind mismatch must survive the IR boundary");
    assert_eq!(mismatch.category, CompatibilityCategory::Kind);
    assert_eq!(mismatch.node_id, "container");
    assert_eq!(mismatch.expected, "box");
    assert_eq!(mismatch.observed, "flex");
}

#[test]
fn generated_id_is_rejected_even_when_its_ir_string_matches() {
    let transport = json!({
        "root": {
            "nodeId": "auto:0",
            "nodeType": "canvas",
            "authoredId": false,
            "children": []
        }
    })
    .to_string();
    let raw_input: Value =
        serde_json::from_str(&transport).expect("raw transport should deserialize");
    let input: LayoutInput =
        serde_json::from_value(raw_input.clone()).expect("layout transport should deserialize");
    let mismatch = CompiledTransitionState::from_layout_input(
        &input,
        &raw_input,
        ir(group("auto:0", Vec::new())),
    )
    .expect_err("generated IDs must fail transition compatibility");
    assert_eq!(mismatch.category, CompatibilityCategory::Id);
    assert_eq!(mismatch.node_id, "auto:0");
    assert_eq!(mismatch.expected, "authored explicit ID");
    assert_eq!(mismatch.observed, "generated ID");
}

#[test]
fn manifest_stays_private_and_ignores_internal_paint_groups() {
    let transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": []
        }
    })
    .to_string();
    let mut compiled_ir = ir(group("scene", vec![group("inline-fragment", Vec::new())]));
    compiled_ir.warnings.push(RenderWarning {
        severity: ErrorSeverity::Recoverable,
        code: "SPIKE_WARNING".to_string(),
        message: "warning remains owned by the compiled IR".to_string(),
        stage: PipelineStage::Ir,
        node_id: Some("scene".to_string()),
        fallback: Some("none".to_string()),
    });
    let state = compiled_state(&transport, compiled_ir);

    assert_eq!(state.semantic_node_count(), 1);
    let serialized_ir = serde_json::to_string(state.ir()).expect("IR should serialize");
    assert!(!serialized_ir.contains("semanticManifest"));
    assert!(!serialized_ir.contains("authoredId"));
    assert!(serialized_ir.contains("inline-fragment"));
    assert!(serialized_ir.contains("SPIKE_WARNING"));
}

#[test]
fn sibling_order_mismatch_is_reported_in_reference_preorder() {
    let reference_transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": [
                { "nodeId": "first", "nodeType": "box", "authoredId": true },
                { "nodeId": "second", "nodeType": "box", "authoredId": true }
            ]
        }
    })
    .to_string();
    let target_transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": [
                { "nodeId": "second", "nodeType": "box", "authoredId": true },
                { "nodeId": "first", "nodeType": "box", "authoredId": true }
            ]
        }
    })
    .to_string();
    let shared_ir = ir(group(
        "scene",
        vec![group("first", Vec::new()), group("second", Vec::new())],
    ));
    let reference = compiled_state(&reference_transport, shared_ir.clone());
    let target = compiled_state(&target_transport, shared_ir);

    let mismatch = reference
        .validate_compatibility(&target)
        .expect_err("sibling order mismatch must fail");
    assert_eq!(mismatch.category, CompatibilityCategory::Order);
    assert_eq!(mismatch.node_id, "first");
    assert_eq!(mismatch.expected, "0");
    assert_eq!(mismatch.observed, "1");
}

#[test]
fn effective_canvas_mismatch_precedes_semantic_comparison() {
    let transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true
        }
    })
    .to_string();
    let reference = compiled_state(
        &transport,
        ir_with_size(group("scene", Vec::new()), 480.0, 480.0),
    );
    let target = compiled_state(
        &transport,
        ir_with_size(group("scene", Vec::new()), 480.0, 640.0),
    );

    let mismatch = reference
        .validate_compatibility(&target)
        .expect_err("different effective canvas dimensions must fail");
    assert_eq!(mismatch.category, CompatibilityCategory::Canvas);
    assert_eq!(mismatch.node_id, "scene");
    assert_eq!(mismatch.expected, "480x480");
    assert_eq!(mismatch.observed, "480x640");
}

#[test]
fn parent_mismatch_is_reported_for_the_moved_authored_node() {
    let reference_transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": [{
                "nodeId": "parent-a",
                "nodeType": "box",
                "authoredId": true,
                "children": [{
                    "nodeId": "moved",
                    "nodeType": "box",
                    "authoredId": true
                }]
            }, {
                "nodeId": "parent-b",
                "nodeType": "box",
                "authoredId": true
            }]
        }
    })
    .to_string();
    let target_transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": [{
                "nodeId": "parent-a",
                "nodeType": "box",
                "authoredId": true
            }, {
                "nodeId": "parent-b",
                "nodeType": "box",
                "authoredId": true,
                "children": [{
                    "nodeId": "moved",
                    "nodeType": "box",
                    "authoredId": true
                }]
            }]
        }
    })
    .to_string();
    let shared_ir = ir(group(
        "scene",
        vec![
            group("parent-a", vec![group("moved", Vec::new())]),
            group("parent-b", Vec::new()),
        ],
    ));
    let target_ir = ir(group(
        "scene",
        vec![
            group("parent-a", Vec::new()),
            group("parent-b", vec![group("moved", Vec::new())]),
        ],
    ));
    let reference = compiled_state(&reference_transport, shared_ir);
    let target = compiled_state(&target_transport, target_ir);

    let mismatch = reference
        .validate_compatibility(&target)
        .expect_err("moving an authored node to a different parent must fail");
    assert_eq!(mismatch.category, CompatibilityCategory::Parent);
    assert_eq!(mismatch.node_id, "moved");
    assert_eq!(mismatch.expected, "parent \"parent-a\"");
    assert_eq!(mismatch.observed, "parent \"parent-b\"");
}

#[test]
fn parent_descriptions_do_not_expose_rust_option_debug_syntax() {
    assert_eq!(describe_parent(Some("parent-a")), "parent \"parent-a\"");
    assert_eq!(describe_parent(None), "root (no parent)");
}

#[test]
fn target_only_authored_id_is_rejected_by_the_second_id_set_pass() {
    let reference_transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true
        }
    })
    .to_string();
    let target_transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": [{
                "nodeId": "target-only",
                "nodeType": "box",
                "authoredId": true
            }]
        }
    })
    .to_string();
    let reference = compiled_state(&reference_transport, ir(group("scene", Vec::new())));
    let target = compiled_state(
        &target_transport,
        ir(group("scene", vec![group("target-only", Vec::new())])),
    );

    let mismatch = reference
        .validate_compatibility(&target)
        .expect_err("an authored ID present only in the target must fail");
    assert_eq!(mismatch.category, CompatibilityCategory::Id);
    assert_eq!(mismatch.node_id, "target-only");
    assert_eq!(mismatch.expected, "same authored ID set as reference");
    assert_eq!(mismatch.observed, "present only in target state");
}

#[test]
fn reference_authored_id_missing_from_target_is_rejected() {
    let reference_transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": [{
                "nodeId": "reference-only",
                "nodeType": "box",
                "authoredId": true
            }]
        }
    })
    .to_string();
    let target_transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true
        }
    })
    .to_string();
    let reference = compiled_state(
        &reference_transport,
        ir(group("scene", vec![group("reference-only", Vec::new())])),
    );
    let target = compiled_state(&target_transport, ir(group("scene", Vec::new())));

    let mismatch = reference
        .validate_compatibility(&target)
        .expect_err("an authored ID missing from the target must fail");
    assert_eq!(mismatch.category, CompatibilityCategory::Id);
    assert_eq!(mismatch.node_id, "reference-only");
    assert_eq!(mismatch.expected, "same authored ID set as reference");
    assert_eq!(mismatch.observed, "missing from target state");
}

#[test]
fn duplicate_authored_id_is_rejected_while_building_the_manifest() {
    let transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": [{
                "nodeId": "duplicate",
                "nodeType": "box",
                "authoredId": true
            }, {
                "nodeId": "duplicate",
                "nodeType": "box",
                "authoredId": true
            }]
        }
    })
    .to_string();
    let raw_input: Value =
        serde_json::from_str(&transport).expect("raw transport should deserialize");
    let input: LayoutInput =
        serde_json::from_value(raw_input.clone()).expect("layout transport should deserialize");
    let mismatch = CompiledTransitionState::from_layout_input(
        &input,
        &raw_input,
        ir(group(
            "scene",
            vec![
                group("duplicate", Vec::new()),
                group("duplicate", Vec::new()),
            ],
        )),
    )
    .expect_err("duplicate authored IDs must fail before Group matching");

    assert_eq!(mismatch.category, CompatibilityCategory::Id);
    assert_eq!(mismatch.node_id, "duplicate");
    assert_eq!(mismatch.expected, "unique authored ID");
    assert_eq!(mismatch.observed, "duplicate authored ID");
}

#[test]
fn authored_id_colliding_with_an_internal_group_is_rejected() {
    let transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": [{
                "nodeId": "scene:paint",
                "nodeType": "box",
                "authoredId": true
            }]
        }
    })
    .to_string();
    let raw_input: Value =
        serde_json::from_str(&transport).expect("raw transport should deserialize");
    let input: LayoutInput =
        serde_json::from_value(raw_input.clone()).expect("layout transport should deserialize");
    let mismatch = CompiledTransitionState::from_layout_input(
        &input,
        &raw_input,
        ir(group(
            "scene",
            vec![
                group("scene:paint", Vec::new()),
                group("scene:paint", Vec::new()),
            ],
        )),
    )
    .expect_err("semantic/internal Group ID collisions must not be ambiguous");

    assert_eq!(mismatch.category, CompatibilityCategory::Id);
    assert_eq!(mismatch.node_id, "scene:paint");
    assert_eq!(mismatch.expected, "exactly one semantic IR Group");
    assert_eq!(mismatch.observed, "2 matching IR Groups");
}

#[test]
fn transition_transport_requires_the_provenance_bit() {
    let transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "children": []
        }
    })
    .to_string();
    assert!(serde_json::from_str::<LayoutInput>(&transport).is_err());
}

#[test]
fn transition_signature_rejects_unknown_transport_top_level_keys() {
    let transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "style": { "width": 100, "height": 100 },
            "children": [],
            "futureLayoutField": { "enabled": true }
        },
        "fonts": []
    })
    .to_string();
    let raw_input: Value = serde_json::from_str(&transport).expect("raw transport");
    let input: LayoutInput =
        serde_json::from_value(raw_input.clone()).expect("typed transport ignores future field");
    let mismatch = CompiledTransitionState::from_layout_input(
        &input,
        &raw_input,
        ir(group("scene", Vec::new())),
    )
    .expect_err("transition signature must reject unknown layout transport fields");

    assert_eq!(mismatch.category, CompatibilityCategory::Paint);
    assert_eq!(mismatch.node_id, "scene");
    assert_eq!(mismatch.expected, "known layout transport top-level keys");
    assert_eq!(
        mismatch.observed,
        "unknown top-level key \"futureLayoutField\""
    );
}

#[test]
fn source_content_mismatch_is_reported_before_bbox_work() {
    let reference_transport =
        two_node_transport_with_visual("path", &json!({ "d": "M0 0 L10 10" }));
    let target_transport = two_node_transport_with_visual("path", &json!({ "d": "M0 0 L20 20" }));
    let shared_ir = ir(group("scene", vec![group("container", Vec::new())]));
    let reference = compiled_state(&reference_transport, shared_ir.clone());
    let target = compiled_state(&target_transport, shared_ir);

    let mismatch = reference
        .validate_compatibility(&target)
        .expect_err("state-specific path content must fail");
    assert_eq!(mismatch.category, CompatibilityCategory::Content);
    assert_eq!(mismatch.node_id, "container");
    assert_eq!(
        mismatch.expected,
        "same source content and line/glyph sequence as reference"
    );
}

#[test]
fn paint_and_static_transform_mismatches_are_reported_as_paint() {
    for (reference_visual, target_visual) in [
        (
            json!({ "background": "#112233" }),
            json!({ "background": "#445566" }),
        ),
        (
            json!({ "transform": { "translateX": 0 } }),
            json!({ "transform": { "translateX": 1 } }),
        ),
    ] {
        let reference_transport = two_node_transport_with_visual("box", &reference_visual);
        let target_transport = two_node_transport_with_visual("box", &target_visual);
        let shared_ir = ir(group("scene", vec![group("container", Vec::new())]));
        let reference = compiled_state(&reference_transport, shared_ir.clone());
        let target = compiled_state(&target_transport, shared_ir);

        let mismatch = reference
            .validate_compatibility(&target)
            .expect_err("paint/static transform differences must fail");
        assert_eq!(mismatch.category, CompatibilityCategory::Paint);
        assert_eq!(mismatch.node_id, "container");
    }
}

#[test]
fn authored_animation_mismatch_is_reported_separately_from_paint() {
    let animation = |duration_ms| {
        json!({
            "keyframes": [
                { "at": 0, "opacity": 0 },
                { "at": 1, "opacity": 1 }
            ],
            "durationMs": duration_ms
        })
    };
    let reference_transport =
        two_node_transport_with_visual("box", &json!({ "animation": animation(100) }));
    let target_transport =
        two_node_transport_with_visual("box", &json!({ "animation": animation(200) }));
    let shared_ir = ir(group("scene", vec![group("container", Vec::new())]));
    let reference = compiled_state(&reference_transport, shared_ir.clone());
    let target = compiled_state(&target_transport, shared_ir);

    let mismatch = reference
        .validate_compatibility(&target)
        .expect_err("authored animation differences must fail");
    assert_eq!(mismatch.category, CompatibilityCategory::Animation);
    assert_eq!(mismatch.node_id, "container");
}

#[test]
fn identical_text_source_with_different_line_flow_is_content_mismatch() {
    let reference_transport = text_transport(180);
    let target_transport = text_transport(60);
    let reference_raw: Value =
        serde_json::from_str(&reference_transport).expect("reference raw input");
    let target_raw: Value = serde_json::from_str(&target_transport).expect("target raw input");
    let reference_input: LayoutInput = serde_json::from_value(reference_raw.clone())
        .expect("reference transport should deserialize");
    let target_input: LayoutInput =
        serde_json::from_value(target_raw.clone()).expect("target transport should deserialize");
    let options = crate::RenderSvgOptionsInput {
        sample_animation: Some(false),
        ..crate::RenderSvgOptionsInput::default()
    };
    let registry = real_compile_registry();
    let reference_ir = crate::compile_layout_input_to_ir(&reference_input, &options, &registry)
        .expect("reference compile");
    let target_ir = crate::compile_layout_input_to_ir(&target_input, &options, &registry)
        .expect("target compile");
    let reference =
        CompiledTransitionState::from_layout_input(&reference_input, &reference_raw, reference_ir)
            .expect("reference state");
    let target = CompiledTransitionState::from_layout_input(&target_input, &target_raw, target_ir)
        .expect("target state");

    let mismatch = reference
        .validate_compatibility(&target)
        .expect_err("reflow must fail even when authored text is identical");
    assert_eq!(mismatch.category, CompatibilityCategory::Content);
    assert_eq!(mismatch.node_id, "copy");
}

#[test]
fn non_finite_and_negative_bboxes_are_rejected_in_reference_preorder() {
    let transport = two_node_transport("box");
    for (bbox, expected) in [
        (
            BBox {
                x: f64::NAN,
                y: 0.0,
                w: 10.0,
                h: 10.0,
            },
            "finite bbox coordinates and dimensions",
        ),
        (
            BBox {
                x: 0.0,
                y: 0.0,
                w: -1.0,
                h: 10.0,
            },
            "non-negative bbox dimensions",
        ),
    ] {
        let raw_input: Value =
            serde_json::from_str(&transport).expect("raw transport should deserialize");
        let input: LayoutInput =
            serde_json::from_value(raw_input.clone()).expect("transport should deserialize");
        let mismatch = CompiledTransitionState::from_layout_input(
            &input,
            &raw_input,
            ir(group(
                "scene",
                vec![group_with_bbox("container", bbox, Vec::new())],
            )),
        )
        .expect_err("invalid semantic bbox must fail state construction");
        assert_eq!(mismatch.category, CompatibilityCategory::Bbox);
        assert_eq!(mismatch.node_id, "container");
        assert_eq!(mismatch.expected, expected);
    }
}

#[test]
fn zero_dimension_is_allowed_only_when_that_axis_does_not_change_size() {
    let transport = two_node_transport("box");
    let zero_bbox = BBox {
        x: 0.0,
        y: 0.0,
        w: 0.0,
        h: 10.0,
    };
    let reference = compiled_state(
        &transport,
        ir(group(
            "scene",
            vec![group_with_bbox("container", zero_bbox, Vec::new())],
        )),
    );
    let unchanged_target = compiled_state(
        &transport,
        ir(group(
            "scene",
            vec![group_with_bbox("container", zero_bbox, Vec::new())],
        )),
    );
    reference
        .validate_compatibility(&unchanged_target)
        .expect("unchanged zero axis does not require scale");

    let reference = compiled_state(
        &transport,
        ir(group(
            "scene",
            vec![group_with_bbox("container", zero_bbox, Vec::new())],
        )),
    );
    let resized_target = compiled_state(
        &transport,
        ir(group(
            "scene",
            vec![group_with_bbox(
                "container",
                BBox {
                    w: 10.0,
                    ..zero_bbox
                },
                Vec::new(),
            )],
        )),
    );
    let mismatch = reference
        .validate_compatibility(&resized_target)
        .expect_err("zero-to-nonzero axis cannot be represented by scale");
    assert_eq!(mismatch.category, CompatibilityCategory::Bbox);
    assert_eq!(mismatch.node_id, "container");
}

#[test]
fn warning_merge_is_reference_first_and_deduplicates_exact_matches() {
    let transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": []
        }
    })
    .to_string();
    let mut reference_ir = ir(group("scene", Vec::new()));
    reference_ir.warnings = vec![warning("REFERENCE"), warning("SHARED")];
    let mut target_ir = ir(group("scene", Vec::new()));
    target_ir.warnings = vec![warning("SHARED"), warning("TARGET")];
    let reference = compiled_state(&transport, reference_ir);
    let target = compiled_state(&transport, target_ir);

    let transition_ir = reference
        .into_transition_ir(target, &transition_plan())
        .expect("warnings do not affect compatibility");
    assert_eq!(
        transition_ir
            .warnings
            .iter()
            .map(|entry| entry.code.as_str())
            .collect::<Vec<_>>(),
        vec!["REFERENCE", "SHARED", "TARGET"]
    );
}

#[test]
fn transition_plan_validation_accepts_only_strict_a_b_hold_a() {
    let valid: LayoutTransitionPlanInput = serde_json::from_value(json!({
        "checkpoints": [
            { "timeMs": 0, "stateIndex": 0 },
            { "timeMs": 300, "stateIndex": 1 },
            { "timeMs": 700, "stateIndex": 1 },
            { "timeMs": 1000, "stateIndex": 0 }
        ],
        "easing": "ease-in-out"
    }))
    .expect("valid plan should deserialize");
    valid.validate("scene").expect("valid plan should pass");

    let invalid: LayoutTransitionPlanInput = serde_json::from_value(json!({
        "checkpoints": [
            { "timeMs": 0, "stateIndex": 0 },
            { "timeMs": 300, "stateIndex": 1 },
            { "timeMs": 300, "stateIndex": 1 },
            { "timeMs": 1000, "stateIndex": 0 }
        ]
    }))
    .expect("invalid plan shape should deserialize for semantic validation");
    let mismatch = invalid
        .validate("scene")
        .expect_err("duplicate checkpoint time must fail");
    assert_eq!(mismatch.category, CompatibilityCategory::Schedule);
    assert_eq!(mismatch.node_id, "scene");
}

#[test]
fn transition_operation_invokes_the_full_compile_seam_once_per_state() {
    let transport = json!({
        "root": {
            "nodeId": "scene",
            "nodeType": "canvas",
            "authoredId": true,
            "children": []
        }
    })
    .to_string();
    let reference_raw: Value = serde_json::from_str(&transport).expect("reference raw input");
    let target_raw = reference_raw.clone();
    let reference_input: LayoutInput = serde_json::from_value(reference_raw.clone())
        .expect("reference transport should deserialize");
    let target_input: LayoutInput =
        serde_json::from_value(target_raw.clone()).expect("target transport should deserialize");
    let reference_input_ptr = std::ptr::from_ref(&reference_input);
    let target_input_ptr = std::ptr::from_ref(&target_input);
    let mut reference_compile_calls = 0;
    let mut target_compile_calls = 0;

    let transition_ir = crate::compile_transition_inputs_with(
        &reference_input,
        &reference_raw,
        &target_input,
        &target_raw,
        &transition_plan(),
        |input| {
            let input_ptr = std::ptr::from_ref(input);
            if std::ptr::eq(input_ptr, reference_input_ptr) {
                reference_compile_calls += 1;
            } else if std::ptr::eq(input_ptr, target_input_ptr) {
                target_compile_calls += 1;
            } else {
                panic!("transition operation compiled an unknown state");
            }
            Ok(ir(group("scene", Vec::new())))
        },
    )
    .expect("compatible states should compile");

    assert_eq!(reference_compile_calls, 1);
    assert_eq!(target_compile_calls, 1);
    assert_eq!(transition_ir.root.node_id, "scene");
}
