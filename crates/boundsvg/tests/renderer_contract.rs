//! Verify native SVG, raster and custom-renderer contracts across Cargo feature sets.

#![cfg(test)]

use std::io::Cursor;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use boundsvg::BoundSvgEngine;
use boundsvg::error::EngineError;
use boundsvg::rasterize::RasterizeOptions;
use boundsvg::render_backend::Renderer;
use boundsvg::render_resvg::ResvgRenderer;

/// Two red pixels with independently known decoded RGBA values.
const SOLID_RED_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"><rect width="2" height="1" fill="#ff0000"/></svg>"##;

#[test]
fn native_engine_emits_svg_without_registered_fonts() {
    let engine = BoundSvgEngine::create();
    let output = engine
        .render_to_svg(
            r#"{"root":{"nodeId":"canvas","nodeType":"Canvas","authoredId":true,"style":{"width":2,"height":1},"children":[]},"fonts":[]}"#,
            "{}",
        )
        .expect("empty canvas should render");
    let result: serde_json::Value = serde_json::from_str(&output).expect("SVG output envelope");
    let document = roxmltree::Document::parse(result["svg"].as_str().expect("SVG string"))
        .expect("well-formed SVG");
    let root = document.root_element();
    assert!(root.has_tag_name("svg"));
    assert_eq!(root.attribute("width"), Some("2"));
    assert_eq!(root.attribute("height"), Some("1"));
}

#[test]
fn default_engine_preserves_png_and_lossless_webp_pixels() {
    let engine = BoundSvgEngine::create();
    let png_bytes = engine.svg_to_png(SOLID_RED_SVG).expect("PNG rasterization");
    let mut reader = png::Decoder::new(Cursor::new(png_bytes))
        .read_info()
        .expect("PNG header");
    let mut png_pixels = vec![0; reader.output_buffer_size().expect("PNG buffer size")];
    let frame = reader.next_frame(&mut png_pixels).expect("PNG pixels");
    assert_eq!((frame.width, frame.height), (2, 1));
    assert_eq!(frame.color_type, png::ColorType::Rgba);
    assert_eq!(frame.bit_depth, png::BitDepth::Eight);
    assert_eq!(
        &png_pixels[..frame.buffer_size()],
        &[255, 0, 0, 255, 255, 0, 0, 255]
    );

    let webp_bytes = engine
        .svg_to_webp_with_options(SOLID_RED_SVG, "{}")
        .expect("WebP rasterization");
    let mut decoder = image_webp::WebPDecoder::new(Cursor::new(webp_bytes)).expect("WebP header");
    assert_eq!(decoder.dimensions(), (2, 1));
    let expected_pixels: &[u8] = if decoder.has_alpha() {
        &[255, 0, 0, 255, 255, 0, 0, 255]
    } else {
        &[255, 0, 0, 255, 0, 0]
    };
    let mut webp_pixels = vec![0; decoder.output_buffer_size().expect("WebP buffer size")];
    decoder.read_image(&mut webp_pixels).expect("WebP pixels");
    assert_eq!(webp_pixels.as_slice(), expected_pixels);
}

struct CountingRenderer {
    calls: Arc<AtomicUsize>,
}

impl Renderer for CountingRenderer {
    fn svg_to_png(
        &self,
        svg_string: &str,
        alias_map: &[(String, String)],
        font_data: &[Arc<Vec<u8>>],
        options: &RasterizeOptions,
    ) -> Result<Vec<u8>, EngineError> {
        assert_eq!(svg_string, SOLID_RED_SVG);
        assert!(alias_map.is_empty() && font_data.is_empty());
        assert_eq!(options.scale, None);
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(b"custom PNG result".to_vec())
    }

    fn svg_to_webp(
        &self,
        svg_string: &str,
        alias_map: &[(String, String)],
        font_data: &[Arc<Vec<u8>>],
        options: &RasterizeOptions,
    ) -> Result<Vec<u8>, EngineError> {
        assert_eq!(svg_string, SOLID_RED_SVG);
        assert!(alias_map.is_empty() && font_data.is_empty());
        assert_eq!(options.scale, Some(2.0));
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(b"custom WebP result".to_vec())
    }
}

#[test]
fn engine_dispatches_png_and_webp_to_the_injected_renderer() {
    let calls = Arc::new(AtomicUsize::new(0));
    let engine = BoundSvgEngine::with_renderer(Arc::new(CountingRenderer {
        calls: Arc::clone(&calls),
    }));
    assert_eq!(
        engine.svg_to_png(SOLID_RED_SVG).expect("custom PNG"),
        b"custom PNG result"
    );
    assert_eq!(
        engine
            .svg_to_webp_with_options(SOLID_RED_SVG, r#"{"scale":2}"#)
            .expect("custom WebP"),
        b"custom WebP result"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[test]
fn default_renderer_preserves_the_typed_svg_parse_error() {
    let failure = ResvgRenderer
        .svg_to_png(
            "not an SVG document",
            &[],
            &[],
            &RasterizeOptions::default(),
        )
        .expect_err("invalid SVG must fail");
    let EngineError::SvgParse(svg_error) = failure else {
        panic!("expected the SVG parse variant");
    };
    let _: usvg::Error = svg_error;
}
