//! Container border normalization and outline validation at layout boundaries.

use serde::{Deserialize, Deserializer};

use super::types::{BorderRadiusInputValue, LayoutNodeInput};
use crate::error::EngineError;
use crate::ir::types::{StrokeLinecap, StrokeLinejoin, StrokeScaling};

/// Largest authored box border or outline length in px.
pub(crate) const BOX_LENGTH_MAX: f64 = 1_048_576.0;

/// Border widths normalized once for both Taffy and paint geometry.
#[derive(Debug, Clone, Copy)]
pub struct BorderWidths([f32; 4]);

impl BorderWidths {
    /// Return top, right, bottom, and left widths in Taffy's coordinate precision.
    pub fn widths(self) -> [f32; 4] {
        self.0
    }
}

impl<'de> Deserialize<'de> for BorderWidths {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum RawWidths {
            Uniform(f64),
            Edges([f64; 4]),
        }
        let widths = match RawWidths::deserialize(deserializer)? {
            RawWidths::Uniform(width) => [width; 4],
            RawWidths::Edges(widths) => widths,
        };
        if widths
            .iter()
            .any(|width| !width.is_finite() || !(0.0..=BOX_LENGTH_MAX).contains(width))
        {
            return Err(serde::de::Error::custom(
                "borderWidth must contain nonnegative finite widths at most 1048576",
            ));
        }
        Ok(Self(widths.map(|width| {
            // Admission above bounds the magnitude; f32 rounding is shared by layout and paint.
            #[allow(clippy::cast_possible_truncation)]
            let normalized = width as f32;
            if normalized == 0.0 { 0.0 } else { normalized }
        })))
    }
}

/// A single outer-contour line that never participates in layout sizing.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoxOutlineStyle {
    /// Solid stroke paint.
    pub stroke: String,
    /// Nonnegative width; omission means one px.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub stroke_width: Option<f64>,
    /// Width scaling behavior, shared with Path.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub stroke_scaling: Option<StrokeScaling>,
    /// Dash pattern in Path stroke syntax.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub stroke_dasharray: Option<String>,
    /// Endpoint shape of each dash.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub stroke_linecap: Option<StrokeLinecap>,
    /// Corner join shape.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub stroke_linejoin: Option<StrokeLinejoin>,
    /// Miter ratio; omission means four.
    #[serde(
        default,
        deserialize_with = "crate::wire::presence::deserialize_optional_non_null"
    )]
    pub stroke_miterlimit: Option<f64>,
}

fn invalid(node_id: &str, message: impl Into<String>) -> EngineError {
    EngineError::Structured {
        code: "VALIDATION".to_string(),
        message: message.into(),
        stage: Some(crate::diagnostics::PipelineStage::Validate),
        node_id: Some(node_id.to_string()),
    }
}

/// Reject removed container stroke fields and validate the normalized box input.
///
/// # Errors
///
/// Returns structured validation errors for invalid box geometry or outline fields.
pub(crate) fn validate_box_style(node: &LayoutNodeInput) -> Result<(), EngineError> {
    let Some(visual) = &node.visual else {
        return Ok(());
    };
    if let Some(transform) = &visual.transform
        && ([
            transform.translate_x,
            transform.translate_y,
            transform.rotate_deg,
            transform.origin_x,
            transform.origin_y,
            transform.scale_x,
            transform.scale_y,
        ]
        .into_iter()
        .flatten()
        .any(|channel| !channel.is_finite())
            || [transform.skew_x_deg, transform.skew_y_deg]
                .into_iter()
                .flatten()
                .any(|angle| !angle.is_finite() || angle.abs() > 60.0))
    {
        return Err(invalid(
            &node.node_id,
            "Authored transform channels must be finite; skew angles must be in -60..60.",
        ));
    }
    if !matches!(node.node_type.as_str(), "box" | "flex" | "grid") {
        return Ok(());
    }
    if visual.stroke_scaling.is_some()
        || visual.stroke_linecap.is_some()
        || visual.stroke_linejoin.is_some()
        || visual.stroke_dasharray.is_some()
        || visual.stroke_miterlimit.is_some()
    {
        return Err(invalid(
            &node.node_id,
            "Container stroke properties were removed; use outline or Path stroke styling.",
        ));
    }
    let has_border = visual
        .border_width
        .is_some_and(|widths| widths.widths().iter().any(|width| *width > 0.0));
    if has_border || visual.outline.is_some() {
        let radii = match visual.border_radius.as_ref() {
            None => [0.0; 4],
            Some(BorderRadiusInputValue::Uniform(radius)) => [*radius; 4],
            Some(BorderRadiusInputValue::PerCorner(radii)) => *radii,
        };
        if radii
            .iter()
            .any(|radius| !radius.is_finite() || *radius < 0.0)
        {
            return Err(invalid(
                &node.node_id,
                "Border and outline require nonnegative finite borderRadius.",
            ));
        }
    }
    if let Some(outline) = &visual.outline {
        let width = outline.stroke_width.unwrap_or(1.0);
        let miter = outline.stroke_miterlimit.unwrap_or(4.0);
        if !width.is_finite()
            || !(0.0..=BOX_LENGTH_MAX).contains(&width)
            || !miter.is_finite()
            || !(1.0..=BOX_LENGTH_MAX).contains(&miter)
        {
            return Err(invalid(
                &node.node_id,
                "outline strokeWidth must be in 0..1048576 and strokeMiterlimit in 1..1048576.",
            ));
        }
    }
    Ok(())
}

/// Check raw authored values before f32 decoding can round a domain violation away.
///
/// # Errors
///
/// Returns structured validation errors before layout starts.
pub(crate) fn validate_raw_box_tree(node: &serde_json::Value) -> Result<(), EngineError> {
    let node_id = node
        .get("nodeId")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("<node>");
    if let Some(transform) = node["visual"].get("transform") {
        let Some(channels) = transform.as_object() else {
            return Err(invalid(node_id, "transform must be an object."));
        };
        for (key, channel) in channels {
            let is_skew = matches!(key.as_str(), "skewXDeg" | "skewYDeg");
            if !matches!(
                key.as_str(),
                "translateX"
                    | "translateY"
                    | "rotateDeg"
                    | "originX"
                    | "originY"
                    | "scaleX"
                    | "scaleY"
                    | "skewXDeg"
                    | "skewYDeg"
            ) || channel
                .as_f64()
                .is_none_or(|number| !number.is_finite() || (is_skew && number.abs() > 60.0))
            {
                return Err(invalid(
                    node_id,
                    format!("Invalid authored transform channel {key}."),
                ));
            }
        }
    }
    if matches!(
        node.get("nodeType").and_then(serde_json::Value::as_str),
        Some("box" | "flex" | "grid")
    ) {
        let visual = &node["visual"];
        for key in [
            "strokeScaling",
            "strokeLinecap",
            "strokeLinejoin",
            "strokeDasharray",
            "strokeMiterlimit",
        ] {
            if visual.get(key).is_some() {
                return Err(invalid(
                    node_id,
                    format!("Container {key} was removed; use outline or Path stroke styling."),
                ));
            }
        }
        if let Some(border) = visual.get("borderWidth") {
            let values: Vec<&serde_json::Value> = match border {
                serde_json::Value::Number(_) => vec![border],
                serde_json::Value::Array(values) if values.len() == 4 => values.iter().collect(),
                _ => {
                    return Err(invalid(
                        node_id,
                        "borderWidth must be a number or four-element tuple.",
                    ));
                }
            };
            let mut has_border = false;
            for width in values {
                let Some(width) = width
                    .as_f64()
                    .filter(|width| width.is_finite() && (0.0..=BOX_LENGTH_MAX).contains(width))
                else {
                    return Err(invalid(
                        node_id,
                        "borderWidth must contain nonnegative finite widths at most 1048576.",
                    ));
                };
                // Round-to-even maps the half-minimum subnormal tie to zero.
                has_border |= width > f64::from(f32::from_bits(1)) * 0.5;
            }
            if has_border {
                for key in [
                    "width",
                    "height",
                    "minWidth",
                    "minHeight",
                    "maxWidth",
                    "maxHeight",
                    "padding",
                    "margin",
                    "gap",
                    "rowGap",
                    "columnGap",
                    "inset",
                    "flexBasis",
                ] {
                    if let Some(value) = node["style"].get(key) {
                        let scalars: Vec<&serde_json::Value> = value.as_array().map_or_else(
                            || vec![value],
                            |values| values.iter().filter(|value| !value.is_null()).collect(),
                        );
                        if scalars.iter().any(|scalar| {
                            scalar.as_f64().is_none_or(|length| {
                                !length.is_finite() || length.abs() > BOX_LENGTH_MAX
                            })
                        }) {
                            return Err(invalid(
                                node_id,
                                format!(
                                    "Border layout {key} must contain finite lengths with magnitude at most 1048576."
                                ),
                            ));
                        }
                    }
                }
            }
        }
        if let Some(outline) = visual.get("outline") {
            let Some(fields) = outline.as_object() else {
                return Err(invalid(node_id, "outline must be an object."));
            };
            if !fields
                .get("stroke")
                .is_some_and(serde_json::Value::is_string)
            {
                return Err(invalid(node_id, "outline.stroke must be a string."));
            }
            for (key, value) in fields {
                let valid = match key.as_str() {
                    "stroke" | "strokeDasharray" => value.is_string(),
                    "strokeWidth" => value.as_f64().is_some_and(|width| {
                        width.is_finite() && (0.0..=BOX_LENGTH_MAX).contains(&width)
                    }),
                    "strokeMiterlimit" => value.as_f64().is_some_and(|limit| {
                        limit.is_finite() && (1.0..=BOX_LENGTH_MAX).contains(&limit)
                    }),
                    "strokeScaling" => matches!(value.as_str(), Some("transform" | "canvas")),
                    "strokeLinecap" => matches!(value.as_str(), Some("butt" | "round" | "square")),
                    "strokeLinejoin" => matches!(value.as_str(), Some("miter" | "round" | "bevel")),
                    _ => false,
                };
                if !valid {
                    return Err(invalid(node_id, format!("Invalid outline field {key}.")));
                }
            }
        }
    }
    if let Some(children) = node.get("children").and_then(serde_json::Value::as_array) {
        for child in children {
            validate_raw_box_tree(child)?;
        }
    }
    Ok(())
}

/// Whether this layout tree needs box geometry checks before and after Taffy.
pub(crate) fn uses_box_geometry(node: &LayoutNodeInput) -> bool {
    fn has_skew(transform: &boundshape::Transform2D) -> bool {
        transform.skew_x_deg.unwrap_or(0.0) != 0.0 || transform.skew_y_deg.unwrap_or(0.0) != 0.0
    }
    fn geometry_has_skew(node: &boundshape::GeometryNode) -> bool {
        match node {
            boundshape::GeometryNode::Path { .. } => false,
            boundshape::GeometryNode::Transform {
                transform, child, ..
            } => has_skew(transform) || geometry_has_skew(child),
            boundshape::GeometryNode::Group { children, .. }
            | boundshape::GeometryNode::Boolean { children, .. } => {
                children.iter().any(geometry_has_skew)
            }
        }
    }
    fn track_has_skew(spec: &crate::ir::types::AnimationSpec) -> bool {
        spec.keyframes
            .iter()
            .filter_map(|frame| frame.transform.as_ref())
            .any(|transform| {
                transform.skew_x_deg.unwrap_or(0.0) != 0.0
                    || transform.skew_y_deg.unwrap_or(0.0) != 0.0
            })
    }
    node.visual.as_ref().is_some_and(|visual| {
        visual.outline.is_some()
            || visual
                .border_width
                .is_some_and(|widths| widths.widths().iter().any(|width| *width > 0.0))
    }) || node.visual.as_ref().is_some_and(|visual| {
        visual.transform.as_ref().is_some_and(has_skew)
            || visual.animation.as_ref().is_some_and(track_has_skew)
            || visual
                .unit_animation
                .as_ref()
                .is_some_and(|animation| track_has_skew(&animation.animation))
            || visual
                .shape_geometry
                .as_ref()
                .is_some_and(|geometry| geometry_has_skew(&geometry.root))
            || visual
                .symbol_definition
                .as_ref()
                .is_some_and(|definition| geometry_has_skew(&definition.geometry.root))
    }) || node.children.iter().any(uses_box_geometry)
}

/// Exclude non-finite f32 operands before the dependency sees a box-bearing scene.
///
/// # Errors
///
/// Returns structured validation errors for nonrepresentable layout operands.
pub(crate) fn validate_layout_operands(node: &LayoutNodeInput) -> Result<(), EngineError> {
    let style = &node.style;
    let scalars = [
        style.flex_grow,
        style.flex_shrink,
        style.flex_basis,
        style.gap,
        style.row_gap,
        style.column_gap,
        style.width,
        style.height,
        style.min_width,
        style.min_height,
        style.max_width,
        style.max_height,
        style.aspect_ratio,
    ];
    if scalars
        .into_iter()
        .flatten()
        .chain(style.padding.into_iter().flatten())
        .chain(style.margin.into_iter().flatten())
        .chain(style.inset.into_iter().flatten().flatten())
        .any(|scalar| !scalar.is_finite())
    {
        return Err(invalid(
            &node.node_id,
            "Box scenes require finite f32 layout operands before Taffy.",
        ));
    }
    for track in style
        .grid_template_columns
        .iter()
        .flatten()
        .chain(style.grid_template_rows.iter().flatten())
    {
        let trimmed = track.trim();
        let numeric = trimmed
            .strip_suffix("px")
            .or_else(|| trimmed.strip_suffix("fr"))
            .unwrap_or(trimmed)
            .trim();
        if numeric
            .parse::<f32>()
            .is_ok_and(|number| !number.is_finite())
        {
            return Err(invalid(
                &node.node_id,
                "Box scenes require finite f32 grid tracks.",
            ));
        }
    }
    for child in &node.children {
        validate_layout_operands(child)?;
    }
    Ok(())
}

/// Verify dependency results before they become box paint coordinates.
///
/// # Errors
///
/// Returns structured validation errors for non-finite layout or oversized box edges.
pub(crate) fn validate_layout_results(
    root: &LayoutNodeInput,
    output: &[super::types::LayoutNodeOutput],
) -> Result<(), EngineError> {
    fn collect<'a>(node: &'a LayoutNodeInput, boxes: &mut std::collections::HashSet<&'a str>) {
        if node.visual.as_ref().is_some_and(|visual| {
            visual.outline.is_some()
                || visual
                    .border_width
                    .is_some_and(|widths| widths.widths().iter().any(|width| *width > 0.0))
        }) {
            boxes.insert(&node.node_id);
        }
        for child in &node.children {
            collect(child, boxes);
        }
    }
    let mut boxes = std::collections::HashSet::new();
    collect(root, &mut boxes);
    for node in output {
        let coordinates = [
            f64::from(node.x),
            f64::from(node.y),
            f64::from(node.width),
            f64::from(node.height),
            f64::from(node.x) + f64::from(node.width),
            f64::from(node.y) + f64::from(node.height),
        ];
        if coordinates.iter().any(|coordinate| !coordinate.is_finite()) {
            return Err(invalid(
                &node.node_id,
                "Box scene layout returned non-finite geometry.",
            ));
        }
        if boxes.contains(node.node_id.as_str())
            && coordinates
                .iter()
                .any(|coordinate| coordinate.abs() > 67_108_864.0)
        {
            return Err(invalid(
                &node.node_id,
                "Box outer edges must have magnitude at most 67108864.",
            ));
        }
    }
    Ok(())
}
