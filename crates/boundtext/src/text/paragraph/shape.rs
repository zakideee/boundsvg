use std::sync::Arc;

use crate::font::FontContext;
use crate::font::backend::{ShapeDirection, ShapeFeature, ShapeVariation};
use crate::font::shaping::{ShapeOptions, build_vertical_upright_map};
use crate::text::grapheme::grapheme_split;
use crate::text::kinsoku::{get_hanging_chars, get_kinsoku_profile};
use crate::text::types::{Language, NotdefInfo, WrapMode};

use super::super::engine::{build_byte_to_char_map, build_char_byte_offsets, language_to_str};
use super::{GlyphCharSpan, GlyphRange, ShapedGlyph, ShapedParagraph};

// ---------------------------------------------------------------------------
// .notdef detection
// ---------------------------------------------------------------------------

/// Scan a `ShapedParagraph` for glyphs with `glyph_id == 0` (.notdef) and
/// return one `NotdefInfo` per unique (character, `font_alias`) pair.
///
/// Returns an empty `Vec` when no .notdef glyphs exist (zero-cost: early exit
/// before any allocation).
#[must_use]
pub fn collect_notdef_chars(pp: &ShapedParagraph) -> Vec<NotdefInfo> {
    if !pp.glyphs.iter().any(|g| g.glyph_id == 0) {
        return Vec::new();
    }

    let text = pp.text.as_ref();
    let byte_len = u32::try_from(text.len()).unwrap_or(u32::MAX);
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    for glyph in &pp.glyphs {
        if glyph.glyph_id != 0 {
            continue;
        }
        let start = glyph.cluster;
        if start >= byte_len {
            continue;
        }
        // Find the character at this byte offset
        let Some(c) = text[start as usize..].chars().next() else {
            continue;
        };
        // Skip control characters and whitespace — they are not "missing glyphs"
        if c.is_control() || c.is_whitespace() {
            continue;
        }
        let ch = c.to_string();
        let key = (ch.clone(), glyph.font_alias.clone());
        if seen.insert(key) {
            result.push(NotdefInfo {
                character: ch.clone(),
                font_alias: glyph.font_alias.clone(),
            });
        }
    }

    result
}

// ---------------------------------------------------------------------------
// shape_paragraph — expensive shaping, done once
// ---------------------------------------------------------------------------

/// Prepare a paragraph for layout: resolve font, shape text, and store
/// width-independent glyph data in font units.
///
/// Returns `None` when font resolution fails or the shaper produces `.notdef`
/// (`glyph_id` == 0) glyphs.
// Shaping preparation requires font context, shaping options, and language/wrap parameters
#[expect(
    clippy::too_many_arguments,
    reason = "text layout pipeline passes font context and layout constraints through stages"
)]
#[must_use]
pub fn shape_paragraph(
    text: &str,
    font_ctx: &FontContext<'_>,
    language: Language,
    wrap: WrapMode,
    hanging_punctuation: bool,
    shape_options: &ShapeOptions,
    uax14_breaks: Option<&[usize]>,
    letter_spacing_px: f64,
) -> Option<ShapedParagraph> {
    shape_paragraph_with_options(
        text,
        font_ctx,
        language,
        wrap,
        hanging_punctuation,
        shape_options,
        uax14_breaks,
        letter_spacing_px,
        false,
    )
}

/// Prepare a paragraph with optional .notdef tolerance.
///
/// When `allow_notdef` is true, glyphs with `glyph_id=0` (.notdef) are
/// passed through instead of rejecting the entire paragraph. This enables
/// tofu-character fallback for fonts with incomplete coverage.
#[expect(
    clippy::too_many_arguments,
    reason = "shaping pipeline parameters — font context, language, wrap, break hints, spacing, notdef flag"
)]
pub fn shape_paragraph_with_options(
    text: &str,
    font_ctx: &FontContext<'_>,
    language: Language,
    wrap: WrapMode,
    hanging_punctuation: bool,
    shape_options: &ShapeOptions,
    uax14_breaks: Option<&[usize]>,
    letter_spacing_px: f64,
    allow_notdef: bool,
) -> Option<ShapedParagraph> {
    if text.is_empty() {
        return Some(build_empty_shaped(
            language,
            hanging_punctuation,
            letter_spacing_px,
            shape_options,
        ));
    }

    // --- Font resolution (same chain as shape_text_for_layout) ---
    // For multi-family fallback chains we cannot easily intercept the raw
    // font-unit glyphs through shape_with_fallback_and_options, so bail out
    // and let the caller fall through to the existing px-based path.
    if font_ctx.families.len() > 1 {
        return None;
    }

    let font_entry = font_ctx
        .registry
        .resolve_chain(font_ctx.families, font_ctx.weight, font_ctx.style)
        .or_else(|| {
            font_ctx
                .fallback_registry
                .and_then(|fb| fb.resolve_chain(font_ctx.families, font_ctx.weight, font_ctx.style))
        })?;

    // --- Build backend features/variations and shape ---
    let features = build_shape_features(shape_options);
    let variations = build_shape_variations(shape_options);
    let direction = if is_vertical(shape_options) {
        ShapeDirection::TopToBottom
    } else {
        ShapeDirection::LeftToRight
    };
    let language_str = shape_options.language.as_deref();
    let shaper_face = font_entry.shaper_face(font_ctx.registry.shaper())?;
    #[cfg(any(test, feature = "phase-trace"))]
    crate::phase_trace::record_backend_shape();
    let raw_glyphs = shaper_face.shape(text, direction, language_str, &features, &variations);

    if raw_glyphs.is_empty() {
        return None;
    }
    // Check for .notdef — reject unless caller opted in to tofu fallback
    if !allow_notdef && raw_glyphs.iter().any(|g| g.glyph_id == 0) {
        return None;
    }

    // --- Build char-level mappings ---
    let chars = grapheme_split(text);
    let chars_ref: Vec<&str> = chars.iter().map(String::as_str).collect();
    let char_count = chars_ref.len();

    let char_byte_offsets = build_char_byte_offsets(&chars_ref);
    let byte_to_char_idx = build_byte_to_char_map(&chars_ref);

    let vertical_upright_by_byte = if is_vertical(shape_options) {
        Some(build_vertical_upright_map(text, shape_options))
    } else {
        None
    };
    let vertical_font_face = if vertical_upright_by_byte.is_some() {
        font_entry.font_face(font_ctx.registry.backend(), &variations)
    } else {
        None
    };

    // --- Convert raw glyphs → ShapedGlyph ---
    let shaped_glyphs: Vec<ShapedGlyph> = raw_glyphs
        .iter()
        .map(|raw| {
            let vertical_inline_advance_funits = vertical_upright_by_byte.as_ref().map(|upright| {
                let raw_x_advance = i64::from(raw.x_advance).abs();
                let raw_y_advance = i64::from(raw.y_advance).abs();
                if upright.get(raw.cluster as usize).copied().unwrap_or(true) {
                    if raw_y_advance > 0 {
                        raw_y_advance
                    } else {
                        raw_x_advance
                    }
                } else if raw_x_advance == 0 && raw_y_advance == 0 {
                    0
                } else {
                    vertical_font_face
                        .as_ref()
                        .and_then(|face| {
                            u16::try_from(raw.glyph_id)
                                .ok()
                                .and_then(|glyph_id| face.glyph_hor_advance(glyph_id))
                        })
                        .filter(|advance| *advance > 0)
                        .map(i64::from)
                        .or_else(|| (raw_x_advance > 0).then_some(raw_x_advance))
                        .or_else(|| (raw_y_advance > 0).then_some(raw_y_advance))
                        .unwrap_or(0)
                }
            });

            ShapedGlyph {
                glyph_id: raw.glyph_id,
                x_advance_funits: raw.x_advance,
                y_advance_funits: raw.y_advance,
                vertical_inline_advance_funits,
                x_offset_funits: raw.x_offset,
                y_offset_funits: raw.y_offset,
                cluster: raw.cluster,
                font_alias: font_entry.key.alias.clone(),
                font_weight: font_entry.key.weight,
                font_style: font_entry.key.style.clone(),
            }
        })
        .collect();

    // --- Build per-char advances (font units) and tracking counts ---
    let mut char_advances_funits: Vec<i64> = vec![0; char_count];
    let mut tracking_counts: Vec<u32> = vec![0; char_count];

    // Always accumulate x_advance here. Vertical layout uses the
    // orientation-normalized inline advance stored on each shaped glyph.
    for (glyph_index, raw) in raw_glyphs.iter().enumerate() {
        let char_idx = byte_to_char_idx
            .get(raw.cluster as usize)
            .copied()
            .unwrap_or(0);
        if char_idx < char_count {
            char_advances_funits[char_idx] += i64::from(raw.x_advance);
            if has_cluster_boundary_after(&raw_glyphs, glyph_index) {
                tracking_counts[char_idx] += 1;
            }
        }
    }

    let glyph_ranges = build_glyph_ranges(&raw_glyphs, &byte_to_char_idx, char_count);
    let glyph_char_spans = build_glyph_char_spans(&raw_glyphs, &byte_to_char_idx, char_count);
    // --- UAX#14 break flags ---
    let uax14_break_flags = build_uax14_break_set(&chars_ref, uax14_breaks, text);

    // --- Kinsoku profile and hanging chars ---
    let kinsoku_profile = match wrap {
        WrapMode::None => None,
        WrapMode::Word | WrapMode::Char => get_kinsoku_profile(Some(language_to_str(language))),
    };
    let hanging_chars = get_hanging_chars(hanging_punctuation);

    Some(ShapedParagraph {
        text: Arc::from(text),
        glyphs: shaped_glyphs,
        units_per_em: font_entry.units_per_em,
        char_advances_funits,
        tracking_counts,
        char_byte_offsets,
        glyph_ranges,
        glyph_char_spans,
        uax14_break_flags,
        kinsoku_profile,
        hanging_chars,
        letter_spacing_px,
        font_variation_settings: shape_options.font_variation_settings.clone(),
        font_feature_settings: shape_options.font_feature_settings.clone(),
    })
}

// ---------------------------------------------------------------------------
// Helpers — feature/variation building
// ---------------------------------------------------------------------------

fn is_vertical(options: &ShapeOptions) -> bool {
    options.writing_mode.as_deref() == Some("vertical-rl")
}

/// Build backend-neutral OpenType features for shaping.
fn build_shape_features(options: &ShapeOptions) -> Vec<ShapeFeature> {
    let mut features = Vec::new();

    if is_vertical(options) {
        features.push(ShapeFeature {
            tag: *b"vert",
            value: 1,
        });
        features.push(ShapeFeature {
            tag: *b"vkna",
            value: 1,
        });
        features.push(ShapeFeature {
            tag: *b"vkrn",
            value: 1,
        });
    }

    // User-specified features (appended last so they override automatic ones via last-wins).
    for setting in &options.font_feature_settings {
        if setting.tag.len() == 4 {
            let bytes = setting.tag.as_bytes();
            features.push(ShapeFeature {
                tag: [bytes[0], bytes[1], bytes[2], bytes[3]],
                value: setting.value,
            });
        }
    }
    features
}

/// Build backend-neutral font variations from shape options.
fn build_shape_variations(options: &ShapeOptions) -> Vec<ShapeVariation> {
    options
        .font_variation_settings
        .iter()
        .filter_map(|variation| {
            if variation.tag.len() == 4 {
                let bytes = variation.tag.as_bytes();
                Some(ShapeVariation {
                    tag: [bytes[0], bytes[1], bytes[2], bytes[3]],
                    value: variation.value,
                })
            } else {
                None
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Helpers — glyph mapping construction
// ---------------------------------------------------------------------------

fn has_cluster_boundary_after(
    glyphs: &[crate::font::backend::RawShapedGlyph],
    glyph_index: usize,
) -> bool {
    let Some(glyph) = glyphs.get(glyph_index) else {
        return false;
    };
    glyphs
        .get(glyph_index + 1)
        .is_some_and(|next| next.cluster != glyph.cluster)
}

/// Build per-character glyph index ranges from raw shaped glyphs.
fn build_glyph_ranges(
    raw_glyphs: &[crate::font::backend::RawShapedGlyph],
    byte_to_char_idx: &[usize],
    char_count: usize,
) -> Vec<GlyphRange> {
    let mut glyph_ranges: Vec<GlyphRange> = (0..char_count)
        .map(|_| GlyphRange { start: 0, end: 0 })
        .collect();
    for (glyph_index, raw) in raw_glyphs.iter().enumerate() {
        let char_idx = byte_to_char_idx
            .get(raw.cluster as usize)
            .copied()
            .unwrap_or(0);
        if char_idx < char_count {
            let range = &mut glyph_ranges[char_idx];
            if range.start == 0 && range.end == 0 {
                range.start = glyph_index;
                range.end = glyph_index + 1;
            } else {
                range.end = glyph_index + 1;
            }
        }
    }
    glyph_ranges
}

/// Build glyph-to-character span mapping from raw shaped glyphs.
fn build_glyph_char_spans(
    raw_glyphs: &[crate::font::backend::RawShapedGlyph],
    byte_to_char_idx: &[usize],
    char_count: usize,
) -> Vec<GlyphCharSpan> {
    raw_glyphs
        .iter()
        .enumerate()
        .map(|(index, raw)| {
            let start = byte_to_char_idx
                .get(raw.cluster as usize)
                .copied()
                .unwrap_or(0)
                .min(char_count);
            let mut next_cluster = raw.cluster as usize;
            for next in raw_glyphs.iter().skip(index + 1) {
                let candidate = next.cluster as usize;
                if candidate > next_cluster {
                    next_cluster = candidate;
                    break;
                }
            }
            let end = if index + 1 >= raw_glyphs.len() {
                char_count
            } else {
                byte_to_char_idx
                    .get(next_cluster)
                    .copied()
                    .unwrap_or(char_count)
                    .max(start + 1)
                    .min(char_count)
            };
            GlyphCharSpan { start, end }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Helpers — UAX#14 break flags
// ---------------------------------------------------------------------------

/// Build UAX#14 break set as a boolean vec (char-indexed).
pub(crate) fn build_uax14_break_set(
    chars: &[&str],
    uax14_breaks: Option<&[usize]>,
    text: &str,
) -> Option<Vec<bool>> {
    let breaks: Vec<usize> = match uax14_breaks {
        Some(b) if !b.is_empty() => b.to_vec(),
        _ => super::super::linebreak::uax14_break_opportunities(text),
    };
    if breaks.is_empty() {
        return None;
    }

    // Build byte offset → char index mapping
    let mut byte_to_char: Vec<Option<usize>> = Vec::new();
    let mut byte_offset = 0;
    for (index, ch) in chars.iter().enumerate() {
        while byte_to_char.len() < byte_offset {
            byte_to_char.push(None);
        }
        byte_to_char.push(Some(index));
        byte_offset += ch.len();
        while byte_to_char.len() < byte_offset {
            byte_to_char.push(None);
        }
    }
    while byte_to_char.len() <= byte_offset {
        byte_to_char.push(Some(chars.len()));
    }

    let mut break_flags = vec![false; chars.len()];
    for &offset in &breaks {
        if offset < byte_to_char.len()
            && let Some(char_idx) = byte_to_char[offset]
            && char_idx > 0
            && char_idx < chars.len()
        {
            break_flags[char_idx] = true;
        }
    }

    if break_flags.iter().any(|&flag| flag) {
        Some(break_flags)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Helpers — empty paragraph
// ---------------------------------------------------------------------------

fn build_empty_shaped(
    language: Language,
    hanging_punctuation: bool,
    letter_spacing_px: f64,
    shape_options: &ShapeOptions,
) -> ShapedParagraph {
    let kinsoku_profile = get_kinsoku_profile(Some(language_to_str(language)));
    let hanging_chars = get_hanging_chars(hanging_punctuation);
    ShapedParagraph {
        text: Arc::from(""),
        glyphs: Vec::new(),
        units_per_em: 1000, // arbitrary; no glyphs to scale
        char_advances_funits: Vec::new(),
        tracking_counts: Vec::new(),
        char_byte_offsets: vec![0],
        glyph_ranges: Vec::new(),
        glyph_char_spans: Vec::new(),
        uax14_break_flags: None,
        kinsoku_profile,
        hanging_chars,
        letter_spacing_px,
        font_variation_settings: shape_options.font_variation_settings.clone(),
        font_feature_settings: shape_options.font_feature_settings.clone(),
    }
}

#[cfg(test)]
mod cluster_tracking_tests {
    use super::*;
    use crate::font::backend::RawShapedGlyph;

    fn glyph(cluster: u32) -> RawShapedGlyph {
        RawShapedGlyph {
            glyph_id: cluster + 1,
            x_advance: 500,
            y_advance: 0,
            x_offset: 0,
            y_offset: 0,
            cluster,
        }
    }

    #[test]
    fn tracking_boundary_ignores_auxiliary_glyphs_in_the_same_cluster() {
        let glyphs = vec![glyph(0), glyph(0), glyph(4)];

        assert!(!has_cluster_boundary_after(&glyphs, 0));
        assert!(has_cluster_boundary_after(&glyphs, 1));
        assert!(!has_cluster_boundary_after(&glyphs, 2));
    }
}
