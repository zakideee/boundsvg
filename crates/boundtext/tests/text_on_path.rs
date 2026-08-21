// Integration tests always build with `cfg(test)`; declaring it lets clippy's
// test-specific allow configuration apply to fixture setup assertions.
#![cfg(test)]

use boundshape::{
    PathTraversalDirection, canonicalize_region, measure_single_svg_path, region_to_path,
};
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::engine::layout_text;
use boundtext::text::path::{
    TEXT_PATH_SOURCE_BYTE_LIMIT, TextOnPathError, TextOnPathRequest, TextOnPathUnitMapRequest,
    TextPathAnchor, TextPathDirection, TextPathFit, TextPathNormal, TextPathOverflow,
    layout_text_on_path, rebuild_curved_decoration_interval,
};
use boundtext::text::types::{
    FitMode, Language, TextDecorationInput, TextDecorationLine, TextDecorationSkipInk,
    TextDecorationStyle, TextLayoutRequest, TextOrientation, TextSpanInput, WhiteSpaceMode,
    WrapMode, WritingMode,
};
use boundtext::text::unit_map::{TextUnitKind, TextUnitRubyMode};

fn font_registry() -> FontRegistry {
    let mut registry = FontRegistry::new();
    let font_bytes = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
    ))
    .expect("fixture font");
    registry
        .register(
            font_bytes.clone(),
            "Noto".to_string(),
            400,
            FontStyle::Normal,
        )
        .expect("register fixture font");
    registry
        .register(font_bytes, "Noto".to_string(), 700, FontStyle::Normal)
        .expect("register bold fixture font");
    registry
}

fn text_request(text: &str) -> TextLayoutRequest<'_> {
    TextLayoutRequest {
        text,
        spans: None,
        rich_text: None,
        font_size_px: 24.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: f64::MAX,
        max_height: None,
        wrap: WrapMode::None,
        white_space: WhiteSpaceMode::PreWrap,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: Some(1),
        ellipsis: false,
        language: Language::En,
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

fn text_span(text: &str, font_size_px: f64, font_weight: u16) -> TextSpanInput {
    TextSpanInput {
        text: text.to_string(),
        font_family: vec!["Noto".to_string()],
        font_weight,
        font_style: FontStyle::Normal,
        font_size_px,
        letter_spacing_px: Some(0.0),
        language: Some("en".to_string()),
        text_orientation: None,
        color: Some("#000000".to_string()),
        text_strokes: Some(Vec::new()),
        text_shadows: Some(Vec::new()),
        font_variation_settings: None,
        font_feature_settings: None,
        text_decoration: None,
        decoration_transport_only: false,
    }
}

fn layout_with_spans(
    registry: &FontRegistry,
    text: &str,
    spans: &[TextSpanInput],
    d: &str,
    path_overflow: TextPathOverflow,
) -> Result<boundtext::text::types::TextLayoutResult, TextOnPathError> {
    let families = vec!["Noto".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    let mut request = text_request(text);
    request.spans = Some(spans);
    let decoration_owner_ids = spans
        .iter()
        .enumerate()
        .map(|(index, span)| {
            span.text_decoration
                .as_ref()
                .map(|_| u32::try_from(index).expect("test span owner id"))
        })
        .collect::<Vec<_>>();
    layout_text_on_path(
        &TextOnPathRequest {
            d,
            text: request,
            start_offset_px: 0.0,
            text_anchor: TextPathAnchor::Start,
            path_direction: TextPathDirection::Forward,
            path_normal: TextPathNormal::Left,
            path_offset_px: 0.0,
            path_fit: TextPathFit::None,
            path_overflow,
            decoration_owner_ids: &decoration_owner_ids,
            unit_map: None,
        },
        &font_context,
    )
}

fn layout(
    registry: &FontRegistry,
    text: &str,
    d: &str,
    start_offset_px: f64,
    text_anchor: TextPathAnchor,
    path_offset_px: f64,
    path_overflow: TextPathOverflow,
) -> Result<boundtext::text::types::TextLayoutResult, TextOnPathError> {
    layout_with_unit_map(
        registry,
        text,
        d,
        start_offset_px,
        text_anchor,
        path_offset_px,
        path_overflow,
        None,
    )
}

#[expect(
    clippy::too_many_arguments,
    reason = "the test helper mirrors the independent TextOnPath request fields"
)]
fn layout_with_unit_map(
    registry: &FontRegistry,
    text: &str,
    d: &str,
    start_offset_px: f64,
    text_anchor: TextPathAnchor,
    path_offset_px: f64,
    path_overflow: TextPathOverflow,
    unit_map: Option<TextOnPathUnitMapRequest>,
) -> Result<boundtext::text::types::TextLayoutResult, TextOnPathError> {
    let families = vec!["Noto".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    layout_text_on_path(
        &TextOnPathRequest {
            d,
            text: text_request(text),
            start_offset_px,
            text_anchor,
            path_direction: TextPathDirection::Forward,
            path_normal: TextPathNormal::Left,
            path_offset_px,
            path_fit: TextPathFit::None,
            path_overflow,
            decoration_owner_ids: &[],
            unit_map,
        },
        &font_context,
    )
}

#[derive(Clone, Copy)]
struct DirectedPlacement {
    start_offset_px: f64,
    text_anchor: TextPathAnchor,
    path_direction: TextPathDirection,
    path_normal: TextPathNormal,
    path_offset_px: f64,
    path_overflow: TextPathOverflow,
}

fn layout_directed(
    registry: &FontRegistry,
    text: &str,
    d: &str,
    placement: DirectedPlacement,
    unit_map: Option<TextOnPathUnitMapRequest>,
) -> Result<boundtext::text::types::TextLayoutResult, TextOnPathError> {
    let families = vec!["Noto".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    layout_text_on_path(
        &TextOnPathRequest {
            d,
            text: text_request(text),
            start_offset_px: placement.start_offset_px,
            text_anchor: placement.text_anchor,
            path_direction: placement.path_direction,
            path_normal: placement.path_normal,
            path_offset_px: placement.path_offset_px,
            path_fit: TextPathFit::None,
            path_overflow: placement.path_overflow,
            decoration_owner_ids: &[],
            unit_map,
        },
        &font_context,
    )
}

#[expect(
    clippy::too_many_arguments,
    reason = "the test helper mirrors the independent fitting and overflow request fields"
)]
fn layout_fitted(
    registry: &FontRegistry,
    text: &str,
    d: &str,
    path_fit: TextPathFit,
    path_overflow: TextPathOverflow,
    start_offset_px: f64,
    text_anchor: TextPathAnchor,
    unit_map: Option<TextOnPathUnitMapRequest>,
) -> Result<boundtext::text::types::TextLayoutResult, TextOnPathError> {
    let families = vec!["Noto".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };
    layout_text_on_path(
        &TextOnPathRequest {
            d,
            text: text_request(text),
            start_offset_px,
            text_anchor,
            path_direction: TextPathDirection::Forward,
            path_normal: TextPathNormal::Left,
            path_offset_px: 0.0,
            path_fit,
            path_overflow,
            decoration_owner_ids: &[],
            unit_map,
        },
        &font_context,
    )
}

#[test]
fn identical_shaping_spans_do_not_split_ligatures_or_clusters() {
    let registry = font_registry();
    let plain = layout(
        &registry,
        "office",
        "M0 0L1000 0",
        0.0,
        TextPathAnchor::Start,
        0.0,
        TextPathOverflow::Hidden,
    )
    .expect("plain path layout");
    let spans = vec![text_span("of", 24.0, 400), text_span("fice", 24.0, 400)];
    let rich = layout_with_spans(
        &registry,
        "office",
        &spans,
        "M0 0L1000 0",
        TextPathOverflow::Hidden,
    )
    .expect("same-style rich path layout");

    let plain_glyphs = plain.lines[0]
        .positioned_glyphs
        .as_ref()
        .expect("plain positioned glyphs");
    let rich_glyphs = rich.lines[0]
        .positioned_glyphs
        .as_ref()
        .expect("rich positioned glyphs");
    assert_eq!(plain_glyphs.len(), rich_glyphs.len());
    for (plain_glyph, rich_glyph) in plain_glyphs.iter().zip(rich_glyphs) {
        assert_eq!(plain_glyph.glyph_id, rich_glyph.glyph_id);
        assert_eq!(plain_glyph.cluster_start, rich_glyph.cluster_start);
        assert_eq!(plain_glyph.cluster_end, rich_glyph.cluster_end);
        assert_eq!(plain_glyph.origin_x, rich_glyph.origin_x);
        assert_eq!(plain_glyph.x_advance, rich_glyph.x_advance);
    }
}

#[cfg(feature = "unicode-full")]
#[test]
fn equivalent_shaping_values_merge_before_grapheme_boundary_validation() {
    let registry = font_registry();
    let mut first = text_span("e", 24.0, 400);
    first.language = None;
    first.font_variation_settings = Some("\"wght\" 400".to_string());
    first.font_feature_settings = Some("\"liga\" on".to_string());
    let mut second = text_span("\u{301}", 24.0, 400);
    second.language = Some("auto".to_string());
    second.font_variation_settings = Some("'wght' 400".to_string());
    second.font_feature_settings = Some("'liga' 1".to_string());

    let result = layout_with_spans(
        &registry,
        "e\u{301}",
        &[first, second],
        "M0 0L1000 0",
        TextPathOverflow::Hidden,
    )
    .expect("equivalent shaping values must share one run");
    assert!(
        result.lines[0]
            .positioned_glyphs
            .as_ref()
            .is_some_and(|glyphs| !glyphs.is_empty())
    );
}

#[test]
fn mixed_shaping_spans_share_one_cumulative_path_pen() {
    let registry = font_registry();
    let mut spans = vec![
        text_span("A", 16.0, 400),
        text_span("B", 32.0, 700),
        text_span("C", 20.0, 400),
    ];
    spans[1].font_variation_settings = Some("\"wght\" 700".to_string());
    spans[1].font_feature_settings = Some("\"liga\" 0".to_string());
    let result = layout_with_spans(
        &registry,
        "ABC",
        &spans,
        "M0 0L1000 0",
        TextPathOverflow::Hidden,
    )
    .expect("mixed rich path layout");
    let glyphs = result.lines[0]
        .positioned_glyphs
        .as_ref()
        .expect("mixed positioned glyphs");
    assert_eq!(glyphs.len(), 3);
    assert_eq!(glyphs[0].font_weight, 400);
    assert_eq!(glyphs[1].font_weight, 700);
    assert_eq!(glyphs[2].font_weight, 400);
    assert_eq!(glyphs[0].font_size_px, Some(16.0));
    assert_eq!(glyphs[1].font_size_px, Some(32.0));
    assert_eq!(glyphs[2].font_size_px, Some(20.0));
    assert_eq!(
        glyphs[1].font_variation_settings.as_deref(),
        Some("\"wght\" 700")
    );
    assert_eq!(
        glyphs[1].font_feature_settings.as_deref(),
        Some("\"liga\" 0")
    );
    assert!(glyphs[1].x_advance > glyphs[0].x_advance);
    assert!(glyphs[1].x_advance > glyphs[2].x_advance);
    assert!(
        glyphs
            .windows(2)
            .all(|pair| pair[0].origin_x < pair[1].origin_x)
    );
    assert!(result.lines[0].width > 0.0);
}

#[cfg(feature = "unicode-full")]
#[test]
fn shaping_boundary_inside_a_grapheme_is_rejected() {
    let registry = font_registry();
    let spans = vec![text_span("e", 24.0, 400), text_span("\u{301}", 25.0, 400)];
    let error = layout_with_spans(
        &registry,
        "e\u{301}",
        &spans,
        "M0 0L1000 0",
        TextPathOverflow::Hidden,
    )
    .expect_err("cluster-splitting boundary must fail");
    assert_eq!(error, TextOnPathError::InlineClusterSplit);
}

#[test]
fn span_text_mismatch_is_rejected_before_shaping() {
    let registry = font_registry();
    let spans = vec![text_span("different", 24.0, 400)];
    let error = layout_with_spans(
        &registry,
        "source",
        &spans,
        "M0 0L1000 0",
        TextPathOverflow::Hidden,
    )
    .expect_err("mismatched spans must fail");
    assert_eq!(error, TextOnPathError::Invalid);
}

#[test]
fn ellipsis_uses_the_first_omitted_run_style() {
    let registry = font_registry();
    let spans = vec![text_span("A", 12.0, 400), text_span("BBBBBB", 48.0, 700)];
    let result = layout_with_spans(
        &registry,
        "ABBBBBB",
        &spans,
        "M0 0L120 0",
        TextPathOverflow::Ellipsis,
    )
    .expect("rich ellipsis path layout");
    assert!(
        result
            .display_text
            .as_deref()
            .is_some_and(|text| text.ends_with('…'))
    );
    let synthetic = result.lines[0]
        .positioned_glyphs
        .as_ref()
        .expect("ellipsis positioned glyphs")
        .iter()
        .find(|glyph| glyph.synthetic_kind.as_deref() == Some("ellipsis"))
        .expect("synthetic ellipsis glyph");
    assert_eq!(synthetic.font_weight, 700);
    assert_eq!(synthetic.font_size_px, Some(48.0));
    assert!(synthetic.x_advance > 20.0);
}

#[test]
fn unit_identity_survives_path_placement_and_hidden_overflow() {
    let registry = font_registry();
    let unit_request = TextOnPathUnitMapRequest {
        kind: TextUnitKind::Cluster,
        ruby: TextUnitRubyMode::WithBase,
    };
    let visible = layout_with_unit_map(
        &registry,
        "ABCD",
        "M0 0L1000 0",
        0.0,
        TextPathAnchor::Start,
        0.0,
        TextPathOverflow::Hidden,
        Some(unit_request),
    )
    .expect("visible unit layout");
    let hidden = layout_with_unit_map(
        &registry,
        "ABCD",
        "M0 0L1000 0",
        -10_000.0,
        TextPathAnchor::Start,
        0.0,
        TextPathOverflow::Hidden,
        Some(unit_request),
    )
    .expect("hidden unit layout");
    let visible_glyphs = visible.lines[0]
        .positioned_glyphs
        .as_ref()
        .expect("visible positioned glyphs");
    let first_center = visible_glyphs[0].origin_x + visible_glyphs[0].x_advance / 2.0;
    let second_center = visible_glyphs[1].origin_x + visible_glyphs[1].x_advance / 2.0;
    let partially_hidden = layout_with_unit_map(
        &registry,
        "ABCD",
        "M0 0L1000 0",
        -(first_center + second_center) / 2.0,
        TextPathAnchor::Start,
        0.0,
        TextPathOverflow::Hidden,
        Some(unit_request),
    )
    .expect("partially hidden unit layout");
    let visible_map = visible.unit_map.expect("visible unit map");
    let hidden_map = hidden.unit_map.expect("hidden unit map");
    let partially_hidden_map = partially_hidden
        .unit_map
        .expect("partially hidden unit map");

    assert_eq!(visible_map.units.len(), 4);
    assert_eq!(
        visible_map
            .units
            .iter()
            .map(|unit| unit.unit_id.as_str())
            .collect::<Vec<_>>(),
        hidden_map
            .units
            .iter()
            .map(|unit| unit.unit_id.as_str())
            .collect::<Vec<_>>()
    );
    assert!(
        visible_map
            .units
            .iter()
            .all(|unit| !unit.members.is_empty())
    );
    assert!(hidden_map.units.iter().all(|unit| unit.members.is_empty()));
    assert_eq!(
        partially_hidden_map
            .units
            .iter()
            .map(|unit| {
                unit.members
                    .iter()
                    .map(|member| member.glyph_index)
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>(),
        vec![vec![], vec![0], vec![1], vec![2]]
    );
    assert_eq!(
        partially_hidden.lines[0]
            .positioned_glyphs
            .as_ref()
            .expect("partially visible glyphs")
            .iter()
            .map(|glyph| glyph.text.as_str())
            .collect::<Vec<_>>(),
        vec!["B", "C", "D"]
    );
    assert!(
        hidden.lines[0]
            .positioned_glyphs
            .as_ref()
            .is_some_and(Vec::is_empty)
    );
}

#[test]
fn straight_path_uses_shaped_pen_origins_and_preserves_spaces() {
    let registry = font_registry();
    let result = layout(
        &registry,
        " A B ",
        "M0 0L1000 0",
        0.0,
        TextPathAnchor::Start,
        7.0,
        TextPathOverflow::Hidden,
    )
    .expect("straight path layout");
    let line = &result.lines[0];
    assert_eq!(line.text, " A B ");
    let glyphs = line.positioned_glyphs.as_ref().expect("positioned glyphs");
    assert!(!glyphs.is_empty());
    assert!(
        glyphs
            .iter()
            .all(|glyph| glyph.absolute_position == Some(true))
    );
    assert!(
        glyphs
            .iter()
            .all(|glyph| glyph.baseline_rotation_deg == Some(0.0))
    );
    assert!((glyphs[0].origin_x - glyphs[0].x_offset).abs() < 1e-6);
    assert!((glyphs[0].origin_y - (7.0 + glyphs[0].y_offset)).abs() < 1e-6);
}

#[test]
fn straight_path_matches_normal_horizontal_shaping_and_advances() {
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
    let normal = layout_text(&text_request("Path parity"), &font_context).expect("normal layout");
    let path = layout(
        &registry,
        "Path parity",
        "M0 0L1000 0",
        0.0,
        TextPathAnchor::Start,
        0.0,
        TextPathOverflow::Error,
    )
    .expect("straight path layout");
    let normal_glyphs = normal.lines[0]
        .positioned_glyphs
        .as_ref()
        .expect("normal positioned glyphs");
    let path_glyphs = path.lines[0]
        .positioned_glyphs
        .as_ref()
        .expect("path positioned glyphs");
    assert_eq!(path_glyphs.len(), normal_glyphs.len());
    for (path_glyph, normal_glyph) in path_glyphs.iter().zip(normal_glyphs) {
        assert_eq!(path_glyph.glyph_id, normal_glyph.glyph_id);
        assert_eq!(path_glyph.font_alias, normal_glyph.font_alias);
        assert!((path_glyph.x_advance - normal_glyph.x_advance).abs() < 1e-9);
        assert!((path_glyph.x_offset - normal_glyph.x_offset).abs() < 1e-9);
        assert!((path_glyph.y_offset - normal_glyph.y_offset).abs() < 1e-9);
        assert!((path_glyph.origin_x - normal_glyph.origin_x).abs() < 1e-6);
        assert_eq!(path_glyph.baseline_rotation_deg, Some(0.0));
    }
}

#[test]
fn direction_and_normal_change_physical_pose_without_reversing_logical_identity() {
    let registry = font_registry();
    let unit_request = TextOnPathUnitMapRequest {
        kind: TextUnitKind::Cluster,
        ruby: TextUnitRubyMode::WithBase,
    };
    let base = DirectedPlacement {
        start_offset_px: 100.0,
        text_anchor: TextPathAnchor::Start,
        path_direction: TextPathDirection::Forward,
        path_normal: TextPathNormal::Left,
        path_offset_px: 12.0,
        path_overflow: TextPathOverflow::Error,
    };
    let forward_left = layout_directed(&registry, "AB", "M0 40L400 40", base, Some(unit_request))
        .expect("forward left");
    let reverse_left = layout_directed(
        &registry,
        "AB",
        "M0 40L400 40",
        DirectedPlacement {
            path_direction: TextPathDirection::Reverse,
            ..base
        },
        Some(unit_request),
    )
    .expect("reverse left");
    let forward_right = layout_directed(
        &registry,
        "AB",
        "M0 40L400 40",
        DirectedPlacement {
            path_normal: TextPathNormal::Right,
            ..base
        },
        Some(unit_request),
    )
    .expect("forward right");

    let forward_glyphs = forward_left.lines[0]
        .positioned_glyphs
        .as_ref()
        .expect("forward glyphs");
    let reverse_glyphs = reverse_left.lines[0]
        .positioned_glyphs
        .as_ref()
        .expect("reverse glyphs");
    let right_glyphs = forward_right.lines[0]
        .positioned_glyphs
        .as_ref()
        .expect("right glyphs");
    assert_eq!(
        forward_glyphs
            .iter()
            .map(|glyph| glyph.text.as_str())
            .collect::<Vec<_>>(),
        vec!["A", "B"],
    );
    assert_eq!(
        reverse_glyphs
            .iter()
            .map(|glyph| glyph.text.as_str())
            .collect::<Vec<_>>(),
        vec!["A", "B"],
    );
    assert_eq!(forward_glyphs[0].baseline_rotation_deg, Some(0.0));
    assert_eq!(
        reverse_glyphs[0].baseline_rotation_deg.map(f64::abs),
        Some(180.0)
    );
    assert!(forward_glyphs[0].origin_y > right_glyphs[0].origin_y);
    assert!(forward_glyphs[0].origin_x < reverse_glyphs[0].origin_x);
    assert_eq!(
        forward_left
            .unit_map
            .as_ref()
            .expect("forward unit map")
            .units
            .iter()
            .map(|unit| (&unit.unit_id, unit.source_start, unit.source_end))
            .collect::<Vec<_>>(),
        reverse_left
            .unit_map
            .as_ref()
            .expect("reverse unit map")
            .units
            .iter()
            .map(|unit| (&unit.unit_id, unit.source_start, unit.source_end))
            .collect::<Vec<_>>(),
    );
}

#[test]
fn closed_paths_wrap_offsets_once_and_use_direction_specific_seam_tangents() {
    let registry = font_registry();
    let path = "M0 0L100 0L100 200Z";
    let probe = layout_directed(
        &registry,
        "A",
        path,
        DirectedPlacement {
            start_offset_px: 0.0,
            text_anchor: TextPathAnchor::Start,
            path_direction: TextPathDirection::Forward,
            path_normal: TextPathNormal::Left,
            path_offset_px: 0.0,
            path_overflow: TextPathOverflow::Error,
        },
        None,
    )
    .expect("closed probe");
    let advance = probe.lines[0]
        .positioned_glyphs
        .as_ref()
        .expect("probe glyphs")[0]
        .x_advance;
    let seam = DirectedPlacement {
        start_offset_px: -advance / 2.0,
        text_anchor: TextPathAnchor::Start,
        path_direction: TextPathDirection::Forward,
        path_normal: TextPathNormal::Left,
        path_offset_px: 0.0,
        path_overflow: TextPathOverflow::Error,
    };
    let forward = layout_directed(&registry, "A", path, seam, None).expect("forward seam");
    let reverse = layout_directed(
        &registry,
        "A",
        path,
        DirectedPlacement {
            path_direction: TextPathDirection::Reverse,
            ..seam
        },
        None,
    )
    .expect("reverse seam");
    let forward_rotation = forward.lines[0].positioned_glyphs.as_ref().unwrap()[0]
        .baseline_rotation_deg
        .unwrap();
    let reverse_rotation = reverse.lines[0].positioned_glyphs.as_ref().unwrap()[0]
        .baseline_rotation_deg
        .unwrap();
    assert_eq!(forward_rotation, 0.0);
    assert!((reverse_rotation - 63.434_948_822_922_01).abs() < 1e-9);

    let perimeter = 100.0 + 200.0 + 100.0_f64.hypot(200.0);
    let wrapped = layout_directed(
        &registry,
        "A",
        path,
        DirectedPlacement {
            start_offset_px: seam.start_offset_px + perimeter,
            ..seam
        },
        None,
    )
    .expect("wrapped seam");
    let forward_glyph = &forward.lines[0].positioned_glyphs.as_ref().unwrap()[0];
    let wrapped_glyph = &wrapped.lines[0].positioned_glyphs.as_ref().unwrap()[0];
    assert!((forward_glyph.origin_x - wrapped_glyph.origin_x).abs() < 1e-9);
    assert!((forward_glyph.origin_y - wrapped_glyph.origin_y).abs() < 1e-9);
    assert_eq!(
        forward_glyph.baseline_rotation_deg,
        wrapped_glyph.baseline_rotation_deg
    );
}

#[test]
fn offset_limits_and_negative_path_offset_fail_before_placement() {
    let registry = font_registry();
    let base = DirectedPlacement {
        start_offset_px: 1_000_000_000_000.0,
        text_anchor: TextPathAnchor::Start,
        path_direction: TextPathDirection::Forward,
        path_normal: TextPathNormal::Left,
        path_offset_px: 0.0,
        path_overflow: TextPathOverflow::Hidden,
    };
    assert!(layout_directed(&registry, "A", "M0 0L10 0Z", base, None).is_ok());
    assert_eq!(
        layout_directed(
            &registry,
            "A",
            "M0 0L10 0Z",
            DirectedPlacement {
                start_offset_px: f64::from_bits(1_000_000_000_000.0_f64.to_bits() + 1),
                ..base
            },
            None,
        )
        .expect_err("offset beyond limit"),
        TextOnPathError::OffsetLimit,
    );
    assert_eq!(
        layout_directed(
            &registry,
            "A",
            "M0 0L10 0Z",
            DirectedPlacement {
                path_offset_px: -0.1,
                ..base
            },
            None,
        )
        .expect_err("negative path offset"),
        TextOnPathError::Invalid,
    );

    let oversized_text = "A".repeat(TEXT_PATH_SOURCE_BYTE_LIMIT + 1);
    assert_eq!(
        layout_directed(
            &registry,
            &oversized_text,
            "M0 0L10 0Z",
            DirectedPlacement {
                start_offset_px: 0.0,
                ..base
            },
            None,
        )
        .expect_err("text source beyond limit"),
        TextOnPathError::SourceLimit,
    );
}

#[test]
fn anchor_normal_offset_and_curve_tangent_change_placement() {
    let registry = font_registry();
    let start = layout(
        &registry,
        "Path",
        "M0 80C80 0 160 0 240 80",
        120.0,
        TextPathAnchor::Start,
        0.0,
        TextPathOverflow::Error,
    )
    .expect("start anchor");
    let middle = layout(
        &registry,
        "Path",
        "M0 80C80 0 160 0 240 80",
        120.0,
        TextPathAnchor::Middle,
        8.0,
        TextPathOverflow::Error,
    )
    .expect("middle anchor");
    let start_glyph = &start.lines[0].positioned_glyphs.as_ref().unwrap()[0];
    let middle_glyph = &middle.lines[0].positioned_glyphs.as_ref().unwrap()[0];
    assert_ne!(start_glyph.origin_x, middle_glyph.origin_x);
    assert_ne!(start_glyph.origin_y, middle_glyph.origin_y);
    assert!(
        start.lines[0]
            .positioned_glyphs
            .as_ref()
            .unwrap()
            .iter()
            .any(|glyph| glyph.baseline_rotation_deg.unwrap_or(0.0).abs() > 0.1)
    );
    assert!(middle.bbox.w > 0.0 && middle.bbox.h > 0.0);
}

#[test]
fn overflow_is_all_or_nothing_for_error_and_omits_hidden_glyphs() {
    let registry = font_registry();
    let hidden = layout(
        &registry,
        "overflow",
        "M0 0L20 0",
        0.0,
        TextPathAnchor::Start,
        0.0,
        TextPathOverflow::Hidden,
    )
    .expect("hidden overflow");
    assert_eq!(hidden.lines[0].text, "overflow");
    assert!(
        hidden.lines[0].positioned_glyphs.as_ref().unwrap().len() < hidden.lines[0].glyphs.len()
    );
    let overflow_error = layout(
        &registry,
        "overflow",
        "M0 0L20 0",
        0.0,
        TextPathAnchor::Start,
        0.0,
        TextPathOverflow::Error,
    )
    .expect_err("error overflow must reject the complete layout");
    assert_eq!(overflow_error, TextOnPathError::Overflow);
}

#[test]
fn path_measurement_errors_keep_text_path_error_identity() {
    let registry = font_registry();
    for (path, expected) in [
        (
            "M0 0L10 0M20 0L30 0",
            TextOnPathError::MultipleSubpathsUnsupported,
        ),
        ("M0 0", TextOnPathError::ZeroLength),
        ("M0 0X10 0", TextOnPathError::InvalidData),
    ] {
        let error = layout(
            &registry,
            "A",
            path,
            0.0,
            TextPathAnchor::Start,
            0.0,
            TextPathOverflow::Error,
        )
        .expect_err("invalid path must fail");
        assert_eq!(error, expected);
    }
}

#[test]
fn spacing_fit_distributes_positive_and_negative_gaps_and_enforces_minimum_step() {
    let registry = font_registry();
    let natural = layout_fitted(
        &registry,
        "AB",
        "M0 0L1000 0",
        TextPathFit::None,
        TextPathOverflow::Error,
        0.0,
        TextPathAnchor::Start,
        None,
    )
    .expect("natural layout");
    let natural_glyphs = natural.lines[0].positioned_glyphs.as_ref().unwrap();
    let natural_advance = natural.lines[0].width;
    let first_advance = natural_glyphs[0].x_advance;
    let second_advance = natural_glyphs[1].x_advance;

    for target in [natural_advance + 20.0, natural_advance * 0.8] {
        let fitted = layout_fitted(
            &registry,
            "AB",
            &format!("M0 0L{target} 0"),
            TextPathFit::Spacing,
            TextPathOverflow::Error,
            0.0,
            TextPathAnchor::Start,
            None,
        )
        .expect("satisfiable spacing fit");
        let glyphs = fitted.lines[0].positioned_glyphs.as_ref().unwrap();
        assert!((fitted.lines[0].width - target).abs() < 1e-9);
        assert!((glyphs.iter().map(|glyph| glyph.x_advance).sum::<f64>() - target).abs() < 1e-9);
        assert_eq!(glyphs[0].inline_scale, None);
    }

    let exact_target = second_advance + 0.01;
    layout_fitted(
        &registry,
        "AB",
        &format!("M0 0L{exact_target} 0"),
        TextPathFit::Spacing,
        TextPathOverflow::Hidden,
        0.0,
        TextPathAnchor::Start,
        None,
    )
    .expect("the exact 0.01px step boundary is valid");
    let below_target = second_advance + 0.009;
    assert_eq!(
        layout_fitted(
            &registry,
            "AB",
            &format!("M0 0L{below_target} 0"),
            TextPathFit::Spacing,
            TextPathOverflow::Hidden,
            0.0,
            TextPathAnchor::Start,
            None,
        )
        .expect_err("steps below 0.01px must fail"),
        TextOnPathError::FitUnsatisfiable,
    );
    assert!(first_advance > 0.01);
}

#[test]
fn spacing_fit_is_a_noop_for_one_shaping_cluster_including_combining_text() {
    let registry = font_registry();
    for text in ["A", "A\u{0301}", "ffi"] {
        let natural = layout_fitted(
            &registry,
            text,
            "M0 0L1000 0",
            TextPathFit::None,
            TextPathOverflow::Error,
            0.0,
            TextPathAnchor::Start,
            None,
        )
        .expect("natural single-cluster layout");
        let spacing = layout_fitted(
            &registry,
            text,
            "M0 0L500 0",
            TextPathFit::Spacing,
            TextPathOverflow::Error,
            0.0,
            TextPathAnchor::Start,
            None,
        )
        .expect("single-cluster spacing layout");
        assert!((spacing.lines[0].width - natural.lines[0].width).abs() < 1e-9);
        assert!(
            spacing.lines[0]
                .positioned_glyphs
                .as_ref()
                .unwrap()
                .iter()
                .all(|glyph| glyph.inline_scale.is_none())
        );
    }
}

#[test]
fn scale_fit_precedes_anchor_reverse_traversal_and_right_normal_offset() {
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
    let result = layout_text_on_path(
        &TextOnPathRequest {
            d: "M0 40L200 40",
            text: text_request("AB"),
            start_offset_px: 100.0,
            text_anchor: TextPathAnchor::Middle,
            path_direction: TextPathDirection::Reverse,
            path_normal: TextPathNormal::Right,
            path_offset_px: 7.0,
            path_fit: TextPathFit::Scale,
            path_overflow: TextPathOverflow::Error,
            decoration_owner_ids: &[],
            unit_map: None,
        },
        &font_context,
    )
    .expect("ordered fitted placement");
    let glyphs = result.lines[0].positioned_glyphs.as_ref().unwrap();

    assert!((result.lines[0].width - 200.0).abs() < 1e-9);
    assert_eq!(glyphs.len(), 2);
    assert!((glyphs[0].origin_x - 200.0).abs() < 1e-8);
    assert!((glyphs[0].origin_y - 47.0).abs() < 1e-8);
    assert!((glyphs[0].baseline_rotation_deg.unwrap().abs() - 180.0).abs() < 1e-8);
    assert!(glyphs.iter().all(|glyph| glyph.inline_scale.unwrap() > 1.0));
}

#[test]
fn whole_path_scale_keeps_closed_seam_modulo_byte_identical() {
    let registry = font_registry();
    let path = "M0 0L100 0L100 100L0 100Z";
    let at_zero = layout_fitted(
        &registry,
        "AB",
        path,
        TextPathFit::Scale,
        TextPathOverflow::Error,
        0.0,
        TextPathAnchor::Start,
        None,
    )
    .expect("closed fit at zero");
    let at_one_lap = layout_fitted(
        &registry,
        "AB",
        path,
        TextPathFit::Scale,
        TextPathOverflow::Error,
        400.0,
        TextPathAnchor::Start,
        None,
    )
    .expect("closed fit at one lap");

    assert!((at_zero.lines[0].width - 400.0).abs() < 1e-9);
    let zero_glyphs = at_zero.lines[0].positioned_glyphs.as_ref().unwrap();
    let one_lap_glyphs = at_one_lap.lines[0].positioned_glyphs.as_ref().unwrap();
    assert_eq!(zero_glyphs.len(), one_lap_glyphs.len());
    for (zero_glyph, one_lap_glyph) in zero_glyphs.iter().zip(one_lap_glyphs) {
        assert_eq!(zero_glyph.glyph_id, one_lap_glyph.glyph_id);
        assert!((zero_glyph.origin_x - one_lap_glyph.origin_x).abs() < 1e-9);
        assert!((zero_glyph.origin_y - one_lap_glyph.origin_y).abs() < 1e-9);
        assert_eq!(
            zero_glyph.baseline_rotation_deg,
            one_lap_glyph.baseline_rotation_deg
        );
    }
}

#[test]
fn scale_fit_accepts_inclusive_limits_rejects_outside_and_shrink_can_be_noop() {
    let registry = font_registry();
    let natural = layout_fitted(
        &registry,
        "Scale",
        "M0 0L1000 0",
        TextPathFit::None,
        TextPathOverflow::Error,
        0.0,
        TextPathAnchor::Start,
        None,
    )
    .expect("natural layout");
    let advance = natural.lines[0].width;

    for scale in [1.0 / 16.0, 16.0] {
        let fitted = layout_fitted(
            &registry,
            "Scale",
            &format!("M0 0L{} 0", advance * scale),
            TextPathFit::Scale,
            TextPathOverflow::Error,
            0.0,
            TextPathAnchor::Start,
            None,
        )
        .expect("inclusive scale limit");
        assert!((fitted.lines[0].width - advance * scale).abs() < 1e-8);
        assert!(
            fitted.lines[0]
                .positioned_glyphs
                .as_ref()
                .unwrap()
                .iter()
                .all(|glyph| (glyph.inline_scale.unwrap() - scale).abs() < 1e-8)
        );
    }
    for scale in [1.0 / 16.0 - 0.001, 16.001] {
        assert_eq!(
            layout_fitted(
                &registry,
                "Scale",
                &format!("M0 0L{} 0", advance * scale),
                TextPathFit::Scale,
                TextPathOverflow::Hidden,
                0.0,
                TextPathAnchor::Start,
                None,
            )
            .expect_err("outside scale limit"),
            TextOnPathError::FitUnsatisfiable,
        );
    }

    let shrink = layout_fitted(
        &registry,
        "Scale",
        &format!("M0 0L{} 0", advance + 50.0),
        TextPathFit::Shrink,
        TextPathOverflow::Error,
        0.0,
        TextPathAnchor::Start,
        None,
    )
    .expect("shrink no-op");
    assert!((shrink.lines[0].width - advance).abs() < 1e-9);
    assert!(
        shrink.lines[0]
            .positioned_glyphs
            .as_ref()
            .unwrap()
            .iter()
            .all(|glyph| glyph.inline_scale.is_none())
    );
}

#[test]
fn ellipsis_preserves_source_identity_and_keeps_truncated_units_empty() {
    let registry = font_registry();
    let natural = layout_fitted(
        &registry,
        "ABCDE",
        "M0 0L1000 0",
        TextPathFit::None,
        TextPathOverflow::Error,
        0.0,
        TextPathAnchor::Start,
        None,
    )
    .expect("natural layout");
    let target = natural.lines[0].width * 0.55;
    let result = layout_fitted(
        &registry,
        "ABCDE",
        &format!("M0 0L{target} 0"),
        TextPathFit::None,
        TextPathOverflow::Ellipsis,
        0.0,
        TextPathAnchor::Start,
        Some(TextOnPathUnitMapRequest {
            kind: TextUnitKind::Cluster,
            ruby: TextUnitRubyMode::Separate,
        }),
    )
    .expect("ellipsis layout");
    assert_eq!(result.source_text.as_deref(), Some("ABCDE"));
    assert!(
        result
            .display_text
            .as_deref()
            .unwrap()
            .ends_with('\u{2026}')
    );
    assert_eq!(result.lines[0].text, "ABCDE");
    let glyphs = result.lines[0].positioned_glyphs.as_ref().unwrap();
    let ellipsis = glyphs.last().expect("synthetic ellipsis glyph");
    assert_eq!(ellipsis.synthetic_kind.as_deref(), Some("ellipsis"));
    assert_eq!(ellipsis.source_start, None);
    assert_eq!(ellipsis.source_end, None);
    assert_eq!(ellipsis.source_role, None);
    let unit_map = result.unit_map.as_ref().expect("original source unit map");
    let glyph_count = u32::try_from(glyphs.len()).expect("test glyph count fits in u32");
    assert!(unit_map.units.iter().any(|unit| unit.members.is_empty()));
    assert!(
        unit_map
            .units
            .iter()
            .flat_map(|unit| &unit.members)
            .all(|member| member.glyph_index < glyph_count)
    );
}

#[test]
fn ellipsis_uses_the_injected_fallback_registry() {
    let registry = FontRegistry::new();
    let mut fallback_registry = FontRegistry::new();
    fallback_registry
        .register(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
            ))
            .expect("fallback fixture font"),
            "Noto".to_string(),
            400,
            FontStyle::Normal,
        )
        .expect("register fallback fixture font");
    let families = vec!["Noto".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: Some(&fallback_registry),
        families: &families,
        weight: 400,
        style: &style,
    };
    let result = layout_text_on_path(
        &TextOnPathRequest {
            d: "M0 0L60 0",
            text: text_request("ABCDEFGHIJKLMN"),
            start_offset_px: 0.0,
            text_anchor: TextPathAnchor::Start,
            path_direction: TextPathDirection::Forward,
            path_normal: TextPathNormal::Left,
            path_offset_px: 0.0,
            path_fit: TextPathFit::None,
            path_overflow: TextPathOverflow::Ellipsis,
            decoration_owner_ids: &[],
            unit_map: None,
        },
        &font_context,
    )
    .expect("fallback ellipsis layout");
    let ellipsis = result.lines[0]
        .positioned_glyphs
        .as_ref()
        .and_then(|glyphs| glyphs.last())
        .expect("fallback ellipsis glyph");

    assert_eq!(ellipsis.synthetic_kind.as_deref(), Some("ellipsis"));
    assert_eq!(ellipsis.font_alias, "Noto");
    assert_ne!(ellipsis.glyph_id, 0);
    assert!(
        result
            .warnings
            .iter()
            .all(|warning| warning.code != "MISSING_GLYPH")
    );
}

#[test]
fn spacing_ellipsis_selects_the_longest_prefix_at_the_minimum_step() {
    let registry = font_registry();
    let ellipsis = layout_fitted(
        &registry,
        "\u{2026}",
        "M0 0L1000 0",
        TextPathFit::None,
        TextPathOverflow::Error,
        0.0,
        TextPathAnchor::Start,
        None,
    )
    .expect("natural ellipsis");
    let target = ellipsis.lines[0].width + 0.01;
    let result = layout_fitted(
        &registry,
        "iWWWW",
        &format!("M0 0L{target} 0"),
        TextPathFit::Spacing,
        TextPathOverflow::Ellipsis,
        0.0,
        TextPathAnchor::Start,
        None,
    )
    .expect("spacing ellipsis layout");
    let glyphs = result.lines[0].positioned_glyphs.as_ref().unwrap();

    assert_eq!(result.display_text.as_deref(), Some("i\u{2026}"));
    assert!((result.lines[0].width - target).abs() < 1e-9);
    assert!((glyphs[0].x_advance - 0.01).abs() < 1e-8);
    assert_eq!(
        glyphs
            .last()
            .and_then(|glyph| glyph.synthetic_kind.as_deref()),
        Some("ellipsis")
    );
}

#[test]
fn ellipsis_that_cannot_fit_produces_zero_ink_but_retains_source_text() {
    let registry = font_registry();
    let result = layout_fitted(
        &registry,
        "ABCDE",
        "M0 0L0.001 0",
        TextPathFit::None,
        TextPathOverflow::Ellipsis,
        0.0,
        TextPathAnchor::Start,
        Some(TextOnPathUnitMapRequest {
            kind: TextUnitKind::Cluster,
            ruby: TextUnitRubyMode::Separate,
        }),
    )
    .expect("hidden ellipsis result");
    assert_eq!(result.lines[0].text, "ABCDE");
    assert_eq!(result.source_text.as_deref(), Some("ABCDE"));
    assert_eq!(result.display_text.as_deref(), Some("\u{2026}"));
    assert!(
        result.lines[0]
            .positioned_glyphs
            .as_ref()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        (result.bbox.x, result.bbox.y, result.bbox.w, result.bbox.h),
        (0.0, 0.0, 0.0, 0.0)
    );
    assert!(
        result
            .unit_map
            .as_ref()
            .unwrap()
            .units
            .iter()
            .all(|unit| unit.members.is_empty())
    );
}

#[test]
fn fitting_uses_whole_path_before_anchor_and_visibility() {
    let registry = font_registry();
    let error = layout_fitted(
        &registry,
        "ABCD",
        "M0 0L200 0",
        TextPathFit::Scale,
        TextPathOverflow::Error,
        60.0,
        TextPathAnchor::Start,
        None,
    )
    .expect_err("start offset is applied after whole-path fitting");
    assert_eq!(error, TextOnPathError::Overflow);
}

#[test]
fn curved_decoration_uses_fitted_path_distance_metadata() {
    let registry = font_registry();
    let mut span = text_span("AB", 24.0, 400);
    span.text_decoration = Some(TextDecorationInput {
        line: vec![TextDecorationLine::Underline],
        color: "#336699".to_string(),
        style: TextDecorationStyle::Wavy,
        thickness_px: Some(2.0),
        offset_px: 1.0,
        skip_ink: TextDecorationSkipInk::None,
    });
    let result = layout_with_spans(
        &registry,
        "AB",
        &[span],
        "M0 40Q100 -20 200 40",
        TextPathOverflow::Error,
    )
    .expect("curved decorated text");
    assert_eq!(result.text_decorations.len(), 1);
    let fragment = &result.text_decorations[0];
    assert_eq!(fragment.line, TextDecorationLine::Underline);
    assert_eq!(fragment.style, TextDecorationStyle::Wavy);
    assert_eq!(fragment.source_start, 0);
    assert_eq!(fragment.source_end, 2);
    let path = fragment.paths.first().expect("curved decoration path");
    assert!(!path.d.is_empty());
    assert!(path.contour_count > 0);
    assert!(path.segment_count > 0);
    assert!(path.path_sample_count > 0);
    assert_eq!(path.path_distance_start_px, Some(0.0));
    assert!(path.path_distance_end_px.is_some_and(|end| end > 0.0));
    assert_eq!(path.path_phase_origin_px, Some(0.0));
}

#[test]
fn single_cluster_curved_decoration_uses_its_owner_glyph_metrics() {
    let registry = font_registry();
    let mut span = text_span("A", 24.0, 400);
    span.text_decoration = Some(TextDecorationInput {
        line: vec![TextDecorationLine::Underline],
        color: "#336699".to_string(),
        style: TextDecorationStyle::Solid,
        thickness_px: Some(2.0),
        offset_px: 1.0,
        skip_ink: TextDecorationSkipInk::None,
    });

    let result = layout_with_spans(
        &registry,
        "A",
        &[span],
        "M0 40Q100 -20 200 40",
        TextPathOverflow::Error,
    )
    .expect("single-cluster curved decoration");

    assert_eq!(result.text_decorations.len(), 1);
    assert!(!result.text_decorations[0].paths.is_empty());
}

#[test]
fn every_curved_decoration_style_materializes_without_resetting_distance() {
    let registry = font_registry();
    for style in [
        TextDecorationStyle::Solid,
        TextDecorationStyle::Double,
        TextDecorationStyle::Dotted,
        TextDecorationStyle::Dashed,
        TextDecorationStyle::Wavy,
    ] {
        let mut span = text_span("Pattern", 24.0, 400);
        span.text_decoration = Some(TextDecorationInput {
            line: vec![
                TextDecorationLine::Underline,
                TextDecorationLine::Overline,
                TextDecorationLine::LineThrough,
            ],
            color: "#336699".to_string(),
            style,
            thickness_px: Some(2.0),
            offset_px: 0.0,
            skip_ink: TextDecorationSkipInk::None,
        });
        let first = layout_with_spans(
            &registry,
            "Pattern",
            std::slice::from_ref(&span),
            "M0 60C80 20 160 20 240 60",
            TextPathOverflow::Error,
        )
        .expect("curved decoration style");
        let second = layout_with_spans(
            &registry,
            "Pattern",
            &[span],
            "M0 60C80 20 160 20 240 60",
            TextPathOverflow::Error,
        )
        .expect("repeated curved decoration style");
        assert_eq!(first.text_decorations, second.text_decorations);
        assert_eq!(first.text_decorations.len(), 3);
        assert!(first.text_decorations.iter().all(|fragment| {
            fragment.style == style
                && fragment.paths.iter().all(|path| {
                    !path.d.is_empty()
                        && path.path_distance_start_px == Some(0.0)
                        && path.path_distance_end_px.is_some_and(|end| end > 0.0)
                })
        }));
    }
}

#[test]
fn fitted_decoration_crosses_a_closed_corner_and_seam_in_both_directions() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let font_style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &font_style,
    };
    for direction in [TextPathDirection::Forward, TextPathDirection::Reverse] {
        for decoration_style in [
            TextDecorationStyle::Solid,
            TextDecorationStyle::Double,
            TextDecorationStyle::Dotted,
            TextDecorationStyle::Dashed,
        ] {
            let mut span = text_span("Pattern Path", 24.0, 400);
            span.text_decoration = Some(TextDecorationInput {
                line: vec![TextDecorationLine::Underline],
                color: "#336699".to_string(),
                style: decoration_style,
                thickness_px: Some(2.0),
                offset_px: 0.0,
                skip_ink: TextDecorationSkipInk::None,
            });
            let mut request = text_request("Pattern Path");
            request.spans = Some(std::slice::from_ref(&span));
            let result = layout_text_on_path(
                &TextOnPathRequest {
                    d: "M20 20L330 20L330 150L20 150Z",
                    text: request,
                    start_offset_px: 475.0,
                    text_anchor: TextPathAnchor::Middle,
                    path_direction: direction,
                    path_normal: TextPathNormal::Right,
                    path_offset_px: 5.0,
                    path_fit: TextPathFit::Scale,
                    path_overflow: TextPathOverflow::Error,
                    decoration_owner_ids: &[Some(0)],
                    unit_map: None,
                },
                &font_context,
            )
            .unwrap_or_else(|error| {
                panic!(
                    "closed fitted {direction:?} {decoration_style:?} decoration failed: {error:?}"
                )
            });
            let paths = &result.text_decorations[0].paths;
            assert_eq!(paths.len(), 2);
            assert_eq!(paths[0].path_distance_start_px, Some(35.0));
            assert_eq!(paths[0].path_distance_end_px, Some(880.0));
            assert_eq!(paths[1].path_distance_start_px, Some(880.0));
            assert!(
                paths[1]
                    .path_distance_end_px
                    .is_some_and(|end| (end - 915.0).abs() < 1e-9)
            );
        }
    }
}

#[test]
fn curved_decoration_rebuild_preserves_phase_across_skip_ink_gaps() {
    let measured_path =
        measure_single_svg_path("M0 100C100 20 300 20 400 100").expect("open curved path");
    let phase_origin = 20.0;
    let interval_end = 360.0;
    let mut full_budget = 20_000;
    let full = rebuild_curved_decoration_interval(
        &measured_path,
        phase_origin,
        interval_end,
        phase_origin,
        PathTraversalDirection::Reverse,
        -8.0,
        2.0,
        TextDecorationStyle::Wavy,
        &mut full_budget,
    )
    .expect("full wavy interval");

    let mut retained_budget = 20_000;
    let before_gap = rebuild_curved_decoration_interval(
        &measured_path,
        phase_origin,
        148.0,
        phase_origin,
        PathTraversalDirection::Reverse,
        -8.0,
        2.0,
        TextDecorationStyle::Wavy,
        &mut retained_budget,
    )
    .expect("wavy interval before gap");
    let after_gap = rebuild_curved_decoration_interval(
        &measured_path,
        172.0,
        interval_end,
        phase_origin,
        PathTraversalDirection::Reverse,
        -8.0,
        2.0,
        TextDecorationStyle::Wavy,
        &mut retained_budget,
    )
    .expect("wavy interval after gap");
    let rebuilt = canonicalize_region(boundshape::Region {
        contours: before_gap
            .contours
            .into_iter()
            .chain(after_gap.contours)
            .collect(),
    });

    assert_ne!(region_to_path(&rebuilt), region_to_path(&full));
    assert!(rebuilt.contours.len() >= 2);
    let mut repeated_budget = 20_000;
    let repeated_after_gap = rebuild_curved_decoration_interval(
        &measured_path,
        172.0,
        interval_end,
        phase_origin,
        PathTraversalDirection::Reverse,
        -8.0,
        2.0,
        TextDecorationStyle::Wavy,
        &mut repeated_budget,
    )
    .expect("repeat wavy interval after gap");
    assert_eq!(
        region_to_path(&repeated_after_gap),
        region_to_path(
            &rebuild_curved_decoration_interval(
                &measured_path,
                172.0,
                interval_end,
                phase_origin,
                PathTraversalDirection::Reverse,
                -8.0,
                2.0,
                TextDecorationStyle::Wavy,
                &mut 20_000,
            )
            .expect("second repeat wavy interval")
        )
    );
}

#[test]
fn curved_dashed_rebuild_accepts_an_interval_inside_the_unpainted_phase() {
    let measured_path = measure_single_svg_path("M0 0L20 0").expect("straight path");
    let mut remaining_sample_budget = 100;
    let rebuilt = rebuild_curved_decoration_interval(
        &measured_path,
        7.0,
        9.0,
        0.0,
        PathTraversalDirection::Forward,
        4.0,
        2.0,
        TextDecorationStyle::Dashed,
        &mut remaining_sample_budget,
    )
    .expect("an unpainted dash-phase interval is valid empty geometry");

    assert!(rebuilt.contours.is_empty());
    assert_eq!(remaining_sample_budget, 100);
}

#[test]
fn fitting_and_ellipsis_enforce_the_cluster_resource_limit() {
    let registry = font_registry();
    let below_limit = "A".repeat(16_383);
    let below_result = layout_fitted(
        &registry,
        &below_limit,
        "M0 0L1000000 0",
        TextPathFit::Scale,
        TextPathOverflow::Error,
        0.0,
        TextPathAnchor::Start,
        None,
    )
    .expect("one below the cluster limit is accepted");
    assert_eq!(
        below_result.lines[0]
            .positioned_glyphs
            .as_ref()
            .map(Vec::len),
        Some(16_383),
    );

    let at_limit = "A".repeat(16_384);
    let result = layout_fitted(
        &registry,
        &at_limit,
        "M0 0L1000000 0",
        TextPathFit::Scale,
        TextPathOverflow::Error,
        0.0,
        TextPathAnchor::Start,
        None,
    )
    .expect("the exact cluster limit is accepted");
    assert_eq!(
        result.lines[0].positioned_glyphs.as_ref().map(Vec::len),
        Some(16_384),
    );

    let over_limit = "A".repeat(16_385);
    assert_eq!(
        layout_fitted(
            &registry,
            &over_limit,
            "M0 0L1000000 0",
            TextPathFit::Scale,
            TextPathOverflow::Hidden,
            0.0,
            TextPathAnchor::Start,
            None,
        )
        .expect_err("over-limit cluster sequence"),
        TextOnPathError::ClusterLimit,
    );
}
