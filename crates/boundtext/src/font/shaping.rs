use serde::{Deserialize, Serialize};

use super::backend::{FontFace, ShapeDirection, ShapeFeature, ShapeVariation};
use super::vertical_orientation;
use super::{FontEntry, FontRegistry, FontStyle};
use crate::text::grapheme::grapheme_split;

/// Single glyph info returned to TS.
/// Also deserializable: the boundsvg SVG emitter parses TS-produced IR JSON
/// whose text lines embed this shape.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphInfo {
    pub glyph_id: u32,
    pub x_advance: f64,
    pub y_advance: f64,
    pub x_offset: f64,
    pub y_offset: f64,
    pub cluster: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_alias: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_style: Option<FontStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation_deg: Option<u16>,
}

/// Shaping options for writing-mode aware glyph selection.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShapeOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub writing_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical_feature_priority: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_orientation: Option<String>,
    /// Font variation settings (parsed from CSS `font-variation-settings`).
    #[serde(default)]
    pub font_variation_settings: Vec<VariationSetting>,
    /// Font feature settings (parsed from CSS `font-feature-settings`).
    #[serde(default)]
    pub font_feature_settings: Vec<FeatureSetting>,
}

/// Glyph run shaped with a specific font alias.
#[derive(Debug, Clone, Default)]
pub struct FallbackGlyphRun {
    pub alias: String,
    pub glyphs: Vec<GlyphInfo>,
}

/// Shape result using a fallback chain.
#[derive(Debug, Clone, Default)]
pub struct FallbackShapeResult {
    pub glyphs: Vec<GlyphInfo>,
    pub runs: Vec<FallbackGlyphRun>,
}

/// Apply letter-spacing tracking to a signed horizontal inline advance.
///
/// Positive tracking must always widen the logical advance magnitude and
/// negative tracking narrow it, regardless of the advance's sign convention.
pub(crate) fn add_inline_tracking(advance: f64, tracking: f64) -> f64 {
    if advance < 0.0 {
        advance - tracking
    } else {
        advance + tracking
    }
}

/// Apply tracking to a vertical top-to-bottom inline advance.
///
/// `HarfBuzz` can represent zero-advance marks as either `0.0` or `-0.0`.
/// Treat both as belonging to the negative vertical progression direction so
/// positive tracking cannot turn an attached mark into an upward advance.
pub(crate) fn add_vertical_inline_tracking(advance: f64, tracking: f64) -> f64 {
    if advance > 0.0 {
        advance + tracking
    } else {
        advance - tracking
    }
}

fn is_vertical(options: &ShapeOptions) -> bool {
    options.writing_mode.as_deref() == Some("vertical-rl")
}

/// Characters that stay upright in vertical text (text-orientation: mixed).
/// Delegates to UTR#50 `vertical_orientation` module.
fn is_upright_in_vertical(ch: char) -> bool {
    vertical_orientation::is_upright_mixed(ch as u32)
}

/// Build a byte-indexed map: true if the character at byte offset is upright in vertical.
pub(crate) fn build_vertical_upright_map(text: &str, options: &ShapeOptions) -> Vec<bool> {
    let text_orientation = options.text_orientation.as_deref().unwrap_or("mixed");
    let mut by_byte = vec![false; text.len()];
    for (byte_offset, ch) in text.char_indices() {
        let upright = match text_orientation {
            "upright" => true,
            _ => is_upright_in_vertical(ch),
        };
        if byte_offset < by_byte.len() {
            by_byte[byte_offset] = upright;
        }
    }
    by_byte
}

/// Build backend-neutral OpenType features for shaping.
fn build_features(options: &ShapeOptions) -> Vec<ShapeFeature> {
    let mut features = Vec::new();

    if is_vertical(options) {
        // UTR#50-compliant: use vert only (vrt2 is deprecated and must not coexist with vert).
        // Also enable vkna so halfwidth kana and prolonged sound marks pick the browser-like
        // vertical alternates instead of staying as horizontal halfwidth glyphs.
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

/// Convert `VariationSetting` values to backend-neutral `ShapeVariation` values.
#[must_use]
pub fn to_shape_variations(settings: &[VariationSetting]) -> Vec<ShapeVariation> {
    settings
        .iter()
        .filter_map(|v| {
            if v.tag.len() == 4 {
                let bytes = v.tag.as_bytes();
                Some(ShapeVariation {
                    tag: [bytes[0], bytes[1], bytes[2], bytes[3]],
                    value: v.value,
                })
            } else {
                None
            }
        })
        .collect()
}

/// Build backend-neutral font variations from options.
fn build_variations(options: &ShapeOptions) -> Vec<ShapeVariation> {
    to_shape_variations(&options.font_variation_settings)
}

fn resolve_vertical_origin_x_px(
    face: &dyn FontFace,
    glyph_id: u16,
    scale: f64,
    fallback_em_size_px: f64,
) -> f64 {
    face.glyph_hor_advance(glyph_id)
        .map(|advance| f64::from(advance) * scale * 0.5)
        .filter(|advance| *advance > 0.0)
        .unwrap_or(fallback_em_size_px * 0.5)
}

fn resolve_vertical_origin_y_px(
    face: &dyn FontFace,
    glyph_id: u16,
    scale: f64,
    fallback_origin_y_px: f64,
) -> f64 {
    face.glyph_y_origin(glyph_id)
        .map(|origin| f64::from(origin) * scale)
        .or_else(|| {
            let bbox = face.glyph_bounding_box(glyph_id)?;
            let top_side_bearing = f64::from(face.glyph_ver_side_bearing(glyph_id)?);
            Some((f64::from(bbox.y_max) + top_side_bearing) * scale)
        })
        .filter(|origin| *origin > 0.0)
        .unwrap_or(fallback_origin_y_px)
}

/// Shape text via the registry's Shaper backend and convert raw glyphs to `GlyphInfo`.
#[expect(
    clippy::cast_possible_truncation,
    reason = "glyph IDs are OpenType u16 stored as u32; byte offsets fit in u32 for text shaping"
)]
fn shape_via_backend(
    registry: &FontRegistry,
    font_entry: &FontEntry,
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
    options: &ShapeOptions,
) -> Vec<GlyphInfo> {
    let features = build_features(options);
    let variations = build_variations(options);
    let vertical = is_vertical(options);
    let direction = if vertical {
        ShapeDirection::TopToBottom
    } else {
        ShapeDirection::LeftToRight
    };

    let Some(shaper_face) = font_entry.shaper_face(registry.shaper()) else {
        return Vec::new();
    };
    #[cfg(any(test, feature = "phase-trace"))]
    crate::phase_trace::record_backend_shape();
    let raw_glyphs = shaper_face.shape(
        text,
        direction,
        options.language.as_deref(),
        &features,
        &variations,
    );

    if raw_glyphs.is_empty() {
        return Vec::new();
    }

    let scale = font_size_px / f64::from(font_entry.units_per_em);
    let em_size_px = f64::from(font_entry.units_per_em) * scale;
    let fallback_vertical_origin_y_px = if let Some(vorg_y) = font_entry.default_vert_origin_y {
        f64::from(vorg_y) * scale
    } else if font_entry.typographic_ascender != 0 {
        f64::from(font_entry.typographic_ascender) * scale
    } else if font_entry.ascender != 0 {
        f64::from(font_entry.ascender) * scale
    } else {
        em_size_px
    };

    // For vertical text, obtain a FontFace for per-glyph metric queries.
    // Routed through the FontEntry cache so the unvaried face is parsed once
    // and reused instead of re-parsed on every shape call.
    let font_face = if vertical {
        font_entry.font_face(registry.backend(), &variations)
    } else {
        None
    };
    let upright_by_byte = if vertical {
        Some(build_vertical_upright_map(text, options))
    } else {
        None
    };

    raw_glyphs
        .iter()
        .enumerate()
        .map(|(i, raw)| {
            let mut x_advance = f64::from(raw.x_advance) * scale;
            let mut y_advance = f64::from(raw.y_advance) * scale;
            let raw_x_offset = f64::from(raw.x_offset) * scale;
            let raw_y_offset = f64::from(raw.y_offset) * scale;
            let mut x_offset = raw_x_offset;
            let mut y_offset = raw_y_offset;
            let mut rotation_deg = 0;
            // Tracking belongs between text clusters, not between every
            // emitted glyph. Combining marks and variation selectors can
            // produce an extra glyph at the same cluster and must stay
            // attached to their base character.
            let tracking_adjust = if letter_spacing_px != 0.0
                && raw_glyphs
                    .get(i + 1)
                    .is_some_and(|next| next.cluster != raw.cluster)
            {
                letter_spacing_px
            } else {
                0.0
            };
            // Add tracking in the inline progression axis (sign-aware:
            // vertical advances are negative).
            if tracking_adjust != 0.0 {
                if vertical {
                    y_advance = add_vertical_inline_tracking(y_advance, tracking_adjust);
                } else {
                    x_advance = add_inline_tracking(x_advance, tracking_adjust);
                }
            }

            if vertical {
                let upright = upright_by_byte
                    .as_ref()
                    .and_then(|m| m.get(raw.cluster as usize))
                    .copied()
                    .unwrap_or(true);
                rotation_deg = if upright { 0 } else { 90 };
                if upright {
                    let glyph_id = raw.glyph_id as u16;
                    let origin_x_px = font_face.as_ref().map_or(em_size_px * 0.5, |face| {
                        resolve_vertical_origin_x_px(face.as_ref(), glyph_id, scale, em_size_px)
                    });
                    let origin_y_px =
                        font_face
                            .as_ref()
                            .map_or(fallback_vertical_origin_y_px, |face| {
                                resolve_vertical_origin_y_px(
                                    face.as_ref(),
                                    glyph_id,
                                    scale,
                                    fallback_vertical_origin_y_px,
                                )
                            });

                    // Path extraction uses the glyph's horizontal origin, while vertical
                    // shaping positions are expressed relative to the vertical origin.
                    // Convert to our absolute-origin model using per-glyph vertical metrics.
                    x_offset = raw_x_offset + origin_x_px;
                    y_offset = origin_y_px;
                } else {
                    // Sideways glyphs in vertical text use their horizontal advance as the
                    // logical height. The final ink centering is resolved from per-glyph
                    // extents during outline extraction, similar to HarfBuzz/Pango's
                    // separation of logical advance and ink extents.
                    let raw_x_advance_abs = f64::from(raw.x_advance).abs() * scale;
                    let raw_y_advance_abs = f64::from(raw.y_advance).abs() * scale;
                    let advance_abs = if raw_x_advance_abs == 0.0 && raw_y_advance_abs == 0.0 {
                        0.0
                    } else {
                        font_face
                            .as_ref()
                            .and_then(|face| face.glyph_hor_advance(raw.glyph_id as u16))
                            .filter(|advance| *advance > 0)
                            .map_or_else(
                                || raw_x_advance_abs.max(raw_y_advance_abs),
                                |advance| f64::from(advance) * scale,
                            )
                    };
                    let signed_advance = if raw.y_advance > 0 {
                        advance_abs
                    } else {
                        -advance_abs
                    };
                    y_advance = add_vertical_inline_tracking(signed_advance, tracking_adjust);
                    // HarfBuzz sideways runs are positioned relative to the logical cell's
                    // leading edge. Our vertical column model uses the cell center as the
                    // anchor, so normalize x_offset into that coordinate space.
                    x_offset = raw_x_offset + advance_abs * 0.5;
                    y_offset = advance_abs * 0.5;
                }
            }

            GlyphInfo {
                glyph_id: raw.glyph_id,
                x_advance,
                y_advance,
                x_offset,
                y_offset,
                cluster: raw.cluster,
                font_alias: Some(font_entry.key.alias.clone()),
                font_weight: Some(font_entry.key.weight),
                font_style: Some(font_entry.key.style.clone()),
                rotation_deg: Some(rotation_deg),
            }
        })
        .collect()
}

/// Shape text using the registry's backend and return glyph info array
#[must_use]
pub fn shape_text(
    registry: &FontRegistry,
    font_entry: &FontEntry,
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
) -> Vec<GlyphInfo> {
    shape_text_with_options(
        registry,
        font_entry,
        text,
        font_size_px,
        letter_spacing_px,
        &ShapeOptions::default(),
    )
}

/// Shape text using the registry's backend and return glyph info array (writing-mode aware).
#[must_use]
pub fn shape_text_with_options(
    registry: &FontRegistry,
    font_entry: &FontEntry,
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
    options: &ShapeOptions,
) -> Vec<GlyphInfo> {
    shape_via_backend(
        registry,
        font_entry,
        text,
        font_size_px,
        letter_spacing_px,
        options,
    )
}

/// A variation axis setting (e.g. wght=700)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VariationSetting {
    pub tag: String, // 4-char tag e.g. "wght"
    pub value: f32,
}

/// An OpenType feature setting (e.g. liga=1, smcp=1, tnum=1)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureSetting {
    pub tag: String, // 4-char tag e.g. "liga"
    pub value: u32,  // 0 = off, 1 = on, 2+ = select alternate
}

/// Render parsed variation settings back into CSS `font-variation-settings` text.
///
/// `ResolvedStyle` carries variation / feature settings as CSS text (it is the
/// form the positioned-glyph DTO needs), while `TextLayoutRequest` carries them
/// already parsed. This converts between the two so a request's settings can
/// seed the default rich-text style.
#[must_use]
pub fn format_css_font_variation_settings(settings: &[VariationSetting]) -> Option<String> {
    if settings.is_empty() {
        return None;
    }
    Some(
        settings
            .iter()
            .map(|setting| format!("\"{}\" {}", setting.tag, setting.value))
            .collect::<Vec<_>>()
            .join(", "),
    )
}

/// Render parsed feature settings back into CSS `font-feature-settings` text.
#[must_use]
pub fn format_css_font_feature_settings(settings: &[FeatureSetting]) -> Option<String> {
    if settings.is_empty() {
        return None;
    }
    Some(
        settings
            .iter()
            .map(|setting| format!("\"{}\" {}", setting.tag, setting.value))
            .collect::<Vec<_>>()
            .join(", "),
    )
}

/// Parse a CSS `font-variation-settings` string into a `Vec<VariationSetting>`.
///
/// Accepts: `"'wght' 700, 'wdth' 125"` or `"\"wght\" 700"`.
/// Returns an empty Vec on any parse error (Recoverable Error pattern).
#[must_use]
pub fn parse_css_font_variation_settings(css: &str) -> Vec<VariationSetting> {
    let trimmed = css.trim();
    if trimmed.is_empty() || trimmed == "normal" {
        return Vec::new();
    }

    let mut settings = Vec::new();
    for part in trimmed.split(',') {
        let segment = part.trim();
        if segment.is_empty() {
            continue;
        }

        let Some(quote) = segment.chars().next() else {
            continue;
        };
        if quote != '\'' && quote != '"' {
            return Vec::new();
        }

        let rest = &segment[1..];
        let Some(end_quote_idx) = rest.find(quote) else {
            return Vec::new();
        };

        let tag_text = &rest[..end_quote_idx];
        let value_text = rest[end_quote_idx + 1..].trim();
        if tag_text.len() != 4 {
            return Vec::new();
        }

        let Ok(value) = value_text.parse::<f32>() else {
            return Vec::new();
        };

        settings.push(VariationSetting {
            tag: tag_text.to_string(),
            value,
        });
    }

    settings
}

/// Serialize a `&[VariationSetting]` into a CSS `font-variation-settings` string.
///
/// Output format: `"'wght' 700, 'wdth' 125"`.
/// Returns an empty string for an empty slice.
#[must_use]
#[expect(
    clippy::cast_possible_truncation,
    reason = "variation values are integer-like floats (e.g. wght=700); i32 range is sufficient for CSS output"
)]
pub fn to_css_font_variation_settings(settings: &[VariationSetting]) -> String {
    settings
        .iter()
        .map(|s| {
            if s.value.fract() == 0.0 {
                format!("'{}' {}", s.tag, s.value as i32)
            } else {
                format!("'{}' {}", s.tag, s.value)
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Parse a CSS `font-feature-settings` string into a `Vec<FeatureSetting>`.
///
/// Accepts:
/// - `"liga" 1, "kern" 0` — explicit integer values
/// - `"liga" on` / `"liga" off` — boolean shortcuts
/// - `"liga"` — value defaults to 1
///
/// Returns an empty Vec on any parse error (Recoverable Error pattern).
#[must_use]
pub fn parse_css_font_feature_settings(css: &str) -> Vec<FeatureSetting> {
    let trimmed = css.trim();
    if trimmed.is_empty() || trimmed == "normal" {
        return Vec::new();
    }

    let mut settings = Vec::new();
    for part in trimmed.split(',') {
        let segment = part.trim();
        if segment.is_empty() {
            continue;
        }

        let Some(quote) = segment.chars().next() else {
            continue;
        };
        if quote != '\'' && quote != '"' {
            return Vec::new();
        }

        let rest = &segment[1..];
        let Some(end_quote_idx) = rest.find(quote) else {
            return Vec::new();
        };

        let tag_text = &rest[..end_quote_idx];
        let value_text = rest[end_quote_idx + 1..].trim();
        if tag_text.len() != 4 {
            return Vec::new();
        }

        let value = if value_text.is_empty() || value_text.eq_ignore_ascii_case("on") {
            1 // CSS default: bare tag or "on" means 1
        } else if value_text.eq_ignore_ascii_case("off") {
            0
        } else {
            match value_text.parse::<u32>() {
                Ok(v) => v,
                Err(_) => return Vec::new(),
            }
        };

        settings.push(FeatureSetting {
            tag: tag_text.to_string(),
            value,
        });
    }

    settings
}

/// Serialize a `&[FeatureSetting]` into a CSS `font-feature-settings` string.
///
/// Output format: `"'liga' 1, 'smcp' 1"`.
/// Returns an empty string for an empty slice.
#[must_use]
pub fn to_css_font_feature_settings(settings: &[FeatureSetting]) -> String {
    settings
        .iter()
        .map(|s| format!("'{}' {}", s.tag, s.value))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Measure total advance width of shaped glyphs
#[must_use]
pub fn measure_width(glyphs: &[GlyphInfo]) -> f64 {
    glyphs.iter().map(|g| g.x_advance).sum()
}

fn has_only_supported_glyphs(glyphs: &[GlyphInfo]) -> bool {
    !glyphs.is_empty() && glyphs.iter().all(|glyph| glyph.glyph_id != 0)
}

fn resolve_fallback_entries<'a>(
    font_ctx: &super::FontContext<'a>,
    weight: u16,
    style: &FontStyle,
) -> Vec<(String, &'a FontEntry)> {
    // Each alias resolves against the primary registry first, then the
    // fallback registry. Merging both into ONE candidate list keeps the
    // per-grapheme glyph-availability selection working when the aliases
    // are split across registries (inline fonts + engine-registered fonts);
    // resolving per registry made a miss in the primary registry re-shape
    // the whole text against the fallback registry instead.
    font_ctx
        .families
        .iter()
        .filter_map(|alias| {
            font_ctx
                .registry
                .resolve(alias, weight, style)
                .or_else(|| {
                    font_ctx
                        .fallback_registry
                        .and_then(|fallback| fallback.resolve(alias, weight, style))
                })
                .map(|entry| (alias.clone(), entry))
        })
        .collect()
}

/// Shape text with fallback chain and options:
/// 1) choose a font per grapheme cluster by glyph availability
/// 2) merge contiguous graphemes into runs
/// 3) shape each run with its selected font
#[must_use]
pub fn shape_with_fallback_and_options(
    font_ctx: &super::FontContext<'_>,
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
    options: &ShapeOptions,
) -> FallbackShapeResult {
    let resolved_entries = resolve_fallback_entries(font_ctx, font_ctx.weight, font_ctx.style);
    if resolved_entries.is_empty() || text.is_empty() {
        return FallbackShapeResult::default();
    }

    let mut grapheme_offset = 0usize;
    let graphemes: Vec<(usize, String)> = grapheme_split(text)
        .into_iter()
        .map(|grapheme| {
            let start = grapheme_offset;
            grapheme_offset += grapheme.len();
            (start, grapheme)
        })
        .collect();
    if graphemes.is_empty() {
        return FallbackShapeResult::default();
    }

    // Step 1: choose font per grapheme by probing glyph availability. This
    // keeps combining marks, emoji selectors, and IVS sequences in the same
    // shaping run as their base character.
    let mut chosen_font_idx: Vec<usize> = Vec::with_capacity(graphemes.len());
    for (_, grapheme) in &graphemes {
        let mut selected = 0usize; // primary fallback
        for (idx, (_, entry)) in resolved_entries.iter().enumerate() {
            let probe = shape_text_with_options(
                font_ctx.registry,
                entry,
                grapheme,
                font_size_px,
                0.0,
                options,
            );
            if has_only_supported_glyphs(&probe) {
                selected = idx;
                break;
            }
        }
        chosen_font_idx.push(selected);
    }

    // Step 2: build contiguous runs.
    let mut run_specs: Vec<(usize, usize, usize)> = Vec::new();
    let mut run_start_grapheme_idx = 0usize;
    let mut current_font_idx = chosen_font_idx[0];
    for i in 1..graphemes.len() {
        if chosen_font_idx[i] != current_font_idx {
            let start = graphemes[run_start_grapheme_idx].0;
            let end = graphemes[i].0;
            run_specs.push((current_font_idx, start, end));
            run_start_grapheme_idx = i;
            current_font_idx = chosen_font_idx[i];
        }
    }
    run_specs.push((
        current_font_idx,
        graphemes[run_start_grapheme_idx].0,
        text.len(),
    ));

    // Step 3: shape each run with the chosen font and stitch clusters.
    let mut runs: Vec<FallbackGlyphRun> = Vec::with_capacity(run_specs.len());
    let mut all_glyphs: Vec<GlyphInfo> = Vec::new();
    for (run_idx, (font_idx, start, end)) in run_specs.iter().enumerate() {
        let (alias, entry) = &resolved_entries[*font_idx];
        let run_text = &text[*start..*end];
        let mut glyphs = shape_text_with_options(
            font_ctx.registry,
            entry,
            run_text,
            font_size_px,
            letter_spacing_px,
            options,
        );
        if glyphs.is_empty() {
            continue;
        }

        // Keep total letterSpacing compatible with whole-string shaping by
        // adding one boundary spacing at each non-final run.
        if run_idx < run_specs.len() - 1 && letter_spacing_px != 0.0 {
            if let Some(last) = glyphs.last_mut() {
                if is_vertical(options) {
                    last.y_advance =
                        add_vertical_inline_tracking(last.y_advance, letter_spacing_px);
                } else {
                    last.x_advance = add_inline_tracking(last.x_advance, letter_spacing_px);
                }
            }
        }

        #[expect(
            clippy::cast_possible_truncation,
            reason = "byte offset within a text string; text length is well within u32::MAX"
        )]
        let cluster_offset = *start as u32;
        for g in &mut glyphs {
            g.cluster = g.cluster.saturating_add(cluster_offset);
        }

        all_glyphs.extend(glyphs.iter().cloned());
        runs.push(FallbackGlyphRun {
            alias: alias.clone(),
            glyphs,
        });
    }

    FallbackShapeResult {
        glyphs: all_glyphs,
        runs,
    }
}

/// Shape text with fallback chain: try each font in order
#[must_use]
pub fn shape_with_fallback(
    registry: &FontRegistry,
    aliases: &[String],
    weight: u16,
    style: &FontStyle,
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
) -> (Vec<GlyphInfo>, String) {
    let font_ctx = super::FontContext {
        registry,
        fallback_registry: None,
        families: aliases,
        weight,
        style,
    };
    let shaped = shape_with_fallback_and_options(
        &font_ctx,
        text,
        font_size_px,
        letter_spacing_px,
        &ShapeOptions::default(),
    );
    let primary_alias = shaped
        .runs
        .first()
        .map(|run| run.alias.clone())
        .unwrap_or_default();
    (shaped.glyphs, primary_alias)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_registry() -> FontRegistry {
        let mut reg = FontRegistry::new();
        let data = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font");
        reg.register(data, "NotoSansJP".into(), 400, FontStyle::Normal)
            .unwrap();
        reg
    }

    /// Regression: with aliases split across registries (inline fonts in
    /// the primary, engine fonts in the fallback registry), per-character
    /// fallback used to collapse — a miss in the primary registry re-shaped
    /// the whole text against the fallback registry.
    #[test]
    fn per_char_fallback_across_registries() {
        let mut primary = FontRegistry::new();
        primary
            .register(
                std::fs::read(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../fixtures/fonts/Inter-Variable.ttf"
                ))
                .expect("Inter font"),
                "Latin".into(),
                400,
                FontStyle::Normal,
            )
            .unwrap();
        let mut fallback = FontRegistry::new();
        fallback
            .register(
                std::fs::read(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
                ))
                .expect("Noto font"),
                "JP".into(),
                400,
                FontStyle::Normal,
            )
            .unwrap();

        let families = vec!["Latin".to_string(), "JP".to_string()];
        let font_ctx = crate::font::FontContext {
            registry: &primary,
            fallback_registry: Some(&fallback),
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let result = shape_with_fallback_and_options(
            &font_ctx,
            "\u{65e5}\u{672c}ABC",
            16.0,
            0.0,
            &ShapeOptions::default(),
        );

        let latin_count = result
            .glyphs
            .iter()
            .filter(|g| g.font_alias.as_deref() == Some("Latin"))
            .count();
        let jp_count = result
            .glyphs
            .iter()
            .filter(|g| g.font_alias.as_deref() == Some("JP"))
            .count();
        assert!(
            latin_count >= 3,
            "ABC must shape with the primary-registry font, got {latin_count} Latin glyphs"
        );
        assert!(
            jp_count >= 2,
            "CJK must fall back to the fallback-registry font, got {jp_count} JP glyphs"
        );
    }

    #[cfg(feature = "unicode-full")]
    #[test]
    fn fallback_keeps_variation_selector_with_its_base_grapheme() {
        let mut registry = FontRegistry::new();
        registry
            .register(
                std::fs::read(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../fixtures/fonts/Inter-Variable.ttf"
                ))
                .expect("Inter font"),
                "Latin".into(),
                400,
                FontStyle::Normal,
            )
            .unwrap();
        registry
            .register(
                std::fs::read(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
                ))
                .expect("Noto font"),
                "JP".into(),
                400,
                FontStyle::Normal,
            )
            .unwrap();

        let families = vec!["Latin".to_string(), "JP".to_string()];
        let font_ctx = crate::font::FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let text = "\u{65e5}\u{e0100}";
        let without_tracking =
            shape_with_fallback_and_options(&font_ctx, text, 16.0, 0.0, &ShapeOptions::default());
        let with_tracking =
            shape_with_fallback_and_options(&font_ctx, text, 16.0, 2.0, &ShapeOptions::default());

        assert_eq!(with_tracking.runs.len(), 1);
        assert_eq!(with_tracking.runs[0].alias, "JP");
        assert!(with_tracking.glyphs.iter().all(|glyph| glyph.cluster == 0));
        assert!(
            (measure_width(&with_tracking.glyphs) - measure_width(&without_tracking.glyphs)).abs()
                < 0.01,
            "tracking must not be inserted inside an IVS grapheme"
        );
    }

    #[test]
    fn test_shape_ascii() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let glyphs = shape_text(&registry, entry, "Hello", 16.0, 0.0);
        assert!(!glyphs.is_empty());
        assert_eq!(glyphs.len(), 5);
        let width = measure_width(&glyphs);
        assert!(width > 0.0, "Width should be positive");
    }

    #[test]
    fn test_shape_japanese() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let glyphs = shape_text(&registry, entry, "こんにちは", 16.0, 0.0);
        assert!(!glyphs.is_empty());
        let width = measure_width(&glyphs);
        assert!(width > 0.0);
    }

    #[test]
    fn test_letter_spacing() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let glyphs_no_spacing = shape_text(&registry, entry, "AB", 16.0, 0.0);
        let glyphs_with_spacing = shape_text(&registry, entry, "AB", 16.0, 5.0);
        let w1 = measure_width(&glyphs_no_spacing);
        let w2 = measure_width(&glyphs_with_spacing);
        // Letter spacing of 5px applied to first glyph only (2 chars - 1 = 1 spacing)
        assert!((w2 - w1 - 5.0).abs() < 0.01);
    }

    #[test]
    fn test_shape_empty() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let glyphs = shape_text(&registry, entry, "", 16.0, 0.0);
        assert!(glyphs.is_empty());
    }

    #[test]
    fn test_font_size_scaling() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let glyphs_16 = shape_text(&registry, entry, "A", 16.0, 0.0);
        let glyphs_32 = shape_text(&registry, entry, "A", 32.0, 0.0);
        let w16 = measure_width(&glyphs_16);
        let w32 = measure_width(&glyphs_32);
        assert!(
            (w32 / w16 - 2.0).abs() < 0.01,
            "32px should be 2x wider than 16px"
        );
    }

    #[test]
    fn test_shape_vertical_japanese_has_vertical_advances() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let options = ShapeOptions {
            writing_mode: Some("vertical-rl".into()),
            language: Some("ja".into()),
            ..ShapeOptions::default()
        };
        let glyphs = shape_text_with_options(&registry, entry, "。", 24.0, 0.0, &options);
        assert!(!glyphs.is_empty());
        let glyph = &glyphs[0];
        assert!(
            glyph.y_advance.abs() > 0.0 || glyph.x_advance.abs() > 0.0,
            "vertical shape should produce measurable advance"
        );
    }

    #[test]
    fn test_vertical_letter_spacing_applies_to_y_advance() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let options = ShapeOptions {
            writing_mode: Some("vertical-rl".into()),
            language: Some("ja".into()),
            ..ShapeOptions::default()
        };
        let glyphs_no_spacing =
            shape_text_with_options(&registry, entry, "。、", 24.0, 0.0, &options);
        let glyphs_with_spacing =
            shape_text_with_options(&registry, entry, "。、", 24.0, 5.0, &options);

        assert!(glyphs_no_spacing.len() >= 2);
        assert!(glyphs_with_spacing.len() >= 2);
        // Positive spacing widens the logical (absolute) vertical advance of
        // every glyph except the last; the sign convention is preserved.
        // (The previous expectation asserted the signed value grew by +5,
        // which shrank the magnitude of the negative advance.)
        assert!(
            (glyphs_with_spacing[0].y_advance.abs() - glyphs_no_spacing[0].y_advance.abs() - 5.0)
                .abs()
                < 0.05
        );
        assert_eq!(
            glyphs_with_spacing[0].y_advance.is_sign_negative(),
            glyphs_no_spacing[0].y_advance.is_sign_negative()
        );
        assert!((glyphs_with_spacing[1].y_advance - glyphs_no_spacing[1].y_advance).abs() < 0.05);
    }

    #[test]
    fn test_vertical_letter_spacing_widens_pitch_and_negative_narrows() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let options = ShapeOptions {
            writing_mode: Some("vertical-rl".into()),
            language: Some("ja".into()),
            ..ShapeOptions::default()
        };
        let base = shape_text_with_options(&registry, entry, "技術ブログ", 26.0, 0.0, &options);
        let wide = shape_text_with_options(&registry, entry, "技術ブログ", 26.0, 10.0, &options);
        let narrow = shape_text_with_options(&registry, entry, "技術ブログ", 26.0, -4.0, &options);
        assert_eq!(base.len(), 5);
        assert_eq!(wide.len(), 5);
        assert_eq!(narrow.len(), 5);

        for i in 0..4 {
            assert!(
                (wide[i].y_advance.abs() - base[i].y_advance.abs() - 10.0).abs() < 0.05,
                "glyph {i}: positive spacing must widen abs advance"
            );
            assert!(
                (narrow[i].y_advance.abs() - base[i].y_advance.abs() + 4.0).abs() < 0.05,
                "glyph {i}: negative spacing must narrow abs advance"
            );
        }
        // No trailing spacing on the final glyph.
        assert!((wide[4].y_advance - base[4].y_advance).abs() < 0.05);
        assert!((narrow[4].y_advance - base[4].y_advance).abs() < 0.05);

        // Column extent (sum of absolute advances) grows by spacing * (n-1).
        let sum = |glyphs: &[crate::font::shaping::GlyphInfo]| -> f64 {
            glyphs.iter().map(|g| g.y_advance.abs()).sum()
        };
        assert!((sum(&wide) - sum(&base) - 40.0).abs() < 0.2);
        assert!((sum(&narrow) - sum(&base) + 16.0).abs() < 0.2);
    }

    #[test]
    fn test_vertical_sideways_letter_spacing_widens_abs_advance() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let options = ShapeOptions {
            writing_mode: Some("vertical-rl".into()),
            language: Some("ja".into()),
            ..ShapeOptions::default()
        };
        // ASCII runs render sideways (rotation 90) in vertical text.
        let base = shape_text_with_options(&registry, entry, "AB", 32.0, 0.0, &options);
        let wide = shape_text_with_options(&registry, entry, "AB", 32.0, 6.0, &options);
        assert_eq!(base.len(), 2);
        assert_eq!(wide.len(), 2);
        assert_eq!(base[0].rotation_deg, Some(90));
        assert!(
            (wide[0].y_advance.abs() - base[0].y_advance.abs() - 6.0).abs() < 0.05,
            "sideways glyph must also widen by the spacing"
        );
        assert!((wide[1].y_advance - base[1].y_advance).abs() < 0.05);
    }

    #[test]
    fn test_vertical_sideways_ascii_is_centered_within_its_logical_span() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let options = ShapeOptions {
            writing_mode: Some("vertical-rl".into()),
            language: Some("ja".into()),
            ..ShapeOptions::default()
        };
        let glyphs = shape_text_with_options(&registry, entry, "ABC", 64.0, 0.0, &options);
        assert_eq!(glyphs.len(), 3);

        for g in &glyphs {
            assert!(
                g.y_advance.abs() > 0.0 && g.y_advance.abs() <= 64.0,
                "sideways ASCII should use proportional advance (got {})",
                g.y_advance
            );
            assert!(
                g.x_offset.abs() < 0.05,
                "sideways glyph should be normalized to the column center (x_offset={})",
                g.x_offset
            );
            assert!(
                (g.y_offset - g.y_advance.abs() * 0.5).abs() < 0.05,
                "sideways glyph should sit at the center of its logical span: offset={}, advance={}",
                g.y_offset,
                g.y_advance,
            );
        }
    }

    #[test]
    fn test_vertical_sideways_ascii_uses_horizontal_advances() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let options = ShapeOptions {
            writing_mode: Some("vertical-rl".into()),
            language: Some("ja".into()),
            ..ShapeOptions::default()
        };
        let horizontal = shape_text(&registry, entry, "ABC123-", 48.0, 0.0);
        let vertical = shape_text_with_options(&registry, entry, "ABC123-", 48.0, 0.0, &options);

        assert_eq!(horizontal.len(), vertical.len());
        for (h, v) in horizontal.iter().zip(vertical.iter()) {
            assert_eq!(v.rotation_deg, Some(90));
            assert!(
                (v.y_advance.abs() - h.x_advance.abs()).abs() < 0.05,
                "vertical sideways advance should match horizontal advance for glyph {}: vertical={}, horizontal={}",
                v.glyph_id,
                v.y_advance,
                h.x_advance
            );
        }
    }

    #[test]
    fn test_vertical_sideways_offsets_preserve_proportional_height() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let options = ShapeOptions {
            writing_mode: Some("vertical-rl".into()),
            language: Some("ja".into()),
            ..ShapeOptions::default()
        };
        let glyphs_w = shape_text_with_options(&registry, entry, "W", 64.0, 0.0, &options);
        let glyphs_1 = shape_text_with_options(&registry, entry, "1", 64.0, 0.0, &options);
        assert!(!glyphs_w.is_empty());
        assert!(!glyphs_1.is_empty());
        assert!(
            glyphs_w[0].x_offset.abs() < 0.05 && glyphs_1[0].x_offset.abs() < 0.05,
            "sideways glyphs should be normalized to the column center: W={}, 1={}",
            glyphs_w[0].x_offset,
            glyphs_1[0].x_offset,
        );
        assert!(
            glyphs_w[0].y_offset > glyphs_1[0].y_offset,
            "wider glyphs should still occupy more vertical space after normalization: W={}, 1={}",
            glyphs_w[0].y_offset,
            glyphs_1[0].y_offset,
        );
    }

    #[test]
    fn test_vertical_sideways_zero_advance_glyphs_remain_zero() {
        let mut registry = FontRegistry::new();
        registry
            .register(
                std::fs::read(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../fixtures/fonts/Inter-Variable.ttf"
                ))
                .expect("Inter font"),
                "Inter".into(),
                400,
                FontStyle::Normal,
            )
            .expect("register Inter");
        let entry = registry
            .resolve("Inter", 400, &FontStyle::Normal)
            .expect("resolve Inter");
        let options = ShapeOptions {
            writing_mode: Some("vertical-rl".into()),
            language: Some("en".into()),
            text_orientation: Some("mixed".into()),
            ..ShapeOptions::default()
        };

        let decorated =
            shape_text_with_options(&registry, entry, "e\u{0301}\u{0301}", 20.0, 0.0, &options);
        let base = shape_text_with_options(&registry, entry, "e", 20.0, 0.0, &options);
        assert!(decorated.iter().any(|glyph| glyph.y_advance == 0.0));
        assert!(
            (decorated
                .iter()
                .map(|glyph| glyph.y_advance.abs())
                .sum::<f64>()
                - base.iter().map(|glyph| glyph.y_advance.abs()).sum::<f64>())
            .abs()
                < 0.05
        );

        let with_zero_width =
            shape_text_with_options(&registry, entry, "a\u{200b}b", 20.0, 0.0, &options);
        let without_zero_width =
            shape_text_with_options(&registry, entry, "ab", 20.0, 0.0, &options);
        assert!(with_zero_width.iter().any(|glyph| glyph.y_advance == 0.0));
        assert!(
            (with_zero_width
                .iter()
                .map(|glyph| glyph.y_advance.abs())
                .sum::<f64>()
                - without_zero_width
                    .iter()
                    .map(|glyph| glyph.y_advance.abs())
                    .sum::<f64>())
            .abs()
                < 0.05
        );

        // The first acute composes with `e`; the second remains a separate
        // zero-advance glyph and exercises the signed-zero tracking path.
        let tracked_marks =
            shape_text_with_options(&registry, entry, "e\u{0301}\u{0301}b", 20.0, 2.0, &options);
        assert!(tracked_marks.iter().any(|glyph| glyph.y_advance == -2.0));
        assert!(
            tracked_marks.iter().all(|glyph| glyph.y_advance <= 0.0),
            "vertical advances must keep a non-positive inline direction: {tracked_marks:?}"
        );
    }

    #[test]
    #[expect(
        clippy::cast_possible_truncation,
        reason = "glyph IDs are OpenType u16 stored as u32; truncation is correct"
    )]
    fn test_vertical_cjk_offsets_are_normalized_for_svg_anchor() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let options = ShapeOptions {
            writing_mode: Some("vertical-rl".into()),
            language: Some("ja".into()),
            ..ShapeOptions::default()
        };
        let face = registry
            .backend()
            .create_face(&entry.data, &[])
            .expect("parse font");
        let scale = 64.0 / f64::from(entry.units_per_em);
        let fallback_origin_y_px = if let Some(vorg_y) = entry.default_vert_origin_y {
            f64::from(vorg_y) * scale
        } else {
            f64::from(entry.typographic_ascender) * scale
        };
        let glyphs = shape_text_with_options(&registry, entry, "縦", 64.0, 0.0, &options);
        assert_eq!(glyphs.len(), 1);
        let glyph = &glyphs[0];
        let expected_origin_y = resolve_vertical_origin_y_px(
            face.as_ref(),
            glyph.glyph_id as u16,
            scale,
            fallback_origin_y_px,
        );
        assert!(
            glyph.x_offset.abs() < 2.0,
            "full-width CJK should stay horizontally centered in the column after normalization (x={})",
            glyph.x_offset,
        );
        assert!(
            (glyph.y_offset - expected_origin_y).abs() < 0.05,
            "full-width CJK should use its vertical origin metrics (got {}, expected {})",
            glyph.y_offset,
            expected_origin_y
        );
    }

    #[test]
    #[expect(
        clippy::cast_possible_truncation,
        reason = "glyph IDs are OpenType u16 stored as u32; truncation is correct"
    )]
    fn test_vertical_upright_uses_per_glyph_vertical_origin_metrics() {
        let registry = test_registry();
        let entry = registry
            .resolve("NotoSansJP", 400, &FontStyle::Normal)
            .unwrap();
        let options = ShapeOptions {
            writing_mode: Some("vertical-rl".into()),
            language: Some("ja".into()),
            ..ShapeOptions::default()
        };
        let face = registry
            .backend()
            .create_face(&entry.data, &[])
            .expect("parse font");
        let scale = 48.0 / f64::from(entry.units_per_em);
        let fallback_origin_y_px = if let Some(vorg_y) = entry.default_vert_origin_y {
            f64::from(vorg_y) * scale
        } else {
            f64::from(entry.typographic_ascender) * scale
        };

        let dash_pair = shape_text_with_options(
            &registry,
            entry,
            "と\u{2014}\u{2014}な",
            48.0,
            0.0,
            &options,
        );
        let prolonged =
            shape_text_with_options(&registry, entry, "と\u{30FC}", 48.0, 0.0, &options);

        assert_eq!(dash_pair.len(), 3);
        assert_eq!(prolonged.len(), 2);

        let dash_glyph = &dash_pair[1];
        let prolonged_glyph = &prolonged[1];

        let dash_expected = resolve_vertical_origin_y_px(
            face.as_ref(),
            dash_glyph.glyph_id as u16,
            scale,
            fallback_origin_y_px,
        );
        let prolonged_expected = resolve_vertical_origin_y_px(
            face.as_ref(),
            prolonged_glyph.glyph_id as u16,
            scale,
            fallback_origin_y_px,
        );

        assert_eq!(dash_glyph.rotation_deg, Some(0));
        assert_eq!(prolonged_glyph.rotation_deg, Some(0));
        assert!(
            (dash_glyph.y_offset - dash_expected).abs() < 0.05,
            "multi-cell dash should use per-glyph vertical origin: got {}, expected {}",
            dash_glyph.y_offset,
            dash_expected
        );
        assert!(
            (prolonged_glyph.y_offset - prolonged_expected).abs() < 0.05,
            "prolonged sound mark should use per-glyph vertical origin: got {}, expected {}",
            prolonged_glyph.y_offset,
            prolonged_expected
        );
    }
}
