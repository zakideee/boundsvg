//! Paint scene resolution: the ordering/grouping layer between the IR and
//! the SVG string emitter.
//!
//! `resolve_paint_scene` is a pure function of `(Ir, PaintSceneOptions)`.
//! The layer contract, precisely:
//!
//! - Resolved here: the flat item list (element order, group boundaries and
//!   their resolved attributes, which leaves emit at all), the `<defs>`
//!   inventory (which defs exist, their ids, their collection order —
//!   shared shape paths, clip paths, gradients, filters), shared-shape-path
//!   dedup, transform attribute strings, and the debug overlay structure.
//! - Still computed at emit time (`svg_emit::emitter`): the *subtrees* of
//!   each def — feDropShadow-vs-blur/morphology filter branching and the
//!   filter-region
//!   percentages, linear-vs-radial gradient branching and the angle
//!   trigonometry, clipPath per-corner/uniform/none content shapes, and
//!   rounded-rect path geometry — plus per-leaf paint attribute selection,
//!   the text effect-layer-vs-scalar-stroke grouping, and the tofu
//!   stroke-width arithmetic. The emitter never reorders items or defs.
//!
//! Two structural notes:
//!
//! - Leaf-level transform wrapping is unnecessary for engine-built IR: only
//!   group nodes carry transforms, which the IR model encodes structurally.
//!   Leaf items therefore have no transform wrap.
//! - Shape part paint attributes are resolved to strings here because the
//!   shared-path dedup key is defined over the exact attribute bytes.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::error::EngineError;
use crate::ir::animation_timeline::{CssIterationCount, DocumentAnimationPlan, DocumentKeyframe};
use crate::ir::types::{
    AnimationSpec, BBox, BorderRadius, BoxShadow, Gradient, Ir, IrNode, IrNodeKind, IrTextAlign,
    ShapePathPart, StrokeLinecap, StrokeLinejoin, StrokeScaling, TextOutlinePath, TextShadowLayer,
    TextStrokeLayer,
};
use crate::svg_emit::identifier_namespace::{SvgIdentifierNamespace, SvgIdentifierRole};
use crate::svg_emit::paint::{
    ShapePaintMode, ShapePaintNode, build_shape_paint_attrs, linecap_str, linejoin_str,
};
use crate::svg_emit::transform::{AffineMatrix, node_transform_attr, node_transform_matrix};
use crate::svg_emit::xml::fnv1a_hash_base36;
use crate::text::types::Line;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/// Debug overlay request, before falling back to the IR's `debug` flag.
/// Mirrors the TS `boolean | DebugOverlayConfig` option.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum DebugOverlaySetting {
    /// Option omitted — fall back to `ir.debug`.
    #[default]
    Unset,
    Flag(bool),
    /// `{ parts: ... }` config; `None` parts keeps the full overlay.
    Config(Option<Vec<String>>),
}

/// Scene resolution options (the subset of TS `EmitSvgOptions` that affects
/// paint order, resource ids, and overlay structure).
#[derive(Debug, Clone, PartialEq)]
pub struct PaintSceneOptions {
    /// Scale factor — multiplies the root `width`/`height` attributes.
    pub scale: f64,
    pub debug: DebugOverlaySetting,
    /// Raw caller-supplied prefix; sanitized here like the TS emitter.
    pub resource_id_prefix: String,
    pub animation_mode: AnimationMode,
    pub time_ms: f64,
    pub reduced_motion: ReducedMotionMode,
    pub timeline_plan: Option<DocumentAnimationPlan>,
    pub generator: Option<crate::output_generator::OutputGenerator>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum AnimationMode {
    #[default]
    Declarative,
    Static,
}

/// Whether declarative output carries a `prefers-reduced-motion` opt-out.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ReducedMotionMode {
    /// Emit nothing extra. Output stays byte identical to a render without
    /// the option, which is why it is the default.
    #[default]
    Keep,
    /// Append one media block that stops every animation this render started.
    Pause,
}

impl Default for PaintSceneOptions {
    fn default() -> Self {
        PaintSceneOptions {
            scale: 1.0,
            debug: DebugOverlaySetting::Unset,
            resource_id_prefix: String::new(),
            animation_mode: AnimationMode::Declarative,
            time_ms: 0.0,
            reduced_motion: ReducedMotionMode::Keep,
            timeline_plan: None,
            generator: None,
        }
    }
}

/// Resolved debug overlay part set. `Some(DebugParts)` emits the overlay
/// group even when every known part flag is off (mirrors the TS `Set`
/// containing only unknown strings).
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors the four-membered TS DebugOverlayPart set; the flags are independent"
)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DebugParts {
    pub specified: bool,
    pub layout: bool,
    pub actual: bool,
    pub baseline: bool,
}

impl DebugParts {
    const ALL: DebugParts = DebugParts {
        specified: true,
        layout: true,
        actual: true,
        baseline: true,
    };
}

/// Mirror of TS `resolveDebugOverlayParts` with the engine's
/// `options.debug ?? ir.debug` fallback folded in.
fn resolve_debug_overlay_parts(
    setting: &DebugOverlaySetting,
    ir_debug: Option<bool>,
) -> Option<DebugParts> {
    match setting {
        DebugOverlaySetting::Unset => {
            if ir_debug.unwrap_or(false) {
                Some(DebugParts::ALL)
            } else {
                None
            }
        }
        DebugOverlaySetting::Flag(enabled) => enabled.then_some(DebugParts::ALL),
        DebugOverlaySetting::Config(None) => Some(DebugParts::ALL),
        DebugOverlaySetting::Config(Some(parts)) => {
            if parts.is_empty() {
                return None;
            }
            Some(DebugParts {
                specified: parts.iter().any(|part| part == "specified"),
                layout: parts.iter().any(|part| part == "layout"),
                actual: parts.iter().any(|part| part == "actual"),
                baseline: parts.iter().any(|part| part == "baseline"),
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Scene model
// ---------------------------------------------------------------------------

/// Fully resolved paint scene. The emitter prints it verbatim.
#[derive(Debug, Clone, PartialEq)]
pub struct PaintScene {
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub root_node_id: String,
    pub root_meta: Option<BTreeMap<String, String>>,
    pub generator: Option<crate::output_generator::OutputGenerator>,
    pub defs: SceneDefs,
    pub animations: Vec<AnimationStyle>,
    pub timeline_css_bytes: Option<usize>,
    pub canvas_strokes: Vec<CanvasStrokeStyle>,
    pub animation_time_ms: f64,
    pub reduced_motion: ReducedMotionMode,
    pub items: Vec<PaintItem>,
    /// `Some` emits the generated debug overlay group (possibly empty).
    pub debug_items: Option<Vec<PaintItem>>,
    /// Resolved generated class for the optional debug overlay group.
    pub debug_overlay_class: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AnimationStyle {
    pub class_name: String,
    pub keyframes_name: String,
    pub bbox: BBox,
    pub playback: AnimationPlaybackStyle,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AnimationPlaybackStyle {
    Independent(AnimationSpec),
    Timeline {
        duration_ms: f64,
        delay_ms: f64,
        iterations: CssIterationCount,
        keyframes: Vec<DocumentKeyframe>,
    },
}

/// Browser-side restoration rule for a canvas-stable stroke.
#[derive(Debug, Clone, PartialEq)]
pub struct CanvasStrokeStyle {
    pub class_name: String,
    pub authored_width: f64,
}

#[derive(Default)]
struct CanvasStrokeState {
    styles: Vec<CanvasStrokeStyle>,
    class_counts: BTreeMap<String, usize>,
    used_class_names: BTreeSet<String>,
}

/// Collected `<defs>` entries, grouped and ordered like the TS `DefsManager`
/// (shared shape paths, then clip paths, gradients, filters — each in
/// collection order).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SceneDefs {
    pub shared_shape_paths: Vec<SharedShapePathDef>,
    pub clip_paths: Vec<ClipPathDef>,
    pub gradients: Vec<GradientDef>,
    pub filters: Vec<FilterDef>,
}

impl SceneDefs {
    #[must_use]
    pub fn has_defs(&self) -> bool {
        !self.shared_shape_paths.is_empty()
            || !self.clip_paths.is_empty()
            || !self.gradients.is_empty()
            || !self.filters.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SharedShapePathDef {
    pub id: String,
    pub d: String,
    pub paint_attrs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClipPathDef {
    pub id: String,
    pub bbox: BBox,
    pub border_radius: Option<BorderRadius>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GradientDef {
    pub id: String,
    pub bbox: BBox,
    pub gradient: Gradient,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FilterDef {
    pub id: String,
    pub dx: f64,
    pub dy: f64,
    pub blur: f64,
    pub color: String,
    pub spread: f64,
}

/// One paint instruction. Group boundaries are embedded in the flat list;
/// leaves carry the per-kind data the emitter needs.
#[derive(Debug, Clone, PartialEq)]
pub enum PaintItem {
    GroupOpen(GroupOpenItem),
    GroupClose,
    Rect(RectItem),
    Text(TextItem),
    Image(ImageItem),
    Path(PathItem),
    NestedSvg(NestedSvgItem),
    Shape(ShapeItem),
    DebugRect(DebugRectItem),
    DebugLine(DebugLineItem),
}

/// Resolved attributes of a `<g>` opening tag, in emission order.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct GroupOpenItem {
    /// `None` for anonymous wrappers (debug overlay transform/clip groups).
    pub node_id: Option<String>,
    pub meta: Option<BTreeMap<String, String>>,
    pub transform: Option<String>,
    pub clip_ref: Option<String>,
    pub filter_ref: Option<String>,
    /// Already filtered: only present when the group opacity is not 1.
    pub opacity: Option<f64>,
    pub animation_class: Option<String>,
    /// `<g .../>` — the group has no children and no matching `GroupClose`.
    pub self_close: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RectItem {
    pub node_id: String,
    /// Internal `:bg` / `:border` rects omit the node-id attribute.
    pub emit_node_id_attr: bool,
    pub bbox: BBox,
    pub border_radius: Option<BorderRadius>,
    /// Gradient fill resource id (wins over `fill`).
    pub gradient_ref: Option<String>,
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub stroke_width: Option<f64>,
    pub canvas_stroke_class: Option<String>,
    pub stroke_linecap: Option<StrokeLinecap>,
    pub stroke_linejoin: Option<StrokeLinejoin>,
    pub stroke_dasharray: Option<String>,
    pub stroke_miterlimit: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextGlyphItem {
    pub d: String,
    pub fill: String,
    pub missing: bool,
    pub unit_paint: Option<TextUnitPaintItem>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextUnitPaintItem {
    pub animation_class: Option<String>,
    pub transform: Option<String>,
    pub opacity: Option<f64>,
}

/// Scalar text stroke attributes (legacy single-group route).
#[derive(Debug, Clone, PartialEq)]
pub struct TextScalarStroke {
    pub stroke: String,
    pub stroke_width: Option<f64>,
    pub stroke_linecap: Option<StrokeLinecap>,
    pub stroke_linejoin: Option<StrokeLinejoin>,
    pub stroke_dasharray: Option<String>,
    pub stroke_miterlimit: Option<f64>,
}

/// One resolved stroke layer of the multi-layer text effect route.
#[derive(Debug, Clone, PartialEq)]
pub struct TextStrokeLayerItem {
    pub color: String,
    pub width_px: f64,
    /// Defaults already applied (`?? "round"`).
    pub linejoin: String,
    pub linecap: String,
    pub dasharray: Option<String>,
    pub miterlimit: Option<f64>,
}

/// One resolved drop-shadow layer of the multi-layer text effect route.
#[derive(Debug, Clone, PartialEq)]
pub struct TextShadowLayerItem {
    pub filter_ref: String,
    pub color: String,
}

/// Multi-layer text effect data (shadow groups below stroke groups below
/// the fill glyphs).
#[derive(Debug, Clone, PartialEq)]
pub struct TextEffectItem {
    pub ranges: Vec<TextEffectRangeItem>,
    pub shadow_layer_count: usize,
    pub stroke_layer_count: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextEffectRangeItem {
    pub glyph_indices: Vec<usize>,
    pub shadows: Vec<TextShadowLayerItem>,
    pub strokes: Vec<TextStrokeLayerItem>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextDecorationItem {
    pub line: crate::text::types::TextDecorationLine,
    pub d: String,
    pub origin_x: f64,
    pub origin_y: f64,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextItem {
    pub node_id: String,
    /// Line texts joined with `\n` (drives `data-boundsvg-text`/`aria-label`).
    pub label: String,
    pub font_size_px: f64,
    pub glyphs: Vec<TextGlyphItem>,
    pub scalar_stroke: Option<TextScalarStroke>,
    pub effect: Option<TextEffectItem>,
    pub decorations: Vec<TextDecorationItem>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImageItem {
    pub node_id: String,
    pub bbox: BBox,
    pub src: String,
    pub preserve_aspect_ratio: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PathItem {
    pub node_id: String,
    pub bbox: BBox,
    pub d: String,
    pub fill: Option<String>,
    pub fill_rule: Option<String>,
    pub stroke: Option<String>,
    pub stroke_width: Option<f64>,
    pub canvas_stroke_class: Option<String>,
    pub stroke_linecap: Option<StrokeLinecap>,
    pub stroke_linejoin: Option<StrokeLinejoin>,
    pub stroke_dasharray: Option<String>,
    pub stroke_miterlimit: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NestedSvgItem {
    pub node_id: String,
    pub bbox: BBox,
    pub content: String,
    pub view_box: Option<String>,
    pub preserve_aspect_ratio: String,
}

/// One emitted shape part: a `<use>` of a shared def, a single inline
/// `<path>`, or a fill/stroke split pair.
#[derive(Debug, Clone, PartialEq)]
pub enum ShapePartItem {
    Use {
        href_id: String,
        part_id: Option<String>,
    },
    Single {
        d: String,
        paint_attrs: Vec<String>,
        part_id: Option<String>,
    },
    Split {
        fill: Option<SplitShapePath>,
        stroke: Option<SplitShapePath>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct SplitShapePath {
    pub d: String,
    pub attrs: Vec<String>,
    pub part_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ShapeItem {
    pub node_id: String,
    pub bbox: BBox,
    pub parts: Vec<ShapePartItem>,
}

/// Debug overlay rect flavor (stroke color / dasharray fixed per flavor).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DebugRectKind {
    /// Allotted layout box (cyan).
    Specified,
    /// Computed per-line layout boxes and shape part bounds (green, dashed).
    Layout,
    /// Measured visual glyph ink bounds (red).
    Actual,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DebugRectItem {
    pub bbox: BBox,
    pub kind: DebugRectKind,
}

/// Text baseline line (amber, 0.5 width).
#[derive(Debug, Clone, PartialEq)]
pub struct DebugLineItem {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

// ---------------------------------------------------------------------------
// Resolution entry point
// ---------------------------------------------------------------------------

/// Resolve an IR tree into a paint scene.
///
/// Pure: identical `(ir, options)` inputs produce identical scenes.
///
/// # Errors
///
/// Returns `EngineError::Validation` when a non-finite number reaches an
/// attribute formatting site (matching the TS `formatNumber` guard).
pub fn resolve_paint_scene(
    ir: &Ir,
    options: &PaintSceneOptions,
) -> Result<PaintScene, EngineError> {
    let identifier_namespace = SvgIdentifierNamespace::new(&options.resource_id_prefix);

    let mut defs = SceneDefs::default();
    collect_defs(&ir.root, &mut defs, &identifier_namespace);
    let shared_shape_paths =
        collect_shared_shape_paths(&ir.root, &identifier_namespace, &mut defs)?;
    let declarative_animation = options.animation_mode == AnimationMode::Declarative;
    let mut animations = Vec::new();
    if declarative_animation {
        if let Some(timeline_plan) = &options.timeline_plan {
            collect_timeline_animations(timeline_plan, &identifier_namespace, &mut animations);
        } else {
            collect_animations(&ir.root, &identifier_namespace, &mut animations);
        }
    }

    let mut items: Vec<PaintItem> = Vec::new();
    let mut canvas_stroke_state = CanvasStrokeState::default();
    let resolve_options = ResolveNodeOptions {
        identifier_namespace: &identifier_namespace,
        shared: &shared_shape_paths,
        declarative_animation,
        output_scale: options.scale,
    };
    if let IrNodeKind::Group { children, .. } = &ir.root.kind {
        for child in children {
            resolve_node(
                child,
                &resolve_options,
                AffineMatrix::identity(),
                false,
                &ir.root.node_id,
                &mut items,
                &mut canvas_stroke_state,
            )?;
        }
    }

    let debug_parts = resolve_debug_overlay_parts(&options.debug, ir.debug);
    let debug_items = match debug_parts {
        Some(parts) => {
            let mut overlay: Vec<PaintItem> = Vec::new();
            resolve_debug_overlays(&ir.root, &identifier_namespace, parts, &mut overlay);
            Some(overlay)
        }
        None => None,
    };

    let root_meta = match &ir.root.kind {
        IrNodeKind::Group { meta, .. } => meta.clone(),
        _ => None,
    };

    Ok(PaintScene {
        width: ir.width,
        height: ir.height,
        scale: options.scale,
        root_node_id: ir.root.node_id.clone(),
        root_meta,
        generator: options.generator.clone(),
        defs,
        animations,
        timeline_css_bytes: options
            .timeline_plan
            .as_ref()
            .map(|plan| plan.exact_css_bytes),
        canvas_strokes: canvas_stroke_state.styles,
        animation_time_ms: options.time_ms,
        reduced_motion: options.reduced_motion,
        items,
        debug_items,
        debug_overlay_class: identifier_namespace
            .identifier(SvgIdentifierRole::DebugOverlayClass, ""),
    })
}

fn animation_names(
    node_id: &str,
    identifier_namespace: &SvgIdentifierNamespace,
) -> (String, String) {
    (
        identifier_namespace.identifier(SvgIdentifierRole::AnimationClass, node_id),
        identifier_namespace.identifier(SvgIdentifierRole::AnimationKeyframes, node_id),
    )
}

fn collect_animations(
    node: &IrNode,
    identifier_namespace: &SvgIdentifierNamespace,
    animations: &mut Vec<AnimationStyle>,
) {
    match &node.kind {
        IrNodeKind::Group {
            children,
            animation,
            ..
        } => {
            if let Some(spec) = animation {
                let (class_name, keyframes_name) =
                    animation_names(&node.node_id, identifier_namespace);
                animations.push(AnimationStyle {
                    class_name,
                    keyframes_name,
                    bbox: node.bbox,
                    playback: AnimationPlaybackStyle::Independent(spec.clone()),
                });
            }
            for child in children {
                collect_animations(child, identifier_namespace, animations);
            }
        }
        IrNodeKind::Text {
            unit_map: Some(unit_map),
            unit_animation: Some(unit_animation),
            unit_animation_samples: Some(samples),
            ..
        } => {
            let visual_order = matches!(
                unit_animation.order,
                Some(crate::ir::types::TextUnitAnimationOrder::Visual)
            );
            let unit_orders: HashMap<&str, (u32, u32)> = unit_map
                .units
                .iter()
                .map(|unit| {
                    (
                        unit.unit_id.as_str(),
                        (unit.logical_order, unit.visual_order),
                    )
                })
                .collect();
            for (unit_index, sample) in samples.iter().enumerate() {
                let Some(bbox) = sample.bbox else {
                    continue;
                };
                let Some((logical_order, visual_order_index)) =
                    unit_orders.get(sample.unit_id.as_str()).copied()
                else {
                    continue;
                };
                let order_index = if visual_order {
                    visual_order_index
                } else {
                    logical_order
                };
                let mut spec = unit_animation.animation.clone();
                spec.delay_ms = Some(
                    spec.delay_ms.unwrap_or(0.0)
                        + f64::from(order_index) * unit_animation.delay_step_ms.unwrap_or(0.0),
                );
                let (class_name, keyframes_name) =
                    unit_animation_names(&node.node_id, unit_index, identifier_namespace);
                animations.push(AnimationStyle {
                    class_name,
                    keyframes_name,
                    bbox,
                    playback: AnimationPlaybackStyle::Independent(spec),
                });
            }
        }
        _ => {}
    }
}

fn collect_timeline_animations(
    plan: &DocumentAnimationPlan,
    identifier_namespace: &SvgIdentifierNamespace,
    animations: &mut Vec<AnimationStyle>,
) {
    for track in &plan.tracks {
        let (class_name, keyframes_name) =
            animation_names(&track.animation_name_owner, identifier_namespace);
        animations.push(AnimationStyle {
            class_name,
            keyframes_name,
            bbox: track.bbox,
            playback: AnimationPlaybackStyle::Timeline {
                duration_ms: plan.duration_ms,
                delay_ms: plan.css_delay_ms,
                iterations: plan.css_iteration_count,
                keyframes: track.keyframes.clone(),
            },
        });
    }
}

fn unit_animation_names(
    node_id: &str,
    unit_index: usize,
    identifier_namespace: &SvgIdentifierNamespace,
) -> (String, String) {
    animation_names(
        &format!("{node_id}:unit:{unit_index}"),
        identifier_namespace,
    )
}

#[derive(Clone)]
struct GlyphEffectRangeSpec {
    glyph_indices: Vec<usize>,
    paint_range_index: Option<u32>,
    strokes: Vec<TextStrokeLayer>,
    shadows: Vec<TextShadowLayer>,
}

fn glyph_effect_range_specs(glyph_paths: &[TextOutlinePath]) -> Vec<GlyphEffectRangeSpec> {
    let mut ranges = Vec::<GlyphEffectRangeSpec>::new();
    for (glyph_index, glyph) in glyph_paths.iter().enumerate() {
        if glyph.strokes.is_none() && glyph.shadows.is_none() {
            continue;
        }
        let strokes = glyph.strokes.clone().unwrap_or_default();
        let shadows = glyph.shadows.clone().unwrap_or_default();
        if let Some(previous) = ranges.last_mut() {
            let same_identity = match (previous.paint_range_index, glyph.paint_range_index) {
                (Some(left), Some(right)) => left == right,
                (None, None) => previous.strokes == strokes && previous.shadows == shadows,
                _ => false,
            };
            if same_identity && previous.strokes == strokes && previous.shadows == shadows {
                previous.glyph_indices.push(glyph_index);
                continue;
            }
        }
        ranges.push(GlyphEffectRangeSpec {
            glyph_indices: vec![glyph_index],
            paint_range_index: glyph.paint_range_index,
            strokes,
            shadows,
        });
    }
    ranges
}

fn uniform_glyph_effect_spec(
    ranges: &[GlyphEffectRangeSpec],
    glyph_count: usize,
) -> Option<&GlyphEffectRangeSpec> {
    let first = ranges.first()?;
    let covers_every_glyph = ranges
        .iter()
        .map(|range| range.glyph_indices.len())
        .sum::<usize>()
        == glyph_count;
    (covers_every_glyph
        && ranges
            .iter()
            .all(|range| range.strokes == first.strokes && range.shadows == first.shadows))
    .then_some(first)
}

// ---------------------------------------------------------------------------
// Defs collection (mirrors collectDefs traversal order)
// ---------------------------------------------------------------------------

fn collect_defs(
    node: &IrNode,
    defs: &mut SceneDefs,
    identifier_namespace: &SvgIdentifierNamespace,
) {
    match &node.kind {
        IrNodeKind::Group {
            children,
            clip_path,
            clip_border_radius,
            box_shadow,
            ..
        } => {
            if let Some(clip_bbox) = clip_path {
                defs.clip_paths.push(ClipPathDef {
                    id: identifier_namespace
                        .identifier(SvgIdentifierRole::ClipPathId, &node.node_id),
                    bbox: *clip_bbox,
                    border_radius: *clip_border_radius,
                });
            }
            if let Some(shadow) = box_shadow {
                push_box_shadow_filter(defs, shadow, &node.node_id, identifier_namespace);
            }
            for child in children {
                collect_defs(child, defs, identifier_namespace);
            }
        }
        IrNodeKind::Rect {
            gradient: Some(gradient),
            ..
        } => {
            defs.gradients.push(GradientDef {
                id: identifier_namespace.identifier(SvgIdentifierRole::GradientId, &node.node_id),
                bbox: node.bbox,
                gradient: gradient.clone(),
            });
        }
        IrNodeKind::Text {
            glyph_paths,
            shadows,
            ..
        } => {
            let glyph_paths = glyph_paths.as_deref().unwrap_or_default();
            let glyph_ranges = glyph_effect_range_specs(glyph_paths);
            if glyph_ranges.is_empty() {
                for (layer_index, shadow) in
                    shadows.as_deref().unwrap_or_default().iter().enumerate()
                {
                    defs.filters.push(FilterDef {
                        id: identifier_namespace.identifier(
                            SvgIdentifierRole::FilterId,
                            &format!("{}:ts{layer_index}", node.node_id),
                        ),
                        dx: shadow.dx,
                        dy: shadow.dy,
                        blur: shadow.blur_px.unwrap_or(0.0),
                        color: shadow.color.clone(),
                        spread: 0.0,
                    });
                }
            } else if let Some(uniform_range) =
                uniform_glyph_effect_spec(&glyph_ranges, glyph_paths.len())
            {
                for (layer_index, shadow) in uniform_range.shadows.iter().enumerate() {
                    defs.filters.push(FilterDef {
                        id: identifier_namespace.identifier(
                            SvgIdentifierRole::FilterId,
                            &format!("{}:ts{layer_index}", node.node_id),
                        ),
                        dx: shadow.dx,
                        dy: shadow.dy,
                        blur: shadow.blur_px.unwrap_or(0.0),
                        color: shadow.color.clone(),
                        spread: 0.0,
                    });
                }
            } else {
                for (range_index, range) in glyph_ranges.iter().enumerate() {
                    for (layer_index, shadow) in range.shadows.iter().enumerate() {
                        defs.filters.push(FilterDef {
                            id: identifier_namespace.identifier(
                                SvgIdentifierRole::FilterId,
                                &format!("{}:pr{range_index}:ts{layer_index}", node.node_id),
                            ),
                            dx: shadow.dx,
                            dy: shadow.dy,
                            blur: shadow.blur_px.unwrap_or(0.0),
                            color: shadow.color.clone(),
                            spread: 0.0,
                        });
                    }
                }
            }
        }
        _ => {}
    }
}

fn push_box_shadow_filter(
    defs: &mut SceneDefs,
    shadow: &BoxShadow,
    node_id: &str,
    identifier_namespace: &SvgIdentifierNamespace,
) {
    defs.filters.push(FilterDef {
        id: identifier_namespace.identifier(SvgIdentifierRole::FilterId, node_id),
        dx: shadow.dx,
        dy: shadow.dy,
        blur: shadow.blur,
        color: shadow.color.clone(),
        spread: shadow.spread,
    });
}

// ---------------------------------------------------------------------------
// Shared shape path dedup
// ---------------------------------------------------------------------------

/// Content key: `d + "\0" + paintAttrs.join(" ")`.
fn shape_part_content_key(d: &str, paint_attrs: &[String]) -> String {
    format!("{d}\u{0000}{}", paint_attrs.join(" "))
}

struct SharedPathOccurrence {
    key: String,
    count: usize,
    d: String,
    paint_attrs: Vec<String>,
}

/// A map from content key to shared def id. Insertion-ordered (small).
type SharedShapePathIndex = Vec<(String, String)>;

fn shared_lookup<'a>(index: &'a SharedShapePathIndex, key: &str) -> Option<&'a str> {
    index
        .iter()
        .find(|(entry_key, _)| entry_key == key)
        .map(|(_, id)| id.as_str())
}

fn is_single_path_shape_part(part: &ShapePathPart) -> bool {
    part.stroke_d.is_none()
}

fn collect_shared_shape_paths(
    root: &IrNode,
    identifier_namespace: &SvgIdentifierNamespace,
    defs: &mut SceneDefs,
) -> Result<SharedShapePathIndex, EngineError> {
    let mut occurrences: Vec<SharedPathOccurrence> = Vec::new();
    collect_shape_part_occurrences(root, &mut occurrences)?;

    let mut used_ids: Vec<String> = Vec::new();
    let mut shared: SharedShapePathIndex = Vec::new();
    for occurrence in occurrences {
        if occurrence.count < 2 {
            continue;
        }
        let hash = fnv1a_hash_base36(&occurrence.key);
        let mut ordinal = 1;
        let mut id = identifier_namespace.identifier_with_ordinal(
            SvgIdentifierRole::SharedShapePathId,
            &hash,
            ordinal,
        );
        // Hash collisions disambiguate deterministically by discovery order.
        while used_ids.contains(&id) {
            ordinal += 1;
            id = identifier_namespace.identifier_with_ordinal(
                SvgIdentifierRole::SharedShapePathId,
                &hash,
                ordinal,
            );
        }
        used_ids.push(id.clone());
        defs.shared_shape_paths.push(SharedShapePathDef {
            id: id.clone(),
            d: occurrence.d,
            paint_attrs: occurrence.paint_attrs,
        });
        shared.push((occurrence.key, id));
    }
    Ok(shared)
}

fn collect_shape_part_occurrences(
    node: &IrNode,
    occurrences: &mut Vec<SharedPathOccurrence>,
) -> Result<(), EngineError> {
    if let IrNodeKind::Shape { shape_parts, .. } = &node.kind {
        let paint_node = ShapePaintNode::from_shape_kind(&node.kind);
        let node_paint_attrs = build_shape_paint_attrs(&paint_node, None, ShapePaintMode::All)?;
        // Split parts are emitted as independent fill/stroke paths and cannot
        // use this single-path def.
        for part in shape_parts
            .iter()
            .filter(|part| is_single_path_shape_part(part))
        {
            let paint_attrs = match &part.paint {
                Some(paint) => {
                    build_shape_paint_attrs(&paint_node, Some(paint), ShapePaintMode::All)?
                }
                None => node_paint_attrs.clone(),
            };
            let key = shape_part_content_key(&part.d, &paint_attrs);
            if let Some(entry) = occurrences.iter_mut().find(|entry| entry.key == key) {
                entry.count += 1;
            } else {
                occurrences.push(SharedPathOccurrence {
                    key,
                    count: 1,
                    d: part.d.clone(),
                    paint_attrs,
                });
            }
        }
    }
    if let IrNodeKind::Group { children, .. } = &node.kind {
        for child in children {
            collect_shape_part_occurrences(child, occurrences)?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Node resolution (mirrors emitNodeRecursive / emitLeafNode)
// ---------------------------------------------------------------------------

struct ResolveNodeOptions<'a> {
    identifier_namespace: &'a SvgIdentifierNamespace,
    shared: &'a SharedShapePathIndex,
    declarative_animation: bool,
    output_scale: f64,
}

fn transform_uses_unsupported_canvas_scale(transform: Option<&boundshape::Transform2D>) -> bool {
    let Some(transform) = transform else {
        return false;
    };
    transform.scale_x.unwrap_or(1.0) != transform.scale_y.unwrap_or(1.0)
}

fn animation_uses_unsupported_canvas_scale(animation: Option<&AnimationSpec>) -> bool {
    animation.is_some_and(|spec| {
        spec.keyframes.iter().any(|keyframe| {
            keyframe.transform.as_ref().is_some_and(|transform| {
                transform.scale_x.unwrap_or(1.0) != transform.scale_y.unwrap_or(1.0)
            })
        })
    })
}

fn canvas_stroke_effective_scale(matrix: AffineMatrix) -> Option<f64> {
    let scale_x = matrix.a.hypot(matrix.b);
    let scale_y = matrix.c.hypot(matrix.d);
    let dot = matrix.a * matrix.c + matrix.b * matrix.d;
    let determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if !scale_x.is_finite() || !scale_y.is_finite() || !dot.is_finite() || !determinant.is_finite()
    {
        return None;
    }
    let tolerance = 1e-9 * scale_x.max(scale_y).max(1.0);
    ((scale_x - scale_y).abs() <= tolerance && dot.abs() <= tolerance && determinant >= -tolerance)
        .then_some(scale_x)
}

fn canvas_stroke_class_name(
    owner_node_id: &str,
    identifier_namespace: &SvgIdentifierNamespace,
    class_counts: &mut BTreeMap<String, usize>,
    used_class_names: &mut BTreeSet<String>,
) -> String {
    let base_class_name =
        identifier_namespace.identifier(SvgIdentifierRole::CanvasStrokeClass, owner_node_id);
    let class_count = class_counts.entry(base_class_name.clone()).or_default();
    loop {
        *class_count += 1;
        let candidate = identifier_namespace.identifier_with_ordinal(
            SvgIdentifierRole::CanvasStrokeClass,
            owner_node_id,
            *class_count,
        );
        if used_class_names.insert(candidate.clone()) {
            return candidate;
        }
    }
}

#[derive(Clone, Copy)]
enum CanvasStrokeOwner {
    BoxBorder,
    Path,
}

fn canvas_stroke_transform_error(owner_node_id: &str, owner: CanvasStrokeOwner) -> EngineError {
    let message = match owner {
        CanvasStrokeOwner::BoxBorder => format!(
            "Canvas-stable border for node \"{owner_node_id}\" requires similarity transforms without axis mirroring on every ancestor"
        ),
        CanvasStrokeOwner::Path => format!(
            "Canvas-stable Path stroke for node \"{owner_node_id}\" requires similarity transforms without axis mirroring on every ancestor"
        ),
    };
    EngineError::Structured {
        code: "CANVAS_STROKE_UNSUPPORTED_TRANSFORM".to_string(),
        message,
        stage: Some(crate::diagnostics::PipelineStage::Emit),
        node_id: Some(owner_node_id.to_string()),
    }
}

fn canvas_stroke_dash_error(owner_node_id: &str, owner: CanvasStrokeOwner) -> EngineError {
    let message = match owner {
        CanvasStrokeOwner::BoxBorder => {
            "Canvas-stable box borders do not support strokeDasharray".to_string()
        }
        CanvasStrokeOwner::Path => {
            "Canvas-stable Path strokes do not support strokeDasharray".to_string()
        }
    };
    EngineError::Structured {
        code: "CANVAS_STROKE_DASH_UNSUPPORTED".to_string(),
        message,
        stage: Some(crate::diagnostics::PipelineStage::Emit),
        node_id: Some(owner_node_id.to_string()),
    }
}

struct ResolvedCanvasStroke {
    class_name: String,
    fallback_width: f64,
}

struct CanvasStrokeRequest<'a> {
    owner: CanvasStrokeOwner,
    stroke_scaling: Option<StrokeScaling>,
    stroke: Option<&'a str>,
    stroke_width: Option<f64>,
    stroke_dasharray: Option<&'a str>,
    owner_node_id: &'a str,
    ancestor_matrix: AffineMatrix,
    ancestor_has_unsupported_transform: bool,
}

fn resolve_canvas_stroke(
    request: &CanvasStrokeRequest<'_>,
    options: &ResolveNodeOptions,
    canvas_stroke_state: &mut CanvasStrokeState,
) -> Result<Option<ResolvedCanvasStroke>, EngineError> {
    let stroke_is_unpainted = request.stroke.is_none_or(|stroke| {
        let normalized_stroke = stroke.trim();
        normalized_stroke.is_empty() || normalized_stroke.eq_ignore_ascii_case("none")
    });
    if !matches!(request.stroke_scaling, Some(StrokeScaling::Canvas)) || stroke_is_unpainted {
        return Ok(None);
    }
    if request
        .stroke_dasharray
        .is_some_and(|dash| !dash.is_empty())
    {
        return Err(canvas_stroke_dash_error(
            request.owner_node_id,
            request.owner,
        ));
    }
    if request.ancestor_has_unsupported_transform {
        return Err(canvas_stroke_transform_error(
            request.owner_node_id,
            request.owner,
        ));
    }
    let Some(effective_scale) = canvas_stroke_effective_scale(request.ancestor_matrix) else {
        return Err(canvas_stroke_transform_error(
            request.owner_node_id,
            request.owner,
        ));
    };
    // SVG defaults an omitted stroke width to 1. Builder-produced box borders
    // carry an explicit width, while paths may intentionally rely on the SVG
    // default.
    let authored_width = request.stroke_width.unwrap_or(1.0);
    let fallback_width = if effective_scale == 0.0 {
        0.0
    } else {
        authored_width / effective_scale
    };
    if !fallback_width.is_finite() {
        let message = match request.owner {
            CanvasStrokeOwner::BoxBorder => format!(
                "Canvas-stable border width for node \"{}\" is not finite",
                request.owner_node_id
            ),
            CanvasStrokeOwner::Path => format!(
                "Canvas-stable Path stroke width for node \"{}\" is not finite",
                request.owner_node_id
            ),
        };
        return Err(EngineError::Structured {
            code: "INVALID_NUMBER".to_string(),
            message,
            stage: Some(crate::diagnostics::PipelineStage::Emit),
            node_id: Some(request.owner_node_id.to_string()),
        });
    }
    let class_name = canvas_stroke_class_name(
        request.owner_node_id,
        options.identifier_namespace,
        &mut canvas_stroke_state.class_counts,
        &mut canvas_stroke_state.used_class_names,
    );
    canvas_stroke_state.styles.push(CanvasStrokeStyle {
        class_name: class_name.clone(),
        authored_width: authored_width * options.output_scale,
    });
    Ok(Some(ResolvedCanvasStroke {
        class_name,
        fallback_width,
    }))
}

fn resolve_node(
    node: &IrNode,
    options: &ResolveNodeOptions,
    ancestor_matrix: AffineMatrix,
    ancestor_has_unsupported_transform: bool,
    parent_group_node_id: &str,
    items: &mut Vec<PaintItem>,
    canvas_stroke_state: &mut CanvasStrokeState,
) -> Result<(), EngineError> {
    match &node.kind {
        IrNodeKind::Group {
            children,
            clip_path,
            opacity,
            box_shadow,
            meta,
            transform,
            animation,
            ..
        } => {
            let animation_identifiers = (options.declarative_animation && animation.is_some())
                .then(|| animation_names(&node.node_id, options.identifier_namespace));
            let has_body = !children.is_empty();
            let open = GroupOpenItem {
                node_id: Some(node.node_id.clone()),
                meta: meta.clone(),
                transform: node_transform_attr(transform.as_ref(), node.bbox),
                clip_ref: clip_path.is_some().then(|| {
                    options
                        .identifier_namespace
                        .identifier(SvgIdentifierRole::ClipPathId, &node.node_id)
                }),
                filter_ref: box_shadow.is_some().then(|| {
                    options
                        .identifier_namespace
                        .identifier(SvgIdentifierRole::FilterId, &node.node_id)
                }),
                opacity: (*opacity).filter(|value| *value != 1.0),
                animation_class: animation_identifiers
                    .as_ref()
                    .map(|(class_name, _)| class_name.clone()),
                self_close: !has_body,
            };
            items.push(PaintItem::GroupOpen(open));
            if has_body {
                let descendant_matrix =
                    ancestor_matrix.multiply(node_transform_matrix(transform.as_ref(), node.bbox));
                let descendant_has_unsupported_transform = ancestor_has_unsupported_transform
                    || transform_uses_unsupported_canvas_scale(transform.as_ref())
                    || animation_uses_unsupported_canvas_scale(animation.as_ref());
                for child in children {
                    resolve_node(
                        child,
                        options,
                        descendant_matrix,
                        descendant_has_unsupported_transform,
                        &node.node_id,
                        items,
                        canvas_stroke_state,
                    )?;
                }
                items.push(PaintItem::GroupClose);
            }
            Ok(())
        }
        IrNodeKind::Rect {
            stroke_scaling,
            stroke_dasharray,
            ..
        } => {
            if let Some(mut rect_item) = resolve_rect_item(node, options.identifier_namespace) {
                if let Some(resolved_stroke) = resolve_canvas_stroke(
                    &CanvasStrokeRequest {
                        owner: CanvasStrokeOwner::BoxBorder,
                        stroke_scaling: *stroke_scaling,
                        stroke: rect_item.stroke.as_deref(),
                        stroke_width: rect_item.stroke_width,
                        stroke_dasharray: stroke_dasharray.as_deref(),
                        owner_node_id: parent_group_node_id,
                        ancestor_matrix,
                        ancestor_has_unsupported_transform,
                    },
                    options,
                    canvas_stroke_state,
                )? {
                    rect_item.stroke_width = Some(resolved_stroke.fallback_width);
                    rect_item.canvas_stroke_class = Some(resolved_stroke.class_name);
                }
                items.push(PaintItem::Rect(rect_item));
            }
            Ok(())
        }
        IrNodeKind::Text { .. } => {
            if let Some(text_item) = resolve_text_item(
                node,
                options.identifier_namespace,
                options.declarative_animation,
            ) {
                items.push(PaintItem::Text(text_item));
            }
            Ok(())
        }
        IrNodeKind::Image {
            src,
            preserve_aspect_ratio,
            ..
        } => {
            if !src.is_empty() {
                items.push(PaintItem::Image(ImageItem {
                    node_id: node.node_id.clone(),
                    bbox: node.bbox,
                    src: src.clone(),
                    preserve_aspect_ratio: preserve_aspect_ratio.clone(),
                }));
            }
            Ok(())
        }
        IrNodeKind::Path {
            path_data,
            fill,
            stroke,
            stroke_width,
            stroke_scaling,
            fill_rule,
            stroke_linecap,
            stroke_linejoin,
            stroke_dasharray,
            stroke_miterlimit,
            ..
        } => {
            if !path_data.is_empty() {
                let mut path_item = PathItem {
                    node_id: node.node_id.clone(),
                    bbox: node.bbox,
                    d: path_data.clone(),
                    fill: fill.clone(),
                    fill_rule: fill_rule.map(|rule| match rule {
                        crate::ir::types::IrFillRule::Nonzero => "nonzero".to_string(),
                        crate::ir::types::IrFillRule::Evenodd => "evenodd".to_string(),
                    }),
                    stroke: stroke.clone(),
                    stroke_width: *stroke_width,
                    canvas_stroke_class: None,
                    stroke_linecap: *stroke_linecap,
                    stroke_linejoin: *stroke_linejoin,
                    stroke_dasharray: stroke_dasharray.clone(),
                    stroke_miterlimit: *stroke_miterlimit,
                };
                if let Some(resolved_stroke) = resolve_canvas_stroke(
                    &CanvasStrokeRequest {
                        owner: CanvasStrokeOwner::Path,
                        stroke_scaling: *stroke_scaling,
                        stroke: path_item.stroke.as_deref(),
                        stroke_width: path_item.stroke_width,
                        stroke_dasharray: stroke_dasharray.as_deref(),
                        owner_node_id: &node.node_id,
                        ancestor_matrix,
                        ancestor_has_unsupported_transform,
                    },
                    options,
                    canvas_stroke_state,
                )? {
                    path_item.stroke_width = Some(resolved_stroke.fallback_width);
                    path_item.canvas_stroke_class = Some(resolved_stroke.class_name);
                }
                items.push(PaintItem::Path(path_item));
            }
            Ok(())
        }
        IrNodeKind::Svg {
            content,
            view_box,
            preserve_aspect_ratio,
            ..
        } => {
            if !content.is_empty() {
                items.push(PaintItem::NestedSvg(NestedSvgItem {
                    node_id: node.node_id.clone(),
                    bbox: node.bbox,
                    content: content.clone(),
                    view_box: view_box.clone(),
                    preserve_aspect_ratio: preserve_aspect_ratio.clone(),
                }));
            }
            Ok(())
        }
        IrNodeKind::Shape { shape_parts, .. } => {
            if !shape_parts.is_empty() {
                items.push(PaintItem::Shape(resolve_shape_item(node, options.shared)?));
            }
            Ok(())
        }
    }
}

fn is_internal_render_node_id(node_id: &str) -> bool {
    node_id.ends_with(":bg") || node_id.ends_with(":border")
}

fn resolve_rect_item(
    node: &IrNode,
    identifier_namespace: &SvgIdentifierNamespace,
) -> Option<RectItem> {
    let IrNodeKind::Rect {
        fill,
        gradient,
        stroke,
        stroke_width,
        stroke_scaling: _,
        border_radius,
        stroke_linecap,
        stroke_linejoin,
        stroke_dasharray,
        stroke_miterlimit,
    } = &node.kind
    else {
        return None;
    };
    Some(RectItem {
        emit_node_id_attr: !is_internal_render_node_id(&node.node_id),
        node_id: node.node_id.clone(),
        bbox: node.bbox,
        border_radius: *border_radius,
        gradient_ref: gradient
            .is_some()
            .then(|| identifier_namespace.identifier(SvgIdentifierRole::GradientId, &node.node_id)),
        fill: fill.clone(),
        stroke: stroke.clone(),
        stroke_width: *stroke_width,
        canvas_stroke_class: None,
        stroke_linecap: *stroke_linecap,
        stroke_linejoin: *stroke_linejoin,
        stroke_dasharray: stroke_dasharray.clone(),
        stroke_miterlimit: *stroke_miterlimit,
    })
}

/// Mirror of `resolveTextStrokeLayers` + the emit-time `?? "round"` defaults.
fn resolve_text_stroke_layer_items(node_kind: &IrNodeKind) -> Vec<TextStrokeLayerItem> {
    let IrNodeKind::Text {
        strokes,
        stroke,
        stroke_width,
        stroke_linecap,
        stroke_linejoin,
        stroke_dasharray,
        stroke_miterlimit,
        ..
    } = node_kind
    else {
        return Vec::new();
    };

    if let Some(layers) = strokes {
        return resolve_ir_text_stroke_layer_items(layers);
    }
    let Some(scalar_stroke) = stroke else {
        return Vec::new();
    };
    vec![TextStrokeLayerItem {
        color: scalar_stroke.clone(),
        width_px: stroke_width.unwrap_or(1.0),
        linejoin: stroke_linejoin.map_or_else(
            || "round".to_string(),
            |join| linejoin_str(join).to_string(),
        ),
        linecap: stroke_linecap
            .map_or_else(|| "round".to_string(), |cap| linecap_str(cap).to_string()),
        dasharray: stroke_dasharray.clone(),
        miterlimit: *stroke_miterlimit,
    }]
}

fn resolve_ir_text_stroke_layer_items(layers: &[TextStrokeLayer]) -> Vec<TextStrokeLayerItem> {
    layers
        .iter()
        .map(|layer| TextStrokeLayerItem {
            color: layer.color.clone(),
            width_px: layer.width_px,
            linejoin: layer
                .linejoin
                .clone()
                .unwrap_or_else(|| "round".to_string()),
            linecap: layer.linecap.clone().unwrap_or_else(|| "round".to_string()),
            dasharray: layer.dasharray.clone(),
            miterlimit: layer.miterlimit,
        })
        .collect()
}

fn text_glyph_items(
    node_id: &str,
    glyph_paths: &[TextOutlinePath],
    unit_samples: Option<&[crate::ir::types::TextUnitAnimationSample]>,
    identifier_namespace: &SvgIdentifierNamespace,
    declarative_animation: bool,
) -> Vec<TextGlyphItem> {
    let sample_by_unit_id: HashMap<&str, (usize, &crate::ir::types::TextUnitAnimationSample)> =
        unit_samples.map_or_else(HashMap::new, |samples| {
            samples
                .iter()
                .enumerate()
                .map(|(unit_index, sample)| (sample.unit_id.as_str(), (unit_index, sample)))
                .collect()
        });
    glyph_paths
        .iter()
        .map(|glyph| TextGlyphItem {
            d: glyph.d.clone(),
            fill: glyph.fill.clone(),
            missing: glyph.missing_glyph.unwrap_or(false),
            unit_paint: glyph.unit_id.as_deref().and_then(|unit_id| {
                let (unit_index, sample) = sample_by_unit_id.get(unit_id).copied()?;
                let bbox = sample.bbox?;
                Some(TextUnitPaintItem {
                    animation_class: declarative_animation
                        .then(|| unit_animation_names(node_id, unit_index, identifier_namespace).0),
                    transform: node_transform_attr(sample.transform.as_ref(), bbox),
                    opacity: sample.opacity.filter(|opacity| *opacity != 1.0),
                })
            }),
        })
        .collect()
}

fn resolve_text_item(
    node: &IrNode,
    identifier_namespace: &SvgIdentifierNamespace,
    declarative_animation: bool,
) -> Option<TextItem> {
    let IrNodeKind::Text {
        lines,
        font_size_px,
        glyph_paths,
        stroke,
        stroke_width,
        stroke_linecap,
        stroke_linejoin,
        stroke_dasharray,
        stroke_miterlimit,
        strokes,
        shadows,
        text_decorations,
        text_layout_kind,
        unit_animation_samples,
        ..
    } = &node.kind
    else {
        return None;
    };

    let glyph_paths = glyph_paths.as_deref().unwrap_or_default();
    if text_layout_kind.as_deref() != Some("path")
        && glyph_paths.is_empty()
        && text_decorations
            .as_ref()
            .is_none_or(|fragments| fragments.iter().all(|fragment| fragment.paths.is_empty()))
    {
        return None;
    }

    let label = lines
        .iter()
        .map(|line| line.text.as_str())
        .collect::<Vec<&str>>()
        .join("\n");

    let glyph_effect_specs = glyph_effect_range_specs(glyph_paths);
    let has_glyph_effect_metadata = !glyph_effect_specs.is_empty();
    let uniform_glyph_effect = uniform_glyph_effect_spec(&glyph_effect_specs, glyph_paths.len());
    let has_root_effect_layers = strokes.as_ref().is_some_and(|layers| !layers.is_empty())
        || shadows.as_ref().is_some_and(|layers| !layers.is_empty());
    let effect = if let Some(uniform_range) = uniform_glyph_effect {
        let shadow_layer_count = uniform_range.shadows.len();
        let stroke_layer_count = uniform_range.strokes.len();
        (shadow_layer_count > 0 || stroke_layer_count > 0).then(|| TextEffectItem {
            ranges: vec![TextEffectRangeItem {
                glyph_indices: (0..glyph_paths.len()).collect(),
                shadows: uniform_range
                    .shadows
                    .iter()
                    .enumerate()
                    .map(|(layer_index, shadow)| TextShadowLayerItem {
                        filter_ref: identifier_namespace.identifier(
                            SvgIdentifierRole::FilterId,
                            &format!("{}:ts{layer_index}", node.node_id),
                        ),
                        color: shadow.color.clone(),
                    })
                    .collect(),
                strokes: resolve_ir_text_stroke_layer_items(&uniform_range.strokes),
            }],
            shadow_layer_count,
            stroke_layer_count,
        })
    } else if has_glyph_effect_metadata {
        let shadow_layer_count = glyph_effect_specs
            .iter()
            .map(|range| range.shadows.len())
            .max()
            .unwrap_or(0);
        let stroke_layer_count = glyph_effect_specs
            .iter()
            .map(|range| range.strokes.len())
            .max()
            .unwrap_or(0);
        (shadow_layer_count > 0 || stroke_layer_count > 0).then(|| TextEffectItem {
            ranges: glyph_effect_specs
                .iter()
                .enumerate()
                .map(|(range_index, range)| TextEffectRangeItem {
                    glyph_indices: range.glyph_indices.clone(),
                    shadows: range
                        .shadows
                        .iter()
                        .enumerate()
                        .map(|(layer_index, shadow)| TextShadowLayerItem {
                            filter_ref: identifier_namespace.identifier(
                                SvgIdentifierRole::FilterId,
                                &format!("{}:pr{range_index}:ts{layer_index}", node.node_id),
                            ),
                            color: shadow.color.clone(),
                        })
                        .collect(),
                    strokes: resolve_ir_text_stroke_layer_items(&range.strokes),
                })
                .collect(),
            shadow_layer_count,
            stroke_layer_count,
        })
    } else {
        has_root_effect_layers.then(|| TextEffectItem {
            ranges: vec![TextEffectRangeItem {
                glyph_indices: (0..glyph_paths.len()).collect(),
                shadows: shadows
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .enumerate()
                    .map(|(layer_index, shadow)| TextShadowLayerItem {
                        filter_ref: identifier_namespace.identifier(
                            SvgIdentifierRole::FilterId,
                            &format!("{}:ts{layer_index}", node.node_id),
                        ),
                        color: shadow.color.clone(),
                    })
                    .collect(),
                strokes: resolve_text_stroke_layer_items(&node.kind),
            }],
            shadow_layer_count: shadows.as_deref().map_or(0, <[_]>::len),
            stroke_layer_count: resolve_text_stroke_layer_items(&node.kind).len(),
        })
    };

    let scalar_stroke = if has_glyph_effect_metadata || has_root_effect_layers {
        None
    } else {
        stroke.as_ref().map(|stroke_color| TextScalarStroke {
            stroke: stroke_color.clone(),
            stroke_width: *stroke_width,
            stroke_linecap: *stroke_linecap,
            stroke_linejoin: *stroke_linejoin,
            stroke_dasharray: stroke_dasharray.clone(),
            stroke_miterlimit: *stroke_miterlimit,
        })
    };

    Some(TextItem {
        node_id: node.node_id.clone(),
        label,
        font_size_px: *font_size_px,
        glyphs: text_glyph_items(
            &node.node_id,
            glyph_paths,
            unit_animation_samples.as_deref(),
            identifier_namespace,
            declarative_animation,
        ),
        scalar_stroke,
        effect,
        decorations: text_decorations
            .as_deref()
            .unwrap_or_default()
            .iter()
            .flat_map(|fragment| {
                if fragment.style == crate::text::types::TextDecorationStyle::Wavy
                    && fragment.paths.len() > 1
                {
                    let mut merged_items = Vec::<TextDecorationItem>::new();
                    for path in &fragment.paths {
                        if let Some(previous_item) = merged_items.last_mut()
                            && previous_item.origin_x == path.origin_x
                            && previous_item.origin_y == path.origin_y
                        {
                            previous_item.d.push(' ');
                            previous_item.d.push_str(&path.d);
                        } else {
                            merged_items.push(TextDecorationItem {
                                line: fragment.line,
                                d: path.d.clone(),
                                origin_x: path.origin_x,
                                origin_y: path.origin_y,
                                color: fragment.color.clone(),
                            });
                        }
                    }
                    merged_items
                } else {
                    fragment
                        .paths
                        .iter()
                        .map(|path| TextDecorationItem {
                            line: fragment.line,
                            d: path.d.clone(),
                            origin_x: path.origin_x,
                            origin_y: path.origin_y,
                            color: fragment.color.clone(),
                        })
                        .collect()
                }
            })
            .collect(),
    })
}

fn resolve_shape_item(
    node: &IrNode,
    shared: &SharedShapePathIndex,
) -> Result<ShapeItem, EngineError> {
    let IrNodeKind::Shape { shape_parts, .. } = &node.kind else {
        return Ok(ShapeItem {
            node_id: node.node_id.clone(),
            bbox: node.bbox,
            parts: Vec::new(),
        });
    };

    let paint_node = ShapePaintNode::from_shape_kind(&node.kind);
    let shared_paint_attrs = build_shape_paint_attrs(&paint_node, None, ShapePaintMode::All)?;

    let mut parts: Vec<ShapePartItem> = Vec::new();
    for part in shape_parts {
        // A part with its own stroke path needs two elements: the fill
        // follows the normalized `d`, the stroke follows `strokeD`.
        if part.stroke_d.is_some() {
            parts.push(resolve_split_shape_part(&paint_node, part)?);
            continue;
        }

        let paint_attrs = match &part.paint {
            Some(paint) => build_shape_paint_attrs(&paint_node, Some(paint), ShapePaintMode::All)?,
            None => shared_paint_attrs.clone(),
        };
        let key = shape_part_content_key(&part.d, &paint_attrs);
        if let Some(shared_id) = shared_lookup(shared, &key) {
            parts.push(ShapePartItem::Use {
                href_id: shared_id.to_string(),
                part_id: part.part_id.clone(),
            });
            continue;
        }
        parts.push(ShapePartItem::Single {
            d: part.d.clone(),
            paint_attrs,
            part_id: part.part_id.clone(),
        });
    }

    Ok(ShapeItem {
        node_id: node.node_id.clone(),
        bbox: node.bbox,
        parts,
    })
}

/// Mirror of `emitSplitShapePart`: fill rides `d`, stroke rides `strokeD`.
fn resolve_split_shape_part(
    paint_node: &ShapePaintNode,
    part: &ShapePathPart,
) -> Result<ShapePartItem, EngineError> {
    let stroke = part
        .paint
        .as_ref()
        .and_then(|paint| paint.stroke.as_deref())
        .or(paint_node.stroke.as_deref());
    let fill = part
        .paint
        .as_ref()
        .and_then(|paint| paint.fill.as_deref())
        .or(paint_node.fill.as_deref());

    // With neither paint specified SVG defaults to a black fill. When only a
    // stroke is specified, boundsvg's existing Shape contract emits fill=none.
    let should_fill = match fill {
        None => stroke.is_none(),
        Some(fill_value) => fill_value != "none",
    };

    let fill_path = if !part.d.is_empty() && should_fill {
        Some(SplitShapePath {
            d: part.d.clone(),
            attrs: build_shape_paint_attrs(paint_node, part.paint.as_ref(), ShapePaintMode::Fill)?,
            part_id: part.part_id.clone(),
        })
    } else {
        None
    };

    let stroke_path = if stroke.is_some_and(|stroke_value| stroke_value != "none") {
        // resolve_split_shape_part is only called when stroke_d is present.
        part.stroke_d
            .as_ref()
            .map(|stroke_d| -> Result<SplitShapePath, EngineError> {
                Ok(SplitShapePath {
                    d: stroke_d.clone(),
                    attrs: build_shape_paint_attrs(
                        paint_node,
                        part.paint.as_ref(),
                        ShapePaintMode::Stroke,
                    )?,
                    part_id: part.part_id.clone(),
                })
            })
            .transpose()?
    } else {
        None
    };

    Ok(ShapePartItem::Split {
        fill: fill_path,
        stroke: stroke_path,
    })
}

// ---------------------------------------------------------------------------
// Debug overlay resolution (mirrors emitDebugOverlays)
// ---------------------------------------------------------------------------

fn node_layout_box(node: &IrNode) -> BBox {
    if let IrNodeKind::Text { layout_box, .. } = &node.kind {
        return *layout_box;
    }
    node.bbox
}

fn resolve_debug_overlays(
    node: &IrNode,
    identifier_namespace: &SvgIdentifierNamespace,
    parts: DebugParts,
    items: &mut Vec<PaintItem>,
) {
    let (transform, clip_path) = match &node.kind {
        IrNodeKind::Group {
            transform,
            clip_path,
            ..
        } => (transform.as_ref(), clip_path.as_ref()),
        _ => (None, None),
    };

    let transform_attr = node_transform_attr(transform, node.bbox);
    let clip_ref = clip_path
        .is_some()
        .then(|| identifier_namespace.identifier(SvgIdentifierRole::ClipPathId, &node.node_id));

    if transform_attr.is_some() || clip_ref.is_some() {
        items.push(PaintItem::GroupOpen(GroupOpenItem {
            transform: transform_attr,
            clip_ref,
            ..GroupOpenItem::default()
        }));
        resolve_debug_overlay_node(node, identifier_namespace, parts, items);
        items.push(PaintItem::GroupClose);
        return;
    }

    resolve_debug_overlay_node(node, identifier_namespace, parts, items);
}

fn resolve_debug_overlay_node(
    node: &IrNode,
    identifier_namespace: &SvgIdentifierNamespace,
    parts: DebugParts,
    items: &mut Vec<PaintItem>,
) {
    if !matches!(node.kind, IrNodeKind::Group { .. }) {
        if parts.specified {
            items.push(PaintItem::DebugRect(DebugRectItem {
                bbox: node_layout_box(node),
                kind: DebugRectKind::Specified,
            }));
        }
        if parts.layout {
            for line_bbox in resolve_line_layout_bboxes(node) {
                items.push(PaintItem::DebugRect(DebugRectItem {
                    bbox: line_bbox,
                    kind: DebugRectKind::Layout,
                }));
            }
            push_shape_part_bounds_rects(node, items);
        }
        if parts.actual {
            if let Some(measured_bbox) = resolve_measured_glyph_bbox(node) {
                items.push(PaintItem::DebugRect(DebugRectItem {
                    bbox: measured_bbox,
                    kind: DebugRectKind::Actual,
                }));
            }
        }
    }
    if parts.baseline {
        push_debug_text_baselines(node, items);
    }
    if let IrNodeKind::Group { children, .. } = &node.kind {
        for child in children {
            resolve_debug_overlays(child, identifier_namespace, parts, items);
        }
    }
}

fn push_shape_part_bounds_rects(node: &IrNode, items: &mut Vec<PaintItem>) {
    let IrNodeKind::Shape { shape_parts, .. } = &node.kind else {
        return;
    };
    for shape_part in shape_parts {
        let Some(bounds) = &shape_part.bounds else {
            continue;
        };
        items.push(PaintItem::DebugRect(DebugRectItem {
            bbox: BBox {
                x: node.bbox.x + bounds.x,
                y: node.bbox.y + bounds.y,
                w: bounds.width,
                h: bounds.height,
            },
            kind: DebugRectKind::Layout,
        }));
    }
}

/// Tight bounding box of a text node's rendered glyph ink.
/// Mirrors `resolveMeasuredGlyphBBox`.
fn resolve_measured_glyph_bbox(node: &IrNode) -> Option<BBox> {
    // The "actual" debug part describes glyph ink (plus scalar glyph stroke),
    // not paint-only decoration geometry. Decorations must not affect layout or
    // the established meaning of this glyph measurement overlay.
    let IrNodeKind::Text {
        glyph_paths,
        stroke,
        stroke_width,
        ..
    } = &node.kind
    else {
        return None;
    };
    let glyph_paths = glyph_paths.as_ref()?;
    if glyph_paths.is_empty() {
        return None;
    }

    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for glyph_path in glyph_paths {
        min_x = min_x.min(glyph_path.bbox.x);
        min_y = min_y.min(glyph_path.bbox.y);
        max_x = max_x.max(glyph_path.bbox.x + glyph_path.bbox.w);
        max_y = max_y.max(glyph_path.bbox.y + glyph_path.bbox.h);
    }
    if !min_x.is_finite() || !min_y.is_finite() {
        return None;
    }

    let stroke_inset = if stroke.is_some() {
        stroke_width.unwrap_or(1.0) / 2.0
    } else {
        0.0
    };
    Some(BBox {
        x: min_x - stroke_inset,
        y: min_y - stroke_inset,
        w: max_x - min_x + stroke_inset * 2.0,
        h: max_y - min_y + stroke_inset * 2.0,
    })
}

fn resolve_aligned_line_start(start: f64, size: f64, line_size: f64, align: IrTextAlign) -> f64 {
    match align {
        IrTextAlign::Center => start + (size - line_size) / 2.0,
        IrTextAlign::End => start + size - line_size,
        IrTextAlign::Start => start,
    }
}

/// Mirror of `resolveLineLayoutBBoxes` (empty for non-text nodes).
fn resolve_line_layout_bboxes(node: &IrNode) -> Vec<BBox> {
    let IrNodeKind::Text {
        lines,
        layout_box,
        writing_mode,
        line_height_px,
        text_align,
        ..
    } = &node.kind
    else {
        return Vec::new();
    };
    if lines.is_empty() {
        return Vec::new();
    }

    let line_count = lines.len() as f64;
    if writing_mode.as_deref() == Some("vertical-rl") {
        // TS `lineHeightPx ?? bbox.w / lineCount`: the Rust IR field is
        // required, so the fallback never fires.
        let column_width = *line_height_px;
        let _ = line_count;
        return lines
            .iter()
            .enumerate()
            .map(|(line_index, line)| BBox {
                x: layout_box.x + layout_box.w - (line_index as f64 + 1.0) * column_width,
                y: resolve_aligned_line_start(layout_box.y, layout_box.h, line.width, *text_align),
                w: column_width,
                h: line.width,
            })
            .collect();
    }

    let line_height = *line_height_px;
    let _ = line_count;
    lines
        .iter()
        .enumerate()
        .map(|(line_index, line)| BBox {
            x: resolve_aligned_line_start(layout_box.x, layout_box.w, line.width, *text_align),
            y: layout_box.y + line_index as f64 * line_height,
            w: line.width,
            h: line_height,
        })
        .collect()
}

/// Mirror of `resolveVerticalBaselineX`.
fn resolve_vertical_baseline_x(node: &IrNode, line: &Line, line_index: usize) -> f64 {
    let IrNodeKind::Text {
        lines,
        layout_box,
        line_height_px,
        font_size_px,
        ..
    } = &node.kind
    else {
        return 0.0;
    };

    let absolute_glyphs: Vec<_> = line
        .positioned_glyphs
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter(|glyph| glyph.absolute_position == Some(true))
        .collect();
    if !absolute_glyphs.is_empty() {
        let largest_font_size = absolute_glyphs
            .iter()
            .map(|glyph| glyph.font_size_px.unwrap_or(*font_size_px))
            .fold(f64::NEG_INFINITY, f64::max);
        let baseline_offsets: Vec<f64> = absolute_glyphs
            .iter()
            .filter(|glyph| glyph.font_size_px.unwrap_or(*font_size_px) == largest_font_size)
            .map(|glyph| glyph.origin_x - glyph.x_offset)
            .collect();
        let offset_sum: f64 = baseline_offsets.iter().sum();
        return layout_box.x + offset_sum / baseline_offsets.len() as f64;
    }

    let _line_count = lines.len().max(1) as f64;
    let column_width = *line_height_px;
    layout_box.x + layout_box.w - (line_index as f64 + 0.5) * column_width
}

/// Mirror of `emitDebugTextBaselines`.
fn push_debug_text_baselines(node: &IrNode, items: &mut Vec<PaintItem>) {
    let IrNodeKind::Text {
        lines,
        layout_box,
        writing_mode,
        ..
    } = &node.kind
    else {
        return;
    };

    let line_layout_bboxes = resolve_line_layout_bboxes(node);
    for (line_index, line) in lines.iter().enumerate() {
        let line_layout_bbox = line_layout_bboxes
            .get(line_index)
            .copied()
            .unwrap_or(*layout_box);
        if writing_mode.as_deref() == Some("vertical-rl") {
            let x = resolve_vertical_baseline_x(node, line, line_index);
            let y1 = layout_box.y.max(line_layout_bbox.y);
            let y2 =
                y1.max((layout_box.y + layout_box.h).min(line_layout_bbox.y + line_layout_bbox.h));
            items.push(PaintItem::DebugLine(DebugLineItem {
                x1: x,
                y1,
                x2: x,
                y2,
            }));
            continue;
        }
        let y = layout_box.y + line.baseline_y;
        let x1 = layout_box.x.max(line_layout_bbox.x);
        let x2 = x1.max((layout_box.x + layout_box.w).min(line_layout_bbox.x + line_layout_bbox.w));
        items.push(PaintItem::DebugLine(DebugLineItem {
            x1,
            y1: y,
            x2,
            y2: y,
        }));
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests;
