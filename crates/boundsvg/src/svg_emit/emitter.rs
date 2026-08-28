//! SVG string emitter.
//!
//! Translates a resolved `PaintScene` (see `crate::scene`) into the SVG
//! document string.
//!
//! Layer contract: the emitter never reorders items or defs and never adds
//! or drops elements — element order, group boundaries/attributes, and the
//! defs inventory (ids + collection order) arrive fully resolved from the
//! scene. What *is* computed here: the subtree of each def entry
//! (feDropShadow-vs-blur/morphology filter branching and filter-region
//! percentages, linear-vs-radial gradient branching and angle trigonometry,
//! clipPath per-corner/uniform/none content, rounded-rect path geometry),
//! per-leaf paint attribute selection, the text
//! effect-layer-vs-scalar-stroke grouping, and the tofu stroke-width
//! arithmetic. Indentation is two spaces per depth; parts join with `\n`.

use crate::error::EngineError;
use crate::ir::animation_timeline::{
    CompiledCssEasing, CssIterationCount, DocumentAnimationPlan, DocumentKeyframe,
    MAX_TIMELINE_CSS_BYTES,
};
use crate::ir::gradient::angle_to_svg_coords;
use crate::ir::types::{
    AnimationEasing, AnimationIterations, AnimationKeyframe, AnimationSpring, AnimationTransform2D,
    BBox, BorderRadii, BorderRadius, Gradient, RadialGradientGeometry,
};
use crate::scene::{
    AnimationPlaybackStyle, ClipPathDef, DebugLineItem, DebugRectItem, DebugRectKind, FilterDef,
    GradientDef, GroupOpenItem, ImageItem, NestedSvgItem, PaintItem, PaintScene, PathItem,
    RectItem, ReducedMotionMode, ShapePartItem, SharedShapePathDef, TextGlyphItem, TextItem,
};
use crate::svg_emit::identifier_namespace::{SvgIdentifierNamespace, SvgIdentifierRole};
use crate::svg_emit::num_format::{format_js_number, format_number};
use crate::svg_emit::paint::{
    StrokeStyleFields, append_stroke_style_attrs, linecap_str, linejoin_str,
};
use crate::svg_emit::xml::{escape_css_identifier, escape_xml};

const NODE_ID_ATTR: &str = "data-boundsvg-node-id";

/// Whether generated node identity metadata is serialized into the SVG.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum NodeIdMetadata {
    /// Preserve the generated `data-boundsvg-node-id` attributes.
    #[default]
    Include,
    /// Omit only generated node identity attributes.
    Omit,
}

/// Serialization-only SVG emitter options.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SvgEmitOptions {
    pub node_id_metadata: NodeIdMetadata,
}

impl SvgEmitOptions {
    fn includes_node_ids(self) -> bool {
        self.node_id_metadata == NodeIdMetadata::Include
    }
}

/// Stroke width for missing-glyph tofu markers, relative to font size.
const MISSING_GLYPH_STROKE_RATIO: f64 = 0.06;
/// Interpolated as a JS number literal — always the bytes `0.5`.
const MISSING_GLYPH_OPACITY: &str = "0.5";

// Debug overlay stroke colors (see the TS emitter's constants).
const DEBUG_SPECIFIED_STROKE: &str = "#38bdf8";
const DEBUG_LAYOUT_STROKE: &str = "#22c55e";
const DEBUG_LAYOUT_STROKE_DASHARRAY: &str = "4,2";
const DEBUG_ACTUAL_STROKE: &str = "#ff0000";
const DEBUG_BASELINE_STROKE: &str = "#fbbf24";

fn indent_str(depth: usize) -> String {
    "  ".repeat(depth)
}

fn fmt2(value: f64) -> Result<String, EngineError> {
    format_number(value, 2)
}

/// Emit the SVG document for a resolved paint scene.
///
/// # Errors
///
/// Returns `EngineError::Validation` when a non-finite number reaches an
/// attribute formatting site (matching the TS `formatNumber` guard).
pub fn emit_svg_scene(scene: &PaintScene, options: SvgEmitOptions) -> Result<String, EngineError> {
    let mut parts: Vec<String> = Vec::new();

    // Build <svg> opening tag. Always emit width/height so browser layout
    // does not resolve to 0x0 when only viewBox is present.
    let mut svg_attrs: Vec<String> = vec![
        "xmlns=\"http://www.w3.org/2000/svg\"".to_string(),
        format!(
            "viewBox=\"0 0 {} {}\"",
            fmt2(scene.width)?,
            fmt2(scene.height)?
        ),
        format!("width=\"{}\"", fmt2(scene.width * scene.scale)?),
        format!("height=\"{}\"", fmt2(scene.height * scene.scale)?),
    ];
    if options.includes_node_ids() {
        svg_attrs.insert(
            1,
            format!("{NODE_ID_ATTR}=\"{}\"", escape_xml(&scene.root_node_id)),
        );
    }
    // The root group wrapper is skipped, so Canvas meta rides on the <svg>.
    if let Some(meta) = &scene.root_meta {
        for (key, value) in meta {
            svg_attrs.push(format!(
                "data-boundsvg-meta-{key}=\"{}\"",
                escape_xml(value)
            ));
        }
    }
    parts.push(format!("<svg {}>", svg_attrs.join(" ")));

    if let Some(generator) = &scene.generator {
        parts.push(format!(
            "  <metadata data-boundsvg-generator=\"{}\" data-boundsvg-generator-version=\"{}\"/>",
            escape_xml(&generator.name),
            escape_xml(&generator.version)
        ));
    }

    if scene.defs.has_defs() {
        parts.push(emit_defs(scene)?);
    }
    if !scene.animations.is_empty() || !scene.canvas_strokes.is_empty() {
        parts.push(emit_styles(scene)?);
    }

    emit_items(&scene.items, 1, &mut parts, options)?;

    if let Some(debug_items) = &scene.debug_items {
        parts.push(format!(
            "  <g class=\"{}\" opacity=\"0.4\">",
            escape_xml(&scene.debug_overlay_class)
        ));
        emit_items(debug_items, 2, &mut parts, options)?;
        parts.push("  </g>".to_string());
    }

    parts.push("</svg>".to_string());
    Ok(parts.join("\n"))
}

fn emit_items(
    items: &[PaintItem],
    base_depth: usize,
    parts: &mut Vec<String>,
    options: SvgEmitOptions,
) -> Result<(), EngineError> {
    let mut depth = base_depth;
    for item in items {
        match item {
            PaintItem::GroupOpen(open) => {
                parts.push(emit_group_open(open, depth, options)?);
                if !open.self_close {
                    depth += 1;
                }
            }
            PaintItem::GroupClose => {
                depth = depth.saturating_sub(1);
                parts.push(format!("{}</g>", indent_str(depth)));
            }
            PaintItem::Rect(rect) => {
                parts.push(format!(
                    "{}{}",
                    indent_str(depth),
                    emit_rect(rect, options)?
                ));
            }
            PaintItem::Text(text) => {
                parts.push(emit_text(text, &indent_str(depth), options)?);
            }
            PaintItem::Image(image) => {
                parts.push(format!(
                    "{}{}",
                    indent_str(depth),
                    emit_image(image, options)?
                ));
            }
            PaintItem::Path(path) => {
                // Multi-line markup with the indent applied only to the
                // first line — a TS quirk kept byte-for-byte.
                parts.push(format!(
                    "{}{}",
                    indent_str(depth),
                    emit_path(path, options)?
                ));
            }
            PaintItem::NestedSvg(nested) => {
                parts.push(emit_nested_svg(nested, &indent_str(depth), options)?);
            }
            PaintItem::Shape(shape) => {
                parts.push(emit_shape(shape, &indent_str(depth), options)?);
            }
            PaintItem::DebugRect(rect) => {
                parts.push(format!("{}{}", indent_str(depth), emit_debug_rect(rect)?));
            }
            PaintItem::DebugLine(line) => {
                parts.push(format!("{}{}", indent_str(depth), emit_debug_line(line)?));
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

fn emit_group_open(
    open: &GroupOpenItem,
    depth: usize,
    options: SvgEmitOptions,
) -> Result<String, EngineError> {
    let mut attrs: Vec<String> = Vec::new();
    if options.includes_node_ids()
        && let Some(node_id) = &open.node_id
    {
        attrs.push(format!("{NODE_ID_ATTR}=\"{}\"", escape_xml(node_id)));
    }
    if let Some(animation_class) = &open.animation_class {
        attrs.push(format!("class=\"{}\"", escape_xml(animation_class)));
    }
    if let Some(meta) = &open.meta {
        for (key, value) in meta {
            attrs.push(format!(
                "data-boundsvg-meta-{key}=\"{}\"",
                escape_xml(value)
            ));
        }
    }
    if let Some(transform) = &open.transform {
        attrs.push(format!("transform=\"{}\"", escape_xml(transform)));
    }
    if let Some(clip_ref) = &open.clip_ref {
        attrs.push(format!("clip-path=\"url(#{})\"", escape_xml(clip_ref)));
    }
    if let Some(filter_ref) = &open.filter_ref {
        attrs.push(format!("filter=\"url(#{})\"", escape_xml(filter_ref)));
    }
    if let Some(opacity) = open.opacity {
        attrs.push(format!("opacity=\"{}\"", fmt2(opacity)?));
    }

    let attr_str = if attrs.is_empty() {
        String::new()
    } else {
        format!(" {}", attrs.join(" "))
    };
    let indent = indent_str(depth);
    if open.self_close {
        Ok(format!("{indent}<g{attr_str}/>"))
    } else {
        Ok(format!("{indent}<g{attr_str}>"))
    }
}

fn animation_transform_css(
    transform: &AnimationTransform2D,
    bbox: BBox,
) -> Result<String, EngineError> {
    let center_x = bbox.x + bbox.w / 2.0;
    let center_y = bbox.y + bbox.h / 2.0;
    Ok(format!(
        "translate({}px, {}px) translate({}px, {}px) rotate({}deg) scale({}, {}) translate({}px, {}px)",
        format_number(transform.translate_x.unwrap_or(0.0), 6)?,
        format_number(transform.translate_y.unwrap_or(0.0), 6)?,
        format_number(center_x, 6)?,
        format_number(center_y, 6)?,
        format_number(transform.rotate_deg.unwrap_or(0.0), 6)?,
        format_number(transform.scale_x.unwrap_or(1.0), 6)?,
        format_number(transform.scale_y.unwrap_or(1.0), 6)?,
        format_number(-center_x, 6)?,
        format_number(-center_y, 6)?
    ))
}

/// Number of `linear()` stops used to approximate a spring curve.
///
/// Stops sit at `i / (SPRING_LINEAR_STOPS - 1)`, so the count is one more than
/// the number of intervals.
const SPRING_LINEAR_STOPS: usize = 65;

/// Expand a spring easing into a CSS `linear()` easing function.
///
/// The stop count and the fixed six-decimal formatting are part of the byte
/// determinism contract — both must stay stable across releases.
///
/// # Errors
///
/// Returns `INVALID_NUMBER` if a stop is not finite. MD-03 requires the fixed
/// `{:.6}` form, which cannot go through `format_number`, so this restores the
/// guard that every other numeric emit site gets from it. Validation already
/// rejects the parameters that could get here, so this is defense in depth —
/// but unlike a `debug_assert`, it still holds in the shipped release build.
fn spring_to_css_linear(
    spring: &AnimationSpring,
    segment_duration_ms: f64,
) -> Result<String, EngineError> {
    let intervals = SPRING_LINEAR_STOPS - 1;
    let mut stops = Vec::with_capacity(SPRING_LINEAR_STOPS);
    for index in 0..SPRING_LINEAR_STOPS {
        #[expect(
            clippy::cast_precision_loss,
            reason = "index and intervals are both far below 2^53"
        )]
        let progress = index as f64 / intervals as f64;
        let value = if index == intervals {
            1.0
        } else {
            crate::ir::animation::sample_spring_progress(spring, progress, segment_duration_ms)
        };
        if !value.is_finite() {
            return Err(EngineError::Structured {
                code: "INVALID_NUMBER".to_string(),
                message: format!("Spring easing produced a non-finite stop at index {index}"),
                stage: Some("emit".to_string()),
                node_id: None,
            });
        }
        stops.push(format!("{value:.6}"));
    }
    Ok(format!("linear({})", stops.join(", ")))
}

/// Timing function to declare ahead of the real one as a parse-time fallback.
///
/// A UA that does not implement `linear()` drops that declaration while
/// parsing, so without a preceding declaration the property would silently
/// revert to its initial value `ease`. Emitting `linear` first degrades a
/// spring to straight interpolation between its keyframes instead, which is
/// far closer to the intended motion. UAs that do support `linear()` take the
/// later declaration, so supported playback is unaffected.
fn animation_easing_fallback_css(easing: Option<&AnimationEasing>) -> Option<&'static str> {
    matches!(easing, Some(AnimationEasing::Spring(_))).then_some("linear")
}

fn animation_easing_css(
    easing: Option<&AnimationEasing>,
    segment_duration_ms: f64,
) -> Result<String, EngineError> {
    match easing {
        None => Ok("ease".to_string()),
        Some(AnimationEasing::Named(name)) => Ok(name.clone()),
        Some(AnimationEasing::CubicBezier([x1, y1, x2, y2])) => Ok(format!(
            "cubic-bezier({}, {}, {}, {})",
            format_number(*x1, 6)?,
            format_number(*y1, 6)?,
            format_number(*x2, 6)?,
            format_number(*y2, 6)?
        )),
        Some(AnimationEasing::Spring(spring)) => spring_to_css_linear(spring, segment_duration_ms),
        Some(AnimationEasing::Steps(steps)) => Ok(format!(
            "steps({}, {})",
            animation_step_count_css(steps.count)?,
            steps.position.as_deref().unwrap_or("jump-end")
        )),
    }
}

fn animation_step_count_css(count: f64) -> Result<String, EngineError> {
    if !count.is_finite() {
        return format_number(count, 0);
    }
    // CSS <integer> excludes exponent tokens, so large step counts need full decimal form.
    Ok(format!("{count:.0}"))
}

fn animation_iterations_css(
    iterations: Option<&AnimationIterations>,
) -> Result<String, EngineError> {
    match iterations {
        None => Ok("1".to_string()),
        Some(AnimationIterations::Count(count)) => format_number(*count, 6),
        Some(AnimationIterations::Infinite(_)) => Ok("infinite".to_string()),
    }
}

fn emit_animation_keyframe(
    keyframe: &AnimationKeyframe,
    at: f64,
    bbox: BBox,
    indent: &str,
) -> Result<String, EngineError> {
    let mut declarations = Vec::new();
    if let Some(opacity) = keyframe.opacity {
        declarations.push(format!("opacity: {}", format_number(opacity, 6)?));
    }
    if let Some(transform) = &keyframe.transform {
        declarations.push(format!(
            "transform: {}",
            animation_transform_css(transform, bbox)?
        ));
    }
    Ok(format!(
        "{indent}{}% {{ {}; }}",
        format_number(at * 100.0, 6)?,
        declarations.join("; ")
    ))
}

fn emit_independent_animation_rule(
    animation: &crate::scene::AnimationStyle,
    time_ms: f64,
) -> Result<Vec<String>, EngineError> {
    let AnimationPlaybackStyle::Independent(spec) = &animation.playback else {
        return Ok(Vec::new());
    };
    let Some(first) = spec.keyframes.first() else {
        return Err(EngineError::Structured {
            code: "ANIMATION_INVALID_SPEC".to_string(),
            message: "Invalid animation: keyframes must contain at least two entries".to_string(),
            stage: Some("emit".to_string()),
            node_id: None,
        });
    };
    let Some(last) = spec.keyframes.last() else {
        return Err(EngineError::Structured {
            code: "ANIMATION_INVALID_SPEC".to_string(),
            message: "Invalid animation: keyframes must contain at least two entries".to_string(),
            stage: Some("emit".to_string()),
            node_id: None,
        });
    };
    let keyframes_name = escape_css_identifier(&animation.keyframes_name);
    let class_name = escape_css_identifier(&animation.class_name);
    let mut lines = vec![format!("    @keyframes {keyframes_name} {{")];
    if first.at > 0.0 {
        lines.push(emit_animation_keyframe(
            first,
            0.0,
            animation.bbox,
            "      ",
        )?);
    }
    for keyframe in &spec.keyframes {
        lines.push(emit_animation_keyframe(
            keyframe,
            keyframe.at,
            animation.bbox,
            "      ",
        )?);
    }
    if last.at < 1.0 {
        lines.push(emit_animation_keyframe(
            last,
            1.0,
            animation.bbox,
            "      ",
        )?);
    }
    lines.push("    }".to_string());

    let delay = spec.delay_ms.unwrap_or(0.0) - time_ms;
    lines.push(format!("    .{class_name} {{"));
    lines.push(format!("      animation-name: {keyframes_name};"));
    lines.push(format!(
        "      animation-duration: {}ms;",
        format_number(spec.duration_ms, 6)?
    ));
    lines.push(format!(
        "      animation-delay: {}ms;",
        format_number(delay, 6)?
    ));
    // CSS re-applies the element-level timing function to every keyframe
    // segment. Spring expansion therefore uses the first authored segment,
    // which matches the static sampler exactly for evenly spaced keyframes.
    let first_segment_duration_ms = spec.keyframes.get(1).map_or(spec.duration_ms, |second| {
        spec.duration_ms * (second.at - first.at)
    });
    if let Some(fallback) = animation_easing_fallback_css(spec.easing.as_ref()) {
        lines.push(format!("      animation-timing-function: {fallback};"));
    }
    lines.push(format!(
        "      animation-timing-function: {};",
        animation_easing_css(spec.easing.as_ref(), first_segment_duration_ms)?
    ));
    lines.push(format!(
        "      animation-iteration-count: {};",
        animation_iterations_css(spec.iterations.as_ref())?
    ));
    lines.push(format!(
        "      animation-fill-mode: {};",
        spec.fill.as_deref().unwrap_or("none")
    ));
    if spec
        .keyframes
        .iter()
        .any(|keyframe| keyframe.transform.is_some())
    {
        // Keyframes already bake the numeric bbox center into their transform
        // list. Neutralize the CSS/SVG default origin so browsers apply that
        // list in the document user space without a second implicit origin.
        lines.push("      transform-box: view-box;".to_string());
        lines.push("      transform-origin: 0 0;".to_string());
    }
    lines.push("    }".to_string());
    Ok(lines)
}

fn timeline_easing_css(easing: &CompiledCssEasing) -> String {
    match easing {
        CompiledCssEasing::Linear => "linear".to_string(),
        CompiledCssEasing::OutputScaledLinear(alpha) => {
            format!("linear(0, {})", format_js_number(*alpha))
        }
        CompiledCssEasing::CubicBezier([x1, y1, x2, y2]) => format!(
            "cubic-bezier({}, {}, {}, {})",
            format_js_number(*x1),
            format_js_number(*y1),
            format_js_number(*x2),
            format_js_number(*y2)
        ),
        CompiledCssEasing::StepEnd => "steps(1, end)".to_string(),
    }
}

fn timeline_iterations_css(iterations: CssIterationCount) -> String {
    match iterations {
        CssIterationCount::Finite(count) => format_js_number(count),
        CssIterationCount::Infinite => "infinite".to_string(),
    }
}

fn timeline_keyframe_declarations(
    keyframe: &DocumentKeyframe,
    bbox: BBox,
) -> Result<String, EngineError> {
    let mut declarations = Vec::new();
    if let Some(opacity) = keyframe.value.opacity {
        declarations.push(format!("opacity: {}", format_number(opacity, 6)?));
    }
    if let Some(transform) = &keyframe.value.transform {
        declarations.push(format!(
            "transform: {}",
            animation_transform_css(transform, bbox)?
        ));
    }
    if let Some(easing) = &keyframe.easing_to_next {
        declarations.push(format!(
            "animation-timing-function: {}",
            timeline_easing_css(easing)
        ));
    }
    Ok(declarations.join("; "))
}

fn write_timeline_css(
    output: &mut impl std::fmt::Write,
    arguments: std::fmt::Arguments<'_>,
) -> Result<(), EngineError> {
    output.write_fmt(arguments).map_err(|_| {
        EngineError::Validation("Failed to write animated SVG timeline CSS".to_string())
    })
}

fn write_timeline_animation_rule(
    output: &mut impl std::fmt::Write,
    animation: &crate::scene::AnimationStyle,
) -> Result<bool, EngineError> {
    let AnimationPlaybackStyle::Timeline {
        duration_ms,
        delay_ms,
        iterations,
        keyframes,
    } = &animation.playback
    else {
        return Ok(false);
    };
    write_timeline_animation_rule_parts(
        output,
        &TimelineAnimationRule {
            class_name: &animation.class_name,
            keyframes_name: &animation.keyframes_name,
            bbox: animation.bbox,
            duration_ms: *duration_ms,
            delay_ms: *delay_ms,
            iterations: *iterations,
            keyframes,
        },
    )?;
    Ok(true)
}

struct TimelineAnimationRule<'a> {
    class_name: &'a str,
    keyframes_name: &'a str,
    bbox: BBox,
    duration_ms: f64,
    delay_ms: f64,
    iterations: CssIterationCount,
    keyframes: &'a [DocumentKeyframe],
}

fn write_timeline_animation_rule_parts(
    output: &mut impl std::fmt::Write,
    rule: &TimelineAnimationRule<'_>,
) -> Result<(), EngineError> {
    let keyframes_name = escape_css_identifier(rule.keyframes_name);
    let class_name = escape_css_identifier(rule.class_name);
    write_timeline_css(output, format_args!("    @keyframes {keyframes_name} {{\n"))?;
    for keyframe in rule.keyframes {
        write_timeline_css(
            output,
            format_args!(
                "      {}% {{ {}; }}\n",
                format_js_number(keyframe.time_ms / rule.duration_ms * 100.0),
                timeline_keyframe_declarations(keyframe, rule.bbox)?
            ),
        )?;
    }
    write_timeline_css(output, format_args!("    }}\n"))?;
    write_timeline_css(output, format_args!("    .{class_name} {{\n"))?;
    write_timeline_css(
        output,
        format_args!("      animation-name: {keyframes_name};\n"),
    )?;
    write_timeline_css(
        output,
        format_args!(
            "      animation-duration: {}ms;\n",
            format_js_number(rule.duration_ms)
        ),
    )?;
    write_timeline_css(
        output,
        format_args!(
            "      animation-delay: {}ms;\n",
            format_js_number(rule.delay_ms)
        ),
    )?;
    write_timeline_css(
        output,
        format_args!(
            "      animation-iteration-count: {};\n",
            timeline_iterations_css(rule.iterations)
        ),
    )?;
    write_timeline_css(output, format_args!("      animation-fill-mode: both;\n"))?;
    if rule
        .keyframes
        .iter()
        .any(|keyframe| keyframe.value.transform.is_some())
    {
        write_timeline_css(output, format_args!("      transform-box: view-box;\n"))?;
        write_timeline_css(output, format_args!("      transform-origin: 0 0;\n"))?;
    }
    write_timeline_css(output, format_args!("    }}"))?;
    Ok(())
}

fn timeline_animation_rule(
    animation: &crate::scene::AnimationStyle,
) -> Result<Option<String>, EngineError> {
    let mut rule = String::new();
    if write_timeline_animation_rule(&mut rule, animation)? {
        Ok(Some(rule))
    } else {
        Ok(None)
    }
}

#[derive(Default)]
struct CssByteCounter {
    bytes: usize,
}

impl std::fmt::Write for CssByteCounter {
    fn write_str(&mut self, value: &str) -> std::fmt::Result {
        self.bytes = self.bytes.saturating_add(value.len());
        Ok(())
    }
}

fn enforce_timeline_css_byte_limit(actual_css_bytes: usize) -> Result<(), EngineError> {
    if actual_css_bytes <= MAX_TIMELINE_CSS_BYTES {
        return Ok(());
    }
    Err(EngineError::StructuredContext {
        code: "ANIMATED_SVG_TIMELINE_LIMIT".to_string(),
        message: "Animated SVG timeline cssBytes exceeds the supported limit".to_string(),
        stage: Some("emit".to_string()),
        node_id: None,
        context: Box::new(serde_json::json!({
            "metric": "cssBytes",
            "actual": actual_css_bytes,
            "limit": MAX_TIMELINE_CSS_BYTES,
        })),
    })
}

fn timeline_css_byte_count(scene: &PaintScene) -> Result<usize, EngineError> {
    let mut counter = CssByteCounter::default();
    for animation in &scene.animations {
        if !write_timeline_animation_rule(&mut counter, animation)? {
            continue;
        }
        counter.bytes = counter.bytes.saturating_add(1);
        enforce_timeline_css_byte_limit(counter.bytes)?;
    }
    Ok(counter.bytes)
}

pub(crate) fn timeline_plan_css_byte_count(
    plan: &DocumentAnimationPlan,
    resource_id_prefix: &str,
) -> Result<usize, EngineError> {
    let identifier_namespace = SvgIdentifierNamespace::new(resource_id_prefix);
    let mut counter = CssByteCounter::default();
    for track in &plan.tracks {
        let class_name = identifier_namespace.identifier(
            SvgIdentifierRole::AnimationClass,
            &track.animation_name_owner,
        );
        let keyframes_name = identifier_namespace.identifier(
            SvgIdentifierRole::AnimationKeyframes,
            &track.animation_name_owner,
        );
        write_timeline_animation_rule_parts(
            &mut counter,
            &TimelineAnimationRule {
                class_name: &class_name,
                keyframes_name: &keyframes_name,
                bbox: track.bbox,
                duration_ms: plan.duration_ms,
                delay_ms: plan.css_delay_ms,
                iterations: plan.css_iteration_count,
                keyframes: &track.keyframes,
            },
        )?;
        counter.bytes = counter.bytes.saturating_add(1);
        enforce_timeline_css_byte_limit(counter.bytes)?;
    }
    Ok(counter.bytes)
}

/// Emit the opt-out that stops every animation this render started.
///
/// One block covering all animated classes, appended last so it wins over the
/// per-class rules above it. `scene.animations` is the single list every
/// animated class comes from, so iterating it cannot miss one the way
/// collecting from each emit site could.
///
/// The base pose invariant is what makes `animation: none` safe: the
/// element's attributes already carry the sampled pose, so stopping playback
/// leaves a coherent still rather than an unstyled element.
fn emit_reduced_motion_rule(scene: &PaintScene) -> Vec<String> {
    let selectors: Vec<String> = scene
        .animations
        .iter()
        .map(|animation| format!(".{}", escape_css_identifier(&animation.class_name)))
        .collect();
    if selectors.is_empty() {
        return Vec::new();
    }
    vec![
        "    @media (prefers-reduced-motion: reduce) {".to_string(),
        format!("      {} {{", selectors.join(", ")),
        "        animation: none !important;".to_string(),
        "      }".to_string(),
        "    }".to_string(),
    ]
}

fn emit_canvas_stroke_rules(scene: &PaintScene) -> Result<Vec<String>, EngineError> {
    if scene.canvas_strokes.is_empty() {
        return Ok(Vec::new());
    }
    let mut lines = vec!["    @supports (vector-effect: non-scaling-stroke) {".to_string()];
    for stroke in &scene.canvas_strokes {
        lines.push(format!(
            "      .{} {{",
            escape_css_identifier(&stroke.class_name)
        ));
        lines.push(format!(
            "        stroke-width: {};",
            format_number(stroke.authored_width, 6)?
        ));
        lines.push("        vector-effect: non-scaling-stroke;".to_string());
        lines.push("      }".to_string());
    }
    lines.push("    }".to_string());
    Ok(lines)
}

fn emit_styles(scene: &PaintScene) -> Result<String, EngineError> {
    let timeline_css_bytes = timeline_css_byte_count(scene)?;
    if let Some(expected_css_bytes) = scene.timeline_css_bytes
        && timeline_css_bytes != expected_css_bytes
    {
        return Err(EngineError::Validation(format!(
            "Animated SVG timeline CSS byte count changed between passes: expected {expected_css_bytes}, observed {timeline_css_bytes}"
        )));
    }
    let mut lines = vec!["  <style>".to_string()];
    for animation in &scene.animations {
        match &animation.playback {
            AnimationPlaybackStyle::Independent(_) => lines.extend(
                emit_independent_animation_rule(animation, scene.animation_time_ms)?,
            ),
            AnimationPlaybackStyle::Timeline { .. } => {
                if let Some(rule) = timeline_animation_rule(animation)? {
                    lines.extend(rule.lines().map(str::to_string));
                }
            }
        }
    }
    if scene.reduced_motion == ReducedMotionMode::Pause {
        lines.extend(emit_reduced_motion_rule(scene));
    }
    lines.extend(emit_canvas_stroke_rules(scene)?);
    lines.push("  </style>".to_string());
    Ok(lines.join("\n"))
}

// ---------------------------------------------------------------------------
// Rect
// ---------------------------------------------------------------------------

fn push_rect_paint_attrs(rect: &RectItem, attrs: &mut Vec<String>) -> Result<(), EngineError> {
    if let Some(gradient_ref) = &rect.gradient_ref {
        attrs.push(format!("fill=\"url(#{})\"", escape_xml(gradient_ref)));
    } else if rect.fill.as_deref().is_some_and(|fill| !fill.is_empty()) {
        if let Some(fill) = &rect.fill {
            attrs.push(format!("fill=\"{}\"", escape_xml(fill)));
        }
    } else if rect
        .stroke
        .as_deref()
        .is_some_and(|stroke| !stroke.is_empty())
    {
        attrs.push("fill=\"none\"".to_string());
    }

    if rect
        .stroke
        .as_deref()
        .is_some_and(|stroke| !stroke.is_empty())
    {
        if let Some(stroke) = &rect.stroke {
            attrs.push(format!("stroke=\"{}\"", escape_xml(stroke)));
        }
        if let Some(stroke_width) = rect.stroke_width {
            let formatted_width = if rect.canvas_stroke_class.is_some() {
                format_number(stroke_width, 6)?
            } else {
                fmt2(stroke_width)?
            };
            attrs.push(format!("stroke-width=\"{formatted_width}\""));
        }
        append_stroke_style_attrs(
            &StrokeStyleFields {
                linecap: rect.stroke_linecap.map(linecap_str),
                linejoin: rect.stroke_linejoin.map(linejoin_str),
                dasharray: rect.stroke_dasharray.as_deref(),
                miterlimit: rect.stroke_miterlimit,
            },
            attrs,
        )?;
    }
    Ok(())
}

fn emit_rect(rect: &RectItem, options: SvgEmitOptions) -> Result<String, EngineError> {
    // Per-corner borderRadius → use <path> instead of <rect>
    if let Some(BorderRadius::PerCorner(radii)) = rect.border_radius {
        return emit_rounded_rect_path(rect, radii, options);
    }

    let mut attrs: Vec<String> = vec![
        format!("x=\"{}\"", fmt2(rect.bbox.x)?),
        format!("y=\"{}\"", fmt2(rect.bbox.y)?),
        format!("width=\"{}\"", fmt2(rect.bbox.w)?),
        format!("height=\"{}\"", fmt2(rect.bbox.h)?),
    ];
    if options.includes_node_ids() && rect.emit_node_id_attr {
        attrs.push(format!("{NODE_ID_ATTR}=\"{}\"", escape_xml(&rect.node_id)));
    }
    if let Some(class_name) = &rect.canvas_stroke_class {
        attrs.push(format!("class=\"{}\"", escape_xml(class_name)));
    }

    if let Some(BorderRadius::Uniform(radius)) = rect.border_radius {
        attrs.push(format!("rx=\"{}\"", fmt2(radius)?));
        attrs.push(format!("ry=\"{}\"", fmt2(radius)?));
    }

    push_rect_paint_attrs(rect, &mut attrs)?;
    Ok(format!("<rect {}/>", attrs.join(" ")))
}

fn emit_rounded_rect_path(
    rect: &RectItem,
    radii: BorderRadii,
    options: SvgEmitOptions,
) -> Result<String, EngineError> {
    let mut attrs: Vec<String> = vec![format!(
        "d=\"{}\"",
        rounded_rect_path_data(rect.bbox, radii)?
    )];
    if options.includes_node_ids() && rect.emit_node_id_attr {
        attrs.push(format!("{NODE_ID_ATTR}=\"{}\"", escape_xml(&rect.node_id)));
    }
    if let Some(class_name) = &rect.canvas_stroke_class {
        attrs.push(format!("class=\"{}\"", escape_xml(class_name)));
    }
    push_rect_paint_attrs(rect, &mut attrs)?;
    Ok(format!("<path {}/>", attrs.join(" ")))
}

/// Rounded rectangle path with per-corner radii: arc commands per corner
/// (tl, tr, br, bl), clockwise from the top-left. Shared with clipPath defs.
fn rounded_rect_path_data(bbox: BBox, radii: BorderRadii) -> Result<String, EngineError> {
    let BBox { x, y, w, h } = bbox;
    let BorderRadii { tl, tr, br, bl } = radii;

    let segments = [
        format!("M{},{}", fmt2(x + tl)?, fmt2(y)?),
        format!("H{}", fmt2(x + w - tr)?),
        if tr > 0.0 {
            format!(
                "A{},{} 0 0 1 {},{}",
                fmt2(tr)?,
                fmt2(tr)?,
                fmt2(x + w)?,
                fmt2(y + tr)?
            )
        } else {
            format!("L{},{}", fmt2(x + w)?, fmt2(y)?)
        },
        format!("V{}", fmt2(y + h - br)?),
        if br > 0.0 {
            format!(
                "A{},{} 0 0 1 {},{}",
                fmt2(br)?,
                fmt2(br)?,
                fmt2(x + w - br)?,
                fmt2(y + h)?
            )
        } else {
            format!("L{},{}", fmt2(x + w)?, fmt2(y + h)?)
        },
        format!("H{}", fmt2(x + bl)?),
        if bl > 0.0 {
            format!(
                "A{},{} 0 0 1 {},{}",
                fmt2(bl)?,
                fmt2(bl)?,
                fmt2(x)?,
                fmt2(y + h - bl)?
            )
        } else {
            format!("L{},{}", fmt2(x)?, fmt2(y + h)?)
        },
        format!("V{}", fmt2(y + tl)?),
        if tl > 0.0 {
            format!(
                "A{},{} 0 0 1 {},{}",
                fmt2(tl)?,
                fmt2(tl)?,
                fmt2(x + tl)?,
                fmt2(y)?
            )
        } else {
            format!("L{},{}", fmt2(x)?, fmt2(y)?)
        },
        "Z".to_string(),
    ];
    Ok(segments.join(" "))
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

fn text_group_attrs(text: &TextItem, options: SvgEmitOptions) -> Vec<String> {
    let mut attrs: Vec<String> = vec![format!(
        "data-boundsvg-text=\"{}\"",
        escape_xml(&text.label)
    )];
    if options.includes_node_ids() {
        attrs.insert(
            0,
            format!("{NODE_ID_ATTR}=\"{}\"", escape_xml(&text.node_id)),
        );
    }
    if !text.label.is_empty() {
        attrs.push(format!("aria-label=\"{}\"", escape_xml(&text.label)));
    }
    attrs
}

fn emit_text_fill_glyph(
    glyph: &TextGlyphItem,
    text: &TextItem,
    indent: &str,
) -> Result<String, EngineError> {
    let path = if glyph.missing {
        let stroke_width = fmt2(text.font_size_px * MISSING_GLYPH_STROKE_RATIO)?;
        format!(
            "<path d=\"{}\" fill=\"none\" stroke=\"{}\" stroke-width=\"{stroke_width}\" opacity=\"{MISSING_GLYPH_OPACITY}\"/>",
            escape_xml(&glyph.d),
            escape_xml(&glyph.fill)
        )
    } else {
        format!(
            "<path d=\"{}\" fill=\"{}\"/>",
            escape_xml(&glyph.d),
            escape_xml(&glyph.fill)
        )
    };
    emit_text_unit_path(glyph, &path, indent)
}

fn emit_text_unit_path(
    glyph: &TextGlyphItem,
    path: &str,
    indent: &str,
) -> Result<String, EngineError> {
    let Some(unit_paint) = &glyph.unit_paint else {
        return Ok(format!("{indent}{path}"));
    };
    let mut attrs = Vec::new();
    if let Some(animation_class) = &unit_paint.animation_class {
        attrs.push(format!("class=\"{}\"", escape_xml(animation_class)));
    }
    if let Some(transform) = &unit_paint.transform {
        attrs.push(format!("transform=\"{}\"", escape_xml(transform)));
    }
    if let Some(opacity) = unit_paint.opacity {
        attrs.push(format!("opacity=\"{}\"", fmt2(opacity)?));
    }
    if attrs.is_empty() {
        return Ok(format!("{indent}{path}"));
    }
    Ok(format!(
        "{indent}<g {}>\n{indent}  {path}\n{indent}</g>",
        attrs.join(" ")
    ))
}

fn emit_text(
    text: &TextItem,
    indent: &str,
    options: SvgEmitOptions,
) -> Result<String, EngineError> {
    if let Some(effect) = &text.effect {
        return emit_text_effect_layers(text, effect, indent, options);
    }

    let mut group_attrs = text_group_attrs(text, options);
    if let Some(scalar_stroke) = &text.scalar_stroke {
        group_attrs.push(format!("stroke=\"{}\"", escape_xml(&scalar_stroke.stroke)));
        if let Some(stroke_width) = scalar_stroke.stroke_width {
            group_attrs.push(format!("stroke-width=\"{}\"", fmt2(stroke_width)?));
        }
        append_stroke_style_attrs(
            &StrokeStyleFields {
                linecap: scalar_stroke.stroke_linecap.map(linecap_str),
                linejoin: scalar_stroke.stroke_linejoin.map(linejoin_str),
                dasharray: scalar_stroke.stroke_dasharray.as_deref(),
                miterlimit: scalar_stroke.stroke_miterlimit,
            },
            &mut group_attrs,
        )?;
        group_attrs.push("paint-order=\"stroke\"".to_string());
    }

    let mut lines: Vec<String> = vec![format!("{indent}<g {}>", group_attrs.join(" "))];
    let glyph_indent = format!("{indent}  ");
    append_text_decorations(&mut lines, text, false, &glyph_indent)?;
    for glyph in &text.glyphs {
        lines.push(emit_text_fill_glyph(glyph, text, &glyph_indent)?);
    }
    append_text_decorations(&mut lines, text, true, &glyph_indent)?;
    lines.push(format!("{indent}</g>"));
    Ok(lines.join("\n"))
}

fn emit_text_effect_layers(
    text: &TextItem,
    effect: &crate::scene::TextEffectItem,
    indent: &str,
    options: SvgEmitOptions,
) -> Result<String, EngineError> {
    let mut lines: Vec<String> = Vec::new();
    let inner = format!("{indent}  ");
    let copy_indent = format!("{inner}  ");
    lines.push(format!(
        "{indent}<g {}>",
        text_group_attrs(text, options).join(" ")
    ));

    // Drop-shadow layers are node-wide: every range's layer N paints before
    // any range's stroke or fill.
    for layer_index in 0..effect.shadow_layer_count {
        for range in &effect.ranges {
            let Some(shadow) = range.shadows.get(layer_index) else {
                continue;
            };
            lines.push(format!(
                "{inner}<g filter=\"url(#{})\" fill=\"{}\">",
                escape_xml(&shadow.filter_ref),
                escape_xml(&shadow.color)
            ));
            for glyph_index in &range.glyph_indices {
                let Some(glyph) = text.glyphs.get(*glyph_index).filter(|glyph| !glyph.missing)
                else {
                    continue;
                };
                lines.push(emit_text_unit_path(
                    glyph,
                    &format!("<path d=\"{}\"/>", escape_xml(&glyph.d)),
                    &copy_indent,
                )?);
            }
            lines.push(format!("{inner}</g>"));
        }
    }

    append_text_decorations(&mut lines, text, false, &inner)?;

    // Outline layers are likewise node-wide and outermost first.
    for layer_index in 0..effect.stroke_layer_count {
        for range in &effect.ranges {
            let Some(stroke_layer) = range.strokes.get(layer_index) else {
                continue;
            };
            let mut layer_attrs: Vec<String> = vec![
                "fill=\"none\"".to_string(),
                format!("stroke=\"{}\"", escape_xml(&stroke_layer.color)),
                format!("stroke-width=\"{}\"", fmt2(stroke_layer.width_px)?),
                format!("stroke-linejoin=\"{}\"", escape_xml(&stroke_layer.linejoin)),
                format!("stroke-linecap=\"{}\"", escape_xml(&stroke_layer.linecap)),
            ];
            if let Some(dasharray) = &stroke_layer.dasharray {
                if !dasharray.is_empty() {
                    layer_attrs.push(format!("stroke-dasharray=\"{}\"", escape_xml(dasharray)));
                }
            }
            if let Some(miterlimit) = stroke_layer.miterlimit {
                if miterlimit != 4.0 {
                    layer_attrs.push(format!("stroke-miterlimit=\"{}\"", fmt2(miterlimit)?));
                }
            }
            lines.push(format!("{inner}<g {}>", layer_attrs.join(" ")));
            for glyph_index in &range.glyph_indices {
                let Some(glyph) = text.glyphs.get(*glyph_index).filter(|glyph| !glyph.missing)
                else {
                    continue;
                };
                lines.push(emit_text_unit_path(
                    glyph,
                    &format!("<path d=\"{}\"/>", escape_xml(&glyph.d)),
                    &copy_indent,
                )?);
            }
            lines.push(format!("{inner}</g>"));
        }
    }

    // Fill glyphs on top.
    for glyph in &text.glyphs {
        lines.push(emit_text_fill_glyph(glyph, text, &inner)?);
    }
    append_text_decorations(&mut lines, text, true, &inner)?;
    lines.push(format!("{indent}</g>"));
    Ok(lines.join("\n"))
}

fn append_text_decorations(
    lines: &mut Vec<String>,
    text: &TextItem,
    line_through: bool,
    indent: &str,
) -> Result<(), EngineError> {
    for decoration in &text.decorations {
        let is_line_through =
            decoration.line == crate::text::types::TextDecorationLine::LineThrough;
        if is_line_through != line_through {
            continue;
        }
        lines.push(format!(
            "{indent}<path d=\"{}\" transform=\"translate({} {})\" fill=\"{}\" stroke=\"none\"/>",
            escape_xml(&decoration.d),
            fmt2(decoration.origin_x)?,
            fmt2(decoration.origin_y)?,
            escape_xml(&decoration.color)
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

fn emit_image(image: &ImageItem, options: SvgEmitOptions) -> Result<String, EngineError> {
    let mut attrs: Vec<String> = vec![
        format!("href=\"{}\"", escape_xml(&image.src)),
        format!("x=\"{}\"", fmt2(image.bbox.x)?),
        format!("y=\"{}\"", fmt2(image.bbox.y)?),
        format!("width=\"{}\"", fmt2(image.bbox.w)?),
        format!("height=\"{}\"", fmt2(image.bbox.h)?),
    ];
    if options.includes_node_ids() {
        attrs.insert(
            0,
            format!("{NODE_ID_ATTR}=\"{}\"", escape_xml(&image.node_id)),
        );
    }
    if !image.preserve_aspect_ratio.is_empty() {
        attrs.push(format!(
            "preserveAspectRatio=\"{}\"",
            escape_xml(&image.preserve_aspect_ratio)
        ));
    }
    Ok(format!("<image {}/>", attrs.join(" ")))
}

// ---------------------------------------------------------------------------
// Path (wrapped in a nested <svg> for positioning + overflow clip)
// ---------------------------------------------------------------------------

fn emit_path(path: &PathItem, options: SvgEmitOptions) -> Result<String, EngineError> {
    let mut path_attrs: Vec<String> = vec![format!("d=\"{}\"", escape_xml(&path.d))];

    if let Some(class_name) = &path.canvas_stroke_class {
        path_attrs.push(format!("class=\"{}\"", escape_xml(class_name)));
    }

    if path.fill.as_deref().is_some_and(|fill| !fill.is_empty()) {
        if let Some(fill) = &path.fill {
            path_attrs.push(format!("fill=\"{}\"", escape_xml(fill)));
        }
    } else if path
        .stroke
        .as_deref()
        .is_some_and(|stroke| !stroke.is_empty())
    {
        path_attrs.push("fill=\"none\"".to_string());
    }

    if let Some(fill_rule) = path.fill_rule.as_deref() {
        if !fill_rule.is_empty() && fill_rule != "nonzero" {
            path_attrs.push(format!("fill-rule=\"{}\"", escape_xml(fill_rule)));
        }
    }

    if path
        .stroke
        .as_deref()
        .is_some_and(|stroke| !stroke.is_empty())
    {
        if let Some(stroke) = &path.stroke {
            path_attrs.push(format!("stroke=\"{}\"", escape_xml(stroke)));
        }
        if let Some(stroke_width) = path.stroke_width {
            let formatted_width = if path.canvas_stroke_class.is_some() {
                format_number(stroke_width, 6)?
            } else {
                fmt2(stroke_width)?
            };
            path_attrs.push(format!("stroke-width=\"{formatted_width}\""));
        }
        append_stroke_style_attrs(
            &StrokeStyleFields {
                linecap: path.stroke_linecap.map(linecap_str),
                linejoin: path.stroke_linejoin.map(linejoin_str),
                dasharray: path.stroke_dasharray.as_deref(),
                miterlimit: path.stroke_miterlimit,
            },
            &mut path_attrs,
        )?;
    }

    let BBox { x, y, w, h } = path.bbox;
    let mut svg_attrs = vec![
        format!("x=\"{}\"", fmt2(x)?),
        format!("y=\"{}\"", fmt2(y)?),
        format!("width=\"{}\"", fmt2(w)?),
        format!("height=\"{}\"", fmt2(h)?),
        "overflow=\"hidden\"".to_string(),
    ];
    if options.includes_node_ids() {
        svg_attrs.insert(
            0,
            format!("{NODE_ID_ATTR}=\"{}\"", escape_xml(&path.node_id)),
        );
    }
    Ok([
        format!("<svg {}>", svg_attrs.join(" ")),
        format!("  <path {}/>", path_attrs.join(" ")),
        "</svg>".to_string(),
    ]
    .join("\n"))
}

// ---------------------------------------------------------------------------
// Nested SVG
// ---------------------------------------------------------------------------

fn emit_nested_svg(
    nested: &NestedSvgItem,
    indent: &str,
    options: SvgEmitOptions,
) -> Result<String, EngineError> {
    let mut attrs: Vec<String> = vec![
        format!("x=\"{}\"", fmt2(nested.bbox.x)?),
        format!("y=\"{}\"", fmt2(nested.bbox.y)?),
        format!("width=\"{}\"", fmt2(nested.bbox.w)?),
        format!("height=\"{}\"", fmt2(nested.bbox.h)?),
    ];
    if options.includes_node_ids() {
        attrs.insert(
            0,
            format!("{NODE_ID_ATTR}=\"{}\"", escape_xml(&nested.node_id)),
        );
    }
    if let Some(view_box) = &nested.view_box {
        if !view_box.is_empty() {
            attrs.push(format!("viewBox=\"{}\"", escape_xml(view_box)));
        }
    }
    if !nested.preserve_aspect_ratio.is_empty() {
        attrs.push(format!(
            "preserveAspectRatio=\"{}\"",
            escape_xml(&nested.preserve_aspect_ratio)
        ));
    }

    let mut lines: Vec<String> = vec![format!("{indent}<svg {}>", attrs.join(" "))];
    // Indent inner content by one level
    for content_line in nested.content.split('\n') {
        lines.push(format!("{indent}  {content_line}"));
    }
    lines.push(format!("{indent}</svg>"));
    Ok(lines.join("\n"))
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

fn part_id_attr(part_id: Option<&str>) -> String {
    match part_id {
        Some(part_id) => format!(" data-boundsvg-part-id=\"{}\"", escape_xml(part_id)),
        None => String::new(),
    }
}

fn emit_shape(
    shape: &crate::scene::ShapeItem,
    indent: &str,
    options: SvgEmitOptions,
) -> Result<String, EngineError> {
    let mut svg_attrs = vec![
        format!("x=\"{}\"", fmt2(shape.bbox.x)?),
        format!("y=\"{}\"", fmt2(shape.bbox.y)?),
        format!("width=\"{}\"", fmt2(shape.bbox.w)?),
        format!("height=\"{}\"", fmt2(shape.bbox.h)?),
        "overflow=\"hidden\"".to_string(),
    ];
    if options.includes_node_ids() {
        svg_attrs.insert(
            0,
            format!("{NODE_ID_ATTR}=\"{}\"", escape_xml(&shape.node_id)),
        );
    }

    let mut lines: Vec<String> = vec![format!("{indent}<svg {}>", svg_attrs.join(" "))];
    for part in &shape.parts {
        match part {
            ShapePartItem::Use { href_id, part_id } => {
                lines.push(format!(
                    "{indent}  <use href=\"#{}\"{}/>",
                    escape_xml(href_id),
                    part_id_attr(part_id.as_deref())
                ));
            }
            ShapePartItem::Single {
                d,
                paint_attrs,
                part_id,
            } => {
                let mut path_attrs: Vec<String> = Vec::with_capacity(paint_attrs.len() + 1);
                path_attrs.push(format!("d=\"{}\"", escape_xml(d)));
                path_attrs.extend(paint_attrs.iter().cloned());
                lines.push(format!(
                    "{indent}  <path {}{}/>",
                    path_attrs.join(" "),
                    part_id_attr(part_id.as_deref())
                ));
            }
            ShapePartItem::Split { fill, stroke } => {
                // Both halves keep the TS template shape
                // `<path d="..." ${attrs}${partIdAttr}/>` — with empty attrs
                // this leaves a trailing space, byte-for-byte as before.
                for half in [fill, stroke].into_iter().flatten() {
                    lines.push(format!(
                        "{indent}  <path d=\"{}\" {}{}/>",
                        escape_xml(&half.d),
                        half.attrs.join(" "),
                        part_id_attr(half.part_id.as_deref())
                    ));
                }
            }
        }
    }
    lines.push(format!("{indent}</svg>"));
    Ok(lines.join("\n"))
}

// ---------------------------------------------------------------------------
// Debug overlay leaves
// ---------------------------------------------------------------------------

fn emit_debug_rect(rect: &DebugRectItem) -> Result<String, EngineError> {
    let geometry = format!(
        "x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"",
        fmt2(rect.bbox.x)?,
        fmt2(rect.bbox.y)?,
        fmt2(rect.bbox.w)?,
        fmt2(rect.bbox.h)?
    );
    Ok(match rect.kind {
        DebugRectKind::Specified => format!(
            "<rect {geometry} fill=\"none\" stroke=\"{DEBUG_SPECIFIED_STROKE}\" stroke-width=\"1\"/>"
        ),
        DebugRectKind::Layout => format!(
            "<rect {geometry} fill=\"none\" stroke=\"{DEBUG_LAYOUT_STROKE}\" stroke-width=\"1\" stroke-dasharray=\"{DEBUG_LAYOUT_STROKE_DASHARRAY}\"/>"
        ),
        DebugRectKind::Actual => format!(
            "<rect {geometry} fill=\"none\" stroke=\"{DEBUG_ACTUAL_STROKE}\" stroke-width=\"1\"/>"
        ),
    })
}

fn emit_debug_line(line: &DebugLineItem) -> Result<String, EngineError> {
    Ok(format!(
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{DEBUG_BASELINE_STROKE}\" stroke-width=\"0.5\"/>",
        fmt2(line.x1)?,
        fmt2(line.y1)?,
        fmt2(line.x2)?,
        fmt2(line.y2)?
    ))
}

// ---------------------------------------------------------------------------
// Defs
// ---------------------------------------------------------------------------

fn emit_defs(scene: &PaintScene) -> Result<String, EngineError> {
    let mut lines: Vec<String> = vec!["  <defs>".to_string()];

    for shared in &scene.defs.shared_shape_paths {
        lines.push(format!("    {}", emit_shared_shape_path_def(shared)));
    }
    for clip_path in &scene.defs.clip_paths {
        lines.push(format!(
            "    <clipPath id=\"{}\">",
            escape_xml(&clip_path.id)
        ));
        lines.push(emit_clip_path_content(clip_path)?);
        lines.push("    </clipPath>".to_string());
    }
    for gradient_def in &scene.defs.gradients {
        lines.push(emit_gradient_def(gradient_def)?);
    }
    for filter in &scene.defs.filters {
        lines.push(emit_filter_def(filter)?);
    }

    lines.push("  </defs>".to_string());
    Ok(lines.join("\n"))
}

fn emit_shared_shape_path_def(shared: &SharedShapePathDef) -> String {
    let attrs = if shared.paint_attrs.is_empty() {
        String::new()
    } else {
        format!(" {}", shared.paint_attrs.join(" "))
    };
    format!(
        "<path id=\"{}\" d=\"{}\"{attrs}/>",
        escape_xml(&shared.id),
        escape_xml(&shared.d)
    )
}

fn emit_clip_path_content(clip_path: &ClipPathDef) -> Result<String, EngineError> {
    match clip_path.border_radius {
        Some(BorderRadius::PerCorner(radii)) => Ok(format!(
            "      <path d=\"{}\"/>",
            rounded_rect_path_data(clip_path.bbox, radii)?
        )),
        Some(BorderRadius::Uniform(radius)) => Ok(format!(
            "      <rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"{}\" ry=\"{}\"/>",
            fmt2(clip_path.bbox.x)?,
            fmt2(clip_path.bbox.y)?,
            fmt2(clip_path.bbox.w)?,
            fmt2(clip_path.bbox.h)?,
            fmt2(radius)?,
            fmt2(radius)?
        )),
        None => Ok(format!(
            "      <rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"/>",
            fmt2(clip_path.bbox.x)?,
            fmt2(clip_path.bbox.y)?,
            fmt2(clip_path.bbox.w)?,
            fmt2(clip_path.bbox.h)?
        )),
    }
}

fn emit_gradient_def(gradient_def: &GradientDef) -> Result<String, EngineError> {
    match &gradient_def.gradient {
        Gradient::Linear { angle, stops } => {
            let (local_x1, local_y1, local_x2, local_y2) =
                angle_to_svg_coords(*angle, gradient_def.bbox.w, gradient_def.bbox.h);
            let mut lines: Vec<String> = vec![format!(
                "    <linearGradient id=\"{}\" gradientUnits=\"userSpaceOnUse\" x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\">",
                escape_xml(&gradient_def.id),
                format_number(gradient_def.bbox.x + local_x1, 4)?,
                format_number(gradient_def.bbox.y + local_y1, 4)?,
                format_number(gradient_def.bbox.x + local_x2, 4)?,
                format_number(gradient_def.bbox.y + local_y2, 4)?
            )];
            for stop in stops {
                lines.push(emit_gradient_stop(stop)?);
            }
            lines.push("    </linearGradient>".to_string());
            Ok(lines.join("\n"))
        }
        Gradient::Radial { geometry, stops } => {
            let resolved_geometry = geometry.unwrap_or_else(|| RadialGradientGeometry {
                center_x: gradient_def.bbox.w * 0.5,
                center_y: gradient_def.bbox.h * 0.5,
                radius_x: gradient_def.bbox.w.abs() / std::f64::consts::SQRT_2,
                radius_y: gradient_def.bbox.h.abs() / std::f64::consts::SQRT_2,
            });
            let center_x = gradient_def.bbox.x + resolved_geometry.center_x;
            let center_y = gradient_def.bbox.y + resolved_geometry.center_y;
            let mut lines: Vec<String> = vec![format!(
                "    <radialGradient id=\"{}\" gradientUnits=\"userSpaceOnUse\" cx=\"0\" cy=\"0\" r=\"1\" gradientTransform=\"matrix({} 0 0 {} {} {})\">",
                escape_xml(&gradient_def.id),
                format_number(resolved_geometry.radius_x, 4)?,
                format_number(resolved_geometry.radius_y, 4)?,
                format_number(center_x, 4)?,
                format_number(center_y, 4)?
            )];
            for stop in stops {
                lines.push(emit_gradient_stop(stop)?);
            }
            lines.push("    </radialGradient>".to_string());
            Ok(lines.join("\n"))
        }
    }
}

fn emit_gradient_stop(stop: &crate::ir::types::GradientStop) -> Result<String, EngineError> {
    Ok(format!(
        "      <stop offset=\"{}%\" stop-color=\"{}\"/>",
        fmt2(stop.offset * 100.0)?,
        escape_xml(&stop.color)
    ))
}

/// Emit an SVG `<filter>` for a box shadow (or text shadow layer).
fn emit_filter_def(filter: &FilterDef) -> Result<String, EngineError> {
    let mut lines: Vec<String> = Vec::new();

    // Expand filter region to accommodate shadow offset + blur + spread
    let expand = filter.dx.abs() + filter.dy.abs() + filter.blur * 2.0 + filter.spread.abs() * 2.0;
    // percentage + margin (the TS arithmetic is kept verbatim)
    let expand_pct = ((expand / 100.0) * 100.0 + 20.0).ceil();
    let region_min = -expand_pct;
    let filter_size = 100.0 + expand_pct * 2.0;
    // Finite box-shadow operands can still overflow when summed; a non-finite
    // filter region would emit an invalid `Infinity%` attribute, so fail here.
    if !(region_min.is_finite() && filter_size.is_finite()) {
        return Err(EngineError::Structured {
            code: "INVALID_NUMBER".to_string(),
            message: format!(
                "Box shadow filter region is not finite (dx={}, dy={}, blur={}, spread={})",
                format_js_number(filter.dx),
                format_js_number(filter.dy),
                format_js_number(filter.blur),
                format_js_number(filter.spread)
            ),
            stage: Some("emit".to_string()),
            node_id: None,
        });
    }

    lines.push(format!(
        "    <filter id=\"{}\" x=\"{}%\" y=\"{}%\" width=\"{}%\" height=\"{}%\">",
        escape_xml(&filter.id),
        format_js_number(region_min),
        format_js_number(region_min),
        format_js_number(filter_size),
        format_js_number(filter_size)
    ));

    if filter.spread == 0.0 {
        // Simple: use feDropShadow
        let attrs = [
            format!("dx=\"{}\"", fmt2(filter.dx)?),
            format!("dy=\"{}\"", fmt2(filter.dy)?),
            format!("stdDeviation=\"{}\"", fmt2(filter.blur / 2.0)?),
            format!("flood-color=\"{}\"", escape_xml(&filter.color)),
        ];
        lines.push(format!("      <feDropShadow {}/>", attrs.join(" ")));
    } else {
        // Complex: blur + offset + spread via feMorphology + merge with source
        lines.push(format!(
            "      <feGaussianBlur in=\"SourceAlpha\" stdDeviation=\"{}\" result=\"blur\"/>",
            fmt2(filter.blur / 2.0)?
        ));
        if filter.spread > 0.0 {
            lines.push(format!(
                "      <feMorphology in=\"blur\" operator=\"dilate\" radius=\"{}\" result=\"spread\"/>",
                fmt2(filter.spread)?
            ));
        } else if filter.spread < 0.0 {
            lines.push(format!(
                "      <feMorphology in=\"blur\" operator=\"erode\" radius=\"{}\" result=\"spread\"/>",
                fmt2(-filter.spread)?
            ));
        }
        lines.push(format!(
            "      <feOffset in=\"spread\" dx=\"{}\" dy=\"{}\" result=\"offset\"/>",
            fmt2(filter.dx)?,
            fmt2(filter.dy)?
        ));
        lines.push(format!(
            "      <feFlood flood-color=\"{}\" result=\"color\"/>",
            escape_xml(&filter.color)
        ));
        lines.push(
            "      <feComposite in=\"color\" in2=\"offset\" operator=\"in\" result=\"shadow\"/>"
                .to_string(),
        );
        lines.push("      <feMerge>".to_string());
        lines.push("        <feMergeNode in=\"shadow\"/>".to_string());
        lines.push("        <feMergeNode in=\"SourceGraphic\"/>".to_string());
        lines.push("      </feMerge>".to_string());
    }

    lines.push("    </filter>".to_string());
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::types::{AnimationSpec, AnimationSteps, GradientStop};

    fn default_spring() -> AnimationEasing {
        AnimationEasing::Spring(AnimationSpring {
            kind: "spring".to_string(),
            stiffness: None,
            damping: None,
            mass: None,
        })
    }

    fn red_blue_stops() -> Vec<GradientStop> {
        vec![
            GradientStop {
                color: "red".to_string(),
                offset: 0.0,
            },
            GradientStop {
                color: "blue".to_string(),
                offset: 1.0,
            },
        ]
    }

    fn rasterize_test_gradient(definition: &str, gradient_id: &str) -> resvg::tiny_skia::Pixmap {
        let svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"220\" height=\"140\" viewBox=\"0 0 220 140\"><defs>{definition}</defs><rect x=\"10\" y=\"20\" width=\"200\" height=\"100\" fill=\"url(#{gradient_id})\"/></svg>"
        );
        crate::rasterize::rasterize_svg_to_pixmap(
            &svg,
            &[],
            &[],
            &crate::rasterize::RasterizeOptions::default(),
        )
        .expect("gradient SVG rasterizes")
    }

    #[test]
    fn keeps_independent_animation_css_byte_stable() {
        let animation = crate::scene::AnimationStyle {
            class_name: "bsvg-anim-card".to_string(),
            keyframes_name: "anim-card-keyframes".to_string(),
            bbox: BBox::new(0.0, 0.0, 100.0, 50.0),
            playback: AnimationPlaybackStyle::Independent(AnimationSpec {
                keyframes: vec![
                    AnimationKeyframe {
                        at: 0.0,
                        opacity: Some(0.0),
                        transform: None,
                    },
                    AnimationKeyframe {
                        at: 1.0,
                        opacity: Some(1.0),
                        transform: None,
                    },
                ],
                duration_ms: 100.0,
                delay_ms: Some(20.0),
                easing: Some(AnimationEasing::Named("linear".to_string())),
                iterations: Some(AnimationIterations::Count(1.0)),
                fill: Some("none".to_string()),
            }),
        };
        assert_eq!(
            emit_independent_animation_rule(&animation, 50.0)
                .expect("independent CSS should emit")
                .join("\n"),
            "    @keyframes anim-card-keyframes {\n      0% { opacity: 0; }\n      100% { opacity: 1; }\n    }\n    .bsvg-anim-card {\n      animation-name: anim-card-keyframes;\n      animation-duration: 100ms;\n      animation-delay: -30ms;\n      animation-timing-function: linear;\n      animation-iteration-count: 1;\n      animation-fill-mode: none;\n    }"
        );
    }

    #[test]
    fn timeline_css_byte_budget_is_inclusive() {
        enforce_timeline_css_byte_limit(MAX_TIMELINE_CSS_BYTES)
            .expect("the exact CSS byte limit should be accepted");
        let error = enforce_timeline_css_byte_limit(MAX_TIMELINE_CSS_BYTES + 1)
            .expect_err("one byte over the CSS limit should fail");
        let EngineError::StructuredContext { code, context, .. } = error else {
            panic!("CSS budget should produce timeline context");
        };
        assert_eq!(code, "ANIMATED_SVG_TIMELINE_LIMIT");
        assert_eq!(
            *context,
            serde_json::json!({
                "metric": "cssBytes",
                "actual": MAX_TIMELINE_CSS_BYTES + 1,
                "limit": MAX_TIMELINE_CSS_BYTES,
            })
        );
    }

    #[test]
    fn emits_diagonal_linear_gradient_in_user_space() {
        let gradient_def = GradientDef {
            id: "diagonal".to_string(),
            bbox: BBox {
                x: 10.0,
                y: 20.0,
                w: 200.0,
                h: 100.0,
            },
            gradient: Gradient::Linear {
                angle: 45.0,
                stops: red_blue_stops(),
            },
        };

        let emitted = emit_gradient_def(&gradient_def).expect("linear gradient emits");
        assert!(emitted.starts_with(
            "    <linearGradient id=\"diagonal\" gradientUnits=\"userSpaceOnUse\" x1=\"35\" y1=\"145\" x2=\"185\" y2=\"-5\">"
        ));

        let pixmap = rasterize_test_gradient(&emitted, "diagonal");
        // A 45deg CSS gradient has 45deg isocolor lines in screen space.
        // These samples lie on one such line; objectBoundingBox distortion
        // would give them visibly different colors on this 2:1 rectangle.
        let upper_left = pixmap.pixel(84, 44).expect("upper-left sample");
        let lower_right = pixmap.pixel(134, 94).expect("lower-right sample");
        assert!(upper_left.red().abs_diff(lower_right.red()) <= 2);
        assert!(upper_left.blue().abs_diff(lower_right.blue()) <= 2);
    }

    #[test]
    fn emits_resolved_radial_ellipse_in_user_space() {
        let gradient_def = GradientDef {
            id: "radial".to_string(),
            bbox: BBox {
                x: 10.0,
                y: 20.0,
                w: 200.0,
                h: 100.0,
            },
            gradient: Gradient::Radial {
                geometry: Some(RadialGradientGeometry {
                    center_x: 200.0,
                    center_y: 100.0,
                    radius_x: 200.0_f64.hypot(100.0),
                    radius_y: 200.0_f64.hypot(100.0),
                }),
                stops: red_blue_stops(),
            },
        };

        let emitted = emit_gradient_def(&gradient_def).expect("radial gradient emits");
        assert!(emitted.starts_with(
            "    <radialGradient id=\"radial\" gradientUnits=\"userSpaceOnUse\" cx=\"0\" cy=\"0\" r=\"1\" gradientTransform=\"matrix(223.6068 0 0 223.6068 210 120)\">"
        ));

        let pixmap = rasterize_test_gradient(&emitted, "radial");
        let center = pixmap.pixel(209, 119).expect("radial center pixel");
        let farthest_corner = pixmap.pixel(10, 20).expect("farthest corner pixel");
        assert!(center.red() > center.blue());
        assert!(farthest_corner.blue() > farthest_corner.red());
    }

    #[test]
    fn formats_large_step_counts_as_css_integers() {
        let easing = AnimationEasing::Steps(AnimationSteps {
            kind: "steps".to_string(),
            count: 1e21,
            position: None,
        });

        assert_eq!(
            animation_easing_css(Some(&easing), 400.0).expect("large step count formats"),
            "steps(1000000000000000000000, jump-end)"
        );
    }

    #[test]
    fn expands_spring_easing_to_fixed_linear_stops() {
        let css =
            animation_easing_css(Some(&default_spring()), 400.0).expect("spring easing formats");

        let stops: Vec<&str> = css
            .strip_prefix("linear(")
            .and_then(|body| body.strip_suffix(')'))
            .expect("linear() wrapper")
            .split(", ")
            .collect();
        assert_eq!(stops.len(), SPRING_LINEAR_STOPS);
        assert!(
            stops.iter().all(|stop| {
                let digits = stop.strip_prefix('-').unwrap_or(stop);
                digits
                    .split_once('.')
                    .is_some_and(|(_, fraction)| fraction.len() == 6)
            }),
            "every stop keeps six decimals: {css}"
        );
        assert_eq!(stops.first().copied(), Some("0.000000"));
        assert_eq!(stops.last().copied(), Some("1.000000"));
    }

    #[test]
    fn keeps_spring_linear_expansion_byte_stable() {
        // Pinned so the determinism contract fails loudly if the closed form,
        // the stop count, or the number formatting ever changes.
        assert_eq!(
            animation_easing_css(Some(&default_spring()), 400.0).expect("spring easing formats"),
            SPRING_LINEAR_400MS_GOLDEN
        );
    }

    #[test]
    fn scales_spring_linear_expansion_with_segment_duration() {
        let short = animation_easing_css(Some(&default_spring()), 200.0).expect("short segment");
        let long = animation_easing_css(Some(&default_spring()), 800.0).expect("long segment");
        assert_ne!(short, long);
    }

    const SPRING_LINEAR_400MS_GOLDEN: &str = "linear(0.000000, 0.001912, 0.007487, 0.016481, 0.028654, 0.043765, 0.061581, 0.081870, 0.104405, 0.128966, 0.155335, 0.183304, 0.212670, 0.243237, 0.274817, 0.307229, 0.340300, 0.373864, 0.407765, 0.441854, 0.475990, 0.510042, 0.543885, 0.577404, 0.610493, 0.643051, 0.674987, 0.706219, 0.736671, 0.766275, 0.794970, 0.822702, 0.849426, 0.875100, 0.899692, 0.923173, 0.945522, 0.966724, 0.986767, 1.005646, 1.023360, 1.039912, 1.055310, 1.069565, 1.082694, 1.094714, 1.105648, 1.115519, 1.124355, 1.132184, 1.139039, 1.144953, 1.149959, 1.154094, 1.157396, 1.159901, 1.161650, 1.162681, 1.163033, 1.162747, 1.161862, 1.160418, 1.158454, 1.156010, 1.000000)";
}
