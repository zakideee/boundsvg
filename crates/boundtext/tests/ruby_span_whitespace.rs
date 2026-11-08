//! Check Ruby-bearing span whitespace against literal token and advance oracles.

#![cfg(test)]

use boundtext::font::shaping::{ShapeOptions, shape_text_with_options};
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::flow::{
    FitSearchKind, FlowBounds, FlowLayoutRequest, FlowLayoutResult, FlowRegion, FlowTextSpan,
    RegionProvider, RegionQuery, layout_flow_with_regions,
};
use boundtext::text::shrinkwrap::{
    FlowShrinkwrapRequest, ShrinkwrapConfig, ShrinkwrapRegionProvider, shrinkwrap_flow,
};
use boundtext::text::types::{
    Language, RichTextNodeInput, RichTextStyleInput, WhiteSpaceMode, WrapMode, WritingMode,
};

/// Keep font fitting at an authored size whose independent glyph facts are known.
const FONT_SIZE_PX: f64 = 20.0;
/// Leave every literal line, including an ellipsis, narrower than the flow frame.
const FRAME_WIDTH_PX: f64 = 200.0;
/// Compare advances below a font-unit step without weakening containment policy.
const ADVANCE_EPSILON_PX: f64 = 1e-8;

#[derive(Clone, Copy, Debug)]
enum Surface {
    Flow {
        white_space: WhiteSpaceMode,
        shrink: bool,
        ellipsis: bool,
    },
    // This existing API has no white-space, font-fit, or ellipsis options.
    Shrinkwrap,
}

struct RectangleRegions {
    bounds: FlowBounds,
}

fn regions(bounds: FlowBounds, query: RegionQuery) -> Vec<FlowRegion> {
    if query.cross_end_px <= bounds.y + bounds.height && bounds.width >= query.min_inline_size_px {
        vec![FlowRegion {
            inline_start_px: bounds.x,
            inline_size_px: bounds.width,
        }]
    } else {
        Vec::new()
    }
}

impl RegionProvider for RectangleRegions {
    fn regions(
        &self,
        query: RegionQuery,
    ) -> Result<Vec<FlowRegion>, boundtext::RegionProviderError> {
        Ok(regions(self.bounds, query))
    }

    fn fit_search_kind(&self) -> FitSearchKind {
        FitSearchKind::CertifiedMonotone
    }
}

impl ShrinkwrapRegionProvider for RectangleRegions {
    fn regions(
        &self,
        bounds: FlowBounds,
        query: RegionQuery,
    ) -> Result<Vec<FlowRegion>, boundtext::RegionProviderError> {
        Ok(regions(bounds, query))
    }
}

fn registry() -> FontRegistry {
    let mut registry = FontRegistry::new();
    registry
        .register(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
            ))
            .expect("Japanese fixture"),
            "Noto".to_string(),
            400,
            FontStyle::Normal,
        )
        .expect("register fixture");
    registry
}

fn style(size: f64) -> RichTextStyleInput {
    serde_json::from_value(serde_json::json!({
        "fontFamily": ["Noto"], "fontWeight": 400, "fontSizePx": size,
        "lineHeight": 1.0,
    }))
    .expect("fixture style")
}

fn authored_inputs() -> (Vec<FlowTextSpan>, Vec<RichTextNodeInput>) {
    let mut annotated = FlowTextSpan::plain("漢字".to_string());
    annotated.ruby_text = Some("かんじ".to_string());
    annotated.ruby_font_size_px = Some(10.0);
    let spans = vec![
        FlowTextSpan::plain("前 ".to_string()),
        FlowTextSpan::plain(" \t".to_string()),
        annotated,
        FlowTextSpan::plain("\n ".to_string()),
        FlowTextSpan::plain("\t後".to_string()),
    ];
    let segment = |text: &str| RichTextNodeInput::Span {
        text: text.to_string(),
        style: style(FONT_SIZE_PX),
    };
    let rich = vec![
        segment("前 "),
        segment(" \t"),
        RichTextNodeInput::Ruby {
            ruby_position: None,
            ruby_align: None,
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: style(FONT_SIZE_PX),
            base: vec![RichTextNodeInput::Text {
                text: "漢字".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "かんじ".to_string(),
                style: style(10.0),
            }],
            rt_levels: Vec::new(),
        },
        segment("\n "),
        segment("\t後"),
    ];
    (spans, rich)
}

fn flow_request<'a>(
    spans: Option<&'a [FlowTextSpan]>,
    rich: Option<&'a [RichTextNodeInput]>,
    white_space: WhiteSpaceMode,
    shrink: bool,
    ellipsis: bool,
) -> FlowLayoutRequest<'a> {
    FlowLayoutRequest {
        text: "",
        font_size_px: FONT_SIZE_PX,
        line_height: Some(1.0),
        line_height_px: None,
        letter_spacing_px: 0.0,
        language: Language::Ja,
        wrap: WrapMode::Char,
        white_space,
        tab_size: 4,
        hanging_punctuation: false,
        flow_bounds: FlowBounds {
            x: 0.0,
            y: 0.0,
            width: FRAME_WIDTH_PX,
            height: 400.0,
        },
        min_region_width: None,
        max_lines: ellipsis.then_some(1),
        ellipsis,
        fit: shrink.then_some("shrink"),
        spans,
        rich_text: rich,
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: None,
        min_font_size_px: Some(FONT_SIZE_PX),
        max_font_size_px: None,
        fit_epsilon_px: Some(0.25),
        fit_max_iterations: Some(12),
        fit_max_probes: None,
        shape_options: ShapeOptions::default(),
    }
}

fn resolve(
    surface: Surface,
    spans: Option<&[FlowTextSpan]>,
    rich: Option<&[RichTextNodeInput]>,
    context: &FontContext<'_>,
) -> FlowLayoutResult {
    let provider = RectangleRegions {
        bounds: FlowBounds {
            x: 0.0,
            y: 0.0,
            width: FRAME_WIDTH_PX,
            height: 400.0,
        },
    };
    match surface {
        Surface::Flow {
            white_space,
            shrink,
            ellipsis,
        } => layout_flow_with_regions(
            &flow_request(spans, rich, white_space, shrink, ellipsis),
            context,
            &provider,
        )
        .expect("flow whitespace table"),
        Surface::Shrinkwrap => {
            let request = FlowShrinkwrapRequest {
                text: "",
                spans,
                rich_text: rich,
                font_size_px: FONT_SIZE_PX,
                line_height: Some(1.0),
                line_height_px: None,
                letter_spacing_px: 0.0,
                language: Language::Ja,
                wrap: WrapMode::Char,
                hanging_punctuation: false,
                writing_mode: WritingMode::HorizontalTb,
                shape_options: ShapeOptions::default(),
                flow_bounds: provider.bounds,
                min_region_width: None,
                max_lines: Some(2),
                min_width: Some(120.0),
                min_height: None,
                target_line_count: Some(2),
                config: ShrinkwrapConfig::default(),
            };
            let result =
                shrinkwrap_flow(&request, context, &provider).expect("shrinkwrap whitespace table");
            let width = result.chosen_width_px.expect("feasible shrinkwrap width");
            assert!((120.0..=120.25).contains(&width));
            result.layout
        }
    }
}

fn literal_rows(surface: Surface, space: f64, marker: f64) -> Vec<Vec<(&'static str, usize, f64)>> {
    if matches!(
        surface,
        Surface::Flow {
            white_space: WhiteSpaceMode::Normal,
            ..
        }
    ) {
        return vec![vec![
            ("前", 0, 20.0),
            (" ", 1, space),
            ("漢字", 2, 40.0),
            (" ", 3, space),
            ("後", 4, 20.0),
        ]];
    }
    // A tab is four literal spaces in this API, not a cursor-dependent tab stop.
    // Prefix: 前 + six spaces + atomic 漢字. Newline is token8 but no fragment.
    let mut first = vec![
        ("前", 0, 20.0),
        (" ", 1, space),
        (" ", 2, space),
        (" ", 3, space),
        (" ", 4, space),
        (" ", 5, space),
        (" ", 6, space),
        ("漢字", 7, 40.0),
    ];
    if matches!(surface, Surface::Flow { ellipsis: true, .. }) {
        first.push(("…", 8, marker));
        return vec![first];
    }
    vec![
        first,
        vec![
            (" ", 9, space),
            (" ", 10, space),
            (" ", 11, space),
            (" ", 12, space),
            (" ", 13, space),
            ("後", 14, 20.0),
        ],
    ]
}

fn assert_literal_layout(
    layout: &FlowLayoutResult,
    expected: &[Vec<(&str, usize, f64)>],
    surface: Surface,
    rich_input: bool,
) {
    assert_eq!(
        layout.lines.len(),
        expected.len(),
        "{surface:?} rich={rich_input}"
    );
    assert_eq!(layout.used_line_count, expected.len());
    for (line, expected_fragments) in layout.lines.iter().zip(expected) {
        assert_eq!(
            line.fragments.len(),
            expected_fragments.len(),
            "{surface:?} rich={rich_input}: {line:?}"
        );
        let mut offset = 0.0;
        for (fragment, &(text, start, advance)) in line.fragments.iter().zip(expected_fragments) {
            assert_eq!(fragment.text, text);
            assert_eq!((fragment.char_start, fragment.char_end), (start, start + 1));
            assert!((fragment.inline_advance_px - advance).abs() < ADVANCE_EPSILON_PX);
            assert!((fragment.x - offset).abs() < ADVANCE_EPSILON_PX);
            assert!(fragment.style.is_none());
            offset += advance;
        }
    }
    let expected_size =
        matches!(surface, Surface::Flow { shrink: true, .. }).then_some(FONT_SIZE_PX);
    assert_eq!(layout.chosen_font_size_px, expected_size);
}

#[test]
fn ruby_span_whitespace_matches_literal_flow_and_shrinkwrap_oracles() {
    let registry = registry();
    let families = vec!["Noto".to_string()];
    let font_style = FontStyle::Normal;
    let context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &font_style,
    };
    let face = registry
        .resolve("Noto", 400, &font_style)
        .expect("fixture face");
    let natural_advance = |text: &str| {
        let glyphs = shape_text_with_options(
            &registry,
            face,
            text,
            FONT_SIZE_PX,
            0.0,
            &ShapeOptions::default(),
        )
        .expect("independent font facts");
        assert!(glyphs.iter().all(|glyph| glyph.glyph_id != 0));
        glyphs.iter().map(|glyph| glyph.x_advance).sum::<f64>()
    };
    for character in ["前", "漢", "字", "後"] {
        assert_eq!(natural_advance(character), 20.0);
    }
    let space = natural_advance(" ");
    let marker = natural_advance("…");
    let (spans, rich) = authored_inputs();
    let mut cases = vec![Surface::Shrinkwrap];
    for white_space in [WhiteSpaceMode::Normal, WhiteSpaceMode::PreWrap] {
        for shrink in [false, true] {
            for ellipsis in [false, true] {
                cases.push(Surface::Flow {
                    white_space,
                    shrink,
                    ellipsis,
                });
            }
        }
    }
    for surface in cases {
        let expected = literal_rows(surface, space, marker);
        for rich_input in [false, true] {
            let layout = resolve(
                surface,
                (!rich_input).then_some(spans.as_slice()),
                rich_input.then_some(rich.as_slice()),
                &context,
            );
            assert_literal_layout(&layout, &expected, surface, rich_input);
        }
    }
}
