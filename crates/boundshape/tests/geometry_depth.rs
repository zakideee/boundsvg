//! Authored geometry tree depth boundary tests.

use boundshape::{
    BooleanOp, CompileGeometryOptions, ElasticFrame, ElasticSegment, ElasticSegmentRole,
    GeometryDoc, GeometryNode, GeometryViewBox, HitTestOptions, MAX_GEOMETRY_TREE_DEPTH, Point2D,
    ShapeError, SymbolDefinition, SymbolResolutionOptions, Transform2D, compile_geometry_paths,
    evaluate_geometry, evaluate_geometry_parts, hit_test_geometry_parts,
    intersections_between_geometries, resolve_symbol_geometry,
};

fn path_node(node_id: Option<&str>) -> GeometryNode {
    GeometryNode::Path {
        node_id: node_id.map(str::to_string),
        d: "M0 0H10V10H0Z".to_string(),
        fill_rule: None,
    }
}

fn geometry_doc(root: GeometryNode) -> GeometryDoc {
    GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        },
        root,
    }
}

fn nested_transform(depth: usize, leaf_id: Option<&str>) -> GeometryDoc {
    let mut root = path_node(leaf_id);
    for _ in 0..depth {
        root = GeometryNode::Transform {
            node_id: None,
            transform: Transform2D::default(),
            child: Box::new(root),
        };
    }
    geometry_doc(root)
}

fn nested_group(depth: usize) -> GeometryDoc {
    let mut root = path_node(None);
    for _ in 0..depth {
        root = GeometryNode::Group {
            node_id: None,
            children: vec![root],
        };
    }
    geometry_doc(root)
}

fn nested_boolean(depth: usize) -> GeometryDoc {
    let mut root = path_node(None);
    for _ in 0..depth {
        root = GeometryNode::Boolean {
            node_id: None,
            op: BooleanOp::Union,
            children: vec![root, path_node(None)],
        };
    }
    geometry_doc(root)
}

#[test]
fn recursive_geometry_nodes_share_the_depth_boundary() {
    for build in [
        nested_group as fn(usize) -> GeometryDoc,
        |depth| nested_transform(depth, None),
        nested_boolean,
    ] {
        evaluate_geometry(&build(MAX_GEOMETRY_TREE_DEPTH - 1)).expect("limit - 1 should evaluate");
        evaluate_geometry(&build(MAX_GEOMETRY_TREE_DEPTH)).expect("limit should evaluate");
        assert_eq!(
            evaluate_geometry(&build(MAX_GEOMETRY_TREE_DEPTH + 1)),
            Err(ShapeError::GeometryDepthLimit)
        );
    }
}

#[test]
fn public_geometry_entry_points_reject_over_depth_trees() {
    let over_depth = nested_transform(MAX_GEOMETRY_TREE_DEPTH + 1, None);
    let shallow = geometry_doc(path_node(None));

    assert_eq!(
        evaluate_geometry(&over_depth),
        Err(ShapeError::GeometryDepthLimit)
    );
    assert_eq!(
        evaluate_geometry_parts(&over_depth),
        Err(ShapeError::GeometryDepthLimit)
    );
    assert_eq!(
        compile_geometry_paths(&over_depth, Some(&CompileGeometryOptions::default())),
        Err(ShapeError::GeometryDepthLimit)
    );
    assert_eq!(
        hit_test_geometry_parts(
            &over_depth,
            Point2D { x: 5.0, y: 5.0 },
            Some(&HitTestOptions::default()),
        ),
        Err(ShapeError::GeometryDepthLimit)
    );
    assert_eq!(
        intersections_between_geometries(&shallow, &over_depth),
        Err(ShapeError::GeometryDepthLimit)
    );

    let symbol = SymbolDefinition {
        geometry: over_depth,
        elastic_segments: Vec::new(),
    };
    assert_eq!(
        resolve_symbol_geometry(
            &symbol,
            &SymbolResolutionOptions {
                width: 10.0,
                height: 10.0,
            },
        ),
        Err(ShapeError::GeometryDepthLimit)
    );
}

#[test]
fn symbol_resolution_checks_depth_added_by_elastic_mapping() {
    let symbol = SymbolDefinition {
        geometry: nested_transform(MAX_GEOMETRY_TREE_DEPTH, Some("elastic")),
        elastic_segments: vec![ElasticSegment {
            node_id: "elastic".to_string(),
            axis: "x".to_string(),
            role: ElasticSegmentRole::Stretch,
            frame: ElasticFrame {
                x: 0.0,
                y: 0.0,
                width: 10.0,
                height: 10.0,
            },
        }],
    };

    assert_eq!(
        resolve_symbol_geometry(
            &symbol,
            &SymbolResolutionOptions {
                width: 20.0,
                height: 10.0,
            },
        ),
        Err(ShapeError::GeometryDepthLimit)
    );
}

#[test]
fn symbol_resolution_wrapper_rules_share_the_depth_boundary() {
    let resolve =
        |geometry: GeometryDoc, role: ElasticSegmentRole, frame_width: f64, width: f64| {
            resolve_symbol_geometry(
                &SymbolDefinition {
                    geometry,
                    elastic_segments: vec![ElasticSegment {
                        node_id: "elastic".to_string(),
                        axis: "x".to_string(),
                        role,
                        frame: ElasticFrame {
                            x: 0.0,
                            y: 0.0,
                            width: frame_width,
                            height: 10.0,
                        },
                    }],
                },
                &SymbolResolutionOptions {
                    width,
                    height: 10.0,
                },
            )
        };

    resolve(
        nested_transform(MAX_GEOMETRY_TREE_DEPTH, Some("elastic")),
        ElasticSegmentRole::FixedStart,
        10.0,
        20.0,
    )
    .expect("fixed-start should not add a wrapper");
    resolve(
        nested_transform(MAX_GEOMETRY_TREE_DEPTH, Some("elastic")),
        ElasticSegmentRole::Stretch,
        0.0,
        20.0,
    )
    .expect("zero-sized stretch frame should not add a wrapper");
    resolve(
        nested_transform(MAX_GEOMETRY_TREE_DEPTH, Some("elastic")),
        ElasticSegmentRole::FixedEnd,
        10.0,
        10.0,
    )
    .expect("unchanged target size should not add a wrapper");
    resolve(
        nested_transform(MAX_GEOMETRY_TREE_DEPTH - 1, Some("elastic")),
        ElasticSegmentRole::FixedEnd,
        10.0,
        20.0,
    )
    .expect("one wrapper should be accepted at the exact limit");
    assert_eq!(
        resolve(
            nested_transform(MAX_GEOMETRY_TREE_DEPTH, Some("elastic")),
            ElasticSegmentRole::FixedEnd,
            10.0,
            20.0,
        ),
        Err(ShapeError::GeometryDepthLimit)
    );
}

#[test]
fn normal_geometry_keeps_its_compiled_path_bytes() {
    let geometry = geometry_doc(path_node(None));
    let parts = compile_geometry_paths(&geometry, None).expect("normal geometry should compile");

    assert_eq!(parts.len(), 1);
    assert_eq!(parts[0].d, "M0,0L10,0L10,10L0,10Z");
}
