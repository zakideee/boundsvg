//! Paint scene invariants: purity, draw-order projection, group boundary
//! balance, and the group/opacity contract.

use std::collections::BTreeMap;

use super::*;
use crate::ir::types::{Ir, IrNode, IrNodeKind};

fn bbox(x: f64, y: f64, w: f64, h: f64) -> BBox {
    BBox { x, y, w, h }
}

fn group_node(node_id: &str, children: Vec<IrNode>) -> IrNode {
    IrNode {
        node_id: node_id.to_string(),
        bbox: bbox(0.0, 0.0, 100.0, 100.0),
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

fn rect_node(node_id: &str, fill: &str) -> IrNode {
    IrNode {
        node_id: node_id.to_string(),
        bbox: bbox(1.0, 2.0, 30.0, 40.0),
        kind: IrNodeKind::Rect {
            fill: Some(fill.to_string()),
            gradient: None,
            stroke: None,
            stroke_width: None,
            stroke_scaling: None,
            border_radius: None,
            stroke_linecap: None,
            stroke_linejoin: None,
            stroke_dasharray: None,
            stroke_miterlimit: None,
        },
    }
}

fn canvas_border_node(node_id: &str, dasharray: Option<&str>) -> IrNode {
    IrNode {
        node_id: node_id.to_string(),
        bbox: bbox(8.0, 8.0, 40.0, 20.0),
        kind: IrNodeKind::Rect {
            fill: None,
            gradient: None,
            stroke: Some("#fff".to_string()),
            stroke_width: Some(1.0),
            stroke_scaling: Some(crate::ir::types::StrokeScaling::Canvas),
            border_radius: None,
            stroke_linecap: None,
            stroke_linejoin: None,
            stroke_dasharray: dasharray.map(str::to_string),
            stroke_miterlimit: None,
        },
    }
}

fn set_group_transform(node: &mut IrNode, scale_x: f64, scale_y: f64) {
    if let IrNodeKind::Group { transform, .. } = &mut node.kind {
        *transform = Some(boundshape::Transform2D {
            scale_x: Some(scale_x),
            scale_y: Some(scale_y),
            ..boundshape::Transform2D::default()
        });
    }
}

fn path_node(node_id: &str) -> IrNode {
    IrNode {
        node_id: node_id.to_string(),
        bbox: bbox(0.0, 0.0, 10.0, 10.0),
        kind: IrNodeKind::Path {
            path_data: "M0 0 H10 V10 Z".to_string(),
            fill: Some("#123".to_string()),
            stroke: None,
            stroke_width: None,
            stroke_scaling: None,
            fill_rule: None,
            stroke_linecap: None,
            stroke_linejoin: None,
            stroke_dasharray: None,
            stroke_miterlimit: None,
            on: None,
        },
    }
}

fn canvas_path_node(node_id: &str, dasharray: Option<&str>) -> IrNode {
    IrNode {
        node_id: node_id.to_string(),
        bbox: bbox(0.0, 0.0, 10.0, 10.0),
        kind: IrNodeKind::Path {
            path_data: "M0 0 H10 V10 Z".to_string(),
            fill: None,
            stroke: Some("#fff".to_string()),
            stroke_width: Some(1.0),
            stroke_scaling: Some(crate::ir::types::StrokeScaling::Canvas),
            fill_rule: None,
            stroke_linecap: None,
            stroke_linejoin: None,
            stroke_dasharray: dasharray.map(str::to_string),
            stroke_miterlimit: None,
            on: None,
        },
    }
}

fn shape_node(node_id: &str, part_ds: &[&str]) -> IrNode {
    IrNode {
        node_id: node_id.to_string(),
        bbox: bbox(0.0, 0.0, 20.0, 20.0),
        kind: IrNodeKind::Shape {
            shape_parts: part_ds
                .iter()
                .map(|d| ShapePathPart {
                    part_id: None,
                    d: (*d).to_string(),
                    stroke_d: None,
                    bounds: None,
                    paint: None,
                })
                .collect(),
            fill: Some("#0f0".to_string()),
            stroke: None,
            stroke_width: None,
            fill_rule: None,
            stroke_linecap: None,
            stroke_linejoin: None,
            stroke_dasharray: None,
            stroke_miterlimit: None,
            on: None,
        },
    }
}

fn ir_with_root(root: IrNode, draw_order: Vec<String>) -> Ir {
    Ir {
        root,
        draw_order,
        width: 100.0,
        height: 100.0,
        debug: None,
        warnings: Vec::new(),
    }
}

/// A representative IR: nested groups, leaves of several kinds, and a
/// duplicated shape part that triggers shared-path hoisting.
fn sample_ir() -> Ir {
    let inner_group = group_node(
        "inner",
        vec![rect_node("inner:bg", "#eee"), path_node("p1")],
    );
    let root = group_node(
        "canvas",
        vec![
            rect_node("canvas:bg", "#fff"),
            inner_group,
            shape_node("s1", &["M0 0 H4 Z"]),
            shape_node("s2", &["M0 0 H4 Z"]),
            group_node("empty-group", Vec::new()),
        ],
    );
    ir_with_root(
        root,
        vec![
            "canvas:bg".to_string(),
            "inner:bg".to_string(),
            "p1".to_string(),
            "s1".to_string(),
            "s2".to_string(),
        ],
    )
}

fn leaf_node_ids(items: &[PaintItem]) -> Vec<String> {
    items
        .iter()
        .filter_map(|item| match item {
            PaintItem::Rect(rect) => Some(rect.node_id.clone()),
            PaintItem::Text(text) => Some(text.node_id.clone()),
            PaintItem::Image(image) => Some(image.node_id.clone()),
            PaintItem::Path(path) => Some(path.node_id.clone()),
            PaintItem::NestedSvg(nested) => Some(nested.node_id.clone()),
            PaintItem::Shape(shape) => Some(shape.node_id.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn resolution_is_pure() {
    let ir = sample_ir();
    let options = PaintSceneOptions::default();
    let first = resolve_paint_scene(&ir, &options).expect("scene resolves");
    let second = resolve_paint_scene(&ir, &options).expect("scene resolves");
    assert_eq!(first, second);
}

#[test]
fn canvas_stroke_uses_sampled_nested_similarity_scale_but_not_output_scale() {
    let mut child = group_node(
        "hairline",
        vec![canvas_border_node("hairline:border", None)],
    );
    set_group_transform(&mut child, 1.5, 1.5);
    let mut camera = group_node("camera", vec![child]);
    set_group_transform(&mut camera, 2.0, 2.0);
    let ir = ir_with_root(
        group_node("canvas", vec![camera]),
        vec!["hairline:border".to_string()],
    );

    let paint_scene = resolve_paint_scene(
        &ir,
        &PaintSceneOptions {
            scale: 2.0,
            ..PaintSceneOptions::default()
        },
    )
    .expect("scene resolves");
    let border = paint_scene
        .items
        .iter()
        .find_map(|item| match item {
            PaintItem::Rect(rect) => Some(rect),
            _ => None,
        })
        .expect("border rect");
    assert!((border.stroke_width.unwrap_or_default() - (1.0 / 3.0)).abs() < 1e-12);
    assert_eq!(
        border.canvas_stroke_class.as_deref(),
        Some("bsvg-vstroke-hairline")
    );
    assert_eq!(paint_scene.canvas_strokes[0].authored_width, 2.0);
}

#[test]
fn canvas_stroke_zero_scale_uses_zero_fallback_width() {
    let mut owner = group_node(
        "hairline",
        vec![canvas_border_node("hairline:border", None)],
    );
    set_group_transform(&mut owner, 0.0, 0.0);
    let ir = ir_with_root(
        group_node("canvas", vec![owner]),
        vec!["hairline:border".to_string()],
    );
    let paint_scene = resolve_paint_scene(&ir, &PaintSceneOptions::default())
        .expect("zero scale remains a valid degenerate pose");
    let width = paint_scene.items.iter().find_map(|item| match item {
        PaintItem::Rect(rect) => rect.stroke_width,
        _ => None,
    });
    assert_eq!(width, Some(0.0));
}

#[test]
fn canvas_stroke_uses_the_svg_default_for_an_omitted_raw_ir_width() {
    let mut border = canvas_border_node("hairline:border", None);
    if let IrNodeKind::Rect { stroke_width, .. } = &mut border.kind {
        *stroke_width = None;
    }
    let mut owner = group_node("hairline", vec![border]);
    set_group_transform(&mut owner, 0.5, 0.5);
    let ir = ir_with_root(
        group_node("canvas", vec![owner]),
        vec!["hairline:border".to_string()],
    );

    let paint_scene = resolve_paint_scene(&ir, &PaintSceneOptions::default())
        .expect("the SVG default width remains canvas-stable");
    let border = paint_scene
        .items
        .iter()
        .find_map(|item| match item {
            PaintItem::Rect(rect) => Some(rect),
            _ => None,
        })
        .expect("border rect");
    assert_eq!(border.stroke_width, Some(2.0));
    assert_eq!(paint_scene.canvas_strokes[0].authored_width, 1.0);
}

#[test]
fn canvas_stroke_disambiguates_multiple_raw_ir_rects_in_one_group() {
    let first = canvas_border_node("card:first-border", None);
    let mut second = canvas_border_node("card:second-border", None);
    if let IrNodeKind::Rect { stroke_width, .. } = &mut second.kind {
        *stroke_width = Some(2.0);
    }
    let mut third = canvas_border_node("card-2:border", None);
    if let IrNodeKind::Rect { stroke_width, .. } = &mut third.kind {
        *stroke_width = Some(3.0);
    }
    let ir = ir_with_root(
        group_node(
            "canvas",
            vec![
                group_node("card", vec![first, second]),
                group_node("card-2", vec![third]),
            ],
        ),
        vec![
            "card:first-border".to_string(),
            "card:second-border".to_string(),
            "card-2:border".to_string(),
        ],
    );

    let paint_scene = resolve_paint_scene(&ir, &PaintSceneOptions::default())
        .expect("raw IR borders resolve without selector collisions");
    let class_names: Vec<&str> = paint_scene
        .items
        .iter()
        .filter_map(|item| match item {
            PaintItem::Rect(rect) => rect.canvas_stroke_class.as_deref(),
            _ => None,
        })
        .collect();
    assert_eq!(
        class_names,
        vec![
            "bsvg-vstroke-card",
            "bsvg-vstroke-card-2",
            "bsvg-vstroke-card-2-2"
        ]
    );
    assert_eq!(
        paint_scene
            .canvas_strokes
            .iter()
            .map(|style| style.authored_width)
            .collect::<Vec<_>>(),
        vec![1.0, 2.0, 3.0]
    );
}

#[test]
fn canvas_stroke_resolves_mixed_rects_and_paths_with_one_deterministic_allocator() {
    let mut owner = group_node(
        "card",
        vec![
            canvas_border_node("card:border", None),
            canvas_path_node("card", None),
        ],
    );
    set_group_transform(&mut owner, 2.0, 2.0);
    let ir = ir_with_root(
        group_node("canvas", vec![owner, canvas_path_node("card-2", None)]),
        vec![
            "card:border".to_string(),
            "card".to_string(),
            "card-2".to_string(),
        ],
    );

    let paint_scene = resolve_paint_scene(
        &ir,
        &PaintSceneOptions {
            scale: 3.0,
            ..PaintSceneOptions::default()
        },
    )
    .expect("mixed canvas-stable strokes resolve");
    let class_names: Vec<&str> = paint_scene
        .items
        .iter()
        .filter_map(|item| match item {
            PaintItem::Rect(rect) => rect.canvas_stroke_class.as_deref(),
            PaintItem::Path(path) => path.canvas_stroke_class.as_deref(),
            _ => None,
        })
        .collect();
    assert_eq!(
        class_names,
        vec![
            "bsvg-vstroke-card",
            "bsvg-vstroke-card-2",
            "bsvg-vstroke-card-2-2"
        ]
    );
    let fallback_widths: Vec<f64> = paint_scene
        .items
        .iter()
        .filter_map(|item| match item {
            PaintItem::Rect(rect) => rect.stroke_width,
            PaintItem::Path(path) => path.stroke_width,
            _ => None,
        })
        .collect();
    assert_eq!(fallback_widths, vec![0.5, 0.5, 1.0]);
    assert_eq!(
        paint_scene
            .canvas_strokes
            .iter()
            .map(|style| style.authored_width)
            .collect::<Vec<_>>(),
        vec![3.0, 3.0, 3.0]
    );
}

#[test]
fn canvas_path_rejects_unsupported_transform_and_dash_with_path_owner_id() {
    let mut scaled_path = group_node("path-wrapper", vec![canvas_path_node("path", None)]);
    set_group_transform(&mut scaled_path, 2.0, 1.0);
    let transform_ir = ir_with_root(
        group_node("canvas", vec![scaled_path]),
        vec!["path".to_string()],
    );
    let transform_error = resolve_paint_scene(&transform_ir, &PaintSceneOptions::default())
        .expect_err("non-uniform Path transform must fail");
    assert!(matches!(
        transform_error,
        EngineError::Structured {
            ref code,
            ref node_id,
            ..
        } if code == "CANVAS_STROKE_UNSUPPORTED_TRANSFORM"
            && node_id.as_deref() == Some("path")
    ));

    let dash_ir = ir_with_root(
        group_node("canvas", vec![canvas_path_node("path", Some("4,2"))]),
        vec!["path".to_string()],
    );
    let dash_error = resolve_paint_scene(&dash_ir, &PaintSceneOptions::default())
        .expect_err("dashed Path stroke must fail");
    assert!(matches!(
        dash_error,
        EngineError::Structured {
            ref code,
            ref node_id,
            ..
        } if code == "CANVAS_STROKE_DASH_UNSUPPORTED"
            && node_id.as_deref() == Some("path")
    ));
}

#[test]
fn canvas_stroke_ignores_unpainted_raw_ir_rects() {
    for raw_stroke in [
        None,
        Some(String::new()),
        Some("none".to_string()),
        Some(" NONE ".to_string()),
    ] {
        let mut border = canvas_border_node("owner:border", None);
        if let IrNodeKind::Rect {
            stroke,
            stroke_width,
            ..
        } = &mut border.kind
        {
            *stroke = raw_stroke;
            *stroke_width = None;
        }
        let mut owner = group_node("owner", vec![border]);
        set_group_transform(&mut owner, 2.0, 1.0);
        let ir = ir_with_root(
            group_node("canvas", vec![owner]),
            vec!["owner:border".to_string()],
        );

        let paint_scene = resolve_paint_scene(&ir, &PaintSceneOptions::default())
            .expect("an unpainted rect does not impose canvas-stroke constraints");
        assert!(paint_scene.canvas_strokes.is_empty());
        assert!(paint_scene.items.iter().all(|item| match item {
            PaintItem::Rect(rect) => rect.canvas_stroke_class.is_none(),
            _ => true,
        }));
    }
}

#[test]
fn canvas_stroke_ignores_unpainted_raw_ir_paths() {
    for raw_stroke in [
        None,
        Some(String::new()),
        Some("none".to_string()),
        Some(" NONE ".to_string()),
    ] {
        let mut path = canvas_path_node("path", Some("4,2"));
        if let IrNodeKind::Path {
            stroke,
            stroke_width,
            ..
        } = &mut path.kind
        {
            *stroke = raw_stroke;
            *stroke_width = None;
        }
        let mut owner = group_node("path-wrapper", vec![path]);
        set_group_transform(&mut owner, 2.0, 1.0);
        let ir = ir_with_root(group_node("canvas", vec![owner]), vec!["path".to_string()]);

        let paint_scene = resolve_paint_scene(&ir, &PaintSceneOptions::default())
            .expect("an unpainted Path does not impose canvas-stroke constraints");
        assert!(paint_scene.canvas_strokes.is_empty());
        assert!(paint_scene.items.iter().all(|item| match item {
            PaintItem::Path(path_item) => path_item.canvas_stroke_class.is_none(),
            _ => true,
        }));
    }
}

#[test]
fn canvas_stroke_rejects_non_uniform_and_mirrored_ancestors() {
    for (scale_x, scale_y) in [(2.0, 1.0), (-1.0, 1.0)] {
        let mut owner = group_node(
            "hairline",
            vec![canvas_border_node("hairline:border", None)],
        );
        set_group_transform(&mut owner, scale_x, scale_y);
        let ir = ir_with_root(
            group_node("canvas", vec![owner]),
            vec!["hairline:border".to_string()],
        );
        let error = resolve_paint_scene(&ir, &PaintSceneOptions::default())
            .expect_err("unsupported transform must fail");
        assert!(matches!(
            error,
            EngineError::Structured {
                ref code,
                ref message,
                ref stage,
                ref node_id,
                ..
            } if code == "CANVAS_STROKE_UNSUPPORTED_TRANSFORM"
                && message == "Canvas-stable border for node \"hairline\" requires similarity transforms without axis mirroring on every ancestor"
                && stage.as_ref() == Some(&crate::diagnostics::PipelineStage::Emit)
                && node_id.as_deref() == Some("hairline")
        ));
    }
}

#[test]
fn canvas_stroke_rejects_an_unsafe_unsampled_animation_keyframe() {
    let mut owner = group_node(
        "hairline",
        vec![canvas_border_node("hairline:border", None)],
    );
    if let IrNodeKind::Group {
        transform,
        animation,
        ..
    } = &mut owner.kind
    {
        *transform = Some(boundshape::Transform2D {
            scale_x: Some(1.0),
            scale_y: Some(1.0),
            ..boundshape::Transform2D::default()
        });
        *animation = Some(crate::ir::types::AnimationSpec {
            keyframes: vec![
                crate::ir::types::AnimationKeyframe {
                    at: 0.0,
                    opacity: None,
                    transform: Some(crate::ir::types::AnimationTransform2D {
                        scale_x: Some(1.0),
                        scale_y: Some(1.0),
                        ..crate::ir::types::AnimationTransform2D::default()
                    }),
                },
                crate::ir::types::AnimationKeyframe {
                    at: 1.0,
                    opacity: None,
                    transform: Some(crate::ir::types::AnimationTransform2D {
                        scale_x: Some(2.0),
                        scale_y: Some(1.0),
                        ..crate::ir::types::AnimationTransform2D::default()
                    }),
                },
            ],
            duration_ms: 100.0,
            delay_ms: None,
            easing: None,
            iterations: None,
            fill: None,
        });
    }
    let ir = ir_with_root(
        group_node("canvas", vec![owner]),
        vec!["hairline:border".to_string()],
    );
    let error = resolve_paint_scene(&ir, &PaintSceneOptions::default())
        .expect_err("every animation keyframe must be safe");
    assert!(matches!(
        error,
        EngineError::Structured { ref code, .. }
            if code == "CANVAS_STROKE_UNSUPPORTED_TRANSFORM"
    ));
}

#[test]
fn canvas_stroke_rejects_dasharrays_at_the_ir_boundary() {
    let owner = group_node(
        "hairline",
        vec![canvas_border_node("hairline:border", Some("5,5"))],
    );
    let ir = ir_with_root(
        group_node("canvas", vec![owner]),
        vec!["hairline:border".to_string()],
    );
    let error = resolve_paint_scene(&ir, &PaintSceneOptions::default())
        .expect_err("dash semantics are unsupported");
    assert!(matches!(
        error,
        EngineError::Structured {
            ref code,
            ref message,
            ref stage,
            ref node_id,
            ..
        } if code == "CANVAS_STROKE_DASH_UNSUPPORTED"
            && message == "Canvas-stable box borders do not support strokeDasharray"
            && stage.as_ref() == Some(&crate::diagnostics::PipelineStage::Emit)
            && node_id.as_deref() == Some("hairline")
    ));
}

#[test]
fn leaf_order_projects_the_ir_draw_order() {
    // The sample IR has no container handlers and no empty leaves, so the
    // scene's leaf sequence must equal drawOrder exactly (bg/border rects
    // included — they are IR nodes of their own).
    let ir = sample_ir();
    let paint_scene =
        resolve_paint_scene(&ir, &PaintSceneOptions::default()).expect("scene resolves");
    assert_eq!(leaf_node_ids(&paint_scene.items), ir.draw_order);
}

#[test]
fn group_boundaries_balance_and_never_go_negative() {
    let ir = sample_ir();
    let paint_scene =
        resolve_paint_scene(&ir, &PaintSceneOptions::default()).expect("scene resolves");
    let mut depth: i64 = 0;
    for item in &paint_scene.items {
        match item {
            PaintItem::GroupOpen(open) if !open.self_close => depth += 1,
            PaintItem::GroupClose => {
                depth -= 1;
                assert!(depth >= 0, "GroupClose without a matching GroupOpen");
            }
            _ => {}
        }
    }
    assert_eq!(depth, 0, "unbalanced group boundaries");
}

#[test]
fn every_ir_group_gets_a_group_item_and_opacity_one_gets_no_attr() {
    // A group with opacity 1 still becomes a <g> (the island rule concerns
    // the attribute, not the element).
    let mut group = group_node("g1", vec![rect_node("r1", "#abc")]);
    if let IrNodeKind::Group { opacity, .. } = &mut group.kind {
        *opacity = Some(1.0);
    }
    let root = group_node("canvas", vec![group]);
    let ir = ir_with_root(root, vec!["r1".to_string()]);

    let paint_scene =
        resolve_paint_scene(&ir, &PaintSceneOptions::default()).expect("scene resolves");
    let group_opens: Vec<&GroupOpenItem> = paint_scene
        .items
        .iter()
        .filter_map(|item| match item {
            PaintItem::GroupOpen(open) => Some(open),
            _ => None,
        })
        .collect();
    assert_eq!(group_opens.len(), 1);
    assert_eq!(group_opens[0].node_id.as_deref(), Some("g1"));
    assert_eq!(group_opens[0].opacity, None);

    // A non-1 opacity keeps the attribute.
    let mut translucent = group_node("g2", vec![rect_node("r2", "#abc")]);
    if let IrNodeKind::Group { opacity, .. } = &mut translucent.kind {
        *opacity = Some(0.5);
    }
    let ir = ir_with_root(
        group_node("canvas", vec![translucent]),
        vec!["r2".to_string()],
    );
    let paint_scene =
        resolve_paint_scene(&ir, &PaintSceneOptions::default()).expect("scene resolves");
    let open = paint_scene
        .items
        .iter()
        .find_map(|item| match item {
            PaintItem::GroupOpen(open) => Some(open),
            _ => None,
        })
        .expect("group item");
    assert_eq!(open.opacity, Some(0.5));
}

#[test]
fn childless_groups_self_close_without_a_close_item() {
    let ir = sample_ir();
    let paint_scene =
        resolve_paint_scene(&ir, &PaintSceneOptions::default()).expect("scene resolves");
    let self_close_count = paint_scene
        .items
        .iter()
        .filter(|item| matches!(item, PaintItem::GroupOpen(open) if open.self_close))
        .count();
    let open_count = paint_scene
        .items
        .iter()
        .filter(|item| matches!(item, PaintItem::GroupOpen(open) if !open.self_close))
        .count();
    let close_count = paint_scene
        .items
        .iter()
        .filter(|item| matches!(item, PaintItem::GroupClose))
        .count();
    assert_eq!(self_close_count, 1, "empty-group self-closes");
    assert_eq!(open_count, close_count);
}

#[test]
fn duplicated_shape_parts_hoist_to_shared_defs_in_discovery_order() {
    let ir = sample_ir();
    let paint_scene =
        resolve_paint_scene(&ir, &PaintSceneOptions::default()).expect("scene resolves");
    assert_eq!(paint_scene.defs.shared_shape_paths.len(), 1);
    let shared_def = &paint_scene.defs.shared_shape_paths[0];
    assert!(shared_def.id.starts_with("sp-"));

    let use_count = paint_scene
        .items
        .iter()
        .filter_map(|item| match item {
            PaintItem::Shape(shape) => Some(shape),
            _ => None,
        })
        .flat_map(|shape| &shape.parts)
        .filter(
            |part| matches!(part, ShapePartItem::Use { href_id, .. } if *href_id == shared_def.id),
        )
        .count();
    assert_eq!(use_count, 2);
}

#[test]
fn debug_overlay_resolves_only_when_requested() {
    let ir = sample_ir();
    let without_debug =
        resolve_paint_scene(&ir, &PaintSceneOptions::default()).expect("scene resolves");
    assert!(without_debug.debug_items.is_none());

    let with_debug = resolve_paint_scene(
        &ir,
        &PaintSceneOptions {
            debug: DebugOverlaySetting::Flag(true),
            ..PaintSceneOptions::default()
        },
    )
    .expect("scene resolves");
    let debug_items = with_debug.debug_items.expect("overlay resolved");
    assert!(
        debug_items
            .iter()
            .any(|item| matches!(item, PaintItem::DebugRect(_))),
        "leaf nodes produce debug rects"
    );

    // Empty parts list disables the overlay; unknown parts keep the (empty)
    // overlay group, mirroring the TS Set semantics.
    let empty_parts = resolve_paint_scene(
        &ir,
        &PaintSceneOptions {
            debug: DebugOverlaySetting::Config(Some(Vec::new())),
            ..PaintSceneOptions::default()
        },
    )
    .expect("scene resolves");
    assert!(empty_parts.debug_items.is_none());

    let unknown_parts = resolve_paint_scene(
        &ir,
        &PaintSceneOptions {
            debug: DebugOverlaySetting::Config(Some(vec!["bogus".to_string()])),
            ..PaintSceneOptions::default()
        },
    )
    .expect("scene resolves");
    let overlay = unknown_parts.debug_items.expect("overlay group kept");
    assert!(overlay.is_empty());
}

#[test]
fn root_meta_rides_on_the_scene() {
    let mut root = group_node("canvas", vec![rect_node("r1", "#abc")]);
    if let IrNodeKind::Group { meta, .. } = &mut root.kind {
        let mut entries = BTreeMap::new();
        entries.insert("scene".to_string(), "metadata".to_string());
        *meta = Some(entries);
    }
    let ir = ir_with_root(root, vec!["r1".to_string()]);
    let paint_scene =
        resolve_paint_scene(&ir, &PaintSceneOptions::default()).expect("scene resolves");
    assert_eq!(
        paint_scene
            .root_meta
            .as_ref()
            .and_then(|meta| meta.get("scene"))
            .map(String::as_str),
        Some("metadata")
    );
}
