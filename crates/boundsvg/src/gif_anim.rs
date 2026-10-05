//! Incremental deterministic GIF encoding with one palette and frame per operation.

use crate::animation_writer::{AnimationWriter, GuardedWriter, animation_io_error};
use crate::error::EngineError;
use crate::output_generator::OutputGenerator;
use crate::raster_anim::{AnimatedRasterFormat, AnimatedRasterIterations};
use crate::webp_encode::pixmap_to_rgba;

/// Fixed `NeuQuant` speed preserves the original palette and LZW bytes.
const NEUQUANT_SPEED: i32 = 10;
/// Browser-compatible minimum display delay in centiseconds.
const MIN_DELAY_CS: u32 = 2;
/// Largest delay stored in the GIF graphics-control extension.
const MAX_DELAY_CS: u32 = 65_535;
/// One initial play plus the finite repeat field.
const MAX_GIF_ITERATIONS: u32 = 65_536;

/// A GIF encoder retaining only its writer, one timing residue and small codec state.
pub(crate) struct GifAnimation<W: AnimationWriter> {
    writer: Option<GuardedWriter<W>>,
    encoder: Option<gif::Encoder<GuardedWriter<W>>>,
    repeat: Option<gif::Repeat>,
    generator: Option<OutputGenerator>,
    residue_ms: u32,
}

impl<W: AnimationWriter> GifAnimation<W> {
    /// Validate playback before a canvas or output header exists.
    ///
    /// # Errors
    ///
    /// Return the existing iteration diagnostic for an invalid total play count.
    pub(crate) fn new(
        writer: W,
        iterations: AnimatedRasterIterations,
        generator: Option<OutputGenerator>,
    ) -> Result<Self, EngineError> {
        Ok(Self {
            writer: Some(GuardedWriter::new(writer, AnimatedRasterFormat::Gif)),
            encoder: None,
            repeat: gif_repeat(iterations)?,
            generator,
            residue_ms: 0,
        })
    }

    /// Build the first canvas header and encode one quantized full-canvas frame.
    ///
    /// # Errors
    ///
    /// Return a canvas, palette, codec or writer failure.
    pub(crate) fn push(
        &mut self,
        pixmap: &resvg::tiny_skia::Pixmap,
        duration_ms: u32,
    ) -> Result<(), EngineError> {
        let (width, height) = gif_dimensions(pixmap.width(), pixmap.height())?;
        if self.encoder.is_none() {
            let writer = self
                .writer
                .take()
                .ok_or_else(|| EngineError::Rasterize("GIF writer is unavailable".into()))?;
            let mut created = gif::Encoder::new(writer, width, height, &[])
                .map_err(|error| gif_encoding_error(error, "Failed to start GIF"))?;
            if let Some(repeat) = self.repeat {
                created.set_repeat(repeat).map_err(|error| {
                    gif_encoding_error(error, "Failed to write GIF repeat count")
                })?;
            }
            if let Some(generator) = &self.generator {
                let comment = format!("boundsvg-generator:{}", generator.canonical_json());
                created
                    .write_raw_extension(gif::Extension::Comment.into(), &[comment.as_bytes()])
                    .map_err(|error| {
                        animation_io_error(&error, "Failed to write GIF generator metadata")
                    })?;
            }
            self.encoder = Some(created);
        }
        let mut rgba = pixmap_to_rgba(pixmap);
        let expected_length = (width as usize) * (height as usize) * 4;
        if rgba.len() != expected_length {
            return Err(EngineError::Rasterize(format!(
                "GIF pixel buffer of {} bytes does not match {width}x{height}",
                rgba.len()
            )));
        }
        let mut frame = gif::Frame::from_rgba_speed(width, height, &mut rgba, NEUQUANT_SPEED);
        // Only modulo-ten residue is needed for the next cumulative half-up
        // difference. The total elapsed time never enters owned arithmetic.
        let residue_and_duration = self.residue_ms + duration_ms;
        let next_residue = residue_and_duration % 10;
        let raw_delay = residue_and_duration / 10 + u32::from(next_residue >= 5)
            - u32::from(self.residue_ms >= 5);
        self.residue_ms = next_residue;
        frame.delay = u16::try_from(raw_delay.clamp(MIN_DELAY_CS, MAX_DELAY_CS))
            .map_err(|_| EngineError::Rasterize("GIF delay is not representable".into()))?;
        frame.dispose = gif::DisposalMethod::Background;
        self.encoder
            .as_mut()
            .ok_or_else(|| EngineError::Rasterize("GIF encoder was not created".into()))?
            .write_frame(&frame)
            .map_err(|error| gif_encoding_error(error, "Failed to write GIF frame"))
    }

    /// Emit the normal trailer once and recover the checked writer.
    ///
    /// # Errors
    ///
    /// Return a missing-frame or trailer writer failure.
    pub(crate) fn finish(&mut self) -> Result<(), EngineError> {
        let encoder = self.encoder.take().ok_or_else(|| {
            EngineError::Rasterize("Animated GIF requires at least one frame".into())
        })?;
        self.writer = Some(
            encoder
                .into_inner()
                .map_err(|error| animation_io_error(&error, "Failed to finish GIF"))?,
        );
        Ok(())
    }

    /// Read the output in its current owner, before or after encoder completion.
    pub(crate) fn writer(&self) -> Option<&GuardedWriter<W>> {
        self.encoder
            .as_ref()
            .map(gif::Encoder::get_ref)
            .or(self.writer.as_ref())
    }

    /// Access staging or suppress destructor writes without taking encoder ownership.
    pub(crate) fn writer_mut(&mut self) -> Option<&mut GuardedWriter<W>> {
        match &mut self.encoder {
            Some(encoder) => Some(encoder.get_mut()),
            None => self.writer.as_mut(),
        }
    }
}

impl<W: AnimationWriter> Drop for GifAnimation<W> {
    fn drop(&mut self) {
        if let Some(writer) = self.writer_mut() {
            writer.disable();
        }
    }
}

/// Preserve typed writer errors and the original GIF format-error text.
fn gif_encoding_error(error: gif::EncodingError, message: &str) -> EngineError {
    match error {
        gif::EncodingError::Io(error) => animation_io_error(&error, message),
        gif::EncodingError::Format(error) => EngineError::Rasterize(format!("{message}: {error}")),
    }
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

fn gif_repeat(iterations: AnimatedRasterIterations) -> Result<Option<gif::Repeat>, EngineError> {
    match iterations {
        AnimatedRasterIterations::Infinite(_) => Ok(Some(gif::Repeat::Infinite)),
        AnimatedRasterIterations::Finite(1) => Ok(None),
        AnimatedRasterIterations::Finite(iteration_count)
            if (2..=MAX_GIF_ITERATIONS).contains(&iteration_count) =>
        {
            let repeat_count = u16::try_from(iteration_count - 1).map_err(|_| {
                EngineError::Rasterize(format!(
                    "Animated GIF iterations must be 1..={MAX_GIF_ITERATIONS} or infinite, got {iteration_count}"
                ))
            })?;
            Ok(Some(gif::Repeat::Finite(repeat_count)))
        }
        AnimatedRasterIterations::Finite(iteration_count) => Err(EngineError::Rasterize(format!(
            "Animated GIF iterations must be 1..={MAX_GIF_ITERATIONS} or infinite, got {iteration_count}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use crate::raster_anim::{AnimatedRasterInfinite, AnimationFrameInput};

    struct AnimationFixture {
        frames: Vec<AnimationFrameInput>,
        iterations: AnimatedRasterIterations,
        options: Option<crate::rasterize::RasterizeOptions>,
    }

    fn encode_result(input: &AnimationFixture) -> Result<Vec<u8>, EngineError> {
        use crate::animation_writer::StagedWriter;
        use crate::raster_anim::{AnimationSession, AnimationSessionOptions};
        let mut session = AnimationSession::open(
            AnimatedRasterFormat::Gif,
            AnimationSessionOptions {
                frame_count: input.frames.len() as u64,
                iterations: input.iterations,
                raster_options: input.options.clone().unwrap_or_default(),
            },
            vec![],
            vec![],
            StagedWriter::default(),
        )?;
        let mut bytes = Vec::new();
        for frame in &input.frames {
            session.push(frame.clone())?;
            while let Some(chunk) = session.read_chunk()? {
                bytes.extend_from_slice(&chunk);
            }
        }
        session.finish()?;
        while let Some(chunk) = session.read_chunk()? {
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    fn decoded_frame_delays_cs(input: &AnimationFixture) -> Vec<u32> {
        let bytes = encode(input);
        let mut decoder = gif::DecodeOptions::new()
            .read_info(Cursor::new(bytes))
            .expect("valid animation");
        let mut delays = Vec::new();
        while let Some(frame) = decoder.read_next_frame().expect("readable frame") {
            delays.push(u32::from(frame.delay));
        }
        delays
    }

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

    fn infinite() -> AnimatedRasterIterations {
        AnimatedRasterIterations::Infinite(AnimatedRasterInfinite::Infinite)
    }

    fn input(durations_ms: &[u32], iterations: AnimatedRasterIterations) -> AnimationFixture {
        AnimationFixture {
            frames: frames(durations_ms),
            iterations,
            options: None,
        }
    }

    fn encode(input: &AnimationFixture) -> Vec<u8> {
        encode_result(input).expect("animated GIF encoding should succeed")
    }

    fn generator() -> crate::output_generator::OutputGenerator {
        crate::output_generator::OutputGenerator {
            name: "@scope/aaaa".to_string(),
            version: "1.2.3-beta.1".to_string(),
        }
    }

    #[test]
    fn test_animated_gif_roundtrip() {
        let bytes = encode(&input(&[100, 250], infinite()));
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
    fn test_animated_gif_total_play_count() {
        let once = encode(&input(&[100, 100], AnimatedRasterIterations::Finite(1)));
        assert!(
            !once
                .windows(b"NETSCAPE2.0".len())
                .any(|window| window == b"NETSCAPE2.0"),
            "one total play must omit the repeat extension"
        );

        let infinite = gif::DecodeOptions::new()
            .read_info(Cursor::new(encode(&input(&[100, 100], infinite()))))
            .expect("decodable GIF");
        assert_eq!(infinite.repeat(), gif::Repeat::Infinite);

        let finite = gif::DecodeOptions::new()
            .read_info(Cursor::new(encode(&input(
                &[100, 100],
                AnimatedRasterIterations::Finite(3),
            ))))
            .expect("decodable GIF");
        assert_eq!(finite.repeat(), gif::Repeat::Finite(2));
    }

    #[test]
    fn gif_iterations_map_total_plays_to_repeat_extension_bounds() {
        assert_eq!(
            gif_repeat(infinite()).expect("infinite"),
            Some(gif::Repeat::Infinite)
        );
        assert_eq!(
            gif_repeat(AnimatedRasterIterations::Finite(1)).expect("one play"),
            None
        );
        assert_eq!(
            gif_repeat(AnimatedRasterIterations::Finite(2)).expect("two plays"),
            Some(gif::Repeat::Finite(1))
        );
        assert_eq!(
            gif_repeat(AnimatedRasterIterations::Finite(MAX_GIF_ITERATIONS))
                .expect("maximum plays"),
            Some(gif::Repeat::Finite(u16::MAX))
        );
        for iteration_count in [0, MAX_GIF_ITERATIONS + 1] {
            let error = gif_repeat(AnimatedRasterIterations::Finite(iteration_count))
                .expect_err("out-of-range total plays");
            assert!(error.to_string().contains("Animated GIF iterations"));
        }
    }

    #[test]
    fn test_animated_gif_deterministic() {
        assert_eq!(
            encode(&input(&[100, 250], infinite())),
            encode(&input(&[100, 250], infinite()))
        );
    }

    #[test]
    fn test_animated_gif_embeds_one_generator_comment() {
        let mut with_generator = input(&[100, 250], infinite());
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

        let without_generator = encode(&input(&[100, 250], infinite()));
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
        let delays = decoded_frame_delays_cs(&input(&durations, infinite()));
        let total_ms: u32 = durations.iter().sum();
        assert_eq!(delays.iter().sum::<u32>(), (total_ms + 5) / 10);
    }

    #[test]
    fn test_delay_rounding_is_half_up() {
        // 25 ms sits exactly between 2 and 3 cs; half-up takes 3. Truncation
        // would give 2, which the browser floor would otherwise hide.
        assert_eq!(decoded_frame_delays_cs(&input(&[25], infinite())), vec![3]);
        assert_eq!(
            decoded_frame_delays_cs(&input(&[100, 25], infinite())),
            vec![10, 3]
        );
        // Below the midpoint; these also pass under truncation, so they guard
        // the floor rather than the rounding mode.
        assert_eq!(decoded_frame_delays_cs(&input(&[24], infinite())), vec![2]);
        assert_eq!(
            decoded_frame_delays_cs(&input(&[100, 24], infinite())),
            vec![10, 2]
        );
    }

    #[test]
    fn test_delays_clamp_to_the_browser_floor() {
        // A 1 ms frame rounds to 0 cs, which browsers replace with a default.
        let delays = decoded_frame_delays_cs(&input(&[1, 1], infinite()));
        assert_eq!(delays, vec![MIN_DELAY_CS, MIN_DELAY_CS]);
    }

    #[test]
    fn test_animated_gif_keeps_transparency() {
        // A partly transparent canvas: GIF has 1-bit alpha, so the encoder must
        // mark a transparent palette index rather than painting it opaque.
        let translucent = r##"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="4" height="4" fill="#ff0000"/></svg>"##;
        let mut transparent_input = input(&[100, 100], infinite());
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
        let empty = AnimationFixture {
            frames: vec![],
            iterations: infinite(),
            options: None,
        };
        assert!(encode_result(&empty).is_err());
        assert!(encode_result(&input(&[0], infinite())).is_err());
    }

    #[test]
    fn test_animated_gif_rejects_mismatched_frame_sizes() {
        let mut mismatched = input(&[100, 100], infinite());
        mismatched.frames[1].svg = solid_svg(16, 4, "#0000ff");
        let error = encode_result(&mismatched).expect_err("size mismatch is invalid");
        assert!(error.to_string().contains("share one canvas size"));
    }

    #[test]
    fn test_animated_gif_applies_shared_rasterize_options() {
        let mut scaled = input(&[100, 100], infinite());
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
