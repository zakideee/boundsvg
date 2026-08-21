//! Animated GIF encoding.
//!
//! Reuses the frame rasterization in [`crate::raster_anim`] and adds GIF's own
//! constraints: a 256-color palette per frame, 1-bit alpha, and a 10 ms timing
//! quantum. Unlike the WebP path this is lossy, but it is still byte-
//! deterministic: `NeuQuant` is run at a fixed speed and every palette is built
//! from sorted colors.

use std::sync::Arc;

use crate::error::EngineError;
use crate::raster_anim::{
    AnimationEncodeInput, rasterize_animation_frames, validate_animation_input,
};
use crate::webp_encode::pixmap_to_rgba;

/// `NeuQuant` speed/quality tradeoff. Fixed so the same pixels always quantize to
/// the same palette; 10 is the crate's documented balanced setting.
const NEUQUANT_SPEED: i32 = 10;

/// GIF stores frame delays in centiseconds. Browsers silently raise anything
/// below 2 cs to a default, so clamping here keeps the file's declared timing
/// and the observed timing in agreement.
const MIN_DELAY_CS: u32 = 2;
const MAX_DELAY_CS: u32 = 65_535;

/// Ceiling on the assembled file, mirroring the animated WebP limit: frames
/// stream one at a time, but the encoded output accumulates, and an allocation
/// failure on wasm32 aborts the module rather than raising a catchable error.
const MAX_ANIMATED_GIF_BYTES: usize = 256 * 1024 * 1024;

/// Encode pre-sampled SVG frames as an animated GIF.
///
/// # Errors
///
/// Returns `EngineError` if validation, rasterization, quantization, or GIF
/// writing fails.
pub fn encode_animated_gif(
    input: &AnimationEncodeInput,
    alias_map: &[(String, String)],
    font_data: &[Arc<Vec<u8>>],
) -> Result<Vec<u8>, EngineError> {
    validate_animation_input(input)?;
    let options = input.options.clone().unwrap_or_default();
    if let Some(generator) = &options.generator {
        generator.validate()?;
    }
    let delays_cs = resolve_frame_delays_cs(input);

    // The encoder owns its output buffer: borrowing an outer `Vec` would leave
    // the closure holding a mutable borrow the encoder also needs.
    let mut encoder: Option<gif::Encoder<Vec<u8>>> = None;
    let loop_count = input.resolved_loop_count();

    let write_result = rasterize_animation_frames(
        &input.frames,
        alias_map,
        font_data,
        &options,
        |index, pixmap| {
            let (width, height) = gif_dimensions(pixmap.width(), pixmap.height())?;
            if encoder.is_none() {
                let mut created = gif::Encoder::new(Vec::new(), width, height, &[])
                    .map_err(|e| EngineError::Rasterize(format!("Failed to start GIF: {e}")))?;
                created.set_repeat(gif_repeat(loop_count)).map_err(|e| {
                    EngineError::Rasterize(format!("Failed to write GIF loop count: {e}"))
                })?;
                if let Some(generator) = &options.generator {
                    let comment = format!("boundsvg-generator:{}", generator.canonical_json());
                    created
                        .write_raw_extension(gif::Extension::Comment.into(), &[comment.as_bytes()])
                        .map_err(|e| {
                            EngineError::Rasterize(format!(
                                "Failed to write GIF generator metadata: {e}"
                            ))
                        })?;
                }
                encoder = Some(created);
            }
            let encoder = encoder
                .as_mut()
                .ok_or_else(|| EngineError::Rasterize("GIF encoder was not created".into()))?;

            let mut rgba = pixmap_to_rgba(pixmap);
            let expected_len = (width as usize) * (height as usize) * 4;
            if rgba.len() != expected_len {
                return Err(EngineError::Rasterize(format!(
                    "GIF pixel buffer of {} bytes does not match {width}x{height}",
                    rgba.len()
                )));
            }
            // Checked including the frame about to be written, so the cap also
            // bounds peak memory.
            if encoder.get_ref().len().saturating_add(rgba.len() / 4) > MAX_ANIMATED_GIF_BYTES {
                return Err(EngineError::Rasterize(format!(
                    "Animated GIF exceeds the {MAX_ANIMATED_GIF_BYTES} byte output limit; reduce the frame count, the scale, or the canvas size"
                )));
            }
            let mut frame = gif::Frame::from_rgba_speed(width, height, &mut rgba, NEUQUANT_SPEED);
            frame.delay = u16::try_from(delays_cs[index]).unwrap_or(u16::MAX);
            frame.dispose = gif::DisposalMethod::Background;
            encoder
                .write_frame(&frame)
                .map_err(|e| EngineError::Rasterize(format!("Failed to write GIF frame: {e}")))?;
            Ok(())
        },
    );
    write_result?;

    // Dropping the encoder writes the trailer, so the buffer is only complete
    // once it is consumed.
    let out = encoder
        .ok_or_else(|| EngineError::Rasterize("Animated GIF requires at least one frame".into()))?
        .into_inner()
        .map_err(|e| EngineError::Rasterize(format!("Failed to finish GIF: {e}")))?;

    if out.len() > MAX_ANIMATED_GIF_BYTES {
        return Err(EngineError::Rasterize(format!(
            "Animated GIF exceeds the {MAX_ANIMATED_GIF_BYTES} byte output limit; reduce the frame count, the scale, or the canvas size"
        )));
    }
    Ok(out)
}

/// Per-frame delays in centiseconds, derived as differences between rounded
/// cumulative timestamps so rounding cannot accumulate into drift.
fn resolve_frame_delays_cs(input: &AnimationEncodeInput) -> Vec<u32> {
    let mut delays = Vec::with_capacity(input.frames.len());
    let mut elapsed_ms: u64 = 0;
    let mut previous_cs = 0u64;
    for frame in &input.frames {
        elapsed_ms += u64::from(frame.duration_ms);
        // round-half-up of elapsed_ms / 10.
        let boundary_cs = (elapsed_ms + 5) / 10;
        let delay_cs =
            u32::try_from(boundary_cs.saturating_sub(previous_cs)).unwrap_or(MAX_DELAY_CS);
        delays.push(delay_cs.clamp(MIN_DELAY_CS, MAX_DELAY_CS));
        previous_cs = boundary_cs;
    }
    delays
}

/// GIF stores canvas dimensions as u16.
fn gif_dimensions(width: u32, height: u32) -> Result<(u16, u16), EngineError> {
    let too_large = |value: u32| {
        EngineError::Rasterize(format!(
            "Animated GIF canvas must be 1..=65535 px per edge, got {value}"
        ))
    };
    if width == 0 || height == 0 {
        return Err(EngineError::Rasterize(
            "Animated GIF frames must have a non-zero size".into(),
        ));
    }
    Ok((
        u16::try_from(width).map_err(|_| too_large(width))?,
        u16::try_from(height).map_err(|_| too_large(height))?,
    ))
}

fn gif_repeat(loop_count: u32) -> gif::Repeat {
    match u16::try_from(loop_count) {
        Ok(0) | Err(_) => gif::Repeat::Infinite,
        Ok(count) => gif::Repeat::Finite(count),
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use crate::raster_anim::AnimationFrameInput;

    fn solid_svg(width: u32, height: u32, fill: &str) -> String {
        format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"><rect width="{width}" height="{height}" fill="{fill}"/></svg>"#
        )
    }

    fn frames(durations_ms: &[u32]) -> Vec<AnimationFrameInput> {
        durations_ms
            .iter()
            .enumerate()
            .map(|(index, &duration_ms)| AnimationFrameInput {
                svg: solid_svg(8, 4, if index % 2 == 0 { "#ff0000" } else { "#0000ff" }),
                duration_ms,
            })
            .collect()
    }

    fn input(durations_ms: &[u32], loop_count: Option<u32>) -> AnimationEncodeInput {
        AnimationEncodeInput {
            frames: frames(durations_ms),
            loop_count,
            options: None,
        }
    }

    fn encode(input: &AnimationEncodeInput) -> Vec<u8> {
        encode_animated_gif(input, &[], &[]).expect("animated GIF encoding should succeed")
    }

    fn generator() -> crate::output_generator::OutputGenerator {
        crate::output_generator::OutputGenerator {
            name: "@scope/aaaa".to_string(),
            version: "1.2.3-beta.1".to_string(),
        }
    }

    #[test]
    fn test_animated_gif_roundtrip() {
        let bytes = encode(&input(&[100, 250], None));
        assert_eq!(&bytes[0..6], b"GIF89a");

        let mut decoder = gif::DecodeOptions::new()
            .read_info(Cursor::new(&bytes))
            .expect("decodable GIF");
        assert_eq!((decoder.width(), decoder.height()), (8, 4));

        let mut decoded: Vec<(u16, u16, u16)> = Vec::new();
        while let Some(frame) = decoder.read_next_frame().expect("readable frame") {
            decoded.push((frame.width, frame.height, frame.delay));
        }
        assert_eq!(decoded, vec![(8, 4, 10), (8, 4, 25)]);
    }

    #[test]
    fn test_animated_gif_loop_count() {
        let infinite = gif::DecodeOptions::new()
            .read_info(Cursor::new(encode(&input(&[100, 100], None))))
            .expect("decodable GIF");
        assert_eq!(infinite.repeat(), gif::Repeat::Infinite);

        let finite = gif::DecodeOptions::new()
            .read_info(Cursor::new(encode(&input(&[100, 100], Some(3)))))
            .expect("decodable GIF");
        assert_eq!(finite.repeat(), gif::Repeat::Finite(3));
    }

    #[test]
    fn test_animated_gif_deterministic() {
        assert_eq!(
            encode(&input(&[100, 250], None)),
            encode(&input(&[100, 250], None))
        );
    }

    #[test]
    fn test_animated_gif_embeds_one_generator_comment() {
        let mut with_generator = input(&[100, 250], None);
        with_generator.options = Some(crate::rasterize::RasterizeOptions {
            generator: Some(generator()),
            ..Default::default()
        });
        let first = encode(&with_generator);
        let second = encode(&with_generator);
        assert_eq!(first, second);
        let marker = b"boundsvg-generator:{\"name\":\"@scope/aaaa\",\"version\":\"1.2.3-beta.1\"}";
        assert_eq!(
            first
                .windows(marker.len())
                .filter(|window| *window == marker)
                .count(),
            1
        );

        let without_generator = encode(&input(&[100, 250], None));
        assert!(
            !without_generator
                .windows(marker.len())
                .any(|window| window == marker)
        );
        let decoder = gif::DecodeOptions::new()
            .read_info(Cursor::new(first))
            .expect("decodable GIF");
        assert_eq!((decoder.width(), decoder.height()), (8, 4));
    }

    #[test]
    fn test_delays_track_the_cumulative_timeline() {
        // 29.97 fps alternates 33 and 34 ms. Independent rounding would emit
        // 3 cs every frame and lose 1 cs per pair; the cumulative difference
        // keeps the total equal to the animation length.
        let durations: Vec<u32> = (0..10).map(|i| if i % 2 == 0 { 33 } else { 34 }).collect();
        let delays = resolve_frame_delays_cs(&input(&durations, None));
        let total_ms: u32 = durations.iter().sum();
        assert_eq!(delays.iter().sum::<u32>(), (total_ms + 5) / 10);
    }

    #[test]
    fn test_delay_rounding_is_half_up() {
        // 25 ms sits exactly between 2 and 3 cs; half-up takes 3. Truncation
        // would give 2, which the browser floor would otherwise hide.
        assert_eq!(resolve_frame_delays_cs(&input(&[25], None)), vec![3]);
        assert_eq!(
            resolve_frame_delays_cs(&input(&[100, 25], None)),
            vec![10, 3]
        );
        // Below the midpoint; these also pass under truncation, so they guard
        // the floor rather than the rounding mode.
        assert_eq!(resolve_frame_delays_cs(&input(&[24], None)), vec![2]);
        assert_eq!(
            resolve_frame_delays_cs(&input(&[100, 24], None)),
            vec![10, 2]
        );
    }

    #[test]
    fn test_delays_clamp_to_the_browser_floor() {
        // A 1 ms frame rounds to 0 cs, which browsers replace with a default.
        let delays = resolve_frame_delays_cs(&input(&[1, 1], None));
        assert_eq!(delays, vec![MIN_DELAY_CS, MIN_DELAY_CS]);
    }

    #[test]
    fn test_animated_gif_keeps_transparency() {
        // A partly transparent canvas: GIF has 1-bit alpha, so the encoder must
        // mark a transparent palette index rather than painting it opaque.
        let translucent = r##"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="4" height="4" fill="#ff0000"/></svg>"##;
        let mut transparent_input = input(&[100, 100], None);
        for frame in &mut transparent_input.frames {
            frame.svg = translucent.to_string();
        }
        let bytes = encode(&transparent_input);

        let mut decoder = gif::DecodeOptions::new()
            .read_info(Cursor::new(&bytes))
            .expect("decodable GIF");
        let frame = decoder
            .read_next_frame()
            .expect("readable frame")
            .expect("one frame");
        assert!(
            frame.transparent.is_some(),
            "the transparent half of the canvas needs a transparent palette index"
        );
        assert_eq!(frame.dispose, gif::DisposalMethod::Background);
    }

    #[test]
    fn test_animated_gif_rejects_invalid_input() {
        let empty = AnimationEncodeInput {
            frames: vec![],
            loop_count: None,
            options: None,
        };
        assert!(encode_animated_gif(&empty, &[], &[]).is_err());
        assert!(encode_animated_gif(&input(&[0], None), &[], &[]).is_err());
    }

    #[test]
    fn test_animated_gif_rejects_mismatched_frame_sizes() {
        let mut mismatched = input(&[100, 100], None);
        mismatched.frames[1].svg = solid_svg(16, 4, "#0000ff");
        let error =
            encode_animated_gif(&mismatched, &[], &[]).expect_err("size mismatch is invalid");
        assert!(error.to_string().contains("share one canvas size"));
    }

    #[test]
    fn test_animated_gif_applies_shared_rasterize_options() {
        let mut scaled = input(&[100, 100], None);
        scaled.options = Some(crate::rasterize::RasterizeOptions {
            background: None,
            scale: Some(2.0),
            oversize_behavior: None,
            font_families: None,
            generator: None,
        });
        let decoder = gif::DecodeOptions::new()
            .read_info(Cursor::new(encode(&scaled)))
            .expect("decodable GIF");
        assert_eq!((decoder.width(), decoder.height()), (16, 8));
    }
}
