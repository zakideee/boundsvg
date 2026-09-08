//! Raw-flow normalization and independent glyph projection contracts.

use boundtext::font::shaping::ShapeOptions;
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::engine::project_legacy_unwrapped_glyphs;
use boundtext::text::flow::{FlowSimpleRequest, RawFlowSimpleRequest, layout_raw_flow_simple};
use boundtext::text::types::{Language, TextOrientation, WhiteSpaceMode, WrapMode, WritingMode};

fn font_registry() -> FontRegistry {
    let font_bytes = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
    ))
    .expect("licensed text fixture");
    let mut registry = FontRegistry::new();
    registry
        .register(font_bytes, "NotoSansJP".into(), 400, FontStyle::Normal)
        .expect("register text fixture");
    registry
}

#[test]
fn raw_flow_preserves_whitespace_policy_and_normalized_ranges() {
    let registry = font_registry();
    let families = ["NotoSansJP".into()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let expected_lines = [
        (
            WhiteSpaceMode::Normal,
            vec![
                ("A B あいうえ", 0, 8),
                ("お Hello ", 8, 16),
                ("world", 16, 21),
            ],
        ),
        (
            WhiteSpaceMode::NoWrap,
            vec![("A B あいうえお Hello world", 0, 21)],
        ),
        (
            WhiteSpaceMode::PreWrap,
            vec![
                (" A     B", 0, 8),
                ("あいうえ", 9, 13),
                ("お Hello world  ", 13, 28),
            ],
        ),
    ];
    for (white_space, expected) in expected_lines {
        let request = RawFlowSimpleRequest {
            flow: FlowSimpleRequest {
                text: " A\t B\r\nあいうえお Hello world  ",
                font_size_px: 20.0,
                line_height: Some(1.5),
                letter_spacing_px: 0.0,
                language: Language::Auto,
                wrap: WrapMode::Char,
                hanging_punctuation: false,
                line_widths: &[120.0, 80.0, 160.0, 160.0],
                writing_mode: WritingMode::HorizontalTb,
                text_orientation: TextOrientation::Mixed,
                font_variation_settings: Vec::new(),
                font_feature_settings: Vec::new(),
            },
            white_space,
            tab_size: 4,
        };
        let flow_layout = layout_raw_flow_simple(&request, &font_context).expect("raw flow");
        let actual = flow_layout
            .lines
            .iter()
            .map(|line| (line.text.as_str(), line.char_start, line.char_end))
            .collect::<Vec<_>>();
        assert_eq!(actual, expected);
        assert!(flow_layout.exhausted);
    }
}

#[test]
fn legacy_projection_preserves_raw_controls_and_authored_advance() {
    let registry = font_registry();
    let primary_registry = FontRegistry::new();
    let families = ["AbsentFamily".into(), "NotoSansJP".into()];
    let font_context = FontContext {
        registry: &primary_registry,
        fallback_registry: Some(&registry),
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let projection = project_legacy_unwrapped_glyphs(
        " A\t B\r\nHello あいうえお  ",
        20.0,
        0.0,
        &ShapeOptions {
            language: Some("ja".into()),
            ..ShapeOptions::default()
        },
        &font_context,
    )
    .expect("first face resolved from fallback registry");
    assert_eq!(projection.measured_width, 256.82);
    assert_eq!(
        projection
            .glyphs
            .iter()
            .map(|glyph| glyph.glyph_id)
            .collect::<Vec<_>>(),
        [
            1, 34, 0, 1, 35, 0, 0, 41, 70, 77, 77, 80, 1, 311, 313, 315, 317, 319, 1, 1
        ]
    );
    assert_eq!(projection.glyphs[13].cluster, 13);
    assert_eq!(projection.glyphs[14].cluster, 16);
    let unresolved_context = FontContext {
        fallback_registry: None,
        ..font_context
    };
    assert!(
        project_legacy_unwrapped_glyphs(
            "text",
            20.0,
            0.0,
            &ShapeOptions::default(),
            &unresolved_context
        )
        .is_none()
    );
}

#[test]
fn legacy_projection_does_not_select_a_fallback_face_per_glyph() {
    let mut registry = font_registry();
    registry
        .register(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../fixtures/fonts/Inter-Variable.ttf"
            ))
            .expect("licensed Latin fixture"),
            "Inter".into(),
            400,
            FontStyle::Normal,
        )
        .expect("register Latin fixture");
    let families = ["Inter".into(), "NotoSansJP".into()];
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let projection =
        project_legacy_unwrapped_glyphs("Aあ", 20.0, 0.0, &ShapeOptions::default(), &font_context)
            .expect("first face");
    assert!(projection.glyphs.iter().any(|glyph| glyph.glyph_id == 0));
    assert!(
        projection
            .glyphs
            .iter()
            .all(|glyph| glyph.font_alias.as_deref() == Some("Inter"))
    );
}
