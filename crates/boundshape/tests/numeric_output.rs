//! Checked numeric serialization for public shape output.

use boundshape::{
    CompileGeometryOptions, Contour, CurveSegment, GeometryDoc, GeometryNode, GeometryViewBox,
    Point2D, Region, ShapeError, Transform2D, compile_geometry_paths, region_to_path,
    region_to_svg, transform_to_svg,
};

fn open_line(start: Point2D, end: Point2D) -> Region {
    Region {
        contours: vec![Contour {
            segments: vec![CurveSegment::Line { p0: start, p1: end }],
            closed: false,
        }],
    }
}

#[test]
fn finite_formatter_overflow_falls_back_to_the_original_value() {
    let region = open_line(
        Point2D { x: 0.0, y: 0.0 },
        Point2D {
            x: f64::MAX,
            y: 0.0,
        },
    );
    let path = region_to_path(&region).expect("finite path should serialize");

    assert_eq!(path, format!("M0,0L{},0", f64::MAX));
    assert!(!path.contains("inf"));
}

#[test]
fn path_and_native_svg_keep_their_distinct_negative_zero_bytes() {
    let region = open_line(Point2D { x: -0.0, y: -0.0 }, Point2D { x: -0.0, y: -0.0 });
    let options = CompileGeometryOptions {
        viewport: Some(boundshape::GeometryViewport {
            width: -0.0,
            height: 1.0,
        }),
        ..CompileGeometryOptions::default()
    };

    assert_eq!(region_to_path(&region).expect("serialize path"), "M0,0L0,0");
    assert_eq!(
        region_to_svg(&region, Some(&options)).expect("serialize SVG"),
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 -0 1\"><g><path d=\"M0,0L0,0\" /></g></svg>"
    );
}

#[test]
fn non_finite_path_svg_and_transform_values_fail() {
    let non_finite_region = open_line(
        Point2D { x: 0.0, y: 0.0 },
        Point2D {
            x: f64::INFINITY,
            y: 0.0,
        },
    );
    assert_eq!(
        region_to_path(&non_finite_region),
        Err(ShapeError::NonFiniteOutput)
    );
    assert_eq!(
        region_to_svg(&non_finite_region, None),
        Err(ShapeError::NonFiniteOutput)
    );
    assert_eq!(
        transform_to_svg(&Transform2D {
            translate_x: Some(f64::NEG_INFINITY),
            ..Transform2D::default()
        }),
        Err(ShapeError::NonFiniteOutput)
    );
}

#[test]
fn compiled_bounds_reject_finite_endpoint_subtraction_overflow() {
    let geometry = GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        },
        root: GeometryNode::Path {
            node_id: None,
            d: "M-1e308 0L1e308 0".to_string(),
            fill_rule: None,
        },
    };

    assert_eq!(
        compile_geometry_paths(&geometry, Some(&CompileGeometryOptions::default())),
        Err(ShapeError::NonFiniteOutput)
    );
}
