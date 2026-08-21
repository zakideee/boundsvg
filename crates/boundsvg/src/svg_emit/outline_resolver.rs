//! Text outline resolution: turn laid-out text nodes into positioned glyph
//! outline paths on the IR (`glyphPaths`), ready for SVG emission.
//!
//! This module is the only owner of outline request selection, font fallback,
//! missing-glyph materialization, path grouping, bounds, and unit samples.
//! TypeScript consumes the resolved IR and performs only public projection.
//!
//! One projection note: the TS side sees text lines through the layout
//! transport, where a fragment `style` without an explicit color is dropped
//! (`serialize_lines_ts_projection`). Style-range resolution here applies
//! the same rule so color-less fragment styles stay invisible, exactly like
//! the reference.

use std::collections::{HashMap, HashSet};

use boundshape::{
    GeometryDoc, GeometryNode, GeometryViewBox, ShapeError, evaluate_geometry, region_axis_bounds,
};

use crate::error::EngineError;
use crate::font::{FontRegistry, FontStyle};
use crate::ir::types::{
    BBox, IrNode, IrNodeKind, IrTextAlign, TextOutlinePath, TextShadowLayer, TextStrokeLayer,
    TextUnitAnimationSample,
};
use crate::svg_emit::num_format::format_js_number;
use crate::svg_emit::path_bbox::parse_path_bbox;
use crate::text::types::{Line, PositionedGlyph, TextRunStyle};

const DEFAULT_FONT_WEIGHT: u16 = 400;

/// Text outline grouping mode. Mirrors TS `TextPathMode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TextPathMode {
    /// Merge adjacent same-fill glyph paths into one path element.
    #[default]
    Merged,
    /// Keep one path per glyph (selection/animation metadata preserved).
    Glyphs,
}

impl TextPathMode {
    /// Parse the wire value; unknown strings fall back to `Merged`
    /// (the TS default).
    #[must_use]
    pub fn parse_str(value: &str) -> TextPathMode {
        if value == "glyphs" {
            TextPathMode::Glyphs
        } else {
            TextPathMode::Merged
        }
    }
}

/// Options for [`resolve_text_outlines`].
#[derive(Debug, Clone, Copy, Default)]
pub struct OutlineResolveOptions {
    pub text_path_mode: TextPathMode,
    /// Render synthetic tofu rectangles for missing glyphs (`glyph_id` 0).
    pub show_missing_glyphs: bool,
    /// Keep unit-animation outlines already resolved during IR construction.
    pub preserve_resolved_unit_outlines: bool,
}

/// First text node that exceeds a bounded outline-request scan.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineGlyphLimitExceeded {
    pub actual_glyphs: usize,
    pub max_glyphs: usize,
    pub node_id: String,
}

/// Parse a shortest JSON number with `serde_json`'s pre-`float_roundtrip`
/// arithmetic. Outline requests historically crossed that parser, so this
/// deliberately retained quantization is part of the byte-compatibility
/// boundary even though public IR itself now uses correctly rounded parsing.
fn parse_legacy_json_float(text: &str) -> Option<f64> {
    let (negative, unsigned) = text
        .strip_prefix('-')
        .map_or((false, text), |rest| (true, rest));
    let (mantissa, explicit_exponent) = if let Some(exponent_index) = unsigned.find(['e', 'E']) {
        (
            &unsigned[..exponent_index],
            unsigned[exponent_index + 1..].parse::<i32>().ok()?,
        )
    } else {
        (unsigned, 0)
    };
    let fractional_digits = mantissa
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    let significand = mantissa.bytes().try_fold(0_u64, |value, byte| {
        if byte == b'.' {
            return Some(value);
        }
        let digit = byte.checked_sub(b'0')?;
        if digit > 9 {
            return None;
        }
        value.checked_mul(10)?.checked_add(u64::from(digit))
    })?;
    let mut exponent = explicit_exponent.checked_sub(i32::try_from(fractional_digits).ok()?)?;
    let mut value = significand as f64;
    loop {
        let absolute_exponent = exponent.unsigned_abs();
        if absolute_exponent <= 308 {
            let power = 10_f64.powi(i32::try_from(absolute_exponent).ok()?);
            if exponent >= 0 {
                value *= power;
            } else {
                value /= power;
            }
            break;
        }
        if value == 0.0 {
            break;
        }
        if exponent >= 0 {
            return None;
        }
        value /= 1e308;
        exponent += 308;
    }
    Some(if negative { -value } else { value })
}

/// Reproduce the historical TS→WASM JSON hop for a request float.
fn wire_f64_via_request_json(value: f64) -> f64 {
    parse_legacy_json_float(&format_js_number(value)).unwrap_or(value)
}

/// Quantize a post-outline value through the public IR JSON transport.
///
/// Unit bounds are otherwise first observed only inside one-shot native
/// emission, while compiled/prepared emission necessarily serializes and
/// reparses them. `serde_json`'s parser can land one ulp away for the shortest
/// decimal, so applying that hop here keeps both routes byte-identical.
fn wire_bbox_via_ir_json(bbox: BBox) -> BBox {
    fn wire(value: f64) -> f64 {
        serde_json::to_string(&value)
            .ok()
            .and_then(|text| parse_legacy_json_float(&text))
            .unwrap_or(value)
    }
    BBox {
        x: wire(bbox.x),
        y: wire(bbox.y),
        w: wire(bbox.w),
        h: wire(bbox.h),
    }
}

/// One positioned glyph outline request plus its result metadata.
#[derive(Debug)]
struct OutlineRequest {
    glyph_id: u32,
    font_size_px: f64,
    origin_x: f64,
    origin_y: f64,
    rotation_deg: u16,
    baseline_rotation_deg: Option<f64>,
    inline_scale: Option<f64>,
    writing_mode: String,
    font_alias: String,
    font_weight: u16,
    font_style: FontStyle,
    font_variation_settings: Option<String>,
    // Result metadata (TS `OutlineRequestMeta`)
    text: String,
    fill: String,
    source_start: Option<usize>,
    source_end: Option<usize>,
    source_role: Option<String>,
    path_decoration_owner_id: Option<u32>,
    path_distance_start_px: Option<f64>,
    path_distance_end_px: Option<f64>,
    paint_range_index: Option<u32>,
    strokes: Option<Vec<TextStrokeLayer>>,
    shadows: Option<Vec<TextShadowLayer>>,
    unit_id: Option<String>,
    line_index: usize,
}

#[derive(Debug)]
pub(super) struct GlyphInkPath {
    pub line_index: usize,
    pub d: String,
    pub bbox: BBox,
    pub decoration_owner_id: Option<u32>,
    pub path_distance_start_px: Option<f64>,
    pub path_distance_end_px: Option<f64>,
}

/// Resolve glyph outline paths for every text node in the IR tree.
/// Mirrors TS `resolveTextOutlines` (the `glyphPaths` mutation half; the
/// TS `TextOutlineNode[]` return value is not needed for SVG emission).
///
/// # Errors
///
/// Returns `EngineError::Validation` when a referenced font is not
/// registered or a font face fails to parse (the TS path surfaces the same
/// conditions as WASM errors).
pub fn resolve_text_outlines(
    root: &mut IrNode,
    registry: &FontRegistry,
    options: &OutlineResolveOptions,
) -> Result<(), EngineError> {
    resolve_text_outlines_inner(root, registry, *options, false)
}

/// Resolve only Text nodes that opt into paint-unit animation.
///
/// This keeps the raw-IR contract and bytes of every other Text unchanged.
///
/// # Errors
///
/// Returns an [`EngineError`] when a referenced font is unavailable or its
/// outlines cannot be extracted.
pub fn resolve_animated_text_outlines(
    root: &mut IrNode,
    registry: &FontRegistry,
    options: &OutlineResolveOptions,
) -> Result<(), EngineError> {
    resolve_text_outlines_inner(root, registry, *options, true)
}

fn resolve_text_outlines_inner(
    root: &mut IrNode,
    registry: &FontRegistry,
    options: OutlineResolveOptions,
    animated_only: bool,
) -> Result<(), EngineError> {
    if let IrNodeKind::Group { children, .. } = &mut root.kind {
        for child in children {
            resolve_text_outlines_inner(child, registry, options, animated_only)?;
        }
        return Ok(());
    }

    let node_id = root.node_id.clone();
    let node_bbox = root.bbox;
    let IrNodeKind::Text {
        lines,
        unit_animation,
        glyph_paths,
        ..
    } = &root.kind
    else {
        return Ok(());
    };
    if animated_only && unit_animation.is_none() {
        return Ok(());
    }
    if !animated_only
        && options.preserve_resolved_unit_outlines
        && unit_animation.is_some()
        && glyph_paths.is_some()
    {
        return Ok(());
    }
    if lines.is_empty() && unit_animation.is_none() {
        return Ok(());
    }

    let requests = build_node_outline_requests(&root.kind, node_bbox, &node_id, None)?;
    let IrNodeKind::Text {
        glyph_paths,
        unit_map,
        unit_animation,
        unit_animation_samples,
        ..
    } = &mut root.kind
    else {
        return Ok(());
    };
    if requests.is_empty() {
        *glyph_paths = Some(Vec::new());
        if unit_animation.is_some() {
            *unit_animation_samples = unit_map.as_ref().map(|map| {
                map.units
                    .iter()
                    .map(|unit| TextUnitAnimationSample {
                        unit_id: unit.unit_id.clone(),
                        bbox: None,
                        opacity: None,
                        transform: None,
                    })
                    .collect()
            });
        }
        return Ok(());
    }

    let mut resolved_paths: Vec<TextOutlinePath> = Vec::new();
    for (request_index, request) in requests.iter().enumerate() {
        let Some(path_data) = extract_request_path(
            registry,
            request,
            request_index,
            options.show_missing_glyphs,
        )?
        else {
            continue;
        };
        let outline_path =
            create_resolved_outline_path(&node_id, request, path_data, options.show_missing_glyphs);
        append_resolved_outline_path(&mut resolved_paths, outline_path, options.text_path_mode);
    }

    if unit_animation.is_some() {
        let mut bbox_by_unit_id: HashMap<&str, BBox> = HashMap::new();
        for path in &resolved_paths {
            let Some(unit_id) = path.unit_id.as_deref() else {
                continue;
            };
            bbox_by_unit_id
                .entry(unit_id)
                .and_modify(|bbox| *bbox = union_bbox(*bbox, path.bbox))
                .or_insert(path.bbox);
        }
        *unit_animation_samples = unit_map.as_ref().map(|map| {
            map.units
                .iter()
                .map(|unit| TextUnitAnimationSample {
                    unit_id: unit.unit_id.clone(),
                    bbox: bbox_by_unit_id
                        .get(unit.unit_id.as_str())
                        .copied()
                        .map(wire_bbox_via_ir_json),
                    opacity: None,
                    transform: None,
                })
                .collect()
        });
    }
    *glyph_paths = Some(resolved_paths);
    Ok(())
}

/// Return the first visible outline request beyond `max_glyphs`.
///
/// The traversal and request predicate are shared with materialization, so a
/// raster preflight cannot drift from the work it limits.
#[must_use]
pub fn find_outline_glyph_limit_exceeded(
    root: &IrNode,
    max_glyphs: usize,
) -> Option<OutlineGlyphLimitExceeded> {
    fn visit(
        node: &IrNode,
        max_glyphs: usize,
        actual_glyphs: &mut usize,
    ) -> Option<OutlineGlyphLimitExceeded> {
        match &node.kind {
            IrNodeKind::Group { children, .. } => {
                for child in children {
                    if let Some(exceeded) = visit(child, max_glyphs, actual_glyphs) {
                        return Some(exceeded);
                    }
                }
            }
            IrNodeKind::Text { lines, .. } => {
                for line in lines {
                    let completed = visit_outline_request_glyphs(line, |_, _| {
                        *actual_glyphs += 1;
                        *actual_glyphs <= max_glyphs
                    });
                    if !completed {
                        return Some(OutlineGlyphLimitExceeded {
                            actual_glyphs: *actual_glyphs,
                            max_glyphs,
                            node_id: node.node_id.clone(),
                        });
                    }
                }
            }
            _ => {}
        }
        None
    }

    visit(root, max_glyphs, &mut 0)
}

/// Count visible glyph outline requests on decoration-bearing physical lines
/// without allocating request or outline vectors.
pub(super) fn count_text_node_ink_glyphs(
    kind: &IrNodeKind,
    eligible_line_indices: &HashSet<usize>,
    limit: usize,
) -> usize {
    let Some(node) = text_node_view(kind) else {
        return 0;
    };
    let mut count = 0_usize;
    for (line_index, line) in node.lines.iter().enumerate() {
        if !eligible_line_indices.contains(&line_index) {
            continue;
        }
        let _completed = visit_outline_request_glyphs(line, |glyph, _| {
            if is_outline_request_glyph(glyph) {
                count = count.saturating_add(1);
            }
            count <= limit
        });
        if count > limit {
            break;
        }
    }
    count
}

/// Resolve per-glyph fill outlines for skip-ink geometry. Missing glyphs are
/// always represented by the deterministic synthetic tofu fill, independent
/// of the render-time diagnostic display option.
pub(super) fn extract_text_node_ink_paths(
    kind: &IrNodeKind,
    node_bbox: BBox,
    node_id: &str,
    registry: &FontRegistry,
    eligible_line_indices: &HashSet<usize>,
) -> Result<Vec<GlyphInkPath>, EngineError> {
    let requests =
        build_node_outline_requests(kind, node_bbox, node_id, Some(eligible_line_indices))?;
    let mut ink_paths = Vec::with_capacity(requests.len());
    for (request_index, request) in requests.iter().enumerate() {
        let Some(d) = extract_request_path(registry, request, request_index, true)? else {
            continue;
        };
        let Some(bbox) = filled_path_bbox(&d).map_err(|_| EngineError::Structured {
            code: "TEXT_DECORATION_GEOMETRY".to_string(),
            message: "Glyph ink path geometry could not be evaluated.".to_string(),
            stage: Some("ir".to_string()),
            node_id: Some(node_id.to_string()),
        })?
        else {
            continue;
        };
        ink_paths.push(GlyphInkPath {
            line_index: request.line_index,
            d,
            bbox,
            decoration_owner_id: request.path_decoration_owner_id,
            path_distance_start_px: request.path_distance_start_px,
            path_distance_end_px: request.path_distance_end_px,
        });
    }
    Ok(ink_paths)
}

fn filled_path_bbox(path_data: &str) -> Result<Option<BBox>, ShapeError> {
    let region = evaluate_geometry(&GeometryDoc {
        view_box: GeometryViewBox {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        },
        root: GeometryNode::Path {
            node_id: None,
            d: path_data.to_string(),
            fill_rule: None,
        },
    })?;
    let Some((min_x, min_y, max_x, max_y)) = region_axis_bounds(&region) else {
        return Ok(None);
    };
    Ok(Some(BBox {
        x: min_x,
        y: min_y,
        w: max_x - min_x,
        h: max_y - min_y,
    }))
}

/// Run one positioned-glyph extraction through the same crate internals the
/// WASM `extract_positioned_glyph_paths` export uses.
fn extract_request_path(
    registry: &FontRegistry,
    request: &OutlineRequest,
    request_index: usize,
    show_missing_glyphs: bool,
) -> Result<Option<String>, EngineError> {
    let entry = registry
        .resolve(
            &request.font_alias,
            request.font_weight,
            &request.font_style,
        )
        .ok_or_else(|| {
            EngineError::Validation(format!(
                "Font not found: alias={}, weight={}, style={}",
                request.font_alias,
                request.font_weight,
                font_style_str(&request.font_style)
            ))
        })?;

    let variations = request
        .font_variation_settings
        .as_deref()
        .map(crate::font::shaping::parse_css_font_variation_settings)
        .map(|settings| crate::font::shaping::to_shape_variations(&settings))
        .unwrap_or_default();
    let face = registry
        .backend()
        .create_face(&entry.data, &variations)
        .map_err(|error| EngineError::Validation(format!("Failed to parse font face: {error}")))?;

    let outline_input = crate::font::outline::PositionedGlyphPathInput {
        glyph_id: request.glyph_id,
        font_size_px: request.font_size_px,
        origin_x: request.origin_x,
        origin_y: request.origin_y,
        rotation_deg: request.rotation_deg,
        baseline_rotation_deg: request.baseline_rotation_deg,
        inline_scale: request.inline_scale,
        writing_mode: request.writing_mode.clone(),
        request_index,
        show_missing_glyphs,
    };
    Ok(
        crate::font::outline::extract_positioned_glyph_path(face.as_ref(), &outline_input)?
            .map(|path| path.d),
    )
}

fn font_style_str(style: &FontStyle) -> &'static str {
    match style {
        FontStyle::Italic => "italic",
        FontStyle::Normal => "normal",
    }
}

fn create_resolved_outline_path(
    node_id: &str,
    request: &OutlineRequest,
    path_data: String,
    show_missing_glyphs: bool,
) -> TextOutlinePath {
    let is_missing =
        request.glyph_id == 0 && show_missing_glyphs && is_visible_character(&request.text);
    TextOutlinePath {
        node_id: node_id.to_string(),
        bbox: parse_path_bbox(&path_data).unwrap_or(BBox {
            x: 0.0,
            y: 0.0,
            w: 0.0,
            h: 0.0,
        }),
        d: path_data,
        fill: request.fill.clone(),
        glyph_ids: vec![request.glyph_id],
        text: request.text.clone(),
        unit_id: request.unit_id.clone(),
        source_start: request.source_start,
        source_end: request.source_end,
        source_role: request.source_role.clone(),
        paint_range_index: request.paint_range_index,
        strokes: request.strokes.clone(),
        shadows: request.shadows.clone(),
        missing_glyph: is_missing.then_some(true),
    }
}

/// Mirror of TS `appendResolvedOutlinePath` (merged-mode concatenation).
fn append_resolved_outline_path(
    resolved_paths: &mut Vec<TextOutlinePath>,
    outline_path: TextOutlinePath,
    text_path_mode: TextPathMode,
) {
    let can_merge = text_path_mode == TextPathMode::Merged
        && outline_path.missing_glyph.is_none()
        && resolved_paths.last().is_some_and(|previous| {
            previous.missing_glyph.is_none()
                && previous.fill == outline_path.fill
                && previous.unit_id == outline_path.unit_id
                && previous.paint_range_index == outline_path.paint_range_index
                && previous.strokes == outline_path.strokes
                && previous.shadows == outline_path.shadows
        });
    if !can_merge {
        resolved_paths.push(outline_path);
        return;
    }
    // can_merge guarantees a previous entry.
    let Some(previous) = resolved_paths.last_mut() else {
        resolved_paths.push(outline_path);
        return;
    };
    previous.d.push_str(&outline_path.d);
    previous.glyph_ids.extend(outline_path.glyph_ids);
    previous.text.push_str(&outline_path.text);
    previous.bbox = union_bbox(previous.bbox, outline_path.bbox);
    if previous.source_role == outline_path.source_role {
        if let (Some(previous_end), Some(current_end)) =
            (previous.source_end, outline_path.source_end)
        {
            previous.source_end = Some(previous_end.max(current_end));
        }
    }
}

fn union_bbox(left: BBox, right: BBox) -> BBox {
    let min_x = left.x.min(right.x);
    let min_y = left.y.min(right.y);
    let max_x = (left.x + left.w).max(right.x + right.w);
    let max_y = (left.y + left.h).max(right.y + right.h);
    BBox {
        x: min_x,
        y: min_y,
        w: max_x - min_x,
        h: max_y - min_y,
    }
}

// ---------------------------------------------------------------------------
// Request building (mirrors buildNodeOutlineRequests)
// ---------------------------------------------------------------------------

/// Style range over a line's UTF-8 byte offsets. `style` is `None` for the
/// full-line fallback range and for projected-away (color-less) styles.
struct StyleRange<'a> {
    start: usize,
    end: usize,
    style: Option<&'a TextRunStyle>,
}

fn build_line_style_ranges(line: &Line) -> Vec<StyleRange<'_>> {
    let Some(fragments) = line.fragments.as_ref().filter(|list| !list.is_empty()) else {
        return vec![StyleRange {
            start: 0,
            end: line.text.len(),
            style: None,
        }];
    };

    let mut byte_cursor = 0;
    fragments
        .iter()
        .map(|fragment| {
            let start = byte_cursor;
            byte_cursor += fragment.text.len();
            StyleRange {
                start,
                end: byte_cursor,
                // The TS side sees fragment styles through the transport
                // projection, which drops color-less styles.
                style: fragment.style.color.is_some().then_some(&fragment.style),
            }
        })
        .collect()
}

struct GlyphStyleContext<'a> {
    fill: &'a str,
    font_size_px: f64,
    font_variation_settings: Option<&'a str>,
    text_strokes: Option<&'a [crate::text::types::TextStrokeLayer]>,
    text_shadows: Option<&'a [crate::text::types::TextShadowLayer]>,
}

fn resolve_glyph_style<'a>(
    glyph: &'a PositionedGlyph,
    style_ranges: &'a [StyleRange<'a>],
    node_font_size_px: f64,
    node_color: &'a str,
    node_font_variation_settings: Option<&'a str>,
) -> GlyphStyleContext<'a> {
    let cluster_start = glyph.cluster_start as usize;
    let cluster_end = glyph.cluster_end as usize;
    let range = style_ranges.iter().find(|entry| {
        cluster_start < entry.end && (cluster_end > entry.start || cluster_start >= entry.start)
    });
    let range_style = range.and_then(|entry| entry.style);
    GlyphStyleContext {
        fill: glyph
            .fill
            .as_deref()
            .or_else(|| range_style.and_then(|style| style.color.as_deref()))
            .unwrap_or(node_color),
        font_size_px: glyph
            .font_size_px
            .or(range_style.map(|style| style.font_size_px))
            .unwrap_or(node_font_size_px),
        font_variation_settings: glyph
            .font_variation_settings
            .as_deref()
            .or_else(|| range_style.and_then(|style| style.font_variation_settings.as_deref()))
            .or(node_font_variation_settings),
        text_strokes: glyph
            .text_strokes
            .as_deref()
            .or_else(|| range_style.and_then(|style| style.text_strokes.as_deref())),
        text_shadows: glyph
            .text_shadows
            .as_deref()
            .or_else(|| range_style.and_then(|style| style.text_shadows.as_deref())),
    }
}

/// Fields read off the text node while building requests.
struct TextNodeView<'a> {
    lines: &'a [Line],
    font: &'a str,
    font_weight: Option<u16>,
    font_style: Option<&'a str>,
    font_size_px: f64,
    font_variation_settings: Option<&'a str>,
    color: &'a str,
    text_align: IrTextAlign,
    layout_box: BBox,
    writing_mode: Option<&'a str>,
    line_height_px: f64,
}

fn text_node_view(kind: &IrNodeKind) -> Option<TextNodeView<'_>> {
    let IrNodeKind::Text {
        lines,
        font,
        font_weight,
        font_style,
        font_size_px,
        font_variation_settings,
        color,
        text_align,
        layout_box,
        writing_mode,
        line_height_px,
        ..
    } = kind
    else {
        return None;
    };
    Some(TextNodeView {
        lines,
        font,
        font_weight: *font_weight,
        font_style: font_style.as_deref(),
        font_size_px: *font_size_px,
        font_variation_settings: font_variation_settings.as_deref(),
        color,
        text_align: *text_align,
        layout_box: *layout_box,
        writing_mode: writing_mode.as_deref(),
        line_height_px: *line_height_px,
    })
}

fn build_node_outline_requests(
    kind: &IrNodeKind,
    node_bbox: BBox,
    node_id: &str,
    eligible_line_indices: Option<&HashSet<usize>>,
) -> Result<Vec<OutlineRequest>, EngineError> {
    let Some(node) = text_node_view(kind) else {
        return Ok(Vec::new());
    };
    let mut unit_by_member: HashMap<(usize, usize), String> = HashMap::new();
    if let IrNodeKind::Text {
        unit_map: Some(unit_map),
        unit_animation: Some(_),
        ..
    } = kind
    {
        for unit in &unit_map.units {
            for member in &unit.members {
                let member_key = (member.line_index as usize, member.glyph_index as usize);
                let positioned_glyphs = node
                    .lines
                    .get(member_key.0)
                    .and_then(|line| line.positioned_glyphs.as_ref())
                    .filter(|glyphs| member_key.1 < glyphs.len());
                if positioned_glyphs.is_none()
                    || unit_by_member
                        .insert(member_key, unit.unit_id.clone())
                        .is_some()
                {
                    return Err(EngineError::Structured {
                        code: "TEXT_UNIT_INDEX_SPACE_MISMATCH".to_string(),
                        message: "Text unit members require unique positioned glyph indices"
                            .to_string(),
                        stage: Some("text".to_string()),
                        node_id: Some(node_id.to_string()),
                    });
                }
            }
        }
    }

    let writing_mode = node.writing_mode.unwrap_or("horizontal-tb");
    let is_vertical = writing_mode == "vertical-rl";
    let mut requests: Vec<OutlineRequest> = Vec::new();
    let mut invalid_inline_scale = false;

    for (line_index, line) in node.lines.iter().enumerate() {
        if eligible_line_indices.is_some_and(|indices| !indices.contains(&line_index)) {
            continue;
        }
        let style_ranges = build_line_style_ranges(line);
        let line_start_x = resolve_text_start_x(&node, line.width);
        let column_x = is_vertical.then(|| resolve_vertical_column_x(&node, node_bbox, line_index));
        let vertical_offset = if is_vertical {
            resolve_vertical_align_offset(&node, line)
        } else {
            0.0
        };

        let completed = visit_outline_request_glyphs(line, |glyph, glyph_index| {
            if glyph
                .baseline_rotation_deg
                .is_some_and(|baseline_rotation_deg| !baseline_rotation_deg.is_finite())
            {
                return false;
            }
            if glyph
                .inline_scale
                .is_some_and(|inline_scale| !inline_scale.is_finite() || inline_scale <= 0.0)
            {
                invalid_inline_scale = true;
                return false;
            }
            let style = resolve_glyph_style(
                glyph,
                &style_ranges,
                node.font_size_px,
                node.color,
                node.font_variation_settings,
            );
            let has_glyph_font = !glyph.font_alias.is_empty();
            let font_alias = if has_glyph_font {
                glyph.font_alias.clone()
            } else {
                node.font.to_string()
            };
            let font_weight = if has_glyph_font {
                glyph.font_weight
            } else {
                node.font_weight.unwrap_or(glyph.font_weight)
            };
            let font_style = if has_glyph_font {
                glyph.font_style.clone()
            } else {
                match node.font_style {
                    Some("italic") => FontStyle::Italic,
                    Some(_) => FontStyle::Normal,
                    None => glyph.font_style.clone(),
                }
            };
            let glyph_writing_mode = glyph
                .outline_writing_mode
                .as_deref()
                .unwrap_or(writing_mode);

            let (origin_x, origin_y) = resolve_glyph_origin(
                glyph,
                &node,
                node_bbox,
                is_vertical,
                line_start_x,
                column_x,
                vertical_offset,
            );

            requests.push(OutlineRequest {
                glyph_id: glyph.glyph_id,
                font_size_px: wire_f64_via_request_json(style.font_size_px),
                origin_x: wire_f64_via_request_json(origin_x),
                origin_y: wire_f64_via_request_json(origin_y),
                rotation_deg: glyph.rotation_deg,
                baseline_rotation_deg: glyph.baseline_rotation_deg.map(wire_f64_via_request_json),
                inline_scale: glyph.inline_scale.map(wire_f64_via_request_json),
                writing_mode: glyph_writing_mode.to_string(),
                font_alias,
                font_weight,
                font_style,
                font_variation_settings: style.font_variation_settings.map(str::to_string),
                text: glyph.text.clone(),
                fill: style.fill.to_string(),
                source_start: glyph.source_start.map(|value| value as usize),
                source_end: glyph.source_end.map(|value| value as usize),
                source_role: glyph.source_role.clone(),
                path_decoration_owner_id: glyph.path_decoration_owner_id,
                path_distance_start_px: glyph.path_distance_start_px,
                path_distance_end_px: glyph.path_distance_end_px,
                paint_range_index: glyph.paint_range_index,
                strokes: style.text_strokes.map(|layers| {
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
                }),
                shadows: style.text_shadows.map(|layers| {
                    layers
                        .iter()
                        .map(|layer| TextShadowLayer {
                            dx: layer.dx,
                            dy: layer.dy,
                            blur_px: layer.blur_px,
                            color: layer.color.clone(),
                        })
                        .collect()
                }),
                unit_id: unit_by_member.get(&(line_index, glyph_index)).cloned(),
                line_index,
            });
            true
        });
        if !completed {
            let (code, message) = if invalid_inline_scale {
                (
                    "TEXT_PATH_INLINE_SCALE_INVALID",
                    "inlineScale must be positive and finite.",
                )
            } else {
                (
                    "TEXT_BASELINE_ROTATION_INVALID",
                    "baselineRotationDeg must be finite.",
                )
            };
            return Err(EngineError::Structured {
                code: code.to_string(),
                message: message.to_string(),
                stage: Some("text".to_string()),
                node_id: Some(node_id.to_string()),
            });
        }
    }

    Ok(requests)
}

fn resolve_glyph_origin(
    glyph: &PositionedGlyph,
    node: &TextNodeView,
    node_bbox: BBox,
    is_vertical: bool,
    line_start_x: f64,
    column_x: Option<f64>,
    vertical_offset: f64,
) -> (f64, f64) {
    let layout_box = node.layout_box;
    if glyph.absolute_position == Some(true) {
        return (layout_box.x + glyph.origin_x, layout_box.y + glyph.origin_y);
    }
    if is_vertical {
        return (
            column_x.unwrap_or(node_bbox.x) + glyph.origin_x,
            layout_box.y + vertical_offset + glyph.origin_y,
        );
    }
    (line_start_x + glyph.origin_x, layout_box.y + glyph.origin_y)
}

/// Visit the glyphs of a line that become outline requests, in order.
/// Mirrors `visitOutlineRequestGlyphs` — the closure returns `false` to
/// stop early for request validation or glyph-limit scans.
fn visit_outline_request_glyphs<F: FnMut(&PositionedGlyph, usize) -> bool>(
    line: &Line,
    mut visit: F,
) -> bool {
    if let Some(positioned) = line.positioned_glyphs.as_ref() {
        for (glyph_index, glyph) in positioned.iter().enumerate() {
            if is_outline_request_glyph(glyph) && !visit(glyph, glyph_index) {
                return false;
            }
        }
        return true;
    }

    let line_bytes = line.text.as_bytes();
    let mut cursor_x = 0.0;
    for (glyph_index, glyph) in line.glyphs.iter().enumerate() {
        let next_cluster = line
            .glyphs
            .get(glyph_index + 1)
            .map_or(line_bytes.len(), |next| next.cluster as usize);
        let start = glyph.cluster as usize;
        let end = start.max(next_cluster);
        let text = decode_byte_slice_lossy(line_bytes, start, end);
        let positioned_glyph = PositionedGlyph {
            glyph_id: glyph.glyph_id,
            text,
            cluster_start: clamp_to_u32(start),
            cluster_end: clamp_to_u32(end),
            source_start: None,
            source_end: None,
            source_role: None,
            decoration_source_start: None,
            decoration_source_end: None,
            decoration_level: None,
            path_decoration_owner_id: None,
            path_distance_start_px: None,
            path_distance_end_px: None,
            text_decoration_geometry: None,
            font_alias: glyph.font_alias.clone().unwrap_or_default(),
            font_fallback: Vec::new(),
            font_weight: glyph.font_weight.unwrap_or(DEFAULT_FONT_WEIGHT),
            font_style: glyph.font_style.clone().unwrap_or(FontStyle::Normal),
            font_size_px: None,
            font_variation_settings: None,
            font_feature_settings: None,
            fill: None,
            text_strokes: None,
            text_shadows: None,
            paint_range_index: None,
            origin_x: cursor_x + glyph.x_offset,
            origin_y: line.baseline_y + glyph.y_offset,
            x_offset: glyph.x_offset,
            y_offset: glyph.y_offset,
            x_advance: glyph.x_advance,
            y_advance: glyph.y_advance,
            rotation_deg: glyph.rotation_deg.unwrap_or(0),
            baseline_rotation_deg: None,
            inline_scale: None,
            synthetic_kind: None,
            outline_writing_mode: None,
            absolute_position: None,
        };
        cursor_x += glyph.x_advance;
        if is_outline_request_glyph(&positioned_glyph) && !visit(&positioned_glyph, glyph_index) {
            return false;
        }
    }
    true
}

fn clamp_to_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// JS `Uint8Array.slice(start, end)` + `TextDecoder.decode` semantics:
/// offsets clamp to the buffer, an inverted range is empty, and invalid
/// UTF-8 decodes with U+FFFD replacement.
fn decode_byte_slice_lossy(bytes: &[u8], start: usize, end: usize) -> String {
    let clamped_start = start.min(bytes.len());
    let clamped_end = end.min(bytes.len());
    if clamped_start >= clamped_end {
        return String::new();
    }
    String::from_utf8_lossy(&bytes[clamped_start..clamped_end]).into_owned()
}

/// Control/whitespace with `glyph_id` 0 is not a missing glyph and never
/// becomes a request.
fn is_outline_request_glyph(glyph: &PositionedGlyph) -> bool {
    glyph.glyph_id != 0 || is_visible_character(&glyph.text)
}

fn resolve_text_start_x(node: &TextNodeView, line_width: f64) -> f64 {
    let layout_box = node.layout_box;
    match node.text_align {
        IrTextAlign::Center => layout_box.x + (layout_box.w - line_width) / 2.0,
        IrTextAlign::End => layout_box.x + layout_box.w - line_width,
        IrTextAlign::Start => layout_box.x,
    }
}

fn resolve_vertical_column_x(node: &TextNodeView, node_bbox: BBox, line_index: usize) -> f64 {
    let layout_box = node.layout_box;
    // TS `lineHeightPx ?? bbox.w / lineCount`: the Rust IR field is required,
    // so the fallback never fires.
    let _ = node_bbox;
    let column_width = node.line_height_px;
    layout_box.x + layout_box.w - (line_index as f64 + 1.0) * column_width + column_width * 0.5
}

fn resolve_vertical_align_offset(node: &TextNodeView, line: &Line) -> f64 {
    if !matches!(node.text_align, IrTextAlign::Center | IrTextAlign::End) {
        return 0.0;
    }
    let available = node.layout_box.h - line.width;
    if available <= 0.0 {
        return 0.0;
    }
    if node.text_align == IrTextAlign::Center {
        available / 2.0
    } else {
        available
    }
}

/// Return false for control characters and whitespace that should not get a
/// tofu marker. Mirrors TS `isVisibleCharacter`.
fn is_visible_character(text: &str) -> bool {
    let Some(first) = text.chars().next() else {
        return false;
    };
    let code = first as u32;
    // C0 controls, DEL, C1 controls, whitespace characters
    if code <= 0x20 || code == 0x7f || (0x80..=0x9f).contains(&code) {
        return false;
    }
    // Common Unicode whitespace / format characters
    !matches!(
        code,
        0xa0 | 0xad | 0x200b | 0x200c | 0x200d | 0x2028 | 0x2029 | 0xfeff
    )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_path_mode_parses_wire_values() {
        assert_eq!(TextPathMode::parse_str("glyphs"), TextPathMode::Glyphs);
        assert_eq!(TextPathMode::parse_str("merged"), TextPathMode::Merged);
        assert_eq!(TextPathMode::parse_str("unknown"), TextPathMode::Merged);
    }

    #[test]
    fn request_float_hop_retains_legacy_byte_quantization() {
        let source = 225.945_000_000_000_02_f64;
        assert_eq!(source.to_bits(), 0x406c_3e3d_70a3_d70b);
        assert_eq!(
            wire_f64_via_request_json(source).to_bits(),
            0x406c_3e3d_70a3_d70a
        );
        assert_eq!(parse_legacy_json_float("-1e-7"), Some(-0.000_000_1));
    }

    #[test]
    fn visible_character_filter_matches_ts() {
        assert!(is_visible_character("あ"));
        assert!(is_visible_character("A"));
        assert!(!is_visible_character(""));
        assert!(!is_visible_character(" "));
        assert!(!is_visible_character("\u{200b}"));
        assert!(!is_visible_character("\u{a0}"));
    }

    #[test]
    fn byte_slice_decoding_clamps_like_js() {
        let bytes = "abc".as_bytes();
        assert_eq!(decode_byte_slice_lossy(bytes, 1, 10), "bc");
        assert_eq!(decode_byte_slice_lossy(bytes, 5, 2), "");
    }

    #[test]
    fn filled_path_bbox_distinguishes_empty_ink_from_invalid_geometry() {
        assert_eq!(
            filled_path_bbox("").expect("an empty path is valid geometry"),
            None
        );

        let bbox = filled_path_bbox("M0 0L2 0L2 3L0 3Z")
            .expect("a filled rectangle is valid geometry")
            .expect("a filled rectangle has ink bounds");
        assert_eq!(bbox.x, 0.0);
        assert_eq!(bbox.y, 0.0);
        assert_eq!(bbox.w, 2.0);
        assert_eq!(bbox.h, 3.0);

        assert!(filled_path_bbox("M0 0X1 1").is_err());
    }

    #[test]
    fn merged_mode_concatenates_same_fill_paths() {
        let make = |fill: &str, d: &str| TextOutlinePath {
            node_id: "t".to_string(),
            d: d.to_string(),
            fill: fill.to_string(),
            strokes: None,
            shadows: None,
            paint_range_index: None,
            glyph_ids: vec![1],
            text: "x".to_string(),
            bbox: BBox {
                x: 0.0,
                y: 0.0,
                w: 1.0,
                h: 1.0,
            },
            unit_id: None,
            source_start: None,
            source_end: None,
            source_role: None,
            missing_glyph: None,
        };
        let mut merged: Vec<TextOutlinePath> = Vec::new();
        append_resolved_outline_path(&mut merged, make("#000", "M0,0"), TextPathMode::Merged);
        append_resolved_outline_path(&mut merged, make("#000", "L1,1"), TextPathMode::Merged);
        append_resolved_outline_path(&mut merged, make("#f00", "M2,2"), TextPathMode::Merged);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].d, "M0,0L1,1");

        let mut glyphs: Vec<TextOutlinePath> = Vec::new();
        append_resolved_outline_path(&mut glyphs, make("#000", "M0,0"), TextPathMode::Glyphs);
        append_resolved_outline_path(&mut glyphs, make("#000", "L1,1"), TextPathMode::Glyphs);
        assert_eq!(glyphs.len(), 2);
    }

    #[test]
    fn rejects_legacy_glyph_indices_when_unit_membership_is_active() {
        let node: IrNode = serde_json::from_value(serde_json::json!({
            "nodeId": "text",
            "bbox": { "x": 0.0, "y": 0.0, "w": 20.0, "h": 10.0 },
            "type": "text",
            "lines": [{
                "text": "A",
                "glyphs": [],
                "width": 10.0,
                "baselineY": 8.0
            }],
            "font": "Test",
            "fontSizePx": 10.0,
            "color": "#000000",
            "textAlign": "start",
            "layoutBox": { "x": 0.0, "y": 0.0, "w": 20.0, "h": 10.0 },
            "lineHeightPx": 10.0,
            "unitMap": {
                "kind": "cluster",
                "ruby": "with-base",
                "units": [{
                    "unitId": "unit",
                    "kind": "cluster",
                    "sourceStart": 0,
                    "sourceEnd": 1,
                    "lineId": "line",
                    "logicalOrder": 0,
                    "visualOrder": 0,
                    "members": [{
                        "lineIndex": 0,
                        "glyphIndex": 0,
                        "sourceRole": "content"
                    }]
                }]
            },
            "unitAnimation": {
                "by": "cluster",
                "animation": {
                    "keyframes": [
                        { "at": 0.0, "opacity": 0.0 },
                        { "at": 1.0, "opacity": 1.0 }
                    ],
                    "durationMs": 100.0
                }
            }
        }))
        .expect("text unit node fixture deserializes");

        let error = build_node_outline_requests(&node.kind, node.bbox, &node.node_id, None)
            .expect_err("legacy glyph indices must not be used for unit membership");
        assert!(matches!(
            error,
            EngineError::Structured { ref code, .. }
                if code == "TEXT_UNIT_INDEX_SPACE_MISMATCH"
        ));
    }

    fn positioned_text_node() -> IrNode {
        serde_json::from_value(serde_json::json!({
            "nodeId": "text",
            "bbox": { "x": 0.0, "y": 0.0, "w": 20.0, "h": 10.0 },
            "type": "text",
            "lines": [{
                "text": "A",
                "glyphs": [],
                "width": 10.0,
                "baselineY": 8.0,
                "positionedGlyphs": [{
                    "glyphId": 1,
                    "text": "A",
                    "clusterStart": 0,
                    "clusterEnd": 1,
                    "fontAlias": "Test",
                    "fontWeight": 400,
                    "fontStyle": "normal",
                    "originX": 0.0,
                    "originY": 8.0,
                    "xOffset": 0.0,
                    "yOffset": 0.0,
                    "xAdvance": 10.0,
                    "yAdvance": 0.0,
                    "rotationDeg": 0,
                    "baselineRotationDeg": 45.0,
                    "inlineScale": 2.0
                }]
            }],
            "font": "Test",
            "fontSizePx": 10.0,
            "color": "#000000",
            "textAlign": "start",
            "layoutBox": { "x": 0.0, "y": 0.0, "w": 20.0, "h": 10.0 },
            "lineHeightPx": 10.0
        }))
        .expect("positioned text node fixture deserializes")
    }

    #[test]
    fn transfers_baseline_rotation_to_native_outline_request() {
        let node = positioned_text_node();
        let requests = build_node_outline_requests(&node.kind, node.bbox, &node.node_id, None)
            .expect("valid outline request");

        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].baseline_rotation_deg, Some(45.0));
        assert_eq!(requests[0].inline_scale, Some(2.0));
    }

    #[test]
    fn rejects_non_finite_baseline_rotation_at_native_boundary() {
        let mut node = positioned_text_node();
        let IrNodeKind::Text { lines, .. } = &mut node.kind else {
            panic!("expected text node");
        };
        lines[0]
            .positioned_glyphs
            .as_mut()
            .expect("positioned glyphs")[0]
            .baseline_rotation_deg = Some(f64::NAN);

        let error = build_node_outline_requests(&node.kind, node.bbox, &node.node_id, None)
            .expect_err("non-finite baseline rotation must fail");
        assert!(matches!(
            error,
            EngineError::Structured { ref code, .. }
                if code == "TEXT_BASELINE_ROTATION_INVALID"
        ));
    }

    #[test]
    fn rejects_invalid_inline_scale_at_native_boundary() {
        let mut node = positioned_text_node();
        let IrNodeKind::Text { lines, .. } = &mut node.kind else {
            panic!("expected text node");
        };
        lines[0].positioned_glyphs.as_mut().unwrap()[0].inline_scale = Some(0.0);

        let error = build_node_outline_requests(&node.kind, node.bbox, &node.node_id, None)
            .expect_err("zero inline scale must be rejected");
        assert!(matches!(
            error,
            EngineError::Structured { ref code, .. }
                if code == "TEXT_PATH_INLINE_SCALE_INVALID"
        ));
    }

    #[test]
    fn ink_glyph_preflight_counts_boundary_minus_one_boundary_and_plus_one() {
        const LIMIT: usize = 16_384;
        let mut eligible_lines = HashSet::new();
        eligible_lines.insert(0);
        for expected in [LIMIT - 1, LIMIT, LIMIT + 1] {
            let mut node = positioned_text_node();
            let IrNodeKind::Text { lines, .. } = &mut node.kind else {
                panic!("expected text node");
            };
            let glyph = lines[0]
                .positioned_glyphs
                .as_ref()
                .and_then(|glyphs| glyphs.first())
                .cloned()
                .expect("positioned glyph fixture");
            lines[0].positioned_glyphs = Some(vec![glyph; expected]);

            assert_eq!(
                count_text_node_ink_glyphs(&node.kind, &eligible_lines, LIMIT),
                expected
            );
        }
    }
}
