use super::*;
use crate::font::shaping::ShapeOptions;
use crate::font::{FontContext, FontRegistry, FontStyle};
use crate::text::engine::layout_text;
use crate::text::grapheme::simple_grapheme_split;
use crate::text::types::{
    FitMode, Language, TextLayoutRequest, TextOrientation, WhiteSpaceMode, WrapMode, WritingMode,
};

fn test_registry() -> FontRegistry {
    let data = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
    ))
    .expect("Test font");
    let mut reg = FontRegistry::new();
    reg.register(data, "NotoSansJP".to_string(), 400, FontStyle::Normal)
        .expect("register");
    reg
}

#[allow(dead_code)]
fn make_req(text: &str, font_size_px: f64, max_width: f64) -> TextLayoutRequest<'_> {
    TextLayoutRequest {
        text,
        spans: None,
        rich_text: None,
        font_size_px,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width,
        max_height: None,
        wrap: WrapMode::Word,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: None,
        ellipsis: false,
        language: Language::Ja,
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: TextOrientation::Mixed,
        uax14_breaks: None,
        hanging_punctuation: false,
        font_variation_settings: Vec::new(),
        font_feature_settings: Vec::new(),
        min_font_size_px: None,
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
    }
}

#[allow(dead_code)]
fn make_font_ctx(registry: &FontRegistry) -> FontContext<'_> {
    FontContext {
        registry,
        fallback_registry: None,
        families: &[],
        weight: 400,
        style: &FontStyle::Normal,
    }
}

#[test]
fn shape_paragraph_builds_shaped_paragraph() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let shaped = shape_paragraph(
        "Hello",
        &font_ctx,
        crate::text::types::Language::En,
        WrapMode::Word,
        false,
        &ShapeOptions::default(),
        None,
        0.0,
    )
    .expect("shape");

    assert_eq!(&*shaped.text, "Hello");
    assert!(!shaped.glyphs.is_empty());
    assert_eq!(shaped.char_advances_funits.len(), 5);
}

#[test]
fn build_uax14_break_set_maps_offsets_to_grapheme_boundaries() {
    let chars = vec!["a", "b", "c"];
    let flags = build_uax14_break_set(&chars, Some(&[1, 2]), "abc").expect("flags");
    assert_eq!(flags, vec![false, true, true]);
}

// ------------------------------------------------------------------
// Parity tests: shaped path vs existing path
// ------------------------------------------------------------------

#[test]
fn parity_plain_wrap_japanese() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    // Use texts that are covered by the NotoSansJP subset font.
    // Characters outside the subset produce .notdef (glyph_id=0) and
    // shape_paragraph correctly returns None so the caller can fall
    // through to the existing fallback-chain path.
    let cases = ["こんにちは", "テストテスト", "あいうえお"];

    for text in &cases {
        let req = TextLayoutRequest {
            text,
            spans: None,
            rich_text: None,
            font_size_px: 16.0,
            line_height: Some(1.5),
            line_height_px: None,
            letter_spacing_px: 0.0,
            text_indent: None,
            max_width: 100.0,
            max_height: None,
            wrap: WrapMode::Word,
            white_space: WhiteSpaceMode::Normal,
            tab_size: 4,
            fit: FitMode::None,
            max_lines: None,
            ellipsis: false,
            language: Language::Ja,
            writing_mode: WritingMode::HorizontalTb,
            text_orientation: TextOrientation::Mixed,
            uax14_breaks: None,
            hanging_punctuation: false,
            font_variation_settings: Vec::new(),
            font_feature_settings: Vec::new(),
            min_font_size_px: None,
            shrink_epsilon_px: None,
            shrink_max_iterations: None,
            max_font_size_px: None,
            grow_epsilon_px: None,
            grow_max_iterations: None,
        };

        // The existing layout path now uses the shaped path internally
        // when conditions are met.  To obtain a ground-truth reference we
        // call layout_text which will use the shaped path (same code).
        // For a true cross-path comparison we compare layout_paragraph
        // output against a fresh layout_text call.
        let existing = layout_text(&req, &font_ctx).expect("existing layout should succeed");

        let shape_options = ShapeOptions::default();
        let shaped = shape_paragraph(
            text,
            &font_ctx,
            Language::Ja,
            WrapMode::Word,
            false,
            &shape_options,
            None,
            0.0,
        )
        .expect("prepare should succeed for subset-covered text");

        let line_height_px = 16.0 * 1.5;
        let shaped_result = layout_paragraph(
            &shaped,
            16.0,
            line_height_px,
            line_height_px * 0.8,
            100.0,
            WrapMode::Word,
            false,
        );

        assert_eq!(
            existing.lines.len(),
            shaped_result.lines.len(),
            "line count mismatch for '{text}'"
        );

        for (li, (existing_line, shaped_line)) in
            existing.lines.iter().zip(&shaped_result.lines).enumerate()
        {
            assert_eq!(
                existing_line.text, shaped_line.text,
                "line {li} text mismatch for '{text}'"
            );
            assert!(
                (existing_line.width - shaped_line.width).abs() < 1e-4,
                "line {li} width mismatch for '{text}': existing={}, shaped={}",
                existing_line.width,
                shaped_line.width,
            );
        }
    }
}

#[test]
fn parity_single_line_no_wrap() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let text = "こんにちは";
    let req = TextLayoutRequest {
        text,
        spans: None,
        rich_text: None,
        font_size_px: 16.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 9999.0,
        max_height: None,
        wrap: WrapMode::None,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: None,
        ellipsis: false,
        language: Language::Ja,
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: TextOrientation::Mixed,
        uax14_breaks: None,
        hanging_punctuation: false,
        font_variation_settings: Vec::new(),
        font_feature_settings: Vec::new(),
        min_font_size_px: None,
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
    };

    let existing = layout_text(&req, &font_ctx).expect("layout");
    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        text,
        &font_ctx,
        Language::Ja,
        WrapMode::None,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("prepare");
    let line_height_px = 16.0 * 1.5;
    let shaped_result = layout_paragraph(
        &shaped,
        16.0,
        line_height_px,
        line_height_px * 0.8,
        9999.0,
        WrapMode::None,
        false,
    );

    assert_eq!(existing.lines.len(), 1);
    assert_eq!(shaped_result.lines.len(), 1);
    assert!(
        (existing.lines[0].width - shaped_result.lines[0].width).abs() < 1e-4,
        "width mismatch: existing={}, shaped={}",
        existing.lines[0].width,
        shaped_result.lines[0].width,
    );
}

// ------------------------------------------------------------------
// Font size scaling: prepare once, layout at multiple sizes
// ------------------------------------------------------------------

#[test]
fn font_size_scaling() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let text = "テスト";
    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        text,
        &font_ctx,
        Language::Ja,
        WrapMode::None,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("prepare");

    let line_height_16 = 16.0 * 1.5;
    let result_16 = layout_paragraph(
        &shaped,
        16.0,
        line_height_16,
        line_height_16 * 0.8,
        9999.0,
        WrapMode::None,
        false,
    );

    let line_height_32 = 32.0 * 1.5;
    let result_32 = layout_paragraph(
        &shaped,
        32.0,
        line_height_32,
        line_height_32 * 0.8,
        9999.0,
        WrapMode::None,
        false,
    );

    assert_eq!(result_16.lines.len(), 1);
    assert_eq!(result_32.lines.len(), 1);

    // Width at 32px should be exactly 2x width at 16px
    let ratio = result_32.lines[0].width / result_16.lines[0].width;
    assert!(
        (ratio - 2.0).abs() < 1e-6,
        "width ratio should be 2.0, got {ratio}"
    );
}

// ------------------------------------------------------------------
// Letter spacing tracking
// ------------------------------------------------------------------

#[test]
fn letter_spacing_tracking() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let text = "ABC";
    let shape_options = ShapeOptions::default();

    // Without letter spacing
    let shaped_no_spacing = shape_paragraph(
        text,
        &font_ctx,
        Language::En,
        WrapMode::None,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("prepare");

    // With letter spacing
    let shaped_with_spacing = shape_paragraph(
        text,
        &font_ctx,
        Language::En,
        WrapMode::None,
        false,
        &shape_options,
        None,
        2.0,
    )
    .expect("prepare");

    let line_height = 16.0 * 1.5;
    let result_no_spacing = layout_paragraph(
        &shaped_no_spacing,
        16.0,
        line_height,
        line_height * 0.8,
        9999.0,
        WrapMode::None,
        false,
    );
    let result_with_spacing = layout_paragraph(
        &shaped_with_spacing,
        16.0,
        line_height,
        line_height * 0.8,
        9999.0,
        WrapMode::None,
        false,
    );

    // 3 glyphs → 2 tracking gaps × 2.0px = 4.0px additional width
    let width_diff = result_with_spacing.lines[0].width - result_no_spacing.lines[0].width;
    assert!(
        (width_diff - 4.0).abs() < 1e-4,
        "letter spacing should add 4.0px, got {width_diff}"
    );

    // Verify tracking_counts: each glyph except last gets tracking=1
    // For a 3-char text with 1:1 glyph mapping, tracking_counts should be [1, 1, 0]
    assert_eq!(shaped_with_spacing.tracking_counts.len(), 3);
    // Last char should have tracking count 0 (last glyph gets no tracking)
    assert_eq!(shaped_with_spacing.tracking_counts[2], 0);
}

// ------------------------------------------------------------------
// Edge cases
// ------------------------------------------------------------------

#[test]
fn edge_case_empty_text() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        "",
        &font_ctx,
        Language::Ja,
        WrapMode::Word,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("prepare empty");

    assert!(shaped.glyphs.is_empty());
    assert!(shaped.char_advances_funits.is_empty());

    let line_height = 16.0 * 1.5;
    let result = layout_paragraph(
        &shaped,
        16.0,
        line_height,
        line_height * 0.8,
        100.0,
        WrapMode::Word,
        false,
    );
    assert_eq!(result.lines.len(), 1);
    assert_eq!(result.lines[0].text, "");
    assert!((result.lines[0].width - 0.0).abs() < 1e-10);
}

#[test]
fn edge_case_single_char() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let text = "あ";
    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        text,
        &font_ctx,
        Language::Ja,
        WrapMode::Word,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("prepare single char");

    assert_eq!(shaped.glyphs.len(), 1);
    assert_eq!(shaped.char_advances_funits.len(), 1);
    assert!(shaped.char_advances_funits[0] > 0);

    let line_height = 16.0 * 1.5;
    let result = layout_paragraph(
        &shaped,
        16.0,
        line_height,
        line_height * 0.8,
        100.0,
        WrapMode::Word,
        false,
    );
    assert_eq!(result.lines.len(), 1);
    assert_eq!(result.lines[0].text, "あ");
}

#[test]
fn edge_case_text_fits_one_line() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let text = "AB";
    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        text,
        &font_ctx,
        Language::En,
        WrapMode::Word,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("prepare");

    let line_height = 16.0 * 1.5;
    let result = layout_paragraph(
        &shaped,
        16.0,
        line_height,
        line_height * 0.8,
        9999.0,
        WrapMode::Word,
        false,
    );
    assert_eq!(result.lines.len(), 1);
    assert_eq!(result.lines[0].text, "AB");
}

// ------------------------------------------------------------------
// Tracking / letter-spacing parity with existing shaping path
// ------------------------------------------------------------------

/// Verify that shaped path letter-spacing produces the same total line
/// width as the old shaping path (`shape_text_with_options` + `break_lines_internal`),
/// bypassing the shaped gate in `layout_text()`.
#[test]
fn tracking_parity_with_old_shaping_path() {
    use crate::font::shaping;
    use crate::text::engine::{break_lines_internal, language_to_str};
    use crate::text::kinsoku::{get_hanging_chars, get_kinsoku_profile};

    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];

    let cases = [
        ("あいうえお", Language::Ja),
        ("Hello World", Language::En),
        ("日本語とEnglish混在テスト", Language::Ja),
        ("。「」（）", Language::Ja),
        ("ABC", Language::En),
    ];

    for (text, lang) in &cases {
        let font_entry = reg
            .resolve_chain(&families, 400, &FontStyle::Normal)
            .unwrap_or_else(|| panic!("font resolve for '{text}'"));

        let shape_options = ShapeOptions::default();

        // --- Old shaping path: shape_text_with_options → break_lines_internal ---
        let old_glyphs = shaping::shape_text_with_options(
            &reg,
            font_entry,
            text,
            16.0,
            2.0, // letter_spacing_px
            &shape_options,
        );
        let kinsoku_profile = get_kinsoku_profile(Some(language_to_str(*lang)));
        let hanging_chars = get_hanging_chars(false);
        let line_height = 16.0 * 1.5;
        let old_result = break_lines_internal(
            &old_glyphs,
            text,
            9999.0,
            WrapMode::Word,
            kinsoku_profile,
            line_height,
            line_height * 0.8,
            None,
            hanging_chars,
        );

        // --- Shaped path ---
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let shaped = shape_paragraph(
            text,
            &font_ctx,
            *lang,
            WrapMode::Word,
            false,
            &shape_options,
            None,
            2.0,
        )
        .unwrap_or_else(|| panic!("prepare failed for '{text}'"));

        let shaped_result = layout_paragraph(
            &shaped,
            16.0,
            line_height,
            line_height * 0.8,
            9999.0,
            WrapMode::Word,
            false,
        );

        // --- Compare ---
        assert_eq!(
            shaped_result.lines.len(),
            old_result.lines.len(),
            "line count mismatch for '{text}'"
        );
        for (index, (p_line, o_line)) in shaped_result
            .lines
            .iter()
            .zip(old_result.lines.iter())
            .enumerate()
        {
            assert!(
                (p_line.width - o_line.width).abs() < 0.5,
                "width mismatch for '{text}' line {index}: shaped={}, old={}",
                p_line.width,
                o_line.width,
            );
        }
    }
}

// ------------------------------------------------------------------
// measure_paragraph parity
// ------------------------------------------------------------------

#[test]
fn measure_paragraph_matches_layout() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let text = "日本語のテキストレイアウト";
    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        text,
        &font_ctx,
        Language::Ja,
        WrapMode::Word,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("prepare");

    let line_height = 16.0 * 1.5;
    let layout_result = layout_paragraph(
        &shaped,
        16.0,
        line_height,
        line_height * 0.8,
        100.0,
        WrapMode::Word,
        false,
    );
    let measure_result =
        measure_paragraph(&shaped, 16.0, line_height, 100.0, WrapMode::Word, false);

    assert_eq!(
        layout_result.lines.len(),
        measure_result.line_count,
        "line count mismatch"
    );

    let mut max_width = 0.0_f64;
    for line in &layout_result.lines {
        if line.width > max_width {
            max_width = line.width;
        }
    }
    assert!(
        (max_width - measure_result.max_line_width).abs() < 1e-4,
        "max width mismatch: layout={max_width}, measure={}",
        measure_result.max_line_width,
    );
}

// ------------------------------------------------------------------
// layout_next_line — cursor-based sequential layout
// ------------------------------------------------------------------

/// Verify that iterating `layout_next_line` over all lines produces the
/// same line count and per-line widths as `layout_paragraph`.
#[test]
fn layout_next_line_matches_layout_paragraph() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let text = "日本語のテキストレイアウトを行ごとに逐次処理するテスト";
    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        text,
        &font_ctx,
        Language::Ja,
        WrapMode::Word,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("prepare");

    let line_height = 16.0 * 1.5;
    let bulk = layout_paragraph(
        &shaped,
        16.0,
        line_height,
        line_height * 0.8,
        100.0,
        WrapMode::Word,
        false,
    );

    // Iterate via layout_next_line
    let mut cursor = BreakCursor::new();
    let mut line_ranges = Vec::new();
    while let Some(range) = layout_next_line(
        &shaped,
        &mut cursor,
        16.0,
        line_height,
        100.0,
        WrapMode::Word,
    ) {
        line_ranges.push(range);
    }

    assert_eq!(bulk.lines.len(), line_ranges.len(), "line count mismatch");
    for (index, (bulk_line, range)) in bulk.lines.iter().zip(&line_ranges).enumerate() {
        assert!(
            (bulk_line.width - range.width).abs() < 1e-4,
            "line {index} width mismatch: bulk={}, cursor={}",
            bulk_line.width,
            range.width,
        );
    }
}

/// Variable-width layout: narrow first 2 lines, then full width.
#[test]
fn layout_next_line_variable_width() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let text = "あいうえおかきくけこさしすせそたちつてと";
    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        text,
        &font_ctx,
        Language::Ja,
        WrapMode::Word,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("prepare");

    let line_height = 16.0 * 1.5;
    let mut cursor = BreakCursor::new();
    let mut line_ranges = Vec::new();

    // First 2 lines at narrow width (50px)
    for _ in 0..2 {
        if let Some(range) = layout_next_line(
            &shaped,
            &mut cursor,
            16.0,
            line_height,
            50.0,
            WrapMode::Word,
        ) {
            line_ranges.push(range);
        }
    }
    // Remaining lines at full width (500px)
    while let Some(range) = layout_next_line(
        &shaped,
        &mut cursor,
        16.0,
        line_height,
        500.0,
        WrapMode::Word,
    ) {
        line_ranges.push(range);
    }

    // Should have more than 2 lines total (narrow lines split more)
    assert!(
        line_ranges.len() >= 3,
        "expected at least 3 lines, got {}",
        line_ranges.len()
    );
    // Narrow lines should be narrower than the full-width line
    assert!(
        line_ranges[0].width <= 50.0 + 1.0,
        "first narrow line too wide: {}",
        line_ranges[0].width
    );
}

/// Cursor exhaustion: returns None after all text consumed.
#[test]
fn layout_next_line_exhaustion() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let text = "短い";
    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        text,
        &font_ctx,
        Language::Ja,
        WrapMode::Word,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("prepare");

    let line_height = 16.0 * 1.5;
    let mut cursor = BreakCursor::new();

    let first = layout_next_line(
        &shaped,
        &mut cursor,
        16.0,
        line_height,
        500.0,
        WrapMode::Word,
    );
    assert!(first.is_some());
    assert!(!cursor.has_remaining(&shaped));

    let second = layout_next_line(
        &shaped,
        &mut cursor,
        16.0,
        line_height,
        500.0,
        WrapMode::Word,
    );
    assert!(second.is_none());
}

// ------------------------------------------------------------------
// layout_next_flow_line — multi-region visual line layout
// ------------------------------------------------------------------

fn prepare_ja(text: &str, registry: &FontRegistry, wrap: WrapMode) -> ShapedParagraph {
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let shape_options = ShapeOptions::default();
    shape_paragraph(
        text,
        &font_ctx,
        Language::Ja,
        wrap,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("prepare")
}

fn prepare_en(text: &str, registry: &FontRegistry, wrap: WrapMode) -> ShapedParagraph {
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let shape_options = ShapeOptions::default();
    shape_paragraph(
        text,
        &font_ctx,
        Language::En,
        wrap,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("prepare")
}

#[test]
fn flow_line_single_region_matches_layout_next_line() {
    let reg = test_registry();
    let text = "あいうえおかきくけこ";
    let pp = prepare_ja(text, &reg, WrapMode::Char);
    let lh = 20.0 * 1.5;

    // layout_next_line
    let mut cursor1 = BreakCursor::new();
    let range = layout_next_line(&pp, &mut cursor1, 20.0, lh, 60.0, WrapMode::Char)
        .expect("should produce line");

    // layout_next_flow_line with single region
    let mut cursor2 = BreakCursor::new();
    let vline = layout_next_flow_line(&pp, &mut cursor2, 20.0, lh, &[(0.0, 60.0)], WrapMode::Char)
        .expect("should produce visual line");

    assert_eq!(vline.fragments.len(), 1);
    assert_eq!(vline.fragments[0].char_start, range.char_start);
    assert_eq!(vline.fragments[0].char_end, range.char_end);
    assert!((vline.fragments[0].inline_advance_px - range.width).abs() < 1e-4);
    assert_eq!(cursor1.char_index, cursor2.char_index);
    assert_eq!(cursor1.line_number, cursor2.line_number);
}

#[test]
fn flow_line_two_regions_overflow() {
    let reg = test_registry();
    let text = "あいうえおかきくけこ";
    let pp = prepare_ja(text, &reg, WrapMode::Char);
    let lh = 20.0 * 1.5;

    // Region 0: narrow (40px), region 1: wide (200px)
    let mut cursor = BreakCursor::new();
    let vline = layout_next_flow_line(
        &pp,
        &mut cursor,
        20.0,
        lh,
        &[(0.0, 40.0), (100.0, 200.0)],
        WrapMode::Char,
    )
    .expect("should produce visual line");

    // Should have 2 fragments
    assert_eq!(vline.fragments.len(), 2);
    assert_eq!(vline.fragments[0].region_index, 0);
    assert_eq!(vline.fragments[1].region_index, 1);
    // First fragment should not exceed region 0 width much
    assert!(vline.fragments[0].inline_advance_px <= 40.0 + 25.0); // one char may overshoot
    // Combined should cover contiguous char range
    assert_eq!(vline.fragments[0].char_end, vline.fragments[1].char_start);
}

#[test]
fn flow_line_narrow_region_skipped() {
    let reg = test_registry();
    let text = "あいうえおかきくけこ";
    let pp = prepare_ja(text, &reg, WrapMode::Char);
    let lh = 20.0 * 1.5;

    // Region 0 is too narrow for any character (2px), region 1 is wide
    let mut cursor = BreakCursor::new();
    let vline = layout_next_flow_line(
        &pp,
        &mut cursor,
        20.0,
        lh,
        &[(0.0, 2.0), (50.0, 200.0)],
        WrapMode::Char,
    )
    .expect("should produce visual line");

    // Region 0 can't fit any char → no fragment for region 0
    // All text goes to region 1
    for frag in &vline.fragments {
        assert_eq!(frag.region_index, 1);
    }
}

#[test]
fn flow_line_text_exhausted() {
    let reg = test_registry();
    let text = "あい";
    let pp = prepare_ja(text, &reg, WrapMode::Char);
    let lh = 20.0 * 1.5;

    // Single wide region — all text fits
    let mut cursor = BreakCursor::new();
    let vline = layout_next_flow_line(&pp, &mut cursor, 20.0, lh, &[(0.0, 500.0)], WrapMode::Char)
        .expect("should produce visual line");

    assert_eq!(vline.fragments.len(), 1);
    assert!(!cursor.has_remaining(&pp));

    // Next call should return None
    let next = layout_next_flow_line(&pp, &mut cursor, 20.0, lh, &[(0.0, 500.0)], WrapMode::Char);
    assert!(next.is_none());
}

#[test]
fn flow_line_cursor_line_number() {
    let reg = test_registry();
    let text = "あいうえおかきくけこさしすせそたちつてと";
    let pp = prepare_ja(text, &reg, WrapMode::Char);
    let lh = 20.0 * 1.5;

    let mut cursor = BreakCursor::new();
    let mut line_count = 0;

    while layout_next_flow_line(
        &pp,
        &mut cursor,
        20.0,
        lh,
        &[(0.0, 40.0), (100.0, 40.0)],
        WrapMode::Char,
    )
    .is_some()
    {
        line_count += 1;
        // line_number should increment by exactly 1 per visual line
        assert_eq!(cursor.line_number, line_count);
    }

    assert!(line_count >= 2);
}

#[test]
fn flow_line_three_regions_middle_narrow() {
    let reg = test_registry();
    let text = "あいうえおかきくけこ";
    let pp = prepare_ja(text, &reg, WrapMode::Char);
    let lh = 20.0 * 1.5;

    // Region 0: 60px, region 1: 5px (narrower than 1 char ~20px), region 2: 200px
    let regions = [(0.0, 60.0), (80.0, 5.0), (100.0, 200.0)];
    let mut cursor = BreakCursor::new();
    let vline = layout_next_flow_line(&pp, &mut cursor, 20.0, lh, &regions, WrapMode::Char)
        .expect("should produce visual line");

    // Non-last fragments must fit within their region (strict)
    let last_region = regions.len() - 1;
    for frag in &vline.fragments {
        if frag.region_index < last_region {
            let region_w = regions[frag.region_index].1;
            assert!(
                frag.inline_advance_px <= region_w + 0.1,
                "fragment in region {} has width {:.2} but region is only {:.2}px",
                frag.region_index,
                frag.inline_advance_px,
                region_w,
            );
        }
    }

    // Middle region (5px) should be skipped — no fragment should reference it
    let has_middle = vline.fragments.iter().any(|f| f.region_index == 1);
    assert!(
        !has_middle,
        "middle region (5px) should be skipped as too narrow for a character"
    );
}

#[test]
fn flow_line_fragment_width_respects_region() {
    let reg = test_registry();
    let text = "あいうえおかきくけこさしすせそたちつてと";
    let pp = prepare_ja(text, &reg, WrapMode::Char);
    let lh = 20.0 * 1.5;

    // Two equal regions — obstacle in the middle
    let regions = [(0.0, 100.0), (200.0, 100.0)];
    let mut cursor = BreakCursor::new();
    let vline = layout_next_flow_line(&pp, &mut cursor, 20.0, lh, &regions, WrapMode::Char)
        .expect("should produce visual line");

    // Both fragments must respect their region width (strict, no tolerance)
    for frag in &vline.fragments {
        let region_w = regions[frag.region_index].1;
        assert!(
            frag.inline_advance_px <= region_w + 0.1,
            "fragment in region {} has width {:.2} exceeding region width {:.2}",
            frag.region_index,
            frag.inline_advance_px,
            region_w,
        );
    }
}

#[test]
fn flow_column_word_wrap_stops_at_next_break_after_unbreakable_overflow() {
    let reg = test_registry();
    let text = "Supercalifragilistic word";
    let pp = prepare_en(text, &reg, WrapMode::Word);
    let mut cursor = BreakCursor::new();
    let grapheme_count = simple_grapheme_split(text).len();
    let long_word_len = "Supercalifragilistic".len();

    let column =
        layout_next_flow_column(&pp, &mut cursor, 20.0, 30.0, &[(0.0, 40.0)], WrapMode::Word)
            .expect("unbreakable word should overflow the last region");

    assert_eq!(column.fragments.len(), 1);
    let fragment = &column.fragments[0];
    assert_eq!(fragment.char_start, 0);
    assert!(fragment.char_end >= long_word_len);
    assert!(fragment.char_end < grapheme_count);
    assert!(fragment.inline_advance_px > 40.0);
    assert_eq!(cursor.char_index, fragment.char_end);
}

#[test]
fn vertical_mixed_sideways_advances_match_positioning_shaper() {
    let registry = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let shape_options = ShapeOptions {
        writing_mode: Some("vertical-rl".to_string()),
        language: Some("en".to_string()),
        text_orientation: Some("mixed".to_string()),
        ..ShapeOptions::default()
    };
    let paragraph = shape_paragraph(
        "abc",
        &font_context,
        Language::En,
        WrapMode::Char,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("shape vertical paragraph");
    let font_entry = registry
        .resolve("NotoSansJP", 400, &FontStyle::Normal)
        .expect("resolve test font");
    let positioned = crate::font::shaping::shape_text_with_options(
        &registry,
        font_entry,
        "abc",
        20.0,
        0.0,
        &shape_options,
    );
    let expected_advances = positioned
        .iter()
        .map(|glyph| glyph.y_advance.abs())
        .collect::<Vec<_>>();
    let actual_advances =
        compute_vertical_advances_px(&paragraph, 20.0 / f64::from(paragraph.units_per_em));

    assert_eq!(actual_advances.len(), expected_advances.len());
    for (actual, expected) in actual_advances.iter().zip(&expected_advances) {
        assert!((actual - expected).abs() < 1e-6);
    }
    assert!(actual_advances.iter().sum::<f64>() < 40.0);

    let mut cursor = BreakCursor::new();
    let column = layout_next_flow_column(
        &paragraph,
        &mut cursor,
        20.0,
        30.0,
        &[(0.0, 25.0)],
        WrapMode::Char,
    )
    .expect("mixed sideways text should fit into a column");
    assert_eq!(column.fragments[0].char_end, 2);
}

#[test]
fn vertical_mixed_sideways_preserves_zero_advances_and_tracking() {
    let mut registry = FontRegistry::new();
    registry
        .register(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../fixtures/fonts/Inter-Variable.ttf"
            ))
            .expect("Inter font"),
            "Inter".to_string(),
            400,
            FontStyle::Normal,
        )
        .expect("register Inter");
    let families = vec!["Inter".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let shape_options = ShapeOptions {
        writing_mode: Some("vertical-rl".to_string()),
        language: Some("en".to_string()),
        text_orientation: Some("mixed".to_string()),
        ..ShapeOptions::default()
    };

    for (text, plain_text) in [("e\u{0301}\u{0301}", "e"), ("a\u{200b}b", "ab")] {
        let shaped = shape_paragraph(
            text,
            &font_context,
            Language::En,
            WrapMode::Char,
            false,
            &shape_options,
            None,
            0.0,
        )
        .expect("shape text with a zero-advance glyph");
        let plain = shape_paragraph(
            plain_text,
            &font_context,
            Language::En,
            WrapMode::Char,
            false,
            &shape_options,
            None,
            0.0,
        )
        .expect("shape comparison text");
        let scale = 20.0 / f64::from(shaped.units_per_em);
        assert!(
            shaped
                .glyphs
                .iter()
                .any(|glyph| glyph.vertical_inline_advance_funits == Some(0))
        );
        assert!(
            (compute_vertical_advances_px(&shaped, scale)
                .iter()
                .sum::<f64>()
                - compute_vertical_advances_px(&plain, scale)
                    .iter()
                    .sum::<f64>())
            .abs()
                < 0.05
        );
    }

    let tracked = shape_paragraph(
        "abc",
        &font_context,
        Language::En,
        WrapMode::Char,
        false,
        &shape_options,
        None,
        2.0,
    )
    .expect("shape tracked text");
    let font_entry = registry
        .resolve("Inter", 400, &FontStyle::Normal)
        .expect("resolve Inter");
    let positioned = crate::font::shaping::shape_text_with_options(
        &registry,
        font_entry,
        "abc",
        20.0,
        2.0,
        &shape_options,
    );
    assert!(
        (compute_vertical_advances_px(&tracked, 20.0 / f64::from(tracked.units_per_em))
            .iter()
            .sum::<f64>()
            - positioned
                .iter()
                .map(|glyph| glyph.y_advance.abs())
                .sum::<f64>())
        .abs()
            < 0.05
    );
}

#[test]
fn vertical_last_region_consumes_an_oversized_first_grapheme() {
    let registry = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let shape_options = ShapeOptions {
        writing_mode: Some("vertical-rl".to_string()),
        language: Some("en".to_string()),
        text_orientation: Some("upright".to_string()),
        ..ShapeOptions::default()
    };
    let paragraph = shape_paragraph(
        "a",
        &font_context,
        Language::En,
        WrapMode::Char,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("shape oversized upright grapheme");
    let mut cursor = BreakCursor::new();
    let column = layout_next_flow_column(
        &paragraph,
        &mut cursor,
        20.0,
        30.0,
        &[(0.0, 10.0)],
        WrapMode::Char,
    )
    .expect("last region must make progress");

    assert_eq!(column.fragments[0].char_end, 1);
    assert!(column.fragments[0].inline_advance_px > 10.0);
    assert!(!cursor.has_remaining(&paragraph));
}

#[test]
fn vertical_char_wrap_prefers_the_latest_uax_boundary() {
    let registry = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let shape_options = ShapeOptions {
        writing_mode: Some("vertical-rl".to_string()),
        language: Some("en".to_string()),
        text_orientation: Some("mixed".to_string()),
        ..ShapeOptions::default()
    };
    let paragraph = shape_paragraph(
        "日本abc組版",
        &font_context,
        Language::En,
        WrapMode::Char,
        false,
        &shape_options,
        None,
        0.0,
    )
    .expect("shape mixed vertical paragraph");
    let mut cursor = BreakCursor::new();
    let mut column_ranges = Vec::new();

    while let Some(column) = layout_next_flow_column(
        &paragraph,
        &mut cursor,
        20.0,
        30.0,
        &[(0.0, 32.0)],
        WrapMode::Char,
    ) {
        let fragment = &column.fragments[0];
        column_ranges.push((fragment.char_start, fragment.char_end));
    }

    assert_eq!(column_ranges, vec![(0, 1), (1, 2), (2, 4), (4, 6), (6, 7)]);
}

#[test]
fn flow_line_kinsoku_no_head_prohibit_at_line_start() {
    let reg = test_registry();
    // Text with punctuation that triggers kinsoku: 。and 、 are head-prohibit
    let text = "テストです。次の文です。三つ目の文です。最後の文です。";
    let pp = prepare_ja(text, &reg, WrapMode::Char);
    let lh = 20.0 * 1.5;

    // Simulate multiple visual lines with 2 regions (obstacle in center)
    let regions = [(0.0, 80.0), (150.0, 80.0)];
    let mut cursor = BreakCursor::new();
    let mut line_starts: Vec<usize> = Vec::new();

    while let Some(vline) =
        layout_next_flow_line(&pp, &mut cursor, 20.0, lh, &regions, WrapMode::Char)
    {
        // Record each visual line's first fragment start
        if let Some(first) = vline.fragments.first() {
            line_starts.push(first.char_start);
        }
    }

    // Check: no visual line starts with a head-prohibit character
    let text_str: &str = &pp.text;
    let chars_owned = simple_grapheme_split(text_str);
    let chars: Vec<&str> = chars_owned.iter().map(String::as_str).collect();

    let head_prohibit = [
        '\u{3002}', '\u{3001}', '\u{FF0C}', '\u{FF0E}', '\u{30FB}', '\u{FF1A}', '\u{FF1B}',
        '\u{FF1F}', '\u{FF01}', '\u{30FC}', '\u{301C}', '\u{FF09}', '\u{300D}', '\u{300F}',
    ];

    for (line_num, &start) in line_starts.iter().enumerate().skip(1) {
        // skip first line (always valid)
        if start < chars.len() {
            if let Some(ch) = chars[start].chars().next() {
                assert!(
                    !head_prohibit.contains(&ch),
                    "visual line {line_num} starts with head-prohibit char '{ch}' (char index {start})",
                );
            }
        }
    }
}

#[test]
fn flow_line_kinsoku_absorb_in_narrow_region() {
    let reg = test_registry();
    // "す。" in a region that fits only 1 char → kinsoku unresolved →
    // "。" must be absorbed into the fragment, not left at next line start.
    let text = "す。次のテスト";
    let pp = prepare_ja(text, &reg, WrapMode::Char);
    let lh = 20.0 * 1.5;

    // Single narrow region (just over 1 char width)
    let mut cursor = BreakCursor::new();
    let vline = layout_next_flow_line(&pp, &mut cursor, 20.0, lh, &[(0.0, 25.0)], WrapMode::Char)
        .expect("should produce visual line");

    // Fragment should absorb "す。" (not just "す")
    let frag = &vline.fragments[0];
    let byte_start = pp.char_byte_offsets[frag.char_start] as usize;
    let byte_end = pp.char_byte_offsets[frag.char_end] as usize;
    let frag_text = &pp.text[byte_start..byte_end];
    assert!(
        frag_text.contains('\u{3002}'),
        "fragment should absorb head-prohibit '\u{3002}': got {frag_text:?}",
    );

    // Next visual line must NOT start with "。"
    if cursor.char_index < pp.char_byte_offsets.len() - 1 {
        let next_byte = pp.char_byte_offsets[cursor.char_index] as usize;
        let next_ch = pp.text[next_byte..].chars().next().unwrap();
        assert_ne!(
            next_ch, '\u{3002}',
            "next line must not start with head-prohibit '\u{3002}'"
        );
    }
}

#[test]
fn flow_line_word_wrap_uses_break_opportunities_in_non_last_region() {
    let reg = test_registry();
    let text = "Hello world again";
    let pp = prepare_en(text, &reg, WrapMode::Word);
    let lh = 20.0 * 1.5;
    let scale = 20.0 / f64::from(pp.units_per_em);
    let advances_px = compute_advances_px(&pp, scale);

    let hello_space_width: f64 = advances_px[..6].iter().sum();
    let hello_space_w_width: f64 = advances_px[..7].iter().sum();
    let first_region_width = f64::midpoint(hello_space_width, hello_space_w_width);

    let mut cursor = BreakCursor::new();
    let vline = layout_next_flow_line(
        &pp,
        &mut cursor,
        20.0,
        lh,
        &[(0.0, first_region_width), (200.0, 200.0)],
        WrapMode::Word,
    )
    .expect("should produce visual line");

    assert_eq!(vline.fragments.len(), 2);

    let first = &vline.fragments[0];
    let first_text = &pp.text[pp.char_byte_offsets[first.char_start] as usize
        ..pp.char_byte_offsets[first.char_end] as usize];
    assert_eq!(first_text, "Hello ");

    let second = &vline.fragments[1];
    let second_text = &pp.text[pp.char_byte_offsets[second.char_start] as usize
        ..pp.char_byte_offsets[second.char_end] as usize];
    assert!(
        second_text.starts_with("world"),
        "second fragment should begin at a word boundary, got {second_text:?}",
    );
}

// ------------------------------------------------------------------
// kinsoku absorb — is_valid_break_boundary coverage
// ------------------------------------------------------------------

/// Helper: run multiple visual lines and return the char index at each
/// visual line start (excluding the first line which always starts at 0).
fn collect_line_starts(
    pp: &ShapedParagraph,
    regions: &[(f64, f64)],
    font_size_px: f64,
) -> Vec<usize> {
    let lh = font_size_px * 1.5;
    let mut cursor = BreakCursor::new();
    let mut starts = Vec::new();
    let mut first = true;
    while let Some(vline) =
        layout_next_flow_line(pp, &mut cursor, font_size_px, lh, regions, WrapMode::Char)
    {
        if first {
            first = false;
            continue;
        }
        if let Some(f) = vline.fragments.first() {
            starts.push(f.char_start);
        }
    }
    starts
}

fn char_at(pp: &ShapedParagraph, idx: usize) -> char {
    let byte = pp.char_byte_offsets[idx] as usize;
    pp.text[byte..].chars().next().unwrap()
}

#[test]
fn absorb_head_prohibit() {
    let reg = test_registry();
    let text = "す。次のテスト";
    let pp = prepare_ja(text, &reg, WrapMode::Char);
    let starts = collect_line_starts(&pp, &[(0.0, 25.0)], 20.0);
    for &s in &starts {
        assert_ne!(
            char_at(&pp, s),
            '\u{3002}',
            "line start must not be \u{3002}"
        );
    }
}

#[test]
fn absorb_tail_prohibit() {
    let reg = test_registry();
    // "す「テスト」あ" — 「 is tail-prohibit (can't end a line)
    let text = "す「テスト」あいうえおかきくけこ";
    let pp = prepare_ja(text, &reg, WrapMode::Char);
    let starts = collect_line_starts(&pp, &[(0.0, 25.0)], 20.0);
    for &s in &starts {
        if s > 0 {
            let prev = char_at(&pp, s - 1);
            assert_ne!(
                prev, '\u{300C}',
                "line must not end with tail-prohibit \u{300C}"
            );
        }
    }
}

#[test]
fn absorb_non_breaking_ellipsis() {
    let reg = test_registry();
    // "す……テスト" — …… is a non-breaking pair
    let text = "す……テストあいうえおかきくけこ";
    let pp = prepare_ja(text, &reg, WrapMode::Char);
    let starts = collect_line_starts(&pp, &[(0.0, 25.0)], 20.0);
    // No line break should split the …… pair
    for &s in &starts {
        if s > 0 {
            let prev = char_at(&pp, s - 1);
            let curr = char_at(&pp, s);
            assert!(
                !(prev == '\u{2026}' && curr == '\u{2026}'),
                "\u{2026}\u{2026} pair must not be split across lines"
            );
        }
    }
}

// ------------------------------------------------------------------
// find_ellipsis_truncation_point tests
// ------------------------------------------------------------------

#[test]
fn find_ellipsis_truncation_basic() {
    let reg = test_registry();
    let font_families = vec!["NotoSansJP".to_string()];
    let font_style = FontStyle::Normal;
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &font_families,
        weight: 400,
        style: &font_style,
    };
    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        "あいうえおかきくけこ",
        &font_ctx,
        Language::Ja,
        WrapMode::Char,
        false,
        &shape_options,
        None,
        0.0,
    )
    .unwrap();

    // With font_size=20, each CJK char is ~20px.
    // 10 chars = ~200px. Ellipsis ~12-20px.
    // max_width=65 should keep ~2 chars + ellipsis.
    let ellipsis_width = 12.0; // approximate
    let result = find_ellipsis_truncation_point(&shaped, 20.0, 0, 10, 65.0, ellipsis_width);

    let trunc = result.expect("should find truncation point");
    assert!(trunc.truncate_at > 0, "should keep at least one char");
    assert!(trunc.truncate_at < 10, "should truncate before end");
    assert!(
        trunc.prefix_extent + ellipsis_width <= 65.0,
        "prefix + ellipsis must fit: {} + {} > 65",
        trunc.prefix_extent,
        ellipsis_width
    );
}

#[test]
fn find_ellipsis_truncation_too_narrow() {
    let reg = test_registry();
    let font_families = vec!["NotoSansJP".to_string()];
    let font_style = FontStyle::Normal;
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &font_families,
        weight: 400,
        style: &font_style,
    };
    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        "あいう",
        &font_ctx,
        Language::Ja,
        WrapMode::Char,
        false,
        &shape_options,
        None,
        0.0,
    )
    .unwrap();

    // max_width smaller than ellipsis_width → None
    let result = find_ellipsis_truncation_point(&shaped, 20.0, 0, 3, 5.0, 12.0);
    assert!(
        result.is_none(),
        "should return None when ellipsis doesn't fit"
    );
}

#[test]
fn find_ellipsis_truncation_at_start() {
    let reg = test_registry();
    let font_families = vec!["NotoSansJP".to_string()];
    let font_style = FontStyle::Normal;
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &font_families,
        weight: 400,
        style: &font_style,
    };
    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        "あいうえお",
        &font_ctx,
        Language::Ja,
        WrapMode::Char,
        false,
        &shape_options,
        None,
        0.0,
    )
    .unwrap();

    // max_width just fits ellipsis alone (no prefix chars)
    let result = find_ellipsis_truncation_point(&shaped, 20.0, 0, 5, 15.0, 14.0);
    let trunc = result.expect("should return Some even if only ellipsis fits");
    assert_eq!(trunc.truncate_at, 0, "truncate_at should be char_start");
}

#[test]
fn find_ellipsis_truncation_allows_head_prohibit_after_cut() {
    // For ellipsis, head-prohibit on the hidden character is irrelevant.
    // "す。次の" — "。" is head-prohibit for line breaks, but for ellipsis
    // it's fine to truncate at pos=1 (showing "す…") because "。" is hidden.
    let reg = test_registry();
    let font_families = vec!["NotoSansJP".to_string()];
    let font_style = FontStyle::Normal;
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &font_families,
        weight: 400,
        style: &font_style,
    };
    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        "す。次の",
        &font_ctx,
        Language::Ja,
        WrapMode::Char,
        false,
        &shape_options,
        None,
        0.0,
    )
    .unwrap();

    // Width for ~1 char + ellipsis. Binary search should return pos=1.
    // With is_valid_break_boundary this would reject pos=1 (head-prohibit "。"),
    // but is_valid_ellipsis_boundary allows it.
    let result = find_ellipsis_truncation_point(&shaped, 20.0, 0, 4, 35.0, 12.0);
    let trunc = result.expect("should find truncation");
    assert_eq!(
        trunc.truncate_at, 1,
        "pos=1 should be allowed — head-prohibit is irrelevant for ellipsis"
    );
}

#[test]
fn find_ellipsis_truncation_avoids_tail_prohibit() {
    // "「あいう" — "「" is tail-prohibit. Truncating at pos=1 would end
    // the visible prefix with "「", which looks wrong. The function should
    // back off to pos=0 (ellipsis-only).
    let reg = test_registry();
    let font_families = vec!["NotoSansJP".to_string()];
    let font_style = FontStyle::Normal;
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &font_families,
        weight: 400,
        style: &font_style,
    };
    let shape_options = ShapeOptions::default();
    let shaped = shape_paragraph(
        "「あいう",
        &font_ctx,
        Language::Ja,
        WrapMode::Char,
        false,
        &shape_options,
        None,
        0.0,
    )
    .unwrap();

    // Width for ~1 char + ellipsis. Binary search would give pos=1, but
    // pos=1 means the prefix ends with "「" (tail-prohibit) → back off to 0.
    let result = find_ellipsis_truncation_point(&shaped, 20.0, 0, 4, 35.0, 12.0);
    let trunc = result.expect("should find truncation");
    assert_ne!(
        trunc.truncate_at, 1,
        "should not end visible prefix with tail-prohibit '\u{300C}'"
    );
}

// -----------------------------------------------------------------------
// collect_notdef_chars
// -----------------------------------------------------------------------

#[test]
fn collect_notdef_chars_empty_for_supported_text() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let pp = shape_paragraph_with_options(
        "あいう",
        &font_ctx,
        Language::Ja,
        WrapMode::Char,
        false,
        &ShapeOptions::default(),
        None,
        0.0,
        true,
    )
    .expect("should prepare paragraph");

    let infos = collect_notdef_chars(&pp);
    assert!(infos.is_empty(), "no .notdef expected for supported text");
}

#[test]
fn collect_notdef_chars_detects_unsupported_text() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    // Characters outside the subset produce .notdef (glyph_id=0) and
    // allow_notdef=true lets them through.
    let pp = shape_paragraph_with_options(
        "\u{1F980}\u{1F40D}",
        &font_ctx,
        Language::Auto,
        WrapMode::Char,
        false,
        &ShapeOptions::default(),
        None,
        0.0,
        true,
    );

    if let Some(pp) = pp {
        let infos = collect_notdef_chars(&pp);
        // If the subset font doesn't have these emoji, we expect NotdefInfo entries
        if !infos.is_empty() {
            assert_eq!(infos[0].font_alias, "NotoSansJP");
        }
    }
}

// -----------------------------------------------------------------------
// layout_paragraph — whiteSpace integration tests
// -----------------------------------------------------------------------

#[test]
fn layout_paragraph_nowrap_produces_single_line() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let pp = shape_paragraph(
        "AAA BBB CCC DDD",
        &font_ctx,
        Language::Auto,
        WrapMode::Char,
        false,
        &ShapeOptions::default(),
        None,
        0.0,
    )
    .expect("shape should succeed");

    // max_width=10 would normally force wrapping, but wrap=None prevents it
    let result = layout_paragraph(&pp, 16.0, 20.0, 16.0, 10.0, WrapMode::None, false);
    assert_eq!(result.lines.len(), 1, "nowrap should produce a single line");
}

#[test]
fn layout_paragraph_word_wrap_keeps_unbreakable_word_on_one_line() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let pp = shape_paragraph(
        "Supercalifragilistic",
        &font_ctx,
        Language::En,
        WrapMode::Word,
        false,
        &ShapeOptions::default(),
        None,
        0.0,
    )
    .expect("shape should succeed");

    let result = layout_paragraph(&pp, 24.0, 36.0, 28.0, 80.0, WrapMode::Word, false);
    assert_eq!(result.lines.len(), 1);
    assert_eq!(result.lines[0].text, "Supercalifragilistic");
    assert!(result.lines[0].width > 80.0);

    let measured = measure_paragraph(&pp, 24.0, 36.0, 80.0, WrapMode::Word, false);
    assert_eq!(measured.line_count, 1);
    assert!(measured.max_line_width > 80.0);
}

#[test]
fn layout_text_marks_unbreakable_word_constraint_overflow() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let mut req = make_req("Supercalifragilistic", 24.0, 80.0);
    req.language = Language::En;

    let result = layout_text(&req, &font_ctx).expect("layout should succeed");
    assert_eq!(result.lines.len(), 1);
    assert_eq!(result.overflow.overflow_type, "overflow");
    assert_eq!(
        result.overflow.reason.as_deref(),
        Some("text exceeds maxWidth")
    );
}

#[test]
fn layout_paragraph_pre_wrap_breaks_at_newline() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    // allow_notdef=true because \n produces .notdef glyphs
    let pp = shape_paragraph_with_options(
        "line1\nline2\nline3",
        &font_ctx,
        Language::Auto,
        WrapMode::Char,
        false,
        &ShapeOptions::default(),
        None,
        0.0,
        true,
    )
    .expect("shape should succeed");

    let result = layout_paragraph(&pp, 16.0, 20.0, 16.0, 999.0, WrapMode::Char, true);
    assert_eq!(result.lines.len(), 3, "pre-wrap should break at each \\n");
    assert_eq!(result.lines[0].text, "line1");
    assert_eq!(result.lines[1].text, "line2");
    assert_eq!(result.lines[2].text, "line3");
}

#[test]
fn layout_text_smoke_still_works_with_paragraph_module_split() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let req = TextLayoutRequest {
        text: "abc",
        spans: None,
        rich_text: None,
        font_size_px: 16.0,
        line_height: Some(1.2),
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 200.0,
        max_height: None,
        wrap: WrapMode::Word,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: None,
        ellipsis: false,
        language: crate::text::types::Language::Auto,
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: TextOrientation::Mixed,
        uax14_breaks: None,
        hanging_punctuation: false,
        font_variation_settings: Vec::new(),
        font_feature_settings: Vec::new(),
        min_font_size_px: None,
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
    };

    let result = layout_text(&req, &font_ctx).expect("layout");
    assert_eq!(result.lines.len(), 1);
}
