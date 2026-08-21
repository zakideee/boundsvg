use super::*;
use crate::font::{FontRegistry, FontStyle};
use crate::text::types::{FitMode, TextOrientation, WhiteSpaceMode, WrapMode, WritingMode};

use super::common::{DEFAULT_MIN_FONT_SIZE, text_fits};
use crate::font::FontContext;
use crate::text::types::{Language, Line, TextLayoutRequest};

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

fn make_req(
    text: &str,
    font_size_px: f64,
    max_width: f64,
    max_height: Option<f64>,
) -> TextLayoutRequest<'_> {
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
        max_height,
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

#[test]
fn test_text_fits_within_width() {
    let lines = vec![Line {
        text: "AB".into(),
        glyphs: vec![],
        width: 50.0,
        baseline_y: 16.0,
        fragments: None,
        positioned_glyphs: None,
    }];
    assert!(text_fits(&lines, 100.0, None, None, 20.0));
    assert!(!text_fits(&lines, 40.0, None, None, 20.0));
}

#[test]
fn test_text_fits_max_lines() {
    let lines = vec![
        Line {
            text: "A".into(),
            glyphs: vec![],
            width: 10.0,
            baseline_y: 0.0,
            fragments: None,
            positioned_glyphs: None,
        },
        Line {
            text: "B".into(),
            glyphs: vec![],
            width: 10.0,
            baseline_y: 20.0,
            fragments: None,
            positioned_glyphs: None,
        },
        Line {
            text: "C".into(),
            glyphs: vec![],
            width: 10.0,
            baseline_y: 40.0,
            fragments: None,
            positioned_glyphs: None,
        },
    ];
    assert!(text_fits(&lines, 100.0, Some(3), None, 20.0));
    assert!(!text_fits(&lines, 100.0, Some(2), None, 20.0));
}

#[test]
fn test_text_fits_max_height() {
    let lines = vec![
        Line {
            text: "A".into(),
            glyphs: vec![],
            width: 10.0,
            baseline_y: 0.0,
            fragments: None,
            positioned_glyphs: None,
        },
        Line {
            text: "B".into(),
            glyphs: vec![],
            width: 10.0,
            baseline_y: 20.0,
            fragments: None,
            positioned_glyphs: None,
        },
    ];
    // 2 lines * 20px = 40px
    assert!(text_fits(&lines, 100.0, None, Some(50.0), 20.0));
    assert!(!text_fits(&lines, 100.0, None, Some(30.0), 20.0));
}

#[test]
fn test_fit_shrink_reduces_font_size() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    // Long text that overflows at 24px in 120px width
    let req = make_req("これは非常に長いテキストです", 24.0, 120.0, Some(40.0));
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let result = fit_shrink(&req, &font_ctx, None, None, None);
    let result = result.expect("should produce a result");
    assert!(result.chosen_font_size_px < 24.0, "font size should shrink");
    assert!(
        result.chosen_font_size_px >= DEFAULT_MIN_FONT_SIZE,
        "should not go below min"
    );
    assert_eq!(result.overflow.overflow_type, "none");
}

#[test]
fn test_fit_shrink_cannot_fit() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    // Very tight constraints — cannot fit even at min size
    let req = make_req(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        24.0,
        30.0,
        Some(30.0),
    );
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let result = fit_shrink(&req, &font_ctx, Some(8.0), None, None);
    let result = result.expect("should produce a result");
    assert_eq!(result.overflow.overflow_type, "cannot_fit");
}

#[test]
fn test_fit_grow_increases_font_size() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    // Short text with plenty of room
    let req = make_req("短い", 12.0, 200.0, Some(200.0));
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let result = fit_grow(&req, &font_ctx, None, None, None);
    let result = result.expect("should produce a result");
    assert!(result.chosen_font_size_px > 12.0, "font size should grow");
    assert_eq!(result.overflow.overflow_type, "none");
}

#[test]
fn test_fit_grow_respects_max_font_size() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let req = make_req("短い", 12.0, 200.0, Some(200.0));
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let result = fit_grow(&req, &font_ctx, Some(24.0), None, None);
    let result = result.expect("should produce a result");
    assert!(
        result.chosen_font_size_px <= 24.25,
        "should not exceed max + epsilon"
    );
}

#[test]
fn fit_ranges_cannot_invert_the_requested_operation() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let grow_req = make_req("短い", 16.0, 200.0, Some(200.0));
    let grown = fit_grow(&grow_req, &font_ctx, Some(8.0), None, None).expect("grow layout");
    assert_eq!(grown.chosen_font_size_px, 16.0);

    let shrink_req = make_req("これは非常に長いテキストです", 24.0, 40.0, Some(30.0));
    let shrunk = fit_shrink(&shrink_req, &font_ctx, Some(48.0), None, None).expect("shrink layout");
    assert_eq!(shrunk.chosen_font_size_px, 24.0);
}

#[test]
fn test_fit_shrink_stays_within_bbox() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let req = make_req("あいうえおかきくけこさしすせそ", 24.0, 120.0, Some(60.0));
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let result = fit_shrink(&req, &font_ctx, None, None, None);
    let result = result.expect("should produce a result");
    assert!(
        result.bbox.w <= 120.0 + 1.0,
        "width should fit within max_width"
    );
    assert!(
        result.bbox.h <= 60.0 + 1.0,
        "height should fit within max_height"
    );
}

// -----------------------------------------------------------------------
// New tests for boundary evaluation and break consistency
// -----------------------------------------------------------------------

/// Verify that fit=Shrink uses the same break conditions as fit=None.
/// When shrink settles at the same font size, line breaks must match.
#[test]
fn test_fit_shrink_uses_same_break_conditions_as_normal() {
    use crate::text::engine::layout_text;

    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    // Text that fits at 16px in 200px width — shrink should keep 16px
    let mut req = make_req("あいうえお", 16.0, 200.0, Some(200.0));
    req.hanging_punctuation = true;

    // Normal layout (fit=None)
    let normal = layout_text(&req, &font_ctx).expect("normal layout");

    // Shrink layout — should also fit at 16px since text fits
    let shrink = fit_shrink(&req, &font_ctx, Some(8.0), None, None).expect("shrink layout");

    assert_eq!(
        normal.lines.len(),
        shrink.lines.len(),
        "line count must match between fit=None and fit=Shrink at same size"
    );
    for (i, (n, s)) in normal.lines.iter().zip(&shrink.lines).enumerate() {
        assert_eq!(
            n.text, s.text,
            "line {i} text must match between fit=None and fit=Shrink"
        );
    }
}

/// Grow must report overflow (not "none") when initial size doesn't fit.
#[test]
fn test_grow_initial_overflow_not_none() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    // Long text that doesn't fit at 24px in 50px width
    let req = make_req("あいうえおかきくけこさしすせそ", 24.0, 50.0, Some(30.0));
    let result = fit_grow(&req, &font_ctx, None, None, None).expect("should produce a result");

    assert_ne!(
        result.overflow.overflow_type, "none",
        "grow must not return overflow=none when initial size doesn't fit"
    );
}

/// Shrink + ellipsis: when min size doesn't fit, ellipsis fallback fires.
#[test]
fn test_shrink_ellipsis_fallback() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let mut req = make_req(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        24.0,
        80.0,
        Some(30.0),
    );
    req.ellipsis = true;
    req.max_lines = Some(1);

    let result =
        fit_shrink(&req, &font_ctx, Some(8.0), None, None).expect("should produce a result");

    // Should have applied ellipsis, not cannot_fit
    assert_eq!(
        result.overflow.overflow_type, "overflow",
        "should report overflow (ellipsis applied), not cannot_fit"
    );
    assert!(
        result.lines[0].text.ends_with('\u{2026}'),
        "last line should end with ellipsis: {}",
        result.lines[0].text
    );
}

/// Shrink without ellipsis: when min size doesn't fit, report `cannot_fit`.
#[test]
fn test_shrink_cannot_fit_without_ellipsis() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let req = make_req(
        "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ",
        24.0,
        30.0,
        Some(30.0),
    );

    let result =
        fit_shrink(&req, &font_ctx, Some(8.0), None, None).expect("should produce a result");

    assert_eq!(
        result.overflow.overflow_type, "cannot_fit",
        "should report cannot_fit when ellipsis is disabled"
    );
}

/// When initial size already fits, shrink returns it without searching.
#[test]
fn test_shrink_returns_early_when_fits() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let req = make_req("短い", 16.0, 200.0, Some(200.0));
    let result =
        fit_shrink(&req, &font_ctx, Some(8.0), None, None).expect("should produce a result");

    assert!(
        (result.chosen_font_size_px - 16.0).abs() < 0.01,
        "should keep original size when it fits: {}",
        result.chosen_font_size_px
    );
    assert_eq!(result.overflow.overflow_type, "none");
}

/// Shrink+ellipsis must still respect `max_height` after truncation.
#[test]
fn test_shrink_ellipsis_fallback_respects_max_height() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let mut req = make_req("あいうえおかきくけこさしすせそ", 24.0, 80.0, Some(6.0));
    req.ellipsis = true;
    req.max_lines = Some(1);

    let result =
        fit_shrink(&req, &font_ctx, Some(8.0), None, None).expect("should produce a result");

    assert_eq!(
        result.overflow.overflow_type, "cannot_fit",
        "ellipsis fallback must not bypass max_height"
    );
}

/// Shrink+ellipsis without `max_lines` must not force single-line truncation.
#[test]
fn test_shrink_ellipsis_fallback_requires_explicit_max_lines() {
    let reg = test_registry();
    let families = vec!["NotoSansJP".to_string()];
    let font_ctx = FontContext {
        registry: &reg,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let mut req = make_req("あいうえおかきくけこさしすせそ", 24.0, 80.0, Some(6.0));
    req.ellipsis = true;
    req.max_lines = None;

    let result =
        fit_shrink(&req, &font_ctx, Some(8.0), None, None).expect("should produce a result");

    assert_eq!(
        result.overflow.overflow_type, "cannot_fit",
        "ellipsis fallback must follow normal-path semantics when max_lines is None"
    );
}
