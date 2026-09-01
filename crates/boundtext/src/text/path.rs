use std::f64::consts::PI;

use boundshape::{
    BooleanOp, Contour, CurveSegment, MeasuredPath, PathTraversalDirection, Point2D, Region,
    ShapeError, boolean_regions, measure_single_svg_path, measured_path_offset_band,
    measured_path_offset_band_chunks, normalize_filled_region, region_to_path,
};
use thiserror::Error;

use crate::font::shaping;
use crate::font::{FontContext, FontEntry, FontRegistry};

use super::engine::layout_text_inner_with_prepared_spans;
use super::grapheme::grapheme_split;
use super::types::{
    FitMode, PositionedGlyph, TextBBox, TextDecorationFragment, TextDecorationInput,
    TextDecorationLine, TextDecorationPaintPath, TextDecorationStyle, TextLayoutRequest,
    TextLayoutResult, TextShadowLayer, TextSpanInput, TextStrokeLayer, WhiteSpaceMode, WrapMode,
    WritingMode,
};
use super::unit_map::{TextUnitKind, TextUnitMap, TextUnitRubyMode, build_text_unit_map};

pub const TEXT_PATH_SOURCE_BYTE_LIMIT: usize = 1_048_576;
pub const TEXT_PATH_OFFSET_ABSOLUTE_LIMIT_PX: f64 = 1e12;
pub const TEXT_PATH_CLUSTER_LIMIT: usize = 16_384;
pub const TEXT_PATH_SHAPING_RUN_LIMIT: usize = 16_384;
pub const TEXT_PATH_PAINT_RANGE_LIMIT: usize = 16_384;
pub const TEXT_PATH_PAINTED_LAYER_LIMIT: usize = 65_536;
pub const TEXT_PATH_DECORATION_FRAGMENT_LIMIT: usize = 16_384;
pub const TEXT_PATH_DECORATION_SAMPLE_LIMIT: usize = 262_144;
const TEXT_PATH_MIN_CLUSTER_STEP_PX: f64 = 0.01;
const TEXT_PATH_MIN_INLINE_SCALE: f64 = 1.0 / 16.0;
const TEXT_PATH_MAX_INLINE_SCALE: f64 = 16.0;

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "schema", schemars(rename_all = "lowercase"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextPathAnchor {
    Start,
    Middle,
    End,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "schema", schemars(rename_all = "lowercase"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextPathOverflow {
    Hidden,
    Error,
    Ellipsis,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "schema", schemars(rename_all = "lowercase"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextPathFit {
    None,
    Spacing,
    Scale,
    Shrink,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "schema", schemars(rename_all = "lowercase"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextPathDirection {
    Forward,
    Reverse,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "schema", schemars(rename_all = "lowercase"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextPathNormal {
    Left,
    Right,
}

pub struct TextOnPathRequest<'a> {
    pub d: &'a str,
    pub text: TextLayoutRequest<'a>,
    pub start_offset_px: f64,
    pub text_anchor: TextPathAnchor,
    pub path_direction: TextPathDirection,
    pub path_normal: TextPathNormal,
    pub path_offset_px: f64,
    pub path_fit: TextPathFit,
    pub path_overflow: TextPathOverflow,
    pub decoration_owner_ids: &'a [Option<u32>],
    pub unit_map: Option<TextOnPathUnitMapRequest>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextOnPathUnitMapRequest {
    pub kind: TextUnitKind,
    pub ruby: TextUnitRubyMode,
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum TextOnPathError {
    #[error("TextOnPath input contains an invalid numeric value")]
    Invalid,
    #[error("TextOnPath path data is invalid")]
    InvalidData,
    #[error("TextOnPath requires exactly one drawable subpath")]
    MultipleSubpathsUnsupported,
    #[error("TextOnPath path has zero measured length")]
    ZeroLength,
    #[error("TextOnPath path source exceeds the byte limit")]
    SourceLimit,
    #[error("TextOnPath start offset exceeds the absolute limit")]
    OffsetLimit,
    #[error("TextOnPath path exceeds the measured-point complexity limit")]
    ComplexityLimit,
    #[error("TextOnPath glyph midpoint falls outside the path")]
    Overflow,
    #[error("TextOnPath cluster count exceeds the path fitting limit")]
    ClusterLimit,
    #[error("TextOnPath shaping run count exceeds the limit")]
    RunLimit,
    #[error("TextOnPath paint resources exceed the limit")]
    PaintLimit,
    #[error("Text decoration range count exceeds the limit")]
    DecorationRangeLimit,
    #[error("TextOnPath curved decoration resources exceed the limit")]
    DecorationLimit,
    #[error("Text decoration pattern geometry exceeds the limit")]
    DecorationPatternLimit,
    #[error("TextOnPath decoration geometry could not be materialized")]
    DecorationGeometry,
    #[error("TextOnPath Inline shaping boundary splits a grapheme cluster")]
    InlineClusterSplit,
    #[error("TextOnPath path fitting constraints cannot be satisfied")]
    FitUnsatisfiable,
    #[error("TextOnPath text shaping produced no layout")]
    LayoutUnavailable,
    #[error("TextOnPath logical unit metadata could not be resolved")]
    UnitMapInvalid,
}

fn map_text_layout_error_to_path_error(error: crate::TextLayoutError) -> TextOnPathError {
    match error {
        crate::TextLayoutError::InvalidRequest { .. }
        | crate::TextLayoutError::FontUnavailable { .. }
        | crate::TextLayoutError::PreparationFailed { .. }
        | crate::TextLayoutError::InvalidFitStep
        | crate::TextLayoutError::FitProbeLimit { .. }
        | crate::TextLayoutError::EllipsisCandidateLimit { .. }
        | crate::TextLayoutError::RichTextDepthLimit { .. }
        | crate::TextLayoutError::InlineRectLimit { .. }
        | crate::TextLayoutError::InvalidRegionQuery { .. }
        | crate::TextLayoutError::RegionProviderFailure { .. }
        | crate::TextLayoutError::InvalidFlowRegion { .. }
        | crate::TextLayoutError::RegionQueryLimit { .. }
        | crate::TextLayoutError::RegionIntervalLimit { .. }
        | crate::TextLayoutError::InvariantViolation { .. } => TextOnPathError::LayoutUnavailable,
    }
}

#[must_use]
fn map_shape_error(error: &ShapeError) -> TextOnPathError {
    match error {
        ShapeError::PathMeasureMultipleSubpaths => TextOnPathError::MultipleSubpathsUnsupported,
        ShapeError::PathMeasureZeroLength => TextOnPathError::ZeroLength,
        ShapeError::PathMeasureComplexityLimit => TextOnPathError::ComplexityLimit,
        _ => TextOnPathError::InvalidData,
    }
}

#[derive(Debug, Clone, PartialEq)]
struct TextPathPaintStyle {
    fill: Option<String>,
    strokes: Option<Vec<TextStrokeLayer>>,
    shadows: Option<Vec<TextShadowLayer>>,
}

#[derive(Debug, Clone)]
struct TextPathPaintRange {
    byte_start: usize,
    byte_end: usize,
    style: TextPathPaintStyle,
}

#[derive(Debug, Clone)]
struct TextPathDecorationOwner {
    owner_id: u32,
    byte_start: usize,
    byte_end: usize,
    decoration: TextDecorationInput,
}

#[derive(Debug, Clone, Copy)]
struct TextPathDecorationRun {
    byte_start: usize,
    byte_end: usize,
    owner_id: u32,
}

#[derive(Debug)]
struct PreparedTextPathSpans {
    shaping_spans: Option<Vec<TextSpanInput>>,
    paint_ranges: Vec<TextPathPaintRange>,
    decoration_owners: Vec<TextPathDecorationOwner>,
    decoration_runs: Vec<TextPathDecorationRun>,
}

fn prepare_text_path_spans_with_owners(
    request: &TextLayoutRequest<'_>,
    decoration_owner_ids: &[Option<u32>],
) -> Result<PreparedTextPathSpans, TextOnPathError> {
    let Some(spans) = request.spans else {
        if !decoration_owner_ids.is_empty() {
            return Err(TextOnPathError::Invalid);
        }
        return Ok(PreparedTextPathSpans {
            shaping_spans: None,
            paint_ranges: Vec::new(),
            decoration_owners: Vec::new(),
            decoration_runs: Vec::new(),
        });
    };
    if decoration_owner_ids.len() != spans.len() {
        return Err(TextOnPathError::Invalid);
    }
    let mut span_byte_offset: usize = 0;
    for span in spans {
        let Some(span_byte_end) = span_byte_offset.checked_add(span.text.len()) else {
            return Err(TextOnPathError::SourceLimit);
        };
        if span_byte_end > TEXT_PATH_SOURCE_BYTE_LIMIT {
            return Err(TextOnPathError::SourceLimit);
        }
        if request.text.get(span_byte_offset..span_byte_end) != Some(span.text.as_str()) {
            return Err(TextOnPathError::Invalid);
        }
        span_byte_offset = span_byte_end;
    }
    if span_byte_offset != request.text.len() {
        return Err(TextOnPathError::Invalid);
    }

    let mut decoration_owners = Vec::<TextPathDecorationOwner>::new();
    let mut decoration_runs = Vec::<TextPathDecorationRun>::new();
    let mut decoration_byte_start = 0_usize;
    for (span, owner_id) in spans.iter().zip(decoration_owner_ids) {
        let decoration_byte_end = decoration_byte_start
            .checked_add(span.text.len())
            .ok_or(TextOnPathError::SourceLimit)?;
        if span.text_decoration.is_some() != owner_id.is_some() {
            return Err(TextOnPathError::Invalid);
        }
        if let (Some(decoration), Some(owner_id)) = (&span.text_decoration, owner_id)
            && decoration_byte_end > decoration_byte_start
        {
            if let Some(owner) = decoration_owners
                .iter_mut()
                .find(|owner| owner.owner_id == *owner_id)
            {
                if owner.decoration != *decoration {
                    return Err(TextOnPathError::Invalid);
                }
                owner.byte_end = owner.byte_end.max(decoration_byte_end);
            } else {
                if decoration_owners.len() == super::decoration::MAX_TEXT_DECORATION_RANGES {
                    return Err(TextOnPathError::DecorationRangeLimit);
                }
                decoration_owners.push(TextPathDecorationOwner {
                    owner_id: *owner_id,
                    byte_start: decoration_byte_start,
                    byte_end: decoration_byte_end,
                    decoration: decoration.clone(),
                });
            }
            decoration_runs.push(TextPathDecorationRun {
                byte_start: decoration_byte_start,
                byte_end: decoration_byte_end,
                owner_id: *owner_id,
            });
        }
        decoration_byte_start = decoration_byte_end;
    }

    let mut paint_ranges =
        Vec::<TextPathPaintRange>::with_capacity(spans.len().min(TEXT_PATH_PAINT_RANGE_LIMIT));
    let mut paint_byte_start = 0_usize;
    let mut painted_layer_estimate = 0_usize;
    for span in spans {
        let paint_byte_end = paint_byte_start
            .checked_add(span.text.len())
            .ok_or(TextOnPathError::SourceLimit)?;
        if !span.text.is_empty() {
            let style = TextPathPaintStyle {
                fill: span.color.clone(),
                strokes: span.text_strokes.clone(),
                shadows: span.text_shadows.clone(),
            };
            if let Some(previous) = paint_ranges.last_mut()
                && previous.style == style
            {
                previous.byte_end = paint_byte_end;
            } else {
                if paint_ranges.len() == TEXT_PATH_PAINT_RANGE_LIMIT {
                    return Err(TextOnPathError::PaintLimit);
                }
                let range_layer_count = 1_usize
                    .checked_add(style.strokes.as_ref().map_or(0, Vec::len))
                    .and_then(|count| count.checked_add(style.shadows.as_ref().map_or(0, Vec::len)))
                    .ok_or(TextOnPathError::PaintLimit)?;
                painted_layer_estimate = painted_layer_estimate
                    .checked_add(range_layer_count)
                    .ok_or(TextOnPathError::PaintLimit)?;
                if painted_layer_estimate > TEXT_PATH_PAINTED_LAYER_LIMIT {
                    return Err(TextOnPathError::PaintLimit);
                }
                paint_ranges.push(TextPathPaintRange {
                    byte_start: paint_byte_start,
                    byte_end: paint_byte_end,
                    style,
                });
            }
        }
        paint_byte_start = paint_byte_end;
    }

    let mut prepared =
        Vec::<TextSpanInput>::with_capacity(spans.len().min(TEXT_PATH_SHAPING_RUN_LIMIT));
    for span in spans {
        if span.font_family.is_empty()
            || span.font_family.iter().any(|alias| alias.trim().is_empty())
            || !(1..=1_000).contains(&span.font_weight)
            || !span.font_size_px.is_finite()
            || span.font_size_px <= 0.0
            || !span
                .letter_spacing_px
                .unwrap_or(request.letter_spacing_px)
                .is_finite()
            || span
                .language
                .as_deref()
                .is_some_and(|language| !matches!(language, "ja" | "en" | "auto"))
        {
            return Err(TextOnPathError::Invalid);
        }
        if span.text.is_empty() {
            continue;
        }
        if let Some(previous) = prepared.last_mut()
            && text_path_shaping_style_equals(previous, span, request.letter_spacing_px)
        {
            previous.text.push_str(&span.text);
        } else {
            if prepared.len() == TEXT_PATH_SHAPING_RUN_LIMIT {
                return Err(TextOnPathError::RunLimit);
            }
            let mut shaping_span = span.clone();
            shaping_span.color = None;
            shaping_span.text_strokes = None;
            shaping_span.text_shadows = None;
            shaping_span.text_decoration = None;
            shaping_span.decoration_transport_only = false;
            prepared.push(shaping_span);
        }
    }

    let mut grapheme_boundaries = Vec::new();
    let mut byte_offset = 0;
    for grapheme in grapheme_split(request.text) {
        byte_offset += grapheme.len();
        grapheme_boundaries.push(byte_offset);
    }
    let mut span_boundary = 0;
    for span in prepared.iter().take(prepared.len().saturating_sub(1)) {
        span_boundary += span.text.len();
        if grapheme_boundaries.binary_search(&span_boundary).is_err() {
            return Err(TextOnPathError::InlineClusterSplit);
        }
    }
    Ok(PreparedTextPathSpans {
        shaping_spans: Some(prepared),
        paint_ranges,
        decoration_owners,
        decoration_runs,
    })
}

#[cfg(test)]
fn prepare_text_path_spans(
    request: &TextLayoutRequest<'_>,
) -> Result<PreparedTextPathSpans, TextOnPathError> {
    let owner_ids = vec![None; request.spans.map_or(0, <[TextSpanInput]>::len)];
    prepare_text_path_spans_with_owners(request, &owner_ids)
}

fn apply_text_path_paint_metadata(
    glyphs: &mut [PositionedGlyph],
    clusters: &[ClusterRange],
    paint_ranges: &[TextPathPaintRange],
) -> Result<(), TextOnPathError> {
    if paint_ranges.is_empty() {
        return Ok(());
    }
    let mut paint_range_index = 0_usize;
    let mut glyph_start = 0_usize;
    for cluster in clusters {
        while paint_ranges
            .get(paint_range_index)
            .is_some_and(|range| cluster.source_byte_start >= range.byte_end)
        {
            paint_range_index += 1;
        }
        let range = paint_ranges
            .get(paint_range_index)
            .ok_or(TextOnPathError::UnitMapInvalid)?;
        if cluster.source_byte_start < range.byte_start || cluster.source_byte_end > range.byte_end
        {
            return Err(TextOnPathError::InlineClusterSplit);
        }
        let range_index =
            u32::try_from(paint_range_index).map_err(|_| TextOnPathError::PaintLimit)?;
        for glyph in glyphs
            .get_mut(glyph_start..cluster.end)
            .ok_or(TextOnPathError::UnitMapInvalid)?
        {
            glyph.fill.clone_from(&range.style.fill);
            glyph.text_strokes.clone_from(&range.style.strokes);
            glyph.text_shadows.clone_from(&range.style.shadows);
            glyph.paint_range_index = Some(range_index);
        }
        glyph_start = cluster.end;
    }
    Ok(())
}

fn apply_text_path_paint_style_at_byte(
    glyphs: &mut [PositionedGlyph],
    source_byte_start: usize,
    paint_ranges: &[TextPathPaintRange],
) -> Result<(), TextOnPathError> {
    let (paint_range_index, range) = paint_ranges
        .iter()
        .enumerate()
        .find(|(_, range)| {
            source_byte_start >= range.byte_start && source_byte_start < range.byte_end
        })
        .ok_or(TextOnPathError::UnitMapInvalid)?;
    let range_index = u32::try_from(paint_range_index).map_err(|_| TextOnPathError::PaintLimit)?;
    for glyph in glyphs {
        glyph.fill.clone_from(&range.style.fill);
        glyph.text_strokes.clone_from(&range.style.strokes);
        glyph.text_shadows.clone_from(&range.style.shadows);
        glyph.paint_range_index = Some(range_index);
    }
    Ok(())
}

fn text_path_shaping_style_equals(
    left: &TextSpanInput,
    right: &TextSpanInput,
    default_letter_spacing_px: f64,
) -> bool {
    left.font_family == right.font_family
        && left.font_weight == right.font_weight
        && left.font_style == right.font_style
        && left.font_size_px == right.font_size_px
        && left.letter_spacing_px.unwrap_or(default_letter_spacing_px)
            == right.letter_spacing_px.unwrap_or(default_letter_spacing_px)
        && left.language.as_deref().unwrap_or("auto") == right.language.as_deref().unwrap_or("auto")
        && left.text_orientation == right.text_orientation
        && left
            .font_variation_settings
            .as_deref()
            .map(shaping::parse_css_font_variation_settings)
            .unwrap_or_default()
            == right
                .font_variation_settings
                .as_deref()
                .map(shaping::parse_css_font_variation_settings)
                .unwrap_or_default()
        && left
            .font_feature_settings
            .as_deref()
            .map(shaping::parse_css_font_feature_settings)
            .unwrap_or_default()
            == right
                .font_feature_settings
                .as_deref()
                .map(shaping::parse_css_font_feature_settings)
                .unwrap_or_default()
}

fn apply_text_path_span_metadata(
    lines: &mut [super::types::Line],
    spans: Option<&[TextSpanInput]>,
    root_font_size_px: f64,
) -> Result<(), TextOnPathError> {
    let Some(spans) = spans else {
        return Ok(());
    };
    let mut span_ranges = Vec::with_capacity(spans.len());
    let mut span_start = 0;
    for span in spans {
        let span_end = span_start + span.text.len();
        span_ranges.push((span_start, span_end, span));
        span_start = span_end;
    }
    for line in lines {
        let Some(glyphs) = line.positioned_glyphs.as_mut() else {
            continue;
        };
        let mut span_index = 0;
        for glyph in glyphs {
            let source_byte_start = glyph.cluster_start as usize;
            while span_ranges
                .get(span_index)
                .is_some_and(|(_, span_end, _)| source_byte_start >= *span_end)
            {
                span_index += 1;
            }
            let (_, _, span) = span_ranges
                .get(span_index)
                .ok_or(TextOnPathError::UnitMapInvalid)?;
            glyph.font_size_px =
                (span.font_size_px != root_font_size_px).then_some(span.font_size_px);
            if let Some(settings) = &span.font_variation_settings {
                glyph.font_variation_settings = Some(settings.clone());
            }
            if let Some(settings) = &span.font_feature_settings {
                glyph.font_feature_settings = Some(settings.clone());
            }
        }
    }
    Ok(())
}

/// Shape one horizontal LTR line and place each glyph baseline on one measured path.
///
/// The path remains a layout-only guide. Returned positioned glyphs use absolute local
/// coordinates and additive baseline rotation so all existing outline emitters can consume
/// the result without a second path-placement implementation.
///
/// # Errors
///
/// Returns a dedicated [`TextOnPathError`] when the request, path geometry, shaping result,
/// or endpoint overflow violates the `TextOnPath` contract.
pub fn layout_text_on_path(
    request: &TextOnPathRequest<'_>,
    font_context: &FontContext<'_>,
) -> Result<TextLayoutResult, TextOnPathError> {
    if request.d.len() > TEXT_PATH_SOURCE_BYTE_LIMIT
        || request.text.text.len() > TEXT_PATH_SOURCE_BYTE_LIMIT
    {
        return Err(TextOnPathError::SourceLimit);
    }
    if request.d.trim().is_empty() {
        return Err(TextOnPathError::InvalidData);
    }
    if !request.start_offset_px.is_finite()
        || !request.path_offset_px.is_finite()
        || request.path_offset_px < 0.0
        || !request.text.font_size_px.is_finite()
        || request.text.font_size_px <= 0.0
        || !request.text.letter_spacing_px.is_finite()
    {
        return Err(TextOnPathError::Invalid);
    }
    if request.start_offset_px.abs() > TEXT_PATH_OFFSET_ABSOLUTE_LIMIT_PX {
        return Err(TextOnPathError::OffsetLimit);
    }
    let measured_path =
        measure_single_svg_path(request.d).map_err(|error| map_shape_error(&error))?;

    let prepared_spans =
        prepare_text_path_spans_with_owners(&request.text, request.decoration_owner_ids)?;

    let path_text_request = TextLayoutRequest {
        spans: prepared_spans.shaping_spans.as_deref(),
        max_width: f64::MAX,
        max_height: None,
        wrap: WrapMode::None,
        white_space: WhiteSpaceMode::PreWrap,
        fit: FitMode::None,
        max_lines: Some(1),
        ellipsis: false,
        writing_mode: WritingMode::HorizontalTb,
        text_indent: None,
        hanging_punctuation: false,
        ..request.text.clone()
    };
    let mut layout = layout_text_inner_with_prepared_spans(&path_text_request, font_context, true)
        .map_err(map_text_layout_error_to_path_error)?;
    apply_text_path_span_metadata(
        &mut layout.lines,
        path_text_request.spans,
        path_text_request.font_size_px,
    )?;
    let mut unit_map = request
        .unit_map
        .map(|unit_request| {
            build_text_unit_map(
                &layout.lines,
                unit_request.kind,
                unit_request.ruby,
                WritingMode::HorizontalTb,
            )
            .map_err(|_| TextOnPathError::UnitMapInvalid)
        })
        .transpose()?;

    let Some(original_line) = layout.lines.first_mut() else {
        return Err(TextOnPathError::LayoutUnavailable);
    };
    let Some(original_positioned_glyphs) = original_line.positioned_glyphs.as_mut() else {
        return Err(TextOnPathError::LayoutUnavailable);
    };
    let original_clusters = build_cluster_ranges(original_positioned_glyphs)?;
    let original_decoration_owner_ids =
        decoration_owners_for_clusters(&original_clusters, &prepared_spans.decoration_runs)?;
    apply_text_path_paint_metadata(
        original_positioned_glyphs,
        &original_clusters,
        &prepared_spans.paint_ranges,
    )?;
    let original_glyphs = original_positioned_glyphs.clone();
    let original_infos = original_line.glyphs.clone();
    if (request.path_fit != TextPathFit::None
        || request.path_overflow == TextPathOverflow::Ellipsis)
        && original_clusters.len() > TEXT_PATH_CLUSTER_LIMIT
    {
        return Err(TextOnPathError::ClusterLimit);
    }

    let path_length = measured_path.total_length();
    let full_fit = resolve_fit_plan(request.path_fit, path_length, &original_clusters);
    let full_fits_visibility = full_fit.as_ref().is_ok_and(|fit_plan| {
        sequence_fits_visibility(
            &original_glyphs,
            &original_clusters,
            *fit_plan,
            request,
            &measured_path,
        )
    });

    let mut display_text = request.text.text.to_string();
    let mut display_infos = original_infos;
    let mut display_glyphs = original_glyphs.clone();
    let mut display_clusters = original_clusters.clone();
    let mut display_decoration_owner_ids = original_decoration_owner_ids.clone();
    let mut source_indices = (0..original_glyphs.len()).map(Some).collect::<Vec<_>>();
    let mut ellipsis_applied = false;
    let fit_plan = if request.path_overflow == TextPathOverflow::Ellipsis && !full_fits_visibility {
        let (mut ellipsis_shapes, ellipsis_shape_indices) =
            build_path_ellipsis_shapes(&path_text_request, font_context, &original_clusters)?;
        let selection = find_ellipsis_prefix(
            &original_clusters,
            &ellipsis_shapes,
            &ellipsis_shape_indices,
            request,
            &measured_path,
        );
        ellipsis_applied = true;
        layout.overflow = super::types::TextOverflow::overflow("ellipsis applied");
        display_text = "\u{2026}".to_string();
        if let Some(selection) = selection {
            let mut ellipsis_shape = ellipsis_shapes.swap_remove(selection.ellipsis_shape_index);
            let ellipsis_line = ellipsis_shape
                .layout
                .lines
                .first_mut()
                .ok_or(TextOnPathError::LayoutUnavailable)?;
            let mut ellipsis_glyphs = ellipsis_line
                .positioned_glyphs
                .take()
                .ok_or(TextOnPathError::LayoutUnavailable)?;
            let first_omitted_cluster = original_clusters
                .get(selection.prefix_cluster_count)
                .ok_or(TextOnPathError::UnitMapInvalid)?;
            if !prepared_spans.paint_ranges.is_empty() {
                apply_text_path_paint_style_at_byte(
                    &mut ellipsis_glyphs,
                    first_omitted_cluster.source_byte_start,
                    &prepared_spans.paint_ranges,
                )?;
            }
            for glyph in &mut ellipsis_glyphs {
                glyph.source_start = None;
                glyph.source_end = None;
                glyph.source_role = None;
                glyph.decoration_source_start = None;
                glyph.decoration_source_end = None;
                glyph.synthetic_kind = Some("ellipsis".to_string());
            }
            let ellipsis_infos = ellipsis_line.glyphs.clone();
            let ellipsis_cluster = ellipsis_shape.cluster;
            layout.warnings.append(&mut ellipsis_shape.layout.warnings);
            let prefix_glyph_end = original_clusters
                .get(selection.prefix_cluster_count.saturating_sub(1))
                .map_or(0, |cluster| cluster.end);
            let prefix_byte_end = original_clusters
                .get(selection.prefix_cluster_count.saturating_sub(1))
                .map_or(0, |cluster| cluster.source_byte_end);
            let prefix_source = request
                .text
                .text
                .get(..prefix_byte_end)
                .ok_or(TextOnPathError::UnitMapInvalid)?;
            display_text = format!("{prefix_source}\u{2026}");
            display_glyphs = original_glyphs[..prefix_glyph_end].to_vec();
            source_indices = (0..prefix_glyph_end).map(Some).collect();
            display_clusters = original_clusters[..selection.prefix_cluster_count].to_vec();
            display_decoration_owner_ids =
                original_decoration_owner_ids[..selection.prefix_cluster_count].to_vec();
            display_glyphs.extend(ellipsis_glyphs);
            source_indices.resize(display_glyphs.len(), None);
            display_clusters.push(ClusterRange {
                end: display_glyphs.len(),
                source_byte_start: prefix_byte_end,
                source_byte_end: prefix_byte_end,
                ..ellipsis_cluster
            });
            display_decoration_owner_ids.push(
                original_decoration_owner_ids
                    .get(selection.prefix_cluster_count)
                    .copied()
                    .flatten(),
            );
            let prefix_byte_end =
                u32::try_from(prefix_byte_end).map_err(|_| TextOnPathError::UnitMapInvalid)?;
            display_infos = original_infos_for_prefix(&display_infos, prefix_byte_end);
            display_infos.extend(ellipsis_infos);
            selection.fit_plan
        } else {
            display_glyphs.clear();
            display_clusters.clear();
            display_decoration_owner_ids.clear();
            display_infos.clear();
            source_indices.clear();
            FitPlan::empty()
        }
    } else {
        full_fit?
    };

    let placement = place_glyphs_on_path(
        display_glyphs,
        &display_clusters,
        fit_plan,
        request,
        &measured_path,
        &source_indices,
        original_glyphs.len(),
        &display_decoration_owner_ids,
    );
    if placement.has_overflow && request.path_overflow == TextPathOverflow::Error {
        return Err(TextOnPathError::Overflow);
    }

    let Some(line) = layout.lines.first_mut() else {
        return Err(TextOnPathError::LayoutUnavailable);
    };
    line.glyphs = apply_fit_to_glyph_infos(display_infos, &display_clusters, fit_plan);
    line.positioned_glyphs = Some(placement.visible_glyphs);
    line.width = fit_plan.advance;
    line.text = request.text.text.to_string();
    line.fragments = None;
    layout.text_decorations = resolve_text_path_decorations(
        &prepared_spans.decoration_owners,
        &original_clusters,
        &original_decoration_owner_ids,
        &original_glyphs,
        &display_clusters,
        &display_decoration_owner_ids,
        &placement.visible_clusters,
        fit_plan,
        request,
        &measured_path,
        font_context,
    )?;
    if let Some(unit_map) = unit_map.as_mut() {
        retain_visible_unit_members(unit_map, &placement.original_visible_indices);
    }
    layout.bbox = resolve_path_ink_bbox(
        line.positioned_glyphs.as_deref().unwrap_or_default(),
        font_context,
        request.text.font_size_px,
    )
    .unwrap_or(TextBBox {
        x: 0.0,
        y: 0.0,
        w: 0.0,
        h: 0.0,
    });
    layout.source_text = Some(request.text.text.to_string());
    layout.display_text = Some(display_text);
    if !ellipsis_applied && !placement.has_overflow {
        layout.overflow = super::types::TextOverflow::none();
    }
    layout.unit_map = unit_map;
    Ok(layout)
}

#[derive(Debug, Clone, Copy)]
struct ClusterRange {
    end: usize,
    advance: f64,
    min_midpoint: f64,
    max_midpoint: f64,
    source_byte_start: usize,
    source_byte_end: usize,
}

#[derive(Debug, Clone, Copy)]
struct FitPlan {
    inline_scale: f64,
    gap: f64,
    advance: f64,
}

impl FitPlan {
    const fn empty() -> Self {
        Self {
            inline_scale: 1.0,
            gap: 0.0,
            advance: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct EllipsisSelection {
    prefix_cluster_count: usize,
    ellipsis_shape_index: usize,
    fit_plan: FitPlan,
}

struct EllipsisShape {
    layout: TextLayoutResult,
    cluster: ClusterRange,
}

struct PlacementResult {
    visible_glyphs: Vec<PositionedGlyph>,
    original_visible_indices: Vec<Option<usize>>,
    visible_clusters: Vec<bool>,
    has_overflow: bool,
}

fn decoration_owners_for_clusters(
    clusters: &[ClusterRange],
    decoration_runs: &[TextPathDecorationRun],
) -> Result<Vec<Option<u32>>, TextOnPathError> {
    let mut run_index = 0_usize;
    let mut owners = Vec::with_capacity(clusters.len());
    for cluster in clusters {
        while decoration_runs
            .get(run_index)
            .is_some_and(|run| cluster.source_byte_start >= run.byte_end)
        {
            run_index += 1;
        }
        let owner = decoration_runs.get(run_index).and_then(|run| {
            (cluster.source_byte_start >= run.byte_start
                && cluster.source_byte_start < run.byte_end)
                .then_some(run)
        });
        if let Some(run) = owner {
            if cluster.source_byte_end > run.byte_end {
                return Err(TextOnPathError::InlineClusterSplit);
            }
            owners.push(Some(run.owner_id));
        } else {
            if decoration_runs.iter().skip(run_index).any(|run| {
                cluster.source_byte_start < run.byte_end && cluster.source_byte_end > run.byte_start
            }) {
                return Err(TextOnPathError::InlineClusterSplit);
            }
            owners.push(None);
        }
    }
    Ok(owners)
}

fn build_cluster_ranges(glyphs: &[PositionedGlyph]) -> Result<Vec<ClusterRange>, TextOnPathError> {
    let mut clusters = Vec::<ClusterRange>::new();
    let mut pen = 0.0;
    for (glyph_index, glyph) in glyphs.iter().enumerate() {
        let signature = (
            glyph.source_start,
            glyph.source_end,
            glyph.source_role.as_deref(),
            glyph.cluster_start,
            glyph.cluster_end,
        );
        if signature.0.is_none() || signature.1.is_none() || signature.2.is_none() {
            return Err(TextOnPathError::UnitMapInvalid);
        }
        let midpoint = pen + glyph.x_offset + glyph.x_advance / 2.0;
        let continues_cluster = glyph_index > 0 && {
            let previous = &glyphs[glyph_index - 1];
            signature
                == (
                    previous.source_start,
                    previous.source_end,
                    previous.source_role.as_deref(),
                    previous.cluster_start,
                    previous.cluster_end,
                )
        };
        if continues_cluster {
            let cluster = clusters.last_mut().ok_or(TextOnPathError::UnitMapInvalid)?;
            cluster.end = glyph_index + 1;
            cluster.advance += glyph.x_advance;
            cluster.min_midpoint = cluster.min_midpoint.min(midpoint);
            cluster.max_midpoint = cluster.max_midpoint.max(midpoint);
            cluster.source_byte_start = cluster.source_byte_start.min(glyph.cluster_start as usize);
            cluster.source_byte_end = cluster.source_byte_end.max(glyph.cluster_end as usize);
        } else {
            clusters.push(ClusterRange {
                end: glyph_index + 1,
                advance: glyph.x_advance,
                min_midpoint: midpoint,
                max_midpoint: midpoint,
                source_byte_start: glyph.cluster_start as usize,
                source_byte_end: glyph.cluster_end as usize,
            });
        }
        pen += glyph.x_advance;
    }
    Ok(clusters)
}

fn single_cluster_range(glyphs: &[PositionedGlyph]) -> ClusterRange {
    let mut pen = 0.0;
    let mut min_midpoint = f64::INFINITY;
    let mut max_midpoint = f64::NEG_INFINITY;
    for glyph in glyphs {
        let midpoint = pen + glyph.x_offset + glyph.x_advance / 2.0;
        min_midpoint = min_midpoint.min(midpoint);
        max_midpoint = max_midpoint.max(midpoint);
        pen += glyph.x_advance;
    }
    ClusterRange {
        end: glyphs.len(),
        advance: pen,
        min_midpoint,
        max_midpoint,
        source_byte_start: 0,
        source_byte_end: 0,
    }
}

fn resolve_fit_plan(
    path_fit: TextPathFit,
    path_length: f64,
    clusters: &[ClusterRange],
) -> Result<FitPlan, TextOnPathError> {
    let advance = clusters.iter().map(|cluster| cluster.advance).sum::<f64>();
    let min_nonfinal_advance =
        clusters
            .get(..clusters.len().saturating_sub(1))
            .and_then(|values| {
                values
                    .iter()
                    .map(|cluster| cluster.advance)
                    .reduce(f64::min)
            });
    resolve_fit_plan_metrics(
        path_fit,
        path_length,
        clusters.len(),
        advance,
        min_nonfinal_advance,
    )
}

fn resolve_fit_plan_metrics(
    path_fit: TextPathFit,
    path_length: f64,
    cluster_count: usize,
    advance: f64,
    min_nonfinal_advance: Option<f64>,
) -> Result<FitPlan, TextOnPathError> {
    if path_fit == TextPathFit::None
        || (path_fit == TextPathFit::Spacing && cluster_count <= 1)
        || (path_fit == TextPathFit::Shrink && advance <= path_length)
    {
        return Ok(FitPlan {
            inline_scale: 1.0,
            gap: 0.0,
            advance,
        });
    }
    match path_fit {
        TextPathFit::Spacing => {
            let gap = (path_length - advance) / (cluster_count - 1) as f64;
            if !gap.is_finite()
                || min_nonfinal_advance.is_none_or(|cluster_advance| {
                    cluster_advance + gap < TEXT_PATH_MIN_CLUSTER_STEP_PX
                })
            {
                return Err(TextOnPathError::FitUnsatisfiable);
            }
            Ok(FitPlan {
                inline_scale: 1.0,
                gap,
                advance: path_length,
            })
        }
        TextPathFit::Scale | TextPathFit::Shrink => scale_fit_plan(advance, path_length),
        TextPathFit::None => Ok(FitPlan {
            inline_scale: 1.0,
            gap: 0.0,
            advance,
        }),
    }
}

fn scale_fit_plan(advance: f64, path_length: f64) -> Result<FitPlan, TextOnPathError> {
    let inline_scale = path_length / advance;
    if !inline_scale.is_finite()
        || !(TEXT_PATH_MIN_INLINE_SCALE..=TEXT_PATH_MAX_INLINE_SCALE).contains(&inline_scale)
    {
        return Err(TextOnPathError::FitUnsatisfiable);
    }
    Ok(FitPlan {
        inline_scale,
        gap: 0.0,
        advance: path_length,
    })
}

fn sequence_fits_visibility(
    glyphs: &[PositionedGlyph],
    clusters: &[ClusterRange],
    fit_plan: FitPlan,
    request: &TextOnPathRequest<'_>,
    measured_path: &MeasuredPath,
) -> bool {
    if glyphs.is_empty() {
        return true;
    }
    let mut pen = 0.0;
    let mut min_midpoint = f64::INFINITY;
    let mut max_midpoint = f64::NEG_INFINITY;
    let mut cluster_index = 0_usize;
    for (glyph_index, glyph) in glyphs.iter().enumerate() {
        let midpoint = pen
            + glyph.x_offset * fit_plan.inline_scale
            + glyph.x_advance * fit_plan.inline_scale / 2.0;
        min_midpoint = min_midpoint.min(midpoint);
        max_midpoint = max_midpoint.max(midpoint);
        pen += glyph.x_advance * fit_plan.inline_scale;
        if clusters
            .get(cluster_index)
            .is_some_and(|cluster| cluster.end == glyph_index + 1)
        {
            cluster_index += 1;
            if cluster_index < clusters.len() {
                pen += fit_plan.gap;
            }
        }
    }
    extrema_fit_visibility(
        min_midpoint,
        max_midpoint,
        fit_plan.advance,
        request,
        measured_path,
    )
}

fn extrema_fit_visibility(
    min_midpoint: f64,
    max_midpoint: f64,
    fitted_advance: f64,
    request: &TextOnPathRequest<'_>,
    measured_path: &MeasuredPath,
) -> bool {
    let anchor_shift = anchor_shift(request.text_anchor, fitted_advance);
    let min_midpoint = min_midpoint + anchor_shift;
    let max_midpoint = max_midpoint + anchor_shift;
    let path_length = measured_path.total_length();
    if !min_midpoint.is_finite() || !max_midpoint.is_finite() {
        return false;
    }
    if !measured_path.is_closed() {
        return request.start_offset_px + min_midpoint >= 0.0
            && request.start_offset_px + max_midpoint <= path_length;
    }
    match request.text_anchor {
        TextPathAnchor::Start => min_midpoint >= 0.0 && max_midpoint < path_length,
        TextPathAnchor::Middle => {
            min_midpoint >= -path_length / 2.0 && max_midpoint < path_length / 2.0
        }
        TextPathAnchor::End => min_midpoint > -path_length && max_midpoint <= 0.0,
    }
}

fn shape_path_ellipsis(
    path_text_request: &TextLayoutRequest<'_>,
    font_context: &FontContext<'_>,
    style_span: Option<&TextSpanInput>,
) -> Result<TextLayoutResult, TextOnPathError> {
    let ellipsis_spans = style_span.map(|span| {
        vec![TextSpanInput {
            text: "\u{2026}".to_string(),
            ..span.clone()
        }]
    });
    let ellipsis_request = TextLayoutRequest {
        text: "\u{2026}",
        spans: ellipsis_spans.as_deref(),
        ..path_text_request.clone()
    };
    let mut layout = layout_text_inner_with_prepared_spans(&ellipsis_request, font_context, true)
        .map_err(map_text_layout_error_to_path_error)?;
    apply_text_path_span_metadata(
        &mut layout.lines,
        ellipsis_request.spans,
        ellipsis_request.font_size_px,
    )?;
    Ok(layout)
}

fn build_path_ellipsis_shapes(
    path_text_request: &TextLayoutRequest<'_>,
    font_context: &FontContext<'_>,
    original_clusters: &[ClusterRange],
) -> Result<(Vec<EllipsisShape>, Vec<usize>), TextOnPathError> {
    let Some(spans) = path_text_request.spans else {
        let layout = shape_path_ellipsis(path_text_request, font_context, None)?;
        let glyphs = layout
            .lines
            .first()
            .and_then(|line| line.positioned_glyphs.as_deref())
            .ok_or(TextOnPathError::LayoutUnavailable)?;
        let cluster = single_cluster_range(glyphs);
        return Ok((
            vec![EllipsisShape { layout, cluster }],
            vec![0; original_clusters.len()],
        ));
    };

    let mut span_ends = Vec::with_capacity(spans.len());
    let mut span_end = 0;
    for span in spans {
        span_end += span.text.len();
        span_ends.push(span_end);
    }
    let mut cached_shape_indices = vec![None; spans.len()];
    let mut shapes = Vec::new();
    let mut shape_indices = Vec::with_capacity(original_clusters.len());
    let mut span_index = 0;
    for cluster in original_clusters {
        while span_ends
            .get(span_index)
            .is_some_and(|end| cluster.source_byte_start >= *end)
        {
            span_index += 1;
        }
        let style_span = spans
            .get(span_index)
            .ok_or(TextOnPathError::UnitMapInvalid)?;
        let shape_index = if let Some(shape_index) = cached_shape_indices[span_index] {
            shape_index
        } else {
            let layout = shape_path_ellipsis(path_text_request, font_context, Some(style_span))?;
            let glyphs = layout
                .lines
                .first()
                .and_then(|line| line.positioned_glyphs.as_deref())
                .ok_or(TextOnPathError::LayoutUnavailable)?;
            let cluster = single_cluster_range(glyphs);
            let shape_index = shapes.len();
            shapes.push(EllipsisShape { layout, cluster });
            cached_shape_indices[span_index] = Some(shape_index);
            shape_index
        };
        shape_indices.push(shape_index);
    }
    Ok((shapes, shape_indices))
}

fn find_ellipsis_prefix(
    original_clusters: &[ClusterRange],
    ellipsis_shapes: &[EllipsisShape],
    ellipsis_shape_indices: &[usize],
    request: &TextOnPathRequest<'_>,
    measured_path: &MeasuredPath,
) -> Option<EllipsisSelection> {
    if request.path_fit == TextPathFit::Spacing {
        return find_spacing_ellipsis_prefix(
            original_clusters,
            ellipsis_shapes,
            ellipsis_shape_indices,
            request,
            measured_path,
        );
    }

    let candidate_limit = original_clusters.len();
    let mut prefix_advance = 0.0;
    let mut prefix_min_step = f64::INFINITY;
    let mut prefix_min = f64::INFINITY;
    let mut prefix_max = f64::NEG_INFINITY;
    let mut best = None;
    for prefix_cluster_count in 0..candidate_limit {
        let ellipsis_shape_index = *ellipsis_shape_indices.get(prefix_cluster_count)?;
        let ellipsis_cluster = ellipsis_shapes.get(ellipsis_shape_index)?.cluster;
        if ellipsis_cluster.end == 0 {
            continue;
        }
        if let Some(cluster) = prefix_cluster_count
            .checked_sub(1)
            .and_then(|index| original_clusters.get(index))
        {
            prefix_advance += cluster.advance;
            prefix_min_step = prefix_min_step.min(cluster.advance);
            prefix_min = prefix_min.min(cluster.min_midpoint);
            prefix_max = prefix_max.max(cluster.max_midpoint);
        }
        let Ok(fit_plan) = resolve_fit_plan_metrics(
            request.path_fit,
            measured_path.total_length(),
            prefix_cluster_count + 1,
            prefix_advance + ellipsis_cluster.advance,
            (prefix_cluster_count > 0).then_some(prefix_min_step),
        ) else {
            continue;
        };
        let raw_min = prefix_min.min(prefix_advance + ellipsis_cluster.min_midpoint);
        let raw_max = prefix_max.max(prefix_advance + ellipsis_cluster.max_midpoint);
        let min_midpoint = raw_min * fit_plan.inline_scale;
        let max_midpoint = raw_max * fit_plan.inline_scale;
        if extrema_fit_visibility(
            min_midpoint,
            max_midpoint,
            fit_plan.advance,
            request,
            measured_path,
        ) {
            best = Some(EllipsisSelection {
                prefix_cluster_count,
                ellipsis_shape_index,
                fit_plan,
            });
        }
    }
    best
}

fn find_spacing_ellipsis_prefix(
    original_clusters: &[ClusterRange],
    ellipsis_shapes: &[EllipsisShape],
    ellipsis_shape_indices: &[usize],
    request: &TextOnPathRequest<'_>,
    measured_path: &MeasuredPath,
) -> Option<EllipsisSelection> {
    let candidate_limit = original_clusters.len();
    let mut prefix_advances = vec![0.0; candidate_limit + 1];
    let mut prefix_min_steps = vec![f64::INFINITY; candidate_limit + 1];
    for (index, cluster) in original_clusters.iter().enumerate() {
        prefix_advances[index + 1] = prefix_advances[index] + cluster.advance;
        prefix_min_steps[index + 1] = prefix_min_steps[index].min(cluster.advance);
    }

    let mut plans = Vec::with_capacity(candidate_limit);
    let mut query_gaps = Vec::new();
    for prefix_cluster_count in 0..candidate_limit {
        let Some(ellipsis_shape_index) = ellipsis_shape_indices.get(prefix_cluster_count) else {
            plans.push(Err(TextOnPathError::UnitMapInvalid));
            continue;
        };
        let Some(ellipsis_shape) = ellipsis_shapes.get(*ellipsis_shape_index) else {
            plans.push(Err(TextOnPathError::UnitMapInvalid));
            continue;
        };
        let ellipsis_cluster = ellipsis_shape.cluster;
        if ellipsis_cluster.end == 0 {
            plans.push(Err(TextOnPathError::LayoutUnavailable));
            continue;
        }
        let total_advance = prefix_advances[prefix_cluster_count] + ellipsis_cluster.advance;
        let fit_plan = if prefix_cluster_count == 0 {
            Ok(FitPlan {
                inline_scale: 1.0,
                gap: 0.0,
                advance: total_advance,
            })
        } else {
            let gap = (measured_path.total_length() - total_advance) / prefix_cluster_count as f64;
            if gap.is_finite()
                && prefix_min_steps[prefix_cluster_count] + gap >= TEXT_PATH_MIN_CLUSTER_STEP_PX
            {
                Ok(FitPlan {
                    inline_scale: 1.0,
                    gap,
                    advance: measured_path.total_length(),
                })
            } else {
                Err(TextOnPathError::FitUnsatisfiable)
            }
        };
        if let Ok(fit_plan) = fit_plan {
            query_gaps.push(fit_plan.gap);
        }
        plans.push(fit_plan);
    }
    if query_gaps.is_empty() {
        return None;
    }
    query_gaps.sort_by(f64::total_cmp);
    query_gaps.dedup_by(|left, right| left.total_cmp(right).is_eq());
    let mut max_hull = DiscreteLineHull::new(query_gaps.clone());
    let mut min_hull = DiscreteLineHull::new(query_gaps);
    let mut best = None;
    for prefix_cluster_count in 0..candidate_limit {
        if prefix_cluster_count > 0 {
            let cluster_index = prefix_cluster_count - 1;
            let cluster = original_clusters[cluster_index];
            max_hull.insert(LinearFunction {
                slope: cluster_index as f64,
                intercept: cluster.max_midpoint,
            });
            min_hull.insert(LinearFunction {
                slope: -(cluster_index as f64),
                intercept: -cluster.min_midpoint,
            });
        }
        let Ok(fit_plan) = plans[prefix_cluster_count] else {
            continue;
        };
        let ellipsis_shape_index = ellipsis_shape_indices[prefix_cluster_count];
        let ellipsis_cluster = ellipsis_shapes[ellipsis_shape_index].cluster;
        let ellipsis_shift =
            prefix_advances[prefix_cluster_count] + prefix_cluster_count as f64 * fit_plan.gap;
        let ellipsis_min = ellipsis_shift + ellipsis_cluster.min_midpoint;
        let ellipsis_max = ellipsis_shift + ellipsis_cluster.max_midpoint;
        let min_midpoint = min_hull
            .query(fit_plan.gap)
            .map_or(ellipsis_min, |value| (-value).min(ellipsis_min));
        let max_midpoint = max_hull
            .query(fit_plan.gap)
            .map_or(ellipsis_max, |value| value.max(ellipsis_max));
        if extrema_fit_visibility(
            min_midpoint,
            max_midpoint,
            fit_plan.advance,
            request,
            measured_path,
        ) {
            best = Some(EllipsisSelection {
                prefix_cluster_count,
                ellipsis_shape_index,
                fit_plan,
            });
        }
    }
    best
}

#[derive(Clone, Copy)]
struct LinearFunction {
    slope: f64,
    intercept: f64,
}

impl LinearFunction {
    fn value(self, x: f64) -> f64 {
        self.slope.mul_add(x, self.intercept)
    }
}

struct DiscreteLineHull {
    xs: Vec<f64>,
    lines: Vec<Option<LinearFunction>>,
}

impl DiscreteLineHull {
    fn new(xs: Vec<f64>) -> Self {
        let line_capacity = xs.len().saturating_mul(4).max(1);
        Self {
            xs,
            lines: vec![None; line_capacity],
        }
    }

    fn insert(&mut self, line: LinearFunction) {
        if !self.xs.is_empty() {
            self.insert_at(1, 0, self.xs.len() - 1, line);
        }
    }

    fn insert_at(
        &mut self,
        node_index: usize,
        left_index: usize,
        right_index: usize,
        mut new_line: LinearFunction,
    ) {
        let Some(mut current_line) = self.lines[node_index] else {
            self.lines[node_index] = Some(new_line);
            return;
        };
        let middle_index = usize::midpoint(left_index, right_index);
        let left_better =
            new_line.value(self.xs[left_index]) > current_line.value(self.xs[left_index]);
        let middle_better =
            new_line.value(self.xs[middle_index]) > current_line.value(self.xs[middle_index]);
        if middle_better {
            std::mem::swap(&mut current_line, &mut new_line);
            self.lines[node_index] = Some(current_line);
        }
        if left_index == right_index {
            return;
        }
        if left_better == middle_better {
            self.insert_at(node_index * 2 + 1, middle_index + 1, right_index, new_line);
        } else {
            self.insert_at(node_index * 2, left_index, middle_index, new_line);
        }
    }

    fn query(&self, x: f64) -> Option<f64> {
        let x_index = self
            .xs
            .binary_search_by(|candidate| candidate.total_cmp(&x))
            .ok()?;
        self.query_at(1, 0, self.xs.len() - 1, x_index, x)
    }

    fn query_at(
        &self,
        node_index: usize,
        left_index: usize,
        right_index: usize,
        x_index: usize,
        x: f64,
    ) -> Option<f64> {
        let current = self.lines[node_index].map(|line| line.value(x));
        if left_index == right_index {
            return current;
        }
        let middle_index = usize::midpoint(left_index, right_index);
        let child = if x_index <= middle_index {
            self.query_at(node_index * 2, left_index, middle_index, x_index, x)
        } else {
            self.query_at(
                node_index * 2 + 1,
                middle_index + 1,
                right_index,
                x_index,
                x,
            )
        };
        match (current, child) {
            (Some(left), Some(right)) => Some(left.max(right)),
            (Some(value), None) | (None, Some(value)) => Some(value),
            (None, None) => None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct TextPathDecorationInterval {
    start: f64,
    end: f64,
}

#[expect(
    clippy::too_many_arguments,
    reason = "path decoration ownership is explicit"
)]
fn resolve_text_path_decorations(
    owners: &[TextPathDecorationOwner],
    original_clusters: &[ClusterRange],
    original_owner_ids: &[Option<u32>],
    original_glyphs: &[PositionedGlyph],
    display_clusters: &[ClusterRange],
    display_owner_ids: &[Option<u32>],
    visible_clusters: &[bool],
    fit_plan: FitPlan,
    request: &TextOnPathRequest<'_>,
    measured_path: &MeasuredPath,
    font_context: &FontContext<'_>,
) -> Result<Vec<TextDecorationFragment>, TextOnPathError> {
    if owners.is_empty() {
        return Ok(Vec::new());
    }
    if owners.len() > super::decoration::MAX_TEXT_DECORATION_RANGES {
        return Err(TextOnPathError::DecorationRangeLimit);
    }
    if display_clusters.len() != display_owner_ids.len()
        || display_clusters.len() != visible_clusters.len()
        || original_clusters.len() != original_owner_ids.len()
    {
        return Err(TextOnPathError::UnitMapInvalid);
    }

    let cluster_intervals = fitted_cluster_intervals(display_clusters, fit_plan, request);
    let direction = match request.path_direction {
        TextPathDirection::Forward => PathTraversalDirection::Forward,
        TextPathDirection::Reverse => PathTraversalDirection::Reverse,
    };
    let normal_sign = match request.path_normal {
        TextPathNormal::Left => 1.0,
        TextPathNormal::Right => -1.0,
    };
    let mut remaining_sample_budget = TEXT_PATH_DECORATION_SAMPLE_LIMIT;
    let mut path_count = 0_usize;
    let mut contour_count = 0_usize;
    let mut segment_count = 0_usize;
    let mut fragments = Vec::new();

    for owner in owners {
        let mut phase_origin = None;
        let mut support = Vec::new();
        for ((cluster_owner_id, visible), interval) in display_owner_ids
            .iter()
            .zip(visible_clusters)
            .zip(&cluster_intervals)
        {
            if *cluster_owner_id != Some(owner.owner_id) || !visible {
                continue;
            }
            phase_origin.get_or_insert(interval.0);
            let start = interval.0.min(interval.1);
            let end = interval.0.max(interval.1);
            if end > start {
                support.push(TextPathDecorationInterval { start, end });
            }
        }
        let Some(phase_origin) = phase_origin else {
            continue;
        };
        let intervals = clip_union_and_split_decoration_intervals(
            support,
            request,
            measured_path.total_length(),
            measured_path.is_closed(),
        );
        if intervals.is_empty() {
            continue;
        }
        let decoration_lines = [
            TextDecorationLine::Underline,
            TextDecorationLine::Overline,
            TextDecorationLine::LineThrough,
        ];
        let line_count = decoration_lines
            .iter()
            .filter(|decoration_line| owner.decoration.line.contains(decoration_line))
            .count();
        let required_path_count = intervals.len().saturating_mul(line_count);
        if path_count.saturating_add(required_path_count) > TEXT_PATH_DECORATION_FRAGMENT_LIMIT {
            return Err(TextOnPathError::DecorationLimit);
        }

        let owner_cluster_index = original_owner_ids
            .iter()
            .position(|owner_id| *owner_id == Some(owner.owner_id))
            .ok_or(TextOnPathError::UnitMapInvalid)?;
        let owner_glyph_start = owner_cluster_index
            .checked_sub(1)
            .and_then(|previous_cluster_index| original_clusters.get(previous_cluster_index))
            .map_or(0, |cluster| cluster.end);
        let owner_glyph = original_glyphs
            .get(owner_glyph_start)
            .ok_or(TextOnPathError::UnitMapInvalid)?;
        let source_start = byte_to_grapheme_index(request.text.text, owner.byte_start)?;
        let source_end = byte_to_grapheme_index(request.text.text, owner.byte_end)?;

        for decoration_line in decoration_lines {
            if !owner.decoration.line.contains(&decoration_line) {
                continue;
            }
            let (metric_center, thickness_px) = super::decoration::glyph_decoration_metrics(
                owner_glyph,
                decoration_line,
                &owner.decoration,
                false,
                request.text.font_size_px,
                font_context,
            );
            let owner_baseline = owner_glyph.origin_y - owner_glyph.y_offset;
            let line_offset = metric_center - owner_baseline;
            let effective_normal_offset = normal_sign * request.path_offset_px + line_offset;
            if !effective_normal_offset.is_finite()
                || !thickness_px.is_finite()
                || thickness_px <= 0.0
            {
                return Err(TextOnPathError::DecorationGeometry);
            }
            let ribbon_half_width = match owner.decoration.style {
                TextDecorationStyle::Double => thickness_px * 1.5,
                TextDecorationStyle::Wavy => thickness_px * 2.0,
                TextDecorationStyle::Solid
                | TextDecorationStyle::Dotted
                | TextDecorationStyle::Dashed => thickness_px * 0.5,
            };
            let mut paths = Vec::with_capacity(intervals.len());
            for interval in &intervals {
                let sample_budget_before = remaining_sample_budget;
                let region = build_curved_decoration_region(
                    measured_path,
                    *interval,
                    phase_origin,
                    direction,
                    effective_normal_offset,
                    thickness_px,
                    owner.decoration.style,
                    false,
                    &mut remaining_sample_budget,
                )?;
                let current_contours = region.contours.len();
                let current_segments = region
                    .contours
                    .iter()
                    .map(|contour| contour.segments.len())
                    .sum::<usize>();
                contour_count = contour_count.saturating_add(current_contours);
                segment_count = segment_count.saturating_add(current_segments);
                if contour_count > super::decoration::MAX_TEXT_DECORATION_PATTERN_CONTOURS
                    || segment_count > super::decoration::MAX_TEXT_DECORATION_PATTERN_SEGMENTS
                {
                    return Err(TextOnPathError::DecorationPatternLimit);
                }
                let consumed_samples = sample_budget_before - remaining_sample_budget;
                let paint_regions = if owner.decoration.style == TextDecorationStyle::Wavy {
                    region
                        .contours
                        .into_iter()
                        .map(|contour| Region {
                            contours: vec![contour],
                        })
                        .collect::<Vec<_>>()
                } else {
                    vec![region]
                };
                for (paint_region_index, paint_region) in paint_regions.into_iter().enumerate() {
                    let paint_contours = paint_region.contours.len();
                    let paint_segments = paint_region
                        .contours
                        .iter()
                        .map(|contour| contour.segments.len())
                        .sum::<usize>();
                    let d = region_to_path(&paint_region);
                    if d.is_empty() {
                        return Err(TextOnPathError::DecorationGeometry);
                    }
                    paths.push(TextDecorationPaintPath {
                        line_index: 0,
                        d,
                        origin_x: 0.0,
                        origin_y: 0.0,
                        contour_count: u32::try_from(paint_contours)
                            .map_err(|_| TextOnPathError::DecorationPatternLimit)?,
                        segment_count: u32::try_from(paint_segments)
                            .map_err(|_| TextOnPathError::DecorationPatternLimit)?,
                        path_distance_start_px: Some(interval.start),
                        path_distance_end_px: Some(interval.end),
                        path_phase_origin_px: Some(phase_origin),
                        error: None,
                        thickness_px,
                        decoration_owner_id: Some(owner.owner_id),
                        path_normal_offset_px: Some(effective_normal_offset),
                        path_ribbon_half_width_px: Some(ribbon_half_width),
                        path_sample_count: if paint_region_index == 0 {
                            consumed_samples
                        } else {
                            0
                        },
                    });
                }
            }
            if path_count.saturating_add(paths.len()) > TEXT_PATH_DECORATION_FRAGMENT_LIMIT {
                return Err(TextOnPathError::DecorationLimit);
            }
            path_count = path_count.saturating_add(paths.len());
            fragments.push(TextDecorationFragment {
                line: decoration_line,
                style: owner.decoration.style,
                color: owner.decoration.color.clone(),
                skip_ink: owner.decoration.skip_ink.clone(),
                paths,
                source_start,
                source_end,
            });
        }
    }
    Ok(fragments)
}

fn fitted_cluster_intervals(
    clusters: &[ClusterRange],
    fit_plan: FitPlan,
    request: &TextOnPathRequest<'_>,
) -> Vec<(f64, f64)> {
    let mut pen = 0.0;
    let anchor_offset = anchor_shift(request.text_anchor, fit_plan.advance);
    clusters
        .iter()
        .enumerate()
        .map(|(cluster_index, cluster)| {
            let start = request.start_offset_px + anchor_offset + pen;
            pen += cluster.advance * fit_plan.inline_scale;
            let end = request.start_offset_px + anchor_offset + pen;
            if cluster_index + 1 < clusters.len() {
                pen += fit_plan.gap;
            }
            (start, end)
        })
        .collect()
}

fn clip_union_and_split_decoration_intervals(
    mut intervals: Vec<TextPathDecorationInterval>,
    request: &TextOnPathRequest<'_>,
    path_length: f64,
    closed: bool,
) -> Vec<TextPathDecorationInterval> {
    let (clip_start, clip_end) = if closed {
        let (window_start, window_end) = match request.text_anchor {
            TextPathAnchor::Start => (0.0, path_length),
            TextPathAnchor::Middle => (-path_length * 0.5, path_length * 0.5),
            TextPathAnchor::End => (-path_length, 0.0),
        };
        (
            request.start_offset_px + window_start,
            request.start_offset_px + window_end,
        )
    } else {
        (0.0, path_length)
    };
    for interval in &mut intervals {
        interval.start = interval.start.max(clip_start);
        interval.end = interval.end.min(clip_end);
    }
    intervals.retain(|interval| interval.end > interval.start);
    intervals.sort_by(|left, right| {
        left.start
            .total_cmp(&right.start)
            .then_with(|| left.end.total_cmp(&right.end))
    });
    let mut merged = Vec::<TextPathDecorationInterval>::new();
    for interval in intervals {
        if let Some(previous) = merged.last_mut()
            && interval.start <= previous.end + 1e-9
        {
            previous.end = previous.end.max(interval.end);
        } else {
            merged.push(interval);
        }
    }

    if !closed {
        return merged;
    }
    let mut split = Vec::with_capacity(merged.len().saturating_mul(2));
    for interval in merged {
        let next_seam = (interval.start / path_length)
            .floor()
            .mul_add(path_length, path_length);
        if next_seam > interval.start && next_seam < interval.end {
            split.push(TextPathDecorationInterval {
                start: interval.start,
                end: next_seam,
            });
            split.push(TextPathDecorationInterval {
                start: next_seam,
                end: interval.end,
            });
        } else {
            split.push(interval);
        }
    }
    split
}

#[expect(
    clippy::too_many_arguments,
    reason = "curved style inputs are explicit"
)]
fn build_curved_decoration_region(
    measured_path: &MeasuredPath,
    interval: TextPathDecorationInterval,
    phase_origin: f64,
    direction: PathTraversalDirection,
    normal_offset: f64,
    thickness_px: f64,
    style: TextDecorationStyle,
    allow_empty: bool,
    remaining_sample_budget: &mut usize,
) -> Result<Region, TextOnPathError> {
    let half = thickness_px * 0.5;
    let build_band = |start: f64,
                      end: f64,
                      center_offset: f64,
                      samples: &mut usize|
     -> Result<Region, TextOnPathError> {
        measured_path_offset_band(measured_path, start, end, direction, half, samples, |_| {
            center_offset
        })
        .map_err(|error| map_path_decoration_shape_error(&error))
    };
    let region = match style {
        TextDecorationStyle::Solid => build_band(
            interval.start,
            interval.end,
            normal_offset,
            remaining_sample_budget,
        )?,
        TextDecorationStyle::Double => {
            let first = build_band(
                interval.start,
                interval.end,
                normal_offset - thickness_px,
                remaining_sample_budget,
            )?;
            let second = build_band(
                interval.start,
                interval.end,
                normal_offset + thickness_px,
                remaining_sample_budget,
            )?;
            normalize_filled_region(Region {
                contours: first.contours.into_iter().chain(second.contours).collect(),
            })
            .map_err(|_| TextOnPathError::DecorationGeometry)?
        }
        TextDecorationStyle::Dashed => {
            let dash_length = thickness_px * 3.0;
            let period = thickness_px * 5.0;
            let cells = decoration_pattern_cells(interval, phase_origin, period, dash_length)?;
            ensure_decoration_pattern_estimate(cells.len(), 1, 4)?;
            let mut contours = Vec::new();
            for cell in cells {
                let band =
                    build_band(cell.start, cell.end, normal_offset, remaining_sample_budget)?;
                contours.extend(band.contours);
            }
            normalize_filled_region(Region { contours })
                .map_err(|_| TextOnPathError::DecorationGeometry)?
        }
        TextDecorationStyle::Dotted => build_curved_dotted_region(
            measured_path,
            interval,
            phase_origin,
            direction,
            normal_offset,
            thickness_px,
            remaining_sample_budget,
        )?,
        TextDecorationStyle::Wavy => {
            let period = thickness_px * 6.0;
            let amplitude = thickness_px * 1.5;
            measured_path_offset_band_chunks(
                measured_path,
                interval.start,
                interval.end,
                direction,
                half,
                period,
                remaining_sample_budget,
                |logical_distance| {
                    normal_offset
                        + amplitude * (2.0 * PI * (logical_distance - phase_origin) / period).sin()
                },
            )
            .map_err(|error| map_path_decoration_shape_error(&error))?
        }
    };
    if region.contours.is_empty() && !allow_empty {
        return Err(TextOnPathError::DecorationGeometry);
    }
    Ok(region)
}

/// Rebuild one path-decoration interval with its original logical phase.
///
/// The renderer uses this after outline-aware skip-ink classification when a
/// boolean subtraction cannot deterministically trace a tight curved ribbon.
/// Keeping style generation here preserves the same path-distance semantics
/// as the initial text layout.
///
/// # Errors
///
/// Returns [`TextOnPathError::DecorationLimit`] when rebuilding would exceed
/// the caller-owned sample budget, or [`TextOnPathError::DecorationGeometry`]
/// when the requested curved decoration geometry cannot be generated.
#[expect(
    clippy::too_many_arguments,
    reason = "curved style inputs and the caller-owned sample budget are explicit"
)]
pub fn rebuild_curved_decoration_interval(
    measured_path: &MeasuredPath,
    interval_start: f64,
    interval_end: f64,
    phase_origin: f64,
    direction: PathTraversalDirection,
    normal_offset: f64,
    thickness_px: f64,
    style: TextDecorationStyle,
    remaining_sample_budget: &mut usize,
) -> Result<Region, TextOnPathError> {
    build_curved_decoration_region(
        measured_path,
        TextPathDecorationInterval {
            start: interval_start,
            end: interval_end,
        },
        phase_origin,
        direction,
        normal_offset,
        thickness_px,
        style,
        true,
        remaining_sample_budget,
    )
}

fn map_path_decoration_shape_error(error: &ShapeError) -> TextOnPathError {
    match error {
        ShapeError::PathOffsetSampleLimit => TextOnPathError::DecorationLimit,
        _ => TextOnPathError::DecorationGeometry,
    }
}

fn decoration_pattern_cells(
    interval: TextPathDecorationInterval,
    phase_origin: f64,
    period: f64,
    filled_length: f64,
) -> Result<Vec<TextPathDecorationInterval>, TextOnPathError> {
    if !period.is_finite() || period <= 0.0 || !filled_length.is_finite() || filled_length <= 0.0 {
        return Err(TextOnPathError::DecorationGeometry);
    }
    let estimate = decoration_pattern_cell_estimate(interval, period)?;
    ensure_decoration_pattern_estimate(estimate, 1, 4)?;
    let phase = (interval.start - phase_origin).rem_euclid(period);
    let mut cell_start = interval.start - phase;
    if cell_start + filled_length <= interval.start {
        cell_start += period;
    }
    let mut cells = Vec::with_capacity(estimate);
    while cell_start < interval.end {
        if cells.len() >= estimate {
            return Err(TextOnPathError::DecorationGeometry);
        }
        let start = cell_start.max(interval.start);
        let end = (cell_start + filled_length).min(interval.end);
        if end > start {
            cells.push(TextPathDecorationInterval { start, end });
        }
        let next = cell_start + period;
        if next <= cell_start {
            return Err(TextOnPathError::DecorationGeometry);
        }
        cell_start = next;
    }
    Ok(cells)
}

fn ensure_decoration_pattern_estimate(
    cell_count: usize,
    contours_per_cell: usize,
    segments_per_contour: usize,
) -> Result<(), TextOnPathError> {
    if cell_count.saturating_mul(contours_per_cell)
        > super::decoration::MAX_TEXT_DECORATION_PATTERN_CONTOURS
        || cell_count
            .saturating_mul(contours_per_cell)
            .saturating_mul(segments_per_contour)
            > super::decoration::MAX_TEXT_DECORATION_PATTERN_SEGMENTS
    {
        return Err(TextOnPathError::DecorationPatternLimit);
    }
    Ok(())
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the finite non-negative estimate is bounded below 65,536 before conversion"
)]
fn decoration_pattern_cell_estimate(
    interval: TextPathDecorationInterval,
    period: f64,
) -> Result<usize, TextOnPathError> {
    let span = interval.end - interval.start;
    if !span.is_finite() || span < 0.0 || !period.is_finite() || period <= 0.0 {
        return Err(TextOnPathError::DecorationGeometry);
    }
    let estimated_cells = (span / period).ceil();
    if !estimated_cells.is_finite() || estimated_cells > 65_536.0 {
        return Err(TextOnPathError::DecorationPatternLimit);
    }
    Ok((estimated_cells as usize).saturating_add(2))
}

fn build_curved_dotted_region(
    measured_path: &MeasuredPath,
    interval: TextPathDecorationInterval,
    phase_origin: f64,
    direction: PathTraversalDirection,
    normal_offset: f64,
    thickness_px: f64,
    remaining_sample_budget: &mut usize,
) -> Result<Region, TextOnPathError> {
    let radius = thickness_px * 0.5;
    let period = thickness_px * 2.0;
    let estimate = decoration_pattern_cell_estimate(interval, period)?;
    ensure_decoration_pattern_estimate(estimate, 1, 6)?;
    let phase = (interval.start - phase_origin).rem_euclid(period);
    let mut cell_start = interval.start - phase;
    if cell_start + thickness_px <= interval.start {
        cell_start += period;
    }
    let mut contours = Vec::with_capacity(estimate);
    let mut interval_clip = None;
    let mut generated = 0_usize;
    while cell_start < interval.end {
        if generated >= estimate {
            return Err(TextOnPathError::DecorationGeometry);
        }
        let cell_end = cell_start + thickness_px;
        if cell_end <= interval.start {
            cell_start += period;
            continue;
        }
        if *remaining_sample_budget == 0 {
            return Err(TextOnPathError::DecorationLimit);
        }
        let mut center_q = cell_start + radius;
        if !measured_path.is_closed() {
            center_q = center_q.clamp(0.0, measured_path.total_length());
        }
        let sample = measured_path
            .sample_original_unwrapped(center_q, direction)
            .map_err(|error| map_path_decoration_shape_error(&error))?;
        *remaining_sample_budget -= 1;
        let normal = Point2D {
            x: -sample.tangent.y,
            y: sample.tangent.x,
        };
        let center = Point2D {
            x: sample.point.x + normal.x * normal_offset,
            y: sample.point.y + normal.y * normal_offset,
        };
        let dot = Region {
            contours: vec![circle_contour(center, radius)?],
        };
        if cell_start < interval.start || cell_end > interval.end {
            let clip = match &interval_clip {
                Some(clip) => clip,
                None => interval_clip.insert(
                    measured_path_offset_band(
                        measured_path,
                        interval.start,
                        interval.end,
                        direction,
                        radius * 1.01,
                        remaining_sample_budget,
                        |_| normal_offset,
                    )
                    .map_err(|error| map_path_decoration_shape_error(&error))?,
                ),
            };
            let clipped = boolean_regions(&dot, clip, BooleanOp::Intersect)
                .map_err(|_| TextOnPathError::DecorationGeometry)?;
            contours.extend(clipped.contours);
        } else {
            contours.extend(dot.contours);
        }
        let next = cell_start + period;
        if next <= cell_start {
            return Err(TextOnPathError::DecorationGeometry);
        }
        cell_start = next;
        generated += 1;
    }
    normalize_filled_region(Region { contours }).map_err(|_| TextOnPathError::DecorationGeometry)
}

fn circle_contour(center: Point2D, radius: f64) -> Result<Contour, TextOnPathError> {
    if !center.x.is_finite() || !center.y.is_finite() || !radius.is_finite() || radius <= 0.0 {
        return Err(TextOnPathError::DecorationGeometry);
    }
    let kappa = 0.552_284_749_830_793_6;
    let control = radius * kappa;
    let top = Point2D {
        x: center.x,
        y: center.y - radius,
    };
    let right = Point2D {
        x: center.x + radius,
        y: center.y,
    };
    let bottom = Point2D {
        x: center.x,
        y: center.y + radius,
    };
    let left = Point2D {
        x: center.x - radius,
        y: center.y,
    };
    Ok(Contour {
        segments: vec![
            CurveSegment::Cubic {
                p0: top,
                p1: Point2D {
                    x: center.x + control,
                    y: top.y,
                },
                p2: Point2D {
                    x: right.x,
                    y: center.y - control,
                },
                p3: right,
            },
            CurveSegment::Cubic {
                p0: right,
                p1: Point2D {
                    x: right.x,
                    y: center.y + control,
                },
                p2: Point2D {
                    x: center.x + control,
                    y: bottom.y,
                },
                p3: bottom,
            },
            CurveSegment::Cubic {
                p0: bottom,
                p1: Point2D {
                    x: center.x - control,
                    y: bottom.y,
                },
                p2: Point2D {
                    x: left.x,
                    y: center.y + control,
                },
                p3: left,
            },
            CurveSegment::Cubic {
                p0: left,
                p1: Point2D {
                    x: left.x,
                    y: center.y - control,
                },
                p2: Point2D {
                    x: center.x - control,
                    y: top.y,
                },
                p3: top,
            },
        ],
        closed: true,
    })
}

fn byte_to_grapheme_index(text: &str, byte_offset: usize) -> Result<u32, TextOnPathError> {
    if byte_offset > text.len() || !text.is_char_boundary(byte_offset) {
        return Err(TextOnPathError::UnitMapInvalid);
    }
    let mut byte_cursor = 0_usize;
    let mut grapheme_index = 0_usize;
    for grapheme in grapheme_split(text) {
        if byte_cursor >= byte_offset {
            break;
        }
        byte_cursor = byte_cursor.saturating_add(grapheme.len());
        grapheme_index = grapheme_index.saturating_add(1);
    }
    u32::try_from(grapheme_index).map_err(|_| TextOnPathError::DecorationRangeLimit)
}

fn place_glyphs_on_path(
    mut glyphs: Vec<PositionedGlyph>,
    clusters: &[ClusterRange],
    fit_plan: FitPlan,
    request: &TextOnPathRequest<'_>,
    measured_path: &MeasuredPath,
    source_indices: &[Option<usize>],
    original_glyph_count: usize,
    decoration_owner_ids: &[Option<u32>],
) -> PlacementResult {
    let anchor_offset = anchor_shift(request.text_anchor, fit_plan.advance);
    let mut cluster_pen = 0.0;
    let cluster_path_intervals = clusters
        .iter()
        .enumerate()
        .map(|(cluster_index, cluster)| {
            let start = request.start_offset_px + anchor_offset + cluster_pen;
            cluster_pen += cluster.advance * fit_plan.inline_scale;
            let end = request.start_offset_px + anchor_offset + cluster_pen;
            if cluster_index + 1 < clusters.len() {
                cluster_pen += fit_plan.gap;
            }
            (start, end)
        })
        .collect::<Vec<_>>();
    let mut pen = 0.0;
    let mut cluster_index = 0_usize;
    let mut samples = Vec::with_capacity(glyphs.len());
    for (glyph_index, glyph) in glyphs.iter_mut().enumerate() {
        glyph.x_offset *= fit_plan.inline_scale;
        glyph.x_advance *= fit_plan.inline_scale;
        glyph.inline_scale = (fit_plan.inline_scale != 1.0).then_some(fit_plan.inline_scale);
        let logical_midpoint = anchor_offset + pen + glyph.x_offset + glyph.x_advance / 2.0;
        glyph.path_decoration_owner_id = decoration_owner_ids.get(cluster_index).copied().flatten();
        if glyph.path_decoration_owner_id.is_some()
            && let Some((path_start, path_end)) = cluster_path_intervals.get(cluster_index)
        {
            glyph.path_distance_start_px = Some(*path_start);
            glyph.path_distance_end_px = Some(*path_end);
        }
        let logical_distance = resolve_logical_distance(
            measured_path.is_closed(),
            measured_path.total_length(),
            request.start_offset_px,
            request.text_anchor,
            logical_midpoint,
        );
        samples.push(logical_distance.and_then(|distance| {
            measured_path.sample(
                distance,
                match request.path_direction {
                    TextPathDirection::Forward => PathTraversalDirection::Forward,
                    TextPathDirection::Reverse => PathTraversalDirection::Reverse,
                },
            )
        }));
        pen += glyph.x_advance;
        if clusters
            .get(cluster_index)
            .is_some_and(|cluster| cluster.end == glyph_index + 1)
        {
            cluster_index += 1;
            if cluster_index < clusters.len() {
                pen += fit_plan.gap;
            }
        }
    }
    if fit_plan.gap != 0.0 {
        for cluster in clusters.iter().take(clusters.len().saturating_sub(1)) {
            if let Some(glyph) = glyphs.get_mut(cluster.end.saturating_sub(1)) {
                glyph.x_advance += fit_plan.gap;
            }
        }
    }

    let has_overflow = samples.iter().any(Option::is_none);
    let mut visible_clusters = vec![false; clusters.len()];
    let mut visibility_cluster_index = 0_usize;
    for (glyph_index, sample) in samples.iter().enumerate() {
        if sample.is_some()
            && let Some(visible) = visible_clusters.get_mut(visibility_cluster_index)
        {
            *visible = true;
        }
        if clusters
            .get(visibility_cluster_index)
            .is_some_and(|cluster| cluster.end == glyph_index + 1)
        {
            visibility_cluster_index += 1;
        }
    }
    let mut visible_glyphs = Vec::with_capacity(glyphs.len());
    let mut original_visible_indices = vec![None; original_glyph_count];
    for (glyph_index, (mut glyph, sample)) in glyphs.into_iter().zip(samples).enumerate() {
        let Some(sample) = sample else {
            continue;
        };
        let normal_sign = match request.path_normal {
            TextPathNormal::Left => 1.0,
            TextPathNormal::Right => -1.0,
        };
        let normal_x = -sample.tangent.y * normal_sign;
        let normal_y = sample.tangent.x * normal_sign;
        let cross_offset = request.path_offset_px + glyph.y_offset;
        let fitted_glyph_advance = if fit_plan.gap != 0.0
            && clusters
                .iter()
                .take(clusters.len().saturating_sub(1))
                .any(|cluster| cluster.end == glyph_index + 1)
        {
            glyph.x_advance - fit_plan.gap
        } else {
            glyph.x_advance
        };
        glyph.origin_x = sample.point.x - sample.tangent.x * fitted_glyph_advance / 2.0
            + normal_x * cross_offset;
        glyph.origin_y = sample.point.y - sample.tangent.y * fitted_glyph_advance / 2.0
            + normal_y * cross_offset;
        glyph.baseline_rotation_deg = Some(sample.tangent.y.atan2(sample.tangent.x).to_degrees());
        glyph.absolute_position = Some(true);
        if let Some(Some(source_index)) = source_indices.get(glyph_index)
            && let Some(visible_index) = original_visible_indices.get_mut(*source_index)
        {
            *visible_index = Some(visible_glyphs.len());
        }
        visible_glyphs.push(glyph);
    }
    PlacementResult {
        visible_glyphs,
        original_visible_indices,
        visible_clusters,
        has_overflow,
    }
}

fn apply_fit_to_glyph_infos(
    mut glyphs: Vec<shaping::GlyphInfo>,
    clusters: &[ClusterRange],
    fit_plan: FitPlan,
) -> Vec<shaping::GlyphInfo> {
    for glyph in &mut glyphs {
        glyph.x_offset *= fit_plan.inline_scale;
        glyph.x_advance *= fit_plan.inline_scale;
    }
    if glyphs.len() == clusters.last().map_or(0, |cluster| cluster.end) {
        for cluster in clusters.iter().take(clusters.len().saturating_sub(1)) {
            if let Some(glyph) = glyphs.get_mut(cluster.end.saturating_sub(1)) {
                glyph.x_advance += fit_plan.gap;
            }
        }
    }
    glyphs
}

fn original_infos_for_prefix(
    glyphs: &[shaping::GlyphInfo],
    prefix_byte_end: u32,
) -> Vec<shaping::GlyphInfo> {
    glyphs
        .iter()
        .filter(|glyph| glyph.cluster < prefix_byte_end)
        .cloned()
        .collect()
}

fn anchor_shift(anchor: TextPathAnchor, fitted_advance: f64) -> f64 {
    match anchor {
        TextPathAnchor::Start => 0.0,
        TextPathAnchor::Middle => -fitted_advance / 2.0,
        TextPathAnchor::End => -fitted_advance,
    }
}

fn resolve_logical_distance(
    closed: bool,
    path_length: f64,
    start_offset_px: f64,
    text_anchor: TextPathAnchor,
    logical_midpoint: f64,
) -> Option<f64> {
    if !closed {
        let distance = start_offset_px + logical_midpoint;
        return (distance >= 0.0 && distance <= path_length).then_some(distance);
    }

    let visible = match text_anchor {
        TextPathAnchor::Start => logical_midpoint >= 0.0 && logical_midpoint < path_length,
        TextPathAnchor::Middle => {
            logical_midpoint >= -path_length / 2.0 && logical_midpoint < path_length / 2.0
        }
        TextPathAnchor::End => logical_midpoint > -path_length && logical_midpoint <= 0.0,
    };
    visible.then(|| {
        (start_offset_px.rem_euclid(path_length) + logical_midpoint).rem_euclid(path_length)
    })
}

fn retain_visible_unit_members(unit_map: &mut TextUnitMap, visible_indices: &[Option<usize>]) {
    for unit in &mut unit_map.units {
        unit.members.retain_mut(|member| {
            if member.line_index != 0 {
                return false;
            }
            let Some(Some(visible_index)) = visible_indices.get(member.glyph_index as usize) else {
                return false;
            };
            let Ok(visible_index) = u32::try_from(*visible_index) else {
                return false;
            };
            member.glyph_index = visible_index;
            true
        });
    }
}

#[derive(Clone, Copy)]
struct InkBounds {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

fn resolve_path_ink_bbox(
    glyphs: &[PositionedGlyph],
    font_context: &FontContext<'_>,
    default_font_size_px: f64,
) -> Option<TextBBox> {
    let mut bounds: Option<InkBounds> = None;
    for glyph in glyphs {
        let Some((font_entry, font_registry)) = resolve_glyph_font(glyph, font_context) else {
            continue;
        };
        let variation_settings = glyph
            .font_variation_settings
            .as_deref()
            .map(shaping::parse_css_font_variation_settings)
            .unwrap_or_default();
        let variations = shaping::to_shape_variations(&variation_settings);
        let Some(face) = font_entry.font_face(font_registry.backend(), &variations) else {
            continue;
        };
        #[expect(
            clippy::cast_possible_truncation,
            reason = "OpenType glyph IDs are u16 values transported as u32"
        )]
        let glyph_id = glyph.glyph_id as u16;
        let Some(glyph_bbox) = face.glyph_bounding_box(glyph_id) else {
            continue;
        };
        let scale =
            glyph.font_size_px.unwrap_or(default_font_size_px) / f64::from(face.units_per_em());
        let rotation = glyph.baseline_rotation_deg.unwrap_or(0.0) % 360.0;
        let (sin, cos) = rotation.to_radians().sin_cos();
        for (font_x, font_y) in [
            (glyph_bbox.x_min, glyph_bbox.y_min),
            (glyph_bbox.x_min, glyph_bbox.y_max),
            (glyph_bbox.x_max, glyph_bbox.y_min),
            (glyph_bbox.x_max, glyph_bbox.y_max),
        ] {
            let local_x = f64::from(font_x) * scale * glyph.inline_scale.unwrap_or(1.0);
            let local_y = -f64::from(font_y) * scale;
            let point_x = glyph.origin_x + cos * local_x - sin * local_y;
            let point_y = glyph.origin_y + sin * local_x + cos * local_y;
            let point_bounds = InkBounds {
                min_x: point_x,
                min_y: point_y,
                max_x: point_x,
                max_y: point_y,
            };
            bounds = Some(match bounds {
                Some(current) => InkBounds {
                    min_x: current.min_x.min(point_bounds.min_x),
                    min_y: current.min_y.min(point_bounds.min_y),
                    max_x: current.max_x.max(point_bounds.max_x),
                    max_y: current.max_y.max(point_bounds.max_y),
                },
                None => point_bounds,
            });
        }
    }
    bounds.map(|value| TextBBox {
        x: value.min_x,
        y: value.min_y,
        w: value.max_x - value.min_x,
        h: value.max_y - value.min_y,
    })
}

fn resolve_glyph_font<'a>(
    glyph: &PositionedGlyph,
    font_context: &FontContext<'a>,
) -> Option<(&'a FontEntry, &'a FontRegistry)> {
    if let Some(font_entry) =
        font_context
            .registry
            .resolve(&glyph.font_alias, glyph.font_weight, &glyph.font_style)
    {
        return Some((font_entry, font_context.registry));
    }
    let fallback_registry = font_context.fallback_registry?;
    fallback_registry
        .resolve(&glyph.font_alias, glyph.font_weight, &glyph.font_style)
        .map(|font_entry| (font_entry, fallback_registry))
}

#[cfg(test)]
mod tests {
    use boundshape::{
        GeometryDoc, GeometryNode, GeometryViewBox, PathTraversalDirection, evaluate_geometry,
        region_axis_bounds, region_to_path,
    };

    use crate::font::FontStyle;
    use crate::text::types::{
        FitMode, Language, PositionedGlyph, TextDecorationStyle, TextLayoutRequest,
        TextOrientation, TextShadowLayer, TextSpanInput, TextStrokeLayer, WhiteSpaceMode, WrapMode,
        WritingMode,
    };

    use super::{
        TEXT_PATH_DECORATION_SAMPLE_LIMIT, TEXT_PATH_PAINT_RANGE_LIMIT,
        TEXT_PATH_PAINTED_LAYER_LIMIT, TEXT_PATH_SHAPING_RUN_LIMIT, TextOnPathError,
        TextPathAnchor, TextPathDecorationInterval, apply_text_path_paint_metadata,
        apply_text_path_paint_style_at_byte, build_cluster_ranges, build_curved_decoration_region,
        measure_single_svg_path, prepare_text_path_spans, resolve_logical_distance,
    };

    fn text_path_span_request<'a>(
        text: &'a str,
        spans: &'a [TextSpanInput],
    ) -> TextLayoutRequest<'a> {
        TextLayoutRequest {
            text,
            spans: Some(spans),
            rich_text: None,
            font_size_px: 24.0,
            line_height: None,
            line_height_px: None,
            letter_spacing_px: 0.0,
            text_indent: None,
            max_width: f64::MAX,
            max_height: None,
            wrap: WrapMode::None,
            white_space: WhiteSpaceMode::PreWrap,
            tab_size: 4,
            fit: FitMode::None,
            max_lines: Some(1),
            ellipsis: false,
            language: Language::En,
            writing_mode: WritingMode::HorizontalTb,
            text_orientation: TextOrientation::Mixed,
            uax14_breaks: None,
            hanging_punctuation: false,
            font_variation_settings: Vec::new(),
            font_feature_settings: Vec::new(),
            min_font_size_px: None,
            shrink_epsilon_px: None,
            shrink_max_iterations: None,
            max_font_size_px: None,
            grow_epsilon_px: None,
            grow_max_iterations: None,
            fit_max_probes: None,
        }
    }

    fn alternating_text_path_spans(count: usize) -> Vec<TextSpanInput> {
        (0..count)
            .map(|index| TextSpanInput {
                text: "A".to_string(),
                font_family: vec!["Noto".to_string()],
                font_weight: if index % 2 == 0 { 400 } else { 700 },
                font_style: FontStyle::Normal,
                font_size_px: 24.0,
                letter_spacing_px: Some(0.0),
                language: Some("en".to_string()),
                text_orientation: None,
                color: Some("#000000".to_string()),
                text_strokes: Some(Vec::new()),
                text_shadows: Some(Vec::new()),
                font_variation_settings: None,
                font_feature_settings: None,
                text_decoration: None,
                decoration_transport_only: false,
            })
            .collect()
    }

    fn painted_text_path_span(
        text: &str,
        color: &str,
        strokes: Vec<TextStrokeLayer>,
        shadows: Vec<TextShadowLayer>,
    ) -> TextSpanInput {
        TextSpanInput {
            text: text.to_string(),
            font_family: vec!["Noto".to_string()],
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px: 24.0,
            letter_spacing_px: Some(0.0),
            language: Some("en".to_string()),
            text_orientation: None,
            color: Some(color.to_string()),
            text_strokes: Some(strokes),
            text_shadows: Some(shadows),
            font_variation_settings: None,
            font_feature_settings: None,
            text_decoration: None,
            decoration_transport_only: false,
        }
    }

    fn positioned_glyph(text: &str, byte_start: u32, byte_end: u32) -> PositionedGlyph {
        PositionedGlyph {
            glyph_id: 1,
            text: text.to_string(),
            cluster_start: byte_start,
            cluster_end: byte_end,
            source_start: Some(byte_start),
            source_end: Some(byte_end),
            source_role: Some("content".to_string()),
            decoration_source_start: Some(byte_start),
            decoration_source_end: Some(byte_end),
            decoration_level: None,
            path_decoration_owner_id: None,
            path_distance_start_px: None,
            path_distance_end_px: None,
            text_decoration_geometry: None,
            font_alias: "Noto".to_string(),
            font_fallback: Vec::new(),
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px: Some(24.0),
            font_variation_settings: None,
            font_feature_settings: None,
            fill: None,
            text_strokes: None,
            text_shadows: None,
            paint_range_index: None,
            origin_x: 0.0,
            origin_y: 0.0,
            x_offset: 0.0,
            y_offset: 0.0,
            x_advance: 10.0,
            y_advance: 0.0,
            rotation_deg: 0,
            baseline_rotation_deg: None,
            inline_scale: None,
            synthetic_kind: None,
            outline_writing_mode: None,
            absolute_position: None,
        }
    }

    #[test]
    fn curved_wavy_pattern_uses_locally_bounded_contours() {
        let measured_path = measure_single_svg_path("M0 0L240 0").expect("straight measured path");
        let mut remaining_sample_budget = TEXT_PATH_DECORATION_SAMPLE_LIMIT;
        let region = build_curved_decoration_region(
            &measured_path,
            TextPathDecorationInterval {
                start: 0.0,
                end: 240.0,
            },
            0.0,
            PathTraversalDirection::Forward,
            4.0,
            2.0,
            TextDecorationStyle::Wavy,
            false,
            &mut remaining_sample_budget,
        )
        .expect("curved wavy geometry");

        assert!(
            region.contours.len() >= 20,
            "curved wavy contour count {}",
            region.contours.len()
        );
        for contour in &region.contours {
            let (min_x, _, max_x, _) = region_axis_bounds(&boundshape::Region {
                contours: vec![contour.clone()],
            })
            .expect("curved wavy contour bounds");
            assert!(
                max_x - min_x <= 14.001,
                "curved wavy contour spans {}px",
                max_x - min_x
            );
        }
    }

    #[test]
    fn curved_wavy_pattern_crosses_closed_path_corners() {
        let measured_path = measure_single_svg_path("M12 190C120 12 360 12 484 190L484 28L12 28Z")
            .expect("closed measured path");
        for direction in [
            PathTraversalDirection::Forward,
            PathTraversalDirection::Reverse,
        ] {
            let mut remaining_sample_budget = TEXT_PATH_DECORATION_SAMPLE_LIMIT;
            let region = build_curved_decoration_region(
                &measured_path,
                TextPathDecorationInterval {
                    start: 0.0,
                    end: 900.0,
                },
                if direction == PathTraversalDirection::Reverse {
                    900.0
                } else {
                    0.0
                },
                direction,
                4.0,
                2.0,
                TextDecorationStyle::Wavy,
                false,
                &mut remaining_sample_budget,
            )
            .expect("closed curved wavy geometry");

            assert!(region.contours.len() >= 70);
            for contour in region.contours {
                let serialized = region_to_path(&boundshape::Region {
                    contours: vec![contour],
                });
                evaluate_geometry(&GeometryDoc {
                    view_box: GeometryViewBox {
                        x: 0.0,
                        y: 0.0,
                        width: 1.0,
                        height: 1.0,
                    },
                    root: GeometryNode::Path {
                        node_id: None,
                        d: serialized,
                        fill_rule: None,
                    },
                })
                .expect("serialized closed curved wavy contour fill");
            }
        }

        for direction in [
            PathTraversalDirection::Forward,
            PathTraversalDirection::Reverse,
        ] {
            for interval_start in [0.0, 73.0, 180.0, 333.0, 512.0, 620.0, 777.0, 900.0] {
                for interval_length in [24.0, 60.0, 120.0, 240.0] {
                    for normal_offset in [-24.0, -12.0, 0.0, 12.0, 24.0] {
                        let interval_end = interval_start + interval_length;
                        let phase_origin = if direction == PathTraversalDirection::Reverse {
                            interval_end
                        } else {
                            interval_start
                        };
                        let mut remaining_sample_budget = TEXT_PATH_DECORATION_SAMPLE_LIMIT;
                        let region = build_curved_decoration_region(
                            &measured_path,
                            TextPathDecorationInterval {
                                start: interval_start,
                                end: interval_end,
                            },
                            phase_origin,
                            direction,
                            normal_offset,
                            2.0,
                            TextDecorationStyle::Wavy,
                            false,
                            &mut remaining_sample_budget,
                        )
                        .expect("sampled closed curved wavy geometry");
                        for contour in region.contours {
                            let serialized = region_to_path(&boundshape::Region {
                                contours: vec![contour],
                            });
                            evaluate_geometry(&GeometryDoc {
                                view_box: GeometryViewBox {
                                    x: 0.0,
                                    y: 0.0,
                                    width: 1.0,
                                    height: 1.0,
                                },
                                root: GeometryNode::Path {
                                    node_id: None,
                                    d: serialized,
                                    fill_rule: None,
                                },
                            })
                            .unwrap_or_else(|error| {
                                panic!(
                                    "serialized sampled wavy contour: direction={direction:?} start={interval_start} end={interval_end} normal={normal_offset}: {error}"
                                )
                            });
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn prepared_shaping_run_limit_accepts_boundary_and_rejects_next_run() {
        for count in [TEXT_PATH_SHAPING_RUN_LIMIT - 1, TEXT_PATH_SHAPING_RUN_LIMIT] {
            let text = "A".repeat(count);
            let spans = alternating_text_path_spans(count);
            let request = text_path_span_request(&text, &spans);
            let prepared = prepare_text_path_spans(&request)
                .expect("run count within limit")
                .shaping_spans
                .expect("span list");
            assert_eq!(prepared.len(), count);
        }

        let count = TEXT_PATH_SHAPING_RUN_LIMIT + 1;
        let text = "A".repeat(count);
        let spans = alternating_text_path_spans(count);
        let request = text_path_span_request(&text, &spans);
        assert_eq!(
            prepare_text_path_spans(&request).expect_err("run count beyond limit"),
            TextOnPathError::RunLimit,
        );
    }

    #[test]
    fn paint_only_boundaries_do_not_split_shaping_runs() {
        let strokes = vec![TextStrokeLayer {
            color: "#00ff00".to_string(),
            width_px: 2.0,
            linejoin: None,
            linecap: None,
            dasharray: None,
            miterlimit: None,
        }];
        let shadows = vec![TextShadowLayer {
            dx: 1.0,
            dy: 2.0,
            blur_px: Some(3.0),
            color: "#00000080".to_string(),
        }];
        let spans = vec![
            painted_text_path_span("f", "#ff0000", Vec::new(), Vec::new()),
            painted_text_path_span("i", "#0000ff", strokes.clone(), shadows.clone()),
        ];
        let request = text_path_span_request("fi", &spans);
        let prepared = prepare_text_path_spans(&request).expect("valid paint ranges");
        assert_eq!(prepared.shaping_spans.as_deref().map(<[_]>::len), Some(1));
        assert_eq!(prepared.paint_ranges.len(), 2);

        let mut glyphs = vec![positioned_glyph("f", 0, 1), positioned_glyph("i", 1, 2)];
        let clusters = build_cluster_ranges(&glyphs).expect("logical clusters");
        apply_text_path_paint_metadata(&mut glyphs, &clusters, &prepared.paint_ranges)
            .expect("paint boundaries align with final clusters");

        assert_eq!(glyphs[0].fill.as_deref(), Some("#ff0000"));
        assert_eq!(glyphs[0].paint_range_index, Some(0));
        assert_eq!(glyphs[0].text_strokes.as_deref(), Some(&[][..]));
        assert_eq!(glyphs[1].fill.as_deref(), Some("#0000ff"));
        assert_eq!(glyphs[1].paint_range_index, Some(1));
        assert_eq!(glyphs[1].text_strokes.as_deref(), Some(strokes.as_slice()));
        assert_eq!(glyphs[1].text_shadows.as_deref(), Some(shadows.as_slice()));
    }

    #[test]
    fn paint_boundary_inside_final_cluster_is_rejected() {
        let spans = vec![
            painted_text_path_span("f", "#ff0000", Vec::new(), Vec::new()),
            painted_text_path_span("i", "#0000ff", Vec::new(), Vec::new()),
        ];
        let request = text_path_span_request("fi", &spans);
        let prepared = prepare_text_path_spans(&request).expect("valid source ranges");
        let mut glyphs = vec![positioned_glyph("fi", 0, 2)];
        let clusters = build_cluster_ranges(&glyphs).expect("ligature cluster");

        assert_eq!(
            apply_text_path_paint_metadata(&mut glyphs, &clusters, &prepared.paint_ranges),
            Err(TextOnPathError::InlineClusterSplit),
        );
    }

    #[test]
    fn prepared_paint_range_limit_accepts_boundary_and_rejects_next_range() {
        for count in [TEXT_PATH_PAINT_RANGE_LIMIT, TEXT_PATH_PAINT_RANGE_LIMIT + 1] {
            let text = "A".repeat(count);
            let spans = (0..count)
                .map(|index| {
                    painted_text_path_span(
                        "A",
                        if index % 2 == 0 { "#000000" } else { "#ffffff" },
                        Vec::new(),
                        Vec::new(),
                    )
                })
                .collect::<Vec<_>>();
            let request = text_path_span_request(&text, &spans);
            if count == TEXT_PATH_PAINT_RANGE_LIMIT {
                let prepared = prepare_text_path_spans(&request).expect("paint range boundary");
                assert_eq!(prepared.paint_ranges.len(), count);
                assert_eq!(prepared.shaping_spans.as_deref().map(<[_]>::len), Some(1));
            } else {
                assert_eq!(
                    prepare_text_path_spans(&request).expect_err("paint range beyond limit"),
                    TextOnPathError::PaintLimit,
                );
            }
        }
    }

    #[test]
    fn aggregate_painted_layer_limit_accepts_boundary_and_rejects_next_layer() {
        let stroke = TextStrokeLayer {
            color: "#00ff00".to_string(),
            width_px: 2.0,
            linejoin: None,
            linecap: None,
            dasharray: None,
            miterlimit: None,
        };
        let shadow = TextShadowLayer {
            dx: 1.0,
            dy: 2.0,
            blur_px: Some(3.0),
            color: "#00000080".to_string(),
        };
        let layers_per_full_range = 1 + 8 + 8;
        let full_range_count = TEXT_PATH_PAINTED_LAYER_LIMIT / layers_per_full_range;
        let remaining_layers = TEXT_PATH_PAINTED_LAYER_LIMIT % layers_per_full_range;
        assert_eq!(remaining_layers, 1);

        let mut spans = (0..full_range_count)
            .map(|index| {
                painted_text_path_span(
                    "A",
                    if index % 2 == 0 { "#000000" } else { "#ffffff" },
                    vec![stroke.clone(); 8],
                    vec![shadow.clone(); 8],
                )
            })
            .collect::<Vec<_>>();
        spans.push(painted_text_path_span(
            "A",
            "#123456",
            Vec::new(),
            Vec::new(),
        ));
        let boundary_text = "A".repeat(spans.len());
        let boundary_request = text_path_span_request(&boundary_text, &spans);
        prepare_text_path_spans(&boundary_request).expect("aggregate layer boundary");

        spans.push(painted_text_path_span(
            "A",
            "#654321",
            Vec::new(),
            Vec::new(),
        ));
        let overflow_text = "A".repeat(spans.len());
        let overflow_request = text_path_span_request(&overflow_text, &spans);
        assert_eq!(
            prepare_text_path_spans(&overflow_request).expect_err("aggregate layer beyond limit"),
            TextOnPathError::PaintLimit,
        );
    }

    #[test]
    fn ellipsis_uses_first_omitted_paint_range() {
        let spans = vec![
            painted_text_path_span("A", "#ff0000", Vec::new(), Vec::new()),
            painted_text_path_span("B", "#0000ff", Vec::new(), Vec::new()),
        ];
        let request = text_path_span_request("AB", &spans);
        let prepared = prepare_text_path_spans(&request).expect("valid paint ranges");
        let mut ellipsis_glyphs = vec![positioned_glyph("…", 0, 3)];

        apply_text_path_paint_style_at_byte(&mut ellipsis_glyphs, 1, &prepared.paint_ranges)
            .expect("first omitted paint style");

        assert_eq!(ellipsis_glyphs[0].fill.as_deref(), Some("#0000ff"));
        assert_eq!(ellipsis_glyphs[0].paint_range_index, Some(1));
    }

    #[test]
    fn closed_anchor_windows_are_half_open_at_the_seam() {
        let path_length = 100.0;
        assert_eq!(
            resolve_logical_distance(true, path_length, 0.0, TextPathAnchor::Start, 0.0),
            Some(0.0),
        );
        assert_eq!(
            resolve_logical_distance(true, path_length, 0.0, TextPathAnchor::Start, path_length),
            None,
        );
        assert_eq!(
            resolve_logical_distance(
                true,
                path_length,
                0.0,
                TextPathAnchor::Middle,
                -path_length / 2.0,
            ),
            Some(path_length / 2.0),
        );
        assert_eq!(
            resolve_logical_distance(
                true,
                path_length,
                0.0,
                TextPathAnchor::Middle,
                path_length / 2.0,
            ),
            None,
        );
        assert_eq!(
            resolve_logical_distance(true, path_length, 0.0, TextPathAnchor::End, -path_length),
            None,
        );
        assert_eq!(
            resolve_logical_distance(true, path_length, 0.0, TextPathAnchor::End, 0.0),
            Some(0.0),
        );
    }

    #[test]
    fn closed_offset_is_modulo_without_expanding_the_single_lap_window() {
        assert_eq!(
            resolve_logical_distance(true, 100.0, -225.0, TextPathAnchor::Start, 25.0),
            Some(0.0),
        );
        assert_eq!(
            resolve_logical_distance(
                true,
                100.0,
                1_000_000_000_000.0,
                TextPathAnchor::Start,
                25.0
            ),
            Some(25.0),
        );
        assert_eq!(
            resolve_logical_distance(true, 100.0, 25.0, TextPathAnchor::Start, 100.0),
            None,
        );
    }
}
