//! A compiled part carries the geometry a stroke should follow.
//!
//! Fill normalization drops zero-area contours and retraces self-intersections.
//! That is right for filling and wrong for stroking: a stroked line disappeared
//! and a stroked bowtie became the two triangles the retrace produced. A part
//! now carries `stroke_d` when normalization changed the geometry, and nothing
//! extra when it did not.

// Integration tests always build with `cfg(test)`; declaring it lets clippy's
// `allow-*-in-tests` config apply to helper functions in this file.
#![cfg(test)]

use boundshape::{
    CompileGeometryOptions, GeometryDoc, GeometryNode, GeometryPaint, GeometryViewBox,
    HitTestOptions, PartHitKind, Point2D, Transform2D, compile_geometry_paths,
    compile_geometry_to_svg_document, evaluate_geometry, evaluate_geometry_parts,
    hit_test_geometry_parts, region_to_path,
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

fn compile(d: &str) -> Vec<(String, Option<String>)> {
    compile_geometry_paths(&path_doc(d), Some(&CompileGeometryOptions::default()))
        .expect(d)
        .into_iter()
        .map(|part| (part.d, part.stroke_d))
        .collect()
}

#[test]
fn an_ordinary_shape_carries_no_separate_stroke_path() {
    let parts = compile("M20 20H180V180H20Z");
    assert_eq!(parts.len(), 1);
    assert!(
        parts[0].1.is_none(),
        "a shape whose fill region is its outline should not carry stroke_d, got {:?}",
        parts[0].1
    );
}

#[test]
fn a_zero_area_contour_survives_as_a_stroke_path() {
    let parts = compile("M20 100L180 100Z");
    assert_eq!(parts.len(), 1, "the line was dropped entirely");
    assert_eq!(parts[0].0, "", "a line has no fill");
    assert_eq!(
        parts[0].1.as_deref(),
        Some("M20,100L180,100Z"),
        "the line the author drew should still be strokeable"
    );
}

#[test]
fn an_open_line_remains_open_for_stroke() {
    let parts = compile("M20 100L180 100");
    assert_eq!(parts.len(), 1);
    assert_eq!(parts[0].0, "", "an open line has no fill area");
    assert_eq!(parts[0].1.as_deref(), Some("M20,100L180,100"));
}

#[test]
fn an_open_polygon_closes_for_fill_but_not_for_stroke() {
    let parts = compile("M20 20L180 20L100 180");
    assert_eq!(parts.len(), 1);
    assert!(parts[0].0.ends_with('Z'), "fill must close: {}", parts[0].0);
    assert_eq!(
        parts[0].1.as_deref(),
        Some("M20,20L180,20L100,180"),
        "stroke must not gain the fill's closing edge"
    );
}

#[test]
fn nested_transforms_apply_to_open_stroke_geometry() {
    let doc = GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        root: GeometryNode::Transform {
            node_id: None,
            transform: boundshape::Transform2D {
                translate_x: Some(10.0),
                ..boundshape::Transform2D::default()
            },
            child: Box::new(GeometryNode::Transform {
                node_id: None,
                transform: boundshape::Transform2D {
                    translate_y: Some(20.0),
                    ..boundshape::Transform2D::default()
                },
                child: Box::new(GeometryNode::Path {
                    node_id: None,
                    d: "M0 0L10 0".into(),
                    fill_rule: None,
                }),
            }),
        },
    };
    let parts = compile_geometry_paths(&doc, Some(&CompileGeometryOptions::default()))
        .expect("nested transform");
    assert_eq!(parts[0].stroke_d.as_deref(), Some("M10,20L20,20"));
}

#[test]
fn standalone_svg_strokes_a_zero_area_contour() {
    let svg = compile_geometry_to_svg_document(
        &path_doc("M20 100L180 100Z"),
        Some(&CompileGeometryOptions {
            paint: Some(GeometryPaint {
                fill: Some("none".into()),
                stroke: Some("#e11d48".into()),
                stroke_width: Some(6.0),
                ..GeometryPaint::default()
            }),
            ..CompileGeometryOptions::default()
        }),
    )
    .expect("standalone SVG");
    assert!(
        svg.contains("<path"),
        "the standalone API dropped the stroke: {svg}"
    );
    assert!(svg.contains("L177.6,100Z"), "wrong stroke path: {svg}");
}

#[test]
fn standalone_split_fill_and_stroke_share_element_opacity() {
    let svg = compile_geometry_to_svg_document(
        &path_doc("M20 20L180 180L180 20L20 180Z"),
        Some(&CompileGeometryOptions {
            paint: Some(GeometryPaint {
                fill: Some("#2563eb".into()),
                stroke: Some("#e11d48".into()),
                stroke_width: Some(6.0),
                opacity: Some(0.5),
                ..GeometryPaint::default()
            }),
            ..CompileGeometryOptions::default()
        }),
    )
    .expect("standalone SVG");
    assert!(svg.contains("<g opacity=\"0.5\"><path"), "{svg}");
    assert_eq!(svg.matches("opacity=\"0.5\"").count(), 1, "{svg}");
    assert_eq!(svg.matches("<path").count(), 2, "{svg}");
}

#[test]
fn standalone_svg_keeps_an_open_line_open() {
    let svg = compile_geometry_to_svg_document(
        &path_doc("M20 100L180 100"),
        Some(&CompileGeometryOptions {
            paint: Some(GeometryPaint {
                fill: Some("none".into()),
                stroke: Some("#e11d48".into()),
                stroke_width: Some(6.0),
                stroke_linecap: Some("round".into()),
                ..GeometryPaint::default()
            }),
            ..CompileGeometryOptions::default()
        }),
    )
    .expect("standalone SVG");
    assert!(
        svg.contains("d=\"M22.4,100L177.6,100\""),
        "wrong open stroke: {svg}"
    );
    assert!(!svg.contains("L177.6,100Z"), "stroke was closed: {svg}");
}

#[test]
fn stroke_none_does_not_inset_the_viewport() {
    let parts = compile_geometry_paths(
        &path_doc("M0 0H200V200H0Z"),
        Some(&CompileGeometryOptions {
            paint: Some(GeometryPaint {
                stroke: Some("none".into()),
                stroke_width: Some(20.0),
                ..GeometryPaint::default()
            }),
            ..CompileGeometryOptions::default()
        }),
    )
    .expect("compile");
    assert_eq!(parts[0].d, "M0,0L200,0L200,200L0,200Z");
}

#[test]
fn hit_test_uses_the_authored_stroke_geometry() {
    let hits = hit_test_geometry_parts(
        &path_doc("M20 100L180 100Z"),
        Point2D { x: 100.0, y: 100.0 },
        Some(&HitTestOptions {
            stroke_width: Some(6.0),
            tolerance: Some(0.0),
            fill_rule: None,
        }),
    )
    .expect("hit test");
    assert_eq!(hits.len(), 1, "stroke-only part was not hit");
    assert_eq!(hits[0].hit, PartHitKind::Stroke);
}

#[test]
fn a_self_crossing_outline_strokes_as_drawn() {
    let parts = compile("M20 20L180 180L180 20L20 180Z");
    assert_eq!(parts.len(), 1);
    // The fill region is the two retraced triangles.
    assert!(parts[0].0.contains("Z M"), "fill should be retraced");
    // The stroke follows the single crossing contour the author wrote.
    let stroke = parts[0].1.as_deref().expect("stroke_d");
    assert!(
        !stroke.contains("Z M"),
        "stroke should be one contour: {stroke}"
    );
    assert_eq!(stroke, "M20,20L180,180L180,20L20,180Z");
}

#[test]
fn evenodd_changes_only_the_fill_projection() {
    let mut doc = path_doc("M20 20L180 180L180 20L20 180Z");
    let GeometryNode::Path { fill_rule, .. } = &mut doc.root else {
        panic!("test fixture root is a path");
    };
    *fill_rule = Some("evenodd".into());
    let parts = compile_geometry_paths(&doc, Some(&CompileGeometryOptions::default()))
        .expect("evenodd compile");
    assert_eq!(
        parts[0].stroke_d.as_deref(),
        Some("M20,20L180,180L180,20L20,180Z")
    );
}

#[test]
fn compile_paint_fill_rule_is_the_default_for_authored_paths() {
    let mut doc = path_doc("M20 20H180V180H20Z M60 60H140V140H60Z");
    let nonzero = compile_geometry_paths(&doc, Some(&CompileGeometryOptions::default()))
        .expect("nonzero default");
    let evenodd_options = CompileGeometryOptions {
        paint: Some(GeometryPaint {
            fill_rule: Some("evenodd".into()),
            ..GeometryPaint::default()
        }),
        ..CompileGeometryOptions::default()
    };
    let evenodd =
        compile_geometry_paths(&doc, Some(&evenodd_options)).expect("evenodd paint default");
    assert_ne!(nonzero[0].d, evenodd[0].d);
    assert_eq!(
        evenodd[0].d.matches('M').count(),
        2,
        "inner hole must survive"
    );

    let GeometryNode::Path { fill_rule, .. } = &mut doc.root else {
        panic!("test fixture root is a path");
    };
    *fill_rule = Some("nonzero".into());
    let explicit_nonzero =
        compile_geometry_paths(&doc, Some(&evenodd_options)).expect("path override");
    assert_eq!(explicit_nonzero[0].d, nonzero[0].d);
}

#[test]
fn hit_test_uses_canonical_winding_and_an_explicit_default_fill_rule() {
    let doc = path_doc("M20 20H180V180H20Z M60 60H140V140H60Z");
    let center = Point2D { x: 100.0, y: 100.0 };
    let nonzero_hits = hit_test_geometry_parts(&doc, center, None).expect("nonzero hit test");
    assert_eq!(
        nonzero_hits.len(),
        1,
        "same-winding contours fill the center"
    );

    let evenodd_hits = hit_test_geometry_parts(
        &doc,
        center,
        Some(&HitTestOptions {
            fill_rule: Some("evenodd".into()),
            ..HitTestOptions::default()
        }),
    )
    .expect("evenodd hit test");
    assert!(
        evenodd_hits.is_empty(),
        "evenodd leaves the center as a hole"
    );
}

#[test]
fn compile_paint_fill_rule_reaches_boolean_stroke_projection() {
    let compound_path = GeometryNode::Path {
        node_id: None,
        d: "M20 20H180V180H20Z M60 60H140V140H60Z".into(),
        fill_rule: None,
    };
    let doc = GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        root: GeometryNode::Transform {
            node_id: None,
            transform: Transform2D::default(),
            child: Box::new(GeometryNode::Group {
                node_id: None,
                children: vec![GeometryNode::Boolean {
                    node_id: None,
                    op: boundshape::BooleanOp::Intersect,
                    children: vec![
                        compound_path,
                        GeometryNode::Path {
                            node_id: None,
                            d: "M0 0H200V200H0Z".into(),
                            fill_rule: None,
                        },
                    ],
                }],
            }),
        },
    };
    let options = CompileGeometryOptions {
        paint: Some(GeometryPaint {
            fill_rule: Some("evenodd".into()),
            stroke: Some("#000".into()),
            ..GeometryPaint::default()
        }),
        ..CompileGeometryOptions::default()
    };
    let parts = compile_geometry_paths(&doc, Some(&options)).expect("evenodd boolean");
    assert_eq!(
        parts[0].d.matches('M').count(),
        2,
        "fill keeps the inner hole"
    );
    let stroke_path = parts[0].stroke_d.as_deref().unwrap_or(&parts[0].d);
    assert_eq!(
        stroke_path.matches('M').count(),
        2,
        "stroke projection must use the same evenodd operand geometry"
    );
}

#[test]
fn a_boolean_strokes_its_result() {
    // Two overlapping squares unioned: the stroke is the union outline, not the
    // two input outlines — the seam the union removed must not be drawn.
    let doc = GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        root: GeometryNode::Boolean {
            node_id: None,
            op: boundshape::BooleanOp::Union,
            children: vec![
                GeometryNode::Path {
                    node_id: None,
                    d: "M20 20H120V120H20Z".into(),
                    fill_rule: None,
                },
                GeometryNode::Path {
                    node_id: None,
                    d: "M80 80H180V180H80Z".into(),
                    fill_rule: None,
                },
            ],
        },
    };
    let parts =
        compile_geometry_paths(&doc, Some(&CompileGeometryOptions::default())).expect("union");
    assert_eq!(parts.len(), 1);
    assert!(
        parts[0].stroke_d.is_none(),
        "a boolean result already is its own outline, got {:?}",
        parts[0].stroke_d
    );
}

#[test]
fn boolean_inputs_use_the_implicitly_closed_fill_projection() {
    let boolean_doc = |left: &str| GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        root: GeometryNode::Boolean {
            node_id: None,
            op: boundshape::BooleanOp::Intersect,
            children: vec![
                GeometryNode::Path {
                    node_id: None,
                    d: left.into(),
                    fill_rule: None,
                },
                GeometryNode::Path {
                    node_id: None,
                    d: "M80 80H180V180H80Z".into(),
                    fill_rule: None,
                },
            ],
        },
    };
    let open = evaluate_geometry(&boolean_doc("M20 20H120V120H20")).expect("open operand");
    let closed = evaluate_geometry(&boolean_doc("M20 20H120V120H20Z")).expect("closed operand");
    assert_eq!(region_to_path(&open), region_to_path(&closed));
}

#[test]
fn randomized_nested_transforms_match_whole_and_part_evaluation() {
    let mut state = 0x6d2b_79f5_u64;
    let mut next = || {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        let unit = ((state >> 11) as f64) / ((1_u64 << 53) as f64);
        unit * 2.0 - 1.0
    };

    for case_index in 0..128 {
        let mut root = GeometryNode::Path {
            node_id: Some("wire".into()),
            d: "M20 20L160 35L80 170".into(),
            fill_rule: None,
        };
        for _ in 0..5 {
            root = GeometryNode::Transform {
                node_id: None,
                transform: Transform2D {
                    translate_x: Some(next() * 40.0),
                    translate_y: Some(next() * 40.0),
                    scale_x: Some(next().mul_add(1.5, 0.25)),
                    scale_y: Some(next().mul_add(1.5, 0.25)),
                    rotate_deg: Some(next() * 180.0),
                    origin_x: Some(next() * 100.0),
                    origin_y: Some(next() * 100.0),
                },
                child: Box::new(root),
            };
        }
        let doc = GeometryDoc {
            view_box: GeometryViewBox {
                x: -400.0,
                y: -400.0,
                width: 800.0,
                height: 800.0,
            },
            root,
        };

        let whole = evaluate_geometry(&doc).expect("whole nested transform");
        let parts = evaluate_geometry_parts(&doc).expect("part nested transform");
        assert_eq!(parts.len(), 1, "case {case_index}");
        assert_eq!(
            parts[0].region, whole,
            "fill transform mismatch in case {case_index}"
        );

        let fused = compile_geometry_paths(
            &doc,
            Some(&CompileGeometryOptions {
                paint: Some(GeometryPaint {
                    fill: Some("none".into()),
                    stroke: Some("#000".into()),
                    stroke_width: Some(4.0),
                    ..GeometryPaint::default()
                }),
                ..CompileGeometryOptions::default()
            }),
        )
        .expect("fused compile");
        let split = compile_geometry_paths(
            &doc,
            Some(&CompileGeometryOptions {
                paint: Some(GeometryPaint {
                    fill: Some("none".into()),
                    stroke: Some("#000".into()),
                    stroke_width: Some(4.0),
                    ..GeometryPaint::default()
                }),
                part_ids: true,
                ..CompileGeometryOptions::default()
            }),
        )
        .expect("split compile");
        assert_eq!(
            fused[0].d, split[0].d,
            "fill bake mismatch in case {case_index}"
        );
        assert_eq!(
            fused[0].stroke_d, split[0].stroke_d,
            "stroke bake mismatch in case {case_index}"
        );
    }
}
