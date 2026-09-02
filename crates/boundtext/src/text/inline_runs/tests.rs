#[cfg(test)]
#[expect(
    clippy::module_inception,
    reason = "this test file is included as the inline_runs::tests module"
)]
mod tests {
    use crate::font::{FontContext, FontRegistry, FontStyle};
    use crate::text::inline_runs::{RunSegment, apply_inline_fragments, shape_inline_runs};
    use crate::text::types::{Line, TextOrientation, TextSpanInput};

    fn fixture_registry(alias: &str) -> FontRegistry {
        let mut registry = FontRegistry::new();
        registry
            .register(
                std::fs::read(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
                ))
                .expect("fixture font"),
                alias.to_string(),
                400,
                FontStyle::Normal,
            )
            .expect("register fixture font");
        registry
    }

    fn mock_span(text: &str, font_size_px: f64) -> TextSpanInput {
        TextSpanInput {
            text: text.to_string(),
            font_family: Vec::new(),
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px,
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
        }
    }

    #[test]
    fn test_shape_inline_runs_empty() {
        let spans: Vec<TextSpanInput> = Vec::new();
        let registry = FontRegistry::new();
        let families: Vec<String> = Vec::new();
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let (glyphs, segments) =
            shape_inline_runs(&spans, &font_ctx, 0.0).expect("inline runs should shape");
        assert!(glyphs.is_empty());
        assert!(segments.is_empty());
    }

    #[test]
    fn test_run_segments_grapheme_tracking() {
        let spans = vec![mock_span("Hello", 16.0), mock_span(" World", 20.0)];
        let registry = fixture_registry("TestFont");
        let families = vec!["TestFont".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let (_glyphs, segments) =
            shape_inline_runs(&spans, &font_ctx, 0.0).expect("inline runs should shape");
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].start, 0);
        assert_eq!(segments[0].end, 5); // "Hello" = 5 graphemes
        assert_eq!(segments[1].start, 5);
        assert_eq!(segments[1].end, 11); // " World" = 6 graphemes
    }

    #[test]
    fn test_apply_inline_fragments_no_segments() {
        let mut lines = vec![Line {
            text: "Hello".to_string(),
            glyphs: Vec::new(),
            width: 50.0,
            baseline_y: 16.0,
            fragments: None,
            positioned_glyphs: None,
        }];
        let segments: Vec<RunSegment> = Vec::new();
        let registry = FontRegistry::new();
        apply_inline_fragments(&mut lines, &segments, &registry, None)
            .expect("inline fragments should shape");
        assert!(lines[0].fragments.is_none());
    }

    #[test]
    fn test_apply_inline_fragments_preserves_span_style() {
        let spans = vec![TextSpanInput {
            text: "AB".to_string(),
            font_family: vec!["TestFont".to_string(), "FallbackFont".to_string()],
            font_weight: 700,
            font_style: FontStyle::Italic,
            font_size_px: 18.0,
            letter_spacing_px: Some(1.5),
            language: Some("ja".to_string()),
            text_orientation: Some("upright".to_string()),
            color: Some("#ff0000".to_string()),
            text_strokes: None,
            text_shadows: None,
            font_variation_settings: Some("\"wght\" 700".to_string()),
            font_feature_settings: None,
            text_decoration: None,
            decoration_transport_only: false,
        }];
        let registry = fixture_registry("TestFont");
        let families = vec!["TestFont".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let (_glyphs, segments) =
            shape_inline_runs(&spans, &font_ctx, 0.0).expect("inline runs should shape");
        let mut lines = vec![Line {
            text: "AB".to_string(),
            glyphs: Vec::new(),
            width: 0.0,
            baseline_y: 16.0,
            fragments: None,
            positioned_glyphs: None,
        }];

        apply_inline_fragments(&mut lines, &segments, &registry, None)
            .expect("inline fragments should shape");

        let fragment = &lines[0]
            .fragments
            .as_ref()
            .and_then(|fragments| fragments.first())
            .expect("expected fragment")
            .style;

        assert_eq!(fragment.font, "TestFont");
        assert_eq!(fragment.fallback, vec!["FallbackFont".to_string()]);
        assert_eq!(fragment.font_weight, 700);
        assert_eq!(fragment.font_style, FontStyle::Italic);
        assert_eq!(fragment.font_size_px, 18.0);
        assert_eq!(fragment.letter_spacing_px, 1.5);
        assert_eq!(fragment.text_orientation, Some(TextOrientation::Upright));
        assert_eq!(
            fragment.font_variation_settings.as_deref(),
            Some("\"wght\" 700")
        );
        assert_eq!(fragment.color.as_deref(), Some("#ff0000"));
        assert_eq!(fragment.language.as_deref(), Some("ja"));
    }
}
