//! Check ruby reservations against fixed full-width font metrics and natural shaping.

#![cfg(test)]

#[path = "support/ruby_rectangle_font.rs"]
mod rectangle_font;

use boundtext::font::shaping::{ShapeOptions, shape_text_with_options};
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::engine::layout_text_with_unit_metadata;
use boundtext::text::flow::{
    FitSearchKind, FlowBounds, FlowLayoutRequest, FlowRegion, RegionProvider, RegionQuery,
    layout_flow_with_regions,
};
use boundtext::text::rich::measure_intrinsic_inline_size;
use boundtext::text::types::{
    FitMode, Language, PositionedGlyph, RichTextNodeInput, RichTextStyleInput, TextLayoutRequest,
    TextOrientation, WhiteSpaceMode, WrapMode, WritingMode,
};
use boundtext::text::unit_map::{TextUnitKind, TextUnitRubyMode, build_text_unit_map_for_request};

/// Use the full-width Japanese fixture at the independently known 80px em size.
const BASE_SIZE_PX: f64 = 80.0;
/// Readings use half the base size, with a 40px advance for each full-width kana.
const READING_SIZE_PX: f64 = 40.0;
/// Compare geometry well below a font-unit step without weakening layout's fit tolerance.
const GEOMETRY_EPSILON_PX: f64 = 1e-8;

fn font_registry() -> FontRegistry {
    let mut registry = FontRegistry::new();
    registry
        .register(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
            ))
            .expect("read Japanese fixture"),
            "Noto".to_string(),
            400,
            FontStyle::Normal,
        )
        .expect("register Japanese fixture");
    registry
}

fn style(size: f64) -> RichTextStyleInput {
    serde_json::from_value(serde_json::json!({
        "fontFamily": ["Noto"], "fontWeight": 400, "fontSizePx": size,
        "lineHeight": 1.0,
    }))
    .expect("valid test style")
}

fn text(content: &str) -> RichTextNodeInput {
    RichTextNodeInput::Text {
        text: content.to_string(),
    }
}

fn ruby(align: &str) -> RichTextNodeInput {
    RichTextNodeInput::Ruby {
        ruby_position: None,
        ruby_align: Some(align.to_string()),
        ruby_gap_px: None,
        ruby_offset_px: None,
        ruby_line_sizing: None,
        style: style(BASE_SIZE_PX),
        base: vec![text("行")],
        rt: vec![RichTextNodeInput::Span {
            text: "おこな".to_string(),
            style: style(READING_SIZE_PX),
        }],
        rt_levels: Vec::new(),
    }
}

fn request(nodes: &[RichTextNodeInput], writing_mode: WritingMode) -> TextLayoutRequest<'_> {
    TextLayoutRequest {
        text: "",
        spans: None,
        rich_text: Some(nodes),
        font_size_px: BASE_SIZE_PX,
        line_height: Some(1.0),
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 1000.0,
        max_height: Some(1000.0),
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: None,
        ellipsis: false,
        language: Language::Ja,
        writing_mode,
        text_orientation: TextOrientation::Mixed,
        uax14_breaks: None,
        hanging_punctuation: false,
        font_variation_settings: Vec::new(),
        font_feature_settings: Vec::new(),
        min_font_size_px: Some(20.0),
        max_font_size_px: None,
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
        fit_max_probes: None,
    }
}

fn inline_origin(glyph: &PositionedGlyph, writing_mode: WritingMode) -> f64 {
    if writing_mode == WritingMode::HorizontalTb {
        glyph.origin_x - glyph.x_offset
    } else {
        glyph.origin_y - glyph.y_offset
    }
}

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < GEOMETRY_EPSILON_PX,
        "actual={actual}, expected={expected}"
    );
}

#[test]
fn fixture_metrics_independently_confirm_the_full_width_interval_oracle() {
    let registry = font_registry();
    let face = registry
        .resolve("Noto", 400, &FontStyle::Normal)
        .expect("fixture face");
    for mode in ["horizontal-tb", "vertical-rl"] {
        let options = ShapeOptions {
            writing_mode: Some(mode.to_string()),
            ..ShapeOptions::default()
        };
        for (content, size, expected) in [
            ("行", BASE_SIZE_PX, 80.0),
            ("う", BASE_SIZE_PX, 80.0),
            ("おこな", READING_SIZE_PX, 120.0),
        ] {
            let glyphs = shape_text_with_options(&registry, face, content, size, 0.0, &options)
                .expect("independent natural shape");
            let advance = glyphs
                .iter()
                .map(|glyph| {
                    if mode == "vertical-rl" {
                        glyph.y_advance.abs()
                    } else {
                        glyph.x_advance
                    }
                })
                .sum::<f64>();
            assert_close(advance, expected);
        }
    }
}

#[test]
fn long_readings_preserve_natural_cluster_spacing_for_every_align_and_axis() {
    let registry = font_registry();
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
    for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
        let options = ShapeOptions {
            writing_mode: Some(
                if writing_mode == WritingMode::VerticalRl {
                    "vertical-rl"
                } else {
                    "horizontal-tb"
                }
                .to_string(),
            ),
            ..ShapeOptions::default()
        };
        let natural =
            shape_text_with_options(&registry, face, "おこな", READING_SIZE_PX, 0.0, &options)
                .expect("natural reading shape");
        assert_eq!(natural.len(), 3);
        for align in ["space-around", "space-between", "center", "start"] {
            let nodes = vec![ruby(align), text("う")];
            let layout = layout_text_with_unit_metadata(&request(&nodes, writing_mode), &context)
                .expect("ruby layout");
            let glyphs = layout.lines[0]
                .positioned_glyphs
                .as_deref()
                .expect("settled glyphs");
            let reading = glyphs
                .iter()
                .filter(|glyph| glyph.source_role.as_deref() == Some("rubyAnnotation"))
                .collect::<Vec<_>>();
            assert_eq!(reading.len(), 3);
            for (pair, shaped) in reading.windows(2).zip(&natural) {
                let advance = if writing_mode == WritingMode::VerticalRl {
                    shaped.y_advance.abs()
                } else {
                    shaped.x_advance
                };
                assert_close(
                    inline_origin(pair[1], writing_mode) - inline_origin(pair[0], writing_mode),
                    advance,
                );
                assert_close(advance, READING_SIZE_PX);
            }
            let base = glyphs
                .iter()
                .find(|glyph| glyph.source_role.as_deref() == Some("rubyBase"))
                .expect("base glyph");
            let kana = glyphs
                .iter()
                .find(|glyph| glyph.text == "う")
                .expect("neighbor glyph");
            assert_close(
                inline_origin(base, writing_mode),
                if align == "start" { 0.0 } else { 20.0 },
            );
            assert_close(
                inline_origin(kana, writing_mode),
                if align == "start" { 80.0 } else { 100.0 },
            );
        }
    }
}

#[test]
fn missing_or_shared_lenders_have_analytic_reservation_widths() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let font_style = FontStyle::Normal;
    let context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &font_style,
    };
    let cases = [
        (vec![ruby("center")], 120.0),
        (vec![ruby("center"), text("う")], 180.0),
        (vec![text("う"), ruby("center")], 180.0),
        (vec![ruby("center"), ruby("center")], 240.0),
        (vec![ruby("center"), text("う"), ruby("center")], 280.0),
        (vec![text("行"), ruby("center")], 200.0),
        (vec![ruby("start"), text("う")], 160.0),
    ];
    for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
        for (nodes, expected_width) in &cases {
            let intrinsic = measure_intrinsic_inline_size(&request(nodes, writing_mode), &context)
                .expect("intrinsic size");
            assert_close(intrinsic.max_content_inline_size, *expected_width);
            assert_close(intrinsic.min_content_inline_size, 120.0);
        }
    }
}

#[test]
fn wrapping_removes_the_loan_and_keeps_an_overwide_ruby_atomic() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let font_style = FontStyle::Normal;
    let context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &font_style,
    };
    let nodes = vec![ruby("center"), text("う")];
    for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
        for (width, expected_lines) in [(180.0, 1), (179.0, 2), (80.0, 2)] {
            let mut layout_request = request(&nodes, writing_mode);
            if writing_mode == WritingMode::HorizontalTb {
                layout_request.max_width = width;
            } else {
                layout_request.max_height = Some(width);
            }
            let layout = layout_text_with_unit_metadata(&layout_request, &context)
                .expect("wrapped ruby layout");
            assert_eq!(
                layout.lines.len(),
                expected_lines,
                "width={width}, mode={writing_mode:?}"
            );
            let first_glyphs = layout.lines[0]
                .positioned_glyphs
                .as_deref()
                .expect("settled first line");
            let reading = first_glyphs
                .iter()
                .filter(|glyph| glyph.source_role.as_deref() == Some("rubyAnnotation"))
                .collect::<Vec<_>>();
            assert_eq!(reading.len(), 3);
            assert_close(
                inline_origin(reading[2], writing_mode) - inline_origin(reading[0], writing_mode),
                80.0,
            );
        }
    }
}

#[test]
fn shrink_fit_uses_the_center_fixed_180px_width() {
    let registry = font_registry();
    let families = vec!["Noto".to_string()];
    let font_style = FontStyle::Normal;
    let context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &font_style,
    };
    let nodes = vec![ruby("center"), text("う")];
    let mut layout_request = request(&nodes, WritingMode::HorizontalTb);
    layout_request.max_width = 100.0;
    layout_request.max_lines = Some(1);
    layout_request.fit = FitMode::Shrink;
    let layout = layout_text_with_unit_metadata(&layout_request, &context).expect("shrink ruby");
    // Natural frames give width = 2.25 * size; binary fit keeps its 0.25px bracket.
    assert!(layout.chosen_font_size_px <= 100.0 / 2.25);
    assert!(100.0 / 2.25 - layout.chosen_font_size_px <= 0.25);
    assert_eq!(layout.lines.len(), 1);
}

#[test]
fn inward_annotations_do_not_gain_a_loan_as_size_increases() {
    let registry = rectangle_font::registry().expect("analytical rectangle font");
    let families = vec!["Noto".to_string()];
    let font_style = FontStyle::Normal;
    let context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &font_style,
    };
    let nodes = vec![ruby("center"), text("ァ")];
    let mut layout_request = request(&nodes, WritingMode::HorizontalTb);
    layout_request.wrap = WrapMode::None;
    layout_request.min_font_size_px = Some(8.0);
    layout_request.shrink_epsilon_px = Some(0.25);
    layout_request.max_width = 116.0;
    layout_request.fit_max_probes = Some(1);

    // These intervals follow directly from the fixture's 1000-unit rectangles:
    // at 49px the annotation intersects the lender; at 51px it lies inward of it.
    // Neither can borrow, so the natural reserved width is 2.5 * size throughout.
    let mut small = layout_request.clone();
    small.font_size_px = 49.0;
    let mut large = layout_request.clone();
    large.font_size_px = 51.0;
    let small_nodes = vec![scaled_ruby(49.0), text("ァ")];
    let large_nodes = vec![scaled_ruby(51.0), text("ァ")];
    small.rich_text = Some(&small_nodes);
    large.rich_text = Some(&large_nodes);
    let smaller = layout_text_with_unit_metadata(&small, &context).expect("49px layout");
    let larger = layout_text_with_unit_metadata(&large, &context).expect("51px layout");
    assert_close(smaller.bbox.w, 122.5);
    assert_close(larger.bbox.w, 127.5);
    assert!(larger.bbox.w >= smaller.bbox.w);

    layout_request.fit = FitMode::Shrink;
    let result =
        layout_text_with_unit_metadata(&layout_request, &context).expect("existing binary fit");
    assert!(result.chosen_font_size_px <= 116.0 / 2.5);
    assert!(116.0 / 2.5 - result.chosen_font_size_px <= 0.25);
    assert!(result.lines[0].width <= 116.0);
}

fn scaled_ruby(size: f64) -> RichTextNodeInput {
    RichTextNodeInput::Ruby {
        ruby_position: None,
        ruby_align: Some("center".to_string()),
        ruby_gap_px: None,
        ruby_offset_px: None,
        ruby_line_sizing: None,
        style: style(size),
        base: vec![text("行")],
        rt: vec![annotation("おこな", size * 0.5)],
        rt_levels: Vec::new(),
    }
}

#[test]
fn outward_loan_loss_and_adjacent_contact_floats_never_reduce_width() {
    in_context(
        &rectangle_font::registry().expect("rectangle font"),
        |context| {
            // Base top is 0.899 * size, lender top is 0.905 * size, and
            // ink stabilization leaves 1px. The outward gap is 1 - 0.006 * size.
            // Below contact width is 2.25 * size; above it width is 2.5 * size.
            let contact = 1.0_f64 / 0.006;
            let mut sizes = (0..=400)
                .map(|index| 100.0 + f64::from(index) * 0.25)
                .collect::<Vec<_>>();
            sizes.extend([
                contact.next_down().next_down(),
                contact.next_down(),
                contact,
                contact.next_up(),
                contact.next_up().next_up(),
            ]);
            sizes.sort_by(f64::total_cmp);
            let mut previous_width = 0.0;
            for size in sizes {
                let nodes = vec![scaled_ruby(size), text("ぃ")];
                let mut layout_request = request(&nodes, WritingMode::HorizontalTb);
                layout_request.font_size_px = size;
                let result = layout_text_with_unit_metadata(&layout_request, context)
                    .expect("outward contact layout");
                let width = result.lines[0].width;
                assert!(
                    width >= previous_width,
                    "width decreased at {size}: {previous_width} -> {width}"
                );
                assert!(width >= 2.25 * size - GEOMETRY_EPSILON_PX);
                assert!(width <= 2.5 * size + GEOMETRY_EPSILON_PX);
                if size <= 166.0 {
                    assert_close(width, 2.25 * size);
                } else if size >= 167.0 {
                    assert_close(width, 2.5 * size);
                }
                previous_width = width;
            }
        },
    );
}

#[test]
fn both_sides_and_axes_share_cells_and_grow_limits() {
    in_context(&font_registry(), |context| {
        for mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            for position in ["over", "under"] {
                let mut annotation = ruby("center");
                if let RichTextNodeInput::Ruby { ruby_position, .. } = &mut annotation {
                    *ruby_position = Some(position.to_string());
                }
                let nodes = vec![annotation, text("う")];
                let layout_request = request(&nodes, mode);
                let ordinary = layout_text_with_unit_metadata(&layout_request, context)
                    .expect("axis and side layout");
                let intrinsic = measure_intrinsic_inline_size(&layout_request, context)
                    .expect("axis and side intrinsic");
                assert_close(ordinary.lines[0].width, 180.0);
                assert_close(intrinsic.max_content_inline_size, 180.0);
                let mut flow = flow_request(&nodes, mode);
                flow.fit = Some("grow");
                flow.max_font_size_px = Some(120.0);
                flow.fit_max_probes = Some(1);
                let grown = layout_flow_with_regions(
                    &flow,
                    context,
                    &RectRegions {
                        inline_start: if mode == WritingMode::HorizontalTb {
                            10.0
                        } else {
                            20.0
                        },
                        capacity: 270.0,
                    },
                )
                .expect("provider-certified grow");
                assert_close(grown.chosen_font_size_px.expect("grown size"), 120.0);
                assert_close(
                    grown.lines[0]
                        .fragments
                        .iter()
                        .map(|fragment| fragment.inline_advance_px)
                        .sum(),
                    270.0,
                );
                let mut grow = layout_request;
                grow.fit = FitMode::Grow;
                grow.max_font_size_px = Some(120.0);
                grow.fit_max_probes = Some(1);
                if mode == WritingMode::HorizontalTb {
                    grow.max_width = 270.0;
                } else {
                    grow.max_height = Some(270.0);
                }
                let grown = layout_text_with_unit_metadata(&grow, context).expect("ordinary grow");
                assert_close(grown.chosen_font_size_px, 120.0);
                assert_close(grown.lines[0].width, 270.0);
            }
        }
    });
}

#[test]
fn distinct_faces_two_levels_variations_and_absolute_line_boxes_share_measurement() {
    let mut registry = font_registry();
    registry
        .register(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../fixtures/fonts/NotoSansCJKjp-VF.subset.ttf"
            ))
            .expect("variable Japanese fixture"),
            "Variable".to_string(),
            400,
            FontStyle::Normal,
        )
        .expect("register variable face");
    in_context(&registry, |context| {
        for mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            for position in ["over", "under"] {
                for offset in [0.0, 12.0] {
                    let mut first_style = style(40.0);
                    first_style.font_family = vec!["Variable".to_string()];
                    first_style.font_variation_settings = Some("'wght' 700".to_string());
                    first_style.line_height = None;
                    first_style.line_height_px = Some(56.0);
                    let first = RichTextNodeInput::Span {
                        text: "おこな".to_string(),
                        style: first_style,
                    };
                    let mut second_style = style(48.0);
                    second_style.line_height = None;
                    second_style.line_height_px = Some(64.0);
                    let second = RichTextNodeInput::Span {
                        text: "おこな".to_string(),
                        style: second_style,
                    };
                    let mut node = ruby("center");
                    if let RichTextNodeInput::Ruby {
                        ruby_position,
                        ruby_offset_px,
                        style: base_style,
                        rt_levels,
                        ..
                    } = &mut node
                    {
                        *ruby_position = Some(position.to_string());
                        *ruby_offset_px = Some(offset);
                        base_style.line_height = None;
                        base_style.line_height_px = Some(112.0);
                        *rt_levels = vec![vec![first], vec![second]];
                    }
                    let nodes = vec![node, text("う")];
                    let layout_request = request(&nodes, mode);
                    let ordinary = layout_text_with_unit_metadata(&layout_request, context)
                        .expect("styled two-level layout");
                    let intrinsic = measure_intrinsic_inline_size(&layout_request, context)
                        .expect("styled two-level intrinsic");
                    let flow = layout_flow_with_regions(
                        &flow_request(&nodes, mode),
                        context,
                        &RectRegions {
                            inline_start: if mode == WritingMode::HorizontalTb {
                                10.0
                            } else {
                                20.0
                            },
                            capacity: 1000.0,
                        },
                    )
                    .expect("styled two-level flow");
                    assert_close(ordinary.lines[0].width, intrinsic.max_content_inline_size);
                    assert_close(
                        ordinary.lines[0].width,
                        flow.lines[0]
                            .fragments
                            .iter()
                            .map(|fragment| fragment.inline_advance_px)
                            .sum(),
                    );
                    let readings = ordinary.lines[0]
                        .positioned_glyphs
                        .as_ref()
                        .expect("glyphs")
                        .iter()
                        .filter(|glyph| glyph.source_role.as_deref() == Some("rubyAnnotation"))
                        .collect::<Vec<_>>();
                    assert_eq!(readings.len(), 6);
                    assert_eq!(
                        readings
                            .iter()
                            .map(|glyph| glyph.decoration_level)
                            .collect::<std::collections::BTreeSet<_>>(),
                        std::collections::BTreeSet::from([Some(0), Some(1)])
                    );
                }
            }
        }
    });
}

fn in_context<T>(registry: &FontRegistry, run: impl FnOnce(&FontContext<'_>) -> T) -> T {
    let families = vec!["Noto".to_string()];
    let font_style = FontStyle::Normal;
    run(&FontContext {
        registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &font_style,
    })
}

fn annotation(reading: &str, size: f64) -> RichTextNodeInput {
    RichTextNodeInput::Span {
        text: reading.to_string(),
        style: style(size),
    }
}

fn set_reading(node: &mut RichTextNodeInput, reading: &str, size: f64) {
    let RichTextNodeInput::Ruby { rt, .. } = node else {
        panic!("expected an authored Ruby fixture")
    };
    *rt = vec![annotation(reading, size)];
}

fn inline_box(children: Vec<RichTextNodeInput>) -> RichTextNodeInput {
    RichTextNodeInput::InlineBox {
        style: style(BASE_SIZE_PX),
        children,
        padding_inline: Some([8.0, 8.0]),
        background: None,
        border_color: None,
        border_width: None,
        border_radius: None,
        span_key: None,
    }
}

#[test]
fn atomic_box_internals_share_cells_and_never_borrow_across_the_box_edge() {
    in_context(&font_registry(), |context| {
        for mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            for (nodes, expected) in [
                (vec![inline_box(vec![ruby("center"), text("う")])], 196.0),
                (vec![inline_box(vec![ruby("center")]), text("う")], 216.0),
                (vec![text("う"), inline_box(vec![ruby("center")])], 216.0),
            ] {
                let layout = layout_text_with_unit_metadata(&request(&nodes, mode), context)
                    .expect("atomic ruby cells");
                assert_close(
                    if mode == WritingMode::HorizontalTb {
                        layout.bbox.w
                    } else {
                        layout.bbox.h
                    },
                    expected,
                );
            }
        }
    });
}

#[test]
fn shared_lender_halves_and_multiple_levels_use_maximum_remaining_demand() {
    in_context(&font_registry(), |context| {
        let mut long = ruby("center");
        set_reading(&mut long, "おこなおこ", 40.0);
        let mut levels = ruby("center");
        if let RichTextNodeInput::Ruby { rt_levels, .. } = &mut levels {
            rt_levels.push(vec![annotation("おこなおこ", 40.0)]);
        }
        for mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            for (nodes, expected) in [
                (vec![long.clone(), text("う"), long.clone()], 400.0),
                (vec![levels.clone(), text("う")], 240.0),
            ] {
                let intrinsic = measure_intrinsic_inline_size(&request(&nodes, mode), context)
                    .expect("multi-level intrinsic");
                assert_close(intrinsic.max_content_inline_size, expected);
            }
        }
    });
}

#[test]
fn tracking_does_not_increase_lending_capacity_and_large_neighbor_ink_blocks_it() {
    in_context(&font_registry(), |context| {
        let mut wide = ruby("center");
        set_reading(&mut wide, "おこな", 80.0);
        for (tracking, expected) in [(80.0, 440.0), (-40.0, 340.0)] {
            let mut lender_style = style(80.0);
            lender_style.letter_spacing_px = Some(tracking);
            let nodes = vec![
                wide.clone(),
                RichTextNodeInput::Span {
                    text: "う".to_string(),
                    style: lender_style,
                },
                text("漢"),
            ];
            let intrinsic =
                measure_intrinsic_inline_size(&request(&nodes, WritingMode::HorizontalTb), context)
                    .expect("tracked loan");
            assert_close(intrinsic.max_content_inline_size, expected);
        }
        let nodes = vec![
            ruby("center"),
            RichTextNodeInput::Span {
                text: "う".to_string(),
                style: style(160.0),
            },
        ];
        let intrinsic =
            measure_intrinsic_inline_size(&request(&nodes, WritingMode::HorizontalTb), context)
                .expect("large neighboring ink");
        assert_close(intrinsic.max_content_inline_size, 280.0);
    });
}

#[test]
fn kana_scalar_allowlist_and_hanging_punctuation_keep_their_boundaries() {
    in_context(&font_registry(), |context| {
        for kana in ["う", "ウ", "ー", "う\u{3099}"] {
            let nodes = vec![ruby("center"), text(kana)];
            let natural = shape_text_with_options(
                context.registry,
                context
                    .registry
                    .resolve("Noto", 400, &FontStyle::Normal)
                    .expect("face"),
                kana,
                80.0,
                0.0,
                &ShapeOptions::default(),
            )
            .expect("kana shape");
            let width = natural.iter().map(|glyph| glyph.x_advance).sum::<f64>();
            let intrinsic =
                measure_intrinsic_inline_size(&request(&nodes, WritingMode::HorizontalTb), context)
                    .expect("kana lender");
            assert_close(intrinsic.max_content_inline_size, 100.0 + width);
        }
        for (punctuation, hanging, expected) in [
            ("、", false, 180.0),
            ("、", true, 200.0),
            ("。", true, 200.0),
            ("漢", false, 200.0),
        ] {
            let nodes = vec![ruby("center"), text(punctuation)];
            let mut layout_request = request(&nodes, WritingMode::HorizontalTb);
            layout_request.hanging_punctuation = hanging;
            let intrinsic = measure_intrinsic_inline_size(&layout_request, context)
                .expect("punctuation lender");
            assert_close(intrinsic.max_content_inline_size, expected);
        }
    });
}

#[test]
fn reserve_creates_no_units_and_ellipsis_cannot_keep_a_clipped_reading() {
    in_context(&font_registry(), |context| {
        let nodes = vec![ruby("center"), text("う")];
        let mut layout_request = request(&nodes, WritingMode::HorizontalTb);
        let layout = layout_text_with_unit_metadata(&layout_request, context)
            .expect("settled source identity");
        let grouped = build_text_unit_map_for_request(
            &layout,
            &layout_request,
            context,
            TextUnitKind::Cluster,
            TextUnitRubyMode::WithBase,
        )
        .expect("grouped units");
        let separate = build_text_unit_map_for_request(
            &layout,
            &layout_request,
            context,
            TextUnitKind::Cluster,
            TextUnitRubyMode::Separate,
        )
        .expect("separate units");
        assert_eq!(grouped.units.len(), 2);
        assert_eq!(separate.units.len(), 5);
        assert_eq!(
            separate.units.iter().flat_map(|unit| &unit.members).count(),
            5
        );
        layout_request.max_width = 80.0;
        layout_request.max_lines = Some(1);
        layout_request.ellipsis = true;
        let ellipsized =
            layout_text_with_unit_metadata(&layout_request, context).expect("atomic ruby ellipsis");
        assert!(
            ellipsized
                .lines
                .iter()
                .flat_map(|line| line.positioned_glyphs.iter().flatten())
                .all(|glyph| glyph.source_role.as_deref() != Some("rubyAnnotation"))
        );
    });
}

struct RectRegions {
    inline_start: f64,
    capacity: f64,
}

impl RegionProvider for RectRegions {
    fn regions(&self, _: RegionQuery) -> Result<Vec<FlowRegion>, boundtext::RegionProviderError> {
        Ok(vec![FlowRegion {
            inline_start_px: self.inline_start,
            inline_size_px: self.capacity,
        }])
    }
    fn fit_search_kind(&self) -> FitSearchKind {
        FitSearchKind::CertifiedMonotone
    }
}

fn flow_request(nodes: &[RichTextNodeInput], mode: WritingMode) -> FlowLayoutRequest<'_> {
    FlowLayoutRequest {
        text: "",
        font_size_px: 80.0,
        line_height: Some(1.0),
        line_height_px: None,
        letter_spacing_px: 0.0,
        language: Language::Ja,
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        hanging_punctuation: false,
        flow_bounds: FlowBounds {
            x: 10.0,
            y: 20.0,
            width: 1000.0,
            height: 1000.0,
        },
        min_region_width: None,
        max_lines: None,
        ellipsis: false,
        fit: None,
        spans: None,
        rich_text: Some(nodes),
        writing_mode: mode,
        text_orientation: None,
        min_font_size_px: Some(8.0),
        max_font_size_px: None,
        fit_epsilon_px: Some(0.25),
        fit_max_iterations: None,
        fit_max_probes: None,
        shape_options: ShapeOptions::default(),
    }
}

#[test]
fn flow_cells_and_native_glyphs_share_the_nonzero_frame() {
    in_context(&font_registry(), |context| {
        let nodes = vec![ruby("center"), text("う")];
        for mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            let layout_request = flow_request(&nodes, mode);
            let start = if mode == WritingMode::HorizontalTb {
                10.0
            } else {
                20.0
            };
            let result = layout_flow_with_regions(
                &layout_request,
                context,
                &RectRegions {
                    inline_start: start,
                    capacity: 180.0,
                },
            )
            .expect("native rich flow");
            assert_eq!(result.lines.len(), 1);
            let fragments = &result.lines[0].fragments;
            assert_eq!(fragments.len(), 2);
            assert_close(fragments[0].inline_advance_px, 100.0);
            assert_close(fragments[1].inline_advance_px, 80.0);
            let base = fragments[0]
                .positioned_glyphs
                .iter()
                .find(|glyph| glyph.source_role.as_deref() == Some("rubyBase"))
                .expect("settled flow base");
            assert_close(inline_origin(base, mode), start + 20.0);
            let reading = fragments[0]
                .positioned_glyphs
                .iter()
                .find(|glyph| glyph.source_role.as_deref() == Some("rubyAnnotation"))
                .expect("settled flow reading");
            assert_close(inline_origin(reading, mode), start);
        }
    });
}

#[test]
fn outward_ruby_retains_a_providers_binary_fit_certificate() {
    in_context(
        &rectangle_font::registry().expect("rectangle font"),
        |context| {
            let nodes = vec![ruby("center"), text("ァ")];
            let mut layout_request = flow_request(&nodes, WritingMode::HorizontalTb);
            layout_request.max_lines = Some(1);
            layout_request.fit = Some("shrink");
            layout_request.fit_max_probes = Some(1);
            let result = layout_flow_with_regions(
                &layout_request,
                context,
                &RectRegions {
                    inline_start: 10.0,
                    capacity: 116.0,
                },
            )
            .expect("certified rich flow fit");
            let selected = result.chosen_font_size_px.expect("selected flow size");
            assert!(selected <= 116.0 / 2.5);
            assert!(116.0 / 2.5 - selected <= 0.25);
        },
    );
}

#[test]
fn an_empty_reading_preserves_its_atomic_base() {
    in_context(&font_registry(), |context| {
        let mut base_only = ruby("center");
        if let RichTextNodeInput::Ruby { rt, .. } = &mut base_only {
            rt.clear();
        }
        let nodes = vec![base_only, text("う")];
        let layout =
            layout_text_with_unit_metadata(&request(&nodes, WritingMode::HorizontalTb), context)
                .expect("base without reading");
        assert_close(layout.bbox.w, 160.0);
        assert_eq!(layout.lines[0].text, "行う");
    });
}

#[test]
fn negative_base_tracking_keeps_signed_shaping_and_reserves_a_finite_cell() {
    in_context(
        &rectangle_font::registry().expect("rectangle font"),
        |context| {
            for (base_tracking, reading, leading_kana, expected_width, expected_base_delta) in [
                (-200.0, "おこな", false, 160.0, -120.0),
                (-560.0, "お", true, 160.0, -480.0),
            ] {
                let mut node = ruby("center");
                let mut base_style = style(80.0);
                base_style.letter_spacing_px = Some(base_tracking);
                if let RichTextNodeInput::Ruby { base, .. } = &mut node {
                    *base = vec![RichTextNodeInput::Span {
                        text: "行行".to_string(),
                        style: base_style,
                    }];
                }
                set_reading(&mut node, reading, 40.0);
                let mut nodes = Vec::new();
                if leading_kana {
                    nodes.push(text("う"));
                }
                nodes.extend([node, text("う")]);
                let mut layout_request = request(&nodes, WritingMode::HorizontalTb);
                layout_request.wrap = WrapMode::None;
                let layout = layout_text_with_unit_metadata(&layout_request, context)
                    .expect("accepted negative base tracking");
                assert_close(layout.lines[0].width, expected_width);
                let glyphs = layout.lines[0]
                    .positioned_glyphs
                    .as_ref()
                    .expect("settled glyphs");
                let base = glyphs
                    .iter()
                    .filter(|glyph| glyph.source_role.as_deref() == Some("rubyBase"))
                    .collect::<Vec<_>>();
                assert_eq!(base.len(), 2);
                assert_close(base[1].origin_x - base[0].origin_x, expected_base_delta);
                assert!(
                    glyphs
                        .iter()
                        .all(|glyph| glyph.origin_x.is_finite() && glyph.origin_y.is_finite())
                );
                if leading_kana {
                    let reading = glyphs
                        .iter()
                        .find(|glyph| glyph.source_role.as_deref() == Some("rubyAnnotation"))
                        .expect("reading");
                    assert_close(reading.origin_x, 60.0);
                }
            }
        },
    );
}

#[test]
fn ordinary_ruby_preserves_legacy_fit_budget_success() {
    in_context(&font_registry(), |context| {
        let nodes = vec![ruby("center"), text("う")];
        let mut layout_request = request(&nodes, WritingMode::HorizontalTb);
        layout_request.wrap = WrapMode::None;
        layout_request.max_width = 100.0;
        layout_request.min_font_size_px = Some(8.0);
        layout_request.shrink_epsilon_px = Some(0.25);
        layout_request.shrink_max_iterations = Some(12);
        layout_request.fit_max_probes = Some(12);
        layout_request.fit = FitMode::Shrink;
        let layout = layout_text_with_unit_metadata(&layout_request, context)
            .expect("ordinary ruby keeps its supported fit budget");
        assert!(layout.lines[0].width <= layout_request.max_width);
    });
}

#[test]
fn ruby_retains_uncertified_grid_limits_invalid_steps_and_cannot_fit() {
    in_context(&font_registry(), |context| {
        let mut annotation = ruby("center");
        if let RichTextNodeInput::Ruby { ruby_offset_px, .. } = &mut annotation {
            *ruby_offset_px = Some(-1.0);
        }
        let nodes = vec![annotation, text("う")];
        let mut layout_request = request(&nodes, WritingMode::HorizontalTb);
        layout_request.fit = FitMode::Shrink;
        layout_request.wrap = WrapMode::None;
        layout_request.min_font_size_px = Some(8.0);
        layout_request.shrink_epsilon_px = Some(0.25);
        layout_request.fit_max_probes = Some(1);
        assert!(matches!(
            layout_text_with_unit_metadata(&layout_request, context),
            Err(boundtext::TextLayoutError::FitProbeLimit {
                required: 289,
                limit: 1
            })
        ));
        layout_request.shrink_epsilon_px = Some(0.0);
        assert!(matches!(
            layout_text_with_unit_metadata(&layout_request, context),
            Err(boundtext::TextLayoutError::InvalidFitStep)
        ));
        let ordinary_nodes = vec![ruby("center"), text("う")];
        let mut cannot_fit = request(&ordinary_nodes, WritingMode::HorizontalTb);
        cannot_fit.fit = FitMode::Shrink;
        cannot_fit.wrap = WrapMode::None;
        cannot_fit.max_width = 1.0;
        cannot_fit.min_font_size_px = Some(8.0);
        let result =
            layout_text_with_unit_metadata(&cannot_fit, context).expect("typed cannot-fit result");
        assert_eq!(result.overflow.overflow_type, "cannot_fit");
    });
}

#[test]
fn large_ruby_preserves_legacy_fit_budget_success() {
    in_context(&font_registry(), |context| {
        let nodes = vec![scaled_ruby(1200.0), text("う")];
        let mut layout_request = request(&nodes, WritingMode::HorizontalTb);
        layout_request.font_size_px = 1200.0;
        layout_request.wrap = WrapMode::None;
        layout_request.max_width = 1500.0;
        layout_request.min_font_size_px = Some(8.0);
        layout_request.shrink_epsilon_px = Some(0.25);
        layout_request.shrink_max_iterations = Some(12);
        layout_request.fit = FitMode::Shrink;
        let layout = layout_text_with_unit_metadata(&layout_request, context)
            .expect("large ruby keeps its supported default fit budget");
        assert!(layout.lines[0].width <= layout_request.max_width);
    });
}
