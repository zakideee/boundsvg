//! Outline-aware text-decoration ink skipping.
//!
//! `boundtext` materializes deterministic pre-skip filled regions. This pass
//! runs after layout in `boundsvg`, resolves the actual glyph fill outlines,
//! and subtracts full-cross-axis clearance gaps without changing shaping,
//! layout, source ranges, or paint-unit identity.

use std::collections::HashSet;

use boundshape::{
    BooleanOp, Contour, CurveSegment, GeometryDoc, GeometryNode, GeometryViewBox, MeasuredPath,
    PathTraversalDirection, Point2D, Region, RegionAxis, ShapeError,
    boolean_regions_with_pair_budget, canonicalize_region, clip_monotonic_region_to_axis_interval,
    evaluate_geometry, intersection_axis_intervals_with_pair_budget, measure_single_svg_path,
    measured_path_offset_band, project_region_intersection_to_measured_path_interval,
    project_region_to_measured_path_interval, region_axis_bounds, region_has_positive_area,
    region_to_path,
};

use crate::diagnostics::{PipelineStage, RecoverableCode, SerializedRecoverableError};
use crate::error::EngineError;
use crate::font::FontRegistry;
use crate::ir::types::{BBox, IrNode, IrNodeKind};
use crate::text::decoration::{
    MAX_TEXT_DECORATION_PATTERN_CONTOURS, MAX_TEXT_DECORATION_PATTERN_SEGMENTS,
};
use crate::text::types::{
    TextDecorationFragment, TextDecorationLine, TextDecorationPaintPath, TextDecorationSkipInk,
    TextDecorationStyle,
};

use super::outline_resolver::{
    GlyphInkPath, count_text_node_ink_glyphs, extract_text_node_ink_paths,
};

/// Maximum glyph fill outlines tested for one Text node.
pub const MAX_TEXT_DECORATION_SKIP_INK_GLYPHS: usize = 16_384;
/// Maximum flattened curve-segment pairs visited by all skip-ink boolean
/// operations for one Text node.
pub const MAX_TEXT_DECORATION_SKIP_INK_CANDIDATE_PAIRS: usize = 1_048_576;

const GEOMETRY_EPSILON: f64 = 1e-4;

/// Resolve every outline-aware decoration in an engine-built IR tree.
///
/// # Errors
///
/// Returns a stable structured decoration error when glyph extraction,
/// region reconstruction, or a non-recoverable deterministic resource budget
/// fails. Skip-ink resource exhaustion emits a warning and falls back to the
/// original decoration geometry without ink skipping.
pub fn resolve_text_decoration_skip_ink(
    root: &mut IrNode,
    registry: &FontRegistry,
    warnings: &mut Vec<SerializedRecoverableError>,
) -> Result<(), EngineError> {
    if let IrNodeKind::Group { children, .. } = &mut root.kind {
        for child in children {
            resolve_text_decoration_skip_ink(child, registry, warnings)?;
        }
        return Ok(());
    }

    let original_bbox = root.bbox;
    let original_decorations = match &root.kind {
        IrNodeKind::Text {
            text_decorations: Some(fragments),
            ..
        } => Some(fragments.clone()),
        _ => None,
    };
    let result = resolve_text_decoration_skip_ink_for_node(root, registry);
    let Err(error) = result else {
        return Ok(());
    };
    if !is_skip_ink_limit_error(&error) {
        return Err(error);
    }
    let Some(mut fallback_decorations) = original_decorations else {
        return Err(error);
    };

    for fragment in &mut fallback_decorations {
        if fragment.skip_ink == TextDecorationSkipInk::All
            && fragment.line != TextDecorationLine::LineThrough
        {
            fragment.skip_ink = TextDecorationSkipInk::None;
        }
    }
    let node_id = root.node_id.clone();
    let warning_message = skip_ink_limit_message(&error);
    let IrNodeKind::Text {
        text_decorations, ..
    } = &mut root.kind
    else {
        return Err(error);
    };
    *text_decorations = Some(fallback_decorations);
    root.bbox = text_bbox_with_decorations(&root.kind, original_bbox, &node_id)?;
    warnings.push(SerializedRecoverableError::recoverable(
        RecoverableCode::TextDecorationSkipInkLimit,
        warning_message,
        PipelineStage::Ir,
        Some(node_id),
        "rendered text decoration without skip-ink",
    ));
    Ok(())
}

fn resolve_text_decoration_skip_ink_for_node(
    root: &mut IrNode,
    registry: &FontRegistry,
) -> Result<(), EngineError> {
    let node_id = root.node_id.clone();
    let node_bbox = root.bbox;
    let curved_path_context = curved_path_context(&root.kind, &node_id)?;
    let eligible_line_indices = skip_ink_line_indices(&root.kind);
    if eligible_line_indices.is_empty() {
        root.bbox = text_bbox_with_decorations(&root.kind, node_bbox, &node_id)?;
        return Ok(());
    }

    let glyph_count = count_text_node_ink_glyphs(
        &root.kind,
        &eligible_line_indices,
        MAX_TEXT_DECORATION_SKIP_INK_GLYPHS,
    );
    if glyph_count > MAX_TEXT_DECORATION_SKIP_INK_GLYPHS {
        return Err(skip_ink_limit_error(
            &node_id,
            format!(
                "Text decoration skip-ink glyph count {glyph_count} exceeds the limit {MAX_TEXT_DECORATION_SKIP_INK_GLYPHS}."
            ),
        ));
    }

    let ink_paths = extract_text_node_ink_paths(
        &root.kind,
        node_bbox,
        &node_id,
        registry,
        &eligible_line_indices,
    )?;
    let mut parsed_ink_regions = vec![None; ink_paths.len()];
    let mut remaining_pair_budget = MAX_TEXT_DECORATION_SKIP_INK_CANDIDATE_PAIRS;
    let mut final_contour_count = 0_usize;
    let mut final_segment_count = 0_usize;

    let IrNodeKind::Text {
        writing_mode,
        text_decorations: Some(fragments),
        ..
    } = &mut root.kind
    else {
        return Ok(());
    };
    let mut remaining_curved_sample_budget = remaining_curved_sample_budget(fragments, &node_id)?;
    let vertical = writing_mode.as_deref() == Some("vertical-rl");

    for fragment in fragments {
        if fragment.skip_ink != TextDecorationSkipInk::All
            || fragment.line == TextDecorationLine::LineThrough
        {
            accumulate_final_complexity(
                &fragment.paths,
                &mut final_contour_count,
                &mut final_segment_count,
                &node_id,
            )?;
            continue;
        }

        let curved_phase_origin = resolve_curved_phase_origin(&fragment.paths, &node_id)?;
        let mut resolved_paths = Vec::with_capacity(fragment.paths.len());
        for path in std::mem::take(&mut fragment.paths) {
            if let Some(resolved_path) = resolve_paint_path_with_context(
                path,
                fragment.style,
                curved_phase_origin,
                vertical,
                &ink_paths,
                &mut parsed_ink_regions,
                &mut remaining_pair_budget,
                &mut remaining_curved_sample_budget,
                curved_path_context.as_ref(),
                &node_id,
            )? {
                accumulate_final_complexity(
                    std::slice::from_ref(&resolved_path),
                    &mut final_contour_count,
                    &mut final_segment_count,
                    &node_id,
                )?;
                resolved_paths.push(resolved_path);
            }
        }
        fragment.paths = resolved_paths;
    }
    root.bbox = text_bbox_with_decorations(&root.kind, node_bbox, &node_id)?;
    Ok(())
}

fn is_skip_ink_limit_error(error: &EngineError) -> bool {
    matches!(
        error,
        EngineError::Structured { code, .. } if code == "TEXT_DECORATION_SKIP_INK_LIMIT"
    )
}

fn skip_ink_limit_message(error: &EngineError) -> String {
    match error {
        EngineError::Structured { message, .. } => message.clone(),
        _ => error.to_string(),
    }
}

fn resolve_curved_phase_origin(
    paths: &[TextDecorationPaintPath],
    node_id: &str,
) -> Result<Option<f64>, EngineError> {
    let mut phase_origin: Option<f64> = None;
    for path in paths {
        if path.path_distance_start_px.is_none() && path.path_distance_end_px.is_none() {
            continue;
        }
        let Some(path_phase_origin) = path.path_phase_origin_px else {
            return Err(decoration_geometry_error(
                node_id,
                "Curved text decoration owner phase metadata is unavailable.",
            ));
        };
        if !path_phase_origin.is_finite() {
            return Err(decoration_geometry_error(
                node_id,
                "Curved text decoration owner phase must be finite.",
            ));
        }
        if let Some(existing_phase_origin) = phase_origin
            && existing_phase_origin != path_phase_origin
        {
            return Err(decoration_geometry_error(
                node_id,
                "Curved text decoration owner phase must be consistent across fragments.",
            ));
        }
        phase_origin = Some(path_phase_origin);
    }
    Ok(phase_origin)
}

fn text_bbox_with_decorations(
    kind: &IrNodeKind,
    text_bbox: BBox,
    node_id: &str,
) -> Result<BBox, EngineError> {
    let IrNodeKind::Text {
        text_decorations: Some(fragments),
        ..
    } = kind
    else {
        return Ok(text_bbox);
    };
    let mut resolved_bbox = text_bbox;
    for path in fragments.iter().flat_map(|fragment| &fragment.paths) {
        if !path.origin_x.is_finite() || !path.origin_y.is_finite() {
            return Err(decoration_geometry_error(
                node_id,
                "Text decoration position must be finite.",
            ));
        }
        let region = parse_filled_region(&path.d, node_id)?;
        let Some((min_x, min_y, max_x, max_y)) = region_axis_bounds(&region) else {
            continue;
        };
        resolved_bbox = union_bbox(
            resolved_bbox,
            BBox {
                x: min_x + path.origin_x,
                y: min_y + path.origin_y,
                w: max_x - min_x,
                h: max_y - min_y,
            },
        );
    }
    Ok(resolved_bbox)
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

fn skip_ink_line_indices(kind: &IrNodeKind) -> HashSet<usize> {
    let IrNodeKind::Text {
        text_decorations: Some(fragments),
        ..
    } = kind
    else {
        return HashSet::new();
    };
    fragments
        .iter()
        .filter(|fragment| {
            fragment.skip_ink == TextDecorationSkipInk::All
                && fragment.line != TextDecorationLine::LineThrough
        })
        .flat_map(|fragment| fragment.paths.iter())
        .map(|path| path.line_index as usize)
        .collect()
}

fn curved_path_context(
    kind: &IrNodeKind,
    node_id: &str,
) -> Result<Option<(MeasuredPath, PathTraversalDirection)>, EngineError> {
    let IrNodeKind::Text {
        text_path: Some(metadata),
        text_decorations: Some(fragments),
        ..
    } = kind
    else {
        return Ok(None);
    };
    let has_curved_skip_ink = fragments.iter().any(|fragment| {
        fragment.skip_ink == TextDecorationSkipInk::All
            && fragment.line != TextDecorationLine::LineThrough
            && fragment.paths.iter().any(|path| {
                path.path_distance_start_px.is_some() || path.path_distance_end_px.is_some()
            })
    });
    if !has_curved_skip_ink {
        return Ok(None);
    }
    let measured_path = measure_single_svg_path(&metadata.d).map_err(|_| {
        decoration_geometry_error(
            node_id,
            "Curved text decoration guide path could not be measured.",
        )
    })?;
    let direction = if metadata.path_direction == "reverse" {
        PathTraversalDirection::Reverse
    } else {
        PathTraversalDirection::Forward
    };
    Ok(Some((measured_path, direction)))
}

fn remaining_curved_sample_budget(
    fragments: &[TextDecorationFragment],
    node_id: &str,
) -> Result<usize, EngineError> {
    let consumed_samples = fragments
        .iter()
        .flat_map(|fragment| &fragment.paths)
        .try_fold(0_usize, |total, path| {
            total.checked_add(path.path_sample_count)
        })
        .ok_or_else(|| {
            path_decoration_limit_error(
                node_id,
                "Curved text decoration path sample accounting overflowed.",
            )
        })?;
    crate::text::path::TEXT_PATH_DECORATION_SAMPLE_LIMIT
        .checked_sub(consumed_samples)
        .ok_or_else(|| {
            path_decoration_limit_error(
                node_id,
                format!(
                    "Curved text decoration path samples {consumed_samples} exceed the limit {}.",
                    crate::text::path::TEXT_PATH_DECORATION_SAMPLE_LIMIT
                ),
            )
        })
}

#[expect(
    clippy::too_many_arguments,
    reason = "curved skip-ink budgets are explicit"
)]
fn resolve_curved_paint_path(
    mut path: TextDecorationPaintPath,
    decoration_style: TextDecorationStyle,
    phase_origin: f64,
    decoration_region: Region,
    ink_paths: &[GlyphInkPath],
    parsed_ink_regions: &mut [Option<Region>],
    remaining_pair_budget: &mut usize,
    remaining_sample_budget: &mut usize,
    measured_path: &MeasuredPath,
    direction: PathTraversalDirection,
    node_id: &str,
) -> Result<Option<TextDecorationPaintPath>, EngineError> {
    let (Some(path_start), Some(path_end)) =
        (path.path_distance_start_px, path.path_distance_end_px)
    else {
        return Err(decoration_geometry_error(
            node_id,
            "Curved text decoration distance metadata is incomplete.",
        ));
    };
    let (Some(owner_id), Some(normal_offset), Some(ribbon_half_width)) = (
        path.decoration_owner_id,
        path.path_normal_offset_px,
        path.path_ribbon_half_width_px,
    ) else {
        return Err(decoration_geometry_error(
            node_id,
            "Curved text decoration owner metadata is unavailable.",
        ));
    };
    if !path_start.is_finite()
        || !path_end.is_finite()
        || path_end <= path_start
        || !phase_origin.is_finite()
        || !normal_offset.is_finite()
        || !ribbon_half_width.is_finite()
        || ribbon_half_width <= 0.0
    {
        return Err(decoration_geometry_error(
            node_id,
            "Curved text decoration distance inputs must be finite.",
        ));
    }
    let Some((min_x, min_y, max_x, max_y)) = region_axis_bounds(&decoration_region) else {
        return Ok(None);
    };
    let absolute_decoration_bbox = BBox {
        x: min_x + path.origin_x,
        y: min_y + path.origin_y,
        w: max_x - min_x,
        h: max_y - min_y,
    };
    let clearance_px = path.thickness_px.max(1.0);
    let mut gap_intervals = Vec::new();

    for (ink_index, ink_path) in ink_paths.iter().enumerate() {
        if ink_path.line_index != path.line_index as usize
            || ink_path.decoration_owner_id != Some(owner_id)
            || !bboxes_intersect(absolute_decoration_bbox, ink_path.bbox)
        {
            continue;
        }
        let (Some(glyph_start), Some(glyph_end)) = (
            ink_path.path_distance_start_px,
            ink_path.path_distance_end_px,
        ) else {
            return Err(decoration_geometry_error(
                node_id,
                "Curved skip-ink glyph distance metadata is unavailable.",
            ));
        };
        let search_start = glyph_start.min(glyph_end) - clearance_px;
        let search_end = glyph_start.max(glyph_end) + clearance_px;
        let search_start = search_start.max(path_start);
        let search_end = search_end.min(path_end);
        if search_end <= search_start {
            continue;
        }
        if parsed_ink_regions[ink_index].is_none() {
            parsed_ink_regions[ink_index] = Some(parse_filled_region(&ink_path.d, node_id)?);
        }
        let Some(absolute_ink_region) = parsed_ink_regions[ink_index].as_ref() else {
            continue;
        };
        let local_ink_region =
            translate_region(absolute_ink_region, -path.origin_x, -path.origin_y);
        let intersection = boolean_regions_with_pair_budget(
            &decoration_region,
            &local_ink_region,
            BooleanOp::Intersect,
            remaining_pair_budget,
        );
        let preferred_distance = (glyph_start + glyph_end) * 0.5;
        let projected = match intersection {
            Ok(intersection)
                if !intersection.contours.is_empty() && region_has_positive_area(&intersection) =>
            {
                project_region_to_measured_path_interval(
                    &intersection,
                    measured_path,
                    search_start,
                    search_end,
                    preferred_distance,
                    direction,
                    remaining_pair_budget,
                )
                .map_err(|error| map_curved_skip_shape_error(&error, node_id, "glyph projection"))?
            }
            Ok(_) => None,
            Err(ShapeError::BooleanTopology) => {
                project_region_intersection_to_measured_path_interval(
                    &decoration_region,
                    &local_ink_region,
                    measured_path,
                    search_start,
                    search_end,
                    preferred_distance,
                    direction,
                    remaining_pair_budget,
                )
                .map_err(|error| {
                    map_curved_skip_shape_error(&error, node_id, "classified-edge glyph projection")
                })?
            }
            Err(error) => {
                return Err(map_curved_skip_shape_error(
                    &error,
                    node_id,
                    "glyph intersection",
                ));
            }
        };
        if let Some((projected_start, projected_end)) = projected {
            let gap_start = (projected_start - clearance_px).max(path_start);
            let gap_end = (projected_end + clearance_px).min(path_end);
            if gap_end - gap_start > GEOMETRY_EPSILON {
                gap_intervals.push((gap_start, gap_end));
            }
        }
    }
    if gap_intervals.is_empty() {
        return Ok(Some(path));
    }
    merge_intervals(&mut gap_intervals);

    let mut resolved_region = decoration_region;
    for (gap_index, &(gap_start, gap_end)) in gap_intervals.iter().enumerate() {
        let gap_ribbon = measured_path_offset_band(
            measured_path,
            gap_start,
            gap_end,
            direction,
            ribbon_half_width + clearance_px,
            remaining_sample_budget,
            |_| normal_offset,
        )
        .map_err(|error| map_curved_skip_shape_error(&error, node_id, "gap ribbon"))?;
        resolved_region = subtract_curved_gap(
            &resolved_region,
            &gap_ribbon,
            decoration_style,
            remaining_pair_budget,
            remaining_sample_budget,
            &CurvedDecorationRebuild {
                measured_path,
                direction,
                path_start,
                path_end,
                phase_origin,
                normal_offset,
                thickness_px: path.thickness_px,
                applied_gap_intervals: &gap_intervals[..=gap_index],
            },
            node_id,
        )?;
        if resolved_region.contours.is_empty() || !region_has_positive_area(&resolved_region) {
            return Ok(None);
        }
    }
    let resolved_region = canonicalize_region(resolved_region);
    let contour_count = resolved_region.contours.len();
    let segment_count = resolved_region
        .contours
        .iter()
        .map(|contour| contour.segments.len())
        .sum::<usize>();
    path.contour_count = u32::try_from(contour_count)
        .map_err(|_| skip_ink_limit_error(node_id, "Curved skip-ink contour count overflowed."))?;
    path.segment_count = u32::try_from(segment_count)
        .map_err(|_| skip_ink_limit_error(node_id, "Curved skip-ink segment count overflowed."))?;
    path.d = region_to_path(&resolved_region);
    if path.d.is_empty() {
        return Err(decoration_geometry_error(
            node_id,
            "Curved text decoration skip-ink result could not be serialized.",
        ));
    }
    Ok(Some(path))
}

struct CurvedDecorationRebuild<'a> {
    measured_path: &'a MeasuredPath,
    direction: PathTraversalDirection,
    path_start: f64,
    path_end: f64,
    phase_origin: f64,
    normal_offset: f64,
    thickness_px: f64,
    applied_gap_intervals: &'a [(f64, f64)],
}

fn subtract_curved_gap(
    decoration_region: &Region,
    gap_ribbon: &Region,
    decoration_style: TextDecorationStyle,
    remaining_pair_budget: &mut usize,
    remaining_sample_budget: &mut usize,
    rebuild: &CurvedDecorationRebuild<'_>,
    node_id: &str,
) -> Result<Region, EngineError> {
    if decoration_style != TextDecorationStyle::Dotted {
        return match boolean_regions_with_pair_budget(
            decoration_region,
            gap_ribbon,
            BooleanOp::Subtract,
            remaining_pair_budget,
        ) {
            Ok(region) => Ok(region),
            Err(ShapeError::BooleanTopology) if decoration_region.contours.len() > 1 => {
                match subtract_curved_gap_by_contour(
                    decoration_region,
                    gap_ribbon,
                    remaining_pair_budget,
                ) {
                    Ok(region) => Ok(region),
                    Err(ShapeError::BooleanTopology) => rebuild_curved_decoration_without_gaps(
                        decoration_style,
                        remaining_sample_budget,
                        rebuild,
                        node_id,
                    ),
                    Err(error) => Err(map_curved_skip_shape_error(
                        &error,
                        node_id,
                        "localized gap subtraction",
                    )),
                }
            }
            Err(ShapeError::BooleanTopology) => rebuild_curved_decoration_without_gaps(
                decoration_style,
                remaining_sample_budget,
                rebuild,
                node_id,
            ),
            Err(error) => Err(map_curved_skip_shape_error(
                &error,
                node_id,
                "gap subtraction",
            )),
        };
    }

    let mut contours = Vec::new();
    for contour in &decoration_region.contours {
        let dot = Region {
            contours: vec![contour.clone()],
        };
        if !regions_have_positive_bbox_overlap(&dot, gap_ribbon) {
            contours.push(contour.clone());
            continue;
        }
        let intersection = boolean_regions_with_pair_budget(
            &dot,
            gap_ribbon,
            BooleanOp::Intersect,
            remaining_pair_budget,
        );
        match intersection {
            Ok(intersection)
                if intersection.contours.is_empty() || !region_has_positive_area(&intersection) =>
            {
                contours.push(contour.clone());
                continue;
            }
            Ok(_) => {}
            Err(ShapeError::BooleanTopology) => {
                let occupied = intersection_axis_intervals_with_pair_budget(
                    &dot,
                    gap_ribbon,
                    RegionAxis::X,
                    remaining_pair_budget,
                )
                .map_err(|error| {
                    map_curved_skip_shape_error(
                        &error,
                        node_id,
                        "dotted classified-edge intersection",
                    )
                })?;
                if occupied.is_empty() {
                    contours.push(contour.clone());
                    continue;
                }
            }
            Err(error) => {
                return Err(map_curved_skip_shape_error(
                    &error,
                    node_id,
                    "dotted gap intersection",
                ));
            }
        }
        let retained = boolean_regions_with_pair_budget(
            &dot,
            gap_ribbon,
            BooleanOp::Subtract,
            remaining_pair_budget,
        );
        match retained {
            Ok(retained) => contours.extend(retained.contours),
            Err(ShapeError::BooleanTopology) => {
                // A positive intersection was already established above. If
                // tracing the residual sliver fails, dropping this connected
                // dot preserves dotted style and guarantees the skip-ink gap
                // instead of emitting a malformed partial contour.
            }
            Err(error) => {
                return Err(map_curved_skip_shape_error(
                    &error,
                    node_id,
                    "dotted gap subtraction",
                ));
            }
        }
    }
    Ok(canonicalize_region(Region { contours }))
}

fn subtract_curved_gap_by_contour(
    decoration_region: &Region,
    gap_ribbon: &Region,
    remaining_pair_budget: &mut usize,
) -> Result<Region, ShapeError> {
    let mut contours = Vec::new();
    for contour in &decoration_region.contours {
        let connected_decoration = Region {
            contours: vec![contour.clone()],
        };
        if !regions_have_positive_bbox_overlap(&connected_decoration, gap_ribbon) {
            contours.push(contour.clone());
            continue;
        }
        let retained = boolean_regions_with_pair_budget(
            &connected_decoration,
            gap_ribbon,
            BooleanOp::Subtract,
            remaining_pair_budget,
        )?;
        contours.extend(retained.contours);
    }
    Ok(canonicalize_region(Region { contours }))
}

fn rebuild_curved_decoration_without_gaps(
    decoration_style: TextDecorationStyle,
    remaining_sample_budget: &mut usize,
    rebuild: &CurvedDecorationRebuild<'_>,
    node_id: &str,
) -> Result<Region, EngineError> {
    let retained_intervals = complement_intervals(
        rebuild.applied_gap_intervals,
        rebuild.path_start,
        rebuild.path_end,
    );
    let mut contours = Vec::new();
    for (retained_start, retained_end) in retained_intervals {
        let retained = crate::text::path::rebuild_curved_decoration_interval(
            rebuild.measured_path,
            retained_start,
            retained_end,
            rebuild.phase_origin,
            rebuild.direction,
            rebuild.normal_offset,
            rebuild.thickness_px,
            decoration_style,
            remaining_sample_budget,
        )
        .map_err(|error| map_curved_decoration_rebuild_error(&error, node_id))?;
        contours.extend(retained.contours);
    }
    Ok(canonicalize_region(Region { contours }))
}

fn map_curved_decoration_rebuild_error(
    error: &crate::text::path::TextOnPathError,
    node_id: &str,
) -> EngineError {
    match error {
        crate::text::path::TextOnPathError::DecorationLimit => path_decoration_limit_error(
            node_id,
            "Curved text decoration skip-ink rebuild exceeded the shared path sample limit.",
        ),
        crate::text::path::TextOnPathError::DecorationPatternLimit => skip_ink_limit_error(
            node_id,
            "Curved text decoration skip-ink rebuild exceeded the pattern geometry limit.",
        ),
        _ => decoration_geometry_error(node_id, "Curved text decoration skip-ink rebuild failed."),
    }
}

fn regions_have_positive_bbox_overlap(left: &Region, right: &Region) -> bool {
    let (
        Some((left_min_x, left_min_y, left_max_x, left_max_y)),
        Some((right_min_x, right_min_y, right_max_x, right_max_y)),
    ) = (region_axis_bounds(left), region_axis_bounds(right))
    else {
        return false;
    };
    left_max_x > right_min_x + GEOMETRY_EPSILON
        && right_max_x > left_min_x + GEOMETRY_EPSILON
        && left_max_y > right_min_y + GEOMETRY_EPSILON
        && right_max_y > left_min_y + GEOMETRY_EPSILON
}

fn map_curved_skip_shape_error(error: &ShapeError, node_id: &str, operation: &str) -> EngineError {
    match error {
        ShapeError::BooleanPairLimit => skip_ink_limit_error(
            node_id,
            format!(
                "Curved text decoration skip-ink {operation} exceeded its deterministic limit."
            ),
        ),
        ShapeError::PathOffsetSampleLimit => path_decoration_limit_error(
            node_id,
            format!(
                "Curved text decoration skip-ink {operation} exceeded the shared path sample limit."
            ),
        ),
        _ => decoration_geometry_error(
            node_id,
            format!("Curved text decoration skip-ink {operation} failed."),
        ),
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "decoration geometry, glyph cache, path context, and caller-owned budgets are explicit"
)]
fn resolve_paint_path_with_context(
    mut path: TextDecorationPaintPath,
    decoration_style: TextDecorationStyle,
    curved_phase_origin: Option<f64>,
    vertical: bool,
    ink_paths: &[GlyphInkPath],
    parsed_ink_regions: &mut [Option<Region>],
    remaining_pair_budget: &mut usize,
    remaining_curved_sample_budget: &mut usize,
    curved_path_context: Option<&(MeasuredPath, PathTraversalDirection)>,
    node_id: &str,
) -> Result<Option<TextDecorationPaintPath>, EngineError> {
    if !path.origin_x.is_finite()
        || !path.origin_y.is_finite()
        || !path.thickness_px.is_finite()
        || path.thickness_px <= 0.0
    {
        return Err(decoration_geometry_error(
            node_id,
            "Text decoration skip-ink inputs must be finite.",
        ));
    }
    let decoration_region = parse_filled_region(&path.d, node_id)?;
    if path.path_distance_start_px.is_some() || path.path_distance_end_px.is_some() {
        let Some((measured_path, direction)) = curved_path_context else {
            return Err(decoration_geometry_error(
                node_id,
                "Curved text decoration path metadata is unavailable.",
            ));
        };
        let Some(phase_origin) = curved_phase_origin else {
            return Err(decoration_geometry_error(
                node_id,
                "Curved text decoration phase metadata is unavailable.",
            ));
        };
        return resolve_curved_paint_path(
            path,
            decoration_style,
            phase_origin,
            decoration_region,
            ink_paths,
            parsed_ink_regions,
            remaining_pair_budget,
            remaining_curved_sample_budget,
            measured_path,
            *direction,
            node_id,
        );
    }
    let Some((min_x, min_y, max_x, max_y)) = region_axis_bounds(&decoration_region) else {
        return Ok(None);
    };
    let absolute_decoration_bbox = BBox {
        x: min_x + path.origin_x,
        y: min_y + path.origin_y,
        w: max_x - min_x,
        h: max_y - min_y,
    };
    let (inline_min, inline_max) = if vertical {
        (min_y, max_y)
    } else {
        (min_x, max_x)
    };
    let clearance_px = path.thickness_px.max(1.0);
    let mut gap_intervals = Vec::new();

    for (ink_index, ink_path) in ink_paths.iter().enumerate() {
        if ink_path.line_index != path.line_index as usize
            || !bboxes_intersect(absolute_decoration_bbox, ink_path.bbox)
        {
            continue;
        }
        if parsed_ink_regions[ink_index].is_none() {
            parsed_ink_regions[ink_index] = Some(parse_filled_region(&ink_path.d, node_id)?);
        }
        let Some(absolute_ink_region) = parsed_ink_regions[ink_index].as_ref() else {
            continue;
        };
        let local_ink_region =
            translate_region(absolute_ink_region, -path.origin_x, -path.origin_y);
        let intersection = intersect_decoration_with_ink(
            &decoration_region,
            &local_ink_region,
            ink_path,
            &path,
            vertical,
            remaining_pair_budget,
            node_id,
        )?;

        for (intersection_inline_min, intersection_inline_max) in intersection {
            let gap_start = (intersection_inline_min - clearance_px).max(inline_min);
            let gap_end = (intersection_inline_max + clearance_px).min(inline_max);
            if gap_end - gap_start > GEOMETRY_EPSILON {
                gap_intervals.push((gap_start, gap_end));
            }
        }
    }

    if gap_intervals.is_empty() {
        return Ok(Some(path));
    }
    merge_intervals(&mut gap_intervals);
    let retained_intervals = complement_intervals(&gap_intervals, inline_min, inline_max);
    if retained_intervals.is_empty() {
        return Ok(None);
    }
    let resolved_region = clip_region_to_inline_intervals(
        &decoration_region,
        &retained_intervals,
        vertical,
        node_id,
    )?;
    if resolved_region.contours.is_empty() || !region_has_positive_area(&resolved_region) {
        return Ok(None);
    }

    let contour_count = resolved_region.contours.len();
    let segment_count = resolved_region
        .contours
        .iter()
        .map(|contour| contour.segments.len())
        .sum::<usize>();
    path.contour_count = u32::try_from(contour_count).map_err(|_| {
        skip_ink_limit_error(
            node_id,
            "Text decoration skip-ink contour count overflowed.",
        )
    })?;
    path.segment_count = u32::try_from(segment_count).map_err(|_| {
        skip_ink_limit_error(
            node_id,
            "Text decoration skip-ink segment count overflowed.",
        )
    })?;
    path.d = region_to_path(&resolved_region);
    if path.d.is_empty() {
        return Err(decoration_geometry_error(
            node_id,
            "Text decoration skip-ink result could not be serialized.",
        ));
    }
    Ok(Some(path))
}

#[cfg(test)]
fn resolve_paint_path(
    path: TextDecorationPaintPath,
    vertical: bool,
    ink_paths: &[GlyphInkPath],
    parsed_ink_regions: &mut [Option<Region>],
    remaining_pair_budget: &mut usize,
    node_id: &str,
) -> Result<Option<TextDecorationPaintPath>, EngineError> {
    let mut remaining_sample_budget = crate::text::path::TEXT_PATH_DECORATION_SAMPLE_LIMIT;
    resolve_paint_path_with_context(
        path,
        TextDecorationStyle::Solid,
        None,
        vertical,
        ink_paths,
        parsed_ink_regions,
        remaining_pair_budget,
        &mut remaining_sample_budget,
        None,
        node_id,
    )
}

fn intersect_decoration_with_ink(
    decoration_region: &Region,
    local_ink_region: &Region,
    ink_path: &GlyphInkPath,
    paint_path: &TextDecorationPaintPath,
    vertical: bool,
    remaining_pair_budget: &mut usize,
    node_id: &str,
) -> Result<Vec<(f64, f64)>, EngineError> {
    let mut inline_intervals = Vec::new();
    // Pattern contours are disjoint by construction. Intersecting each one
    // independently avoids coupling remote dots/dashes into one topology
    // trace while preserving the exact filled-region intersection.
    for (contour_index, decoration_contour) in decoration_region.contours.iter().enumerate() {
        let connected_decoration = Region {
            contours: vec![decoration_contour.clone()],
        };
        let Some((min_x, min_y, max_x, max_y)) = region_axis_bounds(&connected_decoration) else {
            continue;
        };
        let absolute_contour_bbox = BBox {
            x: min_x + paint_path.origin_x,
            y: min_y + paint_path.origin_y,
            w: max_x - min_x,
            h: max_y - min_y,
        };
        if !bboxes_intersect(absolute_contour_bbox, ink_path.bbox) {
            continue;
        }
        let contour_intervals = match boolean_regions_with_pair_budget(
            &connected_decoration,
            local_ink_region,
            BooleanOp::Intersect,
            remaining_pair_budget,
        ) {
            Ok(intersection) => intersection_inline_intervals(&intersection, vertical),
            Err(ShapeError::BooleanTopology) => {
                match boolean_regions_with_pair_budget(
                    local_ink_region,
                    &connected_decoration,
                    BooleanOp::Intersect,
                    remaining_pair_budget,
                ) {
                    Ok(intersection) => intersection_inline_intervals(&intersection, vertical),
                    Err(ShapeError::BooleanTopology) => {
                        let local_ink_bbox = BBox {
                            x: ink_path.bbox.x - paint_path.origin_x,
                            y: ink_path.bbox.y - paint_path.origin_y,
                            w: ink_path.bbox.w,
                            h: ink_path.bbox.h,
                        };
                        let intersection_operation = format!(
                            "localized decoration contour {contour_index} intersection near glyph x={}..{}",
                            ink_path.bbox.x,
                            ink_path.bbox.x + ink_path.bbox.w
                        );
                        intersect_localized_decoration(
                            &connected_decoration,
                            local_ink_region,
                            local_ink_bbox,
                            &intersection_operation,
                            vertical,
                            remaining_pair_budget,
                            node_id,
                        )?
                    }
                    Err(error) => {
                        return Err(map_boolean_error_at(
                            &error,
                            node_id,
                            "reverse glyph intersection",
                        ));
                    }
                }
            }
            Err(error) => {
                return Err(map_boolean_error_at(&error, node_id, "glyph intersection"));
            }
        };
        inline_intervals.extend(contour_intervals);
    }
    Ok(inline_intervals)
}

fn intersect_localized_decoration(
    decoration_region: &Region,
    local_ink_region: &Region,
    local_ink_bbox: BBox,
    intersection_operation: &str,
    vertical: bool,
    remaining_pair_budget: &mut usize,
    node_id: &str,
) -> Result<Vec<(f64, f64)>, EngineError> {
    // The direct intersection is normally preferable because it performs one
    // canonical boolean. A long curved strip can, however, leave remote edges
    // in the tracer when only one glyph-adjacent component is relevant. Clip
    // to that glyph first and retry without changing the mathematical result.
    let local_max_x = local_ink_bbox.x + local_ink_bbox.w;
    let local_max_y = local_ink_bbox.y + local_ink_bbox.h;
    let inset = GEOMETRY_EPSILON
        .min(local_ink_bbox.w * 0.25)
        .min(local_ink_bbox.h * 0.25);
    let localized_x = clip_region_to_inline_interval(
        decoration_region,
        (local_ink_bbox.x + inset, local_max_x - inset),
        false,
        node_id,
    )?;
    let localized_decoration = clip_region_to_inline_interval(
        &localized_x,
        (local_ink_bbox.y + inset, local_max_y - inset),
        true,
        node_id,
    )?;
    if localized_decoration.contours.is_empty() || !region_has_positive_area(&localized_decoration)
    {
        return Ok(Vec::new());
    }
    match boolean_regions_with_pair_budget(
        &localized_decoration,
        local_ink_region,
        BooleanOp::Intersect,
        remaining_pair_budget,
    ) {
        Ok(intersection) => Ok(intersection_inline_intervals(&intersection, vertical)),
        Err(ShapeError::BooleanTopology) => {
            let axis = if vertical {
                RegionAxis::Y
            } else {
                RegionAxis::X
            };
            intersection_axis_intervals_with_pair_budget(
                &localized_decoration,
                local_ink_region,
                axis,
                remaining_pair_budget,
            )
            .map_err(|error| map_boolean_error_at(&error, node_id, intersection_operation))
        }
        Err(error) => Err(map_boolean_error_at(
            &error,
            node_id,
            intersection_operation,
        )),
    }
}

fn intersection_inline_intervals(region: &Region, vertical: bool) -> Vec<(f64, f64)> {
    region
        .contours
        .iter()
        .filter_map(|contour| {
            let connected_region = Region {
                contours: vec![contour.clone()],
            };
            if !region_has_positive_area(&connected_region) {
                return None;
            }
            region_axis_bounds(&connected_region).map(
                |(region_min_x, region_min_y, region_max_x, region_max_y)| {
                    if vertical {
                        (region_min_y, region_max_y)
                    } else {
                        (region_min_x, region_max_x)
                    }
                },
            )
        })
        .collect()
}

fn accumulate_final_complexity(
    paths: &[TextDecorationPaintPath],
    contour_count: &mut usize,
    segment_count: &mut usize,
    node_id: &str,
) -> Result<(), EngineError> {
    for path in paths {
        *contour_count = contour_count.saturating_add(path.contour_count as usize);
        *segment_count = segment_count.saturating_add(path.segment_count as usize);
    }
    if *contour_count > MAX_TEXT_DECORATION_PATTERN_CONTOURS
        || *segment_count > MAX_TEXT_DECORATION_PATTERN_SEGMENTS
    {
        return Err(skip_ink_limit_error(
            node_id,
            format!(
                "Text decoration skip-ink result {contour_count} contours / {segment_count} segments exceeds the deterministic limit."
            ),
        ));
    }
    Ok(())
}

fn parse_filled_region(path_data: &str, node_id: &str) -> Result<Region, EngineError> {
    evaluate_geometry(&GeometryDoc {
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
    })
    .map_err(|error| map_boolean_error(&error, node_id))
}

fn translate_region(region: &Region, dx: f64, dy: f64) -> Region {
    Region {
        contours: region
            .contours
            .iter()
            .map(|contour| Contour {
                segments: contour
                    .segments
                    .iter()
                    .map(|segment| translate_segment(segment, dx, dy))
                    .collect(),
                closed: contour.closed,
            })
            .collect(),
    }
}

fn translate_segment(segment: &CurveSegment, dx: f64, dy: f64) -> CurveSegment {
    let translate = |point: Point2D| Point2D {
        x: point.x + dx,
        y: point.y + dy,
    };
    match segment {
        CurveSegment::Line { p0, p1 } => CurveSegment::Line {
            p0: translate(*p0),
            p1: translate(*p1),
        },
        CurveSegment::Quad { p0, p1, p2 } => CurveSegment::Quad {
            p0: translate(*p0),
            p1: translate(*p1),
            p2: translate(*p2),
        },
        CurveSegment::Cubic { p0, p1, p2, p3 } => CurveSegment::Cubic {
            p0: translate(*p0),
            p1: translate(*p1),
            p2: translate(*p2),
            p3: translate(*p3),
        },
    }
}

fn clip_region_to_inline_interval(
    region: &Region,
    interval: (f64, f64),
    vertical: bool,
    node_id: &str,
) -> Result<Region, EngineError> {
    let axis = if vertical {
        RegionAxis::Y
    } else {
        RegionAxis::X
    };
    clip_monotonic_region_to_axis_interval(region, axis, interval.0, interval.1)
        .map_err(|error| map_boolean_error_at(&error, node_id, "gap subtraction"))
}

fn clip_region_to_inline_intervals(
    region: &Region,
    intervals: &[(f64, f64)],
    vertical: bool,
    node_id: &str,
) -> Result<Region, EngineError> {
    let axis = if vertical {
        RegionAxis::Y
    } else {
        RegionAxis::X
    };
    let mut contours = Vec::new();
    for contour in &region.contours {
        let connected_region = Region {
            contours: vec![contour.clone()],
        };
        let Some((min_x, min_y, max_x, max_y)) = region_axis_bounds(&connected_region) else {
            continue;
        };
        let (contour_min, contour_max) = if vertical {
            (min_y, max_y)
        } else {
            (min_x, max_x)
        };
        let first_interval = intervals
            .partition_point(|(_, interval_end)| *interval_end <= contour_min + GEOMETRY_EPSILON);
        for &(interval_start, interval_end) in &intervals[first_interval..] {
            if interval_start >= contour_max - GEOMETRY_EPSILON {
                break;
            }
            let clipped = clip_monotonic_region_to_axis_interval(
                &connected_region,
                axis,
                interval_start,
                interval_end,
            )
            .map_err(|error| map_boolean_error_at(&error, node_id, "gap subtraction"))?;
            contours.extend(clipped.contours);
        }
    }
    Ok(canonicalize_region(Region { contours }))
}

fn complement_intervals(
    gap_intervals: &[(f64, f64)],
    inline_min: f64,
    inline_max: f64,
) -> Vec<(f64, f64)> {
    let mut retained_intervals = Vec::with_capacity(gap_intervals.len() + 1);
    let mut cursor = inline_min;
    for (gap_start, gap_end) in gap_intervals {
        if *gap_start - cursor > GEOMETRY_EPSILON {
            retained_intervals.push((cursor, *gap_start));
        }
        cursor = cursor.max(*gap_end);
    }
    if inline_max - cursor > GEOMETRY_EPSILON {
        retained_intervals.push((cursor, inline_max));
    }
    retained_intervals
}

fn merge_intervals(intervals: &mut Vec<(f64, f64)>) {
    intervals.sort_by(|left, right| {
        left.0
            .total_cmp(&right.0)
            .then_with(|| left.1.total_cmp(&right.1))
    });
    let mut merged: Vec<(f64, f64)> = Vec::with_capacity(intervals.len());
    for interval in intervals.drain(..) {
        if let Some(previous) = merged.last_mut()
            && interval.0 <= previous.1 + GEOMETRY_EPSILON
        {
            previous.1 = previous.1.max(interval.1);
        } else {
            merged.push(interval);
        }
    }
    *intervals = merged;
}

fn bboxes_intersect(left: BBox, right: BBox) -> bool {
    left.x <= right.x + right.w + GEOMETRY_EPSILON
        && right.x <= left.x + left.w + GEOMETRY_EPSILON
        && left.y <= right.y + right.h + GEOMETRY_EPSILON
        && right.y <= left.y + left.h + GEOMETRY_EPSILON
}

fn map_boolean_error(error: &ShapeError, node_id: &str) -> EngineError {
    map_boolean_error_at(error, node_id, "path evaluation")
}

fn map_boolean_error_at(error: &ShapeError, node_id: &str, operation: &str) -> EngineError {
    if *error == ShapeError::BooleanPairLimit {
        return skip_ink_limit_error(
            node_id,
            format!(
                "Text decoration skip-ink candidate pairs exceed the limit {MAX_TEXT_DECORATION_SKIP_INK_CANDIDATE_PAIRS}."
            ),
        );
    }
    decoration_geometry_error(
        node_id,
        format!("Text decoration skip-ink {operation} failed: {error}"),
    )
}

fn decoration_geometry_error(node_id: &str, message: impl Into<String>) -> EngineError {
    EngineError::Structured {
        code: "TEXT_DECORATION_GEOMETRY".to_string(),
        message: message.into(),
        stage: Some(crate::diagnostics::PipelineStage::Ir),
        node_id: Some(node_id.to_string()),
    }
}

fn path_decoration_limit_error(node_id: &str, message: impl Into<String>) -> EngineError {
    EngineError::Structured {
        code: "TEXT_PATH_DECORATION_LIMIT".to_string(),
        message: message.into(),
        stage: Some(crate::diagnostics::PipelineStage::Ir),
        node_id: Some(node_id.to_string()),
    }
}

fn skip_ink_limit_error(node_id: &str, message: impl Into<String>) -> EngineError {
    EngineError::Structured {
        code: "TEXT_DECORATION_SKIP_INK_LIMIT".to_string(),
        message: message.into(),
        stage: Some(crate::diagnostics::PipelineStage::Ir),
        node_id: Some(node_id.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paint_path(d: &str, vertical: bool) -> TextDecorationPaintPath {
        TextDecorationPaintPath {
            line_index: 0,
            d: d.to_string(),
            origin_x: 0.0,
            origin_y: 0.0,
            contour_count: 1,
            segment_count: 4,
            path_distance_start_px: None,
            path_distance_end_px: None,
            path_phase_origin_px: None,
            error: None,
            thickness_px: if vertical { 3.0 } else { 2.0 },
            decoration_owner_id: None,
            path_normal_offset_px: None,
            path_ribbon_half_width_px: None,
            path_sample_count: 0,
        }
    }

    fn ink_path(d: &str, bbox: BBox, line_index: usize) -> GlyphInkPath {
        GlyphInkPath {
            line_index,
            d: d.to_string(),
            bbox,
            decoration_owner_id: None,
            path_distance_start_px: None,
            path_distance_end_px: None,
        }
    }

    #[test]
    fn subtracts_clearance_from_horizontal_decoration() {
        let original = paint_path("M0,0L100,0L100,2L0,2Z", false);
        let ink = ink_path(
            "M20,-4L30,-4L30,6L20,6Z",
            BBox {
                x: 20.0,
                y: -4.0,
                w: 10.0,
                h: 10.0,
            },
            0,
        );
        let mut cache = vec![None];
        let mut budget = MAX_TEXT_DECORATION_SKIP_INK_CANDIDATE_PAIRS;
        let resolved = resolve_paint_path(
            original.clone(),
            false,
            &[ink],
            &mut cache,
            &mut budget,
            "text",
        )
        .expect("skip ink")
        .expect("remaining geometry");

        assert_ne!(resolved.d, original.d);
        assert_eq!(resolved.contour_count, 2);
        assert!(resolved.d.contains("M0,0L18,0"));
        assert!(resolved.d.contains("M32,0L100,0"));
    }

    #[test]
    fn tangent_touch_and_other_line_do_not_cut() {
        let original = paint_path("M0,0L100,0L100,2L0,2Z", false);
        let ink_paths = [
            ink_path(
                "M20,2L30,2L30,6L20,6Z",
                BBox {
                    x: 20.0,
                    y: 2.0,
                    w: 10.0,
                    h: 4.0,
                },
                0,
            ),
            ink_path(
                "M40,-4L50,-4L50,6L40,6Z",
                BBox {
                    x: 40.0,
                    y: -4.0,
                    w: 10.0,
                    h: 10.0,
                },
                1,
            ),
        ];
        let mut cache = vec![None; ink_paths.len()];
        let mut budget = MAX_TEXT_DECORATION_SKIP_INK_CANDIDATE_PAIRS;
        let resolved = resolve_paint_path(
            original.clone(),
            false,
            &ink_paths,
            &mut cache,
            &mut budget,
            "text",
        )
        .expect("tangent skip")
        .expect("original geometry");

        assert_eq!(resolved.d, original.d);
    }

    #[test]
    fn maps_clearance_to_the_vertical_inline_axis() {
        let original = paint_path("M0,0L3,0L3,100L0,100Z", true);
        let ink = ink_path(
            "M-4,20L7,20L7,30L-4,30Z",
            BBox {
                x: -4.0,
                y: 20.0,
                w: 11.0,
                h: 10.0,
            },
            0,
        );
        let mut cache = vec![None];
        let mut budget = MAX_TEXT_DECORATION_SKIP_INK_CANDIDATE_PAIRS;
        let resolved = resolve_paint_path(original, true, &[ink], &mut cache, &mut budget, "text")
            .expect("vertical skip")
            .expect("remaining geometry");

        assert_eq!(resolved.contour_count, 2);
        let resolved_region = parse_filled_region(&resolved.d, "text").expect("resolved region");
        let mut inline_bounds = resolved_region
            .contours
            .iter()
            .filter_map(|contour| {
                region_axis_bounds(&Region {
                    contours: vec![contour.clone()],
                })
                .map(|(_, min_y, _, max_y)| (min_y, max_y))
            })
            .collect::<Vec<_>>();
        inline_bounds.sort_by(|left, right| left.0.total_cmp(&right.0));
        assert_eq!(inline_bounds, vec![(0.0, 17.0), (33.0, 100.0)]);
    }

    #[test]
    fn maps_pair_budget_failure_to_the_stable_skip_ink_error() {
        let original = paint_path("M0,0L100,0L100,2L0,2Z", false);
        let ink = ink_path(
            "M20,-4L30,-4L30,6L20,6Z",
            BBox {
                x: 20.0,
                y: -4.0,
                w: 10.0,
                h: 10.0,
            },
            0,
        );
        let mut cache = vec![None];
        let mut budget = 0;
        let error = resolve_paint_path(original, false, &[ink], &mut cache, &mut budget, "text")
            .expect_err("pair limit");

        assert!(matches!(
            error,
            EngineError::Structured { code, .. } if code == "TEXT_DECORATION_SKIP_INK_LIMIT"
        ));
    }

    #[test]
    fn shares_curved_sample_budget_with_materialized_decoration() {
        let mut original = paint_path("M0,0L1,0L1,1L0,1Z", false);
        original.path_sample_count = crate::text::path::TEXT_PATH_DECORATION_SAMPLE_LIMIT;
        let fragment = TextDecorationFragment {
            line: TextDecorationLine::Underline,
            style: TextDecorationStyle::Solid,
            color: "#000000".to_string(),
            skip_ink: TextDecorationSkipInk::All,
            paths: vec![original.clone()],
            source_start: 0,
            source_end: 1,
        };

        assert_eq!(
            remaining_curved_sample_budget(std::slice::from_ref(&fragment), "text")
                .expect("boundary budget"),
            0
        );

        original.path_sample_count += 1;
        let over_limit = TextDecorationFragment {
            paths: vec![original],
            ..fragment
        };
        let error =
            remaining_curved_sample_budget(&[over_limit], "text").expect_err("sample limit");
        assert!(matches!(
            error,
            EngineError::Structured { code, .. } if code == "TEXT_PATH_DECORATION_LIMIT"
        ));
    }

    #[test]
    fn curved_phase_origin_uses_the_authored_owner_edge_instead_of_the_numeric_minimum() {
        let mut first_path = paint_path("M0,0L1,0L1,1L0,1Z", false);
        first_path.path_distance_start_px = Some(250.0);
        first_path.path_distance_end_px = Some(300.0);
        first_path.path_phase_origin_px = Some(300.0);
        let mut backtracking_path = paint_path("M0,0L1,0L1,1L0,1Z", false);
        backtracking_path.path_distance_start_px = Some(100.0);
        backtracking_path.path_distance_end_px = Some(150.0);
        backtracking_path.path_phase_origin_px = Some(300.0);
        let mut paths = vec![first_path, backtracking_path];

        assert_eq!(
            resolve_curved_phase_origin(&paths, "text").expect("owner phase"),
            Some(300.0)
        );

        paths[1].path_phase_origin_px = Some(301.0);
        assert!(matches!(
            resolve_curved_phase_origin(&paths, "text"),
            Err(EngineError::Structured { code, .. }) if code == "TEXT_DECORATION_GEOMETRY"
        ));
        paths[1].path_phase_origin_px = None;
        assert!(matches!(
            resolve_curved_phase_origin(&paths, "text"),
            Err(EngineError::Structured { code, .. }) if code == "TEXT_DECORATION_GEOMETRY"
        ));
    }

    #[test]
    fn subtracts_noto_h_ink_from_wavy_geometry() {
        let mut original = paint_path(
            "M0,-1C1,0.57 2,2 3,2C4,2 5,0.57 6,-1C7,-2.57 8,-4 9,-4C10,-4 11,-2.57 12,-1C13,0.57 14,2 15,2C16,2 17,0.57 18,-1C19,-2.57 20,-4 21,-4C22,-4 23,-2.57 24,-1C25,0.57 26,2 27,2C28,2 29,0.57 30,-1C31,-2.57 32,-4 33,-4C34,-4 35,-2.57 36,-1C37,0.57 38,2 39,2C40,2 41,0.57 42,-1C43,-2.57 44,-4 45,-4C46,-4 47,-2.57 48,-1C49,0.57 50,2 51,2C52,2 53,0.57 54,-1C55,-2.57 56,-4 57,-4C58,-4 59,-2.57 60,-1C61,0.57 62,2 63,2C64,2 65,0.57 66,-1C67,-2.57 68,-4 69,-4C70,-4 71,-2.57 72,-1C73,0.57 74,2 75,2C76,2 77,0.57 78,-1C79,-2.57 80,-4 81,-4C82,-4 83,-2.57 84,-1C85,0.57 86,2 87,2C88,2 89,0.57 90,-1C91,-2.57 92,-4 93,-4C93.06,-4 93.12,-3.99 93.18,-3.98L93.18,-1.98C93.12,-1.99 93.06,-2 93,-2C92,-2 91,-0.57 90,1C89,2.57 88,4 87,4C86,4 85,2.57 84,1C83,-0.57 82,-2 81,-2C80,-2 79,-0.57 78,1C77,2.57 76,4 75,4C74,4 73,2.57 72,1C71,-0.57 70,-2 69,-2C68,-2 67,-0.57 66,1C65,2.57 64,4 63,4C62,4 61,2.57 60,1C59,-0.57 58,-2 57,-2C56,-2 55,-0.57 54,1C53,2.57 52,4 51,4C50,4 49,2.57 48,1C47,-0.57 46,-2 45,-2C44,-2 43,-0.57 42,1C41,2.57 40,4 39,4C38,4 37,2.57 36,1C35,-0.57 34,-2 33,-2C32,-2 31,-0.57 30,1C29,2.57 28,4 27,4C26,4 25,2.57 24,1C23,-0.57 22,-2 21,-2C20,-2 19,-0.57 18,1C17,2.57 16,4 15,4C14,4 13,2.57 12,1C11,-0.57 10,-2 9,-2C8,-2 7,-0.57 6,1C5,2.57 4,4 3,4C2,4 1,2.57 0,1Z",
            false,
        );
        original.origin_y = 24.16;
        original.segment_count = 66;
        let ink_paths = [
            ink_path(
                "M3.23,32.16L3.23,8.7L6.18,8.7L6.18,18.53L17.12,18.53L17.12,8.7L20.1,8.7L20.1,32.16L17.12,32.16L17.12,21.09L6.18,21.09L6.18,32.16L3.23,32.16Z",
                BBox {
                    x: 3.23,
                    y: 8.7,
                    w: 16.87,
                    h: 23.46,
                },
                0,
            ),
            ink_path(
                "M26.53,32.16L26.53,8.7L29.47,8.7L29.47,18.53L40.42,18.53L40.42,8.7L43.39,8.7L43.39,32.16L40.42,32.16L40.42,21.09L29.47,21.09L29.47,32.16L26.53,32.16Z",
                BBox {
                    x: 26.53,
                    y: 8.7,
                    w: 16.86,
                    h: 23.46,
                },
                0,
            ),
            ink_path(
                "M49.82,32.16L49.82,8.7L52.77,8.7L52.77,18.53L63.71,18.53L63.71,8.7L66.69,8.7L66.69,32.16L63.71,32.16L63.71,21.09L52.77,21.09L52.77,32.16L49.82,32.16Z",
                BBox {
                    x: 49.82,
                    y: 8.7,
                    w: 16.87,
                    h: 23.46,
                },
                0,
            ),
            ink_path(
                "M73.12,32.16L73.12,8.7L76.06,8.7L76.06,18.53L87.01,18.53L87.01,8.7L89.98,8.7L89.98,32.16L87.01,32.16L87.01,21.09L76.06,21.09L76.06,32.16L73.12,32.16Z",
                BBox {
                    x: 73.12,
                    y: 8.7,
                    w: 16.86,
                    h: 23.46,
                },
                0,
            ),
        ];
        let mut cache = vec![None; ink_paths.len()];
        let mut budget = MAX_TEXT_DECORATION_SKIP_INK_CANDIDATE_PAIRS;
        let resolved = resolve_paint_path(
            original.clone(),
            false,
            &ink_paths,
            &mut cache,
            &mut budget,
            "text",
        )
        .expect("wavy skip ink")
        .expect("remaining geometry");

        assert_ne!(resolved.d, original.d);
        assert!(resolved.contour_count > 1);
    }

    #[test]
    fn subtracts_noto_decoration_glyph_from_wavy_geometry() {
        let mut original = paint_path(
            "M0,-1C1,0.57 2,2 3,2C4,2 5,0.57 6,-1C7,-2.57 8,-4 9,-4C10,-4 11,-2.57 12,-1C13,0.57 14,2 15,2C16,2 17,0.57 18,-1C19,-2.57 20,-4 21,-4C22,-4 23,-2.57 24,-1C25,0.57 26,2 27,2C28,2 29,0.57 30,-1C31,-2.57 32,-4 33,-4C34,-4 35,-2.57 36,-1C37,0.57 38,2 39,2C40,2 41,0.57 42,-1C43,-2.57 44,-4 45,-4C46,-4 47,-2.57 48,-1C49,0.57 50,2 51,2C52,2 53,0.57 54,-1C55,-2.57 56,-4 57,-4C58,-4 59,-2.57 60,-1C61,0.57 62,2 63,2C64,2 65,0.57 66,-1C67,-2.57 68,-4 69,-4C70,-4 71,-2.57 72,-1C73,0.57 74,2 75,2C76,2 77,0.57 78,-1C79,-2.57 80,-4 81,-4C82,-4 83,-2.57 84,-1C85,0.57 86,2 87,2C88,2 89,0.57 90,-1C91,-2.57 92,-4 93,-4C93.06,-4 93.12,-3.99 93.18,-3.98L93.18,-1.98C93.12,-1.99 93.06,-2 93,-2C92,-2 91,-0.57 90,1C89,2.57 88,4 87,4C86,4 85,2.57 84,1C83,-0.57 82,-2 81,-2C80,-2 79,-0.57 78,1C77,2.57 76,4 75,4C74,4 73,2.57 72,1C71,-0.57 70,-2 69,-2C68,-2 67,-0.57 66,1C65,2.57 64,4 63,4C62,4 61,2.57 60,1C59,-0.57 58,-2 57,-2C56,-2 55,-0.57 54,1C53,2.57 52,4 51,4C50,4 49,2.57 48,1C47,-0.57 46,-2 45,-2C44,-2 43,-0.57 42,1C41,2.57 40,4 39,4C38,4 37,2.57 36,1C35,-0.57 34,-2 33,-2C32,-2 31,-0.57 30,1C29,2.57 28,4 27,4C26,4 25,2.57 24,1C23,-0.57 22,-2 21,-2C20,-2 19,-0.57 18,1C17,2.57 16,4 15,4C14,4 13,2.57 12,1C11,-0.57 10,-2 9,-2C8,-2 7,-0.57 6,1C5,2.57 4,4 3,4C2,4 1,2.57 0,1Z",
            false,
        );
        original.origin_x = 192.0;
        original.origin_y = 38.94;
        original.segment_count = 66;
        let ink = ink_path(
            "M235.46,34.63L237.58,34.63L237.58,37.94L235.46,37.94L235.46,34.63ZM235.15,37.4L236.8,38.16Q235.79,39.14 234.41,40.04Q233.02,40.93 231.42,41.67Q229.83,42.42 228.13,42.99Q226.44,43.56 224.82,43.93Q224.59,43.56 224.26,43.1Q223.92,42.64 223.61,42.36Q225.24,42.05 226.87,41.56Q228.51,41.07 230.07,40.43Q231.62,39.78 232.94,39.03Q234.25,38.27 235.15,37.4ZM237.89,37.43Q238.84,39.64 240.52,41.37Q242.2,43.09 244.5,44.29Q246.8,45.5 249.57,46.06Q249.23,46.36 248.88,46.87Q248.53,47.37 248.34,47.79Q245.42,47.06 243.04,45.71Q240.66,44.35 238.93,42.37Q237.19,40.4 236.1,37.88L237.89,37.43ZM246.07,39L247.61,40.15Q246.77,40.71 245.75,41.3Q244.72,41.88 243.7,42.4Q242.68,42.92 241.78,43.31L240.52,42.3Q241.42,41.88 242.44,41.32Q243.46,40.76 244.43,40.15Q245.4,39.53 246.07,39ZM226.89,45.66Q228.37,45.47 230.28,45.23Q232.18,44.99 234.35,44.7Q236.52,44.4 238.7,44.1L238.79,45.86Q236.74,46.17 234.66,46.46Q232.57,46.76 230.68,47.02Q228.79,47.29 227.25,47.51L226.89,45.66ZM224.03,36.9L249.15,36.9L249.15,38.55L224.03,38.55L224.03,36.9ZM233.47,25.78L249.2,25.78L249.2,27.63L233.47,27.63L233.47,25.78ZM234.36,32.08L248.36,32.08L248.36,33.93L234.36,33.93L234.36,32.08ZM230.11,21.92L232.07,21.92L232.07,35.11L230.11,35.11L230.11,21.92ZM240.19,21.92L242.26,21.92L242.26,33.26L240.19,33.26L240.19,21.92ZM224.48,24.66L225.77,23.46Q226.69,24.05 227.7,24.86Q228.71,25.67 229.24,26.34L227.9,27.69Q227.56,27.24 226.99,26.71Q226.41,26.18 225.75,25.63Q225.1,25.08 224.48,24.66ZM223.61,31.86Q224.73,31.41 226.23,30.75Q227.73,30.1 229.35,29.34L229.77,31.1Q228.37,31.72 226.97,32.38Q225.57,33.04 224.34,33.62L223.61,31.86ZM230.22,41.49L231.37,40.34L232.26,40.65L232.26,46.17L230.22,46.17L230.22,41.49Z",
            BBox {
                x: 223.61,
                y: 21.92,
                w: 25.96,
                h: 25.87,
            },
            0,
        );
        let mut cache = vec![None];
        let mut budget = MAX_TEXT_DECORATION_SKIP_INK_CANDIDATE_PAIRS;
        let resolved = resolve_paint_path(
            original.clone(),
            false,
            &[ink],
            &mut cache,
            &mut budget,
            "text",
        )
        .expect("wavy CJK skip ink")
        .expect("remaining geometry");

        assert_ne!(resolved.d, original.d);
        assert!(resolved.contour_count > 1);
    }

    #[test]
    fn subtracts_noto_h_ink_from_dotted_geometry() {
        let mut original = paint_path(
            "M6,0C6,0.55 5.55,1 5,1C4.45,1 4,0.55 4,0C4,-0.55 4.45,-1 5,-1C5.55,-1 6,-0.55 6,0Z M18,0C18,0.55 17.55,1 17,1C16.45,1 16,0.55 16,0C16,-0.55 16.45,-1 17,-1C17.55,-1 18,-0.55 18,0Z",
            false,
        );
        original.origin_y = 24.16;
        original.contour_count = 2;
        original.segment_count = 8;
        let ink = ink_path(
            "M3.23,32.16L3.23,8.7L6.18,8.7L6.18,18.53L17.12,18.53L17.12,8.7L20.1,8.7L20.1,32.16L17.12,32.16L17.12,21.09L6.18,21.09L6.18,32.16L3.23,32.16Z",
            BBox {
                x: 3.23,
                y: 8.7,
                w: 16.87,
                h: 23.46,
            },
            0,
        );
        let mut cache = vec![None];
        let mut budget = MAX_TEXT_DECORATION_SKIP_INK_CANDIDATE_PAIRS;
        let resolved = resolve_paint_path(
            original.clone(),
            false,
            &[ink],
            &mut cache,
            &mut budget,
            "text",
        )
        .expect("dotted skip ink");

        assert!(resolved.is_none());
    }

    #[test]
    fn subtracts_repeated_noto_h_ink_from_dotted_geometry() {
        let dotted_d = (0..23)
            .map(|index| {
                let center = f64::from(index * 4 + 1);
                let left = center - 1.0;
                let right = center + 1.0;
                let left_control = center - 0.55;
                let right_control = center + 0.55;
                format!(
                    "M{right},0C{right},0.55 {right_control},1 {center},1C{left_control},1 {left},0.55 {left},0C{left},-0.55 {left_control},-1 {center},-1C{right_control},-1 {right},-0.55 {right},0Z"
                )
            })
            .collect::<Vec<_>>()
            .join(" ");
        let mut original = paint_path(&dotted_d, false);
        original.origin_y = 24.16;
        original.contour_count = 23;
        original.segment_count = 92;
        let ink_paths = [
            ink_path(
                "M3.23,32.16L3.23,8.7L6.18,8.7L6.18,18.53L17.12,18.53L17.12,8.7L20.1,8.7L20.1,32.16L17.12,32.16L17.12,21.09L6.18,21.09L6.18,32.16L3.23,32.16Z",
                BBox {
                    x: 3.23,
                    y: 8.7,
                    w: 16.87,
                    h: 23.46,
                },
                0,
            ),
            ink_path(
                "M26.53,32.16L26.53,8.7L29.47,8.7L29.47,18.53L40.42,18.53L40.42,8.7L43.39,8.7L43.39,32.16L40.42,32.16L40.42,21.09L29.47,21.09L29.47,32.16L26.53,32.16Z",
                BBox {
                    x: 26.53,
                    y: 8.7,
                    w: 16.86,
                    h: 23.46,
                },
                0,
            ),
            ink_path(
                "M49.82,32.16L49.82,8.7L52.77,8.7L52.77,18.53L63.71,18.53L63.71,8.7L66.69,8.7L66.69,32.16L63.71,32.16L63.71,21.09L52.77,21.09L52.77,32.16L49.82,32.16Z",
                BBox {
                    x: 49.82,
                    y: 8.7,
                    w: 16.87,
                    h: 23.46,
                },
                0,
            ),
            ink_path(
                "M73.12,32.16L73.12,8.7L76.06,8.7L76.06,18.53L87.01,18.53L87.01,8.7L89.98,8.7L89.98,32.16L87.01,32.16L87.01,21.09L76.06,21.09L76.06,32.16L73.12,32.16Z",
                BBox {
                    x: 73.12,
                    y: 8.7,
                    w: 16.86,
                    h: 23.46,
                },
                0,
            ),
        ];
        let mut cache = vec![None; ink_paths.len()];
        let mut budget = MAX_TEXT_DECORATION_SKIP_INK_CANDIDATE_PAIRS;
        let resolved = resolve_paint_path(
            original.clone(),
            false,
            &ink_paths,
            &mut cache,
            &mut budget,
            "text",
        )
        .expect("repeated dotted skip ink")
        .expect("remaining dots");

        assert_ne!(resolved.d, original.d);
    }
}
