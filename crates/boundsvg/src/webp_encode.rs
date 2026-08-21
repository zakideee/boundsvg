//! Lossless WebP (VP8L) encoding from rasterized SVG pixmaps.

use std::sync::Arc;

use crate::error::EngineError;
use crate::rasterize::{RasterizeOptions, rasterize_svg_to_pixmap};

/// Convert a premultiplied tiny-skia pixmap into straight-alpha RGBA bytes.
///
/// Fully transparent pixels divide by a zero alpha inside `demultiply()`; the
/// resulting NaN saturates to 0 on the float-to-int cast, so they come out as
/// `(0, 0, 0, 0)` rather than as undefined bytes.
pub(crate) fn pixmap_to_rgba(pixmap: &resvg::tiny_skia::Pixmap) -> Vec<u8> {
    let mut rgba = Vec::with_capacity(pixmap.pixels().len() * 4);
    for pixel in pixmap.pixels() {
        let color = pixel.demultiply();
        rgba.extend_from_slice(&[color.red(), color.green(), color.blue(), color.alpha()]);
    }
    rgba
}

/// Encode straight-alpha RGBA bytes as a complete lossless WebP file.
///
/// # Errors
///
/// Returns `EngineError` if the buffer length disagrees with the dimensions,
/// or if the WebP encoder rejects the dimensions or fails to write.
pub(crate) fn rgba_to_webp(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, EngineError> {
    // `image-webp` asserts this internally, and on wasm32 a panic aborts the
    // module past `catch_unwind_to_js` — so reject it as an error instead.
    let expected_len = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4));
    if expected_len != Some(rgba.len()) {
        return Err(EngineError::Rasterize(format!(
            "WebP pixel buffer of {} bytes does not match {width}x{height}",
            rgba.len()
        )));
    }
    let mut out = Vec::new();
    image_webp::WebPEncoder::new(&mut out)
        .encode(rgba, width, height, image_webp::ColorType::Rgba8)
        .map_err(|e| EngineError::Rasterize(format!("Failed to encode WebP: {e}")))?;
    Ok(out)
}

/// Rasterize an SVG string to lossless WebP bytes.
///
/// Mirrors [`crate::rasterize::svg_to_png`]: same rasterization path, same
/// resolution cap, only the container differs.
///
/// # Errors
///
/// Returns `EngineError` if SVG parsing, color parsing, pixmap creation,
/// resolution cap validation, or WebP encoding fails.
pub fn svg_to_webp(
    svg_string: &str,
    alias_map: &[(String, String)],
    font_data: &[Arc<Vec<u8>>],
    options: &RasterizeOptions,
) -> Result<Vec<u8>, EngineError> {
    if let Some(generator) = &options.generator {
        generator.validate()?;
    }
    let pixmap = rasterize_svg_to_pixmap(svg_string, alias_map, font_data, options)?;
    let rgba = pixmap_to_rgba(&pixmap);
    let webp = rgba_to_webp(&rgba, pixmap.width(), pixmap.height())?;
    match &options.generator {
        Some(generator) => wrap_still_webp_with_generator(
            &webp,
            pixmap.width(),
            pixmap.height(),
            rgba.chunks_exact(4).any(|pixel| pixel[3] != u8::MAX),
            generator,
        ),
        None => Ok(webp),
    }
}

fn wrap_still_webp_with_generator(
    bare_webp: &[u8],
    width: u32,
    height: u32,
    has_alpha: bool,
    generator: &crate::output_generator::OutputGenerator,
) -> Result<Vec<u8>, EngineError> {
    const RIFF_HEADER_LEN: usize = 12;
    if bare_webp.len() < RIFF_HEADER_LEN + 8
        || &bare_webp[0..4] != b"RIFF"
        || &bare_webp[8..12] != b"WEBP"
        || &bare_webp[12..16] != b"VP8L"
    {
        return Err(EngineError::Rasterize(
            "Still WebP encoder returned an invalid VP8L container".to_string(),
        ));
    }
    if width == 0 || height == 0 || width > (1 << 24) || height > (1 << 24) {
        return Err(EngineError::Rasterize(format!(
            "Extended WebP canvas must be 1..={} px per edge, got {width}x{height}",
            1 << 24
        )));
    }

    let xmp = generator.xmp_packet();
    let mut out = Vec::with_capacity(bare_webp.len() + xmp.len() + 26);
    out.extend_from_slice(b"RIFF\0\0\0\0WEBP");
    let mut vp8x = Vec::with_capacity(10);
    vp8x.push(0x04 | if has_alpha { 0x10 } else { 0 });
    vp8x.extend_from_slice(&[0, 0, 0]);
    push_u24(&mut vp8x, width - 1);
    push_u24(&mut vp8x, height - 1);
    append_riff_chunk(&mut out, *b"VP8X", &vp8x)?;
    out.extend_from_slice(&bare_webp[RIFF_HEADER_LEN..]);
    append_riff_chunk(&mut out, *b"XMP ", xmp.as_bytes())?;
    finalize_riff_size(&mut out)?;
    Ok(out)
}

pub(crate) fn append_riff_chunk(
    out: &mut Vec<u8>,
    name: [u8; 4],
    payload: &[u8],
) -> Result<(), EngineError> {
    let payload_len = u32::try_from(payload.len())
        .map_err(|_| EngineError::Rasterize("WebP chunk exceeds 4 GiB".to_string()))?;
    out.extend_from_slice(&name);
    out.extend_from_slice(&payload_len.to_le_bytes());
    out.extend_from_slice(payload);
    if payload.len() % 2 == 1 {
        out.push(0);
    }
    Ok(())
}

pub(crate) fn finalize_riff_size(out: &mut [u8]) -> Result<(), EngineError> {
    if out.len() < 12 || &out[0..4] != b"RIFF" || &out[8..12] != b"WEBP" {
        return Err(EngineError::Rasterize(
            "WebP output has an invalid RIFF header".to_string(),
        ));
    }
    let riff_payload_len = u32::try_from(out.len() - 8).map_err(|_| {
        EngineError::Rasterize("WebP exceeds the 4 GiB RIFF container limit".to_string())
    })?;
    out[4..8].copy_from_slice(&riff_payload_len.to_le_bytes());
    Ok(())
}

fn push_u24(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes()[0..3]);
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED_RECT_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#ff0000"/></svg>"##;

    fn encode(svg: &str, options: &RasterizeOptions) -> Vec<u8> {
        svg_to_webp(svg, &[], &[], options).expect("WebP encoding should succeed")
    }

    fn decode(webp: &[u8]) -> (u32, u32, Vec<u8>) {
        let mut decoder = image_webp::WebPDecoder::new(std::io::Cursor::new(webp))
            .expect("output should be a readable WebP");
        let (width, height) = decoder.dimensions();
        let mut buffer = vec![0u8; decoder.output_buffer_size().expect("known buffer size")];
        decoder.read_image(&mut buffer).expect("decodable image");
        (width, height, buffer)
    }

    fn riff_chunk_payload(webp: &[u8], expected_id: [u8; 4]) -> Option<&[u8]> {
        let mut offset = 12usize;
        while offset.saturating_add(8) <= webp.len() {
            let payload_len =
                u32::from_le_bytes(webp[offset + 4..offset + 8].try_into().ok()?) as usize;
            let payload_start = offset + 8;
            let payload_end = payload_start.checked_add(payload_len)?;
            if payload_end > webp.len() {
                return None;
            }
            if webp[offset..offset + 4] == expected_id {
                return Some(&webp[payload_start..payload_end]);
            }
            offset = payload_end + (payload_len % 2);
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
    fn test_simple_svg_to_webp() {
        let webp = encode(RED_RECT_SVG, &RasterizeOptions::default());
        assert_eq!(&webp[0..4], b"RIFF");
        assert_eq!(&webp[8..12], b"WEBP");
        assert_eq!(&webp[12..16], b"VP8L");
    }

    #[test]
    fn test_webp_roundtrip_dimensions() {
        let webp = encode(RED_RECT_SVG, &RasterizeOptions::default());
        let (width, height, pixels) = decode(&webp);
        assert_eq!((width, height), (200, 100));
        // The decoder reports RGBA because the encoder always writes an alpha
        // channel; the fill is opaque red.
        assert_eq!(&pixels[0..4], &[255, 0, 0, 255]);
    }

    #[test]
    fn test_webp_stores_straight_alpha() {
        // A 50%-alpha red fill is premultiplied to (128, 0, 0, 128) in the
        // pixmap. WebP stores straight alpha, so the red channel must come
        // back at full strength — shipping the premultiplied bytes would
        // halve it, and every opaque-pixel assertion would still pass.
        let translucent_svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#ff0000" fill-opacity="0.5"/></svg>"##;
        let (_, _, pixels) = decode(&encode(translucent_svg, &RasterizeOptions::default()));
        assert_eq!(pixels[3], 128, "alpha channel");
        assert!(
            pixels[0] > 250,
            "red channel should be straight alpha, got {}",
            pixels[0]
        );
    }

    #[test]
    fn test_webp_rejects_mismatched_buffer_length() {
        let error = rgba_to_webp(&[0u8; 8], 4, 4).expect_err("length mismatch must be an error");
        assert!(error.to_string().contains("does not match 4x4"));
    }

    #[test]
    fn test_webp_deterministic() {
        let first = encode(RED_RECT_SVG, &RasterizeOptions::default());
        let second = encode(RED_RECT_SVG, &RasterizeOptions::default());
        assert_eq!(first, second);
    }

    #[test]
    fn test_webp_generator_xmp_is_opt_in_and_deterministic() {
        let without_generator = encode(RED_RECT_SVG, &RasterizeOptions::default());
        assert!(riff_chunk_payload(&without_generator, *b"XMP ").is_none());

        let options = RasterizeOptions {
            generator: Some(generator()),
            ..Default::default()
        };
        let first = encode(RED_RECT_SVG, &options);
        let second = encode(RED_RECT_SVG, &options);
        assert_eq!(first, second);
        assert_eq!(&first[12..16], b"VP8X");
        assert_ne!(first[20] & 0x04, 0, "VP8X XMP feature flag");
        let xmp = riff_chunk_payload(&first, *b"XMP ").expect("XMP chunk");
        let xmp = std::str::from_utf8(xmp).expect("UTF-8 XMP");
        assert!(xmp.contains("<boundsvg:name>@scope/aaaa</boundsvg:name>"));
        assert!(xmp.contains("<boundsvg:version>1.2.3-beta.1</boundsvg:version>"));
        assert_eq!(decode(&first).0, 200);
    }

    #[test]
    fn test_webp_scale_and_background() {
        let transparent_svg =
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"></svg>"#;
        let options = RasterizeOptions {
            background: Some("#ffffff".to_string()),
            scale: Some(2.0),
            oversize_behavior: None,
            font_families: None,
            generator: None,
        };
        let (width, height, pixels) = decode(&encode(transparent_svg, &options));
        assert_eq!((width, height), (40, 20));
        assert_eq!(&pixels[0..4], &[255, 255, 255, 255]);
    }
}
