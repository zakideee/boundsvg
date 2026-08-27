//! Animated WebP muxing.
//!
//! Each frame is encoded as a complete still lossless WebP, its VP8L chunk is
//! lifted out, and the chunks are re-wrapped in an extended WebP container
//! (VP8X + ANIM + one ANMF per frame). No compression logic lives here — only
//! RIFF framing, so the output is exactly as deterministic as the still
//! encoder.
//!
//! Reference: <https://developers.google.com/speed/webp/docs/riff_container>

use std::sync::Arc;

use crate::error::EngineError;
use crate::raster_anim::{
    AnimatedRasterIterations, AnimationCanvas, AnimationEncodeInput, rasterize_animation_frames,
    validate_animation_input,
};
use crate::webp_encode::{append_riff_chunk, finalize_riff_size, pixmap_to_rgba, rgba_to_webp};

/// VP8X feature flags: alpha (bit 4) is always set because the pipeline is
/// RGBA, animation (bit 1) because this is an animated file.
const VP8X_FLAGS_ALPHA_ANIMATION: u8 = 0x12;

/// ANMF flags: blending "do not blend" (bit 1), disposal "none" (bit 0).
/// Every frame is a full-canvas replacement, so neither is needed.
const ANMF_FLAGS_REPLACE: u8 = 0x02;

/// Offset of the first chunk inside a still WebP: "RIFF" + u32 size + "WEBP".
const RIFF_HEADER_LEN: usize = 12;

/// Fixed part of an ANMF payload: x, y, width-1, height-1, duration (u24 each)
/// plus the flags byte.
const ANMF_HEADER_LEN: usize = 16;

/// Bytes before the first ANMF chunk: the RIFF header, the VP8X chunk, and
/// the ANIM chunk.
const HEADER_LEN: usize = RIFF_HEADER_LEN + (8 + 10) + (8 + 6);

/// Maximum canvas edge the extended container can describe (u24 of edge - 1).
const MAX_CANVAS_EDGE: u32 = 1 << 24;

/// Ceiling on the assembled file. Frames are streamed one at a time so pixel
/// buffers stay bounded, but the compressed frames all accumulate in the
/// output; without a ceiling a large canvas times 300 frames can exhaust
/// wasm32 memory, and an allocation failure there aborts the module instead of
/// producing a catchable error.
const MAX_ANIMATED_WEBP_BYTES: usize = 256 * 1024 * 1024;

/// WebP's ANIM field stores the total play count directly in a u16; zero is
/// reserved for infinite playback.
const MAX_WEBP_ITERATIONS: u32 = 65_535;

/// Encode pre-sampled SVG frames as an animated lossless WebP.
///
/// # Errors
///
/// Returns `EngineError` if validation, rasterization, still-frame encoding,
/// or container assembly fails.
pub fn encode_animated_webp(
    input: &AnimationEncodeInput,
    alias_map: &[(String, String)],
    font_data: &[Arc<Vec<u8>>],
) -> Result<Vec<u8>, EngineError> {
    validate_animation_input(input)?;
    let loop_count = webp_loop_count(input.iterations)?;
    let options = input.options.clone().unwrap_or_default();
    if let Some(generator) = &options.generator {
        generator.validate()?;
    }

    // The VP8X and ANIM chunks need the canvas size, which is only known once
    // the first frame is rasterized, so reserve their bytes up front and fill
    // them in at the end. Growing a header in front of a finished body would
    // hold two copies of a file that can reach the output cap.
    let mut out = vec![0u8; HEADER_LEN];
    let canvas = rasterize_animation_frames(
        &input.frames,
        alias_map,
        font_data,
        &options,
        |index, pixmap| {
            let still = rgba_to_webp(&pixmap_to_rgba(pixmap), pixmap.width(), pixmap.height())?;
            let frame_chunk = extract_vp8l_chunk(&still)?;
            // Checked before the append, so the cap also bounds peak memory.
            if out
                .len()
                .saturating_add(ANMF_HEADER_LEN + 8 + frame_chunk.len())
                > MAX_ANIMATED_WEBP_BYTES
            {
                return Err(EngineError::Rasterize(format!(
                    "Animated WebP exceeds the {MAX_ANIMATED_WEBP_BYTES} byte output limit; reduce the frame count, the scale, or the canvas size"
                )));
            }
            write_anmf_chunk(
                &mut out,
                pixmap.width(),
                pixmap.height(),
                input.frames[index].duration_ms,
                &frame_chunk,
            )?;
            Ok(())
        },
    )?;

    if canvas.width == 0
        || canvas.height == 0
        || canvas.width > MAX_CANVAS_EDGE
        || canvas.height > MAX_CANVAS_EDGE
    {
        return Err(EngineError::Rasterize(format!(
            "Animated WebP canvas must be 1..={MAX_CANVAS_EDGE} px per edge, got {}x{}",
            canvas.width, canvas.height
        )));
    }

    if let Some(generator) = &options.generator {
        let xmp = generator.xmp_packet();
        let padded_chunk_len = 8usize
            .saturating_add(xmp.len())
            .saturating_add(xmp.len() % 2);
        if out.len().saturating_add(padded_chunk_len) > MAX_ANIMATED_WEBP_BYTES {
            return Err(EngineError::Rasterize(format!(
                "Animated WebP exceeds the {MAX_ANIMATED_WEBP_BYTES} byte output limit; reduce the frame count, the scale, or the canvas size"
            )));
        }
        append_riff_chunk(&mut out, *b"XMP ", xmp.as_bytes())?;
    }
    let mut header = Vec::with_capacity(HEADER_LEN);
    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&0u32.to_le_bytes());
    header.extend_from_slice(b"WEBP");
    write_vp8x_chunk(&mut header, canvas, options.generator.is_some());
    write_anim_chunk(&mut header, loop_count);
    debug_assert_eq!(header.len(), HEADER_LEN);
    out[..HEADER_LEN].copy_from_slice(&header);
    finalize_riff_size(&mut out)?;
    Ok(out)
}

/// Lift the VP8L chunk — header, payload, and any pad byte — out of a still
/// WebP so it can be embedded verbatim in an ANMF frame.
fn extract_vp8l_chunk(still_webp: &[u8]) -> Result<Vec<u8>, EngineError> {
    if still_webp.len() < RIFF_HEADER_LEN + 8
        || &still_webp[0..4] != b"RIFF"
        || &still_webp[8..12] != b"WEBP"
        || &still_webp[RIFF_HEADER_LEN..RIFF_HEADER_LEN + 4] != b"VP8L"
    {
        return Err(EngineError::Rasterize(
            "Still WebP frame is not a bare VP8L file".into(),
        ));
    }
    let chunk = &still_webp[RIFF_HEADER_LEN..];
    let payload_len = u32::from_le_bytes(
        chunk[4..8]
            .try_into()
            .map_err(|_| EngineError::Rasterize("Still WebP frame chunk is truncated".into()))?,
    ) as usize;
    // The still encoder emits exactly one chunk when there is no metadata, so
    // the chunk plus its pad byte must account for the whole remainder. A
    // shorter or longer tail means the encoder grew a second chunk and the
    // frame data would no longer be self-contained.
    let expected_len = 8 + payload_len + (payload_len % 2);
    if chunk.len() != expected_len {
        return Err(EngineError::Rasterize(format!(
            "Still WebP frame has {} trailing bytes beyond its VP8L chunk",
            chunk.len().abs_diff(expected_len)
        )));
    }
    Ok(chunk.to_vec())
}

/// Append a u24 little-endian value.
fn push_u24(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes()[0..3]);
}

/// Append a chunk header: the four-character chunk id plus the payload length.
fn push_chunk_header(out: &mut Vec<u8>, name: [u8; 4], payload_len: u32) {
    out.extend_from_slice(&name);
    out.extend_from_slice(&payload_len.to_le_bytes());
}

fn write_vp8x_chunk(out: &mut Vec<u8>, canvas: AnimationCanvas, has_xmp: bool) {
    push_chunk_header(out, *b"VP8X", 10);
    out.push(VP8X_FLAGS_ALPHA_ANIMATION | if has_xmp { 0x04 } else { 0 });
    out.extend_from_slice(&[0, 0, 0]);
    push_u24(out, canvas.width - 1);
    push_u24(out, canvas.height - 1);
}

fn webp_loop_count(iterations: AnimatedRasterIterations) -> Result<u16, EngineError> {
    match iterations {
        AnimatedRasterIterations::Infinite(_) => Ok(0),
        AnimatedRasterIterations::Finite(iteration_count)
            if (1..=MAX_WEBP_ITERATIONS).contains(&iteration_count) =>
        {
            u16::try_from(iteration_count).map_err(|_| {
                EngineError::Rasterize(format!(
                    "Animated WebP iterations must be 1..={MAX_WEBP_ITERATIONS} or infinite, got {iteration_count}"
                ))
            })
        }
        AnimatedRasterIterations::Finite(iteration_count) => Err(EngineError::Rasterize(format!(
            "Animated WebP iterations must be 1..={MAX_WEBP_ITERATIONS} or infinite, got {iteration_count}"
        ))),
    }
}

fn write_anim_chunk(out: &mut Vec<u8>, loop_count: u16) {
    push_chunk_header(out, *b"ANIM", 6);
    // Background color BGRA. Always fully transparent: a caller-supplied
    // background is already baked into every frame's pixels.
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.extend_from_slice(&loop_count.to_le_bytes());
}

fn write_anmf_chunk(
    out: &mut Vec<u8>,
    frame_width: u32,
    frame_height: u32,
    duration_ms: u32,
    frame_chunk: &[u8],
) -> Result<(), EngineError> {
    if frame_width == 0 || frame_height == 0 {
        return Err(EngineError::Rasterize(
            "Animated WebP frames must have a non-zero size".into(),
        ));
    }
    // RIFF keeps the pad byte outside the size field, so padding here would
    // leave the embedded VP8L chunk itself unpadded and corrupt the container.
    // `image-webp` always pads, so an odd chunk means the still encoder changed
    // shape under us.
    if frame_chunk.len() % 2 == 1 {
        return Err(EngineError::Rasterize(
            "Still WebP frame chunk is not padded to an even length".into(),
        ));
    }
    let payload_len = ANMF_HEADER_LEN
        .checked_add(frame_chunk.len())
        .and_then(|len| u32::try_from(len).ok())
        .ok_or_else(|| {
            EngineError::Rasterize("Animated WebP frame exceeds the 4 GiB chunk limit".into())
        })?;

    push_chunk_header(out, *b"ANMF", payload_len);
    // Frame offset, stored halved. Every frame covers the whole canvas.
    push_u24(out, 0);
    push_u24(out, 0);
    push_u24(out, frame_width - 1);
    push_u24(out, frame_height - 1);
    push_u24(out, duration_ms);
    out.push(ANMF_FLAGS_REPLACE);
    out.extend_from_slice(frame_chunk);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image_webp::{LoopCount, WebPDecoder};

    use super::*;
    use crate::raster_anim::{AnimatedRasterInfinite, AnimationFrameInput};

    fn solid_svg(width: u32, height: u32, fill: &str) -> String {
        format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"><rect width="{width}" height="{height}" fill="{fill}"/></svg>"#
        )
    }

    fn infinite() -> AnimatedRasterIterations {
        AnimatedRasterIterations::Infinite(AnimatedRasterInfinite::Infinite)
    }

    fn two_frame_input(iterations: AnimatedRasterIterations) -> AnimationEncodeInput {
        AnimationEncodeInput {
            frames: vec![
                AnimationFrameInput {
                    svg: solid_svg(8, 4, "#ff0000"),
                    duration_ms: 100,
                },
                AnimationFrameInput {
                    svg: solid_svg(8, 4, "#0000ff"),
                    duration_ms: 250,
                },
            ],
            iterations,
            options: None,
        }
    }

    fn encode(input: &AnimationEncodeInput) -> Vec<u8> {
        encode_animated_webp(input, &[], &[]).expect("animated WebP encoding should succeed")
    }

    fn generator() -> crate::output_generator::OutputGenerator {
        crate::output_generator::OutputGenerator {
            name: "@scope/aaaa".to_string(),
            version: "1.2.3-beta.1".to_string(),
        }
    }

    #[test]
    fn test_animated_webp_roundtrip() {
        let bytes = encode(&two_frame_input(infinite()));
        let mut decoder = WebPDecoder::new(Cursor::new(&bytes)).expect("decodable animation");

        assert!(decoder.is_animated());
        assert_eq!(decoder.num_frames(), 2);
        assert_eq!(decoder.dimensions(), (8, 4));
        assert_eq!(decoder.loop_count(), LoopCount::Forever);
        assert_eq!(decoder.loop_duration(), 350);

        let mut buffer = vec![0u8; decoder.output_buffer_size().expect("known buffer size")];
        assert_eq!(decoder.read_frame(&mut buffer).expect("frame 0"), 100);
        assert_eq!(&buffer[0..4], &[255, 0, 0, 255]);
        assert_eq!(decoder.read_frame(&mut buffer).expect("frame 1"), 250);
        assert_eq!(&buffer[0..4], &[0, 0, 255, 255]);
    }

    #[test]
    fn test_animated_webp_total_play_count() {
        let bytes = encode(&two_frame_input(AnimatedRasterIterations::Finite(3)));
        let decoder = WebPDecoder::new(Cursor::new(&bytes)).expect("decodable animation");
        assert_eq!(
            decoder.loop_count(),
            LoopCount::Times(std::num::NonZeroU16::new(3).expect("nonzero"))
        );
    }

    #[test]
    fn webp_iterations_use_the_exact_container_field_bounds() {
        assert_eq!(webp_loop_count(infinite()).expect("infinite"), 0);
        assert_eq!(
            webp_loop_count(AnimatedRasterIterations::Finite(1)).expect("one play"),
            1
        );
        assert_eq!(
            webp_loop_count(AnimatedRasterIterations::Finite(MAX_WEBP_ITERATIONS))
                .expect("maximum plays"),
            u16::MAX
        );
        for iteration_count in [0, MAX_WEBP_ITERATIONS + 1] {
            let error = webp_loop_count(AnimatedRasterIterations::Finite(iteration_count))
                .expect_err("out-of-range total plays");
            assert!(error.to_string().contains("Animated WebP iterations"));
        }
    }

    #[test]
    fn test_animated_webp_chunk_layout() {
        let bytes = encode(&two_frame_input(infinite()));
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(
            u32::from_le_bytes(bytes[4..8].try_into().expect("4 bytes")) as usize,
            bytes.len() - 8
        );
        assert_eq!(&bytes[8..12], b"WEBP");
        assert_eq!(&bytes[12..16], b"VP8X");
        assert_eq!(bytes[20], VP8X_FLAGS_ALPHA_ANIMATION);
        assert_eq!(&bytes[30..34], b"ANIM");
        // First ANMF starts after VP8X (8 + 10) and ANIM (8 + 6). Its 16-byte
        // payload header runs 52..68: x, y, width-1, height-1, duration, flags.
        assert_eq!(&bytes[44..48], b"ANMF");
        assert_eq!(
            &bytes[52..58],
            &[0, 0, 0, 0, 0, 0],
            "full-canvas frame origin"
        );
        assert_eq!(&bytes[58..61], &[7, 0, 0], "frame width - 1");
        assert_eq!(&bytes[61..64], &[3, 0, 0], "frame height - 1");
        assert_eq!(&bytes[64..67], &[100, 0, 0], "frame duration in ms");
        assert_eq!(bytes[67], ANMF_FLAGS_REPLACE);
        assert_eq!(&bytes[68..72], b"VP8L", "embedded still frame chunk");
    }

    #[test]
    fn test_extract_vp8l_chunk_rejects_foreign_input() {
        let mut extra_chunk = encode(&two_frame_input(infinite()));
        // An animated file starts with VP8X, not VP8L.
        assert!(extract_vp8l_chunk(&extra_chunk).is_err());

        extra_chunk = super::super::webp_encode::svg_to_webp(
            &solid_svg(8, 4, "#ff0000"),
            &[],
            &[],
            &crate::rasterize::RasterizeOptions::default(),
        )
        .expect("still encode");
        extra_chunk.push(0);
        let error = extract_vp8l_chunk(&extra_chunk).expect_err("trailing bytes are invalid");
        assert!(error.to_string().contains("trailing bytes"));

        assert!(extract_vp8l_chunk(b"RIFF").is_err());
    }

    #[test]
    fn test_animated_webp_deterministic() {
        assert_eq!(
            encode(&two_frame_input(infinite())),
            encode(&two_frame_input(infinite()))
        );
    }

    #[test]
    fn test_animated_webp_embeds_one_generator_xmp_chunk() {
        let mut input = two_frame_input(infinite());
        input.options = Some(crate::rasterize::RasterizeOptions {
            generator: Some(generator()),
            ..Default::default()
        });
        let first = encode(&input);
        let second = encode(&input);
        assert_eq!(first, second);
        assert_ne!(first[20] & 0x04, 0, "VP8X XMP feature flag");
        assert_eq!(
            first.windows(4).filter(|window| *window == b"XMP ").count(),
            1
        );
        assert!(
            first
                .windows(b"<boundsvg:name>@scope/aaaa</boundsvg:name>".len())
                .any(|window| window == b"<boundsvg:name>@scope/aaaa</boundsvg:name>")
        );
        let decoder = WebPDecoder::new(Cursor::new(&first)).expect("decodable animation");
        assert_eq!(decoder.num_frames(), 2);
    }

    #[test]
    fn test_animated_webp_rejects_mismatched_frame_sizes() {
        let input = AnimationEncodeInput {
            frames: vec![
                AnimationFrameInput {
                    svg: solid_svg(8, 4, "#ff0000"),
                    duration_ms: 100,
                },
                AnimationFrameInput {
                    svg: solid_svg(16, 4, "#0000ff"),
                    duration_ms: 100,
                },
            ],
            iterations: infinite(),
            options: None,
        };
        let error = encode_animated_webp(&input, &[], &[]).expect_err("size mismatch is invalid");
        assert!(error.to_string().contains("share one canvas size"));
    }

    #[test]
    fn test_animated_webp_rejects_odd_length_frame_chunk() {
        let mut out = Vec::new();
        let error = write_anmf_chunk(&mut out, 8, 4, 100, &[0u8; 9])
            .expect_err("an unpadded frame chunk is invalid");
        assert!(error.to_string().contains("padded to an even length"));
        assert!(write_anmf_chunk(&mut out, 0, 4, 100, &[0u8; 8]).is_err());
    }

    #[test]
    fn test_animated_webp_rejects_invalid_input() {
        let empty = AnimationEncodeInput {
            frames: vec![],
            iterations: infinite(),
            options: None,
        };
        assert!(encode_animated_webp(&empty, &[], &[]).is_err());

        let zero_duration = AnimationEncodeInput {
            frames: vec![AnimationFrameInput {
                svg: solid_svg(8, 4, "#ff0000"),
                duration_ms: 0,
            }],
            iterations: infinite(),
            options: None,
        };
        assert!(encode_animated_webp(&zero_duration, &[], &[]).is_err());
    }

    #[test]
    fn test_animated_webp_applies_shared_rasterize_options() {
        let mut input = two_frame_input(infinite());
        input.options = Some(crate::rasterize::RasterizeOptions {
            background: None,
            scale: Some(2.0),
            oversize_behavior: None,
            font_families: None,
            generator: None,
        });
        let bytes = encode(&input);
        let decoder = WebPDecoder::new(Cursor::new(&bytes)).expect("decodable animation");
        assert_eq!(decoder.dimensions(), (16, 8));
    }
}
