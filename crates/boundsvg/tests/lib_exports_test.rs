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

#[test]
fn all_text_layout_exports_use_the_one_total_wasm_family_owner() {
    const EXPECTED_EXPORTS: [&str; 6] = [
        "layout_text_flow",
        "layout_text_flow_with_exclusions",
        "measure_text_block",
        "shrinkwrap_text",
        "shrinkwrap_flow",
        "measure_intrinsic_inline_size",
    ];

    let source = include_str!("../src/lib.rs");
    let mut discovered = source
        .lines()
        .filter_map(|line| line.trim().strip_prefix("pub fn "))
        .filter_map(|tail| tail.split('(').next())
        .filter(|name| {
            name.contains("text_flow")
                || name.contains("measure_text")
                || name.contains("shrinkwrap")
                || name.contains("intrinsic_inline_size")
        })
        .collect::<Vec<_>>();
    discovered.sort_unstable();
    let mut expected = EXPECTED_EXPORTS.to_vec();
    expected.sort_unstable();
    assert_eq!(
        discovered, expected,
        "update the family registry and raw fixture for a new route"
    );

    for export in EXPECTED_EXPORTS {
        let signature = format!("pub fn {export}(");
        let start = source.find(&signature).expect("text-layout export");
        let after_signature = &source[start + signature.len()..];
        let end = after_signature
            .find("\n    pub fn ")
            .unwrap_or(after_signature.len());
        let body = &after_signature[..end];
        assert_eq!(
            body.matches("run_text_layout_wasm_operation(").count(),
            1,
            "{export} must delegate exactly once to the family owner"
        );
        for forbidden in [
            "catch_unwind_to_js",
            "JsValue::from_str",
            "render_error_envelope(",
            "format!(",
        ] {
            assert!(
                !body.contains(forbidden),
                "{export} retains route-local {forbidden}"
            );
        }
    }
}
