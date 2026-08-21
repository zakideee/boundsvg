//! MP4 container muxer for `@boundsvg/video`.
//!
//! Browser video export encodes frames with `WebCodecs` and only needs a
//! container around the resulting H.264 samples. This crate provides that
//! container as its own small wasm module so the boundsvg engine wasm stays
//! byte-identical.
//!
//! No codec lives here: sample payloads arrive already encoded.

mod generator;
mod muxer;

use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::generator::GeneratorIdentity;
use crate::muxer::VideoMuxer;

/// Builds a single-track H.264 MP4 file from encoded frames.
///
/// Sample timing is derived from the frame rate alone: the container timescale
/// is the numerator and every sample lasts `denominator` ticks, so a rational
/// rate such as 30000/1001 stays exact for the whole clip. Presentation
/// timestamps handed to the encoder are deliberately not accepted here.
#[wasm_bindgen]
pub struct Mp4VideoMuxer {
    inner: VideoMuxer,
}

#[wasm_bindgen]
impl Mp4VideoMuxer {
    /// Create a muxer for frames of the given padded size and frame rate.
    ///
    /// `frame_count_hint` sizes the space held open for the index so it lands
    /// ahead of the payload (faststart); pass the expected frame count, or the
    /// export ceiling when the count is not known up front.
    ///
    /// # Errors
    ///
    /// Fails when the dimensions are zero, odd, or beyond the MP4 limit, or
    /// when either frame rate term or the frame count hint is zero.
    #[wasm_bindgen(constructor)]
    pub fn new(
        width: u32,
        height: u32,
        fps_numerator: u32,
        fps_denominator: u32,
        frame_count_hint: u32,
        generator_name: Option<String>,
        generator_version: Option<String>,
    ) -> Result<Mp4VideoMuxer, JsError> {
        let generator = match (generator_name, generator_version) {
            (None, None) => None,
            (Some(name), Some(version)) => {
                Some(GeneratorIdentity::new(name, version).map_err(to_js)?)
            }
            _ => {
                return Err(to_js(
                    "generator name and version must be provided together",
                ));
            }
        };
        let inner = VideoMuxer::new(
            (width, height),
            (fps_numerator, fps_denominator),
            frame_count_hint,
            generator.as_ref(),
        )
        .map_err(to_js)?;
        Ok(Self { inner })
    }

    /// Store the `avcC` decoder configuration record for the track.
    ///
    /// # Errors
    ///
    /// Fails when the record does not parse, when a sample was already
    /// appended, or once [`Mp4VideoMuxer::finish`] has run.
    pub fn set_codec_description(&mut self, avcc: &[u8]) -> Result<(), JsError> {
        self.inner.set_codec_description(avcc).map_err(to_js)
    }

    /// Append one encoded frame in decode order.
    ///
    /// # Errors
    ///
    /// Fails when no codec description was set, once [`Mp4VideoMuxer::finish`]
    /// has run, or when the container writer rejects the sample.
    pub fn append_sample(&mut self, bytes: &[u8], is_key: bool) -> Result<(), JsError> {
        self.inner.append_sample(bytes, is_key).map_err(to_js)
    }

    /// Write the index and return the complete MP4 file.
    ///
    /// # Errors
    ///
    /// Fails when no sample was supplied, when called twice, or when the
    /// container writer rejects the accumulated samples.
    pub fn finish(&mut self) -> Result<Vec<u8>, JsError> {
        self.inner.finish().map_err(to_js)
    }
}

/// Convert to a real JS `Error`, so callers can read `.message`.
fn to_js(error: impl std::fmt::Display) -> JsError {
    JsError::new(&error.to_string())
}
