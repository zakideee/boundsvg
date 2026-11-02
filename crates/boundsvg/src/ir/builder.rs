//! IR (Intermediate Representation) builder.
//!
//! Walks the layout input tree depth-first, pairs each node with its computed
//! layout output, and builds an `Ir` tree that the SVG/PNG emitter can
//! consume. Every filtering and defaulting rule here is part of the
//! serialized IR contract: outputs must stay deep-equal for the same
//! transport payload.
//!
//! Draw order: background → border surface → children (depth-first) → outline.

use std::collections::{HashMap, HashSet};

use boundshape::{
    CompileGeometryOptions, GeometryDoc, GeometryPaint, GeometryPreserveAspectRatio,
    GeometryViewport, SymbolResolutionOptions, Transform2D,
};

use super::gradient::{is_supported_gradient_function, resolve_gradient_for_box};
use super::ownership::{IrNodeOwnership, WrapperPlacement};
use super::svg_id_rewrite::rewrite_svg_ids;
use super::svg_security::unsafe_svg_reason;
use super::types::{
    BBox, BorderRadii, BorderRadius, BorderRadiusInput, BoxClip, BoxContour, HandlersRef, Ir,
    IrFillRule, IrNode, IrNodeKind, IrTextAlign, ShapePartBounds, ShapePartPaint, ShapePathPart,
    StrokeLinecap, StrokeLinejoin, TEXT_ANIMATION_FRAGMENT_WARNING_THRESHOLD,
    TEXT_ANIMATION_UNIT_WARNING_THRESHOLD, TextShadowLayer, TextStrokeLayer, parse_box_shadow,
    resolve_border_radius,
};
use crate::diagnostics::{PipelineStage, RecoverableCode, SerializedRecoverableError};
use crate::error::EngineError;
use crate::layout::types::{
    BorderRadiusInputValue, HandlersInput, LayoutNodeInput, LayoutNodeOutput, PartPaintMap,
    TextInput, TextLayoutOutput, TextPathInput, VisualInput,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Build a complete IR tree from the layout input tree and computed outputs.
///
/// # Errors
///
/// Returns `EngineError::Validation` for unsafe nested SVG content, shape
/// reference/part-id violations, and incomplete text layouts (matching the
/// TS `FatalError` paths).
/// Returns structured text-animation unit or fragment budget errors when
/// the scene exceeds the supported limits.
pub fn build_ir<S: std::hash::BuildHasher>(
    input_root: &LayoutNodeInput,
    outputs: &HashMap<String, LayoutNodeOutput, S>,
) -> Result<Ir, EngineError> {
    fn validate_input(node: &LayoutNodeInput) -> Result<(), EngineError> {
        crate::layout::box_style::validate_box_style(node)?;
        for child in &node.children {
            validate_input(child)?;
        }
        Ok(())
    }
    validate_input(input_root)?;
    let mut warnings: Vec<SerializedRecoverableError> = Vec::new();

    let mut root = build_node(input_root, outputs, &mut warnings)?;
    super::text_paint::resolve_text_paints(&mut root)?;
    let root_bbox = node_bbox(input_root, outputs);
    let debug = (input_root.node_type == "canvas"
        && input_root
            .visual
            .as_ref()
            .and_then(|visual| visual.debug)
            .unwrap_or(false))
    .then_some(true);

    append_text_animation_budget_warnings(&root, &mut warnings)?;

    let ir = Ir {
        root,

        width: root_bbox.w,
        height: root_bbox.h,
        debug,
        warnings,
    };
    let mut geometry_gains = HashMap::new();
    collect_geometry_gains(input_root, outputs, &mut geometry_gains)?;
    super::numeric_envelope::validate_with_geometry(&ir, &geometry_gains)?;
    Ok(ir)
}

fn collect_geometry_gains<S: std::hash::BuildHasher>(
    input: &LayoutNodeInput,
    outputs: &HashMap<String, LayoutNodeOutput, S>,
    gains: &mut HashMap<String, f64>,
) -> Result<(), EngineError> {
    if let Some(visual) = &input.visual {
        let geometry = visual.shape_geometry.as_ref().or_else(|| {
            visual
                .symbol_definition
                .as_ref()
                .map(|definition| &definition.geometry)
        });
        if let Some(geometry) = geometry
            && let Some(gain) = boundshape::validate_skew_geometry(geometry)
                .map_err(|error| EngineError::Validation(error.to_string()))?
        {
            let bbox = node_bbox(input, outputs);
            let viewport_gain = (bbox.w / geometry.view_box.width)
                .abs()
                .max((bbox.h / geometry.view_box.height).abs())
                .max(1.0);
            let combined = gain * viewport_gain;
            if !combined.is_finite() || combined > 65_536.0 {
                return Err(EngineError::Validation(
                    "Shape skew viewport gain exceeds 65536".to_string(),
                ));
            }
            gains.insert(input.node_id.clone(), combined);
        }
    }
    for child in &input.children {
        collect_geometry_gains(child, outputs, gains)?;
    }
    Ok(())
}

fn append_text_animation_budget_warnings(
    root: &IrNode,
    warnings: &mut Vec<SerializedRecoverableError>,
) -> Result<(), EngineError> {
    let (unit_count, fragment_count) = super::animation::text_animation_budget_counts(root);
    super::animation::validate_text_animation_budget_counts(unit_count, fragment_count)?;
    if unit_count > TEXT_ANIMATION_UNIT_WARNING_THRESHOLD {
        warnings.push(SerializedRecoverableError::recoverable(
            RecoverableCode::TextAnimationUnitCountHigh,
            format!("Text animation unit count is {unit_count}"),
            PipelineStage::Layout,
            None,
            "rendered without truncation",
        ));
    }
    if fragment_count > TEXT_ANIMATION_FRAGMENT_WARNING_THRESHOLD {
        warnings.push(SerializedRecoverableError::recoverable(
            RecoverableCode::TextAnimationFragmentCountHigh,
            format!("Text animation fragment estimate is {fragment_count}"),
            PipelineStage::Emit,
            None,
            "rendered without truncation",
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Wire number round-trip
// ---------------------------------------------------------------------------

/// Convert an f32 layout coordinate to the f64 the TS side observes.
///
/// The TS builder reads bboxes from the layout JSON, so its numbers are the
/// result of serializing the f32 and parsing the decimal as f64. Casting
/// alone can differ from that round-trip; going through the actual JSON
/// formatter guarantees the identical value.
fn wire_f64(value: f32) -> f64 {
    serde_json::to_string(&value)
        .ok()
        .and_then(|text| text.parse::<f64>().ok())
        .unwrap_or(f64::from(value))
}

fn node_bbox<S: std::hash::BuildHasher>(
    input: &LayoutNodeInput,
    outputs: &HashMap<String, LayoutNodeOutput, S>,
) -> BBox {
    outputs.get(&input.node_id).map_or(
        BBox {
            x: 0.0,
            y: 0.0,
            w: 0.0,
            h: 0.0,
        },
        |output| BBox {
            x: wire_f64(output.x),
            y: wire_f64(output.y),
            w: wire_f64(output.width),
            h: wire_f64(output.height),
        },
    )
}

// ---------------------------------------------------------------------------
// Recursive node builder
// ---------------------------------------------------------------------------

fn is_truthy(value: Option<&str>) -> bool {
    value.is_some_and(|text| !text.is_empty())
}

fn truthy_number(value: Option<f64>) -> Option<f64> {
    value.filter(|number| *number != 0.0 && !number.is_nan())
}

fn z_index_of(child: &LayoutNodeInput) -> f64 {
    child
        .visual
        .as_ref()
        .and_then(|visual| visual.z_index)
        .unwrap_or(0.0)
}

fn sort_children_by_z_index(children: &[LayoutNodeInput]) -> Vec<&LayoutNodeInput> {
    let mut sorted: Vec<&LayoutNodeInput> = children.iter().collect();
    sorted.sort_by(|left, right| {
        z_index_of(left)
            .partial_cmp(&z_index_of(right))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    sorted
}

fn to_border_radius_input(value: &BorderRadiusInputValue) -> BorderRadiusInput {
    match value {
        BorderRadiusInputValue::Uniform(radius) => BorderRadiusInput::Uniform(*radius),
        BorderRadiusInputValue::PerCorner([tl, tr, br, bl]) => {
            BorderRadiusInput::PerCorner(*tl, *tr, *br, *bl)
        }
    }
}

/// Mirror of the TS `hasTransform`: a transform paints only when it moves,
/// rotates, or scales (a declared rotate/scale counts even at identity).
fn has_transform(transform: &Transform2D) -> bool {
    transform.translate_x.unwrap_or(0.0) != 0.0
        || transform.translate_y.unwrap_or(0.0) != 0.0
        || transform.rotate_deg.is_some()
        || transform.skew_x_deg.unwrap_or(0.0) != 0.0
        || transform.skew_y_deg.unwrap_or(0.0) != 0.0
        || transform.scale_x.is_some()
        || transform.scale_y.is_some()
}

fn build_node<S: std::hash::BuildHasher>(
    input: &LayoutNodeInput,
    outputs: &HashMap<String, LayoutNodeOutput, S>,

    warnings: &mut Vec<SerializedRecoverableError>,
) -> Result<IrNode, EngineError> {
    let node_id = &input.node_id;
    let bbox = node_bbox(input, outputs);
    let empty_visual = VisualInput::default();
    let visual = input.visual.as_ref().unwrap_or(&empty_visual);

    let mut children: Vec<IrNode> = Vec::new();

    let border_radius = resolve_border_radius(
        visual
            .border_radius
            .as_ref()
            .map(to_border_radius_input)
            .as_ref(),
        bbox.w,
        bbox.h,
    );

    let outer = super::box_geometry::outer_contour(
        bbox,
        if input.node_type == "canvas" {
            None
        } else {
            border_radius
        },
    );
    let widths = visual.border_width.map_or(
        [0.0; 4],
        super::super::layout::box_style::BorderWidths::widths,
    );
    let has_border = widths.iter().any(|width| *width > 0.0);
    let inset = super::box_geometry::inset_clip(&outer, widths);

    // Background rect (solid color or gradient)
    if let Some(background) = visual.background.as_deref().filter(|text| !text.is_empty()) {
        let bg_node = build_background_rect(node_id, bbox, background, border_radius)?;
        children.push(bg_node);
    }

    if has_border
        && let Some(color) = visual
            .border_color
            .as_deref()
            .filter(|color| !color.is_empty())
    {
        children.push(build_border_surface(node_id, bbox, color, &outer, &inset)?);
    }
    let content_start = children.len();

    let handlers = collect_handlers(visual.handlers.as_ref());

    match input.node_type.as_str() {
        "text" | "textonpath" => {
            build_text_child(TextChildContext {
                node_type: input.node_type.as_str(),
                text_input: input.text.as_ref(),
                text_path_input: input.text_path.as_ref(),
                text_layout: outputs
                    .get(node_id)
                    .and_then(|output| output.text_layout.as_ref()),
                visual,
                node_id,
                bbox,

                children: &mut children,

                warnings,
            })?;
        }
        "image" => {
            build_image_child(visual, node_id, bbox, &mut children, warnings);
        }
        "path" => {
            build_path_child(visual, node_id, bbox, &mut children);
        }
        "svg" => {
            build_svg_child(visual, node_id, bbox, &mut children, warnings)?;
        }
        "shape" | "symbol" => {
            build_shape_child(&mut ShapeChildContext {
                is_symbol: input.node_type == "symbol",
                visual,
                node_id,
                bbox,

                children: &mut children,

                warnings,
            })?;
        }
        _ => {
            // Container nodes (canvas/flex/grid/box): recurse in sibling-local
            // zIndex paint order (stable; ties keep source order).
            for child_input in sort_children_by_z_index(&input.children) {
                let child_node = build_node(child_input, outputs, warnings)?;
                children.push(child_node);
            }
        }
    }

    let mut clip =
        (visual.overflow.as_deref() == Some("clip")).then(|| BoxClip::BoxContour(outer.clone()));
    if input.node_type == "image" && visual.border_radius.is_some() {
        clip = Some(BoxClip::BoxContour(outer.clone()));
    }
    if has_border && clip.is_some() && children.len() > content_start {
        let content = children.split_off(content_start);
        children.push(build_clip_group(
            node_id,
            format!("{node_id}:content"),
            bbox,
            content,
            inset,
        ));
    }
    if let Some(outline) = &visual.outline
        && outline.stroke_width.unwrap_or(1.0) > 0.0
        && !outline.stroke.is_empty()
    {
        children.push(build_outline_path(node_id, bbox, &outer, outline)?);
    }

    let opacity = visual.opacity.filter(|value| *value != 1.0);
    let box_shadow = visual.box_shadow.as_deref().and_then(parse_box_shadow);
    if let Some(meta) = &visual.meta {
        super::ownership::validate_source_meta(node_id, meta)?;
    }
    let meta = visual
        .meta
        .as_ref()
        .filter(|entries| !entries.is_empty())
        .cloned();
    let transform = visual
        .transform
        .as_ref()
        .filter(|value| has_transform(value))
        .cloned();

    Ok(IrNode {
        ownership: IrNodeOwnership::Source {
            on: handlers.map(Box::new),
            meta,
        },
        node_id: node_id.clone(),
        bbox,
        kind: IrNodeKind::Group {
            children,
            clip,
            opacity,
            box_shadow,

            transform,
            animation: visual.animation.clone(),
        },
    })
}

// ---------------------------------------------------------------------------
// Background, border surface, and outline builders
// ---------------------------------------------------------------------------

fn build_background_rect(
    node_id: &str,
    bbox: BBox,
    background: &str,
    border_radius: Option<BorderRadius>,
) -> Result<IrNode, EngineError> {
    let gradient = resolve_gradient_for_box(background, bbox.w, bbox.h);
    if gradient.is_none() && is_supported_gradient_function(background) {
        return Err(EngineError::Structured {
            code: "VALIDATION".to_string(),
            message: format!(
                "Validation error: unsupported or invalid gradient syntax: {background}"
            ),
            stage: Some(crate::diagnostics::PipelineStage::Ir),
            node_id: Some(node_id.to_string()),
        });
    }
    let fill = if gradient.is_none() {
        Some(background.to_string())
    } else {
        None
    };

    Ok(IrNode {
        ownership: IrNodeOwnership::Decoration {
            owner_node_id: node_id.to_string(),
        },
        node_id: format!("{node_id}:bg"),
        bbox,
        kind: IrNodeKind::Rect {
            fill,
            gradient,
            stroke: None,
            stroke_width: None,
            stroke_scaling: None,
            border_radius,
            stroke_linecap: None,
            stroke_linejoin: None,
            stroke_dasharray: None,
            stroke_miterlimit: None,
        },
    })
}

/// Keep generated clipping groups free of source transforms and compositing effects.
fn build_clip_group(
    owner_node_id: &str,
    node_id: String,
    bbox: BBox,
    children: Vec<IrNode>,
    clip: BoxClip,
) -> IrNode {
    IrNode {
        ownership: IrNodeOwnership::Wrapper {
            owner_node_id: owner_node_id.to_string(),
            placement: WrapperPlacement::Inner,
        },
        node_id,
        bbox,
        kind: IrNodeKind::Group {
            children,
            clip: Some(clip),
            opacity: None,
            box_shadow: None,

            transform: None,
            animation: None,
        },
    }
}

fn build_border_surface(
    node_id: &str,
    bbox: BBox,
    color: &str,
    outer: &BoxContour,
    inset: &BoxClip,
) -> Result<IrNode, EngineError> {
    let border_id = format!("{node_id}:border");
    let mut path_data =
        super::box_geometry::contour_path(&super::box_geometry::local_contour(outer, bbox))?;
    if let BoxClip::BoxContour(inner) = inset {
        path_data.push(' ');
        path_data.push_str(&super::box_geometry::contour_path(
            &super::box_geometry::local_contour(inner, bbox),
        )?);
    }
    let paint = IrNode {
        ownership: IrNodeOwnership::Decoration {
            owner_node_id: node_id.to_string(),
        },
        node_id: border_id.clone(),
        bbox,
        kind: IrNodeKind::Path {
            path_geometry: super::path_geometry::derive_path_geometry(
                &path_data, None, None, None, None, None, None,
            ),
            path_data,
            fill: Some(color.to_string()),
            stroke: None,
            stroke_width: None,
            stroke_scaling: None,
            fill_rule: Some(super::types::IrFillRule::Evenodd),
            stroke_linecap: None,
            stroke_linejoin: None,
            stroke_dasharray: None,
            stroke_miterlimit: None,
        },
    };
    // The inset candidate need not be contained by the outer contour.
    Ok(build_clip_group(
        node_id,
        border_id,
        bbox,
        vec![paint],
        BoxClip::BoxContour(outer.clone()),
    ))
}

fn build_outline_path(
    node_id: &str,
    bbox: BBox,
    outer: &BoxContour,
    outline: &crate::layout::box_style::BoxOutlineStyle,
) -> Result<IrNode, EngineError> {
    let path_data =
        super::box_geometry::contour_path(&super::box_geometry::local_contour(outer, bbox))?;
    let stroke_width = Some(outline.stroke_width.unwrap_or(1.0));
    Ok(IrNode {
        ownership: IrNodeOwnership::Decoration {
            owner_node_id: node_id.to_string(),
        },
        node_id: format!("{node_id}:outline"),
        bbox,
        kind: IrNodeKind::Path {
            path_geometry: super::path_geometry::derive_path_geometry(
                &path_data,
                Some(&outline.stroke),
                stroke_width,
                outline.stroke_scaling,
                outline.stroke_linecap,
                outline.stroke_linejoin,
                outline.stroke_miterlimit,
            ),
            path_data,
            fill: Some("none".to_string()),
            stroke: Some(outline.stroke.clone()),
            stroke_width,
            stroke_scaling: outline
                .stroke_scaling
                .filter(|scaling| matches!(scaling, super::types::StrokeScaling::Canvas)),
            fill_rule: None,
            stroke_linecap: outline.stroke_linecap,
            stroke_linejoin: outline.stroke_linejoin,
            stroke_dasharray: outline
                .stroke_dasharray
                .clone()
                .filter(|dash| !dash.is_empty()),
            stroke_miterlimit: outline.stroke_miterlimit,
        },
    })
}

// ---------------------------------------------------------------------------
// Text child builder
// ---------------------------------------------------------------------------

struct TextChildContext<'a> {
    node_type: &'a str,
    text_input: Option<&'a TextInput>,
    text_path_input: Option<&'a TextPathInput>,
    text_layout: Option<&'a TextLayoutOutput>,
    visual: &'a VisualInput,
    node_id: &'a str,
    bbox: BBox,

    children: &'a mut Vec<IrNode>,

    warnings: &'a mut Vec<SerializedRecoverableError>,
}

fn resolve_aligned_text_bbox(
    layout_box: BBox,
    measured: &crate::text::types::TextBBox,
    is_vertical: bool,
    text_align: IrTextAlign,
) -> BBox {
    let inline_available = if is_vertical {
        layout_box.h - measured.h
    } else {
        layout_box.w - measured.w
    };
    let inline_offset = match text_align {
        IrTextAlign::Center => inline_available / 2.0,
        IrTextAlign::End => inline_available,
        IrTextAlign::Start => 0.0,
    };
    BBox {
        x: if is_vertical {
            layout_box.x + layout_box.w - measured.w
        } else {
            layout_box.x + inline_offset
        },
        y: if is_vertical {
            layout_box.y + inline_offset
        } else {
            layout_box.y
        },
        w: measured.w,
        h: measured.h,
    }
}

fn append_text_warnings(context: &mut TextChildContext, layout: &TextLayoutOutput) {
    context.warnings.extend(layout.warnings.iter().cloned());

    if let Some(overflow) = &layout.overflow
        && overflow.overflow_type == "kinsoku_unresolved"
    {
        let node_id = context.node_id;
        let reason_suffix = overflow
            .reason
            .as_deref()
            .map(|reason| format!(" ({reason})"))
            .unwrap_or_default();
        context.warnings.push(SerializedRecoverableError::recoverable(
                RecoverableCode::KinsokuUnresolved,
                format!(
                    "Kinsoku line breaking could not be fully resolved for text node \"{node_id}\"; a forced break was used{reason_suffix}.",
                ),
                PipelineStage::Text,
                Some(node_id.to_string()),
                "forced-break",
            ));
    }
}

fn append_inline_box_decorations(
    context: &mut TextChildContext,
    layout: &TextLayoutOutput,
    placement: &super::text_placement::TextPlacement,
) {
    for (index, decoration) in layout.inline_box_decorations.iter().enumerate() {
        let has_background = is_truthy(decoration.background.as_deref());
        let has_border_color = is_truthy(decoration.border_color.as_deref());
        if !has_background && !has_border_color {
            continue;
        }
        let node_id = context.node_id;
        let decoration_id = format!("{node_id}:ibox{index}");
        let offset = placement.offsets[decoration.line_index as usize];
        let mut x = context.bbox.x + decoration.x;
        let mut y = context.bbox.y + decoration.y;
        if offset.x != 0.0 {
            x += offset.x;
        }
        if offset.y != 0.0 {
            y += offset.y;
        }
        let bbox = BBox {
            x,
            y,
            w: decoration.width,
            h: decoration.height,
        };
        let rect_kind = IrNodeKind::Rect {
            fill: decoration.background.clone(),
            gradient: None,
            stroke: decoration.border_color.clone(),
            stroke_width: if has_border_color {
                decoration.border_width
            } else {
                None
            },
            stroke_scaling: None,
            border_radius: decoration
                .border_radius
                .map(|[tl, tr, br, bl]| BorderRadius::PerCorner(BorderRadii { tl, tr, br, bl })),
            stroke_linecap: None,
            stroke_linejoin: None,
            stroke_dasharray: None,
            stroke_miterlimit: None,
        };
        let animation = decoration.span_key.as_deref().and_then(|span_key| {
            context
                .visual
                .inline_decoration_animations
                .as_ref()
                .and_then(|animations| animations.get(span_key))
                .cloned()
        });
        // Mirrors the inline-rect convention: an animated fragment wraps its
        // rect in a Group so the shared node-animation path applies.
        if let Some(animation) = animation {
            let rect_node_id = format!("{decoration_id}:rect");
            let rect_node = IrNode {
                ownership: IrNodeOwnership::Decoration {
                    owner_node_id: context.node_id.to_string(),
                },
                node_id: rect_node_id.clone(),
                bbox,
                kind: rect_kind,
            };
            context.children.push(IrNode {
                ownership: IrNodeOwnership::Wrapper {
                    owner_node_id: context.node_id.to_string(),
                    placement: WrapperPlacement::Inner,
                },
                node_id: decoration_id,
                bbox,
                kind: IrNodeKind::Group {
                    children: vec![rect_node],
                    clip: None,
                    opacity: None,
                    box_shadow: None,

                    transform: None,
                    animation: Some(animation),
                },
            });
        } else {
            context.children.push(IrNode {
                ownership: IrNodeOwnership::Decoration {
                    owner_node_id: context.node_id.to_string(),
                },
                node_id: decoration_id.clone(),
                bbox,
                kind: rect_kind,
            });
        }
    }
}

fn append_inline_rects(
    context: &mut TextChildContext,
    layout: &TextLayoutOutput,
    placement: &super::text_placement::TextPlacement,
    paint_order: &str,
) {
    for inline_rect in layout
        .inline_rects
        .iter()
        .filter(|inline_rect| inline_rect.paint_order == paint_order)
    {
        let offset = placement.offsets[inline_rect.line_index as usize];
        let mut x = context.bbox.x + inline_rect.x;
        let mut y = context.bbox.y + inline_rect.y;
        if offset.x != 0.0 {
            x += offset.x;
        }
        if offset.y != 0.0 {
            y += offset.y;
        }
        let bbox = BBox {
            x,
            y,
            w: inline_rect.width,
            h: inline_rect.height,
        };
        let rect_node_id = format!("{}:rect", inline_rect.fragment_id);
        let rect_node = IrNode {
            ownership: IrNodeOwnership::Decoration {
                owner_node_id: context.node_id.to_string(),
            },
            node_id: rect_node_id.clone(),
            bbox,
            kind: IrNodeKind::Rect {
                fill: Some(inline_rect.color.clone()),
                gradient: None,
                stroke: None,
                stroke_width: None,
                stroke_scaling: None,
                border_radius: resolve_border_radius(
                    Some(&BorderRadiusInput::Uniform(inline_rect.border_radius_px)),
                    bbox.w,
                    bbox.h,
                ),
                stroke_linecap: None,
                stroke_linejoin: None,
                stroke_dasharray: None,
                stroke_miterlimit: None,
            },
        };
        context.children.push(IrNode {
            ownership: IrNodeOwnership::Wrapper {
                owner_node_id: context.node_id.to_string(),
                placement: WrapperPlacement::Inner,
            },
            node_id: inline_rect.fragment_id.clone(),
            bbox,
            kind: IrNodeKind::Group {
                children: vec![rect_node],
                clip: None,
                opacity: (inline_rect.opacity != 1.0).then_some(inline_rect.opacity),
                box_shadow: None,

                transform: None,
                animation: context
                    .visual
                    .inline_rect_animations
                    .as_ref()
                    .and_then(|animations| animations.get(&inline_rect.fragment_id))
                    .cloned(),
            },
        });
    }
}

fn build_text_child(mut context: TextChildContext) -> Result<(), EngineError> {
    let Some(layout) = context.text_layout else {
        return Ok(());
    };

    let node_id = context.node_id.to_string();
    let (Some(mut lines), Some(measured_bbox), Some(chosen_font_size_px)) = (
        layout.lines.clone(),
        layout.bbox.as_ref(),
        layout.chosen_font_size_px,
    ) else {
        return Err(EngineError::Structured {
            code: "TEXT_LAYOUT_MISSING_FIELDS".to_string(),
            message: format!(
                "computeLayoutFn returned textLayout for node \"{node_id}\" without required resolved fields (lines, bbox, chosenFontSizePx). Custom computeLayoutFn implementations must include full text layout data.",
            ),
            stage: Some(crate::diagnostics::PipelineStage::Layout),
            node_id: Some(node_id.clone()),
        });
    };

    append_text_warnings(&mut context, layout);

    let visual = context.visual;
    let text_input = context.text_input;
    let text_path_input = context.text_path_input;
    let is_path = text_path_input.is_some();

    let is_vertical =
        text_input.and_then(|text| text.writing_mode.as_deref()) == Some("vertical-rl");
    let text_align = match visual.text_align.as_deref() {
        Some("center") => IrTextAlign::Center,
        Some("end") => IrTextAlign::End,
        _ => IrTextAlign::Start,
    };
    let placement = super::text_placement::resolve(super::text_placement::TextPlacementContext {
        node_id: &node_id,
        node_type: context.node_type,
        text_input,
        path_input: text_path_input,
        layout,
        lines: &lines,
        measured: measured_bbox,
        layout_box: context.bbox,
        align: text_align,
    })?;
    if matches!(
        placement.space,
        crate::text::types::TextPlacementSpace::BlockLocal { .. }
    ) {
        for (line, offset) in lines.iter_mut().zip(&placement.offsets) {
            if let Some(glyphs) = line.positioned_glyphs.as_mut() {
                for glyph in glyphs {
                    if offset.x != 0.0 {
                        glyph.origin_x += offset.x;
                    }
                    if offset.y != 0.0 {
                        glyph.origin_y += offset.y;
                    }
                }
            }
        }
    }
    let line_height_px = text_input
        .and_then(|text| text.line_height_px)
        .or_else(|| is_path.then_some(layout.measured_height))
        .unwrap_or_else(|| {
            let line_count = lines.len().max(1) as f64;
            if is_vertical {
                measured_bbox.w / line_count
            } else {
                measured_bbox.h / line_count
            }
        });

    let font_style = text_input
        .map(|text| text.font_style.clone())
        .or_else(|| text_path_input.map(|text| text.font_style.clone()));
    let font_style_ir = match font_style {
        Some(crate::font::FontStyle::Italic) => Some("italic".to_string()),
        _ => None,
    };

    // Scalar text stroke (multi-layer strokes/shadows ride separately)
    let (stroke, stroke_linecap, stroke_linejoin, stroke_dasharray, stroke_miterlimit) =
        if let Some(text_stroke) = visual
            .text_stroke
            .as_deref()
            .filter(|text| !text.is_empty())
        {
            (
                Some(text_stroke.to_string()),
                parse_linecap(visual.text_stroke_linecap.as_deref()),
                Some(
                    parse_linejoin(visual.text_stroke_linejoin.as_deref())
                        .unwrap_or(StrokeLinejoin::Round),
                ),
                visual
                    .text_stroke_dasharray
                    .clone()
                    .filter(|text| !text.is_empty()),
                visual.text_stroke_miterlimit,
            )
        } else {
            (None, None, None, None, None)
        };
    let stroke_width = truthy_number(visual.text_stroke_width);

    let strokes = visual
        .text_strokes
        .as_ref()
        .filter(|layers| !layers.is_empty())
        .map(|layers| {
            layers
                .iter()
                .map(|layer| TextStrokeLayer {
                    color: layer.color.clone(),
                    width_px: layer.width_px,
                    linejoin: layer.linejoin.clone(),
                    linecap: layer.linecap.clone(),
                    dasharray: layer.dasharray.clone(),
                    miterlimit: layer.miterlimit,
                })
                .collect()
        });
    let shadows = visual
        .text_shadows
        .as_ref()
        .filter(|layers| !layers.is_empty())
        .map(|layers| {
            layers
                .iter()
                .map(|layer| TextShadowLayer {
                    dx: layer.dx,
                    dy: layer.dy,
                    blur_px: layer.blur_px,
                    color: layer.color.clone(),
                })
                .collect()
        });

    if let Some(error) = layout
        .text_decorations
        .iter()
        .flat_map(|fragment| &fragment.paths)
        .find_map(|path| path.error)
    {
        let (code, message) = match error {
            crate::text::types::TextDecorationPaintError::ComplexityLimit => (
                "TEXT_DECORATION_COMPLEXITY_LIMIT",
                "Resolved text decoration path count exceeds its deterministic limit.",
            ),
            crate::text::types::TextDecorationPaintError::Geometry => (
                "TEXT_DECORATION_GEOMETRY",
                "Text decoration geometry could not be materialized.",
            ),
            crate::text::types::TextDecorationPaintError::PatternLimit => (
                "TEXT_DECORATION_PATTERN_LIMIT",
                "Text decoration pattern geometry exceeds its deterministic limit.",
            ),
        };
        return Err(EngineError::Structured {
            code: code.to_string(),
            message: message.to_string(),
            stage: Some(crate::diagnostics::PipelineStage::Ir),
            node_id: Some(node_id.clone()),
        });
    }
    let text_decoration_path_count = layout
        .text_decorations
        .iter()
        .map(|fragment| fragment.paths.len())
        .sum::<usize>();
    let text_decoration_contour_count = layout
        .text_decorations
        .iter()
        .flat_map(|fragment| &fragment.paths)
        .map(|path| path.contour_count as usize)
        .sum::<usize>();
    let text_decoration_pattern_segment_count = layout
        .text_decorations
        .iter()
        .flat_map(|fragment| &fragment.paths)
        .map(|path| path.segment_count as usize)
        .sum::<usize>();
    if text_decoration_path_count > crate::text::decoration::MAX_TEXT_DECORATION_PATHS {
        return Err(EngineError::Structured {
            code: "TEXT_DECORATION_COMPLEXITY_LIMIT".to_string(),
            message: format!(
                "Resolved text decoration path count {text_decoration_path_count} exceeds the limit {}.",
                crate::text::decoration::MAX_TEXT_DECORATION_PATHS
            ),
            stage: Some(crate::diagnostics::PipelineStage::Ir),
            node_id: Some(node_id.clone()),
        });
    }
    if text_decoration_contour_count > crate::text::decoration::MAX_TEXT_DECORATION_PATTERN_CONTOURS
        || text_decoration_pattern_segment_count
            > crate::text::decoration::MAX_TEXT_DECORATION_PATTERN_SEGMENTS
    {
        return Err(EngineError::Structured {
            code: "TEXT_DECORATION_PATTERN_LIMIT".to_string(),
            message: format!(
                "Text decoration pattern complexity {text_decoration_contour_count} contours / {text_decoration_pattern_segment_count} segments exceeds the deterministic limit."
            ),
            stage: Some(crate::diagnostics::PipelineStage::Ir),
            node_id: Some(node_id.clone()),
        });
    }
    let text_decorations = (!layout.text_decorations.is_empty()).then(|| {
        layout
            .text_decorations
            .iter()
            .map(|fragment| {
                let mut positioned_fragment = fragment.clone();
                for path in &mut positioned_fragment.paths {
                    let line_index = path.line_index as usize;
                    let line = &lines[line_index];
                    let (dx, dy) = if matches!(
                        placement.space,
                        crate::text::types::TextPlacementSpace::LineRelative {
                            writing_mode: crate::text::types::WritingMode::VerticalRl
                        }
                    ) {
                        let column_x = context.bbox.x + context.bbox.w
                            - (line_index as f64 + 1.0) * line_height_px
                            + line_height_px * 0.5;
                        let available = context.bbox.h - line.width;
                        let inline_offset = if available <= 0.0 {
                            0.0
                        } else {
                            match text_align {
                                IrTextAlign::Center => available / 2.0,
                                IrTextAlign::End => available,
                                IrTextAlign::Start => 0.0,
                            }
                        };
                        (column_x, context.bbox.y + inline_offset)
                    } else if matches!(
                        placement.space,
                        crate::text::types::TextPlacementSpace::LineRelative { .. }
                    ) {
                        (
                            super::text_placement::horizontal_start(
                                context.bbox,
                                line.width,
                                text_align,
                            ),
                            context.bbox.y,
                        )
                    } else {
                        let offset = placement.offsets[line_index];
                        (context.bbox.x + offset.x, context.bbox.y + offset.y)
                    };
                    if dx != 0.0 {
                        path.origin_x += dx;
                    }
                    if dy != 0.0 {
                        path.origin_y += dy;
                    }
                }
                positioned_fragment
            })
            .collect()
    });

    append_inline_box_decorations(&mut context, layout, &placement);
    append_inline_rects(&mut context, layout, &placement, "behind");

    let resolved_text_bbox = if is_path {
        BBox {
            x: context.bbox.x + measured_bbox.x,
            y: context.bbox.y + measured_bbox.y,
            w: measured_bbox.w,
            h: measured_bbox.h,
        }
    } else if matches!(
        placement.space,
        crate::text::types::TextPlacementSpace::FlowFrame
    ) {
        context.bbox
    } else {
        resolve_aligned_text_bbox(context.bbox, measured_bbox, is_vertical, text_align)
    };
    let text_node = IrNode {
        ownership: IrNodeOwnership::Content {
            owner_node_id: context.node_id.to_string(),
        },
        node_id: node_id.clone(),
        bbox: resolved_text_bbox,
        kind: IrNodeKind::Text {
            lines,
            font: text_input
                .and_then(|text| text.font_family.first().cloned())
                .or_else(|| text_path_input.and_then(|text| text.font_family.first().cloned()))
                .unwrap_or_default(),
            font_fallback: visual.font_fallback.clone(),
            font_size_px: chosen_font_size_px,
            font_weight: visual.font_weight,
            font_style: font_style_ir,
            letter_spacing_px: text_input
                .and_then(|text| text.letter_spacing_px)
                .or_else(|| text_path_input.and_then(|text| text.letter_spacing_px)),
            font_variation_settings: text_input
                .and_then(|text| text.font_variation_settings.clone())
                .or_else(|| text_path_input.and_then(|text| text.font_variation_settings.clone())),
            font_feature_settings: text_input
                .and_then(|text| text.font_feature_settings.clone())
                .or_else(|| text_path_input.and_then(|text| text.font_feature_settings.clone())),
            color: visual
                .color
                .clone()
                .unwrap_or_else(|| "#000000".to_string()),
            text_align,
            layout_box: context.bbox,
            writing_mode: is_vertical.then(|| "vertical-rl".to_string()),
            language: text_input
                .and_then(|text| text.language.clone())
                .or_else(|| text_path_input.and_then(|text| text.language.clone())),
            line_height_px,
            text_layout_kind: is_path.then(|| "path".to_string()),
            source_text: layout.source_text.clone(),
            display_text: layout.display_text.clone(),
            text_path: text_path_input.map(|text| {
                Box::new(super::types::TextPathMetadata {
                    d: text.d.clone(),
                    start_offset_px: text.start_offset_px.unwrap_or(0.0),
                    text_anchor: text
                        .text_anchor
                        .clone()
                        .unwrap_or_else(|| "start".to_string()),
                    path_direction: text
                        .path_direction
                        .clone()
                        .unwrap_or_else(|| "forward".to_string()),
                    path_normal: text
                        .path_normal
                        .clone()
                        .unwrap_or_else(|| "left".to_string()),
                    path_offset_px: text.path_offset_px.unwrap_or(0.0),
                    path_fit: text.path_fit.clone().unwrap_or_else(|| "none".to_string()),
                    path_overflow: text
                        .path_overflow
                        .clone()
                        .unwrap_or_else(|| "hidden".to_string()),
                })
            }),
            glyph_paths: None,
            gradients: None,
            unit_map: layout.unit_map.clone(),
            unit_animation: visual.unit_animation.clone().map(Box::new),
            unit_animation_samples: None,
            stroke,
            stroke_width,
            stroke_linecap,
            stroke_linejoin,
            stroke_dasharray,
            stroke_miterlimit,
            strokes,
            shadows,
            text_decorations,
        },
    };
    context.children.push(text_node);

    append_inline_rects(&mut context, layout, &placement, "front");
    Ok(())
}

// ---------------------------------------------------------------------------
// Image child builder
// ---------------------------------------------------------------------------

fn build_image_child(
    visual: &VisualInput,
    node_id: &str,
    bbox: BBox,

    children: &mut Vec<IrNode>,

    warnings: &mut Vec<SerializedRecoverableError>,
) {
    // The serializer already embedded byte sources as data URIs. A string
    // reference passes through unchanged; absence means embedding failed.
    if let Some(src) = visual.src.as_deref()
        && !src.starts_with("data:")
    {
        warnings.push(SerializedRecoverableError::recoverable(
                RecoverableCode::ImageSrcNotEmbedded,
                format!(
                    "Image src for node \"{node_id}\" is a reference, not embedded data. SVG keeps the reference; PNG rasterization omits the image. Pass a Uint8Array or a data: URI to embed it.",
                ),
                PipelineStage::Ir,
                Some(node_id.to_string()),
                "svg_reference_only",
            ));
    }

    let data_uri = match visual.src.as_deref() {
        Some(uri) if !uri.is_empty() => uri.to_string(),
        _ => {
            warnings.push(SerializedRecoverableError::recoverable(
                RecoverableCode::ImageLoadFailed,
                format!("Image load failed for node \"{node_id}\""),
                PipelineStage::Ir,
                Some(node_id.to_string()),
                "placeholder_rect",
            ));
            children.push(IrNode {
                ownership: IrNodeOwnership::Content {
                    owner_node_id: node_id.to_string(),
                },
                node_id: node_id.to_string(),
                bbox,
                kind: IrNodeKind::Rect {
                    fill: Some("#cccccc".to_string()),
                    gradient: None,
                    stroke: Some("#999999".to_string()),
                    stroke_width: Some(1.0),
                    stroke_scaling: None,
                    border_radius: None,
                    stroke_linecap: None,
                    stroke_linejoin: None,
                    stroke_dasharray: None,
                    stroke_miterlimit: None,
                },
            });

            return;
        }
    };

    let object_fit = visual.object_fit.as_deref().unwrap_or("fill");
    let object_position = visual.object_position.as_deref().unwrap_or("center");
    let preserve_aspect_ratio = match object_fit {
        "contain" => format!("{} meet", resolve_par_align(object_position)),
        "cover" => format!("{} slice", resolve_par_align(object_position)),
        _ => "none".to_string(),
    };

    children.push(IrNode {
        ownership: IrNodeOwnership::Content {
            owner_node_id: node_id.to_string(),
        },
        node_id: node_id.to_string(),
        bbox,
        kind: IrNodeKind::Image {
            src: data_uri,
            preserve_aspect_ratio,
        },
    });
}

// ---------------------------------------------------------------------------
// Path child builder
// ---------------------------------------------------------------------------

/// Preserve Path layout dimensions while deriving independent conservative paint geometry.
fn build_path_child(visual: &VisualInput, node_id: &str, bbox: BBox, children: &mut Vec<IrNode>) {
    children.push(IrNode {
        ownership: IrNodeOwnership::Content {
            owner_node_id: node_id.to_string(),
        },
        node_id: node_id.to_string(),
        bbox,
        kind: IrNodeKind::Path {
            path_geometry: super::path_geometry::derive_path_geometry(
                visual.d.as_deref().unwrap_or_default(),
                visual.stroke.as_deref(),
                visual.stroke_width,
                visual.stroke_scaling,
                parse_linecap(visual.stroke_linecap.as_deref()),
                parse_linejoin(visual.stroke_linejoin.as_deref()),
                visual.stroke_miterlimit,
            ),
            path_data: visual.d.clone().unwrap_or_default(),
            fill: visual.fill.clone(),
            stroke: visual.stroke.clone(),
            stroke_width: visual.stroke_width,
            stroke_scaling: visual.stroke_scaling,
            fill_rule: parse_fill_rule(visual.fill_rule.as_deref()),
            stroke_linecap: parse_linecap(visual.stroke_linecap.as_deref()),
            stroke_linejoin: parse_linejoin(visual.stroke_linejoin.as_deref()),
            stroke_dasharray: visual
                .stroke_dasharray
                .clone()
                .filter(|text| !text.is_empty()),
            stroke_miterlimit: visual.stroke_miterlimit,
        },
    });
}

// ---------------------------------------------------------------------------
// Shape / Symbol child builder
// ---------------------------------------------------------------------------

struct ShapeChildContext<'a> {
    is_symbol: bool,
    visual: &'a VisualInput,
    node_id: &'a str,
    bbox: BBox,

    children: &'a mut Vec<IrNode>,

    warnings: &'a mut Vec<SerializedRecoverableError>,
}

/// Diagnostic label for shape errors: the authored id, or a type placeholder
/// for auto-generated ids (mirrors the TS `shapeNodeLabel`).
fn shape_node_label(node_id: &str, is_symbol: bool) -> String {
    if node_id.starts_with("auto:") {
        if is_symbol {
            "<Symbol>".to_string()
        } else {
            "<Shape>".to_string()
        }
    } else {
        node_id.to_string()
    }
}

fn resolve_shape_geometry(context: &ShapeChildContext) -> Result<GeometryDoc, EngineError> {
    let visual = context.visual;
    let label = shape_node_label(context.node_id, context.is_symbol);
    if context.is_symbol {
        let Some(symbol) = visual.symbol_definition.as_ref() else {
            return Err(match visual.symbol_id.as_deref() {
                Some(symbol_id) => EngineError::Structured {
                    code: "SHAPE_SYMBOL_NOT_FOUND".to_string(),
                    message: format!("Symbol references unknown symbolId \"{symbol_id}\"."),
                    stage: Some(crate::diagnostics::PipelineStage::Validate),
                    node_id: Some(label.clone()),
                },
                None => EngineError::Structured {
                    code: "SHAPE_SYMBOL_MISSING".to_string(),
                    message: "Symbol requires either a symbol definition or symbolId.".to_string(),
                    stage: Some(crate::diagnostics::PipelineStage::Validate),
                    node_id: Some(label.clone()),
                },
            });
        };
        boundshape::resolve_symbol_geometry(
            symbol,
            &SymbolResolutionOptions {
                width: context.bbox.w,
                height: context.bbox.h,
            },
        )
        .map_err(|error| {
            crate::shape_diagnostics::shape_error_to_engine_error(
                &error,
                crate::shape_diagnostics::ShapeOperation::RenderSymbol,
                context.node_id,
            )
        })
    } else {
        let Some(geometry) = visual.shape_geometry.as_ref() else {
            return Err(match visual.shape_geometry_id.as_deref() {
                Some(geometry_id) => EngineError::Structured {
                    code: "SHAPE_GEOMETRY_NOT_FOUND".to_string(),
                    message: format!("Shape references unknown geometryId \"{geometry_id}\"."),
                    stage: Some(crate::diagnostics::PipelineStage::Validate),
                    node_id: Some(label.clone()),
                },
                None => EngineError::Structured {
                    code: "SHAPE_GEOMETRY_MISSING".to_string(),
                    message: "Shape requires either a geometry object or geometryId.".to_string(),
                    stage: Some(crate::diagnostics::PipelineStage::Validate),
                    node_id: Some(label.clone()),
                },
            });
        };
        Ok(geometry.clone())
    }
}

/// Widest effective per-part stroke so viewport baking does not clip strokes
/// widened by partPaint (mirrors the TS compile-side stroke widening).
fn widest_compile_stroke(
    visual: &VisualInput,
    part_paint: Option<&PartPaintMap>,
) -> (Option<String>, Option<f64>) {
    let mut compile_stroke = visual.stroke.clone();
    let mut compile_stroke_width = visual.stroke_width;
    let Some(overrides) = part_paint else {
        return (compile_stroke, compile_stroke_width);
    };
    for (_, override_entry) in &overrides.0 {
        let effective_stroke = override_entry
            .stroke
            .as_deref()
            .or(visual.stroke.as_deref());
        let Some(effective_stroke) = effective_stroke else {
            continue;
        };
        if effective_stroke == "none" {
            continue;
        }
        let effective_width = override_entry
            .stroke_width
            .or(visual.stroke_width)
            .unwrap_or(1.0);
        let replace = match compile_stroke.as_deref() {
            None | Some("none") => true,
            _ => effective_width > compile_stroke_width.unwrap_or(1.0),
        };
        if replace {
            compile_stroke = Some(effective_stroke.to_string());
            compile_stroke_width = Some(effective_width);
        }
    }
    (compile_stroke, compile_stroke_width)
}

fn build_shape_child(context: &mut ShapeChildContext) -> Result<(), EngineError> {
    let geometry = resolve_shape_geometry(context)?;
    let visual = context.visual;
    let node_id = context.node_id;

    let emit_part_ids = visual.emit_part_ids.unwrap_or(false);
    let part_paint = visual.part_paint.as_ref();
    let (compile_stroke, compile_stroke_width) = widest_compile_stroke(visual, part_paint);

    let options = CompileGeometryOptions {
        paint: Some(GeometryPaint {
            fill: visual.fill.clone(),
            stroke: compile_stroke,
            stroke_width: compile_stroke_width,
            fill_rule: visual.fill_rule.clone(),
            stroke_linecap: visual.stroke_linecap.clone(),
            stroke_linejoin: visual.stroke_linejoin.clone(),
            stroke_dasharray: visual.stroke_dasharray.clone(),
            stroke_miterlimit: visual.stroke_miterlimit,
            opacity: None,
        }),
        viewport: Some(GeometryViewport {
            width: context.bbox.w,
            height: context.bbox.h,
        }),
        preserve_aspect_ratio: match visual.preserve_aspect_ratio.as_deref() {
            Some("meet") => GeometryPreserveAspectRatio::Meet,
            Some("slice") => GeometryPreserveAspectRatio::Slice,
            _ => GeometryPreserveAspectRatio::None,
        },
        // partPaint needs the parts split apart even when ids are not emitted
        part_ids: emit_part_ids || part_paint.is_some(),
    };

    let shape_operation = if context.is_symbol {
        crate::shape_diagnostics::ShapeOperation::RenderSymbol
    } else {
        crate::shape_diagnostics::ShapeOperation::RenderShape
    };
    let compiled_parts =
        boundshape::compile_geometry_paths(&geometry, Some(&options)).map_err(|error| {
            crate::shape_diagnostics::shape_error_to_engine_error(&error, shape_operation, node_id)
        })?;

    // Unknown partPaint keys produce a warning and are ignored
    if let Some(overrides) = part_paint {
        let known: HashSet<Option<&str>> = compiled_parts
            .iter()
            .map(|part| part.part_id.as_deref())
            .collect();
        for (part_id, _) in &overrides.0 {
            if !known.contains(&Some(part_id.as_str())) {
                context
                    .warnings
                    .push(SerializedRecoverableError::recoverable(
                        RecoverableCode::ShapePartPaintUnknownPart,
                        format!(
                            "partPaint references unknown partId \"{part_id}\"; entry ignored."
                        ),
                        PipelineStage::Ir,
                        Some(node_id.to_string()),
                        "ignored",
                    ));
            }
        }
    }

    let shape_parts: Vec<ShapePathPart> = compiled_parts
        .into_iter()
        .map(|part| {
            let paint_override = part
                .part_id
                .as_deref()
                .and_then(|part_id| part_paint.and_then(|overrides| overrides.get(part_id)));
            ShapePathPart {
                // Parts may be split only for partPaint; ids stay opt-in
                part_id: if emit_part_ids { part.part_id } else { None },
                d: part.d,
                stroke_d: part.stroke_d,
                bounds: part.bounds.map(|bounds| ShapePartBounds {
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                }),
                paint: paint_override.map(|override_entry| ShapePartPaint {
                    fill: override_entry.fill.clone(),
                    stroke: override_entry.stroke.clone(),
                    stroke_width: override_entry.stroke_width,
                    stroke_linecap: override_entry.stroke_linecap.clone(),
                    stroke_linejoin: override_entry.stroke_linejoin.clone(),
                    stroke_dasharray: override_entry.stroke_dasharray.clone(),
                    stroke_miterlimit: override_entry.stroke_miterlimit,
                }),
            }
        })
        .collect();

    context.children.push(IrNode {
        ownership: IrNodeOwnership::Content {
            owner_node_id: context.node_id.to_string(),
        },
        node_id: node_id.to_string(),
        bbox: context.bbox,
        kind: IrNodeKind::Shape {
            shape_parts,
            fill: visual.fill.clone().filter(|text| !text.is_empty()),
            stroke: visual.stroke.clone().filter(|text| !text.is_empty()),
            stroke_width: visual.stroke_width,
            fill_rule: parse_fill_rule(visual.fill_rule.as_deref()),
            stroke_linecap: parse_linecap(visual.stroke_linecap.as_deref()),
            stroke_linejoin: parse_linejoin(visual.stroke_linejoin.as_deref()),
            stroke_dasharray: visual
                .stroke_dasharray
                .clone()
                .filter(|text| !text.is_empty()),
            stroke_miterlimit: visual.stroke_miterlimit,
        },
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// SVG child builder
// ---------------------------------------------------------------------------

fn build_svg_child(
    visual: &VisualInput,
    node_id: &str,
    bbox: BBox,

    children: &mut Vec<IrNode>,

    warnings: &mut Vec<SerializedRecoverableError>,
) -> Result<(), EngineError> {
    let Some(content) = visual.svg_content.as_deref() else {
        return Ok(());
    };

    // Security check — fatal error, matching TS FatalError("VALIDATION", ...)
    if let Some(reason) = unsafe_svg_reason(content) {
        return Err(EngineError::Structured {
            code: "VALIDATION".to_string(),
            message: format!("Validation error: Svg content contains disallowed markup ({reason})"),
            stage: Some(crate::diagnostics::PipelineStage::Ir),
            node_id: Some(node_id.to_string()),
        });
    }

    let (view_box, inner_content) = parse_svg_content(content, visual.content_id_prefix.as_deref())
        .map_err(|error| EngineError::Structured {
            code: error.code.to_string(),
            message: format!(
                "Embedded SVG ID rewrite failed for node \"{node_id}\": {}",
                error.detail
            ),
            stage: Some(crate::diagnostics::PipelineStage::Ir),
            node_id: Some(node_id.to_string()),
        })?;

    if contains_embedded_text_element(&inner_content) {
        // Embedded <text> is re-shaped by the viewer / rasterizer fonts,
        // which is outside the determinism contract.
        warnings.push(SerializedRecoverableError::recoverable(
            RecoverableCode::SvgEmbeddedText,
            "Embedded Svg content contains <text>; it is re-shaped by the viewer/rasterizer and is not covered by the determinism contract. Convert it to paths for reproducible output.",
            PipelineStage::Ir,
            Some(node_id.to_string()),
            "pass-through",
        ));
    }

    children.push(IrNode {
        ownership: IrNodeOwnership::Content {
            owner_node_id: node_id.to_string(),
        },
        node_id: node_id.to_string(),
        bbox,
        kind: IrNodeKind::Svg {
            content: inner_content,
            view_box,
            preserve_aspect_ratio: resolve_nested_svg_par(visual.preserve_aspect_ratio.as_deref()),
        },
    });

    Ok(())
}

/// Mirror of the TS embedded-text probe `/<text[\s/>]/i` on non-empty
/// inner content.
fn contains_embedded_text_element(inner_content: &str) -> bool {
    if inner_content.is_empty() {
        return false;
    }
    let lower = inner_content.to_ascii_lowercase();
    let mut search_from = 0;
    while let Some(found) = lower[search_from..].find("<text") {
        let after = lower[search_from + found + "<text".len()..].chars().next();
        if after.is_some_and(|ch| ch.is_whitespace() || ch == '/' || ch == '>') {
            return true;
        }
        search_from += found + "<text".len();
    }
    false
}

// ---------------------------------------------------------------------------
// SVG content parser (strip outer <svg> wrapper, extract viewBox, prefix IDs)
// ---------------------------------------------------------------------------

/// Parse SVG string to extract viewBox and inner content.
fn parse_svg_content(
    svg_string: &str,
    content_id_prefix: Option<&str>,
) -> Result<(Option<String>, String), super::svg_id_rewrite::SvgIdRewriteError> {
    let view_box = extract_svg_view_box(svg_string);
    let mut inner = strip_outer_svg(svg_string);
    if let Some(prefix) = content_id_prefix.filter(|prefix| !prefix.is_empty())
        && !inner.is_empty()
    {
        inner = rewrite_svg_ids(&inner, prefix)?;
    }
    Ok((view_box, inner))
}

fn extract_svg_view_box(svg_string: &str) -> Option<String> {
    let (tag_start, tag_end) = find_svg_open_tag(svg_string)?;
    let opening_tag = &svg_string[tag_start..=tag_end];
    let lower_tag = opening_tag.to_ascii_lowercase();
    let attr_offset = lower_tag.find("viewbox=\"")? + "viewbox=\"".len();
    let attr_end = opening_tag[attr_offset..].find('"')? + attr_offset;
    Some(opening_tag[attr_offset..attr_end].to_string())
}

/// First `<svg[^>]*>` match, byte offsets of `<` and `>` (case-insensitive).
fn find_svg_open_tag(svg_string: &str) -> Option<(usize, usize)> {
    let lower = svg_string.to_ascii_lowercase();
    let start = lower.find("<svg")?;
    let end = svg_string[start..].find('>')? + start;
    Some((start, end))
}

/// Mirror of the TS wrapper strip: remove only the first `<svg...>` match
/// (content before it is preserved), a trailing `</svg>` (with trailing
/// whitespace) at the end, then trim.
fn strip_outer_svg(svg_string: &str) -> String {
    let mut result = match find_svg_open_tag(svg_string) {
        Some((start, end)) => {
            let mut stripped = String::with_capacity(svg_string.len());
            stripped.push_str(&svg_string[..start]);
            stripped.push_str(&svg_string[end + 1..]);
            stripped
        }
        None => svg_string.to_string(),
    };

    let end_trimmed_len = result.trim_end().len();
    if result[..end_trimmed_len]
        .to_ascii_lowercase()
        .ends_with("</svg>")
    {
        result.truncate(end_trimmed_len - "</svg>".len());
    }

    result.trim().to_string()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Convert transported handler references into the IR handlers form.
fn collect_handlers(handlers: Option<&HandlersInput>) -> Option<HandlersRef> {
    let handlers = handlers?;
    let converted = HandlersRef {
        on_click: handlers.on_click.clone(),
        on_double_click: handlers.on_double_click.clone(),
        on_context_menu: handlers.on_context_menu.clone(),
        on_pointer_down: handlers.on_pointer_down.clone(),
        on_pointer_up: handlers.on_pointer_up.clone(),
        on_pointer_cancel: handlers.on_pointer_cancel.clone(),
        on_pointer_move: handlers.on_pointer_move.clone(),
        on_pointer_enter: handlers.on_pointer_enter.clone(),
        on_pointer_leave: handlers.on_pointer_leave.clone(),
        on_pointer_over: handlers.on_pointer_over.clone(),
        on_pointer_out: handlers.on_pointer_out.clone(),
        on_mouse_down: handlers.on_mouse_down.clone(),
        on_mouse_up: handlers.on_mouse_up.clone(),
        on_mouse_move: handlers.on_mouse_move.clone(),
        on_mouse_enter: handlers.on_mouse_enter.clone(),
        on_mouse_leave: handlers.on_mouse_leave.clone(),
        on_mouse_over: handlers.on_mouse_over.clone(),
        on_mouse_out: handlers.on_mouse_out.clone(),
        on_touch_start: handlers.on_touch_start.clone(),
        on_touch_end: handlers.on_touch_end.clone(),
        on_touch_move: handlers.on_touch_move.clone(),
    };
    if converted.is_empty() {
        None
    } else {
        Some(converted)
    }
}

/// Convert CSS objectPosition to SVG preserveAspectRatio alignment.
fn resolve_par_align(object_position: &str) -> String {
    let lowered = object_position.trim().to_lowercase();
    let mut x_align = "Mid";
    let mut y_align = "Mid";
    for part in lowered.split_whitespace() {
        match part {
            "left" => x_align = "Min",
            "right" => x_align = "Max",
            "top" => y_align = "Min",
            "bottom" => y_align = "Max",
            _ => {}
        }
    }
    format!("x{x_align}Y{y_align}")
}

/// Resolve preserveAspectRatio for nested SVG.
fn resolve_nested_svg_par(par: Option<&str>) -> String {
    match par {
        Some("none") => "none".to_string(),
        Some("slice") => "xMidYMid slice".to_string(),
        _ => "xMidYMid meet".to_string(),
    }
}

fn parse_linecap(value: Option<&str>) -> Option<StrokeLinecap> {
    match value {
        Some("butt") => Some(StrokeLinecap::Butt),
        Some("round") => Some(StrokeLinecap::Round),
        Some("square") => Some(StrokeLinecap::Square),
        _ => None,
    }
}

fn parse_linejoin(value: Option<&str>) -> Option<StrokeLinejoin> {
    match value {
        Some("miter") => Some(StrokeLinejoin::Miter),
        Some("round") => Some(StrokeLinejoin::Round),
        Some("bevel") => Some(StrokeLinejoin::Bevel),
        _ => None,
    }
}

fn parse_fill_rule(value: Option<&str>) -> Option<IrFillRule> {
    match value {
        Some("evenodd") => Some(IrFillRule::Evenodd),
        Some("nonzero") => Some(IrFillRule::Nonzero),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
