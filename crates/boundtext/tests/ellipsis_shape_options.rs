//! Ellipsis truncation must be measured with the caller's shaping options.
//!
//! `apply_ellipsis` used to shape the text, the "…", and every binary-search
//! candidate with `ShapeOptions::default()`, so `fontVariationSettings` and
//! `fontFeatureSettings` were dropped: the body was shaped at the requested
//! weight while the truncation point was measured at the default weight. The
//! kept line then overflowed its box (measured 389.32px against a 400px limit
//! while actually rendering 418.88px wide).

// Integration tests always build with `cfg(test)`; declaring it lets clippy's
// `allow-*-in-tests` config apply to helper functions in this file.
#![cfg(test)]

use boundtext::font::shaping::{ShapeOptions, VariationSetting, shape_with_fallback_and_options};
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::engine::layout_text;
use boundtext::text::types::{
    FitMode, Language, TextLayoutRequest, TextOrientation, WhiteSpaceMode, WrapMode, WritingMode,
};

const FONT_SIZE_PX: f64 = 48.0;
/// Inline constraint that forces the fixture through ellipsis projection.
const WIDTH_MAX: f64 = 430.0;
const TEXT: &str = "The quick brown fox jumps over the lazy dog";

fn variable_font_registry() -> FontRegistry {
    let mut registry = FontRegistry::new();
    registry
        .register(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../fixtures/fonts/Inter-Variable.ttf"
            ))
            .expect("Inter-Variable.ttf not found"),
            "VF".into(),
            400,
            FontStyle::Normal,
        )
        .unwrap();
    registry
}

fn heavy() -> Vec<VariationSetting> {
    vec![VariationSetting {
        tag: "wght".into(),
        value: 900.0,
    }]
}

fn ellipsis_request(variations: Vec<VariationSetting>) -> TextLayoutRequest<'static> {
    TextLayoutRequest {
        text: TEXT,
        spans: None,
        rich_text: None,
        font_size_px: FONT_SIZE_PX,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: WIDTH_MAX,
        max_height: None,
        wrap: WrapMode::Word,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: Some(1),
        ellipsis: true,
        language: Language::En,
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: TextOrientation::Mixed,
        uax14_breaks: None,
        hanging_punctuation: false,
        font_variation_settings: variations,
        font_feature_settings: vec![],
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
fn single_line_ellipsis_fits_the_box_at_the_requested_variation() {
    let registry = variable_font_registry();
    let families = vec!["VF".to_string()];
    let font_ctx = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let result = layout_text(&ellipsis_request(heavy()), &font_ctx).expect("layout");
    let line = result.lines.first().expect("one line");

    // Re-shape the kept line the way it will actually render (wght = 900).
    let options = ShapeOptions {
        font_variation_settings: heavy(),
        ..ShapeOptions::default()
    };
    let shaped =
        shape_with_fallback_and_options(&font_ctx, &line.text, FONT_SIZE_PX, 0.0, &options);
    let rendered_width: f64 = shaped.glyphs.iter().map(|glyph| glyph.x_advance).sum();

    assert!(
        rendered_width <= WIDTH_MAX,
        "ellipsized line overflows its box by {:.2}px: truncation was measured without the variation settings",
        rendered_width - WIDTH_MAX,
    );
    assert!(
        (line.width - rendered_width).abs() < 0.5,
        "reported width {:.2} disagrees with the rendered width {rendered_width:.2}",
        line.width,
    );
}

#[test]
fn ellipsis_truncation_depends_on_the_variation_settings() {
    let registry = variable_font_registry();
    let families = vec!["VF".to_string()];
    let font_ctx = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let light = layout_text(&ellipsis_request(vec![]), &font_ctx).expect("layout");
    let bold = layout_text(&ellipsis_request(heavy()), &font_ctx).expect("layout");

    let light_line = light.lines.first().expect("one line");
    let bold_line = bold.lines.first().expect("one line");

    // A heavier weight is wider, so fewer graphemes survive the same box.
    assert_ne!(
        light_line.text, bold_line.text,
        "fontVariationSettings had no effect on the ellipsis truncation point",
    );
    assert!(bold_line.text.chars().count() < light_line.text.chars().count());
}
