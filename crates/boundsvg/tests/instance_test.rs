// Integration tests always build with `cfg(test)`; declaring it lets clippy's
// `allow-*-in-tests` config apply to helper functions in this file.
#![cfg(test)]

use boundsvg::BoundSvgEngine;
use boundsvg::font::FontStyle;
use boundsvg::font::outline;
use boundsvg::font::shaping;
use boundsvg::gif_anim;
use boundsvg::layout;
use boundsvg::rasterize;
use boundsvg::webp_encode;
use serde_json::Value;

fn test_font_data() -> Vec<u8> {
    std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
    ))
    .expect("fixture font should exist")
}

fn test_jetbrains_mono_data() -> Vec<u8> {
    std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fonts/JetBrainsMono-Regular.woff2"
    ))
    .expect("fixture font should exist")
}

fn register(engine: &mut BoundSvgEngine, data: &[u8], alias: &str, weight: u16, style: FontStyle) {
    let decoded =
        boundsvg::font::decode::decode_font(data.to_vec()).expect("decode should succeed");
    engine
        .registry_mut()
        .register(decoded, alias.to_string(), weight, style)
        .expect("register should succeed");
}

#[test]
fn create_engine_without_panic() {
    let _engine = BoundSvgEngine::create();
}

#[test]
fn register_font_and_shape() {
    let mut engine = BoundSvgEngine::create();
    let font_data = test_font_data();
    register(&mut engine, &font_data, "NotoTest", 400, FontStyle::Normal);

    let entry = engine
        .registry()
        .resolve("NotoTest", 400, &FontStyle::Normal)
        .expect("font should be registered");
    let glyphs = shaping::shape_text(engine.registry(), entry, "テスト", 24.0, 0.0);
    assert!(!glyphs.is_empty(), "should produce glyphs");
}

#[test]
fn two_instances_have_isolated_registries() {
    let mut engine1 = BoundSvgEngine::create();
    let mut engine2 = BoundSvgEngine::create();
    let font_data = test_font_data();

    // Register font only in engine1
    register(
        &mut engine1,
        &font_data,
        "SharedAlias",
        400,
        FontStyle::Normal,
    );

    // engine1 should resolve the font
    let result1 = engine1
        .registry()
        .resolve("SharedAlias", 400, &FontStyle::Normal);
    assert!(result1.is_some(), "engine1 should have SharedAlias");

    // engine2 should NOT resolve the font
    let result2 = engine2
        .registry()
        .resolve("SharedAlias", 400, &FontStyle::Normal);
    assert!(result2.is_none(), "engine2 should not have SharedAlias");

    // Now register the same alias in engine2 — no "already registered" error
    register(
        &mut engine2,
        &font_data,
        "SharedAlias",
        400,
        FontStyle::Normal,
    );
    let result2b = engine2
        .registry()
        .resolve("SharedAlias", 400, &FontStyle::Normal);
    assert!(
        result2b.is_some(),
        "engine2 should have SharedAlias after its own registration"
    );
}

#[test]
fn compute_layout_uses_instance_registry() {
    let mut engine = BoundSvgEngine::create();
    let font_data = test_font_data();
    register(
        &mut engine,
        &font_data,
        "LayoutFont",
        400,
        FontStyle::Normal,
    );

    let input_json = r#"{
        "root": {
            "nodeId": "root",
            "nodeType": "Canvas",
            "authoredId": true,
            "style": { "width": 200, "height": 100 },
            "children": [{
                "nodeId": "text1",
                "nodeType": "Text",
                "authoredId": true,
                "style": {},
                "text": {
                    "content": "Hello",
                    "fontSizePx": 16,
                    "fontFamily": ["LayoutFont"],
                    "fontWeight": 400,
                    "fontStyle": "normal",
                    "wrap": "char"
                },
                "children": []
            }]
        },
        "fonts": []
    }"#;

    let input: layout::LayoutInput =
        serde_json::from_str(input_json).expect("should parse input JSON");
    let result = layout::compute_full_layout_with_registry(&input, engine.registry());
    assert!(result.is_ok(), "compute_layout should succeed: {result:?}");
}

#[test]
fn compute_layout_serializes_camel_case_output_shape() {
    let mut engine = BoundSvgEngine::create();
    let font_data = test_font_data();
    register(&mut engine, &font_data, "ShapeFont", 400, FontStyle::Normal);

    let input_json = r#"{
        "root": {
            "nodeId": "root",
            "nodeType": "Canvas",
            "authoredId": true,
            "style": { "width": 200, "height": 100 },
            "children": [{
                "nodeId": "text1",
                "nodeType": "Text",
                "authoredId": true,
                "style": {},
                "text": {
                    "content": "AB",
                    "fontSizePx": 16,
                    "fontFamily": ["ShapeFont"],
                    "fontWeight": 400,
                    "fontStyle": "normal",
                    "wrap": "char"
                },
                "children": []
            }]
        },
        "fonts": []
    }"#;

    let input: layout::LayoutInput =
        serde_json::from_str(input_json).expect("should parse input JSON");
    let result = layout::compute_full_layout_with_registry(&input, engine.registry())
        .expect("compute_layout should succeed");
    let json = serde_json::to_value(&result).expect("layout output should serialize");

    let root = json.as_object().expect("layout output should be an object");
    assert!(root.contains_key("measureCallCount"));
    assert!(root.contains_key("measureCacheHits"));
    assert!(!root.contains_key("measure_call_count"));
    assert!(!root.contains_key("measure_cache_hits"));

    let nodes = root
        .get("nodes")
        .and_then(Value::as_array)
        .expect("layout output should contain nodes array");
    let text_node = nodes
        .iter()
        .find(|node| node.get("nodeId") == Some(&Value::String("text1".to_string())))
        .and_then(Value::as_object)
        .expect("layout output should contain text1 node");

    assert!(text_node.contains_key("nodeId"));
    assert!(text_node.contains_key("textLayout"));
    assert!(!text_node.contains_key("node_id"));
    assert!(!text_node.contains_key("children"));

    let text_layout = text_node
        .get("textLayout")
        .and_then(Value::as_object)
        .expect("text node should contain textLayout");
    assert!(text_layout.contains_key("measuredWidth"));
    assert!(text_layout.contains_key("measuredHeight"));
    assert!(!text_layout.contains_key("measured_width"));
    assert!(!text_layout.contains_key("measured_height"));
}

#[test]
fn svg_to_png_uses_instance_registry() {
    let mut engine = BoundSvgEngine::create();
    let font_data = test_font_data();
    register(&mut engine, &font_data, "PngFont", 400, FontStyle::Normal);

    let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">
        <rect width="100" height="50" fill="white"/>
        <text x="10" y="30" font-family="PngFont" font-size="16">Test</text>
    </svg>"#;

    let (alias_map, font_arcs) = engine.registry().rasterize_font_data();
    let result = rasterize::svg_to_png(
        svg,
        &alias_map,
        &font_arcs,
        &rasterize::RasterizeOptions::default(),
    );
    assert!(result.is_ok(), "svg_to_png should succeed");
    let png_bytes = result.unwrap();
    assert!(!png_bytes.is_empty(), "PNG output should not be empty");
}

#[test]
fn svg_to_webp_uses_instance_registry() {
    let mut engine = BoundSvgEngine::create();
    let font_data = test_font_data();
    register(&mut engine, &font_data, "WebpFont", 400, FontStyle::Normal);

    let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">
        <rect width="100" height="50" fill="white"/>
        <text x="10" y="30" font-family="WebpFont" font-size="16">Test</text>
    </svg>"#;

    let (alias_map, font_arcs) = engine.registry().rasterize_font_data();
    let webp_bytes = webp_encode::svg_to_webp(
        svg,
        &alias_map,
        &font_arcs,
        &rasterize::RasterizeOptions::default(),
    )
    .expect("svg_to_webp should succeed");
    assert_eq!(&webp_bytes[0..4], b"RIFF");
    assert_eq!(&webp_bytes[12..16], b"VP8L");

    // The glyphs must actually be painted: decode and require dark pixels on
    // the white background, which only appear when the registry font resolved.
    let mut decoder = image_webp::WebPDecoder::new(std::io::Cursor::new(&webp_bytes))
        .expect("output should decode");
    let mut pixels = vec![0u8; decoder.output_buffer_size().expect("known buffer size")];
    decoder.read_image(&mut pixels).expect("decodable image");
    let dark_pixels = pixels.chunks_exact(4).filter(|px| px[0] < 128).count();
    assert!(
        dark_pixels > 0,
        "text glyphs should be rasterized into the WebP"
    );
}

#[test]
fn svgs_to_animated_gif_uses_instance_registry() {
    let mut engine = BoundSvgEngine::create();
    let font_data = test_font_data();
    register(&mut engine, &font_data, "GifFont", 400, FontStyle::Normal);

    let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30">
        <rect width="60" height="30" fill="white"/>
        <text x="4" y="20" font-family="GifFont" font-size="14">Test</text>
    </svg>"#;

    let (alias_map, font_arcs) = engine.registry().rasterize_font_data();
    let input = boundsvg::raster_anim::AnimationEncodeInput {
        frames: vec![
            boundsvg::raster_anim::AnimationFrameInput {
                svg: svg.to_string(),
                duration_ms: 100,
            },
            boundsvg::raster_anim::AnimationFrameInput {
                svg: svg.to_string(),
                duration_ms: 100,
            },
        ],
        loop_count: None,
        options: None,
    };
    let gif_bytes = gif_anim::encode_animated_gif(&input, &alias_map, &font_arcs)
        .expect("encode_animated_gif should succeed");
    assert_eq!(&gif_bytes[0..6], b"GIF89a");

    // The glyphs must actually be painted: a registry miss would leave the
    // white background alone and quantize to a single palette entry.
    let mut decoder = gif::DecodeOptions::new()
        .read_info(std::io::Cursor::new(&gif_bytes))
        .expect("decodable GIF");
    let frame = decoder
        .read_next_frame()
        .expect("readable frame")
        .expect("one frame");
    let palette = frame.palette.as_ref().expect("frame-local palette");
    assert!(
        palette.len() / 3 > 1,
        "text glyphs should add colors beyond the background"
    );
}

#[test]
fn extract_glyph_paths_uses_instance_registry() {
    let mut engine = BoundSvgEngine::create();
    let font_data = test_font_data();
    register(&mut engine, &font_data, "PathFont", 400, FontStyle::Normal);

    let entry = engine
        .registry()
        .resolve("PathFont", 400, &FontStyle::Normal)
        .expect("font should be registered");
    let glyphs = shaping::shape_text(engine.registry(), entry, "A", 24.0, 0.0);
    let positions: Vec<outline::GlyphPosition> = glyphs
        .iter()
        .map(|g| outline::GlyphPosition {
            glyph_id: g.glyph_id,
            x_advance: g.x_advance,
            x_offset: g.x_offset,
            y_offset: g.y_offset,
        })
        .collect();
    let paths = outline::extract_glyph_paths(
        engine.registry().backend(),
        &entry.data,
        24.0,
        20.0,
        0.0,
        &positions,
        &[],
    );
    assert!(!paths.is_empty(), "should produce glyph paths");
}

#[test]
fn shape_with_fallback_uses_instance_registry() {
    let mut engine = BoundSvgEngine::create();
    let noto_data = test_font_data();
    let jetbrains_data = test_jetbrains_mono_data();

    register(
        &mut engine,
        &noto_data,
        "NotoFallback",
        400,
        FontStyle::Normal,
    );
    register(
        &mut engine,
        &jetbrains_data,
        "JetBrainsFallback",
        400,
        FontStyle::Normal,
    );

    let aliases = vec!["JetBrainsFallback".to_string(), "NotoFallback".to_string()];
    let font_ctx = boundsvg::font::FontContext {
        registry: engine.registry(),
        fallback_registry: None,
        families: &aliases,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let shaped = shaping::shape_with_fallback_and_options(
        &font_ctx,
        "Hello世界",
        24.0,
        0.0,
        &shaping::ShapeOptions::default(),
    );
    assert!(
        !shaped.glyphs.is_empty(),
        "shape with fallback should produce glyphs"
    );
}

#[test]
fn shape_with_variations_uses_instance_registry() {
    let mut engine = BoundSvgEngine::create();
    let font_data = test_font_data();
    register(&mut engine, &font_data, "VariFont", 400, FontStyle::Normal);

    let entry = engine
        .registry()
        .resolve("VariFont", 400, &FontStyle::Normal)
        .expect("font should be registered");
    // shape_text works fine even if the font doesn't have wght axis — no panic
    let glyphs = shaping::shape_text(engine.registry(), entry, "テスト", 24.0, 0.0);
    assert!(!glyphs.is_empty(), "should produce glyphs");
}

/// Regression test: vertical-rl text must use internally-computed UAX#14
/// break opportunities when the TS caller does not supply them.
///
/// Before the fix, `build_uax14_break_set_vertical` returned `None` when
/// `uax14_breaks` was absent, losing all line-break rules. The text would
/// be stuffed into a single column regardless of the height constraint.
///
/// With the fix the Rust side calls `uax14_break_opportunities()` itself,
/// so column breaking respects UAX#14 even without TS-supplied offsets.
#[test]
fn vertical_layout_computes_uax14_breaks_internally() {
    let mut engine = BoundSvgEngine::create();
    let font_data = test_font_data();
    register(&mut engine, &font_data, "VertUAX14", 400, FontStyle::Normal);

    // 12 CJK characters at 24px in a 72px-tall column → should need
    // multiple columns. Each CJK char ≈ 24px vertically, so ~3 chars/col.
    // Crucially, NO `uax14Breaks` field in the JSON — the Rust fast-path
    // must compute them internally.
    let input_json = r#"{
        "root": {
            "nodeId": "root",
            "nodeType": "Canvas",
            "authoredId": true,
            "style": { "width": 400, "height": 72 },
            "children": [{
                "nodeId": "vtext1",
                "nodeType": "Text",
                "authoredId": true,
                "style": {},
                "text": {
                    "content": "東京都渋谷区神宮前一丁目",
                    "fontSizePx": 24,
                    "fontFamily": ["VertUAX14"],
                    "fontWeight": 400,
                    "fontStyle": "normal",
                    "wrap": "char",
                    "writingMode": "vertical-rl"
                },
                "children": []
            }]
        },
        "fonts": []
    }"#;

    let input: layout::LayoutInput =
        serde_json::from_str(input_json).expect("should parse input JSON");
    let result = layout::compute_full_layout_with_registry(&input, engine.registry())
        .expect("compute_layout should succeed");

    // Find the text node output
    let text_node = result
        .nodes
        .iter()
        .find(|n| n.node_id == "vtext1")
        .expect("should contain vtext1 node");

    let tl = text_node
        .text_layout
        .as_ref()
        .expect("text node should have textLayout");

    let lines = tl
        .lines
        .as_ref()
        .expect("Rust Text Engine should produce lines (fast-path active)");

    // With UAX#14 breaks computed internally, 12 CJK chars in a 72px column
    // should split into multiple columns (lines in vertical mode).
    assert!(
        lines.len() > 1,
        "vertical text should be split into multiple columns, got {} column(s). \
         If only 1 column, UAX#14 break computation may have regressed.",
        lines.len(),
    );

    // Verify all characters are accounted for
    let total_text: String = lines.iter().map(|l| l.text.as_str()).collect();
    assert_eq!(
        total_text, "東京都渋谷区神宮前一丁目",
        "all characters should be present across columns",
    );
}

// ---------------------------------------------------------------------------
// whiteSpace fast-path regression tests
// ---------------------------------------------------------------------------

/// Plain text with whiteSpace="nowrap" must produce a single line even in
/// the shaped-paragraph fast path (layout.rs).
#[test]
fn fast_path_nowrap_produces_single_line() {
    let mut engine = BoundSvgEngine::create();
    let font_data = test_font_data();
    register(&mut engine, &font_data, "TestFont", 400, FontStyle::Normal);

    let input_json = r#"{
        "root": {
            "nodeId": "root",
            "nodeType": "Canvas",
            "authoredId": true,
            "style": { "width": 200, "height": 100 },
            "children": [{
                "nodeId": "txt",
                "nodeType": "Text",
                "authoredId": true,
                "style": {},
                "text": {
                    "content": "AAAA BBBB CCCC DDDD EEEE",
                    "fontSizePx": 16,
                    "fontFamily": ["TestFont"],
                    "fontWeight": 400,
                    "fontStyle": "normal",
                    "wrap": "char",
                    "whiteSpace": "nowrap"
                },
                "children": []
            }]
        },
        "fonts": []
    }"#;

    let input: layout::LayoutInput = serde_json::from_str(input_json).expect("parse");
    let result = layout::compute_full_layout_with_registry(&input, engine.registry())
        .expect("layout should succeed");
    let json = serde_json::to_value(&result).expect("serialize");
    let nodes = json["nodes"].as_array().expect("nodes array");
    let txt = nodes
        .iter()
        .find(|n| n["nodeId"] == "txt")
        .expect("txt node");
    let lines = txt["textLayout"]["lines"].as_array().expect("lines array");
    assert_eq!(
        lines.len(),
        1,
        "nowrap must produce exactly 1 line via fast path"
    );
}

/// Plain text with whiteSpace="pre-wrap" must break at \n characters in
/// the shaped-paragraph fast path.
#[test]
fn fast_path_pre_wrap_breaks_at_newline() {
    let mut engine = BoundSvgEngine::create();
    let font_data = test_font_data();
    register(&mut engine, &font_data, "TestFont", 400, FontStyle::Normal);

    let input_json = r#"{
        "root": {
            "nodeId": "root",
            "nodeType": "Canvas",
            "authoredId": true,
            "style": { "width": 800, "height": 200 },
            "children": [{
                "nodeId": "txt",
                "nodeType": "Text",
                "authoredId": true,
                "style": {},
                "text": {
                    "content": "line1\nline2\nline3",
                    "fontSizePx": 16,
                    "fontFamily": ["TestFont"],
                    "fontWeight": 400,
                    "fontStyle": "normal",
                    "wrap": "char",
                    "whiteSpace": "pre-wrap"
                },
                "children": []
            }]
        },
        "fonts": []
    }"#;

    let input: layout::LayoutInput = serde_json::from_str(input_json).expect("parse");
    let result = layout::compute_full_layout_with_registry(&input, engine.registry())
        .expect("layout should succeed");
    let json = serde_json::to_value(&result).expect("serialize");
    let nodes = json["nodes"].as_array().expect("nodes array");
    let txt = nodes
        .iter()
        .find(|n| n["nodeId"] == "txt")
        .expect("txt node");
    let lines = txt["textLayout"]["lines"].as_array().expect("lines array");
    assert_eq!(
        lines.len(),
        3,
        "pre-wrap must produce 3 lines for 2 newlines"
    );
    assert_eq!(lines[0]["text"], "line1");
    assert_eq!(lines[1]["text"], "line2");
    assert_eq!(lines[2]["text"], "line3");
}

/// Default whiteSpace (unspecified = Normal) collapses runs of whitespace.
#[test]
fn fast_path_default_normal_collapses_whitespace() {
    let mut engine = BoundSvgEngine::create();
    let font_data = test_font_data();
    register(&mut engine, &font_data, "TestFont", 400, FontStyle::Normal);

    let input_json = r#"{
        "root": {
            "nodeId": "root",
            "nodeType": "Canvas",
            "authoredId": true,
            "style": { "width": 800, "height": 100 },
            "children": [{
                "nodeId": "txt",
                "nodeType": "Text",
                "authoredId": true,
                "style": { "width": 800 },
                "text": {
                    "content": "a   b\nc",
                    "fontSizePx": 16,
                    "fontFamily": ["TestFont"],
                    "fontWeight": 400,
                    "fontStyle": "normal",
                    "wrap": "char"
                },
                "children": []
            }]
        },
        "fonts": []
    }"#;

    let input: layout::LayoutInput = serde_json::from_str(input_json).expect("parse");
    let result = layout::compute_full_layout_with_registry(&input, engine.registry())
        .expect("layout should succeed");
    let json = serde_json::to_value(&result).expect("serialize");
    let nodes = json["nodes"].as_array().expect("nodes array");
    let txt = nodes
        .iter()
        .find(|n| n["nodeId"] == "txt")
        .expect("txt node");
    let lines = txt["textLayout"]["lines"].as_array().expect("lines array");
    // "a   b\nc" collapsed to "a b c" → single line
    let line_texts: Vec<&str> = lines.iter().filter_map(|l| l["text"].as_str()).collect();
    assert_eq!(
        line_texts,
        vec!["a b c"],
        "whitespace should be collapsed into single line, got: {line_texts:?}"
    );
}
