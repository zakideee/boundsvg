use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::EngineError;

const PNG_MAX_LONG_EDGE: f64 = 3840.0;
const PNG_MAX_PIXELS: f64 = 3840.0 * 2160.0;
const PNG_MAX_LONG_EDGE_U32: u32 = 3840;
const PNG_MAX_PIXELS_U64: u64 = 3840 * 2160;

/// Font family mapping configuration for generic CSS families.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamilyConfig {
    pub serif: Option<String>,
    pub sans_serif: Option<String>,
    pub cursive: Option<String>,
    pub fantasy: Option<String>,
    pub monospace: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OversizeBehavior {
    AutoAdjust,
    Error,
}

/// Options for PNG rasterization.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RasterizeOptions {
    /// CSS3 color string for PNG background (e.g. "#ffffff", "rgb(255,255,255)")
    pub background: Option<String>,
    /// Output scale factor (e.g. 2.0 for Retina). Default: 1.0
    pub scale: Option<f64>,
    /// Resolution overflow behavior when PNG exceeds 4K-equivalent cap
    pub oversize_behavior: Option<OversizeBehavior>,
    /// Per-family font mapping for generic CSS families
    pub font_families: Option<FontFamilyConfig>,
    /// Public generator identity embedded in the completed file.
    pub generator: Option<crate::output_generator::OutputGenerator>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayeredSvgValidationLayerInput {
    pub svg: String,
    pub paint_order: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayeredCompositionValidationMetrics {
    pub different_pixels: u32,
    pub difference_ratio: f64,
    pub width: u32,
    pub height: u32,
}

/// Parse a CSS color string into `tiny_skia::Color`.
fn parse_color(color_str: &str) -> Result<resvg::tiny_skia::Color, EngineError> {
    let color = svgtypes::Color::from_str(color_str).map_err(|e| EngineError::ColorParse {
        color: color_str.to_string(),
        reason: e.to_string(),
    })?;
    Ok(resvg::tiny_skia::Color::from_rgba8(
        color.red,
        color.green,
        color.blue,
        color.alpha,
    ))
}

/// SVG to PNG rasterization with alias-aware font resolution.
///
/// - `alias_map`: `(alias, actual_family_name)` pairs for SVG font-family substitution
/// - `font_data`: `Arc<Vec<u8>>` references loaded into fontdb via zero-copy `Source::Binary`
///
/// # Errors
///
/// Returns `EngineError` if SVG parsing, color parsing, pixmap creation,
/// PNG encoding, or resolution cap validation fails.
pub fn svg_to_png(
    svg_string: &str,
    alias_map: &[(String, String)],
    font_data: &[Arc<Vec<u8>>],
    options: &RasterizeOptions,
) -> Result<Vec<u8>, EngineError> {
    if let Some(generator) = &options.generator {
        generator.validate()?;
    }
    let pixmap = rasterize_svg_to_pixmap(svg_string, alias_map, font_data, options)?;

    let png = pixmap
        .encode_png()
        .map_err(|e| EngineError::Rasterize(format!("Failed to encode PNG: {e}")))?;
    match &options.generator {
        Some(generator) => insert_png_generator_chunk(png, generator),
        None => Ok(png),
    }
}

/// Insert one deterministic uncompressed iTXt `Software` chunk immediately
/// after IHDR. The existing encoder output is returned byte-for-byte when no
/// generator was requested, keeping the default hot path unchanged.
fn insert_png_generator_chunk(
    mut png: Vec<u8>,
    generator: &crate::output_generator::OutputGenerator,
) -> Result<Vec<u8>, EngineError> {
    const PNG_SIGNATURE_LEN: usize = 8;
    const IHDR_TOTAL_LEN: usize = 4 + 4 + 13 + 4;
    const INSERT_AT: usize = PNG_SIGNATURE_LEN + IHDR_TOTAL_LEN;
    if png.len() < INSERT_AT
        || &png[..PNG_SIGNATURE_LEN] != b"\x89PNG\r\n\x1a\n"
        || &png[12..16] != b"IHDR"
    {
        return Err(EngineError::Rasterize(
            "PNG encoder returned an invalid header".to_string(),
        ));
    }

    let software = generator.software_text();
    let mut payload = Vec::with_capacity("Software".len() + software.len() + 5);
    payload.extend_from_slice(b"Software\0");
    payload.extend_from_slice(&[0, 0]); // uncompressed, compression method 0
    payload.extend_from_slice(&[0, 0]); // empty language and translated keyword
    payload.extend_from_slice(software.as_bytes());

    let payload_len = u32::try_from(payload.len())
        .map_err(|_| EngineError::Rasterize("PNG generator metadata is too large".to_string()))?;
    let mut chunk = Vec::with_capacity(payload.len() + 12);
    chunk.extend_from_slice(&payload_len.to_be_bytes());
    chunk.extend_from_slice(b"iTXt");
    chunk.extend_from_slice(&payload);
    let mut crc_input = Vec::with_capacity(payload.len() + 4);
    crc_input.extend_from_slice(b"iTXt");
    crc_input.extend_from_slice(&payload);
    chunk.extend_from_slice(&crc32fast::hash(&crc_input).to_be_bytes());

    png.splice(INSERT_AT..INSERT_AT, chunk);
    Ok(png)
}

/// Per-channel tolerance for layer re-composition (8-bit quantization LSB).
const COMPOSITION_CHANNEL_TOLERANCE: u8 = 1;

/// Validates that independently rasterized layers compose to the same pixels as
/// the single SVG output (within `COMPOSITION_CHANNEL_TOLERANCE` per channel).
///
/// # Errors
///
/// Returns `EngineError` if SVG parsing, rasterization, pixmap allocation, or
/// layer dimension validation fails.
pub fn validate_layered_svg_composition(
    single_svg: &str,
    layers: &[LayeredSvgValidationLayerInput],
    alias_map: &[(String, String)],
    font_data: &[Arc<Vec<u8>>],
    options: &RasterizeOptions,
) -> Result<LayeredCompositionValidationMetrics, EngineError> {
    let validation_options = RasterizeOptions {
        background: None,
        scale: None,
        oversize_behavior: None,
        font_families: options.font_families.clone(),
        generator: None,
    };
    let single_pixmap =
        rasterize_svg_to_pixmap(single_svg, alias_map, font_data, &validation_options)?;
    let mut composed_pixmap =
        resvg::tiny_skia::Pixmap::new(single_pixmap.width(), single_pixmap.height())
            .ok_or_else(|| EngineError::Rasterize("Failed to create pixmap".into()))?;

    let mut sorted_layers = layers.to_vec();
    sorted_layers.sort_by_key(|layer| layer.paint_order);

    for layer in sorted_layers {
        let layer_pixmap =
            rasterize_svg_to_pixmap(&layer.svg, alias_map, font_data, &validation_options)?;
        if layer_pixmap.width() != single_pixmap.width()
            || layer_pixmap.height() != single_pixmap.height()
        {
            return Err(EngineError::Rasterize(
                "Layered composition validation requires matching canvas dimensions".into(),
            ));
        }

        composed_pixmap.draw_pixmap(
            0,
            0,
            layer_pixmap.as_ref(),
            &resvg::tiny_skia::PixmapPaint::default(),
            resvg::tiny_skia::Transform::identity(),
            None,
        );
    }

    // Each layer is quantized to an 8-bit pixmap before re-compositing, so a
    // translucent layer over a painted background legitimately differs from
    // the single-pass render by one LSB per channel. Only count pixels whose
    // channel difference exceeds that quantization tolerance.
    let differs = |left: &resvg::tiny_skia::PremultipliedColorU8,
                   right: &resvg::tiny_skia::PremultipliedColorU8| {
        left.red().abs_diff(right.red()) > COMPOSITION_CHANNEL_TOLERANCE
            || left.green().abs_diff(right.green()) > COMPOSITION_CHANNEL_TOLERANCE
            || left.blue().abs_diff(right.blue()) > COMPOSITION_CHANNEL_TOLERANCE
            || left.alpha().abs_diff(right.alpha()) > COMPOSITION_CHANNEL_TOLERANCE
    };
    let different_pixels = u32::try_from(
        composed_pixmap
            .pixels()
            .iter()
            .zip(single_pixmap.pixels().iter())
            .filter(|(left, right)| differs(left, right))
            .count(),
    )
    .unwrap_or(u32::MAX);
    let total_pixels = f64::from(single_pixmap.width()) * f64::from(single_pixmap.height());
    let difference_ratio = if total_pixels == 0.0 {
        0.0
    } else {
        f64::from(different_pixels) / total_pixels
    };

    Ok(LayeredCompositionValidationMetrics {
        different_pixels,
        difference_ratio,
        width: single_pixmap.width(),
        height: single_pixmap.height(),
    })
}

pub(crate) fn rasterize_svg_to_pixmap(
    svg_string: &str,
    alias_map: &[(String, String)],
    font_data: &[Arc<Vec<u8>>],
    options: &RasterizeOptions,
) -> Result<resvg::tiny_skia::Pixmap, EngineError> {
    let requested_scale = options.scale.unwrap_or(1.0);
    assert_valid_raster_scale(requested_scale)?;

    let mut usvg_options = usvg::Options::default();
    register_fonts_into_fontdb(&mut usvg_options, font_data, options);
    let resolved_svg = substitute_font_aliases(svg_string, alias_map);
    let tree = usvg::Tree::from_str(&resolved_svg, &usvg_options)?;

    let size = tree.size();
    let behavior = options
        .oversize_behavior
        .unwrap_or(OversizeBehavior::AutoAdjust);
    let resolution = resolve_png_scale(
        f64::from(size.width()),
        f64::from(size.height()),
        requested_scale,
    )?;

    if resolution.adjusted && behavior == OversizeBehavior::Error {
        return Err(EngineError::Structured {
            code: "PNG_PIXEL_LIMIT".to_string(),
            message: format!(
                "PNG resolution exceeds 4K-equivalent cap: requested={}x{}, cap(longEdge={PNG_MAX_LONG_EDGE_U32}, pixels={PNG_MAX_PIXELS_U64})",
                resolution.requested_width, resolution.requested_height
            ),
            stage: Some(crate::diagnostics::PipelineStage::Emit),
            node_id: None,
        });
    }

    let mut pixmap =
        resvg::tiny_skia::Pixmap::new(resolution.output_width, resolution.output_height)
            .ok_or_else(|| EngineError::Rasterize("Failed to create pixmap".into()))?;

    // Fill background if specified
    if let Some(ref bg) = options.background {
        let color = parse_color(bg)?;
        pixmap.fill(color);
    }

    let transform = if (resolution.applied_scale - 1.0).abs() > f64::from(f32::EPSILON) {
        #[expect(
            clippy::cast_possible_truncation,
            reason = "resvg transforms are f32; output dimensions are resolved in f64 before this paint-only cast"
        )]
        let raster_scale = resolution.applied_scale as f32;
        resvg::tiny_skia::Transform::from_scale(raster_scale, raster_scale)
    } else {
        resvg::tiny_skia::Transform::default()
    };

    resvg::render(&tree, transform, &mut pixmap.as_mut());

    Ok(pixmap)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RasterScaleResolution {
    pub applied_scale: f64,
    pub requested_width: u32,
    pub requested_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub adjusted: bool,
}

fn invalid_scale_error(requested_scale: f64) -> EngineError {
    EngineError::Structured {
        code: "PNG_INVALID_SCALE".to_string(),
        message: format!(
            "Invalid PNG scale factor: {}",
            crate::svg_emit::num_format::format_js_number(requested_scale)
        ),
        stage: Some(crate::diagnostics::PipelineStage::Emit),
        node_id: None,
    }
}

fn assert_valid_raster_scale(requested_scale: f64) -> Result<(), EngineError> {
    if !requested_scale.is_finite() || requested_scale <= 0.0 {
        return Err(invalid_scale_error(requested_scale));
    }
    Ok(())
}

fn invalid_canvas_size_error(name: &str, value: f64) -> EngineError {
    EngineError::Structured {
        code: "INVALID_CANVAS_SIZE".to_string(),
        message: format!(
            "Compiled scene has an invalid canvas {name}: {}",
            crate::svg_emit::num_format::format_js_number(value)
        ),
        stage: Some(crate::diagnostics::PipelineStage::Emit),
        node_id: None,
    }
}

fn assert_valid_raster_canvas_dimension(name: &str, value: f64) -> Result<(), EngineError> {
    if !value.is_finite() || value <= 0.0 {
        return Err(invalid_canvas_size_error(name, value));
    }
    let emitter_rounded = crate::svg_emit::num_format::round_number(value, 2)?;
    if emitter_rounded <= 0.0 {
        return Err(invalid_canvas_size_error(name, value));
    }
    Ok(())
}

fn output_dimension_too_small_error(
    base_width: f64,
    base_height: f64,
    requested_scale: f64,
) -> EngineError {
    EngineError::Structured {
        code: "PNG_OUTPUT_DIMENSION_TOO_SMALL".to_string(),
        message: format!(
            "PNG output rounds to a zero-pixel axis at scale {}: {}x{}",
            crate::svg_emit::num_format::format_js_number(requested_scale),
            crate::svg_emit::num_format::format_js_number(base_width),
            crate::svg_emit::num_format::format_js_number(base_height)
        ),
        stage: Some(crate::diagnostics::PipelineStage::Emit),
        node_id: None,
    }
}

fn assert_positive_raster_output(
    output_width: u32,
    output_height: u32,
    base_width: f64,
    base_height: f64,
    requested_scale: f64,
) -> Result<(), EngineError> {
    if output_width > 0 && output_height > 0 {
        return Ok(());
    }
    Err(output_dimension_too_small_error(
        base_width,
        base_height,
        requested_scale,
    ))
}

pub(crate) fn resolve_png_scale(
    base_width: f64,
    base_height: f64,
    requested_scale: f64,
) -> Result<RasterScaleResolution, EngineError> {
    assert_valid_raster_scale(requested_scale)?;
    assert_valid_raster_canvas_dimension("width", base_width)?;
    assert_valid_raster_canvas_dimension("height", base_height)?;

    let output_dimensions = |scale: f64| raster_output_dimensions(base_width, base_height, scale);
    let (requested_width, requested_height) = output_dimensions(requested_scale);
    assert_positive_raster_output(
        requested_width,
        requested_height,
        base_width,
        base_height,
        requested_scale,
    )?;

    let fits_caps = |width: u32, height: u32| {
        width.max(height) <= PNG_MAX_LONG_EDGE_U32
            && u64::from(width) * u64::from(height) <= PNG_MAX_PIXELS_U64
    };

    if fits_caps(requested_width, requested_height) {
        return Ok(RasterScaleResolution {
            applied_scale: requested_scale,
            requested_width,
            requested_height,
            output_width: requested_width,
            output_height: requested_height,
            adjusted: false,
        });
    }

    let long_edge_cap = PNG_MAX_LONG_EDGE / base_width.max(base_height);
    let mut applied_scale = requested_scale.min(long_edge_cap);

    let (mut output_width, mut output_height) = output_dimensions(applied_scale);
    assert_positive_raster_output(
        output_width,
        output_height,
        base_width,
        base_height,
        requested_scale,
    )?;
    if fits_caps(output_width, output_height) {
        return Ok(RasterScaleResolution {
            applied_scale,
            requested_width,
            requested_height,
            output_width,
            output_height,
            adjusted: applied_scale < requested_scale,
        });
    }

    // Only a proven integer-dimension violation reaches continuous area
    // correction. This preserves exact-cap requests whose f64 product is a few
    // ulps above the cap but whose emitter-rounded dimensions are legal.
    let long_edge_bounded_width = base_width * applied_scale;
    let long_edge_bounded_height = base_height * applied_scale;
    let long_edge_bounded_area = long_edge_bounded_width * long_edge_bounded_height;
    if long_edge_bounded_area > PNG_MAX_PIXELS {
        applied_scale *= (PNG_MAX_PIXELS / long_edge_bounded_area).sqrt();
    }

    (output_width, output_height) = output_dimensions(applied_scale);
    assert_positive_raster_output(
        output_width,
        output_height,
        base_width,
        base_height,
        requested_scale,
    )?;

    // Independently ceiling both axes can exceed a continuous area limit.
    // Step to the preceding ceil boundary until u64 integer arithmetic proves
    // both caps. `next_down_positive` handles an f64 division that rounds back
    // to the current scale and guarantees forward progress.
    while !fits_caps(output_width, output_height) {
        let width_boundary = if output_width > 1 {
            f64::from(output_width - 1) / base_width
        } else {
            applied_scale
        };
        let height_boundary = if output_height > 1 {
            f64::from(output_height - 1) / base_height
        } else {
            applied_scale
        };
        let corrected_scale = applied_scale.min(width_boundary).min(height_boundary);
        applied_scale = if corrected_scale < applied_scale {
            corrected_scale
        } else {
            next_down_positive(applied_scale)
        };
        (output_width, output_height) = output_dimensions(applied_scale);
        assert_positive_raster_output(
            output_width,
            output_height,
            base_width,
            base_height,
            requested_scale,
        )?;
    }

    Ok(RasterScaleResolution {
        applied_scale,
        requested_width,
        requested_height,
        output_width,
        output_height,
        adjusted: applied_scale < requested_scale,
    })
}

fn next_down_positive(value: f64) -> f64 {
    if value > 0.0 {
        f64::from_bits(value.to_bits() - 1)
    } else {
        0.0
    }
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "float-to-u32 saturation is intentional for oversized requested dimensions; accepted output dimensions are cap-checked"
)]
#[expect(
    clippy::cast_sign_loss,
    reason = "validated SVG dimensions and scale are positive; degenerate inputs intentionally saturate to zero for rejection"
)]
fn raster_output_dimensions(base_width: f64, base_height: f64, scale: f64) -> (u32, u32) {
    let output_dimension = |base: f64| {
        let scaled = base * scale;
        let emitter_rounded = if scaled.is_finite() {
            crate::svg_emit::num_format::round_number(scaled, 2).unwrap_or(scaled)
        } else {
            scaled
        };
        emitter_rounded.ceil() as u32
    };
    (output_dimension(base_width), output_dimension(base_height))
}

/// Replace font-family alias strings in the SVG with actual font family names
/// so that resvg/fontdb can resolve them.
fn substitute_font_aliases(svg: &str, alias_map: &[(String, String)]) -> String {
    if alias_map.is_empty() {
        return svg.to_string();
    }

    let alias_lookup: HashMap<String, String> = alias_map
        .iter()
        .filter(|(alias, family_name)| !alias.is_empty() && alias != family_name)
        .map(|(alias, family_name)| (alias.clone(), family_name.clone()))
        .collect();
    if alias_lookup.is_empty() {
        return svg.to_string();
    }

    let mut result = String::with_capacity(svg.len());
    let mut cursor = 0;
    while let Some(rel_start) = svg[cursor..].find('<') {
        let tag_start = cursor + rel_start;
        result.push_str(&svg[cursor..tag_start]);

        if let Some(rel_end) = svg[tag_start..].find('>') {
            let tag_end = tag_start + rel_end + 1;
            let tag = &svg[tag_start..tag_end];
            result.push_str(&rewrite_tag_font_attributes(tag, &alias_lookup));
            cursor = tag_end;
        } else {
            // Broken tag — keep the tail as-is.
            result.push_str(&svg[tag_start..]);
            return result;
        }
    }
    result.push_str(&svg[cursor..]);
    result
}

fn rewrite_font_family_list(
    family_list: &str,
    alias_lookup: &HashMap<String, String>,
    outer_quote: Option<char>,
) -> String {
    split_font_family_list(family_list)
        .into_iter()
        .map(|raw| rewrite_family_token(raw.as_str(), alias_lookup, outer_quote))
        .collect::<Vec<_>>()
        .join(", ")
}

fn split_font_family_list(value: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for ch in value.chars() {
        match ch {
            '\'' | '"' => {
                if quote == Some(ch) {
                    quote = None;
                } else if quote.is_none() {
                    quote = Some(ch);
                }
                current.push(ch);
            }
            ',' if quote.is_none() => {
                out.push(current);
                current = String::new();
            }
            _ => current.push(ch),
        }
    }
    out.push(current);
    out
}

fn rewrite_family_token(
    token: &str,
    alias_lookup: &HashMap<String, String>,
    outer_quote: Option<char>,
) -> String {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let (name, quote) = strip_matching_quotes(trimmed);
    let normalized = name.trim();
    if let Some(mapped) = alias_lookup.get(normalized) {
        let quote_to_use = quote.or_else(|| {
            if mapped.contains(' ') {
                Some(match outer_quote {
                    Some('\'') => '"',
                    _ => '\'',
                })
            } else {
                None
            }
        });
        if let Some(q) = quote_to_use {
            return format!("{q}{mapped}{q}");
        }
        return mapped.clone();
    }

    trimmed.to_string()
}

fn strip_matching_quotes(value: &str) -> (&str, Option<char>) {
    let bytes = value.as_bytes();
    if bytes.len() < 2 {
        return (value, None);
    }
    let first = bytes[0] as char;
    let last = bytes[bytes.len() - 1] as char;
    if (first == '"' || first == '\'') && first == last {
        (&value[1..value.len() - 1], Some(first))
    } else {
        (value, None)
    }
}

fn rewrite_tag_font_attributes(tag: &str, alias_lookup: &HashMap<String, String>) -> String {
    if tag.starts_with("<!--") || tag.starts_with("</") {
        return tag.to_string();
    }

    let rewritten_font_family = rewrite_quoted_attr_value(tag, "font-family", |value, quote| {
        rewrite_font_family_list(value, alias_lookup, Some(quote))
    });

    rewrite_quoted_attr_value(&rewritten_font_family, "style", |value, quote| {
        rewrite_inline_style_font_family(value, alias_lookup, quote)
    })
}

fn rewrite_inline_style_font_family(
    style: &str,
    alias_lookup: &HashMap<String, String>,
    outer_quote: char,
) -> String {
    let bytes = style.as_bytes();
    let mut i = 0usize;
    let mut last = 0usize;
    let mut out = String::with_capacity(style.len());

    while i < bytes.len() {
        if matches_ascii_case_insensitive_at(bytes, i, b"font-family")
            && is_css_property_boundary(bytes, i)
        {
            let mut j = i + b"font-family".len();
            while j < bytes.len() && is_ascii_space(bytes[j]) {
                j += 1;
            }
            if j >= bytes.len() || bytes[j] != b':' {
                i += 1;
                continue;
            }

            let mut value_start = j + 1;
            while value_start < bytes.len() && is_ascii_space(bytes[value_start]) {
                value_start += 1;
            }

            let mut value_end = value_start;
            let mut quote: Option<u8> = None;
            while value_end < bytes.len() {
                let b = bytes[value_end];
                if let Some(q) = quote {
                    if b == q {
                        quote = None;
                    }
                    value_end += 1;
                    continue;
                }
                if b == b'\'' || b == b'"' {
                    quote = Some(b);
                    value_end += 1;
                    continue;
                }
                if b == b';' {
                    break;
                }
                value_end += 1;
            }

            out.push_str(&style[last..value_start]);
            let rewritten = rewrite_font_family_list(
                &style[value_start..value_end],
                alias_lookup,
                Some(outer_quote),
            );
            out.push_str(&rewritten);
            last = value_end;
            i = value_end;
            continue;
        }

        i += 1;
    }

    out.push_str(&style[last..]);
    out
}

fn rewrite_quoted_attr_value<F>(input: &str, attr_name: &str, mut rewriter: F) -> String
where
    F: FnMut(&str, char) -> String,
{
    let name_bytes = attr_name.as_bytes();
    let bytes = input.as_bytes();
    let mut i = 0usize;
    let mut last = 0usize;
    let mut out = String::with_capacity(input.len());

    while i < bytes.len() {
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let quote = bytes[i];
            i += 1;
            while i < bytes.len() && bytes[i] != quote {
                i += 1;
            }
            if i < bytes.len() {
                i += 1;
            }
            continue;
        }

        if matches_ascii_case_insensitive_at(bytes, i, name_bytes) && is_attr_boundary(bytes, i) {
            let mut j = i + name_bytes.len();
            while j < bytes.len() && is_ascii_space(bytes[j]) {
                j += 1;
            }
            if j >= bytes.len() || bytes[j] != b'=' {
                i += 1;
                continue;
            }
            j += 1;
            while j < bytes.len() && is_ascii_space(bytes[j]) {
                j += 1;
            }
            if j >= bytes.len() || (bytes[j] != b'"' && bytes[j] != b'\'') {
                i += 1;
                continue;
            }

            let quote = bytes[j] as char;
            let value_start = j + 1;
            let mut value_end = value_start;
            while value_end < bytes.len() && bytes[value_end] != bytes[j] {
                value_end += 1;
            }
            if value_end >= bytes.len() {
                break;
            }

            out.push_str(&input[last..value_start]);
            out.push_str(&rewriter(&input[value_start..value_end], quote));
            last = value_end;
            i = value_end + 1;
            continue;
        }

        i += 1;
    }

    out.push_str(&input[last..]);
    out
}

fn matches_ascii_case_insensitive_at(haystack: &[u8], pos: usize, needle: &[u8]) -> bool {
    if pos + needle.len() > haystack.len() {
        return false;
    }
    haystack[pos..pos + needle.len()].eq_ignore_ascii_case(needle)
}

fn is_attr_boundary(bytes: &[u8], pos: usize) -> bool {
    pos == 0 || is_ascii_space(bytes[pos - 1]) || bytes[pos - 1] == b'<' || bytes[pos - 1] == b'/'
}

fn is_css_property_boundary(bytes: &[u8], pos: usize) -> bool {
    if pos == 0 {
        return true;
    }
    let prev = bytes[pos - 1];
    prev == b';' || is_ascii_space(prev)
}

fn is_ascii_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | b'\x0c')
}

/// Load fonts into fontdb using zero-copy `Source::Binary` and configure generic families.
fn register_fonts_into_fontdb(
    options: &mut usvg::Options,
    font_data: &[Arc<Vec<u8>>],
    rasterize_opts: &RasterizeOptions,
) {
    if font_data.is_empty() {
        return;
    }

    let fontdb = options.fontdb_mut();

    for arc in font_data {
        fontdb.load_font_source(usvg::fontdb::Source::Binary(
            Arc::clone(arc) as Arc<dyn AsRef<[u8]> + Send + Sync>
        ));
    }

    // Apply user-specified font family mappings if provided
    if let Some(ref families) = rasterize_opts.font_families {
        if let Some(ref name) = families.serif {
            fontdb.set_serif_family(name.clone());
        }
        if let Some(ref name) = families.sans_serif {
            fontdb.set_sans_serif_family(name.clone());
        }
        if let Some(ref name) = families.cursive {
            fontdb.set_cursive_family(name.clone());
        }
        if let Some(ref name) = families.fantasy {
            fontdb.set_fantasy_family(name.clone());
        }
        if let Some(ref name) = families.monospace {
            fontdb.set_monospace_family(name.clone());
        }
        return;
    }

    // Fallback: match all generic families to the first loaded face
    let default_family = {
        fontdb
            .faces()
            .next()
            .and_then(|face| face.families.first())
            .map(|(name, _)| name.clone())
    };

    if let Some(default_family) = default_family {
        fontdb.set_serif_family(default_family.clone());
        fontdb.set_sans_serif_family(default_family.clone());
        fontdb.set_cursive_family(default_family.clone());
        fontdb.set_fantasy_family(default_family.clone());
        fontdb.set_monospace_family(default_family);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode_contract_number(value: &serde_json::Value) -> f64 {
        if let Some(number) = value.as_f64() {
            return number;
        }
        match value.as_str() {
            Some("NaN") => f64::NAN,
            Some("Infinity") => f64::INFINITY,
            Some("-Infinity") => f64::NEG_INFINITY,
            Some("MAX_VALUE") => f64::MAX,
            token => panic!("unknown contract number token: {token:?}"),
        }
    }

    fn resolution_tuple(resolution: RasterScaleResolution) -> (f64, u32, u32, u32, u32, bool) {
        (
            resolution.applied_scale,
            resolution.requested_width,
            resolution.requested_height,
            resolution.output_width,
            resolution.output_height,
            resolution.adjusted,
        )
    }

    fn no_alias_map() -> Vec<(String, String)> {
        vec![]
    }

    fn no_font_data() -> Vec<Arc<Vec<u8>>> {
        vec![]
    }

    fn read_png_dimensions(png: &[u8]) -> (u32, u32) {
        assert!(png.len() >= 24, "PNG too small");
        assert_eq!(&png[0..8], &[137, 80, 78, 71, 13, 10, 26, 10]);
        let width = u32::from_be_bytes([png[16], png[17], png[18], png[19]]);
        let height = u32::from_be_bytes([png[20], png[21], png[22], png[23]]);
        (width, height)
    }

    fn png_chunk_payload(png: &[u8], expected_type: [u8; 4]) -> Option<&[u8]> {
        let mut offset = 8usize;
        while offset.saturating_add(12) <= png.len() {
            let payload_len = u32::from_be_bytes(png[offset..offset + 4].try_into().ok()?) as usize;
            let payload_start = offset + 8;
            let payload_end = payload_start.checked_add(payload_len)?;
            let chunk_end = payload_end.checked_add(4)?;
            if chunk_end > png.len() {
                return None;
            }
            if png[offset + 4..offset + 8] == expected_type {
                return Some(&png[payload_start..payload_end]);
            }
            offset = chunk_end;
        }
        None
    }

    fn generator() -> crate::output_generator::OutputGenerator {
        crate::output_generator::OutputGenerator {
            name: "@scope/aaaa".to_string(),
            version: "1.2.3-beta.1".to_string(),
        }
    }

    #[test]
    fn shared_raster_contract_fixture_matches_rust_resolution() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../fixtures/conformance/raster-contract-cases.json"
        ))
        .expect("raster contract fixture must parse");
        assert_eq!(fixture["schemaVersion"], 2, "raster contract schema");

        let cases = fixture["cases"].as_array().expect("fixture cases array");
        for case in cases {
            let label = case["label"].as_str().expect("case label");
            let width =
                decode_contract_number(case.get("effectiveWidth").unwrap_or(&case["width"]));
            let height =
                decode_contract_number(case.get("effectiveHeight").unwrap_or(&case["height"]));
            let requested_scale = decode_contract_number(&case["requestedScale"]);
            let actual = resolve_png_scale(width, height, requested_scale);
            let expected = &case["expected"];
            if expected["kind"] == "error" {
                let code = expected["code"].as_str().expect("expected error code");
                let error = actual.expect_err("contract error case must be rejected");
                match error {
                    EngineError::Structured {
                        code: actual_code, ..
                    } => assert_eq!(actual_code, code, "{label}"),
                    other => panic!("{label}: expected structured error {code}, got {other}"),
                }
                continue;
            }
            let expected_tuple = (
                expected["appliedScale"].as_f64().expect("applied scale"),
                u32::try_from(
                    expected["requestedWidth"]
                        .as_u64()
                        .expect("requested width"),
                )
                .expect("requested width u32"),
                u32::try_from(
                    expected["requestedHeight"]
                        .as_u64()
                        .expect("requested height"),
                )
                .expect("requested height u32"),
                u32::try_from(expected["outputWidth"].as_u64().expect("output width"))
                    .expect("output width u32"),
                u32::try_from(expected["outputHeight"].as_u64().expect("output height"))
                    .expect("output height u32"),
                expected["adjusted"].as_bool().expect("adjusted"),
            );
            assert_eq!(
                resolution_tuple(actual.expect("contract success case must resolve")),
                expected_tuple,
                "{label}"
            );
        }
    }

    #[test]
    fn test_simple_svg_to_png() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
            <rect x="0" y="0" width="200" height="100" fill="#ff0000"/>
        </svg>"##;
        let png = svg_to_png(
            svg,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions::default(),
        )
        .unwrap();
        assert!(!png.is_empty());
        // PNG magic bytes
        assert_eq!(&png[0..4], &[0x89, 0x50, 0x4e, 0x47]);
    }

    #[test]
    fn test_png_generator_itxt_is_opt_in_and_deterministic() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4" fill="#ff0000"/></svg>"##;
        let without_generator = svg_to_png(
            svg,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions::default(),
        )
        .unwrap();
        assert!(png_chunk_payload(&without_generator, *b"iTXt").is_none());

        let options = RasterizeOptions {
            generator: Some(generator()),
            ..Default::default()
        };
        let first = svg_to_png(svg, &no_alias_map(), &no_font_data(), &options).unwrap();
        let second = svg_to_png(svg, &no_alias_map(), &no_font_data(), &options).unwrap();
        assert_eq!(first, second);
        let payload = png_chunk_payload(&first, *b"iTXt").expect("generator iTXt chunk");
        assert_eq!(&payload[..13], b"Software\0\0\0\0\0");
        assert_eq!(&payload[13..], b"@scope/aaaa/1.2.3-beta.1");
    }

    #[test]
    fn test_svg_with_text() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
            <rect x="0" y="0" width="200" height="100" fill="#ffffff"/>
            <text x="10" y="50" font-size="16" fill="#000000">Hello</text>
        </svg>"##;
        let result = svg_to_png(
            svg,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions::default(),
        );
        // resvg may or may not render text without embedded fonts,
        // but it should not error
        assert!(result.is_ok());
    }

    #[test]
    fn test_invalid_svg() {
        let result = svg_to_png(
            "not an svg",
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions::default(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_png_dimensions() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
            <rect x="0" y="0" width="300" height="200" fill="#0000ff"/>
        </svg>"##;
        let png = svg_to_png(
            svg,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions::default(),
        )
        .unwrap();
        assert!(png.len() > 100, "PNG should have reasonable size");
    }

    #[test]
    fn test_registered_font_changes_text_render_result() {
        let font = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font file not found");

        let with_text = r##"<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
            <rect x="0" y="0" width="240" height="120" fill="#ffffff"/>
            <text x="20" y="70" font-size="32" fill="#111111" font-family="sans-serif">縦書き</text>
        </svg>"##;
        let background_only = r##"<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
            <rect x="0" y="0" width="240" height="120" fill="#ffffff"/>
        </svg>"##;

        let font_arc = Arc::new(font);
        let alias_map = vec![("NotoSansJP".to_string(), "Noto Sans JP".to_string())];
        let font_data = vec![font_arc];
        let png_with_text = svg_to_png(
            with_text,
            &alias_map,
            &font_data,
            &RasterizeOptions::default(),
        )
        .unwrap();
        let png_background_only = svg_to_png(
            background_only,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions::default(),
        )
        .unwrap();
        assert_ne!(png_with_text, png_background_only);
    }

    #[test]
    fn test_font_alias_resolved_in_png() {
        let font = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font file not found");

        // SVG uses alias "MyAlias" which doesn't match the font's internal name
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
            <rect x="0" y="0" width="240" height="120" fill="#ffffff"/>
            <text x="20" y="70" font-size="32" fill="#111111" font-family="MyAlias,sans-serif">テスト</text>
        </svg>"##;

        let font_arc = Arc::new(font);
        let alias_map = vec![("MyAlias".to_string(), "Noto Sans JP".to_string())];
        let font_data = vec![font_arc];
        let result = svg_to_png(svg, &alias_map, &font_data, &RasterizeOptions::default());
        assert!(result.is_ok());
    }

    #[test]
    fn test_substitute_font_aliases_does_not_replace_plain_text_or_ids() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80">
            <g id="MyAlias">
              <text x="10" y="30" font-family="MyAlias,sans-serif">MyAlias label</text>
            </g>
        </svg>"#;
        let substituted =
            substitute_font_aliases(svg, &[("MyAlias".to_string(), "Noto Sans JP".to_string())]);

        assert!(
            substituted.contains(r#"id="MyAlias""#),
            "id attribute must not be rewritten"
        );
        assert!(
            substituted.contains(">MyAlias label<"),
            "plain text content must not be rewritten"
        );
        assert!(
            substituted.contains(r#"font-family="'Noto Sans JP', sans-serif""#),
            "font-family attribute should be rewritten safely"
        );
    }

    #[test]
    fn test_substitute_font_aliases_rewrites_style_font_family_only() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80">
            <text x="10" y="30" style="font-family: MyAlias, serif; fill: #000">Test</text>
        </svg>"#;
        let substituted =
            substitute_font_aliases(svg, &[("MyAlias".to_string(), "Noto Sans JP".to_string())]);

        assert!(
            substituted.contains("fill: #000"),
            "non font-family style must stay"
        );
        assert!(
            substituted.contains("style=\"font-family: 'Noto Sans JP', serif; fill: #000\""),
            "style font-family should be rewritten with alias mapping"
        );
    }

    // --- Tests for RasterizeOptions ---

    #[test]
    fn test_background_color_changes_output() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="30" fill="#ff0000"/>
        </svg>"##;

        let png_transparent = svg_to_png(
            svg,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions::default(),
        )
        .unwrap();
        let png_white = svg_to_png(
            svg,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions {
                background: Some("#ffffff".into()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(&png_transparent[0..4], &[0x89, 0x50, 0x4e, 0x47]);
        assert_eq!(&png_white[0..4], &[0x89, 0x50, 0x4e, 0x47]);
        assert_ne!(png_transparent, png_white);
    }

    #[test]
    fn test_scale_doubles_png_size() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">
            <rect x="0" y="0" width="100" height="50" fill="#00ff00"/>
        </svg>"##;

        let png_1x = svg_to_png(
            svg,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions::default(),
        )
        .unwrap();
        let png_2x = svg_to_png(
            svg,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions {
                scale: Some(2.0),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(&png_1x[0..4], &[0x89, 0x50, 0x4e, 0x47]);
        assert_eq!(&png_2x[0..4], &[0x89, 0x50, 0x4e, 0x47]);
        assert!(
            png_2x.len() > png_1x.len(),
            "2x PNG should be larger than 1x"
        );
    }

    #[test]
    fn test_invalid_color_returns_error() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
            <rect x="0" y="0" width="100" height="100" fill="#ff0000"/>
        </svg>"##;
        let result = svg_to_png(
            svg,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions {
                background: Some("not-a-color".into()),
                ..Default::default()
            },
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Invalid color"));
    }

    #[test]
    fn test_invalid_svg_does_not_panic() {
        let result = svg_to_png(
            "<<<definitely not SVG>>>",
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions::default(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_scale_returns_error() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
            <rect x="0" y="0" width="100" height="100" fill="#ff0000"/>
        </svg>"##;
        let result = svg_to_png(
            svg,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions {
                scale: Some(0.0),
                ..Default::default()
            },
        );
        assert!(matches!(
            result,
            Err(EngineError::Structured { ref code, .. }) if code == "PNG_INVALID_SCALE"
        ));

        let result_neg = svg_to_png(
            svg,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions {
                scale: Some(-1.0),
                ..Default::default()
            },
        );
        assert!(matches!(
            result_neg,
            Err(EngineError::Structured { ref code, .. }) if code == "PNG_INVALID_SCALE"
        ));
    }

    #[test]
    fn rasterizer_rejects_contract_zero_axis_cases_with_structured_codes() {
        let cases = [
            (
                r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"/>"#,
                0.0001,
                "PNG_OUTPUT_DIMENSION_TOO_SMALL",
            ),
            (
                r#"<svg xmlns="http://www.w3.org/2000/svg" width="1000000" height="1" viewBox="0 0 1000000 1"/>"#,
                1.0,
                "PNG_OUTPUT_DIMENSION_TOO_SMALL",
            ),
            (
                r#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1000000" viewBox="0 0 1 1000000"/>"#,
                1.0,
                "PNG_OUTPUT_DIMENSION_TOO_SMALL",
            ),
        ];

        for (svg, scale, expected_code) in cases {
            let result = svg_to_png(
                svg,
                &no_alias_map(),
                &no_font_data(),
                &RasterizeOptions {
                    scale: Some(scale),
                    ..Default::default()
                },
            );
            assert!(matches!(
                result,
                Err(EngineError::Structured { ref code, .. }) if code == expected_code
            ));
        }
    }

    #[test]
    fn test_oversize_auto_adjust_keeps_4k_cap() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="1000" viewBox="0 0 5000 1000">
            <rect x="0" y="0" width="5000" height="1000" fill="#ff0000"/>
        </svg>"##;

        let png = svg_to_png(
            svg,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions::default(),
        )
        .unwrap();
        let (width, height) = read_png_dimensions(&png);
        assert_eq!(width, 3840);
        assert_eq!(height, 768);
        assert!(width.max(height) <= PNG_MAX_LONG_EDGE_U32);
        assert!(u64::from(width) * u64::from(height) <= PNG_MAX_PIXELS_U64);
    }

    #[test]
    fn test_pixel_cap_rounding_boundary_stays_within_integer_limits() {
        let requested_scale = (PNG_MAX_PIXELS / (22.0 * 38.0)).sqrt();
        let resolution = resolve_png_scale(22.0, 38.0, requested_scale).unwrap();

        assert!(resolution.adjusted);
        assert!(resolution.output_width.max(resolution.output_height) <= PNG_MAX_LONG_EDGE_U32);
        assert!(
            u64::from(resolution.output_width) * u64::from(resolution.output_height)
                <= PNG_MAX_PIXELS_U64
        );
    }

    #[test]
    fn test_emitter_rounded_exact_pixel_cap_is_not_adjusted() {
        let requested_scale = (PNG_MAX_PIXELS / (19.0 * 19.0)).sqrt();
        let resolution = resolve_png_scale(19.0, 19.0, requested_scale).unwrap();

        assert_eq!(resolution.applied_scale, requested_scale);
        assert_eq!(
            (resolution.requested_width, resolution.requested_height),
            (2880, 2880)
        );
        assert_eq!(
            (resolution.output_width, resolution.output_height),
            (2880, 2880)
        );
        assert!(!resolution.adjusted);
    }

    #[test]
    fn test_fractional_scale_uses_emitter_root_rounding() {
        let resolution = resolve_png_scale(3.0, 3.0, 1.0001).unwrap();

        assert_eq!((resolution.output_width, resolution.output_height), (3, 3));
        assert!(!resolution.adjusted);
    }

    #[test]
    fn test_emitter_rounded_exact_long_edge_is_not_adjusted() {
        let requested_scale = 1_920.000_000_000_000_5;
        let resolution = resolve_png_scale(1.0, 2.0, requested_scale).unwrap();

        assert_eq!(resolution.applied_scale, requested_scale);
        assert_eq!(
            (resolution.requested_width, resolution.requested_height),
            (1920, 3840)
        );
        assert_eq!(
            (resolution.output_width, resolution.output_height),
            (1920, 3840)
        );
        assert!(!resolution.adjusted);
    }

    #[test]
    fn test_ceil_boundary_matrix_stays_within_integer_limits() {
        let mut inspected_cases = 0_u32;
        for width in 1_u32..=128 {
            for height in 1_u32..=128 {
                let base_width = f64::from(width);
                let base_height = f64::from(height);
                let requested_scale = (PNG_MAX_LONG_EDGE / base_width.max(base_height))
                    .min((PNG_MAX_PIXELS / (base_width * base_height)).sqrt());
                let resolution =
                    resolve_png_scale(base_width, base_height, requested_scale).unwrap();
                inspected_cases += 1;
                assert!(
                    resolution.output_width.max(resolution.output_height) <= PNG_MAX_LONG_EDGE_U32
                );
                assert!(
                    u64::from(resolution.output_width) * u64::from(resolution.output_height)
                        <= PNG_MAX_PIXELS_U64,
                    "base={width}x{height}, output={}x{}",
                    resolution.output_width,
                    resolution.output_height
                );
            }
        }
        assert_eq!(inspected_cases, 16_384);
    }

    #[test]
    fn test_finite_dimensions_do_not_overflow_intermediate_area() {
        let resolution = resolve_png_scale(f64::MAX, f64::MAX, f64::MAX).unwrap();

        assert!(resolution.adjusted);
        assert!(resolution.applied_scale.is_finite() && resolution.applied_scale > 0.0);
        assert!(resolution.output_width > 0 && resolution.output_height > 0);
        assert!(resolution.output_width.max(resolution.output_height) <= PNG_MAX_LONG_EDGE_U32);
        assert!(
            u64::from(resolution.output_width) * u64::from(resolution.output_height)
                <= PNG_MAX_PIXELS_U64
        );
    }

    #[test]
    fn test_oversize_error_returns_error() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="1000" viewBox="0 0 5000 1000">
            <rect x="0" y="0" width="5000" height="1000" fill="#ff0000"/>
        </svg>"##;

        let result = svg_to_png(
            svg,
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions {
                oversize_behavior: Some(OversizeBehavior::Error),
                ..Default::default()
            },
        );
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("4K-equivalent cap")
        );
    }

    #[test]
    fn test_parse_color_hex() {
        let c = svgtypes::Color::from_str("#ff8800").unwrap();
        assert_eq!(c.red, 255);
        assert_eq!(c.green, 136);
        assert_eq!(c.blue, 0);
        // Also verify our parse_color produces a valid tiny_skia::Color
        let color = parse_color("#ff8800").unwrap();
        assert!((color.red() - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_parse_color_named() {
        let c = svgtypes::Color::from_str("white").unwrap();
        assert_eq!(c.red, 255);
        assert_eq!(c.green, 255);
        assert_eq!(c.blue, 255);
        let color = parse_color("white").unwrap();
        assert!((color.red() - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_deserialize_options_from_json() {
        let json = r##"{"background":"#ff0000","scale":2.0}"##;
        let opts: RasterizeOptions = serde_json::from_str(json).unwrap();
        assert_eq!(opts.background.as_deref(), Some("#ff0000"));
        assert_eq!(opts.scale, Some(2.0));
    }

    #[test]
    fn test_deserialize_empty_options() {
        let json = "{}";
        let opts: RasterizeOptions = serde_json::from_str(json).unwrap();
        assert!(opts.background.is_none());
        assert!(opts.scale.is_none());
        assert!(opts.oversize_behavior.is_none());
        assert!(opts.font_families.is_none());
    }

    #[test]
    fn test_deserialize_oversize_behavior() {
        let auto_adjust: RasterizeOptions =
            serde_json::from_str(r#"{"oversizeBehavior":"autoAdjust"}"#).unwrap();
        assert_eq!(
            auto_adjust.oversize_behavior,
            Some(OversizeBehavior::AutoAdjust)
        );

        let error: RasterizeOptions =
            serde_json::from_str(r#"{"oversizeBehavior":"error"}"#).unwrap();
        assert_eq!(error.oversize_behavior, Some(OversizeBehavior::Error));
    }

    #[test]
    fn test_deserialize_font_families() {
        let json = r#"{"fontFamilies":{"serif":"Georgia","monospace":"Courier"}}"#;
        let opts: RasterizeOptions = serde_json::from_str(json).unwrap();
        let families = opts.font_families.unwrap();
        assert_eq!(families.serif.as_deref(), Some("Georgia"));
        assert_eq!(families.monospace.as_deref(), Some("Courier"));
        assert!(families.sans_serif.is_none());
    }

    #[test]
    fn test_validate_layered_svg_composition_matches_single_render() {
        let single = r##"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
            <rect x="0" y="0" width="120" height="80" fill="#ffffff"/>
            <rect x="20" y="20" width="60" height="40" fill="rgba(255,0,0,0.5)"/>
        </svg>"##;
        let background = r##"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
            <rect x="0" y="0" width="120" height="80" fill="#ffffff"/>
        </svg>"##;
        let overlay = r#"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
            <rect x="20" y="20" width="60" height="40" fill="rgba(255,0,0,0.5)"/>
        </svg>"#;

        let metrics = validate_layered_svg_composition(
            single,
            &[
                LayeredSvgValidationLayerInput {
                    svg: background.to_string(),
                    paint_order: 0,
                },
                LayeredSvgValidationLayerInput {
                    svg: overlay.to_string(),
                    paint_order: 1,
                },
            ],
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions::default(),
        )
        .unwrap();

        assert_eq!(metrics.different_pixels, 0);
        assert_eq!(metrics.difference_ratio, 0.0);
        assert_eq!(metrics.width, 120);
        assert_eq!(metrics.height, 80);
    }

    #[test]
    fn test_validate_layered_svg_composition_detects_paint_order_mismatch() {
        let single = r##"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
            <rect x="0" y="0" width="120" height="80" fill="#ffffff"/>
            <rect x="20" y="20" width="60" height="40" fill="rgba(255,0,0,0.5)"/>
        </svg>"##;
        let background = r##"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
            <rect x="0" y="0" width="120" height="80" fill="#ffffff"/>
        </svg>"##;
        let overlay = r#"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
            <rect x="20" y="20" width="60" height="40" fill="rgba(255,0,0,0.5)"/>
        </svg>"#;

        let metrics = validate_layered_svg_composition(
            single,
            &[
                LayeredSvgValidationLayerInput {
                    svg: overlay.to_string(),
                    paint_order: 0,
                },
                LayeredSvgValidationLayerInput {
                    svg: background.to_string(),
                    paint_order: 1,
                },
            ],
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions::default(),
        )
        .unwrap();

        assert!(metrics.different_pixels > 0);
        assert!(metrics.difference_ratio > 0.0);
    }

    #[test]
    fn test_validate_layered_svg_composition_errors_on_invalid_layer_svg() {
        let single = r##"<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
            <rect x="0" y="0" width="32" height="32" fill="#ffffff"/>
        </svg>"##;

        let result = validate_layered_svg_composition(
            single,
            &[LayeredSvgValidationLayerInput {
                svg: "not-an-svg".to_string(),
                paint_order: 0,
            }],
            &no_alias_map(),
            &no_font_data(),
            &RasterizeOptions::default(),
        );

        assert!(result.is_err());
    }
}
