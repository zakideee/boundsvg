//! Shape paint attribute strings.
//!
//! The attribute strings are built here (not in the emitter) because the
//! shared-shape-path dedup key is defined over the exact attribute bytes.

use crate::error::EngineError;
use crate::ir::types::{IrFillRule, IrNodeKind, ShapePartPaint, StrokeLinecap, StrokeLinejoin};
use crate::svg_emit::num_format::format_number;
use crate::svg_emit::xml::escape_xml;

/// Which side of a split shape part the attributes are for.
/// `All` keeps fill and stroke on one path (every non-split part).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShapePaintMode {
    All,
    Fill,
    Stroke,
}

/// Node-level shape paint fields (the TS emitter reads them off `IRNode`).
/// Stroke style fields are kept as wire strings so part overrides (already
/// strings) and node enums merge exactly like the TS `??` chains.
#[derive(Debug, Clone, Default)]
pub struct ShapePaintNode {
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub stroke_width: Option<f64>,
    pub fill_rule: Option<&'static str>,
    pub stroke_linecap: Option<&'static str>,
    pub stroke_linejoin: Option<&'static str>,
    pub stroke_dasharray: Option<String>,
    pub stroke_miterlimit: Option<f64>,
}

impl ShapePaintNode {
    /// Extract the paint fields from a `Shape` IR node kind.
    #[must_use]
    pub fn from_shape_kind(kind: &IrNodeKind) -> ShapePaintNode {
        let IrNodeKind::Shape {
            fill,
            stroke,
            stroke_width,
            fill_rule,
            stroke_linecap,
            stroke_linejoin,
            stroke_dasharray,
            stroke_miterlimit,
            ..
        } = kind
        else {
            return ShapePaintNode::default();
        };
        ShapePaintNode {
            fill: fill.clone(),
            stroke: stroke.clone(),
            stroke_width: *stroke_width,
            fill_rule: fill_rule.map(fill_rule_str),
            stroke_linecap: stroke_linecap.map(linecap_str),
            stroke_linejoin: stroke_linejoin.map(linejoin_str),
            stroke_dasharray: stroke_dasharray.clone(),
            stroke_miterlimit: *stroke_miterlimit,
        }
    }
}

fn fill_rule_str(rule: IrFillRule) -> &'static str {
    match rule {
        IrFillRule::Nonzero => "nonzero",
        IrFillRule::Evenodd => "evenodd",
    }
}

/// Wire string of a stroke linecap (serde `lowercase` rename).
#[must_use]
pub fn linecap_str(cap: StrokeLinecap) -> &'static str {
    match cap {
        StrokeLinecap::Butt => "butt",
        StrokeLinecap::Round => "round",
        StrokeLinecap::Square => "square",
    }
}

/// Wire string of a stroke linejoin (serde `lowercase` rename).
#[must_use]
pub fn linejoin_str(join: StrokeLinejoin) -> &'static str {
    match join {
        StrokeLinejoin::Miter => "miter",
        StrokeLinejoin::Round => "round",
        StrokeLinejoin::Bevel => "bevel",
    }
}

/// Stroke style fields after the override/node merge, as wire strings.
pub struct StrokeStyleFields<'a> {
    pub linecap: Option<&'a str>,
    pub linejoin: Option<&'a str>,
    pub dasharray: Option<&'a str>,
    pub miterlimit: Option<f64>,
}

/// Append stroke-linecap / stroke-linejoin / stroke-dasharray /
/// stroke-miterlimit if set. Mirrors TS `emitStrokeStyleAttrs`, including
/// its quirks: cap/join values are emitted unescaped, empty strings are
/// falsy, and default values (`butt` / `miter` / miterlimit 4) are omitted.
///
/// # Errors
///
/// Returns `EngineError::Validation` for a non-finite miterlimit.
pub fn append_stroke_style_attrs(
    style: &StrokeStyleFields,
    attrs: &mut Vec<String>,
) -> Result<(), EngineError> {
    if let Some(linecap) = style.linecap {
        if !linecap.is_empty() && linecap != "butt" {
            attrs.push(format!("stroke-linecap=\"{}\"", escape_xml(linecap)));
        }
    }
    if let Some(linejoin) = style.linejoin {
        if !linejoin.is_empty() && linejoin != "miter" {
            attrs.push(format!("stroke-linejoin=\"{}\"", escape_xml(linejoin)));
        }
    }
    if let Some(dasharray) = style.dasharray {
        if !dasharray.is_empty() {
            attrs.push(format!("stroke-dasharray=\"{}\"", escape_xml(dasharray)));
        }
    }
    if let Some(miterlimit) = style.miterlimit {
        if miterlimit != 4.0 {
            attrs.push(format!(
                "stroke-miterlimit=\"{}\"",
                format_number(miterlimit, 2)?
            ));
        }
    }
    Ok(())
}

/// Paint attributes for one shape part. Part overrides merge over the node
/// paint — unset fields inherit.
///
/// # Errors
///
/// Returns `EngineError::Validation` for non-finite numeric paint values.
pub fn build_shape_paint_attrs(
    node: &ShapePaintNode,
    part_override: Option<&ShapePartPaint>,
    mode: ShapePaintMode,
) -> Result<Vec<String>, EngineError> {
    let fill = if mode == ShapePaintMode::Stroke {
        None
    } else {
        part_override
            .and_then(|paint| paint.fill.as_deref())
            .or(node.fill.as_deref())
    };
    let stroke = if mode == ShapePaintMode::Fill {
        None
    } else {
        part_override
            .and_then(|paint| paint.stroke.as_deref())
            .or(node.stroke.as_deref())
    };
    let stroke_width = part_override
        .and_then(|paint| paint.stroke_width)
        .or(node.stroke_width);

    // JS truthiness: empty strings do not count as paint.
    let fill_is_set = fill.is_some_and(|value| !value.is_empty());
    let stroke_is_set = stroke.is_some_and(|value| !value.is_empty());

    let mut attrs: Vec<String> = Vec::new();
    if fill_is_set {
        if let Some(fill_value) = fill {
            attrs.push(format!("fill=\"{}\"", escape_xml(fill_value)));
        }
    } else if stroke_is_set || mode == ShapePaintMode::Stroke {
        attrs.push("fill=\"none\"".to_string());
    }
    if mode != ShapePaintMode::Stroke {
        if let Some(fill_rule) = node.fill_rule {
            if fill_rule != "nonzero" {
                attrs.push(format!("fill-rule=\"{}\"", escape_xml(fill_rule)));
            }
        }
    }
    if stroke_is_set {
        if let Some(stroke_value) = stroke {
            attrs.push(format!("stroke=\"{}\"", escape_xml(stroke_value)));
        }
        if let Some(width) = stroke_width {
            attrs.push(format!("stroke-width=\"{}\"", format_number(width, 2)?));
        }
        let merged_dasharray = part_override
            .and_then(|paint| paint.stroke_dasharray.as_deref())
            .or(node.stroke_dasharray.as_deref());
        append_stroke_style_attrs(
            &StrokeStyleFields {
                linecap: part_override
                    .and_then(|paint| paint.stroke_linecap.as_deref())
                    .or(node.stroke_linecap),
                linejoin: part_override
                    .and_then(|paint| paint.stroke_linejoin.as_deref())
                    .or(node.stroke_linejoin),
                dasharray: merged_dasharray,
                miterlimit: part_override
                    .and_then(|paint| paint.stroke_miterlimit)
                    .or(node.stroke_miterlimit),
            },
            &mut attrs,
        )?;
    }
    Ok(attrs)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn node_with(fill: Option<&str>, stroke: Option<&str>) -> ShapePaintNode {
        ShapePaintNode {
            fill: fill.map(str::to_string),
            stroke: stroke.map(str::to_string),
            ..ShapePaintNode::default()
        }
    }

    #[test]
    fn fill_wins_over_stroke_none_fallback() {
        let attrs =
            build_shape_paint_attrs(&node_with(Some("#f00"), None), None, ShapePaintMode::All)
                .expect("attrs");
        assert_eq!(attrs, vec!["fill=\"#f00\""]);
    }

    #[test]
    fn stroke_only_gets_fill_none() {
        let node = ShapePaintNode {
            stroke: Some("#333".to_string()),
            stroke_width: Some(3.0),
            ..ShapePaintNode::default()
        };
        let attrs = build_shape_paint_attrs(&node, None, ShapePaintMode::All).expect("attrs");
        assert_eq!(
            attrs,
            vec!["fill=\"none\"", "stroke=\"#333\"", "stroke-width=\"3\""]
        );
    }

    #[test]
    fn stroke_mode_always_emits_fill_none() {
        let attrs =
            build_shape_paint_attrs(&node_with(Some("#f00"), None), None, ShapePaintMode::Stroke)
                .expect("attrs");
        assert_eq!(attrs, vec!["fill=\"none\""]);
    }

    #[test]
    fn default_stroke_style_values_are_omitted() {
        let mut attrs: Vec<String> = Vec::new();
        append_stroke_style_attrs(
            &StrokeStyleFields {
                linecap: Some("butt"),
                linejoin: Some("miter"),
                dasharray: Some(""),
                miterlimit: Some(4.0),
            },
            &mut attrs,
        )
        .expect("attrs");
        assert!(attrs.is_empty());
    }
}
