use crate::font::FontContext;
use crate::font::line_metrics::resolve_line_metrics_for_style;
use crate::font::shaping::{parse_css_font_variation_settings, to_shape_variations};
use crate::text::grapheme::grapheme_split;
use boundshape::{
    Contour, CurveSegment, Point2D, Region, RegionAxis, clip_monotonic_region_to_axis_interval,
    region_to_path,
};
use std::collections::{HashMap, HashSet};

use super::types::{
    PositionedGlyph, TextDecorationFragment, TextDecorationInput, TextDecorationLine,
    TextDecorationPaintError, TextDecorationPaintPath, TextDecorationStyle, TextLayoutRequest,
    TextLayoutResult, preprocess_span_texts_for_white_space,
};

/// Maximum number of resolved physical paths retained for one text node.
/// One sentinel path is retained so the rendering layer can report the
/// deterministic complexity error without allocating an unbounded vector.
pub const MAX_TEXT_DECORATION_PATHS: usize = 16_384;
/// Maximum filled contours materialized for one text node.
pub const MAX_TEXT_DECORATION_PATTERN_CONTOURS: usize = 65_536;
/// Maximum line / curve segments materialized for one text node.
pub const MAX_TEXT_DECORATION_PATTERN_SEGMENTS: usize = 262_144;
/// Maximum number of authored decoration ranges accepted for one text node.
/// The rendering trust boundary and TypeScript validation mirror this value.
pub const MAX_TEXT_DECORATION_RANGES: usize = 4_096;

#[doc(hidden)]
#[must_use]
pub fn coalesce_decoration_only_spans(
    spans: &[super::types::TextSpanInput],
) -> Vec<super::types::TextSpanInput> {
    let mut coalesced: Vec<super::types::TextSpanInput> = Vec::with_capacity(spans.len());
    for span in spans {
        if let Some(previous) = coalesced.last_mut()
            && spans_have_equal_layout_style(previous, span)
        {
            previous.text.push_str(&span.text);
            continue;
        }
        let mut shaping_span = span.clone();
        shaping_span.text_decoration = None;
        coalesced.push(shaping_span);
    }
    coalesced
}

fn spans_have_equal_layout_style(
    left: &super::types::TextSpanInput,
    right: &super::types::TextSpanInput,
) -> bool {
    left.font_family == right.font_family
        && left.font_weight == right.font_weight
        && left.font_style == right.font_style
        && left.font_size_px == right.font_size_px
        && left.letter_spacing_px == right.letter_spacing_px
        && left.language == right.language
        && left.text_orientation == right.text_orientation
        && left.color == right.color
        && left.font_variation_settings == right.font_variation_settings
        && left.font_feature_settings == right.font_feature_settings
}

#[derive(Debug, Clone)]
pub(super) struct DecorationRange {
    pub(super) source_start: u32,
    pub(super) source_end: u32,
    pub(super) decoration: TextDecorationInput,
    pub(super) target: DecorationTarget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DecorationTarget {
    Base,
    RubyAnnotation {
        ruby_source_start: u32,
        ruby_source_end: u32,
        level: u32,
    },
}

#[derive(Debug, Clone)]
struct PendingStrip {
    line_index: u32,
    line: TextDecorationLine,
    inline_start: f64,
    inline_end: f64,
    phase_origin_inline: f64,
    center: f64,
    thickness_px: f64,
    color: String,
    vertical: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StripKey {
    line: TextDecorationLine,
    center_hundredths_bits: u64,
    thickness_hundredths_bits: u64,
    color: String,
    vertical: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
struct GlyphLocation {
    line_index: usize,
    glyph_index: usize,
}

#[derive(Default)]
struct DecorationGlyphIndex {
    base: HashMap<u32, Vec<GlyphLocation>>,
    annotations: HashMap<(u32, u32), Vec<GlyphLocation>>,
}

impl DecorationGlyphIndex {
    fn new(result: &TextLayoutResult) -> Self {
        let mut index = Self::default();
        for (line_index, line) in result.lines.iter().enumerate() {
            let Some(glyphs) = line.positioned_glyphs.as_deref() else {
                continue;
            };
            for (glyph_index, glyph) in glyphs.iter().enumerate() {
                let location = GlyphLocation {
                    line_index,
                    glyph_index,
                };
                if glyph.source_role.as_deref() == Some("rubyAnnotation") {
                    let Some(level) = glyph.decoration_level else {
                        continue;
                    };
                    let Some((source_start, source_end)) = glyph
                        .decoration_source_start
                        .zip(glyph.decoration_source_end)
                    else {
                        continue;
                    };
                    for source_index in source_start..source_end {
                        index
                            .annotations
                            .entry((level, source_index))
                            .or_default()
                            .push(location);
                    }
                } else if let Some((source_start, source_end)) =
                    glyph.source_start.zip(glyph.source_end)
                {
                    for source_index in source_start..source_end {
                        index.base.entry(source_index).or_default().push(location);
                    }
                }
            }
        }
        index
    }

    fn locations_for_range(
        &self,
        range: &DecorationRange,
        result: &TextLayoutResult,
    ) -> Vec<GlyphLocation> {
        let mut locations = Vec::new();
        let mut seen = HashSet::new();
        for source_index in range.source_start..range.source_end {
            let candidates = match range.target {
                DecorationTarget::Base => self.base.get(&source_index),
                DecorationTarget::RubyAnnotation { level, .. } => {
                    self.annotations.get(&(level, source_index))
                }
            };
            for location in candidates.into_iter().flatten() {
                if !seen.insert(*location) {
                    continue;
                }
                if let DecorationTarget::RubyAnnotation {
                    ruby_source_start,
                    ruby_source_end,
                    ..
                } = range.target
                {
                    let Some(glyph) = result.lines[location.line_index]
                        .positioned_glyphs
                        .as_deref()
                        .and_then(|glyphs| glyphs.get(location.glyph_index))
                    else {
                        continue;
                    };
                    if !glyph
                        .source_start
                        .zip(glyph.source_end)
                        .is_some_and(|(start, end)| {
                            start < ruby_source_end && end > ruby_source_start
                        })
                    {
                        continue;
                    }
                }
                locations.push(*location);
            }
        }
        locations.sort_unstable();
        locations
    }
}

/// Resolve decoration ranges after text layout. This is deliberately a paint
/// pass: it reads positioned glyph source ranges and never changes shaping,
/// line breaking, intrinsic sizes, or unit membership.
pub fn resolve_text_decorations(
    req: &TextLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    result: &mut TextLayoutResult,
) {
    let ranges = decoration_ranges(req, font_ctx, result.chosen_font_size_px);
    if ranges.is_empty() {
        return;
    }

    let vertical = req.is_vertical();
    let glyph_index = DecorationGlyphIndex::new(result);
    let mut fragments = Vec::new();
    let mut path_count = 0_usize;
    let mut contour_count = 0_usize;
    let mut pattern_segment_count = 0_usize;
    for range in &ranges {
        for decoration_line in [
            TextDecorationLine::Underline,
            TextDecorationLine::Overline,
            TextDecorationLine::LineThrough,
        ] {
            if !range.decoration.line.contains(&decoration_line) {
                continue;
            }
            let remaining_paths = MAX_TEXT_DECORATION_PATHS.saturating_sub(path_count);
            let mut strips = Vec::new();
            let locations = glyph_index.locations_for_range(range, result);
            for line_locations in
                locations.chunk_by(|left, right| left.line_index == right.line_index)
            {
                let line_index = line_locations[0].line_index;
                let Some(glyphs) = result.lines[line_index].positioned_glyphs.as_deref() else {
                    continue;
                };
                append_decoration_line(
                    &mut strips,
                    remaining_paths,
                    u32::try_from(line_index).unwrap_or(u32::MAX),
                    line_locations
                        .iter()
                        .filter_map(|location| glyphs.get(location.glyph_index)),
                    decoration_line,
                    &range.decoration,
                    vertical,
                    result.chosen_font_size_px,
                    font_ctx,
                );
                if strips.len() > remaining_paths {
                    break;
                }
            }
            let strips = merge_adjacent_strips(strips);
            if strips.is_empty() {
                continue;
            }
            if strips.len() > remaining_paths {
                fragments.push(TextDecorationFragment {
                    line: decoration_line,
                    style: range.decoration.style,
                    color: range.decoration.color.clone(),
                    skip_ink: range.decoration.skip_ink.clone(),
                    paths: vec![paint_error_path(
                        strips[0].line_index,
                        TextDecorationPaintError::ComplexityLimit,
                    )],
                    source_start: range.source_start,
                    source_end: range.source_end,
                });
                result.text_decorations = fragments;
                return;
            }

            let mut paths = Vec::with_capacity(strips.len());
            for strip in strips {
                let remaining_contours =
                    MAX_TEXT_DECORATION_PATTERN_CONTOURS.saturating_sub(contour_count);
                let remaining_pattern_segments =
                    MAX_TEXT_DECORATION_PATTERN_SEGMENTS.saturating_sub(pattern_segment_count);
                match build_paint_path(
                    &strip,
                    range.decoration.style,
                    remaining_contours,
                    remaining_pattern_segments,
                ) {
                    Ok(path) => {
                        contour_count = contour_count.saturating_add(path.contour_count as usize);
                        pattern_segment_count =
                            pattern_segment_count.saturating_add(path.segment_count as usize);
                        paths.push(path);
                    }
                    Err(error) => {
                        paths.push(paint_error_path(strip.line_index, error));
                        fragments.push(TextDecorationFragment {
                            line: decoration_line,
                            style: range.decoration.style,
                            color: range.decoration.color.clone(),
                            skip_ink: range.decoration.skip_ink.clone(),
                            paths,
                            source_start: range.source_start,
                            source_end: range.source_end,
                        });
                        result.text_decorations = fragments;
                        return;
                    }
                }
            }
            path_count = path_count.saturating_add(paths.len());
            fragments.push(TextDecorationFragment {
                line: decoration_line,
                style: range.decoration.style,
                color: range.decoration.color.clone(),
                skip_ink: range.decoration.skip_ink.clone(),
                paths,
                source_start: range.source_start,
                source_end: range.source_end,
            });
        }
    }

    result.text_decorations = fragments;
}

fn decoration_ranges(
    req: &TextLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    chosen_font_size_px: f64,
) -> Vec<DecorationRange> {
    if req.rich_text.is_some() {
        return super::rich::normalized_text_decoration_ranges(req, font_ctx, chosen_font_size_px);
    }
    let mut ranges: Vec<DecorationRange> = Vec::new();
    if let Some(spans) = req.spans.filter(|spans| !spans.is_empty()) {
        let authored_texts: Vec<&str> = spans.iter().map(|span| span.text.as_str()).collect();
        let normalized_texts =
            preprocess_span_texts_for_white_space(&authored_texts, req.white_space, req.tab_size);
        let texts: Vec<&str> = normalized_texts.as_ref().map_or_else(
            || authored_texts,
            |normalized| normalized.iter().map(String::as_str).collect(),
        );

        let concatenated_text = texts.concat();
        let mut grapheme_byte_ranges = Vec::new();
        let mut grapheme_byte_cursor = 0_usize;
        for grapheme in grapheme_split(&concatenated_text) {
            let grapheme_byte_end = grapheme_byte_cursor.saturating_add(grapheme.len());
            grapheme_byte_ranges.push((grapheme_byte_cursor, grapheme_byte_end));
            grapheme_byte_cursor = grapheme_byte_end;
        }
        let mut span_byte_cursor = 0_usize;
        for (span, text) in spans.iter().zip(texts) {
            let span_byte_end = span_byte_cursor.saturating_add(text.len());
            let source_start = grapheme_byte_ranges
                .partition_point(|(_, grapheme_end)| *grapheme_end <= span_byte_cursor);
            let source_end = grapheme_byte_ranges
                .partition_point(|(grapheme_start, _)| *grapheme_start < span_byte_end);
            let source_start = u32::try_from(source_start).unwrap_or(u32::MAX);
            let source_end = u32::try_from(source_end).unwrap_or(u32::MAX);
            if source_start < source_end
                && let Some(decoration) = &span.text_decoration
            {
                if let Some(previous) = ranges.last_mut()
                    && matches!(previous.target, DecorationTarget::Base)
                    && previous.source_end >= source_start
                    && previous.decoration == *decoration
                {
                    previous.source_end = previous.source_end.max(source_end);
                } else {
                    ranges.push(DecorationRange {
                        source_start,
                        source_end,
                        decoration: decoration.clone(),
                        target: DecorationTarget::Base,
                    });
                }
            }
            span_byte_cursor = span_byte_end;
        }
    }

    ranges
}

fn append_decoration_line<'a>(
    output: &mut Vec<PendingStrip>,
    segment_limit: usize,
    line_index: u32,
    glyphs: impl IntoIterator<Item = &'a PositionedGlyph>,
    decoration_line: TextDecorationLine,
    decoration: &TextDecorationInput,
    vertical: bool,
    chosen_font_size_px: f64,
    font_ctx: &FontContext<'_>,
) {
    let glyphs = glyphs.into_iter().collect::<Vec<_>>();
    let phase_origin_inline = glyphs
        .iter()
        .map(|glyph| glyph_inline_extent(glyph, vertical).0)
        .fold(f64::INFINITY, f64::min);
    if !phase_origin_inline.is_finite() {
        return;
    }
    let strip_count = if decoration.style == TextDecorationStyle::Double {
        2
    } else {
        1
    };
    let mut active: [Option<(StripKey, PendingStrip)>; 2] = [None, None];
    for glyph in glyphs {
        let (inline_start, inline_end) = glyph_inline_extent(glyph, vertical);
        let (center, thickness_px) = glyph_decoration_metrics(
            glyph,
            decoration_line,
            decoration,
            vertical,
            chosen_font_size_px,
            font_ctx,
        );
        let centers = match decoration.style {
            TextDecorationStyle::Double => {
                if vertical {
                    [center + thickness_px, center - thickness_px]
                } else {
                    [center - thickness_px, center + thickness_px]
                }
            }
            TextDecorationStyle::Solid
            | TextDecorationStyle::Dotted
            | TextDecorationStyle::Dashed
            | TextDecorationStyle::Wavy => [center, center],
        };
        for (strip_index, physical_center) in centers.into_iter().take(strip_count).enumerate() {
            let key = StripKey {
                line: decoration_line,
                center_hundredths_bits: quantized_hundredths_bits(physical_center),
                thickness_hundredths_bits: quantized_hundredths_bits(thickness_px),
                color: decoration.color.clone(),
                vertical,
            };
            if let Some((active_key, strip)) = active[strip_index].as_mut()
                && *active_key == key
                && inline_start <= strip.inline_end + 0.01
            {
                strip.inline_end = strip.inline_end.max(inline_end);
            } else {
                if flush_active_strip(output, &mut active[strip_index], segment_limit) {
                    return;
                }
                active[strip_index] = Some((
                    key,
                    PendingStrip {
                        line_index,
                        line: decoration_line,
                        inline_start,
                        inline_end,
                        phase_origin_inline,
                        center: physical_center,
                        thickness_px,
                        color: decoration.color.clone(),
                        vertical,
                    },
                ));
            }
        }
    }
    for current in active.iter_mut().take(strip_count) {
        if flush_active_strip(output, current, segment_limit) {
            return;
        }
    }
}

fn flush_active_strip(
    output: &mut Vec<PendingStrip>,
    active: &mut Option<(StripKey, PendingStrip)>,
    segment_limit: usize,
) -> bool {
    if let Some((_, strip)) = active.take()
        && strip.inline_end > strip.inline_start
        && output.len() <= segment_limit
    {
        output.push(strip);
    }
    output.len() > segment_limit
}

fn glyph_inline_extent(glyph: &PositionedGlyph, vertical: bool) -> (f64, f64) {
    if vertical && let Some(geometry) = glyph.text_decoration_geometry {
        return (
            geometry.inline_start.min(geometry.inline_end),
            geometry.inline_start.max(geometry.inline_end),
        );
    }
    let (start, advance) = if vertical {
        let advance = if glyph.y_advance.abs() > 0.0 {
            glyph.y_advance.abs()
        } else {
            glyph.x_advance.abs()
        };
        (glyph.origin_y - glyph.y_offset, advance)
    } else {
        (glyph.origin_x - glyph.x_offset, glyph.x_advance.abs())
    };
    (start.min(start + advance), start.max(start + advance))
}

pub(crate) fn glyph_decoration_metrics(
    glyph: &PositionedGlyph,
    line: TextDecorationLine,
    decoration: &TextDecorationInput,
    vertical: bool,
    chosen_font_size_px: f64,
    font_ctx: &FontContext<'_>,
) -> (f64, f64) {
    let font_size_px = glyph.font_size_px.unwrap_or(chosen_font_size_px);
    let mut aliases = Vec::with_capacity(glyph.font_fallback.len() + 1);
    aliases.push(glyph.font_alias.clone());
    aliases.extend(glyph.font_fallback.iter().cloned());
    let primary_entry =
        font_ctx
            .registry
            .resolve_chain(&aliases, glyph.font_weight, &glyph.font_style);
    let (font_entry, font_backend) = primary_entry
        .map_or_else(
            || {
                let fallback_registry = font_ctx.fallback_registry?;
                Some((
                    fallback_registry.resolve_chain(
                        &aliases,
                        glyph.font_weight,
                        &glyph.font_style,
                    )?,
                    fallback_registry.backend(),
                ))
            },
            |entry| Some((entry, font_ctx.registry.backend())),
        )
        .unzip();
    let variation_settings = glyph
        .font_variation_settings
        .as_deref()
        .map(parse_css_font_variation_settings)
        .unwrap_or_default();
    let variations = to_shape_variations(&variation_settings);
    let font_face = font_entry
        .zip(font_backend)
        .and_then(|(entry, backend)| entry.font_face(backend, &variations));
    let units_per_em = font_face.as_deref().map_or_else(
        || font_entry.map_or(1, |entry| entry.units_per_em),
        crate::font::backend::FontFace::units_per_em,
    );
    let scale = font_size_px / f64::from(units_per_em.max(1));
    let fallback_thickness = (font_size_px / 16.0).max(1.0);
    let metric_thickness = match line {
        TextDecorationLine::Underline => font_face
            .as_deref()
            .and_then(crate::font::backend::FontFace::underline_thickness)
            .or_else(|| font_entry.and_then(|entry| entry.underline_thickness)),
        TextDecorationLine::LineThrough => font_face
            .as_deref()
            .and_then(crate::font::backend::FontFace::strikeout_thickness)
            .or_else(|| font_entry.and_then(|entry| entry.strikeout_thickness)),
        TextDecorationLine::Overline => None,
    }
    .map(|value| f64::from(value).abs() * scale)
    .filter(|value| value.is_finite() && *value > 0.0)
    .unwrap_or(fallback_thickness);
    let thickness_px = decoration.thickness_px.unwrap_or(metric_thickness);

    let block_half_extent = glyph
        .text_decoration_geometry
        .map_or(font_size_px / 2.0, |geometry| geometry.block_half_extent);
    let logical_auto_offset = if vertical {
        match line {
            TextDecorationLine::Underline => block_half_extent,
            TextDecorationLine::Overline => -block_half_extent,
            TextDecorationLine::LineThrough => 0.0,
        }
    } else {
        match line {
            TextDecorationLine::Underline => font_face
                .as_deref()
                .and_then(crate::font::backend::FontFace::underline_position)
                .or_else(|| font_entry.and_then(|entry| entry.underline_position))
                .map_or(font_size_px / 10.0, |value| -f64::from(value) * scale),
            TextDecorationLine::LineThrough => font_face
                .as_deref()
                .and_then(crate::font::backend::FontFace::strikeout_position)
                .or_else(|| font_entry.and_then(|entry| entry.strikeout_position))
                .map_or(-font_size_px * 0.30, |value| -f64::from(value) * scale),
            TextDecorationLine::Overline => {
                let line_metrics = resolve_line_metrics_for_style(
                    font_ctx.registry,
                    font_ctx.fallback_registry,
                    &aliases,
                    glyph.font_weight,
                    &glyph.font_style,
                    font_size_px,
                    None,
                    None,
                );
                -line_metrics.ascent_px
            }
        }
    } + decoration.offset_px;
    let baseline = if vertical {
        glyph
            .text_decoration_geometry
            .map_or(glyph.origin_x - glyph.x_offset, |geometry| {
                geometry.baseline
            })
    } else {
        glyph.origin_y - glyph.y_offset
    };
    let center = if vertical {
        baseline - logical_auto_offset
    } else {
        baseline + logical_auto_offset
    };
    (center, thickness_px)
}

fn quantized_hundredths_bits(value: f64) -> u64 {
    let quantized = (value * 100.0).round();
    if quantized == 0.0 {
        0.0f64.to_bits()
    } else {
        quantized.to_bits()
    }
}

fn merge_adjacent_strips(strips: Vec<PendingStrip>) -> Vec<PendingStrip> {
    let mut merged: Vec<PendingStrip> = Vec::with_capacity(strips.len());
    for strip in strips {
        if let Some(previous) = merged.last_mut()
            && previous.line_index == strip.line_index
            && previous.line == strip.line
            && previous.vertical == strip.vertical
            && previous.color == strip.color
            && quantized_hundredths_bits(previous.center) == quantized_hundredths_bits(strip.center)
            && quantized_hundredths_bits(previous.thickness_px)
                == quantized_hundredths_bits(strip.thickness_px)
            && quantized_hundredths_bits(previous.phase_origin_inline)
                == quantized_hundredths_bits(strip.phase_origin_inline)
            && strip.inline_start <= previous.inline_end + 0.01
        {
            previous.inline_end = previous.inline_end.max(strip.inline_end);
        } else {
            merged.push(strip);
        }
    }
    merged
}

fn paint_error_path(line_index: u32, error: TextDecorationPaintError) -> TextDecorationPaintPath {
    TextDecorationPaintPath {
        line_index,
        d: String::new(),
        origin_x: 0.0,
        origin_y: 0.0,
        contour_count: 0,
        segment_count: 0,
        path_distance_start_px: None,
        path_distance_end_px: None,
        path_phase_origin_px: None,
        error: Some(error),
        thickness_px: 0.0,
        decoration_owner_id: None,
        path_normal_offset_px: None,
        path_ribbon_half_width_px: None,
        path_sample_count: 0,
    }
}

fn build_paint_path(
    strip: &PendingStrip,
    style: TextDecorationStyle,
    remaining_contours: usize,
    remaining_segments: usize,
) -> Result<TextDecorationPaintPath, TextDecorationPaintError> {
    let inline_length = strip.inline_end - strip.inline_start;
    let phase_start = strip.inline_start - strip.phase_origin_inline;
    if !inline_length.is_finite()
        || inline_length <= 0.0
        || !phase_start.is_finite()
        || !strip.center.is_finite()
        || !strip.thickness_px.is_finite()
        || strip.thickness_px <= 0.0
    {
        return Err(TextDecorationPaintError::Geometry);
    }

    let inline_region = match style {
        TextDecorationStyle::Solid | TextDecorationStyle::Double => rectangle_region(
            0.0,
            inline_length,
            -strip.thickness_px * 0.5,
            strip.thickness_px * 0.5,
        ),
        TextDecorationStyle::Dotted => dotted_region(
            inline_length,
            phase_start,
            strip.thickness_px,
            remaining_contours,
            remaining_segments,
        )?,
        TextDecorationStyle::Dashed => dashed_region(
            inline_length,
            phase_start,
            strip.thickness_px,
            remaining_contours,
            remaining_segments,
        )?,
        TextDecorationStyle::Wavy => wavy_region(
            inline_length,
            phase_start,
            strip.thickness_px,
            remaining_contours,
            remaining_segments,
        )?,
    };
    let physical_region = map_region_to_physical(&inline_region, strip.vertical);
    let (contour_count, segment_count) = region_complexity(&physical_region);
    if contour_count > remaining_contours || segment_count > remaining_segments {
        return Err(TextDecorationPaintError::PatternLimit);
    }
    let contour_count =
        u32::try_from(contour_count).map_err(|_| TextDecorationPaintError::PatternLimit)?;
    let segment_count =
        u32::try_from(segment_count).map_err(|_| TextDecorationPaintError::PatternLimit)?;
    let d = region_to_path(&physical_region).map_err(|_| TextDecorationPaintError::Geometry)?;
    if d.is_empty() {
        return Err(TextDecorationPaintError::Geometry);
    }
    let (origin_x, origin_y) = if strip.vertical {
        (strip.center, strip.inline_start)
    } else {
        (strip.inline_start, strip.center)
    };
    Ok(TextDecorationPaintPath {
        line_index: strip.line_index,
        d,
        origin_x,
        origin_y,
        contour_count,
        segment_count,
        path_distance_start_px: None,
        path_distance_end_px: None,
        path_phase_origin_px: None,
        error: None,
        thickness_px: strip.thickness_px,
        decoration_owner_id: None,
        path_normal_offset_px: None,
        path_ribbon_half_width_px: None,
        path_sample_count: 0,
    })
}

fn dotted_region(
    inline_length: f64,
    phase_start: f64,
    thickness_px: f64,
    remaining_contours: usize,
    remaining_segments: usize,
) -> Result<Region, TextDecorationPaintError> {
    let radius = thickness_px * 0.5;
    let period = thickness_px * 2.0;
    // A clipped endpoint disk can contain four cubic pieces plus two clip
    // boundary lines. Charge that conservative per-cell upper bound before
    // materializing any contour.
    let maximum_cells = remaining_contours.min(remaining_segments / 6);
    let estimate = pattern_cell_estimate(inline_length, period, maximum_cells)?;
    if estimate > remaining_contours || estimate.saturating_mul(6) > remaining_segments {
        return Err(TextDecorationPaintError::PatternLimit);
    }

    let mut output = Region {
        contours: Vec::with_capacity(estimate),
    };
    let phase = phase_start.rem_euclid(period);
    let mut cell_start = -phase;
    if cell_start + thickness_px <= 0.0 {
        cell_start += period;
    }
    let mut generated = 0_usize;
    while cell_start < inline_length {
        if generated >= estimate {
            return Err(TextDecorationPaintError::Geometry);
        }
        let dot_start = cell_start;
        let dot_end = cell_start + thickness_px;
        if dot_end > 0.0 && dot_start < inline_length {
            let circle = circle_region(cell_start + radius, radius);
            if dot_start >= 0.0 && dot_end <= inline_length {
                output.contours.extend(circle.contours);
            } else {
                let clipped =
                    clipped_circle_region(cell_start + radius, radius, 0.0, inline_length)?;
                output.contours.extend(clipped.contours);
            }
        }
        let next = cell_start + period;
        if next <= cell_start {
            return Err(TextDecorationPaintError::Geometry);
        }
        cell_start = next;
        generated += 1;
    }
    Ok(output)
}

fn dashed_region(
    inline_length: f64,
    phase_start: f64,
    thickness_px: f64,
    remaining_contours: usize,
    remaining_segments: usize,
) -> Result<Region, TextDecorationPaintError> {
    let dash_length = thickness_px * 3.0;
    let period = thickness_px * 5.0;
    let maximum_cells = remaining_contours.min(remaining_segments / 4);
    let estimate = pattern_cell_estimate(inline_length, period, maximum_cells)?;
    if estimate > remaining_contours || estimate.saturating_mul(4) > remaining_segments {
        return Err(TextDecorationPaintError::PatternLimit);
    }

    let half = thickness_px * 0.5;
    let phase = phase_start.rem_euclid(period);
    let mut cell_start = -phase;
    if cell_start + dash_length <= 0.0 {
        cell_start += period;
    }
    let mut contours = Vec::with_capacity(estimate);
    let mut generated = 0_usize;
    while cell_start < inline_length {
        if generated >= estimate {
            return Err(TextDecorationPaintError::Geometry);
        }
        let clipped_start = cell_start.max(0.0);
        let clipped_end = (cell_start + dash_length).min(inline_length);
        if clipped_end > clipped_start {
            contours.extend(rectangle_region(clipped_start, clipped_end, -half, half).contours);
        }
        let next = cell_start + period;
        if next <= cell_start {
            return Err(TextDecorationPaintError::Geometry);
        }
        cell_start = next;
        generated += 1;
    }
    Ok(Region { contours })
}

fn wavy_region(
    inline_length: f64,
    phase_start: f64,
    thickness_px: f64,
    remaining_contours: usize,
    remaining_segments: usize,
) -> Result<Region, TextDecorationPaintError> {
    let amplitude = thickness_px * 1.5;
    let wavelength = thickness_px * 6.0;
    let quarter_length = wavelength * 0.25;
    if remaining_contours == 0 {
        return Err(TextDecorationPaintError::PatternLimit);
    }
    let maximum_quarters = remaining_segments.saturating_sub(2) / 2;
    let estimate = pattern_cell_estimate(inline_length, quarter_length, maximum_quarters)?;
    let estimated_contours = estimate.div_ceil(4);
    let estimated_segments = estimate
        .saturating_mul(2)
        .saturating_add(estimated_contours.saturating_mul(2));
    if estimated_contours > remaining_contours || estimated_segments > remaining_segments {
        return Err(TextDecorationPaintError::PatternLimit);
    }

    let phase = phase_start.rem_euclid(wavelength);
    let mut quarter_index = if phase < quarter_length {
        0
    } else if phase < quarter_length * 2.0 {
        1
    } else if phase < quarter_length * 3.0 {
        2
    } else {
        3
    };
    let quarter_offset = phase - quarter_index as f64 * quarter_length;
    let mut quarter_start = -quarter_offset;
    let mut centerline = Vec::with_capacity(estimate);
    let mut generated = 0_usize;
    while quarter_start < inline_length {
        if generated >= estimate {
            return Err(TextDecorationPaintError::Geometry);
        }
        let quarter_end = quarter_start + quarter_length;
        let clipped_start = quarter_start.max(0.0);
        let clipped_end = quarter_end.min(inline_length);
        if clipped_end > clipped_start {
            let cubic = wave_quarter(
                quarter_index % 4,
                quarter_start,
                quarter_end,
                amplitude,
                wavelength,
            );
            let t0 = (clipped_start - quarter_start) / quarter_length;
            let t1 = (clipped_end - quarter_start) / quarter_length;
            centerline.push(cubic_subsegment(cubic, t0, t1));
        }
        let next = quarter_start + quarter_length;
        if next <= quarter_start {
            return Err(TextDecorationPaintError::Geometry);
        }
        quarter_start = next;
        quarter_index = quarter_index.wrapping_add(1);
        generated += 1;
    }
    if centerline.is_empty() {
        return Err(TextDecorationPaintError::Geometry);
    }

    let mut contours = Vec::with_capacity(centerline.len().div_ceil(4));
    for wave_chunk in centerline.chunks(4) {
        contours.push(wavy_contour(wave_chunk, thickness_px)?);
    }
    Ok(Region { contours })
}

fn wavy_contour(
    centerline: &[CubicPoints],
    thickness_px: f64,
) -> Result<Contour, TextDecorationPaintError> {
    let half = thickness_px * 0.5;
    let upper = centerline
        .iter()
        .copied()
        .map(|cubic| offset_cubic(cubic, -half))
        .collect::<Vec<_>>();
    let lower = centerline
        .iter()
        .rev()
        .copied()
        .map(|cubic| reverse_cubic(offset_cubic(cubic, half)))
        .collect::<Vec<_>>();
    let upper_end = upper
        .last()
        .map(|cubic| cubic.p3)
        .ok_or(TextDecorationPaintError::Geometry)?;
    let lower_start = lower
        .first()
        .map(|cubic| cubic.p0)
        .ok_or(TextDecorationPaintError::Geometry)?;
    let lower_end = lower
        .last()
        .map(|cubic| cubic.p3)
        .ok_or(TextDecorationPaintError::Geometry)?;
    let upper_start = upper
        .first()
        .map(|cubic| cubic.p0)
        .ok_or(TextDecorationPaintError::Geometry)?;
    let mut segments = Vec::with_capacity(upper.len() + lower.len() + 2);
    segments.extend(upper.into_iter().map(cubic_segment));
    segments.push(CurveSegment::Line {
        p0: upper_end,
        p1: lower_start,
    });
    segments.extend(lower.into_iter().map(cubic_segment));
    segments.push(CurveSegment::Line {
        p0: lower_end,
        p1: upper_start,
    });
    Ok(Contour {
        segments,
        closed: true,
    })
}

fn pattern_cell_estimate(
    inline_length: f64,
    period: f64,
    maximum_cells: usize,
) -> Result<usize, TextDecorationPaintError> {
    if !inline_length.is_finite() || !period.is_finite() || period <= 0.0 {
        return Err(TextDecorationPaintError::Geometry);
    }
    let required_cells = (inline_length / period).ceil() + 2.0;
    if !required_cells.is_finite() || required_cells > maximum_cells as f64 {
        return Err(TextDecorationPaintError::PatternLimit);
    }
    let mut estimate = 2_usize;
    let mut covered = 0.0;
    while covered < inline_length {
        if estimate >= maximum_cells {
            return Err(TextDecorationPaintError::PatternLimit);
        }
        let next = covered + period;
        if next <= covered {
            return Err(TextDecorationPaintError::Geometry);
        }
        covered = next;
        estimate += 1;
    }
    Ok(estimate)
}

fn rectangle_region(min_inline: f64, max_inline: f64, min_cross: f64, max_cross: f64) -> Region {
    let top_left = Point2D {
        x: min_inline,
        y: min_cross,
    };
    let top_right = Point2D {
        x: max_inline,
        y: min_cross,
    };
    let bottom_right = Point2D {
        x: max_inline,
        y: max_cross,
    };
    let bottom_left = Point2D {
        x: min_inline,
        y: max_cross,
    };
    Region {
        contours: vec![Contour {
            segments: vec![
                line_segment(top_left, top_right),
                line_segment(top_right, bottom_right),
                line_segment(bottom_right, bottom_left),
                line_segment(bottom_left, top_left),
            ],
            closed: true,
        }],
    }
}

fn circle_region(center_inline: f64, radius: f64) -> Region {
    const CIRCLE_KAPPA: f64 = 0.552_284_749_830_793_6;
    let control = radius * CIRCLE_KAPPA;
    let right = Point2D {
        x: center_inline + radius,
        y: 0.0,
    };
    let bottom = Point2D {
        x: center_inline,
        y: radius,
    };
    let left = Point2D {
        x: center_inline - radius,
        y: 0.0,
    };
    let top = Point2D {
        x: center_inline,
        y: -radius,
    };
    Region {
        contours: vec![Contour {
            segments: vec![
                cubic_segment(CubicPoints {
                    p0: right,
                    p1: Point2D {
                        x: right.x,
                        y: control,
                    },
                    p2: Point2D {
                        x: bottom.x + control,
                        y: bottom.y,
                    },
                    p3: bottom,
                }),
                cubic_segment(CubicPoints {
                    p0: bottom,
                    p1: Point2D {
                        x: bottom.x - control,
                        y: bottom.y,
                    },
                    p2: Point2D {
                        x: left.x,
                        y: control,
                    },
                    p3: left,
                }),
                cubic_segment(CubicPoints {
                    p0: left,
                    p1: Point2D {
                        x: left.x,
                        y: -control,
                    },
                    p2: Point2D {
                        x: top.x - control,
                        y: top.y,
                    },
                    p3: top,
                }),
                cubic_segment(CubicPoints {
                    p0: top,
                    p1: Point2D {
                        x: top.x + control,
                        y: top.y,
                    },
                    p2: Point2D {
                        x: right.x,
                        y: -control,
                    },
                    p3: right,
                }),
            ],
            closed: true,
        }],
    }
}

fn clipped_circle_region(
    center_inline: f64,
    radius: f64,
    clip_min: f64,
    clip_max: f64,
) -> Result<Region, TextDecorationPaintError> {
    let circle = circle_region(center_inline, radius);
    clip_monotonic_region_to_axis_interval(&circle, RegionAxis::X, clip_min, clip_max)
        .map_err(|_| TextDecorationPaintError::Geometry)
}

#[derive(Debug, Clone, Copy)]
struct CubicPoints {
    p0: Point2D,
    p1: Point2D,
    p2: Point2D,
    p3: Point2D,
}

fn wave_quarter(
    quarter_index: usize,
    start: f64,
    end: f64,
    amplitude: f64,
    wavelength: f64,
) -> CubicPoints {
    let slope = amplitude * std::f64::consts::TAU / wavelength;
    let (start_y, end_y, start_slope, end_slope) = match quarter_index {
        0 => (0.0, amplitude, slope, 0.0),
        1 => (amplitude, 0.0, 0.0, -slope),
        2 => (0.0, -amplitude, -slope, 0.0),
        _ => (-amplitude, 0.0, 0.0, slope),
    };
    let control_advance = (end - start) / 3.0;
    CubicPoints {
        p0: Point2D {
            x: start,
            y: start_y,
        },
        p1: Point2D {
            x: start + control_advance,
            y: start_y + start_slope * control_advance,
        },
        p2: Point2D {
            x: end - control_advance,
            y: end_y - end_slope * control_advance,
        },
        p3: Point2D { x: end, y: end_y },
    }
}

fn cubic_subsegment(cubic: CubicPoints, t0: f64, t1: f64) -> CubicPoints {
    let (left, _) = split_cubic(cubic, t1.clamp(0.0, 1.0));
    if t0 <= 0.0 {
        return left;
    }
    let relative = (t0 / t1).clamp(0.0, 1.0);
    split_cubic(left, relative).1
}

fn split_cubic(cubic: CubicPoints, t: f64) -> (CubicPoints, CubicPoints) {
    let p01 = lerp_point(cubic.p0, cubic.p1, t);
    let p12 = lerp_point(cubic.p1, cubic.p2, t);
    let p23 = lerp_point(cubic.p2, cubic.p3, t);
    let p012 = lerp_point(p01, p12, t);
    let p123 = lerp_point(p12, p23, t);
    let middle = lerp_point(p012, p123, t);
    (
        CubicPoints {
            p0: cubic.p0,
            p1: p01,
            p2: p012,
            p3: middle,
        },
        CubicPoints {
            p0: middle,
            p1: p123,
            p2: p23,
            p3: cubic.p3,
        },
    )
}

fn lerp_point(left: Point2D, right: Point2D, t: f64) -> Point2D {
    Point2D {
        x: left.x + (right.x - left.x) * t,
        y: left.y + (right.y - left.y) * t,
    }
}

fn offset_cubic(mut cubic: CubicPoints, cross_offset: f64) -> CubicPoints {
    cubic.p0.y += cross_offset;
    cubic.p1.y += cross_offset;
    cubic.p2.y += cross_offset;
    cubic.p3.y += cross_offset;
    cubic
}

fn reverse_cubic(cubic: CubicPoints) -> CubicPoints {
    CubicPoints {
        p0: cubic.p3,
        p1: cubic.p2,
        p2: cubic.p1,
        p3: cubic.p0,
    }
}

fn cubic_segment(cubic: CubicPoints) -> CurveSegment {
    CurveSegment::Cubic {
        p0: cubic.p0,
        p1: cubic.p1,
        p2: cubic.p2,
        p3: cubic.p3,
    }
}

fn line_segment(p0: Point2D, p1: Point2D) -> CurveSegment {
    CurveSegment::Line { p0, p1 }
}

fn map_region_to_physical(region: &Region, vertical: bool) -> Region {
    if !vertical {
        return region.clone();
    }
    Region {
        contours: region
            .contours
            .iter()
            .map(|contour| Contour {
                segments: contour
                    .segments
                    .iter()
                    .map(map_segment_to_vertical)
                    .collect(),
                closed: contour.closed,
            })
            .collect(),
    }
}

fn map_segment_to_vertical(segment: &CurveSegment) -> CurveSegment {
    match segment {
        CurveSegment::Line { p0, p1 } => line_segment(swap_point(*p0), swap_point(*p1)),
        CurveSegment::Quad { p0, p1, p2 } => CurveSegment::Quad {
            p0: swap_point(*p0),
            p1: swap_point(*p1),
            p2: swap_point(*p2),
        },
        CurveSegment::Cubic { p0, p1, p2, p3 } => CurveSegment::Cubic {
            p0: swap_point(*p0),
            p1: swap_point(*p1),
            p2: swap_point(*p2),
            p3: swap_point(*p3),
        },
    }
}

fn swap_point(point: Point2D) -> Point2D {
    Point2D {
        x: point.y,
        y: point.x,
    }
}

fn region_complexity(region: &Region) -> (usize, usize) {
    let contour_count = region
        .contours
        .iter()
        .filter(|contour| !contour.segments.is_empty())
        .count();
    let segment_count = region
        .contours
        .iter()
        .map(|contour| contour.segments.len())
        .sum();
    (contour_count, segment_count)
}

#[cfg(test)]
mod tests {
    use crate::font::{FontContext, FontRegistry, FontStyle};
    use crate::text::engine::{layout_text, layout_text_with_unit_metadata};
    use crate::text::types::{
        FitMode, Language, Line, PositionedGlyph, RichTextNodeInput, RichTextStyleInput, TextBBox,
        TextDecorationInput, TextDecorationLine, TextDecorationSkipInk, TextDecorationStyle,
        TextLayoutRequest, TextLayoutResult, TextOrientation, TextOverflow, TextSpanInput,
        WhiteSpaceMode, WrapMode, WritingMode,
    };
    use boundshape::{
        CurveSegment, GeometryDoc, GeometryNode, GeometryViewBox, Region, evaluate_geometry,
        region_axis_bounds,
    };

    fn registry() -> FontRegistry {
        let mut registry = FontRegistry::new();
        registry
            .register(
                std::fs::read(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
                ))
                .expect("font"),
                "NotoSansJP".to_string(),
                400,
                FontStyle::Normal,
            )
            .expect("register font");
        registry
    }

    fn registry_without_decoration_metrics() -> FontRegistry {
        let mut font_data = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("font");
        let table_count = usize::from(u16::from_be_bytes([font_data[4], font_data[5]]));
        for table_index in 0..table_count {
            let tag_offset = 12 + table_index * 16;
            let tag = &font_data[tag_offset..tag_offset + 4];
            if tag == b"post" {
                font_data[tag_offset..tag_offset + 4].copy_from_slice(b"p0st");
            } else if tag == b"OS/2" {
                font_data[tag_offset..tag_offset + 4].copy_from_slice(b"0S/2");
            }
        }
        let mut registry = FontRegistry::new();
        registry
            .register(
                font_data,
                "NoDecorationMetrics".to_string(),
                400,
                FontStyle::Normal,
            )
            .expect("register font without decoration metrics");
        registry
    }

    fn decoration(
        line: Vec<TextDecorationLine>,
        style: TextDecorationStyle,
    ) -> TextDecorationInput {
        TextDecorationInput {
            line,
            color: "#d12f4a".to_string(),
            style,
            thickness_px: Some(2.0),
            offset_px: 0.0,
            skip_ink: TextDecorationSkipInk::None,
        }
    }

    fn span(text: &str, text_decoration: Option<TextDecorationInput>) -> TextSpanInput {
        TextSpanInput {
            text: text.to_string(),
            font_family: vec!["NotoSansJP".to_string()],
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px: 32.0,
            letter_spacing_px: Some(0.0),
            language: Some("en".to_string()),
            text_orientation: None,
            color: Some("#111111".to_string()),
            text_strokes: None,
            text_shadows: None,
            font_variation_settings: None,
            font_feature_settings: None,
            text_decoration,
            decoration_transport_only: false,
        }
    }

    fn rich_style(text_decoration: Option<TextDecorationInput>) -> RichTextStyleInput {
        RichTextStyleInput {
            font_family: vec!["NotoSansJP".to_string()],
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px: 32.0,
            line_height: Some(1.2),
            line_height_px: None,
            letter_spacing_px: Some(0.0),
            language: Some("en".to_string()),
            color: Some("#111111".to_string()),
            text_strokes: None,
            text_shadows: None,
            font_variation_settings: None,
            font_feature_settings: None,
            text_orientation: None,
            text_decoration,
        }
    }

    fn request<'a>(
        text: &'a str,
        spans: &'a [TextSpanInput],
        rich_text: Option<&'a [RichTextNodeInput]>,
        writing_mode: WritingMode,
    ) -> TextLayoutRequest<'a> {
        TextLayoutRequest {
            text,
            spans: Some(spans),
            rich_text,
            font_size_px: 32.0,
            line_height: Some(1.2),
            line_height_px: None,
            letter_spacing_px: 0.0,
            text_indent: None,
            max_width: 500.0,
            max_height: Some(500.0),
            wrap: WrapMode::Char,
            white_space: WhiteSpaceMode::Normal,
            tab_size: 4,
            fit: FitMode::None,
            max_lines: None,
            ellipsis: false,
            language: Language::En,
            writing_mode,
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

    fn paint_path_bbox(path: &crate::text::types::TextDecorationPaintPath) -> (f64, f64, f64, f64) {
        let region = evaluate_geometry(&GeometryDoc {
            view_box: GeometryViewBox {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            root: GeometryNode::Path {
                node_id: None,
                d: path.d.clone(),
                fill_rule: None,
            },
        })
        .expect("decoration path geometry");
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        for segment in region.contours.iter().flat_map(|contour| &contour.segments) {
            for sample_index in 0..=1_000 {
                let t = f64::from(sample_index) / 1_000.0;
                let point = match segment {
                    CurveSegment::Line { p0, p1 } => super::lerp_point(*p0, *p1, t),
                    CurveSegment::Quad { p0, p1, p2 } => {
                        let left = super::lerp_point(*p0, *p1, t);
                        let right = super::lerp_point(*p1, *p2, t);
                        super::lerp_point(left, right, t)
                    }
                    CurveSegment::Cubic { p0, p1, p2, p3 } => {
                        let left = super::lerp_point(*p0, *p1, t);
                        let middle = super::lerp_point(*p1, *p2, t);
                        let right = super::lerp_point(*p2, *p3, t);
                        let left_middle = super::lerp_point(left, middle, t);
                        let middle_right = super::lerp_point(middle, right, t);
                        super::lerp_point(left_middle, middle_right, t)
                    }
                };
                min_x = min_x.min(point.x + path.origin_x);
                min_y = min_y.min(point.y + path.origin_y);
                max_x = max_x.max(point.x + path.origin_x);
                max_y = max_y.max(point.y + path.origin_y);
            }
        }
        (min_x, min_y, max_x, max_y)
    }

    fn pattern_path(
        style: TextDecorationStyle,
        inline_start: f64,
        inline_end: f64,
        phase_origin_inline: f64,
        vertical: bool,
    ) -> crate::text::types::TextDecorationPaintPath {
        super::build_paint_path(
            &super::PendingStrip {
                line_index: 0,
                line: TextDecorationLine::Underline,
                inline_start,
                inline_end,
                phase_origin_inline,
                center: 10.0,
                thickness_px: 2.0,
                color: "#111111".to_string(),
                vertical,
            },
            style,
            super::MAX_TEXT_DECORATION_PATTERN_CONTOURS,
            super::MAX_TEXT_DECORATION_PATTERN_SEGMENTS,
        )
        .expect("pattern geometry")
    }

    #[test]
    fn pattern_cells_follow_the_locked_thickness_ratios() {
        let dotted = pattern_path(TextDecorationStyle::Dotted, 0.0, 20.0, 0.0, false);
        assert_eq!(dotted.contour_count, 5);
        assert_eq!(dotted.segment_count, 20);
        let (_, dotted_min_y, _, dotted_max_y) = paint_path_bbox(&dotted);
        assert!((dotted_max_y - dotted_min_y - 2.0).abs() < 0.001);
        let clipped_dot = pattern_path(TextDecorationStyle::Dotted, 0.0, 1.0, 0.0, false);
        let (clipped_min_x, _, clipped_max_x, _) = paint_path_bbox(&clipped_dot);
        assert!(
            (clipped_min_x - 0.0).abs() < 0.01,
            "clipped dot minimum {clipped_min_x}: {}",
            clipped_dot.d
        );
        assert!(
            (clipped_max_x - 1.0).abs() < 0.01,
            "clipped dot maximum {clipped_max_x}: {}",
            clipped_dot.d
        );
        let fractional_endpoint =
            pattern_path(TextDecorationStyle::Dotted, 0.0, 93.184, 0.0, false);
        let (fractional_min_x, _, fractional_max_x, _) = paint_path_bbox(&fractional_endpoint);
        assert!((fractional_min_x - 0.0).abs() < 0.01);
        assert!((fractional_max_x - 93.184).abs() < 0.01);

        let dashed = pattern_path(TextDecorationStyle::Dashed, 0.0, 20.0, 0.0, false);
        assert_eq!(dashed.contour_count, 2);
        assert_eq!(dashed.segment_count, 8);

        let wavy = pattern_path(TextDecorationStyle::Wavy, 0.0, 12.0, 0.0, false);
        assert_eq!(wavy.contour_count, 1);
        assert_eq!(wavy.segment_count, 10);
        let (_, wavy_min_y, _, wavy_max_y) = paint_path_bbox(&wavy);
        assert!((wavy_min_y - 6.0).abs() < 0.001);
        assert!((wavy_max_y - 14.0).abs() < 0.001);
    }

    #[test]
    fn long_wavy_pattern_uses_locally_bounded_contours() {
        let region = super::wavy_region(
            120.0,
            0.0,
            2.0,
            super::MAX_TEXT_DECORATION_PATTERN_CONTOURS,
            super::MAX_TEXT_DECORATION_PATTERN_SEGMENTS,
        )
        .expect("long wavy geometry");

        assert_eq!(region.contours.len(), 10);
        for contour in &region.contours {
            let (min_x, _, max_x, _) = region_axis_bounds(&Region {
                contours: vec![contour.clone()],
            })
            .expect("wavy contour bounds");
            assert!(
                max_x - min_x <= 12.001,
                "wavy contour spans {}px",
                max_x - min_x
            );
        }
    }

    #[test]
    fn pattern_phase_uses_the_authored_origin_across_metric_splits() {
        let whole = pattern_path(TextDecorationStyle::Dotted, 0.0, 20.0, 0.0, false);
        let first = pattern_path(TextDecorationStyle::Dotted, 0.0, 10.0, 0.0, false);
        let second = pattern_path(TextDecorationStyle::Dotted, 10.0, 20.0, 0.0, false);

        assert_eq!(
            first.contour_count + second.contour_count,
            whole.contour_count
        );
        assert_eq!(second.origin_x, 10.0);
        let (second_min_x, _, second_max_x, _) = paint_path_bbox(&second);
        assert!((second_min_x - 12.0).abs() < 0.001);
        assert!((second_max_x - 18.0).abs() < 0.001);
    }

    #[test]
    fn vertical_pattern_maps_inline_and_cross_axes_once() {
        let horizontal = pattern_path(TextDecorationStyle::Wavy, 0.0, 12.0, 0.0, false);
        let vertical = pattern_path(TextDecorationStyle::Wavy, 0.0, 12.0, 0.0, true);
        let (horizontal_min_x, horizontal_min_y, horizontal_max_x, horizontal_max_y) =
            paint_path_bbox(&horizontal);
        let (vertical_min_x, vertical_min_y, vertical_max_x, vertical_max_y) =
            paint_path_bbox(&vertical);

        assert!((horizontal_max_x - horizontal_min_x - 12.0).abs() < 0.001);
        assert!((vertical_max_y - vertical_min_y - 12.0).abs() < 0.001);
        assert!(
            ((horizontal_max_y - horizontal_min_y) - (vertical_max_x - vertical_min_x)).abs()
                < 0.001
        );
    }

    #[test]
    fn tiny_pattern_cells_fail_before_unbounded_allocation() {
        let error = super::build_paint_path(
            &super::PendingStrip {
                line_index: 0,
                line: TextDecorationLine::Underline,
                inline_start: 0.0,
                inline_end: 100.0,
                phase_origin_inline: 0.0,
                center: 10.0,
                thickness_px: 1.0e-9,
                color: "#111111".to_string(),
                vertical: false,
            },
            TextDecorationStyle::Dotted,
            super::MAX_TEXT_DECORATION_PATTERN_CONTOURS,
            super::MAX_TEXT_DECORATION_PATTERN_SEGMENTS,
        )
        .expect_err("tiny dots must exceed the pattern budget");

        assert_eq!(
            error,
            crate::text::types::TextDecorationPaintError::PatternLimit
        );
    }

    #[test]
    fn decoration_only_boundary_keeps_ligature_shaping_identical() {
        let registry = registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let underline = decoration(
            vec![TextDecorationLine::Underline],
            TextDecorationStyle::Solid,
        );
        let decorated_spans = vec![span("f", None), span("i", Some(underline.clone()))];
        let decorated_rich = vec![
            RichTextNodeInput::Span {
                text: "f".to_string(),
                style: rich_style(None),
            },
            RichTextNodeInput::Span {
                text: "i".to_string(),
                style: rich_style(Some(underline)),
            },
        ];
        let plain_spans = vec![span("fi", None)];
        let plain_rich = vec![RichTextNodeInput::Span {
            text: "fi".to_string(),
            style: rich_style(None),
        }];

        let decorated = layout_text_with_unit_metadata(
            &request(
                "fi",
                &decorated_spans,
                Some(&decorated_rich),
                WritingMode::HorizontalTb,
            ),
            &font_ctx,
        )
        .expect("decorated layout");
        let plain = layout_text_with_unit_metadata(
            &request(
                "fi",
                &plain_spans,
                Some(&plain_rich),
                WritingMode::HorizontalTb,
            ),
            &font_ctx,
        )
        .expect("plain layout");

        assert_eq!(decorated.lines.len(), plain.lines.len());
        assert_eq!(decorated.lines[0].width, plain.lines[0].width);
        assert_eq!(
            serde_json::to_value(&decorated.unit_map).expect("decorated unit map JSON"),
            serde_json::to_value(&plain.unit_map).expect("plain unit map JSON")
        );
        let decorated_glyphs = decorated.lines[0]
            .positioned_glyphs
            .as_deref()
            .expect("decorated glyphs");
        let plain_glyphs = plain.lines[0]
            .positioned_glyphs
            .as_deref()
            .expect("plain glyphs");
        assert_eq!(
            serde_json::to_value(decorated_glyphs).expect("decorated glyph JSON"),
            serde_json::to_value(plain_glyphs).expect("plain glyph JSON")
        );
        assert_eq!(
            decorated_glyphs.len(),
            1,
            "fixture must exercise an fi ligature"
        );
        assert_eq!(decorated.text_decorations.len(), 1);
        assert_eq!(decorated.text_decorations[0].source_start, 1);
        assert_eq!(decorated.text_decorations[0].source_end, 2);
        let (min_x, _, max_x, _) = paint_path_bbox(&decorated.text_decorations[0].paths[0]);
        assert!(min_x <= 0.01);
        assert!(max_x >= decorated.lines[0].width - 0.01);
    }

    #[test]
    fn double_three_line_decoration_resolves_six_closed_strips() {
        let registry = registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let all_lines = decoration(
            vec![
                TextDecorationLine::Underline,
                TextDecorationLine::Overline,
                TextDecorationLine::LineThrough,
            ],
            TextDecorationStyle::Double,
        );
        let spans = vec![span("Decorated", Some(all_lines))];
        let result = layout_text(
            &request("Decorated", &spans, None, WritingMode::HorizontalTb),
            &font_ctx,
        )
        .expect("layout");

        assert_eq!(result.text_decorations.len(), 3);
        for fragment in &result.text_decorations {
            assert_eq!(fragment.style, TextDecorationStyle::Double);
            assert_eq!(fragment.paths.len(), 2);
            let pair = &fragment.paths;
            assert!((pair[0].origin_y - pair[1].origin_y).abs() >= 3.99);
            for path in pair {
                let (_, min_y, _, max_y) = paint_path_bbox(path);
                assert!((max_y - min_y - 2.0).abs() < 0.001);
            }
        }
    }

    #[test]
    fn vertical_decoration_uses_physical_vertical_segments() {
        let registry = registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let spans = vec![span(
            "AB",
            Some(decoration(
                vec![TextDecorationLine::Underline],
                TextDecorationStyle::Solid,
            )),
        )];
        let result = layout_text(
            &request("AB", &spans, None, WritingMode::VerticalRl),
            &font_ctx,
        )
        .expect("vertical layout");

        assert!(!result.text_decorations.is_empty());
        assert!(
            result
                .text_decorations
                .iter()
                .flat_map(|fragment| &fragment.paths)
                .all(|path| {
                    let (min_x, _, max_x, _) = paint_path_bbox(path);
                    (max_x - min_x - 2.0).abs() < 0.001
                })
        );
    }

    #[test]
    fn text_combine_decoration_uses_one_atomic_vertical_strip() {
        let registry = registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let underline = decoration(
            vec![TextDecorationLine::Underline],
            TextDecorationStyle::Solid,
        );
        let rich_text = vec![RichTextNodeInput::Combine {
            text: "25".to_string(),
            style: rich_style(Some(underline)),
            decoration_runs: Vec::new(),
        }];
        let spans = Vec::new();
        let result = layout_text(
            &request("25", &spans, Some(&rich_text), WritingMode::VerticalRl),
            &font_ctx,
        )
        .expect("vertical text-combine layout");

        let glyphs = result.lines[0]
            .positioned_glyphs
            .as_deref()
            .expect("positioned text-combine glyphs");
        let geometry = glyphs[0]
            .text_decoration_geometry
            .expect("text-combine decoration geometry");
        assert!(glyphs.iter().all(|glyph| {
            glyph.text_decoration_geometry.is_some_and(|candidate| {
                (candidate.inline_start - geometry.inline_start).abs() < 0.001
                    && (candidate.inline_end - geometry.inline_end).abs() < 0.001
                    && (candidate.baseline - geometry.baseline).abs() < 0.001
            })
        }));
        assert_eq!(result.text_decorations.len(), 1);
        assert_eq!(result.text_decorations[0].paths.len(), 1);
        let path = &result.text_decorations[0].paths[0];
        let (_, min_y, _, max_y) = paint_path_bbox(path);
        assert!((min_y - geometry.inline_start).abs() < 0.001);
        assert!((max_y - geometry.inline_end).abs() < 0.001);
        assert!((max_y - min_y - 32.0).abs() < 0.001);
    }

    #[test]
    fn inherited_decoration_stays_continuous_through_text_combine() {
        let registry = registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let underline = decoration(
            vec![TextDecorationLine::Underline],
            TextDecorationStyle::Solid,
        );
        let rich_text = vec![
            RichTextNodeInput::Span {
                text: "年".to_string(),
                style: rich_style(Some(underline.clone())),
            },
            RichTextNodeInput::Combine {
                text: "2025".to_string(),
                style: rich_style(Some(underline.clone())),
                decoration_runs: Vec::new(),
            },
            RichTextNodeInput::Span {
                text: "月".to_string(),
                style: rich_style(Some(underline)),
            },
        ];
        let spans = Vec::new();
        let result = layout_text(
            &request(
                "年2025月",
                &spans,
                Some(&rich_text),
                WritingMode::VerticalRl,
            ),
            &font_ctx,
        )
        .expect("decorated vertical text-combine layout");

        let paths: Vec<_> = result
            .text_decorations
            .iter()
            .flat_map(|fragment| &fragment.paths)
            .collect();
        assert_eq!(paths.len(), 1);
        let (_, min_y, _, max_y) = paint_path_bbox(paths[0]);
        assert!((max_y - min_y - 96.0).abs() < 0.001);
    }

    #[test]
    fn decoration_boundary_on_combining_mark_rounds_to_global_grapheme() {
        let registry = registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let underline = decoration(
            vec![TextDecorationLine::Underline],
            TextDecorationStyle::Solid,
        );
        let decorated_spans = vec![span("e", None), span("\u{301}", Some(underline))];
        let plain_spans = vec![span("e\u{301}", None)];

        let decorated = layout_text_with_unit_metadata(
            &request(
                "e\u{301}",
                &decorated_spans,
                None,
                WritingMode::HorizontalTb,
            ),
            &font_ctx,
        )
        .expect("decorated combining layout");
        let plain = layout_text_with_unit_metadata(
            &request("e\u{301}", &plain_spans, None, WritingMode::HorizontalTb),
            &font_ctx,
        )
        .expect("plain combining layout");

        assert_eq!(
            serde_json::to_value(&decorated.lines).expect("decorated lines JSON"),
            serde_json::to_value(&plain.lines).expect("plain lines JSON")
        );
        assert_eq!(decorated.text_decorations.len(), 1);
        #[cfg(feature = "unicode-full")]
        {
            assert_eq!(decorated.text_decorations[0].source_start, 0);
            assert_eq!(decorated.text_decorations[0].source_end, 1);
        }
        #[cfg(not(feature = "unicode-full"))]
        {
            assert_eq!(decorated.text_decorations[0].source_start, 1);
            assert_eq!(decorated.text_decorations[0].source_end, 2);
        }
    }

    #[test]
    fn overlapping_rounded_ranges_with_the_same_decoration_merge() {
        let registry = registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let underline = decoration(
            vec![TextDecorationLine::Underline],
            TextDecorationStyle::Solid,
        );
        let spans = vec![
            span("e", Some(underline.clone())),
            span("\u{301}", Some(underline)),
        ];

        let result = layout_text(
            &request("e\u{301}", &spans, None, WritingMode::HorizontalTb),
            &font_ctx,
        )
        .expect("combining layout");

        assert_eq!(result.text_decorations.len(), 1);
        assert_eq!(result.text_decorations[0].paths.len(), 1);
    }

    #[test]
    fn missing_font_metrics_use_fixed_fallback_geometry() {
        let registry = registry_without_decoration_metrics();
        let families = vec!["NoDecorationMetrics".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let spans = vec![TextSpanInput {
            font_family: families.clone(),
            text_decoration: Some(TextDecorationInput {
                line: vec![TextDecorationLine::Underline],
                color: "#111111".to_string(),
                style: TextDecorationStyle::Solid,
                thickness_px: None,
                offset_px: 0.0,
                skip_ink: TextDecorationSkipInk::None,
            }),
            ..span("AB", None)
        }];
        let result = layout_text(
            &request("AB", &spans, None, WritingMode::HorizontalTb),
            &font_ctx,
        )
        .expect("fallback metric layout");
        let path = &result.text_decorations[0].paths[0];
        let (_, min_y, _, max_y) = paint_path_bbox(path);

        assert!((max_y - min_y - 2.0).abs() < 0.001);
        assert!((path.origin_y - (result.lines[0].baseline_y + 3.2)).abs() < 0.001);
    }

    #[test]
    fn font_metric_thickness_is_not_clamped_to_the_fallback_minimum() {
        let registry = registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let mut decorated_span = span(
            "AB",
            Some(TextDecorationInput {
                line: vec![TextDecorationLine::Underline],
                color: "#111111".to_string(),
                style: TextDecorationStyle::Solid,
                thickness_px: None,
                offset_px: 0.0,
                skip_ink: TextDecorationSkipInk::None,
            }),
        );
        decorated_span.font_size_px = 8.0;
        let spans = vec![decorated_span];
        let mut layout_request = request("AB", &spans, None, WritingMode::HorizontalTb);
        layout_request.font_size_px = 8.0;
        let result = layout_text(&layout_request, &font_ctx).expect("small-font metric layout");
        let (_, min_y, _, max_y) = paint_path_bbox(&result.text_decorations[0].paths[0]);
        let thickness_px = max_y - min_y;

        assert!(thickness_px > 0.0);
        assert!(thickness_px < 1.0);
    }

    #[test]
    fn resolved_path_budget_retains_only_one_overflow_sentinel() {
        let registry = registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let glyph_count = super::MAX_TEXT_DECORATION_PATHS + 32;
        let content = "a".repeat(glyph_count);
        let spans = vec![span(
            &content,
            Some(decoration(
                vec![TextDecorationLine::Underline],
                TextDecorationStyle::Solid,
            )),
        )];
        let positioned_glyphs = (0..glyph_count)
            .map(|index| {
                let source_start = u32::try_from(index).unwrap_or(u32::MAX);
                let source_end = u32::try_from(index + 1).unwrap_or(u32::MAX);
                PositionedGlyph {
                    glyph_id: 66,
                    text: "a".to_string(),
                    cluster_start: source_start,
                    cluster_end: source_end,
                    source_start: Some(source_start),
                    source_end: Some(source_end),
                    source_role: Some("content".to_string()),
                    decoration_source_start: Some(source_start),
                    decoration_source_end: Some(source_end),
                    decoration_level: None,
                    path_decoration_owner_id: None,
                    path_distance_start_px: None,
                    path_distance_end_px: None,
                    text_decoration_geometry: None,
                    font_alias: "NotoSansJP".to_string(),
                    font_fallback: Vec::new(),
                    font_weight: 400,
                    font_style: FontStyle::Normal,
                    font_size_px: Some(if index % 2 == 0 { 16.0 } else { 32.0 }),
                    font_variation_settings: None,
                    font_feature_settings: None,
                    fill: None,
                    text_strokes: None,
                    text_shadows: None,
                    paint_range_index: None,
                    origin_x: f64::from(source_start),
                    origin_y: 32.0,
                    x_offset: 0.0,
                    y_offset: 0.0,
                    x_advance: 1.0,
                    y_advance: 0.0,
                    rotation_deg: 0,
                    baseline_rotation_deg: None,
                    inline_scale: None,
                    synthetic_kind: None,
                    outline_writing_mode: None,
                    absolute_position: None,
                }
            })
            .collect();
        let glyph_count_px = f64::from(u32::try_from(glyph_count).unwrap_or(u32::MAX));
        let mut result = TextLayoutResult {
            lines: vec![Line {
                text: content.clone(),
                glyphs: Vec::new(),
                width: glyph_count_px,
                baseline_y: 32.0,
                fragments: None,
                positioned_glyphs: Some(positioned_glyphs),
            }],
            bbox: TextBBox {
                x: 0.0,
                y: 0.0,
                w: glyph_count_px,
                h: 40.0,
            },
            chosen_font_size_px: 32.0,
            overflow: TextOverflow::none(),
            source_text: None,
            display_text: None,
            unit_map: None,
            warnings: Vec::new(),
            inline_box_decorations: Vec::new(),
            text_decorations: Vec::new(),
            inline_rects: Vec::new(),
        };

        super::resolve_text_decorations(
            &request(&content, &spans, None, WritingMode::HorizontalTb),
            &font_ctx,
            &mut result,
        );
        let path_count = result
            .text_decorations
            .iter()
            .map(|fragment| fragment.paths.len())
            .sum::<usize>();

        assert_eq!(path_count, 1);
        assert_eq!(
            result.text_decorations[0].paths[0].error,
            Some(crate::text::types::TextDecorationPaintError::ComplexityLimit)
        );
    }
}
