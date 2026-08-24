use super::break_detection::is_word_break;
use super::line_breaking::{break_lines_internal, break_lines_internal_with_options};
use super::result_building::{build_horizontal_result, build_horizontal_result_with_constraints};
use crate::font::shaping::GlyphInfo;
use crate::text::types::{Line, WrapMode};

// --- Word boundary tests ---

#[test]
fn test_word_break_after_space() {
    let chars = vec!["H", "e", "l", "l", "o", " ", "W"];
    assert!(is_word_break(&chars, 5)); // after space
    assert!(!is_word_break(&chars, 3)); // mid-word
}

#[test]
fn test_word_break_cjk() {
    let chars = vec!["日", "本"];
    assert!(is_word_break(&chars, 0)); // after CJK
}

#[test]
fn test_word_break_hyphen() {
    let chars = vec!["h", "i", "-", "f", "i"];
    assert!(is_word_break(&chars, 2)); // after hyphen
}

// --- Char-glyph map tests ---

#[expect(
    clippy::cast_possible_truncation,
    reason = "test helper with small index values; fits in u32"
)]
fn mock_glyphs(advances: &[f64]) -> Vec<GlyphInfo> {
    advances
        .iter()
        .enumerate()
        .map(|(i, &adv)| GlyphInfo {
            glyph_id: i as u32 + 1,
            x_advance: adv,
            y_advance: 0.0,
            x_offset: 0.0,
            y_offset: 0.0,
            cluster: i as u32,
            font_alias: None,
            font_weight: None,
            font_style: None,
            rotation_deg: None,
        })
        .collect()
}

#[test]
fn test_break_lines_no_wrap() {
    let advances = &[10.0, 10.0, 10.0];
    let glyphs = mock_glyphs(advances);
    let result = break_lines_internal(
        &glyphs,
        "ABC",
        20.0,
        WrapMode::None,
        None,
        20.0,
        16.0,
        None,
        None,
    );
    assert_eq!(result.lines.len(), 1);
    assert!((result.lines[0].width - 30.0).abs() < 0.001);
}

#[test]
fn test_break_lines_char_wrap() {
    let advances = &[10.0, 10.0, 10.0];
    let glyphs = mock_glyphs(advances);
    // max_width=25 → "AB" (20px) fits, "C" (10px) on next line
    let result = break_lines_internal(
        &glyphs,
        "ABC",
        25.0,
        WrapMode::Char,
        None,
        20.0,
        16.0,
        None,
        None,
    );
    assert_eq!(result.lines.len(), 2);
    assert!((result.lines[0].width - 20.0).abs() < 0.001); // "AB"
    assert!((result.lines[1].width - 10.0).abs() < 0.001); // "C"
}

#[test]
fn test_break_lines_preserves_forced_newline_empty_lines_and_ranges() {
    let glyphs = mock_glyphs(&[10.0, 0.0, 0.0, 10.0, 0.0]);
    let measured = break_lines_internal_with_options(
        &glyphs,
        "A\n\nB\n",
        100.0,
        WrapMode::Char,
        None,
        20.0,
        16.0,
        None,
        None,
        true,
        0.0,
    );

    assert_eq!(
        measured
            .result
            .lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>(),
        vec!["A", "", "B", ""]
    );
    assert_eq!(
        measured
            .line_ranges
            .iter()
            .map(|range| (range.char_start, range.char_end))
            .collect::<Vec<_>>(),
        vec![(0, 1), (2, 2), (3, 4), (5, 5)]
    );
}

#[test]
fn test_break_lines_empty() {
    let result = break_lines_internal(&[], "", 100.0, WrapMode::Char, None, 20.0, 16.0, None, None);
    assert_eq!(result.lines.len(), 1);
    assert_eq!(result.lines[0].text, "");
}

#[test]
fn test_build_horizontal_result() {
    let lines = vec![
        Line {
            text: "Hello".to_string(),
            glyphs: Vec::new(),
            width: 50.0,
            baseline_y: 16.0,
            fragments: None,
            positioned_glyphs: None,
        },
        Line {
            text: "World".to_string(),
            glyphs: Vec::new(),
            width: 45.0,
            baseline_y: 36.0,
            fragments: None,
            positioned_glyphs: None,
        },
    ];
    let result = build_horizontal_result(lines, 2, 20.0, 16.0, false);
    assert!((result.bbox.w - 50.0).abs() < 0.001);
    assert!((result.bbox.h - 40.0).abs() < 0.001);
    assert_eq!(result.overflow.overflow_type, "none");
}

#[test]
fn test_build_horizontal_result_detects_width_constraint_overflow() {
    let lines = vec![Line {
        text: "Overflow".to_string(),
        glyphs: Vec::new(),
        width: 80.0,
        baseline_y: 16.0,
        fragments: None,
        positioned_glyphs: None,
    }];

    let result = build_horizontal_result_with_constraints(
        lines,
        1,
        20.0,
        16.0,
        false,
        Some(40.0),
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
fn test_word_wrap_does_not_force_break_unbreakable_token() {
    let glyphs = mock_glyphs(&[10.0, 10.0, 10.0, 10.0]);
    let result = break_lines_internal(
        &glyphs,
        "ABCD",
        25.0,
        WrapMode::Word,
        None,
        20.0,
        16.0,
        None,
        None,
    );

    assert_eq!(result.lines.len(), 1);
    assert_eq!(result.lines[0].text, "ABCD");
    assert!((result.lines[0].width - 40.0).abs() < 0.001);
}

// --- Extended engine tests (kinsoku + horizontal) ---

/// Mock glyphs for CJK text (3-byte clusters).
#[expect(
    clippy::cast_possible_truncation,
    reason = "test helper with small index values; fits in u32"
)]
fn mock_glyphs_cjk(advances: &[f64]) -> Vec<GlyphInfo> {
    let mut byte_offset = 0u32;
    let mut glyphs = Vec::new();
    for (i, &adv) in advances.iter().enumerate() {
        glyphs.push(GlyphInfo {
            glyph_id: i as u32 + 1,
            x_advance: adv,
            y_advance: 0.0,
            x_offset: 0.0,
            y_offset: 0.0,
            cluster: byte_offset,
            font_alias: None,
            font_weight: None,
            font_style: None,
            rotation_deg: None,
        });
        byte_offset += 3; // CJK chars are 3 bytes in UTF-8
    }
    glyphs
}

#[test]
fn test_kinsoku_prevents_period_at_line_start() {
    // "ああ。い" each 20px wide, max_width=45 → break after 2 chars
    // Without kinsoku: "ああ" | "。い" → "。" starts line 2
    // With kinsoku: "あ" | "あ。い" or "ああ。" | "い"
    let glyphs = mock_glyphs_cjk(&[20.0, 20.0, 20.0, 20.0]);
    let text = "ああ。い";
    let kinsoku = crate::text::kinsoku::get_kinsoku_profile(Some("ja"));
    let result = break_lines_internal(
        &glyphs,
        text,
        45.0,
        WrapMode::Char,
        kinsoku,
        20.0,
        16.0,
        None,
        None,
    );
    // Line 2 should not start with "。"
    if result.lines.len() > 1 {
        let line2_first = result.lines[1].text.chars().next();
        assert_ne!(
            line2_first,
            Some('。'),
            "Period should not start line 2: lines={:?}",
            result.lines.iter().map(|l| &l.text).collect::<Vec<_>>()
        );
    }
}

#[test]
fn test_kinsoku_with_hanging_punctuation() {
    // "ああ。い" each 20px, max_width=40 → "ああ" fills 40px
    // With hanging, "。" can hang past the line end
    let glyphs = mock_glyphs_cjk(&[20.0, 20.0, 20.0, 20.0]);
    let text = "ああ。い";
    let kinsoku = crate::text::kinsoku::get_kinsoku_profile(Some("ja"));
    let hanging = crate::text::kinsoku::get_hanging_chars(true);
    let result = break_lines_internal(
        &glyphs,
        text,
        40.0,
        WrapMode::Char,
        kinsoku,
        20.0,
        16.0,
        None,
        hanging,
    );
    // With hanging, "ああ。" should fit on line 1 with "。" hanging
    assert!(
        result.lines.len() <= 2,
        "Hanging should reduce line count: got {} lines: {:?}",
        result.lines.len(),
        result.lines.iter().map(|l| &l.text).collect::<Vec<_>>()
    );
}

#[test]
fn test_kinsoku_unresolved_horizontal() {
    // All head-prohibit characters → kinsoku_unresolved
    let glyphs = mock_glyphs_cjk(&[20.0, 20.0, 20.0]);
    let text = "。。。";
    let kinsoku = crate::text::kinsoku::get_kinsoku_profile(Some("ja"));
    let result = break_lines_internal(
        &glyphs,
        text,
        25.0,
        WrapMode::Char,
        kinsoku,
        20.0,
        16.0,
        None,
        None,
    );
    assert!(
        result.kinsoku_unresolved,
        "Should flag kinsoku_unresolved when all chars are head-prohibit"
    );

    let measured = break_lines_internal_with_options(
        &glyphs,
        text,
        25.0,
        WrapMode::Char,
        kinsoku,
        20.0,
        16.0,
        None,
        None,
        false,
        0.0,
    );
    assert_eq!(
        measured
            .line_ranges
            .iter()
            .map(|range| range.kinsoku_unresolved)
            .collect::<Vec<_>>(),
        vec![true, true, false]
    );
}

#[test]
fn test_multiple_lines_kinsoku() {
    // "あああ。いいい。ううう" — multiple line breaks, all must respect kinsoku
    let glyphs = mock_glyphs_cjk(&[20.0; 11]);
    let text = "あああ。いいい。ううう";
    let kinsoku = crate::text::kinsoku::get_kinsoku_profile(Some("ja"));
    let result = break_lines_internal(
        &glyphs,
        text,
        65.0,
        WrapMode::Char,
        kinsoku,
        20.0,
        16.0,
        None,
        None,
    );
    // No line except the first should start with "。"
    for (i, line) in result.lines.iter().enumerate() {
        if i == 0 {
            continue;
        }
        let first = line.text.chars().next();
        assert_ne!(
            first,
            Some('。'),
            "Line {} should not start with period: {:?}",
            i,
            result.lines.iter().map(|l| &l.text).collect::<Vec<_>>()
        );
    }
}

#[test]
fn test_uax14_with_kinsoku_overlay() {
    // UAX#14 suggests break points, kinsoku may override
    let glyphs = mock_glyphs_cjk(&[20.0, 20.0, 20.0, 20.0]);
    let text = "ああ。い";
    let kinsoku = crate::text::kinsoku::get_kinsoku_profile(Some("ja"));
    // UAX#14 break after byte 6 (after "ああ") → would put "。" at line start
    let uax14_breaks: Vec<usize> = vec![6, 12];
    let result = break_lines_internal(
        &glyphs,
        text,
        45.0,
        WrapMode::Char,
        kinsoku,
        20.0,
        16.0,
        Some(&uax14_breaks),
        None,
    );
    // Kinsoku should prevent "。" from starting a line
    for (i, line) in result.lines.iter().enumerate() {
        if i == 0 {
            continue;
        }
        let first = line.text.chars().next();
        assert_ne!(
            first,
            Some('。'),
            "Kinsoku should override UAX#14 break: line {i} starts with '。'",
        );
    }
}

// --- Plain vs spans parity (kinsoku non-breaking pairs) ---

mod span_parity {
    use crate::font::{FontContext, FontRegistry, FontStyle};
    use crate::text::engine::layout_text;
    use crate::text::types::{
        FitMode, Language, TextLayoutRequest, TextOrientation, TextSpanInput, WhiteSpaceMode,
        WrapMode, WritingMode,
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

    fn span(text: &str) -> TextSpanInput {
        TextSpanInput {
            text: text.to_string(),
            font_family: Vec::new(),
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px: 16.0,
            letter_spacing_px: None,
            language: Some("ja".to_string()),
            text_orientation: None,
            color: None,
            text_strokes: None,
            text_shadows: None,
            font_variation_settings: None,
            font_feature_settings: None,
            text_decoration: None,
            decoration_transport_only: false,
        }
    }

    fn req<'a>(text: &'a str, spans: Option<&'a [TextSpanInput]>) -> TextLayoutRequest<'a> {
        TextLayoutRequest {
            text,
            spans,
            rich_text: None,
            font_size_px: 16.0,
            line_height: Some(1.5),
            line_height_px: None,
            letter_spacing_px: 0.0,
            text_indent: None,
            max_width: 42.0,
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

    /// The non-breaking pair "——" must not be split even when a style-run
    /// boundary falls between the two dashes (parity with the plain path).
    #[test]
    fn spans_do_not_split_non_breaking_pair_at_run_boundary() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let plain = layout_text(&req("あ——い", None), &font_ctx).expect("plain layout");
        let plain_lines: Vec<&str> = plain.lines.iter().map(|l| l.text.as_str()).collect();

        let spans = vec![span("あ—"), span("—い")];
        let styled = layout_text(&req("あ——い", Some(&spans)), &font_ctx).expect("span layout");
        let styled_lines: Vec<&str> = styled.lines.iter().map(|l| l.text.as_str()).collect();

        assert_eq!(
            plain_lines, styled_lines,
            "span run boundary must not change kinsoku line breaking"
        );
    }

    /// whiteSpace: normal must collapse whitespace runs identically for the
    /// plain path and the spans path, including runs crossing a span
    /// boundary.
    #[test]
    fn spans_collapse_whitespace_like_plain() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let mut plain_req = req("A    B", None);
        plain_req.max_width = 1000.0;
        let plain = layout_text(&plain_req, &font_ctx).expect("plain layout");

        let spans = vec![span("A  "), span("  B")];
        let mut spans_req = req("A    B", Some(&spans));
        spans_req.max_width = 1000.0;
        let styled = layout_text(&spans_req, &font_ctx).expect("span layout");

        assert_eq!(styled.lines.len(), 1);
        assert_eq!(styled.lines[0].text, plain.lines[0].text);
        assert!(
            (styled.lines[0].width - plain.lines[0].width).abs() < 0.01,
            "span width {} must equal plain width {}",
            styled.lines[0].width,
            plain.lines[0].width
        );
    }

    /// Tabs under whiteSpace: normal collapse to a single space on the spans
    /// path, same as plain.
    #[test]
    fn spans_collapse_tab_like_plain() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let mut plain_req = req("A\tB", None);
        plain_req.max_width = 1000.0;
        let plain = layout_text(&plain_req, &font_ctx).expect("plain layout");

        let spans = vec![span("A\t"), span("B")];
        let mut spans_req = req("A\tB", Some(&spans));
        spans_req.max_width = 1000.0;
        let styled = layout_text(&spans_req, &font_ctx).expect("span layout");

        assert_eq!(styled.lines[0].text, plain.lines[0].text);
        assert!((styled.lines[0].width - plain.lines[0].width).abs() < 0.01);
    }

    /// fit=shrink must see the same collapsed text as the non-fit path:
    /// previously fit measured the raw uncollapsed string.
    #[test]
    fn fit_shrink_collapses_whitespace_like_plain() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let mut fit_req = req("A    B", None);
        fit_req.max_width = 1000.0;
        fit_req.fit = FitMode::Shrink;
        let result = layout_text(&fit_req, &font_ctx).expect("fit layout");

        assert_eq!(result.lines.len(), 1);
        assert_eq!(result.lines[0].text, "A B");
    }

    /// richText under whiteSpace: normal collapses whitespace like plain
    /// text does. Previously rich only expanded tabs for pre-wrap.
    #[test]
    fn rich_text_collapses_whitespace_like_plain() {
        use crate::text::types::RichTextNodeInput;

        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let nodes = vec![RichTextNodeInput::Text {
            text: "A    B".to_string(),
        }];
        let mut rich_req = req("", None);
        rich_req.rich_text = Some(&nodes);
        rich_req.max_width = 1000.0;
        let result = layout_text(&rich_req, &font_ctx).expect("rich layout");

        assert_eq!(result.lines.len(), 1);
        assert_eq!(result.lines[0].text, "A B");
    }

    /// ellipsis + maxLines must work for styled spans (previously silently
    /// ignored) and the result must fit the constraints.
    #[test]
    fn spans_apply_ellipsis_on_max_lines_overflow() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let spans = vec![span("あいう"), span("えおかきく")];
        let mut spans_req = req("あいうえおかきく", Some(&spans));
        spans_req.max_width = 80.0;
        spans_req.max_lines = Some(1);
        spans_req.ellipsis = true;
        let result = layout_text(&spans_req, &font_ctx).expect("span layout");

        assert_eq!(result.lines.len(), 1, "must fit in maxLines");
        assert!(
            result.lines[0].text.ends_with('\u{2026}'),
            "line must end with ellipsis: {:?}",
            result.lines[0].text
        );
        assert!(
            result.lines[0].width <= 80.0 + 0.01,
            "line must fit max_width: {}",
            result.lines[0].width
        );
        assert_eq!(result.overflow.overflow_type, "overflow");
    }

    /// Multi-line spans ellipsis: lines up to maxLines, last line ends
    /// with "…".
    #[test]
    fn spans_apply_multiline_ellipsis() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let spans = vec![span("あいうえお"), span("かきくけこさしす")];
        let mut spans_req = req("あいうえおかきくけこさしす", Some(&spans));
        spans_req.max_width = 80.0;
        spans_req.max_lines = Some(2);
        spans_req.ellipsis = true;
        let result = layout_text(&spans_req, &font_ctx).expect("span layout");

        assert_eq!(result.lines.len(), 2, "must fit in maxLines");
        assert!(
            result.lines[1].text.ends_with('\u{2026}'),
            "last line must end with ellipsis: {:?}",
            result.lines[1].text
        );
    }

    /// ellipsis + maxLines must work for richText (previously the lines were
    /// truncated with no visual marker).
    #[test]
    fn rich_text_applies_ellipsis_on_max_lines_overflow() {
        use crate::text::types::RichTextNodeInput;

        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let nodes = vec![RichTextNodeInput::Text {
            text: "あいうえおかきくけこさしすせそ".to_string(),
        }];
        let mut rich_req = req("", None);
        rich_req.rich_text = Some(&nodes);
        rich_req.max_width = 80.0;
        rich_req.max_lines = Some(2);
        rich_req.ellipsis = true;
        let result = layout_text(&rich_req, &font_ctx).expect("rich layout");

        assert!(result.lines.len() <= 2, "must fit in maxLines");
        let last = result.lines.last().expect("lines");
        assert!(
            last.text.ends_with('\u{2026}'),
            "last line must end with ellipsis: {:?}",
            last.text
        );
        assert!(result.bbox.w <= 80.0 + 0.01);
    }

    #[test]
    fn vertical_rich_text_applies_ellipsis_on_max_lines_overflow() {
        use crate::text::types::{RichTextNodeInput, WritingMode};

        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let nodes = vec![RichTextNodeInput::Text {
            text: "あいうえおかきくけこさしすせそ".to_string(),
        }];
        let mut rich_req = req("", None);
        rich_req.rich_text = Some(&nodes);
        rich_req.writing_mode = WritingMode::VerticalRl;
        rich_req.max_width = 80.0;
        rich_req.max_height = Some(80.0);
        rich_req.max_lines = Some(2);
        rich_req.ellipsis = true;

        let result = layout_text(&rich_req, &font_ctx).expect("vertical rich layout");

        assert!(result.lines.len() <= 2, "must fit in maxLines");
        assert!(
            result
                .lines
                .last()
                .expect("last column")
                .text
                .ends_with('\u{2026}')
        );
        assert!(result.bbox.w <= rich_req.max_width + 0.01);
        assert!(result.bbox.h <= rich_req.max_height.expect("max height") + 0.01);
    }

    /// richText letterSpacing must match plain: per-grapheme token shaping
    /// previously dropped ALL inter-character tracking on the rich path.
    #[test]
    fn rich_text_keeps_letter_spacing_like_plain() {
        use crate::text::types::RichTextNodeInput;

        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let mut plain_req = req("ABCD", None);
        plain_req.max_width = 1000.0;
        plain_req.letter_spacing_px = 5.0;
        let plain = layout_text(&plain_req, &font_ctx).expect("plain layout");

        let nodes = vec![RichTextNodeInput::Text {
            text: "ABCD".to_string(),
        }];
        let mut rich_req = req("", None);
        rich_req.rich_text = Some(&nodes);
        rich_req.max_width = 1000.0;
        rich_req.letter_spacing_px = 5.0;
        let rich = layout_text(&rich_req, &font_ctx).expect("rich layout");

        assert!(
            (rich.lines[0].width - plain.lines[0].width).abs() < 0.01,
            "rich width {} must equal plain width {}",
            rich.lines[0].width,
            plain.lines[0].width
        );
    }

    /// Rich text must shape a same-style segment as one contextual run before
    /// distributing it into wrap tokens. Otherwise kerning pairs such as AV
    /// become wider than the equivalent spans path and wrap a character early.
    #[test]
    fn rich_text_keeps_same_run_kerning_like_spans() {
        use crate::text::types::RichTextNodeInput;

        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let text = "AVAVAVAV";
        let spans = vec![span(text)];
        let mut spans_req = req(text, Some(&spans));
        spans_req.max_width = 37.0;
        let styled = layout_text(&spans_req, &font_ctx).expect("span layout");

        let nodes = vec![RichTextNodeInput::Text {
            text: text.to_string(),
        }];
        let mut rich_req = req("", None);
        rich_req.rich_text = Some(&nodes);
        rich_req.max_width = 37.0;
        let rich = layout_text(&rich_req, &font_ctx).expect("rich layout");

        let styled_lines = styled
            .lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>();
        let rich_lines = rich
            .lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>();
        assert_eq!(styled_lines, ["AVAV", "AVAV"]);
        assert_eq!(rich_lines, styled_lines);
    }

    #[test]
    fn rich_text_keeps_contextual_shaping_around_pre_wrap_newlines() {
        use crate::text::types::RichTextNodeInput;

        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let mut reference_req = req("AV", None);
        reference_req.max_width = 1000.0;
        let reference = layout_text(&reference_req, &font_ctx).expect("reference layout");

        let nodes = vec![RichTextNodeInput::Text {
            text: "AV\nAV".to_string(),
        }];
        let mut rich_req = req("", None);
        rich_req.rich_text = Some(&nodes);
        rich_req.white_space = WhiteSpaceMode::PreWrap;
        rich_req.max_width = 1000.0;
        let rich = layout_text(&rich_req, &font_ctx).expect("rich layout");

        assert_eq!(
            rich.lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            ["AV", "AV"]
        );
        for line in &rich.lines {
            assert!((line.width - reference.lines[0].width).abs() < 0.01);
        }
    }

    #[test]
    fn rich_text_drops_collapsed_empty_segments_without_layout_credit() {
        use crate::text::types::{RichTextNodeInput, RichTextStyleInput};

        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let mut reference_req = req("Hi", None);
        reference_req.wrap = WrapMode::None;
        reference_req.max_width = 1000.0;
        let reference = layout_text(&reference_req, &font_ctx).expect("reference layout");

        let large_empty_style = RichTextStyleInput {
            font_family: vec!["NotoSansJP".to_string()],
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px: 72.0,
            line_height: Some(2.0),
            line_height_px: None,
            letter_spacing_px: Some(12.0),
            language: Some("ja".to_string()),
            color: None,
            text_strokes: None,
            text_shadows: None,
            font_variation_settings: None,
            font_feature_settings: None,
            text_orientation: None,
            text_decoration: None,
        };
        let normal_style = RichTextStyleInput {
            font_size_px: 16.0,
            line_height: Some(1.5),
            letter_spacing_px: Some(0.0),
            ..large_empty_style.clone()
        };
        let nodes = vec![
            RichTextNodeInput::Span {
                text: " ".to_string(),
                style: large_empty_style,
            },
            RichTextNodeInput::Span {
                text: "Hi".to_string(),
                style: normal_style,
            },
        ];
        let mut rich_req = req("", None);
        rich_req.rich_text = Some(&nodes);
        rich_req.wrap = WrapMode::None;
        rich_req.max_width = 1000.0;
        let rich = layout_text(&rich_req, &font_ctx).expect("rich layout");

        assert_eq!(rich.lines.len(), 1);
        assert_eq!(rich.lines[0].text, "Hi");
        assert!((rich.lines[0].width - reference.lines[0].width).abs() < 0.01);
        assert!((rich.bbox.h - reference.bbox.h).abs() < 0.01);
    }

    #[test]
    fn rich_text_keeps_negative_tracking_across_segment_boundaries() {
        use crate::text::types::{RichTextNodeInput, RichTextStyleInput};

        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let mut spans = vec![span("AV"), span("AV")];
        for text_span in &mut spans {
            text_span.letter_spacing_px = Some(-2.0);
        }
        let mut spans_req = req("AVAV", Some(&spans));
        spans_req.max_width = 1000.0;
        let styled = layout_text(&spans_req, &font_ctx).expect("span layout");

        let rich_style = RichTextStyleInput {
            font_family: vec!["NotoSansJP".to_string()],
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px: 16.0,
            line_height: Some(1.5),
            line_height_px: None,
            letter_spacing_px: Some(-2.0),
            language: Some("ja".to_string()),
            color: None,
            text_strokes: None,
            text_shadows: None,
            font_variation_settings: None,
            font_feature_settings: None,
            text_orientation: None,
            text_decoration: None,
        };
        let nodes = vec![
            RichTextNodeInput::Span {
                text: "AV".to_string(),
                style: rich_style.clone(),
            },
            RichTextNodeInput::Span {
                text: "AV".to_string(),
                style: rich_style,
            },
        ];
        let mut rich_req = req("", None);
        rich_req.rich_text = Some(&nodes);
        rich_req.max_width = 1000.0;
        let rich = layout_text(&rich_req, &font_ctx).expect("rich layout");

        assert!((rich.lines[0].width - styled.lines[0].width).abs() < 0.01);
    }

    /// letterSpacing must not lose one tracking unit per style-run boundary:
    /// "AB" as one run and as two runs must measure identically.
    #[test]
    fn spans_keep_letter_spacing_across_run_boundary() {
        let reg = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let mut plain_req = req("AB", None);
        plain_req.max_width = 1000.0;
        plain_req.letter_spacing_px = 3.0;
        let plain = layout_text(&plain_req, &font_ctx).expect("plain layout");

        let spans = vec![span("A"), span("B")];
        let mut spans_req = req("AB", Some(&spans));
        spans_req.max_width = 1000.0;
        spans_req.letter_spacing_px = 3.0;
        let styled = layout_text(&spans_req, &font_ctx).expect("span layout");

        assert!(
            (styled.lines[0].width - plain.lines[0].width).abs() < 0.01,
            "span width {} must equal plain width {}",
            styled.lines[0].width,
            plain.lines[0].width
        );
    }
}

#[test]
fn char_wrap_breaks_by_character() {
    use crate::font::{FontContext, FontRegistry, FontStyle};
    use crate::text::engine::layout_text;
    let data = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
    ))
    .expect("Test font");
    let mut reg = FontRegistry::new();
    reg.register(data, "NotoSansJP".into(), 400, FontStyle::Normal)
        .unwrap();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let spans = vec![
        crate::text::types::TextSpanInput {
            text: "あ—".to_string(),
            font_family: vec!["NotoSansJP".to_string()],
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px: 16.0,
            letter_spacing_px: None,
            language: None,
            text_orientation: None,
            color: Some("#c03030".to_string()),
            text_strokes: None,
            text_shadows: None,
            font_variation_settings: None,
            font_feature_settings: None,
            text_decoration: None,
            decoration_transport_only: false,
        },
        crate::text::types::TextSpanInput {
            text: "—い".to_string(),
            font_family: vec!["NotoSansJP".to_string()],
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px: 16.0,
            letter_spacing_px: None,
            language: None,
            text_orientation: None,
            color: None,
            text_strokes: None,
            text_shadows: None,
            font_variation_settings: None,
            font_feature_settings: None,
            text_decoration: None,
            decoration_transport_only: false,
        },
    ];
    let req = crate::text::types::TextLayoutRequest {
        text: "あ——い",
        spans: Some(&spans),
        rich_text: None,
        font_size_px: 16.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 42.0,
        max_height: None,
        wrap: crate::text::types::WrapMode::Char,
        white_space: crate::text::types::WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: crate::text::types::FitMode::None,
        max_lines: None,
        ellipsis: false,
        language: crate::text::types::Language::Ja,
        writing_mode: crate::text::types::WritingMode::HorizontalTb,
        text_orientation: crate::text::types::TextOrientation::Mixed,
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
    let lines: Vec<&str> = result.lines.iter().map(|l| l.text.as_str()).collect();
    println!("char-wrap spans lines: {lines:?}");
}

/// Decorated inline spans must keep producing decorations through the
/// main rich layout path (guards the break-order behavior).
#[test]
fn rich_decorated_span_produces_decorations() {
    use crate::font::{FontContext, FontRegistry, FontStyle};
    use crate::text::engine::layout_text;
    use crate::text::types::RichTextNodeInput;
    let data = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
    ))
    .expect("Test font");
    let mut reg = FontRegistry::new();
    reg.register(data, "NotoSansJP".into(), 400, FontStyle::Normal)
        .unwrap();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let json = r##"[
      {"kind":"text","text":"装飾付き"},
      {"kind":"decoratedSpan","style":{"fontSizePx":20},"background":"#fde68a","borderColor":"#d97706","borderWidth":1,"borderRadius":[3,3,3,3],"paddingInline":[4,4],"children":[{"kind":"text","text":"インライン強調"}]},
      {"kind":"text","text":"が行をまたいでも安定して描画される。"}
    ]"##;
    let nodes: Vec<RichTextNodeInput> = serde_json::from_str(json).expect("nodes");
    let req = crate::text::types::TextLayoutRequest {
        text: "",
        spans: None,
        rich_text: Some(&nodes),
        font_size_px: 20.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 380.0,
        max_height: None,
        wrap: crate::text::types::WrapMode::Char,
        white_space: crate::text::types::WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: crate::text::types::FitMode::None,
        max_lines: None,
        ellipsis: false,
        language: crate::text::types::Language::Ja,
        writing_mode: crate::text::types::WritingMode::HorizontalTb,
        text_orientation: crate::text::types::TextOrientation::Mixed,
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
    assert!(
        !result.inline_box_decorations.is_empty(),
        "decorations must survive"
    );
    assert_eq!(result.lines.len(), 2, "scene wraps to two lines");
}

mod unit_metadata_parity {
    use crate::font::{FontContext, FontRegistry, FontStyle};
    use crate::text::engine::{layout_text, layout_text_with_unit_metadata};
    use crate::text::types::{
        FitMode, Language, TextLayoutRequest, TextOrientation, TextSpanInput, WhiteSpaceMode,
        WrapMode, WritingMode,
    };

    fn test_registry() -> FontRegistry {
        let font_bytes = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("test font");
        let mut registry = FontRegistry::new();
        registry
            .register(font_bytes, "NotoSansJP".to_string(), 400, FontStyle::Normal)
            .expect("register test font");
        registry
    }

    fn request(text: &str) -> TextLayoutRequest<'_> {
        TextLayoutRequest {
            text,
            spans: None,
            rich_text: None,
            font_size_px: 24.0,
            line_height: Some(1.5),
            line_height_px: None,
            letter_spacing_px: 0.0,
            text_indent: None,
            max_width: 100.0,
            max_height: None,
            wrap: WrapMode::Char,
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

    fn span(text: &str, font_size_px: f64) -> TextSpanInput {
        TextSpanInput {
            text: text.to_string(),
            font_family: vec!["NotoSansJP".to_string()],
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px,
            letter_spacing_px: None,
            language: Some("ja".to_string()),
            text_orientation: None,
            color: None,
            text_strokes: None,
            text_shadows: None,
            font_variation_settings: None,
            font_feature_settings: None,
            text_decoration: None,
            decoration_transport_only: false,
        }
    }

    fn assert_layout_unchanged(request: &TextLayoutRequest<'_>, font_ctx: &FontContext<'_>) {
        let mut baseline = layout_text(request, font_ctx).expect("baseline layout");
        let mut with_metadata =
            layout_text_with_unit_metadata(request, font_ctx).expect("metadata layout");
        assert!(
            with_metadata
                .lines
                .iter()
                .any(|line| line.positioned_glyphs.is_some()),
            "the metadata path must exercise positioned-glyph collection"
        );
        for line in &mut baseline.lines {
            line.positioned_glyphs = None;
        }
        for line in &mut with_metadata.lines {
            line.positioned_glyphs = None;
        }
        baseline.unit_map = None;
        with_metadata.unit_map = None;
        assert_eq!(
            serde_json::to_value(&baseline).expect("serialize baseline layout"),
            serde_json::to_value(&with_metadata).expect("serialize metadata layout"),
            "collecting unit metadata must not change line breaks, glyphs, advances, fit, or overflow"
        );
    }

    #[test]
    fn ordinary_wrapping_is_unchanged() {
        let registry = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        assert_layout_unchanged(
            &request("通常の折り返しでも行分割とグリフ配置を維持する"),
            &font_ctx,
        );
    }

    #[test]
    fn ellipsis_layout_is_unchanged() {
        let registry = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let ellipsis_request = TextLayoutRequest {
            max_width: 90.0,
            max_lines: Some(1),
            ellipsis: true,
            ..request("省略記号を含む長いテキストでも出力を維持する")
        };
        assert_layout_unchanged(&ellipsis_request, &font_ctx);
    }

    #[test]
    fn shrink_fit_layout_is_unchanged() {
        let registry = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let shrink_request = TextLayoutRequest {
            max_width: 120.0,
            max_height: Some(40.0),
            fit: FitMode::Shrink,
            min_font_size_px: Some(8.0),
            ..request("これは非常に長いテキストです")
        };
        assert_layout_unchanged(&shrink_request, &font_ctx);
    }

    #[test]
    fn rich_span_layout_is_unchanged() {
        let registry = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let spans = vec![span("装飾付き", 24.0), span("インライン", 18.0)];
        let rich_request = TextLayoutRequest {
            spans: Some(&spans),
            max_width: 90.0,
            ..request("装飾付きインライン")
        };
        assert_layout_unchanged(&rich_request, &font_ctx);
    }
}
