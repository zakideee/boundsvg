//! `S`/`s` and `T`/`t` are SVG path commands. The parser rejected them with
//! `UnsupportedPathCommand`, so a `Shape` whose geometry used a smooth curve —
//! what most editors emit — threw instead of rendering, even though the
//! rasterizer downstream handles them fine.
//!
//! A smooth command reflects the previous control point through the current
//! point; with no previous curve of the matching kind, the control point is the
//! current point. These tests pin that against the explicit form.

// Integration tests always build with `cfg(test)`; declaring it lets clippy's
// `allow-*-in-tests` config apply to helper functions in this file.
#![cfg(test)]

use boundshape::{
    GeometryDoc, GeometryNode, GeometryViewBox, ShapeError, evaluate_geometry, region_to_path,
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

fn compiled(d: &str) -> String {
    region_to_path(&evaluate_geometry(&path_doc(d)).expect(d)).expect("serialize region")
}

#[test]
fn smooth_cubic_reflects_the_previous_control_point() {
    // S reflects (60,10) through (80,20) -> (100,30).
    let smooth = compiled("M20 20C40 10 60 10 80 20S140 60 160 20Z");
    let explicit = compiled("M20 20C40 10 60 10 80 20C100 30 140 60 160 20Z");
    assert_eq!(smooth, explicit);
}

#[test]
fn smooth_quadratic_reflects_the_previous_control_point() {
    // T reflects (60,10) through (100,50) -> (140,90).
    let smooth = compiled("M20 50Q60 10 100 50T180 50Z");
    let explicit = compiled("M20 50Q60 10 100 50Q140 90 180 50Z");
    assert_eq!(smooth, explicit);
}

#[test]
fn a_smooth_command_with_no_previous_curve_uses_the_current_point() {
    // With no preceding cubic, S's first control point collapses onto (20,20).
    let smooth = compiled("M20 20S100 80 160 20Z");
    let explicit = compiled("M20 20C20 20 100 80 160 20Z");
    assert_eq!(smooth, explicit);
}

#[test]
fn a_line_between_curves_resets_the_reflection() {
    // The L clears the previous control point, so S starts from (100,20) itself.
    let smooth = compiled("M20 20C40 10 60 10 80 20L100 20S140 60 160 20Z");
    let explicit = compiled("M20 20C40 10 60 10 80 20L100 20C100 20 140 60 160 20Z");
    assert_eq!(smooth, explicit);
}

#[test]
fn relative_smooth_commands_match_their_absolute_form() {
    let relative = compiled("M20 20c20 -10 40 -10 60 0s60 40 80 0Z");
    let absolute = compiled("M20 20C40 10 60 10 80 20S140 60 160 20Z");
    assert_eq!(relative, absolute);
}

#[test]
fn closepath_resets_reflection_at_the_subpath_start() {
    let smooth = compiled("M20 20C40 10 60 10 80 20Z S100 80 160 20Z");
    let explicit = compiled("M20 20C40 10 60 10 80 20Z C20 20 100 80 160 20Z");
    assert_eq!(smooth, explicit);
}

#[test]
fn explicit_curves_after_smooth_curves_replace_the_reflected_control() {
    let cubic =
        compiled("M10 100C20 20 40 20 50 100S80 180 90 100C100 20 120 20 130 100S160 180 170 100Z");
    let cubic_explicit = compiled(
        "M10 100C20 20 40 20 50 100C60 180 80 180 90 100C100 20 120 20 130 100C140 180 160 180 170 100Z",
    );
    assert_eq!(cubic, cubic_explicit);

    let quadratic = compiled("M10 100Q30 20 50 100T90 100Q110 20 130 100T170 100Z");
    let quadratic_explicit =
        compiled("M10 100Q30 20 50 100Q70 180 90 100Q110 20 130 100Q150 180 170 100Z");
    assert_eq!(quadratic, quadratic_explicit);
}

#[test]
fn repeated_relative_t_reflects_the_previous_reflection() {
    let smooth = compiled("M10 100q20 -80 40 0t40 0 40 0 40 0Z");
    let explicit = compiled("M10 100Q30 20 50 100Q70 180 90 100Q110 20 130 100Q150 180 170 100Z");
    assert_eq!(smooth, explicit);
}

#[test]
fn every_nonmatching_command_resets_reflection() {
    let cases = [
        (
            "M10 100C20 20 40 20 50 100A20 20 0 0 1 90 100S130 180 170 100Z",
            "M10 100C20 20 40 20 50 100A20 20 0 0 1 90 100C90 100 130 180 170 100Z",
        ),
        (
            "M10 100Q30 20 50 100H90T170 100Z",
            "M10 100Q30 20 50 100H90Q90 100 170 100Z",
        ),
        (
            "M10 100Q30 20 50 100V120T170 100Z",
            "M10 100Q30 20 50 100V120Q50 120 170 100Z",
        ),
        (
            "M10 100C20 20 40 20 50 100Z M90 100S130 180 170 100Z",
            "M10 100C20 20 40 20 50 100Z M90 100C90 100 130 180 170 100Z",
        ),
    ];
    for (smooth, explicit) in cases {
        assert_eq!(compiled(smooth), compiled(explicit));
    }
}

#[test]
fn extracted_cubic_and_quadratic_runs_preserve_repetition_and_errors() {
    assert_eq!(
        compiled("M10 100C20 20 40 20 50 100 60 180 80 180 90 100Z"),
        compiled("M10 100C20 20 40 20 50 100C60 180 80 180 90 100Z"),
    );
    assert_eq!(
        compiled("M10 100Q30 20 50 100 70 180 90 100Z"),
        compiled("M10 100Q30 20 50 100Q70 180 90 100Z"),
    );

    for malformed in [
        "M10 100C20Z",
        "M10 100C20 20Z",
        "M10 100C20 20 40 20Z",
        "M10 100Q20Z",
        "M10 100Q20 20Z",
        "M10 100S20 20Z",
        "M10 100T20Z",
    ] {
        assert_eq!(
            evaluate_geometry(&path_doc(malformed)),
            Err(ShapeError::InvalidPathData),
            "{malformed}",
        );
    }
}
