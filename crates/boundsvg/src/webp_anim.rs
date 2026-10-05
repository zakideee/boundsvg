//! Incremental animated WebP muxing over a checked caller-owned writer.
//!
//! Each frame reuses the still lossless encoder. The RIFF size is patched only
//! after the final metadata chunk, without retaining the complete animation.

use std::io::Write;

use crate::animation_writer::{AnimationPatch, AnimationWriter, GuardedWriter, animation_io_error};
use crate::error::EngineError;
use crate::output_generator::OutputGenerator;
use crate::raster_anim::{AnimatedRasterFormat, AnimatedRasterIterations, AnimationCanvas};
use crate::webp_encode::{pixmap_to_rgba, rgba_to_webp};

/// RGBA and animation feature bits shared with the original container.
const VP8X_FLAGS_ALPHA_ANIMATION: u8 = 0x12;
/// Full-canvas replacement, without blending or disposal.
const ANMF_FLAGS_REPLACE: u8 = 0x02;
/// RIFF prefix length before its first chunk.
const RIFF_HEADER_LEN: usize = 12;
/// Fixed ANMF geometry, timing and flags payload length.
const ANMF_HEADER_LEN: usize = 16;
/// Header length through VP8X and ANIM.
const HEADER_LEN: usize = RIFF_HEADER_LEN + (8 + 10) + (8 + 6);
/// Largest WebP canvas edge represented by an unsigned 24-bit edge minus one.
const MAX_CANVAS_EDGE: u32 = 1 << 24;
/// Largest finite total play count represented by ANIM.
const MAX_WEBP_ITERATIONS: u32 = 65_535;

/// Incremental WebP state; only the current still frame and small header are assembled.
pub(crate) struct WebpAnimation<W: AnimationWriter> {
    writer: GuardedWriter<W>,
    loop_count: u16,
    generator: Option<OutputGenerator>,
    has_header: bool,
}

impl<W: AnimationWriter> WebpAnimation<W> {
    /// Validate playback before taking the first frame.
    ///
    /// # Errors
    ///
    /// Return the existing iteration diagnostic for an unrepresentable play count.
    pub(crate) fn new(
        writer: W,
        iterations: AnimatedRasterIterations,
        generator: Option<OutputGenerator>,
    ) -> Result<Self, EngineError> {
        Ok(Self {
            writer: GuardedWriter::new(writer, AnimatedRasterFormat::Webp),
            loop_count: webp_loop_count(iterations)?,
            generator,
            has_header: false,
        })
    }

    /// Encode and append exactly one rasterized full-canvas frame.
    ///
    /// # Errors
    ///
    /// Return a canvas, still codec, container or writer failure.
    pub(crate) fn push(
        &mut self,
        pixmap: &resvg::tiny_skia::Pixmap,
        duration_ms: u32,
    ) -> Result<(), EngineError> {
        let canvas = AnimationCanvas {
            width: pixmap.width(),
            height: pixmap.height(),
        };
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
        if !self.has_header {
            let mut header = Vec::with_capacity(HEADER_LEN);
            header.extend_from_slice(b"RIFF\0\0\0\0WEBP");
            write_vp8x_chunk(&mut header, canvas, self.generator.is_some());
            write_anim_chunk(&mut header, self.loop_count);
            self.writer
                .write_all(&header)
                .map_err(|error| animation_io_error(&error, "Failed to start WebP"))?;
            self.has_header = true;
        }
        let still = rgba_to_webp(&pixmap_to_rgba(pixmap), canvas.width, canvas.height)?;
        let frame_chunk = extract_vp8l_chunk(&still)?;
        write_anmf_chunk(
            &mut self.writer,
            canvas.width,
            canvas.height,
            duration_ms,
            frame_chunk,
        )
    }

    /// Append metadata and patch RIFF size at offset four.
    ///
    /// # Errors
    ///
    /// Return a checked container length or writer failure.
    pub(crate) fn finish(&mut self) -> Result<AnimationPatch, EngineError> {
        if let Some(generator) = &self.generator {
            let packet = generator.xmp_packet();
            let length = u32::try_from(packet.len())
                .map_err(|_| EngineError::Rasterize("WebP chunk exceeds 4 GiB".into()))?;
            self.writer
                .write_all(b"XMP ")
                .and_then(|()| self.writer.write_all(&length.to_le_bytes()))
                .and_then(|()| self.writer.write_all(packet.as_bytes()))
                .map_err(|error| animation_io_error(&error, "Failed to write WebP metadata"))?;
            if packet.len() % 2 == 1 {
                self.writer.write_all(&[0]).map_err(|error| {
                    animation_io_error(&error, "Failed to write WebP metadata padding")
                })?;
            }
        }
        let size = self
            .writer
            .bytes_written()
            .checked_sub(8)
            .and_then(|size| u32::try_from(size).ok())
            .ok_or_else(|| {
                EngineError::Rasterize("WebP exceeds the 4 GiB RIFF container limit".into())
            })?;
        let bytes = size.to_le_bytes();
        self.writer
            .patch(4, &bytes)
            .map_err(|error| animation_io_error(&error, "Failed to patch WebP size"))?;
        Ok(AnimationPatch { offset: 4, bytes })
    }

    /// Access the checked output without changing codec ownership.
    pub(crate) fn writer(&self) -> &GuardedWriter<W> {
        &self.writer
    }

    /// Access staging or disable output before codec destruction.
    pub(crate) fn writer_mut(&mut self) -> &mut GuardedWriter<W> {
        &mut self.writer
    }
}

/// Lift the VP8L chunk — header, payload, and any pad byte — out of a still
/// WebP so it can be embedded verbatim in an ANMF frame.
fn extract_vp8l_chunk(still_webp: &[u8]) -> Result<&[u8], EngineError> {
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
    Ok(chunk)
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

fn write_anmf_chunk<W: Write>(
    out: &mut W,
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

    let mut header = Vec::with_capacity(8 + ANMF_HEADER_LEN);
    push_chunk_header(&mut header, *b"ANMF", payload_len);
    // Frame offset, stored halved. Every frame covers the whole canvas.
    push_u24(&mut header, 0);
    push_u24(&mut header, 0);
    push_u24(&mut header, frame_width - 1);
    push_u24(&mut header, frame_height - 1);
    push_u24(&mut header, duration_ms);
    header.push(ANMF_FLAGS_REPLACE);
    out.write_all(&header)
        .and_then(|()| out.write_all(frame_chunk))
        .map_err(|error| animation_io_error(&error, "Failed to write WebP frame"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image_webp::{LoopCount, WebPDecoder};

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
            AnimatedRasterFormat::Webp,
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
        let result = session.finish()?;
        while let Some(chunk) = session.read_chunk()? {
            bytes.extend_from_slice(&chunk);
        }
        if let Some(patch) = result.patch {
            bytes[4..8].copy_from_slice(&patch.bytes);
        }
        Ok(bytes)
    }

    fn solid_svg(width: u32, height: u32, fill: &str) -> String {
        format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"><rect width="{width}" height="{height}" fill="{fill}"/></svg>"#
        )
    }

    fn infinite() -> AnimatedRasterIterations {
        AnimatedRasterIterations::Infinite(AnimatedRasterInfinite::Infinite)
    }

    fn two_frame_input(iterations: AnimatedRasterIterations) -> AnimationFixture {
        AnimationFixture {
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

    fn encode(input: &AnimationFixture) -> Vec<u8> {
        encode_result(input).expect("animated WebP encoding should succeed")
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
        let input = AnimationFixture {
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
        let error = encode_result(&input).expect_err("size mismatch is invalid");
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
        let empty = AnimationFixture {
            frames: vec![],
            iterations: infinite(),
            options: None,
        };
        assert!(encode_result(&empty).is_err());

        let zero_duration = AnimationFixture {
            frames: vec![AnimationFrameInput {
                svg: solid_svg(8, 4, "#ff0000"),
                duration_ms: 0,
            }],
            iterations: infinite(),
            options: None,
        };
        assert!(encode_result(&zero_duration).is_err());
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
