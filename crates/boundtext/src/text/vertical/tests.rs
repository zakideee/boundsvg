use super::*;
use crate::font::shaping::GlyphInfo;
use crate::font::{FontRegistry, FontStyle};
use crate::text::kinsoku::get_kinsoku_profile;
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
    reg.register(data, "NotoSansJP".into(), 400, FontStyle::Normal)
        .unwrap();
    reg
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "test helper with small index values; fits in u32"
)]
fn mock_vertical_glyphs(advances: &[(f64, f64)]) -> Vec<GlyphInfo> {
    let mut byte_offset = 0u32;
    let mut glyphs = Vec::new();
    for (i, &(x_adv, y_adv)) in advances.iter().enumerate() {
        glyphs.push(GlyphInfo {
            glyph_id: i as u32 + 1,
            x_advance: x_adv,
            y_advance: y_adv,
            x_offset: 0.0,
            y_offset: 0.0,
            cluster: byte_offset,
            font_alias: None,
            font_weight: None,
            font_style: None,
            rotation_deg: None,
        });
        // Assume 3 bytes per char (CJK)
        byte_offset += 3;
    }
    glyphs
}

#[test]
fn test_break_vertical_empty() {
    let result = break_vertical_columns(
        &[],
        "",
        100.0,
        WrapMode::Char,
        16.0,
        20.0,
        None,
        None,
        None,
        false,
    );
    assert_eq!(result.columns.len(), 1);
    assert_eq!(result.columns[0].text, "");
}

#[test]
fn test_break_vertical_single_column() {
    // Three CJK chars, each with y_advance=20, max_height=100 -> fits in one column
    let glyphs = mock_vertical_glyphs(&[(0.0, -20.0), (0.0, -20.0), (0.0, -20.0)]);
    let text = "あいう";
    let result = break_vertical_columns(
        &glyphs,
        text,
        100.0,
        WrapMode::Char,
        16.0,
        20.0,
        None,
        None,
        None,
        false,
    );
    assert_eq!(result.columns.len(), 1);
    assert_eq!(result.columns[0].text, "あいう");
    assert!((result.columns[0].width - 60.0).abs() < 0.001);
}

#[test]
fn test_break_vertical_two_columns() {
    // Three CJK chars, each with y_advance=20, max_height=45 -> 2 columns
    let glyphs = mock_vertical_glyphs(&[(0.0, -20.0), (0.0, -20.0), (0.0, -20.0)]);
    let text = "あいう";
    let result = break_vertical_columns(
        &glyphs,
        text,
        45.0,
        WrapMode::Char,
        16.0,
        20.0,
        None,
        None,
        None,
        false,
    );
    assert_eq!(result.columns.len(), 2);
}

#[test]
fn test_break_vertical_uses_x_advance_fallback() {
    // If y_advance is 0, should fall back to x_advance
    let glyphs = mock_vertical_glyphs(&[(15.0, 0.0), (15.0, 0.0), (15.0, 0.0)]);
    let text = "あいう";
    let result = break_vertical_columns(
        &glyphs,
        text,
        35.0,
        WrapMode::Char,
        16.0,
        20.0,
        None,
        None,
        None,
        false,
    );
    assert_eq!(result.columns.len(), 2);
}

#[test]
fn test_break_vertical_none_wrap_keeps_single_column() {
    let glyphs = mock_vertical_glyphs(&[(0.0, -20.0), (0.0, -20.0), (0.0, -20.0)]);
    let text = "あいう";
    let result = break_vertical_columns(
        &glyphs,
        text,
        25.0,
        WrapMode::None,
        16.0,
        20.0,
        None,
        None,
        None,
        false,
    );
    assert_eq!(result.columns.len(), 1);
    assert_eq!(result.columns[0].text, text);
    assert!((result.columns[0].width - 60.0).abs() < 0.001);
}

#[test]
fn test_build_column_positioned_glyphs_starts_at_column_origin() {
    use super::glyph_mapping::{GlyphCharSpan, VerticalCharPlacement};
    use super::layout::build_column_positioned_glyphs;

    let glyphs = vec![
        GlyphInfo {
            glyph_id: 1,
            x_advance: 0.0,
            y_advance: -20.0,
            x_offset: 0.0,
            y_offset: 8.0,
            cluster: 0,
            font_alias: None,
            font_weight: None,
            font_style: None,
            rotation_deg: Some(0),
        },
        GlyphInfo {
            glyph_id: 2,
            x_advance: 0.0,
            y_advance: -20.0,
            x_offset: 0.0,
            y_offset: 8.0,
            cluster: 3,
            font_alias: None,
            font_weight: None,
            font_style: None,
            rotation_deg: Some(0),
        },
    ];
    let glyph_spans = vec![
        GlyphCharSpan { start: 0, end: 1 },
        GlyphCharSpan { start: 1, end: 2 },
    ];
    let placements = vec![
        VerticalCharPlacement {
            advance: 20.0,
            x_offset: 0.0,
            y_offset: 8.0,
        },
        VerticalCharPlacement {
            advance: 20.0,
            x_offset: 0.0,
            y_offset: 8.0,
        },
    ];
    let advances = vec![20.0, 20.0];
    let char_byte_offsets = vec![0, 3, 6];
    let positioned = build_column_positioned_glyphs(
        &[0, 1],
        &glyphs,
        &glyph_spans,
        &placements,
        &advances,
        "あい",
        &char_byte_offsets,
        0,
        2,
    );

    assert_eq!(positioned.len(), 2);
    assert!((positioned[0].origin_y - 8.0).abs() < 0.001);
    assert!((positioned[1].origin_y - 28.0).abs() < 0.001);
    assert_eq!(positioned[0].source_start, Some(0));
    assert_eq!(positioned[0].source_end, Some(1));
    assert_eq!(positioned[1].source_start, Some(1));
    assert_eq!(positioned[1].source_end, Some(2));
    assert!(
        positioned
            .iter()
            .all(|glyph| glyph.source_role.as_deref() == Some("content"))
    );
}

#[test]
fn test_build_vertical_result() {
    use super::layout::build_vertical_result;
    use crate::text::types::Line;

    let columns = vec![
        Line {
            text: "あい".to_string(),
            glyphs: Vec::new(),
            width: 40.0,
            baseline_y: 0.0,
            positioned_glyphs: Some(Vec::new()),
            fragments: None,
        },
        Line {
            text: "う".to_string(),
            glyphs: Vec::new(),
            width: 20.0,
            baseline_y: 20.0,
            positioned_glyphs: Some(Vec::new()),
            fragments: None,
        },
    ];
    let result = build_vertical_result(columns, 2, 20.0, 16.0, false, Vec::new());
    // width = 2 columns * 20px = 40px
    assert!((result.bbox.w - 40.0).abs() < 0.001);
    // height = max column height = 40px
    assert!((result.bbox.h - 40.0).abs() < 0.001);
    assert_eq!(result.overflow.overflow_type, "none");
}

#[test]
fn test_build_vertical_result_overflow() {
    use super::layout::build_vertical_result;
    use crate::text::types::Line;

    let columns = vec![Line {
        text: "あ".to_string(),
        glyphs: Vec::new(),
        width: 20.0,
        baseline_y: 0.0,
        positioned_glyphs: Some(Vec::new()),
        fragments: None,
    }];
    // total_column_count=3 but only 1 in truncated -> overflow
    let result = build_vertical_result(columns, 3, 20.0, 16.0, false, Vec::new());
    assert_eq!(result.overflow.overflow_type, "overflow");
}

#[test]
fn test_build_vertical_result_detects_width_constraint_overflow() {
    use super::layout::build_vertical_result_with_constraints;
    use crate::text::types::Line;

    let columns = vec![
        Line {
            text: "あ".to_string(),
            glyphs: Vec::new(),
            width: 20.0,
            baseline_y: 0.0,
            positioned_glyphs: Some(Vec::new()),
            fragments: None,
        },
        Line {
            text: "い".to_string(),
            glyphs: Vec::new(),
            width: 20.0,
            baseline_y: 20.0,
            positioned_glyphs: Some(Vec::new()),
            fragments: None,
        },
    ];

    let result = build_vertical_result_with_constraints(
        columns,
        2,
        20.0,
        16.0,
        false,
        Some(30.0),
        Some(100.0),
        Vec::new(),
    );

    assert_eq!(result.overflow.overflow_type, "overflow");
    assert_eq!(
        result.overflow.reason.as_deref(),
        Some("text exceeds maxWidth")
    );
}

#[test]
fn test_vertical_text_fits() {
    use super::fit::vertical_text_fits;
    use crate::text::types::Line;

    let columns = vec![
        Line {
            text: "あ".to_string(),
            glyphs: Vec::new(),
            width: 20.0,
            baseline_y: 0.0,
            positioned_glyphs: None,
            fragments: None,
        },
        Line {
            text: "い".to_string(),
            glyphs: Vec::new(),
            width: 20.0,
            baseline_y: 20.0,
            positioned_glyphs: None,
            fragments: None,
        },
    ];
    let req = TextLayoutRequest {
        text: "あい",
        spans: None,
        rich_text: None,
        font_size_px: 16.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 100.0,
        max_height: Some(30.0),
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: None,
        ellipsis: false,
        language: Language::Ja,
        writing_mode: WritingMode::VerticalRl,
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
        fit_max_probes: None,
    };
    // 2 columns * 20px line_height = 40px total width <= 100px -> width OK
    // Each column height 20px <= 30px max_height -> OK
    assert!(vertical_text_fits(&columns, &req, 20.0, true));
}

#[test]
fn test_vertical_text_does_not_fit_width() {
    use super::fit::vertical_text_fits;
    use crate::text::types::Line;

    let columns = vec![
        Line {
            text: "あ".to_string(),
            glyphs: Vec::new(),
            width: 20.0,
            baseline_y: 0.0,
            positioned_glyphs: None,
            fragments: None,
        },
        Line {
            text: "い".to_string(),
            glyphs: Vec::new(),
            width: 20.0,
            baseline_y: 20.0,
            positioned_glyphs: None,
            fragments: None,
        },
    ];
    let req = TextLayoutRequest {
        text: "あい",
        spans: None,
        rich_text: None,
        font_size_px: 16.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 30.0, // 2 columns * 20px = 40 > 30
        max_height: None,
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: None,
        ellipsis: false,
        language: Language::Ja,
        writing_mode: WritingMode::VerticalRl,
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
        fit_max_probes: None,
    };
    assert!(!vertical_text_fits(&columns, &req, 20.0, true));
}

#[test]
fn test_glyph_advance_in_vertical() {
    use super::glyph_mapping::glyph_advance_in_vertical;

    let glyph_with_y = GlyphInfo {
        glyph_id: 1,
        x_advance: 10.0,
        y_advance: -20.0,
        x_offset: 0.0,
        y_offset: 0.0,
        cluster: 0,
        font_alias: None,
        font_weight: None,
        font_style: None,
        rotation_deg: None,
    };
    assert!((glyph_advance_in_vertical(&glyph_with_y) - 20.0).abs() < 0.001);

    let glyph_no_y = GlyphInfo {
        glyph_id: 2,
        x_advance: 15.0,
        y_advance: 0.0,
        x_offset: 0.0,
        y_offset: 0.0,
        cluster: 0,
        font_alias: None,
        font_weight: None,
        font_style: None,
        rotation_deg: None,
    };
    assert!((glyph_advance_in_vertical(&glyph_no_y) - 15.0).abs() < 0.001);
}

// --- Extended vertical tests ---

#[test]
fn test_vertical_kinsoku_period_not_at_column_start() {
    // "ああ。い" with max_height=45 -> "。" must not start a column
    let glyphs = mock_vertical_glyphs(&[(0.0, -20.0), (0.0, -20.0), (0.0, -20.0), (0.0, -20.0)]);
    let text = "ああ。い";
    let kinsoku = get_kinsoku_profile(Some("ja"));
    let result = break_vertical_columns(
        &glyphs,
        text,
        45.0,
        WrapMode::Char,
        16.0,
        20.0,
        kinsoku,
        None,
        None,
        false,
    );
    // No column should start with "。"
    for col in &result.columns {
        let first = col.text.chars().next();
        assert_ne!(
            first,
            Some('。'),
            "Column should not start with period: {:?}",
            col.text
        );
    }
}

#[test]
fn test_vertical_hanging_punctuation() {
    // "ああ。い" with max_height=40 -> period should hang, avoiding extra column
    let glyphs = mock_vertical_glyphs(&[(0.0, -20.0), (0.0, -20.0), (0.0, -20.0), (0.0, -20.0)]);
    let text = "ああ。い";
    let kinsoku = get_kinsoku_profile(Some("ja"));
    let hanging = crate::text::kinsoku::get_hanging_chars(true);
    let result = break_vertical_columns(
        &glyphs,
        text,
        40.0,
        WrapMode::Char,
        16.0,
        20.0,
        kinsoku,
        None,
        hanging,
        false,
    );
    // With hanging punctuation, "ああ。" should fit in one column (period hangs)
    // rather than splitting to 3 columns
    assert!(
        result.columns.len() <= 2,
        "Hanging punctuation should reduce column count: got {} columns",
        result.columns.len()
    );
}

#[test]
fn test_vertical_kinsoku_unresolved() {
    // All characters are head-prohibit -> kinsoku_unresolved should be true
    let glyphs = mock_vertical_glyphs(&[(0.0, -20.0), (0.0, -20.0), (0.0, -20.0)]);
    let text = "。。。";
    let kinsoku = get_kinsoku_profile(Some("ja"));
    let result = break_vertical_columns(
        &glyphs,
        text,
        25.0,
        WrapMode::Char,
        16.0,
        20.0,
        kinsoku,
        None,
        None,
        false,
    );
    assert!(
        result.kinsoku_unresolved,
        "Should flag kinsoku_unresolved when all chars are head-prohibit"
    );
}

#[test]
fn test_vertical_mixed_cjk_ascii_advance() {
    // CJK uses yAdvance, ASCII uses xAdvance fallback
    let glyphs = vec![
        GlyphInfo {
            glyph_id: 1,
            x_advance: 0.0,
            y_advance: -20.0,
            x_offset: 0.0,
            y_offset: 0.0,
            cluster: 0,
            font_alias: None,
            font_weight: None,
            font_style: None,
            rotation_deg: None,
        },
        GlyphInfo {
            glyph_id: 2,
            x_advance: 10.0,
            y_advance: 0.0,
            x_offset: 0.0,
            y_offset: 0.0,
            cluster: 3,
            font_alias: None,
            font_weight: None,
            font_style: None,
            rotation_deg: None,
        },
        GlyphInfo {
            glyph_id: 3,
            x_advance: 0.0,
            y_advance: -20.0,
            x_offset: 0.0,
            y_offset: 0.0,
            cluster: 4,
            font_alias: None,
            font_weight: None,
            font_style: None,
            rotation_deg: None,
        },
    ];
    let text = "あAい";
    let result = break_vertical_columns(
        &glyphs,
        text,
        100.0,
        WrapMode::Char,
        16.0,
        20.0,
        None,
        None,
        None,
        false,
    );
    assert_eq!(result.columns.len(), 1, "Should fit in one column");
    // Total advance: 20 + 10 + 20 = 50
    assert!((result.columns[0].width - 50.0).abs() < 0.001);
}

#[test]
fn test_vertical_with_uax14_breaks() {
    // UAX#14 break set should influence column breaking
    let glyphs = mock_vertical_glyphs(&[(0.0, -20.0), (0.0, -20.0), (0.0, -20.0), (0.0, -20.0)]);
    let text = "あいうえ";
    // Provide UAX#14 break after byte 6 (after "あい")
    let uax14_breaks: Vec<usize> = vec![6];
    let result = break_vertical_columns(
        &glyphs,
        text,
        45.0,
        WrapMode::Char,
        16.0,
        20.0,
        None,
        Some(&uax14_breaks),
        None,
        false,
    );
    // With max_height=45, 2 chars (40px) fit. UAX#14 break at byte 6 aligns.
    assert!(result.columns.len() >= 2, "Should create multiple columns");
}

// -----------------------------------------------------------------------
// Vertical fit boundary tests
// -----------------------------------------------------------------------

#[test]
fn test_vertical_grow_overflow_when_initial_does_not_fit() {
    use crate::font::FontContext;

    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    // Very tight: 15 chars at 24px in 30px x 30px -- won't fit
    let req = TextLayoutRequest {
        text: "あいうえおかきくけこさしすせそ",
        spans: None,
        rich_text: None,
        font_size_px: 24.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 30.0,
        max_height: Some(30.0),
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::Grow,
        max_lines: None,
        ellipsis: false,
        language: Language::Ja,
        writing_mode: WritingMode::VerticalRl,
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
        fit_max_probes: None,
    };

    let result = layout_vertical_text(&req, &font_ctx).expect("should produce a result");

    assert_ne!(
        result.overflow.overflow_type, "none",
        "vertical grow must not return overflow=none when initial size doesn't fit"
    );
}

#[test]
fn test_vertical_shrink_returns_early_when_fits() {
    use crate::font::FontContext;

    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    // Short text that fits easily at 16px
    let req = TextLayoutRequest {
        text: "短い",
        spans: None,
        rich_text: None,
        font_size_px: 16.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 200.0,
        max_height: Some(200.0),
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::Shrink,
        max_lines: None,
        ellipsis: false,
        language: Language::Ja,
        writing_mode: WritingMode::VerticalRl,
        text_orientation: TextOrientation::Mixed,
        uax14_breaks: None,
        hanging_punctuation: false,
        font_variation_settings: Vec::new(),
        font_feature_settings: Vec::new(),
        min_font_size_px: Some(8.0),
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
        fit_max_probes: None,
    };

    let result = layout_vertical_text(&req, &font_ctx).expect("should produce a result");

    assert!(
        (result.chosen_font_size_px - 16.0).abs() < 0.01,
        "should keep original size when it fits: {}",
        result.chosen_font_size_px
    );
    assert_eq!(result.overflow.overflow_type, "none");
}

#[test]
fn vertical_fit_ranges_cannot_invert_the_requested_operation() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = crate::font::FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let mut grow_req = parity_req("短い");
    grow_req.fit = FitMode::Grow;
    grow_req.max_font_size_px = Some(10.0);
    let grown = layout_vertical_text(&grow_req, &font_ctx).expect("grow result");
    assert_eq!(grown.chosen_font_size_px, grow_req.font_size_px);

    let mut shrink_req = parity_req("あいうえおかきくけこ");
    shrink_req.fit = FitMode::Shrink;
    shrink_req.max_width = 20.0;
    shrink_req.min_font_size_px = Some(40.0);
    let shrunk = layout_vertical_text(&shrink_req, &font_ctx).expect("shrink result");
    assert_eq!(shrunk.chosen_font_size_px, shrink_req.font_size_px);
}

// -----------------------------------------------------------------------
// Vertical path parity: fit honesty, nowrap, ellipsis, whitespace
// -----------------------------------------------------------------------

#[cfg(test)]
fn parity_req(text: &'static str) -> TextLayoutRequest<'static> {
    TextLayoutRequest {
        text,
        spans: None,
        rich_text: None,
        font_size_px: 20.0,
        line_height: Some(1.5),
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 400.0,
        max_height: Some(45.0),
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: None,
        ellipsis: false,
        language: Language::Ja,
        writing_mode: WritingMode::VerticalRl,
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
        fit_max_probes: None,
    }
}

#[test]
fn test_vertical_prewrap_newlines_are_zero_advance_separators() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = crate::font::FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let mut req = parity_req("あ\n\nい\n");
    req.white_space = WhiteSpaceMode::PreWrap;
    req.max_height = Some(100.0);

    let result = layout_vertical_text(&req, &font_ctx).expect("vertical pre-wrap layout");
    assert_eq!(
        result
            .lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>(),
        vec!["あ", "", "い", ""]
    );
    assert_eq!(
        result
            .lines
            .iter()
            .map(|line| line.width)
            .collect::<Vec<_>>(),
        vec![20.0, 0.0, 20.0, 0.0]
    );
    assert_eq!(result.bbox.h, 20.0);
}

#[test]
fn test_vertical_fit_with_max_lines_never_reports_false_success() {
    // Fit must not drop text silently while reporting overflow=none.
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = crate::font::FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    for fit in [FitMode::Shrink, FitMode::Grow] {
        let mut req = parity_req("あいうえおかきくけこ");
        req.fit = fit;
        req.max_lines = Some(2);
        req.min_font_size_px = Some(4.0);
        let result = layout_vertical_text(&req, &font_ctx).expect("result");
        let placed: String = result.lines.iter().map(|l| l.text.as_str()).collect();
        if result.overflow.overflow_type == "none" {
            assert_eq!(
                placed, "あいうえおかきくけこ",
                "{fit:?}: overflow=none must mean ALL text is placed, got \"{placed}\" at {}px",
                result.chosen_font_size_px
            );
        }
    }
}

#[test]
fn test_vertical_fit_honors_nowrap() {
    // whiteSpace=nowrap must keep a single column in the fit path too.
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = crate::font::FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let mut req = parity_req("あいうえおかきくけこ");
    req.fit = FitMode::Shrink;
    req.white_space = WhiteSpaceMode::NoWrap;
    req.min_font_size_px = Some(2.0);
    let result = layout_vertical_text(&req, &font_ctx).expect("result");
    assert_eq!(
        result.lines.len(),
        1,
        "nowrap must never produce multiple columns (got {} columns: {:?})",
        result.lines.len(),
        result
            .lines
            .iter()
            .map(|l| l.text.clone())
            .collect::<Vec<_>>()
    );
}

#[test]
fn test_vertical_ellipsis_applied_on_max_lines_truncation() {
    // maxLines truncation with ellipsis=true must end with U+2026.
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = crate::font::FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let mut req = parity_req("あいうえおかきくけこ");
    req.max_height = Some(96.0);
    req.max_lines = Some(1);
    req.ellipsis = true;
    let result = layout_vertical_text(&req, &font_ctx).expect("result");
    assert_eq!(result.lines.len(), 1);
    let text = &result.lines[0].text;
    assert!(
        text.ends_with('\u{2026}'),
        "truncated vertical column must end with ellipsis, got \"{text}\""
    );
    // The kept content must still fit the column height.
    assert!(
        result.lines[0].width <= 96.0 + 0.5,
        "ellipsized column must fit maxHeight, got {}",
        result.lines[0].width
    );
}

#[test]
fn test_vertical_whitespace_normal_collapses_like_horizontal() {
    // whiteSpace=normal must collapse runs of spaces before shaping.
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = crate::font::FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let mut single = parity_req("A B");
    single.wrap = WrapMode::None;
    single.max_height = Some(400.0);
    let mut multi = parity_req("A    B");
    multi.wrap = WrapMode::None;
    multi.max_height = Some(400.0);

    let a = layout_vertical_text(&single, &font_ctx).expect("result");
    let b = layout_vertical_text(&multi, &font_ctx).expect("result");
    assert!(
        (a.lines[0].width - b.lines[0].width).abs() < 0.01,
        "normal whitespace must collapse: {} vs {}",
        a.lines[0].width,
        b.lines[0].width
    );
}

#[test]
fn test_vertical_fit_prewrap_respects_tab_size() {
    // Fit path: pre-wrap tab expansion must honor tabSize.
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = crate::font::FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let mut narrow = parity_req("A\tB");
    narrow.fit = FitMode::Shrink;
    narrow.white_space = WhiteSpaceMode::PreWrap;
    narrow.tab_size = 2;
    narrow.max_height = Some(400.0);
    let mut wide = parity_req("A\tB");
    wide.fit = FitMode::Shrink;
    wide.white_space = WhiteSpaceMode::PreWrap;
    wide.tab_size = 6;
    wide.max_height = Some(400.0);

    let a = layout_vertical_text(&narrow, &font_ctx).expect("result");
    let b = layout_vertical_text(&wide, &font_ctx).expect("result");
    assert!(
        b.lines[0].width > a.lines[0].width + 0.01,
        "tabSize 6 must be taller than tabSize 2 in the fit path: {} vs {}",
        a.lines[0].width,
        b.lines[0].width
    );
}
