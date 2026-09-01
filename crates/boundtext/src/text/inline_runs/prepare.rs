use super::super::grapheme::grapheme_split;
use super::super::kinsoku::{get_hanging_chars, get_kinsoku_profile};
use super::super::paragraph::build_uax14_break_set;
use super::super::types::{
    Language, Line, LineFragment, NotdefInfo, TextOrientation, TextRunStyle, TextSpanInput,
};
use super::types::{RubyAnnotationMeta, RunSegment, ShapedInlineRuns, SpanRef, SpanRubyInfo};
use crate::font::FontContext;
use crate::font::shaping::{
    self, GlyphInfo, ShapeOptions, parse_css_font_feature_settings,
    parse_css_font_variation_settings,
};
use crate::font::{FontRegistry, FontStyle};
use crate::text::engine::{build_byte_to_char_map, build_char_byte_offsets};

/// Build `ShapedInlineRuns` from spans.
///
/// Shapes each span once via `shape_inline_runs`, then computes per-grapheme
/// advances from the merged glyph array. `ruby_info` is a parallel array
/// of optional ruby metadata per span (same length as `spans`).
/// When `vertical` is true, shapes with vertical writing mode and computes
/// vertical advances (`y_advance` with `x_advance` fallback).
pub fn prepare_inline_runs(
    spans: &[TextSpanInput],
    font_ctx: &FontContext<'_>,
    default_letter_spacing_px: f64,
    language: Language,
    hanging_punctuation: bool,
    ruby_info: &[Option<SpanRubyInfo>],
    vertical: bool,
) -> Result<ShapedInlineRuns, crate::TextLayoutError> {
    let writing_mode = if vertical { Some("vertical-rl") } else { None };
    let (glyphs, segments) =
        shape_inline_runs_with_mode(spans, font_ctx, default_letter_spacing_px, writing_mode)?;

    // Concatenate span texts
    let text: String = spans.iter().map(|s| s.text.as_str()).collect();
    let graphemes = grapheme_split(&text);
    let chars_ref: Vec<&str> = graphemes.iter().map(String::as_str).collect();

    // Per-grapheme advances from merged glyphs
    let grapheme_advances_px = {
        let byte_to_char = build_byte_to_char_map(&chars_ref);
        let count = graphemes.len();
        let mut advances = vec![0.0_f64; count];
        for glyph in &glyphs {
            let idx = byte_to_char
                .get(glyph.cluster as usize)
                .copied()
                .unwrap_or(0);
            if idx < count {
                if vertical {
                    advances[idx] += if glyph.y_advance == 0.0 {
                        glyph.x_advance.abs()
                    } else {
                        // Top-to-bottom advances are negative. Preserve the
                        // sign of tracking adjustments so negative spacing on
                        // a zero-advance mark reduces the logical advance.
                        -glyph.y_advance
                    };
                } else {
                    advances[idx] += glyph.x_advance;
                }
            }
        }
        advances
    };

    let char_byte_offsets = build_char_byte_offsets(&chars_ref);

    let lang_str = match language {
        Language::Ja => Some("ja"),
        Language::En => Some("en"),
        Language::Auto => None,
    };
    let kinsoku_profile = get_kinsoku_profile(lang_str);
    let hanging_chars = get_hanging_chars(hanging_punctuation);

    // UAX#14 break flags (reuse paragraph.rs logic)
    let uax14_break_flags = build_uax14_break_set(&chars_ref, None, &text);

    // Ruby: mark non-breakable ranges and collect annotations
    let count = graphemes.len();
    let mut non_breakable = vec![false; count];
    let mut ruby_annotations = Vec::new();

    for seg in &segments {
        if let Some(ruby) = ruby_info.get(seg.span_index).and_then(|r| r.as_ref()) {
            // Mark all positions within this span as non-breakable
            // (the first position at seg.start is breakable — only interior positions are locked)
            let lock_start = (seg.start + 1).min(count);
            let lock_end = seg.end.min(count);
            for is_non_breakable in &mut non_breakable[lock_start..lock_end] {
                *is_non_breakable = true;
            }
            ruby_annotations.push(RubyAnnotationMeta {
                text: ruby.ruby_text.clone(),
                position: ruby.ruby_position.clone(),
                align: ruby.ruby_align.clone(),
                grapheme_start: seg.start,
                grapheme_end: seg.end,
                font_size_px: ruby.ruby_font_size_px,
                color: ruby.ruby_color.clone(),
            });
        }
    }

    // Detect .notdef glyphs (glyph_id=0) and map back to characters
    let notdef_infos = collect_inline_notdef(&glyphs, &text);

    Ok(ShapedInlineRuns {
        text,
        grapheme_advances_px,
        segments,
        graphemes,
        char_byte_offsets,
        uax14_break_flags,
        kinsoku_profile,
        hanging_chars,
        non_breakable,
        ruby_annotations,
        notdef_infos,
    })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Shape multiple inline runs and merge their glyphs into a single array.
///
/// Returns the merged glyphs (with adjusted cluster byte offsets) and
/// `RunSegments` tracking which grapheme ranges belong to which span.
pub(crate) fn shape_inline_runs(
    spans: &[TextSpanInput],
    font_ctx: &FontContext<'_>,
    default_letter_spacing_px: f64,
) -> Result<(Vec<GlyphInfo>, Vec<RunSegment>), crate::TextLayoutError> {
    shape_inline_runs_with_mode(spans, font_ctx, default_letter_spacing_px, None)
}

/// Shape inline runs with an explicit writing mode.
#[expect(
    clippy::cast_possible_truncation,
    reason = "byte offset within concatenated text spans; total length is well within u32::MAX"
)]
pub(crate) fn shape_inline_runs_with_mode(
    spans: &[TextSpanInput],
    font_ctx: &FontContext<'_>,
    default_letter_spacing_px: f64,
    writing_mode: Option<&str>,
) -> Result<(Vec<GlyphInfo>, Vec<RunSegment>), crate::TextLayoutError> {
    let mut all_glyphs: Vec<GlyphInfo> = Vec::new();
    let mut segments: Vec<RunSegment> = Vec::new();
    let mut byte_offset: u32 = 0;
    let mut grapheme_offset: usize = 0;
    let mut run_index = 0_usize;
    let last_shaped_span = spans.iter().rposition(|s| !s.text.is_empty());

    for (span_idx, span) in spans.iter().enumerate() {
        if span.text.is_empty() {
            continue;
        }

        let font_families = if span.font_family.is_empty() {
            font_ctx.families.to_vec()
        } else {
            normalized_font_families(&span.font_family)
        };
        let font_weight = span.font_weight;
        let font_style = span.font_style.clone();
        let font_size_px = span.font_size_px;
        let letter_spacing_px = span.letter_spacing_px.unwrap_or(default_letter_spacing_px);

        let shape_options = ShapeOptions {
            writing_mode: writing_mode.map(String::from),
            language: span.language.clone(),
            vertical_feature_priority: writing_mode.map(|_| "true".to_string()),
            text_orientation: span.text_orientation.clone(),
            font_variation_settings: span
                .font_variation_settings
                .as_deref()
                .map(parse_css_font_variation_settings)
                .unwrap_or_default(),
            font_feature_settings: span
                .font_feature_settings
                .as_deref()
                .map(parse_css_font_feature_settings)
                .unwrap_or_default(),
        };

        let run_font_ctx = FontContext {
            registry: font_ctx.registry,
            fallback_registry: font_ctx.fallback_registry,
            families: &font_families,
            weight: font_weight,
            style: &font_style,
        };
        let mut run_glyphs = shape_text_for_run(
            &run_font_ctx,
            &span.text,
            font_size_px,
            letter_spacing_px,
            &shape_options,
            run_index,
        )?;

        // Keep total letterSpacing compatible with whole-string shaping by
        // adding one boundary spacing at each non-final run (mirrors the
        // font-fallback run boundary compensation in shaping.rs).
        if Some(span_idx) != last_shaped_span && letter_spacing_px != 0.0 {
            if let Some(last) = run_glyphs.last_mut() {
                if writing_mode.is_some() {
                    last.y_advance =
                        shaping::add_vertical_inline_tracking(last.y_advance, letter_spacing_px);
                } else {
                    last.x_advance =
                        shaping::add_inline_tracking(last.x_advance, letter_spacing_px);
                }
            }
        }

        let graphemes = grapheme_split(&span.text);
        let start = grapheme_offset;
        let end = start + graphemes.len();

        // Adjust cluster byte offsets for merged array
        for glyph in &run_glyphs {
            all_glyphs.push(GlyphInfo {
                glyph_id: glyph.glyph_id,
                x_advance: glyph.x_advance,
                y_advance: glyph.y_advance,
                x_offset: glyph.x_offset,
                y_offset: glyph.y_offset,
                cluster: glyph.cluster + byte_offset,
                font_alias: glyph.font_alias.clone(),
                font_weight: glyph.font_weight,
                font_style: glyph.font_style.clone(),
                rotation_deg: glyph.rotation_deg,
            });
        }

        segments.push(RunSegment {
            run_index,
            span: SpanRef {
                font_families,
                font_weight,
                font_style,
                font_size_px,
                letter_spacing_px,
                language: span.language.clone(),
                text_orientation: span.text_orientation.clone(),
                color: span.color.clone(),
                text_strokes: span.text_strokes.clone(),
                text_shadows: span.text_shadows.clone(),
                font_variation_settings: span.font_variation_settings.clone(),
                font_feature_settings: span.font_feature_settings.clone(),
            },
            graphemes,
            start,
            end,
            span_index: span_idx,
        });

        grapheme_offset = end;
        byte_offset += span.text.len() as u32;
        run_index = run_index.saturating_add(1);
    }

    Ok((all_glyphs, segments))
}

/// After line breaking, split each line into fragments matching the original run boundaries.
///
/// Each fragment is re-shaped with its span's font/size for precise width calculation.
pub(crate) fn apply_inline_fragments(
    lines: &mut [Line],
    segments: &[RunSegment],
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
) -> Result<(), crate::TextLayoutError> {
    if segments.is_empty() {
        return Ok(());
    }

    let mut line_start: usize = 0;
    for line in lines.iter_mut() {
        let line_graphemes = grapheme_split(&line.text);
        let line_length = line_graphemes.len();
        let line_end = line_start + line_length;

        let mut fragments: Vec<LineFragment> = Vec::new();

        for segment in segments {
            if segment.end <= line_start || segment.start >= line_end {
                continue;
            }

            let overlap_start = segment.start.max(line_start);
            let overlap_end = segment.end.min(line_end);
            if overlap_start >= overlap_end {
                continue;
            }

            let local_start = overlap_start - segment.start;
            let local_end = overlap_end - segment.start;
            let fragment_text: String = segment.graphemes[local_start..local_end].join("");
            if fragment_text.is_empty() {
                continue;
            }

            let shape_options = ShapeOptions {
                writing_mode: None,
                language: segment.span.language.clone(),
                vertical_feature_priority: None,
                text_orientation: segment.span.text_orientation.clone(),
                font_variation_settings: segment
                    .span
                    .font_variation_settings
                    .as_deref()
                    .map(parse_css_font_variation_settings)
                    .unwrap_or_default(),
                font_feature_settings: segment
                    .span
                    .font_feature_settings
                    .as_deref()
                    .map(parse_css_font_feature_settings)
                    .unwrap_or_default(),
            };

            let frag_font_ctx = FontContext {
                registry: font_registry,
                fallback_registry,
                families: &segment.span.font_families,
                weight: segment.span.font_weight,
                style: &segment.span.font_style,
            };
            let fragment_glyphs = shape_text_for_run(
                &frag_font_ctx,
                &fragment_text,
                segment.span.font_size_px,
                segment.span.letter_spacing_px,
                &shape_options,
                segment.run_index,
            )?;

            let width: f64 = fragment_glyphs.iter().map(|g| g.x_advance).sum();

            let (font, fallback) = split_font_families(&segment.span.font_families);

            fragments.push(LineFragment {
                text: fragment_text,
                glyphs: fragment_glyphs,
                width,
                style: TextRunStyle {
                    font,
                    fallback,
                    font_weight: segment.span.font_weight,
                    font_style: segment.span.font_style.clone(),
                    font_size_px: segment.span.font_size_px,
                    letter_spacing_px: segment.span.letter_spacing_px,
                    text_orientation: segment
                        .span
                        .text_orientation
                        .as_deref()
                        .map(|value| TextOrientation::from_option(Some(value))),
                    font_variation_settings: segment.span.font_variation_settings.clone(),
                    font_feature_settings: segment.span.font_feature_settings.clone(),
                    color: segment.span.color.clone(),
                    text_strokes: segment.span.text_strokes.clone(),
                    text_shadows: segment.span.text_shadows.clone(),
                    language: segment.span.language.clone(),
                },
            });
        }

        if !fragments.is_empty() {
            line.fragments = Some(fragments);
        }

        line_start = line_end;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Scan shaped glyphs for `glyph_id=0` (.notdef) and map back to characters.
fn collect_inline_notdef(glyphs: &[GlyphInfo], text: &str) -> Vec<NotdefInfo> {
    if !glyphs.iter().any(|g| g.glyph_id == 0) {
        return Vec::new();
    }

    let byte_len = u32::try_from(text.len()).unwrap_or(u32::MAX);
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    for glyph in glyphs {
        if glyph.glyph_id != 0 {
            continue;
        }
        let start = glyph.cluster;
        if start >= byte_len {
            continue;
        }
        let Some(c) = text[start as usize..].chars().next() else {
            continue;
        };
        if c.is_control() || c.is_whitespace() {
            continue;
        }
        let ch = c.to_string();
        let alias = glyph.font_alias.clone().unwrap_or_default();
        let key = (ch.clone(), alias.clone());
        if seen.insert(key) {
            result.push(NotdefInfo {
                character: ch,
                font_alias: alias,
            });
        }
    }

    result
}

fn shape_text_for_run(
    font_ctx: &FontContext<'_>,
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
    shape_options: &ShapeOptions,
    run_index: usize,
) -> Result<Vec<GlyphInfo>, crate::TextLayoutError> {
    if text.is_empty() {
        return Ok(Vec::new());
    }

    if font_ctx.families.len() > 1 {
        let result = shaping::shape_with_fallback_and_options_checked(
            font_ctx,
            text,
            font_size_px,
            letter_spacing_px,
            shape_options,
        )
        .ok_or_else(|| crate::TextLayoutError::FontUnavailable {
            run_index,
            families: font_ctx.families.to_vec(),
            weight: font_ctx.weight,
            style: font_ctx.style.clone(),
        })?;
        if !result.glyphs.is_empty() {
            return Ok(result.glyphs);
        }
        return Err(crate::TextLayoutError::PreparationFailed {
            phase: crate::TextPreparationPhase::SpanShaping,
        });
    }

    let font_entry = resolve_font(
        font_ctx.registry,
        font_ctx.fallback_registry,
        font_ctx.families,
        font_ctx.weight,
        font_ctx.style,
    )
    .ok_or_else(|| crate::TextLayoutError::FontUnavailable {
        run_index,
        families: font_ctx.families.to_vec(),
        weight: font_ctx.weight,
        style: font_ctx.style.clone(),
    })?;
    Ok(shaping::shape_text_with_options(
        font_ctx.registry,
        font_entry,
        text,
        font_size_px,
        letter_spacing_px,
        shape_options,
    ))
}

fn resolve_font<'a>(
    font_registry: &'a FontRegistry,
    fallback_registry: Option<&'a FontRegistry>,
    aliases: &[String],
    weight: u16,
    style: &FontStyle,
) -> Option<&'a crate::font::FontEntry> {
    if let Some(entry) = font_registry.resolve_chain(aliases, weight, style) {
        return Some(entry);
    }
    if let Some(fallback) = fallback_registry {
        return fallback.resolve_chain(aliases, weight, style);
    }
    None
}

/// Normalize font families (alias resolution).
fn normalized_font_families(families: &[String]) -> Vec<String> {
    families.to_vec()
}

/// Split font families into (primary, fallbacks) for `TextRunStyle`.
fn split_font_families(families: &[String]) -> (String, Vec<String>) {
    let font = families.first().cloned().unwrap_or_default();
    let fallback = if families.len() > 1 {
        families[1..].to_vec()
    } else {
        Vec::new()
    };
    (font, fallback)
}
