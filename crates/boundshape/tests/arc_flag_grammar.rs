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
            d: d.to_owned(),
            fill_rule: None,
        },
    }
}

#[test]
fn compact_arc_flags_and_coordinate_match_their_separated_form() {
    let compact = evaluate_geometry(&path_doc("M20 100A40 40 0 01120 100L120 180L20 180Z"))
        .expect("compact SVG arc flags should parse");
    let separated = evaluate_geometry(&path_doc("M20 100A40 40 0 0 1 120 100L120 180L20 180Z"))
        .expect("separated SVG arc flags should parse");
    assert_eq!(region_to_path(&compact), region_to_path(&separated));
}

#[test]
fn arc_flags_are_exactly_one_zero_or_one_character() {
    for invalid_flag in ["0.49", "0.0", "1.0", "2", "-0"] {
        let geometry = path_doc(&format!(
            "M20 100A40 40 0 {invalid_flag} 1 120 100L120 180L20 180Z"
        ));
        assert_eq!(
            evaluate_geometry(&geometry),
            Err(ShapeError::InvalidPathData),
            "flag={invalid_flag}",
        );
    }
}

#[test]
fn ordinary_leading_zero_coordinates_keep_their_numeric_meaning() {
    let leading_zero = evaluate_geometry(&path_doc("M020 020L0120 020L0120 0120L020 0120Z"))
        .expect("ordinary coordinates with leading zeroes should parse");
    let canonical = evaluate_geometry(&path_doc("M20 20L120 20L120 120L20 120Z"))
        .expect("canonical coordinates should parse");
    assert_eq!(region_to_path(&leading_zero), region_to_path(&canonical));
}
