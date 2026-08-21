//! MP4 container assembly for a single H.264 video track.
//!
//! Sample payloads come from a browser `VideoEncoder` in `avc` format
//! (length-prefixed NAL units) together with an `avcC` decoder description.
//! This module only frames those payloads into an MP4 container — it never
//! encodes or transcodes video.

use std::fmt;
use std::num::{NonZeroU16, NonZeroU32};

use shiguredo_mp4::boxes::{Avc1Box, AvccBox, SampleEntry, UnknownBox, VisualSampleEntryFields};
use shiguredo_mp4::mux::{
    Mp4FileMuxer, Mp4FileMuxerOptions, Sample, estimate_maximum_moov_box_size,
};
use shiguredo_mp4::{BoxSize, BoxType, Decode, Encode, TrackKind, Uint};

use crate::generator::GeneratorIdentity;

/// Largest frame count the reserved index may be sized for.
///
/// The reservation grows linearly with this value, so an out-of-range number
/// crossing the wasm boundary would otherwise ask for an allocation that aborts
/// the module instead of returning an error.
const FRAME_COUNT_HINT_MAX: u32 = 1_000_000;

/// Largest file the muxer will accumulate, in bytes.
///
/// `Vec` grows by doubling, so a buffer approaching the 32-bit address space
/// needs several times this much live at once; 256 MiB — about two minutes of
/// 1080p at the export bitrate ceiling — leaves room for that growth. Past it
/// the allocator aborts the whole module instead of returning an error.
const FILE_BYTES_MAX: usize = 256 << 20;

/// Failure while assembling the MP4 container.
#[derive(Debug)]
pub enum MuxerError {
    /// A constructor argument was outside the range MP4 can represent.
    InvalidArgument(String),
    /// A required input was missing or arrived in the wrong order.
    MissingInput(String),
    /// `finish` was already called on this muxer.
    AlreadyFinished,
    /// The underlying container writer rejected the input.
    ContainerWrite(String),
}

impl fmt::Display for MuxerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidArgument(detail) | Self::MissingInput(detail) => {
                formatter.write_str(detail)
            }
            Self::AlreadyFinished => formatter.write_str("muxer has already been finished"),
            Self::ContainerWrite(detail) => {
                write!(formatter, "mp4 container write failed: {detail}")
            }
        }
    }
}

impl std::error::Error for MuxerError {}

/// Streams encoded H.264 samples into a faststart MP4 file.
///
/// Sample data is appended straight into the output buffer as it arrives, so a
/// long export never holds a second copy of the clip.
#[derive(Debug)]
pub struct VideoMuxer {
    muxer: Mp4FileMuxer,
    file_bytes: Vec<u8>,
    width: NonZeroU16,
    height: NonZeroU16,
    frame_rate_numerator: NonZeroU32,
    frame_rate_denominator: u32,
    sample_entry: Option<SampleEntry>,
    sample_count: usize,
    is_finished: bool,
    generator_udta_box: Option<UnknownBox>,
}

impl VideoMuxer {
    /// Create a muxer for a single H.264 track.
    ///
    /// The container time axis is `timescale = frame_rate_numerator` with every
    /// sample lasting `frame_rate_denominator` ticks, so rational rates such as
    /// 30000/1001 are expressed exactly and never drift.
    ///
    /// `frame_count_hint` sizes the space held open for the index so it can be
    /// written ahead of the payload (faststart). Overshooting only leaves
    /// padding in the file; undershooting makes [`VideoMuxer::finish`] fail.
    ///
    /// # Errors
    ///
    /// Returns [`MuxerError::InvalidArgument`] when the dimensions are zero,
    /// odd (H.264 yuv420 requires even dimensions), or larger than the MP4
    /// visual sample entry can hold, or when either frame rate term or the
    /// frame count hint is zero.
    pub fn new(
        dimensions: (u32, u32),
        frame_rate: (u32, u32),
        frame_count_hint: u32,
        generator: Option<&GeneratorIdentity>,
    ) -> Result<Self, MuxerError> {
        let width = check_dimension(dimensions.0, "width")?;
        let height = check_dimension(dimensions.1, "height")?;
        let frame_rate_numerator = NonZeroU32::new(frame_rate.0).ok_or_else(|| {
            MuxerError::InvalidArgument("frame rate numerator must be positive".to_string())
        })?;
        if frame_rate.1 == 0 {
            return Err(MuxerError::InvalidArgument(
                "frame rate denominator must be positive".to_string(),
            ));
        }
        if frame_count_hint == 0 || frame_count_hint > FRAME_COUNT_HINT_MAX {
            return Err(MuxerError::InvalidArgument(format!(
                "frame count hint must be between 1 and {FRAME_COUNT_HINT_MAX} (got {frame_count_hint})"
            )));
        }

        let generator_udta_box = generator.map(build_generator_udta_box).transpose()?;
        // Keep enough room for the metadata plus a valid trailing `free` box.
        // The no-generator branch preserves the previous reservation exactly.
        let generator_reservation = match &generator_udta_box {
            Some(metadata_box) => usize::try_from(metadata_box.box_size.get())
                .ok()
                .and_then(|metadata_size| metadata_size.checked_add(8))
                .ok_or_else(|| {
                    MuxerError::InvalidArgument(
                        "generator metadata reservation overflow".to_string(),
                    )
                })?,
            None => 0,
        };
        let reserved_moov_box_size = estimate_maximum_moov_box_size(&[frame_count_hint as usize])
            .checked_add(generator_reservation)
            .ok_or_else(|| {
                MuxerError::InvalidArgument("generator metadata reservation overflow".to_string())
            })?;
        let options = Mp4FileMuxerOptions {
            reserved_moov_box_size,
            ..Mp4FileMuxerOptions::default()
        };
        let muxer = Mp4FileMuxer::with_options(options).map_err(container_write_error)?;
        let file_bytes = muxer.initial_boxes_bytes().to_vec();

        Ok(Self {
            muxer,
            file_bytes,
            width,
            height,
            frame_rate_numerator,
            frame_rate_denominator: frame_rate.1,
            sample_entry: None,
            sample_count: 0,
            is_finished: false,
            generator_udta_box,
        })
    }

    /// Store the `avcC` decoder configuration record for the track.
    ///
    /// This is the `description` a browser `VideoEncoder` reports on its first
    /// key chunk, without the surrounding box header. It has to arrive before
    /// the first sample, because the sample table names it on the first entry.
    ///
    /// # Errors
    ///
    /// Returns [`MuxerError::InvalidArgument`] when the record does not parse or
    /// a sample was already appended, and [`MuxerError::AlreadyFinished`] once
    /// `finish` has run.
    pub fn set_codec_description(&mut self, avcc: &[u8]) -> Result<(), MuxerError> {
        if self.is_finished {
            return Err(MuxerError::AlreadyFinished);
        }
        if self.sample_count > 0 {
            return Err(MuxerError::InvalidArgument(
                "codec description must be set before the first sample".to_string(),
            ));
        }
        self.sample_entry = Some(self.build_sample_entry(avcc)?);
        Ok(())
    }

    /// Append one encoded frame in decode order.
    ///
    /// # Errors
    ///
    /// Returns [`MuxerError::MissingInput`] when no codec description was set,
    /// [`MuxerError::AlreadyFinished`] once `finish` has run, and
    /// [`MuxerError::ContainerWrite`] when the container writer rejects the
    /// sample.
    pub fn append_sample(&mut self, bytes: &[u8], is_key: bool) -> Result<(), MuxerError> {
        if self.is_finished {
            return Err(MuxerError::AlreadyFinished);
        }
        let is_first_sample = self.sample_count == 0;
        // The writer reuses the previous entry when this is None.
        let sample_entry = if is_first_sample {
            Some(self.sample_entry.clone().ok_or_else(|| {
                MuxerError::MissingInput("codec description was never set".to_string())
            })?)
        } else {
            None
        };

        let data_offset = self.file_bytes.len() as u64;
        if self.file_bytes.len().saturating_add(bytes.len()) > FILE_BYTES_MAX {
            return Err(MuxerError::ContainerWrite(format!(
                "output would exceed the {FILE_BYTES_MAX} byte limit"
            )));
        }
        self.file_bytes.try_reserve(bytes.len()).map_err(|_| {
            MuxerError::ContainerWrite("out of memory for the next sample".to_string())
        })?;

        // Told to the writer before the payload lands, so a rejected sample
        // leaves the buffer and the writer's position in step.
        self.muxer
            .append_sample(&Sample {
                track_kind: TrackKind::Video,
                sample_entry,
                keyframe: is_key,
                timescale: self.frame_rate_numerator,
                duration: self.frame_rate_denominator,
                composition_time_offset: None,
                data_offset,
                data_size: bytes.len(),
            })
            .map_err(container_write_error)?;
        self.file_bytes.extend_from_slice(bytes);
        self.sample_count += 1;
        Ok(())
    }

    /// Write the index and return the complete MP4 file.
    ///
    /// # Errors
    ///
    /// Returns [`MuxerError::MissingInput`] when no sample was appended,
    /// [`MuxerError::AlreadyFinished`] on a second call, and
    /// [`MuxerError::ContainerWrite`] when the writer rejects the accumulated
    /// samples or the reserved index space turned out too small.
    pub fn finish(&mut self) -> Result<Vec<u8>, MuxerError> {
        if self.is_finished {
            return Err(MuxerError::AlreadyFinished);
        }
        if self.sample_count == 0 {
            return Err(MuxerError::MissingInput(
                "no samples were appended".to_string(),
            ));
        }

        // finalize is not idempotent, so this muxer is spent from here on
        // however the rest of this call turns out.
        self.is_finished = true;
        let finalized = self.muxer.finalize().map_err(container_write_error)?;
        if !finalized.is_faststart_enabled() {
            return Err(MuxerError::ContainerWrite(format!(
                "reserved index space was too small for {} samples",
                self.sample_count
            )));
        }

        let custom_moov_bytes = if let Some(generator_udta_box) = &self.generator_udta_box {
            let mut moov_box = finalized.moov_box().clone();
            moov_box.unknown_boxes.push(generator_udta_box.clone());
            Some(moov_box.encode_to_vec().map_err(container_write_error)?)
        } else {
            None
        };
        let mut patches = Vec::new();
        for (offset, bytes) in finalized.offset_and_bytes_pairs() {
            let start = usize::try_from(offset).map_err(|_| {
                MuxerError::ContainerWrite("container offset exceeds address space".to_string())
            })?;
            patches.push((start, bytes));
        }
        let file_bytes = &mut self.file_bytes;
        for (start, bytes) in patches {
            let end = start.saturating_add(bytes.len());
            if end > file_bytes.len() {
                file_bytes.resize(end, 0);
            }
            file_bytes[start..end].copy_from_slice(bytes);
        }
        if let Some(custom_moov_bytes) = custom_moov_bytes {
            replace_faststart_moov(file_bytes, &custom_moov_bytes)?;
        }

        Ok(std::mem::take(&mut self.file_bytes))
    }

    fn build_sample_entry(&self, codec_description: &[u8]) -> Result<SampleEntry, MuxerError> {
        Ok(SampleEntry::Avc1(Avc1Box {
            visual: VisualSampleEntryFields {
                data_reference_index: VisualSampleEntryFields::DEFAULT_DATA_REFERENCE_INDEX,
                width: self.width.get(),
                height: self.height.get(),
                horizresolution: VisualSampleEntryFields::DEFAULT_HORIZRESOLUTION,
                vertresolution: VisualSampleEntryFields::DEFAULT_VERTRESOLUTION,
                frame_count: VisualSampleEntryFields::DEFAULT_FRAME_COUNT,
                compressorname: VisualSampleEntryFields::NULL_COMPRESSORNAME,
                depth: VisualSampleEntryFields::DEFAULT_DEPTH,
            },
            avcc_box: decode_avcc_box(codec_description)?,
            unknown_boxes: Vec::new(),
        }))
    }
}

/// Build the conventional `QuickTime` `©too` (encoding tool) item inside
/// `moov/udta/meta/ilst`. The value is constrained before this point and is
/// therefore a short public software identifier, never caller-provided XML or
/// an arbitrary metadata map.
fn build_generator_udta_box(generator: &GeneratorIdentity) -> Result<UnknownBox, MuxerError> {
    let mut data_payload = vec![0, 0, 0, 1, 0, 0, 0, 0]; // UTF-8 type, locale 0
    data_payload.extend_from_slice(generator.software_text().as_bytes());
    let data_box = encode_small_box(*b"data", &data_payload)?;
    let encoder_box = encode_small_box([0xA9, b't', b'o', b'o'], &data_box)?;
    let ilst_box = encode_small_box(*b"ilst", &encoder_box)?;

    let mut handler_payload = Vec::with_capacity(25);
    handler_payload.extend_from_slice(&[0; 8]); // version/flags and pre-defined
    handler_payload.extend_from_slice(b"mdir");
    handler_payload.extend_from_slice(b"appl");
    handler_payload.extend_from_slice(&[0; 8]);
    handler_payload.push(0); // empty handler name
    let handler_box = encode_small_box(*b"hdlr", &handler_payload)?;

    let mut meta_payload = vec![0; 4]; // full-box version and flags
    meta_payload.extend_from_slice(&handler_box);
    meta_payload.extend_from_slice(&ilst_box);
    let meta_box = encode_small_box(*b"meta", &meta_payload)?;
    let box_type = BoxType::Normal(*b"udta");
    Ok(UnknownBox {
        box_type,
        box_size: BoxSize::with_payload_size(box_type, meta_box.len() as u64),
        payload: meta_box,
    })
}

fn encode_small_box(box_type: [u8; 4], payload: &[u8]) -> Result<Vec<u8>, MuxerError> {
    let size = u32::try_from(8usize.saturating_add(payload.len())).map_err(|_| {
        MuxerError::InvalidArgument("generator metadata box is too large".to_string())
    })?;
    let mut box_bytes = Vec::with_capacity(size as usize);
    box_bytes.extend_from_slice(&size.to_be_bytes());
    box_bytes.extend_from_slice(&box_type);
    box_bytes.extend_from_slice(payload);
    Ok(box_bytes)
}

/// Replace the muxer's finalized `moov` with its metadata-bearing equivalent
/// while consuming the adjacent reserved `free` space. The overall head size
/// and every media-data offset remain unchanged.
fn replace_faststart_moov(
    file_bytes: &mut [u8],
    custom_moov_bytes: &[u8],
) -> Result<(), MuxerError> {
    let boxes = top_level_boxes(file_bytes)?;
    let moov_index = boxes
        .iter()
        .position(|(_, _, box_type)| box_type == b"moov")
        .ok_or_else(|| MuxerError::ContainerWrite("finalized MP4 has no moov box".to_string()))?;
    let (moov_offset, moov_size, _) = boxes[moov_index];
    let Some(&(free_offset, free_size, ref free_type)) = boxes.get(moov_index + 1) else {
        return Err(MuxerError::ContainerWrite(
            "generator metadata has no reserved free box".to_string(),
        ));
    };
    if free_type != b"free" || free_offset != moov_offset + moov_size {
        return Err(MuxerError::ContainerWrite(
            "generator metadata reservation is not adjacent to moov".to_string(),
        ));
    }
    let available_size = moov_size.saturating_add(free_size);
    if custom_moov_bytes.len() > available_size {
        return Err(MuxerError::ContainerWrite(
            "reserved index space was too small for generator metadata".to_string(),
        ));
    }
    let trailing_size = available_size - custom_moov_bytes.len();
    if trailing_size != 0 && trailing_size < 8 {
        return Err(MuxerError::ContainerWrite(
            "generator metadata left an invalid MP4 free-box gap".to_string(),
        ));
    }

    let custom_moov_end = moov_offset + custom_moov_bytes.len();
    file_bytes[moov_offset..custom_moov_end].copy_from_slice(custom_moov_bytes);
    if trailing_size > 0 {
        let trailing_size_u32 = u32::try_from(trailing_size).map_err(|_| {
            MuxerError::ContainerWrite("generator free box exceeds 32-bit size".to_string())
        })?;
        file_bytes[custom_moov_end..custom_moov_end + 4]
            .copy_from_slice(&trailing_size_u32.to_be_bytes());
        file_bytes[custom_moov_end + 4..custom_moov_end + 8].copy_from_slice(b"free");
        file_bytes[custom_moov_end + 8..moov_offset + available_size].fill(0);
    }
    Ok(())
}

fn top_level_boxes(file_bytes: &[u8]) -> Result<Vec<(usize, usize, [u8; 4])>, MuxerError> {
    let mut boxes = Vec::new();
    let mut offset = 0usize;
    while offset.saturating_add(8) <= file_bytes.len() {
        let declared_size = u32::from_be_bytes([
            file_bytes[offset],
            file_bytes[offset + 1],
            file_bytes[offset + 2],
            file_bytes[offset + 3],
        ]);
        let box_type = [
            file_bytes[offset + 4],
            file_bytes[offset + 5],
            file_bytes[offset + 6],
            file_bytes[offset + 7],
        ];
        let box_size = match declared_size {
            0 => file_bytes.len() - offset,
            1 => {
                if offset.saturating_add(16) > file_bytes.len() {
                    return Err(MuxerError::ContainerWrite(
                        "truncated large MP4 box header".to_string(),
                    ));
                }
                let large_size = u64::from_be_bytes([
                    file_bytes[offset + 8],
                    file_bytes[offset + 9],
                    file_bytes[offset + 10],
                    file_bytes[offset + 11],
                    file_bytes[offset + 12],
                    file_bytes[offset + 13],
                    file_bytes[offset + 14],
                    file_bytes[offset + 15],
                ]);
                usize::try_from(large_size).map_err(|_| {
                    MuxerError::ContainerWrite("MP4 box exceeds address space".to_string())
                })?
            }
            size => size as usize,
        };
        if box_size < 8 || offset.saturating_add(box_size) > file_bytes.len() {
            return Err(MuxerError::ContainerWrite(
                "invalid finalized MP4 box size".to_string(),
            ));
        }
        boxes.push((offset, box_size, box_type));
        offset += box_size;
    }
    if offset != file_bytes.len() {
        return Err(MuxerError::ContainerWrite(
            "trailing bytes after finalized MP4 boxes".to_string(),
        ));
    }
    Ok(boxes)
}

fn check_dimension(value: u32, label: &str) -> Result<NonZeroU16, MuxerError> {
    if value == 0 {
        return Err(MuxerError::InvalidArgument(format!(
            "{label} must be positive"
        )));
    }
    if !value.is_multiple_of(2) {
        return Err(MuxerError::InvalidArgument(format!(
            "{label} must be even for H.264 yuv420 (got {value})"
        )));
    }
    u16::try_from(value)
        .ok()
        .and_then(NonZeroU16::new)
        .ok_or_else(|| {
            MuxerError::InvalidArgument(format!(
                "{label} exceeds the mp4 limit of 65534 (got {value})"
            ))
        })
}

/// Parse an `avcC` decoder configuration record into its box representation.
///
/// `WebCodecs` hands out the bare record, so the eight header bytes the decoder
/// expects are prepended here; the record itself is parsed by the container
/// crate rather than by hand.
fn decode_avcc_box(codec_description: &[u8]) -> Result<AvccBox, MuxerError> {
    const AVCC_BOX_HEADER_SIZE: usize = 8;

    let box_size = u32::try_from(AVCC_BOX_HEADER_SIZE.saturating_add(codec_description.len()))
        .map_err(|_| MuxerError::InvalidArgument("codec description is too large".to_string()))?;
    let mut box_bytes = Vec::with_capacity(box_size as usize);
    box_bytes.extend_from_slice(&box_size.to_be_bytes());
    box_bytes.extend_from_slice(b"avcC");
    box_bytes.extend_from_slice(codec_description);

    let (mut avcc_box, _) = AvccBox::decode(&box_bytes).map_err(|error| {
        MuxerError::InvalidArgument(format!(
            "codec description is not a valid avcC record: {error}"
        ))
    })?;
    fill_chroma_defaults(&mut avcc_box);
    Ok(avcc_box)
}

/// Supply the chroma trailer that non-baseline profiles must serialize.
///
/// ISO/IEC 14496-15 makes those fields mandatory outside profiles 66/77/88, yet
/// encoders in the wild omit them and the parser tolerates that. Frames reach
/// this crate as 8-bit 4:2:0, so those values are the right fallback.
fn fill_chroma_defaults(avcc_box: &mut AvccBox) {
    const BASELINE_PROFILES: [u8; 3] = [66, 77, 88];
    const CHROMA_FORMAT_YUV420: u8 = 1;
    const BIT_DEPTH_8: u8 = 0;

    if BASELINE_PROFILES.contains(&avcc_box.avc_profile_indication) {
        return;
    }
    avcc_box
        .chroma_format
        .get_or_insert(Uint::new(CHROMA_FORMAT_YUV420));
    avcc_box
        .bit_depth_luma_minus8
        .get_or_insert(Uint::new(BIT_DEPTH_8));
    avcc_box
        .bit_depth_chroma_minus8
        .get_or_insert(Uint::new(BIT_DEPTH_8));
}

fn container_write_error(error: impl fmt::Display) -> MuxerError {
    MuxerError::ContainerWrite(error.to_string())
}

#[cfg(test)]
mod tests {
    use shiguredo_mp4::boxes::SampleEntry;
    use shiguredo_mp4::demux::{Input, Mp4FileDemuxer};
    use shiguredo_mp4::{Encode, Uint};

    use crate::generator::GeneratorIdentity;

    use super::{MuxerError, VideoMuxer};

    /// Frame rate of NTSC video, the case where naive fixed-duration timing drifts.
    const NTSC_FRAME_RATE: (u32, u32) = (30_000, 1001);

    /// Frame size used by the fixtures; even, as H.264 requires.
    const FRAME_SIZE: (u32, u32) = (64, 32);

    /// Minimal `avcC` record: High profile, level 4.0, four-byte NAL lengths.
    fn codec_description() -> Vec<u8> {
        let sps: [u8; 4] = [0x67, 0x64, 0x00, 0x28];
        let pps: [u8; 3] = [0x68, 0xEE, 0x3C];
        let mut record = vec![0x01, 0x64, 0x00, 0x28, 0xFF, 0xE1];
        record.extend_from_slice(&u16::try_from(sps.len()).unwrap().to_be_bytes());
        record.extend_from_slice(&sps);
        record.push(0x01);
        record.extend_from_slice(&u16::try_from(pps.len()).unwrap().to_be_bytes());
        record.extend_from_slice(&pps);
        record
    }

    /// Sample payload standing in for a length-prefixed access unit.
    fn sample_bytes(marker: u8, length: usize) -> Vec<u8> {
        vec![marker; length]
    }

    fn new_muxer(frame_rate: (u32, u32), frame_count_hint: u32) -> VideoMuxer {
        VideoMuxer::new(FRAME_SIZE, frame_rate, frame_count_hint, None).unwrap()
    }

    fn mux_frames(frame_count: usize, frame_rate: (u32, u32)) -> Vec<u8> {
        let mut muxer = new_muxer(frame_rate, u32::try_from(frame_count).unwrap());
        muxer.set_codec_description(&codec_description()).unwrap();
        for index in 0..frame_count {
            muxer
                .append_sample(
                    &sample_bytes(u8::try_from(index % 256).unwrap(), 16 + index),
                    index == 0,
                )
                .unwrap();
        }
        muxer.finish().unwrap()
    }

    fn mux_frames_with_generator(frame_count: usize) -> Vec<u8> {
        let generator =
            GeneratorIdentity::new("@scope/aaaa".to_string(), "1.2.3-beta.1".to_string()).unwrap();
        let mut muxer = VideoMuxer::new(
            FRAME_SIZE,
            NTSC_FRAME_RATE,
            u32::try_from(frame_count).unwrap(),
            Some(&generator),
        )
        .unwrap();
        muxer.set_codec_description(&codec_description()).unwrap();
        for index in 0..frame_count {
            muxer
                .append_sample(
                    &sample_bytes(u8::try_from(index % 256).unwrap(), 16 + index),
                    index == 0,
                )
                .unwrap();
        }
        muxer.finish().unwrap()
    }

    struct DemuxedSample {
        keyframe: bool,
        timestamp: u64,
        duration: u32,
        size: usize,
    }

    fn demux(file_bytes: &[u8]) -> (u32, Vec<DemuxedSample>, (u16, u16)) {
        let mut demuxer = Mp4FileDemuxer::new();
        demuxer.handle_input(Input {
            position: 0,
            data: file_bytes,
        });

        let tracks = demuxer.tracks().unwrap();
        assert_eq!(tracks.len(), 1, "video export writes a single track");
        let timescale = tracks[0].timescale.get();

        let mut samples = Vec::new();
        let mut resolution = None;
        while let Some(sample) = demuxer.next_sample().unwrap() {
            if let Some(SampleEntry::Avc1(avc1_box)) = sample.sample_entry {
                resolution = Some((avc1_box.visual.width, avc1_box.visual.height));
            }
            samples.push(DemuxedSample {
                keyframe: sample.keyframe,
                timestamp: sample.timestamp,
                duration: sample.duration,
                size: sample.data_size,
            });
        }
        (timescale, samples, resolution.expect("avc1 sample entry"))
    }

    /// Walk the top-level box chain, returning each box type in file order.
    ///
    /// Scanning for the raw type bytes would also match sample payloads, which
    /// is exactly what the ordering assertions must not depend on.
    fn top_level_box_types(file_bytes: &[u8]) -> Vec<String> {
        const HEADER_SIZE: usize = 8;
        const LARGE_SIZE_MARKER: u32 = 1;

        let mut types = Vec::new();
        let mut offset = 0;
        while offset + HEADER_SIZE <= file_bytes.len() {
            let declared_size =
                u32::from_be_bytes(file_bytes[offset..offset + 4].try_into().unwrap());
            let box_type =
                String::from_utf8_lossy(&file_bytes[offset + 4..offset + 8]).into_owned();
            let box_size = if declared_size == LARGE_SIZE_MARKER {
                let large = u64::from_be_bytes(
                    file_bytes[offset + HEADER_SIZE..offset + HEADER_SIZE + 8]
                        .try_into()
                        .unwrap(),
                );
                usize::try_from(large).unwrap()
            } else {
                declared_size as usize
            };
            types.push(box_type);
            if box_size == 0 {
                break;
            }
            offset += box_size;
        }
        types
    }

    #[test]
    fn muxes_a_two_sample_track_that_reads_back() {
        let file_bytes = mux_frames(2, (30, 1));
        let (timescale, samples, resolution) = demux(&file_bytes);

        assert_eq!(timescale, 30);
        assert_eq!(resolution, (64, 32));
        assert_eq!(samples.len(), 2);
        assert!(samples[0].keyframe);
        assert!(!samples[1].keyframe);
        assert_eq!(samples[0].duration, 1);
        assert_eq!(samples[1].duration, 1);
        assert_eq!(samples[0].timestamp, 0);
        assert_eq!(samples[1].timestamp, 1);
        assert_eq!(samples[0].size, 16);
        assert_eq!(samples[1].size, 17);
    }

    #[test]
    fn places_moov_before_mdat_for_faststart() {
        let file_bytes = mux_frames(4, (30, 1));
        let box_types = top_level_box_types(&file_bytes);
        let moov_index = box_types.iter().position(|name| name == "moov");
        let mdat_index = box_types.iter().position(|name| name == "mdat");

        assert_eq!(box_types.first().map(String::as_str), Some("ftyp"));
        assert!(moov_index < mdat_index, "box order was {box_types:?}");
    }

    #[test]
    fn keeps_faststart_at_the_frame_ceiling() {
        let file_bytes = mux_frames(3600, (30, 1));
        let box_types = top_level_box_types(&file_bytes);
        assert!(
            box_types.iter().position(|name| name == "moov")
                < box_types.iter().position(|name| name == "mdat"),
            "box order was {box_types:?}"
        );
    }

    #[test]
    fn rejects_finishing_past_the_reserved_index_space() {
        let mut muxer = new_muxer((30, 1), 1);
        muxer.set_codec_description(&codec_description()).unwrap();
        for index in 0..600 {
            muxer
                .append_sample(&sample_bytes(1, 32), index == 0)
                .unwrap();
        }
        let error = muxer.finish().unwrap_err();
        assert!(matches!(error, MuxerError::ContainerWrite(_)));
        assert!(error.to_string().contains("reserved index space"));
    }

    #[test]
    fn keeps_ntsc_timing_exact_over_a_long_clip() {
        let (numerator, denominator) = NTSC_FRAME_RATE;
        let frame_count = 3600;
        let file_bytes = mux_frames(frame_count, NTSC_FRAME_RATE);
        let (timescale, samples, _) = demux(&file_bytes);

        assert_eq!(timescale, numerator);
        assert_eq!(samples.len(), frame_count);
        assert!(samples.iter().all(|sample| sample.duration == denominator));

        let last = samples.last().expect("at least one sample");
        let total_ticks = last.timestamp + u64::from(last.duration);
        assert_eq!(total_ticks, frame_count as u64 * u64::from(denominator));
    }

    #[test]
    fn produces_identical_bytes_for_identical_input() {
        assert_eq!(
            mux_frames(8, NTSC_FRAME_RATE),
            mux_frames(8, NTSC_FRAME_RATE)
        );
    }

    #[test]
    fn embeds_a_deterministic_encoding_tool_without_breaking_faststart() {
        let first = mux_frames_with_generator(8);
        let second = mux_frames_with_generator(8);

        assert_eq!(first, second);
        assert!(
            first
                .windows(b"@scope/aaaa/1.2.3-beta.1".len())
                .any(|window| window == b"@scope/aaaa/1.2.3-beta.1")
        );
        assert!(
            first
                .windows(4)
                .any(|window| window == [0xA9, b't', b'o', b'o'])
        );
        let box_types = top_level_box_types(&first);
        assert!(
            box_types.iter().position(|name| name == "moov")
                < box_types.iter().position(|name| name == "mdat")
        );
        let (_, samples, resolution) = demux(&first);
        assert_eq!(samples.len(), 8);
        assert_eq!(resolution, (64, 32));
    }

    #[test]
    fn default_output_has_no_generator_marker() {
        let file_bytes = mux_frames(2, (30, 1));
        assert!(
            !file_bytes
                .windows(b"@scope/aaaa/1.2.3-beta.1".len())
                .any(|window| window == b"@scope/aaaa/1.2.3-beta.1")
        );
    }

    /// `avcC` record a real Chrome 134 `VideoEncoder` reported for
    /// `avc1.640028` at 320x180, captured from a browser check.
    fn chrome_codec_description() -> Vec<u8> {
        vec![
            0x01, 0x64, 0x0C, 0x14, 0xFF, 0xE1, 0x00, 0x13, 0x67, 0x64, 0x0C, 0x14, 0xAC, 0x18,
            0xD0, 0x28, 0x32, 0xF3, 0xCD, 0x40, 0x43, 0x41, 0x81, 0xE1, 0x10, 0x8D, 0x40, 0x01,
            0x00, 0x04, 0x68, 0xCE, 0x3C, 0x80, 0xFD, 0xF8, 0xF8, 0x00,
        ]
    }

    #[test]
    fn round_trips_a_browser_codec_description_byte_for_byte() {
        const AVCC_BOX_HEADER_SIZE: usize = 8;

        let description = chrome_codec_description();
        let mut muxer = new_muxer((30, 1), 2);
        muxer.set_codec_description(&description).unwrap();
        muxer.append_sample(&sample_bytes(0, 16), true).unwrap();
        muxer.append_sample(&sample_bytes(1, 16), false).unwrap();
        let file_bytes = muxer.finish().unwrap();

        let mut demuxer = Mp4FileDemuxer::new();
        demuxer.handle_input(Input {
            position: 0,
            data: &file_bytes,
        });
        let sample = demuxer.next_sample().unwrap().expect("first sample");
        let Some(SampleEntry::Avc1(avc1_box)) = sample.sample_entry else {
            panic!("expected an avc1 sample entry");
        };

        // A field the parser tolerates but drops would change the description
        // players configure their decoder with.
        let written = avc1_box.avcc_box.encode_to_vec().unwrap();
        assert_eq!(&written[AVCC_BOX_HEADER_SIZE..], &description[..]);
    }

    #[test]
    fn defaults_the_chroma_trailer_to_8_bit_yuv420() {
        // A record without the trailer must come back describing the format the
        // frames actually carry, not zeros.
        let mut avcc_box = super::decode_avcc_box(&codec_description()).unwrap();
        assert_eq!(avcc_box.chroma_format.take().map(Uint::get), Some(1));
        assert_eq!(
            avcc_box.bit_depth_luma_minus8.take().map(Uint::get),
            Some(0)
        );
        assert_eq!(
            avcc_box.bit_depth_chroma_minus8.take().map(Uint::get),
            Some(0)
        );
    }

    #[test]
    fn accepts_a_codec_description_carrying_the_chroma_trailer() {
        // 4:2:0, 8-bit luma and chroma, no SPS extension — the trailer a browser
        // normally appends for High profile.
        let mut record = codec_description();
        record.extend_from_slice(&[0xFD, 0xF8, 0xF8, 0x00]);

        let mut muxer = new_muxer((30, 1), 1);
        muxer.set_codec_description(&record).unwrap();
        muxer.append_sample(&sample_bytes(0, 16), true).unwrap();
        let file_bytes = muxer.finish().unwrap();

        let (_, samples, resolution) = demux(&file_bytes);
        assert_eq!(samples.len(), 1);
        assert_eq!(resolution, (64, 32));
    }

    #[test]
    fn rejects_odd_dimensions() {
        let error = VideoMuxer::new((65, 32), (30, 1), 1, None).unwrap_err();
        assert!(matches!(error, MuxerError::InvalidArgument(_)));
        assert!(error.to_string().contains("even"));
    }

    #[test]
    fn rejects_a_zero_frame_rate() {
        assert!(matches!(
            VideoMuxer::new(FRAME_SIZE, (0, 1), 1, None).unwrap_err(),
            MuxerError::InvalidArgument(_)
        ));
        assert!(matches!(
            VideoMuxer::new(FRAME_SIZE, (30, 0), 1, None).unwrap_err(),
            MuxerError::InvalidArgument(_)
        ));
    }

    #[test]
    fn rejects_an_out_of_range_frame_count_hint() {
        assert!(matches!(
            VideoMuxer::new(FRAME_SIZE, (30, 1), 0, None).unwrap_err(),
            MuxerError::InvalidArgument(_)
        ));
        assert!(matches!(
            VideoMuxer::new(FRAME_SIZE, (30, 1), u32::MAX, None).unwrap_err(),
            MuxerError::InvalidArgument(_)
        ));
    }

    #[test]
    fn rejects_a_sample_before_the_codec_description() {
        let mut muxer = new_muxer((30, 1), 1);
        assert!(matches!(
            muxer.append_sample(&sample_bytes(0, 8), true).unwrap_err(),
            MuxerError::MissingInput(_)
        ));
    }

    #[test]
    fn rejects_a_codec_description_after_the_first_sample() {
        let mut muxer = new_muxer((30, 1), 2);
        muxer.set_codec_description(&codec_description()).unwrap();
        muxer.append_sample(&sample_bytes(0, 8), true).unwrap();
        assert!(matches!(
            muxer
                .set_codec_description(&codec_description())
                .unwrap_err(),
            MuxerError::InvalidArgument(_)
        ));
    }

    #[test]
    fn rejects_finishing_without_samples() {
        let mut muxer = new_muxer((30, 1), 1);
        muxer.set_codec_description(&codec_description()).unwrap();
        assert!(matches!(
            muxer.finish().unwrap_err(),
            MuxerError::MissingInput(_)
        ));
    }

    #[test]
    fn rejects_use_after_finish() {
        let mut muxer = new_muxer((30, 1), 1);
        muxer.set_codec_description(&codec_description()).unwrap();
        muxer.append_sample(&sample_bytes(0, 8), true).unwrap();
        muxer.finish().unwrap();

        assert!(matches!(
            muxer.append_sample(&sample_bytes(1, 8), false).unwrap_err(),
            MuxerError::AlreadyFinished
        ));
        assert!(matches!(
            muxer.finish().unwrap_err(),
            MuxerError::AlreadyFinished
        ));
    }

    #[test]
    fn rejects_a_sample_that_would_pass_the_byte_limit() {
        let mut muxer = new_muxer((30, 1), 2);
        muxer.set_codec_description(&codec_description()).unwrap();
        let oversized = vec![0u8; 4096];
        // Stand in for a stream far past the limit without allocating one.
        muxer.file_bytes.resize(super::FILE_BYTES_MAX, 0);
        let error = muxer.append_sample(&oversized, true).unwrap_err();
        assert!(matches!(error, MuxerError::ContainerWrite(_)));
        assert!(error.to_string().contains("byte limit"));
    }

    #[test]
    fn rejects_a_malformed_codec_description() {
        let mut muxer = new_muxer((30, 1), 1);
        assert!(matches!(
            muxer.set_codec_description(&[0x09, 0x00]).unwrap_err(),
            MuxerError::InvalidArgument(_)
        ));
    }
}
