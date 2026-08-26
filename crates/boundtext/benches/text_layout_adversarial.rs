//! Deterministic adversarial benchmark for exact ellipsis, fit, and UnitMap work.

use std::time::Instant;

use boundtext::font::shaping::ShapeOptions;
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::phase_trace::{TextWorkCounters, reset_work, snapshot_work};
use boundtext::text::engine::layout_text_with_unit_metadata;
use boundtext::text::flow::{
    FitSearchKind, FlowBounds, FlowLayoutRequest, FlowRegion, RegionProvider, RegionQuery,
    layout_flow_with_regions,
};
use boundtext::text::types::{
    FitMode, InlineRectInput, Language, RichTextNodeInput, RichTextStyleInput, TextLayoutRequest,
    TextOrientation, WhiteSpaceMode, WrapMode, WritingMode,
};
use boundtext::text::unit_map::{TextUnitKind, TextUnitRubyMode, build_text_unit_map_for_request};

type BenchmarkResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

#[derive(Clone, Copy)]
struct InputStats {
    input_bytes: usize,
    canonical_nodes: usize,
    resolved_runs: usize,
    max_depth: usize,
    source_boundaries: usize,
    atomic_items: usize,
    exclusions: usize,
    geometry_segments: usize,
    projected_units: usize,
    visible_unit_drafts: usize,
    unit_member_refs: usize,
}

fn registry() -> BenchmarkResult<FontRegistry> {
    let mut registry = FontRegistry::new();
    let font_bytes = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
    ))?;
    registry.register(font_bytes, "Noto".to_string(), 400, FontStyle::Normal)?;
    Ok(registry)
}

fn vm_hwm_kib() -> Option<usize> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    status.lines().find_map(|line| {
        line.strip_prefix("VmHWM:")?
            .split_whitespace()
            .next()?
            .parse()
            .ok()
    })
}

fn print_result(
    scenario: &str,
    elapsed_micros: u128,
    stats: InputStats,
    counters: TextWorkCounters,
) {
    println!(
        concat!(
            "{{\"scenario\":\"{}\",\"elapsedMicros\":{},\"vmHwmKiB\":{},",
            "\"inputBytes\":{},\"canonicalNodes\":{},\"resolvedRuns\":{},",
            "\"maxDepth\":{},\"sourceBoundaries\":{},\"atomicItems\":{},",
            "\"exclusions\":{},\"geometrySegments\":{},",
            "\"projectedUnits\":{},\"visibleUnitDrafts\":{},\"unitMemberRefs\":{},",
            "\"ellipsisCandidates\":{},\"ellipsisWordBoundaryPreparations\":{},",
            "\"fitProbes\":{},",
            "\"regionQueries\":{},\"returnedRegions\":{},",
            "\"shapeCalls\":{},\"shapedGlyphs\":{},",
            "\"materializedLines\":{},\"materializedGlyphs\":{},",
            "\"materializedDecorations\":{},\"materializedInlineRects\":{}}}"
        ),
        scenario,
        elapsed_micros,
        vm_hwm_kib().unwrap_or_default(),
        stats.input_bytes,
        stats.canonical_nodes,
        stats.resolved_runs,
        stats.max_depth,
        stats.source_boundaries,
        stats.atomic_items,
        stats.exclusions,
        stats.geometry_segments,
        stats.projected_units,
        stats.visible_unit_drafts,
        stats.unit_member_refs,
        counters.ellipsis_candidates,
        counters.ellipsis_word_boundary_preparations,
        counters.fit_probes,
        counters.region_queries,
        counters.returned_regions,
        counters.backend_shape_calls,
        counters.shaped_glyphs,
        counters.materialized_lines,
        counters.materialized_glyphs,
        counters.materialized_decorations,
        counters.materialized_inline_rects,
    );
}

fn benchmark_exact_ellipsis(font_context: &FontContext<'_>) -> BenchmarkResult {
    let text = "あ".repeat(256);
    let request = TextLayoutRequest {
        text: &text,
        spans: None,
        rich_text: None,
        font_size_px: 24.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: -1.0,
        text_indent: None,
        max_width: 48.0,
        max_height: None,
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: Some(1),
        ellipsis: true,
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
        fit_max_probes: None,
    };

    reset_work();
    let started = Instant::now();
    let layout_result = layout_text_with_unit_metadata(&request, font_context)?;
    let elapsed = started.elapsed();
    assert!(
        layout_result
            .display_text
            .as_deref()
            .is_some_and(|text| text.ends_with('\u{2026}'))
    );
    print_result(
        "exact-ellipsis-256",
        elapsed.as_micros(),
        InputStats {
            input_bytes: text.len(),
            canonical_nodes: 1,
            resolved_runs: 1,
            max_depth: 1,
            source_boundaries: 256,
            atomic_items: 0,
            exclusions: 0,
            geometry_segments: 0,
            projected_units: 0,
            visible_unit_drafts: 0,
            unit_member_refs: 0,
        },
        snapshot_work(),
    );
    Ok(())
}

fn benchmark_ellipsis_candidate_budget(font_context: &FontContext<'_>) -> BenchmarkResult {
    let text = "あ".repeat(1_025);
    let request = TextLayoutRequest {
        text: &text,
        spans: None,
        rich_text: None,
        font_size_px: 24.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 1.0,
        max_height: None,
        wrap: WrapMode::Word,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: Some(1),
        ellipsis: true,
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
        fit_max_probes: None,
    };

    reset_work();
    let started = Instant::now();
    let Err(error) = layout_text_with_unit_metadata(&request, font_context) else {
        return Err(std::io::Error::other(
            "candidate budget did not reject before exact-prefix shaping",
        )
        .into());
    };
    let elapsed = started.elapsed();
    assert_eq!(
        error,
        boundtext::TextLayoutError::EllipsisCandidateLimit {
            required: 1_026,
            limit: 1_024,
        }
    );
    let counters = snapshot_work();
    assert_eq!(counters.ellipsis_candidates, 0);
    assert_eq!(counters.ellipsis_word_boundary_preparations, 1);
    print_result(
        "word-ellipsis-candidate-budget-1024",
        elapsed.as_micros(),
        InputStats {
            input_bytes: text.len(),
            canonical_nodes: 1,
            resolved_runs: 1,
            max_depth: 1,
            source_boundaries: 1_025,
            atomic_items: 0,
            exclusions: 0,
            geometry_segments: 0,
            projected_units: 0,
            visible_unit_drafts: 0,
            unit_member_refs: 0,
        },
        counters,
    );
    Ok(())
}

struct UncertifiedRectProvider;

impl RegionProvider for UncertifiedRectProvider {
    fn regions(&self, query: RegionQuery) -> Result<Vec<FlowRegion>, boundtext::BoundtextError> {
        if query.cross_start_px >= 0.0 && query.cross_end_px <= 72.0 {
            Ok(vec![FlowRegion {
                inline_start_px: 0.0,
                inline_size_px: 96.0,
            }])
        } else {
            Ok(Vec::new())
        }
    }

    fn fit_search_kind(&self) -> FitSearchKind {
        FitSearchKind::Uncertified
    }
}

struct UncertifiedNarrowProvider;

impl RegionProvider for UncertifiedNarrowProvider {
    fn regions(&self, query: RegionQuery) -> Result<Vec<FlowRegion>, boundtext::BoundtextError> {
        if query.cross_start_px >= 0.0 && query.cross_end_px <= 2_000.0 {
            Ok(vec![FlowRegion {
                inline_start_px: 0.0,
                inline_size_px: 1.0,
            }])
        } else {
            Ok(Vec::new())
        }
    }

    fn fit_search_kind(&self) -> FitSearchKind {
        FitSearchKind::Uncertified
    }
}

fn benchmark_exact_exclusion_fit(font_context: &FontContext<'_>) -> BenchmarkResult {
    let text = "あ".repeat(96);
    let request = FlowLayoutRequest {
        text: &text,
        font_size_px: 32.0,
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
            width: 96.0,
            height: 72.0,
        },
        min_region_width: None,
        max_lines: Some(2),
        ellipsis: true,
        fit: Some("shrink"),
        spans: None,
        rich_text: None,
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: None,
        min_font_size_px: Some(16.0),
        max_font_size_px: None,
        fit_epsilon_px: Some(0.25),
        fit_max_iterations: Some(12),
        fit_max_probes: Some(65),
        shape_options: ShapeOptions::default(),
    };

    reset_work();
    let started = Instant::now();
    let layout_result = layout_flow_with_regions(&request, font_context, &UncertifiedRectProvider)?;
    let elapsed = started.elapsed();
    assert_eq!(layout_result.chosen_font_size_px, Some(16.0));
    print_result(
        "exact-exclusion-fit-65",
        elapsed.as_micros(),
        InputStats {
            input_bytes: text.len(),
            canonical_nodes: 1,
            resolved_runs: 1,
            max_depth: 1,
            source_boundaries: 96,
            atomic_items: 0,
            exclusions: 1,
            geometry_segments: 0,
            projected_units: 0,
            visible_unit_drafts: 0,
            unit_member_refs: 0,
        },
        snapshot_work(),
    );
    Ok(())
}

fn benchmark_default_fit_probe_budget(font_context: &FontContext<'_>) -> BenchmarkResult {
    let text = "あ".repeat(100);
    let request = FlowLayoutRequest {
        text: &text,
        font_size_px: 1_031.75,
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
            width: 1.0,
            height: 2_000.0,
        },
        min_region_width: Some(1.0),
        max_lines: Some(1),
        ellipsis: false,
        fit: Some("shrink"),
        spans: None,
        rich_text: None,
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: None,
        min_font_size_px: Some(8.0),
        max_font_size_px: None,
        fit_epsilon_px: Some(0.25),
        fit_max_iterations: Some(12),
        fit_max_probes: None,
        shape_options: ShapeOptions::default(),
    };

    reset_work();
    let started = Instant::now();
    let layout_result =
        layout_flow_with_regions(&request, font_context, &UncertifiedNarrowProvider)?;
    let elapsed = started.elapsed();
    assert_eq!(layout_result.chosen_font_size_px, Some(8.0));
    let counters = snapshot_work();
    assert_eq!(counters.fit_probes, 4_096);
    print_result(
        "default-exact-fit-budget-4096",
        elapsed.as_micros(),
        InputStats {
            input_bytes: text.len(),
            canonical_nodes: 1,
            resolved_runs: 1,
            max_depth: 1,
            source_boundaries: 100,
            atomic_items: 0,
            exclusions: 1,
            geometry_segments: 0,
            projected_units: 0,
            visible_unit_drafts: 0,
            unit_member_refs: 0,
        },
        counters,
    );
    Ok(())
}

fn benchmark_content_exact_fit(font_context: &FontContext<'_>) -> BenchmarkResult {
    let rich_text = vec![
        RichTextNodeInput::Span {
            text: "i".to_string(),
            style: RichTextStyleInput {
                font_family: vec!["Noto".to_string()],
                font_weight: 400,
                font_style: FontStyle::Normal,
                font_size_px: 60.0,
                line_height: None,
                line_height_px: None,
                letter_spacing_px: Some(-90.0),
                language: Some("en".to_string()),
                color: None,
                text_strokes: None,
                text_shadows: None,
                font_variation_settings: None,
                font_feature_settings: None,
                text_orientation: None,
                text_decoration: None,
            },
        },
        RichTextNodeInput::InlineRect {
            rect: InlineRectInput {
                fragment_id: "atomic".to_string(),
                inline_size_px: 50.0,
                block_size_px: None,
                advance_px: Some(50.0),
                block_align: None,
                color: "#000000".to_string(),
                border_radius_px: None,
                opacity: None,
                paint_order: None,
            },
        },
    ];
    let request = TextLayoutRequest {
        text: "",
        spans: None,
        rich_text: Some(&rich_text),
        font_size_px: 60.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 35.0,
        max_height: Some(50.0),
        wrap: WrapMode::Char,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit: FitMode::Shrink,
        max_lines: Some(1),
        ellipsis: false,
        language: Language::En,
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: TextOrientation::Mixed,
        uax14_breaks: None,
        hanging_punctuation: false,
        font_variation_settings: Vec::new(),
        font_feature_settings: Vec::new(),
        min_font_size_px: Some(8.0),
        shrink_epsilon_px: Some(0.25),
        shrink_max_iterations: Some(12),
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
        fit_max_probes: Some(209),
    };

    reset_work();
    let started = Instant::now();
    let layout_result = layout_text_with_unit_metadata(&request, font_context)?;
    let elapsed = started.elapsed();
    assert_eq!(layout_result.chosen_font_size_px, 41.5);
    let counters = snapshot_work();
    assert_eq!(counters.fit_probes, 75);
    assert_eq!(counters.materialized_inline_rects, 1);
    print_result(
        "content-exact-fit-209-grid",
        elapsed.as_micros(),
        InputStats {
            input_bytes: 1,
            canonical_nodes: 2,
            resolved_runs: 1,
            max_depth: 1,
            source_boundaries: 1,
            atomic_items: 1,
            exclusions: 0,
            geometry_segments: 0,
            projected_units: 0,
            visible_unit_drafts: 0,
            unit_member_refs: 0,
        },
        counters,
    );
    Ok(())
}

fn benchmark_unit_map_projection(
    font_context: &FontContext<'_>,
    ruby_count: usize,
) -> BenchmarkResult {
    let ruby_style = RichTextStyleInput {
        font_family: vec!["Noto".to_string()],
        font_weight: 400,
        font_style: FontStyle::Normal,
        font_size_px: 24.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: Some(0.0),
        language: Some("ja".to_string()),
        color: None,
        text_strokes: None,
        text_shadows: None,
        font_variation_settings: None,
        font_feature_settings: None,
        text_orientation: None,
        text_decoration: None,
    };
    let rich_text = (0..ruby_count)
        .map(|_| RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: ruby_style.clone(),
            base: vec![RichTextNodeInput::Text {
                text: "漢".to_string(),
            }],
            rt: vec![RichTextNodeInput::Text {
                text: "か".to_string(),
            }],
            rt_levels: Vec::new(),
        })
        .collect::<Vec<_>>();
    let request = TextLayoutRequest {
        text: "",
        spans: None,
        rich_text: Some(&rich_text),
        font_size_px: 24.0,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: 0.0,
        text_indent: None,
        max_width: 1_000_000.0,
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
        fit_max_probes: None,
    };
    let layout_result = layout_text_with_unit_metadata(&request, font_context)?;

    reset_work();
    let started = Instant::now();
    let unit_map = build_text_unit_map_for_request(
        &layout_result,
        &request,
        font_context,
        TextUnitKind::Cluster,
        TextUnitRubyMode::Separate,
    )?;
    let elapsed = started.elapsed();
    let projected_units = ruby_count * 2;
    let unit_member_refs = unit_map
        .units
        .iter()
        .map(|unit| unit.members.len())
        .sum::<usize>();
    assert_eq!(unit_map.units.len(), projected_units);
    assert_eq!(unit_member_refs, projected_units);
    assert!(unit_map.units.iter().all(|unit| !unit.members.is_empty()));
    print_result(
        &format!("unit-map-ruby-{ruby_count}"),
        elapsed.as_micros(),
        InputStats {
            input_bytes: ruby_count * 6,
            canonical_nodes: ruby_count * 3,
            resolved_runs: ruby_count * 2,
            max_depth: 2,
            source_boundaries: ruby_count,
            atomic_items: ruby_count,
            exclusions: 0,
            geometry_segments: 0,
            projected_units,
            visible_unit_drafts: unit_map.units.len(),
            unit_member_refs,
        },
        snapshot_work(),
    );
    Ok(())
}

fn main() -> BenchmarkResult {
    let registry = registry()?;
    let families = vec!["Noto".to_string()];
    let style = FontStyle::Normal;
    let font_context = FontContext {
        registry: &registry,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &style,
    };

    benchmark_exact_ellipsis(&font_context)?;
    benchmark_ellipsis_candidate_budget(&font_context)?;
    benchmark_exact_exclusion_fit(&font_context)?;
    benchmark_default_fit_probe_budget(&font_context)?;
    benchmark_content_exact_fit(&font_context)?;
    benchmark_unit_map_projection(&font_context, 256)?;
    benchmark_unit_map_projection(&font_context, 512)?;
    Ok(())
}
