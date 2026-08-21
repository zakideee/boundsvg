//! Ellipsis truncation for text layout.
//!
//! Uses binary search on grapheme count to find the best truncation point,
//! then refines the boundary with a small linear scan.

use super::grapheme::grapheme_split;
use super::kinsoku::{KinsokuProfile, is_valid_ellipsis_boundary};
use super::types::Line;
use crate::font::FontContext;
use crate::font::shaping::{self, GlyphInfo, ShapeOptions};
use crate::font::{FontEntry, FontRegistry, FontStyle};

/// Ellipsis character.
const ELLIPSIS: &str = "\u{2026}"; // "…"
/// Linear refinement window around the binary search boundary.
const REFINE_WINDOW: usize = 2;

fn total_advance(glyphs: &[GlyphInfo]) -> f64 {
    glyphs.iter().map(|g| g.x_advance).sum()
}

fn synthetic_ellipsis_cluster_start(text: &str) -> u32 {
    u32::try_from(text.len().saturating_sub(ELLIPSIS.len())).unwrap_or(u32::MAX)
}

fn is_synthetic_ellipsis_glyph(glyph: &super::types::PositionedGlyph, cluster_start: u32) -> bool {
    glyph.cluster_end > cluster_start
}

fn build_ellipsis_line(
    text: String,
    glyphs: Vec<GlyphInfo>,
    width: f64,
    baseline_y: f64,
    ellipsis_source_start: usize,
    ellipsis_source_end: usize,
    include_unit_metadata: bool,
) -> Line {
    let positioned_glyphs = if include_unit_metadata {
        let mut positioned_glyphs =
            super::engine::build_positioned_glyphs_for_text(&glyphs, &text, baseline_y);
        let source_start = u32::try_from(ellipsis_source_start).unwrap_or(u32::MAX);
        let source_end = u32::try_from(ellipsis_source_end).unwrap_or(u32::MAX);
        let ellipsis_cluster_start = synthetic_ellipsis_cluster_start(&text);
        for glyph in &mut positioned_glyphs {
            if is_synthetic_ellipsis_glyph(glyph, ellipsis_cluster_start) {
                glyph.source_start = Some(source_start);
                glyph.source_end = Some(source_end);
            }
        }
        Some(positioned_glyphs)
    } else {
        None
    };
    Line {
        text,
        glyphs,
        width,
        baseline_y,
        fragments: None,
        positioned_glyphs,
    }
}

#[derive(Clone, Copy)]
struct EllipsisSourceSegment {
    local_source_start: u32,
    local_source_end: u32,
    source_start: u32,
    source_end: u32,
    local_cluster_start: u32,
    local_cluster_end: u32,
    cluster_start: u32,
    cluster_end: u32,
}

#[derive(Clone, Copy)]
enum EllipsisCoordinate {
    Source,
    Cluster,
}

fn build_ellipsis_source_segments(lines: &[Line]) -> Option<Vec<EllipsisSourceSegment>> {
    // Line builders keep source and cluster coordinates contiguous inside a
    // line. Forced separators may create gaps only between lines, which is
    // why each line is represented by a separate affine segment here.
    // Ligatures and reordered glyphs can span multiple coordinates, but their
    // endpoints still obey this line-level invariant.
    let mut segments = Vec::with_capacity(lines.len());
    let mut local_source_start = 0_u32;
    let mut local_cluster_start = 0_u32;
    for line in lines {
        let source_length = u32::try_from(grapheme_split(&line.text).len()).unwrap_or(u32::MAX);
        let cluster_length = u32::try_from(line.text.len()).unwrap_or(u32::MAX);
        let local_source_end = local_source_start.saturating_add(source_length);
        let local_cluster_end = local_cluster_start.saturating_add(cluster_length);
        if !line.text.is_empty() {
            let positioned_glyphs = line.positioned_glyphs.as_ref()?;
            if positioned_glyphs.is_empty()
                || positioned_glyphs
                    .iter()
                    .any(|glyph| glyph.source_start.is_none() || glyph.source_end.is_none())
            {
                return None;
            }
            let source_start = positioned_glyphs
                .iter()
                .filter_map(|glyph| glyph.source_start)
                .min();
            let source_end = positioned_glyphs
                .iter()
                .filter_map(|glyph| glyph.source_end)
                .max();
            let cluster_start = positioned_glyphs
                .iter()
                .map(|glyph| glyph.cluster_start)
                .min();
            let cluster_end = positioned_glyphs
                .iter()
                .map(|glyph| glyph.cluster_end)
                .max();
            let source_start = source_start?;
            let source_end = source_end?;
            let cluster_start = cluster_start?;
            let cluster_end = cluster_end?;
            segments.push(EllipsisSourceSegment {
                local_source_start,
                local_source_end,
                source_start,
                source_end,
                local_cluster_start,
                local_cluster_end,
                cluster_start,
                cluster_end,
            });
        }
        local_source_start = local_source_end;
        local_cluster_start = local_cluster_end;
    }
    Some(segments)
}

fn segment_ranges(
    segment: EllipsisSourceSegment,
    coordinate: EllipsisCoordinate,
) -> (u32, u32, u32, u32) {
    match coordinate {
        EllipsisCoordinate::Source => (
            segment.local_source_start,
            segment.local_source_end,
            segment.source_start,
            segment.source_end,
        ),
        EllipsisCoordinate::Cluster => (
            segment.local_cluster_start,
            segment.local_cluster_end,
            segment.cluster_start,
            segment.cluster_end,
        ),
    }
}

fn remap_ellipsis_offset(
    local_offset: u32,
    segments: &[EllipsisSourceSegment],
    coordinate: EllipsisCoordinate,
    prefer_previous_at_boundary: bool,
) -> u32 {
    let mut previous_global_end = None;
    for segment in segments {
        let (local_start, local_end, global_start, global_end) =
            segment_ranges(*segment, coordinate);
        if local_offset < local_start {
            return previous_global_end.unwrap_or(global_start);
        }
        if local_offset == local_start {
            return if prefer_previous_at_boundary {
                previous_global_end.unwrap_or(global_start)
            } else {
                global_start
            };
        }
        if local_offset < local_end {
            return global_start
                .saturating_add(local_offset.saturating_sub(local_start))
                .min(global_end);
        }
        if local_offset == local_end && prefer_previous_at_boundary {
            return global_end;
        }
        previous_global_end = Some(global_end);
    }
    previous_global_end.unwrap_or(local_offset)
}

fn remap_ellipsis_line_sources(line: &mut Line, segments: &[EllipsisSourceSegment]) {
    let ellipsis_cluster_start = synthetic_ellipsis_cluster_start(&line.text);
    let Some(positioned_glyphs) = line.positioned_glyphs.as_mut() else {
        return;
    };
    let source_end = segments
        .iter()
        .map(|segment| segment.source_end)
        .max()
        .unwrap_or(0);
    let cluster_end = segments
        .iter()
        .map(|segment| segment.cluster_end)
        .max()
        .unwrap_or(0);
    for glyph in positioned_glyphs {
        let is_ellipsis = is_synthetic_ellipsis_glyph(glyph, ellipsis_cluster_start);
        glyph.source_start = glyph.source_start.map(|start| {
            remap_ellipsis_offset(start, segments, EllipsisCoordinate::Source, is_ellipsis)
        });
        glyph.source_end = glyph.source_end.map(|end| {
            if is_ellipsis {
                source_end
            } else {
                remap_ellipsis_offset(end, segments, EllipsisCoordinate::Source, true)
            }
        });
        glyph.cluster_start = remap_ellipsis_offset(
            glyph.cluster_start,
            segments,
            EllipsisCoordinate::Cluster,
            is_ellipsis,
        );
        glyph.cluster_end = if is_ellipsis {
            cluster_end
        } else {
            remap_ellipsis_offset(
                glyph.cluster_end,
                segments,
                EllipsisCoordinate::Cluster,
                true,
            )
        };
    }
}

fn resolve_font<'a>(
    font_registry: &'a FontRegistry,
    fallback_registry: Option<&'a FontRegistry>,
    aliases: &[String],
    weight: u16,
    style: &FontStyle,
) -> Option<&'a FontEntry> {
    if let Some(entry) = font_registry.resolve_chain(aliases, weight, style) {
        return Some(entry);
    }
    if let Some(fallback) = fallback_registry {
        return fallback.resolve_chain(aliases, weight, style);
    }
    None
}

fn shape_text(
    font_ctx: &FontContext<'_>,
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
    options: &ShapeOptions,
) -> Option<Vec<GlyphInfo>> {
    if text.is_empty() {
        return Some(Vec::new());
    }
    if font_ctx.families.len() > 1 {
        let result = shaping::shape_with_fallback_and_options(
            font_ctx,
            text,
            font_size_px,
            letter_spacing_px,
            options,
        );
        if !result.glyphs.is_empty() {
            return Some(result.glyphs);
        }
        if let Some(fallback) = font_ctx.fallback_registry {
            let fallback_ctx = FontContext {
                registry: fallback,
                fallback_registry: None,
                families: font_ctx.families,
                weight: font_ctx.weight,
                style: font_ctx.style,
            };
            let result = shaping::shape_with_fallback_and_options(
                &fallback_ctx,
                text,
                font_size_px,
                letter_spacing_px,
                options,
            );
            if !result.glyphs.is_empty() {
                return Some(result.glyphs);
            }
        }
    }
    let font_entry = resolve_font(
        font_ctx.registry,
        font_ctx.fallback_registry,
        font_ctx.families,
        font_ctx.weight,
        font_ctx.style,
    )?;
    Some(shaping::shape_text_with_options(
        font_ctx.registry,
        font_entry,
        text,
        font_size_px,
        letter_spacing_px,
        options,
    ))
}

fn total_vertical_advance(glyphs: &[GlyphInfo]) -> f64 {
    glyphs
        .iter()
        .map(|g| {
            let y = g.y_advance.abs();
            if y > 0.0 { y } else { g.x_advance.abs() }
        })
        .sum()
}

/// Shape text and return its total advance in pixels.
///
/// Used by the flow-layout ellipsis path to verify that `prefix + "…"` fits
/// within the region after the binary search produces an approximate candidate.
/// When `vertical` is true, sums vertical advances (`y_advance` with `x_advance`
/// fallback) instead of horizontal `x_advance`.
#[must_use]
pub fn measure_text_advance(
    font_ctx: &FontContext<'_>,
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
    options: &ShapeOptions,
    vertical: bool,
) -> Option<f64> {
    let glyphs = shape_text(font_ctx, text, font_size_px, letter_spacing_px, options)?;
    Some(if vertical {
        total_vertical_advance(&glyphs)
    } else {
        total_advance(&glyphs)
    })
}

/// Shape the "…" character and return its advance in pixels.
///
/// When `vertical` is true, returns the vertical advance.
#[must_use]
pub fn shape_ellipsis_advance_with_options(
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    letter_spacing_px: f64,
    options: &ShapeOptions,
    vertical: bool,
) -> Option<f64> {
    let glyphs = shape_text(font_ctx, ELLIPSIS, font_size_px, letter_spacing_px, options)?;
    Some(if vertical {
        total_vertical_advance(&glyphs)
    } else {
        total_advance(&glyphs)
    })
}

/// Apply ellipsis truncation to a single line that overflows.
///
/// Uses binary search on grapheme count to find the maximum `keep` value
/// where `prefix + "…"` fits within `max_width`, then refines the boundary
/// with a `REFINE_WINDOW`-wide linear scan. Shaping count is O(log N + `REFINE_WINDOW`).
/// When a kinsoku profile is given, the truncation point backs up past
/// tail-prohibited characters (e.g. "（" must not precede "…").
///
/// Returns the truncated line, or None if the text already fits.
#[must_use]
pub fn apply_ellipsis(
    text: &str,
    max_width: f64,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    letter_spacing_px: f64,
    line_height_px: f64,
    baseline_offset_px: f64,
    kinsoku_profile: Option<&KinsokuProfile>,
    options: &ShapeOptions,
) -> Option<Line> {
    apply_ellipsis_internal(
        text,
        max_width,
        font_ctx,
        font_size_px,
        letter_spacing_px,
        line_height_px,
        baseline_offset_px,
        kinsoku_profile,
        options,
        false,
    )
}

#[must_use]
pub(crate) fn apply_ellipsis_with_unit_metadata(
    text: &str,
    max_width: f64,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    letter_spacing_px: f64,
    line_height_px: f64,
    baseline_offset_px: f64,
    kinsoku_profile: Option<&KinsokuProfile>,
    options: &ShapeOptions,
) -> Option<Line> {
    apply_ellipsis_internal(
        text,
        max_width,
        font_ctx,
        font_size_px,
        letter_spacing_px,
        line_height_px,
        baseline_offset_px,
        kinsoku_profile,
        options,
        true,
    )
}

fn apply_ellipsis_internal(
    text: &str,
    max_width: f64,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    letter_spacing_px: f64,
    _line_height_px: f64,
    baseline_offset_px: f64,
    kinsoku_profile: Option<&KinsokuProfile>,
    options: &ShapeOptions,
    include_unit_metadata: bool,
) -> Option<Line> {
    let full_glyphs = shape_text(font_ctx, text, font_size_px, letter_spacing_px, options)?;
    let full_width = total_advance(&full_glyphs);

    if full_width <= max_width {
        return None; // No truncation needed
    }

    let ellipsis_glyphs = shape_text(font_ctx, ELLIPSIS, font_size_px, letter_spacing_px, options)?;
    let ellipsis_width = total_advance(&ellipsis_glyphs);

    let graphemes = grapheme_split(text);
    let total = graphemes.len();

    if total == 0 {
        return Some(build_ellipsis_line(
            ELLIPSIS.to_string(),
            ellipsis_glyphs,
            ellipsis_width,
            baseline_offset_px,
            0,
            0,
            include_unit_metadata,
        ));
    }

    // Binary search: find the largest `keep` in [0, total] where prefix+ELLIPSIS fits.
    // Monotonicity assumption: fewer kept graphemes → narrower width.
    let mut lo: usize = 0;
    let mut hi: usize = total;

    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2); // upper mid to converge upward
        let candidate: String = graphemes[..mid].join("") + ELLIPSIS;
        let glyphs = shape_text(
            font_ctx,
            &candidate,
            font_size_px,
            letter_spacing_px,
            options,
        )?;
        let width = total_advance(&glyphs);
        if width <= max_width {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }

    // `lo` is the largest keep that fits (or 0 if nothing fits).
    // Refine around boundary to account for shaping-dependent width variations.
    let mut best_keep = lo;
    let mut best_width = 0.0_f64;
    let mut best_glyphs: Option<Vec<GlyphInfo>> = None;

    let refine_lo = lo.saturating_sub(REFINE_WINDOW);
    let refine_hi = (lo + REFINE_WINDOW).min(total);

    for keep in refine_lo..=refine_hi {
        let candidate: String = graphemes[..keep].join("") + ELLIPSIS;
        let glyphs = shape_text(
            font_ctx,
            &candidate,
            font_size_px,
            letter_spacing_px,
            options,
        )?;
        let width = total_advance(&glyphs);
        if width <= max_width && keep >= best_keep {
            best_keep = keep;
            best_width = width;
            best_glyphs = Some(glyphs);
        }
    }

    // Back up past tail-prohibited characters so the kept prefix ends at a
    // boundary where "…" may legally follow (JLREQ: no "（" before "…").
    if let Some(profile) = kinsoku_profile {
        if best_glyphs.is_some() {
            let chars_ref: Vec<&str> = graphemes.iter().map(String::as_str).collect();
            let mut adjusted_keep = best_keep;
            while adjusted_keep > 0
                && !is_valid_ellipsis_boundary(&chars_ref, adjusted_keep, profile)
            {
                adjusted_keep -= 1;
            }
            if adjusted_keep != best_keep {
                let candidate: String = graphemes[..adjusted_keep].join("") + ELLIPSIS;
                let glyphs = shape_text(
                    font_ctx,
                    &candidate,
                    font_size_px,
                    letter_spacing_px,
                    options,
                )?;
                best_keep = adjusted_keep;
                best_width = total_advance(&glyphs);
                best_glyphs = Some(glyphs);
            }
        }
    }

    if let Some(glyphs) = best_glyphs {
        let truncated_text: String = graphemes[..best_keep].join("") + ELLIPSIS;
        return Some(build_ellipsis_line(
            truncated_text,
            glyphs,
            best_width,
            baseline_offset_px,
            best_keep,
            total,
            include_unit_metadata,
        ));
    }

    // Even "…" alone overflows — return it as the best effort
    Some(build_ellipsis_line(
        ELLIPSIS.to_string(),
        ellipsis_glyphs,
        ellipsis_width,
        baseline_offset_px,
        0,
        total,
        include_unit_metadata,
    ))
}

/// Apply ellipsis to multi-line text when lines exceed maxLines.
///
/// Keeps the first (maxLines - 1) lines intact and applies ellipsis
/// truncation to the last allowed line.
#[must_use]
pub fn apply_multiline_ellipsis(
    lines: &[Line],
    max_lines: usize,
    max_width: f64,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    letter_spacing_px: f64,
    line_height_px: f64,
    baseline_offset_px: f64,
    kinsoku_profile: Option<&KinsokuProfile>,
    options: &ShapeOptions,
) -> Option<Vec<Line>> {
    apply_multiline_ellipsis_internal(
        lines,
        max_lines,
        max_width,
        font_ctx,
        font_size_px,
        letter_spacing_px,
        line_height_px,
        baseline_offset_px,
        kinsoku_profile,
        options,
        false,
    )
}

#[must_use]
pub(crate) fn apply_multiline_ellipsis_with_unit_metadata(
    lines: &[Line],
    max_lines: usize,
    max_width: f64,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    letter_spacing_px: f64,
    line_height_px: f64,
    baseline_offset_px: f64,
    kinsoku_profile: Option<&KinsokuProfile>,
    options: &ShapeOptions,
) -> Option<Vec<Line>> {
    apply_multiline_ellipsis_internal(
        lines,
        max_lines,
        max_width,
        font_ctx,
        font_size_px,
        letter_spacing_px,
        line_height_px,
        baseline_offset_px,
        kinsoku_profile,
        options,
        true,
    )
}

fn apply_multiline_ellipsis_internal(
    lines: &[Line],
    max_lines: usize,
    max_width: f64,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    letter_spacing_px: f64,
    line_height_px: f64,
    baseline_offset_px: f64,
    kinsoku_profile: Option<&KinsokuProfile>,
    options: &ShapeOptions,
    include_unit_metadata: bool,
) -> Option<Vec<Line>> {
    if max_lines == 0 || lines.len() <= max_lines {
        return None; // No truncation needed
    }

    let kept: Vec<Line> = lines[..max_lines - 1].to_vec();

    // Get text for the last allowed line — concatenate remaining text
    let remaining_text: String = lines[max_lines - 1..]
        .iter()
        .map(|l| l.text.as_str())
        .collect::<Vec<&str>>()
        .join("");

    let baseline_y = baseline_offset_px + (max_lines - 1) as f64 * line_height_px;
    let source_segments = if include_unit_metadata {
        build_ellipsis_source_segments(&lines[max_lines - 1..])
    } else {
        None
    };

    let ellipsis_line = apply_ellipsis_internal(
        &remaining_text,
        max_width,
        font_ctx,
        font_size_px,
        letter_spacing_px,
        line_height_px,
        baseline_y,
        kinsoku_profile,
        options,
        include_unit_metadata,
    );

    let mut result = kept;
    if let Some(mut el) = ellipsis_line {
        if include_unit_metadata {
            if let Some(source_segments) = &source_segments {
                remap_ellipsis_line_sources(&mut el, source_segments);
            } else {
                el.positioned_glyphs = None;
            }
        }
        el.baseline_y = baseline_y;
        result.push(el);
    } else {
        // Text fits — use the last-allowed line with adjusted baseline
        let mut last_line = lines[max_lines - 1].clone();
        last_line.baseline_y = baseline_y;
        result.push(last_line);
    }

    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_registry() -> FontRegistry {
        let data = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font");
        let mut reg = FontRegistry::new();
        reg.register(data, "NotoSansJP".into(), 400, FontStyle::Normal)
            .unwrap();
        reg
    }

    #[test]
    fn test_no_truncation_when_fits() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let result = apply_ellipsis(
            "短い",
            200.0,
            &font_ctx,
            24.0,
            0.0,
            36.0,
            28.8,
            None,
            &ShapeOptions::default(),
        );
        assert!(result.is_none(), "should return None when text fits");
    }

    #[test]
    fn test_truncation_ends_with_ellipsis() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let result = apply_ellipsis(
            "これは非常に長いテキストです",
            100.0,
            &font_ctx,
            24.0,
            0.0,
            36.0,
            28.8,
            None,
            &ShapeOptions::default(),
        );
        let line = result.expect("should truncate");
        assert!(
            line.text.ends_with('\u{2026}'),
            "should end with ellipsis: {}",
            line.text
        );
        assert!(
            line.width <= 100.0,
            "truncated line should fit within max_width"
        );
        assert!(
            line.positioned_glyphs.is_none(),
            "legacy ellipsis output must not gain positioned glyph metadata"
        );
    }

    #[test]
    fn test_unit_metadata_is_explicitly_opt_in() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let line = apply_ellipsis_with_unit_metadata(
            text,
            100.0,
            &font_ctx,
            24.0,
            0.0,
            36.0,
            28.8,
            None,
            &ShapeOptions::default(),
        )
        .expect("should truncate");
        let positioned_glyphs = line.positioned_glyphs.expect("positioned glyph metadata");
        let ellipsis = positioned_glyphs
            .iter()
            .find(|glyph| glyph.text.contains(ELLIPSIS))
            .expect("ellipsis glyph");
        assert_eq!(
            ellipsis.source_end,
            Some(u32::try_from(text.len()).expect("test text length"))
        );
    }

    #[test]
    fn test_unit_metadata_distinguishes_literal_and_synthetic_ellipsis() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let text = "A…BCDEFGHIJKLMNOP";
        let line = apply_ellipsis_with_unit_metadata(
            text,
            100.0,
            &font_ctx,
            24.0,
            0.0,
            36.0,
            28.8,
            None,
            &ShapeOptions::default(),
        )
        .expect("should truncate after the literal ellipsis");
        assert!(line.text.starts_with("A…"));
        let synthetic_cluster_start = synthetic_ellipsis_cluster_start(&line.text);
        let positioned_glyphs = line.positioned_glyphs.expect("positioned glyph metadata");
        let literal = positioned_glyphs
            .iter()
            .find(|glyph| {
                glyph.text.contains(ELLIPSIS) && glyph.cluster_end <= synthetic_cluster_start
            })
            .expect("literal ellipsis glyph");
        assert_eq!(
            (literal.source_start, literal.source_end),
            (Some(1), Some(2))
        );
        let synthetic = positioned_glyphs
            .iter()
            .find(|glyph| is_synthetic_ellipsis_glyph(glyph, synthetic_cluster_start))
            .expect("synthetic ellipsis glyph");
        assert_eq!(
            synthetic.source_end,
            Some(u32::try_from(grapheme_split(text).len()).expect("test grapheme count"))
        );
    }

    #[test]
    fn test_multiline_unit_metadata_preserves_source_gaps() {
        fn source_line(
            font_ctx: &FontContext<'_>,
            text: &str,
            source_offset: u32,
            cluster_offset: u32,
            baseline_y: f64,
        ) -> Line {
            let glyphs = shape_text(font_ctx, text, 24.0, 0.0, &ShapeOptions::default())
                .expect("shape source line");
            let mut positioned_glyphs =
                super::super::engine::build_positioned_glyphs_for_text(&glyphs, text, baseline_y);
            for glyph in &mut positioned_glyphs {
                glyph.source_start = glyph
                    .source_start
                    .map(|start| start.saturating_add(source_offset));
                glyph.source_end = glyph
                    .source_end
                    .map(|end| end.saturating_add(source_offset));
                glyph.cluster_start = glyph.cluster_start.saturating_add(cluster_offset);
                glyph.cluster_end = glyph.cluster_end.saturating_add(cluster_offset);
            }
            Line {
                text: text.to_string(),
                width: total_advance(&glyphs),
                glyphs,
                baseline_y,
                fragments: None,
                positioned_glyphs: Some(positioned_glyphs),
            }
        }

        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        // The missing offsets model forced newline separators that are not
        // present in Line.text but remain part of the logical source.
        let lines = vec![
            source_line(&font_ctx, "a…", 0, 0, 28.8),
            source_line(&font_ctx, "cd", 3, 5, 64.8),
            source_line(&font_ctx, "efgh", 6, 8, 100.8),
        ];
        let result = apply_multiline_ellipsis_with_unit_metadata(
            &lines,
            1,
            85.0,
            &font_ctx,
            24.0,
            0.0,
            36.0,
            28.8,
            None,
            &ShapeOptions::default(),
        )
        .expect("multiline ellipsis");
        let positioned_glyphs = result[0]
            .positioned_glyphs
            .as_ref()
            .expect("positioned glyph metadata");
        let c_glyph = positioned_glyphs
            .iter()
            .find(|glyph| glyph.text.contains('c'))
            .expect("prefix must cross the first source gap");
        assert_eq!(c_glyph.source_start, Some(3));
        assert_eq!(c_glyph.cluster_start, 5);
        let literal = positioned_glyphs
            .iter()
            .find(|glyph| glyph.text.contains(ELLIPSIS) && glyph.source_start == Some(1))
            .expect("literal ellipsis glyph");
        assert_eq!(literal.source_end, Some(2));
        let ellipsis = positioned_glyphs
            .iter()
            .find(|glyph| glyph.text.contains(ELLIPSIS) && glyph.source_end == Some(10))
            .expect("ellipsis glyph");
        assert_eq!(ellipsis.source_end, Some(10));
        assert_eq!(ellipsis.cluster_end, 12);
    }

    #[test]
    fn test_multiline_zero_limit_is_rejected_without_panicking() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let lines = vec![Line {
            text: "text".to_string(),
            glyphs: Vec::new(),
            width: 40.0,
            baseline_y: 28.8,
            fragments: None,
            positioned_glyphs: None,
        }];
        assert!(
            apply_multiline_ellipsis(
                &lines,
                0,
                100.0,
                &font_ctx,
                24.0,
                0.0,
                36.0,
                28.8,
                None,
                &ShapeOptions::default(),
            )
            .is_none()
        );
    }

    #[test]
    fn test_truncation_preserves_prefix() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let result = apply_ellipsis(
            "あいうえおかきく",
            100.0,
            &font_ctx,
            24.0,
            0.0,
            36.0,
            28.8,
            None,
            &ShapeOptions::default(),
        );
        let line = result.expect("should truncate");
        let without_ellipsis = line.text.trim_end_matches('\u{2026}');
        assert!(
            "あいうえおかきく".starts_with(without_ellipsis),
            "truncated text should be a prefix of original: {}",
            line.text
        );
    }

    #[test]
    fn test_very_narrow_returns_ellipsis_only() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        // max_width too narrow for any text + ellipsis
        let result = apply_ellipsis(
            "あいうえおかきく",
            15.0,
            &font_ctx,
            24.0,
            0.0,
            36.0,
            28.8,
            None,
            &ShapeOptions::default(),
        );
        let line = result.expect("should return ellipsis-only");
        assert_eq!(
            line.text, "\u{2026}",
            "should be just the ellipsis character"
        );
    }

    #[test]
    fn test_multiline_no_truncation_when_within_limit() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let lines = vec![
            Line {
                text: "あい".into(),
                glyphs: vec![],
                width: 48.0,
                baseline_y: 28.8,
                fragments: None,
                positioned_glyphs: None,
            },
            Line {
                text: "うえ".into(),
                glyphs: vec![],
                width: 48.0,
                baseline_y: 64.8,
                fragments: None,
                positioned_glyphs: None,
            },
        ];
        let result = apply_multiline_ellipsis(
            &lines,
            3,
            120.0,
            &font_ctx,
            24.0,
            0.0,
            36.0,
            28.8,
            None,
            &ShapeOptions::default(),
        );
        assert!(
            result.is_none(),
            "should not truncate when lines <= max_lines"
        );
    }

    #[test]
    fn test_multiline_truncates_to_max_lines() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let lines = vec![
            Line {
                text: "あいうえお".into(),
                glyphs: vec![],
                width: 120.0,
                baseline_y: 28.8,
                fragments: None,
                positioned_glyphs: None,
            },
            Line {
                text: "かきくけこ".into(),
                glyphs: vec![],
                width: 120.0,
                baseline_y: 64.8,
                fragments: None,
                positioned_glyphs: None,
            },
            Line {
                text: "さしすせそ".into(),
                glyphs: vec![],
                width: 120.0,
                baseline_y: 100.8,
                fragments: None,
                positioned_glyphs: None,
            },
            Line {
                text: "たちつてと".into(),
                glyphs: vec![],
                width: 120.0,
                baseline_y: 136.8,
                fragments: None,
                positioned_glyphs: None,
            },
        ];
        let result = apply_multiline_ellipsis(
            &lines,
            2,
            120.0,
            &font_ctx,
            24.0,
            0.0,
            36.0,
            28.8,
            None,
            &ShapeOptions::default(),
        );
        let result = result.expect("should truncate");
        assert_eq!(result.len(), 2, "should have exactly max_lines lines");
        assert!(
            result[1].text.ends_with('\u{2026}'),
            "last line should end with ellipsis"
        );
    }

    /// Text with 40+ graphemes: binary search ellipsis must find a valid
    /// truncation, not fall back to "…" alone (the old 32-iter limit would fail here).
    #[test]
    fn test_ellipsis_over_32_graphemes() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        // 40 graphemes — needs >32 deletions from the end to fit in narrow width
        let text =
            "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもらりるれろ";
        // Wide enough for a few chars + ellipsis, but far too narrow for all 40
        let result = apply_ellipsis(
            text,
            120.0,
            &font_ctx,
            24.0,
            0.0,
            36.0,
            28.8,
            None,
            &ShapeOptions::default(),
        );
        let line = result.expect("should truncate");

        assert!(
            line.text.ends_with('\u{2026}'),
            "should end with ellipsis: {}",
            line.text
        );
        // Must keep some prefix text, not just "…"
        let prefix = line.text.trim_end_matches('\u{2026}');
        assert!(
            !prefix.is_empty(),
            "should keep some prefix text, not degrade to just '…': {}",
            line.text
        );
        assert!(
            line.width <= 120.0,
            "truncated line must fit within max_width: {}",
            line.width
        );
    }

    /// With a ja kinsoku profile, the truncation point must not leave a
    /// tail-prohibited character (e.g. "（") directly before the "…".
    #[test]
    fn test_ellipsis_respects_kinsoku_tail_prohibit() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let profile = crate::text::kinsoku::get_kinsoku_profile(Some("ja"));
        assert!(profile.is_some(), "ja profile must exist");

        // Alternate normal chars with open parens so many candidate cut
        // points land right after "（". Sweep widths so at least one width
        // would (without validation) cut after an open paren.
        let text = "あ（い（う（え（お（か（き（く";
        let mut truncated_count = 0;
        let mut width = 30.0;
        while width <= 320.0 {
            if let Some(line) = apply_ellipsis(
                text,
                width,
                &font_ctx,
                24.0,
                0.0,
                36.0,
                28.8,
                profile,
                &ShapeOptions::default(),
            ) {
                truncated_count += 1;
                let prefix = line.text.trim_end_matches('\u{2026}');
                assert!(
                    !prefix.ends_with('（'),
                    "prefix must not end with tail-prohibited char at width {width}: {}",
                    line.text
                );
                assert!(
                    line.width <= width,
                    "truncated line must fit at width {width}: {}",
                    line.width
                );
            }
            width += 10.0;
        }
        assert!(truncated_count > 0, "sweep must exercise truncation");
    }
}
