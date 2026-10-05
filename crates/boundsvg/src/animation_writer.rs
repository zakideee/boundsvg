//! Checked animation output and bounded-operation staging shared by both codecs.

use std::io::{self, Write};

use crate::error::EngineError;
use crate::raster_anim::{AnimatedRasterFormat, AnimationFailureReason, animation_failure};

/// Largest copied chunk returned from a staged operation.
pub const ANIMATION_CHUNK_BYTES_MAX: usize = 65_536;

/// Largest integer output position exactly representable by JavaScript.
const OUTPUT_POSITION_MAX: u64 = (1_u64 << 53) - 1;

/// Largest complete animated WebP permitted by the RIFF container specification.
const WEBP_FILE_BYTES_MAX: u64 = (1_u64 << 32) - 2;

/// Caller-owned animation output with a positional patch and terminal write suppression.
pub trait AnimationWriter: Write {
    /// Apply a positional patch without changing the append position.
    ///
    /// # Errors
    ///
    /// Return an IO error if positional output is unavailable or fails.
    fn patch(&mut self, offset: u64, bytes: &[u8]) -> io::Result<()>;

    /// Prevent further visible output, including a codec's destructor writes.
    fn disable(&mut self);

    /// Report output awaiting a consumer drain; direct writers have no pending output.
    fn has_pending_output(&self) -> bool {
        false
    }
}

impl<W: AnimationWriter + ?Sized> AnimationWriter for &mut W {
    fn patch(&mut self, offset: u64, bytes: &[u8]) -> io::Result<()> {
        (**self).patch(offset, bytes)
    }

    fn disable(&mut self) {
        (**self).disable();
    }

    fn has_pending_output(&self) -> bool {
        (**self).has_pending_output()
    }
}

/// A deferred WebP header patch emitted after all append chunks.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationPatch {
    /// RIFF size field position, always four.
    pub offset: u64,
    /// Exactly four little-endian RIFF size bytes.
    pub bytes: [u8; 4],
}

/// Retain only one synchronous codec operation until its copied chunks are drained.
#[derive(Default)]
pub struct StagedWriter {
    pending: Vec<u8>,
    read_offset: usize,
    patch: Option<AnimationPatch>,
    is_disabled: bool,
}

impl StagedWriter {
    /// Copy the next bounded chunk, retaining at most one chunk of empty staging capacity.
    pub(crate) fn read_chunk(&mut self) -> Option<Vec<u8>> {
        if self.read_offset == self.pending.len() {
            return None;
        }
        let end = self
            .pending
            .len()
            .min(self.read_offset + ANIMATION_CHUNK_BYTES_MAX);
        let chunk = self.pending[self.read_offset..end].to_vec();
        self.read_offset = end;
        if end == self.pending.len() {
            if self.pending.capacity() <= ANIMATION_CHUNK_BYTES_MAX {
                self.pending.clear();
            } else {
                self.pending = Vec::new();
            }
            self.read_offset = 0;
        }
        Some(chunk)
    }
}

impl Write for StagedWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.is_disabled {
            return Ok(bytes.len());
        }
        if let Err(error) = self.pending.try_reserve(bytes.len()) {
            self.disable();
            return Err(io::Error::other(error));
        }
        self.pending.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl AnimationWriter for StagedWriter {
    fn patch(&mut self, offset: u64, bytes: &[u8]) -> io::Result<()> {
        if self.is_disabled {
            return Ok(());
        }
        let patch_bytes: [u8; 4] = bytes.try_into().map_err(|_| io::ErrorKind::InvalidInput)?;
        if offset != 4 || self.patch.is_some() {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        self.patch = Some(AnimationPatch {
            offset,
            bytes: patch_bytes,
        });
        Ok(())
    }

    fn disable(&mut self) {
        self.is_disabled = true;
        self.pending = Vec::new();
        self.read_offset = 0;
        self.patch = None;
    }

    fn has_pending_output(&self) -> bool {
        !self.pending.is_empty()
    }
}

/// Count actual append writes and suppress all output after the first IO failure.
pub(crate) struct GuardedWriter<W: AnimationWriter> {
    inner: W,
    format: AnimatedRasterFormat,
    bytes_written: u64,
    is_disabled: bool,
}

impl<W: AnimationWriter> GuardedWriter<W> {
    /// Attach a checked append counter to one caller-owned output.
    pub(crate) fn new(inner: W, format: AnimatedRasterFormat) -> Self {
        Self {
            inner,
            format,
            bytes_written: 0,
            is_disabled: false,
        }
    }

    /// Read the physical append count, excluding positional patches.
    pub(crate) fn bytes_written(&self) -> u64 {
        self.bytes_written
    }

    /// Drain staging under the same codec owner.
    pub(crate) fn inner_mut(&mut self) -> &mut W {
        &mut self.inner
    }

    /// Construct a checked-position error before output reaches the inner writer.
    fn position_error(&self, reason: AnimationFailureReason) -> io::Error {
        io::Error::other(animation_failure(
            self.format,
            "write",
            reason,
            Some("bytesWritten"),
            None,
        ))
    }
}

impl<W: AnimationWriter> Write for GuardedWriter<W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.is_disabled {
            return Ok(bytes.len());
        }
        let next_position = self.bytes_written.checked_add(bytes.len() as u64);
        let checked = match next_position {
            None => Err(self.position_error(AnimationFailureReason::CounterOverflow)),
            Some(position) if position > OUTPUT_POSITION_MAX => {
                Err(self.position_error(AnimationFailureReason::UnsafeOutputPosition))
            }
            Some(position)
                if self.format == AnimatedRasterFormat::Webp && position > WEBP_FILE_BYTES_MAX =>
            {
                Err(self.position_error(AnimationFailureReason::RiffSize))
            }
            Some(_) => Ok(()),
        };
        if let Err(error) = checked {
            self.disable();
            return Err(error);
        }
        match self.inner.write(bytes) {
            Ok(written) if written <= bytes.len() => {
                self.bytes_written += written as u64;
                Ok(written)
            }
            Ok(_) => {
                self.disable();
                Err(io::ErrorKind::InvalidData.into())
            }
            Err(error) => {
                self.disable();
                Err(error)
            }
        }
    }

    fn write_all(&mut self, mut bytes: &[u8]) -> io::Result<()> {
        while !bytes.is_empty() {
            // Propagate Interrupted too: a failed codec operation is terminal,
            // and retrying against a disabled writer must not report success.
            let written = self.write(bytes)?;
            if written == 0 {
                self.disable();
                return Err(io::ErrorKind::WriteZero.into());
            }
            bytes = &bytes[written..];
        }
        Ok(())
    }

    fn flush(&mut self) -> io::Result<()> {
        if self.is_disabled {
            return Ok(());
        }
        if let Err(error) = self.inner.flush() {
            self.disable();
            return Err(error);
        }
        Ok(())
    }
}

impl<W: AnimationWriter> AnimationWriter for GuardedWriter<W> {
    fn patch(&mut self, offset: u64, bytes: &[u8]) -> io::Result<()> {
        if self.is_disabled {
            return Ok(());
        }
        if let Err(error) = self.inner.patch(offset, bytes) {
            self.disable();
            return Err(error);
        }
        Ok(())
    }

    fn disable(&mut self) {
        self.is_disabled = true;
        self.inner.disable();
    }

    fn has_pending_output(&self) -> bool {
        self.inner.has_pending_output()
    }
}

/// Preserve a typed counter failure wrapped by IO; leave legacy codec messages unchanged.
pub(crate) fn animation_io_error(error: &io::Error, message: &str) -> EngineError {
    if let Some(EngineError::StructuredContext {
        code,
        message,
        stage,
        node_id,
        context,
    }) = error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<EngineError>())
    {
        return EngineError::StructuredContext {
            code: code.clone(),
            message: message.clone(),
            stage: *stage,
            node_id: node_id.clone(),
            context: context.clone(),
        };
    }
    EngineError::Rasterize(format!("{message}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct ProbeWriter {
        write_calls: usize,
        patch_calls: usize,
        is_disabled: bool,
    }
    impl Write for ProbeWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.write_calls += 1;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    impl AnimationWriter for ProbeWriter {
        fn patch(&mut self, _offset: u64, _bytes: &[u8]) -> io::Result<()> {
            self.patch_calls += 1;
            Ok(())
        }
        fn disable(&mut self) {
            self.is_disabled = true;
        }
    }

    #[test]
    fn position_boundaries_fail_before_io_and_disable_later_drop_writes() {
        for (format, ceiling, reason) in [
            (AnimatedRasterFormat::Webp, WEBP_FILE_BYTES_MAX, "riffSize"),
            (
                AnimatedRasterFormat::Gif,
                OUTPUT_POSITION_MAX,
                "unsafeOutputPosition",
            ),
            (AnimatedRasterFormat::Gif, u64::MAX, "counterOverflow"),
        ] {
            let mut writer = GuardedWriter::new(ProbeWriter::default(), format);
            // Fault injection moves only the counter; no multi-gigabyte allocation is needed.
            let expected_calls = if ceiling == u64::MAX {
                writer.bytes_written = ceiling;
                0
            } else {
                writer.bytes_written = ceiling - 1;
                writer.write_all(&[1]).expect("last representable byte");
                1
            };
            let error = writer
                .write_all(&[2])
                .expect_err("unrepresentable next position");
            let structured = error
                .get_ref()
                .and_then(|inner| inner.downcast_ref::<EngineError>())
                .expect("typed counter error");
            if let EngineError::StructuredContext { context, .. } = structured {
                assert_eq!(context["reason"], reason);
            } else {
                panic!("expected closed counter diagnostic");
            }
            assert_eq!(writer.bytes_written, ceiling);
            assert!(writer.inner.is_disabled);
            assert_eq!(writer.inner.write_calls, expected_calls);
            writer
                .write_all(&[3])
                .expect("disabled destructor write suppressed");
            writer.patch(4, &[0; 4]).expect("disabled patch suppressed");
            assert_eq!(writer.inner.write_calls, expected_calls);
            assert_eq!(writer.inner.patch_calls, 0);
        }
    }

    #[test]
    fn staging_reuses_bounded_empty_capacity_and_discards_large_operations() {
        let mut writer = StagedWriter::default();
        for _ in 0..1001 {
            writer.write_all(&[7; 256]).expect("bounded frame write");
            assert_eq!(writer.read_chunk().expect("frame chunk"), vec![7; 256]);
            assert!(writer.pending.is_empty());
            assert!(!writer.has_pending_output());
            assert!(writer.pending.capacity() >= 256);
            assert!(writer.pending.capacity() <= ANIMATION_CHUNK_BYTES_MAX);
            assert_eq!(writer.read_chunk(), None);
        }
        let large = vec![9; ANIMATION_CHUNK_BYTES_MAX + 1];
        writer.write_all(&large).expect("large single operation");
        assert_eq!(
            writer.read_chunk().expect("full chunk").len(),
            ANIMATION_CHUNK_BYTES_MAX
        );
        assert!(writer.has_pending_output());
        assert_eq!(writer.read_chunk().expect("last byte"), vec![9]);
        assert_eq!(writer.pending.capacity(), 0);
        assert!(!writer.has_pending_output());
        writer.write_all(&[1; 256]).expect("following frame");
        writer.disable();
        assert_eq!(writer.pending.capacity(), 0);
        assert_eq!(writer.read_chunk(), None);
    }
}
