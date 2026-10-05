//! Single-frame rasterization and shared lifecycle for streaming animated containers.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::animation_writer::{AnimationPatch, AnimationWriter, GuardedWriter, StagedWriter};
use crate::diagnostics::PipelineStage;
use crate::error::EngineError;
use crate::gif_anim::GifAnimation;
use crate::rasterize::{RasterizeOptions, rasterize_svg_to_pixmap};
use crate::webp_anim::WebpAnimation;

/// Largest integer frame count exactly representable across the JavaScript boundary.
const FRAME_COUNT_MAX: u64 = (1_u64 << 53) - 1;

/// Container selected for one animation session.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AnimatedRasterFormat {
    /// Lossless animated WebP with a final RIFF size patch.
    Webp,
    /// Palette GIF with cumulative centisecond timing.
    Gif,
}

impl AnimatedRasterFormat {
    /// Read the stable container keyword used by diagnostics and transport.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Webp => "webp",
            Self::Gif => "gif",
        }
    }
}

/// Required total number of plays requested for a container.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum AnimatedRasterIterations {
    /// A finite count, further bounded by the selected container.
    Finite(u32),
    /// The exact infinite-play keyword.
    Infinite(AnimatedRasterInfinite),
}

/// Exact JSON keyword for infinite playback.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnimatedRasterInfinite {
    /// Repeat indefinitely.
    Infinite,
}

/// One static sampled SVG and its whole-millisecond display duration.
#[derive(Clone, Debug)]
pub struct AnimationFrameInput {
    /// Valid Unicode SVG source; parsing and rasterization occur during push.
    pub svg: String,
    /// Integer display duration in 1..=60000 milliseconds.
    pub duration_ms: u32,
}

/// Validated native session options; the caller supplies the output writer separately.
pub struct AnimationSessionOptions {
    /// Expected count, in 1..=2^53-1; each push supplies exactly one frame.
    pub frame_count: u64,
    /// Total play count using the selected container's existing bounds.
    pub iterations: AnimatedRasterIterations,
    /// Raster options shared by every frame.
    pub raster_options: RasterizeOptions,
}

/// Exact canvas established by the first rasterized frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct AnimationCanvas {
    /// First frame's raster width in pixels.
    pub width: u32,
    /// First frame's raster height in pixels.
    pub height: u32,
}

/// Container completion metadata; external sink completion is a separate operation.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationFinishOutput {
    /// Container keyword.
    pub format: AnimatedRasterFormat,
    /// Number of successfully encoded frames.
    pub frame_count: u64,
    /// Actual appended byte count, excluding patches.
    pub bytes_written: u64,
    /// WebP size patch, already applied by direct writers and deferred by staging.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch: Option<AnimationPatch>,
}

/// Closed failure reasons for animation input, state and checked representation.
#[derive(Clone, Copy, Debug)]
pub(crate) enum AnimationFailureReason {
    WrongType,
    MalformedJson,
    MissingField,
    NullField,
    UnknownField,
    OutOfDomain,
    InvalidUnicode,
    PendingOutput,
    NoFrames,
    IncompleteFrames,
    ExcessFrames,
    AlreadyFinished,
    WrongEngine,
    Aborted,
    UnsafeFrameCount,
    CounterOverflow,
    UnsafeOutputPosition,
    RiffSize,
}

impl AnimationFailureReason {
    /// Read the stable closed reason keyword.
    fn as_str(self) -> &'static str {
        match self {
            Self::WrongType => "wrongType",
            Self::MalformedJson => "malformedJson",
            Self::MissingField => "missingField",
            Self::NullField => "nullField",
            Self::UnknownField => "unknownField",
            Self::OutOfDomain => "outOfDomain",
            Self::InvalidUnicode => "invalidUnicode",
            Self::PendingOutput => "pendingOutput",
            Self::NoFrames => "noFrames",
            Self::IncompleteFrames => "incompleteFrames",
            Self::ExcessFrames => "excessFrames",
            Self::AlreadyFinished => "alreadyFinished",
            Self::WrongEngine => "wrongEngine",
            Self::Aborted => "aborted",
            Self::UnsafeFrameCount => "unsafeFrameCount",
            Self::CounterOverflow => "counterOverflow",
            Self::UnsafeOutputPosition => "unsafeOutputPosition",
            Self::RiffSize => "riffSize",
        }
    }

    /// Read the diagnostic family without parsing an error message.
    fn code(self) -> &'static str {
        match self {
            Self::PendingOutput
            | Self::NoFrames
            | Self::IncompleteFrames
            | Self::ExcessFrames
            | Self::AlreadyFinished
            | Self::WrongEngine
            | Self::Aborted => "ANIMATED_RASTER_SESSION_INVALID_STATE",
            Self::UnsafeFrameCount | Self::CounterOverflow | Self::UnsafeOutputPosition => {
                "ANIMATED_RASTER_NUMERIC_UNREPRESENTABLE"
            }
            Self::RiffSize => "ANIMATED_RASTER_CONTAINER_UNREPRESENTABLE",
            _ => "ANIMATED_RASTER_SESSION_INVALID_INPUT",
        }
    }
}

/// Construct a closed diagnostic without including untrusted payload keys or parse text.
pub(crate) fn animation_failure(
    format: AnimatedRasterFormat,
    operation: &str,
    reason: AnimationFailureReason,
    field: Option<&str>,
    frame_index: Option<u64>,
) -> EngineError {
    let mut context = serde_json::json!({ "format": format.as_str(), "operation": operation, "reason": reason.as_str() });
    if let Some(field) = field {
        context["field"] = field.into();
    }
    if let Some(index) = frame_index {
        context["frameIndex"] = index.into();
    }
    EngineError::StructuredContext {
        code: reason.code().into(),
        message: format!(
            "Animated {} {operation} failed: {}",
            format.as_str(),
            reason.as_str()
        ),
        stage: Some(PipelineStage::Emit),
        node_id: None,
        context: Box::new(context),
    }
}

/// Rebuild the primary transport diagnostic without retaining parser or codec resources.
fn copy_primary_failure(error: &EngineError) -> EngineError {
    match error {
        EngineError::StructuredContext {
            code,
            message,
            stage,
            node_id,
            context,
        } => EngineError::StructuredContext {
            code: code.clone(),
            message: message.clone(),
            stage: *stage,
            node_id: node_id.clone(),
            context: context.clone(),
        },
        EngineError::Structured {
            code,
            message,
            stage,
            node_id,
        } => EngineError::Structured {
            code: code.clone(),
            message: message.clone(),
            stage: *stage,
            node_id: node_id.clone(),
        },
        _ => EngineError::Rasterize(error.to_string()),
    }
}

/// Lifecycle state independent of output buffers or magic counters.
enum AnimationState {
    Active,
    Finishing,
    Finished,
    Failed(EngineError),
    Aborted,
}

/// One shared owner chooses a codec while preserving the same writer and lifecycle.
enum AnimationCodec<W: AnimationWriter> {
    Webp(WebpAnimation<W>),
    Gif(GifAnimation<W>),
}

impl<W: AnimationWriter> AnimationCodec<W> {
    /// Access physical counters and pending output in the selected codec.
    fn writer(&self) -> Option<&GuardedWriter<W>> {
        match self {
            Self::Webp(codec) => Some(codec.writer()),
            Self::Gif(codec) => codec.writer(),
        }
    }

    /// Access staging and terminal suppression without transferring the writer.
    fn writer_mut(&mut self) -> Option<&mut GuardedWriter<W>> {
        match self {
            Self::Webp(codec) => Some(codec.writer_mut()),
            Self::Gif(codec) => codec.writer_mut(),
        }
    }

    /// Encode one pixmap through the container's sole codec.
    ///
    /// # Errors
    ///
    /// Return the selected codec or writer failure.
    fn push(
        &mut self,
        pixmap: &resvg::tiny_skia::Pixmap,
        duration_ms: u32,
    ) -> Result<(), EngineError> {
        match self {
            Self::Webp(codec) => codec.push(pixmap, duration_ms),
            Self::Gif(codec) => codec.push(pixmap, duration_ms),
        }
    }

    /// Complete the container and report its optional positional patch.
    ///
    /// # Errors
    ///
    /// Return the selected codec or writer failure.
    fn finish(&mut self) -> Result<Option<AnimationPatch>, EngineError> {
        match self {
            Self::Webp(codec) => codec.finish().map(Some),
            Self::Gif(codec) => codec.finish().map(|()| None),
        }
    }
}

/// Incrementally rasterize and encode frames into a caller-owned checked writer.
pub struct AnimationSession<W: AnimationWriter> {
    format: AnimatedRasterFormat,
    expected_frames: u64,
    pushed_frames: u64,
    options: Option<RasterizeOptions>,
    aliases: Vec<(String, String)>,
    fonts: Vec<Arc<Vec<u8>>>,
    canvas: Option<AnimationCanvas>,
    codec: Option<AnimationCodec<W>>,
    state: AnimationState,
}

impl<W: AnimationWriter> AnimationSession<W> {
    /// Validate options and snapshot font ownership without rasterizing or writing bytes.
    ///
    /// # Errors
    ///
    /// Return an invalid count, playback or raster-generator diagnostic.
    pub fn open(
        format: AnimatedRasterFormat,
        options: AnimationSessionOptions,
        aliases: Vec<(String, String)>,
        fonts: Vec<Arc<Vec<u8>>>,
        writer: W,
    ) -> Result<Self, EngineError> {
        if options.frame_count == 0 {
            return Err(animation_failure(
                format,
                "open",
                AnimationFailureReason::OutOfDomain,
                Some("frameCount"),
                None,
            ));
        }
        if options.frame_count > FRAME_COUNT_MAX {
            return Err(animation_failure(
                format,
                "open",
                AnimationFailureReason::UnsafeFrameCount,
                Some("frameCount"),
                None,
            ));
        }
        let iterations_max = match format {
            AnimatedRasterFormat::Webp => 65_535,
            AnimatedRasterFormat::Gif => 65_536,
        };
        if matches!(options.iterations, AnimatedRasterIterations::Finite(count) if !(1..=iterations_max).contains(&count))
        {
            return Err(animation_failure(
                format,
                "open",
                AnimationFailureReason::OutOfDomain,
                Some("iterations"),
                None,
            ));
        }
        if let Some(generator) = &options.raster_options.generator {
            generator.validate()?;
        }
        let generator = options.raster_options.generator.clone();
        let codec = match format {
            AnimatedRasterFormat::Webp => {
                AnimationCodec::Webp(WebpAnimation::new(writer, options.iterations, generator)?)
            }
            AnimatedRasterFormat::Gif => {
                AnimationCodec::Gif(GifAnimation::new(writer, options.iterations, generator)?)
            }
        };
        Ok(Self {
            format,
            expected_frames: options.frame_count,
            pushed_frames: 0,
            options: Some(options.raster_options),
            aliases,
            fonts,
            canvas: None,
            codec: Some(codec),
            state: AnimationState::Active,
        })
    }

    /// Check terminal state before a transport adapter parses a new frame payload.
    ///
    /// # Errors
    ///
    /// Return the stored primary failure or an immutable terminal-state diagnostic.
    pub(crate) fn assert_active(&self, operation: &str) -> Result<(), EngineError> {
        match &self.state {
            AnimationState::Active => Ok(()),
            AnimationState::Failed(error) => Err(copy_primary_failure(error)),
            AnimationState::Aborted => Err(animation_failure(
                self.format,
                operation,
                AnimationFailureReason::Aborted,
                None,
                None,
            )),
            AnimationState::Finishing | AnimationState::Finished => Err(animation_failure(
                self.format,
                operation,
                AnimationFailureReason::AlreadyFinished,
                None,
                None,
            )),
        }
    }

    /// Mark a first failure and release resources before codec destruction can write again.
    pub(crate) fn fail(&mut self, error: EngineError) -> EngineError {
        self.release_resources();
        self.state = AnimationState::Failed(copy_primary_failure(&error));
        error
    }

    /// Disable output before dropping a GIF encoder, font snapshots or raster options.
    fn release_resources(&mut self) {
        if let Some(codec) = &mut self.codec {
            if let Some(writer) = codec.writer_mut() {
                writer.disable();
            }
        }
        self.codec = None;
        self.fonts = Vec::new();
        self.aliases = Vec::new();
        self.options = None;
    }

    /// Rasterize one frame, append its encoded bytes and release all frame-local allocations.
    ///
    /// # Errors
    ///
    /// Return a terminal state, duration, pending output, count, raster, canvas or codec failure.
    pub fn push(&mut self, frame: AnimationFrameInput) -> Result<(), EngineError> {
        self.assert_active("push")?;
        let outcome = (|| {
            if !(1..=60_000).contains(&frame.duration_ms) {
                return Err(animation_failure(
                    self.format,
                    "push",
                    AnimationFailureReason::OutOfDomain,
                    Some("durationMs"),
                    Some(self.pushed_frames),
                ));
            }
            self.assert_push_slot()?;
            self.push_validated(frame)
        })();
        outcome.map_err(|error| self.fail(error))
    }

    /// Check pending output and frame count after the caller authenticates active state and input.
    ///
    /// Call only within an active operation whose external boundary owns terminalization.
    ///
    /// # Errors
    ///
    /// Return pendingOutput before excessFrames without changing state or the primary failure.
    pub(crate) fn assert_push_slot(&self) -> Result<(), EngineError> {
        self.assert_no_pending("push")?;
        if self.pushed_frames == self.expected_frames {
            return Err(animation_failure(
                self.format,
                "push",
                AnimationFailureReason::ExcessFrames,
                Some("frameCount"),
                Some(self.pushed_frames),
            ));
        }
        Ok(())
    }

    /// Consume one validated frame through the shared raster, codec and writer path.
    ///
    /// The caller must authenticate active state, duration and its available push slot,
    /// plus any scene owner/domain requirements, and terminalize an error exactly once.
    /// Frame and pixmap ownership ends before return, including on failure.
    ///
    /// # Errors
    ///
    /// Return a raster, canvas, codec, writer or counter failure without terminalizing it.
    pub(crate) fn push_validated(&mut self, frame: AnimationFrameInput) -> Result<(), EngineError> {
        #[cfg(test)]
        let frame = crate::animation_frame_tests::track_allocation(frame, 2);
        let outcome = (|| {
            let options = self.options.as_ref().ok_or_else(|| {
                animation_failure(
                    self.format,
                    "push",
                    AnimationFailureReason::Aborted,
                    None,
                    None,
                )
            })?;
            let pixmap = rasterize_svg_to_pixmap(&frame.svg, &self.aliases, &self.fonts, options)?;
            let canvas = AnimationCanvas {
                width: pixmap.width(),
                height: pixmap.height(),
            };
            if let Some(first) = self.canvas {
                if first != canvas {
                    return Err(EngineError::Rasterize(format!(
                        "Animated frames must share one canvas size: frame {} is {}x{}, frame 0 is {}x{}",
                        self.pushed_frames, canvas.width, canvas.height, first.width, first.height
                    )));
                }
            }
            self.canvas = Some(canvas);
            let codec = self.codec.as_mut().ok_or_else(|| {
                animation_failure(
                    self.format,
                    "push",
                    AnimationFailureReason::Aborted,
                    None,
                    None,
                )
            })?;
            codec.push(&pixmap, frame.duration_ms)?;
            self.pushed_frames = self.pushed_frames.checked_add(1).ok_or_else(|| {
                animation_failure(
                    self.format,
                    "push",
                    AnimationFailureReason::CounterOverflow,
                    Some("frameCount"),
                    None,
                )
            })?;
            Ok(())
        })();
        drop(frame);
        outcome
    }

    /// Reject a second producer operation before staged output has been fully drained.
    ///
    /// # Errors
    ///
    /// Return pendingOutput when the selected writer retains unread bytes.
    fn assert_no_pending(&self, operation: &str) -> Result<(), EngineError> {
        if self
            .codec
            .as_ref()
            .and_then(AnimationCodec::writer)
            .is_some_and(AnimationWriter::has_pending_output)
        {
            return Err(animation_failure(
                self.format,
                operation,
                AnimationFailureReason::PendingOutput,
                None,
                None,
            ));
        }
        Ok(())
    }

    /// Complete the container after all expected frames and previous chunks.
    ///
    /// # Errors
    ///
    /// Return a terminal state, pending output, incomplete count or final codec failure.
    pub fn finish(&mut self) -> Result<AnimationFinishOutput, EngineError> {
        self.assert_active("finish")?;
        match self.finish_active() {
            Ok(result) => Ok(result),
            Err(error) => Err(self.fail(error)),
        }
    }

    /// Produce completion metadata without waiting for external sink completion.
    ///
    /// # Errors
    ///
    /// Return the first count or writer failure.
    fn finish_active(&mut self) -> Result<AnimationFinishOutput, EngineError> {
        self.assert_no_pending("finish")?;
        if self.pushed_frames == 0 {
            return Err(animation_failure(
                self.format,
                "finish",
                AnimationFailureReason::NoFrames,
                Some("frameCount"),
                None,
            ));
        }
        if self.pushed_frames != self.expected_frames {
            return Err(animation_failure(
                self.format,
                "finish",
                AnimationFailureReason::IncompleteFrames,
                Some("frameCount"),
                None,
            ));
        }
        let codec = self.codec.as_mut().ok_or_else(|| {
            animation_failure(
                self.format,
                "finish",
                AnimationFailureReason::Aborted,
                None,
                None,
            )
        })?;
        let patch = codec.finish()?;
        let bytes_written = codec
            .writer()
            .ok_or_else(|| {
                animation_failure(
                    self.format,
                    "finish",
                    AnimationFailureReason::Aborted,
                    None,
                    None,
                )
            })?
            .bytes_written();
        self.state = AnimationState::Finishing;
        self.fonts = Vec::new();
        self.aliases = Vec::new();
        self.options = None;
        Ok(AnimationFinishOutput {
            format: self.format,
            frame_count: self.pushed_frames,
            bytes_written,
            patch,
        })
    }

    /// Release all owned resources without completing or deleting external output.
    ///
    /// # Errors
    ///
    /// This idempotent cleanup currently cannot fail.
    pub fn abort(&mut self) -> Result<(), EngineError> {
        if !matches!(self.state, AnimationState::Aborted) {
            self.release_resources();
            self.state = AnimationState::Aborted;
        }
        Ok(())
    }
}

impl AnimationSession<StagedWriter> {
    /// Return one copied chunk or the explicit completion marker for the current operation.
    ///
    /// # Errors
    ///
    /// Return the stored primary failure or an invalid terminal-state diagnostic.
    pub fn read_chunk(&mut self) -> Result<Option<Vec<u8>>, EngineError> {
        match &self.state {
            AnimationState::Failed(error) => return Err(copy_primary_failure(error)),
            AnimationState::Aborted | AnimationState::Finished => {
                return self.assert_active("drain").map(|()| None);
            }
            AnimationState::Active | AnimationState::Finishing => {}
        }
        let chunk = self
            .codec
            .as_mut()
            .and_then(AnimationCodec::writer_mut)
            .and_then(|writer| writer.inner_mut().read_chunk());
        if chunk.is_none() && matches!(self.state, AnimationState::Finishing) {
            self.state = AnimationState::Finished;
        }
        Ok(chunk)
    }
}

impl<W: AnimationWriter> Drop for AnimationSession<W> {
    fn drop(&mut self) {
        self.release_resources();
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::io::{self, Write};
    use std::rc::Rc;

    use super::*;

    #[derive(Default)]
    struct OutputProbe {
        bytes: Vec<u8>,
        patch_count: usize,
        disable_count: usize,
        write_calls: usize,
        should_fail_next: bool,
        should_fail_patch: bool,
        short_write: usize,
    }

    struct ProbeWriter(Rc<RefCell<OutputProbe>>);

    impl Write for ProbeWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            let mut probe = self.0.borrow_mut();
            probe.write_calls += 1;
            if probe.should_fail_next {
                probe.should_fail_next = false;
                return Err(io::ErrorKind::Interrupted.into());
            }
            let written = if probe.short_write == 0 {
                bytes.len()
            } else {
                bytes.len().min(probe.short_write)
            };
            probe.bytes.extend_from_slice(&bytes[..written]);
            Ok(written)
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl AnimationWriter for ProbeWriter {
        fn patch(&mut self, offset: u64, bytes: &[u8]) -> io::Result<()> {
            let mut probe = self.0.borrow_mut();
            probe.patch_count += 1;
            if probe.should_fail_patch {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            let start = usize::try_from(offset).expect("small test offset");
            probe.bytes[start..start + bytes.len()].copy_from_slice(bytes);
            Ok(())
        }

        fn disable(&mut self) {
            self.0.borrow_mut().disable_count += 1;
        }
    }

    fn options(frame_count: u64) -> AnimationSessionOptions {
        AnimationSessionOptions {
            frame_count,
            iterations: AnimatedRasterIterations::Finite(1),
            raster_options: RasterizeOptions::default(),
        }
    }

    fn frame() -> AnimationFrameInput {
        AnimationFrameInput { svg: r##"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4" fill="#e32"/></svg>"##.into(), duration_ms: 17 }
    }

    fn reason(error: &EngineError) -> &str {
        match error {
            EngineError::StructuredContext { context, .. } => {
                context["reason"].as_str().expect("closed reason")
            }
            _ => panic!("expected a structured diagnostic: {error}"),
        }
    }

    fn drain(session: &mut AnimationSession<StagedWriter>, output: &mut Vec<u8>) {
        while let Some(chunk) = session.read_chunk().expect("valid drain") {
            assert!(chunk.len() <= crate::animation_writer::ANIMATION_CHUNK_BYTES_MAX);
            output.extend_from_slice(&chunk);
        }
    }

    #[test]
    fn iteration_domain_is_structured_before_any_native_writer_output() {
        for (format, maximum) in [
            (AnimatedRasterFormat::Webp, 65_535),
            (AnimatedRasterFormat::Gif, 65_536),
        ] {
            for iterations in [0, maximum + 1] {
                let probe = Rc::new(RefCell::new(OutputProbe::default()));
                let mut input = options(1);
                input.iterations = AnimatedRasterIterations::Finite(iterations);
                let Err(error) = AnimationSession::open(
                    format,
                    input,
                    vec![],
                    vec![],
                    ProbeWriter(probe.clone()),
                ) else {
                    panic!("invalid iterations accepted");
                };
                assert_eq!(reason(&error), "outOfDomain");
                if let EngineError::StructuredContext { context, .. } = error {
                    assert_eq!(context["field"], "iterations");
                }
                assert!(probe.borrow().bytes.is_empty());
            }
        }
    }

    #[test]
    fn animation_session_direct_and_staged_bytes_match_with_short_writes() {
        for format in [AnimatedRasterFormat::Webp, AnimatedRasterFormat::Gif] {
            let probe = Rc::new(RefCell::new(OutputProbe {
                short_write: 3,
                ..OutputProbe::default()
            }));
            let mut direct = AnimationSession::open(
                format,
                options(2),
                vec![],
                vec![],
                ProbeWriter(probe.clone()),
            )
            .expect("valid open");
            assert!(
                probe.borrow().bytes.is_empty(),
                "open must not write a header"
            );
            let mut staged =
                AnimationSession::open(format, options(2), vec![], vec![], StagedWriter::default())
                    .expect("valid open");
            let mut output = Vec::new();
            for _ in 0..2 {
                direct.push(frame()).expect("valid direct push");
                staged.push(frame()).expect("valid staged push");
                drain(&mut staged, &mut output);
            }
            let direct_result = direct.finish().expect("valid direct finish");
            let staged_result = staged.finish().expect("valid staged finish");
            drain(&mut staged, &mut output);
            if let Some(patch) = staged_result.patch {
                output[4..8].copy_from_slice(&patch.bytes);
                assert_eq!(probe.borrow().patch_count, 1);
            } else {
                assert_eq!(probe.borrow().patch_count, 0);
            }
            assert_eq!(
                usize::try_from(direct_result.bytes_written).expect("fixture output fits usize"),
                output.len()
            );
            assert_eq!(probe.borrow().bytes, output);
            assert_eq!(reason(&staged.finish().unwrap_err()), "alreadyFinished");
        }
    }

    #[test]
    fn animation_session_terminal_failure_precedes_new_payload_and_drops_fonts() {
        let font = Arc::new(vec![1, 2, 3]);
        let mut session = AnimationSession::open(
            AnimatedRasterFormat::Gif,
            options(2),
            vec![],
            vec![font.clone()],
            StagedWriter::default(),
        )
        .expect("valid open");
        assert_eq!(Arc::strong_count(&font), 2);
        let first = session
            .push(AnimationFrameInput {
                duration_ms: 0,
                ..frame()
            })
            .unwrap_err();
        assert_eq!(reason(&first), "outOfDomain");
        assert_eq!(Arc::strong_count(&font), 1);
        let next = session
            .push(AnimationFrameInput {
                svg: "invalid".into(),
                duration_ms: 60001,
            })
            .unwrap_err();
        assert_eq!(first.to_string(), next.to_string());
        assert_eq!(first.to_string(), session.finish().unwrap_err().to_string());
        assert_eq!(
            first.to_string(),
            session.read_chunk().unwrap_err().to_string()
        );
        session.abort().expect("cleanup succeeds");
        session.abort().expect("repeat cleanup succeeds");
        assert_eq!(reason(&session.push(frame()).unwrap_err()), "aborted");
    }

    #[test]
    fn animation_session_domain_precedes_pending_and_pending_precedes_count() {
        for duration in [0, 17] {
            let mut session = AnimationSession::open(
                AnimatedRasterFormat::Gif,
                options(1),
                vec![],
                vec![],
                StagedWriter::default(),
            )
            .expect("valid open");
            session.push(frame()).expect("first push");
            let error = session
                .push(AnimationFrameInput {
                    duration_ms: duration,
                    ..frame()
                })
                .unwrap_err();
            assert_eq!(
                reason(&error),
                if duration == 0 {
                    "outOfDomain"
                } else {
                    "pendingOutput"
                }
            );
        }
        let mut session = AnimationSession::open(
            AnimatedRasterFormat::Gif,
            options(1),
            vec![],
            vec![],
            StagedWriter::default(),
        )
        .expect("valid open");
        session.push(frame()).expect("first push");
        drain(&mut session, &mut Vec::new());
        assert_eq!(reason(&session.push(frame()).unwrap_err()), "excessFrames");
    }

    #[test]
    fn animation_session_no_frames_and_incomplete_finish_are_terminal() {
        for pushed in [0, 1] {
            let mut session = AnimationSession::open(
                AnimatedRasterFormat::Gif,
                options(2),
                vec![],
                vec![],
                StagedWriter::default(),
            )
            .expect("valid open");
            if pushed == 1 {
                session.push(frame()).expect("first frame");
                drain(&mut session, &mut Vec::new());
            }
            let error = session.finish().unwrap_err();
            assert_eq!(
                reason(&error),
                if pushed == 0 {
                    "noFrames"
                } else {
                    "incompleteFrames"
                }
            );
            assert_eq!(
                error.to_string(),
                session.push(frame()).unwrap_err().to_string()
            );
        }
    }

    #[test]
    fn animation_session_io_failure_and_gif_finish_drop_cannot_append() {
        for format in [AnimatedRasterFormat::Webp, AnimatedRasterFormat::Gif] {
            for fail_finish in [false, true] {
                let probe = Rc::new(RefCell::new(OutputProbe::default()));
                let mut session = AnimationSession::open(
                    format,
                    options(1),
                    vec![],
                    vec![],
                    ProbeWriter(probe.clone()),
                )
                .expect("valid open");
                if fail_finish {
                    session.push(frame()).expect("valid push");
                    let mut state = probe.borrow_mut();
                    if format == AnimatedRasterFormat::Webp {
                        state.should_fail_patch = true;
                    } else {
                        state.should_fail_next = true;
                    }
                } else {
                    probe.borrow_mut().should_fail_next = true;
                }
                let error = if fail_finish {
                    session.finish().unwrap_err()
                } else {
                    session.push(frame()).unwrap_err()
                };
                let calls = probe.borrow().write_calls;
                let length = probe.borrow().bytes.len();
                assert!(probe.borrow().disable_count >= 1);
                assert_eq!(
                    error.to_string(),
                    session.push(frame()).unwrap_err().to_string()
                );
                drop(session);
                assert_eq!(
                    probe.borrow().write_calls,
                    calls,
                    "a failed GIF trailer must not be retried by Drop"
                );
                assert_eq!(probe.borrow().bytes.len(), length);
            }
        }
    }

    #[test]
    fn animation_session_drop_does_not_finish_an_active_gif() {
        let probe = Rc::new(RefCell::new(OutputProbe::default()));
        let mut session = AnimationSession::open(
            AnimatedRasterFormat::Gif,
            options(2),
            vec![],
            vec![],
            ProbeWriter(probe.clone()),
        )
        .expect("valid open");
        session.push(frame()).expect("first push");
        let calls = probe.borrow().write_calls;
        let length = probe.borrow().bytes.len();
        drop(session);
        assert_eq!(probe.borrow().write_calls, calls);
        assert_eq!(probe.borrow().bytes.len(), length);
    }

    #[test]
    fn animation_session_long_inputs_drain_each_frame_and_release_staging() {
        for format in [AnimatedRasterFormat::Webp, AnimatedRasterFormat::Gif] {
            for count in [326, 1001] {
                let mut session = AnimationSession::open(
                    format,
                    options(count),
                    vec![],
                    vec![],
                    StagedWriter::default(),
                )
                .expect("valid open");
                let mut total = 0;
                for _ in 0..count {
                    session.push(frame()).expect("long input frame");
                    while let Some(chunk) = session.read_chunk().expect("frame drain") {
                        total += chunk.len();
                    }
                    assert!(
                        !session
                            .codec
                            .as_ref()
                            .and_then(AnimationCodec::writer)
                            .expect("codec writer")
                            .has_pending_output()
                    );
                }
                let result = session.finish().expect("long input finish");
                while let Some(chunk) = session.read_chunk().expect("finish drain") {
                    total += chunk.len();
                }
                assert_eq!(result.frame_count, count);
                assert_eq!(
                    usize::try_from(result.bytes_written).expect("fixture output fits usize"),
                    total
                );
            }
        }
    }
}
