//! Public rich-flow ellipsis projection invariants.

#![cfg(test)]

use boundtext::font::shaping::ShapeOptions;
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::flow::{
    FlowBounds, FlowLayoutRequest, FlowRegionSource, layout_flow_with_regions,
};
use boundtext::text::types::{Language, RichTextNodeInput, WhiteSpaceMode, WrapMode, WritingMode};

struct RectRegions {
    width: f64,
    height: f64,
}

impl FlowRegionSource for RectRegions {
    fn line_regions(&self, band_top: f64, band_bottom: f64, min_width: f64) -> Vec<(f64, f64)> {
        if band_top >= 0.0 && band_bottom <= self.height && self.width >= min_width {
            vec![(0.0, self.width)]
        } else {
            Vec::new()
        }
    }

    fn column_regions(&self, left: f64, right: f64, min_height: f64) -> Vec<(f64, f64)> {
        if left >= 0.0 && right <= self.width && self.height >= min_height {
            vec![(0.0, self.height)]
        } else {
            Vec::new()
        }
    }
}

fn font_registry() -> FontRegistry {
    let mut registry = FontRegistry::new();
    registry
        .register(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
            ))
            .expect("fixture font"),
            "Noto".to_string(),
            400,
            FontStyle::Normal,
        )
        .expect("register fixture font");
    registry
}

#[test]
fn rich_flow_ellipsis_is_a_source_less_synthetic_glyph() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    let rich_text = vec![RichTextNodeInput::Text {
        text: "あいうえおかきくけこさしすせそ".to_string(),
    }];
    let regions = RectRegions {
        width: 72.0,
        height: 200.0,
    };
    let request = FlowLayoutRequest {
        text: "",
        font_size_px: 24.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        language: Language::Ja,
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        hanging_punctuation: false,
        flow_bounds: FlowBounds {
            x: 0.0,
            y: 0.0,
            width: regions.width,
            height: regions.height,
        },
        min_region_width: None,
        max_lines: Some(1),
        ellipsis: true,
        fit: None,
        spans: None,
        rich_text: Some(&rich_text),
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: None,
        min_font_size_px: None,
        max_font_size_px: None,
        fit_epsilon_px: None,
        fit_max_iterations: None,
        shape_options: ShapeOptions::default(),
    };

    let result =
        layout_flow_with_regions(&request, &font_context, &regions).expect("rich flow layout");
    let marker = result
        .lines
        .iter()
        .flat_map(|line| &line.fragments)
        .flat_map(|fragment| &fragment.positioned_glyphs)
        .find(|glyph| glyph.text == "\u{2026}")
        .expect("ellipsis glyph");

    assert_eq!(marker.synthetic_kind.as_deref(), Some("ellipsis"));
    assert_eq!(marker.source_start, None);
    assert_eq!(marker.source_end, None);
    assert_eq!(marker.source_role, None);
}
