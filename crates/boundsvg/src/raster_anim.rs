//! Input shape and frame rasterization for animated raster output.
//!
//! Kept separate from the container muxing so a second animated format can
//! reuse the validation and the frame loop unchanged.
//!
//! Frames arrive as pre-sampled static SVGs — the deterministic frame
//! sampling itself lives in the scene/animation pipeline, not here.

use std::sync::Arc;

use serde::Deserialize;

use crate::error::EngineError;
use crate::rasterize::{RasterizeOptions, rasterize_svg_to_pixmap};

/// Upper bound on frames in one animated file.
pub const MAX_ANIMATION_FRAMES: usize = 300;

/// Inclusive bounds for a single frame's display duration, in milliseconds.
const MIN_FRAME_DURATION_MS: u32 = 1;
const MAX_FRAME_DURATION_MS: u32 = 60_000;

/// One pre-sampled frame: a static SVG plus how long it stays on screen.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AnimationFrameInput {
    pub svg: String,
    /// Whole milliseconds, 1..=60000.
    pub duration_ms: u32,
}

/// Total number of plays requested for an animated raster container.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum AnimatedRasterIterations {
    Finite(u32),
    Infinite(AnimatedRasterInfinite),
}

/// Exact JSON keyword accepted for infinite animated-raster playback.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnimatedRasterInfinite {
    Infinite,
}

/// Input to an animated raster encoder.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AnimationEncodeInput {
    pub frames: Vec<AnimationFrameInput>,
    /// Required total-play count. Container-specific bounds are enforced by
    /// the selected WebP or GIF adapter before any output is assembled.
    pub iterations: AnimatedRasterIterations,
    /// Rasterization options applied identically to every frame, which is what
    /// keeps all frames at one size.
    pub options: Option<RasterizeOptions>,
}

/// Reject inputs the containers cannot represent.
///
/// The caller is normally the engine's own frame sampler, which cannot produce
/// these — this is the trust boundary for hand-written WASM input.
///
/// # Errors
///
/// Returns `EngineError` if the frame count or any frame duration is out of
/// range. Total-play bounds are deliberately format-specific.
pub(crate) fn validate_animation_input(input: &AnimationEncodeInput) -> Result<(), EngineError> {
    if input.frames.is_empty() {
        return Err(EngineError::Rasterize(
            "Animated output requires at least one frame".into(),
        ));
    }
    if input.frames.len() > MAX_ANIMATION_FRAMES {
        return Err(EngineError::Rasterize(format!(
            "Animated output is limited to {MAX_ANIMATION_FRAMES} frames, got {}",
            input.frames.len()
        )));
    }
    for (index, frame) in input.frames.iter().enumerate() {
        if frame.duration_ms < MIN_FRAME_DURATION_MS || frame.duration_ms > MAX_FRAME_DURATION_MS {
            return Err(EngineError::Rasterize(format!(
                "Frame {index} duration must be {MIN_FRAME_DURATION_MS}..={MAX_FRAME_DURATION_MS} ms, got {}",
                frame.duration_ms
            )));
        }
    }
    Ok(())
}

/// The canvas every frame of an animation shares.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct AnimationCanvas {
    pub width: u32,
    pub height: u32,
}

/// Rasterize the frames one at a time, handing each pixmap to `encode_frame`
/// before the next is rasterized, and confirm they all share a canvas size.
///
/// Streaming rather than collecting is load-bearing: 300 frames at the
/// rasterizer's own 4K cap would be ~10 GB of pixel buffers held at once, and
/// on wasm32 an allocation failure aborts the module rather than unwinding
/// into a catchable error.
///
/// # Errors
///
/// Returns `EngineError` if any frame fails to rasterize, the frames disagree
/// on size, or `encode_frame` fails.
pub(crate) fn rasterize_animation_frames<F>(
    frames: &[AnimationFrameInput],
    alias_map: &[(String, String)],
    font_data: &[Arc<Vec<u8>>],
    options: &RasterizeOptions,
    mut encode_frame: F,
) -> Result<AnimationCanvas, EngineError>
where
    F: FnMut(usize, &resvg::tiny_skia::Pixmap) -> Result<(), EngineError>,
{
    let mut canvas: Option<AnimationCanvas> = None;
    for (index, frame) in frames.iter().enumerate() {
        let pixmap = rasterize_svg_to_pixmap(&frame.svg, alias_map, font_data, options)?;
        let frame_canvas = AnimationCanvas {
            width: pixmap.width(),
            height: pixmap.height(),
        };
        match canvas {
            Some(first) if first != frame_canvas => {
                return Err(EngineError::Rasterize(format!(
                    "Animated frames must share one canvas size: frame {index} is {}x{}, frame 0 is {}x{}",
                    frame_canvas.width, frame_canvas.height, first.width, first.height
                )));
            }
            Some(_) => {}
            None => canvas = Some(frame_canvas),
        }
        encode_frame(index, &pixmap)?;
    }
    canvas
        .ok_or_else(|| EngineError::Rasterize("Animated output requires at least one frame".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(duration_ms: u32) -> AnimationFrameInput {
        AnimationFrameInput {
            svg: String::new(),
            duration_ms,
        }
    }

    fn input(frames: Vec<AnimationFrameInput>) -> AnimationEncodeInput {
        AnimationEncodeInput {
            frames,
            iterations: AnimatedRasterIterations::Infinite(AnimatedRasterInfinite::Infinite),
            options: None,
        }
    }

    #[test]
    fn test_rejects_empty_frames() {
        let error = validate_animation_input(&input(vec![])).expect_err("empty is invalid");
        assert!(error.to_string().contains("at least one frame"));
    }

    #[test]
    fn test_rejects_too_many_frames() {
        let frames = vec![frame(10); MAX_ANIMATION_FRAMES + 1];
        let error = validate_animation_input(&input(frames)).expect_err("301 is invalid");
        assert!(error.to_string().contains("limited to 300 frames"));
    }

    #[test]
    fn test_accepts_the_frame_limit() {
        let frames = vec![frame(10); MAX_ANIMATION_FRAMES];
        validate_animation_input(&input(frames)).expect("300 frames is valid");
    }

    #[test]
    fn test_rejects_out_of_range_durations() {
        for duration_ms in [0, MAX_FRAME_DURATION_MS + 1] {
            let error = validate_animation_input(&input(vec![frame(duration_ms)]))
                .expect_err("duration out of range");
            assert!(error.to_string().contains("Frame 0 duration"));
        }
    }

    #[test]
    fn input_requires_iterations_and_rejects_legacy_or_unknown_fields() {
        let frame_json = r#"[{"svg":"<svg/>","durationMs":10}]"#;
        for invalid_json in [
            format!(r#"{{"frames":{frame_json}}}"#),
            format!(r#"{{"frames":{frame_json},"loopCount":0}}"#),
            format!(r#"{{"frames":{frame_json},"loop_count":0}}"#),
            format!(r#"{{"frames":{frame_json},"iterations":"forever"}}"#),
            format!(r#"{{"frames":{frame_json},"iterations":1,"unknown":true}}"#),
        ] {
            assert!(
                serde_json::from_str::<AnimationEncodeInput>(&invalid_json).is_err(),
                "must reject {invalid_json}"
            );
        }

        for valid_iterations in ["1", "65536", r#""infinite""#] {
            let valid_json =
                format!(r#"{{"frames":{frame_json},"iterations":{valid_iterations}}}"#);
            serde_json::from_str::<AnimationEncodeInput>(&valid_json)
                .unwrap_or_else(|error| panic!("must accept {valid_json}: {error}"));
        }
    }
}
