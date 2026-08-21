//! Public `ShapeError` variants must describe failures the kernel can emit.

use boundshape::{
    BooleanOp, CompileGeometryOptions, GeometryDoc, GeometryNode, GeometryViewBox, RegionAxis,
    ShapeError, boolean_regions_with_pair_budget, clip_monotonic_region_to_axis_interval,
    compile_geometry_paths, evaluate_geometry, measure_single_svg_path,
};

fn path_doc(d: &str) -> GeometryDoc {
    GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        root: GeometryNode::Path {
            node_id: None,
            d: d.into(),
            fill_rule: None,
        },
    }
}

fn assert_declared_error_is_audited(error: &ShapeError) {
    match error {
        ShapeError::BooleanChildCount
        | ShapeError::InvalidPathData
        | ShapeError::UnsupportedPathCommand(_)
        | ShapeError::BooleanTopology
        | ShapeError::BooleanPairLimit
        | ShapeError::RegionClipInterval
        | ShapeError::RegionClipNonMonotonic
        | ShapeError::DuplicatePartId(_)
        | ShapeError::PathMeasureMultipleSubpaths
        | ShapeError::PathMeasureZeroLength
        | ShapeError::PathMeasureComplexityLimit
        | ShapeError::PathOffsetGeometry
        | ShapeError::PathOffsetSampleLimit => {}
    }
}

#[test]
fn every_declared_shape_error_has_a_runtime_origin() {
    let too_few_children = GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        root: GeometryNode::Boolean {
            node_id: None,
            op: BooleanOp::Union,
            children: vec![path_doc("M0 0H10V10H0Z").root],
        },
    };
    let child_count_error = evaluate_geometry(&too_few_children).expect_err("child count");
    assert_declared_error_is_audited(&child_count_error);
    assert_eq!(child_count_error, ShapeError::BooleanChildCount);
    assert_eq!(
        evaluate_geometry(&path_doc("M0 0L")),
        Err(ShapeError::InvalidPathData)
    );
    assert_eq!(
        evaluate_geometry(&path_doc("M0 0X10 10")),
        Err(ShapeError::UnsupportedPathCommand('X'))
    );
    assert_eq!(
        evaluate_geometry(&path_doc(
            "M22 145L10 100L178 145L145 178L100 10L55 178L178 55Z",
        )),
        Err(ShapeError::BooleanTopology)
    );

    let duplicate_parts = GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        root: GeometryNode::Group {
            node_id: None,
            children: vec![
                GeometryNode::Path {
                    node_id: Some("face".into()),
                    d: "M0 0H10V10H0Z".into(),
                    fill_rule: None,
                },
                GeometryNode::Transform {
                    node_id: None,
                    transform: boundshape::Transform2D::default(),
                    child: Box::new(GeometryNode::Path {
                        node_id: Some("face".into()),
                        d: "M20 0H30V10H20Z".into(),
                        fill_rule: None,
                    }),
                },
            ],
        },
    };
    let duplicate_error =
        compile_geometry_paths(&duplicate_parts, Some(&CompileGeometryOptions::default()))
            .expect_err("duplicate addressable part id");
    assert_declared_error_is_audited(&duplicate_error);
    assert_eq!(duplicate_error, ShapeError::DuplicatePartId("face".into()));

    let path_errors = [
        (
            measure_single_svg_path("M0 0L10 0M20 0L30 0").expect_err("multiple subpaths"),
            ShapeError::PathMeasureMultipleSubpaths,
        ),
        (
            measure_single_svg_path("M0 0").expect_err("zero-length subpath"),
            ShapeError::PathMeasureZeroLength,
        ),
        (
            measure_single_svg_path("M0 0C0 1e100 1e100 1e100 1e100 0")
                .expect_err("path measurement complexity"),
            ShapeError::PathMeasureComplexityLimit,
        ),
    ];
    for (path_error, expected_error) in path_errors {
        assert_declared_error_is_audited(&path_error);
        assert_eq!(path_error, expected_error);
    }
}

#[test]
fn region_operation_limits_and_clip_preconditions_have_runtime_origins() {
    let Ok(left) = evaluate_geometry(&path_doc("M0 0H10V10H0Z")) else {
        panic!("left region");
    };
    let Ok(right) = evaluate_geometry(&path_doc("M5 0H15V10H5Z")) else {
        panic!("right region");
    };
    let mut no_pairs = 0;
    let pair_limit_error =
        boolean_regions_with_pair_budget(&left, &right, BooleanOp::Intersect, &mut no_pairs)
            .expect_err("boolean pair limit");
    assert_declared_error_is_audited(&pair_limit_error);
    assert_eq!(pair_limit_error, ShapeError::BooleanPairLimit);

    let clip_interval_error =
        clip_monotonic_region_to_axis_interval(&left, RegionAxis::X, 2.0, 2.0)
            .expect_err("clip interval");
    assert_declared_error_is_audited(&clip_interval_error);
    assert_eq!(clip_interval_error, ShapeError::RegionClipInterval);

    let Ok(non_monotonic) = evaluate_geometry(&path_doc("M0 0C10 1-10 2 0 3Z")) else {
        panic!("non-monotonic region");
    };
    let clip_monotonicity_error =
        clip_monotonic_region_to_axis_interval(&non_monotonic, RegionAxis::X, -1.0, 1.0)
            .expect_err("clip monotonicity");
    assert_declared_error_is_audited(&clip_monotonicity_error);
    assert_eq!(clip_monotonicity_error, ShapeError::RegionClipNonMonotonic);
}

#[test]
fn ids_inside_a_boolean_do_not_collide_with_addressable_parts() {
    let doc = GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        root: GeometryNode::Group {
            node_id: None,
            children: vec![
                GeometryNode::Path {
                    node_id: Some("shared".into()),
                    d: "M0 0H10V10H0Z".into(),
                    fill_rule: None,
                },
                GeometryNode::Boolean {
                    node_id: Some("boolean".into()),
                    op: BooleanOp::Union,
                    children: vec![
                        GeometryNode::Path {
                            node_id: Some("shared".into()),
                            d: "M20 0H30V10H20Z".into(),
                            fill_rule: None,
                        },
                        GeometryNode::Path {
                            node_id: Some("shared".into()),
                            d: "M25 0H35V10H25Z".into(),
                            fill_rule: None,
                        },
                    ],
                },
            ],
        },
    };

    compile_geometry_paths(&doc, Some(&CompileGeometryOptions::default()))
        .expect("boolean children are not addressable parts");
}

#[test]
fn explicit_part_ids_cannot_collide_with_generated_positional_ids() {
    let doc = GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        root: GeometryNode::Group {
            node_id: None,
            children: vec![
                GeometryNode::Path {
                    node_id: Some("part:1".into()),
                    d: "M0 0H10V10H0Z".into(),
                    fill_rule: None,
                },
                GeometryNode::Path {
                    node_id: None,
                    d: "M20 0H30V10H20Z".into(),
                    fill_rule: None,
                },
            ],
        },
    };

    assert_eq!(
        compile_geometry_paths(&doc, Some(&CompileGeometryOptions::default())),
        Err(ShapeError::DuplicatePartId("part:1".into()))
    );
}

#[test]
fn retired_rejections_are_supported_or_non_fatal() {
    let cases = [
        "",
        "m20 20l160 0l0 160l-160 0z",
        "M100 20A80 80 0 1 1 99.9 20Z",
        "M20 20L180 20L100 180",
        "M20 20L180 180L180 20L20 180Z",
    ];
    for path_data in cases {
        assert!(
            evaluate_geometry(&path_doc(path_data)).is_ok(),
            "retired rejection still failed for {path_data:?}"
        );
    }
}
