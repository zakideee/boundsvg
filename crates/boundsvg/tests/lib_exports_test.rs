// Integration tests always build with `cfg(test)`; declaring it lets clippy's
// `allow-*-in-tests` config apply to helper functions in this file.
#![cfg(test)]

use boundsvg::{BoundSvgEngine, get_font_metrics, grapheme_split, uax14_line_breaks};

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

#[test]
fn grapheme_split_returns_json_array() {
    let json = grapheme_split("A🇯🇵あ").expect("grapheme split should succeed");
    let graphemes: Vec<String> = serde_json::from_str(&json).expect("valid json");
    assert_eq!(graphemes.concat(), "A🇯🇵あ");
    assert!(
        graphemes == vec!["A", "🇯🇵", "あ"] || graphemes == vec!["A", "🇯", "🇵", "あ"],
        "unexpected grapheme split result: {graphemes:?}"
    );
}

#[test]
fn uax14_line_breaks_returns_expected_offsets() {
    let json = uax14_line_breaks("Hello World").expect("line break analysis should succeed");
    let breaks: Vec<usize> = serde_json::from_str(&json).expect("valid json");
    assert!(
        breaks.contains(&6),
        "expected break after space: {breaks:?}"
    );
}

#[test]
fn get_font_metrics_returns_numeric_fields() {
    let metrics_json = get_font_metrics(&test_font_data()).expect("font metrics should be parsed");
    let metrics: serde_json::Value = serde_json::from_str(&metrics_json).expect("valid json");
    assert!(metrics["unitsPerEm"].as_i64().unwrap_or_default() > 0);
    assert!(metrics["ascender"].as_i64().unwrap_or_default() > 0);
    assert!(metrics["descender"].as_i64().unwrap_or_default() < 0);
}

#[test]
fn register_font_then_shape_text_registered_succeeds() {
    let mut engine = BoundSvgEngine::create();
    engine
        .register_font(&test_font_data(), "integration-font", 400, "normal")
        .expect("register should succeed");

    let json = engine
        .shape_text_registered("integration-font", 400, "normal", "テスト", 24.0, 0.0)
        .expect("shape should succeed");
    let glyphs: Vec<serde_json::Value> = serde_json::from_str(&json).expect("valid json");
    assert!(!glyphs.is_empty(), "glyph list should not be empty");
}

#[test]
fn shape_text_registered_with_fallback_uses_secondary_font() {
    let mut engine = BoundSvgEngine::create();
    engine
        .register_font(
            &test_jetbrains_mono_data(),
            "integration-jet",
            400,
            "normal",
        )
        .expect("Jet register should succeed");
    engine
        .register_font(&test_font_data(), "integration-noto", 400, "normal")
        .expect("Noto register should succeed");

    let aliases_json =
        serde_json::to_string(&vec!["integration-jet", "integration-noto"]).expect("aliases json");
    let json = engine
        .shape_text_registered_with_fallback(&aliases_json, 400, "normal", "A日", 24.0, 0.0)
        .expect("shape with fallback should succeed");
    let glyphs: Vec<serde_json::Value> = serde_json::from_str(&json).expect("valid json");
    assert!(
        glyphs.len() >= 2,
        "expected at least 2 glyphs, got {glyphs:?}"
    );

    let cjk = glyphs
        .iter()
        .find(|g| g["cluster"].as_u64() == Some(1))
        .expect("expected glyph with cluster=1 for second char");
    assert_ne!(
        cjk["glyphId"].as_u64().unwrap_or_default(),
        0,
        "fallback glyph should not be .notdef"
    );
}

#[test]
fn extract_glyph_paths_with_fallback_returns_paths_for_mixed_text() {
    let mut engine = BoundSvgEngine::create();
    engine
        .register_font(
            &test_jetbrains_mono_data(),
            "integration-jet-path",
            400,
            "normal",
        )
        .expect("Jet register should succeed");
    engine
        .register_font(&test_font_data(), "integration-noto-path", 400, "normal")
        .expect("Noto register should succeed");

    let aliases_json =
        serde_json::to_string(&vec!["integration-jet-path", "integration-noto-path"])
            .expect("aliases json");
    let json = engine
        .extract_glyph_paths_with_fallback(
            &aliases_json,
            400,
            "normal",
            "A日",
            24.0,
            32.0,
            0.0,
            0.0,
        )
        .expect("path extraction should succeed");

    let paths: Vec<serde_json::Value> = serde_json::from_str(&json).expect("valid json");
    assert!(!paths.is_empty(), "glyph paths should not be empty");
}

#[test]
fn layout_transition_has_one_production_operation_and_no_probe_export() {
    let source = include_str!("../src/lib.rs");
    assert_eq!(
        source.matches("pub fn compile_layout_transition(").count(),
        1,
        "the reviewed compiler must have one authoritative WASM operation"
    );
    assert!(!source.contains("probe_layout_transition"));
    assert!(!source.contains("probeLayoutTransition"));
}
