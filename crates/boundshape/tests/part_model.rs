//! Part-model contract tests (attribution rules):
//! group/transform are transparent containers, boolean fuses its children
//! into a single part, part ids come from `node_id` or positional fallback.

use boundshape::{
    BooleanOp, CompileGeometryOptions, GeometryDoc, GeometryNode, GeometryViewBox, Transform2D,
    compile_geometry_to_svg_document, evaluate_geometry, evaluate_geometry_parts,
};

fn path(node_id: Option<&str>, d: &str) -> GeometryNode {
    GeometryNode::Path {
        node_id: node_id.map(str::to_owned),
        d: d.to_owned(),
        fill_rule: None,
    }
}

fn doc(root: GeometryNode) -> GeometryDoc {
    GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 300.0,
            height: 200.0,
        },
        root,
    }
}

fn badge_doc() -> GeometryDoc {
    // group[ path#bg, boolean#ribbon(union of two rects), unnamed path ]
    doc(GeometryNode::Group {
        node_id: Some("badge".into()),
        children: vec![
            path(Some("bg"), "M0 0H300V200H0Z"),
            GeometryNode::Boolean {
                node_id: Some("ribbon".into()),
                op: BooleanOp::Union,
                children: vec![
                    path(Some("ribbon-left"), "M20 80H160V120H20Z"),
                    path(Some("ribbon-right"), "M140 80H280V120H140Z"),
                ],
            },
            path(None, "M250 20H290V60H250Z"),
        ],
    })
}

#[test]
fn group_children_stay_addressable_and_boolean_fuses() {
    let parts = evaluate_geometry_parts(&badge_doc()).expect("parts should evaluate");
    let ids: Vec<&str> = parts.iter().map(|p| p.part_id.as_str()).collect();
    assert_eq!(ids, vec!["bg", "ribbon", "part:2"]);

    // the fused ribbon is one region spanning both rects
    let ribbon = &parts[1];
    let bounds = ribbon.bounds.expect("ribbon bounds");
    assert!((bounds.x - 20.0).abs() < 1e-6);
    assert!((bounds.width - 260.0).abs() < 1e-6);
    assert!((bounds.y - 80.0).abs() < 1e-6);
    assert!((bounds.height - 40.0).abs() < 1e-6);
    // union fused into a single contour: children are not addressable
    assert_eq!(ribbon.region.contours.len(), 1);
}

#[test]
fn ancestor_transforms_bake_into_part_regions() {
    let translated = doc(GeometryNode::Transform {
        node_id: None,
        transform: Transform2D {
            translate_x: Some(50.0),
            translate_y: Some(10.0),
            ..Default::default()
        },
        child: Box::new(path(Some("inner"), "M0 0H100V100H0Z")),
    });
    let parts = evaluate_geometry_parts(&translated).expect("parts should evaluate");
    assert_eq!(parts.len(), 1);
    let bounds = parts[0].bounds.expect("bounds");
    assert!((bounds.x - 50.0).abs() < 1e-6);
    assert!((bounds.y - 10.0).abs() < 1e-6);
}

#[test]
fn parts_cover_the_same_area_as_whole_document_evaluation() {
    let geometry = badge_doc();
    let whole = evaluate_geometry(&geometry).expect("whole evaluation");
    let parts = evaluate_geometry_parts(&geometry).expect("part evaluation");
    let part_contours: usize = parts.iter().map(|p| p.region.contours.len()).sum();
    // no merging across part boundaries: contour counts add up
    assert_eq!(part_contours, whole.region_len());
}

trait RegionLen {
    fn region_len(&self) -> usize;
}
impl RegionLen for boundshape::Region {
    fn region_len(&self) -> usize {
        self.contours.len()
    }
}

#[test]
fn empty_group_yields_no_parts() {
    let parts = evaluate_geometry_parts(&doc(GeometryNode::Group {
        node_id: None,
        children: vec![],
    }))
    .expect("empty group evaluates");
    assert!(parts.is_empty());
}

#[test]
fn compile_with_part_ids_emits_one_path_per_part() {
    let svg = compile_geometry_to_svg_document(
        &badge_doc(),
        Some(&CompileGeometryOptions {
            part_ids: true,
            ..CompileGeometryOptions::default()
        }),
    )
    .expect("part-id compile should succeed");
    assert_eq!(svg.matches("<path ").count(), 3);
    assert!(svg.contains("data-boundsvg-part-id=\"bg\""));
    assert!(svg.contains("data-boundsvg-part-id=\"ribbon\""));
    assert!(svg.contains("data-boundsvg-part-id=\"part:2\""));
}

#[test]
fn compile_without_part_ids_is_unchanged_single_path() {
    let svg = compile_geometry_to_svg_document(&badge_doc(), None)
        .expect("default compile should succeed");
    assert_eq!(svg.matches("<path ").count(), 1);
    assert!(!svg.contains("data-boundsvg-part-id"));
}

#[test]
fn compile_geometry_paths_matches_svg_document_output() {
    let doc = badge_doc();
    let options = boundshape::CompileGeometryOptions {
        part_ids: true,
        viewport: Some(boundshape::GeometryViewport {
            width: 600.0,
            height: 400.0,
        }),
        ..boundshape::CompileGeometryOptions::default()
    };
    let parts = boundshape::compile_geometry_paths(&doc, Some(&options)).expect("compile paths");
    let svg =
        boundshape::compile_geometry_to_svg_document(&doc, Some(&options)).expect("compile svg");

    assert_eq!(parts.len(), 3);
    for part in &parts {
        let part_id = part.part_id.as_deref().expect("part id present");
        assert!(!part.d.is_empty());
        // The SVG document embeds exactly this path data for this part.
        assert!(
            svg.contains(&format!(
                "data-boundsvg-part-id=\"{}\" d=\"{}\"",
                part_id, part.d
            )),
            "svg should embed the same baked path for {part_id}",
        );
        let bounds = part.bounds.expect("baked bounds");
        assert!(bounds.x >= 0.0 && bounds.x + bounds.width <= 600.0);
        assert!(bounds.y >= 0.0 && bounds.y + bounds.height <= 400.0);
    }

    // part_ids: false -> one fused entry with no part id.
    let fused_options = boundshape::CompileGeometryOptions {
        part_ids: false,
        ..options
    };
    let fused = boundshape::compile_geometry_paths(&doc, Some(&fused_options)).expect("fused");
    assert_eq!(fused.len(), 1);
    assert!(fused[0].part_id.is_none());
}

#[test]
fn hit_test_reports_parts_in_paint_order_with_stroke_priority() {
    let doc = badge_doc();
    // Inside bg only.
    let hits =
        boundshape::hit_test_geometry_parts(&doc, boundshape::Point2D { x: 200.0, y: 30.0 }, None)
            .expect("hit test");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].part_id, "bg");
    assert_eq!(hits[0].hit, boundshape::PartHitKind::Fill);

    // Inside bg AND the fused ribbon - both reported, topmost (ribbon) last.
    let hits =
        boundshape::hit_test_geometry_parts(&doc, boundshape::Point2D { x: 100.0, y: 100.0 }, None)
            .expect("hit test");
    assert_eq!(
        hits.iter().map(|h| h.part_id.as_str()).collect::<Vec<_>>(),
        vec!["bg", "ribbon"],
    );

    // On the ribbon's edge with a stroke band: stroke wins over fill.
    let hits = boundshape::hit_test_geometry_parts(
        &doc,
        boundshape::Point2D { x: 100.0, y: 80.5 },
        Some(&boundshape::HitTestOptions {
            stroke_width: Some(2.0),
            tolerance: None,
            fill_rule: None,
        }),
    )
    .expect("hit test");
    let ribbon = hits
        .iter()
        .find(|h| h.part_id == "ribbon")
        .expect("ribbon hit");
    assert_eq!(ribbon.hit, boundshape::PartHitKind::Stroke);

    // Far outside: nothing.
    let hits =
        boundshape::hit_test_geometry_parts(&doc, boundshape::Point2D { x: -50.0, y: -50.0 }, None)
            .expect("hit test");
    assert!(hits.is_empty());
}
