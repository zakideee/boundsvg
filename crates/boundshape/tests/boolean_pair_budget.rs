use boundshape::{
    BooleanOp, Contour, CurveSegment, GeometryDoc, GeometryNode, GeometryViewBox, Point2D, Region,
    RegionAxis, ShapeError, boolean_regions, boolean_regions_with_pair_budget,
    clip_monotonic_region_to_axis_interval, evaluate_geometry, region_axis_bounds, region_to_path,
};

fn rectangle(path_data: &str) -> Result<boundshape::Region, ShapeError> {
    evaluate_geometry(&GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 20.0,
            height: 10.0,
        },
        root: GeometryNode::Path {
            node_id: None,
            d: path_data.to_string(),
            fill_rule: None,
        },
    })
}

#[test]
fn boolean_pair_budget_accepts_boundary_and_rejects_boundary_minus_one() -> Result<(), ShapeError> {
    let left = rectangle("M0,0L10,0L10,10L0,10Z")?;
    let right = rectangle("M5,0L15,0L15,10L5,10Z")?;

    let mut boundary_minus_one = 15;
    assert_eq!(
        boolean_regions_with_pair_budget(
            &left,
            &right,
            BooleanOp::Intersect,
            &mut boundary_minus_one,
        ),
        Err(ShapeError::BooleanPairLimit)
    );

    let mut boundary = 16;
    let intersection =
        boolean_regions_with_pair_budget(&left, &right, BooleanOp::Intersect, &mut boundary)?;
    assert!(!intersection.contours.is_empty());
    assert_eq!(boundary, 0);

    let mut boundary_plus_one = 17;
    boolean_regions_with_pair_budget(&left, &right, BooleanOp::Intersect, &mut boundary_plus_one)?;
    assert_eq!(boundary_plus_one, 1);
    Ok(())
}

#[test]
fn region_axis_bounds_use_curve_extrema_instead_of_control_bounds() -> Result<(), ShapeError> {
    let region = Region {
        contours: vec![Contour {
            segments: vec![CurveSegment::Cubic {
                p0: Point2D { x: 0.0, y: 0.0 },
                p1: Point2D { x: 100.0, y: 100.0 },
                p2: Point2D {
                    x: -100.0,
                    y: 100.0,
                },
                p3: Point2D { x: 0.0, y: 0.0 },
            }],
            closed: false,
        }],
    };
    let Some((min_x, min_y, max_x, max_y)) = region_axis_bounds(&region) else {
        return Err(ShapeError::InvalidPathData);
    };

    assert!((min_x + 28.867_513_459_481_3).abs() < 1e-9);
    assert_eq!(min_y, 0.0);
    assert!((max_x - 28.867_513_459_481_3).abs() < 1e-9);
    assert!((max_y - 75.0).abs() < 1e-9);
    Ok(())
}

#[test]
fn monotonic_axis_clip_preserves_curves_and_canonicalizes_boundaries() -> Result<(), ShapeError> {
    let circle = rectangle(
        "M10,5C10,7.76 7.76,10 5,10C2.24,10 0,7.76 0,5C0,2.24 2.24,0 5,0C7.76,0 10,2.24 10,5Z",
    )?;
    let clipped = clip_monotonic_region_to_axis_interval(&circle, RegionAxis::X, 2.0, 8.0)?;
    let Some((min_x, _, max_x, _)) = region_axis_bounds(&clipped) else {
        return Err(ShapeError::InvalidPathData);
    };

    assert!((min_x - 2.0).abs() < 1e-9);
    assert!((max_x - 8.0).abs() < 1e-9);
    assert!(region_to_path(&clipped).contains('C'));
    Ok(())
}

#[test]
fn monotonic_axis_clip_rejects_a_non_monotonic_control_polygon() {
    let region = Region {
        contours: vec![Contour {
            segments: vec![CurveSegment::Cubic {
                p0: Point2D { x: 0.0, y: 0.0 },
                p1: Point2D { x: 10.0, y: 1.0 },
                p2: Point2D { x: -10.0, y: 2.0 },
                p3: Point2D { x: 0.0, y: 3.0 },
            }],
            closed: true,
        }],
    };

    assert_eq!(
        clip_monotonic_region_to_axis_interval(&region, RegionAxis::X, -1.0, 1.0),
        Err(ShapeError::RegionClipNonMonotonic)
    );
}

#[test]
fn intersect_handles_a_flattened_glyph_descender_near_the_clip_boundary() -> Result<(), ShapeError>
{
    let glyph = rectangle(
        "M9.55,38.55Q7.61,38.55 6.2,38.05Q4.78,37.56 3.84,36.75Q2.91,35.94 2.36,34.98L4.64,33.52Q5.02,34.02 5.57,34.62Q6.12,35.23 7.07,35.66Q8.02,36.09 9.55,36.09Q11.64,36.09 12.99,35.09Q14.34,34.09 14.34,31.94L14.34,28.44L14.08,28.44Q13.78,28.94 13.24,29.62Q12.7,30.31 11.7,30.84Q10.69,31.36 9,31.36Q6.91,31.36 5.23,30.37Q3.56,29.38 2.59,27.47Q1.62,25.56 1.62,22.83Q1.62,20.12 2.58,18.13Q3.53,16.14 5.21,15.05Q6.89,13.95 9.06,13.95Q10.75,13.95 11.76,14.51Q12.77,15.06 13.31,15.78Q13.86,16.5 14.16,16.97L14.42,16.97L14.42,14.17L17.16,14.17L17.16,32.09Q17.16,34.34 16.14,35.77Q15.12,37.2 13.4,37.88Q11.67,38.55 9.55,38.55ZM9.47,28.86Q11.06,28.86 12.16,28.13Q13.25,27.41 13.81,26.04Q14.38,24.67 14.38,22.77Q14.38,20.91 13.82,19.49Q13.27,18.08 12.17,17.27Q11.08,16.47 9.47,16.47Q7.81,16.47 6.7,17.32Q5.59,18.17 5.04,19.59Q4.48,21.02 4.48,22.77Q4.48,24.56 5.05,25.94Q5.61,27.31 6.72,28.09Q7.83,28.86 9.47,28.86Z",
    )?;
    let underline =
        rectangle("M1.6201,35.988125L17.1599,35.988125L17.1599,38.168125L1.6201,38.168125Z")?;

    let intersection = boolean_regions(&underline, &glyph, BooleanOp::Intersect)?;

    assert!(boundshape::region_has_positive_area(&intersection));
    Ok(())
}
